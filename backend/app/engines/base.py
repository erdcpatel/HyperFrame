from abc import ABC, abstractmethod
from typing import Tuple, Optional
import pyarrow as pa
from backend.app.models.query import HyperQuery

class BaseEngine(ABC):
    """
    Abstract execution engine contract for HyperFrame.
    All engines must translate the canonical HyperQuery contract and return
    a PyArrow Table alongside the compiled query / physical plan string.
    """
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    def execute_query(self, query: HyperQuery, file_path: str) -> Tuple[pa.Table, str, int]:
        """
        Executes query against file_path.
        Returns: (arrow_table, compiled_query_or_plan_string, total_matching_rows)
        """
        pass

    @abstractmethod
    def explain(self, query: HyperQuery, file_path: str) -> str:
        """
        Returns physical execution plan or EXPLAIN ANALYZE tree.
        """
        pass

    @abstractmethod
    def unload(self) -> None:
        """
        Explicitly purges in-memory tables, clears caches, and frees RAM.
        """
        pass

    def export_csv(self, query: HyperQuery, file_path: str, output_path: str) -> None:
        """
        Exports query results directly to CSV. Engines can override this to stream
        out-of-core (e.g. DuckDB COPY TO, Polars sink_csv) without loading multi-GB
        data into RAM or encountering 2GB PyArrow buffer limits.
        """
        arrow_table, _, _ = self.execute_query(query, file_path)
        from backend.app.utils.serialization import write_arrow_table_to_csv
        write_arrow_table_to_csv(arrow_table, output_path)

