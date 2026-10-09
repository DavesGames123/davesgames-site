// ============================================================================
//  BIOME PARTS  ·  tests-dom.mjs — boot the page in jsdom (no browser)
// ----------------------------------------------------------------------------
//    JSDOM_DIR=<a folder with node_modules/jsdom> node tests-dom.mjs [w h] [phone]
//    node tests-dom.mjs 1280 800            desktop
//    node tests-dom.mjs 390 844 phone       phone (the media query matches)
//
//  The repo has no node_modules, so this file finds jsdom through JSDOM_DIR
//  (or a normal resolve) and exits 0 with SKIP when it is missing. The model
//  runs on the main thread (no Worker in jsdom); WebGPU is absent, so the
//  scene is null and the page shows its no-WebGPU note.
//
//  CHECKS: every first-layout id; gallery, levels, add, eval bound; panels
//  open and close (rail, keys, close buttons, dock, one sheet at a time);
//  the export menu; goal cards reorder by key and by pointer drag; Build,
//  Step, the scrubber's replay, an override, Play; 0 errors.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
let JSDOM;
try {
  const d = process.env.JSDOM_DIR;
  ({ JSDOM } = d && existsSync(d + '/node_modules/jsdom') ? await import(pathToFileURL(d + '/node_modules/jsdom/lib/api.js').href) : await import('jsdom'));
} catch (e) { console.log('SKIP: jsdom not found (set JSDOM_DIR)'); process.exit(0); }
const dir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const [W = '1280', H = '800', mode = ''] = process.argv.slice(2);
const phone = mode === 'phone';
const html = readFileSync(dir + '/index.html', 'utf8');
const dom = new JSDOM(html, { url: pathToFileURL(dir + '/index.html').href, pretendToBeVisual: true });
const w = dom.window;
const errors = [];
w.addEventListener('error', e => errors.push('error: ' + (e.message || e.error)));
process.on('unhandledRejection', e => errors.push('rejection: ' + (e && e.stack || e)));
const cerr = console.error; console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };
Object.defineProperty(w, 'innerWidth', { value: +W }); Object.defineProperty(w, 'innerHeight', { value: +H });
w.matchMedia = q => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
w.HTMLElement.prototype.scrollIntoView = function () { this.__scrolled = (this.__scrolled || 0) + 1; };
w.URL.createObjectURL = URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () { w.__downloads = (w.__downloads || 0) + 1; };
w.open = () => null;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'localStorage', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'Blob']) {
  try { Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true }); } catch (e) { }
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s.startsWith('file:')) { const b = readFileSync(fileURLToPath(s)); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json: async () => JSON.parse(b.toString()), text: async () => b.toString() }; }
  return realFetch(u);
};
const $ = id => w.document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };

await import(pathToFileURL(dir + '/js/main.js').href);
const app = w.__biome;
for (let i = 0; i < 100 && !(app.brain); i++) await sleep(100);
await sleep(300);
ok(!!app.brain, 'brain loaded (main-thread fallback)');
ok(!$('nogpu').hidden, 'no WebGPU note shown');

// original ids
const ORIG = 'app top status tabs goalPanel gallery levels items addKind addBtn startSel goalNote stage view ov hud hudStep hudAct hudItem banner transport buildBtn stepBtn playBtn speed noiseChk nogpu brainPanel scores checks tree log stlBtn jsonBtn forgeBtn expNote explain msStep tokens evalTable evalNote forgeLink'.split(' ');
for (const id of ORIG) ok(!!$(id), 'id #' + id);
ok($('gallery').children.length === 6, 'gallery chips bound: ' + $('gallery').children.length);
ok($('levels').children.length === 6, 'level chips bound');
ok($('addKind').options.length > 5, 'addKind filled');
ok($('evalTable').rows.length > 2, 'eval table rendered');
ok($('items').children.length === app.goal.features.length, 'goal cards = items');

const click = e => e.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const key = (k, t = w.document.body) => t.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));

// panels
const P = id => !$(id).hidden;
if (!phone) {
  ok(P('libPanel') && P('goalPanel') && P('brainPanel') && !P('console'), 'desktop default panels');
  click(w.document.querySelector('#rail [data-open="goalPanel"]')); await sleep(10);
  ok(!P('goalPanel'), 'rail closes goal');
  key('g'); await sleep(10); ok(P('goalPanel'), 'G opens goal');
  key('i'); await sleep(10); ok(!P('brainPanel'), 'I closes inspector');
  click(w.document.querySelector('#rail [data-open="brainPanel"]')); await sleep(10); ok(P('brainPanel'), 'rail opens inspector');
  key('c'); await sleep(10); ok(P('console'), 'C opens console');
  key('Escape'); await sleep(10); ok(!P('console'), 'Escape closes console');
  click($('goalPanel').querySelector('[data-close]')); await sleep(10); ok(!P('goalPanel'), 'close button');
  key('g');
  ok($('rail').querySelector('[data-open="libPanel"]').getAttribute('aria-expanded') === 'true', 'aria-expanded synced');
} else {
  ok($('app').classList.contains('phone'), 'phone class');
  ok(!P('libPanel') && !P('goalPanel') && !P('brainPanel'), 'phone: sheets closed at start');
  const tab = n => [...$('tabs').children].find(b => b.dataset.tab === n);
  click(tab('goal')); await sleep(10); ok(P('goalPanel') && $('app').classList.contains('sheet-open'), 'dock opens goal sheet');
  click(tab('brain')); await sleep(10); ok(P('brainPanel') && !P('goalPanel'), 'one sheet at a time');
  ok($('app').dataset.tab === 'brain', 'data-tab follows');
  click(tab('tree')); await sleep(10); ok(P('brainPanel') && $('foldTree').open, 'tree tab opens inspector at the tree');
  click(tab('tree')); await sleep(10); ok(!P('brainPanel') && !$('app').classList.contains('sheet-open'), 'second tap closes');
  click(tab('log')); await sleep(10); ok(P('console'), 'log tab opens console');
  click(tab('how')); await sleep(10); ok($('explain').__scrolled > 0, 'how scrolls to the explainer');
  click($('tuneBtn')); ok($('transport').classList.contains('more'), 'tune expands transport');
  click(tab('goal')); await sleep(10);
}
// export menu
click($('expBtn')); await sleep(10); ok(P('expMenu'), 'export menu opens');
click($('stlBtn')); await sleep(10); ok(/Build something first/.test($('expNote').textContent), 'STL bound');
key('Escape'); await sleep(10); ok(!P('expMenu'), 'Escape closes menu');
key('e'); await sleep(10); ok(P('expMenu'), 'E opens menu');
w.document.body.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); await sleep(10); ok(!P('expMenu'), 'outside press closes menu');

// goal reorder: keyboard and pointer drag
const order = () => app.goal.features.map(f => f.kind + JSON.stringify(f.params)).join('|');
click([...$('gallery').children].find(b => b.dataset.key === 'flange') || $('gallery').children[0]); await sleep(300);
const n0 = app.goal.features.length;
ok(n0 >= 3, 'goal has 3+ items: ' + n0);
const f1 = app.goal.features[1], f2 = app.goal.features[2];
const g1 = $('items').children[1].querySelector('.grip');
g1.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await sleep(10);
ok(app.goal.features[2] === f1 && app.goal.features[1] === f2, 'keyboard reorder moves item 2 down');
ok(w.document.activeElement && w.document.activeElement.classList.contains('grip'), 'focus stays on the moved grip');
const g = $('items').children[1].querySelector('.grip');
const moved = app.goal.features[1];
g.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientY: 10, button: 0 }));
ok($('items').children[1].classList.contains('dragging'), 'card lifts on drag');
g.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientY: 400 }));
g.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientY: 400 }));
await sleep(10);
ok(app.goal.features[n0 - 1] === moved, 'pointer drag moves the card to the end');
ok(app.goal.features[0].kind.startsWith('base_'), 'base stays first');
ok($('items').children.length === n0 && $('items').children[n0 - 1].title.length > 0, 'cards redrawn');
const fd = $('items').children[0].querySelector('.grip');
ok(fd.classList.contains('fixed'), 'item 1 has no drag grip');
// number well bound
const inp = $('items').children[1].querySelector('input');
inp.value = '3'; inp.dispatchEvent(new w.Event('change'));
ok(app.dirtyGoal, 'number well marks the goal dirty');
await sleep(300);

// build, step, scrub
click($('buildBtn')); for (let i = 0; i < 50 && !app.view; i++) await sleep(50);
for (let i = 0; i < 40 && app.busy; i++) await sleep(50);
ok(app.view && app.view.decision, 'Build: first decision');
ok($('scores').querySelectorAll('li .bar').length > 0, 'score bars');
ok($('checks').children.length === app.goal.features.length + 1, 'checks rows');
for (let s = 0; s < 6; s++) { click($('stepBtn')); for (let i = 0; i < 60 && (app.busy || !app.view); i++) await sleep(20); await sleep(30); }
ok(app.view.logLen === 6, 'six steps: ' + app.view.logLen);
ok($('tree').querySelectorAll('.node').length > 0, 'tree nodes');
ok($('tree').querySelector('.ti svg'), 'tree icons');
ok($('log').children.length === 6, 'log rows');
ok($('ticks').children.length === 6, 'scrub ticks');
ok(+$('scrub').max === 6 && +$('scrub').value === 6, 'scrubber at the end');
const noId = ops => JSON.stringify(ops.map(o => ({ ...o, id: 0 })));
const opsAt6 = noId(app.view.ops);
$('scrub').value = '3'; $('scrub').dispatchEvent(new w.Event('change'));
for (let i = 0; i < 100 && (app.busy); i++) await sleep(20); await sleep(50);
ok(app.view.logLen === 3, 'seek back to 3: ' + app.view.logLen);
ok(app.tape.length === 6, 'tape keeps 6');
ok($('ticks').querySelectorAll('i.ghost').length === 3, 'three ghost ticks');
key(']'); for (let i = 0; i < 100 && (app.busy || app.view.logLen !== 4); i++) await sleep(20);
ok(app.view.logLen === 4, 'seek forward with ]');
$('scrub').value = '6'; $('scrub').dispatchEvent(new w.Event('change'));
for (let i = 0; i < 100 && (app.busy || app.view.logLen !== 6); i++) await sleep(20);
ok(noId(app.view.ops) === opsAt6, 'replay to 6 gives the same part');
// override by tapping a score row
const row = $('scores').querySelectorAll('li')[1];
click(row); for (let i = 0; i < 100 && (app.busy || app.view.logLen !== 7); i++) await sleep(20);
ok(app.view.logLen === 7 && app.log[6].kind === 'user', 'score row tap overrides');
ok(app.tape.length === 7, 'a new step makes a new tape');
// play toggles
click($('playBtn')); ok($('playBtn').textContent === 'Pause', 'Play -> Pause');
click($('playBtn')); ok($('playBtn').textContent === 'Play', 'Pause -> Play');
for (let i = 0; i < 100 && app.busy; i++) await sleep(20);
click($('expBtn')); click($('jsonBtn')); ok(w.__downloads >= 1, 'JSON export downloads');
ok(/Goal \+ log JSON/.test($('toast').textContent), 'toast shows the export note');
ok($('status').textContent.includes('Taiga-S1'), 'status line: ' + $('status').textContent);
await sleep(200);
console.error = cerr;
const errs = errors.filter(e => !/Could not parse CSS stylesheet/.test(e));
ok(errs.length === 0, 'no errors: ' + errs.slice(0, 5).join(' / '));
console.log(`jsdom ${W}x${H}${phone ? ' phone' : ''}: ${pass} passed, ${fail} failed`);
w.close();
process.exit(fail ? 1 : 0);
