"""Process-wide configuration loaded from environment variables.

Windows/Linux兼容: 默认根据操作系统选择路径.
"""

from __future__ import annotations

import os
import platform


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


# Detect Windows platform
_IS_WINDOWS = platform.system().lower() == "windows"

# Default paths based on OS - 使用相对路径便于Portable运行
if _IS_WINDOWS:
    # static在backend目录下
    _DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    _DEFAULT_DB = os.path.join(_DEFAULT_DATA_DIR, "data.db")
    _DEFAULT_STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
else:
    _DEFAULT_DB = "/opt/sms-forwarder/data/data.db"
    _DEFAULT_STATIC = "/opt/sms-forwarder/static"

# ── Storage locations ────────────────────────────────────────────────────────
DBPATH    = os.environ.get("SFDB",     _DEFAULT_DB)
STATICDIR = os.environ.get("SFSTATIC", _DEFAULT_STATIC)

# ── Auth / login ─────────────────────────────────────────────────────────────
DEFAULTUSER       = "admin"
DEFAULTPASS       = "admin"
UIUSER            = os.environ.get("SFUIUSER", "admin")
UIPASS            = os.environ.get("SFUIPASS", "admin123")
TOKEN_TTL_SECONDS = int(os.environ.get("SFTOKENTTL", str(2 * 60 * 60)))

# Cookie / CSRF config
AUTH_COOKIE_NAME = os.environ.get("SFAUTHCOOKIE", "sms_forwarder_auth")
CSRF_COOKIE_NAME = os.environ.get("SFCSRFCOOKIE", "sms_forwarder_csrf")
CSRF_HEADER_NAME = "X-CSRF-Token"
COOKIE_SECURE = _env_truthy("SFCOOKIESECURE")
COOKIE_SAMESITE = (os.environ.get("SFCOOKIESAMESITE", "lax") or "lax").strip().lower()
if COOKIE_SAMESITE not in ("lax", "strict", "none"):
    COOKIE_SAMESITE = "lax"

# ── Networking / scan ────────────────────────────────────────────────────────
TIMEOUT             = float(os.environ.get("SFHTTPTIMEOUT",     "5.0"))
CONCURRENCY         = int(os.environ.get("SFSCANCONCURRENCY",   "64"))
TCP_CONCURRENCY     = int(os.environ.get("SFTCPCONCURRENCY",    "128"))
TCP_TIMEOUT         = float(os.environ.get("SFTCPTIMEOUT",      "0.3"))
CIDRFALLBACKLIMIT   = int(os.environ.get("SFCIDRFALLBACKLIMIT", "1024"))
SCAN_RETRIES        = int(os.environ.get("SFSCANRETRIES",       "3"))
SCAN_RETRY_SLEEP_MS = int(os.environ.get("SFSCANRETRYSLEEPMS",  "300"))
SCAN_TTL            = int(os.environ.get("SFSCANTTL",           str(3600)))
PREWARM_CONCURRENCY = int(os.environ.get("SFPREWARMCONCURRENCY", "64"))
TRUSTED_PROXY_HOPS  = int(os.environ.get("SFTRUSTEDPROXYHOPS",  "0"))
LOCAL_NETS_CACHE_TTL = float(os.environ.get("SFLOCALNETSCACHETTL", "60"))

# ── Limits / budgets ─────────────────────────────────────────────────────────
BATCH_MAX        = int(os.environ.get("SFBATCHMAX",        "128"))
CONFIG_MAX_CHARS = int(os.environ.get("SFCONFIGMAXCHARS", "524288"))
SMS_MAX_LEN      = int(os.environ.get("SFSMSMAXLEN",      "500"))

# ── Misc constants ───────────────────────────────────────────────────────────
FORWARD_METHOD_BASIC = "99"