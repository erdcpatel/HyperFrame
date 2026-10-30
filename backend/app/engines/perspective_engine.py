import gc
import os
from pathlib import Path
from typing import Tuple, Optional, Any
import psutil
import perspective
from perspective.handlers.starlette import PerspectiveStarletteHandler
import pyarrow as pa
import pyarrow.parquet as pq

from backend.app.engines.base import BaseEngine
from backend.app.models.query import HyperQuery
from backend.app.utils.paths import to_posix_path

# Allow high-memory allocation for Perspective C++ in-memory columnar tables (default 12.0 GB)
MAX_PERSPECTIVE_RAM_GB = float(os.getenv("HYPERFRAME_MAX_PERSPECTIVE_RAM_GB", "12.0"))
# Datasets larger than this threshold (MB) use smart compute-pushdown for aggregations/pivots
PSP_PUSHDOWN_THRESHOLD_MB = float(os.getenv("HYPERFRAME_PSP_PUSHDOWN_THRESHOLD_MB", "15.0"))

class PerspectiveEngine(BaseEngine):
    def __init__(self):
        self._server = perspective.Server()
        self._client = self._server.new_local_client()
        self._active_tables: dict[str, Any] = {}
        self._duckdb: Optional[Any] = None

    def _get_duckdb(self):
        if self._duckdb is None:
            from backend.app.engines.duckdb_engine import DuckDBEngine
            self._duckdb = DuckDBEngine()
        return self._duckdb

    @property
    def name(self) -> str:
        return "perspective"

    @property
    def server(self) -> perspective.Server:
        return self._server

    def load_dataset(self, dataset_id: str, file_path: str) -> None:
        """
        Loads the Parquet file into an in-memory C++ Perspective Table using chunked batch ingestion.
        Loads all columns so the cached table can satisfy all subsequent queries.
        Tracks table instance for explicit deletion on unload.
        """
        if file_path.startswith("s3://"):
            return  # Remote S3 datasets are always evaluated via zero-copy hybrid compute-pushdown

        if dataset_id in self._active_tables:
            return

        posix_p = to_posix_path(file_path)
        try:
            if "*" in posix_p or Path(posix_p).is_dir():
                # Multi-file or partitioned dataset: load via DuckDB Arrow scan into Perspective
                import duckdb
                con = duckdb.connect()
                try:
                    arrow_table = con.sql(f"SELECT * FROM read_parquet('{posix_p}', union_by_name=true, hive_partitioning=true);").arrow()
                    if hasattr(arrow_table, "read_all"):
                        arrow_table = arrow_table.read_all()
                    table = self._client.table(arrow_table, name=dataset_id)
                    self._active_tables[dataset_id] = table
                    return
                finally:
                    con.close()

            file_size_mb = Path(posix_p).stat().st_size / (1024 * 1024)
            # Check available system RAM before attempting in-memory ingestion
            mem = psutil.virtual_memory()
            avail_mb = mem.available / (1024 * 1024)
            # Perspective C++ internal index + Arrow uncompressed memory requires ~6-8x the compressed parquet file size
            estimated_ram_mb = file_size_mb * 7
            max_allowed_mb = MAX_PERSPECTIVE_RAM_GB * 1024

            if estimated_ram_mb > max_allowed_mb or estimated_ram_mb > (avail_mb + 512):
                raise RuntimeError(
                    f"Dataset is {file_size_mb:.1f} MB on disk and requires ~{estimated_ram_mb:.0f} MB RAM in Perspective C++. "
                    f"Available RAM: {avail_mb:.0f} MB (Configured Max Limit: {max_allowed_mb:.0f} MB). "
                    f"Switch to DuckDB 2.0 (Out-of-Core) or Polars 2.x (Streaming) which process this dataset directly from disk."
                )

            parquet_file = pq.ParquetFile(posix_p)
            # Ingest in chunks of 100,000 rows to prevent peak memory fragmentation and C++ allocation SIGSEGV
            batch_iter = parquet_file.iter_batches(batch_size=100_000)
            first_batch = next(batch_iter, None)
            if first_batch is None:
                raise RuntimeError(f"Dataset '{dataset_id}' contains no records.")

            first_table = pa.Table.from_batches([first_batch])
            table = self._client.table(first_table, name=dataset_id)

            for batch in batch_iter:
                batch_tbl = pa.Table.from_batches([batch])
                table.update(batch_tbl)

            self._active_tables[dataset_id] = table
        except Exception as e:
            raise RuntimeError(f"Perspective In-Memory Load Error on '{dataset_id}': {str(e)}")

    def execute_query(self, query: HyperQuery, file_path: str) -> Tuple[pa.Table, str, int]:
        """
        Executes query on Perspective. If dataset is larger than threshold and an aggregation
        is requested (or system memory is constrained), uses Smart Compute-Pushdown via DuckDB
        vectorized disk scan, then renders the result through Perspective's C++ view API.
        """
        is_s3 = file_path.startswith("s3://")
        posix_p = file_path if is_s3 else to_posix_path(file_path)
        file_size_mb = 0.0 if is_s3 else (Path(posix_p).stat().st_size / (1024 * 1024) if Path(posix_p).exists() else 0.0)
        mem = psutil.virtual_memory()
        avail_mb = mem.available / (1024 * 1024)
        estimated_ram_mb = file_size_mb * 7
        max_allowed_mb = MAX_PERSPECTIVE_RAM_GB * 1024

        should_pushdown = is_s3 or (
            file_size_mb >= PSP_PUSHDOWN_THRESHOLD_MB and (query.groupBy or query.aggregations)
        ) or (estimated_ram_mb > max_allowed_mb or estimated_ram_mb > (avail_mb + 512))

        if should_pushdown:
            duck = self._get_duckdb()
            intermediate_table, duck_plan, total_matching = duck.execute_query(query, file_path)

            # Ingest the compact intermediate result into Perspective for C++ view creation & serialization
            temp_table = self._client.table(intermediate_table)
            view = temp_table.view()
            arrow_bytes = view.to_arrow()
            try:
                view.delete()
                temp_table.delete()
            except Exception:
                pass

            reader = pa.ipc.open_stream(arrow_bytes)
            res_table = reader.read_all().combine_chunks()

            plan_str = (
                f"Perspective Hybrid Pushdown (Pre-aggregated via DuckDB 2.0 Vector Engine -> "
                f"Perspective View: {len(res_table.column_names)} cols, {res_table.num_rows} rows returned of {total_matching})"
            )
            return res_table, plan_str, total_matching

        ds_id = query.dataset
        if ds_id not in self._active_tables:
            self.load_dataset(ds_id, file_path)

        table = self._active_tables[ds_id]

        view_config: dict[str, Any] = {}
        if query.select:
            view_config["columns"] = query.select

        if query.filters:
            # Perspective filter format: [column, operator, value]
            psp_filters = []
            for f in query.filters:
                op_map = {
                    "equals": "==",
                    "not_equals": "!=",
                    "greater_than": ">",
                    "greater_than_or_equal": ">=",
                    "less_than": "<",
                    "less_than_or_equal": "<=",
                    "contains": "contains",
                    "is_null": "is null",
                    "is_not_null": "is not null"
                }
                psp_op = op_map.get(f.operator, "==")
                psp_filters.append([f.column, psp_op, f.value])
            view_config["filter"] = psp_filters

        alias_to_col: dict[str, str] = {}
        if query.aggregations:
            aggregates: dict[str, str] = {}
            for agg in query.aggregations:
                func = agg.function.lower()
                if func == "avg":
                    func = "mean"
                aggregates[agg.column] = func
                if agg.alias:
                    alias_to_col[agg.alias] = agg.column
            view_config["aggregates"] = aggregates

        if query.groupBy:
            view_config["group_by"] = query.groupBy

        if query.orderBy:
            sort_list = []
            table_cols = set(table.columns())
            for s in query.orderBy:
                actual_col = alias_to_col.get(s.column, s.column)
                if actual_col in table_cols:
                    sort_list.append([actual_col, s.direction.lower()])
            if sort_list:
                view_config["sort"] = sort_list

        view = table.view(**view_config)
        total_rows = view.num_rows()
        # Pushdown window slicing directly into Perspective C++ serialization (avoids serializing millions of rows)
        if query.limit > 0:
            end_r = min(total_rows, query.offset + query.limit)
            arrow_bytes = view.to_arrow(start_row=query.offset, end_row=end_r)
        else:
            arrow_bytes = view.to_arrow()

        reader = pa.ipc.open_stream(arrow_bytes)
        res_table = reader.read_all().combine_chunks()

        plan_str = f"Perspective In-Memory View (Columns: {len(res_table.column_names)}, Returned: {res_table.num_rows}, Total: {total_rows})"
        return res_table, plan_str, total_rows

    def explain(self, query: HyperQuery, file_path: str) -> str:
        posix_p = to_posix_path(file_path)
        file_size_mb = Path(posix_p).stat().st_size / (1024 * 1024) if Path(posix_p).exists() else 0.0
        if file_size_mb >= PSP_PUSHDOWN_THRESHOLD_MB and (query.groupBy or query.aggregations):
            return f"Perspective Hybrid Pushdown: Pre-aggregated with DuckDB 2.0 Vector Scan on '{query.dataset}' ({file_size_mb:.1f} MB), materialized into Perspective C++ view for 60 FPS presentation."
        return f"Perspective In-Memory Engine: Direct C++ Apache Arrow buffer execution on hosted table '{query.dataset}'."

    def export_csv(self, query: HyperQuery, file_path: str, output_path: str) -> None:
        if file_path.startswith("s3://"):
            return self._get_duckdb().export_csv(query, file_path, output_path)
        super().export_csv(query, file_path, output_path)

    def unload(self) -> None:
        """
        Explicitly delete all hosted C++ tables to recover RAM.
        """
        for name, table in list(self._active_tables.items()):
            try:
                table.delete()
            except Exception:
                pass
        self._active_tables.clear()
        gc.collect()

    def get_websocket_handler(self, websocket):
        return PerspectiveStarletteHandler(perspective_server=self._server, websocket=websocket)
