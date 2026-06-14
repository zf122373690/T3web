from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import check_credentials, extract_token, require_user
from ..config import TOKEN_TTL_SECONDS
from ..db import delete_token, issue_token

router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/auth/config")
def auth_config() -> dict:
    return {
        "passwordEnabled": True,
        "oidcEnabled": False,
        "githubEnabled": False,
        "hasPasswordConfigured": True,
    }


@router.post("/login")
async def login(request: Request, response: Response) -> dict:
    body = await request.json()
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", "")).strip()
    if not username or not password:
        raise HTTPException(status_code=400, detail="用户名和密码不能为空")
    if not check_credentials(username, password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = issue_token(username)
    response.set_cookie("t3_auth", token, max_age=TOKEN_TTL_SECONDS, httponly=True, samesite="lax")
    return {"token": token, "username": username, "expiresAt": TOKEN_TTL_SECONDS}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    token = extract_token(request)
    if token:
        delete_token(token)
    response.delete_cookie("t3_auth")
    return {"success": True}


@router.get("/me")
def me(request: Request) -> dict:
    record = require_user(request)
    return {"username": record["username"], "expiresAt": record["expires_at"]}
