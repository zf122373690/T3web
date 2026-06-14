#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

python -m pip install -r backend/requirements.txt -q
if [ -f frontend/package.json ]; then
  cd frontend
  [ -d node_modules ] || npm install
  npm run build
  cd ..
  mkdir -p backend/static
  cp -r frontend/dist/* backend/static/
fi

export PYTHONPATH="$PWD"
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8080 --reload
