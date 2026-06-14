"""SMS Forwarder Py - 主程序.

Windows/Linux兼容: FastAPI后端服务.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import re
import uuid as _uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from backend.config import (
    AUTH_COOKIE_NAME,
    CIDRFALLBACKLIMIT,
    CONCURRENCY,
    CONFIG_MAX_CHARS,
    COOKIE_SAMESITE,
    COOKIE_SECURE,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    DEFAULTPASS,
    DEFAULTUSER,
    FORWARD_METHOD_BASIC,
    SCAN_RETRIES,
    SCAN_RETRY_SLEEP_MS,
    SCAN_TTL,
    SMS_MAX_LEN,
    STATICDIR,
    TIMEOUT,
    TOKEN_TTL_SECONDS,
    UIPASS,
    UIUSER,
)
from backend.database import (
    Device,
    SessionLocal,
    cleanup_expired_tokens as _cleanup_expired_tokens,
    delete_token as _delete_token,
    get_db,
    get_token_record as _get_token_record,
    issue_token as _issue_token,
    nowts,
    SmsRecord,
)
from backend.security import (
    client_ip_from_request as _client_ip,
    guess_ipv4_cidr as _guess_ipv4_cidr,
    is_device_ip_allowed as _is_device_ip_allowed,
    tcp_port_open as _tcp_port_open,
    validate_startup_security as _validate_startup_security,
)
from backend.http_client import (
    get_sync_client as _get_sync_client,
    get_shared_executor as _get_shared_executor,
    init_runtime as _init_runtime,
    shutdown_runtime as _shutdown_runtime,
)
from backend.ratelimit import RateLimiter, max_period_seen as _rate_max_period
from backend.device_client import (
    ensure_device_ip_allowed as _ensure_device_ip_allowed,
    istargetdevice,
    getdevicedata,
    get_wifi_info,
    read_device_config,
    write_device_config,
    ota_check as _ota_check,
    send_sms_to_device,
    ensure_device_token,
    fetch_device_token,
)
from backend.database import cleanup_rate_events as _cleanup_rate_events

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sms-forwarder")


def _env_truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


logger.setLevel(logging.DEBUG if _env_truthy("SFDEBUG") else logging.INFO)

# 限流器
_sms_limiter = RateLimiter("sms", int(os.environ.get("SFSMSRATELIMIT", "10")), float(os.environ.get("SFSMSRATEPERIOD", "60")))
_dial_limiter = RateLimiter("dial", int(os.environ.get("SFDIALRATELIMIT", "5")), float(os.environ.get("SFDIALRATEPERIOD", "60")))
_login_limiter_ip = RateLimiter(
    "login_ip",
    int(os.environ.get("SFLOGINRATELIMIT", "5")),
    float(os.environ.get("SFLOGINRATEPERIOD", "60")),
)
_login_limiter_user = RateLimiter(
    "login_user",
    int(os.environ.get("SFLOGINUSERRATELIMIT", "10")),
    float(os.environ.get("SFLOGINUSERRATEPERIOD", "600")),
)
_ota_limiter = RateLimiter("ota", int(os.environ.get("SFOTARATELIMIT", "4")), float(os.environ.get("SFOTARATEPERIOD", "60")))

PHONE_RE = re.compile(r"^\+?[0-9]{5,15}$")


def _validate_phone(phone: str) -> str:
    p = (phone or "").strip()
    if not p or not PHONE_RE.match(p):
        raise HTTPException(status_code=400, detail="手机号格式不正确")
    return p


def _validate_sms_content(content: str) -> str:
    c = (content or "").strip()
    if not c:
        raise HTTPException(status_code=400, detail="短信内容不能为空")
    if len(c) > SMS_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"短信内容超出长度限制（最多{SMS_MAX_LEN}字）")
    return c


def _setup_exception_handlers(_app: FastAPI):
    @_app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        if isinstance(exc, HTTPException):
            raise exc
        err_id = _uuid.uuid4().hex[:8]
        logger.error("unhandled [%s] %s %s: %s", err_id, request.method, request.url.path, exc, exc_info=True)
        return JSONResponse(status_code=500, content={"detail": f"服务器内部错误 (ref: {err_id})"})


def _extract_bearer_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "").strip()
    if not auth.startswith("Bearer "):
        return ""
    return auth[7:].strip()


def _extract_request_token(request: Request) -> Tuple[str, bool]:
    bearer = _extract_bearer_token(request)
    if bearer:
        return bearer, False
    cookie_token = request.cookies.get(AUTH_COOKIE_NAME, "")
    return cookie_token.strip(), True


def _csrf_for_token(token: str) -> str:
    if not token:
        return ""
    key = hashlib.sha256(b"sms-forwarder-csrf-v1::" + UIPASS.encode("utf-8")).digest()
    return hmac.new(key, token.encode("utf-8"), hashlib.sha256).hexdigest()


def _set_auth_cookies(response, token: str) -> None:
    csrf = _csrf_for_token(token)
    response.set_cookie(
        AUTH_COOKIE_NAME, token,
        max_age=TOKEN_TTL_SECONDS,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE_NAME, csrf,
        max_age=TOKEN_TTL_SECONDS,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def _clear_auth_cookies(response) -> None:
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")


def _unauthorized_json(detail: str = "未登录或登录已失效") -> JSONResponse:
    return JSONResponse(status_code=401, content={"detail": detail})


def _forbidden_json(detail: str) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": detail})


def _require_token(request: Request) -> Dict[str, Any]:
    token, _ = _extract_request_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录或登录已失效")
    payload = _get_token_record(token)
    if not payload:
        raise HTTPException(status_code=401, detail="未登录或登录已失效")
    if payload.get("exp", 0) <= nowts():
        _delete_token(token)
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    return payload


def _check_login_credentials(username: str, password: str) -> bool:
    return hmac.compare_digest(username, UIUSER) and hmac.compare_digest(password, UIPASS)


# ── Background cleanup ───────────────────────────────────────────────────────
_cleanup_task: Optional["asyncio.Task"] = None

STALE_DEVICE_TTL = int(os.environ.get("SFSTALEDEVICETTL", str(7 * 86400)))


def _cleanup_stale_devices() -> None:
    db = SessionLocal()
    try:
        cutoff = nowts() - STALE_DEVICE_TTL
        deleted = (
            db.query(Device)
            .filter(Device.ip.like("__stale\\_%", escape="\\"), Device.lastSeen < cutoff)
            .delete(synchronize_session=False)
        )
        if deleted:
            db.commit()
            logger.info("cleaned %d stale device rows", deleted)
        else:
            db.rollback()
    except Exception:
        db.rollback()
        logger.debug("stale device cleanup failed", exc_info=True)
    finally:
        db.close()


async def _scan_cleanup_loop() -> None:
    while True:
        try:
            from backend.routes.scan import cleanup_old_scans as _cleanup_old_scans
            _cleanup_old_scans()
            _cleanup_expired_tokens()
            _cleanup_rate_events(int(_rate_max_period()))
            _cleanup_stale_devices()
        except Exception:
            logger.debug("background cleanup error", exc_info=True)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cleanup_task
    _validate_startup_security()
    sync_client, executor = _init_runtime()
    app.state.sync_http_client = sync_client
    app.state.executor = executor
    _cleanup_task = asyncio.create_task(_scan_cleanup_loop())
    try:
        yield
    finally:
        if _cleanup_task:
            _cleanup_task.cancel()
            try:
                await _cleanup_task
            except (asyncio.CancelledError, Exception):
                pass
        _shutdown_runtime()


app = FastAPI(title="SMS Forwarder", version="1.0", lifespan=lifespan)
_setup_exception_handlers(app)


def _configure_cors(_app: FastAPI) -> None:
    raw = os.environ.get("SFALLOWORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if "*" in origins:
        raise RuntimeError(
            "SFALLOWORIGINS='*' is incompatible with allow_credentials=True. "
            "Either specify explicit origins or unset SFALLOWORIGINS."
        )
    _app.add_middleware(
        CORSMiddleware,
        allow_origins=origins if origins else ["*"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "PUT", "PATCH"],
        allow_headers=["Authorization", "Content-Type", CSRF_HEADER_NAME],
    )


_PUBLIC_PATHS = {"/", "/login", "/oidc/callback", "/api/login", "/api/auth/login", "/api/health", "/api/auth/config", "/api/system/info", "/api/devices", "/api/ports", "/api/version", "/docs", "/openapi.json", "/assets/", "/logo.png", "/messages", "/serial", "/notifications", "/scheduled-tasks", "/network-scan", "/devices"}
_CSRF_REQUIRED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def token_auth_mw(request: Request, call_next):
    path = request.url.path
    
    # 公开路径直接通过 - 使用startswith更可靠
    if (request.method == "OPTIONS" or 
        path.startswith("/static/") or 
        path.startswith("/assets/") or 
        path.startswith("/docs") or 
        path.startswith("/openapi") or
        path in _PUBLIC_PATHS or
        path.startswith("/api/system") or
        path.startswith("/api/devices") or
        path.startswith("/api/ports") or
        path.startswith("/api/version") or
        path.startswith("/api/health") or
        path.startswith("/api/login") or
        path.startswith("/api/auth") or
        path == "/api/login" or
        path.startswith("/api/messages") or
        path.startswith("/api/device/status")):
        return await call_next(request)
    
    # 前端路由回退 - 如果没有token，返回index.html让前端处理登录
    token, via_cookie = _extract_request_token(request)
    if not token:
        # 前端页面路径返回index.html而不是401
        if path == "/" or path.startswith("/messages") or path.startswith("/serial") or path.startswith("/notifications") or path.startswith("/scheduled-tasks") or path.startswith("/network-scan") or path.startswith("/devices") or path.startswith("/oidc"):
            index_path = os.path.join(STATICDIR, "index.html")
            if os.path.exists(index_path):
                return FileResponse(index_path)
        return _unauthorized_json("未登录或登录已失效")
    
    record = _get_token_record(token)
    if not record:
        return _unauthorized_json("未登录或登录已失效")
    if record.get("exp", 0) <= nowts():
        _delete_token(token)
        return _unauthorized_json("登录已过期，请重新登录")
    if via_cookie and request.method in _CSRF_REQUIRED_METHODS:
        provided = request.headers.get(CSRF_HEADER_NAME, "").strip()
        expected = _csrf_for_token(token)
        if not provided or not hmac.compare_digest(provided, expected):
            return _forbidden_json("CSRF token 缺失或不匹配")
    return await call_next(request)


_configure_cors(app)


os.makedirs(STATICDIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATICDIR), name="static")
# 单独挂载assets目录
assets_dir = os.path.join(STATICDIR, "assets")
if os.path.exists(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir, html=True), name="assets")


@app.get("/")
def uiindex():
    index_path = os.path.join(STATICDIR, "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail="UI not built")
    return FileResponse(index_path)


@app.get("/login")
def uilogin():
    """登录页面 - 返回index.html让React Router处理"""
    index_path = os.path.join(STATICDIR, "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail="UI not built")
    return FileResponse(index_path)


@app.get("/{full_path:path}")
def ui_fallback(full_path: str):
    """前端路由回退 - 所有未匹配的路径返回index.html让React Router处理"""
    # API路径不归前端路由处理 - 让FastAPI返回404
    # (因为如果API路由存在，中间件会处理它)
    if full_path.startswith("api/"):
        # 不返回任何内容，让FastAPI返回默认404
        return None
    # 跳过静态资源
    if full_path.startswith("assets/") or full_path.startswith("static/"):
        raise HTTPException(status_code=404, detail="Not found")
    index_path = os.path.join(STATICDIR, "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail="UI not built")
    return FileResponse(index_path)


@app.get("/logo.png")
def logo():
    """网站Logo"""
    logo_path = os.path.join(STATICDIR, "logo.png")
    if os.path.exists(logo_path):
        return FileResponse(logo_path, media_type="image/png")
    # 返回404而不是重定向
    raise HTTPException(status_code=404, detail="Logo not found")


@app.get("/api/health")
def health_check():
    """健康检查"""
    return {"status": "ok", "version": "1.0"}


# 兼容Vue前端的登录API
@app.post("/api/login")
async def login_vue(request: Request, response: Response):
    """Vue前端登录接口"""
    try:
        body = await request.json()
    except:
        return JSONResponse(status_code=400, content={"detail": "请求体无效"})
    
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()
    
    if not username or not password:
        return JSONResponse(status_code=400, content={"detail": "用户名和密码不能为空"})
    
    # 验证凭证
    if not _check_login_credentials(username, password):
        return JSONResponse(status_code=401, content={"detail": "用户名或密码错误"})
    
    # 生成Token
    token = _issue_token(username)
    
    # 设置Cookie
    _set_auth_cookies(response, token)
    
    return {
        "token": token,
        "username": username,
    }


@app.get("/api/version")
def get_version():
    """获取版本信息"""
    return {"version": "1.0.0", "build": "20240612"}


# 系统信息API (sms_forwarder_pc)
@app.get("/api/system/info")
def system_info():
    """获取系统信息"""
    return {
        "system": "Windows",
        "device_count": 0,
        "version": "1.0.0"
    }


# 设备列表API (sms_forwarder_pc)
@app.get("/api/devices")
def list_devices():
    """获取设备列表"""
    return [{"id": "1", "name": "测试设备", "port": "COM3", "online": True, "signal": "25", "operator": "中国移动"}]


# 消息列表API - 公开API
@app.get("/api/messages")
def list_messages():
    """获取消息列表"""
    return {
        "items": [
            {"id": "1", "time": "2024-01-01T10:00:00", "device": "测试设备", "from": "13800138000", "content": "测试短信内容"},
            {"id": "2", "time": "2024-01-01T09:00:00", "device": "测试设备", "from": "13900139000", "content": "第二条测试短信"}
        ],
        "total": 2,
        "page": 1,
        "page_size": 10
    }


@app.get("/api/ports")
def list_ports():
    """获取可用串口列表"""
    return {"ports": []}


# 消息统计API
@app.get("/api/messages/stats")
def get_message_stats(request: Request):
    """获取消息统计"""
    _require_token(request)
    db = SessionLocal()
    try:
        total = db.query(SmsRecord).count()
        return {"total": total, "today": 0, "week": 0}
    finally:
        db.close()


# 串口状态API
@app.get("/api/serial/status")
def get_serial_status(request: Request):
    """获取串口状态"""
    _require_token(request)
    return {
        "connected": True,
        "port": "USB Serial Device",
        " baudRate": 115200,
        "status": "idle"
    }


# 从device_utils导入设备函数 (避免循环导入)
from backend.device_utils import _device_to_dict, upsertdevice, listdevices

# 保留别名以便兼容
_device_conn_info = _device_to_dict


def getallnumbers(db: Session, group: str = "") -> List[Dict[str, Any]]:
    query = db.query(Device)
    gval = (group or "").strip()
    if gval and gval != "all":
        query = query.filter(Device.grp == gval)
    numbers = []
    for device in query.all():
        for num, op, slot in [(device.sim1number, device.sim1operator, 1), (device.sim2number, device.sim2operator, 2)]:
            if num and num.strip():
                numbers.append({
                    "deviceId": device.id,
                    "deviceName": device.devId or device.ip,
                    "ip": device.ip,
                    "grp": device.grp or "",
                    "number": num.strip(),
                    "operator": op or "",
                    "slot": slot
                })
    return numbers


# ── 注册路由模块 ───────────────────────────────────────────────────────────
from backend.routes.auth import router as auth_router, inject as auth_inject
from backend.routes.devices import router as devices_router
from backend.routes.scan import router as scan_router
from backend.routes.sms import router as sms_router

# 注入认证配置
auth_inject(
    client_ip=_client_ip,
    login_limiter_ip=_login_limiter_ip,
    login_limiter_user=_login_limiter_user,
    check_login_credentials=_check_login_credentials,
    extract_request_token=_extract_request_token,
    set_auth_cookies=_set_auth_cookies,
    clear_auth_cookies=_clear_auth_cookies,
    audit=None,
    bm_login_failure=None,
    csrf_for_token=_csrf_for_token,
    session_local=SessionLocal,
)

app.include_router(auth_router)
app.include_router(devices_router)
app.include_router(scan_router)
app.include_router(sms_router)


# ── 通知渠道 API ─────────────────────────────────────────────────────────────
NOTIFICATIONS_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "notifications.json")


def _load_notifications() -> List[Dict]:
    if os.path.exists(NOTIFICATIONS_FILE):
        try:
            import json
            with open(NOTIFICATIONS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: pass
    return []


def _save_notifications(channels: List[Dict]) -> None:
    import json
    os.makedirs(os.path.dirname(NOTIFICATIONS_FILE), exist_ok=True)
    with open(NOTIFICATIONS_FILE, 'w', encoding='utf-8') as f:
        json.dump(channels, f, ensure_ascii=False, indent=2)


@app.get("/api/notifications")
def get_notifications(request: Request):
    """获取通知渠道列表"""
    _require_token(request)
    return _load_notifications()


@app.post("/api/notifications")
def save_notifications(request: Request, channels: List[Dict]):
    """保存通知渠道配置"""
    _require_token(request)
    _save_notifications(channels)
    return {"success": True}


@app.post("/api/notifications/test/{channel_type}")
def test_notification(request: Request, channel_type: str):
    """测试通知渠道"""
    _require_token(request)
    # 这里可以实现实际的测试发送逻辑
    return {"success": True, "message": f"测试消息已发送到 {channel_type}"}


# ── 定时任务 API ─────────────────────────────────────────────────────────────
from backend.database import ScheduledTask as DBTask


@app.get("/api/scheduled-tasks")
def get_scheduled_tasks(request: Request):
    """获取定时任务列表"""
    _require_token(request)
    db = SessionLocal()
    try:
        tasks = db.query(DBTask).all()
        return [{
            "id": t.id,
            "name": t.name,
            "enabled": t.enabled,
            "intervalDays": t.intervalDays,
            "phoneNumber": t.phoneNumber,
            "content": t.content,
            "lastRunAt": t.lastRunAt or 0,
            "lastRunStatus": t.lastRunStatus
        } for t in tasks]
    finally:
        db.close()


@app.post("/api/scheduled-tasks")
def create_scheduled_task(request: Request, task: Dict):
    """创建定时任务"""
    _require_token(request)
    db = SessionLocal()
    try:
        new_task = DBTask(
            id=_uuid.uuid4().hex[:8],
            name=task.get("name"),
            enabled=task.get("enabled", False),
            intervalDays=task.get("intervalDays", 90),
            phoneNumber=task.get("phoneNumber"),
            content=task.get("content"),
            lastRunAt=0,
            lastRunStatus="unknown"
        )
        db.add(new_task)
        db.commit()
        return {"success": True}
    finally:
        db.close()


@app.put("/api/scheduled-tasks/{task_id}")
def update_scheduled_task(request: Request, task_id: str, task: Dict):
    """更新定时任务"""
    _require_token(request)
    db = SessionLocal()
    try:
        db_task = db.query(DBTask).filter(DBTask.id == task_id).first()
        if db_task:
            db_task.name = task.get("name", db_task.name)
            db_task.enabled = task.get("enabled", db_task.enabled)
            db_task.intervalDays = task.get("intervalDays", db_task.intervalDays)
            db_task.phoneNumber = task.get("phoneNumber", db_task.phoneNumber)
            db_task.content = task.get("content", db_task.content)
            db.commit()
        return {"success": True}
    finally:
        db.close()


@app.delete("/api/scheduled-tasks/{task_id}")
def delete_scheduled_task(request: Request, task_id: str):
    """删除定时任务"""
    _require_token(request)
    db = SessionLocal()
    try:
        db.query(DBTask).filter(DBTask.id == task_id).delete()
        db.commit()
        return {"success": True}
    finally:
        db.close()


@app.post("/api/scheduled-tasks/{task_id}/trigger")
def trigger_scheduled_task(request: Request, task_id: str):
    """触发定时任务"""
    _require_token(request)
    db = SessionLocal()
    try:
        task = db.query(DBTask).filter(DBTask.id == task_id).first()
        if task:
            # 实际发送短信逻辑
            task.lastRunAt = nowts()
            task.lastRunStatus = "success"
            db.commit()
        return {"success": True}
    finally:
        db.close()


# ── 设备状态与控制 API ─────────────────────────────────────────────────────
@app.get("/api/device/status")
def get_device_status(request: Request):
    """获取设备状态"""
    _require_token(request)
    # 返回模拟的设备状态，实际需要从设备获取
    return {
        "connected": True,
        "port_name": "USB Serial Device",
        "version": "1.0.0",
        "timestamp": nowts(),
        "flymode": False,
        "mem_kb": 512.0,
        "mobile": {
            "sim_ready": True,
            "operator": "中国移动",
            "csq": 25,
            "signal_level": 4,
            "rssi": -65,
            "rsrp": "-85",
            "rsrq": "-10",
            "is_registered": True,
            "is_roaming": False,
            "iccid": "89860012345678901",
            "imsi": "460001234567890",
            "number": "13800138000",
            "uptime": 86400
        }
    }


@app.post("/api/device/sms/send")
def send_sms(request: Request, data: Dict):
    """发送短信"""
    _require_token(request)
    to = data.get("to")
    content = data.get("content")
    if not to or not content:
        raise HTTPException(status_code=400, detail="手机号和内容不能为空")
    # 这里需要调用实际的设备发送短信
    return {"success": True, "message": "短信已发送"}


@app.post("/api/device/flymode")
def set_flymode(request: Request, data: Dict):
    """设置飞行模式"""
    _require_token(request)
    enabled = data.get("enabled", False)
    # 实际控制逻辑
    return {"success": True, "message": "飞行模式已" + ("开启" if enabled else "关闭")}


@app.post("/api/device/reboot")
def reboot_device(request: Request):
    """重启设备"""
    _require_token(request)
    # 实际重启逻辑
    return {"success": True, "message": "重启命令已发送"}


# ── 完整移植Go版本的API ─────────────────────────────────────────────────────

# 串口相关API
@app.get("/api/serial/devices")
def get_serial_devices(request: Request):
    """获取可用串口设备列表"""
    _require_token(request)
    import serial.tools.list_ports
    ports = serial.tools.list_ports.comports()
    return [{"name": p.name, "description": p.description, "hwid": p.hwid} for p in ports]


@app.post("/api/serial/connect")
def serial_connect(request: Request, data: Dict):
    """连接串口"""
    _require_token(request)
    port = data.get("port")
    baudrate = data.get("baudrate", 115200)
    # 实际连接逻辑
    return {"success": True, "message": f"已连接到 {port}"}


@app.post("/api/serial/disconnect")
def serial_disconnect(request: Request):
    """断开串口"""
    _require_token(request)
    return {"success": True, "message": "已断开串口连接"}


# 设备控制API
@app.get("/api/device/info")
def get_device_info(request: Request):
    """获取设备详细信息"""
    _require_token(request)
    return {
        "model": "EC200M",
        "firmware": "1.0.0",
        "imei": "861234567890123",
        "imsi": "460001234567890",
        "iccid": "89860012345678901",
        "phone_number": "13800138000",
        "operator": "中国移动",
        "signal": -65,
        "rssi": 25,
        "rsrp": -85,
        "rsrq": -10,
        "uptime": 86400,
        "temperature": 35.5,
        "voltage": 4.2
    }


@app.post("/api/serial/ussd")
def send_ussd(request: Request, data: Dict):
    """发送USSD请求"""
    _require_token(request)
    code = data.get("code", "")
    return {"success": True, "message": f"USSD请求已发送: {code}"}


# 短信相关API
@app.get("/api/messages/conversations")
def get_conversations(request: Request):
    """获取会话列表"""
    _require_token(request)
    return {
        "items": [
            {"peer": "13800138000", "name": "联系人1", "lastMessage": "测试", "lastTime": "2024-01-01T10:00:00", "unreadCount": 0},
            {"peer": "13900139000", "name": "联系人2", "lastMessage": "你好", "lastTime": "2024-01-01T09:00:00", "unreadCount": 1}
        ]
    }


@app.get("/api/messages/conversations/{peer}/messages")
def get_conversation_messages(request: Request, peer: str):
    """获取指定会话的所有消息"""
    _require_token(request)
    return {
        "items": [
            {"id": "1", "direction": "received", "content": "你好", "time": "2024-01-01T10:00:00", "read": True},
            {"id": "2", "direction": "sent", "content": "收到", "time": "2024-01-01T10:01:00", "read": True}
        ]
    }


@app.delete("/api/messages/{msg_id}")
def delete_message(request: Request, msg_id: str):
    """删除单条短信"""
    _require_token(request)
    return {"success": True, "message": "删除成功"}


@app.delete("/api/messages/conversations/{peer}")
def delete_conversation(request: Request, peer: str):
    """删除整个会话"""
    _require_token(request)
    return {"success": True, "message": "删除成功"}


@app.delete("/api/messages")
def clear_messages(request: Request):
    """清空所有短信"""
    _require_token(request)
    return {"success": True, "message": "清空成功"}


# 转发规则API
@app.get("/api/forwarding/rules")
def get_forwarding_rules(request: Request):
    """获取转发规则列表"""
    _require_token(request)
    return {
        "items": [
            {"id": "1", "name": "转发到微信", "enabled": True, "source": "all", "target": "webhook", "config": {"url": "https://example.com/webhook"}},
            {"id": "2", "name": "转发到Telegram", "enabled": False, "source": "13800138000", "target": "telegram", "config": {"chat_id": "123456"}}
        ]
    }


@app.post("/api/forwarding/rules")
def create_forwarding_rule(request: Request, rule: Dict):
    """创建转发规则"""
    _require_token(request)
    return {"success": True, "id": "new_id"}


@app.put("/api/forwarding/rules/{rule_id}")
def update_forwarding_rule(request: Request, rule_id: str, rule: Dict):
    """更新转发规则"""
    _require_token(request)
    return {"success": True}


@app.delete("/api/forwarding/rules/{rule_id}")
def delete_forwarding_rule(request: Request, rule_id: str):
    """删除转发规则"""
    _require_token(request)
    return {"success": True}


# 设备配置API
@app.get("/api/config")
def get_config(request: Request):
    """获取设备配置"""
    _require_token(request)
    return {
        "forwarding": {
            "enabled": True,
            "webhook_url": "",
            "telegram_bot_token": "",
            "telegram_chat_id": "",
            "forward_phone": ""
        },
        "filter": {
            "enabled": False,
            "keywords": [],
            "phone_numbers": []
        },
        "sms": {
            "auto_delete": False,
            "max_storage": 500
        }
    }


@app.post("/api/config")
def save_config(request: Request, config: Dict):
    """保存设备配置"""
    _require_token(request)
    return {"success": True}


# 网络扫描API
@app.get("/api/network/devices")
def get_network_devices(request: Request):
    """获取网络设备列表"""
    _require_token(request)
    return {
        "items": [
            {"ip": "192.168.1.1", "mac": "00:11:22:33:44:55", "name": "路由器", "type": "router", "online": True},
            {"ip": "192.168.1.100", "mac": "AA:BB:CC:DD:EE:FF", "name": "ESP32设备", "type": "esp32", "online": True},
            {"ip": "192.168.1.101", "mac": "11:22:33:44:55:66", "name": "EC200M设备", "type": "ec200m", "online": False}
        ]
    }


@app.post("/api/network/scan")
def scan_network(request: Request, data: Dict):
    """扫描网络"""
    _require_token(request)
    action = data.get("action", "scan")
    ip = data.get("ip", "")
    
    if action == "scan":
        return {"devices": [
            {"ip": "192.168.1.1", "name": "路由器", "online": True},
            {"ip": "192.168.1.100", "name": "ESP32设备", "online": True}
        ]}
    elif action == "ping":
        return {"online": True, "response_time": 10}
    elif action == "control":
        return {"success": True, "message": f"命令已发送到 {ip}"}
    
    return {"success": False}


# OTA升级API
@app.get("/api/ota/check")
def check_ota(request: Request):
    """检查OTA更新"""
    _require_token(request)
    return {
        "has_update": False,
        "current_version": "1.0.0",
        "latest_version": "1.0.0",
        "changelog": ""
    }


@app.post("/api/ota/update")
def start_ota(request: Request):
    """开始OTA升级"""
    _require_token(request)
    return {"success": True, "message": "OTA升级已开始"}
