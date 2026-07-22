from __future__ import annotations

import json
import asyncio

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

from ..auth import require_user
from ..db import get_token
from ..device_client import set_t3_wifi, update_t3_config
from ..serial_manager import serial_manager

router = APIRouter(prefix="/api/serial", tags=["serial"])


@router.get("/ports")
def list_serial_ports(request: Request) -> dict:
    require_user(request)
    return {"items": serial_manager.list_ports(), "available": serial_manager.status()["available"]}


@router.get("/status")
def serial_status(request: Request, port: str = Query("")) -> dict:
    require_user(request)
    return serial_manager.status(port or None)


@router.get("/logs")
def serial_logs(request: Request, limit: int = Query(200, ge=1, le=500), after: int = Query(0, ge=0), port: str = Query("")) -> dict:
    require_user(request)
    target_port = port or None
    if after:
        return serial_manager.logs_since(after, limit, target_port)
    items = serial_manager.logs(limit, target_port)
    latest_id = max([int(item.get("id", 0)) for item in items], default=0)
    return {"items": items, "latestId": latest_id}


@router.websocket("/ws")
async def serial_websocket(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token", "").strip()
    if not get_token(token):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    latest_id = 0
    try:
        await websocket.send_text(json.dumps({"type": "status", "data": serial_manager.status()}, ensure_ascii=False))
        while True:
            port = websocket.query_params.get("port", "").strip() or None
            payload = serial_manager.logs_since(latest_id, 100, port)
            latest_id = int(payload.get("latestId") or latest_id)
            for item in payload["items"]:
                await websocket.send_text(json.dumps({"type": "log", "data": item}, ensure_ascii=False))
            await websocket.send_text(json.dumps({"type": "status", "data": serial_manager.status(port)}, ensure_ascii=False))
            await asyncio.sleep(0.25)
    except WebSocketDisconnect:
        return


@router.post("/connect")
async def connect_serial(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    result = serial_manager.connect_port(
        str(body.get("port", "")),
        int(body.get("baudrate") or 115200),
        bool(body.get("safeMode", True)),
        body.get("dtr"),
        body.get("rts"),
        bool(body.get("cdcMode", True)),
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message") or "串口连接失败")
    return result


@router.post("/disconnect")
async def disconnect_serial(request: Request) -> dict:
    require_user(request)
    port = request.query_params.get("port", "").strip() or None
    return serial_manager.disconnect_port(port)


@router.post("/send")
async def send_serial_command(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    target_port = str(body.get("port") or "").strip() or None
    result = serial_manager.send_line(str(body.get("command", "")), target_port)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message") or "命令发送失败")
    return result


@router.post("/read-config")
def read_serial_config(request: Request) -> dict:
    require_user(request)
    target_port = request.query_params.get("port", "").strip() or None
    # 等待 ::T3CFGOK（结束标记），而非 ::T3CFGJSON（JSON 可能被串口缓冲拆成多段）
    result = serial_manager.send_and_wait("::T3CFG?", "::T3CFGOK", timeout=5.0, port=target_port)
    if not result.get("success"):
        return {"success": False, "message": result.get("message", "读取配置失败"), "config": {}, "raw": result.get("response", [])}
    # 从所有响应行中提取 JSON 片段并拼接
    all_lines = result.get("response", [])
    json_parts: list[str] = []
    capturing = False
    for line in all_lines:
        if line.startswith("::T3CFGJSON "):
            capturing = True
            json_parts.append(line[len("::T3CFGJSON "):])
            continue
        if line.startswith("::T3CFGOK") or line.startswith("::T3CFGERR"):
            capturing = False
            continue
        if capturing:
            json_parts.append(line)
    if not json_parts:
        return {"success": False, "message": "未找到配置 JSON 响应，请确认固件已支持 ::T3CFG? 命令", "config": {}, "raw": all_lines}
    full_json = "".join(json_parts)
    try:
        config = json.loads(full_json)
        return {"success": True, "message": "设备配置读取成功", "config": config}
    except json.JSONDecodeError as exc:
        return {"success": False, "message": f"配置 JSON 解析失败：{exc}", "config": {}, "raw": all_lines, "jsonHead": full_json[:200]}


def _build_offline_config(body: dict) -> tuple[dict, str, str]:
    config: dict = {}
    device_name = str(body.get("deviceName", "")).strip()
    if device_name:
        config["deviceName"] = device_name
    if body.get("networkMode") is not None and str(body.get("networkMode", "")).strip() != "":
        config["networkMode"] = int(body.get("networkMode") or 0)
    if isinstance(body.get("pushChannels"), list):
        channels = []
        for channel in body.get("pushChannels")[:5]:
            channels.append(channel if isinstance(channel, dict) else {})
        while len(channels) < 5:
            channels.append({})
        config["pushChannels"] = channels
    sim1_pin = str(body.get("sim1Pin", "")).strip()
    sim2_pin = str(body.get("sim2Pin", "")).strip()
    if sim1_pin:
        config["sim1Pin"] = sim1_pin
    if sim2_pin:
        config["sim2Pin"] = sim2_pin
    return config, str(body.get("wifiSsid", "")).strip(), str(body.get("wifiPassword") or "")


def _send_offline_config_to_port(port: str | None, config: dict, wifi_ssid: str, wifi_password: str) -> dict:
    messages: list[str] = []
    config_response: list[str] = []
    success = True
    if config:
        config_json = json.dumps(config, ensure_ascii=False, separators=(",", ":"))
        result = serial_manager.send_and_wait(f"::T3CFG {config_json}", "::T3CFG", timeout=5.0, port=port)
        config_response = result.get("response", [])
        has_error = any("ERR" in response for response in config_response)
        if result.get("success") and not has_error:
            messages.append("配置已写入")
        else:
            success = False
            messages.append("配置写入失败（JSON 解析错误）" if has_error else result.get("message", "配置写入失败"))
    if wifi_ssid:
        wifi_result = serial_manager.send_line(f"::T3WIFI {wifi_ssid},{wifi_password}", port)
        if wifi_result.get("success"):
            messages.append("WiFi 凭证已发送，设备将重新连接 WiFi")
        else:
            success = False
            messages.append(wifi_result.get("message", "WiFi 凭证发送失败"))
    return {"success": success, "message": "；".join(messages), "configResponse": config_response}


@router.post("/offline-config")
async def send_offline_config(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    config, wifi_ssid, wifi_password = _build_offline_config(body)
    if not config and not wifi_ssid:
        raise HTTPException(status_code=400, detail="请至少填写设备名称、WiFi 或通道配置")
    target_port = str(body.get("port") or request.query_params.get("port") or "").strip() or None
    return _send_offline_config_to_port(target_port, config, wifi_ssid, wifi_password)


@router.post("/offline-config/batch")
async def send_batch_offline_config(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    config, wifi_ssid, wifi_password = _build_offline_config(body)
    if not config and not wifi_ssid:
        raise HTTPException(status_code=400, detail="请至少填写设备名称、WiFi 或通道配置")
    raw_ports = body.get("ports", body.get("targetPorts", body.get("port", [])))
    if isinstance(raw_ports, str):
        raw_ports = [raw_ports]
    if not isinstance(raw_ports, list):
        raise HTTPException(status_code=400, detail="ports 参数必须为串口名称数组")
    ports = list(dict.fromkeys(str(port).strip() for port in raw_ports if str(port).strip()))
    if not ports:
        query_port = request.query_params.get("port", "").strip()
        if query_port:
            ports = [query_port]
    if not ports:
        raise HTTPException(status_code=400, detail="请至少选择一个串口")
    results = await asyncio.gather(*(
        asyncio.to_thread(_send_offline_config_to_port, port, config, wifi_ssid, wifi_password)
        for port in ports
    ))
    items = [{"port": port, **result} for port, result in zip(ports, results)]
    succeeded = sum(1 for item in items if item["success"])
    return {
        "success": succeeded == len(items),
        "message": f"批量配置完成：成功 {succeeded} 个，失败 {len(items) - succeeded} 个",
        "items": items,
        "total": len(items),
        "succeeded": succeeded,
        "failed": len(items) - succeeded,
    }

def _serial_batch_ports(body: dict, request: Request) -> list[str]:
    raw_ports = body.get("ports", body.get("targetPorts", []))
    if isinstance(raw_ports, str):
        raw_ports = [raw_ports]
    if not isinstance(raw_ports, list):
        raise HTTPException(status_code=400, detail="ports 参数必须为串口名称数组")
    ports = list(dict.fromkeys(str(port).strip() for port in raw_ports if str(port).strip()))
    if not ports:
        query_port = request.query_params.get("port", "").strip()
        if query_port:
            ports = [query_port]
    if not ports:
        raise HTTPException(status_code=400, detail="请至少选择一个串口")
    return ports


def _serial_batch_result(ports: list[str], results: list[dict]) -> dict:
    items = [{"port": port, **result} for port, result in zip(ports, results)]
    succeeded = sum(1 for item in items if item["success"])
    return {"success": succeeded == len(items), "message": f"批量操作完成：成功 {succeeded} 个，失败 {len(items) - succeeded} 个", "items": items, "total": len(items), "succeeded": succeeded, "failed": len(items) - succeeded}


@router.post("/wifi/batch")
async def save_serial_wifi_batch(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ports = _serial_batch_ports(body, request)
    ssid = str(body.get("wifiSsid") or "").strip()
    password = str(body.get("wifiPassword") or "")
    if not ssid:
        raise HTTPException(status_code=400, detail="WiFi 名称不能为空")
    results = await asyncio.gather(*(
        asyncio.to_thread(serial_manager.send_line, f"::T3WIFI {ssid},{password}", port)
        for port in ports
    ))
    normalized = [{"success": bool(result.get("success")), "message": result.get("message", "WiFi 凭证发送失败")} for result in results]
    return _serial_batch_result(ports, normalized)


@router.post("/version/batch")
async def check_serial_versions(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ports = _serial_batch_ports(body, request)
    results = await asyncio.gather(*(
        asyncio.to_thread(serial_manager.send_and_wait, "::T3VER?", "::T3VER", 3.0, port)
        for port in ports
    ))
    normalized = []
    for result in results:
        lines = result.get("response", [])
        version = next((line.split(" ", 1)[1].strip() for line in lines if line.startswith("::T3VER ") and line.split(" ", 1)[1].strip()), "")
        has_error = any("ERR" in line or "unknown" in line.lower() for line in lines)
        normalized.append({"success": bool(version), "message": version or ("串口设备不支持版本查询协议" if has_error or not result.get("success") else "未收到版本响应"), "version": version})
    return _serial_batch_result(ports, normalized)


@router.post("/ota/batch")
async def start_serial_ota_batch(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ports = _serial_batch_ports(body, request)
    url = str(body.get("url") or "").strip()
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="OTA 地址必须是 HTTP(S) URL")
    results = await asyncio.gather(*(
        asyncio.to_thread(serial_manager.send_and_wait, f"::T3OTA {url}", "::T3OTA", 5.0, port)
        for port in ports
    ))
    normalized = []
    for result in results:
        lines = result.get("response", [])
        has_error = any("ERR" in line or "unknown" in line.lower() for line in lines)
        accepted = bool(result.get("success")) and not has_error
        normalized.append({"success": accepted, "message": "串口 OTA 已触发" if accepted else "串口设备不支持 OTA 命令或未返回确认"})
    return _serial_batch_result(ports, normalized)


@router.post("/reset")
def reset_serial_device(request: Request) -> dict:
    require_user(request)
    target_port = request.query_params.get("port", "").strip() or None
    result = serial_manager.pulse_reset(target_port)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message") or "复位失败")
    return result


@router.post("/control-lines")
async def update_control_lines(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    target_port = str(body.get("port") or "").strip() or None
    result = serial_manager.set_control_lines(bool(body.get("dtr")), bool(body.get("rts")), target_port)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message") or "控制线切换失败")
    return result


@router.post("/probe")
async def probe_serial(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    target_port = str(body.get("port") or "").strip() or None
    result = serial_manager.diagnostic_probe(float(body.get("duration") or 3), target_port)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message") or "串口诊断失败")
    return result


@router.post("/profile")
async def save_serial_device_profile(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ip = str(body.get("ip", "")).strip()
    device_name = str(body.get("deviceName", "")).strip()
    wifi_ssid = str(body.get("wifiSsid", "")).strip()
    wifi_password = str(body.get("wifiPassword") or "")
    if not ip:
        raise HTTPException(status_code=400, detail="设备 IP 不能为空")
    if not device_name and not wifi_ssid:
        raise HTTPException(status_code=400, detail="请至少填写设备名称或 WiFi 热点信息")
    messages: list[str] = []
    endpoints: list[str] = []
    if device_name:
        result = update_t3_config(ip, {"deviceName": device_name})
        if not result.get("ok"):
            raise HTTPException(status_code=502, detail=result.get("message") or "设备名称保存失败")
        endpoints.append(str(result.get("endpoint") or "/api/config"))
        messages.append("设备名称已写入")
    if wifi_ssid:
        result = set_t3_wifi(ip, wifi_ssid, wifi_password)
        if not result.get("ok"):
            raise HTTPException(status_code=502, detail=result.get("message") or "WiFi 配置失败")
        endpoints.append(str(result.get("endpoint") or "/api/wifi"))
        messages.append("WiFi 热点信息已保存，设备将重新连接 WiFi")
    return {"success": True, "message": "；".join(messages), "endpoints": endpoints}
