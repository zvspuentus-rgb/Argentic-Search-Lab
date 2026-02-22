# AppAgent Node Runtime (No Docker Required)

This is the primary runtime for the `codex/app-nodejs-runtime` branch of **Argentic Search Lab**.
It runs as a single Node.js service (UI + MCP tools).

## What it includes
- Web UI serving `AppAgent.html`
- MCP endpoint (`/mcp`)
- Tool endpoints:
  - `/tools/search_quick`
  - `/tools/search_deep`
  - `/tools/fetch_url_context`
- GitHub-aware URL context traversal (repo index + related file follow-up)

## Requirements
- Node.js 20+
- A running SearXNG endpoint (JSON enabled)

## Install
```bash
cd node-runtime
npm install
```

## Run
```bash
SEARX_BASE=http://localhost:8393 PORT=3093 npm start
```

## Access
- Web UI: `http://localhost:3093`
- MCP: `http://localhost:3093/mcp`
- Health: `http://localhost:3093/health`

## MCP client example
```json
{
  "mcpServers": {
    "appagent-node": {
      "url": "http://localhost:3093/mcp"
    }
  }
}
```

## Notes
- This branch is Node-first. Docker can still be used from other branches if needed.
- For Docker setup, use the main branch README:
  - https://github.com/zvspuentus-rgb/Argentic-Search-Lab/tree/main
