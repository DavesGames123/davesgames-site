// ============================================================================
//  THIN-FILM CLOTH  ·  tests.mjs — node tests for the DOM-free modules
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/holocloth/tests.mjs
//  Exit code 1 when a check fails. Each line prints the measured values, so
//  the output is the validation record.
//
//  GREP MAP
//    grep -n "section('solver"   XPBD: iterations, energy, pins, contact, tear
//    grep -n "section('film"     thin film: Airy, matrix method, energy, colour
// ============================================================================
import { Cloth, FABRICS } from './xpbd.js';
import { filmReflectance, spectralRGB, buildLUT, thinnedThickness, indexOf, complex, SOAP } from './film.js';

let fails = 0, passes = 0;
const ok = (cond, name, info = '') => { if (cond) passes++; else fails++; console.log(`${cond ? 'pass' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const section = name => console.log(`\n# ${name}`);
const f6 = x => Number(x).toPrecision(4);

// A seeded random source, so a failure repeats.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ── solver ─────────────────────────────────────────────────────────────────
section('solver: XPBD constraint error falls with iterations');
{
  const errs = [];
  for (const it of [1, 2, 4, 8, 16, 32]) {
    const c = new Cloth({ nx: 20, ny: 20, size: [1, 1], center: [0, 1, 0], gravity: 0, fabric: FABRICS.foil, selfContact: false });
    const r = rng(7);
    for (let i = 0; i < c.x.length; i++) c.x[i] += (r() - 0.5) * 0.02;
    c.floor = -10;
    const e0 = c.error(0);
    c.step(1 / 60, 1, it);
    errs.push(c.error(0));
    if (it === 1) console.log(`      start stretch error ${f6(e0)}`);
  }
  console.log(`      stretch RMS strain after 1,2,4,8,16,32 iterations: ${errs.map(f6).join(', ')}`);
  ok(errs.every((e, i) => i === 0 || e < errs[i - 1]), 'error falls at each doubling');
  ok(errs[5] < 0.1 * errs[0], 'error at 32 iterations < 10% of error at 1', `${f6(errs[5] / errs[0])}`);
}

section('solver: energy of a hanging cloth');
{
  // Flat cloth pinned at two corners swings down. With no damping, XPBD can
  // lose energy but must not make it. The elastic term 1/2 k C^2 counts the
  // solver residual as stored energy, so it is only physical when the
  // constraints converge: the total check uses 4 iterations per substep.
  // At the page setting (1 iteration) the check is on kinetic + potential.
  const swing = (fab, iterations) => {
    const c = new Cloth({ nx: 16, ny: 16, size: [1, 1], center: [0, 2, 0], fabric: { ...fab, damping: 0 }, selfContact: false, substeps: 20, iterations });
    c.floor = -10; c.setPin(0, true); c.setPin(c.nx - 1, true);
    const E0 = c.energy().total; let tot = E0, mech = E0, eeMax = 0;
    for (let f = 0; f < 600; f++) { c.step(1 / 60); const E = c.energy(); tot = Math.max(tot, E.total); mech = Math.max(mech, E.ke + E.pe); eeMax = Math.max(eeMax, E.ee); }
    return { E0, tot, mech, eeMax, scale: c.mass * c.n * 9.81 * 1.0 };
  };
  for (const [key, it] of [['silk', 4], ['rubber', 4], ['silk', 1], ['mail', 1]]) {
    const r = swing(FABRICS[key], it);
    console.log(`      ${key}, ${it} it: E0 ${f6(r.E0)} J, max total ${f6(r.tot)} J, max ke+pe ${f6(r.mech)} J, max elastic ${f6(r.eeMax)} J, m g L ${f6(r.scale)} J`);
    if (it === 4) ok(r.tot - r.E0 < 0.01 * r.scale, `${key}: total energy gain < 1% of m g L over 10 s (converged)`, `gain ${f6((r.tot - r.E0) / r.scale)}`);
    else ok(r.mech <= r.E0 + 1e-9, `${key}: kinetic + potential never above E0 (page setting)`, `margin ${f6((r.E0 - r.mech) / r.scale)}`);
  }
  // With damping, it comes to rest.
  const d = new Cloth({ nx: 16, ny: 16, size: [1, 1], center: [0, 2, 0], fabric: FABRICS.silk, selfContact: false });
  d.floor = -10; d.setPin(0, true); d.setPin(d.nx - 1, true);
  let keMax = 0;
  for (let f = 0; f < 900; f++) { d.step(1 / 60); keMax = Math.max(keMax, d.energy().ke); }
  const ke = d.energy().ke;
  console.log(`      damped: peak kinetic ${f6(keMax)} J, after 15 s ${f6(ke)} J`);
  ok(ke < 1e-3 * keMax, 'damped cloth settles: kinetic < 0.1% of its peak');
}

section('solver: pins hold exactly');
{
  const c = new Cloth({ nx: 24, ny: 24, size: [1.2, 1.2], center: [0, 1.6, 0], plane: 'xy', fabric: FABRICS.rubber });
  const pins = [0, 5, 11, c.nx - 1];
  const at = pins.map(k => [c.x[3 * k], c.x[3 * k + 1], c.x[3 * k + 2]]);
  for (const k of pins) c.setPin(k, true);
  c.wind.speed = 6; c.wind.turb = 1;
  for (let f = 0; f < 240; f++) c.step(1 / 60);
  const dev = Math.max(...pins.map((k, q) => Math.hypot(c.x[3 * k] - at[q][0], c.x[3 * k + 1] - at[q][1], c.x[3 * k + 2] - at[q][2])));
  ok(dev === 0, 'pinned particles keep their position in wind', `max drift ${dev}`);
}
{
  // Same hang, no wind, top row pinned: rubber must stretch, foil must not.
  const hang = key => {
    const c = new Cloth({ nx: 16, ny: 16, size: [1.2, 1.2], center: [0, 1.6, 0], plane: 'xy', fabric: FABRICS[key], selfContact: false });
    for (let i = 0; i < c.nx; i++) c.setPin(i, true);
    for (let f = 0; f < 600; f++) c.step(1 / 60);
    return c.error(0);
  };
  const r = hang('rubber'), fo = hang('foil');
  ok(r > 5 * fo, 'under its own weight rubber stretches far more than foil', `RMS strain rubber ${f6(r)}, foil ${f6(fo)}`);
}

section('solver: colliders and floor');
{
  const c = new Cloth({ nx: 32, ny: 32, size: [1.4, 1.4], center: [0, 1.0, 0], fabric: FABRICS.silk });
  const S = { type: 'sphere', c: [0, 0.35, 0], r: 0.35 };
  c.colliders = [S];
  let worst = Infinity, low = Infinity;
  for (let f = 0; f < 240; f++) {
    c.step(1 / 60);
    for (let k = 0; k < c.n; k++) {
      const d = Math.hypot(c.x[3 * k] - S.c[0], c.x[3 * k + 1] - S.c[1], c.x[3 * k + 2] - S.c[2]) - S.r;
      worst = Math.min(worst, d); low = Math.min(low, c.x[3 * k + 1]);
    }
  }
  console.log(`      min distance to sphere ${f6(worst)} m (skin ${c.skin}), lowest y ${f6(low)} m`);
  ok(worst >= c.skin - 1e-5, 'no particle inside the sphere skin after any frame');
  ok(low >= c.floor + c.skin - 1e-6, 'no particle below the floor');
  const top = c.x[3 * (16 * 32 + 16) + 1];
  ok(Math.abs(top - (0.7 + c.skin)) < 0.02, 'the centre rests on the sphere top', `y ${f6(top)}`);
  const box = { type: 'box', c: [0, 0.3, 0], h: [0.3, 0.3, 0.3], r: 0.03 };
  const b = new Cloth({ nx: 28, ny: 28, size: [1.3, 1.3], center: [0.05, 0.9, 0], fabric: FABRICS.mail });
  b.colliders = [box]; const o = new Float64Array(4); let wb = Infinity;
  for (let f = 0; f < 240; f++) { b.step(1 / 60); for (let k = 0; k < b.n; k++) wb = Math.min(wb, (await import('./xpbd.js')).sdf(box, b.x[3 * k], b.x[3 * k + 1], b.x[3 * k + 2], o)[3]); }
  ok(wb >= b.skin - 1e-5, 'no particle inside the rounded box', `min sdf ${f6(wb)}`);
}

section('solver: self contact');
{
  // A hanging sheet falls and piles on the floor. Count pairs that are not
  // grid neighbours and are closer than half the contact distance.
  const run = self => {
    const c = new Cloth({ nx: 24, ny: 24, size: [1, 1], center: [0, 1.15, 0], plane: 'xy', fabric: FABRICS.silk, selfContact: self });
    c.reset({ tilt: 1 });
    for (let f = 0; f < 200; f++) c.step(1 / 60);
    let close = 0, min = Infinity;
    for (let a = 0; a < c.n; a++) for (let b = a + 1; b < c.n; b++) {
      const di = Math.abs(a % c.nx - b % c.nx), dj = Math.abs(((a / c.nx) | 0) - ((b / c.nx) | 0));
      if (di <= 1 && dj <= 1) continue;
      const d = Math.hypot(c.x[3 * a] - c.x[3 * b], c.x[3 * a + 1] - c.x[3 * b + 1], c.x[3 * a + 2] - c.x[3 * b + 2]);
      min = Math.min(min, d); if (d < 0.5 * c.thick) close++;
    }
    return { close, min, thick: c.thick };
  };
  const on = run(true), off = run(false);
  console.log(`      contact on: ${on.close} close pairs, min ${f6(on.min)} m; off: ${off.close} close pairs, min ${f6(off.min)} m; contact distance ${f6(on.thick)} m`);
  ok(on.close === 0, 'with self contact no pair is closer than half the contact distance');
  ok(off.close > on.close, 'without self contact the pile interpenetrates (the test can see the effect)');
}

section('solver: grab, throw, tear');
{
  const c = new Cloth({ nx: 20, ny: 20, size: [1, 1], center: [0, 1.5, 0], gravity: 0, fabric: FABRICS.silk });
  c.floor = -10;
  const k = 10 * 20 + 10, x0 = [c.x[3 * k], c.x[3 * k + 1], c.x[3 * k + 2]];
  const nGrab = c.grabStart(...x0, 0.08);
  for (let f = 1; f <= 6; f++) { c.grabMove(x0[0], x0[1] + 0.05 * f, x0[2]); c.step(1 / 60); }
  c.grabEnd();
  const vy = c.v[3 * k + 1];
  console.log(`      grabbed ${nGrab} particles, release speed ${f6(vy)} m/s (hand 3 m/s)`);
  ok(nGrab > 1 && vy > 2, 'a grab moves a patch and a release keeps the hand velocity');
  const t = new Cloth({ nx: 20, ny: 20, size: [1, 1], center: [0, 1.5, 0], gravity: 0, fabric: FABRICS.foil });
  t.floor = -10; t.tearing = true;
  for (let i = 0; i < 20; i++) t.setPin(i, true);
  const tris0 = t.triangles().length;
  const j = t.n - 10;
  t.grabStart(t.x[3 * j], t.x[3 * j + 1], t.x[3 * j + 2], 0.12);
  for (let f = 1; f <= 30; f++) { t.grabMove(t.x[3 * j], 1.5, t.x[3 * j + 2] + 0.04 * f); t.step(1 / 60); }
  const tris1 = t.triangles().length;
  ok(tris1 < tris0, 'tearing on: a hard pull breaks edges and drops triangles', `${tris0 / 3} -> ${tris1 / 3} triangles`);
  const cut = new Cloth({ nx: 12, ny: 12, size: [1, 1], center: [0, 1, 0] });
  const hit = cut.cut(0, 1, 0, 0.1);
  ok(hit > 0 && cut.triangles().length < 11 * 11 * 6, 'cut breaks the edges near a point', `${hit} edges`);
}

// ── film ───────────────────────────────────────────────────────────────────
section('film: Airy sum against the real closed form (dielectric on dielectric)');
{
  // For real indices the Airy intensity is
  //   R = (r01^2 + r12^2 + 2 r01 r12 cos 2b) / (1 + r01^2 r12^2 + 2 r01 r12 cos 2b)
  const n0 = 1, n1 = 1.38, n2 = 1.52;
  const closed = (lambda, d, th, pol) => {
    const s0 = Math.sin(th), c0 = Math.cos(th), c1 = Math.sqrt(1 - (s0 / n1) ** 2), c2 = Math.sqrt(1 - (s0 / n2) ** 2);
    const r = pol === 's' ? (a, ca, b, cb) => (a * ca - b * cb) / (a * ca + b * cb) : (a, ca, b, cb) => (b * ca - a * cb) / (b * ca + a * cb);
    const r01 = r(n0, c0, n1, c1), r12 = r(n1, c1, n2, c2), b = 2 * Math.PI * n1 * d * c1 / lambda;
    const cs = Math.cos(2 * b);
    return (r01 * r01 + r12 * r12 + 2 * r01 * r12 * cs) / (1 + r01 * r01 * r12 * r12 + 2 * r01 * r12 * cs);
  };
  let worst = 0, cases = 0;
  for (const d of [0, 50, 137, 300, 612, 1100]) for (const deg of [0, 20, 45, 70, 85]) for (const lambda of [400, 532, 650, 780]) {
    const th = deg * Math.PI / 180, F = filmReflectance(lambda, d, Math.cos(th), n1, [[380, n2, 0], [780, n2, 0]], n0);
    worst = Math.max(worst, Math.abs(F.Rs - closed(lambda, d, th, 's')), Math.abs(F.Rp - closed(lambda, d, th, 'p'))); cases++;
  }
  ok(worst < 1e-12, `Rs and Rp match the closed form in ${cases} cases (6 thicknesses, 5 angles, 4 wavelengths)`, `max |dR| ${worst.toExponential(2)}`);
}

section('film: Airy sum against the characteristic matrix (metal substrate)');
{
  // An independent method: the 2x2 characteristic matrix of the layer
  // (Born and Wolf), with the n + ik sign convention:
  //   [B; C] = [[cos b, -i sin b / eta1], [-i eta1 sin b, cos b]] [1; eta2]
  //   r = (eta0 B - C) / (eta0 B + C),  eta = n cos (s) or n / cos (p)
  const { C, add, sub, mul, div, abs2, csqrt } = complex;
  const matrixR = (lambda, d, cos0, n1, subst, pol) => {
    const N0 = C(1), N1 = C(n1), N2 = indexOf(subst, lambda), s0 = C(Math.sqrt(1 - cos0 * cos0));
    const cosIn = N => csqrt(sub(C(1), mul(div(s0, N), div(s0, N))));
    const c0 = C(cos0), c1 = cosIn(N1), c2 = cosIn(N2);
    const eta = (N, c) => pol === 's' ? mul(N, c) : div(N, c);
    const e0 = eta(N0, c0), e1 = eta(N1, c1), e2 = eta(N2, c2);
    const b = mul(C(2 * Math.PI * d / lambda), mul(N1, c1));
    const cb = C(Math.cos(b[0])), sb = C(Math.sin(b[0]));
    const mI = x => [x[1], -x[0]];                       // multiply by -i
    const B = add(cb, mul(mI(div(sb, e1)), e2));
    const Cc = add(mI(mul(e1, sb)), mul(cb, e2));
    return abs2(div(sub(mul(e0, B), Cc), add(mul(e0, B), Cc)));
  };
  let worst = 0, cases = 0;
  for (const subst of ['aluminium', 'steel', 'dye']) for (const d of [0, 80, 260, 640]) for (const deg of [0, 35, 60, 80]) for (const lambda of [410, 550, 700]) {
    const c0 = Math.cos(deg * Math.PI / 180), F = filmReflectance(lambda, d, c0, 1.5, subst);
    worst = Math.max(worst, Math.abs(F.Rs - matrixR(lambda, d, c0, 1.5, subst, 's')), Math.abs(F.Rp - matrixR(lambda, d, c0, 1.5, subst, 'p'))); cases++;
  }
  ok(worst < 1e-10, `Airy and matrix agree on absorbing substrates in ${cases} cases`, `max |dR| ${worst.toExponential(2)}`);
}

section('film: limits and energy');
{
  // d = 0: the bare substrate interface.
  const N = indexOf('aluminium', 550), c0 = 1;
  const r = complex.div(complex.sub(complex.C(1), N), complex.add(complex.C(1), N));
  const bare = complex.abs2(r), z = filmReflectance(550, 0, c0, 1.4, 'aluminium').R;
  ok(Math.abs(z - bare) < 1e-12, 'zero thickness gives the bare aluminium reflectance', `R ${z.toFixed(5)}`);
  // Lossless free film (soap): R + T = 1, with the Airy transmission.
  const { C, add, mul, div, abs2, expi } = complex;
  let worst = 0;
  for (const d of [30, 120, 333, 800]) for (const deg of [0, 30, 60, 80]) for (const l of [420, 560, 700]) {
    const n1 = 1.33, s = Math.sin(deg * Math.PI / 180), c0 = Math.cos(deg * Math.PI / 180), c1 = Math.sqrt(1 - (s / n1) ** 2);
    const b = 2 * Math.PI * n1 * d * c1 / l, ph = expi(2 * b);
    for (const pol of ['s', 'p']) {
      const r01 = pol === 's' ? (c0 - n1 * c1) / (c0 + n1 * c1) : (n1 * c0 - c1) / (n1 * c0 + c1);
      const t01 = pol === 's' ? 2 * c0 / (c0 + n1 * c1) : 2 * c0 / (n1 * c0 + c1);
      const t12 = pol === 's' ? 2 * n1 * c1 / (n1 * c1 + c0) : 2 * n1 * c1 / (c1 + n1 * c0);
      const r12 = -r01;
      const t = div(mul(C(t01 * t12), expi(b)), add(C(1), mul(C(r01 * r12), ph)));
      const T = abs2(t);
      const F = filmReflectance(l, d, c0, n1, 'air');
      worst = Math.max(worst, Math.abs((pol === 's' ? F.Rs : F.Rp) + T - 1));
    }
  }
  ok(worst < 1e-12, 'lossless soap film: R + T = 1 for s and p', `max |R+T-1| ${worst.toExponential(2)}`);
  // Soap film first maximum: 2 n d cos1 = lambda / 2 (one pi shift), so
  // lambda_max = 4 n d cos1.
  const peak = (d, deg) => { let bl = 0, br = -1; for (let l = 380; l <= 780; l += 0.25) { const R = filmReflectance(l, d, Math.cos(deg * Math.PI / 180), 1.33, 'air').R; if (R > br) { br = R; bl = l; } } return bl; };
  const p0 = peak(110, 0), p60 = peak(130, 60), c1 = Math.sqrt(1 - (Math.sin(Math.PI / 3) / 1.33) ** 2);
  ok(Math.abs(p0 - 4 * 1.33 * 110) < 1, 'soap film 110 nm: reflectance peak at 4 n d', `${p0} nm, expected ${(4 * 1.33 * 110).toFixed(1)} nm`);
  ok(Math.abs(p60 - 4 * 1.33 * 130 * c1) < 1, 'soap film 130 nm at 60 deg: the peak moves to 4 n d cos(theta1)', `${p60} nm, expected ${(4 * 1.33 * 130 * c1).toFixed(1)} nm`);
}

section('film: colour');
{
  const one = spectralRGB(0, 1, { n: 1, sub: [[380, 1e6, 0], [780, 1e6, 0]] });
  ok(one.every(c => Math.abs(c - 1) < 1e-3), 'a perfect mirror maps to white (1, 1, 1)', one.map(c => c.toFixed(4)).join(', '));
  const black = spectralRGB(5, 1, SOAP);
  ok(Math.max(...black) < 0.005, 'a 5 nm soap film is black (no reflection)', black.map(c => c.toFixed(4)).join(', '));
  // A thick film: the fringes are finer than the colour functions, so the
  // colour is grey at the incoherent sum (r^2 + r^2 - 2 r^4)/(1 - r^4).
  const r2 = ((1 - 1.33) / (1 + 1.33)) ** 2, inc = (2 * r2 - 2 * r2 * r2) / (1 - r2 * r2);
  const thick = spectralRGB(20000, 1, SOAP, 0.25), chroma = Math.max(...thick) - Math.min(...thick);
  ok(chroma < 0.02 * inc * 3 && Math.abs(thick[1] - inc) < 0.05 * inc, 'a 20 um soap film is grey at the incoherent sum', `rgb ${thick.map(c => c.toFixed(4)).join(', ')}, incoherent ${inc.toFixed(4)}`);
  const thin = spectralRGB(250, 1, { n: 1.52, sub: 'dye' }), thinned = spectralRGB(thinnedThickness(250, 1.4), 1, { n: 1.52, sub: 'dye' });
  ok(Math.hypot(...thin.map((c, i) => c - thinned[i])) > 0.01, 'a 40% area stretch changes the film colour', `rgb ${thin.map(c => c.toFixed(3))} -> ${thinned.map(c => c.toFixed(3))}`);
  ok(Math.abs(thinnedThickness(300, 1.5) * 1.5 - 300) < 1e-9, 'thinning keeps the film volume d A');
  const t0 = performance.now(), L = buildLUT({ n: 1.38, sub: 'aluminium' });
  const ms = performance.now() - t0, bad = L.data.some(v => !Number.isFinite(v) || v < 0);
  ok(!bad && L.data.length === L.nd * L.nc * 4, 'the LUT is finite and non-negative', `${L.nd} x ${L.nc}, built in ${ms.toFixed(0)} ms`);
}

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
