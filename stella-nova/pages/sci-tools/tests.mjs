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
//  4. jsdom boot (needs jsdom on NODE_PATH, else SKIP): the page loads
//     into the scratchpad, lines answer as they are typed, a tool name
//     opens its form under the line, the shell opens every tool with 0
//     errors, and every TeX string of every tool typesets through
//     lib/sci-math.js to an SVG (SCI_SKIP_TEX=1 skips only the TeX part).
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

// Page rules that node can read: the CSS text (jsdom has no media queries).
const css = readFileSync(here + 'style.css', 'utf8');
const phone = (css.split('/* PHONE */')[1] || '').split('/* TOUCH */')[0];
ok(/\[hidden\]\{display:none!important\}/.test(css), 'style.css: [hidden]{display:none!important}');
ok(/\.wrap\{padding:16px 16px/.test(phone) && /\.desk\{grid-template-columns:minmax\(0,1fr\)\}/.test(phone), 'phone: 16 px gutters and one column');
ok(/\.sheet\{display:none;position:fixed/.test(phone) && /\.sheet\.open\{display:block\}/.test(phone) && /\.sheetbtn\{display:block/.test(phone), 'phone: the tables are a bottom sheet opened by the Tables button');
ok(/overflow-x:hidden/.test(css.split('/* TOKENS */')[1].split('/* PAD */')[0]) && !/body\{[^}]*overflow-x/.test(css), 'overflow-x is on html only (sticky stays working)');
const pageText = ['index.html', 'style.css', 'main.js', 'pad.js', 'sheet.js', 'view.js', 'intent.js'].map(f => readFileSync(here + f, 'utf8')).join('\n');
ok(!/Playfair|Cormorant|JetBrains/i.test(pageText), 'no Playfair, Cormorant or JetBrains fonts');
ok(!/katex/i.test(pageText), 'no KaTeX (MathJax SVG through lib/sci-math.js)');

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
  // Scratchpad.
  const { STARTER } = await import('./intent.js');
  const doc = w.document;
  S.show('pad');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const lis = () => [...doc.querySelectorAll('#lines li.ln')];
  ok(S.view === 'pad' && !doc.getElementById('desk').hidden, 'the scratchpad is the home view');
  ok(lis().length === STARTER.length + 1, `the first visit shows ${STARTER.length} starter lines and an empty line`, `got ${lis().length}`);
  const ansOf = (li) => (li.querySelector('.ans .v') || {}).textContent;
  ok(ansOf(lis()[1]) === '2.4797 eV' && /hc\/λ/.test(lis()[1].querySelector('.ans .how').textContent), 'starter line "500 nm photon in eV" shows "= 2.4797 eV" and its method');
  ok(lis().find(li => li.querySelector('input').value.startsWith('dilute')).querySelector('.ans .v').textContent === 'take 12.5 mL, add 37.5 mL', 'starter dilution line answers "take 12.5 mL, add 37.5 mL"');
  const type = async (text) => {
    const last = lis()[lis().length - 1], inp = last.querySelector('input');
    inp.focus(); inp.value = text; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
    await wait(200);
    return last;
  };
  let li = await type('molar mass NaCl');
  ok(ansOf(li) === '58.44 g/mol', 'typing "molar mass NaCl" answers 58.44 g/mol', ansOf(li));
  ok(lis()[lis().length - 1].querySelector('input').value === '', 'a new empty line follows the typed line');
  li = await type('dilution');
  const nIn = (await import('./tools/chem.js')).TOOLS.dilution.inputs.length;
  ok(li.querySelectorAll('.iform .fld').length === nIn && li.querySelector('.iout .res'), 'a tool name opens the live tool form under the line');
  li = await type('foo bar');
  ok(li.querySelector('.ans .msg') && li.classList.contains('bad'), 'an unreadable line shows its error');
  li = await type('x = 2 m');
  li = await type('x^2 * 3');
  ok(ansOf(li) === '12 m²', 'a variable carries to later lines (x = 2 m, x^2 * 3 = 12 m²)', ansOf(li));
  lis()[1].querySelector('[data-more]').click();
  ok(!lis()[1].querySelector('.more').hidden && lis()[1].querySelector('.more .res') && lis()[1].querySelectorAll('.more .refs li').length > 0, '[method] opens the full method: rows and references');
  const n0 = lis().length;
  lis()[1].querySelector('input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok(lis().length === n0 + 1, 'Enter adds a line');
  const sugIn = lis()[lis().length - 1].querySelector('input');
  sugIn.focus(); sugIn.value = 'dil'; sugIn.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok(doc.querySelectorAll('.sugg li[data-s]').length > 0, 'typing "dil" shows suggestions');
  sugIn.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  ok(sugIn.value.startsWith('dilute'), 'Tab takes the first suggestion', sugIn.value);
  ok(S.parseHash('#pad=a%0Ab').text === 'a\nb', 'parseHash reads the pad lines');
  // Cheat sheet.
  const sh = doc.getElementById('sheet');
  ok(sh.querySelectorAll('.ptable .el').length === 118, 'the cheat sheet has a periodic table of 118 elements');
  ok(sh.querySelectorAll('#t-const > table tr').length >= 20 && sh.querySelectorAll('#t-pre .pf').length === 24 && sh.querySelectorAll('#t-pka tbody tr').length >= 20 && sh.querySelectorAll('#t-dens tbody tr').length >= 15 && sh.querySelectorAll('#t-units tbody tr').length >= 20, 'constants, 24 SI prefixes, pKa, densities and unit tables are filled');
  ok([...sh.querySelectorAll('details.tbl')].every(d => d.open && d.querySelector('.src')), 'every table is open and shows its source');
  let tl = lis()[lis().length - 1], ti = tl.querySelector('input');
  ti.focus(); ti.value = 'molar mass '; ti.setSelectionRange(11, 11); ti.dispatchEvent(new w.Event('input', { bubbles: true }));
  sh.querySelector('.el[data-el="Fe"]').click();
  ok(ti.value === 'molar mass Fe' && ansOf(tl) === '55.845 g/mol', 'a click on Fe inserts its symbol and the line answers', `${ti.value} -> ${ansOf(tl)}`);
  tl = lis()[lis().length - 1]; ti = tl.querySelector('input'); ti.focus();
  sh.querySelector('#t-const .sym[data-ins="$h"]').click();
  ti.value += ' * '; ti.setSelectionRange(ti.value.length, ti.value.length);
  sh.querySelector('#t-const .sym[data-ins="c"]').click();
  ti.value += ' / 500 nm in eV'; ti.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(200);
  ok(ti.value === '$h * c / 500 nm in eV' && ansOf(tl) === '2.4797 eV', 'constant names insert from the table ($h for the name that is also a unit)', `${ti.value} -> ${ansOf(tl)}`);
  const fbox = doc.getElementById('sheetFilter');
  fbox.value = 'acetic'; fbox.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok([...sh.querySelectorAll('#t-pka tbody tr')].filter(r => !r.hidden).length === 1 && doc.getElementById('t-const').hidden, 'the filter "acetic" leaves one pKa row and hides the other tables');
  fbox.value = ''; fbox.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok(!doc.getElementById('t-const').hidden && !doc.getElementById('t-el').hidden, 'an empty filter shows every table again');
  const sbtn = doc.getElementById('sheetBtn');
  ok(!sbtn.hidden && sbtn.getAttribute('aria-expanded') === 'false', 'the Tables button is there for phones');
  sbtn.click();
  ok(sh.classList.contains('open') && sbtn.getAttribute('aria-expanded') === 'true', 'the Tables button opens the sheet');
  sh.querySelector('.stabs [data-tab="pka"]').click();
  ok(doc.getElementById('t-pka').classList.contains('cur') && !doc.getElementById('t-const').classList.contains('cur'), 'a tab shows its table (pKa)');
  sh.querySelector('.ins[data-ins="acetic acid"]').click();
  ok(/acetic acid → line \d+/.test(sh.querySelector('.flash').textContent), 'an insert says which line it went to', sh.querySelector('.flash').textContent);
  doc.getElementById('sheetClose').click();
  ok(!sh.classList.contains('open'), 'Close closes the sheet');
  ok(!pageErrors.length && !S.errors.length, 'no page errors during boot and the pad checks', [...pageErrors, ...S.errors].slice(0, 3).join(' | '));

  w.close();

  // TeX of every tool through lib/sci-math.js, evaluated inside a jsdom
  // window (MathJax must run in the window's own realm).
  if (process.env.SCI_SKIP_TEX) console.log('SKIP  TeX typesetting (SCI_SKIP_TEX)');
  else {
  const lib = here + '../../lib/sci-math.js';
  const tdom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: pathToFileURL(here + 'index.html').href, runScripts: 'dangerously', resources: 'usable' });
  const tw = tdom.window;
  const src = readFileSync(lib, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(lib).href)).replace(/^export /gm, '');
  tw.eval(`(function () { ${src}\n window.__sm = { typeset }; })();`);
  const texes = [];
  for (const t of TOOLS) for (const x of defs[t.id].tex) texes.push([t.id, x, true]);
  // The LaTeX tool's own default and examples go through the same path.
  if (defs.latex) for (const v of [{}, ...(defs.latex.examples || []).map(e => e.v)]) {
    const base = Object.fromEntries(defs.latex.inputs.map(i => [i.k, i.def ?? '']));
    texes.push(['latex output', defs.latex.run({ ...base, ...v }).texOut, true]);
  }
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
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
