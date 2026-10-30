# NAS 部署（飞牛 fnOS / 绿联 UGOS Pro）

本目录提供 T3 短信转发控制台在两款国产 NAS 系统上的适配产物。两者均基于
仓库根目录的 `Dockerfile` 构建的镜像运行，**仅支持局域网设备模式**（容器内
无法访问 USB 串口）。

## 前置：构建镜像

在电脑上（或 NAS 支持在线构建时直接在 NAS 上）执行：

```bash
docker build -t t3web:latest .
```

离线导入 NAS：

```bash
docker save t3web:latest -o t3web.tar
# 在 NAS 的 Docker 应用中导入 t3web.tar
```

> 局域网设备扫描要求容器与 T3 设备处于同一网段，两个平台的配置均已启用
> **主机网络模式（host）**，监听端口 `8080`。

---

## 一、飞牛 fnOS（应用中心 .fpk 安装包）

fnOS 支持通过应用中心「手动安装」上传第三方 `.fpk` 包。本目录 `fnos/` 为
应用包源文件，`build-fpk.sh` 用于构建。

### 构建 .fpk

```bash
cd nas
./build-fpk.sh                       # 默认镜像 t3web:latest，platform=x86
T3_IMAGE=myreg/t3web:1.1.0 ./build-fpk.sh   # 指定镜像
./build-fpk.sh t3web:latest arm      # arm 平台（需 arm64 镜像）
```

产物：`dist/t3web_<version>_<platform>.fpk`。

### 安装

1. 确认 fnOS 已安装 Docker，且 `t3web` 镜像已导入。
2. 应用中心 → 右上角「手动安装」→ 上传 `.fpk`。
3. 按向导设置控制台登录账号（密码留空默认 `admin`）。
4. 安装完成后桌面出现「T3 短信转发控制台」图标，点击访问 `http://NAS的IP:8080`。

### fpk 结构说明

- `manifest` — 应用标识、版本、端口（8080）、平台
- `cmd/` — 生命周期脚本；Docker 模式下容器启停由应用中心按 compose 管理，`cmd/main` 仅回报容器状态
- `config/resource` — 声明 `docker-project`，compose 位于 `target/docker/`
- `wizard/install` — 安装向导（登录账号）
- `payload/docker/docker-compose.yaml` — 打入 `app.tgz` 的 compose（构建时注入镜像名）
- 数据目录：应用卸载后仍保留于 `/vol*/@appdata/t3web/`

升级：更新镜像后重新 `build-fpk.sh`（递增 `fnos/manifest` 的 version）并手动安装覆盖。

### 原生模式（不依赖 Docker）

`fnos-native/` + `build-fpk-native.sh` 提供**原生 Python** 版本，无需 Docker
和镜像导入，但**首次安装需联网**（在线 pip 安装依赖）：

```bash
cd nas
./build-fpk-native.sh          # 产物 dist/t3web-native_<version>_<platform>.fpk
```

- 运行依赖 fnOS 系统 Python 3.12 运行时（`install_dep_apps = python312`，
  应用中心会自动安装）
- 载荷为 `backend/` 源码 + 前端构建产物（需先 `npm run build` 到
  `backend/static/`）
- 安装时创建 venv 到应用数据目录，自动排除 pyserial（NAS 无串口，导入
  失败已有容错）/pyinstaller
- 升级：递增 `fnos-native/manifest` 的 version 后重新打包安装，venv 复用、
  数据（`/vol*/@appdata/t3web/`）保留

---

## 二、绿联 UGOS Pro（Docker 项目部署）

UGOS Pro 未开放第三方原生应用安装格式，官方途径是内置 **Docker 应用的「项目
（Compose）」** 功能。

1. 按上文方式构建并导入 `t3web` 镜像。
2. UGOS 桌面 → **Docker** → **项目** → 创建项目，名称 `t3web`。
3. 将 `ugos/docker-compose.yml` 的内容粘贴到项目配置中，启动。
4. 访问 `http://NAS的IP:8080`（默认 `admin / admin`，可在 compose 中修改）。

数据默认保存在项目目录下的 `data/`，如需指定共享目录可将 `./data` 改为如
`/volume1/T3Web/data`。

升级：导入新镜像（同名 tag 或修改 compose 中的 tag）后在项目中重建容器。

---

## 常见问题

- **扫描不到设备**：确认使用主机网络模式；检查 NAS 与 T3 设备是否同一网段、同 VLAN。
- **容器无法启动**：多为镜像不存在，检查镜像 tag 与 compose 中 `image` 是否一致。
- **需要串口配置设备**：请在 Windows 电脑上使用 `T3Web.exe` 或源码方式运行。
