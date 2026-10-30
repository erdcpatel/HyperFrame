import React, { useState } from 'react';
import { FilterBar } from './FilterBar';
import { AgGridCanvas } from './AgGridCanvas';
import { PerspectiveCanvas } from './PerspectiveCanvas';
import { QueryEditor } from './QueryEditor';
import { ColumnWeather, EngineType, HyperFilter, QueryWaterfall, HyperQuery } from '../../types';
import { exportQueryCsv } from '../../services/api';

interface Props {
  datasetId: string;
  engine: EngineType;
  columns: ColumnWeather[];
  onWaterfallUpdate: (w: QueryWaterfall, queryStr: string, totalRows: number, returnedRows: number) => void;
  onLoadingChange?: (loading: boolean, message?: string) => void;
}

export const StudioView: React.FC<Props> = React.memo(({
  datasetId,
  engine,
  columns,
  onWaterfallUpdate,
  onLoadingChange,
}) => {
  const [filters, setFilters] = useState<HyperFilter[]>([]);
  const [quickSearch, setQuickSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'pivot' | 'sql'>('grid');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const handleAddFilter = (f: HyperFilter) => {
    setFilters([...filters, f]);
  };

  const handleRemoveFilter = (idx: number) => {
    setFilters(filters.filter((_, i) => i !== idx));
  };

  const handleClearFilters = () => {
    setFilters([]);
  };

  const handleExportCsv = async () => {
    if (isExporting) return;
    setIsExporting(true);
    onLoadingChange?.(true, `Exporting CSV (${engine.toUpperCase()})...`);
    try {
      const q: HyperQuery = {
        dataset: datasetId,
        engine,
        filters,
        quick_search: quickSearch.trim() || undefined,
        limit: 100000,
      };
      await exportQueryCsv(q);
    } catch (err: any) {
      console.error('Export failed:', err);
      alert(`Export failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
      onLoadingChange?.(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#0a0d16]">
      {/* Top Filter & View Controls */}
      <FilterBar
        columns={columns}
        filters={filters}
        onAddFilter={handleAddFilter}
        onRemoveFilter={handleRemoveFilter}
        onClearFilters={handleClearFilters}
        quickSearch={quickSearch}
        onQuickSearchChange={setQuickSearch}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportCsv={handleExportCsv}
        isExporting={isExporting}
      />

      {/* Main Analytical Stage */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {viewMode === 'grid' && (
          <AgGridCanvas
            datasetId={datasetId}
            engine={engine}
            columns={columns}
            filters={filters}
            quickSearch={quickSearch}
            onWaterfallUpdate={onWaterfallUpdate}
            onLoadingChange={onLoadingChange}
          />
        )}

        {viewMode === 'pivot' && (
          <PerspectiveCanvas
            datasetId={datasetId}
            engine={engine}
            columns={columns}
            onWaterfallUpdate={onWaterfallUpdate}
            onLoadingChange={onLoadingChange}
          />
        )}

        {viewMode === 'sql' && (
          <QueryEditor
            datasetId={datasetId}
            engine={engine}
            columns={columns}
            onWaterfallUpdate={onWaterfallUpdate}
            onLoadingChange={onLoadingChange}
          />
        )}
      </div>
    </div>
  );
});
