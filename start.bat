@echo off
setlocal
cd /d "%~dp0"

echo ======================================
echo   T3 Web Clean Rebuild
echo ======================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python not found.
  pause
  exit /b 1
)

echo [1/3] Installing backend dependencies...
pip install -r backend\requirements.txt -q
if errorlevel 1 (
  echo [ERROR] Backend dependency install failed.
  pause
  exit /b 1
)

echo [2/3] Building frontend if needed...
if exist frontend\package.json (
  pushd frontend
  if not exist node_modules call npm install
  call npm run build
  if errorlevel 1 (
    popd
    echo [ERROR] Frontend build failed.
    pause
    exit /b 1
  )
  popd
  if not exist backend\static mkdir backend\static
  xcopy /E /I /Y frontend\dist backend\static >nul
)

echo [3/3] Starting server...
echo URL: http://127.0.0.1:8081
echo User: admin
echo Pass: admin123
echo.
set PYTHONPATH=%CD%
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8081 --reload

pause
