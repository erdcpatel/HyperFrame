import React from 'react';
import {
  Layers,
  Swords,
  Trash2,
  Flame,
  Cpu,
  Database,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
  Cloud,
  RotateCw
} from 'lucide-react';
import { EngineType } from '../../types';

interface Props {
  mode: 'studio' | 'arena' | 's3';
  setMode: (m: 'studio' | 'arena' | 's3') => void;
  activeEngine: EngineType;
  onEngineChange: (engine: EngineType) => void;
  serverRssMb: number;
  onPurgeMemory: () => void;
  onOpenTortureModal: () => void;
  totalMatchingRows?: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  isQueryLoading?: boolean;
  loadingMessage?: string;
}

export const Header: React.FC<Props> = ({
  mode,
  setMode,
  activeEngine,
  onEngineChange,
  serverRssMb,
  onPurgeMemory,
  onOpenTortureModal,
  totalMatchingRows,
  sidebarOpen,
  onToggleSidebar,
  isQueryLoading,
  loadingMessage
}) => {
  return (
    <header className="h-14 border-b border-[#1f2b45] bg-[#0c101a] px-4 flex items-center justify-between select-none">
      {/* Brand & Title */}
      <div className="flex items-center gap-3">
        {/* Toggle Sidebar Button */}
        <button
          onClick={onToggleSidebar}
          className={`p-1.5 rounded-lg border transition-all ${
            sidebarOpen
              ? 'border-[#24324f] bg-[#131b2e] text-slate-400 hover:text-slate-200 hover:bg-[#1a233a]'
              : 'border-blue-500/40 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 shadow-sm shadow-blue-500/20'
          }`}
          title={sidebarOpen ? 'Hide Sidebar (Full Screen Grid - Ctrl+B)' : 'Show Sidebar (Ctrl+B)'}
        >
          {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </button>

        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-wider text-base bg-gradient-to-r from-blue-400 via-indigo-300 to-sky-400 bg-clip-text text-transparent">
              HYPERFRAME
            </span>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Studio
            </span>
          </div>
          <p className="text-[10px] text-slate-400 font-mono">Ad-Hoc Large Dataset Benchmarking Workbench</p>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex items-center bg-[#131b2e] p-1 rounded-lg border border-[#24324f]">
        <button
          onClick={() => setMode('studio')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            mode === 'studio'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Studio Workbench</span>
        </button>
        <button
          onClick={() => setMode('arena')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            mode === 'arena'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Swords className="w-3.5 h-3.5" />
          <span>Arena Race Mode</span>
        </button>
        <button
          onClick={() => setMode('s3')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            mode === 's3'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cloud className="w-3.5 h-3.5" />
          <span>S3</span>
        </button>
      </div>

      {/* Actions & Engine Controls */}
      <div className="flex items-center gap-3">
        {mode === 'studio' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-[#131b2e] px-2.5 py-1 rounded-lg border border-[#24324f]">
              <span className="text-[11px] text-slate-400 font-mono">Engine:</span>
              <select
                value={activeEngine}
                onChange={(e) => onEngineChange(e.target.value as EngineType)}
                className="bg-transparent text-xs font-semibold text-blue-400 outline-none cursor-pointer"
              >
                <option value="duckdb" className="bg-[#131b2e] text-slate-200">DuckDB 2.0 (Out-of-Core)</option>
                <option value="polars" className="bg-[#131b2e] text-slate-200">Polars 2.x (Streaming)</option>
                <option value="perspective" className="bg-[#131b2e] text-slate-200">Perspective 5.x (In-Memory)</option>
              </select>
            </div>

            {/* Live Engine Busy / Loading Indicator */}
            {isQueryLoading ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/40 text-blue-300 text-xs font-mono shadow-sm shadow-blue-500/20 animate-pulse">
                <RotateCw className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
                <span className="font-bold uppercase text-[11px] text-blue-300">{activeEngine}</span>
                <span className="text-[10px] text-slate-300 truncate max-w-[170px]">{loadingMessage || 'Executing query...'}</span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Engine Ready</span>
              </div>
            )}
          </div>
        )}

        {/* Server Memory & Force GC */}
        <div className="flex items-center gap-1.5 bg-[#131b2e] px-2.5 py-1 rounded-lg border border-[#24324f]" title="Server (VM Host) Process Resident Memory (RSS)">
          <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="text-xs font-mono text-slate-300">
            <span className="text-slate-500 text-[10px] mr-1">VM:</span>
            {serverRssMb.toFixed(0)} <span className="text-slate-500 text-[10px]">MB RSS</span>
          </span>
          <button
            onClick={onPurgeMemory}
            className="p-1 hover:bg-[#1e2a47] rounded text-slate-400 hover:text-rose-400 transition-colors ml-1"
            title="Force GC & Unload Memory on VM"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* 1-Click Torture Test Runner Button */}
        <button
          onClick={onOpenTortureModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-900/30 transition-all active:scale-95"
        >
          <Flame className="w-3.5 h-3.5" />
          <span>Torture Suite</span>
        </button>
      </div>
    </header>
  );
};
