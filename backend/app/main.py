import os
import time
import logging
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

# Configure structured, visible logging across the backend
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("hyperframe")
logger.setLevel(logging.INFO)

from backend.app.config import settings
from backend.app.api.datasets import router as datasets_router
from backend.app.api.query import router as query_router
from backend.app.api.engines import router as engines_router
from backend.app.api.benchmarks import router as benchmarks_router
from backend.app.api.telemetry import router as telemetry_router
from backend.app.api.s3 import router as s3_router

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Cross-platform high-performance ad-hoc analytics benchmarking engine."
)

# Cross-Origin Resource Sharing
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-HyperFrame-Compile-Ms",
        "X-HyperFrame-Exec-Ms",
        "X-HyperFrame-Serialize-Ms",
        "X-HyperFrame-Total-Ms",
        "X-HyperFrame-Total-Rows",
        "X-HyperFrame-Returned-Rows",
        "X-HyperFrame-Query"
    ]
)

# Add Cross-Origin Isolation headers for high-resolution performance timers & WebAssembly OPFS
@app.middleware("http")
async def add_security_and_isolation_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "credentialless"
    return response

# Detailed HTTP Request & Error Logger Middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    path = request.url.path
    # Skip noisy WebSocket / telemetry polling
    if path == "/api/telemetry" or path.startswith("/static"):
        return await call_next(request)

    t0 = time.time()
    method = request.method
    logger.info(f"==> [{method}] {path}")
    try:
        response = await call_next(request)
        duration_ms = (time.time() - t0) * 1000
        logger.info(f"<== [{method}] {path} -> {response.status_code} ({duration_ms:.1f}ms)")
        return response
    except Exception as e:
        duration_ms = (time.time() - t0) * 1000
        logger.error(f"<== [{method}] {path} -> FAILED ({duration_ms:.1f}ms): {e}")
        raise

# Register API Routers
app.include_router(datasets_router)
app.include_router(query_router)
app.include_router(engines_router)
app.include_router(benchmarks_router)
app.include_router(telemetry_router)
app.include_router(s3_router)

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "threads": settings.DUCKDB_THREADS
    }

# Mount frontend if built, or serve a helpful guidance page if not built yet
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
else:
    from fastapi.responses import HTMLResponse

    @app.get("/", response_class=HTMLResponse)
    def frontend_status():
        return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HyperFrame Server Running</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c101a; color: #e2e8f0; margin: 0; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 100vh; box-sizing: border-box; }
    .card { background: #131b2e; border: 1px solid #24324f; border-radius: 12px; max-width: 650px; width: 100%; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #60a5fa; margin-top: 0; font-size: 22px; display: flex; align-items: center; gap: 10px; }
    .badge { background: #1e3a8a; color: #93c5fd; font-size: 11px; padding: 3px 8px; border-radius: 6px; font-weight: 600; text-transform: uppercase; }
    p { font-size: 13.5px; line-height: 1.6; color: #94a3b8; }
    .code-box { background: #0a0d16; border: 1px solid #1f2b45; border-radius: 8px; padding: 12px 16px; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; color: #38bdf8; margin: 10px 0; }
    .btn { display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-right: 10px; transition: background 0.2s; }
    .btn:hover { background: #1d4ed8; }
    .btn-outline { background: transparent; border: 1px solid #3b82f6; color: #60a5fa; }
    .btn-outline:hover { background: #1e293b; }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ HyperFrame Backend <span class="badge">Running</span></h1>
    <p>The FastAPI analytical server is active on <strong>port 8000</strong>.</p>
    
    <p><strong>To launch the UI workbench:</strong></p>
    
    <p><strong>Option 1: Development Server (Recommended)</strong><br>
    In a separate terminal window, start Vite:</p>
    <div class="code-box">cd frontend<br>npm install<br>npm run dev</div>
    <p>Then open <a href="http://localhost:5173" target="_blank">http://localhost:5173</a> in your browser.</p>

    <p><strong>Option 2: Standalone Production Build</strong><br>
    Compile the frontend assets into <code>frontend/dist</code>:</p>
    <div class="code-box">cd frontend<br>npm install<br>npm run build</div>
    <p>Then restart the server or refresh this page at <strong>http://localhost:8000</strong>.</p>

    <div style="margin-top: 24px;">
      <a href="/docs" class="btn">Open Swagger API Docs</a>
      <a href="/api/health" class="btn btn-outline">System Health Check</a>
    </div>
  </div>
</body>
</html>"""
