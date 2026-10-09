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
  const { nodeOfSpecies } = await import('./steps.js');
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
  const { emptySynth, addLeaf } = await import('./synth.js');
  const one = emptySynth(); addLeaf(one, nodeOfSpecies('ethanol'));
  ok(['clado', 'radial', 'fan'].every(k => { const L = layout(one, k, 150); const b = L.fish[0]; return b && [b.x, b.y, b.w, b.h, L.w, L.h].every(Number.isFinite); }), 'tree: a one-molecule tree lays out in all three layouts');
  for (const S of all.filter(x => x.named === 'fermentation' || x.named === 'haber')) ok(S.nodes.every(n => n.used >= 0 || n.id === S.root), `tree ${S.named}: no orphan nodes`, `${S.nodes.length} nodes`);
}


// ── builder ────────────────────────────────────────────────────────────────
{
  const { Builder } = await import('./builder.js');
  const { nodeOfSpecies } = await import('./steps.js');
  const b = new Builder(OCL);
  const a = b.add(nodeOfSpecies('aceticacid')), e = b.add(nodeOfSpecies('ethanol'));
  const opts = b.options([a, e]);
  const fis = opts.find(o => o.cls === 'fischer');
  ok(!!fis && fis.items[0].main === 'Ethyl acetate', 'builder: acetic acid + ethanol offers Fischer esterification', opts.map(o => o.cls).join(', '));
  const n0 = b.S.nodes.length, s0 = b.S.steps.length;
  const p = b.apply(fis, 0);
  ok(p >= 0 && b.S.root === p && b.S.nodes[a].used === p && b.S.nodes[e].used === p && b.S.steps.length === s0 + 1, 'builder: apply adds a step; its inputs are used');
  const o2 = b.options([p]).find(o => o.cls === 'saponify');
  ok(!!o2, 'builder: the product offers saponification');
  b.apply(o2, 0);
  const link = b.encode();
  const b2 = Builder.decode(OCL, link, k => (k.startsWith('smi:') ? null : nodeOfSpecies(k)));
  ok(b2.S.nodes.length === b.S.nodes.length && b2.S.nodes[b2.S.root].mol.key === b.S.nodes[b.S.root].mol.key, 'builder: share link rebuilds the same tree', `${link.length} chars`);
  b.undo();
  ok(b.S.steps.length === s0 + 1 && b.S.root === p && b.S.nodes[p].used < 0, 'builder: undo removes the last step and frees its input');
  b.undo();
  ok(b.S.nodes.length === n0 && b.S.steps.length === s0 && b.S.nodes[a].used < 0 && b.S.nodes[e].used < 0, 'builder: undo again gives the surface back');
  b.undo(); b.undo();
  ok(b.S.nodes.length === 0 && !b.undo(), 'builder: undo to empty, then nothing to undo');
  // a declined product is held back: toluene nitrated twice would be a polynitro compound
  const c = new Builder(OCL); const t = c.add(nodeOfSpecies('nitrobenzene'));
  const nit = c.options([t]).find(o => o.cls === 'nitrate');
  ok(!!nit && nit.items.every(i => i.why) && c.apply(nit, 0) === -1, 'builder: a second nitration is declined (polynitro)', nit ? nit.items.map(i => i.why).join('; ') : 'no option');
  const ph = c.add(nodeOfSpecies('phenol'));
  const np = c.options([ph]).find(o => o.cls === 'nitrate');
  ok(!!np && np.items.length === 2 && np.items.every(i => !i.why), 'builder: phenol nitration gives ortho and para (not meta)', np ? np.items.map(i => i.main).join(', ') : '');
}

// ── retrosynthesis ─────────────────────────────────────────────────────────
{
  const { findRoutes, setRetroOCL } = await import('./retro.js');
  const { fromRoute } = await import('./synth.js');
  const { nodeOfGraph } = await import('./steps.js');
  setRetroOCL(OCL);
  const g = s => fromOCL(OCL, OCL.Molecule.fromSmiles(s));
  for (const [sp, maxS] of [['aspirin', 2], ['ethylacetate', 1], ['paracetamol', 3], ['tamyl', 2], ['acetophenone', 2]]) {
    const t0 = performance.now(), r = findRoutes(graphOf(sp), { maxSteps: 6 }), ms = performance.now() - t0;
    const best = r.routes[0];
    ok(!!best && best.steps.length <= maxS && ms < 15000, `retro ${sp}: a route within 6 steps, in time`, best ? `${best.steps.map(s => s.cls).join(' > ')} from ${[...new Set(best.leaves)].join(', ')}; ${best.steps.length} step(s), ${(ms / 1000).toFixed(1)} s, ${r.stats.expanded} expansions` : r.reason);
    if (!best) continue;
    const basicsK = new Set(BASICS.map(b => b[0]));
    ok(best.leaves.every(l => basicsK.has(l)), `retro ${sp}: every starting compound is on the basics list`);
    let S = null; try { S = fromRoute(OCL, best, smi => nodeOfGraph(OCL, g(smi))); } catch (e) { S = null; }
    ok(!!S && S.nodes[S.root].mol.key === keyOfSpecies(sp), `retro ${sp}: the route runs forward to the target`);
  }
  const caf = findRoutes(g('CN1C=NC2=C1C(=O)N(C(=O)N2C)C'), { maxSteps: 6 });
  ok(!caf.routes.length && (caf.reason === 'none' || caf.reason === 'limit'), 'retro caffeine: no route, said honestly', `${caf.reason}, ${caf.stats.ms} ms`);
  const tnt = findRoutes(g('Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]'));
  ok(/^blocked/.test(tnt.reason || '') && !tnt.routes.length, 'retro TNT: declined', tnt.reason);
  const meth = findRoutes(g('CNC(C)Cc1ccccc1'));
  ok(/^blocked/.test(meth.reason || ''), 'retro methamphetamine: declined', meth.reason);
  ok(findRoutes(graphOf('ethanol')).reason === 'basic', 'retro ethanol: already a basic compound');
  const lim = findRoutes(graphOf('tamyl'), { maxSteps: 1 });
  ok(!lim.routes.length, 'retro: the step limit holds (2-methylbutan-2-ol needs 2 steps)', lim.reason);
}

// ── saver and phone limits ─────────────────────────────────────────────────
{
  const { makeScene } = await import('./rxanim.js');
  const src = readFileSync(here + 'saver.js', 'utf8');
  const ids = JSON.parse(src.match(/const SYNTHS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  let lo = 1e9, hi = 0, n = 0;
  for (const S of globalThis.RX.synths) {
    if (!ids.includes(S.named)) continue;
    for (const s of S.steps) for (const calm of [0, 1]) { const T = makeScene(s.st, { turn: 1.5 + 1.5 * calm }).T; lo = Math.min(lo, T); hi = Math.max(hi, T); n++; }
    for (const calm of [0, 1]) { const d = Math.min(12, Math.max(5, 4.5 + 1.1 * S.steps.length + 2.5 * calm)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  }
  ok(lo >= 5 && hi <= 12, 'saver: every shot lasts 5-12 s', `${n} step shots, ${lo.toFixed(1)}-${hi.toFixed(1)} s`);
  ok(ids.every(id => NAMED.some(x => x.id === id)) && ids.length >= 6, 'saver: the tour names only built syntheses', ids.join(', '));
  ok(!/code\s*:/.test(src), 'saver: the plate carries no code extract');
  const css = readFileSync(here + 'style.css', 'utf8'), html = readFileSync(here + 'index.html', 'utf8');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'css: [hidden]{display:none!important}');
  const coarse = css.slice(css.indexOf('@media (pointer:coarse)'), css.indexOf('/* PHONE'));
  ok(/input\{font-size:16px\}/.test(coarse) && /min-height:44px/.test(coarse) && /height:44px/.test(coarse), 'css: touch targets 44 px and 16 px inputs on a coarse pointer');
  const heads = [...html.matchAll(/<script src="\.\.\/\.\.\/lib\/([a-z-]+)\.js"><\/script>/g)].map(m => m[1]);
  ok(heads.join(',') === 'gpu-guard,wishlist,stats-beacon' && html.indexOf('gpu-guard') < html.indexOf('<meta'), 'html: head scripts gpu-guard, wishlist, stats-beacon first', heads.join(', '));
  const hid = [...html.matchAll(/id="([^"]+)"[^>]*\bhidden\b/g)].map(m => m[1]);
  ok(hid.every(id => !new RegExp('#' + id + '\\{[^}]*display:(?!none)').test(css) || /\[hidden\]\{display:none!important\}/.test(css)), 'css: hidden elements stay hidden', hid.join(', '));
}
{
  // route.js: in the shell, the share link is the shell URL #<tab>/<route>
  // and snNav gets the route; alone, the page URL.
  const { setRoute, shareUrl } = await import('./route.js');
  const mk = (hash) => ({ hash, origin: 'https://davesgames.io', pathname: '/stella-nova/', get href() { return this.origin + this.pathname + this.hash; } });
  const calls = [];
  const shell = { location: mk('#reactions/s=aspirin'), snNav: (r, m) => calls.push([r, m]) };
  const frame = { location: mk(''), parent: shell, history: { replaceState: (a, b, h) => { frame.location.hash = h; } } };
  frame.location.pathname = '/stella-nova/pages/reactions/index.html';
  setRoute('b=abc_-', frame);
  const url = shareUrl('b=abc_-', frame);
  ok(frame.location.hash === '#b=abc_-' && calls.length === 1 && calls[0][0] === 'b=abc_-' && calls[0][1] === 'replace', 'route: setRoute writes the frame hash and calls snNav(route, replace)');
  ok(url === 'https://davesgames.io/stella-nova/#reactions/b=abc_-', 'route: the share link in the shell is #reactions/<route>', url);
  const alone = { location: mk(''), history: { replaceState() {} } }; alone.parent = alone;
  ok(shareUrl('s=soap', alone) === 'https://davesgames.io/stella-nova/#s=soap', 'route: alone, the share link is the page URL');
}
// ── TeX on the browser path (lib/sci-math.js + vendor MathJax) ─────────────
// The page typesets every chip of the tree and the step pane at the same
// time, through lib/sci-math.js and the vendored es5/tex-svg.js, and \ce
// loads mhchem by autoload on first use. The mathjax-full check above
// preloads mhchem, so it passed while the page showed raw TeX.
{
  const { typeset } = await import('../../lib/sci-math.js');
  // 1. the queue: never two MathJax calls at once (no DOM needed)
  let active = 0, most = 0;
  const fakeNode = { querySelector: () => null, querySelectorAll: () => [] };
  globalThis.window = { MathJax: { tex2svgPromise: async () => { active++; most = Math.max(most, active); await new Promise(r => setTimeout(r, 2)); active--; return fakeNode; } } };
  const box = () => ({ dataset: {}, classList: { add() {}, remove() {} }, replaceChildren() {}, setAttribute() {}, set textContent(v) {} });
  const res = await Promise.all(Array.from({ length: 12 }, (_, i) => typeset(box(), '\\ce{A' + i + '}')));
  ok(most === 1 && res.every(Boolean), 'sci-math: one MathJax call at a time', `${res.length} calls, most at once ${most}`);
  delete globalThis.window;
  // 2. the real load path in jsdom (NODE_PATH must hold jsdom)
  let JSDOM = null;
  try { JSDOM = createRequire((process.env.NODE_PATH || '/nonexistent') + '/')('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) console.log('SKIP  TeX browser path: jsdom not on NODE_PATH');
  else {
    const { pathToFileURL } = await import('node:url');
    const { emptySynth, addStep } = await import('./synth.js');
    const eqs = [];
    for (const cls of CLASSES) {
      eqs.push([cls.id + ' class', `\\ce{${cls.tex}}`, true]);
      const ins = cls.kind === 'overall' ? (cls.fuel ? cls.ex.slice(0, 1) : cls.lhsQ.map(x => x[0])) : cls.ex.slice(0, cls.lhs.length);
      const syn = emptySynth();
      if (addStep(syn, OCL, cls, ins) < 0) { ok(false, `TeX browser path: ${cls.id} example runs`); continue; }
      for (const d of [false, true]) eqs.push([cls.id + ' example', syn.steps[0].st.tex, d]);
    }
    for (const S of globalThis.RX.synths) for (const s of S.steps) for (const d of [false, true]) eqs.push([S.named + ' ' + s.st.cls, s.st.tex, d]);
    const lib = here + '../../lib/sci-math.js';
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: pathToFileURL(here + 'index.html').href, runScripts: 'dangerously', resources: 'usable' });
    const w = dom.window;
    // run lib/sci-math.js itself in the window (its config objects must
    // come from the page realm, as in the browser)
    const src = readFileSync(lib, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(lib).href)).replace(/^export /gm, '');
    w.eval(`(function () { ${src}\n window.__sm = { typeset, loadMath }; })();`);
    const els = eqs.map(() => w.document.body.appendChild(w.document.createElement('div')));
    const t0 = performance.now();
    const all = Promise.all(eqs.map(([, tex, display], i) => w.__sm.typeset(els[i], tex, { display })));
    const out = await Promise.race([all, new Promise(r => setTimeout(() => r(null), 120000))]);
    // the chip size of each inline equation, for the chip placement test
    globalThis.RX.chipVB = new Map();
    eqs.forEach(([, tex, display], i) => { const v = !display && els[i].querySelector('svg'); if (v) globalThis.RX.chipVB.set(tex, v.getAttribute('viewBox').split(/[\s,]+/).map(Number)); });
    const bad = out ? eqs.filter((e, i) => !out[i] || els[i].classList.contains('raw') || !els[i].querySelector('svg')) : eqs;
    ok(!!out && !bad.length, 'TeX browser path: every equation of the page typesets (vendor MathJax, autoload mhchem, all at once)',
      bad.length ? `${bad.length} raw: ` + bad.slice(0, 3).map(b => b[0] + ' ' + b[1]).join(' | ') : `${eqs.length} typesets, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    w.close();
  }
}

// ── tree fit (treefit.js): 3D default, stills, 2D art, names, chips ─────────
{
  const T = await import('./treefit.js');
  const { layout, emptySynth, addStep } = await import('./synth.js');
  const { decode, el } = await import('../molecules/chem.js');
  const main = readFileSync(here + 'main.js', 'utf8'), html = readFileSync(here + 'index.html', 'utf8');
  ok(/export const S = \{[^}]*\bd3: true\b/.test(main) && /class="tb tog on" id="b3d"/.test(html), 'tree: 3D stills on by default (S.d3 and the 3D button)');
  // every tree the page can show: the named syntheses and each class example
  const trees = globalThis.RX.synths.map(S => [S.named, S]);
  for (const cls of CLASSES) {
    const ins = cls.kind === 'overall' ? (cls.fuel ? cls.ex.slice(0, 1) : cls.lhsQ.map(x => x[0])) : cls.ex.slice(0, cls.lhs.length);
    const syn = emptySynth(); if (addStep(syn, OCL, cls, ins) >= 0) trees.push(['class ' + cls.id, syn]);
  }
  const VB = globalThis.RX.chipVB;
  const size = tex => (VB && VB.has(tex) ? T.chipBox(VB.get(tex)[2], VB.get(tex)[3]) : T.chipGuess(tex));
  const stillCache = new Map(), artCache = new Map();
  let nCards = 0, nSmall = 0, stillLo = 9, stillHi = 0, badStill = [], badName = [], artLo = 9, strokeLo = 9, badArt = [], nChip = 0, badChip = [], spreadHi = 1;
  for (const [name, S] of trees) for (const kind of ['clado', 'radial', 'fan']) {
    const L0 = layout(S, kind, 150);
    // names and art boxes
    for (const id of L0.ids) {
      const b = L0.fish[id], m = S.nodes[id].mol, g = T.cardGeom(b, m.name);
      nCards++;
      const wide = g.lab.lines.map(l => T.textWidth(l, g.lab.fs)).filter(x => x > g.lab.tw + 0.01);
      if (wide.length || g.lab.lines.length > 2 || g.art.h < 0.45 * b.h || g.art.y + g.art.h > b.h - 2 - g.labH + 0.01) badName.push(`${name}/${kind} ${m.name}: ${g.lab.lines.join(' | ')} @${g.lab.fs}px, art ${g.art.h.toFixed(0)} of ${b.h.toFixed(0)}`);
      // the 3D still: atom spheres (radius 0.27 vdw, as rxview.js) in the
      // orthographic frame of the art box
      const ks = m.key + '|' + g.art.w.toFixed(1) + 'x' + g.art.h.toFixed(1);
      if (!stillCache.has(ks)) {
        const M = decode(m.rec), pos = T.principal3(M.xyz, M.N), rad = Array.from(M.z, z => 0.27 * el(z).vdw);
        const fr = T.frameBox(pos, rad, g.art.w / g.art.h);
        stillCache.set(ks, [Math.max(fr.fillX, fr.fillY), fr.atMin]);
      }
      const [f, small] = stillCache.get(ks);
      if (!small) { stillLo = Math.min(stillLo, f); stillHi = Math.max(stillHi, f); } else nSmall++;
      if (small ? f > 0.95 : (f < 0.85 || f > 0.95)) badStill.push(`${name} ${m.name} ${f.toFixed(2)}`);
      // the 2D drawing: strokes and fill
      const ka = m.key + '|' + g.art.w.toFixed(1) + 'x' + g.art.h.toFixed(1);
      if (!artCache.has(ka)) {
        const r = T.fitArt2D(m.rec, g.art.w, g.art.h), heavy = (m.rec.a || '').split(' ').filter(x => x && x !== 'H').length;
        const pad = 0.45 * 30, used = Math.max((r.box.w - 2 * pad) * r.s / g.art.w, (r.box.h - 2 * pad) * r.s / g.art.h);
        artCache.set(ka, { used, px: r.strokePx, heavy });
      }
      const a = artCache.get(ka);
      strokeLo = Math.min(strokeLo, a.px);
      if (a.heavy >= 12) artLo = Math.min(artLo, a.used);
      if (a.px < 1.2 || (a.heavy >= 12 && a.used < 0.7)) badArt.push(`${name} ${m.name} fill ${a.used.toFixed(2)} stroke ${a.px.toFixed(2)}px`);
    }
    // chips: placed, then checked against every card and every other chip
    const steps = S.steps.map(s => ({ out: s.out, ins: s.ins })), sz = S.steps.map(s => size(s.st.tex));
    const P = T.placeChips(L0, steps, k => sz[k]);
    spreadHi = Math.max(spreadHi, P.lay.spread || 1);
    const cards = P.lay.ids.map(id => P.lay.fish[id]);
    const at = P.at.filter(Boolean);
    nChip += at.length;
    if (at.length !== S.steps.filter(s => L0.fish[s.out]).length) badChip.push(`${name}/${kind}: ${at.length} of ${S.steps.length} chips placed`);
    at.forEach((r, i) => {
      for (const c of cards) if (T.overlapArea(r, c) > 0) badChip.push(`${name}/${kind}: chip ${i} on a card`);
      for (let j = i + 1; j < at.length; j++) if (T.overlapArea(r, at[j]) > 0) badChip.push(`${name}/${kind}: chips ${i} and ${j} overlap`);
      if (r.x < 0 || r.y < 0 || r.x + r.w > P.lay.w || r.y + r.h > P.lay.h) badChip.push(`${name}/${kind}: chip ${i} out of the layout box`);
    });
    // cards must still not overlap after a spread
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (T.overlapArea(cards[i], cards[j]) > 0) badChip.push(`${name}/${kind}: cards overlap after the spread`);
  }
  ok(!badName.length, 'tree fit: every card name fits its card (width model of STIX Two Text, at most 2 lines)', badName.length ? badName.slice(0, 3).join('; ') : `${nCards} cards in ${trees.length} trees x 3 layouts`);
  ok(!badStill.length, 'tree fit: every 3D still fills 85-95% of its art box on its longer side (small molecules: the minimum frame)', badStill.length ? badStill.slice(0, 3).join('; ') : `fill ${stillLo.toFixed(2)}-${stillHi.toFixed(2)}, ${nSmall} small-molecule cards at the minimum frame`);
  ok(!badArt.length, 'tree fit: 2D drawings fill their art box (>= 70% for 12+ heavy atoms; small ones keep the minimum box), strokes >= 1.2 px', badArt.length ? badArt.slice(0, 3).join('; ') : `fill >= ${artLo.toFixed(2)}, stroke >= ${strokeLo.toFixed(2)} px`);
  ok(!badChip.length, `tree fit: no chip on a card or on another chip, all layouts (${VB && VB.size ? 'MathJax sizes' : 'guessed sizes'})`, badChip.length ? badChip.slice(0, 3).join('; ') : `${nChip} chips, spread at most x${spreadHi.toFixed(2)}`);
}

if (!process.env.RX_MORE4) finish();
