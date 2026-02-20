#!/usr/bin/env bash
set -euo pipefail

# Start MCP service in background
uvicorn app:app --app-dir /app/mcp-service --host 0.0.0.0 --port 8090 >/tmp/mcp.log 2>&1 &

# Start UI server in foreground
exec node /app/server.js
