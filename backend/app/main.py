import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

from backend.app.config import settings
from backend.app.api.datasets import router as datasets_router
from backend.app.api.query import router as query_router
from backend.app.api.engines import router as engines_router
from backend.app.api.benchmarks import router as benchmarks_router
from backend.app.api.telemetry import router as telemetry_router

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

# Register API Routers
app.include_router(datasets_router)
app.include_router(query_router)
app.include_router(engines_router)
app.include_router(benchmarks_router)
app.include_router(telemetry_router)

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "threads": settings.DUCKDB_THREADS
    }

# Mount frontend if built
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
