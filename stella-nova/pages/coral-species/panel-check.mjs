// ============================================================================
//  CORAL SPECIES  ·  panel-check.mjs  ·  the control panel in jsdom
// ----------------------------------------------------------------------------
//  The user said "the options table is very vibecoded and we need it to be
//  much much cleaner" (2026-10-18). lib/sn-panel.js makes the panel now
//  (its unit checks are in ../coral-reef/tests/panel.test.mjs). This file
//  boots index.html and main.js (no WebGL) at 1440x900 and 390x844 and
//  checks: no errors, the sections Species, Growth, Look, View, About, the
//  old control ids that keep a purpose, labels tied to inputs, keyboard
//  order = visual order, a stored collapse state that holds after a
//  reload, the grow button and the dock, and the CSS rules (12 px text,
//  no CSS order, no uppercase, [hidden]). tests.mjs runs it (section 8).
//  Needs jsdom 24 (JSDOM_DIR or NODE_PATH): without it the file fails.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = HERE;
const LIB = path.join(PAGE, '../../lib');
const VENDOR = pathToFileURL(path.join(PAGE, '../../vendor/three@0.160.0/')).href;
register('data:text/javascript,' + encodeURIComponent(`
  const V = ${JSON.stringify(VENDOR)};
  export async function resolve(s, c, n) {
    if (s === 'three') return n(V + 'build/three.module.js', c);
    if (s.startsWith('three/addons/')) return n(V + 'examples/jsm/' + s.slice(13), c);
    return n(s, c);
  }`));
const require = createRequire(import.meta.url);
let JSDOM;
try {
  const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
  ({ JSDOM } = require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })));
} catch (e) {
  console.log('FAIL jsdom not found (set JSDOM_DIR or NODE_PATH)');
  console.log('panel-check: 0 passed, 1 failed');
  process.exit(1);
}

let pass = 0, fail = 0;
function ok(cond, name, info = '') {
  if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); }
}

function mediaFor(w, h, coarse) {
  const feat = f => {
    const [k, v] = f.trim().replace(/^\(|\)$/g, '').split(':').map(s => s.trim()), n = parseFloat(v);
    if (k === 'max-width') return w <= n;
    if (k === 'min-width') return w >= n;
    if (k === 'max-height') return h <= n;
    if (k === 'min-height') return h >= n;
    if (k === 'pointer') return (v === 'coarse') === coarse;
    if (k === 'orientation') return (v === 'landscape') === (w > h);
    return false;
  };
  return q => ({ matches: q.split(',').some(part => part.split(/\band\b/).every(feat)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
const KEYS = ['window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'localStorage', 'sessionStorage', 'location'];
function globalsFor(win, w, h) {
  const G = globalThis;
  for (const k of KEYS) Object.defineProperty(G, k, { value: k === 'window' ? win : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]), configurable: true, writable: true });
  G.matchMedia = win.matchMedia; G.addEventListener = win.addEventListener.bind(win);
  G.devicePixelRatio = 2; G.innerWidth = w; G.innerHeight = h;
}

// ── page boot (no WebGL) ───────────────────────────────────────────────────
const html = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8');
let run = 0;
async function boot(w, h, coarse, store = {}) {
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, '').replace(/<script src="[^"]*"><\/script>/g, ''), { url: 'http://localhost:8963/stella-nova/pages/coral-species/index.html', pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
  win.matchMedia = mediaFor(w, h, coarse);
  win.HTMLCanvasElement.prototype.getContext = () => null;
  for (const [k, v] of Object.entries(store)) win.localStorage.setItem(k, v);
  globalsFor(win, w, h);
  const errs = [], cerr = console.error;
  console.error = (...a) => { if (!/^THREE\.WebGLRenderer/.test(String(a[0]))) errs.push(a.map(String).join(' ')); };
  try { await import(pathToFileURL(path.join(PAGE, 'main.js')).href + `?panel=${run++}`); } catch (e) { errs.push(e.stack || String(e)); }
  console.error = cerr;
  return { win, doc: win.document, errs };
}

// The old control ids. A kept id has the same purpose; the removed ones say why.
const KEPT = ['species', 'spNote', 'bPlay', 'bRegrow', 'bSeed', 'sSpeed', 'vSpeed', 'modes', 'modeNote', 'gradPick', 'tPolyps',
  'tOrbit', 'tBeam', 'tSnow', 'sCaust', 'vCaust', 'sDown', 'vDown', 'reefLink',
  'panelClose', 'sheetGrip', 'gear', 'dockSp', 'dockPlay', 'dockRegrow', 'dockMenu', 'rSp', 'rN', 'rH', 'rP', 'rAge', 'rBar', 'rState'];
const REMOVED = {};
const SECTIONS = ['species', 'growth', 'look', 'view', 'about'];
const OPEN = { species: true, growth: true, look: true, view: false, about: false };
const STORE = 'coral-species';

for (const [w, h, coarse] of [[1440, 900, false], [390, 844, true]]) {
  const tag = `${w}x${h}`;
  const { win, doc, errs } = await boot(w, h, coarse);
  const $ = id => doc.getElementById(id);
  ok(errs.length === 0, `${tag}: main.js boots with no errors`, errs.slice(0, 3).join(' | '));
  if (errs.length) continue;
  const panel = $('panel');
  ok(KEPT.every(id => $(id)), `${tag}: every old control with a purpose is there`, KEPT.filter(id => !$(id)).join());
  ok(Object.keys(REMOVED).every(id => !$(id)), `${tag}: no old id was removed`);
  const secs = [...panel.querySelectorAll('.snp-sec')].map(s => s.dataset.sec);
  ok(secs.join() === SECTIONS.join(), `${tag}: the sections are Species, Growth, Look, View, About`, secs.join());
  ok(SECTIONS.every(id => !panel.querySelector(`.snp-sec[data-sec=${id}] .snp-body`).hidden === OPEN[id]), `${tag}: Species, Growth and Look start open; View and About start closed`);
  const inSec = (id, sec) => panel.querySelector(`.snp-sec[data-sec=${sec}]`).contains($(id));
  ok(['species', 'spNote'].every(id => inSec(id, 'species')) && ['bPlay', 'bRegrow', 'bSeed', 'sSpeed'].every(id => inSec(id, 'growth'))
    && ['modes', 'gradPick', 'tPolyps'].every(id => inSec(id, 'look')) && ['tOrbit', 'tBeam', 'tSnow', 'sCaust', 'sDown'].every(id => inSec(id, 'view'))
    && inSec('reefLink', 'about'), `${tag}: each control is in its section`);
  // labels
  const named = e => {
    if (e.getAttribute('aria-label')) return true;
    const lb = e.getAttribute('aria-labelledby'); if (lb) return lb.split(' ').every(i => doc.getElementById(i) && doc.getElementById(i).textContent.trim());
    if (e.id && doc.querySelector(`label[for="${e.id}"]`) && doc.querySelector(`label[for="${e.id}"]`).textContent.trim()) return true;
    if (e.tagName === 'INPUT' && e.closest('label') && e.closest('label').textContent.trim()) return true;   // a wrapping label
    return /^(BUTTON|A)$/.test(e.tagName) && e.textContent.trim().length > 0;
  };
  const bad = [...panel.querySelectorAll('input, select, button, [role=group], [role=radiogroup], a')].filter(e => !named(e));
  ok(bad.length === 0, `${tag}: every input, group and button in the panel has a name`, bad.map(e => e.outerHTML.slice(0, 80)).join(' | '));
  ok([...panel.querySelectorAll('input[type=range], input[type=checkbox], select')].every(e => doc.querySelector(`label[for="${e.id}"]`) || e.closest('.gg-rev')), `${tag}: every range, switch and select has a label[for]`);
  // no glyph icons and no emoji as text (the icons are SVG)
  const txt = [panel, $('dock'), $('gear')].map(e => e.textContent).join(' ');
  const glyph = txt.match(/[←-⯿\u{1F000}-\u{1FAFF}]/gu);
  ok(!glyph, `${tag}: no glyph or emoji icons in the panel and the dock`, glyph ? glyph.join('') : '');
  ok([...doc.querySelectorAll('[data-icon]')].every(e => e.querySelector('svg')), `${tag}: every icon slot has its SVG`);
  // keyboard order: the DOM order is the section order; no positive tabindex
  const foc = [...panel.querySelectorAll('button, input, select, a[href]')].filter(e => !e.closest('[hidden]') && !e.disabled);
  const idx = foc.map(e => { const s = e.closest('.snp-sec'); return s ? SECTIONS.indexOf(s.dataset.sec) : -1; });
  ok(idx.every((v, i) => i === 0 || v >= idx[i - 1]), `${tag}: the keyboard order follows the section order`);
  ok(![...doc.querySelectorAll('[tabindex]')].some(e => +e.getAttribute('tabindex') > 0), `${tag}: no positive tabindex`);
  // grow and pause: the panel button and the dock agree
  $('bPlay').click();
  ok(/Grow/.test($('bPlay').textContent) && /Grow/.test($('dockPlay').textContent) && $('bPlay').classList.contains('snp-primary'), `${tag}: pause turns the primary button and the dock to Grow`);
  $('dockPlay').click();
  ok(/Pause/.test($('bPlay').textContent), `${tag}: the dock Grow turns the button back to Pause`);
  // the species picker and the card
  $('species').querySelector('[data-id="table"]').click();
  ok($('species').querySelector('.on').dataset.id === 'table' && /Table/.test($('spNote').textContent) && $('spNote').querySelector('.ic-latin i'), `${tag}: a species chip fills the info card`);
  $('dockSp').click();
  ok($('species').querySelector('.on').dataset.id !== 'table', `${tag}: the dock species button moves the panel chip too`);
  // collapse persists
  panel.querySelector('.snp-sec[data-sec=view] .snp-head').click();
  panel.querySelector('.snp-sec[data-sec=look] .snp-head').click();
  ok(win.localStorage.getItem(`snp:${STORE}:view`) === '1' && win.localStorage.getItem(`snp:${STORE}:look`) === '0', `${tag}: a head click stores the section state`);
  const store = { [`snp:${STORE}:view`]: '1', [`snp:${STORE}:look`]: '0' };
  win.close();
  const B = await boot(w, h, coarse, store);
  const bp = B.doc.getElementById('panel');
  ok(B.errs.length === 0 && !bp.querySelector('.snp-sec[data-sec=view] .snp-body').hidden && bp.querySelector('.snp-sec[data-sec=look] .snp-body').hidden, `${tag}: after a reload View stays open and Look stays closed`);
  ok(bp.querySelector('.snp-sec[data-sec=look] .snp-head').getAttribute('aria-expanded') === 'false', `${tag}: the closed head says aria-expanded false`);
  B.win.close();
}

// ── css ─────────────────────────────────────────────────────────────────────
{
  const page = fs.readFileSync(path.join(PAGE, 'style.css'), 'utf8');
  const lib = fs.readFileSync(path.join(LIB, 'sn-panel.css'), 'utf8');
  const all = page + lib;
  const sizes = [...all.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?([\d.]+)(rem|px)/g)].map(m => (m[2] === 'rem' ? +m[1] * 16 : +m[1]));
  ok(sizes.length > 10 && sizes.every(v => v >= 12), 'css: no text under 12 px in style.css and sn-panel.css', sizes.filter(v => v < 12).join());
  ok(!/(?:^|[;{\s])order\s*:/.test(all), 'css: no CSS order (the keyboard order is the visual order)');
  ok(!/text-transform\s*:\s*uppercase/.test(all) && !/letter-spacing\s*:\s*[^0n]/.test(all), 'css: no uppercase labels, no letter-spacing');
  ok(/prefers-reduced-motion:reduce\)\{[^}]*\.snp[^{]*\{[^}]*transition:none/.test(lib), 'css: reduced motion stops the panel transitions');
  ok(/\.snp :focus-visible\{outline:2px solid/.test(lib), 'css: a focus ring on every panel control');
  ok(page.includes('[hidden]{display:none!important}'), 'css: [hidden]{display:none!important}');
  ok(!/Playfair|Cormorant|JetBrains/.test(all), 'css: none of the fonts that the user dislikes');
}

console.log(`panel-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
