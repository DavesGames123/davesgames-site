// ============================================================================
//  PROTEIN FOLDING  ·  build-proteins.mjs — PDB to proteins.js  (Node, by hand)
// ----------------------------------------------------------------------------
//  Reads PDB files, keeps model 1, one chain and one residue range, and
//  writes proteins.js. For each protein the output holds:
//      seq ..... one-letter sequence
//      ss ...... H helix, E strand, C coil (HELIX/SHEET records; a C-alpha
//                rule fills in when a file has no records)
//      ca ...... C-alpha coordinates in angstrom, centred, 2 decimals
//      con ..... native contacts as index pairs: any two heavy atoms of
//                residues i and j closer than 4.5 A, with j - i >= 4
//  PDB data is CC0. Each file comes from files.rcsb.org.
//
//  RUN
//      mkdir -p /tmp/pdb && cd /tmp/pdb && for id in 5AWL 1UAO ...; do
//        curl -sfO https://files.rcsb.org/download/$id.pdb; done
//      node build-proteins.mjs /tmp/pdb
//  The id list is the SOURCES table below.
//
//  SECTION MAP   (grep -n "<anchor>" build-proteins.mjs)
//      const SOURCES ....... pdb id, chain, residue range per preset
//      function readPdb .... model 1 atoms of one chain
//      function caSS ....... the C-alpha secondary-structure fallback
//      function contacts ... heavy-atom native contacts
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCES = [
  // id            pdb    chain from  to
  ['cln025',      '5AWL', 'A',   1,  10],
  ['chignolin',   '1UAO', 'A',   1,  10],
  ['trpcage',     '1L2Y', 'A',   1,  20],
  ['gb1hairpin',  '1PGA', 'A',  41,  56],
  ['bba',         '1FME', 'A',   1,  28],
  ['villin',      '1YRF', 'A',  42,  76],
  ['ww',          '1PIN', 'A',   6,  39],
  ['fip35',       '2F21', 'A',   6,  39],
  ['ntl9',        '2HBA', 'A',   1,  52],
  ['proteinb',    '1PRB', 'A',   1,  53],
  ['engrailed',   '1ENH', 'A',   3,  56],
  ['proteina',    '1BDD', 'A',  10,  58],
  ['proteing',    '1PGA', 'A',   1,  56],
  ['proteinl',    '1HZ6', 'A',   2,  64],
  ['sh3',         '1SHG', 'A',   6,  62],
  ['ci2',         '2CI2', 'I',  20,  83],
  ['alpha3d',     '2A3D', 'A',   1,  73],
  ['ubiquitin',   '1UBQ', 'A',   1,  76],
  ['lambda',      '1LMB', '4',   6,  85],
  ['titin',       '1TIT', 'A',   1,  89],
  ['tenascin',    '1TEN', 'A', 803, 891],
  ['top7',        '1QYS', 'A',   3,  94],
  ['s6',          '1RIS', 'A',   1,  97],
  ['barnase',     '1BNI', 'A',   3, 110],
  ['chey',        '3CHY', 'A',   2, 129],
  ['myoglobin',   '1MBN', 'A',   1, 153],
  ['rhodopsin',   '1U19', 'A',   1,  64],
];

const AA = { ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLN:'Q', GLU:'E', GLY:'G', HIS:'H', ILE:'I',
  LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S', THR:'T', TRP:'W', TYR:'Y', VAL:'V', MSE:'M', NLE:'L' };

// Model 1 atoms of one chain, grouped by residue number (no insertion codes
// in the chosen ranges). Altloc: blank or A only. Hydrogens are dropped.
function readPdb(text, chain, from, to) {
  const res = new Map(), helix = [], sheet = [];
  for (const l of text.split('\n')) {
    if (l.startsWith('ENDMDL')) break;
    const rec = l.slice(0, 6);
    if (rec === 'HELIX ' && l[19] === chain) helix.push([+l.slice(21, 25), +l.slice(33, 37)]);
    if (rec === 'SHEET ' && l[21] === chain) sheet.push([+l.slice(22, 26), +l.slice(33, 37)]);
    if (rec !== 'ATOM  ' && rec !== 'HETATM') continue;
    if (l[21] !== chain) continue;
    const alt = l[16]; if (alt !== ' ' && alt !== 'A') continue;
    const rn = +l.slice(22, 26); if (rn < from || rn > to) continue;
    const name = l.slice(12, 16).trim(), resn = l.slice(17, 20).trim();
    if (!AA[resn]) continue;
    const el = (l.slice(76, 78).trim() || name[0]).toUpperCase();
    if (el === 'H' || el === 'D') continue;
    if (!res.has(rn)) res.set(rn, { resn, atoms: [] });
    const r = res.get(rn);
    const p = [+l.slice(30, 38), +l.slice(38, 46), +l.slice(46, 54)];
    r.atoms.push(p);
    if (name === 'CA') r.ca = p;
  }
  const list = [...res.entries()].sort((a, b) => a[0] - b[0]).map(([rn, r]) => ({ rn, ...r }));
  for (const r of list) if (!r.ca) throw new Error('no CA at residue ' + r.rn);
  return { list, helix, sheet };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function dihedral(a, b, c, d) {
  const b1 = sub(b, a), b2 = sub(c, b), b3 = sub(d, c);
  const n1 = cross(b1, b2), n2 = cross(b2, b3);
  const m = cross(n1, b2);
  return Math.atan2(dot(m, n2) / Math.hypot(...b2), dot(n1, n2)) * 180 / Math.PI;
}

// C-alpha fallback for files with no HELIX or SHEET records. A residue is
// helix when the C-alpha dihedral is near +50 deg over a run of 3. A
// residue is strand when the chain is straight there (i-1 to i+1 > 6.2 A)
// and a straight residue at |i-j| >= 3 is within 5.5 A.
function caSS(ca) {
  const n = ca.length, ss = Array(n).fill('C');
  const ext = i => i > 0 && i < n - 1 && dist(ca[i - 1], ca[i + 1]) > 6.2;
  for (let i = 1; i + 2 < n; i++) {
    const d = dihedral(ca[i - 1], ca[i], ca[i + 1], ca[i + 2]);
    if (d > 30 && d < 80) for (let k = i - 1; k <= i + 2; k++) ss[k] = 'H';
  }
  for (let i = 0; i < n; i++) {
    if (ss[i] !== 'C' || !ext(i)) continue;
    for (let j = 0; j < n; j++) if (Math.abs(i - j) >= 3 && ext(j) && dist(ca[i], ca[j]) < 5.5) { ss[i] = 'E'; break; }
  }
  return ss;
}

function contacts(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 4; j < list.length; j++) {
    if (dist(list[i].ca, list[j].ca) > 16) continue;
    let hit = false;
    for (const a of list[i].atoms) { for (const b of list[j].atoms) if (dist(a, b) < 4.5) { hit = true; break; } if (hit) break; }
    if (hit) out.push(i, j);
  }
  return out;
}

const dir = process.argv[2];
if (!dir) { console.error('usage: node build-proteins.mjs <dir with PDB files>'); process.exit(1); }
const out = {};
for (const [id, pdb, chain, from, to] of SOURCES) {
  const { list, helix, sheet } = readPdb(readFileSync(`${dir}/${pdb}.pdb`, 'utf8'), chain, from, to);
  const ca = list.map(r => r.ca);
  let ss;
  if (helix.length || sheet.length) {
    ss = list.map(r => helix.some(([a, b]) => r.rn >= a && r.rn <= b) ? 'H' : sheet.some(([a, b]) => r.rn >= a && r.rn <= b) ? 'E' : 'C');
  } else ss = caSS(ca);
  const c = [0, 1, 2].map(k => ca.reduce((s, p) => s + p[k], 0) / ca.length);
  const flat = ca.flatMap(p => p.map((v, k) => Math.round((v - c[k]) * 100) / 100));
  const con = contacts(list);
  const gaps = [];
  for (let i = 1; i < ca.length; i++) if (dist(ca[i], ca[i - 1]) > 4.2) gaps.push(i);
  out[id] = { pdb, chain, from: list[0].rn, to: list[list.length - 1].rn, seq: list.map(r => AA[r.resn]).join(''), ss: ss.join(''), ca: flat, con };
  console.log(id.padEnd(11), pdb, chain, `${list[0].rn}-${list[list.length - 1].rn}`.padEnd(8), 'n', String(ca.length).padStart(3),
    'contacts', String(con.length / 2).padStart(4), 'ss', ss.join(''), gaps.length ? 'GAPS ' + gaps : '');
}

const body = Object.entries(out).map(([id, p]) =>
  `  ${id}: { pdb: '${p.pdb}', chain: '${p.chain}', from: ${p.from}, to: ${p.to},\n` +
  `    seq: '${p.seq}',\n    ss: '${p.ss}',\n` +
  `    ca: [${p.ca.join(',')}],\n    con: [${p.con.join(',')}] },`).join('\n');
const js = `// ============================================================================
//  PROTEIN FOLDING  ·  proteins.js — native structures  (GENERATED)
// ----------------------------------------------------------------------------
//  Do not edit by hand. build-proteins.mjs writes this file from PDB files
//  (CC0, files.rcsb.org). Per protein: pdb id, chain, residue range, seq,
//  ss (H, E, C), ca (C-alpha x y z in angstrom, centred) and con (native
//  contact pairs i j, 0-based; heavy atoms < 4.5 A, j - i >= 4).
// ============================================================================
export const PROTEINS = {
${body}
};
`;
const dest = fileURLToPath(new URL('./proteins.js', import.meta.url));
writeFileSync(dest, js);
console.log('wrote', dest, js.length, 'bytes');
