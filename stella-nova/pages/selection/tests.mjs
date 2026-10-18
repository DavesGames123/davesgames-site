// ============================================================================
//  SELECTION  ·  node tests (no browser):  node tests.mjs
// ----------------------------------------------------------------------------
//  Needs jsdom 24 (npm i jsdom@24.1.3 in a scratch folder, then give that
//  folder as JSDOM_DIR or NODE_PATH). Without jsdom the run FAILS, so a
//  missing jsdom cannot look like a pass.
//
//  The page runs in jsdom with a stub 2D context (jsdom has no canvas) and
//  stub images that load at once. The stage rect is the viewport size.
//
//  SECTIONS  (grep -n "section('" tests.mjs)
//    lesson logic ....... click and box ladders, modifier, category lock,
//                         empty clicks, station split with hysteresis
//    lighting ........... light.js: sunDir points at the sun, a sprite and
//                         a planet are brightest toward the sun (also when
//                         rotated), shadows are not black, bevel normals,
//                         seeded rock-coloured asteroids
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SN = path.join(HERE, '../..');
const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try {
  const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
  ({ JSDOM, VirtualConsole } = require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })));
} catch (e) {
  console.log('tests: FAIL, jsdom not found (set JSDOM_DIR or NODE_PATH)');
  process.exit(1);
}

let pass = 0, fail = 0, cur = '';
function section(name) { cur = name; console.log('-- ' + name); }
function ok(cond, name, info = '') {
  if (cond) pass++; else { fail++; console.log(`FAIL [${cur}] ${name}${info !== '' ? ' ' + info : ''}`); }
}

// ── page harness ──────────────────────────────────────────────────────────
// A stub 2D context. Every method is a no-op that the log counts; the few
// that must return a value return a plain object of the right shape.
function stubContext(canvas, log) {
  const grad = { addColorStop() {} };
  const fixed = {
    canvas,
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }),
    createImageData: (w, h) => (typeof w === 'object' ? { width: w.width, height: w.height, data: new Uint8ClampedArray(w.width * w.height * 4) } : { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    createPattern: () => ({}), measureText: t => ({ width: String(t).length * 6 }),
    getLineDash: () => [], isPointInPath: () => false, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  };
  const props = {};
  return new Proxy({}, {
    get(_, k) {
      if (k in fixed) { return (...a) => { log[k] = (log[k] || 0) + 1; return typeof fixed[k] === 'function' ? fixed[k](...a) : fixed[k]; }; }
      if (k in props) return props[k];
      if (typeof k === 'symbol') return undefined;
      return (...a) => { log[k] = (log[k] || 0) + 1; log.calls && log.calls.push([k, a]); };
    },
    set(_, k, v) { props[k] = v; if (k === 'strokeStyle' || k === 'fillStyle') (log.styles = log.styles || []).push(v); return true; }
  });
}

// Boot the page at a viewport. touch = (hover: none). Returns the window,
// the test hook, the error list and the draw log.
async function bootPage(w, h, touch = false, settleMs = 120) {
  const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').replace(/<script\b[^>]*><\/script>/g, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && e.message || e)));
  vc.on('error', e => errors.push(String(e)));
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/selection/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
  const win = dom.window;
  win.innerWidth = w; win.innerHeight = h;
  win.devicePixelRatio = touch ? 2 : 1;
  const stageW = w > 900 ? w - 340 : w;
  win.matchMedia = q => ({ matches: /hover:\s*none/.test(q) ? touch : /max-width:\s*900/.test(q) ? w <= 900 : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const R = (l, t, ww, hh) => ({ left: l, top: t, width: ww, height: hh, right: l + ww, bottom: t + hh, x: l, y: t });
  win.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'stage' || this.id === 'cv') return R(0, 0, stageW, h);
    if (this.id === 'hint') return R(20, 64, stageW - 40, 40);
    if (this.id === 'dock') return R(20, h - 70, stageW - 40, 56);
    return R(0, 0, 0, 0);
  };
  const log = {};
  win.HTMLCanvasElement.prototype.getContext = function () { return this.__ctx || (this.__ctx = stubContext(this, log)); };
  // Images load at once with a fixed size, so every draw path runs.
  win.Image = class {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; this.onerror = null; }
    set src(v) { this._src = v; setTimeout(() => { this.complete = true; this.naturalWidth = this.width = 64; this.naturalHeight = this.height = 64; this.onload && this.onload(); }, 1); }
    get src() { return this._src; }
  };
  win.onerror = (m, s, l, c, e) => { errors.push(String(e && e.stack || m)); };
  const run = rel => {
    try { win.eval(fs.readFileSync(path.join(SN, rel), 'utf8') + '\n//# sourceURL=' + rel); }
    catch (e) { errors.push(rel + ': ' + (e && e.stack || e)); }
  };
  const srcs = [...fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  for (const s of srcs) {
    if (/gpu-guard|wishlist|stats-beacon/.test(s)) continue;   // shell scripts, not this page
    run(path.relative(SN, path.resolve(HERE, s)));
  }
  await new Promise(r => setTimeout(r, settleMs));
  return { win, api: win.__snSelection, errors, log, dom };
}

// ── lesson logic ──────────────────────────────────────────────────────────
// A scripted scene: the entities are placed by hand so each case is exact.
{
  section('lesson logic');
  const { win, api, errors } = await bootPage(1440, 900, false);
  ok(api && typeof api.doClick === 'function', 'test hook present');
  const mk = (t, x, y) => { const e = api.make(t, x, y); e.vx = e.vy = e.spin = 0; return e; };
  const sel = () => api.ents().filter(e => e.sel);
  const types = () => [...new Set(sel().map(e => e.type))];
  const reset = list => { api.loadLesson(0); api.setEnts(list); api.S.cam = { x: 0, y: 0, z: 1 }; api.S.split = false; };
  // Camera at world 0,0 with zoom 1: toWorld(toScreen(p)) == p.
  const v = api.view();
  ok(v.W > 0 && v.H > 0, 'stage measured', JSON.stringify(v));

  // Click ladder: a ship on a planet, an asteroid on a planet.
  const planet = mk('planet', 0, 0), ship = mk('ship', 4, 2), rock = mk('asteroid', 200, 0), p2 = mk('planet', 200, 4);
  reset([planet, ship, rock, p2]);
  api.doClick(4, 2, false);
  ok(ship.sel && sel().length === 1, 'click: ship on planet takes the ship');
  api.doClick(200, 0, false);
  ok(rock.sel === false && p2.sel === true, 'click: planet beats asteroid (planet rank 3, asteroid rank 6)');
  ok(!ship.sel, 'click: new pick replaces the old one');

  // Every click rank in order: put one of each type at one point.
  const all = Object.keys(api.TYPES).filter(t => t !== 'module');
  const stack = all.map(t => mk(t, 500, 500));
  reset(stack);
  const order = [];
  for (let i = 0; i < all.length; i++) {
    const w = api.clickWinner(500, 500);
    order.push(w.type);
    api.setEnts(api.ents().filter(e => e !== w));
  }
  const want = all.slice().sort((a, b) => api.TYPES[a].click - api.TYPES[b].click);
  ok(JSON.stringify(order) === JSON.stringify(want), 'click ladder order', order.join('<'));

  // Box ladder: the planet takes the whole box over a planet and ships.
  const bp = mk('planet', 0, 0), bs = [mk('ship', 50, 0), mk('ship', -50, 0)], ba = mk('asteroid', 0, 60);
  reset([bp, ...bs, ba]);
  api.doBox({ x1: -100, y1: -100, x2: 100, y2: 100 }, false);
  ok(bp.sel && !bs[0].sel && !ba.sel, 'box: planet wins over ships and asteroids');
  api.doBox({ x1: -90, y1: -10, x2: -45, y2: 10 }, false);
  ok(bs[1].sel && !bp.sel, 'box: only ships in the box -> ships');
  api.doBox({ x1: -10, y1: 40, x2: 10, y2: 80 }, false);
  ok(ba.sel && sel().length === 1, 'box: asteroid alone');
  // A box with ships and asteroids only takes the ships.
  const s3 = mk('ship', 0, 300), a3 = mk('asteroid', 30, 300), a4 = mk('asteroid', -30, 300);
  reset([s3, a3, a4]);
  api.doBox({ x1: -60, y1: 280, x2: 60, y2: 320 }, false);
  ok(s3.sel && !a3.sel && !a4.sel, 'box: ships beat asteroids');

  // Modifier: add, then remove one.
  const m1 = mk('ship', 0, 0), m2 = mk('ship', 100, 0), m3 = mk('ship', 200, 0), mr = mk('asteroid', 300, 0);
  reset([m1, m2, m3, mr]);
  api.doClick(0, 0, false); api.doClick(100, 0, true); api.doClick(200, 0, true);
  ok(sel().length === 3, 'modifier: three ships added', sel().length);
  api.doClick(100, 0, true);
  ok(sel().length === 2 && !m2.sel, 'modifier: click on a selected ship removes it');
  api.doClick(500, 500, true);
  ok(sel().length === 2, 'modifier: empty click keeps the selection');

  // Category lock: a new type replaces the old one, with or without modifier.
  api.doClick(300, 0, true);
  ok(types().join() === 'asteroid' && sel().length === 1, 'lock: modifier click on asteroid drops the ships');
  api.doClick(0, 0, false); api.doClick(100, 0, true);
  api.doBox({ x1: 280, y1: -20, x2: 320, y2: 20 }, true);
  ok(types().join() === 'asteroid', 'lock: modifier box of another type replaces');
  api.doClick(500, 500, false);
  ok(sel().length === 0, 'empty click clears');

  // Station split: station below SPLIT_IN, modules above, hysteresis.
  api.loadLesson(5);
  const st = api.S.station;
  ok(!!st, 'modules lesson has a station');
  const mods = api.ents().filter(e => e.type === 'module');
  ok(mods.length === 9, 'station has nine modules', mods.length);
  api.zoomAt(api.view().W / 2, api.view().H / 2, 1);
  api.doClick(st.x, st.y, false);
  ok(st.sel && types().join() === 'station', 'low zoom: click takes the station');
  const sc = api.toScreen(st.x, st.y);
  api.zoomAt(sc.x, sc.y, api.SPLIT_IN + 0.05);
  ok(api.S.split === true, 'split above SPLIT_IN');
  ok(!st.sel, 'split drops the station selection');
  api.doClick(mods[4].x, mods[4].y, false);
  ok(mods[4].sel && types().join() === 'module', 'high zoom: click takes a module');
  const sc2 = api.toScreen(st.x, st.y);
  api.zoomAt(sc2.x, sc2.y, (api.SPLIT_IN + api.SPLIT_OUT) / 2);
  ok(api.S.split === true, 'hysteresis: stays split between SPLIT_OUT and SPLIT_IN');
  api.zoomAt(sc2.x, sc2.y, api.SPLIT_OUT - 0.05);
  ok(api.S.split === false && !mods[4].sel, 'joins below SPLIT_OUT and drops modules');

  // Every lesson sets up without error and has entities.
  for (let i = 0; i < api.LESSONS.length; i++) {
    api.loadLesson(i);
    ok(api.ents().length > 5, 'lesson ' + (i + 1) + ' has entities', api.ents().length);
  }
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
  win.close();
}

// ── lighting ──────────────────────────────────────────────────────────────
// Pure functions of light.js: the light points from each entity to the one
// sun, and the shaded result is brightest on the side that faces the sun.
{
  section('lighting');
  const L = require('./light.js');
  const angle = (ax, ay, bx, by) => Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI;
  // A brightness-weighted centroid of an RGBA buffer, from the centre.
  const centroid = (buf, w, h) => {
    let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4; if (!buf[k + 3]) continue;
      const b = (buf[k] + buf[k + 1] + buf[k + 2]) / 3;
      sx += b * (x + 0.5 - w / 2); sy += b * (y + 0.5 - h / 2); sw += b;
    }
    return { x: sx / sw, y: sy / sw };
  };
  // sunDir: unit length, plane part points from the entity to the sun.
  const rnd = L.mulberry(7);
  let worst = 0, unit = 0;
  for (let i = 0; i < 200; i++) {
    const ex = rnd() * 2000 - 1000, ey = rnd() * 2000 - 1000, sx = rnd() * 2000 - 1000, sy = rnd() * 2000 - 1000;
    const d = L.sunDir(ex, ey, sx, sy);
    worst = Math.max(worst, angle(d.x, d.y, sx - ex, sy - ey));
    unit = Math.max(unit, Math.abs(Math.hypot(d.x, d.y, d.z) - 1));
  }
  ok(worst < 1e-6, 'sunDir plane part points at the sun', worst);
  ok(unit < 1e-9, 'sunDir is a unit vector', unit);
  ok(Math.abs(L.sunDir(0, 0, 5, 0).z - Math.sin(L.ELEV)) < 1e-12, 'sun sits ELEV over the plane');

  // A dome sprite (hemisphere normals, flat grey albedo).
  const N = 64, rgba = new Uint8ClampedArray(N * N * 4), nrm = new Float32Array(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x, px = (x + 0.5 - N / 2) / (N / 2 - 1), py = (y + 0.5 - N / 2) / (N / 2 - 1), r2 = px * px + py * py;
    if (r2 >= 1) continue;
    rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = 150; rgba[k * 4 + 3] = 255;
    const pz = Math.sqrt(1 - r2); nrm[k * 3] = px; nrm[k * 3 + 1] = py; nrm[k * 3 + 2] = pz;
  }
  let worstDome = 0, worstRot = 0, darkest = 255;
  for (const mat of ['hull', 'module', 'rock']) {
    for (let i = 0; i < 16; i++) {
      // the entity at the origin, the sun on a ring round it
      const a = i / 16 * 2 * Math.PI, sun = { x: Math.cos(a) * 500, y: Math.sin(a) * 500 };
      const Lw = L.sunDir(0, 0, sun.x, sun.y);
      const c = centroid(L.shade(rgba, nrm, N, N, Lw, L.MATERIALS[mat]), N, N);
      worstDome = Math.max(worstDome, angle(c.x, c.y, sun.x, sun.y));
      // the same sprite drawn with a rotation: shade with the local light,
      // then turn the centroid by the draw rotation
      const rot = i * 0.7 + 0.3, Ll = L.localLight(Lw, rot);
      const out = L.shade(rgba, nrm, N, N, Ll, L.MATERIALS[mat]);
      const cl = centroid(out, N, N), cw = { x: cl.x * Math.cos(rot) - cl.y * Math.sin(rot), y: cl.x * Math.sin(rot) + cl.y * Math.cos(rot) };
      worstRot = Math.max(worstRot, angle(cw.x, cw.y, sun.x, sun.y));
      for (let k = 0; k < N * N; k++) if (out[k * 4 + 3]) darkest = Math.min(darkest, out[k * 4], out[k * 4 + 1], out[k * 4 + 2]);
    }
  }
  ok(worstDome < 3, 'sprite: lit side faces the sun (deg)', worstDome.toFixed(2));
  ok(worstRot < 3, 'rotated sprite: lit side faces the sun after the draw rotation (deg)', worstRot.toFixed(2));
  ok(darkest > 0, 'sprite: shadow side is never pure black', darkest);

  // lightBin covers the circle and blends between neighbours.
  const b = L.lightBin(-0.01, 32);
  ok(b.i0 === 31 && b.i1 === 0 && b.f > 0.9, 'lightBin wraps below zero', JSON.stringify(b));
  const b2 = L.lightBin(Math.PI, 32);
  ok(b2.i0 === 16 && Math.abs(b2.f) < 1e-9, 'lightBin of pi is bin 16');
  ok(Math.abs(L.binLight(8, 32).az - Math.PI / 2) < 1e-12, 'binLight gives the bin angle');

  // Sprite normals: a filled square bevels outward at its edges.
  const sq = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) { const k = (y * 32 + x) * 4; sq[k] = sq[k + 1] = sq[k + 2] = 128; sq[k + 3] = 255; }
  const hs = L.spriteHeight(sq, 32, 32, { bevel: 6, detail: 0 }), sn = L.normalsFromHeight(hs.height, 32, 32, 1);
  const at = (x, y) => [sn[(y * 32 + x) * 3], sn[(y * 32 + x) * 3 + 1], sn[(y * 32 + x) * 3 + 2]];
  ok(at(5, 16)[0] < -0.2 && at(26, 16)[0] > 0.2, 'bevel normals point out at the left and right edges', at(5, 16)[0].toFixed(2) + ' ' + at(26, 16)[0].toFixed(2));
  ok(at(16, 5)[1] < -0.2 && at(16, 26)[1] > 0.2, 'bevel normals point out at the top and bottom edges');
  ok(at(16, 16)[2] > 0.99, 'flat top faces the viewer');

  // Planets: the day side faces the sun; the night side is dark but not black.
  const tex = { w: 256, h: 128, data: new Uint8ClampedArray(256 * 128 * 4).fill(140) };
  const T = L.planetTable(80, 0.3);
  let worstP = 0, nightMin = 255, dayNight = Infinity;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * 2 * Math.PI, sun = { x: Math.cos(a) * 900, y: Math.sin(a) * 900 };
    const Lp = L.sunDir(0, 0, sun.x, sun.y, L.ELEV_PLANET);
    const out = L.shadePlanet(T, tex, null, i * 0.07, Lp, null, 0);
    const c = centroid(out, T.B, T.B);
    worstP = Math.max(worstP, angle(c.x, c.y, sun.x, sun.y));
    // a point near the limb toward the sun against one away from it
    const R = T.D / 2, o = T.B / 2;
    const px = (sx, sy) => { const k = (Math.round(o + sy * R * 0.7) * T.B + Math.round(o + sx * R * 0.7)) * 4; return out[k]; };
    const day = px(Math.cos(a), Math.sin(a)), night = px(-Math.cos(a), -Math.sin(a));
    dayNight = Math.min(dayNight, day - night);
    nightMin = Math.min(nightMin, night);
  }
  ok(worstP < 3, 'planet: day side faces the sun (deg)', worstP.toFixed(2));
  ok(dayNight > 80, 'planet: day side much brighter than night side', dayNight);
  ok(nightMin > 0, 'planet: night side is not pure black', nightMin);

  // Asteroids: seeded, rock coloured (low saturation), lumpy, opaque core.
  const A1 = L.asteroid(3, 64), A2 = L.asteroid(3, 64), A3 = L.asteroid(4, 64);
  ok(A1.rgba.every((v, i) => v === A2.rgba[i]), 'asteroid: same seed, same rock');
  ok(A1.rgba.some((v, i) => v !== A3.rgba[i]), 'asteroid: new seed, new rock');
  let maxSat = 0, opaque = 0;
  for (let s = 1; s <= 24; s++) {
    const A = L.asteroid(s, 48);
    let r = 0, g = 0, bl = 0, n = 0;
    for (let k = 0; k < 48 * 48; k++) if (A.rgba[k * 4 + 3] > 200) { r += A.rgba[k * 4]; g += A.rgba[k * 4 + 1]; bl += A.rgba[k * 4 + 2]; n++; }
    r /= n; g /= n; bl /= n;
    maxSat = Math.max(maxSat, (Math.max(r, g, bl) - Math.min(r, g, bl)) / Math.max(r, g, bl));
    opaque = Math.max(opaque, n / (48 * 48));
  }
  ok(maxSat < 0.42, 'asteroid: natural rock tones, no candy colours (max saturation)', maxSat.toFixed(2));
  ok(opaque > 0.25 && opaque < 0.75, 'asteroid: a body with a clear outline (fill ratio)', opaque.toFixed(2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
