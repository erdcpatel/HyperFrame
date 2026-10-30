import pytest
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.s3_manager import S3ProfilesManager, S3BucketProfile, mask_key

client = TestClient(app)

def test_mask_key():
    assert mask_key("short") == "••••••••"
    assert mask_key("AKIAIOSFODNN7EXAMPLE") == "AKIA••••••••MPLE"
    assert mask_key("") == "AWS IAM / Default Credential Chain"
    assert mask_key("IAM_ROLE") == "AWS IAM / Default Credential Chain"

def test_s3_profile_crud(tmp_path):
    storage = tmp_path / "test_s3_profiles.json"
    mgr = S3ProfilesManager(storage_path=storage)

    # 1. Initially empty
    assert len(mgr.list_profiles()) == 0

    # 2. Save profile
    profile = S3BucketProfile(
        id="prod_lakehouse",
        name="Production S3 Lakehouse",
        bucket="my-lakehouse-bucket",
        region="us-west-2",
        access_key_id="AKIA1234567890EXAMPLE",
        secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    )
    public_res = mgr.save_profile(profile)
    assert public_res.id == "prod_lakehouse"
    assert "AKIA" in public_res.access_key_masked
    assert "MPLE" in public_res.access_key_masked
    assert "wJalr" not in public_res.access_key_masked

    # 3. Get profile
    retrieved = mgr.get_profile("prod_lakehouse")
    assert retrieved is not None
    assert retrieved.secret_access_key == "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

    # 4. List profiles
    profs = mgr.list_profiles()
    assert len(profs) == 1
    assert profs[0].bucket == "my-lakehouse-bucket"

    # 5. Delete profile
    deleted = mgr.delete_profile("prod_lakehouse")
    assert deleted is True
    assert mgr.get_profile("prod_lakehouse") is None
    assert len(mgr.list_profiles()) == 0

def test_s3_test_connection_mock(tmp_path):
    storage = tmp_path / "test_s3_profiles.json"
    mgr = S3ProfilesManager(storage_path=storage)

    profile = S3BucketProfile(
        id="test_conn",
        name="Test Bucket",
        bucket="test-bucket",
        region="us-east-1",
        access_key_id="AKIA1111111111111111",
        secret_access_key="secretkey123"
    )
    mgr.save_profile(profile)

    with patch.object(mgr, "get_boto_client") as mock_get_client:
        mock_boto = MagicMock()
        mock_get_client.return_value = mock_boto

        # Success case
        mock_boto.head_bucket.return_value = {}
        res = mgr.test_connection("test_conn")
        assert res["success"] is True
        assert res["bucket"] == "test-bucket"
        assert res["latency_ms"] >= 0

        # Failure case with ClientError
        mock_boto.head_bucket.side_effect = ClientError(
            {"Error": {"Code": "403", "Message": "Forbidden Access"}},
            "HeadBucket"
        )
        res_fail = mgr.test_connection("test_conn")
        assert res_fail["success"] is False
        assert res_fail["error_code"] == "403"
        assert "Forbidden Access" in res_fail["message"]

def test_s3_browse_folder_mock(tmp_path):
    storage = tmp_path / "test_s3_profiles.json"
    mgr = S3ProfilesManager(storage_path=storage)

    profile = S3BucketProfile(
        id="browse_test",
        name="Browse Bucket",
        bucket="data-lake",
        region="us-east-1",
        access_key_id="AKIA2222222222222222",
        secret_access_key="secretkey456"
    )
    mgr.save_profile(profile)

    with patch.object(mgr, "get_boto_client") as mock_get_client:
        mock_boto = MagicMock()
        mock_get_client.return_value = mock_boto

        mock_paginator = MagicMock()
        mock_boto.get_paginator.return_value = mock_paginator

        mock_paginator.paginate.return_value = [
            {
                "CommonPrefixes": [
                    {"Prefix": "market_data/year=2026/"},
                    {"Prefix": "market_data/raw/"}
                ],
                "Contents": [
                    {"Key": "market_data/part-0001.parquet", "Size": 1024 * 1024 * 12},
                    {"Key": "market_data/part-0002.parquet", "Size": 1024 * 1024 * 15},
                    {"Key": "market_data/notes.txt", "Size": 512}
                ]
            }
        ]

        browse_res = mgr.browse_folder("browse_test", prefix="market_data")
        assert browse_res.bucket == "data-lake"
        assert browse_res.prefix == "market_data/"
        assert len(browse_res.subfolders) == 2
        assert "year=2026" in browse_res.subfolders
        assert "raw" in browse_res.subfolders
        assert browse_res.is_partitioned is True  # Detected year=2026
        assert len(browse_res.files) == 3
        assert browse_res.total_files_in_folder == 3
        assert browse_res.files[0].is_parquet is True
        assert browse_res.files[2].is_parquet is False

def test_s3_api_endpoints():
    # 1. Fetch profiles endpoint
    response = client.get("/api/s3/profiles")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)

    # 2. Browse with non-existent profile returns 404
    resp_browse = client.get("/api/s3/browse?profile_id=non_existent_profile")
    assert resp_browse.status_code == 404
