// ============================================================================
//  MOLECULES  ·  chem.js — the molecule model (no DOM, no THREE, no engine)
// ────────────────────────────────────────────────────────────────────────────
//  One record format for the library and for a molecule that the engine
//  (engine.js) makes from a SMILES string or a PubChem download. decode()
//  turns a record into the model that the views use. Node (build, tests)
//  and the browser both load this file.
//
//  RECORD (data/library.json "m" rows, and engine.js output)
//    id    slug              n     display name      c   category id
//    d     one-line text     cid   PubChem CID (0 = not from PubChem)
//    f     formula (PubChem) w     molar mass g/mol  iu  IUPAC name
//    s     isomeric SMILES   sy    synonyms          fam 1 = famous
//    a     element symbols of the shown atoms, space-separated
//    q     charges: [[atom, charge], ...]
//    h     the parent atom of each hidden hydrogen, in order
//    b     bonds between shown atoms, flat: [a, b, code, ...]
//          code = order (1, 2, 3; 0 a metal-ligand bond) + 10 * stereo
//          (1 wedge, 2 hash, 3 wavy) + 100 if aromatic. A wedge or hash
//          starts at atom a.
//    r     rings: [[aromatic 0|1, atom, atom, ...], ...]
//    p2    2D: base64 Int16 x, y per shown atom, 1/100 of a bond length
//    p3    3D: base64 Int16 x, y, z per atom (shown, then hidden H), in
//          1/100 angstrom
//    pr    [logP, H-bond donors, acceptors, rotatable bonds, stereocentres,
//           polar surface area]
//    g3    '' PubChem conformer, 'ocl' generated, 'built' metal geometry
//    hb    hydrogen bonds to draw: [[donor atom, acceptor atom], ...]
//    iso   isotopes [[atom, mass]]
//    rad   radicals [[atom, 1 doublet | 2 singlet | 3 triplet]] (molfile RAD codes)
//
//  MODEL (decode)
//    n shown atoms (heavy atoms and any H that must show, as in H2)
//    N all atoms; hidden hydrogens are n..N-1
//    z, q, sym, bonds [{a, b, o, ml, s, ar}], nb[i] = [{to, b}], hOf[i]
//    xy (2n), xyz (3N), rings
//
//  grep -n targets
//    element table ....... "export const ELEMENTS"
//    record -> model ..... "export function decode"
//    model -> molfile .... "export function toMolfile"
//    functional groups ... "export function findGroups"
//    2D hydrogen layout .. "export function placeHydrogens"
//    lone pairs .......... "export function lonePairs"
//    formula text ........ "export function formulaParts"
// ============================================================================

// ── element table ───────────────────────────────────────────────────────────
// Symbols 1..92, CPK (Jmol) colours, covalent radii (Cordero 2008) and van
// der Waals radii (Bondi; Alvarez 2013 for metals), in angstrom.
const SYMS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re ' +
  'Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U').split(' ');
const COLOR = { H: '#ffffff', He: '#d9ffff', Li: '#cc80ff', Be: '#c2ff00', B: '#ffb5b5', C: '#8c929c', N: '#3d5cf5', O: '#f0281e',
  F: '#90e050', Ne: '#b3e3f5', Na: '#ab5cf2', Mg: '#8aff00', Al: '#bfa6a6', Si: '#f0c8a0', P: '#ff8000', S: '#ffd930', Cl: '#1ff01f',
  Ar: '#80d1e3', K: '#8f40d4', Ca: '#3dff00', Ti: '#bfc2c7', V: '#a6a6ab', Cr: '#8a99c7', Mn: '#9c7ac7', Fe: '#e06633', Co: '#f090a0',
  Ni: '#50d050', Cu: '#c88033', Zn: '#7d80b0', Ga: '#c28f8f', Ge: '#668f8f', As: '#bd80e3', Se: '#ffa100', Br: '#a62929', Kr: '#5cb8d1',
  Rb: '#702eb0', Sr: '#00ff00', Zr: '#94e0e0', Mo: '#54b5b5', Ru: '#248f8f', Rh: '#0a7d8c', Pd: '#006985', Ag: '#c0c0c0', Cd: '#ffd98f',
  Sn: '#668080', Sb: '#9e63b5', Te: '#d47a00', I: '#940094', Xe: '#429eb0', Cs: '#57178f', Ba: '#00c900', Gd: '#45ffc7', W: '#2194d6',
  Os: '#266696', Ir: '#175487', Pt: '#d0d0e0', Au: '#ffd123', Hg: '#b8b8d0', Tl: '#a6544d', Pb: '#575961', Bi: '#9e4fb5', U: '#008fff' };
const COV = { H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58, Na: 1.66, Mg: 1.41, Al: 1.21,
  Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Ti: 1.60, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24,
  Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.20, As: 1.19, Se: 1.20, Br: 1.20, Kr: 1.16, Rb: 2.20, Sr: 1.95, Zr: 1.75, Mo: 1.54, Ru: 1.46,
  Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.40, Cs: 2.44, Ba: 2.15, Gd: 1.96, W: 1.62,
  Os: 1.44, Ir: 1.41, Pt: 1.36, Au: 1.36, Hg: 1.32, Tl: 1.45, Pb: 1.46, Bi: 1.48, U: 1.96 };
const VDW = { H: 1.20, He: 1.40, Li: 1.82, Be: 1.53, B: 1.92, C: 1.70, N: 1.55, O: 1.52, F: 1.47, Ne: 1.54, Na: 2.27, Mg: 1.73, Al: 1.84,
  Si: 2.10, P: 1.80, S: 1.80, Cl: 1.75, Ar: 1.88, K: 2.75, Ca: 2.31, Se: 1.90, Br: 1.85, Kr: 2.02, I: 1.98, Xe: 2.16, As: 1.85,
  Fe: 2.04, Co: 2.00, Ni: 1.97, Cu: 1.96, Zn: 2.01, Pt: 2.13, Pd: 2.10, Hg: 2.23, Pb: 2.02, Sn: 2.17, Cr: 2.06, Ti: 2.11, Ru: 2.13 };

// Standard atomic weights at full precision: the table that fits the
// PubChem masses best. It is not the table that PubChem uses. For an
// element that IUPAC changed to an interval in 2009-2011 (H, Li, B, C, N,
// O, Si, S, Cl, Tl), it keeps the last single value, from the 2007 table
// (Wieser and Berglund 2009). For Se (78.971) and Mo (95.95) it uses the
// IUPAC 2013 value: the Se8 and Mo(CO)6 records need them. A review found
// that the rounded sum agrees with 506 of 546 C/H/N/O/S/Cl/I/Se records
// (CS2: 76.1407 against PubChem 76.15). Small molecules that PubChem
// prints to 3 decimals can differ by about 0.0005. With this
// table, the sum for each of the 749 PubChem records of the build cache
// with a 2-decimal mass and no isotope label is within 0.0093 g/mol of
// PubChem. The 5-figure conventional values (C 12.011, H 1.008, S 32.07,
// I 126.9) gave differences up to 0.014. molarMass() uses this table.
const WEIGHT = { H: 1.00794, He: 4.002602, Li: 6.941, Be: 9.012182, B: 10.811, C: 12.0107, N: 14.0067, O: 15.9994, F: 18.9984032,
  Ne: 20.1797, Na: 22.98976928, Mg: 24.305, Al: 26.9815386, Si: 28.0855, P: 30.973762, S: 32.065, Cl: 35.453, Ar: 39.948, K: 39.0983,
  Ca: 40.078, Ti: 47.867, V: 50.9415, Cr: 51.9961, Mn: 54.938045, Fe: 55.845, Co: 58.933195, Ni: 58.6934, Cu: 63.546, Zn: 65.38,
  Ga: 69.723, Ge: 72.63, As: 74.9216, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.4678, Sr: 87.62, Zr: 91.224, Mo: 95.95, Ru: 101.07,
  Rh: 102.9055, Pd: 106.42, Ag: 107.8682, Cd: 112.411, Sn: 118.71, Sb: 121.76, Te: 127.6, I: 126.90447, Xe: 131.293, Cs: 132.9054519,
  Ba: 137.327, Gd: 157.25, W: 183.84, Os: 190.23, Ir: 192.217, Pt: 195.084, Au: 196.966569, Hg: 200.59, Tl: 204.3833, Pb: 207.2,
  Bi: 208.9804, Rn: 222.018, U: 238.02891 };
export const ELEMENTS = SYMS.map((s, i) => ({ z: i + 1, sym: s, color: COLOR[s] || '#ff1493', cov: COV[s] || 1.5, vdw: VDW[s] || 2.0 }));
export const Z = Object.fromEntries(SYMS.map((s, i) => [s, i + 1]));
export const el = z => ELEMENTS[z - 1] || { z, sym: '?', color: '#ff1493', cov: 1.5, vdw: 2.0 };
const METALS = new Set([3, 4, 11, 12, 13, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
  55, 56, 57, 58, 59, 60, 64, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 92]);
export const isMetal = z => METALS.has(z);

// Molar mass in g/mol from the model's atoms (isotopes by their mass number).
export function molarMass(M) {
  let w = 0;
  for (let i = 0; i < M.N; i++) { const m = M.iso && M.iso.get(i); w += m ? (M.z[i] === 1 ? [0, 1.008, 2.014, 3.016][m] || m : m) : (WEIGHT[M.sym[i]] || 0); }
  return w;
}

// ── categories ──────────────────────────────────────────────────────────────
export const CATEGORIES = [
  ['famous', 'Famous molecules'], ['everyday', 'Everyday chemicals'], ['solvents', 'Solvents'], ['gases', 'Gases'],
  ['elements', 'Elements as molecules'], ['groups', 'Functional groups'], ['amino', 'Amino acids'],
  ['nucleic', 'Nucleobases and nucleotides'], ['sugars', 'Sugars'], ['lipids', 'Lipids and fatty acids'],
  ['vitamins', 'Vitamins'], ['metabolism', 'Metabolism and cofactors'], ['hormones', 'Hormones and neurotransmitters'],
  ['drugs', 'Pharmaceuticals'], ['alkaloids', 'Alkaloids and natural products'], ['toxins', 'Toxins'],
  ['dyes', 'Dyes and pigments'], ['monomers', 'Polymer building blocks'], ['aromatics', 'Aromatics and PAHs'],
  ['nano', 'Fullerenes and nanostructures'], ['inorganic', 'Inorganic and organometallic'], ['flavours', 'Flavours and fragrances'],
  ['custom', 'Your molecules'],
];
export const CAT_NAME = Object.fromEntries(CATEGORIES);

// ── base64 Int16 ────────────────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64I = new Int16Array(128); for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
export function encodeI16(vals) {
  const bytes = new Uint8Array(vals.length * 2);
  vals.forEach((v, i) => { const x = Math.max(-32768, Math.min(32767, Math.round(v))) & 0xffff; bytes[2 * i] = x & 255; bytes[2 * i + 1] = x >> 8; });
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < bytes.length ? B64[c & 63] : '=');
  }
  return s;
}
export function decodeI16(s, scale) {
  const n = Math.floor(s.replace(/=+$/, '').length * 3 / 4), bytes = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64I[s.charCodeAt(i)], b = B64I[s.charCodeAt(i + 1)], c = B64I[s.charCodeAt(i + 2)], d = B64I[s.charCodeAt(i + 3)];
    if (k < n) bytes[k++] = (a << 2) | (b >> 4);
    if (k < n) bytes[k++] = ((b & 15) << 4) | (c >> 2);
    if (k < n) bytes[k++] = ((c & 3) << 6) | d;
  }
  const out = new Float32Array(n >> 1);
  for (let i = 0; i < out.length; i++) { let v = bytes[2 * i] | (bytes[2 * i + 1] << 8); if (v > 32767) v -= 65536; out[i] = v * scale; }
  return out;
}

// ── record -> model ─────────────────────────────────────────────────────────
export function decode(rec) {
  const sym = rec.a ? rec.a.split(' ') : [];
  const n = sym.length, hp = rec.h || [], N = n + hp.length;
  const z = new Int16Array(N), q = new Int8Array(N);
  sym.forEach((s, i) => { z[i] = Z[s] || 0; });
  for (let i = n; i < N; i++) z[i] = 1;
  for (const [i, c] of rec.q || []) q[i] = c;
  const bonds = [];
  const B = rec.b || [];
  for (let i = 0; i < B.length; i += 3) {
    const c = B[i + 2];
    const o = c % 10;
    bonds.push({ a: B[i], b: B[i + 1], o: o || 1, ml: o === 0, s: Math.floor(c / 10) % 10, ar: c >= 100 });
  }
  const nShown = bonds.length;
  hp.forEach((p, k) => bonds.push({ a: p, b: n + k, o: 1, s: 0, ar: false, h: true }));
  const nb = Array.from({ length: N }, () => []);
  bonds.forEach((bd, i) => { nb[bd.a].push({ to: bd.b, b: i }); nb[bd.b].push({ to: bd.a, b: i }); });
  const hOf = Array.from({ length: N }, () => []);
  hp.forEach((p, k) => hOf[p].push(n + k));
  const xy = rec.p2 ? decodeI16(rec.p2, 0.01) : new Float32Array(2 * n);
  const xyz = rec.p3 ? decodeI16(rec.p3, 0.01) : null;
  const rings = (rec.r || []).map(r => ({ arom: !!r[0], atoms: r.slice(1) }));
  const pr = rec.pr || [];
  return {
    rec, id: rec.id, name: rec.n, cat: rec.c, desc: rec.d || '', cid: rec.cid || 0, formula: rec.f || '', mw: rec.w || 0,
    iupac: rec.iu || '', smiles: rec.s || '', syn: rec.sy || [], famous: !!rec.fam, gen3d: rec.g3 || '',
    iso: new Map(rec.iso || []), rad: new Map(rec.rad || []),
    n, N, z, q, sym: Array.from(z, v => el(v).sym), bonds, nShown, nb, hOf, xy, xyz, rings, hb: rec.hb || [],
    props: { logP: pr[0], hbd: pr[1], hba: pr[2], rot: pr[3], stereo: pr[4], tpsa: pr[5] },
  };
}

// The bond between atoms a and b, or -1.
export function bondBetween(M, a, b) {
  for (const e of M.nb[a]) if (e.to === b) return e.b;
  return -1;
}

// Heavy-atom degree and hydrogen count of each shown atom.
export function hCount(M, i) {
  let h = M.hOf[i].length;
  for (const e of M.nb[i]) if (e.to < M.n && M.z[e.to] === 1 && M.bonds[e.b].o) h += 0; // shown H are drawn as atoms
  return h;
}

// ── formula ─────────────────────────────────────────────────────────────────
// Hill order (C, H, then A..Z; no C: all alphabetical). Returns [[sym, n]].
export function formulaCounts(M) {
  const c = {};
  for (let i = 0; i < M.N; i++) { const s = M.sym[i]; c[s] = (c[s] || 0) + 1; }
  const keys = Object.keys(c).sort();
  const order = c.C ? ['C', ...(c.H ? ['H'] : []), ...keys.filter(k => k !== 'C' && k !== 'H')] : keys;
  return order.map(k => [k, c[k]]);
}
// "C8H10N4O2" -> [['C',8],['H',10],...] and a charge; for HTML subscripts.
export function formulaParts(f) {
  const out = [];
  const m = String(f).match(/([A-Z][a-z]?)(\d*)|([+-]\d*|\d*[+-])/g) || [];
  for (const t of m) {
    if (/^[A-Z]/.test(t)) { const [, s, d] = t.match(/([A-Z][a-z]?)(\d*)/); out.push([s, d ? +d : 1]); }
    else out.push(['charge', t]);
  }
  return out;
}
export function formulaHTML(f) {
  return formulaParts(f).map(([s, v]) => s === 'charge' ? `<sup>${v.replace('-', '−')}</sup>` : s + (v > 1 ? `<sub>${v}</sub>` : '')).join('');
}

// ── molfile ─────────────────────────────────────────────────────────────────
// A V2000 molfile of the whole molecule (hidden H included), with 3D
// coordinates when the model has them, else the 2D layout in angstrom.
export function toMolfile(M, opts = {}) {
  const use3 = M.xyz && opts.dim !== 2;
  const NA = opts.noH ? M.n : M.N, bonds = opts.noH ? M.bonds.slice(0, M.nShown) : M.bonds;
  const P = i => use3 ? [M.xyz[3 * i], M.xyz[3 * i + 1], M.xyz[3 * i + 2]]
    : i < M.n ? [M.xy[2 * i] * 1.5, -M.xy[2 * i + 1] * 1.5, 0] : (() => { const h = placeHydrogens(M); return [h.xy[2 * i] * 1.5, -h.xy[2 * i + 1] * 1.5, 0]; })();
  const f = (v, w) => v.toFixed(4).padStart(w);
  const d = (v, w) => String(v).padStart(w);
  const lines = [M.name || 'molecule', `  davesgames ${use3 ? '3D' : '2D'}`, M.cid ? `PubChem CID ${M.cid}` : ''];
  lines.push(`${d(NA, 3)}${d(bonds.length, 3)}  0  0  ${M.props && M.props.stereo ? 1 : 0}  0  0  0  0  0999 V2000`);
  const chg = { 3: 1, 2: 2, 1: 3, [-1]: 5, [-2]: 6, [-3]: 7 };
  for (let i = 0; i < NA; i++) {
    const p = P(i);
    lines.push(`${f(p[0], 10)}${f(p[1], 10)}${f(p[2], 10)} ${M.sym[i].padEnd(3)} 0${d(chg[M.q[i]] || 0, 3)}  0  0  0  0  0  0  0  0  0  0`);
  }
  for (const b of bonds) lines.push(`${d(b.a + 1, 3)}${d(b.b + 1, 3)}${d(b.ml ? 9 : b.o || 1, 3)}${d(use3 ? 0 : [0, 1, 6, 4][b.s], 3)}  0  0  0`);
  const qs = []; for (let i = 0; i < NA; i++) if (M.q[i]) qs.push([i + 1, M.q[i]]);
  for (let i = 0; i < qs.length; i += 8) {
    const part = qs.slice(i, i + 8);
    lines.push(`M  CHG${d(part.length, 3)}` + part.map(([a, c]) => `${d(a, 4)}${d(c, 4)}`).join(''));
  }
  for (const [key, map] of [['ISO', M.iso], ['RAD', M.rad]]) {
    const e = [...(map || [])].filter(([a]) => a < NA);
    for (let i = 0; i < e.length; i += 8) lines.push(`M  ${key}${d(e.slice(i, i + 8).length, 3)}` + e.slice(i, i + 8).map(([a, v]) => `${d(a + 1, 4)}${d(v, 4)}`).join(''));
  }
  lines.push('M  END');
  return lines.join('\n') + '\n';
}
export function toSDF(M) {
  const tags = [['PUBCHEM_COMPOUND_CID', M.cid || ''], ['NAME', M.name], ['FORMULA', M.formula], ['MOLAR_MASS', M.mw], ['SMILES', M.smiles]];
  return toMolfile(M) + tags.filter(t => t[1] !== '').map(([k, v]) => `> <${k}>\n${v}\n`).join('\n') + '\n$$$$\n';
}

// ── 2D hydrogens ────────────────────────────────────────────────────────────
// Positions for the hidden hydrogens in the 2D layout (bond length 1): each
// H goes in the widest free angle round its atom. Returns { xy } for all N
// atoms (shown atoms keep their layout). Cached on the model.
export function placeHydrogens(M) {
  if (M._h2) return M._h2;
  const xy = new Float32Array(2 * M.N);
  xy.set(M.xy.subarray(0, 2 * M.n));
  for (let i = 0; i < M.n; i++) {
    const hs = M.hOf[i]; if (!hs.length) continue;
    const dirs = freeDirections(M, i, hs.length);
    hs.forEach((h, k) => { xy[2 * h] = M.xy[2 * i] + Math.cos(dirs[k]) * 0.8; xy[2 * h + 1] = M.xy[2 * i + 1] + Math.sin(dirs[k]) * 0.8; });
  }
  return (M._h2 = { xy });
}
// Angles of the shown bonds round atom i.
export function bondAngles(M, i) {
  const out = [];
  for (const e of M.nb[i]) if (e.to < M.n) out.push(Math.atan2(M.xy[2 * e.to + 1] - M.xy[2 * i + 1], M.xy[2 * e.to] - M.xy[2 * i]));
  return out;
}
// k new directions that spread into the free angles round atom i.
export function freeDirections(M, i, k, extra = []) {
  const used = bondAngles(M, i).concat(extra);
  const out = [];
  if (!used.length) {
    // no bonds: H2O-like or CH4-like fans; a single H to the right
    const base = k === 1 ? 0 : k === 2 ? -Math.PI / 6 : -Math.PI / 2;
    for (let j = 0; j < k; j++) out.push(k === 2 ? (j ? Math.PI + Math.PI / 6 : -Math.PI / 6) : base + j * 2 * Math.PI / k);
    return out;
  }
  if (used.length === 1) {
    const a = used[0], m = k + 1;
    if (k === 1) return [a + Math.PI];
    for (let j = 1; j <= k; j++) out.push(a + j * 2 * Math.PI / m);
    return out;
  }
  // two or more bonds: split the widest gap each time
  const angs = used.map(a => (a + 2 * Math.PI) % (2 * Math.PI));
  for (let j = 0; j < k; j++) {
    angs.sort((x, y) => x - y);
    let best = 0, gap = -1;
    for (let t = 0; t < angs.length; t++) {
      const g = (t + 1 < angs.length ? angs[t + 1] : angs[0] + 2 * Math.PI) - angs[t];
      if (g > gap + 1e-6) { gap = g; best = t; }
    }
    // k hydrogens into one gap: spread them evenly across it
    const a0 = angs[best], share = gap / (k - j + 1);
    const a = (a0 + share) % (2 * Math.PI);
    out.push(a); angs.push(a);
  }
  return out;
}

// ── lone pairs ──────────────────────────────────────────────────────────────
const VALENCE_E = { 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 14: 4, 15: 5, 16: 6, 17: 7, 33: 5, 34: 6, 35: 7, 53: 7, 54: 8, 2: 2, 10: 8, 18: 8, 36: 8 };
export function lonePairs(M, i) {
  const ve = VALENCE_E[M.z[i]]; if (ve == null) return 0;
  let used = 0; for (const e of M.nb[i]) used += M.bonds[e.b].o || 1;
  const left = ve - M.q[i] - used;
  return Math.max(0, Math.floor(left / 2));
}

// ── rings ───────────────────────────────────────────────────────────────────
export function ringBonds(M) {
  if (M._rb) return M._rb;
  const inRing = new Map();
  M.rings.forEach((r, k) => {
    for (let t = 0; t < r.atoms.length; t++) {
      const b = bondBetween(M, r.atoms[t], r.atoms[(t + 1) % r.atoms.length]);
      if (b >= 0) { if (!inRing.has(b)) inRing.set(b, []); inRing.get(b).push(k); }
    }
  });
  return (M._rb = inRing);
}

// ── functional groups ───────────────────────────────────────────────────────
// Finds groups on the model graph. Returns [{ id, name, atoms: [...] }] with
// shown-atom indices (hydrogens count through hOf). Each group instance
// is reported once. Order of tests: the larger groups first, and atoms that
// a larger group owns are not reused by a smaller group of the same family.
export const GROUPS = [
  ['carboxylic', 'Carboxylic acid', '#e4572e'], ['ester', 'Ester', '#f29e4c'], ['amide', 'Amide', '#c97b2a'],
  ['anhydride', 'Anhydride', '#d1495b'], ['acylhalide', 'Acyl halide', '#b33f62'], ['aldehyde', 'Aldehyde', '#ffb400'],
  ['ketone', 'Ketone', '#f6c85f'], ['hydroxyl', 'Hydroxyl (alcohol)', '#4cc9f0'], ['phenol', 'Phenol', '#3a86ff'],
  ['ether', 'Ether', '#7bdff2'], ['amine', 'Amine', '#4361ee'], ['nitrile', 'Nitrile', '#8338ec'], ['nitro', 'Nitro', '#9d4edd'],
  ['imine', 'Imine', '#6a4c93'], ['thiol', 'Thiol', '#e9c46a'], ['sulfide', 'Sulfide', '#d4a017'], ['disulfide', 'Disulfide', '#b5838d'],
  ['sulfonyl', 'Sulfonyl', '#c9a227'], ['phosphate', 'Phosphate', '#ff7f11'], ['halide', 'Halide', '#57cc99'],
  ['alkene', 'Alkene', '#80ed99'], ['alkyne', 'Alkyne', '#38b000'], ['aromatic', 'Aromatic ring', '#ff5d8f'],
];
export const GROUP_INFO = Object.fromEntries(GROUPS.map(([id, name, color]) => [id, { name, color }]));

export function findGroups(M) {
  const out = [];
  const n = M.n, z = M.z;
  const H = i => M.hOf[i].length + M.nb[i].filter(e => z[e.to] === 1 && e.to < n).length;
  const heavy = i => M.nb[i].filter(e => z[e.to] !== 1);
  const order = (a, b) => { const k = bondBetween(M, a, b); return k < 0 ? 0 : M.bonds[k].o; };
  const isArom = i => M.rings.some(r => r.arom && r.atoms.includes(i));
  const dbl = (i, Zt) => heavy(i).filter(e => z[e.to] === Zt && M.bonds[e.b].o === 2 && !M.bonds[e.b].ar).map(e => e.to);
  const sgl = (i, Zt) => heavy(i).filter(e => z[e.to] === Zt && M.bonds[e.b].o === 1).map(e => e.to);
  const taken = new Set();
  const add = (id, atoms) => { out.push({ id, name: GROUP_INFO[id].name, atoms }); };

  // carbonyl families
  for (let c = 0; c < n; c++) {
    if (z[c] !== 6 || isArom(c)) continue;
    const oD = dbl(c, 8); if (oD.length !== 1) continue;
    const o = oD[0];
    if (heavy(o).length !== 1) continue;
    const others = heavy(c).filter(e => e.to !== o);
    const oS = others.filter(e => z[e.to] === 8 && M.bonds[e.b].o === 1).map(e => e.to);
    const nS = others.filter(e => z[e.to] === 7 && M.bonds[e.b].o === 1).map(e => e.to);
    const xS = others.filter(e => [9, 17, 35, 53].includes(z[e.to])).map(e => e.to);
    if (oS.length === 1 && others.length + H(c) <= 2) {
      const os = oS[0];
      if (H(os) === 1 && heavy(os).length === 1 && !M.q[os]) { add('carboxylic', [c, o, os]); taken.add(o); taken.add(os); continue; }
      if (M.q[os] === -1 && heavy(os).length === 1) { add('carboxylic', [c, o, os]); taken.add(o); taken.add(os); continue; }
      const r = heavy(os).find(e => e.to !== c);
      if (r && z[r.to] === 6) {
        const r2 = r.to;
        if (dbl(r2, 8).length === 1 && !isArom(r2)) { if (!taken.has(os)) { add('anhydride', [c, o, os, r2, dbl(r2, 8)[0]]); [o, os, r2].forEach(a => taken.add(a)); } continue; }
        add('ester', [c, o, os]); taken.add(o); taken.add(os); continue;
      }
    }
    if (nS.length >= 1 && oS.length === 0) { add('amide', [c, o, nS[0]]); taken.add(o); taken.add(nS[0]); continue; }
    if (xS.length === 1 && oS.length === 0 && nS.length === 0) { add('acylhalide', [c, o, xS[0]]); taken.add(o); taken.add(xS[0]); continue; }
    const cN = others.filter(e => z[e.to] === 6 || z[e.to] === 1).length;
    if (oS.length || nS.length || xS.length || others.some(e => z[e.to] === 16)) continue;
    if (H(c) >= 1) { add('aldehyde', [c, o]); taken.add(o); continue; }
    if (cN === 2) { add('ketone', [c, o]); taken.add(o); }
  }
  // O single-bonded families
  for (let o = 0; o < n; o++) {
    if (z[o] !== 8 || taken.has(o) || M.q[o]) continue;
    const hv = heavy(o);
    if (hv.some(e => M.bonds[e.b].o !== 1)) continue;
    if (hv.length === 1 && H(o) === 1) {
      const c = hv[0].to;
      if (z[c] !== 6) continue;
      if (dbl(c, 8).length || dbl(c, 7).length) continue;
      add(isArom(c) ? 'phenol' : 'hydroxyl', [o, c]);
    } else if (hv.length === 2 && hv.every(e => z[e.to] === 6)) {
      if (hv.some(e => dbl(e.to, 8).length)) continue;
      add('ether', [hv[0].to, o, hv[1].to]);
    }
  }
  // nitrogen
  for (let nI = 0; nI < n; nI++) {
    if (z[nI] !== 7 || taken.has(nI)) continue;
    const hv = heavy(nI);
    const os = hv.filter(e => z[e.to] === 8);
    if (os.length === 2 && hv.length === 3) { add('nitro', [nI, ...os.map(e => e.to)]); os.forEach(e => taken.add(e.to)); continue; }
    if (hv.length === 1 && M.bonds[hv[0].b].o === 3 && z[hv[0].to] === 6) { add('nitrile', [hv[0].to, nI]); continue; }
    if (hv.some(e => M.bonds[e.b].o === 2 && z[e.to] === 6 && !M.bonds[e.b].ar) && !isArom(nI)) { const c = hv.find(e => M.bonds[e.b].o === 2).to; add('imine', [c, nI]); continue; }
    if (isArom(nI)) continue;
    if (hv.every(e => M.bonds[e.b].o === 1) && hv.length <= 3 && hv.every(e => z[e.to] === 6 || z[e.to] === 1)) {
      // not an amide N (C bonded to C=O), not a nitrile
      if (hv.some(e => dbl(e.to, 8).length || dbl(e.to, 16).length || dbl(e.to, 7).length)) continue;
      add('amine', [nI, ...hv.map(e => e.to)]);
    }
  }
  // sulfur
  for (let s = 0; s < n; s++) {
    if (z[s] !== 16) continue;
    const hv = heavy(s), od = dbl(s, 8);
    if (od.length >= 2) { add('sulfonyl', [s, ...od]); continue; }
    if (isArom(s)) continue;
    if (hv.length === 1 && H(s) === 1) { add('thiol', [s, hv[0].to]); continue; }
    const sS = hv.filter(e => z[e.to] === 16);
    if (sS.length === 1 && s < sS[0].to) { add('disulfide', [s, sS[0].to]); continue; }
    if (hv.length === 2 && hv.every(e => z[e.to] === 6 && M.bonds[e.b].o === 1)) add('sulfide', [hv[0].to, s, hv[1].to]);
  }
  // phosphate
  for (let p = 0; p < n; p++) {
    if (z[p] !== 15) continue;
    const os = heavy(p).filter(e => z[e.to] === 8);
    if (os.length === 4) add('phosphate', [p, ...os.map(e => e.to)]);
  }
  // halides on carbon (acyl halides are already taken)
  for (let x = 0; x < n; x++) {
    if (![9, 17, 35, 53].includes(z[x]) || taken.has(x)) continue;
    const hv = heavy(x); if (hv.length === 1 && z[hv[0].to] === 6) add('halide', [x, hv[0].to]);
  }
  // C=C and C#C outside aromatic rings
  for (let k = 0; k < M.nShown; k++) {
    const b = M.bonds[k];
    if (b.ar || z[b.a] !== 6 || z[b.b] !== 6) continue;
    if (isArom(b.a) && isArom(b.b)) continue;
    if (b.o === 2) add('alkene', [b.a, b.b]);
    else if (b.o === 3) add('alkyne', [b.a, b.b]);
  }
  // aromatic rings
  for (const r of M.rings) if (r.arom) add('aromatic', r.atoms.slice());
  return out;
}

// Plain text of a stereo descriptor list (count).
export function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
