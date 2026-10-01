// ============================================================================
//  PROTEIN VIEWER  ·  parse.js — PDB and mmCIF text to one structure model
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE: tests.mjs runs this file in Node.
//
//  parsePDB(text)   fixed columns: ATOM/HETATM, HELIX, SHEET, CONECT, MODEL,
//                   HEADER/TITLE/EXPDTA/REMARK 2. The first model only, the
//                   first alternate location only.
//  parseCIF(text)   a small STAR tokenizer, then the _atom_site,
//                   _struct_conf and _struct_sheet_range loops. It uses the
//                   auth_* chain and residue numbers, as papers do.
//  build(raw)       one model for both formats:
//     atoms[i]      { x y z name el het b occ serial res }
//     pos           Float32Array(3n), the same coordinates packed
//     residues[r]   { name seq icode chain kind atoms[] map{} ss code }
//                   kind: protein | nucleic | water | ion | ligand
//     chains[c]     { id residues[] }
//     bonds         Uint32Array of atom index pairs
//     segments      polymer runs with no chain break, for the cartoon
//  The secondary structure comes from the file records. When a file has no
//  records, ss.js assigns it from the backbone H-bonds (DSSP-like).
//
//  grep: function parsePDB  function parseCIF  function tokenizeCIF
//        function build  function makeBonds  function makeGrid
//        function elementOf  const AA3  function segmentsOf  export function parse
// ============================================================================
import { assignSS } from './ss.js';

export const AA3 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  MSE: 'M', SEC: 'U', PYL: 'O', HSD: 'H', HSE: 'H', HID: 'H', HIE: 'H', HIP: 'H', CYX: 'C', ASX: 'B', GLX: 'Z',
};
export const AA_NAME = {
  ALA: 'Alanine', ARG: 'Arginine', ASN: 'Asparagine', ASP: 'Aspartate', CYS: 'Cysteine', GLN: 'Glutamine',
  GLU: 'Glutamate', GLY: 'Glycine', HIS: 'Histidine', ILE: 'Isoleucine', LEU: 'Leucine', LYS: 'Lysine',
  MET: 'Methionine', PHE: 'Phenylalanine', PRO: 'Proline', SER: 'Serine', THR: 'Threonine', TRP: 'Tryptophan',
  TYR: 'Tyrosine', VAL: 'Valine', MSE: 'Selenomethionine', HOH: 'Water',
  DA: 'Deoxyadenosine', DC: 'Deoxycytidine', DG: 'Deoxyguanosine', DT: 'Deoxythymidine',
  A: 'Adenosine', C: 'Cytidine', G: 'Guanosine', U: 'Uridine',
};
const NA1 = { DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U', DI: 'I', A: 'A', C: 'C', G: 'G', U: 'U', I: 'I', T: 'T' };
const WATER = new Set(['HOH', 'WAT', 'DOD', 'H2O', 'TIP', 'TIP3', 'SOL']);
const TWO = new Set(['HE', 'LI', 'BE', 'NE', 'NA', 'MG', 'AL', 'SI', 'CL', 'AR', 'CA', 'SC', 'TI', 'CR', 'MN', 'FE', 'CO',
  'NI', 'CU', 'ZN', 'GA', 'GE', 'AS', 'SE', 'BR', 'KR', 'RB', 'SR', 'ZR', 'MO', 'RU', 'RH', 'PD', 'AG', 'CD', 'IN', 'SN',
  'SB', 'TE', 'XE', 'CS', 'BA', 'LA', 'CE', 'GD', 'YB', 'W', 'PT', 'AU', 'HG', 'TL', 'PB', 'BI', 'U']);
export const METALS = new Set(['LI', 'NA', 'K', 'MG', 'CA', 'MN', 'FE', 'CO', 'NI', 'CU', 'ZN', 'CD', 'HG', 'SR', 'BA',
  'RB', 'CS', 'AL', 'GA', 'PT', 'AU', 'AG', 'PB', 'MO', 'W', 'YB', 'GD', 'LA', 'TL', 'CR', 'V', 'TI']);

// covalent radii (A), for the bond test d < ri + rj + 0.42
const COV = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, SE: 1.20, F: 0.57, CL: 1.02, BR: 1.20, I: 1.39, B: 0.84, SI: 1.11, FE: 1.32, ZN: 1.22, MG: 1.41, MN: 1.39, CU: 1.32, CO: 1.26, NI: 1.24, CA: 1.76, NA: 1.66, K: 2.03 };
export const covRadius = el => COV[el] ?? 1.2;

// Guess the element from the 4-character PDB atom name when column 77 is
// empty. A name that starts in column 13 with a letter can be a two-letter
// element (FE, ZN), but only in HETATM: in ATOM, "CA" is the alpha carbon.
export function elementOf(name4, het, resName) {
  const n = name4.padEnd(4);
  const t = n.trim().toUpperCase();
  if (het && /^[A-Z]{2}$/.test(n.slice(0, 2)) && TWO.has(n.slice(0, 2)) && (t.length <= 2 || t === resName)) return n.slice(0, 2);
  const m = t.replace(/^[0-9]+/, '');
  if (!m) return 'X';
  if (m[0] === 'H' || m[0] === 'D') return 'H';
  return m[0];
}

// ── PDB ─────────────────────────────────────────────────────────────────────
export function parsePDB(text) {
  const atoms = [], helices = [], sheets = [], conect = [];
  const meta = { id: '', title: '', method: '', resolution: null, format: 'pdb', af: false };
  const altSeen = new Map();
  let modelSeen = false, title = [];
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    const rec = l.slice(0, 6);
    if (rec === 'ATOM  ' || rec === 'HETATM') {
      const het = rec === 'HETATM';
      const alt = l[16] || ' ';
      const chain = (l[21] || ' ').trim() || '_';
      const seq = parseInt(l.slice(22, 26), 10);
      const icode = (l[26] || ' ').trim();
      const resName = l.slice(17, 20).trim();
      const name4 = l.slice(12, 16);
      if (alt !== ' ') {
        const key = chain + '|' + seq + icode;
        const first = altSeen.get(key);
        if (first === undefined) altSeen.set(key, alt);
        else if (first !== alt) continue;
      }
      let el = l.slice(76, 78).trim().toUpperCase();
      if (!el || /\d/.test(el)) el = elementOf(name4, het, resName);
      atoms.push({
        serial: parseInt(l.slice(6, 11), 10), name: name4.trim(), resName, chain, seq: isNaN(seq) ? 0 : seq, icode,
        x: parseFloat(l.slice(30, 38)), y: parseFloat(l.slice(38, 46)), z: parseFloat(l.slice(46, 54)),
        occ: parseFloat(l.slice(54, 60)) || 1, b: parseFloat(l.slice(60, 66)) || 0, el, het,
      });
    } else if (rec === 'TER   ' || rec === 'TER') {
      if (atoms.length) atoms[atoms.length - 1].ter = true;
    } else if (rec === 'MODEL ') {
      if (modelSeen) break;
      modelSeen = true;
    } else if (rec === 'ENDMDL') {
      break;
    } else if (rec === 'HELIX ') {
      const cls = parseInt(l.slice(38, 40), 10) || 1;
      helices.push({ chain: l[19].trim() || '_', start: parseInt(l.slice(21, 25), 10), startI: l[25].trim(), end: parseInt(l.slice(33, 37), 10), endI: (l[37] || ' ').trim(), cls });
    } else if (rec === 'SHEET ') {
      sheets.push({ chain: l[21].trim() || '_', start: parseInt(l.slice(22, 26), 10), startI: l[26].trim(), end: parseInt(l.slice(33, 37), 10), endI: (l[37] || ' ').trim() });
    } else if (rec === 'CONECT') {
      const a = parseInt(l.slice(6, 11), 10);
      for (let k = 11; k < 31; k += 5) {
        const b = parseInt(l.slice(k, k + 5), 10);
        if (!isNaN(b) && b > a) conect.push([a, b]);
      }
    } else if (rec === 'HEADER') {
      meta.id = l.slice(62, 66).trim();
    } else if (rec === 'TITLE ') {
      title.push(l.slice(10, 80).trim());
    } else if (rec === 'EXPDTA') {
      meta.method = l.slice(10, 79).trim();
    } else if (rec === 'REMARK' && l.slice(6, 10).trim() === '2' && /RESOLUTION\./.test(l)) {
      const m = l.match(/(\d+\.\d+)\s*ANGSTROM/);
      if (m) meta.resolution = parseFloat(m[1]);
    }
  }
  meta.title = title.join(' ').replace(/\s+/g, ' ').trim();
  if (/ALPHAFOLD/i.test(meta.title) || /ALPHAFOLD/i.test(text.slice(0, 4000))) meta.af = true;
  return { atoms, helices, sheets, conect, meta };
}

// ── mmCIF ───────────────────────────────────────────────────────────────────
// Tokens: bare words, 'quoted' and "quoted" strings, and ;-delimited text
// fields that start a line. A quote ends only before white space.
export function tokenizeCIF(text) {
  const out = [];
  const n = text.length;
  let i = 0, lineStart = true;
  while (i < n) {
    const c = text[i];
    if (c === '\n') { lineStart = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; lineStart = false; continue; }
    if (c === '#') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === ';' && lineStart) {
      const end = text.indexOf('\n;', i + 1);
      const stop = end < 0 ? n : end;
      out.push({ v: text.slice(i + 1, stop).trim(), q: true });
      i = stop + 2; lineStart = false; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && !(text[j] === c && (j + 1 >= n || /\s/.test(text[j + 1])))) j++;
      out.push({ v: text.slice(i + 1, j), q: true });
      i = j + 1; lineStart = false; continue;
    }
    let j = i;
    while (j < n && !/\s/.test(text[j])) j++;
    out.push({ v: text.slice(i, j), q: false });
    i = j; lineStart = false;
  }
  return out;
}

// Returns { items: {tag: value}, loops: {category: {cols[], rows[][]}} }
export function readCIF(text) {
  const t = tokenizeCIF(text);
  const items = {}, loops = {};
  let i = 0;
  while (i < t.length) {
    const tok = t[i];
    if (!tok.q && tok.v === 'loop_') {
      i++;
      const cols = [];
      while (i < t.length && !t[i].q && t[i].v[0] === '_') cols.push(t[i++].v);
      const rows = [];
      while (i < t.length) {
        const v = t[i];
        if (!v.q && (v.v[0] === '_' || v.v === 'loop_' || v.v.startsWith('data_'))) break;
        rows.push(v.v); i++;
      }
      if (!cols.length) continue;
      const cat = cols[0].split('.')[0];
      const names = cols.map(c => c.split('.')[1]);
      const table = [];
      for (let r = 0; r + names.length <= rows.length; r += names.length) table.push(rows.slice(r, r + names.length));
      loops[cat] = { cols: names, rows: table };
    } else if (!tok.q && tok.v[0] === '_') {
      const val = t[i + 1];
      items[tok.v] = val ? val.v : '';
      i += 2;
    } else i++;
  }
  // single items of a category also read as a one-row loop
  for (const k in items) {
    const [cat, col] = k.split('.');
    if (!loops[cat]) loops[cat] = { cols: [], rows: [[]] };
    const L = loops[cat];
    if (L.rows.length === 1 && !L.cols.includes(col)) { L.cols.push(col); L.rows[0].push(items[k]); }
  }
  return { items, loops };
}

const cifCol = (L, ...names) => { for (const nm of names) { const k = L.cols.indexOf(nm); if (k >= 0) return k; } return -1; };
const cifNull = v => v === undefined || v === '?' || v === '.';

export function parseCIF(text) {
  const { items, loops } = readCIF(text);
  const meta = { id: '', title: '', method: '', resolution: null, format: 'mmcif', af: false };
  meta.id = (items['_entry.id'] || '').toUpperCase();
  meta.title = (items['_struct.title'] || '').replace(/\s+/g, ' ');
  meta.method = (items['_exptl.method'] || (loops._exptl && loops._exptl.rows[0] && loops._exptl.rows[0][cifCol(loops._exptl, 'method')]) || '').toUpperCase();
  const res = items['_refine.ls_d_res_high'] || items['_em_3d_reconstruction.resolution'] || items['_reflns.d_resolution_high'];
  if (!cifNull(res)) meta.resolution = parseFloat(res);
  if (loops._ma_qa_metric || /alphafold/i.test(meta.title) || /alphafold/i.test(text.slice(0, 6000))) meta.af = true;

  const atoms = [], helices = [], sheets = [];
  const A = loops._atom_site;
  if (A) {
    const c = {
      group: cifCol(A, 'group_PDB'), id: cifCol(A, 'id'), el: cifCol(A, 'type_symbol'),
      name: cifCol(A, 'auth_atom_id', 'label_atom_id'), alt: cifCol(A, 'label_alt_id'),
      res: cifCol(A, 'auth_comp_id', 'label_comp_id'), chain: cifCol(A, 'auth_asym_id', 'label_asym_id'),
      seq: cifCol(A, 'auth_seq_id', 'label_seq_id'), ins: cifCol(A, 'pdbx_PDB_ins_code'),
      x: cifCol(A, 'Cartn_x'), y: cifCol(A, 'Cartn_y'), z: cifCol(A, 'Cartn_z'),
      occ: cifCol(A, 'occupancy'), b: cifCol(A, 'B_iso_or_equiv'), model: cifCol(A, 'pdbx_PDB_model_num'),
      lasym: cifCol(A, 'label_asym_id'),
    };
    const altSeen = new Map();
    let model0 = null, lastAsym = null;
    for (const r of A.rows) {
      if (c.model >= 0) { if (model0 === null) model0 = r[c.model]; else if (r[c.model] !== model0) break; }
      const chain = r[c.chain];
      const seqv = r[c.seq];
      const seq = cifNull(seqv) ? 0 : parseInt(seqv, 10);
      const icode = c.ins >= 0 && !cifNull(r[c.ins]) ? r[c.ins] : '';
      const alt = c.alt >= 0 && !cifNull(r[c.alt]) ? r[c.alt] : '';
      if (alt) {
        const key = chain + '|' + seq + icode;
        const first = altSeen.get(key);
        if (first === undefined) altSeen.set(key, alt);
        else if (first !== alt) continue;
      }
      const het = r[c.group] === 'HETATM';
      const resName = r[c.res];
      const name = r[c.name];
      let el = c.el >= 0 && !cifNull(r[c.el]) ? r[c.el].toUpperCase() : elementOf(name.padEnd(4), het, resName);
      const at = {
        serial: parseInt(r[c.id], 10), name, resName, chain, seq, icode,
        x: parseFloat(r[c.x]), y: parseFloat(r[c.y]), z: parseFloat(r[c.z]),
        occ: c.occ >= 0 ? parseFloat(r[c.occ]) || 1 : 1, b: c.b >= 0 ? parseFloat(r[c.b]) || 0 : 0, el, het,
      };
      // a new label_asym_id is a new entity (a ligand or the waters) even
      // when the author chain is the same; mark the end of the last one
      const asym = c.lasym >= 0 ? r[c.lasym] : chain;
      if (lastAsym !== null && asym !== lastAsym && atoms.length) atoms[atoms.length - 1].ter = true;
      lastAsym = asym;
      atoms.push(at);
    }
  }
  const C = loops._struct_conf;
  if (C) {
    const k = { type: cifCol(C, 'conf_type_id'), bc: cifCol(C, 'beg_auth_asym_id', 'beg_label_asym_id'), bs: cifCol(C, 'beg_auth_seq_id', 'beg_label_seq_id'),
      ec: cifCol(C, 'end_auth_asym_id'), es: cifCol(C, 'end_auth_seq_id', 'end_label_seq_id'), cls: cifCol(C, 'pdbx_PDB_helix_class'),
      bi: cifCol(C, 'pdbx_beg_PDB_ins_code'), ei: cifCol(C, 'pdbx_end_PDB_ins_code') };
    for (const r of C.rows) {
      if (k.type >= 0 && !/^HELX/i.test(r[k.type])) continue;
      helices.push({ chain: r[k.bc], start: parseInt(r[k.bs], 10), startI: k.bi >= 0 && !cifNull(r[k.bi]) ? r[k.bi] : '',
        end: parseInt(r[k.es], 10), endI: k.ei >= 0 && !cifNull(r[k.ei]) ? r[k.ei] : '', cls: k.cls >= 0 ? parseInt(r[k.cls], 10) || 1 : 1 });
    }
  }
  const S = loops._struct_sheet_range;
  if (S) {
    const k = { bc: cifCol(S, 'beg_auth_asym_id', 'beg_label_asym_id'), bs: cifCol(S, 'beg_auth_seq_id', 'beg_label_seq_id'),
      es: cifCol(S, 'end_auth_seq_id', 'end_label_seq_id'), bi: cifCol(S, 'pdbx_beg_PDB_ins_code'), ei: cifCol(S, 'pdbx_end_PDB_ins_code') };
    for (const r of S.rows) sheets.push({ chain: r[k.bc], start: parseInt(r[k.bs], 10), startI: k.bi >= 0 && !cifNull(r[k.bi]) ? r[k.bi] : '',
      end: parseInt(r[k.es], 10), endI: k.ei >= 0 && !cifNull(r[k.ei]) ? r[k.ei] : '' });
  }
  // covalent links between residues that the distance test can miss
  const conect = [];
  const L = loops._struct_conn;
  if (L) {
    const k = { type: cifCol(L, 'conn_type_id'), c1: cifCol(L, 'ptnr1_auth_asym_id'), s1: cifCol(L, 'ptnr1_auth_seq_id'), a1: cifCol(L, 'ptnr1_label_atom_id'),
      c2: cifCol(L, 'ptnr2_auth_asym_id'), s2: cifCol(L, 'ptnr2_auth_seq_id'), a2: cifCol(L, 'ptnr2_label_atom_id') };
    if (k.c1 >= 0 && k.a1 >= 0) {
      const key = (ch, s, nm) => ch + '|' + s + '|' + nm;
      const idx = new Map();
      for (const a of atoms) idx.set(key(a.chain, a.seq, a.name), a.serial);
      for (const r of L.rows) {
        if (!/^(covale|disulf|metalc)/i.test(r[k.type] || '')) continue;
        const a = idx.get(key(r[k.c1], r[k.s1], r[k.a1])), b = idx.get(key(r[k.c2], r[k.s2], r[k.a2]));
        if (a !== undefined && b !== undefined) conect.push([a, b]);
      }
    }
  }
  return { atoms, helices, sheets, conect, meta };
}

// ── spatial grid ────────────────────────────────────────────────────────────
// Buckets point indices into cubes of side `cell`; near() visits each index
// within r of a point.
export function makeGrid(pos, idx, cell) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const i of idx) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  if (!isFinite(x0)) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 1; }
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const map = new Map();
  for (const i of idx) {
    const k = (Math.floor((pos[3 * i] - x0) / cell) * ny + Math.floor((pos[3 * i + 1] - y0) / cell)) * nz + Math.floor((pos[3 * i + 2] - z0) / cell);
    let b = map.get(k); if (!b) map.set(k, b = []); b.push(i);
  }
  function near(x, y, z, r, cb) {
    const r2 = r * r;
    const ax = Math.max(0, Math.floor((x - r - x0) / cell)), bx = Math.min(nx - 1, Math.floor((x + r - x0) / cell));
    const ay = Math.max(0, Math.floor((y - r - y0) / cell)), by = Math.min(ny - 1, Math.floor((y + r - y0) / cell));
    const az = Math.max(0, Math.floor((z - r - z0) / cell)), bz = Math.min(nz - 1, Math.floor((z + r - z0) / cell));
    for (let gx = ax; gx <= bx; gx++) for (let gy = ay; gy <= by; gy++) for (let gz = az; gz <= bz; gz++) {
      const b = map.get((gx * ny + gy) * nz + gz);
      if (!b) continue;
      for (const j of b) {
        const dx = pos[3 * j] - x, dy = pos[3 * j + 1] - y, dz = pos[3 * j + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= r2) cb(j, d2);
      }
    }
  }
  return { near };
}

// ── build ───────────────────────────────────────────────────────────────────
function classify(res, atoms) {
  const nm = res.name;
  if (WATER.has(nm)) return 'water';
  if (AA3[nm]) return 'protein';
  if (NA1[nm]) return 'nucleic';
  const m = res.map;
  if (m.CA !== undefined && m.N !== undefined && m.C !== undefined) return 'protein';
  if (m.P !== undefined && (m["C1'"] !== undefined || m["O3'"] !== undefined)) return 'nucleic';
  if (res.atoms.length === 1 && !atoms[res.atoms[0]].het) return m.CA !== undefined ? 'protein' : m.P !== undefined ? 'nucleic' : 'ion';
  if (res.atoms.length === 1) return 'ion';
  return 'ligand';
}

export function build(raw, name = '') {
  const atoms = raw.atoms.filter(a => isFinite(a.x) && isFinite(a.y) && isFinite(a.z));
  const n = atoms.length;
  const pos = new Float32Array(3 * n);
  const residues = [], chains = [];
  const chainOf = new Map();
  let cur = null;
  for (let i = 0; i < n; i++) {
    const a = atoms[i];
    pos[3 * i] = a.x; pos[3 * i + 1] = a.y; pos[3 * i + 2] = a.z;
    if (!cur || a.chain !== cur.chainId || a.seq !== cur.seq || a.icode !== cur.icode || a.resName !== cur.name || cur.broken) {
      let ch = chainOf.get(a.chain);
      if (ch === undefined) { ch = chains.length; chainOf.set(a.chain, ch); chains.push({ id: a.chain, residues: [] }); }
      cur = { name: a.resName, seq: a.seq, icode: a.icode, chainId: a.chain, chain: ch, atoms: [], map: {}, kind: '', ss: 'C', code: 'X', index: residues.length };
      residues.push(cur);
      chains[ch].residues.push(cur.index);
    }
    a.res = cur.index;
    cur.atoms.push(i);
    if (cur.map[a.name] === undefined) cur.map[a.name] = i;
    if (a.ter) cur.broken = true;
  }
  for (const r of residues) {
    delete r.broken;
    r.kind = classify(r, atoms);
    r.code = r.kind === 'protein' ? (AA3[r.name] || 'X') : r.kind === 'nucleic' ? (NA1[r.name] || (r.name.length === 1 ? r.name : 'N')) : '';
    r.ca = r.kind === 'protein' ? (r.map.CA ?? -1) : r.kind === 'nucleic' ? (r.map.P ?? r.map["C4'"] ?? r.map["C3'"] ?? -1) : -1;
  }
  const s = { meta: { ...raw.meta, name: name || raw.meta.id }, atoms, pos, residues, chains, bonds: null, segments: null, ssSource: 'file' };
  s.bonds = makeBonds(s, raw.conect || []);
  s.segments = segmentsOf(s);
  // secondary structure: file records first, then our own assignment
  let marked = 0;
  const findRes = (chain, seq, icode) => {
    const ch = chainOf.get(chain); if (ch === undefined) return -1;
    for (const ri of chains[ch].residues) { const r = residues[ri]; if (r.seq === seq && (r.icode || '') === (icode || '') && r.kind === 'protein') return ri; }
    return -1;
  };
  const mark = (rec, ss) => {
    const a = findRes(rec.chain, rec.start, rec.startI), b = findRes(rec.chain, rec.end, rec.endI);
    if (a < 0 || b < 0 || b < a) return;
    for (let i = a; i <= b; i++) if (residues[i].kind === 'protein' && residues[i].chain === residues[a].chain) { residues[i].ss = ss; marked++; }
  };
  // class 10 is polyproline (collagen): a coil, not an alpha helix
  for (const h of raw.helices) if (h.cls !== 10) mark(h, h.cls === 5 ? 'G' : 'H');
  for (const e of raw.sheets) mark(e, 'E');
  const nProt = residues.reduce((k, r) => k + (r.kind === 'protein'), 0);
  if (!marked && nProt) { assignSS(s); s.ssSource = 'computed'; }
  if (!nProt) s.ssSource = 'none';
  return s;
}

// Bonds: covalent distance test inside a residue, the peptide and the
// phosphodiester link between neighbours, disulfides, and the file's
// CONECT / struct_conn links. Waters and lone ions get no bonds.
export function makeBonds(s, conect) {
  const { atoms, pos, residues } = s;
  const out = [];
  const seen = new Set();
  const add = (i, j) => { const k = i < j ? i * 1e6 + j : j * 1e6 + i; if (!seen.has(k)) { seen.add(k); out.push(i, j); } };
  const idx = [];
  for (let i = 0; i < atoms.length; i++) { const r = residues[atoms[i].res]; if (r.kind !== 'water') idx.push(i); }
  const grid = makeGrid(pos, idx, 2.4);
  for (const i of idx) {
    const a = atoms[i], ri = a.res, ra = covRadius(a.el);
    if (METALS.has(a.el) && residues[ri].atoms.length === 1) continue;
    grid.near(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], 2.3, (j, d2) => {
      if (j <= i) return;
      const b = atoms[j];
      if (a.el === 'H' && b.el === 'H') return;
      if (METALS.has(b.el) && residues[b.res].atoms.length === 1) return;
      const lim = ra + covRadius(b.el) + 0.42;
      if (d2 > lim * lim || d2 < 0.16) return;
      if (b.res === ri) { add(i, j); return; }
      const rb = residues[b.res];
      const r = residues[ri];
      // links between residues: peptide C-N, O3'-P, SG-SG, and ligand links
      const pair = a.name + '-' + b.name;
      if (pair === 'C-N' || pair === 'N-C' || pair === "O3'-P" || pair === "P-O3'") { add(i, j); return; }
      if (a.el === 'S' && b.el === 'S') { add(i, j); return; }
      if ((r.kind === 'ligand' || rb.kind === 'ligand') && a.el !== 'H' && b.el !== 'H' && r.kind !== 'water' && rb.kind !== 'water') {
        // sugars on Asn (NAG), retinal on Lys, heme vinyls: only when the
        // gap is clearly covalent
        if (d2 < (ra + covRadius(b.el) + 0.2) ** 2) add(i, j);
      }
    });
  }
  // CONECT and struct_conn, by serial number
  if (conect.length) {
    const bySerial = new Map();
    for (let i = 0; i < atoms.length; i++) bySerial.set(atoms[i].serial, i);
    for (const [p, q] of conect) {
      const i = bySerial.get(p), j = bySerial.get(q);
      if (i === undefined || j === undefined || i === j) continue;
      if (residues[atoms[i].res].kind === 'water' || residues[atoms[j].res].kind === 'water') continue;
      const dx = pos[3 * i] - pos[3 * j], dy = pos[3 * i + 1] - pos[3 * j + 1], dz = pos[3 * i + 2] - pos[3 * j + 2];
      if (dx * dx + dy * dy + dz * dz < 3.2 * 3.2) add(i, j);
    }
  }
  // CA-only (or P-only) chains: join the trace atoms
  for (const ch of s.chains) {
    let prev = null;
    for (const ri of ch.residues) {
      const r = residues[ri];
      if ((r.kind === 'protein' || r.kind === 'nucleic') && r.atoms.length === 1 && r.ca >= 0) {
        if (prev && prev.atoms.length === 1) {
          const i = prev.ca, j = r.ca;
          const d = Math.hypot(pos[3 * i] - pos[3 * j], pos[3 * i + 1] - pos[3 * j + 1], pos[3 * i + 2] - pos[3 * j + 2]);
          if (d < (r.kind === 'protein' ? 4.3 : 8)) add(i, j);
        }
        prev = r;
      } else prev = null;
    }
  }
  return new Uint32Array(out);
}

// Polymer runs with no chain break, for the cartoon and the trace.
export function segmentsOf(s) {
  const { residues, pos } = s;
  const d = (i, j) => Math.hypot(pos[3 * i] - pos[3 * j], pos[3 * i + 1] - pos[3 * j + 1], pos[3 * i + 2] - pos[3 * j + 2]);
  const segs = [];
  for (const ch of s.chains) {
    let seg = null, prev = null;
    for (const ri of ch.residues) {
      const r = residues[ri];
      if ((r.kind !== 'protein' && r.kind !== 'nucleic') || r.ca < 0) { continue; }
      let joined = false;
      if (seg && prev && prev.kind === r.kind) {
        if (r.kind === 'protein') {
          const c = prev.map.C, nn = r.map.N;
          joined = c !== undefined && nn !== undefined ? d(c, nn) < 2.0 : d(prev.ca, r.ca) < 4.3;
        } else {
          const o3 = prev.map["O3'"], p = r.map.P;
          joined = o3 !== undefined && p !== undefined ? d(o3, p) < 2.0 : d(prev.ca, r.ca) < 8.0;
        }
      }
      if (!joined) { seg = { kind: r.kind, chain: r.chain, residues: [] }; segs.push(seg); }
      seg.residues.push(ri);
      prev = r;
    }
  }
  return segs;
}

// Detect the format and parse. Returns the built structure.
export function parse(text, name = '') {
  const head = text.slice(0, 2000);
  const isCIF = /^\s*data_/m.test(head) && /_atom_site\.|loop_/.test(text.slice(0, 200000)) || /^_atom_site\./m.test(head);
  const raw = isCIF ? parseCIF(text) : parsePDB(text);
  if (!raw.atoms.length) throw new Error('No ATOM or HETATM records were found.');
  if (/^AF-/i.test(name)) raw.meta.af = true;
  return build(raw, name);
}

// one-letter code for a residue name (used by the sequence strip)
export const oneLetter = nm => AA3[nm] || NA1[nm] || 'X';
