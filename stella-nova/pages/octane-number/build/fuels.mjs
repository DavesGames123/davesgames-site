#!/usr/bin/env node
// ============================================================================
//  OCTANE NUMBER  ·  build/fuels.mjs — writes data/fuels.json
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/octane-number/build/fuels.mjs
//  The page shows 18 fuel molecules in the Molecule Explorer 3D view.
//  This script copies 13 records from the Molecule Explorer library
//  (molecules/data/library.json) without change. It makes the other 5
//  (MAKE below) with the same engine.js recordFrom() and OpenChemLib
//  9.25.1 that build the library, from the PubChem SMILES. Their 3D
//  coordinates are OpenChemLib conformers (g3 'ocl').
//  The record format is the one of molecules/chem.js. The RON and MON
//  values are not in this file: they are in data.js, with their source.
//
//  grep -n targets: "const COPY", "const MAKE"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { recordFrom } from '../../molecules/engine.js';
import { decode } from '../../molecules/chem.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const VENDOR = path.join(HERE, '../../../vendor/openchemlib@9.25.1/dist/');
const LIB = path.join(HERE, '../../molecules/data/library.json');
const OUT = path.join(HERE, '../data/fuels.json');

// Library ids, used as they are.
const COPY = ['heptane', 'isooctane', 'hexane', 'pentane', 'butane', 'isobutane', 'propane', 'methane',
  'benzene', 'toluene', 'p-xylene', 'ethanol', 'methanol'];

// Not in the library. CID, SMILES, formula, mass and IUPAC name from
// PubChem PUG-REST (2026-10-23).
const MAKE = [
  { id: 'octane', n: 'Octane', cid: 356, s: 'CCCCCCCC', f: 'C8H18', w: 114.23, iu: 'octane', d: 'The straight eight-carbon alkane; it knocks more easily than heptane, so its octane number is below zero.' },
  { id: '2-methylheptane', n: '2-Methylheptane', cid: 11594, s: 'CCCCCC(C)C', f: 'C8H18', w: 114.23, iu: '2-methylheptane', d: 'Octane with one branch at the end of the chain; still a long run of CH2 groups.' },
  { id: '2-methylhexane', n: '2-Methylhexane', cid: 11582, s: 'CCCCC(C)C', f: 'C7H16', w: 100.2, iu: '2-methylhexane', d: 'An isomer of heptane with one methyl branch.' },
  { id: '2,3,3-trimethylpentane', n: '2,3,3-Trimethylpentane', cid: 11215, s: 'CCC(C)(C)C(C)C', f: 'C8H18', w: 114.23, iu: '2,3,3-trimethylpentane', d: 'A compact, highly branched isomer of octane; it resists knock better than iso-octane.' },
  { id: 'ethylbenzene', n: 'Ethylbenzene', cid: 7500, s: 'CCC1=CC=CC=C1', f: 'C8H10', w: 106.16, iu: 'ethylbenzene', d: 'A benzene ring with an ethyl group; an aromatic part of gasoline.' },
];

const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'));
const byId = new Map(lib.m.map(r => [r.id, r]));
const recs = [];
for (const id of COPY) {
  const r = byId.get(id);
  if (!r) throw new Error(`library has no ${id}`);
  recs.push(r);
}

const OCL = await import(path.join(VENDOR, 'openchemlib.js'));
OCL.Resources.register(fs.readFileSync(path.join(VENDOR, 'resources.json'), 'utf8'));
for (const m of MAKE) {
  const mol = OCL.Molecule.fromSmiles(m.s);
  const r = recordFrom(OCL, mol, { meta: { ...m, c: 'fuels', sy: [] } });
  recs.push(r);
}

// Every record must decode, and the formula must match its atoms.
for (const r of recs) {
  const M = decode(r);
  const c = {}; for (const z of M.z) c[z] = (c[z] || 0) + 1;
  const f = `C${c[6] || 0}H${c[1] || 0}`;
  if (!r.f.startsWith(f.replace(/C1H/, 'CH'))) throw new Error(`${r.id}: atoms give ${f}, record says ${r.f}`);
}

const out = { v: 1, source: 'Molecule Explorer library (PubChem, public domain) and OpenChemLib 9.25.1 conformers; see build/fuels.mjs', count: recs.length, m: recs };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`fuels.json: ${recs.length} records, ${fs.statSync(OUT).size} bytes`);
