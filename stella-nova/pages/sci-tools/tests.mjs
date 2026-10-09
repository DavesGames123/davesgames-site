// ============================================================================
//  SCIENCE TOOLKIT  ·  tests.mjs  ·  node tests (no browser)
// ----------------------------------------------------------------------------
//  Run:  NODE_PATH=<folder with jsdom> node stella-nova/pages/sci-tools/tests.mjs
//
//  1. tests/<group>.mjs: numeric checks of each tool against known values
//     (NIST, IUPAC, textbook cases, and SciPy results in
//     tests/fixtures.json, made once by tests/make-fixtures.py).
//  2. Registry: each tool row has a definition with inputs, run, TeX and
//     references; each related page is registered in lib/nav-data.js.
//  3. Each tool runs with its default inputs and with each example (an
//     example marked err: true must throw a message).
//  4. jsdom boot (needs jsdom on NODE_PATH, else SKIP): the page loads,
//     opens every tool through the shell with 0 errors, and every TeX
//     string of every tool typesets through lib/sci-math.js to an SVG.
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, name, detail = '') => {
  if (c) pass++; else fail++;
  console.log(`${c ? '  ok' : 'FAIL'}  ${name}${!c && detail ? '  — ' + detail : ''}`);
  return c;
};
// Relative closeness, with an absolute floor for values near 0.
const near = (a, b, rtol, name, atol = 0) => {
  const good = Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) <= Math.max(atol, rtol * Math.abs(b)) : a === b;
  return ok(good, name, `got ${a}, want ${b} (rtol ${rtol})`);
};
const throws = (fn, re, name) => {
  try { fn(); return ok(false, name, 'no error'); }
  catch (e) { return ok(re.test(e.message), name, e.message); }
};
const FIX = JSON.parse(readFileSync(here + 'tests/fixtures.json', 'utf8'));
const T = { ok, near, throws, FIX, here };

// 1. group tests
for (const f of readdirSync(here + 'tests').filter(f => f.endsWith('.mjs')).sort()) {
  console.log(`\n# ${f}`);
  const m = await import(pathToFileURL(here + 'tests/' + f).href);
  await m.default(T);
}

// 2. registry
console.log('\n# registry');
const { CATS, TOOLS, RELATED, search } = await import('./registry.js');
const defs = {};
for (const c of CATS) {
  const m = await import(`./tools/${c.id}.js`);
  for (const [id, d] of Object.entries(m.TOOLS)) defs[id] = d;
}
const badDef = TOOLS.filter(t => {
  const d = defs[t.id];
  return !d || !Array.isArray(d.inputs) || typeof d.run !== 'function' || !(d.tex || []).length || !(d.refs || []).length || !d.how;
});
ok(!badDef.length, `every registry tool (${TOOLS.length}) has inputs, run, TeX, a method and references`, badDef.map(t => t.id).join(' '));
const orphan = Object.keys(defs).filter(id => !TOOLS.some(t => t.id === id));
ok(!orphan.length, 'every tool definition is in the registry', orphan.join(' '));
ok(new Set(TOOLS.map(t => t.id)).size === TOOLS.length, 'tool ids are unique');
ok(TOOLS.every(t => CATS.some(c => c.id === t.cat)), 'every tool has a known category');
const nav = readFileSync(here + '../../lib/nav-data.js', 'utf8');
const missingRel = RELATED.filter(([k]) => !new RegExp(`\\["${k}",`).test(nav));
ok(!missingRel.length, 'related pages are registered in lib/nav-data.js', missingRel.map(r => r[0]).join(' '));
if (TOOLS.some(t => t.id === 'molar-mass')) ok(search('molar mass')[0].id === 'molar-mass', 'palette: "molar mass" ranks the molar mass tool first');
if (defs['unit-convert']) ok(search('convert unit')[0]?.id === 'unit-convert', 'palette: "convert unit" finds the unit converter');
ok(search('zzzz').length === 0, 'palette: no match gives an empty list');

// 3. defaults and examples
console.log('\n# defaults and examples');
const runErr = [];
let runs = 0;
for (const t of TOOLS) {
  const d = defs[t.id];
  if (!d) continue;
  const base = Object.fromEntries(d.inputs.map(i => [i.k, i.def ?? '']));
  const cases = [['default', base, false], ...(d.examples || []).map(ex => [ex.label, { ...base, ...ex.v }, !!ex.err])];
  for (const [label, v, wantErr] of cases) {
    runs++;
    try {
      const r = d.run(v);
      if (wantErr) runErr.push(`${t.id}/${label}: expected an error`);
      else if (!r || (!r.rows?.length && !r.html && !r.svg && r.texOut == null)) runErr.push(`${t.id}/${label}: empty result`);
    } catch (e) {
      if (!wantErr) runErr.push(`${t.id}/${label}: ${e.message}`);
      else if (!e.message || /undefined|null|NaN|is not a function/.test(e.message)) runErr.push(`${t.id}/${label}: unclear error "${e.message}"`);
    }
  }
}
ok(!runErr.length, `every tool runs with its defaults and examples (${runs} runs)`, runErr.slice(0, 4).join(' | '));
const selOk = TOOLS.every(t => (defs[t.id]?.inputs || []).every(i => i.type !== 'select' || i.opts.some(o => o[0] === i.def)));
ok(selOk, 'every select input has its default among the options');

// 4. jsdom boot and TeX
console.log('\n# page boot (jsdom)');
let JSDOM = null;
try { JSDOM = createRequire((process.env.NODE_PATH || '/nonexistent') + '/')('jsdom').JSDOM; } catch (e) { JSDOM = null; }
if (!JSDOM) console.log('SKIP  boot and TeX: jsdom not on NODE_PATH');
else {
  // Boot window: no sub-resources (MathJax stays unloaded, the TeX boxes
  // wait), so the check is about the shell. TeX is checked below.
  const html = readFileSync(here + 'index.html', 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: pathToFileURL(here + 'index.html').href, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const pageErrors = [];
  w.addEventListener('error', (e) => pageErrors.push(e.message));
  w.console.error = (...a) => pageErrors.push(a.join(' '));
  for (const k of ['window', 'document', 'location', 'history', 'navigator', 'HTMLElement', 'Element', 'Node', 'Image', 'URLSearchParams', 'Blob', 'getComputedStyle']) {
    try { Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true }); } catch (e) { /* read-only */ }
  }
  w.scrollTo = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  await import(pathToFileURL(here + 'main.js').href);
  const S = w.__sciTools;
  await S.ready;
  ok(w.document.querySelectorAll('#grid .card').length === TOOLS.length, `grid shows a card for each tool (${TOOLS.length})`);
  ok(w.document.querySelectorAll('#tabs [data-cat]').length === CATS.length + 1, 'tabs: All plus one per category');
  const bootErr = [];
  for (const t of TOOLS) {
    const opened = await S.open(t.id, {}, false);
    const errBox = w.document.getElementById('err');
    if (!opened) bootErr.push(`${t.id}: did not open`);
    else if (!errBox.hidden) bootErr.push(`${t.id}: ${errBox.textContent}`);
    else if (!w.document.querySelector('#out').innerHTML.trim()) bootErr.push(`${t.id}: no output`);
    const n = defs[t.id].inputs.length;
    if (w.document.querySelectorAll('#form .fld').length !== n) bootErr.push(`${t.id}: form has ${w.document.querySelectorAll('#form .fld').length} fields, want ${n}`);
  }
  ok(!bootErr.length && !S.errors.length, `the shell opens every tool with no error (${TOOLS.length})`, [...bootErr, ...S.errors].slice(0, 4).join(' | '));
  // Hash state: a link with inputs opens the tool with those inputs.
  if (TOOLS.length) {
    const first = TOOLS[0], inp = defs[first.id].inputs[0];
    await S.open(first.id, { [inp.k]: inp.def + ' ' }, false);
    ok(w.document.getElementById(`f-${inp.k}`).value === inp.def + ' ', 'hash parameters fill the inputs');
  }
  const ph = S.parseHash('#unit-convert?q=1%20kg&to=g');
  ok(ph.id === 'unit-convert' && ph.params.q === '1 kg' && ph.params.to === 'g', 'parseHash reads the tool and its inputs');
  // Palette keys.
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  ok(!w.document.getElementById('palette').hidden, 'Ctrl-K opens the palette');
  w.document.getElementById('pq').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(w.document.getElementById('palette').hidden, 'Esc closes the palette');
  ok(!pageErrors.length, 'no page errors during boot', pageErrors.slice(0, 3).join(' | '));

  w.close();

  // TeX of every tool through lib/sci-math.js, evaluated inside a jsdom
  // window (MathJax must run in the window's own realm).
  const lib = here + '../../lib/sci-math.js';
  const tdom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: pathToFileURL(here + 'index.html').href, runScripts: 'dangerously', resources: 'usable' });
  const tw = tdom.window;
  const src = readFileSync(lib, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(lib).href)).replace(/^export /gm, '');
  tw.eval(`(function () { ${src}\n window.__sm = { typeset }; })();`);
  const texes = [];
  for (const t of TOOLS) for (const x of defs[t.id].tex) texes.push([t.id, x, true]);
  const constHtml = defs.constants ? defs.constants.run({ f: '' }).html : '';
  const dec = (t) => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const syms = [...constHtml.matchAll(/data-tex="([^"]*)"/g)].map(m => ['constants symbol', dec(m[1]), false]);
  const all = [...texes, ...syms];
  const els = all.map(() => tw.document.body.appendChild(tw.document.createElement('div')));
  const res = await Promise.race([Promise.all(all.map(([, x, d], i) => tw.__sm.typeset(els[i], x, { display: d }))), new Promise(r => setTimeout(() => r(null), 240000))]);
  const bad = res ? all.filter((x, i) => !res[i] || !els[i].querySelector('svg')) : all;
  const badT = bad.filter(b => b[2]), badS = bad.filter(b => !b[2]);
  ok(!!res && !badT.length, `every method formula typesets to SVG (${texes.length})`, badT.slice(0, 3).map(b => `${b[0]}: ${b[1]}`).join(' | '));
  if (defs.constants) ok(!!res && syms.length > 50 && !badS.length, `every constant symbol typesets (${syms.length})`, badS.slice(0, 3).map(b => b[1]).join(' | '));
  tw.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
