#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_DIR="$ROOT_DIR/node-runtime"

if ! command -v node >/dev/null 2>&1; then
  echo "[bootstrap-node-runtime] Node.js is required (v20+)."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[bootstrap-node-runtime] npm is required."
  exit 1
fi

cd "$NODE_DIR"
echo "[bootstrap-node-runtime] npm install"
npm install

echo "[bootstrap-node-runtime] npm link (install argentic CLI)"
npm link

echo "[bootstrap-node-runtime] setup local SearXNG (python venv)"
if ! npm run setup:search; then
  echo "[bootstrap-node-runtime] setup failed."
  echo "[bootstrap-node-runtime] make sure Python 3.10-3.13 is installed, then run:"
  echo "  cd node-runtime && npm run setup:search"
  exit 1
fi

echo "[bootstrap-node-runtime] done"
echo "Run: argentic up"
