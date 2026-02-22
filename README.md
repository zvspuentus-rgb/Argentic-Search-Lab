# Argentic Search Lab (Node.js Branch)

This branch is focused on the Node.js runtime and CLI workflow.

## Quick Start
```bash
git clone https://github.com/zvspuentus-rgb/Argentic-Search-Lab.git
cd Argentic-Search-Lab
bash ./scripts/bootstrap-node-runtime.sh
argentic up
```

## CLI Commands
- `argentic up` -> start Web UI + MCP + Search service
- `argentic status` -> show service status
- `argentic down` -> stop services

## Endpoints
- Web UI: `http://localhost:3093`
- MCP: `http://localhost:3093/mcp`
- Search (direct): `http://localhost:8394/search?q=test&format=json`
- Search (proxy): `http://localhost:3093/searxng/search?q=test&format=json`

## Provider Base URLs
Set these if needed before `argentic up`:
- `LMSTUDIO_BASE` (default `http://localhost:1234`)
- `OLLAMA_BASE` (default `http://localhost:11434`)
- `SEARX_BASE` (auto by default, usually `http://localhost:8394`)

## Notes
- `argentic up` runs in foreground. Press `Ctrl+C` to stop.
- If default search port is busy, a free port is selected automatically.

## Full Stack Reference
For the Docker-first/full-stack guide, use the main branch:
- https://github.com/zvspuentus-rgb/Argentic-Search-Lab/tree/main

## Additional Docs
- MCP integration: [`MCP_INTEGRATION.md`](MCP_INTEGRATION.md)
- Node runtime details: [`node-runtime/README.md`](node-runtime/README.md)
