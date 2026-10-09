// String Lab engine tests. Run: node stella-nova/pages/string-lab/engine/tests.mjs
// Optional filter: node tests.mjs strings   (runs only groups whose name matches)
import {
  StringSim, modalFrequencies, modalDecay, pluckCoefficients, modalDisplacement,
  modalProject, viewStepper, hMin, paramsB,
} from './strings.js';
import { INSTRUMENTS, stringParams, fretPositionM, stoppedLength, midiToFreq, noteName } from './instruments.js';
import { magnitudeSpectrum, peakNear } from './fft.js';
import * as H from './harmonics.js';
import { renderModal, renderSim, renderKS, applyBody, BODY_MODES, peakingCoefs, strumOffsets, AudioEngine, createStubContext } from './audio.js';
import { parseMidi, writeMidi, notesFromMidi, songFromNotes, songInfo, Scheduler, mapFretting, isPlayable } from './midi.js';
import { CHORD_SHAPES, shapePitches, chordTones, pcOf, nameChord, findShape, PROGRESSIONS, STRUM_PATTERNS, strumEvents } from './chords.js';

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

// ── audio ──────────────────────────────────────────────────────────────────
group('audio: voices ring at the right pitch', () => {
  const fs = 44100;
  const inst = INSTRUMENTS.steel;
  for (const [i, fret] of [[0, 0], [1, 2], [5, 0], [3, 7]]) {
    const p = stringParams(inst, i, fret);
    const want = midiToFreq(inst.tuning[i] + fret);
    const m = renderModal(p, { seconds: 1, fs });
    const s = renderSim(p, { seconds: 0.6, fs });
    const k = renderKS(want, { seconds: 1, fs });
    const fm = peakNear(magnitudeSpectrum(m, fs, 1 << 18), want, 40).f;
    const fsim = peakNear(magnitudeSpectrum(s, fs, 1 << 18), want, 40).f;
    const fk = peakNear(magnitudeSpectrum(k, fs, 1 << 18), want, 40).f;
    console.log(`  ${noteName(inst.tuning[i] + fret)} want ${want.toFixed(2)}: modal ${cents(want, fm).toFixed(2)} c, sim ${cents(want, fsim).toFixed(2)} c, KS ${cents(want, fk).toFixed(2)} c`);
    ok(Math.abs(cents(want, fm)) < 2 && Math.abs(cents(want, fsim)) < 3 && Math.abs(cents(want, fk)) < 5, 'voice pitch');
    ok(m.every(Number.isFinite) && Math.max(...m.map(Math.abs)) <= 0.9001, 'modal normalised');
  }
  const v = renderSim(stringParams(INSTRUMENTS.violin, 2, 0), { seconds: 0.5, fs, bow: { pos: 0.09, vel: 0.15, force: 0.5 } });
  ok(v.every(Number.isFinite), 'bowed voice finite');
  const body = applyBody(renderModal(stringParams(inst, 0, 0), { seconds: 0.5, fs }), fs, BODY_MODES.steel);
  ok(body.every(Number.isFinite) && body.length === 22050, 'body filter');
  // the peaking filter boosts its centre frequency by gainDb
  const c = peakingCoefs(200, 4, 6, fs);
  const w = (2 * Math.PI * 200) / fs;
  const re = (z) => [Math.cos(z), -Math.sin(z)];
  const num = [c.b0 + c.b1 * re(w)[0] + c.b2 * re(2 * w)[0], c.b1 * re(w)[1] + c.b2 * re(2 * w)[1]];
  const den = [1 + c.a1 * re(w)[0] + c.a2 * re(2 * w)[0], c.a1 * re(w)[1] + c.a2 * re(2 * w)[1]];
  const gdb = 20 * Math.log10(Math.hypot(...num) / Math.hypot(...den));
  ok(Math.abs(gdb - 6) < 0.01, `peaking gain at centre ${gdb.toFixed(3)} dB`);
});

group('audio: strums, engine graph on a stub context', () => {
  const d = strumOffsets(6, { direction: 'down', spreadMs: 50 });
  const u = strumOffsets(6, { direction: 'up', spreadMs: 50 });
  ok(d[0] === 0 && Math.abs(d[5] - 0.05) < 1e-12 && u[5] === 0 && Math.abs(u[0] - 0.05) < 1e-12, 'strum order');
  let made = 0;
  const eng = new AudioEngine({ createContext: () => { made++; return createStubContext(); } });
  ok(!eng.started && made === 0, 'no context before start()');
  ok(eng.volume <= 0.15, 'volume low by default');
  eng.start();
  const ctx = eng.ctx;
  ok(made === 1 && ctx.log.nodes.some((n) => n.kind === 'gain'), 'master gain');
  const voices = eng.playChord({ instrument: 'steel', frets: [-1, 3, 2, 0, 1, 0], direction: 'down' });
  ok(voices.length === 5 && ctx.log.started.length === 5, 'chord makes 5 voices');
  const starts = ctx.log.started.map((x) => x[1]);
  ok(starts.every((t, i) => i === 0 || t >= starts[i - 1]), 'down strum starts low first');
  ok(ctx.log.nodes.filter((n) => n.kind === 'biquad').length === BODY_MODES.steel.length, 'body chain built once');
  eng.playNote({ instrument: 'steel', string: 1, fret: 5 });
  ok(ctx.log.stopped.length >= 1, 'a new note on a string releases the old one');
  eng.setMuted(true);
  ok(eng.master.gain.value === 0, 'mute');
  eng.setMuted(false);
  ok(Math.abs(eng.master.gain.value - eng.volume) < 1e-12, 'unmute');
  const listeners = {};
  const win = { addEventListener: (k, f) => (listeners[k] = f), removeEventListener() {} };
  eng.bindPagehide(win);
  listeners.pagehide();
  ok(eng.activeVoices === 0 && ctx.state === 'suspended', 'pagehide stops all and suspends');
  const ks = new AudioEngine({ createContext: () => createStubContext(), lowPower: true });
  ks.start();
  ks.playNote({ instrument: 'classical', string: 0, fret: 0 });
  ok(ks.method === 'ks' && ks.ctx.log.started.length === 1, 'low-power Karplus-Strong path');
  const vi = new AudioEngine({ createContext: () => createStubContext() });
  vi.start();
  vi.playNote({ instrument: 'violin', string: 3, fret: 2, method: 'sim' });
  ok(vi.ctx.log.started.length === 1, 'bowed violin voice');
});

// ── MIDI ───────────────────────────────────────────────────────────────────
// Ode to Joy (Beethoven, 1824, public domain), first phrase, in beats
const ODE = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62].map((m, i) => ({ t: i, dur: i === 12 ? 1.5 : i === 13 ? 0.5 : 1, midi: m, vel: 0.8 }));
ODE[13].t = 13.5; ODE[14].t = 14; ODE[14].dur = 2;

group('midi: write -> parse round trip (format 0 and 1, running status, tempo)', () => {
  const song = songFromNotes(ODE, { bpm: 100, name: 'Ode to Joy' });
  const bytes = writeMidi(song);
  const back = parseMidi(bytes);
  ok(back.format === 0 && back.division === 480 && back.tracks.length === 1, 'header');
  const notes = notesFromMidi(back);
  ok(notes.length === ODE.length, `note count ${notes.length}`);
  let maxErr = 0;
  notes.forEach((n, i) => {
    maxErr = Math.max(maxErr, Math.abs(n.t - ODE[i].t * 0.6), Math.abs(n.dur - ODE[i].dur * 0.6));
    ok(n.midi === ODE[i].midi, 'pitch ' + i);
  });
  ok(maxErr < 1e-9, `timing error ${maxErr}`);
  ok(songInfo(back).names[0] === 'Ode to Joy' && Math.abs(songInfo(back).bpm - 100) < 0.01, 'name and tempo');
  // running status: count status bytes; 15 note-ons + 15 note-offs on one channel
  // switch type 0x80/0x90, so fewer status bytes than events
  const statusBytes = [...bytes].filter((b) => b === 0x90 || b === 0x80).length;
  ok(statusBytes === 1, `running status used (${statusBytes} status bytes for 30 events)`);
  // byte-exact second round trip
  const again = writeMidi(back);
  ok(again.length === bytes.length && again.every((b, i) => b === bytes[i]), 'byte-exact re-write');
  // format 1, tempo change mid-song, note-on velocity 0 as note-off, sysex, pitch bend
  const f1 = {
    format: 1, division: 96, tracks: [
      [{ tick: 0, type: 'meta', metaType: 0x51, tempo: 500000 }, { tick: 192, type: 'meta', metaType: 0x51, tempo: 250000 }],
      [
        { tick: 0, type: 'sysex', status: 0xf0, data: Uint8Array.from([0x7e, 0x7f, 0x09, 0x01, 0xf7]) },
        { tick: 0, type: 'noteOn', ch: 2, note: 60, vel: 100 },
        { tick: 96, type: 'noteOn', ch: 2, note: 60, vel: 0 },
        { tick: 192, type: 'pitchBend', ch: 2, value: 9000 },
        { tick: 192, type: 'noteOn', ch: 2, note: 67, vel: 90 },
        { tick: 288, type: 'noteOff', ch: 2, note: 67, vel: 0 },
        { tick: 288, type: 'cc', ch: 2, controller: 64, value: 127 },
      ],
    ],
  };
  const p1 = parseMidi(writeMidi(f1));
  const n1 = notesFromMidi(p1);
  ok(p1.format === 1 && p1.tracks.length === 2, 'format 1');
  ok(n1.length === 2 && Math.abs(n1[0].dur - 0.5) < 1e-9 && Math.abs(n1[1].t - 1.0) < 1e-9 && Math.abs(n1[1].dur - 0.25) < 1e-9, 'tempo map ' + JSON.stringify(n1.map((n) => [n.t, n.dur])));
  ok(p1.tracks[1].some((e) => e.type === 'pitchBend' && e.value === 9000), 'pitch bend');
  ok(p1.tracks[1].some((e) => e.type === 'sysex' && e.data.length === 5), 'sysex');
  // hand-made bytes with running status across note-on/note-on
  const raw = Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 16,
    0x00, 0x90, 60, 100, 0x00, 64, 100, 0x60, 60, 0, 0x00, 64, 0, 0x00, 0xff, 0x2f, 0x00,
  ]);
  const nr = notesFromMidi(parseMidi(raw));
  ok(nr.length === 2 && nr.every((n) => Math.abs(n.dur - 0.5) < 1e-9), 'hand-made running-status file');
});

group('midi: scheduler play, pause, seek, tempo, step', () => {
  const notes = notesFromMidi(parseMidi(writeMidi(songFromNotes(ODE, { bpm: 60 }))));
  const sc = new Scheduler(notes);
  sc.play(0);
  ok(sc.due(0.5).length === 1, 'first note at t=0');
  ok(sc.due(2.05).length === 2, 'notes at 1 and 2');
  sc.pause(2.5);
  ok(sc.due(10).length === 0 && Math.abs(sc.position(10) - 2.5) < 1e-12, 'pause holds');
  sc.setTempoScale(0.5, 10);
  sc.play(10);
  ok(sc.due(10.98).length === 0 && sc.due(11.01).length === 1, 'half tempo: note at 3 s plays at wall 11');
  sc.seek(12.9, 20);
  ok(sc.due(20).length === 0 && sc.due(21.19).length === 0 && sc.due(21.21).length === 1, 'seek (13.5 s at half tempo)');
  const st = new Scheduler(notes);
  const g1 = st.stepNext(), g2 = st.stepNext();
  ok(g1[0].midi === 64 && g2[0].t === 1, 'step one note');
  const p = st.stepPrev();
  ok(p[0].t === 0, 'step back');
  const chordNotes = [{ t: 0, dur: 1, midi: 48 }, { t: 0.01, dur: 1, midi: 52 }, { t: 0.02, dur: 1, midi: 55 }, { t: 1, dur: 1, midi: 60 }];
  const sg = new Scheduler(chordNotes);
  ok(sg.stepNext().length === 3 && sg.stepNext().length === 1, 'step groups a chord');
  sc.seek(0, 30); sc.play(30);
  let n = 0; for (let t = 30; t < 70; t += 0.016) n += sc.due(t).length;
  ok(n === notes.length && sc.ended, 'all notes once, then ended');
});

group('midi: fretting mapper always gives playable positions', () => {
  let rng = 12345;
  const rand = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
  for (const inst of Object.values(INSTRUMENTS)) {
    let bad = 0, total = 0, shifted = 0, dropped = 0, moves = 0;
    for (let song = 0; song < 20; song++) {
      const groups = [];
      for (let g = 0; g < 60; g++) {
        const k = 1 + Math.floor(rand() * (inst.bowed ? 3 : 6));
        const base = 30 + Math.floor(rand() * 60);
        groups.push([...Array(k)].map(() => base + Math.floor(rand() * 20)));
      }
      const map = mapFretting(groups, inst);
      ok(map.length === groups.length, 'one entry per group');
      let last = null;
      for (const e of map) {
        total++;
        if (!isPlayable(e, inst)) bad++;
        shifted += e.notes.filter((n) => n.shifted).length;
        dropped += e.dropped.length;
        if (last != null && e.hand !== last) moves++;
        last = e.hand;
      }
    }
    console.log(`  ${inst.short}: ${total} random groups, ${bad} unplayable, ${shifted} octave-shifted, ${dropped} dropped, ${moves} hand moves`);
    ok(bad === 0, `${inst.key} playable`);
  }
  // a scale stays in one position; open strings are used
  const scale = [40, 42, 44, 45, 47, 49, 50, 52].map((m) => [m]);
  const ms = mapFretting(scale, INSTRUMENTS.steel);
  const maxF = Math.max(...ms.flatMap((e) => e.notes.map((n) => n.fret)));
  ok(maxF <= 4 && ms[0].notes[0].fret === 0, `E major scale low on the neck (max fret ${maxF})`);
  // a C chord voicing maps to a real shape
  const cm = mapFretting([[48, 52, 55, 60, 64]], INSTRUMENTS.steel)[0];
  ok(isPlayable(cm, INSTRUMENTS.steel) && cm.notes.length === 5, 'C chord mapped');
  // notes outside the range fold in
  const low = mapFretting([[28], [100]], INSTRUMENTS.violin);
  ok(low.every((e) => e.notes.length === 1 && e.notes[0].shifted), 'octave folding');
});

// ── chords ─────────────────────────────────────────────────────────────────
group('chords: every shape gives the named pitches', () => {
  for (const s of CHORD_SHAPES) {
    const pitches = shapePitches(s);
    const pcs = new Set(pitches.map((m) => m % 12));
    const tones = chordTones(s.root, s.quality);
    const five = (pcOf(s.root) + 7) % 12;
    const extra = [...pcs].filter((p) => !tones.includes(p));
    const missing = tones.filter((t) => !pcs.has(t) && t !== five);
    ok(extra.length === 0 && missing.length === 0, `${s.name}: extra ${extra} missing ${missing}`);
    ok(s.frets.length === 6 && s.fingers.length === 6, `${s.name} six strings`);
    const fr = s.frets.filter((f) => f > 0);
    ok(!fr.length || Math.max(...fr) - Math.min(...fr) <= 4, `${s.name} span`);
    ok(s.frets.every((f, i) => (f > 0) === (s.fingers[i] > 0)), `${s.name} fingers match frets`);
    const nm = nameChord(pitches);
    if (s.quality === 'major' || s.quality === 'minor' || s.quality === '7') ok(nm && nm.name === s.name, `nameChord(${s.name}) = ${nm && nm.name}`);
  }
  console.log(`  ${CHORD_SHAPES.length} shapes checked: ${CHORD_SHAPES.map((s) => s.name).join(' ')}`);
  ok(findShape('Bm').frets.join() === '-1,2,4,4,3,2', 'Bm barre');
  ok(findShape('F').frets.join() === '1,3,3,2,1,1', 'F barre');
  ok(findShape('Bb').frets.join() === '-1,1,3,3,3,1', 'Bb barre');
  for (const p of PROGRESSIONS) for (const c of p.chords) ok(!!findShape(c), `${p.name}: ${c}`);
  const ev = strumEvents(PROGRESSIONS[0], STRUM_PATTERNS[2]);
  ok(ev.length === 4 * 6 && ev[0].dir === 'D' && ev[0].chord === 'G', `strum events (${ev.length})`);
  const wz = strumEvents(PROGRESSIONS[7], STRUM_PATTERNS[5]);
  ok(wz.length === 12 && wz[3].t === 3, 'waltz events');
});

// ── harmonics ──────────────────────────────────────────────────────────────
group('harmonics: the page light touch leaves harmonic n alone (all strings, n 2..6)', () => {
  const amps = (s) => { const N = s.N, out = []; for (let m = 1; m <= 12; m++) { let b = 0, c = 0; for (let i = 1; i < N; i++) { const w = Math.sin(m * Math.PI * i / N); b += s.u[i] * w; c += s.v[i] * w; } out.push(Math.hypot(b, c / (2 * Math.PI * m * s.f1Stiff))); } return out; };
  const { strength, seconds } = H.HARMONIC_TOUCH;
  let worst = Infinity, where = '';
  for (const inst of Object.values(INSTRUMENTS)) for (let si = 0; si < inst.strings.length; si++) for (const n of [2, 3, 4, 5, 6]) {
    const s = new StringSim(stringParams(inst, si, 0));
    const pp = Math.abs(Math.sin(n * Math.PI * inst.pluckPos)) < 0.2 ? 0.13 : inst.pluckPos;   // as main.js excite('touch')
    s.pluck({ pos: pp, amp: 0.002, width: 0.02 });
    s.touch({ pos: 1 / n, strength, seconds });
    s.step(Math.ceil((seconds + 0.02) / s.k));
    const a = amps(s), other = Math.max(...a.filter((_, m) => (m + 1) % n)), r = a[n - 1] / other;
    if (r < worst) { worst = r; where = `${inst.label} ${inst.strings[si].name} n=${n}`; }
    ok(r > 10 && Number.isFinite(s.energy()), `${inst.label} ${inst.strings[si].name} touch 1/${n}: ${r.toFixed(1)}x`);
  }
  console.log(`  worst: ${worst.toFixed(1)}x at ${where}`);
});

group('harmonics: ratios, intervals, nodes, beats', () => {
  ok(H.ratioOf(3, 2).name === 'perfect fifth' && H.ratioOf(5, 4).name === 'major third', 'just names');
  ok(H.ratioOf(6, 4).num === 3 && H.ratioOf(6, 4).den === 2, 'reduce');
  ok(H.ratioOf(3, 1).folded === '3/2' && H.ratioOf(3, 1).octaves === 1, 'fold 3/1 into an octave');
  const fifth = H.INTERVALS.find((i) => i.name === 'perfect fifth');
  ok(Math.abs(fifth.diff - -1.955) < 0.01, `ET fifth is ${fifth.diff.toFixed(3)} c from 3/2`);
  const third = H.INTERVALS.find((i) => i.name === 'major third');
  ok(Math.abs(third.diff - 13.686) < 0.01, `ET major third +${third.diff.toFixed(3)} c`);
  ok(H.nodes(4).join() === '0.25,0.5,0.75' && H.antinodes(2).join() === '0.25,0.75', 'nodes');
  const hf = H.harmonicFrets(5).map((h) => h.fret.toFixed(2));
  ok(hf.includes('12.00') && hf.includes('7.02') && hf.includes('4.98') && hf.includes('3.86'), 'harmonic frets ' + hf.join(' '));
  // tuning by harmonics: 4th harmonic of E2 vs 3rd of A2 in equal temperament
  const hb = H.harmonicBeat(midiToFreq(40), 4, midiToFreq(45), 3);
  console.log(`  E2 h4 ${hb.fA.toFixed(2)} Hz vs A2 h3 ${hb.fB.toFixed(2)} Hz: beat ${hb.beat.toFixed(3)} Hz (${hb.cents.toFixed(2)} c)`);
  ok(Math.abs(hb.cents - 1.955) < 0.01, 'ET fourth beats against the harmonic');
  ok(H.beatFrequency(440, 442) === 2, 'beat');
  ok(Math.abs(H.harmonicSeries(100, 3, 1e-3)[2].f - 300 * Math.sqrt(1.009)) < 1e-9, 'stiff series');
});

// ── performance ────────────────────────────────────────────────────────────
group('perf: strings per frame at 60 fps', () => {
  const res = [];
  for (const [key, i] of [['steel', 0], ['steel', 5], ['classical', 0], ['violin', 3]]) {
    const sim = new StringSim(stringParams(INSTRUMENTS[key], i, 0));
    sim.pluck({ pos: 0.2, amp: 0.002 });
    sim.step(2000);
    const steps = 44100;
    const t0 = performance.now();
    sim.step(steps);
    const ms = performance.now() - t0;
    const perStepUs = (ms * 1000) / steps;
    // real-time audio-rate: 735 steps per string per frame; budget: half of 16.7 ms
    const rt = 8.33 / ((735 * perStepUs) / 1000);
    // slow motion 1/100: 7.35 steps per frame
    const slow = 8.33 / ((7.35 * perStepUs) / 1000);
    res.push({ key, s: INSTRUMENTS[key].strings[i].name, N: sim.N, perStepUs, rt, slow });
    console.log(`  ${key} ${INSTRUMENTS[key].strings[i].name} N=${sim.N}: ${perStepUs.toFixed(2)} us/step -> ${rt.toFixed(1)} strings/frame at real time, ${slow.toFixed(0)} at 1/100 (half-frame budget)`);
  }
  const t0 = performance.now();
  renderModal(stringParams(INSTRUMENTS.steel, 0, 0), { seconds: 2.6 });
  console.log(`  renderModal 2.6 s low E: ${(performance.now() - t0).toFixed(1)} ms`);
  globalThis.__perf = res;
  ok(res.every((r) => r.rt > 1), 'at least one string in real time');
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
