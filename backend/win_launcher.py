from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import messagebox

import uvicorn


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[1]


def app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def free_port(preferred: int) -> int:
    # 统一使用固定端口（默认 8080）。如需更换端口可设置环境变量 T3_WEB_PORT。
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", preferred))
        return preferred


class Launcher:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("T3 控制台")
        self.root.geometry("380x220")
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        self.port = free_port(int(os.environ.get("T3_WEB_PORT", "8080")))
        self.url = f"http://127.0.0.1:{self.port}"
        root_dir = app_root()
        bundle_dir = resource_root()
        self.log_path = root_dir / "launcher.log"
        self.log(f"app_root={root_dir}")
        self.log(f"resource_root={bundle_dir}")
        self.log(f"port={self.port}")
        os.environ.setdefault("T3_WEB_PORT", str(self.port))
        os.environ.setdefault("T3_DATA_DIR", str(root_dir / "data"))
        os.environ.setdefault("T3_DB", str(root_dir / "data" / "app.db"))
        os.environ.setdefault("T3_STATIC_DIR", str(bundle_dir / "static"))

        self.server: uvicorn.Server | None = None
        self._build_ui()

    def log(self, message: str) -> None:
        try:
            with self.log_path.open("a", encoding="utf-8") as file:
                file.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
        except Exception:
            pass

    def _build_ui(self) -> None:
        self.root.configure(bg="#fafafa")
        frame = tk.Frame(self.root, padx=22, pady=20, bg="#fafafa")
        frame.pack(fill="both", expand=True)

        tk.Label(frame, text="T3 控制台", font=("Microsoft YaHei UI", 18, "bold"), bg="#fafafa", fg="#18181b").pack(anchor="w")
        tk.Label(frame, text="Web 管理服务正在运行", font=("Microsoft YaHei UI", 10), bg="#fafafa", fg="#52525b").pack(anchor="w", pady=(6, 0))

        url_box = tk.Label(frame, text=self.url, font=("Consolas", 11), bg="#f4f4f5", fg="#18181b", padx=10, pady=8)
        url_box.pack(fill="x", pady=(16, 12))

        buttons = tk.Frame(frame, bg="#fafafa")
        buttons.pack(fill="x")
        tk.Button(buttons, text="打开浏览器", command=self.open_browser, height=2, bg="#18181b", fg="#ffffff", relief="flat").pack(side="left", fill="x", expand=True, padx=(0, 8))
        tk.Button(buttons, text="退出", command=self.close, height=2, bg="#ffffff", fg="#dc2626", relief="solid", bd=1).pack(side="left", fill="x", expand=True)

        tk.Label(frame, text="默认账号：admin / admin123", font=("Microsoft YaHei UI", 9), bg="#fafafa", fg="#71717a").pack(anchor="w", pady=(14, 0))

    def start_server(self) -> None:
        try:
            self.log("server starting")
            config = uvicorn.Config("backend.app.main:app", host="127.0.0.1", port=self.port, log_config=None, access_log=False)
            self.server = uvicorn.Server(config)
            self.server.run()
            self.log("server stopped")
        except Exception as exc:
            self.log(f"server failed: {exc!r}")
            self.root.after(0, lambda: messagebox.showerror("T3 控制台启动失败", f"服务启动失败：{exc}\n\n日志：{self.log_path}"))

    def open_browser(self) -> None:
        webbrowser.open(self.url)

    def run(self) -> None:
        thread = threading.Thread(target=self.start_server, daemon=True)
        thread.start()
        self.root.after(1200, self.open_browser)
        self.root.mainloop()

    def close(self) -> None:
        if self.server:
            self.server.should_exit = True
        self.root.destroy()


def main() -> None:
    try:
        Launcher().run()
    except Exception as exc:
        messagebox.showerror("T3 控制台启动失败", str(exc))


if __name__ == "__main__":
    main()
