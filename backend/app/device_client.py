from __future__ import annotations

import ipaddress
import json
import subprocess
import re
import socket
from typing import Any

import httpx
from fastapi import HTTPException

from .config import DEVICE_PASS, DEVICE_USER, HTTP_TIMEOUT, LAN_DEVICE_KEY


def ensure_private_ip(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的 IP 地址")
    if not (addr.is_private or addr.is_loopback):
        raise HTTPException(status_code=400, detail="只允许访问内网设备 IP")
    return str(addr)


def tcp_open(ip: str, port: int = 80, timeout: float = 0.35) -> bool:
    try:
      with socket.create_connection((ip, port), timeout=timeout):
        return True
    except OSError:
      return False


def guess_ipv4_cidr() -> str:
    candidates: list[str] = []
    try:
        output = subprocess.check_output(["ipconfig"], text=True, encoding="gbk", errors="ignore")
        blocks = re.split(r"\r?\n\r?\n", output)
        for block in blocks:
            if "Media disconnected" in block:
                continue
            ip_match = re.search(r"IPv4 Address[^\:]*:\s*([0-9.]+)", block)
            has_gateway = "Default Gateway" in block
            if ip_match and has_gateway:
                ip = ip_match.group(1)
                try:
                    addr = ipaddress.ip_address(ip)
                except ValueError:
                    continue
                if addr.is_private and not ip.startswith("198.18."):
                    candidates.append(ip)
    except Exception:
        pass
    try:
        hostname = socket.gethostname()
        for item in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = item[4][0]
            if ip and not ip.startswith("127.") and not ip.startswith("198.18."):
                try:
                    addr = ipaddress.ip_address(ip)
                except ValueError:
                    continue
                if addr.is_private:
                    candidates.append(ip)
    except OSError:
        pass
    ip = candidates[0] if candidates else "192.168.1.1"
    parts = ip.split(".")
    return f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"


def is_target_device(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> tuple[bool, str | None]:
    ensure_private_ip(ip)
    url = f"http://{ip}/mgr"
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=False) as client:
            resp = client.get(url)
            header = resp.headers.get("www-authenticate", "")
            if resp.status_code != 401 or "Digest" not in header:
                return False, None
            match = re.search(r'realm="([^"]+)"', header)
            realm = match.group(1) if match else None
            if realm != "asyncesp":
                return False, realm
            authed = client.get(url, auth=httpx.DigestAuth(user, password))
            return authed.status_code == 200, realm
    except Exception:
        return False, None


def get_device_data(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    ensure_private_ip(ip)
    keys = [
        "DEV_ID",
        "DEV_VER",
        "SIM1_PHNUM",
        "SIM2_PHNUM",
        "SIM1_OP",
        "SIM2_OP",
        "SIM1_SIGNAL",
        "SIM2_SIGNAL",
        "WIFI_NAME",
        "WIFI_DBM",
        "MAC",
    ]
    body = f"keys={json.dumps({'keys': keys}, ensure_ascii=False)}"
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            resp = client.post(
                f"http://{ip}/mgr",
                params={"a": "getHtmlData_index"},
                auth=httpx.DigestAuth(user, password),
                content=body.encode("utf-8"),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code != 200:
            return {}
        payload = resp.json()
        if isinstance(payload, dict) and payload.get("success") and isinstance(payload.get("data"), dict):
            return payload["data"]
    except Exception:
        return {}
    return {}


def _normalize_lan_status(payload: dict[str, Any]) -> dict[str, Any]:
    modem = payload.get("modem") if isinstance(payload.get("modem"), dict) else {}
    wifi = payload.get("wifi") if isinstance(payload.get("wifi"), dict) else {}
    return {
        "DEV_ID": payload.get("n") or payload.get("deviceName") or payload.get("device_name") or payload.get("deviceId") or payload.get("device_id") or payload.get("m") or payload.get("mac") or "",
        "DEV_VER": payload.get("v") or payload.get("version", ""),
        "SIM1_PHNUM": payload.get("n1") or modem.get("sim1_number", ""),
        "SIM2_PHNUM": payload.get("n2") or modem.get("sim2_number", ""),
        "SIM1_OP": payload.get("o1") or modem.get("sim1_operator", ""),
        "SIM2_OP": payload.get("o2") or modem.get("sim2_operator", ""),
        "SIM1_SIGNAL": str(payload.get("s") or modem.get("signal_dbm", "")),
        "SIM2_SIGNAL": str(payload.get("s") or modem.get("signal_dbm", "")),
        "WIFI_NAME": payload.get("w") or wifi.get("ssid", ""),
        "WIFI_DBM": str(payload.get("r") or wifi.get("rssi", "")),
        "MAC": payload.get("m") or payload.get("mac", ""),
        "LAN_KEY": True,
        "raw": payload,
    }


def lan_discover_device(ip: str, key: str = LAN_DEVICE_KEY) -> dict[str, Any] | None:
    ensure_private_ip(ip)
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            resp = client.get(f"http://{ip}/api/lan/discover", params={"key": key})
        if resp.status_code != 200:
            return None
        payload = resp.json()
        if not isinstance(payload, dict):
            return None
        if payload.get("p") != "T3C3" and payload.get("product") != "T3-ESP32-C3-SMS":
            return None
        if "p" not in payload and payload.get("lanControl") is not True:
            return None
        return _normalize_lan_status(payload)
    except Exception:
        return None


def _request_device(
    ip: str,
    user: str,
    password: str,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    ensure_private_ip(ip)
    try:
        with httpx.Client(timeout=timeout or HTTP_TIMEOUT) as client:
            resp = client.request(
                method,
                f"http://{ip}{path}",
                params=params,
                json=json_body,
                auth=httpx.DigestAuth(user, password),
            )
        if resp.status_code < 200 or resp.status_code >= 300:
            return {"ok": False, "message": f"HTTP {resp.status_code}", "statusCode": resp.status_code, "data": {}}
        try:
            data = resp.json()
        except ValueError:
            data = {"text": resp.text}
        if isinstance(data, dict):
            success = data.get("success")
            ok = bool(success) if success is not None else True
            return {"ok": ok, "message": str(data.get("message") or data.get("msg") or "OK"), "data": data}
        return {"ok": True, "message": "OK", "data": data}
    except Exception as exc:
        return {"ok": False, "message": str(exc), "data": {}}


def _request_lan_device(
    ip: str,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float | None = None,
    key: str = LAN_DEVICE_KEY,
) -> dict[str, Any]:
    params = dict(params or {})
    params["key"] = key
    try:
        with httpx.Client(timeout=timeout or HTTP_TIMEOUT) as client:
            resp = client.request(method, f"http://{ensure_private_ip(ip)}{path}", params=params, json=json_body)
        if resp.status_code < 200 or resp.status_code >= 300:
            return {"ok": False, "message": f"HTTP {resp.status_code}", "statusCode": resp.status_code, "data": {}}
        try:
            data = resp.json()
        except ValueError:
            data = {"text": resp.text}
        if isinstance(data, dict):
            success = data.get("success")
            ok = bool(success) if success is not None else True
            return {"ok": ok, "message": str(data.get("message") or data.get("msg") or "OK"), "data": data}
        return {"ok": True, "message": "OK", "data": data}
    except Exception as exc:
        return {"ok": False, "message": str(exc), "data": {}}


def send_sms_to_device(
    ip: str,
    user: str = DEVICE_USER,
    password: str = DEVICE_PASS,
    phone: str = "",
    content: str = "",
    sim_slot: int = 1,
) -> dict[str, Any]:
    lan_result = _request_lan_device(
        ip,
        "POST",
        "/api/lan/sms/send",
        json_body={"phone": phone, "msg": content, "slot": sim_slot},
        timeout=HTTP_TIMEOUT + 10,
    )
    if lan_result.get("ok") or lan_result.get("statusCode") not in (404, 405):
        lan_result["endpoint"] = "/api/lan/sms/send"
        return lan_result
    result = _request_device(
        ip,
        user,
        password,
        "POST",
        "/api/sms/send",
        params={"phone": phone, "content": content, "sim": sim_slot},
        timeout=HTTP_TIMEOUT + 10,
    )
    result["endpoint"] = "/api/sms/send"
    return result


def set_device_flymode(
    ip: str,
    user: str = DEVICE_USER,
    password: str = DEVICE_PASS,
    enabled: bool = False,
) -> dict[str, Any]:
    at = "AT+CFUN=0" if enabled else "AT+CFUN=1"
    lan_result = _request_lan_device(ip, "POST", "/api/lan/at", json_body={"cmd": at, "timeout": 8000})
    if lan_result.get("ok") or lan_result.get("statusCode") not in (404, 405):
        lan_result["endpoint"] = "/api/lan/at"
        return lan_result
    candidates = [
        ("POST", "/api/device/flymode", None, {"enabled": enabled}),
        ("POST", "/api/serial/flymode", None, {"enabled": enabled}),
        ("POST", "/api/flymode", {"enabled": str(enabled).lower()}, None),
    ]
    last: dict[str, Any] = {"ok": False, "message": "未找到可用的飞行模式接口", "data": {}}
    for method, path, params, body in candidates:
        result = _request_device(ip, user, password, method, path, params=params, json_body=body)
        if result.get("ok"):
            result["endpoint"] = path
            return result
        last = result | {"endpoint": path}
        if result.get("statusCode") not in (404, 405):
            break
    return last


def reboot_device(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    lan_result = _request_lan_device(ip, "POST", "/api/lan/reboot")
    if lan_result.get("ok") or lan_result.get("statusCode") not in (404, 405):
        lan_result["endpoint"] = "/api/lan/reboot"
        return lan_result
    candidates = [
        ("POST", "/api/device/reboot"),
        ("POST", "/api/serial/reboot"),
        ("POST", "/api/reboot"),
        ("GET", "/api/reboot"),
    ]
    last: dict[str, Any] = {"ok": False, "message": "未找到可用的重启接口", "data": {}}
    for method, path in candidates:
        result = _request_device(ip, user, password, method, path)
        if result.get("ok"):
            result["endpoint"] = path
            return result
        last = result | {"endpoint": path}
        if result.get("statusCode") not in (404, 405):
            break
    return last
