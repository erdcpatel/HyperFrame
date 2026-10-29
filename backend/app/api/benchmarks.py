import time
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal

from backend.app.core.catalog import catalog
from backend.app.core.lifecycle import lifecycle_manager
from backend.app.core.telemetry import telemetry_monitor, QueryProfiler
from backend.app.models.query import HyperQuery, HyperFilter, HyperSort, HyperAggregation
from backend.app.models.telemetry import TortureWorkloadResult, TortureScorecard
from backend.app.utils.serialization import arrow_table_to_ipc_bytes

router = APIRouter(prefix="/api/benchmarks", tags=["Benchmarks"])

class TortureRequest(BaseModel):
    dataset_id: str
    engines: list[Literal["duckdb", "polars", "perspective"]] = ["duckdb", "polars"]

@router.post("/torture", response_model=TortureScorecard)
def run_torture_suite(req: TortureRequest):
    file_path = catalog.get_dataset_path(req.dataset_id)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"Dataset '{req.dataset_id}' not found.")

    weather = catalog.get_weather(req.dataset_id, compute_deep_profiles=False)
    col_names = [c.name for c in weather.columns]

    # Dynamically pick columns based on dataset schema
    sym_col = next((c for c in ["symbol", "desk", "region", "status"] if c in col_names), col_names[0])
    num_col = next((c for c in ["notional", "price", "amount", "revenue", "execution_latency_ms"] if c in col_names), col_names[1] if len(col_names) > 1 else col_names[0])
    id_col = next((c for c in ["trade_id", "id", "order_id", "trader_id"] if c in col_names), col_names[0])
    high_card_col = next((c for c in ["account_id", "trader_id", "user_id", "customer_id"] if c in col_names), id_col)

    results: list[TortureWorkloadResult] = []

    workload_specs = [
        {
            "id": "workload_1_needle",
            "name": "1. Needle in Haystack",
            "description": f"Filtered scan on {sym_col} with projection",
            "query": HyperQuery(
                dataset=req.dataset_id,
                select=[id_col, sym_col, num_col],
                filters=[HyperFilter(column=sym_col, operator="contains", value="NVDA")],
                limit=100
            )
        },
        {
            "id": "workload_2_multisort",
            "name": "2. Multi-Column Sort",
            "description": f"Global sort on {num_col} DESC",
            "query": HyperQuery(
                dataset=req.dataset_id,
                select=[id_col, sym_col, num_col],
                orderBy=[HyperSort(column=num_col, direction="desc")],
                limit=200
            )
        },
        {
            "id": "workload_3_low_pivot",
            "name": "3. Low-Card Pivot",
            "description": f"Group by {sym_col} with SUM({num_col}) and COUNT({id_col})",
            "query": HyperQuery(
                dataset=req.dataset_id,
                groupBy=[sym_col],
                aggregations=[
                    HyperAggregation(column=num_col, function="sum", alias="total_val"),
                    HyperAggregation(column=id_col, function="count", alias="row_count")
                ],
                orderBy=[HyperSort(column="total_val", direction="desc")],
                limit=50
            )
        },
        {
            "id": "workload_4_high_card",
            "name": "4. High-Card Explosion",
            "description": f"Group by {high_card_col} (stress hash tables & spill memory)",
            "query": HyperQuery(
                dataset=req.dataset_id,
                groupBy=[high_card_col],
                aggregations=[
                    HyperAggregation(column=num_col, function="sum", alias="total_val"),
                    HyperAggregation(column=id_col, function="count", alias="row_count")
                ],
                limit=200
            )
        },
        {
            "id": "workload_5_scroll_thrash",
            "name": "5. Scroll Thrash (5 Pages)",
            "description": "Sequential paginated fetches (offset 0 -> 400)",
            "query": HyperQuery(
                dataset=req.dataset_id,
                select=[id_col, sym_col, num_col],
                limit=100,
                offset=400
            )
        }
    ]

    for eng_name in req.engines:
        engine = lifecycle_manager.get_engine(eng_name)

        for w in workload_specs:
            q: HyperQuery = w["query"].model_copy()
            q.engine = eng_name

            profiler = QueryProfiler(telemetry_monitor)
            profiler.mark_compile_done()

            status = "SUCCESS"
            err_msg = None
            plan_summary = None
            rows_scanned = weather.row_count
            rows_returned = 0
            payload_kb = 0.0

            try:
                arrow_tbl, query_str, total_matching = engine.execute_query(q, file_path)
                profiler.mark_exec_done()

                ipc_bytes = arrow_table_to_ipc_bytes(arrow_tbl)
                profiler.mark_serialize_done()

                rows_returned = arrow_tbl.num_rows
                payload_kb = round(len(ipc_bytes) / 1024, 2)
                plan_summary = query_str[:120]
            except Exception as e:
                profiler.mark_exec_done()
                profiler.mark_serialize_done()
                status = "ERROR"
                err_msg = str(e)

            waterfall = profiler.build_waterfall()

            results.append(TortureWorkloadResult(
                workload_id=w["id"],
                workload_name=w["name"],
                description=w["description"],
                engine=eng_name,
                compile_ms=waterfall.compile_ms,
                exec_ms=waterfall.engine_exec_ms,
                serialization_ms=waterfall.serialization_ms,
                total_ms=waterfall.total_backend_ms,
                server_rss_delta_mb=waterfall.rss_delta_mb,
                rows_scanned=rows_scanned,
                rows_returned=rows_returned,
                payload_kb=payload_kb,
                status=status,
                error_message=err_msg,
                plan_summary=plan_summary
            ))

    # Determine overall winner
    engine_scores: dict[str, float] = {}
    for r in results:
        if r.status == "SUCCESS":
            engine_scores[r.engine] = engine_scores.get(r.engine, 0.0) + r.total_ms
        else:
            engine_scores[r.engine] = engine_scores.get(r.engine, 0.0) + 99999.0

    winner = min(engine_scores, key=engine_scores.get) if engine_scores else None

    return TortureScorecard(
        dataset_id=req.dataset_id,
        timestamp=datetime.now().isoformat(),
        results=results,
        winner_engine=winner,
        summary=f"Torture benchmark completed across {len(req.engines)} engines with {len(workload_specs)} standard workloads."
    )
