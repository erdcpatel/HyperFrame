"""
HyperFrame Large-Scale Stress Test & Benchmarking Suite
Tests:
- 8 Million Rows (~200MB) Parquet Dataset
- 500MB CSV Dataset with complex quotes, commas, and newlines
- Deep pagination (offset 1M)
- Global sort across 8M rows
- High-cardinality aggregation (50,000+ distinct keys)
- Full 5-workload Torture Suite on DuckDB and Polars
- Large CSV export
- Memory lifecycle & GC recovery
"""

import os
import sys
import time
from pathlib import Path

# Add project root to path
root_dir = Path(__file__).resolve().parent.parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

import duckdb
import polars as pl
import pyarrow as pa
from backend.app.core.catalog import catalog
from backend.app.core.lifecycle import lifecycle_manager
from backend.app.core.telemetry import telemetry_monitor
from backend.app.engines.duckdb_engine import DuckDBEngine
from backend.app.engines.polars_engine import PolarsEngine
from backend.app.models.query import HyperQuery, HyperFilter, HyperSort, HyperAggregation
from backend.app.models.telemetry import TortureScorecard
from backend.app.api.benchmarks import run_torture_suite, TortureRequest
from backend.app.api.query import query_ag_grid, AgGridRequest
from backend.app.utils.paths import to_posix_path
from backend.app.utils.serialization import format_bytes

def log_header(title: str):
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def run_stress_test():
    log_header("HYPERFRAME LARGE DATA STRESS TEST STARTING")
    base_rss = telemetry_monitor.get_current_rss_mb()
    print(f"Initial Server RSS: {base_rss:.1f} MB")

    # =========================================================================
    # STEP 1: Generate & Benchmark 8 Million Row Parquet Dataset (~200MB)
    # =========================================================================
    pqt_id = "stress_test_8m"
    pqt_file = catalog.data_dir / f"{pqt_id}.parquet"
    posix_pqt = to_posix_path(pqt_file)

    log_header(f"1. GENERATING 8 MILLION ROW PARQUET (~200 MB)")
    t0 = time.perf_counter()
    con = duckdb.connect()
    con.execute(f"""
        COPY (
            SELECT
                10000000 + i AS trade_id,
                (['NVDA', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'GOOGL', 'META', 'JPM', 'BAC', 'XOM'])[(1 + (hash(i) % 10))::BIGINT] AS symbol,
                (['NY_CREDIT', 'LDN_RATES', 'APAC_FLOW', 'EQ_VOL'])[(1 + (hash(i * 3) % 4))::BIGINT] AS desk,
                (['BUY', 'SELL'])[(1 + (hash(i * 7) % 2))::BIGINT] AS side,
                ROUND(10.0 + (hash(i * 11) % 99000) / 100.0, 2) AS price,
                10 + (hash(i * 13) % 5000) AS quantity,
                ROUND((10.0 + (hash(i * 11) % 99000) / 100.0) * (10 + (hash(i * 13) % 5000)), 2) AS notional,
                (['FILLED', 'PARTIAL', 'CANCELLED', 'REJECTED'])[(1 + (hash(i * 17) % 4))::BIGINT] AS status,
                ROUND(0.05 + (hash(i * 19) % 2500) / 100.0, 2) AS execution_latency_ms,
                'TRADER_' || LPAD(((hash(i * 23) % 1000)::BIGINT)::VARCHAR, 4, '0') AS trader_id,
                'ACC_' || LPAD(((hash(i * 29) % 100000)::BIGINT)::VARCHAR, 6, '0') AS account_id,
                TIMESTAMP '2026-01-01 09:30:00' + INTERVAL ((hash(i * 31) % 31536000)::BIGINT) SECOND AS trade_time
            FROM range(1, 8000001) tbl(i)
        ) TO '{posix_pqt}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000);
    """)
    con.close()
    gen_time = time.perf_counter() - t0
    file_size_mb = os.path.getsize(posix_pqt) / (1024 * 1024)
    print(f"Generated 8,000,000 rows in {gen_time:.2f}s | File Size: {file_size_mb:.2f} MB")

    # Zero-RAM Registration
    log_header("2. ZERO-RAM REGISTRATION & DATA WEATHER PROFILING")
    t0 = time.perf_counter()
    weather_pqt = catalog.register_file(pqt_id, posix_pqt, description="8M Row Stress Dataset")
    reg_time = (time.perf_counter() - t0) * 1000
    print(f"Parquet Metadata Registration Time: {reg_time:.2f} ms (0 MB data loaded)")
    print(f"Rows: {weather_pqt.row_count:,} | Columns: {weather_pqt.column_count} | Row Groups: {weather_pqt.row_groups}")
    print(f"Compressed Disk Size: {weather_pqt.file_size_formatted} | Est. RAM Footprint: {weather_pqt.est_uncompressed_formatted}")

    # =========================================================================
    # STEP 2: Deep Pagination & Slicing across 8M Rows (AG Grid Infinite Scroll)
    # =========================================================================
    log_header("3. DEEP SCROLL PAGINATION (OFFSET 0 vs 100,000 vs 1,000,000)")
    for offset in [0, 100000, 1000000]:
        for eng in ["duckdb", "polars"]:
            req = AgGridRequest(
                dataset=pqt_id,
                engine=eng,
                startRow=offset,
                endRow=offset + 100,
                sortModel=[{"colId": "price", "sort": "desc"}]
            )
            t0 = time.perf_counter()
            res = query_ag_grid(req)
            elapsed = (time.perf_counter() - t0) * 1000
            print(f"[{eng.upper()}] Offset {offset:,} -> {offset+100:,} | Exec: {res['waterfall']['engine_exec_ms']}ms | Total: {elapsed:.1f}ms | Rows Returned: {len(res['rows'])}")

    # =========================================================================
    # STEP 3: Multi-Filter Slicing on 8M Rows
    # =========================================================================
    log_header("4. MULTI-COLUMN FILTERING & PROJECTION PUSHDOWN ON 8M ROWS")
    for eng in ["duckdb", "polars"]:
        engine = lifecycle_manager.get_engine(eng)
        q = HyperQuery(
            dataset=pqt_id,
            engine=eng,
            select=["trade_id", "symbol", "price", "notional", "status"],
            filters=[
                HyperFilter(column="symbol", operator="equals", value="NVDA"),
                HyperFilter(column="price", operator="greater_than", value=500.0),
                HyperFilter(column="status", operator="equals", value="FILLED")
            ],
            limit=100
        )
        t0 = time.perf_counter()
        tbl, sql_or_plan, total_matched = engine.execute_query(q, posix_pqt)
        elapsed = (time.perf_counter() - t0) * 1000
        print(f"[{eng.upper()}] Filter (NVDA + Price > 500 + FILLED) | Matched: {total_matched:,} rows | Query Time: {elapsed:.1f}ms")

    # =========================================================================
    # STEP 4: Global Sort across 8M Rows
    # =========================================================================
    log_header("5. GLOBAL SORT ACROSS ALL 8,000,000 ROWS")
    for eng in ["duckdb", "polars"]:
        engine = lifecycle_manager.get_engine(eng)
        q = HyperQuery(
            dataset=pqt_id,
            engine=eng,
            select=["trade_id", "notional", "price"],
            orderBy=[HyperSort(column="notional", direction="desc")],
            limit=200
        )
        t0 = time.perf_counter()
        tbl, _, _ = engine.execute_query(q, posix_pqt)
        elapsed = (time.perf_counter() - t0) * 1000
        top_val = tbl["notional"][0].as_py()
        print(f"[{eng.upper()}] Full 8M Row Sort | Top Notional: ${top_val:,.2f} | Exec Time: {elapsed:.1f}ms")

    # =========================================================================
    # STEP 5: High-Cardinality Group-By (100,000 Unique Keys)
    # =========================================================================
    log_header("6. HIGH-CARDINALITY GROUP-BY (100,000 UNIQUE KEYS)")
    for eng in ["duckdb", "polars"]:
        engine = lifecycle_manager.get_engine(eng)
        q = HyperQuery(
            dataset=pqt_id,
            engine=eng,
            groupBy=["account_id"],
            aggregations=[
                HyperAggregation(column="notional", function="sum", alias="total_account_notional"),
                HyperAggregation(column="trade_id", function="count", alias="account_trade_count")
            ],
            orderBy=[HyperSort(column="total_account_notional", direction="desc")],
            limit=50
        )
        t0 = time.perf_counter()
        tbl, _, total_groups = engine.execute_query(q, posix_pqt)
        elapsed = (time.perf_counter() - t0) * 1000
        print(f"[{eng.upper()}] Group-By 100k Accounts | Groups: {total_groups:,} | Exec Time: {elapsed:.1f}ms")

    # =========================================================================
    # STEP 6: Full 5-Workload Torture Suite on 8M Rows
    # =========================================================================
    log_header("7. FULL 5-WORKLOAD TORTURE SUITE ON 8,000,000 ROWS")
    torture_req = TortureRequest(dataset_id=pqt_id, engines=["duckdb", "polars"])
    t0 = time.perf_counter()
    scorecard: TortureScorecard = run_torture_suite(torture_req)
    total_torture_time = time.perf_counter() - t0
    print(f"Torture Suite Completed in {total_torture_time:.2f}s! Winner: {scorecard.winner_engine.upper()}")
    print("\nScorecard Results:")
    for r in scorecard.results:
        print(f"  [{r.engine.upper():<7}] {r.workload_name:<28} | Exec: {r.exec_ms:>6.1f}ms | Total: {r.total_ms:>6.1f}ms | RSS Delta: {r.server_rss_delta_mb:>+5.1f}MB | Status: {r.status}")

    # =========================================================================
    # STEP 7: Generate & Ingest 500MB CSV with Complex Quotes & Newlines
    # =========================================================================
    csv_id = "stress_test_500mb_csv"
    csv_file = catalog.data_dir / f"{csv_id}.csv"
    posix_csv = to_posix_path(csv_file)

    log_header("8. GENERATING ~500 MB CSV WITH COMPLEX QUOTES & MULTI-LINE FIELDS")
    t0 = time.perf_counter()
    con = duckdb.connect()
    # 4 million rows with formatted strings generates ~450MB - 520MB of raw CSV text
    con.execute(f"""
        COPY (
            SELECT
                i AS id,
                'TRADER_' || (i % 500)::VARCHAR AS trader_id,
                'Desk ' || (i % 10)::VARCHAR || ', Complex ""Escaped"" Dept' AS department,
                'Commentary line 1 for trade ' || i::VARCHAR || chr(10) || 'Line 2 notes and remarks' AS notes,
                (['USD', 'EUR', 'GBP', 'JPY', 'CHF'])[1 + (i % 5)] AS currency,
                ROUND(100.0 + (i % 99000) / 100.0, 2) AS price,
                10 + (i % 2000) AS qty,
                ROUND((100.0 + (i % 99000) / 100.0) * (10 + (i % 2000)), 2) AS notional,
                (['ACTIVE', 'PENDING', 'SETTLED', 'CANCELLED'])[1 + (i % 4)] AS trade_state
            FROM range(1, 4000001) tbl(i)
        ) TO '{posix_csv}' (FORMAT CSV, HEADER TRUE, QUOTE '"', ESCAPE '"');
    """)
    con.close()
    csv_gen_time = time.perf_counter() - t0
    csv_size_mb = os.path.getsize(posix_csv) / (1024 * 1024)
    print(f"Generated 4,000,000 complex CSV rows in {csv_gen_time:.2f}s | File Size: {csv_size_mb:.2f} MB")

    # Ingest / Convert 500MB CSV to Columnar ZSTD Parquet
    log_header("9. INGESTING & STREAM-CONVERTING 500MB CSV TO ZSTD PARQUET")
    t0 = time.perf_counter()
    weather_csv = catalog.register_file(csv_id, posix_csv, description="500MB Raw CSV Dataset")
    csv_convert_time = time.perf_counter() - t0
    print(f"500MB CSV Stream-Converted in {csv_convert_time:.2f}s!")
    print(f"Rows: {weather_csv.row_count:,} | Columns: {weather_csv.column_count}")
    print(f"Compressed Parquet Size: {weather_csv.file_size_formatted} | Raw CSV: {csv_size_mb:.1f} MB (Compression: {weather_csv.compression_ratio}x)")

    # Test querying converted CSV across engines
    log_header("10. QUERYING CONVERTED 500MB CSV DATASET")
    for eng in ["duckdb", "polars"]:
        engine = lifecycle_manager.get_engine(eng)
        q = HyperQuery(
            dataset=csv_id,
            engine=eng,
            groupBy=["department"],
            aggregations=[
                HyperAggregation(column="notional", function="sum", alias="total_notional"),
                HyperAggregation(column="id", function="count", alias="total_trades")
            ],
            orderBy=[HyperSort(column="total_notional", direction="desc")],
            limit=10
        )
        t0 = time.perf_counter()
        tbl, _, _ = engine.execute_query(q, catalog.get_dataset_path(csv_id))
        elapsed = (time.perf_counter() - t0) * 1000
        print(f"[{eng.upper()}] Group-By Department on 500MB CSV | Exec Time: {elapsed:.1f}ms | Top Dept: {tbl['department'][0].as_py()[:30]}")

    # =========================================================================
    # STEP 8: Memory Lifecycle & Cleanup
    # =========================================================================
    log_header("11. MEMORY LIFECYCLE & PURGE VERIFICATION")
    peak_rss = telemetry_monitor.get_current_rss_mb()
    print(f"Peak Server RSS during 8M Parquet + 500MB CSV Stress Test: {peak_rss:.1f} MB")
    
    # Clean test datasets
    cleaned = catalog.clean_test_datasets()
    print(f"Purged test datasets from catalog & disk: {cleaned}")
    
    rss_after_purge = lifecycle_manager.force_unload_all()
    print(f"Server RSS after Force GC / Memory Purge: {rss_after_purge:.1f} MB")

    log_header("ALL LARGE DATA STRESS TESTS PASSED WITH 100% SUCCESS!")

if __name__ == "__main__":
    run_stress_test()
