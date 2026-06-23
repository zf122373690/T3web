from __future__ import annotations

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("T3_DATA_DIR", ROOT_DIR / "data"))
STATIC_DIR = Path(os.environ.get("T3_STATIC_DIR", ROOT_DIR / "backend" / "static"))
DB_PATH = Path(os.environ.get("T3_DB", DATA_DIR / "app.db"))

UI_USER = os.environ.get("T3_UI_USER", "admin")
UI_PASS = os.environ.get("T3_UI_PASS", "admin123")
TOKEN_TTL_SECONDS = int(os.environ.get("T3_TOKEN_TTL", str(7 * 24 * 60 * 60)))

DEVICE_USER = os.environ.get("T3_DEVICE_USER", "admin")
DEVICE_PASS = os.environ.get("T3_DEVICE_PASS", "admin")
LAN_DEVICE_KEY = os.environ.get("T3_LAN_DEVICE_KEY", "T3-C3-LAN-KEY-2026")
MESSAGE_INGEST_TOKEN = os.environ.get("T3_MESSAGE_INGEST_TOKEN", LAN_DEVICE_KEY)
PUBLIC_BASE_URL = os.environ.get("T3_PUBLIC_BASE_URL", "").strip().rstrip("/")
WEB_PORT = int(os.environ.get("T3_WEB_PORT", "8080"))

HTTP_TIMEOUT = float(os.environ.get("T3_HTTP_TIMEOUT", "4.0"))
SCAN_CONCURRENCY = int(os.environ.get("T3_SCAN_CONCURRENCY", "64"))
SCAN_TTL_SECONDS = int(os.environ.get("T3_SCAN_TTL", "1800"))
