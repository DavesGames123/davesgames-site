// ============================================================================
//  STEREOGRAM MAKER  ·  tests.mjs — node tests of the page (no browser)
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/stereogram-maker/tests.mjs
//  1. engine: runs engine/tests.mjs (ENGINE owns it) and reads its exit code.
//  2. syntax: node --check on every page file.
//  3. link: a node import of main.js stops only on a browser global
//     (a ReferenceError or TypeError on document, window, matchMedia ...),
//     never on a SyntaxError or a missing export.
//  4. markup: the head load order (gpu-guard, wishlist, stats-beacon, then
//     style.css, then lib/sci.css), the viewport and description metas, the
//     [hidden] guard in style.css, unique ids, and every id that main.js
//     reads is in index.html. No uppercase letter-spaced labels and no
//     banned fonts in the stylesheet.
//  5. state: encodeState and decodeState make a round trip; numbers clamp;
//     unknown ids fall back; uploads never go in a link.
//  6. depthkit: the mirror tile wraps with no seam; shapeDepth keeps the
//     wall at 0 and the object in [lift, 1]; the practice depth has two
//     planes; the relief is opaque; turntableSize keeps its budget.
//  7. worker: handle() runs every op in node and returns the documented
//     shapes; a flat depth gives equal colours one repeat apart; a
//     turntable streams n frames; a model renders and a pose change gives
//     a new depth map.
//  8. examples: at least 12, every model, tile and shape id exists, and
//     they show many objects and many pattern families.
//  9. saver: the shot list is fixed by its seed, has no model twice in a
//     row, and the hold is 5 to 12 s.
// 10. boot: when jsdom resolves (NODE_PATH), index.html boots in jsdom
//     with a worker that runs handle() in this process. The first render
//     reaches the canvas, and the gallery cards are built. Else it says
//     that it skipped.
//  Prints one line per failure and a summary; exits 1 on any failure.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL ' + msg); } };
const section = name => console.log('-- ' + name);

// 1. engine
section('engine tests');
const engT = join(HERE, 'engine', 'tests.mjs');
if (existsSync(engT)) {
  const r = spawnSync(process.execPath, [engT], { encoding: 'utf8', timeout: 600000 });
  const tail = (r.stdout || '').trim().split('\n').slice(-2).join(' | ');
  console.log('   engine: ' + tail);
  ok(r.status === 0, 'engine/tests.mjs exit ' + r.status + ' ' + (r.stderr || '').slice(0, 400));
} else ok(false, 'engine/tests.mjs is missing');

// 2. syntax
section('syntax');
const FILES = ['main.js', 'worker.js', 'engine-api.js', 'depthkit.js', 'state.js', 'examples.js', 'saver.js', 'tests.mjs'];
for (const f of FILES) {
  const r = spawnSync(process.execPath, ['--check', join(HERE, f)], { encoding: 'utf8' });
  ok(r.status === 0, 'node --check ' + f + ': ' + (r.stderr || '').split('\n')[0]);
}

// 3. link main.js
section('link main.js');
try { await import(pathToFileURL(join(HERE, 'main.js')).href); ok(false, 'main.js ran in node with no browser error'); }
catch (e) {
  const browser = /document|window|matchMedia|Worker|navigator|location|addEventListener|devicePixelRatio|innerWidth/.test(e.message);
  ok((e instanceof ReferenceError || e instanceof TypeError) && browser, 'main.js import: ' + e.name + ': ' + e.message);
  console.log('   main.js stops at: ' + e.name + ': ' + e.message);
}

// 4. markup
section('markup');
const html = readFileSync(join(HERE, 'index.html'), 'utf8'), css = readFileSync(join(HERE, 'style.css'), 'utf8');
const mainSrc = readFileSync(join(HERE, 'main.js'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const srcs = [...head.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
ok(srcs[0] === '../../lib/gpu-guard.js' && srcs[1] === '../../lib/wishlist.js' && srcs[2] === '../../lib/stats-beacon.js', 'head scripts: ' + srcs.join(', '));
ok(head.indexOf('<script src="../../lib/gpu-guard.js">') < head.indexOf('<meta charset'), 'gpu-guard before the metas');
ok(/name="viewport"[^>]*viewport-fit=cover/.test(head), 'viewport meta');
ok(/<meta name="description" content="[^"]{40,}">/.test(head), 'description meta');
ok(head.indexOf('href="style.css"') > 0 && head.indexOf('href="style.css"') < head.indexOf('href="../../lib/sci.css"'), 'style.css before lib/sci.css');
ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/.test(css), '[hidden]{display:none!important} in style.css');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
ok(!dup.length, 'duplicate ids: ' + dup.join(', '));
const used = new Set([...mainSrc.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
for (const id of used) ok(ids.includes(id), 'main.js reads #' + id + ', which is not in index.html');
for (const [id] of [...mainSrc.matchAll(/'(\w+)', '(?:src|pat|view)\.\w+'/g)].map(m => [m[1]])) ok(ids.includes(id) && ids.includes(id + 'V'), 'slider #' + id + ' and #' + id + 'V');
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/letter-spacing/.test(cssRules) && !/text-transform:\s*uppercase/.test(cssRules), 'no letter-spaced or uppercase labels');
ok(!/Playfair|Cormorant|JetBrains|katex/i.test(css + html), 'no banned fonts and no KaTeX');
ok(html.includes('<script type="module" src="main.js">'), 'main.js is a module script');
for (const m of html.matchAll(/<[^>]+\shidden[\s>][^>]*>/g)) {
  const idm = /id="([^"]+)"/.exec(m[0]);
  if (idm && new RegExp('#' + idm[1] + '\\s*\\{[^}]*display:').test(css)) console.log('   note: #' + idm[1] + ' has the hidden attribute and a display rule; the guard covers it');
}

// 5. state
section('state');
const ST = await import('./state.js');
const known = { models: new Set(['a', 'b']), tiles: new Set(['pd-x', 'pd-y']), shapes: new Set(['torus', 'sphere']), sizes: new Set(['fit', 'hd']) };
{
  const s = ST.cloneState(ST.DEFAULT_STATE);
  Object.assign(s.src, { kind: 'model', id: 'b', yaw: 33.3333, pitch: -12, fit: 0.7, relief: 0.6, lift: 0.2 });
  Object.assign(s.pat, { kind: 'tile', id: 'pd-y', seed: 77 });
  Object.assign(s.view, { mode: 'cross', eyeSep: 6, mu: 0.25, guides: false, smooth: false, size: 'hd', dot: 2 });
  const d = ST.decodeState(ST.encodeState(s), known);
  ok(d && d.src.id === 'b' && Math.abs(d.src.yaw - 33.333) < 1e-6 && d.src.pitch === -12 && d.pat.id === 'pd-y' && d.pat.seed === 77, 'model state round trip');
  ok(d.view.mode === 'cross' && d.view.eyeSep === 6 && d.view.mu === 0.25 && !d.view.guides && !d.view.smooth && d.view.size === 'hd' && d.view.dot === 2, 'view round trip');
  const t = ST.cloneState(ST.DEFAULT_STATE);
  Object.assign(t.src, { kind: 'text', text: 'Hello & bye', face: 'sans' }); Object.assign(t.pat, { kind: 'colour', palette: 3 });
  const dt = ST.decodeState(ST.encodeState(t), known);
  ok(dt.src.kind === 'text' && dt.src.text === 'Hello & bye' && dt.src.face === 'sans' && dt.pat.kind === 'colour' && dt.pat.palette === 3, 'text and colour round trip');
  const u = ST.cloneState(ST.DEFAULT_STATE);
  Object.assign(u.src, { kind: 'photo', ref: 'photo-1' }); Object.assign(u.pat, { kind: 'image', ref: 'image-1' });
  const eu = ST.encodeState(u);
  ok(!/photo|image-1/.test(eu), 'uploads stay out of the link: ' + eu);
  const bad = ST.decodeState('k=model&m=zzz&y=999&p=-999&es=99&mu=-1&t=pd-zzz&z=huge&pl=55&d=9', known);
  ok(bad.src.id === '' && bad.src.yaw === 180 && bad.src.pitch === -80 && bad.view.eyeSep === 7.5 && bad.view.mu === 0.12 && bad.pat.id === '' && bad.view.size === 'fit' && bad.pat.palette === ST.DOT_PALETTE_IDS.length - 1 && bad.view.dot === 4, 'decode clamps and drops unknown ids');
  ok(ST.decodeState('', known) === null && ST.decodeState('#foo=1', known) === null, 'no state in an empty hash');
}

// 6. depthkit
section('depthkit');
const DK = await import('./depthkit.js');
{
  const img = { w: 5, h: 3, data: new Uint8ClampedArray(60) };
  for (let i = 0; i < 60; i++) img.data[i] = (i * 37) % 256;
  const m = DK.mirrorTile(img);
  let seam = 0;
  for (let y = 0; y < m.h; y++) for (let c = 0; c < 3; c++) seam = Math.max(seam, Math.abs(m.data[(y * m.w) * 4 + c] - m.data[(y * m.w + m.w - 1) * 4 + c]));
  for (let x = 0; x < m.w; x++) for (let c = 0; c < 3; c++) seam = Math.max(seam, Math.abs(m.data[x * 4 + c] - m.data[((m.h - 1) * m.w + x) * 4 + c]));
  ok(m.w === 10 && m.h === 6 && seam === 0, 'mirror tile wraps with no seam (' + seam + ')');
  const sq = DK.cropSquare({ w: 40, h: 20, data: new Uint8ClampedArray(40 * 20 * 4).fill(200) }, 16);
  ok(sq.w === 16 && sq.h === 16 && sq.data[0] === 200 && sq.data[3] === 255, 'cropSquare size and colour');
  const dm = { w: 4, h: 1, data: Float32Array.from([0, 0.5, 1, 0.3]), mask: Uint8Array.from([0, 1, 1, 1]) };
  const sh = DK.shapeDepth(dm, 0.5, 0.2);
  ok(sh.data[0] === 0 && Math.abs(sh.data[1] - (0.2 + 0.8 * 0.5 * 0.5)) < 1e-6 && Math.abs(sh.data[2] - 0.6) < 1e-6, 'shapeDepth: wall 0, object lift + (1 - lift) relief d');
  const pd = DK.practiceDepth(160, 120), lv = new Set();
  for (let i = 0; i < pd.data.length; i++) if (pd.mask[i]) lv.add(pd.data[i]);
  ok(lv.size === 2 && lv.has(0.5) && lv.has(1), 'practice depth: two planes');
  const rel = DK.reliefImage(pd);
  let opaque = true; for (let i = 3; i < rel.data.length; i += 4) if (rel.data[i] !== 255) { opaque = false; break; }
  ok(rel.w === 160 && rel.data.length === 160 * 120 * 4 && opaque, 'relief is opaque RGBA');
  const tt = DK.turntableSize(1600, 900, 36, 7e6);
  ok(tt.w * tt.h * 36 <= 7e6 * 1.02 && Math.abs(tt.w / tt.h - 16 / 9) < 0.02, 'turntableSize budget and aspect ' + tt.w + 'x' + tt.h);
  const fb = DK.fitBox(1000, 500, 1);
  ok(fb.w === 500 && fb.h === 500, 'fitBox');
  ok(DK.SIZES[0].id === 'fit' && DK.SIZES.every(s => s.id === 'fit' || (s.w > 0 && s.h > 0 && s.dpi > 0)), 'SIZES');
}

// 7. worker
section('worker');
const W = await import('./worker.js');
W.setReadBytes(async u => { const b = readFileSync(fileURLToPath(u)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
const E = await import('./engine-api.js');
const call = (op, args) => new Promise(res => {
  const msgs = [];
  W.handle({ id: 1, op, args }, (m, tr) => { msgs.push({ m, tr }); if (!m.progress) res(msgs); });
});
const last = msgs => msgs[msgs.length - 1];
{
  const base = ST.cloneState(ST.DEFAULT_STATE);
  // A flat plate: every linked pair one repeat apart has one colour.
  Object.assign(base.src, { kind: 'shape', shape: 'steps', relief: 1, lift: 0 });
  Object.assign(base.pat, { kind: 'dots', seed: 5 });
  base.view.guides = false; base.view.smooth = false;
  let r = last(await call('render', { state: base, w: 300, h: 200, dpi: 72 }));
  ok(r.m.ok, 'render shape: ' + r.m.error);
  if (r.m.ok) {
    const st = r.m.result.stereo, rl = r.m.result.relief;
    ok(st.w === 300 && st.h === 200 && st.data.length === 300 * 200 * 4 && st.sepFar > st.sepNear && st.sepNear > 0, 'StereoImage shape');
    ok(rl && rl.w === 300 && rl.data.length === 300 * 200 * 4, 'relief shape');
    ok(r.tr.length === 2 && r.tr.every(b => b instanceof ArrayBuffer), 'two transfer buffers');
    // Row 0 is wall (depth 0): pixel x and x + sepFar match.
    let mism = 0; const s = st.sepFar;
    for (let x = 0; x + s < 300; x++) if (st.data[4 * x] !== st.data[4 * (x + s)]) mism++;
    ok(mism === 0, 'wall row: colours repeat every sepFar px (' + mism + ' differ)');
  }
  // Tile source.
  const tileId = E.TILES.find(t => t.family !== 'dots');
  Object.assign(base.pat, { kind: 'tile', id: tileId && tileId.id, seed: 2 });
  r = last(await call('render', { state: base, w: 240, h: 160, dpi: 96 }));
  ok(r.m.ok && r.m.result.stereo.w === 240, 'render with a pattern tile: ' + r.m.error);
  // Coloured dots with a palette.
  Object.assign(base.pat, { kind: 'colour', palette: 0 });
  r = last(await call('render', { state: base, w: 200, h: 120, dpi: 72, colors: ['#112233', '#ff0000', '#00ff00'] }));
  if (r.m.ok) {
    const cols = new Set(); const d = r.m.result.stereo.data;
    for (let i = 0; i < d.length; i += 4) cols.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    ok(cols.size <= 3, 'coloured dots use only the palette (' + cols.size + ' colours)');
  } else ok(false, 'render colour: ' + r.m.error);
  // Text.
  r = last(await call('render', { state: Object.assign(ST.cloneState(ST.DEFAULT_STATE), { src: Object.assign(ST.cloneState(ST.DEFAULT_STATE).src, { kind: 'text', text: 'Hi' }) }), w: 200, h: 100, dpi: 72 }));
  ok(r.m.ok, 'render text: ' + r.m.error);
  // Practice.
  r = last(await call('practice', { w: 320, h: 240, dpi: 96, mode: 'wall' }));
  ok(r.m.ok && r.m.result.stereo.w === 320 && r.m.result.relief.h === 240, 'practice: ' + r.m.error);
  // Tiles.
  r = last(await call('tiles', { ids: E.TILES.slice(0, 3).map(t => t.id), size: 32, seed: 1 }));
  ok(r.m.ok && r.m.result.length === 3 && r.m.result[0].w === 32 && r.tr.length === 3, 'tiles: ' + r.m.error);
  // Uploads: a depth map and an image tile.
  const up = { w: 64, h: 48, data: new Uint8ClampedArray(64 * 48 * 4) };
  for (let i = 0; i < 64 * 48; i++) { const v = (i % 64) * 4; up.data[4 * i] = up.data[4 * i + 1] = up.data[4 * i + 2] = v; up.data[4 * i + 3] = 255; }
  r = last(await call('upload', { ref: 'depth-1', img: up }));
  ok(r.m.ok, 'upload depth: ' + r.m.error);
  const ud = ST.cloneState(ST.DEFAULT_STATE); Object.assign(ud.src, { kind: 'depth', ref: 'depth-1' }); Object.assign(ud.pat, { kind: 'dots' });
  r = last(await call('render', { state: ud, w: 128, h: 96, dpi: 72 }));
  ok(r.m.ok, 'render an uploaded depth map: ' + r.m.error);
  ud.src.kind = 'photo';
  r = last(await call('render', { state: ud, w: 128, h: 96, dpi: 72 }));
  ok(r.m.ok, 'render an uploaded photo: ' + r.m.error);
  r = last(await call('upload', { ref: 'image-1', img: { w: 40, h: 30, data: new Uint8ClampedArray(40 * 30 * 4).fill(128) }, tile: true }));
  ok(r.m.ok && r.m.result.w === 60 && r.m.result.h === 60, 'upload image tile: mirrored square ' + JSON.stringify(r.m.result));
  Object.assign(ud.pat, { kind: 'image', ref: 'image-1' });
  r = last(await call('render', { state: ud, w: 128, h: 96, dpi: 72 }));
  ok(r.m.ok, 'render on an uploaded tile: ' + r.m.error);
  r = last(await call('render', { state: Object.assign(ST.cloneState(ud), { src: Object.assign(ST.cloneState(ud.src), { ref: 'none' }) }), w: 64, h: 64, dpi: 72 }));
  ok(!r.m.ok && /no uploaded/.test(r.m.error), 'a missing upload gives an error, not a crash');
  r = last(await call('nope', {}));
  ok(!r.m.ok, 'unknown op gives an error');
  // Models.
  if (E.MODELS.length) {
    const m0 = E.MODELS[0], ms = ST.cloneState(ST.DEFAULT_STATE);
    Object.assign(ms.src, { kind: 'model', id: m0.id, yaw: 0, pitch: 0 });
    let t0 = Date.now();
    r = last(await call('render', { state: ms, w: 400, h: 300, dpi: 96 }));
    ok(r.m.ok, 'render model ' + m0.id + ': ' + r.m.error);
    console.log('   model ' + m0.id + ' first render ' + (Date.now() - t0) + ' ms');
    let p0 = last(await call('preview', { src: ms.src, w: 120, h: 90 }));
    ms.src.yaw = 90;
    let p1 = last(await call('preview', { src: ms.src, w: 120, h: 90 }));
    ok(p0.m.ok && p1.m.ok, 'preview: ' + (p0.m.error || p1.m.error));
    if (p0.m.ok && p1.m.ok) {
      let diff = 0; const a = p0.m.result.relief.data, b = p1.m.result.relief.data;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      ok(diff > a.length * 0.02, 'a turn of 90 degrees changes the depth view (' + diff + ' bytes)');
    }
    r = last(await call('modelThumb', { id: m0.id, size: 96 }));
    ok(r.m.ok && r.m.result.relief.w === 96, 'modelThumb: ' + r.m.error);
    const msgs = await call('turntable', { state: ms, w: 160, h: 120, dpi: 72, n: 6 });
    const prog = msgs.filter(x => x.m.progress);
    ok(prog.length === 6 && prog.every(x => x.m.progress.frame.w === 160 && x.tr.length === 1) && last(msgs).m.ok, 'turntable streams 6 frames');
    t0 = Date.now(); let bad = [];
    for (const m of E.MODELS) {
      const s = ST.cloneState(ms); s.src.id = m.id;
      const v = m.view || {}; s.src.yaw = v.yaw || 0; s.src.pitch = v.pitch || 0;
      const rr = last(await call('preview', { src: s.src, w: 96, h: 96 }));
      if (!rr.m.ok) bad.push(m.id + ': ' + rr.m.error);
    }
    ok(!bad.length, 'every model loads and renders: ' + bad.join('; '));
    console.log('   ' + E.MODELS.length + ' models load and render in ' + (Date.now() - t0) + ' ms');
  } else ok(false, 'MODELS is empty');
}

// 8. examples
section('examples');
const EX = await import('./examples.js');
{
  const mids = new Set(E.MODELS.map(m => m.id)), tids = new Set(E.TILES.map(t => t.id)), sids = new Set(E.SDF_SHAPES);
  ok(EX.EXAMPLES.length >= 12, 'at least 12 examples (' + EX.EXAMPLES.length + ')');
  for (const ex of EX.EXAMPLES) {
    if (ex.src.kind === 'model') ok(mids.has(ex.src.id), 'example ' + ex.title + ': model ' + ex.src.id);
    if (ex.src.kind === 'shape') ok(sids.has(ex.src.shape), 'example ' + ex.title + ': shape ' + ex.src.shape);
    if (ex.pat.kind === 'tile') ok(tids.has(ex.pat.id), 'example ' + ex.title + ': tile ' + ex.pat.id);
    ok(typeof ex.title === 'string' && ex.title.length > 1 && typeof ex.note === 'string', 'example title and note');
  }
  const objs = new Set(EX.EXAMPLES.filter(e => e.src.kind === 'model').map(e => e.src.id));
  const fams = new Set(EX.EXAMPLES.filter(e => e.pat.kind === 'tile').map(e => (E.TILES.find(t => t.id === e.pat.id) || {}).family));
  ok(objs.size >= 8, 'examples show 8 or more real objects (' + objs.size + ')');
  ok(fams.size >= 6, 'examples use 6 or more pattern families (' + fams.size + ')');
  ok(EX.EXAMPLES[0].src.kind === 'model', 'the first example (shown at load) is a real object');
  for (const s of E.SDF_SHAPES) ok(EX.SHAPE_NAMES[s], 'shape name for ' + s);
}

// 9. saver
section('saver');
{
  const SV = await import('./saver.js');
  const a = SV.shotList(7, 30), b = SV.shotList(7, 30), c = SV.shotList(8, 30);
  ok(JSON.stringify(a) === JSON.stringify(b), 'shot list fixed by seed');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'another seed, another list');
  ok(a.every((s, i) => i === 0 || s.model !== a[i - 1].model), 'no model twice in a row');
  ok(new Set(a.map(s => s.model)).size >= Math.min(12, E.MODELS.length), 'shots reach many models');
  ok([1, 10, 60, 600].every(x => SV.holdSeconds(x) >= 5 && SV.holdSeconds(x) <= 12), 'hold 5..12 s');
}

// 10. boot in jsdom
section('jsdom boot');
{
  let JSDOM = null;
  try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) console.log('   skipped: jsdom does not resolve (set NODE_PATH to a jsdom@24.1.3 install)');
  else {
    const res = await bootInJsdom(JSDOM);
    ok(res.ok, 'jsdom boot: ' + res.msg);
    console.log('   ' + res.msg);
  }
}

async function bootInJsdom(JSDOM) {
  const dom = new JSDOM(html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, ''), { url: 'https://davesgames.io/stella-nova/pages/stereogram-maker/index.html', pretendToBeVisual: true });
  const w = dom.window, errors = [];
  w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  w.HTMLDialogElement && (w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); });
  const puts = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    const c = this;
    return { putImageData: (img) => puts.push([c.id, img.width]), drawImage() {}, fillRect() {}, getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(ww * hh * 4) }) };
  };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
  class ImageDataN { constructor(d, ww, hh) { this.data = d; this.width = ww; this.height = hh; } }
  // A worker that runs handle() here, after a tick, like a real one.
  class FakeWorker {
    constructor() { this.onmessage = null; }
    postMessage(msg) { setTimeout(() => W.handle(msg, m => setTimeout(() => this.onmessage && this.onmessage({ data: m }), 0)), 0); }
    terminate() {}
  }
  const G = {
    window: w, document: w.document, navigator: w.navigator, location: w.location, matchMedia: w.matchMedia,
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800, Worker: FakeWorker, ImageData: ImageDataN,
    IntersectionObserver: undefined, CSS: { escape: s => String(s).replace(/"/g, '\\"') },
    requestAnimationFrame: f => setTimeout(f, 16), cancelAnimationFrame: id => clearTimeout(id),
    addEventListener: w.addEventListener.bind(w), removeEventListener: w.removeEventListener.bind(w),
    HTMLElement: w.HTMLElement, getComputedStyle: w.getComputedStyle,
  };
  const saved = {};
  for (const k of Object.keys(G)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); try { Object.defineProperty(globalThis, k, { value: G[k], configurable: true, writable: true }); } catch (e) { errors.push('global ' + k); } }
  w.Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 1280, bottom: 800, width: this.id === 'panel' ? 340 : 1280, height: this.classList && this.classList.contains('topbar') ? 52 : 800, x: 0, y: 0 }; };
  w.Element.prototype.scrollIntoView = function () {};
  process.on('unhandledRejection', e => errors.push('unhandled: ' + (e && e.message)));
  try {
    await import(pathToFileURL(join(HERE, 'main.js')).href + '?boot');
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !puts.some(p => p[0] === 'out')) await new Promise(r => setTimeout(r, 50));
    const outOk = puts.some(p => p[0] === 'out');
    const doc = w.document;
    const waitFor = async (fn, ms = 30000) => { const t1 = Date.now(); while (Date.now() - t1 < ms && !fn()) await new Promise(r => setTimeout(r, 30)); return fn(); };
    const outs = () => puts.filter(p => p[0] === 'out').length;
    // An example click renders again.
    let n0 = outs();
    doc.querySelectorAll('#exGrid .excard')[3].click();
    if (!await waitFor(() => outs() > n0)) errors.push('an example click did not render');
    if (!doc.querySelectorAll('#exGrid .excard')[3].classList.contains('on')) errors.push('the example card is not marked');
    // The pattern tab draws the tile thumbnails; a tile click renders.
    doc.querySelector('#tabs [data-tab="pattern"]').click();
    if (!await waitFor(() => puts.filter(p => p[0] === '').length >= E.TILES.length * 4)) errors.push('tile thumbnails did not draw');
    n0 = outs(); doc.querySelectorAll('.tcard')[5].click();
    if (!await waitFor(() => outs() > n0)) errors.push('a tile click did not render');
    // The help dialog renders the practice image.
    doc.getElementById('seeBtn').click();
    if (!await waitFor(() => puts.some(p => p[0] === 'practice'))) errors.push('no practice image');
    // The turntable plays frames on #out.
    doc.getElementById('turnFrames').value = 12; doc.getElementById('turnFrames').dispatchEvent(new w.Event('input'));
    n0 = outs(); doc.getElementById('turnBtn').click();
    if (!await waitFor(() => outs() > n0 + 14)) errors.push('the turntable did not play (' + (outs() - n0) + ' frames)');
    doc.getElementById('turnBtn').click();
    if (doc.getElementById('turnBtn').getAttribute('aria-pressed') !== 'false') errors.push('the turntable did not stop');
    // A text source renders and the caption names it.
    doc.querySelector('#srcKind [data-k="text"]').click();
    n0 = outs(); await waitFor(() => outs() > n0);
    if (!/Look closer/.test(doc.getElementById('capMain').textContent)) errors.push('text caption: ' + doc.getElementById('capMain').textContent);
    const n = sel => doc.querySelectorAll(sel).length;
    const msg = `out canvas ${outOk ? 'painted' : 'not painted'}, then example, tile, help, turntable and text steps in ${Date.now() - t0} ms; ${n('.excard')} examples, ${n('.mcard')} model cards, ${n('.tcard')} tile cards, ${n('#dotPals .pal')} palettes, ${n('#shapeGrid button')} shapes, ${n('#sizes button')} sizes; snSaver ${typeof w.snSaver === 'object' || typeof globalThis.window.snSaver === 'object' ? 'set' : 'missing'}; caption "${doc.getElementById('capMain').textContent} ${doc.getElementById('capSub').textContent}"` + (errors.length ? '; errors: ' + errors.join('; ') : '');
    return { ok: outOk && !errors.length && n('.excard') === EX.EXAMPLES.length && n('.mcard') === E.MODELS.length && n('.tcard') === E.TILES.length && !!w.snSaver, msg };
  } catch (e) {
    return { ok: false, msg: 'threw ' + e.name + ': ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n') };
  } finally {
    for (const k of Object.keys(saved)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
