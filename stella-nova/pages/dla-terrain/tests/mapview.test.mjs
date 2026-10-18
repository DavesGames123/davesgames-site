// tests/mapview.test.mjs — the map inset and the large map (node + jsdom,
// no browser). Run alone: NODE_PATH=<folder with jsdom> node
// stella-nova/pages/dla-terrain/tests/mapview.test.mjs
//
// The user said (2026-10-18): "the minimap should be a whole nlot more
// functional. i want to be able to click it to open an expanded view and
// navigate". Checks:
//   pure   map <-> world round trip, zoom about a fixed point and its
//          limits, pan, the cache level, the aim yaw against camera.js
//          forwardOf, stepAim, the camera pose of a bookmark, the features
//          of a terrain, bookmarks that persist and survive a throwing
//          storage, the map pixels (sea, contours, elevation colours)
//   camera the real camera.js flies to a map point and turns to the aim
//   jsdom  createUI with index.html, style.css and map-view.css: a click,
//          M and Esc open and close; keys do not reach the page while it
//          is open; a click flies to the right world point and closes; a
//          drag pans; Shift + drag aims; the wheel zooms about the cursor;
//          the "Go to" buttons; bookmarks in localStorage and with a
//          throwing localStorage; hidden in the saver; full screen on a
//          phone; the inset draws at the device pixel ratio
//   main   main.js has the flyView, aim and pause hooks

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  fitView, toScreen, toWorld, zoomAbout, panBy, clampView, kLimits, pickLevel, niceScale, aimYaw, stepAim,
  viewOfCamera, findFeatures, terrainSig, createBookmarks, renderLevel, contourStep, MIN_SPAN,
} from '../map-view.js';
import { createCamera, forwardOf } from '../camera.js';

const here = p => fileURLToPath(new URL('../' + p, import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} mapview: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} mapview: ${name} ${extra}`); }
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── pure: view maths
{
  const ws = 20000;
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const v = { cx: (Math.random() - 0.5) * ws, cz: (Math.random() - 0.5) * ws, k: 0.01 + Math.random() * 2, w: 300 + Math.random() * 900, h: 200 + Math.random() * 700 };
    const x = (Math.random() - 0.5) * ws, z = (Math.random() - 0.5) * ws;
    const s = toScreen(x, z, v), w = toWorld(s[0], s[1], v);
    worst = Math.max(worst, Math.hypot(w[0] - x, w[1] - z));
  }
  ok(worst < 1e-6, 'world -> map -> world round trip over 200 random views', `worst ${worst}`);
  const f = fitView(ws, 1000, 600);
  const c0 = toScreen(-ws / 2, -ws / 2, f), c1 = toScreen(ws / 2, ws / 2, f);
  ok(c0[1] >= 0 && c1[1] <= 600 && near(c0[0] + c1[0], 1000, 1e-6), 'fit view: the whole terrain shows, centred', JSON.stringify([c0, c1]));
  ok(toScreen(0, -1000, f)[1] < toScreen(0, 1000, f)[1], 'north (-z) is up on the map');
  const z = zoomAbout(f, 700, 200, 3, ws), a = toWorld(700, 200, f), b = toWorld(700, 200, z);
  ok(near(z.k, f.k * 3, 1e-9) && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, 'zoom about the cursor keeps that world point under it', JSON.stringify([a, b]));
  const [kMin, kMax] = kLimits(ws, 1000, 600);
  let zz = f; for (let i = 0; i < 40; i++) zz = zoomAbout(zz, 500, 300, 2, ws);
  ok(near(zz.k, kMax, 1e-9) && near(Math.min(1000, 600) / zz.k, MIN_SPAN, 1e-6), `zoom in stops at ${MIN_SPAN} m across`, `${Math.min(1000, 600) / zz.k}`);
  zz = f; for (let i = 0; i < 40; i++) zz = zoomAbout(zz, 500, 300, 0.5, ws);
  ok(near(zz.k, kMin, 1e-9), 'zoom out stops a little past the fit');
  const p = panBy({ cx: 0, cz: 0, k: 0.5, w: 800, h: 600 }, 100, -40, ws);
  ok(near(p.cx, -200) && near(p.cz, 80), 'a drag of (100, -40) px moves the centre by (-200, 80) m at 0.5 px/m', JSON.stringify(p));
  const cl = clampView({ cx: 1e6, cz: -1e6, k: 1, w: 10, h: 10 }, ws);
  ok(cl.cx === ws / 2 && cl.cz === -ws / 2, 'the view centre stays over the terrain');
  ok(pickLevel(fitView(ws, 220, 220), ws, 1) === 256 && pickLevel(fitView(ws, 1000, 1000), ws, 2) === 2048 && pickLevel(fitView(ws, 1000, 1000), ws, 2, 1024) === 1024,
    'the cache level: 256 for the inset, the largest for a big zoom, capped by the grid or the phone');
  const sc = niceScale(0.05, 100);
  ok([1, 2, 5].includes(sc.m / Math.pow(10, Math.floor(Math.log10(sc.m)))) && near(sc.px, sc.m * 0.05) && sc.text === '2 km', 'the scale bar is 1, 2 or 5 x 10^n', JSON.stringify(sc));
  ok(contourStep(3600) === 500 && contourStep(120) === 10, 'the contour step from the height span', `${contourStep(3600)} ${contourStep(120)}`);
}

// ── pure: aim and camera pose
{
  let worst = 0;
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [3, -4], [-2, -7]]) {
    const f = forwardOf(aimYaw(dx, dz) + Math.PI, -0.3), l = Math.hypot(dx, dz), h = Math.hypot(f[0], f[2]);
    worst = Math.max(worst, Math.hypot(f[0] / h - dx / l, f[2] / h - dz / l));
  }
  ok(worst < 1e-9, 'aimYaw: the camera.js orbit forward points along the map drag', `worst ${worst}`);
  const cam = { mode: 'orbit', orbit: { target: [0, 0, 0], yaw: 0, pitch: -0.5, dist: 100 } };
  let aim = { yaw: 2.5, pitch: -0.3, t0: 0 }, n = 0;
  while (aim && n < 600) { aim = stepAim(cam, aim, 1 / 60, -1); n++; }
  ok(!aim && near(cam.orbit.yaw, 2.5, 1e-9) && near(cam.orbit.pitch, -0.3, 1e-9) && n < 300, `stepAim turns the orbit to the aim in ${(n / 60).toFixed(1)} s`);
  ok(stepAim(cam, { yaw: 1, t0: 10 }, 0.016, 50) === null && stepAim({ mode: 'fly' }, { yaw: 1, t0: 0 }, 0.016) === null, 'stepAim stops at a user input or out of orbit');
  const bo = viewOfCamera({ mode: 'orbit', orbit: { target: [10, 5, -20], yaw: 1, pitch: -0.4, dist: 800 } });
  ok(bo.x === 10 && bo.z === -20 && bo.yaw === 1 && bo.dist === 800, 'a bookmark of the orbit keeps its target, yaw, pitch and distance');
  const bf = viewOfCamera({ mode: 'fly', pos: [0, 100, 0], forward: [0, -Math.SQRT1_2, Math.SQRT1_2] }, () => 0);
  ok(Math.abs(bf.z - 100) < 20 && Math.abs(bf.x) < 1e-6 && near(forwardOf(bf.yaw + Math.PI, 0)[2], 1, 1e-9), 'a bookmark in fly mode takes the ground point ahead and the view direction', JSON.stringify(bf));
}

// ── pure: features, bookmarks, pixels
const N = 64, WS = 6400;
function synth() {
  const height = new Float32Array(N * N), biome = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * WS / N - WS / 2, z = (j + 0.5) * WS / N - WS / 2;
    const h = 1500 * Math.exp(-((x - 1000) ** 2 + (z + 800) ** 2) / (2 * 900 ** 2)) + 300 * Math.exp(-((x + 1500) ** 2 + (z - 1500) ** 2) / 8e5) - 120 + (x + WS / 2) * 0.03;
    height[j * N + i] = h; biome[j * N + i] = h < 0 ? 0 : h > 1100 ? 10 : 5;
  }
  return {
    n: N, worldSize: WS, seaLevel: 0, height, biome, stage: 'done',
    lakes: [{ level: 200, x: -1500, z: 1500, area: 2e5 }, { level: 120, x: 300, z: 300, area: 9e5 }],
    rivers: [
      { pts: new Float32Array([1000, -800, 0, -800, -1000, -900, -2500, -1000]), width: new Float32Array([2, 4, 8, 12]), flow: new Float32Array([1, 2, 4, 9]), end: 'sea' },
      { pts: new Float32Array([500, 500, 400, 400]), width: new Float32Array([2, 3]), flow: new Float32Array([1, 1.5]), end: 'join' },
    ],
    ridges: [{ pts: new Float32Array([0, 0, 500, -400, 1000, -800, 1500, -1200]) }],
  };
}
const BIOMES = [{ id: 0, name: 'Ocean', color: [0.11, 0.24, 0.42] }, ...Array.from({ length: 4 }, (_, i) => ({ id: i + 1, name: 'B' + i, color: [0.5, 0.5, 0.5] })),
  { id: 5, name: 'Temperate forest', color: [0.24, 0.42, 0.2] }, ...Array.from({ length: 4 }, (_, i) => ({ id: i + 6, name: 'C' + i, color: [0.5, 0.5, 0.5] })), { id: 10, name: 'Snow', color: [0.94, 0.95, 0.97] }];
{
  const T = synth(), F = findFeatures(T), by = Object.fromEntries(F.map(f => [f.id, f]));
  ok(by.peak && Math.hypot(by.peak.x - 1000, by.peak.z + 800) < WS / N * 1.5, 'features: the highest peak is at the top of the hill', JSON.stringify(by.peak));
  ok(by.lake && by.lake.x === 300 && by.lake.z === 300, 'features: the largest lake by area');
  ok(by.mouth && by.mouth.x === -2500 && by.mouth.z === -1000 && by.mouth.label === 'River mouth', 'features: the river mouth is the sea end of the river');
  ok(by.source && by.source.x === 1000 && by.ridge, 'features: the longest river source and the main ridge');
  ok(findFeatures(null).length === 0 && findFeatures({ ...T, lakes: [], rivers: [], ridges: [] }).map(f => f.id).join() === 'peak', 'features: a terrain with no lakes or rivers has the peak only');
  ok(terrainSig({ seed: 1, n: 512 }, 20000) === terrainSig({ n: 512, seed: 1 }, 20000) && terrainSig({ seed: 1 }, 20000) !== terrainSig({ seed: 2 }, 20000), 'the terrain id: the same options give the same id');

  const mem = new Map(), store = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const B1 = createBookmarks(store);
  const r1 = B1.add({ name: 'Ridge view', sig: 's1', x: 1, z: 2, yaw: 0.5, pitch: -0.3, dist: 900 });
  B1.add({ name: 'Other', sig: 's2', x: 3, z: 4 });
  const B2 = createBookmarks(store);
  ok(B2.list('s1').length === 1 && B2.list('s1')[0].name === 'Ridge view' && B2.all().length === 2 && B2.stored, 'bookmarks persist in the storage and are listed per terrain');
  ok(B2.remove(r1.id) && createBookmarks(store).list('s1').length === 0, 'a deleted bookmark is gone from the storage');
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  let threw = false, B3;
  try { B3 = createBookmarks(bad); B3.add({ name: 'x', sig: 's', x: 0, z: 0 }); B3.add({ name: 'y', sig: 's', x: 1, z: 1 }); } catch { threw = true; }
  ok(!threw && B3.list('s').length === 2 && !B3.stored, 'bookmarks survive a throwing storage (kept in memory, stored false)');
  let threw2 = false;
  try { const B4 = createBookmarks(() => { throw new Error('SecurityError'); }); B4.add({ sig: 's', x: 0, z: 0 }); ok(B4.list('s').length === 1, 'bookmarks survive a storage getter that throws'); } catch { threw2 = true; }
  ok(!threw2, 'no throw from a storage getter that throws');
  store.setItem('dla-terrain-bookmarks', '{bad json');
  ok(createBookmarks(store).all().length === 0, 'bad JSON in the storage gives an empty list');

  const sz = 64, R = renderLevel(T, sz, BIOMES, { colour: 'biome', shade: true, contours: true });
  const pxAt = (r, x, z) => { const i = Math.floor((x / WS + 0.5) * sz), j = Math.floor((z / WS + 0.5) * sz), o = (j * sz + i) * 4; return [r.px[o], r.px[o + 1], r.px[o + 2], r.px[o + 3]]; };
  const sea = pxAt(R, -3100, -3100), land = pxAt(R, -1500, 1500);
  ok(sea[2] > sea[0] + 40 && sea[3] === 255, 'pixels: the sea is blue', sea.join());
  ok(land[1] >= land[0] && land[1] >= land[2], 'pixels: the forest biome is green', land.join());
  ok(R.step > 0 && R.hi > 1300, 'pixels: contours on, with a step', `${R.step} ${R.hi}`);
  const E = renderLevel(T, sz, BIOMES, { colour: 'elev', shade: false });
  const lo = pxAt(E, -1500, 1500), hi = pxAt(E, 1000, -800);
  ok(hi[0] + hi[1] + hi[2] > lo[0] + lo[1] + lo[2] + 150, 'pixels: in elevation colours the peak is lighter than the low ground', lo.join() + ' / ' + hi.join());
  ok(renderLevel(null, 8).px.every(v => v === 0), 'pixels: no terrain gives an empty image');
}

// ── the real camera flies to a map point and turns to the aim
{
  const world = { heightAt: () => 0, size: 8000, seaLevel: -100, midH: 0 };
  const cam = createCamera({});
  cam.update(1, {}, world);
  const goal = [1800, -1200], yaw = aimYaw(-1, 0);   // look west
  cam.flyTo(goal[0], goal[1], world, 900);
  let aim = { yaw, pitch: -0.32, t0: 0 };
  for (let i = 0; i < 60 * 8; i++) { aim = stepAim(cam, aim, 1 / 60, -1); cam.update(1 / 60, {}, world); }
  const t = cam.orbit.target, f = cam.forward, h = Math.hypot(f[0], f[2]);
  ok(Math.hypot(t[0] - goal[0], t[2] - goal[1]) < 5, 'camera: the orbit target flies to the map point', JSON.stringify(t));
  ok(f[0] / h < -0.99, 'camera: the view turns to the aimed direction (west)', JSON.stringify(f));
  ok(cam.pos[1] > 0 + 2, 'camera: the eye stays over the ground', JSON.stringify(cam.pos));
}

// ── main.js hooks
{
  const src = readFileSync(here('main.js'), 'utf8');
  const loop = src.slice(src.indexOf('function loop('), src.indexOf('function viewShift('));
  ok(/app\.flyView = \(x, z, o = \{\}\) =>/.test(src) && /cam\.flyTo\(x, z, world, o\.dist\)/.test(src), 'main: app.flyView flies the camera.js orbit with the map distance');
  ok(loop.indexOf('stepAim(cam, app.aim') > -1 && loop.indexOf('stepAim(cam, app.aim') < loop.indexOf('cam.update(dt, inp, world)'), 'main: the aim turns the view before the camera update');
  ok(loop.indexOf('ui.mapCovers()') > -1 && loop.indexOf('ui.mapCovers()') < loop.indexOf('fg.render(frame)') && loop.indexOf('ui.mapCovers()') < loop.indexOf('if (!gpu) return;'), 'main: an open large map stops the GPU frame');
}

// ── jsdom
let JSDOM = null, VirtualConsole = null;
try {
  const d = process.env.JSDOM_DIR;
  if (d && existsSync(d + '/node_modules/jsdom')) ({ JSDOM, VirtualConsole } = await import(pathToFileURL(d + '/node_modules/jsdom/lib/api.js').href));
  else if (d && existsSync(d + '/lib/api.js')) ({ JSDOM, VirtualConsole } = await import(pathToFileURL(d + '/lib/api.js').href));
  else if (process.env.NODE_PATH) ({ JSDOM, VirtualConsole } = createRequire(process.env.NODE_PATH.split(':')[0] + '/')('jsdom'));
} catch { JSDOM = null; }

if (!JSDOM) {
  console.log('# mapview: jsdom not found (set JSDOM_DIR or NODE_PATH): the DOM checks are SKIPPED');
} else {
  const { PHONE_Q } = await import('../ui.js');
  const lib = await import('../gpu/stub-terrain.js');
  const html = readFileSync(here('index.html'), 'utf8').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
  const css = readFileSync(here('style.css'), 'utf8') + '\n' + readFileSync(here('map-view.css'), 'utf8');
  async function page({ w = 1440, h = 900, phone = false, dpr = 1, badStorage = false } = {}) {
    const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/dla-terrain/', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    const win = dom.window, doc = win.document;
    Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
    Object.defineProperty(win, 'devicePixelRatio', { value: dpr, configurable: true });
    if (badStorage) Object.defineProperty(win, 'localStorage', { get() { throw new win.DOMException('denied', 'SecurityError'); }, configurable: true });
    win.matchMedia = q => ({ matches: q === PHONE_Q ? phone : q === '(pointer:coarse)' ? phone : false, addEventListener() {}, removeEventListener() {} });
    // a 2D context that takes every call (jsdom has no canvas)
    const draws = { n: 0, drawImage: 0 };
    const ctx = new Proxy({}, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return () => ({ width: 10 }); return (...a) => { draws.n++; if (k === 'drawImage') draws.drawImage++; return undefined; }; }, set(t, k, v) { t[k] = v; return true; } });
    win.HTMLCanvasElement.prototype.getContext = () => ctx;
    Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode; }, configurable: true });
    const st = doc.createElement('style'); st.textContent = css; doc.head.append(st);
    const calls = [];
    const spy = name => (...a) => calls.push([name, ...a]);
    const cam = { mode: 'orbit', fovY: 0.87, pos: [0, 900, 2000], forward: [0, -0.4, -0.9], orbit: { target: [0, 0, 0], yaw: 0, pitch: -0.4, dist: 2200 } };
    const app = {
      lib, opts: { seed: 7, n: 64 }, preset: null, locks: new Set(), hist: null, cam,
      world: { heightAt: (x, z) => 100 + x * 0.01, size: WS, seaLevel: 0.4 },
      tod: 0.3, todSpeed: 0.1, playing: true, season: 0.35, latitude: 46, weatherId: 'fair', wxOver: {},
      camMode: 'orbit', qualityIndex: 0, layers: { grass: true, trees: true, props: true, water: true, clouds: true, rain: true },
      veg: { density: 1, conifer: 0.5, flowers: 0.5 }, water: { tint: 0.35, waves: 0.4 }, look: { ev: 0, bloom: 0.045, fov: 50, shafts: 'auto', shaftK: 1 },
      flyTo: spy('flyTo'), flyView: spy('flyView'),
    };
    for (const k of ['setOpt', 'generate', 'randomise', 'randomiseAll', 'toggleLock', 'applyPreset', 'nextPreset', 'setTod', 'setWeather', 'setPlaying', 'setCam', 'drone', 'setQuality', 'setLayer', 'setLook', 'setMix', 'historyStep', 'copyLink', 'clearWxOver', 'setWxOver', 'onLayout']) app[k] = spy(k);
    const { createUI } = await import('../ui.js');
    const U = createUI(app, doc);
    const T = synth();
    U.setTerrainMap({ ...T }, BIOMES, T);
    const winKeys = [];
    win.addEventListener('keydown', e => winKeys.push(e.code));
    return { dom, win, doc, U, app, calls, cam, draws, winKeys, T, $: id => doc.getElementById(id) };
  }
  const key = (P, code, key, target) => { const e = new P.win.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }); (target || P.doc.body).dispatchEvent(e); return e; };
  const ptr = (P, type, x, y, o = {}) => { const e = new P.win.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, shiftKey: !!o.shift }); Object.defineProperty(e, 'pointerId', { value: o.id || 1 }); P.$('atCanvas').dispatchEvent(e); };
  const run = ms => new Promise(r => setTimeout(r, ms));

  // desktop
  {
    const P = await page({ dpr: 2 });
    const mv = P.U.mapView, atlas = P.$('atlas');
    ok(atlas && atlas.hidden && !mv.isOpen && P.win.getComputedStyle(atlas).display === 'none', 'jsdom: the large map is made and hidden at the start');
    // the inset at the device pixel ratio, with a hint
    P.U.drawMap(P.cam);
    ok(P.$('mapCanvas').width === 440 && P.draws.drawImage > 0, 'jsdom: the inset draws at the device pixel ratio (220 css px x 2)', `${P.$('mapCanvas').width}`);
    ok(P.$('map').querySelector('.map-hint') && /expand/i.test(P.$('map').querySelector('.map-hint').textContent) && P.$('mapCanvas').tabIndex === 0 && /large map/.test(P.$('mapCanvas').getAttribute('aria-label')),
      'jsdom: the inset has the hint "Click to expand", is focusable and has an aria label');
    // click opens, Esc closes
    P.$('mapCanvas').click();
    ok(mv.isOpen && !atlas.hidden && P.U.mapCovers(), 'jsdom: a click on the inset opens the large map (and stops the GPU frame)');
    await run(60);
    ok(atlas.classList.contains('on'), 'jsdom: the open animation class is set after the first frames');
    ok(P.$('atClose') && /Esc/.test(P.$('atClose').getAttribute('aria-label')) && atlas.getAttribute('role') === 'dialog' && atlas.getAttribute('aria-modal') === 'true', 'jsdom: a close button, a dialog role');
    P.winKeys.length = 0;
    key(P, 'KeyW', 'w', P.$('atCanvas'));
    ok(P.winKeys.length === 0, 'jsdom: while the map is open, the camera keys do not reach the page');
    key(P, 'Escape', 'Escape', P.$('atCanvas'));
    ok(!mv.isOpen && !P.U.mapCovers() && !atlas.classList.contains('on'), 'jsdom: Esc closes the large map');
    await run(300);
    ok(atlas.hidden, 'jsdom: after the close animation the map is hidden');
    key(P, 'KeyM', 'm');
    ok(mv.isOpen, 'jsdom: M opens the large map');
    key(P, 'KeyM', 'm', P.$('atCanvas'));
    ok(!mv.isOpen, 'jsdom: M closes it');
    const inp = P.doc.createElement('input'); P.doc.body.append(inp);
    key(P, 'KeyM', 'm', inp);
    ok(!mv.isOpen, 'jsdom: M in a text field does not open the map');
    P.$('mapCanvas').dispatchEvent(new P.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok(mv.isOpen, 'jsdom: Enter on the focused inset opens the map');
    P.$('atClose').click();
    ok(!mv.isOpen, 'jsdom: the close button closes it');

    // a click flies to the right world point
    mv.open();
    const v = { cx: 500, cz: -300, k: 0.2, w: 1000, h: 700 };
    mv.view = v;
    P.calls.length = 0;
    ptr(P, 'pointerdown', 640, 210); ptr(P, 'pointerup', 640, 210);
    const want = toWorld(640, 210, v), fl = P.calls.find(c => c[0] === 'flyView');
    ok(fl && near(fl[1], want[0], 1e-6) && near(fl[2], want[1], 1e-6), 'jsdom: a click on the large map flies the camera to that world point', JSON.stringify(fl) + ' want ' + JSON.stringify(want));
    ok(!mv.isOpen, 'jsdom: a flight closes the large map');
    // a drag pans and does not fly
    mv.open(); mv.view = { ...v };
    P.calls.length = 0;
    ptr(P, 'pointerdown', 500, 350); ptr(P, 'pointermove', 530, 350); ptr(P, 'pointermove', 550, 330); ptr(P, 'pointerup', 550, 330);
    const pv = mv.view;
    ok(!P.calls.some(c => c[0] === 'flyView') && near(pv.cx, v.cx - 50 / v.k, 1e-6) && near(pv.cz, v.cz + 20 / v.k, 1e-6) && mv.isOpen, 'jsdom: a drag pans the map (no flight)', JSON.stringify(pv));
    // the pointer readout
    ptr(P, 'pointermove', 400, 400);
    ok(/km [EW], .*km [NS] · \d+ m/.test(mv.debug().read), 'jsdom: the readout shows the place and the height under the pointer', mv.debug().read);
    // Shift + drag aims: fly to the press point, face the drag direction
    mv.view = { ...v };
    P.calls.length = 0;
    ptr(P, 'pointerdown', 300, 300, { shift: true }); ptr(P, 'pointermove', 300, 360, { shift: true }); ptr(P, 'pointerup', 300, 380, { shift: true });
    const fa = P.calls.find(c => c[0] === 'flyView'), wa = toWorld(300, 300, v);
    const fwd = fa && forwardOf(fa[3].yaw + Math.PI, 0);
    ok(fa && near(fa[1], wa[0], 1e-6) && near(fa[2], wa[1], 1e-6) && fwd[2] > 0.99, 'jsdom: Shift + drag flies to the press point and faces the drag (south)', JSON.stringify(fa));
    // a hold then a drag aims too
    mv.open(); mv.view = { ...v }; P.calls.length = 0;
    ptr(P, 'pointerdown', 600, 300); await run(450); ptr(P, 'pointermove', 660, 300); ptr(P, 'pointerup', 680, 300);
    const fh = P.calls.find(c => c[0] === 'flyView');
    ok(fh && fh[3] && fh[3].yaw != null && forwardOf(fh[3].yaw + Math.PI, 0)[0] > 0.99, 'jsdom: a hold, then a drag east, aims east', JSON.stringify(fh));
    // the wheel zooms about the cursor
    mv.open(); mv.view = { ...v };
    const before = toWorld(250, 500, mv.view);
    const we = new P.win.WheelEvent('wheel', { deltaY: -200, clientX: 250, clientY: 500, bubbles: true, cancelable: true });
    P.$('atCanvas').dispatchEvent(we);
    const after = toWorld(250, 500, mv.view);
    ok(mv.view.k > v.k && Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-6 && we.defaultPrevented, 'jsdom: the wheel zooms in about the cursor', JSON.stringify(mv.view));
    // + and - and Fit
    const k0 = mv.view.k; P.$('atIn').click(); const k1 = mv.view.k; P.$('atOut').click(); P.$('atOut').click();
    ok(k1 > k0 && mv.view.k < k1, 'jsdom: the + and - buttons zoom');
    P.$('atFit').click();
    ok(near(mv.view.cx, 0) && near(mv.view.cz, 0), 'jsdom: Fit shows the whole terrain');
    key(P, 'ArrowRight', 'ArrowRight', P.$('atCanvas'));
    ok(mv.view.cx > 0, 'jsdom: an arrow key pans the map');
    // "Go to"
    const feats = [...P.$('atFeat').querySelectorAll('button[data-feat]')].map(b => b.dataset.feat);
    ok(feats.join() === 'peak,lake,mouth,source,ridge', 'jsdom: the Go to buttons: peak, lake, mouth, source, ridge', feats.join());
    P.calls.length = 0;
    P.$('atFeat').querySelector('[data-feat="lake"]').click();
    const fl2 = P.calls.find(c => c[0] === 'flyView');
    ok(fl2 && fl2[1] === 300 && fl2[2] === 300 && fl2[3].dist > 0 && !mv.isOpen, 'jsdom: "Largest lake" flies there and closes the map', JSON.stringify(fl2));
    // bookmarks in localStorage
    mv.open();
    P.$('atSave').click();
    const items = P.$('atMarks').querySelectorAll('button[data-mark]');
    const stored = JSON.parse(P.win.localStorage.getItem('dla-terrain-bookmarks') || '[]');
    ok(items.length === 1 && stored.length === 1 && stored[0].x === 0 && stored[0].dist === 2200, 'jsdom: "Save this view" lists the view and writes it to localStorage', JSON.stringify(stored));
    P.calls.length = 0;
    items[0].click();
    const fb = P.calls.find(c => c[0] === 'flyView');
    ok(fb && fb[3].yaw === 0 && fb[3].pitch === -0.4 && fb[3].dist === 2200, 'jsdom: a bookmark flies back to its pose', JSON.stringify(fb));
    mv.open();
    const P2b = createBookmarks(P.win.localStorage);
    ok(P2b.list(mv.debug().sig).length === 1, 'jsdom: the bookmark is there for a new page of the same terrain');
    P.$('atMarks').querySelector('button[data-del]').click();
    ok(P.$('atMarks').querySelectorAll('button[data-mark]').length === 0 && JSON.parse(P.win.localStorage.getItem('dla-terrain-bookmarks')).length === 0, 'jsdom: the delete button removes it');
    // legend and layers
    ok(P.$('atLegend').textContent.includes('Temperate forest') && P.$('atLegend').textContent.includes('Rivers') && P.$('atLegend').textContent.includes('Lakes'), 'jsdom: the legend lists the biomes of this terrain, rivers and lakes');
    P.$('atlas').querySelector('[data-colour="elev"]').click();
    P.$('atlas').querySelector('[data-layer="contours"]').click();
    ok(mv.debug().layers.colour === 'elev' && mv.debug().layers.contours && /Contours every \d+ m/.test(P.$('atLegend').textContent), 'jsdom: elevation colours and contours switch on, with a legend row');
    ok(P.win.getComputedStyle(P.$('atlas').querySelector('.at-box')).left !== '0px', 'jsdom: on a desktop the map is a box, not the full screen');
    // the saver
    mv.close();
    P.doc.documentElement.classList.add('sn-saver');
    key(P, 'KeyM', 'm');
    ok(!mv.isOpen, 'jsdom: M does not open the map in the screensaver');
    P.doc.documentElement.classList.remove('sn-saver');
    mv.open();
    P.doc.documentElement.classList.add('sn-saver');
    ok(P.win.getComputedStyle(P.$('atlas')).display === 'none' && P.win.getComputedStyle(P.$('map')).display === 'none', 'jsdom: the large map and the inset are hidden in the screensaver', P.win.getComputedStyle(P.$('atlas')).display + ' ' + P.win.getComputedStyle(P.$('map')).display);
    P.U.drawMap(P.cam);
    ok(!mv.isOpen && !P.U.mapCovers(), 'jsdom: the screensaver closes the large map, so the GPU frames run');
    P.win.close();
  }
  // phone, and a localStorage that throws
  {
    const P = await page({ w: 390, h: 844, phone: true, dpr: 3, badStorage: true });
    const mv = P.U.mapView;
    P.$('mapCanvas').click();
    const box = P.$('atlas').querySelector('.at-box'), cs = P.win.getComputedStyle(box);
    ok(mv.isOpen && P.$('atlas').classList.contains('full') && cs.left === '0px' && cs.top === '0px' && cs.right === '0px' && cs.bottom === '0px', 'jsdom phone: the large map fills the screen', `${cs.left} ${cs.top} ${cs.right} ${cs.bottom}`);
    ok(/min-width:44px;height:44px/.test(readFileSync(here('map-view.css'), 'utf8')) && /\.atlas\.full \.at-chip[^{]*\{min-height:44px\}/.test(readFileSync(here('map-view.css'), 'utf8')), 'jsdom phone: 44 px targets in the full-screen map');
    let threw = false;
    try { P.$('atSave').click(); } catch { threw = true; }
    ok(!threw && P.$('atMarks').querySelectorAll('button[data-mark]').length === 1 && !P.$('atMarkNote').hidden && /does not keep/.test(P.$('atMarkNote').textContent), 'jsdom phone: with a throwing localStorage a bookmark still saves for this visit, and says so');
    // a tap flies on a phone too
    mv.view = { cx: 0, cz: 0, k: 0.06, w: 390, h: 500 };
    P.calls.length = 0;
    ptr(P, 'pointerdown', 100, 100); ptr(P, 'pointerup', 102, 101);
    const f = P.calls.find(c => c[0] === 'flyView'), w = toWorld(100, 100, { cx: 0, cz: 0, k: 0.06, w: 390, h: 500 });
    ok(f && near(f[1], w[0], 1e-6) && near(f[2], w[1], 1e-6), 'jsdom phone: a tap (a 2 px jitter) flies to that point', JSON.stringify(f));
    // pinch zoom
    mv.open(); mv.view = { cx: 0, cz: 0, k: 0.06, w: 390, h: 500 }; P.calls.length = 0;
    ptr(P, 'pointerdown', 150, 250, { id: 1 }); ptr(P, 'pointerdown', 250, 250, { id: 2 });
    ptr(P, 'pointermove', 100, 250, { id: 1 }); ptr(P, 'pointermove', 300, 250, { id: 2 });
    ptr(P, 'pointerup', 100, 250, { id: 1 }); ptr(P, 'pointerup', 300, 250, { id: 2 });
    ok(near(mv.view.k, 0.12, 1e-9) && mv.isOpen && !P.calls.some(c => c[0] === 'flyView'), 'jsdom phone: a pinch to twice the finger gap zooms in 2 x and does not fly', JSON.stringify(mv.view));
    P.win.close();
  }
}

console.log(`# mapview: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
