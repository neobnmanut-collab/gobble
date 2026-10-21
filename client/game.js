// Multiplayer client: draws what the server sends, sends the player's mouse and keys.
(function () {
'use strict';
const GAME_NAME = 'Gobble'; // change here (and in index.html <title>) when the game gets its final name
const $ = id => document.getElementById(id), cv = $('c'), g = cv.getContext('2d', { alpha: false }), mm = $('mm'), mg = mm.getContext('2d');
const TAU = Math.PI * 2, clamp = (v, a, b) => (v < a ? a : v > b ? b : v), rad = m => 4 * Math.sqrt(m), dm = m => Math.floor(m / 2);
let WS = 12000, W = 0, H = 0, dpr = 1, T = 0;
const cam = { x: 6000, y: 6000, s: 0.5 }; let zm = 1;

/* ---------- settings (same controls as the offline game) ---------- */
const DEF = { split: 'Space', dsplit: 'KeyD', tsplit: 'KeyF', qsplit: 'KeyG', eject: 'KeyW', hline: 'KeyS', vline: 'KeyT', fline: '', respawn: 'KeyB', ping: 'KeyR', swap: 'Mouse2', feed: 'KeyE' };
const ACT = [['split', 'Split'], ['dsplit', 'Double split'], ['tsplit', 'Triple split'], ['qsplit', 'Quad split'], ['eject', 'Rapid feed'], ['hline', 'Horizontal line'], ['vline', 'Vertical line'], ['fline', 'Fixed line'], ['respawn', 'Respawn'], ['ping', 'Ping'], ['swap', 'Switch box (multibox)'], ['feed', 'Feed other box']];
const MACROS = [['none', 'None'], ['split', 'Split'], ['dsplit', 'Double split'], ['tsplit', 'Triple split'], ['qsplit', 'Quad split'], ['eject', 'Rapid feed'], ['swap', 'Switch box']];
let binds = Object.assign({}, DEF), rf = 40, pd = 50, lsi = false, lsn = 2, mal = true, ltg = false, ftg = false, mbtn = { 0: 'none', 2: 'none' };
let best = 0;
try { best = +localStorage.getItem('gobblebest_mp') || 0; } catch (e) {}
try {
  const c = JSON.parse(localStorage.getItem('gobblecfg') || 'null');
  if (c) {
    if (c.binds) for (const k in DEF) if (typeof c.binds[k] === 'string') binds[k] = c.binds[k];
    const num = (k, a, b) => (typeof c[k] === 'number' ? clamp(c[k], a, b) : undefined), bool = k => (typeof c[k] === 'boolean' ? c[k] : undefined);
    rf = num('rf', 40, 200) ?? rf; pd = num('pd', 0, 200) ?? pd; lsn = num('lsn', 1, 4) ?? lsn;
    lsi = bool('lsi') ?? lsi; mal = bool('mal') ?? mal; ltg = bool('ltg') ?? ltg; ftg = bool('ftg') ?? ftg;
    if (c.mbtn) for (const b of [0, 2]) if (MACROS.some(m => m[0] === c.mbtn[b])) mbtn[b] = c.mbtn[b];
  }
} catch (e) {}
{ const seen = new Set(); for (const [k] of ACT) { const v = binds[k]; if (!v) continue; if (seen.has(v)) binds[k] = Object.values(binds).includes(DEF[k]) ? '' : DEF[k]; seen.add(binds[k]); } }
function saveCfg() { try { const old = JSON.parse(localStorage.getItem('gobblecfg') || '{}') || {}; localStorage.setItem('gobblecfg', JSON.stringify(Object.assign(old, { binds, rf, pd, lsi, lsn, mal, ltg, ftg, mbtn }))); } catch (e) {} }
function label(b) { if (!b) return 'Unbound'; if (b.startsWith('Mouse')) { const n = +b.slice(5); return ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'][n] || 'Mouse ' + (n + 1); } return b.startsWith('Key') ? b.slice(3) : b.startsWith('Digit') ? b.slice(5) : b; }

/* ---------- world as last seen from the server ---------- */
const ents = new Map(), spikes = new Map(), blobs = new Map(), pellets = new Map(), owners = new Map();
let myBoxes = [], active = 0, playing = false, multiChosen = true, view = { x: 6000, y: 6000 };
let lb = { rank: 0, total: 0, top: [] }, mini = { spikes: [], big: [], people: [] }, peak = 0, lastTick = 0;
const smooth = k => 1 - Math.exp(-k);

/* ---------- connection ---------- */
let ws = null, connected = false, retry = 0, full = false;
function wsUrl() { const p = location.protocol === 'https:' ? 'wss:' : 'ws:'; return (window.GAME_SERVER || `${p}//${location.host}`) + '/ws'; }
function connect() {
  setStatus('Connecting…');
  try { ws = new WebSocket(wsUrl()); } catch (e) { return reconnect(); }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { connected = true; retry = 0; full = false; setStatus(''); ws.send(Net.enc.size(innerWidth, innerHeight)); };
  ws.onmessage = e => { if (typeof e.data !== 'string') handle(Net.decode(e.data, WS)); };
  ws.onclose = () => { connected = false; if (playing) { playing = false; showMenu('Connection lost', 'Reconnecting to the server…'); } ents.clear(); spikes.clear(); blobs.clear(); pellets.clear(); owners.clear(); reconnect(); };
  ws.onerror = () => {};
}
function reconnect() { const wait = Math.min(10000, 800 * 2 ** retry++); setStatus('Can’t reach the server. Trying again in ' + Math.ceil(wait / 1000) + ' s…'); setTimeout(connect, wait); }
function send(ab) { if (ws && ws.readyState === 1) ws.send(ab); }
function setStatus(t) { $('net').textContent = t; $('net').hidden = !t; $('go').disabled = !!t && !connected; }

function handle(m) {
  if (!m) return;
  switch (m.op) {
    case 1: WS = m.world; break;
    case 2: myBoxes = m.ids; active = m.active; break;
    case 3: for (const o of m.list) owners.set(o.id, o); break;
    case 4: {
      lastTick = performance.now(); view.x = m.vx; view.y = m.vy;
      const seen = new Set();
      for (const c of m.cells) {
        seen.add(c.id); const e = ents.get(c.id);
        if (e) { e.tx = c.x; e.ty = c.y; e.tr = c.r; e.m = c.m; e.o = c.o; }
        else ents.set(c.id, { id: c.id, o: c.o, x: c.x, y: c.y, r: c.r, tx: c.x, ty: c.y, tr: c.r, m: c.m });
      }
      for (const id of ents.keys()) if (!seen.has(id)) ents.delete(id);
      const ss = new Set();
      for (const v of m.spikes) { ss.add(v.id); const e = spikes.get(v.id); if (e) { e.tx = v.x; e.ty = v.y; e.r = v.r; e.fed = v.fed; } else spikes.set(v.id, { x: v.x, y: v.y, tx: v.x, ty: v.y, r: v.r, fed: v.fed, rot: Math.random() * TAU }); }
      for (const id of spikes.keys()) if (!ss.has(id)) spikes.delete(id);
      const bs = new Set();
      for (const b of m.blobs) { bs.add(b.id); const e = blobs.get(b.id); if (e) { e.tx = b.x; e.ty = b.y; } else blobs.set(b.id, { x: b.x, y: b.y, tx: b.x, ty: b.y, hue: b.hue }); }
      for (const id of blobs.keys()) if (!bs.has(id)) blobs.delete(id);
      for (const f of m.added) pellets.set(f.id, f);
      for (const id of m.removed) pellets.delete(id);
      const mine = mineCells(); let tot = 0; for (const c of mine) tot += c.m;
      if (playing && tot > peak) peak = tot;
      break;
    }
    case 5: lb = m; break;
    case 6: mini = m; break;
    case 7: { // eaten
      playing = false; held.clear(); feedOn = false; lock = null; sq.length = 0;
      const nb = m.peak > best; if (nb) { best = m.peak; try { localStorage.setItem('gobblebest_mp', best); } catch (e) {} }
      $('sts').hidden = false; $('s1').textContent = dm(m.peak).toLocaleString(); $('s2').textContent = m.kills; $('s3').textContent = fmtT(m.alive);
      showMenu('You were eaten', nb ? 'New personal best!' : 'Best so far: ' + dm(best).toLocaleString() + ' mass.'); $('go').textContent = 'Play again';
      break;
    }
    case 8: full = true; setStatus('This arena is full right now. Try again in a moment.'); break;
  }
}
function fmtT(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function mineCells() { const out = []; for (const e of ents.values()) if (myBoxes.includes(e.o)) out.push(e); return out; }
function activeId() { return myBoxes[active]; }

/* ---------- menu ---------- */
function showMenu(t, s) { $('ot').textContent = t; $('os').textContent = s; $('ov').hidden = false; }
function startGame() {
  if (!connected || full) return;
  const nm = ($('nm').value.trim() || 'Player').slice(0, 12);
  try { localStorage.setItem('gobblename', nm); } catch (e) {}
  send(Net.enc.join(multiChosen, innerWidth, innerHeight, nm));
  playing = true; peak = 0; lock = null; sq.length = 0; feedOn = false; held.clear();
  $('ov').hidden = true; $('sts').hidden = true; showMultiBtns(multiChosen);
}
function showMultiBtns(on) { $('bsw').hidden = $('bfd').hidden = !on; }
function setMode(m) {
  multiChosen = m; $('mSolo').setAttribute('aria-pressed', !m); $('mMulti').setAttribute('aria-pressed', m);
  $('mbh').textContent = m ? 'Control two orbs. Switch between them with ' + label(binds.swap) + '.' : 'Play with a single orb.';
  try { localStorage.setItem('gobblemb', m ? '1' : '0'); } catch (e) {}
}

/* ---------- aiming, line locks, splits ---------- */
let mx = 0, my = 0, lock = null, unlockT = 0, feedOn = false, sq = [], pings = [], paused = false, listening = null;
const held = new Set(), mheld = {};
function s2w(x, y) { return { x: (x - W / 2) / cam.s + cam.x, y: (y - H / 2) / cam.s + cam.y }; }
function aimPoint() { const w = s2w(mx, my); if (lock) { if (lock.t === 'h') w.y = lock.y; else if (lock.t === 'v') w.x = lock.x; else { w.x = lock.x; w.y = lock.y; } } return w; }
function sendAim() { if (!playing) return; const w = aimPoint(); send(Net.enc.mouse(clamp(w.x, 0, WS), clamp(w.y, 0, WS))); }
function split() { if (!playing) return; sendAim(); send(Net.enc.split()); }
function multiSplit(n) {
  if (!playing || paused) return; split();
  for (let i = 1; i < n; i++) { if (pd <= 0) split(); else sq.push(i * pd / 1000); }
  if (lock && mal) unlockT = Math.max(unlockT, (n - 1) * pd / 1000 + 0.12);
}
function lineKey(t, down) {
  if (down) {
    if (!playing) return;
    if (ltg && lock && lock.t === t) { lock = null; return; }
    const me = mineCells().filter(c => c.o === activeId()); if (!me.length) return;
    let sx = 0, sy = 0, sm = 0; for (const c of me) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; }
    const w = s2w(mx, my); lock = { t, x: t === 'f' ? w.x : sx / sm, y: t === 'f' ? w.y : sy / sm }; unlockT = 0;
    if (lsi) multiSplit(lsn);
  } else if (!ltg && lock && lock.t === t) lock = null;
}
function setEject(on) { send(Net.enc.eject(on, rf)); }
function act(k, down) {
  if (down && (!playing || paused)) return;
  switch (k) {
    case 'split': if (down) multiSplit(1); break;
    case 'dsplit': if (down) multiSplit(2); break;
    case 'tsplit': if (down) multiSplit(3); break;
    case 'qsplit': if (down) multiSplit(4); break;
    case 'eject': sendAim(); if (ftg) { if (down) { feedOn = !feedOn; setEject(feedOn); } } else setEject(down); break;
    case 'feed': send(Net.enc.feed(down, rf)); break;
    case 'hline': lineKey('h', down); break;
    case 'vline': lineKey('v', down); break;
    case 'fline': lineKey('f', down); break;
    case 'respawn': if (down) send(Net.enc.respawn()); break;
    case 'ping': if (down) { const w = s2w(mx, my); pings.push({ x: w.x, y: w.y, t: 3 }); if (pings.length > 5) pings.shift(); } break;
    case 'swap': if (down && multiChosen) { const w = aimPoint(); send(Net.enc.swap(clamp(w.x, 0, WS), clamp(w.y, 0, WS))); } break;
  }
}

/* ---------- drawing ---------- */
function resize() { dpr = Math.min(1.5, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); if (connected) send(Net.enc.size(W, H)); }
addEventListener('resize', resize); resize();
function camera(dt) {
  const mine = playing ? mineCells() : [];
  let cx = view.x, cy = view.y, sm = 1600, ext = 0;
  if (mine.length) { let sx = 0, sy = 0; sm = 0; for (const c of mine) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; } cx = sx / sm; cy = sy / sm; for (const c of mine) ext = Math.max(ext, Math.hypot(c.x - cx, c.y - cy) + c.r); }
  const base = clamp(Math.min(W, H) / 600, 0.7, 1.4) * 1.35;
  const sN = Math.min(base / (1 + Math.sqrt(sm) / 26), Math.min(W, H) * 0.45 / (ext + 80)), fit = Math.min(W, H) / (WS * 2.1), s = Math.max(fit, sN * zm);
  cam.v = [cx - W / 2 / sN * 1.2, cx + W / 2 / sN * 1.2, cy - H / 2 / sN * 1.2, cy + H / 2 / sN * 1.2];
  const pr = smooth(dt * (mine.length ? 10 : 3)); cam.x += (cx - cam.x) * pr; cam.y += (cy - cam.y) * pr; cam.s += (s - cam.s) * smooth(dt * 3);
}
function drawSpike(v) {
  const R = v.r;
  if (R * cam.s < 6) { const q = Math.max(R, 4 / cam.s); g.fillStyle = '#5fe07c'; g.beginPath(); for (let i = 0; i <= 16; i++) { const a = i / 16 * TAU + v.rot, r = i % 2 ? q * 0.75 : q * 1.15; i ? g.lineTo(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r) : g.moveTo(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r); } g.closePath(); g.fill(); return; }
  g.beginPath(); for (let i = 0; i <= 44; i++) { const a = i / 44 * TAU + v.rot, r = i % 2 ? R * 0.9 : R * 1.04; i ? g.lineTo(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r) : g.moveTo(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r); }
  g.closePath(); g.fillStyle = 'rgba(95,224,124,.92)'; g.fill(); g.strokeStyle = '#2f8a4c'; g.lineWidth = Math.max(3, R * 0.06); g.stroke();
  if (v.fed) { g.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < v.fed; i++) { const a = i / 7 * TAU - Math.PI / 2; g.beginPath(); g.arc(v.x + Math.cos(a) * R * 0.45, v.y + Math.sin(a) * R * 0.45, R * 0.07, 0, TAU); g.fill(); } }
}
const fb = Array.from({ length: 12 }, () => []);
function draw(dt) {
  const k = smooth(dt * 16);
  for (const e of ents.values()) { e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.r += (e.tr - e.r) * k; }
  for (const v of spikes.values()) { v.x += (v.tx - v.x) * k; v.y += (v.ty - v.y) * k; v.rot += dt * 0.3; }
  for (const b of blobs.values()) { b.x += (b.tx - b.x) * k; b.y += (b.ty - b.y) * k; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W / 2, H / 2); g.scale(cam.s, cam.s); g.translate(-cam.x, -cam.y);
  const hw = W / 2 / cam.s, hh = H / 2 / cam.s;
  let x0 = Math.max(cam.x - hw, cam.v[0]), x1 = Math.min(cam.x + hw, cam.v[1]), y0 = Math.max(cam.y - hh, cam.v[2]), y1 = Math.min(cam.y + hh, cam.v[3]);
  g.strokeStyle = '#333'; g.lineWidth = 6 / cam.s; g.strokeRect(0, 0, WS, WS);
  // pellets
  const fr = rad(3), psz = fr * cam.s;
  if (psz > 0.35) {
    for (const b of fb) b.length = 0;
    for (const f of pellets.values()) if (f.x > x0 - 20 && f.x < x1 + 20 && f.y > y0 - 20 && f.y < y1 + 20) fb[f.hb % 12].push(f);
    for (let h = 0; h < 12; h++) {
      const a = fb[h]; if (!a.length) continue; g.fillStyle = 'hsl(' + h * 30 + ' 70% 60%)'; g.beginPath();
      for (const f of a) { const rr = f.ej ? 16 : fr; if (psz < 1.6) g.rect(f.x - rr * 0.85, f.y - rr * 0.85, rr * 1.7, rr * 1.7); else { g.moveTo(f.x + rr, f.y); g.arc(f.x, f.y, rr, 0, TAU); } }
      g.fill();
    }
  }
  for (const b of blobs.values()) { if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue; g.fillStyle = 'hsl(' + b.hue + ' 65% 60%)'; g.beginPath(); g.arc(b.x, b.y, 16, 0, TAU); g.fill(); }
  // orbs, small first
  const list = []; for (const e of ents.values()) if (!(e.x < x0 - e.r || e.x > x1 + e.r || e.y < y0 - e.r || e.y > y1 + e.r)) list.push(e);
  list.sort((a, b) => a.m - b.m);
  const multi = myBoxes.length > 1;
  for (const c of list) {
    const mineC = myBoxes.includes(c.o), ow = owners.get(c.o), R = c.r;
    const white = multi && mineC && c.o === activeId(), red = multi && mineC && c.o !== activeId();
    g.fillStyle = white ? '#f4f4f4' : red ? '#e0443e' : 'hsl(' + (ow ? ow.hue : 0) + ' 72% 52%)';
    g.beginPath(); g.arc(c.x, c.y, R, 0, TAU); g.fill();
    if (R * cam.s > 16) {
      const fs = Math.max(12, R * 0.34), name = ow ? ow.name : '';
      g.font = '800 ' + fs + "px 'Bricolage Grotesque',system-ui,sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = white ? '#1a1a1a' : '#fff';
      if (fs * cam.s >= 13 && !white) { g.lineWidth = fs * 0.14; g.strokeStyle = 'rgba(0,0,0,.45)'; g.strokeText(name, c.x, c.y); }
      g.fillText(name, c.x, c.y);
      const ms = fs * 0.45; g.font = '700 ' + ms + "px 'Bricolage Grotesque',system-ui,sans-serif"; g.fillStyle = white ? 'rgba(0,0,0,.4)' : 'rgba(255,255,255,.38)';
      g.fillText(String(dm(c.m)), c.x, c.y + fs * 0.72);
    }
  }
  for (const v of spikes.values()) if (!(v.x < x0 - v.r || v.x > x1 + v.r || v.y < y0 - v.r || v.y > y1 + v.r)) drawSpike(v);
  if (playing && lock) {
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2 / cam.s; g.setLineDash([10 / cam.s, 8 / cam.s]); g.beginPath();
    if (lock.t === 'h') { g.moveTo(Math.max(0, x0), lock.y); g.lineTo(Math.min(WS, x1), lock.y); }
    else if (lock.t === 'v') { g.moveTo(lock.x, Math.max(0, y0)); g.lineTo(lock.x, Math.min(WS, y1)); }
    else { const q = 14 / cam.s; g.moveTo(lock.x - q, lock.y); g.lineTo(lock.x + q, lock.y); g.moveTo(lock.x, lock.y - q); g.lineTo(lock.x, lock.y + q); }
    g.stroke(); g.setLineDash([]);
  }
  for (const p of pings) { const a = clamp(p.t, 0, 1), r = (16 + ((3 - p.t) % 1) * 34) / cam.s; g.strokeStyle = 'rgba(255,210,90,' + a + ')'; g.lineWidth = 3 / cam.s; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.stroke(); }
  g.restore();
}
let mmT = 0;
function drawMM() {
  const s = mm.clientWidth; if (!s) return; if (mm.width !== Math.round(s * dpr)) mm.width = mm.height = Math.round(s * dpr);
  mg.setTransform(dpr, 0, 0, dpr, 0, 0); mg.clearRect(0, 0, s, s); const k = s / WS, cw = s / 5;
  mg.strokeStyle = 'rgba(255,255,255,.14)'; mg.lineWidth = 1; mg.beginPath();
  for (let i = 1; i < 5; i++) { mg.moveTo(i * cw, 0); mg.lineTo(i * cw, s); mg.moveTo(0, i * cw); mg.lineTo(s, i * cw); } mg.stroke();
  mg.fillStyle = 'rgba(255,255,255,.3)'; mg.font = '700 ' + Math.max(8, cw * 0.2) + "px 'Bricolage Grotesque',system-ui,sans-serif"; mg.textAlign = 'left'; mg.textBaseline = 'top';
  for (let r = 0; r < 5; r++) for (let q = 0; q < 5; q++) mg.fillText('ABCDE'[r] + (q + 1), q * cw + 3, r * cw + 3);
  mg.fillStyle = 'rgba(70,190,100,.55)'; for (const v of mini.spikes) { mg.beginPath(); mg.arc(v.x * k, v.y * k, 1.6, 0, TAU); mg.fill(); }
  let me = 0; for (const c of mineCells()) me += c.m;
  for (const c of mini.big) { if (myBoxes.includes(c.o)) continue; mg.fillStyle = playing && c.r * c.r / 16 > me * 1.25 ? '#d9534f' : '#8fa8a2'; mg.beginPath(); mg.arc(c.x * k, c.y * k, Math.max(2, c.r * k), 0, TAU); mg.fill(); }
  // other real players: a gold ring so you can go and find them
  mg.font = '700 9px system-ui,sans-serif'; mg.textAlign = 'center'; mg.textBaseline = 'bottom';
  for (const p of mini.people || []) {
    if (myBoxes.includes(p.o)) continue; const x = p.x * k, y = p.y * k, ow = owners.get(p.o);
    mg.strokeStyle = '#ffd25a'; mg.lineWidth = 2; mg.beginPath(); mg.arc(x, y, 3.5, 0, TAU); mg.stroke();
    if (ow && s >= 140) { mg.fillStyle = 'rgba(255,210,90,.85)'; mg.fillText(ow.name.slice(0, 10), x, y - 5); }
  }
  const multi = myBoxes.length > 1;
  for (const c of mineCells()) { mg.fillStyle = !multi ? '#2a9a83' : c.o === activeId() ? '#f4f4f4' : '#e0443e'; mg.beginPath(); mg.arc(c.x * k, c.y * k, Math.max(2.5, c.r * k), 0, TAU); mg.fill(); }
  for (const p of pings) { mg.fillStyle = '#ffd25a'; mg.beginPath(); mg.arc(p.x * k, p.y * k, 4, 0, TAU); mg.fill(); }
}
function hud() {
  const mine = mineCells(); let tot = 0, sx = 0, sy = 0, sm = 0;
  for (const c of mine) { tot += c.m; if (c.o === activeId()) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; } }
  $('sc').textContent = dm(tot).toLocaleString(); $('bs').textContent = dm(Math.max(best, peak)).toLocaleString();
  $('rk').textContent = playing && lb.rank ? lb.rank + ' / ' + lb.total : '–';
  $('sec').textContent = playing && sm ? 'ABCDE'[clamp(Math.floor(sy / sm / WS * 5), 0, 4)] + (clamp(Math.floor(sx / sm / WS * 5), 0, 4) + 1) : '–';
  const multi = myBoxes.length > 1, ao = owners.get(activeId());
  $('ct').textContent = playing && multi && ao ? 'Controlling ' + ao.name + ' · ' + label(binds.swap) + ' to switch' : '';
  const ol = $('lb'); ol.textContent = '';
  const row = (id, m, i) => { const li = document.createElement('li'); li.value = i + 1; const o = owners.get(id); li.textContent = (o ? o.name : '…') + ' · ' + dm(m).toLocaleString(); if (myBoxes.includes(id)) li.className = 'me'; ol.appendChild(li); };
  lb.top.slice(0, 6).forEach((t, i) => row(t.id, t.m, i));
  if (playing && lb.rank > 6) { const li = document.createElement('li'); li.className = 'gap'; li.textContent = '…'; ol.appendChild(li); const li2 = document.createElement('li'); li2.value = lb.rank; li2.className = 'me'; li2.textContent = 'You · ' + dm(tot).toLocaleString(); ol.appendChild(li2); }
  $('pc').textContent = connected ? lb.total + ' in the arena' : '';
}

/* ---------- loop ---------- */
let last = performance.now(), ht = 0, aimT = 0;
function frame(t) {
  const dt = clamp((t - last) / 1000, 0, 0.1); last = t; T += dt;
  if (playing && !paused) {
    for (let i = sq.length - 1; i >= 0; i--) { sq[i] -= dt; if (sq[i] <= 0) { sq.splice(i, 1); split(); } }
    if (unlockT > 0) { unlockT -= dt; if (unlockT <= 0) { unlockT = 0; lock = null; } }
    aimT -= dt; if (aimT <= 0) { aimT = 1 / 30; sendAim(); }
  }
  if (pings.length) pings = pings.filter(p => (p.t -= dt) > 0);
  camera(dt); draw(dt);
  mmT -= dt; if (mmT <= 0) { mmT = 0.1; drawMM(); }
  ht += dt; if (ht > 0.25) { ht = 0; hud(); }
  requestAnimationFrame(frame);
}

/* ---------- settings panel ---------- */
const isBound = c => !!c && Object.values(binds).includes(c);
function press(c) { if (!playing || paused) return; held.add(c); for (const k in binds) if (binds[k] === c) act(k, true); }
function release(c) { held.delete(c); for (const k in binds) if (binds[k] === c) act(k, false); }
function assign(a, code) { for (const k in binds) if (k !== a && binds[k] === code) binds[k] = binds[a]; binds[a] = code; saveCfg(); updateHelp(); }
function updateHelp() {
  const kb = $('keys'); kb.textContent = '';
  for (const [k, v] of [['Move', 'Mouse'], ['Split', label(binds.split)], ['Double split', label(binds.dsplit)], ['Rapid feed', label(binds.eject)], ['Line', label(binds.hline) + ' / ' + label(binds.vline)]]) { const s = document.createElement('span'); s.append(k + ' '); const b = document.createElement('kbd'); b.textContent = v; s.append(b); kb.append(s); }
  setMode(multiChosen);
}
function renderSettings() {
  const kl = $('kl'); kl.textContent = '';
  for (const [k, n] of ACT) {
    const row = document.createElement('div'); row.className = 'kr';
    const s = document.createElement('span'); s.textContent = n;
    const b = document.createElement('button'); b.className = 'kb' + (listening === k ? ' wait' : ''); b.id = 'kb_' + k; b.textContent = listening === k ? 'Press a key…' : label(binds[k]);
    b.onclick = e => { e.stopPropagation(); listening = k; renderSettings(); };
    row.append(s, b); kl.appendChild(row);
  }
  for (const b of [0, 2]) { const el = $('mm' + b); if (!el.options.length) for (const [v, t] of MACROS) { const o = document.createElement('option'); o.value = v; o.textContent = t; el.append(o); } el.value = mbtn[b]; }
  $('rf').value = rf; $('rfv').textContent = rf + ' ms'; $('pd').value = pd; $('pdv').textContent = pd + ' ms';
  $('lsi').checked = lsi; $('lsn').value = lsn; $('mal').checked = mal; $('ltg').checked = ltg; $('ftg').checked = ftg;
}
function openSettings() { $('st').hidden = false; paused = true; listening = null; releaseAll(); renderSettings(); }
function closeSettings() { $('st').hidden = true; paused = false; listening = null; }
function releaseAll() { for (const c of [...held]) release(c); held.clear(); for (const b in mheld) { act(mheld[b], false); delete mheld[b]; } if (feedOn) { feedOn = false; setEject(false); } if (!ltg) lock = null; }

/* ---------- input ---------- */
let steer = null;
cv.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { steer = e.pointerId; mx = e.clientX; my = e.clientY; } try { window.focus(); } catch (x) {} });
addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.pointerId === steer) { mx = e.clientX; my = e.clientY; } });
addEventListener('pointerup', e => { if (e.pointerId === steer) steer = null; });
addEventListener('keydown', e => {
  if (listening) { e.preventDefault(); e.stopPropagation(); const k = listening; listening = null; if (e.code === 'Backspace' || e.code === 'Delete') { binds[k] = ''; saveCfg(); updateHelp(); } else if (e.code !== 'Escape') assign(k, e.code); renderSettings(); return; }
  if (!$('st').hidden) { if (e.code === 'Escape') closeSettings(); return; }
  const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'SELECT') return;
  if (!playing) return;
  e.preventDefault();
  if (e.repeat) return;
  if (isBound(e.code)) press(e.code);
}, true);
addEventListener('keyup', e => { if (playing) e.preventDefault(); release(e.code); });
cv.addEventListener('mousedown', e => {
  if (!playing) return; e.preventDefault(); const mac = mbtn[e.button];
  if (mac && mac !== 'none') { if (!paused) { act(mac, true); mheld[e.button] = mac; } return; }
  if (isBound('Mouse' + e.button)) press('Mouse' + e.button);
});
addEventListener('mousedown', e => {
  if (!listening) return; e.preventDefault(); e.stopPropagation(); const k = listening; listening = null;
  if (e.button !== 0 || (e.target.closest && e.target.closest('#kb_' + k))) assign(k, 'Mouse' + e.button);
  renderSettings();
}, true);
addEventListener('mouseup', e => { if (e.button > 2 && playing) e.preventDefault(); const mac = mheld[e.button]; if (mac) { delete mheld[e.button]; act(mac, false); } release('Mouse' + e.button); });
addEventListener('auxclick', e => { if (playing) e.preventDefault(); });
addEventListener('contextmenu', e => { if (listening || playing || e.target === cv) e.preventDefault(); });
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); else try { window.focus(); } catch (x) {} });
cv.addEventListener('wheel', e => { e.preventDefault(); zm = clamp(zm * Math.exp(-e.deltaY * 0.0015), 0.01, 3); }, { passive: false });
function tbtn(id, fn, hold) {
  const b = $(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (!playing) return; fn(true); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => hold && fn(false));
}
tbtn('bsp', d => d && multiSplit(1)); tbtn('bds', d => d && multiSplit(2)); tbtn('bej', d => act('eject', d), true); tbtn('bsw', d => d && act('swap', true)); tbtn('bfd', d => act('feed', d), true);
$('gear').addEventListener('click', openSettings); $('cl').addEventListener('click', closeSettings); $('cl2').addEventListener('click', closeSettings);
$('rs').addEventListener('click', () => { binds = Object.assign({}, DEF); rf = 40; pd = 50; lsi = false; lsn = 2; mal = true; ltg = false; ftg = false; mbtn = { 0: 'none', 2: 'none' }; saveCfg(); updateHelp(); renderSettings(); });
const setting = (id, ev, fn) => $(id).addEventListener(ev, e => { fn(e.target); saveCfg(); renderSettings(); });
setting('rf', 'input', t => rf = +t.value); setting('pd', 'input', t => pd = +t.value);
setting('lsi', 'change', t => lsi = t.checked); setting('lsn', 'change', t => lsn = clamp(Math.round(+t.value) || 1, 1, 4)); setting('mal', 'change', t => mal = t.checked);
setting('ltg', 'change', t => { ltg = t.checked; lock = null; }); setting('ftg', 'change', t => { ftg = t.checked; feedOn = false; });
setting('mm0', 'change', t => mbtn[0] = t.value); setting('mm2', 'change', t => mbtn[2] = t.value);
$('mSolo').addEventListener('click', () => setMode(false)); $('mMulti').addEventListener('click', () => setMode(true));
$('go').addEventListener('click', startGame);
$('nm').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });

/* ---------- start ---------- */
document.title = GAME_NAME; $('ot').textContent = GAME_NAME;
try { $('nm').value = localStorage.getItem('gobblename') || ''; multiChosen = localStorage.getItem('gobblemb') !== '0'; } catch (e) {}
updateHelp(); mx = W / 2; my = H / 2;
connect(); requestAnimationFrame(frame);
})();
