// ============================================================================
//  HOPF FIBRATION  ·  tests.mjs — node tests for hopf.js
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/hopf-fibration/tests.mjs
//  Each check prints one line. The process exits 1 if a check fails.
//    map        p(fibre(b, t)) = b, and |q| = 1
//    fibres     each fibre is a great circle: a plane through 0 in R4
//    action     the fibre is the orbit of q -> e^{it} q
//    matrices   leftMat and rightMat agree with qmul
//    isoclinic  q -> q b sends fibres to fibres; the base turns by s
//    quaternion p(q) agrees with conj(q) i q (axes relabelled)
//    circles    the projected fibre lies on a round circle
//    linking    random pairs of fibres have linking number +-1
//    pierce     one fibre crosses the disc of the other exactly once
//    colour     colours in 0..1, no NaN, poles grey
//    presets    deterministic, finite, under the cap
// ============================================================================
import * as H from './hopf.js';

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const rng = H.makeRng(12345);
const randS2 = () => { const z = rng.range(-1, 1), r = Math.sqrt(1 - z * z), p = rng.range(0, H.TAU); return [r * Math.cos(p), r * Math.sin(p), z]; };
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

// map
{
  let worst = 0, worstN = 0;
  for (let k = 0; k < 2000; k++) {
    const b = k === 0 ? [0, 0, 1] : k === 1 ? [0, 0, -1] : randS2(), t = rng.range(0, H.TAU), q = H.fibrePoint(b, t);
    worst = Math.max(worst, dist(H.hopf(q), b)); worstN = Math.max(worstN, Math.abs(Math.hypot(...q) - 1));
  }
  ok('map: p(fibre(b,t)) = b', worst < 1e-12, `max err ${worst.toExponential(2)}`);
  ok('map: fibre points are unit', worstN < 1e-12, `max err ${worstN.toExponential(2)}`);
}
// fibres are great circles: q(t) = cos t q(0) + sin t q(pi/2)
{
  let worst = 0;
  for (let k = 0; k < 300; k++) {
    const b = randS2(), a = H.fibrePoint(b, 0), c = H.fibrePoint(b, Math.PI / 2), t = rng.range(0, H.TAU), q = H.fibrePoint(b, t);
    worst = Math.max(worst, dist(q, a.map((v, i) => Math.cos(t) * v + Math.sin(t) * c[i])));
    worst = Math.max(worst, Math.abs(a.reduce((s, v, i) => s + v * c[i], 0)));
  }
  ok('fibres: great circles of S3', worst < 1e-12, `max err ${worst.toExponential(2)}`);
}
// action
{
  let worst = 0;
  for (let k = 0; k < 300; k++) {
    const b = randS2(), t = rng.range(0, H.TAU), q0 = H.fibrePoint(b, 0);
    worst = Math.max(worst, dist(H.matVec(H.leftMat([Math.cos(t), Math.sin(t), 0, 0]), q0), H.fibrePoint(b, t)));
  }
  ok('action: fibre = orbit of e^{it} q', worst < 1e-12, `max err ${worst.toExponential(2)}`);
}
// matrices
{
  let worst = 0;
  const rq = () => { const v = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)], l = Math.hypot(...v); return v.map(x => x / l); };
  for (let k = 0; k < 200; k++) {
    const a = rq(), q = rq();
    worst = Math.max(worst, dist(H.matVec(H.leftMat(a), q), H.qmul(a, q)), dist(H.matVec(H.rightMat(a), q), H.qmul(q, a)));
  }
  ok('matrices: leftMat/rightMat = qmul', worst < 1e-12, `max err ${worst.toExponential(2)}`);
  // every rotation of the page is orthogonal with det +1
  let orth = 0;
  for (const m of Object.keys(H.MODES)) {
    const M = H.rotationFor(m, 0.83, { tilt: 0.4 }), P = H.matMul(M, [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15].map(i => M[i]));
    orth = Math.max(orth, ...P.map((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0))));
  }
  ok('matrices: page rotations are orthogonal', orth < 1e-12, `max err ${orth.toExponential(2)}`);
}
// isoclinic: right product keeps fibres; the base turns by s
{
  let worst = 0, angErr = 0;
  for (let k = 0; k < 200; k++) {
    const b = randS2(), s = rng.range(0, H.TAU), M = H.rotationFor('isoclinic', s, { tilt: 0 });
    const p0 = H.hopf(H.matVec(M, H.fibrePoint(b, 0)));
    for (const t of [0.7, 2.1, 4.4]) worst = Math.max(worst, dist(H.hopf(H.matVec(M, H.fibrePoint(b, t))), p0));
    // the turn angle about the axis: compare with b
    if (k === 0) {
      // find the fixed axis: base points that stay
      const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(a => dist(H.hopf(H.matVec(M, H.fibrePoint(a, 0))), a));
      const fixed = ax.indexOf(Math.min(...ax));
      const other = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][(fixed + 1) % 3], img = H.hopf(H.matVec(M, H.fibrePoint(other, 0)));
      const sNorm = ((s % H.TAU) + H.TAU) % H.TAU, ang = Math.acos(Math.max(-1, Math.min(1, img.reduce((q, v, i) => q + v * other[i], 0))));
      angErr = Math.abs(ang - Math.min(sNorm, H.TAU - sNorm));
      console.log(`      isoclinic tilt 0: fixed base axis ${['X', 'Y', 'Z'][fixed]} (error ${Math.min(...ax).toExponential(2)})`);
    }
  }
  ok('isoclinic: q -> q e^{js/2} sends fibres to fibres', worst < 1e-12, `max err ${worst.toExponential(2)}`);
  ok('isoclinic: the base turns by s', angErr < 1e-9, `err ${angErr.toExponential(2)}`);
  // the other modes do not keep fibres
  const b = [0.3, 0.5, Math.sqrt(1 - 0.34)], M = H.rotationFor('plane', 0.7);
  ok('plane: fibres go to other great circles', dist(H.hopf(H.matVec(M, H.fibrePoint(b, 0))), H.hopf(H.matVec(M, H.fibrePoint(b, 1.3)))) > 1e-3);
}
// quaternion form
{
  let worst = 0, perm = null;
  const I = [0, 1, 0, 0];
  for (let k = 0; k < 100; k++) {
    const q = H.fibrePoint(randS2(), rng.range(0, H.TAU)), v = H.qmul(H.qmul(H.qconj(q), I), q).slice(1), p = H.hopf(q);
    if (!perm) {
      // find the signed relabelling: p[a] = sgn * v[i]
      perm = [0, 1, 2].map(a => { let best = null; for (let i = 0; i < 3; i++) for (const sg of [1, -1]) { const e = Math.abs(p[a] - sg * v[i]); if (!best || e < best.e) best = { i, sg, e }; } return best; });
    }
    worst = Math.max(worst, ...perm.map((m, a) => Math.abs(p[a] - m.sg * v[m.i])));
  }
  const names = ['i', 'j', 'k'];
  console.log('      p(q) = (' + perm.map(m => (m.sg < 0 ? '-' : '') + names[m.i]).join(', ') + ') parts of conj(q) i q');
  ok('quaternion: p(q) is conj(q) i q, axes relabelled', worst < 1e-12, `max err ${worst.toExponential(2)}`);
}
// circles
{
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const b = randS2(), M = H.rotationFor('double', rng.range(0, 6)), C = H.fibreCurve(b, M, 64);
    const P = i => [C[i * 3], C[i * 3 + 1], C[i * 3 + 2]];
    const c = H.circleFrom3(P(0), P(21), P(42));
    if (!c || c.radius > 1e3) continue;
    for (let i = 0; i < 64; i += 5) {
      const p = P(i), r = dist(p, c.centre), off = (p[0] - c.centre[0]) * c.normal[0] + (p[1] - c.centre[1]) * c.normal[1] + (p[2] - c.centre[2]) * c.normal[2];
      worst = Math.max(worst, Math.abs(r - c.radius) / c.radius, Math.abs(off) / c.radius);
    }
  }
  ok('circles: projected fibres are round', worst < 1e-9, `max rel err ${worst.toExponential(2)}`);
}
// linking and pierce
{
  const lk = [], pc = [];
  let sameSign = true, sign0 = 0;
  for (let k = 0; k < 40; k++) {
    const a = randS2(), b = randS2();
    if (H.hopf(H.fibrePoint(a, 0)).reduce((s, v, i) => s + v * b[i], 0) > 0.995) continue;
    const M = H.rotationFor('isoclinic', rng.range(0, 6), { tilt: 0.3 });
    const A = H.fibreCurve(a, M, 360), B = H.fibreCurve(b, M, 360);
    const big = Math.max(...A.map(Math.abs), ...B.map(Math.abs));
    if (big > 200) continue;
    const L = H.linkingNumber(A, B); lk.push(L);
    if (!sign0) sign0 = Math.sign(L); else if (Math.sign(L) !== sign0) sameSign = false;
    const P = i => [A[i * 3], A[i * 3 + 1], A[i * 3 + 2]];
    const cA = H.circleFrom3(P(0), P(120), P(240));
    if (cA) pc.push(H.pierce(cA, B).length);
  }
  const err = Math.max(...lk.map(v => Math.abs(Math.abs(v) - 1)));
  ok('linking: |Lk| = 1 for fibre pairs', lk.length > 20 && err < 0.02, `${lk.length} pairs, max | |Lk| - 1 | = ${err.toFixed(4)}`);
  ok('linking: one sign for one orientation', sameSign, `sign ${sign0 > 0 ? '+1' : '-1'}`);
  ok('pierce: one crossing of the disc', pc.length > 20 && pc.every(n => n === 1), `${pc.length} pairs, counts ${[...new Set(pc)].join(',')}`);
}
// colour
{
  let bad = 0;
  for (let k = 0; k < 3000; k++) { const c = H.baseColor(randS2()); if (c.some(v => !(v >= 0 && v <= 1))) bad++; }
  const n = H.baseColor([0, 0, 1]), s = H.baseColor([0, 0, -1]);
  ok('colour: in 0..1, no NaN', bad === 0, `${bad} bad`);
  ok('colour: poles grey, north lighter', Math.abs(n[0] - n[2]) < 1e-3 && Math.abs(s[0] - s[2]) < 1e-3 && n[1] > s[1], `N ${H.hexOf(n)} S ${H.hexOf(s)}`);
}
// presets
{
  let good = true, det = true;
  for (const p of H.PRESETS) {
    for (const d of [8, 24, 48]) {
      const a = H.sampleItems(p.make(d, H.makeRng(7)).items, d, 2000), b = H.sampleItems(p.make(d, H.makeRng(7)).items, d, 2000);
      if (JSON.stringify(a) !== JSON.stringify(b)) det = false;
      if (a.length > 2000 || a.some(f => f.b.some(v => !Number.isFinite(v)) || Math.abs(Math.hypot(...f.b) - 1) > 1e-9)) good = false;
    }
  }
  ok('presets: deterministic for a seed', det);
  ok('presets: unit, finite, under the cap', good, H.PRESETS.map(p => `${p.id} ${H.sampleItems(p.make(24, H.makeRng(7)).items, 24).length}`).join(' · '));
  const curve = H.sampleItems([{ kind: 'curve', pts: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }], 24);
  ok('curve: resampled ends on the painted ends', dist(curve[0].b, [1, 0, 0]) < 1e-12 && dist(curve[curve.length - 1].b, [0, 0, 1]) < 1e-12, `${curve.length} fibres`);
}
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
