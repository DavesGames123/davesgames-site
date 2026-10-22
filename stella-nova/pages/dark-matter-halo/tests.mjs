// ============================================================================
//  DARK MATTER HALO  ·  tests.mjs — node tests, no browser
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/dark-matter-halo/tests.mjs
//  Covers model.js. The first group checks that the sum of the McMillan
//  (2017) components gives the values of the paper (Table 3, sec. 2.1-2.3).
//  The other groups check each method against a closed form: the disc
//  rings against the Freeman thin disc, the spheroid against a sphere, and
//  the halo quadrature against the Burkert and isothermal masses.
//
//  grep -n targets: "section(" opens each group.
// ============================================================================
import * as M from './model.js';

let pass = 0, fail = 0, cur = '';
function section(s) { cur = s; console.log('\n# ' + s); }
function ok(c, msg) { if (c) pass++; else { fail++; console.log(`  FAIL [${cur}] ${msg}`); } }
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const m = M.MCMILLAN17;

section('McMillan 2017 values');
{
  const c = M.curve(m, [m.R0]);
  ok(Math.abs(c.v.total[0] - m.v0) < 1.5, `v(R0) ${c.v.total[0].toFixed(2)} vs ${m.v0} km/s`);
  const rho = M.haloDensity(m.halo, m.R0);
  ok(rel(rho, m.derived.rhoSun) < 0.01, `rho_sun ${M.perPc3(rho).toFixed(5)} Msun/pc^3`);
  ok(Math.abs(M.gev(rho) - 0.38) < 0.01, `rho_sun ${M.gev(rho).toFixed(3)} GeV/cm^3`);
  const v = M.virial(m);
  ok(rel(v.Mv, m.derived.Mv) < 0.02, `Mv ${v.Mv.toExponential(3)} (H = 70.4, 200 x critical, baryons in)`);
  const mstar = M.bulgeMass(m.bulge) + M.discMass(m.discs[0]) + M.discMass(m.discs[1]);
  ok(rel(mstar, m.derived.Mstar) < 0.01, `M* ${mstar.toExponential(3)}`);
  // Sec. 2.1: rho0,b = 9.93e10 Msun/kpc^3 <-> Mb = 8.9e9. Table 3 gives
  // Mb 9.23e9 for rho0,b 98.4e9, which eq. 1 does not give; see model.js.
  const b = M.bulgeMass({ ...m.bulge, rho0: 9.93e10 });
  ok(rel(b, 8.9e9) < 0.01, `bulge mass for the sec. 2.1 normalisation ${b.toExponential(3)}`);
  ok(rel(M.discMass(m.discs[2]), 1.1e10) < 0.04, `HI mass ${M.discMass(m.discs[2]).toExponential(3)} (Table 1: 1.1e10)`);
  ok(rel(M.discMass(m.discs[3]), 1.2e9) < 0.04, `H2 mass ${M.discMass(m.discs[3]).toExponential(3)} (Table 1: 1.2e9)`);
  const sun = m.discs.map(d => M.discSigma(d, 8.33) / 1e6);
  ok(Math.abs(sun[2] - 10) < 0.2 && Math.abs(sun[3] - 2) < 0.05, `gas Sigma at 8.33 kpc: HI ${sun[2].toFixed(2)}, H2 ${sun[3].toFixed(2)} (Table 1: 10, 2)`);
}

section('disc rings vs the Freeman thin disc');
{
  // Md 5e10, Rd 2.6: razor-thin values from scipy I0K0 - I1K1.
  const d = { id: 't', law: 'exp', sigma0: 5e10 / (2 * Math.PI * 2.6 * 2.6), Rd: 2.6, zd: 0.01 };
  const want = [[2, 134.9], [5, 178.2], [8.2, 170.2], [20, 109.1]];
  const c = M.curve({ ...m, discs: [d], bulge: { ...m.bulge, rho0: 0 }, halo: { family: 'nfw', rho0: 0, rs: 1 } }, want.map(w => w[0]));
  want.forEach(([R, v], i) => ok(rel(c.v.t[i], v) < 0.01, `R ${R}: ${c.v.t[i].toFixed(2)} vs ${v}`));
  const thick = M.curve({ ...m, discs: [{ ...d, zd: 0.3 }] }, [8.2]);
  ok(thick.v.t[0] < c.v.t[2] && thick.v.t[0] > 0.9 * c.v.t[2], `a thick disc is a little slower (${thick.v.t[0].toFixed(1)} vs ${c.v.t[2].toFixed(1)})`);
}

section('bulge spheroid');
{
  const sph = { ...m.bulge, q: 1 };
  // A sphere: v^2 = G M(<R) / R, M(<R) = 4 pi int rho r^2 (midpoint sum).
  for (const R of [0.5, 2, 8]) {
    const c = M.curve({ ...m, bulge: sph, discs: [], halo: { family: 'nfw', rho0: 0, rs: 1 } }, [R]);
    ok(rel(c.v2.bulge[0], M.G * sphereMass(sph, R) / R) < 1e-3, `q = 1 at R ${R}: ${c.v.bulge[0].toFixed(2)} km/s`);
  }
  function sphereMass(b, R) { let s = 0; const n = 20000; for (let i = 0; i < n; i++) { const r = (i + 0.5) / n * R; s += 4 * Math.PI * r * r * M.bulgeDensity(b, r, 0) * R / n; } return s; }
  // Independent check of the flattened bulge: a brute-force ring sum on a
  // geometric (R', z) grid that resolves the cusp. A sphere of the same
  // mass is 7 % off at 4 kpc, so this separates the two.
  const A = geo(1e-4, 12, 1500), Z = geo(1e-4, 8, 700);
  const ringSum = R => {
    let s = 0;
    for (let i = 0; i + 1 < A.length; i++) {
      const a = (A[i] + A[i + 1]) / 2, da = A[i + 1] - A[i];
      for (let j = 0; j + 1 < Z.length; j++) {
        const z = (Z[j] + Z[j + 1]) / 2, rho = M.bulgeDensity(m.bulge, a, z);
        if (!rho) continue;
        const q = (R + a) ** 2 + z * z;
        s -= 2 * 2 * Math.PI * a * rho * da * (Z[j + 1] - Z[j]) * 2 * M.G * agmK(4 * a * R / q) / (Math.PI * Math.sqrt(q));
      }
    }
    return s;
  };
  for (const [R, tol] of [[1, 0.01], [4, 0.002], [8, 0.002]]) {
    const h = 1e-3 * R, want = R * (ringSum(R + h) - ringSum(R - h)) / (2 * h);
    const got = M.curve({ ...m, discs: [], halo: { family: 'nfw', rho0: 0, rs: 1 } }, [R]).v2.bulge[0];
    ok(rel(got, want) < tol, `flattened bulge at R ${R}: ${got.toFixed(1)} vs ring sum ${want.toFixed(1)}`);
  }
  function geo(lo, hi, n) { const e = [0]; for (let i = 0; i <= n; i++) e.push(lo * Math.pow(hi / lo, i / n)); return e; }
  function agmK(mm) { let a = 1, c = Math.sqrt(1 - mm); for (let i = 0; i < 40 && Math.abs(a - c) > 1e-15 * a; i++) { const t = (a + c) / 2; c = Math.sqrt(a * c); a = t; } return Math.PI / (2 * a); }
}

section('halo families');
{
  const bk = { family: 'burkert', rho0: 1e7, rs: 9 }, it = { family: 'isothermal', rho0: 1e7, rs: 3 };
  for (const r of [1, 8, 40, 200]) {
    const x = r / 9, mb = Math.PI * 1e7 * 729 * (Math.log((1 + x) ** 2 * (1 + x * x)) - 2 * Math.atan(x));
    ok(rel(M.haloMass(bk, r), mb) < 1e-5, `Burkert M(<${r})`);
    const y = r / 3, mi = 4 * Math.PI * 1e7 * 27 * (y - Math.atan(y));
    ok(rel(M.haloMass(it, r), mi) < 1e-5, `isothermal M(<${r})`);
  }
  const nfwNum = M.haloMass({ ...m.halo, family: 'nfw' }, 30);
  let s = 0; const n = 200000; for (let i = 0; i < n; i++) { const r = (i + 0.5) / n * 30; s += 4 * Math.PI * r * r * M.haloDensity(m.halo, r) * 30 / n; }
  ok(rel(nfwNum, s) < 1e-3, 'NFW closed form = brute-force sum');
  const vf = Math.sqrt(4 * Math.PI * M.G * it.rho0 * it.rs * it.rs);
  const far = M.curve({ ...m, halo: it }, [300, 600]).v.halo;
  ok(rel(far[0], vf) < 0.02 && rel(far[1], vf) < 0.01, `cored isothermal goes flat: ${far[0].toFixed(1)}, ${far[1].toFixed(1)} -> ${vf.toFixed(1)}`);
  for (const f of ['einasto', 'burkert', 'isothermal']) {
    const h = M.matchLocal(m, f, f === 'einasto' ? 15 : 9);
    ok(rel(M.haloDensity(h, m.R0), M.haloDensity(m.halo, m.R0)) < 1e-12, `${f} matched to the local density`);
  }
  ok(M.haloDensity(m.halo, 0.1) > 10 * M.haloDensity(M.matchLocal(m, 'burkert', 9), 0.1), 'at 100 pc the cusp is 10x the core: the inner halo is where the profiles disagree');
}

section('curve shape');
{
  const c = M.curve(m, [2, 8.21, 50]);
  ok(c.v2.hi[0] < 0 && c.v.hi[0] < 0, 'inside its hole the HI disc pulls outward (v keeps the sign)');
  ok(c.v.baryons[2] < 0.5 * c.v.total[2], `at 50 kpc the baryons alone give ${c.v.baryons[2].toFixed(0)} of ${c.v.total[2].toFixed(0)} km/s`);
  const f8 = M.darkFraction(m, 8.21).frac, f50 = M.darkFraction(m, 50).frac;
  ok(f8 > 0.3 && f8 < 0.6 && f50 > 0.8, `dark fraction inside 8.21 kpc ${f8.toFixed(2)}, inside 50 kpc ${f50.toFixed(2)}`);
  const again = M.curve({ ...m, halo: M.matchLocal(m, 'burkert', 9) }, [2, 8.21, 50], { discs: Object.fromEntries(m.discs.map(d => [d.id, c.v2[d.id]])) });
  ok(again.v2.thin.every((v, i) => v === c.v2.thin[i]), 'opts.discs reuses the disc arrays');
  const t = performance.now(); M.curve(m, Array.from({ length: 120 }, (_, i) => 0.25 + i * 0.5)); const ms = performance.now() - t;
  ok(ms < 3000, `120-radius curve in ${ms.toFixed(0)} ms`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
