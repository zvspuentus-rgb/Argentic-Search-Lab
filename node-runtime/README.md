# AppAgent Node Runtime
![Argentic Search Lab Logo](../docs/logo.svg)

Node runtime for Argentic Search Lab in this branch.

## Install
From repo root:
```bash
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
argentic up
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

## Workflow Visuals
- Pipeline: `../docs/pipeline.svg`
- MCP flow: `../docs/mcp-flow.svg`

```mermaid
flowchart LR
    C["MCP Client"] --> R{"Choose Tool"}
    R --> Q["search_quick"]
    R --> D["search_deep"]
    R --> F["fetch_url_context"]

    Q --> QO["Fast web results"]
    D --> DO["Deep multi-lane synthesis"]
    F --> FO["URL/repo-grounded context"]

    QO --> O["Final response"]
    DO --> O
    FO --> O
    classDef entry fill:#123047,stroke:#5fa8ff,color:#e8f4ff,stroke-width:1px;
    classDef quick fill:#153a2e,stroke:#43d3a8,color:#eafff6,stroke-width:1px;
    classDef deep fill:#3a1d12,stroke:#ffb067,color:#fff2e8,stroke-width:1px;
    classDef url fill:#2f2248,stroke:#b690ff,color:#f2eaff,stroke-width:1px;
    classDef output fill:#1f2f3a,stroke:#7fd1ff,color:#eaf8ff,stroke-width:1px;
    class C,R entry;
    class Q,QO quick;
    class D,DO deep;
    class F,FO url;
    class O output;
```

## LLM Routing
- `/lmstudio/*` is proxied to `LMSTUDIO_BASE` (default `http://localhost:1234`)
- `/ollama/*` is proxied to `OLLAMA_BASE` (default `http://localhost:11434`)

## Environment (optional)
- `PORT` (default `3093`)
- `SEARX_BASE`
- `LMSTUDIO_BASE`
- `OLLAMA_BASE`
- `SEARX_PORT` (default `8394` for local search)

## Notes
- `argentic up` runs in foreground (`Ctrl+C` to stop).
- Search port auto-fallback is enabled if default port is occupied.
- For Docker-first/full-stack instructions, see main branch:
  - https://github.com/zvspuentus-rgb/Argentic-Search-Lab/tree/main
