import {
  DatasetSummary,
  DatasetWeather,
  HyperQuery,
  QueryResponse,
  AgGridResponse,
  SystemTelemetry,
  TortureScorecard,
  EngineType,
} from '../types';

const BASE_URL = '';

export async function fetchDatasets(): Promise<DatasetSummary[]> {
  const res = await fetch(`${BASE_URL}/api/datasets`);
  if (!res.ok) throw new Error('Failed to fetch datasets');
  return res.json();
}

export async function fetchDatasetWeather(datasetId: string, deep: boolean = true): Promise<DatasetWeather> {
  const res = await fetch(`${BASE_URL}/api/datasets/${datasetId}/weather?deep=${deep}`);
  if (!res.ok) throw new Error(`Failed to fetch weather for ${datasetId}`);
  return res.json();
}

export async function generateSampleDataset(datasetId: string = 'synthetic_trades_500k', rows: number = 500000): Promise<DatasetWeather> {
  const res = await fetch(`${BASE_URL}/api/datasets/sample?dataset_id=${encodeURIComponent(datasetId)}&rows=${rows}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to generate sample dataset');
  return res.json();
}

export async function deleteDataset(datasetId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/datasets/${datasetId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete dataset');
}

export async function runQuery(query: HyperQuery): Promise<QueryResponse> {
  const res = await fetch(`${BASE_URL}/api/query/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Query failed');
  }
  return res.json();
}

export async function queryAgGrid(params: {
  dataset: string;
  engine: EngineType;
  startRow: number;
  endRow: number;
  filterModel: Record<string, any>;
  sortModel: { colId: string; sort: 'asc' | 'desc' }[];
  quickSearch?: string;
}): Promise<AgGridResponse> {
  const res = await fetch(`${BASE_URL}/api/query/ag-grid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'AG Grid query failed');
  }
  return res.json();
}

export async function explainQuery(query: HyperQuery): Promise<{ dataset: string; engine: string; plan: string }> {
  const res = await fetch(`${BASE_URL}/api/query/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!res.ok) throw new Error('Explain query failed');
  return res.json();
}

export async function fetchEnginesStatus(): Promise<{
  active_engine: EngineType;
  active_dataset?: string;
  available_engines: EngineType[];
  server_rss_mb: number;
}> {
  const res = await fetch(`${BASE_URL}/api/engines`);
  if (!res.ok) throw new Error('Failed to fetch engines status');
  return res.json();
}

export async function activateEngine(engine: EngineType, datasetId?: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/engines/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine, dataset_id: datasetId }),
  });
  if (!res.ok) throw new Error('Failed to switch engine');
}

export async function purgeMemory(): Promise<{ server_rss_mb: number }> {
  const res = await fetch(`${BASE_URL}/api/engines/purge`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to purge memory');
  return res.json();
}

export async function runTortureSuite(datasetId: string, engines: EngineType[]): Promise<TortureScorecard> {
  const res = await fetch(`${BASE_URL}/api/benchmarks/torture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, engines }),
  });
  if (!res.ok) throw new Error('Torture suite failed');
  return res.json();
}

export async function fetchTelemetrySnapshot(): Promise<SystemTelemetry> {
  const res = await fetch(`${BASE_URL}/api/telemetry/snapshot`);
  if (!res.ok) throw new Error('Failed to fetch telemetry');
  return res.json();
}
