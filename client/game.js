// Multiplayer client: draws what the server sends, sends the player's mouse and keys.
(function () {
'use strict';
const GAME_NAME = 'Blobbit';
const tr = (k, v) => I18N.t(k, v); // every bit of game text goes through here, in the player's language // change here (and in index.html <title>) when the game gets its final name
const $ = id => document.getElementById(id), cv = $('c'), g = cv.getContext('2d', { alpha: false }), mm = $('mm'), mg = mm.getContext('2d');
const TAU = Math.PI * 2, clamp = (v, a, b) => (v < a ? a : v > b ? b : v), rad = m => 4 * Math.sqrt(m), dm = m => Math.floor(m / 2);
const VIEW_SCALE = 1.0; // must match the server's VIEW_SCALE
let WS = 12000, SPEED = 1685, W = 0, H = 0, dpr = 1, T = 0;
const cam = { x: 6000, y: 6000, s: 0.5 }; let zm = 1;

/* ---------- settings (same controls as the offline game) ---------- */
// default keys follow what most players of this kind of game already use (Space split, W feed, D double, T triple, A 16-split, R respawn, Tab switch)
const DEF = { split: 'Space', dsplit: 'KeyD', tsplit: 'KeyT', qsplit: 'KeyA', psplit: 'KeyQ', eject: 'KeyW', feed: 'KeyE', swap: 'Tab', respawn: 'KeyR', hline: 'KeyS', vline: 'KeyX', fline: 'KeyZ', ping: 'KeyF', zin: 'Equal', zout: 'Minus', ptt: 'KeyV', fx_quake: 'KeyK', fx_warn: 'KeyJ', fx_disco: 'KeyL', fx_chat: 'KeyH', fx_confetti: 'KeyU', fx_snow: 'KeyI', fx_flash: 'KeyO', fx_hearts: 'KeyP', fx_fireworks: 'KeyY' };
const ACT = ['split', 'dsplit', 'psplit', 'tsplit', 'qsplit', 'eject', 'hline', 'vline', 'fline', 'respawn', 'ping', 'swap', 'feed', 'zin', 'zout', 'ptt', 'fx_quake', 'fx_warn', 'fx_disco', 'fx_chat', 'fx_confetti', 'fx_snow', 'fx_flash', 'fx_hearts', 'fx_fireworks'].map(k => [k, 'a_' + k]);
const MACROS = [['none', 'm_none'], ['split', 'a_split'], ['dsplit', 'a_dsplit'], ['psplit', 'a_psplit'], ['tsplit', 'a_tsplit'], ['qsplit', 'a_qsplit'], ['eject', 'a_eject'], ['swap', 'm_swap']];
let binds2 = {}; // an optional second key for any action (either key works)
let binds = Object.assign({}, DEF), dd = 60, rf = 25, pd = 50, ppd = 120, lsi = false, lsn = 2, mal = true, ltg = false, ftg = false, mbtn = { 0: 'none', 2: 'swap' }; // right click (or two-finger click on a trackpad) also switches boxes
// test mode: open the page with ?test=1 to start one orb at 35,000 that never loses mass
const TEST = /(^|[?&])test=1(&|$)/.test(location.search.slice(1));
let lines = true; // lines from your orbs to the mouse
let ring = false; // multibox: mark the active orb with a white ring instead of recolouring both
let faces = true; // funny faces on bots
let xpFrac = 0, aliveXP = 0, quakeT = 0, discoT = 0, confettiT = 0, rec = null, confetti = []; // seconds left of each effect
let fcap = 0; // highest frames per second to draw; 0 = as many as the monitor shows
// multibox colours: the orb you control and your other one. Text colours are worked out once, not per frame.
const COL_DEF = ['#f4f4f4', '#e0443e'];
const COL_PRESETS = [['#f4f4f4', '#e0443e'], ['#ffd23f', '#6b6b6b'], ['#3ee07a', '#5c5c5c'], ['#4fc3ff', '#b45cff'], ['#ff5d73', '#3a7bff'], ['#ffffff', '#4a4a4a']];
let colA = COL_DEF[0], colI = COL_DEF[1], txtA = null, txtI = null, colsReady = false;
function light(hex) { const n = parseInt(hex.slice(1), 16), r = n >> 16, g2 = n >> 8 & 255, b = n & 255; return 0.299 * r + 0.587 * g2 + 0.114 * b > 165; }
function textFor(hex) { return light(hex) ? { name: '#1a1a1a', mass: 'rgba(0,0,0,.4)', stroke: false } : { name: '#fff', mass: 'rgba(255,255,255,.45)', stroke: true }; }
function setCols(a, i) { const ok = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); colA = ok(a) ? a.toLowerCase() : COL_DEF[0]; colI = ok(i) ? i.toLowerCase() : COL_DEF[1]; txtA = textFor(colA); txtI = textFor(colI); if (colsReady) { markClashes(); setTimeout(sendCols, 0); } }
// other multibox players' chosen colours (owner id -> { hex, txt, clash }), always shown exactly as they picked them
const ownerCol = new Map(); colsReady = true;
function rgbOf(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; }
function near(a, b) { const x = rgbOf(a), y = rgbOf(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 80; }
function markClashes() { for (const v of ownerCol.values()) v.clash = false; } // everyone is always shown in the colours they picked, even if they match yours
function sendCols() { if (connected) send(Net.enc.cols(colA, colI, pass.skin, pass.badge)); }
const ownerSkin = new Map(); // owner id -> sticker skin other players picked
function ownerFill(o) { // the colour an owner's orbs and fed blobs are drawn in
  if (discoT > 0) return 'hsl(' + ((T * 400 + o * 67) % 360 | 0) + ' 90% 58%)';
  const mineC = myBoxes.includes(o), ow = owners.get(o);
  if (mineC && myBoxes.length > 1 && !ring) return o === activeId() ? colA : colI;
  const oc = !mineC && ownerCol.get(o); if (oc && !oc.clash) return oc.hex;
  if (!mineC && partyIds.has(o)) return 'hsl(' + partyHue() + ' 80% 58%)';
  return 'hsl(' + (ow ? ow.hue : 0) + ' 72% 52%)';
}
setCols();
let best = 0;
try { best = +localStorage.getItem('gobblebest_mp') || 0; } catch (e) {}
try {
  const c = JSON.parse(localStorage.getItem('gobblecfg') || 'null');
  if (c) {
    if (c.binds2 && c.kv === 2) for (const k in DEF) if (typeof c.binds2[k] === 'string' && c.binds2[k]) binds2[k] = c.binds2[k];
    if (c.binds && c.kv === 2) for (const k in DEF) if (typeof c.binds[k] === 'string') binds[k] = c.binds[k]; // keys saved before the new standard layout are replaced once
    const num = (k, a, b) => (typeof c[k] === 'number' ? clamp(c[k], a, b) : undefined), bool = k => (typeof c[k] === 'boolean' ? c[k] : undefined);
    rf = num('rf2', 20, 200) ?? rf; dd = num('dd2', 0, 300) ?? dd; pd = num('pd', 0, 200) ?? pd; ppd = num('ppd', 40, 300) ?? ppd; lsn = num('lsn', 1, 4) ?? lsn; fcap = num('fcap', 0, 1000) ?? fcap; lines = bool('lines') ?? lines; ring = bool('ring') ?? ring; faces = bool('faces') ?? faces; setCols(c.cA, c.cI);
    lsi = bool('lsi') ?? lsi; mal = bool('mal') ?? mal; ltg = bool('ltg') ?? ltg; ftg = bool('ftg') ?? ftg;
    if (c.mbtn && c.kv === 2) for (const b of [0, 2]) if (MACROS.some(m => m[0] === c.mbtn[b])) mbtn[b] = c.mbtn[b];
  }
} catch (e) {}
{ const seen = new Set(); for (const [k] of ACT) { const v = binds[k]; if (!v) continue; if (seen.has(v)) binds[k] = Object.values(binds).includes(DEF[k]) ? '' : DEF[k]; seen.add(binds[k]); } }
function saveCfg() { try { const old = JSON.parse(localStorage.getItem('gobblecfg') || '{}') || {}; localStorage.setItem('gobblecfg', JSON.stringify(Object.assign(old, { kv: 2, binds2, ppd, rf2: rf, binds, fcap, lines, ring, faces, cA: colA, cI: colI, dd2: dd, rf, pd, lsi, lsn, mal, ltg, ftg, mbtn }))); } catch (e) {} }
const KEYNAME = { Equal: '=', Minus: '−', Tab: 'Tab', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', ShiftLeft: 'Shift', ShiftRight: 'Shift R', ControlLeft: 'Ctrl', AltLeft: 'Alt / ⌥', MetaLeft: '⌘', CapsLock: 'Caps' };
function label(b) { if (!b) return tr('unbound'); if (KEYNAME[b]) return KEYNAME[b]; if (b.startsWith('Mouse')) { const n = +b.slice(5); return n <= 2 ? tr(['mouse_left', 'mouse_middle', 'mouse_right'][n]) : tr('mouse_n', { n: n + 1 }); } return b.startsWith('Key') ? b.slice(3) : b.startsWith('Digit') ? b.slice(5) : b; }

/* ---------- world as last seen from the server ---------- */
const ents = new Map(), spikes = new Map(), blobs = new Map(), pellets = new Map(), owners = new Map();
let myBoxes = [], active = 0, playing = false, multiChosen = true, watchChosen = false, watching = false, view = { x: 6000, y: 6000 };
let lb = { rank: 0, total: 0, top: [] }, mini = { spikes: [], big: [], people: [] }, peak = 0, lastTick = 0;
let partyCode = '', partyIds = new Set(), showChat = true, chatOpen = false, chatChan = 0;
const smooth = k => 1 - Math.exp(-k);

/* ---------- connection ---------- */
let connAt = 0, ws = null, connected = false, retry = 0, full = false;
// regions: every listed server that has an address; this page's own server counts as one too
const SERVERS = (window.GAME_SERVERS || []).filter(s => s.url);
const here = location.protocol + '//' + location.host;
if (/^https?:$/.test(location.protocol) && !SERVERS.some(s => s.url.replace(/\/$/, '') === here) && (!SERVERS.length || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))) SERVERS.unshift({ id: 'here', name: 'This computer', url: here });
let region = null; try { region = localStorage.getItem('gobbleregion'); } catch (e) {}
if (!SERVERS.some(s => s.id === region)) { const mine = SERVERS.find(s => s.url.replace(/\/$/, '') === here); region = (mine || SERVERS[0] || {}).id; }
const regionPing = {};
function serverUrl() { const s = SERVERS.find(x => x.id === region); return s ? s.url.replace(/\/$/, '') : here; }
function wsUrl() { return serverUrl().replace(/^http/, 'ws') + '/ws'; }
function renderRegions() {
  const box = $('regions'); box.textContent = ''; if (SERVERS.length < 2) return;
  for (const s of SERVERS) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', s.id === region);
    b.textContent = tr('r_' + s.id) === 'r_' + s.id ? s.name : tr('r_' + s.id); const sm = document.createElement('small'); sm.textContent = regionPing[s.id] ? regionPing[s.id] + ' ms' : tr('checking'); b.append(sm);
    b.onclick = () => { if (s.id === region) return; region = s.id; try { localStorage.setItem('gobbleregion', region); } catch (e) {} renderRegions(); switchServer(); };
    box.append(b);
  }
}
// quick ping of every region (a short separate connection each), refreshed every 20 s while on the menu
function probeRegions() {
  for (const s of SERVERS) {
    let w; try { w = new WebSocket(s.url.replace(/\/$/, '').replace(/^http/, 'ws') + '/ws'); } catch (e) { continue; }
    w.binaryType = 'arraybuffer'; const times = []; let t0 = 0, n = 0;
    const next = () => { t0 = performance.now(); w.send(Net.enc.ping(++n)); };
    w.onopen = next;
    w.onmessage = e => { if (typeof e.data === 'string') return; const m = Net.decode(e.data, WS); if (!m || m.op !== 9) return; times.push(performance.now() - t0); if (times.length < 3) next(); else { regionPing[s.id] = Math.round(Math.min(...times)); w.close(); renderRegions(); } };
    w.onerror = () => {}; setTimeout(() => { try { w.close(); } catch (e) {} }, 8000);
  }
}
function switchServer() { if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} } playing = false; connected = false; ents.clear(); spikes.clear(); blobs.clear(); pellets.clear(); owners.clear(); myBoxes = []; connect(); }
// a sleeping free server wakes on any web request, so knock on it while the game page shows its own waiting message
let everConnected = false, firstTry = 0;
function wake() { try { fetch(serverUrl() + '/health', { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (e) {} }
function connect() {
  if (!firstTry) firstTry = performance.now();
  setStatus(everConnected ? tr('st_reconnecting') : tr('st_connecting'));
  wake();
  try { ws = new WebSocket(wsUrl()); } catch (e) { return reconnect(); }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { connAt = performance.now(); chatSeen.clear(); for (const c of chatStore) { const k = c.channel + '|' + c.name + '|' + c.text; chatSeen.set(k, (chatSeen.get(k) || 0) + 1); } connected = true; everConnected = true; retry = 0; full = false; $('wake').hidden = true; setStatus(''); ws.send(Net.enc.size(innerWidth, innerHeight, zm)); sendPing(); sendName(); sendCols(); const pc0 = cleanCode($('pty').value); if (pc0) ws.send(Net.enc.party(pc0)); };
  ws.onmessage = e => { if (typeof e.data !== 'string') handle(Net.decode(e.data, WS)); };
  ws.onclose = () => { for (const id of [...peers.keys()]) dropPeer(id); connected = false; if (playing) { playing = false; showMenu(tr('lost'), tr('lost_s')); } ents.clear(); spikes.clear(); blobs.clear(); pellets.clear(); owners.clear(); reconnect(); };
  ws.onerror = () => {};
}
function reconnect() {
  const waited = (performance.now() - firstTry) / 1000;
  if (!everConnected && waited < 120) {
    // first visit while the server is asleep: retry every 3 s and say what's happening
    $('wake').hidden = false; setStatus(tr('st_starting', { s: Math.round(waited) }));
    return setTimeout(connect, 3000);
  }
  const wait = Math.min(10000, 800 * 2 ** retry++); setStatus(tr('st_retry', { s: Math.ceil(wait / 1000) })); setTimeout(connect, wait);
}
function send(ab) { if (ws && ws.readyState === 1) ws.send(ab); }
let pingT0 = 0, pingTok = 0, ping = 0;
function sendPing() { pingT0 = performance.now(); send(Net.enc.ping(++pingTok)); }
setInterval(() => { if (connected) sendPing(); }, 2000);
function setStatus(t) { $('net').textContent = t; $('net').hidden = !t; $('go').disabled = !!t && !connected; }

function handle(m) {
  if (!m) return;
  if (m.op === 13) { for (const p of m.parts) handle(Net.decode(p, WS)); return; }
  switch (m.op) {
    case 1:
      WS = m.world; SPEED = m.speed || SPEED;
      // the server was updated since this page loaded: reload to get the new game for everyone
      if (m.build) { if (serverBuild && m.build !== serverBuild) { reloadForUpdate(); return; } serverBuild = m.build; }
      if (voiceOn) send(Net.enc.voice(0)); // reconnected: rejoin party voice
      if (watching) send(Net.enc.spec(1)); // reconnected while watching: keep watching
      break;
    case 2: myBoxes = m.ids; active = m.active; break;
    case 3: for (const o of m.list) owners.set(o.id, o); break;
    case 18: if (m.kind === 0) onRoster(m); else onVoiceSignal(m.from, m.data); break;
    case 16: if (m.fx === 0) quakeT = 2; else if (m.fx === 1) showBanner('warn'); else if (m.fx === 2) discoT = 8; else if (m.fx === 3) showBanner('chat', m);
      else if (m.fx === 4) confettiT = 3; else if (m.fx === 5) burst('snow', 8); else if (m.fx === 6) { flashT = 0.9; quakeT = Math.max(quakeT, 0.5); } else if (m.fx === 7) burst('hearts', 5); else burst('fireworks', 5); break;
    case 17: rec = m; renderRecord(); if (m.announce) { showBanner('record', m); confettiT = 3.5; if (playing && owners.get(myBoxes[0]) && m.name === ($('nm').value.trim() || tr('player'))) addXP(150); } break;
    case 15: ownerCol.clear(); ownerSkin.clear(); for (const [id, hex, skin] of m.list) { if (hex) ownerCol.set(id, { hex, txt: textFor(hex), clash: false }); if (skin < FACES.length) ownerSkin.set(id, skin); } markClashes(); break;
    case 4: {
      lastTick = performance.now(); view.x = m.vx; view.y = m.vy;
      const seen = new Set();
      for (const c of m.cells) {
        seen.add(c.id); const e = ents.get(c.id);
        if (e) {
          const dtt = (lastTick - e.lt) / 1000;
          if (dtt > 0.008 && dtt < 0.5) { const k = 0.6; e.vx = e.vx * (1 - k) + (c.x - e.tx) / dtt * k; e.vy = e.vy * (1 - k) + (c.y - e.ty) / dtt * k; }
          e.ox = e.x; e.oy = e.y; e.or = e.r; e.tx = c.x; e.ty = c.y; e.tr = c.r; e.m = c.m; e.o = c.o; e.lt = lastTick;
        }
        else ents.set(c.id, { id: c.id, o: c.o, x: c.x, y: c.y, r: c.r, ox: c.x, oy: c.y, or: c.r, tx: c.x, ty: c.y, tr: c.r, m: c.m, vx: 0, vy: 0, lt: lastTick, pux: 0, puy: 0 });
      }
      for (const id of ents.keys()) if (!seen.has(id)) ents.delete(id);
      const ss = new Set();
      for (const v of m.spikes) { ss.add(v.id); const e = spikes.get(v.id); if (e) { e.ox = e.x; e.oy = e.y; e.tx = v.x; e.ty = v.y; e.r = v.r; e.fed = v.fed; e.lt = lastTick; } else spikes.set(v.id, { x: v.x, y: v.y, tx: v.x, ty: v.y, r: v.r, fed: v.fed, rot: Math.random() * TAU, born: performance.now() }); }
      for (const [id, v] of spikes) if (!ss.has(id)) { if (!v.gone) v.gone = performance.now(); else if (performance.now() - v.gone > 300) spikes.delete(id); } else v.gone = 0;
      const bs = new Set();
      for (const b of m.blobs) {
        bs.add(b.id); const e = blobs.get(b.id);
        if (e) { const dtt = (lastTick - e.lt) / 1000; if (dtt > 0.008 && dtt < 0.5) { e.vx = (b.x - e.tx) / dtt; e.vy = (b.y - e.ty) / dtt; } e.ox = e.x; e.oy = e.y; e.tx = b.x; e.ty = b.y; e.lt = lastTick; e.ghost = 0; }
        else {
          // new blob: place it where it sits on the orb that shot it, as that orb is drawn right now
          let from = null, bd = 90; for (const o of ents.values()) { const d = Math.hypot(b.x - o.tx, b.y - o.ty) - o.tr; if (d < bd) { bd = d; from = o; } }
          // it has already flown a little before we first see it: start it just inside the edge of the orb that fed it, so it visibly comes out of that orb
          let sx = b.x, sy = b.y;
          if (from) { const dx = b.x - from.tx, dy = b.y - from.ty, d = Math.hypot(dx, dy) || 1, k = Math.max(0, from.r - BLOB_R * 0.6); sx = from.x + dx / d * k; sy = from.y + dy / d * k; }
          blobs.set(b.id, { x: sx, y: sy, ox: sx, oy: sy, tx: b.x, ty: b.y, vx: 0, vy: 0, lt: lastTick, o: b.o, ghost: 0, s: 0.55, sv: 0, d: 0, dv: 0, ang: 0 });
        }
      }
      // a blob that stopped becomes a pellet with the same id: keep drawing it until that pellet arrives
      for (const [id, b] of blobs) if (!bs.has(id) && !b.ghost) { b.ghost = lastTick; b.vx = b.vy = 0; b.ox = b.x; b.oy = b.y; b.tx = b.x; b.ty = b.y; }
      for (const f of m.added) { pellets.set(f.id, f); blobs.delete(f.id); }
      for (const id of m.removed) pellets.delete(id);
      const mine = mineCells(); let tot = 0; for (const c of mine) tot += c.m;
      if (playing && tot > peak) { if (peak > 0) { xpFrac += (tot - peak) / 200; if (xpFrac >= 1) { const w = Math.floor(xpFrac); xpFrac -= w; addXP(w); } } peak = tot; }
      break;
    }
    case 5: lb = m; break;
    case 6: mini = m; break;
    case 7: { // eaten
      playing = false; held.clear(); feedOn = false; lock = null; sq.length = 0;
      const nb = m.peak > best; if (nb) { best = m.peak; try { localStorage.setItem('gobblebest_mp', best); } catch (e) {} }
      addXP(m.kills * 15); const L = passLevel(); $('xpl').hidden = TEST; $('xpl').textContent = tr('bp_xp', { n: xpRun }) + ' · ' + tr('bp_level', { n: L.lv }) + (L.need ? ' (' + L.xp + ' / ' + L.need + ')' : '');
      $('sts').hidden = false; $('s1').textContent = dm(m.peak).toLocaleString(); $('s2').textContent = m.kills; $('s3').textContent = fmtT(m.alive);
      showMenu(tr('eaten'), nb ? tr('new_best') : tr('best_so_far', { m: dm(best).toLocaleString() })); $('go').dataset.t = 'play_again'; $('go').textContent = tr('play_again');
      break;
    }
    case 8: full = true; setStatus(tr('st_full')); break;
    case 10: addChat(m); break;
    case 11: partyCode = m.code; partyIds = new Set(m.ids); renderParty(); break;
    case 9: if (m.token === pingTok) { const p = performance.now() - pingT0; ping = ping ? Math.round(ping * 0.6 + p * 0.4) : Math.round(p); regionPing[region] = ping; } break;
  }
}
let serverBuild = '';
function reloadForUpdate() {
  showMenu(tr('updating'), tr('updating_s')); setStatus(tr('updating'));
  const u = new URL(location.href); u.searchParams.set('u', Date.now().toString(36)); // skip any cached copy of the page
  setTimeout(() => location.replace(u.toString()), 600);
}
function fmtT(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function mineCells() { const out = []; for (const e of ents.values()) if (myBoxes.includes(e.o)) out.push(e); return out; }
function activeId() { return myBoxes[active]; }

/* ---------- menu ---------- */
function showMenu(t, s) { $('ot').textContent = t; $('ot').hidden = false; delete $('os').dataset.t; $('os').textContent = s; $('ov').hidden = false; menuMode(false); }
// The main menu doubles as the pause menu: Esc during a game brings it up (server, name, party, growth, Settings)
// while the game keeps running, and Continue or Esc goes straight back.
function menuMode(inGame) {
  const go = $('go'); go.dataset.t = inGame ? 'continue' : (go.dataset.t === 'continue' ? 'play' : go.dataset.t); go.textContent = tr(go.dataset.t);
  const on = playing || watching; $('gearT').dataset.t = on ? 'menu' : 'controls'; $('gearT').textContent = tr($('gearT').dataset.t); $('gearK').hidden = !on;
}
function openMenu() {
  if (!playing && !watching) return; releaseAll(); paused = true;
  $('ot').hidden = true; $('sts').hidden = true; $('os').dataset.t = 'menu_ingame'; $('os').textContent = tr('menu_ingame');
  $('ov').hidden = false; menuMode(true); probeRegions(); renderRegions();
}
function resumeGame() { $('ov').hidden = true; paused = !$('st').hidden; menuMode(false); }
function startGame() {
  if (watchChosen) return startWatching();
  if (!connected || full) return;
  stopWatching();
  const nm = ($('nm').value.trim() || tr('player')).slice(0, 12);
  try { localStorage.setItem('gobblename', nm); } catch (e) {}
  const pc = cleanCode($('pty').value); $('pty').value = pc; try { localStorage.setItem('gobbleparty', pc); } catch (e) {}
  send(Net.enc.join(multiChosen, innerWidth, innerHeight, nm, pc, TEST)); send(Net.enc.growth(growth));
  playing = true; paused = false; peak = 0; xpRun = 0; xpFrac = 0; aliveXP = 0; $('xpl').hidden = true;
  if (!pass.welcomed && !TEST) { pass.welcomed = true; const L = passLevel(); if (L.lv < 2) setTimeout(() => addXP(needXP(1) - L.xp), 1200); else savePass(); } // first game: straight to level 2 and its reward lock = null; sq.length = 0; feedOn = false; held.clear();
  $('ov').hidden = true; menuMode(false); $('sts').hidden = true; showMultiBtns(multiChosen);
}
function showMultiBtns(on) { $('bsw').hidden = $('bfd').hidden = !on; }
function setMode(m) { // true = multibox, false = solo, 'watch' = viewer mode
  watchChosen = m === 'watch'; if (!watchChosen) multiChosen = m;
  $('mSolo').setAttribute('aria-pressed', !watchChosen && !multiChosen); $('mMulti').setAttribute('aria-pressed', !watchChosen && multiChosen); $('mWatch').setAttribute('aria-pressed', watchChosen);
  $('mbh').textContent = watchChosen ? tr('mode_watch') : multiChosen ? tr('mode_multi', { key: label(binds.swap) }) : tr('mode_solo');
  try { localStorage.setItem('gobblemb', watchChosen ? '2' : multiChosen ? '1' : '0'); } catch (e) {}
  if (!playing && !watching) { const go = $('go'); if (go.dataset.t !== 'play_again' || watchChosen) { go.dataset.t = watchChosen ? 'watch_btn' : 'play'; go.textContent = tr(go.dataset.t); } }
}
// viewer mode: no orb of your own; the camera follows a player and Space switches to the next one
function startWatching() {
  if (!connected) return; if (playing) { playing = false; myBoxes = []; }
  watching = true; paused = false; send(Net.enc.spec(1));
  $('ov').hidden = true; $('sts').hidden = true; menuMode(false); showMultiBtns(false);
}
function stopWatching() { if (!watching) return; watching = false; send(Net.enc.spec(0)); }

/* ---------- aiming, line locks, splits ---------- */
let mx = 0, my = 0, lock = null, unlockT = 0, feedOn = false, sq = [], pings = [], paused = false, listening = null;
const held = new Set(), mheld = {};
function s2w(x, y) { return { x: (x - W / 2) / cam.s + cam.x, y: (y - H / 2) / cam.s + cam.y }; }
function aimPoint() { const w = s2w(mx, my); if (lock) { if (lock.t === 'h') w.y = lock.y; else if (lock.t === 'v') w.x = lock.x; else { w.x = lock.x; w.y = lock.y; } } return w; }
let lastAim = { x: -1, y: -1, t: 0 };
function sendAim(force) {
  if (!playing) return; const w = aimPoint(), x = clamp(w.x, 0, WS), y = clamp(w.y, 0, WS), now = performance.now();
  if (!force && Math.abs(x - lastAim.x) < 2 && Math.abs(y - lastAim.y) < 2 && now - lastAim.t < 500) return;
  lastAim = { x, y, t: now }; send(Net.enc.mouse(x, y));
}
function split() { if (!playing) return; sendAim(true); send(Net.enc.split()); }
function multiSplit(n) {
  if (!playing || paused) return; split();
  for (let i = 1; i < n; i++) { if (pd <= 0) split(); else sq.push(i * pd / 1000); }
  if (lock && mal) unlockT = Math.max(unlockT, (n - 1) * pd / 1000 + 0.12);
}
// popsplit: a double split with a longer pause, so the target can swallow your first piece (and burst on a
// needle next to it) before your second piece arrives to eat what's left
function popSplit() { if (!playing || paused) return; split(); sq.push(ppd / 1000); if (lock && mal) unlockT = Math.max(unlockT, ppd / 1000 + 0.12); }
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
    case 'psplit': if (down) popSplit(); break;
    case 'tsplit': if (down) multiSplit(3); break;
    case 'qsplit': if (down) multiSplit(4); break;
    case 'eject': sendAim(); if (ftg) { if (down) { feedOn = !feedOn; setEject(feedOn); } } else setEject(down); break;
    case 'feed': send(Net.enc.feed(down, rf)); break;
    case 'hline': lineKey('h', down); break;
    case 'vline': lineKey('v', down); break;
    case 'fline': lineKey('f', down); break;
    case 'respawn': if (down) send(Net.enc.respawn()); break;
    case 'ping': if (down) { const w = s2w(mx, my); pings.push({ x: w.x, y: w.y, t: 3 }); if (pings.length > 5) pings.shift(); } break;
    case 'ptt': pttDown = down; applyMic(); break;
    case 'zin': if (down) setZoom(zm * 1.3); break;
    case 'zout': if (down) setZoom(zm / 1.3); break;
    case 'fx_quake': case 'fx_warn': case 'fx_disco': case 'fx_chat': case 'fx_confetti': case 'fx_snow': case 'fx_flash': case 'fx_hearts': case 'fx_fireworks':
      if (down) { if (fxUnlocked(k)) send(Net.enc.effect(FX_IDS.indexOf(k))); else toast('🔒 ' + tr('bp_locked', { n: fxLevel(k) })); } break;
    case 'swap': if (down && multiChosen) { const w = aimPoint(); send(Net.enc.swap(clamp(w.x, 0, WS), clamp(w.y, 0, WS))); } break;
  }
}

/* ---------- drawing ---------- */
// graphics quality: how many pixels the arena is drawn with. 'auto' lowers it by itself when the computer can't keep up
let gq = 'auto', autoScale = 1, slowSecs = 0;
try { gq = localStorage.getItem('gobblegq') || 'auto'; } catch (e) {}
function renderScale() { return gq === 'high' ? 1 : gq === 'medium' ? 0.8 : gq === 'low' ? 0.6 : autoScale; }
function resize() { dpr = Math.min(1.25, window.devicePixelRatio || 1) * renderScale(); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); if (connected) send(Net.enc.size(W, H, zm)); }
addEventListener('resize', resize); resize();
function camera(dt) {
  const mine = playing ? mineCells() : [];
  let cx = view.x, cy = view.y, sm = 1600, ext = 0;
  if (mine.length) { let sx = 0, sy = 0; sm = 0; for (const c of mine) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; } cx = sx / sm; cy = sy / sm; for (const c of mine) ext = Math.max(ext, Math.hypot(c.x - cx, c.y - cy) + c.r); }
  else if (watching) { // the server centres the view on the player being watched: size the zoom to that player
    let big = null, bd = 1e9; for (const e of ents.values()) { const d = Math.hypot(e.x - cx, e.y - cy) - e.r; if (d < bd || (d < 0 && big && e.m > big.m)) { bd = d; big = e; } }
    if (big) { sm = 0; for (const e of ents.values()) if (e.o === big.o) { sm += e.m; ext = Math.max(ext, Math.hypot(e.x - cx, e.y - cy) + e.r); } }
  }
  const base = clamp(Math.min(W, H) / 600, 0.7, 1.4) * 1.35;
  const sN = Math.min(base / (1 + Math.sqrt(sm) / 26), Math.min(W, H) * 0.45 / (ext + 80)) * (watching && !mine.length ? 0.55 : 1), fit = Math.min(W, H) / (WS * 2.1), s = Math.max(fit, sN * zm);
  const vs = VIEW_SCALE / Math.min(1, zm); cam.v = [cx - W / 2 / sN * vs, cx + W / 2 / sN * vs, cy - H / 2 / sN * vs, cy + H / 2 / sN * vs];
  const pr = mine.length ? (dd <= 0 ? smooth(dt * 30) : smooth(dt / Math.max(0.025, dd / 1000 * 0.9))) : smooth(dt * 3); cam.x += (cx - cam.x) * pr; cam.y += (cy - cam.y) * pr; cam.s += (s - cam.s) * smooth(dt * 3);
}
function drawSpike(v) {
  const R = v.r; if (v.gone) return; // a needle that left simply disappears
  drawSpikeBody(v, R);
  g.globalAlpha = 1;
}
function drawSpikeBody(v, R) {
  if (R * cam.s < 6) { const q = Math.max(R, 4 / cam.s); g.fillStyle = '#ffd23f'; g.beginPath(); for (let i = 0; i <= 16; i++) { const a = i / 16 * TAU + v.rot, r = i % 2 ? q * 0.75 : q * 1.15; i ? g.lineTo(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r) : g.moveTo(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r); } g.closePath(); g.fill(); return; }
  g.beginPath(); for (let i = 0; i <= 32; i++) { const a = i / 32 * TAU + v.rot, r = i % 2 ? R * 0.9 : R * 1.04; i ? g.lineTo(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r) : g.moveTo(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r); }
  g.closePath(); g.fillStyle = 'rgba(255,210,63,.94)'; g.fill(); g.strokeStyle = '#a8790f'; g.lineWidth = Math.max(3, R * 0.06); g.stroke();
}
if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); }; // older browsers
/* ---------- bot stickers: 12 original cartoon faces, each a complete sticker (white die-cut edge, shaded body,
   gloss and shadow). Drawn once into small images at load and reused every frame, so they cost almost nothing. ---------- */
const STICK = 1.16; // a sticker image is this many times the orb's radius (the extra is its shadow margin)
const FACES = (() => {
  const out = [], K = '#22151a', TONGUE = '#ff5f7e';
  const dot = (f, x, y, r, c) => { f.fillStyle = c || K; f.beginPath(); f.arc(x, y, r, 0, TAU); f.fill(); };
  const oval = (f, x, y, rx, ry, c) => { f.fillStyle = c || K; f.beginPath(); f.ellipse(x, y, rx, ry, 0, 0, TAU); f.fill(); };
  const gloss = (f, x, y, s) => { dot(f, x - s * 0.35, y - s * 0.4, s * 0.32, '#fff'); dot(f, x + s * 0.3, y + s * 0.3, s * 0.14, '#fff'); };
  const bigEye = (f, x, y, rx, ry) => { oval(f, x, y, rx, ry); gloss(f, x, y, rx); };
  const whiteEye = (f, x, y, r, px, py) => { oval(f, x, y, r, r * 1.08, '#fff'); f.lineWidth = 0.035; f.strokeStyle = K; f.stroke(); bigEye(f, x + px * r * 0.45, y + py * r * 0.45, r * 0.5, r * 0.55); };
  const stroke = (f, w) => { f.lineWidth = w; f.strokeStyle = K; f.stroke(); };
  const arc = (f, x, y, r, a, b, w) => { f.beginPath(); f.arc(x, y, r, a * Math.PI, b * Math.PI); stroke(f, w || 0.07); };
  const line = (f, p, w) => { f.beginPath(); f.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) f.lineTo(p[i], p[i + 1]); stroke(f, w || 0.07); };
  const blush = (f, y, a) => { f.fillStyle = 'rgba(255,90,120,' + (a || 0.38) + ')'; f.beginPath(); f.ellipse(-0.56, y, 0.16, 0.1, 0, 0, TAU); f.ellipse(0.56, y, 0.16, 0.1, 0, 0, TAU); f.fill(); };
  const openMouth = (f, x, y, w, h, tongue) => { f.save(); f.beginPath(); f.moveTo(x - w, y); f.quadraticCurveTo(x, y + h * 2, x + w, y); f.closePath(); f.fillStyle = K; f.fill(); f.clip(); if (tongue) oval(f, x + w * 0.15, y + h * 1.25, w * 0.55, h * 0.6, TONGUE); f.restore(); };
  const designs = [
    ['#ffcf3a', f => { bigEye(f, -0.3, -0.16, 0.11, 0.16); bigEye(f, 0.3, -0.16, 0.11, 0.16); openMouth(f, 0, 0.16, 0.36, 0.22, true); blush(f, 0.12); }],                       // sunny
    ['#8bd346', f => { line(f, [-0.5, -0.56, -0.18, -0.6], 0.06); line(f, [0.16, -0.58, 0.5, -0.5], 0.06); whiteEye(f, -0.3, -0.22, 0.24, 0.5, 0.3); whiteEye(f, 0.32, -0.18, 0.19, -0.5, 0.5); oval(f, 0, 0.38, 0.1, 0.12); }], // googly
    ['#6ec6ff', f => { arc(f, -0.3, -0.18, 0.15, 0.05, 0.95, 0.07); arc(f, 0.3, -0.18, 0.15, 0.05, 0.95, 0.07); line(f, [-0.42, -0.08, -0.47, 0.0], 0.04); line(f, [0.42, -0.08, 0.47, 0.0], 0.04); oval(f, 0.05, 0.32, 0.1, 0.07); f.fillStyle = '#fff'; f.font = '900 0.34px sans-serif'; f.fillText('z', 0.5, -0.55); f.font = '900 0.24px sans-serif'; f.fillText('z', 0.7, -0.76); }], // sleepy
    ['#ff5a4e', f => { line(f, [-0.6, -0.5, -0.14, -0.3], 0.09); line(f, [0.6, -0.5, 0.14, -0.3], 0.09); bigEye(f, -0.3, -0.12, 0.1, 0.11); bigEye(f, 0.3, -0.12, 0.1, 0.11); arc(f, 0, 0.68, 0.36, 1.22, 1.78, 0.085); }], // grumpy
    ['#a46bff', f => { f.fillStyle = K; f.beginPath(); f.roundRect(-0.72, -0.44, 0.62, 0.36, 0.14); f.roundRect(0.1, -0.44, 0.62, 0.36, 0.14); f.fill(); line(f, [-0.12, -0.34, 0.12, -0.34], 0.07); f.strokeStyle = 'rgba(255,255,255,.75)'; f.lineWidth = 0.05; f.beginPath(); f.moveTo(-0.6, -0.36); f.lineTo(-0.45, -0.36); f.moveTo(0.22, -0.36); f.lineTo(0.37, -0.36); f.stroke(); arc(f, 0.12, 0.1, 0.32, 0.15, 0.6, 0.08); }], // cool
    ['#ff9a3c', f => { arc(f, -0.3, -0.1, 0.13, 1.1, 1.9, 0.08); bigEye(f, 0.3, -0.16, 0.11, 0.16); openMouth(f, -0.02, 0.14, 0.34, 0.2, true); oval(f, 0.1, 0.42, 0.13, 0.15, TONGUE); blush(f, 0.14); }], // silly wink
    ['#3fd6b4', f => { whiteEye(f, 0, -0.2, 0.33, 0, 0.35); f.fillStyle = K; f.beginPath(); f.roundRect(-0.4, 0.24, 0.8, 0.27, 0.12); f.fill(); f.fillStyle = '#fff'; for (let i = 0; i < 5; i++) f.fillRect(-0.33 + i * 0.135, 0.26, 0.1, 0.1); }], // cyclops
    ['#ff6fae', f => { whiteEye(f, -0.3, -0.2, 0.19, 0, 0); whiteEye(f, 0.3, -0.2, 0.19, 0, 0); oval(f, 0, 0.36, 0.15, 0.2); line(f, [-0.48, -0.5, -0.2, -0.56], 0.06); line(f, [0.2, -0.56, 0.48, -0.5], 0.06); }], // shocked
    ['#ffb070', f => { bigEye(f, -0.3, -0.18, 0.1, 0.13); bigEye(f, 0.3, -0.18, 0.1, 0.13); f.fillStyle = TONGUE; f.beginPath(); f.moveTo(-0.08, 0.02); f.lineTo(0.08, 0.02); f.lineTo(0, 0.11); f.fill(); arc(f, -0.1, 0.15, 0.1, 0, 1, 0.06); arc(f, 0.1, 0.15, 0.1, 0, 1, 0.06); for (const s of [-1, 1]) { line(f, [s * 0.32, 0.08, s * 0.78, -0.02], 0.035); line(f, [s * 0.32, 0.17, s * 0.78, 0.22], 0.035); } blush(f, 0.08, 0.3); }], // cat
    ['#7ed957', f => { line(f, [-0.52, -0.44, -0.16, -0.34], 0.07); line(f, [0.52, -0.44, 0.16, -0.34], 0.07); bigEye(f, -0.3, -0.16, 0.1, 0.12); bigEye(f, 0.3, -0.16, 0.1, 0.12); arc(f, 0, -0.04, 0.46, 0.2, 0.8, 0.08); f.fillStyle = '#fff'; f.strokeStyle = K; f.lineWidth = 0.03; for (const s of [-1, 1]) { f.beginPath(); f.moveTo(s * 0.1, 0.38); f.lineTo(s * 0.27, 0.35); f.lineTo(s * 0.2, 0.56); f.closePath(); f.fill(); f.stroke(); } }], // vampire
    ['#ff8fa3', f => { arc(f, -0.3, -0.1, 0.13, 1.05, 1.95, 0.08); arc(f, 0.3, -0.1, 0.13, 1.05, 1.95, 0.08); blush(f, 0.12, 0.6); arc(f, 0, 0.16, 0.12, 0.15, 0.85, 0.06); }], // shy
    ['#4dd9e8', f => { for (const x of [-0.3, 0.3]) { line(f, [x - 0.12, -0.32, x + 0.12, -0.08], 0.08); line(f, [x + 0.12, -0.32, x - 0.12, -0.08], 0.08); } f.beginPath(); f.moveTo(-0.34, 0.3); f.quadraticCurveTo(-0.17, 0.14, 0, 0.3); f.quadraticCurveTo(0.17, 0.46, 0.34, 0.3); stroke(f, 0.075); f.fillStyle = '#ffe14d'; for (const [x, y] of [[-0.62, -0.62], [0.66, -0.5]]) { f.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? 0.05 : 0.12; f.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } f.fill(); } }], // dizzy
  ];
  for (const [col, d] of designs) {
    const S = 256, U = S / 2 / STICK, cv2 = document.createElement('canvas'); cv2.width = cv2.height = S; const f = cv2.getContext('2d');
    f.translate(S / 2, S / 2); f.scale(U, U); f.lineCap = f.lineJoin = 'round'; f.textAlign = 'center'; f.textBaseline = 'middle';
    f.save(); f.shadowColor = 'rgba(0,0,0,.5)'; f.shadowBlur = U * 0.1; f.shadowOffsetY = U * 0.05; dot(f, 0, 0, 1, '#fff'); f.restore(); // die-cut white edge
    const gr = f.createRadialGradient(-0.3, -0.35, 0.1, 0, 0, 0.92); gr.addColorStop(0, '#fff'); gr.addColorStop(0.08, col); gr.addColorStop(1, col);
    dot(f, 0, 0, 0.9, col); f.save(); f.globalAlpha = 0.28; dot(f, 0, 0, 0.9, gr); f.restore();
    f.save(); f.beginPath(); f.arc(0, 0, 0.9, 0, TAU); f.clip(); f.fillStyle = 'rgba(0,0,0,.16)'; f.beginPath(); f.arc(0.12, 0.16, 0.92, 0, TAU); f.arc(-0.06, -0.08, 0.86, 0, TAU, true); f.fill('evenodd'); f.restore(); // shaded lower edge
    d(f);
    f.fillStyle = 'rgba(255,255,255,.35)'; f.beginPath(); f.ellipse(-0.4, -0.55, 0.22, 0.1, -0.6, 0, TAU); f.fill(); // gloss
    // the same face without the sticker body: player skins are drawn on top of the player's own colour, so they
    // never look like bots and multibox players still see their active/other colours
    const fc = document.createElement('canvas'); fc.width = fc.height = S; const h = fc.getContext('2d');
    h.translate(S / 2, S / 2); h.scale(U, U); h.lineCap = h.lineJoin = 'round'; h.textAlign = 'center'; h.textBaseline = 'middle';
    h.save(); h.beginPath(); h.arc(0, 0, 0.9, 0, TAU); h.clip(); h.fillStyle = 'rgba(0,0,0,.14)'; h.beginPath(); h.arc(0.12, 0.16, 0.92, 0, TAU); h.arc(-0.06, -0.08, 0.86, 0, TAU, true); h.fill('evenodd'); h.restore();
    d(h); h.fillStyle = 'rgba(255,255,255,.3)'; h.beginPath(); h.ellipse(-0.4, -0.55, 0.22, 0.1, -0.6, 0, TAU); h.fill();
    out.push({ img: cv2, face: fc, col });
  }
  return out;
})();
function drawOrb(c, multi) {
  const mineC = myBoxes.includes(c.o), ow = owners.get(c.o), R = c.r;
  const box = multi && mineC, act = box && c.o === activeId(), oc = !mineC && ownerCol.get(c.o);
  const skin = mineC ? pass.skin : ownerSkin.has(c.o) ? ownerSkin.get(c.o) : -1;
  let tx = box && !ring ? (act ? txtA : txtI) : oc && !oc.clash ? oc.txt : null;
  g.fillStyle = ownerFill(c.o);
  if (skin >= 0 && R * cam.s > 7 && discoT <= 0) { // battle pass skin: the face drawn on the player's own colour (no sticker edge, so never mistaken for a bot)
    g.beginPath(); g.arc(c.x, c.y, R, 0, TAU); g.fill();
    if (ring && act) { g.lineWidth = Math.max(2.5 / cam.s, R * 0.07); g.strokeStyle = '#fff'; g.stroke(); }
    const k = R * STICK / 0.9; g.drawImage(FACES[skin].face, c.x - k, c.y - k, k * 2, k * 2);
    return drawName(c, ow, R, tx || { name: '#fff', mass: 'rgba(255,255,255,.45)', stroke: true });
  }
  const st = faces && ow && !ow.human ? FACES[ow.id % FACES.length] : null;
  if (st && R * cam.s > 7 && discoT <= 0) g.drawImage(st.img, c.x - R * STICK, c.y - R * STICK, R * 2 * STICK, R * 2 * STICK); // bots are stickers
  else { if (st) g.fillStyle = st.col; g.beginPath(); g.arc(c.x, c.y, R, 0, TAU); g.fill(); }
  if (ring && act) { g.beginPath(); g.arc(c.x, c.y, R, 0, TAU); g.lineWidth = Math.max(2.5 / cam.s, R * 0.07); g.strokeStyle = '#fff'; g.stroke(); } // white ring on the orb you control
  drawName(c, ow, R, tx);
}
function drawName(c, ow, R, tx) {
  if (R * cam.s > 18) {
    const fs = Math.max(12, R * 0.34), name = ow ? ow.name : '', px = fs * cam.s;
    g.globalAlpha = 0.55; // names and mass are see-through so faces and colours show through
    // names are drawn once into a small cached image and then just stamped, which is far cheaper than drawing text every frame
    if (name) { const sp = textSprite(name, px * dpr, 800, tx ? tx.name : '#fff', px >= 16 && (!tx || tx.stroke)), k = fs / sp.px; g.drawImage(sp.c, c.x - sp.w * k / 2, c.y - sp.h * k / 2, sp.w * k, sp.h * k); }
    if (px * 0.45 >= 7) { const ms = fs * 0.45; g.font = '700 ' + Math.round(ms * 4) / 4 + "px 'Bricolage Grotesque',system-ui,sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = tx ? tx.mass : 'rgba(255,255,255,.38)'; g.fillText(String(dm(c.m)), c.x, c.y + fs * 0.72); }
    g.globalAlpha = 1;
  }
}
// cached text images: one per name, colour and size step (sizes go up in ~12% steps, so zooming reuses them)
const txtCache = new Map();
function textSprite(str, devPx, weight, fill, stroke) {
  const b = Math.max(8, Math.round(Math.pow(2, Math.round(Math.log2(devPx) * 6) / 6)));
  const key = b + '|' + fill + '|' + (stroke ? 1 : 0) + '|' + weight + '|' + str;
  let sp = txtCache.get(key);
  if (sp) return sp;
  const font = weight + ' ' + b + "px 'Bricolage Grotesque',system-ui,sans-serif", pad = Math.ceil(b * 0.2);
  g.font = font; const w = Math.ceil(g.measureText(str).width) + pad * 2, h = Math.ceil(b * 1.35) + pad;
  const cv2 = document.createElement('canvas'); cv2.width = w; cv2.height = h; const t = cv2.getContext('2d');
  t.font = font; t.textAlign = 'center'; t.textBaseline = 'middle'; t.lineJoin = 'round';
  if (stroke) { t.lineWidth = b * 0.14; t.strokeStyle = 'rgba(0,0,0,.45)'; t.strokeText(str, w / 2, h / 2); }
  t.fillStyle = fill; t.fillText(str, w / 2, h / 2);
  sp = { c: cv2, w, h, px: b }; txtCache.set(key, sp);
  if (txtCache.size > 500) txtCache.delete(txtCache.keys().next().value); // forget the oldest
  return sp;
}
const fb = Array.from({ length: 12 }, () => []), ejb = new Map(), BLOB_R = 23; // fed blobs look bigger than their real size (16)
function draw(dt) {
  const k = dd <= 0 ? 1 : smooth(dt / (dd / 1000 * 0.6)), now = performance.now(), aid = playing ? activeId() : -1, aim = playing ? aimPoint() : null;
  for (const e of ents.values()) {
    // draw delay: glide in a straight line from where the orb was drawn to its new position over dd milliseconds
    const since = now - e.lt, p = dd <= 0 ? 1 : Math.min(1, since / dd), over = Math.min(0.12, Math.max(0, since - Math.max(dd, 34)) / 1000);
    e.x = e.ox + (e.tx - e.ox) * p + e.vx * over; e.y = e.oy + (e.ty - e.oy) * p + e.vy * over; e.r = e.or + (e.tr - e.or) * p;
    if (false) { // (local prediction switched off: it made orbs look closer or safer than they were)
      // your own orb: move it locally toward the mouse right away, then pull it gently onto where the server has it
      const lat = Math.min(0.3, ping / 2000 + age), sx = e.tx + e.vx * lat, sy = e.ty + e.vy * lat;
      let dx = aim.x - e.x, dy = aim.y - e.y; const d = Math.hypot(dx, dy); let dvx = 0, dvy = 0;
      if (d > 2) { const s = SPEED * Math.pow(e.m, -0.25) * Math.min(1, d / (e.r + 20)); dvx = dx / d * s; dvy = dy / d * s; }
      const kk = Math.min(1, dt * 7); e.pux += (dvx - e.pux) * kk; e.puy += (dvy - e.puy) * kk;
      e.x += e.pux * dt; e.y += e.puy * dt;
      const ex = sx - e.x, ey = sy - e.y, err = Math.hypot(ex, ey), c = smooth(dt * (err > e.r * 0.5 ? 14 : 4));
      e.x += ex * c; e.y += ey * c;
    }
  }
  for (const v of spikes.values()) { const p = dd <= 0 || v.ox === undefined ? 1 : Math.min(1, (now - v.lt) / dd); if (v.ox !== undefined) { v.x = v.ox + (v.tx - v.ox) * p; v.y = v.oy + (v.ty - v.oy) * p; }
    // needles stay perfectly still; they only turn while sliding after being shot or while something passes through
        // (needles never animate)
  }
  for (const [id, b] of blobs) {
    if (b.ghost && now - b.ghost > 250) { blobs.delete(id); continue; }
    const since = now - b.lt, p = dd <= 0 ? 1 : Math.min(1, since / dd), over = Math.min(0.1, Math.max(0, since - Math.max(dd, 34)) / 1000);
    b.x = b.ox + (b.tx - b.ox) * p + b.vx * over; b.y = b.oy + (b.ty - b.oy) * p + b.vy * over;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = discoT > 0 ? 'hsl(' + ((T * 200) % 360 | 0) + ' 45% ' + (8 + 5 * Math.abs(Math.sin(T * 9))).toFixed(1) + '%)' : '#111'; g.fillRect(0, 0, W, H);
  if (discoT > 0) discoT -= dt;
  g.save(); g.translate(W / 2, H / 2);
  if (quakeT > 0) { quakeT -= dt; const a = 22 * Math.min(1, quakeT); g.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a); g.rotate((Math.random() - 0.5) * 0.012 * Math.min(1, quakeT)); }
  g.scale(cam.s, cam.s); g.translate(-cam.x, -cam.y);
  const hw = W / 2 / cam.s, hh = H / 2 / cam.s;
  let x0 = Math.max(cam.x - hw, cam.v[0]), x1 = Math.min(cam.x + hw, cam.v[1]), y0 = Math.max(cam.y - hh, cam.v[2]), y1 = Math.min(cam.y + hh, cam.v[3]);
  g.strokeStyle = '#333'; g.lineWidth = 6 / cam.s; g.strokeRect(0, 0, WS, WS);
  // pellets
  const fr = rad(3), psz = fr * cam.s;
  if (psz > 0.35) {
    for (const b of fb) b.length = 0;
    ejb.clear();
    for (const f of pellets.values()) if (f.x > x0 - 20 && f.x < x1 + 20 && f.y > y0 - 20 && f.y < y1 + 20) { if (f.ej) { const k = owners.has(f.o) || ownerCol.has(f.o) ? ownerFill(f.o) : 'hsl(' + f.hb * 30 + ' 70% 60%)'; let a = ejb.get(k); if (!a) ejb.set(k, a = []); a.push(f); } else fb[f.hb % 12].push(f); }
    for (const [k, a] of ejb) { g.fillStyle = k; g.beginPath(); for (const f of a) { if (BLOB_R * cam.s < 2.2) g.rect(f.x - BLOB_R * 0.85, f.y - BLOB_R * 0.85, BLOB_R * 1.7, BLOB_R * 1.7); else { g.moveTo(f.x + BLOB_R, f.y); g.arc(f.x, f.y, BLOB_R, 0, TAU); } } g.fill(); }
    for (let h = 0; h < 12; h++) {
      const a = fb[h]; if (!a.length) continue; g.fillStyle = 'hsl(' + h * 30 + ' 70% 60%)'; g.beginPath();
      for (const f of a) { const rr = f.ej ? BLOB_R : fr; if (rr * cam.s < 2.2) g.rect(f.x - rr * 0.85, f.y - rr * 0.85, rr * 1.7, rr * 1.7); else { g.moveTo(f.x + rr, f.y); g.arc(f.x, f.y, rr, 0, TAU); } }
      g.fill();
    }
  }
  // fed blobs are drawn like little rubber jelly balls: they pop out with a bounce, stretch along their flight
  // and wobble a few times when they land (springs, purely visual; the real size and mass are unchanged)
  const jd = Math.min(dt, 0.033);
  for (const [id, b] of blobs) {
    if (pellets.has(id)) continue;
    const sp = Math.hypot(b.vx, b.vy), td = Math.min(0.16, sp / 6000); // only a slight stretch, so neighbours don't run into each other
    if (sp > 30) b.ang = Math.atan2(b.vy, b.vx);
    b.dv += (300 * (td - b.d) - 9 * b.dv) * jd; b.d = clamp(b.d + b.dv * jd, -0.35, 0.6);
    b.sv += (260 * (1 - b.s) - 8 * b.sv) * jd; b.s += b.sv * jd;
    if (b.x < x0 - 30 || b.x > x1 + 30 || b.y < y0 - 30 || b.y > y1 + 30) continue;
    const r = BLOB_R * b.s; g.fillStyle = ownerFill(b.o); g.beginPath(); g.ellipse(b.x, b.y, r * (1 + b.d), r / (1 + b.d), b.ang, 0, TAU); g.fill();
  }
  // orbs, small first
  const list = []; for (const e of ents.values()) if (!(e.x < x0 - e.r || e.x > x1 + e.r || e.y < y0 - e.r || e.y > y1 + e.r)) list.push(e);
  list.sort((a, b) => a.m - b.m);
  const multi = myBoxes.length > 1;
  if (lines && playing && aim) { // a thin line from each orb you control to the mouse
    const a = activeId(); g.beginPath();
    for (const c of list) if (c.o === a) { g.moveTo(c.x, c.y); g.lineTo(aim.x, aim.y); }
    g.strokeStyle = 'rgba(190,190,205,.5)'; g.lineWidth = 1.5 / cam.s; g.stroke();
  }
  // needles are drawn under every orb, so an orb rolling onto one covers it, as if the needle goes inside
  for (const v of spikes.values()) if (!(v.x < x0 - v.r || v.x > x1 + v.r || v.y < y0 - v.r || v.y > y1 + v.r)) drawSpike(v);
  for (const c of list) drawOrb(c, multi);
  if (playing && lock) {
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2 / cam.s; g.setLineDash([10 / cam.s, 8 / cam.s]); g.beginPath();
    if (lock.t === 'h') { g.moveTo(Math.max(0, x0), lock.y); g.lineTo(Math.min(WS, x1), lock.y); }
    else if (lock.t === 'v') { g.moveTo(lock.x, Math.max(0, y0)); g.lineTo(lock.x, Math.min(WS, y1)); }
    else { const q = 14 / cam.s; g.moveTo(lock.x - q, lock.y); g.lineTo(lock.x + q, lock.y); g.moveTo(lock.x, lock.y - q); g.lineTo(lock.x, lock.y + q); }
    g.stroke(); g.setLineDash([]);
  }
  for (const p of pings) { const a = clamp(p.t, 0, 1), r = (16 + ((3 - p.t) % 1) * 34) / cam.s; g.strokeStyle = 'rgba(255,210,90,' + a + ')'; g.lineWidth = 3 / cam.s; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.stroke(); }
  g.restore();
  if (confettiT > 0 || confetti.length) drawConfetti(dt);
  if (fxParts.length || parts.length || flashT > 0) drawParts(dt);
}
let mmT = 0;
function drawMM() {
  const s = mm.clientWidth; if (!s) return; if (mm.width !== Math.round(s * dpr)) mm.width = mm.height = Math.round(s * dpr);
  mg.setTransform(dpr, 0, 0, dpr, 0, 0); mg.clearRect(0, 0, s, s); const k = s / WS, cw = s / 5;
  mg.strokeStyle = 'rgba(255,255,255,.14)'; mg.lineWidth = 1; mg.beginPath();
  for (let i = 1; i < 5; i++) { mg.moveTo(i * cw, 0); mg.lineTo(i * cw, s); mg.moveTo(0, i * cw); mg.lineTo(s, i * cw); } mg.stroke();
  mg.fillStyle = 'rgba(255,255,255,.3)'; mg.font = '700 ' + Math.max(8, cw * 0.2) + "px 'Bricolage Grotesque',system-ui,sans-serif"; mg.textAlign = 'left'; mg.textBaseline = 'top';
  for (let r = 0; r < 5; r++) for (let q = 0; q < 5; q++) mg.fillText('ABCDE'[r] + (q + 1), q * cw + 3, r * cw + 3);
  mg.fillStyle = 'rgba(255,210,63,.6)'; for (const v of mini.spikes) { mg.beginPath(); mg.arc(v.x * k, v.y * k, 1.6, 0, TAU); mg.fill(); }
  let me = 0; for (const c of mineCells()) me += c.m;
  for (const c of mini.big) { if (myBoxes.includes(c.o)) continue; mg.fillStyle = playing && c.r * c.r / 16 > me * 1.25 ? '#d9534f' : '#8fa8a2'; mg.beginPath(); mg.arc(c.x * k, c.y * k, Math.max(2, c.r * k), 0, TAU); mg.fill(); }
  // other real players: a gold ring so you can go and find them
  mg.font = '700 9px system-ui,sans-serif'; mg.textAlign = 'center'; mg.textBaseline = 'bottom';
  for (const p of mini.people || []) {
    if (myBoxes.includes(p.o)) continue; const x = p.x * k, y = p.y * k, ow = owners.get(p.o), mate = partyIds.has(p.o);
    mg.strokeStyle = mate ? 'hsl(' + partyHue() + ' 85% 62%)' : '#ffd25a'; mg.lineWidth = 2; mg.beginPath(); mg.arc(x, y, 3.5, 0, TAU); mg.stroke();
    if (ow && (s >= 140 || mate)) { mg.fillStyle = mate ? 'hsl(' + partyHue() + ' 85% 70%)' : 'rgba(255,210,90,.85)'; mg.fillText(ow.name.slice(0, 10), x, y - 5); }
  }
  const multi = myBoxes.length > 1;
  for (const c of mineCells()) { mg.fillStyle = !multi ? '#2a9a83' : c.o === activeId() ? colA : colI; mg.beginPath(); mg.arc(c.x * k, c.y * k, Math.max(2.5, c.r * k), 0, TAU); mg.fill(); }
  for (const p of pings) { mg.fillStyle = '#ffd25a'; mg.beginPath(); mg.arc(p.x * k, p.y * k, 4, 0, TAU); mg.fill(); }
}
function hud() {
  const mine = mineCells(); let tot = 0, sx = 0, sy = 0, sm = 0;
  for (const c of mine) { tot += c.m; if (c.o === activeId()) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; } }
  $('sc').textContent = dm(tot).toLocaleString(); $('bs').textContent = dm(Math.max(best, peak)).toLocaleString();
  $('rk').textContent = playing && lb.rank ? lb.rank + ' / ' + lb.total : '–';
  $('sec').textContent = playing && sm ? 'ABCDE'[clamp(Math.floor(sy / sm / WS * 5), 0, 4)] + (clamp(Math.floor(sx / sm / WS * 5), 0, 4) + 1) : '–';
  const multi = myBoxes.length > 1, ao = owners.get(activeId());
  $('ct').textContent = watching && !playing ? tr('watch_hint') : playing && multi && ao ? tr('controlling', { name: ao.name, key: label(binds.swap) }) : '';
  const ol = $('lb'); ol.textContent = '';
  const row = (id, m, i) => { const li = document.createElement('li'); li.value = i + 1; const o = owners.get(id); li.textContent = (o ? o.name : '…') + ' · ' + dm(m).toLocaleString(); if (myBoxes.includes(id)) li.className = 'me'; ol.appendChild(li); };
  lb.top.slice(0, 6).forEach((t, i) => row(t.id, t.m, i));
  if (playing && lb.rank > 6) { const li = document.createElement('li'); li.className = 'gap'; li.textContent = '…'; ol.appendChild(li); const li2 = document.createElement('li'); li2.value = lb.rank; li2.className = 'me'; li2.textContent = tr('you') + ' · ' + dm(tot).toLocaleString(); ol.appendChild(li2); }
  const who = lb.players >= 0 ? tr('players_bots', { p: lb.players, b: lb.bots }) : tr('in_arena', { n: lb.total });
  $('pc').textContent = connected ? who : ''; $('live').hidden = !(connected && playing && lb.players >= 0); $('livet').textContent = who; $('onl').textContent = connected && lb.players >= 0 ? tr('hud_online', { p: lb.players, b: lb.bots }) : '–';
  $('png').textContent = connected && ping ? ping + ' ms' : '–';
  $('fpsv').textContent = fps + ' / ' + hz; if (!$('st').hidden) $('gqnow').textContent = Math.round(renderScale() * 100) + '%'; if (!$('st').hidden) $('fpsnow').textContent = fps + ' FPS · ' + tr('fps_screen', { n: hz });
  if (!$('ov').hidden) renderRegions();
}

/* ---------- loop ---------- */
let last = performance.now(), ht = 0, aimT = 0;
// The browser calls us once per monitor refresh. We time those calls to find the monitor's real
// refresh rate (60, 75, 120, 144, 165, 240 Hz...), count the frames we actually draw each second,
// and skip refreshes when a lower limit is picked.
const RATES = [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 280, 300, 360, 480, 500];
let hz = 60, fps = 0, fN = 0, fT = 0, rawPrev = 0, nextDraw = 0; const gaps = [];
function snapHz(v) { let b = v; for (const r of RATES) if (Math.abs(r - v) / r < 0.04) { b = r; break; } return Math.round(b); }
function frame(t) {
  requestAnimationFrame(frame);
  if (rawPrev) { const gap = t - rawPrev; if (gap > 1 && gap < 60) { gaps.push(gap); if (gaps.length > 120) gaps.shift(); } }
  rawPrev = t;
  // a slow computer can miss refreshes, so use the quicker gaps and only ever raise the estimate
  if (gaps.length >= 30 && fN === 0) { const s = gaps.slice().sort((a, b) => a - b), nh = snapHz(1000 / s[s.length >> 2]); if (nh > hz) { hz = nh; if (!$('st').hidden) renderSettings(); } }
  if (fcap > 0 && fcap < hz - 1) {
    const iv = 1000 / fcap, half = 500 / hz;
    if (t < nextDraw - half) return;
    nextDraw = t - nextDraw > iv ? t + iv : nextDraw + iv;
  }
  fN++; if (t - fT >= 500) { fps = Math.round(fN * 1000 / (t - fT)); fN = 0; fT = t;
    // auto quality: if the game runs well below the screen's speed for a few seconds, draw with fewer pixels
    if (gq === 'auto' && playing && document.visibilityState === 'visible') {
      if (fps < Math.min(hz, 144) * 0.75) slowSecs += 0.5; else slowSecs = Math.max(0, slowSecs - 0.25);
      if (slowSecs >= 3 && autoScale > 0.55) { autoScale = Math.max(0.55, autoScale - 0.15); slowSecs = 0; resize(); }
    } }
  const dt = clamp((t - last) / 1000, 0, 0.1); last = t; T += dt;
  if (playing) { aliveXP += dt; if (aliveXP >= 60) { aliveXP -= 60; addXP(20); } } // 20 XP for every minute alive
  if (playing && !paused) {
    for (let i = sq.length - 1; i >= 0; i--) { sq[i] -= dt; if (sq[i] <= 0) { sq.splice(i, 1); split(); } }
    if (unlockT > 0) { unlockT -= dt; if (unlockT <= 0) { unlockT = 0; lock = null; } }
    aimT -= dt; if (aimT <= 0) { aimT = 1 / 25; sendAim(); }
  }
  if (pings.length) pings = pings.filter(p => (p.t -= dt) > 0);
  camera(dt); draw(dt);
  mmT -= dt; if (mmT <= 0) { mmT = 0.2; drawMM(); }
  ht += dt; if (ht > 0.25) { ht = 0; hud(); }
}

/* ---------- settings panel ---------- */
const isBound = c => !!c && (Object.values(binds).includes(c) || Object.values(binds2).includes(c));
function press(c) { if (!playing || paused) return; held.add(c); for (const k in binds) if (binds[k] === c || binds2[k] === c) act(k, true); }
function release(c) { held.delete(c); for (const k in binds) if (binds[k] === c || binds2[k] === c) act(k, false); }
// slot 1 = main key, slot 2 = extra key. A key can only do one thing: taking it from another action frees it there
function assign(a, code, slot) {
  for (const k in binds2) if (binds2[k] === code && !(k === a && slot === 2)) delete binds2[k];
  if (slot === 2) { for (const k in binds) if (binds[k] === code) binds[k] = k === a ? binds[k] : ''; if (binds[a] === code) return; binds2[a] = code; }
  else { for (const k in binds) if (k !== a && binds[k] === code) binds[k] = binds[a]; binds[a] = code; if (binds2[a] === code) delete binds2[a]; }
  saveCfg(); updateHelp();
}
function keysOf(k) { return label(binds[k]) + (binds2[k] ? ' / ' + label(binds2[k]) : ''); }
function updateHelp() {
  const kb = $('keys'); kb.textContent = '';
  for (const [k, v] of [[tr('k_move'), tr('k_mouse')], [tr('a_split'), keysOf('split')], [tr('a_dsplit'), keysOf('dsplit')], [tr('a_psplit'), keysOf('psplit')], [tr('effects'), FX_IDS.filter(fxUnlocked).map(k => label(binds[k])).join(' ')], [tr('a_eject'), keysOf('eject')], [tr('k_line'), label(binds.hline) + ' / ' + label(binds.vline)]]) { const s = document.createElement('span'); s.append(k + ' '); const b = document.createElement('kbd'); b.textContent = v; s.append(b); kb.append(s); }
  setMode(watchChosen ? 'watch' : multiChosen);
}
function renderSettings() {
  const kl = $('kl'); kl.textContent = ''; $('fxl').textContent = '';
  for (const [k, n] of ACT) {
    const row = document.createElement('div'); row.className = 'kr';
    const s = document.createElement('span'); s.textContent = tr(n) + (k.startsWith('fx_') && !fxUnlocked(k) ? '  🔒 ' + tr('bp_level', { n: fxLevel(k) }) : '');
    const b = document.createElement('button'); b.className = 'kb' + (listening === k ? ' wait' : ''); b.id = 'kb_' + k; b.textContent = listening === k ? tr('press_key') : label(binds[k]);
    b.onclick = e => { e.stopPropagation(); listening = k; renderSettings(); };
    const b2 = document.createElement('button'), l2 = k + '#2'; b2.className = 'kb kb2' + (listening === l2 ? ' wait' : '') + (binds2[k] ? '' : ' empty'); b2.id = 'kb2_' + k; b2.title = tr('second_key');
    b2.textContent = listening === l2 ? tr('press_key') : binds2[k] ? label(binds2[k]) : '+';
    b2.onclick = e => { e.stopPropagation(); listening = l2; renderSettings(); };
    const bx = document.createElement('div'); bx.className = 'kbs'; bx.append(b, b2); row.append(s, bx); (k.startsWith('fx_') ? $('fxl') : kl).appendChild(row);
  }
  for (const b of [0, 2]) { const el = $('mm' + b); if (!el.options.length) for (const [v, t] of MACROS) { const o = document.createElement('option'); o.value = v; o.textContent = tr(t); o.dataset.t = t; el.append(o); } el.value = mbtn[b]; }
  { const el = $('fcap'), opts = [0, ...[30, 60, 75, 90, 120, 144, 165, 240, 360].filter(r => r < hz)];
    const key = opts.join() + '|' + tr('fps_monitor', { n: hz });
    if (el.dataset.k !== key) { el.dataset.k = key; el.textContent = ''; for (const r of opts) { const o = document.createElement('option'); o.value = r; o.textContent = r ? r + ' FPS' : tr('fps_monitor', { n: hz }); el.append(o); } }
    el.value = opts.includes(fcap) ? fcap : 0; $('fpsnow').textContent = fps + ' FPS · ' + tr('fps_screen', { n: hz }); }
  $('cA').value = colA; $('cI').value = colI; $('lines').checked = lines; $('gq').value = gq; $('gqnow').textContent = Math.round(renderScale() * 100) + '%'; $('omic').checked = openMic; $('ring').checked = ring; $('faces').checked = faces;
  { const box = $('cpres'); if (!box.childElementCount) for (const [a, i] of COL_PRESETS) { const b = document.createElement('button'); b.type = 'button'; b.dataset.a = a; b.dataset.i = i; b.setAttribute('aria-label', a + ' / ' + i); const x = document.createElement('i'), y = document.createElement('i'); x.style.background = a; y.style.background = i; b.append(x, y); b.onclick = () => { setCols(a, i); saveCfg(); renderSettings(); }; box.append(b); }
    for (const b of box.children) b.setAttribute('aria-pressed', b.dataset.a === colA && b.dataset.i === colI); }
  $('dd').value = dd; $('ddv').textContent = dd + ' ms'; $('rf').value = rf; $('rfv').textContent = rf + ' ms'; $('pd').value = pd; $('pdv').textContent = pd + ' ms'; $('ppd').value = ppd; $('ppdv').textContent = ppd + ' ms';
  $('lsi').checked = lsi; $('lsn').value = lsn; $('mal').checked = mal; $('ltg').checked = ltg; $('ftg').checked = ftg;
}
function openSettings() { $('st').hidden = false; paused = true; listening = null; releaseAll(); renderSettings(); }
function closeSettings() { $('st').hidden = true; paused = playing && !$('ov').hidden; listening = null; }
function releaseAll() { for (const c of [...held]) release(c); held.clear(); for (const b in mheld) { act(mheld[b], false); delete mheld[b]; } if (feedOn) { feedOn = false; setEject(false); } if (!ltg) lock = null; }

/* ---------- input ---------- */
let steer = null;
cv.addEventListener('pointerdown', e => { const ae = document.activeElement; if (ae && ae !== document.body && /INPUT|SELECT|BUTTON|TEXTAREA/.test(ae.tagName)) ae.blur(); if (e.pointerType !== 'mouse') { steer = e.pointerId; mx = e.clientX; my = e.clientY; } try { window.focus(); } catch (x) {} });
addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.pointerId === steer) { mx = e.clientX; my = e.clientY; } });
addEventListener('pointerup', e => { if (e.pointerId === steer) steer = null; });
addEventListener('keydown', e => {
  if (listening) { e.preventDefault(); e.stopPropagation(); const two = listening.endsWith('#2'), k = listening.replace('#2', ''); listening = null; if (e.code === 'Backspace' || e.code === 'Delete') { if (two) delete binds2[k]; else binds[k] = ''; saveCfg(); updateHelp(); } else if (e.code !== 'Escape') assign(k, e.code, two ? 2 : 1); renderSettings(); return; }
  if (!$('st').hidden) { if (e.code === 'Escape') closeSettings(); return; }
  if (!$('bp').hidden) { if (e.code === 'Escape') closePass(); return; }
  if (e.code === 'Escape' && !isBound('Escape') && e.target.id !== 'ctx') { // Esc: game → menu → game; on the start screen it opens Settings
    e.preventDefault(); if (playing || watching) { if ($('ov').hidden) openMenu(); else resumeGame(); } else openSettings(); return;
  }
  const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'SELECT') return;
  if (e.code === 'Enter' && !isBound('Enter') && connected) { e.preventDefault(); openChat(); return; }
  if (watching && $('ov').hidden && e.code === 'Space') { e.preventDefault(); send(Net.enc.spec(2)); return; }
  if (!playing) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && String(getSelection()).length) return; // copy selected chat text
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
  if (!listening) return; e.preventDefault(); e.stopPropagation(); const two = listening.endsWith('#2'), k = listening.replace('#2', ''); listening = null;
  if (e.button !== 0 || (e.target.closest && e.target.closest((two ? '#kb2_' : '#kb_') + k))) assign(k, 'Mouse' + e.button, two ? 2 : 1);
  renderSettings();
}, true);
addEventListener('mouseup', e => { if (e.button > 2 && playing) e.preventDefault(); const mac = mheld[e.button]; if (mac) { delete mheld[e.button]; act(mac, false); } release('Mouse' + e.button); });
addEventListener('auxclick', e => { if (playing) e.preventDefault(); });
addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('#clog')) return; if (listening || playing || e.target === cv) e.preventDefault(); });
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); else try { window.focus(); } catch (x) {} });
// zoom: mouse wheel, two-finger scroll or pinch on a Mac trackpad (pinch arrives as wheel + Ctrl), or the = and − keys
function setZoom(z) { zm = clamp(z, 0.01, 3); clearTimeout(resize.z); resize.z = setTimeout(() => { if (connected) send(Net.enc.size(W, H, zm)); }, 120); }
cv.addEventListener('wheel', e => { e.preventDefault(); setZoom(zm * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
function tbtn(id, fn, hold) {
  const b = $(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (!playing) return; fn(true); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => hold && fn(false));
}
tbtn('bsp', d => d && multiSplit(1)); tbtn('bds', d => d && multiSplit(2)); tbtn('bej', d => act('eject', d), true); tbtn('bsw', d => d && act('swap', true)); tbtn('bfd', d => act('feed', d), true);
$('gear').addEventListener('click', () => { if (playing || watching) { if ($('ov').hidden) openMenu(); else resumeGame(); } else openSettings(); }); $('mset').addEventListener('click', openSettings);
for (const b of document.querySelectorAll('.nav button')) b.addEventListener('click', () => $(b.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' })); $('cl').addEventListener('click', closeSettings); $('cl2').addEventListener('click', closeSettings);
$('rs').addEventListener('click', () => { binds = Object.assign({}, DEF); binds2 = {}; dd = 60; fcap = 0; lines = true; ring = false; faces = true; setCols(); rf = 25; pd = 50; ppd = 120; lsi = false; lsn = 2; mal = true; ltg = false; ftg = false; mbtn = { 0: 'none', 2: 'swap' }; saveCfg(); updateHelp(); renderSettings(); });
const setting = (id, ev, fn) => $(id).addEventListener(ev, e => { fn(e.target); saveCfg(); renderSettings(); });
setting('dd', 'input', t => dd = +t.value); setting('lines', 'change', t => lines = t.checked); setting('gq', 'change', t => { gq = t.value; autoScale = 1; slowSecs = 0; try { localStorage.setItem('gobblegq', gq); } catch (e) {} resize(); }); setting('omic', 'change', t => { openMic = t.checked; try { localStorage.setItem('gobbleopenmic', openMic ? '1' : '0'); } catch (e) {} applyMic(); }); setting('ring', 'change', t => ring = t.checked); setting('faces', 'change', t => faces = t.checked); setting('cA', 'input', t => setCols(t.value, colI)); setting('cI', 'input', t => setCols(colA, t.value)); setting('fcap', 'change', t => { fcap = +t.value || 0; nextDraw = 0; }); setting('rf', 'input', t => rf = +t.value); setting('pd', 'input', t => pd = +t.value); setting('ppd', 'input', t => ppd = +t.value);
setting('lsi', 'change', t => lsi = t.checked); setting('lsn', 'change', t => lsn = clamp(Math.round(+t.value) || 1, 1, 4)); setting('mal', 'change', t => mal = t.checked);
setting('ltg', 'change', t => { ltg = t.checked; lock = null; }); setting('ftg', 'change', t => { ftg = t.checked; feedOn = false; });
setting('mm0', 'change', t => mbtn[0] = t.value); setting('mm2', 'change', t => mbtn[2] = t.value);
$('mSolo').addEventListener('click', () => setMode(false)); $('mMulti').addEventListener('click', () => setMode(true)); $('mWatch').addEventListener('click', () => setMode('watch'));
$('go').addEventListener('click', () => { const viewing = watching && watchChosen; if ((playing && !watchChosen) || viewing) resumeGame(); else startGame(); });
$('nm').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });

/* ---------- growth speed, 1x to 3x, each player's own choice ---------- */
const growth = 1; // growth speed is fixed at 1x for everyone (the picker was removed)
function renderGrowth() {
  for (const id of ['grow', 'growc']) {
    const box = $(id); if (!box) continue; box.textContent = '';
    for (let v = 1; v <= 3; v++) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = v + '×'; b.setAttribute('aria-pressed', v === growth);
      b.onclick = () => {};
      box.append(b);
    }
  }
}
renderGrowth(); $('tmode').hidden = !TEST;

/* ---------- parties ---------- */
function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
function partyHue() { let h = 0; for (const ch of partyCode || $('pty').value) h = (h * 31 + ch.charCodeAt(0)) % 360; return (h + 190) % 360; }
function inviteLink(code) { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('party', code); if (region && region !== 'here') u.searchParams.set('r', region); return u.toString(); }
function renderParty() {
  const code = cleanCode($('pty').value);
  $('pinv').hidden = !code; if (!code) return;
  $('plink').textContent = inviteLink(code);
  const n = playing ? new Set([...partyIds].map(id => owners.get(id)?.name?.replace(/ [AB]$/, ''))).size : 0;
  $('pnote').textContent = playing && partyCode ? tr('party_note', { code: partyCode, n }) : tr('party_share');
}
$('pnew').addEventListener('click', () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 5; i++) c += a[Math.floor(Math.random() * a.length)]; $('pty').value = c; renderParty(); sendPartyCode(); });
// the party code takes effect right away (no need to press Play again), so friends can group up and use voice
function sendPartyCode() { clearTimeout(sendPartyCode.t); sendPartyCode.t = setTimeout(() => { const c = cleanCode($('pty').value); try { localStorage.setItem('gobbleparty', c); } catch (e) {} if (connected) send(Net.enc.party(c)); }, 350); }
$('pty').addEventListener('input', () => { $('pty').value = cleanCode($('pty').value); renderParty(); sendPartyCode(); });
$('pcopy').addEventListener('click', () => {
  const t = $('plink').textContent;
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { $('pcopy').textContent = tr('copied'); setTimeout(() => $('pcopy').textContent = tr('copy_link'), 1500); })
    .catch(() => { const r = document.createRange(); r.selectNodeContents($('plink')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
});

/* ---------- chat panel: always on screen in the bottom left ---------- */
// chat is also kept in this browser (last 20), so it's still there after a reload or a server update
let chatStore = []; try { chatStore = JSON.parse(localStorage.getItem('gobblechatlog') || '[]').slice(-20); } catch (e) {}
const chatSeen = new Map(); for (const c of chatStore) { const k = c.channel + '|' + c.name + '|' + c.text; chatSeen.set(k, (chatSeen.get(k) || 0) + 1); }
// mute: click a name in the chat (or in the voice list) to hide that player's messages and silence their voice
let muted = new Set(); try { muted = new Set(JSON.parse(localStorage.getItem('gobblemuted') || '[]')); } catch (e) {}
function baseName(n) { const t = String(n || ''); const sp = t.indexOf(' '); return sp > 0 && BADGES.includes(t.slice(0, sp)) ? t.slice(sp + 1) : t; }
function toggleMute(n) {
  n = baseName(n); if (!n) return;
  if (muted.has(n)) { muted.delete(n); toast('🔈 ' + tr('unmuted', { name: n })); } else { muted.add(n); toast('🔇 ' + tr('muted', { name: n })); for (const el of [...$('clog').children]) if (el.dataset.n === n) el.remove(); }
  try { localStorage.setItem('gobblemuted', JSON.stringify([...muted])); } catch (e) {}
  for (const p of peers.values()) if (p.audio) p.audio.muted = muted.has(baseName(p.name)); renderVoice();
}
function addChat(m, restoring) {
  if (muted.has(baseName(m.name))) return;
  if (!restoring) { // a message the server repeats after a reconnect that we already show from our own copy: skip it
    const k = m.channel + '|' + m.name + '|' + m.text, n = chatSeen.get(k) || 0;
    if (n > 0 && !connectedFresh()) { chatSeen.set(k, n - 1); return; }
    chatStore.push({ channel: m.channel, hue: m.hue, name: m.name, text: m.text }); chatStore = chatStore.slice(-20);
    try { localStorage.setItem('gobblechatlog', JSON.stringify(chatStore)); } catch (e) {}
  }
  if (!showChat) return;
  const log = $('clog'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  const li = document.createElement('div'); li.className = 'cm'; li.style.setProperty('--pc', 'hsl(' + m.hue + ' 75% 60%)'); setTimeout(() => li.classList.add('old'), 30000);
  if (m.channel === 1) { const t = document.createElement('span'); t.className = 'ctag'; t.textContent = tr('party'); li.append(t); }
  const n = document.createElement('b'); n.textContent = m.name + ': '; n.style.color = 'hsl(' + m.hue + ' 75% 65%)'; n.style.cursor = 'pointer'; n.title = tr('mute_tip'); n.onclick = () => toggleMute(m.name); li.dataset.n = baseName(m.name); li.append(n, document.createTextNode(m.text));
  log.append(li); while (log.children.length > 20) log.firstChild.remove(); // keep the last 20
  if (atBottom) log.scrollTop = log.scrollHeight;
  if ($('chat').classList.contains('min')) $('cmin').textContent = tr('new_msg');
}
function openChat() { if (!showChat || !connected) return; $('chat').classList.remove('min'); $('cmin').textContent = '–'; releaseAll(); $('ctx').focus(); }
function closeChat() { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); $('ctx').blur(); try { window.focus(); } catch (e) {} }
function sendChat() { const t = $('ctx').value.trim(); if (t && connected) send(Net.enc.chat(chatChan, t)); $('ctx').value = ''; }
function chatReady() { const on = connected; $('ctx').disabled = $('csend').disabled = !on; $('ctx').placeholder = on ? tr('type_msg') : tr('connecting_short'); }
// people on the menu chat under the name typed in the name box
function sendName() { if (connected) send(Net.enc.name(($('nm').value.trim() || tr('guest')).slice(0, 12))); }
$('nm').addEventListener('input', () => { clearTimeout(sendName.t); sendName.t = setTimeout(sendName, 400); });
setInterval(chatReady, 300);
$('csend').addEventListener('click', e => { e.preventDefault(); sendChat(); closeChat(); });
$('cmin').addEventListener('click', () => { const m = $('chat').classList.toggle('min'); $('cmin').textContent = m ? '+' : '–'; });
$('ctx').addEventListener('focus', () => releaseAll());
function renderChatChan() { if (chatChan === 1 && !partyCode) chatChan = 0; $('cch').textContent = chatChan ? tr('party') : tr('all'); $('cch').disabled = !partyCode; }
setInterval(renderChatChan, 1000);
$('cch').addEventListener('click', () => { chatChan = partyCode ? 1 - chatChan : 0; renderChatChan(); $('ctx').focus(); });
$('ctx').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { sendChat(); closeChat(); }
  else if (e.key === 'Escape') closeChat();
});
$('shc').addEventListener('change', e => { showChat = e.target.checked; $('chat').hidden = !showChat; try { localStorage.setItem('gobblechat', showChat ? '1' : '0'); } catch (x) {} });

/* ---------- battle pass: XP from playing, 30 levels a season, rewards kept forever (saved in this browser) ---------- */
const BADGES = ['⭐', '🔥', '💎', '🚀', '🌈', '⚡', '🦈', '👑', '🎯', '🍀'];
// one reward list per level (level 1 is what everyone has from the start)
const PASS = [
  [['fx', 'fx_quake'], ['fx', 'fx_chat']], [['skin', 0]], [['fx', 'fx_warn']], [['skin', 1]], [['skin', 2]], [['fx', 'fx_disco']],
  [['skin', 3]], [['skin', 4]], [['fx', 'fx_confetti']], [['badge', 0]], [['skin', 5]], [['skin', 6]], [['fx', 'fx_snow']],
  [['skin', 7]], [['badge', 1]], [['skin', 8]], [['fx', 'fx_flash']], [['skin', 9]], [['skin', 10]], [['badge', 2]],
  [['fx', 'fx_hearts']], [['skin', 11]], [['badge', 3]], [['badge', 4]], [['fx', 'fx_fireworks']], [['badge', 5]],
  [['badge', 6]], [['badge', 8]], [['badge', 9]], [['badge', 7]],
];
const FX_ICON = { fx_quake: '💥', fx_chat: '👀', fx_warn: '⚠️', fx_disco: '🪩', fx_confetti: '🎉', fx_snow: '❄️', fx_flash: '⚡', fx_hearts: '❤️', fx_fireworks: '🎆' };
const FX_IDS = ['fx_quake', 'fx_warn', 'fx_disco', 'fx_chat', 'fx_confetti', 'fx_snow', 'fx_flash', 'fx_hearts', 'fx_fireworks'];
function needXP(lv) { return 400 + 25 * (lv - 1); } // XP to go from level lv to lv + 1
function seasonInfo(d = new Date()) { // Season 1 runs to the end of November 2026, then one season per calendar month
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), idx = (y - 2026) * 12 + mo - 10; // 0 = Nov 2026
  const n = Math.max(1, idx + 1), end = idx < 0 ? Date.UTC(2026, 11, 1) : Date.UTC(y, mo + 1, 1);
  return { id: 'S' + n, n, days: Math.max(0, Math.ceil((end - d.getTime()) / 864e5)) };
}
let pass = { season: '', xp: 0, got: [], skin: -1, badge: -1 };
try { const p = JSON.parse(localStorage.getItem('gobblepass') || 'null'); if (p && typeof p === 'object') pass = Object.assign(pass, p); } catch (e) {}
if (pass.season !== seasonInfo().id) { pass.season = seasonInfo().id; pass.xp = 0; } // new season: levels start again, rewards stay
function savePass() { try { localStorage.setItem('gobblepass', JSON.stringify(pass)); } catch (e) {} }
function passLevel() { let lv = 1, xp = pass.xp; while (lv < PASS.length && xp >= needXP(lv)) { xp -= needXP(lv); lv++; } return { lv, xp, need: lv < PASS.length ? needXP(lv) : 0 }; }
function rewardKey(r) { return r[0] + ':' + r[1]; }
function has(r) { return pass.got.includes(rewardKey(r)); }
function unlockUpTo(lv) { const fresh = []; for (let i = 0; i < lv; i++) for (const r of PASS[i]) if (!has(r)) { pass.got.push(rewardKey(r)); fresh.push(r); } return fresh; }
function fxUnlocked(k) { return has(['fx', k]); }
function fxLevel(k) { for (let i = 0; i < PASS.length; i++) if (PASS[i].some(r => r[0] === 'fx' && r[1] === k)) return i + 1; return 1; }
function rewardName(r) { return r[0] === 'fx' ? FX_ICON[r[1]] + ' ' + tr('a_' + r[1]) : r[0] === 'skin' ? tr('bp_skin') + ' #' + (r[1] + 1) : tr('bp_badge') + ' ' + BADGES[r[1]]; }
unlockUpTo(passLevel().lv);
let xpRun = 0; // XP earned in the current life, shown after it ends
function addXP(n) {
  if (TEST || !(n > 0)) return; n = Math.round(n);
  const before = passLevel().lv; pass.xp += n; xpRun += n; const after = passLevel().lv;
  if (after > before) { const fresh = unlockUpTo(after); showBanner('level', { n: after, rewards: fresh }); confettiT = 1.5; }
  savePass(); renderPassBtn();
}
// tell the server what others should see: skin and chat badge (with the multibox colours)
function sendLook() { if (connected) send(Net.enc.cols(colA, colI, pass.skin, pass.badge)); }
function renderPassBtn() { const b = $('mpass'); if (b) b.textContent = '🎖 ' + tr('bp_level', { n: passLevel().lv }); }
function stickerThumb(i) { const c = document.createElement('canvas'); c.width = c.height = 48; c.getContext('2d').drawImage(FACES[i].img, 0, 0, 48, 48); return c; }
function renderPass() {
  const s = seasonInfo(), L = passLevel();
  $('bpseason').textContent = tr('bp_season', { n: s.n, d: s.days });
  $('bplv').textContent = tr('bp_level', { n: L.lv });
  $('bpxp').textContent = L.need ? L.xp + ' / ' + L.need + ' XP' : 'MAX';
  $('bpbar').style.width = (L.need ? Math.min(100, L.xp / L.need * 100) : 100) + '%';
  const sk = $('bpskins'); sk.textContent = '';
  const none = document.createElement('button'); none.type = 'button'; none.textContent = tr('bp_none'); none.setAttribute('aria-pressed', pass.skin < 0); none.onclick = () => { pass.skin = -1; savePass(); sendLook(); renderPass(); }; sk.append(none);
  for (let i = 0; i < FACES.length; i++) if (has(['skin', i])) { const b = document.createElement('button'); b.type = 'button'; b.append(stickerThumb(i)); b.setAttribute('aria-pressed', pass.skin === i); b.onclick = () => { pass.skin = i; savePass(); sendLook(); renderPass(); }; sk.append(b); }
  const bd = $('bpbadges'); bd.textContent = '';
  const nb = document.createElement('button'); nb.type = 'button'; nb.textContent = tr('bp_none'); nb.setAttribute('aria-pressed', pass.badge < 0); nb.onclick = () => { pass.badge = -1; savePass(); sendLook(); renderPass(); }; bd.append(nb);
  BADGES.forEach((e, i) => { if (!has(['badge', i])) return; const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.setAttribute('aria-pressed', pass.badge === i); b.onclick = () => { pass.badge = i; savePass(); sendLook(); renderPass(); }; bd.append(b); });
  const tk = $('bptrack'); tk.textContent = '';
  PASS.forEach((rs, i) => {
    const t = document.createElement('div'); t.className = 'bpt' + (i + 1 <= L.lv ? ' on' : '') + (i + 1 === L.lv ? ' now' : '');
    const n = document.createElement('small'); n.textContent = i + 1; t.append(n);
    for (const r of rs) { if (r[0] === 'skin') t.append(stickerThumb(r[1])); else { const e = document.createElement('span'); e.textContent = r[0] === 'fx' ? FX_ICON[r[1]] : BADGES[r[1]]; t.append(e); } }
    t.title = rs.map(rewardName).join(', '); tk.append(t);
  });
}
function openPass() { renderPass(); $('bp').hidden = false; }
function closePass() { $('bp').hidden = true; }
// extra effects that come with the pass
const parts = [];
function burst(kind, sec) { fxParts.push({ kind, t: sec }); }
const fxParts = [];
let flashT = 0;
function drawParts(dt) {
  for (let i = fxParts.length - 1; i >= 0; i--) {
    const f = fxParts[i]; f.t -= dt; if (f.t <= 0) { fxParts.splice(i, 1); continue; }
    const k = f.kind;
    if (k === 'snow') for (let j = 0; j < 3; j++) parts.push({ x: Math.random() * W, y: -10, vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 60, s: 2 + Math.random() * 4, c: '#fff', k: 'dot' });
    if (k === 'hearts') if (Math.random() < 0.5) parts.push({ x: Math.random() * W, y: H + 20, vx: (Math.random() - 0.5) * 40, vy: -(90 + Math.random() * 120), s: 18 + Math.random() * 20, c: '#ff5f7e', k: 'heart' });
    if (k === 'fireworks') if (Math.random() < 0.06) { const x = W * (0.15 + Math.random() * 0.7), y = H * (0.15 + Math.random() * 0.45), hue = Math.random() * 360 | 0; for (let j = 0; j < 46; j++) { const a = j / 46 * TAU, v = 140 + Math.random() * 120; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: 3, c: 'hsl(' + (hue + Math.random() * 40 | 0) + ' 95% 62%)', k: 'spark', life: 1.4 }); } }
  }
  if (flashT > 0) { flashT -= dt; g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = 'rgba(235,240,255,' + (Math.max(0, Math.sin(flashT * 30)) * 0.55).toFixed(3) + ')'; g.fillRect(0, 0, W, H); g.restore(); }
  if (!parts.length) return;
  g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.k === 'spark') { p.vy += 120 * dt; p.vx *= 0.985; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; } g.globalAlpha = Math.min(1, p.life); }
    if (p.y > H + 30 || p.y < -60) { parts.splice(i, 1); continue; }
    g.fillStyle = p.c;
    if (p.k === 'heart') { g.font = p.s + 'px sans-serif'; g.fillText('❤', p.x, p.y); } else { g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
  }
  g.restore();
}

/* ---------- fun effects and the arena record ---------- */
function showBanner(kind, r) {
  const el = $('fxb'); clearTimeout(showBanner.t); clearTimeout(showBanner.t2);
  el.className = kind; el.hidden = false; void el.offsetWidth; el.classList.add('in');
  if (kind === 'warn') {
    $('fxt').textContent = tr('warn_title'); $('fxs').textContent = tr('warn_text');
    showBanner.t2 = setTimeout(() => { $('fxt').textContent = '😄'; $('fxs').textContent = tr('warn_joke'); }, 3000);
    showBanner.t = setTimeout(() => el.classList.remove('in'), 5000);
  } else if (kind === 'level') { // you levelled up in the battle pass
    $('fxt').textContent = '🎖 ' + tr('bp_levelup', { n: r.n }); $('fxs').textContent = r.rewards.length ? tr('bp_unlocked') + ' ' + r.rewards.map(rewardName).join(', ') : '';
    showBanner.t = setTimeout(() => el.classList.remove('in'), 4500);
  } else if (kind === 'chat') { // someone wants everyone to read the chat: banner plus a flashing chat
    $('fxt').textContent = '👀 ' + tr('look_chat'); $('fxs').textContent = '← ' + tr('look_chat_s', { name: r.name || '?' });
    const c = $('chat'); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
    showBanner.t = setTimeout(() => el.classList.remove('in'), 4000);
  } else {
    $('fxt').textContent = '🏆 ' + tr('record_title'); $('fxs').textContent = r.name + ' · ' + dm(r.m).toLocaleString();
    showBanner.t = setTimeout(() => el.classList.remove('in'), 5000);
  }
}
function renderRecord() { $('rec').hidden = !rec; if (rec) $('rec').textContent = '🏆 ' + tr('record_hud') + ': ' + rec.name + ' · ' + dm(rec.m).toLocaleString(); }
function drawConfetti(dt) { // a burst of paper bits falling over the whole screen, drawn in screen space
  if (confettiT > 0) { confettiT -= dt; for (let i = 0; i < 6; i++) confetti.push({ x: Math.random() * W, y: -10, vx: (Math.random() - 0.5) * 120, vy: 120 + Math.random() * 160, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 10, c: 'hsl(' + (Math.random() * 360 | 0) + ' 90% 60%)', s: 5 + Math.random() * 6 }); }
  g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = confetti.length - 1; i >= 0; i--) { const p = confetti[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; if (p.y > H + 20) { confetti.splice(i, 1); continue; } g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  g.restore();
}

function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3500); }
$('mpass').addEventListener('click', openPass); $('bpx').addEventListener('click', closePass); $('bpdone').addEventListener('click', closePass);
renderPassBtn();

function connectedFresh() { return performance.now() - connAt > 2000; }
for (const c of chatStore) addChat(c, true);

/* ---------- party voice chat: browser-to-browser audio (WebRTC) between members of the same party ---------- */
// STUN finds a direct route; the free public relay (TURN) carries the sound when routers block direct connections
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }];
const pendIce = new Map(); // call-setup messages that arrive before the call itself is ready
let openMic = false, voiceOn = false, voiceSelf = 0, mic = null, pttDown = false, vctx = null;
try { openMic = localStorage.getItem('gobbleopenmic') === '1'; } catch (e) {}
const peers = new Map(); // party member id -> { pc, audio, an, name, talk }
let roster = [];
function micLive() { return !!mic && (openMic || pttDown); }
function applyMic() { if (mic) for (const t of mic.getAudioTracks()) t.enabled = micLive(); renderVoice(); }
async function joinVoice() {
  if (voiceOn) return;
  if (!partyCode && !cleanCode($('pty').value)) { toast('🎤 ' + tr('voice_need_party')); return; }
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { toast('🎤 ' + tr('voice_denied')); return; }
  try { vctx = vctx || new (window.AudioContext || window.webkitAudioContext)(); vctx.resume(); } catch (e) {}
  voiceOn = true; applyMic(); send(Net.enc.voice(0)); renderVoice();
}
function leaveVoice(silent) {
  if (!voiceOn && !mic) return;
  voiceOn = false; if (!silent && connected) send(Net.enc.voice(1));
  for (const id of [...peers.keys()]) dropPeer(id);
  if (mic) for (const t of mic.getTracks()) t.stop(); mic = null; roster = []; renderVoice();
}
function dropPeer(id) { const p = peers.get(id); if (!p) return; try { p.pc.close(); } catch (e) {} if (p.audio) { p.audio.srcObject = null; p.audio.remove(); } peers.delete(id); }
function signal(to, obj) { send(Net.enc.voiceSignal(to, JSON.stringify(obj))); }
function makePeer(id, name) {
  const pc = new RTCPeerConnection({ iceServers: ICE }), p = { pc, audio: null, an: null, name, talk: false };
  peers.set(id, p);
  if (mic) for (const t of mic.getAudioTracks()) pc.addTrack(t, mic);
  pc.onicecandidate = e => { if (e.candidate) signal(id, { t: 'ice', d: e.candidate }); };
  pc.ontrack = e => {
    const st = e.streams[0]; if (!st || p.audio) return;
    const a = document.createElement('audio'); a.autoplay = true; a.srcObject = st; a.style.display = 'none'; a.muted = muted.has(baseName(p.name)); document.body.append(a); a.play().catch(() => {}); p.audio = a;
    try { const src = vctx.createMediaStreamSource(st), an = vctx.createAnalyser(); an.fftSize = 256; src.connect(an); p.an = an; } catch (e) {}
  };
  pc.onconnectionstatechange = () => { renderVoice(); if (pc.connectionState === 'failed') { dropPeer(id); if (voiceOn && roster.some(m => m.vid === id) && voiceSelf < id) setTimeout(() => callPeer(id, name), 1500); } };
  return p;
}
async function callPeer(id, name) { const p = makePeer(id, name); const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o); signal(id, { t: 'offer', d: p.pc.localDescription }); }
async function flushIce(from, p) { const q = pendIce.get(from); pendIce.delete(from); if (q) for (const c of q) { try { await p.pc.addIceCandidate(c); } catch (e) {} } }
async function onVoiceSignal(from, data) {
  if (!voiceOn) return; let m; try { m = JSON.parse(data); } catch (e) { return; }
  let p = peers.get(from);
  if (m.t === 'offer') { if (!p) p = makePeer(from, (roster.find(r => r.vid === from) || {}).name || '?'); await p.pc.setRemoteDescription(m.d); await flushIce(from, p); const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a); signal(from, { t: 'answer', d: p.pc.localDescription }); }
  else if (m.t === 'answer' && p) { await p.pc.setRemoteDescription(m.d); await flushIce(from, p); }
  else if (m.t === 'ice') { if (!p || !p.pc.remoteDescription) { let q = pendIce.get(from); if (!q) pendIce.set(from, q = []); q.push(m.d); } else { try { await p.pc.addIceCandidate(m.d); } catch (e) {} } }
}
// browsers (Brave especially) may refuse to play sound until you click or press a key: retry on every click/key
function unblockAudio() { try { if (vctx && vctx.state !== 'running') vctx.resume(); } catch (e) {} for (const p of peers.values()) if (p.audio && p.audio.paused) p.audio.play().catch(() => {}); }
addEventListener('pointerdown', unblockAudio, true); addEventListener('keydown', unblockAudio, true);
function onRoster(m) {
  voiceSelf = m.self; roster = m.list;
  if (!voiceOn) return renderVoice();
  if (!roster.some(r => r.vid === voiceSelf)) { leaveVoice(true); return; }
  for (const id of [...peers.keys()]) if (!roster.some(r => r.vid === id)) dropPeer(id);
  for (const r of roster) if (r.vid !== voiceSelf && !peers.has(r.vid) && voiceSelf < r.vid) callPeer(r.vid, r.name); // the lower id calls, so two calls never cross
  renderVoice();
}
const lvlBuf = new Uint8Array(128);
setInterval(() => { // who is talking right now (sound level of each member's audio)
  if (!voiceOn) return; let ch = false;
  for (const p of peers.values()) { if (!p.an) continue; p.an.getByteTimeDomainData(lvlBuf); let s = 0; for (const v of lvlBuf) s += (v - 128) * (v - 128); const talk = Math.sqrt(s / lvlBuf.length) > 2.5; if (talk !== p.talk) { p.talk = talk; ch = true; } }
  if (ch) renderVoice();
}, 200);
function renderVoice() {
  const b = $('vbtn'); b.classList.toggle('on', voiceOn); b.classList.toggle('live', micLive());
  b.title = voiceOn ? tr('voice_leave') : tr('voice_join'); b.setAttribute('aria-label', b.title);
  b.textContent = voiceOn ? (micLive() ? '🎙️' : '🎤') + (openMic ? '' : ' ' + label(binds.ptt)) : '🎤';
  const l = $('vlist'); l.textContent = ''; l.hidden = !voiceOn;
  if (!voiceOn) return;
  for (const r of roster) { const s = document.createElement('span'); const me = r.vid === voiceSelf, pr = peers.get(r.vid), st = me ? 'connected' : pr ? pr.pc.connectionState : 'new', talk = me ? micLive() : pr && pr.talk;
    const ic = talk ? '🔊 ' : st === 'connected' ? '🔈 ' : st === 'failed' ? '⚠️ ' : '⏳ '; const mu = !me && muted.has(baseName(r.name)); s.className = 'vm' + (talk && !mu ? ' talk' : '') + (st === 'failed' ? ' bad' : ''); s.textContent = (mu ? '🔇 ' : ic) + r.name; s.title = mu ? tr('mute_tip') : st; if (!me) { s.style.cursor = 'pointer'; s.onclick = () => toggleMute(r.name); } l.append(s); }
}
$('vbtn').addEventListener('click', e => { e.currentTarget.blur(); if (voiceOn) leaveVoice(); else joinVoice(); });

/* ---------- language ---------- */
function renderLang() {
  const el = $('lng'); el.textContent = '';
  const auto = document.createElement('option'); auto.value = ''; auto.textContent = tr('lang_auto', { name: I18N.langs[I18N.auto] }); el.append(auto);
  for (const [code, name] of Object.entries(I18N.langs)) { const o = document.createElement('option'); o.value = code; o.textContent = name; el.append(o); }
  el.value = I18N.chosen;
}
$('lng').addEventListener('change', e => { I18N.set(e.target.value); renderLang(); renderSettings(); updateHelp(); renderRegions(); renderParty(); hud(); $('clog').dataset.empty = tr('no_msgs'); });
I18N.apply(); renderLang(); $('clog').dataset.empty = tr('no_msgs');

/* ---------- start ---------- */
document.title = GAME_NAME; $('ot').textContent = GAME_NAME;
try { $('nm').value = localStorage.getItem('gobblename') || ''; multiChosen = localStorage.getItem('gobblemb') !== '0'; watchChosen = localStorage.getItem('gobblemb') === '2'; if (watchChosen) multiChosen = true; $('pty').value = localStorage.getItem('gobbleparty') || ''; showChat = localStorage.getItem('gobblechat') !== '0'; } catch (e) {}
{ // invite links: ?party=CODE&r=region
  const q = new URLSearchParams(location.search), pq = cleanCode(q.get('party')), rq = q.get('r');
  if (pq) $('pty').value = pq;
  if (rq && SERVERS.some(s => s.id === rq)) { region = rq; try { localStorage.setItem('gobbleregion', region); } catch (e) {} }
}
$('shc').checked = showChat; $('chat').hidden = !showChat; renderParty();
updateHelp(); mx = W / 2; my = H / 2;
renderRegions(); probeRegions(); setInterval(() => { if (!playing) probeRegions(); }, 20000);
connect(); requestAnimationFrame(frame);
})();
