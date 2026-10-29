import React, { useState } from 'react';
import {
  Filter,
  Plus,
  X,
  Search,
  Grid,
  BarChart3,
  Code2,
  Download
} from 'lucide-react';
import { ColumnWeather, HyperFilter, FilterOperator } from '../../types';

interface Props {
  columns: ColumnWeather[];
  filters: HyperFilter[];
  onAddFilter: (f: HyperFilter) => void;
  onRemoveFilter: (index: number) => void;
  onClearFilters: () => void;
  quickSearch: string;
  onQuickSearchChange: (val: string) => void;
  viewMode: 'grid' | 'pivot' | 'sql';
  onViewModeChange: (mode: 'grid' | 'pivot' | 'sql') => void;
  onExportCsv?: () => void;
}

export const FilterBar: React.FC<Props> = ({
  columns,
  filters,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
  quickSearch,
  onQuickSearchChange,
  viewMode,
  onViewModeChange,
  onExportCsv,
}) => {
  const [selectedCol, setSelectedCol] = useState(columns[0]?.name || '');
  const [operator, setOperator] = useState<FilterOperator>('equals');
  const [filterVal, setFilterVal] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCol) return;
    onAddFilter({
      column: selectedCol,
      operator,
      value: filterVal,
    });
    setFilterVal('');
  };

  return (
    <div className="border-b border-[#1f2b45] bg-[#0f1422] p-2.5 flex flex-col gap-2 select-none">
      {/* Top Controls: View Mode & Add Filter Form */}
      <div className="flex items-center justify-between gap-3">
        {/* View Mode Toggle */}
        <div className="flex items-center bg-[#141b2c] p-0.5 rounded-lg border border-[#24324f]">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              viewMode === 'grid'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Infinite Grid</span>
          </button>
          <button
            onClick={() => onViewModeChange('pivot')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              viewMode === 'pivot'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Perspective Pivot</span>
          </button>
          <button
            onClick={() => onViewModeChange('sql')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
              viewMode === 'sql'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>SQL Playground</span>
          </button>
        </div>

        {/* Filter Input Form */}
        <form onSubmit={handleAdd} className="flex items-center gap-1.5 flex-1 max-w-xl">
          <div className="flex items-center gap-1 text-slate-400 text-xs font-semibold mr-1">
            <Filter className="w-3.5 h-3.5 text-blue-400" />
            <span>Filter:</span>
          </div>

          {/* Column select */}
          <select
            value={selectedCol}
            onChange={(e) => setSelectedCol(e.target.value)}
            className="bg-[#141b2c] border border-[#24324f] rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
          >
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Operator select */}
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value as FilterOperator)}
            className="bg-[#141b2c] border border-[#24324f] rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="equals">== (Equals)</option>
            <option value="not_equals">!= (Not Equal)</option>
            <option value="greater_than">&gt; (Greater Than)</option>
            <option value="greater_than_or_equal">&gt;= (Greater or Equal)</option>
            <option value="less_than">&lt; (Less Than)</option>
            <option value="less_than_or_equal">&lt;= (Less or Equal)</option>
            <option value="contains">contains</option>
            <option value="starts_with">starts with</option>
            <option value="is_null">is null</option>
            <option value="is_not_null">is not null</option>
          </select>

          {/* Value input */}
          {!['is_null', 'is_not_null'].includes(operator) && (
            <input
              type="text"
              placeholder="Filter value..."
              value={filterVal}
              onChange={(e) => setFilterVal(e.target.value)}
              className="bg-[#141b2c] border border-[#24324f] rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 flex-1"
            />
          )}

          {/* Add button */}
          <button
            type="submit"
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </form>

        {/* Quick Search & Export */}
        <div className="flex items-center gap-2">
          <div className="relative w-40">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-500" />
            <input
              type="text"
              placeholder="Quick search..."
              value={quickSearch}
              onChange={(e) => onQuickSearchChange(e.target.value)}
              className="w-full bg-[#141b2c] border border-[#24324f] rounded pl-7 pr-2 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
            />
          </div>

          {onExportCsv && (
            <button
              onClick={onExportCsv}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#162035] hover:bg-[#1f2c4a] text-slate-200 text-xs font-medium border border-[#24324f] transition-colors"
              title="Export filtered dataset to CSV"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Export</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Filter Chips */}
      {filters.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-[#1a2338]">
          <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Active:</span>
          {filters.map((f, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-300 border border-blue-500/30"
            >
              <span className="font-semibold">{f.column}</span>
              <span className="text-slate-400">{f.operator}</span>
              {f.value !== undefined && <span className="font-mono text-white font-bold">{f.value}</span>}
              <button
                onClick={() => onRemoveFilter(idx)}
                className="hover:text-rose-400 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          <button
            onClick={onClearFilters}
            className="text-[10px] text-slate-500 hover:text-slate-300 underline ml-2"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};
