// String Lab engine tests. Run: node stella-nova/pages/string-lab/engine/tests.mjs
// Optional filter: node tests.mjs strings   (runs only groups whose name matches)
import {
  StringSim, modalFrequencies, modalDecay, pluckCoefficients, modalDisplacement,
  modalProject, viewStepper, hMin, paramsB,
} from './strings.js';
import { INSTRUMENTS, stringParams, fretPositionM, stoppedLength, midiToFreq, noteName } from './instruments.js';
import { magnitudeSpectrum, peakNear } from './fft.js';
import * as H from './harmonics.js';

const filter = process.argv[2] || '';
let pass = 0, fail = 0;
const groups = [];
function group(name, fn) { groups.push([name, fn]); }
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL', msg); }
}
const cents = (a, b) => 1200 * Math.log2(b / a);

// ── strings ────────────────────────────────────────────────────────────────
group('strings: open-string pitch from the solver (FFT)', () => {
  const fs = 44100;
  for (const inst of Object.values(INSTRUMENTS)) {
    inst.strings.forEach((s, i) => {
      const p = stringParams(inst, i, 0, { fs, sigma0: 0, sigma1: 0 });
      const sim = new StringSim(p);
      sim.pluck({ pos: 0.137, amp: 0.001 });
      const n = Math.round(1.0 * fs);
      const sig = new Float64Array(n);
      for (let t = 0; t < n; t++) { sim.step(1); sig[t] = sim.bridgeForce(); }
      const spec = magnitudeSpectrum(sig, fs, 1 << 19);
      const ideal = (1 / (2 * p.L)) * Math.sqrt(p.T / p.mu);
      const pk = peakNear(spec, ideal, 60).f;
      const err = cents(ideal, pk);
      const stiff = cents(ideal, ideal * Math.sqrt(1 + sim.B));
      console.log(`  ${inst.short.padEnd(16)} ${s.name}  ideal ${ideal.toFixed(3)} Hz  sim ${pk.toFixed(3)} Hz  ${err >= 0 ? '+' : ''}${err.toFixed(3)} c  (stiff shift +${stiff.toFixed(3)} c, N=${sim.N})`);
      ok(Math.abs(err) < 2, `${inst.key} ${s.name} off by ${err.toFixed(2)} cents`);
    });
  }
});

group('strings: fretted pitch (stopped length) follows 12-TET', () => {
  const inst = INSTRUMENTS.steel, fs = 44100;
  for (const fret of [1, 5, 7, 12]) {
    const sim = new StringSim(stringParams(inst, 1, 0, { fs, sigma0: 0, sigma1: 0 }));
    sim.setLength(stoppedLength(inst.scaleM, fret));
    sim.pluck({ pos: 0.17, amp: 0.001 });
    const n = fs;
    const sig = new Float64Array(n);
    for (let t = 0; t < n; t++) { sim.step(1); sig[t] = sim.bridgeForce(); }
    const want = midiToFreq(inst.tuning[1] + fret);
    const pk = peakNear(magnitudeSpectrum(sig, fs, 1 << 19), want, 60).f;
    console.log(`  A string fret ${fret}: want ${want.toFixed(2)} got ${pk.toFixed(2)} (${cents(want, pk).toFixed(3)} c)`);
    ok(Math.abs(cents(want, pk)) < 2, `fret ${fret}`);
  }
});

group('strings: inharmonicity matches f_n = n f1 sqrt(1 + B n^2)', () => {
  // (1) exaggerated stiffness B = 2e-3: the sim must ring at the scheme's own
  // dispersion relation (code check), and near the continuous formula when
  // oversampled. (2) real steel B3 string at 44.1 kHz: partials 1..8.
  const run = (p, seconds) => {
    const sim = new StringSim(p);
    sim.pluck({ pos: 0.113, amp: 0.001 });
    const n = Math.round(seconds * p.fs), sig = new Float64Array(n);
    for (let t = 0; t < n; t++) { sim.step(1); sig[t] = sim.bridgeForce(); }
    return { sim, spec: magnitudeSpectrum(sig, p.fs, 1 << 20) };
  };
  const L = 0.65, T = 100, f1 = 110;
  const mu = T / (2 * L * f1) ** 2, c = Math.sqrt(T / mu);
  const B = 2e-3, kappa = (Math.sqrt(B) * c * L) / Math.PI;
  for (const fs of [44100, 176400]) {
    const p = { L, T, mu, kappa, sigma0: 0, sigma1: 0, fs };
    ok(Math.abs(paramsB(p) - B) < 1e-12, 'paramsB');
    const { sim, spec } = run(p, 1.5);
    const fm = modalFrequencies(p, 12);
    let worstScheme = 0, worstModal5 = 0;
    const row = [];
    for (const m of [1, 2, 3, 5, 8, 12]) {
      const pk = peakNear(spec, sim.schemeFrequency(m), 40).f;
      worstScheme = Math.max(worstScheme, Math.abs(cents(sim.schemeFrequency(m), pk)));
      const e = cents(fm[m - 1], pk);
      if (m <= 5) worstModal5 = Math.max(worstModal5, Math.abs(e));
      row.push(`n${m} ${pk.toFixed(1)}Hz (modal ${fm[m - 1].toFixed(1)}, +${cents(m * f1, fm[m - 1]).toFixed(0)}c stretch) ${e.toFixed(2)}c`);
    }
    console.log(`  B=2e-3 fs=${fs} N=${sim.N}: ${row.join(' | ')}`);
    console.log(`    vs scheme dispersion: worst ${worstScheme.toFixed(3)} c; vs continuous n<=5: worst ${worstModal5.toFixed(2)} c`);
    ok(worstScheme < 0.3, `scheme dispersion fs ${fs}`);
    if (fs > 44100) ok(worstModal5 < 2, `continuous formula n<=5 at fs ${fs}`);
  }
  const inst = INSTRUMENTS.steel;
  const p = stringParams(inst, 4, 0, { fs: 44100, sigma0: 0, sigma1: 0 });
  const { sim, spec } = run(p, 1.5);
  const fm = modalFrequencies(p, 8);
  let worst = 0;
  for (let m = 1; m <= 8; m++) worst = Math.max(worst, Math.abs(cents(fm[m - 1], peakNear(spec, fm[m - 1], 30).f)));
  console.log(`  steel B3 (B=${sim.B.toExponential(2)}) at 44.1 kHz: partials 1..8 within ${worst.toFixed(2)} c of the modal formula`);
  ok(worst < 2, 'real string partials');
});

group('strings: energy conserved without damping, decays with damping', () => {
  const inst = INSTRUMENTS.steel;
  const sim = new StringSim(stringParams(inst, 3, 0, { sigma0: 0, sigma1: 0 }));
  sim.pluck({ pos: 0.2, amp: 0.002 });
  sim.step(1);
  const e0 = sim.energy();
  let maxDev = 0;
  for (let i = 0; i < 200; i++) { sim.step(220); maxDev = Math.max(maxDev, Math.abs(sim.energy() - e0) / e0); }
  console.log(`  lossless: E0 = ${e0.toExponential(4)} J, max relative drift over 1 s = ${maxDev.toExponential(2)}`);
  ok(maxDev < 1e-9, 'energy drift');
  const d = new StringSim(stringParams(inst, 3, 0));
  d.pluck({ pos: 0.2, amp: 0.002 });
  d.step(1);
  let prev = d.energy(), mono = true;
  const first = prev;
  for (let i = 0; i < 100; i++) { d.step(441); const e = d.energy(); if (e > prev * (1 + 1e-12)) mono = false; prev = e; }
  console.log(`  damped: E(0) = ${first.toExponential(3)} J, E(1 s) = ${prev.toExponential(3)} J, monotone = ${mono}`);
  ok(mono && prev < first * 0.5, 'damped energy should fall monotonically');
});

group('strings: pluck at 1/n removes harmonic n (modal projection and FFT)', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const p = { L: 0.65, T: 70, mu: 70 / (2 * 0.65 * 110) ** 2, kappa: 0, sigma0: 0, sigma1: 0, N: 120 };
    const sim = new StringSim(p);
    sim.pluck({ pos: 1 / n, amp: 0.001 });
    const a = modalProject(sim.u, 12);
    const ref = Math.abs(a[0]);
    const rel = Math.abs(a[n - 1]) / ref;
    ok(rel < 1e-12, `pluck 1/${n}: mode ${n} rel ${rel}`);
    // the same through time: a bridge-force spectrum
    const fs = 44100, len = fs / 2, sig = new Float64Array(len);
    const sim2 = new StringSim({ ...p, fs });
    sim2.pluck({ pos: 1 / n, amp: 0.001 });
    for (let t = 0; t < len; t++) { sim2.step(1); sig[t] = sim2.bridgeForce(); }
    const spec = magnitudeSpectrum(sig, fs, 1 << 18);
    const f1 = sim2.f1;
    const hn = peakNear(spec, n * f1, 10).mag, hn1 = peakNear(spec, (n + 1) * f1, 10).mag;
    console.log(`  pluck at 1/${n}: mode ${n}/mode 1 = ${rel.toExponential(1)} (projection), FFT |H${n}|/|H${n + 1}| = ${(hn / hn1).toExponential(2)}`);
    ok(hn / hn1 < 0.05, `fft pluck 1/${n}`);
    ok(H.suppressedHarmonics(1 / n, 12).includes(n), `harmonics.js lists ${n}`);
  }
  const sp = H.pluckSpectrum(0.2, 10);
  ok(sp[4] < 1e-12 && sp[9] < 1e-12, 'pluckSpectrum at 1/5 removes 5 and 10');
});

group('strings: acceleration field = c^2 u_xx - kappa^2 u_xxxx + damping', () => {
  const inst = INSTRUMENTS.classical;
  const sim = new StringSim(stringParams(inst, 4, 0, {}));
  sim.pluck({ pos: 0.23, amp: 0.002, width: 0.02 });
  sim.step(337);
  let maxA = 0, maxRes = 0, maxRes2 = 0;
  const N = sim.N, h = sim.h, c2 = sim.c * sim.c;
  for (let i = 1; i < N; i++) {
    maxA = Math.max(maxA, Math.abs(sim.a[i]));
    maxRes = Math.max(maxRes, Math.abs(sim.aBow[i]));
    // independent check from the public u only: tension part
    const uxx = (sim.u[i + 1] - 2 * sim.u[i] + sim.u[i - 1]) / (h * h);
    maxRes2 = Math.max(maxRes2, Math.abs(c2 * uxx - sim.aTension[i]));
  }
  console.log(`  max |a| = ${maxA.toExponential(3)} m/s^2, max |a - (tension + stiffness + damping)| = ${maxRes.toExponential(2)}, tension check ${maxRes2.toExponential(2)}`);
  ok(maxRes < 1e-9 * maxA, 'acceleration residual');
  ok(maxRes2 < 1e-9 * maxA, 'tension part');
  // damping is on: its part must be non-zero and opposite to velocity on average
  let dot = 0;
  for (let i = 1; i < N; i++) dot += sim.aDamp[i] * sim.v[i];
  ok(dot < 0, 'damping force opposes motion');
});

group('strings: simulation tracks the exact modal solution', () => {
  const p = { L: 0.65, T: 70, mu: 70 / (2 * 0.65 * 110) ** 2, kappa: 0, sigma0: 0, sigma1: 0, fs: 44100 };
  const sim = new StringSim(p);
  sim.pluck({ pos: 0.3, amp: 0.001 });
  const coefs = pluckCoefficients(0.3, 0.001, 400);
  const steps = 1000;
  sim.step(steps);
  // mid level is one step behind the newest: time = (steps - 1) k after the start level
  const t = (steps - 1) * sim.k;
  let err = 0, mx = 0;
  for (let i = 0; i <= sim.N; i += 3) {
    const m = modalDisplacement(p, coefs, i / sim.N, t);
    err = Math.max(err, Math.abs(m - sim.u[i]));
    mx = Math.max(mx, Math.abs(m));
  }
  console.log(`  after ${steps} steps: max |u_sim - u_modal| = ${(err / mx * 100).toFixed(2)} % of max |u|`);
  ok(err / mx < 0.05, 'modal agreement');
  const dec = modalDecay({ ...p, sigma0: 1, sigma1: 0.001 }, 3);
  ok(Math.abs(dec[1] - (1 + 0.001 * (2 * Math.PI / 0.65) ** 2)) < 1e-12, 'modal decay formula');
});

group('strings: touch at a node keeps that harmonic (natural harmonic)', () => {
  const p = { L: 0.65, T: 70, mu: 70 / (2 * 0.65 * 110) ** 2, kappa: 0, sigma0: 0, sigma1: 0, N: 120 };
  for (const n of [2, 3, 4]) {
    const sim = new StringSim(p);
    sim.pluck({ pos: 0.13, amp: 0.002 });
    sim.touch({ pos: 1 / n, seconds: 0.25 });
    sim.step(Math.round(0.3 * 44100));
    // energy per mode from u and v
    const a = modalProject(sim.u, 8), b = modalProject(sim.v, 8);
    const en = a.map((x, i) => x * x + (b[i] / (2 * Math.PI * (i + 1) * sim.f1)) ** 2);
    const tot = en.reduce((s, x) => s + x, 0);
    const share = en[n - 1] / tot;
    console.log(`  touch 1/${n}: mode 1 share ${(en[0] / tot).toExponential(1)}, mode ${n} share ${share.toFixed(3)}`);
    ok(en[0] / tot < 1e-3 && share > 0.3, `touch 1/${n}`);
  }
});

group('strings: bowing gives a sustained Helmholtz-like motion near f1', () => {
  const inst = INSTRUMENTS.violin, fs = 44100;
  const sim = new StringSim(stringParams(inst, 2, 0, { fs }));
  sim.bow({ pos: 0.09, vel: 0.15, force: 0.5, a: 100 });
  const n = fs, sig = new Float64Array(n);
  for (let t = 0; t < n; t++) { sim.step(1); sig[t] = sim.bridgeForce(); }
  const tail = sig.subarray(n / 2);
  let rms = 0; for (const x of tail) rms += x * x; rms = Math.sqrt(rms / tail.length);
  const spec = magnitudeSpectrum(tail, fs, 1 << 18);
  const pk = peakNear(spec, sim.f1, 80).f;
  console.log(`  bowed A4: steady rms bridge force ${rms.toFixed(4)} N, pitch ${pk.toFixed(2)} Hz vs ${sim.f1.toFixed(2)} (${cents(sim.f1, pk).toFixed(1)} c)`);
  ok(rms > 1e-3 && Number.isFinite(rms), 'bow sustains');
  ok(Math.abs(cents(sim.f1, pk)) < 25, 'bow pitch');
});

group('strings: stability bound, grid and view clock', () => {
  for (const inst of Object.values(INSTRUMENTS)) {
    inst.strings.forEach((s, i) => {
      const sim = new StringSim(stringParams(inst, i, 0));
      ok(sim.h >= hMin(sim.c, sim.kappa, sim.sigma1, sim.k) - 1e-15, `${inst.key} ${s.name} h >= hMin`);
      sim.pluck({ pos: 0.2, amp: 0.003 });
      sim.step(20000);
      ok(sim.u.every(Number.isFinite) && Math.max(...sim.u.map(Math.abs)) < 0.01, `${inst.key} ${s.name} bounded`);
    });
  }
  const vs = viewStepper({ timeScale: 0.01, k: 1 / 44100 });
  let tot = 0;
  for (let i = 0; i < 60; i++) tot += vs.advance(1 / 60);
  ok(Math.abs(tot - 441) <= 1, `view clock 1/100 gives 441 steps per wall second (got ${tot})`);
});

// ── instruments ────────────────────────────────────────────────────────────
group('instruments: numbers in a sensible range', () => {
  for (const inst of Object.values(INSTRUMENTS)) {
    for (const s of inst.strings) {
      ok(s.T > 30 && s.T < 200, `${inst.key} ${s.name} tension ${s.T}`);
      ok(s.mu > 1e-4 && s.mu < 2e-2, `${inst.key} ${s.name} mu ${s.mu}`);
      ok(s.B > 1e-7 && s.B < 1e-3, `${inst.key} ${s.name} B ${s.B}`);
      ok(s.sigma0 >= 0 && s.sigma1 >= 0, `${inst.key} ${s.name} damping`);
      ok(noteName(s.midi) === s.name, `${inst.key} name ${s.name}`);
    }
    const r = inst.strings.map((s) => `${s.name} T=${s.T.toFixed(0)}N mu=${(s.mu * 1e3).toFixed(2)}g/m B=${s.B.toExponential(1)}`);
    console.log(`  ${inst.short}: ${r.join(' | ')}`);
  }
  ok(Math.abs(fretPositionM(0.65, 12) - 0.325) < 1e-12, '12th fret at half length');
  ok(Math.abs(INSTRUMENTS.steel.scaleM - 0.64516) < 1e-6, 'steel scale 25.4 in');
});

// ── run ────────────────────────────────────────────────────────────────────
const extra = globalThis.__stringLabExtraGroups || [];
const t0 = performance.now();
for (const [name, fn] of [...groups, ...extra]) {
  if (filter && !name.includes(filter)) continue;
  console.log(name);
  const t = performance.now();
  try { await fn(); } catch (e) { fail++; console.log('  FAIL (threw)', e.stack); }
  console.log(`  (${(performance.now() - t).toFixed(0)} ms)`);
}
console.log(`\n${pass} passed, ${fail} failed, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fail ? 1 : 0);
