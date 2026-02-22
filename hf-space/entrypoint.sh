#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="${OLLAMA_MODEL_PATH:-/data/models/model.gguf}"
MODEL_URL="${OLLAMA_MODEL_URL:-}"
MODEL_NAME="${OLLAMA_MODEL_NAME:-qwen3-0.6b-q4_0}"
OLLAMA_HOST_VALUE="${OLLAMA_HOST:-127.0.0.1:11434}"

mkdir -p "$(dirname "${MODEL_PATH}")"

if [ ! -s "${MODEL_PATH}" ]; then
  if [ -z "${MODEL_URL}" ]; then
    echo "No model found and OLLAMA_MODEL_URL is empty."
    exit 1
  fi
  echo "Downloading GGUF model from ${MODEL_URL}"
  curl -L --fail "${MODEL_URL}" -o "${MODEL_PATH}.tmp"
  mv "${MODEL_PATH}.tmp" "${MODEL_PATH}"
fi

export OLLAMA_HOST="${OLLAMA_HOST_VALUE}"
ollama serve >/tmp/ollama.log 2>&1 &

for _ in $(seq 1 120); do
  if curl -fsS "http://${OLLAMA_HOST_VALUE}/api/tags" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://${OLLAMA_HOST_VALUE}/api/tags" >/dev/null 2>&1; then
  echo "ollama failed to start. Check /tmp/ollama.log"
  exit 1
fi

cat >/data/models/Modelfile <<EOF
FROM ${MODEL_PATH}
PARAMETER temperature 0.2
EOF

if ! ollama create "${MODEL_NAME}" -f /data/models/Modelfile >/tmp/ollama-create.log 2>&1; then
  echo "ollama create failed. Check /tmp/ollama-create.log"
  cat /tmp/ollama-create.log || true
  exit 1
fi

uvicorn app:app --app-dir /app/mcp-service --host 0.0.0.0 --port 8090 >/tmp/mcp.log 2>&1 &

exec node /app/server.js
