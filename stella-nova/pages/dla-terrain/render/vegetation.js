// ============================================================================
//  DLA TERRAIN  ·  render/vegetation.js — grass, forests, rocks (package VEG)
// ----------------------------------------------------------------------------
//  createVegetation(gpu) -> module (CONTRACT.md "Module interface"):
//    setTerrain(t)  new Terrain: makeField + a scatter stream (scatter.js)
//    update(frame)  stream tiles round the camera (time budget), upload new
//                   instance pages, the per frame uniforms. frame.veg =
//                   { density 0.2..2.5, conifer 0..1, flowers 0..1 } (the
//                   Vegetation sliders): a new mix scatters again
//                   (scatter.js f.mix)
//    compute(enc)   grass: cs_blades + cs_final; props: cs_snap (new pages),
//                   cs_count, cs_scan, cs_emit (GPU cull, LOD, shadow list)
//    drawShadow     props into the sun cascade of this pass (CORE binds SP)
//    drawOpaque     props (bark, leaves, rocks), impostors, grass blades
//    resize, dispose, stats()
//
//  PROTOTYPES  Each scatter species (scatter.js SPECIES) draws with one or
//  more prototypes. A prototype is the real CC0 model of ASSETS
//  (assets/nature/manifest.json via lib/glb-lite.js, 3 LODs) when one fits
//  the species (kind + name words, PROTO_WORDS), else a procedural stand-in
//  made here (tree skeletons with leaf cards, conifer whorls, palms, ribbed
//  cacti, displaced rocks, ferns, reeds, flowers, mushrooms, logs). The
//  instance seed picks the variant. Stand-ins first: the asset models load
//  in the background and replace them. Phase 1 loads the manifest
//  default set; each finished terrain adds the assets whose biome tags are
//  on it (phase 2, the library is rebuilt then).
//
//  SHADOWS  Near casters (under 45 m) draw mesh LOD 1, far casters the
//  impostor quad turned to the sun (vs_imp_shadow), to shadowCap m.
//  Procedural textures (bark, leaf clusters, needles, fronds, rock) are
//  drawn on the CPU into one texture array; asset albedo maps go into the
//  same array (layer per source texture file).
//
//  IMPOSTORS  For every tree prototype, 8 side views of LOD0 are baked at
//  start into two texture arrays (albedo + alpha, view-space normal +
//  leaf flag), 4 x 2 frames per layer, with GPU mips. Far trees draw as
//  camera facing quads that blend the two nearest views; the LOD change
//  is a dither cross-fade (props.wgsl classify).
//
//  INSTANCE PAGES  The GPU instance buffer is cut in pages of PAGE
//  instances. A scatter tile takes whole pages; a dropped tile frees its
//  pages (they are zeroed: scale 0 is culled). New pages are snapped to
//  terrainHeight on the GPU (cs_snap); a terrain blend re-snaps all.
//
//  IDEAS FROM THE SITE  pages/plant-growth/render.js (leaf cards that
//  flutter in the wind, atlas of leaf shapes), pages/nonflowers (leaf
//  outline as a width profile along the midrib; MIT, Lingdong Huang, ideas
//  only), pages/shan-shui/tree.js (branches that taper and fork at random
//  angles; MIT, Lingdong Huang, ideas only), pages/mushrooms (cap and stem
//  as a lathe). No code was copied from those pages.
//
//  GREP MAP
//    grep -n 'function makeTextures'    procedural texture layers (CPU)
//    grep -n 'function genBranchTree'   broadleaf skeleton + leaf cards
//    grep -n 'function genConifer'      spruce and pine whorls
//    grep -n 'const GEN'                generator per species key
//    grep -n 'function loadAssetProtos' ASSETS models -> prototypes
//    grep -n 'function buildLibrary'    VB/IB, parts, lists, draw slots
//    grep -n 'function bakeImpostors'   the 8 view impostor bake
//    grep -n 'function syncTiles'       stream -> instance pages
//    grep -n 'export function planPages' nearest tiles win a full pool
//    grep -n 'export function classifyCPU' CPU twin of the GPU cull
//    grep -n 'export async function createVegetation'
// ============================================================================
import { makeField, createScatterStream, tileDist, SPECIES, LAYERS, LAYER_INDEX, STRIDE, BIOME_KEYS, normKey, MIX0 } from './scatter.js';

export const PAGE = 128;               // instances per page (props.wgsl PAGE)
const LODS = 4;                         // camera lists per prototype
const VSTRIDE = 12;                     // floats per vertex
const NVIEW = 8;
const IMP_FRAME = 256;                  // impostor frame px (atlas 4 x 2 frames)
const FLAG = { impostor: 1, deciduous: 2, noShadow: 4, rock: 8, conifer: 16, flower: 32 };

// ---------------------------------------------------------------- random
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
function perp(d) { const a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; return V.norm(V.cross(d, a)); }
function rotAxis(v, k, ang) {   // Rodrigues
  const c = Math.cos(ang), s = Math.sin(ang), kv = V.cross(k, v), kd = V.dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

// ------------------------------------------------------------- textures
// Periodic value noise on a P x P lattice (tileable textures).
function pnoise(seed, P) {
  const r = mulberry(seed), L = new Float32Array(P * P);
  for (let i = 0; i < L.length; i++) L[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = L[y0 * P + x0], b = L[y0 * P + x1], c = L[y1 * P + x0], d = L[y1 * P + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}
const toSRGB = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };

class Canvas {   // RGBA float canvas, linear colour
  constructor(S, bg = [0, 0, 0], a = 0) {
    this.S = S; this.c = new Float32Array(S * S * 4);
    for (let i = 0; i < S * S; i++) { this.c[i * 4] = bg[0]; this.c[i * 4 + 1] = bg[1]; this.c[i * 4 + 2] = bg[2]; this.c[i * 4 + 3] = a; }
  }
  put(x, y, col, a = 1) {
    const S = this.S; x |= 0; y |= 0; if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4, c = this.c;
    c[i] = c[i] * (1 - a) + col[0] * a; c[i + 1] = c[i + 1] * (1 - a) + col[1] * a; c[i + 2] = c[i + 2] * (1 - a) + col[2] * a; c[i + 3] = Math.max(c[i + 3], a);
  }
  // a leaf: base (x0,y0), direction ang, length len, width w, colour fn
  leaf(x0, y0, ang, len, w, col, opts = {}) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const pw = opts.profile || ((t) => Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.75) * (1 - 0.25 * t));
    const R = Math.ceil(len + w + 2);
    for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
      const u = (xx * ca + yy * sa) / len, v = (-xx * sa + yy * ca);
      if (u < 0 || u > 1) continue;
      const hw = pw(u) * w * 0.5;
      if (Math.abs(v) > hw + 0.7) continue;
      const edge = Math.min(1, hw + 0.7 - Math.abs(v));
      const vein = Math.abs(v) < 0.6 ? 0.78 : 1;
      const shade = (0.82 + 0.3 * (v / (hw + 1e-3)) * (opts.fold ?? 0.5) + 0.12 * u) * vein;
      this.put(x0 + xx, y0 + yy, [col[0] * shade, col[1] * shade, col[2] * shade], edge);
    }
  }
  line(x0, y0, x1, y1, w, col) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, ww = w * (1 - 0.5 * t);
      for (let dy = -Math.ceil(ww); dy <= Math.ceil(ww); dy++) for (let dx = -Math.ceil(ww); dx <= Math.ceil(ww); dx++) {
        if (dx * dx + dy * dy <= ww * ww + 0.3) this.put(x + dx, y + dy, col, 1);
      }
    }
  }
  // fill rgb under a = 0 from the mean of the covered texels (no dark mip fringe)
  bleed() {
    const c = this.c; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < c.length; i += 4) if (c[i + 3] > 0.5) { r += c[i]; g += c[i + 1]; b += c[i + 2]; n++; }
    if (!n) return this;
    r /= n; g /= n; b /= n;
    for (let i = 0; i < c.length; i += 4) { const a = c[i + 3]; if (a < 1) { c[i] = c[i] * a + r * (1 - a); c[i + 1] = c[i + 1] * a + g * (1 - a); c[i + 2] = c[i + 2] * a + b * (1 - a); } }
    return this;
  }
  // RGBA8 sRGB levels (box mips; alpha coverage is kept in the shader)
  mips() {
    const out = []; let S = this.S, src = this.c;
    for (;;) {
      const b = new Uint8Array(S * S * 4);
      for (let i = 0; i < S * S; i++) { b[i * 4] = toSRGB(src[i * 4]); b[i * 4 + 1] = toSRGB(src[i * 4 + 1]); b[i * 4 + 2] = toSRGB(src[i * 4 + 2]); b[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, src[i * 4 + 3]))); }
      out.push({ size: S, data: b });
      if (S === 1) break;
      const h = S >> 1, d = new Float32Array(h * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) for (let k = 0; k < 4; k++) {
        d[(y * h + x) * 4 + k] = 0.25 * (src[((2 * y) * S + 2 * x) * 4 + k] + src[((2 * y) * S + 2 * x + 1) * 4 + k] + src[((2 * y + 1) * S + 2 * x) * 4 + k] + src[((2 * y + 1) * S + 2 * x + 1) * 4 + k]);
      }
      src = d; S = h;
    }
    return out;
  }
}

// Bark: vertical fissures (stretched periodic noise), per type colour.
function barkTex(S, seed, base, dark, opts = {}) {
  const c = new Canvas(S, base, 1);
  const n1 = pnoise(seed, 16), n2 = pnoise(seed + 1, 64), n3 = pnoise(seed + 2, 8);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let f = n1(u * 16, v * 3) * 0.6 + n2(u * 64, v * 10) * 0.4;
    const ridge = 1 - Math.abs(f * 2 - 1);
    let t = Math.pow(ridge, opts.sharp ?? 2.2);
    let col = [dark[0] + (base[0] - dark[0]) * t, dark[1] + (base[1] - dark[1]) * t, dark[2] + (base[2] - dark[2]) * t];
    const m = n3(u * 8, v * 8);
    col = V.mul(col, 0.8 + 0.4 * m);
    if (opts.birch) {
      const lent = n2(u * 6, v * 64);
      const band = lent > 0.78 ? 0.25 : 1;
      const blot = n1(u * 4, v * 6) > 0.7 ? 0.2 : 1;
      col = V.mul([0.78, 0.76, 0.72], band * blot * (0.9 + 0.1 * m));
    }
    if (opts.rings) { const r = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * opts.rings + n1(u * 16, v * 2) * 2); col = V.mul(col, 0.75 + 0.35 * r); }
    if (opts.plates) { const p = n3(u * 8 + n2(u * 64, v * 64) * 0.3, v * 4); col = V.lerp(col, opts.plates, Math.max(0, p - 0.45) * 1.5); }
    if (opts.moss) { const mo = n1(u * 16, v * 2 + 3); col = V.lerp(col, [0.06, 0.09, 0.03], Math.max(0, mo - 0.6) * 1.6); }
    c.put(x, y, col, 1);
  }
  return c;
}

function rockTex(S, seed) {
  const c = new Canvas(S, [0.3, 0.3, 0.3], 1);
  const a = pnoise(seed, 8), b = pnoise(seed + 1, 32), d = pnoise(seed + 2, 64);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const f = a(u * 8, v * 8) * 0.55 + b(u * 32, v * 32) * 0.3 + d(u * 64, v * 64) * 0.15;
    const crack = 1 - 0.35 * Math.max(0, 1 - Math.abs(b(u * 32 + 5, v * 32) - 0.5) / 0.05) * a(u * 8 + 2, v * 8);
    let col = V.mul([0.21, 0.20, 0.185], (0.55 + 0.8 * f) * crack);
    const lich = a(u * 8 + 3, v * 8 + 1);
    if (lich > 0.68) col = V.lerp(col, [0.42, 0.40, 0.25], 0.5);
    if (d(u * 64, v * 64) > 0.82) col = V.mul(col, 1.2);
    c.put(x, y, col, 1);
  }
  return c;
}

// Leaf cluster card: leaves from a few twigs toward the card edges.
function leafCluster(S, seed, leafCol, opts = {}) {
  const r = mulberry(seed);
  const c = new Canvas(S, leafCol, 0);
  const n = opts.count ?? 60;
  const twigs = opts.twigs ?? 5;
  const tw = [];
  for (let t = 0; t < twigs; t++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
    const L = S * (0.3 + 0.18 * r());
    const x0 = S * 0.5 + (r() - 0.5) * S * 0.1, y0 = S * 0.92;
    tw.push([x0, y0, x0 + Math.cos(a) * L, y0 + Math.sin(a) * L]);
    c.line(x0, y0, x0 + Math.cos(a) * L, y0 + Math.sin(a) * L, S / 220, [0.10, 0.07, 0.04]);
  }
  for (let i = 0; i < n; i++) {
    const t = tw[i % twigs], k = 0.25 + 0.75 * r();
    const x = t[0] + (t[2] - t[0]) * k, y = t[1] + (t[3] - t[1]) * k;
    const base = Math.atan2(t[3] - t[1], t[2] - t[0]);
    const ang = base + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.9);
    const len = S * (opts.len ?? 0.11) * (0.7 + 0.5 * r());
    const hue = 0.85 + 0.3 * r();
    const col = [leafCol[0] * hue * (0.9 + 0.2 * r()), leafCol[1] * hue, leafCol[2] * hue * (0.9 + 0.2 * r())];
    c.leaf(x, y, ang, len, len * (opts.aspect ?? 0.45), col, opts);
  }
  return c.bleed();
}

function needleSpray(S, seed, col) {
  const r = mulberry(seed);
  const c = new Canvas(S, col, 0);
  // a main twig along the card (bottom -> top), side twigs, dense needles
  const twig = [0.10, 0.075, 0.05];
  const main = [[S * 0.5, S * 0.98], [S * 0.5, S * 0.04]];
  const pts = [];
  for (let k = 0; k <= 30; k++) { const t = k / 30; pts.push([S * 0.5 + Math.sin(t * 3) * S * 0.03, S * (0.98 - 0.94 * t), t]); }
  const sides = [];
  for (let k = 3; k < 30; k += 2) {
    const p = pts[k], dir = k % 4 === 1 ? -1 : 1, L = S * 0.36 * (1 - p[2] * 0.75) * (0.8 + 0.3 * r());
    const a = -Math.PI / 2 + dir * (0.9 + 0.3 * r());
    sides.push([p[0], p[1], p[0] + Math.cos(a) * L, p[1] + Math.sin(a) * L]);
  }
  const needle = (x, y, a, L, cc) => c.leaf(x, y, a, L, Math.max(1.3, S / 170), cc, { profile: (t) => 1 - t * 0.6, fold: 0 });
  for (const s of [...sides, [main[0][0], main[0][1], main[1][0], main[1][1]]]) {
    c.line(s[0], s[1], s[2], s[3], S / 260, twig);
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.ceil(L / (S / 90));
    const ba = Math.atan2(s[3] - s[1], s[2] - s[0]);
    for (let i = 0; i < n; i++) {
      const t = i / n, x = s[0] + (s[2] - s[0]) * t, y = s[1] + (s[3] - s[1]) * t;
      for (const sd of [-1, 1]) {
        const cc = V.mul(col, 0.75 + 0.5 * r());
        needle(x, y, ba + sd * (0.7 + 0.3 * r()), S * 0.05 * (0.8 + 0.4 * r()), cc);
      }
    }
  }
  return c.bleed();
}

function frondTex(S, seed, col, opts = {}) {   // a frond along v (bottom -> top), leaflets both sides
  const r = mulberry(seed);
  const c = new Canvas(S, col, 0);
  const rach = opts.rachis || [0.16, 0.18, 0.08];
  c.line(S * 0.5, S * 0.99, S * 0.5, S * 0.02, S / 200, rach);
  const n = opts.pairs ?? 26;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y = S * (0.98 - 0.95 * t);
    const env = opts.envelope ? opts.envelope(t) : Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - t * 0.3);
    const L = S * 0.48 * env;
    for (const sd of [-1, 1]) {
      const a = -Math.PI / 2 + sd * (opts.angle ?? 1.15);
      const cc = V.mul(col, 0.8 + 0.35 * r());
      c.leaf(S * 0.5, y, a, L, L * (opts.aspect ?? 0.22), cc, opts.profile ? { profile: opts.profile } : {});
    }
  }
  return c.bleed();
}

function willowTex(S, seed, col) {
  const r = mulberry(seed);
  const c = new Canvas(S, col, 0);
  for (let k = 0; k < 9; k++) {
    const x0 = S * (0.08 + 0.84 * (k + r() * 0.6) / 9), sway = (r() - 0.5) * S * 0.08;
    const y1 = S * (0.75 + 0.24 * r());
    c.line(x0, 0, x0 + sway, y1, S / 400, [0.18, 0.16, 0.07]);
    const n = 26;
    for (let i = 0; i < n; i++) {
      const t = (i + r()) / n, x = x0 + sway * t, y = y1 * t;
      const a = Math.PI / 2 + (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.3);
      c.leaf(x, y, a, S * 0.06, S * 0.012, V.mul(col, 0.8 + 0.4 * r()));
    }
  }
  return c.bleed();
}

function flowerTex(S, seed) {
  const r = mulberry(seed);
  const c = new Canvas(S, [0.1, 0.25, 0.05], 0);
  const stem = [0.10, 0.22, 0.05];
  for (let k = 0; k < 5; k++) {
    const x0 = S * (0.2 + 0.6 * r()), top = S * (0.08 + 0.35 * r()), x1 = x0 + (r() - 0.5) * S * 0.2;
    c.line(x0, S, x1, top, S / 220, stem);
    c.leaf(x0, S * 0.85, -Math.PI / 2 + (r() - 0.5) * 1.6, S * 0.2, S * 0.05, [0.08, 0.20, 0.04]);
    // head: petals round a centre (bright neutral: the shader tints it)
    const pr = S * (0.035 + 0.03 * r()), np = 6 + Math.floor(r() * 6);
    for (let p = 0; p < np; p++) {
      const a = p / np * Math.PI * 2 + r() * 0.2;
      c.leaf(x1, top, a, pr * 1.1, pr * 0.65, [0.92, 0.88, 0.86]);
    }
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy < 9) c.put(x1 + dx * pr / 9, top + dy * pr / 9, [0.55, 0.40, 0.05], 1);
  }
  return c.bleed();
}

function reedTex(S, seed) {
  const r = mulberry(seed);
  const c = new Canvas(S, [0.2, 0.25, 0.08], 0);
  for (let k = 0; k < 14; k++) {
    const x0 = S * (0.1 + 0.8 * r()), lean = (r() - 0.5) * S * 0.35, top = S * (0.02 + 0.3 * r());
    const col = r() < 0.3 ? [0.30, 0.27, 0.12] : [0.13, 0.20, 0.06];
    c.leaf(x0, S, Math.atan2(top - S, lean), Math.hypot(lean, S - top), S * 0.022, col, { profile: (t) => 1 - t * 0.9, fold: 0.3 });
  }
  for (let k = 0; k < 3; k++) {   // cattails
    const x0 = S * (0.3 + 0.4 * r()), top = S * (0.05 + 0.1 * r());
    c.line(x0, S, x0, top, S / 300, [0.16, 0.18, 0.08]);
    c.leaf(x0, top + S * 0.16, -Math.PI / 2, S * 0.12, S * 0.035, [0.22, 0.12, 0.05], { profile: () => 1, fold: 0.6 });
  }
  return c.bleed();
}

function cactusTex(S, seed) {
  const c = new Canvas(S, [0.1, 0.2, 0.08], 1);
  const n = pnoise(seed, 16);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const rib = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 8);
    let col = V.mul([0.12, 0.22, 0.09], 0.65 + 0.45 * rib + 0.2 * n(u * 16, v * 16));
    if (rib > 0.97 && ((y % Math.max(4, S >> 6)) < 2)) col = [0.55, 0.52, 0.40];
    c.put(x, y, col, 1);
  }
  return c;
}

function mushroomTex(S, seed) {     // u < 0.5 cap (red, white spots), u >= 0.5 stem
  const c = new Canvas(S, [0.8, 0.75, 0.65], 1);
  const r = mulberry(seed), n = pnoise(seed, 16);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    if (u < 0.5) c.put(x, y, V.mul([0.45, 0.08, 0.04], 0.8 + 0.3 * n(u * 16, v * 16)), 1);
    else c.put(x, y, V.mul([0.78, 0.74, 0.62], 0.85 + 0.2 * n(u * 16, v * 16)), 1);
  }
  for (let k = 0; k < 40; k++) { const x = r() * S * 0.48, y = r() * S, rr = S * (0.01 + 0.012 * r()); for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) if (dx * dx + dy * dy < rr * rr) c.put(x + dx, y + dy, [0.85, 0.82, 0.75], 1); }
  return c;
}

function woodEndTex(S, seed) {
  const c = new Canvas(S, [0.4, 0.3, 0.2], 1);
  const n = pnoise(seed, 16);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x / S - 0.5, dy = y / S - 0.5, rr = Math.hypot(dx, dy);
    const ring = 0.5 + 0.5 * Math.sin(rr * 90 + n(x / S * 16, y / S * 16) * 3);
    let col = V.mul([0.42, 0.31, 0.19], 0.75 + 0.3 * ring);
    if (rr > 0.45) col = [0.12, 0.09, 0.06];
    c.put(x, y, col, 1);
  }
  return c;
}

// The texture layers. Returns { names, levels[layer] = mips }. yieldFn is
// awaited between layers (createVegetation passes a 0 ms timeout).
export async function makeTextures(S = 512, yieldFn = null) {
  const L = {};
  const list = [];
  const jobs = [];
  const add = (name, make) => jobs.push([name, make]);
  add('barkOak', () => barkTex(S, 11, [0.20, 0.15, 0.11], [0.06, 0.045, 0.035], { moss: true }));
  add('barkBeech', () => barkTex(S, 12, [0.36, 0.35, 0.32], [0.22, 0.21, 0.19], { sharp: 0.6 }));
  add('barkBirch', () => barkTex(S, 13, [0.75, 0.73, 0.68], [0.1, 0.1, 0.1], { birch: true }));
  add('barkPine', () => barkTex(S, 14, [0.30, 0.15, 0.08], [0.08, 0.05, 0.035], { plates: [0.42, 0.22, 0.12] }));
  add('barkSpruce', () => barkTex(S, 15, [0.19, 0.15, 0.12], [0.07, 0.055, 0.045], { sharp: 1.4 }));
  add('barkPalm', () => barkTex(S, 16, [0.30, 0.25, 0.18], [0.12, 0.09, 0.06], { rings: 14, sharp: 1 }));
  add('barkDead', () => barkTex(S, 17, [0.42, 0.40, 0.37], [0.15, 0.14, 0.13], { sharp: 3 }));
  add('leafBroad', () => leafCluster(S, 21, [0.065, 0.13, 0.03], { count: 190, len: 0.065, twigs: 9 }));
  add('leafBeech', () => leafCluster(S, 22, [0.08, 0.15, 0.035], { count: 170, len: 0.06, aspect: 0.55, twigs: 9 }));
  add('leafSmall', () => leafCluster(S, 23, [0.09, 0.16, 0.04], { count: 240, len: 0.045, aspect: 0.6, twigs: 11 }));
  add('leafJungle', () => leafCluster(S, 24, [0.04, 0.13, 0.03], { count: 34, len: 0.2, aspect: 0.4 }));
  add('leafBush', () => leafCluster(S, 25, [0.05, 0.11, 0.03], { count: 200, len: 0.06, twigs: 10 }));
  add('leafDry', () => leafCluster(S, 26, [0.20, 0.19, 0.08], { count: 50, len: 0.05, aspect: 0.4, twigs: 9 }));
  add('needle', () => needleSpray(S, 31, [0.035, 0.085, 0.035]));
  add('needlePine', () => needleSpray(S, 32, [0.06, 0.11, 0.04]));
  add('palmFrond', () => frondTex(S, 41, [0.09, 0.17, 0.04], { pairs: 34, aspect: 0.12, angle: 1.3, envelope: (t) => Math.min(1, t * 6) * (1 - t * 0.6) }));
  add('fern', () => frondTex(S, 42, [0.06, 0.15, 0.035], { pairs: 22, aspect: 0.3, angle: 1.35 }));
  add('willow', () => willowTex(S, 43, [0.12, 0.20, 0.05]));
  add('flower', () => flowerTex(S, 51));
  add('reed', () => reedTex(S, 52));
  add('rock', () => rockTex(S, 61));
  add('cactus', () => cactusTex(S, 62));
  add('mushroom', () => mushroomTex(S, 63));
  add('woodEnd', () => woodEndTex(S, 64));
  // one layer at a time, with a yield between (no long main thread block)
  for (const [name, make] of jobs) { L[name] = list.length; list.push(make().mips()); if (yieldFn) await yieldFn(); }
  return { names: L, levels: list, size: S };
}

// ------------------------------------------------------------ geometry
// A part: { layer (texture name), kind: 'bark'|'leaf'|'rock', v: number[], i: number[] }
class Part {
  constructor(layer, kind) { this.layer = layer; this.kind = kind; this.v = []; this.i = []; }
  get n() { return this.v.length / VSTRIDE; }
  vert(p, nrm, uv, bend, flutter, ao) { this.v.push(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], uv[0], uv[1], bend, flutter, ao, this.kind === 'leaf' ? 1 : 0); return this.n - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
}
// a tube along pts with radii (bark), sides around, uv u round, v along
function tube(part, pts, radii, sides, H, opts = {}) {
  const base = part.n, n = pts.length;
  let vlen = 0;
  const rep = opts.uRepeat ?? Math.max(1, Math.round(radii[0] * 2 * Math.PI / 0.6));
  let prevN = null;
  for (let k = 0; k < n; k++) {
    const d = V.norm(V.sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
    let nx = prevN ? V.norm(V.sub(prevN, V.mul(d, V.dot(prevN, d)))) : perp(d);
    if (!isFinite(nx[0]) || V.len(nx) < 0.5) nx = perp(d);
    prevN = nx;
    const bx = V.cross(d, nx);
    if (k > 0) vlen += V.len(V.sub(pts[k], pts[k - 1]));
    for (let s = 0; s <= sides; s++) {
      const a = s / sides * Math.PI * 2;
      const nr = V.add(V.mul(nx, Math.cos(a)), V.mul(bx, Math.sin(a)));
      const p = V.add(pts[k], V.mul(nr, radii[k]));
      const y = Math.max(0, p[1]);
      const bend = Math.pow(Math.min(1, y / H), 2);
      part.vert(p, nr, [s / sides * rep, vlen / (radii[0] * 2 * Math.PI / rep) * 0.5], bend, opts.flutter ?? 0, opts.ao ? opts.ao(k / (n - 1), p) : 1);
    }
  }
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < sides; s++) {
    const a = base + k * (sides + 1) + s, b = a + sides + 1;
    part.tri(a, b, a + 1); part.tri(a + 1, b, b + 1);
  }
}
// a card (two triangles), centre c, right r and up u half vectors
function card(part, c, r, u, nrm, H, flutter, ao, uv = [0, 0, 1, 1]) {
  const b = part.n;
  const P = [V.sub(V.sub(c, r), u), V.sub(V.add(c, r), u), V.add(V.add(c, r), u), V.add(V.sub(c, r), u)];
  const UV = [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
  for (let k = 0; k < 4; k++) {
    const y = Math.max(0, P[k][1]);
    part.vert(P[k], nrm, UV[k], Math.pow(Math.min(1, y / H), 2), flutter * (k >= 2 ? 1 : 0.5), ao);
  }
  part.tri(b, b + 1, b + 2); part.tri(b, b + 2, b + 3);
}
// a strip along a curve (fronds, willow strands): width w(t), up side
function strip(part, pts, widths, side, H, flutter, ao) {
  const b = part.n, n = pts.length;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const d = V.norm(V.sub(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]));
    const nrm = V.norm(V.cross(side, d));
    const nn = V.norm(V.add(nrm, [0, 0.6, 0]));
    for (const s of [-1, 1]) {
      const p = V.add(pts[k], V.mul(side, s * widths[k] * 0.5));
      part.vert(p, nn, [s < 0 ? 0 : 1, 1 - t], Math.pow(Math.min(1, Math.max(0, p[1]) / H), 2), flutter * (0.3 + 0.7 * t), ao);
    }
  }
  for (let k = 0; k < n - 1; k++) { const a = b + k * 2; part.tri(a, a + 1, a + 3); part.tri(a, a + 3, a + 2); }
}

// Broadleaf skeleton: recursive forks (ideas of shan-shui tree.js), then
// tubes and leaf cards. Returns lods: [[parts], [parts], [parts]].
function genBranchTree(seed, P) {
  const r = mulberry(seed);
  const H = P.H;
  const branches = [];     // { pts, radii, level }
  const leaves = [];       // { p, d, s }
  const crownC = [0, H * (P.crownY ?? 0.65), 0];
  function grow(p0, dir, len, rad, level) {
    const nseg = Math.max(2, Math.round(len / (level === 0 ? 1.0 : 0.6)));
    const pts = [p0], radii = [rad];
    let d = dir, p = p0;
    for (let k = 1; k <= nseg; k++) {
      const t = k / nseg;
      d = V.norm(V.add(d, [(r() - 0.5) * P.wiggle, (P.up ?? 0.05) - (P.droop ?? 0) * t * level * 0.5, (r() - 0.5) * P.wiggle]));
      p = V.add(p, V.mul(d, len / nseg));
      pts.push(p); radii.push(rad * (1 - t * (level === 0 ? 0.55 : 0.75)) + 0.004);
    }
    branches.push({ pts, radii, level });
    if (level >= P.levels) {
      for (let k = Math.floor(nseg * 0.35); k <= nseg; k++) {
        const nl = P.leafPer ?? 2;
        for (let q = 0; q < nl; q++) leaves.push({ p: V.add(pts[k], [(r() - 0.5) * 0.4, (r() - 0.5) * 0.3, (r() - 0.5) * 0.4]), d, s: P.leafSize * (0.75 + 0.5 * r()) });
      }
      return;
    }
    const nch = P.children[level];
    const start = level === 0 ? (P.trunkH ?? 0.4) * H / len : 0.25;
    for (let c = 0; c < nch; c++) {
      const t = Math.min(0.98, start + (1 - start) * (c + r() * 0.8) / nch);
      const kf = t * nseg, k0 = Math.min(nseg - 1, Math.floor(kf));
      const pp = V.lerp(pts[k0], pts[k0 + 1], kf - k0);
      const rr = radii[k0] * (P.childR ?? 0.62);
      const az = c * 2.39996 + r() * 0.8;
      const ang = P.angle[0] + (P.angle[1] - P.angle[0]) * r();
      const ax = perp(d);
      let nd = rotAxis(d, ax, ang);
      nd = rotAxis(nd, d, az);
      const nl = len * P.lenF[level] * (1 - 0.45 * t) * (0.8 + 0.4 * r());
      grow(pp, nd, nl, rr, level + 1);
    }
    // the leader keeps on (a crown top) for excurrent forms
    if (level === 0 && P.leaderLeaves) for (let k = Math.floor(nseg * 0.7); k <= nseg; k++) leaves.push({ p: pts[k], d, s: P.leafSize });
  }
  const trunkLen = H * (P.trunkLen ?? 0.75);
  grow([0, -0.2, 0], V.norm([(r() - 0.5) * 0.08, 1, (r() - 0.5) * 0.08]), trunkLen, P.trunkR, 0);
  // the crown envelope for leaf normals and AO
  let cr = 0.1;
  for (const l of leaves) cr = Math.max(cr, V.len(V.sub(l.p, crownC)));
  const lods = [];
  const sidesBy = [[9, 6, 4, 3, 3], [6, 4, 3, 3, 3], [5, 3, 3, 3, 3]];
  for (let lod = 0; lod < 3; lod++) {
    const wood = new Part(P.bark, 'bark'), leaf = new Part(P.leaf, 'leaf');
    const maxLevel = lod === 0 ? 99 : lod === 1 ? P.levels - 1 : Math.max(1, P.levels - 2);
    for (const b of branches) {
      if (b.level > maxLevel) continue;
      const sides = sidesBy[lod][b.level];
      let pts = b.pts, radii = b.radii;
      if (lod > 0 && pts.length > 3) { pts = pts.filter((_, i) => i % 2 === 0 || i === b.pts.length - 1); radii = radii.filter((_, i) => i % 2 === 0 || i === b.radii.length - 1); }
      tube(wood, pts, radii, sides, H, { flutter: b.level >= 2 ? 0.25 : 0, ao: (t, p) => 0.55 + 0.45 * Math.min(1, p[1] / H + 0.3) });
    }
    const keep = lod === 0 ? 1 : lod === 1 ? 2 : 5;
    const grow2 = Math.sqrt(keep) * (lod === 2 ? 1.1 : 1);
    leaves.forEach((l, idx) => {
      if (idx % keep) return;
      const out = V.norm(V.sub(l.p, crownC));
      // card facing: random, biased outward and up
      const fn = V.norm(V.add(V.mul(out, 0.8), [(r() - 0.5) * 1.2, (r() - 0.2) * 0.8 + (P.flatLeaves ?? 0), (r() - 0.5) * 1.2]));
      const right = perp(fn), up = V.cross(fn, right);
      const s = l.s * grow2 * 0.5;
      const nrm = V.norm(V.add(V.mul(out, 0.65), V.mul(fn, 0.35)));
      const depth = V.len(V.sub(l.p, crownC)) / cr;
      const ao = Math.min(1, 0.35 + 0.65 * depth) * (0.75 + 0.25 * Math.min(1, l.p[1] / H));
      card(leaf, l.p, V.mul(right, s), V.mul(up, s), nrm, H, 1, ao, r() < 0.5 ? [0, 0, 1, 1] : [1, 0, 0, 1]);
    });
    const parts = [wood];
    if (leaf.n) parts.push(leaf);
    lods.push(parts);
  }
  return lods;
}

// Conifer: a tapered trunk and whorls of drooping needle cards.
function genConifer(seed, P) {
  const r = mulberry(seed);
  const H = P.H;
  const lods = [];
  const whorls = [];
  const y0 = H * P.crownBase;
  for (let y = y0; y < H * 0.97; y += P.whorlStep * (0.8 + 0.4 * r())) {
    const t = (y - y0) / (H - y0);
    const L = P.crownR * Math.pow(1 - t, P.shape ?? 0.9) * (0.75 + 0.4 * r()) + 0.25;
    const n = P.perWhorl + Math.floor(r() * 3);
    const b = [];
    for (let k = 0; k < n; k++) {
      const az = k / n * Math.PI * 2 + r() * 0.6 + y * 1.7;
      const droop = P.droop * (0.6 + 0.6 * r()) * (1 - t * 0.5) - (P.upturn ?? 0);
      b.push({ az, droop, L: L * (0.8 + 0.35 * r()), tilt: (r() - 0.5) * 0.6 });
    }
    whorls.push({ y, t, b });
  }
  for (let lod = 0; lod < 3; lod++) {
    const wood = new Part(P.bark, 'bark'), nd = new Part(P.leaf, 'leaf');
    const sides = [8, 5, 4][lod];
    const tp = [], tr = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; tp.push([Math.sin(t * 2.1 + seed) * 0.08 * t, -0.25 + t * (H + 0.25), 0]); tr.push(P.trunkR * (1 - t * 0.92) + 0.01); }
    tube(wood, tp, tr, sides, H, { ao: (t) => 0.5 + 0.5 * t });
    const keepW = [1, 2, 3][lod];
    whorls.forEach((w, wi) => {
      if (wi % keepW && wi !== whorls.length - 1) return;
      const keepB = lod === 2 ? 2 : 1;
      w.b.forEach((b, bi) => {
        if (bi % keepB) return;
        const dir = V.norm([Math.cos(b.az), -b.droop, Math.sin(b.az)]);
        const root = [0, w.y, 0];
        const L = b.L * (lod ? 1.08 : 1);
        if (lod === 0 && b.L > 1.2) tube(wood, [root, V.add(root, V.mul(dir, L * 0.85))], [P.trunkR * 0.18 * (1 - w.t) + 0.012, 0.008], 3, H, { flutter: 0.2, ao: () => 0.55 });
        // the spray: a card from the trunk out along the branch, tilted
        const side = V.norm(V.cross(dir, [0, 1, 0]));
        const sideT = V.norm(rotAxis(side, dir, b.tilt));
        const up = V.norm(V.cross(sideT, dir));
        const c = V.add(root, V.mul(dir, L * 0.5));
        const wscale = (P.sprayW ?? 0.55) * L * (lod === 2 ? 1.5 : lod === 1 ? 1.2 : 1);
        const ao = (0.4 + 0.6 * Math.min(1, w.t + 0.2)) * (0.8 + 0.2 * r());
        const nrm = V.norm(V.add(V.mul(up, 0.4), V.mul(dir, 0.6)));
        card(nd, c, V.mul(sideT, wscale * 0.5), V.mul(dir, L * 0.55), V.norm(V.add(nrm, [0, 0.5, 0])), H, 0.8, ao);
        if (lod < 2 && P.cross) card(nd, c, V.mul(up, wscale * 0.35), V.mul(dir, L * 0.5), V.norm(V.add(nrm, [0, 0.5, 0])), H, 0.8, ao * 0.9);
      });
    });
    // the leader tip
    card(nd, [0, H - P.whorlStep * 0.8, 0], [P.crownR * 0.12 + 0.15, 0, 0], [0, P.whorlStep * 0.9, 0], [0, 0.5, 1], H, 0.6, 1);
    card(nd, [0, H - P.whorlStep * 0.8, 0], [0, 0, P.crownR * 0.12 + 0.15], [0, P.whorlStep * 0.9, 0], [1, 0.5, 0], H, 0.6, 1);
    lods.push([wood, nd]);
  }
  return lods;
}

function genPalm(seed, P) {
  const r = mulberry(seed);
  const H = P.H, lods = [];
  const lean = 0.25 + r() * 0.2, az = r() * Math.PI * 2;
  const trunk = [], radii = [];
  for (let k = 0; k <= 10; k++) { const t = k / 10; const off = Math.pow(t, 2) * H * lean; trunk.push([Math.cos(az) * off, -0.3 + t * (H + 0.3), Math.sin(az) * off]); radii.push(0.22 * (1 - t * 0.35) + (k === 0 ? 0.1 : 0)); }
  const top = trunk[10];
  for (let lod = 0; lod < 3; lod++) {
    const wood = new Part('barkPalm', 'bark'), fr = new Part('palmFrond', 'leaf');
    tube(wood, trunk, radii, [8, 5, 4][lod], H, { uRepeat: 1, ao: (t) => 0.6 + 0.4 * t });
    const n = [14, 10, 7][lod];
    for (let f = 0; f < n; f++) {
      const a = f / n * Math.PI * 2 + r() * 0.3, el = 0.5 - r() * 0.7;
      const L = H * (0.42 + 0.12 * r()) * (lod === 2 ? 1.1 : 1);
      const pts = [], w = [];
      const segs = [10, 6, 4][lod];
      const dir0 = V.norm([Math.cos(a), el, Math.sin(a)]);
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const d = V.norm(V.add(dir0, [0, -t * 1.4, 0]));
        pts.push(k ? V.add(pts[k - 1], V.mul(d, L / segs)) : top);
        w.push(L * 0.32 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * (lod === 2 ? 1.25 : 1));
      }
      const side = V.norm(V.cross(dir0, [0, 1, 0]));
      strip(fr, pts, w, side, H, 1, 0.85);
    }
    lods.push([wood, fr]);
  }
  return lods;
}

function genCactus(seed, P) {
  const r = mulberry(seed), H = P.H, lods = [];
  const R0 = H * 0.06;
  const arms = [];
  const na = 1 + Math.floor(r() * 3);
  for (let k = 0; k < na; k++) arms.push({ y: H * (0.35 + 0.3 * r()), az: r() * Math.PI * 2, out: 0.4 + 0.3 * r(), up: H * (0.25 + 0.2 * r()) });
  const ribbed = (part, pts, radii, sides) => {
    const base = part.n, n = pts.length;
    for (let k = 0; k < n; k++) {
      for (let s = 0; s <= sides; s++) {
        const a = s / sides * Math.PI * 2;
        const rib = 1 + 0.12 * Math.cos(a * 8);
        const nr = [Math.cos(a), 0, Math.sin(a)];
        const cap = k === n - 1 ? 0.35 : k === n - 2 ? 0.8 : 1;
        const p = V.add(pts[k], V.mul(nr, radii[k] * rib * cap));
        part.vert(p, V.norm(V.add(nr, [0, k >= n - 2 ? 0.8 : 0, 0])), [s / sides, pts[k][1] / H * 4], Math.pow(Math.min(1, Math.max(0, p[1]) / H), 2), 0, 0.7 + 0.3 * Math.min(1, p[1] / H));
      }
    }
    for (let k = 0; k < n - 1; k++) for (let s = 0; s < sides; s++) { const a = base + k * (sides + 1) + s, b = a + sides + 1; part.tri(a, b, a + 1); part.tri(a + 1, b, b + 1); }
  };
  for (let lod = 0; lod < 3; lod++) {
    const p = new Part('cactus', 'bark');
    const sides = [32, 16, 8][lod];
    const pts = [], rad = [];
    for (let k = 0; k <= 8; k++) { pts.push([0, -0.2 + k / 8 * (H + 0.2), 0]); rad.push(R0); }
    pts.push([0, H + R0 * 0.4, 0]); rad.push(R0);
    ribbed(p, pts, rad, sides);
    for (const a of arms) {
      const d = [Math.cos(a.az), 0, Math.sin(a.az)];
      const ap = [], ar = [];
      const steps = [8, 5, 3][lod];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const out = Math.min(1, t * 2) * a.out, up = Math.max(0, t * 2 - 0.6) / 1.4 * a.up;
        ap.push([d[0] * (out + R0 * 0.5), a.y + up + Math.sin(Math.min(1, t * 2) * Math.PI / 2) * 0.15, d[2] * (out + R0 * 0.5)]);
        ar.push(R0 * 0.7);
      }
      ap.push(V.add(ap[ap.length - 1], [0, R0 * 0.3, 0])); ar.push(R0 * 0.7);
      ribbed(p, ap, ar, Math.max(8, sides >> 1));
    }
    lods.push([p]);
  }
  return lods;
}

function genRock(seed, P) {
  const r = mulberry(seed), lods = [];
  const n3 = (() => { const L = new Float32Array(4096); for (let i = 0; i < 4096; i++) L[i] = r(); return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
    const h = (a, b, c) => L[((a & 15) << 8) | ((b & 15) << 4) | (c & 15)];
    const s = (t) => t * t * (3 - 2 * t), ux = s(fx), uy = s(fy), uz = s(fz);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), ux), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), ux), uy), l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), ux), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), ux), uy), uz);
  }; })();
  const H = P.H, sx = P.sx ?? 1.3, sz = P.sz ?? 1.0;
  for (let lod = 0; lod < 3; lod++) {
    const sub = [4, 3, 1][lod];
    // icosphere
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(V.norm);
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < sub; s++) {
      const mid = new Map(), nf = [];
      const m = (a, b) => { const k = a < b ? a + ':' + b : b + ':' + a; if (!mid.has(k)) { mid.set(k, verts.length); verts.push(V.norm(V.add(verts[a], verts[b]))); } return mid.get(k); };
      for (const [a, b, c] of faces) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      faces = nf;
    }
    const part = new Part('rock', 'rock');
    const pos = verts.map((v) => {
      let d = 0, a = 1, f = 1.3;
      for (let o = 0; o < 4; o++) { const q = n3(v[0] * f + 3, v[1] * f + 7, v[2] * f + 11); d += (P.ridged ? (1 - Math.abs(q * 2 - 1)) : q) * a; a *= 0.5; f *= 2.1; }
      const rr = 0.75 + 0.45 * d;
      let p = [v[0] * rr * sx * 0.5, v[1] * rr * 0.5, v[2] * rr * sz * 0.5];
      if (P.flat) p[1] = Math.max(p[1], -0.15);   // a flat base
      // terrace facets for angular boulders
      if (P.facet) p = V.mul(p, 1 + 0.08 * Math.round(Math.sin(v[0] * 5 + v[2] * 3) * 2) / 2);
      return { p, d };
    });
    let minY = Infinity, maxY = -Infinity;
    for (const q of pos) { minY = Math.min(minY, q.p[1]); maxY = Math.max(maxY, q.p[1]); }
    const ys = H / (maxY - minY);
    const nrm = verts.map(() => [0, 0, 0]);
    const P2 = pos.map((q) => [q.p[0] * ys, (q.p[1] - minY) * ys, q.p[2] * ys]);
    for (const [a, b, c] of faces) { const fn = V.cross(V.sub(P2[b], P2[a]), V.sub(P2[c], P2[a])); for (const k of [a, b, c]) nrm[k] = V.add(nrm[k], fn); }
    P2.forEach((p, k) => part.vert(p, V.norm(nrm[k]), [p[0], p[2]], 0, 0, 0.45 + 0.55 * Math.min(1, pos[k].d * 1.2)));
    for (const [a, b, c] of faces) part.tri(a, c, b);
    lods.push([part]);
  }
  return lods;
}

function genFern(seed, P) {
  const r = mulberry(seed), H = P.H, lods = [];
  for (let lod = 0; lod < 3; lod++) {
    const p = new Part('fern', 'leaf');
    const n = [11, 7, 4][lod];
    for (let f = 0; f < n; f++) {
      const a = f / n * Math.PI * 2 + r() * 0.4;
      const L = H * (1.0 + 0.4 * r());
      const segs = [6, 4, 2][lod];
      const pts = [], w = [];
      const el = 0.9 + r() * 0.4;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const ang = el - t * 1.6;
        pts.push([Math.cos(a) * L * 0.75 * Math.sin(t * 1.4), Math.sin(ang) * 0 + H * (Math.sin(t * Math.PI * 0.8) * 0.9), Math.sin(a) * L * 0.75 * Math.sin(t * 1.4)]);
        w.push(L * 0.42 * (lod === 2 ? 1.3 : 1));
      }
      strip(p, pts, w, V.norm([-Math.sin(a), 0, Math.cos(a)]), H, 0.9, 0.75);
    }
    lods.push([p]);
  }
  return lods;
}

function genCards(seed, P) {   // flowers, reeds, grass-like clumps: crossed cards
  const r = mulberry(seed), H = P.H, lods = [];
  const clumps = [];
  for (let k = 0; k < P.clumps; k++) clumps.push({ x: (r() - 0.5) * P.spread, z: (r() - 0.5) * P.spread, h: H * (0.75 + 0.35 * r()), a: r() * Math.PI, w: P.width * (0.8 + 0.4 * r()) });
  for (let lod = 0; lod < 3; lod++) {
    const p = new Part(P.layer, 'leaf');
    clumps.forEach((c, i) => {
      if (lod === 2 && i % 2) return;
      const crossN = lod === 0 ? 2 : 1;
      for (let q = 0; q < crossN; q++) {
        const a = c.a + q * Math.PI / 2;
        const rv = [Math.cos(a) * c.w * 0.5, 0, Math.sin(a) * c.w * 0.5];
        const nrm = V.norm([Math.sin(a), 0.6, -Math.cos(a)]);
        card(p, [c.x, c.h * 0.5, c.z], rv, [0, c.h * 0.5, 0], nrm, H, 1, 0.9);
      }
    });
    lods.push([p]);
  }
  return lods;
}

function genMushroom(seed, P) {
  const r = mulberry(seed), H = P.H, lods = [];
  const caps = [];
  const n = 1 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) caps.push({ x: (r() - 0.5) * H * 1.2 * (k ? 1 : 0), z: (r() - 0.5) * H * 1.2 * (k ? 1 : 0), h: H * (0.5 + 0.5 * r()) * (k ? 0.75 : 1), cr: H * (0.35 + 0.2 * r()) });
  for (let lod = 0; lod < 3; lod++) {
    const p = new Part('mushroom', 'bark');
    const sides = [14, 8, 6][lod];
    for (const c of caps) {
      // stem (u 0.5..1) and cap (u 0..0.5) as two lathes
      const lathe = (prof, u0, u1) => {
        const base = p.n;
        for (let k = 0; k < prof.length; k++) for (let s = 0; s <= sides; s++) {
          const a = s / sides * Math.PI * 2, [rr, y, ny] = prof[k];
          p.vert([c.x + Math.cos(a) * rr, y, c.z + Math.sin(a) * rr], V.norm([Math.cos(a) * (1 - Math.abs(ny)), ny, Math.sin(a) * (1 - Math.abs(ny))]), [u0 + (u1 - u0) * s / sides, k / (prof.length - 1)], 0, 0, 0.7 + 0.3 * k / prof.length);
        }
        for (let k = 0; k < prof.length - 1; k++) for (let s = 0; s < sides; s++) { const a = base + k * (sides + 1) + s, b = a + sides + 1; p.tri(a, a + 1, b); p.tri(a + 1, b + 1, b); }
      };
      const sr = c.cr * 0.22;
      lathe([[sr * 1.2, -0.02, 0], [sr, c.h * 0.5, 0], [sr * 0.85, c.h, 0]], 0.5, 1);
      const cap = [];
      for (let k = 0; k <= 5; k++) { const t = k / 5, a = t * Math.PI / 2; cap.push([Math.cos(a) * c.cr * (k === 0 ? 1.02 : 1), c.h - c.cr * 0.1 + Math.sin(a) * c.cr * 0.65, Math.sin(a) * 0.9 + 0.1]); }
      cap.push([0.001, c.h + c.cr * 0.56, 1]);
      lathe([[sr, c.h - c.cr * 0.12, -1], [c.cr * 0.98, c.h - c.cr * 0.1, -0.6]], 0.5, 0.75);
      lathe(cap, 0, 0.5);
    }
    lods.push([p]);
  }
  return lods;
}

function genLog(seed, P) {
  const r = mulberry(seed), lods = [];
  const L = P.L, R = P.H * 0.5;
  for (let lod = 0; lod < 3; lod++) {
    const bark = new Part(P.bark, 'bark'), end = new Part('woodEnd', 'bark');
    const pts = [], rad = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push([-L / 2 + t * L, R * 0.9 + Math.sin(t * 3 + seed) * 0.05, Math.sin(t * 2.3) * 0.12]); rad.push(R * (1 - t * 0.25)); }
    tube(bark, pts, rad, [10, 6, 4][lod], 10, { ao: () => 0.75 });
    for (const [k, s] of [[0, -1], [6, 1]]) {   // end caps
      const c = pts[k], b = end.n, sides = [10, 6, 4][lod];
      end.vert(c, [s, 0, 0], [0.5, 0.5], 0, 0, 0.9);
      for (let q = 0; q <= sides; q++) { const a = q / sides * Math.PI * 2; end.vert([c[0], c[1] + Math.cos(a) * rad[k], c[2] + Math.sin(a) * rad[k]], [s, 0, 0], [0.5 + Math.cos(a) * 0.45, 0.5 + Math.sin(a) * 0.45], 0, 0, 0.9); }
      for (let q = 0; q < sides; q++) s > 0 ? end.tri(b, b + 1 + q, b + 2 + q) : end.tri(b, b + 2 + q, b + 1 + q);
    }
    lods.push([bark, end]);
  }
  return lods;
}

function genStump(seed, P) {
  const r = mulberry(seed), lods = [], H = P.H, R = 0.32;
  for (let lod = 0; lod < 3; lod++) {
    const bark = new Part(P.bark, 'bark'), end = new Part('woodEnd', 'bark');
    const sides = [12, 7, 5][lod];
    tube(bark, [[0, -0.2, 0], [0, H * 0.5, 0], [0, H, 0]], [R * 1.25, R * 1.02, R], sides, 10, { ao: (t) => 0.6 + 0.4 * t });
    if (lod < 2) for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + r(); const d = [Math.cos(a), 0, Math.sin(a)]; tube(bark, [[d[0] * R * 0.6, H * 0.35, d[2] * R * 0.6], [d[0] * R * 1.4, 0.02, d[2] * R * 1.4], [d[0] * R * 2.1, -0.12, d[2] * R * 2.1]], [R * 0.32, R * 0.2, R * 0.08], 4, 10, { ao: () => 0.6 }); }
    const b = end.n;
    end.vert([0, H, 0], [0, 1, 0], [0.5, 0.5], 0, 0, 1);
    for (let q = 0; q <= sides; q++) { const a = q / sides * Math.PI * 2; end.vert([Math.cos(a) * R, H, Math.sin(a) * R], [0, 1, 0], [0.5 + Math.cos(a) * 0.45, 0.5 + Math.sin(a) * 0.45], 0, 0, 1); }
    for (let q = 0; q < sides; q++) end.tri(b, b + 2 + q, b + 1 + q);
    lods.push([bark, end]);
  }
  return lods;
}

// generator, params and GPU flags per species key (heights from scatter.js)
const GEN = {
  oak: (s, h) => genBranchTree(s, { H: h, trunkR: 0.42, trunkLen: 0.62, trunkH: 0.32, levels: 3, children: [7, 4, 3], lenF: [0.55, 0.6, 0.55], angle: [0.7, 1.15], wiggle: 0.35, up: 0.06, droop: 0.12, leafSize: 1.7, leafPer: 3, bark: 'barkOak', leaf: 'leafBroad', crownY: 0.68 }),
  beech: (s, h) => genBranchTree(s, { H: h, trunkR: 0.38, trunkLen: 0.8, trunkH: 0.35, levels: 3, children: [7, 4, 3], lenF: [0.42, 0.55, 0.5], angle: [0.5, 0.9], wiggle: 0.2, up: 0.1, droop: 0.06, leafSize: 1.8, leafPer: 2, bark: 'barkBeech', leaf: 'leafBeech', crownY: 0.68, leaderLeaves: true }),
  birch: (s, h) => genBranchTree(s, { H: h, trunkR: 0.17, trunkLen: 0.92, trunkH: 0.3, levels: 3, children: [9, 3, 2], lenF: [0.3, 0.6, 0.5], angle: [0.45, 0.75], wiggle: 0.25, up: 0.02, droop: 0.35, leafSize: 1.1, leafPer: 2, bark: 'barkBirch', leaf: 'leafSmall', crownY: 0.65, leaderLeaves: true }),
  jungle: (s, h) => genBranchTree(s, { H: h, trunkR: 0.55, trunkLen: 0.78, trunkH: 0.62, levels: 3, children: [6, 4, 3], lenF: [0.42, 0.5, 0.5], angle: [0.9, 1.3], wiggle: 0.25, up: 0.08, droop: 0.05, leafSize: 2.6, leafPer: 2, bark: 'barkBeech', leaf: 'leafJungle', crownY: 0.82, flatLeaves: 0.5 }),
  acacia: (s, h) => genBranchTree(s, { H: h, trunkR: 0.26, trunkLen: 0.5, trunkH: 0.35, levels: 2, children: [4, 5], lenF: [0.75, 0.55], angle: [0.4, 0.75], wiggle: 0.3, up: 0.0, droop: 0.0, leafSize: 2.2, leafPer: 3, bark: 'barkOak', leaf: 'leafSmall', crownY: 0.85, flatLeaves: 1.6 }),
  willow: (s, h) => {
    const lods = genBranchTree(s, { H: h, trunkR: 0.45, trunkLen: 0.45, trunkH: 0.32, levels: 2, children: [6, 4], lenF: [0.85, 0.5], angle: [0.6, 0.9], wiggle: 0.3, up: 0.12, droop: 0.0, leafSize: 1.4, leafPer: 1, bark: 'barkOak', leaf: 'leafSmall', crownY: 0.7 });
    // hanging strands from the crown
    const r = mulberry(s + 9);
    lods.forEach((parts, lod) => {
      const st = new Part('willow', 'leaf');
      const n = [70, 40, 22][lod];
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2, rr = h * (0.15 + 0.32 * Math.sqrt(r())), top = h * (0.62 + 0.3 * r());
        const len = h * (0.35 + 0.25 * r()) * (lod === 2 ? 1.1 : 1);
        const c = [Math.cos(a) * rr, top - len * 0.5, Math.sin(a) * rr];
        const side = [Math.sin(a) * len * 0.22 * (lod ? 1.3 : 1), 0, -Math.cos(a) * len * 0.22 * (lod ? 1.3 : 1)];
        card(st, c, side, [0, len * 0.5, 0], V.norm([Math.cos(a), 0.4, Math.sin(a)]), h, 1, 0.55 + 0.45 * (rr / (h * 0.47)), [0, 1, 1, 0]);
      }
      parts.push(st);
    });
    return lods;
  },
  deadtree: (s, h) => genBranchTree(s, { H: h, trunkR: 0.3, trunkLen: 0.85, trunkH: 0.3, levels: 2, children: [5, 3], lenF: [0.5, 0.45], angle: [0.5, 1.0], wiggle: 0.5, up: 0.05, droop: 0.1, leafSize: 0, leafPer: 0, bark: 'barkDead', leaf: 'leafDry', crownY: 0.6 }),
  spruce: (s, h) => genConifer(s, { H: h, trunkR: 0.32, crownBase: 0.07, crownR: h * 0.21, whorlStep: 0.55, perWhorl: 6, droop: 0.35, shape: 1.0, bark: 'barkSpruce', leaf: 'needle', cross: true }),
  pine: (s, h) => genConifer(s, { H: h, trunkR: 0.3, crownBase: 0.52, crownR: h * 0.22, whorlStep: 0.9, perWhorl: 5, droop: 0.05, upturn: 0.25, shape: 0.55, sprayW: 0.75, bark: 'barkPine', leaf: 'needlePine', cross: true }),
  'conifer-young': (s, h) => genConifer(s, { H: h, trunkR: 0.06, crownBase: 0.03, crownR: h * 0.3, whorlStep: 0.32, perWhorl: 5, droop: 0.25, shape: 1, bark: 'barkSpruce', leaf: 'needle', cross: true }),
  palm: (s, h) => genPalm(s, { H: h }),
  bush: (s, h) => genBranchTree(s, { H: h, trunkR: 0.05, trunkLen: 0.45, trunkH: 0.0, levels: 2, children: [6, 4], lenF: [1.3, 0.6], angle: [0.6, 1.1], wiggle: 0.4, up: 0.08, droop: 0.1, leafSize: 0.75, leafPer: 3, bark: 'barkOak', leaf: 'leafBush', crownY: 0.55 }),
  dryshrub: (s, h) => genBranchTree(s, { H: h, trunkR: 0.03, trunkLen: 0.3, trunkH: 0.0, levels: 2, children: [7, 4], lenF: [1.8, 0.6], angle: [0.5, 1.2], wiggle: 0.6, up: 0.05, droop: 0.05, leafSize: 0.5, leafPer: 1, bark: 'barkDead', leaf: 'leafDry', crownY: 0.5 }),
  cactus: (s, h) => genCactus(s, { H: h }),
  fern: (s, h) => genFern(s, { H: h }),
  flower: (s, h) => genCards(s, { H: h, clumps: 5, spread: 0.45, width: 0.4, layer: 'flower' }),
  mushroom: (s, h) => genMushroom(s, { H: h }),
  pebble: (s, h) => genRock(s, { H: h, sx: 1.4, sz: 1.1, flat: true }),
  reed: (s, h) => genCards(s, { H: h, clumps: 6, spread: 0.6, width: 0.6, layer: 'reed' }),
  rock: (s, h) => genRock(s, { H: h, sx: 1.6, sz: 1.2, flat: true }),
  boulder: (s, h) => genRock(s, { H: h, sx: 1.25, sz: 1.05, ridged: true, facet: true }),
  log: (s, h) => genLog(s, { H: h, L: 4.5, bark: 'barkDead' }),
  stump: (s, h) => genStump(s, { H: h, bark: 'barkOak' }),
};
// GPU per species: flags, bend (m tip offset per m/s and m height), flutter, sink, lean rad
const SPEC_GPU = {
  oak: { f: FLAG.impostor | FLAG.deciduous, bend: 0.5, flutter: 0.5, lean: 0.03 },
  beech: { f: FLAG.impostor | FLAG.deciduous, bend: 0.5, flutter: 0.5, lean: 0.02 },
  birch: { f: FLAG.impostor | FLAG.deciduous, bend: 0.8, flutter: 0.8, lean: 0.05 },
  spruce: { f: FLAG.impostor | FLAG.conifer, bend: 0.4, flutter: 0.2, lean: 0.02 },
  pine: { f: FLAG.impostor | FLAG.conifer, bend: 0.45, flutter: 0.25, lean: 0.06 },
  jungle: { f: FLAG.impostor, bend: 0.35, flutter: 0.4, lean: 0.03 },
  palm: { f: FLAG.impostor, bend: 0.7, flutter: 0.7, lean: 0.0 },
  acacia: { f: FLAG.impostor, bend: 0.4, flutter: 0.4, lean: 0.05 },
  willow: { f: FLAG.impostor | FLAG.deciduous, bend: 0.7, flutter: 1.0, lean: 0.04 },
  deadtree: { f: FLAG.impostor, bend: 0.25, flutter: 0.1, lean: 0.08 },
  bush: { f: FLAG.deciduous, bend: 0.8, flutter: 0.6, lean: 0.1 },
  'conifer-young': { f: FLAG.conifer, bend: 0.8, flutter: 0.3, lean: 0.06 },
  dryshrub: { f: 0, bend: 0.6, flutter: 0.5, lean: 0.1 },
  cactus: { f: 0, bend: 0.0, flutter: 0, lean: 0.04 },
  fern: { f: FLAG.noShadow, bend: 1.0, flutter: 0.9, lean: 0.15 },
  flower: { f: FLAG.noShadow | FLAG.flower, bend: 1.5, flutter: 1.0, lean: 0.15 },
  mushroom: { f: FLAG.noShadow, bend: 0, flutter: 0, lean: 0.15 },
  pebble: { f: FLAG.noShadow | FLAG.rock, bend: 0, flutter: 0, lean: 0.5, sink: 0.25 },
  reed: { f: FLAG.noShadow, bend: 1.6, flutter: 1.0, lean: 0.1 },
  rock: { f: FLAG.rock, bend: 0, flutter: 0, lean: 0.4, sink: 0.2 },
  boulder: { f: FLAG.rock, bend: 0, flutter: 0, lean: 0.25, sink: 0.18 },
  log: { f: 0, bend: 0, flutter: 0, lean: 0.05, sink: 0.12 },
  stump: { f: 0, bend: 0, flutter: 0, lean: 0.05, sink: 0.05 },
};
// ASSETS: words in the asset name or id that fit a species (kind first)
const PROTO_WORDS = {
  oak: ['oak', 'furrowed', 'tree_small'], beech: ['beech', 'maple', 'lime', 'smooth bark', 'deciduous'], birch: ['birch', 'aspen'],
  spruce: ['spruce', 'fir_tree', 'fir tree'], pine: ['pine_tree', 'scots'], jungle: ['jungle', 'tropical', 'kapok', 'jacaranda', 'island_tree'],
  palm: ['palm'], acacia: ['acacia', 'acacia-like', 'wide canopy', 'searsia'], willow: ['willow'], deadtree: ['dead', 'snag'],
  bush: ['shrub_0', 'bush'], 'conifer-young': ['sapling'], dryshrub: ['fynbos', 'rooibos', 'didelta', 'sage'], cactus: ['cactus', 'saguaro', 'quiver_tree', 'othonna'],
  fern: ['fern'], flower: ['flower', 'daisy', 'poppy', 'dandelion', 'celandine', 'periwinkle'], mushroom: ['mushroom', 'toadstool'],
  pebble: ['pebble', 'stone', 'rock'], reed: ['reed', 'cattail', 'rush'], rock: ['rock', 'stone', 'boulder'], boulder: ['boulder', 'rock'],
  log: ['log', 'trunk', 'branches'], stump: ['stump'],
};
// assets that fit a species by kind and words but read badly up close:
// the Nobiax bushes are a few crossed cards (flat sprite blobs at eye
// level), so the 3D Poly Haven shrubs take the bush species when present
const PROTO_SKIP = { bush: ['nobiax_bushes'] };
// asset kinds that can stand in for a species besides its own kind
const KIND_ALSO = { cactus: ['tree', 'succulent'], dryshrub: ['bush'], deadtree: ['tree'] };
const VARIANTS = (key) => (KIND_OF[key] === 'tree' ? 3 : ['rock', 'boulder', 'pebble'].includes(key) ? 9 : 6);
const SIZE_BAND = { pebble: [0, 0.4], rock: [0.4, 2.2], boulder: [1.2, 99], fern: [0.15, 3], bush: [0.5, 6], cactus: [0.8, 12], 'conifer-young': [0.7, 12], log: [0.12, 3] };
const KIND_OF = Object.fromEntries(SPECIES.map((s) => [s.key, s.kind]));

// ------------------------------------------------------------ assets
async function defaultBitmap(url, size) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('veg: ' + r.status + ' ' + url);
  const blob = await r.blob();
  return createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

// The asset prototypes per species: { key: [ { lods: [[parts]], height, radius, wind, sink, textures: Map name -> url } ] }
// accept(asset) -> bool picks the assets to load (default: all).
// o = { variants, firstLod } (a phone profile: 1 model per species, LOD 1 up)
export async function loadAssetProtos(lib, texSize, log, accept = null, o = {}) {
  const out = {};
  if (!lib || !lib.manifest) return out;
  const assets = (lib.manifest.assets || []).filter((a) => !accept || accept(a));
  for (const sp of SPECIES) {
    const words = PROTO_WORDS[sp.key] || [];
    const kindOk = (a) => a.kind === sp.kind || (KIND_ALSO[sp.key] || []).includes(a.kind) || (sp.key === 'boulder' && a.kind === 'rock') || (sp.key === 'rock' && a.kind === 'boulder');
    const fits = assets.filter((a) => kindOk(a) && a.lods?.length && (words.some((w) => (String(a.sub || '') + ' ' + a.name + ' ' + a.id).toLowerCase().includes(w)) || (sp.kind !== 'tree' && sp.kind !== 'bush' && a.kind === sp.kind)));
    // size bands: small stones are pebbles, big rocks are boulders
    const band = SIZE_BAND[sp.key];
    let sized = band ? fits.filter((a) => (a.height ?? 1) >= band[0] && (a.height ?? 1) <= band[1]) : fits.slice();
    const skip = PROTO_SKIP[sp.key];
    if (skip) { const kept = sized.filter((a) => !skip.some((w) => String(a.id).includes(w))); if (kept.length) sized = kept; }
    if (!sized.length) continue;
    fits.length = 0; fits.push(...sized);
    const list = [];
    // variety: one per sub (source) first, then the rest
    const pick = [], seen = new Set();
    for (const a of fits) { const k = a.sourceAsset || a.sub || a.id; if (!seen.has(k)) { seen.add(k); pick.push(a); } }
    for (const a of fits) if (!pick.includes(a)) pick.push(a);
    for (const a of pick.slice(0, o.variants || VARIANTS(sp.key))) {
      try {
        const lods = [], matUrl = new Map();
        for (let l = Math.min(o.firstLod || 0, a.lods.length - 1); l < Math.min(3, a.lods.length); l++) {
          // one retry after a short wait: a file that another process
          // writes at that moment (or a dropped request) fails once
          let got;
          try { got = await lib.loadAsset(a.id, l); } catch (e1) {
            await new Promise((r) => setTimeout(r, 400));
            got = await lib.loadAsset(a.id, l);
          }
          const parts = [];
          for (const m of got.scene.meshes) {
            const fol = m.material?.alphaMode === 'MASK' || (a.materials || []).some((mm) => mm.foliage && mm.name === m.material?.name);
            // the base colour file of this material; all LODs use the LOD0 file
            const mname = m.material?.name || '';
            let url = m.material?.baseColor?.url || null;
            if (l === 0) matUrl.set(mname, url); else url = matUrl.get(mname) || url;
            if (!url) { const tl = a.lods[0].textures || []; const t = tl.find((x) => /albedo|diff|color/i.test(x)); url = t ? lib.url(t) : null; }
            const p = new Part(url ? 'url:' + url : 'rock', fol ? 'leaf' : 'bark');
            const H = a.height || 1, R = a.radius || 1, n = m.vertexCount;
            for (let i = 0; i < n; i++) {
              const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
              const nx = m.normals ? m.normals[i * 3] : 0, ny = m.normals ? m.normals[i * 3 + 1] : 1, nz = m.normals ? m.normals[i * 3 + 2] : 0;
              const u = m.uvs ? m.uvs[i * 2] : 0, v = m.uvs ? m.uvs[i * 2 + 1] : 0;
              const hy = Math.max(0, Math.min(1, y / H)), rr = Math.min(1, Math.hypot(x, z) / Math.max(0.05, R));
              const ao = m.colors ? Math.max(0.3, m.colors[i * 4]) : (fol ? 0.5 + 0.5 * Math.max(hy, rr) : 0.6 + 0.4 * hy);
              p.vert([x, y, z], [nx, ny, nz], [u, v], hy * hy, fol ? Math.sqrt(rr) : 0, ao);
            }
            for (let i = 0; i < m.indices.length; i++) p.i.push(m.indices[i]);
            parts.push(p);
          }
          lods.push(parts);
        }
        list.push({ lods, height: a.height, radius: a.radius, wind: a.wind ?? 0.5, sink: a.sink ?? 0, id: a.id, biomes: a.biomes || null });
      } catch (e) { log('veg: asset ' + a.id + ' failed: ' + (e.message || e)); }
    }
    if (list.length) out[sp.key] = list;
  }
  return out;
}

// ------------------------------------------------------------ library
// prototypes -> one VB/IB, species table, lists, draw slots.
// Bent foliage normals (soft canopy light): each leaf vertex normal turns
// toward the outward normal of the crown ellipsoid (the box of the LOD0
// leaf vertices), by k. Flat cards then shade as one round crown and both
// faces of a card take the same outward normal (props.wgsl fs_mesh does
// not flip it). -> { leafVerts, crown: { c, r } } or null with no leaves.
export const BEND_K = 0.7;
export function bendFoliageNormals(lods, k = BEND_K) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let any = 0;
  for (const part of lods[0] || []) if (part.kind === 'leaf') for (let i = 0; i < part.n; i++) {
    for (let a = 0; a < 3; a++) { const v = part.v[i * VSTRIDE + a]; lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); }
    any++;
  }
  if (!any) return null;
  const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  const r = [0, 1, 2].map((a) => Math.max((hi[a] - lo[a]) / 2, 0.08));
  // a round crown in plan: the x and z radii are one
  r[0] = r[2] = Math.max(r[0], r[2]);
  let leafVerts = 0;
  for (const parts of lods) for (const part of parts) {
    if (part.kind !== 'leaf') continue;
    const v = part.v;
    for (let i = 0; i < part.n; i++) {
      const o = i * VSTRIDE;
      // ellipsoid normal: (p - c) / r^2
      let ex = (v[o] - c[0]) / (r[0] * r[0]), ey = (v[o + 1] - c[1]) / (r[1] * r[1]), ez = (v[o + 2] - c[2]) / (r[2] * r[2]);
      let el = Math.hypot(ex, ey, ez);
      if (el < 1e-6) { ex = 0; ey = 1; ez = 0; el = 1; }
      const nx = v[o + 3] * (1 - k) + (ex / el) * k, ny = v[o + 4] * (1 - k) + (ey / el) * k, nz = v[o + 5] * (1 - k) + (ez / el) * k;
      const nl = Math.hypot(nx, ny, nz) || 1;
      v[o + 3] = nx / nl; v[o + 4] = ny / nl; v[o + 5] = nz / nl;
      leafVerts++;
    }
  }
  return { leafVerts, crown: { c, r } };
}

function buildLibrary(protoSets, texNames) {
  const protos = [];             // GPU prototypes
  const speciesProtos = [];      // scatter species index -> [proto ids]
  SPECIES.forEach((sp, si) => {
    const g = SPEC_GPU[sp.key] || { f: 0, bend: 0.5, flutter: 0.5, lean: 0.05 };
    const set = protoSets[sp.key];
    const ids = [];
    for (const pr of set) {
      ids.push(protos.length);
      protos.push({ species: si, key: sp.key, lods: pr.lods, height: pr.height, radius: pr.radius, flags: pr.id ? g.f & ~FLAG.flower : g.f, biomes: pr.biomes ? new Set(pr.biomes.map(normKey)) : null,
        bend: g.bend * (pr.wind != null ? 0.4 + pr.wind : 1), flutter: g.flutter, sink: pr.sink ?? g.sink ?? 0, lean: g.lean, asset: pr.id || null });
    }
    speciesProtos.push(ids);
  });
  // soft canopy: bend the leaf normals once per prototype (a library
  // rebuild shares the part arrays, so mark them)
  for (const p of protos) if (!p.lods._bent) { bendFoliageNormals(p.lods); p.lods._bent = true; }
  let nv = 0, ni = 0;
  for (const p of protos) for (const parts of p.lods) for (const part of parts) { nv += part.n; ni += part.i.length; }
  // impostor quads, 4 vertices each
  nv += protos.length * 4; ni += protos.length * 6;
  const vb = new Float32Array(nv * VSTRIDE), ib = new Uint32Array(ni);
  let vo = 0, io = 0;
  const layerOf = (name) => (name in texNames ? texNames[name] : name);
  const ranges = [];    // per proto per lod: [{ firstIndex, indexCount, baseVertex, layer, kind }]
  protos.forEach((p) => {
    const R = [];
    // bounds (lod0) for the radius and the impostor frame
    let top = 0, rad = 0.1;
    for (const part of p.lods[0]) for (let k = 0; k < part.n; k++) { const v = part.v; top = Math.max(top, v[k * VSTRIDE + 1]); rad = Math.max(rad, Math.hypot(v[k * VSTRIDE], v[k * VSTRIDE + 2])); }
    p.height = p.height || top; p.radius = p.radius || rad; p.top = Math.max(top, 0.05); p.rad = rad;
    for (const parts of p.lods) {
      const lr = [];
      for (const part of parts) {
        if (!part.i.length) continue;
        vb.set(part.v, vo * VSTRIDE);
        for (let k = 0; k < part.i.length; k++) ib[io + k] = part.i[k];
        lr.push({ firstIndex: io, indexCount: part.i.length, baseVertex: vo, layer: layerOf(part.layer), kind: part.kind });
        vo += part.n; io += part.i.length;
      }
      R.push(lr);
    }
    // impostor quad: x -0.5..0.5, y 0..1, z = frame width / height
    const ratio = (2 * p.rad) / p.top;
    const q = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
    for (let k = 0; k < 4; k++) vb.set([q[k][0], q[k][1], ratio, 0, 1, 0, 0, 0, 0, 0, 1, 0], (vo + k) * VSTRIDE);
    ib.set([0, 1, 2, 0, 2, 3], io);
    p.impRange = { firstIndex: io, indexCount: 6, baseVertex: vo };
    vo += 4; io += 6;
    ranges.push(R);
  });
  const S = protos.length;
  const nLists = S * LODS + S * 2;
  const slots = [];   // { list, firstIndex, indexCount, baseVertex, layer, kind, pass: 'camera'|'shadow', proto, imp }
  protos.forEach((p, pi) => {
    const R = ranges[pi];
    R.forEach((lr, l) => lr.forEach((r) => slots.push({ ...r, list: pi * LODS + l, pass: 'camera', proto: pi })));
    if (p.flags & FLAG.impostor) slots.push({ ...p.impRange, list: pi * LODS + 3, pass: 'camera', proto: pi, imp: true, kind: 'imp', layer: 0 });
    if (!(p.flags & FLAG.noShadow)) {
      const nl = R.length;
      R[Math.min(1, nl - 1)].forEach((r) => slots.push({ ...r, list: S * LODS + pi * 2, pass: 'shadow', proto: pi }));
      // far casters (over 45 m): a tree with an impostor casts with its
      // sun facing impostor quad (2 triangles, not about 2k)
      if (p.flags & FLAG.impostor) slots.push({ ...p.impRange, list: S * LODS + pi * 2 + 1, pass: 'shadow', proto: pi, imp: true, kind: 'impsh', layer: 0 });
      else R[nl - 1].forEach((r) => slots.push({ ...r, list: S * LODS + pi * 2 + 1, pass: 'shadow', proto: pi }));
    }
  });
  // order: kind groups for fewer pipeline changes
  const order = { bark: 0, rock: 1, leaf: 2, imp: 3, impsh: 4 };
  slots.sort((a, b) => (a.pass === b.pass ? 0 : a.pass === 'camera' ? -1 : 1) || order[a.kind] - order[b.kind]);
  return { protos, speciesProtos, vb, ib, slots, nLists, ranges };
}


// ------------------------------------------------------------ cull twin
// The CPU twin of the GPU cull (shaders/props.wgsl inFrustum,
// instanceBounds, classify), for tests/veg.test.mjs. It reads the same
// VegParams floats that update() writes (writeCullParams) and the Globals
// fields that the cull reads. Keep it in step with props.wgsl.
export const LOD_PX = [380, 150, 52, 2.5];
export const NEAR_FULL = 7;   // m, props.wgsl NEAR_FULL: the least size for the LOD choice
export function writeCullParams(P, o) {
  P.fill(0);
  P.set([o.cam[0], o.cam[1], o.cam[2], o.time ?? 0], 0);
  P.set([o.shadowFar ?? 0, o.slots ?? 0, 0.6 + 0.6 * (o.q ?? 0.75), o.frame ?? 0], 4);
  P.set([o.proj[0], o.proj[5], o.H ?? 720, o.q ?? 0.75], 8);
  P.set(o.lodPx || LOD_PX, 12);
  const sd = o.sun || [0, 1, 0];
  P.set([sd[0], sd[1], sd[2], o.shadowsOn && sd[1] > -0.05 ? 1 : 0], 16);
  P.set([o.lists ?? 0, o.nSlots ?? 0, o.species ?? 0, o.aerial ? 1 : 0], 20);
  const fs = o.farK ?? 1;
  LAYERS.forEach((lr, i) => {
    const on = lr.key.startsWith('canopy') ? o.treesOn !== false : o.propsOn !== false;
    P.set([lr.near * fs, on ? lr.far * fs : 0, lr.band, (lr.farBand || 0) * fs], 28 + i * 4);
  });
  return P;
}
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// m: viewProj column major; near: proj[14]. True when the sphere (c, r)
// meets the view frustum (side planes and the near plane).
export function sphereInFrustum(m, near, c, r) {
  const q = (k) => m[k] * c[0] + m[4 + k] * c[1] + m[8 + k] * c[2] + m[12 + k];
  const qx = q(0), qy = q(1), qw = q(3);
  const len = (a, b, s) => Math.hypot(m[a] + s * m[b], m[4 + a] + s * m[4 + b], m[8 + a] + s * m[8 + b]);
  if (qw < near - r * Math.hypot(m[3], m[7], m[11])) return false;
  if (qw + qx < -r * len(3, 0, 1)) return false;
  if (qw - qx < -r * len(3, 0, -1)) return false;
  if (qw + qy < -r * len(3, 1, 1)) return false;
  if (qw - qy < -r * len(3, 1, -1)) return false;
  return true;
}
// it: 8 floats (x y z scale | yaw, species + 256 layer, tint, seed);
// sp: 8 floats (height, radius, lods, flags | bend, flutter, sink, lean)
export function instanceBounds(it, sp, P, wind = [0, 0]) {
  const s = it[3], h = sp[0] * s;
  const root = [it[0], it[1] - sp[6] * h, it[2]];
  const c = [root[0], root[1] + h * 0.5, root[2]];
  let rad = sp[1] * s;
  if (Math.floor((it[5] + 0.5) / 256) === 1) rad *= 1 + 0.7 * smooth01(1200, 5000, Math.hypot(P[0] - root[0], P[1] - root[1], P[2] - root[2]));
  const speed = Math.hypot(wind[0], wind[1]);
  const w = 0.122 * speed * sp[4] * Math.min(h, 30) + 1.9 * sp[5] * (0.15 + 0.05 * speed);
  return { c, r: Math.hypot(h * 0.5, rad) * 1.1 + h * 0.5 * Math.abs(sp[7]) + w, h, root };
}
// G = { viewProj, proj, wind }. Returns { n, lists: [[list, fade, layerFade]], shadow, px, d, lvl }
// (fade as packFade: v > 0 keeps dither < v, v < 0 keeps dither >= -v).
export function classifyCPU(it, sp, P, G) {
  const out = { n: 0, lists: [], shadow: -1, px: 0, d: 0, lvl: -1, inView: false, lf: 0 };
  if (!(it[3] > 0)) return out;
  const s = Math.floor(it[5] + 0.5) % 256, L = Math.floor((it[5] + 0.5) / 256);
  const b = instanceBounds(it, sp, P, G.wind);
  const d = Math.hypot(b.c[0] - P[0], b.c[1] - P[1], b.c[2] - P[2]);
  out.d = d;
  const lb = P.subarray(28 + L * 4, 32 + L * 4);
  const band = Math.max(lb[2], 1), farBand = Math.max(lb[3] > 0 ? lb[3] : band, 1);
  let lf = 1;
  if (lb[0] > 0) lf = smooth01(lb[0], lb[0] + band, d);
  lf *= 1 - smooth01(Math.max(lb[1] - farBand, 0), Math.max(lb[1], 1), d);
  out.lf = lf;
  if (lf <= 0.002) return out;
  const flags = Math.round(sp[3]);
  const near = G.proj[14];
  if (P[19] > 0.5 && !(flags & 4) && d < P[4]) {
    const k = Math.min((b.h + 8) / Math.max(P[17], 0.12), 400);
    const off = [-P[16] * k, -P[17] * k, -P[18] * k];
    if (sphereInFrustum(G.viewProj, near, [b.c[0] + off[0] * 0.5, b.c[1] + off[1] * 0.5, b.c[2] + off[2] * 0.5], b.r + Math.hypot(...off) * 0.5)) {
      out.shadow = Math.round(P[22]) * LODS + s * 2 + (d < 45 ? 0 : 1);
    }
  }
  if (!sphereInFrustum(G.viewProj, near, b.c, b.r)) return out;
  out.inView = true;
  const size = Math.max(b.h, 2 * sp[1] * it[3]);
  const pk = P[9] * 0.5 * P[10] / Math.max(d, 0.5) * P[6];
  const pxC = size * pk, px = Math.max(size, NEAR_FULL) * pk;
  out.px = px;
  const lods = Math.round(sp[2]), imp = !!(flags & 1), last = imp ? lods + 1 : lods;
  const th = [P[12], P[13], P[14]];
  let lvl = 0, bb = 0;
  for (;;) {
    if (lvl >= 3 || lvl + 1 >= last) break;
    const t = th[lvl];
    if (px >= t) break;
    const lo = t * 0.75;
    if (px > lo) { bb = (t - px) / (t - lo); break; }
    lvl++;
  }
  out.lvl = lvl;
  const base = s * LODS, l0 = lvl < lods ? lvl : 3, l1i = lvl + 1, l1 = l1i < lods ? l1i : 3;
  if (!imp && lvl + 1 >= lods) {
    const cut = Math.max(P[15], 0.01);
    if (pxC < cut) return out;
    const fb = 1 - smooth01(cut, cut * 1.6, pxC);
    out.n = 1; out.lists.push([base + l0, fb <= 0.001 ? 1 : -fb, lf]);
    return out;
  }
  if (bb > 0 && l1i < last) { out.n = 2; out.lists.push([base + l0, -bb, lf], [base + l1, bb, lf]); }
  else { out.n = 1; out.lists.push([base + l0, 1, lf]); }
  return out;
}
// A stand-in prototype as buildLibrary makes it, for the tests: the species
// row (8 floats, as the GPU species buffer) and the LOD0 vertex positions.
export function standInProto(key, seed = 1000) {
  const sp = SPECIES.find((x) => x.key === key);
  const lods = GEN[key](seed, sp.h);
  const g = SPEC_GPU[key] || { f: 0, bend: 0.5, flutter: 0.5, lean: 0.05 };
  let top = 0, rad = 0.1, n = 0;
  for (const part of lods[0]) n += part.n;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const part of lods[0]) for (let k = 0; k < part.n; k++) {
    const x = part.v[k * VSTRIDE], y = part.v[k * VSTRIDE + 1], z = part.v[k * VSTRIDE + 2];
    top = Math.max(top, y); rad = Math.max(rad, Math.hypot(x, z));
    pos[o++] = x; pos[o++] = y; pos[o++] = z;
  }
  const spec = new Float32Array([Math.max(top, 0.05), rad, lods.length, g.f, g.bend, g.flutter, g.sink ?? 0, g.lean]);
  return { spec, pos, species: SPECIES.indexOf(sp) };
}
// The share of pixels that a packed fade keeps (dither uniform 0..1).
export const fadeKeep = (v, lf) => (v >= 0 ? Math.min(1, v) : 1 - Math.min(1, -v)) * Math.min(1, lf);

// The page plan for the instance pool. want: tiles not yet written
// [{ key, d, need }], have: written tiles [{ key, d, pages }], free: free
// pages. Nearest wanted tiles first; a tile that does not fit takes the
// pages of written tiles farther than itself (farthest first), and only
// when that is enough. Returns { evict: [keys], write: [keys] }.
export function planPages(want, have, free) {
  const w = want.slice().sort((a, b) => a.d - b.d);
  const h = have.slice().sort((a, b) => b.d - a.d);
  const evict = [], write = [];
  let hi = 0;
  for (const t of w) {
    if (t.need > free) {
      // pages that eviction can give: written tiles from hi on, farther than t
      let can = free, k = hi;
      while (can < t.need && k < h.length && h[k].d > t.d) { can += h[k].pages; k++; }
      if (can < t.need) continue;
      for (; hi < k; hi++) { free += h[hi].pages; evict.push(h[hi].key); }
    }
    free -= t.need; write.push(t.key);
  }
  return { evict, write };
}

// ------------------------------------------------------------ module
export async function createVegetation(gpu) {
  const device = gpu.device, queue = gpu.queue;
  const q = gpu.quality ?? 0.75;
  const log = gpu.log || ((m) => console.warn(m));
  const BU = GPUBufferUsage, TU = GPUTextureUsage, SS = GPUShaderStage;
  // a phone profile (gpu/budget.js gpu.profile.veg) caps the sizes
  const vp = (gpu.profile && gpu.profile.veg) || {};
  const texSize = Math.min(q >= 0.5 ? 512 : 256, vp.texSize || 512);
  const IMP_F = vp.impFrame || IMP_FRAME;
  const t0 = performance.now();
  const mark = (what) => { if (gpu.vegTimes) log('veg ' + what + ' ' + (performance.now() - t0).toFixed(0) + ' ms'); };

  // ---- shaders
  const [propsCode, grassCode] = await Promise.all([gpu.loadWGSL('shaders/props.wgsl'), gpu.loadWGSL('shaders/grass.wgsl')]);
  const propsMod = device.createShaderModule({ label: 'veg props', code: propsCode });
  const grassMod = device.createShaderModule({ label: 'veg grass', code: grassCode });

  // ---- layouts
  const C = SS.COMPUTE, VF = SS.VERTEX | SS.FRAGMENT;
  const ent = (b, vis, res) => ({ binding: b, visibility: vis, ...res });
  const sto = (ro) => ({ buffer: { type: ro ? 'read-only-storage' : 'storage' } });
  const uni = { buffer: { type: 'uniform' } };
  const propsCL = device.createBindGroupLayout({ label: 'veg props compute', entries: [
    ent(0, C, uni), ent(1, C, sto(true)), ent(2, C, sto(false)), ent(3, C, sto(false)), ent(4, C, sto(false)), ent(5, C, sto(false)),
    ent(6, C, sto(false)), ent(7, C, sto(true)), ent(8, C, sto(true))] });
  const propsRL = device.createBindGroupLayout({ label: 'veg props render', entries: [
    ent(0, VF, uni), ent(1, VF, sto(true)), ent(10, VF, sto(true)), ent(11, VF, sto(true)), ent(12, VF, sto(true)),
    ent(13, VF, { texture: { viewDimension: '2d-array' } }), ent(14, VF, { sampler: {} }),
    ent(15, VF, { texture: { viewDimension: '2d-array' } }), ent(16, VF, { texture: { viewDimension: '2d-array' } }),
    ent(18, VF, { texture: {} }), ent(19, VF, { sampler: {} })] });
  const bakeL = device.createBindGroupLayout({ label: 'veg bake', entries: [
    ent(13, VF, { texture: { viewDimension: '2d-array' } }), ent(14, VF, { sampler: {} }), ent(17, VF, { buffer: { type: 'uniform', hasDynamicOffset: true } })] });
  const drawL = device.createBindGroupLayout({ label: 'veg draw', entries: [ent(0, VF, { buffer: { type: 'uniform', hasDynamicOffset: true } })] });
  const grassCL = device.createBindGroupLayout({ label: 'veg grass compute', entries: [ent(0, C, uni), ent(1, C, sto(false)), ent(2, C, sto(false))] });
  const grassRL = device.createBindGroupLayout({ label: 'veg grass render', entries: [ent(0, VF, uni), ent(3, VF, sto(true)), ent(4, VF, { texture: {} }), ent(5, VF, { sampler: {} })] });
  const empty = gpu.emptyLayout || device.createBindGroupLayout({ entries: [] });
  const shadowSampleL = gpu.shadowSampleLayout, shadowPassL = gpu.shadowPassLayout;

  const plProps = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, propsCL] });
  const plMesh = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, propsRL, shadowSampleL, drawL] });
  const plShadow = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, propsRL, shadowPassL, drawL] });
  const plBake = device.createPipelineLayout({ bindGroupLayouts: [empty, bakeL, empty, drawL] });
  const plGrassC = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, grassCL] });
  const plGrassR = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, grassRL, shadowSampleL] });

  const vbLayout = [{ arrayStride: VSTRIDE * 4, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32x2' },
    { shaderLocation: 4, offset: 40, format: 'float32x2' }] }];
  const depthS = gpu.depthState ? gpu.depthState(true, 'greater') : { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' };
  const shadowS = gpu.shadowDepthState || { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater', depthBias: -2, depthBiasSlopeScale: -2 };
  const cpipe = (mod, layout, entry) => device.createComputePipelineAsync({ label: 'veg ' + entry, layout, compute: { module: mod, entryPoint: entry } });
  const rpipe = (o) => device.createRenderPipelineAsync({ label: 'veg ' + o.label, layout: o.layout,
    vertex: { module: o.mod, entryPoint: o.vs, buffers: o.buffers ?? vbLayout },
    fragment: o.fs ? { module: o.mod, entryPoint: o.fs, targets: o.targets ?? [{ format: gpu.hdrFormat }] } : undefined,
    primitive: { topology: o.topology ?? 'triangle-list', cullMode: o.cull ?? 'none' },
    depthStencil: o.depth });
  const [pSnap, pCount, pScan, pEmit, pBlades0, pBlades1, pBlades2, pBlades3, pFinal, pBark, pLeaf, pImp, pShOpaque, pShLeaf, pBake, pGrass, pShImp] = await Promise.all([
    cpipe(propsMod, plProps, 'cs_snap'), cpipe(propsMod, plProps, 'cs_count'), cpipe(propsMod, plProps, 'cs_scan'), cpipe(propsMod, plProps, 'cs_emit'),
    cpipe(grassMod, plGrassC, 'cs_blades0'), cpipe(grassMod, plGrassC, 'cs_blades1'), cpipe(grassMod, plGrassC, 'cs_blades2'), cpipe(grassMod, plGrassC, 'cs_blades3'),
    cpipe(grassMod, plGrassC, 'cs_final'),
    rpipe({ label: 'bark', layout: plMesh, mod: propsMod, vs: 'vs_mesh', fs: 'fs_mesh', cull: 'back', depth: depthS }),
    rpipe({ label: 'leaf', layout: plMesh, mod: propsMod, vs: 'vs_mesh', fs: 'fs_mesh', cull: 'none', depth: depthS }),
    rpipe({ label: 'impostor', layout: plMesh, mod: propsMod, vs: 'vs_imp', fs: 'fs_imp', cull: 'none', depth: depthS }),
    rpipe({ label: 'shadow', layout: plShadow, mod: propsMod, vs: 'vs_shadow', cull: 'none', depth: shadowS }),
    rpipe({ label: 'shadow leaf', layout: plShadow, mod: propsMod, vs: 'vs_shadow', fs: 'fs_shadow', targets: [], cull: 'none', depth: shadowS }),
    rpipe({ label: 'bake', layout: plBake, mod: propsMod, vs: 'vs_bake', fs: 'fs_bake', cull: 'none', targets: [{ format: 'rgba8unorm-srgb' }, { format: 'rgba8unorm' }],
      depth: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' } }),
    rpipe({ label: 'grass', layout: plGrassR, mod: grassMod, vs: 'vs_grass', fs: 'fs_grass', buffers: [], topology: 'triangle-strip', cull: 'none', depth: depthS }),
    rpipe({ label: 'shadow impostor', layout: plShadow, mod: propsMod, vs: 'vs_imp_shadow', fs: 'fs_imp_shadow', targets: [], cull: 'none', depth: shadowS }),
  ]);

  const pBlades = [pBlades0, pBlades1, pBlades2, pBlades3];
  mark('pipelines');
  // ---- textures: procedural layers, asset layers later
  const tex = await makeTextures(texSize, () => new Promise((r) => setTimeout(r, 0)));
  mark('textures');
  const sRep = gpu.sRepeat || device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });
  const mipCount = Math.log2(texSize) + 1;
  let matTex = null, matLayers = 0;
  const urlLayers = new Map();   // asset texture url -> layer
  function makeMatTex(extraBitmaps) {
    const nL = tex.levels.length + extraBitmaps.length;
    const t = device.createTexture({ label: 'veg materials', size: [texSize, texSize, nL], format: 'rgba8unorm-srgb', mipLevelCount: mipCount,
      usage: TU.TEXTURE_BINDING | TU.COPY_DST | TU.COPY_SRC | TU.RENDER_ATTACHMENT });
    tex.levels.forEach((mips, layer) => mips.forEach((m, lvl) => queue.writeTexture({ texture: t, mipLevel: lvl, origin: [0, 0, layer] }, m.data, { bytesPerRow: m.size * 4, rowsPerImage: m.size }, [m.size, m.size, 1])));
    extraBitmaps.forEach((bm, k) => {
      const layer = tex.levels.length + k;
      // an ImageBitmap (browser) or raw { data: RGBA8 sRGB, width, height } (tests)
      if (bm.data) queue.writeTexture({ texture: t, origin: [0, 0, layer] }, bm.data, { bytesPerRow: texSize * 4, rowsPerImage: texSize }, [texSize, texSize, 1]);
      else {
        // a bitmap that the platform cannot copy leaves its layer empty (the
        // model stays, with a dark albedo) instead of losing every asset
        try { queue.copyExternalImageToTexture({ source: bm }, { texture: t, origin: [0, 0, layer] }, [texSize, texSize, 1]); } catch (e) { log('veg: texture layer ' + layer + ': ' + (e.message || e)); }
      }
      genMips(t, layer, 'rgba8unorm-srgb');
    });
    if (matTex) matTex.destroy();
    matTex = t; matLayers = nL;
  }

  // GPU mips (render blit) for the impostor atlases and asset layers
  const mipCode = `
    @group(0) @binding(0) var src: texture_2d<f32>;
    @group(0) @binding(1) var smp: sampler;
    struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f };
    @vertex fn vs(@builtin(vertex_index) i: u32) -> O {
      var o: O; let x = f32((i << 1u) & 2u); let y = f32(i & 2u);
      o.p = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0); o.uv = vec2f(x, y); return o; }
    @fragment fn fs(o: O) -> @location(0) vec4f {
      let c = textureSample(src, smp, o.uv);
      return vec4f(c.rgb, clamp(c.a * 1.2, 0.0, 1.0)); }`;
  const mipMod = device.createShaderModule({ label: 'veg mips', code: mipCode });
  const mipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const mipPipes = {};
  function mipPipe(format) {
    if (!mipPipes[format]) mipPipes[format] = device.createRenderPipeline({ label: 'veg mip ' + format, layout: 'auto', vertex: { module: mipMod, entryPoint: 'vs' }, fragment: { module: mipMod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    return mipPipes[format];
  }
  function genMips(t, layer, format) {
    const pipe = mipPipe(format);
    const enc = device.createCommandEncoder();
    for (let l = 1; l < t.mipLevelCount; l++) {
      const srcV = t.createView({ dimension: '2d', baseMipLevel: l - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const dstV = t.createView({ dimension: '2d', baseMipLevel: l, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: srcV }, { binding: 1, resource: mipSampler }] });
      const p = enc.beginRenderPass({ colorAttachments: [{ view: dstV, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
    }
    queue.submit([enc.finish()]);
  }

  // ---- buffers that do not depend on the library
  // instance pages: the far canopy fills about 1600 pages at q 0.75, so
  // the pool is larger than that; a phone (gpu.coarse) takes 60 %
  const coarse = !!gpu.coarse;
  const maxPages = Math.round((384 + 3200 * q) * (coarse ? 0.6 : 1));   // q 0.25: 1184 (152k), 0.75: 2784 (356k), 1: 3584 (459k)
  const maxInst = maxPages * PAGE;
  const instBuf = device.createBuffer({ label: 'veg instances', size: maxInst * 32, usage: BU.STORAGE | BU.COPY_DST });
  const visBuf = device.createBuffer({ label: 'veg visible', size: maxInst * 3 * 8, usage: BU.STORAGE });
  const pagesBuf = device.createBuffer({ label: 'veg snap pages', size: maxPages * 4, usage: BU.STORAGE | BU.COPY_DST });
  const paramBuf = device.createBuffer({ label: 'veg params', size: 256, usage: BU.UNIFORM | BU.COPY_DST });
  const params = new Float32Array(64);

  // grass
  // fine spacing m: q 1 -> 4 cm; low quality and phones get fewer blades
  // and a shorter grass range (R0 x 8 is the outer ring)
  const grassD = (0.075 - 0.035 * q) * (coarse ? 1.3 : 1);
  const grassR0 = q < 0.4 || coarse ? 7 : 10;
  // layer distances: x 0.625 (low) .. 1 (ultra), phones x 0.75 more
  const farK = (0.5 + 0.5 * q) * (coarse ? 0.75 : 1);
  // tree shadow casters: near ones draw LOD 1 (about 8k triangles for an
  // asset tree) into each cascade, far ones their impostor quad. Past this
  // range the impostor crown shading (props.wgsl fs_imp) stands for it.
  const shadowCap = (300 + 900 * q) * (coarse ? 0.6 : 1);   // q 0.75: 975 m
  const grassN = Math.ceil((2 * grassR0) / grassD / 8) * 8 + 8;
  const grassCap = Math.min(Math.floor(device.limits.maxStorageBufferBindingSize / 48), Math.round(grassN * grassN * 1.6), vp.grassCap || Infinity);
  const bladeBuf = device.createBuffer({ label: 'veg blades', size: grassCap * 48, usage: BU.STORAGE });
  const gargsBuf = device.createBuffer({ label: 'veg grass args', size: 16, usage: BU.STORAGE | BU.INDIRECT | BU.COPY_DST });
  const gparamBuf = device.createBuffer({ label: 'veg grass params', size: 160, usage: BU.UNIFORM | BU.COPY_DST });
  const gparams = new Float32Array(40);
  const grassCBG = device.createBindGroup({ layout: grassCL, entries: [{ binding: 0, resource: { buffer: gparamBuf } }, { binding: 1, resource: { buffer: bladeBuf } }, { binding: 2, resource: { buffer: gargsBuf } }] });
  // SKY's cloud shadow map (NOTES.md SKY -> ALL): gpu.cloudShadow or
  // frame.cloudShadow; a lit 1 x 1 stand-in until it is there
  const litTex = device.createTexture({ label: 'veg lit', size: [1, 1], format: 'rgba8unorm', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  queue.writeTexture({ texture: litTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
  const litSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  let cloud = null;
  const cloudEntries = (a, b) => [{ binding: a, resource: cloud ? cloud.view : litTex.createView() }, { binding: b, resource: cloud ? cloud.sampler : litSampler }];
  const makeGrassRBG = () => device.createBindGroup({ layout: grassRL, entries: [{ binding: 0, resource: { buffer: gparamBuf } }, { binding: 3, resource: { buffer: bladeBuf } }, ...cloudEntries(4, 5)] });
  let grassRBG = makeGrassRBG();

  // ---- instances, pages and the stream
  let field = null, stream = null, terrainView = null, terrainVersion = -1;
  const tiles = new Map();          // key -> { pages: [], tile }
  const freePages = [];
  for (let i = maxPages - 1; i >= 0; i--) freePages.push(i);
  let highPage = 0;
  let snapList = [];
  let snapAll = false;
  const zeroPage = new Float32Array(PAGE * 8);

  // ---- library state (rebuilt when assets arrive)
  let L = null;            // { lib, specBuf, countsBuf, cursorBuf, offsetsBuf, argsBuf, slotBuf, drawBuf, vbuf, ibuf, impA, impN, computeBG, renderBG, drawBG, cameraSlots, shadowSlots }
  function destroyLib() {
    if (!L) return;
    for (const k of ['specBuf', 'countsBuf', 'offsetsBuf', 'argsBuf', 'slotBuf', 'drawBuf', 'vbuf', 'ibuf', 'impA', 'impN']) L[k]?.destroy?.();
  }
  function installLibrary(protoSets, extraBitmaps) {
    if (vp.assets) destroyLib();   // a phone: never two libraries at one time (L is set again below)
    const lib = buildLibrary(protoSets, tex.names);
    for (const [url, layer] of urlLayers) lib.slots.forEach((s) => { if (s.layer === 'url:' + url) s.layer = tex.levels.length + layer; });
    lib.slots.forEach((s) => { if (typeof s.layer !== 'number') s.layer = tex.names.rock; });
    makeMatTex(extraBitmaps);
    const S = lib.protos.length;
    const specF = new Float32Array(S * 8);
    lib.protos.forEach((p, i) => specF.set([p.top, p.rad, p.lods.length, p.flags, p.bend, p.flutter, p.sink, p.lean], i * 8));
    const mk = (label, size, usage, data) => { const b = device.createBuffer({ label, size: Math.max(16, Math.ceil(size / 16) * 16), usage, mappedAtCreation: !!data }); if (data) { new data.constructor(b.getMappedRange()).set(data); b.unmap(); } return b; };
    const nl = lib.nLists, ns = lib.slots.length;
    const slotU = new Uint32Array(ns * 4);
    lib.slots.forEach((s, k) => slotU.set([s.list, s.indexCount, s.firstIndex, s.baseVertex], k * 4));
    const drawU = new Uint32Array(ns * 64);
    lib.slots.forEach((s, k) => drawU.set([s.list, s.imp ? impLayerOf(lib, s.proto) : s.layer, (s.kind === 'leaf' ? 1 : 0) | (s.imp ? 2 : 0) | (s.kind === 'rock' ? 4 : 0), s.proto], k * 64));
    const vbuf = mk('veg vertices', lib.vb.byteLength, BU.VERTEX, lib.vb);
    const ibuf = mk('veg indices', lib.ib.byteLength, BU.INDEX, lib.ib);
    const N = {
      lib, specBuf: mk('veg species', specF.byteLength, BU.STORAGE, specF),
      countsBuf: mk('veg counts', nl * 8, BU.STORAGE | BU.COPY_DST),
      offsetsBuf: mk('veg offsets', nl * 4, BU.STORAGE), argsBuf: mk('veg args', ns * 20, BU.STORAGE | BU.INDIRECT),
      slotBuf: mk('veg slots', slotU.byteLength, BU.STORAGE, slotU), drawBuf: mk('veg draws', drawU.byteLength, BU.UNIFORM, drawU),
      vbuf, ibuf,
    };
    // impostor atlases
    const impProtos = lib.protos.map((p, i) => i).filter((i) => lib.protos[i].flags & FLAG.impostor);
    const nImp = Math.max(1, impProtos.length);
    const impMips = Math.log2(IMP_F * 2) + 1;
    N.impA = device.createTexture({ label: 'veg impostor albedo', size: [IMP_F * 4, IMP_F * 2, nImp], format: 'rgba8unorm-srgb', mipLevelCount: impMips, usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT | TU.COPY_SRC });
    N.impN = device.createTexture({ label: 'veg impostor normal', size: [IMP_F * 4, IMP_F * 2, nImp], format: 'rgba8unorm', mipLevelCount: impMips, usage: TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT | TU.COPY_SRC });
    N.computeBG = device.createBindGroup({ label: 'veg props compute', layout: propsCL, entries: [
      { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: { buffer: N.specBuf } }, { binding: 2, resource: { buffer: instBuf } },
      { binding: 3, resource: { buffer: N.countsBuf } }, { binding: 4, resource: { buffer: N.offsetsBuf } }, { binding: 5, resource: { buffer: visBuf } },
      { binding: 6, resource: { buffer: N.argsBuf } }, { binding: 7, resource: { buffer: N.slotBuf } }, { binding: 8, resource: { buffer: pagesBuf } }] });
    N.makeRenderBG = () => device.createBindGroup({ label: 'veg props render', layout: propsRL, entries: [
      { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: { buffer: N.specBuf } }, { binding: 10, resource: { buffer: instBuf } },
      { binding: 11, resource: { buffer: N.offsetsBuf } }, { binding: 12, resource: { buffer: visBuf } },
      { binding: 13, resource: matTex.createView({ dimension: '2d-array' }) }, { binding: 14, resource: sRep },
      { binding: 15, resource: N.impA.createView({ dimension: '2d-array' }) }, { binding: 16, resource: N.impN.createView({ dimension: '2d-array' }) },
      ...cloudEntries(18, 19)] });
    N.renderBG = N.makeRenderBG();
    N.drawBG = device.createBindGroup({ label: 'veg draw', layout: drawL, entries: [{ binding: 0, resource: { buffer: N.drawBuf, size: 16 } }] });
    N.cameraSlots = []; N.shadowSlots = [];
    lib.slots.forEach((s, k) => (s.pass === 'camera' ? N.cameraSlots : N.shadowSlots).push({ k, kind: s.kind }));
    N.impProtos = impProtos;
    bakeImpostors(N);
    destroyLib();
    L = N;
    remapAllTiles();
  }
  function impLayerOf(lib, pi) { let k = 0; for (let i = 0; i < pi; i++) if (lib.protos[i].flags & FLAG.impostor) k++; return k; }

  // 8 side views of lod0 per tree prototype -> atlas layer
  function bakeImpostors(N) {
    const lib = N.lib;
    const depth = device.createTexture({ size: [IMP_F * 4, IMP_F * 2], format: 'depth32float', usage: TU.RENDER_ATTACHMENT });
    const bakeBuf = device.createBuffer({ size: Math.max(1, N.impProtos.length) * NVIEW * 256, usage: BU.UNIFORM | BU.COPY_DST });
    const bg = device.createBindGroup({ layout: bakeL, entries: [{ binding: 13, resource: matTex.createView({ dimension: '2d-array' }) }, { binding: 14, resource: sRep }, { binding: 17, resource: { buffer: bakeBuf, size: 80 } }] });
    const emptyBG = device.createBindGroup({ layout: empty, entries: [] });
    const enc = device.createCommandEncoder();
    N.impProtos.forEach((pi, li) => {
      const p = lib.protos[pi];
      const R = Math.hypot(p.rad, p.top) + 0.1;
      for (let v = 0; v < NVIEW; v++) {
        const a = v / NVIEW * Math.PI * 2;
        const out = [Math.sin(a), 0, Math.cos(a)], right = [out[2], 0, -out[0]];
        // clip.x = dot(p, right) / rad, clip.y = (y - top/2) / (top/2), z = 0.5 - dot(p, out) / (2R)
        const m = new Float32Array(16);
        m[0] = right[0] / p.rad; m[4] = 0; m[8] = right[2] / p.rad; m[12] = 0;
        m[1] = 0; m[5] = 2 / p.top; m[9] = 0; m[13] = -1;
        m[2] = -out[0] / (2 * R); m[6] = 0; m[10] = -out[2] / (2 * R); m[14] = 0.5;
        m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
        const u = new Float32Array(20); u.set(m, 0); u.set([v, Math.sin(a), Math.cos(a), 0], 16);
        queue.writeBuffer(bakeBuf, (li * NVIEW + v) * 256, u);
      }
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: N.impA.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: li, arrayLayerCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0.05, 0.07, 0.03, 0] },
          { view: N.impN.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: li, arrayLayerCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 1, 0.5, 0] }],
        depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 },
      });
      pass.setPipeline(pBake);
      pass.setBindGroup(0, emptyBG); pass.setBindGroup(2, emptyBG);
      pass.setVertexBuffer(0, N.vbuf); pass.setIndexBuffer(N.ibuf, 'uint32');
      for (let v = 0; v < NVIEW; v++) {
        pass.setViewport((v % 4) * IMP_F, Math.floor(v / 4) * IMP_F, IMP_F, IMP_F, 0, 1);
        pass.setBindGroup(1, bg, [(li * NVIEW + v) * 256]);
        lib.slots.forEach((s, k) => {
          if (s.pass !== 'camera' || s.proto !== pi || s.imp || s.list !== pi * LODS) return;
          pass.setBindGroup(3, N.drawBG, [k * 256]);
          pass.drawIndexed(s.indexCount, 1, s.firstIndex, s.baseVertex, 0);
        });
      }
      pass.end();
    });
    queue.submit([enc.finish()]);
    for (let li = 0; li < N.impProtos.length; li++) { genMips(N.impA, li, 'rgba8unorm-srgb'); genMips(N.impN, li, 'rgba8unorm'); }
    depth.destroy();
    queue.onSubmittedWorkDone().then(() => bakeBuf.destroy());
  }

  // ---- stand-in prototypes (2 variants for trees, 1 otherwise)
  function standIns() {
    const sets = {};
    SPECIES.forEach((sp, si) => {
      const nVar = sp.kind === 'tree' ? 2 : (sp.kind === 'rock' || sp.kind === 'boulder') ? 3 : 1;
      sets[sp.key] = [];
      for (let k = 0; k < nVar; k++) sets[sp.key].push({ lods: GEN[sp.key](1000 + si * 37 + k * 101, sp.h), height: 0, radius: 0 });
    });
    return sets;
  }
  const sets0 = standIns();
  mark('meshes');
  installLibrary(sets0, []);
  mark('library');
  const tLib = performance.now() - t0;

  // ---- instances, pages and the stream (state is declared above)

  // the variant: by the instance seed, among the prototypes whose asset
  // biome tags hold the biome of the instance (stand-ins fit all biomes)
  function protoFor(si, seed, x, z) {
    let ids = L.lib.speciesProtos[si];
    if (field && ids.length > 1) {
      const bk = BIOME_KEYS[field.biomeAt(x, z)];
      const tagged = ids.filter((i) => L.lib.protos[i].biomes?.has(bk));
      // assets tagged for this biome first, else the stand-ins, else any
      const free = ids.filter((i) => !L.lib.protos[i].biomes);
      ids = tagged.length ? tagged.concat(free.slice(0, Math.max(0, tagged.length >> 1))) : free.length ? free : ids;
    }
    return ids[Math.min(ids.length - 1, Math.floor(seed * 7919 % 1 * ids.length))] ?? ids[0];
  }
  function writeTile(key, t) {
    const need = Math.ceil(t.count / PAGE);
    if (need > freePages.length) return false;
    const layer = LAYER_INDEX[t.layer];
    const pages = [];
    const buf = new Float32Array(need * PAGE * 8);
    for (let i = 0; i < t.count; i++) {
      const o = i * STRIDE, si = t.data[o + 5], seed = t.data[o + 7];
      const pi = protoFor(si, seed, t.data[o], t.data[o + 2]), pr = L.lib.protos[pi];
      // scatter scale is relative to the species height; assets keep their own size
      let s = t.data[o + 3];
      if (pr.asset) s *= Math.max(0.35, Math.min(2.5, SPECIES[si].h / pr.top)) ** 0.5;
      buf.set([t.data[o], t.data[o + 1], t.data[o + 2], s, t.data[o + 4], pi + 256 * layer, t.data[o + 6], seed], i * 8);
    }
    for (let k = 0; k < need; k++) {
      const pg = freePages.pop(); pages.push(pg); highPage = Math.max(highPage, pg + 1);
      queue.writeBuffer(instBuf, pg * PAGE * 32, buf, k * PAGE * 8, PAGE * 8);
      snapList.push(pg);
    }
    tiles.set(key, { pages, tile: t });
    return true;
  }
  function freeTile(key) {
    const e = tiles.get(key); if (!e) return;
    for (const pg of e.pages) { queue.writeBuffer(instBuf, pg * PAGE * 32, zeroPage); freePages.push(pg); }
    tiles.delete(key);
  }
  // The stream tiles to the instance pages, nearest first. When the pool
  // is full, a near tile takes the pages of written tiles that are farther
  // (planPages); before, a new tile that did not fit was left out, and
  // after a move the new tiles are the near ones: the plants at the camera
  // were the ones that did not show.
  let missing = 0, syncAt = -1, lastCam = null;
  function syncTiles(cam = lastCam) {
    if (!stream) return;
    if (cam) lastCam = cam;
    for (const key of [...tiles.keys()]) if (!stream.tiles.has(key)) freeTile(key);
    const dist = (t) => (lastCam ? tileDist(field, LAYERS[LAYER_INDEX[t.layer]], t.tx, t.tz, lastCam[0], lastCam[2], lastCam[1])[0] : 0);
    const want = [], have = [];
    for (const [key, t] of stream.tiles) if (!tiles.has(key) && t.count) want.push({ key, d: dist(t), need: Math.ceil(t.count / PAGE) });
    if (!want.length) { missing = 0; return; }
    for (const [key, e] of tiles) have.push({ key, d: dist(e.tile), pages: e.pages.length });
    const plan = planPages(want, have, freePages.length);
    for (const key of plan.evict) freeTile(key);
    for (const key of plan.write) writeTile(key, stream.tiles.get(key));
    missing = want.length - plan.write.length;
  }
  function remapAllTiles() {      // a new library: proto ids change
    if (!stream) return;
    for (const key of [...tiles.keys()]) freeTile(key);
    syncTiles();
  }
  function clearAll() { for (const key of [...tiles.keys()]) freeTile(key); highPage = 0; }

  // ---- assets in the background (procedural stand-ins until then)
  // Two phases. First the default-view set (manifest default: true, the
  // ASSETS download budget). Then, when a finished terrain arrives, the
  // other assets whose biome tags occur on it (palms and tropical shrubs
  // for a tropical island, saguaro for a desert, ...), and the library is
  // built again. Loads run one at a time (a chain); bitmaps are cached.
  let assetsState = 'none';
  let assetIds = '';                       // the accepted set now installed
  const bitmapCache = new Map();           // url -> bitmap
  async function loadAssets(accept) {
    const lib = gpu.assets;
    if (!lib || !lib.manifest) return;
    const ids = (lib.manifest.assets || []).filter(accept).map((a) => a.id).join(',');
    if (ids === assetIds) return;
    assetIds = ids;
    assetsState = 'loading';
    try {
      const sets = await loadAssetProtos(lib, texSize, log, accept, { variants: vp.variants, firstLod: vp.firstLod });
      if (!Object.keys(sets).length) { assetsState = 'none fit'; return; }
      // textures: one layer per albedo url
      const urls = [];
      for (const k in sets) for (const pr of sets[k]) for (const parts of pr.lods) for (const part of parts) if (String(part.layer).startsWith('url:')) { const u = part.layer.slice(4); if (!urls.includes(u)) urls.push(u); }
      const loader = gpu.vegImageLoader || defaultBitmap;
      const bitmaps = [];
      urlLayers.clear();
      for (const u of urls) {
        let bm = bitmapCache.get(u) || null;
        if (!bm) {
          try { bm = await loader(u, texSize); } catch (e1) {
            try { await new Promise((r) => setTimeout(r, 400)); bm = await loader(u, texSize); } catch (e) { log('veg: texture ' + u + ': ' + (e.message || e)); }
          }
          if (bm) bitmapCache.set(u, bm);
        }
        if (bm) { bitmaps.push(bm); urlLayers.set(u, bitmaps.length - 1); }
      }
      const base = { ...sets0 };
      for (const k in sets) {
        // one stand-in stays: it fills the biomes that no asset is tagged for
        base[k] = [...sets[k], sets0[k][0]];
      }
      installLibrary(base, bitmaps);
      assetsState = 'loaded ' + Object.keys(sets).map((k) => k + ' ' + sets[k].length).join(', ');
    } catch (e) { assetsState = 'failed'; log('veg: assets failed: ' + (e.message || e)); }
  }
  let assetChain = Promise.resolve();
  const queueAssets = (accept) => { assetChain = assetChain.then(() => loadAssets(accept)); return assetChain; };
  const isDefault = (a) => a.default !== false;
  const assetsReady = gpu.assets && vp.assets !== 'none' ? queueAssets(isDefault) : Promise.resolve();
  // the biome keys that cover at least 0.3 % of a terrain
  function biomesOn(cpu) {
    const c = new Uint32Array(256);
    const B = cpu.biome, step = Math.max(1, B.length >> 16);
    let n = 0;
    for (let i = 0; i < B.length; i += step) { c[B[i]]++; n++; }
    const tbl = gpu.biomes || cpu.biomes || null;
    const keyOf = (id) => (tbl ? normKey((tbl.find((b) => b.id === id) || {}).key) : BIOME_KEYS[id]);
    const out = new Set();
    for (let id = 0; id < 256; id++) if (c[id] > n * 0.003) { const k = keyOf(id); if (k) out.add(k); }
    return out;
  }

  // ---- per frame state
  let aerialOn = true;
  let shadowsOn = 1, propsCount = 0, grassOn = true, propsOn = true, treesOn = true, propsOn2 = true, snapUntil = -1;
  const lodPx = LOD_PX;
  const stats = { instances: 0, tiles: 0, pages: 0, grassCap, grassN, libMs: tLib, protos: () => L.lib.protos.length };

  let mix = MIX0, mixAt = -1;
  const clampN = (v, a, b, d) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, Math.round(+v * 100) / 100)) : d);
  const newStream = () => createScatterStream(field, { farScale: farK, maxDist: Math.min(7000, field.worldSize * 0.75) });
  const mod = {
    ready: assetsReady,
    setTerrain(t) {
      terrainView = t;
      const cpu = t && t.cpu;
      if (!cpu || !cpu.biome || !cpu.height) {
        // a new generation: the old plants would float on the new ground
        if (field) { clearAll(); field = null; stream = null; }
        return;
      }
      if (field && field._src === cpu) { snapAll = true; return; }
      field = makeField({ ...cpu, origin: -cpu.worldSize / 2 }, { biomes: gpu.biomes || cpu.biomes || null });
      field._src = cpu;
      field.mix = mix;
      clearAll();
      stream = newStream();
      snapAll = true;
      // phase 2 of the assets: the ones whose biomes are on this terrain
      if (gpu.assets && gpu.assets.manifest && !vp.assets) {
        const on = biomesOn(cpu);
        queueAssets((a) => isDefault(a) || (a.biomes || []).some((b) => on.has(normKey(b))));
      }
    },
    update(frame) {
      const g = frame.globals;
      // frame.veg (Vegetation sliders and dice): a new mix scatters again,
      // at most 3 times a second while a slider moves
      const fv = frame.veg;
      if (fv) {
        const m = { density: clampN(fv.density, 0.2, 2.5, 1), conifer: clampN(fv.conifer, 0, 1, 0.5), flowers: clampN(fv.flowers, 0, 1, 0.5) };
        const t = frame.time ?? 0;
        if ((m.density !== mix.density || m.conifer !== mix.conifer || m.flowers !== mix.flowers) && t - mixAt > 0.33) {
          mix = m; mixAt = t;
          if (field) { field.mix = mix; clearAll(); stream = newStream(); snapAll = true; }
        }
      }
      const cam = frame.camera?.pos || [g[GO.camPos], g[GO.camPos + 1], g[GO.camPos + 2]];
      const tv = frame.terrain || terrainView;
      if (tv && tv.version !== terrainVersion) { terrainVersion = tv.version; snapUntil = (frame.time ?? 0) + 1.2; }
      // the terrain blends for BLEND_S after a new snapshot: re-snap all
      if ((frame.time ?? 0) < snapUntil) snapAll = true;
      const ly = frame.layers || {};
      grassOn = ly.grass !== false; treesOn = ly.trees !== false; propsOn2 = ly.props !== false;
      if (stream) {
        const made = stream.update(cam[0], cam[2], frame.budgetMs ?? 3, cam[1]);
        const t = frame.time ?? 0;
        // tiles left out (a full page pool) are tried again 4 times a second:
        // the camera moved, so the near ones can now take far tiles' pages
        if (made || stream.version !== mod._sv || (missing && t - syncAt > 0.25)) { mod._sv = stream.version; syncAt = t; syncTiles(cam); }
      }
      let n = 0; for (const e of tiles.values()) n += e.tile.count;
      propsCount = n;
      stats.instances = n; stats.tiles = tiles.size; stats.pages = maxPages - freePages.length; stats.missingTiles = missing;
      const proj = frame.camera?.proj || g.subarray(GO.proj, GO.proj + 16);
      const H = g[GO.screen + 1] || 720;
      shadowsOn = frame.shadows === false || frame.shadowInfo === null ? 0 : 1;
      const shadowFar = Math.min(frame.shadowDistance ?? 1e9, frame.shadowInfo?.splits?.[frame.shadowInfo.count - 1] ?? 1e9, shadowCap);
      writeCullParams(params, { cam, time: g[GO.camPos + 3], shadowFar: frame.shadowFar ?? shadowFar, slots: highPage * PAGE, q, proj, H,
        frame: g[GO.frame], lodPx, sun: [g[GO.sunDir], g[GO.sunDir + 1], g[GO.sunDir + 2]], shadowsOn,
        lists: L.lib.nLists, nSlots: L.lib.slots.length, species: L.lib.protos.length, aerial: aerialOn, farK, treesOn, propsOn: propsOn2 });
      // cloud shadow: rect (x0, z0, size) and the cloud base y; size 0 = none
      const cs = frame.cloudShadow || gpu.cloudShadow || null;
      if (cs && cs.view) {
        if (!cloud || cloud.view !== cs.view) { cloud = { view: cs.view, sampler: cs.sampler || litSampler }; L.renderBG = L.makeRenderBG(); grassRBG = makeGrassRBG(); }
      } else if (cloud) { cloud = null; L.renderBG = L.makeRenderBG(); grassRBG = makeGrassRBG(); }
      let cr = [0, 0, 0, 0];
      if (cloud) { try { const r = cs.rect(); cr = [r[0], r[1], r[2], cs.base()]; } catch { cr = [0, 0, 0, 0]; } }
      params.set(cr, 24);
      queue.writeBuffer(paramBuf, 0, params);
      // grass rings
      gparams.fill(0);
      for (let l = 0; l < 4; l++) {
        const sp = grassD * (1 << l), R = grassR0 * (1 << l);
        const bx = Math.floor((cam[0] - R) / sp) * (1 << l), bz = Math.floor((cam[2] - R) / sp) * (1 << l);
        gparams.set([bx, bz, sp, R], l * 4);
      }
      gparams.set([grassN, grassD, grassCap, q], 16);
      gparams.set([cam[0], cam[1], cam[2], g[GO.camPos + 3]], 20);
      gparams.set([1, 1, grassR0, shadowsOn], 24);
      gparams.set([aerialOn ? 1 : 0, 0, 0, 0], 28);
      gparams.set(cr, 32);
      queue.writeBuffer(gparamBuf, 0, gparams);
      queue.writeBuffer(gargsBuf, 0, new Uint32Array([11, 0, 0, 0]));
      if (snapAll) { snapList = []; for (let p = 0; p < highPage; p++) snapList.push(p); snapAll = false; }
    },
    compute(enc, frame) {
      const g0 = gpu.globalsBindGroup;
      if (!g0) return;
      if (grassOn && field) {
        const c = enc.beginComputePass({ label: 'veg grass' });
        c.setBindGroup(0, g0); c.setBindGroup(1, grassCBG);
        // ring 0 first: the near blades take the buffer slots before the far ones
        for (let l = 0; l < 4; l++) { c.setPipeline(pBlades[l]); c.dispatchWorkgroups(grassN / 8, grassN / 8, 1); }
        c.setPipeline(pFinal); c.dispatchWorkgroups(1);
        c.end();
      }
      if (!propsOn || !highPage) return;
      enc.clearBuffer(L.countsBuf);
      const c = enc.beginComputePass({ label: 'veg props' });
      c.setBindGroup(0, g0); c.setBindGroup(1, L.computeBG);
      if (snapList.length) {
        queue.writeBuffer(pagesBuf, 0, new Uint32Array(snapList));
        // pagesBuf length is fixed: pages past snapList repeat page 0 (harmless)
        c.setPipeline(pSnap); c.dispatchWorkgroups(Math.ceil(snapList.length * PAGE / 256));
        snapList = [];
      }
      const wg = Math.ceil(highPage * PAGE / 256);
      c.setPipeline(pCount); c.dispatchWorkgroups(wg);
      c.setPipeline(pScan); c.dispatchWorkgroups(1);
      c.setPipeline(pEmit); c.dispatchWorkgroups(wg);
      c.end();
    },
    drawShadow(pass, frame) {
      if (!propsOn || !highPage || !L) return;
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(1, L.renderBG);
      pass.setVertexBuffer(0, L.vbuf); pass.setIndexBuffer(L.ibuf, 'uint32');
      let cur = null;
      for (const s of L.shadowSlots) {
        const pipe = s.kind === 'impsh' ? pShImp : s.kind === 'leaf' ? pShLeaf : pShOpaque;
        if (pipe !== cur) { pass.setPipeline(pipe); cur = pipe; }
        pass.setBindGroup(3, L.drawBG, [s.k * 256]);
        pass.drawIndexedIndirect(L.argsBuf, s.k * 20);
      }
    },
    drawOpaque(pass, frame) {
      const g0 = gpu.globalsBindGroup;
      if (!g0) return;
      pass.setBindGroup(0, g0);
      if (propsOn && highPage && L) {
        pass.setBindGroup(1, L.renderBG);
        pass.setVertexBuffer(0, L.vbuf); pass.setIndexBuffer(L.ibuf, 'uint32');
        let cur = null;
        for (const s of L.cameraSlots) {
          const pipe = s.kind === 'imp' ? pImp : s.kind === 'leaf' ? pLeaf : pBark;
          if (pipe !== cur) { pass.setPipeline(pipe); cur = pipe; }
          pass.setBindGroup(3, L.drawBG, [s.k * 256]);
          pass.drawIndexedIndirect(L.argsBuf, s.k * 20);
        }
      }
      if (grassOn && field) {
        pass.setPipeline(pGrass);
        pass.setBindGroup(1, grassRBG);
        pass.drawIndirect(gargsBuf, 0);
      }
    },
    resize() {},
    // as GROUND: off when the SKY haze (drawVolumetric) does the aerial perspective
    setAerial(on) { aerialOn = !!on; },
    setEnabled(o = {}) { if ('grass' in o) grassOn = !!o.grass; if ('props' in o) propsOn = !!o.props; },
    stats() { return { ...stats, protos: L.lib.protos.length, assets: assetsState, streamPending: stream ? stream.pending : 0 }; },
    dispose() {
      destroyLib(); matTex?.destroy();
      for (const b of [instBuf, visBuf, pagesBuf, paramBuf, bladeBuf, gargsBuf, gparamBuf]) b.destroy();
    },
    // for tests and the Deno render check
    _internal: { get L() { return L; }, get matTex() { return matTex; }, urlLayers, tiles, get field() { return field; } },
  };
  return mod;
}

// Globals float offsets (shaders/common.wgsl struct Globals)
const GO = { viewProj: 0, invViewProj: 16, view: 32, proj: 48, prevViewProj: 64, camPos: 80, sunDir: 84, sunColor: 88, moonDir: 92,
  ambient: 96, fog: 100, wind: 104, weather: 108, weather2: 112, terrain: 116, terrainOrigin: 120, screen: 124, frame: 128 };
