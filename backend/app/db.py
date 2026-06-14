from __future__ import annotations

import secrets
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Iterator

from .config import DATA_DIR, DB_PATH, TOKEN_TTL_SECONDS


def now_ts() -> int:
    return int(time.time())


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT NOT NULL UNIQUE,
                mac TEXT DEFAULT '',
                name TEXT DEFAULT '',
                group_name TEXT DEFAULT 'auto',
                status TEXT DEFAULT 'unknown',
                last_seen INTEGER DEFAULT 0,
                raw_json TEXT DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                content TEXT NOT NULL,
                direction TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.commit()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def issue_token(username: str) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = now_ts() + TOKEN_TTL_SECONDS
    with connect() as conn:
        conn.execute(
            "INSERT INTO auth_tokens(token, username, expires_at) VALUES(?, ?, ?)",
            (token, username, expires_at),
        )
    return token


def get_token(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT token, username, expires_at FROM auth_tokens WHERE token = ?",
            (token,),
        ).fetchone()
        record = row_to_dict(row)
    if not record:
        return None
    if int(record["expires_at"]) <= now_ts():
        delete_token(token)
        return None
    return record


def delete_token(token: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
