from __future__ import annotations

import hashlib
import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..auth import require_user
from ..config import DEVICE_PASS, DEVICE_USER, MESSAGE_INGEST_TOKEN
from ..db import connect, now_ts
from ..device_client import get_t3_messages

router = APIRouter(prefix="/api/messages", tags=["messages"])
_sync_lock = threading.Lock()


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (
        request.headers.get("x-device-token", "")
        or request.headers.get("x-openclaw-webhook-secret", "")
        or request.query_params.get("key", "")
        or request.query_params.get("token", "")
    ).strip()


def _message_type(*payloads: dict[str, Any]) -> str:
    values = []
    for payload in payloads:
        values.extend([payload.get("event"), payload.get("type")])
    normalized = {str(value).strip().lower() for value in values if value is not None}
    if "call" in normalized:
        return "call"
    if normalized.intersection({"sms", "message"}):
        return "sms"
    return next(iter(normalized), "sms")


def _message_time(value: Any) -> int:
    if isinstance(value, (int, float)):
        timestamp = int(value)
        return timestamp // 1000 if timestamp > 10_000_000_000 else timestamp
    text = str(value or "").strip()
    if text.isdigit():
        timestamp = int(text)
        return timestamp // 1000 if timestamp > 10_000_000_000 else timestamp
    for pattern in ("%Y/%m/%d,%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            return int(time.mktime(datetime.strptime(text[:19], pattern).timetuple()))
        except ValueError:
            pass
    return now_ts()


def _source_key(source: str, message_type: str, timestamp: Any, phone: str, content: str, sim: str = "") -> str:
    raw = json.dumps(
        [source.strip(), message_type, str(timestamp or "").strip(), sim.strip(), phone.strip(), content.strip()],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _sim_slot(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        slot = int(value)
        return slot if slot in (1, 2) else None
    text = str(value or "").strip().upper()
    if text.startswith("SIM"):
        text = text[3:]
    return int(text) if text in {"1", "2"} else None


def _insert_message(
    phone: str,
    content: str,
    direction: str,
    created_at: int,
    source_key: str | None,
    *,
    device_id: Any = None,
    device_name: Any = "",
    device_ip: Any = "",
    sim_slot: Any = None,
    sim_number: Any = "",
    sim_type: Any = "",
) -> bool:
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO messages(
                phone, content, direction, status, created_at, source_key,
                device_id, device_name, device_ip, sim_slot, sim_number, sim_type
            ) VALUES(?, ?, ?, 'success', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                phone or "-", content, direction, created_at, source_key,
                None if device_id is None else str(device_id), str(device_name or ""),
                str(device_ip or ""), _sim_slot(sim_slot), str(sim_number or ""), str(sim_type or ""),
            ),
        )
    return cur.rowcount > 0


def _sync_device(row: dict[str, Any]) -> dict[str, Any]:
    result = get_t3_messages(row["ip"], DEVICE_USER, DEVICE_PASS)
    if not result.get("ok"):
        return {
            "id": row["id"],
            "ip": row["ip"],
            "name": row["name"],
            "success": False,
            "inserted": 0,
            "duplicates": 0,
            "ignored": 0,
            "message": result.get("message") or "设备消息读取失败",
        }

    inserted = 0
    duplicates = 0
    ignored = 0
    source = str(row.get("mac") or row.get("ip") or row["id"])
    try:
        raw = json.loads(row.get("raw_json") or "{}")
    except (TypeError, ValueError):
        raw = {}
    for item in result.get("data") or []:
        if not isinstance(item, dict):
            ignored += 1
            continue
        message_type = _message_type(item)
        if message_type not in {"sms", "call"}:
            ignored += 1
            continue
        phone = str(item.get("from") or item.get("sender") or item.get("phone") or item.get("phNum") or "").strip()
        if phone.upper() == "SYSTEM":
            ignored += 1
            continue
        content = str(item.get("msg") or item.get("message") or item.get("content") or item.get("smsBd") or "").strip()
        if message_type == "call" and not content:
            content = f"来电：{phone}" if phone else "来电"
        if not phone and not content:
            ignored += 1
            continue
        timestamp = item.get("ts") or item.get("timestamp") or item.get("time") or item.get("createdAt")
        sim = item.get("simSlot") or item.get("sim_slot") or item.get("sim") or item.get("slot")
        slot = _sim_slot(sim)
        sim_number = item.get("simNumber") or item.get("sim_number") or (raw.get(f"SIM{slot}_PHNUM", "") if slot else "")
        sim_type = item.get("simType") or item.get("sim_type") or item.get("simRemark") or item.get("sim_remark") or ""
        device_id = item.get("deviceId") or item.get("device_id") or row["id"]
        device_name = item.get("deviceName") or item.get("device_name") or row.get("name") or row.get("ip") or device_id
        key = _source_key(source, message_type, timestamp, phone, content, str(sim or ""))
        if _insert_message(
            phone, content, "call" if message_type == "call" else "in", _message_time(timestamp), key,
            device_id=device_id, device_name=device_name, device_ip=row.get("ip", ""),
            sim_slot=slot, sim_number=sim_number, sim_type=sim_type,
        ):
            inserted += 1
        else:
            duplicates += 1

    return {
        "id": row["id"],
        "ip": row["ip"],
        "name": row["name"],
        "success": True,
        "inserted": inserted,
        "duplicates": duplicates,
        "ignored": ignored,
        "message": "同步完成",
    }


def normalize_message(row) -> dict:
    return {
        "id": row["id"],
        "phone": row["phone"],
        "from": row["phone"],
        "content": row["content"],
        "direction": row["direction"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "time": row["created_at"],
        "deviceId": row["device_id"] or "",
        "deviceName": row["device_name"] or "",
        "deviceIp": row["device_ip"] or "",
        "simSlot": row["sim_slot"],
        "simNumber": row["sim_number"] or "",
        "simType": row["sim_type"] or "",
    }



@router.post("/ingest")
async def ingest_message(request: Request) -> dict:
    token = _token_from_request(request)
    if MESSAGE_INGEST_TOKEN and token != MESSAGE_INGEST_TOKEN:
        raise HTTPException(status_code=403, detail="invalid token")

    body = await request.json()
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else body
    event = _message_type(metadata, body)
    if event not in {"sms", "call"}:
        return {"success": True, "ignored": True}

    phone = str(
        metadata.get("sender")
        or metadata.get("phNum")
        or metadata.get("phone")
        or metadata.get("from")
        or ""
    ).strip()
    if phone.upper() == "SYSTEM":
        return {"success": True, "ignored": True}
    content = str(
        metadata.get("message")
        or metadata.get("smsBd")
        or metadata.get("content")
        or metadata.get("text")
        or ""
    ).strip()

    if event == "call" and not content:
        content = f"来电：{phone}" if phone else "来电"
    if not phone and not content:
        raise HTTPException(status_code=400, detail="empty message")

    timestamp = metadata.get("timestamp") or metadata.get("ts") or metadata.get("time") or body.get("timestamp")
    explicit_key = metadata.get("sourceKey") or metadata.get("source_key") or body.get("sourceKey") or body.get("source_key")
    source = str(metadata.get("deviceId") or metadata.get("device_id") or body.get("deviceId") or "ingest")
    device_name = metadata.get("deviceName") or metadata.get("device_name") or body.get("deviceName") or body.get("device_name") or source
    sim_slot = metadata.get("simSlot") or metadata.get("sim_slot") or metadata.get("sim") or metadata.get("slot")
    source_key = str(explicit_key).strip() if explicit_key else _source_key(source, event, timestamp, phone, content, str(sim_slot or ""))
    inserted = _insert_message(
        phone, content, "call" if event == "call" else "in", _message_time(timestamp), source_key,
        device_id=source,
        device_name=device_name,
        device_ip=metadata.get("deviceIp") or metadata.get("device_ip") or metadata.get("ip") or body.get("deviceIp") or body.get("device_ip") or body.get("ip"),
        sim_slot=sim_slot,
        sim_number=metadata.get("simNumber") or metadata.get("sim_number"),
        sim_type=metadata.get("simType") or metadata.get("sim_type") or metadata.get("simRemark") or metadata.get("sim_remark"),
    )
    return {"success": True, "inserted": inserted, "duplicate": not inserted}


@router.post("/cloud")
async def ingest_cloud_message(request: Request) -> dict:
    return await ingest_message(request)


def sync_all_messages() -> dict:
    if not _sync_lock.acquire(blocking=False):
        return {"success": True, "running": True, "items": [], "devices": 0, "syncedDevices": 0, "failedDevices": 0, "imported": 0, "skipped": 0, "inserted": 0, "duplicates": 0, "ignored": 0, "failed": 0, "message": "消息同步正在进行，已跳过本次触发", "errors": []}
    try:
        with connect() as conn:
            rows = [dict(row) for row in conn.execute("SELECT id, ip, mac, name, raw_json FROM devices WHERE status = 'online' ORDER BY id").fetchall()]
        if not rows:
            return {"success": True, "items": [], "devices": 0, "syncedDevices": 0, "failedDevices": 0, "imported": 0, "skipped": 0, "inserted": 0, "duplicates": 0, "ignored": 0, "failed": 0, "message": "没有在线设备可同步", "errors": []}

        items = []
        with ThreadPoolExecutor(max_workers=min(len(rows), 10)) as pool:
            futures = {pool.submit(_sync_device, row): row for row in rows}
            for future in as_completed(futures):
                row = futures[future]
                try:
                    items.append(future.result())
                except Exception as exc:
                    items.append({"id": row["id"], "ip": row["ip"], "name": row["name"], "success": False, "inserted": 0, "duplicates": 0, "ignored": 0, "message": str(exc)})
        items.sort(key=lambda item: item["id"])
        inserted = sum(item["inserted"] for item in items)
        duplicates = sum(item["duplicates"] for item in items)
        ignored = sum(item["ignored"] for item in items)
        failed = sum(1 for item in items if not item["success"])
        synced = len(items) - failed
        skipped = duplicates + ignored
        message = f"同步完成：{synced}/{len(items)} 台设备成功，新增 {inserted} 条，跳过 {skipped} 条重复或无效记录"
        if failed:
            message += f"，{failed} 台失败"
        return {
            "success": failed == 0,
            "items": items,
            "devices": len(items),
            "syncedDevices": synced,
            "failedDevices": failed,
            "imported": inserted,
            "skipped": skipped,
            "inserted": inserted,
            "duplicates": duplicates,
            "ignored": ignored,
            "failed": failed,
            "message": message,
            "errors": [f"{item['name'] or item['ip']}：{item['message']}" for item in items if not item["success"]],
        }
    finally:
        _sync_lock.release()


@router.post("/sync")
def sync_messages(request: Request) -> dict:
    require_user(request)
    return sync_all_messages()


@router.get("")
def list_messages(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str = "",
    direction: str = "",
) -> dict:
    require_user(request)
    offset = (page - 1) * page_size
    keyword = f"%{search.strip()}%"
    where_parts: list[str] = []
    params: list[object] = []

    if direction == "sms":
        where_parts.append("direction IN ('in', 'out')")
    elif direction == "call":
        where_parts.append("direction = 'call'")

    if search.strip():
        where_parts.append("(phone LIKE ? OR content LIKE ? OR direction LIKE ? OR status LIKE ? OR device_id LIKE ? OR device_name LIKE ? OR device_ip LIKE ? OR CAST(sim_slot AS TEXT) LIKE ? OR sim_number LIKE ? OR sim_type LIKE ?)")
        params.extend([keyword] * 10)

    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    with connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM messages {where}", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT id, phone, content, direction, status, created_at, device_id, device_name, device_ip, sim_slot, sim_number, sim_type
            FROM messages
            {where}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()
    return {"items": [normalize_message(row) for row in rows], "total": total, "page": page, "pageSize": page_size}


@router.get("/stats")
def message_stats(request: Request) -> dict:
    require_user(request)
    today_start = now_ts() - (now_ts() % 86400)
    week_start = now_ts() - 7 * 86400
    with connect() as conn:
        total = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        today = conn.execute("SELECT COUNT(*) FROM messages WHERE created_at >= ?", (today_start,)).fetchone()[0]
        week = conn.execute("SELECT COUNT(*) FROM messages WHERE created_at >= ?", (week_start,)).fetchone()[0]
        failed = conn.execute("SELECT COUNT(*) FROM messages WHERE status != 'success'").fetchone()[0]
    return {"total": total, "today": today, "week": week, "failed": failed}


@router.delete("/{message_id}")
def delete_message(message_id: int, request: Request) -> dict:
    require_user(request)
    with connect() as conn:
        cur = conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
    return {"success": cur.rowcount > 0}


@router.delete("")
def clear_messages(request: Request) -> dict:
    require_user(request)
    direction = request.query_params.get("direction", "")
    with connect() as conn:
        if direction == "sms":
            conn.execute("DELETE FROM messages WHERE direction IN ('in', 'out')")
        elif direction == "call":
            conn.execute("DELETE FROM messages WHERE direction = 'call'")
        else:
            conn.execute("DELETE FROM messages")
    return {"success": True}
