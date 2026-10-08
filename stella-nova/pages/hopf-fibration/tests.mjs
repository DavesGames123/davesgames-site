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
//    seifert    (p,q) orbits: on S3, Hopf at (1,1), torus knots, Lk = p q
//    hopf tori  preimages map back onto the curve; area = pi * length
//    polyhedra  vertex counts, regular, clear of the south pole, Lk = +-1
//    knots      the orbits of a knot preset are distinct; same torus Lk = p q
//    presets    deterministic, finite, under the cap
//    budget     GPU bytes of the 3D view stay under a hard limit
// ============================================================================
import * as H from './hopf.js';
import * as BG from './budget.js';

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
// seifert: the weighted action t -> (e^{ipt} z0, e^{iqt} z1)
{
  let unit = 0, same = 0, closed = 0;
  for (let k = 0; k < 500; k++) {
    const b = randS2(), t = rng.range(0, H.TAU), p = rng.int(1, 5), q = rng.int(1, 5);
    unit = Math.max(unit, Math.abs(Math.hypot(...H.seifertPoint(b, t, p, q)) - 1));
    same = Math.max(same, dist(H.seifertPoint(b, t, 1, 1), H.fibrePoint(b, t)));
    closed = Math.max(closed, dist(H.seifertPoint(b, 0, p, q), H.seifertPoint(b, H.TAU, p, q)));
  }
  ok('seifert: orbits stay on S3', unit < 1e-12, `max err ${unit.toExponential(2)}`);
  ok('seifert: at (1,1) the orbit is the Hopf fibre', same < 1e-12, `max err ${same.toExponential(2)}`);
  ok('seifert: orbits close at t = 2 pi', closed < 1e-12, `max err ${closed.toExponential(2)}`);
  // the projected orbit is a (p, q) torus knot: p turns about the x3 axis,
  // q turns about the unit circle (the orbit z1 = 0)
  const ring = new Float64Array(400 * 3);
  for (let i = 0; i < 400; i++) { ring[i * 3] = Math.cos(H.TAU * i / 400); ring[i * 3 + 1] = Math.sin(H.TAU * i / 400); }
  const res = [];
  let good = true;
  for (const [p, q] of [[2, 3], [3, 2], [2, 5], [3, 4]]) {
    const b = H.baseFromAngles(1.2, 0.4), C = H.fibreCurve(b, null, 1600, [p, q]);
    let turn = 0;
    for (let i = 0; i < 1600; i++) {
      const j = (i + 1) % 1600, a0 = Math.atan2(C[i * 3 + 1], C[i * 3]), a1 = Math.atan2(C[j * 3 + 1], C[j * 3]);
      let d = a1 - a0; if (d > Math.PI) d -= H.TAU; if (d < -Math.PI) d += H.TAU; turn += d;
    }
    const wz = turn / H.TAU, lk = H.linkingNumber(C, ring);
    res.push(`(${p},${q}) turns ${wz.toFixed(3)} Lk ${lk.toFixed(3)}`);
    if (Math.abs(wz - p) > 1e-6 || Math.abs(Math.abs(lk) - q) > 0.02) good = false;
  }
  ok('seifert: projected orbit is a (p,q) torus knot', good, res.join(' · '));
  // two orbits on different tori link p q times
  const lks = [];
  let lkGood = true;
  for (const [p, q] of [[1, 1], [2, 3], [3, 2], [2, 5]]) {
    const A = H.fibreCurve(H.baseFromAngles(1.1, 0.3), null, 1500, [p, q]), B = H.fibreCurve(H.baseFromAngles(1.9, 2.2), null, 1500, [p, q]);
    const L = H.linkingNumber(A, B); lks.push(`(${p},${q}) ${L.toFixed(3)}`);
    if (Math.abs(Math.abs(L) - p * q) > 0.03) lkGood = false;
  }
  ok('seifert: two orbits link p q times', lkGood, lks.join(' · '));
}
// hopf tori: the fibres over a closed curve
{
  const shapes = [{ shape: 'flower', th0: 1.15, amp: 0.32, k: 5 }, { shape: 'seam', a: 0.7, lift: 0.9 }, { shape: 'tilt', rho: 0.42, tl: 2.2 }];
  let back = 0, onCurve = 0;
  const flower = shapes[0];
  for (const f of H.sampleItems([Object.assign({ kind: 'loop', n: 90 }, flower)], 24)) {
    for (const t of [0.3, 2.9, 5.1]) back = Math.max(back, dist(H.hopf(H.fibrePoint(f.b, t)), f.b));
    const th = Math.acos(f.b[2]), ph = Math.atan2(f.b[1], f.b[0]);
    onCurve = Math.max(onCurve, Math.abs(th - (flower.th0 + flower.amp * Math.sin(flower.k * ph))));
  }
  ok('hopf tori: p(fibre) lands back on the base curve', back < 1e-12 && onCurve < 1e-9, `map err ${back.toExponential(2)}, curve err ${onCurve.toExponential(2)}`);
  const rows = [];
  let worst = 0;
  for (const sh of shapes) {
    const { area, length } = H.torusArea(u => H.loopPoint(sh, u), 500, 160);
    const rel = Math.abs(area / (Math.PI * length) - 1); worst = Math.max(worst, rel);
    rows.push(`${sh.shape} A ${area.toFixed(3)} pi L ${(Math.PI * length).toFixed(3)}`);
  }
  ok('hopf tori: area = pi * length (Pinkall)', worst < 2e-4, rows.join(' · ') + `  max rel ${worst.toExponential(1)}`);
}
// polyhedra
{
  const rows = [];
  let good = true;
  for (const [name, n] of [['octa', 6], ['cube', 8], ['icosa', 12], ['dodeca', 20]]) {
    const V = H.polyhedron(name);
    const angs = [];
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) angs.push(Math.acos(Math.max(-1, Math.min(1, V[i].reduce((q, v, k) => q + v * V[j][k], 0)))));
    const minA = Math.min(...angs), edges = angs.filter(a => a < minA + 1e-9).length, south = Math.min(...V.map(v => v[2]));
    rows.push(`${name} ${V.length} v ${edges} e`);
    if (V.length !== n || V.some(v => Math.abs(Math.hypot(...v) - 1) > 1e-12) || south < -0.97) good = false;
    if (edges !== { octa: 12, cube: 12, icosa: 30, dodeca: 30 }[name]) good = false;
  }
  ok('polyhedra: vertices, edges, unit, no vertex at the south pole', good, rows.join(' · '));
  const V = H.polyhedron('icosa'), lk = [];
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    const A = H.fibreCurve(V[i], null, 240), B = H.fibreCurve(V[j], null, 240);
    if (Math.max(...A.map(Math.abs), ...B.map(Math.abs)) > 60) continue;
    lk.push(H.linkingNumber(A, B));
  }
  const err = Math.max(...lk.map(v => Math.abs(Math.abs(v) - 1)));
  ok('polyhedra: icosahedron fibres link once in pairs', lk.length >= 55 && err < 0.03, `${lk.length} of 66 pairs, max | |Lk| - 1 | = ${err.toFixed(4)}`);
}
// knots: the orbits of the knot presets
{
  const rows = [];
  let good = true;
  for (const id of ['trefoils', 'seifert', 'cinquefoil']) {
    const P = H.PRESETS.find(p => p.id === id), made = P.make(24, H.makeRng(1)), F = H.sampleItems(made.items, 24);
    const [p, q] = made.pq, curves = F.map(f => Array.from({ length: 120 }, (_, i) => H.seifertPoint(f.b, H.TAU * i / 120, p, q)));
    let minD = Infinity;
    for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++)
      for (const a of curves[i]) for (const b of curves[j]) minD = Math.min(minD, dist(a, b));
    rows.push(`${id} (${p},${q}) ${F.length} orbits, min gap ${minD.toFixed(3)}`);
    if (!(minD > 0.02)) good = false;
  }
  ok('knots: the orbits of a knot preset are distinct', good, rows.join(' · '));
  const lat = H.sampleItems([{ kind: 'lat', z: 0.05, n: 4, span: H.TAU / 3, open: true }], 24);
  const L = H.linkingNumber(H.fibreCurve(lat[0].b, null, 1500, [2, 3]), H.fibreCurve(lat[2].b, null, 1500, [2, 3]));
  ok('knots: two trefoils on one torus link 6 times', Math.abs(Math.abs(L) - 6) < 0.05, `Lk ${L.toFixed(3)}`);
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
// budget: the GPU memory of the 3D view (budget.js)
{
  const MB = v => (v / 1e6).toFixed(0) + ' MB';
  let worst = 0, okPx = true;
  for (const [w, h] of [[1440, 900], [2560, 1440], [3840, 2160]]) {
    const B = BG.postBudget(w, h, 2), old = BG.legacyBytes(w, h, 2);
    worst = Math.max(worst, B.bytes.total);
    if (B.px > BG.MAX_PX * 1.002) okPx = false;
    console.log(`      ${w}x${h} css at dpr 2: old ${MB(old)}  new ${MB(B.bytes.total)}  (pr ${B.pr}, ${B.samples}x MSAA, ${(B.px / 1e6).toFixed(2)} Mpx)`);
  }
  ok('budget: device px at most 2560x1440', okPx);
  ok('budget: total GPU bytes under 256 MB', worst < 256e6, MB(worst));
  const small = BG.postBudget(1280, 720, 1);
  ok('budget: a small window keeps dpr and 4x MSAA', small.pr === 1 && small.samples === 4, `pr ${small.pr}, ${small.samples}x`);
  const huge = BG.postBudget(7680, 4320, 2);
  ok('budget: a huge window stays in budget', huge.bytes.total < 256e6 && Number.isFinite(huge.pr), `pr ${huge.pr}, ${MB(huge.bytes.total)}`);
}
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
