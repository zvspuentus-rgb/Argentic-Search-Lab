#!/usr/bin/env bash
set -euo pipefail

# Start Ollama in background (internal model endpoint for Live Demo)
mkdir -p "${OLLAMA_HOME:-/tmp/.ollama}"
ollama serve >/tmp/ollama.log 2>&1 &

# Wait for Ollama API to be ready
for _ in $(seq 1 90); do
  if curl -fsS "http://${OLLAMA_HOST:-127.0.0.1:11434}/api/tags" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://${OLLAMA_HOST:-127.0.0.1:11434}/api/tags" >/dev/null 2>&1; then
  echo "Ollama failed to start. Check /tmp/ollama.log"
  exit 1
fi

# Pull a lightweight default model, or build from custom GGUF URL if provided
MODEL_NAME="${OLLAMA_MODEL:-gemma3:1b}"
if [ -n "${OLLAMA_GGUF_URL:-}" ]; then
  mkdir -p /app/models
  GGUF_PATH="/app/models/model.gguf"
  if [ ! -s "${GGUF_PATH}" ]; then
    echo "Downloading custom GGUF from ${OLLAMA_GGUF_URL}"
    curl -L --fail "${OLLAMA_GGUF_URL}" -o "${GGUF_PATH}"
  fi
  cat > /app/models/Modelfile <<EOF
FROM ${GGUF_PATH}
PARAMETER num_ctx ${OLLAMA_NUM_CTX:-2048}
PARAMETER temperature ${OLLAMA_TEMPERATURE:-0.2}
EOF
  ollama create "${MODEL_NAME}" -f /app/models/Modelfile >/tmp/ollama-model.log 2>&1 || {
    echo "Failed to create model from GGUF. Check /tmp/ollama-model.log"
    exit 1
  }
else
  ollama pull "${MODEL_NAME}" >/tmp/ollama-model.log 2>&1 || {
    echo "Failed to pull Ollama model ${MODEL_NAME}. Check /tmp/ollama-model.log"
    exit 1
  }
fi

# Start MCP service in background
uvicorn app:app --app-dir /app/mcp-service --host 0.0.0.0 --port 8090 >/tmp/mcp.log 2>&1 &

# Start UI server in foreground
exec node /app/server.js
