from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request

from ..auth import require_user
from ..config import DEVICE_PASS, DEVICE_USER
from ..db import connect, now_ts
from ..device_client import get_device_data, lan_discover_device, reboot_device, send_sms_to_device, set_device_flymode

router = APIRouter(prefix="/api/devices", tags=["devices"])


def normalize_device(row) -> dict:
    raw = {}
    try:
        raw = json.loads(row["raw_json"] or "{}")
    except Exception:
        raw = {}
    return {
        "id": row["id"],
        "ip": row["ip"],
        "mac": row["mac"] or raw.get("MAC", ""),
        "name": row["name"] or raw.get("DEV_ID", "") or row["ip"],
        "group": row["group_name"] or "auto",
        "status": row["status"] or "unknown",
        "lastSeen": row["last_seen"],
        "version": raw.get("DEV_VER", ""),
        "sim1": {"number": raw.get("SIM1_PHNUM", ""), "operator": raw.get("SIM1_OP", ""), "signal": raw.get("SIM1_SIGNAL", "")},
        "sim2": {"number": raw.get("SIM2_PHNUM", ""), "operator": raw.get("SIM2_OP", ""), "signal": raw.get("SIM2_SIGNAL", "")},
        "wifi": {"name": raw.get("WIFI_NAME", ""), "dbm": raw.get("WIFI_DBM", "")},
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
        raise HTTPException(status_code=400, detail="未识别到 ESP32-C3 短信转发设备")
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
        raise HTTPException(status_code=502, detail=result.get("message") or "短信发送失败")
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


@router.delete("/{device_id}")
def delete_device(device_id: int, request: Request) -> dict:
    require_user(request)
    with connect() as conn:
        cur = conn.execute("DELETE FROM devices WHERE id = ?", (device_id,))
    return {"success": cur.rowcount > 0}
