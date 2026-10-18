// tests/mobile.test.mjs — phone and tablet layout checks (node, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/mobile.test.mjs
// With jsdom: JSDOM_DIR=<a folder with node_modules/jsdom> node ...
// (the repo has no node_modules; without jsdom the DOM part is skipped and
// the skip is named in the output).
//
// What it checks, at 360x740, 390x844, 430x932, 768x1024, 844x390 (touch)
// and 1440x900 (mouse):
//   layout.js   the mode (sheet, drawer, wide), the rects stay in the
//               viewport, the drawer and the dock do not overlap, the map
//               is clear of the view centre, the clear rect and its shift,
//               the sheet snap, the safe-area insets
//   style.css   the sizes agree with layout.js, PHONE_Q agrees with ui.js,
//               no fixed width wider than the viewport, 11 px text floor on
//               touch screens, [hidden] first
//   camera.js   pickGround finds the ground under a screen point
//   jsdom       the controls are there, every group (7 LIB groups and Sky,
//               Time, Season, Vegetation, Water, Camera) has a dice and a
//               lock in its header and can be reached through a tab, the
//               dock acts, the grip drag snaps, the [hidden] rule hides,
//               "tap to explore" shows one time

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  layoutMode, layoutRects, clearRect, centreShift, sheetHeights, snapSheet,
  DOCK_H, STATUS_H, TOP_H, GRIP_H, SHEET_MAX, DRAWER_MAX, DOCK_LAND_MAX, MAP_PHONE, MAP_LAND,
} from '../layout.js';
import { createCamera, pickGround } from '../camera.js';
import { PHONE_Q, GROUP_ORDER, wxShort } from '../ui.js';

const here = p => fileURLToPath(new URL('../' + p, import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} mobile: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} mobile: ${name} ${extra}`); }
}

const VIEWS = [
  { w: 360, h: 740, coarse: true, mode: 'sheet' },
  { w: 390, h: 844, coarse: true, mode: 'sheet' },
  { w: 430, h: 932, coarse: true, mode: 'sheet' },
  { w: 768, h: 1024, coarse: true, mode: 'sheet' },
  { w: 844, h: 390, coarse: true, mode: 'drawer' },
  { w: 1440, h: 900, coarse: false, mode: 'wide' },
];
const PHONE_INSET = { t: 47, r: 0, b: 34, l: 0 }, LAND_INSET = { t: 0, r: 47, b: 21, l: 47 };
const inside = (r, W, H) => !r || (r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= W + 0.5 && r.y + r.h <= H + 0.5);
const hit = (r, x, y) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const overlap = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ── layout.js
for (const v of VIEWS) {
  const tag = `${v.w}x${v.h}`;
  ok(layoutMode(v.w, v.h, v.coarse) === v.mode, `${tag} is ${v.mode}`, layoutMode(v.w, v.h, v.coarse));
  const inset = v.mode === 'drawer' ? LAND_INSET : v.mode === 'sheet' ? PHONE_INSET : {};
  for (const panel of ['closed', 'half', 'full']) {
    if (v.mode !== 'sheet' && panel === 'full') continue;
    const R = layoutRects(v.w, v.h, { coarse: v.coarse, panel, inset });
    const all = ['top', 'dock', 'status', 'panel', 'map'].filter(k => R[k]);
    const out = all.filter(k => !inside(R[k], v.w, v.h));
    ok(out.length === 0, `${tag} ${panel}: every rect in the viewport`, out.join(','));
    const c = clearRect(v.w, v.h, ['top', 'dock', 'status', 'panel'].map(k => R[k]));
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    ok(!hit(R.map, cx, cy), `${tag} ${panel}: the map is clear of the view centre`);
    ok(c.w >= v.w * 0.3 && c.h >= v.h * 0.3, `${tag} ${panel}: the clear rect keeps 30% of each axis (${Math.round(c.w)}x${Math.round(c.h)})`);
    // the full sheet is for editing and covers the view by design
    if (R.panel && panel === 'half') ok(!hit(R.panel, cx, cy), `${tag} ${panel}: the view centre is not under the panel`);
    if (v.mode === 'drawer' && R.panel) ok(!overlap(R.panel, R.dock) && !overlap(R.panel, R.status), `${tag} ${panel}: the drawer and the dock do not overlap`);
    if (v.mode === 'sheet' && R.panel) ok(Math.abs(R.panel.y + R.panel.h - R.dock.y) < 0.5, `${tag} ${panel}: the sheet sits on the dock`);
    if (R.dock) ok(R.dock.h - inset.b >= DOCK_H - 0.5, `${tag} ${panel}: the dock buttons sit over the home indicator`);
  }
  if (v.mode !== 'wide') {
    // five dock buttons: menu 52, roll 52, time 60, sky 68, gaps 4 x 6,
    // padding 16 + the side insets; the new-terrain button takes the rest
    const R = layoutRects(v.w, v.h, { coarse: true, panel: v.mode === 'drawer' ? 'half' : 'closed', inset });
    const wide = R.dock.w - 16 - inset.l - inset.r - 24 - (52 + 52 + 60 + 68);
    ok(wide >= 72, `${tag}: the new-terrain button keeps ${Math.round(wide)} px (72 or more)`);
  }
}
{
  const st = sheetHeights(844, { b: 34 });
  ok(st.half === Math.min(844 * 0.48, SHEET_MAX) && st.full === 844 - DOCK_H - 34 - 40, `sheet stops at 390x844: ${st.half.toFixed(0)} and ${st.full} px`);
  ok(snapSheet(80, st) === 'closed' && snapSheet(st.half, st) === 'half' && snapSheet(st.half + 10, st) === 'half' && snapSheet(st.full - 20, st) === 'full', 'snapSheet: closed, half, full');
  const R = layoutRects(390, 844, { coarse: true, panel: 'half', inset: { b: 34, t: 47 } });
  const c = clearRect(390, 844, [R.top, R.dock, R.status, R.panel]);
  const s = centreShift(c, 390, 844);
  ok(s[1] > 0.3 && Math.abs(s[0]) < 1e-9, `the half sheet moves the image centre up (NDC y ${s[1].toFixed(2)})`);
  const D = layoutRects(844, 390, { coarse: true, panel: 'half', inset: LAND_INSET });
  const sd = centreShift(clearRect(844, 390, [D.dock, D.status, D.panel]), 844, 390);
  ok(sd[0] < -0.3, `the drawer moves the image centre left (NDC x ${sd[0].toFixed(2)})`);
  ok(centreShift(clearRect(800, 600, []), 800, 600).every(x => x === 0), 'no bars: no shift');
  const small = clearRect(400, 400, [{ x: 0, y: 0, w: 400, h: 390 }]);
  ok(small.h >= 120 - 1e-9, 'a bar over the whole view leaves 30% clear');
}

// ── style.css against layout.js and ui.js
const css = readFileSync(here('style.css'), 'utf8');
const ui = readFileSync(here('ui.js'), 'utf8');
const noSp = css.replace(/\s+/g, '');
ok(/^\s*(\/\*[\s\S]*?\*\/\s*)?\[hidden\]\{display:none!important\}/.test(css), 'style.css starts with [hidden]{display:none!important}');
ok(css.includes('@media ' + PHONE_Q.replace(/, /g, ', ') + '{') || noSp.includes('@media' + PHONE_Q.replace(/\s+/g, '') + '{'), 'the PHONE block query is PHONE_Q of ui.js');
for (const [want, what] of [
  [`--dock-h:calc(${DOCK_H}px+env(safe-area-inset-bottom))`, 'dock height'], [`--status-h:${STATUS_H}px`, 'status height'],
  [`--top-h:calc(${TOP_H}px+env(safe-area-inset-top))`, 'top bar height'], [`height:min(48dvh,${SHEET_MAX}px)`, 'half sheet'],
  ['height:calc(100dvh-var(--dock-h)-40px)', 'full sheet'], [`--drawer-w:min(46vw,${DRAWER_MAX}px)`, 'drawer width'],
  [`--dock-w:min(${DOCK_LAND_MAX}px`, 'landscape dock width'], [`#map{width:${MAP_PHONE}px`, 'phone map width'],
  [`width:${MAP_LAND}px`, 'landscape map width'], [`height:${GRIP_H}px`, 'grip height'],
  ['#dock>button{flex:0052px', 'dock button 52 px'], ['#dockTime{flex:0060px', 'time button 60 px'], ['#dockWx{flex:0068px', 'sky button 68 px'],
]) ok(noSp.includes(want), `style.css ${what} agrees with layout.js`, want);

// fixed widths: no px width over the viewport outside the desktop block
const desk = css.indexOf('@media (min-width:769px)');
const deskEnd = css.indexOf('\n}\n', desk);
const mobileCss = css.slice(0, desk) + css.slice(deskEnd);
const evalLen = (expr, W) => {
  expr = expr.trim();
  const m = /^min\((.*)\)$/.exec(expr);
  if (m) {
    const parts = []; let d = 0, cur = '';
    for (const ch of m[1]) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    // a calc() or var() argument follows the viewport, so the min does too
    const v = parts.map(p => evalLen(p, W));
    return v.every(Number.isFinite) ? Math.min(...v) : NaN;
  }
  if (/^-?[\d.]+px$/.test(expr)) return parseFloat(expr);
  if (/^-?[\d.]+vw$/.test(expr)) return parseFloat(expr) * W / 100;
  return NaN;   // calc, var, %: they follow the viewport
};
for (const v of VIEWS.filter(x => x.mode !== 'wide')) {
  const wide = [];
  for (const m of mobileCss.matchAll(/(?:^|[;{\s])(width|min-width|flex-basis):([^;}]+)/g)) {
    const L = evalLen(m[2], v.w);
    if (Number.isFinite(L) && L > v.w) wide.push(m[1] + ':' + m[2]);
  }
  ok(wide.length === 0, `${v.w}x${v.h}: no fixed width over ${v.w} px`, wide.join(' | '));
}
// the 11 px floor: font sizes in the TOUCH, PHONE and LANDSCAPE blocks
{
  const t0 = css.indexOf('/* TOUCH'), t1 = css.indexOf('/* sn-saver');
  const small = [...css.slice(t0, t1).matchAll(/font-size:([\d.]+)(rem|px)/g)].map(m => (m[2] === 'rem' ? +m[1] * 16 : +m[1])).filter(px => px < 11);
  ok(small.length === 0, 'touch and phone font sizes are 11 px or more', small.join(', '));
  ok(/#map figcaption,#pgStages,#stMain[^{]*\{font-size:max\(11px/.test(css), 'touch screens floor the small labels at 11 px');
  ok(/#view\{[^}]*touch-action:none/.test(css) && /overscroll-behavior:none/.test(css), 'the canvas takes every touch and the page does not scroll');
  ok(/#panel\{[^}]*overscroll-behavior:contain/.test(css.slice(css.indexOf('/* PHONE'))), 'the sheet scroll stays in the sheet');
  ok(/html\{[^}]*overflow-x:hidden/.test(css) && !/body\{[^}]*overflow-x/.test(css), 'overflow-x sits on html, not on body (position:sticky works)');
}
ok(wxShort({ label: 'Fair weather' }) === 'Fair' && wxShort({ label: 'Thunderstorm' }) === 'Storm' && wxShort({ id: 'fog' }) === 'fog', 'wxShort gives one short word');

// ── camera.js pickGround
{
  const cam = createCamera({ fovY: 50 * Math.PI / 180 });
  const world = { heightAt: () => 10, size: 8000, seaLevel: -100 };
  cam.orbit = { target: [100, 10, -50], yaw: 0.4, pitch: -0.6, dist: 900 };
  cam.update(0.016, {}, world);
  const m = cam.matrices(400, 800, {});
  const p = pickGround(m.invViewProj, 0, 0, world, 1e5);
  ok(p && Math.hypot(p[0] - 100, p[2] + 50) < 1 && Math.abs(p[1] - 10) < 0.5, 'pickGround: the screen centre is the orbit target', JSON.stringify(p));
  const s = cam.matrices(400, 800, { shift: [0, 0.4] });
  const q = pickGround(s.invViewProj, 0, 0.4, world, 1e5);
  ok(q && Math.hypot(q[0] - 100, q[2] + 50) < 1, 'pickGround: with a shift the target sits at the shifted centre');
  const sky = pickGround(m.invViewProj, 0, 0.99, { heightAt: () => -1e4, seaLevel: -1e4 }, 5000);
  ok(sky === null, 'pickGround: a ray into the sky gives null');
}

// ── jsdom
let JSDOM = null, VirtualConsole = null;
try {
  const d = process.env.JSDOM_DIR;
  if (d && existsSync(d + '/node_modules/jsdom')) ({ JSDOM, VirtualConsole } = await import(pathToFileURL(d + '/node_modules/jsdom/lib/api.js').href));
  else if (process.env.NODE_PATH) ({ JSDOM, VirtualConsole } = createRequire(process.env.NODE_PATH.split(':')[0] + '/')('jsdom'));
} catch { JSDOM = null; }

const lib = await import(pathToFileURL(fileURLToPath(new URL('../../../lib/dla-terrain.js', import.meta.url))).href).catch(() => null)
  || await import('../gpu/stub-terrain.js');
const sky = await import('../sky-state.js').catch(() => null);
const WEATHER = (sky && sky.WEATHER) || [{ id: 'fair', label: 'Fair weather' }, { id: 'rain', label: 'Rain' }];
const EXTRA = ['Sky', 'Time', 'Season', 'Vegetation', 'Water', 'Camera'];

if (!JSDOM) {
  console.log('# mobile: jsdom not found (set JSDOM_DIR): the DOM checks are skipped');
} else {
  const html = readFileSync(here('index.html'), 'utf8').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
  for (const v of VIEWS) {
    const tag = `${v.w}x${v.h}`;
    const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/dla-terrain/', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    const win = dom.window, doc = win.document;
    Object.defineProperty(win, 'innerWidth', { value: v.w, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: v.h, configurable: true });
    const mode = layoutMode(v.w, v.h, v.coarse);
    win.matchMedia = q => ({ matches: q === PHONE_Q ? mode !== 'wide' : q === '(pointer:coarse)' ? v.coarse : false, addEventListener() {}, removeEventListener() {} });
    win.HTMLCanvasElement.prototype.getContext = () => null;
    const st = doc.createElement('style'); st.textContent = css; doc.head.append(st);
    const calls = [];
    const spy = name => (...a) => calls.push([name, ...a]);
    const app = {
      lib, opts: lib.defaults(), preset: null, locks: new Set(), hist: null,
      tod: 0.3, todSpeed: 0.1, playing: true, season: 0.35, latitude: 46, weatherId: WEATHER[0].id, wxOver: {},
      camMode: 'orbit', qualityIndex: 0, layers: { grass: true, trees: true, props: true, water: true, clouds: true, rain: true },
      veg: { density: 1, conifer: 0.5, flowers: 0.5 }, water: { tint: 0.35, waves: 0.4 },
      setOpt: spy('setOpt'), generate: spy('generate'), randomise: spy('randomise'), randomiseAll: spy('randomiseAll'),
      toggleLock: spy('toggleLock'), applyPreset: spy('applyPreset'), nextPreset: spy('nextPreset'), setTod: spy('setTod'),
      setWeather: spy('setWeather'), setPlaying: spy('setPlaying'), setCam: spy('setCam'), drone: spy('drone'),
      setQuality: spy('setQuality'), setLayer: spy('setLayer'), setLook: spy('setLook'), setMix: spy('setMix'),
      historyStep: spy('historyStep'), copyLink: spy('copyLink'), flyTo: spy('flyTo'), clearWxOver: spy('clearWxOver'), setWxOver: spy('setWxOver'),
      onLayout: spy('onLayout'),
    };
    let U;
    try {
      const { createUI } = await import('../ui.js');
      U = createUI(app, doc);
      U.buildOptions(lib); U.buildWeather(WEATHER); U.buildQuality([{ label: 'Low' }, { label: 'Medium' }, { label: 'High' }, { label: 'Ultra' }]);
      U.syncSky(); U.syncView(); U.syncMix(); U.syncLocks();
    } catch (e) { ok(false, `${tag}: createUI runs in jsdom`, e.message); continue; }
    const $ = id => doc.getElementById(id);
    const panel = $('panel');
    // the dock
    const dockIds = [...doc.querySelectorAll('#dock > button')].map(b => b.id);
    ok(dockIds.join() === 'dockPanel,dockDice,dockGen,dockTime,dockWx', `${tag}: five dock buttons`, dockIds.join());
    ok([...doc.querySelectorAll('#dock > button')].every(b => (b.getAttribute('aria-label') || b.textContent).trim()), `${tag}: each dock button has a name`);
    ok(panel.classList.contains('open') === (mode === 'wide'), `${tag}: the panel starts ${mode === 'wide' ? 'open' : 'closed'}`);
    calls.length = 0;
    $('dockDice').click(); $('dockGen').click(); $('dockTime').click(); $('dockWx').click();
    const names = calls.map(c => c[0]);
    ok(names.includes('randomiseAll') && names.includes('nextPreset') && names.includes('setTod') && names.includes('setWeather'), `${tag}: the dock rolls, makes a new terrain, steps the time and the weather`, names.join());
    const wxCall = calls.find(c => c[0] === 'setWeather');
    ok(wxCall && wxCall[1] === WEATHER[1 % WEATHER.length].id, `${tag}: the sky button steps to the next weather`);
    if (mode !== 'wide') {
      $('dockPanel').click();
      ok(panel.classList.contains('open') && $('dockPanel').getAttribute('aria-expanded') === 'true', `${tag}: the menu button opens the panel`);
    }
    // every group: header with lock and dice, reachable through a tab
    const missing = [];
    for (const g of [...GROUP_ORDER.filter(x => lib.OPTIONS.some(o => o.group === x)), ...EXTRA]) {
      const head = [...doc.querySelectorAll('details.group > summary, .sec-label[data-group]')].find(h => (h.dataset && h.dataset.group === g) || (h.firstChild && h.firstChild.textContent === g));
      if (!head) { missing.push(g + ':no header'); continue; }
      const lock = head.querySelector('.lock'), dice = head.querySelector('.dice');
      if (!lock || !dice) { missing.push(g + ':no dice or lock'); continue; }
      const sec = head.closest('section.tab');
      const tab = sec && doc.querySelector(`#sheetTabs button[data-tab="${sec.dataset.tab}"]`);
      if (!tab) { missing.push(g + ':no tab'); continue; }
      tab.click();
      if (sec.hidden) missing.push(g + ':tab does not show it');
      calls.length = 0; lock.click(); dice.click();
      if (!calls.some(c => c[0] === 'toggleLock' && c[1] === g) || !calls.some(c => c[0] === 'randomise' && c[1] === g)) missing.push(g + ':buttons do not act');
      const det = head.closest('details');
      if (det) { det.open = true; if (!det.querySelector('.row')) missing.push(g + ':no rows'); }
    }
    ok(missing.length === 0, `${tag}: all 13 groups have a dice and a lock in the header and open from a tab`, missing.join(', '));
    // the screensaver and the camera are in the view tab
    ok($('viewSaver') && $('viewSaver').closest('section.tab').dataset.tab === 'view' && doc.querySelectorAll('#camSeg button').length === 3, `${tag}: camera modes and the screensaver sit in the view tab`);
    // [hidden] hides (jsdom applies the top-level rules of the style sheet)
    const shown = [...doc.querySelectorAll('[hidden]')].filter(e => win.getComputedStyle(e).display !== 'none').map(e => e.id || e.tagName);
    ok(shown.length === 0, `${tag}: every element with the hidden attribute computes display none`, shown.join(','));
    // the grip: a drag follows the finger, a release snaps and clears the inline height
    if (mode === 'sheet') {
      const grip = $('sheetGrip');
      const ev = (type, y) => { const e = new win.Event(type, { bubbles: true }); e.clientY = y; e.pointerId = 1; grip.dispatchEvent(e); };
      ev('pointerdown', 600); ev('pointermove', 300);
      const dragH = parseFloat(panel.style.height);
      ok(dragH > 0 && dragH <= v.h, `${tag}: the sheet follows the grip (${dragH} px)`);
      ev('pointerup', 100);
      ok(panel.style.height === '' && panel.classList.contains('full'), `${tag}: a drag up snaps to full height`);
      ev('pointerdown', 100); ev('pointermove', 900); ev('pointerup', 900);
      ok(!panel.classList.contains('open'), `${tag}: a drag down closes the sheet`);
    }
    // the map inset folds to its caption bar and opens again
    {
      const map = $('map'), tg = $('mapToggle');
      tg.click();
      const folded = map.classList.contains('min') && tg.getAttribute('aria-label') === 'Show the map';
      tg.click();
      ok(folded && !map.classList.contains('min') && tg.getAttribute('aria-label') === 'Hide the map', `${tag}: the map toggle folds and opens the map inset`);
    }
    // no inline width wider than the viewport
    const wideEls = [...doc.querySelectorAll('[style]')].filter(e => parseFloat(e.style.width) > v.w || parseFloat(e.style.minWidth) > v.w).map(e => e.id || e.tagName);
    ok(wideEls.length === 0, `${tag}: no inline width over ${v.w} px`, wideEls.join(','));
    // the hint: one time on a phone
    const first = U.hintOnce(), second = U.hintOnce();
    ok(mode === 'wide' ? !first && !second : first && !second && $('hint').classList.contains('once'), `${tag}: "tap to explore" shows ${mode === 'wide' ? 'never on a desktop' : 'one time'}`);
    U.status('long readout', 'right', 'short');
    ok($('stMain').textContent === (mode === 'wide' ? 'long readout' : 'short'), `${tag}: the status line is short on a phone`);
    win.close();
  }
}

console.log(`# mobile: ${pass} pass, ${fail} fail`);
if (fail) process.exitCode = 1;
