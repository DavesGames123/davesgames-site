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
//    beams ........ e+e- at the Z pole and at 250 GeV close in four-momentum;
//                   the ledger at 100 TeV, 1 PeV (hypothetical), mu+mu- 10 TeV
//                   and Pb-Pb
//    display ...... a photon owns its cascade; hit tests (precision, time,
//                   speed, the muons of a real event); the detail card and
//                   its invariant mass; labels never overlap
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

// ── per-track deposits and shower rays ───────────────────────────────────
{
  const g = generate('gun', { particle: 'gamma', energy: 50000, eta: 0.3, phi: 0.6 }, makeRng(9)), R = DET.run(g.prims, 21);
  const t = R.tracks.find(q => q.primary), tot = Object.values(t.dep).reduce((a, b) => a + b, 0);
  const root = k => { let n = 0; while (k >= 0 && R.tracks[k].anc >= 0 && n++ < 60) k = R.tracks[k].anc; return k; };
  let own = 0, rays = 0; for (let i = 0; i < R.nSeg; i++) { if (root(R.segTrk[i]) === 0) own++; if (R.segCls[i] === 6) rays++; }
  ok(Math.abs(tot - (R.L.dep)) < 1e-6 * R.L.dep && own === R.nSeg && rays > 50, `a 50 GeV photon owns its cascade: deposits ${(tot / 1000).toFixed(3)} GeV of ${(R.L.dep / 1000).toFixed(3)} GeV deposited in the event (ECAL ${(t.dep.ecal / 1000).toFixed(2)}); ${own} of ${R.nSeg} segments trace to it, ${rays} shower segments and rays`);
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

// ── picking, labels and the detail card ─────────────────────────────────
{
  const { hitTest, buildObjects } = await import('./picking.js');
  const { place, overlap } = await import('./labels.js');
  const { detail } = await import('./physinfo.js');
  const id = (x, y) => [x, y];
  const line = (key, y, t0 = 0) => ({ key, kind: 'track', t0, pts: [[0, y, 0, 0], [100, y, 0, 1]] });
  const objs = [line('a', 0), line('b', 10), { key: 'p', kind: 'muhit', t0: 0, pts: [[200, 0, 0, 0]] }, line('late', 20, 50)];
  const h1 = hitTest(objs, id, 50, 2, 6), h2 = hitTest(objs, id, 50, 6.5, 6), h3 = hitTest(objs, id, 50, 30, 6), h4 = hitTest(objs, id, 50, 19, 6, 10), h5 = hitTest(objs, id, 203, 1, 6);
  ok(h1 && h1.obj.key === 'a' && Math.abs(h1.d - 2) < 1e-9 && h2 && h2.obj.key === 'b' && !h3 && (!h4 || h4.obj.key !== 'late') && h5 && h5.obj.key === 'p',
    `hit test: 2 px from line a -> a (d ${h1 && h1.d.toFixed(2)}); 6.5 px from a, 3.5 from b -> ${h2 && h2.obj.key}; 20 px away -> none; a line not yet drawn is skipped; a point hit at 3.2 px`);
  // speed: 2000 polylines of 50 points, 300 queries
  const big = []; let sd = 7; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) { const pts = []; let x = r() * 1000, y = r() * 1000; for (let j = 0; j < 50; j++) { pts.push([x, y, 0, j * 0.1]); x += (r() - 0.5) * 20; y += (r() - 0.5) * 20; } big.push({ key: 'k' + i, kind: 'track', t0: 0, pts }); }
  const cache = new Map(); hitTest(big, id, 0, 0, 6, Infinity, cache);
  const t0 = performance.now(); for (let q = 0; q < 300; q++) hitTest(big, id, r() * 1000, r() * 1000, 6, Infinity, cache);
  const ms = (performance.now() - t0) / 300;
  ok(ms < 4, `hit test speed: 2000 tracks of 50 points, ${ms.toFixed(2)} ms per query (cached projection)`);
  // a real event: pick the muons where they are drawn
  const g = generate('zmm', {}, makeRng(702)), R = DET.run(g.prims, 41), O = reconstruct(R, g.info), ev = { R, O, info: g.info, objs: buildObjects(R, O, g.info) };
  const mus = ev.objs.objs.filter(o => o.kind === 'track' && o.hard && o.name.startsWith('mu'));
  const S = 0.05, proj = (x, y) => [400 + x * S, 400 - y * S];
  let found = 0;
  for (const m of mus) { const q = m.pts.find(q => Math.hypot(q[0], q[1]) > 800) || m.pts[m.pts.length - 1], p = proj(q[0], q[1]), h = hitTest(ev.objs.objs, proj, p[0] + 1.5, p[1], 6, Infinity, new Map()); if (h && h.obj.key === m.key) found++; }
  ok(mus.length === 2 && found === 2, `Z -> mu mu: ${ev.objs.objs.length} objects; both muons picked 1.5 px off their drawn track in the r-phi projection (${found} of ${mus.length})`);
  const d = detail(mus[0], ev);
  const hasZ = d.lineage.some(x => /^Z/.test(x.label));
  ok(d.props.some(p => p[0] === 'spin') && hasZ && d.mass && Math.abs(d.mass.m - g.info.truth.mass) < 6000, `detail card of ${d.title}: lineage ${d.lineage.map(x => x.label).join(' > ')}; m from the daughters ${(d.mass.m / 1000).toFixed(2)} GeV, true ${(g.info.truth.mass / 1000).toFixed(2)} GeV`);
  // labels: no overlap, every hard label placed
  const items = []; for (let i = 0; i < 80; i++) { const a = r() * 6.283; items.push({ x: 200 + 120 * Math.cos(a), y: 200 + 120 * Math.sin(a), dx: Math.cos(a), dy: Math.sin(a), w: 60, h: 14, prio: r(), hard: i < 6 }); }
  const P = place(items, { x: 0, y: 0, w: 400, h: 400 }, [{ x: 0, y: 0, w: 120, h: 40 }]);
  let bad = 0; for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (overlap(P[i], P[j], 0)) bad++;
  const hardOk = P.filter(p => p.item.hard).length === 6;
  ok(bad === 0 && hardOk && P.length >= 15, `labels: ${P.length} of 80 placed with ${bad} overlaps; all 6 hard labels placed`);
}

console.log(`\n${n - fail} of ${n} checks passed`);
process.exitCode = fail;
