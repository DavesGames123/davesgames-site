// ============================================================================
//  MOLECULES  ·  engine.js — OpenChemLib to a chem.js record
// ────────────────────────────────────────────────────────────────────────────
//  The chemistry engine is OpenChemLib JS 9.25.1 (vendor/openchemlib@9.25.1,
//  BSD-3). The library does not need it: data/library.json already holds
//  the 2D layout, the 3D coordinates and the properties. The page loads the
//  engine (1.1 MB, and 1.35 MB of force-field tables) only when a user
//  types a SMILES string or loads a molecule from PubChem.
//  build/build.mjs and tests.mjs call the same functions in Node.
//
//  recordFrom(OCL, mol, opts)  one Molecule (explicit H optional) -> record
//      opts.mol3d   a Molecule with 3D coordinates for the same atoms
//                   (a PubChem conformer); else a conformer is generated
//      opts.meta    { id, n, c, d, cid, f, w, iu, s, sy, fam }
//      opts.inputLayout  true: mol has 2D coordinates that may be used
//      opts.keepInput    true: never replace mol by the meta.s SMILES
//  loadEngine()     browser: import the module, register the resources
//  fromSmiles(s)    browser: parse, lay out, generate 3D -> record
//  fromPubChem(q)   browser: name, CID or SMILES lookup at PubChem
//                   (PUG-REST sends Access-Control-Allow-Origin: *)
//
//  grep -n targets: "export function recordFrom", "function layout2D",
//  "function coords3D", "export async function fromPubChem"
// ============================================================================
import { encodeI16, slug } from './chem.js';

const VENDOR = '../../vendor/openchemlib@9.25.1/dist/';

// ── record from a Molecule ──────────────────────────────────────────────────
export function recordFrom(OCL, mol, opts = {}) {
  const M = OCL.Molecule;
  let full = mol.getCompactCopy();
  // parities first, from the input's own coordinates and wedges: a layout
  // computed before them can flip a stereocentre (seen on pregabalin)
  full.ensureHelperArrays(M.cHelperParities);
  full.addImplicitHydrogens();
  full.ensureHelperArrays(M.cHelperParities);
  let useInput = !!opts.inputLayout;
  // When the 2D record reads as a different stereoisomer than its own
  // SMILES (OpenChemLib misreads a few explicit-H wedges in crowded
  // polycycles: grayanotoxin I, okadaic acid), take the stereo from the
  // 3D conformer of the same atoms when that one agrees.
  // With no conformer, the SMILES itself becomes the structure (its atom
  // order does not matter then: the conformer is generated from it).
  const meta0 = opts.meta || {};
  let mol3d = opts.mol3d;
  if (meta0.s && !opts.keepInput) {
    const heavyId = m => { const x = m.getCompactCopy(); x.removeExplicitHydrogens(); x.ensureHelperArrays(M.cHelperParities); return x.getIDCode(); };
    let sm = null; try { sm = OCL.Molecule.fromSmiles(meta0.s); } catch (e) { sm = null; }
    const ref = sm && sm.getAllAtoms() ? sm.getIDCode() : null;
    if (ref && heavyId(full) !== ref) {
      const f3 = mol3d && sameAtoms(full, mol3d) ? mol3d.getCompactCopy() : null;
      if (f3) f3.ensureHelperArrays(M.cHelperParities);
      if (f3 && heavyId(f3) === ref) { full = f3; useInput = false; }
      else if (!f3) { sm.addImplicitHydrogens(); sm.ensureHelperArrays(M.cHelperParities); full = sm; useInput = false; mol3d = null; }
    }
  }
  // 2D: the heavy-atom copy, laid out by the CoordinateInventor
  const c = layout2D(OCL, full, useInput);
  const n = c.getAllAtoms(), N = full.getAllAtoms();
  for (let i = 0; i < n; i++) if (c.getAtomicNo(i) !== full.getAtomicNo(i)) throw new Error('atom order changed in the 2D copy at ' + i);
  for (let i = n; i < N; i++) if (full.getAtomicNo(i) !== 1) throw new Error('a hidden atom is not hydrogen: ' + i);
  // 3D
  const g = coords3D(OCL, full, mol3d);
  // shown atoms
  const a = [], q = [], iso = [], rad = [];
  for (let i = 0; i < n; i++) {
    a.push(c.getAtomLabel(i));
    const ch = c.getAtomCharge(i); if (ch) q.push([i, ch]);
    const ms = c.getAtomMass(i); if (ms) iso.push([i, ms]);
    const rd = c.getAtomRadical(i); if (rd) rad.push([i, rd === OCL.Molecule.cAtomRadicalStateD ? 1 : rd === OCL.Molecule.cAtomRadicalStateS ? 2 : 3]);
  }
  // bonds between shown atoms, from the 2D copy (stereo bonds belong to it)
  const b = [];
  for (let k = 0; k < c.getAllBonds(); k++) {
    let i = c.getBondAtom(0, k), j = c.getBondAtom(1, k);
    const t = c.getBondType(k);
    let st = 0;
    if (t === M.cBondTypeUp) st = 1; else if (t === M.cBondTypeDown) st = 2;
    else if (t === M.cBondTypeCross) st = 0;
    // order 0 marks a metal-ligand (dative) bond: drawn dashed, and a
    // molfile writes it as bond type 9
    const o = t === M.cBondTypeMetalLigand ? 0 : c.getBondOrder(k);
    const ar = c.isAromaticBond(k) ? 100 : 0;
    b.push(i, j, o + 10 * st + ar);
  }
  // hidden hydrogens: their parent atoms
  const h = [];
  for (let i = n; i < N; i++) h.push(full.getConnAtom(i, 0));
  // rings
  const rs = c.getRingSet(), r = [];
  for (let k = 0; k < rs.getSize(); k++) r.push([rs.isAromatic(k) ? 1 : 0, ...rs.getRingAtoms(k)]);
  // 2D coordinates: mean bond length 1, centred; molfile y is up, the
  // model y is down (SVG)
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) { xs.push(c.getAtomX(i)); ys.push(c.getAtomY(i)); }
  let bl = 0, nb = 0;
  for (let k = 0; k < c.getAllBonds(); k++) { const i = c.getBondAtom(0, k), j = c.getBondAtom(1, k); bl += Math.hypot(xs[i] - xs[j], ys[i] - ys[j]); nb++; }
  bl = nb ? bl / nb : 1;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const ySign = c.getAtomY !== undefined && yIsDown(OCL) ? 1 : -1;
  const p2 = []; for (let i = 0; i < n; i++) p2.push((xs[i] - cx) / bl * 100, ySign * (ys[i] - cy) / bl * 100);
  // 3D coordinates: centred on the centroid
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < N; i++) { mx += g.x[i]; my += g.y[i]; mz += g.z[i]; }
  mx /= N; my /= N; mz /= N;
  const p3 = []; for (let i = 0; i < N; i++) p3.push((g.x[i] - mx) * 100, (g.y[i] - my) * 100, (g.z[i] - mz) * 100);
  // properties
  let pr = [];
  try {
    const P = new OCL.MoleculeProperties(c);
    pr = [round(P.logP, 2), P.donorCount, P.acceptorCount, P.rotatableBondCount, P.stereoCenterCount, round(P.polarSurfaceArea, 1)];
  } catch (e) { pr = []; }
  const mf = full.getMolecularFormula();
  const meta = opts.meta || {};
  let smiles = meta.s;
  if (!smiles) { try { smiles = c.toIsomericSmiles(); } catch (e) { smiles = ''; } }
  const rec = {
    id: meta.id || slug(meta.n || smiles || 'molecule'), n: meta.n || smiles, c: meta.c || 'custom', d: meta.d || '',
    cid: meta.cid || 0, f: meta.f || mf.formula, w: meta.w || round(mf.relativeWeight, 2), iu: meta.iu || '', s: smiles,
    sy: meta.sy || [], a: a.join(' '), q, h, b, r, p2: encodeI16(p2), p3: encodeI16(p3), pr, g3: g.how,
  };
  if (meta.fam) rec.fam = 1;
  if (iso.length) rec.iso = iso;
  if (rad.length) rec.rad = rad;
  if (!q.length) delete rec.q;
  if (!r.length) delete rec.r;
  if (!h.length) delete rec.h;
  return rec;
}
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// OCL keeps screen coordinates (y down) inside and flips y in molfiles.
// Checked once on a two-atom molecule, so a future change shows up.
let _yDown = null;
function yIsDown(OCL) {
  if (_yDown != null) return _yDown;
  const m = OCL.Molecule.fromMolfile('\n\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    0.0000    1.0000    0.0000 O   0  0\n  1  2  1  0\n');
  return (_yDown = m.getAtomY(1) < m.getAtomY(0));
}

// Two candidate layouts: the CoordinateInventor, and the input's own 2D
// coordinates (a PubChem record) when it has them. A layout must draw the
// stereo it holds: its molfile, read back, must give the same ID code
// (a crowded polycycle can lose a centre to the inventor's wedges). Of the
// layouts that pass, the one with fewer bond crossings and atom clashes
// wins; a tie keeps the inventor.
function layout2D(OCL, full, useInput) {
  const c = full.getCompactCopy();
  c.removeExplicitHydrogens();
  c.ensureHelperArrays(OCL.Molecule.cHelperParities);   // keep the parities through the new layout
  const want = c.getIDCode();
  c.inventCoordinates();
  c.ensureHelperArrays(OCL.Molecule.cHelperParities);
  const drawn = x => { try { return OCL.Molecule.fromMolfile(x.toMolfile()).getIDCode() === want; } catch (e) { return false; } };
  const okC = drawn(c);
  if (!useInput) return c;
  const p = full.getCompactCopy();
  p.removeExplicitHydrogens();
  p.ensureHelperArrays(OCL.Molecule.cHelperParities);
  if (p.getAllAtoms() !== c.getAllAtoms() || p.getIDCode() !== want) return c;
  const okP = drawn(p);
  if (okC !== okP) return okC ? c : p;
  return clutter(p) < clutter(c) ? p : c;
}
// Bond crossings (x10) plus atom pairs closer than half a mean bond.
export function clutter(m) {
  const n = m.getAllAtoms(), B = m.getAllBonds();
  const X = i => m.getAtomX(i), Y = i => m.getAtomY(i);
  let bl = 0; for (let k = 0; k < B; k++) bl += Math.hypot(X(m.getBondAtom(0, k)) - X(m.getBondAtom(1, k)), Y(m.getBondAtom(0, k)) - Y(m.getBondAtom(1, k)));
  bl = B ? bl / B : 1;
  let s = 0;
  const cr = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((X(q) - X(p)) * (Y(r) - Y(p)) - (Y(q) - Y(p)) * (X(r) - X(p)));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let k = 0; k < B; k++) for (let l = k + 1; l < B; l++) {
    const a = m.getBondAtom(0, k), b = m.getBondAtom(1, k), c = m.getBondAtom(0, l), d = m.getBondAtom(1, l);
    if (a === c || a === d || b === c || b === d) continue;
    if (cr(a, b, c, d)) s += 10;
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(X(i) - X(j), Y(i) - Y(j)) < 0.5 * bl) s += 5;
  return s;
}

// 3D coordinates for every atom of full: the given conformer when its
// atoms match, else an OpenChemLib conformer cleaned with MMFF94s+.
function coords3D(OCL, full, mol3d) {
  const N = full.getAllAtoms();
  const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
  if (mol3d && sameAtoms(full, mol3d)) {
    for (let i = 0; i < N; i++) { x[i] = mol3d.getAtomX(i); y[i] = mol3d.getAtomY(i); z[i] = mol3d.getAtomZ(i); }
    return { x, y, z, how: '' };
  }
  // one conformer per fragment (a salt, an ion pair, a hydrate), set side
  // by side along x with a 2.6 A gap between their atoms
  const frag = new Array(N).fill(0);
  const nf = full.getFragmentNumbers(frag, false, true);
  let xoff = 0;
  for (let f = 0; f < nf; f++) {
    const atoms = []; for (let i = 0; i < N; i++) if (frag[i] === f) atoms.push(i);
    const c = conformerOf(OCL, full, atoms);
    let lo = Infinity, hi = -Infinity, cy = 0, cz = 0;
    for (const i of atoms) { const p = c.get(i); lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); cy += p[1] / atoms.length; cz += p[2] / atoms.length; }
    const shift = f === 0 ? 0 : xoff + 2.6 - lo;
    for (const i of atoms) { const p = c.get(i); x[i] = p[0] + shift; y[i] = p[1] - cy; z[i] = p[2] - cz; }
    xoff = hi + shift;
  }
  return { x, y, z, how: 'ocl' };
}

// A conformer of the atoms `atoms` of full (one fragment, or a ligand cut
// from a complex): Map(atom -> [x, y, z]). OpenChemLib copies the heavy
// atoms and adds its own hydrogens; each hydrogen of full takes the place
// of a conformer hydrogen on the same parent.
export function conformerOf(OCL, full, atoms) {
  const N = full.getAllAtoms(), out = new Map();
  const heavy = atoms.filter(i => full.getAtomicNo(i) !== 1 || full.getConnAtoms(i) === 0 && full.getAllConnAtomsPlusMetalBonds(i) === 0 || isPlainH(full, i) === false);
  if (heavy.length === 1 && atoms.length === 1) { out.set(atoms[0], [0, 0, 0]); return out; }
  // a diatomic fragment (CO, CN-, NO+): on the x axis, no conformer needed
  if (heavy.length === 2 && atoms.length === 2) {
    const [a, b] = heavy, bo = Math.max(1, full.getBondOrder(full.getBond(a, b)));
    const r = ((COVR[full.getAtomicNo(a)] || 1.2) + (COVR[full.getAtomicNo(b)] || 1.2)) * [1, 1, 0.9, 0.83][bo];
    out.set(a, [0, 0, 0]); out.set(b, [r, 0, 0]);
    return out;
  }
  const inc = new Array(N).fill(false); for (const i of heavy) inc[i] = true;
  const map = new Array(N).fill(-1), part = new OCL.Molecule(0, 0);
  full.copyMoleculeByAtoms(part, inc, true, map);
  // the copy comes out flagged as a query fragment, which gets no hydrogens
  part.setFragment(false);
  part.ensureHelperArrays(OCL.Molecule.cHelperNeighbours);
  const m = part.getCompactCopy();
  if (part.getAllAtoms() > 1 || atoms.length > 1) {
    if (!new OCL.ConformerGenerator(1).getOneConformerAsMolecule(m)) throw new Error('no conformer');
    try { new OCL.ForceFieldMMFF94(m, OCL.ForceFieldMMFF94.MMFF94SPLUS, {}).minimise({ maxIts: 4000 }); } catch (e) { /* metals: no MMFF types */ }
  }
  m.ensureHelperArrays(OCL.Molecule.cHelperNeighbours);
  const P = k => [m.getAtomX(k), m.getAtomY(k), m.getAtomZ(k)];
  for (const i of heavy) out.set(i, P(map[i]));
  // hydrogens by parent
  const pool = new Map();
  for (let k = 0; k < m.getAllAtoms(); k++) if (m.getAtomicNo(k) === 1 && m.getAllConnAtoms(k) === 1) {
    const p = m.getConnAtom(k, 0); if (!pool.has(p)) pool.set(p, []); pool.get(p).push(k);
  }
  for (const i of atoms) {
    if (out.has(i)) continue;
    const par = full.getConnAtom(i, 0), list = pool.get(map[par]) || [];
    const k = list.shift();
    if (k == null) throw new Error('conformer lacks a hydrogen on atom ' + par);
    out.set(i, P(k));
  }
  return out;
}
const COVR = { 1: 0.31, 6: 0.76, 7: 0.71, 8: 0.66, 9: 0.57, 15: 1.07, 16: 1.05, 17: 1.02, 35: 1.2, 53: 1.39 };
const isPlainH = (m, i) => m.getAtomicNo(i) === 1 && m.getAllConnAtoms(i) === 1 && m.getAtomCharge(i) === 0 && m.getAtomMass(i) === 0 && m.getAtomicNo(m.getConnAtom(i, 0)) !== 1;
function sameAtoms(a, b) {
  const N = a.getAllAtoms();
  if (b.getAllAtoms() !== N || b.getAllBonds() !== a.getAllBonds()) return false;
  for (let i = 0; i < N; i++) if (a.getAtomicNo(i) !== b.getAtomicNo(i)) return false;
  const key = (m, k) => { const i = m.getBondAtom(0, k), j = m.getBondAtom(1, k); return i < j ? i * 100000 + j : j * 100000 + i; };
  const s = new Set(); for (let k = 0; k < a.getAllBonds(); k++) s.add(key(a, k));
  for (let k = 0; k < b.getAllBonds(); k++) if (!s.has(key(b, k))) return false;
  return true;
}

// ── browser ─────────────────────────────────────────────────────────────────
let _ocl = null;
export function loadEngine() {
  if (_ocl) return _ocl;
  _ocl = (async () => {
    const OCL = await import(new URL(VENDOR + 'openchemlib.js', import.meta.url).href);
    await OCL.Resources.registerFromUrl(new URL(VENDOR + 'resources.json', import.meta.url).href);
    return OCL;
  })();
  _ocl.catch(() => { _ocl = null; });
  return _ocl;
}

export async function fromSmiles(smiles, meta = {}) {
  const OCL = await loadEngine();
  const mol = OCL.Molecule.fromSmiles(smiles.trim());
  if (!mol.getAllAtoms()) throw new Error('empty structure');
  const rec = recordFrom(OCL, mol, { meta: { s: smiles.trim(), n: meta.n || 'SMILES', c: 'custom', d: meta.d || 'Entered as a SMILES string. 2D layout and 3D conformer from OpenChemLib.' } });
  if (!meta.n) rec.n = 'Molecule ' + rec.f;
  let h = 0; for (const ch of smiles) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  rec.id = 'smiles-' + h.toString(36);
  return rec;
}
export async function fromMolfile(text, meta = {}) {
  const OCL = await loadEngine();
  const mol = OCL.Molecule.fromMolfile(text);
  return recordFrom(OCL, mol, { meta: { n: meta.n || mol.getName() || 'Molecule', c: 'custom', d: meta.d || 'Loaded from a molfile.' } });
}

// A PubChem lookup by name, CID ("cid:2519" or a number) or SMILES. The 2D
// record gives the stereo; the 3D conformer is used when PubChem has one.
const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
export async function fromPubChem(query) {
  const q = query.trim();
  let ns = 'name', val = q;
  if (/^(cid:)?\d+$/i.test(q)) { ns = 'cid'; val = q.replace(/^cid:/i, ''); }
  else if (/[=#()\[\]@\/\\]/.test(q) || /^[BCNOSPFIcnosp][A-Za-z0-9]*$/.test(q) && /[a-z]/.test(q) === false && q.length > 3) ns = 'smiles';
  const get = async (path, type = 'text') => {
    const body = ns === 'smiles' ? new URLSearchParams({ smiles: val }) : ns === 'name' ? new URLSearchParams({ name: val }) : null;
    const url = ns === 'cid' ? `${PUG}/compound/cid/${encodeURIComponent(val)}/${path}` : `${PUG}/compound/${ns}/${path}`;
    const r = await fetch(url, body ? { method: 'POST', body } : {});
    if (!r.ok) throw new Error(r.status === 404 ? 'PubChem has no compound for that query' : 'PubChem error ' + r.status);
    return type === 'json' ? r.json() : r.text();
  };
  const props = (await get('property/Title,MolecularFormula,MolecularWeight,SMILES,IUPACName/JSON', 'json')).PropertyTable.Properties[0];
  const cid = props.CID;
  ns = 'cid'; val = String(cid);
  const OCL = await loadEngine();
  const sdf2 = await get('SDF');
  let sdf3 = null; try { sdf3 = await get('SDF?record_type=3d'); } catch (e) { sdf3 = null; }
  const mol = OCL.Molecule.fromMolfile(sdf2);
  const mol3d = sdf3 ? OCL.Molecule.fromMolfile(sdf3) : null;
  let sy = [];
  try { sy = ((await get('synonyms/JSON', 'json')).InformationList.Information[0].Synonym || []).slice(0, 8); } catch (e) { sy = []; }
  return recordFrom(OCL, mol, { mol3d, meta: { id: 'cid-' + cid, n: props.Title || q, c: 'custom', cid, f: props.MolecularFormula, w: +props.MolecularWeight,
    iu: props.IUPACName || '', s: props.SMILES || '', sy, d: 'Loaded live from PubChem (CID ' + cid + ').' } });
}
