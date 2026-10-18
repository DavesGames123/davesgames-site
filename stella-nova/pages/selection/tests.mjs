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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
