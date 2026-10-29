import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import duckdb

from backend.app.core.s3_manager import (
    s3_manager, S3BucketProfile, S3ProfilePublic, S3BrowseResponse
)
from backend.app.core.catalog import catalog
from backend.app.models.dataset import DatasetWeather
from backend.app.utils.serialization import arrow_table_to_dict_list

router = APIRouter(prefix="/api/s3", tags=["S3 Lakehouse"])

class S3RegisterRequest(BaseModel):
    dataset_id: str
    profile_id: str
    folder_prefix: str = ""
    recursive_glob: bool = True  # If True, matches '**/*.parquet', else '*.parquet'
    description: Optional[str] = None

class S3PreviewRequest(BaseModel):
    profile_id: str
    folder_prefix: str = ""
    recursive_glob: bool = True
    limit: int = 10

@router.get("/profiles", response_model=list[S3ProfilePublic])
def list_s3_profiles():
    """
    List all configured S3 bucket profiles with credentials masked.
    """
    return s3_manager.list_profiles()

@router.post("/profiles", response_model=S3ProfilePublic)
def save_s3_profile(profile: S3BucketProfile):
    """
    Save or update an S3 bucket configuration profile.
    """
    return s3_manager.save_profile(profile)

@router.delete("/profiles/{profile_id}")
def delete_s3_profile(profile_id: str):
    """
    Delete an S3 bucket profile.
    """
    success = s3_manager.delete_profile(profile_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found.")
    return {"status": "success", "message": f"Profile '{profile_id}' deleted."}

@router.post("/profiles/{profile_id}/test")
def test_s3_connection(profile_id: str):
    """
    Test live connectivity and permissions for an S3 bucket profile.
    """
    res = s3_manager.test_connection(profile_id)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.get("/browse", response_model=S3BrowseResponse)
def browse_s3_folder(
    profile_id: str = Query(..., description="ID of the configured S3 profile"),
    prefix: str = Query("", description="Folder prefix/path within the bucket")
):
    """
    Interactive S3 folder navigation: returns subfolders and files with metadata.
    """
    profile = s3_manager.get_profile(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"S3 Profile '{profile_id}' not found.")
    try:
        return s3_manager.browse_folder(profile_id, prefix)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"S3 Browse Error: {str(e)}")

@router.post("/preview")
def preview_s3_data(req: S3PreviewRequest):
    """
    Live zero-download sample preview: queries the top 10 rows directly from S3 via DuckDB httpfs.
    """
    profile = s3_manager.get_profile(req.profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{req.profile_id}' not found.")

    prefix = req.folder_prefix.strip().strip("/")
    pattern = "**/*.parquet" if req.recursive_glob else "*.parquet"
    s3_path = f"s3://{profile.bucket}/{prefix}/{pattern}" if prefix else f"s3://{profile.bucket}/{pattern}"

    con = duckdb.connect()
    try:
        con.execute("INSTALL httpfs; LOAD httpfs;")
        con.execute(f"SET s3_region = '{profile.region}';")
        con.execute(f"SET s3_access_key_id = '{profile.access_key_id}';")
        con.execute(f"SET s3_secret_access_key = '{profile.secret_access_key}';")
        if profile.endpoint_url:
            con.execute(f"SET s3_endpoint = '{profile.endpoint_url}';")
            con.execute("SET s3_url_style = 'path';")

        t0 = time.time()
        arrow_tbl = con.execute(f"SELECT * FROM read_parquet('{s3_path}') LIMIT {req.limit};").to_arrow_table()
        latency_ms = (time.time() - t0) * 1000

        rows = arrow_table_to_dict_list(arrow_tbl)
        columns = arrow_tbl.column_names
        types = {c: str(arrow_tbl.field(c).type) for c in columns}

        return {
            "status": "success",
            "s3_path": s3_path,
            "latency_ms": round(latency_ms, 1),
            "columns": columns,
            "column_types": types,
            "rows": rows
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"S3 Preview Error: {str(e)}")
    finally:
        con.close()

@router.post("/register", response_model=DatasetWeather)
def register_s3_dataset(req: S3RegisterRequest):
    """
    Registers an entire multi-file S3 folder as a single unified dataset in the catalog.
    Computes schema weather directly over HTTP range requests with zero local disk download.
    """
    profile = s3_manager.get_profile(req.profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{req.profile_id}' not found.")

    prefix = req.folder_prefix.strip().strip("/")
    pattern = "**/*.parquet" if req.recursive_glob else "*.parquet"
    s3_path = f"s3://{profile.bucket}/{prefix}/{pattern}" if prefix else f"s3://{profile.bucket}/{pattern}"

    try:
        weather = catalog.register_s3_dataset(
            dataset_id=req.dataset_id,
            profile_id=req.profile_id,
            s3_uri=s3_path,
            description=req.description or f"S3 Lakehouse folder: {s3_path}"
        )
        return weather
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to register S3 dataset: {str(e)}")
