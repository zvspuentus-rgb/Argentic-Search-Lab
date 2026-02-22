#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS_FILE="$ROOT_DIR/searxng/settings-node.yml"
CONTAINER_NAME="appagent-searxng-node"
IMAGE="searxng/searxng:latest"
PORT="${SEARX_PORT:-8393}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[setup-searxng] docker is required for auto-setup in Node mode."
  echo "[setup-searxng] install Docker or provide external SearXNG via SEARX_BASE."
  exit 1
fi

if curl -fsS "http://localhost:${PORT}/search?q=health&format=json" >/dev/null 2>&1; then
  echo "[setup-searxng] existing SearXNG detected on localhost:${PORT}"
  exit 0
fi

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[setup-searxng] container already running: ${CONTAINER_NAME}"
else
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
  echo "[setup-searxng] pulling ${IMAGE}"
  docker pull "${IMAGE}" >/dev/null
  echo "[setup-searxng] starting ${CONTAINER_NAME} on localhost:${PORT}"
  if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[setup-searxng] port ${PORT} is in use and no healthy SearXNG was detected."
    echo "[setup-searxng] set SEARX_PORT to a free port, e.g. SEARX_PORT=8394 npm run setup:search"
    exit 1
  fi
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${PORT}:8080" \
    -v "${SETTINGS_FILE}:/etc/searxng/settings.yml:ro" \
    "${IMAGE}" >/dev/null
fi

for i in {1..30}; do
  if curl -fsS "http://localhost:${PORT}/search?q=health&format=json" >/dev/null 2>&1; then
    echo "[setup-searxng] ready: http://localhost:${PORT}"
    exit 0
  fi
  sleep 1
done

echo "[setup-searxng] failed: service did not become ready"
docker logs --tail 120 "${CONTAINER_NAME}" || true
exit 1
