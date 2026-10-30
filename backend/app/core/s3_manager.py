import json
import logging
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

logger = logging.getLogger("hyperframe.s3")

class S3BucketProfile(BaseModel):
    id: str
    name: str
    bucket: str
    region: str = "us-east-1"
    access_key_id: Optional[str] = ""
    secret_access_key: Optional[str] = ""
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
    use_ssl: bool = True
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
    has_more: bool = False

def mask_key(key: str) -> str:
    if not key or key in ["IAM_ROLE", "DEFAULT"]:
        return "AWS IAM / Default Credential Chain"
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
                use_ssl=p.get("use_ssl", True),
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
        existing = raw.get(profile.id)
        dump = profile.model_dump()
        if existing:
            # If editing and keys are left blank or placeholder, preserve existing credentials
            if not profile.secret_access_key or "••••" in profile.secret_access_key:
                dump["secret_access_key"] = existing.get("secret_access_key", "")
            if not profile.access_key_id or "••••" in profile.access_key_id:
                dump["access_key_id"] = existing.get("access_key_id", "")
        raw[profile.id] = dump
        self._write_profiles(raw)
        logger.info(f"S3 Profile '{profile.id}' saved successfully (bucket='{dump.get('bucket')}', region='{dump.get('region')}', use_ssl={dump.get('use_ssl')})")
        return S3ProfilePublic(
            id=profile.id,
            name=dump["name"],
            bucket=dump["bucket"],
            region=dump["region"],
            access_key_masked=mask_key(dump.get("access_key_id", "")),
            endpoint_url=dump.get("endpoint_url"),
            use_ssl=dump.get("use_ssl", True),
            created_at=dump.get("created_at", profile.created_at),
            status="configured"
        )

    def delete_profile(self, profile_id: str) -> bool:
        raw = self._read_profiles()
        if profile_id in raw:
            del raw[profile_id]
            self._write_profiles(raw)
            logger.info(f"S3 Profile '{profile_id}' deleted.")
            return True
        return False

    def get_boto_client(self, profile: S3BucketProfile) -> Any:
        cfg = Config(
            region_name=profile.region,
            s3={'addressing_style': 'path' if profile.endpoint_url else 'auto'},
            retries={'max_attempts': 3, 'mode': 'standard'},
            connect_timeout=5,
            read_timeout=15
        )
        kwargs: dict[str, Any] = {
            'service_name': 's3',
            'region_name': profile.region,
            'endpoint_url': profile.endpoint_url,
            'use_ssl': profile.use_ssl,
            'config': cfg
        }
        # If explicit credentials provided, pass them; otherwise boto3 uses IAM Role / Default Credential Chain
        if profile.access_key_id and profile.secret_access_key and profile.access_key_id not in ["IAM_ROLE", "DEFAULT"]:
            kwargs['aws_access_key_id'] = profile.access_key_id
            kwargs['aws_secret_access_key'] = profile.secret_access_key

        return boto3.client(**kwargs)

    def test_connection(self, profile_id: str) -> dict:
        profile = self.get_profile(profile_id)
        if not profile:
            logger.warning(f"test_connection called for non-existent profile '{profile_id}'")
            return {"success": False, "message": f"Profile '{profile_id}' not found."}

        logger.info(
            f"Testing S3 Connection for Profile '{profile.id}' -> Bucket: '{profile.bucket}', "
            f"Region: '{profile.region}', SSL: {profile.use_ssl}, Endpoint: '{profile.endpoint_url or 'AWS S3 Default'}'"
        )
        client = self.get_boto_client(profile)
        t0 = time.time()
        try:
            # 1. Primary check: HeadBucket
            client.head_bucket(Bucket=profile.bucket)
            latency = (time.time() - t0) * 1000
            auth_type = "IAM / Default Chain" if not profile.access_key_id or profile.access_key_id in ["IAM_ROLE", "DEFAULT"] else "Access Key"
            logger.info(f"S3 Connection Succeeded for bucket '{profile.bucket}' in {latency:.1f}ms ({auth_type})")
            return {
                "success": True,
                "profile_id": profile.id,
                "bucket": profile.bucket,
                "latency_ms": round(latency, 1),
                "auth_type": auth_type,
                "message": f"Successfully connected to bucket '{profile.bucket}' in {latency:.1f}ms ({auth_type})."
            }
        except ClientError as e:
            error_code = str(e.response.get("Error", {}).get("Code", "Unknown"))
            error_msg = str(e.response.get("Error", {}).get("Message", str(e)))
            headers = e.response.get("ResponseMetadata", {}).get("HTTPHeaders", {})
            actual_region = headers.get("x-amz-bucket-region")

            logger.error(
                f"[S3 Connection Failed] Bucket: '{profile.bucket}', Region: '{profile.region}', "
                f"Error Code: {error_code}, Message: {error_msg}, AWS Headers: {headers}"
            )

            # Check for AWS Region Mismatch in S3 response headers
            if actual_region and actual_region != profile.region:
                diagnostic = (
                    f"AWS Region Mismatch: S3 bucket '{profile.bucket}' is located in '{actual_region}', "
                    f"but this profile is configured for '{profile.region}'. "
                    f"Please edit this connection and set Region to '{actual_region}'."
                )
                logger.warning(f"[S3 Region Mismatch] {diagnostic}")
                return {
                    "success": False,
                    "profile_id": profile.id,
                    "bucket": profile.bucket,
                    "error_code": "RegionMismatch",
                    "actual_region": actual_region,
                    "message": diagnostic
                }

            # If HeadBucket returns 403 Forbidden, test fallback to ListObjectsV2 (some IAM policies block HeadBucket)
            if error_code in ["403", "AccessDenied", "Forbidden"]:
                try:
                    logger.info(f"Attempting ListObjectsV2 fallback probe on '{profile.bucket}'...")
                    client.list_objects_v2(Bucket=profile.bucket, MaxKeys=1)
                    latency = (time.time() - t0) * 1000
                    logger.info(f"S3 ListObjectsV2 fallback succeeded for '{profile.bucket}'!")
                    return {
                        "success": True,
                        "profile_id": profile.id,
                        "bucket": profile.bucket,
                        "latency_ms": round(latency, 1),
                        "message": f"Connected to '{profile.bucket}' (HeadBucket returned 403, but ListObjectsV2 verified access)."
                    }
                except ClientError as list_err:
                    list_headers = list_err.response.get("ResponseMetadata", {}).get("HTTPHeaders", {})
                    list_region = list_headers.get("x-amz-bucket-region")
                    if list_region and list_region != profile.region:
                        return {
                            "success": False,
                            "profile_id": profile.id,
                            "bucket": profile.bucket,
                            "error_code": "RegionMismatch",
                            "actual_region": list_region,
                            "message": f"Region Mismatch: Bucket '{profile.bucket}' is located in '{list_region}'. Please edit profile region to '{list_region}'."
                        }

            # Detailed actionable 403 diagnosis
            if error_code in ["403", "AccessDenied", "Forbidden"]:
                advice = (
                    f"S3 Connection Error [403 Forbidden]: Access denied to bucket '{profile.bucket}'. "
                    f"Common causes:\n"
                    f"1. Wrong AWS Region (bucket is in another region; verify in AWS S3 Console).\n"
                    f"2. Invalid or expired Access Key / Secret Key.\n"
                    f"3. IAM policy missing 's3:ListBucket' permission on 'arn:aws:s3:::{profile.bucket}'.\n"
                    f"4. Bucket Policy or VPC endpoint restricting IP address or authentication."
                )
                return {
                    "success": False,
                    "profile_id": profile.id,
                    "bucket": profile.bucket,
                    "error_code": error_code,
                    "message": advice
                }

            return {
                "success": False,
                "profile_id": profile.id,
                "bucket": profile.bucket,
                "error_code": error_code,
                "message": f"S3 Connection Error [{error_code}]: {error_msg}"
            }
        except Exception as e:
            logger.exception(f"Unexpected exception during S3 connection test: {e}")
            return {
                "success": False,
                "profile_id": profile.id,
                "bucket": profile.bucket,
                "message": f"Connection failed: {str(e)}"
            }

    def browse_folder(self, profile_id: str, prefix: str = "", max_items: int = 1000) -> S3BrowseResponse:
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
        has_more = False

        for page in page_iterator:
            for common_prefix in page.get('CommonPrefixes', []):
                folder_path = common_prefix.get('Prefix', '')
                folder_name = folder_path[len(clean_prefix):].rstrip('/')
                if folder_name and folder_name not in subfolders:
                    subfolders.append(folder_name)
                if len(subfolders) >= max_items:
                    has_more = True
                    break

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
                if len(files) >= max_items:
                    has_more = True
                    break

            if has_more:
                break

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
            is_partitioned=is_partitioned,
            has_more=has_more
        )

s3_manager = S3ProfilesManager()
