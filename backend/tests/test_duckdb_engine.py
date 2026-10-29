import pytest
from pathlib import Path
from backend.app.engines.duckdb_engine import DuckDBEngine
from backend.app.models.query import HyperQuery, HyperFilter, HyperSort, HyperAggregation
from backend.app.core.catalog import catalog

@pytest.fixture(scope="module")
def sample_dataset():
    weather = catalog.generate_sample_dataset("test_duckdb_sample", num_rows=5000)
    yield weather.path
    catalog.delete_dataset("test_duckdb_sample")

def test_duckdb_basic_query(sample_dataset):
    engine = DuckDBEngine()
    q = HyperQuery(
        dataset="test_duckdb_sample",
        select=["trade_id", "symbol", "price", "quantity", "notional"],
        limit=50
    )
    table, sql, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows == 50
    assert "trade_id" in table.column_names
    assert "notional" in table.column_names
    assert total_rows == 5000

def test_duckdb_filter_and_sort(sample_dataset):
    engine = DuckDBEngine()
    q = HyperQuery(
        dataset="test_duckdb_sample",
        filters=[HyperFilter(column="price", operator="greater_than", value=500.0)],
        orderBy=[HyperSort(column="price", direction="desc")],
        limit=20
    )
    table, sql, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows <= 20
    assert total_rows > 0
    prices = table["price"].to_pylist()
    assert all(p > 500.0 for p in prices)
    assert prices == sorted(prices, reverse=True)

def test_duckdb_group_by_aggregation(sample_dataset):
    engine = DuckDBEngine()
    q = HyperQuery(
        dataset="test_duckdb_sample",
        groupBy=["symbol"],
        aggregations=[
            HyperAggregation(column="notional", function="sum", alias="total_notional"),
            HyperAggregation(column="trade_id", function="count", alias="count_trades")
        ],
        orderBy=[HyperSort(column="total_notional", direction="desc")],
        limit=10
    )
    table, sql, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows <= 10
    assert "symbol" in table.column_names
    assert "total_notional" in table.column_names
    assert "count_trades" in table.column_names

def test_duckdb_explain(sample_dataset):
    engine = DuckDBEngine()
    q = HyperQuery(dataset="test_duckdb_sample", limit=10)
    plan = engine.explain(q, sample_dataset)
    assert "EXPLAIN" not in plan or "Scan" in plan or "PARQUET" in plan

def test_duckdb_multi_dataset_join(sample_dataset):
    # Register a secondary small dataset
    sec_weather = catalog.generate_sample_dataset("test_secondary_ds", num_rows=100)
    engine = DuckDBEngine()
    
    # Query with JOIN using dataset names directly
    join_sql = """
    SELECT 
        a.trade_id, 
        a.symbol, 
        a.notional, 
        b.price AS secondary_price
    FROM test_duckdb_sample a
    JOIN test_secondary_ds b ON a.symbol = b.symbol
    LIMIT 25;
    """
    q = HyperQuery(
        dataset="test_duckdb_sample",
        raw_sql=join_sql,
        limit=25
    )
    table, sql, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows <= 25
    assert "trade_id" in table.column_names
    assert "secondary_price" in table.column_names

    catalog.delete_dataset("test_secondary_ds")

def test_duckdb_multi_column_quick_search(sample_dataset):
    engine = DuckDBEngine()
    q = HyperQuery(
        dataset="test_duckdb_sample",
        quick_search="APAC",
        limit=10
    )
    table, sql, total_rows = engine.execute_query(q, sample_dataset)
    assert total_rows > 0
    desks = table["desk"].to_pylist()
    assert all("APAC" in d for d in desks)
