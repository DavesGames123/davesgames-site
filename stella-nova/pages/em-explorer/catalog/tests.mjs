// em-explorer CATALOG tests (node, no browser).
//
//   node stella-nova/pages/em-explorer/catalog/tests.mjs
//       offline: record shape, licences, bounds, captions, CREDITS.md
//   node stella-nova/pages/em-explorer/catalog/tests.mjs --live
//       + checks each dataset's size against its live info / .zarray and
//         reads one small slice at every bookmark through the DATA package
//         (about 70 MB in all; OpenOrganelle s0 chunks are 1.5 MB each)
//   ... --live --png <dir>
//       + writes one 256 px PNG per bookmark into <dir> to look at
//
// Find things (grep -n): 'function offline'  'function live'  'function pickScale'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import * as CAT from './index.js';

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const PNG_DIR = argv.includes('--png') ? argv[argv.indexOf('--png') + 1] : null;
const HERE = new URL('./', import.meta.url);

let pass = 0, fail = 0;
function ok(cond, name, info) {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${info !== undefined ? ' · ' + JSON.stringify(info) : ''}`); }
}

const PLANES = ['xy', 'xz', 'yz'];
const FOUND = ['annotation', 'groundtruth', 'survey'];
const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s<>"]+$/.test(u);
const plain = (s) => typeof s === 'string' && s.trim() === s && s.length > 0 && !/[<>\n\r]/.test(s);
// Latin abbreviations and filler that the captions must not use.
const BANNED = /\b(e\.g\.|i\.e\.|etc\.|stunning|breathtaking|amazing|incredible)/i;

function offline() {
  const { DATASETS, BOOKMARKS, ABOUT, SCALE_FACTS, DEFAULT_DATASET } = CAT;
  ok(Array.isArray(DATASETS) && DATASETS.length >= 4, 'at least 4 datasets', DATASETS.length);
  ok(CAT.CATALOG_API_VERSION === 1, 'api version');
  const ids = new Set();
  for (const d of DATASETS) {
    const n = `dataset ${d.id}`;
    ok(typeof d.id === 'string' && /^[a-z0-9_-]+$/.test(d.id), n + ' id');
    ok(!ids.has(d.id), n + ' id unique'); ids.add(d.id);
    for (const k of ['name', 'short', 'organism', 'tissue', 'method', 'blurb', 'credit']) ok(plain(d[k]), `${n} ${k} is plain text`, d[k]);
    ok(d.licence === 'CC BY 4.0', n + ' licence', d.licence);
    ok(d.licenceUrl === 'https://creativecommons.org/licenses/by/4.0/', n + ' licenceUrl');
    ok(['precomputed', 'zarr'].includes(d.format), n + ' format', d.format);
    ok(isHttps(d.url) || /^gs:\/\/[a-z0-9._-]+\/\S+$/.test(d.url), n + ' url scheme', d.url);
    ok(!/\/$/.test(d.url), n + ' url has no trailing slash');
    ok(Array.isArray(d.size) && d.size.length === 3 && d.size.every((v) => Number.isInteger(v) && v > 0), n + ' size');
    ok(Array.isArray(d.voxel) && d.voxel.length === 3 && d.voxel.every((v) => v > 0 && v < 100), n + ' voxel nm');
    ok(Array.isArray(d.links) && d.links.length >= 1 && d.links.every((l) => plain(l.label) && isHttps(l.href)), n + ' links');
    const h = d.home;
    ok(h && PLANES.includes(h.plane) && h.zoom > 0 && [h.x, h.y, h.z].every((v, i) => Number.isFinite(v) && v >= 0 && v < d.size[i]), n + ' home view inside the volume', h);
    // The home view must show most of the volume on a 900 px wide screen.
    const ua = { xy: 0, xz: 0, yz: 2 }[h.plane];
    ok(d.size[ua] * h.zoom <= 1400 && d.size[ua] * h.zoom >= 300, n + ' home zoom shows the whole width', d.size[ua] * h.zoom);
    ok(CAT.bookmarksFor(d.id).length >= 2, n + ' has 2 or more bookmarks', CAT.bookmarksFor(d.id).length);
    const hv = CAT.homeView(d.id);
    ok(hv && hv.plane === h.plane && hv !== h, n + ' homeView gives a copy');
  }
  ok(ids.has(DEFAULT_DATASET), 'default dataset exists');
  ok(CAT.datasetById('nope') === null && CAT.homeView('nope') === null, 'unknown id gives null');

  ok(Array.isArray(BOOKMARKS) && BOOKMARKS.length >= 30, 'at least 30 bookmarks', BOOKMARKS.length);
  const bids = new Set();
  for (const b of BOOKMARKS) {
    const n = `bookmark ${b.id}`;
    const d = CAT.datasetById(b.dataset);
    ok(typeof b.id === 'string' && /^[a-z0-9-]+$/.test(b.id), n + ' id');
    ok(!bids.has(b.id), n + ' id unique'); bids.add(b.id);
    ok(!!d, n + ' dataset exists', b.dataset);
    if (!d) continue;
    ok([b.x, b.y, b.z].every((v, i) => Number.isInteger(v) && v >= 0 && v < d.size[i]), n + ' x y z inside the volume', [b.x, b.y, b.z]);
    ok(Number.isFinite(b.zoom) && b.zoom >= 0.0003 && b.zoom <= 4, n + ' zoom in range', b.zoom);
    ok(PLANES.includes(b.plane), n + ' plane');
    ok(plain(b.title) && b.title.length <= 40, n + ' title short and plain', b.title);
    ok(plain(b.caption) && b.caption.length >= 30 && b.caption.length <= 160, n + ' caption one plain line, 30..160 chars', b.caption.length);
    ok(!BANNED.test(b.caption), n + ' caption wording', b.caption);
    ok(/[.!?]$/.test(b.caption), n + ' caption ends a sentence');
    ok(isHttps(b.source), n + ' source link', b.source);
    ok(FOUND.includes(b.found), n + ' found', b.found);
    const nm = CAT.nmOf(b);
    ok(nm && Math.abs(nm.x - b.x * d.voxel[0]) < 1e-6, n + ' nmOf');
    ok(CAT.bookmarkById(b.id) === b, n + ' bookmarkById');
  }
  // Variety: the contract asks for these structures.
  const text = BOOKMARKS.map((b) => (b.title + ' ' + b.caption).toLowerCase()).join(' | ');
  for (const w of ['synap', 'vesicle', 'mitochondri', 'crista', 'nucle', 'myelin', 'blood vessel', 'red blood', 'endoplasmic reticulum', 'golgi', 'ribosome', 'microtubule', 'lipid', 'peroxisome', 'glycogen'])
    ok(text.includes(w), `some bookmark shows "${w}"`);
  const datasetsUsed = new Set(BOOKMARKS.map((b) => b.dataset));
  ok(datasetsUsed.size === DATASETS.length, 'every dataset has bookmarks');

  ok(plain(ABOUT.title) && ABOUT.paragraphs.length >= 1 && ABOUT.paragraphs.every(plain), 'ABOUT paragraphs');
  ok(Array.isArray(ABOUT.sections) && ABOUT.sections.length >= 3 && ABOUT.sections.every((s) => plain(s.title) && s.paragraphs.every(plain)), 'ABOUT sections');
  const about = JSON.stringify(ABOUT).toLowerCase();
  for (const w of ['fib-sem', 'serial-section', 'tem', 'voxel', 'cc by 4.0']) ok(about.includes(w), `ABOUT mentions ${w}`);
  ok(SCALE_FACTS.length >= 3 && SCALE_FACTS.every((f) => plain(f.text) && f.nm > 0 && isHttps(f.source)), 'SCALE_FACTS');

  // CREDITS.md names every dataset, its licence and its credit papers.
  const credits = readFileSync(new URL('../CREDITS.md', HERE), 'utf8');
  for (const d of DATASETS) {
    ok(credits.includes(d.id), `CREDITS.md names ${d.id}`);
    for (const l of d.links) ok(credits.includes(l.href), `CREDITS.md links ${l.href}`);
  }
  ok((credits.match(/CC BY 4\.0/g) || []).length >= 4, 'CREDITS.md states CC BY 4.0');

  // The page must not copy data into the repo: catalog files stay small.
  for (const f of ['index.js', 'datasets.js', 'bookmarks.js', 'about.js']) {
    const n = readFileSync(new URL(f, HERE)).length;
    ok(n < 40000, `${f} is small`, n);
  }
}

// ---------------------------------------------------------------- live

function decodeJpegPIL(bytes) {
  const out = execFileSync('python3', ['-I', '-c',
    'import sys,io\nfrom PIL import Image\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("L")\n' +
    'sys.stdout.buffer.write(im.size[0].to_bytes(4,"little")+im.size[1].to_bytes(4,"little")+im.tobytes())'],
  { input: Buffer.from(bytes), maxBuffer: 64 << 20 });
  const w = out.readUInt32LE(0), h = out.readUInt32LE(4);
  return Promise.resolve({ width: w, height: h, data: new Uint8Array(out.buffer, out.byteOffset + 8, w * h) });
}

function writePng(path, w, h, data) {
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc32 = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(data.buffer, data.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// The scale VIEW would show at this zoom: the coarsest scale whose in-plane
// voxel is no larger than one CSS px.
export function pickScale(vol, zoom, plane) {
  const ua = { xy: 0, xz: 0, yz: 2 }[plane];
  const r0 = vol.scales[0].resolution[ua];
  let best = 0;
  vol.scales.forEach((s, i) => { if (s.resolution[ua] / r0 <= Math.max(1, 1 / zoom)) best = i; });
  return best;
}

const UVN = { xy: [0, 1, 2], xz: [0, 2, 1], yz: [2, 1, 0] };

async function live() {
  const { openVolume } = await import('../data/index.js');
  if (PNG_DIR) mkdirSync(PNG_DIR, { recursive: true });
  const vols = {};
  let bytes = 0;
  const countingFetch = async (url, init) => {
    // A stalled archive must fail the check, not hang it.
    const r = await fetch(url, { ...init, signal: init && init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    const b = await r.arrayBuffer(); bytes += b.byteLength;
    return new Response(b, { status: r.status, headers: r.headers });
  };
  for (const d of CAT.DATASETS) {
    try {
      vols[d.id] = await openVolume(d, { fetch: countingFetch, decodeJpeg: decodeJpegPIL, worker: false });
      const s0 = vols[d.id].scales[0];
      ok(s0.size.every((v, i) => v === d.size[i]), `live ${d.id} size matches the record`, [s0.size, d.size]);
      ok(s0.resolution.every((v, i) => Math.abs(v - d.voxel[i]) < 1e-6), `live ${d.id} voxel matches the record`, [s0.resolution, d.voxel]);
    } catch (e) { ok(false, `live ${d.id} opens`, String(e && e.message || e)); }
  }
  for (const b of CAT.BOOKMARKS) {
    const vol = vols[b.dataset];
    if (!vol) continue;
    const si = pickScale(vol, b.zoom, b.plane);
    const s = vol.scales[si];
    const f = s.resolution.map((r, i) => vol.scales[0].resolution[i] / r);
    const c = [b.x, b.y, b.z].map((v, i) => Math.floor(v * f[i]));
    const [ua, va, na] = UVN[b.plane];
    const half = PNG_DIR ? 128 : 64; // 64x64 inside a lipid droplet is too smooth to test
    const rect = [c[ua] - half, c[va] - half, c[ua] + half, c[va] + half];
    try {
      const t = performance.now();
      const sl = await vol.getSlice(si, b.plane, c[na], rect);
      let sum = 0, sum2 = 0, zeros = 0, lo = 255, hi = 0;
      for (const v of sl.data) { sum += v; sum2 += v * v; if (v === 0) zeros++; if (v < lo) lo = v; if (v > hi) hi = v; }
      const m = sum / sl.data.length, sd = Math.sqrt(Math.max(0, sum2 / sl.data.length - m * m));
      const zf = zeros / sl.data.length;
      // minnie65 has only about 60 grey levels, so a coarse overview can have
      // a small spread: ask for some spread and a real range, not a fixed sd.
      ok(sd > 1.5 && hi - lo > 12 && zf < 0.5, `live ${b.id} shows image content`, { si, mean: +m.toFixed(1), sd: +sd.toFixed(1), range: [lo, hi], zeroFrac: +zf.toFixed(2) });
      console.log(`  ${b.id.padEnd(20)} s${si} ${b.plane} ${sl.width}x${sl.height} mean ${m.toFixed(0)} sd ${sd.toFixed(1)} zero ${zf.toFixed(2)} ${(performance.now() - t).toFixed(0)} ms`);
      if (PNG_DIR) writePng(`${PNG_DIR}/${b.id}.png`, sl.width, sl.height, sl.data);
    } catch (e) { ok(false, `live ${b.id} slice`, String(e && e.message || e)); }
  }
  for (const v of Object.values(vols)) { try { v.dispose && v.dispose(); } catch (e) { /* DATA */ } }
  console.log(`  fetched ${(bytes / 1e6).toFixed(1)} MB`);
}

offline();
if (LIVE) await live();
console.log(`${pass} passed, ${fail} failed${LIVE ? '' : ' (offline; add --live for real tiles)'}`);
process.exit(fail ? 1 : 0);
