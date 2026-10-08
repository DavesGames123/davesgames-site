// ============================================================================
//  FRQI QUANTUM IMAGE LAB  ·  tests.mjs — node stella-nova/pages/frqi-quantum-image-lab/tests.mjs
// ----------------------------------------------------------------------------
//  Checks frqi-core.js:
//    encode ...... cos²θ + sin²θ = 1 per pixel; the 2N probabilities sum to 1
//                  and each pixel pair holds 1/N
//    round trip .. exact probabilities decode back to the image (2×2, 4×4);
//                  sampled shots decode to a small mean error
//    sampler ..... the CDF search never returns a zero-probability outcome
//    timing ...... shotsAt is monotone and ends at the full shot count; a
//                  page run ends inside TARGET_MS; every flight ends inside
//                  the flight window and lands on its target cell; the saver
//                  finishes an image inside SAVER_TARGET_MS
//    phone ...... the 3D stack draws at <= 1.5x on a touch screen; the
//                 recon type is >= 12 px below 520 px
//  -v prints each passed check.
// ============================================================================
import { encodeFRQI, stateProbs, reconstruct, decodeP1, buildCdf, sampleCdf, shotsAt, runMs, PAGE_SAMPLE_MS, PAGE_FLIGHT_MS, TARGET_MS,
  flightWindow, flightU, flightPos, tapeCols, saverPlan, SAVER_TARGET_MS, glPixelRatio, reconTypeScale } from './frqi-core.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else if (process.argv.includes('-v')) console.log('ok  ', msg); };
const near = (a, b, e) => Math.abs(a - b) <= e;
const rng = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)(7);

// ── encode ──────────────────────────────────────────────────────────────────
const img4 = Float32Array.from([0, 17, 64, 100, 128, 150, 192, 200, 220, 235, 240, 250, 255, 5, 90, 33]);
const img2 = Float32Array.from([0, 255, 128, 64]);
for (const [name, img] of [['2x2', img2], ['4x4', img4]]) {
  const N = img.length, { a0, a1 } = encodeFRQI(img), p = stateProbs(a0, a1);
  let s = 0, pairOk = true, normOk = true;
  for (let i = 0; i < N; i++) { if (!near(a0[i] ** 2 + a1[i] ** 2, 1, 1e-12)) normOk = false; if (!near(p[i] + p[N + i], 1 / N, 1e-12)) pairOk = false; }
  for (const v of p) s += v;
  ok(normOk, `${name}: cos²θ + sin²θ = 1 for every pixel`);
  ok(near(s, 1, 1e-12), `${name}: probabilities sum to 1 (${s})`);
  ok(pairOk, `${name}: each pixel pair holds 1/N`);
  // exact round trip: the probabilities as counts
  const { vest } = reconstruct(p, N, 'frqi');
  let maxE = 0; for (let i = 0; i < N; i++) maxE = Math.max(maxE, Math.abs(vest[i] - img[i]));
  ok(maxE < 1e-6 * 255 + 1e-3, `${name}: exact encode -> decode round trip, max error ${maxE.toExponential(2)}`);
}
ok(near(decodeP1(Math.sin(1.2 * 0.5) ** 2), (1.2 * 0.5) / (Math.PI / 2) * 255, 1e-9), 'decodeP1 inverts sin²θ');
ok(near(decodeP1(0.25, 'linear'), 63.75, 1e-12), 'linear decode is 255·P₁');

// ── sampled round trip ─────────────────────────────────────────────────────
{
  const N = img4.length, { a0, a1 } = encodeFRQI(img4), p = stateProbs(a0, a1), cdf = buildCdf(p);
  const counts = new Float64Array(2 * N), SHOTS = 200000;
  let zeroHit = false;
  for (let k = 0; k < SHOTS; k++) { const o = sampleCdf(cdf, rng()); if (p[o] === 0) zeroHit = true; counts[o]++; }
  ok(!zeroHit, 'sampler never returns a zero-probability outcome');
  const { vest, per } = reconstruct(counts, N, 'frqi');
  let mae = 0, tot = 0; for (let i = 0; i < N; i++) { mae += Math.abs(vest[i] - img4[i]); tot += per[i]; }
  mae /= N;
  ok(tot === SHOTS, 'every shot lands on one pixel');
  ok(mae < 2, `4x4: ${SHOTS} shots decode with MAE ${mae.toFixed(3)} < 2`);
  console.log(`  sampled 4x4 round trip: ${SHOTS} shots, MAE ${mae.toFixed(3)}`);
}

// ── timing ─────────────────────────────────────────────────────────────────
{
  let mono = true, prev = 0;
  for (let t = 0; t <= PAGE_SAMPLE_MS + 50; t += 7) { const s = shotsAt(t, PAGE_SAMPLE_MS, 4000); if (s < prev) mono = false; prev = s; }
  ok(mono, 'shotsAt is monotone');
  ok(shotsAt(PAGE_SAMPLE_MS, PAGE_SAMPLE_MS, 4000) === 4000 && shotsAt(0, PAGE_SAMPLE_MS, 4000) === 0, 'shotsAt runs 0 -> all shots');
  const run = runMs(PAGE_SAMPLE_MS, PAGE_FLIGHT_MS);
  ok(run <= TARGET_MS, `page run ${run} ms <= target ${TARGET_MS} ms`);
  console.log(`  page run: sample ${PAGE_SAMPLE_MS} + flight ${PAGE_FLIGHT_MS} = ${run} ms (target ${TARGET_MS})`);
  for (const N of [4, 16, 64, 256, 1024]) {
    let maxT1 = 0, landed = true;
    for (let i = 0; i < N; i++) {
      const w = flightWindow(i, N, PAGE_FLIGHT_MS); maxT1 = Math.max(maxT1, w.t1);
      if (flightU(i, N, PAGE_FLIGHT_MS, PAGE_FLIGHT_MS) !== 1) landed = false;
    }
    ok(maxT1 <= PAGE_FLIGHT_MS + 1e-9, `N=${N}: last flight ends at ${maxT1.toFixed(1)} ms <= ${PAGE_FLIGHT_MS}`);
    ok(landed, `N=${N}: every cell has u = 1 at the end of the flight`);
    const side = Math.sqrt(N), tc = tapeCols(N, side);
    ok(tc >= 1 && tc <= N && (N <= 16 || tc !== side), `N=${N}: tape wraps at ${tc} cells, not the image width`);
  }
  const from = { x: 10, y: 200, s: 4 }, to = { x: 300, y: 20, s: 30 };
  const a = flightPos(0, from, to), b = flightPos(1, from, to), m = flightPos(0.5, from, to);
  ok(near(a.x, 10, 1e-9) && near(a.y, 200, 1e-9) && near(a.s, 4, 1e-9), 'flight starts on the tape cell');
  ok(near(b.x, 300, 1e-9) && near(b.y, 20, 1e-9) && near(b.s, 30, 1e-9), 'flight lands on the grid cell');
  ok(m.y < (from.y + to.y) / 2, 'flight bows up at mid-way');
  let worst = 0;
  for (const calm of [0, 0.5, 0.7, 1]) for (const layers of [2, 6, 12, 22, 40]) worst = Math.max(worst, saverPlan(calm, layers).finishMs);
  ok(worst <= SAVER_TARGET_MS, `saver finishes an image in <= ${worst} ms (target ${SAVER_TARGET_MS})`);
  console.log(`  saver: worst fade-in to finished image ${worst} ms (target ${SAVER_TARGET_MS})`);
}

// phone profile
{
  ok(glPixelRatio(3, true) === 1.5 && glPixelRatio(2, true) === 1.5 && glPixelRatio(1, true) === 1, 'touch stack: pixel ratio <= 1.5');
  ok(glPixelRatio(2, false) === 2 && glPixelRatio(3, false) === 2 && glPixelRatio(undefined, false) === 1, 'desktop stack: pixel ratio <= 2');
  const rows = [];
  for (const W of [328, 358, 390, 519, 520, 800]) { const fs = reconTypeScale(W); rows.push(`${W}px: ${(9 * fs).toFixed(1)}px`); ok(W < 520 ? 9 * fs >= 12 : fs === 1, `recon type at ${W}px`); }
  console.log('  recon title size ' + rows.join(', '));
  // a full-window phone stack: device px under 1.6 Mpx at 1.5x
  const px = Math.round(390 * glPixelRatio(3, true)) * Math.round(460 * glPixelRatio(3, true));
  ok(px < 1.6e6, `phone stack canvas ${(px / 1e6).toFixed(2)} Mpx`);
  console.log(`  phone stack 390x460 at 3x: ${(px / 1e6).toFixed(2)} Mpx (was ${((390 * 2) * (460 * 2) / 1e6).toFixed(2)} Mpx at 2x)`);
}

console.log(`${n - fail}/${n} checks passed`);
if (fail) process.exit(1);
