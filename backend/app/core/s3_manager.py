import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Any
from pydantic import BaseModel, Field
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from backend.app.config import settings
from backend.app.utils.serialization import format_bytes

class S3BucketProfile(BaseModel):
    id: str
    name: str
    bucket: str
    region: str = "us-east-1"
    access_key_id: str
    secret_access_key: str
    endpoint_url: Optional[str] = None
    use_ssl: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())

class S3ProfilePublic(BaseModel):
    id: str
    name: str
    bucket: str
    region: str
    access_key_masked: str
    endpoint_url: Optional[str] = None
    created_at: str
    status: Optional[str] = "configured"  # "connected" | "error" | "configured"
    latency_ms: Optional[float] = None
    error_message: Optional[str] = None

class S3FileItem(BaseModel):
    name: str
    key: str
    size_bytes: int
    size_formatted: str
    last_modified: str
    is_parquet: bool

class S3BrowseResponse(BaseModel):
    profile_id: str
    bucket: str
    prefix: str
    subfolders: list[str]
    files: list[S3FileItem]
    total_files_in_folder: int
    total_bytes_in_folder: int
    total_bytes_formatted: str
    is_partitioned: bool

def mask_key(key: str) -> str:
    if len(key) <= 8:
        return "••••••••"
    return f"{key[:4]}••••••••{key[-4:]}"

class S3ProfilesManager:
    def __init__(self, storage_path: Optional[Path] = None):
        self.storage_path = storage_path or (settings.DATA_DIR / ".s3_profiles.json")
        self._ensure_storage()

    def _ensure_storage(self):
        if not self.storage_path.exists():
            self.storage_path.parent.mkdir(parents=True, exist_ok=True)
            self._write_profiles({})

    def _read_profiles(self) -> dict[str, dict]:
        try:
            with open(self.storage_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _write_profiles(self, profiles: dict[str, dict]):
        with open(self.storage_path, "w", encoding="utf-8") as f:
            json.dump(profiles, f, indent=2)

    def list_profiles(self) -> list[S3ProfilePublic]:
        raw = self._read_profiles()
        res = []
        for p in raw.values():
            res.append(S3ProfilePublic(
                id=p["id"],
                name=p["name"],
                bucket=p["bucket"],
                region=p.get("region", "us-east-1"),
                access_key_masked=mask_key(p.get("access_key_id", "")),
                endpoint_url=p.get("endpoint_url"),
                created_at=p.get("created_at", "")
            ))
        return res

    def get_profile(self, profile_id: str) -> Optional[S3BucketProfile]:
        raw = self._read_profiles()
        p = raw.get(profile_id)
        if not p:
            return None
        return S3BucketProfile(**p)

    def save_profile(self, profile: S3BucketProfile) -> S3ProfilePublic:
        raw = self._read_profiles()
        raw[profile.id] = profile.model_dump()
        self._write_profiles(raw)
        return S3ProfilePublic(
            id=profile.id,
            name=profile.name,
            bucket=profile.bucket,
            region=profile.region,
            access_key_masked=mask_key(profile.access_key_id),
            endpoint_url=profile.endpoint_url,
            created_at=profile.created_at,
            status="configured"
        )

    def delete_profile(self, profile_id: str) -> bool:
        raw = self._read_profiles()
        if profile_id in raw:
            del raw[profile_id]
            self._write_profiles(raw)
            return True
        return False

    def get_boto_client(self, profile: S3BucketProfile) -> Any:
        cfg = Config(
            region_name=profile.region,
            s3={'addressing_style': 'path' if profile.endpoint_url else 'auto'},
            retries={'max_attempts': 3, 'mode': 'standard'}
        )
        return boto3.client(
            's3',
            aws_access_key_id=profile.access_key_id,
            aws_secret_access_key=profile.secret_access_key,
            endpoint_url=profile.endpoint_url,
            use_ssl=profile.use_ssl,
            config=cfg
        )

    def test_connection(self, profile_id: str) -> dict:
        profile = self.get_profile(profile_id)
        if not profile:
            return {"success": False, "message": f"Profile '{profile_id}' not found."}

        client = self.get_boto_client(profile)
        t0 = time.time()
        try:
            # Test with HeadBucket or ListObjectsV2
            client.head_bucket(Bucket=profile.bucket)
            latency = (time.time() - t0) * 1000
            return {
                "success": True,
                "profile_id": profile.id,
                "bucket": profile.bucket,
                "latency_ms": round(latency, 1),
                "message": f"Successfully connected to bucket '{profile.bucket}' in {latency:.1f}ms."
            }
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            error_msg = e.response.get("Error", {}).get("Message", str(e))
            return {
                "success": False,
                "profile_id": profile.id,
                "bucket": profile.bucket,
                "error_code": error_code,
                "message": f"S3 Connection Error [{error_code}]: {error_msg}"
            }
        except Exception as e:
            return {
                "success": False,
                "profile_id": profile.id,
                "bucket": profile.bucket,
                "message": f"Connection failed: {str(e)}"
            }

    def browse_folder(self, profile_id: str, prefix: str = "") -> S3BrowseResponse:
        profile = self.get_profile(profile_id)
        if not profile:
            raise ValueError(f"Profile '{profile_id}' not found.")

        # Ensure prefix ends with '/' if not empty
        clean_prefix = prefix.strip()
        if clean_prefix and not clean_prefix.endswith("/"):
            clean_prefix += "/"

        client = self.get_boto_client(profile)
        paginator = client.get_paginator('list_objects_v2')
        page_iterator = paginator.paginate(
            Bucket=profile.bucket,
            Prefix=clean_prefix,
            Delimiter='/'
        )

        subfolders = []
        files = []
        total_bytes = 0

        for page in page_iterator:
            for common_prefix in page.get('CommonPrefixes', []):
                folder_path = common_prefix.get('Prefix', '')
                folder_name = folder_path[len(clean_prefix):].rstrip('/')
                if folder_name:
                    subfolders.append(folder_name)

            for obj in page.get('Contents', []):
                key = obj.get('Key', '')
                if key == clean_prefix:
                    continue  # Directory marker object
                file_name = key[len(clean_prefix):]
                if not file_name:
                    continue
                size = obj.get('Size', 0)
                total_bytes += size
                last_mod = obj.get('LastModified', datetime.now()).isoformat()
                is_pqt = any(key.lower().endswith(ext) for ext in ['.parquet', '.pqt'])

                files.append(S3FileItem(
                    name=file_name,
                    key=key,
                    size_bytes=size,
                    size_formatted=format_bytes(size),
                    last_modified=last_mod,
                    is_parquet=is_pqt
                ))

        # Check for Hive partitioning (folders containing '=' like date=2026-10-29 or year=2026)
        is_partitioned = any("=" in sf for sf in subfolders)

        return S3BrowseResponse(
            profile_id=profile.id,
            bucket=profile.bucket,
            prefix=clean_prefix,
            subfolders=sorted(subfolders),
            files=files,
            total_files_in_folder=len(files),
            total_bytes_in_folder=total_bytes,
            total_bytes_formatted=format_bytes(total_bytes),
            is_partitioned=is_partitioned
        )

s3_manager = S3ProfilesManager()
