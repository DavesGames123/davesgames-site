// ============================================================================
//  ALPHAFOLD EXPLAINED  ·  data builder  (Node, run by hand)
// ----------------------------------------------------------------------------
//  Reads the AlphaFold DB entry for human SUMO1 (UniProt P63165, 101
//  residues) and writes data.js. The page imports data.js and loads no
//  structure file at run time.
//
//  GET THE INPUT FILES (AlphaFold DB, CC-BY 4.0):
//      d="$(mktemp -d)" && cd "$d" && for f in model_v6.pdb \
//        predicted_aligned_error_v6.json; do curl -sSO \
//        "https://alphafold.ebi.ac.uk/files/AF-P63165-F1-$f"; done
//  RUN:
//      node <repo>/stella-nova/pages/alphafold-explained/build-data.mjs "$d"
//
//  WHAT IS REAL AND WHAT IS NOT
//    real ....... sequence, all heavy atoms, pLDDT (B-factor column) and the
//                 PAE matrix, as AlphaFold DB publishes them.
//    synthetic .. the MSA. AlphaFold DB does not serve its MSA to scripts.
//                 makeMsa() evolves 512 sequences on a two-level tree. Rates
//                 come from burial and pLDDT. About 30 contact pairs mutate
//                 together, so a coupling score can find them. The page
//                 labels the MSA as synthetic.
//
//  SECTION MAP   (jump with grep -n "<anchor>" build-data.mjs)
//      pdb parse ....... "function parsePdb"
//      virtual C-beta .. "function cbeta"
//      synthetic MSA ... "function makeMsa"
//      output .......... "const out"
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node build-data.mjs <dir with AF-P63165-F1 files>'); process.exit(1); }
const pdbText = readFileSync(join(dir, 'AF-P63165-F1-model_v6.pdb'), 'utf8');
const paeJson = JSON.parse(readFileSync(join(dir, 'AF-P63165-F1-predicted_aligned_error_v6.json'), 'utf8'));

const AA3 = { ALA:'A',ARG:'R',ASN:'N',ASP:'D',CYS:'C',GLN:'Q',GLU:'E',GLY:'G',HIS:'H',ILE:'I',LEU:'L',LYS:'K',MET:'M',PHE:'F',PRO:'P',SER:'S',THR:'T',TRP:'W',TYR:'Y',VAL:'V' };
const EL = ['C', 'N', 'O', 'S'];

// One record for each residue: name, backbone atoms, pLDDT, heavy atoms.
function parsePdb(text) {
  const res = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('ATOM')) continue;
    const name = line.slice(12, 16).trim(), rn = line.slice(17, 20), seq = +line.slice(22, 26);
    const x = +line.slice(30, 38), y = +line.slice(38, 46), z = +line.slice(46, 54), b = +line.slice(60, 66);
    const el = line.slice(76, 78).trim();
    let r = res[res.length - 1];
    if (!r || r.seq !== seq) { r = { seq, aa: AA3[rn], atoms: [], plddt: b }; res.push(r); }
    r[name] = [x, y, z];
    r.atoms.push({ name, el, p: [x, y, z] });
  }
  return res;
}

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);

// Virtual C-beta from N, CA, C. These are the constants AlphaFold uses for
// its pseudo-beta. Glycine has no CB atom, so all residues use this.
function cbeta(r) {
  const b = sub(r.CA, r.N), c = sub(r.C, r.CA), a = cross(b, c);
  return [0, 1, 2].map(k => -0.58273431*a[k] + 0.56802827*b[k] - 0.54067466*c[k] + r.CA[k]);
}

const res = parsePdb(pdbText);
const L = res.length;
const seq = res.map(r => r.aa).join('');
// Center on the mean CA of the folded core (pLDDT >= 70).
const core = res.filter(r => r.plddt >= 70);
const ctr = [0, 1, 2].map(k => core.reduce((s, r) => s + r.CA[k], 0) / core.length);
const cen = p => p.map((v, k) => Math.round((v - ctr[k]) * 100) / 100);
for (const r of res) { r.CB = cbeta(r); }

// ---------------------------------------------------------------- MSA
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20211);
const GROUPS = ['AGS', 'ST', 'DE', 'NQ', 'KR', 'KRH', 'ILVM', 'FYW', 'LF', 'C', 'P', 'NDE', 'QEK'];
const BG = 'AAAAAAAARRRRRNNNNDDDDDCCQQQQEEEEEEGGGGGGGHHIIIIIILLLLLLLLLKKKKKKMMFFFFPPPPSSSSSSTTTTTWYYYVVVVVV';
function substitute(a) {
  if (R() < 0.6) {
    const gs = GROUPS.filter(g => g.includes(a) && g.length > 1);
    if (gs.length) { const g = gs[Math.floor(R() * gs.length)].replace(a, ''); return g[Math.floor(R() * g.length)]; }
  }
  let b; do { b = BG[Math.floor(R() * BG.length)]; } while (b === a);
  return b;
}

function makeMsa(N) {
  const cb = res.map(r => r.CB);
  const burial = cb.map(p => cb.filter(q => dist(p, q) < 10).length - 1);
  const maxB = Math.max(...burial);
  const rate = res.map((r, i) => {
    if (r.plddt < 60) return 1.7;
    let v = 1.15 - 0.95 * (burial[i] / maxB);
    if (r.aa === 'G' || r.aa === 'P') v *= 0.55;
    return Math.max(0.12, v);
  });
  // Coupled pairs: long-range contacts in the confident core. Each residue
  // is in at most one pair.
  const cand = [];
  for (let i = 0; i < L; i++) for (let j = i + 6; j < L; j++)
    if (res[i].plddt > 70 && res[j].plddt > 70 && dist(cb[i], cb[j]) < 8) cand.push([i, j]);
  for (let k = cand.length - 1; k > 0; k--) { const m = Math.floor(R() * (k + 1)); [cand[k], cand[m]] = [cand[m], cand[k]]; }
  const used = new Set(), pairs = [];
  const STATES = ['KE', 'EK', 'RD', 'DR', 'LA', 'AL', 'FG', 'GF', 'VI', 'IV', 'ST', 'YA', 'AY', 'WG', 'MA', 'QK', 'NR'];
  for (const [i, j] of cand) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i); used.add(j);
    const alts = [STATES[Math.floor(R() * STATES.length)]];
    if (R() < 0.5) alts.push(STATES[Math.floor(R() * STATES.length)]);
    pairs.push({ i, j, alts, rate: Math.min(1.2, (rate[i] + rate[j]) / 2 + 0.35) });
  }
  // A sequence is an array of letters plus the state of each pair.
  const evolve = (par, d) => {
    const s = par.s.slice(), st = par.st.slice();
    for (let i = 0; i < L; i++) if (R() < 1 - Math.exp(-d * rate[i])) s[i] = substitute(s[i]);
    pairs.forEach((p, k) => { if (R() < 1 - Math.exp(-d * p.rate)) st[k] = Math.floor(R() * (p.alts.length + 1)); });
    return { s, st };
  };
  const apply = q => {
    const s = q.s.slice();
    pairs.forEach((p, k) => { if (q.st[k] > 0) { const a = p.alts[q.st[k] - 1]; s[p.i] = a[0]; s[p.j] = a[1]; } });
    return s;
  };
  const root = { s: seq.split(''), st: pairs.map(() => 0) };
  const clades = Array.from({ length: 40 }, () => evolve(root, 0.15 + 0.75 * R()));
  const rows = [seq];
  while (rows.length < N) {
    const c = clades[Math.floor(R() * clades.length)];
    const s = apply(evolve(c, 0.03 + 0.3 * R()));
    // Homologs often lack the disordered tails, and loops take gaps.
    if (R() < 0.6) { const cut = Math.floor(R() * 20); for (let i = 0; i < cut; i++) s[i] = '-'; }
    if (R() < 0.5) { const cut = Math.floor(R() * 9); for (let i = L - cut; i < L; i++) s[i] = '-'; }
    for (let i = 20; i < L - 9; i++) if (rate[i] > 0.75 && R() < 0.01) { const n = 1 + Math.floor(R() * 3); for (let k = 0; k < n && i + k < L; k++) s[i + k] = '-'; }
    rows.push(s.join(''));
  }
  const ident = r => { let m = 0; for (let i = 0; i < L; i++) if (r[i] === seq[i]) m++; return m / L; };
  const sorted = [rows[0], ...rows.slice(1).sort((a, b) => ident(b) - ident(a))];
  return { rows: sorted, pairs: pairs.map(p => [p.i, p.j]) };
}
const msa = makeMsa(512);

// ---------------------------------------------------------------- output
const pae = paeJson[0].predicted_aligned_error;
const atoms = [];
res.forEach((r, i) => r.atoms.forEach(a => atoms.push(...cen(a.p), EL.indexOf(a.el), i, a.name === 'CA' ? 1 : 0)));
const out = {
  id: 'AF-P63165-F1-model_v6',
  name: 'SUMO1 (human small ubiquitin-related modifier 1)',
  seq,
  N: res.flatMap(r => cen(r.N)), CA: res.flatMap(r => cen(r.CA)), C: res.flatMap(r => cen(r.C)), CB: res.flatMap(r => cen(r.CB)),
  plddt: res.map(r => r.plddt),
  pae: pae.flat(),
  atoms,
  msa: msa.rows,
  msaPlantedPairs: msa.pairs,
};
const js = `// ============================================================================
//  ALPHAFOLD EXPLAINED  ·  data  (GENERATED by build-data.mjs)
// ----------------------------------------------------------------------------
//  Do not edit by hand. Run build-data.mjs again.
//  Structure, pLDDT and PAE: AlphaFold DB entry ${out.id}
//  (UniProt P63165), CC-BY 4.0. Coordinates in Å, centered on the core.
//  atoms: [x, y, z, element (0 C 1 N 2 O 3 S), residue index, isCA] per atom.
//  msa: SYNTHETIC, made by makeMsa() in build-data.mjs. Row 0 is the query.
// ============================================================================
export const PROT = ${JSON.stringify(out)};
`;
const dest = fileURLToPath(new URL('./data.js', import.meta.url));
writeFileSync(dest, js);
console.log('wrote', dest, js.length, 'bytes');
console.log('residues', L, 'atoms', atoms.length / 6, 'msa rows', msa.rows.length, 'planted pairs', msa.pairs.length);
console.log('mean pLDDT', (out.plddt.reduce((a, b) => a + b, 0) / L).toFixed(2), 'pae max', Math.max(...out.pae));
