// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  tests.mjs  (CORE) — node tests, no browser
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/alpha-qudits/tests.mjs
//  With the scratch packages (jsdom@24.1.3, mathjax-full@3.2.2):
//        NODE_PATH=<dir>/node_modules node stella-nova/pages/alpha-qudits/tests.mjs
//  Without them the MathJax and jsdom groups print a skip line.
//
//  Groups (grep -n "section(" to jump):
//    files       node --check on every CORE file
//    packages    runs model/, strands/, ends/, records/, compare/, webs/, saver/
//                tests.mjs when the file exists (each in its own process)
//    story       chapter order, sentence-case headings, 2-5 paragraphs,
//                equation and figure keys, scenes against CONTRACT.md,
//                analogies, sources
//    numbers     the candidate digits from BigInt integer square roots,
//                the sigma offsets of CONTRACT.md, Table I sums, Wyler
//    mathjax     every TeX string of equations.js typesets
//    page        main.js links in node (a SyntaxError blanks the page),
//                index.html ids, head order, [hidden] guard, fonts
//    jsdom       boots index.html + main.js in jsdom with stubs for canvas,
//                IntersectionObserver and MathJax; checks the built page
// ============================================================================
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
let pass = 0, fail = 0, cur = '';
const skips = [];
function section(s) { cur = s; console.log('\n# ' + s); }
function ok(c, msg) { if (c) pass++; else { fail++; console.log(`  FAIL [${cur}] ${msg}`); } }
function skip(msg) { skips.push(`${cur}: ${msg}`); console.log(`  skip ${msg}`); }
const read = f => readFileSync(join(HERE, f), 'utf8');

// Find a package on NODE_PATH (or next to it), for jsdom and mathjax-full.
function findReq(name) {
  const dirs = [...(process.env.NODE_PATH || '').split(':'), process.env.JSDOM_DIR, process.env.MATHJAX_DIR].filter(Boolean);
  for (const d of dirs) for (const base of [join(d, 'x.js'), join(d, '..', 'x.js')]) {
    try { const req = createRequire(base); req.resolve(name); return req; } catch (e) { /* next */ }
  }
  return null;
}

// ============================================================================
section('files');
const CORE_FILES = ['main.js', 'equations.js', ...readdirSync(join(HERE, 'story')).filter(f => f.endsWith('.js')).map(f => 'story/' + f)];
for (const f of CORE_FILES) {
  const r = spawnSync(process.execPath, ['--check', join(HERE, f)], { encoding: 'utf8' });
  ok(r.status === 0, `node --check ${f}` + (r.status ? ': ' + (r.stderr || '').split('\n').slice(0, 4).join(' ') : ''));
}
console.log(`  ${CORE_FILES.length} files`);

// ============================================================================
section('packages');
const PKGS = ['model', 'strands', 'ends', 'records', 'compare', 'webs', 'saver'];
const pkgResults = {};
for (const p of PKGS) {
  const f = join(HERE, p, 'tests.mjs');
  if (!existsSync(f)) { skip(`${p}/tests.mjs (not landed)`); pkgResults[p] = 'missing'; continue; }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', timeout: 600000, env: process.env, cwd: join(HERE, p) });
  const tail = (r.stdout || '').trim().split('\n').filter(Boolean).slice(-1)[0] || '';
  pkgResults[p] = r.status === 0 ? 'pass' : 'fail';
  console.log(`  ${r.status === 0 ? 'ok  ' : 'FAIL'} ${p}/tests.mjs (${Date.now() - t0} ms) ${tail}`);
  if (r.status !== 0) console.log((r.stdout || '').split('\n').filter(l => /FAIL|Error/.test(l)).slice(0, 12).map(l => '       ' + l).join('\n') + '\n' + (r.stderr || '').split('\n').slice(0, 8).map(l => '       ' + l).join('\n'));
  ok(r.status === 0, `${p}/tests.mjs exits 0`);
}

// ============================================================================
section('story');
const S = await import(pathToFileURL(join(HERE, 'story/index.js')).href);
const E = await import(pathToFileURL(join(HERE, 'equations.js')).href);
const CH = S.CHAPTERS;
ok(CH.length === 12 && CH.every((c, i) => c.id === `c${i}` && c.num === i), `12 chapters c0..c11 in order (${CH.map(c => c.id).join(' ')})`);
const CONTRACT_TITLES = [/number/i, /alpha is/i, /axiom/i, /reads.*transpose/i, /read cap/i, /charge/i, /object/i, /count/i, /surviv|weight/i, /comparison.*conjecture/i, /weigh a closed form/i, /glossary.*sources/i];
CH.forEach((c, i) => ok(CONTRACT_TITLES[i].test(c.title), `${c.id} title follows the contract: "${c.title}"`));
// Sentence case: first letter upper case, no other word in capitals except
// names and symbols the page uses.
const NAMES = /^(I|Q|Y|U|X|N|R|Z|SU|QED|CODATA|Lean|Wyler|Eddington|Choi|Størmer|Woronowicz|Bloch|Theorem|Table)$/;
for (const c of CH) {
  const words = c.title.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const bad = words.slice(1).filter(w => /^\p{Lu}/u.test(w) && !NAMES.test(w));
  ok(/^\p{Lu}/u.test(c.title) && !bad.length, `${c.id} heading in sentence case` + (bad.length ? ` (${bad.join(', ')})` : ''));
  ok(c.title === c.title.trim() && !/[A-Z]{2,}\s[A-Z]{2,}/.test(c.title), `${c.id} heading has no upper-case run`);
  const paras = c.blocks.filter(b => b.p).length;
  ok(paras >= 2 && paras <= 5, `${c.id} has 2-5 top-level paragraphs (${paras})`);
}
const allBlocks = c => c.blocks.flatMap(b => b.more ? [b, ...b.more.blocks] : [b]);
// The closing WEBS section (webs/story.js): built after c11, not a chapter.
const WB = (await import(pathToFileURL(join(HERE, 'webs/story.js')).href)).WEBS;
ok(WB && WB.id === 'webs' && WB.divider && !CH.some(c => c.id === 'webs'), 'WEBS is a closing section, not one of the 12 chapters');
ok(Object.values(WB.figures).every(f => f.pkg === 'webs' && ['paper', 'model', 'analogy', 'deck'].includes(f.tag)) && Object.values(WB.figures).filter(f => f.tag === 'paper').length === 0, 'WEBS figures are tagged as the talk deck, never as the paper');
const c10 = CH.find(c => c.id === 'c10');
ok(c10.blocks.filter(b => JSON.stringify(b).includes('separate section')).length === 1 && CH.filter(c => c.id !== 'c10').every(c => !/Chain Theory/.test(JSON.stringify(c.blocks))), 'one pointer to the WEBS section, at the end of c10 only');
const eqKeys = CH.flatMap(c => allBlocks(c).filter(b => b.eq).map(b => b.eq));
const missingEq = eqKeys.filter(k => !(k in E.EQ));
ok(!missingEq.length, `every equation key exists in equations.js (${eqKeys.length} used)` + (missingEq.length ? ` missing ${missingEq}` : ''));
const unusedEq = Object.keys(E.EQ).filter(k => !eqKeys.includes(k));
ok(!unusedEq.length, `every equation of equations.js is used` + (unusedEq.length ? ` (unused ${unusedEq})` : ''));
const SCENES = {
  strands: ['pair', 'swap', 'read', 'shared', 'object'],
  ends: ['gears', 'bloch', 'qutrit', 'locks', 'charge'],
  records: ['square', 'mirror', 'modes', 'grid', 'abacus'],
  compare: ['ruler', 'digits', 'dials', 'lookElsewhere', 'roles', 'history'],
  core: ['screen'],
};
const used = { strands: new Set(), ends: new Set(), records: new Set(), compare: new Set(), core: new Set() };
for (const c of CH) {
  const figRefs = allBlocks(c).filter(b => b.fig).map(b => b.fig);
  const defs = Object.keys(c.figures || {});
  ok(figRefs.every(f => defs.includes(f)) && defs.every(f => figRefs.includes(f)), `${c.id} figures placed and defined (${figRefs.join(', ') || 'none'})`);
  if (c.id !== 'c11') ok(figRefs.length >= 1, `${c.id} has a live figure`);
  for (const [id, f] of Object.entries(c.figures || {})) {
    ok(['paper', 'model', 'analogy'].includes(f.tag), `${id} tag ${f.tag}`);
    for (const s of f.scenes) {
      const pkg = s.pkg || f.pkg;
      ok(SCENES[pkg] && SCENES[pkg].includes(s.id), `${id} scene ${pkg}/${s.id} is a contract scene`);
      if (SCENES[pkg]) used[pkg].add(s.id);
      ok(typeof s.cap === 'string' && s.cap.length > 40 && s.label, `${id} scene ${s.id} has a label and a caption`);
    }
  }
}
for (const [pkg, list] of Object.entries(SCENES)) {
  const miss = list.filter(s => !used[pkg].has(s));
  ok(!miss.length, `every ${pkg} scene has a place on the page` + (miss.length ? ` (missing ${miss})` : ''));
}
const analogies = CH.flatMap(c => allBlocks(c).filter(b => b.analogy).map(b => b.analogy));
ok(analogies.length >= 6 && analogies.every(a => a.name && a.right.length > 80 && a.breaks.length > 80), `${analogies.length} analogies, each says what it gets right and where it breaks`);
ok(['Threads', 'Mirror gears', 'Locks and keys', 'Mirrors and drum modes', 'A correspondence of roles', 'Dials'].every(n => analogies.some(a => a.name === n)), 'the six analogies of the contract are all there');
const refIds = Object.values(S.CHAPTER_REFS).flat();
ok(refIds.every(id => S.SOURCES[id]), 'every chapter source id resolves');
ok(Object.keys(S.SOURCES).every(id => refIds.includes(id) || S.MEASURED.some(m => m.src === id)), 'every source is cited by a chapter');
ok(Object.values(S.SOURCES).every(s => s.text && (!s.doi || /^10\.\d{4,5}\//.test(s.doi))), 'sources have text and well-formed DOIs');
ok(S.GLOSSARY.length >= 20 && S.GLOSSARY.every(([t, d]) => t && d.length > 20), `glossary has ${S.GLOSSARY.length} terms`);
// Stance: the conjecture is named wherever the number meets experiment.
const textOf = c => JSON.stringify(c.blocks);
for (const id of ['c0', 'c9']) ok(/[Cc]onjecture/.test(textOf(CH.find(c => c.id === id))), `${id} names the conjecture where the number meets experiment`);
const all = JSON.stringify(CH) + JSON.stringify(S.CREDITS);
ok(!/\bproves? that alpha\b|\bderives alpha\b/i.test(all), 'no claim that the paper proves alpha');
ok(/not available to us/.test(all) && /not seen or run/.test(all), 'the page says the Lean file and scripts were not run');
ok(!/ran the Lean|we ran|Lean (check|checked) (it|the)/i.test(all.replace(/not seen or run/g, '')), 'no claim that the Lean file ran');

// ============================================================================
section('numbers');
{
  // 1/alpha_cand = 31104 / (79 + 48 r2 + 42 r3 + 3 r6) at scale 10^60.
  const isqrt = n => { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); for (;;) { const y = (x + n / x) >> 1n; if (y >= x) { if (x * x > n) x--; return x; } x = y; } };
  const isqrtBig = n => { let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2)); for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; } };
  const P = 60n, SC = 10n ** P;
  const r = k => isqrtBig(k * SC * SC);
  const num = 79n * SC + 48n * r(2n) + 42n * r(3n) + 3n * r(6n);
  const invS = (31104n * SC * SC) / num;
  const s = invS.toString();
  const digits = `${s.slice(0, s.length - Number(P))}.${s.slice(s.length - Number(P))}`;
  ok(digits.startsWith('137.035999189566155029183744020866'), `1/alpha_cand = ${digits.slice(0, 40)}... (CONTRACT.md 137.035 999 189 566 155 029 183 744 020 866)`);
  ok(isqrt(144n) === 12n, 'isqrt sanity');
  const cand = parseFloat(digits.slice(0, 24));
  const want = { codata22: 0.60, fan23: 1.57, morel20: -1.49, parker18: 5.32 };
  for (const m of S.MEASURED) {
    const sg = (cand - parseFloat(m.inv)) / parseFloat(m.u);
    ok(Math.abs(sg - want[m.id]) < 0.006, `${m.label}: ${sg.toFixed(3)} sigma (contract ${want[m.id]})`);
  }
  ok(79 + 48 + 42 + 3 === 172 && 24 * 36 * 36 === 31104 && 64 + 9 + 96 === 169, 'Table I and Eq. (4) sums');
  const f = (79 + 48 * Math.SQRT2 + 42 * Math.sqrt(3) + 3 * Math.sqrt(6)) / 31104;
  ok(Math.abs(1 / f - 137.0359991895662) < 1e-9, `float value ${(1 / f).toFixed(12)}`);
  ok(Math.abs(31104 / 319 - 97.505) < 0.001 && Math.abs(31104 / 172 - 180.837) < 0.001, 'Born weights 97.505 and no weights 180.837');
  const wyler = 9 / (8 * Math.PI ** 4) * (Math.PI ** 5 / (16 * 120)) ** 0.25;
  ok(Math.abs(1 / wyler - 137.03608245) < 1e-6, `Wyler 1/alpha = ${(1 / wyler).toFixed(8)}`);
  const cod = S.MEASURED.find(m => m.id === 'codata22');
  ok(Math.abs((1 / wyler - parseFloat(cod.inv)) / parseFloat(cod.u) - 3962) < 10, 'Wyler is about 4000 sigma from CODATA 2022 (as the c10 note says)');
  // The sector formulas of Lemma S10 at a = 8, b = 3.
  const a = 8, b = 3;
  ok((a * a - a + b * b - b) / 2 + 2 * a * b === 79 && 2 * a * b === 48 && (a * a + a + b * b + b) / 2 === 42 && b * (b - 1) / 2 === 3, 'sector polynomials (Lemma S10) give 79, 48, 42, 3');
  // When model/ has landed, its numbers must match these.
  let M = null;
  try { M = await import(pathToFileURL(join(HERE, 'model/index.js')).href); } catch (e) { skip('model/index.js does not load yet: ' + e.message.split('\n')[0]); }
  if (M) {
    try {
      const v = M.value();
      ok(String(v.inverseDigits(40)).startsWith(digits.slice(0, 40)), `model value().inverseDigits(40) matches the BigInt digits`);
    } catch (e) { ok(false, 'model value(): ' + e.message); }
    try {
      const sec = M.sectors(M.buildRecords());
      ok(sec['++'] === 79 && sec['+-'] === 48 && sec['-+'] === 42 && sec['--'] === 3, `model sectors ${JSON.stringify(sec)}`);
    } catch (e) { ok(false, 'model sectors: ' + e.message); }
    try {
      const cf = M.enumerateConfigs();
      ok(cf.length === 76, `model enumerateConfigs() gives ${cf.length} configurations`);
      const rd = cf.filter(c => c.readable ?? true);
      const star = rd.filter(c => c.filters && c.filters.endRule && c.filters.twoPoint && c.filters.charge);
      ok(star.length === 1 && star[0].center === 3, `exactly one readable configuration passes the three filters (${star.length})`);
    } catch (e) { ok(false, 'model enumerateConfigs: ' + e.message); }
    if (M.lookElsewhere) {
      // The c10 text quotes these two counts.
      const sm = M.lookElsewhere({ coeffMax: 100, denominators: { kind: 'smooth', max: 40000 }, window: 1 });
      const al = M.lookElsewhere({ coeffMax: 100, denominators: { kind: 'all', max: 40000 }, window: 1 });
      ok(sm.hits === 1 && Math.abs(sm.expected - 0.18) < 0.005 && al.hits === 299 && Math.round(al.expected) === 353, `look-elsewhere counts quoted in c10: smooth ${sm.hits} (${sm.expected.toFixed(3)}), all ${al.hits} (${al.expected.toFixed(1)})`);
    }
    if (M.MEASUREMENTS) {
      const list = Array.isArray(M.MEASUREMENTS) ? M.MEASUREMENTS : Object.values(M.MEASUREMENTS);
      const flat = JSON.stringify(list);
      ok(S.MEASURED.every(m => flat.includes(m.inv.slice(0, 13))), 'story MEASURED values appear in MODEL.MEASUREMENTS');
    }
  }
}

// ============================================================================
section('mathjax');
{
  const req = findReq('mathjax-full/js/mathjax.js');
  if (!req) skip('mathjax-full not on NODE_PATH');
  else {
    const { mathjax } = req('mathjax-full/js/mathjax.js');
    const { TeX } = req('mathjax-full/js/input/tex.js');
    const { SVG } = req('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
    const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
    // The page loads only the html and color extensions (sci-math.js) on
    // top of the base set that tex-svg.js autoloads.
    req('mathjax-full/js/input/tex/AllPackages.js');
    const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html', 'color', 'newcommand', 'noundefined'], formatError: (j, err) => { throw err; } }), OutputJax: new SVG({ fontCache: 'none' }) });
    const bad = [];
    const strings = [...Object.entries(E.EQ).map(([k, t]) => [k, t, true]), ...Object.entries(E.INLINE).map(([k, t]) => ['inline ' + k, t, false])];
    for (const [k, tex, display] of strings) {
      try {
        const out = adaptor.outerHTML(doc.convert(tex, { display }));
        if (/data-mjx-error|merror|fill="red"/.test(out)) bad.push(k);
      } catch (e) { bad.push(`${k} (${e.message})`); }
    }
    ok(!bad.length, `${strings.length} TeX strings typeset with MathJax 3.2.2` + (bad.length ? `: ${bad.join('; ')}` : ''));
    const classes = new Set(Object.values(E.EQ).join(' ').match(/\\class\{m[1-6]\}/g));
    ok(classes.size === 6, `equations use all six colour classes (${[...classes].join(' ')})`);
  }
}

// ============================================================================
section('page');
{
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./main.js')"], { cwd: HERE, encoding: 'utf8', timeout: 60000 });
  const err = run.stderr || '';
  ok(!/SyntaxError/.test(err), 'main.js links (no SyntaxError)' + (/SyntaxError/.test(err) ? ': ' + err.split('\n').find(l => /SyntaxError/.test(l)) : ''));
  ok(/ReferenceError: (matchMedia|window|document|IntersectionObserver) is not defined/.test(err), 'main.js ran in node until a browser global');
  const html = read('index.html'), js = read('main.js'), css = read('style.css');
  const ids = [...new Set([...js.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(x => x[1]))];
  const missing = ids.filter(id => !html.includes(`id="${id}"`));
  ok(ids.length >= 8 && !missing.length, `index.html has all ${ids.length} ids main.js binds` + (missing.length ? ` (missing ${missing.join(', ')})` : ''));
  ok(html.indexOf('id="websDivider"') > html.indexOf('id="c11"') && html.indexOf('id="webs"') > html.indexOf('id="websDivider"'), 'index.html has the WEBS divider and shell after c11');
  const chIds = S.CHAPTERS.map(c => c.id);
  ok(chIds.every(id => html.includes(`id="${id}"`)), 'index.html has a shell for every chapter');
  const head = ['gpu-guard.js', 'wishlist.js', 'stats-beacon.js'].map(f => html.indexOf(f));
  ok(head.every(i => i > 0) && head[0] < head[1] && head[1] < head[2] && head[2] < html.indexOf('<meta charset'), 'head order: gpu-guard, wishlist, stats-beacon');
  ok(/<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">/.test(html) && /<meta name="description"/.test(html), 'viewport and description metas');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'style.css has the [hidden] guard');
  ok(!/katex/i.test(html + js) && js.includes("../../lib/sci-math.js") && html.includes('../../lib/sci.css'), 'math through sci-math.js and sci.css, no KaTeX');
  ok(!/Playfair|Cormorant|JetBrains/i.test(html + css + js), 'no Playfair, Cormorant or JetBrains Mono');
  ok(!/text-transform\s*:\s*uppercase/i.test(css) && !/letter-spacing\s*:\s*0?\.\d+(em|rem|px)/.test(css.replace(/letter-spacing:-/g, '')), 'no uppercase or letter-spaced labels');
  ok(!/SYS\s*\/\//.test(html + js + JSON.stringify(S.CHAPTERS)), 'no "SYS //" text');
  const small = [...css.matchAll(/font(?:-size)?:\s*(?:italic\s+|normal\s+)?(?:[0-9]{3}\s+)?([0-9.]+)(px|rem)/g)].map(x => x[2] === 'rem' ? +x[1] * 16 : +x[1]);
  ok(small.length > 20 && small.every(px => px >= 11), `no CSS text under 11 px (${small.length} sizes, smallest ${Math.min(...small).toFixed(1)} px)`);
  const canvasFonts = [...js.matchAll(/g\.font = '(?:\d{3} )?(\d+)px/g)].map(x => +x[1]);
  ok(canvasFonts.length && canvasFonts.every(px => px >= 11), `canvas text in main.js is at least 11 px (${canvasFonts.join(', ')})`);
  // Elements with the hidden attribute must not get a display rule that
  // wins over it: the [hidden] guard is !important, so check it is first.
  ok(css.indexOf('[hidden]{display:none!important}') < css.indexOf(':root'), 'the [hidden] guard comes before every rule');
  ok(/@media \(pointer:coarse\)/.test(css) && /min-height:44px/.test(css), 'touch targets of 44 px');
  ok(js.includes('window.alphaPage') && /goto\(chapter\)/.test(js) && /figure\(name/.test(js), 'window.alphaPage = { goto, figure }');
}

// ============================================================================
section('jsdom');
{
  const req = findReq('jsdom');
  if (!req) skip('jsdom not on NODE_PATH');
  else {
    const { JSDOM } = req('jsdom');
    const html = read('index.html').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
    const dom = new JSDOM(html, { url: pathToFileURL(join(HERE, 'index.html')).href, pretendToBeVisual: true });
    const w = dom.window;
    // Stubs: a 2D context that records nothing, IntersectionObserver that
    // reports every element on screen, ResizeObserver, MathJax.
    const grad = { addColorStop() {} };
    const ctx = new Proxy({ canvas: null }, { get(t, k) { if (k in t) return t[k]; if (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern') return () => grad; if (k === 'measureText') return s => ({ width: String(s).length * 6 }); if (k === 'getImageData') return (x, y, ww, hh) => ({ data: new Uint8ClampedArray(Math.max(1, ww * hh) * 4) }); if (k === 'isPointInPath') return () => false; return () => {}; }, set(t, k, v) { t[k] = v; return true; } });
    w.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
    const observed = [];
    w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { observed.push(el); setTimeout(() => this.cb([{ target: el, isIntersecting: true }], this), 0); } unobserve() {} disconnect() {} };
    w.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe(el) { setTimeout(() => this.cb([{ target: el, contentRect: { width: 360, height: 240 } }]), 0); } disconnect() {} unobserve() {} };
    w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    let typeset = 0;
    w.MathJax = { tex2svgPromise: async tex => { typeset++; const c = w.document.createElement('mjx-container'); c.innerHTML = '<svg></svg>'; return c; } };
    const frames = [];
    w.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
    w.cancelAnimationFrame = () => {};
    w.HTMLElement.prototype.scrollIntoView = function () { w.__scrolled = this.id; };
    w.Element.prototype.setPointerCapture = () => {}; w.Element.prototype.hasPointerCapture = () => false;
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLCanvasElement', 'Element', 'Node', 'IntersectionObserver', 'ResizeObserver', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'CustomEvent', 'Event', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'DOMParser', 'XMLSerializer', 'SVGElement', 'Image', 'performance']) {
      if (w[k] !== undefined) try { globalThis[k] = w[k]; } catch (e) { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); }
    }
    for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[k] = w[k].bind(w);
    Object.defineProperty(globalThis, 'innerHeight', { get: () => w.innerHeight, configurable: true });
    Object.defineProperty(globalThis, 'innerWidth', { get: () => w.innerWidth, configurable: true });
    Object.defineProperty(globalThis, 'scrollY', { get: () => w.scrollY, configurable: true });
    Object.defineProperty(globalThis, 'devicePixelRatio', { get: () => 2, configurable: true });
    const errs = [];
    const oldErr = console.error; console.error = (...a) => { errs.push(a.join(' ')); };
    const infos = [];
    const oldInfo = console.info; console.info = (...a) => infos.push(a.join(' '));
    const oldWarn = console.warn; const warns = []; console.warn = (...a) => warns.push(a.map(x => x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x)).join(' '));
    let bootErr = null;
    try { await import(pathToFileURL(join(HERE, 'main.js')).href + '?jsdom'); } catch (e) { bootErr = e; }
    ok(!bootErr, 'main.js boots in jsdom' + (bootErr ? ': ' + bootErr.stack.split('\n').slice(0, 3).join(' | ') : ''));
    const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 30; i++) await tick(10);
    // Run 30 animation frames at 60 Hz.
    for (let f = 0; f < 30; f++) { const q = frames.splice(0); for (const fn of q) fn(1000 + f * 16.7); await tick(1); }
    for (let i = 0; i < 10; i++) await tick(10);
    const d = w.document;
    ok(S.CHAPTERS.slice(1).every(c => d.querySelector(`#${c.id} .ch-head h2`)), 'every chapter c1..c11 has its heading');
    ok(d.querySelectorAll('#heroBody .prose').length >= 3 && d.querySelector('#heroBody .fig'), 'the hero has its text and its figure');
    const nFig = S.CHAPTERS.reduce((n, c) => n + Object.keys(c.figures || {}).length, 0) + Object.keys(WB.figures).length;
    const figs = [...d.querySelectorAll('figure.fig')];
    ok(figs.length === nFig, `${figs.length} figure cards (story: ${nFig})`);
    const mounted = figs.filter(f => f.querySelector('.host'));
    ok(mounted.length === nFig, `every card mounted a host (${mounted.length})`);
    const real = figs.filter(f => f.querySelector('.host') && !f.querySelector('.ph'));
    const ph = figs.filter(f => f.querySelector('.ph')).map(f => f.id + ':' + f.querySelector('.host').dataset.pkg);
    console.log(`  figures with a real package: ${real.map(f => f.id).join(' ') || 'none'}; placeholders: ${ph.join(' ') || 'none'}`);
    ok(d.querySelectorAll('.eq .sci-eq').length === eqKeys.length, `${eqKeys.length} equation boxes`);
    const boxes = d.querySelectorAll('[data-tex]').length;
    ok(typeset >= boxes, `MathJax stub typeset all ${boxes} TeX boxes (${typeset} calls)`);
    ok(d.querySelectorAll('#rail a').length === 12 && d.querySelectorAll('#menuList a').length === 12, 'rail and phone menu list 12 chapters');
    ok(d.querySelector('#webs .ch-head h2') && !d.querySelector('#webs .ch-num') && d.querySelectorAll('#webs figure.fig .host[data-pkg="webs"]').length === Object.keys(WB.figures).length, 'the WEBS section has its heading, no chapter number, and its webs figures');
    ok(!d.querySelector('.aq-st-analogy') && !d.querySelector('.webs-notes'), 'no package repeats the analogy note under notes: false');
    const nAn = analogies.length + WB.blocks.filter(x => x.analogy).length;
    ok(d.querySelectorAll('[data-analogy]').length === nAn, `${nAn} analogy boxes (chapters and WEBS)`);
    ok(d.querySelectorAll('.gloss dt').length === S.GLOSSARY.length, 'glossary built');
    ok(d.querySelectorAll('.refs li').length === Object.keys(S.SOURCES).length, `${Object.keys(S.SOURCES).length} sources listed`);
    const meas = [...d.querySelectorAll('[data-table="measurements"] tbody tr')].map(r => r.lastElementChild.textContent);
    ok(meas.join(' ') === '+0.60σ +1.57σ −1.49σ +5.32σ', `measurement offsets ${meas.join(' ')}`);
    const sum = d.querySelector('[data-table="sectors"] tr.sum:last-child td.n');
    ok(sum && /^137\.035 999 18/.test(sum.textContent), `sectors table ends in ${sum && sum.textContent}`);
    const cfg = d.querySelector('[data-table="configs"]');
    const rows = cfg ? cfg.querySelectorAll('tbody tr') : [];
    if (rows.length) {
      ok(rows.length === 23, `configs table has ${rows.length} readable rows`);
      cfg.querySelectorAll('[data-f]').forEach(b => b.click());
      const left = [...rows].filter(r => !r.classList.contains('out'));
      ok(left.length === 1 && left[0].classList.contains('star'), `the three filters leave one row, the object (${left.length})`);
      ok(cfg.querySelector('.count').textContent === '1 left', 'funnel count reads 1 left');
    } else skip('configs table waits for model/ (paper summary shown)');
    const scr = d.querySelector('#f1 .screen output');
    const v = scr && parseFloat((scr.textContent.match(/≈ ([0-9.]+)/) || [])[1]);
    ok(v > 134 && v < 137.04, `screening figure reads ${scr && scr.textContent}`);
    // The screening model: one-loop electron term at the Z mass, about
    // 137.036 - 2.566 + 0.177 (large-Q form plus its constant).
    const inp = d.querySelector('#f1 .screen input');
    inp.value = '1000'; inp.dispatchEvent(new w.Event('input'));
    const vz = parseFloat(scr.textContent.match(/≈ ([0-9.]+)/)[1]);
    ok(vz > 134.3 && vz < 134.8, `at the right end (above the Z mass) 1/alpha ≈ ${vz}`);
    const AP = w.alphaPage;
    ok(AP && typeof AP.goto === 'function' && typeof AP.figure === 'function', 'window.alphaPage has goto and figure');
    if (AP) {
      ok(AP.goto(4) && w.__scrolled === 'c4', 'goto(4) scrolls to c4');
      ok(AP.goto('c9') && w.__scrolled === 'c9', "goto('c9') scrolls to c9");
      const inst = await AP.figure('ends');
      ok(inst && typeof inst.show === 'function', 'figure("ends") gives a mounted instance');
      const st = await AP.figure('f3a', 'read');
      ok(st && d.querySelector('#f3a .host[data-pkg="strands"]') && d.querySelector('#f3a .host[data-pkg="ends"]').hidden, 'a strands scene inside the ends card mounts its own host and hides the other');
      ok(d.querySelector('#f3a .cap').textContent.startsWith('A read passes'), 'scene caption follows the scene');
    }
    ok(d.getElementById('noscript').hidden, 'the no-module line is hidden');
    // Menu sheet opens and closes.
    d.getElementById('menuBtn').click();
    const opened = !d.getElementById('menuSheet').hidden;
    d.getElementById('menuClose').click();
    ok(opened && d.getElementById('menuSheet').hidden, 'phone menu opens and closes');
    const playErr = warns.filter(x => /play|show|table/.test(x));
    ok(!playErr.length, 'no figure threw in play, show or a table' + (playErr.length ? ': ' + playErr.slice(0, 4).join(' || ') : ''));
    ok(!errs.length, 'no console.error' + (errs.length ? ': ' + errs.slice(0, 3).join(' || ') : ''));
    if (infos.length) console.log('  info: ' + infos.slice(0, 8).join(' | '));
    console.error = oldErr; console.info = oldInfo; console.warn = oldWarn;
  }
}

console.log(`\n${pass} passed, ${fail} failed` + (skips.length ? `, ${skips.length} skipped` : ''));
process.exit(fail ? 1 : 0);
