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
    frontend_dist = root_dir / "frontend" / "dist"
    print("===================================================================")
    print("  HYPERFRAME: High-Performance Ad-Hoc Analytics Studio (v1.0.0)")
    print("===================================================================")
    print("Backend API running at:       http://127.0.0.1:8000")
    print("API Documentation (Swagger):  http://127.0.0.1:8000/docs")
    if frontend_dist.exists():
        print("Frontend UI running at:       http://127.0.0.1:8000")
    else:
        print("-------------------------------------------------------------------")
        print("[NOTE] 'frontend/dist' not found. To access the UI workbench:")
        print("  Option A (Development): cd frontend && npm run dev -> http://localhost:5173")
        print("  Option B (Production):  cd frontend && npm run build -> http://localhost:8000")
    print("===================================================================")
    
    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        workers=1
    )
