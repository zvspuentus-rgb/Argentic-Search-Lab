const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 3093);
const SEARX_BASE = (process.env.SEARX_BASE || 'http://localhost:8394').replace(/\/$/, '');
const LMSTUDIO_BASE = (process.env.LMSTUDIO_BASE || 'http://localhost:1234').replace(/\/$/, '');
const OLLAMA_BASE = (process.env.OLLAMA_BASE || 'http://localhost:11434').replace(/\/$/, '');
const APP_ROOT = path.resolve(__dirname, '..');
const URL_RX = /(https?:\/\/[^\s<>'"`]+)/gi;

function currentDateContext() {
  const now = new Date();
  return {
    today_utc: now.toISOString().slice(0, 10),
    now_utc_iso: now.toISOString(),
    today_local: now.toLocaleDateString('en-CA'),
    now_local_iso: now.toString(),
    weekday_utc: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    timezone_local: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    instruction: 'Use this date context as authoritative current date/time for temporal reasoning. Do not assume training-cutoff dates.'
  };
}

function compactText(input, max = 2200) {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeUrl(u) {
  try {
    const p = new URL(String(u || '').trim());
    if (!/^https?:$/.test(p.protocol)) return '';
    p.hash = '';
    return p.toString();
  } catch {
    return '';
  }
}

function uniqueUrls(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const u = normalizeUrl(item);
    if (!u) continue;
    const k = u.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

function parseGithubTarget(inputUrl) {
  try {
    const u = new URL(inputUrl);
    if (!['github.com', 'www.github.com'].includes(u.hostname.toLowerCase())) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const out = { owner: parts[0], repo: parts[1], kind: 'repo', ref: '', path: '' };
    if (parts.length >= 4 && (parts[2] === 'blob' || parts[2] === 'tree')) {
      out.kind = parts[2];
      out.ref = parts[3] || '';
      out.path = parts.slice(4).join('/');
    }
    return out;
  } catch {
    return null;
  }
}

async function searxSearch(query, categories = 'general', limit = 6) {
  const url = new URL(`${SEARX_BASE}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', categories);
  url.searchParams.set('safesearch', '0');
  url.searchParams.set('language', 'en');
  const res = await fetch(url, { headers: { 'User-Agent': 'appagent-node/1.0' } });
  if (!res.ok) throw new Error(`searx status ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json.results) ? json.results : [];
  return rows.slice(0, Math.max(1, Math.min(20, Number(limit) || 6))).map((r) => ({
    title: r.title || r.url || 'Untitled',
    url: r.url || '',
    content: compactText(r.content || r.snippet || '', 360)
  }));
}

async function fetchDirectContext(url, maxChars = 2200) {
  const res = await fetch(url, { headers: { 'User-Agent': 'appagent-node/1.0' } });
  if (!res.ok) throw new Error(`fetch status ${res.status}`);
  const body = await res.text();
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return compactText(text, maxChars);
}

async function fetchGithubTree(owner, repo) {
  const headers = { 'User-Agent': 'appagent-node/1.0' };
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) return { branch: 'main', paths: [] };
  const info = await repoRes.json();
  const branch = info.default_branch || 'main';
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
  if (!treeRes.ok) return { branch, paths: [] };
  const tree = (await treeRes.json()).tree || [];
  return { branch, paths: tree.filter((n) => n.type === 'blob').map((n) => n.path).filter(Boolean) };
}

function pickInitialRepoPaths(paths, relPath, maxPick) {
  const scored = paths.map((p) => {
    const l = p.toLowerCase();
    let score = 0;
    if (relPath && l === relPath.toLowerCase()) score += 1200;
    if (/readme|architecture|overview|docs\//.test(l)) score += 250;
    if (/dockerfile|compose|package\.json|requirements\.txt|pyproject\.toml/.test(l)) score += 190;
    if (/\.(md|txt|js|ts|jsx|tsx|py|json|yml|yaml|toml)$/.test(l)) score += 60;
    if (/\.(png|jpg|jpeg|gif|svg|ico|pdf|zip|gz|mp4)$/.test(l)) score -= 500;
    return { score, p };
  }).sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > -200).slice(0, Math.max(1, maxPick)).map((x) => x.p);
}

function inferRelatedPaths(content, treePaths, maxHits = 6) {
  const out = [];
  const seen = new Set();
  const links = [...String(content || '').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
  for (let raw of links) {
    raw = String(raw || '').trim();
    if (!raw || raw.includes('://') || raw.startsWith('#')) continue;
    raw = raw.split('#')[0].split('?')[0].replace(/^\.\//, '').replace(/^\//, '');
    for (const p of treePaths) {
      if (p === raw || p.toLowerCase().endsWith(`/${raw.toLowerCase()}`) || p.toLowerCase().endsWith(raw.toLowerCase())) {
        const k = p.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(p);
        break;
      }
    }
    if (out.length >= maxHits) break;
  }
  return out;
}

async function fetchGithubTargetContext(url, maxUrls = 5, maxCharsPerUrl = 2200) {
  const t = parseGithubTarget(url);
  if (!t) return [];
  const { owner, repo, kind } = t;
  const relPath = t.path || '';
  const treeInfo = await fetchGithubTree(owner, repo);
  const branch = t.ref || treeInfo.branch || 'main';
  const treePaths = treeInfo.paths || [];

  const items = [];
  const seen = new Set();
  const add = (entry) => {
    const key = String(entry.url || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(entry);
  };

  if (treePaths.length) {
    add({
      url: `https://github.com/${owner}/${repo}/tree/${branch}`,
      source: 'github-tree-index',
      context: compactText(`[GitHub repo file index | branch=${branch} | files=${treePaths.length}]\n${treePaths.slice(0, 120).join('\n')}`, maxCharsPerUrl)
    });
  }

  const selected = pickInitialRepoPaths(treePaths, relPath, Math.max(1, maxUrls - items.length));
  const queue = [...selected];
  const used = new Set();

  while (queue.length && items.length < maxUrls) {
    const p = queue.shift();
    const k = String(p || '').toLowerCase();
    if (!k || used.has(k)) continue;
    used.add(k);

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p}`;
    const blobUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${p}`;
    try {
      const res = await fetch(rawUrl, { headers: { 'User-Agent': 'appagent-node/1.0' } });
      if (!res.ok) continue;
      const body = await res.text();
      add({ url: blobUrl, source: 'github-raw', context: compactText(`[GitHub file: ${p}] ${body}`, maxCharsPerUrl) });
      const related = inferRelatedPaths(body, treePaths, 6);
      for (const rp of related) {
        const rk = String(rp).toLowerCase();
        if (!used.has(rk) && !queue.some((q) => String(q).toLowerCase() === rk)) queue.push(rp);
      }
    } catch {
      // ignore
    }
  }

  return items.slice(0, maxUrls);
}

function collectQueries(body = {}) {
  const out = [];
  if (typeof body.query === 'string' && body.query.trim()) out.push(body.query.trim());
  if (Array.isArray(body.queries)) for (const q of body.queries) if (typeof q === 'string' && q.trim()) out.push(q.trim());
  return out;
}

function detectUrlsFromQueries(queries) {
  const found = [];
  for (const q of queries || []) for (const m of String(q).matchAll(URL_RX)) found.push(m[1]);
  return uniqueUrls(found);
}

function mcpToolsPayload() {
  return [
    { name: 'search_quick', description: 'Fast web search via SearXNG (JSON).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, queries: { type: 'array', items: { type: 'string' } }, limit: { type: 'number', default: 5 }, urls: { type: 'array', items: { type: 'string' } }, include_context: { type: 'boolean', default: false }, context_max_urls: { type: 'number', default: 2 }, context_max_chars: { type: 'number', default: 1400 } }, anyOf: [{ required: ['query'] }, { required: ['queries'] }] } },
    { name: 'search_deep', description: 'Deep multi-lane search (general/science/news).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, queries: { type: 'array', items: { type: 'string' } }, limit: { type: 'number', default: 5 }, lanes: { type: 'array', items: { type: 'string' }, default: ['general', 'science', 'news'] }, urls: { type: 'array', items: { type: 'string' } }, include_context: { type: 'boolean', default: true }, context_max_urls: { type: 'number', default: 5 }, context_max_chars: { type: 'number', default: 1800 } }, anyOf: [{ required: ['query'] }, { required: ['queries'] }] } },
    { name: 'fetch_url_context', description: 'Fetch URL context. GitHub URLs are repo-aware and traverse related files.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, max_urls: { type: 'number', default: 5 }, max_chars_per_url: { type: 'number', default: 2200 } }, required: ['url'] } }
  ];
}

async function proxyRequest(req, res, base, stripPrefix) {
  try {
    const original = req.originalUrl || req.url || '/';
    const pathWithQuery = original.startsWith(stripPrefix) ? original.slice(stripPrefix.length) || '/' : original;
    const target = `${base}${pathWithQuery.startsWith('/') ? '' : '/'}${pathWithQuery}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    delete headers.connection;
    delete headers['accept-encoding'];

    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      body = JSON.stringify(req.body || {});
      headers['content-type'] = headers['content-type'] || 'application/json';
    }

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      duplex: 'half'
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-encoding') return;
      if (key.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: 'proxy_failed', message: String(err?.message || err) });
  }
}

async function toolFetchUrlContext(args = {}) {
  const url = normalizeUrl(args.url || '');
  if (!url) throw Object.assign(new Error('valid url is required'), { status: 400 });
  const maxUrls = Math.max(1, Math.min(20, Number(args.max_urls || 5)));
  const maxChars = Math.max(500, Math.min(8000, Number(args.max_chars_per_url || 2200)));
  const gt = parseGithubTarget(url);
  if (gt) {
    const contextItems = await fetchGithubTargetContext(url, maxUrls, maxChars);
    const context = compactText(contextItems.map((it) => `URL: ${it.url}\n${it.context}`).join('\n\n'), Math.min(20000, maxChars * maxUrls));
    return { url, mode: 'repo-aware', source: 'github-repo-context', count: contextItems.length, context_items: contextItems, context, current_date: currentDateContext() };
  }
  try {
    const context = await fetchDirectContext(url, maxChars);
    return { url, mode: 'single-url', source: 'direct-http', context, current_date: currentDateContext() };
  } catch (err) {
    return { url, mode: 'single-url', source: 'none', context: '', error: String(err?.message || err), current_date: currentDateContext() };
  }
}

async function toolSearchQuick(args = {}) {
  const queries = collectQueries(args);
  const explicitUrls = uniqueUrls([...(Array.isArray(args.urls) ? args.urls : []), ...detectUrlsFromQueries(queries)]);
  const query = queries[0] || '';
  if (!query && explicitUrls.length === 0) throw Object.assign(new Error("provide 'query' or 'queries'"), { status: 400 });
  let results = [];
  if (query) {
    try { results = await searxSearch(query, 'general', Number(args.limit || 5)); }
    catch (err) { results = [{ title: 'SearXNG unavailable', url: '', content: String(err?.message || err) }]; }
  }
  let contextItems = [];
  const includeContext = Boolean(args.include_context || explicitUrls.length);
  if (includeContext) {
    const maxUrls = Math.max(1, Math.min(10, Number(args.context_max_urls || 2)));
    const maxChars = Math.max(500, Math.min(6000, Number(args.context_max_chars || 1400)));
    for (const u of explicitUrls.slice(0, maxUrls)) {
      const t = parseGithubTarget(u);
      if (t) contextItems.push(...await fetchGithubTargetContext(u, Math.max(1, maxUrls - contextItems.length), maxChars));
      else { try { contextItems.push({ url: u, source: 'direct-http', context: await fetchDirectContext(u, maxChars) }); } catch {} }
      if (contextItems.length >= maxUrls) break;
    }
  }
  return { mode: 'quick', query, count: results.length, results, urls_detected: explicitUrls, context_items: contextItems, current_date: currentDateContext() };
}

async function toolSearchDeep(args = {}) {
  const queries = collectQueries(args);
  const explicitUrls = uniqueUrls([...(Array.isArray(args.urls) ? args.urls : []), ...detectUrlsFromQueries(queries)]);
  if (queries.length === 0 && explicitUrls.length === 0) throw Object.assign(new Error("provide 'query' or 'queries'"), { status: 400 });
  const lanes = Array.isArray(args.lanes) && args.lanes.length ? args.lanes : ['general', 'science', 'news'];
  const limit = Math.max(1, Math.min(20, Number(args.limit || 5)));
  const merged = [];
  const seen = new Set();
  for (const q of queries.length ? queries : ['']) {
    const laneResults = await Promise.all(lanes.map((lane) => searxSearch(q, lane, limit).catch(() => [])));
    for (const rows of laneResults) {
      for (const r of rows) {
        const k = String(r.url || r.title || '').toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        merged.push({ ...r, matched_query: q });
      }
    }
  }
  let contextItems = [];
  const includeContext = args.include_context !== false;
  if (includeContext) {
    const maxUrls = Math.max(1, Math.min(12, Number(args.context_max_urls || 5)));
    const maxChars = Math.max(500, Math.min(6000, Number(args.context_max_chars || 1800)));
    const urlPool = uniqueUrls([...explicitUrls, ...merged.map((r) => r.url)]);
    for (const u of urlPool.slice(0, maxUrls)) {
      const t = parseGithubTarget(u);
      if (t) contextItems.push(...await fetchGithubTargetContext(u, Math.max(1, maxUrls - contextItems.length), maxChars));
      else { try { contextItems.push({ url: u, source: 'direct-http', context: await fetchDirectContext(u, maxChars) }); } catch {} }
      if (contextItems.length >= maxUrls) break;
    }
  }
  return { mode: 'deep', queries_used: queries, lanes_used: lanes, count: merged.length, results: merged, urls_detected: explicitUrls, context_items: contextItems, current_date: currentDateContext() };
}

app.get('/health', async (req, res) => {
  let searxng = false;
  try {
    const u = new URL(`${SEARX_BASE}/search`);
    u.searchParams.set('q', 'health');
    u.searchParams.set('format', 'json');
    const r = await fetch(u);
    searxng = r.ok;
  } catch {
    searxng = false;
  }
  res.json({ ok: true, service: 'appagent-node', searxng, current_date: currentDateContext() });
});

app.get('/runtime/config', (req, res) => {
  const ensureV1 = (base) => {
    const b = String(base || '').replace(/\/$/, '');
    return /\/v1$/i.test(b) ? b : `${b}/v1`;
  };
  const searchUrl = `${SEARX_BASE.replace(/\/$/, '')}/search`;
  res.json({
    ok: true,
    service: 'appagent-node',
    ui_base: '/',
    defaults: {
      provider: 'lmstudio',
      searchUrl,
      lmBase: ensureV1(LMSTUDIO_BASE),
      ollamaBase: ensureV1(OLLAMA_BASE)
    },
    upstream: {
      searx: SEARX_BASE,
      lmstudio: LMSTUDIO_BASE,
      ollama: OLLAMA_BASE
    },
    current_date: currentDateContext()
  });
});

app.get('/tools', (req, res) => {
  res.json({ tools: mcpToolsPayload(), current_date: currentDateContext() });
});

app.post('/tools/fetch_url_context', async (req, res) => {
  try { res.json(await toolFetchUrlContext(req.body || {})); }
  catch (err) { res.status(Number(err?.status || 500)).json({ error: String(err?.message || err) }); }
});

app.post('/tools/search_quick', async (req, res) => {
  try { res.json(await toolSearchQuick(req.body || {})); }
  catch (err) { res.status(Number(err?.status || 500)).json({ error: String(err?.message || err) }); }
});

app.post('/tools/search_deep', async (req, res) => {
  try { res.json(await toolSearchDeep(req.body || {})); }
  catch (err) { res.status(Number(err?.status || 500)).json({ error: String(err?.message || err) }); }
});

app.all('/lmstudio/*', async (req, res) => {
  await proxyRequest(req, res, LMSTUDIO_BASE, '/lmstudio');
});

app.all('/ollama/*', async (req, res) => {
  await proxyRequest(req, res, OLLAMA_BASE, '/ollama');
});

app.all('/searxng/*', async (req, res) => {
  await proxyRequest(req, res, SEARX_BASE, '/searxng');
});

app.post('/mcp', async (req, res) => {
  const body = req.body || {};
  const id = body.id ?? null;
  const method = body.method;
  const ok = (result) => res.json({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => res.json({ jsonrpc: '2.0', id, error: { code, message } });

  if (method === 'initialize') return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'appagent-node-mcp', version: '1.0.0' } });
  if (method === 'ping') return ok({ pong: true });
  if (method === 'tools/list') return ok({ tools: mcpToolsPayload() });
  if (method === 'tools/call') {
    const name = body?.params?.name;
    const args = body?.params?.arguments || {};
    try {
      let data;
      if (name === 'search_quick') data = await toolSearchQuick(args);
      else if (name === 'search_deep') data = await toolSearchDeep(args);
      else if (name === 'fetch_url_context') data = await toolFetchUrlContext(args);
      else return fail(-32601, `Unknown tool: ${name}`);
      return ok({ content: [{ type: 'text', text: JSON.stringify(data) }] });
    } catch (e) {
      return fail(-32000, String(e?.message || e));
    }
  }
  return fail(-32601, `Method not found: ${method}`);
});

app.use('/assets', express.static(path.join(APP_ROOT, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(APP_ROOT, 'AppAgent.html')));

app.listen(PORT, () => {
  console.log(`appagent-node running on http://localhost:${PORT}`);
  console.log(`searx base: ${SEARX_BASE}`);
});
