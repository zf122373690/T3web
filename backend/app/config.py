from __future__ import annotations

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("T3_DATA_DIR", ROOT_DIR / "data"))
STATIC_DIR = Path(os.environ.get("T3_STATIC_DIR", ROOT_DIR / "backend" / "static"))
DB_PATH = Path(os.environ.get("T3_DB", DATA_DIR / "app.db"))

UI_USER = os.environ.get("T3_UI_USER", "admin")
UI_PASS = os.environ.get("T3_UI_PASS", "admin")
TOKEN_TTL_SECONDS = int(os.environ.get("T3_TOKEN_TTL", str(7 * 24 * 60 * 60)))

DEVICE_USER = os.environ.get("T3_DEVICE_USER", "admin")
DEVICE_PASS = os.environ.get("T3_DEVICE_PASS", "admin")
LAN_DEVICE_KEY = os.environ.get("T3_LAN_DEVICE_KEY", "T3-C3-LAN-KEY-2026")
MESSAGE_INGEST_TOKEN = os.environ.get("T3_MESSAGE_INGEST_TOKEN", LAN_DEVICE_KEY)
HTTP_TIMEOUT = float(os.environ.get("T3_HTTP_TIMEOUT", "4.0"))
OTA_VERSION_URL = os.environ.get("T3_OTA_VERSION_URL", "").strip()
LOCAL_TOOL_VERSION = os.environ.get("T3_LOCAL_VERSION", "1.1.0")
SCAN_CONCURRENCY = int(os.environ.get("T3_SCAN_CONCURRENCY", "64"))
SCAN_TTL_SECONDS = int(os.environ.get("T3_SCAN_TTL", "1800"))

MESSAGE_AUTO_SYNC_ENABLED = os.environ.get("T3_MESSAGE_AUTO_SYNC", "1").strip().lower() not in {"0", "false", "no", "off"}
MESSAGE_AUTO_SYNC_INTERVAL = 10
