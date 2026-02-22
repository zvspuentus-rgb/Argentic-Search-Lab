#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS_FILE="$ROOT_DIR/searxng/settings-node.yml"
CONTAINER_NAME="appagent-searxng-node"
IMAGE="searxng/searxng:latest"
RUN_DIR="$ROOT_DIR/.run"
PORT_FILE="$RUN_DIR/searx_port"
PORT="${SEARX_PORT:-8394}"

mkdir -p "$RUN_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[setup-searxng] docker is required for auto-setup in Node mode."
  echo "[setup-searxng] install Docker or provide external SearXNG via SEARX_BASE."
  exit 1
fi

pick_free_port() {
  local start_port="$1"
  local p="$start_port"
  local limit=$((start_port + 30))
  while [ "$p" -le "$limit" ]; do
    if ! lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
  done
  return 1
}

running_host_port() {
  docker port "$CONTAINER_NAME" 8080/tcp 2>/dev/null | head -n1 | awk -F: '{print $NF}'
}

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  mapped="$(running_host_port || true)"
  if [ -n "${mapped:-}" ] && curl -fsS "http://localhost:${mapped}/search?q=health&format=json" >/dev/null 2>&1; then
    echo "$mapped" > "$PORT_FILE"
    echo "[setup-searxng] container already running: ${CONTAINER_NAME} on localhost:${mapped}"
    exit 0
  fi
fi

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[setup-searxng] container already running: ${CONTAINER_NAME}"
else
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
  echo "[setup-searxng] pulling ${IMAGE}"
  docker pull "${IMAGE}" >/dev/null
  if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    picked="$(pick_free_port "$PORT" || true)"
    if [ -z "${picked:-}" ]; then
      echo "[setup-searxng] no free port found near ${PORT}"
      exit 1
    fi
    echo "[setup-searxng] port ${PORT} busy, switching to ${picked}"
    PORT="$picked"
  fi
  echo "[setup-searxng] starting ${CONTAINER_NAME} on localhost:${PORT}"
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${PORT}:8080" \
    -v "${SETTINGS_FILE}:/etc/searxng/settings.yml:ro" \
    "${IMAGE}" >/dev/null
fi

for i in {1..30}; do
  if curl -fsS "http://localhost:${PORT}/search?q=health&format=json" >/dev/null 2>&1; then
    echo "$PORT" > "$PORT_FILE"
    echo "[setup-searxng] ready: http://localhost:${PORT}"
    exit 0
  fi
  sleep 1
done

echo "[setup-searxng] failed: service did not become ready"
docker logs --tail 120 "${CONTAINER_NAME}" || true
exit 1
