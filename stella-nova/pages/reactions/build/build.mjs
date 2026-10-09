// ============================================================================
//  REACTIONS  ·  build/build.mjs — writes data/species.json   (node, offline)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/reactions/build/build.mjs
//  For each SPECIES key of templates.js: the Molecule Explorer library
//  record when its structure (no stereo) is the same, so the 3D model is
//  the PubChem conformer (public domain); else a record made by
//  OpenChemLib (BSD-3) with a generated MMFF94s+ conformer. Also writes the
//  name index of the whole library (ID code -> [id, name]).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { recordFrom } from '../../molecules/engine.js';
import { SPECIES } from '../templates.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const VENDOR = path.join(HERE, '../../../vendor/openchemlib@9.25.1/dist/');
const OCL = await import(path.join(VENDOR, 'openchemlib.js'));
OCL.Resources.register(fs.readFileSync(path.join(VENDOR, 'resources.json'), 'utf8'));
const lib = JSON.parse(fs.readFileSync(path.join(HERE, '../../molecules/data/library.json'), 'utf8')).m;

const idOf = s => { const m = OCL.Molecule.fromSmiles(s); m.stripStereoInformation(); return m.getIDCode(); };
const names = [], libBy = new Map();
for (const r of lib) {
  if (!r.s) continue;
  let id; try { id = idOf(r.s); } catch (e) { continue; }
  if (!libBy.has(id)) { libBy.set(id, r); names.push([id, [r.id, r.n]]); }
}
const species = {}, keys = {};
let fromLib = 0, made = 0;
for (const [k, [smi, name]] of Object.entries(SPECIES)) {
  const id = idOf(smi);
  keys[k] = id;
  const L = libBy.get(id);
  if (L && L.p3) { species[k] = Object.assign({}, L, { n: name, lib: L.id }); fromLib++; continue; }
  const mol = OCL.Molecule.fromSmiles(smi);
  species[k] = recordFrom(OCL, mol, { meta: { id: 'rx-' + k, n: name, s: smi, c: 'custom', d: '' } });
  made++;
}
const out = { v: 1, source: 'templates.js SPECIES; Molecule Explorer library (PubChem, public domain); OpenChemLib 9.25.1 (BSD-3)', species, keys, names };
fs.writeFileSync(path.join(HERE, '../data/species.json'), JSON.stringify(out));
console.log(`species ${Object.keys(species).length} (library ${fromLib}, generated ${made}); name index ${names.length}`);
