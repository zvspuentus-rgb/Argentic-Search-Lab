import asyncio
from datetime import datetime, timezone
from html import unescape
import json
import os
import re
from typing import Any, Dict, List, Optional, Union
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

app = FastAPI(title="AppAgent MCP Tool Service", version="1.0.0")
SEARX_BASE = os.getenv("SEARX_BASE", "http://searxng:8080")
MCP_PROTOCOL_VERSION = "2024-11-05"
URL_RX = re.compile(r"(https?://[^\s<>'\"`]+)", re.IGNORECASE)
GITHUB_REPO_RX = re.compile(r"^/([^/]+)/([^/]+)(?:/|$)")


class SearchInput(BaseModel):
    query: Optional[str] = Field(None, min_length=2)
    queries: List[str] = Field(default_factory=list)
    limit: int = Field(5, ge=1, le=20)
    urls: List[str] = Field(default_factory=list)
    include_context: bool = False
    context_max_urls: int = Field(2, ge=0, le=10)
    context_max_chars: int = Field(1400, ge=500, le=6000)
    strict_repo_only: bool = False


class FetchInput(BaseModel):
    url: str


class SmartFetchInput(BaseModel):
    url: str
    max_urls: int = Field(4, ge=1, le=12)
    max_chars_per_url: int = Field(2200, ge=500, le=8000)
    allow_external: bool = False


class ToolCall(BaseModel):
    tool: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


class DeepSearchInput(BaseModel):
    query: Optional[str] = Field(None, min_length=2)
    queries: List[str] = Field(default_factory=list)
    limit: int = Field(5, ge=1, le=20)
    lanes: List[str] = Field(default_factory=lambda: ["general", "science", "news"])
    urls: List[str] = Field(default_factory=list)
    include_context: bool = True
    context_max_urls: int = Field(5, ge=0, le=12)
    context_max_chars: int = Field(1800, ge=500, le=6000)
    strict_repo_only: bool = True


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


def normalize_url(url: str) -> str:
    return re.sub(r"[),.;]+$", "", str(url or "").strip())


def unique_urls(urls: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in urls or []:
        u = normalize_url(raw)
        if not u:
            continue
        try:
            validate_http_url(u)
        except Exception:
            continue
        key = u.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


def split_query_and_urls(text: str) -> Dict[str, Any]:
    raw = str(text or "")
    found = [normalize_url(x) for x in URL_RX.findall(raw)]
    urls = unique_urls(found)
    cleaned = URL_RX.sub(" ", raw)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return {"query": cleaned, "urls": urls}


def parse_github_repo(url: str) -> Optional[Dict[str, str]]:
    try:
        p = urlparse(url)
    except Exception:
        return None
    if p.netloc.lower() not in {"github.com", "www.github.com"}:
        return None
    m = GITHUB_REPO_RX.match(p.path or "")
    if not m:
        return None
    owner = (m.group(1) or "").strip()
    repo = (m.group(2) or "").strip()
    if not owner or not repo:
        return None
    return {"owner": owner, "repo": repo}


def github_scope_urls(urls: List[str]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    for u in urls or []:
        parsed = parse_github_repo(u)
        if not parsed:
            continue
        key = f"{parsed['owner'].lower()}/{parsed['repo'].lower()}"
        if key in seen:
            continue
        seen.add(key)
        out.append(parsed)
    return out


def filter_results_by_github_scope(results: List[Dict[str, Any]], scopes: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    if not scopes:
        return results
    prefixes = [f"https://github.com/{s['owner']}/{s['repo']}".lower() for s in scopes]
    out: List[Dict[str, Any]] = []
    for row in results:
        u = str(row.get("url", "")).lower()
        if any(u.startswith(pref) for pref in prefixes):
            out.append(row)
    return out


def build_repo_scoped_queries(base_queries: List[str], scopes: List[Dict[str, str]]) -> List[str]:
    if not scopes:
        return base_queries
    out: List[str] = []
    seen = set()
    seeds = base_queries or ["project structure main files architecture readme"]
    for q in seeds:
        for s in scopes:
            scoped = f"site:github.com/{s['owner']}/{s['repo']} {q}"
            key = scoped.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(scoped)
    return out


def merge_result_rows(rows: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for row in rows:
        key = str(row.get("url") or row.get("title") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(row)
        if len(out) >= max(1, int(limit)):
            break
    return out


def context_items_to_results(context_items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for c in context_items[: max(1, int(limit))]:
        url = str(c.get("url", ""))
        raw = str(c.get("context", ""))
        title = url.split("/")[-1] or "GitHub file context"
        out.append({"title": f"Repo Context: {title}", "url": url, "content": compact_text(raw, 260)})
    return out


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


def strip_html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", html or "")
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


async def fetch_direct_context(url: str, max_chars: int) -> str:
    validate_http_url(url)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; appagent-mcp/1.3)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    async with httpx.AsyncClient(timeout=25, follow_redirects=True, headers=headers) as client:
        res = await client.get(url)
        if res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"direct fetch failed: {res.status_code}")
    content_type = str(res.headers.get("content-type", "")).lower()
    raw_text = res.text if "html" not in content_type else strip_html_to_text(res.text)
    return compact_text(raw_text, max_chars)


def extract_links_from_text(base_url: str, text: str, max_links: int, allow_external: bool) -> List[str]:
    base = urlparse(base_url)
    base_host = (base.netloc or "").lower()
    base_path = (base.path or "").rstrip("/")
    base_query = base.query or ""
    base_key = f"{base_host}|{base_path}|{base_query}"
    out: List[str] = []
    seen = set()
    for raw in URL_RX.findall(text or ""):
        u = normalize_url(raw)
        if not u.lower().startswith("http"):
            continue
        try:
            p = urlparse(u)
        except Exception:
            continue
        if p.fragment:
            p = p._replace(fragment="")
            u = p.geturl()
        host = (p.netloc or "").lower()
        if not allow_external and base_host and host and host != base_host:
            continue
        cand_path = (p.path or "").rstrip("/")
        cand_key = f"{host}|{cand_path}|{p.query or ''}"
        if cand_key == base_key:
            continue
        key = cand_key.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
        if len(out) >= max_links:
            break
    return out


async def fetch_context_with_fallback(url: str, max_chars: int) -> Dict[str, Any]:
    try:
        return {"url": url, "context": await fetch_clean_context(url, max_chars), "source": "jina-mirror"}
    except Exception:
        try:
            return {"url": url, "context": await fetch_direct_context(url, max_chars), "source": "direct-http"}
        except Exception as err:
            return {"url": url, "context": "", "source": "none", "error": str(err)}


async def fetch_context_items(urls: List[str], max_urls: int, max_chars: int) -> List[Dict[str, Any]]:
    picked = unique_urls(urls)[: max(0, max_urls)]
    if not picked:
        return []
    tasks = [fetch_clean_context(u, max_chars) for u in picked]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: List[Dict[str, Any]] = []
    for u, c in zip(picked, results):
        if isinstance(c, Exception):
            continue
        out.append({"url": u, "context": c})
    return out


async def fetch_github_repo_context(owner: str, repo: str, max_files: int, max_chars_per_file: int) -> List[Dict[str, Any]]:
    max_files = max(1, min(20, int(max_files)))
    max_chars_per_file = max(500, min(5000, int(max_chars_per_file)))
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "appagent-mcp/1.1"}) as client:
        repo_res = await client.get(f"https://api.github.com/repos/{owner}/{repo}")
        if repo_res.status_code != 200:
            return []
        repo_info = repo_res.json()
        branch = repo_info.get("default_branch") or "main"
        tree_res = await client.get(f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}", params={"recursive": "1"})
        if tree_res.status_code != 200:
            return []
        tree = tree_res.json().get("tree", []) or []

    preferred: List[str] = []
    others: List[str] = []
    for node in tree:
        if node.get("type") != "blob":
            continue
        path = str(node.get("path", ""))
        if not path:
            continue
        lower = path.lower()
        if re.search(r"(readme|dockerfile|compose|package\.json|requirements\.txt|pyproject\.toml|setup\.py|go\.mod|cargo\.toml|pom\.xml|build\.gradle)", lower):
            preferred.append(path)
        elif re.search(r"\.(md|txt|py|js|ts|tsx|jsx|json|yml|yaml|toml)$", lower):
            others.append(path)
    selected = (preferred + others)[:max_files]
    if not selected:
        return []

    contexts: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=25, headers={"User-Agent": "appagent-mcp/1.1"}) as client:
        tasks = [client.get(f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}") for path in selected]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
    for path, res in zip(selected, responses):
        if isinstance(res, Exception):
            continue
        if getattr(res, "status_code", 0) != 200:
            continue
        snippet = compact_text(getattr(res, "text", ""), max_chars_per_file)
        if not snippet:
            continue
        contexts.append(
            {
                "url": f"https://github.com/{owner}/{repo}/blob/{branch}/{path}",
                "context": f"[GitHub file: {path}] {snippet}",
            }
        )
    return contexts


def mcp_tools_payload() -> List[Dict[str, Any]]:
    return [
        {
            "name": "search_quick",
            "description": (
                "MANDATORY TOOL POLICY: Do NOT call this tool unless the user explicitly requests internet/web search. "
                "Forbidden without explicit request: proactive search, automatic lookup, background lookup, tool-discovery replies. "
                "If user asks 'what tools are available' or asks a general question, answer without calling this tool. "
                "Use for explicit search only (fast web lookup via SearXNG). "
                "If the user provides a URL, you MUST prioritize URL/context extraction and ground your answer on context_items/results from that URL."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "queries": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "number", "default": 5},
                    "urls": {"type": "array", "items": {"type": "string"}},
                    "include_context": {"type": "boolean", "default": False},
                    "context_max_urls": {"type": "number", "default": 2},
                    "context_max_chars": {"type": "number", "default": 1400},
                    "strict_repo_only": {"type": "boolean", "default": False},
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
                "Use only for explicit deep research (multi-lane web+science+news). "
                "If a URL/repository is provided, scope and grounding must prioritize that URL/repository before unrelated web sources."
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
                    "urls": {"type": "array", "items": {"type": "string"}},
                    "include_context": {"type": "boolean", "default": True},
                    "context_max_urls": {"type": "number", "default": 5},
                    "context_max_chars": {"type": "number", "default": 1800},
                    "strict_repo_only": {"type": "boolean", "default": True},
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
        {
            "name": "fetch_url_context_smart",
            "description": (
                "Use when the user asks to inspect a URL deeply across multiple related links. "
                "Starts from the given URL, follows additional links (same host by default), "
                "and returns merged grounded context_items."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "max_urls": {"type": "number", "default": 4},
                    "max_chars_per_url": {"type": "number", "default": 2200},
                    "allow_external": {"type": "boolean", "default": False},
                },
                "required": ["url"],
            },
        },
    ]


def mcp_error(msg_id: Optional[Union[str, int]], code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def mcp_ok(msg_id: Optional[Union[str, int]], result: Dict[str, Any]) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def current_date_context() -> Dict[str, str]:
    now_utc = datetime.now(timezone.utc)
    now_local = datetime.now().astimezone()
    return {
        "today_utc": now_utc.date().isoformat(),
        "now_utc_iso": now_utc.isoformat(),
        "today_local": now_local.date().isoformat(),
        "now_local_iso": now_local.isoformat(),
        "weekday_utc": now_utc.strftime("%A"),
        "timezone_local": str(now_local.tzinfo),
        "instruction": (
            "Use this date context as authoritative current date/time for temporal reasoning. "
            "Do not assume training-cutoff dates."
        ),
    }


@app.get("/health")
async def health() -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{SEARX_BASE}/search", params={"q": "health", "format": "json"})
        searx_ok = r.status_code == 200
    except Exception:
        searx_ok = False
    return {"ok": True, "service": "mcp-tools", "searxng": searx_ok, "current_date": current_date_context()}


@app.get("/tools")
async def tools() -> Dict[str, Any]:
    return {"tools": mcp_tools_payload(), "current_date": current_date_context()}


@app.post("/tools/search_quick")
async def search_quick(payload: SearchInput) -> Dict[str, Any]:
    query_list = collect_queries(payload.query, payload.queries)
    if not query_list and not payload.urls:
        raise HTTPException(status_code=400, detail="provide 'query' or non-empty 'queries'")

    explicit_urls = unique_urls(payload.urls)
    cleaned_queries: List[str] = []
    for q in query_list:
        split = split_query_and_urls(q)
        cleaned = split["query"]
        if cleaned:
            cleaned_queries.append(cleaned)
        explicit_urls.extend(split["urls"])
    explicit_urls = unique_urls(explicit_urls)

    repo_scopes = github_scope_urls(explicit_urls)
    scoped_queries = build_repo_scoped_queries(cleaned_queries, repo_scopes) if repo_scopes else cleaned_queries
    primary_query = scoped_queries[0] if scoped_queries else ""
    results: List[Dict[str, Any]] = []
    if primary_query:
        results = await searx_search(primary_query, "general", payload.limit)
    strict_repo_only = bool(payload.strict_repo_only and repo_scopes)
    if repo_scopes:
        filtered = filter_results_by_github_scope(results, repo_scopes)
        if strict_repo_only:
            results = filtered
        elif filtered:
            # Prefer repo hits, but keep fallback behavior when strict mode is off.
            results = merge_result_rows(filtered + results, payload.limit)

    context_items: List[Dict[str, Any]] = []
    effective_include_context = bool(payload.include_context or explicit_urls)
    if effective_include_context and payload.context_max_urls > 0:
        url_pool = explicit_urls + [r.get("url", "") for r in results if r.get("url")]
        context_items = await fetch_context_items(url_pool, payload.context_max_urls, payload.context_max_chars)
        for scope in repo_scopes:
            repo_ctx = await fetch_github_repo_context(
                scope["owner"],
                scope["repo"],
                max_files=min(10, payload.context_max_urls * 3),
                max_chars_per_file=min(2000, payload.context_max_chars),
            )
            context_items.extend(repo_ctx)
    if repo_scopes:
        results = merge_result_rows(results + context_items_to_results(context_items, payload.limit), payload.limit)

    return {
        "mode": "quick",
        "query": primary_query,
        "queries_used": scoped_queries[:1],
        "count": len(results),
        "results": results,
        "urls_detected": explicit_urls,
        "context_items": context_items,
        "repo_scope_enforced": bool(repo_scopes),
        "strict_repo_only": strict_repo_only,
        "repo_scopes": repo_scopes,
        "current_date": current_date_context(),
        "analysis_hint": {
            "grounding_required": bool(explicit_urls or context_items),
            "priority_sources": ["context_items", "results"],
            "do_not_claim_no_access_when_context_present": bool(context_items),
        },
    }


@app.post("/tools/search_deep")
async def search_deep(payload: DeepSearchInput) -> Dict[str, Any]:
    query_list = collect_queries(payload.query, payload.queries)
    if not query_list and not payload.urls:
        raise HTTPException(status_code=400, detail="provide 'query' or non-empty 'queries'")
    lanes = [lane for lane in payload.lanes if lane] or ["general", "science", "news"]
    merged: List[Dict[str, Any]] = []
    seen = set()
    queries_used: List[str] = []
    explicit_urls = unique_urls(payload.urls)

    cleaned_queries: List[str] = []
    for query in query_list:
        split = split_query_and_urls(query)
        explicit_urls.extend(split["urls"])
        cleaned = split["query"]
        if cleaned:
            cleaned_queries.append(cleaned)

    explicit_urls = unique_urls(explicit_urls)
    repo_scopes = github_scope_urls(explicit_urls)
    scoped_queries = build_repo_scoped_queries(cleaned_queries, repo_scopes) if repo_scopes else cleaned_queries
    effective_lanes = ["general", "it"] if repo_scopes else lanes
    strict_repo_only = bool(payload.strict_repo_only and repo_scopes)

    for query in scoped_queries:
        queries_used.append(query)
        tasks = [searx_search(query, lane, max(3, payload.limit)) for lane in effective_lanes]
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

    if repo_scopes:
        filtered = filter_results_by_github_scope(merged, repo_scopes)
        if strict_repo_only:
            merged = filtered
        elif filtered:
            merged = filtered + merged
    merged = merged[: payload.limit * max(1, len(effective_lanes)) * max(1, len(scoped_queries) or 1)]

    context_items: List[Dict[str, Any]] = []
    if payload.include_context and payload.context_max_urls > 0:
        urls = explicit_urls + [r.get("url", "") for r in merged if r.get("url")]
        context_items = await fetch_context_items(urls, payload.context_max_urls, payload.context_max_chars)
        for scope in repo_scopes:
            repo_ctx = await fetch_github_repo_context(
                scope["owner"],
                scope["repo"],
                max_files=min(12, payload.context_max_urls * 3),
                max_chars_per_file=min(2400, payload.context_max_chars),
            )
            context_items.extend(repo_ctx)
    if repo_scopes:
        merged = merge_result_rows(merged + context_items_to_results(context_items, payload.limit * max(1, len(effective_lanes))), payload.limit * max(1, len(effective_lanes)))

    return {
        "mode": "deep",
        "queries_used": queries_used,
        "lanes_used": effective_lanes,
        "count": len(merged),
        "results": merged,
        "urls_detected": explicit_urls,
        "context_items": context_items,
        "repo_scope_enforced": bool(repo_scopes),
        "strict_repo_only": strict_repo_only,
        "repo_scopes": repo_scopes,
        "current_date": current_date_context(),
        "analysis_hint": {
            "grounding_required": bool(explicit_urls or context_items),
            "priority_sources": ["context_items", "results"],
            "do_not_claim_no_access_when_context_present": bool(context_items),
        },
    }


@app.post("/tools/fetch_url_context")
async def fetch_url_context(payload: FetchInput) -> Dict[str, Any]:
    try:
        text = await fetch_clean_context(payload.url, 4000)
        return {"url": payload.url, "context": text, "source": "jina-mirror", "current_date": current_date_context()}
    except Exception as first_err:
        try:
            text = await fetch_direct_context(payload.url, 4000)
            return {"url": payload.url, "context": text, "source": "direct-http", "current_date": current_date_context()}
        except Exception as second_err:
            return {
                "url": payload.url,
                "context": "",
                "source": "none",
                "error": f"url_context_failed: {first_err}; fallback_failed: {second_err}",
                "current_date": current_date_context(),
            }


@app.post("/tools/fetch_url_context_smart")
async def fetch_url_context_smart(payload: SmartFetchInput) -> Dict[str, Any]:
    validate_http_url(payload.url)
    max_urls = max(1, int(payload.max_urls))
    max_chars = max(500, int(payload.max_chars_per_url))

    items: List[Dict[str, Any]] = []
    visited: List[str] = []

    primary = await fetch_context_with_fallback(payload.url, max_chars)
    items.append(primary)
    visited.append(payload.url)

    repo = parse_github_repo(payload.url)
    if repo:
        repo_ctx = await fetch_github_repo_context(
            repo["owner"],
            repo["repo"],
            max_files=min(24, max_urls * 4),
            max_chars_per_file=max_chars,
        )
        for c in repo_ctx:
            items.append({"url": c.get("url", ""), "context": c.get("context", ""), "source": "github-repo"})
            if len(items) >= max_urls:
                break
    else:
        link_budget = max(0, max_urls - 1)
        links = extract_links_from_text(payload.url, str(primary.get("context", "")), link_budget, payload.allow_external)
        tasks = [fetch_context_with_fallback(u, max_chars) for u in links]
        if tasks:
            fetched = await asyncio.gather(*tasks, return_exceptions=True)
            for u, entry in zip(links, fetched):
                visited.append(u)
                if isinstance(entry, Exception):
                    items.append({"url": u, "context": "", "source": "none", "error": str(entry)})
                else:
                    items.append(entry)

    merged = "\n\n".join([f"URL: {it.get('url','')}\n{it.get('context','')}" for it in items if it.get("context")]).strip()
    return {
        "url": payload.url,
        "mode": "smart",
        "urls_visited": visited,
        "count": len(items),
        "context_items": items,
        "merged_context": compact_text(merged, min(20000, max_chars * max_urls)),
        "current_date": current_date_context(),
    }


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
    if payload.tool == "fetch_url_context_smart":
        data = SmartFetchInput(**payload.arguments)
        return await fetch_url_context_smart(data)
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
            responses.append(mcp_ok(msg.id, {"tools": mcp_tools_payload(), "current_date": current_date_context()}))
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
