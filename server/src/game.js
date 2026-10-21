'use strict';
// The arena: one authoritative simulation shared by every player and bot.
const C = require('./config');

const WS = C.WORLD, G = C.GRID, GN = WS / G, TAU = Math.PI * 2;
const MINM = C.MIN_PIECE, MAXC = C.MAX_PIECES, VPOP = C.SPIKE_POP_MASS;
const rnd = (a, b) => a + Math.random() * (b - a);
const rad = m => 4 * Math.sqrt(m);
const spd = m => C.SPEED * Math.pow(m, -0.25);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const gi = v => clamp(Math.floor(v / G), 0, GN - 1);

const BOT_NAMES = ['nomnom', 'lilbean', 'Sir Munch', 'toast', 'Milo', 'Ivy', 'Kai', 'Zara', 'Finn', 'Ruby', 'sushi', 'ghost',
  'Luna', 'tiny', 'Big Snack', '404', 'pancake', 'Leo', 'Bubbles', 'sleepy', 'orbit', 'pixel', 'Nori', 'Captain', 'waffle',
  'Ash', 'Remy', 'Pumpkin', 'mango', 'Sol', 'Pip', 'Moss', 'Juno', 'Kiwi', 'Fig', 'Bean', 'Otto', 'Nova', 'Zed', 'Luma',
  'Rex', 'Mochi', 'Pebble', 'Sunny', 'Tofu', 'Echo', 'Blip', 'Dot', 'Wisp', 'Ember', 'Nib', 'Taro', 'Fizz', 'Gus'];
const ND = 16, DX = [], DY = [];
for (let i = 0; i < ND; i++) { DX.push(Math.cos(i / ND * TAU)); DY.push(Math.sin(i / ND * TAU)); }

class Game {
  constructor() {
    this.cells = [];        // every orb piece
    this.ejected = [];      // fed mass still sliding
    this.spikes = [];
    this.grid = Array.from({ length: GN * GN }, () => []); // pellets and settled blobs
    this.owners = new Map(); // owner id -> { kind:'bot'|'human', name, hue, client, ... }
    this.clients = new Set();
    this.nfood = 0; this.nSettled = 0;
    this.nextCell = 1; this.nextPellet = 1; this.nextOwner = 1;
    this.t = 0; this.regrow = 0; this.spikeT = 0; this.botT = 0;
    this.own = new Map(); this.oc = new Map();
    for (let i = 0; i < C.PELLETS; i++) this.addPellet();
    for (let i = 0; i < C.SPIKES; i++) this.spawnSpike();
    for (let i = 0; i < C.BOT_FILL; i++) this.addBot(); // arena is lively from the first second
  }

  /* ---------- world helpers ---------- */
  addPellet() {
    const f = { id: this.nextPellet++, x: rnd(20, WS - 20), y: rnd(20, WS - 20), m: C.PELLET_MASS, hb: Math.floor(Math.random() * 12) };
    this.grid[gi(f.y) * GN + gi(f.x)].push(f); this.nfood++;
  }
  newOwnerId() { return this.nextOwner++; } // never reused, so a name can't end up on the wrong orb
  mkCell(o, x, y, m) {
    return { id: this.nextCell++, o, x, y, m, r: rad(m), vx: 0, vy: 0, ux: 0, uy: 0, mt: 0, sc: rnd(2, 6), prot: 0, fr: 0, dead: false };
  }
  safeSpot(playerGap, mass) {
    for (let k = 0; k < 30; k++) {
      const x = rnd(300, WS - 300), y = rnd(300, WS - 300); let ok = true;
      for (const c of this.cells) {
        const human = this.owners.get(c.o)?.kind === 'human';
        const lim = human ? Math.max(playerGap, c.r + 300) : (c.m > mass * 1.1 ? c.r + 260 : 0);
        if (lim && Math.abs(c.x - x) < lim && Math.abs(c.y - y) < lim && Math.hypot(c.x - x, c.y - y) < lim) { ok = false; break; }
      }
      if (ok) for (const v of this.spikes) if (Math.hypot(v.x - x, v.y - y) < v.r + rad(mass) + 40) { ok = false; break; }
      if (ok) return { x, y };
    }
    return { x: rnd(300, WS - 300), y: rnd(300, WS - 300) };
  }
  // a free spot just outside all pieces of an owner (used for the second multibox box)
  spotNear(owner, r) {
    const me = this.cells.filter(c => c.o === owner && !c.dead);
    if (!me.length) return this.safeSpot(0, C.START_MASS);
    let sx = 0, sy = 0, sm = 0; for (const c of me) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; }
    const cx = sx / sm, cy = sy / sm; let ext = 0;
    for (const c of me) ext = Math.max(ext, Math.hypot(c.x - cx, c.y - cy) + c.r);
    const a0 = rnd(0, TAU); let best = null, bo = 1e9;
    for (let k = 0; k < 16; k++) {
      const a = a0 + k / 16 * TAU, d = ext + r + rnd(80, 140);
      const x = clamp(cx + Math.cos(a) * d, r + 20, WS - r - 20), y = clamp(cy + Math.sin(a) * d, r + 20, WS - r - 20);
      let ov = 0; for (const c of this.cells) { const g = c.r + r + 30 - Math.hypot(c.x - x, c.y - y); if (g > 0) ov += g; }
      if (ov === 0) return { x, y };
      if (ov < bo) { bo = ov; best = { x, y }; }
    }
    return best;
  }
  // start a new player fairly close to someone already playing, so real people meet quickly
  spotNearPlayers(client) {
    const others = [], mates = [];
    for (const cl of this.clients) if (cl !== client && !cl.dead && cl.boxes && cl.boxes.length) {
      const me = this.cells.filter(c => cl.boxes.includes(c.o)); if (!me.length) continue;
      let sx = 0, sy = 0, sm = 0; for (const c of me) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; }
      (client.party && cl.party === client.party ? mates : others).push({ x: sx / sm, y: sy / sm });
    }
    const pool = mates.length ? mates : others; if (!pool.length) return null;
    const r = rad(C.START_MASS), near = mates.length ? [350, 700] : [900, 1600];
    for (let k = 0; k < 24; k++) {
      const o = pool[Math.floor(Math.random() * pool.length)], a = rnd(0, TAU), d = rnd(near[0], near[1]);
      const x = clamp(o.x + Math.cos(a) * d, 300, WS - 300), y = clamp(o.y + Math.sin(a) * d, 300, WS - 300);
      let ok = true;
      for (const c of this.cells) { const lim = c.m > C.START_MASS * 1.1 ? c.r + r + 300 : c.r + r + 40; if (Math.abs(c.x - x) < lim && Math.abs(c.y - y) < lim && Math.hypot(c.x - x, c.y - y) < lim) { ok = false; break; } }
      if (ok) for (const v of this.spikes) if (Math.hypot(v.x - x, v.y - y) < v.r + r + 40) { ok = false; break; }
      if (ok) return { x, y };
    }
    return null;
  }
  spawnSpike() {
    const p = this.safeSpot(500, 2000);
    const r = rad(C.SPIKE_DRAW_MASS);
    this.spikes.push({ id: this.nextCell++, x: p.x, y: p.y, r, vx: 0, vy: 0, fed: 0, dx: 1, dy: 0, dead: false });
  }
  siblings(a, b) { // the two boxes of one multibox player, or players in the same party: they can't eat or pull each other
    if (a === b) return false;
    const A = this.owners.get(a), B = this.owners.get(b);
    if (!(A && B && A.client && B.client)) return false;
    return A.client === B.client || (!!A.client.party && A.client.party === B.client.party);
  }

  /* ---------- players ---------- */
  join(client, name, multi, party) {
    this.leave(client, true);
    client.party = String(party || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    name = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Player';
    client.name = name; client.multi = !!multi; client.active = 0; client.boxes = [];
    client.dead = false; client.kills = 0; client.peak = 0; client.born = this.t;
    client.ejectOn = false; client.feedOn = false; client.ejectMs = 60; client.ejT = 0; client.fdT = 0;
    const p = this.spotNearPlayers(client) || this.safeSpot(0, 3000);
    const hues = [170, 28];
    for (let b = 0; b < (client.multi ? 2 : 1); b++) {
      const id = this.newOwnerId();
      const ow = { id, kind: 'human', client, name: client.multi ? `${name} ${b ? 'B' : 'A'}` : name, hue: hues[b], tx: p.x, ty: p.y, box: b };
      this.owners.set(id, ow); client.boxes.push(id);
      const q = b === 0 ? p : this.spotNear(client.boxes[0], rad(C.START_MASS));
      const c = this.mkCell(id, q.x, q.y, C.START_MASS); c.prot = C.SPAWN_PROTECT; this.cells.push(c);
      ow.tx = q.x; ow.ty = q.y;
    }
    client.lastX = p.x; client.lastY = p.y;
  }
  leave(client, keepClient) {
    if (client.boxes) for (const id of client.boxes) { this.removeOwnerCells(id); this.owners.delete(id); }
    client.boxes = []; client.dead = true;
    if (!keepClient) this.clients.delete(client);
  }
  removeOwnerCells(id) { for (const c of this.cells) if (c.o === id) c.dead = true; this.cells = this.cells.filter(c => !c.dead); }
  activeOwner(client) { return client.boxes && client.boxes[client.active]; }
  setTarget(client, x, y) {
    const ow = this.owners.get(this.activeOwner(client)); if (!ow) return;
    ow.tx = clamp(+x || 0, 0, WS); ow.ty = clamp(+y || 0, 0, WS);
  }
  split(client) { const o = this.activeOwner(client); if (o) this.splitOwner(o, this.owners.get(o).tx, this.owners.get(o).ty); }
  splitOwner(o, tx, ty) {
    const mine = this.cells.filter(c => c.o === o && !c.dead); let n = mine.length;
    for (const c of mine) {
      if (n >= MAXC) break; if (c.m < 2 * MINM) continue;
      const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy) || 1; this.doSplit(c, dx / d, dy / d); n++;
    }
  }
  doSplit(c, dx, dy) {
    c.m /= 2; c.r = rad(c.m);
    const t = this.mkCell(c.o, c.x, c.y, c.m);
    t.vx = dx * C.SPLIT_SPEED + c.vx * 0.5; t.vy = dy * C.SPLIT_SPEED + c.vy * 0.5; t.ux = c.ux; t.uy = c.uy; t.sc = 7; t.prot = c.prot;
    t.fr = 0.4; c.mt = t.mt = Math.min(15, 6 + c.m * 0.004); c.sc = 7;
    this.cells.push(t); return t;
  }
  swap(client, x, y) {
    if (!client.multi || client.dead) return;
    const leaving = this.owners.get(this.activeOwner(client));
    if (leaving) { leaving.tx = clamp(+x || 0, 0, WS); leaving.ty = clamp(+y || 0, 0, WS); }
    const o = 1 - client.active, id = client.boxes[o];
    if (!this.cells.some(c => c.o === id)) { // that box was eaten: bring it back next to the other one
      const q = this.spotNear(client.boxes[client.active], rad(C.START_MASS));
      const c = this.mkCell(id, q.x, q.y, C.START_MASS); c.prot = C.SPAWN_PROTECT; this.cells.push(c);
      const ow = this.owners.get(id); ow.tx = q.x; ow.ty = q.y;
    }
    client.active = o;
  }
  respawn(client) { if (!client.boxes || !client.boxes.length) return; this.join(client, client.name, client.multi, client.party); }
  shoot(c, dx, dy, v, j = 0.3) {
    const a = (Math.random() - 0.5) * j, co = Math.cos(a), si = Math.sin(a), ex = dx * co - dy * si, ey = dx * si + dy * co;
    const sv = v * (1 + (Math.random() - 0.5) * j * 0.6), ih = j > 0.1 ? 1 : 0;
    this.ejected.push({
      id: this.nextPellet++, x: c.x + ex * (c.r + 4), y: c.y + ey * (c.r + 4), m: C.EJECT_MASS, own: c.o, imm: 0.6, hb: this.owners.get(c.o)?.hue ?? 0,
      vx: ex * sv + ih * (c.ux * 0.4 + c.vx * 0.3), vy: ey * sv + ih * (c.uy * 0.4 + c.vy * 0.3), sp: (Math.random() - 0.5) * j * 4,
    });
    c.m -= C.EJECT_MASS; c.r = rad(c.m);
  }
  eject(client) {
    const o = this.activeOwner(client), ow = this.owners.get(o); if (!ow) return;
    for (const c of this.cells) {
      if (c.o !== o || c.m < MINM + C.EJECT_MASS) continue;
      const dx = ow.tx - c.x, dy = ow.ty - c.y, d = Math.hypot(dx, dy) || 1; this.shoot(c, dx / d, dy / d, 1400);
    }
  }
  feedOther(client) {
    if (!client.multi) return;
    const o = this.activeOwner(client), other = client.boxes[1 - client.active];
    const tgt = this.cells.filter(c => c.o === other); if (!tgt.length) return;
    let sx = 0, sy = 0, sm = 0; for (const c of tgt) { sx += c.x * c.m; sy += c.y * c.m; sm += c.m; }
    const tx = sx / sm, ty = sy / sm;
    for (const c of this.cells) {
      if (c.o !== o || c.m < MINM + C.EJECT_MASS) continue;
      const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy) || 1; this.shoot(c, dx / d, dy / d, clamp(d * 6, 700, 3600), 0.06);
    }
  }
  popCell(c) {
    if (c.dead) return;
    const owned = this.oc.get(c.o) || 1, total = c.m;
    const n = Math.min(C.SPIKE_PIECES, MAXC - owned + 1, Math.floor(total / MINM)); if (n < 2) return;
    const w = []; let ws = 0; for (let i = 0; i < n; i++) { const v = Math.random() ** 2 * 3 + 0.1; w.push(v); ws += v; }
    const extra = total - n * MINM, mt = Math.min(16, 7 + total / n * 0.004), a0 = rnd(0, TAU), x = c.x, y = c.y;
    for (let i = 0; i < n; i++) {
      const m = MINM + extra * w[i] / ws, a = a0 + i / n * TAU, v = rnd(420, 560);
      const t = i === 0 ? c : this.mkCell(c.o, x, y, m);
      t.m = m; t.r = rad(m); t.mt = mt; t.sc = 7; t.fr = 0.5; t.vx = Math.cos(a) * v; t.vy = Math.sin(a) * v;
      if (i > 0) { t.prot = c.prot; t.ux = c.ux; t.uy = c.uy; this.cells.push(t); }
    }
    this.oc.set(c.o, owned + n - 1);
  }

  /* ---------- bots ---------- */
  addBot() {
    const id = this.newOwnerId(), m = Math.random() < 0.15 ? rnd(1200, 3800) : rnd(400, 650), p = this.safeSpot(650, m);
    this.owners.set(id, {
      id, kind: 'bot', name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], hue: Math.floor(rnd(0, 360)),
      b: { ox: 0, oy: 0, tox: 0, toy: 0, wx: p.x, wy: p.y, tt: rnd(0, 0.3), agg: rnd(0.6, 1.5), caut: rnd(0.8, 1.35), skill: rnd(0.35, 1),
        react: rnd(0.14, 0.32), wa: rnd(0, TAU), ign: null, ignT: 0, chase: null, chT: 0, chD: 0, gu: 5 },
    });
    this.cells.push(this.mkCell(id, p.x, p.y, m));
  }
  manageBots() {
    let humans = 0; for (const cl of this.clients) if (!cl.dead) humans++;
    const want = Math.max(0, C.BOT_FILL - humans);
    const bots = [...this.owners.values()].filter(o => o.kind === 'bot');
    for (const o of bots) if (!this.own.has(o.id)) this.owners.delete(o.id); // bot fully eaten
    const alive = bots.filter(o => this.own.has(o.id));
    if (alive.length < want) this.addBot();
    else if (alive.length > want) { // too many: retire the smallest bot quietly
      let s = null, sm = 1e18; for (const o of alive) { const m = this.own.get(o.id).reduce((a, c) => a + c.m, 0); if (m < sm) { sm = m; s = o; } }
      if (s) { this.removeOwnerCells(s.id); this.owners.delete(s.id); }
    }
  }
  botSplit(ps, tx, ty) {
    let n = ps.length;
    for (const p of ps.slice().sort((a, b) => b.m - a.m)) {
      if (n >= MAXC) break; if (p.m < 2 * MINM) continue;
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; this.doSplit(p, dx / d, dy / d); n++;
    }
  }
  think(o, ps, lead, b) {
    const cells = this.cells, spikes = this.spikes, grid = this.grid, oc = this.oc;
    b.tt = rnd(b.react * 0.75, b.react * 1.35);
    if (b.ignT > 0) { b.ignT -= b.react; if (b.ignT <= 0) b.ign = null; }
    let tm = 0, cx = 0, cy = 0; for (const p of ps) { tm += p.m; cx += p.x * p.m; cy += p.y * p.m; } cx /= tm; cy /= tm;
    const view = 450 + lead.r * 3 + Math.sqrt(tm) * 12, mySp = spd(lead.m), threats = [];
    let tgt = null, bs = 0, td = 0, nearGap = 1e9, bigThreat = null;
    for (const q of cells) {
      if (q.o === o || q.dead) continue;
      const qx = q.x - cx, qy = q.y - cy; if (qx > view || qx < -view || qy > view || qy < -view) continue;
      for (const p of ps) {
        if (q.m <= p.m * C.EAT_RATIO) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
        const canSplit = q.m / 2 > p.m * C.EAT_RATIO && q.m >= 2 * MINM && (oc.get(q.o) || 0) < MAXC;
        const zone = (q.r + p.r * 0.3 + (canSplit ? q.r * 0.4 + 228 : 0) + 100) * b.caut;
        if (d < zone * 1.7) {
          if (Math.random() < (1 - b.skill) * 0.1) continue;
          threats.push({ x: q.x + q.ux * 0.3, y: q.y + q.uy * 0.3, px: p.x, py: p.y, d, zone, w: 0.4 + 0.6 * p.m / lead.m });
          if (d - zone < nearGap) { nearGap = d - zone; bigThreat = q; }
        }
      }
      if (lead.m > q.m * C.EAT_RATIO && !(q.prot > 0) && q !== b.ign) {
        const dx = q.x - lead.x, dy = q.y - lead.y, d = Math.hypot(dx, dy) || 1; if (d > view) continue;
        const closing = -(q.ux * dx + q.uy * dy) / d, wall = Math.min(q.x, q.y, WS - q.x, WS - q.y);
        let sc = q.m / (d + 80) * b.agg;
        if (spd(q.m) > mySp * 1.05 && d > lead.r + 140 && closing < 20 && wall > 260) sc *= 0.2;
        if (this.owners.get(q.o)?.kind === 'human') sc *= 1.15;
        if (sc > bs) { bs = sc; tgt = q; td = d; }
      }
    }
    if (tgt) for (const q of cells) if (q.o !== o && q.o !== tgt.o && q.m > lead.m * C.EAT_RATIO && Math.hypot(q.x - tgt.x, q.y - tgt.y) < q.r + 280 * b.caut) { tgt = null; break; }
    if (tgt) {
      if (b.chase === tgt) { b.chT += b.react; if (b.chT > b.gu) { if (td > b.chD * 0.8) { b.ign = tgt; b.ignT = rnd(4, 9); tgt = null; } b.chase = null; } }
      else { b.chase = tgt; b.chT = 0; b.chD = td; b.gu = rnd(3, 7); }
    } else b.chase = null;
    let px = 0, py = 0;
    if (tgt) { const t = Math.min(1, td / Math.max(60, mySp)); px = tgt.x + (tgt.ux + tgt.vx) * t; py = tgt.y + (tgt.uy + tgt.vy) * t; }
    if (tgt && !threats.length && lead.sc <= 0 && lead.m >= 2 * MINM && lead.m / 2 > tgt.m * 1.3 && ps.length < 4 && Math.random() < 0.35 + b.skill * 0.5) {
      const dd = Math.hypot(px - lead.x, py - lead.y) || 1;
      if (dd < lead.r * 0.5 + 234 && dd > lead.r * 0.6) {
        let safe = true;
        for (const q of cells) if (q.o !== o && q.o !== tgt.o && q.m > lead.m / 2 * C.EAT_RATIO && Math.hypot(q.x - lead.x, q.y - lead.y) < q.r + 700) { safe = false; break; }
        if (safe && lead.m / 2 > VPOP) for (const v of spikes) if (Math.hypot(v.x - (lead.x + px) / 2, v.y - (lead.y + py) / 2) < v.r + lead.r * 0.6) { safe = false; break; }
        if (safe) { const e = (1 - b.skill) * 25; this.botSplit(ps, px + rnd(-e, e), py + rnd(-e, e)); }
      }
    }
    if (bigThreat && nearGap < -20 && lead.m >= 2 * MINM && ps.length < 3 && lead.sc <= 0 && Math.random() < b.skill * 0.25) {
      const ax = lead.x - bigThreat.x, ay = lead.y - bigThreat.y, ad = Math.hypot(ax, ay) || 1;
      this.botSplit(ps, lead.x + ax / ad * 400, lead.y + ay / ad * 400);
    }
    const isBig = lead.m >= VPOP; let vNear = false;
    if (isBig) for (const v of spikes) { const dx = v.x - cx, dy = v.y - cy; if (Math.abs(dx) < lead.r + 320 && Math.abs(dy) < lead.r + 320 && Math.hypot(dx, dy) < lead.r + v.r + 200) { vNear = true; break; } }
    let gx, gy;
    if (tgt) { const dd = Math.hypot(px - cx, py - cy) || 1; gx = px + (px - cx) / dd * lead.r * 0.4; gy = py + (py - cy) / dd * lead.r * 0.4; }
    else {
      let best = -1e9, ba = b.wa;
      for (let k = 0; k < 8; k++) {
        const a = b.wa + (k - 3.5) * 0.45; let n = 0;
        for (const dist of [220, 420, 650]) { const x = cx + Math.cos(a) * dist, y = cy + Math.sin(a) * dist; if (x < 0 || y < 0 || x > WS || y > WS) { n -= 25; continue; } n += grid[gi(y) * GN + gi(x)].length; }
        n -= Math.abs(k - 3.5) * 0.8; n += Math.random() * 2; if (n > best) { best = n; ba = a; }
      }
      b.wa += (ba - b.wa) * 0.5; gx = cx + Math.cos(b.wa) * (250 + lead.r); gy = cy + Math.sin(b.wa) * (250 + lead.r);
    }
    if (threats.length || vNear) {
      const gd = Math.hypot(gx - cx, gy - cy) || 1, gux = (gx - cx) / gd, guy = (gy - cy) / gd;
      let best = -1e9, bx = gux, by = guy;
      for (let k = 0; k < ND; k++) {
        const ux = DX[k], uy = DY[k]; let sc = 0;
        for (const t of threats) {
          const tx = t.x - t.px, ty = t.y - t.py, tdist = Math.hypot(tx, ty) || 1, dot = (ux * tx + uy * ty) / tdist, w = Math.max(0, (t.zone * 1.7 - tdist) / t.zone);
          sc -= w * t.w * (dot + 1) * (dot + 1) * 3;
        }
        const la = lead.r + 240, lx = cx + ux * la, ly = cy + uy * la, out = Math.max(0, -lx, lx - WS, -ly, ly - WS) / la;
        sc -= out * (threats.length ? 5 : 1.5);
        if (isBig) for (const v of spikes) {
          const vx = v.x - cx, vy = v.y - cy; if (Math.abs(vx) > lead.r + 320 || Math.abs(vy) > lead.r + 320) continue;
          const vd = Math.hypot(vx, vy) || 1, gap = vd - lead.r - v.r; if (gap > 200) continue;
          const dot = (ux * vx + uy * vy) / vd; if (dot > 0) sc -= dot * dot * 3 * (1 - Math.max(0, gap) / 200);
        }
        sc += (ux * gux + uy * guy) * (threats.length ? (tgt ? 1 : 0.4) : 2);
        if (sc > best) { best = sc; bx = ux; by = uy; }
      }
      gx = cx + bx * (320 + lead.r); gy = cy + by * (320 + lead.r);
    }
    const e = (1 - b.skill) * 45; gx += rnd(-e, e); gy += rnd(-e, e);
    b.tox = clamp(gx, 0, WS) - cx; b.toy = clamp(gy, 0, WS) - cy;
  }
  botsStep(dt) {
    for (const [o, ps] of this.own) {
      const ow = this.owners.get(o); if (!ow || ow.kind !== 'bot') continue;
      const b = ow.b; let lead = ps[0], tm = 0, cx = 0, cy = 0;
      for (const p of ps) { if (p.m > lead.m) lead = p; tm += p.m; cx += p.x * p.m; cy += p.y * p.m; } cx /= tm; cy /= tm;
      b.tt -= dt; if (b.tt <= 0) this.think(o, ps, lead, b);
      const dx = b.tox - b.ox, dy = b.toy - b.oy, d = Math.hypot(dx, dy), ms = (900 + b.skill * 1500) * (1 + Math.sqrt(lead.m) / 25) * dt;
      if (d > ms) { b.ox += dx / d * ms; b.oy += dy / d * ms; } else { b.ox = b.tox; b.oy = b.toy; }
      b.wx = cx + b.ox; b.wy = cy + b.oy;
    }
  }

  /* ---------- one simulation step ---------- */
  step(dt) {
    this.t += dt;
    const cells = this.cells, owners = this.owners, oc = this.oc, own = this.own;
    let tm = 0; oc.clear(); own.clear();
    for (const c of cells) { oc.set(c.o, (oc.get(c.o) || 0) + 1); let a = own.get(c.o); if (!a) own.set(c.o, a = []); a.push(c); tm += c.m; }
    const press = clamp(tm / (Math.max(C.BOT_FILL, owners.size) * 1500), 1, 4);
    this.botsStep(dt);
    // held feeding
    for (const cl of this.clients) {
      if (cl.dead) continue;
      if (cl.ejectOn) { cl.ejT -= dt; let n = 0; while (cl.ejT <= 0 && n++ < 4) { this.eject(cl); cl.ejT += cl.ejectMs / 1000; } } else cl.ejT = 0;
      if (cl.feedOn) { cl.fdT -= dt; let n = 0; while (cl.fdT <= 0 && n++ < 4) { this.feedOther(cl); cl.fdT += cl.ejectMs / 1000; } } else cl.fdT = 0;
    }
    // movement
    for (const c of cells) {
      c.r = rad(c.m); const ow = owners.get(c.o); let dx = 0, dy = 0;
      if (ow) { if (ow.kind === 'bot') { dx = ow.b.wx - c.x; dy = ow.b.wy - c.y; } else { dx = ow.tx - c.x; dy = ow.ty - c.y; } }
      const d = Math.hypot(dx, dy); let dvx = 0, dvy = 0;
      if (d > 2) { const s = spd(c.m) * Math.min(1, d / (c.r + 20)); dvx = dx / d * s; dvy = dy / d * s; }
      const kk = Math.min(1, dt * 7); c.ux += (dvx - c.ux) * kk; c.uy += (dvy - c.uy) * kk; c.x += c.ux * dt; c.y += c.uy * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; const k = Math.exp(-4 * dt); c.vx *= k; c.vy *= k;
      const lo = c.r * 0.5, hi = WS - c.r * 0.5;
      if (c.x < lo) { c.x = lo; c.vx = Math.abs(c.vx) * 0.5; } else if (c.x > hi) { c.x = hi; c.vx = -Math.abs(c.vx) * 0.5; }
      if (c.y < lo) { c.y = lo; c.vy = Math.abs(c.vy) * 0.5; } else if (c.y > hi) { c.y = hi; c.vy = -Math.abs(c.vy) * 0.5; }
      c.mt -= dt; c.sc -= dt; c.prot -= dt; if (c.fr > 0) c.fr -= dt;
      if (c.m > C.MAX_MASS) {
        if ((oc.get(c.o) || 0) < MAXC) {
          let sx = 0, sy = 0, n = 0; for (const p of own.get(c.o) || []) if (p !== c) { sx += p.x; sy += p.y; n++; }
          let ex = n ? c.x - sx / n : 0, ey = n ? c.y - sy / n : 0, dd = Math.hypot(ex, ey);
          if (dd < 1) { const a = rnd(0, TAU); ex = Math.cos(a); ey = Math.sin(a); dd = 1; }
          const t = this.doSplit(c, ex / dd, ey / dd); t.vx *= 0.45; t.vy *= 0.45; oc.set(c.o, (oc.get(c.o) || 0) + 1);
        } else c.m = C.MAX_MASS;
      }
      if (c.m > 1500) c.m -= c.m * Math.min(0.0049, 0.00147 * Math.sqrt(c.m / 1000)) * press * dt;
    }
    // orb vs orb: merging, eating, a short-range pull
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i]; if (a.dead) continue;
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j]; if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, lim = a.o === b.o ? rr + 150 : rr + Math.max(a.r, b.r) * 0.12 + 30;
        if (dx > lim || dx < -lim || dy > lim || dy < -lim) continue;
        const d = Math.hypot(dx, dy) || 0.01;
        if (a.o === b.o) {
          if (a.mt > 0 || b.mt > 0) {
            const ov = rr - d;
            if (ov > 0 && !(a.fr > 0 || b.fr > 0)) { const k = Math.min(1, dt * 14), px = dx / d * ov * k, py = dy / d * ov * k; a.x -= px * 0.5; a.y -= py * 0.5; b.x += px * 0.5; b.y += py * 0.5; }
          } else {
            const big = a.m >= b.m ? a : b, sm = big === a ? b : a, sg = sm === a ? 1 : -1, ux = dx / d, uy = dy / d, pull = Math.min(d, (208 + sm.r * 2.6) * dt);
            sm.x += sg * ux * pull * 0.7; sm.y += sg * uy * pull * 0.7; big.x -= sg * ux * pull * 0.3; big.y -= sg * uy * pull * 0.3;
            if (d < big.r) { const f = Math.min(sm.m, sm.m * dt * 7 + 1.5); sm.m -= f; big.m += f; if (sm.m < 2 || d < big.r - sm.r * 0.9) { big.m += sm.m; sm.dead = true; } }
          }
          continue;
        }
        const big = a.m > b.m ? a : b, sm = big === a ? b : a;
        if (big.m <= sm.m * C.EAT_RATIO || sm.prot > 0) continue;
        const sib = this.siblings(a.o, b.o);
        if (d < big.r - sm.r * 0.35) {
          big.m += sm.m; sm.dead = true;
          const bo = owners.get(big.o), so = owners.get(sm.o);
          if (bo && bo.client && !sib && so) bo.client.kills = (bo.client.kills || 0) + 1;
          continue;
        }
        const gap = d - big.r, range = big.r * 0.1 + 25;
        if (gap < range && !sib) {
          const k = 1 - Math.max(0, gap) / range, ratio = Math.min(2, big.m / sm.m / 2);
          const pull = Math.min(clamp(big.r * 0.25, 10, 90) * k * k * ratio, spd(sm.m) * 0.35) * dt, sg = sm === a ? 1 : -1;
          sm.x += sg * dx / d * pull; sm.y += sg * dy / d * pull;
        }
      }
    }
    // spikes
    for (const v of this.spikes) {
      v.x += v.vx * dt; v.y += v.vy * dt; const q = Math.exp(-3 * dt); v.vx *= q; v.vy *= q;
      if (v.x < v.r) { v.x = v.r; v.vx = Math.abs(v.vx); } else if (v.x > WS - v.r) { v.x = WS - v.r; v.vx = -Math.abs(v.vx); }
      if (v.y < v.r) { v.y = v.r; v.vy = Math.abs(v.vy); } else if (v.y > WS - v.r) { v.y = WS - v.r; v.vy = -Math.abs(v.vy); }
    }
    const pops = [];
    for (const c of cells) {
      if (c.dead || c.m < VPOP) continue;
      for (const v of this.spikes) {
        if (v.dead) continue; const dx = v.x - c.x, dy = v.y - c.y; if (Math.abs(dx) > c.r || Math.abs(dy) > c.r) continue;
        if (Math.hypot(dx, dy) + v.r <= c.r) { v.dead = true; c.m += C.SPIKE_GAIN; pops.push(c); break; }
      }
    }
    // fed mass: slide, then settle into the pellet grid
    const ejG = new Map();
    for (const f of this.ejected) {
      if (f.imm > 0) f.imm -= dt;
      if (f.sp) { const a = f.sp * dt, co = Math.cos(a), si = Math.sin(a), nx = f.vx * co - f.vy * si; f.vy = f.vx * si + f.vy * co; f.vx = nx; }
      f.x += f.vx * dt; f.y += f.vy * dt; const q = Math.exp(-5 * dt); f.vx *= q; f.vy *= q;
      if (f.x < 0) { f.x = 0; f.vx = Math.abs(f.vx) * 0.6; } else if (f.x > WS) { f.x = WS; f.vx = -Math.abs(f.vx) * 0.6; }
      if (f.y < 0) { f.y = 0; f.vy = Math.abs(f.vy) * 0.6; } else if (f.y > WS) { f.y = WS; f.vy = -Math.abs(f.vy) * 0.6; }
      if (Math.abs(f.vx) + Math.abs(f.vy) < 8 && f.imm <= 0) {
        f.dead = true;
        if (this.nSettled < C.SETTLED_EJECT_CAP) { this.grid[gi(f.y) * GN + gi(f.x)].push({ id: f.id, x: f.x, y: f.y, m: f.m, hb: (Math.round(f.hb / 30) % 12 + 12) % 12, ej: 1 }); this.nSettled++; }
        continue;
      }
      const k = gi(f.y) * GN + gi(f.x); let arr = ejG.get(k); if (!arr) ejG.set(k, arr = []); arr.push(f);
    }
    for (const c of cells) {
      if (c.dead) continue;
      const ow = owners.get(c.o), human = ow && ow.kind === 'human';
      const reach = c.r + 5, r2 = reach * reach, x0 = gi(c.x - reach), x1 = gi(c.x + reach), y0 = gi(c.y - reach), y1 = gi(c.y + reach);
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const bk = this.grid[gy * GN + gx];
        for (let q = bk.length - 1; q >= 0; q--) {
          const f = bk[q], dx = f.x - c.x, dy = f.y - c.y;
          if (dx * dx + dy * dy < r2) { c.m += human && !f.ej ? f.m * C.GROWTH : f.m; bk[q] = bk[bk.length - 1]; bk.pop(); if (f.ej) this.nSettled--; else this.nfood--; }
        }
        const ea = ejG.size ? ejG.get(gy * GN + gx) : null;
        if (ea) for (const f of ea) { if (f.dead || (f.imm > 0 && f.own === c.o)) continue; const dx = f.x - c.x, dy = f.y - c.y; if (dx * dx + dy * dy < r2) { c.m += f.m; f.dead = true; } }
      }
    }
    if (ejG.size) for (const v of this.spikes) {
      if (v.dead) continue; const x0 = gi(v.x - v.r), x1 = gi(v.x + v.r), y0 = gi(v.y - v.r), y1 = gi(v.y + v.r);
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const ea = ejG.get(gy * GN + gx); if (!ea) continue;
        for (const f of ea) {
          if (f.dead) continue; const dx = f.x - v.x, dy = f.y - v.y; if (dx * dx + dy * dy > v.r * v.r) continue;
          f.dead = true; v.fed++; const sp = Math.hypot(f.vx, f.vy); if (sp > 20) { v.dx = f.vx / sp; v.dy = f.vy / sp; }
          if (v.fed >= 7 && this.spikes.length < C.SPIKES + 20) {
            v.fed = 0; this.spikes.push({ id: this.nextCell++, x: v.x + v.dx * v.r * 2, y: v.y + v.dy * v.r * 2, r: v.r, vx: v.dx * 1100, vy: v.dy * 1100, fed: 0, dx: 1, dy: 0, dead: false });
          }
        }
      }
    }
    // cleanup and regrowth
    this.ejected = this.ejected.filter(f => !f.dead);
    this.regrow += dt * C.PELLET_REGROW; while (this.nfood < C.PELLETS && this.regrow >= 1) { this.addPellet(); this.regrow--; } if (this.regrow > 20) this.regrow = 20;
    for (const c of pops) this.popCell(c);
    this.cells = this.cells.filter(c => !c.dead);
    this.spikes = this.spikes.filter(v => !v.dead);
    this.spikeT -= dt; if (this.spikes.length < C.SPIKES && this.spikeT <= 0) { this.spawnSpike(); this.spikeT = 3; }
    this.botT -= dt; if (this.botT <= 0) { this.botT = 0.5; this.own.clear(); for (const c of this.cells) { let a = this.own.get(c.o); if (!a) this.own.set(c.o, a = []); a.push(c); } this.manageBots(); }
    // players: peaks and deaths
    for (const cl of this.clients) {
      if (cl.dead || !cl.boxes || !cl.boxes.length) continue;
      let tot = 0, any = false, activeAlive = false;
      for (const c of this.cells) { const i = cl.boxes.indexOf(c.o); if (i >= 0) { tot += c.m; any = true; if (i === cl.active) activeAlive = true; } }
      if (!any) { cl.dead = true; cl.onDeath && cl.onDeath({ peak: cl.peak, kills: cl.kills, alive: this.t - cl.born }); for (const id of cl.boxes) owners.delete(id); cl.boxes = []; continue; }
      if (!activeAlive && cl.multi) cl.active = 1 - cl.active;
      if (tot > cl.peak) cl.peak = tot;
    }
  }

  /* ---------- what one player can see ---------- */
  viewOf(cl) {
    let sx = 0, sy = 0, sm = 0, ext = 0; const mine = [];
    if (cl.boxes) for (const c of this.cells) if (cl.boxes.includes(c.o)) { mine.push(c); sx += c.x * c.m; sy += c.y * c.m; sm += c.m; }
    let cx, cy;
    if (sm) { cx = sx / sm; cy = sy / sm; for (const c of mine) ext = Math.max(ext, Math.hypot(c.x - cx, c.y - cy) + c.r); cl.lastX = cx; cl.lastY = cy; }
    else { // not playing: watch the biggest orb, or wherever this player last was
      if (cl.dead && cl.lastX !== undefined) { cx = cl.lastX; cy = cl.lastY; sm = C.START_MASS; }
      else { let big = null; for (const c of this.cells) if (!big || c.m > big.m) big = c; cx = big ? big.x : WS / 2; cy = big ? big.y : WS / 2; sm = big ? big.m : C.START_MASS; ext = big ? big.r : 0; }
    }
    const W = clamp(cl.W || 1280, 320, 3840), H = clamp(cl.H || 720, 320, 2160);
    const base = clamp(Math.min(W, H) / 600, 0.7, 1.4) * 1.35;
    const sN = Math.min(base / (1 + Math.sqrt(sm) / 26), Math.min(W, H) * 0.45 / (ext + 80));
    const vw = W / 2 / sN * C.VIEW_SCALE, vh = H / 2 / sN * C.VIEW_SCALE;
    return { x0: cx - vw, x1: cx + vw, y0: cy - vh, y1: cy + vh, cx, cy };
  }
}

module.exports = { Game, rad, gi, GN };
