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
// ============================================================================
import { spectrum, fresnel, refract, indexAt, makeScene, trace, outline, mulberry } from './optics2d.js';

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

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
