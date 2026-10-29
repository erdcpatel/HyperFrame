import React from 'react';
import {
  Timer,
  Cpu,
  HardDrive,
  FileCode2,
  ChevronUp,
  ChevronDown,
  Activity,
  Layers
} from 'lucide-react';
import { QueryWaterfall, SystemTelemetry } from '../../types';

interface Props {
  waterfall: QueryWaterfall | null;
  telemetry: SystemTelemetry | null;
  totalMatchingRows?: number;
  returnedRows?: number;
  xrayOpen: boolean;
  onToggleXray: () => void;
}

export const Footer: React.FC<Props> = ({
  waterfall,
  telemetry,
  totalMatchingRows,
  returnedRows,
  xrayOpen,
  onToggleXray,
}) => {
  return (
    <footer className="h-10 border-t border-[#1f2b45] bg-[#0c101a] px-4 flex items-center justify-between text-xs select-none z-20">
      {/* Waterfall Breakdown */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
          <Timer className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-semibold text-slate-400">Waterfall:</span>
        </div>

        {waterfall ? (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="text-slate-400">
              Compile: <b className="text-slate-200">{waterfall.compile_ms.toFixed(1)}ms</b>
            </span>
            <span className="text-slate-600">→</span>
            <span className="text-slate-400">
              Engine: <b className="text-blue-400">{waterfall.engine_exec_ms.toFixed(1)}ms</b>
            </span>
            <span className="text-slate-600">→</span>
            <span className="text-slate-400">
              Serialize: <b className="text-indigo-400">{waterfall.serialization_ms.toFixed(1)}ms</b>
            </span>
            <span className="text-slate-600">=</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 font-bold border border-blue-500/20">
              Total: {waterfall.total_backend_ms.toFixed(1)}ms
            </span>
          </div>
        ) : (
          <span className="text-slate-500 font-mono text-[11px]">Ready for query execution</span>
        )}

        {totalMatchingRows !== undefined && (
          <div className="flex items-center gap-1.5 ml-3 font-mono text-[11px] text-slate-400">
            <Layers className="w-3 h-3 text-slate-500" />
            <span>Rows: <b className="text-slate-200">{returnedRows ?? 0}</b> / {totalMatchingRows.toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Server Health & X-Ray Plan Toggle */}
      <div className="flex items-center gap-4">
        {telemetry && (
          <div className="flex items-center gap-3 font-mono text-[11px]">
            {/* CPU */}
            <div className="flex items-center gap-1 text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>CPU: <b>{telemetry.cpu_percent_total.toFixed(0)}%</b></span>
              {/* Mini per-core sparkline indicator */}
              <div className="flex items-end gap-0.5 h-3 w-12 ml-1">
                {telemetry.cpu_percent_per_core.slice(0, 8).map((coreLoad, idx) => (
                  <div
                    key={idx}
                    className="w-1 bg-emerald-500/60 rounded-t-sm"
                    style={{ height: `${Math.max(15, coreLoad)}%` }}
                    title={`Core ${idx}: ${coreLoad}%`}
                  />
                ))}
              </div>
            </div>

            {/* RAM */}
            <div className="flex items-center gap-1 text-slate-300">
              <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              <span>RAM: <b>{telemetry.memory_rss_mb.toFixed(0)}MB</b></span>
              {waterfall && waterfall.rss_delta_mb !== 0 && (
                <span className={`text-[10px] ${waterfall.rss_delta_mb > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  ({waterfall.rss_delta_mb > 0 ? `+${waterfall.rss_delta_mb}` : waterfall.rss_delta_mb}MB)
                </span>
              )}
            </div>
          </div>
        )}

        {/* X-Ray Inspector Toggle Button */}
        <button
          onClick={onToggleXray}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            xrayOpen
              ? 'bg-blue-600 text-white'
              : 'bg-[#151d30] hover:bg-[#1e2a47] text-slate-300 border border-[#24324f]'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5 text-blue-400" />
          <span>X-Ray Plan</span>
          {xrayOpen ? <ChevronDown className="w-3 h-3 ml-0.5" /> : <ChevronUp className="w-3 h-3 ml-0.5" />}
        </button>
      </div>
    </footer>
  );
};
