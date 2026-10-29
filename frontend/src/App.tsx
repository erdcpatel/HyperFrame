import React, { useState, useEffect, useCallback } from 'react';
import { Database, Upload, PlusCircle } from 'lucide-react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Footer } from './components/layout/Footer';
import { StudioView } from './components/studio/StudioView';
import { ArenaView } from './components/arena/ArenaView';
import { XRayDrawer } from './components/inspector/XRayDrawer';
import { TortureModal } from './components/arena/TortureModal';

import {
  DatasetSummary,
  DatasetWeather,
  EngineType,
  QueryWaterfall,
  SystemTelemetry,
} from './types';
import {
  fetchDatasets,
  fetchDatasetWeather,
  generateSampleDataset,
  fetchEnginesStatus,
  activateEngine,
  purgeMemory,
  explainQuery,
  scanDataDirectory,
  cleanTestData,
  uploadDatasetFile,
} from './services/api';

export const App: React.FC = () => {
  const [mode, setMode] = useState<'studio' | 'arena'>('studio');
  const [activeEngine, setActiveEngine] = useState<EngineType>('duckdb');
  const [serverRssMb, setServerRssMb] = useState<number>(120);

  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [weather, setWeather] = useState<DatasetWeather | null>(null);
  const [loadingWeather, setLoadingWeather] = useState<boolean>(false);
  const [generatingSample, setGeneratingSample] = useState<boolean>(false);

  const [waterfall, setWaterfall] = useState<QueryWaterfall | null>(null);
  const [queryString, setQueryString] = useState<string>('');
  const [planString, setPlanString] = useState<string>('');
  const [totalMatchingRows, setTotalMatchingRows] = useState<number | undefined>(undefined);
  const [returnedRows, setReturnedRows] = useState<number | undefined>(undefined);

  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [xrayOpen, setXrayOpen] = useState<boolean>(false);
  const [tortureOpen, setTortureOpen] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  // Keyboard shortcut Ctrl+B / Cmd+B to toggle sidebar full screen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Initial load: datasets & engines
  const loadInitialData = async () => {
    try {
      const dList = await fetchDatasets();
      setDatasets(dList);

      if (dList.length > 0) {
        setActiveDatasetId(dList[0].dataset_id);
      }

      const engStatus = await fetchEnginesStatus();
      setActiveEngine(engStatus.active_engine);
      setServerRssMb(engStatus.server_rss_mb);
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Fetch Weather when active dataset changes
  useEffect(() => {
    if (!activeDatasetId) return;
    let mounted = true;
    setLoadingWeather(true);
    fetchDatasetWeather(activeDatasetId)
      .then((w) => {
        if (mounted) setWeather(w);
      })
      .catch((err) => console.error('Failed to load weather:', err))
      .finally(() => {
        if (mounted) setLoadingWeather(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeDatasetId]);

  // Live Telemetry via WebSocket
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/telemetry`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const data: SystemTelemetry = JSON.parse(event.data);
          setTelemetry(data);
          setServerRssMb(data.memory_rss_mb);
        } catch (e) {
          // ignore
        }
      };
    } catch (err) {
      console.warn('Telemetry WS connection not available, falling back');
    }

    return () => {
      if (ws) ws.close();
    };
  }, []);

  const handleEngineChange = async (engine: EngineType) => {
    try {
      await activateEngine(engine, activeDatasetId || undefined);
      setActiveEngine(engine);
    } catch (err) {
      console.error('Engine switch failed:', err);
    }
  };

  const handlePurgeMemory = async () => {
    try {
      const res = await purgeMemory();
      setServerRssMb(res.server_rss_mb);
    } catch (err) {
      console.error('Purge memory failed:', err);
    }
  };

  const handleGenerateSample = async () => {
    setGeneratingSample(true);
    try {
      const newWeather = await generateSampleDataset('synthetic_trades_500k', 500000);
      const dList = await fetchDatasets();
      setDatasets(dList);
      setActiveDatasetId(newWeather.dataset_id);
      setWeather(newWeather);
    } catch (err) {
      console.error('Generate sample failed:', err);
    } finally {
      setGeneratingSample(false);
    }
  };

  const handleScanFolder = async () => {
    try {
      const res = await scanDataDirectory();
      const dList = await fetchDatasets();
      setDatasets(dList);
      if (res.datasets.length > 0) {
        setActiveDatasetId(res.datasets[0]);
      }
    } catch (err) {
      console.error('Scan failed:', err);
    }
  };

  const handleCleanTestData = async () => {
    if (!window.confirm('Are you sure you want to delete all synthetic/test datasets and keep only real data?')) {
      return;
    }
    try {
      await cleanTestData();
      const dList = await fetchDatasets();
      setDatasets(dList);
      if (dList.length > 0) {
        setActiveDatasetId(dList[0].dataset_id);
      } else {
        setActiveDatasetId(null);
        setWeather(null);
      }
    } catch (err) {
      console.error('Clean failed:', err);
    }
  };

  const handleUploadFile = async (file: File) => {
    const dsId = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
    try {
      const w = await uploadDatasetFile(dsId, file);
      const dList = await fetchDatasets();
      setDatasets(dList);
      setActiveDatasetId(w.dataset_id);
      setWeather(w);
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  const handleWaterfallUpdate = useCallback(
    async (w: QueryWaterfall, queryStr: string, totalRows: number, retRows: number) => {
      setWaterfall(w);
      setQueryString(queryStr);
      setTotalMatchingRows(totalRows);
      setReturnedRows(retRows);

      // Fetch EXPLAIN plan for X-Ray
      if (activeDatasetId) {
        try {
          const planRes = await explainQuery({
            dataset: activeDatasetId,
            engine: activeEngine,
            raw_sql: queryStr,
            limit: 50,
          });
          setPlanString(planRes.plan);
        } catch {
          setPlanString('Execution plan unavailable for current query expression.');
        }
      }
    },
    [activeDatasetId, activeEngine]
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0d14] text-slate-100">
      {/* Top Navigation Header */}
      <Header
        mode={mode}
        setMode={setMode}
        activeEngine={activeEngine}
        onEngineChange={handleEngineChange}
        serverRssMb={serverRssMb}
        onPurgeMemory={handlePurgeMemory}
        onOpenTortureModal={() => setTortureOpen(true)}
        totalMatchingRows={totalMatchingRows}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
      />

      {/* Main Workspace Splitter */}
      <div className="flex-1 flex min-h-0 min-w-0 relative">
        {/* Left Data Weather Sidebar */}
        <div
          className={`h-full transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0 ${
            sidebarOpen ? 'w-80 border-r border-[#1f2b45]' : 'w-0 border-none'
          }`}
        >
          <div className="w-80 h-full">
            <Sidebar
              datasets={datasets}
              activeDatasetId={activeDatasetId}
              onSelectDataset={setActiveDatasetId}
              weather={weather}
              loadingWeather={loadingWeather}
              onGenerateSample={handleGenerateSample}
              generatingSample={generatingSample}
              onScanFolder={handleScanFolder}
              onCleanTestData={handleCleanTestData}
              onUploadFile={handleUploadFile}
              onToggleCollapse={() => setSidebarOpen(false)}
            />
          </div>
        </div>

        {/* Center Analytical Stage */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          {activeDatasetId && weather ? (
            mode === 'studio' ? (
              <StudioView
                datasetId={activeDatasetId}
                engine={activeEngine}
                columns={weather.columns}
                onWaterfallUpdate={handleWaterfallUpdate}
              />
            ) : (
              <ArenaView datasetId={activeDatasetId} columns={weather.columns} />
            )
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
                <Database className="w-8 h-8 text-blue-400" />
              </div>
              <h2 className="text-lg font-bold text-slate-200 mb-1">No Active Dataset Selected</h2>
              <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
                Drop your <code className="text-blue-300 font-mono">.parquet</code>, <code className="text-blue-300 font-mono">.csv</code>, or <code className="text-blue-300 font-mono">.xlsx</code> files into <code className="text-blue-300 font-mono">backend/data/</code>, or upload one directly to explore.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-900/30 transition-all"
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload Parquet / CSV / Excel</span>
                </button>
                <button
                  onClick={handleGenerateSample}
                  disabled={generatingSample}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#162035] hover:bg-[#1f2c4a] text-slate-200 text-xs font-semibold border border-[#24324f] transition-all disabled:opacity-50"
                >
                  <PlusCircle className="w-4 h-4 text-emerald-400" />
                  <span>{generatingSample ? 'Generating...' : 'Generate 500k Sample'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Bottom Collapsible X-Ray Drawer */}
          <XRayDrawer
            open={xrayOpen}
            onClose={() => setXrayOpen(false)}
            queryString={queryString}
            planString={planString}
            engine={activeEngine}
            waterfall={waterfall}
          />
        </main>
      </div>

      {/* Sticky Bottom Telemetry Waterfall Footer */}
      <Footer
        waterfall={waterfall}
        telemetry={telemetry}
        totalMatchingRows={totalMatchingRows}
        returnedRows={returnedRows}
        xrayOpen={xrayOpen}
        onToggleXray={() => setXrayOpen(!xrayOpen)}
      />

      {/* Torture Benchmark Suite Modal */}
      {activeDatasetId && (
        <TortureModal
          open={tortureOpen}
          onClose={() => setTortureOpen(false)}
          datasetId={activeDatasetId}
        />
      )}
    </div>
  );
};

export default App;
