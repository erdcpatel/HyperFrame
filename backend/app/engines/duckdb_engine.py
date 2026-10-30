import os
import duckdb
import pyarrow as pa
from typing import Tuple, Any, Optional
from backend.app.engines.base import BaseEngine
from backend.app.models.query import HyperQuery, HyperFilter, HyperSort, HyperAggregation
from backend.app.config import settings
from backend.app.utils.paths import to_posix_path

def _format_sql_val(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).strip()
    try:
        if "." in s:
            float(s)
            return s
        int(s)
        return s
    except ValueError:
        pass
    clean = s.replace("'", "''")
    return f"'{clean}'"

class DuckDBEngine(BaseEngine):
    def __init__(self):
        self._con = duckdb.connect()
        self._setup_pragmas()

    @property
    def name(self) -> str:
        return "duckdb"

    def _setup_pragmas(self):
        spill_dir = to_posix_path(settings.SPILL_DIR)
        self._con.execute(f"PRAGMA threads={settings.DUCKDB_THREADS};")
        self._con.execute(f"PRAGMA memory_limit='{settings.DUCKDB_MEMORY_LIMIT}';")
        self._con.execute(f"PRAGMA temp_directory='{spill_dir}';")
        try:
            self._con.execute("INSTALL httpfs; LOAD httpfs;")
        except Exception:
            pass

    def _apply_s3_credentials(self, file_path: str, dataset_id: str):
        if file_path.startswith("s3://"):
            from backend.app.core.catalog import catalog
            from backend.app.core.s3_manager import s3_manager
            cat_entry = catalog._read_catalog().get(dataset_id, {})
            profile_id = cat_entry.get("s3_profile_id")
            if profile_id:
                profile = s3_manager.get_profile(profile_id)
                if profile:
                    try:
                        self._con.execute("SET enable_server_cert_verification = false;")
                    except Exception:
                        pass
                    self._con.execute(f"SET s3_region = '{profile.region or 'us-east-1'}';")
                    if profile.access_key_id and profile.secret_access_key and profile.access_key_id not in ["IAM_ROLE", "DEFAULT"]:
                        self._con.execute(f"SET s3_access_key_id = '{profile.access_key_id}';")
                        self._con.execute(f"SET s3_secret_access_key = '{profile.secret_access_key}';")
                    if not profile.use_ssl:
                        self._con.execute("SET s3_use_ssl = false;")
                    else:
                        self._con.execute("SET s3_use_ssl = true;")
                    if profile.endpoint_url:
                        ep = profile.endpoint_url.strip()
                        if "://" in ep:
                            ep = ep.split("://", 1)[1]
                        ep = ep.rstrip("/")
                        self._con.execute(f"SET s3_endpoint = '{ep}';")
                        self._con.execute("SET s3_url_style = 'path';")

    def _compile_sql(self, query: HyperQuery, file_path: str, count_only: bool = False) -> str:
        posix_p = file_path if file_path.startswith("s3://") else to_posix_path(file_path)
        read_expr = f"read_parquet('{posix_p}', union_by_name=true, hive_partitioning=true)"

        if query.raw_sql:
            sql = query.raw_sql
            if ":dataset" in sql:
                sql = sql.replace(":dataset", read_expr)
            elif "read_parquet(" not in sql:
                import re
                sql = re.sub(rf"\b{re.escape(query.dataset)}\b", read_expr, sql)
            if count_only:
                clean_sql = sql.rstrip("; \t\n")
                return f"SELECT COUNT(*) FROM ({clean_sql}) AS _raw_count_subq"
            return sql

        from_clause = read_expr

        # WHERE conditions
        where_clauses = []
        for f in query.filters:
            col = f'"{f.column}"'
            op = f.operator
            val = f.value
            val_fmt = _format_sql_val(val)

            if op == "equals":
                where_clauses.append(f"{col} = {val_fmt}")
            elif op == "not_equals":
                where_clauses.append(f"{col} != {val_fmt}")
            elif op == "greater_than":
                where_clauses.append(f"{col} > {val_fmt}")
            elif op == "greater_than_or_equal":
                where_clauses.append(f"{col} >= {val_fmt}")
            elif op == "less_than":
                where_clauses.append(f"{col} < {val_fmt}")
            elif op == "less_than_or_equal":
                where_clauses.append(f"{col} <= {val_fmt}")
            elif op == "contains":
                clean_val = str(val).replace("'", "''")
                where_clauses.append(f"{col} ILIKE '%{clean_val}%'")
            elif op == "starts_with":
                clean_val = str(val).replace("'", "''")
                where_clauses.append(f"{col} ILIKE '{clean_val}%'")
            elif op == "ends_with":
                clean_val = str(val).replace("'", "''")
                where_clauses.append(f"{col} ILIKE '%{clean_val}'")
            elif op == "in" and isinstance(val, list):
                val_strs = [_format_sql_val(v) for v in val]
                where_clauses.append(f"{col} IN ({', '.join(val_strs)})")
            elif op == "not_in" and isinstance(val, list):
                val_strs = [_format_sql_val(v) for v in val]
                where_clauses.append(f"{col} NOT IN ({', '.join(val_strs)})")
            elif op == "is_null":
                where_clauses.append(f"{col} IS NULL")
            elif op == "is_not_null":
                where_clauses.append(f"{col} IS NOT NULL")

        # Global multi-column quick search across all text columns
        if query.quick_search and query.quick_search.strip():
            clean_term = query.quick_search.strip().replace("'", "''")
            try:
                import pyarrow.parquet as pq
                pf = pq.ParquetFile(posix_p)
                str_cols = [c for c in pf.schema.names if any(t in str(pf.schema_arrow.field(c).type).lower() for t in ["str", "varchar", "utf8", "text", "char"])]
                if str_cols:
                    concat_parts = [f"COALESCE(CAST(\"{c}\" AS VARCHAR), '')" for c in str_cols]
                    where_clauses.append(f"({' || \' \' || '.join(concat_parts)}) ILIKE '%{clean_term}%'")
            except Exception:
                pass

        where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        # Count query
        if count_only:
            return f"SELECT COUNT(*) AS total_count FROM {from_clause}{where_sql}"

        # SELECT projections & aggregations
        if query.aggregations:
            select_items = [f'"{col}"' for col in query.groupBy]
            for agg in query.aggregations:
                alias = f'"{agg.alias or f"{agg.function}_{agg.column}"}"'
                if agg.function == "sum":
                    select_items.append(f'SUM("{agg.column}") AS {alias}')
                elif agg.function == "avg":
                    select_items.append(f'AVG("{agg.column}") AS {alias}')
                elif agg.function == "min":
                    select_items.append(f'MIN("{agg.column}") AS {alias}')
                elif agg.function == "max":
                    select_items.append(f'MAX("{agg.column}") AS {alias}')
                elif agg.function == "count":
                    select_items.append(f'COUNT("{agg.column}") AS {alias}')
                elif agg.function == "approx_count_distinct":
                    select_items.append(f'APPROX_COUNT_DISTINCT("{agg.column}") AS {alias}')
            select_sql = ", ".join(select_items)
        elif query.select:
            select_sql = ", ".join([f'"{c}"' for c in query.select])
        else:
            select_sql = "*"

        sql = f"SELECT {select_sql} FROM {from_clause}{where_sql}"

        # GROUP BY
        if query.groupBy:
            group_sql = ", ".join([f'"{col}"' for col in query.groupBy])
            sql += f" GROUP BY {group_sql}"

        # ORDER BY
        if query.orderBy:
            order_items = [f'"{sort.column}" {sort.direction.upper()}' for sort in query.orderBy]
            sql += f" ORDER BY {', '.join(order_items)}"

        # LIMIT & OFFSET
        if query.limit > 0:
            sql += f" LIMIT {query.limit} OFFSET {query.offset}"

        return sql

    def _sync_catalog_views(self, cursor, active_dataset: Optional[str] = None, active_path: Optional[str] = None):
        """
        Registers all uploaded datasets in the catalog as temporary DuckDB views.
        This enables cross-file SQL joins across ANY number of uploaded files with 0 MB RAM overhead!
        """
        from backend.app.core.catalog import catalog
        cat = catalog._read_catalog()
        for ds_id, meta in cat.items():
            p = meta.get("path")
            if p and (os.path.exists(p) or "*" in p or p.startswith("s3://")):
                posix_p = to_posix_path(p)
                try:
                    cursor.execute(f'CREATE OR REPLACE TEMPORARY VIEW "{ds_id}" AS SELECT * FROM read_parquet(\'{posix_p}\', union_by_name=true, hive_partitioning=true);')
                except Exception as e:
                    logger.debug(f"Could not create temporary view for {ds_id}: {e}")

        # Also register :dataset as an alias for the currently active dataset
        if active_path and (os.path.exists(active_path) or "*" in active_path or active_path.startswith("s3://")):
            posix_act = to_posix_path(active_path)
            try:
                cursor.execute(f'CREATE OR REPLACE TEMPORARY VIEW ":dataset" AS SELECT * FROM read_parquet(\'{posix_act}\', union_by_name=true, hive_partitioning=true);')
            except Exception as e:
                logger.debug(f"Could not create temporary view for :dataset: {e}")

    def execute_query(self, query: HyperQuery, file_path: str) -> Tuple[pa.Table, str, int]:
        self._apply_s3_credentials(file_path, query.dataset)
        posix_p = file_path if file_path.startswith("s3://") else to_posix_path(file_path)

        # 1. Total matching rows count
        # Ultra-fast path: If single local file and no filters/grouping, read total rows from Parquet metadata in 0.001 ms!
        total_rows = None
        if not file_path.startswith("s3://") and "*" not in posix_p and not os.path.isdir(posix_p) and not query.filters and not query.raw_sql and not query.groupBy and not query.quick_search:
            try:
                import pyarrow.parquet as pq
                total_rows = pq.ParquetFile(posix_p).metadata.num_rows
            except Exception:
                total_rows = None

        if total_rows is None:
            count_sql = self._compile_sql(query, file_path, count_only=True)
            count_cursor = self._con.cursor()
            try:
                self._sync_catalog_views(count_cursor, query.dataset, file_path)
                res_rows = count_cursor.sql(count_sql).fetchall()
                total_rows = int(res_rows[0][0]) if res_rows and len(res_rows[0]) > 0 and res_rows[0][0] is not None else 0
            except Exception as e:
                logger.error(f"Failed to execute count query: {e}")
                total_rows = 0
            finally:
                count_cursor.close()

        # 2. Main data query
        data_cursor = self._con.cursor()
        try:
            self._sync_catalog_views(data_cursor, query.dataset, file_path)
            sql = self._compile_sql(query, file_path, count_only=False)
            res = data_cursor.sql(sql).arrow()
            if hasattr(res, "read_all"):
                arrow_table = res.read_all()
            else:
                arrow_table = res
            return arrow_table, sql, total_rows
        finally:
            data_cursor.close()

    def explain(self, query: HyperQuery, file_path: str) -> str:
        self._apply_s3_credentials(file_path, query.dataset)
        cursor = self._con.cursor()
        try:
            self._sync_catalog_views(cursor, query.dataset, file_path)
            sql = self._compile_sql(query, file_path, count_only=False).rstrip("; \t\n")
            explain_sql = sql if sql.lower().startswith("explain") else f"EXPLAIN ANALYZE {sql}"
            res = cursor.sql(explain_sql).fetchall()
            return "\n".join(str(r[1]) if len(r) > 1 else str(r[0]) for r in res)
        except Exception as e:
            return f"EXPLAIN error: {str(e)}"
        finally:
            cursor.close()

    def unload(self) -> None:
        try:
            self._con.close()
        except Exception:
            pass
        self._con = duckdb.connect()
        self._setup_pragmas()
