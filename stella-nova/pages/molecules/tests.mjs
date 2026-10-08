// ============================================================================
//  MOLECULES  ·  tests.mjs — node tests.mjs   (no network)
// ────────────────────────────────────────────────────────────────────────────
//  Checks data/library.json against the engine (OpenChemLib 9.25.1 from
//  vendor/) and the page modules that have no DOM:
//    library ...... it decodes; 1,000+ records; no duplicate CID or id
//    smiles ....... every SMILES string parses in the engine
//    formula ...... the engine's formula of each stored structure equals
//                   PubChem's; chem.js molarMass (IUPAC weights) agrees
//                   within 0.01 g/mol (or within the last digit PubChem
//                   prints, when it prints fewer than two decimals);
//                   OpenChemLib's own weights are reported, not asserted
//    stereo ....... the 2D drawing (wedges and hashes) read back by the
//                   engine has PubChem's tetrahedral centres, and its
//                   E/Z double bonds where PubChem gives them
//    3D ........... coordinates for every atom, finite; every bond length
//                   in its chemical range (0.65-1.35 x the sum of the
//                   covalent radii; metal-ligand 0.6-1.5 x)
//    2D ........... finite layout, no two atoms on top of each other,
//                   render2D gives SVG for every record
//    groups ....... the functional-group finder on known molecules
//    molfile ...... toMolfile and toSDF read back in the engine
// ============================================================================
import { readFileSync } from 'node:fs';
import { decode, findGroups, toMolfile, toSDF, el, isMetal, formulaCounts, molarMass } from './chem.js';
import { render2D } from './draw2d.js';
import { recordFrom } from './engine.js';

const here = new URL('.', import.meta.url).pathname;
const V = here + '../../vendor/openchemlib@9.25.1/dist/';
const OCL = await import(V + 'openchemlib.js');
OCL.Resources.register(readFileSync(V + 'resources.json', 'utf8'));
let pass = 0, fail = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const lib = JSON.parse(readFileSync(here + 'data/library.json', 'utf8'));
const recs = lib.m;

// ── library ─────────────────────────────────────────────────────────────────
{
  let bad = [];
  const models = recs.map(r => { try { return decode(r); } catch (e) { bad.push(r.id); return null; } });
  ok(!bad.length, 'library decodes', `${recs.length} records${bad.length ? ', bad: ' + bad.slice(0, 5) : ''}`);
  ok(recs.length >= 1000, 'library size >= 1000', String(recs.length));
  const cids = recs.filter(r => r.cid).map(r => r.cid), ids = recs.map(r => r.id);
  const dupC = cids.filter((c, i) => cids.indexOf(c) !== i), dupI = ids.filter((c, i) => ids.indexOf(c) !== i);
  ok(!dupC.length, 'no duplicate CIDs', dupC.slice(0, 5).join(','));
  ok(!dupI.length, 'no duplicate ids', dupI.slice(0, 5).join(','));
  ok(recs.every(r => r.n && r.c && r.d && r.f && r.w > 0), 'every record has name, category, description, formula, mass');
  globalThis.MODELS = models;
}
const MODELS = globalThis.MODELS;

// ── SMILES ──────────────────────────────────────────────────────────────────
{
  const bad = [];
  for (const r of recs) { try { const m = OCL.Molecule.fromSmiles(r.s); if (!m.getAllAtoms()) bad.push(r.id); } catch (e) { bad.push(r.id); } }
  ok(!bad.length, 'every SMILES parses in OpenChemLib', `${recs.length - bad.length}/${recs.length}${bad.length ? ' bad: ' + bad.slice(0, 8).join(', ') : ''}`);
}

// ── formula, molar mass, stereo ─────────────────────────────────────────────
const strip = f => String(f).replace(/[+-]\d*$/, '').replace(/\./g, '').replace(/D(\d*)/g, 'H$1').replace(/T(\d*)/g, 'H$1');
const hill = f => { const c = {}; for (const [, s, n] of strip(f).matchAll(/([A-Z][a-z]?)(\d*)/g)) c[s] = (c[s] || 0) + (n ? +n : 1); const k = Object.keys(c).sort(); const o = c.C ? ['C', ...(c.H ? ['H'] : []), ...k.filter(x => x !== 'C' && x !== 'H')] : k; return o.map(s => s + (c[s] > 1 ? c[s] : '')).join(''); };
{
  const badF = [], badW = [], loose = [], badT = [], badEZ = [], oclDev = [];
  let nT = 0, nEZ = 0;
  recs.forEach((r, k) => {
    const M = MODELS[k];
    const mol = OCL.Molecule.fromMolfile(toMolfile(M, { dim: 2, noH: true }));
    const mf = mol.getMolecularFormula();
    if (hill(mf.formula) !== hill(r.f)) badF.push(`${r.id} ${mf.formula}/${r.f}`);
    // molar mass: chem.js (IUPAC weights) against PubChem's printed value
    const dec = (String(r.w).split('.')[1] || '').length;
    const tol = Math.max(0.01, dec < 2 ? 10 ** -dec : 0);
    const w = molarMass(M), dw = Math.abs(w - r.w);
    if (dw > tol + 1e-9) badW.push(`${r.id} ${w.toFixed(3)}/${r.w}`);
    else if (dw > 0.01) loose.push(r.id);
    oclDev.push([Math.abs(mf.relativeWeight - r.w), r.id]);
    // stereo: the drawing read back against PubChem's SMILES
    if (r.cid && r.g3 !== 'built' && !/\./.test(r.s)) {
      const ref = OCL.Molecule.fromSmiles(r.s), rs = ref.toIsomericSmiles();
      if (/@/.test(rs)) {
        nT++;
        const flat = x => x.replace(/[\/\\]/g, '');
        if (flat(mol.toIsomericSmiles()) !== flat(rs)) badT.push(r.id);
      }
      if (/[\/\\]/.test(rs)) { nEZ++; if (mol.getIDCode() !== ref.getIDCode()) badEZ.push(r.id); }
    }
  });
  ok(!badF.length, 'engine (OpenChemLib) formula = PubChem formula', badF.length ? `${badF.length} differ: ${badF.slice(0, 6).join('; ')}` : `${recs.length}`);
  ok(!badW.length, 'molar mass (chem.js, IUPAC weights) = PubChem within 0.01 g/mol (or PubChem\'s last printed digit)', badW.length ? `${badW.length} differ: ${badW.slice(0, 6).join('; ')}` : `${recs.length - loose.length} within 0.01; ${loose.length} within PubChem's one-decimal rounding`);
  oclDev.sort((a, b) => b[0] - a[0]);
  const within = oclDev.filter(d => d[0] <= 0.01).length;
  ok(true, 'OpenChemLib relativeWeight vs PubChem (information)', `${within}/${recs.length} within 0.01; largest ${oclDev.slice(0, 3).map(d => d[1] + ' ' + d[0].toFixed(3)).join(', ')}`);
  ok(!badT.length, '2D wedges give the PubChem tetrahedral stereo', `${nT - badT.length}/${nT}${badT.length ? ' differ: ' + badT.slice(0, 10).join(', ') : ''}`);
  ok(!badEZ.length, '2D double-bond geometry gives the PubChem E/Z stereo', `${nEZ - badEZ.length}/${nEZ}${badEZ.length ? ' differ: ' + badEZ.slice(0, 10).join(', ') : ''}`);
}

// ── molar mass of known molecules (the weight table, not the library) ──────
// PubChem's printed molar masses for the eight records that failed the
// 0.01 g/mol check with the 5-figure weights (I 126.9, S 32.07, C 12.011).
{
  const cases = [
    ['thyroxine', 'C1=C(C=C(C(=C1I)OC2=CC(=C(C(=C2)I)O)I)I)C[C@@H](C(=O)O)N', 776.87],
    ['tramadol', 'CN(C)C[C@H]1CCCC[C@@]1(C2=CC(=CC=C2)OC)O', 263.37],
    ['albendazole', 'CCCSC1=CC2=C(C=C1)N=C(N2)NC(=O)OC', 265.33],
    ['atomoxetine', 'CC1=CC=CC=C1O[C@H](CCNC)C2=CC=CC=C2', 255.35],
    ['diphenhydramine', 'CN(C)CCOC(C1=CC=CC=C1)C2=CC=CC=C2', 255.35],
    ['cicutoxin', 'CCC[C@H](/C=C/C=C/C=C/C#CC#CCCCO)O', 258.35],
    ['dapi', 'C1=CC(=CC=C1C2=CC3=C(N2)C=C(C=C3)C(=N)N)C(=N)N', 277.32],
    ['s-adenosylhomocysteine', 'C1=NC(=C2C(=N1)N(C=N2)[C@H]3[C@@H]([C@@H]([C@H](O3)CSCC[C@@H](C(=O)O)N)O)O)N', 384.41],
  ];
  for (const [id, smi, w] of cases) {
    const M = decode(recordFrom(OCL, OCL.Molecule.fromSmiles(smi), { meta: { n: id, s: smi }, keepInput: true }));
    const m = molarMass(M);
    ok(Math.abs(m - w) <= 0.01, `molar mass ${id} = PubChem ${w} within 0.01`, m.toFixed(4));
  }
}

// ── 3D ──────────────────────────────────────────────────────────────────────
{
  const no3 = [], badLen = [];
  recs.forEach((r, k) => {
    const M = MODELS[k];
    if (!M.xyz || M.xyz.length !== 3 * M.N || ![...M.xyz].every(Number.isFinite)) { no3.push(r.id); return; }
    for (const b of M.bonds) {
      const d = Math.hypot(M.xyz[3 * b.a] - M.xyz[3 * b.b], M.xyz[3 * b.a + 1] - M.xyz[3 * b.b + 1], M.xyz[3 * b.a + 2] - M.xyz[3 * b.b + 2]);
      const ref = el(M.z[b.a]).cov + el(M.z[b.b]).cov;
      const metal = isMetal(M.z[b.a]) || isMetal(M.z[b.b]);
      const lo = (metal ? 0.6 : 0.65) * ref, hi = (metal ? 1.5 : 1.35) * ref;
      if (d < lo || d > hi) { badLen.push(`${r.id} ${M.sym[b.a]}${b.a + 1}-${M.sym[b.b]}${b.b + 1} ${d.toFixed(2)}`); break; }
    }
  });
  ok(!no3.length, '3D coordinates for every atom of every record', no3.length ? no3.slice(0, 8).join(', ') : `${recs.length}`);
  ok(!badLen.length, 'bond lengths in chemical ranges', badLen.length ? `${badLen.length} records: ${badLen.slice(0, 8).join('; ')}` : 'all bonds');
  const src = {}; for (const r of recs) src[r.g3 || 'pubchem'] = (src[r.g3 || 'pubchem'] || 0) + 1;
  ok(true, '3D sources', JSON.stringify(src));
}

// ── 2D ──────────────────────────────────────────────────────────────────────
{
  const badXY = [], clash = [], badSvg = [];
  recs.forEach((r, k) => {
    const M = MODELS[k];
    if (![...M.xy].every(Number.isFinite)) { badXY.push(r.id); return; }
    for (let i = 0; i < M.n && clash.length < 50; i++) for (let j = i + 1; j < M.n; j++) if (Math.hypot(M.xy[2 * i] - M.xy[2 * j], M.xy[2 * i + 1] - M.xy[2 * j + 1]) < 0.2) { clash.push(r.id); i = M.n; break; }
    try { const s = render2D(M, { hit: true }).svg; if (!s.startsWith('<svg') || !s.includes('</svg>')) badSvg.push(r.id); } catch (e) { badSvg.push(r.id + ' ' + e.message); }
    try { render2D(M, { lp: 1, hC: 1, hX: 1, cL: 1 }); } catch (e) { badSvg.push(r.id + ' lewis ' + e.message); }
  });
  ok(!badXY.length, '2D layout finite', badXY.join(', '));
  ok(clash.length === 0, 'no two 2D atoms closer than 0.2 bond', clash.slice(0, 10).join(', '));
  ok(!badSvg.length, 'render2D (skeletal and Lewis) for every record', badSvg.slice(0, 5).join('; '));
}

// ── functional groups ───────────────────────────────────────────────────────
{
  const model = smi => decode(recordFrom(OCL, OCL.Molecule.fromSmiles(smi), { meta: { n: smi } }));
  const cases = [
    ['CC(=O)O', ['carboxylic'], ['hydroxyl', 'ketone', 'ether', 'ester']],
    ['CCOC(C)=O', ['ester'], ['ether', 'ketone', 'carboxylic']],
    ['CC(N)=O', ['amide'], ['amine', 'ketone']],
    ['CC(C)=O', ['ketone'], ['aldehyde']],
    ['CC=O', ['aldehyde'], ['ketone']],
    ['CCO', ['hydroxyl'], ['ether', 'phenol']],
    ['Oc1ccccc1', ['phenol', 'aromatic'], ['hydroxyl']],
    ['CCOCC', ['ether'], ['hydroxyl']],
    ['CN', ['amine'], ['amide']],
    ['CC#N', ['nitrile'], ['alkyne', 'amine']],
    ['[O-][N+](=O)c1ccccc1', ['nitro', 'aromatic'], ['amine']],
    ['c1ccccc1', ['aromatic'], ['alkene']],
    ['CCS', ['thiol'], ['sulfide']],
    ['CSC', ['sulfide'], ['thiol']],
    ['C=CC', ['alkene'], ['aromatic']],
    ['CC#C', ['alkyne'], ['nitrile']],
    ['CC(=O)Cl', ['acylhalide'], ['halide', 'ketone']],
    ['CC(=O)OC(C)=O', ['anhydride'], ['ester']],
    ['CCCl', ['halide'], []],
    ['CC(=O)Oc1ccccc1C(=O)O', ['carboxylic', 'ester', 'aromatic'], ['ketone', 'ether']],
    ['CS(=O)(=O)N', ['sulfonyl'], []],
    ['COP(=O)(O)O', ['phosphate'], []],
  ];
  for (const [smi, want, not] of cases) {
    const ids = new Set(findGroups(model(smi)).map(g => g.id));
    const miss = want.filter(w => !ids.has(w)), extra = not.filter(w => ids.has(w));
    ok(!miss.length && !extra.length, `groups ${smi}`, `found [${[...ids].join(', ')}]${miss.length ? ' missing ' + miss : ''}${extra.length ? ' extra ' + extra : ''}`);
  }
}

// ── molfile ─────────────────────────────────────────────────────────────────
{
  let bad = [];
  for (const [k, r] of recs.entries()) {
    if (k % 7) continue;
    const M = MODELS[k];
    const a = OCL.Molecule.fromMolfile(toMolfile(M)), b = OCL.Molecule.fromMolfile(toSDF(M).split('$$$$')[0]);
    if (a.getAllAtoms() !== M.N || b.getAllAtoms() !== M.N) bad.push(r.id);
    void formulaCounts;
  }
  ok(!bad.length, 'MOL and SDF export read back (every 7th record)', bad.slice(0, 5).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
