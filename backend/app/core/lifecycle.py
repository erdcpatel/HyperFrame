import gc
import logging
from typing import Optional, Dict
from backend.app.engines.base import BaseEngine
from backend.app.engines.duckdb_engine import DuckDBEngine
from backend.app.engines.polars_engine import PolarsEngine
from backend.app.engines.perspective_engine import PerspectiveEngine
from backend.app.core.telemetry import telemetry_monitor
from backend.app.config import settings

logger = logging.getLogger("hyperframe.lifecycle")

class EngineLifecycleManager:
    def __init__(self):
        self._engines: Dict[str, BaseEngine] = {
            "duckdb": DuckDBEngine(),
            "polars": PolarsEngine(),
            "perspective": PerspectiveEngine()
        }
        initial_engine = getattr(settings, "DEFAULT_ENGINE", "duckdb").lower().strip()
        self._active_engine_name: str = initial_engine if initial_engine in self._engines else "duckdb"
        self._active_dataset_id: Optional[str] = None

    @property
    def active_engine_name(self) -> str:
        return self._active_engine_name

    @property
    def active_dataset_id(self) -> Optional[str]:
        return self._active_dataset_id

    def get_engine(self, engine_name: Optional[str] = None) -> BaseEngine:
        target = engine_name or self._active_engine_name
        if target not in self._engines:
            raise ValueError(f"Unknown engine: '{target}'. Available: {list(self._engines.keys())}")
        return self._engines[target]

    def activate_engine(self, engine_name: str, dataset_id: Optional[str] = None) -> BaseEngine:
        """
        Switches the active engine with Lazy Hydration Lifecycle rules:
        If switching away from a memory-holding engine (like perspective),
        we explicitly unload it and trigger garbage collection.
        """
        if engine_name not in self._engines:
            raise ValueError(f"Cannot activate unknown engine: '{engine_name}'")

        if self._active_engine_name != engine_name:
            logger.info(f"Switching engine from {self._active_engine_name} to {engine_name}")
            prev_engine = self._engines[self._active_engine_name]
            prev_engine.unload()
            gc.collect()
            self._active_engine_name = engine_name

        if dataset_id:
            self._active_dataset_id = dataset_id

        return self._engines[self._active_engine_name]

    def force_unload_all(self) -> float:
        """
        Purges memory in all engines and forces full garbage collection.
        Returns the RSS memory in MB after purge.
        """
        for engine in self._engines.values():
            try:
                engine.unload()
            except Exception as e:
                logger.error(f"Error unloading engine {engine.name}: {e}")
        gc.collect()
        return telemetry_monitor.get_current_rss_mb()

lifecycle_manager = EngineLifecycleManager()
