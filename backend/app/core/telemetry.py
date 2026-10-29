import os
import time
import psutil
from typing import Optional
from backend.app.models.telemetry import SystemTelemetry
from backend.app.models.query import QueryWaterfall

class TelemetryMonitor:
    def __init__(self):
        self._process = psutil.Process(os.getpid())
        # Prime psutil cpu measurement
        self._process.cpu_percent(interval=None)
        psutil.cpu_percent(interval=None, percpu=True)

    def get_system_snapshot(self, active_engine: Optional[str] = None, active_dataset: Optional[str] = None) -> SystemTelemetry:
        mem = psutil.virtual_memory()
        proc_mem = self._process.memory_info()
        rss_mb = proc_mem.rss / (1024 * 1024)
        
        per_core = psutil.cpu_percent(interval=None, percpu=True)
        total_cpu = psutil.cpu_percent(interval=None)

        return SystemTelemetry(
            timestamp=time.time(),
            cpu_percent_total=total_cpu,
            cpu_percent_per_core=per_core,
            memory_rss_mb=round(rss_mb, 2),
            memory_rss_percent=round(self._process.memory_percent(), 2),
            memory_available_mb=round(mem.available / (1024 * 1024), 2),
            active_engine=active_engine,
            active_dataset=active_dataset
        )

    def get_current_rss_mb(self) -> float:
        return round(self._process.memory_info().rss / (1024 * 1024), 2)

class QueryProfiler:
    """
    Context helper to capture sub-millisecond execution and memory telemetry
    across query compile, execution, and serialization phases.
    """
    def __init__(self, monitor: TelemetryMonitor):
        self.monitor = monitor
        self.rss_before_mb = monitor.get_current_rss_mb()
        self.t_start = time.perf_counter()
        self.t_compile_end = self.t_start
        self.t_exec_end = self.t_start
        self.t_serialize_end = self.t_start

    def mark_compile_done(self):
        self.t_compile_end = time.perf_counter()

    def mark_exec_done(self):
        self.t_exec_end = time.perf_counter()

    def mark_serialize_done(self):
        self.t_serialize_end = time.perf_counter()

    def build_waterfall(self) -> QueryWaterfall:
        rss_after_mb = self.monitor.get_current_rss_mb()
        compile_ms = max(0.0, (self.t_compile_end - self.t_start) * 1000)
        exec_ms = max(0.0, (self.t_exec_end - self.t_compile_end) * 1000)
        serialize_ms = max(0.0, (self.t_serialize_end - self.t_exec_end) * 1000)
        total_ms = max(0.0, (self.t_serialize_end - self.t_start) * 1000)

        return QueryWaterfall(
            compile_ms=round(compile_ms, 2),
            engine_exec_ms=round(exec_ms, 2),
            serialization_ms=round(serialize_ms, 2),
            total_backend_ms=round(total_ms, 2),
            rss_before_mb=self.rss_before_mb,
            rss_after_mb=rss_after_mb,
            rss_delta_mb=round(rss_after_mb - self.rss_before_mb, 2),
            cpu_percent=round(self.monitor._process.cpu_percent(interval=None), 1)
        )

telemetry_monitor = TelemetryMonitor()
