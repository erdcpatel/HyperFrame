# HyperFrame: AI Agent Guidelines & Context

This file guides AI coding agents (Antigravity, Cursor, Copilot, etc.) working on the **HyperFrame** repository.

---

## 1. System Overview
**HyperFrame** is a modern ad-hoc analytics benchmarking studio for 500MB+ Parquet datasets.
It combines:
- **Backend:** FastAPI, Python 3.13, DuckDB 2.0+, Polars 1.26+/2.x, Perspective 5.5+/5.6+, PyArrow 18.1+/26.0+, psutil.
- **Frontend:** React 18/19, TypeScript, Vite, TailwindCSS, AG Grid Community (Infinite Row Model), Perspective Viewer v5.
- **Cross-Platform:** Native support for Windows 10/11 and POSIX (macOS/Linux).

---

## 2. Cardinal Rules for AI Agents

1. **Maintain Lazy Engine Hydration:**
   - Never load large datasets into server memory during registration. Registration must be metadata-only (zero RAM).
   - Only activate the engine selected by the user. When switching engines, call `engine.unload()` and `gc.collect()`.

2. **Windows Path Safety:**
   - Never use raw Windows backslash paths in SQL statements.
   - Always normalize paths via `Path(p).resolve().as_posix()` before passing to DuckDB `read_parquet(...)` or Polars `pl.scan_parquet(...)`.

3. **Polars Streaming Engine:**
   - Always run Polars lazy queries using `.collect(engine="streaming")` or `.collect()` with streaming semantics where supported.
   - Capture `.explain()` to inspect execution plans.

4. **DuckDB Thread Safety:**
   - DuckDB connections are not thread-safe for simultaneous execution on a single cursor. Always call `base_con.cursor()` for request-scoped isolation.
   - Configure PRAGMAs: `PRAGMA threads=8; PRAGMA memory_limit='8GB'; PRAGMA temp_directory='...';`.

5. **Canonical HyperQuery Contract:**
   - Do not tie the API directly to AG Grid or any specific frontend component format.
   - Always parse into `HyperQuery` AST first, then compile to target engine expressions.

6. **Serialization Zero-Copy Rule:**
   - Never convert Arrow tables to Pandas DataFrames or Python `dict`s for Arrow wire transfers.
   - Stream PyArrow IPC directly: `pyarrow.ipc.new_stream(sink, table.schema)`.
   - For JSON format, use fast binary serialization (e.g., `orjson` or Polars native JSON export).

7. **Clean Modular Structure:**
   - `backend/app/models/`: Pydantic data models.
   - `backend/app/core/`: Lifecycle, telemetry, catalog managers.
   - `backend/app/engines/`: Engine adapters inheriting from `BaseEngine`.
   - `backend/app/api/`: FastAPI route routers.
   - `frontend/src/components/`: Modular React components split into layout, studio, arena, and inspector.
