#!/usr/bin/env node
// ============================================================================
//  EXPLODE CHECK  ·  tools/explode-check.mjs — node tests for lib/explode-bar
//  and its wiring on every machine page
// ----------------------------------------------------------------------------
//  No browser. Four parts:
//    1. placeBar (pure layout): the pill stays at the top of the view, in
//       the band the side panels leave clear, and off the readout and hint.
//    2. explode-bar.css: 44 px targets on a coarse pointer and a phone, the
//       compact phone form, the saver rules.
//    3. The module in jsdom with a fake page: toggle, steps, aria-pressed,
//       the E key (not in an input, not with a modifier), key: null, the
//       saver flags (adapter, html.sn-saver, parent body.sn-saver-on).
//    4. Each wired page: main.js imports the lib and links (no SyntaxError,
//       no missing export). jsdom loads the page's index.html (no scripts).
//       The test then runs the page's own setExplode and its own
//       createExplodeBar({...}) call, cut from main.js, on that DOM. Names
//       that the call reads and the cut does not define (setView, setShow,
//       VIEWS) are stubs. It checks that the bar sits in #stage, that the
//       button and E change S.explodeTarget and the panel slider, that the
//       panel slider value shows on the bar, the saver flags, and the
//       layout on a desktop and a phone (rects stubbed from the page CSS).
//
//  Usage (repo root; jsdom from NODE_PATH):
//    node tools/explode-check.mjs [page ...] [-v]   (-v prints the layouts)
//    node tools/explode-check.mjs --lib             (parts 1-3 only)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { register, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SN = path.join(ROOT, 'stella-nova');
const LIB = path.join(SN, 'lib/explode-bar.js');
const VENDOR = pathToFileURL(path.join(SN, 'vendor/three@0.160.0/')).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s === 'three') return next(${JSON.stringify(VENDOR + 'build/three.module.js')}, c);
    if (s.startsWith('three/addons/')) return next(${JSON.stringify(VENDOR + 'examples/jsm/')} + s.slice(13), c);
    return next(s, c);
  }`));

export const PAGES = {
  'stirling-engine': {}, 'four-stroke-engine': {}, 'wankel-engine': {}, 'radial-engine': {},
  'gear-types': {}, 'planetary-gearbox': {}, 'harmonic-drive': {}, 'differential': {},
  'manual-gearbox': {}, 'cvt': {}, 'universal-joints': {}, 'ball-screw': {}, 'pumps': {},
  'swashplate-pump': {}, 'geneva-cams': {}, 'linkages': {}, 'ratchets': {}, 'sewing-machine': {},
  'watch-movement': { steps: [0, 0.45, 0.9] }, 'watch-randomizer': { steps: [0, 0.45, 0.85] }, 'pendulum-clock': {},
  'antikythera': {}, 'calculators': {}, 'curta': {}, 'enigma-rotors': { noKey: true }, 'pin-tumbler-lock': {},
};

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const overlap = (a, b) => a.r > b.l && a.l < b.r && a.b > b.t && a.t < b.b;

const X = await import(pathToFileURL(LIB).href);
const { placeBar, inSaver, createExplodeBar } = X;

// ── 1. placeBar ─────────────────────────────────────────────────────────────
{
  const bar = { w: 330, h: 42 };
  const rect = (p, b) => ({ l: p.x, t: p.y, r: p.x + b.w, b: p.y + b.h });
  // desktop 1440 x 848: panel 320, analysis 318, readout top left, hint top right
  const read = { l: 334, t: 12, r: 560, b: 110 }, hint = { l: 748, t: 12, r: 1108, b: 30 };
  let p = placeBar({ host: { w: 1440, h: 848 }, bar, clear: { l: 320, r: 1122 }, avoid: [read, hint] });
  ok(p.y <= 48 && !overlap(rect(p, bar), read) && !overlap(rect(p, bar), hint), 'desktop: under the hint, at the top, off the readout', p);
  ok(p.x >= 320 && p.x + bar.w <= 1122, 'desktop: inside the clear band', p);
  p = placeBar({ host: { w: 1440, h: 848 }, bar, clear: { l: 320, r: 1122 }, avoid: [read] });
  ok(p.y === 12 && !overlap(rect(p, bar), read) && Math.abs(p.x + bar.w / 2 - 721) < 40, 'desktop, hint gone: top, near the centre of the clear band', p);
  p = placeBar({ host: { w: 1440, h: 848 }, bar, clear: { l: 0, r: 1440 }, avoid: [{ l: 14, t: 12, r: 240, b: 110 }] });
  ok(p.y === 12 && Math.abs(p.x + bar.w / 2 - 720) < 1, 'desktop, panels closed: top centre', p);
  // phone 390 x 779: readout top left, hint at the base; toggle only
  const pb = { w: 128, h: 52 }, pread = { l: 10, t: 10, r: 210, b: 96 };
  p = placeBar({ host: { w: 390, h: 779 }, bar: pb, clear: { l: 0, r: 390 }, avoid: [pread, { l: 110, t: 740, r: 380, b: 770 }], phone: true });
  ok(p.y === 12 && p.x + pb.w === 378 && !overlap(rect(p, pb), pread), 'phone: top right, off the readout', p);
  // phone with a wide readout: drops below it, still in the top third
  p = placeBar({ host: { w: 390, h: 779 }, bar: pb, clear: { l: 0, r: 390 }, avoid: [{ l: 8, t: 8, r: 300, b: 120 }], phone: true });
  ok(p.y > 120 && p.y < 779 / 3, 'phone, wide readout: below it, in the top third', p);
  // a band too narrow for the pill falls back to the whole host
  p = placeBar({ host: { w: 600, h: 600 }, bar, clear: { l: 320, r: 600 }, avoid: [] });
  ok(p.x >= 12 && p.x + bar.w <= 588, 'narrow band: the whole host', p);
}

// ── 2. CSS ──────────────────────────────────────────────────────────────────
const CSS = fs.readFileSync(path.join(SN, 'lib/explode-bar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
{
  const block = q => { const i = CSS.indexOf(q); if (i < 0) return ''; let d = 0, j = CSS.indexOf('{', i); const s = j; for (; j < CSS.length; j++) { if (CSS[j] === '{') d++; else if (CSS[j] === '}' && --d === 0) break; } return CSS.slice(s, j); };
  const touch = block('@media (pointer:coarse), (max-width:768px)');
  ok(/min-height:44px/.test(touch) && /min-width:44px/.test(touch), 'css: 44 px targets on a coarse pointer');
  const phone = block('@media (max-width:768px), (max-height:500px) and (pointer:coarse)');
  ok(/\.sn-xbar-steps\{display:none\}/.test(phone), 'css: phone shows the toggle only');
  ok(/\.sn-xbar\[hidden\]/.test(CSS) && /html\.sn-saver \.sn-xbar/.test(CSS) && /display:none!important/.test(CSS), 'css: hidden in the saver');
  ok(/--sn-xbar-css:1/.test(CSS), 'css: sets the load marker the module waits for');
  ok(/min-height:32px/.test(block('.sn-xbar button{')), 'css: 32 px targets on a desktop');
}

// ── jsdom ───────────────────────────────────────────────────────────────────
let JSDOM;
try { ({ JSDOM } = createRequire(import.meta.url)('jsdom')); } catch (e) { ok(false, 'jsdom resolves (set NODE_PATH)', e.message); }

const key = (win, k, init = {}, target) => {
  const ev = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  (target || win.document.body).dispatchEvent(ev);
};

// ── 3. module with a fake page ──────────────────────────────────────────────
if (JSDOM) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="stage"><canvas id="view"></canvas><input id="t"></main></body></html>', { pretendToBeVisual: true, url: 'http://localhost/stella-nova/pages/x/index.html' });
  const win = dom.window, doc = win.document;
  const P = { t: 0, saver: false, calls: [] };
  const bar = createExplodeBar({ host: doc.getElementById('stage'), get: () => P.t, set: v => { P.calls.push(v); P.t = v; }, saver: () => P.saver });
  const el = bar.el, tog = el.querySelector('.sn-xbar-tog'), st = [...el.querySelectorAll('.sn-xbar-steps button')];
  ok(el.parentNode.id === 'stage', 'lib: the bar is in the host');
  ok(doc.querySelector('link[data-sn-xbar]') && /explode-bar\.css$/.test(doc.querySelector('link[data-sn-xbar]').href), 'lib: adds its stylesheet');
  ok(el.getAttribute('role') === 'toolbar' && tog.tagName === 'BUTTON' && tog.type === 'button', 'lib: toolbar with a real button');
  ok(tog.getAttribute('aria-pressed') === 'false' && tog.getAttribute('aria-keyshortcuts') === 'E', 'lib: aria-pressed and aria-keyshortcuts');
  ok(/Explode/.test(tog.textContent) && tog.querySelector('svg'), 'lib: icon and label');
  ok(st.length === 3 && st.map(b => b.textContent).join() === 'Assembled,Partly,Exploded', 'lib: three steps');
  tog.click();
  ok(P.t === 1 && tog.getAttribute('aria-pressed') === 'true' && st[2].getAttribute('aria-pressed') === 'true', 'lib: toggle explodes', P);
  tog.click();
  ok(P.t === 0 && tog.getAttribute('aria-pressed') === 'false' && st[0].getAttribute('aria-pressed') === 'true', 'lib: toggle assembles', P);
  st[1].click();
  ok(P.t === 0.5 && st[1].getAttribute('aria-pressed') === 'true' && tog.getAttribute('aria-pressed') === 'true', 'lib: Partly step', P);
  P.t = 0.33; bar.sync();
  ok(st.every(b => b.getAttribute('aria-pressed') === 'false') && tog.getAttribute('aria-pressed') === 'true', 'lib: a free slider value shows no step');
  P.t = 0; bar.sync();
  key(win, 'e');
  ok(P.t === 1, 'lib: E explodes');
  key(win, 'E', { shiftKey: true });
  ok(P.t === 0, 'lib: Shift+E assembles');
  key(win, 'e', { metaKey: true }); key(win, 'e', { ctrlKey: true }); key(win, 'e', { altKey: true }); key(win, 'e', { repeat: true });
  ok(P.t === 0, 'lib: E with a modifier or repeat does nothing');
  key(win, 'e', {}, doc.getElementById('t'));
  ok(P.t === 0, 'lib: E in an input does nothing');
  P.saver = true; bar.sync();
  ok(el.hidden === true, 'lib: hidden while the page saver runs');
  key(win, 'e');
  ok(P.t === 0, 'lib: E does nothing in the saver');
  P.saver = false; bar.sync();
  ok(el.hidden === false, 'lib: back after the saver');
  doc.documentElement.classList.add('sn-saver'); bar.sync();
  ok(el.hidden === true && inSaver(win), 'lib: hidden with html.sn-saver');
  doc.documentElement.classList.remove('sn-saver'); bar.sync();
  ok(el.hidden === false, 'lib: back without html.sn-saver');
  bar.destroy();
  ok(!el.isConnected, 'lib: destroy removes the bar');
  key(win, 'e');
  ok(P.t === 0, 'lib: destroy removes the key handler');

  // key: null and custom steps
  const Q = { t: 0 };
  const b2 = createExplodeBar({ host: doc.getElementById('stage'), get: () => Q.t, set: v => { Q.t = v; }, key: null, steps: [0, 0.45, 0.9] });
  key(win, 'e');
  ok(Q.t === 0 && !b2.el.querySelector('.sn-xbar-tog').hasAttribute('aria-keyshortcuts') && !b2.el.querySelector('kbd'), 'lib: key null turns E off');
  b2.el.querySelector('.sn-xbar-tog').click();
  ok(Q.t === 0.9, 'lib: custom steps (toggle goes to the last)', Q);
  b2.destroy();

  // parent shell in its saver (same origin)
  const shell = new JSDOM('<!doctype html><html><body class="sn-saver-on"><iframe></iframe></body></html>', { pretendToBeVisual: true, url: 'http://localhost/stella-nova/index.html' });
  const fwin = shell.window.document.querySelector('iframe').contentWindow;
  ok(inSaver(fwin), 'lib: hidden when the parent shell has body.sn-saver-on');
  shell.window.close(); win.close();
}

// ── 4. pages ────────────────────────────────────────────────────────────────
// cut a balanced (...) or {...} that starts at the first open char after i
function cut(src, i, open, close) {
  let d = 0, j = src.indexOf(open, i), s = j, q = null;
  for (; j < src.length; j++) {
    const ch = src[j];
    if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === open) d++;
    else if (ch === close && --d === 0) return src.slice(s, j + 1);
  }
  return null;
}

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const keys = process.argv.includes('--lib') ? [] : only.length ? only : Object.keys(PAGES);
for (const k of keys) {
  const opt = PAGES[k];
  if (!opt) { ok(false, `${k}: not in PAGES`); continue; }
  const dir = path.join(SN, 'pages', k);
  const main = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok(/^import \{ createExplodeBar \} from '\.\.\/\.\.\/lib\/explode-bar\.js';$/m.test(main), `${k}: main.js imports the lib`);
  const at = main.indexOf('createExplodeBar({');
  const callArgs = at >= 0 ? cut(main, at, '(', ')') : null;
  ok(!!callArgs, `${k}: main.js calls createExplodeBar`);
  const hookAt = main.search(/^window\.snSaver\s*=/m);
  ok(hookAt > 0, `${k}: has its snSaver hook`);
  ok(at < 0 || at < hookAt, `${k}: the bar is made outside the saver hook`);
  const saverSrc = hookAt > 0 ? main.slice(hookAt) : '';
  ok(!/xbar|createExplodeBar/.test(saverSrc), `${k}: the saver does not use the bar`);
  ok(/saver:\s*\(\)\s*=>\s*saverOn/.test(callArgs || ''), `${k}: the bar reads the page saver flag`);
  // the call runs at load: S and saverOn must be declared above it (no TDZ)
  const declS = main.search(/^(const|let) S = /m), declSaver = main.search(/^let saverOn\b|^let [^;\n]*\bsaverOn = false/m);
  ok(declS >= 0 && declSaver >= 0 && declS < at && declSaver < at, `${k}: S and saverOn are declared before the call`, { declS, declSaver, at });
  if (opt.noKey) ok(/key:\s*null/.test(callArgs || ''), `${k}: E is off (the page types letters)`);
  if (opt.steps) ok((callArgs || '').includes(`steps: [${opt.steps.join(', ')}]`), `${k}: steps match the page's own exploded value`);

  // link: no SyntaxError and no missing export (a browser global at run time is fine)
  try { await import(pathToFileURL(path.join(dir, 'main.js')).href + '?x=' + Date.now()); ok(true, `${k}: main.js links`); }
  catch (e) {
    const bad = e instanceof SyntaxError || /does not provide an export|Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e && (e.code || '') + e.message));
    ok(!bad, `${k}: main.js links`, String(e && e.message).slice(0, 160));
  }
  if (!JSDOM || !callArgs) continue;

  const fnAt = main.indexOf('function setExplode(');
  const fnBody = fnAt >= 0 ? cut(main, fnAt, '{', '}') : null;
  const fnSrc = fnBody ? main.slice(fnAt, main.indexOf(fnBody, fnAt) + fnBody.length) : null;
  ok(!!fnSrc, `${k}: has its own setExplode`);
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(body, { pretendToBeVisual: true, url: `http://localhost/stella-nova/pages/${k}/index.html` });
  const win = dom.window, doc = win.document;
  const stage = doc.getElementById('stage');
  ok(stage && stage.querySelector('#view'), `${k}: #stage holds the 3D view`);
  const S = { explodeTarget: 0, explode: 0, view: 'three' };
  const scope = { S, $: id => doc.getElementById(id), createExplodeBar, saverOn: false, document: doc, window: win, calls: [] };
  const steps = opt.steps || [0, 0.5, 1], top = steps[2];
  scope.setView = name => { scope.calls.push(['setView', name]); S.view = name; scope.setExplode(name === 'exploded' ? top : 0); };
  scope.setShow = (...a) => scope.calls.push(['setShow', ...a]);
  const stubs = new Proxy(scope, {
    has: (t, p) => typeof p === 'string' && p !== 'scope' && p !== 'undefined' && (p in t || !(p in globalThis)),
    get: (t, p) => {
      if (p === Symbol.unscopables) return undefined;
      if (p in t) return t[p];
      if (p === 'VIEWS') return {};
      return (...a) => { t.calls.push([p, ...a]); };
    },
    set: (t, p, v) => { t[p] = v; return true; },
  });
  let bar = null;
  try {
    // eslint-disable-next-line no-new-func
    const run = new Function('scope', `with (scope) { ${fnSrc}\n scope.setExplode = setExplode;\n return createExplodeBar${callArgs}; }`);
    bar = run(stubs);
  } catch (e) { ok(false, `${k}: the wiring runs`, e.message); continue; }
  ok(bar && bar.el && bar.el.parentNode === stage, `${k}: the bar is in #stage`);
  const tog = bar.el.querySelector('.sn-xbar-tog'), st = [...bar.el.querySelectorAll('.sn-xbar-steps button')];
  const slider = doc.getElementById('explode');
  ok(!!slider, `${k}: the panel slider is still there`);
  tog.click();
  ok(Math.abs(S.explodeTarget - top) < 1e-9 && Math.abs(+slider.value - S.explodeTarget) < 1e-9, `${k}: the button explodes (page target and panel slider)`, { t: S.explodeTarget, s: slider.value });
  ok(tog.getAttribute('aria-pressed') === 'true', `${k}: aria-pressed after explode`);
  tog.click();
  ok(S.explodeTarget === 0 && +slider.value === 0 && tog.getAttribute('aria-pressed') === 'false', `${k}: the button assembles`, S.explodeTarget);
  key(win, 'e');
  if (opt.noKey) ok(S.explodeTarget === 0, `${k}: E does nothing (typing page)`);
  else {
    ok(Math.abs(S.explodeTarget - top) < 1e-9, `${k}: E explodes`, S.explodeTarget);
    key(win, 'e');
    ok(S.explodeTarget === 0, `${k}: E assembles`, S.explodeTarget);
  }
  // the panel slider moves: the bar follows
  scope.setExplode(steps[1]); bar.sync();
  ok(st[1].getAttribute('aria-pressed') === 'true' && tog.getAttribute('aria-pressed') === 'true', `${k}: the bar follows the panel slider`);
  scope.setExplode(0); bar.sync();
  stubs.saverOn = true; bar.sync();
  ok(bar.el.hidden, `${k}: hidden in the page saver`);
  key(win, 'e');
  ok(S.explodeTarget === 0, `${k}: E does nothing in the saver`);
  stubs.saverOn = false; bar.sync();
  doc.documentElement.classList.add('sn-saver'); bar.sync();
  ok(bar.el.hidden, `${k}: hidden with html.sn-saver`);
  doc.documentElement.classList.remove('sn-saver'); bar.sync();
  ok(!bar.el.hidden, `${k}: shown out of the saver`);

  // layout: rects stubbed from the page CSS (panel 320, analysis 318,
  // readout top left, hint top right on a desktop; at the base on a phone)
  const R = (l, t, w, h) => () => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t });
  const lay = (W, H, top, rects, barW, barH, phone) => {
    win.matchMedia = q => ({ matches: phone, media: q, addEventListener() {}, removeEventListener() {} });
    const b = (() => { bar.destroy(); return new Function('scope', `with (scope) { return createExplodeBar${callArgs}; }`)(stubs); })();
    stage.getBoundingClientRect = R(0, top, W, H);
    for (const [sel, r] of Object.entries(rects)) { const e = doc.querySelector(sel); if (e) e.getBoundingClientRect = R(r[0], r[1] + top, r[2], r[3]); }
    Object.defineProperty(b.el, 'offsetWidth', { value: barW, configurable: true });
    Object.defineProperty(b.el, 'offsetHeight', { value: barH, configurable: true });
    const gcs = win.getComputedStyle.bind(win);
    win.getComputedStyle = e => { const s = gcs(e); return e === b.el ? { getPropertyValue: p => (p === '--sn-xbar-css' ? '1' : s.getPropertyValue(p)) } : s; };
    b.place();
    win.getComputedStyle = gcs;
    const x = parseFloat(b.el.style.left), y = parseFloat(b.el.style.top);
    const me = { l: x, t: y, r: x + barW, b: y + barH };
    const hits = Object.entries(rects).filter(([sel, r]) => !/panel|anaPanel/i.test(sel) && doc.querySelector(sel) && overlap(me, { l: r[0], t: r[1], r: r[0] + r[2], b: r[1] + r[3] })).map(([s]) => s);
    bar = b;
    return { x, y, hits, visible: b.el.style.visibility !== 'hidden' };
  };
  const readSel = doc.getElementById('read') ? '#read' : '#regs';
  const d = lay(1440, 848, 52, { '#panel': [0, 0, 320, 848], '#anaPanel': [1122, 0, 318, 848], [readSel]: [334, 12, 226, 98], '#hint': [748, 12, 360, 18] }, 330, 42, false);
  ok(d.visible && d.y <= 48 && !d.hits.length && d.x >= 320 && d.x + 330 <= 1122, `${k}: desktop layout: top of the view, clear of panels and top elements`, d);
  const ph = lay(390, 779, 46, { '#panel': [0, 520, 390, 259], [readSel]: [10, 10, 200, 86], '#hint': [110, 740, 270, 30] }, 128, 52, true);
  ok(ph.visible && ph.y <= 20 && !ph.hits.length, `${k}: phone layout: top right, clear of the readout`, ph);
  if (process.argv.includes('-v')) console.log(`  ${k}: desktop (${d.x}, ${d.y}), phone (${ph.x}, ${ph.y})`);
  bar.destroy();
  win.close();
}

console.log(`explode-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
