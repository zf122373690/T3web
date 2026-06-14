"""设备工具函数 - 解决循环导入问题.

Windows/Linux兼容.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.device_client import getdevicedata
from backend.database import Device


def _bm_op_from_sta(sta: str) -> str:
    return (sta or "").strip()


def _device_to_dict(device: Device) -> Dict[str, Any]:
    return {
        "id": device.id,
        "devId": device.devId or "",
        "alias": device.alias or "",
        "grp": device.grp or "auto",
        "ip": device.ip,
        "mac": device.mac or "",
        "status": device.status or "unknown",
        "lastSeen": device.lastSeen or 0,
        "created": device.created or "",
        "firmwareVersion": getattr(device, "firmware_version", "") or "",
        "sims": {
            "sim1": {"number": device.sim1number or "", "operator": device.sim1operator or "", "signal": device.sim1signal or 0, "label": device.sim1number or device.sim1operator or "SIM"},
            "sim2": {"number": device.sim2number or "", "operator": device.sim2operator or "", "signal": device.sim2signal or 0, "label": device.sim2number or device.sim2operator or "SIM"},
        },
        "forward": {
            "enabled": bool(device.forwardEnabled),
            "url": device.forwardUrl or "",
            "method": device.forwardMethod or "POST",
            "headers": device.forwardHeaders or "",
        },
        "wifiName": "",
        "wifiDbm": "",
    }


def upsertdevice(db: Session, ip: str, mac: str, user: str, pw: str, grp: Optional[str] = None) -> Dict[str, Any]:
    """更新或插入设备"""
    data = getdevicedata(ip, user, pw) or {}
    devid = (data.get("DEV_ID") or "").strip() or None
    sim1num = (data.get("SIM1_PHNUM") or "").strip()
    sim2num = (data.get("SIM2_PHNUM") or "").strip()
    sim1op = (data.get("SIM1_OP") or "").strip() or _bm_op_from_sta(data.get("SIM1_STA") or "")
    sim2op = (data.get("SIM2_OP") or "").strip() or _bm_op_from_sta(data.get("SIM2_STA") or "")
    sim1sig = int(data.get("SIM1_SIGNAL") or 0)
    sim2sig = int(data.get("SIM2_SIGNAL") or 0)
    fw_ver = (data.get("DEV_VER") or "").strip()
    mac = (mac or "").strip().upper() or None

    device: Optional[Device] = None
    if devid:
        device = db.query(Device).filter(Device.devId == devid).first()
    if not device and mac:
        device = db.query(Device).filter(Device.mac == mac).first()
    if not device:
        device = db.query(Device).filter(Device.ip == ip).first()

    if device and device.ip != ip:
        other = db.query(Device).filter(Device.ip == ip).first()
        if other and other.id != device.id:
            from backend.database import nowts
            other.ip = f"__stale_{other.id}_{nowts()}"
            try:
                db.flush()
            except Exception:
                db.rollback()
                return _device_to_dict(device)

    from datetime import datetime
    
    if device:
        device.devId = devid if devid else device.devId
        if grp is not None and str(grp).strip():
            device.grp = grp
        device.ip = ip
        device.mac = mac if mac else (device.mac or None)
        device.user = user
        device.passwd = pw
        device.status = "online"
        device.lastSeen = nowts()
        device.sim1number = sim1num
        device.sim1operator = sim1op
        device.sim1signal = sim1sig
        device.sim2number = sim2num
        device.sim2operator = sim2op
        device.sim2signal = sim2sig
        if fw_ver:
            device.firmware_version = fw_ver
    else:
        from backend.database import nowts
        device = Device(
            devId=devid, grp=(grp if grp is not None and str(grp).strip() else "auto"),
            ip=ip, mac=mac, user=user, passwd=pw, status="online", lastSeen=nowts(),
            sim1number=sim1num, sim1operator=sim1op, sim1signal=sim1sig,
            sim2number=sim2num, sim2operator=sim2op, sim2signal=sim2sig,
            firmware_version=fw_ver,
            created=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )
        db.add(device)

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        return {"ip": ip, "error": f"数据库写入失败: {exc}"}
    db.refresh(device)
    return _device_to_dict(device)


def listdevices(db: Session) -> List[Dict[str, Any]]:
    devices = db.query(Device).order_by(Device.created.desc(), Device.id.desc()).all()
    return [_device_to_dict(d) for d in devices]