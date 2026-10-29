import React, { useState } from 'react';
import { Play, FileCode, CheckCircle2, AlertCircle } from 'lucide-react';
import { EngineType, HyperQuery, QueryWaterfall } from '../../types';
import { runQuery, explainQuery } from '../../services/api';
import { SyntaxHighlighter } from '../common/SyntaxHighlighter';

interface Props {
  datasetId: string;
  engine: EngineType;
  onWaterfallUpdate: (w: QueryWaterfall, queryStr: string, totalRows: number, returnedRows: number) => void;
}

export const QueryEditor: React.FC<Props> = ({
  datasetId,
  engine,
  onWaterfallUpdate,
}) => {
  const defaultSql = `SELECT 
    symbol, 
    desk, 
    COUNT(*) AS total_trades, 
    ROUND(SUM(notional), 2) AS total_notional,
    ROUND(AVG(execution_latency_ms), 3) AS avg_latency_ms
FROM :dataset
WHERE status = 'FILLED'
GROUP BY symbol, desk
ORDER BY total_notional DESC
LIMIT 50;`;

  const [rawSql, setRawSql] = useState(defaultSql);
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!rawSql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const q: HyperQuery = {
        dataset: datasetId,
        engine,
        raw_sql: rawSql,
        limit: 100,
      };

      const tStart = performance.now();
      const res = await runQuery(q);
      const tRender = performance.now() - tStart;

      setData(res.data || []);
      setColumns(res.columns);
      onWaterfallUpdate(
        { ...res.waterfall, client_render_ms: Math.round(tRender) },
        res.query_string,
        res.total_matching_rows,
        res.returned_rows
      );
    } catch (err: any) {
      setError(err.message || 'Query execution failed');
    } finally {
      setLoading(false);
    }
  };

  const loadTemplate = (sql: string) => {
    setRawSql(sql);
    setError(null);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0f19] select-none">
      {/* Templates & Run Toolbar */}
      <div className="h-11 border-b border-[#1f2b45] bg-[#0e1424] px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-semibold">Templates:</span>
          <button
            onClick={() =>
              loadTemplate(`SELECT symbol, COUNT(*) AS trades, SUM(notional) AS total_notional
FROM :dataset
GROUP BY symbol
ORDER BY total_notional DESC
LIMIT 10;`)
            }
            className="px-2 py-0.5 rounded bg-[#162035] hover:bg-[#1d2a45] text-slate-300 font-mono text-[11px]"
          >
            Top 10 Symbols
          </button>
          <button
            onClick={() =>
              loadTemplate(`SELECT * FROM :dataset
WHERE notional > 500000 AND status = 'FILLED'
ORDER BY notional DESC
LIMIT 100;`)
            }
            className="px-2 py-0.5 rounded bg-[#162035] hover:bg-[#1d2a45] text-slate-300 font-mono text-[11px]"
          >
            Large Filled Trades
          </button>
          <button
            onClick={() =>
              loadTemplate(`SELECT desk, side, COUNT(*) AS count, AVG(price) AS avg_price
FROM :dataset
GROUP BY desk, side
ORDER BY count DESC;`)
            }
            className="px-2 py-0.5 rounded bg-[#162035] hover:bg-[#1d2a45] text-slate-300 font-mono text-[11px]"
          >
            Desk & Side Pivot
          </button>
        </div>

        <button
          onClick={handleRun}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md shadow-emerald-950/40 transition-all active:scale-95 disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          <span>{loading ? 'Executing...' : 'Run Query'}</span>
        </button>
      </div>

      {/* Editor & Output Splitter */}
      <div className="flex-1 grid grid-rows-2 min-h-0">
        {/* SQL Editor Area */}
        <div className="p-3 border-b border-[#1f2b45] flex flex-col min-h-0 bg-[#0d121f]">
          <textarea
            value={rawSql}
            onChange={(e) => setRawSql(e.target.value)}
            className="w-full h-full bg-[#090d16] border border-[#24324f] rounded-lg p-3 font-mono text-xs text-blue-300 outline-none focus:border-blue-500 resize-none leading-relaxed"
            placeholder="Write your DuckDB / ANSI SQL query here... Use :dataset as the table placeholder."
            spellCheck={false}
          />
        </div>

        {/* Results Area */}
        <div className="flex flex-col min-h-0 bg-[#0b0f19] p-3 overflow-hidden">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {!error && data.length > 0 && (
            <div className="flex-1 overflow-auto rounded-lg border border-[#1f2b45] bg-[#0e1424]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#141b2c] border-b border-[#24324f] text-slate-300 sticky top-0">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="py-2 px-3 font-semibold text-slate-300">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#172238]">
                  {data.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-[#121929]">
                      {columns.map((c) => (
                        <td key={c} className="py-1.5 px-3 text-slate-300 truncate max-w-xs">
                          {String(row[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!error && data.length === 0 && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs">
              <FileCode className="w-8 h-8 text-slate-600 mb-2" />
              <span>Execute SQL to see real-time query results</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
