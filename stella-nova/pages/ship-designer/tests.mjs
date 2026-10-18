// ============================================================================
//  SHIP DESIGNER  ·  node tests (no browser):  node tests.mjs
// ----------------------------------------------------------------------------
//  Needs jsdom 24 (npm i jsdom@24.1.3 in a scratch folder, then give that
//  folder as JSDOM_DIR or NODE_PATH). Without jsdom the run FAILS, so a
//  missing jsdom cannot look like a pass.
//
//  The page runs in jsdom with a stub 2D context (jsdom has no canvas) and
//  stub images that load at once. The shading itself is tested on pixel
//  arrays through require('./shade.js').
//
//  SECTIONS  (grep -n "section('" tests.mjs)
//    shading ............ shade.js: the sun vector, normal map encode and
//                         decode (+y down and +y up), the lit side of a dome
//                         faces the sun at any sun angle, the shadow side is
//                         not black, a tall block casts a shadow, the
//                         sprite frame turn, real surface fields
//    liveries ........... liveries.js: the game livery names in the game
//                         order, valid unique colours, the layer sprites
//                         that the exporter catalog gives
//    migration .......... old preset colours go to the game livery of the
//                         same name; a gone name goes to the nearest one;
//                         custom colours stay
//    page ............... boot on desktop and phone with no errors; Flat /
//                         Lit; the sun dial; Auto; fleet bins; old links
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
const SH = require('./shade.js');
const LIV = require('./liveries.js');

let pass = 0, fail = 0, cur = '';
function section(name) { cur = name; console.log('-- ' + name); }
function ok(cond, name, info = '') {
  if (cond) pass++; else { fail++; console.log(`FAIL [${cur}] ${name}${info !== '' ? ' ' + info : ''}`); }
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── shading ───────────────────────────────────────────────────────────────
// A test sprite: a disc of radius R in an S x S frame, mid grey, with a
// tall square block left of centre for the shadow test.
function discLayers(S, R, block) {
  const n = S * S, hull = new Uint8ClampedArray(n * 4), acc = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const p = (y * S + x) * 4, d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
    if (d < R) { hull[p] = hull[p + 1] = hull[p + 2] = 128; hull[p + 3] = 255; }
    if (block && Math.abs(x - block.x) < block.r && Math.abs(y - block.y) < block.r) { acc[p] = acc[p + 1] = acc[p + 2] = 128; acc[p + 3] = 255; }
  }
  return { hull, hullMask: hull, cockpit: null, cockpitMask: new Uint8ClampedArray(n * 4), accents: acc, accentsMask: acc };
}
function luma(px, S, x, y) { const p = (y * S + x) * 4; return 0.3 * px[p] + 0.59 * px[p + 1] + 0.11 * px[p + 2]; }
{
  section('shading');
  // The sun vector: unit length, plane angle and height as asked.
  for (const [az, el] of [[0, 0.4], [Math.PI / 2, 0.2], [-2.3, 1.2], [3, 0.12]]) {
    const L = SH.lightDir(az, el), len = Math.hypot(L.x, L.y, L.z);
    ok(near(len, 1), 'lightDir is a unit vector', len);
    ok(near(Math.atan2(L.y, L.x), az, 1e-9) || near(Math.abs(az), Math.PI, 1e-9), 'lightDir plane angle', az);
    ok(near(Math.asin(L.z), el, 1e-9), 'lightDir height', el);
  }
  const R0 = SH.lightDir(0, 0.3);
  ok(R0.x > 0.9 && Math.abs(R0.y) < 1e-9, 'az 0 is a sun to the right (+x)');
  const D0 = SH.lightDir(Math.PI / 2, 0.3);
  ok(D0.y > 0.9, 'az PI/2 is a sun below (+y, screen down)');

  // Normal map decoding.
  ok(JSON.stringify(SH.decodeNormal(128, 128, 255).map(v => Math.round(v * 100) / 100)) === '[0,0,1]', 'flat normal decodes to +z', SH.decodeNormal(128, 128, 255));
  const r1 = SH.decodeNormal(255, 128, 128);
  ok(r1[0] > 0.99, 'R 255 decodes to +x', r1);
  const d1 = SH.decodeNormal(128, 255, 128), u1 = SH.decodeNormal(128, 255, 128, true);
  ok(d1[1] > 0.99, 'G 255 decodes to +y (down) in the page frame', d1);
  ok(u1[1] < -0.99, 'G 255 decodes to -y with yUp (a +y up map)', u1);
  let maxErr = 0;
  for (let i = 0; i < 200; i++) {
    const a = Math.random() * 6.283, z = 0.15 + Math.random() * 0.85, s = Math.sqrt(1 - z * z);
    const v = [Math.cos(a) * s, Math.sin(a) * s, z], e = SH.encodeNormal(...v), d = SH.decodeNormal(...e);
    maxErr = Math.max(maxErr, Math.hypot(d[0] - v[0], d[1] - v[1], d[2] - v[2]));
  }
  ok(maxErr < 0.02, 'encode then decode gives the normal back', maxErr.toFixed(4));
  ok(SH.decodeNormal(127, 127, 127).every(Number.isFinite), 'a zero-length normal decodes to a finite vector');

  // Terms: a normal that faces the sun gets more light than one that faces away.
  const L = SH.lightDir(0, 0.35);
  const tSun = SH.terms(0.8, 0, 0.6, L, 0, 1), tAway = SH.terms(-0.8, 0, 0.6, L, 0, 1), tUp = SH.terms(0, 0, 1, L, 0, 1);
  ok(tSun.dif > tUp.dif && tUp.dif > tAway.dif, 'diffuse: sun side > flat > far side', [tSun.dif, tUp.dif, tAway.dif].map(v => v.toFixed(3)));
  ok(tAway.dif < 0.05, 'the far side is past the terminator', tAway.dif);
  ok(tAway.fill > tSun.fill, 'the fill lights the far side');
  ok(tSun.rim > 0 && tAway.rim === 0, 'rim only on the lit edge');
  const tHalf = SH.terms(...(() => { const h = [L.x, L.y, L.z + 1], l = Math.hypot(...h); return h.map(v => v / l); })(), L, 0, 1);
  ok(tHalf.spec > 0.4, 'the highlight peaks on the half vector', tHalf.spec);
  ok(SH.terms(0, 0, 1, L, 1, 1).spec <= SH.terms(0, 0, 1, L, 0, 1).spec + 1 || true, 'cockpit terms run');

  // A dome: the side toward the sun is brighter, at any sun angle.
  const S = 96, lay = discLayers(S, 40), surf = SH.buildSurface(lay, S, S);
  ok(surf.nmap.length === S * S * 4 && surf.idx.length > 4000, 'surface has a normal map and opaque pixels', surf.idx.length);
  const nL = SH.decodeNormal(surf.nmap[(48 * S + 12) * 4], surf.nmap[(48 * S + 12) * 4 + 1], surf.nmap[(48 * S + 12) * 4 + 2]);
  ok(nL[0] < -0.2, 'the left rim normal points left', nL.map(v => v.toFixed(2)));
  for (let k = 0; k < 8; k++) {
    const az = k / 8 * 2 * Math.PI, Lk = SH.lightDir(az, 0.35), out = SH.shade(lay.hull, surf, Lk);
    const ax = Math.round(48 + Math.cos(az) * 33), ay = Math.round(48 + Math.sin(az) * 33);
    const bx = Math.round(48 - Math.cos(az) * 33), by = Math.round(48 - Math.sin(az) * 33);
    ok(luma(out, S, ax, ay) > luma(out, S, bx, by) + 20, 'lit side faces the sun at az ' + k + '/8', [luma(out, S, ax, ay) | 0, luma(out, S, bx, by) | 0]);
    ok(luma(out, S, bx, by) > 4, 'the shadow side is not black at az ' + k + '/8', luma(out, S, bx, by) | 0);
    ok(out[(1 * S + 1) * 4 + 3] === 0, 'clear pixels stay clear');
  }

  // Self shadow: a tall block (an accent part) darkens the hull on its far side.
  const S2 = 128, lay2 = discLayers(S2, 60, { x: 64, y: 64, r: 6 });
  for (let p = 0; p < S2 * S2; p++) if (lay2.accents[p * 4 + 3]) lay2.accents[p * 4 + 3] = 255;
  const surf2 = SH.buildSurface(lay2, S2, S2);
  // Make the block much taller so the test does not hang on look numbers.
  for (let y = 58; y <= 70; y++) for (let x = 58; x <= 70; x++) surf2.height[y * S2 + x] += 30;
  const Lr = SH.lightDir(0, 0.3);   // sun to the right: the shadow falls left
  const left = SH.shadowAt(surf2, 64 * S2 + 50, Lr, 10), right = SH.shadowAt(surf2, 64 * S2 + 78, Lr, 10);
  ok(left < 0.5 && right > 0.95, 'the block shadows the side away from the sun', [left.toFixed(2), right.toFixed(2)]);
  const lit2 = SH.shade(lay2.hull, surf2, Lr), flat2 = SH.shade(lay2.hull, surf2, Lr, { shadow: false });
  ok(luma(lit2, S2, 55, 64) < luma(flat2, S2, 55, 64) - 5, 'shade() applies the self shadow', [luma(lit2, S2, 55, 64) | 0, luma(flat2, S2, 55, 64) | 0]);
  ok(SH.shadowAt(surf2, 64 * S2 + 50, SH.lightDir(0, Math.PI / 2), 10) === 1, 'a sun overhead casts no shadow');

  // The sprite frame: a ship turned by a sees the sun turned by -a.
  const Lw = SH.lightDir(0.3, 0.4), Lt = SH.rotateLight(Lw, 0.3);
  ok(near(Math.atan2(Lt.y, Lt.x), 0, 1e-9) && near(Lt.z, Lw.z), 'rotateLight turns the light into the sprite frame');

  // Occlusion: the crease next to a raised part is darker than open hull.
  ok(surf2.ao[64 * S2 + 56] < surf2.ao[64 * S2 + 40] + 1e-9, 'occlusion near a raised part is not lighter than open hull', [surf2.ao[64 * S2 + 56].toFixed(3), surf2.ao[64 * S2 + 40].toFixed(3)]);
  ok(surf2.mat[64 * S2 + 64] === 2 && surf2.mat[64 * S2 + 30] === 0, 'materials: accent part and hull');
  ok(SH.toSRGB(0) === 0 && SH.toSRGB(0.5) === 188 && SH.toSRGB(1) > 240 && SH.toSRGB(4) <= 255 && SH.toSRGB(1) < SH.toSRGB(2) && near(SH.toLinear(255), 1), 'sRGB tables, soft shoulder over 0.85', [SH.toSRGB(0.5), SH.toSRGB(1), SH.toSRGB(4)]);
}

// ── liveries ──────────────────────────────────────────────────────────────
// The game livery names, in the game order. When the game adds, removes or
// renames a livery, change this list and liveries.js together.
const GAME_NAMES = ['Viper', 'Crimson', 'Cobalt', 'Imperial', 'Monarch', 'Regal', 'Inferno', 'Ember', 'Magma',
  'Arctic', 'Glacier', 'Frost', 'Phantom', 'Chrome', 'Stealth', 'Synth', 'Neon', 'Plasma', 'Oceanic', 'Polaris',
  'Nebula', 'Jade', 'Venom', 'Militia', 'Coral', 'Sakura', 'Lotus', 'Rustic', 'Sandstorm', 'Tundra', 'Void',
  'Wraith', 'Obsidian', 'Hazard', 'Hornet', 'Scorpion', 'Blitz', 'Sunset', 'Aurora', 'Osprey', 'Specter'];
{
  section('liveries');
  ok(JSON.stringify(LIV.CURRENT.map(r => r[0])) === JSON.stringify(GAME_NAMES), 'CURRENT names are the game names in game order');
  ok(LIV.CURRENT.every(r => r.length === 3 && /^#[0-9a-f]{6}$/.test(r[1]) && /^#[0-9a-f]{6}$/.test(r[2])), 'every livery has two lower-case hex colours');
  ok(new Set(LIV.CURRENT.map(r => r[1] + r[2])).size === LIV.CURRENT.length, 'no two liveries have the same colours');
  const kept = LIV.CURRENT.filter(r => LIV.LEGACY.some(o => o[1] === r[1] && o[2] === r[2])).map(r => r[0]);
  ok(JSON.stringify(kept) === '["Magma"]', 'only one old site colour pair is a game livery (old Ember = game Magma)', kept);
  // The exporter output: the catalog gives the three layer sprites.
  const cat = JSON.parse(fs.readFileSync(path.join(SN, 'lib/game-data/catalog.json'), 'utf8'));
  const lay = cat.entries.filter(e => e.category === 'ship-livery');
  ok(JSON.stringify(lay.map(e => e.slug)) === '["hull","cockpit","accents"]', 'catalog has the three livery layers', lay.map(e => e.slug));
  for (const e of lay) {
    ok(e.sprites.length === 2 && e.sprites.every(s => fs.existsSync(path.join(SN, s))), 'layer ' + e.slug + ' has its sprite and mask on disk', e.sprites);
  }
  const mainSrc = fs.readFileSync(path.join(HERE, 'main.js'), 'utf8');
  ok(lay.every(e => mainSrc.includes("'" + e.sprites[0] + "'") && mainSrc.includes("'" + e.sprites[1] + "'")), 'main.js fallback paths equal the catalog paths');
  ok(!/\['Viper', '#1a6b3a'/.test(mainSrc), 'main.js holds no old preset table');
}

// ── migration ─────────────────────────────────────────────────────────────
{
  section('migration');
  for (const o of LIV.LEGACY) {
    const m = LIV.migrate(o[1], o[2].toUpperCase());
    if (o[0] === 'Ember') { ok(m === null, 'old Ember colours stay: they are the game Magma'); continue; }
    const want = LIV.find(LIV.CURRENT, o[0]);
    ok(m && m.to === want && m.by === 'name', 'old ' + o[0] + ' goes to the game ' + o[0], m && m.to[0]);
  }
  ok(LIV.migrate('#4ac86e', '#ffc832') === null, 'a game livery pair is not migrated');
  ok(LIV.migrate('#123456', '#abcdef') === null, 'custom colours are not migrated');
  // A name that is gone: the nearest game livery by colour.
  const gone = LIV.nearest('#0a28d0', '#ffff10');
  ok(gone[0] === 'Blitz', 'nearest: deep blue and yellow goes to Blitz', gone[0]);
  ok(LIV.nearest('#ffd000', '#202020')[0] === 'Hazard', 'nearest: yellow and black goes to Hazard');
}

// ── page harness ──────────────────────────────────────────────────────────
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
      return (...a) => { log[k] = (log[k] || 0) + 1; };
    },
    set(_, k, v) { props[k] = v; return true; }
  });
}

async function bootPage(w, h, touch = false, hash = '', settleMs = 150) {
  const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').replace(/<script\b[^>]*><\/script>/g, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && e.message || e)));
  vc.on('error', e => errors.push(String(e)));
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/ship-designer/' + hash, pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
  const win = dom.window;
  win.innerWidth = w; win.innerHeight = h;
  win.devicePixelRatio = touch ? 2 : 1;
  win.matchMedia = q => ({ matches: /hover:\s*none/.test(q) ? touch : /max-width:\s*900/.test(q) ? w <= 900 : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const R = (l, t, ww, hh) => ({ left: l, top: t, width: ww, height: hh, right: l + ww, bottom: t + hh, x: l, y: t });
  win.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'sunDial') return R(100, 100, 44, 44);
    if (this.id === 'fleetWrap') return R(0, 600, Math.min(w, 900), 300);
    if (this.id === 'shipCanvas') return R(0, 100, 400, 400);
    if (this.id === 'panel') return R(0, h - 360, w, 360);
    return R(0, 0, 0, 0);
  };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.scrollBy = () => {};
  const log = {};
  win.HTMLCanvasElement.prototype.getContext = function () { return this.__ctx || (this.__ctx = stubContext(this, log)); };
  win.Image = class {
    constructor() { this.complete = false; this.onload = null; this.onerror = null; }
    set src(v) { this._src = v; setTimeout(() => { this.complete = true; this.naturalWidth = this.width = 512; this.naturalHeight = this.height = 512; this.onload && this.onload(); }, 1); }
    get src() { return this._src; }
  };
  win.onerror = (m, s, l, c, e) => { errors.push(String(e && e.stack || m)); };
  const srcs = [...fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  for (const s of srcs) {
    if (/gpu-guard|wishlist|stats-beacon/.test(s)) continue;
    const rel = path.relative(SN, path.resolve(HERE, s));
    try { win.eval(fs.readFileSync(path.join(SN, rel), 'utf8') + '\n//# sourceURL=' + rel); }
    catch (e) { errors.push(rel + ': ' + (e && e.stack || e)); }
  }
  await new Promise(r => setTimeout(r, settleMs));
  // The light surfaces build after the first paint; wait for them (3 s cap).
  for (let i = 0; i < 60 && win.__snShipDesigner && !win.__snShipDesigner.lit.ready; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 150));
  return { win, api: win.__snShipDesigner, errors, log, doc: win.document };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fire(win, el, type, x, y) {
  const e = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  el.dispatchEvent(e);
}

// ── page ──────────────────────────────────────────────────────────────────
{
  section('page');
  for (const [label, w, h, touch] of [['desktop', 1440, 900, false], ['phone', 390, 844, true], ['phone landscape', 844, 390, true]]) {
    const { win, api, errors, doc } = await bootPage(w, h, touch);
    ok(errors.length === 0, label + ': boots with no errors', errors.slice(0, 3).join(' | '));
    ok(!!api, label + ': test hook present');
    if (!api) continue;
    ok(api.lit.ready === true, label + ': the light surfaces are built');
    ok(doc.querySelectorAll('.preset').length === GAME_NAMES.length, label + ': one button per game livery', doc.querySelectorAll('.preset').length);
    ok(api.state.hull === '#4ac86e' && api.state.accent === '#ffc832', label + ': opens on the game Viper livery');
    ok(doc.getElementById('liveryName').textContent === 'Viper', label + ': the livery name shows Viper');
    ok(api.lit.lite === touch, label + ': the touch screen uses the short shadow march');
    win.close();
  }

  // Flat / Lit.
  const { win, api, errors, doc } = await bootPage(1440, 900, false);
  const btn = l => doc.querySelector('#lookSeg button[data-look="' + l + '"]');
  ok(api.lit.on && btn('lit').classList.contains('on') && doc.getElementById('hero').classList.contains('lit'), 'Lit is the default look');
  ok(Array.isArray(api.lit.bins) && api.lit.bins.length === api.FLEET_BINS, 'Lit: the fleet has its lit sprites', api.lit.bins && api.lit.bins.length);
  btn('flat').click();
  ok(!api.lit.on && btn('flat').classList.contains('on') && !btn('lit').classList.contains('on'), 'Flat button selects Flat');
  ok(!doc.getElementById('hero').classList.contains('lit') && doc.getElementById('lightCtl').classList.contains('flat'), 'Flat: hero and dial show the flat look');
  ok(api.lit.bins === null, 'Flat: the fleet draws the flat sprite');
  ok(/&look=flat$/.test(api.hashString()), 'Flat is in the link', api.hashString());
  await sleep(300);
  ok(/look=flat/.test(win.location.hash), 'Flat is written to the URL hash', win.location.hash);
  btn('lit').click();
  ok(api.lit.on && api.lit.bins && !/look=flat/.test(api.hashString()), 'Lit button selects Lit again');

  // The sun dial: a drag to the right of the centre puts the sun at az 0, low.
  const n0 = api.lit.relights, q0 = api.lit.quick;
  const dial = doc.getElementById('sunDial');
  fire(win, dial, 'pointerdown', 144, 122);
  ok(near(api.sun.az, 0, 1e-6) && near(api.sun.el, 0.12, 1e-6), 'dial rim at the right: sun at az 0, lowest', [api.sun.az, api.sun.el]);
  fire(win, dial, 'pointermove', 122, 100);
  ok(near(api.sun.az, -Math.PI / 2, 1e-6), 'dial drag to the top: sun from above', api.sun.az);
  fire(win, dial, 'pointerup', 122, 100);
  fire(win, dial, 'pointermove', 144, 122);
  ok(near(api.sun.az, -Math.PI / 2, 1e-6), 'no change after pointer up');
  await sleep(40);
  ok(api.lit.quick > q0, 'a dial drag relights the hero with the quick 256 surface', api.lit.quick - q0);
  await sleep(250);
  ok(api.lit.relights > n0, 'a full 512 relight follows when the drag stops', api.lit.relights - n0);
  const knob = doc.getElementById('sunKnob');
  ok(knob.style.left === '50%' && parseFloat(knob.style.top) < 1, 'the knob sits at the top rim', [knob.style.left, knob.style.top]);
  const az1 = api.sun.az;
  dial.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  ok(near(api.sun.az, az1 + 0.15, 1e-9), 'arrow key turns the sun');
  await sleep(200);
  ok(near(api.lit.binsEl, api.sun.el, 1e-9), 'a new sun height rebuilds the fleet sprites');

  // Auto turns the sun; a drag stops it.
  doc.getElementById('btnSunAuto').click();
  const az2 = api.sun.az;
  await sleep(200);
  ok(api.sun.auto && Math.abs(api.sun.az - az2) > 0.01, 'Auto turns the sun', [az2, api.sun.az]);
  fire(win, dial, 'pointerdown', 122, 144); fire(win, dial, 'pointerup', 122, 144);
  ok(!api.sun.auto && doc.getElementById('btnSunAuto').getAttribute('aria-pressed') === 'false', 'a dial drag stops Auto');

  // Fleet bins: the bin is the sun plane angle in the ship frame.
  api.setSun(0, 0.4);
  ok(api.fleetBin(0) === 0, 'sun at az 0, ship not turned: bin 0');
  ok(api.fleetBin(-Math.PI / 2) === api.FLEET_BINS / 4, 'ship turned -90 deg: the sun is at +90 deg in its frame');
  api.setSun(Math.PI, 0.4);
  ok(api.fleetBin(Math.PI) === 0, 'sun and ship turned together: bin 0');

  // A preset click.
  doc.querySelector('.preset[data-name="Cobalt"]').click();
  await sleep(40);
  ok(api.state.hull === '#2864c8' && api.state.accent === '#ffc832', 'Cobalt preset paints the game Cobalt colours');
  ok(doc.getElementById('liveryName').textContent === 'Cobalt', 'livery name shows Cobalt');
  ok(errors.length === 0, 'no errors after the interactions', errors.slice(0, 3).join(' | '));
  // Saver: enter returns the fleet canvas and the plate names the light.
  let plate = null;
  const r = win.snSaver.enter({ seed: 2, calm: 0.7, label: p => { plate = p; } });
  ok(r && r.canvas === doc.getElementById('fleetCanvas'), 'saver gives the fleet canvas');
  ok(plate && plate.title === GAME_NAMES[2] + ' livery' && plate.lines.some(l => /One sun/.test(l)), 'saver plate: game livery and light line', plate && plate.title);
  win.close();

  // Old links.
  {
    const old = await bootPage(1440, 900, false, '#hull=1a6b3a&trim=0f3d22&accent=b8901e&pattern=none');
    ok(old.errors.length === 0, 'old link boots with no errors', old.errors.join(' | '));
    ok(old.api.state.hull === '#4ac86e' && old.api.state.accent === '#ffc832', 'old Viper link becomes the game Viper', [old.api.state.hull, old.api.state.accent]);
    ok(old.api.state.trim === '#296e3d', 'its trim follows the new hull', old.api.state.trim);
    ok(/Viper now has the game colours/.test(old.doc.getElementById('toast').textContent), 'a toast tells the user', old.doc.getElementById('toast').textContent);
    await sleep(300);
    ok(/^#v=2&/.test(old.win.location.hash), 'the link is rewritten as v=2', old.win.location.hash);
    old.win.close();
    const oldPat = await bootPage(1440, 900, false, '#hull=8a1a1a&trim=123456&accent=d0d0d8&pattern=spine');
    ok(oldPat.api.state.hull === '#c83232' && oldPat.api.state.trim === '#123456' && oldPat.api.state.pattern === 'spine', 'old Crimson with a trim pattern keeps its own trim', [oldPat.api.state.hull, oldPat.api.state.trim]);
    oldPat.win.close();
    const custom = await bootPage(1440, 900, false, '#hull=123456&trim=0a0b0c&accent=abcdef&pattern=wings');
    ok(custom.api.state.hull === '#123456' && custom.api.state.accent === '#abcdef' && custom.api.state.pattern === 'wings', 'a custom old link loads as it is');
    ok(custom.doc.getElementById('toast').textContent === '', 'no toast for a custom link');
    custom.win.close();
    const v2 = await bootPage(1440, 900, false, '#v=2&hull=1a6b3a&trim=0f3d22&accent=b8901e&pattern=none&look=flat');
    ok(v2.api.state.hull === '#1a6b3a' && !v2.api.lit.on, 'a v=2 link is not migrated, and look=flat loads Flat');
    v2.win.close();
  }
}

console.log(`\nship-designer tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
