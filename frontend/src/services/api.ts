import {
  DatasetSummary,
  DatasetWeather,
  HyperQuery,
  HyperFilter,
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

export async function scanDataDirectory(): Promise<{ newly_registered_count: number; datasets: string[] }> {
  const res = await fetch(`${BASE_URL}/api/datasets/scan`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to scan data directory');
  return res.json();
}

export async function cleanTestData(): Promise<{ message: string; removed_datasets: string[] }> {
  const res = await fetch(`${BASE_URL}/api/datasets/clean-test-data`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to clean test data');
  return res.json();
}

export async function uploadDatasetFile(datasetId: string, file: File): Promise<DatasetWeather> {
  const formData = new FormData();
  formData.append('dataset_id', datasetId);
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/api/datasets/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Upload failed');
  }
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
  customFilters?: HyperFilter[];
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

export async function exportQueryCsv(query: HyperQuery): Promise<void> {
  const controller = new AbortController();
  // 3-minute safety timeout to prevent hanging UI
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    const res = await fetch(`${BASE_URL}/api/query/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = 'Export failed';
      try {
        const errJson = await res.json();
        detail = errJson.detail || detail;
      } catch (_) {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hyperframe_${query.dataset}_export.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 2000);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Export request timed out after 3 minutes. Please retry.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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

export interface TortureStatusResponse {
  is_running: boolean;
  dataset_id: string | null;
  engines: EngineType[];
  total_workloads: number;
  completed_workloads: number;
  progress_pct: number;
  current_step: string;
  results: any[];
  scorecard: TortureScorecard | null;
}

export async function fetchTortureStatus(): Promise<TortureStatusResponse> {
  const res = await fetch(`${BASE_URL}/api/benchmarks/torture/status`);
  if (!res.ok) throw new Error('Failed to fetch torture status');
  return res.json();
}

export async function startTortureBackground(datasetId: string, engines: EngineType[]): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/benchmarks/torture/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, engines }),
  });
  if (!res.ok) throw new Error('Failed to start torture suite');
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

// S3 Lakehouse Services
export async function fetchS3Profiles(): Promise<S3ProfilePublic[]> {
  const res = await fetch(`${BASE_URL}/api/s3/profiles`);
  if (!res.ok) throw new Error('Failed to fetch S3 profiles');
  return res.json();
}

export async function saveS3Profile(profile: any): Promise<S3ProfilePublic> {
  const res = await fetch(`${BASE_URL}/api/s3/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to save S3 profile');
  }
  return res.json();
}

export async function deleteS3Profile(profileId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/s3/profiles/${profileId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete S3 profile');
}

export async function testS3Connection(profileId: string): Promise<{ success: boolean; latency_ms: number; message: string }> {
  const res = await fetch(`${BASE_URL}/api/s3/profiles/${profileId}/test`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Connection test failed');
  }
  return res.json();
}

export async function browseS3Folder(profileId: string, prefix: string = ''): Promise<S3BrowseResponse> {
  const query = new URLSearchParams({ profile_id: profileId, prefix });
  const res = await fetch(`${BASE_URL}/api/s3/browse?${query.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to browse S3 folder');
  }
  return res.json();
}

export async function previewS3Data(req: { profile_id: string; folder_prefix: string; recursive_glob?: boolean; limit?: number }) {
  const res = await fetch(`${BASE_URL}/api/s3/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to preview S3 data');
  }
  return res.json();
}

export async function registerS3Dataset(req: { dataset_id: string; profile_id: string; folder_prefix: string; recursive_glob?: boolean; description?: string }): Promise<DatasetWeather> {
  const res = await fetch(`${BASE_URL}/api/s3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to register S3 dataset');
  }
  return res.json();
}

export async function downloadS3Dataset(req: { dataset_id: string; profile_id: string; folder_prefix: string; recursive_glob?: boolean; description?: string }): Promise<DatasetWeather> {
  const res = await fetch(`${BASE_URL}/api/s3/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to download and ingest S3 dataset');
  }
  return res.json();
}
