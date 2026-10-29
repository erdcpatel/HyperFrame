from typing import Any, Optional
from pydantic import BaseModel, Field

class ColumnWeather(BaseModel):
    name: str
    dtype: str
    null_count: int = 0
    null_percentage: float = 0.0
    approx_unique: int = 0
    min_value: Optional[Any] = None
    max_value: Optional[Any] = None
    q25: Optional[Any] = None
    q50: Optional[Any] = None
    q75: Optional[Any] = None

class DatasetWeather(BaseModel):
    dataset_id: str
    file_name: str
    path: str
    file_size_bytes: int
    file_size_formatted: str
    row_count: int
    column_count: int
    row_groups: int = 1
    est_uncompressed_bytes: int = 0
    est_uncompressed_formatted: str = "0 MB"
    compression_ratio: float = 1.0
    columns: list[ColumnWeather] = Field(default_factory=list)

class DatasetRegistration(BaseModel):
    dataset_id: str
    file_path: Optional[str] = None
    description: Optional[str] = None

class DatasetSummary(BaseModel):
    dataset_id: str
    file_name: str
    row_count: int
    column_count: int
    file_size_formatted: str
    created_at: str
