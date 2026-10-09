// ============================================================================
//  NEURON LAB ENGINE  ·  morph.js  ·  procedural cell shapes
// ----------------------------------------------------------------------------
//  Our own generated morphologies, not reconstructions. Each one follows the
//  plan of a real cell type (branch pattern, lengths and diameters of the
//  right order) from a seed, so the page can label them "procedural". No
//  NeuroMorpho.org or ModelDB file is used or shipped.
//
//  A morphology is a list of sections in tree order (parent before child):
//    { name, kind, parent, x, L, d0, d1, pts }
//  kind: soma | dend | apical | tuft | axon | ais.  x: the join point on the
//  parent (0..1). L and d in um. pts: the 3D polyline in um, from the join
//  point to the far end (y is up).
//
//  makeCell(type, seed, mo) takes optional shape factors (random.js makes
//  them). Each factor is neutral at its default, and then the shape is the
//  same as with no mo, number for number:
//    soma (x size), branches (x count), depth (+ levels), angle (x spread),
//    taper (x ratio), length (x dendrite length), tortuosity (x wiggle),
//    spines (per um on dendrites: cell.js adds their area), axon (x length),
//    collaterals (count).
//
//  grep -n targets
//    "export const CELLS"       the four cell types and their notes
//    "export const MORPH0"      the neutral shape factors
//    "export function makeCell" seed + type (+ factors) -> sections
//    "function tree"            the shared branching walker
// ============================================================================
import { rng, gauss } from './rng.js';

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

export const CELLS = [
  { id: 'pyramidal', name: 'Layer 5 pyramidal cell', short: 'Pyramidal', note: 'A long apical trunk to a tuft near the surface, short basal dendrites round the soma, an axon down to the white matter.' },
  { id: 'purkinje', name: 'Cerebellar Purkinje cell', short: 'Purkinje', note: 'One thick primary dendrite that splits into a flat fan, like an espalier tree. The fan lies in one plane.' },
  { id: 'motor', name: 'Spinal motor neuron', short: 'Motor neuron', note: 'A large soma with many thick dendrites in all directions and a wide axon that leaves for a muscle.' },
  { id: 'granule', name: 'Cerebellar granule cell', short: 'Granule', note: 'The smallest cell here: four short dendrites with claws, and a thin axon that rises and splits in a T into a parallel fiber.' },
];

// The neutral shape factors. collaterals: null keeps the type default.
export const MORPH0 = { soma: 1, branches: 1, depth: 0, angle: 1, taper: 1, length: 1, tortuosity: 1, spines: 0, axon: 1, collaterals: null };

// Add one section with a gently bent polyline. Returns the section index.
function sec(S, R, o) {
  const pts = [o.p0]; let p = o.p0, dir = V.norm(o.dir);
  const k = Math.max(2, Math.ceil(o.L / 18));
  for (let i = 0; i < k; i++) {
    dir = V.norm(V.add(dir, V.mul([gauss(R), gauss(R), o.flat ? 0 : gauss(R)], o.wiggle ?? 0.12)));
    if (o.pull) dir = V.norm(V.add(dir, V.mul(o.pull, 0.08)));
    p = V.add(p, V.mul(dir, o.L / k)); pts.push(p);
  }
  S.push({ name: o.name, kind: o.kind, parent: o.parent, x: o.x ?? 1, L: o.L, d0: o.d0, d1: o.d1 ?? o.d0, pts });
  return { i: S.length - 1, end: p, dir };
}

// Grow a branching tree from a parent section end.
function tree(S, R, o, depth, p0, dir, d, parent, name, x0 = 1) {
  const L = o.len(depth) * (0.75 + 0.5 * R());
  const d1 = Math.max(o.dmin, d * o.taper);
  const s = sec(S, R, { name, kind: o.kind, parent, x: x0, L, d0: d, d1, p0, dir, flat: o.flat, wiggle: o.wiggle, pull: o.pull });
  if (depth >= o.depth || (depth >= o.minDepth && R() < o.stop)) return;
  const nb = o.branches ? o.branches(depth, R) : 2;
  for (let b = 0; b < nb; b++) {
    const spread = o.spread * (0.6 + 0.8 * R());
    let side;
    if (o.flat) side = [-s.dir[1], s.dir[0], 0];
    else { side = V.norm([gauss(R), gauss(R), gauss(R)]); const dd = side[0] * s.dir[0] + side[1] * s.dir[1] + side[2] * s.dir[2]; side = V.norm(V.add(side, V.mul(s.dir, -dd))); }
    const sgn = nb === 2 ? (b ? 1 : -1) : (b - (nb - 1) / 2);
    const nd = V.norm(V.add(s.dir, V.mul(side, spread * sgn)));
    tree(S, R, o, depth + 1, s.end, nd, d1 * 0.8, s.i, name + '_' + b);
  }
}

export function makeCell(type = 'pyramidal', seed = 1, mo = null) {
  const R = rng(seed * 7919 + type.length * 131), S = [];
  const M = { ...MORPH0, ...(mo || {}) };
  const sz = M.soma, nb = (k, lo = 1) => Math.max(lo, Math.round(k * M.branches));
  // tree options with the factors applied
  const T = o => {
    const depth = Math.max(1, o.depth + M.depth);
    return { ...o, len: dp => o.len(dp) * M.length, spread: o.spread * M.angle, taper: Math.min(0.97, Math.max(0.4, o.taper * M.taper)),
      wiggle: o.wiggle * M.tortuosity, depth, minDepth: Math.min(o.minDepth, depth) };
  };
  const wg = w => w * M.tortuosity;
  if (type === 'pyramidal') {
    S.push({ name: 'soma', kind: 'soma', parent: -1, x: 0.5, L: 20 * sz, d0: 20 * sz, pts: [[0, -10 * sz, 0], [0, 10 * sz, 0]] });
    // apical trunk in three pieces with obliques
    let p = [0, 10 * sz, 0], par = 0, x = 1, d = 4.2;
    for (let k = 0; k < 3; k++) {
      const t = sec(S, R, { name: 'apic' + k, kind: 'apical', parent: par, x, L: 170 * M.length, d0: d, d1: d * 0.78, p0: p, dir: [0, 1, 0], wiggle: wg(0.05), pull: [0, 1, 0] });
      const tp = S[t.i].pts, nq = nb(3);
      for (let q = 0; q < nq; q++) {
        const ang = R() * Math.PI * 2, j = Math.min(tp.length - 1, 1 + Math.round(q * 9 / Math.max(3, nq)));
        tree(S, R, T({ kind: 'dend', len: dp => 120 / (1 + dp * 0.4), depth: 2, minDepth: 1, stop: 0.25, spread: 0.7, taper: 0.7, dmin: 0.5, wiggle: 0.16 }),
          0, tp[j], V.norm([Math.cos(ang), 0.45 + 0.2 * k, Math.sin(ang)]), 1.5, t.i, 'obl' + k + q, j / (tp.length - 1));
      }
      p = t.end; par = t.i; x = 1; d *= 0.78;
    }
    tree(S, R, T({ kind: 'tuft', len: dp => 130 / (1 + dp * 0.3), depth: 4, minDepth: 3, stop: 0.25, spread: 0.85, taper: 0.75, dmin: 0.4, wiggle: 0.14, pull: [0, 0.6, 0] }), 0, p, [0, 1, 0], 2.2, par, 'tuft');
    // basal dendrites
    const nbas = nb(7, 2);
    for (let b = 0; b < nbas; b++) {
      const ang = b / nbas * Math.PI * 2 + R() * 0.5, dir = V.norm([Math.cos(ang), -0.3 - R() * 0.4, Math.sin(ang)]);
      tree(S, R, T({ kind: 'dend', len: dp => 85 / (1 + dp * 0.25), depth: 3, minDepth: 2, stop: 0.25, spread: 0.6, taper: 0.7, dmin: 0.5, wiggle: 0.18, pull: [0, -0.3, 0] }), 0, V.mul(dir, 10 * sz), dir, 1.6, 0, 'basal' + b, 0.5);
    }
    axon(S, R, [0, -10 * sz, 0], [0, -1, 0], 1.6, 1.0, 420 * M.axon, 0.5, M.collaterals ?? 2);
  } else if (type === 'purkinje') {
    S.push({ name: 'soma', kind: 'soma', parent: -1, x: 0.5, L: 25 * sz, d0: 25 * sz, pts: [[0, -12 * sz, 0], [0, 12 * sz, 0]] });
    const t = sec(S, R, { name: 'primary', kind: 'apical', parent: 0, x: 1, L: 40 * M.length, d0: 6, d1: 5, p0: [0, 12 * sz, 0], dir: [0, 1, 0], wiggle: wg(0.05), flat: true });
    const nf = nb(2);
    for (let b = 0; b < nf; b++) {
      const sx = nf === 2 ? (b ? 0.6 : -0.6) : nf === 1 ? 0 : -0.6 + 1.2 * b / (nf - 1);
      tree(S, R, T({ kind: 'dend', flat: true, len: dp => 60 / (1 + dp * 0.22), depth: 6, minDepth: 4, stop: 0.18, spread: 0.55, taper: 0.8, dmin: 0.8, wiggle: 0.12, pull: [0, 0.9, 0] }),
        0, t.end, V.norm([sx, 1, 0]), 4, t.i, 'fan' + b);
    }
    for (const s of S) if (s.kind === 'dend') s.pts = s.pts.map(q => [q[0], q[1], q[2] * 0.1 + (R() - 0.5) * 2]);
    axon(S, R, [0, -12 * sz, 0], [0, -1, 0], 1.2, 0.9, 380 * M.axon, 0.6, M.collaterals ?? 2);
  } else if (type === 'motor') {
    S.push({ name: 'soma', kind: 'soma', parent: -1, x: 0.5, L: 45 * sz, d0: 45 * sz, pts: [[0, -22 * sz, 0], [0, 22 * sz, 0]] });
    const nd = nb(9, 3);
    for (let b = 0; b < nd; b++) {
      const z = -0.8 + 1.6 * (b + 0.5) / nd, a = b * 2.4, r = Math.sqrt(1 - z * z), dir = [r * Math.cos(a), z, r * Math.sin(a)];
      tree(S, R, T({ kind: 'dend', len: dp => 150 / (1 + dp * 0.3), depth: 3, minDepth: 2, stop: 0.3, spread: 0.6, taper: 0.62, dmin: 0.8, wiggle: 0.12 }), 0, V.mul(dir, 22 * sz), dir, 6.5, 0, 'dend' + b, 0.5);
    }
    axon(S, R, [0, -22 * sz, 0], [0.3, -1, 0.1], 4, 3, 700 * M.axon, 0, M.collaterals ?? 0);
  } else {
    S.push({ name: 'soma', kind: 'soma', parent: -1, x: 0.5, L: 6 * sz, d0: 6 * sz, pts: [[0, -3 * sz, 0], [0, 3 * sz, 0]] });
    const ng = nb(4, 2);
    for (let b = 0; b < ng; b++) {
      const a = b * Math.PI * 2 / ng + R() * 0.6, dir = V.norm([Math.cos(a), -0.3 + R() * 0.3, Math.sin(a)]);
      const dd = sec(S, R, { name: 'dend' + b, kind: 'dend', parent: 0, x: 0.5, L: (14 + R() * 8) * M.length, d0: 0.9, d1: 0.7, p0: V.mul(dir, 3 * sz), dir, wiggle: wg(0.15) });
      for (let c = 0; c < 3; c++) {
        const cd = V.norm(V.add(dd.dir, [gauss(R) * 0.9 * M.angle, gauss(R) * 0.9 * M.angle, gauss(R) * 0.9 * M.angle]));
        sec(S, R, { name: 'claw' + b + c, kind: 'dend', parent: dd.i, x: 1, L: (3 + R() * 2) * M.length, d0: 0.5, p0: dd.end, dir: cd, wiggle: wg(0.4) });
      }
    }
    const asc = sec(S, R, { name: 'ascending', kind: 'axon', parent: 0, x: 1, L: 160 * M.axon, d0: 0.3, p0: [0, 3 * sz, 0], dir: [0, 1, 0], wiggle: 0.04, pull: [0, 1, 0] });
    sec(S, R, { name: 'pf_a', kind: 'axon', parent: asc.i, x: 1, L: 280 * M.axon, d0: 0.2, p0: asc.end, dir: [1, 0.02, 0], wiggle: 0.02, pull: [1, 0, 0] });
    sec(S, R, { name: 'pf_b', kind: 'axon', parent: asc.i, x: 1, L: 280 * M.axon, d0: 0.2, p0: asc.end, dir: [-1, 0.02, 0], wiggle: 0.02, pull: [-1, 0, 0] });
  }
  if (M.spines > 0) for (const s of S) if (s.kind === 'dend' || s.kind === 'apical' || s.kind === 'tuft') s.spines = M.spines;
  return S;
}

// ncoll collaterals leave the main axon; cy is their upward tilt.
function axon(S, R, p0, dir, dAis, d, L, cy, ncoll) {
  const ais = sec(S, R, { name: 'ais', kind: 'ais', parent: 0, x: 0, L: 30, d0: dAis, d1: d, p0, dir, wiggle: 0.03 });
  const ax = sec(S, R, { name: 'axon', kind: 'axon', parent: ais.i, x: 1, L, d0: d, p0: ais.end, dir, wiggle: 0.05, pull: V.norm(dir) });
  for (let c = 0; c < ncoll; c++) {
    const a = R() * Math.PI * 2, xj = ncoll === 2 ? 0.35 + c * 0.25 : 0.2 + 0.65 * (c + 0.5) / ncoll;
    sec(S, R, { name: 'coll' + c, kind: 'axon', parent: ax.i, x: xj, L: 160, d0: d * 0.6, p0: S[ax.i].pts[Math.round((S[ax.i].pts.length - 1) * xj)], dir: V.norm([Math.cos(a), cy, Math.sin(a)]), wiggle: 0.15 });
  }
}

// Bounding box of a morphology: { c, R } in um.
export function bounds(S) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const s of S) for (const p of s.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return { lo, hi, c, R: 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
}
