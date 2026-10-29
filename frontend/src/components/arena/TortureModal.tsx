import React, { useState } from 'react';
import { X, Flame, Trophy, Play, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { EngineType, TortureScorecard } from '../../types';
import { runTortureSuite } from '../../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
  datasetId: string;
}

export const TortureModal: React.FC<Props> = ({ open, onClose, datasetId }) => {
  const [running, setRunning] = useState(false);
  const [scorecard, setScorecard] = useState<TortureScorecard | null>(null);
  const [selectedEngines, setSelectedEngines] = useState<EngineType[]>(['duckdb', 'polars']);

  if (!open) return null;

  const handleRun = async () => {
    if (!datasetId) return;
    setRunning(true);
    try {
      const res = await runTortureSuite(datasetId, selectedEngines);
      setScorecard(res);
    } catch (err) {
      console.error('Torture suite failed:', err);
    } finally {
      setRunning(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!scorecard) return;
    const headers = ['Workload', 'Engine', 'Compile(ms)', 'Exec(ms)', 'Total(ms)', 'RSS Delta(MB)', 'Rows Returned', 'Status'];
    const rows = scorecard.results.map((r) => [
      `"${r.workload_name}"`,
      r.engine,
      r.compile_ms,
      r.exec_ms,
      r.total_ms,
      r.server_rss_delta_mb,
      r.rows_returned,
      r.status,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `hyperframe_scorecard_${datasetId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#0f1422] border border-[#24324f] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="h-14 border-b border-[#1f2b45] px-6 flex items-center justify-between bg-[#12192a]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-600 to-rose-600 flex items-center justify-center shadow-md shadow-rose-900/30">
              <Flame className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">Standardized Torture Benchmark Suite</h2>
              <p className="text-[11px] text-slate-400 font-mono">5 Rigorous Workloads over {datasetId}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#1c263e] rounded-lg text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Controls */}
        <div className="p-4 border-b border-[#1f2b45] bg-[#0d121f] flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-slate-400 font-semibold">Test Engines:</span>
            {(['duckdb', 'polars', 'perspective'] as EngineType[]).map((eng) => (
              <label key={eng} className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={selectedEngines.includes(eng)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedEngines([...selectedEngines, eng]);
                    } else {
                      setSelectedEngines(selectedEngines.filter((x) => x !== eng));
                    }
                  }}
                  className="rounded bg-[#1a233a] border-[#293859] text-blue-500 focus:ring-0"
                />
                <span className="capitalize">{eng}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {scorecard && (
              <button
                onClick={handleDownloadCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#192338] hover:bg-[#22304d] text-slate-200 font-medium border border-[#273654] transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={running || selectedEngines.length === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white font-bold shadow-md shadow-rose-950/40 transition-all active:scale-95 disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 fill-white ${running ? 'animate-spin' : ''}`} />
              <span>{running ? 'Executing Suite...' : 'Run Torture Suite'}</span>
            </button>
          </div>
        </div>

        {/* Scorecard Table */}
        <div className="flex-1 p-4 overflow-y-auto min-h-0 bg-[#0a0e18]">
          {scorecard ? (
            <div className="space-y-4">
              {scorecard.winner_engine && (
                <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/60 via-blue-950/40 to-indigo-950/40 border border-emerald-500/40 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    <span className="text-slate-300">Overall Suite Winner:</span>
                    <span className="font-extrabold text-emerald-400 uppercase text-sm">
                      {scorecard.winner_engine}
                    </span>
                  </div>
                  <span className="text-slate-400 text-[11px]">{scorecard.summary}</span>
                </div>
              )}

              <table className="w-full text-left text-xs font-mono rounded-lg overflow-hidden border border-[#1f2b45]">
                <thead className="bg-[#141b2c] border-b border-[#24324f] text-slate-300">
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
                  {scorecard.results.map((r, idx) => (
                    <tr key={idx} className="hover:bg-[#121929] transition-colors">
                      <td className="py-2 px-3 font-semibold text-slate-200">
                        <div>{r.workload_name}</div>
                        <div className="text-[10px] text-slate-500 font-sans">{r.description}</div>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          r.engine === 'duckdb' ? 'bg-blue-500/20 text-blue-300' : 'bg-indigo-500/20 text-indigo-300'
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
            <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-xs">
              <Flame className="w-8 h-8 text-rose-500/40 mb-2 animate-bounce" />
              <span>Select engines and click "Run Torture Suite" to benchmark 5 workloads</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
