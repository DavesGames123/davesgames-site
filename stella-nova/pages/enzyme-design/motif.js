// ============================================================================
//  MOTIF  ·  three idealised catalytic motifs, built from textbook geometry
// ----------------------------------------------------------------------------
//  A catalytic motif is a small group of side chains plus one ligand, held
//  in the arrangement that a reaction needs. The scaffolder (scaffold.js)
//  holds these atoms fixed and grows a protein around them. The metrics
//  (metrics.js) score how well a design keeps them.
//
//  WHERE THE GEOMETRY COMES FROM. Every atom here comes from standard bond
//  lengths, bond angles and torsion angles, which are textbook facts. The
//  module builds each group atom by atom from those numbers. The three
//  motifs are IDEALISED STAND-INS, inspired by the example campaigns of the
//  AlphaProtein Novo repository. They are not the coordinates of the paper
//  and not the structure files of the repository. No file was downloaded,
//  and no number was taken from the preprint.
//
//  Units are angstroms for lengths and degrees for angles. Coordinates are
//  rounded to 0.0001 A, so two build() calls give the same numbers.
//
//  The module has no DOM and no random numbers, so Node can import it and
//  build() is deterministic without a seed.
//
//  Motif = {
//    id, label,
//    residues: [ { code, name, chain, resId, atoms, tip } ],
//      atoms: [{ name, el, x, y, z }], tip: the atom names the chemistry needs
//    ligand: { name, atoms, bonds, coord },
//      bonds: [[i, j]] covalent bonds, 1.1 to 1.8 A
//      coord: [[i, j]] metal coordination bonds, about 2.0 A (an addition to
//             the contract; a viewer that does not know it draws nothing)
//    geometry: [ { label, kind, atoms, ideal, tol, why } ]
//      kind 'distance' takes two refs, kind 'angle' takes three
//      a ref is 'res0:OE2' or 'lig:N3'
//  }
//
//  EXPORTS   (grep -n "<anchor>" motif.js)
//    the three motifs ... "export const MOTIFS"
//    build one by id .... "export function motifById"
//    read one atom ...... "export function atomAt"
//    measure one entry .. "export function measure"
//    small vector maths . "export function dist"
//    ring closure ....... "function relax2D"
//    atom placement ..... "function nerf"
//    manifest tip atoms . "function tipsFromMotifAtoms"
//    kemp motif ......... "function buildKemp"
//    triad motif ........ "function buildTriad"
//    haem motif ......... "function buildHaem"
// ============================================================================

import { KEMP_MANIFEST } from './data.js';

const DEG = Math.PI / 180;

// ------------------------------------------------------------ vector maths
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const mid = (a, b) => mul(add(a, b), 0.5);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mag = (a) => Math.sqrt(dot(a, a));
const unit = (a) => { const L = mag(a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };

// Distance between two points, in angstroms.
export function dist(a, b) { return mag(sub(a, b)); }

// Angle a-b-c at b, in degrees.
export function angleDeg(a, b, c) {
  const u = unit(sub(a, b)), v = unit(sub(c, b));
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) / DEG;
}

// Torsion angle a-b-c-d, in degrees, with the usual sign convention.
export function torsionDeg(p0, p1, p2, p3) {
  const b0 = sub(p0, p1), b1 = unit(sub(p2, p1)), b2 = sub(p3, p2);
  const v = sub(b0, mul(b1, dot(b0, b1)));
  const w = sub(b2, mul(b1, dot(b2, b1)));
  return Math.atan2(dot(cross(b1, v), w), dot(v, w)) / DEG;
}

// Place atom d from three placed atoms a, b and c. bond is c-d, ang is the
// angle b-c-d and tor is the torsion a-b-c-d. This is the standard internal
// coordinate construction, and it is how every side chain here grows.
function nerf(a, b, c, bond, ang, tor) {
  const bc = unit(sub(c, b));
  let n = cross(sub(b, a), bc);
  if (mag(n) < 1e-7) n = cross([0.3717, 0.5571, 0.7428], bc); // a, b and c in a line
  n = unit(n);
  const m = cross(n, bc);
  const t = ang * DEG, f = tor * DEG;
  const d1 = -bond * Math.cos(t), d2 = bond * Math.sin(t) * Math.cos(f), d3 = bond * Math.sin(t) * Math.sin(f);
  return add(c, add(mul(bc, d1), add(mul(m, d2), mul(n, d3))));
}

// A right-handed frame at o, with x along xdir and z along zdir.
function frameOf(o, xdir, zdir) {
  const ez = unit(zdir);
  const ex = unit(sub(xdir, mul(ez, dot(xdir, ez))));
  return { o, ex, ey: cross(ez, ex), ez };
}

// Move a point from one frame to another. The shape does not change.
function remap(f0, f1, p) {
  const d = sub(p, f0.o);
  const l = [dot(d, f0.ex), dot(d, f0.ey), dot(d, f0.ez)];
  return add(f1.o, add(mul(f1.ex, l[0]), add(mul(f1.ey, l[1]), mul(f1.ez, l[2]))));
}

// ------------------------------------------------------------ ring closure
//  A flat ring is over-determined: five bonds and five angles cannot all be
//  exact at the same time. relax2D settles the best compromise in a plane.
//  Each constraint is a target distance. An angle becomes the distance
//  between the two outer atoms, through the law of cosines. The loop is a
//  fixed number of passes, so the result is deterministic.
function relax2D(start, cons, passes = 900) {
  const p = start.map((q) => [q[0], q[1]]);
  for (let it = 0; it < passes; it++) {
    for (const c of cons) {
      const a = p[c.i], b = p[c.j];
      let dx = b[0] - a[0], dy = b[1] - a[1], r = Math.hypot(dx, dy);
      if (r < 1e-9) { dx = 1; dy = 0; r = 1; }
      const k = ((r - c.d) / r) * 0.25;
      a[0] += dx * k; a[1] += dy * k;
      b[0] -= dx * k; b[1] -= dy * k;
    }
  }
  return p.map((q) => [q[0], q[1], 0]);
}

// Build the constraint list for a flat ring from a bond table and an angle
// table. bonds is { 'A-B': length }, angles is [[a, b, c, degrees]].
function ringCons(idx, bonds, angles) {
  const look = (a, b) => bonds[`${a}-${b}`] ?? bonds[`${b}-${a}`];
  const cons = [];
  for (const k of Object.keys(bonds)) {
    const [a, b] = k.split('-');
    cons.push({ i: idx[a], j: idx[b], d: bonds[k] });
  }
  for (const [a, b, c, t] of angles) {
    const d1 = look(a, b), d2 = look(b, c);
    if (d1 === undefined || d2 === undefined) throw new Error(`angle ${a}-${b}-${c} has no bond length`);
    cons.push({ i: idx[a], j: idx[c], d: Math.sqrt(d1 * d1 + d2 * d2 - 2 * d1 * d2 * Math.cos(t * DEG)) });
  }
  return cons;
}

// ------------------------------------------------------------- residue kit
const RES_ORDER = {
  ALA: ['N', 'CA', 'C', 'O', 'CB'],
  SER: ['N', 'CA', 'C', 'O', 'CB', 'OG'],
  ASP: ['N', 'CA', 'C', 'O', 'CB', 'CG', 'OD1', 'OD2'],
  GLU: ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD', 'OE1', 'OE2'],
  HIS: ['N', 'CA', 'C', 'O', 'CB', 'CG', 'ND1', 'CD2', 'CE1', 'NE2'],
};
const RES_CODE = { ALA: 'A', SER: 'S', ASP: 'D', GLU: 'E', HIS: 'H' };

const r4 = (v) => { const z = Math.round(v * 1e4) / 1e4; return z === 0 ? 0 : z; };

// Put the backbone N, C and O on a residue that already has CA and CB.
// outer is the side-chain atom bonded to CB, and chi1 is N-CA-CB-outer.
function backbone(pts, outer, chi1) {
  pts.N = nerf(outer, pts.CB, pts.CA, 1.458, 110.5, chi1);
  pts.C = nerf(outer, pts.CB, pts.CA, 1.525, 110.1, chi1 + 123.0);
  pts.O = nerf(pts.N, pts.CA, pts.C, 1.231, 120.8, -45.0);
}

// Build an alanine whose backbone amide N-H points at the acceptor atom.
// The amide is flat, so N, H and CA share a plane. azim turns that plane
// about the N-H line, and tor turns CB and C about the N-CA bond.
function oxyanionAla(acc, dirFromAcc, azim, tor) {
  const pts = {};
  pts.N = add(acc, mul(unit(dirFromAcc), 2.95));
  const h = unit(sub(acc, pts.N));                 // the N-H direction
  let r = cross(h, [0, 0, 1]);
  if (mag(r) < 0.1) r = cross(h, [1, 0, 0]);
  r = unit(r);
  const s = cross(h, r);
  const q = add(mul(r, Math.cos(azim * DEG)), mul(s, Math.sin(azim * DEG)));
  pts.CA = add(pts.N, mul(add(mul(h, Math.cos(119 * DEG)), mul(q, Math.sin(119 * DEG))), 1.458));
  pts.CB = nerf(acc, pts.N, pts.CA, 1.530, 110.5, tor);
  pts.C = nerf(acc, pts.N, pts.CA, 1.525, 111.0, tor + 120);
  pts.O = nerf(pts.N, pts.CA, pts.C, 1.231, 120.8, -45.0);
  return pts;
}

// Read a manifest motif_atoms field, such as 'A1:OE2,OE1,CD,CG A2:OG,CB,CA'.
// The result is { A1: ['OE2', ...], A2: [...] }. The kemp motif takes its
// tip atoms from this field of data.js, so the page keeps one copy of it.
function tipsFromMotifAtoms(str) {
  const out = {};
  for (const part of String(str).trim().split(/\s+/)) {
    const m = /^([A-Za-z]\d+):(.+)$/.exec(part);
    if (!m) throw new Error(`'${part}' is not a motif_atoms group`);
    out[m[1]] = m[2].split(',').map((x) => x.trim()).filter(Boolean);
  }
  return out;
}

function emitRes(name, chain, resId, pts, tip) {
  const order = RES_ORDER[name];
  if (!order) throw new Error(`no atom order for ${name}`);
  const atoms = order.map((an) => {
    const p = pts[an];
    if (!p) throw new Error(`${name} ${chain}${resId} is missing atom ${an}`);
    return { name: an, el: an[0], x: r4(p[0]), y: r4(p[1]), z: r4(p[2]) };
  });
  for (const t of tip) if (!order.includes(t)) throw new Error(`${name} has no tip atom ${t}`);
  return { code: RES_CODE[name], name, chain, resId, atoms, tip: tip.slice() };
}

// Turn a name table and a bond name list into the ligand record.
function emitLig(name, table, bondNames, coordNames = []) {
  const atoms = table.map(([an, el, p]) => ({ name: an, el, x: r4(p[0]), y: r4(p[1]), z: r4(p[2]) }));
  const idx = {};
  atoms.forEach((a, i) => { if (idx[a.name] !== undefined) throw new Error(`ligand has two atoms called ${a.name}`); idx[a.name] = i; });
  const pair = (list) => list.map(([a, b]) => {
    if (idx[a] === undefined || idx[b] === undefined) throw new Error(`ligand bond ${a}-${b} names an atom that is not there`);
    return [idx[a], idx[b]];
  });
  return { name, atoms, bonds: pair(bondNames), coord: pair(coordNames) };
}

// --------------------------------------------------------- the imidazole
//  Histidine side chain. The ring is a flat five-membered ring. ND1 sits
//  next to CG, NE2 sits between CE1 and CD2. The two nitrogens therefore
//  point in different directions, which is what lets one histidine both
//  take a proton on one side and give it on the other.
const IMID_BONDS = { 'CG-ND1': 1.378, 'ND1-CE1': 1.319, 'CE1-NE2': 1.374, 'NE2-CD2': 1.374, 'CD2-CG': 1.354 };
const IMID_ANGLES = [
  ['CD2', 'CG', 'ND1', 106.1], ['CG', 'ND1', 'CE1', 109.3], ['ND1', 'CE1', 'NE2', 108.4],
  ['CE1', 'NE2', 'CD2', 109.0], ['NE2', 'CD2', 'CG', 107.2],
];

function imidazole() {
  const names = ['CG', 'ND1', 'CE1', 'NE2', 'CD2'];
  const idx = {}; names.forEach((n, i) => { idx[n] = i; });
  const start = names.map((_n, i) => {
    const a = (90 - 72 * i) * DEG;
    return [1.15 * Math.cos(a), 1.15 * Math.sin(a)];
  });
  const p = relax2D(start, ringCons(idx, IMID_BONDS, IMID_ANGLES));
  const out = {}; names.forEach((n, i) => { out[n] = p[i]; });
  return out;
}

// Put an imidazole ring where the chemistry wants it. anchor is 'NE2' or
// 'ND1'. The lone pair of that nitrogen points along xTo, and the ring
// plane has the normal zTo.
function placeImidazole(anchor, oTo, xTo, zTo) {
  const ring = imidazole();
  const nb = anchor === 'NE2' ? ['CE1', 'CD2'] : ['CG', 'CE1'];
  const lone = sub(ring[anchor], mid(ring[nb[0]], ring[nb[1]]));
  const f0 = frameOf(ring[anchor], lone, [0, 0, 1]);
  const f1 = frameOf(oTo, xTo, zTo);
  const out = {};
  for (const k of Object.keys(ring)) out[k] = remap(f0, f1, ring[k]);
  return out;
}

// Grow the histidine stem from a placed ring: CB, CA and then the backbone.
function hisStem(ring, chi1, chi2) {
  const pts = { CG: ring.CG, ND1: ring.ND1, CD2: ring.CD2, CE1: ring.CE1, NE2: ring.NE2 };
  pts.CB = nerf(ring.CE1, ring.ND1, ring.CG, 1.497, 122.7, 180.0);
  pts.CA = nerf(ring.ND1, ring.CG, pts.CB, 1.530, 113.8, chi2);
  backbone(pts, ring.CG, chi1);
  return pts;
}

// The lone pair direction of a ring nitrogen, pointing out of the ring.
function lonePair(ring, n, a, b) { return unit(sub(ring[n], mid(ring[a], ring[b]))); }

// =========================================================== KEMP MOTIF
//  A Kemp elimination needs one base and one donor. A glutamate carboxylate
//  takes the proton. A serine hydroxyl holds the negative charge that grows
//  on the other side of the ring. The ligand is a flat nitrobenzotriazole,
//  which stands for the transition state. In the real substrate the base
//  takes a proton from a carbon. In this analogue the same position carries
//  the acidic N1-H, so the base points at N1.
const BTA_BONDS = {
  'N1-N2': 1.349, 'N2-N3': 1.312, 'N3-C3A': 1.374, 'C3A-C7A': 1.400, 'C7A-N1': 1.358,
  'C3A-C4': 1.398, 'C4-C5': 1.381, 'C5-C6': 1.405, 'C6-C7': 1.381, 'C7-C7A': 1.398,
};
const BTA_ANGLES = [
  ['N1', 'N2', 'N3', 110.0], ['N2', 'N3', 'C3A', 108.0], ['N3', 'C3A', 'C7A', 108.0],
  ['C3A', 'C7A', 'N1', 107.5], ['C7A', 'N1', 'N2', 106.5],
  ['N3', 'C3A', 'C4', 130.0], ['C7A', 'C3A', 'C4', 122.0], ['C3A', 'C4', 'C5', 117.0],
  ['C4', 'C5', 'C6', 121.5], ['C5', 'C6', 'C7', 121.5], ['C6', 'C7', 'C7A', 117.0],
  ['C7', 'C7A', 'C3A', 122.0], ['C7', 'C7A', 'N1', 130.5],
];

function buildKemp() {
  const tips = tipsFromMotifAtoms(KEMP_MANIFEST.design.motif_atoms);

  // 1. The flat bicyclic ring, settled in the z = 0 plane.
  const names = ['N1', 'N2', 'N3', 'C3A', 'C4', 'C5', 'C6', 'C7', 'C7A'];
  const idx = {}; names.forEach((n, i) => { idx[n] = i; });
  const start = [
    [-1.15, 1.05], [-1.95, 0.0], [-1.15, -1.05], [0.0, -0.70],
    [1.21, -1.40], [2.42, -0.70], [2.42, 0.70], [1.21, 1.40], [0.0, 0.70],
  ];
  const ring = relax2D(start, ringCons(idx, BTA_BONDS, BTA_ANGLES));
  const L = {}; names.forEach((n, i) => { L[n] = ring[i]; });

  // 2. The nitro group on C6, flat with the ring.
  L.N6 = nerf(L.C4, L.C5, L.C6, 1.470, 119.0, 180.0);
  L.O6A = nerf(L.C5, L.C6, L.N6, 1.225, 117.5, 0.0);
  L.O6B = nerf(L.C5, L.C6, L.N6, 1.225, 117.5, 180.0);

  // 3. The glutamate base. OE2 sits on the N1-H line at 2.70 A, so the
  //    proton travels in a straight line from the ligand to the base.
  const dirN1 = lonePair(L, 'N1', 'C7A', 'N2');
  const glu = {};
  glu.OE2 = add(L.N1, mul(dirN1, 2.70));
  glu.CD = nerf(L.C7A, L.N1, glu.OE2, 1.250, 120.0, 180.0);
  glu.OE1 = nerf(L.N1, glu.OE2, glu.CD, 1.250, 123.2, 180.0);
  glu.CG = nerf(L.N1, glu.OE2, glu.CD, 1.516, 118.4, 0.0);
  glu.CB = nerf(glu.OE2, glu.CD, glu.CG, 1.520, 112.6, 170.0);
  glu.CA = nerf(glu.CD, glu.CG, glu.CB, 1.530, 114.1, -65.0);
  backbone(glu, glu.CG, -65.0);

  // 4. The serine donor on the far nitrogen, N3, which carries the charge.
  const dirN3 = lonePair(L, 'N3', 'N2', 'C3A');
  const ser = {};
  ser.OG = add(L.N3, mul(dirN3, 2.80));
  ser.CB = nerf(L.N2, L.N3, ser.OG, 1.417, 115.0, 100.0);
  ser.CA = nerf(L.N3, ser.OG, ser.CB, 1.530, 110.8, 180.0);
  backbone(ser, ser.OG, -65.0);

  const ligand = emitLig(
    'nitrobenzotriazole transition-state analogue (idealised)',
    [...names, 'N6', 'O6A', 'O6B'].map((n) => [n, n[0], L[n]]),
    [['N1', 'N2'], ['N2', 'N3'], ['N3', 'C3A'], ['C3A', 'C7A'], ['C7A', 'N1'],
     ['C3A', 'C4'], ['C4', 'C5'], ['C5', 'C6'], ['C6', 'C7'], ['C7', 'C7A'],
     ['C6', 'N6'], ['N6', 'O6A'], ['N6', 'O6B']],
  );

  return {
    id: 'kemp',
    label: 'Kemp eliminase: a base and an oxyanion donor',
    residues: [
      emitRes('GLU', 'A', 1, glu, tips.A1),
      emitRes('SER', 'A', 2, ser, tips.A2),
    ],
    ligand,
    geometry: [
      { label: 'Base to the acidic position', kind: 'distance', atoms: ['res0:OE2', 'lig:N1'],
        ideal: 2.70, tol: 0.35,
        why: 'The glutamate oxygen takes the proton. Too far and nothing happens, too close and the two groups push each other away.' },
      { label: 'Base points at the ligand', kind: 'angle', atoms: ['res0:CD', 'res0:OE2', 'lig:N1'],
        ideal: 120.0, tol: 15.0,
        why: 'A carboxylate oxygen accepts a proton along a lone pair, not from the side.' },
      { label: 'Carboxylate opening angle', kind: 'angle', atoms: ['res0:OE1', 'res0:CD', 'res0:OE2'],
        ideal: 123.2, tol: 3.0,
        why: 'A carboxylate opens at about 123 degrees between its two oxygens. Both are built the same, so this row checks the shape of the group rather than which oxygen does the work; here OE2 is the one aimed at the ligand.' },
      { label: 'Oxyanion donor to the far ring nitrogen', kind: 'distance', atoms: ['res1:OG', 'lig:N3'],
        ideal: 2.80, tol: 0.35,
        why: 'When the proton leaves, the ring becomes an anion whose charge is spread over its nitrogens. The serine hydroxyl donates a hydrogen bond to the far one and pays for part of that charge. In the real substrate the ring then opens and the charge ends on a phenolate oxygen.' },
      { label: 'Donor and base sit on opposite sides', kind: 'angle', atoms: ['res0:OE2', 'lig:C3A', 'res1:OG'],
        ideal: 115.4, tol: 10.0,
        why: 'The base and the donor must work on opposite ends of the flat ligand, not crowd the same end. The ideal here is what this idealised build measures, so the row reads as its own reference.' },
    ],
  };
}

// ========================================================== TRIAD MOTIF
//  A serine esterase. The serine attacks the ester carbon, and the product
//  is a tetrahedral intermediate that carries a negative oxygen. Serine
//  cannot do that alone: a histidine takes its proton, and an aspartate
//  holds the histidine in the right form. Two backbone amides point at the
//  negative oxygen and hold it. That group of five is the catalytic triad
//  plus its oxyanion hole.
//  The torsion angles below were fixed during development. A search moved
//  them until no two groups touched, while it held the hydrogen bonds, the
//  chi1 rotamers and the flat carboxylate. The search ran once. Its result
//  is written here, so the build needs no random numbers and never moves.
const TRIAD_TORS = {
  hisChi1: -50.0, hisChi2: -150.0,
  serCB: 80.0,          // CE1-NE2-OG-CB: turns the serine about the hydrogen bond
  serCA: 60.0,          // NE2-OG-CB-CA
  serChi1: 60.0,
  aspCG: 20.0,          // CE1-ND1-OD2-CG: keeps the triad nearly flat
  aspOD1: -10.0,        // ND1-OD2-CG-OD1: the carboxylate plane
  aspCA: -180.0,        // OD2-CG-CB-CA
  aspChi1: 180.0,
  ligPhi: -150.0,       // turns the four-cornered centre about OG-CT
  ligRing: -110.0,      // OG-CT-O2-C3: turns the leaving-group ring
  donorA: 160.0, donorB: 30.0,        // where the two amides sit around O1
  alaAzimA: -110.0, alaTorA: -50.0,
  alaAzimB: 100.0, alaTorB: 20.0,
};
// The serine oxygen is four-cornered. CB, CT and the histidine lone pair
// all leave it at 110 degrees, which puts CB and CT 112 degrees apart.
const OG_ANG = 110.0, OG_SEP = 123.8;

function buildTriad() {
  const K = TRIAD_TORS;

  // 1. The histidine, with NE2 at the origin and its lone pair along +x.
  const ring = placeImidazole('NE2', [0, 0, 0], [1, 0, 0], [0, 0, 1]);
  const his = hisStem(ring, K.hisChi1, K.hisChi2);

  // 2. The serine hydroxyl on the NE2 lone pair line, 2.80 A away.
  const ser = {};
  ser.OG = [2.80, 0, 0];
  ser.CB = nerf(ring.CE1, ring.NE2, ser.OG, 1.417, OG_ANG, K.serCB);
  ser.CA = nerf(ring.NE2, ser.OG, ser.CB, 1.530, 110.8, K.serCA);
  backbone(ser, ser.OG, K.serChi1);

  // 3. The aspartate on the ND1 lone pair line, 2.70 A away. Both
  //    aspartate oxygens are 1.250 A from CG, so either one can do the job.
  const asp = {};
  asp.OD2 = add(ring.ND1, mul(lonePair(ring, 'ND1', 'CG', 'CE1'), 2.70));
  asp.CG = nerf(ring.CE1, ring.ND1, asp.OD2, 1.250, 120.0, K.aspCG);
  asp.OD1 = nerf(ring.ND1, asp.OD2, asp.CG, 1.250, 123.2, K.aspOD1);
  asp.CB = nerf(ring.ND1, asp.OD2, asp.CG, 1.516, 118.4, K.aspOD1 + 180.0);
  asp.CA = nerf(asp.OD2, asp.CG, asp.CB, 1.530, 113.8, K.aspCA);
  backbone(asp, asp.CG, K.aspChi1);

  // 4. The tetrahedral intermediate. CT is the carbon the serine attacked.
  //    It carries the serine oxygen, the new negative oxygen O1, a methyl
  //    group and the leaving-group oxygen O2, which holds a flat ring.
  const T = {};
  T.CT = nerf(ring.CE1, ring.NE2, ser.OG, 1.460, OG_ANG, K.serCB - OG_SEP);
  T.O1 = nerf(ring.NE2, ser.OG, T.CT, 1.320, 109.5, K.ligPhi);
  T.C2 = nerf(ring.NE2, ser.OG, T.CT, 1.510, 109.5, K.ligPhi + 120.0);
  T.O2 = nerf(ring.NE2, ser.OG, T.CT, 1.400, 109.5, K.ligPhi - 120.0);
  T.C3 = nerf(ser.OG, T.CT, T.O2, 1.380, 117.0, K.ligRing);
  T.C4 = nerf(T.CT, T.O2, T.C3, 1.390, 120.0, 180.0);
  T.C5 = nerf(T.O2, T.C3, T.C4, 1.390, 120.0, 180.0);
  T.C6 = nerf(T.C3, T.C4, T.C5, 1.390, 120.0, 0.0);
  T.C7 = nerf(T.C4, T.C5, T.C6, 1.390, 120.0, 0.0);
  T.C8 = nerf(T.C5, T.C6, T.C7, 1.390, 120.0, 0.0);

  // 5. Two backbone amides that reach the new negative oxygen from two
  //    sides. Each N-H points straight at O1.
  const nA = nerf(ser.OG, T.CT, T.O1, 2.95, 118.0, K.donorA);
  const nB = nerf(ser.OG, T.CT, T.O1, 2.95, 118.0, K.donorB);
  const alaA = oxyanionAla(T.O1, sub(nA, T.O1), K.alaAzimA, K.alaTorA);
  const alaB = oxyanionAla(T.O1, sub(nB, T.O1), K.alaAzimB, K.alaTorB);

  const ligand = emitLig(
    'tetrahedral intermediate of an aryl acetate (idealised)',
    ['CT', 'O1', 'C2', 'O2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'].map((n) => [n, n[0], T[n]]),
    [['CT', 'O1'], ['CT', 'C2'], ['CT', 'O2'], ['O2', 'C3'],
     ['C3', 'C4'], ['C4', 'C5'], ['C5', 'C6'], ['C6', 'C7'], ['C7', 'C8'], ['C8', 'C3']],
  );

  return {
    id: 'triad',
    label: 'Serine esterase: a Ser-His-Asp triad and an oxyanion hole',
    residues: [
      emitRes('SER', 'A', 1, ser, ['OG', 'CB', 'CA']),
      emitRes('HIS', 'A', 2, his, ['ND1', 'CD2', 'CE1', 'NE2', 'CG']),
      emitRes('ASP', 'A', 3, asp, ['OD1', 'OD2', 'CG', 'CB']),
      emitRes('ALA', 'A', 4, alaA, ['N']),
      emitRes('ALA', 'A', 5, alaB, ['N']),
    ],
    ligand,
    geometry: [
      { label: 'Serine to histidine hydrogen bond', kind: 'distance', atoms: ['res0:OG', 'res1:NE2'],
        ideal: 2.80, tol: 0.30,
        why: 'The histidine took this proton before the serine attacked, and in the state drawn here it holds the proton and gives the hydrogen bond back. Break this contact and the serine is far too weak to attack in the first place.' },
      { label: 'Histidine to aspartate hydrogen bond', kind: 'distance', atoms: ['res1:ND1', 'res2:OD2'],
        ideal: 2.70, tol: 0.30,
        why: 'The aspartate holds the histidine in the form that can take a proton, and pays for the charge it then carries.' },
      { label: 'Aspartate points at the histidine', kind: 'angle', atoms: ['res2:OD2', 'res1:ND1', 'res1:CE1'],
        ideal: 125.4, tol: 10.0,
        why: 'The hydrogen bond must run along the lone pair of the ring nitrogen, which leaves the ring at this angle.' },
      { label: 'Aspartate opening angle', kind: 'angle', atoms: ['res2:OD1', 'res2:CG', 'res2:OD2'],
        ideal: 123.2, tol: 3.0,
        why: 'The same check on the aspartate: about 123 degrees between its two oxygens. OD2 is the one aimed at the histidine.' },
      { label: 'Serine to substrate bond', kind: 'distance', atoms: ['res0:OG', 'lig:CT'],
        ideal: 1.46, tol: 0.10,
        why: 'In this state the bond is already made: the serine oxygen is joined to the carbon it attacked.' },
      { label: 'Histidine sits on a lone pair of the serine oxygen', kind: 'angle', atoms: ['res1:NE2', 'res0:OG', 'lig:CT'],
        ideal: 110.0, tol: 8.0,
        why: 'The serine oxygen now has four corners. The histidine must reach one free corner, not push into a bond.' },
      { label: 'Attacked carbon is four-cornered', kind: 'angle', atoms: ['res0:OG', 'lig:CT', 'lig:O1'],
        ideal: 109.5, tol: 5.0,
        why: 'The flat ester carbon became a four-cornered carbon. The pocket must make room for that change of shape.' },
      { label: 'First oxyanion-hole amide', kind: 'distance', atoms: ['res3:N', 'lig:O1'],
        ideal: 2.95, tol: 0.35,
        why: 'A backbone N-H holds the new negative oxygen. Two of them make the intermediate cheap enough to form.' },
      { label: 'Second oxyanion-hole amide', kind: 'distance', atoms: ['res4:N', 'lig:O1'],
        ideal: 2.95, tol: 0.35,
        why: 'The second N-H comes in from the other side, so the charge is held from two directions.' },
    ],
  };
}

// =========================================================== HAEM MOTIF
//  An iron porphyrin. The flat 24-atom macrocycle holds the iron in its
//  middle, with four pyrrole nitrogens 2.00 A away. A histidine nitrogen
//  sits 2.10 A below the iron and never leaves. That leaves one place free
//  above the iron, and the reacting carbon of the substrate goes there.
//  A second histidine holds the substrate by a hydrogen bond.
//
//  One quarter of the macrocycle, in the z = 0 plane, with the iron at the
//  origin and this pyrrole nitrogen on +x. The other three quarters are the
//  same quarter turned by 90, 180 and 270 degrees.
const PYRROLE = [['N', 2.0, 0.0], ['C1', 2.8345, 1.0991], ['C2', 4.2107, 0.675], ['C3', 4.2107, -0.675], ['C4', 2.8345, -1.0991]];
const MESO_R = 3.42;

function buildHaem() {
  const H = {};
  const suf = ['A', 'B', 'C', 'D'];
  const table = [['FE', 'Fe', [0, 0, 0]]];
  const bonds = [], coord = [];
  H.FE = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const a = k * 90 * DEG, c = Math.cos(a), s = Math.sin(a), x = suf[k];
    for (const [base, px, py] of PYRROLE) {
      const n = base + x;
      H[n] = [px * c - py * s, px * s + py * c, 0];
      table.push([n, base[0], H[n]]);
    }
    bonds.push([`N${x}`, `C1${x}`], [`C1${x}`, `C2${x}`], [`C2${x}`, `C3${x}`], [`C3${x}`, `C4${x}`], [`C4${x}`, `N${x}`]);
    coord.push(['FE', `N${x}`]);
  }
  for (let k = 0; k < 4; k++) {
    const a = (45 + 90 * k) * DEG, n = 'CM' + suf[k];
    H[n] = [MESO_R * Math.cos(a), MESO_R * Math.sin(a), 0];
    table.push([n, 'C', H[n]]);
    bonds.push([n, `C1${suf[k]}`], [n, `C4${suf[(k + 1) % 4]}`]);
  }

  // The substrate. C1S is the reacting carbon, bonded to the iron from
  // above. The rest is a small ester arm that a pocket can grip.
  H.C1S = [0, 0, 1.95];
  coord.push(['FE', 'C1S']);
  H.C2S = nerf(H.NA, H.FE, H.C1S, 1.470, 120.0, 0.0);
  H.O1S = nerf(H.FE, H.C1S, H.C2S, 1.230, 121.0, 180.0);
  H.O2S = nerf(H.FE, H.C1S, H.C2S, 1.350, 112.0, 0.0);
  H.C3S = nerf(H.C1S, H.C2S, H.O2S, 1.440, 116.5, 180.0);
  for (const [n, el] of [['C1S', 'C'], ['C2S', 'C'], ['O1S', 'O'], ['O2S', 'O'], ['C3S', 'C']]) table.push([n, el, H[n]]);
  bonds.push(['C1S', 'C2S'], ['C2S', 'O1S'], ['C2S', 'O2S'], ['O2S', 'C3S']);

  // The proximal histidine, below the iron. Its ring plane holds the iron
  // axis and leans toward a meso carbon.
  const prox = hisStem(placeImidazole('NE2', [0, 0, -2.10], [0, 0, 1], unit([1, -1, 0])), -65.0, -75.0);

  // The distal histidine, which hydrogen bonds the substrate carbonyl.
  const ne2d = nerf(H.O2S, H.C2S, H.O1S, 2.90, 125.0, 180.0);
  const bisD = unit(sub(H.O1S, ne2d));
  let nrmD = cross(bisD, [0, 0, 1]);
  if (mag(nrmD) < 0.1) nrmD = cross(bisD, [1, 0, 0]);
  const dist1 = hisStem(placeImidazole('NE2', ne2d, bisD, unit(nrmD)), -65.0, -75.0);

  const ligand = emitLig('iron porphyrin with a bound carbene unit (idealised)', table, bonds, coord);

  return {
    id: 'haem',
    label: 'Haem cofactor: an iron porphyrin with one free face',
    residues: [
      emitRes('HIS', 'A', 1, prox, ['NE2', 'CE1', 'ND1', 'CG', 'CD2']),
      emitRes('HIS', 'A', 2, dist1, ['NE2', 'CE1', 'CD2']),
    ],
    ligand,
    geometry: [
      { label: 'Iron to a pyrrole nitrogen', kind: 'distance', atoms: ['lig:FE', 'lig:NA'],
        ideal: 2.00, tol: 0.08,
        why: 'The four pyrrole nitrogens hold the iron. If the ring stretches, the iron falls out.' },
      { label: 'Neighbouring nitrogens are square', kind: 'angle', atoms: ['lig:NA', 'lig:FE', 'lig:NB'],
        ideal: 90.0, tol: 3.0,
        why: 'A square of nitrogens is what leaves the two faces of the iron free, one above and one below.' },
      { label: 'Opposite nitrogens are in a line', kind: 'angle', atoms: ['lig:NA', 'lig:FE', 'lig:NC'],
        ideal: 180.0, tol: 3.0,
        why: 'The macrocycle must stay flat. A buckled ring moves the iron and changes the reaction.' },
      { label: 'Histidine below the iron', kind: 'distance', atoms: ['res0:NE2', 'lig:FE'],
        ideal: 2.10, tol: 0.15,
        why: 'This one bond ties the cofactor to the protein. It is the anchor the whole design hangs on.' },
      { label: 'Axial bond is upright', kind: 'angle', atoms: ['res0:NE2', 'lig:FE', 'lig:NA'],
        ideal: 90.0, tol: 5.0,
        why: 'The histidine must come straight up at the iron from below, not from the side where the ring is.' },
      { label: 'Reacting carbon above the iron', kind: 'distance', atoms: ['lig:FE', 'lig:C1S'],
        ideal: 1.95, tol: 0.15,
        why: 'The reaction happens on this carbon. The iron must hold it close enough to make it reactive.' },
      { label: 'Substrate sits opposite the histidine', kind: 'angle', atoms: ['res0:NE2', 'lig:FE', 'lig:C1S'],
        ideal: 180.0, tol: 5.0,
        why: 'The histidine takes the lower face, so the substrate can only use the upper face. That is how the pocket chooses a side.' },
      { label: 'Distal histidine holds the substrate', kind: 'angle', atoms: ['res1:NE2', 'lig:O1S', 'lig:C2S'],
        ideal: 125.0, tol: 12.0,
        why: 'Our addition, not part of the published motif: a second histidine donates a hydrogen bond to the substrate oxygen along a lone pair, which fixes which way round the substrate sits.' },
      { label: 'Distal hydrogen bond length', kind: 'distance', atoms: ['res1:NE2', 'lig:O1S'],
        ideal: 2.90, tol: 0.35,
        why: 'Our addition, not part of the published motif: a hydrogen bond of this length is strong enough to hold the substrate and weak enough to let the product leave.' },
    ],
  };
}

// ============================================================== the table
export const MOTIFS = [
  {
    id: 'kemp',
    label: 'Kemp eliminase',
    chemistry: 'A glutamate takes a proton from a flat ring, and a serine holds the charge that is left behind.',
    blurb: 'An idealised stand-in, not the published active site. Every atom comes from standard bond lengths and angles, and the two side chains are placed so the base and the oxyanion donor reach the ends of the ligand. The real campaign uses a measured structure that is not on this site.',
    campaignId: 'kemp',
    motifStr: KEMP_MANIFEST.design.motif_str,
    seqLength: KEMP_MANIFEST.design.seq_length,
    build: buildKemp,
  },
  {
    id: 'triad',
    label: 'Serine esterase triad',
    chemistry: 'A Ser-His-Asp triad makes the serine strong enough to attack an ester, and two backbone amides hold the intermediate.',
    blurb: 'An idealised stand-in, not the published active site. The triad hydrogen bonds and the four-cornered intermediate are built from standard geometry, so the numbers are textbook values and not measurements. The real campaign starts from a natural enzyme structure that is not on this site.',
    campaignId: 'serine',
    motifStr: 'A1,A2,A3,A4,A5|20-70,{},6-40,{},6-40,{},6-40,{},6-40,{},20-70/B1',
    seqLength: '180-240',
    build: buildTriad,
  },
  {
    id: 'haem',
    label: 'Haem carbene transferase',
    chemistry: 'A histidine holds an iron porphyrin from below, which leaves the face above the iron free for new chemistry.',
    blurb: 'An idealised stand-in, not the published active site. The macrocycle is a flat, four-fold symmetric ring built from standard bond lengths, and the substrate is a small model arm. The real campaign uses a cofactor and a substrate pose that are not on this site.',
    campaignId: 'carbene',
    motifStr: 'A1,A2|15-80,{},10-60,{},15-80/B1',
    seqLength: '140-200',
    build: buildHaem,
  },
];

// Build one motif by id. Returns null for an id that is not there.
export function motifById(id) {
  const m = MOTIFS.find((x) => x.id === id);
  return m ? m.build() : null;
}

// Read one atom of a built motif. ref is 'res0:OE2' or 'lig:N3'.
export function atomAt(motif, ref) {
  const m = /^(?:res(\d+)|(lig)):([A-Za-z0-9]+)$/.exec(String(ref));
  if (!m) throw new Error(`'${ref}' is not an atom reference`);
  let list;
  if (m[2]) list = motif.ligand && motif.ligand.atoms;
  else { const r = motif.residues[+m[1]]; list = r && r.atoms; }
  if (!list) throw new Error(`reference '${ref}' has no residue or ligand`);
  const a = list.find((x) => x.name === m[3]);
  if (!a) throw new Error(`reference '${ref}' has no atom called ${m[3]}`);
  return a;
}

// Measure one geometry entry of a built motif. The result is angstroms for
// kind 'distance' and degrees for kind 'angle'.
export function measure(motif, entry) {
  const p = entry.atoms.map((r) => { const a = atomAt(motif, r); return [a.x, a.y, a.z]; });
  if (entry.kind === 'angle') {
    if (p.length !== 3) throw new Error(`angle '${entry.label}' needs three atoms, got ${p.length}`);
    return angleDeg(p[0], p[1], p[2]);
  }
  if (entry.kind !== 'distance') throw new Error(`'${entry.kind}' is not a geometry kind`);
  if (p.length !== 2) throw new Error(`distance '${entry.label}' needs two atoms, got ${p.length}`);
  return dist(p[0], p[1]);
}
