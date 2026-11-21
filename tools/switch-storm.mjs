#!/usr/bin/env node
// ============================================================================
//  tools/switch-storm.mjs — browser stress test of the shell page swap
// ----------------------------------------------------------------------------
//  Loads stella-nova/index.html in headless Chrome and calls switchTab very
//  fast, as a user does who clicks through the sidebar. It measures the
//  hangs and crashes that the node checks (tools/shell-nav-check.mjs) can
//  not see.
//
//  Same-origin iframes share the main thread of the shell. A page that does
//  long synchronous work at load (a large parse, a wasm compile, a big
//  geometry build) stops the shell too, and the clicks wait in the queue.
//
//  Phases
//    solo      one switch to each page of the pool, then 2.5 s of watch.
//              Gives the stall that each page alone causes (worst pages).
//    storm     N switches at a fixed interval over the pool, for each
//              interval of --intervals. Then the settle wait.
//
//  Measures, for each phase
//    gap       the longest gap of a 10 ms setTimeout heartbeat in the shell
//              (the main thread did not run for that time)
//    longtask  the count and the longest Performance long task
//    settle    time from the last switchTab to the load event of the frame
//              of the last tab (storm only)
//    frames    iframes in #frame-wrap at the end (must be 1)
//    heap      JSHeapUsedSize of the tab (Performance.getMetrics)
//    gpu       phys_footprint of the GPU process (`footprint <pid>`, macOS)
//    crash     Inspector.targetCrashed or a detach of the tab
//    click     the latency of each switchTab call (a CDP round trip that
//              waits for the main thread, as a real click does)
//    idle      GPU footprint and heap at home, 5 s after the last storm
//
//  Limits (exit 1 when one fails): storm gap <= --max-gap ms (default
//  1500), settle <= --max-settle ms (default 8000), one frame at the end,
//  no crash.
//
//  No screenshots and no recordings. The Chrome profile is a temp directory
//  in --tmp (default: $TMPDIR). The tool deletes it at the end, also on
//  an error.
//
//  Usage (repo root):
//    node tools/switch-storm.mjs                      default pool and storms
//    node tools/switch-storm.mjs --pool 24 --switches 60 --intervals 30,60,120,250
//    node tools/switch-storm.mjs --pages a,b,c        a fixed pool
//    node tools/switch-storm.mjs --no-solo            storms only
//    node tools/switch-storm.mjs --json out.json      also write the results
//    node tools/switch-storm.mjs --inject f.js        run f.js in the shell first
//                                                     (try a doSwap change with
//                                                     no edit to index.html)
//
//  grep -n targets: "function heavyPages", "const HEARTBEAT", "async function storm",
//  "async function solo", "function gpuFootprint", "const LIMITS"
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes('--' + k);
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const POOL = Number(arg('pool', 24));
const SWITCHES = Number(arg('switches', 60));
const INTERVALS = arg('intervals', '30,60,120,250').split(',').map(Number);
const SEED = Number(arg('seed', 7));
const TMP = arg('tmp', os.tmpdir());
const LIMITS = { gap: Number(arg('max-gap', 1500)), settle: Number(arg('max-settle', 8000)) };

// ── static server ─────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.wgsl': 'text/plain', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.gz': 'application/gzip' };
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, path.normalize(p));
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.stat(f, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ── page pool ─────────────────────────────────────────────────────────────
// Heavy pages first: a page scores by the bytes of its own scripts and
// data, and gets extra score for WebGPU, WebGL and wasm. The rest of the
// pool is random pages (seeded), so the storm also crosses light pages.
function dirBytes(d, depth = 0) {
  let n = 0, tags = '';
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (depth < 3 && !/^(media|thumbs|node_modules)$/.test(e.name)) { const r = dirBytes(f, depth + 1); n += r.n; tags += r.tags; } continue; }
    if (!/\.(js|mjs|json|wasm|wgsl|bin)$/.test(e.name)) continue;
    const s = fs.statSync(f).size; n += s;
    if (e.name.endsWith('.wasm')) tags += 'W';
    if (s < 2e6 && /\.(js|mjs)$/.test(e.name)) { const t = fs.readFileSync(f, 'utf8'); if (t.includes('requestAdapter')) tags += 'G'; if (/getContext\(['"]webgl/.test(t) || t.includes('WebGLRenderer')) tags += 'L'; }
  }
  return { n, tags };
}
function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function heavyPages(pages, count) {
  const scored = pages.filter(p => p.key !== 'home').map(p => {
    const dir = path.join(ROOT, 'stella-nova', path.dirname(p.path));
    let r = { n: 0, tags: '' }; try { r = dirBytes(dir); } catch (e) {}
    const kinds = new Set(r.tags);
    return { key: p.key, bytes: r.n, kinds: [...kinds].join(''), score: r.n * (1 + kinds.size) };
  }).sort((a, b) => b.score - a.score);
  const heavy = scored.slice(0, Math.ceil(count * 2 / 3));
  const rest = scored.slice(heavy.length), rnd = rand(SEED);
  while (heavy.length < count && rest.length) heavy.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
  return heavy;
}

// ── CDP ───────────────────────────────────────────────────────────────────
async function launch(profile) {
  const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1440,900', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  ch.stderr.on('data', d => { err += d; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(portFile)) { const [port, p] = fs.readFileSync(portFile, 'utf8').trim().split('\n'); if (p) return { ch, url: `ws://127.0.0.1:${port}${p}` }; }
    await sleep(100);
  }
  ch.kill('SIGKILL');
  throw new Error('Chrome did not start: ' + err.slice(0, 400));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const wait = new Map(), on = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { const w = wait.get(d.id); wait.delete(d.id); d.error ? w.no(new Error(d.error.message)) : w.ok(d.result); }
    else for (const f of on) f(d);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const i = ++id; wait.set(i, { ok, no }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  return new Promise((ok, no) => { ws.onopen = () => ok({ send, on: f => on.push(f), close: () => ws.close() }); ws.onerror = () => no(new Error('CDP socket error')); });
}

// ── GPU footprint (macOS) ─────────────────────────────────────────────────
function gpuFootprint(pid) {
  if (!pid) return null;
  try {
    const t = execFileSync('footprint', [String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    const m = t.match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/i) || t.match(/phys_footprint:\s*([\d.]+)\s*(KB|MB|GB)/i);
    if (!m) return null;
    return Math.round(Number(m[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2].toUpperCase()]);
  } catch (e) { return null; }
}

// ── the shell probe ───────────────────────────────────────────────────────
// Runs in the shell window. A 10 ms setTimeout chain records the longest
// gap and the tab that was active then. A PerformanceObserver records long
// tasks (also those of same-origin child frames). __storm.reset() starts a
// new phase. __storm.loaded records the load time of each mounted frame.
const HEARTBEAT = `(() => {
  const tab = () => { const e = document.getElementById('topbar-active'); return e ? e.textContent : '?'; };
  const S = window.__storm = { gap: 0, gapTab: '', gaps: [], lt: 0, ltMax: 0, ltTab: '', loads: {}, mounted: 0, phase: '' };
  let last = performance.now();
  (function beat() { const n = performance.now(), g = n - last; last = n;
    if (g > S.gap) { S.gap = g; S.gapTab = tab(); }
    if (g > 200) S.gaps.push([Math.round(g), tab(), String(window.pendingTab)]);
    setTimeout(beat, 10); })();
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) { S.lt++; if (e.duration > S.ltMax) { S.ltMax = e.duration; S.ltTab = tab(); } } }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const wrap = document.getElementById('frame-wrap');
  new MutationObserver(ms => { for (const m of ms) for (const f of m.addedNodes) if (f.tagName === 'IFRAME') { S.mounted++; const src = f.getAttribute('src'), t0 = performance.now();
    f.addEventListener('load', () => { if (f.contentWindow && f.contentWindow.location.href !== 'about:blank') S.loads[src] = performance.now() - t0; }); } }).observe(wrap, { childList: true });
  S.reset = p => { S.gap = 0; S.gapTab = ''; S.gaps = []; S.lt = 0; S.ltMax = 0; S.ltTab = ''; S.loads = {}; S.mounted = 0; S.phase = p; last = performance.now(); };
  return true;
})()`;

async function main() {
  const t0 = Date.now();
  const srv = await serve();
  const port = srv.address().port;
  const profile = fs.mkdtempSync(path.join(TMP, 'switch-storm-'));
  let ch = null, C = null;
  const out = { solo: [], storms: [], crashes: [], pool: [] };
  const cleanup = () => { try { C && C.close(); } catch (e) {} try { ch && ch.kill('SIGKILL'); } catch (e) {} srv.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  try {
    const L = await launch(profile); ch = L.ch;
    C = await cdp(L.url);
    const { targetId } = await C.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: S } = await C.send('Target.attachToTarget', { targetId, flatten: true });
    let crashed = null;
    C.on(d => {
      if (d.method === 'Inspector.targetCrashed' && d.sessionId === S) crashed = 'renderer crashed';
      if (d.method === 'Target.detachedFromTarget' && d.params.sessionId === S) crashed = crashed || 'tab detached';
      if (d.method === 'Target.targetCrashed') crashed = 'target crashed (' + d.params.status + ')';
    });
    const ev = async expr => { const r = await C.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 60000 }, S); if (r.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.exceptionDetails.text); return r.result.value; };
    await C.send('Page.enable', {}, S); await C.send('Runtime.enable', {}, S); await C.send('Inspector.enable', {}, S).catch(() => {});
    await C.send('Performance.enable', {}, S);
    await C.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S);
    await C.send('Page.navigate', { url: `http://127.0.0.1:${port}/stella-nova/index.html#home` }, S);
    for (let i = 0; i < 100 && !(await ev('typeof switchTab==="function"&&document.readyState==="complete"').catch(() => false)); i++) await sleep(100);
    await ev(HEARTBEAT);
    if (arg('inject', null)) { const iv = await ev(fs.readFileSync(arg('inject'), 'utf8')); console.log('injected ' + arg('inject') + ': ' + JSON.stringify(iv)); }
    const pages = await ev('snPages().map(p=>({key:p.key,path:p.path}))');
    const fixed = arg('pages', null);
    const pool = fixed ? fixed.split(',').map(k => ({ key: k })) : heavyPages(pages, POOL);
    out.pool = pool;
    console.log(`pool (${pool.length}): ` + pool.map(p => p.key + (p.kinds ? '[' + p.kinds + ']' : '')).join(' '));
    let gpuPid = null;
    try { const pi = await C.send('SystemInfo.getProcessInfo'); const g = pi.processInfo.find(p => p.type === 'GPU' || p.type === 'gpu-process'); gpuPid = g && g.id; } catch (e) {}
    const heap = async () => { const m = (await C.send('Performance.getMetrics', {}, S)).metrics; const h = m.find(x => x.name === 'JSHeapUsedSize'); return h ? Math.round(h.value / 1048576) : null; };
    const state = () => ev(`({frames:document.querySelectorAll('#frame-wrap iframe').length, src:(document.querySelector('#frame-wrap iframe')||{}).getAttribute?.('src')||'', busy:swapBusy, pending:pendingTab, active:activeTab, S:{gap:__storm.gap,gapTab:__storm.gapTab,gaps:__storm.gaps.slice(0,12),lt:__storm.lt,ltMax:__storm.ltMax,ltTab:__storm.ltTab,mounted:__storm.mounted,loads:__storm.loads}})`);
    // Wait until the frame of tab k has loaded (or the limit runs out). Returns ms.
    const settle = async (k, limit) => {
      const s0 = Date.now();
      while (Date.now() - s0 < limit && !crashed) {
        const ok = await ev(`(()=>{const f=document.querySelector('#frame-wrap iframe');if(!f||swapBusy||pendingTab!==null)return false;let w;try{w=f.contentWindow}catch(e){return false}return !!w&&w.location.href.indexOf(PAGES[${JSON.stringify(k)}])>=0&&w.document.readyState==='complete'})()`).catch(() => false);
        if (ok) return Date.now() - s0;
        await sleep(25);
      }
      return Infinity;
    };
    console.log(`gpu pid ${gpuPid || '?'}, start footprint ${gpuFootprint(gpuPid) ?? '?'} MB, heap ${await heap()} MB`);

    async function solo() {
      for (const p of pool) {
        if (crashed) break;
        await ev(`__storm.reset('solo:${p.key}')`);
        await ev(`switchTab(${JSON.stringify(p.key)})`);
        const st = await settle(p.key, 10000);
        await sleep(2500);
        const s = await state();
        const r = { key: p.key, gap: Math.round(s.S.gap), ltMax: Math.round(s.S.ltMax), lt: s.S.lt, load: st === Infinity ? null : st, heap: await heap() };
        out.solo.push(r);
        console.log(`  solo ${p.key.padEnd(28)} load ${String(r.load ?? 'TIMEOUT').padStart(6)} ms  gap ${String(r.gap).padStart(5)} ms  longtask max ${String(r.ltMax).padStart(5)} ms (${r.lt})  heap ${r.heap} MB`);
      }
      await ev(`switchTab('home')`); await settle('home', 8000);
    }
    async function storm(iv) {
      const rnd = rand(SEED + iv);
      await ev(`__storm.reset('storm:${iv}')`);
      let gpuPeak = 0, last = null; const lat = [];
      const c0 = Date.now();
      for (let i = 0; i < SWITCHES && !crashed; i++) {
        let k; do { k = pool[Math.floor(rnd() * pool.length)].key; } while (k === last);
        last = k;
        // A click from the page: a CDP round trip that waits for the main
        // thread, so a hang also delays the next click (as a real user's
        // click waits in the event queue).
        const k0 = Date.now();
        await ev(`switchTab(${JSON.stringify(k)})`).catch(e => { crashed = crashed || e.message; });
        lat.push(Date.now() - k0);
        if (i % 10 === 9) { const g = gpuFootprint(gpuPid); if (g) gpuPeak = Math.max(gpuPeak, g); }
        await sleep(iv);
      }
      const clickMs = Date.now() - c0;
      const st = crashed ? Infinity : await settle(last, 20000);
      const s = crashed ? { frames: -1, S: {} } : await state();
      const r = { interval: iv, switches: SWITCHES, clickMs, expectMs: SWITCHES * iv, settle: st === Infinity ? null : st, frames: s.frames,
        mounted: s.S.mounted, gap: Math.round(s.S.gap || 0), gapTab: s.S.gapTab, gaps: s.S.gaps, lt: s.S.lt, ltMax: Math.round(s.S.ltMax || 0), ltTab: s.S.ltTab,
        clickMax: Math.max(...lat), clickP95: lat.slice().sort((a, b) => a - b)[Math.floor(lat.length * 0.95)],
        heap: crashed ? null : await heap(), gpuPeak: gpuPeak || null, gpuEnd: gpuFootprint(gpuPid), crash: crashed };
      out.storms.push(r);
      console.log(`  storm ${String(iv).padStart(4)} ms x${SWITCHES}: clicks took ${clickMs} ms (ideal ${r.expectMs}), click latency max ${r.clickMax} p95 ${r.clickP95} ms, settle ${r.settle ?? 'TIMEOUT'} ms, frames ${r.frames}, mounted ${r.mounted}, ` +
        `gap ${r.gap} ms (${r.gapTab}), longtasks ${r.lt} max ${r.ltMax} ms (${r.ltTab}), heap ${r.heap} MB, gpu peak ${r.gpuPeak ?? '?'} end ${r.gpuEnd ?? '?'} MB${crashed ? ', CRASH: ' + crashed : ''}`);
      if (r.gaps && r.gaps.length) console.log('      gaps > 200 ms [ms, active, pending]: ' + JSON.stringify(r.gaps));
      if (!crashed) { await ev(`switchTab('home')`); await settle('home', 8000); await sleep(500); }
    }

    if (!flag('no-solo')) { console.log('solo phase'); await solo(); }
    console.log('storm phase');
    for (const iv of INTERVALS) { if (crashed) break; await storm(iv); }
    if (crashed) out.crashes.push(crashed);
    else { await sleep(5000); out.gpuIdle = gpuFootprint(gpuPid); out.heapIdle = await heap(); console.log(`home after 5 s idle: gpu ${out.gpuIdle ?? '?'} MB, heap ${out.heapIdle} MB`); }
  } finally { cleanup(); }

  // ── report ──────────────────────────────────────────────────────────────
  const worst = out.solo.slice().sort((a, b) => b.gap - a.gap).slice(0, 8);
  if (worst.length) console.log('worst pages by solo stall: ' + worst.map(r => `${r.key} ${r.gap} ms`).join(', '));
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'ok    ' : 'FAIL  ') + m); if (!c) fails++; };
  ok(!out.crashes.length, 'no crash' + (out.crashes.length ? ': ' + out.crashes.join('; ') : ''));
  for (const r of out.storms) {
    ok(r.gap <= LIMITS.gap, `storm ${r.interval} ms: longest stall ${r.gap} ms <= ${LIMITS.gap}`);
    ok(r.settle != null && r.settle <= LIMITS.settle, `storm ${r.interval} ms: settle ${r.settle ?? 'TIMEOUT'} ms <= ${LIMITS.settle}`);
    ok(r.frames === 1, `storm ${r.interval} ms: one frame at the end (${r.frames})`);
  }
  if (arg('json', null)) fs.writeFileSync(arg('json'), JSON.stringify(out, null, 1));
  console.log(`${fails ? fails + ' failed' : 'all passed'} in ${Math.round((Date.now() - t0) / 1000)} s; profile deleted: ${!fs.existsSync(profile)}`);
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error('switch-storm: ' + e.stack); process.exit(2); });
