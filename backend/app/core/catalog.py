import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from backend.app.config import settings
from backend.app.models.dataset import DatasetWeather, ColumnWeather, DatasetSummary
from backend.app.utils.paths import to_posix_path, get_default_data_dir
from backend.app.utils.serialization import format_bytes

CATALOG_FILE = settings.DATA_DIR / "catalog.json"

class DatasetCatalog:
    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = data_dir or settings.DATA_DIR
        self.catalog_file = self.data_dir / "catalog.json"
        self._ensure_catalog_exists()

    def _ensure_catalog_exists(self):
        if not self.catalog_file.exists():
            with open(self.catalog_file, "w", encoding="utf-8") as f:
                json.dump({}, f)

    def _read_catalog(self) -> dict:
        self._ensure_catalog_exists()
        try:
            with open(self.catalog_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _write_catalog(self, data: dict):
        with open(self.catalog_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def list_datasets(self) -> list[DatasetSummary]:
        catalog = self._read_catalog()
        summaries = []
        for ds_id, meta in catalog.items():
            summaries.append(DatasetSummary(
                dataset_id=ds_id,
                file_name=meta.get("file_name", ds_id),
                row_count=meta.get("row_count", 0),
                column_count=meta.get("column_count", 0),
                file_size_formatted=meta.get("file_size_formatted", "0 B"),
                created_at=meta.get("created_at", ""),
                source=meta.get("source", "local"),
                path=meta.get("path", "")
            ))
        return summaries

    def get_dataset_path(self, dataset_id: str) -> Optional[str]:
        catalog = self._read_catalog()
        if dataset_id in catalog:
            return catalog[dataset_id].get("path")
        return None

    def register_file(self, dataset_id: str, file_path: str, description: Optional[str] = None) -> DatasetWeather:
        """
        Registers a dataset from Parquet, CSV, TSV, or Excel (.xlsx, .xls).
        If the file is CSV/Excel, automatically stream-converts to high-performance
        ZSTD-compressed Parquet handling tricky quotes, delimiters, and multi-line strings.
        """
        posix_p = to_posix_path(file_path)
        if not os.path.exists(posix_p):
            raise FileNotFoundError(f"File not found: {posix_p}")

        suffix = Path(posix_p).suffix.lower()

        # Handle CSV / TSV conversion via DuckDB read_csv_auto
        if suffix in [".csv", ".tsv"]:
            target_pqt = self.data_dir / f"{dataset_id}.parquet"
            posix_target = to_posix_path(target_pqt)
            con = duckdb.connect()
            try:
                con.execute(f"""
                    COPY (SELECT * FROM read_csv_auto('{posix_p}'))
                    TO '{posix_target}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000);
                """)
            finally:
                con.close()
            posix_p = posix_target

        # Handle Excel (.xlsx, .xls) conversion via pandas + openpyxl/xlrd
        elif suffix in [".xlsx", ".xls"]:
            import pandas as pd
            target_pqt = self.data_dir / f"{dataset_id}.parquet"
            posix_target = to_posix_path(target_pqt)
            df = pd.read_excel(posix_p)
            tbl = pa.Table.from_pandas(df)
            pq.write_table(tbl, posix_target, compression="zstd")
            del df, tbl
            posix_p = posix_target

        # Extract file-level metadata via PyArrow Parquet File Meta
        parquet_file = pq.ParquetFile(posix_p)
        meta = parquet_file.metadata
        schema = parquet_file.schema_arrow

        row_count = meta.num_rows
        column_count = meta.num_columns
        num_row_groups = meta.num_row_groups
        file_size_bytes = os.path.getsize(posix_p)
        file_size_formatted = format_bytes(file_size_bytes)

        # Estimate uncompressed size based on column types and rows
        est_uncompressed_bytes = sum(
            col.total_uncompressed_size
            for rg in range(num_row_groups)
            for col in [meta.row_group(rg).column(c) for c in range(column_count)]
        )
        if est_uncompressed_bytes == 0:
            est_uncompressed_bytes = file_size_bytes * 4

        est_uncompressed_formatted = format_bytes(est_uncompressed_bytes)
        compression_ratio = round(est_uncompressed_bytes / max(1, file_size_bytes), 2)

        # Build initial column schema without full scan
        columns = []
        for field in schema:
            columns.append(ColumnWeather(
                name=field.name,
                dtype=str(field.type),
                null_count=0,
                null_percentage=0.0,
                approx_unique=0
            ))

        weather = DatasetWeather(
            dataset_id=dataset_id,
            file_name=Path(posix_p).name,
            path=posix_p,
            file_size_bytes=file_size_bytes,
            file_size_formatted=file_size_formatted,
            row_count=row_count,
            column_count=column_count,
            row_groups=num_row_groups,
            est_uncompressed_bytes=est_uncompressed_bytes,
            est_uncompressed_formatted=est_uncompressed_formatted,
            compression_ratio=compression_ratio,
            columns=columns
        )

        catalog = self._read_catalog()
        catalog[dataset_id] = weather.model_dump()
        catalog[dataset_id]["created_at"] = datetime.now().isoformat()
        self._write_catalog(catalog)

        return weather

    def get_weather(self, dataset_id: str, compute_deep_profiles: bool = True) -> DatasetWeather:
        """
        Returns the Data Weather profile. If compute_deep_profiles is True and not cached,
        uses DuckDB SUMMARIZE to populate cardinality, null percentages, min, max, quartiles.
        """
        catalog = self._read_catalog()
        if dataset_id not in catalog:
            raise KeyError(f"Dataset '{dataset_id}' not found in catalog")

        entry = catalog[dataset_id]
        weather = DatasetWeather(**entry)

        # Check if already deep profiled (approx_unique > 0)
        has_deep_stats = any(c.approx_unique > 0 for c in weather.columns)
        if compute_deep_profiles and not has_deep_stats and weather.row_count > 0:
            weather = self._compute_duckdb_summarize(weather)
            catalog[dataset_id] = weather.model_dump()
            self._write_catalog(catalog)

        return weather

    def _compute_duckdb_summarize(self, weather: DatasetWeather) -> DatasetWeather:
        """
        Runs DuckDB SUMMARIZE over the Parquet file to compute instant column stats.
        Handles both local files and remote S3 datasets with zero-copy range requests and sampling.
        """
        posix_p = weather.path
        con = duckdb.connect()
        try:
            if posix_p.startswith("s3://"):
                cat = self._read_catalog()
                profile_id = cat.get(weather.dataset_id, {}).get("s3_profile_id")
                if profile_id:
                    from backend.app.core.s3_manager import s3_manager
                    prof = s3_manager.get_profile(profile_id)
                    if prof:
                        con.execute("INSTALL httpfs; LOAD httpfs;")
                        con.execute(f"SET s3_region = '{prof.region}';")
                        if prof.access_key_id and prof.secret_access_key and prof.access_key_id not in ["IAM_ROLE", "DEFAULT"]:
                            con.execute(f"SET s3_access_key_id = '{prof.access_key_id}';")
                            con.execute(f"SET s3_secret_access_key = '{prof.secret_access_key}';")
                        if not prof.use_ssl:
                            con.execute("SET s3_use_ssl = false;")
                        else:
                            con.execute("SET s3_use_ssl = true;")
                        if prof.endpoint_url:
                            ep = prof.endpoint_url.strip()
                            if "://" in ep:
                                ep = ep.split("://", 1)[1]
                            ep = ep.rstrip("/")
                            con.execute(f"SET s3_endpoint = '{ep}';")
                            con.execute("SET s3_url_style = 'path';")

                # For remote S3 tables over 100k rows, sample 100,000 to keep weather computation instantaneous
                if weather.row_count > 100000:
                    summary_df = con.execute(f"SUMMARIZE SELECT * FROM read_parquet('{posix_p}') USING SAMPLE 100000;").df()
                else:
                    summary_df = con.execute(f"SUMMARIZE SELECT * FROM read_parquet('{posix_p}');").df()
            else:
                summary_df = con.execute(f"SUMMARIZE SELECT * FROM read_parquet('{posix_p}')").df()
            
            # Mapping columns from DuckDB SUMMARIZE
            # Columns: column_name, column_type, min, max, approx_unique, avg, std, q25, q50, q75, count, null_percentage
            stats_by_col = {}
            for _, row in summary_df.iterrows():
                col_name = str(row["column_name"])
                stats_by_col[col_name] = row

            new_columns = []
            for col in weather.columns:
                if col.name in stats_by_col:
                    s = stats_by_col[col.name]
                    null_pct = float(s.get("null_percentage", 0.0) or 0.0)
                    null_cnt = int(round((null_pct / 100.0) * weather.row_count))
                    approx_u = int(s.get("approx_unique", 0) or 0)
                    min_val = s.get("min")
                    max_val = s.get("max")
                    q25 = s.get("q25")
                    q50 = s.get("q50")
                    q75 = s.get("q75")

                    new_columns.append(ColumnWeather(
                        name=col.name,
                        dtype=str(s.get("column_type", col.dtype)),
                        null_count=null_cnt,
                        null_percentage=round(null_pct, 2),
                        approx_unique=approx_u,
                        min_value=None if min_val is None else str(min_val),
                        max_value=None if max_val is None else str(max_val),
                        q25=None if q25 is None else str(q25),
                        q50=None if q50 is None else str(q50),
                        q75=None if q75 is None else str(q75)
                    ))
                else:
                    new_columns.append(col)

            weather.columns = new_columns
        finally:
            con.close()

        return weather

    def register_s3_dataset(self, dataset_id: str, profile_id: str, s3_uri: str, description: Optional[str] = None) -> DatasetWeather:
        """
        Registers an S3 multi-file folder as a unified dataset.
        Extracts schema and metadata directly via DuckDB httpfs zero-download range requests.
        """
        from backend.app.core.s3_manager import s3_manager
        profile = s3_manager.get_profile(profile_id)
        if not profile:
            raise ValueError(f"S3 Profile '{profile_id}' not found.")

        con = duckdb.connect()
        try:
            con.execute("INSTALL httpfs; LOAD httpfs;")
            con.execute(f"SET s3_region = '{profile.region}';")
            if profile.access_key_id and profile.secret_access_key and profile.access_key_id not in ["IAM_ROLE", "DEFAULT"]:
                con.execute(f"SET s3_access_key_id = '{profile.access_key_id}';")
                con.execute(f"SET s3_secret_access_key = '{profile.secret_access_key}';")
            if not profile.use_ssl:
                con.execute("SET s3_use_ssl = false;")
            else:
                con.execute("SET s3_use_ssl = true;")
            if profile.endpoint_url:
                ep = profile.endpoint_url.strip()
                if "://" in ep:
                    ep = ep.split("://", 1)[1]
                ep = ep.rstrip("/")
                con.execute(f"SET s3_endpoint = '{ep}';")
                con.execute("SET s3_url_style = 'path';")

            # 1. Row count & Columns via DuckDB DESCRIBE
            desc_df = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{s3_uri}') LIMIT 0;").df()
            count_res = con.execute(f"SELECT COUNT(*) FROM read_parquet('{s3_uri}');").fetchone()
            row_count = int(count_res[0]) if count_res else 0

            columns = []
            for _, r in desc_df.iterrows():
                col_name = str(r["column_name"])
                dtype = str(r["column_type"])
                columns.append(ColumnWeather(
                    name=col_name,
                    dtype=dtype,
                    null_count=0,
                    null_percentage=0.0,
                    approx_unique=0
                ))

            weather = DatasetWeather(
                dataset_id=dataset_id,
                file_name=f"☁️ {s3_uri.split('/')[-2] or dataset_id}",
                path=s3_uri,
                file_size_bytes=0,
                file_size_formatted="Remote S3 Lakehouse",
                row_count=row_count,
                column_count=len(columns),
                row_groups=1,
                est_uncompressed_bytes=row_count * len(columns) * 8,
                est_uncompressed_formatted=format_bytes(row_count * len(columns) * 8),
                compression_ratio=3.5,
                columns=columns
            )

            # Save in catalog with s3 profile metadata
            cat = self._read_catalog()
            cat_entry = weather.model_dump()
            cat_entry["source"] = "s3"
            cat_entry["s3_profile_id"] = profile_id
            cat_entry["description"] = description
            cat[dataset_id] = cat_entry
            self._write_catalog(cat)

            return weather
        finally:
            con.close()

    def delete_dataset(self, dataset_id: str):
        catalog = self._read_catalog()
        if dataset_id in catalog:
            file_path = catalog[dataset_id].get("path")
            del catalog[dataset_id]
            self._write_catalog(catalog)
            if file_path and os.path.exists(file_path):
                # Only delete from disk if it was created inside data_dir
                try:
                    if Path(file_path).parent.resolve() == self.data_dir.resolve():
                        os.remove(file_path)
                except Exception:
                    pass

    def scan_data_directory(self) -> list[DatasetWeather]:
        """
        Scans settings.DATA_DIR for any .parquet, .csv, .tsv, .xlsx, .xls files
        dropped directly into the folder and registers them automatically.
        """
        registered = []
        valid_exts = {".parquet", ".pqt", ".csv", ".tsv", ".xlsx", ".xls"}
        for file_path in self.data_dir.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in valid_exts:
                ds_id = file_path.stem
                cat = self._read_catalog()
                if ds_id not in cat:
                    weather = self.register_file(ds_id, str(file_path), description=f"Auto-scanned {file_path.suffix} file")
                    registered.append(weather)
        return registered

    def clean_test_datasets(self) -> list[str]:
        """
        Purges all test and synthetic datasets (*test*, *synthetic*), deletes their parquet files,
        and cleans catalog.json so only your real datasets remain.
        """
        catalog = self._read_catalog()
        removed_ids = []
        for ds_id in list(catalog.keys()):
            if "test" in ds_id.lower() or "synthetic" in ds_id.lower():
                self.delete_dataset(ds_id)
                removed_ids.append(ds_id)

        # Also remove any dangling test files (.parquet, .csv, .xlsx) in data_dir
        for file_path in self.data_dir.iterdir():
            if file_path.is_file() and any(k in file_path.name.lower() for k in ["test", "synthetic"]):
                try:
                    file_path.unlink(missing_ok=True)
                    if file_path.stem not in removed_ids:
                        removed_ids.append(file_path.stem)
                except Exception:
                    pass

        return removed_ids

    def generate_sample_dataset(self, dataset_id: str = "synthetic_trades_500k", num_rows: int = 500000) -> DatasetWeather:
        """
        Generates a realistic trading/financial dataset in Parquet format with:
        - trade_id (int64)
        - symbol (low cardinality: NVDA, AAPL, MSFT, AMZN, TSLA, GOOGL, META, JPM, BAC, XOM)
        - desk (low cardinality: NY_CREDIT, LDN_RATES, APAC_FLOW, EQ_VOL)
        - side (BUY / SELL)
        - price (float64)
        - quantity (int64)
        - notional (float64)
        - status (FILLED, PARTIAL, CANCELLED, REJECTED)
        - execution_latency_ms (float64)
        - trader_id (medium cardinality: 1000 distinct)
        - account_id (high cardinality: 50,000 distinct)
        - timestamp (timestamp[us])
        """
        output_file = self.data_dir / f"{dataset_id}.parquet"
        posix_out = to_posix_path(output_file)

        # Generate efficiently using DuckDB SQL directly to write Parquet
        con = duckdb.connect()
        try:
            sql = f"""
            COPY (
                SELECT
                    10000000 + i AS trade_id,
                    (['NVDA', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'GOOGL', 'META', 'JPM', 'BAC', 'XOM'])[(1 + (hash(i) % 10))::BIGINT] AS symbol,
                    (['NY_CREDIT', 'LDN_RATES', 'APAC_FLOW', 'EQ_VOL'])[(1 + (hash(i * 3) % 4))::BIGINT] AS desk,
                    (['BUY', 'SELL'])[(1 + (hash(i * 7) % 2))::BIGINT] AS side,
                    ROUND(10.0 + (hash(i * 11) % 99000) / 100.0, 2) AS price,
                    10 + (hash(i * 13) % 5000) AS quantity,
                    ROUND((10.0 + (hash(i * 11) % 99000) / 100.0) * (10 + (hash(i * 13) % 5000)), 2) AS notional,
                    (['FILLED', 'PARTIAL', 'CANCELLED', 'REJECTED'])[(1 + (hash(i * 17) % 4))::BIGINT] AS status,
                    ROUND(0.05 + (hash(i * 19) % 2500) / 100.0, 2) AS execution_latency_ms,
                    'TRADER_' || LPAD(((hash(i * 23) % 1000)::BIGINT)::VARCHAR, 4, '0') AS trader_id,
                    'ACC_' || LPAD(((hash(i * 29) % 50000)::BIGINT)::VARCHAR, 6, '0') AS account_id,
                    TIMESTAMP '2026-01-01 09:30:00' + INTERVAL ((hash(i * 31) % 31536000)::BIGINT) SECOND AS trade_time
                FROM range(1, {num_rows + 1}) tbl(i)
            ) TO '{posix_out}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000);
            """
            con.execute(sql)
        finally:
            con.close()

        return self.register_file(dataset_id, posix_out, description="Realistic high-volume trading dataset")

catalog = DatasetCatalog()
