import os
from pathlib import Path
from pydantic_settings import BaseSettings
from backend.app.utils.paths import get_temp_spill_dir, get_default_data_dir

class Settings(BaseSettings):
    APP_NAME: str = "HyperFrame Ad-Hoc Analytics Studio"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # Workstation Resource Allocations
    DUCKDB_THREADS: int = 8
    DUCKDB_MEMORY_LIMIT: str = "8GB"
    POLARS_MAX_THREADS: int = 8
    
    # Storage Paths
    DATA_DIR: Path = get_default_data_dir()
    SPILL_DIR: Path = get_temp_spill_dir()
    
    # Telemetry Settings
    TELEMETRY_INTERVAL_MS: int = 500
    
    # CORS
    CORS_ORIGINS: list[str] = ["*"]
    
    class Config:
        env_prefix = "HYPERFRAME_"

settings = Settings()
