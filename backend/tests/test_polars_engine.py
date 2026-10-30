import pytest
from backend.app.engines.polars_engine import PolarsEngine
from backend.app.models.query import HyperQuery, HyperFilter, HyperSort, HyperAggregation
from backend.app.core.catalog import catalog

@pytest.fixture(scope="module")
def sample_dataset():
    weather = catalog.generate_sample_dataset("test_polars_sample", num_rows=5000)
    yield weather.path
    catalog.delete_dataset("test_polars_sample")

def test_polars_basic_query(sample_dataset):
    engine = PolarsEngine()
    q = HyperQuery(
        dataset="test_polars_sample",
        engine="polars",
        select=["trade_id", "symbol", "price", "quantity", "notional"],
        limit=50
    )
    table, plan, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows == 50
    assert "trade_id" in table.column_names
    assert "notional" in table.column_names
    assert total_rows == 5000

def test_polars_filter_and_sort(sample_dataset):
    engine = PolarsEngine()
    q = HyperQuery(
        dataset="test_polars_sample",
        engine="polars",
        filters=[HyperFilter(column="price", operator="greater_than", value=500.0)],
        orderBy=[HyperSort(column="price", direction="desc")],
        limit=20
    )
    table, plan, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows <= 20
    assert total_rows > 0
    prices = table["price"].to_pylist()
    assert all(p > 500.0 for p in prices)
    assert prices == sorted(prices, reverse=True)

def test_polars_group_by_aggregation(sample_dataset):
    engine = PolarsEngine()
    q = HyperQuery(
        dataset="test_polars_sample",
        engine="polars",
        groupBy=["symbol"],
        aggregations=[
            HyperAggregation(column="notional", function="sum", alias="total_notional"),
            HyperAggregation(column="trade_id", function="count", alias="count_trades")
        ],
        orderBy=[HyperSort(column="total_notional", direction="desc")],
        limit=10
    )
    table, plan, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows <= 10
    assert "symbol" in table.column_names
    assert "total_notional" in table.column_names
    assert "count_trades" in table.column_names

def test_polars_explain(sample_dataset):
    engine = PolarsEngine()
    q = HyperQuery(dataset="test_polars_sample", engine="polars", limit=10)
    plan = engine.explain(q, sample_dataset)
    assert "SCAN" in plan or "PARQUET" in plan or "PROJECT" in plan

def test_polars_special_character_filter(sample_dataset):
    engine = PolarsEngine()
    q = HyperQuery(
        dataset="test_polars_sample",
        engine="polars",
        filters=[HyperFilter(column="symbol", operator="contains", value="(US)")],
        limit=10
    )
    # Must execute safely without Regex syntax crash
    table, plan, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows == 0

def test_polars_multi_column_quick_search(sample_dataset):
    engine = PolarsEngine()
    q = HyperQuery(
        dataset="test_polars_sample",
        engine="polars",
        quick_search="APAC",
        limit=10
    )
    table, plan, total_rows = engine.execute_query(q, sample_dataset)
    assert total_rows > 0
    desks = table["desk"].to_pylist()
    assert all("APAC" in d for d in desks)

def test_polars_raw_sql_execution(sample_dataset):
    engine = PolarsEngine()
    q = HyperQuery(
        dataset="test_polars_sample",
        engine="polars",
        raw_sql="SELECT symbol, COUNT(*) AS cnt, SUM(notional) AS total_val FROM :dataset GROUP BY symbol ORDER BY total_val DESC LIMIT 5",
        limit=5
    )
    table, plan, total_rows = engine.execute_query(q, sample_dataset)
    assert table.num_rows > 0
    assert "symbol" in table.column_names
    assert "cnt" in table.column_names
    assert "total_val" in table.column_names

def test_polars_duplicate_columns_and_alias_collision(sample_dataset):
    engine = PolarsEngine()

    # 1. Duplicate columns in select list
    q_sel = HyperQuery(
        dataset="test_polars_sample",
        engine="polars",
        select=["trade_id", "trade_id", "symbol", "trade_id"],
        limit=5
    )
    tbl, _, _ = engine.execute_query(q_sel, sample_dataset)
    assert tbl.num_rows > 0
    assert "trade_id" in tbl.column_names
    assert "symbol" in tbl.column_names

    # 2. Aggregation alias collision with group_by column name
    q_agg = HyperQuery(
        dataset="test_polars_sample",
        engine="polars",
        groupBy=["symbol", "symbol"],  # Duplicate group by
        aggregations=[
            HyperAggregation(column="price", function="sum", alias="symbol"),  # Alias clashes with groupBy
            HyperAggregation(column="notional", function="sum", alias="symbol")  # Duplicate alias
        ],
        limit=5
    )
    tbl_agg, _, _ = engine.execute_query(q_agg, sample_dataset)
    assert tbl_agg.num_rows > 0
    assert "symbol" in tbl_agg.column_names
    assert "symbol_1" in tbl_agg.column_names
    assert "symbol_2" in tbl_agg.column_names
