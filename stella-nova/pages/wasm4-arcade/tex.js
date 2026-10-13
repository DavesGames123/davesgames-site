// ============================================================================
//  WASM-4 ARCADE  ·  tex.js — canvas helpers for the 3D room textures
// ----------------------------------------------------------------------------
//  Every texture of the room is drawn on a 2D canvas at load time (no image
//  files). These helpers make the canvas and wrap it as a three.js texture.
//  In node the tests give a stub document, so the same code builds there.
//
//    makeCanvas(w, h)               a canvas of w x h px
//    canvasTex(THREE, cv, o)        a CanvasTexture, sRGB, anisotropy 4;
//                                   o.repeat = [u, v] sets RepeatWrapping
//    noise2(seed)                   a smooth value noise f(x, y) -> 0..1
//
//  grep -n targets  "export function makeCanvas"  "export function canvasTex"
//                   "export function noise2"
// ============================================================================
import { rng } from './attract.js';

export { rng };

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTex(THREE, cv, o = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = o.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
  return t;
}

// Value noise on a 64 x 64 lattice that wraps, smoothstep interpolation.
export function noise2(seed = 1) {
  const r = rng(seed), N = 64, g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x, y) => g[((y % N + N) % N) * N + ((x % N + N) % N)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}
