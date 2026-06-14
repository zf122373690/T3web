# SMS Forwarder (Python版本)

基于 FastAPI + React 的短信转发管理系统。

## 功能特性

- 📱 设备管理：管理多个EC200M模块设备
- 💬 短信收发：发送和接收短信
- 🌐 局域网扫描：自动发现网络中的设备
- 📊 统计面板：实时显示设备状态和短信统计
- 🔄 跨平台支持：Windows / Linux / Docker

## 技术栈

- **后端**: FastAPI + SQLAlchemy + Pydantic
- **前端**: React 18 + TypeScript + TailwindCSS + Zustand
- **数据库**: SQLite (默认)
- **部署**: Docker / Docker Compose

## 快速开始

### 方式一：直接运行

```bash
# 安装依赖
cd backend
pip install -r requirements.txt

# 启动后端
python main.py

# 启动前端 (新终端)
cd frontend
npm install
npm run dev
```

### 方式二：Docker部署

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### 方式三：Windows/Linux脚本

```bash
# Windows
start.bat

# Linux
./start.sh
```

## 访问

- 前端: http://localhost:8080
- API: http://localhost:8080/api

## 默认账户

- 用户名: admin
- 密码: admin123

## API对接 (ESP32-C3)

设备需要实现以下Webhook接口：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/device/status` | GET | 获取设备状态 |
| `/api/device/sms/send` | POST | 发送短信 |
| `/api/device/sms/list` | GET | 获取短信列表 |
| `/webhook/sms` | POST | 设备主动推送短信 |

## 目录结构

```
sms_forwarder_py/
├── backend/           # 后端代码
│   ├── routes/       # API路由
│   ├── main.py       # 入口文件
│   └── config.py     # 配置文件
├── frontend/         # 前端代码
│   ├── src/
│   │   ├── api/     # API调用
│   │   ├── components/ # 组件
│   │   ├── pages/   # 页面
│   │   └── stores/  # 状态管理
│   └── vite.config.ts
├── docker-compose.yml
├── Dockerfile
└── README.md
```

## License

MIT