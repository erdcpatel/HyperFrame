# ⚡ HyperFrame: Ad-Hoc Analytics & Benchmarking Studio

**HyperFrame** is a high-performance ad-hoc analytics workbench and benchmarking engine designed to query, profile, and compare massive Parquet datasets (500MB+, 10M–50M+ rows) on an 8-core workstation.

Engineered natively for **Windows 10/11**, **macOS**, and **Linux** on **Python 3.13** using **DuckDB 2.0+**, **Polars 1.26+/2.x**, and **FINOS Perspective 5.5+/5.6+**.

---

## 🌟 Key Features

1. **Dual-Mode Analytical Experience:**
   * **Studio Workbench:** Daily-driver analytical playground featuring:
     * **Infinite Grid:** AG Grid Community with infinite virtual scrolling, column projection pushdown, quick search, and sorting.
     * **Perspective Pivot Canvas:** Drag-and-drop multidimensional OLAP aggregation with instant grouping, metrics, and GPU-style bar distributions.
     * **SQL Playground:** Monaco/Prism syntax-highlighted SQL editor with pre-built query templates, formatted execution, and query plan tree rendering.
   * **Arena Race Mode:** Split-screen race mode running synchronized workloads against two engines simultaneously with real-time latency diffs, memory tracking, and winner badges.
2. **Instant "Data Weather" Profiler:** Reads Parquet metadata with zero RAM materialization to display file size, compression ratio, row groups, uncompressed RAM footprint, and per-column cardinality, null percentages, and quartiles.
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
│   │   │   └── catalog.py              # Zero-RAM dataset catalog & 500k sample generator
│   │   ├── engines/
│   │   │   ├── base.py                 # Abstract BaseEngine contract
│   │   │   ├── duckdb_engine.py        # DuckDB 2.0+ out-of-core engine (cursor pool, EXPLAIN ANALYZE)
│   │   │   ├── polars_engine.py        # Polars 2.x streaming engine (LazyFrame, explain, collect)
│   │   │   └── perspective_engine.py   # Perspective 5.x server & WebSocket handler
│   │   ├── api/
│   │   │   ├── datasets.py             # Dataset upload, sample generator, Data Weather
│   │   │   ├── query.py                # HyperQuery runner (Arrow IPC / JSON) & AG Grid adapter
│   │   │   ├── engines.py              # Engine lifecycle switcher & memory purge
│   │   │   ├── benchmarks.py           # 5-workload Torture Suite runner
│   │   │   └── telemetry.py            # Live CPU/RAM WebSocket stream
│   │   └── utils/
│   │       ├── paths.py                # Windows/POSIX path normalizer & temp spill resolver
│   │       └── serialization.py        # Arrow IPC stream builder & dictionary serializers
│   ├── tests/                          # Full pytest test suite (18 unit & integration tests)
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
All 18 tests cover:
- Cross-platform path normalization (Windows backslash sanitization)
- DuckDB 2.0 query compilation, cursor isolation, and `EXPLAIN ANALYZE`
- Polars streaming plan generation and execution
- Engine lifecycle activation, lazy hydration, and memory purge
- AG Grid infinite scroll adapter
- Automated Torture Test Suite execution

---

## 📄 License
Apache 2.0
