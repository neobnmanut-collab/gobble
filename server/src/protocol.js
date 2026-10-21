'use strict';
// Binary messages, little-endian. The browser side lives in client/net.js and must match.
//
// Browser -> server
//   1 JOIN    u8 multibox, u16 screenW, u16 screenH, u8 party code length, party code, utf8 name
//   2 MOUSE   f32 x, f32 y          (world point the active box steers to)
//   3 SPLIT
//   4 EJECT   u8 on, u16 ms between shots
//   5 FEED    u8 on, u16 ms         (feed the other multibox box)
//   6 SWAP    f32 x, f32 y          (where the box you leave keeps heading)
//   7 RESPAWN
//   8 SIZE    u16 screenW, u16 screenH
//   9 PING    u32 token             (answered at once with PONG, for the ping display)
//  10 CHAT    u8 channel 0=everyone 1=party, utf8 text
//  11 GROWTH  u8 growth speed 1-5 (this player's own boost; sent after JOIN and whenever changed)
//
// Server -> browser
//   1 HELLO   f32 world size, u8 protocol version, f32 speed constant, u8 len + build id (changes on every deploy)
//   2 BOXES   u8 n, n x u32 owner id, u8 active index
//   3 OWNERS  u16 n, n x (u32 id, u16 hue, u8 kind 0=bot 1=player, u8 len, utf8 name)
//   4 TICK    f32 viewX, f32 viewY,
//             u16 n cells  (u32 id, u32 owner, u16 x, u16 y, u16 r*4, u32 mass)
//             u16 n spikes (u32 id, u16 x, u16 y, u16 r*4, u8 fed)
//             u16 n sliding blobs (u32 id, u16 x, u16 y, u8 hue/2)
//             u16 n pellets added (u32 id, u16 x, u16 y, u8 colour 0-11, u8 1=fed blob)
//             u16 n pellets removed (u32 id)
//   5 LEADER  u16 your rank (0 = not playing), u16 players, u8 n, n x (u32 owner, u32 mass)
//   6 MINIMAP u8 n spikes (u16 x, u16 y), u8 n big orbs (u16 x, u16 y, u16 r*4, u32 owner),
//             u8 n real players (u16 x, u16 y, u32 owner)  -- one dot per player box
//   7 DEAD    u32 peak mass, u16 orbs eaten, u32 seconds alive
//   8 FULL
//   9 PONG    u32 token
//  10 CHAT    u8 channel, u16 hue, u8 name length, name, utf8 text
//  11 PARTY   u8 code length, code, u8 n, n x u32 owner id of every box in your party
const VERSION = 2;
const Q = 65535;

function q(v, world) { const n = Math.round(v / world * Q); return n < 0 ? 0 : n > Q ? Q : n; }
function u16(v) { v = Math.round(v); return v < 0 ? 0 : v > 65535 ? 65535 : v; }
function u32(v) { v = Math.round(v); return v < 0 ? 0 : v > 4294967295 ? 4294967295 : v; }

class Writer {
  constructor(size) { this.b = Buffer.allocUnsafe(size); this.o = 0; }
  u8(v) { this.b.writeUInt8(v & 255, this.o); this.o += 1; }
  u16(v) { this.b.writeUInt16LE(u16(v), this.o); this.o += 2; }
  u32(v) { this.b.writeUInt32LE(u32(v), this.o); this.o += 4; }
  f32(v) { this.b.writeFloatLE(v, this.o); this.o += 4; }
  bytes(buf) { buf.copy(this.b, this.o); this.o += buf.length; }
  done() { return this.b.subarray(0, this.o); }
}

const enc = {
  hello(world, speed, build) { const bb = Buffer.from(String(build || ''), 'utf8').subarray(0, 40); const w = new Writer(11 + bb.length); w.u8(1); w.f32(world); w.u8(VERSION); w.f32(speed); w.u8(bb.length); w.bytes(bb); return w.done(); },
  boxes(ids, active) { const w = new Writer(3 + ids.length * 4); w.u8(2); w.u8(ids.length); for (const id of ids) w.u32(id); w.u8(active); return w.done(); },
  owners(list) {
    const names = list.map(o => Buffer.from(String(o.name).slice(0, 16), 'utf8').subarray(0, 48));
    let size = 3; for (const n of names) size += 8 + n.length;
    const w = new Writer(size); w.u8(3); w.u16(list.length);
    list.forEach((o, i) => { w.u32(o.id); w.u16(o.hue); w.u8(o.kind === 'human' ? 1 : 0); w.u8(names[i].length); w.bytes(names[i]); });
    return w.done();
  },
  tick(world, vx, vy, cells, spikes, ejected, added, removed) {
    const w = new Writer(9 + 2 + cells.length * 18 + 2 + spikes.length * 11 + 2 + ejected.length * 9 + 2 + added.length * 10 + 2 + removed.length * 4);
    w.u8(4); w.f32(vx); w.f32(vy);
    w.u16(cells.length); for (const c of cells) { w.u32(c.id); w.u32(c.o); w.u16(q(c.x, world)); w.u16(q(c.y, world)); w.u16(c.r * 4); w.u32(c.m); }
    w.u16(spikes.length); for (const v of spikes) { w.u32(v.id); w.u16(q(v.x, world)); w.u16(q(v.y, world)); w.u16(v.r * 4); w.u8(v.fed); }
    w.u16(ejected.length); for (const f of ejected) { w.u32(f.id); w.u16(q(f.x, world)); w.u16(q(f.y, world)); w.u8((f.hb % 360) / 2); }
    w.u16(added.length); for (const f of added) { w.u32(f.id); w.u16(q(f.x, world)); w.u16(q(f.y, world)); w.u8(f.hb); w.u8(f.ej ? 1 : 0); }
    w.u16(removed.length); for (const id of removed) w.u32(id);
    return w.done();
  },
  leader(rank, total, top) { const w = new Writer(6 + top.length * 8); w.u8(5); w.u16(rank); w.u16(total); w.u8(top.length); for (const t of top) { w.u32(t.id); w.u32(t.m); } return w.done(); },
  minimap(world, spikes, big, people) {
    const w = new Writer(4 + spikes.length * 4 + big.length * 10 + people.length * 8); w.u8(6);
    w.u8(spikes.length); for (const v of spikes) { w.u16(q(v.x, world)); w.u16(q(v.y, world)); }
    w.u8(big.length); for (const c of big) { w.u16(q(c.x, world)); w.u16(q(c.y, world)); w.u16(c.r * 4); w.u32(c.o); }
    w.u8(people.length); for (const p of people) { w.u16(q(p.x, world)); w.u16(q(p.y, world)); w.u32(p.o); }
    return w.done();
  },
  dead(peak, kills, alive) { const w = new Writer(11); w.u8(7); w.u32(peak); w.u16(kills); w.u32(alive); return w.done(); },
  full() { return Buffer.from([8]); },
  chat(channel, hue, name, text) {
    const nb = Buffer.from(String(name).slice(0, 16), 'utf8').subarray(0, 48), tb = Buffer.from(String(text), 'utf8').subarray(0, 400);
    const w = new Writer(5 + nb.length + tb.length); w.u8(10); w.u8(channel); w.u16(hue); w.u8(nb.length); w.bytes(nb); w.bytes(tb); return w.done();
  },
  party(code, ids) {
    const cb = Buffer.from(String(code || ''), 'utf8').subarray(0, 16), list = ids.slice(0, 64);
    const w = new Writer(3 + cb.length + list.length * 4); w.u8(11); w.u8(cb.length); w.bytes(cb); w.u8(list.length); for (const id of list) w.u32(id); return w.done();
  },
  pong(token) { const w = new Writer(5); w.u8(9); w.u32(token); return w.done(); },
};

// returns null for anything malformed
function decode(buf) {
  if (!buf || buf.length < 1) return null;
  const op = buf[0];
  try {
    switch (op) {
      case 1: { if (buf.length < 7) return null; const pl = Math.min(buf[6], 16); return { op, multi: !!buf[1], W: buf.readUInt16LE(2), H: buf.readUInt16LE(4), party: buf.subarray(7, 7 + pl).toString('utf8'), name: buf.subarray(7 + pl, 7 + pl + 48).toString('utf8') }; }
      case 2: case 6: if (buf.length < 9) return null; { const x = buf.readFloatLE(1), y = buf.readFloatLE(5); if (!Number.isFinite(x) || !Number.isFinite(y)) return null; return { op, x, y }; }
      case 3: case 7: return { op };
      case 4: case 5: if (buf.length < 4) return null; return { op, on: !!buf[1], ms: buf.readUInt16LE(2) };
      case 8: if (buf.length < 5) return null; return { op, W: buf.readUInt16LE(1), H: buf.readUInt16LE(3) };
      case 9: if (buf.length < 5) return null; return { op, token: buf.readUInt32LE(1) };
      case 11: if (buf.length < 2) return null; return { op, growth: buf[1] };
      case 10: if (buf.length < 3) return null; return { op, channel: buf[1] === 1 ? 1 : 0, text: buf.subarray(2, 2 + 240).toString('utf8') };
      default: return null;
    }
  } catch (e) { return null; }
}

module.exports = { enc, decode, VERSION };
