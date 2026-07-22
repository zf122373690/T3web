from __future__ import annotations

import ctypes
import os
import socket
import sys
import threading
import time
import webbrowser
from ctypes import wintypes
from pathlib import Path

import uvicorn

try:
    import tkinter as tk
    from tkinter import messagebox
    HAS_TK = True
except Exception:
    HAS_TK = False


def resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[1]


def app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def free_port(preferred: int, max_tries: int = 50) -> int:
    for port in range(preferred, preferred + max_tries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_exit(message: str = "按 Enter 退出...") -> None:
    try:
        if sys.stdin is not None and sys.stdin.isatty():
            input(message)
            return
    except Exception:
        pass
    time.sleep(3)


def show_error(title: str, message: str) -> None:
    if HAS_TK:
        try:
            root = tk.Tk()
            root.withdraw()
            messagebox.showerror(title, message)
            root.destroy()
            return
        except Exception:
            pass
    try:
        ctypes.windll.user32.MessageBoxW(0, message, title, 0x10)
        return
    except Exception:
        pass
    print(f"{title}: {message}")
    wait_exit()


class TrayState:
    def __init__(self, url: str, log_path: Path) -> None:
        self.url = url
        self.log_path = log_path
        self.server: uvicorn.Server | None = None
        self.should_exit = False


class NativeTrayLauncher:
    """Windows native tray/window fallback when tkinter is unavailable in the frozen build."""

    WM_TRAYICON = 0x8001
    WM_DESTROY = 0x0002
    WM_COMMAND = 0x0111
    WM_NULL = 0x0000
    WM_LBUTTONUP = 0x0202
    WM_LBUTTONDBLCLK = 0x0203
    WM_RBUTTONUP = 0x0205
    WM_CONTEXTMENU = 0x007B
    NIM_ADD = 0x00000000
    NIM_DELETE = 0x00000002
    NIF_MESSAGE = 0x00000001
    NIF_ICON = 0x00000002
    NIF_TIP = 0x00000004
    MF_STRING = 0x00000000
    MF_SEPARATOR = 0x00000800
    TPM_RIGHTBUTTON = 0x0002
    TPM_RETURNCMD = 0x0100
    TPM_NONOTIFY = 0x0080
    ID_OPEN = 1001
    ID_COPY = 1002
    ID_EXIT = 1003

    def __init__(self) -> None:
        self.port = free_port(int(os.environ.get("T3_WEB_PORT", "8080")))
        self.url = f"http://127.0.0.1:{self.port}"
        root_dir = app_root()
        bundle_dir = resource_root()
        self.log_path = root_dir / "launcher.log"
        self.log(f"app_root={root_dir}")
        self.log(f"resource_root={bundle_dir}")
        self.log(f"port={self.port}")
        self.log("launcher=native")
        os.environ.setdefault("T3_WEB_PORT", str(self.port))
        os.environ.setdefault("T3_DATA_DIR", str(root_dir / "data"))
        os.environ.setdefault("T3_DB", str(root_dir / "data" / "app.db"))
        os.environ.setdefault("T3_STATIC_DIR", str(bundle_dir / "static"))
        self.state = TrayState(self.url, self.log_path)
        self.hwnd = None
        self.nid = None
        self.user32 = ctypes.windll.user32
        self.shell32 = ctypes.windll.shell32
        self.kernel32 = ctypes.windll.kernel32
        self._configure_winapi()

    def _configure_winapi(self) -> None:
        # 明确 64 位句柄/消息原型，避免托盘右键菜单消息丢失
        self.user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.user32.DefWindowProcW.restype = ctypes.c_long
        self.user32.CreatePopupMenu.restype = wintypes.HMENU
        self.user32.AppendMenuW.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
        self.user32.AppendMenuW.restype = wintypes.BOOL
        self.user32.TrackPopupMenu.argtypes = [
            wintypes.HMENU,
            wintypes.UINT,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            ctypes.c_void_p,
        ]
        self.user32.TrackPopupMenu.restype = ctypes.c_uint
        self.user32.DestroyMenu.argtypes = [wintypes.HMENU]
        self.user32.DestroyMenu.restype = wintypes.BOOL
        self.user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        self.user32.SetForegroundWindow.restype = wintypes.BOOL
        self.user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
        self.user32.GetCursorPos.restype = wintypes.BOOL
        self.user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.user32.PostMessageW.restype = wintypes.BOOL
        self.shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.c_void_p]
        self.shell32.Shell_NotifyIconW.restype = wintypes.BOOL

    def log(self, message: str) -> None:
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
        except Exception:
            pass

    def start_server(self) -> None:
        try:
            self.log("server starting")
            config = uvicorn.Config(
                "backend.app.main:app",
                host="127.0.0.1",
                port=self.port,
                log_config=None,
                access_log=False,
            )
            self.state.server = uvicorn.Server(config)
            self.state.server.run()
            self.log("server stopped")
        except Exception as exc:
            self.log(f"server failed: {exc!r}")
            show_error("T3 控制台启动失败", f"服务启动失败：{exc}\n\n日志：{self.log_path}")
            self.state.should_exit = True

    def open_browser(self) -> None:
        webbrowser.open(self.url)

    def copy_url(self) -> None:
        try:
            if self.user32.OpenClipboard(None):
                self.user32.EmptyClipboard()
                data = (self.url + "\0").encode("utf-16-le")
                GMEM_MOVEABLE = 0x0002
                handle = self.kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
                if handle:
                    locked = self.kernel32.GlobalLock(handle)
                    if locked:
                        ctypes.memmove(locked, data, len(data))
                        self.kernel32.GlobalUnlock(handle)
                        CF_UNICODETEXT = 13
                        self.user32.SetClipboardData(CF_UNICODETEXT, handle)
                self.user32.CloseClipboard()
        except Exception as exc:
            self.log(f"copy url failed: {exc!r}")

    def _create_window(self):
        # 64 位下 lParam 需要 LRESULT/LONG_PTR 宽度，否则托盘右键事件会丢
        LRESULT = ctypes.c_ssize_t
        WNDPROCTYPE = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

        class WNDCLASS(ctypes.Structure):
            _fields_ = [
                ("style", wintypes.UINT),
                ("lpfnWndProc", WNDPROCTYPE),
                ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int),
                ("hInstance", wintypes.HINSTANCE),
                ("hIcon", wintypes.HICON),
                ("hCursor", wintypes.HANDLE),
                ("hbrBackground", wintypes.HBRUSH),
                ("lpszMenuName", wintypes.LPCWSTR),
                ("lpszClassName", wintypes.LPCWSTR),
            ]

        def wnd_proc(hwnd, msg, wparam, lparam):
            try:
                if msg == self.WM_TRAYICON:
                    event = int(lparam) & 0xFFFF
                    if event in (self.WM_RBUTTONUP, self.WM_CONTEXTMENU):
                        self._show_menu(hwnd)
                    elif event == self.WM_LBUTTONDBLCLK:
                        self.open_browser()
                    elif event == self.WM_LBUTTONUP:
                        # 单击也打开浏览器，提升可用性
                        self.open_browser()
                    return 0
                if msg == self.WM_COMMAND:
                    cmd = int(wparam) & 0xFFFF
                    if cmd == self.ID_OPEN:
                        self.open_browser()
                    elif cmd == self.ID_COPY:
                        self.copy_url()
                    elif cmd == self.ID_EXIT:
                        self.close()
                    return 0
                if msg == self.WM_DESTROY:
                    self._remove_tray()
                    self.user32.PostQuitMessage(0)
                    return 0
                return self.user32.DefWindowProcW(hwnd, msg, wparam, lparam)
            except Exception as exc:
                self.log(f"wnd_proc error: {exc!r}")
                return 0

        self._wnd_proc = WNDPROCTYPE(wnd_proc)
        hinstance = self.kernel32.GetModuleHandleW(None)
        class_name = "T3WebLauncherWindow"
        wc = WNDCLASS()
        wc.style = 0
        wc.lpfnWndProc = self._wnd_proc
        wc.cbClsExtra = 0
        wc.cbWndExtra = 0
        wc.hInstance = hinstance
        wc.hIcon = self.user32.LoadIconW(None, 32512)
        wc.hCursor = self.user32.LoadCursorW(None, 32512)
        wc.hbrBackground = 6
        wc.lpszMenuName = None
        wc.lpszClassName = class_name
        atom = self.user32.RegisterClassW(ctypes.byref(wc))
        if not atom and ctypes.get_last_error() not in (0, 1410):  # already exists is ok on retry
            # 1410 = ERROR_CLASS_ALREADY_EXISTS
            err = ctypes.get_last_error()
            if err not in (0, 1410):
                raise OSError(f"RegisterClassW failed: {err}")
        hwnd = self.user32.CreateWindowExW(
            0,
            class_name,
            "T3 控制台",
            0,
            0,
            0,
            0,
            0,
            None,
            None,
            hinstance,
            None,
        )
        if not hwnd:
            raise OSError(f"CreateWindowExW failed: {ctypes.get_last_error()}")
        self.hwnd = hwnd
        return hwnd

    def _add_tray(self) -> None:
        class NOTIFYICONDATA(ctypes.Structure):
            _fields_ = [
                ("cbSize", wintypes.DWORD),
                ("hWnd", wintypes.HWND),
                ("uID", wintypes.UINT),
                ("uFlags", wintypes.UINT),
                ("uCallbackMessage", wintypes.UINT),
                ("hIcon", wintypes.HICON),
                ("szTip", wintypes.WCHAR * 128),
            ]

        nid = NOTIFYICONDATA()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATA)
        nid.hWnd = self.hwnd
        nid.uID = 1
        nid.uFlags = self.NIF_MESSAGE | self.NIF_ICON | self.NIF_TIP
        nid.uCallbackMessage = self.WM_TRAYICON
        nid.hIcon = self.user32.LoadIconW(None, 32516)
        tip = f"T3 控制台\n{self.url}\n右键可退出"
        nid.szTip = tip[:127]
        if not self.shell32.Shell_NotifyIconW(self.NIM_ADD, ctypes.byref(nid)):
            raise OSError(f"Shell_NotifyIconW failed: {ctypes.get_last_error()}")
        self.nid = nid
        self.log("tray icon added")

    def _remove_tray(self) -> None:
        if self.nid is not None:
            self.shell32.Shell_NotifyIconW(self.NIM_DELETE, ctypes.byref(self.nid))
            self.nid = None

    def _show_menu(self, hwnd) -> None:
        try:
            menu = self.user32.CreatePopupMenu()
            if not menu:
                self.log(f"CreatePopupMenu failed: {ctypes.get_last_error()}")
                return
            self.user32.AppendMenuW(menu, self.MF_STRING, self.ID_OPEN, "打开浏览器")
            self.user32.AppendMenuW(menu, self.MF_STRING, self.ID_COPY, "复制地址")
            self.user32.AppendMenuW(menu, self.MF_SEPARATOR, 0, None)
            self.user32.AppendMenuW(menu, self.MF_STRING, self.ID_EXIT, "退出")

            point = wintypes.POINT()
            self.user32.GetCursorPos(ctypes.byref(point))
            self.user32.SetForegroundWindow(hwnd)
            # TPM_RETURNCMD: 直接返回菜单 ID，避免依赖 WM_COMMAND 丢失
            cmd = self.user32.TrackPopupMenu(
                menu,
                self.TPM_RIGHTBUTTON | self.TPM_RETURNCMD | self.TPM_NONOTIFY,
                point.x,
                point.y,
                0,
                hwnd,
                None,
            )
            # 防止菜单首次点击被吞
            self.user32.PostMessageW(hwnd, self.WM_NULL, 0, 0)
            self.user32.DestroyMenu(menu)
            self.log(f"tray menu cmd={cmd}")
            if cmd == self.ID_OPEN:
                self.open_browser()
            elif cmd == self.ID_COPY:
                self.copy_url()
            elif cmd == self.ID_EXIT:
                self.close()
        except Exception as exc:
            self.log(f"show_menu failed: {exc!r}")

    def close(self) -> None:
        self.log("closing")
        self.state.should_exit = True
        if self.state.server:
            self.state.server.should_exit = True
        if self.hwnd:
            self.user32.DestroyWindow(self.hwnd)

    def run(self) -> None:
        self._create_window()
        self._add_tray()
        thread = threading.Thread(target=self.start_server, daemon=True)
        thread.start()
        threading.Timer(1.0, self.open_browser).start()
        threading.Timer(
            0.4,
            lambda: ctypes.windll.user32.MessageBoxW(
                0,
                f"服务已启动：\n{self.url}\n\n默认账号：admin / admin\n\n托盘图标：\n· 单击/双击打开浏览器\n· 右键可“退出”",
                "T3 控制台",
                0x40,
            ),
        ).start()
        msg = wintypes.MSG()
        while True:
            ret = self.user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if ret == 0 or ret == -1 or self.state.should_exit:
                break
            self.user32.TranslateMessage(ctypes.byref(msg))
            self.user32.DispatchMessageW(ctypes.byref(msg))
        self._remove_tray()
        if self.state.server:
            self.state.server.should_exit = True
        self.log("native launcher exited")


class ConsoleLauncher:
    def __init__(self) -> None:
        self.port = free_port(int(os.environ.get("T3_WEB_PORT", "8080")))
        self.url = f"http://127.0.0.1:{self.port}"
        root_dir = app_root()
        bundle_dir = resource_root()
        self.log_path = root_dir / "launcher.log"
        self.log(f"app_root={root_dir}")
        self.log(f"resource_root={bundle_dir}")
        self.log(f"port={self.port}")
        self.log("launcher=console")
        os.environ.setdefault("T3_WEB_PORT", str(self.port))
        os.environ.setdefault("T3_DATA_DIR", str(root_dir / "data"))
        os.environ.setdefault("T3_DB", str(root_dir / "data" / "app.db"))
        os.environ.setdefault("T3_STATIC_DIR", str(bundle_dir / "static"))

    def log(self, message: str) -> None:
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
        except Exception:
            pass

    def run(self) -> None:
        self.log("server starting")
        print("=" * 50)
        print("  T3 控制台")
        print(f"  地址：{self.url}")
        print("  默认账号：admin / admin")
        print("=" * 50)
        webbrowser.open(self.url)
        try:
            config = uvicorn.Config("backend.app.main:app", host="127.0.0.1", port=self.port, log_config=None, access_log=False)
            server = uvicorn.Server(config)
            server.run()
            self.log("server stopped")
        except Exception as exc:
            self.log(f"server failed: {exc!r}")
            print(f"启动失败：{exc}")
            print(f"日志：{self.log_path}")
            wait_exit()


class TkLauncher:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("T3 控制台")
        self.root.geometry("380x250")
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
        self.log("launcher=tk")
        os.environ.setdefault("T3_WEB_PORT", str(self.port))
        os.environ.setdefault("T3_DATA_DIR", str(root_dir / "data"))
        os.environ.setdefault("T3_DB", str(root_dir / "data" / "app.db"))
        os.environ.setdefault("T3_STATIC_DIR", str(bundle_dir / "static"))

        self.server: uvicorn.Server | None = None
        self._build_ui()
        self._bind_menu()

    def log(self, message: str) -> None:
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
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

        tk.Label(frame, text="默认账号：admin / admin", font=("Microsoft YaHei UI", 9), bg="#fafafa", fg="#71717a").pack(anchor="w", pady=(14, 0))
        tk.Label(frame, text="提示：窗口内右键也可退出", font=("Microsoft YaHei UI", 9), bg="#fafafa", fg="#a1a1aa").pack(anchor="w", pady=(6, 0))

    def _bind_menu(self) -> None:
        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(label="打开浏览器", command=self.open_browser)
        menu.add_separator()
        menu.add_command(label="退出", command=self.close)

        def popup(event) -> None:
            try:
                menu.tk_popup(event.x_root, event.y_root)
            finally:
                menu.grab_release()

        self.root.bind("<Button-3>", popup)
        for child in self.root.winfo_children():
            child.bind("<Button-3>", popup)

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
        if sys.platform.startswith("win"):
            NativeTrayLauncher().run()
        else:
            ConsoleLauncher().run()
    except Exception as exc:
        show_error("T3 控制台启动失败", f"{exc}\n\n若 8080 端口被占用，程序会自动尝试其他端口。\n也可先关闭已运行的 T3Web.exe 后重试。")


if __name__ == "__main__":
    main()
