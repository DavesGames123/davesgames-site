// ============================================================================
//  PAGE TESTS  ·  stem-splitter/tests.mjs — every role's tests + page checks
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/stem-splitter/tests.mjs [--quick]
//  One line per check (PASS / FAIL / SKIP); exit 1 on any FAIL. No browser.
//  CONTRACT 8.4 gives the checks.
//    --quick   engine tests with --quick, and no end-to-end section
//              (no onnxruntime-web run, no model files needed)
//
//  SECTIONS (grep "SECTION:")
//    engine ..... node engine/tests.mjs (child process; its counts)
//    ui ......... node ui/tests.mjs (child process; its counts)
//    page ....... index.html head order and body, main.js import, [hidden],
//                 fonts, module headers, NOTICE against models.js and the
//                 files, offline wiring (EXCLUDE, PASS_PATH, sw-manifest),
//                 nav row, home blurb and thumbnail
//    e2e ........ the real page path in node: engine/client.js -> an
//                 in-process Worker -> the unchanged engine/worker.js ->
//                 runtime.js -> weights.js (fetch from a local gzip HTTP
//                 server, sha256, an in-memory Cache Storage) ->
//                 vendored onnxruntime-web, wasm EP. Separates synth-v1
//                 10 s and gives SDR per stem against the PyTorch
//                 apply_model output in test/vectors.json. Then: cancel,
//                 the 6-stem model, and offline (server closed, models
//                 from the cache; an evicted model fails with code 'net').
//
//  The e2e shims only what node lacks: Worker (an in-process bridge with
//  structuredClone and transfer), self (postMessage, onmessage,
//  crossOriginIsolated = true, so 4 wasm threads), caches (a Map), and
//  fetch of file: URLs (sent to the local server). One node-only change:
//  ORT env.wasm.wasmPaths is set to the plain vendor folder path after
//  init, because ORT makes a blob: import from a URL, and node cannot. It needs the two .th
//  files: node tools/stem-splitter/fetch.mjs. Peak memory about 3.5 GB.
//
//  GREP MAP
//    reporting ........ "function check", "function skip"
//    child runs ....... "function runChild"
//    head order ....... "head order"
//    NOTICE ........... "SECTION: page" ... "NOTICE"
//    offline wiring ... "PASS_PATH"
//    gzip server ...... "function startServer"
//    Worker bridge .... "class BridgeWorker"
//    cache shim ....... "function memCaches"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PAGE = path.dirname(fileURLToPath(import.meta.url));
const SN = path.resolve(PAGE, '../..');
const ROOT = path.resolve(SN, '..');
const QUICK = process.argv.includes('--quick');

let passes = 0, fails = 0, skips = 0;
const failed = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; failed.push(msg); } return cond; }
function skip(msg) { console.log('SKIP ' + msg); skips++; }
const info = msg => console.log('     ' + msg);
const section = name => console.log('\n-- SECTION: ' + name);
const read = p => fs.readFileSync(p, 'utf8');
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

// ================================================================ children
function runChild(rel, args, label) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(PAGE, rel), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out.split('\n').map(l => '   | ' + l).join('\n') + '\n');
  const m = out.match(/(\d+) passed, (\d+) failed, (\d+) skipped/g);
  const last = m && m[m.length - 1].match(/(\d+) passed, (\d+) failed, (\d+) skipped/);
  const skipped = out.split('\n').filter(l => /^SKIP /.test(l)).map(l => l.slice(5));
  check(r.status === 0 && last && last[2] === '0',
    `${label}: exit ${r.status}, ${last ? `${last[1]} passed, ${last[2]} failed, ${last[3]} skipped` : 'no count line'} (${fmt((Date.now() - t0) / 1000)} s)` +
    (skipped.length ? '; skipped: ' + skipped.join(' | ') : ''));
}

section('engine');
runChild('engine/tests.mjs', QUICK ? ['--quick'] : [], 'engine/tests.mjs' + (QUICK ? ' --quick' : ''));

section('ui');
runChild('ui/tests.mjs', [], 'ui/tests.mjs');

// ================================================================ page
section('page');
const html = read(path.join(PAGE, 'index.html'));
{
  const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
  const first = [...head.matchAll(/<script\b[^>]*src="([^"]+)"/g)].slice(0, 3).map(m => m[1]);
  const firstTag = head.trim().match(/^<script\b[^>]*src="([^"]+)"/);
  check(firstTag && JSON.stringify(first) === JSON.stringify(['../../lib/gpu-guard.js', '../../lib/wishlist.js', '../../lib/stats-beacon.js']),
    `head order: head starts with ${first.join(', ')}`);
  check(/<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">/.test(head), 'head: viewport meta with viewport-fit=cover');
  check(/<meta name="description" content="[^"]{40,}">/.test(head), 'head: description meta');
  check(/<link rel="stylesheet" href="style.css">/.test(head), 'head: style.css');
  const iz = html.indexOf('../../vendor/jszip@3.10.1/dist/jszip.min.js'), im = html.indexOf('<script type="module" src="main.js">');
  check(iz > 0 && im > iz && !/<script[^>]*type="module"[^>]*jszip/.test(html), 'JSZip is a classic script before the main.js module');
  check(fs.existsSync(path.join(SN, 'vendor/jszip@3.10.1/dist/jszip.min.js')), 'vendored jszip.min.js exists');
  check(/<div id="app"><\/div>/.test(html), 'body has <div id="app">');
  check(!/Playfair|Cormorant|JetBrains/i.test(html + read(path.join(PAGE, 'style.css'))), 'no Playfair, Cormorant or JetBrains in index.html or style.css');
  check(/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(read(path.join(PAGE, 'style.css'))), 'style.css has [hidden]{display:none!important}');
  check(!/snSaver\s*=/.test(read(path.join(PAGE, 'main.js')).replace(/^\s*\/\/.*$/gm, '')), 'main.js does not set window.snSaver (CONTRACT 6.4)');
}

// main.js: node --check, then an ESM import: the only error is a ReferenceError on a browser global.
{
  const c = spawnSync(process.execPath, ['--check', path.join(PAGE, 'main.js')], { encoding: 'utf8' });
  check(c.status === 0, 'node --check main.js' + (c.status ? ': ' + c.stderr.trim().split('\n').slice(-1)[0] : ''));
  let err = null;
  try { await import(pathToFileURL(path.join(PAGE, 'main.js')).href + '?t=' + Date.now()); } catch (e) { err = e; }
  const browserGlobal = err instanceof ReferenceError && /^(document|window|navigator|AudioContext|OfflineAudioContext|Worker|caches) is not defined$/.test(err.message);
  check(err === null || browserGlobal, `ESM import of main.js in node: ${err ? err.constructor.name + ': ' + err.message : 'no error'} (only a browser-global ReferenceError is allowed)`);
}

// Every page module has a header with a GREP MAP (or a grep -n list).
{
  const mods = ['main.js', 'models.js', ...fs.readdirSync(path.join(PAGE, 'engine')).map(f => 'engine/' + f),
    ...fs.readdirSync(path.join(PAGE, 'ui')).map(f => 'ui/' + f)].filter(f => /\.m?js$/.test(f));
  const bad = mods.filter(f => { const t = read(path.join(PAGE, f)).slice(0, 6000); return !/GREP MAP|grep -n|SECTIONS \(grep/.test(t); });
  check(bad.length === 0, `module headers: ${mods.length} modules, ${bad.length ? 'no GREP MAP in ' + bad.join(', ') : 'each has a GREP MAP'}`);
}

// NOTICE against models.js and the files on disk.
const { MODELS } = await import(pathToFileURL(path.join(PAGE, 'models.js')).href);
{
  const notice = read(path.join(PAGE, 'NOTICE'));
  const lic = read(path.join(PAGE, 'LICENSE-demucs.txt'));
  check(/^MIT License/.test(lic) && /Meta Platforms, Inc\. and affiliates/.test(lic), 'LICENSE-demucs.txt is the MIT text, Meta Platforms');
  for (const m of Object.values(MODELS)) {
    for (const f of [m.graph, m.weights]) {
      const has = notice.includes(f.file) && notice.includes(f.sha256) && notice.includes(String(f.bytes));
      check(has, `NOTICE lists ${f.file} with its sha256 and bytes`);
      const p = path.join(PAGE, f.file);
      if (!fs.existsSync(p)) { skip(`sha256 of ${f.file} (file absent: node tools/stem-splitter/fetch.mjs)`); continue; }
      const buf = fs.readFileSync(p);
      const sum = crypto.createHash('sha256').update(buf).digest('hex');
      check(sum === f.sha256 && buf.length === f.bytes, `${f.file}: ${buf.length} B, sha256 ${sum.slice(0, 12)}… equals models.js`);
    }
    check(notice.includes(m.weights.source), `NOTICE gives the source URL of ${m.weights.name}`);
  }
  check(/LICENSE-demucs\.txt/.test(notice) && /engine\/dsp\.js/.test(notice) && /engine\/segment\.js/.test(notice),
    'NOTICE names the licence file and credits the JS port (engine/dsp.js, engine/segment.js)');
  check(/no separate licence/i.test(notice) && /README/.test(notice), 'NOTICE has the weights licence note (README project-wide MIT line)');
  check(/onnxruntime-web 1\.30\.0/.test(notice), 'NOTICE names the runtime (onnxruntime-web 1.30.0)');
  const ign = read(path.join(ROOT, '.gitignore'));
  check(/stella-nova\/pages\/stem-splitter\/models\/\*\.th/.test(ign), '.gitignore ignores models/*.th');
}

// Offline wiring (CONTRACT 2.5 steps 3 and 4).
{
  const om = read(path.join(ROOT, 'tools/offline-manifest.mjs'));
  const ex = om.slice(om.indexOf('const EXCLUDE'), om.indexOf('];', om.indexOf('const EXCLUDE')));
  check(ex.includes('/^stella-nova\\/pages\\/stem-splitter\\/models\\//') && ex.includes('/^stella-nova\\/pages\\/stem-splitter\\/test\\//'),
    'tools/offline-manifest.mjs EXCLUDE has the models/ and test/ lines');
  const sw = read(path.join(ROOT, 'sw.js'));
  check(/const PASS_PATH = \/\^stella-nova\\\/pages\\\/stem-splitter\\\/models\\\/\/;/.test(sw), 'sw.js has PASS_PATH for stem-splitter/models/');
  const r = sw.slice(sw.indexOf('function route(e)'));
  const iNull = r.indexOf('if (path === null) return null;'), iPass = r.indexOf('if (PASS_PATH.test(path)) return null;'), iMan = r.indexOf('fromManifest(');
  check(iNull > 0 && iPass > iNull && iMan > iPass, 'sw.js route(): PASS_PATH pass-through after the null check, before the manifest lookup');
  const man = read(path.join(ROOT, 'sw-manifest.js'));
  const SNO = new Function('self', man + '; return self.SN_OFFLINE;')({});
  const all = [...SNO.core, ...SNO.lazy].map(e => e[0]);
  const bad = all.filter(p => /^stella-nova\/pages\/stem-splitter\/(models|test)\//.test(p));
  check(bad.length === 0, `sw-manifest.js: no path under stem-splitter/models/ or test/ (${bad.length} found)`);
  const coreSet = new Set(SNO.core.map(e => e[0]));
  const want = ['index.html', 'main.js', 'models.js', 'style.css', 'engine/worker.js', 'engine/runtime.js', 'engine/client.js', 'ui/app.js'];
  const miss = want.filter(f => !coreSet.has('stella-nova/pages/stem-splitter/' + f));
  check(miss.length === 0, `sw-manifest.js core has the page code (${want.length} files checked${miss.length ? '; missing ' + miss.join(', ') : ''})`);
  check(SNO.lazy.some(e => /^stella-nova\/vendor\/onnxruntime-web@1\.30\.0\/dist\/ort-wasm-simd-threaded\.jsep\.wasm$/.test(e[0])) ||
    SNO.lazy.some(e => /^stella-nova\/vendor\/onnxruntime-web@1\.30\.0\/.*\.wasm$/.test(e[0])), 'sw-manifest.js lazy has the vendored ORT wasm');
}

// Nav row, home blurb, thumbnail.
{
  const nav = read(path.join(SN, 'lib/nav-data.js'));
  const sound = nav.slice(nav.indexOf('id: "sound"'), nav.indexOf('{ id:', nav.indexOf('id: "sound"') + 5));
  check(/\["stem-splitter", "Stem Splitter", "NEW"\]/.test(sound), 'nav-data.js: stem-splitter row in the Sound & Vibration region');
  check((nav.match(/"stem-splitter"/g) || []).length === 1, 'nav-data.js: the key is registered once');
  const sectors = read(path.join(SN, 'pages/home/sectors.js'));
  check(/"stem-splitter":\s*'[^']{20,}'|'stem-splitter':\s*'[^']{20,}'|"stem-splitter":\s*"[^"]{20,}"/.test(sectors), 'home sectors.js has a blurb for stem-splitter');
  const th = path.join(SN, 'pages/home/thumbs/stem-splitter.jpg'), sm = path.join(SN, 'pages/home/thumbs/sm/stem-splitter.jpg');
  check(fs.existsSync(th) && fs.existsSync(sm), 'home thumbnail and small copy exist');
  check(/['"]stem-splitter['"]/.test(read(path.join(SN, 'pages/home/thumbs/list.js'))), 'thumbs/list.js names stem-splitter');
}

// ================================================================ e2e
section('e2e');
if (QUICK) skip('end-to-end separation (--quick)');
else {
  const missing = Object.values(MODELS).flatMap(m => [m.graph, m.weights]).filter(f => !fs.existsSync(path.join(PAGE, f.file)));
  const vecPath = path.join(PAGE, 'test/vectors.json');
  if (missing.length) skip(`end-to-end separation (weights absent: node tools/stem-splitter/fetch.mjs; missing ${missing.map(f => f.file).join(', ')})`);
  else if (!fs.existsSync(vecPath)) skip('end-to-end separation (test/vectors.json absent)');
  else {
    try { await e2e(JSON.parse(read(vecPath))); }
    catch (e) { check(false, 'e2e threw: ' + String(e && e.stack || e).slice(0, 400)); }
  }
}

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
if (fails) console.log('failed: ' + failed.join(' | '));
process.exit(fails ? 1 : 0);

// ---------------------------------------------------------------- e2e parts
function dec(s) {
  const b = Buffer.from(s.slice(4), 'base64');
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return s.startsWith('f32:') ? new Float32Array(ab) : new Uint32Array(ab);
}
function sdr(ref, est) {
  let a = 0, b = 0;
  for (let i = 0; i < ref.length; i++) { a += ref[i] * ref[i]; const d = ref[i] - est[i]; b += d * d; }
  return b === 0 ? Infinity : 10 * Math.log10(a / b);
}
function at(a, idx) { return Float32Array.from(idx, i => a[i]); }

// Static files of the repo over HTTP. .onnx, .js, .mjs and .json go out
// gzipped with the compressed content-length, as GitHub Pages does, so a
// loader that sizes a buffer from content-length fails here.
function startServer() {
  const gz = new Map();
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const p = path.resolve(ROOT, rel);
    if (!p.startsWith(SN + path.sep) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
    srv.requests.push(rel);
    if (/\.(onnx|js|mjs|json)$/.test(p)) {
      if (!gz.has(p)) gz.set(p, zlib.gzipSync(fs.readFileSync(p), { level: 1 }));
      const body = gz.get(p);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': body.length });
      res.end(body);
    } else {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fs.statSync(p).size });
      fs.createReadStream(p).pipe(res);
    }
  });
  srv.requests = [];
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// A Cache Storage in memory: open / match / put / delete / keys.
function memCaches() {
  const stores = new Map();
  const keyOf = k => (typeof k === 'string' ? k : k.url);
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async match(k) { const v = m.get(keyOf(k)); return v ? new Response(v.slice()) : undefined; },
        async put(k, res) { m.set(keyOf(k), new Uint8Array(await res.arrayBuffer())); },
        async delete(k) { return m.delete(keyOf(k)); },
        async keys() { return [...m.keys()].map(url => ({ url })); },
      };
    },
    async delete(name) { return stores.delete(name); },
    async has(name) { return stores.has(name); },
    async keys() { return [...stores.keys()]; },
  };
}

async function e2e(V) {
  const srv = await startServer();
  const origin = `http://127.0.0.1:${srv.address().port}/`;
  const rootUrl = pathToFileURL(ROOT + path.sep).href;
  let online = true;
  const realFetch = globalThis.fetch;
  const savedCaches = globalThis.caches;
  globalThis.fetch = (u, opts) => {
    let s = typeof u === 'string' ? u : (u && u.url) || String(u);
    if (s.startsWith(rootUrl)) s = origin + s.slice(rootUrl.length);
    if (!online && s.startsWith(origin)) return Promise.reject(new TypeError('fetch failed (offline test)'));
    return realFetch(s, opts);
  };
  const cacheStore = memCaches();
  globalThis.caches = cacheStore;

  // The worker global scope. Messages cross with structuredClone + transfer.
  let bridge = null, workerImported = false;
  globalThis.self = {
    crossOriginIsolated: true,
    postMessage(msg, transfer) {
      const data = structuredClone(msg, { transfer: transfer || [] });
      const b = bridge;
      setImmediate(() => { if (b && !b.dead && b.onmessage) b.onmessage({ data }); });
    },
    onmessage: null,
  };
  class BridgeWorker {
    constructor(url, opts) {
      this.url = String(url); this.type = opts && opts.type; this.dead = false; this.onmessage = null; this.onerror = null;
      bridge = this;
      this.ready = workerImported ? Promise.resolve() : import(this.url).then(() => { workerImported = true; });
      this.ready.catch(e => { if (this.onerror) this.onerror({ message: String(e && e.message || e) }); });
    }
    postMessage(msg, transfer) {
      const data = structuredClone(msg, { transfer: transfer || [] });
      this.ready.then(() => { if (!this.dead) globalThis.self.onmessage({ data }); });
    }
    // The real worker dies with its session. The module stays loaded in
    // this process, so terminate() sends it a dispose instead.
    terminate() { this.dead = true; this.ready.then(() => globalThis.self.onmessage({ data: { id: -1, op: 'dispose' } })); }
  }

  const { createEngine } = await import(pathToFileURL(path.join(PAGE, 'engine/client.js')).href);
  const { synthV1 } = await import(pathToFileURL(path.join(PAGE, 'engine/synth.js')).href);
  const rssMB = () => Math.round(process.memoryUsage().rss / 1048576);
  const P = V.pipeline && V.pipeline.htdemucs;
  let peak = 0;
  const watch = setInterval(() => { peak = Math.max(peak, rssMB()); }, 200);

  try {
    let engine = createEngine({ WorkerImpl: BridgeWorker });
    const ini = await engine.init({ ep: 'auto' });
    // Node only: onnxruntime-web turns a URL wasmPaths into a blob: import,
    // which node cannot load. worker.js imports this same module URL, so
    // this sets the one shared env to the plain folder path (as
    // engine/tests.mjs does). Session creation reads it at load().
    const ortMod = await import(pathToFileURL(path.join(SN, 'vendor/onnxruntime-web@1.30.0/dist/ort.min.mjs')).href);
    check(/^file:.*\/vendor\/onnxruntime-web@1\.30\.0\/dist\/$/.test(String(ortMod.env.wasm.wasmPaths)), `e2e: worker.js set wasmPaths to the vendored folder (${ortMod.env.wasm.wasmPaths})`);
    ortMod.env.wasm.wasmPaths = path.join(SN, 'vendor/onnxruntime-web@1.30.0/dist') + '/';
    check(ini.ep === 'wasm' && ini.threads === Math.min(4, navigator.hardwareConcurrency || 1) && ini.isolated === true,
      `e2e init through client.js -> worker.js: ${JSON.stringify(ini)}`);
    check(workerImported && bridge.type === 'module' && /engine\/worker\.js$/.test(bridge.url), 'e2e: client started engine/worker.js as a module worker');
    let list = await engine.models();
    check(list.length === 2 && list.every(m => m.cached === false), `e2e models() before download: ${list.map(m => m.id + ' ' + (m.bytes / 1e6).toFixed(1) + ' MB cached=' + m.cached).join(', ')}`);

    // 1. Load htdemucs over HTTP (gzip graph), sha256, cache, session.
    const phases = [];
    let lastLoaded = 0, mono = true;
    const onLoad = p => { phases.push(p.phase); if (p.phase === 'download') { if (p.loaded < lastLoaded) mono = false; lastLoaded = p.loaded; } };
    let t0 = performance.now();
    const ld = await engine.load('htdemucs', onLoad);
    const loadS = (performance.now() - t0) / 1000;
    const m4 = MODELS.htdemucs;
    check(ld.ep === 'wasm' && ld.fromCache === false && !ld.fallback, `e2e load htdemucs over HTTP: ${JSON.stringify(ld)} (${fmt(loadS, 2)} s)`);
    check(phases.includes('download') && phases.includes('verify') && phases.includes('session') && mono && lastLoaded <= m4.graph.bytes + m4.weights.bytes,
      `e2e load progress: phases ${[...new Set(phases)].join(' > ')}, download monotonic, last ${lastLoaded} of ${m4.graph.bytes + m4.weights.bytes} B`);
    check(srv.requests.some(r => r.endsWith('models/htdemucs.onnx')) && srv.requests.some(r => r.endsWith('models/955717e8-8726e21a.th')),
      'e2e: the graph (gzip) and the weights came from the server');
    list = await engine.models();
    check(list.find(m => m.id === 'htdemucs').cached && !list.find(m => m.id === 'htdemucs_6s').cached, 'e2e models() after the load: htdemucs cached, htdemucs_6s not');

    // 2. Separate synth-v1 10 s, standard, vs PyTorch apply_model.
    let firstStems = null;
    if (!P) skip('e2e SDR vs PyTorch (vectors.pipeline.htdemucs absent)');
    else {
      const [L, R] = synthV1(P.seconds);
      const L0 = L.slice(0, 8);
      const prog = [];
      t0 = performance.now();
      const res = await engine.separate({ modelId: 'htdemucs', left: L, right: R, quality: 'standard', onProgress: p => prog.push(p) });
      const sepS = (performance.now() - t0) / 1000;
      check(L.length === P.seconds * 44100 && L[0] === L0[0] && L[7] === L0[7], 'e2e: separate() without transfer leaves the caller arrays intact');
      const sp = prog.filter(p => p.phase === 'separate');
      check(sp.length === res.segments && sp.every((p, i) => p.done === i + 1 && p.total === res.segments), `e2e separate progress: done 1..${res.segments} once each`);
      const parts = [];
      let worst = Infinity;
      for (const [stem, ref] of Object.entries(P.stems)) {
        const idx = dec(ref.idx), got = res.stems[stem];
        const refv = new Float32Array(idx.length * 2); refv.set(dec(ref.L)); refv.set(dec(ref.R), idx.length);
        const est = new Float32Array(idx.length * 2); est.set(at(got[0], idx)); est.set(at(got[1], idx), idx.length);
        const s = sdr(refv, est);
        worst = Math.min(worst, s); parts.push(`${stem} ${fmt(s, 1)}`);
      }
      check(worst >= 50, `e2e htdemucs synth-v1 ${P.seconds} s standard, page path vs PyTorch apply_model: SDR per stem ${parts.join(', ')} dB (>= 50)`);
      info(`e2e timing: ${res.segments} segments in ${fmt(sepS, 2)} s = ${fmt(sepS / P.seconds, 3)} s per second of audio (wasm EP, ${ini.threads} threads, node); load ${fmt(loadS, 2)} s`);
      // Info only: how well the stems add back to the mix.
      const mixv = [], sumv = [];
      for (let c = 0; c < 2; c++) {
        const src = c ? R : L;
        for (let i = 0; i < src.length; i += 7) { mixv.push(src[i]); let s = 0; for (const st of Object.values(res.stems)) s += st[c][i]; sumv.push(s); }
      }
      info(`e2e info: sum of the 4 stems vs the mix: SDR ${fmt(sdr(mixv, sumv), 1)} dB (Demucs does not force this)`);
      firstStems = res.stems;
    }

    // 3. Cancel with the real model: 30 s = 6 segments; cancel after the first.
    {
      const [L, R] = synthV1(30);
      let n = 0, err = null;
      const pr = engine.separate({ modelId: 'htdemucs', left: L, right: R, quality: 'standard', transfer: true,
        onProgress: p => { if (p.phase === 'separate') { n = p.done; if (p.done === 1) engine.cancel(); } } });
      try { await pr; } catch (e) { err = e; }
      check(err && err.code === 'cancelled' && n <= 2, `e2e cancel after segment 1 of 6: rejects with code '${err && err.code}', last progress ${n}`);
      check(L.length === 0, 'e2e separate({ transfer: true }) detached the caller arrays');
    }

    // 4. The 6-stem model, online.
    {
      t0 = performance.now();
      const ld6 = await engine.load('htdemucs_6s');
      const l6 = (performance.now() - t0) / 1000;
      const [L, R] = synthV1(10);
      t0 = performance.now();
      const r6 = await engine.separate({ modelId: 'htdemucs_6s', left: L, right: R, quality: 'standard' });
      const s6 = (performance.now() - t0) / 1000;
      const names = Object.keys(r6.stems);
      const okShape = names.join(',') === MODELS.htdemucs_6s.stems.join(',') && names.every(k => r6.stems[k][0].length === L.length && r6.stems[k][1].length === L.length);
      let finite = true, e = {};
      for (const k of names) { let s = 0; for (const ch of r6.stems[k]) for (const v of ch) { if (!Number.isFinite(v)) finite = false; s += v * v; } e[k] = s; }
      check(ld6.fromCache === false && okShape && finite, `e2e htdemucs_6s: load ${fmt(l6, 2)} s, ${r6.segments} segments in ${fmt(s6, 2)} s (${fmt(s6 / 10, 3)} s per second of audio), stems ${names.join(', ')}, all finite`);
      info('e2e htdemucs_6s stem energy (no PyTorch pipeline reference; core is checked in engine/tests.mjs): ' + names.map(k => `${k} ${e[k].toExponential(2)}`).join(', '));
    }

    // 5. Offline: close the server; a new worker loads from the cache only.
    await engine.evict('htdemucs_6s');
    list = await engine.models();
    check(list.find(m => m.id === 'htdemucs').cached && !list.find(m => m.id === 'htdemucs_6s').cached, 'e2e evict(htdemucs_6s): it is no longer cached, htdemucs still is');
    engine.terminate();
    online = false;
    await new Promise(r => srv.close(r));
    const before = srv.requests.length;
    engine = createEngine({ WorkerImpl: BridgeWorker });
    await engine.init({ ep: 'auto' });
    t0 = performance.now();
    const ldOff = await engine.load('htdemucs');
    check(ldOff.fromCache === true && srv.requests.length === before, `e2e offline load htdemucs from the cache: fromCache ${ldOff.fromCache}, ${fmt((performance.now() - t0) / 1000, 2)} s, no server request`);
    if (P && firstStems) {
      const [L, R] = synthV1(P.seconds);
      const r2 = await engine.separate({ modelId: 'htdemucs', left: L, right: R, quality: 'standard' });
      let worst = Infinity;
      for (const k of Object.keys(firstStems)) worst = Math.min(worst, sdr([...firstStems[k][0], ...firstStems[k][1]], [...r2.stems[k][0], ...r2.stems[k][1]]));
      check(worst >= 100, `e2e offline separate: equals the online run (worst stem SDR ${fmt(worst, 1)} dB >= 100)`);
    }
    let errOff = null;
    try { await engine.load('htdemucs_6s'); } catch (e) { errOff = e; }
    check(errOff && errOff.code === 'net', `e2e offline load of an evicted model: rejects with code '${errOff && errOff.code}' (${errOff && errOff.message})`);
    engine.terminate();
  } finally {
    clearInterval(watch);
    info(`e2e peak node rss: ${Math.max(peak, rssMB())} MB`);
    globalThis.fetch = realFetch;
    if (savedCaches === undefined) delete globalThis.caches; else globalThis.caches = savedCaches;
    if (srv.listening) srv.close();
  }
}
