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

局域网扫描或手动添加设备成功后，可在设备详情中配置上报方式：

设备上报已改为 MQTT。请在设备详情里的“MQTT 上报”区域配置 Broker、端口、主题、账号和密码。

旧版 HTTP 本地回传接口 `/api/messages/ingest` 仅作为历史兼容入口保留，Web 不再主动把该地址写入固件配置。

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
