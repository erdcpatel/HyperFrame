import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.catalog import catalog
from backend.app.core.s3_manager import s3_manager, S3BucketProfile
from backend.app.engines.duckdb_engine import DuckDBEngine
from backend.app.engines.polars_engine import PolarsEngine
from backend.app.engines.perspective_engine import PerspectiveEngine
from backend.app.models.query import (
    HyperQuery, HyperFilter, HyperSort, HyperAggregation, AgGridRequest
)

client = TestClient(app)

@pytest.fixture(scope="module")
def sample_dataset_path():
    # Use existing benchmark dataset in backend/data/
    p = "backend/data/benchmark_trades_100k.parquet"
    if not (catalog.data_dir / "benchmark_trades_100k.parquet").exists():
        # Fallback to catalog registration
        ds = catalog.list_datasets()
        if ds:
            return catalog.get_dataset_path(ds[0].dataset_id)
    return p

# -----------------------------------------------------------------------------
# 1. POLARS RAW SQL INTEGRITY (SQLContext)
# -----------------------------------------------------------------------------
def test_polars_sql_complex_aggregations_and_subqueries(sample_dataset_path):
    engine = PolarsEngine()
    
    # 1. Window function / Subquery test
    sql = """
    SELECT symbol, desk, total_trades, total_notional
    FROM (
        SELECT symbol, desk, COUNT(*) AS total_trades, SUM(notional) AS total_notional
        FROM :dataset
        WHERE status = 'FILLED'
        GROUP BY symbol, desk
    ) AS _subq
    WHERE total_trades > 5
    ORDER BY total_notional DESC
    LIMIT 10;
    """
    q = HyperQuery(dataset="test_ds", engine="polars", raw_sql=sql, limit=10)
    tbl, plan, total = engine.execute_query(q, sample_dataset_path)
    assert tbl.num_rows > 0
    assert "symbol" in tbl.column_names
    assert "total_notional" in tbl.column_names
    assert "total_trades" in tbl.column_names
    assert total > 0

def test_polars_sql_case_when_and_expressions(sample_dataset_path):
    engine = PolarsEngine()
    
    sql = """
    SELECT 
        symbol,
        price_tier,
        ROUND(AVG(price), 2) AS avg_price
    FROM (
        SELECT symbol, price, CASE WHEN price > 500 THEN 'HIGH_PRICE' ELSE 'NORMAL_PRICE' END AS price_tier
        FROM :dataset
    ) AS _subq
    GROUP BY symbol, price_tier
    ORDER BY avg_price DESC
    LIMIT 5;
    """
    q = HyperQuery(dataset="test_ds", engine="polars", raw_sql=sql, limit=5)
    tbl, plan, total = engine.execute_query(q, sample_dataset_path)
    assert tbl.num_rows > 0
    assert "price_tier" in tbl.column_names
    assert "avg_price" in tbl.column_names

# -----------------------------------------------------------------------------
# 2. DUCKDB ADVANCED SQL & WINDOW FUNCTIONS
# -----------------------------------------------------------------------------
def test_duckdb_advanced_sql_window_functions(sample_dataset_path):
    engine = DuckDBEngine()
    
    sql = """
    SELECT 
        trade_id, symbol, desk, price,
        ROW_NUMBER() OVER (PARTITION BY desk ORDER BY price DESC) AS rank_in_desk
    FROM :dataset
    ORDER BY desk, rank_in_desk
    LIMIT 20;
    """
    q = HyperQuery(dataset="test_ds", engine="duckdb", raw_sql=sql, limit=20)
    tbl, plan, total = engine.execute_query(q, sample_dataset_path)
    assert tbl.num_rows == 20
    assert "rank_in_desk" in tbl.column_names
    assert "price" in tbl.column_names
    ranks = tbl["rank_in_desk"].to_pylist()
    assert 1 in ranks

# -----------------------------------------------------------------------------
# 3. S3 PROFILE CREDENTIAL CHAIN & ZERO-COPY GUARDS
# -----------------------------------------------------------------------------
def test_s3_profile_iam_role_fallback(tmp_path):
    storage = tmp_path / "s3_test_profiles.json"
    mgr = s3_manager.__class__(storage_path=storage)
    
    # Profile with no keys (IAM role mode)
    iam_profile = S3BucketProfile(
        id="iam_lakehouse",
        name="Enterprise IAM Role S3",
        bucket="corp-analytics-lakehouse",
        region="us-east-1",
        access_key_id="",
        secret_access_key=""
    )
    saved = mgr.save_profile(iam_profile)
    assert saved.access_key_masked == "AWS IAM / Default Credential Chain"
    
    # Verify boto client is created without explicit keys
    with patch("backend.app.core.s3_manager.boto3.client") as mock_boto:
        mock_boto.return_value = MagicMock()
        client_inst = mgr.get_boto_client(iam_profile)
        mock_boto.assert_called_once()
        call_kwargs = mock_boto.call_args[1]
        assert "aws_access_key_id" not in call_kwargs
        assert call_kwargs["region_name"] == "us-east-1"

def test_perspective_remote_s3_guard_safe():
    p_engine = PerspectiveEngine()
    # Preload s3 path should not raise or call Path.stat()
    p_engine.load_dataset("remote_s3_ds", "s3://my-lakehouse/data/**/*.parquet")
    assert "remote_s3_ds" not in p_engine._active_tables

# -----------------------------------------------------------------------------
# 4. AG GRID COMMUNITY ADAPTER & INFINITE SCROLL INTEGRITY
# -----------------------------------------------------------------------------
def test_ag_grid_multi_column_filtering_and_sorting():
    ds_list = catalog.list_datasets()
    assert len(ds_list) > 0
    ds_id = ds_list[0].dataset_id

    req = AgGridRequest(
        dataset=ds_id,
        engine="duckdb",
        startRow=0,
        endRow=25,
        sortModel=[{"colId": "price", "sort": "desc"}],
        filterModel={
            "status": {"filterType": "text", "type": "equals", "filter": "FILLED"},
            "price": {"filterType": "number", "type": "greaterThan", "filter": 50.0}
        }
    )
    resp = client.post("/api/query/ag-grid", json=req.model_dump())
    assert resp.status_code == 200
    res_data = resp.json()
    assert "rows" in res_data
    assert "totalCount" in res_data
    assert res_data["startRow"] == 0
    assert res_data["endRow"] <= 25
    assert len(res_data["rows"]) <= 25
    assert "waterfall" in res_data

# -----------------------------------------------------------------------------
# 5. ERROR RESILIENCE & BOUNDARY CONDITIONS
# -----------------------------------------------------------------------------
def test_malformed_sql_handling():
    ds_list = catalog.list_datasets()
    ds_id = ds_list[0].dataset_id

    # Malformed SQL with DuckDB
    req_duck = HyperQuery(dataset=ds_id, engine="duckdb", raw_sql="SELECT FOO BAR BAZ FROM :dataset", limit=10)
    resp_duck = client.post("/api/query/run", json=req_duck.model_dump())
    assert resp_duck.status_code == 400
    assert "error" in resp_duck.json()["detail"].lower()

    # Malformed SQL with Polars
    req_polars = HyperQuery(dataset=ds_id, engine="polars", raw_sql="SELECT INVALID SYNTAX $$$ FROM :dataset", limit=10)
    resp_polars = client.post("/api/query/run", json=req_polars.model_dump())
    assert resp_polars.status_code == 400
    assert "error" in resp_polars.json()["detail"].lower()

def test_nonexistent_dataset_handling():
    req = HyperQuery(dataset="non_existent_dataset_xyz", engine="duckdb", limit=10)
    resp = client.post("/api/query/run", json=req.model_dump())
    assert resp.status_code == 404
    assert "not registered" in resp.json()["detail"].lower()

def test_deep_pagination_boundary():
    ds_list = catalog.list_datasets()
    ds_id = ds_list[0].dataset_id

    # Offset way beyond row count
    req = HyperQuery(dataset=ds_id, engine="duckdb", offset=999999999, limit=50)
    resp = client.post("/api/query/run", json=req.model_dump())
    assert resp.status_code == 200
    res = resp.json()
    assert res["returned_rows"] == 0
    assert len(res["data"]) == 0
