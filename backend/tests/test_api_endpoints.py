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

def test_export_csv(api_sample):
    for eng in ["duckdb", "polars", "perspective"]:
        payload = {
            "dataset": api_sample,
            "engine": eng,
            "select": ["trade_id", "symbol", "price"],
            "limit": 10
        }
        res = client.post("/api/query/export", json=payload)
        assert res.status_code == 200
        assert "text/csv" in res.headers.get("content-type", "")
        content = res.text
        assert "trade_id" in content
        assert "symbol" in content

def test_type_coerced_filter(api_sample):
    # Test numeric string "500.0" against float column in DuckDB and Polars
    for eng in ["duckdb", "polars"]:
        payload = {
            "dataset": api_sample,
            "engine": eng,
            "filters": [{"column": "price", "operator": "greater_than", "value": "500.0"}],
            "limit": 10
        }
        res = client.post("/api/query/run", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["total_matching_rows"] > 0

def test_csv_upload_with_quotes_and_commas(tmp_path):
    csv_content = '''trade_id,trader,notes,volume
20001,"O'Connor, John","Complex, with comma and ""escaped"" quotes",150000.5
20002,"Smith, Jane","Multi-line\r\ncommentary text",350000.0
'''
    csv_file = tmp_path / "tricky_quotes.csv"
    csv_file.write_text(csv_content, encoding="utf-8")

    with open(csv_file, "rb") as f:
        res = client.post(
            "/api/datasets/upload",
            data={"dataset_id": "test_tricky_csv"},
            files={"file": ("tricky_quotes.csv", f, "text/csv")}
        )
    assert res.status_code == 200
    weather = res.json()
    assert weather["row_count"] == 2
    assert "trader" in [c["name"] for c in weather["columns"]]

    # Query the converted CSV dataset
    q_res = client.post("/api/query/run", json={"dataset": "test_tricky_csv", "engine": "duckdb"})
    assert q_res.status_code == 200
    rows = q_res.json()["data"]
    assert len(rows) == 2
    assert "O'Connor, John" in rows[0]["trader"]
    assert "Multi-line" in rows[1]["notes"]

    catalog.delete_dataset("test_tricky_csv")

def test_excel_upload(tmp_path):
    import pandas as pd
    df = pd.DataFrame({
        "account_name": ["Global Flow", "APAC Macro", "Credit Alpha"],
        "notional_usd": [1250000.0, 4500000.0, 980000.0],
        "active": [True, True, False]
    })
    xlsx_file = tmp_path / "accounts.xlsx"
    df.to_excel(xlsx_file, index=False)

    with open(xlsx_file, "rb") as f:
        res = client.post(
            "/api/datasets/upload",
            data={"dataset_id": "test_excel_ds"},
            files={"file": ("accounts.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        )
    assert res.status_code == 200
    weather = res.json()
    assert weather["row_count"] == 3
    assert "account_name" in [c["name"] for c in weather["columns"]]

    # Query the converted Excel dataset
    q_res = client.post("/api/query/run", json={"dataset": "test_excel_ds", "engine": "duckdb"})
    assert q_res.status_code == 200
    assert len(q_res.json()["data"]) == 3

    catalog.delete_dataset("test_excel_ds")

def test_write_arrow_table_to_csv_large_string_and_nested(tmp_path):
    import pyarrow as pa
    from backend.app.utils.serialization import write_arrow_table_to_csv

    t = pa.table({
        "id": [1, 2],
        "large_str": pa.array(["alpha_large" * 10, "beta_large" * 10], type=pa.large_string()),
        "sv": pa.array(["alice", "bob"], type=pa.string_view()),
        "tags": pa.array([["apple", "banana"], ["cherry"]], type=pa.list_(pa.string())),
        "meta": pa.array([{"score": 90}, {"score": 95}])
    })
    out_csv = tmp_path / "complex_export.csv"
    write_arrow_table_to_csv(t, str(out_csv))
    assert out_csv.exists()
    content = out_csv.read_text()
    assert "large_str" in content
    assert "alpha_large" in content
    assert "alice" in content
    assert "apple" in content


