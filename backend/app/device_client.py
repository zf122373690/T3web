from __future__ import annotations

import ipaddress
import json
import subprocess
import re
import socket
from typing import Any

import httpx
from fastapi import HTTPException

from .config import DEVICE_PASS, DEVICE_USER, HTTP_TIMEOUT, LAN_DEVICE_KEY, MESSAGE_INGEST_TOKEN, PUBLIC_BASE_URL, WEB_PORT


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
            resp = client.get(f"http://{ip}/l/d", params={"key": key})
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


def local_base_url_for_device(ip: str) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    ensure_private_ip(ip)
    host = ""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect((ip, 80))
            host = sock.getsockname()[0]
    except OSError:
        pass
    if not host or host.startswith("127."):
        host = guess_ipv4_cidr().split("/")[0]
    parts = host.split(".")
    if len(parts) == 4 and parts[-1] == "0":
        host = ".".join(parts[:3] + ["1"])
    return f"http://{host}:{WEB_PORT}"


def _parse_device_response(resp: httpx.Response) -> dict[str, Any]:
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
    request_params = dict(params or {})
    request_params.setdefault("key", LAN_DEVICE_KEY)
    try:
        with httpx.Client(timeout=timeout or HTTP_TIMEOUT) as client:
            resp = client.request(
                method,
                f"http://{ip}{path}",
                params=request_params,
                json=json_body,
                headers={"X-T3-LAN-Key": LAN_DEVICE_KEY},
            )
            result = _parse_device_response(resp)
            if result.get("ok") or result.get("statusCode") not in (401, 403):
                return result
            legacy_resp = client.request(
                method,
                f"http://{ip}{path}",
                params=params,
                json=json_body,
                auth=httpx.DigestAuth(user, password),
            )
        legacy_result = _parse_device_response(legacy_resp)
        if not legacy_result.get("ok") and legacy_result.get("statusCode") in (401, 403):
            legacy_result["message"] = f"{legacy_result.get('message')}，设备固件可能尚未支持 LAN 密钥接管，请升级固件"
        return legacy_result
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


def configure_local_report(ip: str) -> dict[str, Any]:
    return _request_lan_device(
        ip,
        "POST",
        "/l/c",
        json_body={"u": f"{local_base_url_for_device(ip)}/api/messages/ingest", "k": MESSAGE_INGEST_TOKEN},
        timeout=HTTP_TIMEOUT,
    )


def _request_openapi_sms(
    ip: str,
    user: str,
    password: str,
    phone: str,
    content: str,
    sim_slot: int,
) -> dict[str, Any]:
    ensure_private_ip(ip)
    body = {"phone": phone, "msg": content, "slot": sim_slot}
    auth_modes: list[Any] = [None, httpx.BasicAuth(user, password), httpx.DigestAuth(user, password)]
    last: dict[str, Any] = {"ok": False, "message": "短信发送失败", "data": {}}
    for auth in auth_modes:
        try:
            with httpx.Client(timeout=HTTP_TIMEOUT + 10) as client:
                resp = client.post(f"http://{ip}/api/sms/send", json=body, auth=auth)
            try:
                data = resp.json()
            except ValueError:
                data = {"text": resp.text}
            ok = resp.status_code == 200 and isinstance(data, dict) and bool(data.get("success", True))
            last = {
                "ok": ok,
                "message": str(data.get("message") if isinstance(data, dict) else "") or f"HTTP {resp.status_code}",
                "statusCode": resp.status_code,
                "data": data,
                "endpoint": "/api/sms/send",
            }
            if ok or resp.status_code not in (401, 403):
                return last
        except Exception as exc:
            last = {"ok": False, "message": str(exc), "data": {}, "endpoint": "/api/sms/send"}
    return last


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
        "/l/s",
        json_body={"phone": phone, "msg": content, "slot": sim_slot},
        timeout=HTTP_TIMEOUT + 10,
    )
    if lan_result.get("ok") or lan_result.get("statusCode") not in (404, 405):
        lan_result["endpoint"] = "/l/s"
        return lan_result
    return _request_openapi_sms(ip, user, password, phone, content, sim_slot)


def set_device_flymode(
    ip: str,
    user: str = DEVICE_USER,
    password: str = DEVICE_PASS,
    enabled: bool = False,
) -> dict[str, Any]:
    if enabled:
        at = "AT+CFUN=0"
        lan_result = _request_lan_device(ip, "POST", "/l/a", json_body={"cmd": at, "timeout": 8000})
    else:
        lan_result = _request_lan_device(ip, "POST", "/l/a", json_body={"cmd": "AT+CFUN=1", "timeout": 12000})
        if lan_result.get("ok"):
            check = _request_lan_device(ip, "POST", "/l/a", json_body={"cmd": "AT+CFUN?", "timeout": 3000})
            response = str((check.get("data") or {}).get("response", ""))
            if "+CFUN: 1" in response or "+CFUN:1" in response:
                check["endpoint"] = "/l/a"
                return {"ok": True, "message": "网络已恢复", "endpoint": "/l/a", "data": check.get("data", {})}
            lan_result = _request_lan_device(ip, "POST", "/l/a", json_body={"cmd": "AT+CFUN=1,1", "timeout": 15000})
    if lan_result.get("ok") or lan_result.get("statusCode") not in (404, 405):
        lan_result["endpoint"] = "/l/a"
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
    lan_result = _request_lan_device(ip, "POST", "/l/r")
    if lan_result.get("ok") or lan_result.get("statusCode") not in (404, 405):
        lan_result["endpoint"] = "/l/r"
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


def get_t3_status(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/status")
    result["endpoint"] = "/api/status"
    return result


def get_t3_config(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/config")
    result["endpoint"] = "/api/config"
    return result


def update_t3_config(ip: str, config: dict[str, Any], user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/config", json_body=config)
    result["endpoint"] = "/api/config"
    return result


def set_t3_wifi(ip: str, ssid: str, password: str = "") -> dict[str, Any]:
    ensure_private_ip(ip)
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            resp = client.post(
                f"http://{ip}/api/wifi",
                params={"key": LAN_DEVICE_KEY},
                data={"ssid": ssid, "pass": password},
                headers={"Content-Type": "application/x-www-form-urlencoded", "X-T3-LAN-Key": LAN_DEVICE_KEY},
            )
        ok = 200 <= resp.status_code < 300
        return {"ok": ok, "message": resp.text or ("WiFi 已保存，设备将重新连接 WiFi" if ok else f"HTTP {resp.status_code}"), "statusCode": resp.status_code, "endpoint": "/api/wifi", "data": {"text": resp.text}}
    except Exception as exc:
        return {"ok": False, "message": str(exc), "endpoint": "/api/wifi", "data": {}}


def set_t3_sim_number(ip: str, slot: int, number: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/sim/number", json_body={"slot": slot, "number": number})
    result["endpoint"] = "/api/sim/number"
    return result


def send_t3_at(ip: str, command: str, timeout_ms: int = 1000, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    lan_result = _request_lan_device(ip, "POST", "/l/a", json_body={"cmd": command, "timeout": timeout_ms}, timeout=max(HTTP_TIMEOUT, timeout_ms / 1000 + 2))
    if lan_result.get("ok") or lan_result.get("statusCode") not in (404, 405):
        lan_result["endpoint"] = "/l/a"
        return lan_result
    result = _request_device(ip, user, password, "POST", "/api/openclaw/control", json_body={"command": "at", "cmd": command, "timeout": timeout_ms}, timeout=max(HTTP_TIMEOUT, timeout_ms / 1000 + 2))
    result["endpoint"] = "/api/openclaw/control"
    return result


def factory_reset_t3(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/factory_reset")
    result["endpoint"] = "/api/factory_reset"
    return result


def check_t3_ota(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/ota/check")
    result["endpoint"] = "/api/ota/check"
    return result


def start_t3_ota(ip: str, url: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/ota/start", params={"url": url}, timeout=HTTP_TIMEOUT + 20)
    result["endpoint"] = "/api/ota/start"
    return result
