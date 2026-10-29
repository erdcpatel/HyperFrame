from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

FilterOperator = Literal[
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
    "contains",
    "starts_with",
    "ends_with",
    "in",
    "not_in",
    "is_null",
    "is_not_null",
]

SortDirection = Literal["asc", "desc"]

AggFunction = Literal["sum", "avg", "min", "max", "count", "approx_count_distinct"]

class HyperFilter(BaseModel):
    column: str
    operator: FilterOperator
    value: Optional[Any] = None

class HyperSort(BaseModel):
    column: str
    direction: SortDirection = "asc"

class HyperAggregation(BaseModel):
    column: str
    function: AggFunction
    alias: Optional[str] = None

class HyperQuery(BaseModel):
    dataset: str
    engine: Literal["duckdb", "polars", "perspective"] = "duckdb"
    wire_format: Literal["arrow", "json"] = "json"
    select: Optional[list[str]] = None
    filters: list[HyperFilter] = Field(default_factory=list)
    groupBy: list[str] = Field(default_factory=list)
    aggregations: list[HyperAggregation] = Field(default_factory=list)
    orderBy: list[HyperSort] = Field(default_factory=list)
    limit: int = 100
    offset: int = 0
    raw_sql: Optional[str] = None  # SQL escape hatch

class AgGridFilterItem(BaseModel):
    filterType: Optional[str] = "text"
    type: Optional[str] = "equals"
    filter: Optional[Any] = None
    filterTo: Optional[Any] = None
    values: Optional[list[Any]] = None

class AgGridSortModel(BaseModel):
    colId: str
    sort: Literal["asc", "desc"]

class AgGridRequest(BaseModel):
    dataset: str
    engine: Literal["duckdb", "polars"] = "duckdb"
    wire_format: Literal["arrow", "json"] = "json"
    startRow: int = 0
    endRow: int = 100
    filterModel: dict[str, Any] = Field(default_factory=dict)
    sortModel: list[AgGridSortModel] = Field(default_factory=list)
    rowGroupCols: list[dict[str, Any]] = Field(default_factory=list)
    valueCols: list[dict[str, Any]] = Field(default_factory=list)
    groupKeys: list[str] = Field(default_factory=list)
    quickSearch: Optional[str] = None

class QueryWaterfall(BaseModel):
    compile_ms: float = 0.0
    engine_exec_ms: float = 0.0
    serialization_ms: float = 0.0
    total_backend_ms: float = 0.0
    rss_before_mb: float = 0.0
    rss_after_mb: float = 0.0
    rss_delta_mb: float = 0.0
    cpu_percent: float = 0.0

class QueryResponse(BaseModel):
    dataset: str
    engine: str
    wire_format: str
    columns: list[str]
    column_types: dict[str, str]
    total_matching_rows: int
    returned_rows: int
    offset: int
    limit: int
    waterfall: QueryWaterfall
    query_string: str
    data: Optional[list[dict[str, Any]]] = None  # Populated when wire_format == 'json'
