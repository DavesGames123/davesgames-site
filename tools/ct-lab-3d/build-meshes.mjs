// ============================================================================
//  CT LAB 3D  ·  tools/ct-lab-3d/build-meshes.mjs — glTF models to CT objects
// ----------------------------------------------------------------------------
//  Turns open-licence glTF models into the CT objects of the CT Lab 3D page:
//  a 128^3 volume of attenuation codes (uint8, code = round(255 mu / muMax),
//  mu in 1/cm at 70 keV) in stella-nova/pages/ct-lab-3d/data/<id>.bin, and an
//  entry in data/objects.json. tools/ct-lab-3d/volumes.py makes the entries
//  of the real CT volumes (walnut, rabbit) in the same format.
//
//  Usage (from the repo root; MODELS is a folder with the Khronos
//  glTF-Sample-Assets model folders, each with its .gltf, .bin and LICENSE.md):
//    node tools/ct-lab-3d/build-meshes.mjs MODELS [id ...]
//
//  The models come from https://github.com/KhronosGroup/glTF-Sample-Assets
//  (folder Models/<Name>/glTF). Only geometry is read: no texture, no logo.
//  Each object below lists its licence, and the page credits it.
//
//  Materials are engine COMPOSITIONS names (ct-lab/engine/physics.js). The
//  page uses the anchors [code, composition] for polychromatic scans (beam
//  hardening, metal streaks).
//
//  grep handles: OBJECTS, function build, function anchorsOf, function writeObject
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGltf, meshInfo, voxelizeObject } from '../../stella-nova/pages/ct-lab-3d/lib/voxelize.js';
import { COMPOSITIONS, muOfComposition } from '../../stella-nova/pages/ct-lab/engine/physics.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'stella-nova', 'pages', 'ct-lab-3d', 'data');
const N = 128;

// own compositions (water, bone, iron basis density fractions), added to the engine table
const EXTRA = { amber: [1.07, 0, 0], chitin: [1.3, 0, 0], porcelain: [0, 1.25, 0], coal: [1.35, 0, 0], carbon: [1.55, 0, 0] };
const comp = (name) => COMPOSITIONS[name] || EXTRA[name];
const mu70 = (name) => { const c = comp(name); return muOfComposition(c, 70); };

// spec: (part) -> { mat, mode, thick } | null. thick in output voxels.
export const OBJECTS = [
  {
    id: 'skull', name: 'Human skull', model: 'ScatteringSkull', longestCm: 21,
    licence: 'CC0-1.0', author: 'Skull by Vladimir Petkovic, Khronos glTF Sample Assets (ScatteringSkull)',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ScatteringSkull',
    blurb: 'A surface scan of a skull, rebuilt as a 6 mm bone wall around air.',
    spec: () => ({ mat: 'bone', mode: 'hollow', thick: 4 }),
  },
  {
    id: 'watch', name: 'Chronograph watch', model: 'ChronographWatch', longestCm: 6.2,
    licence: 'CC-BY-4.0', author: 'Chronograph Watch by Eric Chadwick (Darmstadt Graphics Group), from "Chronograph Watch Mudmaster" by graphiccompressor, Khronos glTF Sample Assets',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ChronographWatch',
    blurb: 'A steel case, a glass face, plastic and carbon bands. Steel makes metal streaks.',
    spec: (p) => {
      const n = p.name.toLowerCase(), m = p.material.toLowerCase();
      if (n.startsWith('glass')) return { mat: 'glass', mode: 'shell', thick: 2 };
      if (n.startsWith('band carbon')) return { mat: 'carbon', mode: 'shell', thick: 2 };
      if (n.startsWith('band plastic')) return { mat: 'rubber', mode: 'shell', thick: 2 };
      if (n.startsWith('button plastic')) return { mat: 'plastic', mode: 'shell', thick: 2 };
      if (n.startsWith('hand')) return { mat: m.includes('plastic') ? 'plastic' : 'steel', mode: 'shell', thick: 1 };
      if (n.startsWith('watch face')) return { mat: 'aluminium', mode: 'shell', thick: 2 };
      if (n.startsWith('clasp')) return { mat: 'steel', mode: 'solid' };
      return { mat: 'steel', mode: 'shell', thick: 2 };   // backplate, bezel, metal buttons
    },
  },
  {
    id: 'amber', name: 'Mosquito in amber', model: 'MosquitoInAmber', longestCm: 3.2,
    licence: 'CC-BY-4.0', author: 'Loïc Norgeot (model) and Geoffrey Marchal (mosquito scan), via Sketchfab and the Khronos glTF Sample Assets',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MosquitoInAmber',
    blurb: 'A resin block with an insect inside: air fills its body, chitin its skin.', thumb: 'slice',
    // order matters: the block, then the insect body as air, then its skin, then the cracks
    order: (parts) => [parts.findIndex((p) => /amber/i.test(p.name)), parts.findIndex((p) => /mosquito/i.test(p.name)), parts.findIndex((p) => /mosquito/i.test(p.name)), parts.findIndex((p) => /eclats/i.test(p.name))],
    specs: [{ mat: 'amber', mode: 'solid' }, { mat: 'air', mode: 'shell', thick: 3 }, { mat: 'chitin', mode: 'shell', thick: 1 }, { mat: 'air', mode: 'shell', thick: 1 }],
  },
  {
    id: 'teacup', name: 'Teacup and saucer', model: 'DiffuseTransmissionTeacup', longestCm: 15,
    licence: 'CC0-1.0', author: 'Diffuse Transmission Teacup by Poly Haven and Eric Chadwick, Khronos glTF Sample Assets',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DiffuseTransmissionTeacup',
    blurb: 'Thin porcelain walls: a test of how well the scan keeps a thin edge.',
    spec: () => ({ mat: 'porcelain', mode: 'solid' }),
  },
  {
    id: 'toycar', name: 'Toy car on a cloth', model: 'ToyCar', longestCm: 9,
    licence: 'CC0-1.0', author: 'Toy Car by Guido Odendahl and Eric Chadwick, Khronos glTF Sample Assets',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar',
    blurb: 'A plastic car with glass windows on a fold of fabric.',
    spec: (p) => /glass/i.test(p.name) ? { mat: 'glass', mode: 'shell', thick: 1 }
      : /fabric/i.test(p.name) ? { mat: 'rubber', mode: 'shell', thick: 2 } : { mat: 'plastic', mode: 'shell', thick: 2 },
  },
  {
    id: 'pot', name: 'Copper pot of coals', model: 'PotOfCoals', longestCm: 16,
    licence: 'CC-BY-4.0', author: 'Pot of Coals by Eric Chadwick (Darmstadt Graphics Group), Khronos glTF Sample Assets',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/PotOfCoals',
    blurb: 'Dense copper around light coals: the classic metal-artefact case.',
    order: (parts) => [parts.findIndex((p) => /pot/i.test(p.name)), parts.findIndex((p) => /coal/i.test(p.name))],
    specs: [{ mat: 'copper', mode: 'shell', thick: 2 }, { mat: 'coal', mode: 'solid' }],
  },
];

// anchors [code, composition] sorted by code, for the page's basis split
function anchorsOf(mats, muMax) {
  const list = [['air', 0]].concat([...new Set(mats)].filter((m) => m !== 'air').map((m) => [m, mu70(m)]));
  return list.map(([m, mu]) => [Math.round(255 * mu / muMax), m, comp(m)]).sort((a, b) => a[0] - b[0]);
}

function writeObject(o, vol, mats, extra) {
  let muMax = 0;
  for (const m of mats) muMax = Math.max(muMax, mu70(m));
  muMax *= 1.02;
  const code = new Uint8Array(vol.data.length);
  for (let i = 0; i < code.length; i++) code[i] = Math.max(0, Math.min(255, Math.round(255 * vol.data[i] / muMax)));
  writeFileSync(path.join(OUT, o.id + '.bin'), code);
  return {
    id: o.id, name: o.name, kind: 'mesh', file: o.id + '.bin', dims: [vol.nx, vol.ny, vol.nz], widthCm: +vol.width.toFixed(3),
    muMax: +muMax.toFixed(5), anchors: anchorsOf(mats, muMax), blurb: o.blurb, ...(o.thumb ? { thumb: o.thumb } : {}),
    credit: { author: o.author, licence: o.licence, source: o.source, changes: 'Geometry only, turned into a voxel volume with assigned materials by tools/ct-lab-3d/build-meshes.mjs.' },
    ...extra,
  };
}

export function build(modelsDir, o) {
  const dir = path.join(modelsDir, o.model);
  const json = JSON.parse(readFileSync(path.join(dir, o.model + '.gltf'), 'utf8'));
  const lic = readFileSync(path.join(dir, 'LICENSE.md'), 'utf8');
  const spdx = o.licence;
  if (!lic.includes(`"${spdx}"`)) throw new Error(`${o.id}: LICENSE.md does not name ${spdx}`);
  const bufs = json.buffers.map((b) => new Uint8Array(readFileSync(path.join(dir, b.uri))));
  let parts = parseGltf(json, bufs), specs;
  if (o.order) { const idx = o.order(parts); parts = idx.map((i) => parts[i]); specs = o.specs; }
  else specs = parts.map((p) => o.spec(p));
  const longest = (() => { let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of parts) { const m = meshInfo(p); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.lo[k]); hi[k] = Math.max(hi[k], m.hi[k]); } } return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]); })();
  const cmPerUnit = o.longestCm / longest;
  const t0 = performance.now();
  const r = voxelizeObject(parts, (p, i) => { const s = specs[i]; return s && { mu: mu70(s.mat), mode: s.mode, thick: s.thick }; }, { n: N, ss: 2 });
  r.volume.width = r.box.edge * cmPerUnit;
  const entry = writeObject(o, r.volume, specs.filter(Boolean).map((s) => s.mat), {});
  console.log(`${o.id}: ${parts.length} parts, ${Math.round(performance.now() - t0)} ms, width ${entry.widthCm} cm`);
  for (const p of r.parts) console.log(`   ${p.name.slice(0, 30).padEnd(30)} ${p.mode.padEnd(6)} mu ${p.mu.toFixed(3)} filled ${p.filled}`);
  return entry;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const models = process.argv[2];
  if (!models || !existsSync(models)) { console.error('usage: node tools/ct-lab-3d/build-meshes.mjs MODELS [id ...]'); process.exit(2); }
  const want = process.argv.slice(3);
  const manifestPath = path.join(OUT, 'objects.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { objects: [] };
  for (const o of OBJECTS) {
    if (want.length && !want.includes(o.id)) continue;
    const e = build(models, o);
    const i = manifest.objects.findIndex((x) => x.id === e.id);
    if (i >= 0) manifest.objects[i] = { ...manifest.objects[i], ...e }; else manifest.objects.push(e);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
  console.log('wrote', manifestPath);
}
