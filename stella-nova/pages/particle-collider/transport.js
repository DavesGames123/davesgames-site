// ============================================================================
//  PARTICLE COLLIDER  ·  transport.js — the Monte Carlo stepping engine
// ----------------------------------------------------------------------------
//  No DOM. worker.js runs it in Web Workers; tests.mjs runs it in node.
//  The scheme follows the tracking chapter of the Geant4 Application
//  Developer guide and the PRM, written anew in JavaScript:
//
//  STEP (grep -n 'function stepCharged' / 'function stepNeutral')
//    A track moves in steps. Each step is the shortest of:
//      - the physics length: the number of interaction lengths left (drawn
//        once as -ln u, used up step by step, as Geant4 does) over the
//        total discrete cross section (delta rays, brem, hadronic;
//        Compton, pair, photoelectric for photons)
//      - the decay length left (proper time left times beta gamma c)
//      - the continuous-loss limit max(finalRange, 0.2 x range)
//      - the geometry limit (nextBoundary along the tangent)
//      - in a field, the chord limit sqrt(8 R delta)
//    In a field the track follows a helix where Bz is uniform, and RK4
//    where it is not. A curved step that ends in a new volume is cut back
//    to the boundary by bisection.
//    Along the step: the mean loss from the range table, a Gamma-shaped
//    fluctuation (physics.js sampleLoss), multiple scattering (Highland)
//    and its lateral shift, Cherenkov and scintillation photon counts.
//    At the end: the discrete process, the decay, or the new volume.
//    Secondaries go on a stack (last in, first out).
//
//  ENERGY LEDGER (grep -n 'L.borrow')
//    Every particle carries its total energy. A process that takes an
//    electron or a nucleon out of the atom "borrows" its rest mass; a
//    particle that stops and stays (e-, p, n) "returns" its rest mass.
//      in + borrow = dep + esc + inv + ret
//    dep: deposited in matter; esc: total energy of tracks that leave the
//    world; inv: neutrinos and nuclear binding. tests.mjs checks the sum.
//
//  HADRONIC CASCADE (grep -n 'function hadronic')
//    A parametrised model, not a nuclear model: at an inelastic collision
//    (length lambda_I, longer for pions and kaons) the energy goes to
//    binding (invisible, 12-22 %), slow evaporation nucleons, a leading
//    particle and new pions (pi+ pi- pi0 in equal parts, 8 % kaons) with
//    pT ~ 0.3 GeV. pi0 -> gamma gamma, so each generation passes about a
//    third of its energy to the electromagnetic part.
//
//  DECAYS (grep -n 'function decay')
//    pi -> mu nu, K -> mu nu (64 %) or pi pi0, K0S -> pi+ pi- or pi0 pi0,
//    pi0 -> gamma gamma, mu -> e nu nu (Michel spectrum), B -> hadrons or
//    l nu + hadrons. Rest-frame kinematics, then a Lorentz boost.
//
//  OUTPUT  createEngine(o).run(primaries, seed) -> result (grep -n 'function newResult')
//    seg ....... Float32Array, 9 per segment: x0 y0 z0 t0 x1 y1 z1 t1 E
//    segCls .... Uint8Array: index into CLS; segTrk: track index
//    tracks .... [{ id, parent, name, E0, v0, u0, gen, born, end, fate, anc, dep }]
//                anc: the index of the nearest registered ancestor (-1: none);
//                dep: MeV deposited per subsystem by the track and every
//                unregistered descendant (a photon owns its shower)
//    segTrk .... the track index of a segment, or of its registered ancestor
//    segOwn .... 1 when the segment is of that track itself, 0 for a descendant
//    hits ...... silicon hits: Float32Array 6 each (x y z t e layer) + track
//    mhits ..... muon chamber hits, same layout
//    ecal, ecalT, hcalA, hcalS, hcalT  cell energies (MeV) and first times
//    sys ....... deposits per subsystem; L the ledger; cones; vtx; stats
// ============================================================================
import { MAT, ME } from './materials.js';
import { PART, C_MM_NS } from './particles.js';
import * as PH from './physics.js';
import { buildDetector, buildBlock, locate, nextBoundary, inside, field, uniformBz, cellIndex, ECAL, HCAL } from './geometry.js';

export const CLS = ['mu', 'e', 'gamma', 'had', 'neu', 'nu', 'shower'];
const CLS_I = Object.fromEntries(CLS.map((c, i) => [c, i]));
const HCAL_S = { sys: 'hcalS' }, HCAL_A = { sys: 'hcal' };
const KAPPA = 0.299792458;       // MeV per (T mm)
const HEAVY_OF = { 'mu-': 'mu', 'mu+': 'mu', 'pi+': 'pi', 'pi-': 'pi', 'K+': 'K', 'K-': 'K', p: 'p' };

// seeded generator (mulberry32)
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── small vector helpers ──────────────────────────────────────────────────
function rotate(u, th, ph) {           // turn the unit vector u by polar th, azimuth ph
  const [ux, uy, uz] = u, st = Math.sin(th), ct = Math.cos(th), cp = Math.cos(ph), sp = Math.sin(ph);
  let ax, ay, az;                        // a vector normal to u
  if (Math.abs(uz) < 0.9) { const n = Math.hypot(ux, uy); ax = -uy / n; ay = ux / n; az = 0; }
  else { const n = Math.hypot(uy, uz); ax = 0; ay = -uz / n; az = uy / n; }
  const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
  const x = ux * ct + st * (cp * ax + sp * bx), y = uy * ct + st * (cp * ay + sp * by), z = uz * ct + st * (cp * az + sp * bz);
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}
function isotropic(rng) { const c = 2 * rng() - 1, s = Math.sqrt(1 - c * c), f = 2 * Math.PI * rng(); return [s * Math.cos(f), s * Math.sin(f), c]; }
// boost a rest-frame four-vector [E, px, py, pz] by velocity b = [bx, by, bz]
export function boost(p, b) {
  const b2 = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
  if (b2 < 1e-20) return p.slice();
  const g = 1 / Math.sqrt(1 - b2), bp = b[0] * p[1] + b[1] * p[2] + b[2] * p[3], k = (g - 1) * bp / b2 + g * p[0];
  return [g * (p[0] + bp), p[1] + k * b[0], p[2] + k * b[1], p[3] + k * b[2]];
}
// two-body decay of mass M into m1, m2 in the rest frame (direction dir)
export function twoBody(M, m1, m2, dir) {
  const p = Math.sqrt(Math.max(0, (M * M - (m1 + m2) ** 2) * (M * M - (m1 - m2) ** 2))) / (2 * M);
  const E1 = (M * M + m1 * m1 - m2 * m2) / (2 * M), E2 = M - E1;
  return [[E1, p * dir[0], p * dir[1], p * dir[2]], [E2, -p * dir[0], -p * dir[1], -p * dir[2]]];
}

// ── the engine ────────────────────────────────────────────────────────────
// o: { rangeCut (mm, 0.7), eFloor (MeV), gKill, gKillCalo, eKill,
//      maxSeg, segMinE, stepBudget, chordTrk, chord }
export function createEngine(o = {}) {
  const D = o.block ? buildBlock(o.block.mat, o.block.len, o.block.world) : buildDetector();
  const opt = Object.assign({ rangeCut: 1.0, eFloor: 0.05, gKill: 0.02, gKillCalo: 0.5, eKill: 0.05, eKillCalo: 0.5, eKillGas: 3, segMinE: 1.0, segShowerMinE: 6, maxSeg: 400000, stepBudget: 6e6, chordTrk: 0.25, chord: 1.0, finalRange: 1.0, fastBelow: 60, fastTags: ['pu', 'ue'] }, o);
  const TB = new Map();
  const tablesFor = m => {
    let t = TB.get(m.key);
    if (!t) {
      const ec = m.vac ? 1e9 : Math.max(opt.eFloor, PH.rangeCut(m, opt.rangeCut));
      t = PH.buildTables(m, { e: ec, g: ec });
      TB.set(m.key, t);
    }
    return t;
  };
  // the HCAL sampling fraction for a minimum-ionising particle: the energy
  // scale of the scintillator planes (grep -n 'sfHB')
  const sfOf = (abs, absT, act, actT) => {
    const a = PH.bbHeavy(MAT[act], 105.66, 1, 300) * actT, b = PH.bbHeavy(MAT[abs], 105.66, 1, 300) * absT;
    return a / (a + b);
  };
  const sfHB = sfOf('brass', 60, 'scint', 4), sfHE = sfOf('brass', 84, 'scint', 4);

  function run(prims, seed = 1, ro = {}) {
    const rng = makeRng(seed);
    const R = newResult(opt);
    const stack = [];
    let nextId = 0, steps = 0, emFlag = false, curEm = false, fastFlag = false, curAnc = -1, curTr = null;
    const prof = ro.profile ? new Float64Array(ro.profile.n) : null;
    const L = R.L;
    const t0 = Date.now();
    const Bv = [0, 0, 0];

    const push = (name, x, y, z, t, u, T, parent, gen, born) => {
      const P = PART[name];
      if (!P || P.cls === 'res') return;
      const tr = { id: nextId++, em: emFlag || name === 'pi0', fast: fastFlag, name, P, x, y, z, t, ux: u[0], uy: u[1], uz: u[2], T: Math.max(0, T), parent, gen, born, nIL: -Math.log(rng() || 1e-12), tau: P.tau > 0 ? -P.tau * Math.log(rng() || 1e-12) : Infinity, E0: T + P.m, idx: -1, anc: curAnc, lastHit: -1, lastVol: null };
      stack.push(tr);
      return tr;
    };
    // a child with a four-vector [E, px, py, pz] (lab)
    const pushP4 = (name, p4, at, parent, gen, born) => {
      const P = PART[name], pm = Math.hypot(p4[1], p4[2], p4[3]);
      const u = pm > 0 ? [p4[1] / pm, p4[2] / pm, p4[3] / pm] : isotropic(rng);
      if (P.cls === 'nu') { L.inv += p4[0]; R.nu.push([p4[1], p4[2], p4[3], p4[0]]); return; }
      push(name, at[0], at[1], at[2], at[3], u, p4[0] - P.m, parent, gen, born);
    };

    for (const q of prims) {
      const P = PART[q.name];
      const pm = Math.hypot(q.px, q.py, q.pz), E = Math.sqrt(pm * pm + P.m * P.m);
      L.in += E;
      if (P.cls === 'nu') { L.inv += E; R.nu.push([q.px, q.py, q.pz, E]); continue; }
      const tr = push(q.name, q.x || 0, q.y || 0, q.z || 0, q.t || 0, [q.px / pm, q.py / pm, q.pz / pm], E - P.m, -1, 0, 'ip');
      if (tr) { tr.primary = q.tag || true; tr.fast = opt.fastTags.includes(q.tag); }
    }

    // ── recording ──────────────────────────────────────────────────────────
    const segAdd = (tr, x0, y0, z0, ta, x1, y1, z1, tb, E) => {
      if (R.nSeg >= opt.maxSeg || E < (tr.cls === 6 ? opt.segShowerMinE : opt.segMinE)) return;
      // pile-up: as an event display shows it, only primary tracks over
      // 0.7 GeV (in the tracker) and muons
      if (tr.fast && (tr.cls === 0 ? tr.E0 < 2000 : (tr.gen > 0 || tr.E0 < 700 || x1 * x1 + y1 * y1 > 1.44e6))) return;
      const k = R.nSeg * 9, S = R.seg;
      S[k] = x0; S[k + 1] = y0; S[k + 2] = z0; S[k + 3] = ta; S[k + 4] = x1; S[k + 5] = y1; S[k + 6] = z1; S[k + 7] = tb; S[k + 8] = E;
      R.segCls[R.nSeg] = tr.cls; R.segTrk[R.nSeg] = tr.idx >= 0 ? tr.idx : tr.anc; R.segOwn[R.nSeg] = tr.idx >= 0 ? 1 : 0; R.nSeg++;
    };
    const trackIndex = tr => {
      if (tr.idx >= 0) return tr.idx;
      tr.idx = R.tracks.length;
      R.tracks.push({ id: tr.id, parent: tr.parent, name: tr.name, E0: tr.E0, v0: [tr.x0, tr.y0, tr.z0, tr.t0], u0: [tr.ux0, tr.uy0, tr.uz0], gen: tr.gen, born: tr.born, primary: tr.primary || false, end: null, fate: '', anc: tr.anc, dep: {} });
      if (tr === curTr) curAnc = tr.idx;
      return tr.idx;
    };
    const deposit = (v, x, y, z, t, e) => {
      if (e <= 0) return;
      L.dep += e;
      // the deposit counts for the track and each registered ancestor
      for (let a = curAnc, k = v ? v.sys : 'air', n = 0; a >= 0 && n < 40; a = R.tracks[a].anc, n++) { const dd = R.tracks[a].dep; dd[k] = (dd[k] || 0) + e; }
      if (curEm) R.depEm += e;
      if (prof) { const b = Math.floor(z / ro.profile.dz); if (b >= 0 && b < prof.length) prof[b] += e; }
      const s = v ? v.sys : 'air';
      R.sys[s] = (R.sys[s] || 0) + e;
      if (s === 'ecal') { const c = cellIndex(ECAL, x, y, z); if (c >= 0) { R.ecal[c] += e; if (t < R.ecalT[c]) R.ecalT[c] = t; } }
      else if (s === 'hcal' || s === 'hcalS') {
        const c = cellIndex(HCAL, x, y, z);
        if (c >= 0) {
          if (s === 'hcalS') { const sf = Math.abs(z) >= 3300 ? sfHE : sfHB; R.hcalS[c] += e / sf; if (t < R.hcalT[c]) R.hcalT[c] = t; }
          else R.hcalA[c] += e;
        }
      }
    };
    const hit = (tr, v, x, y, z, t, e) => {
      const isMu = v.sys === 'mu', H = isMu ? R.mhits : R.hits;
      if (tr.lastVol === v && tr.lastHit >= 0 && tr.lastHitMu === isMu) { H.e[tr.lastHit] += e; return; }
      const k = H.n;
      if (k >= H.cap) return;
      H.f[k * 6] = x; H.f[k * 6 + 1] = y; H.f[k * 6 + 2] = z; H.f[k * 6 + 3] = t; H.f[k * 6 + 4] = e; H.f[k * 6 + 5] = v.layer;
      H.e[k] = e; H.trk[k] = trackIndex(tr); H.vol[k] = v.id; H.n++;
      tr.lastHit = k; tr.lastHitMu = isMu;
    };

    // ── the discrete processes ────────────────────────────────────────────
    const at4 = tr => [tr.x, tr.y, tr.z, tr.t];
    function decay(tr, v) {
      const P = tr.P, M = P.m, E = tr.T + M, pm = Math.sqrt(Math.max(0, tr.T * (tr.T + 2 * M)));
      const b = [pm / E * tr.ux, pm / E * tr.uy, pm / E * tr.uz], at = at4(tr), g = tr.gen + 1;
      R.vtx.push([tr.x, tr.y, tr.z, tr.t, 1]);
      const sgn = P.q, two = (n1, n2) => {
        const [a, c] = twoBody(M, PART[n1].m, PART[n2].m, isotropic(rng));
        pushP4(n1, boost(a, b), at, tr.id, g, v ? v.sys : 'air'); pushP4(n2, boost(c, b), at, tr.id, g, v ? v.sys : 'air');
      };
      switch (tr.name) {
        case 'pi+': two('mu+', 'nu'); break;
        case 'pi-': two('mu-', 'nu'); break;
        case 'K+': case 'K-': if (rng() < 0.636) two(sgn > 0 ? 'mu+' : 'mu-', 'nu'); else two(sgn > 0 ? 'pi+' : 'pi-', 'pi0'); break;
        case 'K0S': if (rng() < 0.692) two('pi+', 'pi-'); else two('pi0', 'pi0'); break;
        case 'K0L': if (rng() < 0.5) two('pi+', 'pi-'); else two('pi0', 'pi0'); break;
        case 'pi0': two('gamma', 'gamma'); break;
        case 'mu-': case 'mu+': {
          // Michel spectrum x^2 (3 - 2x), the two neutrinos as one system
          const W = (M * M + ME * ME) / (2 * M);
          let x; do { x = rng(); } while (rng() > x * x * (3 - 2 * x));
          const Ee = Math.max(ME, x * W), pe = Math.sqrt(Ee * Ee - ME * ME), d = isotropic(rng);
          const e4 = [Ee, pe * d[0], pe * d[1], pe * d[2]], n4 = [M - Ee, -e4[1], -e4[2], -e4[3]];
          pushP4(sgn < 0 ? 'e-' : 'e+', boost(e4, b), at, tr.id, g, v ? v.sys : 'air');
          const nl = boost(n4, b); L.inv += nl[0]; R.nu.push([nl[1], nl[2], nl[3], nl[0]]);
          break;
        }
        case 'B': decayB(M, b, at, tr.id, g, v); break;
        default: deposit(v, tr.x, tr.y, tr.z, tr.t, E);
      }
    }
    // B hadron: sequential two-body splits into pions and kaons (or a
    // lepton, a neutrino and hadrons); exact energy, rough phase space
    function decayB(M, b, at, pid, g, v) {
      const names = [];
      if (rng() < 0.21) { names.push(rng() < 0.5 ? (rng() < 0.5 ? 'e-' : 'e+') : (rng() < 0.5 ? 'mu-' : 'mu+'), 'nu'); }
      const nh = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < nh; i++) { const r = rng(); names.push(r < 0.15 ? (rng() < 0.5 ? 'K+' : 'K-') : r < 0.45 ? 'pi0' : rng() < 0.5 ? 'pi+' : 'pi-'); }
      let Mrest = M, frame = b, rest = names.slice();
      while (rest.length > 1) {
        const n1 = rest.shift(), m1 = PART[n1].m, mmin = rest.reduce((s, n) => s + PART[n].m, 0);
        const m2 = rest.length === 1 ? PART[rest[0]].m : mmin + (Mrest - m1 - mmin) * Math.pow(rng(), 0.7) * 0.95;
        const [a, c] = twoBody(Mrest, m1, m2, isotropic(rng));
        pushP4(n1, boost(a, frame), at, pid, g, 'b');
        const cl = boost(c, frame);
        if (rest.length === 1) { pushP4(rest[0], cl, at, pid, g, 'b'); break; }
        const pc = Math.hypot(cl[1], cl[2], cl[3]);
        frame = [cl[1] / cl[0], cl[2] / cl[0], cl[3] / cl[0]]; Mrest = m2;
        if (pc > cl[0]) break;
      }
    }
    function hadronic(tr, v) {
      const P = tr.P, nuc = tr.name === 'p' || tr.name === 'n', M = P.m;
      const avail = nuc ? tr.T : tr.T + M;
      let bud = avail;
      const g = tr.gen + 1, sys = v.sys, u = [tr.ux, tr.uy, tr.uz];
      R.vtx.push([tr.x, tr.y, tr.z, tr.t, 2]);
      // nuclear binding of the nucleons set free: about 8 MeV each
      const nfree = 2 + 3 * Math.log(1 + avail / 100) * rng();
      const inv = Math.min(bud * 0.4, 8 * nfree); L.inv += inv; bud -= inv;
      const emit = (name, Etot, iso) => {      // a product of total energy Etot
        const m = PART[name].m, p = Math.sqrt(Math.max(0, Etot * Etot - m * m));
        let d;
        if (iso) d = isotropic(rng);
        else {
          let pT = -300 * Math.log(rng() * rng() || 1e-12) / 2;
          if (pT > 0.8 * p) pT = 0.8 * p * rng();
          d = rotate(u, Math.asin(p > 0 ? pT / p : 0), 2 * Math.PI * rng());
        }
        push(name, tr.x, tr.y, tr.z, tr.t, d, Etot - m, tr.id, g, sys);
      };
      // cascade and evaporation nucleons, borrowed from the nucleus: most of
      // a low-energy collision, about 15 % of a high-energy one
      const fN = 0.10 + 0.6 * Math.exp(-avail / 1500);
      let bN = bud * fN; bud -= bN;
      const nN = Math.max(1, Math.min(10, Math.round(bN / 80 * (0.5 + rng()))));
      for (let i = 0; i < nN && bN > 0; i++) {
        const T = i === nN - 1 ? bN : Math.min(bN, bN * -Math.log(rng() || 1e-9) / nN);
        bN -= T;
        if (T < 5) { deposit(v, tr.x, tr.y, tr.z, tr.t, T); continue; }
        const name = rng() < 0.55 ? 'n' : 'p';
        L.borrow += PART[name].m;
        emit(name, T + PART[name].m, T < 200);
      }
      // leading particle (pi: charge exchange to pi0 in 15 % of collisions)
      const xl = 0.2 + 0.4 * rng();
      if (nuc) {
        const T = bud * xl; bud -= T;
        const name = rng() < 0.7 ? tr.name : (tr.name === 'p' ? 'n' : 'p');
        if (name !== tr.name) { L.borrow += PART[name].m; L.ret += M; }
        emit(name, T + PART[name].m);
      } else if (bud * xl > M) {
        const E = bud * xl; bud -= E;
        const name = tr.name === 'pi+' || tr.name === 'pi-' ? (rng() < 0.85 ? tr.name : 'pi0') : tr.name;
        emit(name, E);
      }
      // new mesons: pion production needs about 300 MeV
      if (bud < 300) { deposit(v, tr.x, tr.y, tr.z, tr.t, bud); return; }
      const nm = Math.max(1, Math.round((1.2 + 1.8 * Math.log(1 + bud / 1000)) * (0.7 + 0.6 * rng())));
      const w = []; let ws = 0;
      for (let i = 0; i < nm; i++) { const x = -Math.log(rng() || 1e-12); w.push(x); ws += x; }
      for (let i = 0; i < nm; i++) {
        const E = bud * w[i] / ws, r = rng();
        const name = r < 0.08 ? (rng() < 0.5 ? 'K+' : 'K-') : r < 0.39 ? 'pi0' : r < 0.70 ? 'pi+' : 'pi-';
        if (E > PART[name].m * 1.02) emit(name, E);
        else deposit(v, tr.x, tr.y, tr.z, tr.t, E);
      }
    }
    // Fast EM shower: the energy goes into spots along the direction, with
    // depth t (in X0) from a Gamma law of maximum ln(E/Ec) - 0.5 (e) or
    // + 0.5 (gamma), b = 0.5, and a lateral offset of a fraction of the
    // Moliere radius. In the HCAL the scintillator share of a spot is the
    // EM sampling fraction (0.8 of the mip fraction).
    function fastEM(tr, v) {
      const mm = v.sys === 'hcalS' ? v.parent.mat : v.mat, E = tr.T + (tr.name === 'e+' ? 2 * ME : 0);
      if (tr.name === 'e-') L.ret += ME;
      if (tr.name === 'e+') L.borrow += ME;
      const tmax = Math.max(0.2, Math.log(Math.max(1.01, E / mm.Ec)) + (tr.name === 'gamma' ? 0.5 : -0.5)), b = 0.5, a = 1 + b * tmax;
      const K = Math.max(3, Math.min(24, Math.round(E / 20))), u = [tr.ux, tr.uy, tr.uz];
      // for the display: a few spots become short rays that fork off the
      // shower axis, so a cascade reads as a branching tree of light
      const nRay = tr.fast || E < 8 ? 0 : Math.min(K, 2 + Math.round(E / 25)), ray = { cls: CLS_I.shower, fast: false, idx: -1, anc: tr.idx >= 0 ? tr.idx : tr.anc };
      for (let i = 0; i < K; i++) {
        const t = PH.gammaVar(rng, a) / b, r = mm.RM * 0.5 * -Math.log(rng() || 1e-9) * (0.3 + 0.7 * Math.min(1, t / tmax));
        const side = rotate(u, Math.PI / 2, 2 * Math.PI * rng()), d = t * mm.X0;
        const x = tr.x + u[0] * d + side[0] * r, y = tr.y + u[1] * d + side[1] * r, z = tr.z + u[2] * d + side[2] * r, tt = tr.t + d / C_MM_NS;
        let w = locate(D, x, y, z), e = E / K, X = x, Y = y, Zz = z;
        // a spot past the back of the calorimeter leaks on into the next dense volume
        for (let k = 0; k < 60 && w && w.mat.rho < 0.01; k++) { X += u[0] * 20; Y += u[1] * 20; Zz += u[2] * 20; w = locate(D, X, Y, Zz); }
        if (!w) { L.esc += e; continue; }
        if (w.sys === 'hcal' || w.sys === 'hcalS') {
          const sf = (Math.abs(Zz) >= 3300 ? sfHE : sfHB) * 0.8;
          deposit(HCAL_S, X, Y, Zz, tt, e * sf); deposit(HCAL_A, X, Y, Zz, tt, e * (1 - sf));
        } else deposit(w, X, Y, Zz, tt, e);
        if (i < nRay) { const d0 = d * (0.25 + 0.4 * rng()); segAdd(ray, tr.x + u[0] * d0, tr.y + u[1] * d0, tr.z + u[2] * d0, tr.t + d0 / C_MM_NS, X, Y, Zz, tt, E); }
      }
    }
    // a particle at rest
    function atRest(tr, v) {
      const m = tr.P.m;
      switch (tr.name) {
        case 'e-': case 'p': case 'n': L.ret += m; break;
        case 'e+': {
          L.borrow += ME;
          const d = isotropic(rng), g = tr.gen + 1, sys = v ? v.sys : 'air';
          push('gamma', tr.x, tr.y, tr.z, tr.t, d, ME, tr.id, g, sys);
          push('gamma', tr.x, tr.y, tr.z, tr.t, [-d[0], -d[1], -d[2]], ME, tr.id, g, sys);
          break;
        }
        case 'pi-': deposit(v, tr.x, tr.y, tr.z, tr.t, 0.3 * m); L.inv += 0.7 * m; break;
        case 'K0L': deposit(v, tr.x, tr.y, tr.z, tr.t, 0.5 * m); L.inv += 0.5 * m; break;
        default: if (tr.P.tau > 0) decay(tr, v); else deposit(v, tr.x, tr.y, tr.z, tr.t, m);
      }
    }

    // ── propagation ───────────────────────────────────────────────────────
    // move along a helix in uniform Bz; returns nothing, updates tr
    const helix = (tr, s, h) => {
      const c = Math.cos(h * s), sn = Math.sin(h * s), ux = tr.ux, uy = tr.uy;
      tr.x += (ux * sn + uy * (1 - c)) / h; tr.y += (uy * sn - ux * (1 - c)) / h; tr.z += tr.uz * s;
      tr.ux = ux * c + uy * sn; tr.uy = -ux * sn + uy * c;
    };
    const rk = (tr, s, qk) => {         // RK4, dU/ds = qk U x B
      const n = Math.max(1, Math.ceil(s / 40)), hh = s / n;
      for (let i = 0; i < n; i++) {
        const f = (x, y, z, ux, uy, uz) => { field(D, x, y, z, Bv); return [ux, uy, uz, qk * (uy * Bv[2] - uz * Bv[1]), qk * (uz * Bv[0] - ux * Bv[2]), qk * (ux * Bv[1] - uy * Bv[0])]; };
        const y0 = [tr.x, tr.y, tr.z, tr.ux, tr.uy, tr.uz];
        const k1 = f(...y0), y1 = y0.map((v, j) => v + hh / 2 * k1[j]);
        const k2 = f(...y1), y2 = y0.map((v, j) => v + hh / 2 * k2[j]);
        const k3 = f(...y2), y3 = y0.map((v, j) => v + hh * k3[j]);
        const k4 = f(...y3), yn = y0.map((v, j) => v + hh / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
        const nn = Math.hypot(yn[3], yn[4], yn[5]);
        tr.x = yn[0]; tr.y = yn[1]; tr.z = yn[2]; tr.ux = yn[3] / nn; tr.uy = yn[4] / nn; tr.uz = yn[5] / nn;
      }
    };
    const save = tr => [tr.x, tr.y, tr.z, tr.ux, tr.uy, tr.uz];
    const load = (tr, a) => { tr.x = a[0]; tr.y = a[1]; tr.z = a[2]; tr.ux = a[3]; tr.uy = a[4]; tr.uz = a[5]; };
    // move a charged track by s; mode: 0 straight, 1 helix (h), 2 RK (qk)
    const move = (tr, s, mode, h, qk) => {
      if (mode === 1) helix(tr, s, h);
      else if (mode === 2) rk(tr, s, qk);
      else { tr.x += tr.ux * s; tr.y += tr.uy * s; tr.z += tr.uz * s; }
    };
    const stillIn = (v, x, y, z) => { if (!inside(v, x, y, z)) return false; for (const k of v.kids) if (inside(k, x, y, z)) return false; return true; };

    // one track, from its start to its end
    function transport(tr) {
      emFlag = curEm = tr.em; fastFlag = tr.fast; curTr = tr; curAnc = tr.anc;
      tr.cls = tr.P.cls === 'gamma' || tr.P.cls === 'e' ? ((tr.born === 'ecal' || tr.born === 'hcal' || tr.born === 'hcalS') ? CLS_I.shower : CLS_I[tr.P.cls]) : CLS_I[tr.P.cls] ?? CLS_I.had;
      tr.x0 = tr.x; tr.y0 = tr.y; tr.z0 = tr.z; tr.t0 = tr.t; tr.ux0 = tr.ux; tr.uy0 = tr.uy; tr.uz0 = tr.uz;
      if (tr.primary || tr.E0 > 2000 || (tr.gen <= 1 && tr.E0 > 200)) trackIndex(tr);
      curAnc = tr.idx >= 0 ? tr.idx : tr.anc;
      let v = locate(D, tr.x, tr.y, tr.z), n = 0, fate = '';
      const P = tr.P, M = P.m, q = P.q;
      const hk = HEAVY_OF[tr.name], ek = tr.name === 'e-' || tr.name === 'e+' ? tr.name : null;
      while (true) {
        if (!v) { L.esc += tr.T + M; fate = 'escaped'; R.escBy[tr.name] = (R.escBy[tr.name] || 0) + tr.T + M; break; }
        if (++n > 30000 || steps > opt.stepBudget) { deposit(v, tr.x, tr.y, tr.z, tr.t, tr.T); L.ret += M; R.stats.truncated++; fate = 'cut'; break; }
        steps++;
        const m = v.mat, TT = m.vac ? null : tablesFor(m), calo = v.sys === 'ecal' || v.sys === 'hcal' || v.sys === 'hcalS';
        const E = tr.T + M, pm = Math.sqrt(Math.max(0, tr.T * (tr.T + 2 * M))), beta = M > 0 ? pm / E : 1;
        // ── kill thresholds ──
        if (P.cls === 'gamma' && tr.name === 'gamma' && tr.T < (calo ? opt.gKillCalo : opt.gKill)) { deposit(v, tr.x, tr.y, tr.z, tr.t, tr.T); fate = 'absorbed'; break; }
        if (P.cls === 'nu') { L.inv += E; break; }
        // e+- kill: in a calorimeter, and in gas or vacuum, where a soft
        // electron curls in the field for metres and adds no signal
        if (q !== 0 && tr.T < (ek ? (calo ? opt.eKillCalo : m.rho < 0.01 ? opt.eKillGas : opt.eKill) : 1.0)) { deposit(v, tr.x, tr.y, tr.z, tr.t, tr.T); tr.T = 0; atRest(tr, v); fate = 'stopped'; break; }
        // looper killer: a soft charged track that curls on in the tracker
        if (q !== 0 && tr.path > (ek ? 3000 : tr.fast ? 5000 : 15000) && tr.T < 300) { deposit(v, tr.x, tr.y, tr.z, tr.t, tr.T); tr.T = 0; atRest(tr, v); fate = 'looper'; break; }
        if ((tr.name === 'n' || tr.name === 'K0L') && tr.T < 50) { deposit(v, tr.x, tr.y, tr.z, tr.t, 0.3 * tr.T); L.inv += 0.7 * tr.T; tr.T = 0; atRest(tr, v); fate = 'absorbed'; break; }
        // fast electromagnetic shower (GFlash-like spots) for soft e, gamma
        // and for every e, gamma of a pile-up or underlying-event particle
        if (calo && (tr.name === 'gamma' || ek) && (tr.fast || tr.T < opt.fastBelow)) { fastEM(tr, v); fate = 'fast shower'; break; }
        // ── limits ──
        let sigma = 0, sD = 0, sB = 0, sH = 0, sC = 0, sP = 0, sF = 0, range = Infinity, dedx = 0;
        if (TT) {
          if (tr.name === 'gamma') { sC = TT.gamma.compt.at(tr.T); sP = TT.gamma.pair.at(tr.T); sF = TT.gamma.phot.at(tr.T); sigma = sC + sP + sF; }
          else if (ek) { const t = TT[ek]; sD = t.xsD.at(tr.T); sB = t.xsB.at(tr.T); sigma = sD + sB; range = t.range.at(tr.T); dedx = t.dedx.at(tr.T); }
          else if (hk) { const t = TT.heavy[hk]; sD = t.lamD.at(tr.T); range = t.range.at(tr.T); dedx = t.dedx.at(tr.T); sigma = sD; }
          if (P.cls === 'had' || P.cls === 'neu') {
            if (tr.T > 50 && tr.name !== 'B' && tr.name !== 'K0S') {
              const k = tr.name === 'p' || tr.name === 'n' ? 1 : (1.30 - 0.0018 * m.zEff) * (tr.name[0] === 'K' ? 1.05 : 1);
              sH = 1 / (m.lamI * k);
              sigma += sH;
            }
          }
        }
        const sInt = sigma > 0 ? tr.nIL / sigma : Infinity;
        const bg = M > 0 ? pm / M : Infinity;
        const sDec = tr.tau < Infinity ? tr.tau * bg * C_MM_NS : Infinity;
        let sLoss = Infinity;
        if (q !== 0 && range < Infinity) sLoss = range > opt.finalRange ? Math.max(opt.finalRange, 0.2 * range) : range;
        const sGeo = nextBoundary(v, tr.x, tr.y, tr.z, tr.ux, tr.uy, tr.uz);
        // range-out: an electron or a positron that cannot leave this volume
        // and will not interact first deposits its energy here
        if (ek && range < 5 && range < sGeo && range < sInt) {
          const s = range * 0.7, x1 = tr.x + tr.ux * s, y1 = tr.y + tr.uy * s, z1 = tr.z + tr.uz * s, t1 = tr.t + s / (C_MM_NS * Math.max(0.3, beta));
          segAdd(tr, tr.x, tr.y, tr.z, tr.t, x1, y1, z1, t1, E);
          deposit(v, x1, y1, z1, t1, tr.T);
          if (v.mat.n > 0 && beta * v.mat.n > 1) R.cher[v.sys] = (R.cher[v.sys] || 0) + 49.2 * (1 - 1 / (beta * beta * v.mat.n * v.mat.n)) * s * 0.5;
          if (v.mat.scint) R.scint[v.sys] = (R.scint[v.sys] || 0) + v.mat.scint * tr.T;
          tr.x = x1; tr.y = y1; tr.z = z1; tr.t = t1; tr.T = 0; atRest(tr, v); fate = 'stopped'; break;
        }
        // field
        let mode = 0, h = 0, qk = 0, sChord = Infinity;
        if (q !== 0) {
          const bz = uniformBz(D, tr.x, tr.y, tr.z);
          const dl = v.parent && v.parent.name === 'Tracker volume' || v.name === 'Tracker volume' ? opt.chordTrk : opt.chord;
          if (bz === 0) mode = 0;
          else if (!Number.isNaN(bz)) { mode = 1; h = q * KAPPA * bz / pm; const Rc = Math.abs(1 / h); sChord = Math.min(400, Math.sqrt(8 * Rc * dl)); }
          else { field(D, tr.x, tr.y, tr.z, Bv); const bm = Math.hypot(Bv[0], Bv[1], Bv[2]); mode = 2; qk = q * KAPPA / pm; sChord = Math.min(200, bm > 0 ? Math.sqrt(8 * pm / (KAPPA * bm) * dl) : 200); }
        }
        let s = Math.min(sInt, sDec, sLoss, sGeo, sChord, 2000);
        let lim = s === sGeo ? 'geo' : s === sInt ? 'int' : s === sDec ? 'dec' : 'loss';
        s = Math.max(s, 1e-4);
        // ── move ──
        const a = save(tr), x0 = tr.x, y0 = tr.y, z0 = tr.z, tA = tr.t;
        move(tr, s, mode, h, qk);
        let vNew = v;
        if (lim === 'geo') {
          vNew = locate(D, tr.x + tr.ux * 1e-4, tr.y + tr.uy * 1e-4, tr.z + tr.uz * 1e-4);
          if (mode !== 0 && vNew === v) lim = 'none';
          if (vNew === v && mode === 0) { tr.x += tr.ux * 1e-4; tr.y += tr.uy * 1e-4; tr.z += tr.uz * 1e-4; }
        }
        if (mode !== 0 && lim !== 'geo' && !stillIn(v, tr.x, tr.y, tr.z)) {
          // the curved path left the volume: bisect to the crossing
          let lo = 0, hi = s;
          for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; load(tr, a); move(tr, mid, mode, h, qk); if (stillIn(v, tr.x, tr.y, tr.z)) lo = mid; else hi = mid; }
          load(tr, a); move(tr, hi, mode, h, qk); s = hi; lim = 'geo';
          vNew = locate(D, tr.x, tr.y, tr.z);
        } else if (lim === 'geo' && mode !== 0) {
          tr.x += tr.ux * 1e-4; tr.y += tr.uy * 1e-4; tr.z += tr.uz * 1e-4;
        }
        tr.t = tA + s / (C_MM_NS * Math.max(1e-3, beta));
        tr.path = (tr.path || 0) + s;
        // ── along the step ──
        if (q !== 0 && TT && dedx > 0) {
          let mean;
          if (s >= range) mean = tr.T;
          else if (s < 0.01 * range) mean = dedx * s;
          else mean = tr.T - PH.invRange(ek ? TT[ek].range : TT.heavy[hk].range, range - s);
          const Tup = ek ? Math.min(TT.cuts.e, tr.T / 2) : Math.min(TT.cuts.e, PH.wmax(M, tr.T));
          let dE = Math.min(tr.T, PH.sampleLoss(rng, m, mean, s, beta * beta, Tup, q));
          if (s >= range) dE = tr.T;
          const xm = (x0 + tr.x) / 2, ym = (y0 + tr.y) / 2, zm = (z0 + tr.z) / 2, tm = (tA + tr.t) / 2;
          deposit(v, xm, ym, zm, tm, dE);
          if (v.active && (v.sys === 'pix' || v.sys === 'sct' || v.sys === 'mu')) hit(tr, v, xm, ym, zm, tm, dE);
          if (m.scint) R.scint[v.sys] = (R.scint[v.sys] || 0) + m.scint * dE / (1 + m.birks * dE / s);
          if (m.n > 0 && beta * m.n > 1) {
            const s2 = 1 - 1 / (beta * beta * m.n * m.n), nph = 49.2 * s2 * s;
            R.cher[v.sys] = (R.cher[v.sys] || 0) + nph;
            if (tr.idx >= 0 && !tr.fast && E > 300 && R.cones.length < 600 && (v.sys === 'ecal' || v.sys === 'hcalS') && tr.lastCone !== v) {
              tr.lastCone = v;
              R.cones.push([x0, y0, z0, tA, tr.ux, tr.uy, tr.uz, Math.acos(1 / (beta * m.n)), Math.min(s, 60), tr.cls, nph]);
            }
          }
          segAdd(tr, x0, y0, z0, tA, tr.x, tr.y, tr.z, tr.t, E);
          tr.T -= dE;
          // multiple scattering and its lateral shift
          if (tr.T > 0) {
            const p2 = Math.sqrt(tr.T * (tr.T + 2 * M)), bt = p2 / (tr.T + M);
            const th0 = PH.highland(Math.sqrt(pm * p2), Math.sqrt(beta * bt), s, m.X0, q);
            if (th0 > 0) {
              const [tx, ty] = PH.sampleMsc(rng, th0), th = Math.hypot(tx, ty), ph = Math.atan2(ty, tx);
              const old = [tr.ux, tr.uy, tr.uz], nu = rotate(old, Math.min(th, Math.PI), ph);
              if (lim !== 'geo' && s > 0.05) {
                const lat = s * (th0 * PH.gauss(rng) / Math.sqrt(12) + th / 2), side = rotate(old, Math.PI / 2, ph);
                const nx = tr.x + side[0] * lat, ny = tr.y + side[1] * lat, nz = tr.z + side[2] * lat;
                if (stillIn(v, nx, ny, nz)) { tr.x = nx; tr.y = ny; tr.z = nz; }
              }
              tr.ux = nu[0]; tr.uy = nu[1]; tr.uz = nu[2];
            }
          }
        } else {
          segAdd(tr, x0, y0, z0, tA, tr.x, tr.y, tr.z, tr.t, E);
          if (v.active && v.sys === 'mu' && q !== 0) hit(tr, v, (x0 + tr.x) / 2, (y0 + tr.y) / 2, (z0 + tr.z) / 2, (tA + tr.t) / 2, 0);
        }
        tr.nIL -= s * sigma;
        if (tr.tau < Infinity) tr.tau -= s / (bg * C_MM_NS);
        if (q !== 0 && tr.T <= 0) { tr.T = 0; atRest(tr, v); fate = 'stopped'; break; }
        // ── post step ──
        if (lim === 'geo') { v = vNew; tr.lastVol = null; continue; }
        tr.lastVol = v;
        if (lim === 'dec') { decay(tr, v); fate = 'decayed'; break; }
        if (lim === 'int') {
          tr.nIL = -Math.log(rng() || 1e-12);
          let r = rng() * sigma;
          const g = tr.gen + 1, sys = v.sys;
          if (tr.name === 'gamma') {
            if ((r -= sC) < 0) {
              const [eps, ct] = PH.sampleCompton(rng, tr.T), Eg = tr.T, ph = 2 * Math.PI * rng();
              const d0 = [tr.ux, tr.uy, tr.uz], dg = rotate(d0, Math.acos(Math.max(-1, Math.min(1, ct))), ph);
              const Te = Eg * (1 - eps), pe = [Eg * d0[0] - eps * Eg * dg[0], Eg * d0[1] - eps * Eg * dg[1], Eg * d0[2] - eps * Eg * dg[2]], pn = Math.hypot(...pe);
              L.borrow += ME;
              push('e-', tr.x, tr.y, tr.z, tr.t, pn > 0 ? pe.map(c => c / pn) : d0, Te, tr.id, g, sys);
              tr.T = eps * Eg; tr.ux = dg[0]; tr.uy = dg[1]; tr.uz = dg[2];
              continue;
            }
            if ((r -= sP) < 0) {
              R.vtx.push([tr.x, tr.y, tr.z, tr.t, 3]);
              const Eg = tr.T, eps = PH.samplePairEps(rng, Eg), Em = eps * Eg, Ep = Eg - Em, ph = 2 * Math.PI * rng(), d0 = [tr.ux, tr.uy, tr.uz];
              push('e-', tr.x, tr.y, tr.z, tr.t, rotate(d0, Math.min(Math.PI, PH.sampleAngleU(rng) * ME / Em), ph), Em - ME, tr.id, g, sys);
              push('e+', tr.x, tr.y, tr.z, tr.t, rotate(d0, Math.min(Math.PI, PH.sampleAngleU(rng) * ME / Ep), ph + Math.PI), Ep - ME, tr.id, g, sys);
              fate = 'converted'; break;
            }
            // photoelectric: the K-shell binding (13.6 eV Z^2) goes into the material
            const K = 13.6e-6 * m.zmax * m.zmax * 0.85, Eb = tr.T > K ? K : 0;
            deposit(v, tr.x, tr.y, tr.z, tr.t, Eb);
            L.borrow += ME;
            push('e-', tr.x, tr.y, tr.z, tr.t, [tr.ux, tr.uy, tr.uz], tr.T - Eb, tr.id, g, sys);
            fate = 'absorbed'; break;
          }
          if ((r -= sD) < 0) {
            // the cross section came from the step start: below threshold now, no interaction
            if (ek === 'e-' ? tr.T <= 2 * TT.cuts.e : ek ? tr.T <= TT.cuts.e : PH.wmax(M, tr.T) <= TT.cuts.e) continue;
            const Td = ek ? (ek === 'e-' ? PH.sampleMoller(rng, tr.T, TT.cuts.e) : PH.sampleBhabha(rng, tr.T, TT.cuts.e)) : PH.sampleDeltaHeavy(rng, M, tr.T, TT.cuts.e);
            const pd = Math.sqrt(Td * (Td + 2 * ME)), ct = Math.min(1, Td * (E + ME) / (pm * pd));
            const ph = 2 * Math.PI * rng(), d0 = [tr.ux, tr.uy, tr.uz], dd = rotate(d0, Math.acos(ct), ph);
            L.borrow += ME;
            push('e-', tr.x, tr.y, tr.z, tr.t, dd, Td, tr.id, g, sys);
            const pn = [pm * d0[0] - pd * dd[0], pm * d0[1] - pd * dd[1], pm * d0[2] - pd * dd[2]], nn = Math.hypot(...pn);
            tr.T -= Td; if (nn > 0) { tr.ux = pn[0] / nn; tr.uy = pn[1] / nn; tr.uz = pn[2] / nn; }
            continue;
          }
          if ((r -= sB) < 0) {
            if (tr.T <= TT.cuts.g) continue;
            const k = PH.sampleBremK(rng, tr.T, TT.cuts.g);
            push('gamma', tr.x, tr.y, tr.z, tr.t, rotate([tr.ux, tr.uy, tr.uz], Math.min(Math.PI, PH.sampleAngleU(rng) * ME / E), 2 * Math.PI * rng()), k, tr.id, g, sys);
            tr.T -= k;
            continue;
          }
          if (sH > 0) { hadronic(tr, v); fate = 'interacted'; break; }
        }
      }
      if (tr.idx >= 0) { const T = R.tracks[tr.idx]; T.end = [tr.x, tr.y, tr.z, tr.t]; T.uEnd = [tr.ux, tr.uy, tr.uz]; T.Tend = tr.T; T.fate = fate; }
    }

    while (stack.length) transport(stack.pop());
    R.profile = prof;
    R.stats.steps = steps; R.stats.ms = Date.now() - t0; R.stats.tracksAll = nextId;
    return R;
  }
  return { D, opt, run, tablesFor, sfHB, sfHE };
}

export function newResult(opt) {
  const cap = 60000;
  const H = () => ({ n: 0, cap, f: new Float32Array(cap * 6), e: new Float32Array(cap), trk: new Int32Array(cap), vol: new Int32Array(cap) });
  return {
    nSeg: 0, seg: new Float32Array(opt.maxSeg * 9), segCls: new Uint8Array(opt.maxSeg), segTrk: new Int32Array(opt.maxSeg), segOwn: new Uint8Array(opt.maxSeg),
    tracks: [], hits: H(), mhits: H(), nu: [], vtx: [], cones: [],
    ecal: new Float32Array(ECAL.neta * ECAL.nphi), ecalT: new Float32Array(ECAL.neta * ECAL.nphi).fill(1e9),
    hcalA: new Float32Array(HCAL.neta * HCAL.nphi), hcalS: new Float32Array(HCAL.neta * HCAL.nphi), hcalT: new Float32Array(HCAL.neta * HCAL.nphi).fill(1e9),
    sys: {}, cher: {}, scint: {}, escBy: {}, depEm: 0, profile: null, L: { in: 0, borrow: 0, dep: 0, esc: 0, inv: 0, ret: 0 }, stats: { steps: 0, ms: 0, truncated: 0 },
  };
}

// ── packing and merging (grep -n 'export function pack' / 'mergeResults') ─
// pack() trims the typed arrays to their used length, so a worker can
// transfer them. mergeResults() joins the results of several workers: the
// segment and hit track indices move by the track count before them.
export function pack(R) {
  const H = h => ({ n: h.n, f: h.f.slice(0, h.n * 6), e: h.e.slice(0, h.n), trk: h.trk.slice(0, h.n), vol: h.vol.slice(0, h.n) });
  return { ...R, seg: R.seg.slice(0, R.nSeg * 9), segCls: R.segCls.slice(0, R.nSeg), segTrk: R.segTrk.slice(0, R.nSeg), segOwn: R.segOwn.slice(0, R.nSeg), hits: H(R.hits), mhits: H(R.mhits) };
}
export function transfers(P) {
  return [P.seg.buffer, P.segCls.buffer, P.segTrk.buffer, P.segOwn.buffer, P.hits.f.buffer, P.hits.e.buffer, P.hits.trk.buffer, P.hits.vol.buffer, P.mhits.f.buffer, P.mhits.e.buffer, P.mhits.trk.buffer, P.mhits.vol.buffer, P.ecal.buffer, P.ecalT.buffer, P.hcalA.buffer, P.hcalS.buffer, P.hcalT.buffer];
}
export function mergeResults(list) {
  const cat = (C, arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0), o = new C(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
  const off = []; let t = 0; for (const r of list) { off.push(t); t += r.tracks.length; }
  const shift = (arrs) => arrs.map((a, i) => a.map(v => v < 0 ? v : v + off[i]));
  const H = key => ({ n: list.reduce((s, r) => s + r[key].n, 0), f: cat(Float32Array, list.map(r => r[key].f)), e: cat(Float32Array, list.map(r => r[key].e)), trk: cat(Int32Array, shift(list.map(r => r[key].trk))), vol: cat(Int32Array, list.map(r => r[key].vol)) });
  const sum = (key) => { const o = new Float32Array(list[0][key].length); for (const r of list) for (let i = 0; i < o.length; i++) o[i] += r[key][i]; return o; };
  const mn = (key) => { const o = new Float32Array(list[0][key].length).fill(1e9); for (const r of list) for (let i = 0; i < o.length; i++) if (r[key][i] < o[i]) o[i] = r[key][i]; return o; };
  const add = key => { const o = {}; for (const r of list) for (const [k, v] of Object.entries(r[key])) o[k] = (o[k] || 0) + v; return o; };
  const tracks = []; list.forEach((r, i) => { for (const q of r.tracks) tracks.push({ ...q, anc: q.anc >= 0 ? q.anc + off[i] : -1, w: i }); });
  return {
    nSeg: list.reduce((s, r) => s + r.nSeg, 0), seg: cat(Float32Array, list.map(r => r.seg)), segCls: cat(Uint8Array, list.map(r => r.segCls)), segTrk: cat(Int32Array, shift(list.map(r => r.segTrk))), segOwn: cat(Uint8Array, list.map(r => r.segOwn)),
    tracks, hits: H('hits'), mhits: H('mhits'), nu: list.flatMap(r => r.nu), vtx: list.flatMap(r => r.vtx), cones: list.flatMap(r => r.cones),
    ecal: sum('ecal'), ecalT: mn('ecalT'), hcalA: sum('hcalA'), hcalS: sum('hcalS'), hcalT: mn('hcalT'),
    sys: add('sys'), cher: add('cher'), scint: add('scint'), escBy: add('escBy'), L: add('L'), depEm: list.reduce((s, r) => s + r.depEm, 0),
    stats: { steps: list.reduce((s, r) => s + r.stats.steps, 0), ms: Math.max(...list.map(r => r.stats.ms)), truncated: list.reduce((s, r) => s + r.stats.truncated, 0), tracksAll: list.reduce((s, r) => s + (r.stats.tracksAll || 0), 0), workers: list.length },
  };
}
// split primaries into n shares of near-equal energy (largest first)
export function splitPrims(prims, n) {
  const out = Array.from({ length: n }, () => []), load = new Float64Array(n);
  const E = q => Math.hypot(q.px, q.py, q.pz);
  for (const q of prims.slice().sort((a, b) => E(b) - E(a))) { let k = 0; for (let i = 1; i < n; i++) if (load[i] < load[k]) k = i; out[k].push(q); load[k] += E(q); }
  return out.filter(a => a.length);
}
