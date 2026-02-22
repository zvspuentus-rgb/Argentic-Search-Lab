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
![Pipeline Overview](docs/pipeline.png)
![MCP Flow](docs/mcp-flow.png)

```mermaid
flowchart LR
    U["User / Agent"] --> C["argentic up"]
    C --> UI["Web UI :3093"]
    C --> MCP["MCP :3093/mcp"]
    C --> SX["SearXNG :8394"]
    UI --> MCP
    UI --> SX
    MCP --> SX
    classDef entry fill:#123047,stroke:#5fa8ff,color:#e8f4ff,stroke-width:1.4px;
    classDef runtime fill:#153a2e,stroke:#43d3a8,color:#eafff6,stroke-width:1.4px;
    class U entry;
    class C,UI,MCP,SX runtime;
```

## MCP Tools
- `search_quick`
- `search_deep`
- `fetch_url_context`

Tool policy and JSON config examples:
- [`MCP_INTEGRATION.md`](MCP_INTEGRATION.md)

### MCP JSON (Copy/Paste)
Use this in clients that support URL-based MCP servers:

```json
{
  "mcpServers": {
    "appagent-node": {
      "url": "http://localhost:3093/mcp"
    }
  }
}
```

For clients that require `command` + `args`:

```json
{
  "mcpServers": {
    "appagent-node": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3093/mcp",
        "--transport",
        "http-only",
        "--allow-http"
      ],
      "env": {}
    }
  }
}
```

### MCP Visual Workflow (Tool Branches)
```mermaid
flowchart TB
    A["Client / Agent Request"] --> B{"Intent Router"}

    subgraph SQ["Quick Lane"]
      Q["search_quick"] --> Q1["SearXNG fast query"]
      Q1 --> Q2["Top results + optional context"]
    end

    subgraph SD["Deep Lane"]
      D["search_deep"] --> D1["Multi-query planning"]
      D1 --> D2["Parallel lanes (general/science/news)"]
      D2 --> D3["Context merge + dedupe"]
    end

    subgraph SU["URL Context Lane"]
      U["fetch_url_context"] --> U1{"GitHub URL?"}
      U1 -->|"Yes"| U2["Repo-aware traversal (index + related files)"]
      U1 -->|"No"| U3["Single URL clean extract"]
    end

    B -->|"Fast lookup"| Q
    B -->|"Deep research"| D
    B -->|"Specific URL inspect"| U
    Q2 --> OUT["Grounded answer to user"]
    D3 --> OUT
    U2 --> OUT
    U3 --> OUT

    classDef entry fill:#123047,stroke:#5fa8ff,color:#e8f4ff,stroke-width:1.4px;
    classDef quick fill:#153a2e,stroke:#43d3a8,color:#eafff6,stroke-width:1.4px;
    classDef deep fill:#3a1d12,stroke:#ffb067,color:#fff2e8,stroke-width:1.4px;
    classDef url fill:#2f2248,stroke:#b690ff,color:#f2eaff,stroke-width:1.4px;
    classDef output fill:#1f2f3a,stroke:#7fd1ff,color:#eaf8ff,stroke-width:1.4px;
    style SQ fill:#10261f,stroke:#43d3a8,stroke-width:1px,color:#eafff6
    style SD fill:#2a1a11,stroke:#ffb067,stroke-width:1px,color:#fff2e8
    style SU fill:#201a33,stroke:#b690ff,stroke-width:1px,color:#f2eaff
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
