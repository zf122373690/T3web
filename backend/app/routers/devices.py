from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request

from ..auth import require_user
from ..config import DEVICE_PASS, DEVICE_USER
from ..db import connect, now_ts
from ..device_client import (
    check_t3_ota,
    clear_device_messages,
    factory_reset_t3,
    get_device_data,
    get_t3_config,
    get_t3_status,
    lan_discover_device,
    reboot_device,
    send_sms_to_device,
    send_t3_at,
    set_device_flymode,
    set_t3_sim_number,
    set_t3_wifi,
    start_t3_ota,
    update_t3_config,
)

router = APIRouter(prefix="/api/devices", tags=["devices"])


def normalize_device(row) -> dict:
    raw = {}
    try:
        raw = json.loads(row["raw_json"] or "{}")
    except Exception:
        raw = {}
    raw_status = raw.get("raw") if isinstance(raw.get("raw"), dict) else {}
    modem = raw_status.get("modem") if isinstance(raw_status.get("modem"), dict) else {}
    wifi = raw_status.get("wifi") if isinstance(raw_status.get("wifi"), dict) else {}
    return {
        "id": row["id"],
        "ip": row["ip"],
        "mac": row["mac"] or raw.get("MAC", ""),
        "name": row["name"] or raw.get("DEV_ID", "") or row["ip"],
        "group": row["group_name"] or "auto",
        "status": row["status"] or "unknown",
        "lastSeen": row["last_seen"],
        "version": raw.get("DEV_VER", "") or raw.get("FW_VER", "") or raw.get("VERSION", ""),
        "sim1": {"number": raw.get("SIM1_PHNUM", ""), "operator": raw.get("SIM1_OP", ""), "signal": raw.get("SIM1_SIGNAL", ""), "iccid": modem.get("sim1_iccid", ""), "registered": modem.get("sim1_cs_registered", False), "present": modem.get("sim1_present", False)},
        "sim2": {"number": raw.get("SIM2_PHNUM", ""), "operator": raw.get("SIM2_OP", ""), "signal": raw.get("SIM2_SIGNAL", ""), "iccid": modem.get("sim2_iccid", ""), "registered": modem.get("sim2_cs_registered", False), "present": modem.get("sim2_present", False)},
        "wifi": {"name": raw.get("WIFI_NAME", ""), "dbm": raw.get("WIFI_DBM", ""), "ip": wifi.get("ip", ""), "connected": wifi.get("connected", False)},
    }


def upsert_device(ip: str, mac: str = "", raw: dict | None = None, group: str = "auto") -> dict:
    raw = raw or {}
    now = now_ts()
    name = str(raw.get("DEV_ID") or ip)
    mac = mac or str(raw.get("MAC") or "")
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO devices(ip, mac, name, group_name, status, last_seen, raw_json, created_at, updated_at)
            VALUES(?, ?, ?, ?, 'online', ?, ?, ?, ?)
            ON CONFLICT(ip) DO UPDATE SET
              mac = excluded.mac,
              name = excluded.name,
              group_name = excluded.group_name,
              status = 'online',
              last_seen = excluded.last_seen,
              raw_json = excluded.raw_json,
              updated_at = excluded.updated_at
            """,
            (ip, mac, name, group or "auto", now, json.dumps(raw, ensure_ascii=False), now, now),
        )
        row = conn.execute("SELECT * FROM devices WHERE ip = ?", (ip,)).fetchone()
    return normalize_device(row)


def get_device_row(device_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="设备不存在")
    return row


@router.get("")
def list_devices(request: Request) -> dict:
    require_user(request)
    with connect() as conn:
        rows = conn.execute("SELECT * FROM devices ORDER BY updated_at DESC, id DESC").fetchall()
    devices = [normalize_device(row) for row in rows]
    return {"items": devices, "total": len(devices)}


@router.post("")
async def add_device(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ip = str(body.get("ip", "")).strip()
    if not ip:
        raise HTTPException(status_code=400, detail="IP 不能为空")
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    raw = lan_discover_device(ip) or get_device_data(ip, user, password)
    if not raw:
        raise HTTPException(status_code=400, detail="未识别到短信转发设备")
    return upsert_device(ip, str(body.get("mac", "")).strip(), raw, str(body.get("group", "auto")).strip())


@router.post("/bulk-delete")
async def bulk_delete_devices(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ids = body.get("ids", [])
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids 必须是数组")
    clean_ids = sorted({int(item) for item in ids if str(item).isdigit()})
    if not clean_ids:
        raise HTTPException(status_code=400, detail="请选择要删除的设备")
    placeholders = ",".join("?" for _ in clean_ids)
    with connect() as conn:
        cur = conn.execute(f"DELETE FROM devices WHERE id IN ({placeholders})", clean_ids)
    return {"success": True, "deleted": cur.rowcount}


@router.post("/{device_id}/refresh")
def refresh_device(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    raw = lan_discover_device(row["ip"]) or get_device_data(row["ip"])
    if not raw:
        raise HTTPException(status_code=400, detail="设备信息读取失败")
    return upsert_device(row["ip"], row["mac"], raw, row["group_name"])


@router.post("/{device_id}/sms")
async def send_sms(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    phone = str(body.get("phone", "")).strip()
    content = str(body.get("content", "")).strip()
    sim_slot = int(body.get("simSlot") or body.get("sim") or 1)
    if not phone or not content:
        raise HTTPException(status_code=400, detail="手机号和短信内容不能为空")
    if sim_slot not in (1, 2):
        raise HTTPException(status_code=400, detail="SIM 卡槽只能是 1 或 2")
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    result = send_sms_to_device(row["ip"], user, password, phone, content, sim_slot)
    with connect() as conn:
        conn.execute(
            "INSERT INTO messages(phone, content, direction, status, created_at) VALUES(?, ?, 'out', ?, ?)",
            (phone, content, "success" if result.get("ok") else "failed", now_ts()),
        )
    if not result.get("ok"):
        endpoint = result.get("endpoint") or "unknown"
        raise HTTPException(status_code=502, detail=f"{result.get('message') or '短信发送失败'} ({endpoint})")
    return {"success": True, "message": result.get("message") or "短信已发送", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.post("/{device_id}/flymode")
async def update_flymode(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    enabled = bool(body.get("enabled"))
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    result = set_device_flymode(row["ip"], user, password, enabled)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "飞行模式设置失败")
    return {"success": True, "message": result.get("message") or "飞行模式命令已发送", "endpoint": result.get("endpoint")}


@router.post("/{device_id}/reboot")
async def restart_device(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    result = reboot_device(row["ip"], user, password)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "重启命令发送失败")
    return {"success": True, "message": result.get("message") or "重启命令已发送", "endpoint": result.get("endpoint")}


def build_takeover_response(row, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict:
    status_result = get_t3_status(row["ip"], user, password)
    config_result = get_t3_config(row["ip"], user, password)
    return {
        "success": bool(status_result.get("ok") or config_result.get("ok")),
        "status": status_result.get("data", {}) if status_result.get("ok") else {},
        "config": config_result.get("data", {}) if config_result.get("ok") else {},
        "statusReady": bool(status_result.get("ok")),
        "configReady": bool(config_result.get("ok")),
        "statusError": "" if status_result.get("ok") else (status_result.get("message") or "设备状态读取失败，请确认设备已联网且局域网可访问"),
        "configError": "" if config_result.get("ok") else (config_result.get("message") or "设备配置读取失败，已禁用保存以避免空配置覆盖固件"),
        "statusEndpoint": status_result.get("endpoint"),
        "configEndpoint": config_result.get("endpoint"),
    }


@router.get("/{device_id}/takeover")
def get_takeover(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    return build_takeover_response(row)


@router.post("/{device_id}/takeover")
async def post_takeover(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    return build_takeover_response(row, user, password)


@router.post("/{device_id}/config")
async def update_config(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    user = str(body.pop("user", DEVICE_USER) or DEVICE_USER)
    password = str(body.pop("password", DEVICE_PASS) or DEVICE_PASS)
    current_result = get_t3_config(row["ip"], user, password)
    if not current_result.get("ok") or not isinstance(current_result.get("data"), dict) or not current_result.get("data"):
        raise HTTPException(status_code=502, detail=current_result.get("message") or "保存前未能读取设备当前配置，已取消保存以避免覆盖固件配置")
    merged = dict(current_result.get("data") or {})
    merged.update(body)
    result = update_t3_config(row["ip"], merged, user, password)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "配置保存失败")
    refreshed = get_t3_status(row["ip"], user, password)
    raw = None
    if refreshed.get("ok"):
        data = refreshed.get("data") or {}
        raw = {
            "DEV_ID": data.get("deviceName") or merged.get("deviceName") or row["name"],
            "DEV_VER": data.get("version", ""),
            "MAC": data.get("mac") or row["mac"],
            "raw": data,
        }
        modem = data.get("modem") if isinstance(data.get("modem"), dict) else {}
        wifi = data.get("wifi") if isinstance(data.get("wifi"), dict) else {}
        raw.update({
            "SIM1_PHNUM": modem.get("sim1_number", ""),
            "SIM2_PHNUM": modem.get("sim2_number", ""),
            "SIM1_OP": modem.get("sim1_operator", ""),
            "SIM2_OP": modem.get("sim2_operator", ""),
            "SIM1_SIGNAL": str(modem.get("signal_dbm", "")),
            "SIM2_SIGNAL": str(modem.get("signal_dbm", "")),
            "WIFI_NAME": wifi.get("ssid", ""),
            "WIFI_DBM": str(wifi.get("rssi", "")),
        })
        upsert_device(row["ip"], row["mac"], raw, row["group_name"])
    return {"success": True, "message": result.get("message") or "配置已保存", "endpoint": result.get("endpoint"), "status": refreshed.get("data", {}) if refreshed.get("ok") else {}}


@router.post("/{device_id}/wifi")
async def update_wifi(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    ssid = str(body.get("ssid", "")).strip()
    password = str(body.get("password") or body.get("pass") or "")
    if not ssid:
        raise HTTPException(status_code=400, detail="WiFi 名称不能为空")
    result = set_t3_wifi(row["ip"], ssid, password)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "WiFi 配置失败")
    return {"success": True, "message": "WiFi 已保存，设备将重新连接新热点", "endpoint": result.get("endpoint")}


@router.post("/{device_id}/sim-number")
async def update_sim_number(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    slot = int(body.get("slot") or 1)
    number = str(body.get("number", "")).strip()
    if slot not in (1, 2):
        raise HTTPException(status_code=400, detail="SIM 卡槽只能是 1 或 2")
    result = set_t3_sim_number(row["ip"], slot, number, str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "SIM 号码写入失败")
    return {"success": True, "message": result.get("message") or "SIM 号码已写入", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.post("/{device_id}/at")
async def proxy_at(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    command = str(body.get("command") or body.get("cmd") or "").strip()
    timeout_ms = int(body.get("timeout") or 1000)
    if not command:
        raise HTTPException(status_code=400, detail="AT 命令不能为空")
    result = send_t3_at(row["ip"], command, timeout_ms, str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "AT 命令执行失败")
    return {"success": True, "message": result.get("message") or "AT 命令已执行", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.post("/{device_id}/factory-reset")
async def factory_reset(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    result = factory_reset_t3(row["ip"], str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "恢复出厂失败")
    return {"success": True, "message": result.get("message") or "已恢复出厂，设备将重启", "endpoint": result.get("endpoint")}


@router.post("/{device_id}/clear-messages")
async def clear_device_messages_route(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    try:
        body = await request.json()
    except Exception:
        body = {}
    result = clear_device_messages(row["ip"], str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "清空设备消息日志失败")
    return {"success": True, "message": result.get("message") or "设备消息日志已清空", "endpoint": result.get("endpoint")}


@router.get("/{device_id}/ota/version")
def check_ota_version(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    result = check_t3_ota(row["ip"])
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "OTA 检查失败")
    return {"success": True, "message": result.get("message") or "OTA 检查完成", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.get("/{device_id}/ota")
def check_ota(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    result = check_t3_ota(row["ip"])
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "OTA 检查失败")
    return {"success": True, "message": result.get("message") or "OTA 检查完成", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.post("/ota/batch-check")
async def batch_check_ota(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ids = body.get("ids", [])
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids 必须是数组")
    clean_ids = sorted({int(item) for item in ids if str(item).isdigit()})
    if not clean_ids:
        raise HTTPException(status_code=400, detail="请选择要检查的设备")
    placeholders = ",".join("?" for _ in clean_ids)
    with connect() as conn:
        rows = conn.execute(f"SELECT * FROM devices WHERE id IN ({placeholders})", clean_ids).fetchall()
    items = []
    for row in rows:
        result = check_t3_ota(row["ip"])
        items.append({"id": row["id"], "ip": row["ip"], "success": bool(result.get("ok")), "message": result.get("message") or ("OTA 检查完成" if result.get("ok") else "OTA 检查失败"), "endpoint": result.get("endpoint"), "data": result.get("data", {})})
    return {"success": True, "items": items, "total": len(items)}


@router.post("/ota/batch-upgrade")
async def batch_start_ota(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ids = body.get("ids", [])
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids 必须是数组")
    clean_ids = sorted({int(item) for item in ids if str(item).isdigit()})
    if not clean_ids:
        raise HTTPException(status_code=400, detail="请选择要升级的设备")
    url = str(body.get("url", "")).strip()
    if not url:
        raise HTTPException(status_code=400, detail="OTA 地址不能为空")
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    placeholders = ",".join("?" for _ in clean_ids)
    with connect() as conn:
        rows = conn.execute(f"SELECT * FROM devices WHERE id IN ({placeholders})", clean_ids).fetchall()
    items = []
    for row in rows:
        result = start_t3_ota(row["ip"], url, user, password)
        items.append({"id": row["id"], "ip": row["ip"], "success": bool(result.get("ok")), "message": result.get("message") or ("OTA 已启动" if result.get("ok") else "OTA 启动失败"), "endpoint": result.get("endpoint"), "data": result.get("data", {})})
    return {"success": True, "items": items, "total": len(items)}


@router.post("/{device_id}/ota")
async def start_ota(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    url = str(body.get("url", "")).strip()
    if not url:
        raise HTTPException(status_code=400, detail="OTA 地址不能为空")
    result = start_t3_ota(row["ip"], url, str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "OTA 启动失败")
    return {"success": True, "message": result.get("message") or "OTA 已启动", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.delete("/{device_id}")
def delete_device(device_id: int, request: Request) -> dict:
    require_user(request)
    with connect() as conn:
        cur = conn.execute("DELETE FROM devices WHERE id = ?", (device_id,))
    return {"success": cur.rowcount > 0}
