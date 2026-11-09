// Dispatcharr EPG Viewer - tiny dependency-free server (Node 18+).
// Serves the viewer page and relays EPG requests so the browser avoids CORS/mixed-content issues.
const http = require('http');
const fs = require('fs');
const path = require('path');
const remote = require('./remote');
const dispatcharr = require('./dispatcharr');

const PORT = parseInt(process.env.PORT || '7421', 10);
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 10000) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');

// /api/tvs...  -- list AerioTV boxes, pair, rename, and play a channel on one.
async function handleTvs(req, res, u) {
  const parts = u.pathname.split('/').filter(Boolean); // ['api','tvs',':id',action]
  try {
    if (parts.length === 2 && req.method === 'GET') {
      return json(res, 200, { tvs: remote.listTvs(), playEnabled: dispatcharr.configured() });
    }
    const id = decodeURIComponent(parts[2] || '');
    const action = parts[3];
    if (req.method !== 'POST' || !id || !action) return send(res, 404, 'Not found');
    const body = await readJson(req);
    if (action === 'pair-start') { await remote.pairStart(id); return json(res, 200, { ok: true }); }
    if (action === 'pair-confirm') { await remote.pairConfirm(id, body.code); return json(res, 200, { ok: true }); }
    if (action === 'unpair') { remote.unpair(id); return json(res, 200, { ok: true }); }
    if (action === 'rename') { remote.setName(id, body.name); return json(res, 200, { ok: true }); }
    if (action === 'play') {
      const hit = await dispatcharr.resolve(body.channelId, body.name);
      if (!hit) return json(res, 404, { error: `Could not match "${body.name || body.channelId}" to a Dispatcharr channel.` });
      await remote.play(id, hit.channelId);
      return json(res, 200, { ok: true, channel: hit.name });
    }
    return send(res, 404, 'Not found');
  } catch (e) {
    return json(res, e.status || (e.needsPairing ? 409 : 502), { error: e.message, needsPairing: !!e.needsPairing });
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/api/tvs' || u.pathname.startsWith('/api/tvs/')) return handleTvs(req, res, u);

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

remote.startDiscovery();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`EPG viewer running on http://0.0.0.0:${PORT}`);
  if (DEFAULT_EPG_URL) console.log(`Default EPG URL: ${DEFAULT_EPG_URL}`);
  console.log(dispatcharr.configured() ? 'Remote play: enabled' : 'Remote play: set DISPATCHARR_API_KEY (and DISPATCHARR_URL) to enable');
});
