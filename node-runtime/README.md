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

If your server has multiple Python versions and you want to force one:
```bash
export PYTHON_BIN=python3.12
bash ./scripts/bootstrap-node-runtime.sh
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

## Troubleshooting
If setup fails on `msgspec`:
```bash
export PYTHON_BIN=python3.12
bash ./scripts/bootstrap-node-runtime.sh
```
If your distro still builds `msgspec` from source:
```bash
sudo apt update
sudo apt install -y build-essential python3.12-dev rustc cargo pkg-config
```
