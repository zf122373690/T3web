"""设备管理路由.

Windows/Linux兼容: 设备列表/详情/刷新/配置.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Depends
from sqlalchemy.orm import Session

from backend.config import SMS_MAX_LEN
from backend.database import Device, SessionLocal, get_db, nowts
from backend.device_client import (
    getdevicedata,
    get_wifi_info,
    read_device_config,
    write_device_config,
    ota_check,
    check_ota_task,
    upgrade_ota_task,
    ensure_device_token,
    fetch_device_token,
    send_sms_to_device,
)
from backend.device_utils import _device_to_dict, upsertdevice, listdevices

logger = logging.getLogger("sms-forwarder")

router = APIRouter(prefix="/api", tags=["devices"])

# 依赖注入配置
_config: Dict[str, Any] = {}


def inject(**kwargs) -> None:
    global _config
    _config.update(kwargs)


@router.get("/devices")
def get_devices(request: Request, db: Session = Depends(get_db)):
    """获取设备列表"""
    return listdevices(db)


@router.get("/devices/{device_id}")
def get_device(device_id: int, db: Session = Depends(get_db)):
    """获取设备详情"""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    return _device_to_dict(device)


@router.post("/devices")
def add_device(request: Request, db: Session = Depends(get_db)):
    """添加设备"""
    body = request.json()
    ip = (body.get("ip") or "").strip()
    mac = (body.get("mac") or "").strip().upper()
    user = (body.get("user") or "admin").strip()
    pw = (body.get("password") or "admin").strip()
    grp = (body.get("group") or "").strip()
    
    if not ip:
        raise HTTPException(status_code=400, detail="IP地址不能为空")
    
    return upsertdevice(db, ip, mac, user, pw, grp)


@router.delete("/devices/{device_id}")
def delete_device(device_id: int, db: Session = Depends(get_db)):
    """删除设备"""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    db.delete(device)
    db.commit()
    
    return {"success": True}


@router.post("/devices/{device_id}/refresh")
def refresh_device(device_id: int, db: Session = Depends(get_db)):
    """刷新设备状态"""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    user = (device.user or "admin").strip()
    pw = (device.passwd or "admin").strip()
    
    result = upsertdevice(db, device.ip, device.mac or "", user, pw, device.grp)
    return result


@router.get("/devices/{device_id}/detail")
def get_device_detail(device_id: int, db: Session = Depends(get_db)):
    """获取设备详细信息"""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    user = (device.user or "admin").strip()
    pw = (device.passwd or "admin").strip()
    
    # 获取设备数据
    data = getdevicedata(device.ip, user, pw) or {}
    wifi = get_wifi_info(device.ip, user, pw)
    
    result = _device_to_dict(device)
    result.update({
        "wifiName": wifi.get("wifiName", ""),
        "wifiDbm": wifi.get("wifiDbm", ""),
    })
    result.update(data)
    
    return result


@router.get("/devices/{device_id}/config")
def get_device_config(device_id: int, db: Session = Depends(get_db)):
    """获取设备配置"""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    user = (device.user or "admin").strip()
    pw = (device.passwd or "admin").strip()
    
    config = read_device_config(device.ip, user, pw)
    return {"config": config or ""}


@router.put("/devices/{device_id}/config")
async def update_device_config(device_id: int, request: Request, db: Session = Depends(get_db)):
    """更新设备配置"""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    body = await request.json()
    config = body.get("config", "")
    
    user = (device.user or "admin").strip()
    pw = (device.passwd or "admin").strip()
    
    success = write_device_config(device.ip, user, pw, config)
    
    if not success:
        raise HTTPException(status_code=500, detail="配置保存失败")
    
    return {"success": True}


@router.post("/devices/{device_id}/ota/check")
def check_ota(device_id: int, db: Session = Depends(get_db)):
    """检查OTA更新"""
    return check_ota_task(device_id)


@router.post("/devices/{device_id}/ota/upgrade")
def upgrade_ota(device_id: int, db: Session = Depends(get_db)):
    """执行OTA升级"""
    return upgrade_ota_task(device_id)


@router.get("/devices/{device_id}/numbers")
def get_device_numbers(device_id: int, db: Session = Depends(get_db)):
    """获取设备的SIM卡号码"""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    numbers = []
    for num, op, slot, sig in [
        (device.sim1number, device.sim1operator, 1, device.sim1signal),
        (device.sim2number, device.sim2operator, 2, device.sim2signal),
    ]:
        if num and num.strip():
            numbers.append({
                "number": num.strip(),
                "operator": op or "",
                "slot": slot,
                "signal": sig,
            })
    
    return {"numbers": numbers}


@router.post("/devices/{device_id}/forward")
async def update_forward_config(device_id: int, request: Request, db: Session = Depends(get_db)):
    """更新转发配置"""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    body = await request.json()
    
    device.forwardEnabled = 1 if body.get("enabled") else 0
    device.forwardUrl = body.get("url", "")
    device.forwardMethod = body.get("method", "POST")
    device.forwardHeaders = body.get("headers", "")
    
    db.commit()
    
    return {"success": True}


# 兼容旧版本 - 从main.py导入并注入配置
def init_from_main(
    get_sync_client,
    get_shared_executor,
    ensure_device_ip_allowed_raise,
    is_target_device,
    get_device_data,
    get_wifi_info_fn,
    read_device_config_fn,
    write_device_config_fn,
    device_to_dict,
    device_conn_info,
    upsert_device,
    audit,
    validate_phone,
    validate_sms_content,
    sms_limiter,
    dial_limiter,
    ota_limiter,
    client_ip,
    check_login_credentials,
):
    inject(
        get_sync_client=get_sync_client,
        get_shared_executor=get_shared_executor,
        ensure_device_ip_allowed_raise=ensure_device_ip_allowed_raise,
        is_target_device=is_target_device,
        get_device_data=get_device_data,
        get_wifi_info_fn=get_wifi_info_fn,
        read_device_config_fn=read_device_config_fn,
        write_device_config_fn=write_device_config_fn,
        device_to_dict=device_to_dict,
        device_conn_info=device_conn_info,
        upsert_device=upsert_device,
        audit=audit,
        validate_phone=validate_phone,
        validate_sms_content=validate_sms_content,
        sms_limiter=sms_limiter,
        dial_limiter=dial_limiter,
        ota_limiter=ota_limiter,
        client_ip=client_ip,
        check_login_credentials=check_login_credentials,
    )