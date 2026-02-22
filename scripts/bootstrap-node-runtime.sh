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
if ! command -v docker >/dev/null 2>&1; then
  echo "[bootstrap-node-runtime] Docker is required for automatic local SearXNG setup."
  exit 1
fi

cd "$NODE_DIR"
echo "[bootstrap-node-runtime] npm install"
npm install

echo "[bootstrap-node-runtime] setup local SearXNG"
npm run setup:search

echo "[bootstrap-node-runtime] done"
echo "Run: cd node-runtime && npm run start:all"
