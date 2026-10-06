// ============================================================================
//  PARTICLE COLLIDER  ·  generators.js — proton-proton events at 13.6 TeV
// ----------------------------------------------------------------------------
//  No DOM. generate(kind, o, rng) returns { prims, info }:
//    prims  [{ name, px, py, pz (MeV), x, y, z (mm), t (ns), tag }]
//    info   { kind, title, process, sqrtS, truth: {..numbers..}, hard: [...] }
//  The kinematics are simple but exact where it counts: resonance masses
//  from a Breit-Wigner, two-body decays in the rest frame with the right
//  angular law (1 + cos^2 theta for Z -> l l, flat for H), then a Lorentz
//  boost. Production (rapidity, pT of the system) uses smooth shapes, not
//  parton densities.
//
//  JETS (grep -n 'function shower')
//    A parton shower stand-in: a few gluon emissions with log-uniform
//    energy share (0.05-0.5) and angle (0.02-0.35 rad), more for gluons
//    (colour factor 3 against 4/3). Each final parton fragments
//    independently (Field-Feynman, f(z) = 1 - a + 3a(1 - z)^2, a = 0.77,
//    Gaussian pT 0.35 GeV). A b quark first makes a B hadron (z 0.6-0.95)
//    that flies about 0.5 mm per unit beta gamma before it decays.
//
//  SCENARIOS (grep -n 'export const SCENARIOS')
//    gun  zmm  zee  hgg  h4l  tt  jj  mb   (o.pileup adds minimum-bias vertices)
// ============================================================================
import { PART, WIDTH } from './particles.js';
import { twoBody, boost } from './transport.js';

export const SQRT_S = 13.6e6;   // MeV
export const SCENARIOS = {
  gun: { title: 'Particle gun', process: 'one particle from the origin', short: 'Gun' },
  zmm: { title: 'Z → μ⁺μ⁻', process: 'pp → Z → μ⁺μ⁻', short: 'Z→μμ' },
  zee: { title: 'Z → e⁺e⁻', process: 'pp → Z → e⁺e⁻', short: 'Z→ee' },
  hgg: { title: 'H → γγ', process: 'pp → H → γγ', short: 'H→γγ' },
  h4l: { title: 'H → ZZ* → 4ℓ', process: 'pp → H → ZZ* → 4ℓ', short: 'H→4ℓ' },
  tt: { title: 'Top pair', process: 'pp → tt̄ → WbWb', short: 'tt̄' },
  jj: { title: 'QCD dijet', process: 'pp → jet jet', short: 'Dijet' },
  mb: { title: 'Minimum bias + pile-up', process: 'pp inelastic, many vertices', short: 'Pile-up' },
};

const gaussR = rng => { let u = 0; while (u < 1e-300) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); };
const expR = (rng, m) => -m * Math.log(rng() || 1e-12);
function poisson(rng, mu) {
  if (mu > 40) return Math.max(0, Math.round(mu + Math.sqrt(mu) * gaussR(rng)));
  let L = Math.exp(-mu), k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1;
}
// Breit-Wigner (Cauchy) mass, cut to m0 +- cut
export function bwMass(rng, m0, G, cut = 8 * G) {
  for (let i = 0; i < 100; i++) { const m = m0 + G / 2 * Math.tan(Math.PI * (rng() - 0.5)); if (Math.abs(m - m0) < cut) return m; }
  return m0;
}
const unit = v => { const n = Math.hypot(...v); return v.map(c => c / n); };
function dirFrom(cosT, phi) { const s = Math.sqrt(Math.max(0, 1 - cosT * cosT)); return [s * Math.cos(phi), s * Math.sin(phi), cosT]; }
function rotateU(u, th, ph) {
  const [ux, uy, uz] = u, st = Math.sin(th), ct = Math.cos(th);
  let ax, ay, az;
  if (Math.abs(uz) < 0.9) { const n = Math.hypot(ux, uy); ax = -uy / n; ay = ux / n; az = 0; } else { const n = Math.hypot(uy, uz); ax = 0; ay = -uz / n; az = uy / n; }
  const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax, c = Math.cos(ph), s = Math.sin(ph);
  return unit([ux * ct + st * (c * ax + s * bx), uy * ct + st * (c * ay + s * by), uz * ct + st * (c * az + s * bz)]);
}
const mass = p => Math.sqrt(Math.max(0, p[0] * p[0] - p[1] * p[1] - p[2] * p[2] - p[3] * p[3]));
const velocity = p => [p[1] / p[0], p[2] / p[0], p[3] / p[0]];
// a system of mass m with rapidity y, transverse momentum pT, azimuth phi
function system(m, y, pT, phi) { const mT = Math.hypot(m, pT); return [mT * Math.cosh(y), pT * Math.cos(phi), pT * Math.sin(phi), mT * Math.sinh(y)]; }
// two-body decay with polar law w(cos) (max 1) about the boost axis (or z)
function decay2(rng, P, m1, m2, w = () => 1) {
  const M = mass(P);
  let c; do { c = 2 * rng() - 1; } while (rng() > w(c));
  const d = dirFrom(c, 2 * Math.PI * rng());
  const [a, b] = twoBody(M, m1, m2, d), v = velocity(P);
  return [boost(a, v), boost(b, v)];
}
const zLaw = c => (1 + c * c) / 2;

// ── jets ──────────────────────────────────────────────────────────────────
function pickHadron(rng) {
  const r = rng();
  if (r < 0.27) return 'pi+'; if (r < 0.54) return 'pi-'; if (r < 0.80) return 'pi0';
  if (r < 0.86) return rng() < 0.5 ? 'K+' : 'K-'; if (r < 0.89) return 'K0S'; if (r < 0.92) return 'K0L';
  if (r < 0.96) return 'p'; return 'n';
}
function ffZ(rng) { const a = 0.77; for (;;) { const z = rng(); if (rng() * (1 + 2 * a) < 1 - a + 3 * a * (1 - z) ** 2) return Math.max(0.02, z); } }
export function shower(rng, p4, flav, vtx, out, tag) {
  const E0 = p4[0], parts = [{ E: E0, u: unit(p4.slice(1)), f: flav }];
  const nem = poisson(rng, (flav === 'g' ? 0.27 : 0.12) * Math.max(0, Math.log(E0 / 5000)) ** 2);
  for (let i = 0; i < Math.min(nem, 8); i++) {
    const cand = parts.filter(q => q.E > 10000);
    if (!cand.length) break;
    const q = cand[Math.floor(rng() * cand.length)];
    const z = 0.05 * Math.pow(10, rng()), th = 0.02 * Math.pow(17.5, rng()), ph = 2 * Math.PI * rng();
    parts.push({ E: z * q.E, u: rotateU(q.u, th, ph), f: 'g' });
    q.u = rotateU(q.u, th * z / (1 - z), ph + Math.PI); q.E *= 1 - z;
  }
  for (const q of parts) fragment(rng, q, vtx, out, tag);
}
function fragment(rng, q, vtx, out, tag) {
  let Er = q.E, first = true, last = null;
  while (Er > 1500) {
    let name, z;
    if (first && q.f === 'b') { name = 'B'; z = 0.6 + 0.35 * rng(); }
    else { name = pickHadron(rng); z = ffZ(rng); }
    first = false;
    const m = PART[name].m, E = z * Er;
    if (E <= m * 1.05) { if (Er < 3000) break; continue; }
    const p = Math.sqrt(E * E - m * m);
    let pT = 350 * Math.hypot(gaussR(rng), gaussR(rng)) / Math.SQRT2;
    if (pT > 0.7 * p) pT = 0.7 * p * rng();
    const u = rotateU(q.u, Math.asin(pT / p), 2 * Math.PI * rng());
    last = { name, px: p * u[0], py: p * u[1], pz: p * u[2], x: vtx[0], y: vtx[1], z: vtx[2], t: vtx[3], tag };
    out.push(last); Er -= E;
  }
  // the rest to one more pion (or onto the last hadron)
  if (Er > 160) { const m = PART['pi+'].m, p = Math.sqrt(Er * Er - m * m); out.push({ name: rng() < 0.5 ? 'pi+' : 'pi-', px: p * q.u[0], py: p * q.u[1], pz: p * q.u[2], x: vtx[0], y: vtx[1], z: vtx[2], t: vtx[3], tag }); }
  else if (last) { const m = PART[last.name].m, p0 = Math.hypot(last.px, last.py, last.pz), E = Math.hypot(p0, m) + Er, p = Math.sqrt(E * E - m * m), k = p / p0; last.px *= k; last.py *= k; last.pz *= k; }
}

// ── minimum bias ──────────────────────────────────────────────────────────
function minBias(rng, vtx, out, scale = 1, tag = 'pu') {
  const n = Math.round(poisson(rng, 75 * scale) * (0.6 + 0.8 * rng()));
  for (let i = 0; i < n; i++) {
    const name = pickHadron(rng), m = PART[name].m;
    const pT = (expR(rng, 250) + expR(rng, 250)) * (name === 'p' || name === 'n' ? 1.4 : 1);
    const eta = -5 + 10 * rng(), phi = 2 * Math.PI * rng();
    out.push({ name, px: pT * Math.cos(phi), py: pT * Math.sin(phi), pz: pT * Math.sinh(eta), x: vtx[0], y: vtx[1], z: vtx[2], t: vtx[3], tag });
    void m;
  }
}
export const vertexIP = rng => [0.012 * gaussR(rng), 0.012 * gaussR(rng), 45 * gaussR(rng), 0.15 * gaussR(rng)];

// ── the scenarios ─────────────────────────────────────────────────────────
const LEPT = { mu: ['mu-', 'mu+'], e: ['e-', 'e+'] };
const p3 = (p, name, v, tag) => ({ name, px: p[1], py: p[2], pz: p[3], x: v[0], y: v[1], z: v[2], t: v[3], tag });

export function generate(kind, o = {}, rng) {
  const prims = [], hard = [], truth = {};
  const v = kind === 'gun' ? [0, 0, 0, 0] : vertexIP(rng);
  const S = SCENARIOS[kind] || SCENARIOS.gun;
  const addLeptons = (P, fl) => {
    const [a, b] = decay2(rng, P, PART[LEPT[fl][0]].m, PART[LEPT[fl][1]].m, zLaw);
    prims.push(p3(a, LEPT[fl][0], v, 'hard'), p3(b, LEPT[fl][1], v, 'hard'));
    hard.push([LEPT[fl][0], a], [LEPT[fl][1], b]);
  };
  const resonance = (m, sy, pTm) => system(m, Math.max(-3.5, Math.min(3.5, sy * gaussR(rng))), expR(rng, pTm / 2) + expR(rng, pTm / 2), 2 * Math.PI * rng());

  switch (kind) {
    case 'gun': {
      const name = o.particle || 'e-', P = PART[name], T = o.energy || 50000, eta = o.eta ?? 0.3, phi = o.phi ?? 0.6;
      const n = o.count || 1;
      for (let i = 0; i < n; i++) {
        const e = eta + (n > 1 ? (rng() - 0.5) * 0.3 : 0), f = phi + (n > 1 ? (rng() - 0.5) * 0.3 : 0);
        const p = Math.sqrt(T * (T + 2 * P.m)), th = 2 * Math.atan(Math.exp(-e)), u = [Math.sin(th) * Math.cos(f), Math.sin(th) * Math.sin(f), Math.cos(th)];
        prims.push({ name, px: p * u[0], py: p * u[1], pz: p * u[2], x: 0, y: 0, z: 0, t: 0, tag: 'hard' });
        hard.push([name, [T + P.m, p * u[0], p * u[1], p * u[2]]]);
      }
      Object.assign(truth, { particle: name, E: T, eta, phi });
      break;
    }
    case 'zmm': case 'zee': {
      const m = bwMass(rng, PART.Z.m, WIDTH.Z), P = resonance(m, 1.9, 12000);
      addLeptons(P, kind === 'zmm' ? 'mu' : 'e');
      Object.assign(truth, { mass: m, pT: Math.hypot(P[1], P[2]), y: 0.5 * Math.log((P[0] + P[3]) / (P[0] - P[3])) });
      break;
    }
    case 'hgg': {
      const m = bwMass(rng, PART.H.m, WIDTH.H), P = resonance(m, 1.7, 30000);
      const [a, b] = decay2(rng, P, 0, 0);
      prims.push(p3(a, 'gamma', v, 'hard'), p3(b, 'gamma', v, 'hard')); hard.push(['gamma', a], ['gamma', b]);
      Object.assign(truth, { mass: m, pT: Math.hypot(P[1], P[2]) });
      break;
    }
    case 'h4l': {
      const mH = bwMass(rng, PART.H.m, WIDTH.H), P = resonance(mH, 1.7, 30000);
      const mZ = PART.Z.m, G = WIDTH.Z;
      let m1, m2;
      for (;;) {
        m1 = bwMass(rng, mZ, G, 25000); if (m1 > mH - 12000) continue;
        m2 = 12000 + (mH - m1 - 12000) * rng();
        const pst = Math.sqrt(Math.max(0, (mH * mH - (m1 + m2) ** 2) * (mH * mH - (m1 - m2) ** 2))) / (2 * mH);
        const bw = 1 / ((m2 * m2 - mZ * mZ) ** 2 + mZ * mZ * G * G);
        if (rng() < pst / 30000 * bw * (12000 ** 2 - mZ * mZ) ** 2 * 0.9) break;
      }
      const [Z1, Z2] = decay2(rng, P, m1, m2);
      const r = rng(), f1 = r < 0.25 ? 'mu' : r < 0.5 ? 'e' : r < 0.75 ? 'mu' : 'e', f2 = r < 0.25 ? 'mu' : r < 0.5 ? 'e' : r < 0.75 ? 'e' : 'mu';
      addLeptons(Z1, f1); addLeptons(Z2, f2);
      Object.assign(truth, { mass: mH, mZ1: m1, mZ2: m2, pT: Math.hypot(P[1], P[2]), channel: f1 === f2 ? `4${f1 === 'mu' ? 'μ' : 'e'}` : '2e2μ' });
      break;
    }
    case 'tt': {
      const mt = PART.t.m, Mtt = 2 * mt + expR(rng, 120000), P = system(Mtt, gaussR(rng), expR(rng, 15000), 2 * Math.PI * rng());
      const [t1, t2] = decay2(rng, P, bwMass(rng, mt, WIDTH.t, 15000), bwMass(rng, mt, WIDTH.t, 15000));
      let nl = 0;
      for (const [T, sgn] of [[t1, 1], [t2, -1]]) {
        const mW = bwMass(rng, PART.W.m, WIDTH.W, 15000), [W, b] = decay2(rng, T, mW, 4800);
        shower(rng, b, 'b', v, prims, 'bjet'); hard.push(['b', b]);
        const r = rng();
        if (r < 0.214) {
          const fl = r < 0.108 ? 'e' : 'mu', ln = sgn > 0 ? LEPT[fl][1] : LEPT[fl][0];
          const [l, nu] = decay2(rng, W, PART[ln].m, 0);
          prims.push(p3(l, ln, v, 'hard'), p3(nu, 'nu', v, 'hard')); hard.push([ln, l], ['nu', nu]); nl++;
        } else {
          const [q1, q2] = decay2(rng, W, 300, 300);
          shower(rng, q1, 'q', v, prims, 'jet'); shower(rng, q2, 'q', v, prims, 'jet'); hard.push(['q', q1], ['q', q2]);
        }
      }
      Object.assign(truth, { mass: Mtt, mt, leptons: nl, channel: nl === 2 ? 'dilepton' : nl === 1 ? 'lepton + jets' : 'all hadronic' });
      break;
    }
    case 'jj': {
      const pmin = o.ptMin || 150000;
      const pT = Math.min(2.5e6, pmin * Math.pow(1 - rng(), -1 / 4));
      const y1 = -2.5 + 5 * rng(), y2 = -2.5 + 5 * rng(), phi = 2 * Math.PI * rng();
      const j1 = [pT * Math.cosh(y1), pT * Math.cos(phi), pT * Math.sin(phi), pT * Math.sinh(y1)];
      const j2 = [pT * Math.cosh(y2), -pT * Math.cos(phi), -pT * Math.sin(phi), pT * Math.sinh(y2)];
      for (const j of [j1, j2]) { const r = rng(), f = r < 0.6 ? 'g' : r < 0.95 ? 'q' : 'b'; shower(rng, j, f, v, prims, 'jet'); hard.push([f, j]); }
      const s = [j1[0] + j2[0], j1[1] + j2[1], j1[2] + j2[2], j1[3] + j2[3]];
      Object.assign(truth, { pT, mass: mass(s), dy: Math.abs(y1 - y2) });
      break;
    }
    case 'mb': default: {
      minBias(rng, v, prims, 1, 'hard');
      truth.vertices = 1;
      break;
    }
  }
  // the underlying event of a hard collision, and pile-up vertices
  if (kind !== 'gun' && kind !== 'mb') minBias(rng, v, prims, 0.35, 'ue');
  const pu = kind === 'gun' ? 0 : Math.max(0, o.pileup ?? (kind === 'mb' ? 30 : 0));
  const nPU = kind === 'mb' ? Math.max(0, Math.round(pu) - 1) : poisson(rng, pu);
  const vtxs = [v];
  for (let i = 0; i < nPU; i++) { const w = vertexIP(rng); vtxs.push(w); minBias(rng, w, prims, 1, 'pu'); }
  if (kind === 'mb') truth.vertices = vtxs.length;
  return { prims, info: { kind, title: S.title, process: S.process, sqrtS: SQRT_S, truth, hard, vertex: v, vertices: vtxs, pileup: nPU } };
}
