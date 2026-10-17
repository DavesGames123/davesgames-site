// Build the nature asset pack (stella-nova/assets/nature) from the
// sources that fetch.mjs downloaded.
//
// Run:
//   NATURE_SCRATCH=/scratch NATURE_DEPS=/scratch/tool \
//     node --max-old-space-size=16000 stella-nova/tools/nature-assets/build.mjs [src ...|ground|manifest]
// NATURE_DEPS is a folder with node_modules for sharp and meshoptimizer
// (npm i sharp meshoptimizer @gltf-transform/core there). Nothing is
// installed into the repo.
//
// Per source: read the glTF with lib/glb-lite.js, split the variants
// (top level nodes), weld, put the base centre at the origin (y up,
// metres), make 3 LODs with the meshoptimizer simplifier (the backend of
// gltf-transform simplify) plus island decimation for foliage cards, and
// write GLB files that point at shared WebP textures in tex/<source>/.
// The GLB files use no Draco and no meshopt compression.
// Each variant writes a record to build/records/<id>.json (in the
// scratch); `manifest` joins the records into assets/nature/manifest.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseGLB } from '../../lib/glb-lite.js';
import { SOURCES, GROUND, BIOME_KEYS } from './catalog.mjs';
import { gltfToGLB, collectVariants, weld, compact, decimateIslands, islands, bounds, baseCentre, translate, writeGLB } from './mesh-ops.mjs';
import { writeMaterialTextures, writeGroundSet } from './textures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../assets/nature');
const scratch = process.env.NATURE_SCRATCH;
const deps = process.env.NATURE_DEPS;
if (!scratch || !deps) { console.error('set NATURE_SCRATCH and NATURE_DEPS'); process.exit(2); }
const require = createRequire(path.join(deps, 'package.json'));
const sharp = require('sharp');
const { MeshoptSimplifier } = require('meshoptimizer');
await MeshoptSimplifier.ready;

const REC = path.join(scratch, 'build', 'records');
mkdirSync(REC, { recursive: true });
const UPRIGHT = new Set(['tree', 'bush', 'fern', 'flower', 'grass', 'succulent', 'reed', 'cactus', 'mushroom', 'ground cover']);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function simplifyPart(p, target, foliage, seed, box) {
  let tris = p.indices.length / 3;
  if (tris <= target) return p;
  if (foliage) {
    // Cards and leaves: first let the simplifier flatten each card, then
    // drop whole islands and grow the ones that stay.
    const isl = islands(p).count;
    const perIsland = tris / isl;
    let q = p;
    if (perIsland > 2.5) {
      const [I] = MeshoptSimplifier.simplify(p.indices, p.positions, 3, Math.max(isl * 2, target) * 3, 0.01, ['Permissive']);
      q = compact({ ...p, indices: I });
      tris = q.indices.length / 3;
    }
    if (tris <= target) return q;
    return decimateIslands(q, target / tris, seed, foliage.scaleCap, box);
  }
  if (!Number.isInteger(target) || target * 3 > p.indices.length) throw new Error('bad target ' + target + ' of ' + tris);
  const scale = MeshoptSimplifier.getScale(p.positions, 3);
  let [I, err] = MeshoptSimplifier.simplify(p.indices, p.positions, 3, target * 3, 0.5, []);
  if (I.length / 3 > target * 1.3) [I] = MeshoptSimplifier.simplifySloppy(p.indices, p.positions, 3, null, target * 3, 1.0);
  const q = compact({ ...p, indices: I });
  q.error = err * scale;
  return q;
}

// Share the triangle budget between parts: foliage gets weight 2.
function budgets(parts, target, isFoliage) {
  const w = parts.map((p, i) => (p.indices.length / 3) * (isFoliage[i] ? 2 : 1));
  const out = parts.map(() => 0);
  let left = target, active = parts.map((_, i) => i);
  for (let it = 0; it < 5 && active.length; it++) {
    const ws = active.reduce((s, i) => s + w[i], 0);
    const next = [];
    let used = 0;
    for (const i of active) {
      const share = ws > 0 ? Math.floor(left * w[i] / ws) : 0;
      const tris = parts[i].indices.length / 3;
      if (tris <= share) { out[i] = tris; used += tris; } else { out[i] = share; next.push(i); }
    }
    left = target - out.reduce((s, v, i) => s + (next.includes(i) ? 0 : v), 0);
    if (next.length === active.length) break;
    active = next;
  }
  return out.map((v, i) => Math.max(Math.min(64, parts[i].indices.length / 3), v));
}

function alphaFor(dir, srcId, matName, alphaMode, nMats) {
  const adir = path.join(dir, 'alpha');
  if (!existsSync(adir)) return null;
  const files = readdirSync(adir);
  const part = matName.startsWith(srcId + '_') ? matName.slice(srcId.length + 1) : matName;
  const want = [part + '_alpha', part + '_opacity'];
  for (const f of files) if (want.includes(path.parse(f).name)) return path.join(adir, f);
  const generic = files.find((f) => /^(alpha|opacity)$/i.test(path.parse(f).name));
  if (generic && (alphaMode !== 'OPAQUE' || nMats === 1)) return path.join(adir, generic);
  return null;
}

async function buildSource(src) {
  const dir = path.join(scratch, 'dl', 'ph', src.src);
  const json = JSON.parse(readFileSync(path.join(dir, src.src + '.gltf'), 'utf8'));
  const bin = readFileSync(path.join(dir, json.buffers[0].uri));
  const info = JSON.parse(readFileSync(path.join(dir, 'info.json'), 'utf8')).info;
  const scene = parseGLB(gltfToGLB(json, bin), { merge: false });
  let variants = collectVariants(scene, src.variants === 'nodes' ? 'nodes' : 'one');
  // Sort variants by name for stable ids; apply pick.
  variants.sort((a, b) => a.name.localeCompare(b.name));
  if (src.pick) variants = src.pick.map((i) => variants[i]).filter(Boolean);
  const nMats = new Set(variants.flatMap((v) => v.parts.map((p) => p.material))).size;

  // Size the textures by the tallest variant.
  let maxDim = 0;
  for (const v of variants) {
    const b = bounds(v.parts);
    maxDim = Math.max(maxDim, b.max[1] - b.min[1], b.max[0] - b.min[0], b.max[2] - b.min[2]);
  }
  const top = src.texTop || (maxDim >= 1.5 ? 1024 : 512);
  const sizes = [top, top / 2, top / 4];

  // Textures per material, shared by all variants.
  const texDir = path.join(OUT, 'tex', src.src);
  const matInfo = new Map();
  for (const m of new Set(variants.flatMap((v) => v.parts.map((p) => p.material)))) {
    const uri = (im) => im && im.uri ? path.join(dir, decodeURIComponent(im.uri)) : null;
    const alpha = alphaFor(dir, src.src, m.name, m.alphaMode, nMats);
    const base = slug(m.name.startsWith(src.src + '_') ? m.name.slice(src.src.length + 1) : m.name) || 'main';
    const t = await writeMaterialTextures(sharp, { diff: uri(m.baseColor), nor: uri(m.normal), arm: uri(m.orm), alpha }, texDir, base, sizes, !!process.env.NATURE_FORCE);
    matInfo.set(m, { base, t, foliage: t.alpha });
  }

  const records = [];
  let vi = 0;
  for (const v of variants) {
    const letter = String.fromCharCode(97 + vi++);
    const id = variants.length > 1 ? `${src.src}_${letter}` : src.src;
    let parts = v.parts.map((p) => weld(p)).filter((p) => p.indices.length >= 3);
    const o = baseCentre(parts, UPRIGHT.has(src.kind));
    translate(parts, o);
    const b = bounds(parts);
    const height = b.max[1] - b.min[1];
    if (height < 0.02) { console.log('  skip tiny variant', v.name); continue; }
    const isFol = parts.map((p) => matInfo.get(p.material).foliage);
    const srcTris = parts.reduce((s, p) => s + p.indices.length / 3, 0);
    const lods = [];
    let prevParts = parts;
    // Small things get fewer triangles: scale the targets by size (1 m = full).
    const dim = Math.max(height, b.max[0] - b.min[0], b.max[2] - b.min[2]);
    const sizeK = src.kind === 'grass' || src.kind === 'flower' ? 1 : Math.min(1, Math.max(0.25, dim / 1.0));
    for (let li = 0; li < 3; li++) {
      const target = Math.min(Math.round(src.lods[li] * sizeK), li === 0 ? srcTris : lods[li - 1].tris);
      const bud = budgets(prevParts, target, isFol);
      const cap = (src.scaleCap || [2.2, 3.2, 4.5])[li];
      const lp = prevParts.map((p, i) => simplifyPart(p, bud[i], isFol[i] ? { scaleCap: cap } : null, 1234 + li * 77 + vi, b));
      prevParts = lp;
      const mats = lp.map((p) => {
        const mi = matInfo.get(p.material);
        const rel = (f) => f ? path.relative(path.join(OUT, 'models'), f).split(path.sep).join('/') : null;
        return {
          name: mi.base,
          alphaMode: mi.foliage ? 'MASK' : 'OPAQUE', alphaCutoff: 0.5,
          doubleSided: mi.foliage || !!p.material.doubleSided && src.kind !== 'rock' && src.kind !== 'boulder' && src.kind !== 'cliff',
          maps: { baseColor: rel(mi.t.albedo[li]), normal: rel(mi.t.normal[li]), orm: rel(mi.t.orm[li]) },
          extras: mi.foliage ? { coverage: +mi.t.coverage.toFixed(4) } : undefined,
        };
      });
      const glb = writeGLB(lp, mats, { id, lod: li });
      const file = path.join(OUT, 'models', `${id}_lod${li}.glb`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, glb);
      const tris = lp.reduce((s, p) => s + p.indices.length / 3, 0);
      lods.push({ file: `models/${id}_lod${li}.glb`, tris, bytes: glb.byteLength, texSize: sizes[li],
        textures: [...new Set(mats.flatMap((m) => Object.values(m.maps).filter(Boolean).map((r) => path.posix.join('models', r))).map((r) => path.posix.normalize(r)))] });
    }
    const lb = bounds(prevParts.length ? parts : parts);
    let radius = 0;
    for (const p of parts) for (let k = 0; k < p.positions.length; k += 3) radius = Math.max(radius, Math.hypot(p.positions[k], p.positions[k + 2]));
    const rec = {
      id, name: src.name + (variants.length > 1 ? ` ${letter.toUpperCase()}` : ''),
      kind: src.kind, sub: src.sub, biomes: src.biomes,
      height: +height.toFixed(3),
      footprint: +Math.max(lb.max[0] - lb.min[0], lb.max[2] - lb.min[2]).toFixed(3),
      radius: +radius.toFixed(3),
      bounds: { min: lb.min.map((x) => +x.toFixed(3)), max: lb.max.map((x) => +x.toFixed(3)) },
      sourceTris: srcTris,
      lods,
      materials: parts.map((p) => ({ name: matInfo.get(p.material).base, foliage: matInfo.get(p.material).foliage, coverage: +matInfo.get(p.material).t.coverage.toFixed(4) })),
      wind: src.wind ?? 0,
      sink: ['rock', 'boulder', 'cliff'].includes(src.kind) ? 0.12 : src.kind === 'log' ? 0.05 : 0,
      default: !!src.default,
      impostor: null, wantImpostor: !!src.impostor,
      licence: 'CC0-1.0',
      author: Object.keys(info.authors || {}).join(', '),
      source: `https://polyhaven.com/a/${src.src}`,
      sourceName: 'Poly Haven',
      sourceAsset: src.src,
      sourceVariant: v.name,
    };
    writeFileSync(path.join(REC, id + '.json'), JSON.stringify(rec, null, 1));
    records.push(rec);
    console.log(`  ${id.padEnd(30)} h ${height.toFixed(2).padStart(6)} m  tris ${srcTris} -> ${lods.map((l) => l.tris).join(' / ')}  ${lods.map((l) => (l.bytes / 1e3).toFixed(0) + 'k').join(' ')}`);
  }
  return records;
}

async function buildGround() {
  for (const g of GROUND) {
    const dir = path.join(scratch, 'dl', 'ground', g.id);
    let src;
    if (g.from === 'polyhaven') {
      src = { color: path.join(dir, 'Diffuse.jpg'), normal: path.join(dir, 'nor_gl.jpg'), arm: path.join(dir, 'arm.jpg'), disp: path.join(dir, 'Displacement.jpg') };
    } else {
      const f = (s) => { const p = path.join(dir, `${g.src}_1K-JPG_${s}.jpg`); return existsSync(p) ? p : null; };
      src = { color: f('Color'), normal: f('NormalGL'), ao: f('AmbientOcclusion'), rough: f('Roughness'), disp: f('Displacement') };
    }
    const files = await writeGroundSet(sharp, src, path.join(OUT, 'ground'), g.id);
    const rel = (p) => path.relative(OUT, p).split(path.sep).join('/');
    const rec = {
      id: 'ground_' + g.id, name: g.name, kind: 'ground texture', biomes: g.biomes, layer: GROUND.indexOf(g),
      tile: g.tile, size: 1024,
      textures: { albedo: rel(files.albedo), normal: rel(files.normal), orm: rel(files.orm) },
      ormLayout: 'r ambient occlusion, g roughness, b height (0..1 stretched), normal map is OpenGL (+y)',
      default: true,
      licence: 'CC0-1.0',
      author: g.from === 'polyhaven' ? null : g.author,
      source: g.from === 'polyhaven' ? `https://polyhaven.com/a/${g.src}` : `https://ambientcg.com/view?id=${g.src}`,
      sourceName: g.from === 'polyhaven' ? 'Poly Haven' : 'ambientCG',
      sourceAsset: g.src,
    };
    if (g.from === 'polyhaven') {
      const info = await fetch('https://api.polyhaven.com/info/' + g.src, { headers: { 'User-Agent': 'davesgames.io asset build' } }).then((r) => r.json());
      rec.author = Object.keys(info.authors || {}).join(', ');
    }
    writeFileSync(path.join(REC, rec.id + '.json'), JSON.stringify(rec, null, 1));
    console.log('  ground', g.id, Object.values(files).map((f) => (statSync(f).size / 1e3).toFixed(0) + 'k').join(' '));
  }
}

function sizeOf(rel) { const f = path.join(OUT, rel); return existsSync(f) ? statSync(f).size : 0; }

function writeManifest() {
  const recs = readdirSync(REC).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(REC, f), 'utf8')));
  const order = (r) => (r.kind === 'ground texture' ? 1e6 + r.layer : 0);
  recs.sort((a, b) => order(a) - order(b) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  // Files and bytes: count each shared texture once.
  const all = new Map(); // rel -> default?
  const add = (rel, def) => all.set(rel, (all.get(rel) || false) || def);
  for (const r of recs) {
    if (r.kind === 'ground texture') { for (const t of Object.values(r.textures)) add(t, true); continue; }
    for (const l of r.lods) { add(l.file, r.default); for (const t of l.textures) add(t, r.default); }
    if (r.impostor) { add(r.impostor.albedo, r.default); add(r.impostor.normal, r.default); }
    delete r.wantImpostor;
  }
  let bytes = 0, defBytes = 0;
  for (const [rel, def] of all) { const s = sizeOf(rel); bytes += s; if (def) defBytes += s; }
  const kinds = {};
  for (const r of recs) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  const man = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    units: 'metres', up: '+y', origin: 'base centre (y = 0 at the lowest vertex)',
    notes: [
      'Every asset is CC0-1.0 (Poly Haven, ambientCG). See CREDITS.txt.',
      'lods[0..2]: GLB files for lib/glb-lite.js. Textures are external WebP files in tex/, shared by the variants and LODs of a source; key GPU textures on the file URL.',
      'Albedo WebP alpha is the cutoff mask (alphaMode MASK, cutoff 0.5). Colour under transparent texels is filled (push-pull). Smaller sizes keep the alpha coverage of the top size; coverage gives that share, so a renderer can keep it in its own mips.',
      'Normals are int8 (KHR_mesh_quantization); normal maps are OpenGL (+y). ORM: r occlusion, g roughness, b metal (0).',
      'sink: share of the height to push below the ground (rocks). wind: 0 rigid .. 1 very flexible.',
      'impostor: 3 x 3 atlas (see impostor.views): albedo with alpha; normal file rgb = world normal * 0.5 + 0.5, a = depth in the view box.',
      'biomes use BIOME_KEYS (snake case of the lib/dla-terrain.js BIOMES names).',
    ],
    biomeKeys: BIOME_KEYS,
    groundLayers: recs.filter((r) => r.kind === 'ground texture').sort((a, b) => a.layer - b.layer).map((r) => r.id),
    totals: { assets: recs.length, kinds, files: all.size, bytes, defaultBytes: defBytes },
    assets: recs,
  };
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
  writeCredits(recs);
  console.log(`manifest: ${recs.length} assets, ${all.size} files, ${(bytes / 1e6).toFixed(1)} MB, default ${(defBytes / 1e6).toFixed(1)} MB`, kinds);
}

function writeCredits(recs) {
  const by = new Map();
  for (const r of recs) {
    const key = r.sourceAsset;
    if (!by.has(key)) by.set(key, { r, ids: [] });
    by.get(key).ids.push(r.id);
  }
  const lines = [
    'Nature asset pack for davesgames.io (stella-nova/assets/nature)',
    '',
    'Every model and texture in this folder is a processed copy of a CC0 1.0',
    'Universal (public domain dedication) asset. CC0 needs no credit; we give',
    'it anyway. Processing: variants split, welded, re-centred, simplified to',
    'three levels of detail, textures resized and converted to WebP, leaf alpha',
    'merged into the albedo, impostor atlases rendered from the models.',
    '',
    'Licences:',
    '  Poly Haven: all assets CC0. https://polyhaven.com/license',
    '  ambientCG: all assets CC0 1.0. https://docs.ambientcg.com/license/',
    '  CC0 text: https://creativecommons.org/publicdomain/zero/1.0/',
    '',
    'Sources (source asset, authors, link -> ids in manifest.json):',
  ];
  for (const { r, ids } of [...by.values()].sort((a, b) => a.r.sourceAsset.localeCompare(b.r.sourceAsset))) {
    lines.push(`  ${r.sourceAsset} (${r.sourceName}), by ${r.author || 'unknown'}, ${r.licence}`);
    lines.push(`    ${r.source}`);
    lines.push(`    -> ${ids.join(', ')}`);
  }
  writeFileSync(path.join(OUT, 'CREDITS.txt'), lines.join('\n') + '\n');
}

const args = process.argv.slice(2);
if (args.includes('ground')) await buildGround();
const srcIds = args.filter((a) => a !== 'ground' && a !== 'manifest');
const list = args.length ? SOURCES.filter((s) => srcIds.includes(s.src)) : SOURCES;
for (const s of list) {
  const t0 = Date.now();
  console.log(s.src);
  // Remove old records and models of this source before a rebuild.
  for (const f of readdirSync(REC)) {
    const r = JSON.parse(readFileSync(path.join(REC, f), 'utf8'));
    if (r.sourceAsset === s.src && r.kind !== 'ground texture') {
      rmSync(path.join(REC, f));
      for (const l of r.lods || []) rmSync(path.join(OUT, l.file), { force: true });
    }
  }
  try { await buildSource(s); } catch (e) { console.log('  FAILED', s.src, e.stack); }
  console.log('  ms', Date.now() - t0);
}
if (!args.length || args.includes('manifest')) writeManifest();
