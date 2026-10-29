# ⚡ HyperFrame: Ad-Hoc Analytics & Benchmarking Studio

[![Python 3.13](https://img.shields.io/badge/Python-3.13-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![DuckDB](https://img.shields.io/badge/DuckDB-2.0+-FFF000.svg)](https://duckdb.org/)
[![Polars](https://img.shields.io/badge/Polars-1.26+-CD792C.svg)](https://pola.rs/)
[![Perspective](https://img.shields.io/badge/Perspective-5.5+-1f77b4.svg)](https://perspective.finos.org/)
[![Tests](https://img.shields.io/badge/Tests-22%20Passing-brightgreen.svg)](#-testing--verification)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**HyperFrame** is a high-performance ad-hoc analytics workbench and benchmarking engine designed to query, profile, and compare massive Parquet datasets (500MB+, 10M–50M+ rows) on an 8-core workstation.

Engineered natively for **Windows 10/11**, **macOS**, and **Linux** on **Python 3.13** using **DuckDB 2.0+**, **Polars 1.26+/2.x**, and **FINOS Perspective 5.5+/5.6+**.

---

## 🌟 Key Features

1. **Dual-Mode Analytical Experience:**
   * **Studio Workbench:** Daily-driver analytical playground featuring:
     * **Infinite Grid:** AG Grid Community with infinite virtual scrolling, column projection pushdown, quick search, and sorting.
     * **Perspective Pivot Canvas:** Drag-and-drop multidimensional OLAP aggregation with instant grouping, metrics, and GPU-style bar distributions.
     * **SQL Playground:** Monaco/Prism syntax-highlighted SQL editor with dynamic `:dataset` alias, cross-dataset multi-file joins (`JOIN uploaded_file2`), pre-built query templates, and query plan tree rendering.
     * **Streaming CSV Export:** 1-click export of filtered and aggregated results directly via DuckDB/Polars streaming.
   * **Arena Race Mode:** Split-screen race mode running synchronized workloads against two engines simultaneously with real-time latency diffs ($\Delta$ ms), server memory deltas ($\Delta$ MB), and winner badges.
2. **Instant "Data Weather" Column Profiler:** Reads Parquet metadata with zero RAM materialization to display file size, compression ratio, row groups, uncompressed RAM footprint, and per-column cardinality, null percentages, and quartiles (`q25`, `q50`, `q75`).
3. **1-Click Automated Torture Test Suite:** Executes 5 standardized workloads:
   * *Needle in Haystack* (low-selectivity string search)
   * *Multi-Column Sort* (high-cardinality global sort)
   * *Low-Card Pivot* (group-by with aggregations)
   * *High-Card Explosion* (stressing hash tables and disk-spill buffers)
   * *Scroll Thrash* (rapid sequential pagination)
   Generates a comparative scorecard downloadable as CSV.
4. **Strict Lazy Hydration Lifecycle:** Registering datasets incurs **0 MB RAM**. In-memory engine state is deallocated and purged with `gc.collect()` when switching engines.
5. **End-to-End Waterfall Telemetry:** Real-time breakdown:
   $$\text{Total Time} = T_{\text{compile}} + T_{\text{exec}} + T_{\text{serialize}} + T_{\text{render}}$$
   Accompanied by a live 500ms WebSocket stream tracking Server RSS RAM (Working Set on Windows) and per-core CPU load.

---

## 📂 Working with Real Data

HyperFrame supports **Parquet (`.parquet`, `.pqt`)**, **CSV (`.csv`, `.tsv`)**, and **Excel (`.xlsx`, `.xls`)**.

### 1. Where to Drop Your Data Files
* **Drop into Data Directory:** Copy any `.parquet`, `.csv`, or `.xlsx` file directly into:
  ```text
  backend/data/
  ```
  Then click the **Scan Folder (🔄)** button in the sidebar or run `POST /api/datasets/scan` to auto-register it.
* **Upload from UI:** Click the **Upload (⬆️)** icon in the sidebar to pick any Parquet, CSV, or Excel file from your computer.
* **Automatic CSV & Excel Optimization:**
  * **Tricky Quotes & Delimiters:** Handled automatically via DuckDB's native multi-byte CSV sniffer (supports embedded commas `"San Francisco, CA"`, escaped double quotes `""`, and multi-line text fields `\r\n`).
  * **Auto-Conversion:** CSVs and Excel workbooks are automatically converted into columnar, ZSTD-compressed Parquet in `backend/data/`, giving you instant column projection and out-of-core streaming speed!
* **Zero-Copy External Link:** Link large files (5GB–50GB) without moving or copying them:
  ```bash
  curl -X POST http://localhost:8000/api/datasets/register \
    -H "Content-Type: application/json" \
    -d '{"dataset_id": "production_trades", "file_path": "/path/to/my_file.parquet"}'
  ```

### 2. Cleaning Test Data
To remove all synthetic and test datasets so only your real data remains:
```bash
python clean.py
```
*(Or click **"Clean Test Data"** in the UI sidebar).*

---

## ⚡ Engine Execution & Memory Profiles

| Engine | Data Placement | Memory at Rest | Execution Strategy |
| :--- | :--- | :--- | :--- |
| **DuckDB 2.0** | **On-the-Fly** (`read_parquet`) | **0 MB** | Out-of-core streaming; spills sorts & joins to disk if RAM exceeds 8GB (`PRAGMA temp_directory`). |
| **Polars 1.26+/2.x** | **On-the-Fly** (`scan_parquet`) | **0 MB** | LazyFrame streaming (`.collect(engine="streaming")`); predicate & projection pushdown; drops RAM immediately after result transfer. |
| **Perspective 5.5+** | **In-Memory C++** (`perspective.Table`) | **Full Uncompressed Size** | High-performance C++ in-memory OLAP table; explicit deallocation (`table.delete()`) on engine switch. |

---

## 🏗️ Architecture & Directory Structure

```
HyperFrame/
├── backend/
│   ├── app/
│   │   ├── main.py                     # FastAPI entrypoint, CORS, static file mount, WebSockets
│   │   ├── config.py                   # Platform-aware config (threads, memory limits, spill dirs)
│   │   ├── models/
│   │   │   ├── query.py                # HyperQuery canonical AST, filters, sorts, aggregations
│   │   │   ├── dataset.py              # Dataset metadata & "Data Weather" schema models
│   │   │   └── telemetry.py            # Waterfall metrics & Torture Scorecard schemas
│   │   ├── core/
│   │   │   ├── lifecycle.py            # Lazy Hydration Lifecycle Manager & GC controller
│   │   │   ├── telemetry.py            # psutil resource monitor & QueryProfiler
│   │   │   └── catalog.py              # Zero-RAM dataset catalog, scan & clean utilities
│   │   ├── engines/
│   │   │   ├── base.py                 # Abstract BaseEngine contract
│   │   │   ├── duckdb_engine.py        # DuckDB 2.0+ out-of-core engine (cursor pool, EXPLAIN ANALYZE)
│   │   │   ├── polars_engine.py        # Polars 2.x streaming engine (LazyFrame, explain, collect)
│   │   │   └── perspective_engine.py   # Perspective 5.x server & WebSocket handler
│   │   ├── api/
│   │   │   ├── datasets.py             # Dataset upload, scan, clean, Data Weather
│   │   │   ├── query.py                # HyperQuery runner (Arrow IPC / JSON), AG Grid adapter, CSV export
│   │   │   ├── engines.py              # Engine lifecycle switcher & memory purge
│   │   │   ├── benchmarks.py           # 5-workload Torture Suite runner
│   │   │   └── telemetry.py            # Live CPU/RAM WebSocket stream
│   │   └── utils/
│   │       ├── paths.py                # Windows/POSIX path normalizer & temp spill resolver
│   │       └── serialization.py        # Arrow IPC stream builder & dictionary serializers
│   ├── tests/                          # Full pytest test suite (22 unit & integration tests)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/                 # Header, Sidebar (Data Weather), Footer (Waterfall)
│   │   │   ├── studio/                 # StudioView, FilterBar, AgGridCanvas, PerspectiveCanvas, QueryEditor
│   │   │   ├── arena/                  # ArenaView, TortureModal
│   │   │   ├── inspector/              # XRayDrawer
│   │   │   └── common/                 # SyntaxHighlighter
│   │   ├── services/                   # Typed API client
│   │   ├── types/                      # TypeScript definitions
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── docs/
│   ├── ARCHITECTURE.md                 # Complete system architecture specification
│   ├── AGENTS.md                       # AI coding agent guidelines
│   └── WINDOWS_SETUP.md                # Windows PowerShell execution guide
├── .agents/skills/hyperframe/SKILL.md  # Customization skill for coding agents
├── clean.py                            # 1-click test dataset cleaner CLI
├── run.py                              # Unified cross-platform runner script
└── README.md
```

---

## 🚀 Quick Start

### 1. Backend Setup

```bash
# Activate your Python 3.13 environment
source /path/to/venv/bin/activate  # On Linux/macOS
# or: .\venv\Scripts\Activate.ps1   # On Windows PowerShell

# Install dependencies
pip install -r backend/requirements.txt

# Run test suite
pytest backend/tests -v
```

### 2. Frontend Setup & Build

```bash
cd frontend
npm install
npm run build   # Compiles to frontend/dist/ (served directly by FastAPI)
cd ..
```

### 3. Launch HyperFrame

```bash
# Starts both the backend API and serves the production frontend at http://127.0.0.1:8000
python run.py
```

* Open your browser at **`http://localhost:8000`**.
* Interactive Swagger API documentation: **`http://localhost:8000/docs`**.

For active frontend development with Hot Module Replacement (HMR):
```bash
# Terminal 1: Backend
python run.py

# Terminal 2: Frontend Dev Server (proxies to backend at 8000)
cd frontend
npm run dev
# Opens at http://localhost:3000
```

---

## 🧪 Testing & Verification

Run the full pytest suite:
```bash
pytest backend/tests -v
```
All 19 tests cover:
- Cross-platform path normalization (Windows backslash sanitization)
- DuckDB 2.0 query compilation, cursor isolation, and `EXPLAIN ANALYZE`
- Polars streaming plan generation and execution
- Engine lifecycle activation, lazy hydration, and memory purge
- AG Grid infinite scroll adapter & custom filter propagation
- Type-coerced numeric and datetime filters
- Streaming CSV export endpoint
- Automated Torture Test Suite execution

---

## 📄 License
Apache 2.0
