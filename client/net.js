// Browser side of the binary protocol. Must match server/src/protocol.js.
(function (root) {
  'use strict';
  const Q = 65535;
  const te = new TextEncoder(), td = new TextDecoder();

  function decode(ab, world) {
    const dv = new DataView(ab); let o = 0;
    const u8 = () => dv.getUint8(o++);
    const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
    const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
    const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
    const pos = () => u16() / Q * world;
    const op = u8();
    switch (op) {
      case 1: { const world = f32(), version = u8(), speed = o + 4 <= ab.byteLength ? f32() : 1685; let build = ''; if (o < ab.byteLength) { const n = u8(); build = td.decode(new Uint8Array(ab, o, n)); } return { op, world, version, speed, build }; }
      case 2: { const n = u8(), ids = []; for (let i = 0; i < n; i++) ids.push(u32()); return { op, ids, active: u8() }; }
      case 3: {
        const n = u16(), list = [];
        for (let i = 0; i < n; i++) { const id = u32(), hue = u16(), kind = u8(), len = u8(); const name = td.decode(new Uint8Array(ab, o, len)); o += len; list.push({ id, hue, human: kind === 1, name }); }
        return { op, list };
      }
      case 4: {
        const vx = f32(), vy = f32();
        const cells = []; let n = u16();
        for (let i = 0; i < n; i++) cells.push({ id: u32(), o: u32(), x: pos(), y: pos(), r: u16() / 4, m: u32() });
        const spikes = []; n = u16();
        for (let i = 0; i < n; i++) spikes.push({ id: u32(), x: pos(), y: pos(), r: u16() / 4, fed: u8() });
        const blobs = []; n = u16();
        for (let i = 0; i < n; i++) blobs.push({ id: u32(), x: pos(), y: pos(), hue: u8() * 2 });
        const added = []; n = u16();
        for (let i = 0; i < n; i++) added.push({ id: u32(), x: pos(), y: pos(), hb: u8(), ej: u8() === 1 });
        const removed = []; n = u16();
        for (let i = 0; i < n; i++) removed.push(u32());
        return { op, vx, vy, cells, spikes, blobs, added, removed };
      }
      case 5: { const rank = u16(), total = u16(), n = u8(), top = []; for (let i = 0; i < n; i++) top.push({ id: u32(), m: u32() }); let players = -1, bots = -1; if (o + 4 <= ab.byteLength) { players = u16(); bots = u16(); } return { op, rank, total, top, players, bots }; }
      case 6: {
        const spikes = []; let n = u8(); for (let i = 0; i < n; i++) spikes.push({ x: pos(), y: pos() });
        const big = []; n = u8(); for (let i = 0; i < n; i++) big.push({ x: pos(), y: pos(), r: u16() / 4, o: u32() });
        const people = []; if (o < ab.byteLength) { n = u8(); for (let i = 0; i < n; i++) people.push({ x: pos(), y: pos(), o: u32() }); }
        return { op, spikes, big, people };
      }
      case 7: return { op, peak: u32(), kills: u16(), alive: u32() };
      case 8: return { op };
      case 9: return { op, token: u32() };
      case 10: { const channel = u8(), hue = u16(), nl = u8(); const name = td.decode(new Uint8Array(ab, o, nl)); o += nl; return { op, channel, hue, name, text: td.decode(new Uint8Array(ab, o)) }; }
      case 11: { const cl = u8(); const code = td.decode(new Uint8Array(ab, o, cl)); o += cl; const n = u8(), ids = []; for (let i = 0; i < n; i++) ids.push(u32()); return { op, code, ids }; }
      default: return null;
    }
  }

  function msg(size, fill) { const ab = new ArrayBuffer(size), dv = new DataView(ab); fill(dv); return ab; }
  const enc = {
    join(multi, W, H, name, party) {
      const nb = te.encode(String(name).slice(0, 14)).slice(0, 48), pb = te.encode(String(party || '')).slice(0, 16);
      const ab = new ArrayBuffer(7 + pb.length + nb.length), dv = new DataView(ab);
      dv.setUint8(0, 1); dv.setUint8(1, multi ? 1 : 0); dv.setUint16(2, Math.min(65535, W | 0), true); dv.setUint16(4, Math.min(65535, H | 0), true);
      dv.setUint8(6, pb.length); new Uint8Array(ab, 7).set(pb); new Uint8Array(ab, 7 + pb.length).set(nb); return ab;
    },
    name(n) { const nb = te.encode(String(n).slice(0, 14)).slice(0, 48), ab = new ArrayBuffer(1 + nb.length); new Uint8Array(ab)[0] = 12; new Uint8Array(ab, 1).set(nb); return ab; },
    growth(v) { return msg(2, d => { d.setUint8(0, 11); d.setUint8(1, v); }); },
    chat(channel, text) {
      const tb = te.encode(String(text).slice(0, 120)).slice(0, 240), ab = new ArrayBuffer(2 + tb.length);
      new Uint8Array(ab)[0] = 10; new Uint8Array(ab)[1] = channel ? 1 : 0; new Uint8Array(ab, 2).set(tb); return ab;
    },
    mouse(x, y) { return msg(9, d => { d.setUint8(0, 2); d.setFloat32(1, x, true); d.setFloat32(5, y, true); }); },
    split() { return msg(1, d => d.setUint8(0, 3)); },
    eject(on, ms) { return msg(4, d => { d.setUint8(0, 4); d.setUint8(1, on ? 1 : 0); d.setUint16(2, ms, true); }); },
    feed(on, ms) { return msg(4, d => { d.setUint8(0, 5); d.setUint8(1, on ? 1 : 0); d.setUint16(2, ms, true); }); },
    swap(x, y) { return msg(9, d => { d.setUint8(0, 6); d.setFloat32(1, x, true); d.setFloat32(5, y, true); }); },
    respawn() { return msg(1, d => d.setUint8(0, 7)); },
    ping(token) { return msg(5, d => { d.setUint8(0, 9); d.setUint32(1, token >>> 0, true); }); },
    size(W, H) { return msg(5, d => { d.setUint8(0, 8); d.setUint16(1, Math.min(65535, W | 0), true); d.setUint16(3, Math.min(65535, H | 0), true); }); },
  };

  const Net = { decode, enc };
  root.Net = Net;
  if (typeof module !== 'undefined' && module.exports) module.exports = Net;
})(typeof self !== 'undefined' ? self : globalThis);
