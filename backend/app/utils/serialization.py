import io
import pyarrow as pa
import pyarrow.ipc as ipc
from typing import Any

def arrow_table_to_ipc_bytes(table: pa.Table) -> bytes:
    """
    Serializes a PyArrow Table directly into an Arrow IPC Stream buffer.
    Zero-copy in C++/Rust, suitable for high-performance browser decoding.
    """
    sink = io.BytesIO()
    with ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue()

def arrow_table_to_dict_list(table: pa.Table) -> list[dict[str, Any]]:
    """
    Converts a PyArrow Table directly into a list of row dictionaries.
    Uses PyArrow's native C++ .to_pylist() method.
    """
    return table.to_pylist()

def format_bytes(num_bytes: int) -> str:
    """
    Formats raw byte count into human-readable string (KB, MB, GB).
    """
    if num_bytes < 1024:
        return f"{num_bytes} B"
    elif num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.2f} KB"
    elif num_bytes < 1024 * 1024 * 1024:
        return f"{num_bytes / (1024 * 1024):.2f} MB"
    else:
        return f"{num_bytes / (1024 * 1024 * 1024):.2f} GB"
