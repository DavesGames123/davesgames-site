// ============================================================================
//  OCTANE NUMBER  ·  hchem.js — C-H sites of a fuel molecule (no DOM)
// ----------------------------------------------------------------------------
//  Reads a molecules/chem.js model and sorts every hydrogen by the atom it
//  sits on. The class decides how easily a radical can pull that H off,
//  the first step of the low-temperature chain that leads to knock:
//    primary    on a CH3 (or CH4)          strongest alkane C-H
//    secondary  on a CH2 between two C     weaker
//    tertiary   on a CH with three C       weakest alkane C-H
//    aromatic   on a ring carbon           very strong: hard to remove
//    benzylic   on a carbon next to a ring  weak, but the radical is
//               spread over the ring and does not go on to the chain
//    alphaO     on a carbon next to an O   (the alcohols)
//    hydroxyl   on the O of an alcohol
//
//  The page colours the H atoms by class (view3d setHighlight groups).
//  sites(M)  -> { cls[] per atom (null for non-H), count{}, groups[] }
//  chainRun(M) -> longest run of linked CH2 carbons
//  shifts(M) -> isomerisation paths: a peroxy group on one carbon can
//            take an H from a carbon 2 or 3 bonds away (a 6- or
//            7-membered ring in the transition state). Counts only the
//            secondary and tertiary H, the ones that go easily. This is a
//            count of the structure, not a rate.
//
//  grep -n targets: "export const CLASSES", "export function sites",
//  "export function chainRun", "export function shifts"
// ============================================================================

export const CLASSES = {
  primary: { name: 'Primary C-H (CH3)', color: '#62c4ff' },
  secondary: { name: 'Secondary C-H (CH2)', color: '#ff7a59' },
  tertiary: { name: 'Tertiary C-H (CH)', color: '#ffd666' },
  aromatic: { name: 'Ring C-H (aromatic)', color: '#e889dc' },
  benzylic: { name: 'C-H next to a ring', color: '#b9a4ff' },
  alphaO: { name: 'C-H next to O', color: '#86dc7c' },
  hydroxyl: { name: 'O-H', color: '#c2c7d4' },
};

const heavy = (M, i) => M.nb[i].filter(e => M.z[e.to] !== 1).map(e => e.to);
const hs = (M, i) => M.nb[i].filter(e => M.z[e.to] === 1).map(e => e.to);
const aromaticAtom = (M, i) => M.nb[i].some(e => M.bonds[e.b].ar) || M.rings.some(r => r.arom && r.atoms.includes(i));

// Class of the carbon (or oxygen) that holds hydrogens.
export function carbonClass(M, c) {
  if (M.z[c] === 8) return 'hydroxyl';
  if (M.z[c] !== 6) return null;
  if (aromaticAtom(M, c)) return 'aromatic';
  const hv = heavy(M, c);
  if (hv.some(j => M.z[j] === 8)) return 'alphaO';
  if (hv.some(j => aromaticAtom(M, j))) return 'benzylic';
  const nc = hv.length;
  return nc <= 1 ? 'primary' : nc === 2 ? 'secondary' : 'tertiary';
}

export function sites(M) {
  const cls = new Array(M.N).fill(null);
  const count = Object.fromEntries(Object.keys(CLASSES).map(k => [k, 0]));
  for (let i = 0; i < M.N; i++) {
    if (M.z[i] !== 1) continue;
    const p = M.nb[i][0] ? M.nb[i][0].to : -1;
    const k = p >= 0 ? carbonClass(M, p) : null;
    cls[i] = k;
    if (k) count[k]++;
  }
  const groups = Object.keys(CLASSES).map(k => ({ key: k, color: CLASSES[k].color, atoms: cls.map((c, i) => c === k ? i : -1).filter(i => i >= 0) })).filter(g => g.atoms.length);
  const total = Object.values(count).reduce((a, b) => a + b, 0);
  return { cls, count, total, groups };
}

// Longest path of linked CH2 carbons (secondary, not aromatic).
export function chainRun(M) {
  const isCH2 = i => M.z[i] === 6 && carbonClass(M, i) === 'secondary' && hs(M, i).length === 2;
  const nodes = []; for (let i = 0; i < M.n; i++) if (isCH2(i)) nodes.push(i);
  let best = 0;
  const walk = (i, seen) => {
    let b = 1;
    for (const j of heavy(M, i)) if (isCH2(j) && !seen.has(j)) { seen.add(j); b = Math.max(b, 1 + walk(j, seen)); seen.delete(j); }
    return b;
  };
  for (const i of nodes) best = Math.max(best, walk(i, new Set([i])));
  return best;
}

// Carbon graph distances (BFS over C-C bonds) from atom a.
function cDist(M, a) {
  const d = new Map([[a, 0]]), q = [a];
  while (q.length) { const i = q.shift(); for (const j of heavy(M, i)) if (M.z[j] === 6 && !d.has(j)) { d.set(j, d.get(i) + 1); q.push(j); } }
  return d;
}

// Easy H-shift paths: (peroxy carbon, target H) pairs with the target
// carbon 2 or 3 bonds away and its H secondary or tertiary. Aromatic
// carbons take no peroxy group here (an O2 does not add to a ring C-H
// radical the same way at low temperature).
export function shifts(M) {
  const s = sites(M);
  let easy = 0, all = 0;
  const pairs = [];
  for (let a = 0; a < M.n; a++) {
    if (M.z[a] !== 6 || !hs(M, a).length) continue;
    const ka = carbonClass(M, a);
    if (ka === 'aromatic' || ka === 'benzylic') continue;
    for (const [b, d] of cDist(M, a)) {
      if (d !== 2 && d !== 3) continue;
      for (const h of hs(M, b)) {
        all++;
        const k = s.cls[h];
        if (k === 'secondary' || k === 'tertiary') { easy++; pairs.push([a, b, h, d]); }
      }
    }
  }
  return { easy, all, pairs };
}
