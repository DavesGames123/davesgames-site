// ============================================================================
//  HOME TESTS  ·  node stella-nova/pages/home/tests.mjs
// ----------------------------------------------------------------------------
//  Loads the home scripts in one vm sandbox, in the page order:
//    thumbs/list.js, ../../lib/nav-data.js, sectors.js, main.js
//  main.js touches the DOM at load. A deep stub stands in for document,
//  window and the browser APIs: every property is a stub, every call
//  returns a stub, and a stub iterates as an empty list. No browser runs.
//
//  The checks:
//    - main.js links and runs to its end in the stub (O.find is set)
//    - every registered key except DIRECTORY_ONLY is in FIND_ITEMS
//    - every such page is a result of a search for its own label
//    - every port (CREDITS key) is a result of a search for "port"
//    - every Ten Minute Physics port is a result of "ten minute physics"
//      and of "muller" (accent folded)
//    - no DIRECTORY_ONLY page is in FIND_ITEMS
//    - the hero search text is true: its number <= the searchable count
//
//  Exit 1 on any failure.
//
//  grep -n targets
//    DOM stub ............. "function stub"
//    sandbox load ......... "const FILES"
//    checks ............... "check("
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HOME = path.dirname(fileURLToPath(import.meta.url));
const FILES = [
  path.join(HOME, 'thumbs', 'list.js'),
  path.join(HOME, '..', '..', 'lib', 'nav-data.js'),
  path.join(HOME, 'sectors.js'),
  path.join(HOME, 'main.js'),
];

// A callable proxy: any property read gives a stub, a call gives a stub,
// it iterates as empty, and it turns into 0 or '' when coerced.
function stub() {
  const fn = function () {};
  return new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return hint => (hint === 'number' ? 0 : '');
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      if (k in t && k !== 'name') return t[k];
      if (!(k in store(t))) store(t)[k] = stub();
      return store(t)[k];
    },
    set(t, k, v) { store(t)[k] = v; return true; },
    apply() { return stub(); },
    construct() { return stub(); },
    has() { return true; },
  });
}
const STORES = new WeakMap();
function store(t) { if (!STORES.has(t)) STORES.set(t, {}); return STORES.get(t); }

const ctx = {
  console, Math, JSON, Date, Map, Set, WeakMap, Array, Object, String, Number, Promise, RegExp, Symbol, Error,
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  document: stub(), location: { protocol: 'https:', hash: '', href: 'https://davesgames.io/stella-nova/pages/home/' },
  navigator: stub(), localStorage: stub(), sessionStorage: stub(), history: stub(),
  IntersectionObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} }; },
  ResizeObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} }; },
  MutationObserver: function () { return { observe() {}, disconnect() {} }; },
  Event: function () {}, CustomEvent: function () {}, Image: function () { return stub(); },
  getComputedStyle: () => stub(), addEventListener() {}, removeEventListener() {},
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, fetch: () => new Promise(() => {}),
};
ctx.window = ctx; ctx.self = ctx; ctx.parent = ctx; ctx.top = ctx;
vm.createContext(ctx);

let fails = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('ok    ' + name); }
  else { fails++; console.log('FAIL  ' + name + (detail ? '\n      ' + detail : '')); }
}

for (const f of FILES) {
  try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }); }
  catch (e) { check('load ' + path.relative(HOME, f), false, e.stack.split('\n').slice(0, 3).join('\n      ')); }
}
const O = ctx.Observatory;
check('main.js ran to its end (O.find is set)', !!(O && O.find));
if (!O || !O.find) { console.log(`\n${passes} passed, ${fails} failed`); process.exit(1); }

const { FIND_ITEMS, findResults, FIND_TEXT } = O.find;
const { DIRECTORY_ONLY, CREDITS, EXCLUDED } = O;
const pages = ctx.snPages();
const want = pages.filter(p => !DIRECTORY_ONLY.has(p.key));
const inIndex = new Set(FIND_ITEMS.map(it => it.key).filter(Boolean));
// findResults returns the top 8; "total" counts all. Look in all hits.
const hits = q => FIND_ITEMS.filter(it => {
  const terms = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every(t => it.hay.includes(t));
});

const missing = want.filter(p => !inIndex.has(p.key)).map(p => p.key);
check(`every registered key except DIRECTORY_ONLY is in FIND_ITEMS (${want.length})`, !missing.length, 'missing: ' + missing.join(', '));

const notFound = want.filter(p => !hits(p.label).some(it => it.key === p.key)).map(p => p.key);
check('every page is found by its label', !notFound.length, 'not found: ' + notFound.join(', '));

const top = want.filter(p => {
  const r = findResults(p.label);
  return r.total <= 8 && !r.res.some(it => it.key === p.key);
}).map(p => p.key);
check('a label search shows the page in the visible results', !top.length, 'not shown: ' + top.join(', '));

const ports = Object.keys(CREDITS).filter(k => pages.some(p => p.key === k));
const portHits = new Set(hits('port').map(it => it.key));
const lostPorts = ports.filter(k => !portHits.has(k));
check(`every port is found by "port" (${ports.length})`, !lostPorts.length, 'not found: ' + lostPorts.join(', '));

const excl = [...EXCLUDED].filter(k => pages.some(p => p.key === k));
check(`every registered EXCLUDED page is searchable (${excl.length})`, excl.every(k => inIndex.has(k)), excl.filter(k => !inIndex.has(k)).join(', '));
check('every registered EXCLUDED page has a credit line', excl.every(k => CREDITS[k]), excl.filter(k => !CREDITS[k]).join(', '));

const tmp = ports.filter(k => /Ten Minute Physics/.test(CREDITS[k]));
for (const q of ['ten minute physics', 'muller', 'Müller']) {
  const h = new Set(hits(q).map(it => it.key));
  const lost = tmp.filter(k => !h.has(k));
  check(`every Ten Minute Physics port is found by "${q}" (${tmp.length})`, !lost.length, 'not found: ' + lost.join(', '));
}

const leak = [...DIRECTORY_ONLY].filter(k => inIndex.has(k));
check('no DIRECTORY_ONLY page is in FIND_ITEMS', !leak.length, 'leaked: ' + leak.join(', '));

const n = Number((FIND_TEXT.match(/(\d+)\+/) || [])[1]);
check(`hero search text "${FIND_TEXT}" is true (${inIndex.size} searchable)`, n > 0 && n <= inIndex.size && inIndex.size - n < 10);

const html = fs.readFileSync(path.join(HOME, 'index.html'), 'utf8');
check('index.html hero placeholder matches FIND_TEXT', html.includes(`placeholder="${FIND_TEXT}: black hole, chord, fire, orbit"`));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
