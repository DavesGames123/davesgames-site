// ============================================================================
//  TENSOR CALCULUS  ·  tests/learn.test.mjs  ·  the guided chapters  (LEARN)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/tensor-calculus/tests/learn.test.mjs
//  NODE_PATH may point at a folder with mathjax-full@3.2.2 and jsdom@24.1.3.
//  Without them the MathJax and DOM sections print SKIP.
//
//  SECTIONS   (grep -n "^section(" learn.test.mjs)
//      chapters ... ten chapters load, beat schema, text present
//      names ...... every scene, entry, step, layout, style and widget a
//                   beat names is in the contract lists (refs.js), and in
//                   viz/registry.js and library/index.js when they exist
//      drive ...... every beat drives a stub tensorPage with known methods
//      links ...... #learn/<chapter>/<beat> parses and round-trips
//      widgets .... widget maths against closed forms and MATH
//      tex ........ every TeX string of every beat typesets in MathJax 3.2.2
//      dom ........ jsdom: the panel walks every beat and mounts each widget
// ============================================================================
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
let pass = 0, fail = 0;
const ok = (c, name, info = '') => {
  if (c) pass++; else fail++;
  console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
};
const section = name => console.log(`--- ${name}`);
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const L = await import('../learn/index.js');
const R = await import('../learn/refs.js');
const D = await import('../learn/drive.js');
const T = await import('../learn/tex.js');
const W = await import('../learn/widgets/math.js');
const { createStubPage, STUB_METHODS } = await import('../learn/stub.js');
const MATH = await import('../tensor/index.js').catch(() => null);
const VIZ = existsSync(join(root, 'viz/registry.js')) ? await import('../viz/registry.js').catch(() => null) : null;
const LIB = existsSync(join(root, 'library/index.js')) ? await import('../library/index.js').catch(e => { console.log('note: library/index.js failed to load: ' + e.message); return null; }) : null;
const libEntries = LIB ? (LIB.ENTRIES || LIB.LIBRARY || LIB.entries || []) : [];
const libIds = (Array.isArray(libEntries) ? libEntries : Object.values(libEntries)).map(e => e.id);

const beats = [];
for (const ch of L.CHAPTERS) ch.beats.forEach((b, i) => beats.push({ ch, b, i, name: `${ch.id}/${i + 1}` }));

// ---------------------------------------------------------------- chapters
section('chapters');
const WANT = ['tensor', 'indices', 'summation', 'metric', 'product', 'transform', 'symmetry', 'covariant', 'curvature', 'notation'];
ok(L.CHAPTERS.length === 10 && L.CHAPTERS.every((c, i) => c.id === WANT[i]), 'ten chapters in contract order', L.CHAPTERS.map(c => c.id).join(' '));
ok(L.CHAPTERS.every(c => c.title && c.blurb && c.beats.length >= 6), 'every chapter has a title, a blurb and 6 or more beats', L.CHAPTERS.map(c => c.beats.length).join(' '));
ok(L.beatCount() === beats.length, 'beatCount', String(beats.length));
const BEAT_KEYS = new Set(['title', 'text', 'tex', 'show', 'widget', 'deeper']);
const SHOW_KEYS = new Set(['view', 'style', 'entry', 'scene', 'params', 'expr', 'step', 'pick']);
const badKeys = beats.filter(x => Object.keys(x.b).some(k => !BEAT_KEYS.has(k)) || (x.b.show && Object.keys(x.b.show).some(k => !SHOW_KEYS.has(k))));
ok(!badKeys.length, 'beat and show keys follow the schema', badKeys.map(x => x.name).join(', '));
ok(beats.every(x => x.b.title && (Array.isArray(x.b.text) ? x.b.text.length : x.b.text)), 'every beat has a title and text');
ok(beats.every(x => x.b.show && Object.keys(x.b.show).length), 'every beat drives the page (has show)');
ok(beats.every(x => x.b.tex), 'every beat has a display equation');
const titles = beats.map(x => x.ch.id + ':' + x.b.title);
ok(new Set(titles).size === titles.length, 'beat titles are unique in each chapter');
const words = beats.reduce((s, x) => s + [].concat(x.b.text).join(' ').split(/\s+/).length, 0);
ok(words > 4000, 'the chapters have real text', `${words} words`);
ok(beats.filter(x => x.b.deeper).length >= 10, 'one deeper aside per chapter at least', String(beats.filter(x => x.b.deeper).length));
ok(L.CHAPTERS.every(c => c.beats.some(b => b.deeper)), 'every chapter has a deeper aside');
const nWidgets = beats.filter(x => x.b.widget).length;
ok(nWidgets >= 15, 'inline widgets', String(nWidgets));

// ---------------------------------------------------------------- names
section('names');
const shows = beats.filter(x => x.b.show).map(x => ({ ...x, s: x.b.show }));
const vizIds = VIZ ? [...VIZ.SCENE_IDS] : null;
ok(shows.every(x => !x.s.view || R.LAYOUTS.includes(x.s.view)), 'views are contract layouts');
ok(shows.every(x => !x.s.style || R.STYLES.includes(x.s.style)), 'diagram styles are penrose, birdtrack or network');
const badScene = shows.filter(x => x.s.scene && !R.SCENES.includes(x.s.scene));
ok(!badScene.length, 'scenes are in the contract scene list', badScene.map(x => x.name + ':' + x.s.scene).join(', '));
if (vizIds) {
  const miss = shows.filter(x => x.s.scene && !vizIds.includes(R.resolveScene(x.s.scene, vizIds)));
  ok(!miss.length, 'scenes exist in viz/registry.js SCENE_IDS', miss.map(x => x.name + ':' + x.s.scene).join(', ') || `${vizIds.length} VIZ scenes`);
  ok(R.SCENES.every(id => vizIds.includes(id)), 'refs.js SCENES match VIZ', R.SCENES.filter(id => !vizIds.includes(id)).join(', '));
  let checked = 0, unk = [];
  for (const x of shows.filter(y => y.s.scene && y.s.params)) {
    const info = VIZ.sceneInfo(R.resolveScene(x.s.scene, vizIds));
    if (!info || !info.params.length) continue;
    checked++;
    const keys = info.params.map(p => p.key);
    for (const k of Object.keys(x.s.params)) if (!keys.includes(k)) unk.push(`${x.name}:${x.s.scene}.${k}`);
  }
  ok(!unk.length, 'scene params are VIZ params where VIZ lists them', unk.join(', ') || `${checked} beats checked`);
} else console.log('SKIP  viz/registry.js not on disk');
const badEntry = shows.filter(x => x.s.entry && !R.ENTRIES.includes(x.s.entry));
ok(!badEntry.length, 'entries are in the refs.js entry list', badEntry.map(x => x.name + ':' + x.s.entry).join(', '));
if (LIB && libIds.length) {
  const miss = shows.filter(x => x.s.entry && !R.resolveEntry(x.s.entry, libIds));
  const used = new Set(shows.filter(x => x.s.entry).map(x => x.s.entry));
  ok(used.size - new Set(miss.map(x => x.s.entry)).size >= 15, 'entries exist in library/index.js', `${used.size - new Set(miss.map(x => x.s.entry)).size} of ${used.size} entry ids, ${libIds.length} entries in the library`);
  if (miss.length) console.log(`PEND  ${new Set(miss.map(x => x.s.entry)).size} contract entries not in the library yet (beats fall back to their TeX): ${[...new Set(miss.map(x => x.s.entry))].join(', ')}`);
} else console.log('SKIP  library/index.js not on disk or empty: entries checked against refs.js only');
const badStep = shows.filter(x => x.s.step && !R.STEP_KINDS.includes(x.s.step));
ok(!badStep.length, 'steps are OpTrace Step kinds', badStep.map(x => x.name + ':' + x.s.step).join(', '));
ok(shows.every(x => !x.s.step || x.s.entry || x.s.expr), 'a step with no entry has an expr to trace');
if (LIB && libIds.length) {
  const noKind = [];
  for (const x of shows.filter(y => y.s.entry && y.s.step)) {
    const id = R.resolveEntry(x.s.entry, libIds);
    if (!id) continue;
    const tr = D.entryTrace(LIB, id);
    if (!tr || D.stepIndexOf(tr, x.s.step) < 0) noKind.push(`${x.name}:${x.s.entry}.${x.s.step}`);
  }
  ok(!noKind.length, 'each entry trace has the step kind its beat asks for', noKind.join(', '));
}
const wt = beats.filter(x => x.b.widget).map(x => x.b.widget.type);
ok(wt.every(t => R.WIDGETS.includes(t)), 'widget types are known', [...new Set(wt)].join(' '));
ok(R.WIDGETS.every(t => wt.includes(t)), 'every widget type is used in a chapter');
const picks = shows.filter(x => x.s.pick);
ok(picks.every(x => T.indexSyms(x.s.expr || x.b.tex).includes(x.s.pick)), 'a picked index appears in the beat expression', picks.map(x => x.s.pick).join(' '));

// ---------------------------------------------------------------- drive
section('drive');
{
  const page = createStubPage();
  let nCalls = 0, unknown = [];
  for (const x of shows) {
    page.calls.length = 0;
    await D.driveBeat(page, x.s, { lib: LIB, math: MATH, fallbackExpr: x.b.tex, resolveScene: id => R.resolveScene(id, vizIds), resolveEntry: id => R.resolveEntry(id, libIds) });
    nCalls += page.calls.length;
    for (const [m, ...a] of page.calls) {
      if (!STUB_METHODS.includes(m)) unknown.push(m);
      if (m === 'setScene' && !(vizIds || R.SCENES).includes(a[0])) unknown.push('scene ' + a[0]);
      if (m === 'openEntry' && !(libIds.length ? libIds : R.ENTRIES).includes(a[0])) unknown.push('entry ' + a[0]);
      if (m === 'showExpr' && typeof a[0] !== 'string') unknown.push('showExpr ' + a[0]);
      if (m === 'setView' && !(typeof a[0] === 'string' ? R.LAYOUTS.includes(a[0]) : a[0].views.every(v => ['tex', 'viz', 'diagram'].includes(v)))) unknown.push('view');
    }
    if (!page.calls.length || page.calls[page.calls.length - 1][0] !== 'pickIndex') unknown.push(x.name + ' no pickIndex');
  }
  ok(!unknown.length, 'every beat calls only tensorPage methods with known names', unknown.slice(0, 6).join(', ') || `${nCalls} calls over ${shows.length} beats`);
  const order = D.planBeat({ view: 'all', style: 'penrose', entry: 'kronecker-delta', scene: 'dual-basis', params: { shear: 0.2 }, step: 'contract', pick: 'i' }, {}).map(c => c[0]).join(' ');
  ok(order === 'setView openEntry setScene seek resume pickIndex', 'call order: view, entry, scene, step, pick', order);
  ok(JSON.stringify(D.viewSpec({ view: 'diagram', style: 'network' })) === '{"views":["diagram"],"style":"network"}', 'viewSpec with a style');
  ok(D.viewSpec({ view: 'tex' }) === 'tex' && D.viewSpec({}) === 'all', 'viewSpec plain layouts');
  const tr = { steps: [{ kind: 'product' }, { kind: 'contract' }] };
  ok(D.stepIndexOf(tr, 'contract') === 1 && D.stepIndexOf(tr, 'raise') === -1, 'stepIndexOf');
  if (MATH && MATH.traceEinstein) {
    const solo = shows.filter(x => x.s.step && !x.s.entry);
    const got = solo.map(x => D.planBeat(x.s, { math: MATH }).some(c => c[0] === 'playTrace'));
    ok(got.filter(Boolean).length > 0, 'beats with a step and no entry build a MATH trace', `${got.filter(Boolean).length} of ${solo.length}`);
  }
}

// ---------------------------------------------------------------- links
section('links');
{
  const p = L.parseLearnHash('#learn/indices/3');
  ok(p && p.chapter === 'indices' && p.beat === 2, '#learn/indices/3 -> indices, beat index 2');
  ok(L.parseLearnHash('#learn/indices').beat === 0, '#learn/indices -> first beat');
  ok(L.parseLearnHash('#learn').chapter === 'tensor', '#learn -> first chapter');
  ok(L.parseLearnHash('#learn/indices/99').beat === L.chapterById('indices').beats.length - 1, 'a beat past the end clamps to the last beat');
  ok(L.parseLearnHash('#learn/nope/1') === null && L.parseLearnHash('#entry/x') === null && L.parseLearnHash('') === null, 'unknown chapter and other hashes give null');
  ok(L.parseLearnHash('learn/curvature/2/').chapter === 'curvature', 'no # and a trailing slash');
  ok(beats.every(x => { const q = L.parseLearnHash(L.learnHash(x.ch.id, x.i)); return q.chapter === x.ch.id && q.beat === x.i; }), 'learnHash round-trips every beat', `${beats.length} links`);
}

// ---------------------------------------------------------------- widgets
section('widgets');
{
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  const randA = n => { for (;;) { const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1.5 : 0) + rnd())); if (Math.abs(W.det(A)) > 0.3) return A; } };
  // components under a basis change, against MATH.transform (J = A^-1)
  if (MATH && MATH.transform && MATH.Tensor) {
    let worst = 0, cases = 0;
    for (const variance of [['u'], ['d'], ['u', 'd'], ['d', 'd'], ['u', 'u'], ['u', 'd', 'd'], ['d', 'u', 'd']]) for (const n of [2, 3]) {
      const A = randA(n), J = W.inv(A);
      const shape = variance.map(() => n), size = n ** variance.length;
      const data = Array.from({ length: size }, rnd);
      const mine = W.transformComponents({ shape, variance, data: Float64Array.from(data) }, A);
      const theirs = MATH.transform(new MATH.Tensor(shape, variance, data), J);
      for (let k = 0; k < size; k++) worst = Math.max(worst, Math.abs(mine.data[k] - theirs.data[k]));
      cases++;
    }
    ok(worst < 1e-10, 'widget transformComponents(T, A) = MATH.transform(T, A^-1)', `${cases} cases, max diff ${worst.toExponential(1)}`);
  } else console.log('SKIP  MATH.transform not available');
  // the basis-drag widget: components from the dragged basis
  {
    let worst = 0;
    for (let k = 0; k < 50; k++) {
      const E = randA(2), v = [rnd(), rnd()], w = [rnd(), rnd()];
      const c = W.basisComponents(E, v, w);
      // v^i e_i rebuilds v; w_i = w(e_i); the pairing is the Cartesian w.v
      const back = [E[0][0] * c.up[0] + E[0][1] * c.up[1], E[1][0] * c.up[0] + E[1][1] * c.up[1]];
      worst = Math.max(worst, Math.abs(back[0] - v[0]), Math.abs(back[1] - v[1]), Math.abs(c.pairing - c.cartesianPairing));
      if (MATH && MATH.transform) {
        // new basis E from the standard one: v'^i = (E^-1 v)^i, w'_i = (w E)_i
        const tv = MATH.transform(new MATH.Tensor([2], ['u'], v), W.inv(E)), tw = MATH.transform(new MATH.Tensor([2], ['d'], w), W.inv(E));
        worst = Math.max(worst, Math.abs(tv.data[0] - c.up[0]), Math.abs(tv.data[1] - c.up[1]), Math.abs(tw.data[0] - c.down[0]), Math.abs(tw.data[1] - c.down[1]));
      }
      // dual basis: e^i(e_j) = delta
      const dd = W.matmul(c.dual, E);
      worst = Math.max(worst, Math.abs(dd[0][0] - 1), Math.abs(dd[1][1] - 1), Math.abs(dd[0][1]), Math.abs(dd[1][0]));
    }
    ok(worst < 1e-10, 'basis-drag: v^i e_i = v, w_i v^i invariant, dual basis, and MATH.transform agree', `max diff ${worst.toExponential(1)}`);
  }
  {
    const c = W.stretchComponents(2.5, [1, 2], [3, 4]);
    ok(close(c.up[0], 2.5) && close(c.down[1], 1.6) && close(c.up[0] * c.down[0] + c.up[1] * c.down[1], 11), 'stretch: v grows by s, w shrinks by s, w(v) stays');
    if (MATH && MATH.transform) {
      const J = [[2.5, 0], [0, 2.5]];
      const tv = MATH.transform(new MATH.Tensor([2], ['u'], [1, 2]), J), tw = MATH.transform(new MATH.Tensor([2], ['d'], [3, 4]), J);
      ok(close(tv.data[1], c.up[1]) && close(tw.data[0], c.down[0]), 'stretch matches MATH.transform with J = s I');
    }
  }
  {
    let worst = 0;
    for (const T2 of [[[2, 0.6], [0.6, 1]], [[1.6, -0.5], [-0.5, 0.7]]]) for (const a of [0.3, 1.1, -2]) {
      const Tp = W.rotateRank2(T2, a);
      worst = Math.max(worst, Math.abs(Tp[0][0] + Tp[1][1] - T2[0][0] - T2[1][1]), Math.abs(W.det(Tp) - W.det(T2)));
      if (MATH && MATH.transform) {
        // a frame rotated by a: A = R(a), J = R(-a); lower slots take A
        const t = MATH.transform(new MATH.Tensor([2, 2], ['d', 'd'], T2.flat()), W.rotation2(-a));
        worst = Math.max(worst, ...[0, 1, 2, 3].map(k => Math.abs(t.data[k] - Tp.flat()[k])));
      }
    }
    ok(worst < 1e-10, 'rotate-rank2: trace and det fixed, components match MATH.transform', `max diff ${worst.toExponential(1)}`);
  }
  {
    const G = [[2, 0.5], [0.5, 1]], v = [1, -2];
    const low = W.lowerIndex(G, v), up = W.raiseIndex(W.inv(G), low);
    ok(close(up[0], 1) && close(up[1], -2) && close(W.metricLength(G, v) ** 2, low[0] * v[0] + low[1] * v[1]), 'raise-lower: g^ij g_jk v^k = v^i and |v|^2 = v_i v^i');
    if (MATH && MATH.lower && MATH.Tensor) {
      try {
        const t = MATH.lower(new MATH.Tensor([2], ['u'], v), 0, new MATH.Tensor([2, 2], ['d', 'd'], G.flat()));
        ok(close(t.data[0], low[0]) && close(t.data[1], low[1]), 'raise-lower matches MATH.lower');
      } catch (e) { console.log('SKIP  MATH.lower signature: ' + e.message); }
    }
  }
  {
    let all = true, rows = [];
    for (const kind of W.COUNT_KINDS) for (const n of [1, 2, 3, 4]) for (const r of kind === 'riemann' ? [4] : [1, 2, 3, 4]) {
      if (n ** r > 256) continue;
      const a = W.countComponents(n, r, kind), b = W.bruteCount(n, r, kind);
      if (a !== b) { all = false; rows.push(`${kind} n${n} r${r}: ${a} vs ${b}`); }
    }
    ok(all, 'count: formulas equal the rank of the symmetry equations', rows.join('; ') || 'general, symmetric, antisymmetric, riemann up to 256 components');
    ok(W.countComponents(4, 4, 'riemann') === 20 && W.countComponents(3, 4, 'riemann') === 6 && W.countComponents(2, 4, 'riemann') === 1, 'Riemann: 1, 6, 20 in 2, 3, 4 dimensions');
    ok(W.countComponents(4, 2, 'antisymmetric') === 6 && W.countComponents(3, 2, 'symmetric') === 6, 'F has 6 components, stress has 6');
  }
  {
    let worst = 0;
    for (const r of [0.5, 1.5, 3]) {
      const G = W.polarChristoffel(r), N = W.christoffelNumeric(x => [[1, 0], [0, x[0] * x[0]]], [r, 0.4]);
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) worst = Math.max(worst, Math.abs(G[a][b][c] - N[a][b][c]));
      if (MATH && MATH.christoffel && MATH.getMetric) {
        const M = MATH.christoffel(MATH.getMetric('polar'), [r, 0.4]);
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) worst = Math.max(worst, Math.abs(G[a][b][c] - M.get(a, b, c)));
      }
    }
    ok(worst < 1e-6, 'christoffel-polar: closed form = finite differences = MATH.christoffel', `max diff ${worst.toExponential(1)}`);
    // sphere: Gamma^theta_{phi phi} = -sin cos, Gamma^phi_{theta phi} = cot
    const S = W.christoffelNumeric(x => [[1, 0], [0, Math.sin(x[0]) ** 2]], [0.8, 0.1]);
    ok(close(S[0][1][1], -Math.sin(0.8) * Math.cos(0.8), 1e-7) && close(S[1][0][1], Math.cos(0.8) / Math.sin(0.8), 1e-7), 'christoffelNumeric on the unit sphere');
  }
  {
    let worst = 0;
    for (const th of [0.2, 0.7, 1.2, Math.PI / 2, 2.3]) {
      const a = W.holonomyAngle(th) % (2 * Math.PI), b = W.transportLatitude(th, 3000);
      const d = Math.abs(a - b); worst = Math.max(worst, Math.min(d, 2 * Math.PI - d));
    }
    ok(worst < 1e-8, 'holonomy: RK4 transport = 2 pi (1 - cos theta)', `max diff ${worst.toExponential(1)}`);
    ok(close(W.holonomyAngle(Math.PI / 2), 2 * Math.PI) && close(W.holonomyAngle(Math.PI / 3), Math.PI), 'holonomy closed form: equator 2 pi, 60 deg cap pi');
  }
  {
    const WI = await import('../learn/widgets/index.js');
    const bad = [];
    for (const x of beats.filter(y => y.b.widget && y.b.widget.type === 'quiz')) for (const it of x.b.widget.items) {
      const a = WI.quizAnswer(it.src);
      const want = it.free == null ? null : [...it.free].sort().join(',');
      const got = a.free == null ? null : [...a.free].sort().join(',');
      if (want !== got) bad.push(`${x.name} ${it.src}: authored ${want}, rule ${got}`);
    }
    ok(!bad.length, 'quiz: every authored answer equals the summation rule', bad.join('; ') || 'all items');
    const f = W.parseFactors(String.raw`T^{ij} S_{jk} u^{k}`);
    const r = W.expandEinstein(f, 3);
    ok(r.free.join() === 'i' && r.dummy.join() === 'j,k' && r.lines.length === 3 && r.termsPerLine === 9 && r.count === 27, 'sum-expand: T^ij S_jk u^k in 3D is 3 lines of 9 terms');
    const d = W.expandEinstein(W.parseFactors(String.raw`\delta^{i}{}_{j} v^{j}`), 3, { values: WI.VALUE_PRESETS.delta });
    ok(d.lines.map(l => l.value).join() === '3,1,4', 'sum-expand: delta^i_j v^j = v^i numerically');
    const m = W.expandEinstein(W.parseFactors(String.raw`A^{i}{}_{j} B^{j}{}_{l}`), 2, { values: { A: (i, j) => [[1, 2], [3, 4]][i][j], B: (i, j) => [[5, 6], [7, 8]][i][j] } });
    ok(m.lines.map(l => l.value).join() === '19,22,43,50', 'sum-expand: A^i_j B^j_l is the matrix product');
    if (MATH && MATH.einsum) {
      try {
        const e = MATH.einsum('ij,jk->ik', new MATH.Tensor([2, 2], ['u', 'd'], [1, 2, 3, 4]), new MATH.Tensor([2, 2], ['u', 'd'], [5, 6, 7, 8]));
        ok(Array.from(e.data).join() === '19,22,43,50', 'sum-expand agrees with MATH.einsum');
      } catch (err) { console.log('SKIP  MATH.einsum: ' + err.message); }
    }
    const errs = W.classifyTerm(W.parseFactors(String.raw`T^{a}{}_{b} u^{b} w^{b}`));
    ok(errs.errors.length === 1 && errs.errors[0].sym === 'b', 'classifyTerm: an index three times is an error');
  }
}

// ---------------------------------------------------------------- tex
section('tex');
const texItems = [];
for (const x of beats) for (const t of L.beatTex(x.b)) texItems.push({ name: `${x.name} ${t.where}`, tex: t.colored, raw: t.tex, display: t.display });
{
  const WI = await import('../learn/widgets/index.js');
  const cls = s => 'i' + (s.length % 8);
  for (const x of beats.filter(y => y.b.widget && y.b.widget.type === 'sum-expand')) for (const n of [2, 3, 4]) {
    const r = W.expandEinstein(W.parseFactors(x.b.widget.src), n, { classOf: cls, values: x.b.widget.values ? WI.VALUE_PRESETS[x.b.widget.values] : null });
    texItems.push({ name: `${x.name} sum-expand n=${n}`, tex: T.colorIndices(WI.expandTex(r, {}), cls), display: true });
  }
  for (const [k, f] of Object.entries(WI.NOTATION_FORMS)) texItems.push({ name: 'notation ' + k, tex: T.colorIndices(f.tex, cls), display: true });
}
const bal = s => { let d = 0; for (const ch of s.replace(/\\\\/g, ' ').replace(/\\[{}]/g, '')) { if (ch === '{') d++; else if (ch === '}' && --d < 0) return false; } return d === 0; };
ok(texItems.every(x => bal(x.tex)), 'braces balance in every TeX string', texItems.filter(x => !bal(x.tex)).slice(0, 3).map(x => x.name + ': ' + x.tex).join('; ') || `${texItems.length} strings`);
const noCol = beats.filter(x => T.indexSyms(x.b.tex).length && !T.colorIndices(x.b.tex, () => 'i0').includes('\\class{i0}'));
ok(!noCol.length, 'every display equation with index letters gets index colours', `${beats.filter(x => T.indexSyms(x.b.tex).length).length} equations with indices`);
ok(T.colorIndices(String.raw`r_{\mathrm{s}} + \sum_{i=1}^{n} x^{i}`, () => 'iX') === String.raw`r_{\mathrm{s}} + \sum_{{\class{iX}{i}}=1}^{n} x^{{\class{iX}{i}}}`, 'labels, sum limits and indices colour as documented');
ok(T.indexSyms(String.raw`R^{\rho}{}_{\sigma\mu\nu}\,\Gamma^\lambda_{\mu\nu}`).join() === 'rho,sigma,mu,nu,lambda', 'indexSyms in order of first use');
let MJ = null;
try {
  const req = createRequire((process.env.NODE_PATH || '/nonexistent').split(':')[0] + '/');
  const { mathjax } = req('mathjax-full/js/mathjax.js'), { TeX } = req('mathjax-full/js/input/tex.js');
  req('mathjax-full/js/input/tex/AllPackages.js');
  const { SVG } = req('mathjax-full/js/output/svg.js'), { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js'), { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
  const ad = liteAdaptor(); RegisterHTMLHandler(ad);
  // The same packages as lib/sci-math.js: base, ams (autoload), html, color.
  const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html', 'color', 'newcommand', 'noundefined'] }), OutputJax: new SVG({ fontCache: 'none' }) });
  MJ = (t, display) => { const node = doc.convert(t, { display }); const s = ad.outerHTML(node); return /data-mjx-error|merror|fill="red"/.test(s) ? (s.match(/data-mjx-error="([^"]*)"/)?.[1] || 'error') : null; };
} catch (e) { MJ = null; }
if (MJ) {
  const bad = texItems.map(x => [x.name, MJ(x.tex, x.display)]).filter(x => x[1]);
  ok(!bad.length, 'MathJax 3.2.2 typesets every TeX string with index colours', bad.length ? bad.slice(0, 5).map(b => b[0] + ': ' + b[1]).join('; ') : `${texItems.length} strings`);
} else console.log('SKIP  MathJax typeset: mathjax-full not on NODE_PATH');

// ---------------------------------------------------------------- dom
section('dom');
let JSDOM = null;
try { JSDOM = createRequire((process.env.NODE_PATH || '/nonexistent').split(':')[0] + '/')('jsdom').JSDOM; } catch { JSDOM = null; }
if (JSDOM) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="h"></div></body></html>', { url: 'https://example.test/stella-nova/pages/tensor-calculus/#learn/indices/3', pretendToBeVisual: true });
  const g = globalThis;
  for (const k of ['window', 'document', 'location', 'history', 'HTMLElement', 'Node', 'CustomEvent', 'requestAnimationFrame']) { try { g[k] = dom.window[k]; } catch {} }
  g.requestAnimationFrame = f => setTimeout(f, 0);
  const page = createStubPage();
  const typed = [];
  const typeset = async (el, tex) => { typed.push(tex); el.textContent = tex; return true; };
  const errors = [];
  dom.window.addEventListener('error', e => errors.push(e.message));
  const view = L.createLearn(document.getElementById('h'), { page, typeset, lib: LIB, math: MATH, sceneIds: vizIds, entryIds: libIds });
  await view.ready;
  ok(view.state().chapter === 'indices' && view.state().beat === 2, 'the panel opens at the deep link #learn/indices/3');
  ok(document.querySelector('.learn-title').textContent === L.chapterById('indices').beats[2].title, 'the beat title is on screen');
  ok(document.querySelectorAll('.learn-dot').length === L.chapterById('indices').beats.length && document.querySelectorAll('.learn-chdot').length === 10, 'progress dots for the beats and the chapters');
  await view.go('tensor', 0);
  let steps = 0, widgetFail = [], mounted = 0;
  for (;;) {
    const st = view.state();
    const b = L.chapterById(st.chapter).beats[st.beat];
    if (b.widget) { if (document.querySelector('.lw')) mounted++; else widgetFail.push(st.chapter + '/' + (st.beat + 1)); }
    if (document.querySelector('.learn-err')) widgetFail.push(st.chapter + '/' + (st.beat + 1) + ' ' + document.querySelector('.learn-err').textContent);
    steps++;
    if (st.chapter === 'notation' && st.beat === L.chapterById('notation').beats.length - 1) break;
    if (steps > 500) break;
    await view.next();
  }
  ok(steps === beats.length, 'Next walks every beat of every chapter in order', `${steps} beats`);
  ok(!widgetFail.length && mounted === nWidgets, 'every widget mounts in jsdom with no error', widgetFail.join(', ') || `${mounted} widgets`);
  ok(location.hash === '#learn/notation/' + L.chapterById('notation').beats.length, 'the hash follows the panel', location.hash);
  await view.back();
  ok(view.state().beat === L.chapterById('notation').beats.length - 2, 'Back goes one beat back');
  await view.go('symmetry', 0); await view.back();
  ok(view.state().chapter === 'transform' && view.state().beat === L.chapterById('transform').beats.length - 1, 'Back from a first beat goes to the last beat of the chapter before');
  const methods = new Set(page.calls.map(c => c[0]));
  ok([...methods].every(m => STUB_METHODS.includes(m)) && methods.has('setScene') && methods.has('openEntry') && methods.has('pickIndex'), 'the panel drove the stub page', [...methods].join(' '));
  // widgets: interact
  await view.go('symmetry', 2);
  const sel = document.querySelectorAll('.lw-count select, .lw-row select');
  const kindSel = [...document.querySelectorAll('.lw-row select')].find(s => s.getAttribute('aria-label') === 'symmetry');
  kindSel.value = 'riemann'; kindSel.dispatchEvent(new dom.window.Event('change'));
  const nSel = [...document.querySelectorAll('.lw-row select')].find(s => s.getAttribute('aria-label') === 'n');
  nSel.value = '4'; nSel.dispatchEvent(new dom.window.Event('change'));
  ok(/^20 independent of 256/.test(document.querySelector('.lw-count').textContent), 'count widget: Riemann in 4D reads 20 of 256', document.querySelector('.lw-count').textContent);
  await view.go('indices', 5);
  const li = document.querySelector('.lw-quiz li');
  [...li.querySelectorAll('.lw-chip')].find(b => b.textContent === 'i').click();
  li.querySelector('.lw-check').click();
  ok(li.classList.contains('right'), 'quiz widget: marking i in A^i_j v^j is right', li.querySelector('.lw-fb').textContent);
  await view.go('curvature', 1);
  const rng = document.querySelector('.lw-w-holonomy input[type=range]');
  rng.value = String(Math.PI / 3); rng.dispatchEvent(new dom.window.Event('input'));
  await new Promise(r => setTimeout(r, 20));
  ok(/180\.0°/.test(document.querySelector('.lw-w-holonomy .lw-read').textContent), 'holonomy widget: 60 degree cap turns 180 degrees');
  ok(page.calls.some(c => c[0] === 'setScene' && c[1] === 'parallel-transport' && c[2].path === 'latitude' && close(c[2].th0, Math.PI / 3, 1e-6)), 'holonomy widget sends its parameter to the 3D scene');
  ok(typed.length > 100 && typed.every(t => bal(t)) && typed.some(t => t.includes('\\class{i')), 'the panel typeset coloured TeX', typed.filter(t => !bal(t)).slice(0, 2).join(' ; ') || `${typed.length} calls`);
  ok(!errors.length, 'no window errors', errors.join('; '));
  view.dispose();
  ok(!document.querySelector('.learn'), 'dispose removes the panel');
} else console.log('SKIP  DOM walk: jsdom not on NODE_PATH');

console.log(`${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
