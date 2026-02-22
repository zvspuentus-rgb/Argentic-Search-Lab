#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$RUN_DIR"

SEARX_PORT="${SEARX_PORT:-8393}"
NODE_PORT="${PORT:-3093}"
CONTAINER_NAME="${SEARX_CONTAINER_NAME:-appagent-searxng-node}"
export SEARX_BASE="${SEARX_BASE:-http://localhost:${SEARX_PORT}}"

STARTED_CONTAINER=0
NODE_PID=""

cleanup() {
  if [[ -n "$NODE_PID" ]] && kill -0 "$NODE_PID" >/dev/null 2>&1; then
    kill "$NODE_PID" >/dev/null 2>&1 || true
    wait "$NODE_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$RUN_DIR/node.pid"
  if [[ "$STARTED_CONTAINER" == "1" ]]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}

trap cleanup INT TERM EXIT

if ! curl -fsS "${SEARX_BASE}/search?q=health&format=json" >/dev/null 2>&1; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "[start-all] SearXNG is not reachable and Docker is unavailable."
    echo "[start-all] Install Docker or set SEARX_BASE to an external SearXNG endpoint."
    exit 1
  fi

  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "[start-all] found running SearXNG container: ${CONTAINER_NAME}"
  else
    "$ROOT_DIR/scripts/setup-searxng.sh"
    STARTED_CONTAINER=1
  fi
fi

echo "[start-all] starting Node runtime"
echo "[start-all] UI:  http://localhost:${NODE_PORT}"
echo "[start-all] MCP: http://localhost:${NODE_PORT}/mcp"
echo "[start-all] Search: ${SEARX_BASE}/search?q=test&format=json"

PORT="$NODE_PORT" node "$ROOT_DIR/server.js" &
NODE_PID=$!
echo "$NODE_PID" > "$RUN_DIR/node.pid"
wait "$NODE_PID"
