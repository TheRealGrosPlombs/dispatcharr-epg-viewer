// Dispatcharr EPG Viewer - tiny dependency-free server (Node 18+).
// Serves the viewer page and relays EPG requests so the browser avoids CORS/mixed-content issues.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DEFAULT_EPG_URL = process.env.EPG_URL || '';
const ALLOW_ANY_HOST = process.env.ALLOW_ANY_HOST === '1';
const INDEX = path.join(__dirname, 'index.html');

// By default only LAN / localhost targets are allowed, so this can't be used as an open proxy.
function isPrivateHost(h) {
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home')) return true;
  if (!h.includes('.') && !h.includes(':')) return true; // bare hostname such as "dispatcharr"
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return h === '[::1]';
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/' || u.pathname === '/index.html') {
    return send(res, 200, fs.readFileSync(INDEX), 'text/html; charset=utf-8');
  }

  if (u.pathname === '/api/config') {
    return send(res, 200, JSON.stringify({ defaultUrl: DEFAULT_EPG_URL }), 'application/json');
  }

  if (u.pathname === '/api/epg') {
    const target = u.searchParams.get('url') || DEFAULT_EPG_URL;
    let t;
    try { t = new URL(target); } catch { return send(res, 400, 'Invalid or missing EPG URL.'); }
    if (!/^https?:$/.test(t.protocol)) return send(res, 400, 'Only http(s) URLs are allowed.');
    if (!ALLOW_ANY_HOST && !isPrivateHost(t.hostname)) {
      return send(res, 403, 'Only local-network hosts are allowed (set ALLOW_ANY_HOST=1 to override).');
    }
    try {
      const upstream = await fetch(t, { signal: AbortSignal.timeout(120000) });
      if (!upstream.ok) return send(res, 502, `Dispatcharr responded with HTTP ${upstream.status}.`);
      const buf = Buffer.from(await upstream.arrayBuffer());
      return send(res, 200, buf, 'application/xml; charset=utf-8');
    } catch (e) {
      return send(res, 502, `Could not reach ${t.origin}: ${e.cause?.code || e.message}`);
    }
  }

  send(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`EPG viewer running on http://0.0.0.0:${PORT}`);
  if (DEFAULT_EPG_URL) console.log(`Default EPG URL: ${DEFAULT_EPG_URL}`);
});
