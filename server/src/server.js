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
// changes with every deploy; browsers that see a new one reload themselves to get the latest game page
const BUILD = (process.env.RENDER_GIT_COMMIT || '').slice(0, 12) || String(Date.now());
let stats = { tickMs: 0, bytesOut: 0, worstMs: 0, slow: 0, ticks: 0 };

/* ---------- web page ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    let humans = 0; for (const c of game.clients) if (!c.dead) humans++;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({ ok: true, players: humans, connections: game.clients.size, orbs: game.cells.length, tickMs: +stats.tickMs.toFixed(2), worstTickMs: +stats.worstMs.toFixed(1), slowTicks: stats.slow, ticks: stats.ticks, upMinutes: Math.round(process.uptime() / 60) }));
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
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16384 /* voice chat call setup messages are a few KB */, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  let humans = 0; for (const c of game.clients) if (!c.dead) humans++;
  const cl = { vid: ++voiceIds, voice: false, ws, dead: true, boxes: [], W: 1280, H: 720, knownPellets: new Set(), knownOwners: new Set(), sentBoxes: '', alive: true, splitBudget: 8, lastJoin: 0 };
  game.clients.add(cl);
  ws.binaryType = 'nodebuffer';
  send(cl, enc.hello(C.WORLD, C.SPEED, BUILD));
  for (const b of chatLog) send(cl, b); // the last chat messages, so newcomers see the conversation
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
        cl.W = m.W; cl.H = m.H; cl.test = m.test; const oldParty = cl.party; cl.spec = false; game.join(cl, m.name, m.multi, m.party); cl.sentParty = '';
        if (cl.voice && oldParty !== cl.party) { if (oldParty) voiceRoster(oldParty); if (cl.party) voiceRoster(cl.party); else { cl.voice = false; send(cl, enc.voiceRoster(cl.vid, [])); } }
        break;
      }
      case 2: if (!cl.dead) game.setTarget(cl, m.x, m.y); break;
      case 3: if (!cl.dead && cl.splitBudget >= 1) { cl.splitBudget--; game.split(cl); } break;
      case 4: cl.ejectOn = m.on; cl.ejectMs = Math.max(C.EJECT_MIN_MS, Math.min(1000, m.ms || 60)); break;
      case 5: cl.feedOn = m.on; cl.ejectMs = Math.max(C.EJECT_MIN_MS, Math.min(1000, m.ms || 60)); break;
      case 6: if (!cl.dead) game.swap(cl, m.x, m.y); break;
      case 7: if (!cl.dead) game.respawn(cl); break;
      case 8: cl.W = m.W; cl.H = m.H; cl.zoom = Math.max(0.01, Math.min(3, m.zoom || 1)); break;
      case 15: cl.colA = m.a; cl.colI = m.i; cl.skin = m.skin < 12 ? m.skin : 255; cl.badge = m.badge < BADGES.length ? m.badge : 255; break;
      case 9: if (cl.ws.readyState === 1) cl.ws.send(enc.pong(m.token)); break;
      case 18: { // party voice chat: the server only introduces party members to each other; the sound goes browser to browser
        if (m.kind === 0) { if (!cl.party) { send(cl, enc.voiceRoster(cl.vid, [])); return; } cl.voice = true; voiceRoster(cl.party); }
        else if (m.kind === 1) { const p = cl.voice && cl.party; cl.voice = false; send(cl, enc.voiceRoster(cl.vid, [])); if (p) voiceRoster(p); }
        else if (m.kind === 2 && cl.voice && cl.party) {
          const now = Date.now(); if (now - (cl.sigT || 0) > 1000) { cl.sigT = now; cl.sigN = 0; } if (++cl.sigN > 80) return; /* flood guard */
          for (const o of game.clients) if (o.vid === m.to && o.voice && o.party === cl.party) { send(o, enc.voiceSignal(cl.vid, m.data)); break; } }
        break;
      }
      case 16: { // fun effects everyone sees (earthquake, fake warning, disco); one every 20 s per player
        const now = Date.now(); if (now - (cl.quakeT || 0) < 20000) return; cl.quakeT = now;
        const buf = enc.effect(m.fx, (!cl.dead && cl.name) || cl.chatName || 'Guest'); for (const o of game.clients) send(o, buf); break;
      }
      case 14: // viewer mode: watch the arena without playing
        if (m.spec === 0) cl.spec = false;
        else { if (!cl.dead) game.leave(cl, true); cl.spec = true; cl.specO = m.spec === 2 ? game.watchNext(cl.specO) : game.watchNext(null); }
        break;
      case 12: cl.chatName = String(m.name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 14); break;
      case 11: cl.growth = Math.max(1, Math.min(C.GROWTH, m.growth | 0)) || C.GROWTH_DEFAULT; break;
      case 10: { // chat: everyone in this arena, or just your party
        const now = Date.now(); if (now - (cl.chatT || 0) < 700) return; cl.chatT = now;
        const who = (cl.badge !== undefined && cl.badge !== 255 ? BADGES[cl.badge] + ' ' : '') + ((!cl.dead && cl.name) || cl.chatName || cl.name || 'Guest');
        const text = m.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); if (!text) return;
        if (m.channel === 1 && !cl.party) return;
        let hue = 0; for (const ch of who) hue = (hue * 31 + ch.charCodeAt(0)) % 360; // each name gets its own chat colour
        const buf = enc.chat(m.channel, hue, who, text);
        for (const o of game.clients) if (m.channel === 0 || (o.party && o.party === cl.party)) send(o, buf);
        if (m.channel === 0) { chatLog.push(buf); if (chatLog.length > 20) chatLog.shift(); }
        break;
      }
    }
  });
  ws.on('close', () => { const p = cl.voice && cl.party; cl.voice = false; game.leave(cl, false); if (p) voiceRoster(p); });
  ws.on('error', () => {});
});

let batching = false;
function send(cl, buf) {
  if (cl.ws.readyState !== 1) return;
  if (batching) { (cl.out || (cl.out = [])).push(buf); return; }
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
  // pellets: only what changed in view, and only every other update (they don't move, so this is plenty)
  const added = [], removed = [];
  if ((cl.pelletTurn = (cl.pelletTurn || 0) + 1) % 2 === 0) {
    const now = new Set();
    const bx0 = gi(v.x0), bx1 = gi(v.x1), by0 = gi(v.y0), by1 = gi(v.y1);
    for (let gy = by0; gy <= by1; gy++) for (let gx = bx0; gx <= bx1; gx++) for (const f of game.grid[gy * GN + gx]) {
      now.add(f.id); if (!cl.knownPellets.has(f.id)) added.push(f);
    }
    for (const id of cl.knownPellets) if (!now.has(id)) removed.push(id);
    cl.knownPellets = now;
  }
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
// arena record: the most mass one player has had at once since the server started. Beating it by a clear
// margin is announced to everyone with a big banner (at most every 30 s); test-mode players don't count.
const record = { m: 0, name: '', shown: 0, at: 0 };
function checkRecord() {
  for (const cl of game.clients) {
    if (cl.dead || cl.test || !cl.boxes) continue;
    let tot = 0; for (const c of game.cells) if (cl.boxes.includes(c.o)) tot += c.m;
    if (tot > record.m) { record.m = tot; record.name = cl.name || 'Player'; }
  }
  const now = Date.now(), big = record.m >= C.RECORD_MIN && record.m > record.shown * 1.05 && now - record.at > 30000;
  if (big) { record.shown = record.m; record.at = now; }
  if (record.m) { const buf = enc.record(Math.round(record.m), record.name, big); for (const cl of game.clients) send(cl, buf); }
}
function sendLeaderboard() {
  const by = new Map();
  for (const c of game.cells) by.set(c.o, (by.get(c.o) || 0) + c.m);
  const all = [...by.entries()].map(([id, m]) => ({ id, m })).sort((a, b) => b.m - a.m);
  const top = all.slice(0, 10), topOwners = top.map(t => game.owners.get(t.id)).filter(Boolean);
  let players = 0, bots = 0; for (const cl of game.clients) if (!cl.dead && cl.boxes && cl.boxes.length) players++; for (const o of game.owners.values()) if (o.kind === 'bot' && by.has(o.id)) bots++;
  for (const cl of game.clients) {
    const unknown = topOwners.filter(o => !cl.knownOwners.has(o.id)); for (const o of unknown) cl.knownOwners.add(o.id);
    if (unknown.length) send(cl, enc.owners(unknown));
    let rank = 0; if (!cl.dead && cl.boxes) for (let i = 0; i < all.length; i++) if (cl.boxes.includes(all[i].id)) { rank = i + 1; break; }
    send(cl, enc.leader(rank, all.length, top, players, bots));
  }
}
// the colours each multibox player picked, so everyone sees their orbs (and fed blobs) in those colours
const BADGES = ['⭐', '🔥', '💎', '🚀', '🌈', '⚡', '🦈', '👑', '🎯', '🍀']; // battle pass chat badges (same list as the page)
let voiceIds = 0;
function voiceRoster(party) { // tell everyone in this party's voice chat who else is in it
  const list = []; for (const o of game.clients) if (o.voice && o.party === party) list.push({ vid: o.vid, name: (!o.dead && o.name) || o.chatName || 'Guest' });
  for (const o of list) { const cl = [...game.clients].find(c => c.vid === o.vid); if (cl) send(cl, enc.voiceRoster(cl.vid, list)); }
}
const chatLog = []; // last 20 messages to everyone (party messages stay private and aren't kept)
function sendColours() {
  const list = [];
  for (const cl of game.clients) {
    if (cl.dead || !cl.boxes) continue; const col = cl.multi && cl.colA !== undefined, skin = cl.skin ?? 255;
    if (!col && skin === 255) continue;
    cl.boxes.forEach((id, i) => list.push([id, col ? (i === cl.active ? cl.colA : cl.colI) : -1, skin]));
  }
  const buf = enc.colours(list); for (const cl of game.clients) send(cl, buf);
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
  const t0 = performance.now(); n++;
  let playing = false; for (const cl of game.clients) if (!cl.dead) { playing = true; break; }
  if (playing) game.step(DT); else if (n % 2 === 0) game.step(DT * 2);
  for (const cl of game.clients) cl.splitBudget = Math.min(8, cl.splitBudget + 0.5); // at most ~20 splits a second
  batching = true;
  // people on the menu only watch the arena in the background: 5 updates a second is plenty for them
  if (n % C.SEND_EVERY === 0) for (const cl of game.clients) if (!cl.dead || cl.spec || n % 5 === 0) sendWorld(cl);
  if (n % 15 === 0) { sendLeaderboard(); sendParties(); checkRecord(); }
  if (n % 15 === 0) sendMinimap();
  if (n % 10 === 5) sendColours();
  batching = false;
  for (const cl of game.clients) { const o = cl.out; if (!o || !o.length) continue; cl.out = null; send(cl, o.length === 1 ? o[0] : enc.batch(o)); }
  const took = performance.now() - t0, late = performance.now() - next; stats.tickMs = stats.tickMs * 0.95 + took * 0.05; stats.ticks++;
  if (took > stats.worstMs) stats.worstMs = took; if (took > 25 || late > 60) stats.slow++; // a step that ran long, or the whole server woke up late
  next += DT * 1000; const wait = next - performance.now();
  if (wait < -250) next = performance.now(); // fell far behind: don't try to catch up all at once
  setTimeout(loop, Math.max(0, wait));
}
setInterval(() => { for (const cl of game.clients) { if (!cl.alive) { cl.ws.terminate(); continue; } cl.alive = false; try { cl.ws.ping(); } catch (e) {} } }, 20000);
if (process.env.LOG_STATS) setInterval(() => { let h = 0; for (const c of game.clients) if (!c.dead) h++; console.log(`players ${h}  connections ${game.clients.size}  orbs ${game.cells.length}  step ${stats.tickMs.toFixed(2)} ms  out ${(stats.bytesOut / 5 / 1024).toFixed(0)} KB/s`); stats.bytesOut = 0; }, 5000);

server.listen(PORT, HOST, () => { console.log(`Arena running on http://${HOST}:${PORT}  (page from ${CLIENT_DIR})`); loop(); });

// Render's free plan puts a server to sleep after 15 minutes without visitors. The server visits its own
// public address every 10 minutes so it stays awake. Free hours (750 a month) only cover one always-on
// server, so this is on for the Europe server and off for the USA one; set KEEP_AWAKE=1 or 0 to override.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
const KEEP_AWAKE = process.env.KEEP_AWAKE ? process.env.KEEP_AWAKE === '1' : process.env.RENDER_SERVICE_NAME !== 'gobble-us';
if (SELF_URL && KEEP_AWAKE && typeof fetch === 'function') {
  setInterval(() => { fetch(SELF_URL + '/health').catch(() => {}); }, 10 * 60 * 1000);
  console.log('Keep-awake on: visiting ' + SELF_URL + '/health every 10 minutes');
}
module.exports = { game, server };
