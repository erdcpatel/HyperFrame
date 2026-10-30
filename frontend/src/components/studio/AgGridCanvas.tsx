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
  onLoadingChange?: (loading: boolean, message?: string) => void;
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
  onLoadingChange,
}) => {
  const gridRef = useRef<AgGridReact>(null);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [fetchMessage, setFetchMessage] = useState<string>('');

  // Keep a stable ref for onWaterfallUpdate so datasource does not re-instantiate on telemetry ticks
  const onWaterfallUpdateRef = useRef(onWaterfallUpdate);
  useEffect(() => {
    onWaterfallUpdateRef.current = onWaterfallUpdate;
  }, [onWaterfallUpdate]);

  const onLoadingChangeRef = useRef(onLoadingChange);
  useEffect(() => {
    onLoadingChangeRef.current = onLoadingChange;
  }, [onLoadingChange]);

  const [dynamicCols, setDynamicCols] = useState<string[]>([]);

  // Derive column definitions from dataset schema with primary key pinned left
  const colDefs: ColDef[] = useMemo(() => {
    const activeCols = columns.length > 0
      ? columns.map((c) => ({ name: c.name, dtype: c.dtype }))
      : dynamicCols.map((name) => ({ name, dtype: 'VARCHAR' }));

    return activeCols.map((col, idx) => {
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
  }, [columns, dynamicCols]);

  const [gridError, setGridError] = useState<string | null>(null);

  // Infinite row model datasource
  const datasource: IDatasource = useMemo(() => {
    return {
      getRows: async (params: IGetRowsParams) => {
        const msg = `Rows ${params.startRow.toLocaleString()}–${params.endRow.toLocaleString()}`;
        setIsFetching(true);
        setFetchMessage(msg);
        onLoadingChangeRef.current?.(true, msg);
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

          if (res.rows.length > 0 && columns.length === 0) {
            setDynamicCols(Object.keys(res.rows[0]));
          }

          const effectiveTotal = Math.max(res.totalCount ?? 0, res.rows.length);
          if (onWaterfallUpdateRef.current) {
            onWaterfallUpdateRef.current(waterfallWithRender, res.query_string, effectiveTotal, res.rows.length);
          }
          params.successCallback(res.rows, effectiveTotal);
        } catch (err: any) {
          const detail = err.response?.data?.detail || err.message || 'Engine query failed to complete';
          console.error('AG Grid datasource error:', err);
          setGridError(detail);
          params.failCallback();
        } finally {
          setIsFetching(false);
          onLoadingChangeRef.current?.(false);
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
    <div className="w-full h-full ag-theme-alpine-dark flex-1 relative overflow-hidden">
      {/* Top Indeterminate Loading Bar during Query Execution */}
      {isFetching && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-blue-950/60 overflow-hidden z-20">
          <div className="h-full bg-gradient-to-r from-blue-500 via-sky-300 to-indigo-500 animate-pulse w-full shadow-sm shadow-sky-400" />
        </div>
      )}

      {/* Floating Engine Query Status HUD */}
      {isFetching && (
        <div className="absolute bottom-5 right-6 z-20 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#0c1220]/95 backdrop-blur-md border border-blue-500/40 shadow-2xl shadow-black/70 text-xs font-mono text-blue-300 pointer-events-none select-none transition-all">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 font-bold text-white uppercase text-[11px]">
              <span className="text-blue-400">{engine}</span>
              <span className="text-slate-400 font-normal">| Querying Engine</span>
            </div>
            <div className="text-[10px] text-slate-300">{fetchMessage}</div>
          </div>
        </div>
      )}
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
