// ============================================================================
//  GRAVITY LAB  ·  tests.mjs — checks of the integrators, the experiments
//  and the GPU kernels
// ----------------------------------------------------------------------------
//  node stella-nova/pages/gravity-lab/tests.mjs          the CPU tests, then
//                                                       the GPU tests in Deno
//  deno run -A stella-nova/pages/gravity-lab/tests.mjs --gpu   GPU only
//  node tests.mjs --only <key>   the experiment tests of one experiment
//  node tests.mjs --page --cpu   core, budget and page modules only (no Deno)
//
//  CORE (nbody.js, lab.js)
//  1  Kepler: an e = 0.6 two-body orbit closes after one period (System);
//     a test particle on a circle (CpuParticles, kick-drift-kick) too
//  2  conservation: energy, momentum and angular momentum of a softened
//     12-body cluster over 10 crossing times
//  3  the figure-eight (Chenciner-Montgomery) returns after one period
//  4  the Pythagorean problem (Burrau; Szebehely and Peters 1967): the
//     mass-3 body escapes, 4 and 5 stay as a tight binary
//  5  a merger keeps mass and momentum; E + Eloss stays constant
//  6  a fragile moon breaks up inside the fluid Roche limit (and not
//     outside); the books E + Eloss hold
//  7  Lagrange points of Earth-Moon against published values; elements
//     to state and back
//  BUDGET (budget.js): the pair interactions of one frame at Normal speed
//     for every experiment on desktop and phone budgets; GPU bytes
//  EXPERIMENTS (experiments/index.js runChecks): every spec well formed,
//     seeds, the shuffle bag, then each experiment's own physics check
//  PAGE MODULES (no DOM): roll.js (300 seeds well formed, in budget,
//     seeded, varied; incoming() reaches q at tp; sandbox scenes and
//     intruders do what their titles say on the CPU), items.js (a tap gives
//     a circular orbit; extendSystem keeps every state; predictPath is
//     the run that follows), frame.js, saver-plan.js (reel, shots, cuts,
//     subjects, laws), budget.js pixelRatio
//  GPU (Deno WebGPU): cs_restricted against CpuParticles, cs_gravity and
//  cs_kick against the f64 direct sum, the impact stamp and hit counts
//  PAGE (Deno WebGPU, test-page.mjs): the whole page on a fake DOM: boot,
//  frames, every scene, the tray, the screensaver
//
//  Each test prints PASS or FAIL with its numbers. Exit code 1 on a FAIL.
// ============================================================================
import * as N from './nbody.js';
import * as L from './lab.js';

const ARGS = typeof Deno !== 'undefined' ? Deno.args : process.argv.slice(2);
const GPU_ONLY = ARGS.includes('--gpu');
const ONLY = ARGS.includes('--only') ? ARGS[ARGS.indexOf('--only') + 1] : null;
let fails = 0;
const ok = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!cond) fails++; };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const e3 = x => x.toExponential(2);

function coreTests() {
  // 1 Kepler
  {
    const GM = 1.001, el = { a: 1, e: 0.6, f: 0 }, s0 = N.elementsToState(GM, el);
    const sys = new N.System([{ m: 1, x: [0, 0, 0], v: [0, 0, 0] }, { m: 0.001, x: s0.r, v: s0.v }]);
    const T = N.period(GM, 1);
    sys.advance(T, 64);
    const d = Math.hypot(sys.x[3] - sys.x[0] - s0.r[0], sys.x[4] - sys.x[1] - s0.r[1]);
    ok('1 Kepler: e = 0.6 orbit closes after T = 2 pi sqrt(a^3 / GM)', d < 1e-8, `|dx| ${e3(d)} after T ${T.toFixed(5)}`);
    const traj = new Float32Array(2 * N.MAXB * N.TRAJ_STRIDE);
    const sun = new N.System([{ m: 1, x: [0, 0, 0], v: [0, 0, 0] }]); sun.writeRow(traj, 0); sun.writeRow(traj, 1);
    const lap = steps => { const p = new N.CpuParticles(1, [1, 0, 0], [0, 1, 0]), dt = 2 * Math.PI / steps; for (let k = 0; k < steps; k++) p.run(traj, 1, dt); return Math.hypot(p.x[0] - 1, p.x[1]); };
    const d1 = lap(2000), d2 = lap(4000);
    ok('1 test particle (kick-drift-kick) closes its circle, error falls as dt^2', d1 < 1e-4 && Math.abs(d1 / d2 - 4) < 0.2, `|dx| ${e3(d1)} at 2000 steps per orbit, ${e3(d2)} at 4000 (ratio ${(d1 / d2).toFixed(2)})`);
  }
  // 2 conservation
  {
    const r = N.rng(5), B = [];
    for (let i = 0; i < 12; i++) B.push({ m: 0.5 + r(), x: [N.gauss(r), N.gauss(r), N.gauss(r)], v: [0.4 * N.gauss(r), 0.4 * N.gauss(r), 0.4 * N.gauss(r)], eps: 0.05 });
    N.toCOM(B);
    const sys = new N.System(B, { eta: 0.02 });
    const E0 = sys.energy(), L0 = sys.angmom(), P0 = sys.momentum();
    for (let k = 0; k < 100; k++) sys.advance(0.1, 1);
    const dE = rel(sys.energy(), E0), dL = N.v3.len(N.v3.sub(sys.angmom(), L0)) / N.v3.len(L0), dP = N.v3.len(sys.momentum());
    ok('2 softened 12-body cluster: E, L and P conserved over t = 10', dE < 1e-7 && dL < 1e-10 && dP < 1e-10, `|dE/E| ${e3(dE)}, |dL|/|L| ${e3(dL)}, |P| ${e3(dP)}, ${sys.subTotal} substeps`);
  }
  // 3 figure-eight
  {
    const p1 = [0.97000436, -0.24308753, 0], v3 = [-0.93240737, -0.86473146, 0];
    const sys = new N.System([{ m: 1, x: p1, v: [-v3[0] / 2, -v3[1] / 2, 0] }, { m: 1, x: [-p1[0], -p1[1], 0], v: [-v3[0] / 2, -v3[1] / 2, 0] }, { m: 1, x: [0, 0, 0], v: v3 }]);
    const E0 = sys.energy();
    sys.advance(6.32591398, 100);
    const d = Math.hypot(sys.x[0] - p1[0], sys.x[1] - p1[1]);
    ok('3 figure-eight returns after T = 6.32591398', d < 1e-6, `|dx| ${e3(d)}, |dE/E| ${e3(rel(sys.energy(), E0))}`);
  }
  // 4 Pythagorean
  {
    const sys = new N.System([{ m: 3, x: [1, 3, 0], v: [0, 0, 0] }, { m: 4, x: [-2, -1, 0], v: [0, 0, 0] }, { m: 5, x: [1, -1, 0], v: [0, 0, 0] }], { eta: 0.01, maxSub: 1e7 });
    const E0 = sys.energy();
    for (let k = 0; k < 700; k++) sys.advance(0.1, 1);
    const el = sys.elementsOf(1, 2), c = N.v3.mul(N.v3.add(N.v3.mul(sys.pos(1), 4), N.v3.mul(sys.pos(2), 5)), 1 / 9);
    const r3 = N.v3.len(N.v3.sub(sys.pos(0), c));
    const u = N.v3.sub(sys.vel(0), N.v3.mul(N.v3.add(N.v3.mul(sys.vel(1), 4), N.v3.mul(sys.vel(2), 5)), 1 / 9));
    const E3 = 0.5 * N.v3.dot(u, u) - 12 / r3;
    ok('4 Pythagorean 3:4:5 at t = 70: mass 3 escapes, 4 + 5 a binary', E3 > 0 && el.e > 0.9 && el.a < 1 && rel(sys.energy(), E0) < 1e-6, `r3 ${r3.toFixed(1)}, E3 ${E3.toFixed(3)}, binary a ${el.a.toFixed(3)} e ${el.e.toFixed(3)}, |dE/E| ${e3(rel(sys.energy(), E0))}`);
  }
  // 5 merger
  {
    const B = [{ name: 'A', m: 1, r: 0.1, x: [0, 0, 0], v: [0, 0, 0] }, { name: 'B', m: 0.3, r: 0.05, x: [2, 0.05, 0], v: [-0.8, 0, 0] }, { name: 'C', m: 0.1, r: 0.02, x: [0, 3, 0], v: [0.5, 0, 0] }];
    const sys = new N.System(B, { ejecta: 64 });
    const E0 = sys.energy(), P0 = sys.momentum(), M0 = sys.mass();
    for (let k = 0; k < 40; k++) sys.advance(0.1, 2);
    const ev = sys.drain().filter(e => e.type === 'merge');
    const dP = N.v3.len(N.v3.sub(sys.momentum(), P0)), dEb = Math.abs(sys.energy() + sys.Eloss - E0) / Math.abs(E0);
    ok('5 merger: one merge, mass and momentum kept, E + Eloss constant', ev.length === 1 && Math.abs(sys.mass() - M0) < 1e-14 && dP < 1e-12 && dEb < 1e-8 && ev[0].spawn.n === 64,
      `${ev.length} merge at t ${ev[0] ? ev[0].t.toFixed(3) : '-'} v ${ev[0] ? ev[0].v.toFixed(3) : '-'}, |dP| ${e3(dP)}, |d(E + Eloss)/E| ${e3(dEb)}, R ${sys.R[0].toFixed(4)}`);
  }
  // 6 breakup at the Roche limit
  {
    const mk = q => {
      const GM = 1, el = { a: 4, e: 1 - q / 4, f: -Math.PI * 0.6 }, s = N.elementsToState(GM, el);
      return new N.System([{ name: 'planet', m: 1, r: 1, x: [0, 0, 0], v: [0, 0, 0], rho: 1 }, { name: 'moon', m: 1e-6, r: 0.01, x: s.r, v: s.v, rho: 1, fragile: { rho: 1, n: 500 }, merge: true }]);
    };
    const dR = N.rocheFluid(1, 1, 1);
    const inS = mk(1.6), outS = mk(3.0);
    const E0 = inS.energy();
    for (let k = 0; k < 200; k++) { inS.advance(0.05, 1); outS.advance(0.05, 1); }
    const ev = inS.drain().filter(e => e.type === 'breakup'), evo = outS.drain().filter(e => e.type === 'breakup');
    const books = Math.abs(inS.energy() + inS.Eloss - E0) / Math.abs(E0);
    ok('6 breakup: pericentre 1.6 R inside d = 2.44 R breaks up; 3.0 R does not', ev.length === 1 && evo.length === 0 && ev[0].d < dR * 1.001 && ev[0].spawn.n === 500 && books < 1e-8,
      `breakup at d ${ev[0] ? ev[0].d.toFixed(3) : '-'} (limit ${dR.toFixed(3)}), outside: ${evo.length}, books ${e3(books)}`);
  }
  // 7 Lagrange points, elements
  {
    const L = N.lagrangePoints(0.01215);
    const want = [0.83692, 1.15568, -1.00506];
    const err = Math.max(...want.map((w, k) => Math.abs(L[k][0] - w)));
    ok('7 Earth-Moon L1, L2, L3 (mu = 0.01215)', err < 2e-4, `L1 ${L[0][0].toFixed(5)}, L2 ${L[1][0].toFixed(5)}, L3 ${L[2][0].toFixed(5)}`);
    const el = { a: 2.3, e: 0.37, i: 0.6, O: 1.1, w: 2.2, f: 0.9 }, s = N.elementsToState(1.3, el), b = N.stateToElements(1.3, s.r, s.v);
    const d = Math.max(Math.abs(b.a - el.a), Math.abs(b.e - el.e), Math.abs(b.i - el.i), Math.abs(b.O - el.O));
    ok('7 elements -> state -> elements', d < 1e-12, `max error ${e3(d)}`);
  }
  // 8 Lab with the CPU backend: a breakup spawns debris into the pool
  {
    const GM = 1, s = N.elementsToState(GM, { a: 4, e: 1 - 1.5 / 4, f: -Math.PI * 0.6 });
    const spec = { bodies: [{ name: 'planet', m: 1, r: 1, x: [0, 0, 0], v: [0, 0, 0] }, { name: 'moon', m: 1e-6, r: 0.02, x: s.r, v: s.v, rho: 1.2, fragile: { rho: 0.5, n: 300 } }],
      particles: { n: 0, pos: [], vel: [] }, pool: 256, dt: 0.01 };
    const lab = new L.Lab(spec, cap => new L.CpuRestricted(cap));
    let rows = null;
    for (let f = 0; f < 120 && !rows; f++) { for (const e of lab.frame(0.1)) if (e.type === 'breakup') rows = e.rows; }
    for (let f = 0; f < 20; f++) lab.frame(0.1);
    const rb = lab.be.readback();
    let alive = 0; for (let i = 0; i < lab.cap; i++) if (rb.body[12 * i + 7] > 0) alive++;
    ok('8 Lab: the breakup fills the pool (300 debris, a pool of 256 rows keeps 256)', rows && rows.length === 1 && rows[0][0] === 0 && rows[0][1] === 256 && alive > 200, `rows ${JSON.stringify(rows)}, ${alive} live debris, ${Array.from(rb.hits.slice(0, 1))} hit the planet`);
  }
}

// ── page modules ────────────────────────────────────────────────────────────
async function pageModuleTests() {
  const R = await import('./roll.js'), X = await import('./experiments/index.js'), BG = await import('./budget.js');
  const IT = await import('./items.js'), F = await import('./frame.js'), SP = await import('./saver-plan.js');
  const C = await import('./experiments/common.js');
  // R1 300 seeds: shape, budget, families, sandbox kinds, titles
  {
    const fam = {}, kinds = new Set(), titles = new Set(), bad = [];
    let worst = { desktop: [0, ''], touch: [0, ''] };
    for (let seed = 1; seed <= 300; seed++) {
      for (const prof of ['desktop', 'touch']) {
        if (prof === 'touch' && seed % 5) continue;
        const q = BG.budgetFor('auto', prof === 'touch');
        let sp;
        try { sp = R.roll(seed, { n: q.n, nSelf: q.nSelf }); } catch (e) { bad.push(`${seed}: ${e.message}`); continue; }
        for (const e of X.shapeErrors(sp, sp.key === 'disk' ? q.nSelf : q.n)) bad.push(`${seed} ${sp.title}: ${e}`);
        if (prof === 'desktop') { fam[sp.rollInfo.family] = (fam[sp.rollInfo.family] || 0) + 1; if (sp.rollInfo.family === 'sandbox') kinds.add(sp.rollInfo.base); titles.add(sp.title); }
        const pr = R.prepare(sp, { extra: prof === 'touch' ? 1024 : 3072 });
        const w = BG.frameWork(pr, 1);
        if (w > worst[prof][0]) worst[prof] = [w, `${seed} ${sp.title}`];
      }
    }
    const a = JSON.stringify(R.roll(77, { n: 512 }).bodies.map(b => b.x)), b = JSON.stringify(R.roll(77, { n: 512 }).bodies.map(b => b.x));
    ok('R1 roll: 300 seeds well formed, all three families, every scene kind, seeded', bad.length === 0 && Object.keys(fam).length === 3 && kinds.size === Object.keys(R.SANDBOX).length && a === b && titles.size >= 60,
      `families ${JSON.stringify(fam)}, ${kinds.size}/${Object.keys(R.SANDBOX).length} scene kinds, ${titles.size} distinct titles; ${bad.slice(0, 3).join(' | ') || 'no errors'}`);
    ok('R1 roll: pair work per frame at Normal speed with the page pool (desktop, phone)', worst.desktop[0] <= BG.LIMIT.desktop && worst.touch[0] <= BG.LIMIT.touch,
      `desktop worst ${e3(worst.desktop[0])} (${worst.desktop[1]}), phone worst ${e3(worst.touch[0])} (${worst.touch[1]})`);
  }
  // R2 incoming(): two bodies from that state meet at q after tp
  {
    let worst = 0, worstT = 0;
    for (const [GM, q, vk, tp] of [[1, 0.3, 0.4, 2], [3, 1.2, 0.8, 5], [1e-3, 0.05, 0.2, 40]]) {
      const vinf = vk * Math.sqrt(GM / q), s = R.incoming(GM, q, vinf, tp, 0.4, 1.0, 2.0);
      const sys = new N.System([{ m: GM, x: [0, 0, 0], v: [0, 0, 0] }, { m: 0, x: s.r, v: s.v }]);
      let dmin = Infinity, tmin = 0;
      const n = 4000;
      for (let k = 0; k < n; k++) { sys.advance(2 * tp / n, 1); const d = N.v3.len(N.v3.sub(sys.pos(1), sys.pos(0))); if (d < dmin) { dmin = d; tmin = sys.t; } }
      worst = Math.max(worst, Math.abs(dmin - q) / q); worstT = Math.max(worstT, Math.abs(tmin - tp) / tp);
    }
    ok('R2 incoming(): closest approach q at time tp (hyperbolic Kepler equation)', worst < 1e-4 && worstT < 2e-3, `worst |d - q|/q ${e3(worst)}, |t - tp|/tp ${e3(worstT)}`);
  }
  // R3 scenes and intruders do what their titles say (CPU, small n)
  {
    const res = [];
    const runFor = (sp, sec, every = 1) => C.runCpu(R.prepare(sp, { extra: 512 }), sp.rate * sec, Math.ceil(sec * 20), null, every);
    const fin = lab => { const s = lab.sys; for (let i = 0; i < 3 * s.n; i++) if (!isFinite(s.x[i])) return false; return true; };
    let pass = true;
    for (const key of Object.keys(R.SANDBOX)) for (const seed of [3, 4]) {
      const sp = R.roll(seed, { n: 300, family: 'sandbox', sandbox: key });
      const { lab, events } = runFor(sp, 15);
      const types = new Set(events.map(e => e.type));
      let want = true, note = '';
      if (key === 'ringDive') { want = types.has('breakup'); note = 'breakup'; }
      if (key === 'bhSwarm') { want = types.has('breakup'); note = 'breakup (TDE)'; }
      const ok1 = fin(lab) && want;
      if (!ok1) pass = false;
      res.push(`${key}/${seed}${note ? ' ' + note + (want ? ' yes' : ' NO') : ''} [${[...types].join(',') || '-'}]`);
    }
    ok('R3 generated scenes: finite for 15 s at Normal speed; a rubble moon and a plunging star break up', pass, res.join('; '));
    // intruders: the closest approach happens near the planned time
    const out = []; let okI = true, count = 0;
    for (let seed = 1; seed < 400 && count < 8; seed++) {
      const sp = R.roll(seed, { n: 200, family: 'intruder' });
      if (!sp.rollInfo || sp.rollInfo.family !== 'intruder' || !['blackhole', 'star', 'planet', 'rubble'].includes(sp.rollInfo.intruder)) continue;
      count++;
      const iN = sp.bodies.length - 1, sec = 14;
      const { lab, events } = runFor(sp, sec);
      const dom = sp.opts.watch[sp.opts.watch.length - 1][0];
      const hit = events.find(e => (e.type === 'periapsis' && e.j === iN && e.i === dom) || (e.type === 'breakup' && e.i === iN) || (e.type === 'merge' && (e.j === iN || e.i === iN)));
      const tRel = hit ? hit.t / sp.rollInfo.tPeri : NaN;
      const good = fin(lab) && hit && tRel > 0.6 && tRel < 1.4;
      if (!good) okI = false;
      out.push(`${sp.rollInfo.intruder}@${sp.rollInfo.base}: ${hit ? hit.type + ' at ' + tRel.toFixed(2) + ' tp' : 'no approach'}`);
    }
    ok('R3 intruders: the planned closest approach (or a breakup or merge there) comes at 0.6-1.4 of the planned time', okI && count >= 6, out.join('; '));
  }
  // I1 items
  {
    const sp = X.build('kepler', 1, { n: 64, variant: 'laws' }), sys = new N.System(sp.bodies, sp.opts);
    const dom = IT.dominant(sys), ext = sp.view.extent, p = N.v3.add(dom.x, [0.7, 0.3, 0]);
    const v = IT.throwVelocity(p, [0, 0, 0], dom, ext, IT.itemMass('moon', sys));
    const b = IT.makeItem('moon', sys, p, v, ext);
    const el = N.stateToElements(dom.m + b.m, N.v3.sub(p, dom.x), N.v3.sub(v, dom.v));
    const ns = IT.extendSystem(sys, [b], [[dom.i, sys.n]]);
    let same = true; for (let i = 0; i < sys.n; i++) for (let k = 0; k < 3; k++) if (ns.x[3 * i + k] !== sys.x[3 * i + k] || ns.v[3 * i + k] !== sys.v[3 * i + k]) same = false;
    // the path ahead against the run that follows (both end in the same
    // merge, or neither does)
    const p2 = N.v3.add(dom.x, [-0.9, 0.2, 0]), mk2 = () => IT.makeItem('planet', ns, p2, IT.throwVelocity(p2, [0.05, -0.2, 0], dom, ext), ext);
    const pr = IT.predictPath(ns, mk2(), 3, 30, 4000);
    const ns2 = IT.extendSystem(ns, [mk2()]), run = [ns2.pos(ns2.n - 1)];
    for (let k = 0; k < 30 && ns2.alive[ns2.n - 1]; k++) { ns2.advance(0.1, 1); if (ns2.alive[ns2.n - 1]) run.push(ns2.pos(ns2.n - 1)); }
    let dEnd = 0; for (let k = 0; k < pr.pts.length; k++) dEnd = Math.max(dEnd, N.v3.len(N.v3.sub(run[k] || [1e9, 0, 0], pr.pts[k])));
    if ((pr.end !== null) !== !ns2.alive[ns2.n - 1] || run.length !== pr.pts.length) dEnd = Infinity;
    const sw = IT.swarm('dust', p, v, ext, dom.v, 3);
    const rub = IT.makeItem('rubble', ns, p, v, ext);
    ok('I1 tray: a tap orbits in a circle; extendSystem keeps every state; the path ahead is the run that follows; swarms and rubble',
      el.e < 1e-9 && same && ns.n === sys.n + 1 && ns.watch.length === sys.watch.length + 1 && dEnd < 1e-9 && sw.n === IT.ITEM.dust.parts.n && rub.fragile && rub.fragile.rho > 0,
      `tap: e ${e3(el.e)}; states kept ${same}; path ahead vs run: ${pr.pts.length} points, ${pr.end !== null ? 'both end in a merge at t ' + pr.end.toFixed(3) : 'no merge'}, max |dx| ${e3(dEnd)}; dust ${sw.n} particles; rubble fragile rho ${rub.fragile && rub.fragile.rho.toFixed(3)}`);
  }
  // F1 frames
  {
    // a circular pair: both bodies stand still in the turning frame
    const sys = new N.System([{ m: 1, x: [0, 0, 0], v: [0, 0, 0] }, { m: 0.01, x: [1, 0, 0], v: [0, Math.sqrt(1.01), 0] }]);
    sys.advance(1.3, 4);
    const f = F.frameOf(sys, { center: 'com', rotating: [0, 1] });
    const q = F.toFrame(f, sys.pos(1)), back = F.toWorld(f, q);
    const u = F.toWorldVel(f, sys.pos(1), [0, 0, 0]);
    ok('F1 frame: the pair stays on the +x axis; frame <-> world round trip; omega x r', Math.abs(q[1]) < 1e-12 && q[0] > 0 && N.v3.len(N.v3.sub(back, sys.pos(1))) < 1e-12 && N.v3.len(N.v3.sub(u, sys.vel(1))) < 1e-9,
      `y in the frame ${e3(Math.abs(q[1]))}, round trip ${e3(N.v3.len(N.v3.sub(back, sys.pos(1))))}, |v_frame -> world - v| ${e3(N.v3.len(N.v3.sub(u, sys.vel(1))))}`);
  }
  // S1 saver plan
  {
    const a = SP.makeReel(11), b = SP.makeReel(11), c = SP.makeReel(12);
    let rep = 0; for (let i = 1; i < a.length; i++) if (a[i].type === 'library' && a[i - 1].type === 'library' && a[i].key === a[i - 1].key) rep++;
    const lib = a.filter(x => x.type === 'library').length, rolls = a.filter(x => x.type === 'roll').length;
    const rnd = SP.rng(5); let badLen = 0, badSeq = 0, kinds = new Set(), firstOK = true;
    for (let k = 0; k < 200; k++) {
      const plan = SP.shotPlan(rnd, k % 7 === 0);
      if (plan[0].kind !== 'establish') firstOK = false;
      for (let i = 0; i < plan.length; i++) { const sh = plan[i]; kinds.add(sh.kind); if (sh.len < SP.CUT_MIN || sh.len > SP.CUT_MAX) badLen++; if (i && sh.kind === plan[i - 1].kind) badSeq++; }
    }
    const subj = SP.pickSubject([{ i: 0, alive: true, a: 1, dom: true }, { i: 1, alive: true, a: 5 }, { i: 2, alive: true, a: 2 }, { i: 3, alive: false, a: 99 }], () => 0.9);
    const cuts = [SP.shotDone({ len: 7 }, 4.9), SP.shotDone({ len: 7 }, 7.1), SP.shotDone({ len: 30 }, 12.1)];
    const laws = [SP.lawFor({ key: 'lagrange', view: { rotating: [0, 1] } }).name, SP.lawFor({ key: 'kepler', view: {} }).name, SP.lawFor({ key: 'galaxies', view: {} }).name];
    ok('S1 saver plan: seeded reel (library + rolls), shots 5-12 s, establish first, no kind twice in a row, data-driven subject, cuts, laws',
      JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c) && rep === 0 && lib === 53 && rolls === 40 && badLen === 0 && badSeq === 0 && firstOK && kinds.size === 5 && subj === 1 && cuts.join() === 'false,true,true' && laws.join() === 'Jacobi integral,vis-viva,Newton' && SP.eventWorth({ type: 'breakup' }, 1) > SP.eventWorth({ type: 'periapsis', d: 0.05 }, 1) && SP.eventWorth({ type: 'periapsis', d: 0.5 }, 1) === 0,
      `reel ${a.length} (${lib} library, ${rolls} rolls, ${rep} repeats); ${badLen} shots out of 5-12 s, ${badSeq} repeats; kinds ${[...kinds].join(',')}; subject ${subj}; laws ${laws.join(', ')}`);
  }
  // B1 pixels
  {
    const pr = [BG.pixelRatio('auto', false, 1920, 1080, 2), BG.pixelRatio('auto', true, 390, 844, 3), BG.pixelRatio('high', false, 2560, 1440, 2)];
    const px = [1920 * 1080 * pr[0] ** 2, 390 * 844 * pr[1] ** 2, 2560 * 1440 * pr[2] ** 2];
    ok('B1 pixel ratio: under each preset\'s pixel budget, at most 1.5 on a phone', px[0] <= BG.MAXPX.medium * 1.0001 && pr[1] <= 1.5 && px[1] <= BG.MAXPX.low * 1.0001 && px[2] <= BG.MAXPX.high * 1.0001,
      `desktop ${pr[0].toFixed(2)} (${(px[0] / 1e6).toFixed(2)} Mpx), phone ${pr[1].toFixed(2)} (${(px[1] / 1e6).toFixed(2)} Mpx), high ${pr[2].toFixed(2)} (${(px[2] / 1e6).toFixed(2)} Mpx)`);
  }
}

// ── experiments ─────────────────────────────────────────────────────────────
async function budgetTests() {
  const BG = await import('./budget.js'), X = await import('./experiments/index.js');
  const worst = { desktop: [0, ''], touch: [0, ''] };
  for (const [key, ex] of Object.entries(X.EXPERIMENTS)) for (const v of ex.variants) for (const prof of ['desktop', 'touch']) {
    const q = BG.budgetFor('auto', prof === 'touch');
    const spec = X.build(key, 1, { n: key === 'disk' ? q.nSelf : q.n, variant: v });
    const w = BG.frameWork(spec, 1);
    if (w > worst[prof][0]) worst[prof] = [w, key + '/' + v];
  }
  ok('budget: pair interactions per frame at Normal speed (desktop, phone)', worst.desktop[0] <= BG.LIMIT.desktop && worst.touch[0] <= BG.LIMIT.touch,
    `desktop worst ${e3(worst.desktop[0])} (${worst.desktop[1]}, limit ${e3(BG.LIMIT.desktop)}), phone worst ${e3(worst.touch[0])} (${worst.touch[1]}, limit ${e3(BG.LIMIT.touch)})`);
  const mb = BG.particleBytes(BG.QUALITY.high.n + 8192) / 1e6, ms = BG.particleBytes(BG.QUALITY.high.nSelf, true) / 1e6;
  ok('budget: GPU bytes of one Lab (high quality)', mb < 8 && ms < 2, `restricted ${mb.toFixed(2)} MB, self-gravity ${ms.toFixed(2)} MB`);
}

async function experimentTests() {
  let X;
  try { X = await import('./experiments/index.js'); } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') { console.log('SKIP  experiments/index.js not there yet'); return; } throw e; }
  await X.runChecks({ ok, only: ONLY, log: console.log });
}

// ── GPU (Deno) ──────────────────────────────────────────────────────────────
async function gpuTests() {
  if (typeof navigator === 'undefined' || !navigator.gpu) { console.log('SKIP  GPU tests: no navigator.gpu here'); return; }
  const E = await import('./engine.js');
  const code = await Deno.readTextFile(new URL('./shaders/nbody.wgsl', import.meta.url));
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { console.log('SKIP  GPU tests: no adapter'); return; }
  const dev = await adapter.requestDevice();
  const errs = []; dev.addEventListener?.('uncapturederror', e => errs.push(String(e.error?.message || e)));
  const r = N.rng(3);
  // restricted: a disk around a star with a planet that eats particles
  {
    const n = 2000, pos = new Float64Array(3 * n), vel = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      const a = 0.6 + 2 * r(), th = 2 * Math.PI * r(), v = Math.sqrt(1 / a) * (0.85 + 0.3 * r());
      pos.set([a * Math.cos(th), a * Math.sin(th), 0.05 * (r() - 0.5)], 3 * i); vel.set([-v * Math.sin(th), v * Math.cos(th), 0], 3 * i);
    }
    const spec = { bodies: [{ name: 'star', m: 1, r: 0.3, x: [0, 0, 0], v: [0, 0, 0] }, { name: 'planet', m: 0.01, r: 0.05, x: [1.5, 0, 0], v: [0, Math.sqrt(1.01 / 1.5), 0], epsP: 0.002 }], particles: { n, pos, vel, size: 0.01 }, dt: 0.01, pool: 0 };
    N.toCOM(spec.bodies);
    const lc = new L.Lab(spec, cap => new L.CpuRestricted(cap)), lg = E.makeLab(dev, spec, code);
    for (let f = 0; f < 10; f++) { lc.frame(0.3); lg.frame(0.3); }
    const rc = lc.be.readback(), rg = await lg.be.readback();
    let dx = 0, dead = 0, mism = 0, stamp = 0;
    for (let i = 0; i < n; i++) {
      const ac = rc.body[12 * i + 7] > 0, ag = rg.body[12 * i + 7] > 0;
      if (ac !== ag) { mism++; continue; }
      if (!ac) { dead++; stamp = Math.max(stamp, Math.abs(rg.body[12 * i + 11] - rc.body[12 * i + 11])); continue; }
      for (let k = 0; k < 3; k++) dx = Math.max(dx, Math.abs(rc.body[12 * i + k] - rg.body[12 * i + k]));
    }
    ok('GPU cs_restricted = CpuParticles (2000 particles, 300 steps)', dx < 1e-3 && mism <= 2, `max |dx| ${e3(dx)}, ${mism} differ in alive, ${dead} absorbed`);
    ok('GPU impact stamps and hit counts = CPU', stamp < 1e-4 && rg.hits[0] + rg.hits[1] === dead && Math.abs(rg.hits[0] - rc.hits[0]) <= 2, `|dt hit| ${e3(stamp)}, hits GPU ${rg.hits[0]}/${rg.hits[1]} CPU ${rc.hits[0]}/${rc.hits[1]}`);
    lg.destroy();
  }
  // self-gravity: a Plummer-like ball
  {
    const n = 700, P = { n, pos: new Float64Array(3 * n), vel: new Float64Array(3 * n), mass: new Float64Array(n).fill(1 / n), size: 0.01 };
    for (let i = 0; i < n; i++) { P.pos.set([N.gauss(r), N.gauss(r), N.gauss(r)], 3 * i); P.vel.set([0.3 * N.gauss(r), 0.3 * N.gauss(r), 0.3 * N.gauss(r)], 3 * i); }
    const spec = { self: Object.assign(P, { eps: 0.05 }), dt: 0.01 };
    const ref = { n, pos: Float64Array.from(P.pos), vel: Float64Array.from(P.vel), mass: P.mass, eps: 0.05 };
    const E0 = N.selfEnergy(ref).E;
    const lg = E.makeLab(dev, spec, code);
    const first = await lg.be.readback();
    const { acc } = N.selfAccel(n, ref.pos, ref.mass, 0.05);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { num += (first.acc[4 * i + k] - acc[3 * i + k]) ** 2; den += acc[3 * i + k] ** 2; }
    ok('GPU cs_gravity = f64 direct sum (700 particles)', Math.sqrt(num / den) < 1e-5, `rms rel err ${e3(Math.sqrt(num / den))} (tile padding: ${lg.be.cap - n} empty rows)`);
    for (let f = 0; f < 20; f++) { lg.frame(0.05); for (let k = 0; k < 5; k++) N.selfStep(ref, 0.01); }
    const rb = await lg.be.readback();
    let dx = 0, K = 0, U = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) dx = Math.max(dx, Math.abs(rb.body[12 * i + k] - ref.pos[3 * i + k]));
      K += 0.5 * P.mass[i] * (rb.body[12 * i + 4] ** 2 + rb.body[12 * i + 5] ** 2 + rb.body[12 * i + 6] ** 2); U += 0.5 * P.mass[i] * rb.acc[4 * i + 3];
    }
    ok('GPU self-gravity steps = CPU (100 steps); energy kept', dx < 1e-3 && rel(K + U, E0) < 1e-3, `max |dx| ${e3(dx)}, |dE/E| GPU ${e3(rel(K + U, E0))}`);
    lg.destroy();
  }
  // an experiment through the whole path on the GPU: SL9 breaks up, the
  // debris is spawned into the pool and hits Jupiter
  {
    const X = await import('./experiments/index.js');
    const spec = X.build('sl9', 1, { n: 512, variant: '1994' });
    const lc = new L.Lab(spec, cap => new L.CpuRestricted(cap)), lg = E.makeLab(dev, spec, code);
    const h = spec.tq * 1.4 / 200;
    let evc = 0, evg = 0;
    for (let f = 0; f < 200; f++) { evc += lc.frame(h).filter(e => e.type === 'breakup').length; evg += lg.frame(h).filter(e => e.type === 'breakup').length; }
    const rc = lc.be.readback(), rg = await lg.be.readback();
    let hc = 0, hg = 0, dt = 0;
    for (let i = 0; i < lg.cap; i++) {
      const c = !(rc.body[12 * i + 7] > 0) && rc.body[12 * i + 11] > 0, g = !(rg.body[12 * i + 7] > 0) && rg.body[12 * i + 11] > 0;
      hc += c; hg += g; if (c && g) dt = Math.max(dt, Math.abs(rc.body[12 * i + 11] - rg.body[12 * i + 11]));
    }
    ok('GPU experiment sl9/1994: breakup spawns debris, impacts = CPU', evc === 1 && evg === 1 && hg > 0 && Math.abs(hg - hc) <= 0.02 * hc && dt < 1e-2 * spec.tq,
      `breakups CPU ${evc} GPU ${evg}; impacts CPU ${hc} GPU ${hg} (hit counter ${rg.hits[0]}); max |dt hit| ${e3(dt)}`);
    lg.destroy();
  }
  ok('no WebGPU validation errors', errs.length === 0, errs.join(' | ') || 'none');
  dev.destroy();
}

if (!GPU_ONLY) {
  const t0 = Date.now();
  if (!ONLY) { coreTests(); await budgetTests(); await pageModuleTests(); }
  if (!ARGS.includes('--page')) await experimentTests();
  console.log(`CPU tests: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
if (typeof Deno !== 'undefined') await gpuTests();
else if (!ONLY && !ARGS.includes('--cpu')) {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const d = spawnSync('deno', ['run', '-A', fileURLToPath(import.meta.url), '--gpu'], { encoding: 'utf8' });
  if (d.error) console.log('SKIP  GPU tests: deno is not installed (' + d.error.code + ')');
  else { process.stdout.write(d.stdout); if (d.stderr.trim()) process.stdout.write(d.stderr.split('\n').filter(l => !/^(Download|Warning)/.test(l)).join('\n')); if (d.status !== 0) fails++; }
  // the whole page on Deno's WebGPU (test-page.mjs)
  if (!d.error) {
    const p = spawnSync('deno', ['run', '-A', fileURLToPath(new URL('./test-page.mjs', import.meta.url))], { encoding: 'utf8', timeout: 600000 });
    process.stdout.write(p.stdout || '');
    if (p.stderr && p.stderr.trim()) process.stdout.write(p.stderr.split('\n').filter(l => !/^(Download|Warning)/.test(l)).join('\n'));
    if (p.status !== 0) fails++;
    // the same page with no WebGPU: the saver hook must not hang
    const q = spawnSync('deno', ['run', '-A', fileURLToPath(new URL('./test-page.mjs', import.meta.url)), '--nogpu'], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(q.stdout || '');
    if (q.status !== 0) fails++;
  }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
if (typeof Deno !== 'undefined') { if (fails) Deno.exit(1); } else if (fails) process.exit(1);
