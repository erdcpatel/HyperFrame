import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, IDatasource, IGetRowsParams } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { ColumnWeather, EngineType, HyperFilter, QueryWaterfall } from '../../types';
import { queryAgGrid } from '../../services/api';

interface Props {
  datasetId: string;
  engine: EngineType;
  columns: ColumnWeather[];
  filters: HyperFilter[];
  quickSearch: string;
  onWaterfallUpdate: (w: QueryWaterfall, queryStr: string, totalRows: number, returnedRows: number) => void;
}

// Stable defaultColDef defined outside component to prevent AG Grid recreation on parent re-renders
const DEFAULT_COL_DEF: ColDef = {
  flex: 1,
  minWidth: 120,
  sortable: true,
  filter: true,
  resizable: true,
  filterParams: {
    buttons: ['apply', 'clear'],
    closeOnApply: false,
    debounceMs: 200,
  },
};

export const AgGridCanvas: React.FC<Props> = React.memo(({
  datasetId,
  engine,
  columns,
  filters,
  quickSearch,
  onWaterfallUpdate,
}) => {
  const gridRef = useRef<AgGridReact>(null);

  // Keep a stable ref for onWaterfallUpdate so datasource does not re-instantiate on telemetry ticks
  const onWaterfallUpdateRef = useRef(onWaterfallUpdate);
  useEffect(() => {
    onWaterfallUpdateRef.current = onWaterfallUpdate;
  }, [onWaterfallUpdate]);

  // Derive column definitions from dataset schema with primary key pinned left
  const colDefs: ColDef[] = useMemo(() => {
    return columns.map((col, idx) => {
      const isNum = col.dtype.toLowerCase().includes('int') || col.dtype.toLowerCase().includes('float') || col.dtype.toLowerCase().includes('double');
      const isPrimaryKey = idx === 0 || ['id', 'trade_id', 'key', 'index'].includes(col.name.toLowerCase());
      return {
        field: col.name,
        headerName: col.name,
        pinned: isPrimaryKey ? 'left' : undefined,
        sortable: true,
        filter: isNum ? 'agNumberColumnFilter' : 'agTextColumnFilter',
        resizable: true,
        type: isNum ? 'numericColumn' : undefined,
        valueFormatter: isNum && col.name.includes('notional')
          ? (p) => p.value !== null && p.value !== undefined ? `$${Number(p.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
          : undefined,
        cellClass: isNum ? 'font-mono text-right' : 'font-mono text-xs',
      };
    });
  }, [columns]);

  const [gridError, setGridError] = useState<string | null>(null);

  // Infinite row model datasource
  const datasource: IDatasource = useMemo(() => {
    return {
      getRows: async (params: IGetRowsParams) => {
        try {
          setGridError(null);
          const tStart = performance.now();
          const res = await queryAgGrid({
            dataset: datasetId,
            engine,
            startRow: params.startRow,
            endRow: params.endRow,
            filterModel: params.filterModel,
            customFilters: filters,
            sortModel: params.sortModel,
            quickSearch,
          });

          const tRender = performance.now() - tStart;
          const waterfallWithRender = {
            ...res.waterfall,
            client_render_ms: Math.round(tRender),
          };

          if (onWaterfallUpdateRef.current) {
            onWaterfallUpdateRef.current(waterfallWithRender, res.query_string, res.totalCount, res.rows.length);
          }
          params.successCallback(res.rows, res.totalCount);
        } catch (err: any) {
          const detail = err.response?.data?.detail || err.message || 'Engine query failed to complete';
          console.error('AG Grid datasource error:', err);
          setGridError(detail);
          params.failCallback();
        }
      },
    };
  }, [datasetId, engine, filters, quickSearch]);

  useEffect(() => {
    if (gridRef.current?.api) {
      gridRef.current.api.setGridOption('datasource', datasource);
    }
  }, [datasource]);

  return (
    <div className="w-full h-full ag-theme-alpine-dark flex-1 relative">
      {gridError && (
        <div className="absolute inset-0 bg-[#0a0d16]/95 backdrop-blur-md z-30 flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4 shadow-lg shadow-amber-950/30">
            <AlertCircle className="w-7 h-7 text-amber-400" />
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-2">
            Engine Halted: <span className="uppercase text-amber-400">{engine}</span>
          </h3>
          <div className="max-w-xl mb-4 font-mono text-xs text-amber-200/90 bg-[#121929] border border-[#24324f] rounded-lg p-3 text-left leading-relaxed">
            {gridError}
          </div>
          {engine === 'perspective' && (
            <p className="text-xs text-slate-400 max-w-lg mb-6 leading-relaxed">
              Perspective 5.x is an <b>In-Memory C++</b> engine requiring all records to be loaded into RAM (~3–5 GB for an 82 MB compressed Parquet file). For large datasets, use out-of-core streaming engines.
            </p>
          )}
          <button
            onClick={() => setGridError(null)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#18233c] hover:bg-[#202f50] text-slate-200 text-xs font-semibold border border-[#2a3c61] transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
            <span>Dismiss & Retry</span>
          </button>
        </div>
      )}
      <AgGridReact
        ref={gridRef}
        columnDefs={colDefs}
        rowModelType="infinite"
        datasource={datasource}
        paginationPageSize={2000}
        cacheBlockSize={2000}
        maxBlocksInCache={50}
        blockLoadDebounceMillis={60}
        rowHeight={32}
        headerHeight={34}
        defaultColDef={DEFAULT_COL_DEF}
        popupParent={typeof document !== 'undefined' ? document.body : undefined}
      />
    </div>
  );
});
