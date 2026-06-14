"""认证路由.

Windows/Linux兼容: 用户登录/登出.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from backend.config import TOKEN_TTL_SECONDS, UIUSER, UIPASS
from backend.database import get_db, get_token_record, issue_token, delete_token, nowts

logger = logging.getLogger("sms-forwarder")

router = APIRouter(prefix="/api", tags=["auth"])

# 依赖注入的配置 (通过inject函数设置)
_config: Dict[str, Any] = {}


def inject(
    client_ip: Callable,
    login_limiter_ip: Any,
    login_limiter_user: Any,
    check_login_credentials: Callable,
    extract_request_token: Callable,
    set_auth_cookies: Callable,
    clear_auth_cookies: Callable,
    audit: Any,
    bm_login_failure: Any,
    csrf_for_token: Callable,
    session_local: Any,
) -> None:
    """注入依赖配置"""
    global _config
    _config = {
        "client_ip": client_ip,
        "login_limiter_ip": login_limiter_ip,
        "login_limiter_user": login_limiter_user,
        "check_login_credentials": check_login_credentials,
        "extract_request_token": extract_request_token,
        "set_auth_cookies": set_auth_cookies,
        "clear_auth_cookies": clear_auth_cookies,
        "audit": audit,
        "bm_login_failure": bm_login_failure,
        "csrf_for_token": csrf_for_token,
        "session_local": session_local,
    }


@router.get("/auth/config")
async def get_auth_config():
    """获取认证配置"""
    return {
        "oidcEnabled": False,
        "githubEnabled": False,
        "passwordEnabled": True,
        "hasPasswordConfigured": True
    }


@router.post("/login")
async def login(request: Request, response: Response, db: Session = Depends(get_db)):
    """用户登录"""
    body = await request.json()
    username = (body.get("username") or "").strip()
    password = (body.get("password") or "").strip()
    
    if not username or not password:
        raise HTTPException(status_code=400, detail="用户名和密码不能为空")
    
    # 获取客户端IP
    client_ip = _config.get("client_ip", lambda r: r.client.host if r.client else "")
    ip = client_ip(request)
    
    # 速率限制检查
    login_limiter_ip = _config.get("login_limiter_ip")
    if login_limiter_ip and not login_limiter_ip.is_allowed(ip):
        logger.warning("login rate limit exceeded for IP: %s", ip)
        raise HTTPException(status_code=429, detail="登录尝试过于频繁，请稍后再试")
    
    login_limiter_user = _config.get("login_limiter_user")
    if login_limiter_user and not login_limiter_user.is_allowed(username):
        logger.warning("login rate limit exceeded for user: %s", username)
        raise HTTPException(status_code=429, detail="登录尝试过于频繁，请稍后再试")
    
    # 验证凭证 - 使用配置中的用户名密码
    import hmac
    if not (hmac.compare_digest(username, UIUSER) and hmac.compare_digest(password, UIPASS)):
        logger.warning("login failed for user: %s from IP: %s", username, ip)
        bm_login_failure = _config.get("bm_login_failure")
        if bm_login_failure:
            bm_login_failure("invalid_credentials")
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    
    # 生成Token
    token = issue_token(username)
    
    # 设置Cookie
    set_auth_cookies = _config.get("set_auth_cookies")
    if set_auth_cookies:
        set_auth_cookies(response, token)
    
    # 审计日志
    audit = _config.get("audit")
    if audit:
        audit("login", username, {"ip": ip})
    
    return {
        "success": True,
        "token": token,
        "username": username,
    }


@router.post("/logout")
async def logout(request: Request, response: Response):
    """用户登出"""
    # 提取Token
    extract_request_token = _config.get("extract_request_token", lambda r: ("", False))
    token, _ = extract_request_token(request)
    
    if token:
        delete_token(token)
        
        # 清除Cookie
        clear_auth_cookies = _config.get("clear_auth_cookies")
        if clear_auth_cookies:
            clear_auth_cookies(response)
        
        # 审计日志
        audit = _config.get("audit")
        if audit:
            record = get_token_record(token)
            username = record.get("username", "") if record else ""
            audit("logout", username, {})
    
    return {"success": True}


@router.get("/me")
async def get_current_user(request: Request):
    """获取当前用户信息"""
    extract_request_token = _config.get("extract_request_token", lambda r: ("", False))
    token, _ = extract_request_token(request)
    
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    
    record = get_token_record(token)
    if not record:
        raise HTTPException(status_code=401, detail="登录已过期")
    
    if record.get("exp", 0) <= nowts():
        delete_token(token)
        raise HTTPException(status_code=401, detail="登录已过期")
    
    return {
        "username": record.get("username", ""),
        "exp": record.get("exp", 0),
    }


# 初始化默认配置 - 需要从main.py导入验证函数
# 这里暂时使用简单验证