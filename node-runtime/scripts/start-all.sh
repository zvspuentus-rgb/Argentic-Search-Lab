#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SEARX_PORT:-8393}"
export SEARX_BASE="${SEARX_BASE:-http://localhost:${PORT}}"

if ! curl -fsS "${SEARX_BASE}/search?q=health&format=json" >/dev/null 2>&1; then
  echo "[start-all] SearXNG not reachable at ${SEARX_BASE}, running setup..."
  "$ROOT_DIR/scripts/setup-searxng.sh"
fi

echo "[start-all] starting Node runtime with SEARX_BASE=${SEARX_BASE}"
exec node "$ROOT_DIR/server.js"
