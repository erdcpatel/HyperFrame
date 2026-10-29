import React, { useState, useRef } from 'react';
import {
  Database,
  FileSpreadsheet,
  PlusCircle,
  Search,
  Hash,
  Type,
  Calendar,
  Layers,
  PieChart,
  HardDrive,
  Cpu,
  Upload,
  RefreshCw,
  Sparkles,
  PanelLeftClose,
  Trash2,
  Cloud
} from 'lucide-react';
import { DatasetSummary, DatasetWeather, ColumnWeather } from '../../types';

interface Props {
  datasets: DatasetSummary[];
  activeDatasetId: string | null;
  onSelectDataset: (id: string) => void;
  weather: DatasetWeather | null;
  loadingWeather: boolean;
  onScanFolder: () => void;
  onUploadFile: (file: File) => void;
  onDeleteDataset?: (id: string) => void;
  onToggleCollapse?: () => void;
  onOpenS3Modal?: () => void;
}

export const Sidebar: React.FC<Props> = ({
  datasets,
  activeDatasetId,
  onSelectDataset,
  weather,
  loadingWeather,
  onScanFolder,
  onUploadFile,
  onDeleteDataset,
  onToggleCollapse,
  onOpenS3Modal,
}) => {
  const [colSearch, setColSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUploadFile(e.target.files[0]);
    }
  };

  const filteredColumns = React.useMemo(() => {
    if (!weather?.columns) return [];
    if (!colSearch.trim()) return weather.columns;
    const term = colSearch.toLowerCase();
    return weather.columns.filter((c) => c.name.toLowerCase().includes(term) || c.dtype.toLowerCase().includes(term));
  }, [weather, colSearch]);

  const renderTypeIcon = (dtype: string) => {
    const d = dtype.toLowerCase();
    if (d.includes('int') || d.includes('float') || d.includes('double') || d.includes('decimal')) {
      return <Hash className="w-3 h-3 text-sky-400" />;
    }
    if (d.includes('timestamp') || d.includes('date') || d.includes('time')) {
      return <Calendar className="w-3 h-3 text-amber-400" />;
    }
    return <Type className="w-3 h-3 text-emerald-400" />;
  };

  return (
    <aside className="w-80 border-r border-[#1f2b45] bg-[#0d121e] flex flex-col h-full select-none">
      {/* Datasets Section */}
      <div className="p-3 border-b border-[#1f2b45]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            <span>Datasets Catalog</span>
          </div>
          <div className="flex items-center gap-1">
            {onOpenS3Modal && (
              <button
                onClick={onOpenS3Modal}
                className="p-1 hover:bg-[#1a233a] rounded text-slate-400 hover:text-amber-400 transition-colors"
                title="Connect & Browse AWS S3 Buckets / Folders"
              >
                <Cloud className="w-3.5 h-3.5 text-amber-400" />
              </button>
            )}
            <button
              onClick={onScanFolder}
              className="p-1 hover:bg-[#1a233a] rounded text-slate-400 hover:text-sky-400 transition-colors"
              title="Scan backend/data/ folder for dropped .parquet files"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1 hover:bg-[#1a233a] rounded text-slate-400 hover:text-emerald-400 transition-colors"
              title="Upload Parquet, CSV, or Excel (.xlsx, .xls) file"
            >
              <Upload className="w-3 h-3" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".parquet,.pqt,.csv,.tsv,.xlsx,.xls"
              className="hidden"
            />
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-1 hover:bg-[#1a233a] rounded text-slate-400 hover:text-slate-200 transition-colors ml-1"
                title="Hide sidebar (Full Screen Grid - Ctrl+B)"
              >
                <PanelLeftClose className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <select
            value={activeDatasetId || ''}
            onChange={(e) => onSelectDataset(e.target.value)}
            className="flex-1 bg-[#141b2c] border border-[#24324f] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
          >
            {datasets.map((d) => {
              const isS3 = d.source === 's3' || d.path?.startsWith('s3://') || d.file_name.startsWith('☁️');
              return (
                <option key={d.dataset_id} value={d.dataset_id}>
                  {isS3 ? `☁️ ${d.dataset_id}` : d.dataset_id} ({(d.row_count / 1000).toFixed(0)}k rows · {d.file_size_formatted})
                </option>
              );
            })}
            {datasets.length === 0 && <option value="">No datasets uploaded</option>}
          </select>
          {activeDatasetId && onDeleteDataset && (
            <button
              onClick={() => onDeleteDataset(activeDatasetId)}
              className="p-1.5 hover:bg-[#201826] rounded-lg text-slate-500 hover:text-rose-400 border border-transparent hover:border-rose-900/40 transition-colors"
              title="Delete this dataset from catalog"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Quick Management Action Pills */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#1a233a] text-[10px] font-mono">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
            title="Upload Parquet, CSV, or Excel file"
          >
            <Upload className="w-3 h-3" />
            <span>Upload File</span>
          </button>

          {onOpenS3Modal && (
            <button
              onClick={onOpenS3Modal}
              className="text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
              title="Connect and ingest from AWS S3 Lakehouse"
            >
              <Cloud className="w-3 h-3" />
              <span>S3 Cloud</span>
            </button>
          )}

          <button
            onClick={onScanFolder}
            className="text-slate-400 hover:text-sky-300 flex items-center gap-1 transition-colors"
            title="Scan backend/data/ folder for new files"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Scan Folder</span>
          </button>
        </div>
      </div>

      {/* Data Weather Card */}
      {weather && (
        <div className="p-3 border-b border-[#1f2b45] bg-[#0f1524]">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <PieChart className="w-3.5 h-3.5 text-indigo-400" />
              <span>Data Weather</span>
            </div>
            {(weather.path.startsWith('s3://') || weather.file_name.startsWith('☁️')) && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Cloud className="w-2.5 h-2.5" />
                <span>S3 Lakehouse</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-[#151d30] p-2 rounded border border-[#202c47]">
              <span className="text-[10px] text-slate-400 block">Total Rows</span>
              <span className="font-mono font-bold text-slate-100 text-sm">
                {weather.row_count.toLocaleString()}
              </span>
            </div>
            <div className="bg-[#151d30] p-2 rounded border border-[#202c47]">
              <span className="text-[10px] text-slate-400 block">Columns</span>
              <span className="font-mono font-bold text-slate-100 text-sm">
                {weather.column_count} cols
              </span>
            </div>
            <div className="bg-[#151d30] p-2 rounded border border-[#202c47]">
              <span className="text-[10px] text-slate-400 block">Compressed Disk</span>
              <span className="font-mono font-semibold text-emerald-400 text-xs flex items-center gap-1">
                <HardDrive className="w-3 h-3 inline" />
                {weather.file_size_formatted}
              </span>
            </div>
            <div className="bg-[#151d30] p-2 rounded border border-[#202c47]">
              <span className="text-[10px] text-slate-400 block">Est. RAM Footprint</span>
              <span className="font-mono font-semibold text-amber-400 text-xs flex items-center gap-1">
                <Cpu className="w-3 h-3 inline" />
                ~{weather.est_uncompressed_formatted}
              </span>
            </div>
          </div>

          <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between font-mono bg-[#141b2c] px-2 py-1 rounded">
            <span>Compression: <b className="text-slate-200">{weather.compression_ratio}x</b></span>
            <span>Row Groups: <b className="text-slate-200">{weather.row_groups}</b></span>
          </div>
        </div>
      )}

      {/* Column Schema & Cardinality Profiler */}
      <div className="flex-1 flex flex-col min-h-0 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>Column Profiler ({filteredColumns.length})</span>
          </span>
        </div>

        {/* Search bar */}
        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
          <input
            type="text"
            placeholder="Search columns or types..."
            value={colSearch}
            onChange={(e) => setColSearch(e.target.value)}
            className="w-full bg-[#131b2e] border border-[#24324f] rounded-md pl-8 pr-2 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
          />
        </div>

        {/* Column list */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filteredColumns.map((col) => (
            <div
              key={col.name}
              className="p-2 rounded-md bg-[#131b2e] hover:bg-[#18233b] border border-[#1f2b45] transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 truncate">
                  {renderTypeIcon(col.dtype)}
                  <span className="text-xs font-semibold text-slate-200 truncate">{col.name}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-400 px-1 py-0.5 rounded bg-[#1a253f]">
                  {col.dtype.split('(')[0]}
                </span>
              </div>

              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>
                  Card: <b className="text-sky-300">{col.approx_unique ? col.approx_unique.toLocaleString() : 'N/A'}</b>
                </span>
                <span>
                  Null: <b className={col.null_percentage > 0 ? 'text-rose-400' : 'text-emerald-400'}>{col.null_percentage}%</b>
                </span>
              </div>

              {col.min_value !== null && col.min_value !== undefined && (
                <div className="mt-0.5 text-[9px] text-slate-500 font-mono truncate">
                  [{col.min_value} ... {col.max_value}]
                </div>
              )}
            </div>
          ))}
          {filteredColumns.length === 0 && (
            <div className="text-center text-xs text-slate-500 py-4">No matching columns</div>
          )}
        </div>
      </div>
    </aside>
  );
};
