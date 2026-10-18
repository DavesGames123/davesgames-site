// ============================================================================
//  CORAL REEF  ·  tests/panel.test.mjs  ·  PANEL: the control panel (jsdom)
// ----------------------------------------------------------------------------
//  The user said "the options table is very vibecoded and we need it to be
//  much much cleaner" (2026-10-18). lib/sn-panel.js and lib/sn-panel.css
//  make the panel now. This file checks:
//    lib ........ the panel API in jsdom: sections, every control type,
//                 labels tied to inputs, collapse state in localStorage,
//                 a page that works when the storage throws
//    page ....... index.html and main.js boot (no WebGL, as mobile-check)
//                 at 1440x900 and 390x844: no errors, the sections in
//                 order, the old control ids that keep a purpose, labels,
//                 keyboard order = visual order, a stored collapse state
//                 that holds after a reload, the feed and gradient rows
//    css ........ no text under 12 px, 44 px targets in the touch block, no
//                 CSS order, no uppercase, reduced motion, WCAG AA contrast
//                 of the panel text over the worst backdrop
//  Needs jsdom 24 (JSDOM_DIR or NODE_PATH). Without it the file fails: a
//  skipped panel check is not a pass.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..');
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
  console.log('panel: 0 passed, 1 failed');
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
const KEYS = ['window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'localStorage'];
function globalsFor(win, w, h) {
  const G = globalThis;
  for (const k of KEYS) Object.defineProperty(G, k, { value: k === 'window' ? win : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]), configurable: true, writable: true });
  G.matchMedia = win.matchMedia; G.addEventListener = win.addEventListener.bind(win);
  G.devicePixelRatio = 2; G.innerWidth = w; G.innerHeight = h;
}

// ── lib: the panel API ─────────────────────────────────────────────────────
const { createPanel, sheetSnap, icon } = await import(pathToFileURL(path.join(LIB, 'sn-panel.js')).href);
{
  const dom = new JSDOM('<!doctype html><body><div id="p"></div></body>', { url: 'http://localhost/x/' });
  const win = dom.window; globalsFor(win, 1200, 800);
  const P = createPanel(win.document.getElementById('p'), { store: 'unit' });
  const s1 = P.section({ id: 'a', title: 'Alpha', open: true });
  const s2 = P.section({ id: 'b', title: 'Beta', open: false });
  let seg = null, tog = null, sl = null, sel = null;
  s1.segmented({ id: 'seg', label: 'Squad', items: [{ id: 2, label: '2' }, { id: 3, label: '3' }], value: 2, onChange: v => { seg = v; } });
  s1.chips({ id: 'chp', label: 'Region', items: 'abcdef'.split('').map(c => ({ id: c, label: c.toUpperCase() })), value: null, columns: 3 });
  s1.slider({ id: 'sl', valueId: 'vsl', label: 'Strength', min: 0, max: 2, step: 0.1, value: 1, unit: 'm/s', format: v => v.toFixed(1), onInput: v => { sl = v; } });
  s2.toggle({ id: 'tg', label: 'Snow', value: true, onChange: v => { tog = v; }, hint: 'Flakes in the water.' });
  s2.select({ id: 'se', label: 'Species', options: [{ id: 'x', label: 'X', group: 'G1' }, { id: 'y', label: 'Y', group: 'G2' }], value: 'y', onChange: v => { sel = v; } });
  P.button({ section: 'b', id: 'bt', label: 'Go', kind: 'primary' });
  const d = win.document, $ = id => d.getElementById(id);
  const heads = [...d.querySelectorAll('.snp-head')];
  ok(heads.length === 2 && heads[0].getAttribute('aria-expanded') === 'true' && heads[1].getAttribute('aria-expanded') === 'false' && d.querySelectorAll('.snp-body')[1].hidden, 'lib: two sections, the open defaults hold');
  ok(heads.every(h => d.getElementById(h.getAttribute('aria-controls'))), 'lib: each head controls its body (aria-controls)');
  $('seg').querySelector('[data-id="3"]').click();
  ok(seg === 3 && $('seg').querySelector('[data-id="3"]').classList.contains('on') && $('seg').querySelector('[data-id="3"]').getAttribute('aria-pressed') === 'true' && $('seg').querySelector('[data-id="2"]').getAttribute('aria-pressed') === 'false', 'lib: a segmented click selects one and sets aria-pressed');
  ok(d.getElementById($('seg').getAttribute('aria-labelledby')).textContent === 'Squad', 'lib: the segmented group is named by its label');
  ok($('chp').style.getPropertyValue('--cols') === '3' && $('chp').querySelectorAll('.on').length === 0, 'lib: chips in 3 columns, none on with value null');
  $('sl').value = '1.5'; $('sl').dispatchEvent(new win.Event('input'));
  ok(sl === 1.5 && $('vsl').textContent === '1.5 m/s' && $('sl').getAttribute('aria-valuetext') === '1.5 m/s', 'lib: the slider shows the value with its unit', $('vsl').textContent);
  ok(d.querySelector('label[for="sl"]').textContent === 'Strength', 'lib: the slider label is tied to the input');
  $('tg').click();
  ok(tog === false && $('tg').getAttribute('role') === 'switch' && d.querySelector('label[for="tg"]'), 'lib: the toggle is a labelled switch');
  const info = d.querySelector('.snp-info');
  ok(info && d.getElementById(info.getAttribute('aria-controls')).hidden, 'lib: a hint is hidden behind the info button');
  info.click();
  ok(!d.getElementById(info.getAttribute('aria-controls')).hidden && info.getAttribute('aria-expanded') === 'true', 'lib: the info button shows the hint');
  ok(!d.querySelector('label[for="tg"]').contains(info), 'lib: the info button is outside the toggle label (a tap on it does not toggle)');
  ok($('se').querySelectorAll('optgroup').length === 2 && $('se').value === 'y', 'lib: the select groups its options');
  $('se').value = 'x'; $('se').dispatchEvent(new win.Event('change'));
  ok(sel === 'x', 'lib: the select change fires');
  ok(P.find('seg') && P.find('tg').value === false && P.find('nope') === null, 'lib: find gives the controls by id');
  heads[1].click();
  ok(win.localStorage.getItem('snp:unit:b') === '1' && !d.querySelectorAll('.snp-body')[1].hidden, 'lib: a head click opens the section and stores the state');
  // a new panel reads the stored state
  const p2 = d.createElement('div'); d.body.appendChild(p2);
  const Q = createPanel(p2, { store: 'unit' });
  ok(Q.section({ id: 'b', title: 'Beta', open: false }).open === true, 'lib: the stored state wins over the default');
  // storage that throws
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('denied'); }, configurable: true });
  let threw = false;
  try { const p3 = d.createElement('div'); const R = createPanel(p3, { store: 'x' }); const s = R.section({ id: 'z', title: 'Z' }); s.head.click(); } catch (e) { threw = true; }
  ok(!threw, 'lib: the panel works when localStorage throws');
  ok(sheetSnap('half', -90) === 'full' && sheetSnap('full', 90) === 'half' && sheetSnap('half', 90) === 'closed' && sheetSnap('half', 2) === 'full', 'lib: sheetSnap');
  ok(/<svg[^>]*aria-hidden="true"/.test(icon('menu')), 'lib: icons are hidden from screen readers');
  win.close();
}

// ── page boot (no WebGL) ───────────────────────────────────────────────────
const html = fs.readFileSync(path.join(PAGE, 'index.html'), 'utf8');
let run = 0;
async function boot(w, h, coarse, store = {}) {
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, '').replace(/<script src="[^"]*"><\/script>/g, ''), { url: 'http://localhost:8963/stella-nova/pages/coral-reef/index.html', pretendToBeVisual: true });
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
const KEPT = ['rovCount', 'bLead', 'bSeed', 'quality', 'feedMode', 'sstvMode', 'tFeed', 'tOrbit', 'modes', 'modeNote', 'gradPick',
  'tBeam', 'tSnow', 'tPolyps', 'tDetail', 'sCaust', 'vCaust', 'sDir', 'vDir', 'sCur', 'vCur', 'sTemp', 'vTemp', 'bleachNote', 'aboutOpen',
  'panelClose', 'sheetGrip', 'gear', 'dockCam', 'dockFeed', 'dockMode', 'dockMenu', 'camBar', 'feedSize', 'rDist', 'rDepth', 'rCol', 'rTask', 'rState'];
const REMOVED = {
  regionNote: 'a hint of the region chips (info button)',
  worldNote: 'a hint of the detail control (info button)',
  dockSeed: 'New world is in the World section; the dock keeps 4 key actions',
  rChunks: 'a debug count; window.__coralDebug().stream has it',
};
// The region picker comes with the region code of WORLD (goRegion in main.js).
const REGIONS = /function goRegion\(/.test(fs.readFileSync(path.join(PAGE, 'main.js'), 'utf8'));
if (REGIONS) KEPT.push('regions', 'rRegion');
const SECTIONS = ['explore', 'view', 'look', 'world', 'about'];
const OPEN = { explore: true, view: true, look: true, world: false, about: false };

for (const [w, h, coarse] of [[1440, 900, false], [390, 844, true]]) {
  const tag = `${w}x${h}`;
  const { win, doc, errs } = await boot(w, h, coarse);
  const $ = id => doc.getElementById(id);
  ok(errs.length === 0, `${tag}: main.js boots with no errors`, errs.slice(0, 3).join(' | '));
  if (errs.length) continue;
  const panel = $('panel');
  ok(KEPT.every(id => $(id)), `${tag}: every old control with a purpose is there`, KEPT.filter(id => !$(id)).join());
  ok(Object.keys(REMOVED).every(id => !$(id)), `${tag}: the removed ids are gone (${Object.entries(REMOVED).map(([k, v]) => `${k}: ${v}`).join('; ')})`);
  const secs = [...panel.querySelectorAll('.snp-sec')].map(s => s.dataset.sec);
  ok(secs.join() === SECTIONS.join(), `${tag}: the sections are Explore, View, Look, World, About`, secs.join());
  ok(SECTIONS.every(id => !panel.querySelector(`.snp-sec[data-sec=${id}] .snp-body`).hidden === OPEN[id]), `${tag}: Explore, View and Look start open; World and About start closed`);
  const inSec = (id, sec) => panel.querySelector(`.snp-sec[data-sec=${sec}]`).contains($(id));
  ok([...(REGIONS ? ['regions'] : []), 'rovCount', 'bLead'].every(id => inSec(id, 'explore')) && ['tFeed', 'feedMode', 'sstvMode', 'tOrbit'].every(id => inSec(id, 'view'))
    && ['modes', 'gradPick', 'tBeam', 'tSnow', 'tPolyps', 'tDetail', 'sCaust'].every(id => inSec(id, 'look'))
    && ['quality', 'bSeed', 'sDir', 'sCur', 'sTemp'].every(id => inSec(id, 'world')) && inSec('aboutOpen', 'about'), `${tag}: each control is in its section`);
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
  const txt = [panel, $('dock'), $('camBar'), $('feed'), $('gear')].map(e => e.textContent).join(' ');
  const glyph = txt.match(/[←-⯿\u{1F000}-\u{1FAFF}]/gu);
  ok(!glyph, `${tag}: no glyph or emoji icons in the panel, dock and camera bar`, glyph ? glyph.join('') : '');
  ok([...doc.querySelectorAll('[data-icon]')].every(e => e.querySelector('svg')), `${tag}: every icon slot has its SVG`);
  // keyboard order: the DOM order is the section order; no positive tabindex
  const foc = [...panel.querySelectorAll('button, input, select, a[href]')].filter(e => !e.closest('[hidden]') && !e.disabled);
  const idx = foc.map(e => { const s = e.closest('.snp-sec'); return s ? SECTIONS.indexOf(s.dataset.sec) : -1; });
  ok(idx.every((v, i) => i === 0 || v >= idx[i - 1]), `${tag}: the keyboard order follows the section order`);
  ok(![...doc.querySelectorAll('[tabindex]')].some(e => +e.getAttribute('tabindex') > 0), `${tag}: no positive tabindex`);
  // the feed rows
  const row = id => $(id).closest('.snp-row');
  ok(!row('feedMode').hidden && row('sstvMode').hidden, `${tag}: the slow-scan mode row shows only for slow scan`);
  $('feedMode').querySelector('[data-id="sstv"]').click();
  ok(!row('sstvMode').hidden, `${tag}: slow scan shows the slow-scan mode row`);
  $('tFeed').click();
  ok(row('feedMode').hidden && row('sstvMode').hidden, `${tag}: a feed that is off hides its signal rows`);
  $('tFeed').click();
  // the gradient row follows the colour mode
  ok(row('gradPick').hidden, `${tag}: Natural hides the gradient`);
  $('modes').querySelector('[data-id="age"]').click();
  ok(!row('gradPick').hidden && $('modes').querySelector('.on').dataset.id === 'age', `${tag}: Age shows the gradient`);
  $('dockMode').click();
  ok($('modes').querySelector('.on').dataset.id === 'depth' && $('modes').querySelector('[data-id="depth"]').getAttribute('aria-pressed') === 'true', `${tag}: the dock colour button moves the panel chip too`);
  // collapse persists
  panel.querySelector('.snp-sec[data-sec=world] .snp-head').click();
  panel.querySelector('.snp-sec[data-sec=look] .snp-head').click();
  ok(win.localStorage.getItem('snp:coral-reef:world') === '1' && win.localStorage.getItem('snp:coral-reef:look') === '0', `${tag}: a head click stores the section state`);
  const store = { 'snp:coral-reef:world': '1', 'snp:coral-reef:look': '0' };
  win.close();
  const B = await boot(w, h, coarse, store);
  const bp = B.doc.getElementById('panel');
  ok(B.errs.length === 0 && !bp.querySelector('.snp-sec[data-sec=world] .snp-body').hidden && bp.querySelector('.snp-sec[data-sec=look] .snp-body').hidden, `${tag}: after a reload World stays open and Look stays closed`);
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
  const tq = (() => { const i = lib.indexOf('@media (pointer:coarse), (max-width:768px)'); let d = 0, j = lib.indexOf('{', i); for (let k = j; k < lib.length; k++) { if (lib[k] === '{') d++; else if (lib[k] === '}' && --d === 0) return lib.slice(j, k + 1); } return ''; })();
  for (const sel of ['.snp-head', '.snp-chips .snp-opt', '.snp-btn', '.snp-sel', '.snp-tlabel', '.snp-link']) ok(new RegExp(sel.replace(/[.*]/g, '\\$&') + '\\{min-height:44px').test(tq), `css: ${sel} is 44 px tall on touch`);
  ok(/\.snp-range\{height:44px/.test(tq) && /\.snp-iconbtn\{width:44px;height:44px/.test(tq) && /\.snp-info\{width:44px;height:44px/.test(tq) && /\.snp-check\{width:52px;height:44px/.test(tq), 'css: sliders, icon buttons, info buttons and switches are 44 px on touch');
  // the segmented cells are 40 px in a 2 px well with 2 px of padding: 44 px
  ok(/\.snp-seg \.snp-opt\{min-height:40px/.test(tq) && /\.snp-seg\{padding:2px/.test(tq), 'css: segmented cells reach 44 px with the well padding');

  // WCAG AA: panel text over the worst backdrop (the bright shallows, white)
  const tok = n => { const m = lib.match(new RegExp(`--${n}:([^;]+);`)); return m ? m[1].trim() : null; };
  const rgba = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (m) { const v = m[1].split(',').map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; } const h = s.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1); };
  const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3]));
  const lum = c => { const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const bg = rgba(tok('snp-bg'));
  for (const back of [[255, 255, 255], [0, 0, 0], [64, 200, 210]]) {
    const pb = over(bg, back);
    const ink = ratio(rgba(tok('snp-ink')), pb), dim = ratio(rgba(tok('snp-dim')), pb), acc = ratio(rgba(tok('snp-accent')), pb);
    ok(ink >= 7 && dim >= 4.5 && acc >= 4.5, `css: contrast over rgb(${back}) backdrop: ink ${ink.toFixed(1)}, dim ${dim.toFixed(1)}, accent ${acc.toFixed(1)} (AA 4.5)`);
  }
  const onAcc = ratio(rgba(tok('snp-accent-ink')), rgba(tok('snp-accent')));
  ok(onAcc >= 4.5, `css: primary button text on the accent: ${onAcc.toFixed(1)}`);
}

console.log(`panel: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
