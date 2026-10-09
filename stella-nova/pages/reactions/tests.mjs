// ============================================================================
//  REACTIONS  ·  tests.mjs — node tests.mjs   (no network, no browser)
// ----------------------------------------------------------------------------
//  Needs data/species.json (node build/build.mjs). Sections:
//    library ..... every class compiles with every atom mapped; each class
//                  applied to its example gives the expected product
//                  (stereo-free ID code compare); its by-products are the
//                  listed ones; atoms and charge balance; every input atom
//                  lands in exactly one product
//    named ....... each step of each named synthesis gives its product
//    overall ..... combustion, fermentation and Haber balance
//    tex ......... braces balance in every equation; with mathjax-full on
//                  NODE_PATH, MathJax typesets each one without an error
//    block ....... declined targets are declined, common ones are not
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CLASSES, CLASS, NAMED, BASICS, SPECIES } from './templates.js';
import { compile, apply, applyOverall, combustionOf, setOCL, key, blockedWhy, equationTeX } from './react.js';
import { useData, graphOf, keyOfSpecies, ceOf, speciesByKey } from './species.js';
import { counts, fromOCL } from './rxgraph.js';

const here = new URL('.', import.meta.url).pathname;
const V = here + '../../vendor/openchemlib@9.25.1/dist/';
const OCL = await import(V + 'openchemlib.js');
OCL.Resources.register(readFileSync(V + 'resources.json', 'utf8'));
setOCL(OCL);
useData(JSON.parse(readFileSync(here + 'data/species.json', 'utf8')));
let pass = 0, fail = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const T0 = performance.now();
const sumCounts = gs => { const c = {}; for (const g of gs) for (const [k, v] of Object.entries(counts(g))) c[k] = (c[k] || 0) + v; return c; };
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const charge = gs => gs.reduce((s, g) => s + g.charge(), 0);
const nameK = id => speciesByKey(id) || id.slice(0, 10);
globalThis.RX = { OCL, ok };

// ── library ─────────────────────────────────────────────────────────────────
const templ = CLASSES.filter(c => c.kind !== 'overall');
ok(CLASSES.length >= 35, 'library size', `${CLASSES.length} classes, ${templ.length} templates`);
for (const cls of templ) {
  let T = null;
  try { T = compile(cls); } catch (e) { ok(false, `${cls.id}: compiles`, e.message); continue; }
  const n = cls.lhs.length, ins = cls.ex.slice(0, n).map(graphOf), want = keyOfSpecies(cls.ex[n]);
  const outs = apply(cls, ins);
  const hit = outs.find(o => key(o.products[0].G) === want);
  ok(!!hit, `${cls.id}: ${cls.ex.slice(0, n).join(' + ')} -> ${cls.ex[n]}`, hit ? `${outs.length} outcome(s)` : 'got ' + outs.map(o => o.products.map(p => nameK(key(p.G))).join(',')).join(' | '));
  if (!hit) continue;
  const byp = hit.products.slice(1).map(p => nameK(key(p.G))).sort();
  ok(JSON.stringify(byp) === JSON.stringify(cls.byp.slice().sort()), `${cls.id}: by-products`, byp.join(', ') || 'none');
  ok(same(sumCounts(ins), sumCounts(hit.products.map(p => p.G))) && charge(ins) === charge(hit.products.map(p => p.G)), `${cls.id}: atoms and charge balance`);
  const seen = new Uint8Array(ins.reduce((s, g) => s + g.N, 0));
  for (const p of hit.products) for (const o of p.origin) seen[o]++;
  ok(seen.every(v => v === 1), `${cls.id}: atom map complete (each input atom in one product)`);
  ok(T.maps.length === T.l.P.reduce((s, p) => s + p.atoms.length, 0), `${cls.id}: every template atom mapped`, `${T.maps.length} maps`);
}

// ── named syntheses ────────────────────────────────────────────────────────
for (const N of NAMED) {
  let good = true, info = '';
  N.steps.forEach(([cid, ks, prod], i) => {
    const cls = CLASS[cid];
    const want = keyOfSpecies(prod || (i === N.steps.length - 1 ? N.target : null) || '') || null;
    let outs;
    if (cls.kind === 'overall') outs = [applyOverall(cls, cls.lhsQ.map(([k, q]) => [graphOf(k), q]), cls.rhsQ.map(([k, q]) => [graphOf(k), q]))];
    else outs = apply(cls, ks.map(graphOf));
    const keys = outs.map(o => o.products.map(p => key(p.G)));
    const hit = want ? keys.some(k => k.includes(want)) : outs.length > 0;
    if (!want) info = 'no product key';
    if (!hit) { good = false; info = `step ${i + 1} ${cid}`; }
  });
  ok(good, `named ${N.id}: every step gives its product`, info);
}

// ── overall ────────────────────────────────────────────────────────────────
{
  const meth = combustionOf(graphOf('methane')), eth = combustionOf(graphOf('ethane')), etoh = combustionOf(graphOf('ethanol'));
  ok(meth && meth.fuel === 1 && meth.o2 === 2 && meth.co2 === 1 && meth.h2o === 2, 'combustion CH4 + 2O2 -> CO2 + 2H2O');
  ok(eth && eth.fuel === 2 && eth.o2 === 7 && eth.co2 === 4 && eth.h2o === 6, 'combustion 2C2H6 + 7O2 -> 4CO2 + 6H2O');
  ok(etoh && etoh.fuel === 1 && etoh.o2 === 3, 'combustion C2H5OH + 3O2 -> 2CO2 + 3H2O');
  ok(combustionOf(graphOf('etbr')) === null, 'combustion declines a fuel with Br');
  const c = combustionOf(graphOf('ethane'));
  const o = applyOverall(CLASS.combustion, [[graphOf('ethane'), c.fuel], [graphOf('o2'), c.o2]], [[graphOf('co2'), c.co2], [graphOf('water'), c.h2o]]);
  const seen = new Uint8Array(o.inputs.reduce((s, g) => s + g.N, 0)); for (const p of o.products) for (const x of p.origin) seen[x]++;
  ok(seen.every(v => v === 1) && o.products.every(p => [...p.origin].every((x, j) => o.inputs.length && p.G.z[j] === unionZ(o)[x])), 'combustion atom map: complete, same elements');
  for (const id of ['fermentation', 'haber']) {
    const cls = CLASS[id];
    const r = applyOverall(cls, cls.lhsQ.map(([k, q]) => [graphOf(k), q]), cls.rhsQ.map(([k, q]) => [graphOf(k), q]));
    ok(same(sumCounts(r.inputs), sumCounts(r.products.map(p => p.G))), `${id} balances`);
  }
}
function unionZ(o) { const z = []; for (const g of o.inputs) for (let i = 0; i < g.N; i++) z.push(g.z[i]); return z; }

// ── TeX ────────────────────────────────────────────────────────────────────
{
  const all = [];
  for (const cls of CLASSES) {
    all.push([cls.id + ' general', `\\ce{${cls.tex}}`]);
    if (cls.kind !== 'overall') {
      const n = cls.lhs.length, terms = [];
      cls.ex.slice(0, n).forEach((k, i) => { const r = cls.role[i]; const f = typeof r === 'string' && r.startsWith('f:'); const ce = f && k === 'h2' ? '[H]' : ceOf(k); const t = terms.find(x => x.ce === ce); if (t) t.n++; else terms.push({ ce, n: f && k === 'h2' ? 2 : 1 }); });
      const right = [{ ce: ceOf(cls.ex[n]), n: 1 }, ...cls.byp.map(k => ({ ce: ceOf(k), n: 1 }))];
      all.push([cls.id + ' example', equationTeX(cls, terms, right)]);
    }
  }
  const bal = s => { let d = 0; for (const ch of s.replace(/\\[{}]/g, '')) { if (ch === '{') d++; else if (ch === '}' && --d < 0) return false; } return d === 0; };
  const sq = s => { let d = 0; for (const ch of s) { if (ch === '[') d++; else if (ch === ']' && --d < 0) return false; } return d === 0; };
  ok(all.every(([, t]) => bal(t) && sq(t)), 'TeX: braces and brackets balance', `${all.length} equations`);
  let MJ = null;
  try {
    const req = createRequire((process.env.NODE_PATH || '/nonexistent') + '/');
    const { mathjax } = req('mathjax-full/js/mathjax.js'), { TeX } = req('mathjax-full/js/input/tex.js');
    req('mathjax-full/js/input/tex/AllPackages.js');
    const { SVG } = req('mathjax-full/js/output/svg.js'), { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js'), { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
    const ad = liteAdaptor(); RegisterHTMLHandler(ad);
    const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'mhchem', 'html', 'color'] }), OutputJax: new SVG({ fontCache: 'none' }) });
    MJ = t => { const n = doc.convert(t, { display: true }); const s = ad.outerHTML(n); return /data-mjx-error|merror|fill="red"/.test(s) ? s.match(/data-mjx-error="([^"]*)"/)?.[1] || 'error' : null; };
  } catch (e) { MJ = null; }
  if (MJ) {
    const bad = all.map(([n, t]) => [n, MJ(t)]).filter(x => x[1]);
    ok(!bad.length, 'TeX: MathJax 3.2.2 (mhchem) typesets every equation', bad.length ? bad.slice(0, 4).map(b => b[0] + ': ' + b[1]).join('; ') : `${all.length} equations`);
    globalThis.RX.MJ = MJ;
  } else console.log('SKIP  TeX typeset: mathjax-full not on NODE_PATH');
}

// ── declined targets ───────────────────────────────────────────────────────
{
  const g = s => fromOCL(OCL, OCL.Molecule.fromSmiles(s));
  for (const [s, n] of [['Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]', 'TNT'], ['C(C(CO[N+](=O)[O-])O[N+](=O)[O-])O[N+](=O)[O-]', 'nitroglycerin'],
    ['CNC(C)Cc1ccccc1', 'methamphetamine'], ['CC(C)OP(C)(=O)F', 'sarin'], ['ClCCSCCCl', 'sulfur mustard'], ['CC1(C)OOC(C)(C)OOC(C)(C)OO1', 'TATP'],
    ['[O-][N+](=O)c1cccc([N+](=O)[O-])c1', '1,3-dinitrobenzene']])
    ok(!!blockedWhy(g(s)), `block: ${n} declined`, blockedWhy(g(s)) || '');
  for (const k of ['aspirin', 'paracetamol', 'ethylacetate', 'tamyl', 'nitrobenzene', 'glycerol', 'aniline', 'hno3', 'o2'])
    ok(!blockedWhy(graphOf(k)), `block: ${k} allowed`);
}
export { ok };
const finish = () => { console.log(`\n${pass} passed, ${fail} failed  (${((performance.now() - T0) / 1000).toFixed(1)} s)`); process.exit(fail ? 1 : 0); };

globalThis.RX.finish = finish;

// ── 3D change (rxanim.js) ──────────────────────────────────────────────────
{
  const { runStep, nodeOfSpecies } = await import('./steps.js');
  const { makeScene } = await import('./rxanim.js');
  const { decode } = await import('../molecules/chem.js');
  const cases = [['sn2', ['etbr', 'naoh']], ['fischer', ['aceticacid', 'ethanol']], ['nitro-reduce', ['nitrobenzene', 'h2', 'h2', 'h2']],
    ['diels-alder', ['butadiene', 'maleican']], ['grignard', ['acetone', 'etmgbr', 'water']], ['combustion', ['methane']], ['suzuki', ['bromobenzene', 'phboh2', 'naoh']],
    ['ox-primary', ['ethanol', 'oform']], ['kolbe', ['phenol', 'co2']]];
  for (const [cid, ks] of cases) {
    const st = runStep(OCL, cid, ks.map(nodeOfSpecies));
    if (!st) { ok(false, `anim ${cid}: step runs`); continue; }
    const S = makeScene(st);
    let finite = true;
    for (let t = 0; t <= S.T + 0.01; t += 0.05) { const f = S.at(t); for (const v of f.pos) if (!Number.isFinite(v)) finite = false; for (const a of f.alpha) if (!(a >= 0 && a <= 1)) finite = false; }
    ok(finite, `anim ${cid}: every mapped atom finite, bond alpha in 0..1`, `${S.U} atoms, ${S.bonds.length} bonds, ${S.T.toFixed(1)} s`);
    // at the end of the rearrange the main product sits at its own conformer
    const f = S.at(S.phases.tR), P = decode(st.products[0].rec), og = st.products[0].origin;
    let err = 0;
    for (let i = 0; i < og.length; i++) for (let j = i + 1; j < og.length; j++) {
      const a = og[i], b = og[j];
      const d1 = Math.hypot(f.pos[3 * a] - f.pos[3 * b], f.pos[3 * a + 1] - f.pos[3 * b + 1], f.pos[3 * a + 2] - f.pos[3 * b + 2]);
      const d0 = Math.hypot(P.xyz[3 * i] - P.xyz[3 * j], P.xyz[3 * i + 1] - P.xyz[3 * j + 1], P.xyz[3 * i + 2] - P.xyz[3 * j + 2]);
      err = Math.max(err, Math.abs(d1 - d0));
    }
    ok(err < 1e-3, `anim ${cid}: ends at the product geometry`, `max distance error ${err.toExponential(1)} A`);
    // every by-product keeps its own geometry while it drifts away
    let berr = 0;
    st.products.slice(1).forEach(p => { const Q = decode(p.rec), g = S.at(S.T).pos; for (let i = 0; i < p.origin.length; i++) for (let j = i + 1; j < p.origin.length; j++) { const a = p.origin[i], b = p.origin[j]; berr = Math.max(berr, Math.abs(Math.hypot(g[3 * a] - g[3 * b], g[3 * a + 1] - g[3 * b + 1], g[3 * a + 2] - g[3 * b + 2]) - Math.hypot(Q.xyz[3 * i] - Q.xyz[3 * j], Q.xyz[3 * i + 1] - Q.xyz[3 * j + 1], Q.xyz[3 * i + 2] - Q.xyz[3 * j + 2]))); } });
    ok(berr < 1e-3, `anim ${cid}: by-products rigid at the end`, `${st.products.length - 1} by-product(s)`);
    const kinds = S.bonds.reduce((m, b) => (m[b.kind] = (m[b.kind] || 0) + 1, m), {});
    ok((kinds.break || 0) + (kinds.form || 0) + (kinds.change || 0) > 0 && S.centre.some(Boolean), `anim ${cid}: reaction centre found`, JSON.stringify(kinds));
    ok(/^\\ce\{.+->|<=>/.test(st.tex), `anim ${cid}: step TeX`, st.tex);
    if (globalThis.RX.MJ) ok(!globalThis.RX.MJ(st.tex), `anim ${cid}: step TeX typesets`);
  }
}


// ── tree (synth.js) ────────────────────────────────────────────────────────
{
  const { fromNamed, layout, overlaps, growOrder, treeOf } = await import('./synth.js');
  const all = [];
  for (const N of NAMED) {
    let S = null;
    try { S = fromNamed(OCL, N); } catch (e) { ok(false, `tree ${N.id}: builds`, e.message); continue; }
    all.push(S);
    const T = treeOf(S), leaves = T.tips.length;
    ok(S.nodes[S.root].mol.key === keyOfSpecies(N.target), `tree ${N.id}: the root is the target`, `${S.steps.length} step(s), ${leaves} leaves`);
    for (const kind of ['clado', 'radial', 'fan']) {
      const L = layout(S, kind, 150), bad = overlaps(L);
      const fin = T.keep.every(id => { const b = L.fish[id], p = L.pos[id]; return b && p && [b.x, b.y, b.w, b.h, p.x, p.y].every(Number.isFinite); });
      ok(!bad.length && fin, `tree ${N.id}: ${kind} layout, no overlapping nodes`, bad.length ? JSON.stringify(bad) : `${T.keep.length} nodes in ${L.w.toFixed(0)} x ${L.h.toFixed(0)}`);
      if (kind === 'clado') ok(S.steps.every(s => s.ins.every(c => !L.pos[c] || L.pos[c].x < L.pos[s.out].x)), `tree ${N.id}: clado leaves left of their product`);
    }
    const g = growOrder(S), at = new Map(g.map((id, i) => [id, i]));
    ok(S.steps.every(s => s.ins.every(i => at.get(i) < at.get(s.out))), `tree ${N.id}: growth order puts inputs before products`);
  }
  globalThis.RX.synths = all;
}
if (!process.env.RX_MORE3) finish();
