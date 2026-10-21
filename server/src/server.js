'use strict';
// Runs one arena: serves the game page and handles players over WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const C = require('./config');
const { Game, gi, GN } = require('./game');
const { enc, decode } = require('./protocol');

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIR = path.resolve(process.env.CLIENT_DIR || path.join(__dirname, '..', '..', 'client'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

const game = new Game();
let stats = { tickMs: 0, bytesOut: 0 };

/* ---------- web page ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    let humans = 0; for (const c of game.clients) if (!c.dead) humans++;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({ ok: true, players: humans, connections: game.clients.size, orbs: game.cells.length, tickMs: +stats.tickMs.toFixed(2) }));
  }
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(CLIENT_DIR, '.' + rel);
  if (!file.startsWith(CLIENT_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- players ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  let humans = 0; for (const c of game.clients) if (!c.dead) humans++;
  const cl = { ws, dead: true, boxes: [], W: 1280, H: 720, knownPellets: new Set(), knownOwners: new Set(), sentBoxes: '', alive: true, splitBudget: 8, lastJoin: 0 };
  game.clients.add(cl);
  ws.binaryType = 'nodebuffer';
  send(cl, enc.hello(C.WORLD, C.SPEED));
  if (humans >= C.MAX_PLAYERS) send(cl, enc.full());
  cl.onDeath = d => send(cl, enc.dead(d.peak, d.kills, d.alive));
  ws.on('pong', () => { cl.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const m = decode(data); if (!m) return;
    switch (m.op) {
      case 1: { // join
        const now = Date.now(); if (now - cl.lastJoin < 800) return; cl.lastJoin = now;
        let h = 0; for (const c of game.clients) if (!c.dead && c !== cl) h++;
        if (h >= C.MAX_PLAYERS) return send(cl, enc.full());
        cl.W = m.W; cl.H = m.H; game.join(cl, m.name, m.multi, m.party); cl.sentParty = ''; break;
      }
      case 2: if (!cl.dead) game.setTarget(cl, m.x, m.y); break;
      case 3: if (!cl.dead && cl.splitBudget >= 1) { cl.splitBudget--; game.split(cl); } break;
      case 4: cl.ejectOn = m.on; cl.ejectMs = Math.max(C.EJECT_MIN_MS, Math.min(1000, m.ms || 60)); break;
      case 5: cl.feedOn = m.on; cl.ejectMs = Math.max(C.EJECT_MIN_MS, Math.min(1000, m.ms || 60)); break;
      case 6: if (!cl.dead) game.swap(cl, m.x, m.y); break;
      case 7: if (!cl.dead) game.respawn(cl); break;
      case 8: cl.W = m.W; cl.H = m.H; break;
      case 9: if (cl.ws.readyState === 1) cl.ws.send(enc.pong(m.token)); break;
      case 11: cl.growth = Math.max(1, Math.min(C.GROWTH, m.growth | 0)) || C.GROWTH; break;
      case 10: { // chat: everyone in this arena, or just your party
        const now = Date.now(); if (!cl.name || now - (cl.chatT || 0) < 700) return; cl.chatT = now;
        const text = m.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); if (!text) return;
        if (m.channel === 1 && !cl.party) return;
        const hue = cl.boxes && cl.boxes.length ? (game.owners.get(cl.boxes[0])?.hue ?? 170) : 170;
        const buf = enc.chat(m.channel, hue, cl.name, text);
        for (const o of game.clients) if (m.channel === 0 || (o.party && o.party === cl.party)) send(o, buf);
        break;
      }
    }
  });
  ws.on('close', () => game.leave(cl, false));
  ws.on('error', () => {});
});

function send(cl, buf) {
  if (cl.ws.readyState !== 1) return;
  if (cl.ws.bufferedAmount > 512 * 1024) return; // a stalled connection drops updates instead of piling them up
  cl.ws.send(buf); stats.bytesOut += buf.length;
}

/* ---------- per-player updates ---------- */
function sendWorld(cl) {
  const v = game.viewOf(cl), W = C.WORLD;
  const pad = 40;
  const cells = [];
  for (const c of game.cells) if (c.x + c.r > v.x0 - pad && c.x - c.r < v.x1 + pad && c.y + c.r > v.y0 - pad && c.y - c.r < v.y1 + pad) cells.push(c);
  const spikes = game.spikes.filter(s => s.x + s.r > v.x0 && s.x - s.r < v.x1 && s.y + s.r > v.y0 && s.y - s.r < v.y1);
  const ejected = game.ejected.filter(f => f.x > v.x0 && f.x < v.x1 && f.y > v.y0 && f.y < v.y1);
  // pellets: only send what changed in view since last time
  const now = new Set(), added = [];
  const bx0 = gi(v.x0), bx1 = gi(v.x1), by0 = gi(v.y0), by1 = gi(v.y1);
  for (let gy = by0; gy <= by1; gy++) for (let gx = bx0; gx <= bx1; gx++) for (const f of game.grid[gy * GN + gx]) {
    now.add(f.id); if (!cl.knownPellets.has(f.id)) added.push(f);
  }
  const removed = []; for (const id of cl.knownPellets) if (!now.has(id)) removed.push(id);
  cl.knownPellets = now;
  // names for anything new on screen
  const newOwners = [];
  for (const c of cells) if (!cl.knownOwners.has(c.o)) { const o = game.owners.get(c.o); if (o) { cl.knownOwners.add(c.o); newOwners.push(o); } }
  if (newOwners.length) send(cl, enc.owners(newOwners));
  const bk = (cl.boxes || []).join(',') + ':' + cl.active;
  if (bk !== cl.sentBoxes) { cl.sentBoxes = bk; send(cl, enc.boxes(cl.boxes || [], cl.active || 0)); }
  // very crowded views are capped so a message never gets huge
  send(cl, enc.tick(W, v.cx, v.cy, cells.slice(0, 1500), spikes, ejected.slice(0, 1500), added.slice(0, 4000), removed.slice(0, 8000)));
  if (added.length > 4000) for (const f of added.slice(4000)) cl.knownPellets.delete(f.id);
}

// every party member's boxes, so teammates can be coloured and shown on the minimap
function sendParties() {
  const byParty = new Map();
  for (const cl of game.clients) if (cl.party && !cl.dead && cl.boxes) { let a = byParty.get(cl.party); if (!a) byParty.set(cl.party, a = []); a.push(...cl.boxes); }
  for (const cl of game.clients) {
    const ids = cl.party ? (byParty.get(cl.party) || []) : [], key = cl.party + ':' + ids.join(',');
    if (key === cl.sentParty) continue; cl.sentParty = key;
    const unknown = ids.map(id => game.owners.get(id)).filter(o => o && !cl.knownOwners.has(o.id)); for (const o of unknown) cl.knownOwners.add(o.id);
    if (unknown.length) send(cl, enc.owners(unknown));
    send(cl, enc.party(cl.party, ids));
  }
}
function sendLeaderboard() {
  const by = new Map();
  for (const c of game.cells) by.set(c.o, (by.get(c.o) || 0) + c.m);
  const all = [...by.entries()].map(([id, m]) => ({ id, m })).sort((a, b) => b.m - a.m);
  const top = all.slice(0, 10), topOwners = top.map(t => game.owners.get(t.id)).filter(Boolean);
  for (const cl of game.clients) {
    const unknown = topOwners.filter(o => !cl.knownOwners.has(o.id)); for (const o of unknown) cl.knownOwners.add(o.id);
    if (unknown.length) send(cl, enc.owners(unknown));
    let rank = 0; if (!cl.dead && cl.boxes) for (let i = 0; i < all.length; i++) if (cl.boxes.includes(all[i].id)) { rank = i + 1; break; }
    send(cl, enc.leader(rank, all.length, top));
  }
}
function sendMinimap() {
  const big = game.cells.filter(c => c.m > 6000).sort((a, b) => b.m - a.m).slice(0, 40);
  // every real player's box, as one dot at its centre
  const people = [];
  for (const [o, ps] of game.own) {
    const ow = game.owners.get(o); if (!ow || ow.kind !== 'human') continue;
    let sx = 0, sy = 0, sm = 0; for (const c of ps) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; }
    people.push({ x: sx / sm, y: sy / sm, o });
  }
  const others = people.slice(0, 200);
  for (const o of others) { const ow = game.owners.get(o.o); for (const cl of game.clients) if (ow && !cl.knownOwners.has(o.o)) { cl.knownOwners.add(o.o); send(cl, enc.owners([ow])); } }
  const buf = enc.minimap(C.WORLD, game.spikes.slice(0, 120), big, others);
  for (const cl of game.clients) send(cl, buf);
}

/* ---------- main loop ---------- */
const DT = 1 / C.TICK_HZ;
let n = 0, next = performance.now();
function loop() {
  const t0 = performance.now();
  game.step(DT); n++;
  for (const cl of game.clients) cl.splitBudget = Math.min(8, cl.splitBudget + 0.5); // at most ~20 splits a second
  if (n % C.SEND_EVERY === 0) for (const cl of game.clients) sendWorld(cl);
  if (n % 15 === 0) { sendLeaderboard(); sendParties(); }
  if (n % 15 === 0) sendMinimap();
  stats.tickMs = stats.tickMs * 0.95 + (performance.now() - t0) * 0.05;
  next += DT * 1000; const wait = next - performance.now();
  if (wait < -250) next = performance.now(); // fell far behind: don't try to catch up all at once
  setTimeout(loop, Math.max(0, wait));
}
setInterval(() => { for (const cl of game.clients) { if (!cl.alive) { cl.ws.terminate(); continue; } cl.alive = false; try { cl.ws.ping(); } catch (e) {} } }, 20000);
if (process.env.LOG_STATS) setInterval(() => { let h = 0; for (const c of game.clients) if (!c.dead) h++; console.log(`players ${h}  connections ${game.clients.size}  orbs ${game.cells.length}  step ${stats.tickMs.toFixed(2)} ms  out ${(stats.bytesOut / 5 / 1024).toFixed(0)} KB/s`); stats.bytesOut = 0; }, 5000);

server.listen(PORT, HOST, () => { console.log(`Arena running on http://${HOST}:${PORT}  (page from ${CLIENT_DIR})`); loop(); });
module.exports = { game, server };
