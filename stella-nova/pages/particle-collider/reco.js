// ============================================================================
//  PARTICLE COLLIDER  ·  reco.js — from hits and cells to physics objects
// ----------------------------------------------------------------------------
//  No DOM. reconstruct(result, info) reads the merged transport result and
//  returns { tracks, clusters, muons, electrons, photons, towers, jets, met,
//  ht, masses, trigger, sub }.
//
//  TRACKS (grep -n 'function fitTrack')
//    The hits are grouped by their true track (perfect pattern recognition:
//    a simplification). A track with 5 or more silicon hits gets an
//    algebraic circle fit in x-y (Kasa), R -> pT = 0.2998 B R (MeV, T, mm),
//    the charge from the turn direction, and a straight-line fit of z
//    against the arc length for eta. The sagitta s = R - sqrt(R^2 - L^2/4)
//    over the chord L of the first and last hit is the quantity a real
//    tracker measures: pT = 0.3 B L^2 / (8 s) for s << L.
//  CALORIMETER
//    ECAL clusters: a seed cell over 1 GeV that is a local maximum, then the
//    5 x 5 cells around it. HCAL towers are calibrated with KHCAL (a 50 GeV
//    pion beam in this engine gives about 50 GeV). Towers (0.087 x 0.087)
//    sum ECAL and HCAL.
//  OBJECTS
//    muon: a track with 2 or more muon-chamber hits. electron: a cluster
//    with a track within dR 0.05 at the ECAL face (helix extrapolation)
//    and 0.5 < E/p < 2. photon: a cluster with no such track. jets:
//    anti-kt, R = 0.4, on towers over 0.3 GeV, scaled by 1/jetResponse;
//    jets near an e or a photon are removed. MET: minus the vector sum of tower ET and muon pT.
//  TRIGGER  a level-1 menu with thresholds near those of LHC experiments
//    (grep -n 'const MENU').
// ============================================================================
import { ECAL, HCAL, B0, cellCenter } from './geometry.js';
import { PART } from './particles.js';

// Calorimeter-jet response (raw jet pT over parton pT), measured with QCD
// dijets in this engine: 0.69 at 35 GeV raw, 0.73 at 130, 0.75 at 400.
// Soft charged pions curl inside the tracker and never reach the
// calorimeters; the hadron response is below the electron response.
// Real experiments correct calorimeter jets the same way (jet energy
// corrections from simulation).
export const jetResponse = pt => 0.655 + 0.027 * Math.log(Math.max(1, pt / 10000));
export const KHCAL = 1.05;   // HCAL energy scale on top of the mip sampling fraction (50 GeV pions)
const D2R = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
export const dR = (e1, p1, e2, p2) => Math.hypot(e1 - e2, D2R(p1, p2));

export function fitTrack(pts, B = B0) {
  // Kasa fit: minimise sum (x^2 + y^2 + D x + E y + F)^2
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0, n = pts.length;
  for (const [x, y] of pts) { const z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], b = [-Sxz, -Syz, -Sz];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-12) return null;
  const sol = [0, 1, 2].map(k => det(A.map((r, i) => r.map((v, j) => j === k ? b[i] : v))) / d);
  const cx = -sol[0] / 2, cy = -sol[1] / 2, R = Math.sqrt(Math.max(0, cx * cx + cy * cy - sol[2]));
  // turn direction from the first to the last hit, about the centre
  const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1];
  const cross = (x0 - cx) * (y1 - cy) - (y0 - cy) * (x1 - cx);
  const q = cross < 0 ? 1 : -1;   // clockwise in +Bz: positive
  const L = Math.hypot(x1 - x0, y1 - y0), sag = R - Math.sqrt(Math.max(0, R * R - L * L / 4));
  // z against arc length from the beam line
  let s1 = 0, s2 = 0, z1 = 0, sz = 0;
  for (const p of pts) { const r = Math.hypot(p[0], p[1]), s = 2 * R * Math.asin(Math.min(1, r / (2 * R))); s1 += s; s2 += s * s; z1 += p[2]; sz += s * p[2]; }
  const cot = (n * sz - s1 * z1) / (n * s2 - s1 * s1 || 1), z0 = (z1 - cot * s1) / n;
  const theta = Math.atan2(1, cot), eta = -Math.log(Math.tan(theta / 2));
  const pT = 0.299792458 * B * R;
  // phi at the origin: the tangent at the point of closest approach
  const phi0 = Math.atan2(cx * q, -cy * q);
  return { pT, R, q, cx, cy, eta, phi0, z0, sag, L, d0: Math.abs(Math.hypot(cx, cy) - R), p: pT * Math.cosh(eta), n };
}
// phi of the track where it crosses radius r
export const phiAt = (t, r) => t.phi0 - t.q * Math.asin(Math.min(1, r / (2 * t.R)));

const MENU = [
  ['L1_SingleMu22', o => o.muons.some(m => m.pT > 22000)],
  ['L1_DoubleMu_15_7', o => o.muons.length > 1 && o.muons[0].pT > 15000 && o.muons[1].pT > 7000],
  ['L1_SingleEG36', o => o.egs.some(c => c.ET > 36000)],
  ['L1_DoubleEG_25_14', o => o.egs.length > 1 && o.egs[0].ET > 25000 && o.egs[1].ET > 14000],
  ['L1_SingleJet180', o => o.jets.some(j => j.pT > 180000)],
  ['L1_HTT360', o => o.ht > 360000],
  ['L1_ETM100', o => o.met.et > 100000],
];

export function reconstruct(R, info = {}) {
  // ── tracks ──
  const byTrk = new Map(), mu = new Map();
  for (let i = 0; i < R.hits.n; i++) { const k = R.hits.trk[i]; if (k < 0) continue; if (!byTrk.has(k)) byTrk.set(k, []); byTrk.get(k).push([R.hits.f[i * 6], R.hits.f[i * 6 + 1], R.hits.f[i * 6 + 2]]); }
  for (let i = 0; i < R.mhits.n; i++) { const k = R.mhits.trk[i]; if (k >= 0) mu.set(k, (mu.get(k) || 0) + 1); }
  const tracks = [];
  for (const [k, pts] of byTrk) {
    if (pts.length < 5) continue;
    pts.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    if (Math.hypot(pts[0][0], pts[0][1]) > 600) continue;
    const f = fitTrack(pts);
    if (!f || f.pT < 300) continue;
    const T = R.tracks[k];
    f.k = k; f.truth = T ? T.name : '?'; f.mu = mu.get(k) || 0; f.hits = pts;
    if (T) { const m = PART[T.name] ? PART[T.name].m : 0, p = Math.sqrt(Math.max(0, T.E0 * T.E0 - m * m)); f.pTtrue = p * Math.hypot(T.u0[0], T.u0[1]); }
    tracks.push(f);
  }
  tracks.sort((a, b) => b.pT - a.pT);
  const muons = tracks.filter(t => t.mu >= 2 && t.pT > 3000).map(t => ({ ...t, kind: 'mu' }));

  // ── ECAL clusters ──
  const NE = ECAL.neta, NP = ECAL.nphi, cl = [];
  for (let c = 0; c < R.ecal.length; c++) {
    const e = R.ecal[c]; if (e < 1000) continue;
    const ie = Math.floor(c / NP), ip = c % NP;
    let peak = true, sum = 0, se = 0, sp = 0;
    const [e0, p0] = cellCenter(ECAL, c);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const je = ie + a; if (je < 0 || je >= NE) continue;
      const jp = (ip + b + NP) % NP, q = R.ecal[je * NP + jp];
      if (q > e && Math.abs(a) <= 1 && Math.abs(b) <= 1) peak = false;
      const [ee, pp] = cellCenter(ECAL, je * NP + jp);
      sum += q; se += q * ee; sp += q * D2R(pp, p0);
    }
    if (!peak) continue;
    const eta = se / sum, phi = p0 + sp / sum;
    cl.push({ E: sum, eta, phi, ET: sum / Math.cosh(eta), cell: c });
  }
  cl.sort((a, b) => b.ET - a.ET);
  const electrons = [], photons = [];
  // HCAL energy behind a cluster (H/E) and the tower ET in a cone of 0.3
  // around it, less the cluster (isolation): a jet's pi0 photons fail both
  const NHc = HCAL.neta * HCAL.nphi, hcalAt = (eta, phi) => {
    let s = 0;
    for (let c = 0; c < NHc; c++) { if (!R.hcalS[c]) continue; const [e, p] = cellCenter(HCAL, c); if (dR(e, p, eta, phi) < 0.15) s += R.hcalS[c] * KHCAL; }
    return s;
  };
  const iso = (eta, phi, own) => {
    let s = 0;
    for (let c = 0; c < R.ecal.length; c++) { if (R.ecal[c] < 100) continue; const [e, p] = cellCenter(ECAL, c); if (dR(e, p, eta, phi) < 0.3) s += R.ecal[c] / Math.cosh(e); }
    for (let c = 0; c < NHc; c++) { if (R.hcalS[c] < 100) continue; const [e, p] = cellCenter(HCAL, c); if (dR(e, p, eta, phi) < 0.3) s += R.hcalS[c] * KHCAL / Math.cosh(e); }
    for (const t of tracks) if (!t.mu && dR(t.eta, t.phi0, eta, phi) < 0.3 && dR(t.eta, t.phi0, eta, phi) > 0.02) s += t.pT * 0.3;
    return Math.max(0, s - own);
  };
  for (const c of cl) {
    if (c.ET < 5000) continue;
    c.hoe = hcalAt(c.eta, c.phi) / c.E; c.iso = iso(c.eta, c.phi, c.ET) / c.ET;
    if (c.hoe > 0.15 || c.iso > 0.25) continue;
    const rFace = Math.abs(c.eta) < 1.479 ? 1290 : Math.min(1290, 3000 / Math.abs(Math.sinh(c.eta)));
    const m = tracks.find(t => !t.mu && t.pT > 2000 && dR(t.eta, phiAt(t, rFace), c.eta, c.phi) < 0.05 && c.E / t.p > 0.5 && c.E / t.p < 2);
    if (m) electrons.push({ ...c, kind: 'e', q: m.q, track: m, pT: c.ET });
    else photons.push({ ...c, kind: 'gamma', pT: c.ET });
  }

  // ── towers ──
  const NH = HCAL.neta * HCAL.nphi, tE = new Float64Array(NH), tEm = new Float64Array(NH);
  const k = HCAL.deta / ECAL.deta;
  for (let c = 0; c < R.ecal.length; c++) {
    const e = R.ecal[c]; if (e <= 0) continue;
    const ie = Math.floor(c / NP), ip = c % NP, he = Math.floor(ie / k), hp = Math.floor(ip / (NP / HCAL.nphi));
    if (he < HCAL.neta) { tE[he * HCAL.nphi + hp] += e; tEm[he * HCAL.nphi + hp] += e; }
  }
  for (let c = 0; c < NH; c++) tE[c] += R.hcalS[c] * KHCAL;
  const towers = [];
  for (let c = 0; c < NH; c++) {
    if (tE[c] < 300) continue;
    const [eta, phi] = cellCenter(HCAL, c), ET = tE[c] / Math.cosh(eta);
    towers.push({ c, eta, phi, E: tE[c], em: tEm[c], ET });
  }

  // ── anti-kt jets (R = 0.4) ──
  const Rj = 0.4, ps = towers.filter(t => t.ET > 300).map(t => ({ pt: t.ET, eta: t.eta, phi: t.phi, px: t.ET * Math.cos(t.phi), py: t.ET * Math.sin(t.phi), pz: t.ET * Math.sinh(t.eta), E: t.E, n: 1, em: t.em }));
  const jets = [];
  while (ps.length) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < ps.length; i++) {
      const di = 1 / (ps[i].pt * ps[i].pt);
      if (di < best) { best = di; bi = i; bj = -1; }
      for (let j = i + 1; j < ps.length; j++) {
        const d = Math.min(di, 1 / (ps[j].pt * ps[j].pt)) * ((ps[i].eta - ps[j].eta) ** 2 + D2R(ps[i].phi, ps[j].phi) ** 2) / (Rj * Rj);
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    if (bj < 0) { jets.push(ps[bi]); ps.splice(bi, 1); continue; }
    const a = ps[bi], b = ps[bj], px = a.px + b.px, py = a.py + b.py, pz = a.pz + b.pz, E = a.E + b.E, pt = Math.hypot(px, py);
    ps[bi] = { px, py, pz, E, pt, phi: Math.atan2(py, px), eta: Math.asinh(pz / Math.max(1e-9, pt)), n: a.n + b.n, em: a.em + b.em };
    ps.splice(bj, 1);
  }
  const egs = [...electrons, ...photons];
  const goodJets = jets.filter(j => j.pt > 15000 && !egs.some(c => dR(c.eta, c.phi, j.eta, j.phi) < 0.3)).map(j => {
    const k = 1 / jetResponse(j.pt);
    return { pT: j.pt * k, pTraw: j.pt, jec: k, eta: j.eta, phi: j.phi, E: j.E * k, m: Math.sqrt(Math.max(0, j.E * j.E - j.px * j.px - j.py * j.py - j.pz * j.pz)) * k, n: j.n, emf: j.em / j.E };
  }).filter(j => j.pT > 20000).sort((a, b) => b.pT - a.pT);

  // ── MET and HT ──
  let mx = 0, my = 0;
  for (const t of towers) { mx -= t.ET * Math.cos(t.phi); my -= t.ET * Math.sin(t.phi); }
  for (const m of muons) { mx -= m.pT * Math.cos(m.phi0); my -= m.pT * Math.sin(m.phi0); }
  let nx = 0, ny = 0; for (const n of R.nu) { nx += n[0]; ny += n[1]; }
  const met = { et: Math.hypot(mx, my), phi: Math.atan2(my, mx), trueEt: Math.hypot(nx, ny), truePhi: Math.atan2(ny, nx) };
  const ht = goodJets.reduce((s, j) => s + j.pT, 0);

  // ── masses ──
  const p4 = o => { const pT = o.pT, ph = o.kind === 'mu' ? o.phi0 : o.phi, m = o.kind === 'mu' ? PART['mu-'].m : o.kind === 'e' ? PART['e-'].m : 0, pz = pT * Math.sinh(o.eta); return [Math.sqrt(pT * pT * Math.cosh(o.eta) ** 2 + m * m), pT * Math.cos(ph), pT * Math.sin(ph), pz]; };
  const inv = list => { const s = [0, 0, 0, 0]; for (const o of list) { const q = p4(o); for (let i = 0; i < 4; i++) s[i] += q[i]; } return Math.sqrt(Math.max(0, s[0] * s[0] - s[1] * s[1] - s[2] * s[2] - s[3] * s[3])); };
  const masses = {};
  if (muons.length >= 2) masses.mumu = inv(muons.slice(0, 2));
  if (electrons.length >= 2) masses.ee = inv(electrons.slice(0, 2));
  if (photons.length >= 2) masses.gg = inv(photons.slice(0, 2));
  const leps = [...muons.slice(0, 4), ...electrons.slice(0, 4)].sort((a, b) => b.pT - a.pT);
  if (leps.length >= 4) masses.l4 = inv(leps.slice(0, 4));
  if (goodJets.length >= 2) { const j = goodJets.slice(0, 2), s = [0, 0, 0, 0]; for (const q of j) { s[0] += q.E; s[1] += q.pT * Math.cos(q.phi); s[2] += q.pT * Math.sin(q.phi); s[3] += q.pT * Math.sinh(q.eta); } masses.jj = Math.sqrt(Math.max(0, s[0] ** 2 - s[1] ** 2 - s[2] ** 2 - s[3] ** 2)); }

  // ── trigger ──
  const O = { muons, egs: egs.slice().sort((a, b) => b.ET - a.ET), jets: goodJets, ht, met };
  const bits = MENU.map(([n, f]) => [n, !!f(O)]);
  const trigger = { bits, accept: bits.some(b => b[1]) };

  // ── energy per subsystem (MeV) ──
  const s = R.sys, sub = { tracker: (s.pix || 0) + (s.sct || 0), ecal: s.ecal || 0, hcal: (s.hcal || 0) + (s.hcalS || 0), hcalVis: s.hcalS || 0, coil: s.sol || 0, yoke: s.yoke || 0, muon: s.mu || 0, pipe: s.pipe || 0 };
  return { tracks, clusters: cl, muons, electrons, photons, towers, jets: goodJets, met, ht, masses, trigger, sub };
}
