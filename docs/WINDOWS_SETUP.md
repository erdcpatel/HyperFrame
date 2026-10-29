# HyperFrame: Windows Setup & Engineering Guide

## 1. Prerequisites for Windows
* **Operating System:** Windows 10 or Windows 11 (x64 / AMD64).
* **Python:** Python 3.13 (or 3.12+).
* **Node.js:** Node.js v20+ and npm v10+.
* **PowerShell:** PowerShell 7+ or standard Windows PowerShell.

---

## 2. Installation on Windows

### A. Python Virtual Environment
Open PowerShell inside `HyperFrame`:
```powershell
# Create Python 3.13 virtual environment
py -3.13 -m venv venv

# Activate venv
.\venv\Scripts\Activate.ps1

# Upgrade pip & install requirements
pip install --upgrade pip
pip install -r backend\requirements.txt
```

### B. Frontend Setup
```powershell
cd frontend
npm install
cd ..
```

---

## 3. Windows Engineering Rules in HyperFrame

### 1. Parquet Path Normalization for DuckDB & Polars
On Windows, native file paths look like `C:\Users\username\data.parquet`.
In SQL statements like `SELECT * FROM read_parquet('C:\Users\username\data.parquet')`, the backslashes `\` act as escape sequences (`\U`, `\u`, `\n`) and crash the DuckDB parser!
**Rule:** Always use `pathlib.Path(p).resolve().as_posix()` before passing paths to DuckDB SQL.
```python
from pathlib import Path
posix_path = Path("C:\\data\\trades.parquet").resolve().as_posix()
# Produces: 'C:/data/trades.parquet' which DuckDB reads cleanly!
```

### 2. Disk Spilling & Temporary Directories
On Windows, temporary directories should never be hardcoded to `/tmp` or `./tmp`.
**Rule:** Use `tempfile.gettempdir()` or a workspace-relative directory:
```python
import tempfile
from pathlib import Path
spill_dir = Path(tempfile.gettempdir()) / "hyperframe_spill"
spill_dir.mkdir(parents=True, exist_ok=True)
duckdb_con.execute(f"PRAGMA temp_directory='{spill_dir.as_posix()}'")
```

### 3. Threading and Proactor Event Loop
Windows uses `asyncio.ProactorEventLoop` by default in Python 3.8+.
When executing blocking engine queries (DuckDB/Polars), never run them directly in the async event loop thread. Always use standard FastAPI synchronous route functions (`def query_endpoint(...)`) or `anyio.to_thread.run_sync()`, allowing FastAPI's background threadpool to handle the CPU-bound query without starving WebSocket telemetry.

### 4. Running HyperFrame on Windows
We provide `run.py` at the root which handles Windows process creation safely:
```powershell
python run.py
```
This boots both the FastAPI backend (port 8000) and serves or proxies the Vite frontend.
