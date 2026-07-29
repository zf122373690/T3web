from __future__ import annotations

import ipaddress
import json
import subprocess
import re
import socket
import time
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


def _private_lan_score(ip: str, has_gateway: bool = False) -> int:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return -1
    if not addr.is_private or addr.is_loopback or addr.is_link_local:
        return -1
    if ip.startswith("198.18.") or ip.startswith("169.254."):
        return -1
    score = 10 if has_gateway else 0
    if ip.startswith("192.168."):
        score += 40
    elif ip.startswith("172."):
        second = int(ip.split(".")[1])
        if 16 <= second <= 31:
            score += 35
        else:
            return -1
    elif ip.startswith("10."):
        score += 20
    else:
        return -1
    return score


def guess_ipv4_cidr() -> str:
    scored: list[tuple[int, str]] = []
    seen: set[str] = set()

    def add_candidate(ip: str, has_gateway: bool = False) -> None:
        if ip in seen:
            return
        score = _private_lan_score(ip, has_gateway=has_gateway)
        if score < 0:
            return
        seen.add(ip)
        scored.append((score, ip))

    try:
        output = subprocess.check_output(["ipconfig"], text=True, encoding="gbk", errors="ignore")
        blocks = re.split(r"\r?\n\r?\n", output)
        for block in blocks:
            lower = block.lower()
            if "media disconnected" in lower or "媒体已断开" in block:
                continue
            ip_match = re.search(r"(?:IPv4 Address|IPv4 地址)[^:：]*[:：]\s*([0-9.]+)", block, re.IGNORECASE)
            if not ip_match:
                continue
            gateway_match = re.search(r"(?:Default Gateway|默认网关)[^:：]*[:：]\s*([0-9.]+)", block, re.IGNORECASE)
            has_gateway = bool(gateway_match and gateway_match.group(1))
            add_candidate(ip_match.group(1), has_gateway=has_gateway)
    except Exception:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            add_candidate(sock.getsockname()[0], has_gateway=True)
    except OSError:
        pass

    try:
        hostname = socket.gethostname()
        for item in socket.getaddrinfo(hostname, None, socket.AF_INET):
            add_candidate(item[4][0], has_gateway=False)
    except OSError:
        pass

    scored.sort(key=lambda item: item[0], reverse=True)
    ip = scored[0][1] if scored else "192.168.1.1"
    parts = ip.split(".")
    return f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"


def guess_ipv4_prefix() -> dict[str, str]:
    cidr = guess_ipv4_cidr()
    network = cidr.split("/", 1)[0]
    parts = network.split(".")
    prefix = f"{parts[0]}.{parts[1]}.{parts[2]}."
    return {"cidr": cidr, "prefix": prefix, "network": network}


def is_target_device(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> tuple[bool, str | None]:
    ensure_private_ip(ip)
    url = f"http://{ip}/mgr"
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=False, trust_env=False) as client:
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


def _pick_text(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text and text.lower() not in {"none", "null", "undefined"}:
            return text
    return ""


def _pick_bool(*values: Any, default: bool = False) -> bool:
    for value in values:
        if value is None:
            continue
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        text = str(value).strip().lower()
        if text in {"1", "true", "yes", "y", "on", "ok", "ready"}:
            return True
        if text in {"0", "false", "no", "n", "off", "na", "none", "null", ""}:
            return False
    return default


def _as_signal(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text and text.lower() not in {"none", "null"}:
            return text
    return ""


def _enrich_board_sim_fields(data: dict[str, Any]) -> dict[str, Any]:
    """对齐 lvyou：把 /mgr 返回的 SIM1_PHNUM/OP/STA/SIGNAL 补齐 present/registered。"""
    out = dict(data or {})
    for slot in (1, 2):
        number = _pick_text(out.get(f"SIM{slot}_PHNUM"))
        operator = _pick_text(out.get(f"SIM{slot}_OP"), out.get(f"SIM{slot}_STA"))
        signal = _as_signal(out.get(f"SIM{slot}_SIGNAL"))
        present_key = f"SIM{slot}_PRESENT"
        registered_key = f"SIM{slot}_REGISTERED"
        if present_key not in out:
            out[present_key] = bool(number or operator or signal)
        else:
            out[present_key] = _pick_bool(out.get(present_key), default=bool(number or operator))
        if registered_key not in out:
            # 经典板卡没有独立注册字段，有运营商/信号时视为已附着
            out[registered_key] = bool(operator or (signal and signal not in {"0", "-"}))
        else:
            out[registered_key] = _pick_bool(out.get(registered_key), default=False)
        out[f"SIM{slot}_PHNUM"] = number
        out[f"SIM{slot}_OP"] = operator
        out[f"SIM{slot}_SIGNAL"] = signal
    return out


def get_device_data(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    ensure_private_ip(ip)
    keys = [
        "DEV_ID",
        "DEV_VER",
        "SIM1_PHNUM",
        "SIM2_PHNUM",
        "SIM1_OP",
        "SIM2_OP",
        "SIM1_STA",
        "SIM2_STA",
        "SIM1_SIGNAL",
        "SIM2_SIGNAL",
        "WIFI_NAME",
        "WIFI_DBM",
        "MAC",
    ]
    body = f"keys={json.dumps({'keys': keys}, ensure_ascii=False)}"
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, trust_env=False) as client:
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
            return _enrich_board_sim_fields(payload["data"])
    except Exception:
        return {}
    return {}


def _normalize_lan_status(payload: dict[str, Any]) -> dict[str, Any]:
    modem = payload.get("modem") if isinstance(payload.get("modem"), dict) else {}
    wifi = payload.get("wifi") if isinstance(payload.get("wifi"), dict) else {}

    sim1_number = _pick_text(payload.get("n1"), modem.get("sim1_number"))
    sim2_number = _pick_text(payload.get("n2"), modem.get("sim2_number"))
    sim1_op = _pick_text(payload.get("o1"), modem.get("sim1_operator"))
    sim2_op = _pick_text(payload.get("o2"), modem.get("sim2_operator"))
    signal = _as_signal(payload.get("s"), modem.get("signal_dbm"))
    sim1_iccid = _pick_text(modem.get("sim1_iccid"))
    sim2_iccid = _pick_text(modem.get("sim2_iccid"))

    sim1_present = _pick_bool(
        payload.get("p1") if "p1" in payload else None,
        modem.get("sim1_present"),
        default=bool(sim1_number or sim1_op or sim1_iccid),
    )
    sim2_present = _pick_bool(
        payload.get("p2") if "p2" in payload else None,
        modem.get("sim2_present"),
        default=bool(sim2_number or sim2_op or sim2_iccid),
    )
    sim1_registered = _pick_bool(
        payload.get("r1") if "r1" in payload else None,
        modem.get("sim1_cs_registered"),
        modem.get("sim1_ps_registered"),
        modem.get("sim1_eps_registered"),
        default=False,
    )
    sim2_registered = _pick_bool(
        payload.get("r2") if "r2" in payload else None,
        modem.get("sim2_cs_registered"),
        modem.get("sim2_ps_registered"),
        modem.get("sim2_eps_registered"),
        default=False,
    )

    return {
        "DEV_ID": _pick_text(
            payload.get("n"), payload.get("deviceName"), payload.get("device_name"),
            payload.get("deviceId"), payload.get("device_id"), payload.get("m"), payload.get("mac"),
        ),
        "DEV_VER": _pick_text(payload.get("v"), payload.get("version")),
        "SIM1_PHNUM": sim1_number,
        "SIM2_PHNUM": sim2_number,
        "SIM1_OP": sim1_op,
        "SIM2_OP": sim2_op,
        "SIM1_SIGNAL": signal,
        "SIM2_SIGNAL": signal,
        "SIM1_PRESENT": sim1_present,
        "SIM2_PRESENT": sim2_present,
        "SIM1_REGISTERED": sim1_registered,
        "SIM2_REGISTERED": sim2_registered,
        "SIM1_ICCID": sim1_iccid,
        "SIM2_ICCID": sim2_iccid,
        "WIFI_NAME": _pick_text(payload.get("w"), wifi.get("ssid")),
        "WIFI_DBM": _as_signal(payload.get("r"), wifi.get("rssi")),
        "MAC": _pick_text(payload.get("m"), payload.get("mac")),
        "LAN_KEY": True,
        "raw": payload,
    }


def status_payload_to_raw(data: dict[str, Any], fallback_name: str = "", fallback_mac: str = "") -> dict[str, Any]:
    """把 /api/status 响应整理成与 /l/d 一致的 raw_json 结构。"""
    if not isinstance(data, dict):
        return {}
    modem = data.get("modem") if isinstance(data.get("modem"), dict) else {}
    wifi = data.get("wifi") if isinstance(data.get("wifi"), dict) else {}
    compact = {
        "n": _pick_text(data.get("deviceName"), data.get("n"), fallback_name),
        "v": _pick_text(data.get("version"), data.get("v")),
        "m": _pick_text(data.get("mac"), fallback_mac),
        "w": _pick_text(wifi.get("ssid"), data.get("w")),
        "r": wifi.get("rssi", data.get("r")),
        "s": modem.get("signal_dbm", data.get("s")),
        "n1": modem.get("sim1_number", data.get("n1")),
        "n2": modem.get("sim2_number", data.get("n2")),
        "o1": modem.get("sim1_operator", data.get("o1")),
        "o2": modem.get("sim2_operator", data.get("o2")),
        "p1": modem.get("sim1_present", data.get("p1")),
        "p2": modem.get("sim2_present", data.get("p2")),
        "r1": bool(
            modem.get("sim1_cs_registered")
            or modem.get("sim1_ps_registered")
            or modem.get("sim1_eps_registered")
            or data.get("r1")
        ),
        "r2": bool(
            modem.get("sim2_cs_registered")
            or modem.get("sim2_ps_registered")
            or modem.get("sim2_eps_registered")
            or data.get("r2")
        ),
        "modem": modem,
        "wifi": wifi,
        "p": "T3C3",
    }
    return _normalize_lan_status(compact)


def _parse_lan_payload(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    if payload.get("p") != "T3C3" and payload.get("product") != "T3-ESP32-C3-SMS":
        return None
    if "p" not in payload and payload.get("lanControl") is not True:
        return None
    return _normalize_lan_status(payload)


def lan_discover_device(
    ip: str,
    key: str = LAN_DEVICE_KEY,
    *,
    retries: int = 1,
    timeout: float | None = None,
) -> dict[str, Any] | None:
    """设备发现协议：只读 /l/d。短超时 + 轻量重试。"""
    ensure_private_ip(ip)
    request_timeout = timeout if timeout is not None else min(float(HTTP_TIMEOUT), 2.5)
    attempts = max(1, int(retries) + 1)
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with httpx.Client(timeout=request_timeout, trust_env=False) as client:
                resp = client.get(f"http://{ip}/l/d", params={"key": key})
            if resp.status_code == 200:
                parsed = _parse_lan_payload(resp.json())
                if parsed is not None:
                    return parsed
                last_error = RuntimeError("invalid lan payload")
            else:
                last_error = RuntimeError(f"HTTP {resp.status_code}")
            time.sleep(0.05 * (attempt + 1))
            continue
        except Exception as exc:
            last_error = exc
            time.sleep(0.06 * (attempt + 1))
            continue
    _ = last_error
    return None



def _parse_device_response(resp: httpx.Response) -> dict[str, Any]:
    try:
        data = resp.json()
    except ValueError:
        data = {"text": resp.text}
    if isinstance(data, dict):
        message = str(data.get("message") or data.get("msg") or data.get("error") or f"HTTP {resp.status_code}")
        if resp.status_code < 200 or resp.status_code >= 300:
            return {"ok": False, "message": message, "statusCode": resp.status_code, "data": data}
        success = data.get("success")
        ok = bool(success) if success is not None else True
        return {"ok": ok, "message": message, "data": data}
    if resp.status_code < 200 or resp.status_code >= 300:
        return {"ok": False, "message": f"HTTP {resp.status_code}", "statusCode": resp.status_code, "data": data}
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
    """
    统一设备请求函数：
      1. 优先用 LAN Key 认证（query 参数 key + header X-T3-LAN-Key）
      2. 失败回退 Digest Auth
    固件 /api/* 接口同时支持这两种认证方式
    """
    ensure_private_ip(ip)
    request_params = dict(params or {})
    request_params.setdefault("key", LAN_DEVICE_KEY)
    try:
        with httpx.Client(timeout=timeout or HTTP_TIMEOUT, trust_env=False) as client:
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
            # LAN Key 失败，回退 Digest Auth
            legacy_resp = client.request(
                method,
                f"http://{ip}{path}",
                params=params,
                json=json_body,
                auth=httpx.DigestAuth(user, password),
            )
        legacy_result = _parse_device_response(legacy_resp)
        if not legacy_result.get("ok") and legacy_result.get("statusCode") in (401, 403):
            legacy_result["message"] = f"{legacy_result.get('message')}，设备认证失败"
        return legacy_result
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
    result = _request_device(
        ip,
        user,
        password,
        "POST",
        "/api/sms/send",
        json_body={"phone": phone, "msg": content, "slot": sim_slot},
        timeout=max(HTTP_TIMEOUT, 8),
    )
    if not result.get("ok") or not result.get("data", {}).get("accepted"):
        result["endpoint"] = "/api/sms/send"
        return result
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        time.sleep(1)
        status = _request_device(
            ip,
            user,
            password,
            "GET",
            "/api/sms/status",
            timeout=max(HTTP_TIMEOUT, 5),
        )
        if not status.get("ok") and not status.get("data"):
            status["endpoint"] = "/api/sms/status"
            return status
        data = status.get("data", {})
        if data.get("done"):
            return {
                "ok": bool(data.get("success")),
                "message": str(data.get("message") or "短信发送失败"),
                "data": data,
                "endpoint": "/api/sms/status",
            }
    return {"ok": False, "message": "短信发送超时，设备仍未返回最终结果", "data": {}, "endpoint": "/api/sms/status"}


def set_device_flymode(
    ip: str,
    user: str = DEVICE_USER,
    password: str = DEVICE_PASS,
    enabled: bool = False,
) -> dict[str, Any]:
    """飞行模式通过 AT 指令实现"""
    at_cmd = "AT+CFUN=0" if enabled else "AT+CFUN=1"
    result = _request_device(
        ip, user, password, "POST", "/api/at",
        json_body={"cmd": at_cmd, "timeout": 12000},
        timeout=HTTP_TIMEOUT + 5,
    )
    result["endpoint"] = "/api/at"

    # 关闭飞行模式后验证
    if not enabled and result.get("ok"):
        check = _request_device(
            ip, user, password, "POST", "/api/at",
            json_body={"cmd": "AT+CFUN?", "timeout": 3000},
        )
        response = str((check.get("data") or {}).get("response", ""))
        if "+CFUN: 1" in response or "+CFUN:1" in response:
            return {"ok": True, "message": "网络已恢复", "endpoint": "/api/at", "data": check.get("data", {})}
        # 再试一次完整重启
        result = _request_device(
            ip, user, password, "POST", "/api/at",
            json_body={"cmd": "AT+CFUN=1,1", "timeout": 15000},
        )
        result["endpoint"] = "/api/at"
    return result


def reboot_device(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/reboot")
    result["endpoint"] = "/api/reboot"
    return result


def get_t3_status(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/status")
    result["endpoint"] = "/api/status"
    return result


def _unwrap_config_payload(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    nested = data.get("data")
    if isinstance(nested, dict):
        if isinstance(nested.get("config"), dict):
            return nested["config"]
        return nested
    if isinstance(data.get("config"), dict):
        return data["config"]
    return data


def get_t3_config(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/config")
    result["endpoint"] = "/api/config"
    if result.get("ok"):
        result["data"] = _unwrap_config_payload(result.get("data"))
    return result


def update_t3_config(ip: str, config: dict[str, Any], user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/config", json_body=config)
    result["endpoint"] = "/api/config"
    return result


def set_t3_wifi(ip: str, ssid: str, password: str = "") -> dict[str, Any]:
    ensure_private_ip(ip)
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, trust_env=False) as client:
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
    result = _request_device(
        ip, user, password, "POST", "/api/at",
        json_body={"cmd": command, "timeout": timeout_ms},
        timeout=max(HTTP_TIMEOUT, timeout_ms / 1000 + 2),
    )
    result["endpoint"] = "/api/at"
    return result


def factory_reset_t3(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/factory_reset")
    result["endpoint"] = "/api/factory_reset"
    return result


def get_t3_messages(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/messages", params={"type": "all"})
    result["endpoint"] = "/api/messages"
    if result.get("ok"):
        data = result.get("data")
        nested = data.get("data") if isinstance(data, dict) else None
        if isinstance(nested, dict):
            data = nested
        if isinstance(data, dict):
            messages = data.get("messages")
            result["data"] = messages if isinstance(messages, list) else []
        elif isinstance(data, list):
            result["data"] = data
        else:
            result["data"] = []
    return result


def clear_device_messages(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/messages/clear")
    result["endpoint"] = "/api/messages/clear"
    return result


def check_t3_ota(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/ota/check")
    result["endpoint"] = "/api/ota/check"
    return result


def start_t3_ota(ip: str, url: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/ota/start", params={"url": url}, timeout=HTTP_TIMEOUT + 20)
    result["endpoint"] = "/api/ota/start"
    return result


def diag_t3(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    """原始诊断：依次执行 6 条 AT 指令并返回原始响应。"""
    result = _request_device(ip, user, password, "GET", "/api/diag", timeout=max(HTTP_TIMEOUT, 45))
    result["endpoint"] = "/api/diag"
    return result


def push_test_t3(ip: str, channel: int | None = None, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    """测试单个推送通道（channel 缺省为 -1，由固件按配置选择）。"""
    body: dict[str, Any] = {}
    if channel is not None:
        body["channel"] = channel
    result = _request_device(ip, user, password, "POST", "/api/push/test", json_body=body or None, timeout=max(HTTP_TIMEOUT, 20))
    result["endpoint"] = "/api/push/test"
    return result


def ddns_status_t3(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/ddns/status", timeout=max(HTTP_TIMEOUT, 12))
    result["endpoint"] = "/api/ddns/status"
    return result


def ddns_update_t3(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "POST", "/api/ddns/update", timeout=max(HTTP_TIMEOUT, 35))
    result["endpoint"] = "/api/ddns/update"
    return result


def ota_progress_t3(ip: str, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict[str, Any]:
    result = _request_device(ip, user, password, "GET", "/api/ota/progress", timeout=max(HTTP_TIMEOUT, 12))
    result["endpoint"] = "/api/ota/progress"
    return result

