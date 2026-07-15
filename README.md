# T3 Web

T3 Web 是短信转发设备的本地管理控制台，提供局域网设备管理、MQTT 上报配置、短信/通话记录归档、本地串口配置和 Windows 单文件打包能力。

旧代码已归档到 `legacy_current_code/`，仅作为历史参考；当前可维护代码位于 `backend/` 和 `frontend/`。

## 功能概览

- 模式选择：支持“串口配置”和“局域网设备”两种工作模式。
- 局域网设备管理：扫描、手动添加、刷新、批量删除、重启、恢复出厂、飞行模式、AT 指令、OTA 检查和升级。
- MQTT 上报配置：读取和保存固件中的 MQTT 配置，兼容扁平字段和 `mqtt` 嵌套结构。
- 短信记录：以对话形式查看短信记录，支持筛选、删除、清空和发送短信。
- 通话记录：独立通话记录页面，支持查看、删除和清空。
- 串口工作台：多串口连接、配置读取/写入、配置复刻、导入导出、诊断、DTR/RTS 控制和底部实时日志。
- Windows 打包：支持生成无黑色控制台窗口的单文件 `T3Web.exe`。

## 技术栈

- 后端：FastAPI、Uvicorn、SQLite、HTTPX、PySerial
- 前端：React 19、React Router、Vite、TypeScript、Lucide React
- 打包：PyInstaller

## 目录结构

```text
backend/                 后端服务
  app/                   FastAPI 应用和业务代码
  static/                前端构建后复制到这里
  win_launcher.py        Windows 图形启动器
frontend/                React 前端
legacy_current_code/     旧代码归档
build-win.ps1            Windows 单文件 EXE 打包脚本
start.bat                Windows 开发/本地启动脚本
start.sh                 Linux/macOS 本地启动脚本
```

## 环境要求

- Python 3.11+
- Node.js 18+
- npm
- Windows 打包需要在 Windows 环境执行

## 本地启动

### Windows

```powershell
.\start.bat
```

脚本会自动安装后端依赖、构建前端，并启动后端服务。

当前 `start.bat` 启动端口为：

```text
http://127.0.0.1:8080
```

### Linux / macOS

```bash
./start.sh
```

默认访问地址：

```text
http://127.0.0.1:8080
```

## EXE 版本

项目支持 Windows 单文件 EXE 格式，适合不想手动启动 Python / Node 环境的用户。

已打包后的文件路径为：

```text
dist\T3Web.exe
```

使用方式：

1. 双击 `T3Web.exe`。
2. 等待图形启动窗口打开。
3. 程序会自动启动本地 Web 服务。
4. 程序会自动打开浏览器进入控制台。

EXE 版本特点：

- 单文件运行，不需要复制整个 `dist/T3Web/` 文件夹。
- 无黑色控制台窗口。
- 自动选择可用端口。
- 自动创建本地数据目录。
- 运行日志写入 EXE 同目录的 `launcher.log`。
- 数据库默认保存在 EXE 同目录的 `data/app.db`。

如果 EXE 启动失败，请查看同目录下的：

```text
launcher.log
```

## 默认账号

```text
用户名：admin
密码：admin123
```

可通过环境变量覆盖：

```powershell
$env:T3_UI_USER="admin"
$env:T3_UI_PASS="admin123"
```

## 前端开发

```powershell
cd frontend
npm install
npm run dev
```

生产构建：

```powershell
cd frontend
npm run build
```

## 后端开发

```powershell
python -m pip install -r backend\requirements.txt
$env:PYTHONPATH=(Get-Location).Path
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8080 --reload
```

## MQTT 上报

设备上报已切换为 MQTT。请在 Web 控制台中进入：

```text
局域网设备 -> 选择设备 -> MQTT 上报
```

可配置：

- MQTT 开关
- Broker 地址
- 端口
- 主题前缀
- 用户名
- 密码
- 心跳秒数
- 状态间隔秒数
- Client ID

Web 读取固件配置时同时兼容以下两种结构：

```json
{
  "mqttEnabled": true,
  "mqttServer": "mqtt.example.com",
  "mqttPort": 1883,
  "mqttTopic": "sms",
  "mqttUser": "user",
  "mqttPass": "pass",
  "mqttClientId": "client-id"
}
```

```json
{
  "mqtt": {
    "enabled": true,
    "broker": "mqtt.example.com",
    "port": 1883,
    "topicPrefix": "sms",
    "username": "user",
    "password": "pass",
    "clientId": "client-id",
    "keepAlive": 60,
    "statusInterval": 60
  }
}
```

保存时会同步写回 `mqtt` 嵌套结构，便于与固件 Web 配置保持一致。

## 旧 HTTP 上报兼容

旧版 HTTP 本地回传接口仍保留：

```text
/api/messages/ingest
```

它仅作为历史兼容入口使用，Web 不再主动把该地址写入固件配置。

如果需要修改旧接口 Token：

```powershell
$env:T3_MESSAGE_INGEST_TOKEN="你的密钥"
```

默认 Token 与 LAN 密钥一致。

## 串口工作台

进入：

```text
串口配置
```

支持：

- 自动列出本机串口
- 稳定连接 / 防复位 / 标准模式
- 读取设备配置
- 写入 WiFi、网络模式、SIM PIN、转发通道等离线配置
- 导入/导出配置 JSON
- 将当前配置复刻到其它已连接串口
- 串口诊断
- DTR / RTS 控制
- 复位设备
- 底部全宽实时串口日志

串口能力依赖：

```text
pyserial==3.5
```

## 生成 EXE 文件

如果需要重新生成 EXE，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-win.ps1
```

生成文件：

```text
dist\T3Web.exe
```

特点：

- 单文件 EXE
- 无黑色控制台窗口
- 启动后显示图形控制窗口
- 自动启动后端服务
- 自动打开浏览器
- 自动选择可用端口
- 运行日志写入 `launcher.log`

注意：

- `dist/` 和 `build/` 是构建产物，不建议提交到 Git。
- EXE 首次启动可能需要几秒钟解包。
- 数据库会在 EXE 同目录的 `data/app.db` 中创建。

## 常用环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `T3_UI_USER` | Web 登录用户名 | `admin` |
| `T3_UI_PASS` | Web 登录密码 | `admin123` |
| `T3_TOKEN_TTL` | 登录 Token 有效期秒数 | `604800` |
| `T3_DEVICE_USER` | 设备 Digest 用户名 | `admin` |
| `T3_DEVICE_PASS` | 设备 Digest 密码 | `admin` |
| `T3_LAN_DEVICE_KEY` | LAN 设备发现密钥 | `T3-C3-LAN-KEY-2026` |
| `T3_MESSAGE_INGEST_TOKEN` | 旧 HTTP 上报 Token | LAN 密钥 |
| `T3_HTTP_TIMEOUT` | 访问设备超时时间 | `4.0` |
| `T3_SCAN_CONCURRENCY` | 局域网扫描并发数 | `64` |
| `T3_SCAN_TTL` | 扫描任务保留秒数 | `1800` |
| `T3_DATA_DIR` | 数据目录 | `data/` |
| `T3_STATIC_DIR` | 前端静态目录 | `backend/static/` |
| `T3_DB` | SQLite 数据库路径 | `data/app.db` |

## 构建检查

前端：

```powershell
cd frontend
npm run build
```

后端语法检查示例：

```powershell
python -m py_compile backend\app\device_client.py backend\app\routers\devices.py backend\app\routers\scan.py backend\app\serial_manager.py backend\win_launcher.py
```

## Git 提交建议

不建议提交以下产物：

```text
build/
dist/
frontend/dist/
frontend/tsconfig.*.tsbuildinfo
T3Web.spec
launcher.log
```

当前项目已通过 `.gitignore` 忽略多数构建产物。提交前建议运行：

```powershell
git status --short
```
