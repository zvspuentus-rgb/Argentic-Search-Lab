FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ca-certificates curl zstd \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://ollama.com/install.sh | sh

COPY AppAgent.html /app/AppAgent.html
COPY assets /app/assets
COPY server.js /app/server.js
COPY mcp-service /app/mcp-service
COPY entrypoint.sh /app/entrypoint.sh

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN /opt/venv/bin/pip install --no-cache-dir -r /app/mcp-service/requirements.txt
RUN chmod +x /app/entrypoint.sh

ENV PORT=7860
ENV MCP_BASE=http://127.0.0.1:8090
ENV SEARX_BASE=https://searx.be
ENV OLLAMA_BASE=http://127.0.0.1:11434
ENV OLLAMA_HOST=127.0.0.1:11434
ENV OLLAMA_MODEL=gemma3:1b
ENV OLLAMA_GGUF_URL=
ENV OLLAMA_NUM_CTX=2048
ENV OLLAMA_TEMPERATURE=0.2
ENV OLLAMA_HOME=/data/.ollama
ENV LIVE_DEMO_MODE=true
ENV LIVE_DEMO_QUERY_LIMIT=2

EXPOSE 7860

CMD ["/app/entrypoint.sh"]
