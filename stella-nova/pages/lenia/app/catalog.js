// ============================================================================
//  LENIA  ·  app/catalog.js — creature records from creatures.json
// ----------------------------------------------------------------------------
//  Pure helpers on one catalog record: its family label and color, its
//  start cells as a float patch, a quarter turn of a patch, and the 256
//  rgb entries of a palette for 2D canvas work. No DOM.
//
//  GREP MAP
//    function familyOf      the family label of a record
//    function familyColor   a stable hsl color per family
//    function cellsOf       the start cells, decoded once per record
//    function rotate        q quarter turns of a patch
//    function lut           palette -> Uint8ClampedArray(256 * 3)
// ============================================================================
import { paletteData } from '../engine.js';

// Family label: the family rank, or the next rank up when the family rank is
// empty or a note in parentheses.
export function familyOf(c) {
  for (const k of [2, 1, 0]) { const r = c.rank[k]; if (r && !r.startsWith('(')) return r; }
  return 'Other';
}
const famCache = new Map();
export function familyColor(f) {
  if (famCache.has(f)) return famCache.get(f);
  let h = 0;
  for (const ch of f) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const col = `hsl(${(h * 137.5) % 360} 62% 62%)`;
  famCache.set(f, col);
  return col;
}

// Start cells as a float patch, decoded once per creature.
const cellCache = new Map();
export function cellsOf(c) {
  if (cellCache.has(c.id)) return cellCache.get(c.id);
  const bin = atob(c.cells);
  const data = new Float32Array(c.w * c.h);
  for (let i = 0; i < data.length; i++) data[i] = bin.charCodeAt(i) / 255;
  const p = { w: c.w, h: c.h, data };
  cellCache.set(c.id, p);
  return p;
}
export function rotate(p, q) {
  let out = p;
  for (let k = 0; k < q; k++) {
    const r = { w: out.h, h: out.w, data: new Float32Array(out.data.length) };
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) r.data[x * r.w + (out.h - 1 - y)] = out.data[y * out.w + x];
    out = r;
  }
  return out;
}

// 256 rgb entries of a palette as css colors, for 2D canvas work.
const lutCache = new Map();
export function lut(name) {
  if (lutCache.has(name)) return lutCache.get(name);
  const d = paletteData(name);
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(d[i * 4 + c] * 255);
  lutCache.set(name, out);
  return out;
}
