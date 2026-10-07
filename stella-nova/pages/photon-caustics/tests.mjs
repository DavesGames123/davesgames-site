// ============================================================================
//  PHOTON CAUSTICS 2D  ·  tests.mjs — node tests of optics2d.js (no DOM)
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/photon-caustics/tests.mjs
//  1. white light: the spectrum averages to 1, 1, 1 over 400..700 nm.
//  2. Fresnel: R0 = ((n-1)/(n+1))^2 at normal incidence, 1 past critical.
//  3. Snell: n1 sin(a1) = n2 sin(a2) for refract().
//  4. the cup: a paraxial ray off the round mirror crosses the axis at R/2.
//  5. the ball: paraxial rays focus at f = nR / (2(n - 1)) from the centre.
//  6. the prism: deviation at 50 deg incidence matches the prism formula.
//  7. the pool: flat water lights the floor evenly; waves make caustics
//     (bins with more than twice the mean irradiance).
//  8. the lens body: a ray along the axis enters at the flat face.
//  9. the lens: rays near the edge cross the axis before paraxial rays
//     (spherical aberration, the cause of the caustic cusp).
// 10. time of flight: a photon goes the light distance D in air and D/n in
//     water; a beam pulse starts as a flat wave front.
// 11. pool cross-section: Snell's law at the wavy surface, with the normal
//     from h'(x), for a slant sun; the lamp past the critical angle
//     reflects (TIR).
// 12. pool cross-section, one sine wave h = A sin(k x), sun overhead: the
//     floor caustics (the folds of the ray map X(x)) are where the small-
//     angle theory puts them: sin(k x) = 1/g, g = (1 - 1/n) d A k^2,
//     X = x + (1 - 1/n) d A k cos(k x).
// 13. pool bottom, from above, one sine wave at 30 deg, sun overhead: the
//     density of the refracted rays along the wave direction (CPU splat)
//     against the 1D closed form E = 1 / |1 + (1 - 1/n) d h''(x)| at
//     X = x + (1 - 1/n) d h'(x); no move at right angles to the wave.
// 14. pool bottom, energy: with wrap, the splat keeps all the power; with
//     mixed waves and a slant sun, the mean light on a floor patch is the
//     light of flat water (the waves move light, they do not make it).
// ============================================================================
import { topWaves, sunDir, floorHit, splatFloor, shift0 } from './topdown.js';
import { spectrum, fresnel, refract, indexAt, makeScene, trace, outline, mulberry, emitPulse, advance, mediumAt, waterHeight } from './optics2d.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const always = () => 0.9999;   // rand() >= R: a dielectric always refracts

// 1
{
  const m = [0, 0, 0];
  for (let l = 400; l <= 700; l++) { const c = spectrum(l); for (let k = 0; k < 3; k++) m[k] += c[k] / 301; }
  ok(m.every(v => near(v, 1, 0.01)), `spectrum mean ${m.map(v => v.toFixed(3))}`);
  ok(spectrum(450)[2] > spectrum(450)[0] && spectrum(650)[0] > spectrum(650)[2], 'spectrum: 450 nm blue, 650 nm red');
  ok(near(indexAt(1.5, 0.02, 400) - indexAt(1.5, 0.02, 700), 0.02, 1e-9) && near(indexAt(1.5, 0.02, 589.3), 1.5, 1e-12), 'Cauchy index split');
}
// 2
ok(near(fresnel(1, 1, 1.5), 0.04, 1e-9), 'Fresnel R0 at n = 1.5');
ok(fresnel(Math.cos(45 * Math.PI / 180), 1.5, 1) === 1, 'TIR at 45 deg from n = 1.5');
ok(fresnel(Math.cos(40 * Math.PI / 180), 1.5, 1) < 1, 'no TIR at 40 deg from n = 1.5');
// 3
for (const [a1, n1, n2] of [[0.3, 1, 1.5], [0.7, 1, 1.333], [0.5, 1.5, 1]]) {
  const d = [Math.sin(a1), -Math.cos(a1)], t = refract(d[0], d[1], 0, 1, n1 / n2);
  ok(near(n1 * Math.sin(a1), n2 * Math.abs(t[0]) / Math.hypot(t[0], t[1]), 1e-9), `Snell at ${a1}`);
}
// helper: trace a thin beam at offset y, return where the last segment
// that leaves the body crosses y = 0
function axisCross(scene, y, segIndex) {
  scene.light = { ...scene.light, y, width: 1e-6 };
  const out = new Float32Array(7 * 16), ns = trace(scene, 1, always, out, { mono: 589.3 });
  const k = (segIndex < 0 ? ns + segIndex : segIndex) * 7;
  const [x0, y0, x1, y1] = out.slice(k, k + 4);
  return x0 + (x1 - x0) * (0 - y0) / (y1 - y0);
}
// 4
{
  const s = makeScene('cup', { n: 1.5, dn: 0, ang: 0 });
  ok(near(axisCross(s, 0.02, 1), 0.5, 0.002), 'cup: paraxial focus at R/2');
}
// 5
{
  const nW = 1.333, s = makeScene('drop', { n: nW, dn: 0, ang: 0 });
  const x = axisCross(s, 0.01, 2), f = nW * 0.6 / (2 * (nW - 1));
  ok(near(x, f, 0.01), `drop: focus ${x.toFixed(4)} vs ${f.toFixed(4)}`);
}
// 6
{
  const s = makeScene('prism', { n: 1.5, dn: 0, ang: 0 });
  s.light.width = 1e-6;
  const out = new Float32Array(7 * 16); trace(s, 1, always, out, { mono: 589.3 });
  const a = Math.atan2(out[3 * 7 - 4] - out[3 * 7 - 6], out[3 * 7 - 5] - out[3 * 7 - 7]) * 180 / Math.PI;
  // incidence 50 deg on a 60 deg prism, n = 1.5
  const r1 = Math.asin(Math.sin(50 * Math.PI / 180) / 1.5), e = Math.asin(1.5 * Math.sin(Math.PI / 3 - r1));
  const D = 50 + e * 180 / Math.PI - 60;
  ok(near(20 - a, D, 0.05), `prism deviation ${(20 - a).toFixed(3)} vs ${D.toFixed(3)}`);
}
// 7
{
  const stats = wave => {
    const s = makeScene('pool', { n: 1.333, dn: 0, ang: 0, wave, t: 3 });
    s.detector.bins = new Float32Array(64);
    const out = new Float32Array(7 * 20000 * 9);
    trace(s, 20000, mulberry(7), out, {});
    const b = Array.from(s.detector.bins.slice(4, 60)), mean = b.reduce((p, v) => p + v, 0) / b.length;
    return { mean, max: Math.max(...b), min: Math.min(...b) };
  };
  const flat = stats(0), wavy = stats(1);
  ok(flat.max / flat.mean < 1.25 && flat.min / flat.mean > 0.75, `pool flat: even floor ${flat.min.toFixed(1)}..${flat.max.toFixed(1)} mean ${flat.mean.toFixed(1)}`);
  ok(wavy.max / wavy.mean > 2, `pool waves: caustic peak ${(wavy.max / wavy.mean).toFixed(2)} x mean`);
  ok(near(wavy.mean, flat.mean, 0.1 * flat.mean), 'pool: waves move light, they do not make it');
}
// 8
{
  const s = makeScene('lens', { n: 1.5, dn: 0, ang: 0 });
  s.light.width = 1e-6;
  const out = new Float32Array(7 * 16); trace(s, 1, always, out, { mono: 589.3 });
  ok(near(out[2], -0.15, 1e-6), `lens: enters at x = ${out[2]}`);
  const o = outline(s);
  ok(o.fills.length === 1 && o.fills[0].tris.length === 160 * 6, 'lens outline: one fan of 160 triangles');
}
// 9
{
  const s = makeScene('lens', { n: 1.5, dn: 0, ang: 0 });
  const xp = axisCross(s, 0.01, -1), xe = axisCross(s, 0.4, -1);
  ok(xe < xp - 0.1, `lens: edge focus ${xe.toFixed(3)} before paraxial ${xp.toFixed(3)}`);
}

// 10
{
  const nW = 1.333, s = makeScene('pool', { n: nW, dn: 0, ang: 0, wave: 0, t: 0 });
  const [ph] = emitPulse(s, 1, () => 0.5, { mono: 589.3 });
  const top = s.view.cy + s.view.h / 2;
  ok(near(ph.x, 0, 1e-9) && near(ph.y, top, 1e-9) && ph.n === 1 && ph.wait === 0, `flight: one photon from the view top at y = ${ph.y.toFixed(3)}`);
  const air = ph.y - 0.35;
  let D = 0;
  for (let i = 0; i < 20; i++) { advance(s, ph, 0.1, always); D += 0.1; }
  const want = 0.35 - (D - air) / nW;
  // tolerance 1e-4: advance steps 1e-5 off a surface after each event
  ok(near(ph.y, want, 1e-4) && near(ph.x, 0, 1e-9), `flight: y after D = 2 is ${ph.y.toFixed(5)}, D/n in water gives ${want.toFixed(5)}`);
  ok(near(ph.L, D, 1e-4) && near(ph.n, nW, 1e-12), `flight: clock L = ${ph.L.toFixed(6)}, n = ${ph.n}`);
  ok(mediumAt(s, 0, 0, 589.3) === nW && mediumAt(s, 0, 0.5, 589.3) === 1, 'flight: medium below and above the water');
  // the same light time in air only goes n times further
  const [q] = emitPulse(s, 1, () => 0.5, { mono: 589.3 }), y0 = q.y;
  advance(s, q, 0.3, always);
  ok(near(y0 - q.y, 0.3, 1e-9), 'flight: D in air');
  // a slant beam: the pulse is a flat front across the beam
  const t = makeScene('lens', { n: 1.5, dn: 0, ang: 20 });
  const P = emitPulse(t, 9, mulberry(3), { mono: 589.3 });
  for (const p of P) advance(t, p, 0.3, always);
  const dir = [Math.cos(20 * Math.PI / 180), Math.sin(20 * Math.PI / 180)];
  const fr = P.filter(p => p.n === 1 && p.trail && p.trail.length === 3 && p.x < -0.3).map(p => p.x * dir[0] + p.y * dir[1]);
  ok(fr.length >= 3 && Math.max(...fr) - Math.min(...fr) < 1e-6, `flight: flat front, spread ${(Math.max(...fr) - Math.min(...fr)).toExponential(2)} over ${fr.length} photons`);
}

// one ray down through the cross-section at x0: its segments
function sectionRay(P, x0) {
  const s = makeScene('section', P), a = (P.ang || 0) * Math.PI / 180;
  // put the beam centre on the surface point x0 (the ray passes through
  // (L.x, L.y) when the offset is 0)
  s.light = { ...s.light, x: x0, y: 0, width: 1e-9 };
  const out = new Float32Array(7 * 16), ns = trace(s, 1, always, out, { mono: 589.3 });
  return { s, out, ns, a };
}
// 11
{
  const nW = 1.333, P = { n: nW, dn: 0, ang: 25, amp: 0.05, lam: 0.8, depth: 1.4, mix: 1, sx: 0.37 };
  let worst = 0;
  for (const x0 of [-0.9, -0.31, 0.12, 0.55, 1.07]) {
    const { s, out } = sectionRay(P, x0);
    const w = s.objects.find(o => o.kind === 'water');
    const d1 = [out[2] - out[0], out[3] - out[1]], d2 = [out[9] - out[7], out[10] - out[8]];
    const [, slope] = waterHeight(w, out[2]), L = Math.hypot(slope, 1), N = [-slope / L, 1 / L];
    const sin = d => Math.abs(d[0] * N[1] - d[1] * N[0]) / Math.hypot(d[0], d[1]);
    worst = Math.max(worst, Math.abs(sin(d1) - nW * sin(d2)));
    // the refracted ray stays on the same side of the normal
    const side = d => Math.sign(d[0] * N[1] - d[1] * N[0]);
    ok(side(d1) === side(d2), `section: refracted ray on the same side at x = ${x0}`);
  }
  ok(worst < 1e-5, `section: Snell at the wavy surface, worst |sin1 - n sin2| = ${worst.toExponential(2)}`);
  // the lamp: a ray at 60 deg from the vertical meets flat water past the
  // critical angle (48.6 deg) and reflects down
  const t = makeScene('section', { ...P, amp: 0, tir: 1 });
  t.light = { type: 'point', x: 0, y: -1.3, a0: Math.PI / 2 - 60 * Math.PI / 180, a1: Math.PI / 2 - 60 * Math.PI / 180 };
  const out = new Float32Array(7 * 16); trace(t, 1, always, out, { mono: 589.3 });
  ok(near(out[3], 0, 1e-6) && out[10] < out[8], `section: TIR at 60 deg, up to y = ${out[3].toFixed(4)}, then down`);
}
// 12
{
  const nW = 1.333, A = 0.004, lam = 0.25, k = 2 * Math.PI / lam, d = 2.5;
  const P = { n: nW, dn: 0, ang: 0, amp: A, lam, depth: d, mix: 0, sx: 0, halfW: 2.4 };
  // the ray map over one wavelength
  const M = 4000, X = [];
  for (let i = 0; i < M; i++) {
    const x0 = (i + 0.5) / M * lam, { out, ns } = sectionRay(P, x0);
    const k2 = (ns - 1) * 7;
    X.push([x0, out[k2 + 2], out[k2 + 3]]);
  }
  ok(X.every(r => near(r[2], -d, 1e-6)), 'section: every ray ends on the floor');
  // folds: a local max and a local min of X(x)
  let iMax = -1, iMin = -1;
  for (let i = 1; i + 1 < M; i++) {
    if (X[i][1] > X[i - 1][1] && X[i][1] >= X[i + 1][1] && iMax < 0) iMax = i;
    if (X[i][1] < X[i - 1][1] && X[i][1] <= X[i + 1][1] && iMin < 0) iMin = i;
  }
  const g = (1 - 1 / nW) * d * A * k * k, ph = Math.asin(1 / g), q = (1 - 1 / nW) * d * A * k;
  const Xmax = ph / k + q * Math.cos(ph), Xmin = (Math.PI - ph) / k - q * Math.cos(ph);
  ok(iMax > 0 && iMin > 0, `section: two folds found (g = ${g.toFixed(3)})`);
  const eMax = Math.abs(X[iMax][1] - Xmax), eMin = Math.abs(X[iMin][1] - Xmin);
  ok(eMax < 0.003 && eMin < 0.003, `section: folds at X = ${X[iMax][1].toFixed(4)}, ${X[iMin][1].toFixed(4)} vs small angle ${Xmax.toFixed(4)}, ${Xmin.toFixed(4)}`);
  // and the folds are where the floor light peaks: bin the ray ends
  const B = new Float32Array(250);
  for (const r of X) { let u = ((r[1] % lam) + lam) % lam; B[Math.min(249, Math.floor(u / lam * 250))]++; }
  const peaks = [...B.keys()].sort((a, b) => B[b] - B[a]).slice(0, 2).map(i => (i + 0.5) / 250 * lam).sort((a, b) => a - b);
  ok(near(peaks[0], Math.min(Xmax, Xmin), 0.004) && near(peaks[1], Math.max(Xmax, Xmin), 0.004), `section: floor light peaks at ${peaks.map(v => v.toFixed(4))}`);
}

// 13
{
  const nW = 1.333, A = 0.004, lam = 0.5, k = 2 * Math.PI / lam, d = 3, phi = 30;
  const P = { amp: A, lam, dir: phi, mix: 0, sx: 0, ang: 0, az: 0 };
  const w = topWaves(P), L = sunDir(P), e = [Math.cos(phi * Math.PI / 180), Math.sin(phi * Math.PI / 180)];
  const NB = 50, B = new Float64Array(NB), M = 100000;
  let side = 0;
  for (let i = 0; i < M; i++) {
    const sPos = (i + 0.5) / M * lam, t = 0.37;
    const x = sPos * e[0] - t * e[1], y = sPos * e[1] + t * e[0];
    const f = floorHit(w, x, y, L, nW, d);
    const u = f.qx * e[0] + f.qy * e[1], v = -f.qx * e[1] + f.qy * e[0];
    side = Math.max(side, Math.abs(v - t));
    B[Math.floor((((u % lam) + lam) % lam) / lam * NB)] += NB / M;
  }
  const g = (1 - 1 / nW) * d * A * k * k, q = (1 - 1 / nW) * d * A * k;
  let worst = 0;
  for (let b = 0; b < NB; b++) {
    const X = (b + 0.5) / NB * lam;
    let x = X; for (let it = 0; it < 30; it++) x -= (x + q * Math.cos(k * x) - X) / (1 - q * k * Math.sin(k * x));
    worst = Math.max(worst, Math.abs(B[b] - 1 / Math.abs(1 - g * Math.sin(k * x))));
  }
  ok(g < 1 && worst < 0.03, `bottom: one wave at 30 deg, g = ${g.toFixed(3)}, worst |E - closed form| = ${worst.toFixed(4)} (E from ${Math.min(...B).toFixed(3)} to ${Math.max(...B).toFixed(3)})`);
  ok(side < 1e-9, `bottom: no move at right angles to the wave (${side.toExponential(1)})`);
}
// 14
{
  const nW = 1.333, d = 1.3;
  const P1 = { amp: 0.02, lam: 0.8, dir: 0, mix: 0, sx: 0.3, ang: 0, az: 0 };
  const r1 = splatFloor({ waves: topWaves(P1), L: sunDir(P1), n: nW, d, x0: 0, y0: 0, w: 0.8, h: 0.4, nx: 400, ny: 40,
    bins: { x0: 0, y0: 0, w: 0.8, h: 0.4, nx: 32, ny: 8 }, wrap: true, fresnel: true });
  ok(Math.abs(r1.total - r1.power) < 1e-9 * r1.power, `bottom: the splat keeps the power, ${r1.total.toFixed(6)} of ${r1.power.toFixed(6)}`);
  const mean = P => {
    const L = sunDir(P), [sx, sy] = shift0(L, nW, d);
    // rays from a wide rect; the patch is in the middle of where they land
    const r = splatFloor({ waves: topWaves(P), L, n: nW, d, x0: -3 - sx, y0: -3 - sy, w: 6, h: 6, nx: 900, ny: 900,
      bins: { x0: -1.5, y0: -1.5, w: 3, h: 3, nx: 1, ny: 1 }, wrap: false, fresnel: true });
    return r.total / 9;
  };
  const flat = mean({ amp: 0, lam: 0.8, mix: 0, ang: 25, az: 40 }), wavy = mean({ amp: 0.02, lam: 0.8, dir: 25, mix: 1, sx: 1.7, ang: 25, az: 40 });
  ok(Math.abs(wavy / flat - 1) < 0.02, `bottom: mean light on a 3 m patch, waves ${wavy.toFixed(1)} against flat ${flat.toFixed(1)} rays/m2`);
}

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
