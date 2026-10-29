import duckdb
import pyarrow as pa
from typing import Tuple, Any, Optional
from backend.app.engines.base import BaseEngine
from backend.app.models.query import HyperQuery, HyperFilter, HyperSort, HyperAggregation
from backend.app.config import settings
from backend.app.utils.paths import to_posix_path

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

    def _compile_sql(self, query: HyperQuery, file_path: str, count_only: bool = False) -> str:
        posix_p = to_posix_path(file_path)

        if query.raw_sql:
            # User provided explicit SQL
            sql = query.raw_sql.replace(":dataset", f"read_parquet('{posix_p}')")
            if f"read_parquet('{posix_p}')" not in sql and query.dataset in sql:
                sql = sql.replace(query.dataset, f"read_parquet('{posix_p}')")
            return sql

        from_clause = f"read_parquet('{posix_p}')"

        # WHERE conditions
        where_clauses = []
        for f in query.filters:
            col = f'"{f.column}"'
            op = f.operator
            val = f.value

            if op == "equals":
                if isinstance(val, (int, float)):
                    where_clauses.append(f"{col} = {val}")
                else:
                    clean_val = str(val).replace("'", "''")
                    where_clauses.append(f"{col} = '{clean_val}'")
            elif op == "not_equals":
                if isinstance(val, (int, float)):
                    where_clauses.append(f"{col} != {val}")
                else:
                    clean_val = str(val).replace("'", "''")
                    where_clauses.append(f"{col} != '{clean_val}'")
            elif op == "greater_than":
                where_clauses.append(f"{col} > {val}")
            elif op == "greater_than_or_equal":
                where_clauses.append(f"{col} >= {val}")
            elif op == "less_than":
                where_clauses.append(f"{col} < {val}")
            elif op == "less_than_or_equal":
                where_clauses.append(f"{col} <= {val}")
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
                val_strs = [f"'{str(v).replace('\'', '\'\'')}'" if isinstance(v, str) else str(v) for v in val]
                where_clauses.append(f"{col} IN ({', '.join(val_strs)})")
            elif op == "not_in" and isinstance(val, list):
                val_strs = [f"'{str(v).replace('\'', '\'\'')}'" if isinstance(v, str) else str(v) for v in val]
                where_clauses.append(f"{col} NOT IN ({', '.join(val_strs)})")
            elif op == "is_null":
                where_clauses.append(f"{col} IS NULL")
            elif op == "is_not_null":
                where_clauses.append(f"{col} IS NOT NULL")

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

    def execute_query(self, query: HyperQuery, file_path: str) -> Tuple[pa.Table, str, int]:
        # 1. Total matching rows count
        count_sql = self._compile_sql(query, file_path, count_only=True)
        count_cursor = self._con.cursor()
        try:
            res_rows = count_cursor.sql(count_sql).fetchall()
            total_rows = res_rows[0][0] if res_rows and len(res_rows[0]) > 0 else 0
        except Exception:
            total_rows = 0
        finally:
            count_cursor.close()

        # 2. Main data query
        data_cursor = self._con.cursor()
        try:
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
        cursor = self._con.cursor()
        try:
            sql = self._compile_sql(query, file_path, count_only=False)
            res = cursor.sql(f"EXPLAIN ANALYZE {sql}").fetchall()
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
