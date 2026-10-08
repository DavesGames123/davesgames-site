// ============================================================================
//  VIRUS ATLAS  ·  pack.js — the GPU texture layout of a part (no three.js)
// ----------------------------------------------------------------------------
//  view.js uploads these arrays as RGBA32F textures, 2048 texels per row.
//  The vertex shader (view.js BEAD_VS) reads them back by instance:
//    copy k = floor(i / nb), bead b = (i - k nb) * stride
//    beads[b]      x y z (nm, AU frame), w = chain + 4096 * flags
//    ops[3k + r]   row r of the 3x4 operator of copy k
//    units[2u]     unit centroid + assembly delay, u = k * nChains + chain
//    units[2u + 1] flight direction + sway phase of copy k
//    sel[2u]       saver explode direction + stagger key (regions.js)
//    sel[2u + 1]   away direction + selected flag (1: in the region)
//  instanceWorld() is the same index arithmetic in JS (no animation
//  offsets), so tests.mjs can check that the GPU expansion gives each
//  copy of each bead exactly once.
//
//  grep -n targets: "export const ROW", "export function packBeads",
//    "export function packOps", "export function packUnits",
//    "export function packSel", "export function instanceWorld"
// ============================================================================
export const ROW = 2048;
const rowsFor = n => Math.max(1, Math.ceil(n / ROW));

export function packBeads(d) {
  const a = new Float32Array(ROW * rowsFor(d.n) * 4);
  for (let i = 0; i < d.n; i++) {
    a[4 * i] = d.pos[3 * i]; a[4 * i + 1] = d.pos[3 * i + 1]; a[4 * i + 2] = d.pos[3 * i + 2];
    a[4 * i + 3] = d.chain[i] + 4096 * d.flags[i];
  }
  return a;
}
export function packOps(ops) {
  const m = ops.length / 12, a = new Float32Array(ROW * rowsFor(3 * m) * 4);
  for (let k = 0; k < m; k++) for (let r = 0; r < 3; r++) for (let j = 0; j < 4; j++) a[4 * (3 * k + r) + j] = ops[12 * k + 4 * r + j];
  return a;
}
export function packUnits(cent, delays, dirs, nc, phase) {
  const U = cent.length / 3, a = new Float32Array(ROW * rowsFor(2 * U) * 4);
  for (let u = 0; u < U; u++) {
    a[8 * u] = cent[3 * u]; a[8 * u + 1] = cent[3 * u + 1]; a[8 * u + 2] = cent[3 * u + 2]; a[8 * u + 3] = delays[u];
    a[8 * u + 4] = dirs[3 * u]; a[8 * u + 5] = dirs[3 * u + 1]; a[8 * u + 6] = dirs[3 * u + 2];
    a[8 * u + 7] = phase ? phase[Math.floor(u / nc)] : 0;
  }
  return a;
}
// t: regions.js selTable { dirs, keys, sel, away }; out: an array to
// fill again (the same size), so a new shot does not make a new texture
export function packSel(t, out) {
  const U = t.keys.length, a = out || new Float32Array(ROW * rowsFor(2 * U) * 4);
  for (let u = 0; u < U; u++) {
    a[8 * u] = t.dirs[3 * u]; a[8 * u + 1] = t.dirs[3 * u + 1]; a[8 * u + 2] = t.dirs[3 * u + 2]; a[8 * u + 3] = t.keys[u];
    a[8 * u + 4] = t.away[3 * u]; a[8 * u + 5] = t.away[3 * u + 1]; a[8 * u + 6] = t.away[3 * u + 2]; a[8 * u + 7] = t.sel[u];
  }
  return a;
}
// texel index -> the flat array offset, as texelFetch(ivec2(i & 2047, i >> 11))
const at = i => 4 * ((i >> 11) * ROW + (i & 2047));
export function instanceWorld(i, beads, ops, nb, stride) {
  const k = Math.floor(i / nb), b = (i - k * nb) * stride;
  const p = at(b), code = Math.round(beads[p + 3]);
  const x = beads[p], y = beads[p + 1], z = beads[p + 2], w = [0, 0, 0];
  for (let r = 0; r < 3; r++) { const o = at(3 * k + r); w[r] = ops[o] * x + ops[o + 1] * y + ops[o + 2] * z + ops[o + 3]; }
  return { k, b, chain: code & 4095, flags: code >> 12, w };
}
