from __future__ import annotations

import re
import threading
import time
from collections import deque
from typing import Any

from .db import connect, now_ts

try:
    import serial
    import serial.tools.list_ports
except Exception:
    serial = None

PHONE_RE = re.compile(r"(\+?\d{5,20})")


class SerialManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._serial: Any = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._logs: deque[dict[str, Any]] = deque(maxlen=500)
        self._log_seq = 0
        self._connected = False
        self._port = ""
        self._baudrate = 115200
        self._last_error = ""
        self._last_read_at = 0
        self._pending_sms_phone = ""
        self._safe_mode = True
        self._cdc_mode = True
        self._dtr_enabled = False
        self._rts_enabled = False
        self._line_state: dict[str, bool] = {"cts": False, "dsr": False, "cd": False}
        self._bytes_received = 0
        self._read_iterations = 0
        self._last_raw_hex = ""

    def list_ports(self) -> list[dict[str, str]]:
        if serial is None:
            return []
        return [
            {"name": item.device, "description": item.description or item.device, "hwid": item.hwid or ""}
            for item in serial.tools.list_ports.comports()
        ]

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "available": serial is not None,
                "connected": self._connected,
                "port": self._port,
                "baudrate": self._baudrate,
                "lastError": self._last_error,
                "lastReadAt": self._last_read_at,
                "logCount": len(self._logs),
                "safeMode": self._safe_mode,
                "cdcMode": self._cdc_mode,
                "dtrEnabled": self._dtr_enabled,
                "rtsEnabled": self._rts_enabled,
                "lineState": self._line_state,
                "bytesReceived": self._bytes_received,
                "readIterations": self._read_iterations,
                "readerAlive": bool(self._thread and self._thread.is_alive()),
                "lastRawHex": self._last_raw_hex,
                "serialConfig": "8N1 / flowControl none",
            }

    def logs(self, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._logs)[-limit:]

    def logs_since(self, after: int = 0, limit: int = 200) -> dict[str, Any]:
        with self._lock:
            items = [item for item in self._logs if int(item.get("id", 0)) > after]
            latest = self._log_seq
        return {"items": items[-limit:], "latestId": latest}

    def connect_port(self, port: str, baudrate: int = 115200, safe_mode: bool = True, dtr: bool | None = None, rts: bool | None = None, cdc_mode: bool = True) -> dict[str, Any]:
        if serial is None:
            return {"success": False, "message": "pyserial 未安装，无法读取本地串口"}
        port = port.strip()
        if not port:
            return {"success": False, "message": "请选择串口"}
        if baudrate <= 0:
            return {"success": False, "message": "波特率无效"}
        requested_dtr = True if cdc_mode else (False if dtr is None else bool(dtr))
        requested_rts = False if rts is None else bool(rts)
        if safe_mode and not cdc_mode:
            requested_dtr = False
            requested_rts = False
        self.disconnect_port()
        try:
            instance = serial.Serial()
            instance.port = port
            instance.baudrate = baudrate
            instance.bytesize = serial.EIGHTBITS
            instance.parity = serial.PARITY_NONE
            instance.stopbits = serial.STOPBITS_ONE
            instance.timeout = 0.02
            instance.inter_byte_timeout = 0.02
            instance.write_timeout = 1
            instance.xonxoff = False
            instance.rtscts = False
            instance.dsrdtr = False
            instance.dtr = requested_dtr
            instance.rts = requested_rts
            instance.open()
            instance.setDTR(requested_dtr)
            instance.setRTS(requested_rts)
            time.sleep(0.05)
            pending_bytes = instance.in_waiting
            line_state = self._read_line_state(instance)
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
            try:
                instance.close()
            except Exception:
                pass
            return {"success": False, "message": f"串口连接失败：{exc}"}
        with self._lock:
            self._serial = instance
            self._port = port
            self._baudrate = baudrate
            self._connected = True
            self._last_error = ""
            self._pending_sms_phone = ""
            self._safe_mode = safe_mode
            self._cdc_mode = cdc_mode
            self._dtr_enabled = requested_dtr
            self._rts_enabled = requested_rts
            self._line_state = line_state
            self._bytes_received = 0
            self._read_iterations = 0
            self._last_raw_hex = ""
        self._stop.clear()
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()
        mode_label = "ESP32-C3 USB CDC" if cdc_mode else ("安全模式" if safe_mode else "标准模式")
        self._add_log("system", f"已连接 {port} @ {baudrate}（{mode_label}）")
        self._add_log("system", f"串口参数：8 data bits / parity none / 1 stop bit / flow control none / DTR={int(requested_dtr)} RTS={int(requested_rts)}")
        self._add_log("system", f"控制线状态：CTS={int(line_state['cts'])} DSR={int(line_state['dsr'])} CD={int(line_state['cd'])}")
        self._add_log("system", "读取线程已启动，正在等待设备输出")
        if pending_bytes:
            self._add_log("system", f"连接时检测到输入缓冲 {pending_bytes} 字节，将继续读取而不清空")
        if cdc_mode:
            self._add_log("system", "ESP32-C3 USB CDC 模式已启用：保持 DTR=1 表示终端在线，RTS=0 避免进入下载/复位异常状态")
        elif safe_mode:
            self._add_log("system", "已禁用 DTR/RTS，避免常见 ESP32/Arduino 串口复位")
        else:
            self._add_log("system", "当前为标准/调试模式，如设备依赖 DTR/RTS 供能或握手，可尝试切换控制线")
        return {"success": True, "message": f"已连接 {port}"}

    def disconnect_port(self) -> dict[str, Any]:
        self._stop.set()
        current_thread = self._thread
        if current_thread and current_thread.is_alive() and current_thread is not threading.current_thread():
            current_thread.join(timeout=2)
        with self._lock:
            instance = self._serial
            self._serial = None
            self._thread = None
            self._connected = False
        if instance:
            try:
                instance.close()
            except Exception:
                pass
            self._add_log("system", "串口已断开")
        return {"success": True, "message": "串口已断开"}

    def send_line(self, command: str) -> dict[str, Any]:
        command = command.strip()
        if not command:
            return {"success": False, "message": "命令不能为空"}
        with self._lock:
            instance = self._serial
        if not instance or not self._connected:
            return {"success": False, "message": "串口未连接"}
        try:
            payload = (command + "\r\n").encode("utf-8")
            instance.write(payload)
            instance.flush()
            self._add_log("tx", command)
            return {"success": True, "message": "命令已发送"}
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
            return {"success": False, "message": f"命令发送失败：{exc}"}

    def send_and_wait(self, command: str, wait_prefix: str = "::T3CFG", timeout: float = 3.0) -> dict[str, Any]:
        """发送命令并等待包含指定前缀的响应行"""
        command = command.strip()
        if not command:
            return {"success": False, "message": "命令不能为空"}
        with self._lock:
            instance = self._serial
            baseline_seq = self._log_seq
        if not instance or not self._connected:
            return {"success": False, "message": "串口未连接"}
        try:
            payload = (command + "\r\n").encode("utf-8")
            instance.write(payload)
            instance.flush()
            self._add_log("tx", command)
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
            return {"success": False, "message": f"命令发送失败：{exc}"}

        deadline = time.monotonic() + max(0.5, min(timeout, 10.0))
        while time.monotonic() < deadline:
            time.sleep(0.1)
            with self._lock:
                recent_logs = [item for item in self._logs if item.get("id", 0) > baseline_seq]
            all_rx_lines = [item["content"] for item in recent_logs if item.get("level") == "rx"]
            # 检测是否收到包含等待前缀的行（表示响应已到达）
            matched = [line for line in all_rx_lines if wait_prefix in line]
            if matched:
                # 返回所有 rx 行（不只是匹配行），因为长 JSON 可能被串口缓冲拆成多段
                return {"success": True, "message": "命令已发送并收到响应", "response": all_rx_lines}

        with self._lock:
            recent_logs = [item for item in self._logs if item.get("id", 0) > baseline_seq]
        rx_lines = [item["content"] for item in recent_logs if item.get("level") == "rx"]
        return {"success": False, "message": "命令已发送但等待响应超时，请确认固件已支持串口配置命令", "response": rx_lines}

    def pulse_reset(self) -> dict[str, Any]:
        with self._lock:
            instance = self._serial
        if not instance or not self._connected:
            return {"success": False, "message": "串口未连接"}
        try:
            instance.setDTR(False)
            instance.setRTS(True)
            time.sleep(0.1)
            instance.setRTS(False)
            instance.setDTR(False)
            with self._lock:
                self._dtr_enabled = False
                self._rts_enabled = False
                self._line_state = self._read_line_state(instance)
            self._add_log("system", "已发送一次 RTS 复位脉冲")
            return {"success": True, "message": "复位脉冲已发送"}
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
            return {"success": False, "message": f"复位失败：{exc}"}

    def set_control_lines(self, dtr: bool, rts: bool) -> dict[str, Any]:
        with self._lock:
            instance = self._serial
        if not instance or not self._connected:
            return {"success": False, "message": "串口未连接"}
        try:
            instance.setDTR(bool(dtr))
            instance.setRTS(bool(rts))
            time.sleep(0.03)
            line_state = self._read_line_state(instance)
            with self._lock:
                self._dtr_enabled = bool(dtr)
                self._rts_enabled = bool(rts)
                self._line_state = line_state
            self._add_log("system", f"控制线已切换：DTR={int(bool(dtr))} RTS={int(bool(rts))} CTS={int(line_state['cts'])} DSR={int(line_state['dsr'])} CD={int(line_state['cd'])}")
            return {"success": True, "message": "控制线已切换", "lineState": line_state}
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
            return {"success": False, "message": f"控制线切换失败：{exc}"}

    def diagnostic_probe(self, duration: float = 3.0) -> dict[str, Any]:
        deadline = time.monotonic() + max(1.0, min(duration, 10.0))
        samples: list[dict[str, Any]] = []
        last_bytes = -1
        while time.monotonic() < deadline:
            with self._lock:
                instance = self._serial
                bytes_received = self._bytes_received
                iterations = self._read_iterations
                last_hex = self._last_raw_hex
            if not instance or not self._connected:
                return {"success": False, "message": "串口未连接", "samples": samples}
            line_state = self._read_line_state(instance)
            samples.append({"time": now_ts(), "bytesReceived": bytes_received, "readIterations": iterations, "lastRawHex": last_hex, "lineState": line_state})
            if bytes_received != last_bytes:
                last_bytes = bytes_received
            time.sleep(0.5)
        with self._lock:
            total = self._bytes_received
        if total == 0:
            self._add_log("system", "诊断完成：读取线程正常，但 3 秒内仍未收到任何字节；T3 固件日志只从 ESP32 USB CDC 输出，请确认插的是 ESP32-C3 USB 口而不是 EC200M 模块 UART，且线缆支持数据传输")
        else:
            self._add_log("system", f"诊断完成：累计收到 {total} 字节")
        return {"success": True, "message": "诊断完成", "samples": samples, "bytesReceived": total}

    def _read_line_state(self, instance: Any) -> dict[str, bool]:
        return {
            "cts": bool(getattr(instance, "cts", False)),
            "dsr": bool(getattr(instance, "dsr", False)),
            "cd": bool(getattr(instance, "cd", False)),
        }

    def _read_loop(self) -> None:
        buffer = bytearray()
        last_data_at = 0.0
        last_idle_log_at = time.monotonic()
        while not self._stop.is_set():
            with self._lock:
                instance = self._serial
            if not instance:
                break
            try:
                waiting = max(instance.in_waiting, 1)
                raw = instance.read(waiting)
                current = time.monotonic()
                with self._lock:
                    self._read_iterations += 1
                if raw:
                    with self._lock:
                        self._bytes_received += len(raw)
                        self._last_raw_hex = raw[:32].hex(" ")
                    buffer.extend(raw)
                    last_data_at = current
                    while b"\n" in buffer or b"\r" in buffer:
                        line, buffer = self._split_buffer(buffer)
                        self._consume_raw(line)
                    if len(buffer) >= 4096:
                        self._consume_raw(bytes(buffer))
                        buffer.clear()
                    continue
                if buffer and current - last_data_at >= 0.5:
                    self._consume_raw(bytes(buffer))
                    buffer.clear()
                if current - last_idle_log_at >= 8:
                    with self._lock:
                        received = self._bytes_received
                        iterations = self._read_iterations
                    if received == 0:
                        self._add_log("system", f"串口已连接但暂未收到字节，读循环正常运行 {iterations} 次；请确认设备 TX 接到电脑 RX、共地、波特率正确，或设备是否需要主动发送命令")
                    last_idle_log_at = current
            except Exception as exc:
                with self._lock:
                    self._last_error = str(exc)
                    self._connected = False
                self._add_log("error", str(exc))
                break
        if buffer:
            self._consume_raw(bytes(buffer))
        with self._lock:
            self._connected = False

    def _split_buffer(self, buffer: bytearray) -> tuple[bytes, bytearray]:
        positions = [index for index in (buffer.find(b"\n"), buffer.find(b"\r")) if index >= 0]
        index = min(positions)
        line = bytes(buffer[:index])
        next_index = index + 1
        while next_index < len(buffer) and buffer[next_index] in (10, 13):
            next_index += 1
        return line, bytearray(buffer[next_index:])

    def _consume_raw(self, raw: bytes) -> None:
        if not raw:
            return
        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            hex_text = raw.hex(" ").strip()
            if not hex_text:
                return
            text = f"HEX {hex_text}"
        self._last_read_at = now_ts()
        self._add_log("rx", text)
        self._handle_line(text)

    def _add_log(self, level: str, content: str) -> None:
        with self._lock:
            self._log_seq += 1
            self._logs.append({"id": self._log_seq, "time": now_ts(), "level": level, "content": content})

    def _handle_line(self, line: str) -> None:
        upper = line.upper()
        if upper.startswith("+CMT:"):
            self._pending_sms_phone = self._extract_phone(line)
            return
        if self._pending_sms_phone:
            self._save_message(self._pending_sms_phone, line, "in")
            self._pending_sms_phone = ""
            return
        if upper.startswith("+CLIP:") or upper.startswith("RING"):
            phone = self._extract_phone(line)
            if phone:
                self._save_message(phone, f"来电：{phone}", "call")
            return
        if upper.startswith("+CMTI:"):
            self._add_log("system", "检测到新短信索引通知，请用 AT+CMGL=\"ALL\" 或 AT+CMGR=<index> 读取内容")
            return

    def _extract_phone(self, text: str) -> str:
        match = PHONE_RE.search(text)
        return match.group(1) if match else ""

    def _save_message(self, phone: str, content: str, direction: str) -> None:
        if not phone and not content:
            return
        with connect() as conn:
            conn.execute(
                "INSERT INTO messages(phone, content, direction, status, created_at) VALUES(?, ?, ?, 'success', ?)",
                (phone or "-", content, direction, now_ts()),
            )
        self._add_log("system", "已写入短信/通话记录")


class MultiSerialManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[str, SerialManager] = {}
        self._active_port = ""

    def list_ports(self) -> list[dict[str, str]]:
        if serial is None:
            return []
        return [
            {"name": item.device, "description": item.description or item.device, "hwid": item.hwid or ""}
            for item in serial.tools.list_ports.comports()
        ]

    def _empty_status(self) -> dict[str, Any]:
        return {
            "available": serial is not None,
            "connected": False,
            "port": "",
            "baudrate": 115200,
            "lastError": "",
            "lastReadAt": 0,
            "logCount": 0,
            "safeMode": True,
            "cdcMode": True,
            "dtrEnabled": False,
            "rtsEnabled": False,
            "lineState": {"cts": False, "dsr": False, "cd": False},
            "bytesReceived": 0,
            "readIterations": 0,
            "readerAlive": False,
            "lastRawHex": "",
            "serialConfig": "8N1 / flowControl none",
            "sessions": self.session_statuses(),
            "activePort": self._active_port,
        }

    def _session(self, port: str | None = None) -> SerialManager | None:
        with self._lock:
            target = (port or self._active_port).strip()
            return self._sessions.get(target) if target else None

    def _ensure_session(self, port: str) -> SerialManager:
        with self._lock:
            if port not in self._sessions:
                self._sessions[port] = SerialManager()
            self._active_port = port
            return self._sessions[port]

    def session_statuses(self) -> list[dict[str, Any]]:
        with self._lock:
            items = []
            for port, session in self._sessions.items():
                status = session.status()
                items.append({
                    "port": port,
                    "connected": bool(status.get("connected")),
                    "baudrate": status.get("baudrate", 115200),
                    "logCount": status.get("logCount", 0),
                    "lastReadAt": status.get("lastReadAt", 0),
                    "readerAlive": bool(status.get("readerAlive")),
                    "lastError": status.get("lastError", ""),
                })
            return items

    def status(self, port: str | None = None) -> dict[str, Any]:
        session = self._session(port)
        if not session:
            return self._empty_status()
        status = session.status()
        status["sessions"] = self.session_statuses()
        status["activePort"] = self._active_port
        return status

    def logs(self, limit: int = 200, port: str | None = None) -> list[dict[str, Any]]:
        session = self._session(port)
        return session.logs(limit) if session else []

    def logs_since(self, after: int = 0, limit: int = 200, port: str | None = None) -> dict[str, Any]:
        session = self._session(port)
        return session.logs_since(after, limit) if session else {"items": [], "latestId": 0}

    def connect_port(self, port: str, baudrate: int = 115200, safe_mode: bool = True, dtr: bool | None = None, rts: bool | None = None, cdc_mode: bool = True) -> dict[str, Any]:
        port = port.strip()
        session = self._ensure_session(port)
        result = session.connect_port(port, baudrate, safe_mode, dtr, rts, cdc_mode)
        if result.get("success"):
            with self._lock:
                self._active_port = port
        return result

    def disconnect_port(self, port: str | None = None) -> dict[str, Any]:
        session = self._session(port)
        if not session:
            return {"success": True, "message": "串口已断开"}
        return session.disconnect_port()

    def send_line(self, command: str, port: str | None = None) -> dict[str, Any]:
        session = self._session(port)
        if not session:
            return {"success": False, "message": "串口未连接"}
        return session.send_line(command)

    def send_and_wait(self, command: str, wait_prefix: str = "::T3CFG", timeout: float = 3.0, port: str | None = None) -> dict[str, Any]:
        session = self._session(port)
        if not session:
            return {"success": False, "message": "串口未连接"}
        return session.send_and_wait(command, wait_prefix, timeout)

    def pulse_reset(self, port: str | None = None) -> dict[str, Any]:
        session = self._session(port)
        if not session:
            return {"success": False, "message": "串口未连接"}
        return session.pulse_reset()

    def set_control_lines(self, dtr: bool, rts: bool, port: str | None = None) -> dict[str, Any]:
        session = self._session(port)
        if not session:
            return {"success": False, "message": "串口未连接"}
        return session.set_control_lines(dtr, rts)

    def diagnostic_probe(self, duration: float = 3.0, port: str | None = None) -> dict[str, Any]:
        session = self._session(port)
        if not session:
            return {"success": False, "message": "串口未连接", "samples": []}
        return session.diagnostic_probe(duration)


serial_manager = MultiSerialManager()
