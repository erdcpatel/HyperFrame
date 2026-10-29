import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Table as TableIcon,
  RotateCw,
  TrendingUp,
  Layers,
  ChevronRight
} from 'lucide-react';
import { ColumnWeather, EngineType, HyperQuery, QueryWaterfall } from '../../types';
import { runQuery } from '../../services/api';

interface Props {
  datasetId: string;
  engine: EngineType;
  columns: ColumnWeather[];
  onWaterfallUpdate: (w: QueryWaterfall, queryStr: string, totalRows: number, returnedRows: number) => void;
}

export const PerspectiveCanvas: React.FC<Props> = ({
  datasetId,
  engine,
  columns,
  onWaterfallUpdate,
}) => {
  const colNames = columns.map((c) => c.name);

  // Group by & metric aggregation states
  const defaultGroup = colNames.find((c) => ['symbol', 'desk', 'status', 'side'].includes(c)) || colNames[0] || '';
  const defaultMetric = colNames.find((c) => ['notional', 'price', 'amount', 'execution_latency_ms'].includes(c)) || colNames[1] || '';

  const [groupByCol, setGroupByCol] = useState(defaultGroup);
  const [metricCol, setMetricCol] = useState(defaultMetric);
  const [aggFunc, setAggFunc] = useState<'sum' | 'avg' | 'count' | 'min' | 'max'>('sum');
  const [chartType, setChartType] = useState<'table' | 'bar'>('table');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const executePivot = async () => {
    if (!datasetId) return;
    setLoading(true);
    try {
      const q: HyperQuery = groupByCol
        ? {
            dataset: datasetId,
            engine,
            groupBy: [groupByCol],
            aggregations: [
              {
                column: aggFunc === 'count' ? columns[0]?.name || 'trade_id' : metricCol,
                function: aggFunc,
                alias: 'metric_value',
              },
              {
                column: columns[0]?.name || 'trade_id',
                function: 'count',
                alias: 'row_count',
              },
            ],
            orderBy: [{ column: 'metric_value', direction: 'desc' }],
            limit: 100,
          }
        : {
            dataset: datasetId,
            engine,
            limit: 100,
            orderBy: metricCol ? [{ column: metricCol, direction: 'desc' }] : undefined,
          };

      const tStart = performance.now();
      const res = await runQuery(q);
      const tRender = performance.now() - tStart;

      setData(res.data || []);
      onWaterfallUpdate(
        { ...res.waterfall, client_render_ms: Math.round(tRender) },
        res.query_string,
        res.total_matching_rows,
        res.returned_rows
      );
    } catch (err) {
      console.error('Pivot execution failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    executePivot();
  }, [datasetId, engine, groupByCol, metricCol, aggFunc]);

  const maxVal = Math.max(...data.map((d) => Number(d.metric_value) || 0), 1);

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0f19] select-none">
      {/* Pivot Controls Toolbar */}
      <div className="h-12 border-b border-[#1f2b45] bg-[#0e1424] px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          {/* Group By selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-semibold">Row Group:</span>
            <select
              value={groupByCol}
              onChange={(e) => setGroupByCol(e.target.value)}
              className="bg-[#141b2c] border border-[#24324f] rounded px-2 py-1 text-slate-200 outline-none cursor-pointer"
            >
              <option value="">(None - Full Raw Grid View)</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.dtype.split('(')[0]})
                </option>
              ))}
            </select>
          </div>

          {groupByCol && (
            <>
              <span className="text-slate-600">→</span>

              {/* Aggregation Function */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-semibold">Aggregation:</span>
                <select
                  value={aggFunc}
                  onChange={(e) => setAggFunc(e.target.value as any)}
                  className="bg-[#141b2c] border border-[#24324f] rounded px-2 py-1 text-slate-200 outline-none cursor-pointer"
                >
                  <option value="sum">SUM</option>
                  <option value="avg">AVERAGE</option>
                  <option value="count">COUNT</option>
                  <option value="min">MIN</option>
                  <option value="max">MAX</option>
                </select>
              </div>
            </>
          )}

          {/* Metric / Sort Column */}
          {(aggFunc !== 'count' || !groupByCol) && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">{groupByCol ? 'Measure:' : 'Sort Column:'}</span>
              <select
                value={metricCol}
                onChange={(e) => setMetricCol(e.target.value)}
                className="bg-[#141b2c] border border-[#24324f] rounded px-2 py-1 text-slate-200 outline-none cursor-pointer"
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={executePivot}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recalculate</span>
          </button>
        </div>

        {/* View Switcher: Table vs Bar */}
        <div className="flex items-center bg-[#141b2c] p-0.5 rounded-lg border border-[#24324f]">
          <button
            onClick={() => setChartType('table')}
            className={`p-1.5 rounded ${chartType === 'table' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            title="Pivot Matrix Table"
          >
            <TableIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setChartType('bar')}
            className={`p-1.5 rounded ${chartType === 'bar' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            title="GPU-style Grouped Bar Chart"
          >
            <BarChart3 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Pivot Stage */}
      <div className="flex-1 p-4 overflow-y-auto">
        {chartType === 'table' ? (
          <div className="bg-[#101728] rounded-xl border border-[#1f2b45] overflow-x-auto shadow-xl">
            {groupByCol ? (
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#151f36] border-b border-[#24324f] text-slate-300">
                  <tr>
                    <th className="py-2.5 px-4 font-bold">{groupByCol.toUpperCase()}</th>
                    <th className="py-2.5 px-4 font-bold text-right">{aggFunc.toUpperCase()} OF {metricCol.toUpperCase()}</th>
                    <th className="py-2.5 px-4 font-bold text-right">TOTAL ROWS</th>
                    <th className="py-2.5 px-4 font-bold">DISTRIBUTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2640]">
                  {data.map((row, idx) => {
                    const val = Number(row.metric_value) || 0;
                    const pct = Math.min(100, Math.round((val / maxVal) * 100));
                    return (
                      <tr key={idx} className="hover:bg-[#151e33] transition-colors">
                        <td className="py-2 px-4 font-semibold text-slate-200 flex items-center gap-1.5">
                          <ChevronRight className="w-3 h-3 text-blue-400" />
                          <span>{String(row[groupByCol] ?? 'NULL')}</span>
                        </td>
                        <td className="py-2 px-4 text-right text-blue-400 font-bold">
                          {val.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-4 text-right text-slate-400">
                          {Number(row.row_count).toLocaleString()}
                        </td>
                        <td className="py-2 px-4 w-64">
                          <div className="w-full bg-[#1e2a47] rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#151f36] border-b border-[#24324f] text-slate-300">
                  <tr>
                    <th className="py-2.5 px-3 font-bold text-slate-500 w-12">#</th>
                    {columns.map((c) => (
                      <th key={c.name} className="py-2.5 px-4 font-bold text-slate-200">
                        {c.name.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2640]">
                  {data.map((row, idx) => (
                    <tr key={idx} className="hover:bg-[#151e33] transition-colors">
                      <td className="py-2 px-3 text-slate-500">{idx + 1}</td>
                      {columns.map((c) => (
                        <td key={c.name} className="py-2 px-4 text-slate-300 whitespace-nowrap">
                          {String(row[c.name] ?? 'NULL')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl mx-auto pt-4">
            {data.map((row, idx) => {
              const label = groupByCol ? String(row[groupByCol] ?? 'NULL') : String(row[columns[0]?.name] ?? `#${idx + 1}`);
              const val = groupByCol ? (Number(row.metric_value) || 0) : (Number(row[metricCol]) || 0);
              const pct = Math.min(100, Math.round((val / maxVal) * 100));
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-semibold text-slate-200">{label}</span>
                    <span className="font-bold text-blue-400">{val.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="w-full bg-[#151e33] rounded-md h-6 overflow-hidden flex items-center p-1 border border-[#202c47]">
                    <div
                      className="bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 h-4 rounded transition-all duration-500"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
