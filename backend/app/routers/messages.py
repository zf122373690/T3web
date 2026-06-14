from __future__ import annotations

from fastapi import APIRouter, Query, Request

from ..auth import require_user
from ..db import connect, now_ts

router = APIRouter(prefix="/api/messages", tags=["messages"])


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


@router.get("")
def list_messages(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str = "",
) -> dict:
    require_user(request)
    offset = (page - 1) * page_size
    keyword = f"%{search.strip()}%"
    where = ""
    params: list[object] = []
    if search.strip():
        where = "WHERE phone LIKE ? OR content LIKE ? OR direction LIKE ? OR status LIKE ?"
        params.extend([keyword, keyword, keyword, keyword])
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
    with connect() as conn:
        conn.execute("DELETE FROM messages")
    return {"success": True}
