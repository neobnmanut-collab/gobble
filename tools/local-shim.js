// Runs the real game server inside the browser page, so the game can be played without any network:
// a tiny Buffer, require() and WebSocket stand-in let server/src/*.js run unchanged next to the client.
(function () {
'use strict';
const te = new TextEncoder(), td = new TextDecoder();
class Buf extends Uint8Array {
  static allocUnsafe(n) { return new Buf(n); }
  static from(v) { if (typeof v === 'string') { const u = te.encode(v); const b = new Buf(u.length); b.set(u); return b; } const b = new Buf(v.length); b.set(v); return b; }
  dv() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
  writeUInt8(v, o) { this[o] = v & 255; return o + 1; }
  writeUInt16LE(v, o) { this.dv().setUint16(o, v, true); return o + 2; }
  writeUInt32LE(v, o) { this.dv().setUint32(o, v, true); return o + 4; }
  writeFloatLE(v, o) { this.dv().setFloat32(o, v, true); return o + 4; }
  readUInt16LE(o) { return this.dv().getUint16(o, true); }
  readUInt32LE(o) { return this.dv().getUint32(o, true); }
  readFloatLE(o) { return this.dv().getFloat32(o, true); }
  copy(target, at) { target.set(this, at || 0); return this.length; }
  toString() { return td.decode(this); }
}

// tiny module system for the server files
const defs = {}, cache = {};
function req(name) {
  name = name.replace(/^\.\//, '');
  if (cache[name]) return cache[name].exports;
  const m = cache[name] = { exports: {} };
  defs[name](m, m.exports, req, '.');
  return m.exports;
}
window.__defineModule = (name, fn) => { defs[name] = fn; };

// what the server needs from Node, reduced to what runs in a page
let onConnection = null;
defs.http = m => { m.exports = { createServer: () => ({ listen: (p, h, cb) => cb && cb() }) }; };
defs.fs = m => { m.exports = {}; };
defs.path = m => { m.exports = { resolve: (...a) => a.join('/'), join: (...a) => a.join('/'), sep: '/', extname: () => '' }; };
defs.ws = m => { m.exports = { WebSocketServer: class { constructor() {} on(ev, fn) { if (ev === 'connection') onConnection = fn; } } }; };
window.process = { env: {}, uptime: () => performance.now() / 1000 };
window.Buffer = Buf;

// the game page's "WebSocket": talks straight to the server running in this page
class LocalSocket {
  constructor() {
    this.readyState = 0; this.binaryType = 'arraybuffer';
    const page = this, handlers = {};
    // the server's side of this connection
    this.peer = {
      readyState: 1, bufferedAmount: 0, binaryType: 'nodebuffer',
      on(ev, fn) { handlers[ev] = fn; },
      send(buf) { if (page.readyState !== 1) return; const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length); setTimeout(() => page.readyState === 1 && page.onmessage && page.onmessage({ data: ab }), 0); },
      ping() { handlers.pong && handlers.pong(); }, terminate() { page.close(); },
    };
    this.handlers = handlers;
    setTimeout(() => {
      this.readyState = 1; this.onopen && this.onopen();
      if (onConnection) onConnection(this.peer, {});
    }, 0);
  }
  send(ab) { if (this.readyState !== 1) return; const b = new Buf(ab.byteLength || ab.length); b.set(new Uint8Array(ab.buffer ? ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength) : ab)); setTimeout(() => this.handlers.message && this.handlers.message(b, true), 0); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.peer.readyState = 3; this.handlers.close && this.handlers.close(); this.onclose && this.onclose({}); }
}
window.WebSocket = LocalSocket;
window.__startLocalServer = () => req('server');
window.GAME_SERVERS = [{ id: 'local', name: 'This page', url: 'local://game' }];
})();
