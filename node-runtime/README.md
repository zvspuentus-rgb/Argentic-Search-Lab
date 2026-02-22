# AppAgent Node Runtime

Node runtime for Argentic Search Lab.
This mode runs on **Node.js + Python venv** (SearXNG), without Docker.

## Requirements
- Node.js 20+
- Python 3.10-3.13
- `python3-venv` (Debian/Ubuntu package; installer tries auto-install when possible)
- `git`

## Install
From repo root:
```bash
bash ./scripts/bootstrap-node-runtime.sh
```

Then run:
```bash
cd node-runtime && npx argentic up
```

Optional (if global PATH is already linked):
```bash
argentic up
```

Manual:
```bash
cd node-runtime
npm install
npm link
npm run setup:search
```

## Run
```bash
cd node-runtime && npx argentic up
```

## CLI
- `argentic up`
- `argentic status`
- `argentic down`

## Endpoints
- UI: `http://localhost:3093`
- MCP: `http://localhost:3093/mcp`
- Health: `http://localhost:3093/health`
- Search direct: `http://localhost:8394/search?q=test&format=json`
- Search proxy: `http://localhost:3093/searxng/search?q=test&format=json`

## Notes
- `argentic up` runs foreground (`Ctrl+C` to stop).
- SearXNG runs from local venv at `node-runtime/.venv-searxng`.
- If default search port is occupied, next free port is selected automatically.
- For Docker-first stack, see main Docker section in root README.

## Android / Termux (proot Ubuntu or Debian)
This Node.js branch can run on Android via Termux + proot distro.

Requirements inside proot Ubuntu/Debian:
- `nodejs` + `npm`
- `python3.13` (or `python3.11`) + `python3-venv`
- `git`
- `curl`

Example:
```bash
apt update
apt install -y git curl nodejs npm python3 python3-venv
cd ~/Argentic-Search-Lab
export PYTHON_BIN=/usr/bin/python3.13
bash ./scripts/bootstrap-node-runtime.sh
cd node-runtime && npx argentic up
```

If your distro doesn't provide `python3.13`, use:
```bash
export PYTHON_BIN=/usr/bin/python3.11
```
