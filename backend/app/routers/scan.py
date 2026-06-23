from __future__ import annotations

import ipaddress
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, HTTPException, Request

from ..auth import require_user
from ..config import DEVICE_PASS, DEVICE_USER, SCAN_CONCURRENCY, SCAN_TTL_SECONDS
from ..device_client import configure_local_report, guess_ipv4_cidr, lan_discover_device, tcp_open
from .devices import upsert_device

router = APIRouter(prefix="/api/scan", tags=["scan"])

_scans: dict[str, dict] = {}
_lock = threading.Lock()


def _new_scan(cidr: str, total: int) -> dict:
    scan_id = f"scan_{int(time.time() * 1000)}"
    state = {
        "id": scan_id,
        "cidr": cidr,
        "total": total,
        "pending": total,
        "found": 0,
        "failed": 0,
        "done": False,
        "createdAt": time.time(),
        "expiresAt": time.time() + SCAN_TTL_SECONDS,
        "results": [],
    }
    with _lock:
        _scans[scan_id] = state
    return state


def _scan_ip(ip: str, user: str, password: str) -> dict:
    if not tcp_open(ip):
        return {"ip": ip, "success": False, "candidate": False}
    data = lan_discover_device(ip)
    if not data:
        return {"ip": ip, "success": False, "candidate": False, "httpOpen": True}
    report = configure_local_report(ip)
    device = upsert_device(ip, str(data.get("MAC", "")), data)
    return {"ip": ip, "success": True, "candidate": True, "autoSaved": True, "reportConfigured": bool(report.get("ok")), "data": data, "device": device}


def _run_scan(scan_id: str, ips: list[str], user: str, password: str) -> None:
    with ThreadPoolExecutor(max_workers=SCAN_CONCURRENCY) as pool:
        futures = [pool.submit(_scan_ip, ip, user, password) for ip in ips]
        for future in as_completed(futures):
            result = future.result()
            with _lock:
                state = _scans.get(scan_id)
                if not state:
                    return
                state["results"].append(result)
                state["pending"] = max(0, state["pending"] - 1)
                if result.get("success"):
                    state["found"] += 1
                else:
                    state["failed"] += 1
        with _lock:
            if scan_id in _scans:
                _scans[scan_id]["done"] = True


@router.post("")
async def start_scan(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    requested_cidr = str(body.get("cidr") or "").strip()
    cidr = requested_cidr or guess_ipv4_cidr()
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    try:
        network = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        raise HTTPException(status_code=400, detail="CIDR 格式无效")
    ips = [str(ip) for ip in network.hosts()]
    if len(ips) > 1024:
        raise HTTPException(status_code=400, detail="扫描范围过大，最多 1024 个地址")
    state = _new_scan(str(network), len(ips))
    thread = threading.Thread(target=_run_scan, args=(state["id"], ips, user, password), daemon=True)
    thread.start()
    return {"scanId": state["id"], "cidr": state["cidr"], "total": state["total"], "autoDetected": not requested_cidr}


@router.get("/{scan_id}")
def scan_status(scan_id: str, request: Request) -> dict:
    require_user(request)
    with _lock:
        state = _scans.get(scan_id)
        if not state:
            raise HTTPException(status_code=404, detail="扫描任务不存在")
        if state["expiresAt"] < time.time():
            del _scans[scan_id]
            raise HTTPException(status_code=404, detail="扫描任务已过期")
        return dict(state)
