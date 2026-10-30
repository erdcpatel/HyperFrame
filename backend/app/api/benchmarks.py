import asyncio
import json
import threading
import time
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
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

class TortureStateManager:
    def __init__(self):
        self._lock = threading.Lock()
        self.is_running = False
        self.dataset_id: Optional[str] = None
        self.engines: list[str] = []
        self.total_workloads = 0
        self.completed_workloads = 0
        self.current_step = ""
        self.partial_results: list[TortureWorkloadResult] = []
        self.latest_scorecard: Optional[TortureScorecard] = None
        self._listeners: list[asyncio.Queue] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def get_status(self) -> dict:
        with self._lock:
            pct = int((self.completed_workloads / max(1, self.total_workloads)) * 100) if self.is_running else (100 if self.latest_scorecard else 0)
            return {
                "is_running": self.is_running,
                "dataset_id": self.dataset_id,
                "engines": self.engines,
                "total_workloads": self.total_workloads,
                "completed_workloads": self.completed_workloads,
                "progress_pct": min(100, pct),
                "current_step": self.current_step,
                "results": [r.model_dump() for r in self.partial_results],
                "scorecard": self.latest_scorecard.model_dump() if self.latest_scorecard else None
            }

    def register_listener(self) -> asyncio.Queue:
        q = asyncio.Queue()
        with self._lock:
            self._listeners.append(q)
        return q

    def remove_listener(self, q: asyncio.Queue):
        with self._lock:
            if q in self._listeners:
                self._listeners.remove(q)

    def broadcast(self, event_type: str, data: dict):
        with self._lock:
            listeners = list(self._listeners)
            loop = self._loop
        
        msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        for q in listeners:
            if loop and loop.is_running():
                try:
                    loop.call_soon_threadsafe(q.put_nowait, msg)
                except Exception:
                    pass
            else:
                try:
                    q.put_nowait(msg)
                except Exception:
                    pass

torture_manager = TortureStateManager()

def _build_workload_specs(dataset_id: str, weather):
    # Dynamically pick columns based on dataset schema
    str_cols = [c for c in weather.columns if any(t in c.dtype.lower() for t in ["str", "varchar", "utf8", "text", "char"])]
    if str_cols:
        cat_c = next((c for c in str_cols if c.name.lower() in ["symbol", "desk", "region", "status", "category", "type", "city", "country"]), str_cols[0])
        sym_col = cat_c.name
        needle_val = cat_c.min_value if cat_c.min_value else "NVDA"
    else:
        sym_col = weather.columns[0].name
        needle_val = weather.columns[0].min_value or "1"

    # Metric column: ensure it is truly numeric so SUM() functions don't fail
    num_cols = [c for c in weather.columns if any(t in c.dtype.lower() for t in ["int", "float", "double", "decimal", "numeric", "real", "long"])]
    if num_cols:
        metric_c = next((c for c in num_cols if c.name.lower() in ["notional", "price", "amount", "revenue", "execution_latency_ms", "value", "cost", "total", "sales"]), num_cols[-1])
        num_col = metric_c.name
        agg_func = "sum"
    else:
        num_col = sym_col
        agg_func = "count"

    # ID column and High Cardinality column
    id_col = next((c.name for c in weather.columns if any(k in c.name.lower() for k in ["id", "key", "code", "index"])), weather.columns[0].name)
    sorted_by_card = sorted(weather.columns, key=lambda c: getattr(c, "approx_unique", 0), reverse=True)
    high_card_col = sorted_by_card[0].name if sorted_by_card else id_col

    # Construct strictly unique projection list (prevents Polars DuplicateError on datasets with overlapping roles)
    distinct_select: list[str] = []
    for c_candidate in [id_col, sym_col, num_col]:
        if c_candidate and c_candidate not in distinct_select:
            distinct_select.append(c_candidate)
    for col in weather.columns:
        if len(distinct_select) >= 3 or len(distinct_select) >= len(weather.columns):
            break
        if col.name not in distinct_select:
            distinct_select.append(col.name)

    # Prevent alias collisions with group-by columns
    w3_total_alias = "total_val" if sym_col != "total_val" else "sum_metric"
    w3_count_alias = "row_count" if sym_col != "row_count" else "count_total"

    w4_total_alias = "total_val" if high_card_col != "total_val" else "sum_metric"
    w4_count_alias = "row_count" if high_card_col != "row_count" else "count_total"

    return [
        {
            "id": "workload_1_needle",
            "name": "1. Needle in Haystack",
            "description": f"Filtered scan on {sym_col} with projection",
            "query": HyperQuery(
                dataset=dataset_id,
                select=distinct_select,
                filters=[HyperFilter(column=sym_col, operator="contains", value=needle_val)],
                limit=100
            )
        },
        {
            "id": "workload_2_multisort",
            "name": "2. Multi-Column Sort",
            "description": f"Global sort on {num_col} DESC",
            "query": HyperQuery(
                dataset=dataset_id,
                select=distinct_select,
                orderBy=[HyperSort(column=num_col, direction="desc")],
                limit=200
            )
        },
        {
            "id": "workload_3_low_pivot",
            "name": "3. Low-Card Pivot",
            "description": f"Group by {sym_col} with {agg_func.upper()}({num_col}) and COUNT({id_col})",
            "query": HyperQuery(
                dataset=dataset_id,
                groupBy=[sym_col],
                aggregations=[
                    HyperAggregation(column=num_col, function=agg_func, alias=w3_total_alias),
                    HyperAggregation(column=id_col, function="count", alias=w3_count_alias)
                ],
                orderBy=[HyperSort(column=w3_total_alias, direction="desc")],
                limit=50
            )
        },
        {
            "id": "workload_4_high_card",
            "name": "4. High-Card Explosion",
            "description": f"Group by {high_card_col} (stress hash tables & spill memory)",
            "query": HyperQuery(
                dataset=dataset_id,
                groupBy=[high_card_col],
                aggregations=[
                    HyperAggregation(column=num_col, function=agg_func, alias=w4_total_alias),
                    HyperAggregation(column=id_col, function="count", alias=w4_count_alias)
                ],
                limit=200
            )
        },
        {
            "id": "workload_5_scroll_thrash",
            "name": "5. Scroll Thrash (5 Pages)",
            "description": "Sequential paginated fetches (offset 0 -> 400)",
            "query": HyperQuery(
                dataset=dataset_id,
                select=distinct_select,
                limit=100,
                offset=400
            )
        }
    ]

def _run_suite_job(req: TortureRequest):
    file_path = catalog.get_dataset_path(req.dataset_id)
    if not file_path:
        with torture_manager._lock:
            torture_manager.is_running = False
            torture_manager.current_step = f"Error: Dataset '{req.dataset_id}' not found."
        torture_manager.broadcast("error", {"detail": f"Dataset '{req.dataset_id}' not found."})
        return

    weather = catalog.get_weather(req.dataset_id, compute_deep_profiles=False)
    workload_specs = _build_workload_specs(req.dataset_id, weather)
    total_steps = len(req.engines) * len(workload_specs)

    with torture_manager._lock:
        torture_manager.is_running = True
        torture_manager.dataset_id = req.dataset_id
        torture_manager.engines = list(req.engines)
        torture_manager.total_workloads = total_steps
        torture_manager.completed_workloads = 0
        torture_manager.partial_results = []
        torture_manager.latest_scorecard = None

    results: list[TortureWorkloadResult] = []

    for eng_name in req.engines:
        engine = lifecycle_manager.get_engine(eng_name)

        for w in workload_specs:
            step_name = f"Testing {eng_name.upper()}: {w['name']}"
            with torture_manager._lock:
                torture_manager.current_step = step_name

            torture_manager.broadcast("progress", {
                "current_step": step_name,
                "completed": len(results),
                "total": total_steps,
                "progress_pct": int((len(results) / max(1, total_steps)) * 100)
            })

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

            r = TortureWorkloadResult(
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
            )
            results.append(r)

            with torture_manager._lock:
                torture_manager.partial_results.append(r)
                torture_manager.completed_workloads = len(results)

            torture_manager.broadcast("workload_done", {
                "result": r.model_dump(),
                "completed": len(results),
                "total": total_steps,
                "progress_pct": int((len(results) / max(1, total_steps)) * 100),
                "current_step": step_name
            })

    # Scorecard calculation
    engine_scores: dict[str, float] = {}
    for r in results:
        if r.status == "SUCCESS":
            engine_scores[r.engine] = engine_scores.get(r.engine, 0.0) + r.total_ms
        else:
            engine_scores[r.engine] = engine_scores.get(r.engine, 0.0) + 99999.0

    winner = min(engine_scores, key=engine_scores.get) if engine_scores else None

    scorecard = TortureScorecard(
        dataset_id=req.dataset_id,
        timestamp=datetime.now().isoformat(),
        results=results,
        winner_engine=winner,
        summary=f"Torture benchmark completed across {len(req.engines)} engines with {len(workload_specs)} standard workloads."
    )

    with torture_manager._lock:
        torture_manager.is_running = False
        torture_manager.latest_scorecard = scorecard
        torture_manager.current_step = "Completed"

    torture_manager.broadcast("complete", {
        "scorecard": scorecard.model_dump()
    })

@router.get("/torture/status")
def get_torture_status():
    """
    Returns the real-time background execution status or latest cached scorecard.
    Allows closing the modal and retrieving results anytime without re-running.
    """
    return torture_manager.get_status()

@router.post("/torture/start")
def start_torture_background(req: TortureRequest):
    """
    Kicks off the Torture Benchmark Suite in an independent background worker thread.
    Returns immediately so the user can freely navigate or close the modal.
    """
    with torture_manager._lock:
        if torture_manager.is_running:
            return {"status": "already_running", "message": "A torture benchmark run is currently in progress."}

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    torture_manager._loop = loop

    thread = threading.Thread(target=_run_suite_job, args=(req,), daemon=True)
    thread.start()

    return {
        "status": "started",
        "dataset_id": req.dataset_id,
        "engines": req.engines
    }

@router.get("/torture/stream")
async def stream_torture_progress(request: Request):
    """
    Server-Sent Events (SSE) stream providing real-time progress, live step updates,
    and row-by-row scorecard updates as each workload finishes.
    """
    q = torture_manager.register_listener()

    async def event_generator():
        try:
            # Yield initial snapshot
            status = torture_manager.get_status()
            yield f"event: init\ndata: {json.dumps(status)}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=1.0)
                    yield msg
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat
                    yield ": keepalive\n\n"
        finally:
            torture_manager.remove_listener(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post("/torture", response_model=TortureScorecard)
def run_torture_suite(req: TortureRequest):
    """
    Synchronous fallback endpoint that runs the suite and returns the scorecard.
    """
    _run_suite_job(req)
    if torture_manager.latest_scorecard:
        return torture_manager.latest_scorecard
    raise HTTPException(status_code=500, detail="Torture suite run failed.")
