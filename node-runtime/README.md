# AppAgent Node Runtime (No Docker Required)

This is the Node.js runtime of **Argentic Search Lab**.
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
- SearXNG: `http://localhost:8393/search?q=test&format=json`

`start:all` behavior:
- If SearXNG is not running, it auto-starts it locally.
- If SearXNG already runs on `localhost:8393`, it reuses it.
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
- For one-command install from repo root:
  - `bash ./scripts/bootstrap-node-runtime.sh`
