#!/usr/bin/env node
// ============================================================================
//  EM EXPLORER  ·  tests.mjs — the page test (CORE package)
// ----------------------------------------------------------------------------
//  Run from the repo root:
//    NODE_PATH=<dir with jsdom@24.1.3>/node_modules node stella-nova/pages/em-explorer/tests.mjs
//  Flags: --core  skip the package tests (data/, view/, catalog/)
//         --live  also section 8: the real page streams minnie65 (1 to 3 MB)
//
//  Sections
//    1. syntax      node --check on every .js and .mjs file of the page
//    2. link        node imports main.js and each package index.js: only a
//                   ReferenceError on a browser global is correct
//    3. markup      head order, bound ids, the [hidden] guard, fonts, meta
//    4. ui units    ui/hash.js, ui/format.js, ui/mount.js
//    5. packages    data/, view/, catalog/, saver/ and sem/tests.mjs
//    6. page        jsdom boots with test packages: desktop, phone, hash,
//                   share, places, failure messages, no WebGL2
//    6c. sem mode   main.js mounts ui/sem-panel.js: the hash and the keys
//                   stay with the open mode, then go back to the slice view
//    7. real boot   jsdom boots with the real packages and no network
//    8. live        (--live) the real page loads real minnie65 tiles
//  No browser runs. jsdom comes from NODE_PATH or JSDOM_DIR; with no jsdom,
//  sections 6 and 7 are skipped and say so.
//
//  grep -n targets: "function boot(", "function testPackages", "sect('"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARGS = new Set(process.argv.slice(2));
const LIVE = ARGS.has('--live');
const NODE_FETCH = globalThis.fetch;   // kept before the jsdom boots replace it
let pass = 0, fail = 0;
const fails = [];
function ok(c, msg) { if (c) { pass++; console.log('  ok   ' + msg); } else { fail++; fails.push(msg); console.log('  FAIL ' + msg); } }
function sect(t) { console.log('\n' + t); }
const read = (p) => fs.readFileSync(path.join(HERE, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(m?js)$/.test(e.name)) out.push(p);
  }
  return out;
}

// ── 1 ──
sect('1. syntax');
{
  const files = walk(HERE);
  const bad = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(path.relative(HERE, f) + ': ' + (r.stderr || '').split('\n').slice(0, 4).join(' '));
  }
  ok(!bad.length, `node --check on ${files.length} files${bad.length ? ': ' + bad.join(' | ') : ''}`);
}

// ── 2 ──
sect('2. link (node ESM import)');
const BROWSER_GLOBAL = /^ReferenceError: (window|document|location|navigator|matchMedia|requestAnimationFrame|self|HTMLCanvasElement|Worker|OffscreenCanvas|createImageBitmap|devicePixelRatio|innerWidth|innerHeight|history|addEventListener) is not defined/;
function linkCheck(rel) {
  const url = pathToFileURL(path.join(HERE, rel)).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `try { await import(${JSON.stringify(url)}); console.log('LOADED'); } catch (e) { console.log('ERR ' + e.name + ': ' + e.message); }`], { encoding: 'utf8', timeout: 60000 });
  return (r.stdout || '').trim().split('\n').pop() || (r.stderr || '').trim();
}
{
  const m = linkCheck('main.js');
  ok(m === 'LOADED' || BROWSER_GLOBAL.test(m.replace(/^ERR /, '')), `main.js links (${m.slice(0, 120)})`);
  for (const pkg of ['catalog', 'data', 'view']) {
    if (!fs.existsSync(path.join(HERE, pkg, 'index.js'))) { console.log(`  skip ${pkg}/index.js is not there yet (main.js uses the stub)`); continue; }
    const r = linkCheck(pkg + '/index.js');
    ok(r === 'LOADED' || BROWSER_GLOBAL.test(r.replace(/^ERR /, '')), `${pkg}/index.js links (${r.slice(0, 120)})`);
  }
}

// ── 3 ──
sect('3. markup');
const HTML = read('index.html'), CSS = read('style.css'), MAIN = read('main.js');
const CORE_JS = [MAIN, ...fs.readdirSync(path.join(HERE, 'ui')).filter((f) => f.endsWith('.js')).map((f) => read('ui/' + f))].join('\n');
{
  const head = HTML.slice(0, HTML.indexOf('</head>'));
  const tags = [...head.matchAll(/<(script|link|meta|style)\b[^>]*>/g)].map((m) => m[0]);
  const firstThree = tags.slice(0, 3).map((t) => (t.match(/src="([^"]+)"/) || [])[1]);
  ok(JSON.stringify(firstThree) === JSON.stringify(['../../lib/gpu-guard.js', '../../lib/wishlist.js', '../../lib/stats-beacon.js']), `head order gpu-guard, wishlist, stats-beacon first: ${firstThree.join(', ')}`);
  ok(/<meta name="viewport" content="[^"]*width=device-width[^"]*viewport-fit=cover/.test(head), 'viewport meta with viewport-fit=cover');
  ok(/<meta name="description" content="[^"]{40,}">/.test(head), 'description meta');
  ok(head.indexOf('style.css') < head.indexOf('lib/sci.css'), 'style.css, then lib/sci.css');
  ok(/<script type="module" src="main.js"><\/script>\s*<\/body>/.test(HTML), 'main.js is a module at the end of body');

  const ids = [...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  ok(!dup.length, `ids are unique (${ids.length})${dup.length ? ': ' + dup.join(', ') : ''}`);
  const used = new Set([...CORE_JS.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g), ...CORE_JS.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !ids.includes(id));
  ok(used.size > 30 && !missing.length, `${used.size} ids bound in main.js and ui/ are in index.html${missing.length ? '; missing: ' + missing.join(', ') : ''}`);
  for (const t of ['places', 'data', 'image']) ok(ids.includes('tab-' + t) && HTML.includes(`data-tab="${t}"`), `tab ${t}: panel section and tab button`);

  ok(/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(CSS), '[hidden]{display:none!important} guard');
  // an element that can be hidden must not get a display rule with !important (it would beat the guard)
  const hideable = new Set([...HTML.matchAll(/<[^>]*\sid="([^"]+)"[^>]*\shidden[\s>]/g)].map((m) => m[1]));
  for (const m of CORE_JS.matchAll(/\$\('([\w-]+)'\)\.hidden\s*=/g)) hideable.add(m[1]);
  const clash = [];
  for (const id of hideable) {
    const re = new RegExp(`#${id}(?![\\w-])[^{}]*\\{[^}]*display\\s*:\\s*(?!none)[a-z-]+\\s*!important`, 'g');
    if (re.test(CSS)) clash.push(id);
  }
  ok(hideable.size >= 8 && !clash.length, `${hideable.size} hideable elements have no "display: x !important" rule${clash.length ? ': ' + clash.join(', ') : ''}`);
  const msgs = ['nogl', 'nonet', 'offline', 'about', 'caption', 'toast', 'loading'];
  ok(msgs.every((id) => new RegExp(`id="${id}"[^>]*\\shidden[\\s>]`).test(HTML)), 'messages, sheets and the caption start hidden');

  const all = HTML + CSS + CORE_JS;
  ok(!/playfair|cormorant|jetbrains/i.test(all), 'no Playfair, Cormorant or JetBrains Mono');
  ok(!/katex/i.test(all), 'no KaTeX');
  ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(CORE_JS), 'CORE puts catalog text in with textContent, never innerHTML');
  ok(!/@gmail|dkncus/i.test(all), 'no email address in the page');
  ok(/#dock button\{[^}]*min-height:48px/.test(CSS) && /@media \(pointer:coarse\)\{[\s\S]*?\.round\{width:44px;height:44px\}/.test(CSS), 'dock targets 48 px, round buttons 44 px on touch');
  ok(CSS.includes("(max-width:768px), (max-height:500px) and (pointer:coarse)") && MAIN.includes("(max-width: 768px), (max-height: 500px) and (pointer: coarse)"), 'PHONE_Q in main.js matches the phone block of style.css');
  ok(/html\.sn-saver #panel/.test(CSS), 'screensaver mode hides the chrome');
  const labels = [...HTML.matchAll(/>([A-Z][a-z][^<]{1,40})</g)].map((m) => m[1]).filter((s) => /^[A-Z][a-z]+ [A-Z][a-z]/.test(s) && !/Stella Nova|Electron Microscopy/.test(s));
  ok(!labels.length, `labels are sentence case${labels.length ? ': ' + labels.join(' | ') : ''}`);
}

// ── 4 ──
sect('4. ui units');
const { parseHash, formatHash } = await import('./ui/hash.js');
const { fmtLength, fmtVoxel, fmtExtent, fmtCount } = await import('./ui/format.js');
const { normalizeCatalog, loadPackages, STUBS } = await import('./ui/mount.js');
{
  const s = { dataset: 'hemibrain', plane: 'xz', x: 17000.04, y: 19800, z: 20100.5, zoom: 0.004567, contrast: { lo: 20, hi: 235, gamma: 1.25 }, invert: true, bookmark: 'syn-1' };
  const h = formatHash(s);
  ok(h === 'd=hemibrain&p=xz&x=17000&y=19800&z=20100.5&zm=0.00457&c=20,235,1.25&inv=1&b=syn-1', `formatHash: ${h}`);
  const p = parseHash('#' + h);
  ok(p.dataset === 'hemibrain' && p.plane === 'xz' && p.x === 17000 && p.z === 20100.5 && Math.abs(p.zoom - 0.00457) < 1e-9 && p.contrast.gamma === 1.25 && p.invert === true && p.bookmark === 'syn-1', 'parseHash reads formatHash back');
  ok(formatHash({ dataset: 'a', contrast: { lo: 0, hi: 255, gamma: 1 }, invert: false }) === 'd=a', 'default contrast and no invert stay out of the hash');
  const bad = parseHash('d=<script>&p=zz&x=NaN&y=1e99&zm=-1&c=200,100,1&b=../../x');
  ok(Object.values(bad).every((v) => v === null), 'bad hash values are all null');
  ok(parseHash('').dataset === null && parseHash('x=1&y=2').x === 1, 'empty and partial hashes');
  ok(fmtLength(8) === '8 nm' && fmtLength(1234) === '1.23 µm' && fmtLength(35000) === '35 µm' && fmtLength(1.3e6) === '1.3 mm', `fmtLength: ${fmtLength(8)}, ${fmtLength(1234)}, ${fmtLength(35000)}, ${fmtLength(1.3e6)}`);
  ok(fmtVoxel([8, 8, 8]) === '8 nm' && fmtVoxel([8, 8, 40]) === '8 × 8 × 40 nm' && fmtVoxel(null) === '', 'fmtVoxel');
  ok(fmtExtent([34432, 39552, 41408], [8, 8, 8]) === '275 × 316 × 331 µm', `fmtExtent hemibrain: ${fmtExtent([34432, 39552, 41408], [8, 8, 8])}`);
  ok(fmtCount(3.2e11) === '320 billion' && fmtCount(999) === '999', 'fmtCount');

  const cat = normalizeCatalog({
    datasets: [{ id: 'a', name: 'A' }, { name: 'no id' }, { id: 'b' }],
    bookmarks: [{ dataset: 'a', x: 1, y: 2, z: 3 }, { dataset: 'zz', x: 1, y: 2, z: 3 }, { dataset: 'b', x: 1, y: NaN, z: 3 }, { id: 'k', dataset: 'b', x: 0, y: 0, z: 0 }],
    about: 'One.\n\nTwo.', defaultDataset: 'b',
  });
  ok(cat.datasets.length === 2 && cat.bookmarks.length === 2 && cat.bookmarks[0].id === 'a-1' && cat.bookmarks[1].id === 'k', 'normalizeCatalog drops broken records and gives ids');
  ok(cat.about.paragraphs.length === 2 && cat.defaultId === 'b', 'normalizeCatalog: about text and default dataset');
  const lp = await loadPackages(async (p) => { if (p.includes('view')) throw new Error('Failed to fetch dynamically imported module'); if (p.includes('data')) return { nothing: 1 }; return { DATASETS: [{ id: 'q' }] }; }, '.');
  ok(lp.view === STUBS.view && lp.data === STUBS.data && lp.catalog.DATASETS[0].id === 'q' && lp.errors.map((e) => e.pkg).sort().join() === 'data,view', 'loadPackages: a failed or wrong package gives the stub and an error');
  const v = STUBS.view.createViewer(null, {});
  const vol = await STUBS.data.openVolume({ id: 'x', size: [10, 20, 30], voxel: [4, 4, 4] });
  v.setVolume(vol); v.goTo({ x: 1, zoom: 2 });
  ok(v.state().x === 1 && v.state().zoom === 2 && v.state().y === 10, 'stub viewer keeps its state');
}

// ── 5 ──
sect('5. package tests');
if (ARGS.has('--core')) console.log('  skip (--core)');
else {
  for (const pkg of ['data', 'view', 'catalog', 'saver', 'sem']) {
    const t = path.join(HERE, pkg, 'tests.mjs');
    if (!fs.existsSync(t)) { console.log(`  skip ${pkg}/tests.mjs is not there yet`); continue; }
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [t], { encoding: 'utf8', timeout: 600000, env: process.env, cwd: path.join(HERE, '..', '..', '..') });
    const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-2).join(' / ');
    ok(r.status === 0, `${pkg}/tests.mjs exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${tail.slice(0, 160)}`);
  }
}

// ── jsdom harness ──
function loadJsdom() {
  const require = createRequire(import.meta.url);
  try {
    const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
    return require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })).JSDOM;
  } catch (e) { return null; }
}
function mediaFor(w, h, coarse) {
  const feat = (f) => {
    const [k, v] = f.trim().replace(/^\(|\)$/g, '').split(':').map((s) => s.trim()), n = parseFloat(v);
    if (k === 'max-width') return w <= n; if (k === 'min-width') return w >= n;
    if (k === 'max-height') return h <= n; if (k === 'min-height') return h >= n;
    if (k === 'pointer') return (v === 'coarse') === coarse;
    if (k === 'orientation') return (v === 'landscape') === (w > h);
    return false;
  };
  return (q) => ({ matches: q.split(',').some((part) => part.split(/\band\b/).every(feat)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
let fakeCanvas = null;
try { ({ fakeCanvas } = await import('../coral-reef/tests/fake-gl.mjs')); } catch (e) { /* a plain Proxy below */ }

let bootN = 0;
async function boot({ w = 1280, h = 800, coarse = false, hash = '', packages = null, gl = true, fetchImpl = null } = {}) {
  const JSDOM = loadJsdom(); if (!JSDOM) return null;
  const dom = new JSDOM(HTML.replace(/<script type="module"[^>]*><\/script>/, '').replace(/<script src="[^"]*"><\/script>/g, ''), {
    url: 'http://localhost:8963/stella-nova/pages/em-explorer/index.html' + (hash ? '#' + hash.replace(/^#/, '') : ''), pretendToBeVisual: true,
  });
  const win = dom.window, doc = win.document;
  win.matchMedia = mediaFor(w, h, coarse);
  const view = doc.getElementById('view');
  for (const [k, v] of [['clientWidth', w], ['clientHeight', h]]) Object.defineProperty(view, k, { value: v, configurable: true });
  const fakes = new Map();
  win.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (!gl || kind !== 'webgl2') return null;
    if (!fakes.has(this)) fakes.set(this, fakeCanvas ? fakeCanvas({ w, h, canvas: this }).gl : null);
    return fakes.get(this);
  };
  const clip = [];
  Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { clip.push(t); } }, configurable: true });
  const rafQ = [];
  win.requestAnimationFrame = (f) => { rafQ.push(f); return rafQ.length; };
  win.cancelAnimationFrame = () => {};
  if (packages) win.__emTestPackages = packages;
  const G = globalThis, saved = {};
  const keys = ['window', 'document', 'navigator', 'location', 'history', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'HTMLCanvasElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'matchMedia', 'addEventListener', 'removeEventListener', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'Worker', 'OffscreenCanvas', 'createImageBitmap', 'ResizeObserver', 'fetch', 'Image', 'self'];
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(G, k);
  const val = (k) => (k === 'window' || k === 'self' ? win : k === 'devicePixelRatio' ? 2 : k === 'innerWidth' ? w : k === 'innerHeight' ? h
    : k === 'Worker' || k === 'OffscreenCanvas' || k === 'createImageBitmap' ? undefined
    : k === 'ResizeObserver' ? class { observe() {} unobserve() {} disconnect() {} }
    : k === 'fetch' ? (fetchImpl || (() => Promise.reject(new TypeError('Failed to fetch (tests have no network)'))))
    : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]));
  for (const k of keys) Object.defineProperty(G, k, { value: val(k), configurable: true, writable: true });
  win.fetch = G.fetch;
  const errors = [], cerr = console.error, cwarn = console.warn, warns = [];
  console.error = (...a) => errors.push(a.map((x) => (x && x.stack) || String(x)).join(' '));
  console.warn = (...a) => warns.push(a.map(String).join(' '));
  const onRej = (e) => errors.push('unhandled: ' + ((e && e.stack) || e));
  process.on('unhandledRejection', onRej);
  win.addEventListener('error', (e) => errors.push('window error: ' + (e.error && e.error.stack || e.message)));
  const P = {
    win, doc, errors, warns, clip, $: (id) => doc.getElementById(id),
    frames(n = 1) { for (let i = 0; i < n; i++) { const q = rafQ.splice(0); for (const f of q) { try { f(performance.now()); } catch (e) { errors.push('frame: ' + ((e && e.stack) || e)); } } } },
    click(el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); },
    key(k, opts = {}) { (opts.target || doc.body).dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, ...opts })); },
    input(el, v) { el.value = String(v); el.dispatchEvent(new win.Event('input', { bubbles: true })); },
    close() { process.off('unhandledRejection', onRej); console.error = cerr; console.warn = cwarn; for (const k of keys) { if (saved[k]) Object.defineProperty(G, k, saved[k]); else delete G[k]; } win.close(); },
  };
  try { await import(pathToFileURL(path.join(HERE, 'main.js')).href + `?boot=${bootN++}`); } catch (e) { errors.push('import: ' + ((e && e.stack) || e)); }
  P.ready = win.__em ? await Promise.race([win.__em.ready, sleep(20000).then(() => 'timeout')]) : 'no __em';
  P.frames(2);
  return P;
}

// test packages: a catalog of three datasets (one fails to open), a data
// module that records opens, and a viewer that records calls
function testPackages() {
  const log = [];
  const catalog = {
    DATASETS: [
      { id: 'alpha', name: 'Alpha brain', short: 'Alpha', organism: 'Fly', tissue: 'brain', method: 'FIB-SEM', voxel: [8, 8, 8], size: [1000, 2000, 3000], credit: 'Lab A', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', links: [{ label: 'Site', href: 'https://example.org/a' }, { label: 'Bad', href: 'javascript:alert(1)' }], contrast: { lo: 10, hi: 240, gamma: 1 }, home: { x: 111, y: 222, z: 333, zoom: 0.05, plane: 'xy' } },
      { id: 'beta', name: 'Beta cell', organism: 'Human', tissue: 'HeLa cell', method: 'FIB-SEM', size: [500, 600, 700], credit: 'Lab B', licence: 'CC BY 4.0', links: [] },
      { id: 'gone', name: 'Gone volume', credit: 'Lab C', licence: 'CC BY 4.0', voxel: [4, 4, 4], size: [10, 10, 10], fail: true },
    ],
    BOOKMARKS: [
      { id: 'syn', dataset: 'alpha', x: 100, y: 200, z: 300, zoom: 1.5, plane: 'xy', caption: 'A synapse with vesicles. The dark dots are vesicles.', source: 'https://example.org/syn' },
      { id: 'mito', dataset: 'alpha', x: 400, y: 500, z: 600, zoom: 2, plane: 'xy', title: 'Mitochondrion', caption: 'Cristae fold the inner membrane.', source: 'https://example.org/mito' },
      { id: 'nuc', dataset: 'beta', x: 50, y: 60, z: 70, zoom: 0.5, plane: 'xz', caption: '<img src=x onerror="window.__xss=1"> Nuclear envelope', source: 'javascript:alert(1)' },
    ],
    ABOUT: ['Para one about FIB-SEM.', 'Para two about serial section TEM.'],
    DEFAULT_DATASET: 'alpha',
  };
  const data = {
    opened: [], disposed: [], phone: null,
    setPhone(b) { data.phone = b; },
    async openVolume(rec) {
      data.opened.push(rec.id);
      await sleep(5);
      if (rec.fail) throw new TypeError('Failed to fetch');
      return { id: rec.id, scales: [{ key: 's0', size: rec.size, resolution: rec.voxel || [4, 4, 4], chunk: [64, 64, 64] }], dispose() { data.disposed.push(rec.id); } };
    },
  };
  const view = {
    viewers: [],
    createViewer(canvas, opts) {
      const st = { x: 0, y: 0, z: 0, zoom: 0.01, plane: 'xy', contrast: { lo: 0, hi: 1, gamma: 1 } };
      const calls = [];
      const emit = () => opts.onState({ ...st });
      const v = {
        canvas, opts, calls,
        setVolume(vol) { calls.push(['setVolume', vol.id]); const s = vol.scales[0].size; Object.assign(st, { x: s[0] / 2, y: s[1] / 2, z: s[2] / 2, zoom: 0.02 }); emit(); },
        setPlane(p) { calls.push(['setPlane', p]); st.plane = p; emit(); },
        setSlice(nm) { calls.push(['setSlice', nm]); },
        goTo(t) { calls.push(['goTo', { ...t }]); for (const k of ['x', 'y', 'z', 'zoom', 'plane']) if (t[k] != null) st[k] = t[k]; emit(); },
        setContrast(lo, hi, g) { calls.push(['setContrast', Math.round(lo * 255), Math.round(hi * 255), g]); st.contrast = { lo, hi, gamma: g }; },
        autoContrast() { calls.push(['autoContrast']); st.contrast = { lo: 0.1, hi: 0.9, gamma: 1 }; emit(); return { lo: 0.1, hi: 0.9 }; },
        after(a, b) { let i = -1; for (let k = 0; k < calls.length; k++) if (calls[k][0] === a) i = k; return i >= 0 && calls.slice(i + 1).some((c) => c[0] === b); },
        setInvert(b) { calls.push(['setInvert', b]); },
        setInsets(i) { calls.push(['setInsets', { ...i }]); },
        setLayout(l) { calls.push(['setLayout', l]); },
        state() { return { ...st }; }, resize() { calls.push(['resize']); }, dispose() { calls.push(['dispose']); },
        last(name) { for (let i = calls.length - 1; i >= 0; i--) if (calls[i][0] === name) return calls[i]; return null; },
      };
      view.viewers.push(v);
      return v;
    },
  };
  return { catalog, data, view, log };
}

// ── 6 ──
sect('6. page in jsdom with test packages');
if (!loadJsdom()) console.log('  skip page checks: no jsdom (set NODE_PATH or JSDOM_DIR to a folder with jsdom@24.1.3)');
else {
  // desktop
  {
    const T = testPackages();
    const P = await boot({ packages: T });
    const { $ } = P, V = T.view.viewers[0];
    ok(P.ready === true && !P.errors.length, `desktop boot: ready ${P.ready}${P.errors.length ? '; ' + P.errors[0].slice(0, 300) : ''}`);
    ok($('nogl').hidden && $('nonet').hidden && $('loading').hidden, 'no message over a working view');
    ok(V && V.canvas === $('view') && V.opts.overlay === true && V.opts.minimap === true && V.opts.source === T.data, 'createViewer gets #view, the data module, overlay and minimap');
    ok(V.last('setVolume')[1] === 'alpha' && T.data.phone === false, 'the default dataset opens; DATA gets setPhone(false)');
    ok($('dsName').textContent === 'Alpha brain' && $('dsMeta').textContent === 'Fly, brain · FIB-SEM · 8 nm voxels · 8 × 16 × 24 µm', `title: ${$('dsName').textContent} / ${$('dsMeta').textContent}`);
    ok($('credit').textContent === 'Data: Lab A · CC BY 4.0', `credit line: ${$('credit').textContent}`);
    ok(JSON.stringify(V.last('setContrast')) === '["setContrast",10,240,1]' && $('loV').textContent === '10', 'the dataset contrast goes to the viewer and the sliders');
    const home = V.calls.find((c) => c[0] === 'goTo');
    ok(home && home[1].x === 111 && home[1].y === 222 && home[1].z === 333 && home[1].zoom === 0.05 && home[1].plane === 'xy', `with no hash the dataset opens at its catalog home: ${JSON.stringify(home && home[1])}`);
    ok($('panel').classList.contains('open') && !P.doc.body.classList.contains('panel-closed') && $('panelOpen').hidden, 'desktop: the panel starts open');
    ok(V.calls.some((c) => c[0] === 'setInsets'), 'the viewer gets insets');
    const cards = P.doc.querySelectorAll('#dsList .ds-card');
    ok(cards.length === 3 && cards[0].getAttribute('aria-pressed') === 'true' && /Viewing/.test(cards[0].textContent), `dataset cards: ${cards.length}, alpha pressed`);
    ok(!P.doc.querySelector('#dsList a[href^="javascript"]') && P.doc.querySelectorAll('#dsList a[href^="https"]').length >= 1, 'dataset links: https only');
    const items = () => [...P.doc.querySelectorAll('#placeList .pl-item')].map((b) => b.dataset.id);
    ok(items().join() === 'syn,mito', `places of this dataset: ${items().join()}`);
    ok(P.doc.querySelector('#placeList .pl-title').textContent === 'A synapse with vesicles' && /depth 2\.4 µm/.test(P.doc.querySelector('#placeList .pl-meta').textContent), 'place title from the caption, depth in µm');
    P.click(P.doc.querySelector('#placeScope [data-scope="all"]'));
    ok(items().join() === 'syn,mito,nuc', `all places: ${items().join()}`);
    P.input($('placeSearch'), 'cristae');
    ok(items().join() === 'mito' && $('placeEmpty').hidden, 'search "cristae" finds the mitochondrion');
    P.input($('placeSearch'), 'zebra unicorn');
    ok(!items().length && !$('placeEmpty').hidden, 'no match shows the empty note');
    P.input($('placeSearch'), '');

    P.click(P.doc.querySelector('#placeList .pl-item[data-id="syn"]'));
    await sleep(20);
    const g = V.last('goTo');
    ok(g && g[1].x === 100 && g[1].y === 200 && g[1].z === 300 && g[1].zoom === 1.5 && g[1].plane === 'xy', `place: goTo ${JSON.stringify(g && g[1])}`);
    ok(!$('caption').hidden && $('capTitle').textContent === 'A synapse with vesicles' && $('capSrc').href === 'https://example.org/syn', 'the caption card shows the place and its source');
    ok(P.doc.querySelector('#placeList .pl-item[aria-current="true"]').dataset.id === 'syn', 'the chosen place is marked in the list');
    await sleep(520);
    ok(/^#d=alpha&p=xy&x=100&y=200&z=300&zm=1\.5&c=10,240,1&b=syn$/.test(P.win.location.hash), `hash: ${P.win.location.hash}`);

    P.click($('capNext'));
    await sleep(10);
    ok(V.last('goTo')[1].x === 400 && V.last('goTo')[1].animate === true && $('capTitle').textContent === 'Mitochondrion', 'next place: a smooth flight in the same dataset');
    P.key('p');
    await sleep(10);
    ok(V.last('goTo')[1].x === 100, 'key P: previous place');

    P.click(P.doc.querySelector('#placeList .pl-item[data-id="nuc"]'));
    await sleep(40);
    ok(V.last('setVolume')[1] === 'beta' && T.data.disposed.includes('alpha'), 'a place in another dataset opens that dataset and disposes the old volume');
    ok(V.last('goTo')[1].plane === 'xz' && P.doc.querySelector('#planeSeg [data-plane="xz"]').getAttribute('aria-checked') === 'true', 'the place plane XZ is set and shown');
    ok($('capSrc').hidden && !P.doc.querySelector('img') && P.win.__xss === undefined && $('capText').textContent.startsWith('<img'), 'caption text stays text; a javascript: source is not a link');
    ok($('dsMeta').textContent.includes('4 nm voxels') && $('dsMeta').textContent.includes('2 × 2.4 × 2.8 µm'), `voxel size from the volume when the record has none: ${$('dsMeta').textContent}`);
    ok(!V.after('setVolume', 'setContrast'), 'a dataset with no catalog window keeps the VIEW auto window (no setContrast)');
    ok($('slice').max === '599' && /slice 60/.test($('sliceV').textContent), `XZ depth slider: max ${$('slice').max}, ${$('sliceV').textContent}`);

    P.input($('slice'), 100);
    ok(JSON.stringify(V.last('setSlice')) === '["setSlice",402]', `slice slider -> setSlice in nm: ${JSON.stringify(V.last('setSlice'))}`);
    P.input($('lo'), 30);
    // the sliders follow the window VIEW draws (here still 10..240), so a user change keeps its white point
    ok(JSON.stringify(V.last("setContrast")) === `["setContrast",30,240,1]` && $("loV").textContent === "30", `black point keeps the window on screen: ${JSON.stringify(V.last("setContrast"))}`);
    P.input($('lo'), 255);
    ok(V.last('setContrast')[1] === 239, 'the black point stays under the white point');
    P.input($('lo'), 30);
    P.input($('gamma'), 1.5);
    P.key('i');
    ok(JSON.stringify(V.last('setInvert')) === '["setInvert",true]' && $('invert').checked, 'key I inverts');
    P.key('1');
    ok(JSON.stringify(V.last('setPlane')) === '["setPlane","xy"]' && P.doc.querySelector('#planeSeg2 [data-plane="xy"]').getAttribute('aria-checked') === 'true', 'key 1: XY, both plane switches agree');
    P.click(P.doc.querySelector('#planeSeg [data-plane="yz"]'));
    ok(V.last('setPlane')[1] === 'yz' && $('slice').max === '499', 'plane button YZ, the slider follows the x axis');
    $('threeView').checked = true; $('threeView').dispatchEvent(new P.win.Event('change'));
    ok(JSON.stringify(V.last('setLayout')) === '["setLayout","three"]', 'three-plane layout');
    P.key('1', { target: $('placeSearch') });
    ok(V.last('setPlane')[1] === 'yz', 'keys typed in the search box do not change the plane');
    P.click($('resetImage'));
    ok(V.last('autoContrast') && !V.after('autoContrast', 'setContrast') && $('loV').textContent === '26' && $('hiV').textContent === '230' && !$('invert').checked, `reset image: back to the auto window, sliders ${$('loV').textContent}..${$('hiV').textContent}`);
    await sleep(520);
    ok(!/[&#]c=/.test(P.win.location.hash), `the auto window stays out of the hash: ${P.win.location.hash}`);

    const r = await P.win.__em.share();
    ok(r === 'copied' && P.clip.length === 1 && /^http:\/\/localhost:8963\/stella-nova\/pages\/em-explorer\/index\.html#d=beta&p=yz&/.test(P.clip[0]) && !$('toast').hidden, `share copies the link: ${P.clip[0]}`);

    P.key('?');
    ok(!$('about').hidden && $('aboutBody').textContent.includes('Para one about FIB-SEM.'), 'key ? opens the about sheet with the catalog text');
    const cr = P.doc.querySelectorAll('#creditsBody .credits li');
    ok(cr.length === 3 && /Lab A/.test(cr[0].textContent) && P.doc.querySelector('#creditsBody a[href="https://creativecommons.org/licenses/by/4.0/"]') && !P.doc.querySelector('#creditsBody a[href^="javascript"]'), 'credits: one entry per dataset, licence link, no javascript: link');
    P.key('Escape');
    ok($('about').hidden, 'Escape closes the about sheet');

    await P.win.__em.selectDataset('gone');
    ok(!$('nonet').hidden && $('nonetTitle').textContent === 'The data did not load' && /did not answer/.test($('nonetWhy').textContent), `a failed open shows the network message: ${$('nonetWhy').textContent.slice(0, 60)}`);
    ok($('loading').hidden, 'the loading chip goes away after a failure');
    const n0 = T.data.opened.length;
    P.click($('retryBtn'));
    await sleep(30);
    ok(T.data.opened.length === n0 + 1 && T.data.opened[T.data.opened.length - 1] === 'gone' && !$('nonet').hidden, 'Try again opens the dataset again');
    P.click($('otherDsBtn'));
    ok($('nonet').hidden && $('panel').classList.contains('open') && !$('tab-data').hidden, '"Pick another dataset" opens the datasets tab');
    P.click(P.doc.querySelector('#dsList .ds-card[data-id="alpha"]'));
    await sleep(30);
    ok(V.last('setVolume')[1] === 'alpha' && $('dsName').textContent === 'Alpha brain', 'a dataset card opens the dataset');

    // two quick picks: only the last one wins
    const a = P.win.__em.selectDataset('beta'), b = P.win.__em.selectDataset('alpha');
    const [ra, rb] = await Promise.all([a, b]);
    ok(ra === false && rb === true && V.last('setVolume')[1] === 'alpha' && T.data.disposed.filter((x) => x === 'beta').length >= 2, 'a later pick cancels an earlier one (the late volume is disposed)');

    P.win.dispatchEvent(new P.win.Event('offline'));
    Object.defineProperty(P.win.navigator, 'onLine', { value: false, configurable: true });
    P.win.dispatchEvent(new P.win.Event('offline'));
    ok(!$('offline').hidden, 'offline strip');
    Object.defineProperty(P.win.navigator, 'onLine', { value: true, configurable: true });
    P.win.dispatchEvent(new P.win.Event('online'));
    ok($('offline').hidden, 'online again: the strip goes');

    P.click($('panelClose'));
    ok(!$('panel').classList.contains('open') && !$('panelOpen').hidden && P.doc.body.classList.contains('panel-closed') && $('panel').getAttribute('aria-hidden') === 'true', 'desktop: the panel closes, the open button shows');
    P.click($('panelOpen'));
    ok($('panel').classList.contains('open'), 'and opens again');
    const tabs = P.doc.querySelectorAll('#panel [role=tab]');
    tabs[0].focus(); P.key('ArrowRight', { target: tabs[0] });
    ok(!$('tab-data').hidden && $('tab-places').hidden && tabs[1].getAttribute('aria-selected') === 'true', 'arrow keys move between tabs');

    const rel = P.win.__snRelease; rel && rel();
    ok(V.last('dispose'), '__snRelease disposes the viewer');
    ok(!P.errors.length, `no errors in the desktop run${P.errors.length ? ': ' + P.errors[0].slice(0, 300) : ''}`);
    P.close();
  }

  // a shared link opens the same view
  {
    const T = testPackages();
    const P = await boot({ packages: T, hash: 'd=beta&p=yz&x=10&y=20&z=30&zm=0.25&c=12,200,1.5&inv=1' });
    const V = T.view.viewers[0], g = V.last('goTo');
    ok(P.ready === true && V.last('setVolume')[1] === 'beta' && g && g[1].x === 10 && g[1].plane === 'yz' && g[1].zoom === 0.25, `hash boot: goTo ${JSON.stringify(g && g[1])}`);
    ok(JSON.stringify(V.last('setContrast')) === '["setContrast",12,200,1.5]' && JSON.stringify(V.last('setInvert')) === '["setInvert",true]', 'hash contrast and invert beat the dataset default');
    ok(P.doc.querySelector('#planeSeg [data-plane="yz"]').getAttribute('aria-checked') === 'true', 'hash plane shown');
    P.win.location.hash = 'd=alpha&b=mito';
    P.win.dispatchEvent(new P.win.HashChangeEvent('hashchange'));
    await sleep(40);
    ok(V.last('setVolume')[1] === 'alpha' && V.last('goTo')[1].x === 400 && !P.$('caption').hidden, 'a new hash from the shell (Back) moves the view to the place');
    ok(!P.errors.length, `no errors${P.errors.length ? ': ' + P.errors[0].slice(0, 300) : ''}`);
    P.close();
  }
  {
    const T = testPackages();
    const P = await boot({ packages: T, hash: 'b=syn' });
    const V = T.view.viewers[0];
    ok(V.last('goTo') && V.last('goTo')[1].x === 100 && !P.$('caption').hidden && P.$('capTitle').textContent === 'A synapse with vesicles', 'hash b=syn alone opens the place');
    P.close();
  }
  {
    const T = testPackages();
    const P = await boot({ packages: T, hash: 'd=nope&x=1' });
    ok(T.view.viewers[0].last('setVolume')[1] === 'alpha' && !P.errors.length, 'an unknown dataset in the hash falls back to the default');
    P.close();
  }

  // phone
  {
    const T = testPackages();
    const P = await boot({ packages: T, w: 390, h: 844, coarse: true });
    const { $ } = P, V = T.view.viewers[0];
    ok(P.ready === true && T.data.phone === true, 'phone boot; DATA gets setPhone(true)');
    ok(!$('panel').classList.contains('open') && P.doc.body.classList.contains('panel-closed'), 'phone: the sheet starts closed, so the image fills the screen');
    const dockPlaces = P.doc.querySelector('#dock [data-tab="places"]');
    P.click(dockPlaces);
    ok($('panel').classList.contains('open') && !$('tab-places').hidden && dockPlaces.classList.contains('on') && dockPlaces.getAttribute('aria-expanded') === 'true', 'dock Places opens the sheet on places');
    P.click(P.doc.querySelector('#dock [data-tab="image"]'));
    ok($('panel').classList.contains('open') && !$('tab-image').hidden && !dockPlaces.classList.contains('on'), 'dock Image switches the tab');
    P.click(P.doc.querySelector('#dock [data-tab="image"]'));
    ok(!$('panel').classList.contains('open'), 'a second tap closes the sheet');
    P.click(dockPlaces);
    const grip = $('sheetGrip');
    const pe = (type, y) => grip.dispatchEvent(new P.win.MouseEvent(type, { clientY: y, bubbles: true }));
    pe('pointerdown', 500); pe('pointerup', 500);
    ok($('panel').classList.contains('full'), 'a tap on the grip: full height');
    pe('pointerdown', 300); pe('pointermove', 400); pe('pointerup', 400);
    ok($('panel').classList.contains('open') && !$('panel').classList.contains('full'), 'drag down from full: half height');
    pe('pointerdown', 300); pe('pointermove', 420); pe('pointerup', 420);
    ok(!$('panel').classList.contains('open'), 'drag down from half: closed');
    P.click(dockPlaces);
    P.click(P.doc.querySelector('#placeList .pl-item[data-id="mito"]'));
    await sleep(10);
    ok(!$('panel').classList.contains('open') && !$('caption').hidden && V.last('goTo')[1].x === 400, 'phone: a place closes the sheet and shows the caption');
    P.key('Escape');
    ok($('caption').hidden, 'Escape closes the caption');
    P.click($('dockShare'));
    await sleep(10);
    ok(P.clip.length === 1 || !$('toast').hidden, 'dock Share');
    ok(!P.errors.length, `no errors in the phone run${P.errors.length ? ': ' + P.errors[0].slice(0, 300) : ''}`);
    P.close();
  }

  // no WebGL2
  {
    const T = testPackages();
    const P = await boot({ packages: T, gl: false });
    ok(P.ready === false && !P.$('nogl').hidden && !T.view.viewers.length, 'no WebGL2: the message shows and no viewer starts');
    ok(P.doc.querySelectorAll('#dsList .ds-card').length === 3 && P.$('dsName').textContent === 'Alpha brain', 'no WebGL2: the catalog still shows');
    P.close();
  }
  // a viewer that throws
  {
    const T = testPackages();
    T.view.createViewer = () => { throw new Error('no context'); };
    const P = await boot({ packages: T });
    ok(P.ready === false && !P.$('nogl').hidden, 'createViewer throws: the WebGL2 message shows');
    P.close();
  }
}

// ── 6b ──
sect('6b. page in jsdom with the real VIEW, the test catalog and a synthetic volume');
if (!loadJsdom() || !fakeCanvas || !fs.existsSync(path.join(HERE, 'view', 'index.js'))) console.log('  skip: no jsdom, no fake WebGL2 or no view/index.js');
else {
  const VIEW = await import('./view/index.js');
  const T = testPackages();
  T.view = VIEW;
  T.data.openVolume = async (rec) => {
    T.data.opened.push(rec.id);
    if (rec.fail) throw new TypeError('Failed to fetch');
    const v = VIEW.stubVolume({ size: rec.size.map((n) => n * 16), resolution: rec.voxel || [4, 4, 4], levels: 4 });
    v.id = rec.id; v.dispose = () => T.data.disposed.push(rec.id);
    return v;
  };
  const P = await boot({ packages: T });
  const em = P.win.__em, vw = em.viewer;
  for (let i = 0; i < 20; i++) { P.frames(1); await sleep(5); }
  ok(P.ready === true && vw && typeof vw.state === 'function', `real viewer boots (ready ${P.ready})`);
  P.click(P.doc.querySelector('#placeList .pl-item[data-id="syn"]'));
  for (let i = 0; i < 400 && Math.abs(vw.state().z - 300) > 1; i++) { P.frames(1); await sleep(5); }
  let st = vw.state();
  ok(Math.abs(st.x - 100) < 1 && Math.abs(st.y - 200) < 1 && Math.abs(st.z - 300) < 1 && Math.abs(st.zoom - 1.5) < 0.01, `goTo a place: x ${st.x && st.x.toFixed(1)} y ${st.y && st.y.toFixed(1)} z ${st.z && st.z.toFixed(1)} zoom ${st.zoom && st.zoom.toFixed(3)}`);
  P.click(P.$('capNext'));
  for (let i = 0; i < 400 && Math.abs(vw.state().x - 400) > 1; i++) { P.frames(1); await sleep(5); }
  st = vw.state();
  ok(Math.abs(st.x - 400) < 1 && Math.abs(st.zoom - 2) < 0.01, `the flight to the next place lands: x ${st.x.toFixed(1)} zoom ${st.zoom.toFixed(3)}`);
  P.input(P.$('lo'), 51); P.input(P.$('hi'), 204); P.input(P.$('gamma'), 1.4); P.key('i');
  st = vw.state();
  ok(st.contrast && Math.abs(st.contrast.lo - 0.2) < 0.01 && Math.abs(st.contrast.hi - 0.8) < 0.01 && Math.abs(st.contrast.gamma - 1.4) < 0.01 && st.invert === true, `contrast reaches the viewer: ${JSON.stringify(st.contrast)} invert ${st.invert}`);
  P.input(P.$('lo'), 0); P.input(P.$('hi'), 1);
  ok(Math.abs(vw.state().contrast.hi - 1 / 255) < 1e-3, 'a white point of 1 stays 1/255 (not the 0..1 range)');
  P.key('2');
  for (let i = 0; i < 5; i++) { P.frames(1); await sleep(5); }
  ok(vw.state().plane === 'xz' && P.$('slice').max === String(2000 * 16 - 1), `plane XZ in the viewer, depth slider over y (max ${P.$('slice').max})`);
  P.input(P.$('slice'), 1000);
  for (let i = 0; i < 5; i++) { P.frames(1); await sleep(5); }
  ok(Math.abs(vw.state().y - 1000) <= 1, `the depth slider moves the slice: y ${vw.state().y}`);
  await sleep(500);
  ok(/d=alpha&p=xz&/.test(P.win.location.hash) && /&y=100[01](\.\d)?&/.test(P.win.location.hash), `hash follows the real viewer: ${P.win.location.hash}`);
  await em.selectDataset('beta');
  for (let i = 0; i < 5; i++) { P.frames(1); await sleep(5); }
  ok(T.data.disposed.includes('alpha') && P.$('dsName').textContent === 'Beta cell', 'dataset switch on the real viewer');
  window.dispatchEvent(new P.win.Event('resize'));
  P.frames(2);
  P.win.__snRelease();
  ok(!P.errors.length, `no errors with the real viewer${P.errors.length ? ': ' + P.errors[0].slice(0, 400) : ''}`);
  P.close();
}

// ── 6c ──
// The two modes together: main.js mounts ui/sem-panel.js, so the slice
// explorer and the "Surface scans" layer share the hash and the keys.
sect('6c. page in jsdom with the Surface scans mode');
if (!loadJsdom() || !fakeCanvas || !fs.existsSync(path.join(HERE, 'ui', 'sem-panel.js'))) console.log('  skip: no jsdom, no fake WebGL2 or no ui/sem-panel.js');
else {
  const T = testPackages();
  const fromDisk = async (url) => {
    const u = new URL(String(url));
    const p = u.protocol === 'file:' ? fileURLToPath(u) : path.join(HERE, u.pathname.replace('/stella-nova/pages/em-explorer/', ''));
    if (!/[\\/]sem[\\/]models[\\/]/.test(p) || !fs.existsSync(p)) throw new TypeError('Failed to fetch (tests have no network)');
    const b = fs.readFileSync(p);
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  const P = await boot({ packages: T, fetchImpl: fromDisk });
  for (let i = 0; i < 200 && !P.win.__emSem; i++) await sleep(5);
  const sem = P.win.__emSem, vw = T.view.viewers[0];
  ok(P.ready === true && sem && vw, `main.js mounts the mode (ready ${P.ready}, __emSem ${!!sem})`);
  ok(!P.doc.documentElement.classList.contains('em-sem') && !P.$('sem') && P.$('semBtn'), 'the slice explorer is the default mode');
  const opened = sem && await sem.open('puffball');
  ok(opened === true && P.doc.documentElement.classList.contains('em-sem') && /#sem=puffball$/.test(P.win.location.href), `the mode opens over the slice explorer (${P.win.location.hash})`);
  // a late view report from the slice explorer must not take the hash
  vw.goTo({ x: 10, y: 20, z: 30, zoom: 0.5 });
  await sleep(600);
  ok(/#sem=puffball$/.test(P.win.location.href), `the slice view keeps off the hash while the mode is open (${P.win.location.hash})`);
  // the slice explorer keys do not act on the hidden view
  const goTos = vw.calls.filter((c) => c[0] === 'goTo').length, planes = vw.calls.filter((c) => c[0] === 'setPlane').length;
  let reached = 0;
  const spy = () => { reached++; };
  P.win.addEventListener('keydown', spy);
  P.key('n'); P.key('2'); P.key('ArrowLeft');
  P.win.removeEventListener('keydown', spy);
  ok(vw.calls.filter((c) => c[0] === 'goTo').length === goTos && vw.calls.filter((c) => c[0] === 'setPlane').length === planes, 'the keys n and 2 do not move the hidden slice view');
  ok(reached === 0, `the keys do not reach the slice view's window listener (${reached})`);
  P.key('Escape');
  ok(!sem.isOpen() && !P.doc.documentElement.classList.contains('em-sem'), 'Escape goes back to the slice explorer');
  vw.goTo({ x: 11, y: 21, z: 31, zoom: 0.5 });
  await sleep(600);
  ok(/d=alpha&/.test(P.win.location.hash), `after close the slice view writes the hash again (${P.win.location.hash})`);
  P.key('3');
  ok(vw.calls.filter((c) => c[0] === 'setPlane').length === planes + 1, 'after close the slice explorer keys work again');
  ok(!P.errors.length, `no errors with both modes${P.errors.length ? ': ' + P.errors[0].slice(0, 400) : ''}`);
  P.close();
}

// ── 7 ──
sect('7. page in jsdom with the real packages and no network');
if (!loadJsdom()) console.log('  skip: no jsdom');
else if (!fakeCanvas) console.log('  skip: no fake WebGL2 (pages/coral-reef/tests/fake-gl.mjs)');
else {
  const P = await boot({});
  const em = P.win.__em;
  const cat = em && em.catalog;
  const errs = P.errors.filter((e) => !/Failed to fetch|tests have no network/.test(e));
  ok(P.ready !== 'timeout' && P.ready !== 'no __em', `boot ends (ready: ${P.ready})`);
  ok(!errs.length, `no errors other than the network${errs.length ? ': ' + errs[0].slice(0, 400) : ''}`);
  ok(P.$('nogl').hidden, 'fake WebGL2: no WebGL2 message');
  const stubs = (em.packages.errors || []).map((x) => x.pkg + ': ' + String(x.error && x.error.message).slice(0, 80));
  console.log(`  note packages on stubs: ${stubs.length ? stubs.join(' | ') : 'none'}`);
  ok(cat && P.doc.querySelectorAll('#dsList .ds-card').length === cat.datasets.length && cat.datasets.length >= 1, `dataset cards ${P.doc.querySelectorAll('#dsList .ds-card').length} = catalog ${cat && cat.datasets.length}`);
  ok(P.doc.querySelectorAll('#placeList .pl-item').length >= Math.min(1, cat.bookmarks.length), `places listed: ${P.doc.querySelectorAll('#placeList .pl-item').length} (catalog ${cat.bookmarks.length})`);
  ok(!P.$('nonet').hidden || em.volume(), `with no network the page says so (${P.$('nonetTitle').textContent}: ${P.$('nonetWhy').textContent.slice(0, 80)})`);
  P.close();
}

// ── 8 ──
// --live: the real page streams a real dataset end to end. MICrONS
// minnie65: only its scale 0 is raw+gzip, which node can decode; its other
// scales are JPEG, which needs a browser, so those tiles fail here and back
// off. The run opens the dataset at its home view, then flies to the myelin
// place at zoom 1 (scale 0) and waits for those tiles.
if (LIVE) {
  sect('8. live: the real page in jsdom streams minnie65');
  if (!loadJsdom() || !fakeCanvas) console.log('  skip: no jsdom or no fake WebGL2');
  else {
    const P = await boot({ w: 640, h: 480, hash: 'd=minnie65', fetchImpl: NODE_FETCH });
    const em = P.win.__em, vw = em && em.viewer;
    const vol = em && em.volume();
    ok(P.ready === true && vol && em.state().dataset === 'minnie65' && vol.scales.length > 1, `minnie65 opens with its real info (ready ${P.ready}, ${vol && vol.scales.length} scales, s0 ${vol && vol.scales[0].size.join(' x ')})`);
    const ds = em.catalog.datasets.find((d) => d.id === 'minnie65');
    let st = vw.state();
    ok(Math.abs(st.x - ds.home.x) < 2 && Math.abs(st.zoom / ds.home.zoom - 1) < 0.02 && st.plane === ds.home.plane, `home view from the catalog: x ${st.x.toFixed(0)} y ${st.y.toFixed(0)} zoom ${st.zoom}`);
    await em.goBookmark('mm-myelin');
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) { P.frames(1); await sleep(25); st = vw.state(); if (st.ready && st.scaleIndex === 0 && st.tiles.total > 0) break; }
    ok(st.ready && st.scaleIndex === 0 && st.tiles.loaded === st.tiles.total && st.tiles.total > 0, `myelin place at scale ${st.scaleKey}: ${st.tiles.loaded}/${st.tiles.total} tiles in ${((Date.now() - t0) / 1000).toFixed(1)} s (${st.errors} JPEG tiles failed in node)`);
    ok(Math.abs(st.x - 60000) < 2 && Math.abs(st.y - 121000) < 2 && Math.abs(st.z - 6000) < 1, `the view is on the place: ${st.x.toFixed(0)}, ${st.y.toFixed(0)}, ${st.z.toFixed(0)}`);
    const sl = await vol.getSlice(0, 'xy', 6000, [59936, 120936, 60064, 121064]);
    let mn = 255, mx = 0, sum = 0;
    for (const v of sl.data) { if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    ok(sl.width === 128 && sl.height === 128 && mx - mn > 20, `real EM pixels at the place: 128 x 128, grey ${mn}..${mx}, mean ${(sum / sl.data.length).toFixed(0)}`);
    const stats = await vol.stats();
    console.log(`  note ${stats.fetched} fetches, ${(stats.fetchedBytes / 1e6).toFixed(2)} MB, cache ${(stats.cacheBytes / 1e6).toFixed(2)} MB`);
    ok(stats.fetchedBytes < 20e6, `the run costs under 20 MB (${(stats.fetchedBytes / 1e6).toFixed(2)} MB)`);
    ok(!P.errors.length, `no page errors${P.errors.length ? ': ' + P.errors[0].slice(0, 400) : ''}`);
    P.win.__snRelease();
    P.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('failed:\n  ' + fails.join('\n  ')); process.exit(1); }
process.exit(0);
