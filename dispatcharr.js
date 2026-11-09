// Looks up Dispatcharr's channel list so a channel clicked in the guide (identified by its XMLTV id)
// can be turned into the id AerioTV uses for it: "disp:<channel uuid>".
// Needs only the API key (the same one AerioTV uses; AerioTV's username/password login just fetches it).
'use strict';

const EPG_URL = process.env.EPG_URL || '';
function originOf(u) { try { return new URL(u).origin; } catch { return ''; } }
const BASE = (process.env.DISPATCHARR_URL || originOf(EPG_URL)).replace(/\/+$/, '');
const API_KEY = process.env.DISPATCHARR_API_KEY || '';
const CACHE_MS = 60 * 1000;

const configured = () => !!(BASE && API_KEY);

async function getAll(apiPath) {
  const out = [];
  let url = `${BASE}${apiPath}${apiPath.includes('?') ? '&' : '?'}page_size=10000`;
  for (let i = 0; i < 50 && url; i++) {
    const r = await fetch(url, {
      headers: { 'X-API-Key': API_KEY, Authorization: `ApiKey ${API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (r.status === 401 || r.status === 403) throw new Error('Dispatcharr rejected the API key.');
    if (!r.ok) throw new Error(`Dispatcharr responded with HTTP ${r.status} for ${apiPath}.`);
    const body = await r.json();
    if (Array.isArray(body)) return out.concat(body);
    out.push(...(body.results || []));
    // `next` can carry an internal hostname; keep the path and query, reuse our own base.
    url = body.next ? (() => { const n = new URL(body.next); return BASE + n.pathname + n.search; })() : '';
  }
  return out;
}

let cache = null; // { at, index }
async function loadIndex() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.index;
  const channels = await getAll('/api/channels/channels/');
  let epgTvg = new Map();
  try { for (const e of await getAll('/api/epg/epgdata/')) epgTvg.set(e.id, e.tvg_id); } catch {} // optional extra key
  const maps = { tvg: new Map(), num: new Map(), uuid: new Map(), name: new Map() };
  const add = (m, k, ch) => {
    if (k === undefined || k === null) return;
    k = String(k).trim(); if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(ch);
  };
  for (const c of channels) {
    if (!c.uuid) continue;
    const ch = { uuid: c.uuid, name: c.effective_name || c.name || '' };
    add(maps.tvg, c.effective_tvg_id || c.tvg_id, ch);
    add(maps.tvg, epgTvg.get(c.effective_epg_data_id || c.epg_data_id), ch);
    const num = c.effective_channel_number ?? c.channel_number;
    if (num !== null && num !== undefined && num !== '') add(maps.num, Number(num), ch); // 5.0 -> "5"
    add(maps.uuid, c.uuid, ch);
    add(maps.name, ch.name.toLowerCase(), ch);
  }
  const index = { maps, count: channels.length };
  cache = { at: Date.now(), index };
  return index;
}

// XMLTV id (+ display name) -> AerioTV channel id, or null when it can't be matched.
async function resolve(xmltvId, name) {
  if (!configured()) throw new Error('Set DISPATCHARR_API_KEY (and DISPATCHARR_URL) on the viewer server to enable remote play.');
  const { maps } = await loadIndex();
  const nm = String(name || '').trim().toLowerCase();
  const pick = list => {
    if (!list || !list.length) return null;
    return (list.find(c => c.name.toLowerCase() === nm) || list[0]);
  };
  const id = String(xmltvId || '').trim();
  const hit = pick(maps.tvg.get(id)) || pick(maps.uuid.get(id)) ||
              (/^\d+(\.\d+)?$/.test(id) ? pick(maps.num.get(String(Number(id)))) : null) ||
              pick(maps.name.get(nm));
  return hit ? { channelId: `disp:${hit.uuid}`, name: hit.name } : null;
}

module.exports = { resolve, configured };
