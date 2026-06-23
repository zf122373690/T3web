from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import STATIC_DIR
from .db import init_db
from .routers.auth import router as auth_router
from .routers.devices import router as devices_router
from .routers.messages import router as messages_router
from .routers.scan import router as scan_router
from .routers.serial import router as serial_router
from .routers.system import router as system_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("t3web")

app = FastAPI(title="T3 SMS Forwarder", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

app.include_router(auth_router)
app.include_router(devices_router)
app.include_router(messages_router)
app.include_router(scan_router)
app.include_router(serial_router)
app.include_router(system_router)

STATIC_DIR.mkdir(parents=True, exist_ok=True)
assets_dir = STATIC_DIR / "assets"
if assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


def index_file() -> Path:
    path = STATIC_DIR / "index.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="前端尚未构建")
    return path


@app.get("/")
def index() -> FileResponse:
    return FileResponse(index_file())


@app.get("/logo.png")
def logo() -> FileResponse:
    path = STATIC_DIR / "logo.png"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(path)


@app.get("/{path:path}")
def spa_fallback(path: str) -> FileResponse:
    if path.startswith("api/") or path.startswith("assets/"):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(index_file())
