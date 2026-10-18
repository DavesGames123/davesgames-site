// ============================================================================
//  CORAL REEF  ·  the large map of the explored seafloor (node + jsdom)
//                 node tests/mapview.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the minimap should be a whole nlot more
//  functional. i want to be able to click it to open an expanded view and
//  navigate". Checks of map-view.js:
//    pure ... map <-> world round trip, zoom about a fixed point and its
//             limits, pan, "Fit all", the resolution of a view, the ROV
//             under a click, the history cut, the tiles of the explored
//             cells (each cell painted once, at the right pixel, in the
//             depth colour, coarse levels, a tile cap)
//    unit ... mountExploreMap in jsdom with a fake squad and a 2D context:
//             open and close (API, M, Esc, close button), keys do not
//             reach the page, a click selects an ROV, a click sends the
//             selected ROV (the right world point), Shift + click and
//             "Move camera" move the camera, drag, wheel and pinch, Track,
//             Follow, regions, trails, colonies and arches found, history,
//             the readout, hidden in the saver, full screen on a phone
//    page ... the real main.js in jsdom (page-harness.mjs): a tap on the
//             minimap opens the map and the 3D draws stop; a click sends
//             ROV 1 with the real squad.goTo; Shift + click moves the free
//             camera; Esc, M; the saver closes it; a phone opens it full
//             screen. Without jsdom (JSDOM_DIR or NODE_PATH) the DOM parts
//             are SKIPPED and say so.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  zoomAbout, panBy, fitBounds, kRange, lodFor, tileOf, nearestRov, histCut, createAtlas, mountExploreMap,
  LODS, TILE, SPAN_MIN, SPAN_MAX,
} from '../map-view.js';
import { worldToMap, mapToWorld, depthColour, MAP_CELL } from '../minimap.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── pure ────────────────────────────────────────────────────────────────────
{
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const v = { cx: (Math.random() - 0.5) * 1e5, cz: (Math.random() - 0.5) * 1e5, k: 0.001 + Math.random() * 5, w: 300 + Math.random() * 900, h: 200 + Math.random() * 700 };
    const x = v.cx + (Math.random() - 0.5) * 3000, z = v.cz + (Math.random() - 0.5) * 3000;
    const s = worldToMap(x, z, v), w = mapToWorld(s[0], s[1], v);
    worst = Math.max(worst, Math.hypot(w[0] - x, w[1] - z));
  }
  ok(worst < 1e-6, 'pure: world -> map -> world round trip over 200 views', `worst ${worst}`);
  const v = { cx: 100, cz: -50, k: 1, w: 800, h: 600 };
  const z = zoomAbout(v, 200, 450, 2.5), a = mapToWorld(200, 450, v), b = mapToWorld(200, 450, z);
  ok(near(z.k, 2.5) && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, 'pure: a zoom keeps the world point under the cursor');
  let zz = v; for (let i = 0; i < 60; i++) zz = zoomAbout(zz, 400, 300, 2);
  ok(near(600 / zz.k, SPAN_MIN, 1e-6), `pure: zoom in stops at ${SPAN_MIN} m across`);
  zz = v; for (let i = 0; i < 60; i++) zz = zoomAbout(zz, 400, 300, 0.5);
  ok(near(600 / zz.k, SPAN_MAX, 1e-3), `pure: zoom out stops at ${SPAN_MAX / 1000} km across`);
  const p = panBy({ cx: 0, cz: 0, k: 0.25, w: 800, h: 600 }, 40, 10);
  ok(near(p.cx, -160) && near(p.cz, -40), 'pure: a drag of (40, 10) px at 0.25 px/m moves the centre (-160, -40) m');
  const f = fitBounds([-1000, 200, 3000, 900], 800, 600);
  const c0 = worldToMap(-1000, 200, f), c1 = worldToMap(3000, 900, f);
  ok(c0[0] >= 0 && c1[0] <= 800 && c0[1] >= 0 && c1[1] <= 600 && near(f.cx, 1000) && near(f.cz, 550), 'pure: "Fit all" shows the whole box, centred', JSON.stringify([c0, c1]));
  ok(lodFor(1, 1) === 0 && lodFor(0.05, 1) === 1 && lodFor(0.01, 2) === 2 && lodFor(1e-4, 1) === 3, 'pure: the resolution follows the zoom (3, 12, 48, 192 m a pixel)', [lodFor(1, 1), lodFor(0.05, 1), lodFor(0.01, 2), lodFor(1e-4, 1)].join());
  ok(tileOf(-1, 0, 0).join() === '-1,0' && tileOf(TILE * 3, TILE * 3 * 2, 0).join() === '1,2', 'pure: tiles are world anchored');
  const R = [{ id: 1, p: [0, 0, 0] }, { id: 2, p: [20, 0, 0] }];
  ok(nearestRov(R, 418, 300, { cx: 0, cz: 0, k: 1, w: 800, h: 600 }).id === 2 && nearestRov(R, 600, 300, { cx: 0, cz: 0, k: 1, w: 800, h: 600 }) === null, 'pure: a click near an arrow finds that ROV, a far click none');
  const T = [[0, 0, 1], [1, 0, 2], [2, 0, 5], [3, 0, 9]];
  ok(histCut(T, 0) === 0 && histCut(T, 2) === 2 && histCut(T, 6) === 3 && histCut(T, 99) === 4, 'pure: the history cut of a trail');

  // the tiles
  const calls = { n: 0 };
  const ground = (x, z) => { calls.n++; return 55 - (20 + x * 0.01 + z * 0.005); };   // 20 m deep and deeper to the east
  const A = createAtlas({ ground, region: () => ({ id: 'reef' }), surfaceY: 55, now: () => 0 });
  const vis = new Map([['0,0', 1], ['1,0', 1], ['5,3', 1]]);
  ok(A.sync(vis, 10) === 3 && A.cells.get('5,3')[2] === 10 && A.sync(vis, 20) === 0, 'atlas: new visited cells come in once, with the time first seen');
  vis.set('-2,-1', 1);
  ok(A.sync(vis, 30) === 1 && A.cells.get('-2,-1')[2] === 30, 'atlas: a later cell comes in at its time');
  ok(near(A.bounds[0], -24) && near(A.bounds[3], 48), 'atlas: the bounds of the explored cells', JSON.stringify(A.bounds));
  const t0 = A.tile(0, 0, 0);
  ok(t0 && A.pending === 3, 'atlas: a tile queues the cells inside it', `${A.pending}`);
  while (A.pending) A.work(5);
  const sub = MAP_CELL / LODS[0], px = (u, w) => { const i = (w * TILE + u) * 4; return [t0.px[i], t0.px[i + 1], t0.px[i + 2], t0.px[i + 3]]; };
  const inC = px(5 * sub + 1, 3 * sub + 1), out = px(3 * sub, 3 * sub);
  const want = depthColour(20 + (5 * 12 + 4.5) * 0.01 + (3 * 12 + 4.5) * 0.005);
  ok(inC[3] === 255 && out[3] === 0, 'atlas: cell (5, 3) is painted at its pixels, the ground next to it stays fog', inC.join() + ' / ' + out.join());
  ok(Math.abs(inC[2] - (want[2] * 0.82 + 122 * 0.18)) < 60, 'atlas: the pixel has about the depth colour (with the reef tint and shade)', inC.join() + ' want ~' + want.join());
  const n0 = calls.n; A.tile(0, 0, 0); A.work(5);
  ok(calls.n === n0, 'atlas: a painted tile is not painted again');
  vis.set('6,3', 1); A.sync(vis, 40);
  ok(A.pending === 1, 'atlas: a new cell in a tile that is shown is queued at once');
  A.work(5);
  const t3 = A.tile(3, 0, 0) || A.tile(3, -1, -1);
  while (A.pending) A.work(5);
  ok(t3 && [...t3.px].some((v2, i) => i % 4 === 3 && v2 === 255), 'atlas: the coarse level paints the cells too');
  const B = createAtlas({ ground, surfaceY: 55, maxTiles: 10, now: () => 0 });
  const many = new Map(); for (let i = 0; i < 40; i++) many.set(`${i * 40},0`, 1);
  B.sync(many, 0);
  for (let i = 0; i < 40; i++) B.tile(0, Math.floor(i * 40 * 12 / (TILE * 3)), 0);
  ok(B.tiles.size <= 10, 'atlas: at most maxTiles tiles are kept', `${B.tiles.size}`);
  const nv = createAtlas({ ground, surfaceY: 55 });
  ok(nv.tile(0, 99, 99) === null && nv.tilesIn({ cx: 0, cz: 0, k: 1, w: 100, h: 100 }, 0).length === 0, 'atlas: no tile where nothing is explored');
}

// ── jsdom ───────────────────────────────────────────────────────────────────
function jsdomClass() {
  try {
    const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
    const req = createRequire(import.meta.url);
    return req(req.resolve('jsdom', { paths: dirs.length ? dirs : undefined })).JSDOM;
  } catch { return null; }
}
const JSDOM = jsdomClass();
const run = ms => new Promise(r => setTimeout(r, ms));
if (!JSDOM) console.log('mapview: jsdom not found (set JSDOM_DIR or NODE_PATH): the DOM parts SKIPPED');
else {
  const css = fs.readFileSync(path.join(HERE, '../map-view.css'), 'utf8');
  function unit({ phone = false, w = 1280, h = 800 } = {}) {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="minimap"><canvas id="mmCanvas"></canvas></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
    const win = dom.window, doc = win.document;
    Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
    const st = doc.createElement('style'); st.textContent = '[hidden]{display:none!important}\n' + css; doc.head.append(st);
    const draws = { n: 0, fillRect: 0, drawImage: 0 };
    const ctx = new Proxy({}, { get(t, k) { if (k in t) return t[k]; if (k === 'createImageData') return (a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }); if (k === 'measureText') return () => ({ width: 8 }); return () => { draws.n++; if (k in draws) draws[k]++; }; }, set(t, k, v) { t[k] = v; return true; } });
    win.HTMLCanvasElement.prototype.getContext = () => ctx;
    Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode; }, configurable: true });
    const visited = new Map();
    for (let j = -5; j <= 5; j++) for (let i = -8; i <= 30; i++) visited.set(`${i},${j}`, 1);
    const squad = {
      stats: { t: 600 }, visited,
      vehicles: [1, 2, 3].map(id => ({ id, state: { p: [id * 30, -10, 0], yaw: 0, look: [0, 0, 0] } })),
    };
    const field = {
      ground: (x, z) => 55 - 30 - x * 0.02, regionAt: () => ({ id: 'reef', name: 'Reef' }),
      features: (x, z) => [{ kind: 'arch', id: 'arch:120,0', center: [120, 30, 0], size: 9 }, { kind: 'overhang', center: [0, 0, 0], size: 2 }],
    };
    const calls = [];
    let sel = 1;
    const hud = { selected: () => sel, select: (id, opt) => { calls.push(['select', id, opt]); sel = id; return true; }, sendTo: xz => { calls.push(['sendTo', xz.slice()]); return true; }, colourOf: id => ['#f00', '#0f0', '#00f', '#ff0'][id - 1] };
    const cam = { eye: [0, 30, 20], look: [0, 25, 0] };
    let saver = false;
    const M = mountExploreMap({
      doc, win, getSquad: () => squad, getField: () => field, getCam: () => cam, camera: () => ({ fov: 50 }), canvas: { clientWidth: 1280, clientHeight: 800 },
      surfaceY: 55, phoneQ: { matches: phone }, isSaver: () => saver, flash: m => calls.push(['flash', m]), hud,
      goRegion: id => { calls.push(['goRegion', id]); return true; }, moveCam: (x, z) => calls.push(['moveCam', x, z]),
      colonies: () => [{ key: 'c1', id: 'staghorn', base: [60, 20, 12], size: 3.2 }, { key: 'c2', id: 'tiny', base: [10, 20, 10], size: 0.6 }, { key: 'c3', id: 'far', base: [5000, 0, 5000], size: 6 }],
      speciesLabel: id => (id === 'staghorn' ? 'Staghorn coral' : null),
    });
    const winKeys = [];
    win.addEventListener('keydown', e => winKeys.push(e.code));
    return { dom, win, doc, M, calls, squad, cam, draws, winKeys, set saver(v) { saver = v; }, $: id => doc.getElementById(id) };
  }
  const key = (U, code, k, target) => { const e = new U.win.KeyboardEvent('keydown', { code, key: k, bubbles: true, cancelable: true }); (target || U.doc.body).dispatchEvent(e); return e; };
  const ptr = (U, type, x, y, o = {}) => { const e = new U.win.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, shiftKey: !!o.shift }); Object.defineProperty(e, 'pointerId', { value: o.id || 1 }); U.$('xmCanvas').dispatchEvent(e); };

  {
    const U = unit(), M = U.M, box = U.$('xmap');
    ok(box && box.hidden && U.win.getComputedStyle(box).display === 'none' && !M.isOpen, 'unit: the large map is made hidden');
    for (let i = 0; i < 5; i++) M.tick(0.6);
    const d0 = M.debug();
    ok(d0.cells === U.squad.visited.size && d0.trails.length === 3 && d0.trails.every(([, n]) => n >= 1), 'unit: the cells and the trails are recorded while the map is closed', JSON.stringify(d0.trails));
    ok(d0.marks.includes('colony') && d0.marks.includes('arch') && d0.marks.filter(k => k === 'colony').length === 1, 'unit: a big colony in an explored cell and an arch are found; a small or unexplored colony is not', d0.marks.join());
    key(U, 'KeyM', 'm');
    ok(M.isOpen && !box.hidden && M.covers(), 'unit: M opens the large map (covers() is true)');
    await run(60);
    ok(box.classList.contains('on'), 'unit: the open animation class is set');
    const fv = M.view, b0 = worldToMap(-8 * 12, -5 * 12, fv), b1 = worldToMap(31 * 12, 6 * 12, fv);
    ok(b0[0] >= 0 && b1[0] <= fv.w && b0[1] >= 0 && b1[1] <= fv.h, 'unit: at the first open, "Fit all" shows every explored cell', JSON.stringify([b0, b1, fv]));
    while (M.debug().pending) M.tick(0.02);
    M.tick(0.05);
    ok(M.debug().tiles > 0 && U.draws.drawImage > 0, 'unit: the tiles of the view are painted and drawn', JSON.stringify(M.debug()));
    U.winKeys.length = 0;
    key(U, 'KeyW', 'w', U.$('xmCanvas'));
    ok(U.winKeys.length === 0, 'unit: while the map is open, keys do not reach the page');
    key(U, 'Escape', 'Escape', U.$('xmCanvas'));
    ok(!M.isOpen && !M.covers(), 'unit: Esc closes it');
    await run(300);
    ok(box.hidden, 'unit: hidden after the close animation');
    M.open(); U.$('xmClose').click();
    ok(!M.isOpen, 'unit: the close button closes it');
    M.open(); key(U, 'KeyM', 'm', U.$('xmCanvas'));
    ok(!M.isOpen, 'unit: M closes it');

    // clicks
    M.open();
    const v = { cx: 0, cz: 0, k: 2, w: 800, h: 600 };
    M.view = v; U.calls.length = 0;
    const r2 = worldToMap(60, 0, v);
    ptr(U, 'pointerdown', r2[0] + 4, r2[1] - 3); ptr(U, 'pointerup', r2[0] + 4, r2[1] - 3);
    ok(U.calls.some(c => c[0] === 'select' && c[1] === 2 && c[2].follow === false) && !U.calls.some(c => c[0] === 'sendTo'), 'unit: a click on the arrow of ROV 2 selects it (no camera change, no send)', JSON.stringify(U.calls));
    U.calls.length = 0;
    ptr(U, 'pointerdown', 250, 400); ptr(U, 'pointerup', 251, 400);
    const sent = U.calls.find(c => c[0] === 'sendTo'), want = mapToWorld(251, 400, v);
    ok(sent && near(sent[1][0], want[0], 1e-9) && near(sent[1][1], want[1], 1e-9) && M.isOpen, 'unit: a click sends the selected ROV to that world point and the map stays open', JSON.stringify(sent));
    ok(U.$('xmSend').textContent === 'Send ROV 2', 'unit: the action names the selected ROV');
    U.calls.length = 0;
    ptr(U, 'pointerdown', 700, 100, { shift: true }); ptr(U, 'pointerup', 700, 100, { shift: true });
    const mc = U.calls.find(c => c[0] === 'moveCam'), w2 = mapToWorld(700, 100, v);
    ok(mc && near(mc[1], w2[0], 1e-9) && near(mc[2], w2[1], 1e-9) && !M.isOpen, 'unit: Shift + click moves the free camera there and closes the map', JSON.stringify(mc));
    M.open(); M.view = { ...v }; U.$('xmCam').click(); U.calls.length = 0;
    ptr(U, 'pointerdown', 100, 500); ptr(U, 'pointerup', 100, 500);
    ok(U.calls.some(c => c[0] === 'moveCam') && !U.calls.some(c => c[0] === 'sendTo'), 'unit: with "Move camera" chosen a click moves the camera');
    M.open(); U.$('xmSend').click(); M.view = { ...v };
    // drag pan, wheel, pinch
    U.calls.length = 0;
    ptr(U, 'pointerdown', 400, 300); ptr(U, 'pointermove', 430, 300); ptr(U, 'pointermove', 450, 320); ptr(U, 'pointerup', 450, 320);
    ok(!U.calls.some(c => c[0] === 'sendTo') && near(M.view.cx, -25) && near(M.view.cz, -10), 'unit: a drag pans (no send)', JSON.stringify(M.view));
    const before = mapToWorld(123, 456, M.view);
    const we = new U.win.WheelEvent('wheel', { deltaY: 150, clientX: 123, clientY: 456, bubbles: true, cancelable: true });
    U.$('xmCanvas').dispatchEvent(we);
    const after = mapToWorld(123, 456, M.view);
    ok(M.view.k < 2 && Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-9 && we.defaultPrevented, 'unit: the wheel zooms out about the cursor');
    M.view = { ...v };
    ptr(U, 'pointerdown', 300, 300, { id: 1 }); ptr(U, 'pointerdown', 500, 300, { id: 2 });
    ptr(U, 'pointermove', 350, 300, { id: 1 }); ptr(U, 'pointermove', 450, 300, { id: 2 });
    ptr(U, 'pointerup', 350, 300, { id: 1 }); ptr(U, 'pointerup', 450, 300, { id: 2 });
    ok(near(M.view.k, 1) && !U.calls.some(c => c[0] === 'sendTo'), 'unit: a pinch to half the finger gap zooms out 2 x, no send', JSON.stringify(M.view));
    U.$('xmIn').click(); const k1 = M.view.k; U.$('xmOut').click();
    ok(k1 > 1 && near(M.view.k, 1, 1e-9), 'unit: the + and - buttons zoom');
    // Track and Follow, regions
    U.$('xmTrack').click(); M.tick(0.05); await run(40); M.tick(0.05);
    ok(near(M.view.cx, 60) && U.$('xmTrack').getAttribute('aria-pressed') === 'true', 'unit: Track centres the selected ROV', JSON.stringify(M.view));
    U.calls.length = 0;
    U.$('xmFollow').click();
    ok(U.calls.some(c => c[0] === 'select' && c[1] === 2 && c[2].follow === true) && !M.isOpen, 'unit: Follow makes the camera follow the selected ROV and closes the map');
    M.open(); U.calls.length = 0;
    U.$('xmRegions').querySelector('[data-region="abyss"]').click();
    ok(U.calls.some(c => c[0] === 'goRegion' && c[1] === 'abyss') && !M.isOpen && U.$('xmRegions').querySelectorAll('button').length === 5, 'unit: the five region shortcuts go to a region (the panel goRegion)');
    // found list, readout, history, legend
    M.open();
    ok(/Staghorn coral/.test(U.$('xmFound').textContent) && /Natural arch/.test(U.$('xmFound').textContent), 'unit: the Found list names the colony and the arch', U.$('xmFound').textContent);
    M.view = { ...v };
    ptr(U, 'pointermove', 400 + 10, 300 + 2);
    ok(/km E, .* m deep · Reef · seen at 10:00/.test(M.debug().read), 'unit: the readout gives the place, depth, region and the time seen', M.debug().read);
    ptr(U, 'pointermove', 400 + 1500, 300);
    ok(/not explored yet/.test(M.debug().read), 'unit: no depth is shown where nothing is explored (fog of war)', M.debug().read);
    const fr0 = U.draws.fillRect;
    const hs = U.$('xmHist'); hs.value = '500'; hs.dispatchEvent(new U.win.Event('input'));
    ok(M.debug().hist === 0.5 && /5:00 of 10:00/.test(U.$('xmHistT').textContent) && U.draws.fillRect > fr0, 'unit: History shows the exploration up to a time', U.$('xmHistT').textContent);
    hs.value = '1000'; hs.dispatchEvent(new U.win.Event('input'));
    ok(/Shallows/.test(U.$('xmLegend').textContent) && /Abyss/.test(U.$('xmLegend').textContent) && /not explored/.test(U.$('xmLegend').textContent) && /colonies/.test(U.$('xmLegend').textContent), 'unit: the legend has the depth colours, regions, fog of war and markers');
    ok(U.win.getComputedStyle(box.querySelector('.xm-box')).left !== '0px', 'unit: a box on a desktop, not the full screen');
    // the saver
    U.saver = true; M.tick(0.05);
    ok(!M.isOpen, 'unit: the saver closes the map');
    key(U, 'KeyM', 'm');
    ok(!M.isOpen, 'unit: M does not open it in the saver');
    U.saver = false;
    M.open(); U.doc.documentElement.classList.add('sn-saver');
    ok(U.win.getComputedStyle(box).display === 'none', 'unit: CSS hides the map in the shell saver');
    U.win.close();
  }
  {
    const U = unit({ phone: true, w: 390, h: 844 }), M = U.M;
    M.open();
    const cs = U.win.getComputedStyle(U.$('xmap').querySelector('.xm-box'));
    ok(U.$('xmap').classList.contains('full') && cs.left === '0px' && cs.top === '0px' && cs.right === '0px' && cs.bottom === '0px', 'unit phone: the map fills the screen', `${cs.left} ${cs.top} ${cs.right} ${cs.bottom}`);
    ok(/\.xmap\.full \.xm-tools button\{min-width:44px;height:44px\}/.test(css) && /\.xmap\.full \.xm-rov,[^{]*\{min-height:44px\}/.test(css), 'unit phone: 44 px targets');
    U.win.close();
  }

  // ── the page ──────────────────────────────────────────────────────────────
  const { bootPage } = await import('./page-harness.mjs');
  const P = await bootPage({ w: 1280, h: 720, dpr: 1, search: '?profile=laptop-low' });
  const W = P.win, $ = id => P.doc.getElementById(id), dbg = () => W.__coralDebug();
  const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await P.run(100); } return !!f(); };
  ok(await until(() => dbg().worldReady && dbg().rovs > 0, 120000), 'page: the world and the ROVs are built');
  await P.run(1500);
  const mm = $('mmCanvas');
  ok(mm.tabIndex === 0 && mm.getAttribute('role') === 'button' && /large map/.test(mm.getAttribute('aria-label')) && $('minimap').querySelector('.mm-hint'), 'page: the minimap is a focusable button with the hint "Click to expand"');
  const tap = (el, x, y) => { for (const t of ['pointerdown', 'pointerup']) { const e = new W.MouseEvent(t, { clientX: x, clientY: y, bubbles: true }); Object.defineProperty(e, 'pointerId', { value: 1 }); el.dispatchEvent(e); } };
  ok($('minimap').classList.contains('mm-m') && $('mmSize').textContent === 'M', 'page: the minimap starts at the medium size (bigger than before)');
  $('mmSize').click();
  ok($('minimap').classList.contains('mm-l') && W.localStorage.getItem('coral-reef-minimap-size') === 'l', 'page: the size button makes it large and keeps that in localStorage');
  $('mmSize').click(); $('mmSize').click();
  ok($('minimap').classList.contains('mm-m'), 'page: the size button goes S, M, L and round');
  $('mmExpand').click();
  ok(dbg().hud.big.open, 'page: the expand button opens the large map');
  P.doc.getElementById('xmClose').click();
  tap(mm, 50, 50);
  ok(dbg().hud.big && dbg().hud.big.open && !$('xmap').hidden, 'page: a tap on the minimap opens the large map', JSON.stringify(dbg().hud.big && dbg().hud.big.open));
  const L0 = P.fake.log.length; await P.run(600); const L1 = P.fake.log.length;
  ok(L1 === L0, 'page: while the large map is open no 3D draws happen', `${L1 - L0} GL ops in 600 ms`);
  const big = () => dbg().hud.big;
  // send ROV 1 with the real squad.goTo
  const lead = dbg().squad.p[0];
  const xmc = $('xmCanvas');
  const ptrP = (type, x, y, shift) => { const e = new W.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, shiftKey: !!shift }); Object.defineProperty(e, 'pointerId', { value: 1 }); xmc.dispatchEvent(e); };
  // the canvas rect is 0,0 in jsdom: map px = client px; move the view onto the lead first
  key({ win: W, doc: P.doc }, 'Digit1', '1', xmc);
  const fitV = big().view;
  const sx = worldToMap(lead[0] + 6, lead[2] + 4, fitV);
  ptrP('pointerdown', sx[0] + 40, sx[1] + 40); ptrP('pointerup', sx[0] + 40, sx[1] + 40);
  await P.run(300);
  const a1 = big().actions.filter(a => a.kind === 'send' || a.kind === 'select').pop();
  ok(a1 && a1.kind === 'send' && a1.id === 1, 'page: a click on the map sends ROV 1 (squad.goTo)', JSON.stringify(a1));
  ok(a1 && (a1.ok ? /marked point/.test(dbg().squad.label) : true), 'page: the lead takes the leg to the marked point (or the page says it cannot)', dbg().squad.label + ' ok ' + (a1 && a1.ok));
  // Shift + click: the free camera goes there
  const wp = mapToWorld(sx[0] + 10, sx[1] - 10, big().view);
  ptrP('pointerdown', sx[0] + 10, sx[1] - 10, true); ptrP('pointerup', sx[0] + 10, sx[1] - 10, true);
  ok(!big().open && big().actions.pop().kind === 'camera', 'page: Shift + click moves the camera and closes the map');
  await P.run(2500);
  const cm = dbg().cam;
  ok(cm.mode === 'orbit' && cm.choice === 'orbit' && Math.hypot(cm.eye[0] - wp[0], cm.eye[2] - wp[1]) < 30, 'page: the free camera is in orbit at the map point', JSON.stringify({ eye: cm.eye, wp, mode: cm.mode, choice: cm.choice }));
  const L2 = P.fake.log.length; await P.run(300);
  ok(P.fake.log.length > L2, 'page: after the close the 3D draws go on');
  // M and Esc on the page
  W.document.body.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
  ok(big().open, 'page: M opens the large map');
  xmc.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  ok(!big().open, 'page: Esc closes it');
  // the saver closes it and hides it
  W.document.body.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
  W.snSaver.enter({ seed: 2, label: () => {} });
  await P.run(400);
  ok(!big().open && !dbg().hud.big.open, 'page: the saver closes the large map');
  W.document.body.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
  ok(!big().open, 'page: M does nothing in the saver');
  W.snSaver.exit();
  await P.run(300);
  ok(P.errors.length === 0, 'page: no console errors', P.errors.slice(0, 3).join(' | '));
  P.close();

  // the phone: the map opens full screen from the folded minimap
  const Q = await bootPage({ w: 390, h: 844, dpr: 2, coarse: true, search: '?profile=phone' });
  const W2 = Q.win, $2 = id => Q.doc.getElementById(id), d2 = () => W2.__coralDebug();
  const until2 = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await Q.run(100); } return !!f(); };
  await until2(() => d2().worldReady && d2().rovs > 0, 120000);
  await Q.run(600);
  $2('mmFold').click();
  const t2 = (el) => { for (const t of ['pointerdown', 'pointerup']) { const e = new W2.MouseEvent(t, { clientX: 20, clientY: 20, bubbles: true }); Object.defineProperty(e, 'pointerId', { value: 1 }); el.dispatchEvent(e); } };
  t2($2('mmCanvas'));
  ok(d2().hud.big.open && d2().hud.big.full && $2('xmap').classList.contains('full'), 'phone: a tap on the minimap opens the map full screen');
  ok(Q.errors.length === 0, 'phone: no console errors', Q.errors.slice(0, 3).join(' | '));
  Q.close();
}

console.log(`mapview: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
