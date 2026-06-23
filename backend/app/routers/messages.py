from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from ..auth import require_user
from ..config import MESSAGE_INGEST_TOKEN
from ..db import connect, now_ts

router = APIRouter(prefix="/api/messages", tags=["messages"])


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
    }


@router.post("/ingest")
async def ingest_message(request: Request) -> dict:
    token = _token_from_request(request)
    if MESSAGE_INGEST_TOKEN and token != MESSAGE_INGEST_TOKEN:
        raise HTTPException(status_code=403, detail="invalid token")

    body = await request.json()
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else body
    event = str(metadata.get("event") or body.get("event") or "sms").lower()
    if event not in {"sms", "message", "call"}:
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

    direction = "call" if event == "call" else "in"
    with connect() as conn:
        conn.execute(
            "INSERT INTO messages(phone, content, direction, status, created_at) VALUES(?, ?, ?, 'success', ?)",
            (phone or "-", content, direction, now_ts()),
        )
    return {"success": True}


@router.post("/cloud")
async def ingest_cloud_message(request: Request) -> dict:
    return await ingest_message(request)


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
        where_parts.append("(phone LIKE ? OR content LIKE ? OR direction LIKE ? OR status LIKE ?)")
        params.extend([keyword, keyword, keyword, keyword])

    where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    with connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM messages {where}", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT id, phone, content, direction, status, created_at
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
