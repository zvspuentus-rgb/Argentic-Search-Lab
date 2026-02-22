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
- Docker (for automatic local SearXNG setup in Node mode)

## Install
```bash
cd node-runtime
npm install
```

## Run
```bash
npm run start:all
```

## Access
- Web UI: `http://localhost:3093`
- MCP: `http://localhost:3093/mcp`
- Health: `http://localhost:3093/health`
- SearXNG: `http://localhost:8394/search?q=test&format=json` (Node default)
- SearXNG via app proxy: `http://localhost:3093/searxng/search?q=test&format=json`

`start:all` behavior:
- If SearXNG is not running, it auto-starts it locally.
- Node runtime uses `8394` by default so it does not collide with Docker stack (`8393`).
- If `8394` is busy, it automatically selects the next free port.
- No manual port input is required for default setup.

## Optional manual mode
If you already have an external SearXNG:
```bash
SEARX_BASE=http://your-searx-host:8080 PORT=3093 npm start
```

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
