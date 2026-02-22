#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PORT_FILE="$RUN_DIR/searx_port"
SEARX_PID_FILE="$RUN_DIR/searx.pid"
NODE_PID_FILE="$RUN_DIR/node.pid"
SETTINGS_TEMPLATE="$ROOT_DIR/searxng/settings-node.yml"
SETTINGS_ACTIVE="$RUN_DIR/settings-active.yml"
VENV_DIR="$ROOT_DIR/.venv-searxng"

mkdir -p "$RUN_DIR"

NODE_PORT="${PORT:-3093}"
SEARX_PORT="${SEARX_PORT:-8394}"
STARTED_SEARX=0
NODE_PID=""
SEARX_PID=""

if [ -f "$PORT_FILE" ]; then
  saved_port="$(cat "$PORT_FILE" 2>/dev/null || true)"
  if [ -n "${saved_port:-}" ]; then
    SEARX_PORT="$saved_port"
  fi
fi

if [ -z "${SEARX_BASE:-}" ]; then
  export SEARX_BASE="http://127.0.0.1:${SEARX_PORT}"
fi

cleanup() {
  if [[ -n "$NODE_PID" ]] && kill -0 "$NODE_PID" >/dev/null 2>&1; then
    kill "$NODE_PID" >/dev/null 2>&1 || true
    wait "$NODE_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$NODE_PID_FILE"

  if [[ "$STARTED_SEARX" == "1" ]] && [[ -n "$SEARX_PID" ]] && kill -0 "$SEARX_PID" >/dev/null 2>&1; then
    kill "$SEARX_PID" >/dev/null 2>&1 || true
    wait "$SEARX_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$STARTED_SEARX" == "1" ]]; then
    rm -f "$SEARX_PID_FILE"
  fi
}

trap cleanup INT TERM EXIT

ensure_searx_running() {
  if curl -fsS "${SEARX_BASE}/search?q=health&format=json" >/dev/null 2>&1; then
    return 0
  fi

  if [ ! -x "$VENV_DIR/bin/searxng-run" ]; then
    "$ROOT_DIR/scripts/setup-searxng.sh"
  fi

  if [ -f "$PORT_FILE" ]; then
    saved_port="$(cat "$PORT_FILE" 2>/dev/null || true)"
    if [ -n "${saved_port:-}" ]; then
      SEARX_PORT="$saved_port"
      export SEARX_BASE="http://127.0.0.1:${SEARX_PORT}"
    fi
  fi

  if [ ! -x "$VENV_DIR/bin/searxng-run" ]; then
    echo "[start-all] missing searxng-run in venv after setup check: $VENV_DIR"
    return 1
  fi

  cat "$SETTINGS_TEMPLATE" > "$SETTINGS_ACTIVE"
  sed -E -i.bak \
    -e "s|^([[:space:]]*bind_address:[[:space:]]*).*$|\\1\"127.0.0.1\"|" \
    -e "s|^([[:space:]]*port:[[:space:]]*).*$|\\1${SEARX_PORT}|" \
    "$SETTINGS_ACTIVE" || true
  rm -f "$SETTINGS_ACTIVE.bak"

  if grep -Eq '^[[:space:]]*secret_key:[[:space:]]*"(ultrasecretkey)?"' "$SETTINGS_ACTIVE" || \
     ! grep -Eq '^[[:space:]]*secret_key:' "$SETTINGS_ACTIVE"; then
    SECRET="$("$VENV_DIR/bin/python" - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
    if grep -Eq '^[[:space:]]*secret_key:' "$SETTINGS_ACTIVE"; then
      sed -E -i.bak \
        -e "s|^([[:space:]]*secret_key:[[:space:]]*).*$|\\1\"${SECRET}\"|" \
        "$SETTINGS_ACTIVE"
    else
      awk -v s="$SECRET" '
        BEGIN{in_server=0; inserted=0}
        /^server:[[:space:]]*$/ {in_server=1; print; next}
        in_server && /^[^[:space:]]/ && !inserted {print "  secret_key: \"" s "\""; inserted=1; in_server=0}
        {print}
        END {if (in_server && !inserted) print "  secret_key: \"" s "\""}
      ' "$SETTINGS_ACTIVE" > "$SETTINGS_ACTIVE.tmp" && mv "$SETTINGS_ACTIVE.tmp" "$SETTINGS_ACTIVE"
    fi
    rm -f "$SETTINGS_ACTIVE.bak"
  fi

  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  SEARXNG_SETTINGS_PATH="$SETTINGS_ACTIVE" nohup "$VENV_DIR/bin/searxng-run" > "$RUN_DIR/searx.log" 2>&1 &
  SEARX_PID=$!
  STARTED_SEARX=1
  echo "$SEARX_PID" > "$SEARX_PID_FILE"

  for _ in {1..30}; do
    if curl -fsS "${SEARX_BASE}/search?q=health&format=json" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "[start-all] searxng failed to start"
  tail -n 120 "$RUN_DIR/searx.log" || true
  return 1
}

ensure_searx_running

echo "[start-all] starting Node runtime"
echo "[start-all] UI:    http://localhost:${NODE_PORT}"
echo "[start-all] MCP:   http://localhost:${NODE_PORT}/mcp"
echo "[start-all] Search: ${SEARX_BASE}/search?q=test&format=json"

PORT="$NODE_PORT" node "$ROOT_DIR/server.js" &
NODE_PID=$!
echo "$NODE_PID" > "$NODE_PID_FILE"
wait "$NODE_PID"
