from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from .config import DATA_DIR, LOCAL_TOOL_VERSION

CLOUD_BASE = os.environ.get("T3_CLOUD_BASE", "https://cloud.1992418.xyz").rstrip("/")
CLOUD_DIR = os.environ.get("T3_CLOUD_DIR", "/T3")
HTTP_TIMEOUT = float(os.environ.get("T3_UPDATE_TIMEOUT", "30"))
DOWNLOAD_TIMEOUT = float(os.environ.get("T3_UPDATE_DOWNLOAD_TIMEOUT", "300"))

_VERSION_RE = re.compile(
    r"(?i)(?:^|[_v\-.\s])v?(\d+(?:\.\d+){1,3})(?:$|[_v\-.\s])"
)
_state_lock = threading.Lock()


def app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def current_exe_path() -> Path | None:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve()
    return None


def updates_dir() -> Path:
    path = app_root() / "updates"
    path.mkdir(parents=True, exist_ok=True)
    return path


def state_path() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR / "self_update_state.json"


def parse_version_tuple(text: str) -> tuple[int, ...]:
    parts = [int(x) for x in re.findall(r"\d+", text or "")]
    if not parts:
        return (0,)
    return tuple(parts)


def compare_version(a: str, b: str) -> int:
    ta = parse_version_tuple(a)
    tb = parse_version_tuple(b)
    n = max(len(ta), len(tb))
    ta = ta + (0,) * (n - len(ta))
    tb = tb + (0,) * (n - len(tb))
    if ta < tb:
        return -1
    if ta > tb:
        return 1
    return 0


def extract_version_from_name(name: str) -> str:
    match = _VERSION_RE.search(name or "")
    return match.group(1) if match else ""


@dataclass
class RemotePackage:
    name: str
    path: str
    size: int = 0
    modified: str = ""
    version: str = ""
    notes: str = ""
    source: str = "exe"
    download_url: str = ""

    @property
    def signature(self) -> str:
        return f"{self.name}|{self.size}|{self.modified}|{self.version}"


@dataclass
class UpdateState:
    status: str = "idle"
    message: str = ""
    localVersion: str = LOCAL_TOOL_VERSION
    remoteVersion: str = ""
    hasUpdate: bool = False
    packageName: str = ""
    packagePath: str = ""
    packageSize: int = 0
    packageModified: str = ""
    packageNotes: str = ""
    packageSource: str = ""
    packageSignature: str = ""
    downloadUrl: str = ""
    downloadedPath: str = ""
    progress: float = 0.0
    checkedAt: float = 0.0
    error: str = ""
    restartRequired: bool = False
    cloudBase: str = CLOUD_BASE
    cloudDir: str = CLOUD_DIR
    appliedSignature: str = ""
    history: list[dict[str, Any]] = field(default_factory=list)


_state = UpdateState()


def _load_persisted() -> None:
    path = state_path()
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        _state.appliedSignature = str(data.get("appliedSignature") or "")
        if data.get("localVersion"):
            _state.localVersion = str(data.get("localVersion"))
    except Exception:
        pass


def _persist() -> None:
    path = state_path()
    payload = {
        "appliedSignature": _state.appliedSignature,
        "localVersion": _state.localVersion,
        "updatedAt": time.time(),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


_load_persisted()


def get_state() -> dict[str, Any]:
    with _state_lock:
        data = asdict(_state)
        data["localVersion"] = LOCAL_TOOL_VERSION
        data["isFrozen"] = bool(getattr(sys, "frozen", False))
        data["exePath"] = str(current_exe_path() or "")
        return data


def _set_state(**kwargs: Any) -> None:
    with _state_lock:
        for key, value in kwargs.items():
            if hasattr(_state, key):
                setattr(_state, key, value)


def _alist_post(api_path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{CLOUD_BASE}{api_path}"
    with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True, trust_env=False) as client:
        response = client.post(url, json=payload)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("网盘返回格式无效")
    if int(data.get("code") or 0) != 200:
        raise RuntimeError(str(data.get("message") or "网盘请求失败"))
    result = data.get("data")
    return result if isinstance(result, dict) else {}


def _list_cloud_dir(path: str) -> list[dict[str, Any]]:
    data = _alist_post(
        "/api/fs/list",
        {
            "path": path,
            "password": "",
            "page": 1,
            "per_page": 0,
            "refresh": False,
        },
    )
    content = data.get("content") or []
    return content if isinstance(content, list) else []


def _get_cloud_file(path: str) -> dict[str, Any]:
    return _alist_post("/api/fs/get", {"path": path, "password": ""})


def _resolve_download_url(file_path: str, meta: dict[str, Any] | None = None) -> str:
    meta = meta or _get_cloud_file(file_path)
    raw_url = str(meta.get("raw_url") or "").strip()
    if raw_url:
        return raw_url
    # Alist 直链兜底
    encoded = "/".join(quote(part) for part in file_path.strip("/").split("/"))
    return f"{CLOUD_BASE}/d/{encoded}"


def _load_version_manifest() -> dict[str, Any] | None:
    candidates = [
        f"{CLOUD_DIR.rstrip('/')}/version.json",
        f"{CLOUD_DIR.rstrip('/')}/T3Web.version.json",
        f"{CLOUD_DIR.rstrip('/')}/local-tool.json",
    ]
    for path in candidates:
        try:
            meta = _get_cloud_file(path)
            raw_url = _resolve_download_url(path, meta)
            with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True, trust_env=False) as client:
                response = client.get(raw_url)
            if response.status_code >= 400:
                continue
            data = response.json()
            if isinstance(data, dict):
                data["_manifestPath"] = path
                return data
        except Exception:
            continue
    return None


def _pick_exe_package(items: list[dict[str, Any]]) -> RemotePackage | None:
    exe_items: list[RemotePackage] = []
    for item in items:
        if item.get("is_dir"):
            continue
        name = str(item.get("name") or "")
        if not name.lower().endswith(".exe"):
            continue
        lower = name.lower()
        if "t3web" not in lower and "t3" not in lower and "本地助手" not in name:
            # 仍允许通用 exe，但优先 T3Web
            pass
        path = f"{CLOUD_DIR.rstrip('/')}/{name}"
        package = RemotePackage(
            name=name,
            path=path,
            size=int(item.get("size") or 0),
            modified=str(item.get("modified") or ""),
            version=extract_version_from_name(name),
            source="exe",
        )
        exe_items.append(package)

    if not exe_items:
        return None

    def score(pkg: RemotePackage) -> tuple:
        name_l = pkg.name.lower()
        prefer = 0
        if name_l == "t3web.exe":
            prefer = 100
        elif "t3web" in name_l:
            prefer = 80
        elif name_l.startswith("t3"):
            prefer = 60
        ver = parse_version_tuple(pkg.version) if pkg.version else (0,)
        return (prefer, ver, pkg.modified, pkg.size)

    exe_items.sort(key=score, reverse=True)
    return exe_items[0]


def discover_remote_package() -> RemotePackage:
    manifest = _load_version_manifest()
    if manifest:
        version = str(manifest.get("version") or manifest.get("latest") or manifest.get("latestVersion") or "").strip()
        filename = str(manifest.get("filename") or manifest.get("file") or manifest.get("name") or "T3Web.exe").strip()
        notes = str(manifest.get("notes") or manifest.get("changelog") or manifest.get("message") or "").strip()
        path = str(manifest.get("path") or f"{CLOUD_DIR.rstrip('/')}/{filename}").strip()
        if not path.startswith("/"):
            path = f"{CLOUD_DIR.rstrip('/')}/{path.lstrip('/')}"
        size = int(manifest.get("size") or 0)
        modified = str(manifest.get("modified") or "")
        download_url = str(manifest.get("url") or manifest.get("downloadUrl") or "").strip()
        # 补全网盘元数据
        try:
            meta = _get_cloud_file(path)
            size = size or int(meta.get("size") or 0)
            modified = modified or str(meta.get("modified") or "")
            if not download_url:
                download_url = _resolve_download_url(path, meta)
        except Exception:
            if not download_url:
                download_url = _resolve_download_url(path)
        if not version:
            version = extract_version_from_name(filename)
        return RemotePackage(
            name=Path(path).name or filename,
            path=path,
            size=size,
            modified=modified,
            version=version or LOCAL_TOOL_VERSION,
            notes=notes,
            source="manifest",
            download_url=download_url,
        )

    items = _list_cloud_dir(CLOUD_DIR)
    package = _pick_exe_package(items)
    if not package:
        raise RuntimeError(f"网盘目录 {CLOUD_DIR} 未找到可升级的 EXE（例如 T3Web.exe）")
    if not package.version:
        # 无版本号时用修改时间作为可比较标签
        package.version = package.modified or "cloud"
    package.download_url = _resolve_download_url(package.path)
    return package


def _is_semver(text: str) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+){1,3}", (text or "").strip()))


def _has_update(package: RemotePackage) -> tuple[bool, str]:
    local_version = LOCAL_TOOL_VERSION
    local_exe = current_exe_path()

    # 已成功应用过同一网盘包
    if package.signature and package.signature == _state.appliedSignature:
        return False, f"已是最新（已安装网盘包 {package.name}）"

    if package.source == "manifest" and _is_semver(package.version):
        cmp = compare_version(local_version, package.version)
        if cmp < 0:
            return True, f"发现新版本 {package.version}（当前 {local_version}）"
        if cmp > 0:
            return False, f"当前版本 {local_version} 新于网盘 {package.version}"
        if local_exe and local_exe.exists() and package.size and package.size != local_exe.stat().st_size:
            return True, f"版本同为 {package.version}，但网盘文件大小变化，可更新"
        return False, f"已是最新版本 {local_version}"

    # 文件名带语义版本：T3Web-1.2.0.exe
    if _is_semver(package.version):
        cmp = compare_version(local_version, package.version)
        if cmp < 0:
            return True, f"发现新版本 {package.version}（当前 {local_version}）"
        if cmp > 0:
            return False, f"当前版本 {local_version} 新于网盘 {package.version}"

    # 无 version.json：按本地 EXE 大小/签名判断
    if local_exe and local_exe.exists() and package.size:
        local_size = local_exe.stat().st_size
        if package.size != local_size:
            return True, f"检测到网盘 EXE 有变化（本地 {local_size} / 网盘 {package.size}）"
        return False, "网盘 EXE 与本地大小一致，暂无更新"

    # 开发模式无 EXE 可对比时，只要网盘有包就提示可下载
    return True, f"检测到网盘安装包 {package.name}，可下载更新"


def check_for_update() -> dict[str, Any]:
    _set_state(status="checking", message="正在连接网盘检测版本...", error="", progress=0.0)
    try:
        package = discover_remote_package()
        has_update, message = _has_update(package)
        _set_state(
            status="checked",
            message=message,
            localVersion=LOCAL_TOOL_VERSION,
            remoteVersion=package.version,
            hasUpdate=has_update,
            packageName=package.name,
            packagePath=package.path,
            packageSize=package.size,
            packageModified=package.modified,
            packageNotes=package.notes,
            packageSource=package.source,
            packageSignature=package.signature,
            downloadUrl=package.download_url,
            error="",
            checkedAt=time.time(),
            cloudBase=CLOUD_BASE,
            cloudDir=CLOUD_DIR,
        )
        return get_state()
    except Exception as exc:
        _set_state(status="error", message="检测失败", error=str(exc), hasUpdate=False)
        return get_state()


def _download_file(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".part")
    if temp.exists():
        temp.unlink()
    with httpx.Client(timeout=DOWNLOAD_TIMEOUT, follow_redirects=True, trust_env=False) as client:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length") or 0)
            done = 0
            with temp.open("wb") as f:
                for chunk in response.iter_bytes(chunk_size=1024 * 256):
                    if not chunk:
                        continue
                    f.write(chunk)
                    done += len(chunk)
                    progress = (done / total * 100.0) if total > 0 else min(99.0, done / (1024 * 1024))
                    _set_state(progress=round(progress, 2), message=f"下载中 {done // 1024} KB")
    temp.replace(target)
    _set_state(progress=100.0)


def download_update(force: bool = False) -> dict[str, Any]:
    with _state_lock:
        if _state.status == "downloading":
            return get_state()
        package_name = _state.packageName
        package_path = _state.packagePath
        download_url = _state.downloadUrl
        has_update = _state.hasUpdate
        signature = _state.packageSignature
        size = _state.packageSize

    if not package_name or not package_path:
        check_for_update()
        with _state_lock:
            package_name = _state.packageName
            package_path = _state.packagePath
            download_url = _state.downloadUrl
            has_update = _state.hasUpdate
            signature = _state.packageSignature
            size = _state.packageSize

    if not force and not has_update:
        _set_state(status="checked", message="当前已是最新，无需下载")
        return get_state()

    if not download_url:
        try:
            download_url = _resolve_download_url(package_path)
        except Exception as exc:
            _set_state(status="error", error=str(exc), message="获取下载地址失败")
            return get_state()

    target = updates_dir() / package_name
    _set_state(
        status="downloading",
        message="开始下载...",
        error="",
        progress=0.0,
        downloadUrl=download_url,
        downloadedPath="",
    )
    try:
        _download_file(download_url, target)
        actual_size = target.stat().st_size
        if size > 0 and actual_size != size:
            # 允许云盘 size 不精确，只告警不阻断
            _set_state(message=f"下载完成（大小 {actual_size}，网盘标记 {size}）")
        _set_state(
            status="downloaded",
            message="下载完成，可执行升级",
            downloadedPath=str(target),
            progress=100.0,
            packageSignature=signature,
        )
        return get_state()
    except Exception as exc:
        _set_state(status="error", message="下载失败", error=str(exc), progress=0.0)
        return get_state()


def _write_windows_updater_script(current_exe: Path, new_exe: Path, work_dir: Path) -> Path:
    script = updates_dir() / "apply_update.bat"
    log_file = updates_dir() / "apply_update.log"
    # 等待当前进程退出后替换并重启
    content = f"""@echo off
chcp 65001 >nul
setlocal
set "TARGET={current_exe}"
set "SOURCE={new_exe}"
set "WORKDIR={work_dir}"
set "LOG={log_file}"
echo %date% %time% start update>>"%LOG%"
:wait
ping 127.0.0.1 -n 2 >nul
tasklist /FI "IMAGENAME eq {current_exe.name}" | find /I "{current_exe.name}" >nul
if not errorlevel 1 goto wait
ping 127.0.0.1 -n 2 >nul
copy /Y "%SOURCE%" "%TARGET%" >>"%LOG%" 2>&1
if errorlevel 1 (
  echo copy failed>>"%LOG%"
  exit /b 1
)
echo copy ok>>"%LOG%"
start "" /D "%WORKDIR%" "%TARGET%"
echo restarted>>"%LOG%"
exit /b 0
"""
    script.write_text(content, encoding="gbk", errors="ignore")
    return script


def apply_update(restart: bool = True) -> dict[str, Any]:
    with _state_lock:
        downloaded = _state.downloadedPath
        package_name = _state.packageName
        signature = _state.packageSignature
        remote_version = _state.remoteVersion

    current_exe = current_exe_path()
    if not current_exe:
        _set_state(
            status="error",
            message="开发模式不支持自动替换 EXE，请使用打包后的 T3Web.exe",
            error="not_frozen",
        )
        return get_state()

    source = Path(downloaded) if downloaded else updates_dir() / (package_name or "T3Web.exe")
    if not source.exists():
        _set_state(status="error", message="未找到已下载的安装包，请先下载", error="missing_package")
        return get_state()

    if source.resolve() == current_exe.resolve():
        _set_state(status="error", message="下载文件与当前程序相同，无法覆盖", error="same_file")
        return get_state()

    _set_state(status="applying", message="正在准备替换程序...", error="")
    try:
        backup = updates_dir() / f"{current_exe.stem}.bak"
        try:
            shutil.copy2(current_exe, backup)
        except Exception:
            pass

        script = _write_windows_updater_script(current_exe, source, current_exe.parent)
        _state.appliedSignature = signature
        _state.localVersion = remote_version or LOCAL_TOOL_VERSION
        _persist()
        _set_state(
            status="restarting" if restart else "applied",
            message="升级脚本已启动，程序即将重启" if restart else "升级文件已就绪",
            restartRequired=True,
            progress=100.0,
        )

        if restart:
            # 分离进程执行替换脚本
            subprocess.Popen(
                ["cmd", "/c", str(script)],
                cwd=str(current_exe.parent),
                close_fds=True,
                creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0) | getattr(subprocess, "DETACHED_PROCESS", 0),
            )

            def _exit_later() -> None:
                time.sleep(1.2)
                os._exit(0)

            threading.Thread(target=_exit_later, daemon=True).start()
        return get_state()
    except Exception as exc:
        _set_state(status="error", message="升级失败", error=str(exc))
        return get_state()


def download_and_apply(force: bool = False, restart: bool = True) -> dict[str, Any]:
    state = download_update(force=force)
    if state.get("status") != "downloaded":
        return state
    return apply_update(restart=restart)
