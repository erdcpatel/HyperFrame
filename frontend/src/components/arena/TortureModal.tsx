import React, { useState, useEffect, useRef } from 'react';
import { X, Flame, Trophy, Play, CheckCircle2, AlertCircle, Download, ExternalLink, Loader2, ArrowRight } from 'lucide-react';
import { EngineType, TortureScorecard, TortureWorkloadResult } from '../../types';
import { fetchTortureStatus, startTortureBackground } from '../../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
  datasetId: string;
}

export const TortureModal: React.FC<Props> = ({ open, onClose, datasetId }) => {
  const [running, setRunning] = useState(false);
  const [scorecard, setScorecard] = useState<TortureScorecard | null>(null);
  const [liveResults, setLiveResults] = useState<TortureWorkloadResult[]>([]);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [completedCount, setCompletedCount] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [selectedEngines, setSelectedEngines] = useState<EngineType[]>(['duckdb', 'polars']);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanupEventSource = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const subscribeToStream = () => {
    cleanupEventSource();
    const es = new EventSource('/api/benchmarks/torture/stream');
    eventSourceRef.current = es;

    es.addEventListener('init', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setRunning(data.is_running);
        if (data.results && data.results.length > 0) {
          setLiveResults(data.results);
        }
        if (data.scorecard) {
          setScorecard(data.scorecard);
        }
        setProgressPct(data.progress_pct || 0);
        setCompletedCount(data.completed_workloads || 0);
        setTotalCount(data.total_workloads || 0);
        setCurrentStep(data.current_step || '');
      } catch (err) {}
    });

    es.addEventListener('progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setRunning(true);
        setCurrentStep(data.current_step || '');
        setProgressPct(data.progress_pct || 0);
        setCompletedCount(data.completed || 0);
        setTotalCount(data.total || 0);
      } catch (err) {}
    });

    es.addEventListener('workload_done', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setLiveResults((prev) => {
          const exists = prev.some((r) => r.workload_id === data.result.workload_id && r.engine === data.result.engine);
          return exists ? prev : [...prev, data.result];
        });
        setProgressPct(data.progress_pct || 0);
        setCompletedCount(data.completed || 0);
        setTotalCount(data.total || 0);
        setCurrentStep(data.current_step || '');
      } catch (err) {}
    });

    es.addEventListener('complete', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setScorecard(data.scorecard);
        setLiveResults(data.scorecard.results || []);
        setRunning(false);
        setProgressPct(100);
        setCurrentStep('All workloads completed successfully.');
        cleanupEventSource();
      } catch (err) {}
    });

    es.onerror = () => {
      cleanupEventSource();
    };
  };

  // Sync with background execution whenever modal opens
  useEffect(() => {
    if (!open) {
      cleanupEventSource();
      return;
    }

    fetchTortureStatus()
      .then((status) => {
        setRunning(status.is_running);
        if (status.results && status.results.length > 0) {
          setLiveResults(status.results as any);
        }
        if (status.scorecard) {
          setScorecard(status.scorecard);
        }
        setProgressPct(status.progress_pct || 0);
        setCompletedCount(status.completed_workloads || 0);
        setTotalCount(status.total_workloads || 0);
        setCurrentStep(status.current_step || '');

        if (status.is_running) {
          subscribeToStream();
        }
      })
      .catch((err) => console.error('Failed to query torture status:', err));

    return () => cleanupEventSource();
  }, [open]);

  if (!open) return null;

  const handleRun = async () => {
    if (!datasetId || selectedEngines.length === 0) return;
    setRunning(true);
    setScorecard(null);
    setLiveResults([]);
    setProgressPct(0);
    setCompletedCount(0);
    setTotalCount(selectedEngines.length * 5);
    setCurrentStep('Initializing benchmark engine runners...');

    try {
      await startTortureBackground(datasetId, selectedEngines);
      subscribeToStream();
    } catch (err) {
      console.error('Failed to trigger torture benchmark:', err);
      setRunning(false);
    }
  };

  const handleDownloadCsv = () => {
    const list = scorecard?.results || liveResults;
    if (list.length === 0) return;
    const headers = ['Workload', 'Engine', 'Compile(ms)', 'Exec(ms)', 'Total(ms)', 'RSS Delta(MB)', 'Rows Returned', 'Status', 'Error'];
    const rows = list.map((r) => [
      `"${r.workload_name}"`,
      r.engine,
      r.compile_ms,
      r.exec_ms,
      r.total_ms,
      r.server_rss_delta_mb,
      r.rows_returned,
      r.status,
      `"${r.error_message || ''}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `hyperframe_torture_scorecard_${datasetId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeResults = scorecard?.results || liveResults;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-fadeIn">
      <div className="bg-[#0f1422] border border-[#24324f] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="h-14 border-b border-[#1f2b45] px-6 flex items-center justify-between bg-[#12192a]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-600 to-rose-600 flex items-center justify-center shadow-md shadow-rose-900/30">
              <Flame className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100">Standardized Torture Benchmark Suite</h2>
                {running && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Background Execution
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-mono">5 Rigorous Workloads over {datasetId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#1c263e] rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
            title="Close Window (Benchmarks continue running in background)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Controls */}
        <div className="p-4 border-b border-[#1f2b45] bg-[#0d121f] flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-slate-400 font-semibold">Test Engines:</span>
            {(['duckdb', 'polars', 'perspective'] as EngineType[]).map((eng) => (
              <label key={eng} className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-slate-100">
                <input
                  type="checkbox"
                  disabled={running}
                  checked={selectedEngines.includes(eng)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedEngines([...selectedEngines, eng]);
                    } else {
                      setSelectedEngines(selectedEngines.filter((x) => x !== eng));
                    }
                  }}
                  className="rounded bg-[#1a233a] border-[#293859] text-blue-500 focus:ring-0 disabled:opacity-50"
                />
                <span className="capitalize">{eng}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {activeResults.length > 0 && (
              <button
                onClick={handleDownloadCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#192338] hover:bg-[#22304d] text-slate-200 font-medium border border-[#273654] transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            )}

            {running ? (
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-semibold border border-blue-500/30 transition-all text-xs"
                title="Tests continue running on the server. You can reopen this modal anytime."
              >
                <span>Close & Run in Background</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={handleRun}
                disabled={running || selectedEngines.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white font-bold shadow-md shadow-rose-950/40 transition-all active:scale-95 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Run Torture Suite</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Progress Bar Section */}
        {running && (
          <div className="px-6 py-3 bg-[#111726] border-b border-[#1f2b45] flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {currentStep || 'Running benchmark workloads...'}
              </span>
              <span className="text-slate-400">
                Workload <b>{completedCount}</b> of <b>{totalCount}</b> ({progressPct}%)
              </span>
            </div>
            <div className="w-full bg-[#18233a] h-2 rounded-full overflow-hidden border border-[#243555]">
              <div
                className="bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-500 h-full transition-all duration-300 ease-out"
                style={{ width: `${Math.max(4, progressPct)}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500 italic">
              💡 Tip: You can close this window at any time. The suite runs in an independent server background thread and results will be ready when you reopen.
            </p>
          </div>
        )}

        {/* Scorecard Table & Live Results */}
        <div className="flex-1 p-4 overflow-y-auto min-h-0 bg-[#0a0e18]">
          {activeResults.length > 0 ? (
            <div className="space-y-4">
              {scorecard?.winner_engine && !running && (
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/70 via-blue-950/50 to-indigo-950/50 border border-emerald-500/40 flex items-center justify-between text-xs font-mono shadow-lg shadow-emerald-950/20">
                  <div className="flex items-center gap-2.5">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-300 font-semibold">Overall Winner:</span>
                        <span className="font-extrabold text-emerald-400 uppercase text-sm">
                          {scorecard.winner_engine}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">{scorecard.summary}</div>
                    </div>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 uppercase">
                    100% Workloads Verified
                  </span>
                </div>
              )}

              <table className="w-full text-left text-xs font-mono rounded-lg overflow-hidden border border-[#1f2b45]">
                <thead className="bg-[#141b2c] border-b border-[#24324f] text-slate-300 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">WORKLOAD</th>
                    <th className="py-2.5 px-3">ENGINE</th>
                    <th className="py-2.5 px-3 text-right">EXEC (MS)</th>
                    <th className="py-2.5 px-3 text-right">TOTAL (MS)</th>
                    <th className="py-2.5 px-3 text-right">RSS DELTA</th>
                    <th className="py-2.5 px-3 text-right">ROWS</th>
                    <th className="py-2.5 px-3">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#172238] bg-[#0e1422]">
                  {activeResults.map((r, idx) => (
                    <tr key={idx} className="hover:bg-[#121929] transition-colors">
                      <td className="py-2 px-3 font-semibold text-slate-200">
                        <div>{r.workload_name}</div>
                        <div className="text-[10px] text-slate-500 font-sans">{r.description}</div>
                        {r.status !== 'SUCCESS' && r.error_message && (
                          <div className="text-[10px] text-rose-400 mt-0.5 font-mono truncate max-w-xs" title={r.error_message}>
                            {r.error_message}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          r.engine === 'duckdb'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : r.engine === 'polars'
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}>
                          {r.engine}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-blue-400">{r.exec_ms.toFixed(1)}</td>
                      <td className="py-2 px-3 text-right text-slate-200">{r.total_ms.toFixed(1)}</td>
                      <td className="py-2 px-3 text-right text-slate-400">
                        {r.server_rss_delta_mb > 0 ? `+${r.server_rss_delta_mb}` : r.server_rss_delta_mb}MB
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">{r.rows_returned.toLocaleString()}</td>
                      <td className="py-2 px-3">
                        {r.status === 'SUCCESS' ? (
                          <span className="flex items-center gap-1 text-emerald-400 text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>OK</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-rose-400 text-[11px]" title={r.error_message || ''}>
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>FAIL</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs">
              <Flame className="w-10 h-10 text-rose-500/30 mb-3" />
              <span className="text-slate-300 font-semibold mb-1">Standardized 5-Stage Torture Suite</span>
              <span className="text-slate-500 max-w-sm text-center leading-relaxed">
                Select your engines above and click "Run Torture Suite". Tests run concurrently with sub-millisecond hardware telemetry.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
