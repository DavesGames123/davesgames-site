// Prepare the non Poly Haven sources of catalog.mjs for build.mjs.
//
// Run:
//   NATURE_SCRATCH=/scratch NATURE_DEPS=/scratch/tool \
//     node stella-nova/tools/nature-assets/prep.mjs [src ...]
// Needs the archives from `fetch.mjs packs` and, for FBX, OBJ and .blend
// sources, Blender (NATURE_BLENDER, default /Applications/Blender.app).
//
// For each source it writes dl/prep/<src>/: <src>.gltf + .bin (one top
// level node per variant, made by prep.py in Blender or by proc.mjs),
// img/ (the textures of each material as PNG or JPEG), alpha/<material>_alpha.png
// and info.json ({ info: { authors }, foliage: [material names] }), so
// build.mjs reads it like a Poly Haven download.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SOURCES } from './catalog.mjs';
import { GENERATORS, writeGltf } from './proc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = process.env.NATURE_SCRATCH, deps = process.env.NATURE_DEPS;
if (!scratch || !deps) { console.error('set NATURE_SCRATCH and NATURE_DEPS'); process.exit(2); }
const sharp = createRequire(path.join(deps, 'package.json'))('sharp');
const BLENDER = process.env.NATURE_BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const DL = path.join(scratch, 'dl');
const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '_');

// A source texture as a file sharp can read: TGA and TIF go through
// Blender once (cached in dl/prep/_png).
function readable(rel, pending) {
  const abs = path.join(DL, rel);
  if (!existsSync(abs)) throw new Error('missing texture ' + rel);
  if (!/\.(tga|tif|tiff)$/i.test(abs)) return abs;
  const out = path.join(DL, 'prep', '_png', slug(rel) + '.png');
  if (!existsSync(out)) pending.push([abs, out]);
  return out;
}

async function prepSource(src) {
  const dir = path.join(DL, 'prep', src.src);
  mkdirSync(path.join(dir, 'img'), { recursive: true });
  mkdirSync(path.join(dir, 'alpha'), { recursive: true });
  mkdirSync(path.join(DL, 'prep', '_png'), { recursive: true });
  const gltf = path.join(dir, src.src + '.gltf');
  const pending = [];
  // Resolve every texture first so Blender converts the TGA files in the same run.
  const rules = src.tex.map((t) => ({ ...t, re: new RegExp(t.match, 'i') }));
  const fileOf = (rel) => (rel ? readable(rel, pending) : null);
  const expand = (s, m) => s && s.replace(/\$(\d)/g, (_, k) => m[+k]);

  if (src.from === 'procedural') {
    const variants = src.inputs.map((inp) => ({ name: inp.name, ...GENERATORS[src.gen](inp) }));
    writeGltf(gltf, variants);
    for (const v of variants) {
      const tris = Object.values(v.parts).reduce((s, m) => s + m.i.length / 3, 0);
      console.log(`  ${v.name}: ${tris} tris`);
    }
  }
  // Materials we will meet: for Blender sources we only know them after the
  // export, so convert all TGA/TIF textures named by any rule up front.
  for (const t of rules) for (const k of ['diff', 'nor', 'ao', 'rough', 'alpha']) {
    if (t[k] && !t[k].includes('$')) fileOf(t[k]);
    if (t[k] && t[k].includes('$')) for (const n of ['1', '2', '3']) { try { fileOf(t[k].replace('$1', n)); } catch { /* not every index exists */ } }
  }
  if (src.from !== 'procedural') {
    const job = {
      out: gltf,
      inputs: src.inputs.map((i) => ({ ...i, file: path.join(DL, i.file) })),
      images: pending,
    };
    const jf = path.join(dir, 'job.json');
    writeFileSync(jf, JSON.stringify(job));
    const log = execFileSync(BLENDER, ['-b', '--factory-startup', '--disable-autoexec', '--python', path.join(here, 'prep.py'), '--', jf], { maxBuffer: 1 << 26 }).toString();
    for (const l of log.split('\n')) if (/^prep:|Error/.test(l)) console.log('  ' + l);
  } else if (pending.length) {
    const jf = path.join(dir, 'job.json');
    writeFileSync(jf, JSON.stringify({ out: null, inputs: [], images: pending }));
    execFileSync(BLENDER, ['-b', '--factory-startup', '--disable-autoexec', '--python', path.join(here, 'prep.py'), '--', jf]);
  }

  // Attach textures to the materials of the glTF.
  const J = JSON.parse(readFileSync(gltf, 'utf8'));
  J.materials ||= [];
  // Primitives with no material get one called "main".
  for (const m of J.meshes) for (const p of m.primitives) if (p.material === undefined) {
    let k = J.materials.findIndex((x) => x.name === 'main');
    if (k < 0) { k = J.materials.length; J.materials.push({ name: 'main' }); }
    p.material = k;
  }
  // Blender renames a repeated material (Leaf_01.001): map such copies
  // back to the first one, so the variants share one texture set.
  const keep = new Map();
  const remap = J.materials.map((m, k) => {
    const base = m.name.replace(/\.\d{3}$/, '');
    if (!keep.has(base)) keep.set(base, k);
    return keep.get(base);
  });
  const used = [...new Set(remap)].sort((a, b) => a - b);
  const newIndex = new Map(used.map((k, i) => [k, i]));
  for (const m of J.meshes) for (const p of m.primitives) p.material = newIndex.get(remap[p.material]);
  J.materials = used.map((k) => ({ ...J.materials[k], name: J.materials[k].name.replace(/\.\d{3}$/, '') }));
  J.images = []; J.textures = [];
  const img = (abs) => {
    const name = slug(path.relative(DL, abs));
    const ext = path.extname(abs).toLowerCase();
    const dst = path.join(dir, 'img', name.replace(/_(png|jpg|jpeg)$/i, '') + ext);
    if (!existsSync(dst)) copyFileSync(abs, dst);
    J.images.push({ uri: 'img/' + path.basename(dst) });
    J.textures.push({ source: J.images.length - 1 });
    return { index: J.textures.length - 1 };
  };
  const foliage = [];
  
  // Material names used by more than one mesh (one per variant) keep one entry.
  // Materials whose rule gives the same files (the Nobiax palms: one
  // texture, a material per OBJ) become one material.
  {
    const sig = J.materials.map((m) => {
      const rule = rules.find((t) => t.re.test(m.name));
      if (!rule) return m.name;
      const mm = m.name.match(rule.re) || [];
      return ['diff', 'nor', 'ao', 'rough', 'alpha'].map((k) => expand(rule[k], mm) || '').join('|') + '|' + !!rule.alphaFromDiff + !!rule.foliage;
    });
    const first = new Map();
    const remap2 = sig.map((g, k) => { if (!first.has(g)) first.set(g, k); return first.get(g); });
    const used2 = [...new Set(remap2)].sort((a, b) => a - b);
    const ni = new Map(used2.map((k, i) => [k, i]));
    for (const m of J.meshes) for (const p of m.primitives) p.material = ni.get(remap2[p.material]);
    J.materials = used2.map((k) => J.materials[k]);
  }
  for (const m of J.materials) {
    const rule = rules.find((t) => t.re.test(m.name));
    if (!rule) throw new Error(`${src.src}: no texture rule for material ${m.name}`);
    const mm = m.name.match(rule.re) || [];
    let diff = fileOf(expand(rule.diff, mm));
    if (src.gain) {
      // Game textures with baked shade are darker than the calibrated scans
      // of the pack: scale the colour (not the alpha) by src.gain.
      const out = path.join(dir, 'img', slug(m.name) + '_diff_gain.png');
      if (!existsSync(out)) await sharp(diff).ensureAlpha().linear([src.gain, src.gain, src.gain, 1], [0, 0, 0, 0]).png().toFile(out);
      diff = out;
    }
    m.pbrMetallicRoughness = { baseColorTexture: img(diff), metallicFactor: 0, roughnessFactor: 0.8 };
    if (rule.nor) m.normalTexture = img(fileOf(expand(rule.nor, mm)));
    if (rule.ao || rule.rough) {
      // Pack ambient occlusion (r) and roughness (g) into one ARM image.
      const out = path.join(dir, 'img', slug(m.name) + '_arm.png');
      if (!existsSync(out)) {
        const size = (await sharp(fileOf(rule.rough || rule.ao)).metadata()).width;
        const grey = async (f, def) => f ? sharp(fileOf(f)).greyscale().resize(size, size).raw().toBuffer() : Buffer.alloc(size * size, def);
        const ao = await grey(rule.ao, 255), ro = await grey(rule.rough, 200);
        const arm = Buffer.alloc(size * size * 3);
        for (let i = 0; i < size * size; i++) { arm[i * 3] = ao[i]; arm[i * 3 + 1] = ro[i]; arm[i * 3 + 2] = 0; }
        await sharp(arm, { raw: { width: size, height: size, channels: 3 } }).png().toFile(out);
      }
      m.pbrMetallicRoughness.metallicRoughnessTexture = img(out);
      m.occlusionTexture = { index: m.pbrMetallicRoughness.metallicRoughnessTexture.index };
    }
    let alphaFile = null;
    if (rule.alpha) alphaFile = fileOf(expand(rule.alpha, mm));
    if (rule.alphaFromDiff) {
      const out = path.join(dir, 'alpha', 'from_diff_' + slug(m.name) + '.png');
      if (!existsSync(out)) await sharp(diff).ensureAlpha().extractChannel(3).png().toFile(out);
      alphaFile = out;
    }
    if (alphaFile) {
      const dst = path.join(dir, 'alpha', m.name + '_alpha.png');
      await sharp(alphaFile).greyscale().png().toFile(dst);
      m.alphaMode = 'MASK'; m.alphaCutoff = 0.5; m.doubleSided = true;
    }
    if (rule.foliage) { foliage.push(m.name); m.doubleSided = true; }
  }
  const matNames = new Set(J.materials.map((m) => m.name));
  writeFileSync(gltf, JSON.stringify(J));
  const authors = {}; authors[src.author] = 'All';
  writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ info: { authors }, foliage, materials: [...matNames] }, null, 1));
  console.log(`  ${src.src}: ${J.meshes.length} variants, materials ${[...matNames].join(', ')}; foliage ${foliage.join(', ') || '-'}`);
}

const want = process.argv.slice(2);
for (const s of SOURCES.filter((x) => x.from !== 'polyhaven' && (!want.length || want.includes(x.src)))) {
  const t0 = Date.now();
  console.log(s.src);
  try { await prepSource(s); } catch (e) { console.log('  FAILED', s.src, e.stack); }
  console.log('  ms', Date.now() - t0);
}
