// ============================================================================
//  NONFLOWERS  ·  view.js — DOM-free helpers for the page and the saver
// ----------------------------------------------------------------------------
//  Our own code around Nonflowers by Lingdong Huang (MIT). No DOM here, so
//  tests.mjs imports it.
//    fitScale       the CSS scale that keeps the 600 px painting crisp
//    layoutGrid     the herbarium grid: columns and cell size
//    parseSeedFrom  the seed of a share link (?seed= or #seed=)
//    crc32, pngWithText  tEXt chunks (the credit) in a PNG file
//    codeExtract    the first lines of an upstream function, for the plate
//    FIELDS         a name and a group for each PAR field of genParams()
//    mulberry, shuffle   a seeded random source for the saver order
//
//  GREP MAP
//    grep -n 'export function fitScale'      crisp sizes
//    grep -n 'export function layoutGrid'    herbarium cells
//    grep -n 'export function parseSeedFrom' share link
//    grep -n 'export function pngWithText'   PNG metadata
//    grep -n 'export function codeExtract'   plate code
//    grep -n 'export const FIELDS'           PAR names
// ============================================================================

// w x h painting px, dpr device px per CSS px, box in CSS px. Returns CSS
// px per painting px. First choice: a device scale k in {2, 1, 1/2, 1/3,
// 1/4} (each painting px is a whole number of device px, or the reverse).
// When that choice is less than 0.8 of the best fit (a phone), the best fit
// is used, never more than 2 device px per painting px.
export function fitScale(w, h, dpr, boxW, boxH) {
  const fit = Math.min(boxW * dpr / w, boxH * dpr / h, 2);
  const steps = [2, 1, 1 / 2, 1 / 3, 1 / 4];
  let k = steps.find(s => s <= fit + 1e-9) || 1 / 4;
  if (k < 0.8 * fit) k = fit;
  return k / dpr;
}

// The herbarium: n square cells in a box w CSS px wide. The grid scrolls
// down when it is taller than the box.
export function layoutGrid(w, h, n, gap = 14) {
  const cols = Math.max(2, Math.min(6, Math.round(w / 230)));
  const cell = Math.floor((w - gap * (cols - 1)) / cols);
  return { cols, rows: Math.ceil(n / cols), cell, gap };
}

// The seed of a share link. ?seed= first (the upstream form), then #seed=.
// The value is decoded; a bad escape is kept as it is. null when absent.
export function parseSeedFrom(search, hash) {
  for (const part of [search, hash]) {
    const m = /(?:^|[?#&])seed=([^&#]*)/.exec(part || '');
    if (m && m[1] !== '') { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
  }
  return null;
}

// ── PNG tEXt ────────────────────────────────────────────────────────────────
let CRC_T = null;
export function crc32(bytes) {
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// png: the bytes of a PNG file. fields: { keyword: text } in order. The
// tEXt chunks go right after IHDR. Text is Latin-1; other characters
// become '?'.
export function pngWithText(png, fields) {
  const latin = s => Uint8Array.from(String(s), ch => { const c = ch.charCodeAt(0); return c < 256 ? c : 63; });
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    const body = latin(k + '\0' + v), type = latin('tEXt');
    const out = new Uint8Array(12 + body.length), dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    out.set(type, 4); out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    chunks.push(out);
  }
  const at = 8 + 25;   // signature + IHDR (length, type, 13 bytes, crc)
  const size = png.length + chunks.reduce((a, c) => a + c.length, 0);
  const res = new Uint8Array(size);
  res.set(png.subarray(0, at));
  let o = at;
  for (const c of chunks) { res.set(c, o); o += c.length; }
  res.set(png.subarray(at), o);
  return res;
}

// The first `lines` lines of `function name(` in src, from the line that
// holds `from` (default: the function line). Blank lines are dropped.
export function codeExtract(src, name, lines = 12, from = null) {
  const L = src.split('\n');
  let i = L.findIndex(l => l.startsWith('function ' + name + '('));
  if (i < 0) return '';
  if (from) { const j = L.findIndex((l, k) => k > i && l.includes(from)); if (j > 0) i = j; }
  const out = [];
  for (let k = i; k < L.length && out.length < lines; k++) if (L[k].trim()) out.push(L[k].replace(/\s+$/, ''));
  return out.join('\n');
}

// ── PAR fields ──────────────────────────────────────────────────────────────
// [key, name, group]. The keys are the genParams() fields; the order is
// the upstream order. group: flower, leaf, stem (herbal), branch (woody).
export const FIELDS = [
  ['flowerChance', 'Flower chance', 'flower'], ['leafChance', 'Leaf chance', 'leaf'], ['leafType', 'Leaf veins', 'leaf'],
  ['flowerShape', 'Petal shape', 'flower'], ['leafShape', 'Leaf shape', 'leaf'],
  ['flowerColor', 'Petal colour', 'flower'], ['leafColor', 'Leaf colour', 'leaf'],
  ['flowerOpenCurve', 'Petal open curve', 'flower'], ['flowerColorCurve', 'Petal colour curve', 'flower'],
  ['leafLength', 'Leaf length', 'leaf'], ['flowerLength', 'Petal length', 'flower'], ['pedicelLength', 'Pedicel length', 'flower'],
  ['leafWidth', 'Leaf width', 'leaf'], ['flowerWidth', 'Petal width', 'flower'],
  ['stemWidth', 'Stem width', 'stem'], ['stemBend', 'Stem bend', 'stem'], ['stemLength', 'Stem length', 'stem'], ['stemCount', 'Stem count', 'stem'],
  ['sheathLength', 'Sheath length', 'stem'], ['sheathWidth', 'Sheath width', 'stem'], ['shootCount', 'Shoot count', 'stem'], ['shootLength', 'Shoot length', 'stem'],
  ['leafPosition', 'Leaf position', 'leaf'], ['flowerPetal', 'Petal count', 'flower'],
  ['innerLength', 'Inner length', 'flower'], ['innerWidth', 'Inner width', 'flower'], ['innerShape', 'Inner shape', 'flower'], ['innerColor', 'Inner colour', 'flower'],
  ['branchWidth', 'Branch width', 'branch'], ['branchTwist', 'Branch twist', 'branch'], ['branchDepth', 'Branch depth', 'branch'], ['branchFork', 'Branch fork', 'branch'],
  ['branchColor', 'Branch colour', 'branch'],
];
export const GROUPS = { flower: 'Flower', leaf: 'Leaf', stem: 'Stem (herbal)', branch: 'Branch (woody)' };

// ── seeded random ───────────────────────────────────────────────────────────
export function mulberry(a) {
  a = a >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
