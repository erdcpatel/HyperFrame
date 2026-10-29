# HyperFrame: Architecture Specification

## 1. Overview & Core Philosophy

**HyperFrame** is a high-performance ad-hoc analytics benchmarking studio and workbench engineered to evaluate massive Parquet datasets (500MB+, 10M–50M+ rows) on an 8-core single workstation.

### Key Tenets
1. **Workbench First, Benchmark Built-in:** Deliver a daily-driver analytical tool (visual filters, instant schema profiler, SQL playground, high-density grid, OLAP pivot canvas) where execution engines can be swapped or compared side-by-side with zero friction.
2. **Strict Lazy Hydration:** Registering a dataset incurs **0 MB RAM allocation**. Engines only allocate resources when actively queried. Switching engines explicitly purges the inactive engine's memory (`table.delete()`, `gc.collect()`).
3. **Canonical Query Abstraction (`HyperQuery`):** Frontends never emit raw engine-specific queries. They emit a typed `HyperQuery` AST, which the backend safely compiles into parameterized DuckDB SQL or Polars streaming plans.
4. **End-to-End Waterfall Telemetry:** Every query measures:
   $$\text{Total Latency} = T_{\text{compile}} + T_{\text{exec}} + T_{\text{serialize}} + T_{\text{network}} + T_{\text{render}}$$
   Accompanied by real-time server metrics (Working Set RSS, CPU load per core) and client-side heap observations.
5. **Cross-Platform Resilience:** Works natively on Windows 10/11 (with POSIX-safe Parquet path normalization, temp spilling directories, and Proactor event loops) as well as macOS and Linux.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           HyperFrame Frontend (React)                           │
│ ┌───────────────────────────────────────┐ ┌───────────────────────────────────┐ │
│ │  Studio Workbench Mode               │ │  Arena Mode (Side-by-Side Race)   │ │
│ │  - AG Grid (Infinite Virtual Scroll)  │ │  - Engine A vs Engine B           │ │
│ │  - Perspective v5 (OLAP & WebGL)      │ │  - Synchronized Workload Trigger  │ │
│ │  - Monaco / Prism Query Editor        │ │  - Live Scorecard & Winner Badge  │ │
│ └───────────────────────────────────────┘ └───────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│ │ UI Components: Data Weather Bar · Filter Builder · X-Ray Plan · Waterfall   │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ HTTP (JSON / Arrow IPC)
                                         │ WebSocket (Live Telemetry & Perspective)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           FastAPI Backend (Python 3.13)                         │
│ ┌────────────────────────┐ ┌────────────────────────┐ ┌───────────────────────┐ │
│ │ Engine Lifecycle Mgr   │ │ HyperQuery Compiler    │ │ Telemetry Middleware  │ │
│ │ - Lazy Activation      │ │ - Filter/Sort AST      │ │ - Per-query timing    │ │
│ │ - Explicit GC / Unload │ │ - Projection Pushdown  │ │ - psutil RSS & CPU %  │ │
│ └────────────────────────┘ └────────────────────────┘ └───────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│ │ Dataset Catalog: Zero-RAM registration, Metadata cache, Parquet Path Normal │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────┬───────────────────┬───────────────────┬─────────────────┘
                        │                   │                   │
                        ▼                   ▼                   ▼
             ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
             │    DuckDB Engine    │ │    Polars Engine    │ │ Perspective Engine  │
             │ - Out-of-Core Spill │ │ - scan_parquet      │ │ - Virtual DuckDB WS │
             │ - Cursor Pool       │ │ - engine="streaming"│ │ - Native C++ Server │
             │ - EXPLAIN ANALYZE   │ │ - Physical Plan     │ │ - WASM Client Eval  │
             └─────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

---

## 3. The Canonical `HyperQuery` Contract

Frontends and test suites serialize queries using the standard `HyperQuery` model:

```json
{
  "dataset": "trades_500mb",
  "engine": "duckdb",
  "wire_format": "arrow",
  "select": ["trade_id", "symbol", "price", "quantity", "notional", "status"],
  "filters": [
    {
      "column": "status",
      "operator": "equals",
      "value": "FILLED"
    },
    {
      "column": "notional",
      "operator": "greater_than",
      "value": 50000.0
    }
  ],
  "groupBy": ["symbol", "status"],
  "aggregations": [
    {
      "column": "notional",
      "function": "sum",
      "alias": "total_notional"
    },
    {
      "column": "trade_id",
      "function": "count",
      "alias": "trade_count"
    }
  ],
  "orderBy": [
    {
      "column": "total_notional",
      "direction": "desc"
    }
  ],
  "limit": 100,
  "offset": 0
}
```

### Supported Operators
* `equals`, `not_equals`
* `greater_than`, `greater_than_or_equal`
* `less_than`, `less_than_or_equal`
* `contains`, `starts_with`, `ends_with`
* `in`, `not_in`
* `is_null`, `is_not_null`

---

## 4. Engine Lifecycle State Machine

To prevent server Out-Of-Memory (OOM) on an 8-core machine with shared RAM:
1. **Catalog State (`INACTIVE`):** Dataset metadata is stored in SQLite / JSON. No memory is allocated in C++ or Rust runtimes.
2. **Active State (`HYDRATED`):** Only **one engine at a time** (or two in Arena Mode with explicit memory limits) holds active execution contexts.
3. **Transition State (`PURGING`):** When switching engines, the Lifecycle Manager calls:
   * Perspective: `table.delete()`, `server.clear()`
   * DuckDB: `cursor.close()`
   * System: `gc.collect()` and checks `psutil.Process().memory_info().rss` to confirm memory reclamation.

---

## 5. Automated Torture Test Suite

HyperFrame provides 5 standardized benchmark workloads out-of-the-box:

1. **Needle in Haystack:** Low-selectivity unindexed string search (tests scan speed and row group pruning).
2. **Multi-Column Sort:** Sort 20M+ rows across 2 columns (numeric descending + timestamp ascending). Tests disk-spilling and out-of-core sort buffers.
3. **Low-Cardinality Pivot:** Group by 5 distinct categories with 3 aggregations (`SUM`, `AVG`, `COUNT`).
4. **High-Cardinality Explosion:** Group by a column with 100,000+ distinct values. Tests streaming fallback and hash table memory limits.
5. **Scroll Thrash:** Rapid simulated virtual scrolling (25 requests over 2 seconds) to test cancellation, connection pool contention, and serialization speed.

---

## 6. Data Ingestion & Storage Architecture

1. **Zero-RAM Catalog (`backend/app/core/catalog.py`):**
   * Registering datasets (`POST /api/datasets/register` or `POST /api/datasets/scan`) reads exclusively from the Parquet footer metadata (`pq.ParquetFile.metadata`).
   * No row data is parsed or loaded into Python, DuckDB, or Polars heap. Registration takes **0 MB RAM**.
2. **Directory Auto-Scanning (`POST /api/datasets/scan`):**
   * Any `.parquet` or `.pqt` files placed in `backend/data/` are discovered and cataloged on-the-fly.
3. **Pristine Data Cleaning (`clean.py` & `POST /api/datasets/clean-test-data`):**
   * Purges temporary synthetic datasets (`*test*`, `*synthetic*`), deleting their parquet files and resetting `catalog.json` so production datasets remain isolated.
4. **Streaming CSV / Parquet Export (`POST /api/query/export`):**
   * Translates active query filters directly into out-of-core streaming CSV generation, avoiding browser heap limits for large filtered extracts.

---

## 7. Engine Memory & Execution Profiles

* **DuckDB 2.0+ (Out-of-Core):**
  * Queries Parquet views dynamically via `read_parquet(...)`.
  * Dedicated `con.cursor()` per request prevents multi-threading locks.
  * Honors `PRAGMA memory_limit = '8GB'` and uses `PRAGMA temp_directory` to spill large sort buffers and hash tables to disk.
* **Polars 1.26+/2.x (On-the-Fly Streaming):**
  * Strictly lazy (`pl.scan_parquet(...)`).
  * Employs projection pushdown (only reading queried columns) and predicate pushdown (skipping Parquet row groups via metadata min/max statistics).
  * Executes with `.collect(engine="streaming")`; immediately deallocates intermediate state. Holds 0 MB RAM between queries.
* **Perspective 5.5+/5.6+ (In-Memory C++):**
  * Loads Arrow batches into an in-memory `perspective.Table`.
  * High-speed analytical pivoting at the expense of an uncompressed in-memory footprint.
  * Explicitly purged via `table.delete()` and `gc.collect()` upon engine deactivation.
