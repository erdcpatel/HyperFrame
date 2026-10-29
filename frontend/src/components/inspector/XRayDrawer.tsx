import React from 'react';
import { X, FileCode2, Terminal, Layers } from 'lucide-react';
import { SyntaxHighlighter } from '../common/SyntaxHighlighter';
import { QueryWaterfall } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  queryString?: string;
  planString?: string;
  engine: string;
  waterfall: QueryWaterfall | null;
}

export const XRayDrawer: React.FC<Props> = ({
  open,
  onClose,
  queryString,
  planString,
  engine,
  waterfall,
}) => {
  if (!open) return null;

  return (
    <div className="h-64 border-t border-[#24324f] bg-[#0b0f19] flex flex-col z-10 transition-all select-none">
      {/* Drawer Header */}
      <div className="h-9 border-b border-[#1f2b45] px-4 flex items-center justify-between bg-[#0e1424]">
        <div className="flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-bold text-slate-200">X-Ray Query Inspector</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
            Engine: {engine.toUpperCase()}
          </span>
          {waterfall && (
            <span className="text-[10px] font-mono text-slate-400 ml-2">
              RSS Delta: <b className="text-amber-300">{waterfall.rss_delta_mb > 0 ? `+${waterfall.rss_delta_mb}` : waterfall.rss_delta_mb} MB</b>
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[#1a243d] rounded text-slate-400 hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Content */}
      <div className="flex-1 grid grid-cols-2 gap-3 p-3 overflow-hidden">
        {/* Executed Query */}
        <div className="flex flex-col min-h-0 bg-[#0f1526] rounded-lg border border-[#202c47] p-2">
          <div className="text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span>Compiled Query / Expression</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SyntaxHighlighter
              code={queryString || '-- No active query executed yet.'}
              language="sql"
              className="h-full border-none"
            />
          </div>
        </div>

        {/* Physical Plan */}
        <div className="flex flex-col min-h-0 bg-[#0f1526] rounded-lg border border-[#202c47] p-2">
          <div className="text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Execution Physical Plan (EXPLAIN ANALYZE)</span>
          </div>
          <div className="flex-1 overflow-y-auto bg-[#0a0e18] p-3 rounded font-mono text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">
            {planString || 'Physical plan will appear here after query execution.'}
          </div>
        </div>
      </div>
    </div>
  );
};
