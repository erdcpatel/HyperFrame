from typing import Any, Optional
from pydantic import BaseModel, Field

class SystemTelemetry(BaseModel):
    timestamp: float
    cpu_percent_total: float
    cpu_percent_per_core: list[float]
    memory_rss_mb: float
    memory_rss_percent: float
    memory_available_mb: float
    active_engine: Optional[str] = None
    active_dataset: Optional[str] = None

class TortureWorkloadResult(BaseModel):
    workload_id: str
    workload_name: str
    description: str
    engine: str
    compile_ms: float
    exec_ms: float
    serialization_ms: float
    total_ms: float
    server_rss_delta_mb: float
    rows_scanned: int
    rows_returned: int
    payload_kb: float
    status: str = "SUCCESS"  # "SUCCESS" | "OOM_FALLBACK" | "ERROR"
    error_message: Optional[str] = None
    plan_summary: Optional[str] = None

class TortureScorecard(BaseModel):
    dataset_id: str
    timestamp: str
    results: list[TortureWorkloadResult] = Field(default_factory=list)
    winner_engine: Optional[str] = None
    summary: str = ""
