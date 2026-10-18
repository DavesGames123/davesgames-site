// ============================================================================
//  DLAF PAGE  ·  tests-dom.mjs — boot the page in jsdom at each viewport
// ----------------------------------------------------------------------------
//    JSDOM_DIR=<a folder with node_modules/jsdom> node tests-dom.mjs
//        runs every viewport below, each in its own node process
//    JSDOM_DIR=... node tests-dom.mjs 390 844 coarse      one viewport
//
//  The repo has no node_modules, so this file finds jsdom through JSDOM_DIR
//  (or a normal resolve) and exits 0 with SKIP when it is missing. jsdom has
//  no layout and no media queries: matchMedia uses layout.js matchQuery, and
//  the overlay rects come from layout.js overlayRects (the sizes of
//  style.css) for the open, full or closed state of the panel. WebGL2 is a
//  stub; there is no Worker, so the surface mesher runs inline. Browser
//  checks do not run here.
//
//  CHECKS (each viewport): the dock items and the preset picker; the panel
//  is closed on a phone and open on a desktop; the grip snaps half, full,
//  closed; the CSV and source folds; Lines and Surface; pause; the cluster
//  rect is clear of the sheet, the drawer and the walker caption; the walker
//  demo closes the sheet on a phone; pinch and pan in 2D, orbit and pinch
//  in 3D; the pixel ratio cap; no page error.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const VIEWS = [[360, 740, 'coarse'], [390, 844, 'coarse'], [430, 932, 'coarse'], [768, 1024, 'coarse'], [844, 390, 'coarse'], [1280, 800, 'fine']];
const self = fileURLToPath(import.meta.url);

if (process.argv.length < 4) {
  let bad = 0, total = 0;
  for (const [w, h, p] of VIEWS) {
    const r = spawnSync(process.execPath, [self, String(w), String(h), p], { encoding: 'utf8', env: process.env });
    process.stdout.write(r.stdout); if (r.stderr) process.stdout.write(r.stderr);
    const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || '');
    if (/SKIP/.test(r.stdout)) { console.log('SKIP: jsdom not found (set JSDOM_DIR)'); process.exit(0); }
    if (!m || +m[2] || r.status) bad++;
    total += m ? +m[1] : 0;
  }
  console.log(`\nall viewports: ${total} checks, ${bad} viewport(s) failed`);
  process.exit(bad ? 1 : 0);
}

let JSDOM;
try {
  const d = process.env.JSDOM_DIR;
  ({ JSDOM } = d && existsSync(d + '/node_modules/jsdom') ? await import(pathToFileURL(d + '/node_modules/jsdom/lib/api.js').href) : await import('jsdom'));
} catch (e) { console.log('SKIP: jsdom not found (set JSDOM_DIR)'); process.exit(0); }
const { matchQuery, layoutKind, overlayRects, pinch2D, DOCK_ITEMS } = await import('./layout.js');
const { PRESETS } = await import('./sim.js');

const [W, H] = process.argv.slice(2, 4).map(Number), coarse = process.argv[4] === 'coarse';
const V = { w: W, h: H, coarse }, kind = layoutKind(V), phone = kind !== 'desktop';
const DPR = phone ? 3 : 2;
console.log(`\n# ${W}x${H} ${coarse ? 'coarse' : 'fine'} (${kind})`);

const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const html = readFileSync(dir + '/index.html', 'utf8');
const dom = new JSDOM(html, { url: pathToFileURL(dir + '/index.html').href + '?debug', pretendToBeVisual: false });
const w = dom.window, doc = w.document;
const errors = [];
w.addEventListener('error', e => errors.push('error: ' + (e.message || e.error)));
process.on('unhandledRejection', e => errors.push('rejection: ' + (e && e.stack || e)));
const cerr = console.error; console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };

Object.defineProperty(w, 'innerWidth', { value: W }); Object.defineProperty(w, 'innerHeight', { value: H });
Object.defineProperty(w, 'devicePixelRatio', { value: DPR });
w.matchMedia = q => ({ matches: matchQuery(q, V), media: q, addEventListener() {}, removeEventListener() {} });
const glStub = () => new Proxy({}, { get(t, k) {
  if (k in t) return t[k];
  if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return 1;
  if (k === 'getShaderParameter' || k === 'getProgramParameter') return (o, p) => p === 'n' ? 0 : true;
  if (k === 'getActiveUniform') return () => ({ name: 'u' });
  return () => ({});
} });
w.HTMLCanvasElement.prototype.getContext = kindArg => kindArg === 'webgl2' ? glStub() : null;
w.URL.createObjectURL = URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { w.__downloads = (w.__downloads || 0) + 1; };
w.HTMLElement.prototype.setPointerCapture = function () {};

// layout stand-in: the rects of style.css for the state of the page
const canvas = doc.getElementById('gl');
for (const k of ['clientWidth', 'offsetWidth']) Object.defineProperty(canvas, k, { get: () => W });
for (const k of ['clientHeight', 'offsetHeight']) Object.defineProperty(canvas, k, { get: () => H });
const OFF = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
const panelEl = doc.getElementById('panel');
const sheetState = () => !panelEl.classList.contains('open') ? 'closed' : panelEl.classList.contains('full') ? 'full' : 'half';
const rectsNow = () => overlayRects(V, { sheet: sheetState(), walk: !doc.getElementById('walkCap').hidden });
const withWH = r => r ? Object.assign({ width: r.right - r.left, height: r.bottom - r.top }, r) : OFF;
const RECT_OF = { panel: 'panel', dock: 'dock', status: 'status', walkCap: 'walkCap', legend: 'legend' };
const realRect = w.HTMLElement.prototype.getBoundingClientRect;
w.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this === canvas) return { left: 0, top: 0, right: W, bottom: H, width: W, height: H };
  const key = this.classList.contains('topbar') ? 'topbar' : RECT_OF[this.id];
  if (key) return withWH(rectsNow()[key]);
  return realRect.call(this);
};

let raf = [];
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'matchMedia', 'Blob', 'location', 'devicePixelRatio']) {
  try { Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true }); } catch (e) { /* read-only */ }
}
globalThis.requestAnimationFrame = w.requestAnimationFrame = fn => { raf.push(fn); return raf.length; };
let T = 0;
const step = n => { for (let i = 0; i < n; i++) { const q = raf; raf = []; T += 16.7; q.forEach(f => f(T)); } };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const $ = id => doc.getElementById(id);
const click = id => $(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const ptr = (el, type, id, x, y) => { const e = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }); Object.defineProperty(e, 'pointerId', { value: id }); el.dispatchEvent(e); };

await import(pathToFileURL(dir + '/main.js').href);
step(20);
const S = w.dlaf;
ok(S && S.m && S.m.count > 20, `boots and grows (${S && S.m ? S.m.count : 0} particles)`);

// dock
const dockIds = [...$('dock').children].map(e => e.id);
ok(dockIds.join() === DOCK_ITEMS.map(d => d.id).join(), `dock: ${dockIds.join(', ')}`);
ok($('dockPreset').options.length === PRESETS.length && $('dockPreset').value === 'classic', `preset picker has ${$('dockPreset').options.length} presets`);
$('dockPreset').value = 'wind'; $('dockPreset').dispatchEvent(new w.Event('change')); step(3);
ok(S.preset === 'wind', 'dock preset picker selects a preset');
$('presets').querySelector('[data-id="classic"]').click(); step(3);
ok(S.preset === 'classic' && $('dockPreset').value === 'classic', 'a panel preset updates the dock picker');

// panel, sheet, folds
ok(panelEl.classList.contains('open') === !phone, `panel ${phone ? 'closed' : 'open'} at boot`);
ok($('csvBox').open === !phone && $('codeBox').open === !phone, `CSV stream and source extracts ${phone ? 'folded' : 'open'}`);
$('csvBox').open = true; $('csvBox').dispatchEvent(new w.Event('toggle')); step(8);
ok(/tail -f output\.csv/.test($('csv').innerHTML), 'an open CSV fold streams lines');
$('csvBox').open = !phone;
if (phone) {
  click('dockPanel'); step(2);
  ok(sheetState() === 'half' && $('dockPanel').getAttribute('aria-expanded') === 'true', 'dock menu opens the panel');
  if (kind === 'portrait') {
    const g = $('sheetGrip');
    ptr(g, 'pointerdown', 7, 100, 500); ptr(g, 'pointerup', 7, 100, 430);
    ok(sheetState() === 'full', 'grip drag up: full sheet');
    ptr(g, 'pointerdown', 7, 100, 200); ptr(g, 'pointerup', 7, 100, 290);
    ok(sheetState() === 'half', 'grip drag down: half sheet');
    step(30);
    const p = rectsNow().panel;
    ok(S.rect.y + S.rect.h <= p.top + 0.5 && S.rect.y >= 89, `cluster rect above the half sheet (rect ${Math.round(S.rect.y)}..${Math.round(S.rect.y + S.rect.h)}, sheet top ${Math.round(p.top)})`);
    ptr(g, 'pointerdown', 7, 100, 500); ptr(g, 'pointerup', 7, 100, 590);
    ok(sheetState() === 'closed' && document.body.classList.contains('panel-closed'), 'grip drag down from half: closed');
  } else {
    step(30);
    const p = rectsNow().panel;
    ok(S.rect.x + S.rect.w <= p.left + 0.5, `cluster rect left of the drawer (rect right ${Math.round(S.rect.x + S.rect.w)}, drawer left ${Math.round(p.left)})`);
    click('panelClose'); step(2);
    ok(sheetState() === 'closed', 'the drawer close button closes it');
  }
} else {
  step(30);
  ok(S.rect.x >= 300 - 0.5, `cluster rect right of the panel (x ${Math.round(S.rect.x)})`);
}
step(20);
const occ = rectsNow();
const clearOf = (r, name) => { const q = occ[name]; return !q || r.y + r.h <= q.top + 0.5 || r.x + r.w <= q.left + 0.5 || r.x >= q.right - 0.5 || r.y >= q.bottom - 0.5; };
ok(['dock', 'status', 'topbar'].every(n => clearOf(S.rect, n)), `cluster rect clear of dock, status and topbar (${JSON.stringify(Object.fromEntries(Object.entries(S.rect).map(([k, v]) => [k, Math.round(v)])))})`);

// pause, Lines and Surface, pixel ratio
const lineCap = Math.min(DPR, 2);
ok(canvas.width === Math.round(W * lineCap), `lines draw at dpr ${lineCap} (buffer ${canvas.width} px wide)`);
click('dockPlay'); step(14);
ok(S.paused && $('dockPlay').textContent === '▶', 'dock pause');
click('dockPlay'); step(2);
ok(!S.paused, 'dock grow again');
click('dockSurf'); step(30);
ok(S.surf.on && $('dockSurf').textContent === 'Surface' && $('dockSurf').getAttribute('aria-pressed') === 'true', 'dock switch: Surface');
ok(!S.surf.err && S.surf.sf && S.surf.sf.applied > 0, `surface meshes inline (${S.surf.sf ? S.surf.sf.applied : 0} particles, ${S.surf.err || 'no error'})`);
const surfCap = phone ? 1.5 : 2;
ok(canvas.width === Math.round(W * surfCap), `surface draws at dpr ${surfCap} (buffer ${canvas.width} px wide)`);
if (phone) ok($('surfRes').querySelector('[data-id="high"]').disabled === true, 'phone: High mesh resolution is off');
click('dockSurf'); step(2);
ok(!S.surf.on && $('dockSurf').textContent === 'Lines', 'dock switch: Lines');

// walker demo: the caption must not cover the framed walker
if (phone) { click('dockPanel'); step(2); }
$('modeWalk').click(); step(40);
ok(S.mode === 'walk' && !$('walkCap').hidden, 'walker demo on');
if (phone) ok(sheetState() === 'closed', 'walker demo closes the sheet on a phone, so the caption shows');
const cap = rectsNow().walkCap;
ok(cap && (S.rect.y + S.rect.h <= cap.top + 0.5 || S.rect.x + S.rect.w <= cap.left + 0.5), `cluster rect clear of the walker caption (rect ${Math.round(S.rect.y)}..${Math.round(S.rect.y + S.rect.h)}, caption top ${cap ? Math.round(cap.top) : '?'})`);
ok($('wcText').textContent.length > 20, 'walker caption has text');
$('modeGrow').click(); step(5);

// 2D pinch and pan
S.paused = true; step(2);
const a0 = [W * 0.35, H * 0.4], b0 = [W * 0.6, H * 0.55], b1 = [W * 0.8, H * 0.7];
ptr(canvas, 'pointerdown', 1, a0[0], a0[1]); ptr(canvas, 'pointerdown', 2, b0[0], b0[1]);
const want = pinch2D(Object.assign({}, S.view), Object.assign({}, S.user), a0, b0, a0, b1, W, H);
ptr(canvas, 'pointermove', 2, b1[0], b1[1]);
ok(Math.abs(S.user.zoom - want.zoom) < 1e-9 && Math.abs(S.user.panX - want.panX) < 1e-9 && Math.abs(S.user.panY - want.panY) < 1e-9 && S.user.zoom > 1.2, `2D pinch zooms at the midpoint (zoom ${S.user.zoom.toFixed(2)})`);
ptr(canvas, 'pointerup', 2, b1[0], b1[1]);
const px0 = S.user.panX;
ptr(canvas, 'pointermove', 1, a0[0] + 40, a0[1]);
ok(S.user.panX < px0, '2D one-finger drag pans');
ptr(canvas, 'pointerup', 1, a0[0] + 40, a0[1]);

// 3D orbit and pinch
S.paused = false;
$('dim3').click(); step(10);
ok(S.m.dim === 3, '3D on');
const yaw0 = S.cam.yaw, z0 = S.user.zoom;
ptr(canvas, 'pointerdown', 3, 100, 300); ptr(canvas, 'pointermove', 3, 160, 280);
ok(Math.abs(S.cam.yaw - yaw0 - 60 * 0.006) < 1e-9, '3D one-finger drag orbits');
ptr(canvas, 'pointerdown', 4, 200, 400); ptr(canvas, 'pointermove', 4, 260, 470);
ok(S.user.zoom > z0 * 1.2, `3D pinch zooms (${z0.toFixed(2)} to ${S.user.zoom.toFixed(2)})`);
ptr(canvas, 'pointerup', 3, 0, 0); ptr(canvas, 'pointerup', 4, 0, 0);
$('dim2').click(); step(5);

// static: no [hidden] element with an inline display
const badHidden = [...doc.querySelectorAll('[hidden]')].filter(e => e.style.display && e.style.display !== 'none');
ok(badHidden.length === 0, 'no [hidden] element with an inline display');
ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
console.error = cerr;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
