# MCP Integration Notes

Main project guide: [`README.md`](README.md)

Use the MCP HTTP endpoint exposed by Docker at `http://localhost:8193/mcp` (default).

## VS Code MCP config (`mcp.json`)
```json
{
  "mcpServers": {
    "appagent": {
      "url": "http://localhost:8193/mcp"
    }
  }
}
```

## Supported MCP methods
- `initialize`
- `tools/list`
- `tools/call`
- `ping`

## Tools
- `search_quick`
- `search_deep`
- `fetch_url_context`

### `search_deep` advanced arguments
- `query` (string) or `queries` (array of strings)
- `limit` (default `5`)
- `lanes` (default `["general","science","news"]`)
- `urls` (optional array of explicit URLs to inspect)
- `include_context` (default `true`)
- `context_max_urls` (default `5`)
- `context_max_chars` (default `1800`)

### URL-aware behavior (new)
- If the query text itself contains one or more URLs, MCP auto-detects them.
- In deep mode, MCP can fetch cleaned page context from those URLs (and from top results) when `include_context=true`.
- For GitHub repo URLs, MCP applies strict repo scope (`site:github.com/<owner>/<repo>`), filters unrelated GitHub results, and extracts important repo files (README/config/source samples).
- Response now includes:
  - `urls_detected`
  - `context_items`
  - `repo_scope_enforced` (true when strict GitHub repo scope was applied)
  - `repo_scopes` (detected GitHub owner/repo pairs)
  - `analysis_hint` (agent-facing grounding guidance)

### GitHub repo grounding example
```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "name": "search_deep",
    "arguments": {
      "query": "analyze this repo deeply https://github.com/zvspuentus-rgb/Argentic-Search-Lab/tree/main",
      "limit": 10,
      "include_context": true,
      "context_max_urls": 8,
      "strict_repo_only": true
    }
  }
}
```

### `search_quick` extra arguments (new)
- `urls` (optional array)
- `include_context` (default `false`)
- `context_max_urls` (default `2`)
- `context_max_chars` (default `1400`)
- `strict_repo_only` (default `false`; when true and repo URL exists, keep only repo-scoped sources)

### `search_deep` extra arguments
- `strict_repo_only` (default `true`; recommended for repository analysis)

## Compatibility HTTP endpoints
- `GET /tools`
- `POST /tools/search_quick`
- `POST /tools/search_deep`
- `POST /tools/fetch_url_context`
- `POST /mcp/call`

## Agenting Hook Pattern
1. For fast factual lookup, call `search_quick`.
2. For deep research, call `search_deep` and you may send multiple queries in one call.
3. For URL grounding/context extraction, call `fetch_url_context`.
4. Feed normalized results back into your planner/synthesizer.

## Example deep call with multiple queries
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "search_deep",
    "arguments": {
      "queries": ["agent orchestration frameworks", "multi-agent reliability benchmarks"],
      "limit": 4,
      "include_context": true,
      "context_max_urls": 2
    }
  }
}
```
