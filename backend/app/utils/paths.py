import os
import tempfile
from pathlib import Path
from typing import Union

def to_posix_path(path: Union[str, Path]) -> str:
    """
    Converts any file system path (including Windows paths with backslashes and drive letters)
    into a clean POSIX path with forward slashes for DuckDB and Polars SQL queries.
    Example: 'C:\\data\\trades.parquet' -> 'C:/data/trades.parquet'
    """
    p_str = str(path).replace("\\", "/")
    # If not a pure Windows drive path on non-Windows, resolve cleanly
    if not (len(p_str) > 2 and p_str[1] == ":" and p_str[0].isalpha() and os.name != "nt"):
        return Path(p_str).resolve().as_posix()
    return p_str

def get_temp_spill_dir(prefix: str = "hyperframe_spill") -> Path:
    """
    Returns a platform-appropriate temporary spill directory for DuckDB disk-spill operations.
    Works seamlessly on Windows (%TEMP%), macOS (/tmp or $TMPDIR), and Linux.
    """
    base_tmp = Path(tempfile.gettempdir())
    spill_dir = base_tmp / prefix
    spill_dir.mkdir(parents=True, exist_ok=True)
    return spill_dir

def get_default_data_dir() -> Path:
    """
    Returns the persistent dataset storage directory within the HyperFrame workspace.
    """
    data_dir = Path(__file__).resolve().parent.parent.parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir
