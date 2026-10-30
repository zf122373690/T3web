#!/bin/bash
# ============================================================
#  T3 控制台 · 飞牛 fnOS .fpk 安装包构建脚本
#
#  用法：
#    ./build-fpk.sh                       # 使用默认镜像 t3web:latest、x86 平台
#    T3_IMAGE=myreg/t3web:1.1.0 ./build-fpk.sh
#    ./build-fpk.sh <image> <platform>    # platform: x86 / arm
#
#  产物：dist/t3web_<version>_<platform>.fpk
#  依赖：bash、tar、md5sum（Windows Git Bash 均自带）
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$SCRIPT_DIR/fnos"

IMAGE="${1:-${T3_IMAGE:-t3web:latest}}"
PLATFORM="${2:-x86}"

command -v tar >/dev/null || { echo "[ERROR] 未找到 tar"; exit 1; }
command -v md5sum >/dev/null || { echo "[ERROR] 未找到 md5sum"; exit 1; }

# 读取版本号
VERSION=$(grep '^version' "$SRC/manifest" | awk -F'=' '{print $2}' | tr -d ' \r')
[ -n "$VERSION" ] || { echo "[ERROR] 无法从 manifest 读取 version"; exit 1; }

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# ---------- 1. 组装 app.tgz（载荷：docker/ + ui/，由 fnOS 解压到 target/） ----------
PAYLOAD="$WORK_DIR/payload"
mkdir -p "$PAYLOAD"
cp -a "$SRC/payload/docker" "$PAYLOAD/"
cp -a "$SRC/ui" "$PAYLOAD/"

# 注入镜像名（compose 中的 image 行）
sed -i "s|image: t3web:latest|image: ${IMAGE}|" "$PAYLOAD/docker/docker-compose.yaml"
grep -q "image: ${IMAGE}" "$PAYLOAD/docker/docker-compose.yaml" \
    || { echo "[ERROR] 镜像名注入失败"; exit 1; }

(cd "$PAYLOAD" && tar -czf "$WORK_DIR/app.tgz" docker/ ui/)

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

# manifest：写入 checksum（app.tgz 的 md5）、覆盖 platform
CHECKSUM=$(md5sum "$WORK_DIR/app.tgz" | cut -d' ' -f1)
cp "$SRC/manifest" "$PKG/manifest"
sed -i "s|^checksum.*|checksum        = ${CHECKSUM}|" "$PKG/manifest"
if grep -q '^platform' "$PKG/manifest"; then
    sed -i "s|^platform.*|platform        = ${PLATFORM}|" "$PKG/manifest"
else
    echo "platform        = ${PLATFORM}" >> "$PKG/manifest"
fi

# 校验必要文件
for f in manifest ICON.PNG ICON_256.PNG app.tgz config/privilege config/resource cmd/main wizard/install ui/config; do
    [ -e "$PKG/$f" ] || { echo "[ERROR] fpk 缺少必要文件: $f"; exit 1; }
done

# ---------- 3. 打包 ----------
mkdir -p "$ROOT_DIR/dist"
FPK_NAME="t3web_${VERSION}_${PLATFORM}.fpk"
(cd "$PKG" && tar -czf "$ROOT_DIR/dist/$FPK_NAME" *)

echo "[OK] 已生成 dist/$FPK_NAME"
echo "     镜像: $IMAGE"
echo "     安装方式：fnOS 应用中心 → 手动安装 → 上传该 .fpk"
