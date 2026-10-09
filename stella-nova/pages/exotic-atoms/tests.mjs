// ============================================================================
//  EXOTIC ATOMS  ·  node tests
// ----------------------------------------------------------------------------
//  node tests.mjs
//  With jsdom on NODE_PATH, two more groups run: every TeX line typesets
//  with the vendor MathJax, and the page boots in jsdom with no errors.
//
//  Groups: radial and angular functions at high n · <r> · quantum defects
//  and measured lines · positronium and muonic scalings · lifetimes ·
//  probability current and orbital moment · the field of a circular state ·
//  trilobite shape features · Zeeman and Stark · strong field · the climb
//  (photon energies, selection rules, sizes, Inglis-Teller) · the saver
//  plan and shots · page markup · TeX · jsdom boot.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as P from './physics.js';
import * as S from './states.js';
import * as B from './bfield.js';
import * as K from './climb.js';

const here = new URL('.', import.meta.url).pathname;
const DEBYE_A0 = 2.541746;   // debye per e a0
let pass = 0, fail = 0;
function ok(c, msg, info = '') { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}${info ? '  ' + info : ''}`); }
const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);
const trap = (f, rMax, N = 40000) => { let s = 0, pv = 0, rp = 0; for (let i = 1; i <= N; i++) { const u = i / N, r = rMax * u * u, v = f(r); s += 0.5 * (v + pv) * (r - rp); pv = v; rp = r; } return s; };

// ── radial and angular functions ──────────────────────────────────────────
{
  const rows = [];
  let good = true;
  for (const [n, l] of [[50, 0], [50, 49], [100, 0], [100, 37], [200, 0], [200, 199], [300, 0], [300, 150]]) {
    const nrm = trap(r => P.Rnl(n, l, r) ** 2 * r * r, P.rMaxOf(n, l) * 1.1);
    const mr = trap(r => P.Rnl(n, l, r) ** 2 * r ** 3, P.rMaxOf(n, l) * 1.1);
    rows.push(`${n},${l}: ${nrm.toFixed(6)}`);
    if (!near(nrm, 1, 1e-4) || !near(mr, P.meanR(n, l), 1e-4)) good = false;
  }
  ok(good, 'radial: int R^2 r^2 = 1 and <r> = (3n^2 - l(l+1))/2 at n = 50, 100, 200, 300', rows.slice(4, 6).join(' '));
  let finite = true;
  for (const n of [50, 100, 200, 300]) for (const l of [0, n >> 1, n - 1]) for (const r of [1e-3, 1, n, n * n, 2 * n * n, 4 * n * n]) { const v = P.logRnl(n, l, r); if (Number.isNaN(v.log) || v.log === Infinity) finite = false; }
  ok(finite, 'radial: log R_nl has no NaN or overflow from r = 0.001 to 4n^2 (n up to 300)');
  let ang = true;
  for (const [l, m] of [[0, 0], [7, 3], [150, 0], [200, 200], [299, 120]]) {
    let s = 0; const N = 20000;
    for (let i = 0; i < N; i++) { const th = (i + 0.5) / N * Math.PI, v = P.logTheta(l, m, Math.cos(th)); s += v.sign ? Math.exp(2 * v.log) * Math.sin(th) : 0; }
    if (!near(s * Math.PI / N * 2 * Math.PI, 1, 1e-4)) ang = false;
  }
  ok(ang, 'angular: |Y_lm|^2 integrates to 1 up to l = 299');
  const c = S.sampleNLM(200, 3, 1, 30000, 3);
  let sr = 0, bad = 0;
  for (let i = 0; i < 30000; i++) { const r = Math.hypot(c.pts[i * 4], c.pts[i * 4 + 1], c.pts[i * 4 + 2]); sr += r; if (!Number.isFinite(r)) bad++; }
  ok(!bad && near(sr / 30000, P.meanR(200, 3), 0.01), 'sampler: the mean radius of 30000 points of |200,3,1> is <r> within 1 %', `${(sr / 30000 / P.meanR(200, 3)).toFixed(4)}`);
  const pa = S.sampleParabolic(10, 0, 0, 20000, 1);
  let z = 0; for (let i = 0; i < 20000; i++) z += pa.pts[i * 4 + 2];
  ok(near(z / 20000, 1.5 * 11 * 10, 0.02), 'parabolic: <z> of |n1 = 10, n2 = 0, m = 0> is (3/2) n k', `${(z / 20000).toFixed(1)} vs 165`);
}

// ── species ───────────────────────────────────────────────────────────────
{
  // Rydberg-Ritz written out here from Li et al. 2003 (Rb) and Deiglmayr 2016 (Cs)
  const RR = (R, d0, d2, n) => R / (n - d0 - d2 / (n - d0) ** 2) ** 2 * P.C.cmToEV;
  const cases = [['Rb', 60, 0, 109736.605, 3.1311804, 0.1784], ['Rb', 90, 2, 109736.605, 1.34646572, -0.596], ['Cs', 70, 0, 109736.8627339, 4.0493532, 0.2391], ['Cs', 45, 1, 109736.8627339, 3.5590676, 0.37469]];
  const errs = cases.map(([s, n, l, R, d0, d2]) => Math.abs(P.bindingEV(s, n, l) / RR(R, d0, d2, n) - 1));
  ok(errs.every(e => e < 1e-9), 'quantum defects: Rb and Cs binding energies equal the cited Rydberg-Ritz fits', errs.map(e => e.toExponential(1)).join(' '));
  const lines = [['Rb', 780.241], ['Cs', 852.347], ['Na', 589.158], ['Sr', 460.862]].map(([s, nm]) => { const sp = P.SPECIES[s]; return [s, P.transition(s, sp.nMin, 0, sp.nMin, 1).lam * 1e9, nm]; });
  ok(lines.every(([, a, b]) => Math.abs(a - b) < 0.01), 'measured first lines: Rb D2 780.24, Cs D2 852.35, Na D2 589.16, Sr 460.86 nm (vacuum)', lines.map(x => x[1].toFixed(2)).join(' '));
  const rbF = P.quantumDefect('Rb', 50, 4), alpha = 9.12, D = 5.5 * 5 * 4.5 * 4 * 3.5;
  ok(near(rbF, 0.75 * alpha / D, 1e-12) && rbF > 0.003 && rbF < 0.0045, 'quantum defects: Rb g series from the core polarizability (about 0.004)', rbF.toFixed(5));
  const uH = P.units('H'), uPs = P.units('Ps'), uMu = P.units('muH');
  ok(near(uPs.a / uH.a, 2 * 0.99946, 1e-4) && near(P.bindingEV('Ps', 1, 0), 6.8028, 1e-4), 'positronium: twice the size of hydrogen, binding 6.803 eV');
  ok(near(uH.a / uMu.a, 185.94, 1e-3) && near(uMu.a, 2.847e-13, 1e-3) && near(P.bindingEV('muH', 1, 0), 2528.5, 1e-3), 'muonic hydrogen: 186 times smaller (285 fm), binding 2.53 keV', `${(uH.a / uMu.a).toFixed(2)}`);
  ok(near(P.sizeM('X', 25, 1) * 2, 2.08e-6, 0.01), 'Cu2O exciton: n = 25 P state is about 2 µm across (Kazimierczuk 2014)', K.fmtLen(2 * P.sizeM('X', 25, 1)));
  ok(P.orbitalG('Ps') === 0 && near(P.orbitalG('antiH'), -P.orbitalG('H'), 1e-12) && near(P.orbitalG('H'), -0.99946, 1e-4), 'orbital g: hydrogen -1, antihydrogen +1, positronium 0');
}

// ── lifetimes ─────────────────────────────────────────────────────────────
{
  const t2p = P.radiativeLifetimeH(2, 1), t3s = P.radiativeLifetimeH(3, 0), t3d = P.radiativeLifetimeH(3, 2);
  ok(near(t2p, 1.596e-9, 0.003) && near(t3s, 158.4e-9, 0.003) && near(t3d, 15.6e-9, 0.01), 'lifetimes: hydrogen 2p 1.596 ns, 3s 158 ns, 3d 15.6 ns', `${(t2p * 1e9).toFixed(3)} ${(t3s * 1e9).toFixed(1)} ${(t3d * 1e9).toFixed(2)} ns`);
  const ps = P.lifetime('Ps', 2, 1, 0).s / P.lifetime('H', 2, 1, 0).s;
  ok(near(ps, 2 * 0.99946, 1e-4), 'lifetimes: positronium 2p lives mu_H / mu_Ps = 1.999 times as long as hydrogen 2p (rates scale with mu)', ps.toFixed(4));
}

// ── current, moment, field ────────────────────────────────────────────────
{
  // psi on a grid point by complex value: R Theta e^{i m phi}
  const psi = (n, l, m, x, y, z) => { const r = Math.hypot(x, y, z), a = P.logRnl(n, l, r), t = P.logTheta(l, m, z / r); const A = a.sign * t.sign * Math.exp(a.log + t.log), ph = m * Math.atan2(y, x); return [A * Math.cos(ph), A * Math.sin(ph)]; };
  const jAt = (n, l, m, x, y, z) => {
    const h = 1e-4 * (n * n), p0 = psi(n, l, m, x, y, z), j = [];
    for (const [dx, dy, dz] of [[h, 0, 0], [0, h, 0], [0, 0, h]]) {
      const a = psi(n, l, m, x + dx, y + dy, z + dz), b = psi(n, l, m, x - dx, y - dy, z - dz);
      const gr = (a[0] - b[0]) / (2 * h), gi = (a[1] - b[1]) / (2 * h);
      j.push(p0[0] * gi - p0[1] * gr);      // Im(psi* grad psi)
    }
    return [j, p0[0] ** 2 + p0[1] ** 2];
  };
  let maxReal = 0, maxErr = 0;
  for (let i = 0; i < 40; i++) {
    const x = 3 + i * 0.7, y = -2 + i * 0.4, z = 4 - i * 0.3;
    const [j0] = jAt(6, 3, 0, x, y, z); maxReal = Math.max(maxReal, Math.hypot(...j0));
    const [j1, d] = jAt(6, 3, 2, x, y, z), rho = Math.hypot(x, y), jp = 2 * d / rho;
    const exp = [-jp * y / rho, jp * x / rho, 0];
    maxErr = Math.max(maxErr, Math.hypot(j1[0] - exp[0], j1[1] - exp[1], j1[2]) / (Math.hypot(...exp) || 1));
  }
  ok(maxReal < 1e-12, 'current: Im(psi* grad psi) = 0 for the real m = 0 state |6,3,0>', maxReal.toExponential(1));
  ok(maxErr < 1e-5, 'current: for m = 2 it is (m / rho) |psi|^2 phi-hat (finite differences)', maxErr.toExponential(1));
  // <L_z> = int (r x j)_z dV over the solver grid, and the moment
  for (const [n, l, m] of [[5, 3, 2], [20, 19, 19], [12, 6, -4]]) {
    const F = B.solveAxisym(S.densityNLM(n, l, m), { g: -1, ns: 48, nt: 12, symmetric: true });
    ok(near(F.moment, -m / 2, 2e-3), `moment: |${n},${l},${m}> gives mu_z = -m mu_B from the summed loops`, `${(2 * F.moment).toFixed(4)} mu_B`);
  }
  const F0 = B.solveAxisym(S.densityNLM(7, 4, 0), { g: -1, ns: 32, nt: 12, symmetric: true });
  ok(F0.moment === 0 && F0.loops === 0, 'moment: m = 0 has no current loops and no field');
  // circular state: axis field at the nucleus and at z = 2 n^2 against the
  // loop of radius n^2 carrying the moment (n-1)/2: B0 = alpha^2 (n-1)/n^6
  const rows = [];
  let good = true;
  for (const n of [20, 50]) {
    const F = B.solveAxisym(S.densityNLM(n, n - 1, n - 1), { g: -1, ext: 2.2 * n * n, ns: 56, nt: 40, symmetric: true });
    const R = n * n, I = (n - 1) / 2 / (Math.PI * R * R), loop = z => -B.ALPHA2 * 2 * Math.PI * I * R * R / Math.pow(R * R + z * z, 1.5);
    const c0 = B.fieldAt(F, 0, 0)[1] / loop(0), c2 = B.fieldAt(F, 0, 2 * R)[1] / loop(2 * R);
    rows.push(`n=${n}: ${c0.toFixed(3)}, ${c2.toFixed(3)}`);
    if (!(Math.abs(c0 - 1) < 0.1 && Math.abs(c2 - 1) < 0.05)) good = false;
  }
  ok(good, 'field: B on the axis of |nC> matches the current-loop value (centre 10 %, z = 2n^2 5 %)', rows.join('; '));
  const Fs = B.solveAxisym(S.densityNLM(1, 0, 0), { g: -1, spin: -0.5006, ext: 6, ns: 48, nt: 30, symmetric: true });
  ok(near(Fs.moment, -0.5006, 1e-9) && near(B.fieldAt(Fs, 0, 5.5)[1], B.ALPHA2 * 2 * Fs.moment / 5.5 ** 3, 0.05), 'spin layer: 1s spin magnetization gives the dipole field of mu_s outside the cloud');
  const pk = S.packet('circular', 20, 1.5, 20000, 3), ps = B.packetSources(pk, 0, -1, 4000);
  const expMu = -0.5 * pk.ns.reduce((s, n, k) => s + pk.c[k] ** 2 * (n - 1), 0);
  ok(near(ps.moment[2], expMu, 0.08), 'packet: point-sampled moment of the circular packet is -<m> mu_B within 8 %', `${ps.moment[2].toFixed(2)} vs ${expMu.toFixed(2)}`);
  const w = pk.update(pk.TK * 3.3); let mw = 0; for (const v of w) mw += v;
  ok(Math.abs(mw / w.length - 1) < 0.05 && [...w].every(Number.isFinite), 'packet: importance weights stay finite with mean 1 as it moves', (mw / w.length).toFixed(3));
  ok(near(pk.Trev / pk.TK, 2 * 20 / 3, 1e-12), 'packet: revival time is (2 n0 / 3) Kepler periods');
}

// ── trilobite ─────────────────────────────────────────────────────────────
{
  const rows = [];
  let good = true;
  for (const n of [20, 30, 40]) {
    const { U } = S.triloCurve(n, { pts: 2000 }), mn = Math.min(...U);
    let wells = 0; for (let i = 1; i < U.length - 1; i++) if (U[i] < U[i - 1] && U[i] <= U[i + 1] && U[i] < 0.01 * mn) wells++;
    const Rw = S.outerWell(n), tri = S.trilobite(n, Rw);
    // r^2 |psi|^2 along +z peaks at the perturber
    let best = 0, bz = 0; for (let z = 0.2 * Rw; z < 1.6 * Rw; z += Rw / 400) { const v = tri.rhoz.f(1e-3, z) * z * z; if (v > best) { best = v; bz = z; } }
    rows.push(`n=${n}: wells ${wells}, R/n^2 ${(Rw / n / n).toFixed(2)}, d/R ${(tri.dipole / Rw).toFixed(2)}, peak ${(bz / Rw).toFixed(2)}R`);
    if (wells !== n - 3 || Rw / n / n < 1.5 || Rw / n / n > 2 || tri.dipole / Rw < 0.55 || tri.dipole / Rw > 0.8 || Math.abs(bz / Rw - 1) > 0.15) good = false;
  }
  ok(good, 'trilobite: n - 3 wells, outer well near 1.6-1.8 n^2, dipole about 0.7 R, electron piled at the perturber', rows.join('; '));
  const d30 = S.trilobite(30, S.outerWell(30)).dipole * DEBYE_A0;
  ok(d30 > 1000, 'trilobite: the n = 30 dipole is kilo-debye (Booth et al. 2015 measured about 2000 D at n = 37)', `${d30.toFixed(0)} D`);
}


// ── Zeeman, Stark, strong field ───────────────────────────────────────────
{
  const z = P.zeemanEV('H', 1, 0.5, 1) - P.zeemanEV('H', 0, 0.5, 1);
  ok(near(z, 0.99946 * 5.7883818060e-5, 1e-4), 'Zeeman: m = 1 of hydrogen moves up by mu_B B (57.9 µeV at 1 T)');
  ok(P.zeemanEV('Ps', 3, 0, 1) === 0 && near(P.zeemanEV('antiH', 1, 0, 1), -P.zeemanEV('H', 1, 0, 1), 1e-12), 'Zeeman: no orbital shift for positronium; the antihydrogen shift is reversed');
  ok(near(P.larmor('H', 1) / (2 * Math.PI), 13.996e9 * 0.99946, 1e-3), 'Larmor: 14.0 GHz per tesla for hydrogen', K.fmtHz(P.larmor('H', 1) / (2 * Math.PI)));
  const u = P.units('H'), F = 100, lin = (P.starkEV('H', 20, 19, 0, F) - P.starkEV('H', 20, 19, 0, 0));
  ok(near(lin, 1.5 * 20 * 19 * (F / u.F) * u.Eh, 0.01), 'Stark: the extreme state of n = 20 shifts by (3/2) n k F to first order');
  ok(near(P.polarizability(1, 0, 0), 4.5, 1e-12), 'Stark: the formula gives alpha = 9/2 a0^3 for the ground state');
  const rows = [];
  let good = true;
  for (const beta of [1, 100, 1000]) {
    const r = P.strongB(beta), ex = P.STRONG_B_EXACT[beta];
    rows.push(`${beta}: ${r.binding.toFixed(4)}/${ex}`);
    if (!(r.binding <= ex + 1e-6 && r.binding > ex * 0.97)) good = false;
  }
  ok(good, 'strong field: variational binding is below the exact value and within 3 % (beta = 1, 100, 1000)', rows.join(' '));
  ok(P.strongB(1000).aspect > 5 && near(P.strongB(0).aspect, 1, 1e-3), 'strong field: the cloud is a needle along B at beta = 1000 and round at 0');
}

// ── the climb ─────────────────────────────────────────────────────────────
{
  let eBad = [], ruleBad = [], sizeBad = [];
  for (const id of Object.keys(K.CLIMBS)) {
    const v = K.CLIMBS[id], sp = P.SPECIES[v.sp], top = v.tops[v.tops.length - 1], steps = K.climbSteps(id, top);
    steps.forEach((s, i) => {
      const e1 = s.from[0] === 0 ? 0 : P.energyEV(sp, s.from[0], s.from[1]), e2 = P.energyEV(sp, s.to[0], s.to[1]);
      if (Math.abs(s.eV - (e2 - e1)) > 1e-12 * Math.max(1, Math.abs(e2)) || !(s.eV > 0) || Math.abs(s.lam * s.eV - P.C.hc_eVm) > 1e-12) eBad.push(`${id}#${i}`);
      if (i && (s.from.join() !== steps[i - 1].to.join())) ruleBad.push(`${id}#${i} chain`);
      if (s.from[0] !== 0 && (Math.abs(s.dl) !== 1 || Math.abs(s.dm) > 1)) ruleBad.push(`${id}#${i} dl ${s.dl} dm ${s.dm}`);
      if (v.rule === 'yrast' && (s.dl !== 1 || s.dm !== 1)) ruleBad.push(`${id}#${i} not sigma+`);
      if (s.to[1] >= s.to[0] || Math.abs(s.to[2]) > s.to[1]) ruleBad.push(`${id}#${i} bad state`);
      if (s.to[0] && !near(s.sizeM, P.meanR(P.nStar(sp, s.to[0], s.to[1]), Math.min(s.to[1], P.nStar(sp, s.to[0], s.to[1]) - 0.5)) * P.units(sp).a, 1e-12)) sizeBad.push(`${id}#${i}`);
    });
  }
  ok(!eBad.length, 'climb: every photon energy equals the difference of the two levels (and lambda = hc/E)', eBad.slice(0, 4).join(' '));
  ok(!ruleBad.length, 'climb: one photon per step, |dl| = 1, |dm| <= 1, sigma+ (dl = dm = +1) on the circular ladders', ruleBad.slice(0, 4).join(' '));
  ok(!sizeBad.length, 'climb: sizes are <r> = (3n*^2 - l(l+1))/2 a of each species', sizeBad.slice(0, 4).join(' '));
  const h = K.climbSteps('circ', 300);
  ok(Math.abs(h[0].lam * 1e9 - 121.57) < 0.05 && Math.abs(h[1].lam * 1e9 - 656.47) < 0.1 && h[1].band === 'visible' && h[0].band === 'UV', 'climb: hydrogen starts with Lyman alpha (121.6 nm, UV) and H-alpha (656.5 nm, visible)', `${(h[0].lam * 1e9).toFixed(2)} ${(h[1].lam * 1e9).toFixed(2)} nm`);
  const last = h[h.length - 1];
  ok(near(last.eV, 2 * P.bindingEV('H', 1, 0) / 299 ** 3, 0.01) && last.band === 'radio', 'climb: the step to n = 300 is about 2 Ry / n^3 (a radio photon)', K.fmtHz(last.hz));
  ok(near(2 * P.sizeM('H', 300, 299), 9.55e-6, 0.01), 'climb: |300C> is 9.5 µm across (a red blood cell)', K.scaleLabel(2 * P.sizeM('H', 300, 299)));
  ok(K.climbSteps('muh', 3)[0].band === 'X-ray', 'climb: muonic hydrogen 1s -> 2p is an X-ray photon');
  // Inglis-Teller at a stated field: F = 1 V/cm -> n = (1/(3F))^(1/5) = 70.2
  const Fau = 1 / P.units('H').F, nIT = Math.pow(1 / (3 * Fau), 0.2);
  ok(near(P.inglisTellerN('H', 1), nIT, 1e-12) && Math.abs(nIT - 70.2) < 0.1 && near(P.inglisTeller('H', nIT), 1, 1e-9), 'Inglis-Teller: at 1 V/cm the levels merge above n = 70.2, and F_IT(70.2) = 1 V/cm', nIT.toFixed(2));
  ok(Math.abs(P.inglisTellerN('H', 0.01) - 176.5) < 0.2, 'Inglis-Teller: at 10 mV/cm (the default stray field) n = 176.5');
  const L = K.limitsAt('H', 300, 299);
  ok(L.n > L.nIT && L.cold > 1 && L.nbar > 1000 && /Inglis/.test(K.worstLimit(L)), 'limits: at n = 300 the levels merge, the atom outgrows a cold gas and blackbody photons swamp the step');
  const ion = K.ionizeStep('circ', [300, 299, 299]);
  ok(ion.eV > ion.binding, 'climb: the last photon carries more than the binding energy (ionization)');
}

// ── saver ─────────────────────────────────────────────────────────────────
{
  globalThis.window = globalThis.window || globalThis;
  const { shotPlan, SHOTS, SHOT_KINDS, CLIMB_KINDS, climbPace } = await import('./saver.js');
  let rep = 0, bagOk = true, secOk = true;
  for (const seed of [1, 2, 3, 99, 12345]) {
    const p = shotPlan(seed, 52, 0.6);
    for (let i = 1; i < p.length; i++) if (p[i].id === p[i - 1].id) rep++;
    for (let b = 0; b + SHOT_KINDS.length <= 39; b += SHOT_KINDS.length) if (new Set(p.slice(b, b + SHOT_KINDS.length).map(x => x.id)).size !== SHOT_KINDS.length) bagOk = false;
    for (const s of p) if (s.sec < 6 || s.sec > 12 || (s.id.startsWith('climb:') && s.sec < 10)) secOk = false;
  }
  ok(!rep && bagOk && secOk, 'saver: seeded bags hold every kind once, no kind twice in a row, cuts of 6-12 s (climbs 10-12 s)');
  ok(shotPlan(7).map(x => x.id).join() !== shotPlan(8).map(x => x.id).join(), 'saver: the order changes with the seed');
  ok(CLIMB_KINDS.length >= SHOT_KINDS.length / 2, 'saver: the climb is the headline: half or more of every bag', `${CLIMB_KINDS.length} of ${SHOT_KINDS.length}`);
  const pc = [0, 0.2, 0.39, 0.5, 0.85, 0.9, 1].map(k => climbPace(k, 299));
  ok(pc.every((x, i) => !i || x.p >= pc[i - 1].p) && pc[6].p === 299 && pc[5].ion > 0 && pc[2].p < 5, 'saver: the climb goes one photon at a time first, then faster, then ionizes');
  const { rng } = await import('../circular-rydberg/physics.js');
  const plates = [], bad = [];
  for (const id of SHOT_KINDS) {
    const st = SHOTS[id].setup(rng(11)); let nan = 0, drawn = 0;
    const rec = new Proxy({}, { get: (t, k) => k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 10 }) : (...a) => { for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) nan++; } , set: () => true });
    for (const k of [0, 0.05, 0.2, 0.41, 0.6, 0.8, 0.9, 0.99]) {
      const ctx = { g: rec, w: 800, h: 450, k, tau: k * 10, dt: 0.05, st, N: 1500, over: f => f(rec), replate: x => plates.push(SHOTS[id].plate(st, x)),
        cloud: (cl, v) => { drawn++; if (cl) for (let i = 0; i < cl.pts.length; i++) if (!Number.isFinite(cl.pts[i])) { nan++; break; } for (const x of Object.values(v)) if (typeof x === 'number' && !Number.isFinite(x)) nan++; return v; } };
      try { SHOTS[id].draw(ctx); } catch (e) { bad.push(`${id}@${k}: ${e.message}`); }
    }
    plates.push(SHOTS[id].plate(st, { cur: 0 }));
    if (nan || !drawn) bad.push(`${id} nan ${nan} drawn ${drawn}`);
  }
  ok(!bad.length, 'saver: every shot draws with finite numbers', bad.slice(0, 3).join('; '));
  ok(plates.every(p => p.title && Array.isArray(p.tex) && p.tex.length === 1 && !('code' in p)), 'saver: every plate has a title, one TeX line and no code');
  const climbPl = plates.filter(p => /one photon at a time/.test(p.title));
  ok(climbPl.some(p => p.params && p.params.some(q => q.sym === '\\lambda')) && climbPl.every(p => p.params[0].sym === 'n' && (p.params[0].value === '—' || p.params.length >= 3)), 'saver: climb plates carry n, l, m and the photon wavelength');
  globalThis.__plates = plates;
}

// ── page markup ───────────────────────────────────────────────────────────
{
  const html = readFileSync(here + 'index.html', 'utf8'), css = readFileSync(here + 'style.css', 'utf8'), main = readFileSync(here + 'main.js', 'utf8');
  const heads = [...html.matchAll(/<script src="\.\.\/\.\.\/lib\/([a-z-]+)\.js"><\/script>/g)].map(m => m[1]);
  ok(heads.join(',') === 'gpu-guard,wishlist,stats-beacon' && html.indexOf('gpu-guard') < html.indexOf('<meta'), 'page: gpu-guard, then wishlist, then stats-beacon, first in head');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'page: [hidden]{display:none!important}');
  ok(/@media \(pointer:coarse\)[\s\S]*min-height:44px/.test(css), 'page: 44 px targets on touch screens');
  const ids = [...new Set([...main.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(m => m[1]))];
  const missing = ids.filter(id => !new RegExp(`id="${id}"`).test(html));
  ok(!missing.length, `page: every id main.js binds exists in index.html (${ids.length})`, missing.join(' '));
  ok(/pagehide/.test(main) && /magma/.test(main), 'page: magma is the default map, and the loop stops on pagehide');
  let err = null;
  try { await import('./main.js'); } catch (e) { err = e; }
  ok(!err || !(err instanceof SyntaxError), 'page: main.js links (only a browser global may be missing)', err ? `${err.constructor.name}: ${err.message.split('\n')[0]}` : 'ran');
}

// ── TeX and boot (jsdom) ──────────────────────────────────────────────────
{
  let JSDOM = null;
  try { JSDOM = createRequire((process.env.NODE_PATH || '/nonexistent') + '/')('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) console.log('SKIP  TeX and jsdom boot: jsdom not on NODE_PATH');
  else {
    const { pathToFileURL } = await import('node:url');
    const html = readFileSync(here + 'index.html', 'utf8');
    const dec = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const eqs = [...html.matchAll(/data-tex="([^"]+)"/g)].map(m => dec(m[1]));
    const seen = new Set(eqs);
    for (const p of globalThis.__plates || []) for (const t of p.tex) if (!seen.has(t)) { seen.add(t); eqs.push(t); }
    for (const p of globalThis.__plates || []) for (const q of p.params || []) if (q.sym && !seen.has(q.sym)) { seen.add(q.sym); eqs.push(q.sym); }
    const src0 = readFileSync(here + 'main.js', 'utf8'), EQsrc = src0.slice(src0.indexOf('const EQ = {'), src0.indexOf('let eqKey'));
    const EQ = new Function(EQsrc + '; return EQ;')();
    for (const [, list] of Object.values(EQ)) for (const t of list) if (!seen.has(t)) { seen.add(t); eqs.push(t); }
    const lib = here + '../../lib/sci-math.js';
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: pathToFileURL(here + 'index.html').href, runScripts: 'dangerously', resources: 'usable' });
    const w = dom.window;
    const src = readFileSync(lib, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(lib).href)).replace(/^export /gm, '');
    w.eval(`(function () { ${src}\n window.__sm = { typeset, loadMath }; })();`);
    const els = eqs.map(() => w.document.body.appendChild(w.document.createElement('div')));
    const out = await Promise.race([Promise.all(eqs.map((t, i) => w.__sm.typeset(els[i], t, { display: true }))), new Promise(r => setTimeout(() => r(null), 120000))]);
    const bad = out ? eqs.filter((t, i) => !out[i] || !els[i].querySelector('svg')) : eqs;
    ok(!!out && !bad.length, 'TeX: every equation of the guide, the equation panel and the saver plates typesets', bad.length ? bad.slice(0, 3).join(' | ') : `${eqs.length} equations`);
    w.close();
    // boot the page in jsdom: canvas contexts are stubs, rAF runs frames
    const errors = await boot(JSDOM, pathToFileURL);
    ok(!errors.length, 'boot: the page boots in jsdom, draws frames and changes state with no errors', errors.slice(0, 3).join(' | '));
  }
}

async function boot(JSDOM, pathToFileURL) {
  const html = readFileSync(here + 'index.html', 'utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: pathToFileURL(here + 'index.html').href, pretendToBeVisual: true });
  const w = dom.window, errors = [];
  w.addEventListener('error', e => errors.push('error: ' + (e.message || e.error)));
  const cerr = console.error; console.error = (...a) => errors.push('console.error: ' + a.map(x => x && x.stack || x).join(' '));
  const onRej = e => errors.push('rejection: ' + (e && e.stack || e)); process.on('unhandledRejection', onRej);
  w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const ctx2d = () => new Proxy({}, { get: (t, k) => {
    if (k === 'createImageData') return (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
    if (k === 'getImageData') return (x, y, W, H) => ({ data: new Uint8ClampedArray(W * H * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    if (k in t) return t[k];
    return () => {};
  }, set: (t, k, v) => { t[k] = v; return true; } });
  w.HTMLCanvasElement.prototype.getContext = function () { return this.__c || (this.__c = ctx2d()); };
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'addEventListener']) {
    try { Object.defineProperty(globalThis, k, { value: typeof w[k] === 'function' && k !== 'HTMLElement' && k !== 'Node' && k !== 'Event' && k !== 'MouseEvent' ? w[k].bind(w) : w[k], configurable: true, writable: true }); } catch (e) { /* read-only */ }
  }
  globalThis.window = w;
  w.IntersectionObserver = globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await import('./main.js?boot');
    await sleep(400);
    const $ = id => w.document.getElementById(id), click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const ea = w.__ea;
    if (!ea) errors.push('no window.__ea');
    else {
      const chip = v => [...$('spChips').children].find(b => b.dataset.v === v);
      const fam = v => [...$('famSeg').children].find(b => b.dataset.v === v);
      click($('bBtn')); for (let i = 0; i < 100 && !ea.S.F; i++) await sleep(100);
      if (!ea.S.F) errors.push('field not solved after the B toggle');
      for (const v of ['Ps', 'muH', 'Rb', 'X', 'antiH', 'H']) { click(chip(v)); await sleep(60); }
      click(fam('para')); await sleep(200); click(fam('mol')); await sleep(300); click(fam('strongB')); await sleep(300); click(fam('nlm')); await sleep(100);
      click($('packBtn')); await sleep(400); click($('extBBtn')); click($('extEBtn')); await sleep(300);
      click($('cmpBtn')); click($('arrowsBtn')); click($('guideBtn')); click($('rulerBtn')); await sleep(300);
      const n = $('nIn'); n.value = '200'; n.dispatchEvent(new w.Event('input')); await sleep(300);
      if (!/\d/.test($('read').textContent)) errors.push('readouts empty');
      const sv = w.snSaver || globalThis.snSaver; sv.enter({ seed: 3, calm: 0.5 }); await sleep(800); if (!w.document.getElementById("snSaverCv")) errors.push("saver canvas missing"); sv.exit();
      w.dispatchEvent(new w.Event('pagehide'));
    }
  } catch (e) { errors.push('import: ' + (e && e.stack || e)); }
  console.error = cerr; process.off('unhandledRejection', onRej);
  return errors;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
