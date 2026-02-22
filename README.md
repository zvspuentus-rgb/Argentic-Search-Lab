# Argentic Search Lab (Node.js Branch)
![Argentic Search Lab Logo](docs/logo.svg)

Node-first branch for Argentic Search Lab: Web UI + MCP + Search with a single CLI (`argentic`).

## Quick Start
```bash
git clone https://github.com/zvspuentus-rgb/Argentic-Search-Lab.git
cd Argentic-Search-Lab
bash ./scripts/bootstrap-node-runtime.sh
argentic up
```

## CLI
- `argentic up` -> start UI + MCP + Search
- `argentic status` -> show running status
- `argentic down` -> stop runtime

## Endpoints
- UI: `http://localhost:3093`
- MCP: `http://localhost:3093/mcp`
- Search direct: `http://localhost:8394/search?q=test&format=json`
- Search via app proxy: `http://localhost:3093/searxng/search?q=test&format=json`

## Visual Workflow
![Pipeline Overview](docs/pipeline.svg)
![MCP Flow](docs/mcp-flow.svg)

## MCP Tools
- `search_quick`
- `search_deep`
- `fetch_url_context`

Tool policy and JSON config examples:
- [`MCP_INTEGRATION.md`](MCP_INTEGRATION.md)

### MCP Visual Workflow (Tool Branches)
```mermaid
flowchart TB
    A["Client / Agent Request"] --> B{"Intent Router"}
    B -->|"Fast lookup"| Q["search_quick"]
    B -->|"Deep research"| D["search_deep"]
    B -->|"Specific URL inspect"| U["fetch_url_context"]

    Q --> Q1["SearXNG fast query"]
    Q1 --> Q2["Top results + optional context"]
    Q2 --> OUT["Grounded answer to user"]

    D --> D1["Multi-query planning"]
    D1 --> D2["Parallel lanes (general/science/news)"]
    D2 --> D3["Context merge + dedupe"]
    D3 --> OUT

    U --> U1{"GitHub URL?"}
    U1 -->|"Yes"| U2["Repo-aware traversal (index + related files)"]
    U1 -->|"No"| U3["Single URL clean extract"]
    U2 --> OUT
    U3 --> OUT
    classDef entry fill:#123047,stroke:#5fa8ff,color:#e8f4ff,stroke-width:1.4px;
    classDef quick fill:#153a2e,stroke:#43d3a8,color:#eafff6,stroke-width:1.4px;
    classDef deep fill:#3a1d12,stroke:#ffb067,color:#fff2e8,stroke-width:1.4px;
    classDef url fill:#2f2248,stroke:#b690ff,color:#f2eaff,stroke-width:1.4px;
    classDef output fill:#1f2f3a,stroke:#7fd1ff,color:#eaf8ff,stroke-width:1.4px;
    class A,B entry;
    class Q,Q1,Q2 quick;
    class D,D1,D2,D3 deep;
    class U,U1,U2,U3 url;
    class OUT output;
```

## Search + LLM Routing
- Search endpoint is internal to app runtime, exposed externally at `:8394` and app proxy `/searxng/*`.
- LLM proxy routes:
  - `/lmstudio/*` -> `LMSTUDIO_BASE` (default `http://localhost:1234`)
  - `/ollama/*` -> `OLLAMA_BASE` (default `http://localhost:11434`)

## Environment (optional)
- `PORT` (default `3093`)
- `SEARX_PORT` (default `8394`)
- `SEARX_BASE`
- `LMSTUDIO_BASE`
- `OLLAMA_BASE`

## Notes
- `argentic up` runs in foreground (`Ctrl+C` to stop).
- If search default port is occupied, runtime chooses a free port automatically.

## Docker / Full Stack
For Docker-first/full-stack instructions, use `main`:
- https://github.com/zvspuentus-rgb/Argentic-Search-Lab/tree/main

## Additional Docs
- Node runtime details: [`node-runtime/README.md`](node-runtime/README.md)
