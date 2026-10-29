import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.catalog import catalog

client = TestClient(app)

@pytest.fixture(scope="module")
def api_sample():
    weather = catalog.generate_sample_dataset("api_test_dataset", num_rows=1000)
    yield "api_test_dataset"
    catalog.delete_dataset("api_test_dataset")

def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"

def test_datasets_list(api_sample):
    res = client.get("/api/datasets")
    assert res.status_code == 200
    ids = [d["dataset_id"] for d in res.json()]
    assert api_sample in ids

def test_query_run_duckdb(api_sample):
    payload = {
        "dataset": api_sample,
        "engine": "duckdb",
        "wire_format": "json",
        "select": ["trade_id", "symbol", "price", "notional"],
        "limit": 10
    }
    res = client.post("/api/query/run", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert len(data["data"]) == 10
    assert data["total_matching_rows"] == 1000
    assert data["waterfall"]["engine_exec_ms"] >= 0

def test_query_run_polars(api_sample):
    payload = {
        "dataset": api_sample,
        "engine": "polars",
        "wire_format": "json",
        "select": ["trade_id", "symbol", "price", "notional"],
        "limit": 10
    }
    res = client.post("/api/query/run", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert len(data["data"]) == 10
    assert data["total_matching_rows"] == 1000

def test_ag_grid_adapter(api_sample):
    payload = {
        "dataset": api_sample,
        "engine": "duckdb",
        "startRow": 0,
        "endRow": 50,
        "filterModel": {
            "symbol": {"type": "equals", "filter": "NVDA"}
        },
        "sortModel": [
            {"colId": "price", "sort": "desc"}
        ]
    }
    res = client.post("/api/query/ag-grid", json=payload)
    assert res.status_code == 200
    res_data = res.json()
    assert "rows" in res_data
    assert len(res_data["rows"]) <= 50
    assert res_data["totalCount"] > 0
    assert "waterfall" in res_data

def test_torture_benchmarks(api_sample):
    payload = {
        "dataset_id": api_sample,
        "engines": ["duckdb", "polars"]
    }
    res = client.post("/api/benchmarks/torture", json=payload)
    assert res.status_code == 200
    scorecard = res.json()
    assert scorecard["dataset_id"] == api_sample
    assert len(scorecard["results"]) == 10  # 5 workloads x 2 engines
    assert scorecard["winner_engine"] in ["duckdb", "polars"]
