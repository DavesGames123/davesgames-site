// ============================================================================
//  WANKEL ENGINE  ·  tests.mjs — checks of engine.js in Node
// ────────────────────────────────────────────────────────────────────────────
//  node stella-nova/pages/wankel-engine/tests.mjs
//  1. the rotor stays inside the housing at every shaft angle (and how close
//     its flank comes)
//  2. the ring gear and the stationary gear never overlap, for both rotors
//  3. the swept volume equals 3√3 e R W, and the volume extremes fall at
//     the waists (w = 0 and π) and the ends (w = π/2 and 3π/2)
//  4. the rotor turns at one third of the shaft speed
//  5. the mean gas torque over one shaft turn equals the cycle work / 2π
//  6. the chamber volume is a pure sinusoid of the shaft angle
// ============================================================================
import * as E from './engine.js';
const { GEO, TAU, D } = E;
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };

// 1. rotor inside the housing
const H = E.housingPoly(2880);
function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
// distance from p to the housing along the ray from the origin: the housing
// radius at that polar angle minus |p| (the housing is convex about 0)
const hR = new Float64Array(7200);
{
  for (let i = 0; i < H.length; i++) {
    const p = H[i], q = H[(i + 1) % H.length];
    for (let s = 0; s < 8; s++) {
      const x = p[0] + (q[0] - p[0]) * s / 8, y = p[1] + (q[1] - p[1]) * s / 8;
      const b = Math.round(((Math.atan2(y, x) + TAU) % TAU) / TAU * 7200) % 7200;
      hR[b] = Math.hypot(x, y);
    }
  }
  for (let i = 0; i < 7200; i++) if (!hR[i]) hR[i] = hR[(i + 7199) % 7200];
}
const gapOf = p => hR[Math.round(((Math.atan2(p[1], p[0]) + TAU) % TAU) / TAU * 7200) % 7200] - Math.hypot(p[0], p[1]);
const rot = E.rotorOutline(1440);
let out = 0, minGap = Infinity;
for (let i = 0; i < 360; i++) {
  const k = E.kin(i / 360 * TAU * 3), ca = Math.cos(k.a), sa = Math.sin(k.a);
  for (const [x, y] of rot) {
    const p = [k.c[0] + x * ca - y * sa, k.c[1] + x * sa + y * ca];
    if (!inside(p, H)) out++;
    minGap = Math.min(minGap, gapOf(p));
  }
}
ok(out === 0, `rotor stays inside the housing (${out} points out), least radial gap ${minGap.toFixed(2)} mm`);
ok(minGap > 0.2 && minGap < 1.6, `flank runs close to the housing at the apexes (gap ${minGap.toFixed(2)} mm)`);

// 2. gears
const { m, ring, fixed } = GEO.gear;
ok(Math.abs(m * ring / 2 - m * fixed / 2 - GEO.e) < 1e-9, `pitch radii ${m * ring / 2} and ${m * fixed / 2} mm, difference = e = ${GEO.e} mm`);
const fixedPts = E.gearOutline(fixed, m, false, E.FIXED_PH, 40), ringPts = E.gearOutline(ring, m, true, E.RING_PH, 40);
for (const off of [0, Math.PI]) {
  let hit = 0, minC = Infinity;
  for (let i = 0; i < 1080; i++) {
    const t = i / 1080 * TAU * 3, k = E.kin(t, off), ca = Math.cos(k.a), sa = Math.sin(k.a);
    for (const [x, y] of fixedPts) {     // fixed tooth point in the rotor frame vs the ring boundary
      const dx = x - k.c[0], dy = y - k.c[1], qx = dx * ca + dy * sa, qy = -dx * sa + dy * ca;
      const phi = Math.atan2(qy, qx), rr = E.gearR(phi, ring, m, true, E.RING_PH), d = rr - Math.hypot(qx, qy);
      if (d < 0) hit++; minC = Math.min(minC, d);
    }
    for (const [x, y] of ringPts) {      // ring tooth point in the world vs the fixed gear boundary
      const px = k.c[0] + x * ca - y * sa, py = k.c[1] + x * sa + y * ca;
      const d = Math.hypot(px, py) - E.gearR(Math.atan2(py, px), fixed, m, false, E.FIXED_PH);
      if (d < 0) hit++; minC = Math.min(minC, d);
    }
  }
  ok(hit === 0, `gears clear for eccentric ${off ? '180°' : '0°'}: ${hit} overlaps, least radial clearance ${minC.toFixed(3)} mm`);
}

// 3. volumes
const V = E.volumes();
const swept = V.Vmax - V.Vmin;
ok(Math.abs(swept / E.SWEPT - 1) < 0.01, `swept ${(swept / 1000).toFixed(1)} cm³ vs 3√3 e R W = ${(E.SWEPT / 1000).toFixed(1)} cm³`);
ok(V.CR > 8 && V.CR < 11, `compression ratio ${V.CR.toFixed(2)} (Vmin ${(V.Vmin / 1000).toFixed(1)} cm³, pockets ${(V.pocketVol / 1000).toFixed(1)} cm³)`);
const Vw = w => E.volumeAt(w - Math.PI / 2 - Math.PI / 3);
let wMin = 0, wMax = 0, lo = Infinity, hi = -Infinity;
for (let i = 0; i < 3600; i++) { const w = i / 3600 * Math.PI; const v = Vw(w); if (v < lo) { lo = v; wMin = w; } if (v > hi) { hi = v; wMax = w; } }
// on w in [0, π): the min sits at 0 (the waist), the max at π/2
ok(Math.abs(wMax / D - 90) < 1 && (wMin / D < 1 || wMin / D > 179), `on the bottom half: max volume at w = ${(wMax / D).toFixed(1)}°, min at ${(wMin / D).toFixed(1)}°`);
ok(Math.abs(Vw(Math.PI) - V.Vmin) / V.Vmin < 0.01, `top waist (plugs) at minimum volume: ${(Vw(Math.PI) / 1000).toFixed(1)} cm³`);
const ch = E.chambers(0);
ok(ch.map(c => c.stroke).sort().join() !== '0,0,0', `strokes at t=0: ${ch.map(c => E.STROKES[c.stroke].name).join(', ')}`);

// 4. 1/3 speed
const k0 = E.kin(0), k1 = E.kin(TAU);
ok(Math.abs((k1.a - k0.a) - TAU / 3) < 1e-12, 'one shaft turn turns the rotor 120°');
ok(Math.abs(E.LEAN_MAX / D - 25.38) < 0.1, `largest apex seal lean ${(E.LEAN_MAX / D).toFixed(2)}° = asin(3/K)`);
let maxLean = 0; for (let i = 0; i < 3600; i++) maxLean = Math.max(maxLean, Math.abs(E.kin(i / 3600 * TAU).lean[0]));
ok(Math.abs(maxLean - E.LEAN_MAX) < 0.002, `measured lean ${(maxLean / D).toFixed(2)}°`);

// 5. torque and work
const C = E.cycleLoop(2880);
let Tm = 0; const N = 3600;
for (let i = 0; i < N; i++) Tm += E.torque(i / N * TAU * 3) / N;
ok(Math.abs(Tm - C.meanTorque) / C.meanTorque < 0.02, `mean torque ${Tm.toFixed(1)} N·m vs work/2π ${C.meanTorque.toFixed(1)} N·m (work ${C.work.toFixed(0)} J per cycle)`);

// 6. V(θ) = Vmin + Vs/2 (1 - cos(2θ/3)), θ the shaft angle from the waist
let dev = 0;
for (let i = 0; i < 1440; i++) {
  const th = i / 1440 * TAU * 3, v = E.volumeAt(th / 3 - Math.PI / 2 - Math.PI / 3);
  dev = Math.max(dev, Math.abs(v - (V.Vmin + (V.Vmax - V.Vmin) / 2 * (1 - Math.cos(2 * th / 3)))));
}
ok(dev < 50, `volume is sinusoidal in the shaft angle (largest error ${(dev / 1000).toExponential(1)} cm³)`);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
