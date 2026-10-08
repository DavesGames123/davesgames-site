// ============================================================================
//  MOLECULES  ·  build/build.mjs — write data/library.json from the cache
// ----------------------------------------------------------------------------
//  Reads build/list.tsv and the PubChem cache that build/fetch.py wrote,
//  turns each compound into a chem.js record with engine.js (OpenChemLib in
//  Node), and writes ../data/library.json. It sends no network request.
//
//    python3 -I build/fetch.py <cache>      (first, once)
//    node build/build.mjs <cache>           (prints a report to stderr)
//
//  Steps for each list row
//    1. the CID: cache/name/<query>.txt, or cid:<n> in the list
//    2. the 2D record (connectivity, charges, stereo) and the 3D conformer
//    3. special.mjs: metal complexes that PubChem stores as separate ions
//       get their metal-ligand bonds and a built geometry; built records
//       (the G-C base pair) come from special.mjs alone
//    4. engine.js recordFrom: the 2D layout, the 3D coordinates (PubChem's,
//       else an OpenChemLib conformer), rings, properties
//  For the hand-built entries of special.mjs, the record field dn holds
//  the note on how the bonding is drawn; the page shows it after d.
//  A row whose CID repeats an earlier row is dropped (the list order is
//  the category priority). A row that fails is reported and dropped.
//  Each record is also kept in <cache>/rec/<cid>.json; MOL_REUSE=1 reuses
//  them (only the list text changes), MOL_TRACE=1 logs each record.
//
//  grep -n targets: "function synonyms", "function main", "REPORT"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { recordFrom } from '../engine.js';
import { slug, decode } from '../chem.js';
import { fixRecord, builtRecords, handNote } from './special.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const VENDOR = path.join(HERE, '../../../vendor/openchemlib@9.25.1/dist/');
const OCL = await import(path.join(VENDOR, 'openchemlib.js'));
OCL.Resources.register(fs.readFileSync(path.join(VENDOR, 'resources.json'), 'utf8'));

const cache = process.argv[2];
if (!cache) { console.error('usage: node build/build.mjs <cache-dir>'); process.exit(2); }
const read = (...p) => { try { return fs.readFileSync(path.join(cache, ...p), 'utf8'); } catch (e) { return null; } };

// Synonyms worth showing: short names, not registry numbers or codes.
function synonyms(list, name) {
  const out = [], seen = new Set([name.toLowerCase()]);
  for (const s of list || []) {
    if (out.length >= 6) break;
    const k = s.toLowerCase();
    if (seen.has(k) || s.length > 36 || s.length < 3) continue;
    if (/^\d+-\d+-\d$/.test(s) || /^[A-Z0-9]{8,}$/.test(s) || /^(CHEBI|CHEMBL|DTXSID|DTXCID|UNII|NSC|EINECS|HSDB|CCRIS|BRN|AI3|SCHEMBL|ZINC|MFCD|AKOS|NCGC|BDBM|HY-|CS-|EC |CAS|FEMA|InChI|Q\d)/i.test(s)) continue;
    if ((s.match(/\d/g) || []).length > 6 || /[\[\]{}]/.test(s)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}

function main() {
  const rows = fs.readFileSync(path.join(HERE, 'list.tsv'), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('\t'));
  const out = [], fails = [], seenCid = new Map(), seenId = new Set(), dup = [];
  const t0 = Date.now();
  for (const [cat, name, query, desc, fam] of rows) {
    let cid = null;
    if (/^cid:\d+$/.test(query)) cid = +query.slice(4);
    else { const t = read('name', encodeURIComponent(query.toLowerCase()).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) + '.txt'); const f = t && t.trim().split('\n')[0].trim(); cid = /^\d+$/.test(f || '') ? +f : null; }
    if (!cid) { fails.push([name, query, 'no CID']); continue; }
    if (seenCid.has(cid)) { dup.push([name, seenCid.get(cid)]); continue; }
    const prop = JSON.parse(read('prop', cid + '.json') || 'null');
    const sdf2 = read('sdf2d', cid + '.sdf'), sdf3 = read('sdf3d', cid + '.sdf');
    if (!prop || !sdf2 || sdf2.startsWith('none')) { fails.push([name, query, 'no record']); continue; }
    let id = slug(name); while (seenId.has(id)) id += '-' + cid;
    const meta = { id, n: name, c: cat, d: desc, cid, f: prop.MolecularFormula, w: +(+prop.MolecularWeight).toFixed(3), iu: prop.IUPACName || '', s: prop.SMILES || '',
      sy: synonyms(JSON.parse(read('syn', cid + '.json') || '[]'), name), fam: fam === '1' };
    const tr = Date.now();
    const rc = path.join(cache, 'rec', cid + '.json');
    if (process.env.MOL_REUSE && fs.existsSync(rc)) {
      const rec = Object.assign(JSON.parse(fs.readFileSync(rc, 'utf8')), { id, n: name, c: cat, d: desc });
      if (fam === '1') rec.fam = 1; else delete rec.fam;
      if (handNote(cid)) rec.dn = handNote(cid); else delete rec.dn;
      out.push(rec); seenCid.set(cid, name); seenId.add(id); continue;
    }
    if (process.env.MOL_TRACE) console.error(`> ${name}`);
    try {
      let mol = OCL.Molecule.fromMolfile(sdf2);
      let mol3d = sdf3 && !sdf3.startsWith('none') ? OCL.Molecule.fromMolfile(sdf3) : null;
      const fx = fixRecord(OCL, cid, mol, meta, !!mol3d);
      let rec;
      if (fx && fx.rec) rec = fx.rec;
      else { if (fx && fx.mol) { mol = fx.mol; mol3d = fx.mol3d || null; } rec = recordFrom(OCL, mol, { mol3d, meta, inputLayout: !fx, keepInput: !!fx }); }
      if (fx && fx.after) fx.after(rec);
      if (handNote(cid)) rec.dn = handNote(cid);   // how the bonding is drawn (shown after d)
      out.push(rec); seenCid.set(cid, name); seenId.add(id);
      fs.mkdirSync(path.dirname(rc), { recursive: true }); fs.writeFileSync(rc, JSON.stringify(rec));
      if (process.env.MOL_TRACE) console.error(`  ${out.length} ${name} ${Date.now() - tr} ms ${rec.g3}`);
    } catch (e) { fails.push([name, query, String(e && e.message || e).slice(0, 120)]); }
  }
  for (const rec of builtRecords(OCL)) { out.push(rec); seenId.add(rec.id); }
  const lib = { v: 1, source: 'PubChem (NCBI), public domain; 2D layout, conformers and properties by OpenChemLib 9.25.1', count: out.length, m: out };
  const file = path.join(HERE, '../data/library.json');
  fs.writeFileSync(file, JSON.stringify(lib));
  // REPORT
  const by = {}; for (const r of out) by[r.c] = (by[r.c] || 0) + 1;
  const g3 = {}; for (const r of out) g3[r.g3 || 'pubchem'] = (g3[r.g3 || 'pubchem'] || 0) + 1;
  console.error(`records ${out.length}  (rows ${rows.length}, duplicates ${dup.length}, failed ${fails.length})  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.error('per category ' + JSON.stringify(by));
  console.error('3D source ' + JSON.stringify(g3));
  console.error(`size ${fs.statSync(file).size} bytes`);
  for (const f of fails) console.error('FAIL ' + f.join(' | '));
  for (const d of dup) console.error('DUP  ' + d[0] + ' = ' + d[1]);
  void decode;
}
main();
