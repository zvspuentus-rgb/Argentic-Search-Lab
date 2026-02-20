const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const SEARX_BASE = process.env.SEARX_BASE || 'http://searxng:8080';
const MCP_BASE = process.env.MCP_BASE || 'http://mcp:8090';
const LMSTUDIO_BASE = process.env.LMSTUDIO_BASE || 'http://host.docker.internal:1234';
const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://host.docker.internal:11434';
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function proxy(req, res, base, stripPrefix) {
  try {
    const targetPath = req.url.replace(stripPrefix, '') || '/';
    const url = `${base}${targetPath}`;
    const body = await new Promise((resolve) => {
      if (req.method === 'GET' || req.method === 'HEAD') return resolve(undefined);
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(undefined));
    });

    const headers = { ...req.headers };
    delete headers.host;
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body,
      redirect: 'follow'
    });

    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'content-encoding') return;
      outHeaders[k] = v;
    });
    res.writeHead(upstream.status, outHeaders);

    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    send(res, 502, JSON.stringify({ error: 'proxy_failed', message: err.message }), {
      'Content-Type': 'application/json; charset=utf-8'
    });
  }
}

function serveFile(req, res) {
  const rawPath = req.url === '/' ? '/AppAgent.html' : req.url;
  const safePath = path.normalize(rawPath).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (rawPath !== '/AppAgent.html') {
        fs.readFile(path.join(ROOT, 'AppAgent.html'), (fallbackErr, fallback) => {
          if (fallbackErr) return send(res, 404, 'Not found');
          send(res, 200, fallback, { 'Content-Type': MIME['.html'] });
        });
        return;
      }
      return send(res, 404, 'Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    return send(res, 200, JSON.stringify({ ok: true, service: 'app-ui' }), {
      'Content-Type': 'application/json; charset=utf-8'
    });
  }

  if (req.url.startsWith('/searxng/')) return proxy(req, res, SEARX_BASE, '/searxng');
  if (req.url.startsWith('/mcp/')) return proxy(req, res, MCP_BASE, '/mcp');
  if (req.url.startsWith('/lmstudio/')) return proxy(req, res, LMSTUDIO_BASE, '/lmstudio');
  if (req.url.startsWith('/ollama/')) return proxy(req, res, OLLAMA_BASE, '/ollama');

  return serveFile(req, res);
});

server.listen(PORT, () => {
  console.log(`app-ui listening on :${PORT}`);
});
