'use strict';
// Load test: starts the server, connects simulated players that wander, split and feed,
// decodes every message with the real browser decoder, and reports server cost and bandwidth.
// Usage: node test/load.js [players=60] [seconds=30]
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const Net = require(path.join(__dirname, '..', '..', 'client', 'net.js'));

const N = +process.argv[2] || 60, SECS = +process.argv[3] || 30, PORT = 8123;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, PORT, LOG_STATS: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
const statLines = []; srv.stdout.on('data', d => { const s = String(d); process.stdout.write('  server: ' + s); statLines.push(s); });

const toAB = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
let bytes = 0, msgs = 0, decodeErrors = 0, deaths = 0, maxCells = 0, maxPellets = 0, splits = 0;
const bots = [];
function bot(i) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); let world = 12000, me = [], view = { x: 6000, y: 6000 };
  const st = { pellets: new Set() };
  ws.on('message', data => {
    bytes += data.length; msgs++;
    let m; try { m = Net.decode(toAB(data), world); } catch (e) { decodeErrors++; return; }
    if (!m) { decodeErrors++; return; }
    if (m.op === 1) { world = m.world; ws.send(Buffer.from(Net.enc.join(i % 3 === 0, 1920, 1080, 'Load' + i))); }
    if (m.op === 2) me = m.ids;
    if (m.op === 4) {
      view = { x: m.vx, y: m.vy }; maxCells = Math.max(maxCells, m.cells.length);
      for (const f of m.added) st.pellets.add(f.id); for (const id of m.removed) st.pellets.delete(id);
      maxPellets = Math.max(maxPellets, st.pellets.size);
    }
    if (m.op === 7) { deaths++; setTimeout(() => ws.readyState === 1 && ws.send(Buffer.from(Net.enc.join(i % 3 === 0, 1920, 1080, 'Load' + i))), 500); }
  });
  let a = Math.random() * 6.28;
  const iv = setInterval(() => {
    if (ws.readyState !== 1) return;
    a += (Math.random() - 0.5) * 0.6;
    ws.send(Buffer.from(Net.enc.mouse(view.x + Math.cos(a) * 600, view.y + Math.sin(a) * 600)));
    const r = Math.random();
    if (r < 0.01) { ws.send(Buffer.from(Net.enc.split())); splits++; }
    else if (r < 0.02) ws.send(Buffer.from(Net.enc.eject(true, 40)));
    else if (r < 0.04) ws.send(Buffer.from(Net.enc.eject(false, 40)));
    else if (r < 0.045) ws.send(Buffer.from(Net.enc.swap(view.x, view.y)));
  }, 33);
  bots.push({ ws, iv });
}

setTimeout(() => {
  for (let i = 0; i < N; i++) setTimeout(() => bot(i), i * 20);
  const t0 = Date.now();
  setTimeout(async () => {
    const secs = (Date.now() - t0) / 1000 - N * 0.02;
    const h = await fetch(`http://127.0.0.1:${PORT}/health`).then(r => r.json());
    console.log(`\n${N} simulated players for ${SECS}s`);
    console.log(`  health: ${JSON.stringify(h)}`);
    console.log(`  per player: ${(bytes / N / secs / 1024).toFixed(1)} KB/s down, ${(msgs / N / secs).toFixed(1)} messages/s`);
    console.log(`  decode errors: ${decodeErrors}, deaths: ${deaths}, splits sent: ${splits}, most orbs in one view: ${maxCells}, most pellets known: ${maxPellets}`);
    for (const b of bots) { clearInterval(b.iv); b.ws.close(); }
    srv.kill(); setTimeout(() => process.exit(0), 300);
  }, SECS * 1000);
}, 800);
