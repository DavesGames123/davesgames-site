// ============================================================================
//  FOUR-STROKE ENGINE  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks engine.js in Node: the slider-crank, the firing order, the valve
//  events, the half-speed cam, the clearances between the moving parts, and
//  the cycle numbers. Exit code 1 on any failure.
// ============================================================================
import * as E from './engine.js';
const { GEO } = E;
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('FAIL', msg); } };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// slider-crank
near(E.pistonX(0), GEO.r + GEO.l, 1e-9, 'x(0) = r + l');
near(E.pistonX(180), GEO.l - GEO.r, 1e-9, 'x(180) = l − r');
for (let th = 0; th < 360; th += 7) {
  const h = 1e-4, num = (E.pistonX(th + h / E.D) - E.pistonX(th - h / E.D)) / (2 * h);
  near(E.pistonDx(th), num, 1e-3, `dx/dθ at ${th}`);
}

// firing order: every 180° the next cylinder in 1-3-4-2 reaches its firing TDC
E.FIRING.forEach((k, i) => {
  near(E.psiOf(k, i * 180), 0, 1e-9, `cylinder ${k} fires at θ = ${i * 180}`);
  near(E.pistonX(E.crankOf(k, i * 180)), GEO.r + GEO.l, 1e-9, `cylinder ${k} at TDC when it fires`);
});
// pins 1 and 4 together, 2 and 3 together, 180° apart
near(E.crankOf(1, 33), E.crankOf(4, 33), 1e-9, 'pins 1 and 4 in phase');
near(E.crankOf(2, 33), E.crankOf(3, 33), 1e-9, 'pins 2 and 3 in phase');
near(E.mod(E.crankOf(2, 33) - E.crankOf(1, 33), 360), 180, 1e-9, 'pins 1 and 2 opposed');

// valve events and the half-speed cam, both trains
for (const T of Object.values(E.TRAINS)) {
  const m = E.measuredTiming(T);
  near(m.in.open, E.TIMING.ivo, 2, `${T.id} IVO`);
  near(m.in.close, E.TIMING.ivc, 2, `${T.id} IVC`);
  near(m.ex.open, E.TIMING.evo, 2, `${T.id} EVO`);
  near(m.ex.close, E.TIMING.evc, 2, `${T.id} EVC`);
  ok(m.in.max > 7.5 && m.in.max < 10, `${T.id} max lift ${m.in.max}`);
  for (const v of T.valves) {
    // the same lift 720° later (one cam turn), and the cylinder's own phase
    near(E.valveLift(T, v, 100), E.valveLift(T, v, 820), 1e-6, `${T.id} ${v.id} cam period 720`);
    const psiPeak = v.kind === 'in' ? E.LOBE_CENTRE.in : E.LOBE_CENTRE.ex;
    near(E.valveLift(T, v, psiPeak + E.FIRE_AT[v.k]), m[v.kind].max, 0.05, `${T.id} ${v.id} peaks at its ψ`);
    ok(E.valveLift(T, v, E.FIRE_AT[v.k] + 60) < 1e-6, `${T.id} ${v.id} shut in the power stroke`);
  }
  // valve head versus piston crown: the lowest point of the tilted head disc
  let worst = 1e9, at = 0;
  for (const v of T.valves) for (let th = 0; th < 720; th += 0.5) {
    const L = E.valveLift(T, v, th);
    const low = GEO.seatY - L * E.AXIS.y - v.rHead * E.AXIS.z;
    const crown = E.pistonX(E.crankOf(v.k, th)) + GEO.compH;
    if (low - crown < worst) { worst = low - crown; at = th; }
  }
  ok(worst > 0.5, `${T.id} valve to piston clearance ${worst.toFixed(2)} mm at θ ${at}`);
  console.log(`${T.id}: IVO ${m.in.open} IVC ${m.in.close} EVO ${m.ex.open} EVC ${m.ex.close} lift ${m.in.max.toFixed(2)} mm, valve-piston clearance ${worst.toFixed(2)} mm`);
}
// piston skirt clears the counterweights (radius 70) at BDC
ok(E.pistonX(180) - GEO.skirt > 70 + 5, 'skirt clears the counterweights');
// crown stays under the deck
ok(E.pistonX(0) + GEO.compH < GEO.deck, 'crown below the deck at TDC');

// the gas
const c = E.cycleStats;
ok(c.W > 0, `net work per cycle positive (${c.W.toFixed(1)} J)`);
ok(c.pMaxAt > 5 && c.pMaxAt < 30, `peak pressure after TDC (${c.pMaxAt}°)`);
near(E.gasState(0).V, GEO.Vc, 1e-6, 'V at TDC = clearance volume');
near(E.gasState(180).V, GEO.Vc + GEO.Vs, 1e-6, 'V at BDC = Vc + Vs');
near(E.gasState(719.99).p, E.gasState(0).p, 1, 'pressure continuous over the wrap');
near(c.Tmean * 4 * Math.PI, 4 * c.W, 4 * c.W * 0.01, 'mean torque × 4π = 4 cylinders × W');
console.log(`W ${c.W.toFixed(1)} J · IMEP ${c.imep.toFixed(2)} bar · p max ${c.pMax.toFixed(1)} bar at ${c.pMaxAt}° · T mean ${c.Tmean.toFixed(1)} N·m · Otto η ${(c.otto * 100).toFixed(1)} %`);
console.log(`${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
