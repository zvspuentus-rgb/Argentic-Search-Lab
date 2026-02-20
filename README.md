# AppAgent Docker Stack (UI + SearXNG + MCP)

Production-ready Docker stack for `AppAgent.html` with:
- Web UI (static app server)
- Internal SearXNG search engine
- MCP HTTP server (JSON-RPC 2.0 + backward-compatible tool endpoints)
- Redis dependency for SearXNG

This repository folder is intentionally clean and contains only server/runtime files (no Cordova, no APK artifacts).

## Included Features
- `Quick / Deep / Auto` search flow in UI
- Discovery + sessions + localStorage restore
- MCP tools:
  - `search_quick`
  - `search_deep` (supports multiple queries and optional URL-context enrichment)
  - `fetch_url_context`
- Mandatory tool policy text in MCP tool descriptions (use search tools only on explicit user request)
- SearXNG JSON-first behavior

## Project Structure
```text
.
├── AppAgent.html
├── assets/
│   ├── css/
│   │   ├── base.css
│   │   └── components.css
│   └── js/
│       └── app.js
├── Dockerfile
├── docker-compose.yml
├── server.js
├── mcp-service/
│   ├── app.py
│   ├── Dockerfile
│   └── requirements.txt
├── searxng/
│   └── settings.yml
├── MCP_INTEGRATION.md
└── .env.example
```

## Quick Start
1. Copy env file:
```bash
cp .env.example .env
```

2. Start stack:
```bash
docker compose up -d --build
```

3. Open services:
- UI: `http://localhost:8093`
- MCP (JSON-RPC 2.0): `http://localhost:8193/mcp`
- SearXNG direct: `http://localhost:8393/search?q=test&format=json`

## Ports
Defined by `.env`:
- `APP_PORT=8093`
- `MCP_PORT=8193`
- `SEARX_PORT=8393`
- `LMSTUDIO_BASE=http://host.docker.internal:1234`
- `OLLAMA_BASE=http://host.docker.internal:11434`

## Local LM Studio / Ollama Through Docker
The UI server now proxies local host-model endpoints via Docker:
- `/lmstudio/*` -> `${LMSTUDIO_BASE}` (default `http://host.docker.internal:1234`)
- `/ollama/*` -> `${OLLAMA_BASE}` (default `http://host.docker.internal:11434`)

Default UI values are already set to:
- LM Studio base: `/lmstudio/v1`
- Ollama base: `/ollama/v1`

This avoids CORS issues and works better when accessing the UI from another device on your LAN.

## Frontend Structure
The original single-file app was split into maintainable files:
- HTML shell: `AppAgent.html`
- Styles: `assets/css/base.css`, `assets/css/components.css`
- Client logic: `assets/js/app.js`

Behavior is unchanged; this is a structural refactor for easier maintenance.

## MCP Client Configuration (JSON)
Add this block inside your `mcpServers` object:

```json
"appagent": {
  "url": "http://localhost:8193/mcp"
}
```

## MCP API Modes
### A) MCP JSON-RPC 2.0 (recommended)
Endpoint: `POST /mcp`

Supported methods:
- `initialize`
- `tools/list`
- `tools/call`
- `ping`

### B) Backward-compatible HTTP endpoints
- `GET /tools`
- `POST /tools/search_quick`
- `POST /tools/search_deep`
- `POST /tools/fetch_url_context`
- `POST /mcp/call`

## Configuration and Persistence
- UI settings can be changed from `AppAgent.html` settings panel.
- MCP client connection is configured via your MCP JSON config (`mcpServers`).
- Runtime app settings and sessions are persisted in browser `localStorage` and restored on refresh.

## Deep Search Advanced Arguments
`search_deep` accepts:
- `query` (string) or `queries` (array of strings)
- `limit` (default `5`)
- `lanes` (default `["general", "science", "news"]`)
- `include_context` (default `false`)
- `context_max_urls` (default `3`)
- `context_max_chars` (default `1800`)

## Useful Commands
```bash
# status
docker compose ps

# logs
docker compose logs -f app mcp searxng

# restart only MCP
docker compose up -d --build mcp

# stop
docker compose down
```

## Security Notes
- Do not commit real API keys.
- Keep `.env` local.
- If exposing services publicly, put a reverse proxy + auth in front.

## Publish to GitHub
From this `GitHub` folder:
```bash
git init
git add .
git commit -m "Initial AppAgent Docker stack (UI + SearXNG + MCP)"
# then add your remote and push
```
