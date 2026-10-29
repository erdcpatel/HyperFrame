import React, { useState } from 'react';
import {
  Swords,
  Timer,
  Cpu,
  Layers,
  Trophy,
  Play,
  RotateCw
} from 'lucide-react';
import { EngineType, HyperQuery, QueryWaterfall, ColumnWeather } from '../../types';
import { runQuery } from '../../services/api';

interface Props {
  datasetId: string;
  columns: ColumnWeather[];
}

export const ArenaView: React.FC<Props> = ({ datasetId, columns }) => {
  const [engineA, setEngineA] = useState<EngineType>('duckdb');
  const [engineB, setEngineB] = useState<EngineType>('polars');

  const [workloadType, setWorkloadType] = useState<'sort' | 'filter' | 'pivot'>('sort');

  const [waterfallA, setWaterfallA] = useState<QueryWaterfall | null>(null);
  const [waterfallB, setWaterfallB] = useState<QueryWaterfall | null>(null);

  const [queryStrA, setQueryStrA] = useState<string>('');
  const [queryStrB, setQueryStrB] = useState<string>('');

  const [rowsA, setRowsA] = useState<number>(0);
  const [rowsB, setRowsB] = useState<number>(0);

  const [racing, setRacing] = useState(false);

  const runRace = async () => {
    if (!datasetId) return;
    setRacing(true);

    const colNames = columns.map((c) => c.name);
    const numCol = colNames.find((c) => ['notional', 'price', 'amount'].includes(c)) || colNames[0];
    const catCol = colNames.find((c) => ['symbol', 'desk', 'status'].includes(c)) || colNames[0];

    let baseQuery: Partial<HyperQuery> = {};
    if (workloadType === 'sort') {
      baseQuery = {
        orderBy: [{ column: numCol, direction: 'desc' }],
        limit: 100,
      };
    } else if (workloadType === 'filter') {
      baseQuery = {
        filters: [{ column: catCol, operator: 'equals', value: 'NVDA' }],
        limit: 100,
      };
    } else if (workloadType === 'pivot') {
      baseQuery = {
        groupBy: [catCol],
        aggregations: [
          { column: numCol, function: 'sum', alias: 'total_metric' },
          { column: catCol, function: 'count', alias: 'row_count' },
        ],
        orderBy: [{ column: 'total_metric', direction: 'desc' }],
        limit: 50,
      };
    }

    try {
      // Fire simultaneously
      const qA: HyperQuery = { dataset: datasetId, engine: engineA, ...baseQuery };
      const qB: HyperQuery = { dataset: datasetId, engine: engineB, ...baseQuery };

      const [resA, resB] = await Promise.all([runQuery(qA), runQuery(qB)]);

      setWaterfallA(resA.waterfall);
      setQueryStrA(resA.query_string);
      setRowsA(resA.returned_rows);

      setWaterfallB(resB.waterfall);
      setQueryStrB(resB.query_string);
      setRowsB(resB.returned_rows);
    } catch (err) {
      console.error('Race error:', err);
    } finally {
      setRacing(false);
    }
  };

  const getWinner = () => {
    if (!waterfallA || !waterfallB) return null;
    const diff = waterfallA.total_backend_ms - waterfallB.total_backend_ms;
    if (Math.abs(diff) < 1.0) return 'TIE';
    if (diff < 0) {
      const pct = Math.round((Math.abs(diff) / waterfallB.total_backend_ms) * 100);
      return { engine: engineA, pct };
    } else {
      const pct = Math.round((Math.abs(diff) / waterfallA.total_backend_ms) * 100);
      return { engine: engineB, pct };
    }
  };

  const winner = getWinner();

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0f19] select-none">
      {/* Race Trigger Bar */}
      <div className="h-14 border-b border-[#1f2b45] bg-[#0e1424] px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Swords className="w-5 h-5 text-indigo-400" />
            <span className="font-extrabold text-sm text-slate-100 tracking-wider">ARENA RACE MODE</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold">Workload:</span>
            <select
              value={workloadType}
              onChange={(e) => setWorkloadType(e.target.value as any)}
              className="bg-[#141b2c] border border-[#24324f] rounded px-2.5 py-1 text-slate-200 outline-none cursor-pointer"
            >
              <option value="sort">Heavy Global Sort (DESC)</option>
              <option value="filter">Needle Filter (Symbol == 'NVDA')</option>
              <option value="pivot">Group-By Pivot & Aggregation</option>
            </select>
          </div>
        </div>

        <button
          onClick={runRace}
          disabled={racing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-900/30 transition-all active:scale-95 disabled:opacity-50"
        >
          <Play className={`w-4 h-4 fill-white ${racing ? 'animate-spin' : ''}`} />
          <span>{racing ? 'Running Race...' : 'FIRE SYNCHRONIZED RACE'}</span>
        </button>
      </div>

      {/* Winner Banner */}
      {winner && winner !== 'TIE' && typeof winner === 'object' && (
        <div className="bg-gradient-to-r from-emerald-900/40 via-blue-900/40 to-indigo-900/40 border-b border-emerald-500/30 px-6 py-2 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span className="text-slate-300">Winner:</span>
            <span className="font-bold text-emerald-400 uppercase text-sm">{winner.engine}</span>
            <span className="text-slate-400">({winner.pct}% faster execution)</span>
          </div>
          <span className="text-slate-500 text-[11px]">Synchronized Workload Completed</span>
        </div>
      )}

      {/* Side-by-Side Split Canvases */}
      <div className="flex-1 grid grid-cols-2 divide-x divide-[#1f2b45] min-h-0">
        {/* Engine A */}
        <div className="p-4 flex flex-col min-h-0 bg-[#0d121f]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Engine A</span>
            </div>
            <select
              value={engineA}
              onChange={(e) => setEngineA(e.target.value as EngineType)}
              className="bg-[#141b2c] border border-[#24324f] rounded px-2 py-1 text-xs font-semibold text-blue-400 outline-none cursor-pointer"
            >
              <option value="duckdb">DuckDB 2.0 (Out-of-Core)</option>
              <option value="polars">Polars 2.x (Streaming)</option>
              <option value="perspective">Perspective 5.x (In-Memory)</option>
            </select>
          </div>

          {waterfallA ? (
            <div className="space-y-3 font-mono text-xs">
              <div className="bg-[#131b2e] p-3 rounded-lg border border-[#202c47] grid grid-cols-3 gap-2">
                <div>
                  <span className="text-[10px] text-slate-500 block">EXECUTION</span>
                  <span className="text-base font-bold text-blue-400">{waterfallA.engine_exec_ms.toFixed(1)}ms</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">TOTAL</span>
                  <span className="text-base font-bold text-white">{waterfallA.total_backend_ms.toFixed(1)}ms</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">RSS DELTA</span>
                  <span className="text-base font-bold text-slate-300">
                    {waterfallA.rss_delta_mb > 0 ? `+${waterfallA.rss_delta_mb}` : waterfallA.rss_delta_mb}MB
                  </span>
                </div>
              </div>

              <div className="bg-[#0f1524] p-3 rounded-lg border border-[#1f2b45]">
                <span className="text-[10px] text-slate-500 block mb-1">COMPILED PLAN / QUERY</span>
                <pre className="text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap">{queryStrA}</pre>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-xs">
              Ready to race Engine A
            </div>
          )}
        </div>

        {/* Engine B */}
        <div className="p-4 flex flex-col min-h-0 bg-[#0d121f]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Engine B</span>
            </div>
            <select
              value={engineB}
              onChange={(e) => setEngineB(e.target.value as EngineType)}
              className="bg-[#141b2c] border border-[#24324f] rounded px-2 py-1 text-xs font-semibold text-indigo-400 outline-none cursor-pointer"
            >
              <option value="polars">Polars 2.x (Streaming)</option>
              <option value="duckdb">DuckDB 2.0 (Out-of-Core)</option>
              <option value="perspective">Perspective 5.x (In-Memory)</option>
            </select>
          </div>

          {waterfallB ? (
            <div className="space-y-3 font-mono text-xs">
              <div className="bg-[#131b2e] p-3 rounded-lg border border-[#202c47] grid grid-cols-3 gap-2">
                <div>
                  <span className="text-[10px] text-slate-500 block">EXECUTION</span>
                  <span className="text-base font-bold text-indigo-400">{waterfallB.engine_exec_ms.toFixed(1)}ms</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">TOTAL</span>
                  <span className="text-base font-bold text-white">{waterfallB.total_backend_ms.toFixed(1)}ms</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">RSS DELTA</span>
                  <span className="text-base font-bold text-slate-300">
                    {waterfallB.rss_delta_mb > 0 ? `+${waterfallB.rss_delta_mb}` : waterfallB.rss_delta_mb}MB
                  </span>
                </div>
              </div>

              <div className="bg-[#0f1524] p-3 rounded-lg border border-[#1f2b45]">
                <span className="text-[10px] text-slate-500 block mb-1">COMPILED PLAN / QUERY</span>
                <pre className="text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap">{queryStrB}</pre>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-xs">
              Ready to race Engine B
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
