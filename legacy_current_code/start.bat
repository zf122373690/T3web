@echo off
REM SMS Forwarder Py - Windows Startup Script

echo ======================================
echo   SMS Forwarder Py - SMS Forwarding
echo ======================================
echo.

REM Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found, please install Python 3.11+
    pause
    exit /b 1
)

REM Set working directory
cd /d "%~dp0"

REM Install dependencies with faster mirror
echo [1/4] Installing Python dependencies...
pip install -r backend/requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com -q
pip install uvicorn -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com -q
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

REM Create data directories
echo [2/4] Initializing data directories...
if not exist "backend\data" mkdir backend\data
if not exist "backend\static" mkdir backend\static

REM Start service
echo [3/4] Starting service...
echo.
echo Access URL: http://localhost:8080
echo Default User: admin
echo Default Pass: admin123
echo.
echo Press Ctrl+C to stop
echo.

REM Start FastAPI with PYTHONPATH
set PYTHONPATH=%CD%
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8080 --reload

pause