import pytest
from backend.app.core.catalog import catalog
from backend.app.core.lifecycle import lifecycle_manager

def test_catalog_sample_and_weather():
    weather = catalog.generate_sample_dataset("test_lifecycle_ds", num_rows=2000)
    assert weather.row_count == 2000
    assert weather.column_count >= 10
    assert weather.file_size_bytes > 0
    assert weather.compression_ratio > 0

    # Profile Weather
    profiled = catalog.get_weather("test_lifecycle_ds", compute_deep_profiles=True)
    symbol_col = next((c for c in profiled.columns if c.name == "symbol"), None)
    assert symbol_col is not None
    assert symbol_col.approx_unique > 0
    assert symbol_col.null_percentage == 0.0

    catalog.delete_dataset("test_lifecycle_ds")

def test_lifecycle_engine_switching():
    # Activate duckdb
    e1 = lifecycle_manager.activate_engine("duckdb")
    assert e1.name == "duckdb"
    assert lifecycle_manager.active_engine_name == "duckdb"

    # Activate polars
    e2 = lifecycle_manager.activate_engine("polars")
    assert e2.name == "polars"
    assert lifecycle_manager.active_engine_name == "polars"

    # Purge memory
    rss_after = lifecycle_manager.force_unload_all()
    assert rss_after > 0
