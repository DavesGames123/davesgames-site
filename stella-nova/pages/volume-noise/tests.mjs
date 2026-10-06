// ============================================================================
//  VOLUME NOISE  ·  tests.mjs — the CPU port, the WGSL port and the tiling
// ----------------------------------------------------------------------------
//  node stella-nova/pages/volume-noise/tests.mjs [--port 9780]
//       [--server http://127.0.0.1:8963] [--cpu-only]
//
//  CPU part (Node only, noise-ref.js):
//    cpu.hash ....... the hash table equals hash(n); valueNoise at a lattice
//                     point equals hash(n) (the shortcut that noise.wgsl takes)
//    cpu.period ..... each function and each texel recipe repeats with period
//                     1 on x, y and z: f(p + 1) = f(p)
//    cpu.slope ...... the central difference at the wrap (p = 1) equals the
//                     one at p = 0, so the slope is continuous too
//  GPU part (headless Chrome over CDP; a static server must serve the repo
//  root at --server, and --port must be a free Chrome debug port):
//    gpu.load ....... the page boots: no exception, console error or WebGPU
//                     validation error
//    gpu.voxels ..... read back voxels of the shape, parts, detail and weather
//                     textures (main.cpp values) and compare each byte with
//                     noise-ref.js; a second run with seed 7 at 64^3
//    gpu.roll ....... the textures made with the coordinate moved by half a
//                     period equal the first textures rolled by N/2, byte for
//                     byte (main.js roll): the GPU noise repeats, and the wrap
//                     seam (x = N-1 -> 0) becomes an inner step
//    seam plane ..... INFO only: the mean step across the seam plane among
//                     all N planes (main.js seamStats)
//  Exit code 0 when every test passes.
// ============================================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as R from './noise-ref.js';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const PORT = +opt('port', 9780);
const SERVER = opt('server', 'http://127.0.0.1:8963');
const PAGE = `${SERVER}/stella-nova/pages/volume-noise/index.html`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const report = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };

// ── CPU ────────────────────────────────────────────────────────────────────
function cpuTests() {
  const rnd = lcg(11);
  {
    const t = R.hashTable(0), t7 = R.hashTable(7);
    let bad = 0;
    for (let i = 0; i < 400; i++) {
      const n = Math.floor(rnd() * R.TABLE_LEN);
      if (t[n] !== R.hash(n) || t7[n] !== R.hash(n + 7 * R.SEED_STRIDE)) bad++;
      const x = Math.floor(rnd() * 128), y = Math.floor(rnd() * 128), z = Math.floor(rnd() * 128);
      if (R.valueNoise(x, y, z) !== t[x + 57 * y + 113 * z]) bad++;
      if (R.valueNoise(x, y, z, 7) !== t7[x + 57 * y + 113 * z]) bad++;
    }
    report('cpu.hash', bad === 0, `${bad} mismatches in 1200 checks (table, seeded table, lattice valueNoise)`);
  }
  // Functions of a point in [0,1)^3 that must repeat with period 1.
  const N = 128, P = R.RECIPE;
  const fns = {
    perlinFBM: (x, y, z) => R.perlinNoise(x, y, z, 8, 3),
    perlinFBM_w: (x, y, z) => R.perlinNoise(x, y, z, 5, 4, R.perlinW(7)),
    worley4: (x, y, z) => R.worleyNoise(x, y, z, 4),
    worley56_seed: (x, y, z) => R.worleyNoise(x, y, z, 56, 7),
    shapeR: (x, y, z) => R.shapeTexel(x * N, y * N, z * N, N, P).rgba[0],
    shapeA: (x, y, z) => R.shapeTexel(x * N, y * N, z * N, N, P).rgba[3],
    packed: (x, y, z) => R.shapeTexel(x * N, y * N, z * N, N, P).parts[3],
    detailR: (x, y, z) => R.detailTexel(x * 32, y * 32, z * 32, 32, P).rgba[0],
    detailPacked: (x, y, z) => R.detailTexel(x * 32, y * 32, z * 32, 32, P).rgba[3],
  };
  let worstV = 0, worstS = 0, slopes = 0;
  const eps = 1e-4;
  for (const [name, f] of Object.entries(fns)) {
    for (let i = 0; i < 40; i++) {
      const p = [rnd(), rnd(), rnd()];
      for (let a = 0; a < 3; a++) {
        const q = p.slice(); q[a] += 1;
        worstV = Math.max(worstV, Math.abs(f(...p) - f(...q)));
        // Slope across the wrap (coordinate 1) and at 0, on axis a.
        const at = v => { const r = p.slice(); r[a] = v; return f(...r); };
        const s1 = (at(1 + eps) - at(1 - eps)) / (2 * eps), s0 = (at(eps) - at(-eps)) / (2 * eps);
        worstS = Math.max(worstS, Math.abs(s1 - s0)); slopes++;
      }
    }
    void name;
  }
  report('cpu.period', worstV < 1e-9, `max |f(p+1) - f(p)| = ${worstV.toExponential(2)} over ${Object.keys(fns).length} functions x 40 points x 3 axes`);
  report('cpu.slope', worstS < 1e-5, `max |slope(1) - slope(0)| = ${worstS.toExponential(2)} over ${slopes} central differences (eps ${eps})`);
}

// ── GPU (headless Chrome) ──────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function gpuTests() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-test-'));
  const chrome = spawn(CHROME, ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
  const log = [];
  let ws;
  try {
    let list = null;
    for (let i = 0; i < 60 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { await sleep(250); } }
    if (!list) throw new Error('chrome did not start on port ' + PORT);
    ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') log.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) log.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') log.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) log.push('http ' + m.params.response.status + ' ' + m.params.response.url);
    };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r && r.result ? r.result.value : r; };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Log.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.navigate', { url: PAGE });
    let st = null;
    for (let i = 0; i < 240; i++) { await sleep(250); st = await ev(`window.__vn ? { ready: __vn.ready, failed: __vn.failed } : null`); if (st && (st.ready || st.failed)) break; }
    await sleep(800);
    const gpuErr = await ev('__vn.errors');
    const loadOk = st && st.ready && !st.failed && !log.length && !gpuErr.length;
    report('gpu.load', loadOk, loadOk ? `ready, genMs ${(await ev('__vn.gpu.genMs')).toFixed(1)}` : JSON.stringify({ st, log, gpuErr }));
    if (!st || !st.ready) return;

    const compare = async (label, prm) => {
      const rnd = lcg(prm.seed + 3);
      const N = prm.shapeRes, list = [];
      const pick = n => Math.floor(rnd() * n);
      for (let i = 0; i < 260; i++) {
        const v = [pick(N), pick(N), pick(N)];
        if (i % 4 === 0) v[i % 3] = (i % 8 === 0) ? 0 : N - 1;   // seam voxels
        list.push(['shape', ...v], ['parts', ...v]);
      }
      for (let i = 0; i < 120; i++) list.push(['detail', pick(32), pick(32), pick(32)]);
      for (let i = 0; i < 120; i++) list.push(['weather', pick(256), pick(256), 0]);
      const got = await ev(`__vn.sample(${JSON.stringify(list)})`);
      const stats = {};
      list.forEach(([tex, x, y, z], i) => {
        const ref = tex === 'weather' ? R.weatherTexel(x, y, 256, prm).rgba
          : tex === 'detail' ? R.detailTexel(x, y, z, 32, prm).rgba
          : tex === 'shape' ? R.shapeTexel(x, y, z, N, prm).rgba : R.shapeTexel(x, y, z, N, prm).parts;
        for (let c = 0; c < 4; c++) {
          const k = tex + '.' + 'rgba'[c], s = stats[k] || (stats[k] = { n: 0, exact: 0, max: 0 });
          const d = Math.abs(got[i][c] - R.q8(ref[c]));
          s.n++; if (d === 0) s.exact++; s.max = Math.max(s.max, d);
        }
      });
      const worst = Math.max(...Object.values(stats).map(s => s.max));
      const exact = Object.values(stats).reduce((a, s) => a + s.exact, 0) / Object.values(stats).reduce((a, s) => a + s.n, 0);
      const ok = worst <= 2 && exact >= 0.95;
      report(label, ok, `${list.length} voxels; bytes equal ${(100 * exact).toFixed(2)}%, max diff ${worst}/255; ` +
        Object.entries(stats).map(([k, s]) => `${k} ${s.exact}/${s.n} max ${s.max}`).join(', '));
    };
    await compare('gpu.voxels main.cpp 128^3', R.RECIPE);

    // The wrap: a half-period shift must equal the rolled texture, byte for byte.
    for (const res of [128, 32]) {
      const rr = await ev(`__vn.roll(${JSON.stringify({ ...R.RECIPE, shapeRes: res })})`);
      const ok = Object.values(rr).every(r => r.eq === r.n);
      report(`gpu.roll ${res}^3`, ok, Object.entries(rr).map(([t, r]) => `${t} ${r.size} ${r.eq}/${r.n} bytes equal (max diff ${r.max})`).join(', '));
    }
    // The seam plane among all planes. Informative only: the Worley points sit
    // on the cell diagonals, so planes on a cell border differ from the others,
    // and the seam is such a plane. gpu.roll is the pass/fail tiling check.
    const seams = await ev('__vn.seamStats()');
    let zmax = -Infinity, over = 0, n = 0, where = '', nearMax = 0;
    for (const [tex, rows] of Object.entries(seams)) for (const r of rows) for (const kind of ['step', 'change']) {
      const q = r[kind]; n++;
      if (q.near > 0.05) nearMax = Math.max(nearMax, q.seam / q.near);
      const z = q.sd > 0 ? (q.seam - q.mean) / q.sd : 0;
      if (z > zmax) { zmax = z; where = `${tex}.${'rgba'[r.c]} ${r.axis} ${kind}`; }
      if (q.seam > q.max) over++;
    }
    console.log(`INFO  gpu.seamplane  ${n} plane statistics: the seam plane has the largest mean step of all N planes in ${over}; highest seam z-score ${zmax.toFixed(2)} (${where}); largest seam / neighbour-plane (1, 2, N-1, N-2) ratio ${nearMax.toFixed(3)}`);

    const prm7 = { ...R.RECIPE, seed: 7, shapeRes: 64 };
    await ev(`__vn.generate(${JSON.stringify(prm7)})`);
    await compare('gpu.voxels seed 7 64^3', prm7);
    const late = await ev('__vn.errors');
    report('gpu.noerrors', !log.length && !late.length, log.length || late.length ? JSON.stringify({ log, late }) : 'no console, exception or WebGPU errors');
  } finally {
    try { ws && ws.close(); } catch (e) {}
    chrome.kill('SIGKILL');
    await sleep(300);
    fs.rmSync(prof, { recursive: true, force: true });
  }
}

cpuTests();
if (!argv.includes('--cpu-only')) {
  try { await gpuTests(); } catch (e) { report('gpu', false, String(e && e.stack || e)); }
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
