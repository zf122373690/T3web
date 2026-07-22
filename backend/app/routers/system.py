from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import require_user
from ..config import HTTP_TIMEOUT, LOCAL_TOOL_VERSION, OTA_VERSION_URL
from ..device_client import guess_ipv4_prefix
from .. import updater

router = APIRouter(prefix="/api", tags=["system"])


class SelfUpdateActionRequest(BaseModel):
    force: bool = False
    restart: bool = True


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/version")
def version() -> dict:
    result = {
        "localVersion": LOCAL_TOOL_VERSION,
        "otaServerVersion": "",
        "otaServerAvailable": False,
        "otaServerMessage": "未配置 OTA 服务器版本接口",
        "cloudBase": updater.CLOUD_BASE,
        "cloudDir": updater.CLOUD_DIR,
        "selfUpdate": updater.get_state(),
    }
    if not OTA_VERSION_URL:
        return result
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True, trust_env=False) as client:
            response = client.get(OTA_VERSION_URL)
        if response.status_code >= 400:
            result["otaServerMessage"] = f"OTA 服务器返回 HTTP {response.status_code}"
            return result
        data = response.json()
        if isinstance(data, dict):
            result["otaServerVersion"] = str(
                data.get("version") or data.get("latest") or data.get("latestVersion") or ""
            )
        if result["otaServerVersion"]:
            result["otaServerAvailable"] = True
            result["otaServerMessage"] = "OTA 服务器版本已读取"
        else:
            result["otaServerMessage"] = "OTA 服务器响应未包含版本字段"
    except Exception as exc:
        result["otaServerMessage"] = f"OTA 服务器版本不可用：{exc}"
    return result


@router.get("/lan-cidr")
def lan_cidr(_user: dict = Depends(require_user)) -> dict:
    return guess_ipv4_prefix()


@router.get("/self-update/status")
def self_update_status(_user: dict = Depends(require_user)) -> dict:
    return updater.get_state()


@router.post("/self-update/check")
def self_update_check(_user: dict = Depends(require_user)) -> dict:
    return updater.check_for_update()


@router.post("/self-update/download")
def self_update_download(body: SelfUpdateActionRequest, _user: dict = Depends(require_user)) -> dict:
    return updater.download_update(force=body.force)


@router.post("/self-update/apply")
def self_update_apply(body: SelfUpdateActionRequest, _user: dict = Depends(require_user)) -> dict:
    state = updater.apply_update(restart=body.restart)
    if state.get("status") == "error" and state.get("error") == "not_frozen":
        raise HTTPException(status_code=400, detail=state.get("message") or "当前环境不支持自动升级")
    return state


@router.post("/self-update/run")
def self_update_run(body: SelfUpdateActionRequest, _user: dict = Depends(require_user)) -> dict:
    state = updater.download_and_apply(force=body.force, restart=body.restart)
    if state.get("status") == "error" and state.get("error") == "not_frozen":
        raise HTTPException(status_code=400, detail=state.get("message") or "当前环境不支持自动升级")
    return state
