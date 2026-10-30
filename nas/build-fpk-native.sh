#!/bin/bash
# ============================================================
#  T3 控制台 · 飞牛 fnOS 原生模式 .fpk 构建脚本
#
#  用法：
#    ./build-fpk-native.sh                # 默认 x86
#    ./build-fpk-native.sh <platform>     # x86 / arm
#
#  产物：dist/t3web-native_<version>_<platform>.fpk
#  说明：载荷为 backend/ 源码 + 前端构建产物（backend/static/），
#        运行依赖 fnOS 系统 Python 3.12 运行时（install_dep_apps=python312），
#        依赖包在安装时在线安装（排除 pyserial/pyinstaller）。
#  前置：若 backend/static 不存在或已过期，先在仓库根目录执行前端构建。
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$SCRIPT_DIR/fnos-native"

PLATFORM="${1:-x86}"

command -v tar >/dev/null || { echo "[ERROR] 未找到 tar"; exit 1; }
command -v md5sum >/dev/null || { echo "[ERROR] 未找到 md5sum"; exit 1; }

# 前端构建产物必须存在
if [ ! -f "$ROOT_DIR/backend/static/index.html" ]; then
    echo "[ERROR] 缺少前端构建产物 backend/static/index.html"
    echo "        请先在 frontend/ 目录执行: npm install && npm run build"
    echo "        并将 dist/ 内容复制到 backend/static/"
    exit 1
fi

VERSION=$(grep '^version' "$SRC/manifest" | awk -F'=' '{print $2}' | tr -d ' \r')
[ -n "$VERSION" ] || { echo "[ERROR] 无法从 manifest 读取 version"; exit 1; }

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# ---------- 1. 组装 app.tgz（载荷：backend/ + ui/） ----------
PAYLOAD="$WORK_DIR/payload"
mkdir -p "$PAYLOAD/backend"

# 后端源码 + 依赖清单 + 前端构建产物；排除缓存
cp -a "$ROOT_DIR/backend/app" "$PAYLOAD/backend/"
cp "$ROOT_DIR/backend/requirements.txt" "$PAYLOAD/backend/"
cp -a "$ROOT_DIR/backend/static/." "$PAYLOAD/backend/static/"
find "$PAYLOAD/backend" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
find "$PAYLOAD/backend" -name '*.pyc' -delete 2>/dev/null || true

cp -a "$SRC/ui" "$PAYLOAD/"

(cd "$PAYLOAD" && tar -czf "$WORK_DIR/app.tgz" backend/ ui/)

# ---------- 2. 组装 fpk 目录 ----------
PKG="$WORK_DIR/package"
mkdir -p "$PKG/cmd"

cp "$WORK_DIR/app.tgz" "$PKG/"
cp -a "$SRC/cmd/." "$PKG/cmd/"
# Windows 打包会丢失可执行位，fnOS 要求 cmd 脚本必须可执行
chmod 755 "$PKG"/cmd/*
cp -a "$SRC/config" "$PKG/"
cp -a "$SRC/wizard" "$PKG/"
cp -a "$SRC/ui" "$PKG/"
cp "$SRC/ICON.PNG" "$SRC/ICON_256.PNG" "$PKG/"

CHECKSUM=$(md5sum "$WORK_DIR/app.tgz" | cut -d' ' -f1)
cp "$SRC/manifest" "$PKG/manifest"
sed -i "s|^checksum.*|checksum        = ${CHECKSUM}|" "$PKG/manifest"
if grep -q '^platform' "$PKG/manifest"; then
    sed -i "s|^platform.*|platform        = ${PLATFORM}|" "$PKG/manifest"
else
    echo "platform        = ${PLATFORM}" >> "$PKG/manifest"
fi

for f in manifest ICON.PNG ICON_256.PNG app.tgz config/privilege config/resource cmd/main cmd/install_init cmd/install_callback wizard/install ui/config; do
    [ -e "$PKG/$f" ] || { echo "[ERROR] fpk 缺少必要文件: $f"; exit 1; }
done

# ---------- 3. 打包 ----------
mkdir -p "$ROOT_DIR/dist"
FPK_NAME="t3web-native_${VERSION}_${PLATFORM}.fpk"
(cd "$PKG" && tar -czf "$ROOT_DIR/dist/$FPK_NAME" *)

echo "[OK] 已生成 dist/$FPK_NAME"
echo "     模式：原生 Python（依赖 fnOS python312 运行时，安装时在线装依赖）"
echo "     安装方式：fnOS 应用中心 → 手动安装 → 上传该 .fpk"
