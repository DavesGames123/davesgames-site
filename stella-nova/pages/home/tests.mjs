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
//    - image budget: no <img> in index.html or in generated markup has a
//      src; every one has width and height; every file it names exists;
//      every key in thumbs/list.js has thumbs/sm/<key>.jpg at 320x200
//    - a jsdom boot of index.html: 0 errors, 0 images with a src at load,
//      and the image loader (O.lazy) fills and empties groups and rails.
//      jsdom is not in the repo. Set JSDOM_DIR to a folder whose
//      node_modules holds jsdom (npm i jsdom@24 there), else this part is
//      skipped with a note.
//
//  Exit 1 on any failure.
//
//  grep -n targets
//    DOM stub ............. "function stub"
//    sandbox load ......... "const FILES"
//    checks ............... "check("
//    image checks ......... "image budget"
//    jsdom boot ........... "async function jsdomBoot"
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
// The deep stub gives every value a forEach, so it cannot catch $(sel) (one
// element) used where $$(sel) (a list) is meant. 799367a did that and the
// home page stopped at load in the browser. Check the source instead.
{
  const src = fs.readFileSync(path.join(HOME, 'main.js'), 'utf8');
  const bad = [...src.matchAll(/(?<![$\w])\$\(([^()]|\([^()]*\))*\)\.forEach/g)].map(m => m[0].slice(0, 60));
  check('main.js never calls forEach on $(sel) (one element; use $$)', !bad.length, bad.join(' | '));
}
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

// ── image budget ──────────────────────────────────────────────────────────
{
  const imgs = [...html.matchAll(/<img\s[^>]*>/g)].map(m => m[0]);
  const withSrc = imgs.filter(t => /\ssrc=/.test(t));
  check(`no <img> in index.html has a src at load (${imgs.length} images)`, imgs.length > 0 && !withSrc.length, withSrc.slice(0, 3).join(' | '));
  const noWH = imgs.filter(t => !/\swidth="\d+"/.test(t) || !/\sheight="\d+"/.test(t));
  check('every <img> in index.html has width and height', !noWH.length, noWH.slice(0, 3).join(' | '));
  const { imgTag, SIZES } = O.img;
  const keys = [...O.THUMB_KEYS];
  const gen = [...keys.map(k => imgTag(`thumbs/${k}.jpg`, SIZES.card)), ...[1, 2, 3, 4, 5, 6].map(i => imgTag(`media/game-${i}.jpg`, SIZES.sector))];
  check(`no generated thumbnail <img> has a src (${gen.length})`, gen.every(t => !/\ssrc=/.test(t) && /\sdata-src=/.test(t)));
  check('every generated thumbnail <img> has width and height', gen.every(t => /\swidth="\d+"/.test(t) && /\sheight="\d+"/.test(t)));
  const named = [...html.matchAll(/data-src(?:set)?="([^"]+)"/g), ...gen.join(' ').matchAll(/data-src(?:set)?="([^"]+)"/g)]
    .flatMap(m => m[1].split(',').map(x => x.trim().split(/\s+/)[0]));
  const lost = [...new Set(named)].filter(f => !fs.existsSync(path.join(HOME, f)));
  check(`every image file named by data-src or data-srcset exists (${new Set(named).size})`, !lost.length, lost.slice(0, 5).join(', '));
  const { jpegSize } = await import(new URL('../../../tools/thumbs-small.mjs', import.meta.url));
  const noSm = keys.filter(k => { const f = path.join(HOME, 'thumbs', 'sm', k + '.jpg'); if (!fs.existsSync(f)) return true; const z = jpegSize(f); return !z || z.w !== 320 || z.h !== 200; });
  check(`every listed key has thumbs/sm/<key>.jpg at 320x200 (${keys.length})`, !noSm.length, noSm.join(', '));
}

// ── jsdom boot ────────────────────────────────────────────────────────────
async function jsdomBoot() {
  let JSDOM, VirtualConsole;
  try {
    const dir = process.env.JSDOM_DIR;
    const { createRequire } = await import('node:module');
    const req = createRequire(dir ? path.join(path.resolve(dir), 'x.js') : import.meta.url);
    ({ JSDOM, VirtualConsole } = req('jsdom'));
  } catch (e) { console.log('skip  jsdom boot (jsdom not found; set JSDOM_DIR)'); return; }
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Could not parse CSS/.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push('console.error ' + a.join(' ')));
  const ios = [];
  const dom = await JSDOM.fromFile(path.join(HOME, 'index.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.devicePixelRatio = 2;
      w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {} });
      w.IntersectionObserver = class { constructor(cb, o) { this.cb = cb; this.o = o || {}; this.t = []; ios.push(this); } observe(t) { this.t.push(t); } unobserve() {} disconnect() {} takeRecords() { return []; } };
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      // Canvas: every 2D call is a no-op. jsdom has no canvas.
      const g = new Proxy(function () {}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => ({ addColorStop() {} }) : typeof k === 'string' && k !== 'canvas' ? () => {} : undefined, set: () => true });
      w.HTMLCanvasElement.prototype.getContext = function () { return g; };
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
    },
  });
  const w = dom.window, d = w.document;
  await new Promise(r => (d.readyState === 'complete' ? r() : w.addEventListener('load', r)));
  await new Promise(r => setTimeout(r, 200));
  const imgs = [...d.querySelectorAll('img')];
  check(`jsdom boot: no error (${errors.length})`, !errors.length, errors.slice(0, 3).join(' | '));
  check('jsdom boot: main.js ran (O.lazy is set)', !!(w.Observatory && w.Observatory.lazy));
  check(`jsdom boot: 0 of ${imgs.length} images have a src at load`, imgs.length > 100 && imgs.every(i => !i.getAttribute('src')), imgs.filter(i => i.getAttribute('src')).length + ' with src');
  check('jsdom boot: every image has width and height', imgs.every(i => i.getAttribute('width') && i.getAttribute('height')));
  // Drive the loader by hand: near/far are the observers with 400/1200 px margins.
  const near = ios.find(o => o.o.rootMargin === '400px 0px'), far = ios.find(o => o.o.rootMargin === '1200px 0px');
  const portals = d.querySelector('.portals');
  check('jsdom boot: the loader watches the portals, rails, inspector, tip and search lists', !!near && near.t.includes(portals) && near.t.includes(d.getElementById('featuredRail')) && near.t.includes(d.getElementById('inspector')) && near.t.includes(d.getElementById('chartTip')) && d.querySelectorAll('.find-list').length > 0 && [...d.querySelectorAll('.find-list')].every(l => near.t.includes(l)));
  if (near && far) {
    near.cb([{ target: portals, isIntersecting: true }]);
    const pi = [...portals.querySelectorAll('img')];
    check('loader: a near group gets src and srcset', pi.length === 4 && pi.every(i => i.getAttribute('src') && i.getAttribute('srcset')));
    check('loader: a portal game image takes media/sm (640 px) as src', /^media\/sm\/game-\d\.jpg$/.test(pi[0].getAttribute('src')));
    far.cb([{ target: portals, isIntersecting: false }]);
    check('loader: a far group drops src and srcset', pi.every(i => !i.getAttribute('src') && !i.getAttribute('srcset')));
    // Rail window: cards 336 px apart in a 1440 px rail.
    const rail = d.getElementById('featuredRail');
    const cards = [...rail.querySelectorAll('.card')];
    let shift = 0;
    rail.getBoundingClientRect = () => ({ left: 0, right: 1440, width: 1440, top: 0, bottom: 400 });
    cards.forEach((c, i) => { c.getBoundingClientRect = () => ({ left: i * 336 - shift, right: i * 336 + 320 - shift, width: 320, top: 0, bottom: 300 }); });
    near.cb([{ target: rail, isIntersecting: true }]);
    const loaded = () => cards.map(c => !!c.querySelector('img[src]'));
    const want = cards.map((c, i) => !!c.querySelector('img') && i * 336 < 2880);
    check(`loader: a rail loads cards up to 2 widths on (${loaded().filter(Boolean).length} of ${cards.length})`, loaded().join() === want.join());
    shift = 6000; w.Observatory.lazy.fill(rail);
    check('loader: a rail drops cards more than 2.5 widths back', cards.every((c, i) => i * 336 + 320 - shift >= -3600 || !c.querySelector('img[src]')));
  }
  w.close();
}
await jsdomBoot();

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
