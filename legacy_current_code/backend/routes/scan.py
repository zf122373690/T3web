"""局域网扫描路由.

Windows/Linux兼容: 扫描内网中的ESP32-C3设备.
"""

from __future__ import annotations

import ipaddress
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from backend.config import (
    CONCURRENCY,
    SCAN_TTL,
    TCP_CONCURRENCY,
    TCP_TIMEOUT,
)
from backend.database import Device, SessionLocal, get_db, nowts
from backend.device_client import istargetdevice
from backend.http_client import get_shared_executor
from backend.device_utils import _device_to_dict, upsertdevice
from backend.security import (
    guess_ipv4_cidr,
    prewarm_neighbors,
    tcp_port_open,
)

logger = logging.getLogger("sms-forwarder")

router = APIRouter(prefix="/api", tags=["scan"])

# 扫描状态注册表
_active_scans: Dict[str, Dict[str, Any]] = {}


# 依赖注入配置
_config: Dict[str, Any] = {}


def inject(**kwargs) -> None:
    global _config
    _config.update(kwargs)


class ScanState:
    """扫描状态"""
    def __init__(self, scan_id: str, cidr: str, total: int):
        self.scan_id = scan_id
        self.cidr = cidr
        self.total = total
        self.found = 0
        self.failed = 0
        self.pending = total
        self.started = time.time()
        self.expires = self.started + SCAN_TTL
        self.results: List[Dict[str, Any]] = []
        self._lock = __import__("threading").Lock()
    
    def add_result(self, ip: str, success: bool, data: Optional[Dict] = None):
        with self._lock:
            if success:
                self.found += 1
                self.results.append({"ip": ip, "success": True, "data": data or {}})
            else:
                self.failed += 1
                self.results.append({"ip": ip, "success": False})
            self.pending -= 1
    
    def to_dict(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "id": self.scan_id,
                "cidr": self.cidr,
                "total": self.total,
                "found": self.found,
                "failed": self.failed,
                "pending": self.pending,
                "elapsed": time.time() - self.started,
                "expires": self.expires,
                "results": self.results.copy(),
            }


def _scan_worker(ip: str, user: str, pw: str, scan_state: ScanState):
    """扫描单个IP的工作函数"""
    try:
        # 首先检查80端口是否开放
        if not tcp_port_open(ip, 80, TCP_TIMEOUT):
            scan_state.add_result(ip, False)
            return
        
        # 尝试认证
        ok, realm = istargetdevice(ip, user, pw)
        if ok:
            # 获取设备数据
            from backend.device_client import getdevicedata
            data = getdevicedata(ip, user, pw)
            scan_state.add_result(ip, True, data)
        else:
            scan_state.add_result(ip, False)
    except Exception as e:
        logger.debug("scan worker failed for %s: %s", ip, e)
        scan_state.add_result(ip, False)


@router.post("/scan")
async def start_scan(request: Request, db: Session = Depends(get_db)):
    """开始局域网扫描"""
    body = await request.json()
    cidr = body.get("cidr", "").strip()
    user = (body.get("user") or "admin").strip()
    pw = (body.get("password") or "admin").strip()
    
    # 如果没有指定CIDR，自动猜测
    if not cidr:
        cidr = guess_ipv4_cidr()
    
    # 解析CIDR
    try:
        net = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的CIDR格式")
    
    # 限制扫描范围
    if net.num_addresses > 1024:
        raise HTTPException(status_code=400, detail="扫描范围过大，最多支持1024个IP")
    
    # 创建扫描任务
    scan_id = f"scan_{int(time.time() * 1000)}"
    scan_state = ScanState(scan_id, cidr, net.num_addresses)
    _active_scans[scan_id] = scan_state
    
    # 预热邻居缓存
    try:
        prewarm_neighbors(cidr)
    except Exception:
        pass
    
    # 获取线程池
    executor = get_shared_executor()
    
    # 提交扫描任务
    for ip in net:
        executor.submit(_scan_worker, str(ip), user, pw, scan_state)
    
    return {
        "scanId": scan_id,
        "cidr": cidr,
        "total": net.num_addresses,
    }


@router.get("/scan/{scan_id}")
def get_scan_status(scan_id: str):
    """获取扫描状态"""
    scan_state = _active_scans.get(scan_id)
    if not scan_state:
        raise HTTPException(status_code=404, detail="扫描任务不存在")
    
    # 检查是否过期
    if time.time() > scan_state.expires:
        del _active_scans[scan_id]
        raise HTTPException(status_code=404, detail="扫描任务已过期")
    
    return scan_state.to_dict()


@router.post("/scan/{scan_id}/results")
async def get_scan_results(scan_id: str, request: Request, db: Session = Depends(get_db)):
    """获取扫描结果并保存到数据库"""
    scan_state = _active_scans.get(scan_id)
    if not scan_state:
        raise HTTPException(status_code=404, detail="扫描任务不存在")
    
    # 等待扫描完成
    while scan_state.pending > 0 and time.time() < scan_state.expires:
        time.sleep(0.5)
    
    # 获取成功的结果
    body = await request.json()
    user = (body.get("user") or "admin").strip()
    pw = (body.get("password") or "admin").strip()
    
    saved_devices = []
    for result in scan_state.results:
        if result.get("success"):
            ip = result["ip"]
            data = result.get("data", {})
            mac = data.get("MAC", "")
            try:
                device = upsertdevice(db, ip, mac, user, pw)
                saved_devices.append(device)
            except Exception as e:
                logger.warning("save device %s failed: %s", ip, e)
    
    return {
        "total": scan_state.total,
        "found": scan_state.found,
        "saved": len(saved_devices),
        "devices": saved_devices,
    }


@router.get("/scan")
def get_active_scans():
    """获取当前活跃的扫描任务"""
    result = []
    now = time.time()
    expired = []
    
    for scan_id, state in _active_scans.items():
        if now > state.expires:
            expired.append(scan_id)
        else:
            result.append({
                "id": scan_id,
                "cidr": state.cidr,
                "total": state.total,
                "found": state.found,
                "pending": state.pending,
                "elapsed": now - state.started,
            })
    
    # 清理过期的扫描
    for scan_id in expired:
        del _active_scans[scan_id]
    
    return {"scans": result}


def cleanup_old_scans():
    """清理过期的扫描任务"""
    now = time.time()
    expired = [scan_id for scan_id, state in _active_scans.items() if now > state.expires]
    for scan_id in expired:
        del _active_scans[scan_id]
    if expired:
        logger.info("cleaned %d expired scans", len(expired))


# 兼容旧版本 - 从main.py导入并注入配置
def init_from_main(
    guessipv4cidr,
    prewarm_neighbors,
    getarptable,
    tcp_port_open,
    get_shared_executor,
    is_target_device,
    ensure_device_ip_allowed_raise,
    upsert_device,
    audit,
):
    inject(
        guess_ipv4_cidr=guessipv4cidr,
        prewarm_neighbors=prewarm_neighbors,
        get_arp_table=getarptable,
        tcp_port_open=tcp_port_open,
        get_shared_executor=get_shared_executor,
        is_target_device=is_target_device,
        ensure_device_ip_allowed_raise=ensure_device_ip_allowed_raise,
        upsert_device=upsert_device,
        audit=audit,
    )