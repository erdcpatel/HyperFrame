import React, { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, IDatasource, IGetRowsParams } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

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

  // Derive column definitions from dataset schema
  const colDefs: ColDef[] = useMemo(() => {
    return columns.map((col) => {
      const isNum = col.dtype.toLowerCase().includes('int') || col.dtype.toLowerCase().includes('float') || col.dtype.toLowerCase().includes('double');
      return {
        field: col.name,
        headerName: col.name,
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

  // Infinite row model datasource
  const datasource: IDatasource = useMemo(() => {
    return {
      getRows: async (params: IGetRowsParams) => {
        try {
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
        } catch (err) {
          console.error('AG Grid datasource error:', err);
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
    <div className="w-full h-full ag-theme-alpine-dark flex-1">
      <AgGridReact
        ref={gridRef}
        columnDefs={colDefs}
        rowModelType="infinite"
        datasource={datasource}
        paginationPageSize={1000}
        cacheBlockSize={1000}
        maxBlocksInCache={50}
        blockLoadDebounceMillis={80}
        rowHeight={32}
        headerHeight={34}
        defaultColDef={DEFAULT_COL_DEF}
        popupParent={typeof document !== 'undefined' ? document.body : undefined}
      />
    </div>
  );
});
