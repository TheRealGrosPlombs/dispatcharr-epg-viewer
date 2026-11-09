// Remote play: discover AerioTV boxes on the LAN (mDNS `_aeriotv._tcp`), pair with them once,
// and tell them to tune a channel. Speaks AerioTV's existing "companion remote" WebSocket
// protocol (ws://<tv>:<port>/remote), so the Android app needs no changes.
//
// Flow on the wire (see AerioTV core/cast/companion/CompanionProtocol.kt):
//   TV -> {"t":"hello","device":"<name>",...}
//   us -> {"t":"auth","token":"<saved>","code":""}      TV -> {"t":"authOk","token":"..."} | {"t":"authFail",...}
//   us -> {"cmd":"setChannel","channelId":"disp:<dispatcharr channel uuid>"}
'use strict';
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { Bonjour } = require('bonjour-service');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'tvs.json');
const WS_PATH = '/remote';
const IDLE_MS = 5 * 60 * 1000;      // close an unused TV connection after 5 min
const PAIR_MS = 3 * 60 * 1000;      // how long a pairing attempt waits for the code
const STEP_MS = 6000;               // timeout for any single request/reply with a TV

// ---------- saved state: pairing tokens + friendly names, keyed by the TV's stable id ----------
let state = { tokens: {}, names: {} };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (e) { console.error('Could not save', STATE_FILE, e.message); }
}

// ---------- discovery ----------
const tvs = new Map(); // id -> { id, serviceName, host, port, seen }
let bonjour = null;
function startDiscovery() {
  // Fallback when mDNS can't reach us (e.g. Docker without host networking): MANUAL_TVS="Bedroom=192.168.0.50:41234,..."
  // The TV's port changes each time AerioTV starts, so prefer mDNS when possible.
  for (const item of (process.env.MANUAL_TVS || '').split(',').map(x => x.trim()).filter(Boolean)) {
    const m = /^(.*)=([^:]+):(\d+)$/.exec(item);
    if (m) tvs.set(m[1], { id: m[1], serviceName: m[1], host: m[2], port: +m[3], seen: Date.now() });
  }
  try {
    bonjour = new Bonjour();
    const browser = bonjour.find({ type: 'aeriotv', protocol: 'tcp' });
    const add = svc => {
      const ipv4 = (svc.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      const host = ipv4 || (svc.addresses || [])[0] || svc.host;
      if (!host || !svc.port) return;
      const id = (svc.txt && svc.txt.id) || svc.name;
      tvs.set(id, { id, serviceName: svc.name, host, port: svc.port, seen: Date.now() });
    };
    browser.on('up', add);
    browser.on('down', svc => {
      for (const [id, t] of tvs) if (t.serviceName === svc.name) tvs.delete(id);
    });
    // Re-ask periodically: NSD announcements are not always repeated on their own.
    setInterval(() => { try { browser.update(); } catch {} }, 30000);
  } catch (e) { console.error('mDNS discovery unavailable:', e.message); }
}

function listTvs() {
  return [...tvs.values()].map(t => ({
    id: t.id,
    name: state.names[t.id] || t.serviceName,
    deviceName: t.serviceName,
    paired: !!state.tokens[t.id],
    address: `${t.host}:${t.port}`,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function setName(id, name) {
  name = String(name || '').trim().slice(0, 40);
  if (name) state.names[id] = name; else delete state.names[id];
  saveState();
}

// ---------- one WebSocket conversation with a TV ----------
// Opens the socket and waits for the hello. NOTE: AerioTV rejects WebSocket upgrades that carry an
// Origin header (anti drive-by hardening), so this must be a plain server-side client, never a browser.
function connect(tv) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://${tv.host}:${tv.port}${WS_PATH}`, { handshakeTimeout: STEP_MS });
    const conn = { sock, waiters: [], authed: false };
    let done = false;
    const fail = err => { if (!done) { done = true; try { sock.terminate(); } catch {} reject(err); } };
    sock.on('error', e => fail(new Error(`Cannot reach TV (${e.code || e.message}).`)));
    sock.on('close', () => { conn.closed = true; if (!done) fail(new Error('TV closed the connection.')); });
    sock.on('message', data => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.t === 'hello') conn.hello = msg;
      for (const w of [...conn.waiters]) if (w.match(msg)) { conn.waiters.splice(conn.waiters.indexOf(w), 1); w.resolve(msg); }
      if (msg.t === 'hello' && !done) { done = true; resolve(conn); }
    });
    setTimeout(() => fail(new Error('TV did not answer (is AerioTV open on it?).')), STEP_MS);
  });
}
// Wait for the next message of one of the given types.
function waitFor(conn, types, ms = STEP_MS) {
  return new Promise((resolve, reject) => {
    const w = { match: m => types.includes(m.t), resolve };
    conn.waiters.push(w);
    setTimeout(() => {
      const i = conn.waiters.indexOf(w);
      if (i >= 0) { conn.waiters.splice(i, 1); reject(new Error('TV did not reply.')); }
    }, ms);
  });
}
const sendJson = (conn, obj) => conn.sock.send(JSON.stringify(obj));
function close(conn) { try { conn.sock.close(); } catch {} }

// ---------- authenticated connection pool (one socket per paired TV, closed when idle) ----------
const pool = new Map(); // tv id -> conn
function touch(id, conn) {
  clearTimeout(conn.idle);
  conn.idle = setTimeout(() => { pool.delete(id); close(conn); }, IDLE_MS);
}
async function authedConn(tv) {
  const cached = pool.get(tv.id);
  if (cached && !cached.closed && cached.sock.readyState === WebSocket.OPEN) { touch(tv.id, cached); return cached; }
  pool.delete(tv.id);
  const token = state.tokens[tv.id];
  if (!token) { const e = new Error('This TV is not paired yet.'); e.needsPairing = true; throw e; }
  const conn = await connect(tv);
  const reply = waitFor(conn, ['authOk', 'authFail']);
  sendJson(conn, { t: 'auth', token, code: '' });
  const r = await reply.catch(e => { close(conn); throw e; });
  if (r.t !== 'authOk') {
    close(conn);
    delete state.tokens[tv.id]; saveState(); // stale token: force a fresh pairing
    const e = new Error('The TV no longer accepts this pairing. Pair it again.'); e.needsPairing = true; throw e;
  }
  conn.authed = true;
  conn.sock.on('close', () => { if (pool.get(tv.id) === conn) pool.delete(tv.id); });
  pool.set(tv.id, conn); touch(tv.id, conn);
  return conn;
}

async function play(tvId, appChannelId) {
  const tv = tvs.get(tvId);
  if (!tv) throw Object.assign(new Error('TV not found on the network.'), { status: 404 });
  const conn = await authedConn(tv);
  sendJson(conn, { cmd: 'setChannel', channelId: appChannelId });
  return { nowPlayingBefore: conn.hello && conn.hello.nowPlaying || '' };
}

// ---------- pairing: the TV shows a 6-digit code once it sees an auth with no valid token/code ----------
const pending = new Map(); // tv id -> { conn, timer }
function dropPending(id) {
  const p = pending.get(id); if (!p) return;
  clearTimeout(p.timer); pending.delete(id); close(p.conn);
}
async function pairStart(tvId) {
  const tv = tvs.get(tvId);
  if (!tv) throw Object.assign(new Error('TV not found on the network.'), { status: 404 });
  dropPending(tvId);
  const conn = await connect(tv);
  const reply = waitFor(conn, ['authOk', 'authFail']);
  sendJson(conn, { t: 'auth', token: '', code: '' }); // blank auth makes the TV display a code
  await reply.catch(e => { close(conn); throw e; });
  // The code lives only while this socket stays open, so keep it until the user types the code.
  pending.set(tvId, { conn, timer: setTimeout(() => dropPending(tvId), PAIR_MS) });
}
async function pairConfirm(tvId, code) {
  const p = pending.get(tvId);
  if (!p || p.conn.closed) throw Object.assign(new Error('Pairing expired. Start again.'), { status: 410 });
  const reply = waitFor(p.conn, ['authOk', 'authFail']);
  sendJson(p.conn, { t: 'auth', token: '', code: String(code || '').trim() });
  const r = await reply;
  if (r.t !== 'authOk') {
    // A wrong code rotates it on the TV (and the TV drops us after 5 misses); the socket stays open.
    throw Object.assign(new Error('Wrong code. A new code is now on the TV screen.'), { status: 403 });
  }
  state.tokens[tvId] = r.token; saveState();
  const conn = p.conn; clearTimeout(p.timer); pending.delete(tvId);
  conn.authed = true;
  conn.sock.on('close', () => { if (pool.get(tvId) === conn) pool.delete(tvId); });
  pool.set(tvId, conn); touch(tvId, conn);
}
function unpair(tvId) {
  delete state.tokens[tvId]; saveState();
  const c = pool.get(tvId); if (c) { pool.delete(tvId); close(c); }
}

module.exports = { startDiscovery, listTvs, setName, play, pairStart, pairConfirm, unpair };
