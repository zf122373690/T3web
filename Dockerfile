# ============================================================
#  T3 Web 本地助手 · 容器镜像（多阶段构建，自洽可复现）
#  说明：
#   - 阶段 1 在容器内构建前端，不再依赖宿主机预先执行 npm run build
#   - 阶段 2 仅安装运行期依赖（排除仅用于 Windows 打包的 pyinstaller）
#   - Docker 部署仅覆盖“局域网模式”，串口模式需宿主机直连 USB，容器不支持
# ============================================================

# ---------- 阶段 1：构建前端 ----------
FROM node:20-slim AS frontend
WORKDIR /web
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---------- 阶段 2：Python 运行时 ----------
FROM python:3.12-slim
WORKDIR /app

COPY backend/ ./backend/
# 前端产物从阶段 1 拷入，无需宿主机预构建
COPY --from=frontend /web/dist/ ./backend/static/

# 仅安装运行期依赖；pyinstaller 只用于 Windows EXE 打包，容器内无意义
RUN grep -v -i pyinstaller backend/requirements.txt > /tmp/requirements.txt \
    && pip install --no-cache-dir -r /tmp/requirements.txt

ENV PYTHONPATH=/app \
    T3_DATA_DIR=/app/data \
    T3_DB=/app/data/app.db

EXPOSE 8080

# 容器内必须绑定 0.0.0.0，端口映射到宿主机后才能访问
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8080"]
