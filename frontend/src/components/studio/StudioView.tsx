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
}

export const StudioView: React.FC<Props> = ({
  datasetId,
  engine,
  columns,
  onWaterfallUpdate,
}) => {
  const [filters, setFilters] = useState<HyperFilter[]>([]);
  const [quickSearch, setQuickSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'pivot' | 'sql'>('grid');

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
    try {
      const q: HyperQuery = {
        dataset: datasetId,
        engine,
        filters,
        limit: 50000,
      };
      await exportQueryCsv(q);
    } catch (err) {
      console.error('Export failed:', err);
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
          />
        )}

        {viewMode === 'pivot' && (
          <PerspectiveCanvas
            datasetId={datasetId}
            engine={engine}
            columns={columns}
            onWaterfallUpdate={onWaterfallUpdate}
          />
        )}

        {viewMode === 'sql' && (
          <QueryEditor
            datasetId={datasetId}
            engine={engine}
            onWaterfallUpdate={onWaterfallUpdate}
          />
        )}
      </div>
    </div>
  );
};
