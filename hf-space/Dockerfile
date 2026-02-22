FROM alpine/ollama:latest

WORKDIR /app

RUN apk add --no-cache \
    bash \
    ca-certificates \
    curl \
    nodejs \
    npm \
    python3 \
    py3-pip \
    py3-virtualenv

COPY AppAgent.html /app/AppAgent.html
COPY assets /app/assets
COPY server.js /app/server.js
COPY mcp-service /app/mcp-service
COPY entrypoint.sh /app/entrypoint.sh

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN /opt/venv/bin/pip install --no-cache-dir -r /app/mcp-service/requirements.txt
RUN chmod +x /app/entrypoint.sh

ENV PORT=7860
ENV MCP_BASE=http://127.0.0.1:8090
ENV SEARX_BASE=http://searxng:8080
ENV OLLAMA_BASE=http://127.0.0.1:11434

ENV OLLAMA_HOST=127.0.0.1:11434
ENV OLLAMA_MODEL_PATH=/data/models/model.gguf
ENV OLLAMA_MODEL_NAME=qwen3-0.6b-q4_0
ENV OLLAMA_MODEL_URL=https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf?download=true

ENV LIVE_DEMO_MODE=true
ENV LIVE_DEMO_QUERY_LIMIT=2

EXPOSE 7860

ENTRYPOINT ["/app/entrypoint.sh"]
