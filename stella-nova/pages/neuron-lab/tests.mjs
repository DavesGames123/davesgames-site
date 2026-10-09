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
//    randomisation: ranges, seeds, locks, every random cell a valid tree
//    that fires, Ih sag, spine area, the hash round trip
//    multi-cell networks of full cells: NetCon delay, threshold weight,
//    inhibition, a reverberating ring, the compartment budget, presets,
//    the connectivity matrix through the hash
//    network mode (netplan.js): build from Randomize values and from the
//    hash, the demos (chain hand-off, ring, inhibition), the matrix click,
//    the multi-select edit, spikes in flight on the axons
//  Exit code 1 on any failure.
// ============================================================================
import { Cell, hinesSolve, denseSolve, somaOnly, dLambdaNseg, lambdaF, exp2Factor } from './engine/cell.js';
import { HH, NRN, rates, vtrap } from './engine/hh.js';
import { makeCell, CELLS } from './engine/morph.js';
import { makeNetwork, popRate, peakFreq, MODELS } from './engine/network.js';
import { LAB_SHOTS, NET_SHOTS, shotPlan } from './engine/shots.js';
import { rng } from './engine/rng.js';
import { Cell as Cell2, ihRates, SPINE_AREA } from './engine/cell.js';
import { CATS, RANGES, TYPES, sample, catSeed, defaults, morphFactors, cellOpts, stdStimulus, stimPlan } from './engine/random.js';
import { encodeHash, decodeHash } from './engine/hashstate.js';
import { buildNet, applyPreset, cycleLink, editLinks, netState, flightsOf, pointOn, DEMOS, kicker, wxOf } from './engine/netplan.js';
import { MultiNet, BUDGET, THRESH_W, SYN_DELAY, layoutPositions, wirePreset, matrixOf, axonCurve, chooseDlambda } from './engine/multicell.js';

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

// ── 10. randomisation ─────────────────────────────────────────────────
{
  let out = 0, nkeys = 0;
  for (const C of CATS) for (let seed = 1; seed <= 300; seed++) {
    const v = sample(C.id, catSeed(seed, C.id));
    for (const [k, r] of Object.entries(RANGES[C.id])) {
      nkeys++;
      if (r.choices) { const ok2 = r.multi ? v[k].every(x => r.choices.includes(x)) : r.choices.includes(v[k]); if (!ok2) out++; }
      else if (!(v[k] >= r.lo - 1e-12 && v[k] <= r.hi + 1e-12) || (r.int && v[k] !== Math.round(v[k]))) out++;
    }
  }
  ok(out === 0, 'every sampled value inside its range: ' + out + ' out of ' + nkeys);
  // the default ranges are physiological
  const B = RANGES.bio;
  ok(B.gna.lo >= 0.05 && B.gna.hi <= 0.3 && B.gk.lo >= 0.01 && B.gk.hi <= 0.1 && B.gl.lo >= 5e-5 && B.gl.hi <= 1e-3, 'channel densities in hh-model bounds');
  ok(B.el.lo >= -70 && B.el.hi <= -45 && B.Ra.lo >= 30 && B.Ra.hi <= 300 && B.cm.lo >= 0.5 && B.cm.hi <= 2 && B.celsius.lo >= 6 && B.celsius.hi <= 37 && B.gih.hi <= 0.001, 'cable, temperature, leak and Ih in physiological bounds');
  const a = JSON.stringify(CATS.map(C => sample(C.id, catSeed(42, C.id)))), b = JSON.stringify(CATS.map(C => sample(C.id, catSeed(42, C.id))));
  ok(a === b, 'same master seed, same values');
  ok(a !== JSON.stringify(CATS.map(C => sample(C.id, catSeed(43, C.id)))), 'other seed, other values');
  ok(new Set(CATS.map(C => catSeed(42, C.id))).size === 4, 'each category has its own stream');
  // a key that is off keeps its default; the others do not move
  const s1 = sample('bio', 77), s2 = sample('bio', 77, { gna: { on: false } });
  ok(s2.gna === RANGES.bio.gna.d && s2.gk === s1.gk && s2.Ra === s1.Ra, 'a toggle sets the default and leaves the other keys');
  const s3 = sample('bio', 77, { Ra: { lo: 100, hi: 101 } });
  ok(s3.Ra >= 100 && s3.Ra <= 101, 'a user range is obeyed: Ra ' + s3.Ra.toFixed(2));
  ok(JSON.stringify(defaults('bio')) === JSON.stringify(sample('bio', 5, Object.fromEntries(Object.keys(RANGES.bio).map(k => [k, { on: false }])))), 'all keys off gives the defaults');
  // every random cell: valid tree, finite, fires under the standard stimulus
  let bad = 0, nofire = 0, tot = 0, maxN = 0, tr = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= 50; seed++) for (const type of TYPES) {
    const m = sample('morph', catSeed(seed, 'morph')), bio = sample('bio', catSeed(seed, 'bio'));
    const S = makeCell(type, seed, morphFactors(m));
    if (!(S[0].kind === 'soma' && S[0].parent === -1 && S.every((s, i) => i === 0 || (s.parent >= 0 && s.parent < i)) && S.every(s => s.L > 0 && s.d0 > 0 && s.x >= 0 && s.x <= 1 && s.pts.every(p => p.every(Number.isFinite))))) bad++;
    const c = new Cell2(S, { ...cellOpts(bio), dlambda: 0.1 }); c.useTable(true);
    const st = stdStimulus(type, m); c.iclamp(0, { del: 1, dur: st.dur, amp: st.amp });
    let pk = -1e9; c.run(20, k => { pk = Math.max(pk, k.v[0]); });
    if (!c.v.every(Number.isFinite)) bad++;
    if (!(pk > 0)) nofire++;
    tot++; maxN = Math.max(maxN, c.n);
    if (stimPlan(sample('stim', catSeed(seed, 'stim')), c, type, seed).every(it => it.node >= 0 && it.node < c.n)) tr++;
  }
  ok(bad === 0, 'random cells are valid trees with finite state: bad ' + bad);
  ok(nofire === 0, `random cells fire under the standard soma pulse: ${tot - nofire}/${tot}`);
  ok(tr === tot, 'random stimulus plans use real nodes');
  say(`${tot} random cells (50 seeds x 4 types, morph + bio random): ${tot - nofire} fire, largest ${maxN} compartments at d_lambda 0.1, ${Date.now() - t0} ms`);
  // shape factors do something
  const big = makeCell('pyramidal', 3, morphFactors({ ...sample('morph', 1), branches: 1.6, depth: 1, length: 1.5 })), small = makeCell('pyramidal', 3, morphFactors({ ...sample('morph', 1), branches: 0.6, depth: -1, length: 0.6 }));
  ok(big.length > small.length * 1.5, `branch factors change the tree: ${small.length} -> ${big.length} sections`);
  const ax2 = makeCell('pyramidal', 3, { axon: 2, collaterals: 4 }), ax1 = makeCell('pyramidal', 3, { axon: 1, collaterals: 0 });
  ok(ax2.find(s => s.name === 'axon').L === 840 && ax2.filter(s => s.name.startsWith('coll')).length === 4 && ax1.filter(s => s.name.startsWith('coll')).length === 0, 'axon length and collateral count');
}
// ── 11. spines and Ih ─────────────────────────────────────────────────
{
  const S = [{ name: 'soma', kind: 'soma', parent: -1, L: 20, d0: 20, pts: [[0, 0, 0], [0, 20, 0]] }, { name: 'd', kind: 'dend', parent: 0, L: 200, d0: 2, pts: [[0, 20, 0], [0, 220, 0]] }];
  const c0 = new Cell2(S, { nseg: 5 }), c1 = new Cell2(S.map(s => s.kind === 'dend' ? { ...s, spines: 1.5 } : s), { nseg: 5 });
  near(c1.area[7] / c0.area[7], 1 + 1.5 * SPINE_AREA / (Math.PI * 2), 1e-9, 'spine factor F = 1 + density A / (pi d)');
  ok(c1.ga[7] === c0.ga[7] && c1.area[2] === c0.area[2], 'spines leave the axial conductance');
  const [inf65, tau65] = ihRates(-65), [inf90] = ihRates(-90);
  ok(inf90 > inf65 && tau65 > 20 && tau65 < 80, `Ih opens on hyperpolarisation: minf(-65) ${inf65.toFixed(4)}, minf(-90) ${inf90.toFixed(3)}, tau(-65) ${tau65.toFixed(1)} ms`);
  const sag = gih => {
    const c = somaOnly({ dens: () => ({ gnabar: HH.gnabar, gkbar: HH.gkbar, gl: HH.gl, el: HH.el, gih }) });
    c.run(400); const rest = c.v[0];
    c.iclamp(0, { del: c.t, dur: 600, amp: -0.04 });
    let vmin = 1e9; c.run(c.t + 600, k => { vmin = Math.min(vmin, k.v[0]); });
    return { rest, vmin, end: c.v[0], sag: c.v[0] - vmin, on: c.ihOn };
  };
  const s0 = sag(0), s1 = sag(0.002);
  ok(!s0.on && s1.on, 'Ih is skipped when gih is 0 everywhere');
  ok(s1.sag > 2 && s0.sag < 0.5, `Ih gives a sag under a hyperpolarising step: ${s1.sag.toFixed(2)} mV with Ih, ${s0.sag.toFixed(2)} mV without`);
  ok(s1.rest > s0.rest, `Ih depolarises rest: ${s0.rest.toFixed(2)} -> ${s1.rest.toFixed(2)} mV`);
  say(`Ih (Hay 2011): rest ${s0.rest.toFixed(2)} -> ${s1.rest.toFixed(2)} mV, sag ${s1.sag.toFixed(2)} mV at -0.04 nA (none without: ${s0.sag.toFixed(2)})`);
}
// ── 12. the hash ──────────────────────────────────────────────────────
{
  const st = { seed: 4242, seeds: { morph: 11, bio: 0, stim: 7, wire: 900001 }, lock: ['bio', 'wire'], mode: 'net', type: 'motor',
    ranges: { bio: { Ra: { lo: 80, hi: 120 }, gih: { on: false } }, morph: { types: { choices: ['pyramidal', 'granule'] } } } };
  const back = decodeHash(encodeHash(st));
  ok(JSON.stringify(back) === JSON.stringify(st), 'seeds, locks, mode and ranges round-trip through the hash: ' + encodeHash(st));
  ok(decodeHash('#purkinje').type === 'purkinje', 'an old cell-id hash still works');
  ok(JSON.stringify(decodeHash('')) === '{}', 'an empty hash is empty');
}

// ── 13. networks of full cells ────────────────────────────────────────
{
  const bio = defaults('bio'), morph = defaults('morph');
  const mk = (types, layout = 'line', o = {}) => new MultiNet({ specs: types.map((type, i) => ({ type, seed: 3 + i, morph, bio })), place: layoutPositions(types.length, layout, 4), seed: 9, ...o });
  // chain A -> B: delivery time, strong fires, weak does not
  const chain = wx => { const n = mk(['pyramidal', 'pyramidal']); const c = n.connect(0, 1, { ty: 'e', wx }); let on = NaN; n.kick(0); n.run(60, q => { if (isNaN(on) && c.syn.B - c.syn.A > 0) on = q.t; }); return { n, c, a: n.spikeTimes(0), b: n.spikeTimes(1), on }; };
  const S = chain(1.2), W = chain(0.5);
  ok(S.a.length === 1, 'A fires once from the kick');
  ok(Math.abs(S.on - S.n.cells[1].dt - (S.a[0] + S.c.delay)) <= S.n.cells[1].dt + 1e-9, `A's spike reaches B's synapse after the NetCon delay: ${(S.on - 0.025).toFixed(3)} vs ${(S.a[0] + S.c.delay).toFixed(3)} ms`);
  near(S.c.delay, SYN_DELAY + S.c.len / 300, 1e-9, 'delay = 0.5 ms + axon length / 0.3 m/s');
  ok(S.b.length >= 1 && S.b[0] > S.a[0] + S.c.delay, `B fires at 1.2x threshold weight: B at ${S.b[0] && S.b[0].toFixed(2)} ms`);
  ok(W.b.length === 0, 'B stays silent at 0.5x threshold weight');
  say(`chain: A spikes at ${S.a[0].toFixed(2)} ms, axon ${S.c.len.toFixed(0)} um, delay ${S.c.delay.toFixed(2)} ms, B spikes at ${S.b[0].toFixed(2)} ms (1.2x, ${(1.2 * THRESH_W.pyramidal * 1000).toFixed(1)} nS); 0.5x: B silent`);
  // inhibition: C inhibits B just before A's excitation lands
  const inh = withI => {
    const n = mk(['pyramidal', 'pyramidal', 'pyramidal']);
    n.connect(0, 1, { ty: 'e', wx: 1.2, delay: 4 });
    if (withI) n.connect(2, 1, { ty: 'i', wx: 3, delay: 2 });
    n.kick(0); n.kick(2); n.run(60);
    return n.spikeTimes(1);
  };
  const b0 = inh(false), b1 = inh(true);
  say(`inhibition: B fires at ${b0[0] && b0[0].toFixed(2)} ms from A alone; with C's GABA-like input 2 ms after C fires: ${b1.length ? b1[0].toFixed(2) + ' ms' : 'no spike'}`);
  ok(b0.length === 1 && (b1.length === 0 || b1[0] > b0[0] + 1), `an inhibitory synapse delays or blocks B: ${b0[0].toFixed(2)} ms without, ${b1.length ? b1[0].toFixed(2) + ' ms' : 'blocked'} with`);
  // a ring reverberates with enough weight, dies out without
  const ring = (wx, vel = 0.3) => { const n = mk(['pyramidal', 'pyramidal', 'pyramidal', 'pyramidal', 'pyramidal'], 'ring', { velocity: vel }); for (const c of wirePreset(5, 'ring').conns) n.connect(c.pre, c.post, { ty: 'e', wx }); n.kick(0); n.run(300); return n; };
  const r1 = ring(3), r0 = ring(0.4);
  const laps = Math.min(...[0, 1, 2, 3, 4].map(i => r1.spikeTimes(i).length));
  ok(laps >= 3, 'a 5-cell ring at 3x threshold weight keeps going: every cell fires ' + laps + '+ times in 300 ms');
  ok(r0.spikes.length / 2 === 1, 'at 0.4x the wave stops after the kicked cell: ' + r0.spikes.length / 2 + ' spike');
  const s0 = r1.spikeTimes(0);
  say(`ring of 5 at 3x: ${r1.spikes.length / 2} spikes in 300 ms, cell 0 at ${s0.slice(0, 4).map(t => t.toFixed(1)).join(', ')} ms (lap ${(s0[1] - s0[0]).toFixed(1)} ms)`);
  // budget: 12 random cells (desktop), 6 on a phone; finite and fast enough
  for (const [name, B, n] of [['desktop', BUDGET.desktop, 12], ['phone', BUDGET.phone, 6]]) {
    let worst = 0, over = 0, bad = 0, msPer = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const m = sample('morph', catSeed(seed, 'morph'), { branches: { lo: 1.4, hi: 1.6 }, depth: { lo: 1, hi: 1 } }), b = sample('bio', catSeed(seed, 'bio'));
      const specs = Array.from({ length: n }, (_, i) => ({ type: TYPES[i % 4], seed: seed * 50 + i, morph: morphFactors(m, i, seed), bio: b }));
      const net = new MultiNet({ specs, place: layoutPositions(n, 'cluster', seed), budget: B, seed });
      for (const c of wirePreset(n, 'random', { p: 0.3, seed }).conns) net.connect(c.pre, c.post, { ty: c.ty, wx: 1.5 });
      for (let i = 0; i < n; i += 3) net.kick(i);
      const c0 = process.cpuUsage(); net.run(40); const cu = process.cpuUsage(c0); msPer = Math.max(msPer, (cu.user + cu.system) / 1e3 / 40);
      worst = Math.max(worst, net.total); if (net.total > B.comps) over++;
      for (const c of net.cells) if (!c.v.every(Number.isFinite)) bad++;
    }
    ok(over === 0 && worst <= B.comps, `${name}: ${n} big random cells stay under ${B.comps} compartments (worst ${worst})`);
    ok(bad === 0, name + ': no NaN in a random multi-cell run');
    ok(msPer < 25, `${name}: ${msPer.toFixed(2)} ms of CPU per simulated ms (node), so 8 sim ms per s costs ${(msPer * 8 / 10).toFixed(1)}% of a core`);
    say(`${name}: ${n} cells, worst ${worst} compartments, ${msPer.toFixed(2)} CPU ms per sim ms`);
  }
  ok(chooseDlambda([{ S: makeCell('pyramidal', 1), Ra: 35.4, cm: 1 }], 1e9).dl === 0.03, 'one cell keeps the finest d_lambda');
  // presets
  const P8 = k => wirePreset(8, k, { p: 0.3, seed: 2, fracE: 0.75 });
  ok(P8('chain').conns.length === 7 && P8('ring').conns.length === 8 && P8('all').conns.length === 56, 'chain 7, ring 8, all-to-all 56 links for 8 cells');
  const ei = P8('ei');
  ok(ei.conns.every(c => c.ty === ei.sign[c.pre]) && ei.sign.filter(x => x === 'i').length === 2, "E/I preset obeys Dale's law (2 of 8 inhibitory)");
  ok([...Array(8).keys()].every(j => ei.conns.some(c => c.post === j && c.ty === 'e')), 'E/I: every cell has an E input');
  const ff = P8('ff'); ok(ff.conns.every(c => c.post > c.pre), 'feed-forward links only go forward');
  const lp = P8('loop'); ok(lp.sign[7] === 'i' && lp.conns.filter(c => c.pre === 7).length === 7, 'loop: one I cell inhibits the ring');
  ok(axonCurve([0, 0, 0], [300, 0, 0]).len > 300, 'a drawn axon is longer than the straight line');
  // the connectivity matrix through the hash
  const n8 = mk(['pyramidal', 'granule', 'purkinje', 'motor', 'pyramidal', 'pyramidal', 'granule', 'pyramidal'], 'layer');
  for (const c of ei.conns) n8.connect(c.pre, c.post, { ty: c.ty, wx: 1 + (c.pre % 3) * 0.37 });
  n8.connect(1, 3, { ty: 'e', wx: 1.1, delay: 3.3 });
  const st = { mode: 'net', net: { n: 8, layout: 'layer', vel: 0.3, types: n8.specs.map(s => s.type), conns: n8.conns.map(c => ({ pre: c.pre, post: c.post, ty: c.ty, w: c.w, sec: c.sec, x: c.x, d: c.fixed ?? undefined })) } };
  const back = decodeHash(encodeHash(st)).net;
  const re = mk(back.types, back.layout);
  for (const c of back.conns) re.connect(c.pre, c.post, { ty: c.ty, w: c.w, sec: c.sec, x: c.x, delay: c.d });
  ok(JSON.stringify(matrixOf(8, re.conns)) === JSON.stringify(matrixOf(8, n8.conns)), 'the connectivity matrix round-trips through the hash');
  ok(re.conns.every((c, i) => Math.abs(c.w - n8.conns[i].w) < 1e-5 && c.node === n8.conns[i].node && Math.abs(c.delay - n8.conns[i].delay) < 0.051), 'weights, synapse nodes and delays round-trip too');
  ok(JSON.stringify(decodeHash(encodeHash({ net: back })).net) === JSON.stringify(back), 'a second trip changes nothing');
  say(`hash for 8 cells, ${n8.conns.length} links: ${encodeHash(st).length} characters`);
}

// ── 14. network mode (netplan.js) ─────────────────────────────────────
{
  const bio = defaults('bio'), morph = null;
  const run = (net, ms, f) => { while (net.t < ms) { net.step(); if (f) f(net); } };
  // determinism by seed: same seeds, same spikes
  const mkR = () => buildNet({ wire: sample('wire', 41), morph: sample('morph', 7), bio: sample('bio', 5), seeds: { morph: 7, wire: 41 } });
  const a = mkR(), b = mkR(); a.kick(0); b.kick(0); run(a, 60); run(b, 60);
  ok(a.n === b.n && a.conns.length === b.conns.length && JSON.stringify(a.spikes) === JSON.stringify(b.spikes), `same seeds give the same network and spikes (${a.n} cells, ${a.conns.length} links, ${a.spikes.length / 2} spikes)`);
  ok(a.total <= BUDGET.desktop.comps, `random network fits the desktop budget: ${a.total} compartments`);
  const ph = buildNet({ wire: { ...sample('wire', 41), count: 12 }, morph: sample('morph', 7), bio, seeds: { morph: 7, wire: 41 }, phone: true });
  ok(ph.n <= BUDGET.phone.cells && ph.total <= BUDGET.phone.comps, `phone: ${ph.n} cells, ${ph.total} compartments`);
  // demos: the chain hands the spike to the last cell, in order
  const ch = buildNet({ wire: DEMOS.chain.wire, morph, bio, seeds: { wire: 3 } }), kc = kicker(DEMOS.chain.kick);
  run(ch, 60, kc);
  const first = [...Array(ch.n).keys()].map(i => ch.spikeTimes(i)[0]);
  ok(first.every(Number.isFinite) && first.every((t, i) => !i || t > first[i - 1]), 'chain demo: every cell fires, in order: ' + first.map(t => t.toFixed(1)).join(' '));
  // the delay between neighbours is at least the NetCon delay
  ok(ch.conns.every(c => first[c.post] - first[c.pre] >= c.delay - 0.05), 'chain demo: each hand-off takes at least its NetCon delay');
  // ring: one kick, the loop keeps going
  const rg = buildNet({ wire: DEMOS.ring.wire, morph, bio, seeds: { wire: 3 } }), kr = kicker(DEMOS.ring.kick);
  run(rg, 200, kr);
  ok(rg.spikeTimes(0).length >= 3, `ring demo: one kick, cell 0 fires ${rg.spikeTimes(0).length} times in 200 ms`);
  // inhibition: the same loop without the I cell's outputs fires more
  const mkL = cut => { const n = buildNet({ wire: DEMOS.inhibit.wire, morph, bio, seeds: { wire: 3 } }); if (cut) editLinks(n, n.conns.filter(c => c.ty === 'i'), { remove: true }); const k = kicker(DEMOS.inhibit.kick); run(n, 200, k); return n; };
  const withI = mkL(false), noI = mkL(true);
  const eSp = n => { let s = 0; for (let i = 0; i < n.n - 1; i++) s += n.spikeTimes(i).length; return s; };
  ok(withI.spikeTimes(withI.n - 1).length > 0 && eSp(withI) < eSp(noI), `inhibit demo: the I cell fires (${withI.spikeTimes(withI.n - 1).length}) and the E ring fires less with it (${eSp(withI)} vs ${eSp(noI)})`);
  // every demo builds and runs finite
  for (const [k, D] of Object.entries(DEMOS)) {
    const n = buildNet({ wire: D.wire, morph, bio, seeds: { wire: 5 } }), f = kicker(D.kick); let bad = 0;
    run(n, 40, f); for (const c of n.cells) for (let i = 0; i < c.n; i++) if (!Number.isFinite(c.v[i])) bad++;
    ok(bad === 0 && n.spikes.length > 0, `demo ${k}: ${n.n} cells, ${n.conns.length} links, ${n.spikes.length / 2} spikes, finite`);
  }
  // the matrix click cycles none -> E -> I -> none
  const m = buildNet({ wire: { ...DEMOS.chain.wire, count: 3, preset: 'chain' }, morph, bio, seeds: { wire: 2 } });
  const s1 = cycleLink(m, 2, 0), c1 = m.conns.find(c => c.pre === 2 && c.post === 0), w1 = wxOf(m, c1);
  const s2 = cycleLink(m, 2, 0), c2 = m.conns.find(c => c.pre === 2 && c.post === 0), w2 = wxOf(m, c2);
  const s3 = cycleLink(m, 2, 0);
  ok(s1 === 1 && s2 === -1 && s3 === 0 && c2.ty === 'i' && Math.abs(w1 - w2) < 1e-9 && !m.conns.some(c => c.pre === 2 && c.post === 0), 'matrix click: none -> E -> I (same multiple) -> none');
  ok(cycleLink(m, 1, 1) === 0 && !m.conns.some(c => c.pre === c.post), 'matrix click on the diagonal does nothing');
  // multi-select edit: one edit on many links
  const e8 = buildNet({ wire: { ...DEMOS.ei.wire }, morph, bio, seeds: { wire: 4 } });
  const sel = e8.conns.filter(c => c.pre < 3);
  editLinks(e8, sel, { ty: 'i', wx: 1.5, delay: 4 });
  ok(sel.length > 1 && sel.every(c => c.ty === 'i' && Math.abs(wxOf(e8, c) - 1.5) < 1e-9 && Math.abs(c.delay - 4) < 1e-9 && Math.abs(c.nc.delay - 4) < 1e-9), `multi-select edit sets type, weight and delay on ${sel.length} links`);
  editLinks(e8, sel, { delay: 'auto' });
  ok(sel.every(c => c.fixed == null && c.delay > 0.5 && Math.abs(c.delay - (0.5 + c.len / (e8.velocity * 1000))) < 1e-9), 'delay "auto" goes back to length over velocity');
  const before = e8.conns.length; editLinks(e8, sel, { remove: true });
  ok(e8.conns.length === before - sel.length, 'multi-select delete removes exactly the selection');
  // the network state through the hash, rebuilt, gives the same matrix and delays
  e8.move(2, [123, 0, -456]); e8.moved[2] = true;
  const st = { mode: 'net', net: netState(e8) }, back = decodeHash(encodeHash(st)).net;
  const re = buildNet({ wire: { ...DEMOS.ei.wire, layout: back.layout, count: back.n }, morph, bio, seeds: { wire: 4 }, types: back.types, conns: back.conns, place: back.pos, velocity: back.vel });
  ok(JSON.stringify(matrixOf(re.n, re.conns)) === JSON.stringify(matrixOf(e8.n, e8.conns)), 'network mode state round-trips through the hash (matrix)');
  ok(re.place[2].p[0] === 123 && re.place[2].p[2] === -456 && re.moved[2] && !re.moved[1], 'a moved cell keeps its place through the hash, the others stay on the layout');
  ok(re.conns.every((c, i) => Math.abs(c.delay - e8.conns[i].delay) < 0.051), 'delays round-trip');
  // spikes in flight: u runs 0 -> 1 over the axon part of the delay
  const c0 = ch.conns[0], fl = [];
  c0.flights.length = 0; c0.flights.push(10);
  const us = [10, 10 + (c0.delay - SYN_DELAY) / 2, 10 + c0.delay - SYN_DELAY].map(t => flightsOf(c0, t, fl)[0].u);
  ok(Math.abs(us[0]) < 1e-9 && Math.abs(us[1] - 0.5) < 1e-9 && Math.abs(us[2] - 1) < 1e-9, 'a spike in flight is at u 0, 0.5, 1 at the start, middle and end of the axon');
  const pe = pointOn(c0.pts, 1), q = c0.pts[c0.pts.length - 1];
  ok(Math.hypot(pe[0] - q[0], pe[1] - q[1], pe[2] - q[2]) < 1e-6, 'u = 1 is the synapse');
  const netShots = LAB_SHOTS.filter(q => q.net);
  ok(netShots.length === 4 && netShots.every(q => q.net === 'random' || DEMOS[q.net]), 'saver: four network shots, each a demo or the random circuit: ' + netShots.map(q => q.id).join(' '));
  say(`network mode: chain ${first.map(t => t.toFixed(1)).join(', ')} ms; ring cell 0 x${rg.spikeTimes(0).length}; inhibit E spikes ${eSp(withI)} vs ${eSp(noI)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
