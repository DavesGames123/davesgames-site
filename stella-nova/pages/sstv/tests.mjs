// ============================================================================
//  SSTV  ·  node tests  (node tests.mjs)
// ----------------------------------------------------------------------------
//  Checks, with no browser:
//    1. mode timings: every line length against Barber (2000) and pysstv,
//       VIS codes against pysstv, total transmission times, and the
//       encoder's sample count against the table
//    2. VIS: encode and decode the header of every mode, with and
//       without a tuning error; a bad parity is refused
//    3. demodulator: pure tones come back to 0.5 Hz
//    4. round trip: encode -> decode PSNR per mode above a measured floor
//       with no noise, and PSNR falls as the SNR falls
//    5. slant: a sender clock error of +-0.5 % is measured back and the
//       picture is recovered; with the fit off it is not
//    6. WAV: header fields, round trip, 8-bit stereo parse
//    7. pysstv files: decode WAVs made by pysstv (optional: set
//       SSTV_PYSSTV_DIR to a folder of them, see the note at the end)
//    8. saver plan: kinds, lengths, no back-to-back repeats, seeds differ
//    9. main.js and every module link (a SyntaxError is a bug)
//  Exit code 1 on any failure.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as M from './modes.js';
import * as C from './codec.js';
import * as I from './images.js';
import { planShots, KINDS } from './plan.js';

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const FS = 11025;

// ---------------------------------------------------------------- 1 timings
// Line lengths (ms). spec: Barber, "Proposal for SSTV mode specifications"
// (Dayton 2000). pysstv: sum of (Hz, ms) per line from pysstv's classes,
// measured with pysstv master (2026-10) as (image ms - 30 ms stop bit) /
// lines: a script outside the repository printed the image totals.
const SPEC = { m1: 446.446, m2: 226.798, s1: 428.22, s2: 277.692, dx: 1050.3, r36: 150, r72: 300, pd90: 703.04, pd120: 508.48, pd160: 804.416, pd180: 754.24, pd240: 1000, pd290: 937.28 };
const PYSSTV = {
  m1: [114290.176, 44], m2: [58060.288, 40], s1: [109624.32, 60], s2: [71089.152, 56], dx: [268876.8, 76], r36: [36000, 8],
  p3: [203050, 113], p5: [304575, 114], p7: [406100, 0xf3 & 0x7f], pd90: [89989.12, 99], pd120: [126103.04, 95], pd160: [160883.2, 98],
  pd180: [187051.52, 96], pd240: [248000, 97], pd290: [288682.24, 94], sc2120: [121733.76, 63], sc2180: [182021.76, 55], r8: [8040, 2], r24: [24000, 10],
};
for (const m of M.MODES) {
  if (SPEC[m.id]) ok(near(m.lineMs, SPEC[m.id], 0.001), `${m.name} line ${m.lineMs} = spec ${SPEC[m.id]}`);
  const P = PYSSTV[m.id];
  if (P) {
    ok(near(m.lineMs, P[0] / m.lines, 0.001), `${m.name} line ${m.lineMs.toFixed(4)} = pysstv ${(P[0] / m.lines).toFixed(4)}`);
    ok(m.vis === P[1], `${m.name} VIS ${m.vis} = pysstv ${P[1]}`);
    ok(near(M.totalMs(m), 910 + P[0] + m.startMs, 1e-6), `${m.name} total = pysstv total + start sync`);
  } else ok(m.id === 'r72', `${m.name} has a pysstv reference or is Robot 72`);
  ok(m.H % m.rows === 0 && m.seq.filter(g => g.t === 'sync').length === 1, `${m.name} one sync per line`);
  ok(m.vis > 0 && m.vis < 128, `${m.name} VIS fits 7 bits`);
}
ok(new Set(M.MODES.map(m => m.vis)).size === M.MODES.length, 'VIS codes unique');
ok(M.VIS_MS.total === 910, 'VIS header 910 ms');
const img = (id) => M.lineMs(M.byId(id)) * M.byId(id).lines / 1000;
ok(near(img('m1'), 114.3, 0.1), `Martin M1 picture ${img('m1').toFixed(2)} s, about 114 s`);
ok(near(img('s1'), 109.6, 0.1), `Scottie S1 picture ${img('s1').toFixed(2)} s, about 110 s`);
ok(near(img('r36'), 36, 1e-9) && near(img('r72'), 72, 1e-9), 'Robot 36 and 72 take 36 and 72 s');
ok(near(img('pd120'), 126.1, 0.1) && near(img('pd180'), 187.1, 0.1), 'PD-120 and PD-180 pictures');
for (const id of ['m1', 'r36', 'pd90', 's2']) {
  const m = M.byId(id), x = C.encode(I.card('bars', m.W, m.H), m, FS);
  ok(Math.abs(x.length - M.totalMs(m) * FS / 1000) <= 1, `${m.name} encoder length ${x.length} = table ${(M.totalMs(m) * FS / 1000).toFixed(1)}`);
  const x2 = C.encode(I.card('bars', m.W, m.H), m, FS, { clock: 0.005 });
  ok(Math.abs(x2.length - M.totalMs(m) * 1.005 * FS / 1000) <= 1, `${m.name} clock +0.5 % stretches the file`);
}

// ---------------------------------------------------------------- 2 VIS
for (const m of M.MODES) {
  for (const shift of [0, 60, -45]) {
    const x = C.synth([[0, 50], ...C.visTones(m.vis), [1200, m.syncMs], [1500, 30]], FS, { shift });
    let got = null;
    const R = new C.Receiver({ fs: FS, onVis: (v) => { got = v; } });
    R.push(x); R.push(new Float32Array(2000));
    ok(got && got.code === m.vis && got.parity && got.mode === m.id, `VIS ${m.name} shift ${shift}: got ${got && got.code}`);
    if (shift && got) ok(near(got.afc, shift, 3), `AFC ${m.name} measures ${got.afc.toFixed(1)} Hz for ${shift}`);
  }
}
{
  const T = C.visTones(44); T[11] = [T[11][0] === 1100 ? 1300 : 1100, 30]; // flip parity
  let got = null;
  const R = new C.Receiver({ fs: FS, onVis: (v) => { got = v; } });
  R.push(C.synth([[0, 50], ...T, [1500, 60]], FS)); R.push(new Float32Array(2000));
  ok(got && !got.parity && R.state === 'vis', 'a bad parity bit is refused');
}

// ---------------------------------------------------------------- 3 demod
for (const f of [1100, 1200, 1500, 1900, 2300]) {
  for (const fs of [11025, 48000]) {
    const y = new C.Demod(fs).run(C.synth([[f, 300]], fs));
    let s = 0; const a = Math.round(fs * 0.05), b = Math.round(fs * 0.25);
    for (let i = a; i < b; i++) s += y[i];
    ok(near(s / (b - a), f, 0.5), `demod ${f} Hz at ${fs}: ${(s / (b - a)).toFixed(2)}`);
  }
}
{
  const z = C.zeroCross(C.synth([[1500, 200]], FS), FS, 220);
  ok(near(z[1500], 1500, 60), `zero-crossing estimate ${z[1500].toFixed(0)} near 1500`);
}

// ---------------------------------------------------------------- 4 round trip
const grey = (im) => { const p = C.planes(im), d = im.data.slice(); for (let i = 0; i < p.Y.length; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(p.Y[i]); return d; };
// Floors: measured PSNR (planet card, 11025 Hz, no noise, 2026-10-09)
// minus about 1.5 dB. Measured: m1 37.3, m2 38.4, s1 33.6, s2 37.5,
// dx 42.3, r8 35.5, r24 32.2, r36 28.5, r72 33.8, pd90 37.3, pd120 28.3,
// pd160 35.0, pd180 31.3, pd240 35.7, pd290 31.3, sc2120 36.3,
// sc2180 40.1, p3 27.7, p5 30.4, p7 34.9. Robot 36, PD-120 and P3 are
// lowest: chroma at half rate, or under 2 samples per pixel.
const FLOOR = { m1: 35.8, m2: 36.9, s1: 32.1, s2: 36, dx: 40.8, r8: 34, r24: 30.7, r36: 27, r72: 32.3, pd90: 35.8, pd120: 26.8, pd160: 33.5, pd180: 29.8, pd240: 34.2, pd290: 29.8, sc2120: 34.8, sc2180: 38.6, p3: 26.2, p5: 28.9, p7: 33.4 };
const measured = {};
for (const m of M.MODES) {
  const im = I.card('planet', m.W, m.H), ref = m.colour === 'BW' ? grey(im) : im.data;
  const R = C.decodeAll(C.encode(im, m, FS, { lead: 0.3, tail: 0.3 }), FS);
  const p = R.img ? C.psnr(ref, R.img) : 0;
  measured[m.id] = +p.toFixed(1);
  ok(R.mode === m && p >= FLOOR[m.id], `${m.name} round trip PSNR ${p.toFixed(2)} dB >= ${FLOOR[m.id]}`);
  ok(R.syncs.length === m.lines && R.syncs.every(s => s.ok), `${m.name} found all ${m.lines} syncs`);
}
console.log('round-trip PSNR (dB):', JSON.stringify(measured));
for (const id of ['m1', 'r36', 'pd90']) {
  const m = M.byId(id), im = I.card('planet', m.W, m.H), out = [];
  for (const snr of [40, 25, 15, 8, 3]) {
    const x = C.encode(im, m, FS, { lead: 0.3, tail: 0.3 }); C.channel(x, FS, { snr, seed: 11 });
    const R = C.decodeAll(x, FS, { mode: m, start: Math.round((0.3 + 0.91 + m.startMs / 1000) * FS) });
    out.push(C.psnr(im.data, R.img));
  }
  ok(out.every((v, i) => !i || v <= out[i - 1] + 0.3), `${m.name} PSNR falls with SNR: ${out.map(v => v.toFixed(1)).join(' > ')}`);
  ok(out[0] - out[4] > 10, `${m.name} 40 dB to 3 dB loses more than 10 dB`);
  console.log(`  ${m.name} PSNR at SNR 40/25/15/8/3 dB: ${out.map(v => v.toFixed(1)).join(' / ')}`);
}

// ---------------------------------------------------------------- 5 slant
for (const id of ['m1', 'r36', 's1', 'pd120']) {
  for (const clock of [0.005, -0.005]) {
    const m = M.byId(id), im = I.card('card', m.W, m.H);
    const x = C.encode(im, m, FS, { clock, lead: 0.3, tail: 0.5 });
    const Rs = C.decodeAll(x, FS, { slant: true }), Rn = C.decodeAll(x, FS, { slant: false });
    const est = Rs.clockError(), ps = C.psnr(im.data, Rs.img), pn = C.psnr(im.data, Rn.img);
    ok(near(est, clock, 0.0001), `${m.name} clock ${clock * 100} %: fit ${(est * 100).toFixed(4)} %`);
    ok(ps > pn + 8 && ps > FLOOR[id] - 9, `${m.name} clock ${clock * 100} %: PSNR fit ${ps.toFixed(1)} vs nominal ${pn.toFixed(1)}`);
    if (id === 'm1') console.log(`  Martin M1 clock ${clock * 100} %: fit ${(est * 100).toFixed(4)} %, PSNR with fit ${ps.toFixed(1)} dB, nominal ${pn.toFixed(1)} dB`);
  }
}

// ---------------------------------------------------------------- 6 WAV
{
  const x = C.synth([[1900, 50], [1200, 10]], FS);
  const b = C.wavBytes(x, FS), v = new DataView(b.buffer);
  const s = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  ok(s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE' && s(12, 4) === 'fmt ' && s(36, 4) === 'data', 'WAV chunk ids');
  ok(v.getUint32(4, true) === b.length - 8 && v.getUint32(40, true) === x.length * 2, 'WAV sizes');
  ok(v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === FS && v.getUint32(28, true) === FS * 2 && v.getUint16(32, true) === 2 && v.getUint16(34, true) === 16, 'WAV fmt: PCM mono 16-bit 11025 Hz');
  const w = C.parseWav(b);
  let e = 0; for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(w.samples[i] - x[i]));
  ok(w.fs === FS && w.samples.length === x.length && e < 1e-4, `WAV round trip, max error ${e.toExponential(2)}`);
  // 8-bit stereo
  const n = 100, B = new Uint8Array(44 + n * 2), d = new DataView(B.buffer);
  B.set([...'RIFF'].map(c => c.charCodeAt(0)), 0); d.setUint32(4, 36 + n * 2, true); B.set([...'WAVEfmt '].map(c => c.charCodeAt(0)), 8);
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true); d.setUint32(24, 8000, true); d.setUint32(28, 16000, true); d.setUint16(32, 2, true); d.setUint16(34, 8, true);
  B.set([...'data'].map(c => c.charCodeAt(0)), 36); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { B[44 + 2 * i] = 192; B[45 + 2 * i] = 64; }
  const w8 = C.parseWav(B);
  ok(w8.fs === 8000 && w8.channels === 2 && w8.samples.length === n && near(w8.samples[5], 0, 1e-6), '8-bit stereo WAV mixes to mono');
}

// ---------------------------------------------------------------- 7 pysstv
// Optional: WAVs that pysstv wrote from images.js cards (planet, at each
// mode's size). Make them with pysstv in a venv outside the repository:
//   for M in MartinM1 ScottieS1 PD90 Robot36 Robot8BW: M(Image.open(png), 11025, 16).write_wav(f'{M}-11025.wav')
//   and Robot36 at 48000 Hz. Then: SSTV_PYSSTV_DIR=<folder> node tests.mjs
// Scottie floor is lower: pysstv puts 2 x 1.5 ms between colour scans and
// shortens each scan to 136.74 ms, so its pixels sit up to 1.5 ms off the
// spec positions that our decoder uses.
const PDIR = process.env.SSTV_PYSSTV_DIR;
const PY = [['MartinM1-11025', 'm1', 35], ['ScottieS1-11025', 's1', 20], ['PD90-11025', 'pd90', 35], ['Robot36-11025', 'r36', 25], ['Robot36-48000', 'r36', 25], ['Robot8BW-11025', 'r8', 33]];
if (PDIR && existsSync(PDIR)) {
  for (const [f, id, floor] of PY) {
    const p = join(PDIR, f + '.wav');
    if (!existsSync(p)) { ok(false, `pysstv file ${p} missing`); continue; }
    const w = C.parseWav(readFileSync(p)), R = C.decodeAll(w.samples, w.fs);
    const m = M.byId(id), im = I.card('planet', m.W, m.H), ref = m.colour === 'BW' ? grey(im) : im.data;
    const ps = R.img ? C.psnr(ref, R.img) : 0;
    ok(R.mode === m && ps >= floor, `pysstv ${f}: mode ${R.mode && R.mode.id}, PSNR ${ps.toFixed(2)} dB >= ${floor}`);
    console.log(`  pysstv ${f}: ${w.fs} Hz ${w.bits}-bit, VIS ${R.vis && R.vis.code} -> ${R.mode && R.mode.name}, PSNR ${ps.toFixed(2)} dB, syncs ${R.syncs.filter(s => s.ok).length}/${m.lines}`);
  }
} else console.log('  pysstv files: skipped (set SSTV_PYSSTV_DIR)');

// ---------------------------------------------------------------- 8 saver plan
const kinds = Object.keys(KINDS);
const firsts = new Set();
for (let seed = 1; seed <= 40; seed++) {
  const P = planShots(seed, 30);
  firsts.add(P.slice(0, 6).map(s => `${s.kind}:${s.mode}:${s.card}`).join());
  ok(P.every(s => s.dur >= 6 && s.dur <= 12), `seed ${seed}: shots 6 to 12 s`);
  ok(P.every((s, i) => !i || s.kind !== P[i - 1].kind), `seed ${seed}: no kind twice in a row`);
  ok(P.every((s, i) => !i || s.card !== P[i - 1].card), `seed ${seed}: no picture twice in a row`);
  ok(P.every((s, i) => !i || s.phosphor !== P[i - 1].phosphor), `seed ${seed}: no phosphor twice in a row`);
  ok(P.every(s => KINDS[s.kind].modes.includes(s.mode) && M.byId(s.mode)), `seed ${seed}: modes exist`);
  ok(new Set(P.slice(0, kinds.length).map(s => s.kind)).size === kinds.length, `seed ${seed}: every kind in the first ${kinds.length}`);
}
ok(firsts.size === 40, `seeds give different orders (${firsts.size} of 40)`);

// ---------------------------------------------------------------- 9 link
for (const f of ['./figures.js', './crt.js', './session.js', './view.js', './saver.js', './main.js']) {
  if (!existsSync(new URL(f, import.meta.url))) { console.log(`  link ${f}: not in this tree yet`); continue; }
  try { await import(f); ok(true, f); }
  catch (e) { ok(!(e instanceof SyntaxError), `${f} links (${e.name}: ${e.message})`); }
}
{
  const m = M.byId('m2'), c = I.cardFor('card', m);
  ok(c.w === 160 && c.h === 256 && m.aspect === 1.25, 'Martin M2 card drawn at 320 x 256 and squeezed to 160');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
