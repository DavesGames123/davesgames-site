// ============================================================================
//  PLANETARY GEARBOX  ·  layout.js — every part's size, place and explode
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE. layout(variant, Zs, Zp, N) returns the numbers that
//  scene.js builds from and tests.mjs checks:
//    L.sets[j] ... gears.js makeSet() plus radii, widths and the set's z
//    L.g ......... shaft radii, plate thickness, z stations
//    L.parts ..... one entry per part:
//        id, info (the card), kind (scene.js builder), mat
//        pose ...... { m: member } | { m, ring: j } | { planet: [j, i] } | {}
//        env ....... collision envelopes in the assembled place: annuli
//                    { c: [x, y], ri, ro, z0, z1 } (c = [0, 0] is coaxial)
//        ex ........ explode: { dz, dr, win: [e0, e1] } — the part moves dz
//                    along the axis (planets dr outward) while the explode
//                    value runs from e0 to e1
//        slide ..... ids of parts it may pass through along the axis only
//                    (a pin in its plate hole)
//  Units are millimetres. The gear axis is z; the input is at −z.
//
//  EXPLODE ORDER. Parts leave in an order that keeps them clear of each
//  other: the output side first, then the pins out of the planets, then the
//  ring off the planets, and the planets move out last. tests.mjs samples
//  the explode from 0 to 1 and fails on any envelope overlap.
//
//  GREP MAP
//    export const VARIANTS ..... the two gear sets
//    function setDims .......... radii of one set
//    function simple ........... the single set
//    function simpson .......... the two-set Simpson gear train
//    export function layout .... entry point
// ============================================================================
import { makeSet, TAU } from './gears.js';

export const VARIANTS = [
  { id: 'simple', name: 'Simple set', kind: 'Sun · planets · carrier · ring',
    blurb: 'One epicyclic set. Hold one member, drive another and take the power off the third: the same gears give a reduction, an overdrive or a reverse.' },
  { id: 'simpson', name: 'Simpson set', kind: 'Two sets, one sun · 3 speeds + R',
    blurb: 'Two sets on one long sun gear, the front carrier fixed to the rear ring. Two bands and two clutches select three forward speeds and a reverse — the gear train of many classic automatic gearboxes.' },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function setDims(S, b) {
  const m = S.m;
  S.b = b;
  S.rsT = S.rs + m; S.rsR = S.rs - 1.25 * m;
  S.rpT = S.rp + m; S.rpR = S.rp - 1.25 * m;
  S.rrT = S.rr - m; S.rrR = S.rr + 1.25 * m;
  S.rrO = S.rrR + Math.max(2.4 * m, 6);
  S.pr = clamp(0.34 * S.rp, 2.5, S.rpR - 2 * m);       // planet pin
  S.bore = S.pr + 0.25;
  S.bo = clamp(S.pr + 4, S.pr + 2, S.rp - 1.6 * m);   // carrier boss round each pin
  S.reach = S.a + S.bo;                                // carrier plate radius (< ring tip)
  return S;
}
// a gear zone for the envelope: half a millimetre inside the pitch circle,
// so two gears in mesh touch but do not overlap
const PITCH_IN = 0.6;
const ann = (ri, ro, z0, z1, c = [0, 0]) => ({ c, ri, ro, z0, z1 });

function planets(L, j, S, z0, z1, info, ex) {
  for (let i = 0; i < S.N; i++) {
    const c = [S.a * Math.cos(S.psi[i]), S.a * Math.sin(S.psi[i])];
    L.parts.push({ id: `p${j}_${i}`, info, kind: 'planet', set: j, i, mat: 'planet', label: i === 0 ? 'Planet' : null,
      pose: { planet: [j, i] }, env: [ann(S.bore, S.rp - PITCH_IN, z0, z1, c)], ex });
  }
}
const pinEnv = (S, z0, z1) => S.psi.map(p => ann(0, S.pr, z0, z1, [S.a * Math.cos(p), S.a * Math.sin(p)]));

// ── the single set ───────────────────────────────────────────────────────────
function simple(Zs, Zp, N) {
  const m = 2.5, b = 22, t = 6, g = 1;
  const S = setDims(makeSet(Zs, Zp, N, m, 0), b);
  S.z = 0;
  const sh = clamp(0.36 * S.rsR, 5, 9);               // shaft radius
  const zp0 = b / 2 + g, zp1 = zp0 + t;                // plate z (front); back is mirrored
  const Lin = b / 2 + 7.8 * b, Lout = 4.6 * b;
  const L = { id: 'simple', m, sets: [S], parts: [], g: { b, t, sh, zp0, zp1, Lin, Lout, flangeR: Math.max(2.6 * sh, 15) } };
  const P = L.parts, G = L.g;
  P.push({ id: 'sun', info: 'sun', kind: 'sun', mat: 'sun', label: 'Sun', pose: { m: 'S' },
    env: [ann(0, S.rs - PITCH_IN, -b / 2, b / 2), ann(0, sh, -Lin, -b / 2), ann(0, G.flangeR, -Lin, -Lin + 8)],
    ex: { dz: 0, win: [0, 1] } });
  P.push({ id: 'ring', info: 'ring', kind: 'ring', set: 0, mat: 'ring', label: 'Ring', pose: { m: 'R', ring: 0 },
    env: [ann(S.rr + PITCH_IN, S.rrO, -b / 2, b / 2)], ex: { dz: -6.2 * b, win: [0.08, 0.5] } });
  planets(L, 0, S, -b / 2 + 0.5, b / 2 - 0.5, 'planet', { dz: 0, dr: 1.2 * S.rp + 10, win: [0.5, 1] });
  P.push({ id: 'pins', info: 'pins', kind: 'pins', set: 0, mat: 'pin', pose: { m: 'C' },
    env: pinEnv(S, -zp1, zp1), ex: { dz: 3.2 * b, win: [0.03, 0.5] }, slide: ['carrierF', 'carrierB'] });
  P.push({ id: 'carrierB', info: 'carrier', kind: 'plateBack', set: 0, mat: 'carrier', pose: { m: 'C' },
    env: [ann(sh + 1.5, S.reach, -zp1, -zp0)], ex: { dz: -3.2 * b, win: [0.12, 0.55] } });
  P.push({ id: 'carrierF', info: 'carrier', kind: 'plateFront', set: 0, mat: 'carrier', label: 'Carrier', pose: { m: 'C' },
    env: [ann(0, S.reach, zp0, zp1), ann(0, sh + 1, zp1, zp1 + Lout), ann(0, G.flangeR, zp1 + Lout - 8, zp1 + Lout)],
    ex: { dz: 5.4 * b, win: [0, 0.45] } });
  return L;
}

// ── the Simpson gear train ───────────────────────────────────────────────────
// Front set (z < 0): ring R1 is the input, carrier C1 the output.
// Rear set (z > 0): ring R2 is bolted to C1 by the output drum; carrier C2
// has the low/reverse drum. One long sun runs through both, with its drum at
// the rear end. Bands B1 (sun) and B2 (C2) are fixed to the case.
function simpson(Zs, Zp, N) {
  const m = 2, b = 18, t = 5, g = 1, Gap = 16;
  const F = setDims(makeSet(Zs, Zp, N, m, 0), b), R = setDims(makeSet(Zs, Zp, N, m, Math.PI / N), b);
  F.z = -(Gap + b / 2); R.z = Gap + b / 2;
  const sh = clamp(0.36 * F.rsR, 4.5, 8);
  const zS0 = -(Gap + b), zS1 = Gap + b;             // the long sun
  const tw = 5, zWeb1 = zS0 - g - t - 2, zWeb0 = zWeb1 - tw;
  const Lin = 46;
  const rD0 = F.rrO + 2, rD1 = rD0 + 4, tf = 4;        // output drum shell and flange
  const mT = 2, ZT = Math.round(2 * (rD1 + 1.25 * mT) / mT), rT = mT * ZT / 2;
  const rC2 = R.rrO, Ld = 24, zC2 = zS1 + g, zC2b = zC2 + t;   // C2 rear plate and drum
  const rSD = Math.max(sh + 14, 0.55 * rC2), zSD = zC2b + Ld + 8, Lsd = 20;
  const zEnd = zSD + t + Lsd + 2;
  const L = { id: 'simpson', m, sets: [F, R], parts: [],
    g: { b, t, sh, Gap, zS0, zS1, zWeb0, zWeb1, Lin, rD0, rD1, tf, mT, ZT, rT, rC2, Ld, zC2, zC2b, rSD, zSD, Lsd, zEnd, flangeR: 16 } };
  const P = L.parts;
  // centre
  P.push({ id: 'sun', info: 'sun2', kind: 'longSun', mat: 'sun', label: 'Sun (shared)', pose: { m: 'S' },
    env: [ann(0, F.rs - PITCH_IN, zS0, zS1), ann(0, sh, zS1, zEnd)], ex: { dz: 0, win: [0, 1] } });
  P.push({ id: 'outDrum', info: 'outDrum', kind: 'outDrum', mat: 'drum', label: 'Output drum', pose: { m: 'C1' },
    env: [ann(F.rsT + 2, rD1, -Gap + g, -Gap + g + t), ann(rD0, rD1, -Gap + g + t, Gap - tf), ann(R.rrT - 0.2 * m, rD1, Gap - tf, Gap),
      ann(rD1, rT + mT, -7, 7)],
    ex: { dz: 0, win: [0, 1] } });
  // front: input web, ring R1, carrier C1 front plate with its pins, planets
  P.push({ id: 'inWeb', info: 'input', kind: 'inWeb', mat: 'ring', label: 'Input', pose: { m: 'R1' },
    env: [ann(F.rrO - 5, F.rrO, zWeb1, zS0), ann(0, F.rrO, zWeb0, zWeb1), ann(0, sh + 1, zWeb0 - Lin, zWeb0), ann(0, 16, zWeb0 - Lin, zWeb0 - Lin + 8)],
    ex: { dz: -150, win: [0, 0.4] } });
  P.push({ id: 'ring1', info: 'ring1', kind: 'ring', set: 0, mat: 'ring', label: 'Front ring', pose: { m: 'R1', ring: 0 },
    env: [ann(F.rr + PITCH_IN, F.rrO, zS0, -Gap)], ex: { dz: -105, win: [0.04, 0.44] } });
  P.push({ id: 'c1Front', info: 'carrier1', kind: 'c1Front', set: 0, mat: 'carrier', label: 'Front carrier', pose: { m: 'C1' },
    env: [ann(0, F.reach, zS0 - g - t, zS0 - g), ...pinEnv(F, zS0 - g - t, -Gap + g + t)],
    ex: { dz: -75, win: [0.08, 0.48] }, slide: ['outDrum'] });
  planets(L, 0, F, zS0 + 0.5, -Gap - 0.5, 'planetF', { dz: 0, dr: 1.1 * F.rp + 8, win: [0.5, 1] });
  // rear: ring R2, carrier C2 (front plate; rear plate with pins and drum), planets
  P.push({ id: 'ring2', info: 'ring2', kind: 'ring', set: 1, mat: 'ring', label: 'Rear ring', pose: { m: 'C1', ring: 1 },
    env: [ann(R.rr + PITCH_IN, R.rrO, Gap, zS1)], ex: { dz: 80, win: [0.45, 0.8] } });
  P.push({ id: 'c2Front', info: 'carrier2', kind: 'c2Front', set: 1, mat: 'carrier', pose: { m: 'C2' },
    env: [ann(R.rsT + 2, R.reach, Gap - g - t, Gap - g)], ex: { dz: -6, win: [0.6, 0.9] } });
  P.push({ id: 'c2Drum', info: 'carrier2', kind: 'c2Drum', set: 1, mat: 'carrier', label: 'Rear carrier', pose: { m: 'C2' },
    env: [ann(sh + 1.5, rC2, zC2, zC2b), ann(rC2 - 4, rC2, zC2b, zC2b + Ld), ...pinEnv(R, Gap - g - t, zC2)],
    ex: { dz: 110, win: [0.3, 0.7] }, slide: ['c2Front'] });
  planets(L, 1, R, Gap + 0.5, zS1 - 0.5, 'planetR', { dz: 0, dr: 1.1 * R.rp + 8, win: [0.72, 1] });
  P.push({ id: 'sunDrum', info: 'sunDrum', kind: 'sunDrum', mat: 'drum', pose: { m: 'S' },
    env: [ann(sh, rSD, zSD, zSD + t), ann(rSD - 4, rSD, zSD + t, zSD + t + Lsd)], ex: { dz: 150, win: [0, 0.35] } });
  // bands (fixed to the case: they do not turn)
  P.push({ id: 'band1', info: 'band1', kind: 'band', mat: 'band', label: 'Intermediate band', pose: {}, r: rSD + 1, z0: zSD + t + 2, z1: zSD + t + Lsd - 2,
    env: [ann(rSD + 1, rSD + 12, zSD + t + 2, zSD + t + Lsd - 2)], ex: { dz: 175, win: [0, 0.35] } });
  P.push({ id: 'band2', info: 'band2', kind: 'band', mat: 'band', label: 'Low/reverse band', pose: {}, r: rC2 + 1, z0: zC2b + 2, z1: zC2b + Ld - 2,
    env: [ann(rC2 + 1, rC2 + 12, zC2b + 2, zC2b + Ld - 2)], ex: { dz: 140, win: [0, 0.4] } });
  return L;
}

export function layout(id, Zs, Zp, N) {
  const L = id === 'simpson' ? simpson(Zs, Zp, N) : simple(Zs, Zp, N);
  // assembled and exploded bounds about the axis: { z0, z1, R }
  const span = e => {
    let z0 = 1e9, z1 = -1e9, R = 0;
    for (const p of L.parts) {
      const k = explodeK(p, e), dz = p.ex.dz * k, dr = (p.ex.dr || 0) * k;
      for (const v of p.env) { z0 = Math.min(z0, v.z0 + dz); z1 = Math.max(z1, v.z1 + dz); R = Math.max(R, Math.hypot(v.c[0], v.c[1]) + (v.c[0] || v.c[1] ? dr : 0) + v.ro); }
    }
    return { z0, z1, R };
  };
  L.box0 = span(0); L.box1 = span(1);
  return L;
}

export const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
export const explodeK = (p, e) => ease((e - p.ex.win[0]) / (p.ex.win[1] - p.ex.win[0]));

// annulus overlap: the distances from one centre to the points of the other
// annulus form one interval; the two overlap when it meets [ri, ro]
export function envOverlap(A, B) {
  if (!(A.z0 < B.z1 - 1e-6 && B.z0 < A.z1 - 1e-6)) return false;
  const d = Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1]);
  const lo = d <= B.ri ? B.ri - d : d <= B.ro ? 0 : d - B.ro, hi = d + B.ro;
  return lo < A.ro - 1e-6 && hi > A.ri + 1e-6;
}
// a part's envelopes at explode value e (planets move out along their ray)
export function envAt(p, e) {
  const k = explodeK(p, e), dz = p.ex.dz * k, dr = (p.ex.dr || 0) * k;
  return p.env.map(v => {
    const r = Math.hypot(v.c[0], v.c[1]), u = r ? [v.c[0] / r, v.c[1] / r] : [0, 0];
    return { c: [v.c[0] + u[0] * dr, v.c[1] + u[1] * dr], ri: v.ri, ro: v.ro, z0: v.z0 + dz, z1: v.z1 + dz };
  });
}
export { TAU };
