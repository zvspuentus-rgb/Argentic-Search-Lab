#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="${LLAMA_MODEL_PATH:-/data/models/model.gguf}"
MODEL_URL="${LLAMA_MODEL_URL:-}"
MODEL_NAME="${LLAMA_MODEL_NAME:-qwen2.5-0.5b-instruct-q4_k_m}"
LLAMA_HOST="${LLAMA_HOST:-127.0.0.1}"
LLAMA_PORT="${LLAMA_PORT:-11434}"
LLAMA_CTX_SIZE="${LLAMA_CTX_SIZE:-2048}"
LLAMA_THREADS="${LLAMA_THREADS:-4}"
LLAMA_TEMPERATURE="${LLAMA_TEMPERATURE:-0.2}"

mkdir -p "$(dirname "${MODEL_PATH}")"
if [ ! -s "${MODEL_PATH}" ]; then
  if [ -z "${MODEL_URL}" ]; then
    echo "No model found and LLAMA_MODEL_URL is empty."
    exit 1
  fi
  echo "Downloading GGUF model from ${MODEL_URL}"
  curl -L --fail "${MODEL_URL}" -o "${MODEL_PATH}.tmp"
  mv "${MODEL_PATH}.tmp" "${MODEL_PATH}"
fi

# Start llama.cpp OpenAI-compatible server on /v1/*
llama-server \
  -m "${MODEL_PATH}" \
  --host 0.0.0.0 \
  --port "${LLAMA_PORT}" \
  --ctx-size "${LLAMA_CTX_SIZE}" \
  --threads "${LLAMA_THREADS}" \
  --temp "${LLAMA_TEMPERATURE}" \
  --alias "${MODEL_NAME}" \
  >/tmp/llama.log 2>&1 &

# Wait for API readiness
for _ in $(seq 1 120); do
  if curl -fsS "http://${LLAMA_HOST}:${LLAMA_PORT}/v1/models" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://${LLAMA_HOST}:${LLAMA_PORT}/v1/models" >/dev/null 2>&1; then
  echo "llama-server failed to start. Check /tmp/llama.log"
  exit 1
fi

# Start MCP service in background
uvicorn app:app --app-dir /app/mcp-service --host 0.0.0.0 --port 8090 >/tmp/mcp.log 2>&1 &

# Start UI server in foreground
exec node /app/server.js
