// ============================================================================
//  PROTEIN VIEWER  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks the parser, the bonds, and the secondary structure on vendored
//  files in data/:
//    pdb ........ 1CRN atom and residue counts, elements, HELIX/SHEET
//    altloc ..... one atom per name in each residue after the alt filter
//    model ...... 1L2Y (an NMR ensemble) reads model 1 only
//    mmcif ...... 6LU7 and 1EHZ read from mmCIF; the counts agree with
//                 the atom_site loop, the modified tRNA bases are nucleic
//    bonds ...... no protein heavy atom without a bond; peptide links
//    ss ......... the computed SS agrees with the file records (1UBQ,
//                 2LZM, 1TIM) on most residues; AlphaFold models get SS
//    ca-only .... 1AON (CA only) keeps the trace and the file SS
//    presets .... every preset file parses and every focus residue exists
//    geometry ... the cartoon and the surface of every preset file have
//                 finite vertices and in-range indices
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parse, parsePDB, parseCIF, build, tokenizeCIF } from './parse.js';
import { assignSS } from './ss.js';
import { PRESETS } from './presets.js';
import { cartoonGeometry } from './cartoon.js';
import { gaussianSurface, vdw } from './surface.js';

const here = new URL('.', import.meta.url).pathname;
const load = f => gunzipSync(readFileSync(here + 'data/' + f)).toString('latin1');
let pass = 0, fail = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// ── PDB ─────────────────────────────────────────────────────────────────────
{
  const s = parse(load('1CRN.pdb.gz'), '1CRN');
  const prot = s.residues.filter(r => r.kind === 'protein');
  ok(s.atoms.length === 327, 'pdb 1CRN atoms', `${s.atoms.length}`);
  ok(prot.length === 46, 'pdb 1CRN residues', `${prot.length}`);
  ok(prot.map(r => r.code).join('').startsWith('TTCCPSIVARSNFNVCRLPGTPEA'), 'pdb 1CRN sequence');
  ok(s.atoms.every(a => ['C', 'N', 'O', 'S'].includes(a.el)), 'pdb 1CRN elements');
  ok(s.meta.resolution === 1.5 && /X-RAY/.test(s.meta.method), 'pdb 1CRN meta', `${s.meta.method} ${s.meta.resolution}`);
  ok(prot.filter(r => r.ss === 'H').length >= 18 && prot.filter(r => r.ss === 'E').length >= 6, 'pdb 1CRN HELIX/SHEET applied');
  ok(s.ssSource === 'file', 'pdb 1CRN ss source is file');
  // three disulfides: 3-40, 4-32, 16-26
  const ss = [];
  for (let k = 0; k < s.bonds.length; k += 2) { const a = s.atoms[s.bonds[k]], b = s.atoms[s.bonds[k + 1]]; if (a.name === 'SG' && b.name === 'SG') ss.push([a, b]); }
  ok(ss.length === 3, 'bonds 1CRN disulfides', `${ss.length}`);
  // every heavy atom of the protein has a bond
  const deg = new Uint16Array(s.atoms.length);
  for (const i of s.bonds) deg[i]++;
  ok(s.atoms.every((a, i) => deg[i] > 0), 'bonds 1CRN no lone heavy atom');
  let pep = 0;
  for (let k = 0; k < s.bonds.length; k += 2) { const a = s.atoms[s.bonds[k]], b = s.atoms[s.bonds[k + 1]]; if (a.res !== b.res && ((a.name === 'C' && b.name === 'N') || (a.name === 'N' && b.name === 'C'))) pep++; }
  ok(pep === 45, 'bonds 1CRN peptide links', `${pep}`);
  ok(s.segments.length === 1 && s.segments[0].residues.length === 46, 'segments 1CRN one chain run');
}
// alt locations in a raw (untrimmed) record set
{
  const txt = [
    'ATOM      1  N   SER A   1      10.000  10.000  10.000  1.00 10.00           N',
    'ATOM      2  CA ASER A   1      11.000  10.000  10.000  0.50 10.00           C',
    'ATOM      3  CA BSER A   1      11.100  10.100  10.000  0.50 10.00           C',
    'ATOM      4  OG ASER A   1      12.000  10.000  10.000  0.50 10.00           O',
    'ATOM      5  OG BSER A   1      12.100  10.400  10.000  0.50 10.00           O',
    'HETATM    6 ZN    ZN A 101       0.000   0.000   0.000  1.00 10.00',
    'HETATM    7 CA    CA A 102       5.000   0.000   0.000  1.00 10.00',
  ].join('\n');
  const r = parsePDB(txt);
  ok(r.atoms.length === 5, 'altloc keeps the first alternate', `${r.atoms.length}`);
  ok(r.atoms[3].el === 'ZN' && r.atoms[4].el === 'CA', 'element guess for ions with no element column', `${r.atoms[3].el} ${r.atoms[4].el}`);
  ok(r.atoms[1].el === 'C', 'element guess keeps an alpha carbon as C');
  const s = build(r);
  ok(s.residues[1].kind === 'ion' && s.residues[2].kind === 'ion', 'ions classified as ion');
}
// NMR ensemble
{
  const s = parse(load('1L2Y.pdb.gz'), '1L2Y');
  ok(s.residues.filter(r => r.kind === 'protein').length === 20, 'model 1L2Y model 1 only (20 residues)', `${s.atoms.length} atoms`);
  ok(s.atoms.some(a => a.el === 'H'), 'model 1L2Y keeps hydrogens');
}

// ── mmCIF ───────────────────────────────────────────────────────────────────
{
  const toks = tokenizeCIF("_a.b 'it''s fine' \"x y\"\n;line one\nline two\n;\n_c.d e");
  ok(toks.length === 6 && toks[1].v === "it''s fine" && toks[2].v === 'x y' && toks[3].v === 'line one\nline two', 'cif tokenizer quotes and text fields', JSON.stringify(toks.map(t => t.v)));
  const txt = load('6LU7.cif.gz');
  const raw = parseCIF(txt);
  const nLoop = (txt.match(/^(ATOM|HETATM) /gm) || []).length;
  ok(raw.atoms.length === nLoop, 'cif 6LU7 atom count matches atom_site rows', `${raw.atoms.length}/${nLoop}`);
  const s = build(raw, '6LU7');
  const A = s.chains.find(c => c.id === 'A');
  const protA = A.residues.filter(ri => s.residues[ri].kind === 'protein');
  ok(protA.length >= 300, 'cif 6LU7 chain A protein residues', `${protA.length}`);
  ok(s.residues.some(r => r.kind === 'protein' && r.ss === 'H') && s.residues.some(r => r.ss === 'E'), 'cif 6LU7 struct_conf and sheet ranges applied');
  ok(/MAIN PROTEASE|COVID|SARS/i.test(s.meta.title), 'cif 6LU7 title', s.meta.title.slice(0, 60));
  ok(s.meta.resolution > 1.5 && s.meta.resolution < 2.5, 'cif 6LU7 resolution', `${s.meta.resolution}`);
  // the N3 inhibitor (PJE ... in chain C) is not protein
  ok(s.residues.some(r => r.kind === 'ligand' || (r.kind === 'protein' && r.chain !== s.residues[protA[0]].chain)), 'cif 6LU7 has the inhibitor chain');
  const t = parse(load('1EHZ.cif.gz'), '1EHZ');
  const na = t.residues.filter(r => r.kind === 'nucleic');
  ok(na.length === 76, 'cif 1EHZ tRNA has 76 nucleotides (modified bases included)', `${na.length}`);
  ok(t.segments.filter(g => g.kind === 'nucleic').length === 1, 'cif 1EHZ one unbroken nucleic segment', `${t.segments.length}`);
}

// ── secondary structure ─────────────────────────────────────────────────────
function agreement(file) {
  const s = parse(load(file), file);
  const fileSS = s.residues.map(r => r.ss);
  for (const r of s.residues) r.ss = 'C';
  assignSS(s);
  let same = 0, tot = 0, hFile = 0, hBoth = 0, eFile = 0, eBoth = 0;
  s.residues.forEach((r, i) => {
    if (r.kind !== 'protein') return;
    const a = fileSS[i] === 'G' ? 'C' : fileSS[i], b = r.ss === 'G' ? 'C' : r.ss;
    tot++; if (a === b) same++;
    if (a === 'H') { hFile++; if (b === 'H') hBoth++; }
    if (a === 'E') { eFile++; if (b === 'E') eBoth++; }
  });
  return { q3: same / tot, h: hBoth / Math.max(1, hFile), e: eBoth / Math.max(1, eFile) };
}
// T4 lysozyme has a small three-stranded sheet that the file records
// draw longer than an H-bond ladder supports, so its strand bar is lower
for (const [f, eMin] of [['1UBQ.pdb.gz', 0.6], ['2LZM.pdb.gz', 0.35], ['1TIM.pdb.gz', 0.6], ['1PGA.pdb.gz', 0.6]]) {
  const a = agreement(f);
  ok(a.q3 > 0.78 && a.h > 0.8 && a.e > eMin, `ss computed vs file ${f}`, `Q3 ${(a.q3 * 100).toFixed(0)}%  helix ${(a.h * 100).toFixed(0)}%  strand ${(a.e * 100).toFixed(0)}%`);
}
{
  const s = parse(load('AF-P04637.pdb.gz'), 'AF-P04637');
  const prot = s.residues.filter(r => r.kind === 'protein');
  ok(s.meta.af, 'alphafold p53 flagged as an AlphaFold model');
  ok(s.ssSource === 'computed', 'alphafold p53 ss computed (no records)');
  const e = prot.filter(r => r.ss === 'E').length, h = prot.filter(r => r.ss === 'H').length;
  ok(e > 40 && h > 15, 'alphafold p53 has the DNA-binding beta sandwich', `E ${e}  H ${h}`);
  const tail = prot.filter(r => r.seq < 60), low = tail.filter(r => s.atoms[r.ca].b < 50).length;
  ok(low > 30, 'alphafold p53 N-terminal pLDDT is low', `${low}/${tail.length} below 50`);
}
{
  const s = parse(load('1AON.pdb.gz'), '1AON');
  const prot = s.residues.filter(r => r.kind === 'protein');
  ok(prot.length > 7000 && prot.every(r => r.atoms.length === 1), 'ca-only 1AON CA trace', `${prot.length} residues`);
  ok(prot.filter(r => r.ss === 'H').length > 2000, 'ca-only 1AON keeps file helices');
  // the CA heuristic on the same chain
  for (const r of s.residues) r.ss = 'C';
  assignSS(s);
  const h = prot.filter(r => r.ss === 'H').length, e = prot.filter(r => r.ss === 'E').length;
  ok(h > 1500 && e > 500, 'ca-only heuristic finds helices and strands', `H ${h}  E ${e}`);
}

// ── presets ─────────────────────────────────────────────────────────────────
{
  const files = new Set(readdirSync(here + 'data'));
  let bad = [];
  const cache = new Map();
  for (const p of PRESETS) {
    if (!files.has(p.file)) { bad.push(p.id + ': no file ' + p.file); continue; }
    let s = cache.get(p.file);
    if (!s) { s = parse(load(p.file), p.file.replace(/\.(pdb|cif)\.gz$/, '')); cache.set(p.file, s); }
    for (const f of [].concat(p.focus || [], p.highlight || [])) {
      if (typeof f === 'string' && f.startsWith('lig:')) { if (!s.residues.some(r => r.name === f.slice(4))) bad.push(`${p.id}: no ligand ${f}`); continue; }
      const [ch, rng] = String(f).split(':');
      const [a, b] = rng === undefined ? [-Infinity, Infinity] : rng.split('-').map(Number).concat(rng.includes('-') ? [] : [Number(rng)]);
      if (!s.residues.some(r => r.chainId === ch && r.seq >= a && r.seq <= b)) bad.push(`${p.id}: no residue ${f}`);
    }
  }
  ok(PRESETS.length >= 25, 'presets count', `${PRESETS.length}`);
  let badGeo = [];
  for (const [f, s] of cache) {
    const g = cartoonGeometry(s, s.pos, { sub: 4, ring: 8 });
    const nv = g.position.length / 3;
    if (!g.position.every(Number.isFinite) || !g.normal.every(Number.isFinite) || g.index.some(i => i >= nv)) badGeo.push(f + ' cartoon');
    const atoms = [];
    s.atoms.forEach((a, i) => { const r = s.residues[a.res]; if ((r.kind === 'protein' || r.kind === 'nucleic') && a.el !== 'H') atoms.push(i); });
    const sf = gaussianSurface(s.pos, atoms, { radius: i => vdw(s.atoms[i].el), maxCells: 4e5 });
    const ns = sf.position.length / 3;
    if (!ns || !sf.position.every(Number.isFinite) || sf.index.some(i => i >= ns) || sf.owner.some(o => o < 0)) badGeo.push(f + ' surface');
  }
  ok(!badGeo.length, `geometry finite for ${cache.size} files`, badGeo.join('; '));
  ok(!bad.length, 'presets files and focus residues exist', bad.join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
