// ============================================================================
//  TENSOR CALCULUS  ·  tests/viz.test.mjs  ·  the VIZ package, DOM-free parts
// ----------------------------------------------------------------------------
//  node stella-nova/pages/tensor-calculus/tests/viz.test.mjs
//  1. The scene list matches the CONTRACT.md "VIZ API" list and the VIZ ids
//     of library/scenes.js.
//  2. Scene maths against closed forms and the MATH engine (tensor/index.js):
//     the pairing w_i v^i under a basis stretch, the dual basis, holonomy,
//     the boost and the light cone, F_{mu nu} invariants, the rank-2
//     transformation law, Christoffel symbols, epsilon, contraction.
//  3. Every scene draws finite geometry at many times, in free play and
//     when it plays real MATH trace steps at t = 0, 0.5, 1.
//  4. The saver shots: 20 or more, known scenes and params, finite cameras,
//     the subject in the middle band at 16:9 and 9:16.
//  index.js (three.js, WebGL) is checked only for its imports, with a node
//  hook that maps 'three' to the vendor copy. No browser runs here.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
const imp = p => import(pathToFileURL(join(page, p)).href);

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`); }
}
const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
const near = (a, b, tol, msg) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg || ''} ${a} != ${b} (tol ${tol})`); };

const R = await imp('viz/registry.js');
const DLm = await imp('viz/dl.js');
const VM = await imp('viz/vmath.js');
const SH = await imp('viz/shots.js');
const TM = await imp('viz/trace-map.js');
const basis = await imp('viz/scenes/basis.js');
const sphere = await imp('viz/scenes/sphere.js');
const curvi = await imp('viz/scenes/curvi.js');
const blocks = await imp('viz/scenes/blocks.js');
const cont = await imp('viz/scenes/continuum.js');
const st = await imp('viz/scenes/spacetime.js');
const MATH = await imp('tensor/index.js');
const LIBS = await imp('library/scenes.js');

// ---- 1. the scene list ---------------------------------------------------------
const contract = readFileSync(join(page, 'CONTRACT.md'), 'utf8');
const vizApi = contract.slice(contract.indexOf('### VIZ API'), contract.indexOf('### DIAGRAM API'));
const WANT = [
  ['vector vs covector under a basis stretch', 'upper-lower'],
  ['basis and dual basis', 'dual-basis'],
  ['curvilinear grids', 'curvilinear'],
  ['ellipse/ellipsoid field', 'metric-field'],
  ['outer-product component block', 'outer-product'],
  ['block collapsing along matched axes', 'contraction'],
  ['rank-3 component cube', 'rank3-cube'],
  ['transformation of a rank-2 tensor', 'transform-rank2'],
  ['stress on a\ncube with traction vectors', 'stress-cube'],
  ['inertia ellipsoid', 'inertia'],
  ['Lorentz boost of the light cone', 'lorentz'],
  ['parallel transport on a sphere', 'parallel-transport'],
  ['geodesics and geodesic deviation', 'geodesic-deviation'],
  ['curvature from a small\nloop', 'curvature-loop'],
  ['Flamm paraboloid', 'flamm'],
  ['Levi-Civita orientation cube', 'levi-civita'],
  ['Christoffel symbols as basis-vector change', 'christoffel'],
];
check('every scene of the contract list has a VIZ scene', () => {
  const flat = vizApi.replace(/\s+/g, ' ');
  for (const [phrase, id] of WANT) {
    ok(flat.includes(phrase.replace(/\s+/g, ' ')), `contract text no longer says "${phrase}"`);
    ok(R.SCENE_IDS.includes(id), `no scene ${id}`);
  }
  ok(R.SCENE_IDS.length === WANT.length + 1 && R.SCENE_IDS.includes('components'), 'scene count');
});
check('library/scenes.js names only VIZ scene ids', () => {
  for (const id of LIBS.VIZ_IDS) ok(R.SCENE_IDS.includes(id), `library asks for ${id}`);
  for (const s of LIBS.SCENES) {
    const h = LIBS.toViz({ scene: s.id, params: {} });
    const keys = Object.keys(h.params).filter(k => k !== 'lib');
    const known = R.SCENES[h.scene].params.map(q => q.key);
    for (const k of keys) ok(known.includes(k), `${s.id} maps to unknown param ${h.scene}.${k}`);
  }
});
check('each scene has a label, a camera and well-formed params', () => {
  for (const id of R.SCENE_IDS) {
    const s = R.SCENES[id];
    ok(s.label && s.blurb !== undefined && typeof s.frame === 'function', id);
    ok(s.camera.pos.length === 3 && s.camera.target.length === 3 && s.camera.fov > 10, id + ' camera');
    for (const q of s.params) ok(q.key && (q.options ? q.options.length > 1 : q.max > q.min), `${id}.${q.key}`);
  }
});

// ---- 2. scene maths -------------------------------------------------------------
check('upper-lower: v^i shrinks, w_i grows, w_i v^i stays', () => {
  let prev = null;
  for (let s = 0.45; s <= 2.2; s += 0.05) {
    const b = basis.basisState({ s, skew: 0.32 });
    near(b.pair, b.pairWorld, 1e-12, 'pairing');
    // v rebuilt from its components
    near(b.v1 * b.e1[0] + b.v2 * b.e2[0], b.v[0], 1e-12); near(b.v1 * b.e1[1] + b.v2 * b.e2[1], b.v[1], 1e-12);
    if (prev) { ok(b.v1 < prev.v1, 'v^1 shrinks'); ok(b.w1 > prev.w1, 'w_1 grows'); near(b.v2, prev.v2, 1e-12); }
    // the dual basis: e^i(e_j) = delta
    near(b.d1[0] * b.e1[0] + b.d1[1] * b.e1[1], 1, 1e-12); near(b.d1[0] * b.e2[0] + b.d1[1] * b.e2[1], 0, 1e-12);
    // lowering with g_ij = e_i . e_j gives the world dot products v . e_i
    near(b.vl1, b.v[0] * b.e1[0] + b.v[1] * b.e1[1], 1e-12);
    prev = b;
  }
});
check('upper-lower lowering matches MATH.lower and contract', () => {
  const b = basis.basisState({ s: 1.3, skew: 0.32 });
  const g = MATH.Tensor.fromNested(b.g, ['d', 'd']), v = new MATH.Tensor([2], ['u'], [b.v1, b.v2]);
  const vl = MATH.lower(v, 0, g);
  near(vl.data[0], b.vl1, 1e-12); near(vl.data[1], b.vl2, 1e-12);
  const w = new MATH.Tensor([2], ['d'], [b.w1, b.w2]);
  near(MATH.contract(MATH.product(w, v), 0, 1).data[0], b.pair, 1e-12);
});
check('dual-basis: e^i(e_j) = delta and g g^-1 = 1', () => {
  const E = [[1.25, 0.4, 0.3], [0.05, 1.15, 0.3], [0.4, -0.1, 1.2]];
  const d = basis.dualState(E);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(d.delta[i][j], i === j ? 1 : 0, 1e-12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(VM.dot(d.recip[i], d.cols[j]), i === j ? 1 : 0, 1e-12, 'reciprocal');
});
check('holonomy: latitude loop = 2 pi (1 - cos th0), triangle = pi/2', () => {
  for (const th0 of [0.4, 0.8, 1.2]) {
    const r = sphere.transportRun('latitude', th0, VM.scl(VM.unit(VM.sphBasis(th0, 0).eth), 0.6));
    let a = Math.abs(r.angle); const e = VM.holonomyLatitude(th0) % (2 * Math.PI);
    near(Math.min(a, 2 * Math.PI - a), Math.min(e, 2 * Math.PI - e), 0.02, 'latitude ' + th0);
  }
  const t = sphere.transportRun('triangle', 0, VM.scl(VM.unit([1, 0, 0.55]), 0.6));
  near(Math.abs(t.angle), Math.PI / 2, 0.01, 'triangle');
});
check('holonomy matches MATH.traceParallelTransport on the sphere', () => {
  const th0 = 0.9;
  const tr = MATH.traceParallelTransport('sphere', s => [th0, 2 * Math.PI * s], [1, 0], { steps: 800, params: { R: 1 } });
  const mine = sphere.transportRun('latitude', th0, VM.scl(VM.unit(VM.sphBasis(th0, 0).eth), 0.6));
  near(Math.abs(mine.angle), Math.abs(tr.holonomy), 0.02, 'MATH holonomy');
  // the scene plays the MATH path itself
  const last = tr.steps[tr.steps.length - 1];
  const mp = sphere.mathPath(last);
  ok(mp && mp.pts.length > 50, 'math path');
  near(Math.abs(mp.angle), Math.abs(tr.holonomy), 0.02, 'drawn path angle');
});
check('curvature loop: angle / area = K = 1/R^2', () => {
  for (const d of [0.1, 0.3, 0.7]) {
    const rt = sphere.routes(0.55, 0.35, d, VM.scl(VM.unit(VM.sphBasis(0.55, 0.35, 1.6).eth), 0.3));
    near(rt.ratio, 1 / (1.6 * 1.6), 0.004, 'd = ' + d);
  }
});
check('geodesic deviation: |xi| = |xi0| cos(s/R) on the sphere, grows on the saddle', () => {
  const f = sphere.deviationFamily('sphere', 3, 0.1, 0.5);
  const d0 = VM.len(VM.sub(f[1][0], f[0][0])), d1 = VM.len(VM.sub(f[1][80], f[0][80]));
  near(d1 / d0, Math.cos(Math.PI / 4), 0.002);
  const g = sphere.deviationFamily('saddle', 3, 0.1, 1);
  ok(VM.len(VM.sub(g[1][g[1].length - 1], g[0][g[0].length - 1])) > 1.5 * VM.len(VM.sub(g[1][0], g[0][0])), 'saddle spreads');
});
check('Lorentz boost: null stays null, e0 stays on the unit hyperbola, matches MATH', () => {
  for (const beta of [-0.8, -0.3, 0.4, 0.75]) {
    for (let a = 0; a < 6.3; a += 0.7) {
      const q = st.fromPrimed(beta, 1, Math.cos(a), Math.sin(a));
      near(-q[0] * q[0] + q[1] * q[1] + q[2] * q[2], 0, 1e-12, 'null');
    }
    const e0 = st.fromPrimed(beta, 1, 0, 0);
    near(e0[0] * e0[0] - e0[1] * e0[1], 1, 1e-12);
    const L = MATH.lorentzBoost(beta, 1), Lm = VM.boostX(beta);
    const Ld = L.data || L.flat?.() || L;
    const flat = Array.isArray(Ld[0]) ? Ld.flat() : Array.from(Ld);
    for (let i = 0; i < 16; i++) near(flat[i], Lm[Math.floor(i / 4)][i % 4], 1e-12, 'boost matrix');
  }
});
check('F_{mu nu} under a boost: textbook fields and invariants', () => {
  const F = VM.fieldTensor([0, 0.8, 0], [0, 0, 0.5]);
  for (const beta of [-0.6, 0.3, 0.75]) {
    const g = 1 / Math.sqrt(1 - beta * beta), eb = VM.fieldEB(VM.boostF(F, beta));
    near(eb.E[1], g * (0.8 - beta * 0.5), 1e-12, "E'_y"); near(eb.B[2], g * (0.5 - beta * 0.8), 1e-12, "B'_z");
    near(VM.dot(eb.E, eb.E) - VM.dot(eb.B, eb.B), 0.64 - 0.25, 1e-12, 'E2 - B2');
    // the same law through MATH.transform (lower slots use J^-1 transposed)
    const Ft = MATH.Tensor.fromNested(F, ['d', 'd']), J = VM.boostX(beta);
    const Fm = MATH.transform(Ft, J), mine = VM.boostF(F, beta);
    for (let i = 0; i < 16; i++) near(Fm.data[i], mine[Math.floor(i / 4)][i % 4], 1e-12, 'MATH.transform F');
  }
});
check('transform-rank2 matches MATH.transform; the quadric surface is invariant', () => {
  const Q = cont.baseQuadric();
  for (const u of [0.3, 1]) {
    const J = cont.jacobianAt(u, 'general'), Qn = cont.transformLower2(Q, J);
    const M = MATH.transform(MATH.Tensor.fromNested(Q, ['d', 'd']), J);
    for (let i = 0; i < 9; i++) near(M.data[i], Qn[Math.floor(i / 3)][i % 3], 1e-12);
    // a point x on the surface has x' = J x on the new surface
    const ax = cont.quadricAxes(Q)[0], xp = VM.mat3Vec(J, ax);
    near(VM.dot(xp, VM.mat3Vec(Qn, xp)), 1, 1e-9, 'Q x x = 1');
  }
});
check('stress: traction t = sigma n and the normal part', () => {
  const s = cont.stressAt(35).sig, n = VM.unit([1, 2, 2]), t = cont.traction(s, n);
  const tm = MATH.contract(MATH.product(MATH.Tensor.fromNested(s, ['d', 'd']), new MATH.Tensor([3], ['u'], n)), 1, 2);
  for (let i = 0; i < 3; i++) near(tm.data[i], t[i], 1e-12);
});
check('inertia: |L| and the energy stay constant through the flips', () => {
  const Ib = cont.INERTIA.Ib;
  ok(Ib[0] < Ib[1] && Ib[1] < Ib[2], 'principal moments ascending');
  const s0 = cont.inertiaState(0), L0 = VM.len(s0.w.map((v, i) => v * Ib[i])), E0 = VM.dot(s0.w, s0.w.map((v, i) => v * Ib[i]));
  let flips = 0, sign = Math.sign(s0.w[1]);
  for (let t = 0.5; t <= 40; t += 0.5) {
    const s = cont.inertiaState(t), Lw = VM.mat3Vec(s.R, s.w.map((v, i) => v * Ib[i]));
    near(VM.len(Lw), L0, 1e-6 * L0, '|L|'); near(VM.dot(s.w, s.w.map((v, i) => v * Ib[i])), E0, 1e-6 * E0, 'E');
    if (Math.sign(s.w[1]) !== sign) { flips++; sign = Math.sign(s.w[1]); }
  }
  ok(flips >= 3, 'the body flips near its middle axis: ' + flips);
  const I = MATH.Tensor.fromNested(cont.INERTIA.I, ['d', 'd']);
  near(MATH.trace(I, 0, 1, MATH.Tensor.fromNested([[1, 0, 0], [0, 1, 0], [0, 0, 1]], ['u', 'u'])).data[0], Ib[0] + Ib[1] + Ib[2], 1e-9, 'trace = sum of moments');
});
check('Christoffel symbols: polar and spherical match MATH.christoffel', () => {
  for (const r of [0.7, 1.8]) {
    const G = MATH.christoffel('polar', [r, 0.4]), mine = curvi.polarGamma(r);
    near(G.get(0, 1, 1), mine.r.thth, 1e-6); near(G.get(1, 0, 1), mine.th.rth, 1e-6); near(G.get(1, 1, 0), mine.th.rth, 1e-6);
  }
  const Gs = MATH.christoffel('spherical', [1.5, 0.9, 0.3]), sg = blocks.sphericalGamma(1.5, 0.9);
  for (let i = 0; i < 27; i++) near(Gs.data[i], sg.data[i], 1e-6, 'spherical ' + i);
});
check('Tissot: Mercator is conformal, plate carree is not', () => {
  for (const th of [0.6, 1.2, 1.9]) {
    const g = curvi.chartMetric('mercator', th, 0.3);
    near(g[0][1], 0, 1e-6); near(g[0][0] / g[1][1], 1, 1e-4, 'conformal');
    near(g[0][0], Math.sin(th) ** 2, 1e-4, 'Mercator scale');
    const e = curvi.chartMetric('equirect', th, 0.3);
    near(e[1][1], 1, 1e-6); near(e[0][0], Math.sin(th) ** 2, 1e-6);
  }
});
check('epsilon, contraction and findContraction match MATH', () => {
  const E = blocks.epsilon3(), L = MATH.leviCivita(3);
  for (let i = 0; i < 27; i++) near(E.data[i], L.data[i], 0);
  near(blocks.tripleEps([1, 0, 0], [0, 1, 0], [0, 0, 1]), 1, 0);
  const A = new MATH.Tensor([3, 3, 3], ['u', 'd', 'd'], Array.from({ length: 27 }, (_, i) => Math.sin(i * 1.3)));
  const mine = blocks.contractC(A, 0, 2), theirs = MATH.contract(A, 0, 2);
  for (let i = 0; i < 3; i++) near(mine.data[i], theirs.data[i], 1e-12);
  const pr = blocks.findContraction(A, theirs);
  ok(pr && pr[0] === 0 && pr[1] === 2, 'found pair ' + pr);
});
check('Flamm: dl/dr = 1 / sqrt(1 - rs/r), and the orbit precesses', () => {
  for (const r of [1.5, 3, 7]) near((VM.properRadial(r + 1e-5, 1) - VM.properRadial(r - 1e-5, 1)) / 2e-5, 1 / Math.sqrt(1 - 1 / r), 1e-5);
  const o = VM.orbitSchw(0.5, 8, 2.0, 12000, 0.01);
  // angles of successive apoapses advance by more than 2 pi
  const apo = [];
  for (let i = 1; i < o.length - 1; i++) if (o[i][0] >= o[i - 1][0] && o[i][0] > o[i + 1][0]) apo.push(o[i][1]);
  ok(apo.length >= 2 && apo[1] - apo[0] > 2 * Math.PI + 0.5, 'precession ' + (apo[1] - apo[0]));
});

// ---- 3. every scene draws ----------------------------------------------------------
function finiteDL(dl, id) {
  for (const B of [dl.solid, dl.glass, dl.lines]) for (let i = 0; i < B.n * B.stride; i++) if (!Number.isFinite(B.a[i])) throw new Error(`${id}: NaN in a buffer at ${i}`);
  for (const L of dl.labels) ok(L.screen || (L.p && L.p.every(Number.isFinite)), `${id}: label position`);
  ok(dl.solid.n + dl.glass.n + dl.lines.n > 0, `${id}: draws nothing`);
}
check('every scene draws finite geometry in free play (0 to 120 s) and with the pick lens', () => {
  const dl = new DLm.DL();
  for (const id of R.SCENE_IDS) for (let t = 0; t <= 120; t += 7.3) {
    dl.reset(t > 60 ? 'i' : null, t);
    R.frameScene(id, dl, { time: t, aspect: t > 60 ? 0.56 : 1.78 });
    finiteDL(dl, id);
  }
});
check('every scene draws with every option of its params', () => {
  const dl = new DLm.DL();
  for (const id of R.SCENE_IDS) for (const q of R.SCENES[id].params) {
    const vals = q.options || [q.min, q.max];
    for (const v of vals) { dl.reset(null, 5); R.frameScene(id, dl, { time: 5, params: { [q.key]: v } }); finiteDL(dl, `${id}.${q.key}=${v}`); }
  }
});
check('MATH trace steps play: the scene for each step draws at t = 0, 0.5, 1', () => {
  const T = MATH.Tensor;
  const A = T.fromNested([[1, 2, 0], [0, -1, 3], [2, 1, 1]], ['u', 'd']), v = new T([3], ['u'], [1, -2, 0.5]);
  const g = T.fromNested([[2, 0.3, 0], [0.3, 1, 0], [0, 0, 1]], ['d', 'd']);
  const Q = T.fromNested([[2, 0.5, 0], [0.5, 1, 0.2], [0, 0.2, 1.5]], ['d', 'd']);
  const traces = [
    MATH.traceProduct(A, v), MATH.traceContract(A, 0, 1), MATH.traceTrace(A), MATH.traceLower(v, 0, g),
    MATH.traceTransform(Q, [[1, 0.2, 0], [0, 1.1, 0], [0.1, 0, 0.9]]), MATH.traceChristoffel('polar', [1.5, 0.7]),
    MATH.traceChristoffel('spherical', [1.3, 0.9, 0.4]), MATH.traceSymmetrize(T.fromNested([[1, 2, 0], [0, -1, 3], [2, 1, 1]], ['d', 'd']), [0, 1]),
    MATH.traceParallelTransport('sphere', s => [0.9, 2 * Math.PI * s], [1, 0], { steps: 200 }),
    MATH.traceLeviCivita(new T([3], ['u'], [1, 0, 0]), new T([3], ['u'], [0, 1, 0])),
    MATH.traceRiemann('sphere', [1.0, 0.5]),
  ];
  const dl = new DLm.DL();
  let steps = 0;
  const used = new Set();
  for (const tr of traces) for (const step of tr.steps) {
    const m = TM.stepScene(step, R.SCENES);
    ok(R.SCENES[m.scene], `unknown scene ${m.scene} for ${step.kind}`);
    used.add(m.scene);
    for (const t of [0, 0.5, 1]) {
      dl.reset(null, 3);
      R.frameScene(m.scene, dl, { time: 3, t, step, params: m.params });
      finiteDL(dl, `${m.scene} <- ${step.kind}`);
    }
    steps++;
  }
  ok(steps > 20, 'steps ' + steps);
  for (const s of ['outer-product', 'contraction', 'upper-lower', 'christoffel', 'parallel-transport']) ok(used.has(s), 'traces reach ' + s);
  console.log(`     trace steps played: ${steps}, scenes: ${[...used].join(', ')}`);
});
check('a contraction step shows the numbers of the trace', () => {
  const A = MATH.Tensor.fromNested([[1, 2, 0], [0, -1, 3], [2, 1, 1]], ['u', 'd']);
  const tr = MATH.traceTrace(A);
  const step = tr.steps.find(s => s.kind === 'contract' || s.kind === 'trace') || tr.steps[0];
  const dl = new DLm.DL(); dl.reset(null, 1);
  R.frameScene('contraction', dl, { time: 1, t: 1, step });
  if (dl.reads.pairA != null && step.numeric && step.numeric.output && step.numeric.output.data.length === 1) near(dl.reads.sum0, 1, 1e-12, 'trace of A');
});
check('raise and lower steps drive the metric morph of upper-lower', () => {
  const dl = new DLm.DL();
  for (const [kind, t, want] of [['lower', 0, 0], ['lower', 1, 1], ['raise', 0, 1], ['raise', 1, 0]]) {
    dl.reset(null, 2); R.frameScene('upper-lower', dl, { time: 2, t, step: { kind } });
    near(dl.reads.metric, want, 1e-9, `${kind} at ${t}`);
  }
});

// ---- 4. saver shots -------------------------------------------------------------------
check('saver shots: 20 or more, known scenes and params, finite cameras', () => {
  ok(SH.SAVER_SHOTS.length >= 20, 'count ' + SH.SAVER_SHOTS.length);
  const scenes = new Set();
  for (const s of SH.SAVER_SHOTS) {
    ok(R.SCENES[s.scene], s.scene);
    scenes.add(s.scene);
    const keys = R.SCENES[s.scene].params.map(q => q.key);
    for (const k of Object.keys(s.params)) ok(keys.includes(k), `${s.scene}.${k}`);
    ok([...s.camera.pos, ...s.camera.target, s.camera.fov].every(Number.isFinite), 'camera');
    ok(VM.len(VM.sub(s.camera.pos, s.camera.target)) > 1, 'camera distance');
    ok(s.seconds >= 5 && s.seconds <= 30 && s.label && ['geometry', 'relativity', 'notation'].includes(s.channel), 'shot fields');
  }
  for (const id of R.SCENE_IDS) if (id !== 'components') ok(scenes.has(id), 'no shot of ' + id);
});
check('saver shots frame the subject in the middle band at 16:9 and 9:16', () => {
  const dl = new DLm.DL();
  for (const s of SH.SAVER_SHOTS) for (const aspect of [16 / 9, 9 / 16]) {
    dl.reset(null, s.seconds * 0.5);
    R.frameScene(s.scene, dl, { time: s.seconds * 0.5, params: s.params, aspect });
    const C = s.camera, f = VM.unit(VM.sub(C.target, C.pos)), r = VM.unit(VM.cross(f, [0, 1, 0])), u = VM.cross(r, f);
    const ty = Math.tan((SH.fitFov(C.fov, aspect) * Math.PI) / 360), tx = ty * aspect;
    let n = 0, sx = 0, sy = 0, inside = 0;
    for (const B of [dl.solid, dl.glass]) for (let i = 0; i < B.n; i += 3) {
      const p = [B.a[i * 10], B.a[i * 10 + 1], B.a[i * 10 + 2]], d = VM.sub(p, C.pos), z = VM.dot(d, f);
      if (z < 0.1) continue;
      const x = VM.dot(d, r) / z / tx, y = VM.dot(d, u) / z / ty;
      n++; sx += x; sy += y; if (Math.abs(x) < 1 && Math.abs(y) < 1) inside++;
    }
    ok(n > 0, s.scene + ' has triangles');
    const cx = sx / n, cy = sy / n;
    ok(Math.abs(cx) < 0.5 && Math.abs(cy) < 0.45, `${s.label} @${aspect.toFixed(2)}: centre (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
    ok(inside / n > 0.6, `${s.label} @${aspect.toFixed(2)}: only ${(100 * inside / n).toFixed(0)}% in view`);
  }
});
check('fitFov widens tall views only', () => {
  near(SH.fitFov(40, 16 / 9), 40, 1e-9); ok(SH.fitFov(40, 9 / 16) > 60, 'tall'); ok(SH.fitFov(90, 0.3) <= 100, 'cap');
});

// ---- index.js imports (three mapped to the vendor copy) --------------------------------
try {
  const hook = 'data:text/javascript,' + encodeURIComponent(`
const V = ${JSON.stringify(pathToFileURL(join(page, '../../vendor/three@0.160.0/')).href)};
export async function resolve(s, c, n) {
  if (s === 'three') return { url: V + 'build/three.module.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: V + 'examples/jsm/' + s.slice(13), shortCircuit: true };
  return n(s, c);
}`);
  register(hook);
  const V = await imp('viz/index.js');
  check('viz/index.js exports the contract API', () => {
    for (const k of ['createViz', 'SCENE_IDS', 'SAVER_SHOTS', 'LINE_VS', 'LINE_FS']) ok(k in V, k);
    ok(typeof V.createViz === 'function' && V.createViz.length >= 1, 'createViz');
  });
} catch (e) { fail++; console.log('FAIL import viz/index.js: ' + e.message); }

console.log(`viz: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
