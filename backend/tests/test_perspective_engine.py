import os
import pytest
import pyarrow as pa
from backend.app.engines.perspective_engine import PerspectiveEngine
from backend.app.models.query import HyperQuery, HyperFilter, HyperSort, HyperAggregation

@pytest.fixture
def perspective_engine():
    engine = PerspectiveEngine()
    yield engine
    engine.unload()

def test_perspective_basic_query(perspective_engine):
    p = "backend/data/benchmark_trades_100k.parquet"
    if not os.path.exists(p):
        pytest.skip("Benchmark parquet dataset not found")

    q = HyperQuery(
        dataset="benchmark_trades_100k",
        select=["trade_id", "symbol", "price"],
        limit=50
    )
    tbl, plan, total = perspective_engine.execute_query(q, p)
    assert tbl.num_rows == 50
    assert "symbol" in tbl.column_names
    assert total > 0

def test_perspective_filter_and_sort(perspective_engine):
    p = "backend/data/benchmark_trades_100k.parquet"
    if not os.path.exists(p):
        pytest.skip("Benchmark parquet dataset not found")

    q = HyperQuery(
        dataset="benchmark_trades_100k",
        select=["trade_id", "symbol", "price"],
        filters=[HyperFilter(column="symbol", operator="equals", value="NVDA")],
        orderBy=[HyperSort(column="price", direction="desc")],
        limit=20
    )
    tbl, plan, total = perspective_engine.execute_query(q, p)
    assert tbl.num_rows <= 20
    assert total > 0
    symbols = tbl.column("symbol").to_pylist()
    assert all(s == "NVDA" for s in symbols)

def test_perspective_group_by_native(perspective_engine):
    p = "backend/data/benchmark_trades_100k.parquet"
    if not os.path.exists(p):
        pytest.skip("Benchmark parquet dataset not found")

    q = HyperQuery(
        dataset="benchmark_trades_100k",
        groupBy=["symbol"],
        aggregations=[
            HyperAggregation(column="price", function="avg", alias="avg_price"),
            HyperAggregation(column="trade_id", function="count", alias="row_count")
        ],
        limit=10
    )
    tbl, plan, total = perspective_engine.execute_query(q, p)
    assert tbl.num_rows <= 10
    assert any("symbol" in col for col in tbl.column_names)
    assert "price" in tbl.column_names
    assert total > 0
    assert "Perspective" in plan

def test_perspective_group_by_hybrid_pushdown(monkeypatch, perspective_engine):
    p = "backend/data/benchmark_trades_100k.parquet"
    if not os.path.exists(p):
        pytest.skip("Benchmark parquet dataset not found")

    # Set threshold to 1.0 MB so the 2.33 MB file triggers Hybrid Pushdown
    monkeypatch.setattr("backend.app.engines.perspective_engine.PSP_PUSHDOWN_THRESHOLD_MB", 1.0)

    q = HyperQuery(
        dataset="benchmark_trades_100k",
        groupBy=["symbol"],
        aggregations=[
            HyperAggregation(column="price", function="avg", alias="avg_price"),
            HyperAggregation(column="trade_id", function="count", alias="row_count")
        ],
        orderBy=[HyperSort(column="avg_price", direction="desc")],
        limit=10
    )
    tbl, plan, total = perspective_engine.execute_query(q, p)
    assert tbl.num_rows <= 10
    assert "symbol" in tbl.column_names
    assert "avg_price" in tbl.column_names
    assert "row_count" in tbl.column_names
    assert total > 0

def test_perspective_s3_guard(perspective_engine):
    # load_dataset on an s3 URI must be a safe no-op without attempting Path.stat()
    perspective_engine.load_dataset("s3_test", "s3://my-bucket/trades/**/*.parquet")
    assert "s3_test" not in perspective_engine._active_tables
