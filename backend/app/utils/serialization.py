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

def write_arrow_table_to_csv(table: pa.Table, output_path: str, batch_size: int = 50000) -> None:
    """
    Safely writes a PyArrow Table to CSV:
    1. Transforms unsupported types like string_view, binary_view to standard large_string / large_binary.
    2. Converts complex nested types (list, large_list, struct, map) to string representations so
       PyArrow's CSV writer does not fail with 'Unsupported Type'.
    3. Writes via CSVWriter in batches (default 50,000 rows) so multi-GB files and large strings
       do not encounter Arrow 2GB offset overflow ('ArrowInvalid: offset overflow').
    """
    import pyarrow.csv as pacsv
    import pyarrow.compute as pc

    schema = table.schema
    needs_transform = False
    for f in schema:
        t = f.type
        if t == pa.string_view() or t == pa.binary_view() or pa.types.is_nested(t):
            needs_transform = True
            break
            
    if needs_transform:
        new_cols = []
        new_fields = []
        for i, f in enumerate(schema):
            col = table.column(i)
            t = f.type
            if t == pa.string_view():
                col = pc.cast(col, pa.large_string())
                f = pa.field(f.name, pa.large_string())
            elif t == pa.binary_view():
                col = pc.cast(col, pa.large_binary())
                f = pa.field(f.name, pa.large_binary())
            elif pa.types.is_nested(t):
                try:
                    col = pc.cast(col, pa.large_string())
                except Exception:
                    str_vals = [str(x.as_py()) if x.is_valid else None for x in col]
                    col = pa.array(str_vals, type=pa.large_string())
                f = pa.field(f.name, pa.large_string())
            new_cols.append(col)
            new_fields.append(f)
        table = pa.Table.from_arrays(new_cols, schema=pa.schema(new_fields))
        
    with pacsv.CSVWriter(output_path, table.schema) as writer:
        for batch in table.to_batches(max_chunksize=batch_size):
            writer.write_batch(batch)

