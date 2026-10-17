// Impostor bakes and look renders for the nature pack (node + Deno).
//
//   NATURE_SCRATCH=.. NATURE_DEPS=.. node impostor.mjs bake [id ...]
//     Bakes a 3 x 3 impostor atlas for each record with wantImpostor (or
//     impostor) set: cells 0..7 are side views, cell 8 is the top view.
//     Writes impostors/<id>_albedo.webp and _normal.webp and puts the
//     layout in the build record. Run build.mjs manifest after it.
//   NATURE_SCRATCH=.. NATURE_DEPS=.. node impostor.mjs look <out.png> <lod> id [id ...]
//     Renders the assets in a row with a sun, sky and ground, for a check
//     by eye. Delete the PNG after the check.
//   ... node impostor.mjs sheet <out.png> id [id ...]
//     Writes the baked atlases of the ids side by side (albedo over grey).
//
// The GPU work is render-deno.js (deno run -A). This file decodes WebP
// to raw RGBA for it and codes the results with sharp.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseGLB } from '../../lib/glb-lite.js';
import { pushPull } from './textures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../assets/nature');
const scratch = process.env.NATURE_SCRATCH, deps = process.env.NATURE_DEPS;
if (!scratch || !deps) { console.error('set NATURE_SCRATCH and NATURE_DEPS'); process.exit(2); }
const sharp = createRequire(path.join(deps, 'package.json'))('sharp');
const REC = path.join(scratch, 'build', 'records');
const RAW = path.join(scratch, 'build', 'raw');
mkdirSync(RAW, { recursive: true });

const CELL = 256, SS = 2; // output cell size, supersampling

async function rawTex(file) {
  const key = createHash('md5').update(file).digest('hex').slice(0, 16);
  const out = path.join(RAW, key + '.rgba');
  const meta = out + '.json';
  if (existsSync(meta)) return JSON.parse(readFileSync(meta, 'utf8'));
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  writeFileSync(out, data);
  const m = { file: out, w: info.width, h: info.height };
  writeFileSync(meta, JSON.stringify(m));
  return m;
}

async function modelJob(glbRel, offset = [0, 0, 0], yaw = 0) {
  const glb = path.join(OUT, glbRel);
  const b = readFileSync(glb);
  const s = parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const textures = {};
  for (const im of s.images) if (im.uri) textures[im.uri] = await rawTex(path.resolve(path.dirname(glb), im.uri));
  return { glb, textures, offset, yaw, bounds: s.bounds };
}

function deno(job) {
  const jf = path.join(scratch, 'build', 'job.json');
  writeFileSync(jf, JSON.stringify(job));
  execFileSync('deno', ['run', '-A', path.join(here, 'render-deno.js'), jf], { stdio: 'inherit' });
}

const loadRec = (id) => JSON.parse(readFileSync(path.join(REC, id + '.json'), 'utf8'));

// 2x2 box down-sample with coverage weights (colour premultiplied by the
// albedo alpha), so edges keep their colour.
function downsample(a, n, W, H, f) {
  const w = W / f, h = H / f;
  const oa = new Uint8Array(w * h * 4), on = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let wa = 0; const ca = [0, 0, 0], cn = [0, 0, 0, 0];
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const i = ((y * f + dy) * W + (x * f + dx)) * 4;
      const al = a[i + 3] / 255;
      wa += al;
      for (let c = 0; c < 3; c++) { ca[c] += a[i + c] * al; cn[c] += n[i + c] * al; }
      cn[3] += n[i + 3] * al;
    }
    const o = (y * w + x) * 4;
    if (wa > 0) {
      for (let c = 0; c < 3; c++) { oa[o + c] = Math.round(ca[c] / wa); on[o + c] = Math.round(cn[c] / wa); }
      on[o + 3] = Math.round(cn[3] / wa);
    } else { on[o] = 128; on[o + 1] = 128; on[o + 2] = 255; }
    oa[o + 3] = Math.round((wa / (f * f)) * 255);
  }
  return { a: oa, n: on, w, h };
}

async function bake(id) {
  const rec = loadRec(id);
  const lod = rec.lods[0];
  const m = await modelJob(lod.file);
  const H = rec.height, R = Math.max(rec.radius, 0.01);
  const hs = Math.max(R, H / 2) * 1.03;          // half size of a side cell, metres
  const ht = R * 1.03;                             // half size of the top cell
  const c = [0, H / 2, 0];
  const D = 4 * Math.max(hs, H) + 10;
  const views = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI * 2) / 8;
    views.push({ eye: [c[0] + Math.sin(a) * D, c[1], c[2] + Math.cos(a) * D], target: c, up: [0, 1, 0], ortho: hs, near: D - R * 1.05, far: D + R * 1.05 });
  }
  views.push({ eye: [0, H + D, 0], target: [0, 0, 0], up: [0, 0, -1], ortho: ht, near: D - 0.05, far: D + H + 0.05 });
  const size = CELL * SS;
  const ra = path.join(scratch, 'build', id + '_a.rgba'), rn = path.join(scratch, 'build', id + '_n.rgba');
  deno({ renders: [{ models: [m], mode: 'impostor', size, views, out: { albedo: ra, normal: rn } }] });
  const A = new Uint8Array(readFileSync(ra)), N = new Uint8Array(readFileSync(rn));
  rmSync(ra); rmSync(rn);
  const W = size * 9;
  const ds = downsample(A, N, W, size, SS);
  // Lay the 9 cells out as a 3 x 3 atlas.
  const S = CELL * 3;
  const atA = new Uint8Array(S * S * 4), atN = new Uint8Array(S * S * 4);
  for (let k = 0; k < 9; k++) {
    const cx = (k % 3) * CELL, cy = Math.floor(k / 3) * CELL;
    for (let y = 0; y < CELL; y++) {
      const src = (y * ds.w + k * CELL) * 4, dst = ((cy + y) * S + cx) * 4;
      atA.set(ds.a.subarray(src, src + CELL * 4), dst);
      atN.set(ds.n.subarray(src, src + CELL * 4), dst);
    }
  }
  // Coverage check: an empty view means a bad bake.
  const cov = [];
  for (let k = 0; k < 9; k++) {
    let n = 0; const cx = (k % 3) * CELL, cy = Math.floor(k / 3) * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (atA[((cy + y) * S + cx + x) * 4 + 3] >= 128) n++;
    cov.push(n / (CELL * CELL));
  }
  // Fill colour and normal under empty texels (for filtering).
  pushPull(atA, S, S);
  const nTmp = new Uint8Array(atN); for (let i = 0; i < S * S; i++) nTmp[i * 4 + 3] = atA[i * 4 + 3];
  pushPull(nTmp, S, S); for (let i = 0; i < S * S; i++) { atN[i * 4] = nTmp[i * 4]; atN[i * 4 + 1] = nTmp[i * 4 + 1]; atN[i * 4 + 2] = nTmp[i * 4 + 2]; }
  const dir = path.join(OUT, 'impostors');
  mkdirSync(dir, { recursive: true });
  const fa = path.join(dir, id + '_albedo.webp'), fn = path.join(dir, id + '_normal.webp');
  await sharp(Buffer.from(atA.buffer), { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 82, alphaQuality: 90, effort: 5 }).toFile(fa);
  await sharp(Buffer.from(atN.buffer), { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 88, alphaQuality: 85, effort: 5 }).toFile(fn);
  rec.impostor = {
    albedo: 'impostors/' + id + '_albedo.webp', normal: 'impostors/' + id + '_normal.webp',
    layout: '3x3', size: S, cell: CELL,
    views: 'cells row-major from the top-left; cell k < 8 is a side view with the camera at azimuth k*45 deg, at centre + (sin a, 0, cos a) * d, looking at the centre; cell 8 is the top view, camera on +y, image up = -z',
    centre: c.map((x) => +x.toFixed(3)), sideHalfSize: +hs.toFixed(3), topHalfSize: +ht.toFixed(3),
    normal: 'world normal * 0.5 + 0.5 in rgb; a = depth in the view box (1 near, 0 far)',
    coverage: cov.map((x) => +x.toFixed(3)),
  };
  writeFileSync(path.join(REC, id + '.json'), JSON.stringify(rec, null, 1));
  console.log('  impostor', id, 'coverage', cov.map((x) => x.toFixed(2)).join(' '));
  if (Math.min(...cov) < 0.01) console.log('  WARNING (bake): an empty view in', id);
}

async function look(outPng, lod, ids) {
  const models = [];
  let x = 0, maxH = 0;
  const recs = ids.map(loadRec);
  const gap = (r) => Math.max(r.footprint, 0.3) * 0.6;
  const total = recs.reduce((s, r) => s + Math.max(r.footprint, 0.3) + gap(r), 0);
  x = -total / 2;
  for (const r of recs) {
    const w = Math.max(r.footprint, 0.3);
    x += w / 2;
    models.push(await modelJob(r.lods[Math.min(lod, r.lods.length - 1)].file, [x, -(r.sink || 0) * r.height, 0]));
    x += w / 2 + gap(r);
    maxH = Math.max(maxH, r.height);
  }
  const span = Math.max(total, maxH * 1.6);
  const tgt = [0, maxH * 0.45, 0];
  const dist = span * 1.05 / (2 * Math.tan(0.3));
  const eye = [0, maxH * 0.45 + dist * 0.2, dist];
  const size = 1024;
  const rc = path.join(scratch, 'build', 'look.rgba');
  deno({ renders: [{ models, mode: 'beauty', size, sun: [0.6, 0.7, 0.5], views: [{ eye, target: tgt, up: [0, 1, 0], fov: 0.6, near: 0.05, far: dist * 4 }], out: { color: rc } }] });
  await sharp(readFileSync(rc), { raw: { width: size, height: size, channels: 4 } }).png().toFile(outPng);
  rmSync(rc);
  console.log('look', outPng);
}

async function sheet(outPng, ids) {
  const tiles = [];
  for (const id of ids) {
    const r = loadRec(id);
    if (!r.impostor) continue;
    const a = await sharp(path.join(OUT, r.impostor.albedo)).flatten({ background: '#7f7f7f' }).resize(384).png().toBuffer();
    const n = await sharp(path.join(OUT, r.impostor.normal)).removeAlpha().resize(384).png().toBuffer();
    tiles.push(a, n);
  }
  const cols = 4, rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * 384, height: rows * 384, channels: 3, background: '#202020' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * 384, top: Math.floor(i / cols) * 384 }))).png().toFile(outPng);
  console.log('sheet', outPng);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'bake') {
  const ids = rest.length ? rest : readdirSync(REC).map((f) => f.replace(/\.json$/, '')).filter((id) => { const r = loadRec(id); return r.wantImpostor || r.impostor; });
  for (const id of ids) { try { await bake(id); } catch (e) { console.log('  FAILED impostor', id, e.message); } }
} else if (cmd === 'look') {
  await look(rest[0], +rest[1], rest.slice(2));
} else if (cmd === 'sheet') {
  await sheet(rest[0], rest.slice(1));
} else {
  console.log('usage: impostor.mjs bake [id...] | look out.png lod id... | sheet out.png id...');
}
