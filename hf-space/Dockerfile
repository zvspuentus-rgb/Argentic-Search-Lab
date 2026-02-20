FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY AppAgent.html /app/AppAgent.html
COPY assets /app/assets
COPY server.js /app/server.js
COPY mcp-service /app/mcp-service
COPY entrypoint.sh /app/entrypoint.sh

RUN pip3 install --no-cache-dir -r /app/mcp-service/requirements.txt
RUN chmod +x /app/entrypoint.sh

ENV PORT=7860
ENV MCP_BASE=http://127.0.0.1:8090
ENV SEARX_BASE=https://searx.be
ENV LIVE_DEMO_MODE=true
ENV LIVE_DEMO_QUERY_LIMIT=2

EXPOSE 7860

CMD ["/app/entrypoint.sh"]
