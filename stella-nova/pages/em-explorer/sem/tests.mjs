#!/usr/bin/env node
// ============================================================================
//  EM EXPLORER  ·  sem/tests.mjs — the "Surface scans" mode test (SEM)
// ----------------------------------------------------------------------------
//  Run from the repo root:
//    NODE_PATH=<dir with jsdom@24.1.3>/node_modules node stella-nova/pages/em-explorer/sem/tests.mjs
//  Offline. No browser runs. Sections:
//    1. sources   sources.json, catalog.js, models/manifest.json and the GLB
//                 files agree; licences are CC0, CC BY or CC BY-SA only
//    2. models    every GLB parses with sem/glb.js; sizes, budgets, units,
//                 normals, indices, textures
//    3. scale     niceScale gives 1-2-5 lengths
//    4. viewer    createSemViewer on a fake WebGL2 (pages/coral-reef/tests/
//                 fake-gl.mjs): it draws every triangle; the stereo orbit
//                 limit; the scale follows the zoom; dispose
//    5. page      jsdom: the slice explorer is the default; the switch opens
//                 the layer, loads a GLB, shows the caption and credit, sets
//                 the hash, and Escape closes it; a sem= hash opens it
//    6. entry     main.js has the one entry line
//
//  grep -n targets: "sect('"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.dirname(HERE);
let pass = 0, fail = 0;
const fails = [];
function ok(c, msg) { if (c) { pass++; console.log('  ok   ' + msg); } else { fail++; fails.push(msg); console.log('  FAIL ' + msg); } }
function sect(t) { console.log('\n' + t); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { parseGlb } = await import('./glb.js');
const { SCANS, METHOD_LABEL, SEM_ABOUT, scanById } = await import('./catalog.js');
const { niceScale, createSemViewer } = await import('./viewer.js');
const sources = JSON.parse(fs.readFileSync(path.join(HERE, 'build', 'sources.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'models', 'manifest.json'), 'utf8'));

// ── 1 ──
sect('1. sources, catalog, manifest');
{
  const sIds = sources.objects.map((o) => o.id), cIds = SCANS.map((s) => s.id), mIds = Object.keys(manifest);
  ok(JSON.stringify(sIds) === JSON.stringify(cIds), `catalog order = sources order (${cIds.length} scans)`);
  ok(JSON.stringify([...mIds].sort()) === JSON.stringify([...cIds].sort()), `manifest has the same ${mIds.length} ids`);
  ok(cIds.length >= 8, `at least 8 scans (${cIds.length})`);
  const kinds = new Set(SCANS.map((s) => s.kind.split(' ')[0]));
  ok(kinds.size >= 6, `scans of ${kinds.size} different kinds`);
  const files = fs.readdirSync(path.join(HERE, 'models')).filter((f) => f.endsWith('.glb'));
  ok(files.length === cIds.length && SCANS.every((s) => files.includes(s.file)), `one GLB per scan, no extra files (${files.length})`);
  const OPEN = /^CC (BY|BY-SA) [34]\.0$|^CC0/;
  for (const s of SCANS) {
    const src = sources.objects.find((o) => o.id === s.id);
    ok(OPEN.test(s.licence) && !/NC|ND/.test(s.licence) && src.licence === s.licence, `${s.id}: open licence ${s.licence}, same in sources.json`);
    ok(/^https:\/\//.test(s.source) && /^https:\/\/creativecommons\.org\//.test(s.licenceUrl) && s.source === src.record, `${s.id}: source and licence links`);
    ok(s.title && s.kind && s.caption && s.credit && METHOD_LABEL[s.method], `${s.id}: title, kind, caption, credit, method`);
    ok(src.files.every((f) => /^[0-9a-f]{32}$/.test(f.md5 || '') || /^[0-9a-f]{40}$/.test(f.sha1 || '')), `${s.id}: every source file is pinned by a checksum`);
    ok((s.method === 'mesh') === (src.kind === 'mesh'), `${s.id}: method agrees with the build kind`);
  }
  ok(scanById('aphid') && scanById('nope') === null, 'scanById');
  ok(Array.isArray(SEM_ABOUT) && SEM_ABOUT.length >= 3, 'the about text is there');
  const credits = fs.readFileSync(path.join(HERE, 'CREDITS.md'), 'utf8');
  ok(SCANS.every((s) => credits.includes(s.source) || credits.includes(decodeURI(s.source))), 'sem/CREDITS.md links every source record');
  ok(/left out/i.test(credits), 'sem/CREDITS.md says what was left out');
}

// ── 2 ──
sect('2. models');
const MODELS = {};
{
  let total = 0;
  for (const s of SCANS) {
    const p = path.join(HERE, 'models', s.file);
    const buf = fs.readFileSync(p);
    total += buf.length;
    let m = null;
    try { m = parseGlb(buf); } catch (e) { ok(false, `${s.id}: parse (${e.message})`); continue; }
    MODELS[s.id] = { m, buf };
    const man = manifest[s.id];
    ok(buf.length < 3e6 && buf.length === man.bytes, `${s.id}: ${(buf.length / 1e6).toFixed(2)} MB (< 3 MB, = manifest)`);
    ok(m.vertexCount === man.vertices && m.triangleCount === man.faces, `${s.id}: ${m.vertexCount} vertices, ${m.triangleCount} triangles (= manifest)`);
    ok(m.indices instanceof Uint16Array, `${s.id}: 16-bit indices`);
    const err = Math.max(...m.sizeUm.map((v, k) => Math.abs(v - man.sizeUm[k]) / Math.max(man.sizeUm[k], 1e-9)));
    ok(err < 0.002, `${s.id}: size ${m.sizeUm.map((v) => v.toFixed(1)).join(' x ')} um (= manifest, error ${(err * 100).toFixed(3)} %)`);
    ok(m.extras.unit === 'um' && m.extras.id === s.id && m.credit.includes(s.licence), `${s.id}: GLB extras (unit um, id) and the licence in asset.copyright`);
    let bad = 0;
    for (let i = 0; i < m.normals.length; i += 3) { const l = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]); if (!(l > 0.99 && l < 1.01)) bad++; }
    ok(bad === 0, `${s.id}: ${m.normals.length / 3} unit normals`);
    if (s.method === 'stereo') {
      ok(m.image && m.image.mimeType === 'image/jpeg' && m.image.bytes[0] === 0xff && m.image.bytes[1] === 0xd8, `${s.id}: the SEM image is in the GLB (${m.image ? (m.image.bytes.length / 1e3).toFixed(0) : 0} kB JPEG)`);
      ok(m.uvs && m.uvs.every((v) => v >= 0 && v <= 1), `${s.id}: texture coordinates in 0..1`);
      ok(man.rowResidualPx < 1 && man.validFraction > 0.5, `${s.id}: stereo rows match to ${man.rowResidualPx} px, ${(man.validFraction * 100).toFixed(0)} % of pixels pass the left-right check`);
    } else {
      ok(m.sizeUm[0] >= m.sizeUm[1] && m.sizeUm[1] >= m.sizeUm[2] * 0.8, `${s.id}: long axis on x`);
    }
  }
  ok(total < 25e6, `all models ${(total / 1e6).toFixed(2)} MB (< 25 MB)`);
  // the phytoplankton sizes from the paper: P. micans about 40 x 25 um
  const pm = MODELS.prorocentrum && MODELS.prorocentrum.m.sizeUm;
  ok(pm && pm[0] > 35 && pm[0] < 55 && pm[1] > 20 && pm[1] < 32, 'Prorocentrum is about 45 x 27 um (the paper says about 40 x 25 um)');
  // a broken file fails clearly
  let msg = '';
  try { parseGlb(new Uint8Array(40).buffer); } catch (e) { msg = e.message; }
  ok(/not a GLB/.test(msg), 'a file that is not a GLB gives "not a GLB file"');
  const cut = MODELS.halamphora && MODELS.halamphora.buf.subarray(0, 5000);
  msg = '';
  try { parseGlb(cut); } catch (e) { msg = e.message; }
  ok(/cut short|past/.test(msg), `a cut GLB fails (${msg.slice(0, 50)})`);
}

// ── 3 ──
sect('3. scale bar');
{
  const a = niceScale(1, 120), b = niceScale(0.013, 120), c = niceScale(30, 100);
  ok(a.um === 100 && a.label === '100 µm' && Math.abs(a.px - 100) < 1e-9, `1 um/px -> ${a.label}, ${a.px} px`);
  ok(b.um === 1 && b.label === '1 µm', `0.013 um/px -> ${b.label}, ${b.px.toFixed(0)} px`);
  ok(c.um === 2000 && c.label === '2 mm', `30 um/px -> ${c.label}`);
  ok(niceScale(0.0004, 120).label === '20 nm', 'small scales in nm');
  ok(niceScale(0) === null && niceScale(NaN) === null, 'no scale for 0 or NaN');
}

// ── 4 ──
sect('4. viewer (fake WebGL2)');
let fakeCanvas = null;
try { ({ fakeCanvas } = await import('../../coral-reef/tests/fake-gl.mjs')); } catch (e) { /* none */ }
if (!fakeCanvas) console.log('  skip: no fake WebGL2 (pages/coral-reef/tests/fake-gl.mjs)');
else {
  const G = globalThis;
  const rafQ = [];
  G.requestAnimationFrame = (f) => { rafQ.push(f); return rafQ.length; };
  G.cancelAnimationFrame = () => {};
  const f = fakeCanvas({ w: 800, h: 600 });
  const listeners = {};
  const canvas = {
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    getContext: (k) => (k === 'webgl2' ? f.gl : null),
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((x) => x !== fn); },
    setPointerCapture() {},
  };
  const fire = (t, e) => (listeners[t] || []).forEach((fn) => fn({ type: t, preventDefault() {}, pointerType: 'mouse', pointerId: 1, ...e }));
  const flush = () => { const q = rafQ.splice(0); q.forEach((fn) => fn()); };
  const v = createSemViewer(canvas, {});
  const pm = MODELS.prorocentrum.m;
  await v.setModel(pm, { method: 'mesh' });
  flush();
  const draws = f.log.filter((x) => x.op === 'draw');
  ok(draws.length >= 1 && draws[draws.length - 1].n === pm.indices.length, `draws ${pm.indices.length / 3} triangles`);
  const u0 = v.umPerPx();
  ok(u0 > 0.02 && u0 < 0.5, `fit: ${u0.toFixed(3)} um per CSS px for a 45 um cell in 600 px`);
  fire('wheel', { deltaY: -400, deltaMode: 0 });
  ok(v.umPerPx() < u0 * 0.7, `wheel zooms in (${v.umPerPx().toFixed(3)} um/px)`);
  fire('dblclick', {});
  ok(Math.abs(v.umPerPx() - u0) < 1e-9, 'double click resets the view');
  const st = MODELS.aphid.m;
  await v.setModel(st, { method: 'stereo' });
  fire('pointerdown', { clientX: 100, clientY: 100 });
  fire('pointermove', { clientX: 2100, clientY: 100 });
  fire('pointerup', {});
  ok(Math.abs(Math.abs(v.state().yaw) - 55 * Math.PI / 180) < 1e-9, `stereo: the turn stops at 55 deg (${(v.state().yaw * 180 / Math.PI).toFixed(1)} deg)`);
  for (let i = 0; i < 30; i++) fire('wheel', { deltaY: 2000, deltaMode: 0 });
  const far = v.umPerPx();
  ok(Number.isFinite(far) && far < u0 * 1e4, 'zoom out has a limit');
  flush();
  ok(f.log.filter((x) => x.op === 'draw').pop().n === st.indices.length, 'draws the stereo height map');
  v.dispose();
  ok((listeners.pointerdown || []).length === 0 && (listeners.wheel || []).length === 0, 'dispose removes the listeners');
  delete G.requestAnimationFrame; delete G.cancelAnimationFrame;
}

// shaders: GLSL ES 3.00 through glslangValidator when it is installed
{
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const src = fs.readFileSync(path.join(HERE, 'viewer.js'), 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-glsl-'));
  let ran = true;
  for (const [name, ext] of [['VS', 'vert'], ['FS', 'frag']]) {
    const code = new RegExp('const ' + name + ' = `([\\s\\S]*?)`;').exec(src)[1];
    const f = path.join(tmp, 'sem.' + ext);
    fs.writeFileSync(f, code);
    const r = spawnSync('glslangValidator', [f], { encoding: 'utf8' });
    if (r.error) { ran = false; break; }
    ok(r.status === 0, `glslangValidator ${ext} shader${r.status ? ': ' + (r.stdout || '').trim().slice(0, 160) : ''}`);
  }
  if (!ran) console.log('  skip: no glslangValidator (the shaders are not checked)');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 5 ──
sect('5. page (jsdom)');
function loadJsdom() {
  const require = createRequire(import.meta.url);
  try {
    const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
    return require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })).JSDOM;
  } catch (e) { return null; }
}
const JSDOM = loadJsdom();
if (!JSDOM || !fakeCanvas) console.log('  skip: no jsdom or no fake WebGL2');
else {
  const HTML = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8');
  let n = 0;
  async function page({ hash = '', w = 1280, h = 800, coarse = false } = {}) {
    const dom = new JSDOM(HTML.replace(/<script type="module"[^>]*><\/script>/, '').replace(/<script src="[^"]*"><\/script>/g, ''), {
      url: 'http://localhost:8963/stella-nova/pages/em-explorer/index.html' + (hash ? '#' + hash : ''), pretendToBeVisual: true,
    });
    const win = dom.window, doc = win.document;
    win.matchMedia = (q) => ({ matches: coarse && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    const fakes = new Map();
    win.HTMLCanvasElement.prototype.getContext = function (kind) {
      if (kind !== 'webgl2') return null;
      if (!fakes.has(this)) fakes.set(this, fakeCanvas({ w, h, canvas: this }));
      return fakes.get(this).gl;
    };
    win.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h });
    win.requestAnimationFrame = (fn) => setTimeout(fn, 5);
    win.cancelAnimationFrame = (id) => clearTimeout(id);
    const fetched = [];
    win.fetch = async (url) => {
      fetched.push(String(url));
      const u = new URL(String(url));
      const p = u.protocol === 'file:' ? fileURLToPath(u) : path.join(PAGE, u.pathname.replace('/stella-nova/pages/em-explorer/', ''));
      if (!fs.existsSync(p)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      const b = fs.readFileSync(p);
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    };
    // the module reads the browser globals of this window
    const G = globalThis, saved = {};
    for (const k of ['requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio']) saved[k] = Object.getOwnPropertyDescriptor(G, k);
    G.requestAnimationFrame = win.requestAnimationFrame; G.cancelAnimationFrame = win.cancelAnimationFrame; G.devicePixelRatio = 2;
    const mod = await import(pathToFileURL(path.join(PAGE, 'ui', 'sem-panel.js')).href + '?n=' + (n++));
    const api = mod.mountSemMode({ doc, win });
    const restore = () => { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(G, k, d); else delete G[k]; } };
    return { win, doc, api, fetched, fakes, restore, $: (id) => doc.getElementById(id) };
  }

  // desktop
  const P = await page();
  ok(!P.doc.documentElement.classList.contains('em-sem') && !P.$('sem'), 'the slice explorer is the default mode (no layer until the switch is used)');
  ok(P.$('semBtn') && P.$('semBtn').parentNode.id === 'topRight' && /Surface scans/.test(P.$('semBtn').textContent), 'the "Surface scans" switch is in #topRight');
  ok(P.$('dockSem') && P.$('dockSem').parentNode.id === 'dock', 'the phone switch is in #dock');
  ok(P.$('semCss') && /sem\/sem\.css$/.test(P.$('semCss').href), 'sem/sem.css is linked');
  ok(P.fetched.length === 0, 'nothing is fetched before the switch is used');
  P.$('semBtn').click();
  for (let i = 0; i < 100 && !(P.api.current() && P.$('semMsg') && !P.$('semMsg').textContent); i++) await sleep(25);
  ok(P.doc.documentElement.classList.contains('em-sem') && !P.$('sem').hidden, 'the switch opens the layer (html.em-sem)');
  ok(P.$('semBtn').getAttribute('aria-pressed') === 'true', 'the switch shows that it is on');
  const items = P.doc.querySelectorAll('#semList button[data-id]');
  ok(items.length === SCANS.length, `the picker lists ${items.length} scans`);
  ok(P.$('semTitle').textContent === SCANS[0].title && P.$('semText').textContent === SCANS[0].caption, 'the caption of the first scan');
  ok(P.$('semCredit').textContent.includes(SCANS[0].licence) && P.$('semCredit').querySelector('a[href="' + SCANS[0].source + '"]'), 'the credit, licence and source link are on screen');
  ok(/µm|mm/.test(P.$('semScale').textContent) && parseFloat(P.$('semScale').querySelector('.bar').style.width) > 10, `a scale bar (${P.$('semScale').textContent})`);
  ok(/#sem=prorocentrum$/.test(P.win.location.href), 'the hash is #sem=prorocentrum');
  ok(/\d+(\.\d+)? µm across/.test(P.$('semMeta').textContent), `the size line (${P.$('semMeta').textContent})`);
  // pick another
  P.doc.querySelector('#semList button[data-id="puffball"]').click();
  for (let i = 0; i < 60 && !/Puffball/.test(P.$('semTitle').textContent); i++) await sleep(20);
  for (let i = 0; i < 60 && P.$('semMsg').textContent; i++) await sleep(20);
  ok(P.$('semTitle').textContent === 'Puffball spores' && P.doc.querySelector('#semList button[data-id="puffball"]').getAttribute('aria-current') === 'true', 'picking a scan shows it');
  ok(P.fetched.some((u) => u.endsWith('/sem/models/puffball.glb')), 'the GLB loads only when it is picked');
  ok(/stereo/i.test(P.$('semMeta').textContent), 'the method line says it is a stereo pair');
  // a missing file
  const keep = P.win.fetch;
  P.win.fetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
  P.doc.querySelector('#semList button[data-id="aphid"]').click();
  for (let i = 0; i < 60 && !/did not load/.test(P.$('semMsg').textContent); i++) await sleep(20);
  ok(/did not load/.test(P.$('semMsg').textContent) && P.$('semMsg').classList.contains('bad'), `a failed load says so (${P.$('semMsg').textContent.slice(0, 50)})`);
  P.win.fetch = keep;
  // Escape closes and puts the hash back
  P.doc.dispatchEvent(new P.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!P.doc.documentElement.classList.contains('em-sem') && P.$('sem').hidden && P.$('semBtn').getAttribute('aria-pressed') === 'false', 'Escape closes the layer');
  ok(!/sem=/.test(P.win.location.href), 'the sem= hash is gone after close');
  // the saver closes the mode
  await P.api.open('halamphora');
  P.doc.documentElement.classList.add('sn-saver');
  await sleep(20);
  ok(!P.api.isOpen(), 'the screensaver closes the mode');
  P.doc.documentElement.classList.remove('sn-saver');
  P.restore();

  // a shared link opens the mode
  const Q = await page({ hash: 'sem=glass-fibre', coarse: true, w: 390, h: 800 });
  await Q.api.ready;
  ok(Q.api.isOpen() && Q.api.current() === 'glass-fibre' && /Glass fibre/.test(Q.$('semTitle').textContent), 'a #sem=glass-fibre link opens that scan');
  Q.$('dock').querySelector('button[data-tab="places"]').click();
  ok(!Q.api.isOpen(), 'a dock tab goes back to the slice explorer');
  Q.restore();
}

// ── 6 ──
sect('6. entry point');
{
  const main = fs.readFileSync(path.join(PAGE, 'main.js'), 'utf8');
  const lines = main.split('\n').filter((l) => l.includes('sem-panel.js'));
  ok(lines.length === 1 && /import\('\.\/ui\/sem-panel\.js'\)/.test(lines[0]) && /\.catch\(/.test(lines[0]), `main.js has one guarded entry line (${lines.length})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
process.exit(0);
