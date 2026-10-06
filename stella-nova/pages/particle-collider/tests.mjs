// ============================================================================
//  PARTICLE COLLIDER  ·  tests.mjs — node stella-nova/pages/particle-collider/tests.mjs
// ----------------------------------------------------------------------------
//  Checks the transport engine against PDG values and textbook laws:
//    dE/dx ........ the Bethe-Bloch minimum of a muon in Si and Fe (and
//                   Pb, Cu, LAr, PbWO4) against the PDG tables, 1.5 %
//    X0 ........... the Tsai radiation length against the PDG table, 0.5 %
//    shower ....... the depth of the maximum of 10 GeV e- and gamma
//                   showers in a PbWO4 block (full simulation, a Gamma fit
//                   by moments) against ln(E/Ec) -+ 0.5, within 0.5 X0
//    Highland ..... the core width of 1 GeV muons after 0.1 X0 of iron
//                   against theta0, 5 %
//    helix ........ the radius of a 10 GeV pT muon in 3.8 T against
//                   p / (0.3 B), 1 %, and the fitted pT, 2 %
//    decay ........ the mean decay length of 5 GeV K0S against beta gamma
//                   c tau, 3 %
//    ledger ....... in + borrowed = deposited + escaped + invisible +
//                   returned, for every scenario, to 1e-6 of the input
//    calorimetry .. the ECAL response to 50 GeV electrons (2 %), the EM
//                   fraction of 50 GeV pion showers (0.35-0.65)
//    reco ......... Z -> mu mu: two muons and a mass within 5 GeV of the
//                   true mass in most events
//  Each check prints its numbers. The exit code is the number of failures.
// ============================================================================
import { MAT } from './materials.js';
import { bbHeavy, highland } from './physics.js';
import { createEngine, makeRng, pack, mergeResults, splitPrims } from './transport.js';
import { generate, SCENARIOS } from './generators.js';
import { reconstruct } from './reco.js';
import { PART } from './particles.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fail++; };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const MU = PART['mu-'].m;

// ── dE/dx minimum ─────────────────────────────────────────────────────────
const PDG_MIN = { Si: 1.664, Fe: 1.451, Pb: 1.122, Cu: 1.403, LAr: 1.508, PbWO4: 1.229 };
for (const [k, ref] of Object.entries(PDG_MIN)) {
  let mn = Infinity;
  for (let l = 1; l < 5; l += 0.002) mn = Math.min(mn, bbHeavy(MAT[k], MU, 1, 10 ** l) / MAT[k].rho * 10);
  ok(rel(mn, ref) < 0.015, `dE/dx min, mu in ${k}: ${mn.toFixed(4)} MeV cm2/g, PDG ${ref} (${(100 * rel(mn, ref)).toFixed(2)} %)`);
}

// ── radiation length ──────────────────────────────────────────────────────
for (const m of Object.values(MAT)) if (m.pdgX0) ok(rel(m.X0g, m.pdgX0) < 0.005, `X0 Tsai, ${m.key}: ${m.X0g.toFixed(3)} g/cm2, PDG ${m.pdgX0}`);

// ── shower maximum ────────────────────────────────────────────────────────
{
  const len = 400, dz = MAT.PbWO4.X0 / 4;
  const E = createEngine({ block: { mat: 'PbWO4', len, world: 'vacuum' }, fastBelow: 0, fastTags: [], maxSeg: 10, gKillCalo: 0.05, eKillCalo: 0.05 });
  for (const name of ['e-', 'gamma']) {
    const T = 10000, prof = new Float64Array(Math.ceil(len / dz));
    for (let i = 0; i < 40; i++) {
      const r = E.run([{ name, px: 0, py: 0, pz: T + (name === 'e-' ? Math.sqrt(T * (T + 2 * 0.511)) - T : 0), x: 0, y: 0, z: -50 }], 101 + i, { profile: { n: prof.length, dz } });
      for (let k = 0; k < prof.length; k++) prof[k] += r.profile[k];
    }
    let s0 = 0, s1 = 0, s2 = 0;
    for (let k = 0; k < prof.length; k++) { const t = (k + 0.5) / 4; s0 += prof[k]; s1 += prof[k] * t; s2 += prof[k] * t * t; }
    const mean = s1 / s0, vr = s2 / s0 - mean * mean, a = mean * mean / vr, b = mean / vr, tfit = (a - 1) / b;
    // the peak: a parabola through the largest bin of the profile smoothed over 1 X0
    const sm = Array.from(prof, (_, k) => { let q = 0, c = 0; for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < prof.length) { q += prof[j]; c++; } return q / c; });
    let kb = 1; for (let k = 1; k < sm.length - 1; k++) if (sm[k] > sm[kb]) kb = k;
    const den = sm[kb - 1] - 2 * sm[kb] + sm[kb + 1], tmax = (kb + 0.5 + (den ? 0.5 * (sm[kb - 1] - sm[kb + 1]) / den : 0)) / 4;
    const want = Math.log(T / MAT.PbWO4.Ec) + (name === 'e-' ? -0.5 : 0.5);
    ok(Math.abs(tmax - want) < 0.5, `shower max, 10 GeV ${name} in PbWO4: t_max ${tmax.toFixed(2)} X0 (peak; Gamma moments give ${tfit.toFixed(2)}, b ${b.toFixed(3)}), ln(E/Ec)${name === 'e-' ? '-' : '+'}0.5 = ${want.toFixed(2)}`);
  }
}

// ── Highland ──────────────────────────────────────────────────────────────
{
  const x = 0.1 * MAT.Fe.X0, E = createEngine({ block: { mat: 'Fe', len: x, world: 'vacuum' }, maxSeg: 10 });
  const p = 1000, beta = p / Math.hypot(p, MU), th0 = highland(p, beta, x, MAT.Fe.X0), ang = [];
  for (let i = 0; i < 4000; i++) {
    const r = E.run([{ name: 'mu-', px: 0, py: 0, pz: p, x: 0, y: 0, z: -1 }], 1000 + i);
    const t = r.tracks[0]; if (t && t.uEnd) ang.push(Math.atan2(t.uEnd[0], t.uEnd[2]));
  }
  ang.sort((a, b) => a - b);
  const core = ang.slice(Math.floor(ang.length * 0.01), Math.ceil(ang.length * 0.99));
  // the RMS of a Gaussian cut at +-2.326 sigma (98 %) is 0.9244 sigma
  const rms = Math.sqrt(core.reduce((s, a) => s + a * a, 0) / core.length) / 0.9244;
  ok(rel(rms, th0) < 0.05, `Highland, 1 GeV mu through 0.1 X0 Fe: core width ${(rms * 1e3).toFixed(3)} mrad, theta0 ${(th0 * 1e3).toFixed(3)} mrad (${(100 * rel(rms, th0)).toFixed(1)} %)`);
}

// ── helix radius in the solenoid ──────────────────────────────────────────
const DET = createEngine();
{
  const pT = 10000, r = DET.run([{ name: 'mu+', px: pT, py: 0, pz: 0 }], 77);
  const pts = [];
  for (let i = 0; i < r.nSeg; i++) { const k = i * 9, x = r.seg[k + 4], y = r.seg[k + 5]; if (r.segTrk[i] === 0 && Math.hypot(x, y) > 30 && Math.hypot(x, y) < 1150) pts.push([x, y]); }
  // three-point circle through the first, middle and last points
  const [A, B, C] = [pts[0], pts[pts.length >> 1], pts[pts.length - 1]];
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  const ux = ((A[0] ** 2 + A[1] ** 2) * (B[1] - C[1]) + (B[0] ** 2 + B[1] ** 2) * (C[1] - A[1]) + (C[0] ** 2 + C[1] ** 2) * (A[1] - B[1])) / d;
  const uy = ((A[0] ** 2 + A[1] ** 2) * (C[0] - B[0]) + (B[0] ** 2 + B[1] ** 2) * (A[0] - C[0]) + (C[0] ** 2 + C[1] ** 2) * (B[0] - A[0])) / d;
  const Rm = Math.hypot(A[0] - ux, A[1] - uy), Rw = pT / (0.299792458 * 3.8);
  ok(rel(Rm, Rw) < 0.01, `helix, 10 GeV pT mu+ in 3.8 T: R ${Rm.toFixed(1)} mm, p/(0.3 B) ${Rw.toFixed(1)} mm; centre on the ${uy < 0 ? '-y (clockwise, +q)' : '+y'} side`);
  ok(uy < 0, 'helix: a positive track turns clockwise seen from +z in +Bz');
  const o = reconstruct(r, {});
  const t = o.tracks[0];
  ok(t && rel(t.pT, pT) < 0.02 && t.q === 1, `track fit, same muon: pT ${t ? (t.pT / 1000).toFixed(3) : '-'} GeV, q ${t ? t.q : '-'}, sagitta ${t ? t.sag.toFixed(2) : '-'} mm over ${t ? t.L.toFixed(0) : '-'} mm`);
}

// ── decay length ──────────────────────────────────────────────────────────
{
  const E = createEngine({ block: { mat: 'vacuum', len: 20000, world: 'vacuum' }, maxSeg: 10 });
  const p = 5000, M = PART.K0S.m, want = p / M * PART.K0S.tau * 299.792458;
  let s = 0, k = 0;
  for (let i = 0; i < 4000; i++) {
    const r = E.run([{ name: 'K0S', px: 0, py: 0, pz: p, x: 0, y: 0, z: 0 }], 5000 + i);
    const v = r.vtx.find(q => q[4] === 1); if (v) { s += Math.hypot(v[0], v[1], v[2]); k++; }
  }
  ok(rel(s / k, want) < 0.03, `decay length, 5 GeV K0S: mean ${(s / k).toFixed(1)} mm over ${k} decays, beta gamma c tau ${want.toFixed(1)} mm`);
}

// ── energy ledger for every scenario ──────────────────────────────────────
for (const kind of Object.keys(SCENARIOS)) {
  const g = generate(kind, { pileup: kind === 'mb' ? 8 : 2, particle: 'pi-', energy: 80000 }, makeRng(31));
  const r = DET.run(g.prims, 9), L = r.L, bal = L.in + L.borrow - (L.dep + L.esc + L.inv + L.ret);
  ok(Math.abs(bal) < 1e-6 * L.in, `ledger, ${kind}: in ${(L.in / 1000).toFixed(1)} GeV, dep ${(L.dep / 1000).toFixed(1)}, esc ${(L.esc / 1000).toFixed(1)}, inv ${(L.inv / 1000).toFixed(1)}, imbalance ${bal.toExponential(1)} MeV (${r.stats.steps} steps, ${r.stats.ms} ms)`);
}

// ── worker split and merge ────────────────────────────────────────────────
{
  const g = generate('tt', { pileup: 3 }, makeRng(55)), parts = splitPrims(g.prims, 3);
  const M = mergeResults(parts.map((p, i) => pack(DET.run(p, 90 + i)))), L = M.L, bal = L.in + L.borrow - (L.dep + L.esc + L.inv + L.ret);
  let badIdx = 0; for (let i = 0; i < M.nSeg; i++) if (M.segTrk[i] >= M.tracks.length) badIdx++;
  for (let i = 0; i < M.hits.n; i++) if (M.hits.trk[i] < 0 || M.hits.trk[i] >= M.tracks.length) badIdx++;
  ok(Math.abs(bal) < 1e-6 * L.in && badIdx === 0 && M.seg.length === M.nSeg * 9, `merge of 3 worker shares (${parts.map(p => p.length).join(' + ')} primaries): ${M.nSeg} segments, ${M.tracks.length} tracks, ${M.hits.n} hits, imbalance ${bal.toExponential(1)} MeV, ${badIdx} bad indices`);
}

// ── calorimetry ───────────────────────────────────────────────────────────
{
  let e = 0, fem = 0;
  for (let i = 0; i < 10; i++) {
    const r = DET.run(generate('gun', { particle: 'e-', energy: 50000, eta: 0.1 * i, phi: 0.4 * i }, makeRng(i + 1)).prims, 300 + i);
    e += r.ecal.reduce((a, b) => a + b, 0) / 50000 / 10;
  }
  ok(Math.abs(e - 1) < 0.02, `ECAL response to 50 GeV e-: ${e.toFixed(4)}`);
  for (let i = 0; i < 10; i++) { const r = DET.run(generate('gun', { particle: 'pi+', energy: 50000, eta: 0.1 * i, phi: 0.4 * i }, makeRng(i + 1)).prims, 400 + i); fem += r.depEm / r.L.dep / 10; }
  ok(fem > 0.35 && fem < 0.65, `EM fraction of 50 GeV pi+ showers: ${fem.toFixed(3)}`);
}

// ── reconstruction ────────────────────────────────────────────────────────
{
  let good = 0, tried = 0;
  for (let i = 0; i < 12; i++) {
    const g = generate('zmm', {}, makeRng(700 + i)), o = reconstruct(DET.run(g.prims, 50 + i), g.info);
    if (o.muons.length < 2) continue;
    tried++; if (Math.abs(o.masses.mumu - g.info.truth.mass) < 5000) good++;
  }
  ok(tried >= 6 && good >= 0.8 * tried, `Z -> mu mu: ${tried} of 12 events with two muons, ${good} with m(mu mu) within 5 GeV of the true mass`);
}

console.log(`\n${n - fail} of ${n} checks passed`);
process.exitCode = fail;
