import gc
from pathlib import Path
from typing import Tuple, Optional, Any
import psutil
import perspective
from perspective.handlers.starlette import PerspectiveStarletteHandler
import pyarrow as pa
import pyarrow.parquet as pq

from backend.app.engines.base import BaseEngine
from backend.app.models.query import HyperQuery
from backend.app.utils.paths import to_posix_path

class PerspectiveEngine(BaseEngine):
    def __init__(self):
        self._server = perspective.Server()
        self._client = self._server.new_local_client()
        self._active_tables: dict[str, Any] = {}

    @property
    def name(self) -> str:
        return "perspective"

    @property
    def server(self) -> perspective.Server:
        return self._server

    def load_dataset(self, dataset_id: str, file_path: str) -> None:
        """
        Loads the Parquet file into an in-memory C++ Perspective Table.
        Tracks table instance for explicit deletion on unload.
        """
        if dataset_id in self._active_tables:
            return

        posix_p = to_posix_path(file_path)
        try:
            file_size_mb = Path(posix_p).stat().st_size / (1024 * 1024)
            # Check available system RAM before attempting in-memory ingestion
            mem = psutil.virtual_memory()
            avail_mb = mem.available / (1024 * 1024)
            # Perspective C++ internal index + Arrow uncompressed memory requires ~6-8x the compressed parquet file size
            estimated_ram_mb = file_size_mb * 7

            if estimated_ram_mb > avail_mb:
                raise RuntimeError(
                    f"Dataset is {file_size_mb:.1f} MB on disk and requires ~{estimated_ram_mb:.0f} MB RAM in Perspective C++. "
                    f"Only {avail_mb:.0f} MB available. Switch to DuckDB 2.0 (Out-of-Core) or Polars 2.x (Streaming) which process this dataset directly from disk."
                )

            arrow_table = pq.read_table(posix_p)
            table = self._client.table(arrow_table, name=dataset_id)
            self._active_tables[dataset_id] = table
        except Exception as e:
            raise RuntimeError(f"Perspective In-Memory Load Error on '{dataset_id}': {str(e)}")

    def execute_query(self, query: HyperQuery, file_path: str) -> Tuple[pa.Table, str, int]:
        """
        Executes query on the in-memory Perspective Table using Perspective's view API.
        """
        ds_id = query.dataset
        if ds_id not in self._active_tables:
            self.load_dataset(ds_id, file_path)

        table = self._active_tables[ds_id]

        view_config: dict[str, Any] = {}
        if query.select:
            view_config["columns"] = query.select

        if query.filters:
            # Perspective filter format: [column, operator, value]
            psp_filters = []
            for f in query.filters:
                op_map = {
                    "equals": "==",
                    "not_equals": "!=",
                    "greater_than": ">",
                    "greater_than_or_equal": ">=",
                    "less_than": "<",
                    "less_than_or_equal": "<=",
                    "contains": "contains",
                    "is_null": "is null",
                    "is_not_null": "is not null"
                }
                psp_op = op_map.get(f.operator, "==")
                psp_filters.append([f.column, psp_op, f.value])
            view_config["filter"] = psp_filters

        if query.groupBy:
            view_config["group_by"] = query.groupBy

        if query.orderBy:
            view_config["sort"] = [[s.column, s.direction] for s in query.orderBy]

        view = table.view(**view_config)
        try:
            total_rows = view.num_rows()
            # Pushdown window slicing directly into Perspective C++ serialization (avoids serializing millions of rows)
            if query.limit > 0:
                end_r = min(total_rows, query.offset + query.limit)
                arrow_bytes = view.to_arrow(start_row=query.offset, end_row=end_r)
            else:
                arrow_bytes = view.to_arrow()

            reader = pa.ipc.open_stream(arrow_bytes)
            res_table = reader.read_all()

            plan_str = f"Perspective In-Memory View (Columns: {len(res_table.column_names)}, Returned: {res_table.num_rows}, Total: {total_rows})"
            return res_table, plan_str, total_rows
        finally:
            view.delete()

    def explain(self, query: HyperQuery, file_path: str) -> str:
        return f"Perspective In-Memory Engine: Direct C++ Apache Arrow buffer execution on hosted table '{query.dataset}'."

    def unload(self) -> None:
        """
        Explicitly delete all hosted C++ tables to recover RAM.
        """
        for name, table in list(self._active_tables.items()):
            try:
                table.delete()
            except Exception:
                pass
        self._active_tables.clear()
        gc.collect()

    def get_websocket_handler(self, websocket):
        return PerspectiveStarletteHandler(perspective_server=self._server, websocket=websocket)
