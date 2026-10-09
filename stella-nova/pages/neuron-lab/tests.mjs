// ============================================================================
//  NEURON LAB  ·  tests.mjs  ·  node stella-nova/pages/neuron-lab/tests.mjs
// ----------------------------------------------------------------------------
//  Checks the shared engine (engine/*.js) with no browser:
//    Hines solve against a dense solve on random trees
//    single-compartment HH at 6.3 C: rest, spike shape, threshold, f-I curve
//    conduction velocity on an unmyelinated axon against sqrt(diameter)
//    dt halving convergence of the spike time
//    NetCon delay, ExpSyn and Exp2Syn, NetStim
//    morphologies, the d_lambda rule
//    network: determinism by seed, no NaN, PING gamma
//    saver shot plans: durations and no repeats
//  Exit code 1 on any failure.
// ============================================================================
import { Cell, hinesSolve, denseSolve, somaOnly, dLambdaNseg, lambdaF, exp2Factor } from './engine/cell.js';
import { HH, NRN, rates, vtrap } from './engine/hh.js';
import { makeCell, CELLS } from './engine/morph.js';
import { makeNetwork, popRate, peakFreq, MODELS } from './engine/network.js';
import { LAB_SHOTS, NET_SHOTS, shotPlan } from './engine/shots.js';
import { rng } from './engine/rng.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const say = (...a) => console.log('  ', ...a);

// ── 1. Hines against dense ──────────────────────────────────────────────
{
  const R = rng(11); let worst = 0;
  for (let trial = 0; trial < 60; trial++) {
    const n = 2 + Math.floor(R() * 120), parent = new Int32Array(n);
    parent[0] = -1; for (let i = 1; i < n; i++) parent[i] = Math.floor(R() * i);
    const d = new Float64Array(n), a = new Float64Array(n), b = new Float64Array(n), r = new Float64Array(n);
    const M = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) { d[i] = 0.5 + R() * 3; r[i] = R() * 2 - 1; }
    for (let i = 1; i < n; i++) { const g = R() * 2, p = parent[i]; a[i] = -g; b[i] = -g * (0.5 + R()); d[i] += g; d[p] += Math.abs(b[i]); }
    for (let i = 0; i < n; i++) M[i][i] = d[i];
    for (let i = 1; i < n; i++) { M[i][parent[i]] = a[i]; M[parent[i]][i] = b[i]; }
    const x = denseSolve(M, Array.from(r));
    hinesSolve(n, parent, d.slice(), a, b, r);
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(x[i] - r[i]));
  }
  ok(worst < 1e-9, 'Hines matches dense, max error ' + worst);
  say('Hines vs dense on 60 random trees (2..121 nodes, unsymmetric off-diagonals): max |error| =', worst.toExponential(2));
}

// ── 2. hh.mod rates ─────────────────────────────────────────────────────
{
  const r = rates(-65, 6.3);
  near(r[0], 0.0529, 0.0005, 'minf(-65)'); near(r[2], 0.596, 0.001, 'hinf(-65)'); near(r[4], 0.3177, 0.0005, 'ninf(-65)');
  near(vtrap(0, 10), 10, 1e-12, 'vtrap at 0'); near(vtrap(1e-9, 10), 10 * (1 - 1e-10 / 2), 1e-9, 'vtrap near 0');
  const r2 = rates(-65, 16.3); near(r2[1] * 3, r[1], 1e-12, 'q10 = 3 per 10 C');
  ok(HH.gnabar === 0.12 && HH.gkbar === 0.036 && HH.gl === 0.0003 && HH.el === -54.3, 'hh.mod PARAMETER defaults');
  ok(NRN.dt === 0.025 && NRN.celsius === 6.3 && NRN.v_init === -65, 'NEURON defaults dt, celsius, v_init');
  say('rates(-65 mV): minf', r[0].toFixed(4), 'hinf', r[2].toFixed(4), 'ninf', r[4].toFixed(4));
}

// ── 3. single compartment HH ───────────────────────────────────────────
// 500 um2 soma, so 1 uA/cm2 = 0.005 nA
function fI(J, opts = {}) {
  const c = somaOnly(opts); c.iclamp(0, { del: 0, dur: 1e9, amp: J * 0.005 });
  const sp = []; let prev = c.v[0], pk = -1e9, tr = 1e9;
  c.run(opts.tstop || 1000, k => { if (prev < 0 && k.v[0] >= 0) sp.push(k.t); prev = k.v[0]; if (k.t > 200) { pk = Math.max(pk, k.v[0]); tr = Math.min(tr, k.v[0]); } });
  const late = sp.filter(t => t > 500);
  return { n: sp.length, f: late.length > 1 ? 1000 * (late.length - 1) / (late[late.length - 1] - late[0]) : 0, pk, tr, sp };
}
{
  const c = somaOnly(); c.run(300);
  near(c.v[0], -65, 0.1, 'rest at -65 mV');
  // one spike from a 1 ms pulse: threshold amplitude
  const one = amp => { const k = somaOnly(); k.iclamp(0, { del: 5, dur: 1, amp }); let pk = -1e9; k.run(30, q => { pk = Math.max(pk, q.v[0]); }); return pk; };
  let lo = 0, hi = 0.2; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (one(m) > 0) hi = m; else lo = m; }
  const thr = hi / 0.005; // uA/cm2 for 1 ms
  ok(thr > 3 && thr < 10, '1 ms pulse threshold in 3..10 uA/cm2 (charge ~ 6.5 nC/cm2): ' + thr);
  const pkV = one(hi * 2);
  near(pkV, 40, 6, 'spike peak near +40 mV');
  const below = fI(6.0), above = fI(6.5), f10 = fI(10), f20 = fI(20), f40 = fI(40);
  ok(below.f === 0, 'no tonic firing at 6.0 uA/cm2');
  ok(above.f > 45 && above.f < 62, 'tonic firing jumps in at 6.5 uA/cm2 (~50 Hz, type II): ' + above.f);
  near(f10.f, 68, 3, 'f at 10 uA/cm2 (HH: ~68 Hz)');
  near(f20.f, 86, 4, 'f at 20 uA/cm2');
  ok(f40.f > f20.f && f20.f > f10.f, 'f-I rises');
  ok(f10.pk > 25 && f10.pk < 45, 'tonic spike peak 25..45 mV: ' + f10.pk); ok(f10.tr < -70 && f10.tr > -80, 'after-hyperpolarisation trough -70..-80: ' + f10.tr);
  say(`rest ${c.v[0].toFixed(2)} mV; 1 ms threshold ${thr.toFixed(2)} uA/cm2; peak ${pkV.toFixed(1)} mV`);
  say(`tonic spike at 10 uA/cm2: peak ${f10.pk.toFixed(1)} mV, trough ${f10.tr.toFixed(1)} mV`);
  say(`f-I (Hz): 6.0 -> ${below.f.toFixed(1)}, 6.5 -> ${above.f.toFixed(1)}, 10 -> ${f10.f.toFixed(1)}, 20 -> ${f20.f.toFixed(1)}, 40 -> ${f40.f.toFixed(1)}`);
}

// ── 4. dt halving ──────────────────────────────────────────────────────
{
  const tspk = dt => { const c = somaOnly({ dt }); c.iclamp(0, { del: 2, dur: 0.5, amp: 0.1 }); let prev = c.v[0], ts = NaN; c.run(20, k => { if (isNaN(ts) && prev < 0 && k.v[0] >= 0) ts = k.t - k.dt * k.v[0] / (k.v[0] - prev); prev = k.v[0]; }); return ts; };
  const ref = tspk(0.025 / 64), e = [0.025, 0.0125, 0.00625].map(dt => Math.abs(tspk(dt) - ref));
  ok(e[0] / e[1] > 1.6 && e[0] / e[1] < 2.5 && e[1] / e[2] > 1.6 && e[1] / e[2] < 2.5, 'first order convergence: ' + e.map(x => x.toExponential(2)));
  ok(e[0] < 0.05, 'dt = 0.025 spike time within 0.05 ms');
  say('spike time error at dt 0.025 / 0.0125 / 0.00625 ms:', e.map(x => x.toExponential(2)).join(' / '), 'ratios', (e[0] / e[1]).toFixed(2), (e[1] / e[2]).toFixed(2));
}

// ── 5. conduction velocity ∝ sqrt(d) ───────────────────────────────────
{
  const vel = d => {
    const L = 6000 * Math.sqrt(d);
    const S = [{ name: 'axon', kind: 'axon', parent: -1, L, d0: d, pts: [[0, 0, 0], [L, 0, 0]] }];
    const c = new Cell(S, { nseg: 401 });
    c.iclamp(0, { del: 1, dur: 1, amp: 0.5 * d * d });
    const i1 = Math.round(0.3 * c.n), i2 = Math.round(0.7 * c.n); let t1 = NaN, t2 = NaN;
    c.run(80, k => { if (isNaN(t1) && k.v[i1] > 0) t1 = k.t; if (isNaN(t2) && k.v[i2] > 0) t2 = k.t; });
    return (c.dist[i2] - c.dist[i1]) / (t2 - t1) / 1000; // m/s
  };
  const v1 = vel(1), v4 = vel(4), v16 = vel(16);
  near(v4 / v1, 2, 0.15, 'v(4d)/v(d) = 2'); near(v16 / v4, 2, 0.15, 'v(16d)/v(4d) = 2');
  say(`conduction velocity at 6.3 C: d 1 um ${v1.toFixed(3)} m/s, 4 um ${v4.toFixed(3)}, 16 um ${v16.toFixed(3)}; ratios ${(v4 / v1).toFixed(3)}, ${(v16 / v4).toFixed(3)}`);
}

// ── 6. NetCon delay, synapses, NetStim ─────────────────────────────────
{
  const pre = somaOnly(), post = somaOnly();
  pre.iclamp(0, { del: 2, dur: 1, amp: 0.1 });
  const syn = post.expSyn(0, { tau: 2, e: 0 });
  let tc = NaN; const nc = pre.netcon(0, syn, { delay: 3.7, weight: 0.01, cell: post }); nc.onSpike = t => { tc = t; };
  let tOn = NaN;
  for (let k = 0; k < 600; k++) { pre.step(); post.step(); if (isNaN(tOn) && syn.g > 0) tOn = post.t; }
  ok(!isNaN(tc), 'pre cell crossed threshold');
  ok(Math.abs((tOn - post.dt) - (tc + 3.7)) <= post.dt, `event delivered at tc + delay within dt (${(tOn - post.dt).toFixed(3)} vs ${(tc + 3.7).toFixed(3)})`);
  say(`NetCon: threshold crossing ${tc.toFixed(3)} ms, delay 3.7, delivered in the step from ${(tOn - post.dt).toFixed(3)} ms`);
  // Exp2Syn peak = weight
  const c2 = somaOnly(); const s2 = c2.exp2Syn(0, { tau1: 0.5, tau2: 5 }); c2.receive(s2, 1); let gmax = 0;
  for (let k = 0; k < 1000; k++) { c2.step(); gmax = Math.max(gmax, s2.B - s2.A); }
  near(gmax, 1, 0.01, 'Exp2Syn normalised peak');
  // ExpSyn decay
  const c3 = somaOnly(); const s3 = c3.expSyn(0, { tau: 4 }); c3.receive(s3, 1); c3.run(4); near(s3.g, Math.exp(-1), 1e-9, 'ExpSyn decays by e in tau');
  // NetStim periodic
  const c4 = somaOnly(); const ns = c4.netstim({ interval: 7, number: 5, start: 3, noise: 0 }); const times = [];
  c4.netcon(ns, null).onSpike = t => times.push(+t.toFixed(6)); c4.init(); c4.run(60);
  ok(times.length === 5 && Math.abs(times[0] - 3) < 0.03 && Math.abs(times[4] - 31) < 0.03, 'NetStim start 3 interval 7 number 5: ' + times.join(','));
  // nseg rule
  near(lambdaF(100, 1, 35.4, 1), 474.2, 0.5, 'lambda_100 at d 1 um'); ok(dLambdaNseg(400, 1) === 9 && dLambdaNseg(10, 1) === 1, 'd_lambda nseg: L 400 d 1 -> 9');
  ok(Math.abs(exp2Factor(0.1, 10).factor - 1.0582) < 1e-3, 'exp2syn factor (0.1, 10)');
}

// ── 7. morphologies ────────────────────────────────────────────────────
for (const C of CELLS) {
  const S = makeCell(C.id, 5);
  ok(S[0].kind === 'soma' && S.every((s, i) => s.parent < i), C.id + ': tree order');
  ok(S.every(s => s.L > 0 && s.d0 > 0 && s.pts.every(p => p.every(Number.isFinite))), C.id + ': finite geometry');
  const cell = new Cell(S, { dlambda: 0.03 }); cell.useTable(true);
  cell.iclamp(0, { del: 1, dur: 2, amp: C.id === 'granule' ? 0.1 : C.id === 'motor' ? 8 : 2 });
  let pk = -1e9, bad = 0; cell.run(15, k => { pk = Math.max(pk, k.v[0]); });
  for (const v of cell.v) if (!Number.isFinite(v)) bad++;
  ok(pk > 20 && bad === 0, C.id + ': soma spikes, no NaN');
  say(`${C.id}: ${S.length} sections, ${cell.n} nodes, soma peak ${pk.toFixed(1)} mV`);
  ok(JSON.stringify(makeCell(C.id, 5)) === JSON.stringify(S), C.id + ': same seed, same shape');
}

// ── 8. network ─────────────────────────────────────────────────────────
{
  const run = seed => { const n = makeNetwork({ model: 'ping', N: 400, seed }); n.run(300); return n; };
  const a = run(7), b = run(7), c = run(8);
  ok(a.spikes.length > 100 && a.spikes.length === b.spikes.length && a.spikes.every((x, i) => x === b.spikes[i]), 'same seed, same spikes');
  ok(c.spikes.length !== a.spikes.length || c.spikes.some((x, i) => x !== a.spikes[i]), 'other seed, other spikes');
  for (const id of Object.keys(MODELS)) {
    const n = makeNetwork({ model: id, N: 600, seed: 2 });
    if (id === 'ring') { n.run(40); n.stimulate({ p: [520, 0, 0], r: 90, amp: 2, dur: 2 }); }
    n.run(700);
    let bad = 0; for (const arr of [n.vs, n.vd, n.m, n.h, n.n, n.gE, n.gI]) for (const x of arr) if (!Number.isFinite(x)) bad++;
    const pk = peakFreq(popRate(n, 600, 1));
    const rE = n.spikes.filter((x, k) => k % 2 && x < n.NE).length / n.NE / (n.t / 1000);
    ok(bad === 0, id + ': no NaN');
    if (id === 'ping') ok(pk.f >= 30 && pk.f <= 80 && pk.ratio > 15, `ping: gamma peak ${pk.f} Hz (ratio ${pk.ratio.toFixed(1)})`);
    if (id === 'balanced') ok(pk.ratio < 10 && rE > 0.5 && rE < 15, `balanced: no strong rhythm (ratio ${pk.ratio.toFixed(1)}), E rate ${rE.toFixed(1)} Hz`);
    if (id === 'ring') ok(rE > 2, 'ring: the wave keeps going, E rate ' + rE.toFixed(1));
    say(`${id}: ${n.nNetCon} NetCons, E rate ${rE.toFixed(1)} Hz, spectrum peak ${pk.f} Hz (peak/mean ${pk.ratio.toFixed(1)})`);
  }
  // delays: every event leaves at least 1 step after the spike
  ok(a.dsteps.every(d => d >= 1), 'NetCon delays at least one step');
}

// ── 9. saver plans ─────────────────────────────────────────────────────
for (const [name, bag] of [['lab', LAB_SHOTS], ['net', NET_SHOTS]]) {
  let rep = 0, badSec = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const P = shotPlan(bag, seed, 30, (seed % 10) / 9);
    for (let i = 0; i < P.length; i++) { if (P[i].sec < 6 || P[i].sec > 12) badSec++; if (i && P[i].id === P[i - 1].id) rep++; }
  }
  ok(rep === 0, name + ': no back-to-back repeats'); ok(badSec === 0, name + ': cuts every 6 to 12 s');
  const p1 = shotPlan(bag, 1, 12).map(s => s.id).join(), p2 = shotPlan(bag, 2, 12).map(s => s.id).join();
  ok(p1 !== p2, name + ': plans vary by seed');
  ok(shotPlan(bag, 3, bag.length).every((s, i, A) => A.findIndex(q => q.id === s.id) === i), name + ': each pass holds every shot once');
  ok(bag.every(s => s.title && s.tex && s.tex.length && !('code' in s)), name + ': plates have TeX, no code');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
