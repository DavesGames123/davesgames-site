// ============================================================================
//  VIRUS ATLAS  ·  trace.js — per-bead extras: chain links, burial, spline
// ----------------------------------------------------------------------------
//  No DOM and no three.js: tests.mjs runs this file in Node.
//
//  AUX TEXTURE  packAux(d, ops) gives one RGBA8 texel per bead of the
//  asymmetric unit (AU), in the same layout as pack.js packBeads:
//    r  burial 0..255: neighbours within BURY_NM over the AU and its near
//       copies, scaled between the 10th and 95th percentile. The space
//       and toon views darken buried beads with it (a baked occlusion).
//    g  the place of the bead along its chain, 0 (N end) .. 255 (C end).
//       The rainbow colours and the tube growth read it.
//    b  the count of chain breaks before the bead, mod 256. Two beads are
//       in one unbroken run when their counts match (the tube shader
//       never spans a stride of 256 beads, so the mod is safe).
//    a  ribbon weight: helix or strand, smoothed over the neighbours, so
//       a tube widens into a flat ribbon and tapers at the ends.
//  A break is a change of chain, or a gap longer than LINK_NM between
//  two amino acids (LINK_NUC_NM for nucleotides and sugars), which is a
//  run of residues missing from the model.
//
//  SPLINE  catmull(p0, p1, p2, p3, t) is the uniform Catmull-Rom curve the
//  tube vertex shader (glsl.js TUBE_VS) evaluates: it passes through p1
//  at t = 0 and p2 at t = 1. tubeSegments(d, aux, stride) lists the
//  segments the shader draws, with its end rules (a missing neighbour
//  is the mirror point), so tests.mjs can check the curve in Node.
//
//  grep -n targets: "export function breaks", "export function burial",
//    "export function packAux", "export function setBurial", "export function catmull",
//    "export function tubeSegments", "export function sameRun"
// ============================================================================
import { ROW } from './pack.js';

export const LINK_NM = 0.45;       // CA-CA is 0.38 nm (0.29 nm cis)
export const LINK_NUC_NM = 0.8;    // P-P 0.59-0.7 nm, sugar C1-C1 about 0.55 nm
export const BURY_NM = 1.0;

// brk[i] = 1 when bead i starts a new run (first bead, a new chain, a gap)
export function breaks(d) {
  const n = d.n, brk = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || d.chain[i] !== d.chain[i - 1]) { brk[i] = 1; continue; }
    const cA = (d.flags[i] >> 2) & 7, cB = (d.flags[i - 1] >> 2) & 7;
    const lim = cA >= 5 || cB >= 5 ? LINK_NUC_NM : LINK_NM;
    const dx = d.pos[3 * i] - d.pos[3 * i - 3], dy = d.pos[3 * i + 1] - d.pos[3 * i - 2], dz = d.pos[3 * i + 2] - d.pos[3 * i - 1];
    if (dx * dx + dy * dy + dz * dz > lim * lim) brk[i] = 1;
  }
  return brk;
}

// 0..1 along each chain (by the order of its beads in the file)
export function chainFrac(d) {
  const nc = d.info.chains.length, cnt = new Uint32Array(nc), seen = new Uint32Array(nc), out = new Float32Array(d.n);
  for (let i = 0; i < d.n; i++) cnt[d.chain[i]]++;
  for (let i = 0; i < d.n; i++) { const c = d.chain[i]; out[i] = cnt[c] > 1 ? seen[c]++ / (cnt[c] - 1) : 0; }
  return out;
}

// Neighbour counts of the AU beads over the AU and the copies near it.
// A spatial hash with cells of BURY_NM: collisions only add checks.
export function burial(d, ops, cut = BURY_NM) {
  const n = d.n, m = Math.max(1, ops.length / 12);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += d.pos[3 * i]; cy += d.pos[3 * i + 1]; cz += d.pos[3 * i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let rA = 0;
  for (let i = 0; i < n; i++) rA = Math.max(rA, Math.hypot(d.pos[3 * i] - cx, d.pos[3 * i + 1] - cy, d.pos[3 * i + 2] - cz));
  // the AU frame is copy 0 only when op 0 is the identity: work in world
  // space for every copy and take copy 0 as the query set
  const near = [];
  const w = (k, x, y, z) => { const o = 12 * k; return [ops[o] * x + ops[o + 1] * y + ops[o + 2] * z + ops[o + 3], ops[o + 4] * x + ops[o + 5] * y + ops[o + 6] * z + ops[o + 7], ops[o + 8] * x + ops[o + 9] * y + ops[o + 10] * z + ops[o + 11]]; };
  const c0 = w(0, cx, cy, cz);
  for (let k = 0; k < m; k++) { const c = w(k, cx, cy, cz); if (Math.hypot(c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]) < 2 * rA + cut) near.push(k); }
  const np = near.length * n, P = new Float32Array(3 * np);
  near.forEach((k, j) => { for (let i = 0; i < n; i++) P.set(w(k, d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]), 3 * (j * n + i)); });
  const bits = Math.min(22, Math.max(10, Math.ceil(Math.log2(np * 2)))), size = 1 << bits, mask = size - 1;
  const cell = (x, y, z) => ((Math.imul(Math.floor(x / cut), 73856093) ^ Math.imul(Math.floor(y / cut), 19349663) ^ Math.imul(Math.floor(z / cut), 83492791)) >>> 0) & mask;
  const head = new Int32Array(size).fill(-1), next = new Int32Array(np);
  for (let p = 0; p < np; p++) { const h = cell(P[3 * p], P[3 * p + 1], P[3 * p + 2]); next[p] = head[h]; head[h] = p; }
  const q0 = near.indexOf(0), cnt = new Float32Array(n), c2 = cut * cut, done = new Int32Array(27);
  for (let i = 0; i < n; i++) {
    const p = (q0 < 0 ? 0 : q0) * n + i, x = P[3 * p], y = P[3 * p + 1], z = P[3 * p + 2];
    const gx = Math.floor(x / cut), gy = Math.floor(y / cut), gz = Math.floor(z / cut);
    let c = 0, nd = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
      const h = ((Math.imul(gx + a, 73856093) ^ Math.imul(gy + b, 19349663) ^ Math.imul(gz + e, 83492791)) >>> 0) & mask;
      let dup = false;
      for (let t = 0; t < nd; t++) if (done[t] === h) { dup = true; break; }
      if (dup) continue;
      done[nd++] = h;
      for (let q = head[h]; q >= 0; q = next[q]) {
        if (q === p) continue;
        const dx = P[3 * q] - x, dy = P[3 * q + 1] - y, dz = P[3 * q + 2] - z;
        if (dx * dx + dy * dy + dz * dz <= c2) c++;
      }
    }
    cnt[i] = c;
  }
  // scale between the 10th and 95th percentile
  const s = Float32Array.from(cnt).sort(), lo = s[Math.floor(0.1 * (n - 1))], hi = s[Math.floor(0.95 * (n - 1))];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = hi > lo ? Math.min(1, Math.max(0, (cnt[i] - lo) / (hi - lo))) : 0.5;
  return out;
}

// helix or strand, smoothed within a run (0.25 0.5 0.25)
export function ribbon(d, brk) {
  const n = d.n, raw = new Float32Array(n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = (d.flags[i] & 3) ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const a = i > 0 && !brk[i] ? raw[i - 1] : raw[i], b = i < n - 1 && !brk[i + 1] ? raw[i + 1] : raw[i];
    out[i] = 0.25 * a + 0.5 * raw[i] + 0.25 * b;
  }
  return out;
}

// RGBA8, ROW texels per row. bur: a burial array, or null to leave 0.5
// for now (setBurial fills it later: the hash takes about 0.5 s on the
// 313 k beads of the HIV cone, so view.js runs it only when a view needs it).
export function packAux(d, ops, bur) {
  const n = d.n, rows = Math.max(1, Math.ceil(n / ROW)), a = new Uint8Array(ROW * rows * 4);
  const brk = breaks(d), fr = chainFrac(d), rb = ribbon(d, brk), b = bur === undefined ? burial(d, ops) : bur;
  let pre = 0;
  for (let i = 0; i < n; i++) {
    pre = (pre + brk[i]) & 255;
    a[4 * i] = b ? Math.round(b[i] * 255) : 128; a[4 * i + 1] = Math.round(fr[i] * 255);
    a[4 * i + 2] = pre; a[4 * i + 3] = Math.round(rb[i] * 255);
  }
  return a;
}

// a short key of an operator set: view.js caches burial on the data by it
export const opsKey = ops => ops.length + ':' + Array.from(ops.subarray(0, 24), v => v.toFixed(3)).join(',');

export function setBurial(aux, bur) { for (let i = 0; i < bur.length; i++) aux[4 * i] = Math.round(bur[i] * 255); return aux; }

// Beads i and j (i < j) are in one run: same chain and the same break count.
export function sameRun(aux, d, i, j) {
  return i >= 0 && j < d.n && d.chain[i] === d.chain[j] && aux[4 * i + 2] === aux[4 * j + 2];
}

export function catmull(p0, p1, p2, p3, t, out = [0, 0, 0]) {
  const t2 = t * t, t3 = t2 * t;
  for (let c = 0; c < 3; c++) {
    out[c] = 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
  }
  return out;
}

// The segments the tube shader draws for one copy: segment j joins beads
// j*s and j*s + s when they are in one run. The end neighbours are the
// mirror points (2 p1 - p2, 2 p2 - p1) when the run ends there.
export function tubeSegments(d, aux, s = 1) {
  const P = i => [d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]], out = [];
  const nSeg = Math.ceil(d.n / s);
  for (let j = 0; j < nSeg; j++) {
    const b1 = j * s, b2 = b1 + s;
    if (b2 >= d.n || !sameRun(aux, d, b1, b2)) continue;
    const p1 = P(b1), p2 = P(b2);
    const p0 = sameRun(aux, d, b1 - s, b1) ? P(b1 - s) : p1.map((v, c) => 2 * v - p2[c]);
    const p3 = b2 + s < d.n && sameRun(aux, d, b2, b2 + s) ? P(b2 + s) : p2.map((v, c) => 2 * v - p1[c]);
    out.push({ j, b1, b2, p0, p1, p2, p3 });
  }
  return { nSeg, segs: out };
}
