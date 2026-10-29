from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal
from backend.app.core.lifecycle import lifecycle_manager
from backend.app.core.telemetry import telemetry_monitor

router = APIRouter(prefix="/api/engines", tags=["Engines Lifecycle"])

class EngineActivationRequest(BaseModel):
    engine: Literal["duckdb", "polars", "perspective"]
    dataset_id: Optional[str] = None

@router.get("")
def get_engines_status():
    return {
        "active_engine": lifecycle_manager.active_engine_name,
        "active_dataset": lifecycle_manager.active_dataset_id,
        "available_engines": ["duckdb", "polars", "perspective"],
        "server_rss_mb": telemetry_monitor.get_current_rss_mb()
    }

@router.post("/activate")
def activate_engine(req: EngineActivationRequest):
    try:
        lifecycle_manager.activate_engine(req.engine, req.dataset_id)
        return {
            "status": "success",
            "active_engine": lifecycle_manager.active_engine_name,
            "server_rss_mb": telemetry_monitor.get_current_rss_mb()
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/purge")
def force_purge_memory():
    rss_after = lifecycle_manager.force_unload_all()
    return {
        "status": "success",
        "message": "All engine in-memory state purged and garbage collection completed.",
        "server_rss_mb": rss_after
    }
