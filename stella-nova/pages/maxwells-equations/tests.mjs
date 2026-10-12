// ============================================================================
//  MAXWELL'S EQUATIONS  ·  tests.mjs — the laws and the geometry in geom.js
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/maxwells-equations/tests.mjs
//  Each check computes both sides of an identity from geom.js and compares
//  them. The exit code is 1 when a check fails. Units: eps0 = mu0 = c = 1.
//
//    gauss       flux through deformed closed surfaces = enclosed charge,
//                by quadrature and by counting field lines
//    monopole    net B flux through closed surfaces = 0, by quadrature and
//                by counting closed field lines
//    faraday     the flux of B through two spanning surfaces of one loop is
//                the same, and equals the loop integral of A; the EMF is
//                -dPhi/dt
//    ampere      loop B = I_cond + dPhi_E/dt through a flat disc and a bag
//                through the capacitor gap
//    stokes      int_path df = f(b) - f(a); loop alpha = int d alpha;
//                int d beta = closed-surface beta, on the scene's own map
//    cochains    d1 d0 = 0 and d2 d1 = 0 on random cochains; discrete Stokes
//    forms       sheet and tube counts of the forms chapter
//    wave        the plane wave obeys all four laws (finite differences)
// ============================================================================
import * as G from './geom.js';

let fails = 0, n = 0;
function check(name, ok, detail) {
  n++; if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
}
const f5 = v => (+v).toFixed(5);
const TAU = G.TAU;

// A closed star surface as P(u, v): u = polar angle / pi, v = azimuth / tau.
// The normal dP/du x dP/dv points outward.
const starP = S => (u, v) => {
  const th = Math.PI * u, ph = TAU * v;
  return S.point([Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]);
};

// ── Gauss ──────────────────────────────────────────────────────────────────
const Q = [{ z: 0.55, q: 2 }, { z: -0.5, q: -1 }, { z: -1.6, q: 1 }];
const E = p => G.eAxis(Q, p);
const lines = G.axisLines(Q, { perUnit: 2, naz: 12 });
const perUnit = 2 * 12;
for (const [name, opt] of [
  ['round +2 only', { c: [0, 0, 0.6], R0: 0.5, amp: 0.25, seed: 3, t: 1.1 }],
  ['round +2 and -1', { c: [0.1, 0, 0.05], R0: 1.0, amp: 0.3, seed: 7, t: 2.4 }],
  ['round all three', { c: [0, 0.1, -0.5], R0: 1.8, amp: 0.25, seed: 11, t: 0.3 }],
  ['round -1 only', { c: [0, 0, -0.5], R0: 0.45, amp: 0.3, seed: 5, t: 4.0 }],
  ['round no charge', { c: [1.2, 0.3, 0], R0: 0.5, amp: 0.3, seed: 9, t: 1.7 }],
]) {
  const S = G.starSurface({ c: opt.c, R0: opt.R0, amp: opt.amp, lobes: G.makeLobes(opt.seed) });
  S.t = opt.t;
  const qenc = Q.reduce((s, c) => s + (S.inside([0, 0, c.z]) < 0 ? c.q : 0), 0);
  const flux = G.surfaceFlux(E, starP(S), 160, 160);
  check(`gauss ${name}: quadrature flux = Q_enc`, Math.abs(flux - qenc) < 2e-3, `flux ${f5(flux)}  Q_enc ${qenc}`);
  const cr = G.crossings(lines, S.inside);
  check(`gauss ${name}: net lines out / lines per unit = Q_enc`, (cr.out - cr.inn) === qenc * perUnit, `out ${cr.out}  in ${cr.inn}  per unit ${perUnit}`);
}
check('gauss: every line of the +2 ends on -1 or leaves', lines.every(L => L.to === -1 || Q[L.to].q < 0));
{
  // One unit of charge per tube: lines that end on -1 are perUnit of them.
  const ends = lines.filter(L => L.to === 1).length;
  check('gauss: the -1 charge takes exactly 1 unit of lines', ends === perUnit, `${ends} of ${perUnit}`);
}

// ── no monopoles ───────────────────────────────────────────────────────────
const a = 1;
const B = p => G.ringB(a, p);
{
  // ringB against curl A by finite differences
  const cA = G.curl(p => G.ringA(a, p));
  let worst = 0;
  for (const p of [[0.3, 0.2, 0.4], [1.4, -0.3, 0.2], [0.1, 0.9, -0.7], [2, 1, 1.5]]) {
    const b1 = B(p), b2 = cA(p);
    worst = Math.max(worst, G.len(G.sub(b1, b2)) / G.len(b1));
  }
  check('ring: B = curl A', worst < 1e-5, `worst rel ${worst.toExponential(2)}`);
  const bz0 = B([0, 0, 0])[2];
  check('ring: B at the centre = mu0 I / 2a', Math.abs(bz0 - 0.5) < 1e-9, `${bz0}`);
}
const rl = G.ringLines(a, { n: 6, dPsi: 0.55, naz: 10 });
check('ring: field lines close', rl.length === 60, `${rl.length} closed lines`);
for (const [name, opt] of [
  ['round the whole ring', { c: [0, 0, 0], R0: 1.6, amp: 0.25, seed: 2, t: 0.7 }],
  ['round one side of the wire', { c: [0.9, 0.2, 0.3], R0: 0.6, amp: 0.3, seed: 4, t: 2.2, pierced: true }],
  ['beside the wire', { c: [1.55, 0.2, 0.1], R0: 0.35, amp: 0.3, seed: 8, t: 0.9 }],
  ['inside the ring', { c: [0, 0, 0.2], R0: 0.55, amp: 0.3, seed: 6, t: 1.3 }],
]) {
  const S = G.starSurface({ c: opt.c, R0: opt.R0, amp: opt.amp, lobes: G.makeLobes(opt.seed) });
  S.t = opt.t;
  // quadrature that avoids the wire singularity: the test surfaces keep clear of it
  // A surface that the wire pierces has an integrable 1/r peak there, so
  // the net flux is compared with the flux through one half of the surface.
  const fl = G.surfaceFlux(B, starP(S), 240, 240), half = Math.abs(G.surfaceFlux(B, (u, v) => starP(S)(u / 2, v), 240, 240));
  const cr = G.crossings(rl, S.inside);
  if (opt.pierced) {
    // The 1/r peak makes the midpoint rule converge slowly: the net must
    // fall to less than half between the 160 and the 240 grid.
    const coarse = G.surfaceFlux(B, starP(S), 160, 160);
    check(`monopole ${name} (the wire pierces it): net flux -> 0 as the grid refines`, Math.abs(fl) < 2e-2 * half && Math.abs(fl) < Math.abs(coarse) / 2, `net ${fl.toExponential(2)} (240)  ${coarse.toExponential(2)} (160)  half-surface flux ${half.toFixed(4)}`);
  } else check(`monopole ${name}: quadrature net flux = 0`, Math.abs(fl) < 1e-3 * half, `net ${fl.toExponential(2)}  half-surface flux ${half.toFixed(4)}`);
  check(`monopole ${name}: lines out = lines in`, cr.out === cr.inn && cr.out > 0, `out ${cr.out}  in ${cr.inn}`);
}

// ── Faraday ────────────────────────────────────────────────────────────────
function loopFrame(z0, rho, tilt) {
  const c = [0, 0, z0], n = [0, Math.sin(tilt), Math.cos(tilt)], e1 = [1, 0, 0], e2 = G.cross(n, e1);
  return { c, n, e1, e2, rho };
}
const Cloop = L => s => G.add(L.c, G.add(G.mul(L.e1, L.rho * Math.cos(TAU * s)), G.mul(L.e2, L.rho * Math.sin(TAU * s))));
const disc = L => (u, v) => G.add(L.c, G.add(G.mul(L.e1, u * L.rho * Math.cos(TAU * v)), G.mul(L.e2, u * L.rho * Math.sin(TAU * v))));
const dome = (L, h) => (u, v) => G.add(disc(L)(u, v), G.mul(L.n, h * (1 - u * u)));
for (const [z0, rho, tilt, h] of [[0.6, 0.7, 0.2, 0.6], [1.1, 1.2, -0.35, -0.5], [0.8, 0.4, 0.5, 0.9]]) {
  const L = loopFrame(z0, rho, tilt);
  const fA = G.loopIntegral(p => G.ringA(a, p), Cloop(L), 2048);
  const f1 = G.surfaceFlux(B, disc(L), 120, 240), f2 = G.surfaceFlux(B, dome(L, h), 120, 240);
  check(`faraday loop z=${z0} rho=${rho}: flat disc flux = dome flux`, Math.abs(f1 - f2) < 2e-4 * Math.max(1, Math.abs(f1)), `disc ${f5(f1)}  dome ${f5(f2)}`);
  check(`faraday loop z=${z0} rho=${rho}: flux = loop integral of A`, Math.abs(f1 - fA) < 2e-4 * Math.max(1, Math.abs(f1)), `flux ${f5(f1)}  loop A ${f5(fA)}`);
  // I(t) = cos(w t): EMF = loop of -dA/dt = -dPhi/dt
  const w = 1.3, t = 0.7, dt = 1e-4;
  const emf = G.loopIntegral(p => G.mul(G.ringA(a, p), w * Math.sin(w * t)), Cloop(L), 2048);
  const dphi = (Math.cos(w * (t + dt)) - Math.cos(w * (t - dt))) / (2 * dt) * fA;
  check(`faraday loop z=${z0}: EMF = -dPhi/dt`, Math.abs(emf + dphi) < 1e-6 + 1e-4 * Math.abs(emf), `EMF ${f5(emf)}  -dPhi/dt ${f5(-dphi)}`);
}

// ── Ampere-Maxwell ─────────────────────────────────────────────────────────
const cap = { a: 0.9, g: 0.25 };
for (const [r0, z0] of [[0.6, 0.9], [1.3, 0.55], [0.4, -1.2]]) {
  const I = 0.8;
  const pd = G.profileCurrent(cap, G.discProfile(r0, z0), I), pb = G.profileCurrent(cap, G.bagProfile(cap, r0, z0), I);
  const loopB = G.loopIntegral(p => G.capB(cap, p, I), s => [r0 * Math.cos(TAU * s), r0 * Math.sin(TAU * s), z0], 1024);
  const sign = Math.sign(z0);
  // The bag of a loop below the gap points the other way round the gap, so
  // its displacement current is counted with the loop's own orientation.
  check(`ampere loop r=${r0} z=${z0}: flat disc carries I by conduction`, pd.cond === I && pd.disp === 0, `cond ${pd.cond}  disp ${pd.disp}`);
  check(`ampere loop r=${r0} z=${z0}: bag carries I by displacement`, pb.cond === 0 && Math.abs(pb.disp - I) < 2e-3, `cond ${pb.cond}  disp ${f5(pb.disp)}  side ${sign}`);
  check(`ampere loop r=${r0} z=${z0}: loop B = I`, Math.abs(loopB - I) < 1e-5, `loop B ${f5(loopB)}`);
  // independent 3D quadrature of the displacement current through the bag
  const P = G.revolve(G.bagProfile(cap, r0, z0));
  const q = -G.surfaceFlux(p => G.capJd(cap, p, I), P, 1600, 64);
  check(`ampere loop r=${r0} z=${z0}: 3D quadrature of dE/dt through the bag = I`, Math.abs(q - I) < 4e-3, `${f5(q)}`);
}
{
  const I = 0.8, r0 = 0.45, z0 = 0.1;
  const s = G.capSplit(cap, r0, z0, I);
  const loopB = G.loopIntegral(p => G.capB(cap, p, I), u => [r0 * Math.cos(TAU * u), r0 * Math.sin(TAU * u), z0], 1024);
  check('ampere loop inside the gap: loop B = displacement current only', s.cond === 0 && Math.abs(loopB - s.disp) < 1e-5 && s.disp < I, `loop B ${f5(loopB)}  disp ${f5(s.disp)}`);
  // continuity: curl B = J_total in the gap, by finite differences
  const cB = G.curl(p => G.capB(cap, p, I))([0.3, 0.2, 0.05]);
  check('ampere: curl B = dE/dt between the plates', Math.abs(cB[2] - I / (Math.PI * cap.a ** 2)) < 1e-4, `curl B_z ${f5(cB[2])}  dE/dt ${f5(I / (Math.PI * cap.a ** 2))}`);
}

// ── generalized Stokes on the scene's own map ──────────────────────────────
{
  const M = G.stokesMap, S = G.SAMPLE;
  // path: v = w = 0
  const path = s => M(s, 0, 0);
  const lhs1 = G.loopIntegral(S.df, path, 4096), rhs1 = S.f(path(1)) - S.f(path(0));
  check('stokes 1D: int_path df = f(b) - f(a)', Math.abs(lhs1 - rhs1) < 1e-5, `${f5(lhs1)}  ${f5(rhs1)}`);
  // sheet: w = 0, boundary loop u: 0->1 at v=0, v: 0->1 at u=1, back at v=1, back at u=0
  const sheet = (u, v) => M(u, v, 0);
  const loop = s => { const q = 4 * s; if (q < 1) return M(q, 0, 0); if (q < 2) return M(1, q - 1, 0); if (q < 3) return M(3 - q, 1, 0); return M(0, 4 - q, 0); };
  const lhs2 = G.surfaceFlux(S.dalpha, sheet, 200, 200), rhs2 = G.loopIntegral(S.alpha, loop, 8192);
  check('stokes 2D: int_sheet d alpha = loop alpha', Math.abs(lhs2 - rhs2) < 1e-3, `${f5(lhs2)}  ${f5(rhs2)}`);
  check('stokes 2D: the numeric curl agrees with d alpha', G.len(G.sub(G.curl(S.alpha)([0.3, -0.2, 0.5]), S.dalpha([0.3, -0.2, 0.5]))) < 1e-6);
  // solid: the six faces of the map with outward normals
  const faces = [
    [(u, v) => M(1, u, v), 1], [(u, v) => M(0, u, v), -1],
    [(u, v) => M(v, 1, u), 1], [(u, v) => M(v, 0, u), -1],
    [(u, v) => M(u, v, 1), 1], [(u, v) => M(u, v, 0), -1],
  ];
  const vol = G.volumeIntegral(S.dbeta, M, 40);
  const jac = (() => { const e = 1e-5, m = [0.5, 0.5, 0.5]; const d = k => { const p = m.slice(), q = m.slice(); p[k] += e; q[k] -= e; return G.mul(G.sub(M(...p), M(...q)), 1 / (2 * e)); }; return G.dot(d(0), G.cross(d(1), d(2))); })();
  const surf = faces.reduce((s, [P, sg]) => s + sg * G.surfaceFlux(S.beta, P, 160, 160), 0);
  check('stokes 3D: the map keeps orientation', jac > 0, `jacobian ${f5(jac)}`);
  check('stokes 3D: int_solid d beta = closed-surface beta', Math.abs(vol - surf) < 2e-3 * Math.max(1, Math.abs(vol)), `${f5(vol)}  ${f5(surf)}`);
  check('stokes 3D: the numeric div agrees with d beta', Math.abs(G.div(S.beta)([0.2, 0.4, -0.3]) - S.dbeta([0.2, 0.4, -0.3])) < 1e-6);
}

// ── cochains: dd = 0 and discrete Stokes ───────────────────────────────────
{
  const K = G.cubeComplex(3), r = G.rng(42);
  const w0 = Array.from({ length: K.nv }, () => r() * 2 - 1);
  const w1 = K.edges.map(() => r() * 2 - 1);
  const dd0 = K.d1(K.d0(w0)), dd1 = K.d2(K.d1(w1));
  check('cochains: d1 d0 = 0 (curl grad = 0)', dd0.every(v => Math.abs(v) < 1e-12), `max ${Math.max(...dd0.map(Math.abs)).toExponential(1)}`);
  check('cochains: d2 d1 = 0 (div curl = 0)', dd1.every(v => Math.abs(v) < 1e-12), `max ${Math.max(...dd1.map(Math.abs)).toExponential(1)}`);
  // each interior face is shared by two cells with opposite signs
  const w2 = K.faces.map(() => r() * 2 - 1);
  const inside = K.d2(w2).reduce((s, v) => s + v, 0), bd = K.boundary.reduce((s, [f, sg]) => s + sg * w2[f], 0);
  check('cochains: sum of d w over cells = w over the outer faces', Math.abs(inside - bd) < 1e-12, `${inside.toFixed(9)}  ${bd.toFixed(9)}`);
  const use = new Map();
  for (const c of K.cells) for (const [f, sg] of c.bd) use.set(f, (use.get(f) || 0) + sg);
  const interior = [...use.entries()].filter(([f]) => !K.boundary.some(([b]) => b === f));
  check('cochains: every interior face cancels', interior.every(([, s]) => s === 0), `${interior.length} interior faces`);
}

// ── the forms chapter: sheets and tubes ────────────────────────────────────
{
  // E of a point charge q: sheets are the spheres phi = k dphi. A path from
  // a to b crosses (phi(a) - phi(b)) / dphi sheets, net.
  const Qc = [{ z: 0, q: 1 }], dphi = 0.02;
  const pa = [0.25, 0.1, 0.05], pb = [1.6, -0.9, 0.4];
  const line = G.loopIntegral(p => G.eAxis(Qc, p), s => G.add(pa, G.mul(G.sub(pb, pa), s)), 4096);
  const sheets = (G.phiAxis(Qc, pa) - G.phiAxis(Qc, pb)) / dphi;
  check('forms: int E dl = phi(a) - phi(b)', Math.abs(line - sheets * dphi) < 1e-6, `${f5(line)}  ${f5(sheets * dphi)}`);
  // B of a wire: a rectangle in the half-plane phi = 0 from r1 to r2 and
  // height h carries (I / 2 pi) ln(r2/r1) h.
  const I = 1, r1 = 0.3, r2 = 1.7, h = 0.8;
  const fl = G.surfaceFlux(p => G.wireB(p, I), (u, v) => [r1 + (r2 - r1) * u, 0, h * v], 400, 20);
  check('forms: wire flux through a half-plane strip = (I/2pi) ln(r2/r1) h', Math.abs(Math.abs(fl) - I / TAU * Math.log(r2 / r1) * h) < 1e-5, `${f5(Math.abs(fl))}`);
  // star B as a 1-form: the loop round the wire = I (sheets crossed)
  const lp = G.loopIntegral(p => G.wireB(p, I), s => [0.7 * Math.cos(TAU * s) + 0.1, 0.5 * Math.sin(TAU * s), 0.2 * Math.sin(2 * TAU * s)], 4096);
  check('forms: any loop round the wire crosses I sheets of star B', Math.abs(lp - I) < 1e-5, f5(lp));
}

// ── the plane wave obeys the four laws ─────────────────────────────────────
{
  const t = 0.37, h = 1e-4;
  const Ef = p => G.waveEB(p[2], t).E, Bf = p => G.waveEB(p[2], t).B;
  const p = [0.2, -0.4, 0.83];
  const dBdt = G.mul(G.sub(G.waveEB(p[2], t + h).B, G.waveEB(p[2], t - h).B), 1 / (2 * h));
  const dEdt = G.mul(G.sub(G.waveEB(p[2], t + h).E, G.waveEB(p[2], t - h).E), 1 / (2 * h));
  check('wave: div E = 0 and div B = 0', Math.abs(G.div(Ef)(p)) < 1e-8 && Math.abs(G.div(Bf)(p)) < 1e-8);
  check('wave: curl E = -dB/dt', G.len(G.add(G.curl(Ef)(p), dBdt)) < 1e-6, `curl E ${G.curl(Ef)(p).map(f5)}`);
  check('wave: curl B = dE/dt', G.len(G.sub(G.curl(Bf)(p), dEdt)) < 1e-6, `curl B ${G.curl(Bf)(p).map(f5)}`);
  const SI = 1 / Math.sqrt(1.25663706212e-6 * 8.8541878128e-12);
  check('wave: 1/sqrt(mu0 eps0) = 2.998e8 m/s in SI', Math.abs(SI - 299792458) < 50, `${SI.toFixed(1)} m/s`);
}

// ── elliptic integrals ─────────────────────────────────────────────────────
{
  const [K0, E0] = G.ellipKE(0), [K5, E5] = G.ellipKE(0.5);
  check('ellipKE: K(0) = E(0) = pi/2', Math.abs(K0 - Math.PI / 2) < 1e-14 && Math.abs(E0 - Math.PI / 2) < 1e-14);
  check('ellipKE: K(1/2), E(1/2) table values', Math.abs(K5 - 1.8540746773013719) < 1e-12 && Math.abs(E5 - 1.3506438810476755) < 1e-12, `${K5} ${E5}`);
}

console.log(`\n${n - fails}/${n} checks passed`);
process.exit(fails ? 1 : 0);
