from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request

from ..auth import require_user
from ..config import DEVICE_PASS, DEVICE_USER
from ..db import connect, now_ts
from ..device_client import (
    check_t3_ota,
    clear_device_messages,
    factory_reset_t3,
    get_device_data,
    get_t3_config,
    get_t3_status,
    lan_discover_device,
    reboot_device,
    send_sms_to_device,
    send_t3_at,
    set_device_flymode,
    set_t3_sim_number,
    set_t3_wifi,
    start_t3_ota,
    status_payload_to_raw,
    update_t3_config,
)

router = APIRouter(prefix="/api/devices", tags=["devices"])


def _as_text(*values: object) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text and text.lower() not in {"none", "null", "undefined"}:
            return text
    return ""


def _as_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
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


def _sim_slot(raw: dict, slot: int) -> dict:
    """对齐 lvyou：从 raw_json 提取 SIM 槽位号码/运营商/信号/在位/注册。"""
    prefix = f"SIM{slot}"
    nested = raw.get("raw") if isinstance(raw.get("raw"), dict) else {}
    modem = nested.get("modem") if isinstance(nested.get("modem"), dict) else {}
    if not modem and isinstance(raw.get("modem"), dict):
        modem = raw["modem"]

    number = _as_text(
        raw.get(f"{prefix}_PHNUM"),
        nested.get(f"n{slot}"),
        modem.get(f"sim{slot}_number"),
    )
    operator = _as_text(
        raw.get(f"{prefix}_OP"),
        raw.get(f"{prefix}_STA"),
        nested.get(f"o{slot}"),
        modem.get(f"sim{slot}_operator"),
    )
    signal = _as_text(
        raw.get(f"{prefix}_SIGNAL"),
        nested.get("s"),
        modem.get("signal_dbm"),
    )
    iccid = _as_text(raw.get(f"{prefix}_ICCID"), modem.get(f"sim{slot}_iccid"))

    present_raw = raw.get(f"{prefix}_PRESENT")
    if present_raw is None and f"p{slot}" in nested:
        present_raw = nested.get(f"p{slot}")
    if present_raw is None:
        present_raw = modem.get(f"sim{slot}_present")
    present = _as_bool(present_raw, default=bool(number or operator or iccid))

    registered_raw = raw.get(f"{prefix}_REGISTERED")
    if registered_raw is None and f"r{slot}" in nested:
        registered_raw = nested.get(f"r{slot}")
    if registered_raw is None:
        registered_raw = (
            modem.get(f"sim{slot}_cs_registered")
            or modem.get(f"sim{slot}_ps_registered")
            or modem.get(f"sim{slot}_eps_registered")
        )
    registered = _as_bool(registered_raw, default=False)

    return {
        "number": number,
        "operator": operator,
        "signal": signal,
        "iccid": iccid,
        "present": present,
        "registered": registered,
    }


def _load_raw_json(row) -> dict:
    try:
        raw = json.loads(row["raw_json"] or "{}")
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def merge_device_raw(old: dict | None, new: dict | None) -> dict:
    """合并设备缓存：新非空覆盖；号码/运营商/ICCID 空值不覆盖旧值。

    对齐 lvyou 思路 + 适配 T3：/l/d 开机早期 n1/n2 常为空，
    若整包覆盖会把已识别/已手填的号码清掉。
    """
    old_raw = dict(old or {})
    new_raw = dict(new or {})
    if not old_raw:
        return new_raw
    if not new_raw:
        return old_raw

    out = dict(old_raw)
    out.update(new_raw)

    sticky = (
        "SIM1_PHNUM", "SIM2_PHNUM",
        "SIM1_OP", "SIM2_OP",
        "SIM1_ICCID", "SIM2_ICCID",
        "DEV_ID", "MAC",
    )
    for key in sticky:
        new_val = _as_text(new_raw.get(key))
        old_val = _as_text(old_raw.get(key))
        if not new_val and old_val:
            out[key] = old_val

    # 信号：新值有则用新值
    for key in ("SIM1_SIGNAL", "SIM2_SIGNAL", "WIFI_NAME", "WIFI_DBM", "DEV_VER"):
        new_val = _as_text(new_raw.get(key))
        if new_val:
            out[key] = new_val
        elif key not in out:
            out[key] = _as_text(old_raw.get(key))

    for slot in (1, 2):
        number = _as_text(out.get(f"SIM{slot}_PHNUM"))
        operator = _as_text(out.get(f"SIM{slot}_OP"))
        iccid = _as_text(out.get(f"SIM{slot}_ICCID"))
        if number or iccid:
            out[f"SIM{slot}_PRESENT"] = True
        elif f"SIM{slot}_PRESENT" not in new_raw and (operator or old_raw.get(f"SIM{slot}_PRESENT")):
            out[f"SIM{slot}_PRESENT"] = _as_bool(
                new_raw.get(f"SIM{slot}_PRESENT"),
                default=_as_bool(old_raw.get(f"SIM{slot}_PRESENT"), default=bool(operator)),
            )
        if f"SIM{slot}_REGISTERED" in new_raw:
            out[f"SIM{slot}_REGISTERED"] = _as_bool(new_raw.get(f"SIM{slot}_REGISTERED"), default=False)

    # 嵌套 raw/modem：合并而非整段替换，避免丢 ICCID
    old_nested = old_raw.get("raw") if isinstance(old_raw.get("raw"), dict) else {}
    new_nested = new_raw.get("raw") if isinstance(new_raw.get("raw"), dict) else {}
    if old_nested or new_nested:
        nested = dict(old_nested)
        nested.update(new_nested)
        old_modem = old_nested.get("modem") if isinstance(old_nested.get("modem"), dict) else {}
        new_modem = new_nested.get("modem") if isinstance(new_nested.get("modem"), dict) else {}
        if old_modem or new_modem:
            modem = dict(old_modem)
            modem.update(new_modem)
            for slot in (1, 2):
                for field in ("number", "operator", "iccid"):
                    key = f"sim{slot}_{field}"
                    if not _as_text(modem.get(key)) and _as_text(old_modem.get(key)):
                        modem[key] = old_modem.get(key)
            nested["modem"] = modem
        out["raw"] = nested

    return out


def collect_device_raw(
    ip: str,
    *,
    user: str = DEVICE_USER,
    password: str = DEVICE_PASS,
    fallback_name: str = "",
    fallback_mac: str = "",
    deep: bool = False,
) -> dict:
    """只读收集设备状态。

    deep=False（默认/扫描安全）：仅 GET /l/d，绝不访问 /api/status、/mgr。
    deep=True（用户主动刷新/添加/接管）：/l/d 缺号时再补 /api/status，必要时 /mgr。
    所有路径只读缓存字段，不发切卡/写号指令。
    """
    raw: dict = {}
    try:
        discovered = lan_discover_device(ip)
        if isinstance(discovered, dict) and discovered:
            raw = discovered
    except Exception:
        raw = {}

    if not deep:
        return raw if isinstance(raw, dict) else {}

    need_numbers = (
        not _as_text(raw.get("SIM1_PHNUM"))
        or not _as_text(raw.get("SIM2_PHNUM"))
        or not raw
    )
    if need_numbers:
        try:
            status_result = get_t3_status(ip, user, password)
            status_data = status_result.get("data") if isinstance(status_result, dict) else None
            if status_result.get("ok") and isinstance(status_data, dict) and status_data:
                status_raw = status_payload_to_raw(
                    status_data,
                    fallback_name=fallback_name or _as_text(raw.get("DEV_ID")),
                    fallback_mac=fallback_mac or _as_text(raw.get("MAC")),
                )
                raw = merge_device_raw(raw, status_raw)
        except Exception:
            pass

    if not raw:
        try:
            board = get_device_data(ip, user, password)
            if isinstance(board, dict) and board:
                raw = board
        except Exception:
            raw = {}
    elif not (_as_text(raw.get("SIM1_PHNUM")) or _as_text(raw.get("SIM2_PHNUM"))):
        try:
            board = get_device_data(ip, user, password)
            if isinstance(board, dict) and board:
                raw = merge_device_raw(raw, board)
        except Exception:
            pass

    return raw if isinstance(raw, dict) else {}


def normalize_device(row) -> dict:
    raw = _load_raw_json(row)
    raw_status = raw.get("raw") if isinstance(raw.get("raw"), dict) else {}
    wifi = raw_status.get("wifi") if isinstance(raw_status.get("wifi"), dict) else {}
    return {
        "id": row["id"],
        "ip": row["ip"],
        "mac": row["mac"] or raw.get("MAC", ""),
        "name": row["name"] or raw.get("DEV_ID", "") or row["ip"],
        "group": row["group_name"] or "auto",
        "status": row["status"] or "unknown",
        "lastSeen": row["last_seen"],
        "version": raw.get("DEV_VER", "") or raw.get("FW_VER", "") or raw.get("VERSION", ""),
        "sim1": _sim_slot(raw, 1),
        "sim2": _sim_slot(raw, 2),
        "wifi": {
            "name": _as_text(raw.get("WIFI_NAME"), wifi.get("ssid")),
            "dbm": _as_text(raw.get("WIFI_DBM"), wifi.get("rssi")),
            "ip": wifi.get("ip", ""),
            "connected": wifi.get("connected", False),
        },
    }


def upsert_device(ip: str, mac: str = "", raw: dict | None = None, group: str = "auto") -> dict:
    incoming = dict(raw or {})
    now = now_ts()
    with connect() as conn:
        existing = conn.execute("SELECT * FROM devices WHERE ip = ?", (ip,)).fetchone()
        if existing:
            old_raw = _load_raw_json(existing)
            merged = merge_device_raw(old_raw, incoming)
            mac_val = (mac or "").strip() or _as_text(merged.get("MAC")) or (existing["mac"] or "")
            name = _as_text(merged.get("DEV_ID")) or (existing["name"] or "") or ip
            group_val = (group or "").strip()
            if not group_val or group_val == "auto":
                group_val = existing["group_name"] or "auto"
            conn.execute(
                """
                UPDATE devices SET
                  mac = ?,
                  name = ?,
                  group_name = ?,
                  status = 'online',
                  last_seen = ?,
                  raw_json = ?,
                  updated_at = ?
                WHERE ip = ?
                """,
                (mac_val, name, group_val, now, json.dumps(merged, ensure_ascii=False), now, ip),
            )
            row = conn.execute("SELECT * FROM devices WHERE ip = ?", (ip,)).fetchone()
            return normalize_device(row)

        mac_val = (mac or "").strip() or _as_text(incoming.get("MAC"))
        name = _as_text(incoming.get("DEV_ID")) or ip
        group_val = (group or "").strip() or "auto"
        conn.execute(
            """
            INSERT INTO devices(ip, mac, name, group_name, status, last_seen, raw_json, created_at, updated_at)
            VALUES(?, ?, ?, ?, 'online', ?, ?, ?, ?)
            """,
            (ip, mac_val, name, group_val, now, json.dumps(incoming, ensure_ascii=False), now, now),
        )
        row = conn.execute("SELECT * FROM devices WHERE ip = ?", (ip,)).fetchone()
    return normalize_device(row)


def get_device_row(device_id: int):
    with connect() as conn:
        row = conn.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="设备不存在")
    return row


@router.get("")
def list_devices(request: Request) -> dict:
    require_user(request)
    with connect() as conn:
        rows = conn.execute("SELECT * FROM devices ORDER BY updated_at DESC, id DESC").fetchall()
    return {"items": [normalize_device(row) for row in rows], "total": len(rows)}


@router.post("/refresh-all")
def refresh_all_devices(request: Request) -> dict:
    """只读本地数据库缓存，不访问设备，避免打断模组注册。"""
    return list_devices(request)


@router.post("")
async def add_device(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ip = str(body.get("ip", "")).strip()
    if not ip:
        raise HTTPException(status_code=400, detail="IP 不能为空")
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    # 单设备添加：允许 deep 补读号码（用户主动，非全网扫描）
    raw = collect_device_raw(ip, user=user, password=password, deep=True)
    if not raw:
        raise HTTPException(status_code=400, detail="未识别到短信转发设备")
    return upsert_device(ip, str(body.get("mac", "")).strip(), raw, str(body.get("group", "auto")).strip())


@router.post("/bulk-delete")
async def bulk_delete_devices(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ids = body.get("ids", [])
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids 必须是数组")
    clean_ids = sorted({int(item) for item in ids if str(item).isdigit()})
    if not clean_ids:
        raise HTTPException(status_code=400, detail="请选择要删除的设备")
    placeholders = ",".join("?" for _ in clean_ids)
    with connect() as conn:
        cur = conn.execute(f"DELETE FROM devices WHERE id IN ({placeholders})", clean_ids)
    return {"success": True, "deleted": cur.rowcount}


@router.post("/{device_id}/refresh")
def refresh_device(device_id: int, request: Request) -> dict:
    """主动刷新单设备：只读收集状态并合并本地缓存（不切卡、不重注册）。"""
    require_user(request)
    row = get_device_row(device_id)
    ip = row["ip"]
    mac = row["mac"] or ""
    group = row["group_name"] or "auto"
    raw = collect_device_raw(
        ip,
        fallback_name=row["name"] or "",
        fallback_mac=mac,
        deep=True,
    )
    if raw:
        return upsert_device(ip, mac or str(raw.get("MAC") or ""), raw, group)
    return normalize_device(row)


@router.post("/{device_id}/sms")
async def send_sms(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    phone = str(body.get("phone", "")).strip()
    content = str(body.get("content", "")).strip()
    sim_slot = int(body.get("simSlot") or body.get("sim") or 1)
    if not phone or not content:
        raise HTTPException(status_code=400, detail="手机号和短信内容不能为空")
    if sim_slot not in (1, 2):
        raise HTTPException(status_code=400, detail="SIM 卡槽只能是 1 或 2")
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    result = send_sms_to_device(row["ip"], user, password, phone, content, sim_slot)
    try:
        raw = json.loads(row["raw_json"] or "{}")
    except (TypeError, ValueError):
        raw = {}
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO messages(
                phone, content, direction, status, created_at,
                device_id, device_name, device_ip, sim_slot, sim_number, sim_type
            ) VALUES(?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                phone,
                content,
                "success" if result.get("ok") else "failed",
                now_ts(),
                str(row["id"]),
                str(row["name"] or row["ip"]),
                row["ip"],
                sim_slot,
                str(raw.get(f"SIM{sim_slot}_PHNUM") or ""),
                "",
            ),
        )
    if not result.get("ok"):
        endpoint = result.get("endpoint") or "unknown"
        raise HTTPException(status_code=502, detail=f"{result.get('message') or '短信发送失败'} ({endpoint})")
    return {"success": True, "message": result.get("message") or "短信已发送", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.post("/{device_id}/flymode")
async def update_flymode(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    enabled = bool(body.get("enabled"))
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    result = set_device_flymode(row["ip"], user, password, enabled)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "飞行模式设置失败")
    return {"success": True, "message": result.get("message") or "飞行模式命令已发送", "endpoint": result.get("endpoint")}


@router.post("/{device_id}/reboot")
async def restart_device(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    result = reboot_device(row["ip"], user, password)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "重启命令发送失败")
    return {"success": True, "message": result.get("message") or "重启命令已发送", "endpoint": result.get("endpoint")}


def build_takeover_response(row, user: str = DEVICE_USER, password: str = DEVICE_PASS) -> dict:
    status_result = get_t3_status(row["ip"], user, password)
    config_result = get_t3_config(row["ip"], user, password)
    device = normalize_device(row)
    # 打开接管时顺带把 status 里的号码合并进本地缓存（只读，不切卡）
    if status_result.get("ok") and isinstance(status_result.get("data"), dict):
        raw = status_payload_to_raw(
            status_result["data"],
            fallback_name=row["name"] or "",
            fallback_mac=row["mac"] or "",
        )
        if raw:
            device = upsert_device(row["ip"], row["mac"] or "", raw, row["group_name"] or "auto")
    return {
        "success": bool(status_result.get("ok") or config_result.get("ok")),
        "device": device,
        "status": status_result.get("data", {}) if status_result.get("ok") else {},
        "config": config_result.get("data", {}) if config_result.get("ok") else {},
        "statusReady": bool(status_result.get("ok")),
        "configReady": bool(config_result.get("ok")),
        "statusError": "" if status_result.get("ok") else (status_result.get("message") or "设备状态读取失败，请确认设备已联网且局域网可访问"),
        "configError": "" if config_result.get("ok") else (config_result.get("message") or "设备配置读取失败，已禁用保存以避免空配置覆盖固件"),
        "statusEndpoint": status_result.get("endpoint"),
        "configEndpoint": config_result.get("endpoint"),
    }


@router.get("/{device_id}/takeover")
def get_takeover(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    return build_takeover_response(row)


@router.post("/{device_id}/takeover")
async def post_takeover(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    return build_takeover_response(row, user, password)


@router.post("/{device_id}/config")
async def update_config(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    user = str(body.pop("user", DEVICE_USER) or DEVICE_USER)
    password = str(body.pop("password", DEVICE_PASS) or DEVICE_PASS)
    current_result = get_t3_config(row["ip"], user, password)
    if not current_result.get("ok") or not isinstance(current_result.get("data"), dict) or not current_result.get("data"):
        raise HTTPException(status_code=502, detail=current_result.get("message") or "保存前未能读取设备当前配置，已取消保存以避免覆盖固件配置")
    merged = dict(current_result.get("data") or {})
    merged.update(body)
    result = update_t3_config(row["ip"], merged, user, password)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "配置保存失败")
    refreshed = get_t3_status(row["ip"], user, password)
    raw = None
    if refreshed.get("ok"):
        data = refreshed.get("data") or {}
        raw = {
            "DEV_ID": data.get("deviceName") or merged.get("deviceName") or row["name"],
            "DEV_VER": data.get("version", ""),
            "MAC": data.get("mac") or row["mac"],
            "raw": data,
        }
        modem = data.get("modem") if isinstance(data.get("modem"), dict) else {}
        wifi = data.get("wifi") if isinstance(data.get("wifi"), dict) else {}
        raw.update({
            "SIM1_PHNUM": modem.get("sim1_number", ""),
            "SIM2_PHNUM": modem.get("sim2_number", ""),
            "SIM1_OP": modem.get("sim1_operator", ""),
            "SIM2_OP": modem.get("sim2_operator", ""),
            "SIM1_SIGNAL": str(modem.get("signal_dbm", "")),
            "SIM2_SIGNAL": str(modem.get("signal_dbm", "")),
            "WIFI_NAME": wifi.get("ssid", ""),
            "WIFI_DBM": str(wifi.get("rssi", "")),
        })
        upsert_device(row["ip"], row["mac"], raw, row["group_name"])
    return {"success": True, "message": result.get("message") or "配置已保存", "endpoint": result.get("endpoint"), "status": refreshed.get("data", {}) if refreshed.get("ok") else {}}


@router.post("/{device_id}/wifi")
async def update_wifi(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    ssid = str(body.get("ssid", "")).strip()
    password = str(body.get("password") or body.get("pass") or "")
    if not ssid:
        raise HTTPException(status_code=400, detail="WiFi 名称不能为空")
    result = set_t3_wifi(row["ip"], ssid, password)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "WiFi 配置失败")
    return {"success": True, "message": "WiFi 已保存，设备将重新连接新热点", "endpoint": result.get("endpoint")}


@router.post("/{device_id}/sim-number")
async def update_sim_number(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    slot = int(body.get("slot") or 1)
    number = str(body.get("number", "")).strip()
    if slot not in (1, 2):
        raise HTTPException(status_code=400, detail="SIM 卡槽只能是 1 或 2")
    result = set_t3_sim_number(row["ip"], slot, number, str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "SIM 号码写入失败")
    # 人工写号：强制覆盖本地缓存（允许清空，不走 sticky 保留）
    raw = _load_raw_json(row)
    raw[f"SIM{slot}_PHNUM"] = number
    if number:
        raw[f"SIM{slot}_PRESENT"] = True
    nested = raw.get("raw") if isinstance(raw.get("raw"), dict) else {}
    modem = nested.get("modem") if isinstance(nested.get("modem"), dict) else {}
    modem[f"sim{slot}_number"] = number
    nested["modem"] = modem
    nested[f"n{slot}"] = number
    raw["raw"] = nested
    now = now_ts()
    with connect() as conn:
        conn.execute(
            """
            UPDATE devices SET raw_json = ?, updated_at = ?, last_seen = ?, status = 'online'
            WHERE id = ?
            """,
            (json.dumps(raw, ensure_ascii=False), now, now, device_id),
        )
    return {
        "success": True,
        "message": result.get("message") or "SIM 号码已写入",
        "endpoint": result.get("endpoint"),
        "data": result.get("data", {}),
        "device": normalize_device(get_device_row(device_id)),
    }


@router.post("/{device_id}/at")
async def proxy_at(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    command = str(body.get("command") or body.get("cmd") or "").strip()
    timeout_ms = int(body.get("timeout") or 1000)
    if not command:
        raise HTTPException(status_code=400, detail="AT 命令不能为空")
    result = send_t3_at(row["ip"], command, timeout_ms, str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "AT 命令执行失败")
    return {"success": True, "message": result.get("message") or "AT 命令已执行", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.post("/{device_id}/factory-reset")
async def factory_reset(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    result = factory_reset_t3(row["ip"], str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "恢复出厂失败")
    return {"success": True, "message": result.get("message") or "已恢复出厂，设备将重启", "endpoint": result.get("endpoint")}


@router.post("/{device_id}/clear-messages")
async def clear_device_messages_route(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    try:
        body = await request.json()
    except Exception:
        body = {}
    result = clear_device_messages(row["ip"], str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "清空设备消息日志失败")
    return {"success": True, "message": result.get("message") or "设备消息日志已清空", "endpoint": result.get("endpoint")}


@router.get("/{device_id}/ota/version")
def check_ota_version(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    result = check_t3_ota(row["ip"])
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "OTA 检查失败")
    return {"success": True, "message": result.get("message") or "OTA 检查完成", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.get("/{device_id}/ota")
def check_ota(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    result = check_t3_ota(row["ip"])
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "OTA 检查失败")
    return {"success": True, "message": result.get("message") or "OTA 检查完成", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.post("/ota/batch-check")
async def batch_check_ota(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ids = body.get("ids", [])
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids 必须是数组")
    clean_ids = sorted({int(item) for item in ids if str(item).isdigit()})
    if not clean_ids:
        raise HTTPException(status_code=400, detail="请选择要检查的设备")
    placeholders = ",".join("?" for _ in clean_ids)
    with connect() as conn:
        rows = conn.execute(f"SELECT * FROM devices WHERE id IN ({placeholders})", clean_ids).fetchall()
    items = []
    for row in rows:
        result = check_t3_ota(row["ip"])
        items.append({"id": row["id"], "ip": row["ip"], "success": bool(result.get("ok")), "message": result.get("message") or ("OTA 检查完成" if result.get("ok") else "OTA 检查失败"), "endpoint": result.get("endpoint"), "data": result.get("data", {})})
    return {"success": True, "items": items, "total": len(items)}


@router.post("/ota/batch-upgrade")
async def batch_start_ota(request: Request) -> dict:
    require_user(request)
    body = await request.json()
    ids = body.get("ids", [])
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids 必须是数组")
    clean_ids = sorted({int(item) for item in ids if str(item).isdigit()})
    if not clean_ids:
        raise HTTPException(status_code=400, detail="请选择要升级的设备")
    url = str(body.get("url", "")).strip()
    if not url:
        raise HTTPException(status_code=400, detail="OTA 地址不能为空")
    user = str(body.get("user") or DEVICE_USER)
    password = str(body.get("password") or DEVICE_PASS)
    placeholders = ",".join("?" for _ in clean_ids)
    with connect() as conn:
        rows = conn.execute(f"SELECT * FROM devices WHERE id IN ({placeholders})", clean_ids).fetchall()
    items = []
    for row in rows:
        result = start_t3_ota(row["ip"], url, user, password)
        items.append({"id": row["id"], "ip": row["ip"], "success": bool(result.get("ok")), "message": result.get("message") or ("OTA 已启动" if result.get("ok") else "OTA 启动失败"), "endpoint": result.get("endpoint"), "data": result.get("data", {})})
    return {"success": True, "items": items, "total": len(items)}


@router.post("/{device_id}/ota")
async def start_ota(device_id: int, request: Request) -> dict:
    require_user(request)
    row = get_device_row(device_id)
    body = await request.json()
    url = str(body.get("url", "")).strip()
    if not url:
        raise HTTPException(status_code=400, detail="OTA 地址不能为空")
    result = start_t3_ota(row["ip"], url, str(body.get("user") or DEVICE_USER), str(body.get("password") or DEVICE_PASS))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message") or "OTA 启动失败")
    return {"success": True, "message": result.get("message") or "OTA 已启动", "endpoint": result.get("endpoint"), "data": result.get("data", {})}


@router.delete("/{device_id}")
def delete_device(device_id: int, request: Request) -> dict:
    require_user(request)
    with connect() as conn:
        cur = conn.execute("DELETE FROM devices WHERE id = ?", (device_id,))
    return {"success": cur.rowcount > 0}
