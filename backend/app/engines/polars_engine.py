import polars as pl
import pyarrow as pa
from typing import Tuple, Any, Optional
from backend.app.engines.base import BaseEngine
from backend.app.models.query import HyperQuery
from backend.app.utils.paths import to_posix_path

class PolarsEngine(BaseEngine):
    def __init__(self):
        pass

    @property
    def name(self) -> str:
        return "polars"

    def _build_lazy_plan(self, query: HyperQuery, file_path: str, count_only: bool = False) -> pl.LazyFrame:
        posix_p = to_posix_path(file_path)
        lf = pl.scan_parquet(posix_p)

        # Filters
        predicates = []
        for f in query.filters:
            col_expr = pl.col(f.column)
            op = f.operator
            val = f.value

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
                predicates.append(col_expr.cast(pl.Utf8).str.contains(str(val), literal=False))
            elif op == "starts_with":
                predicates.append(col_expr.cast(pl.Utf8).str.starts_with(str(val)))
            elif op == "ends_with":
                predicates.append(col_expr.cast(pl.Utf8).str.ends_with(str(val)))
            elif op == "in" and isinstance(val, list):
                predicates.append(col_expr.is_in(val))
            elif op == "not_in" and isinstance(val, list):
                predicates.append(~col_expr.is_in(val))
            elif op == "is_null":
                predicates.append(col_expr.is_null())
            elif op == "is_not_null":
                predicates.append(col_expr.is_not_null())

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
        # 1. Total matching count
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
