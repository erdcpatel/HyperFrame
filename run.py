"""
HyperFrame Launcher Script (Cross-Platform Windows / macOS / Linux)
"""
import sys
import uvicorn
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

if __name__ == "__main__":
    print("===================================================================")
    print("  HYPERFRAME: High-Performance Ad-Hoc Analytics Studio (v1.0.0)")
    print("===================================================================")
    print("Starting FastAPI backend on http://127.0.0.1:8000")
    print("API Documentation available at: http://127.0.0.1:8000/docs")
    print("===================================================================")
    
    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        workers=1
    )
