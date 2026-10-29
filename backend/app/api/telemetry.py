import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.app.core.telemetry import telemetry_monitor
from backend.app.core.lifecycle import lifecycle_manager

router = APIRouter(tags=["Telemetry & Streaming"])

@router.get("/api/telemetry/snapshot")
def get_telemetry_snapshot():
    return telemetry_monitor.get_system_snapshot(
        active_engine=lifecycle_manager.active_engine_name,
        active_dataset=lifecycle_manager.active_dataset_id
    )

@router.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            snapshot = telemetry_monitor.get_system_snapshot(
                active_engine=lifecycle_manager.active_engine_name,
                active_dataset=lifecycle_manager.active_dataset_id
            )
            await websocket.send_text(snapshot.model_dump_json())
            await asyncio.sleep(0.5)
    except Exception:
        # Client disconnect or connection reset (clean exit)
        pass

@router.websocket("/ws/perspective")
async def websocket_perspective_endpoint(websocket: WebSocket):
    # Mount Perspective WebSocket handler
    from backend.app.engines.perspective_engine import PerspectiveEngine
    psp_engine: PerspectiveEngine = lifecycle_manager.get_engine("perspective")  # type: ignore
    handler = psp_engine.get_websocket_handler(websocket)
    await handler.run()
