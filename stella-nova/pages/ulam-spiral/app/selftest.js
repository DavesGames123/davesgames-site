// ============================================================================
//  ULAM SPIRAL  ·  app/selftest.js — the GPU maps against layouts.js
// ----------------------------------------------------------------------------
//  window.__ulam.selfTest() (main.js) runs in the page, with the real
//  renderer: 1. gPos (glsl.js) against posOf (layouts.js) for every shape:
//  n from the start, and spread to 10^6.  2. the debug index pass against
//  nAt for every lattice shape.  3. the class pass against classify().
//  4. boxTest: the zoomed-out density against an exact count.
//
//  GREP MAP
//    grep -n 'export async function selfTest'  the four checks, one report
//    grep -n 'function boxTest'                zoomed-out density vs a count
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';
import { S, rt } from './state.js';
import { MODES } from './palettes.js';
import { frameState } from './frame.js';
import { isPrimeN } from './numbers.js';

const M = T.MODE;

export async function selfTest() {
  const R = rt.R;
  const out = { pos: {}, idx: {}, cls: {}, box: {}, ok: true };
  const v = { w: 96, h: 96, cx: 48, cy: 48, cw: 96, ch: 96 };
  const P0 = { ...S.P };
  for (const sh of L.SHAPES) {
    const st = L.startOf(sh, S.P);
    let worst = 0;
    for (const [n0, step] of [[st, 1], [st + 1000, 997]]) {
      const cnt = 1000, got = R.tfPositions(frameState(v), sh.id, n0, step, cnt);
      for (let i = 0; i < cnt; i++) {
        const n = n0 + i * step, p = L.posOf(sh, n, S.P), w = L.isLattice(sh) ? [...L.worldOf(sh, p[0], p[1]), 0] : p;
        const e = Math.hypot(got[3 * i] - w[0], got[3 * i + 1] - w[1], got[3 * i + 2] - (w[2] || 0)) / (1 + Math.hypot(...w) * 1e-3);
        worst = Math.max(worst, e);
      }
    }
    out.pos[sh.key] = +worst.toExponential(2);
    if (!(worst < 0.02)) out.ok = false;
  }
  for (const sh of L.SHAPES.filter(L.isLattice)) {
    let bad = 0, tot = 0;
    for (const [cx, cy, z] of [[0.3, 0.2, 6], [37.4, -21.6, 3], [-140.2, 95.7, 2]]) {
      const cam = { x: cx + (sh.key === 'rows' || sh.key === 'snake' ? 10 : 0), y: sh.key === 'rows' || sh.key === 'snake' ? -Math.abs(cy) : cy, z };
      if (['hilbert', 'zorder', 'cantor'].includes(sh.key)) { cam.x = Math.abs(cam.x) + 50; cam.y = Math.abs(cam.y) + 50; }
      const fs = frameState(v, { shape: sh, cam, dpr: 1, tileOn: false, walk: null });
      const k = R.readIndex(fs, v.w, v.h);
      for (let py = 0; py < v.h; py += 3) for (let px = 0; px < v.w; px += 3) {
        // the pixel centre, as the shader sees it (y from the bottom)
        const sx = px + 0.5, sy = py + 0.5;
        const wl = [cam.x - fs.base.wx + (sx - fs.center[0]) / z, cam.y - fs.base.wy + (sy - fs.center[1]) / z];
        // the same cell rounding as cellOf, from the local offset
        const cl = L.cellAt(sh, fs.base.wx + wl[0], fs.base.wy + wl[1]);
        const want = L.nAt(sh, S.P, cl[0], cl[1]);
        const wk = want < 0 ? -1 : want - L.startOf(sh, S.P);
        tot++; if (k[py * v.w + px] !== wk) bad++;
      }
    }
    out.idx[sh.key] = `${bad}/${tot}`;
    if (bad > tot * 0.002) out.ok = false;
  }
  if (S.bits) {
    for (const mode of [M.primes, M.twin, M.sophie, M.figurate, M.gauss]) {
      const sh = mode === M.gauss ? L.SHAPE.gauss : L.SHAPE.square;
      const cam = { x: 120.3, y: -64.2, z: 4 };
      const fs = frameState(v, { shape: sh, cam, dpr: 1, tileOn: false, walk: null, mode });
      const px = R.readClass(fs, v.w, v.h);
      let bad = 0, tot = 0;
      for (let py = 1; py < v.h; py += 4) for (let pxx = 1; pxx < v.w; pxx += 4) {
        const sx = pxx + 0.5, sy = py + 0.5;
        const cl = L.cellAt(sh, cam.x + (sx - fs.center[0]) / cam.z, cam.y + (sy - fs.center[1]) / cam.z);
        const n = L.nAt(sh, S.P, cl[0], cl[1]);
        const [a, b] = sh.lattice ? L.latticeNumber(sh, cl[0], cl[1]) : [0, 0];
        const want = T.classify(mode, n, isPrimeN, a, b);
        tot++; if (px[4 * (py * v.w + pxx)] !== want) bad++;
      }
      out.cls[MODES.find(m => m.id === mode).key] = `${bad}/${tot}`;
      if (bad > tot * 0.002) out.ok = false;
    }
    const bt = boxTest();
    out.box = bt.res;
    if (!bt.ok) out.ok = false;
  }
  S.P = P0;
  S.dirty = true;
  return out;
}
// The density d = (mean light) ln(n) gain of the field pass (debug 3, G =
// d / 16) against an exact box count on the CPU: the light of each cell
// (1 for 1 and the primes, 0 else) times the area it shares with the
// pixel footprint (hex: in axial q, r, a footprint pxW by pxW / SQ3). Up
// to boxMax the GPU loops the cells (exact but for 8-bit rounding); past
// it, it reads the pyramid (exact block sums, partial blocks spread
// evenly). Where a block is more than half the footprint (pxW < 2 B0, on
// phones B0 = 8), the pyramid is coarser than the pixel: the mean stays
// exact, the pixels are softer, so that tier checks the bias only.
// pxW 16 and 32 were the old strides of 2 and 4 cells per sample (one
// parity of the checkerboard). pan: the mean d at pxW 16 for camera
// shifts of 0, 0.5, 1 and 1.5 cells (old: 1.8, 0, 0, 1.8).
function boxTest() {
  const R = rt.R;
  const res = {}, v = { w: 64, h: 64, cx: 32, cy: 32, cw: 64, ch: 64 };
  let ok = true;
  const run = (sh, pxW, cx, cy) => {
    const cam = { x: cx, y: cy, z: 1 / pxW };
    const fs = frameState(v, { shape: sh, cam, dpr: 1, tileOn: false, walk: null, mode: M.primes });
    fs.debug = 3;
    R.pyrEnsure(fs, Infinity);
    const px = R.readClass(fs, v.w, v.h);
    const hex = sh.kind === 'hex', hx = pxW / 2, hy = hex ? pxW / (2 * L.SQ3) : pxW / 2;
    let sg = 0, sw = 0, se = 0;
    for (let py = 0; py < v.h; py++) for (let qx = 0; qx < v.w; qx++) {
      const wx = cx + (qx + 0.5 - fs.center[0]) * pxW, wy = cy + (py + 0.5 - fs.center[1]) * pxW;
      const r = hex ? wy / L.SQ3 : wy, q = hex ? wx - r / 2 : wx;
      let acc = 0;
      for (let y = Math.round(r - hy); y <= Math.round(r + hy); y++) {
        const oy = Math.min(r + hy, y + 0.5) - Math.max(r - hy, y - 0.5); if (oy <= 0) continue;
        for (let x = Math.round(q - hx); x <= Math.round(q + hx); x++) {
          const ox = Math.min(q + hx, x + 0.5) - Math.max(q - hx, x - 0.5); if (ox <= 0) continue;
          const n = L.nAt(sh, S.P, x, y);
          if (n === 1 || (n > 1 && isPrimeN(n))) acc += ox * oy;
        }
      }
      const c0 = L.cellAt(sh, wx, wy), nC = Math.max(L.nAt(sh, S.P, c0[0], c0[1]), 3);
      const want = acc / (4 * hx * hy) * Math.log(nC) * fs.gain, got = 16 * px[4 * (py * v.w + qx) + 1] / 255;
      sg += got; sw += want; se += Math.abs(got - want);
    }
    const tier = pxW <= fs.boxMax ? 'cells' : pxW >= 2 * R.pyrInfo().B0 ? 'pyramid' : 'coarse';
    return { mean: sg / (v.w * v.h), bias: (sg - sw) / sw, err: se / sw, tier };
  };
  for (const [key, cx, cy, list] of [['square', 1500.3, -900.7, [1.5, 2, 4, 6, 16, 32]], ['hex', 1200.3, 700.6, [2, 5, 16]]]) {
    for (const pxW of list) {
      const r = run(L.SHAPE[key], pxW, cx, cy);
      const pass = Math.abs(r.bias) < (r.tier === 'cells' ? 0.01 : 0.03) && r.err < (r.tier === 'cells' ? 0.05 : r.tier === 'pyramid' ? 0.15 : 1);
      res[`${key} ${pxW}`] = `${r.tier}: bias ${r.bias.toFixed(3)} err ${r.err.toFixed(3)}${pass ? '' : ' FAIL'}`;
      if (!pass) ok = false;
    }
  }
  const pan = [0, 0.5, 1, 1.5].map(dx => run(L.SHAPE.square, 16, 1500 + dx, -900).mean);
  const spread = (Math.max(...pan) - Math.min(...pan)) / (pan.reduce((a, b) => a + b) / pan.length);
  res.pan16 = `${pan.map(m => m.toFixed(3)).join(' ')} spread ${spread.toFixed(3)}${spread < 0.03 ? '' : ' FAIL'}`;
  if (!(spread < 0.03)) ok = false;
  return { res, ok };
}
