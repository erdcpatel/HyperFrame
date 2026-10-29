import os
import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from typing import Any
import pyarrow as pa
import duckdb
import polars as pl

from backend.app.models.query import (
    HyperQuery, QueryResponse, AgGridRequest, HyperFilter, HyperSort, QueryWaterfall
)
from backend.app.core.catalog import catalog
from backend.app.core.lifecycle import lifecycle_manager
from backend.app.core.telemetry import telemetry_monitor, QueryProfiler
from backend.app.utils.serialization import arrow_table_to_ipc_bytes, arrow_table_to_dict_list

router = APIRouter(prefix="/api/query", tags=["Query Engine"])

@router.post("/run", response_model=QueryResponse)
def run_query(query: HyperQuery):
    file_path = catalog.get_dataset_path(query.dataset)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"Dataset '{query.dataset}' not registered.")

    profiler = QueryProfiler(telemetry_monitor)
    profiler.mark_compile_done()

    engine = lifecycle_manager.get_engine(query.engine)
    try:
        arrow_table, query_str, total_matching_rows = engine.execute_query(query, file_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Engine execution error: {str(e)}")

    profiler.mark_exec_done()

    columns = arrow_table.column_names
    column_types = {name: str(arrow_table.field(name).type) for name in columns}
    returned_rows = arrow_table.num_rows

    if query.wire_format == "arrow":
        ipc_bytes = arrow_table_to_ipc_bytes(arrow_table)
        profiler.mark_serialize_done()
        waterfall = profiler.build_waterfall()

        headers = {
            "X-HyperFrame-Compile-Ms": str(waterfall.compile_ms),
            "X-HyperFrame-Exec-Ms": str(waterfall.engine_exec_ms),
            "X-HyperFrame-Serialize-Ms": str(waterfall.serialization_ms),
            "X-HyperFrame-Total-Ms": str(waterfall.total_backend_ms),
            "X-HyperFrame-Total-Rows": str(total_matching_rows),
            "X-HyperFrame-Returned-Rows": str(returned_rows),
            "X-HyperFrame-Query": query_str[:500]
        }
        return Response(content=ipc_bytes, media_type="application/vnd.apache.arrow.stream", headers=headers)
    else:
        # JSON format
        row_dicts = arrow_table_to_dict_list(arrow_table)
        profiler.mark_serialize_done()
        waterfall = profiler.build_waterfall()

        return QueryResponse(
            dataset=query.dataset,
            engine=query.engine,
            wire_format=query.wire_format,
            columns=columns,
            column_types=column_types,
            total_matching_rows=total_matching_rows,
            returned_rows=returned_rows,
            offset=query.offset,
            limit=query.limit,
            waterfall=waterfall,
            query_string=query_str,
            data=row_dicts
        )

@router.post("/ag-grid")
def query_ag_grid(req: AgGridRequest):
    """
    Adapter endpoint translating AG Grid Community Infinite Row Model requests
    into a canonical HyperQuery and returning formatted grid rows with telemetry.
    """
    file_path = catalog.get_dataset_path(req.dataset)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"Dataset '{req.dataset}' not registered.")

    # 1. Translate filterModel
    hyper_filters: list[HyperFilter] = list(req.customFilters)
    for col_id, f_data in req.filterModel.items():
        if isinstance(f_data, dict):
            f_type = f_data.get("type", "equals")
            val = f_data.get("filter")
            op_map = {
                "equals": "equals",
                "notEqual": "not_equals",
                "contains": "contains",
                "startsWith": "starts_with",
                "endsWith": "ends_with",
                "greaterThan": "greater_than",
                "greaterThanOrEqual": "greater_than_or_equal",
                "lessThan": "less_than",
                "lessThanOrEqual": "less_than_or_equal"
            }
            mapped_op = op_map.get(f_type, "equals")
            if val is not None:
                hyper_filters.append(HyperFilter(
                    column=col_id,
                    operator=mapped_op,
                    value=val
                ))

    # Apply Quick Search across string columns if provided
    if req.quickSearch and req.quickSearch.strip():
        search_term = req.quickSearch.strip()
        try:
            weather = catalog.get_weather(req.dataset, compute_deep_profiles=False)
            str_cols = [c.name for c in weather.columns if "str" in c.dtype.lower() or "varchar" in c.dtype.lower() or "utf8" in c.dtype.lower()]
            if str_cols:
                # Add contains filter on primary string column
                hyper_filters.append(HyperFilter(
                    column=str_cols[0],
                    operator="contains",
                    value=search_term
                ))
        except Exception:
            pass

    # 2. Translate sortModel
    hyper_sorts: list[HyperSort] = []
    for s in req.sortModel:
        hyper_sorts.append(HyperSort(
            column=s.colId,
            direction=s.sort
        ))

    # 3. Calculate limit and offset
    offset = max(0, req.startRow)
    limit = max(1, req.endRow - req.startRow)

    # 4. Construct HyperQuery
    query = HyperQuery(
        dataset=req.dataset,
        engine=req.engine,
        wire_format="json",
        filters=hyper_filters,
        orderBy=hyper_sorts,
        offset=offset,
        limit=limit
    )

    profiler = QueryProfiler(telemetry_monitor)
    profiler.mark_compile_done()

    engine = lifecycle_manager.get_engine(req.engine)
    try:
        arrow_table, query_str, total_matching_rows = engine.execute_query(query, file_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"AG Grid query error: {str(e)}")

    profiler.mark_exec_done()

    rows = arrow_table_to_dict_list(arrow_table)
    profiler.mark_serialize_done()
    waterfall = profiler.build_waterfall()

    return {
        "rows": rows,
        "totalCount": total_matching_rows,
        "startRow": offset,
        "endRow": offset + len(rows),
        "waterfall": waterfall.model_dump(),
        "query_string": query_str
    }

@router.post("/export")
def export_query_csv(query: HyperQuery):
    """
    Streams filtered/aggregated results to CSV using DuckDB's zero-copy COPY TO or Polars sink_csv.
    """
    file_path = catalog.get_dataset_path(query.dataset)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"Dataset '{query.dataset}' not registered.")

    tmp_export = Path(tempfile.gettempdir()) / f"hyperframe_{query.dataset}_export.csv"
    engine = lifecycle_manager.get_engine(query.engine)
    
    # Query up to 100k rows for export
    export_q = query.model_copy()
    if export_q.limit <= 0 or export_q.limit > 100000:
        export_q.limit = 100000

    arrow_table, _, _ = engine.execute_query(export_q, file_path)
    
    # Write to CSV cleanly
    import pyarrow.csv as pacsv
    pacsv.write_csv(arrow_table, tmp_export)

    return FileResponse(
        path=str(tmp_export),
        filename=f"hyperframe_{query.dataset}_export.csv",
        media_type="text/csv"
    )

@router.post("/explain")
def explain_query(query: HyperQuery):
    file_path = catalog.get_dataset_path(query.dataset)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"Dataset '{query.dataset}' not registered.")

    engine = lifecycle_manager.get_engine(query.engine)
    plan_str = engine.explain(query, file_path)
    return {
        "dataset": query.dataset,
        "engine": query.engine,
        "plan": plan_str
    }
