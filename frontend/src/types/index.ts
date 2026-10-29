export type EngineType = 'duckdb' | 'polars' | 'perspective';
export type WireFormat = 'arrow' | 'json';

export interface ColumnWeather {
  name: string;
  dtype: string;
  null_count: number;
  null_percentage: number;
  approx_unique: number;
  min_value?: string | number | null;
  max_value?: string | number | null;
  q25?: string | number | null;
  q50?: string | number | null;
  q75?: string | number | null;
}

export interface DatasetWeather {
  dataset_id: string;
  file_name: string;
  path: string;
  file_size_bytes: number;
  file_size_formatted: string;
  row_count: number;
  column_count: number;
  row_groups: number;
  est_uncompressed_bytes: number;
  est_uncompressed_formatted: string;
  compression_ratio: number;
  columns: ColumnWeather[];
}

export interface DatasetSummary {
  dataset_id: string;
  file_name: string;
  row_count: number;
  column_count: number;
  file_size_formatted: string;
  created_at: string;
}

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

export interface HyperFilter {
  column: string;
  operator: FilterOperator;
  value?: any;
}

export interface HyperSort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface HyperAggregation {
  column: string;
  function: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'approx_count_distinct';
  alias?: string;
}

export interface HyperQuery {
  dataset: string;
  engine: EngineType;
  wire_format?: WireFormat;
  select?: string[];
  filters?: HyperFilter[];
  groupBy?: string[];
  aggregations?: HyperAggregation[];
  orderBy?: HyperSort[];
  limit?: number;
  offset?: number;
  raw_sql?: string;
  quick_search?: string;
}

export interface QueryWaterfall {
  compile_ms: number;
  engine_exec_ms: number;
  serialization_ms: number;
  total_backend_ms: number;
  rss_before_mb: number;
  rss_after_mb: number;
  rss_delta_mb: number;
  cpu_percent: number;
  client_render_ms?: number;
}

export interface QueryResponse {
  dataset: string;
  engine: string;
  wire_format: string;
  columns: string[];
  column_types: Record<string, string>;
  total_matching_rows: number;
  returned_rows: number;
  offset: number;
  limit: number;
  waterfall: QueryWaterfall;
  query_string: string;
  data?: Record<string, any>[];
}

export interface AgGridResponse {
  rows: Record<string, any>[];
  totalCount: number;
  startRow: number;
  endRow: number;
  waterfall: QueryWaterfall;
  query_string: string;
}

export interface SystemTelemetry {
  timestamp: number;
  cpu_percent_total: number;
  cpu_percent_per_core: number[];
  memory_rss_mb: number;
  memory_rss_percent: number;
  memory_available_mb: number;
  active_engine?: string;
  active_dataset?: string;
}

export interface TortureWorkloadResult {
  workload_id: string;
  workload_name: string;
  description: string;
  engine: string;
  compile_ms: number;
  exec_ms: number;
  serialization_ms: number;
  total_ms: number;
  server_rss_delta_mb: number;
  rows_scanned: number;
  rows_returned: number;
  payload_kb: number;
  status: 'SUCCESS' | 'OOM_FALLBACK' | 'ERROR';
  error_message?: string;
  plan_summary?: string;
}

export interface TortureScorecard {
  dataset_id: string;
  timestamp: string;
  results: TortureWorkloadResult[];
  winner_engine?: string;
  summary: string;
}
