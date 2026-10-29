#!/usr/bin/env python3
"""
HyperFrame Test Data Cleaner
Removes all generated test files, synthetic sample datasets, and resets catalog.json.
"""
import sys
from pathlib import Path

root_dir = Path(__file__).resolve().parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from backend.app.core.catalog import catalog

if __name__ == "__main__":
    print("=" * 60)
    print("  HYPERFRAME: Cleaning Test & Synthetic Datasets")
    print("=" * 60)
    removed = catalog.clean_test_datasets()
    if removed:
        print(f"Removed {len(removed)} test dataset(s):")
        for name in removed:
            print(f"  - {name}")
    else:
        print("No test datasets found. Workspace is already clean.")
    
    # Auto-scan any remaining real files
    scanned = catalog.scan_data_directory()
    if scanned:
        print(f"\nAuto-registered {len(scanned)} real dataset(s):")
        for s in scanned:
            print(f"  + {s.dataset_id} ({s.file_size_formatted}, {s.row_count:,} rows)")

    print("=" * 60)
    print("Done! Only real datasets remain in backend/data/.")
