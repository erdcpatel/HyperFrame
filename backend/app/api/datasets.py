import shutil
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import Optional

from backend.app.core.catalog import catalog
from backend.app.models.dataset import DatasetRegistration, DatasetWeather, DatasetSummary
from backend.app.config import settings

router = APIRouter(prefix="/api/datasets", tags=["Datasets"])

@router.get("", response_model=list[DatasetSummary])
def list_datasets():
    return catalog.list_datasets()

@router.post("/register", response_model=DatasetWeather)
def register_dataset(req: DatasetRegistration):
    try:
        weather = catalog.register_file(req.dataset_id, req.file_path or "", req.description)
        return weather
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

@router.post("/upload", response_model=DatasetWeather)
async def upload_dataset(
    dataset_id: str = Form(...),
    file: UploadFile = File(...)
):
    suffix = Path(file.filename or "").suffix.lower()
    allowed_exts = {".parquet", ".pqt", ".csv", ".tsv", ".xlsx", ".xls"}
    if suffix not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{suffix}'. Supported: Parquet (.parquet), CSV (.csv), TSV (.tsv), Excel (.xlsx, .xls)"
        )

    dest_path = settings.DATA_DIR / f"{dataset_id}{suffix}"
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return catalog.register_file(dataset_id, str(dest_path), description=f"Uploaded {suffix} file: {file.filename}")

@router.post("/sample", response_model=DatasetWeather)
def generate_sample(
    dataset_id: str = "synthetic_trades_500k",
    rows: int = 500000
):
    try:
        return catalog.generate_sample_dataset(dataset_id, num_rows=rows)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate sample dataset: {str(e)}")

@router.post("/scan")
def scan_directory():
    """
    Scans the backend/data/ directory for any dropped Parquet files and auto-registers them.
    """
    registered = catalog.scan_data_directory()
    return {
        "status": "success",
        "newly_registered_count": len(registered),
        "datasets": [w.dataset_id for w in registered]
    }

@router.post("/clean-test-data")
def clean_test_data():
    """
    Deletes all synthetic and test datasets from disk and catalog.
    """
    removed = catalog.clean_test_datasets()
    return {
        "status": "success",
        "message": f"Cleaned {len(removed)} test datasets.",
        "removed_datasets": removed
    }

@router.get("/{dataset_id}/weather", response_model=DatasetWeather)
def get_dataset_weather(dataset_id: str, deep: bool = True):
    try:
        return catalog.get_weather(dataset_id, compute_deep_profiles=deep)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error profiling dataset: {str(e)}")

@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: str):
    catalog.delete_dataset(dataset_id)
    return {"status": "success", "message": f"Dataset '{dataset_id}' removed from catalog."}
