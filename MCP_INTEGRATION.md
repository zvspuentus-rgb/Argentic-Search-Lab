# MCP Integration Notes

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
- `include_context` (default `false`)
- `context_max_urls` (default `3`)
- `context_max_chars` (default `1800`)

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
