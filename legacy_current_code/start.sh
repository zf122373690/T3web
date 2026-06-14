#!/bin/bash
# SMS Forwarder Py - Linux启动脚本

echo "======================================"
echo "  SMS Forwarder Py - 短信转发系统"
echo "======================================"
echo ""

# 检查Python
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未找到Python，请先安装Python 3.11+"
    exit 1
fi

# 安装依赖
echo "[1/4] 安装Python依赖..."
cd "$(dirname "$0")/backend"
pip3 install -r requirements.txt -q
if [ $? -ne 0 ]; then
    echo "[错误] 依赖安装失败"
    exit 1
fi

# 创建数据目录
echo "[2/4] 初始化数据目录..."
mkdir -p data static

# 启动服务
echo "[3/4] 启动服务..."
echo ""
echo "访问地址: http://localhost:8080"
echo "默认用户名: admin"
echo "默认密码: admin123"
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

# 启动FastAPI
cd "$(dirname "$0")/backend"
exec uvicorn main:app --host 0.0.0.0 --port 8080 --reload