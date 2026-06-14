"""SQLite-backed persistence layer with SQLAlchemy.

Windows/Linux兼容: 数据库存储.
"""

from __future__ import annotations

import logging
import secrets
import time
from typing import Any, Dict, Optional

from sqlalchemy import (
    BigInteger,
    Column,
    Integer,
    String,
    Text,
    create_engine,
    event,
    text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from backend.config import DBPATH, TOKEN_TTL_SECONDS
import os

logger = logging.getLogger("sms-forwarder")

# 确保数据库目录存在
os.makedirs(os.path.dirname(DBPATH), exist_ok=True)

Base = declarative_base()
engine = create_engine(
    f"sqlite:///{DBPATH}",
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"check_same_thread": False},
)


# SQLite优化: 启用WAL模式，提高并发性能
@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    try:
        # 禁用WAL，使用DELETE模式，更兼容
        cursor.execute("PRAGMA journal_mode=DELETE")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Device(Base):
    """ESP32-C3设备模型"""
    __tablename__ = "devices"
    id           = Column(Integer, primary_key=True, index=True)
    devId        = Column(String(128), unique=True, nullable=True)
    grp          = Column(String(64),  default="auto")
    ip           = Column(String(45),  unique=True, index=True, nullable=False)
    mac          = Column(String(32),  unique=True, nullable=True, default=None)
    user         = Column(String(64),  default="")
    passwd       = Column(String(64),  default="")
    status       = Column(String(32),  default="unknown")
    lastSeen     = Column(BigInteger,  default=0)
    # SIM卡信息
    sim1number   = Column(String(32),  default="")
    sim1operator = Column(String(64),  default="")
    sim1signal   = Column(Integer,     default=0)
    sim2number   = Column(String(32),  default="")
    sim2operator = Column(String(64),  default="")
    sim2signal   = Column(Integer,     default=0)
    # 转发配置
    forwardEnabled = Column(Integer, default=0)  # 0=禁用, 1=启用
    forwardUrl    = Column(String(512), default="")
    forwardMethod = Column(String(16), default="POST")
    forwardHeaders = Column(Text, default="")
    token        = Column(Text,        default="")
    firmware_version = Column(String(64), default="")
    alias        = Column(String(128), default="")
    created      = Column(String(32),  default="")


class SmsRecord(Base):
    """短信记录模型"""
    __tablename__ = "sms_records"
    id           = Column(Integer, primary_key=True, index=True)
    device_id    = Column(Integer, nullable=False)
    sim_slot     = Column(Integer, default=1)  # 1=SIM1, 2=SIM2
    sender       = Column(String(32), default="")
    content      = Column(Text, default="")
    received_at  = Column(BigInteger, default=0)
    forwarded    = Column(Integer, default=0)  # 0=未转发, 1=已转发
    forward_result = Column(Text, default="")
    created_at   = Column(String(32), default="")


class AuthToken(Base):
    """认证令牌模型"""
    __tablename__ = "auth_tokens"
    token    = Column(String(128), primary_key=True)
    username = Column(String(64),  default="")
    exp      = Column(BigInteger,  default=0, index=True)


class RateEvent(Base):
    """限速事件模型"""
    __tablename__ = "rate_events"
    id    = Column(Integer, primary_key=True, autoincrement=True)
    scope = Column(String(32),  index=True, nullable=False)
    rkey  = Column(String(160), index=True, nullable=False)
    ts    = Column(Integer,     index=True, nullable=False)


class ScheduledTask(Base):
    """定时任务模型"""
    __tablename__ = "scheduled_tasks"
    id              = Column(String(16), primary_key=True)
    name            = Column(String(128), nullable=False)
    enabled         = Column(Integer, default=0)  # 0=禁用, 1=启用
    intervalDays    = Column(Integer, default=90)
    phoneNumber     = Column(String(32), default="")
    content         = Column(Text, default="")
    lastRunAt       = Column(BigInteger, default=0)
    lastRunStatus   = Column(String(16), default="unknown")  # success/failed/unknown
    createdAt       = Column(String(32), default="")


Base.metadata.create_all(bind=engine)


def run_migrations() -> None:
    """Idempotent ALTER TABLE migrations for columns added across versions."""
    alters = [
        ("devices", "token",            "TEXT DEFAULT ''"),
        ("devices", "sim1signal",       "INTEGER DEFAULT 0"),
        ("devices", "sim2signal",       "INTEGER DEFAULT 0"),
        ("devices", "firmware_version", "VARCHAR(64) DEFAULT ''"),
        ("devices", "forwardEnabled",   "INTEGER DEFAULT 0"),
        ("devices", "forwardUrl",       "VARCHAR(512) DEFAULT ''"),
        ("devices", "forwardMethod",    "VARCHAR(16) DEFAULT 'POST'"),
        ("devices", "forwardHeaders",   "TEXT DEFAULT ''"),
    ]
    with engine.connect() as conn:
        for table, col, coltype in alters:
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            cols = [r[1] for r in rows]
            if col not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}"))
        conn.execute(text("UPDATE devices SET mac = NULL WHERE mac = ''"))
        conn.commit()


run_migrations()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def nowts() -> int:
    return int(time.time())


# ── Token persistence ───────────────────────────────────────────────────────
def cleanup_expired_tokens() -> None:
    try:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM auth_tokens WHERE exp <= :n"), {"n": nowts()})
    except Exception:
        logger.debug("token cleanup failed", exc_info=True)


def get_token_record(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT username, exp FROM auth_tokens WHERE token = :t"),
                {"t": token},
            ).first()
            if not row:
                return None
            return {"username": row[0] or "", "exp": int(row[1] or 0)}
    except Exception:
        logger.debug("token lookup failed", exc_info=True)
        return None


def insert_token(token: str, username: str, exp: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("INSERT OR REPLACE INTO auth_tokens(token, username, exp) VALUES(:t, :u, :e)"),
            {"t": token, "u": username, "e": exp},
        )


def delete_token(token: str) -> None:
    if not token:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM auth_tokens WHERE token = :t"), {"t": token})
    except Exception:
        logger.debug("token delete failed", exc_info=True)


def issue_token(username: str) -> str:
    cleanup_expired_tokens()
    token = secrets.token_urlsafe(32)
    insert_token(token, username, nowts() + TOKEN_TTL_SECONDS)
    return token


# ── Rate-limit event store ──────────────────────────────────────────────────
def rate_count(scope: str, key: str, period: float) -> int:
    """Count events for (scope, key) inside the trailing `period` seconds."""
    cutoff = nowts() - int(period)
    try:
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM rate_events WHERE scope=:s AND rkey=:k AND ts < :c"),
                {"s": scope, "k": key, "c": cutoff},
            )
            row = conn.execute(
                text("SELECT COUNT(*) FROM rate_events WHERE scope=:s AND rkey=:k"),
                {"s": scope, "k": key},
            ).first()
            return int(row[0] or 0) if row else 0
    except Exception:
        logger.debug("rate_count failed", exc_info=True)
        return 0


def rate_add(scope: str, key: str) -> None:
    try:
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO rate_events(scope, rkey, ts) VALUES(:s, :k, :t)"),
                {"s": scope, "k": key, "t": nowts()},
            )
    except Exception:
        logger.debug("rate_add failed", exc_info=True)


def rate_reset(scope: str, key: str) -> None:
    try:
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM rate_events WHERE scope=:s AND rkey=:k"),
                {"s": scope, "k": key},
            )
    except Exception:
        logger.debug("rate_reset failed", exc_info=True)


def cleanup_rate_events(max_age: int) -> None:
    """Periodic sweep: drop any event older than the widest configured window."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM rate_events WHERE ts < :c"),
                {"c": nowts() - int(max_age)},
            )
    except Exception:
        logger.debug("rate_events cleanup failed", exc_info=True)