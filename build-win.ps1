$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host '[1/5] Install backend dependencies'
python -m pip install -r backend\requirements.txt

Write-Host '[2/5] Install frontend dependencies'
Push-Location frontend
if (-not (Test-Path node_modules)) {
  npm install
}

Write-Host '[3/5] Build frontend'
npm run build
Pop-Location

Write-Host '[4/5] Copy frontend assets'
if (Test-Path backend\static) {
  Remove-Item backend\static -Recurse -Force
}
New-Item -ItemType Directory -Force backend\static | Out-Null
Copy-Item frontend\dist\* backend\static -Recurse -Force

Write-Host '[5/5] Build Windows executable'
if (Test-Path dist\T3Web) {
  Remove-Item dist\T3Web -Recurse -Force
}
if (Test-Path dist\T3Web.exe) {
  Remove-Item dist\T3Web.exe -Force
}
if (Test-Path build\T3Web) {
  Remove-Item build\T3Web -Recurse -Force
}

$PythonInfo = python -c "import sys, pathlib; root=pathlib.Path(sys.base_prefix); v=f'{sys.version_info.major}{sys.version_info.minor}'; print(root/'python3.dll'); print(root/f'python{v}.dll')"
$Python3Dll = $PythonInfo[0]
$PythonVersionDll = $PythonInfo[1]

$PyInstallerArgs = @(
  '--noconfirm', '--clean', '--windowed', '--onefile', '--name', 'T3Web',
  '--add-data', 'backend\static;static',
  '--add-data', 'backend\app;backend\app',
  '--add-binary', "$Python3Dll;.",
  '--collect-all', 'uvicorn',
  '--collect-all', 'fastapi',
  '--collect-all', 'starlette',
  '--hidden-import', 'backend.app.main',
  '--hidden-import', 'backend.app.routers.auth',
  '--hidden-import', 'backend.app.routers.devices',
  '--hidden-import', 'backend.app.routers.messages',
  '--hidden-import', 'backend.app.routers.scan',
  '--hidden-import', 'backend.app.routers.serial',
  '--hidden-import', 'backend.app.routers.system',
  'backend\win_launcher.py'
)

if (Test-Path $PythonVersionDll) {
  $PyInstallerArgs = @('--add-binary', "$PythonVersionDll;.") + $PyInstallerArgs
} else {
  Write-Host "[WARN] $PythonVersionDll not found, skipping versioned DLL"
}

python -m PyInstaller @PyInstallerArgs

Write-Host ''
Write-Host 'Build completed:'
Write-Host "  $Root\dist\T3Web.exe"
Write-Host ''
