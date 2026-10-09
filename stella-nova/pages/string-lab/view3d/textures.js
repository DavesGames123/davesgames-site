// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · view3d/textures.js — procedural wood and inlay textures
// ────────────────────────────────────────────────────────────────────────────
//  Every texture is a DataTexture that this file computes from value noise.
//  No image file is loaded, so the 3D view runs in node (headless-gl) the
//  same as in a browser. The grain runs along u. The instrument models map
//  u to the long axis (x) of each part.
//
//  The sizes are powers of two, so WebGL 1 can make mipmaps. Each texture
//  is made once and cached by name.
//
//  SECTION MAP   (grep -n "<anchor>" textures.js)
//    noise ................ "function vnoise"
//    texture factory ...... "function makeTex"
//    woods ................ "spruce:", "rosewood:", "mahogany:", "ebony:",
//                           "maple:", "flame:", "violinTop:"
//    other ................ "rosette:", "tortoise:", "pearl:"
//    public getter ........ "export function texture"
// ════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// periodic value noise: px, py = period in cells (so the texture tiles)
function vnoise(x, y, px, py, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, px, py, oct = 4, s = 0) {
  let v = 0, amp = 0.5, n = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * vnoise(x, y, px, py, s + o * 17);
    n += amp; amp *= 0.5; x *= 2; y *= 2; px *= 2; py *= 2;
  }
  return v / n;
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
function mixRGB(c0, c1, t, out) {
  out[0] = mix(c0[0], c1[0], t); out[1] = mix(c0[1], c1[1], t); out[2] = mix(c0[2], c1[2], t);
  return out;
}

function makeTex(w, h, fn, { repeat = true } = {}) {
  const data = new Uint8Array(w * h * 4);
  const c = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn(x / w, y / h, c);
      const i = (y * w + x) * 4;
      data[i] = clamp01(c[0]) * 255; data[i + 1] = clamp01(c[1]) * 255; data[i + 2] = clamp01(c[2]) * 255; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// straight grain: stripes across v, warped a little by noise
function grain(u, v, lines, warp, seed) {
  const w = fbm(u * 4, v * 8, 4, 8, 3, seed) - 0.5;
  const p = (v + w * warp) * lines;
  const f = p - Math.floor(p);
  // late wood: a sharp dark band at the end of each year ring
  return f < 0.72 ? Math.pow(f / 0.72, 4) * 0.35 : f < 0.9 ? 0.35 + 0.65 * Math.sin(((f - 0.72) / 0.18) * Math.PI / 2) : 1 - (f - 0.9) * 10;
}

const RECIPES = {
  // spruce top: pale honey, fine straight grain, silk (medullary) flecks
  spruce: () => makeTex(1024, 1024, (u, v, c) => {
    const g = grain(u, v, 70, 0.012, 1);
    const n = fbm(u * 8, v * 32, 8, 32, 3, 2);
    const silk = Math.max(0, fbm(u * 32, v * 4, 32, 4, 2, 3) - 0.62) * 1.6;
    mixRGB([0.86, 0.69, 0.45], [0.63, 0.43, 0.22], g * 0.8 + (n - 0.5) * 0.3, c);
    c[0] += silk * 0.08; c[1] += silk * 0.07; c[2] += silk * 0.05;
  }),
  // violin top: spruce under an amber-orange varnish
  violinTop: () => makeTex(1024, 1024, (u, v, c) => {
    const g = grain(u, v, 56, 0.012, 4);
    const n = fbm(u * 6, v * 6, 6, 6, 4, 5);
    mixRGB([0.80, 0.42, 0.13], [0.48, 0.19, 0.05], g * 0.55 + (n - 0.5) * 0.7, c);
  }),
  // rosewood back and sides: dark red-brown with open, wavy streaks
  rosewood: () => makeTex(512, 512, (u, v, c) => {
    const w = fbm(u * 2, v * 8, 2, 8, 4, 7);
    const p = (v + (w - 0.5) * 0.08) * 34;
    const s = 0.5 + 0.5 * Math.sin(p * Math.PI * 2 + 3 * fbm(u * 6, v * 30, 6, 30, 2, 21));
    const n = fbm(u * 24, v * 96, 24, 96, 2, 8);
    mixRGB([0.33, 0.15, 0.08], [0.11, 0.045, 0.025], Math.pow(s, 2) * 0.75 + (n - 0.5) * 0.45, c);
  }),
  // mahogany neck: warm red-brown, ribbon figure
  mahogany: () => makeTex(256, 256, (u, v, c) => {
    const g = grain(u, v, 30, 0.08, 9);
    const rib = 0.5 + 0.5 * Math.sin((v * 10 + fbm(u * 2, v * 2, 2, 2, 2, 10)) * Math.PI * 2);
    mixRGB([0.55, 0.27, 0.14], [0.33, 0.14, 0.07], g * 0.5 + rib * 0.3, c);
  }),
  // ebony: near black, a faint brown streak
  ebony: () => makeTex(256, 256, (u, v, c) => {
    const g = grain(u, v, 28, 0.1, 11);
    const n = fbm(u * 4, v * 16, 4, 16, 3, 12);
    const k = 0.07 + n * 0.05 - g * 0.03;
    c[0] = k * 1.15; c[1] = k * 0.95; c[2] = k * 0.85;
  }),
  // plain maple (bridge): pale cream, fine flecks
  maple: () => makeTex(256, 256, (u, v, c) => {
    const g = grain(u, v, 36, 0.05, 13);
    const fl = Math.max(0, fbm(u * 40, v * 6, 40, 6, 2, 14) - 0.6) * 1.2;
    mixRGB([0.92, 0.84, 0.68], [0.78, 0.66, 0.47], g * 0.5 + fl * 0.4, c);
  }),
  // flamed maple under varnish (violin back, ribs, neck, scroll):
  // bright and dark flame bands run across the grain (along u)
  flame: () => makeTex(512, 512, (u, v, c) => {
    const w = fbm(u * 3, v * 2, 3, 2, 3, 15);
    const band = 0.5 + 0.5 * Math.sin((u * 26 + v * 3 + (w - 0.5) * 2.4) * Math.PI * 2);
    const g = grain(u, v, 34, 0.04, 16);
    const n = fbm(u * 5, v * 5, 5, 5, 4, 17);
    const t = Math.pow(band, 1.6) * 0.55 + g * 0.2 + (n - 0.5) * 0.45;
    mixRGB([0.88, 0.47, 0.15], [0.47, 0.18, 0.05], t, c);
  }),
  // soundhole rosette: concentric rings, a mosaic band in the middle.
  // u, v are the planar UVs of RingGeometry (centre at 0.5, 0.5).
  rosette: () => makeTex(512, 512, (u, v, c) => {
    const x = u - 0.5, y = v - 0.5;
    const r = Math.hypot(x, y) * 2; // 0 at centre, 1 at the outer radius
    const a = Math.atan2(y, x);
    const rings = [[0.70, 0.735, 0.05], [0.745, 0.76, 0.9], [0.77, 0.79, 0.05], [0.90, 0.915, 0.05], [0.92, 0.935, 0.9], [0.945, 0.97, 0.05]];
    let k = null;
    for (const [r0, r1, val] of rings) if (r >= r0 && r < r1) k = val;
    if (k != null) { c[0] = k * 0.98 + 0.02; c[1] = k * 0.93 + 0.02; c[2] = k * 0.82 + 0.02; return; }
    if (r >= 0.79 && r < 0.90) {
      // herringbone-like mosaic: alternating tiles in angle and radius
      const ta = Math.floor((a / (Math.PI * 2) + 0.5) * 240);
      const tr = Math.floor((r - 0.79) / 0.11 * 7);
      const chk = (ta + tr) & 1;
      const z = fbm(u * 64, v * 64, 64, 64, 1, 18) * 0.15;
      if (chk) { c[0] = 0.62 + z; c[1] = 0.34 + z; c[2] = 0.16 + z; } else { c[0] = 0.93 - z; c[1] = 0.88 - z; c[2] = 0.74 - z; }
      return;
    }
    c[0] = 0.85; c[1] = 0.72; c[2] = 0.5; // spruce colour between rings
  }, { repeat: false }),
  // tortoise pickguard: mottled dark amber
  tortoise: () => makeTex(256, 256, (u, v, c) => {
    const n = fbm(u * 14, v * 14, 14, 14, 5, 19);
    const m = Math.pow(clamp01((n - 0.35) * 2.2), 1.4);
    mixRGB([0.07, 0.03, 0.02], [0.55, 0.26, 0.07], m, c);
  }),
  // abalone-free pearl: soft white with a faint pink and green shimmer
  pearl: () => makeTex(128, 128, (u, v, c) => {
    const n = fbm(u * 4, v * 4, 4, 4, 3, 20);
    c[0] = 0.92 + 0.06 * Math.sin(n * 12); c[1] = 0.92 + 0.05 * Math.sin(n * 12 + 2); c[2] = 0.9 + 0.06 * Math.sin(n * 12 + 4);
  }),
  // dark soundhole: radial falloff to black
  hole: () => makeTex(128, 128, (u, v, c) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const k = 0.02 + 0.09 * clamp01(r);
    c[0] = k * 1.2; c[1] = k * 0.85; c[2] = k * 0.6;
  }, { repeat: false }),
};

const cache = new Map();
/** Cached DataTexture by name (see RECIPES). */
export function texture(name) {
  if (!cache.has(name)) cache.set(name, RECIPES[name]());
  return cache.get(name);
}
export const TEXTURE_NAMES = Object.keys(RECIPES);
/** Free the GPU copies (the view calls this on dispose). */
export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
