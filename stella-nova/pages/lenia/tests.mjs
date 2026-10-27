// tests.mjs - node checks for pages/lenia that need no GPU and no browser.
//   node stella-nova/pages/lenia/tests.mjs
// The engine tests (WebGPU through Deno) are in tools/engine_test.js.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { renderBudget, BUDGET } from './budget.js';
import { wrap, wrapDelta } from './app/torus.js';
import { familyOf, familyColor, cellsOf, rotate, lut } from './app/catalog.js';
import { CORE_TEX, GROWTH_SYM, RULE_CLASS, SAVER_CORE, SAVER_GROWTH, growthTeX } from './app/tex.js';
import { mulberry, saverGrid, gridCentroid, gridPeaks } from './app/saver/grid.js';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const show = (name, o) => { const b = renderBudget(o); console.log(`      ${name}: dpr ${b.dpr.toFixed(2)}, ${(b.px / 1e6).toFixed(2)} M px, cubic from ${b.cubicMin} px`); return b; };

// Phone profile (touch, PHONE_Q). 16 reads per px in the cubic path.
const phones = [['360x640 @3', 360, 640, 3], ['390x844 @3', 390, 844, 3], ['844x390 @3', 844, 390, 3], ['1024x1366 @2 tablet', 1024, 1366, 2]];
for (const [n, w, h, d] of phones) {
  const s = show('phone saver ' + n, { dpr: d, cssW: w, cssH: h, saver: true, phone: true });
  check(s.dpr <= 1.5 && s.dpr >= 1, `phone saver ${n}: dpr in 1..1.5`);
  check(s.px <= Math.max(BUDGET.phone.saver.px, w * h) + 4 * (w + h), `phone saver ${n}: canvas within 1.2 M px (or 1 px per CSS px)`);
  check(s.cubicMin === 6, `phone saver ${n}: bilinear under 6 device px`);
  const p = show('phone page  ' + n, { dpr: d, cssW: w, cssH: h, saver: false, phone: true });
  check(p.dpr <= 2 && p.px <= Math.max(BUDGET.phone.page.px, w * h) + 4 * (w + h), `phone page ${n}: dpr <= 2 and within 2 M px`);
}
// A phone cell at zoom 1: page world short side 96 x detail 1.5 = 144 cells
// over 390 CSS px at dpr 2 is 5.4 device px: bilinear. A push-in at zoom 3 is cubic.
const cell = (cells, css, dpr, zoom) => css / cells * dpr * zoom;
check(cell(144, 390, 2, 1) < BUDGET.phone.cubicMin, 'phone page zoom 1 cell takes the bilinear path');
check(cell(256, 390, 1.5, 3) >= BUDGET.phone.cubicMin, 'phone saver push-in (zoom 3) cell takes the cubic path');

// Desktop profile: the e84c4cb behaviour stays.
const d1 = show('desk saver 1920x1080 @2', { dpr: 2, cssW: 1920, cssH: 1080, saver: true });
check(d1.dpr === 2 && d1.px <= 8.3e6, 'desk saver 1920x1080 @2: dpr 2 within 8.3 M px');
const d2 = show('desk saver 3008x1692 @2', { dpr: 2, cssW: 3008, cssH: 1692, saver: true });
check(d2.dpr < 2 && d2.px <= 8.3e6 + 1e4, 'desk saver 3008x1692 @2: held to 8.3 M px');
const d3 = show('desk page 1440x900 @2', { dpr: 2, cssW: 1440, cssH: 900 });
check(d3.dpr === 2 && d3.cubicMin === 3, 'desk page: dpr 2, cubic from 3 px');
check(renderBudget({ dpr: 1, cssW: 1280, cssH: 800, saver: true }).dpr === 1, 'desk saver @1: dpr 1');

// The pure app/ modules. The expected values come from the functions as they
// were in main.js before the split (run once on the old source).
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fix = (v, d = 4) => +v.toFixed(d);
check(same([wrap(-1, 10), wrap(23, 10), wrapDelta(9, 10), wrapDelta(-6, 10)], [9, 3, -1, 4]), 'torus: wrap and wrapDelta');
const rng = mulberry(42);
check(same(Array.from({ length: 5 }, rng).map(v => fix(v, 8)), [0.60110375, 0.44829056, 0.85246579, 0.66973404, 0.1748139]), 'saver grid: mulberry(42) sequence');
{
  const W = 64, H = 48, A = new Float32Array(W * H);
  const blob = (cx, cy, r, v) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(wrapDelta(x - cx, W), wrapDelta(y - cy, H)); if (d < r) A[y * W + x] = v * (1 - d / r); } };
  blob(10, 10, 6, 1); blob(40, 30, 5, 0.8); blob(62, 46, 4, 0.9);
  const g = saverGrid(A, W, H, 4), sum = a => fix(Array.from(a).reduce((s, v) => s + v, 0));
  check(same({ gw: g.gw, gh: g.gh, m: sum(g.m), mx: sum(g.mx), my: sum(g.my) }, { gw: 16, gh: 12, m: 73.6033, mx: 1970.5995, my: 1564.6279 }), 'saver grid: block sums');
  const cen = [[10, 10, 8], [1, 1, 8], [25, 5, 3]].map(([x, y, r]) => { const c = gridCentroid(g, { x, y }, r); return c && { x: fix(c.x), y: fix(c.y), m: fix(c.m) }; });
  check(same(cen, [{ x: 10, y: 10, m: 37.6862 }, { x: 62.4033, y: 46.4033, m: 15.8144 }, null]), 'saver grid: gridCentroid across the wrap, and null on empty space');
  check(same(gridPeaks(g).map(p => ({ x: p.x, y: p.y, v: fix(p.v) })), [{ x: 10, y: 10, v: 37.6862 }, { x: 42, y: 30, v: 20.8425 }]), 'saver grid: gridPeaks');
}
check(same([familyOf({ rank: ['a', 'b', 'c', 'd'] }), familyOf({ rank: ['a', 'b', '(note)', 'd'] }), familyOf({ rank: ['', '', '', ''] })], ['c', 'b', 'Other']), 'catalog: familyOf');
check(familyColor('Orbidae') === 'hsl(5 62% 62%)', 'catalog: familyColor');
const p32 = { w: 3, h: 2, data: Float32Array.from([1, 2, 3, 4, 5, 6]) };
check(rotate(p32, 1).data.join(',') === '4,1,5,2,6,3' && rotate(p32, 3).data.join(',') === '3,6,2,5,1,4' && rotate(p32, 1).w === 2, 'catalog: rotate');
check(same(Array.from(cellsOf({ id: 't', w: 2, h: 2, cells: btoa(String.fromCharCode(0, 51, 255, 128)) }).data).map(v => fix(v, 6)), [0, 0.2, 1, 0.501961]), 'catalog: cellsOf');
check(lut('lenia').length === 768, 'catalog: lut has 256 rgb entries');
check(growthTeX(1, 0.15, 0.015) === String.raw`G(u) = 2\Big(1 - \tfrac{(u-\class{m5}{0.150})^2}{9\cdot \class{m6}{0.0150}^2}\Big)_+^4 - 1`, 'tex: growthTeX gn 1');
check(growthTeX(2, 0.15, 0.015) === String.raw`G(u) = 2\exp\!\Big(-\tfrac{(u-\class{m5}{0.150})^2}{2\cdot \class{m6}{0.0150}^2}\Big) - 1`, 'tex: growthTeX gn 2');
check(growthTeX(3, 0.2, 0.03) === String.raw`G(u) = \pm 1,\ +1 \text{ if } |u-\class{m5}{0.200}| \le \class{m6}{0.0300}`, 'tex: growthTeX gn 3');
check(CORE_TEX.length === 4 && SAVER_CORE.length === 4 && GROWTH_SYM.length === 3 && SAVER_GROWTH.length === 3 && RULE_CLASS.m === 'm5', 'tex: table sizes and RULE_CLASS');

// The page in jsdom with no WebGPU: boot, the catalog, the panel and the
// keys. It needs jsdom on NODE_PATH, and it is skipped without it.
let JSDOM = null;
try { JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) { console.log('SKIP  page boot in jsdom: no jsdom on NODE_PATH'); }
if (JSDOM) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(dir + '/index.html', 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/lenia/index.html', pretendToBeVisual: true });
  const w = dom.window, errors = [];
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
  w.HTMLCanvasElement.prototype.getContext = () => noop;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const mq = q => ({ matches: q.includes('fine'), addEventListener() {} });
  const glob = { window: w, document: w.document, location: w.location, localStorage: w.localStorage, navigator: w.navigator, matchMedia: mq,
    devicePixelRatio: 2, ResizeObserver: class { observe() {} }, IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: () => 0, Event: w.Event, addEventListener: (...a) => w.addEventListener(...a),
    fetch: async u => ({ json: async () => JSON.parse(fs.readFileSync(dir + '/' + u, 'utf8')) }) };
  for (const [k, v] of Object.entries(glob)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const warn = console.warn; console.warn = () => {};
  w.addEventListener('error', e => errors.push(e.message));
  await import('./main.js');
  for (let i = 0; i < 100 && !w.document.querySelector('.br-item'); i++) await new Promise(r => setTimeout(r, 20));
  const $ = id => w.document.getElementById(id), key = k => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: k }));
  const n = JSON.parse(fs.readFileSync(dir + '/creatures.json', 'utf8')).creatures.length;
  check($('curName').textContent === 'Orbium unicaudatus' && $('curIdx').textContent === `1 / ${n}`, 'page boot: the default creature O2u');
  check(w.document.querySelectorAll('.br-item').length === n && $('famChips').children.length === w.document.querySelectorAll('.br-group').length, 'page boot: one list item per creature, one chip per family group');
  check($('rule').children.length === 4 && $('eqs').children.length === 2 && !$('nogpu').hidden && w.document.body.classList.contains('nogpu'), 'page boot: 4 rule rows, 2 equations, the no-WebGPU notice');
  $('nextBtn').click(); key('ArrowRight'); key('ArrowRight');
  check($('curIdx').textContent === `4 / ${n}` && w.localStorage.getItem('stella-nova.lenia.creature') === 'O2bi' && w.document.querySelector('.br-item.on').dataset.idx === '3', 'page: next and two arrow keys step to creature 4 and store it');
  key(' '); key('f'); key(']'); $('dockTool').click();
  check($('playBtn').textContent === 'Play' && $('followBtn').textContent === 'Follow on' && $('brushV').textContent === '1.75 R' && $('dockTool').textContent === '✎', 'page: space, f, ] and the dock tool button');
  $('search').value = 'orbium'; $('search').dispatchEvent(new w.Event('input'));
  const hits = w.document.querySelectorAll('.br-item').length;
  check(hits > 0 && hits < n, 'page: the search filters the list');
  $('browseBtn').click(); const opened = $('browser').classList.contains('open'); key('Escape');
  check(opened && !$('browser').classList.contains('open'), 'page: the browse button opens the catalog, Escape closes it');
  const sv = await window.snSaver.enter({ seed: 3, calm: 0 });
  check(sv.canvas.id === 'gl' && w.document.documentElement.classList.contains('saver') && !$('panel').classList.contains('open'), 'page: snSaver.enter with no engine gives #gl and hides the GUI');
  check(errors.length === 0, 'page: no error in an event handler' + (errors.length ? ': ' + errors[0] : ''));
  console.warn = warn;
}

console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
