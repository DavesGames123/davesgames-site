// ============================================================================
//  MAXWELL'S EQUATIONS  ·  tests.mjs  ·  the four laws against physics.js
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/maxwells-equations/tests.mjs
//  Each check computes both sides of a law from the field model and
//  compares them. Exit code 1 if a check fails.
//
//    gauss-E    flux through spheres that hold different charge sets equals
//               q_enc / eps0; the per-charge flux agrees with a brute-force
//               sphere quadrature of the summed Coulomb field
//    gauss-B    net B flux is zero through spheres round the magnet and the
//               capacitor, while the outward part is not zero
//    faraday    the line integral of the induced E equals -dPhi_B/dt for a
//               magnet that moves at a known speed; the sign obeys Lenz;
//               the same for the capacitor current through a rectangle
//    ampere     the line integral of B equals mu0 (I_enc + eps0 dPhi_E/dt)
//               between the plates and round the wire, and the
//               displacement term is necessary
//    light      a pulse on the Yee grid moves at 1/sqrt(mu0 eps0)
//    panel      each panels.js scene readout obeys its law
// ============================================================================
import {
  EPS0, MU0, SI_EPS0, SI_MU0, lightSpeed, coulomb, sphereFluxCharges, chargeInside, sphereFlux,
  magnetSegments, segB, MAGNET, makeCapacitor, capB, faradayMagnet, faradayRect, ampereMaxwell, Wave1D, loopIntegral,
} from './physics.js';

let fails = 0, n = 0;
function check(name, ok, detail) {
  n++; if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
}
const rel = (a, b, s = Math.max(Math.abs(a), Math.abs(b), 1e-12)) => Math.abs(a - b) / s;
const f6 = v => v.toFixed(6);

// ── Gauss E ────────────────────────────────────────────────────────────────
const charges = [{ x: -40, y: 10, z: 0, q: 2 }, { x: 35, y: -20, z: 0, q: -1 }, { x: 90, y: 60, z: 0, q: 1 }, { x: -120, y: -80, z: 0, q: -3 }];
const spheres = [
  { name: '{+2, -1}', c: [0, 0, 0], R: 70 },
  { name: '{+2, -3}', c: [-80, -35, 0], R: 70 },
  { name: 'all four', c: [-10, -10, 0], R: 160 },
  { name: 'none', c: [150, -120, 0], R: 40 },
  { name: '{+1}, rim 0.5 from the charge', c: [110, 10, 0], R: 54.35 },
  { name: '{+2, -1, +1}, off-plane centre', c: [20, 10, 30], R: 95 },
];
for (const s of spheres) {
  const flux = sphereFluxCharges(charges, ...s.c, s.R), qenc = chargeInside(charges, ...s.c, s.R);
  check(`gauss-E ${s.name}: flux = q_enc/eps0`, Math.abs(flux - qenc / EPS0) < 1e-6, `flux ${f6(flux)}  q_enc/eps0 ${f6(qenc / EPS0)}`);
}
{
  const s = spheres[0], E = (x, y, z, o) => coulomb(charges, x, y, z, o);
  const brute = sphereFlux(E, ...s.c, s.R, 64, 128).net, fast = sphereFluxCharges(charges, ...s.c, s.R);
  check('gauss-E brute-force sphere quadrature agrees', Math.abs(brute - fast) < 1e-4, `brute ${f6(brute)}  per-charge ${f6(fast)}`);
}

// ── Gauss B ────────────────────────────────────────────────────────────────
const mag = magnetSegments(0, 0, 0.4);
const Bm = (x, y, z, o) => segB(mag, x, y, z, MAGNET.soft, 1, o);
for (const [name, c, R] of [['round the magnet', [0, 0, 0], 80], ['round the north end only', [30, 14, 0], 30], ['through the side', [0, 25, 0], 40]]) {
  const f = sphereFlux(Bm, ...c, R);
  check(`gauss-B magnet ${name}: net = 0`, Math.abs(f.net) < 2e-3 * f.out && f.out > 1e-3, `out ${f.out.toFixed(4)}  in ${f.in.toFixed(4)}  net ${f.net.toExponential(2)}`);
}
const cap = makeCapacitor();
{
  const Bc = (x, y, z, o) => capB(cap, 1, x, y, z, o);
  const f = sphereFlux(Bc, -cap.gap / 2, 30, 0, 60);
  check('gauss-B capacitor, sphere off the axis round a plate: net = 0', Math.abs(f.net) < 2e-3 * f.out && f.out > 1e-4, `out ${f.out.toFixed(5)}  in ${f.in.toFixed(5)}  net ${f.net.toExponential(2)}`);
}

// ── Faraday ────────────────────────────────────────────────────────────────
// Known motion: X(t) = X0 + V t, the north end towards a loop at x = 0.
const loop = { x: 0, R: 34 };
for (const [X, V] of [[-80, 25], [-120, 40], [-70, -30]]) {
  const r = faradayMagnet(X, V, loop);
  check(`faraday magnet at X=${X}, V=${V}: EMF line integral = -dPhi/dt`, rel(r.emfLine, r.emfFlux) < 2e-3, `EMF ${r.emfLine.toFixed(5)}  -dPhi/dt ${r.emfFlux.toFixed(5)}  Phi ${r.phi.toFixed(4)}`);
}
{
  // -dPhi/dt from two flux values along the motion, not from dPhi/dX.
  const V = 25, X0 = -80, dt = 0.01;
  const p1 = faradayMagnet(X0 - V * dt, V, loop).phi, p2 = faradayMagnet(X0 + V * dt, V, loop).phi, r = faradayMagnet(X0, V, loop);
  const fd = -(p2 - p1) / (2 * dt);
  check('faraday: EMF = -(Phi(t+dt) - Phi(t-dt)) / 2dt along the motion', rel(r.emfLine, fd) < 2e-3, `EMF ${r.emfLine.toFixed(5)}  finite difference ${fd.toFixed(5)}`);
  // Lenz: the induced current I = EMF / R makes a B at the loop centre
  // that opposes the change of flux.
  const ring = magnetSegments(loop.x, 0, 0, { half: 0, radius: loop.R, rings: 1, segs: 64, current: r.emfLine, soft: 0.5 });
  const Bind = segB(ring, loop.x, 0, 0, 0.5)[0];
  check('faraday: Lenz, induced B opposes dPhi/dt', Math.sign(Bind) === -Math.sign(r.dPhidX * V) && r.dPhidX * V > 0, `dPhi/dt ${(r.dPhidX * V).toFixed(4)}  induced B ${Bind.toExponential(2)}`);
}
{
  const rect = { x0: -60, y0: 20, x1: 40, y1: 70 }, I = 0.7, dIdt = -1.3;
  const r = faradayRect(cap, rect, I, dIdt);
  check('faraday capacitor current, rectangle above the wire: EMF = -dPhi/dt', rel(r.emfLine, r.emfFlux) < 2e-3, `EMF ${r.emfLine.toFixed(5)}  -dPhi/dt ${r.emfFlux.toFixed(5)}`);
}

// ── Ampere-Maxwell ─────────────────────────────────────────────────────────
const I = 1.5;
for (const [name, lp] of [['between the plates, s = 0.5 Rp', { x: 0, s: 0.5 * cap.Rp }], ['between the plates, s = 1.0 Rp', { x: 0, s: cap.Rp }],
  ['between the plates, s = 1.6 Rp', { x: 8, s: 1.6 * cap.Rp }], ['round the wire near the plate', { x: -cap.gap / 2 - 25, s: 30 }], ['round the wire far away', { x: -400, s: 30 }]]) {
  const r = ampereMaxwell(cap, I, lp);
  check(`ampere-maxwell ${name}: loop B = mu0 (I_enc + eps0 dPhi_E/dt)`, rel(r.lhs, r.rhs, MU0 * I) < 1e-3,
    `lhs ${f6(r.lhs)}  mu0 I_enc ${f6(MU0 * r.Ienc)}  mu0 eps0 dPhiE/dt ${f6(MU0 * r.disp)}  rhs ${f6(r.rhs)}`);
}
{
  const gap = ampereMaxwell(cap, I, { x: 0, s: 0.8 * cap.Rp }), near = ampereMaxwell(cap, I, { x: -cap.gap / 2 - 25, s: 30 });
  check('ampere-maxwell: in the gap I_enc = 0 but loop B is not 0', gap.Ienc === 0 && Math.abs(gap.lhs) > 0.2 * MU0 * I, `I_enc ${gap.Ienc}  lhs ${f6(gap.lhs)}`);
  check('ampere-maxwell: near the plate, mu0 I alone misses', Math.abs(near.lhs - MU0 * near.Ienc) > 1e-2 * MU0 * I, `lhs ${f6(near.lhs)}  mu0 I_enc ${f6(MU0 * near.Ienc)}`);
}

// ── Light ──────────────────────────────────────────────────────────────────
{
  const c = lightSpeed(SI_MU0, SI_EPS0);
  check('light: 1/sqrt(mu0 eps0) = 2.998e8 m/s', Math.abs(c - 299792458) < 50, `${c.toFixed(1)} m/s`);
  const w = new Wave1D({ n: 1200, dx: 1, dt: 1.5e-9 }), src = 100, a = 300, b = 900;
  const t0 = 60, tau = 15;   // Gaussian pulse in time, steps
  let pa = [0, -1], pb = [0, -1];
  for (let k = 0; k < 3000; k++) {
    w.step(src, Math.exp(-(((k - t0) / tau) ** 2)));
    if (Math.abs(w.E[a]) > pa[0]) pa = [Math.abs(w.E[a]), w.t];
    if (Math.abs(w.E[b]) > pb[0]) pb = [Math.abs(w.E[b]), w.t];
  }
  const v = (b - a) * w.dx / (pb[1] - pa[1]);
  check('light: Yee pulse speed = 1/sqrt(mu0 eps0)', rel(v, c) < 5e-3, `measured ${v.toExponential(4)} m/s  c ${c.toExponential(4)} m/s`);
}

// ── panels.js readouts ─────────────────────────────────────────────────────
{
  const P = await import('./panels.js');
  P.faradayPageTable().fill();
  const sim = { t: 1.3, strength: 1, speed: 1 };
  for (const C of [P.GaussE, P.GaussB, P.Faraday, P.Ampere, P.CapGaussE, P.CapGaussB, P.CapFaraday]) {
    const s = new C(); for (let i = 0; i < 30; i++) s.step(1 / 60, sim);
    const r = s.readout(), rhs = r.zero ? 0 : r.rhs.reduce((a, x) => a + x.v, 0);
    const scale = r.zero ? Math.abs(r.rhs[0].v) : Math.max(Math.abs(rhs), 1e-9);
    check(`panel ${C.name}: lhs = rhs`, Math.abs(r.lhs.v - rhs) < (r.zero ? 5e-3 : 2e-3) * scale, `lhs ${r.lhs.v.toExponential(4)}  rhs ${rhs.toExponential(4)}`);
  }
}

console.log(`\n${n - fails}/${n} checks passed`);
process.exit(fails ? 1 : 0);
