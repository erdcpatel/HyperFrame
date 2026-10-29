import React, { useState, useEffect, useCallback } from 'react';
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

  // Initial load: datasets & engines
  const loadInitialData = async () => {
    try {
      const dList = await fetchDatasets();
      setDatasets(dList);

      if (dList.length > 0) {
        setActiveDatasetId(dList[0].dataset_id);
      } else {
        // Auto-generate sample if catalog is empty
        handleGenerateSample();
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
      />

      {/* Main Workspace Splitter */}
      <div className="flex-1 flex min-h-0 min-w-0">
        {/* Left Data Weather Sidebar */}
        <Sidebar
          datasets={datasets}
          activeDatasetId={activeDatasetId}
          onSelectDataset={setActiveDatasetId}
          weather={weather}
          loadingWeather={loadingWeather}
          onGenerateSample={handleGenerateSample}
          generatingSample={generatingSample}
        />

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
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
              <span className="text-sm font-semibold">Loading or creating dataset...</span>
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
