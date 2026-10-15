// ============================================================================
//  WEATHER MAP  ·  tests/assets.test.mjs  ·  globe textures and credits
// ----------------------------------------------------------------------------
//  Default export function (ok), with ok(name, pass, detail). tests.mjs runs
//  it. "node tests/assets.test.mjs" also runs it alone.
//
//  Checks: every file in tex/manifest.json exists with the stated byte
//  count, sha256, and pixel size (read from the JPEG SOF or PNG IHDR
//  header); the contract files are all present; tex/ stays under 16 MB;
//  CREDITS.txt names every source URL in the manifest.
//
//  GREP MAP   (grep -n "^// ---" tests/assets.test.mjs)
// ============================================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEX = join(ROOT, 'tex');
const REQUIRED = ['day-8k.jpg', 'day-2k.jpg', 'us-day.jpg', 'night-4k.jpg', 'height-4k.png', 'water-2k.png'];

// --- image header size ------------------------------------------------------
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// --- grey PNG decode (8-bit, colour type 0, no interlace) --------------------
export function decodeGreyPng(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 0 || buf[28] !== 0) return null;
  const parts = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8);
    if (type === 'IDAT') parts.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)], row = y * (w + 1) + 1;
    for (let x = 0; x < w; x++) {
      const a = x ? px[y * w + x - 1] : 0, b = y ? px[(y - 1) * w + x] : 0;
      const c = x && y ? px[(y - 1) * w + x - 1] : 0;
      let v = raw[row + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * w + x] = v & 255;
    }
  }
  return { w, h, px, at(lat, lon) {
    const x = Math.min(w - 1, Math.floor((lon + 180) / 360 * w)), y = Math.min(h - 1, Math.floor((90 - lat) / 180 * h));
    return px[y * w + x];
  } };
}

// --- tests --------------------------------------------------------------------
export default function assetsTest(ok) {
  const mpath = join(TEX, 'manifest.json');
  ok('assets: tex/manifest.json exists', existsSync(mpath));
  if (!existsSync(mpath)) return;
  const man = JSON.parse(readFileSync(mpath, 'utf8'));
  const names = Object.keys(man);
  const missing = REQUIRED.filter((n) => !names.includes(n));
  ok('assets: manifest lists every contract file', missing.length === 0, missing.join(', '));

  let total = 0;
  for (const name of names) {
    const e = man[name];
    const p = join(TEX, name);
    if (!existsSync(p)) { ok(`assets: ${name} exists`, false); continue; }
    const buf = readFileSync(p);
    total += buf.length;
    const sha = createHash('sha256').update(buf).digest('hex');
    const sz = imageSize(buf);
    ok(`assets: ${name} bytes`, buf.length === e.bytes, `${buf.length} vs ${e.bytes}`);
    ok(`assets: ${name} sha256`, sha === e.sha256, sha.slice(0, 12));
    ok(`assets: ${name} size ${e.w}x${e.h}`, !!sz && sz.w === e.w && sz.h === e.h, sz ? `${sz.w}x${sz.h}` : 'no header');
    ok(`assets: ${name} type`, !!sz && sz.type === (name.endsWith('.png') ? 'png' : 'jpeg'));
    ok(`assets: ${name} source URL`, /^https:\/\//.test(e.source || ''), e.source);
  }

  // files on disk that the manifest does not list
  const extra = readdirSync(TEX).filter((f) => f !== 'manifest.json' && !f.startsWith('.') && !names.includes(f));
  ok('assets: no unlisted files in tex/', extra.length === 0, extra.join(', '));

  const dirBytes = readdirSync(TEX).reduce((s, f) => s + statSync(join(TEX, f)).size, 0);
  ok('assets: tex/ under 16 MB', dirBytes < 16 * 1024 * 1024, (dirBytes / 1048576).toFixed(2) + ' MB');

  const d8 = man['day-8k.jpg'];
  ok('assets: day-8k is 2:1 and 8k or 4k wide', d8 && d8.w === 2 * d8.h && (d8.w === 8192 || d8.w === 4096), d8 && `${d8.w}x${d8.h}`);
  ok('assets: day-8k fits 6 MB', d8 && d8.bytes <= 6 * 1024 * 1024);
  const us = man['us-day.jpg'];
  ok('assets: us-day bounds lat 15..60 lon -170..-50', us && us.bounds && us.bounds.lat0 === 15 && us.bounds.lat1 === 60
    && us.bounds.lon0 === -170 && us.bounds.lon1 === -50);
  ok('assets: us-day fits 4 MB', us && us.bytes <= 4 * 1024 * 1024);
  ok('assets: us-day aspect matches its bounds', us && Math.abs(us.w / us.h - 120 / 45) < 0.01, us && `${us.w}x${us.h}`);

  // water-2k: open sea is 255, a continent interior is 0, Lake Superior is water
  const water = man['water-2k.png'];
  ok('assets: water-2k is 2048x1024', water && water.w === 2048 && water.h === 1024);
  const W = existsSync(join(TEX, 'water-2k.png')) && decodeGreyPng(readFileSync(join(TEX, 'water-2k.png')));
  ok('assets: water-2k decodes as 8-bit grey', !!W);
  if (W) {
    ok('assets: water-2k Pacific (30N 140W) is water', W.at(30, -140) === 255, W.at(30, -140));
    ok('assets: water-2k Kansas (39N 98W) is land', W.at(39, -98) === 0, W.at(39, -98));
    ok('assets: water-2k Lake Superior (47.7N 87.5W) is water', W.at(47.7, -87.5) > 200, W.at(47.7, -87.5));
    ok('assets: water-2k Lake Michigan (43.5N 87W) is water', W.at(43.5, -87) > 200, W.at(43.5, -87));
  }
  const H = existsSync(join(TEX, 'height-4k.png')) && decodeGreyPng(readFileSync(join(TEX, 'height-4k.png')));
  ok('assets: height-4k decodes as 8-bit grey', !!H);
  if (H) {
    ok('assets: height-4k sea is 0', H.at(30, -140) === 0 && H.at(35, -40) === 0);
    ok('assets: height-4k Colorado Rockies above Kansas above 0', H.at(39.5, -106) > H.at(39, -98) && H.at(39, -98) > 0,
      `${H.at(39.5, -106)} > ${H.at(39, -98)}`);
  }

  const cpath = join(ROOT, 'CREDITS.txt');
  ok('assets: CREDITS.txt exists', existsSync(cpath));
  if (existsSync(cpath)) {
    const c = readFileSync(cpath, 'utf8');
    const urls = new Set(names.flatMap((n) => [man[n].source, man[n].source2].filter(Boolean)));
    const notIn = [...urls].filter((u) => !c.includes(u));
    ok('assets: CREDITS.txt names every source URL', notIn.length === 0, notIn.join(' '));
    for (const w of ['Open-Meteo', 'CC BY 4.0', 'Weather Prediction Center', 'RainViewer', 'Natural Earth', 'public domain']) {
      ok(`assets: CREDITS.txt mentions ${w}`, c.replace(/\s+/g, ' ').toLowerCase().includes(w.toLowerCase()));
    }
  }
}

// --- run alone ------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let n = 0, bad = 0;
  const ok = (name, pass, detail) => {
    n++; if (!pass) bad++;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined && detail !== '' ? '  (' + detail + ')' : ''}`);
  };
  assetsTest(ok);
  console.log(`${n - bad}/${n} passed`);
  process.exit(bad ? 1 : 0);
}
