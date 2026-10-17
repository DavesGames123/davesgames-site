// ============================================================================
//  TENSOR CALCULUS  ·  tests/library.test.mjs  (LIBRARY)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/tensor-calculus/tests/library.test.mjs
//  With MathJax (the TeX typeset section needs mathjax-full 3.2.2):
//      cd "$(mktemp -d)" && npm i mathjax-full@3.2.2 && \
//        NODE_PATH="$PWD/node_modules" node <repo>/stella-nova/pages/tensor-calculus/tests/library.test.mjs
//  Without NODE_PATH the typeset section prints SKIP and the brace check
//  still runs. Exit code 1 on any failure.
//
//  SECTIONS   (grep -n "^section(" tests/library.test.mjs)
//      shape ...... ids, fields, params, refs, stories, scenes, paths
//      indices .... every main equation parses (MATH) and both sides agree;
//                   the LIBRARY stub parser finds the same free indices
//      traces ..... every trace runs (defaults and seeded random params),
//                   steps are valid OpTrace steps, closed-form checks pass
//      engines .... stub-math finite differences against MATH exact jets
//      search ..... library search ranks title hits first
//      tex ........ braces balance; MathJax typesets every TeX string
// ============================================================================
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(join(ROOT, 'library/index.js'));
const M = await import(join(ROOT, 'library/math.js'));
const S = await import(join(ROOT, 'library/stub-math.js'));
const K = await import(join(ROOT, 'library/kit.js'));

let pass = 0, fail = 0, current = '';
const section = name => { current = name; };
function ok(cond, name, detail = '') {
  if (cond) { pass++; console.log(`ok    ${current} :: ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`FAIL  ${current} :: ${name}${detail ? '\n      ' + detail : ''}`); }
}
// First batch: algebra and geometry. The gate goes to 36 entries and all
// eight fields when the other field files land.
const MIN_ENTRIES = 20, ALL_FIELDS = false;
const FIELD_IDS = new Set(L.FIELDS.map(f => f.id));
const KINDS = new Set(['product', 'contract', 'raise', 'lower', 'transform', 'symmetrize', 'antisymmetrize', 'partial', 'covariant', 'christoffel', 'trace', 'expandSum', 'substitute', 'relabel', 'evaluate']);
const lib = L.LIBRARY;

// ---------------------------------------------------------------------------
section('shape');
{
  ok(lib.length >= MIN_ENTRIES, `at least ${MIN_ENTRIES} entries`, `${lib.length} entries`);
  const ids = lib.map(e => e.id);
  ok(new Set(ids).size === ids.length, 'ids are unique', ids.filter((x, i) => ids.indexOf(x) !== i).join(', '));
  const bad = [];
  for (const e of lib) {
    const why = [];
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) why.push('id is not kebab-case');
    if (!e.title || typeof e.title !== 'string') why.push('title');
    if (!FIELD_IDS.has(e.field)) why.push('field ' + e.field);
    if (typeof e.tex !== 'string' || !e.tex) why.push('tex');
    if (typeof e.itex !== 'string' || !e.itex) why.push('itex');
    if (typeof e.expr !== 'function') why.push('expr');
    if (!Array.isArray(e.story) || e.story.length < 3 || e.story.length > 6) why.push(`story has ${e.story?.length} paragraphs`);
    for (const para of e.story || []) if ((para.match(/\$/g) || []).length % 2) why.push('odd $ count in a story paragraph');
    if (!Array.isArray(e.vocab) || !e.vocab.length || e.vocab.some(v => !v.term || !v.meaning)) why.push('vocab');
    if (!Array.isArray(e.params)) why.push('params');
    for (const p of e.params || []) {
      if (!p.key || !p.label || ![p.min, p.max, p.step, p.def].every(Number.isFinite)) why.push('param ' + p.key);
      else if (p.def < p.min || p.def > p.max || p.min >= p.max || p.step <= 0) why.push('param range ' + p.key);
    }
    if (typeof e.trace !== 'function') why.push('trace');
    if (!e.vizLib || !L.SCENE_IDS.has(e.vizLib.scene)) why.push('library scene ' + e.vizLib?.scene);
    if (!e.viz || !L.VIZ_IDS.has(e.viz.scene)) why.push('viz scene ' + e.viz?.scene);
    if (!e.diagram || typeof e.diagram !== 'object' || !['penrose', 'birdtrack', 'network'].includes(e.diagram.style)) why.push('diagram style');
    if (!e.shape || e.shape.rank == null || !e.shape.variance) why.push('shape');
    const refs = e.refs || [];
    if (!refs.length || refs.some(r => !r.text || !/^https:\/\//.test(r.url || ''))) why.push('refs need text and an https url');
    if (!refs.some(r => /wikipedia\.org/.test(r.url))) why.push('no Wikipedia ref');
    if (!refs.some(r => !/^Wikipedia:/.test(r.text))) why.push('no textbook or paper ref');
    if (!e.paths || !e.paths.length) why.push('in no learning path');
    if (why.length) bad.push(`${e.id}: ${why.join('; ')}`);
  }
  ok(!bad.length, 'every entry has the contract fields with valid values', bad.slice(0, 8).join(' | '));
  const counts = {};
  for (const e of lib) counts[e.field] = (counts[e.field] || 0) + 1;
  ok(!ALL_FIELDS || [...FIELD_IDS].every(f => counts[f] >= 1), ALL_FIELDS ? 'every field has at least one entry' : 'fields with entries (first batch)', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
  const badPath = [];
  for (const p of L.PATHS) for (const id of p.steps) if (!L.getEntry(id)) badPath.push(`${p.id}/${id}`);
  ok(!badPath.length && L.PATHS.length >= 4, 'learning paths name real entries', `${L.PATHS.length} paths; ${badPath.join(', ')}`);
  ok(L.SCENES.length >= 17, 'scene list covers the contract VIZ scenes', `${L.SCENES.length} scenes`);
}

// ---------------------------------------------------------------------------
section('indices');
{
  const key = fr => fr.map(i => `${i.sym}${i.up ? '^' : '_'}`).sort().join(' ');
  const bad = [], disagree = [];
  for (const e of lib) {
    const ex = e.expr();
    if (ex.parseError) { bad.push(`${e.id}: parse: ${ex.parseError}`); continue; }
    const v = M.validate(ex);
    if (!v.ok) { bad.push(`${e.id}: ${v.errors.join('; ')}`); continue; }
    const zero = x => x.terms.length === 1 && !x.terms[0].factors.length && Number(x.terms[0].coeff) === 0;
    if (ex.lhs && ex.rhs && !zero(ex.rhs)) {
      const l = key(ex.lhs.free), r = key(ex.rhs.free);
      if (l !== r) bad.push(`${e.id}: free indices {${l}} vs {${r}}`);
    }
    try {
      const sx = S.parseIndexTex(e.itex), sv = S.validate(sx);
      if (!sv.ok || key(sv.free) !== key(v.free)) disagree.push(`${e.id}: stub {${key(sv.free)}} ${sv.errors.join(';')} vs MATH {${key(v.free)}}`);
    } catch (err) { disagree.push(`${e.id}: stub parse: ${err.message}`); }
  }
  ok(!bad.length, 'every main equation parses and validates; both sides have the same free indices', bad.slice(0, 6).join(' | ') || `${lib.length} equations`);
  ok(!disagree.length, 'the stub parser and the MATH parser find the same free indices', disagree.slice(0, 6).join(' | ') || `${lib.length} equations`);
}

// ---------------------------------------------------------------------------
section('traces');
let allTex = [];
const usedViz = new Set();
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const compOk = c => c && Array.isArray(c.shape) && Array.isArray(c.variance) && c.variance.length === c.shape.length && c.variance.every(v => v === 'u' || v === 'd') && c.data && c.data.length === c.shape.reduce((a, b) => a * b, 1) && [...c.data].every(Number.isFinite);
  const badRun = [], badStep = [], badCheck = [], noCheck = [];
  for (const e of lib) usedViz.add(e.viz.scene);
  let nSteps = 0, nChecks = 0, nRuns = 0;
  const t0 = Date.now();
  for (const e of lib) {
    const sets = [L.defaults(e)];
    for (let k = 0; k < 2; k++) sets.push(Object.fromEntries(e.params.map(p => [p.key, p.min + Math.round(rnd() * (p.max - p.min) / p.step) * p.step])));
    for (const [si, params] of sets.entries()) {
      let tr;
      try { tr = e.trace(params); nRuns++; } catch (err) { badRun.push(`${e.id} set ${si}: ${err.message}`); continue; }
      if (!tr || !Array.isArray(tr.steps) || !tr.steps.length || !Number.isInteger(tr.dim)) { badRun.push(`${e.id}: not an OpTrace`); continue; }
      if (!tr.checks.length) noCheck.push(e.id);
      for (const c of tr.checks) { nChecks++; if (!c.ok) badCheck.push(`${e.id} set ${si} ${JSON.stringify(params)}: ${c.label}: got ${c.got}, want ${c.want}`); }
      const ids = new Set();
      for (const s of tr.steps) {
        nSteps++;
        const why = [];
        if (!s.id || ids.has(s.id)) why.push('id'); ids.add(s.id);
        if (!KINDS.has(s.kind)) why.push('kind ' + s.kind);
        if (!s.label || typeof s.label !== 'string') why.push('label');
        for (const side of ['before', 'after']) {
          const x = s[side];
          if (!x || typeof x.tex !== 'string' || !Array.isArray(x.free)) why.push(side);
          else if (x.parseError && s.kind !== 'evaluate') why.push(`${side} does not parse: ${x.parseError}`);
        }
        if (!Array.isArray(s.focus) || !Array.isArray(s.sums) || !(s.ms > 0)) why.push('focus/sums/ms');
        for (const sm of s.sums || []) if (!sm.sym || !Array.isArray(sm.range) || sm.range.length !== 2) why.push('sum range');
        if (s.numeric) {
          if (!compOk(s.numeric.output)) why.push('numeric.output');
          for (const [n, c] of Object.entries(s.numeric.inputs || {})) if (!compOk(c)) why.push('numeric input ' + n);
        }
        if (s.viz && !L.VIZ_IDS.has(s.viz.scene)) why.push('viz scene ' + s.viz.scene);
        if (s.viz) usedViz.add(s.viz.scene);
        if (why.length) badStep.push(`${e.id}/${s.id}: ${why.join('; ')}`);
        if (si === 0) allTex.push([`${e.id}/${s.id} before`, s.before.tex], [`${e.id}/${s.id} after`, s.after.tex]);
      }
    }
  }
  ok(!badRun.length, 'every trace runs with default and random params', badRun.slice(0, 6).join(' | ') || `${nRuns} runs in ${Date.now() - t0} ms`);
  ok(!badStep.length, 'every step is a valid OpTrace step', badStep.slice(0, 6).join(' | ') || `${nSteps} steps`);
  ok(!noCheck.length, 'every trace has at least one closed-form check', noCheck.join(', '));
  ok(!badCheck.length, 'every numeric result matches its closed form', badCheck.slice(0, 6).join(' | ') || `${nChecks} checks`);
}

// ---------------------------------------------------------------------------
section('viz');
{
  // The VIZ registry is DOM-free. Every scene id that leaves LIBRARY must be one of its ids.
  let reg = null;
  try { reg = await import(join(ROOT, 'viz/registry.js')); } catch (err) { console.log('SKIP  viz :: VIZ registry does not load yet: ' + err.message.split('\n')[0]); }
  if (reg) {
    const known = new Set(reg.SCENE_IDS), missing = [...usedViz].filter(id => !known.has(id));
    ok(!missing.length, 'every scene id in entries and steps is a VIZ scene (viz/registry.js)', missing.join(', ') || `${usedViz.size} scenes used of ${known.size}`);
  }
}

// ---------------------------------------------------------------------------
section('engines');
{
  // LIBRARY's finite-difference stub against MATH's exact jets, same metrics.
  const cases = [
    ['sphere', [1.1, 0.4], { R: 1.7 }, K.METRICS.sphere(1.7)],
    ['polar', [1.3, 0.6], {}, K.METRICS.polar()],
    ['spherical', [1.4, 0.8, 0.3], {}, K.METRICS.spherical()],
    ['schwarzschild', [0, 7, 1.0, 0.2], { M: 1 }, K.METRICS.schwarzschild(1)],
    ['flrw', [1.5, 0.4, 1.0, 0.2], { k: 0, p: 2 / 3 }, K.METRICS.flrw(t => t ** (2 / 3), 0)],
  ];
  const rel = (a, b) => { let m = 0, s = 0; for (let i = 0; i < a.data.length; i++) { m = Math.max(m, Math.abs(a.data[i] - b.data[i])); s = Math.max(s, Math.abs(b.data[i])); } return m / Math.max(s, 1); };
  for (const [id, x, prm, lm] of cases) {
    const gM = M.christoffel(id, x, prm), gS = S.christoffel(lm, x);
    const rM = M.riemann(id, x, prm), rS = S.riemann(lm, x);
    const eG = rel(gS, gM), eR = rel(rS, rM);
    ok(eG < 1e-6 && eR < 1e-3, `${id}: stub Christoffel and Riemann agree with MATH`, `Gamma ${eG.toExponential(1)}, Riemann ${eR.toExponential(1)}`);
  }
  const RM = M.scalarCurvature('sphere', [0.9, 0.1], { R: 2 }), RS = S.scalarCurvature(K.METRICS.sphere(2), [0.9, 0.1]);
  ok(Math.abs(RM - 0.5) < 1e-12 && Math.abs(RS - 0.5) < 1e-5, 'sphere R = 2/a^2 in both engines', `MATH ${RM}, stub ${RS}`);
}

// ---------------------------------------------------------------------------
section('search');
{
  const r1 = L.search('riemann'), r2 = L.search('attention'), r3 = L.search('');
  ok(r1[0] && r1[0].id === 'riemann-tensor', 'search "riemann" gives the Riemann entry first', r1.slice(0, 3).map(e => e.id).join(', '));
  if (ALL_FIELDS) ok(r2.length >= 1 && r2[0].field === 'ml', 'search "attention" gives an ML entry first', r2.slice(0, 2).map(e => e.id).join(', '));
  ok(r3.length === lib.length, 'empty search gives every entry');
}

// ---------------------------------------------------------------------------
section('tex');
{
  for (const e of lib) {
    allTex.push([`${e.id} tex`, e.tex], [`${e.id} itex`, e.itex]);
    try { allTex.push([`${e.id} toTex colours`, M.toTex(e.expr(), { colors: true })]); } catch (err) { allTex.push([`${e.id} toTex`, '\\error{' + err.message + '}']); }
    e.story.forEach((p, k) => { for (const m of p.matchAll(/\$([^$]+)\$/g)) allTex.push([`${e.id} story ${k + 1}`, m[1]]); });
  }
  const unbalanced = allTex.filter(([, t]) => { let d = 0; for (let i = 0; i < t.length; i++) { if (t[i] === '\\') { i++; continue; } if (t[i] === '{') d++; if (t[i] === '}' && --d < 0) return true; } return d !== 0; });
  ok(!unbalanced.length, 'braces balance in every TeX string', unbalanced.slice(0, 4).map(x => x[0]).join(', ') || `${allTex.length} strings`);
  let req = null;
  try { if (process.env.NODE_PATH) { req = createRequire(join(process.env.NODE_PATH, '/')); req.resolve('mathjax-full/js/mathjax.js'); } } catch { req = null; }
  if (req) {
    const { mathjax } = req('mathjax-full/js/mathjax.js'), { TeX } = req('mathjax-full/js/input/tex.js');
    for (const pk of ['base/BaseConfiguration', 'ams/AmsConfiguration', 'html/HtmlConfiguration', 'color/ColorConfiguration', 'newcommand/NewcommandConfiguration', 'boldsymbol/BoldsymbolConfiguration']) req(`mathjax-full/js/input/tex/${pk}.js`);
    const { SVG } = req('mathjax-full/js/output/svg.js'), { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js'), { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
    const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
    const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html', 'color', 'newcommand', 'boldsymbol'], formatError: (_, err) => { throw err; } }), OutputJax: new SVG({ fontCache: 'none' }) });
    const bad = [];
    for (const [where, t] of allTex) {
      try { const html = adaptor.outerHTML(doc.convert(t, { display: true })); if (/merror|data-mjx-error/.test(html)) bad.push(`${where}: error node`); }
      catch (err) { bad.push(`${where}: ${err.message} in ${t.slice(0, 80)}`); }
    }
    ok(!bad.length, 'MathJax 3.2.2 typesets every TeX string (base, ams, html, color, newcommand, boldsymbol)', bad.slice(0, 6).join(' | ') || `${allTex.length} strings`);
  } else console.log('SKIP  tex :: MathJax typeset (mathjax-full is not on NODE_PATH)');
}

console.log(`\nlibrary: ${pass} passed, ${fail} failed; ${lib.length} entries (${L.FIELDS.map(f => `${f.id} ${L.byField(f.id).length}`).join(', ')}); engine ${M.MATH_SOURCE}`);
process.exit(fail ? 1 : 0);
