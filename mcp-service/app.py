import asyncio
import json
import re
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

app = FastAPI(title="AppAgent MCP Tool Service", version="1.0.0")
SEARX_BASE = "http://searxng:8080"
MCP_PROTOCOL_VERSION = "2024-11-05"


class SearchInput(BaseModel):
    query: Optional[str] = Field(None, min_length=2)
    queries: List[str] = Field(default_factory=list)
    limit: int = Field(5, ge=1, le=20)


class FetchInput(BaseModel):
    url: str


class ToolCall(BaseModel):
    tool: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


class DeepSearchInput(BaseModel):
    query: Optional[str] = Field(None, min_length=2)
    queries: List[str] = Field(default_factory=list)
    limit: int = Field(5, ge=1, le=20)
    lanes: List[str] = Field(default_factory=lambda: ["general", "science", "news"])
    include_context: bool = False
    context_max_urls: int = Field(3, ge=0, le=10)
    context_max_chars: int = Field(1800, ge=500, le=6000)


class JsonRpcRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: Optional[Union[str, int]] = None
    method: str
    params: Dict[str, Any] = Field(default_factory=dict)


def normalize_results(results: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in results[:limit]:
        out.append(
            {
                "title": row.get("title") or row.get("url") or "Untitled",
                "url": row.get("url", ""),
                "content": row.get("content") or row.get("snippet") or "",
            }
        )
    return out


async def searx_search(query: str, categories: str, limit: int) -> List[Dict[str, Any]]:
    params = {
        "q": query,
        "format": "json",
        "categories": categories,
        "language": "auto",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{SEARX_BASE}/search", params=params)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"searxng error: {res.status_code}")
        data = res.json()
    return normalize_results(data.get("results", []), limit)


def validate_http_url(url: str) -> None:
    p = urlparse(url)
    if p.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="url must be http/https")


def collect_queries(query: Optional[str], queries: List[str]) -> List[str]:
    merged: List[str] = []
    for q in ([query] if query else []) + (queries or []):
        cleaned = re.sub(r"\s+", " ", (q or "").strip())
        if len(cleaned) < 2:
            continue
        if cleaned.lower() not in {x.lower() for x in merged}:
            merged.append(cleaned)
    return merged


def compact_text(text: str, max_chars: int) -> str:
    t = re.sub(r"\s+", " ", (text or "")).strip()
    if len(t) <= max_chars:
        return t
    clipped = t[:max_chars]
    parts = re.split(r"(?<=[.!?])\s+", clipped)
    if len(parts) <= 1:
        return clipped
    out = []
    total = 0
    for p in parts:
        if total + len(p) + 1 > max_chars:
            break
        out.append(p)
        total += len(p) + 1
    return " ".join(out).strip() or clipped


async def fetch_clean_context(url: str, max_chars: int) -> str:
    validate_http_url(url)
    mirror = f"https://r.jina.ai/http://{url.replace('https://', '').replace('http://', '')}"
    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.get(mirror)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"context fetch failed: {res.status_code}")
    return compact_text(res.text, max_chars)


def mcp_tools_payload() -> List[Dict[str, Any]]:
    return [
        {
            "name": "search_quick",
            "description": (
                "MANDATORY TOOL POLICY: Do NOT call this tool unless the user explicitly requests internet/web search. "
                "Forbidden without explicit request: proactive search, automatic lookup, background lookup, tool-discovery replies. "
                "If user asks 'what tools are available' or asks a general question, answer without calling this tool. "
                "Use for explicit search only (fast web lookup via SearXNG)."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "queries": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "number", "default": 5},
                },
                "anyOf": [{"required": ["query"]}, {"required": ["queries"]}],
            },
        },
        {
            "name": "search_deep",
            "description": (
                "MANDATORY TOOL POLICY: Do NOT call this tool unless the user explicitly requests deep research or deep web analysis. "
                "Forbidden without explicit request: automatic deep pipeline, default research mode, tool-discovery replies. "
                "If deep research was not explicitly requested, do not call this tool. "
                "Use only for explicit deep research (multi-lane web+science+news)."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "queries": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "number", "default": 5},
                    "lanes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": ["general", "science", "news"],
                    },
                    "include_context": {"type": "boolean", "default": False},
                    "context_max_urls": {"type": "number", "default": 3},
                    "context_max_chars": {"type": "number", "default": 1800},
                },
                "anyOf": [{"required": ["query"]}, {"required": ["queries"]}],
            },
        },
        {
            "name": "fetch_url_context",
            "description": (
                "MANDATORY TOOL POLICY: Do NOT call this tool unless the user explicitly asks to inspect/extract/summarize a specific URL. "
                "Forbidden without explicit request: automatic URL fetching, hidden context extraction, tool-discovery replies. "
                "If no explicit URL-context request exists, do not call this tool."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    ]


def mcp_error(msg_id: Optional[Union[str, int]], code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def mcp_ok(msg_id: Optional[Union[str, int]], result: Dict[str, Any]) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


@app.get("/health")
async def health() -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{SEARX_BASE}/search", params={"q": "health", "format": "json"})
        searx_ok = r.status_code == 200
    except Exception:
        searx_ok = False
    return {"ok": True, "service": "mcp-tools", "searxng": searx_ok}


@app.get("/tools")
async def tools() -> Dict[str, Any]:
    return {"tools": mcp_tools_payload()}


@app.post("/tools/search_quick")
async def search_quick(payload: SearchInput) -> Dict[str, Any]:
    query_list = collect_queries(payload.query, payload.queries)
    if not query_list:
        raise HTTPException(status_code=400, detail="provide 'query' or non-empty 'queries'")
    results = await searx_search(query_list[0], "general", payload.limit)
    return {"mode": "quick", "query": query_list[0], "count": len(results), "results": results}


@app.post("/tools/search_deep")
async def search_deep(payload: DeepSearchInput) -> Dict[str, Any]:
    query_list = collect_queries(payload.query, payload.queries)
    if not query_list:
        raise HTTPException(status_code=400, detail="provide 'query' or non-empty 'queries'")
    lanes = [lane for lane in payload.lanes if lane] or ["general", "science", "news"]
    merged: List[Dict[str, Any]] = []
    seen = set()
    queries_used: List[str] = []

    for query in query_list:
        queries_used.append(query)
        tasks = [searx_search(query, lane, max(3, payload.limit)) for lane in lanes]
        lane_results = await asyncio.gather(*tasks, return_exceptions=True)
        for rows in lane_results:
            if isinstance(rows, Exception):
                continue
            for row in rows:
                key = (row.get("url") or row.get("title") or "").strip().lower()
                if not key or key in seen:
                    continue
                seen.add(key)
                row["matched_query"] = query
                merged.append(row)

    merged = merged[: payload.limit * max(1, len(lanes)) * max(1, len(query_list))]

    context_items: List[Dict[str, Any]] = []
    if payload.include_context and payload.context_max_urls > 0:
        urls = [r.get("url", "") for r in merged if r.get("url")]
        urls = urls[: payload.context_max_urls]
        ctx_tasks = [fetch_clean_context(u, payload.context_max_chars) for u in urls]
        ctx_results = await asyncio.gather(*ctx_tasks, return_exceptions=True)
        for u, c in zip(urls, ctx_results):
            if isinstance(c, Exception):
                continue
            context_items.append({"url": u, "context": c})

    return {
        "mode": "deep",
        "queries_used": queries_used,
        "lanes_used": lanes,
        "count": len(merged),
        "results": merged,
        "context_items": context_items,
    }


@app.post("/tools/fetch_url_context")
async def fetch_url_context(payload: FetchInput) -> Dict[str, Any]:
    text = await fetch_clean_context(payload.url, 4000)
    return {"url": payload.url, "context": text}


@app.post("/mcp/call")
async def mcp_call(payload: ToolCall) -> Dict[str, Any]:
    if payload.tool == "search_quick":
        data = SearchInput(**payload.arguments)
        return await search_quick(data)
    if payload.tool == "search_deep":
        data = DeepSearchInput(**payload.arguments)
        return await search_deep(data)
    if payload.tool == "fetch_url_context":
        data = FetchInput(**payload.arguments)
        return await fetch_url_context(data)
    raise HTTPException(status_code=400, detail=f"unknown tool: {payload.tool}")


@app.get("/mcp")
async def mcp_info() -> Dict[str, Any]:
    return {
        "name": "appagent-mcp-http",
        "protocol": "jsonrpc-2.0",
        "mcp": True,
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "hint": "POST MCP JSON-RPC messages to /mcp",
    }


@app.post("/mcp")
async def mcp_http(request: Request) -> Response:
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(mcp_error(None, -32700, "Parse error"), status_code=400)

    is_batch = isinstance(payload, list)
    req_items = payload if is_batch else [payload]
    responses: List[Dict[str, Any]] = []

    for raw in req_items:
        try:
            msg = JsonRpcRequest(**raw)
        except Exception:
            responses.append(mcp_error(raw.get("id") if isinstance(raw, dict) else None, -32600, "Invalid Request"))
            continue

        if msg.method == "initialize":
            result = {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "appagent-mcp-http", "version": "1.0.0"},
            }
            responses.append(mcp_ok(msg.id, result))
            continue

        if msg.method == "notifications/initialized":
            continue

        if msg.method == "ping":
            responses.append(mcp_ok(msg.id, {}))
            continue

        if msg.method == "tools/list":
            responses.append(mcp_ok(msg.id, {"tools": mcp_tools_payload()}))
            continue

        if msg.method == "tools/call":
            tool_name = msg.params.get("name")
            tool_args = msg.params.get("arguments", {})
            if not tool_name:
                responses.append(mcp_error(msg.id, -32602, "Missing tool name"))
                continue
            try:
                result_data = await mcp_call(ToolCall(tool=tool_name, arguments=tool_args))
            except HTTPException as e:
                responses.append(mcp_error(msg.id, -32000, str(e.detail)))
                continue
            except Exception as e:
                responses.append(mcp_error(msg.id, -32000, str(e)))
                continue
            responses.append(
                mcp_ok(
                    msg.id,
                    {
                        "content": [{"type": "text", "text": json.dumps(result_data, ensure_ascii=False)}],
                        "isError": False,
                    },
                )
            )
            continue

        responses.append(mcp_error(msg.id, -32601, f"Method not found: {msg.method}"))

    if not responses:
        return Response(status_code=204)

    if is_batch:
        return JSONResponse(responses)
    return JSONResponse(responses[0])
