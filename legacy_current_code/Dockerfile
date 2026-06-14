# SMS Forwarder Py - Dockerfile
# 支持Windows和Linux

FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    libc-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制后端代码
COPY backend/ ./backend/
COPY frontend/dist/ ./backend/static/

# 安装Python依赖
WORKDIR /app/backend
RUN pip install --no-cache-dir -r requirements.txt

# 创建非root用户 (Linux)
RUN useradd -m -s /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]