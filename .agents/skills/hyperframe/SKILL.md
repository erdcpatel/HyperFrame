---
name: hyperframe-development
description: Guide for developing, testing, and extending the HyperFrame analytics benchmarking studio across Windows, macOS, and Linux.
---

# HyperFrame Development Skill

## Overview
HyperFrame is an ad-hoc analytics benchmarking engine designed to evaluate 500MB+ Parquet files across DuckDB, Polars, and FINOS Perspective.

## Engine Integration Reference

### 1. DuckDB Engine (`backend/app/engines/duckdb_engine.py`)
- Base connection created once: `con = duckdb.connect()`
- Configure:
  ```sql
  PRAGMA threads=8;
  PRAGMA memory_limit='8GB';
  PRAGMA temp_directory='/path/to/spill';
  ```
- Queries run on isolated cursors: `cursor = con.cursor()`
- Return Arrow Table: `cursor.sql(query).arrow()`
- Explain: `cursor.sql(f"EXPLAIN ANALYZE {query}").fetchall()`

### 2. Polars Streaming Engine (`backend/app/engines/polars_engine.py`)
- Scan lazily: `lf = pl.scan_parquet(posix_path)`
- Push down projections: `lf = lf.select(columns)`
- Apply filters: `lf = lf.filter(predicate)`
- Sort & Slice: `lf = lf.sort(...).slice(offset, limit)`
- Execute: `df = lf.collect(engine="streaming")`
- Return Arrow Table: `df.to_arrow()`

### 3. Perspective Engine (`backend/app/engines/perspective_engine.py`)
- Modern Perspective 5.x server setup with Starlette handler.
- Unload memory explicitly on engine switch.

### 4. Cross-Platform Path Handling
- Always use `backend.app.utils.paths.to_posix_path(p)`
- Windows drive letters `C:\` become `C:/` which avoids SQL escape issues.
