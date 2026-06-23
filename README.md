# T3 Web

当前目录是重写后的 Web 管理端。旧代码已归档到 `legacy_current_code/`，仅作为参考。

## 启动

```powershell
.\start.bat
```

默认登录：

```text
admin
admin123
```

访问地址：

```text
http://127.0.0.1:8080
```

## 本地短信/来电记录

局域网扫描或手动添加 ESP32-C3 设备成功后，Web 会自动通过固件 LAN 密钥写入本地上报地址：

```text
http://电脑局域网IP:8080/api/messages/ingest
```

设备收到短信或来电后会独立回传到 Web 的“短信记录”，不会占用固件里的 Cloud API。Cloud API 保留给后期对接龙虾/OpenClaw 使用。

如电脑有多个网卡，可手动指定 Web 对设备公开的地址：

```powershell
$env:T3_PUBLIC_BASE_URL="http://192.168.1.10:8080"
.\start.bat
```

本地回传 Token 默认与 LAN 密钥一致：

```text
T3-C3-LAN-KEY-2026
```

需要修改时：

```powershell
$env:T3_MESSAGE_INGEST_TOKEN="你的密钥"
.\start.bat
```

## 前端构建

```powershell
cd frontend
npm install
npm run build
```
