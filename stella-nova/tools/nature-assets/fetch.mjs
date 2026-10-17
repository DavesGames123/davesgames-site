// Download the Poly Haven source models (glTF, 1k textures) for the
// nature pack into a scratch folder. Never into the repo.
// Run: NATURE_SCRATCH=/path node stella-nova/tools/nature-assets/fetch.mjs [id ...]
// With no ids it fetches every Poly Haven source in catalog.mjs.
// `packs` fetches the archives of the second pack (PACKS, about 2.8 GB,
// unpacked with bsdtar into dl/<dir>); a pack dir (oga/palmv3) fetches one.
// It sends a site User-Agent and no other identity. It skips files that
// are already present with the right md5.
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SOURCES, GROUND, PACKS } from './catalog.mjs';

const UA = { 'User-Agent': 'davesgames.io asset build' };
const scratch = process.env.NATURE_SCRATCH;
if (!scratch) { console.error('set NATURE_SCRATCH'); process.exit(2); }
const dl = path.join(scratch, 'dl', 'ph');
const want = process.argv.slice(2);
const packWant = PACKS.filter((p) => want.includes('packs') || want.includes(p.dir));
const ids = [...new Set(SOURCES.filter((s) => s.from === 'polyhaven').map((s) => s.src))]
  .filter((id) => !want.length || want.includes(id));

async function get(url, file, md5) {
  if (existsSync(file) && (!md5 || createHash('md5').update(readFileSync(file)).digest('hex') === md5)) return 0;
  for (let tries = 0; tries < 3; tries++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(r.status + ' ' + url);
      const b = Buffer.from(await r.arrayBuffer());
      if (md5 && createHash('md5').update(b).digest('hex') !== md5) throw new Error('md5 mismatch ' + url);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, b);
      return b.length;
    } catch (e) { if (tries === 2) throw e; await new Promise((r) => setTimeout(r, 2000)); }
  }
}

async function one(id) {
  const dir = path.join(dl, id);
  mkdirSync(dir, { recursive: true });
  const infoFile = path.join(dir, 'info.json');
  if (!existsSync(infoFile)) {
    const [a, f] = await Promise.all([
      fetch('https://api.polyhaven.com/info/' + id, { headers: UA }).then((r) => r.json()),
      fetch('https://api.polyhaven.com/files/' + id, { headers: UA }).then((r) => r.json()),
    ]);
    writeFileSync(infoFile, JSON.stringify({ info: a, files: f }, null, 1));
  }
  const { files } = JSON.parse(readFileSync(infoFile, 'utf8'));
  const g = files.gltf['1k'].gltf;
  let bytes = await get(g.url, path.join(dir, id + '.gltf'), g.md5);
  for (const [rel, f] of Object.entries(g.include)) bytes += await get(f.url, path.join(dir, rel), f.md5);
  // Alpha maps are not in the glTF download. Leaves and twigs need them.
  for (const [key, res] of Object.entries(files)) {
    if (!/(^|_)(alpha|opacity)$/i.test(key) || !res['1k']) continue;
    const f = res['1k'].png || res['1k'].jpg;
    bytes += await get(f.url, path.join(dir, 'alpha', key + path.extname(f.url)), f.md5);
  }
  console.log('fetched', id, (bytes / 1e6).toFixed(1), 'MB new');
}

// Ground texture sets: Poly Haven (diffuse, nor_gl, arm, disp) or ambientCG (zip).
async function ground(g) {
  const dir = path.join(scratch, 'dl', 'ground', g.id);
  mkdirSync(dir, { recursive: true });
  if (g.from === 'polyhaven') {
    const files = await fetch('https://api.polyhaven.com/files/' + g.src, { headers: UA }).then((r) => r.json());
    let bytes = 0;
    for (const key of ['Diffuse', 'nor_gl', 'arm', 'Displacement']) {
      const f = files[key]['1k'].jpg;
      bytes += await get(f.url, path.join(dir, key + '.jpg'), f.md5);
    }
    console.log('fetched ground', g.id, (bytes / 1e6).toFixed(1), 'MB new');
  } else if (g.from === 'ambientcg') {
    const zip = path.join(dir, g.src + '.zip');
    const b = await get('https://ambientcg.com/get?file=' + g.src + '_1K-JPG.zip', zip);
    console.log('fetched ground', g.id, (b / 1e6).toFixed(1), 'MB new (unzip it with unzip -o)');
  }
}
// Second pack archives: download, unpack, delete the archive.
for (const p of packWant) {
  const dir = path.join(scratch, 'dl', p.dir);
  if (existsSync(dir) && readdirSync(dir).length) { console.log('have', p.dir); continue; }
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'pack' + (p.url.endsWith('.7z') ? '.7z' : '.zip'));
  try {
    const n = await get(p.url, file);
    execFileSync('bsdtar', ['-xf', file, '-C', dir]);
    rmSync(file);
    console.log('fetched pack', p.dir, (n / 1e6).toFixed(0), 'MB, licence:', p.lic);
  } catch (e) { console.log('FAILED pack', p.dir, e.message); }
}
const groundWanted = GROUND.filter((g) => !want.length || want.includes(g.id) || want.includes('ground'));
for (const g of groundWanted) { try { await ground(g); } catch (e) { console.log('FAILED ground', g.id, e.message); } }

const queue = ids.slice();
await Promise.all([0, 1, 2, 3].map(async () => {
  while (queue.length) {
    const id = queue.shift();
    try { await one(id); } catch (e) { console.log('FAILED', id, e.message); }
  }
}));
