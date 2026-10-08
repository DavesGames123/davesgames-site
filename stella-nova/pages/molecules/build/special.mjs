// ============================================================================
//  MOLECULES  ·  build/special.mjs — records that need more than PubChem
// ----------------------------------------------------------------------------
//  1. fixRecord(OCL, cid, mol, meta)  for a PubChem record with no 3D
//     conformer and a coordination centre (a metal, or a main-group atom
//     with an expanded octet or lone pairs that set its shape: XeF4, ClF3).
//       - PubChem stores many complexes as separate ions ("cyclopenta-1,3-
//         diene;iron(2+)", "azane;dichloroplatinum"). connectMetal() adds
//         the metal-ligand bonds by donor rules: an anionic atom, the C of
//         CO and CN-, P of a phosphine, N of an amine or an aromatic N,
//         O of water, a halide ion, every C of a cyclopentadienide or a
//         benzene ring (hapto), and the inner N atoms of a porphyrin.
//       - build3D() places the ligands round the centre: VSEPR for a
//         main-group centre (lone pairs take the equatorial sites of a
//         trigonal bipyramid and trans sites of an octahedron), and for a
//         metal: linear, trigonal, square planar (Pt, Pd, Au, Rh, Ir) or
//         tetrahedral, trigonal bipyramid, octahedral. Each ligand is an
//         OpenChemLib conformer, turned so that its donor points at the
//         centre; a hapto ring lies flat across its site; a macrocycle
//         keeps its own shape with the metal at the centre of its donors.
//     Returns { mol, mol3d, after } or null (the normal path).
//  1b. HAND: seven PubChem records (H2, ferrocene, ruthenocene, Fe(CO)5,
//     n-butyllithium, diethylzinc, OsO4) that OpenChemLib misreads. Each
//     gets a SMILES with the PubChem formula, a 3D geometry from measured
//     bond lengths and, for the sandwiches and Fe(CO)5, a textbook 2D
//     layout. handNote(cid) is its note, the record field dn.
//  2. builtRecords(OCL)  records with no PubChem entry: the Watson-Crick
//     G-C and A-T base pairs, from the 3DNA standard base frames (Olson
//     et al. 2001), with the hydrogen bonds in the record field "hb".
//
//  grep -n targets: "function connectMetal", "function build3D",
//  "function vsepr", "function placeLigand", "function basePair",
//  "const HAND", "const GEO", "const LAY2", "function handRecord"
// ============================================================================
import { isMetal, el, encodeI16 } from '../chem.js';
import { recordFrom, conformerOf } from '../engine.js';

// ── small vector kit ────────────────────────────────────────────────────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mean = ps => ps.reduce((s, p) => add(s, mul(p, 1 / ps.length)), [0, 0, 0]);
// rotation matrix that turns unit vector u onto unit vector v
function rotUV(u, v) {
  const c = dot(u, v);
  if (c > 1 - 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -1 + 1e-9) { let p = cross(u, [1, 0, 0]); if (len(p) < 1e-3) p = cross(u, [0, 1, 0]); p = unit(p); return axisAngle(p, Math.PI); }
  return axisAngle(unit(cross(u, v)), Math.acos(c));
}
function axisAngle(k, t) {
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c, [x, y, z] = k;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
const apply = (R, p) => [R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2], R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2], R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]];
const mmul = (A, B) => A.map((r, i) => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
// Horn quaternion fit (rotation only) of centred A onto centred B, as a matrix
function horn(A, B) {
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < A.length; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += A[i][r] * B[i][c];
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz], [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sw = 0; sw < 40; sw++) for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
    if (Math.abs(N[p][q]) < 1e-15) continue;
    const th = (N[q][q] - N[p][p]) / (2 * N[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 4; k++) { const a = N[k][p], b = N[k][q]; N[k][p] = c * a - s * b; N[k][q] = s * a + c * b; }
    for (let k = 0; k < 4; k++) { const a = N[p][k], b = N[q][k]; N[p][k] = c * a - s * b; N[q][k] = s * a + c * b; }
    for (let k = 0; k < 4; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
  }
  let best = 0; for (let k = 1; k < 4; k++) if (N[k][k] > N[best][best]) best = k;
  const [w, x, y, z] = [V[0][best], V[1][best], V[2][best], V[3][best]];
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}

const SQUARE = new Set(['Pt', 'Pd', 'Au', 'Rh', 'Ir']);
const HAPTO_D = { Fe: 1.65, Ru: 1.81, Co: 1.72, Ni: 1.75, Cr: 1.61, Ti: 2.06, Zr: 2.2, Mn: 1.75, Os: 1.82, V: 1.66, Mo: 1.67, W: 1.7 };
const HYPER = new Set(['Xe', 'Kr', 'I', 'Br', 'Cl', 'S', 'Se', 'Te', 'P', 'As', 'Sb']);

// ── topology ────────────────────────────────────────────────────────────────
// Connect isolated metal atoms to their ligands. Returns true if bonds
// were added.
function connectMetal(OCL, m) {
  const M = OCL.Molecule;
  m.ensureHelperArrays(M.cHelperRings);
  const metals = [];
  for (let i = 0; i < m.getAllAtoms(); i++) if (isMetal(m.getAtomicNo(i)) && m.getAllConnAtomsPlusMetalBonds(i) === 0) metals.push(i);
  if (metals.length !== 1) return false;
  const mt = metals[0];
  // s-block metals (Na, K, Ca, Mg ...) form salts: only a macrocycle binds
  const sBlock = [3, 4, 11, 12, 19, 20, 37, 38, 55, 56].includes(m.getAtomicNo(mt));
  const frag = new Array(m.getAllAtoms()).fill(0);
  const nf = m.getFragmentNumbers(frag, false, true);
  const donors = [];
  for (let f = 0; f < nf; f++) {
    if (f === frag[mt]) continue;
    const atoms = []; for (let i = 0; i < m.getAllAtoms(); i++) if (frag[i] === f) atoms.push(i);
    const heavy = atoms.filter(i => m.getAtomicNo(i) > 1);
    const zs = heavy.map(i => m.getAtomicNo(i));
    let d = macroN(m, heavy);
    if (d.length) { /* a porphyrin, chlorin, corrin or phthalocyanine */ }
    else if (sBlock) continue;                                                    // a salt stays ionic
    else if (heavy.length === 1) d = heavy;                                       // halide, oxide, water, ammonia
    else if (heavy.length === 2 && zs.includes(6) && (zs.includes(8) || zs.includes(7))) d = heavy.filter(i => m.getAtomicNo(i) === 6); // CO, CN-
    else {
      const neg = heavy.filter(i => m.getAtomCharge(i) < 0);
      const rs = m.getRingSet();
      const carbRing = k => rs.getRingAtoms(k).every(i => m.getAtomicNo(i) === 6);
      for (let k = 0; k < rs.getSize(); k++) {
        const ra = rs.getRingAtoms(k);
        if (carbRing(k) && (ra.length === 5 && ra.some(i => neg.includes(i)) || ra.length === 6 && rs.isAromatic(k) && heavy.length === 6)) d.push(...ra);
      }
      if (!d.length && neg.length) d = neg;
      if (!d.length) d = heavy.filter(i => m.getAtomicNo(i) === 15 && m.getConnAtoms(i) === 3);                    // phosphine
      if (!d.length) d = heavy.filter(i => m.getAtomicNo(i) === 7 && (m.isAromaticAtom(i) || m.getConnAtoms(i) <= 3) && m.getAtomCharge(i) === 0).slice(0, 2);
    }
    donors.push(...d);
  }
  if (!donors.length) return false;
  // Every metal-ligand bond is dative (OpenChemLib cBondTypeMetalLigand)
  // and every atom keeps PubChem's charge: Fe2+ with two N- in heme. A
  // covalent bond on an anion was tried: OpenChemLib then reads the bond
  // as dative again and gives the donor a hydrogen (heme came out C34H34).
  for (const i of donors) m.setBondType(m.addBond(mt, i, M.cBondTypeSingle), M.cBondTypeMetalLigand);
  m.ensureHelperArrays(M.cHelperRings);
  return true;
}

// The four inner N atoms of a porphyrin-type macrocycle: N in a 5-ring with
// two heavy neighbours and no H, each 3 or 4 bonds from two others.
function macroN(m, heavy) {
  const rs = m.getRingSet();
  const in5 = i => { for (let k = 0; k < rs.getSize(); k++) { const r = rs.getRingAtoms(k); if (r.length === 5 && r.includes(i)) return true; } return false; };
  const ns = heavy.filter(i => m.getAtomicNo(i) === 7 && m.getConnAtoms(i) === 2 && m.getAllHydrogens(i) <= 1 && in5(i));
  for (const a of ns) {
    const near = ns.filter(b => b !== a && [3, 4].includes(m.getPathLength(a, b)));
    if (near.length < 2) continue;
    const ring = new Set([a, ...near]);
    for (const b of near) for (const c of ns) if (!ring.has(c) && [3, 4].includes(m.getPathLength(b, c)) && m.getPathLength(a, c) > 4) ring.add(c);
    if (ring.size === 4) return [...ring];
  }
  return [];
}

// ── geometry ────────────────────────────────────────────────────────────────
function polyhedron(n, sym, lpN = 0) {
  const T = Math.sqrt(1 / 3);
  const sets = {
    1: [[1, 0, 0]], 2: [[1, 0, 0], [-1, 0, 0]],
    3: [[1, 0, 0], [-0.5, Math.sqrt(3) / 2, 0], [-0.5, -Math.sqrt(3) / 2, 0]],
    4: [[T, T, T], [-T, -T, T], [-T, T, -T], [T, -T, -T]],
    sq: [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]],
    // TBP: equatorial first (lone pairs take them first), then axial
    5: [[1, 0, 0], [-0.5, Math.sqrt(3) / 2, 0], [-0.5, -Math.sqrt(3) / 2, 0], [0, 0, 1], [0, 0, -1]],
    // octahedron: trans pairs first, so two lone pairs sit trans
    6: [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]],
    7: [[0, 0, 1], [0, 0, -1], ...[0, 1, 2, 3, 4].map(k => [Math.cos(k * 2 * Math.PI / 5), Math.sin(k * 2 * Math.PI / 5), 0])],
  };
  if (n === 4 && sym) return sets.sq;
  void lpN;
  return sets[n] || null;
}
// VSEPR site list for a main-group centre: returns the bonding directions.
function vsepr(nBond, nLP) {
  const sn = nBond + nLP;
  const P = polyhedron(sn); if (!P) return null;
  if (sn === 5) return P.slice(nLP <= 3 ? nLP : 0).slice(0, nBond);       // LP equatorial
  if (sn === 6) return P.slice(nLP).slice(0, nBond);                      // LP trans
  if (sn === 4 && nLP) return P.slice(nLP).slice(0, nBond);
  if (sn === 3 && nLP) return P.slice(nLP).slice(0, nBond);
  return P.slice(0, nBond);
}

const fragCoords = (OCL, full, atoms) => conformerOf(OCL, full, atoms);

function build3D(OCL, full, ctr) {
  const M = OCL.Molecule, N = full.getAllAtoms();
  const sym = el(full.getAtomicNo(ctr)).sym, metal = isMetal(full.getAtomicNo(ctr));
  // ligands: fragments after the centre is removed
  const nb = []; for (let k = 0; k < full.getAllConnAtomsPlusMetalBonds(ctr); k++) nb.push(full.getConnAtom(ctr, k));
  const seen = new Set([ctr]), ligs = [];
  for (const d of nb) {
    if (seen.has(d)) continue;
    const atoms = [], st = [d]; seen.add(d);
    while (st.length) { const a = st.pop(); atoms.push(a); for (let k = 0; k < full.getAllConnAtomsPlusMetalBonds(a); k++) { const b = full.getConnAtom(a, k); if (!seen.has(b)) { seen.add(b); st.push(b); } } }
    ligs.push({ atoms, donors: atoms.filter(a => nb.includes(a)) });
  }
  // sites: a hapto ring (3+ donors in one ring of C) is one site; a
  // macrocycle (4+ donors that are not hapto) keeps its own frame
  for (const L of ligs) {
    L.hapto = L.donors.length >= 3 && L.donors.every(a => full.getAtomicNo(a) === 6);
    L.macro = !L.hapto && L.donors.length >= 4;
    L.sites = L.hapto ? 1 : L.donors.length;
  }
  const nSites = ligs.reduce((s, L) => s + L.sites, 0);
  const pos = new Array(N).fill(null);
  pos[ctr] = [0, 0, 0];
  const macro = ligs.find(L => L.macro);
  let dirs;
  if (macro) {
    const c = fragCoords(OCL, full, macro.atoms), dn = macro.donors.map(a => c.get(a)), cen = mean(dn);
    for (const a of macro.atoms) pos[a] = sub(c.get(a), cen);
    // the macrocycle plane normal: other ligands go along +n, then -n
    const u = sub(dn[0], cen), v = sub(dn[1], cen); let n = unit(cross(u, v)); if (len(n) < 0.5) n = [0, 0, 1];
    dirs = [n, mul(n, -1)];
  } else if (metal) {
    dirs = polyhedron(nSites, SQUARE.has(sym) && nSites === 4);
  } else {
    let lp = 0; try { lp = Math.max(0, Math.floor((outerE(full.getAtomicNo(ctr)) - full.getAtomCharge(ctr) - bondSum(full, ctr)) / 2)); } catch (e) { lp = 0; }
    dirs = vsepr(nSites, lp);
  }
  if (!dirs) return null;
  let di = 0;
  // the largest chelates first take adjacent sites
  for (const L of ligs.filter(L => !L.macro).sort((a, b) => b.sites - a.sites)) {
    const c = fragCoords(OCL, full, L.atoms);
    if (L.hapto) {
      const v = dirs[di++]; if (!v) return null;
      const ring = L.donors.map(a => c.get(a)), cen = mean(ring);
      let n = unit(cross(sub(ring[0], cen), sub(ring[1], cen)));
      const R = rotUV(n, unit(v)), dist = HAPTO_D[sym] || 1.75;
      for (const a of L.atoms) pos[a] = add(apply(R, sub(c.get(a), cen)), mul(unit(v), dist));
      continue;
    }
    const dlen = d => {
      let r = el(full.getAtomicNo(ctr)).cov + el(full.getAtomicNo(d)).cov;
      if (full.getAtomicNo(d) === 6 && L.atoms.length <= 2) r *= 0.9;   // CO, CN-
      return r;
    };
    if (L.donors.length === 1) {
      const d = L.donors[0], v = unit(dirs[di++] || [0, 0, 1]);
      const cen = mean(L.atoms.map(a => c.get(a))), out = sub(cen, c.get(d));
      const R = len(out) > 1e-3 ? rotUV(unit(out), v) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (const a of L.atoms) pos[a] = add(apply(R, sub(c.get(a), c.get(d))), mul(v, dlen(d)));
    } else {
      // a chelate: take the free sites nearest each other, fit the donors
      const take = [dirs[di++]];
      while (take.length < L.donors.length) {
        let best = -1, bd = -2;
        for (let k = di; k < dirs.length; k++) { const s = Math.max(...take.map(t => dot(unit(t), unit(dirs[k])))); if (s > bd && s < 0.99) { bd = s; best = k; } }
        if (best < 0) return null;
        [dirs[di], dirs[best]] = [dirs[best], dirs[di]]; take.push(dirs[di++]);
      }
      const tg = L.donors.map((d, k) => mul(unit(take[k]), dlen(d)));
      const src = L.donors.map(d => c.get(d));
      const cs = mean(L.atoms.map(a => c.get(a))), ct = mul(unit(mean(take)), 3);
      const A = [...src, cs], B = [...tg, ct];
      const ca = mean(A), cb = mean(B);
      const R = horn(A.map(p => sub(p, ca)), B.map(p => sub(p, cb)));
      for (const a of L.atoms) pos[a] = add(apply(R, sub(c.get(a), ca)), cb);
    }
  }
  if (pos.some(p => !p)) return null;
  void mmul; void M;
  return pos;
}
const OUTER = { 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 15: 5, 16: 6, 17: 7, 33: 5, 34: 6, 35: 7, 51: 5, 52: 6, 53: 7, 54: 8, 36: 8 };
const outerE = z => OUTER[z] ?? 0;
function bondSum(m, i) { let s = 0; for (let k = 0; k < m.getAllConnAtoms(i); k++) s += m.getConnBondOrder(i, k); return s + m.getImplicitHydrogens(i); }

// Which atom is the coordination centre? A single metal, or a main-group
// atom of HYPER with 2+ bonds that every other heavy atom is near.
function centre(m) {
  const metals = [];
  for (let i = 0; i < m.getAllAtoms(); i++) if (isMetal(m.getAtomicNo(i))) metals.push(i);
  if (metals.length === 1) return metals[0];
  if (metals.length > 1) return -1;
  let best = -1;
  if (m.getAtoms() > 12) return -1;
  for (let i = 0; i < m.getAtoms(); i++) {
    const s = el(m.getAtomicNo(i)).sym;
    if (!HYPER.has(s) || m.getConnAtoms(i) < 2) continue;
    // a hypervalent or lone-pair shaped centre: halogen or noble gas with
    // 2+ bonds, or S/Se/Te/P/As/Sb with 5+ bonds
    const g = ['Xe', 'Kr', 'I', 'Br', 'Cl'].includes(s) ? 2 : ['S', 'Se', 'Te'].includes(s) ? 4 : 5;
    if (m.getConnAtoms(i) >= g) best = i;
  }
  return best;
}

// ── hand-built entries ──────────────────────────────────────────────────────
// PubChem stores these seven compounds with radical bracket atoms ([CH],
// [CH2], [C], [HH]) or with Os-O single bonds. OpenChemLib reads those
// as radicals or as OH groups, so the formula came out wrong (ferrocene
// C10H8Fe, H2 as H). Each entry here gives a structure with the PubChem
// formula: s is its SMILES (it replaces the record's SMILES), geo names a
// 3D builder (else build3D), lay2 a 2D layout (else the CoordinateInventor),
// note goes to the record field dn (build.mjs, handNote) and tells how
// the bonding is drawn. None of these CIDs has a PubChem 3D conformer.
const CP2 = m => `[CH-]1C=CC=C1.[CH-]1C=CC=C1.[${m}+2]`;
const CO5 = '[C-]#[O+].'.repeat(5) + '[Fe]';
const HAND = {
  783: { s: '[H][H]', geo: 'h2', lay2: 'h2', note: '3D: H–H 0.741 Å.' },
  10219726: { s: CP2('Fe'), geo: 'sandwich', mc: 2.064, cc: 1.440, lay2: 'sandwich', iu: 'bis(η5-cyclopentadienyl)iron',
    note: 'Drawn in the ionic form: Fe2+ between two cyclopentadienide (C5H5−) rings. Each ring bonds through all five carbons (η5), shown as five dashed Fe–C bonds; the 2D rings are drawn in perspective, and the charge drawn on one carbon is spread over the ring. 3D: eclipsed rings from gas electron diffraction (Fe–C 2.064 Å, C–C 1.440 Å).' },
  11020720: { s: CP2('Ru'), geo: 'sandwich', mc: 2.20, cc: 1.43, lay2: 'sandwich', iu: 'bis(η5-cyclopentadienyl)ruthenium',
    note: 'Drawn in the ionic form: Ru2+ between two cyclopentadienide (C5H5−) rings. Each ring bonds through all five carbons (η5), shown as five dashed Ru–C bonds; the 2D rings are drawn in perspective, and the charge drawn on one carbon is spread over the ring. 3D: eclipsed rings, as in the crystal; Ru–C 2.20 Å, C–C 1.43 Å.' },
  26040: { s: CO5, geo: 'tbp', mc: 1.81, co: 1.15, lay2: 'tbp', iu: 'pentacarbonyliron',
    note: 'Each CO binds iron through carbon, drawn as a dashed Fe–C bond with the carbon monoxide as C≡O (formal charges C− and O+). 3D: trigonal bipyramid, mean Fe–C 1.81 Å, C–O 1.15 Å (gas electron diffraction).' },
  53627823: { s: 'CCCC[Li]', iu: 'butyllithium',
    note: 'Drawn and built as one C–Li molecule; the real reagent is a cluster of these units (a hexamer in hexane, a tetramer in ether).' },
  101667988: { s: 'CC[Zn]CC', iu: 'diethylzinc', note: '3D: built with a linear C–Zn–C axis.' },
  30318: { s: 'O=[Os](=O)(=O)=O', geo: 'td', mc: 1.711, lay2: 'cross',
    note: 'Drawn with four Os=O double bonds. 3D: a regular tetrahedron, Os–O 1.711 Å (gas electron diffraction).' },
};
export const handNote = cid => HAND[cid] ? HAND[cid].note : '';

// The atoms of the ring through atom a0, in ring order (carbons only).
function ringOrder(m, a0) {
  const out = [a0];
  for (let prev = -1, cur = a0; out.length <= 6;) {
    let next = -1;
    for (let k = 0; k < m.getConnAtoms(cur); k++) { const b = m.getConnAtom(cur, k); if (m.getAtomicNo(b) === 6 && b !== prev) { next = b; break; } }
    if (next < 0 || next === a0) break;
    out.push(next); prev = cur; cur = next;
  }
  if (out.length !== 5) throw new Error('not a 5-ring at atom ' + a0);
  return out;
}
const metalOf = m => { for (let i = 0; i < m.getAllAtoms(); i++) if (isMetal(m.getAtomicNo(i))) return i; return -1; };
const T4 = Math.sqrt(1 / 3);

// 3D builders: full (explicit H) -> one [x, y, z] per atom
const GEO = {
  h2: () => [[-0.3705, 0, 0], [0.3705, 0, 0]],
  // two eclipsed C5 rings on the z axis, the metal at the origin, each H
  // 1.08 Å out from its carbon in the ring plane
  sandwich: (full, H) => {
    const pos = new Array(full.getAllAtoms()).fill(null), mt = metalOf(full);
    const r = H.cc / (2 * Math.sin(Math.PI / 5)), h = Math.sqrt(H.mc * H.mc - r * r);
    pos[mt] = [0, 0, 0];
    const starts = []; for (let i = 0; i < full.getAtoms(); i++) if (full.getAtomCharge(i) < 0) starts.push(i);
    starts.forEach((a0, ri) => ringOrder(full, a0).forEach((a, k) => { const t = 2 * Math.PI * k / 5; pos[a] = [r * Math.cos(t), r * Math.sin(t), ri ? -h : h]; }));
    for (let i = 0; i < full.getAllAtoms(); i++) if (full.getAtomicNo(i) === 1) {
      const p = pos[full.getConnAtom(i, 0)], u = unit([p[0], p[1], 0]);
      pos[i] = [p[0] + 1.08 * u[0], p[1] + 1.08 * u[1], p[2]];
    }
    return pos;
  },
  // M(CO)5: axial along z, equatorial in the xy plane
  tbp: (full, H) => {
    const pos = new Array(full.getAllAtoms()).fill(null), mt = metalOf(full);
    const dirs = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-0.5, Math.sqrt(3) / 2, 0], [-0.5, -Math.sqrt(3) / 2, 0]];
    pos[mt] = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < full.getAllAtoms(); i++) if (full.getAtomicNo(i) === 6) {
      const d = dirs[k++], o = full.getConnAtom(i, 0) === mt ? full.getConnAtom(i, 1) : full.getConnAtom(i, 0);
      pos[i] = mul(d, H.mc); pos[o] = mul(d, H.mc + H.co);
    }
    return pos;
  },
  td: (full, H) => {
    const pos = new Array(full.getAllAtoms()).fill(null), mt = metalOf(full);
    const dirs = [[T4, T4, T4], [-T4, -T4, T4], [-T4, T4, -T4], [T4, -T4, -T4]];
    pos[mt] = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < full.getAllAtoms(); i++) if (i !== mt) pos[i] = mul(dirs[k++], H.mc);
    return pos;
  },
};

// 2D layouts (bond length 1, y down): one [x, y] per shown atom
const LAY2 = {
  // H-H level, long enough to show the bond between the two labels
  h2: () => [[-0.7, 0], [0.7, 0]],
  // the textbook sandwich: each ring in perspective, one above and one
  // below the metal, with a vertex toward the viewer, so the five dashed
  // bonds fan out at 0, about 15 and about 30 degrees. The charged
  // carbon is a back vertex, where its label is clear of the bonds.
  sandwich: (c) => {
    const n = c.getAllAtoms(), out = new Array(n).fill(null), mt = metalOf(c);
    const R = 1.0, k = 0.62, cy = 1.9;
    out[mt] = [0, 0];
    const starts = []; for (let i = 0; i < n; i++) if (c.getAtomCharge(i) < 0) starts.push(i);
    starts.forEach((a0, ri) => {
      const sg = ri ? 1 : -1;
      ringOrder(c, a0).forEach((a, j) => { const t = (234 + 72 * j) * Math.PI / 180; out[a] = [R * Math.cos(t), sg * (cy - k * R * Math.sin(t))]; });
    });
    return out;
  },
  // MO4: the metal at the centre of a cross, long bonds for the labels
  cross: (c) => { const mt = metalOf(c); let j = 0; const d = [[0, -1.3], [1.3, 0], [0, 1.3], [-1.3, 0]]; return Array.from({ length: c.getAllAtoms() }, (_, i) => i === mt ? [0, 0] : d[j++]); },
  // M(CO)5: axial up and down, equatorial left, upper right, lower right
  tbp: (c) => {
    const n = c.getAllAtoms(), out = new Array(n).fill(null), mt = metalOf(c);
    const dirs = [[0, -1], [0, 1], [-1, 0], [Math.cos(Math.PI / 6), -0.5], [Math.cos(Math.PI / 6), 0.5]];
    out[mt] = [0, 0];
    let j = 0;
    for (let i = 0; i < n; i++) if (c.getAtomicNo(i) === 6) {
      const d = dirs[j++], o = c.getConnAtom(i, 0) === mt ? c.getConnAtom(i, 1) : c.getConnAtom(i, 0);
      out[i] = [1.6 * d[0], 1.6 * d[1]]; out[o] = [2.75 * d[0], 2.75 * d[1]];   // long bonds: the labels take room
    }
    return out;
  },
};

function handRecord(OCL, H, meta) {
  const M = OCL.Molecule;
  const m = M.fromSmiles(H.s);
  connectMetal(OCL, m);                       // CO and C5H5- get dative bonds
  const full = m.getCompactCopy(); full.addImplicitHydrogens(); full.ensureHelperArrays(M.cHelperRings);
  const pos = H.geo ? GEO[H.geo](full, H) : build3D(OCL, full, centre(full));
  if (!pos || pos.some(p => !p)) throw new Error('hand 3D failed');
  const mol3d = full.getCompactCopy();
  pos.forEach((p, i) => { mol3d.setAtomX(i, p[0]); mol3d.setAtomY(i, p[1]); mol3d.setAtomZ(i, p[2]); });
  const rec = recordFrom(OCL, full, { mol3d, meta: Object.assign({}, meta, { s: H.s, iu: H.iu || meta.iu }), keepInput: true });
  rec.g3 = 'built';
  if (H.lay2) {
    const c = full.getCompactCopy(); c.removeExplicitHydrogens(); c.ensureHelperArrays(M.cHelperRings);
    const pts = LAY2[H.lay2](c);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    rec.p2 = encode2D(pts.map(([x, y]) => [(x - cx) * 100, (y - cy) * 100]));
  }
  return rec;
}

export function fixRecord(OCL, cid, mol, meta, has3d) {
  void cid;
  if (HAND[cid]) return { rec: handRecord(OCL, HAND[cid], meta) };
  const M = OCL.Molecule;
  const m = mol.getCompactCopy();
  const fixed = connectMetal(OCL, m);
  if (has3d && !fixed) return null;
  // only records without a PubChem conformer come here for a built 3D
  const ctr = centre(m);
  if (!fixed && ctr < 0) return null;
  const full = m.getCompactCopy(); full.addImplicitHydrogens(); full.ensureHelperArrays(M.cHelperRings);
  const c = centre(full);
  let pos = null;
  if (c >= 0) { try { pos = build3D(OCL, full, c); } catch (e) { pos = null; } }
  if (!pos) return fixed ? { mol: full } : null;
  const mol3d = full.getCompactCopy();
  pos.forEach((p, i) => { mol3d.setAtomX(i, p[0]); mol3d.setAtomY(i, p[1]); mol3d.setAtomZ(i, p[2]); });
  return { mol: full, mol3d, after: rec => { rec.g3 = 'built'; void meta; } };
}

// ── base pairs ──────────────────────────────────────────────────────────────
// 3DNA standard bases (Olson et al. 2001), with C1' kept as a methyl carbon.
const BASES = {
  G: ['Cn1cnc2c(=O)[nH]c(N)nc12', [[-2.477, 5.399, 0], [-1.289, 4.551, 0], [0.023, 4.962, 0], [0.870, 3.969, 0], [0.071, 2.833, 0], [0.424, 1.460, 0], [1.554, 0.955, 0], [-0.700, 0.641, 0], [-1.999, 1.087, 0], [-2.949, 0.139, -0.001], [-2.342, 2.364, 0.001], [-1.265, 3.177, 0]]],
  C: ['Cn1c(=O)nc(N)cc1', [[-2.477, 5.402, 0], [-1.285, 4.542, 0], [-1.472, 3.158, 0], [-2.628, 2.709, 0.001], [-0.391, 2.344, 0], [0.837, 2.868, 0], [1.875, 2.027, 0.001], [1.056, 4.275, 0], [-0.023, 5.068, 0]]],
  A: ['Cn1cnc2c(N)ncnc12', [[-2.479, 5.346, 0], [-1.291, 4.498, 0], [0.024, 4.897, 0], [0.877, 3.902, 0], [0.071, 2.771, 0], [0.369, 1.398, 0], [1.611, 0.909, 0], [-0.668, 0.532, 0], [-1.912, 1.023, 0], [-2.320, 2.290, 0], [-1.267, 3.124, 0]]],
  T: ['Cn1c(=O)[nH]c(=O)c(C)c1', [[-2.481, 5.354, 0], [-1.284, 4.500, 0], [-1.462, 3.135, 0], [-2.562, 2.608, 0], [-0.298, 2.407, 0], [0.994, 2.897, 0], [1.944, 2.119, 0], [1.106, 4.338, 0], [2.466, 4.961, 0.001], [-0.024, 5.057, 0]]],
};
// hydrogen bonds as [atom in base 1, atom in base 2] (heavy-atom indices)
const HB = { GC: [[6, 6], [7, 4], [9, 3]], AT: [[6, 6], [7, 4]] };

function basePair(OCL, p, q, meta) {
  const [s1, c1] = BASES[p], [s2, c2raw] = BASES[q];
  const c2 = c2raw.map(([x, y, z]) => [x, -y, -z]);    // the partner base, turned 180 degrees about x
  const mol = OCL.Molecule.fromSmiles(s1 + '.' + s2);
  const full = mol.getCompactCopy(); full.addImplicitHydrogens(); full.ensureHelperArrays(OCL.Molecule.cHelperRings);
  const n1 = c1.length, heavy = [...c1, ...c2];
  // hydrogens: a conformer of each base fitted onto the ideal heavy atoms
  const pos = new Array(full.getAllAtoms()).fill(null);
  heavy.forEach((p3, i) => { pos[i] = p3; });
  const frag = new Array(full.getAllAtoms()).fill(0); full.getFragmentNumbers(frag, false, false);
  for (const f of [frag[0], frag[n1]]) {
    const atoms = []; for (let i = 0; i < full.getAllAtoms(); i++) if (frag[i] === f) atoms.push(i);
    const c = fragCoords(OCL, full, atoms), hv = atoms.filter(i => i < heavy.length);
    const A = hv.map(i => c.get(i)), B = hv.map(i => heavy[i]), ca = mean(A), cb = mean(B);
    const R = horn(A.map(x => sub(x, ca)), B.map(x => sub(x, cb)));
    for (const i of atoms) if (i >= heavy.length) pos[i] = add(apply(R, sub(c.get(i), ca)), cb);
  }
  const mol3d = full.getCompactCopy();
  pos.forEach((p3, i) => { mol3d.setAtomX(i, p3[0]); mol3d.setAtomY(i, p3[1]); mol3d.setAtomZ(i, p3[2]); });
  const rec = recordFrom(OCL, full, { mol3d, meta, keepInput: true });
  rec.g3 = 'built';
  // 2D: the flat ideal pair, base 1 on the left, hydrogen bonds level
  const xs = heavy.map(p3 => -p3[1] / 1.4), ys = heavy.map(p3 => -p3[0] / 1.4);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  rec.p2 = encode2D(heavy.map((_, i) => [(xs[i] - cx) * 100, (ys[i] - cy) * 100]));
  rec.hb = HB[p + q].map(([a, b]) => [a, n1 + b]);
  return rec;
}
const encode2D = pts => encodeI16(pts.flat());
export function builtRecords(OCL) {
  return [
    basePair(OCL, 'G', 'C', { id: 'gc-base-pair', n: 'G–C base pair', c: 'nucleic', fam: true, d: 'Guanine and cytosine paired as in DNA: three hydrogen bonds hold the two bases edge to edge.', s: 'Cn1cnc2c(=O)[nH]c(N)nc12.Cn1c(=O)nc(N)cc1' }),
    basePair(OCL, 'A', 'T', { id: 'at-base-pair', n: 'A–T base pair', c: 'nucleic', d: 'Adenine and thymine paired as in DNA: two hydrogen bonds, one fewer than in a G–C pair.', s: 'Cn1cnc2c(N)ncnc12.Cn1c(=O)[nH]c(=O)c(C)c1' }),
  ];
}
