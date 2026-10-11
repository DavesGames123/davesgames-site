// ============================================================================
//  FLY DUEL  ·  build the mushroom body neuropil outline  (node tool)
// ----------------------------------------------------------------------------
//  Writes data/neuropil-hemibrain.json: the surface meshes of the right
//  mushroom body ROIs (calyx, pedunculus, five lobes) and the right
//  antennal lobe from the Janelia FlyEM hemibrain v1.2 ROI meshes. The
//  brain map (ui/fly3d/brain3d.js) draws them as a crisp edge outline.
//
//  SOURCE.  Public bucket, no token:
//      https://storage.googleapis.com/neuroglancer-janelia-flyem-hemibrain/v1.2/rois/
//  mesh/info says "neuroglancer_multilod_draco", 16 bit vertex
//  quantization, transform = 256 nm per stored unit. Each ROI id has a
//  manifest (mesh/<id>.index) and the Draco fragments (mesh/<id>). The ROI
//  names come from rois/segment_properties/info. Licence: the hemibrain
//  data is CC BY 4.0 (https://www.janelia.org/project-team/flyem/hemibrain).
//  Credit: NEUROPIL-CREDITS.md at the page root.
//
//  DECODER.  Draco needs a decoder. The site has no npm deps, so the tool
//  gets the draco3d package from a directory you give (it is not shipped):
//      cd <scratch> && npm install draco3d@1.5.7
//      node tools/build-neuropil.mjs --draco <scratch>/node_modules/draco3d \
//           [--cache <scratch>/roi] [--lod 1]
//  With --cache, the tool keeps the downloads there and reads them again on
//  the next run. Delete the cache when done.
//
//  OUTPUT (units: micrometres, hemibrain frame, same as connectome.json pos)
//      { meta: { source, release, licence, url, retrieved, lod, units,
//                frame, quantization, tris },
//        rois: [ { id, name, label, part, v: [x,y,z,...] (0.1 um),
//                  f: [a,b,c,...] }, ... ] }
//  "part" is the brain map group: 'calyx' | 'peduncle' | 'lobe' | 'al'.
//
//  DECODE RULE (neuroglancer multi-resolution mesh spec)
//      stored = grid_origin + vertex_offsets[lod]
//             + chunk_shape * 2^lod * (fragment_position + q / (2^bits - 1))
//      nm     = stored * transform scale (256)
//      um     = nm / 1000
//
//  GREP MAP
//      ROIS ............ "const ROIS"          which ROI ids and parts
//      manifest ........ "function parseManifest"
//      decode .......... "function decodeRoi"
//      main ............ "async function main"
// ============================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://storage.googleapis.com/neuroglancer-janelia-flyem-hemibrain/v1.2/rois';
// A site user agent. Never put a person's email in a request.
const UA = 'davesgames-site fly-duel neuropil builder';

// ROI ids from v1.2/rois/segment_properties/info (read 2026-10-11).
export const ROIS = [
  { id: 13, name: 'CA(R)', label: 'calyx (right)', part: 'calyx' },
  { id: 37, name: 'PED(R)', label: 'pedunculus (right)', part: 'peduncle' },
  { id: 57, name: 'aL(R)', label: 'alpha lobe (right)', part: 'lobe' },
  { id: 55, name: "a'L(R)", label: "alpha prime lobe (right)", part: 'lobe' },
  { id: 61, name: 'bL(R)', label: 'beta lobe (right)', part: 'lobe' },
  { id: 59, name: "b'L(R)", label: "beta prime lobe (right)", part: 'lobe' },
  { id: 63, name: 'gL(R)', label: 'gamma lobe (right)', part: 'lobe' },
  { id: 4, name: 'AL(R)', label: 'antennal lobe (right)', part: 'al' },
];

function args() {
  const a = process.argv.slice(2), o = { lod: 1 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--draco') o.draco = a[++i];
    else if (a[i] === '--cache') o.cache = a[++i];
    else if (a[i] === '--lod') o.lod = +a[++i];
    else if (a[i] === '--out') o.out = a[++i];
  }
  return o;
}

async function get(url, cacheFile) {
  if (cacheFile && existsSync(cacheFile)) return readFileSync(cacheFile);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (cacheFile) writeFileSync(cacheFile, b);
  return b;
}

export function parseManifest(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const f = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
  const u = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const chunk = [f(), f(), f()], origin = [f(), f(), f()], nLod = u();
  const scales = Array.from({ length: nLod }, f);
  const vOff = Array.from({ length: nLod }, () => [f(), f(), f()]);
  const nFrag = Array.from({ length: nLod }, u);
  const lods = [];
  for (let l = 0; l < nLod; l++) {
    const n = nFrag[l], p = Array.from({ length: 3 * n }, u), offs = Array.from({ length: n }, u);
    lods.push({ frags: offs.map((bytes, i) => ({ pos: [p[i], p[n + i], p[2 * n + i]], bytes })) });
  }
  return { chunk, origin, scales, vOff, lods };
}

function decodeRoi(dec, man, bin, lod, bits, scaleNm) {
  let off = 0;
  for (let l = 0; l < lod; l++) for (const fr of man.lods[l].frags) off += fr.bytes;
  const v = [], f = [], q = 2 ** bits - 1, s = 2 ** lod;
  for (const fr of man.lods[lod].frags) {
    const buf = bin.subarray(off, off + fr.bytes); off += fr.bytes;
    if (!fr.bytes) continue;
    const decoder = new dec.Decoder(), db = new dec.DecoderBuffer(), mesh = new dec.Mesh();
    db.Init(new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength), buf.byteLength);
    const st = decoder.DecodeBufferToMesh(db, mesh);
    if (!st.ok()) throw new Error('draco: ' + st.error_msg());
    const att = decoder.GetAttribute(mesh, decoder.GetAttributeId(mesh, dec.POSITION));
    const arr = new dec.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, att, arr);
    const base = v.length / 3, np = mesh.num_points();
    for (let i = 0; i < np; i++) for (let a = 0; a < 3; a++) {
      const stored = man.origin[a] + man.vOff[lod][a] + man.chunk[a] * s * (fr.pos[a] + arr.GetValue(3 * i + a) / q);
      v.push(Math.round(stored * scaleNm / 100) / 10);   // nm -> um, 0.1 um
    }
    const ia = new dec.DracoUInt32Array();
    for (let t = 0; t < mesh.num_faces(); t++) {
      decoder.GetFaceFromMesh(mesh, t, ia);
      f.push(base + ia.GetValue(0), base + ia.GetValue(1), base + ia.GetValue(2));
    }
    for (const x of [ia, arr, mesh, db, decoder]) dec.destroy(x);
  }
  return weld(v, f);
}

// Merge vertices that round to the same 0.1 um point (fragment seams).
function weld(v, f) {
  const map = new Map(), nv = [], remap = [];
  for (let i = 0; i < v.length / 3; i++) {
    const k = `${v[3 * i]},${v[3 * i + 1]},${v[3 * i + 2]}`;
    if (!map.has(k)) { map.set(k, nv.length / 3); nv.push(v[3 * i], v[3 * i + 1], v[3 * i + 2]); }
    remap.push(map.get(k));
  }
  const nf = [];
  for (let t = 0; t < f.length; t += 3) {
    const a = remap[f[t]], b = remap[f[t + 1]], c = remap[f[t + 2]];
    if (a !== b && b !== c && a !== c) nf.push(a, b, c);
  }
  return { v: nv, f: nf };
}

async function main() {
  const o = args();
  if (!o.draco) { console.error('usage: node tools/build-neuropil.mjs --draco <dir of draco3d> [--cache dir] [--lod 1]'); process.exit(2); }
  const require = createRequire(import.meta.url);
  const draco3d = require(resolve(o.draco));
  const dec = await draco3d.createDecoderModule({});
  if (o.cache) mkdirSync(o.cache, { recursive: true });
  const c = name => (o.cache ? join(o.cache, name) : null);
  const info = JSON.parse(await get(`${BASE}/mesh/info`, c('mesh-info.json')));
  if (info['@type'] !== 'neuroglancer_multilod_draco') throw new Error('unexpected mesh type ' + info['@type']);
  const bits = info.vertex_quantization_bits, scaleNm = info.transform[0];
  const props = JSON.parse(await get(`${BASE}/segment_properties/info`, c('segprops.json')));
  const labels = props.inline.properties.find(p => p.id === 'label').values;
  const ids = props.inline.ids.map(Number);
  const rois = [];
  let tris = 0;
  for (const r of ROIS) {
    const got = labels[ids.indexOf(r.id)];
    if (got !== r.name) throw new Error(`ROI ${r.id} is ${got}, not ${r.name}`);
    const man = parseManifest(await get(`${BASE}/mesh/${r.id}.index`, c(`${r.id}.index`)));
    const bin = await get(`${BASE}/mesh/${r.id}`, c(`${r.id}.bin`));
    const lod = Math.min(o.lod, man.lods.length - 1);
    const m = decodeRoi(dec, man, bin, lod, bits, scaleNm);
    tris += m.f.length / 3;
    rois.push({ id: r.id, name: r.name, label: r.label, part: r.part, lod, v: m.v, f: m.f });
    console.log(`${r.name.padEnd(7)} lod ${lod}  ${m.v.length / 3} vertices  ${m.f.length / 3} triangles`);
  }
  const out = {
    meta: {
      source: 'Janelia FlyEM hemibrain ROI meshes (neuroglancer precomputed, multilod draco)',
      release: 'hemibrain v1.2',
      licence: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), as stated on https://www.janelia.org/project-team/flyem/hemibrain',
      url: `${BASE}/mesh/`,
      retrieved: new Date().toISOString().slice(0, 10),
      lod: o.lod, units: 'micrometres', frame: 'hemibrain', quantization: '0.1 um',
      tris,
      citation: 'Scheffer LK et al. (2020) eLife 9:e57443, doi:10.7554/eLife.57443',
      tool: 'node tools/build-neuropil.mjs --draco <draco3d dir> --lod ' + o.lod,
    },
    rois,
  };
  const file = o.out || join(ROOT, 'data', 'neuropil-hemibrain.json');
  const text = JSON.stringify(out);
  writeFileSync(file, text);
  console.log(`wrote ${file}  ${text.length} bytes  ${tris} triangles`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
