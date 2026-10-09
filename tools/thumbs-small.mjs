// ============================================================================
//  THUMBS SMALL  ·  makes the small image copies that the home page shows
// ----------------------------------------------------------------------------
//  The home page shows thumbnails in small slots: phone sector cards (196 px),
//  inspector minis, search rows (64 px) and chart tips. A 640x400 JPEG
//  decodes to 1.0 MB of bitmap. A 320x200 copy decodes to 0.26 MB. The page
//  gives both in srcset, and the browser takes the small copy when the slot
//  is small. This tool writes the copies with ImageMagick (magick on PATH):
//
//    pages/home/thumbs/<key>.jpg   640x400  ->  thumbs/sm/<key>.jpg   320x200, q78
//    pages/home/media/game-N.jpg  1200 wide ->  media/sm/game-N.jpg   640 wide, q80
//
//  It writes a copy only when the copy is missing or older than its source.
//  --check changes nothing. It exits 1 when a listed key (thumbs/list.js)
//  or a game image has no small copy, or a copy has the wrong size.
//  tools/thumbs-list.mjs --check runs the same check.
//
//  Usage (from the repo root):
//    node tools/thumbs-small.mjs           write missing or old copies
//    node tools/thumbs-small.mjs --check   change nothing, exit 1 if not complete
//    node tools/thumbs-small.mjs --force   write all copies again
//
//  grep -n targets
//    sizes and quality .... "const JOBS"
//    JPEG size reader ..... "export function jpegSize"
//    check ................ "export function checkSmall"
// ============================================================================
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HOME = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stella-nova', 'pages', 'home');
const JOBS = [
  { dir: 'thumbs', match: f => f.endsWith('.jpg'), w: 320, h: 200, q: 78 },
  { dir: 'media', match: f => /^game-\d+\.jpg$/.test(f), w: 640, h: 0, q: 80 },
];

// Width and height from the SOF marker of a JPEG file.
export function jpegSize(file) {
  const b = readFileSync(file);
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

function sources(job) { return readdirSync(path.join(HOME, job.dir)).filter(job.match).sort(); }

// The keys that thumbs/list.js names.
function listedKeys() {
  const t = readFileSync(path.join(HOME, 'thumbs', 'list.js'), 'utf8');
  const m = t.match(/THUMB_KEYS\s*=\s*(\[[^\]]*\])/);
  return m ? JSON.parse(m[1]) : [];
}

// Problems as text lines. Empty means every small copy is present and sized.
export function checkSmall() {
  const bad = [];
  const want = [
    ...listedKeys().map(k => ['thumbs', k + '.jpg', JOBS[0]]),
    ...sources(JOBS[1]).map(f => ['media', f, JOBS[1]]),
  ];
  for (const [dir, f, job] of want) {
    const sm = path.join(HOME, dir, 'sm', f);
    if (!existsSync(sm)) { bad.push(`missing ${dir}/sm/${f}`); continue; }
    const s = jpegSize(sm);
    if (!s || s.w !== job.w || (job.h && s.h !== job.h)) bad.push(`wrong size ${dir}/sm/${f}: ${s ? s.w + 'x' + s.h : '?'}`);
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = checkSmall();
    console.log(bad.length ? bad.join('\n') + `\n${bad.length} problem(s) (run node tools/thumbs-small.mjs)` : 'complete     thumbs/sm and media/sm');
    process.exit(bad.length ? 1 : 0);
  }
  const force = process.argv.includes('--force');
  let made = 0, kept = 0;
  for (const job of JOBS) {
    mkdirSync(path.join(HOME, job.dir, 'sm'), { recursive: true });
    for (const f of sources(job)) {
      const src = path.join(HOME, job.dir, f), dst = path.join(HOME, job.dir, 'sm', f);
      if (!force && existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) { kept++; continue; }
      const geo = job.h ? [`-resize`, `${job.w}x${job.h}^`, '-gravity', 'center', '-extent', `${job.w}x${job.h}`] : ['-resize', `${job.w}x`];
      execFileSync('magick', [src, '-filter', 'Lanczos', ...geo, '-strip', '-sampling-factor', '4:2:0', '-interlace', 'JPEG', '-quality', String(job.q), dst]);
      made++;
    }
  }
  console.log(`wrote ${made} small copies, ${kept} up to date`);
}
