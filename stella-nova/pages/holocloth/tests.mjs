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

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
