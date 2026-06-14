from __future__ import annotations

import hmac

from fastapi import HTTPException, Request

from .config import UI_PASS, UI_USER
from .db import get_token


def check_credentials(username: str, password: str) -> bool:
    return hmac.compare_digest(username, UI_USER) and hmac.compare_digest(password, UI_PASS)


def extract_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get("t3_auth", "").strip()


def require_user(request: Request) -> dict:
    token = extract_token(request)
    record = get_token(token)
    if not record:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return record
