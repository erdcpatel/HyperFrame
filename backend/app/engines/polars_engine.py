import os
import logging
import polars as pl
import pyarrow as pa
from typing import Tuple, Any, Optional
from backend.app.engines.base import BaseEngine
from backend.app.models.query import HyperQuery
from backend.app.utils.paths import to_posix_path

logger = logging.getLogger("hyperframe.polars")

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
            return pl.scan_parquet(file_path, storage_options=storage_options, hive_partitioning=True)
        else:
            posix_p = to_posix_path(file_path)
            return pl.scan_parquet(posix_p, hive_partitioning=True)

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
            # Deduplicate group_by column names
            if query.groupBy:
                seen_grp = set()
                unique_group_by = [c for c in query.groupBy if not (c in seen_grp or seen_grp.add(c))]
            else:
                unique_group_by = []

            used_aliases = set(unique_group_by)
            agg_exprs = []
            for agg in query.aggregations:
                base_alias = agg.alias or f"{agg.function}_{agg.column}"
                alias = base_alias
                counter = 1
                while alias in used_aliases:
                    alias = f"{base_alias}_{counter}"
                    counter += 1
                used_aliases.add(alias)

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

            if unique_group_by:
                lf = lf.group_by(unique_group_by).agg(agg_exprs)
            else:
                lf = lf.select(agg_exprs)
        elif query.select:
            # Deduplicate select column names while preserving order
            seen_sel = set()
            unique_select = [c for c in query.select if not (c in seen_sel or seen_sel.add(c))]
            lf = lf.select([pl.col(c) for c in unique_select])

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
                import re
                sql = re.sub(r"read_parquet\([^)]*\)", "data", sql, flags=re.IGNORECASE)
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
        # Ultra-fast path: If single local file and no filters/grouping, read total rows from Parquet metadata in 0.001 ms!
        total_rows = None
        if not file_path.startswith("s3://") and "*" not in posix_p and not os.path.isdir(posix_p) and not query.filters and not query.groupBy:
            try:
                import pyarrow.parquet as pq
                total_rows = pq.ParquetFile(posix_p).metadata.num_rows
            except Exception:
                total_rows = None

        if total_rows is None:
            count_lf = self._build_lazy_plan(query, file_path, count_only=True)
            try:
                count_df = count_lf.collect()
                total_rows = int(count_df["total_count"][0])
            except Exception as e:
                logger.error(f"Polars count query failed: {e}")
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
                import re
                sql = re.sub(r"read_parquet\([^)]*\)", "data", sql, flags=re.IGNORECASE)
                clean_sql = sql.rstrip("; \t\n")
                if clean_sql.lower().startswith("explain"):
                    clean_sql = clean_sql[7:].strip()
                return ctx.execute(clean_sql).explain()

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
