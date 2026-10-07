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
//  and the accelerator model (accel.js):
//    B rho = p/e (8.33 T at 7 TeV); the linac phase advance against k_l L;
//    FODO beta max/min and dispersion against the thin-lens formulas;
//    natural chromaticity -tan(mu/2)/pi; sextupoles that set Q' = +2;
//    the betatron tune from tracking; the synchrotron tune Qs and the
//    bucket height; the ramp (B follows p, a bucket exists); design
//    luminosity 1e34, pile-up 25, 362 MJ; U0 6.7 keV (p, 7 TeV), Ec 44 eV
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

// ── beams and energies ────────────────────────────────────────────────────
{
  const four = g => { const s = [0, 0, 0, 0]; for (const q of g.prims) { const m = PART[q.name].m, p = Math.hypot(q.px, q.py, q.pz); s[0] += Math.hypot(p, m); s[1] += q.px; s[2] += q.py; s[3] += q.pz; } return s; };
  const z = generate('zmm', { beam: 'ee', sqrtS: 91190 }, makeRng(5)), fz = four(z);
  ok(Math.abs(fz[0] - 91190) < 1e-6 * 91190 && Math.hypot(fz[1], fz[2], fz[3]) < 1e-3, `e+e- at 91.19 GeV, Z -> mu mu: sum E ${(fz[0] / 1000).toFixed(4)} GeV, |sum p| ${Math.hypot(fz[1], fz[2], fz[3]).toExponential(1)} MeV (the Z at rest)`);
  const h = generate('hgg', { beam: 'ee', sqrtS: 250000 }, makeRng(6)), fh = four(h);
  ok(Math.abs(fh[0] - 250000) < 1e-6 * 250000 && Math.hypot(fh[1], fh[2], fh[3]) < 1e-3, `e+e- at 250 GeV, ZH (Z -> nu nu, H -> gamma gamma): sum E ${(fh[0] / 1000).toFixed(4)} GeV, |sum p| ${Math.hypot(fh[1], fh[2], fh[3]).toExponential(1)} MeV`);
  const r = generate('zee', { beam: 'ee', sqrtS: 250000 }, makeRng(7)), fr = four(r);
  ok(Math.abs(fr[0] - 250000) < 1e-6 * 250000 && r.info.truth.isr > 0, `e+e- at 250 GeV, Z -> ee by radiative return: ISR photon ${(r.info.truth.isr / 1000).toFixed(1)} GeV, sum E ${(fr[0] / 1000).toFixed(4)} GeV`);
  for (const [beam, kind, rts] of [['pp', 'jj', 1e8], ['pp', 'zmm', 1e9], ['mumu', 'tt', 1e7], ['PbPb', 'mb', 5.36e6]]) {
    const g = generate(kind, { beam, sqrtS: rts }, makeRng(8)), R = DET.run(g.prims, 3), L = R.L, bal = L.in + L.borrow - (L.dep + L.esc + L.inv + L.ret);
    ok(Math.abs(bal) < 1e-6 * L.in, `ledger, ${beam} ${kind} at ${rts / 1e6} TeV${rts > 1e8 ? ' (hypothetical)' : ''}: ${g.prims.length} primaries, in ${(L.in / 1000).toFixed(0)} GeV, imbalance ${bal.toExponential(1)} MeV (${R.stats.steps} steps, ${R.stats.ms} ms)`);
  }
}

// ══ the accelerator model (accel.js) ══════════════════════════════════════
{
  const A = await import('./accel.js');
  const ch = A.chainTable(), lhc = ch.find(c => c.id === 'lhc');
  ok(Math.abs(lhc.B - 8.09) < 0.02, `B rho = p/e: 6.8 TeV in the ${A.LHC.rho} m dipoles needs B = ${lhc.B.toFixed(3)} T (B rho ${lhc.brho.toFixed(0)} T m); 7 TeV gives ${(A.brho(7000) / A.LHC.rho).toFixed(3)} T, the 8.33 T of the design report`);
  ok(Math.abs(A.brho(7000) / A.LHC.rho - 8.33) < 0.02, 'dipole field at 7 TeV within 0.02 T of 8.33 T');
  // linac: small-amplitude phase advance per cell
  const P = A.linacParams(50), hist = A.linacTrack(P, [[0.01, 0]], 400)[0];
  let cross = [], prev = hist[0][0];
  for (let i = 1; i < hist.length; i++) { const v = hist[i][0]; if (prev > 0 && v <= 0) cross.push(i - prev / (prev - v)); prev = v; }
  const per = (cross[cross.length - 1] - cross[0]) / (cross.length - 1), mu = A.TAU / per;
  ok(rel(mu, P.muCell) < 0.03, `linac, 50 MeV, phis -30 deg: tracked phase advance ${(mu * 180 / Math.PI).toFixed(3)} deg/cell, k_l L = ${(P.muCell * 180 / Math.PI).toFixed(3)} deg/cell`);
  // FODO
  const C = A.fodo(), s2 = Math.sin(C.mu / 2), sn = Math.sin(C.mu);
  const bmax = C.Lc * (1 + s2) / sn, bmin = C.Lc * (1 - s2) / sn;
  ok(rel(C.betaMax, bmax) < 1e-3 && rel(C.betaMin, bmin) < 1e-3, `FODO, Lc ${C.Lc} m, mu ${(C.mu * 180 / Math.PI).toFixed(2)} deg: beta max ${C.betaMax.toFixed(2)} / min ${C.betaMin.toFixed(2)} m, thin-lens ${bmax.toFixed(2)} / ${bmin.toFixed(2)} m`);
  const L = C.L, th = C.theta, Dmx = L * th * (1 + s2 / 2) / (s2 * s2), Dmn = L * th * (1 - s2 / 2) / (s2 * s2);
  ok(rel(C.Dmax, Dmx) < 0.05 && rel(C.Dmin, Dmn) < 0.05, `FODO dispersion: D max ${C.Dmax.toFixed(3)} / min ${C.Dmin.toFixed(3)} m, thin-lens formula ${Dmx.toFixed(3)} / ${Dmn.toFixed(3)} m`);
  const xi = -Math.tan(C.mu / 2) / Math.PI;
  ok(rel(C.xiX, xi) < 0.01 && rel(C.xiY, xi) < 0.01, `natural chromaticity per cell: xi_x ${C.xiX.toFixed(4)}, xi_y ${C.xiY.toFixed(4)}, -tan(mu/2)/pi ${xi.toFixed(4)}`);
  const dd = 1e-4, nat = (A.cellTune(C, dd).qx - A.cellTune(C, -dd).qx) / (2 * dd);
  const S = A.sextupoleFor(C, 2 / 184, 2 / 184), qx = (A.cellTune(C, dd, S).qx - A.cellTune(C, -dd, S).qx) / (2 * dd), qy = (A.cellTune(C, dd, S).qy - A.cellTune(C, -dd, S).qy) / (2 * dd);
  ok(rel(nat, xi) < 0.02, `tracked natural chromaticity per cell ${nat.toFixed(4)} against ${xi.toFixed(4)}`);
  ok(Math.abs(qx * 184 - 2) < 0.3 && Math.abs(qy * 184 - 2) < 0.3, `sextupoles SF ${S.SF.toFixed(4)}, SD ${S.SD.toFixed(4)} m^-2: ring Q'x ${(qx * 184).toFixed(2)}, Q'y ${(qy * 184).toFixed(2)} (target +2 over 184 arc cells; natural ${(nat * 184).toFixed(1)})`);
  // betatron tune from turn-by-turn tracking (linear map)
  const rec = A.henon(0.31, 0, [1e-3, 0], 600), qm = A.measureTune(rec);
  ok(Math.abs(qm - 0.31) < 0.002, `betatron tune from 600 turns: ${qm.toFixed(4)}, set 0.31`);
  // synchrotron tune
  const R = A.rfParams(450, 8), pts = [[R.phis + 0.02, 0]], tr = [];
  for (let i = 0; i < 3000; i++) { A.rfMap(R, pts); tr.push(pts[0][0] - R.phis); }
  let c2 = []; for (let i = 1; i < tr.length; i++) if (tr[i - 1] > 0 && tr[i] <= 0) c2.push(i - tr[i - 1] / (tr[i - 1] - tr[i]));
  const qs = (c2.length - 1) / (c2[c2.length - 1] - c2[0]);
  ok(rel(qs, R.Qs) < 0.02, `synchrotron tune at 450 GeV, 8 MV: tracked ${qs.toFixed(5)}, formula ${R.Qs.toFixed(5)}`);
  const sep = A.separatrix(R), top = Math.max(...sep.pts.map(p => p[1]).filter(v => v === v));
  ok(rel(top, R.dmax0) < 0.01, `stationary bucket half-height: separatrix ${(top * 1e4).toFixed(3)}e-4, formula ${(R.dmax0 * 1e4).toFixed(3)}e-4`);
  const inB = [[R.phis, 0.9 * R.dmax0]], outB = [[R.phis, 1.1 * R.dmax0]];
  A.rfMap(R, inB, 4000); A.rfMap(R, outB, 4000);
  ok(Math.abs(inB[0][1]) <= R.dmax0 * 1.01 && Math.abs(outB[0][0] - R.phis) > Math.PI, `bucket edge: 0.9 dmax stays inside after 4000 turns, 1.1 dmax slips out by ${((outB[0][0] - R.phis) / A.TAU).toFixed(1)} RF periods`);
  // ramp
  let worst = 0, maxTurn = 0, okB = true;
  for (let t = 0; t < A.ramp(0).T; t += 30) {
    const r = A.ramp(t); if (Math.abs(r.B - A.brho(r.p) / A.LHC.rho) > 1e-9) okB = false;
    const dE = A.rampRate(t) * 1e3 * A.LHC.C / A.CLIGHT;   // MeV per turn
    maxTurn = Math.max(maxTurn, dE); worst = Math.max(worst, dE / 12);
  }
  ok(okB && worst < 0.1, `ramp: B(t) = p(t)/(e c rho) at every point; peak gain ${(maxTurn * 1e3).toFixed(0)} keV/turn, sin(phis) = ${worst.toFixed(4)} at 12 MV (a bucket exists)`);
  // luminosity, pile-up, stored energy
  const Ld = A.luminosity(A.PRESETS.design);
  ok(rel(Ld.L, 1.0e34) < 0.05, `luminosity, design: ${Ld.L.toExponential(3)} cm^-2 s^-1 (sigma* ${(Ld.sigma * 1e6).toFixed(2)} um, F ${Ld.F.toFixed(3)})`);
  ok(Math.abs(Ld.mu - 25) < 3, `pile-up at design luminosity: mu = ${Ld.mu.toFixed(1)}`);
  ok(rel(Ld.stored, 362e6) < 0.01, `stored energy per beam: ${(Ld.stored / 1e6).toFixed(1)} MJ`);
  const sr = A.srLoss(7000, A.LHC.rho), lep = A.srLoss(104.5, 3026, 'e');
  ok(rel(sr.U0, 6.7e3) < 0.02 && rel(sr.Ec, 44) < 0.03, `synchrotron radiation, 7 TeV protons: U0 ${(sr.U0 / 1e3).toFixed(2)} keV/turn, critical energy ${sr.Ec.toFixed(1)} eV`);
  ok(lep.U0 > 3.2e9 && lep.U0 < 3.6e9, `synchrotron radiation, 104.5 GeV electrons (rho 3026 m): U0 ${(lep.U0 / 1e9).toFixed(2)} GeV/turn`);
}

console.log(`\n${n - fail} of ${n} checks passed`);
process.exitCode = fail;
