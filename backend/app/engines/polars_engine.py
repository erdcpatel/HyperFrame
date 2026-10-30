import polars as pl
import pyarrow as pa
from typing import Tuple, Any, Optional
from backend.app.engines.base import BaseEngine
from backend.app.models.query import HyperQuery
from backend.app.utils.paths import to_posix_path

def _coerce_polars_val(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (int, float, bool)):
        return val
    s = str(val).strip()
    try:
        if "." in s:
            return float(s)
        return int(s)
    except ValueError:
        return s

class PolarsEngine(BaseEngine):
    def __init__(self):
        pass

    @property
    def name(self) -> str:
        return "polars"

    def _scan_parquet(self, file_path: str, dataset_id: str) -> pl.LazyFrame:
        if file_path.startswith("s3://"):
            from backend.app.core.catalog import catalog
            from backend.app.core.s3_manager import s3_manager
            cat_entry = catalog._read_catalog().get(dataset_id, {})
            profile_id = cat_entry.get("s3_profile_id")
            storage_options = None
            if profile_id:
                profile = s3_manager.get_profile(profile_id)
                if profile:
                    storage_options = {
                        "aws_region": profile.region
                    }
                    if profile.access_key_id and profile.secret_access_key and profile.access_key_id not in ["IAM_ROLE", "DEFAULT"]:
                        storage_options["aws_access_key_id"] = profile.access_key_id
                        storage_options["aws_secret_access_key"] = profile.secret_access_key
                    if not profile.use_ssl:
                        storage_options["aws_use_ssl"] = "false"
                        storage_options["aws_allow_http"] = "true"
                    if profile.endpoint_url:
                        storage_options["aws_endpoint"] = profile.endpoint_url
            return pl.scan_parquet(file_path, storage_options=storage_options)
        else:
            posix_p = to_posix_path(file_path)
            return pl.scan_parquet(posix_p)

    def _build_lazy_plan(self, query: HyperQuery, file_path: str, count_only: bool = False) -> pl.LazyFrame:
        lf = self._scan_parquet(file_path, query.dataset)

        # Filters
        predicates = []
        for f in query.filters:
            col_expr = pl.col(f.column)
            op = f.operator
            val = _coerce_polars_val(f.value)

            if op == "equals":
                predicates.append(col_expr == val)
            elif op == "not_equals":
                predicates.append(col_expr != val)
            elif op == "greater_than":
                predicates.append(col_expr > val)
            elif op == "greater_than_or_equal":
                predicates.append(col_expr >= val)
            elif op == "less_than":
                predicates.append(col_expr < val)
            elif op == "less_than_or_equal":
                predicates.append(col_expr <= val)
            elif op == "contains":
                predicates.append(col_expr.cast(pl.Utf8).str.contains(str(f.value), literal=True))
            elif op == "starts_with":
                predicates.append(col_expr.cast(pl.Utf8).str.starts_with(str(f.value)))
            elif op == "ends_with":
                predicates.append(col_expr.cast(pl.Utf8).str.ends_with(str(f.value)))
            elif op == "in" and isinstance(f.value, list):
                coerced_list = [_coerce_polars_val(x) for x in f.value]
                predicates.append(col_expr.is_in(coerced_list))
            elif op == "not_in" and isinstance(f.value, list):
                coerced_list = [_coerce_polars_val(x) for x in f.value]
                predicates.append(~col_expr.is_in(coerced_list))
            elif op == "is_null":
                predicates.append(col_expr.is_null())
            elif op == "is_not_null":
                predicates.append(col_expr.is_not_null())

        # Global multi-column quick search across all text columns
        if query.quick_search and query.quick_search.strip():
            schema = lf.collect_schema()
            str_cols = [name for name, dtype in schema.items() if dtype in [pl.Utf8, pl.String, pl.Categorical]]
            if str_cols:
                concat_expr = pl.concat_str([pl.col(c).cast(pl.Utf8).fill_null("") for c in str_cols], separator=" ")
                predicates.append(concat_expr.str.contains(query.quick_search.strip(), literal=True))

        for p in predicates:
            lf = lf.filter(p)

        if count_only:
            return lf.select(pl.len().alias("total_count"))

        # Aggregations / Group By
        if query.aggregations:
            agg_exprs = []
            for agg in query.aggregations:
                alias = agg.alias or f"{agg.function}_{agg.column}"
                c = pl.col(agg.column)
                if agg.function == "sum":
                    agg_exprs.append(c.sum().alias(alias))
                elif agg.function == "avg":
                    agg_exprs.append(c.mean().alias(alias))
                elif agg.function == "min":
                    agg_exprs.append(c.min().alias(alias))
                elif agg.function == "max":
                    agg_exprs.append(c.max().alias(alias))
                elif agg.function == "count":
                    agg_exprs.append(c.count().alias(alias))
                elif agg.function == "approx_count_distinct":
                    agg_exprs.append(c.n_unique().alias(alias))

            if query.groupBy:
                lf = lf.group_by(query.groupBy).agg(agg_exprs)
            else:
                lf = lf.select(agg_exprs)
        elif query.select:
            # Projection pushdown
            lf = lf.select([pl.col(c) for c in query.select])

        # Sort
        if query.orderBy:
            cols = [s.column for s in query.orderBy]
            desc = [s.direction == "desc" for s in query.orderBy]
            lf = lf.sort(by=cols, descending=desc)

        # Slice / Pagination
        if query.limit > 0:
            lf = lf.slice(query.offset, query.limit)

        return lf

    def execute_query(self, query: HyperQuery, file_path: str) -> Tuple[pa.Table, str, int]:
        posix_p = file_path if file_path.startswith("s3://") else to_posix_path(file_path)

        # Path A: Raw SQL execution via scoped SQLContext
        if query.raw_sql:
            base_lf = self._scan_parquet(file_path, query.dataset)
            with pl.SQLContext() as ctx:
                ctx.register("data", base_lf)
                if query.dataset:
                    ctx.register(query.dataset, base_lf)
                sql = query.raw_sql.replace(":dataset", "data")
                if f"read_parquet('{posix_p}')" in sql:
                    sql = sql.replace(f"read_parquet('{posix_p}')", "data")
                clean_sql = sql.rstrip("; \t\n")

                count_sql = f"SELECT COUNT(*) AS total_count FROM ({clean_sql}) AS _raw_count_subq"
                try:
                    count_df = ctx.execute(count_sql).collect()
                    total_rows = int(count_df["total_count"][0])
                except Exception:
                    total_rows = 0

                data_lf = ctx.execute(clean_sql)
                try:
                    plan_str = data_lf.explain()
                except Exception:
                    plan_str = "Polars SQL Lazy Plan"

                df = data_lf.collect()
                return df.to_arrow(), plan_str, total_rows

        # Path B: Canonical HyperQuery execution with streaming engine
        # 1. Total matching count
        # Ultra-fast path: If local file and no filters/grouping, read total rows from Parquet metadata in 0.001 ms!
        if not file_path.startswith("s3://") and not query.filters and not query.groupBy:
            try:
                import pyarrow.parquet as pq
                total_rows = pq.ParquetFile(posix_p).metadata.num_rows
            except Exception:
                total_rows = 0
        else:
            count_lf = self._build_lazy_plan(query, file_path, count_only=True)
            try:
                count_df = count_lf.collect()
                total_rows = int(count_df["total_count"][0])
            except Exception:
                total_rows = 0

        # 2. Main data execution
        data_lf = self._build_lazy_plan(query, file_path, count_only=False)
        try:
            plan_str = data_lf.explain(engine="streaming")
        except Exception:
            try:
                plan_str = data_lf.explain()
            except Exception:
                plan_str = "Polars Lazy Execution Plan"

        # Execute using streaming engine if supported
        try:
            df = data_lf.collect(engine="streaming")
        except TypeError:
            # Fallback for polars versions without engine parameter
            try:
                df = data_lf.collect(streaming=True)
            except Exception:
                df = data_lf.collect()
        except Exception:
            df = data_lf.collect()

        arrow_table = df.to_arrow()
        return arrow_table, plan_str, total_rows

    def explain(self, query: HyperQuery, file_path: str) -> str:
        if query.raw_sql:
            posix_p = file_path if file_path.startswith("s3://") else to_posix_path(file_path)
            base_lf = self._scan_parquet(file_path, query.dataset)
            with pl.SQLContext() as ctx:
                ctx.register("data", base_lf)
                if query.dataset:
                    ctx.register(query.dataset, base_lf)
                sql = query.raw_sql.replace(":dataset", "data")
                if f"read_parquet('{posix_p}')" in sql:
                    sql = sql.replace(f"read_parquet('{posix_p}')", "data")
                return ctx.execute(sql.rstrip("; \t\n")).explain()

        lf = self._build_lazy_plan(query, file_path, count_only=False)
        try:
            return lf.explain(engine="streaming")
        except Exception:
            try:
                return lf.explain()
            except Exception as e:
                return f"Polars plan explain: {str(e)}"

    def unload(self) -> None:
        # Polars lazy frames are stateless and deallocated on garbage collection
        pass
