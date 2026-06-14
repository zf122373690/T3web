"""短信路由.

Windows/Linux兼容: 短信发送/转发/接收(Webhook).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import SMS_MAX_LEN
from backend.database import Device, SmsRecord, get_db, nowts
from backend.device_client import send_sms_to_device
from backend.ratelimit import RateLimiter

logger = logging.getLogger("sms-forwarder")

router = APIRouter(prefix="/api", tags=["sms"])

# 短信限流器
_sms_limiter = RateLimiter("sms", 10, 60.0)
_dial_limiter = RateLimiter("dial", 5, 60.0)

# 依赖注入配置
_config: Dict[str, Any] = {}


def inject(**kwargs) -> None:
    global _config
    _config.update(kwargs)


def _validate_phone(phone: str) -> str:
    """验证手机号"""
    import re
    PHONE_RE = re.compile(r"^\+?[0-9]{5,15}$")
    p = (phone or "").strip()
    if not p or not PHONE_RE.match(p):
        raise HTTPException(status_code=400, detail="手机号格式不正确")
    return p


def _validate_sms_content(content: str) -> str:
    """验证短信内容"""
    c = (content or "").strip()
    if not c:
        raise HTTPException(status_code=400, detail="短信内容不能为空")
    if len(c) > SMS_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"短信内容超出长度限制（最多{SMS_MAX_LEN}字）")
    return c


# --- Webhook模型 ---
class SmsWebhookPayload(BaseModel):
    """接收设备转发的短信Webhook payload"""
    schema: str = "sms-forwarder.v1"
    event: str = "sms"  # sms/call/system
    type: int = 501
    devId: str = ""
    device: str = ""
    title: str = ""
    slot: int = 1
    sender: str = ""  # 来信号码
    message: str = ""  # 短信内容
    timestamp: str = ""  # 时间戳
    phNum: str = ""  # 兼容字段
    smsBd: str = ""  # 兼容字段
    smsTs: str = ""  # 兼容字段
    sim: dict = {}


@router.post("/sms/send")
async def send_sms(request: Request, db: Session = Depends(get_db)):
    """发送短信"""
    body = await request.json()
    
    device_id = body.get("deviceId")
    phone = _validate_phone(body.get("phone", ""))
    content = _validate_sms_content(body.get("content", ""))
    sim_slot = int(body.get("sim", 1))  # 1=SIM1, 2=SIM2
    
    if not device_id:
        raise HTTPException(status_code=400, detail="设备ID不能为空")
    
    # 获取设备
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    # 速率限制
    if not _sms_limiter.is_allowed(str(device_id)):
        raise HTTPException(status_code=429, detail="短信发送过于频繁，请稍后再试")
    
    # 发送短信
    user = (device.user or "admin").strip()
    pw = (device.passwd or "admin").strip()
    
    result = send_sms_to_device(device.ip, user, pw, phone, content, sim_slot)
    
    # 记录短信
    sms_record = SmsRecord(
        device_id=device_id,
        sim_slot=sim_slot,
        sender=phone,
        content=content,
        received_at=nowts(),
        forwarded=1 if result.get("ok") else 0,
        forward_result=json.dumps(result, ensure_ascii=False),
        created_at=str(nowts()),
    )
    db.add(sms_record)
    db.commit()
    
    return result


@router.post("/sms/sendBatch")
async def send_sms_batch(request: Request, db: Session = Depends(get_db)):
    """批量发送短信"""
    body = await request.json()
    
    device_id = body.get("deviceId")
    messages = body.get("messages", [])
    
    if not device_id:
        raise HTTPException(status_code=400, detail="设备ID不能为空")
    
    if not messages or not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="消息列表不能为空")
    
    if len(messages) > 50:
        raise HTTPException(status_code=400, detail="单次最多发送50条短信")
    
    # 获取设备
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    user = (device.user or "admin").strip()
    pw = (device.passwd or "admin").strip()
    
    results = []
    for msg in messages:
        phone = _validate_phone(msg.get("phone", ""))
        content = _validate_sms_content(msg.get("content", ""))
        sim_slot = int(msg.get("sim", 1))
        
        # 速率限制
        if not _sms_limiter.is_allowed(f"{device_id}_{phone}"):
            results.append({
                "phone": phone,
                "ok": False,
                "error": "发送过于频繁"
            })
            continue
        
        result = send_sms_to_device(device.ip, user, pw, phone, content, sim_slot)
        results.append({
            "phone": phone,
            "ok": result.get("ok", False),
            "message": result.get("message", "")
        })
        
        # 记录
        sms_record = SmsRecord(
            device_id=device_id,
            sim_slot=sim_slot,
            sender=phone,
            content=content,
            received_at=nowts(),
            forwarded=1 if result.get("ok") else 0,
            forward_result=json.dumps(result, ensure_ascii=False),
            created_at=str(nowts()),
        )
        db.add(sms_record)
    
    db.commit()
    
    return {
        "total": len(messages),
        "success": sum(1 for r in results if r.get("ok")),
        "results": results
    }


@router.get("/sms/records")
def get_sms_records(
    request: Request,
    device_id: int = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """获取短信记录"""
    query = db.query(SmsRecord)
    
    if device_id:
        query = query.filter(SmsRecord.device_id == device_id)
    
    total = query.count()
    records = query.order_by(SmsRecord.id.desc()).offset(offset).limit(limit).all()
    
    return {
        "total": total,
        "records": [
            {
                "id": r.id,
                "deviceId": r.device_id,
                "simSlot": r.sim_slot,
                "sender": r.sender,
                "content": r.content,
                "receivedAt": r.received_at,
                "forwarded": r.forwarded,
                "forwardResult": r.forward_result,
                "createdAt": r.created_at,
            }
            for r in records
        ]
    }


@router.get("/sms/stats")
def get_sms_stats(request: Request, db: Session = Depends(get_db)):
    """获取短信统计"""
    # 设备统计
    total_devices = db.query(Device).count()
    online_devices = db.query(Device).filter(Device.status == "online").count()
    
    # 短信统计
    total_sms = db.query(SmsRecord).count()
    forwarded_sms = db.query(SmsRecord).filter(SmsRecord.forwarded == 1).count()
    
    return {
        "devices": {
            "total": total_devices,
            "online": online_devices,
        },
        "sms": {
            "total": total_sms,
            "forwarded": forwarded_sms,
        }
    }


@router.post("/sms/webhook")
async def sms_webhook(
    request: Request,
    db: Session = Depends(get_db),
    payload: SmsWebhookPayload = None
):
    """
    Webhook端点 - 接收设备转发的短信/来电通知
    
    设备端(ESP32-C3)配置:
    - cloudEnabled: true
    - cloudUrl: http://<本服务器IP>:8000/api/sms/webhook
    - cloudToken: (可选)用于验证
    
    接收数据格式 (sms-forwarder.v1):
    {
        "schema": "sms-forwarder.v1",
        "event": "sms" | "call" | "system",
        "type": 501,  // 501=sms, 601=call
        "devId": "设备名称",
        "device": "设备名称",
        "title": "短信通知",
        "slot": 1,  // SIM卡槽
        "sender": "发送者号码",
        "message": "短信内容",
        "timestamp": "2024-01-01 12:00:00",
        "sim": {
            "label": "SIM1",
            "number": "手机号",
            "remark": "备注"
        }
    }
    """
    try:
        # 解析请求体
        if payload is None:
            try:
                body = await request.json()
            except Exception:
                body = {}
        
        # 兼容不同格式
        event = body.get("event", "sms")
        sender = body.get("sender", body.get("phNum", ""))
        message = body.get("message", body.get("smsBd", ""))
        timestamp = body.get("timestamp", body.get("smsTs", ""))
        slot = body.get("slot", 1)
        dev_id = body.get("devId", body.get("device", ""))
        event_type = body.get("type", 501)
        sim_info = body.get("sim", {})
        
        # 查找设备
        device = db.query(Device).filter(Device.name == dev_id).first()
        
        # 记录收到的短信
        sms_record = SmsRecord(
            device_id=device.id if device else None,
            sim_slot=slot,
            sender=sender,
            content=message,
            received_at=timestamp or nowts(),
            forwarded=1,
            forward_result=json.dumps({
                "event": event,
                "type": event_type,
                "sim": sim_info
            }, ensure_ascii=False),
            created_at=str(nowts()),
        )
        db.add(sms_record)
        db.commit()
        
        logger.info(f"收到{slot}卡槽短信: {sender} - {message[:50]}...")
        
        return {"success": True, "message": "短信已接收"}
        
    except Exception as e:
        logger.error(f"Webhook处理失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sms/webhook/call")
async def call_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Webhook端点 - 接收设备转发的来电通知
    """
    try:
        body = await request.json()
        
        event = body.get("event", "call")
        sender = body.get("sender", body.get("phNum", ""))
        timestamp = body.get("timestamp", body.get("telStartTs", ""))
        slot = body.get("slot", 1)
        dev_id = body.get("devId", body.get("device", ""))
        event_type = body.get("type", 601)
        
        # 查找设备
        device = db.query(Device).filter(Device.name == dev_id).first()
        
        # 记录来电
        sms_record = SmsRecord(
            device_id=device.id if device else None,
            sim_slot=slot,
            sender=sender,
            content=f"[来电通知] {sender}",
            received_at=timestamp or nowts(),
            forwarded=1,
            forward_result=json.dumps({
                "event": event,
                "type": event_type
            }, ensure_ascii=False),
            created_at=str(nowts()),
        )
        db.add(sms_record)
        db.commit()
        
        logger.info(f"收到{slot}卡槽来电: {sender}")
        
        return {"success": True, "message": "来电已接收"}
        
    except Exception as e:
        logger.error(f"Call Webhook处理失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 兼容旧版本 - 从main.py导入并注入配置
def init_from_main(
    sms_limiter,
    dial_limiter,
    validate_phone,
    validate_sms_content,
):
    global _sms_limiter, _dial_limiter
    if sms_limiter:
        _sms_limiter = sms_limiter
    if dial_limiter:
        _dial_limiter = dial_limiter
    inject(
        validate_phone=validate_phone,
        validate_sms_content=validate_sms_content,
    )