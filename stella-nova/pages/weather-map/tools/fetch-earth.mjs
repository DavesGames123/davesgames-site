#!/usr/bin/env node
// ============================================================================
//  WEATHER MAP  ·  tools/fetch-earth.mjs  ·  globe textures from NASA imagery
// ----------------------------------------------------------------------------
//  Runs offline, once. The script downloads public-domain NASA images, makes
//  the web-sized textures in ../tex and writes ../tex/manifest.json.
//
//  Sources (NASA Earth Observatory, Visible Earth, public domain). Base URL
//  https://assets.science.nasa.gov/content/dam/science/esd/eo/images/
//    day    bmng/bmng-base/<month>/world.2004MM.3x21600x10800.jpg
//           Blue Marble Next Generation, no shaded relief, 1.85 km/px
//    elev   bmng/topography/gebco_08_rev_elev_21600x10800.jpg
//           BMNG topography (GEBCO 08), grey, land only
//    bath   bmng/bathymetry/gebco_08_rev_bath_5400x2700.jpg
//           BMNG bathymetry (GEBCO 08), grey, 255 on land
//    night  imagerecords/144000/144898/BlackMarble_2016_3km.jpg
//           Black Marble 2016 colour composite (Suomi NPP VIIRS)
//  Lakes (Natural Earth 10m lakes v5.1.2, public domain), because the GEBCO
//  bathymetry marks the Great Lakes and most inland water as land:
//    lakes  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/
//           v5.1.2/geojson/ne_10m_lakes.geojson
//
//  Outputs (equirect, u = (lon + 180) / 360, v = (90 - lat) / 180):
//    day-8k.jpg   8192x4096 (4096x2048 if 8k does not fit in 6 MB)
//    day-2k.jpg   2048x1024 phone fallback
//    us-day.jpg   native 60 px/deg crop, lat 15..60, lon -170..-50
//    night-4k.jpg 4096x2048 city lights only (moonlit land and sea removed)
//    height-4k.png 4096x2048 grey, 0 = sea, land only (lakes keep their value)
//    water-2k.png 2048x1024 grey, 255 = water, 0 = land, edges antialiased
//  The water mask is built at 8192x4096 (bathymetry land, minus the lake
//  polygons, plus the islands in them) and box-filtered to 2048x1024.
//  The height uses the sea-only mask, so lakes above sea level are no pits.
//
//  Each download goes into its own new directory under --work. The image
//  work runs in python3 -I (PIL and numpy) from a script file that this
//  tool writes into a separate directory, with the paths as arguments.
//  JPEG quality is the highest value that keeps each file under its cap.
//
//  Run:  node tools/fetch-earth.mjs --work <scratch dir> [--month 07]
//        [--keep]   (keep the downloads; default deletes them at the end)
//
//  GREP MAP   (grep -n "^// ---" tools/fetch-earth.mjs)
// ============================================================================
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync,
  rmSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEX = resolve(HERE, '..', 'tex');
const UA = 'davesgames.io weather-map';
const BASE = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

// --- arguments --------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const WORK = arg('--work');
const MONTH = String(arg('--month', '07')).padStart(2, '0');
const KEEP = argv.includes('--keep');
if (!WORK) { console.error('usage: node tools/fetch-earth.mjs --work <dir> [--month 07] [--keep]'); process.exit(2); }
const mi = Number(MONTH) - 1;
if (!(mi >= 0 && mi < 12)) { console.error('bad --month'); process.exit(2); }

const SOURCES = {
  day: `${BASE}bmng/bmng-base/${MONTHS[mi]}/world.2004${MONTH}.3x21600x10800.jpg`,
  elev: `${BASE}bmng/topography/gebco_08_rev_elev_21600x10800.jpg`,
  bath: `${BASE}bmng/bathymetry/gebco_08_rev_bath_5400x2700.jpg`,
  night: `${BASE}imagerecords/144000/144898/BlackMarble_2016_3km.jpg`,
  lakes: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_lakes.geojson',
};

// --- download ---------------------------------------------------------------
// One new directory per download. Never sizes anything from content-length.
async function download(key, url) {
  mkdirSync(WORK, { recursive: true });
  const dir = mkdtempSync(join(WORK, `dl-${key}-`));
  const out = join(dir, url.split('/').pop());
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
  const buf = readFileSync(out);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  console.log(`got ${key}: ${buf.length} bytes  ${url}`);
  return { path: out, dir, bytes: buf.length, sha256, url };
}

// --- image work (python3 -I, PIL + numpy) -----------------------------------
const PY = String.raw`
import sys, json, io
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
Image.MAX_IMAGE_PIXELS = None
src = json.loads(sys.argv[1]); out = sys.argv[2]; caps = json.loads(sys.argv[3])
log = {}

def save_jpeg(img, name, cap):
    # highest quality (95 down to 60) that fits under cap bytes
    for q in range(95, 59, -1):
        b = io.BytesIO()
        img.save(b, 'JPEG', quality=q, optimize=True, progressive=True, subsampling=0 if q >= 90 else 2)
        if b.tell() <= cap:
            open(out + '/' + name, 'wb').write(b.getvalue())
            log[name] = {'w': img.width, 'h': img.height, 'quality': q}
            return True
    return False

def save_png(img, name):
    img.save(out + '/' + name, 'PNG', optimize=True)
    log[name] = {'w': img.width, 'h': img.height}

day = Image.open(src['day']).convert('RGB')
assert day.size == (21600, 10800), day.size

# day-8k (fall back to 4096 wide if 8k does not fit the cap)
d8 = day.resize((8192, 4096), Image.LANCZOS)
if not save_jpeg(d8, 'day-8k.jpg', caps['day-8k.jpg']):
    d4 = day.resize((4096, 2048), Image.LANCZOS)
    assert save_jpeg(d4, 'day-8k.jpg', caps['day-8k.jpg'])
del d8
save_jpeg(day.resize((2048, 1024), Image.LANCZOS), 'day-2k.jpg', caps['day-2k.jpg'])

# us-day: native pixels, 60 px/deg; lon -170..-50, lat 60..15
ppd = 21600 / 360.0
box = (int(round((-170 + 180) * ppd)), int(round((90 - 60) * ppd)),
       int(round((-50 + 180) * ppd)), int(round((90 - 15) * ppd)))
us = day.crop(box).filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
assert save_jpeg(us, 'us-day.jpg', caps['us-day.jpg'])
log['us-day.jpg']['crop'] = list(box)
del day, us

# Land mask at 8192x4096: bathymetry land (255) minus Natural Earth lakes.
MW, MH = 8192, 4096
bath = Image.open(src['bath']).convert('L')
land = bath.point(lambda v: 255 if v >= 255 else 0).resize((MW, MH), Image.NEAREST)
# height uses the sea-only mask: a lake keeps its grey value, so the relief
# has no pits at lakes above sea level (the shader reads water-2k for lakes)
sea_land = np.asarray(land.resize((4096, 2048), Image.BOX), dtype=np.float32) / 255.0
dr = ImageDraw.Draw(land)
def ring_px(ring):
    return [((lon + 180.0) / 360.0 * MW, (90.0 - lat) / 180.0 * MH) for lon, lat in ring]
nlakes = 0
for f in json.load(open(src['lakes']))['features']:
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        dr.polygon(ring_px(poly[0]), fill=0)
        for hole in poly[1:]:
            dr.polygon(ring_px(hole), fill=255)
        nlakes += 1
log['lakes'] = nlakes
landf = np.asarray(land, dtype=np.float32) / 255.0

# water-2k: 255 = water. Box filter gives soft edges.
lw = Image.fromarray(np.round((1.0 - landf) * 255).astype(np.uint8)).resize((2048, 1024), Image.BOX)
save_png(lw, 'water-2k.png')

# height-4k: BMNG grey elevation, land only. Sea pixels are set to 0.
# Decode (fitted, approximate): metres = 6500 * (v / 255) ^ (1 / 0.85)
elev = Image.open(src['elev']).convert('L').resize((4096, 2048), Image.BOX)
e = np.asarray(elev, dtype=np.float32)
e = np.where(sea_land > 0.5, e, 0.0)
save_png(Image.fromarray(np.clip(np.round(e), 0, 255).astype(np.uint8)), 'height-4k.png')

# night-4k: Black Marble without moonlit land and sea. The faint blue
# ground (luma under ~28) fades out; city lights keep their colour.
night = Image.open(src['night']).convert('RGB').resize((4096, 2048), Image.LANCZOS)
n = np.asarray(night, dtype=np.float32)
luma = 0.2126 * n[..., 0] + 0.7152 * n[..., 1] + 0.0722 * n[..., 2]
t = np.clip((luma - 22.0) / (60.0 - 22.0), 0.0, 1.0)
k = t * t * (3.0 - 2.0 * t)
lights = np.clip(n * k[..., None], 0, 255).astype(np.uint8)
save_jpeg(Image.fromarray(lights), 'night-4k.jpg', caps['night-4k.jpg'])
print(json.dumps(log))
`;

function runPython(srcPaths, caps) {
  const sdir = mkdtempSync(join(WORK, 'scripts-'));
  const script = join(sdir, 'fetch_earth_convert.py');
  writeFileSync(script, PY);
  const r = spawnSync('python3', ['-I', script, JSON.stringify(srcPaths), TEX, JSON.stringify(caps)],
    { encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'inherit'] });
  rmSync(sdir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`python3 failed (status ${r.status})`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// --- main ---------------------------------------------------------------------
async function main() {
  const chk = spawnSync('python3', ['-I', '-c', 'import PIL, numpy'], { encoding: 'utf8' });
  if (chk.status !== 0) throw new Error('python3 with PIL and numpy is required');
  mkdirSync(TEX, { recursive: true });
  const got = {};
  for (const [k, u] of Object.entries(SOURCES)) got[k] = await download(k, u);

  const MB = 1024 * 1024;
  const caps = { 'day-8k.jpg': 6 * MB, 'day-2k.jpg': 0.6 * MB, 'us-day.jpg': 4 * MB, 'night-4k.jpg': 1.5 * MB };
  const log = runPython(Object.fromEntries(Object.entries(got).map(([k, g]) => [k, g.path])), caps);

  const from = { 'day-8k.jpg': 'day', 'day-2k.jpg': 'day', 'us-day.jpg': 'day',
    'night-4k.jpg': 'night', 'height-4k.png': 'elev', 'water-2k.png': 'bath' };
  const extra = { 'water-2k.png': 'lakes' };
  const notes = {
    'day-8k.jpg': 'Blue Marble Next Generation, 2004-' + MONTH + ', no shaded relief, equirect',
    'day-2k.jpg': 'Blue Marble Next Generation, 2004-' + MONTH + ', phone fallback',
    'us-day.jpg': 'Blue Marble Next Generation at native 60 px/deg, light unsharp mask',
    'night-4k.jpg': 'Black Marble 2016 city lights; moonlit land and sea faded to black (luma 22..60 smoothstep)',
    'height-4k.png': 'GEBCO 08 land elevation grey, sea = 0, lakes keep their grey value (use water-2k for lakes); metres ~ 6500 * (v/255)^(1/0.85) (fitted, approximate)',
    'water-2k.png': '255 = water (GEBCO 08 sea plus Natural Earth 10m lakes), 0 = land; box-filtered from 8192x4096',
  };
  const manifest = {};
  let total = 0;
  for (const name of Object.keys(from)) {
    const p = join(TEX, name);
    const buf = readFileSync(p);
    const g = got[from[name]];
    const e = {
      w: log[name].w, h: log[name].h,
      bounds: name === 'us-day.jpg' ? { lat0: 15, lat1: 60, lon0: -170, lon1: -50 } : { lat0: -90, lat1: 90, lon0: -180, lon1: 180 },
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      source: g.url,
      sourceBytes: g.bytes,
      sourceSha256: g.sha256,
      license: 'Public domain (NASA); credit requested',
      ...(extra[name] ? { source2: got[extra[name]].url, source2Sha256: got[extra[name]].sha256,
        license2: 'Public domain (Natural Earth)' } : {}),
      note: notes[name],
    };
    if (log[name].quality) e.quality = log[name].quality;
    manifest[name] = e;
    total += buf.length;
    console.log(`${name.padEnd(14)} ${e.w}x${e.h}  ${(buf.length / MB).toFixed(2)} MB  q=${e.quality ?? '-'}`);
  }
  writeFileSync(join(TEX, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`lake polygons drawn: ${log.lakes}`);
  console.log(`total tex: ${(total / MB).toFixed(2)} MB`);
  if (!KEEP) for (const g of Object.values(got)) rmSync(g.dir, { recursive: true, force: true });
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
