from pathlib import Path
from backend.app.utils.paths import to_posix_path, get_temp_spill_dir

def test_posix_path_normalization():
    # Test typical Windows backslash path
    win_path = r"C:\Users\tester\datasets\sales.parquet"
    posix = to_posix_path(win_path)
    assert "\\" not in posix
    assert "sales.parquet" in posix

def test_temp_spill_dir():
    spill_dir = get_temp_spill_dir("test_hyperframe_spill")
    assert spill_dir.exists()
    assert spill_dir.is_dir()
