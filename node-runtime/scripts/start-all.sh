#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PORT_FILE="$RUN_DIR/searx_port"
PORT="${SEARX_PORT:-8394}"

mkdir -p "$RUN_DIR"

if [ -z "${SEARX_BASE:-}" ]; then
  if [ -f "$PORT_FILE" ]; then
    saved_port="$(cat "$PORT_FILE" 2>/dev/null || true)"
    if [ -n "${saved_port:-}" ] && curl -fsS "http://localhost:${saved_port}/search?q=health&format=json" >/dev/null 2>&1; then
      PORT="$saved_port"
    fi
  fi
  export SEARX_BASE="http://localhost:${PORT}"
fi

if ! curl -fsS "${SEARX_BASE}/search?q=health&format=json" >/dev/null 2>&1; then
  echo "[start-all] SearXNG not reachable at ${SEARX_BASE}, running setup..."
  SEARX_PORT="$PORT" "$ROOT_DIR/scripts/setup-searxng.sh"
  if [ -f "$PORT_FILE" ]; then
    saved_port="$(cat "$PORT_FILE" 2>/dev/null || true)"
    if [ -n "${saved_port:-}" ]; then
      PORT="$saved_port"
      export SEARX_BASE="http://localhost:${PORT}"
    fi
  fi
fi

echo "[start-all] starting Node runtime with SEARX_BASE=${SEARX_BASE}"
exec node "$ROOT_DIR/server.js"
