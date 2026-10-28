// ============================================================================
//  STEREOGRAM HISTORY  ·  tests.mjs — node tests, no browser
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/stereogram-history/tests.mjs
//  Optional jsdom group: NODE_PATH=<dir with jsdom@24.1.3>/node_modules.
//
//  Groups ("section(" opens each one):
//    geometry ....... each closed form of geometry.js
//    rows ........... the look-back and symmetric rules give equal colours
//                     on every link, and match the engine rowLinks
//    data ........... every source id resolves, unsure items say why,
//                     years in order, every cite of index.html exists
//    engine jobs .... jobs.js on the real engine and real models: sizes,
//                     the background repeat, the Julesz pair, the turntable
//    shots .......... the saver plan and framing at 16:9 and 9:16
//    page ........... main.js links in node, ids, head order, [hidden],
//                     banned fonts, no uppercase letter-spaced labels
//    jsdom boot ..... the page text fills in a DOM (when jsdom is found);
//                     the saver keeps the images of shots i - 1 .. i + 1
// ============================================================================
import * as G from './geometry.js';
import * as Dt from './data.js';
import * as Sh from './shots.js';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const rd = f => readFileSync(HERE + f, 'utf8');

let pass = 0, fail = 0, cur = '';
function section(s) { cur = s; console.log('\n# ' + s); }
function ok(c, msg) { if (c) pass++; else { fail++; console.log(`  FAIL [${cur}] ${msg}`); } }
const near = (a, b, e) => Math.abs(a - b) <= e;

// A recording 2D context: every numeric argument must be finite, radii
// must not be negative (a browser throws IndexSizeError on those).
function mockCtx(log) {
  const state = {};
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      return (...args) => {
        for (const v of args) if (typeof v === 'number' && !Number.isFinite(v)) log.bad.push(`${String(k)}(${args.join(',')})`);
        if ((k === 'arc' && args[2] < 0) || (k === 'ellipse' && (args[2] < 0 || args[3] < 0))) log.bad.push(`${String(k)} negative radius`);
        log.calls[k] = (log.calls[k] || 0) + 1;
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

section('geometry');
{
  const I = 6.35;
  ok(near(G.vergence(I, 0, 40), 2 * Math.atan(I / 2 / 40), 1e-12), 'vergence on the midline = 2 atan(I / 2d)');
  ok(near(G.vergence(I, 7, 30), G.vergence(I, -7, 30), 1e-12), 'vergence is symmetric in x');
  const F = { x: 3, z: 40 }, vm = G.viethMuller(I, F);
  ok(near(Math.hypot(I / 2, vm.cz), vm.r, 1e-9) && near(Math.hypot(F.x, F.z - vm.cz), vm.r, 1e-9), 'Vieth-Mueller circle passes through both eyes and F');
  let maxd = 0;
  for (const a of [-0.9, -0.5, 0.2, 0.7, 1.1]) { const P = { x: vm.r * Math.sin(a), z: vm.cz + vm.r * Math.cos(a) }; if (P.z > 1) maxd = Math.max(maxd, Math.abs(G.disparity(I, P, F))); }
  ok(maxd < 1e-9, `zero disparity on the circle (max ${maxd.toExponential(2)} rad)`);
  ok(G.disparity(I, { x: 0, z: 30 }, { x: 0, z: 40 }) > 0 && G.disparity(I, { x: 0, z: 50 }, { x: 0, z: 40 }) < 0, 'nearer is crossed (+), farther is uncrossed (-)');
  const ex = G.disparity(I, { x: 0, z: 39 }, { x: 0, z: 40 }), ap = G.disparityApprox(I, 39, 40);
  ok(Math.abs(ex - ap) / ex < 0.01, `small-angle form within 1 % (exact ${(ex * G.ARCMIN).toFixed(3)}, approx ${(ap * G.ARCMIN).toFixed(3)} arcmin)`);
  ok(near(G.fusedDistance(0, 6.35, 50), 50, 1e-12), 'marks at zero spacing fuse on the plane');
  ok(near(G.fusedDistance(6.35 / 2, 6.35, 50, 'wall'), 100, 1e-9), 'wall-eyed at s = e/2 fuses at 2D (the TIW far plane)');
  ok(near(G.fusedDistance(2, 6, 50, 'cross'), 37.5, 1e-9), 'cross-eyed Z = eD / (e + s)');
  ok(G.fusedDistance(7, 6, 50, 'wall') === Infinity, 'wall-eyed spacing wider than the eyes cannot fuse');
  ok(G.separation(0, 1 / 3, 180) === 90 && G.separation(1, 1 / 3, 180) === 72, 'TIW separation: far E/2 = 90, near 0.4 E = 72 at E = 180');
  const gd = G.gratingDepth(64, 120, 3, 0.8);
  let lo = 9, hi = -9; for (const v of gd.data) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok(near(lo, 0.1, 0.01) && near(hi, 0.9, 0.01), `grating depth spans base +- amp/2 (${lo.toFixed(3)}..${hi.toFixed(3)})`);
  ok(near(gd.data[0], gd.data[40 * 64], 1e-6), 'grating repeats every h / cycles rows');
  ok(near(G.cyclesPerDegree(10, 2 * 40 * Math.tan(Math.PI / 360), 40), 10, 1e-9), 'cycles per degree: 10 cycles over one degree');
  const a = G.shuffle([1, 2, 3, 4, 5, 6], 9), b = G.shuffle([1, 2, 3, 4, 5, 6], 9);
  ok(a.join() === b.join() && [...a].sort().join() === '1,2,3,4,5,6', 'seeded shuffle is repeatable and a permutation');
}

section('rows');
let E = null;
try { E = await import('../stereogram-maker/engine/index.js'); } catch (e) { console.log('  engine import failed: ' + e.message); }
{
  const n = 360, z = Float32Array.from({ length: n }, (_, x) => x > 120 && x < 240 ? 0.8 : x > 60 && x < 300 ? 0.3 : 0);
  const Epx = 112, mu = 1 / 3;
  const lb = G.lookBackRow(z, Epx, mu);
  let bad = 0; for (let x = 0; x < n; x++) if (lb[x] !== x && x - lb[x] !== G.separation(z[x], mu, Epx)) bad++;
  ok(bad === 0, 'look-back: each link spans the separation of its depth');
  ok(lb.slice(0, G.separation(0, mu, Epx)).every((v, i) => v === i), 'look-back: the first repeat is the free seed strip');
  for (const [name, same, sym] of [['look-back', lb, false], ['symmetric', G.symmetricRow(z, Epx, mu), true]]) {
    const r = G.rng(3), col = G.rowColours(same, () => r(), sym);
    let mism = 0; for (let x = 0; x < n; x++) if (col[x] !== col[same[x]]) mism++;
    ok(mism === 0, `${name}: every linked pair gets one colour`);
  }
  const sym = G.symmetricRow(z, Epx, mu);
  let chained = 0; for (let x = 0; x < n; x++) if (sym[x] !== x && sym[x] <= x) chained++;
  ok(chained === 0, 'symmetric: links point to the right');
  if (E && E.rowLinks) {
    const eng = E.rowLinks(z, 0, { eyeSep: Epx / 72, dpi: 72, mu, hsr: false });
    // Compare the partitions: same colour class in both.
    const r1 = G.rng(5), r2 = G.rng(5), c1 = G.rowColours(sym, () => r1(), true), c2 = G.rowColours(eng, () => r2(), true);
    let diff = 0; for (let x = 0; x < n; x++) for (const d of [Math.round(G.separation(z[x], mu, Epx))]) if (x + d < n && (c1[x] === c1[x + d]) !== (c2[x] === c2[x + d])) diff++;
    ok(diff === 0, `symmetric rule agrees with engine rowLinks (hsr off): ${diff} differences`);
  } else ok(false, 'engine rowLinks is exported');
}

section('data');
{
  const ids = new Set(Object.keys(Dt.SOURCES));
  for (const [k, s] of Object.entries(Dt.SOURCES)) ok(typeof s.cite === 'string' && s.cite.length > 20, `source ${k} has a citation`);
  ok(Object.values(Dt.SOURCES).filter(s => s.doi || s.url).length >= 15, 'at least 15 sources have a DOI or a URL');
  for (const s of Object.values(Dt.SOURCES)) if (s.doi) ok(/^10\.\d{4,9}\/\S+$/.test(s.doi), `DOI shape ${s.doi}`);
  let prev = 0;
  for (const t of Dt.TIMELINE) {
    t.srcs.forEach(id => ok(ids.has(id), `timeline ${t.y} source ${id}`));
    ok(!('unsure' in t) || (typeof t.unsure === 'string' && t.unsure.length > 10), `timeline ${t.y} unsure note says why`);
    const y = +t.y.slice(0, 4); ok(y >= prev, `timeline in order at ${t.y}`); prev = y;
  }
  ok(Dt.TIMELINE.length >= 18, `timeline has ${Dt.TIMELINE.length} events`);
  ok(Dt.TIMELINE.filter(t => t.unsure).length >= 4, 'unsure dates are marked');
  for (const w of Dt.TYLER_WORKS) { ok(ids.has(w.src), `work ${w.src}`); (w.also || []).forEach(a => ok(ids.has(a), `work also ${a}`)); }
  for (const q of Object.values(Dt.QUOTES)) ok(ids.has(q.src) && q.text.length > 30, `quote from ${q.src}`);
  const html = rd('index.html');
  const cited = [...html.matchAll(/data-cite="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/));
  ok(cited.length >= 10, `index.html has ${cited.length} cites`);
  cited.forEach(id => ok(ids.has(id), `index.html cite ${id}`));
  const mainSrc = rd('main.js');
  [...mainSrc.matchAll(/cite\(\[([^\]]+)\]/g)].flatMap(m => m[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''))).filter(x => /^[a-zA-Z0-9]+$/.test(x)).forEach(id => ok(ids.has(id), `main.js cite ${id}`));
  ok(!/magic eye/i.test(html.replace(/Magic Eye is a trademark of its owner/g, '')), 'index.html names Magic Eye only in the trademark line');
}

section('engine jobs');
const J = await import('./jobs.js');
{
  const MODELS_DIR = new URL('../stereogram-maker/models/', import.meta.url);
  J.setModelReader(async u => { const b = readFileSync(fileURLToPath(u)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const cat = await J.handle('catalog');
  ok(cat.models.length >= 24, `catalog: ${cat.models.length} real models`);
  ok(cat.tiles.length >= 40, `catalog: ${cat.tiles.length} pattern tiles`);
  ok(new Set(cat.models.map(m => m.kind)).size >= 6, `catalog: ${new Set(cat.models.map(m => m.kind)).size} kinds`);
  void MODELS_DIR;
  const m = cat.models[0];
  const t0 = Date.now();
  const st = await J.handle('stereo', { spec: { model: m.id, w: 320, h: 200 }, tile: 'dots', opts: { dpi: 72, guides: false }, withDepth: true });
  ok(!st.fallback, `stereo of ${m.id} used the real model (${Date.now() - t0} ms)`);
  ok(st.img.w === 320 && st.img.h === 200 && st.img.data.length === 320 * 200 * 4, 'stereo image size');
  const cover = st.depth.mask.reduce((a, b) => a + b, 0) / (320 * 200);
  ok(cover > 0.05 && cover < 0.95, `the model covers ${(cover * 100).toFixed(0)} % of the frame`);
  // A background-only row repeats with the far separation.
  const sep = Math.round(st.img.sepFar);
  let row = -1; for (let y = 0; y < 200 && row < 0; y++) { let empty = true; for (let x = 0; x < 320; x++) if (st.depth.mask[y * 320 + x]) { empty = false; break; } if (empty) row = y; }
  let rep = 0, tot = 0;
  if (row >= 0) for (let x = sep; x < 320; x++) { tot++; const i = 4 * (row * 320 + x), j = 4 * (row * 320 + x - sep); if (st.img.data[i] === st.img.data[j]) rep++; }
  ok(row >= 0 && rep === tot, `an empty row repeats every ${sep} px (${rep}/${tot})`);
  const rds = await J.handle('rds', { spec: { model: m.id, w: 200, h: 170 }, opts: { disparity: 7 }, withDepth: true });
  let same = 0, outside = 0;
  for (let i = 0; i < 200 * 170; i++) if (!rds.depth.mask[i]) { outside++; if (rds.left.data[4 * i] === rds.right.data[4 * i]) same++; }
  ok(same / outside > 0.97, `Julesz pair: outside the object the two images agree (${(100 * same / outside).toFixed(1)} %)`);
  let blackL = 0; for (let i = 0; i < 200 * 170; i++) if (rds.left.data[4 * i] < 128) blackL++;
  ok(near(blackL / (200 * 170), 0.5, 0.05), `one image alone is half black dots (${(100 * blackL / 34000).toFixed(1)} %)`);
  ok(rds.ana.w === 200 && rds.ana.h === 170, 'anaglyph size');
  const pr = await J.handle('pair', { spec: { model: cat.models[1].id, w: 200, h: 170 }, tile: cat.tiles[0].id, opts: { disparity: 9, texSize: 48 } });
  let dif = 0; for (let i = 0; i < pr.left.data.length; i += 4) if (pr.left.data[i] !== pr.right.data[i]) dif++;
  ok(dif > 100, `Wheatstone pair: the two views differ (${dif} px)`);
  const tn = await J.handle('turn', { spec: { model: cat.models[2].id, w: 160, h: 100 }, n: 4, tile: 'color', opts: { dpi: 48, guides: false } });
  ok(tn.frames.length === 4 && tn.frames.every(f => f.w === 160 && f.h === 100), 'turntable: four frames');
  let stable = 0; for (let x = 0; x < 160 * 4; x++) if (tn.frames[0].data[x] === tn.frames[2].data[x]) stable++;
  ok(stable / 640 > 0.9, `turntable: the top row stays still between frames (${(100 * stable / 640).toFixed(0)} %)`);
  const gr = await J.handle('stereo', { spec: { grating: { cycles: 4, amp: 0.8 }, w: 240, h: 120 }, tile: cat.tiles[3].id, opts: { dpi: 64 } });
  ok(gr.img.w === 240 && !gr.fallback, 'grating stereogram with a pattern tile');
  const tl = await J.handle('tile', { id: cat.tiles[5].id, size: 64 });
  ok(tl && tl.w === 64 && tl.data.length === tl.w * tl.h * 4, 'tile op returns a copy of the tile');
  const tl2 = await J.handle('tile', { id: cat.tiles[5].id, size: 64 });
  ok(tl2.data !== tl.data, 'tile copies are not the cache');
  J.setModelReader(async () => { throw new Error('no file'); });
  const fb = await J.handle('depth', { spec: { model: 'no-such-model', w: 64, h: 40 } });
  ok(fb.fallback === true && fb.w === 64, 'a model that does not load falls back to a shape');
  J.setModelReader(async u => { const b = readFileSync(fileURLToPath(u)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const tr = J.transfers({ a: new Uint8Array(4), b: [new Float32Array(2), { c: new Uint8Array(1) }] });
  ok(tr.size === 3, 'transfers finds every buffer');
}

section('draw');
{
  const D = await import('./draw.js');
  for (const [w, h] of [[800, 600], [320, 240], [1600, 900], [360, 640]]) {
    const log = { bad: [], calls: {} }, g = mockCtx(log);
    const st = { I: 6.35, F: { x: 0, z: 40 }, P: { x: 5, z: 28 }, view: { x0: -24, x1: 24, z1: 60 } };
    const m = D.drawGeo(g, w, h, st);
    const back = m.inv(m.X(st.P.x), m.Z(st.P.z));
    ok(near(back.x, st.P.x, 1e-9) && near(back.z, st.P.z, 1e-9), `drawGeo ${w}x${h}: the drag map inverts the draw map`);
    D.drawScope(g, w, h, 1.3);
    const z = Float32Array.from({ length: 360 }, (_, x) => 0.5 + 0.5 * Math.sin(x / 30));
    const same = G.lookBackRow(z, 112, 1 / 3), r = G.rng(1);
    D.drawRow(g, w, h, { z, same, colours: G.rowColours(same, () => r() < 0.5 ? '#111' : '#eee', false), rule: 'look', sepFar: 56, sepNear: 45, upTo: 100 });
    D.drawRow(g, w, h, { z, same: G.symmetricRow(z, 112, 1 / 3), colours: new Array(360).fill('#fff'), rule: 'sym', sepFar: 56, sepNear: 45 });
    const wall = D.drawWall(g, w, h, { width: 96, height: 96 }, 84, 6);
    ok(wall.b - wall.a === 3 * 84, `drawWall ${w}x${h}: the shifted strip is three repeats wide`);
    ok(log.bad.length === 0, `draw ${w}x${h}: no bad canvas call ${log.bad.slice(0, 3).join(' ')}`);
    ok((log.calls.fillText || 0) > 8 && (log.calls.stroke || 0) > 20, `draw ${w}x${h}: text and lines drawn`);
  }
  const di = D.depthImage({ w: 2, h: 1, data: Float32Array.from([0, 1]), mask: Uint8Array.from([0, 1]) });
  ok(di.data[0] === 18 && di.data[4] === 255, 'depthImage: background dark, near white');
}

section('shots');
{
  const p = Sh.shotPlan(7, 48, 0.7), q = Sh.shotPlan(7, 48, 0.7);
  ok(JSON.stringify(p) === JSON.stringify(q), 'plan is seeded');
  ok(p.every((s, i) => i === 0 || s.id !== p[i - 1].id), 'no shot twice in a row');
  ok(p.every(s => s.sec >= 5 && s.sec <= 12), 'every shot lasts 5 to 12 s');
  ok(new Set(p.map(s => s.id)).size === new Set(Sh.SHOT_IDS).size, 'every shot kind is in the plan');
  const sav = rd('saver.js');
  for (const id of new Set(Sh.SHOT_IDS)) { ok(!!Sh.SHOTS[id] && Sh.SHOTS[id].title.length > 5, `plate for ${id}`); ok(new RegExp(`\\n  ${id}\\(g, box`).test(sav), `painter for ${id}`); }
  ok(!/\b(function|const|=>)\b/.test(JSON.stringify(Sh.SHOTS)), 'plates carry no code');
  for (const [W, H, band] of [[1920, 1080, { t: 210, b: 250, w: 1920 }], [1920, 1080, { t: 260, b: 300, w: 608 }], [1080, 1920, { t: 380, b: 420, w: 1080 }], [1280, 720, null]]) {
    const r = Sh.shotRect(W, H, band), cw = band ? band.w : W, x0 = (W - cw) / 2;
    ok(r.x >= x0 && r.x + r.w <= x0 + cw && r.y >= (band ? band.t : 0) && r.y + r.h <= H - (band ? band.b : 0), `rect inside the band at ${W}x${H}${band ? ' column ' + band.w : ''}`);
    for (const a of [16 / 10, 2, 1, 4 / 3]) { const f = Sh.fitRect(r, a); ok(near(f.w / f.h, a, 1e-9) && f.w <= r.w + 1e-9 && f.h <= r.h + 1e-9, `fitRect ${a.toFixed(2)} at ${W}x${H}`); }
  }
}

section('page');
{
  for (const f of ['main.js', 'saver.js', 'client.js', 'draw.js', 'jobs.js', 'worker.js', 'geometry.js', 'shots.js', 'data.js']) {
    const c = spawnSync(process.execPath, ['--check', HERE + f], { encoding: 'utf8' });
    ok(c.status === 0, `node --check ${f} ${c.stderr}`);
  }
  const imp = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(HERE + 'main.js').href)})`], { encoding: 'utf8' });
  const err = imp.stderr || '';
  ok(imp.status === 0 || (/ReferenceError: (matchMedia|window|document|IntersectionObserver|requestAnimationFrame) is not defined/.test(err) && !/SyntaxError|does not provide an export/.test(err)), `main.js links in node (${(err.match(/\w+Error[^\n]*/) || ['ok'])[0]})`);
  const html = rd('index.html'), css = rd('style.css'), js = rd('main.js');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const used = [...new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))];
  const missing = used.filter(id => !ids.has(id));
  ok(missing.length === 0, `every id that main.js binds is in index.html (${used.length}); missing: ${missing.join(' ')}`);
  const heads = [...html.slice(0, html.indexOf('</head>')).matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  ok(heads.slice(0, 3).join() === '../../lib/gpu-guard.js,../../lib/wishlist.js,../../lib/stats-beacon.js', 'head order gpu-guard, wishlist, stats-beacon');
  ok(html.indexOf('gpu-guard.js') < html.indexOf('<meta'), 'gpu-guard is the first thing in the head');
  ok(/\[hidden\]\{display:none!important\}/.test(css), '[hidden] guard in style.css');
  const hiddenIds = [...html.matchAll(/id="([^"]+)"[^>]*\shidden[\s>]/g)].map(m => m[1]);
  ok(hiddenIds.includes('help'), 'the help sheet starts hidden');
  ok(!/Playfair|Cormorant|JetBrains|katex/i.test(html + css + js), 'no banned fonts and no KaTeX');
  ok(!/text-transform:\s*uppercase|letter-spacing/i.test(css), 'no uppercase letter-spaced labels');
  ok(/name="description"/.test(html) && /viewport-fit=cover/.test(html), 'description and viewport meta');
  ok(/\.\.\/stereogram-maker\//.test(html), 'links to the maker page');
  ok(!/@[a-z0-9.-]+\.(com|org|io)/i.test(html + js + rd('jobs.js') + rd('data.js')), 'no e-mail address in the page or its requests');
}

section('jsdom boot');
{
  let JSDOM = null;
  try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) { /* not on NODE_PATH */ }
  if (!JSDOM) console.log('  skipped: jsdom not on NODE_PATH');
  else {
    const dom = new JSDOM(rd('index.html'), { url: pathToFileURL(HERE + 'index.html').href, pretendToBeVisual: true });
    const w = dom.window;
    const g = globalThis;
    const keep = {};
    for (const k of ['window', 'document', 'matchMedia', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'devicePixelRatio', 'ImageData', 'HTMLElement']) keep[k] = Object.getOwnPropertyDescriptor(g, k);
    const set = (k, v) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
    set('window', w); set('document', w.document);
    set('matchMedia', q => ({ matches: /reduce/.test(q), addEventListener() {} }));
    const watched = []; let ioCb = null;
    set('IntersectionObserver', class { constructor(cb) { ioCb = cb; } observe(el) { watched.push(el); } unobserve() {} });
    set('ImageData', class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } });
    const log = { bad: [], calls: {} }, unhandled = [];
    process.on('unhandledRejection', e => unhandled.push(String(e && e.message || e)));
    set('requestAnimationFrame', () => 0);
    set('getComputedStyle', w.getComputedStyle.bind(w));
    set('innerWidth', 1280); set('innerHeight', 800);
    set('addEventListener', w.addEventListener.bind(w));
    w.HTMLCanvasElement.prototype.getContext = function () { return this.__ctx || (this.__ctx = mockCtx(log)); };
    w.Element.prototype.scrollTo = () => {};
    await import('./main.js');
    await new Promise(r => setTimeout(r, 400));
    const d = w.document;
    ok(d.querySelectorAll('#tlList li').length === Dt.TIMELINE.length, 'timeline rendered');
    ok(d.querySelectorAll('#srcList li').length === Object.keys(Dt.SOURCES).length, 'sources rendered');
    ok(d.querySelectorAll('#heroStats div').length === 4, 'hero stats rendered');
    ok([...d.querySelectorAll('.cites')].every(el => el.querySelector('a')), 'every cite span has a link');
    ok(d.getElementById('qWall').textContent.includes('suspended in the air'), 'Brewster quote filled');
    ok(d.querySelectorAll('#workList li').length === Dt.TYLER_WORKS.length, 'papers rendered');
    ok(d.querySelectorAll('#pairModel option').length >= 24, `object list in the pair select (${d.querySelectorAll('#pairModel option').length})`);
    // Every figure comes on screen: each one renders through the jobs.
    const t0 = Date.now();
    ioCb(watched.map(el => ({ target: el, isIntersecting: true })));
    while (Date.now() - t0 < 120000 && (d.querySelector('.busy') || (log.calls.putImageData || 0) < 20)) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 1500));
    ok(watched.length >= 12, `${watched.length} figures registered`);
    ok(!d.querySelector('.busy'), `every figure finished (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    const notes = [...d.querySelectorAll('.wait')].map(n => n.textContent).filter(t => /did not load/.test(t));
    ok(notes.length === 0, `no figure failed: ${notes.join(' | ')}`);
    ok((log.calls.putImageData || 0) >= 25, `stereogram images drawn: ${log.calls.putImageData || 0}`);
    ok(log.bad.length === 0, `no bad canvas call: ${log.bad.slice(0, 3).join(' ')}`);
    ok(unhandled.length === 0, `no unhandled rejection: ${unhandled.join(' | ')}`);
    ok(d.querySelectorAll('#galGrid button').length >= 6, `gallery buttons: ${d.querySelectorAll('#galGrid button').length}`);
    ok(/Marble|bust|Lion|statue/i.test(d.getElementById('heroCap').textContent), `hero caption names a real model: ${d.getElementById('heroCap').textContent.slice(0, 60)}`);
    ok(/cycles per degree/.test(d.getElementById('gratRead').textContent), 'grating readout');
    ok(/arcmin/.test(d.getElementById('geoRead').textContent), 'disparity readout');
    ok(/free pixels/.test(d.getElementById('rowRead').textContent), 'row readout');
    // The viewing switch re-renders the figures in cross-eyed mode.
    const before = log.calls.putImageData;
    d.querySelector('#modeSeg button[data-v="cross"]').click();
    const t1 = Date.now();
    while (Date.now() - t1 < 60000 && (d.querySelector('.busy') || log.calls.putImageData === before)) await new Promise(r => setTimeout(r, 200));
    ok(log.calls.putImageData > before, 'cross-eyed mode re-renders the stereograms');
    d.getElementById('revealBtn').click();
    await new Promise(r => setTimeout(r, 3000));
    ok(d.getElementById('revealBtn').getAttribute('aria-pressed') === 'true', 'reveal toggles');
    // The saver keeps the images of shots i - 1 .. i + 1 only. The frames
    // run in one go, so the jobs of the first shots end after their shots.
    {
      let rafCb = null;
      set('requestAnimationFrame', f => { rafCb = f; return 1; });
      set('cancelAnimationFrame', () => { rafCb = null; });
      const sv = w.snSaver;
      sv.enter({ seed: 5, calm: 0 });
      let now = 1000;
      const step = n => { for (let k = 0; k < n && rafCb; k++) { const f = rafCb; rafCb = null; now += 50; f(now); } };
      for (let guard = 0; guard < 4000 && sv.debug().i < 4; guard++) step(1);
      const i4 = sv.debug().i;
      await new Promise(r => setTimeout(r, 6000));
      step(1);
      const dbg = sv.debug(), stale = dbg.keys.filter(k => k < dbg.i - 1);
      ok(i4 >= 4 && stale.length === 0, `saver: no images kept below shot i - 1 after late jobs (i ${dbg.i}, keys ${dbg.keys.join(',')})`);
      sv.cut('wall'); step(1);
      const dc = sv.debug(), stale2 = dc.keys.filter(k => k < dc.i - 1);
      ok(stale2.length === 0, `saver: a cut deletes the old images (i ${dc.i}, keys ${dc.keys.join(',')})`);
      sv.exit();
      set('requestAnimationFrame', () => 0);
    }
    for (const [k, v] of Object.entries(keep)) { if (v) Object.defineProperty(g, k, v); else delete g[k]; }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
