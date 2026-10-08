// ============================================================================
//  STORM GLOBE  ·  coast.js  ·  coastline data: decode, line runs, culling
// ----------------------------------------------------------------------------
//  No DOM, no GPU. The coastlines are Natural Earth land and lake rings
//  (public domain), written by tools/coast.mjs in two levels of detail:
//    data/coast-50m.bin  loaded at boot (land fill, far coastline)
//    data/coast-10m.bin  loaded after the first frame (near coastline)
//  render.js draws the lines as vectors (overlay.wgsl "fn cvs"), so they
//  stay crisp at any altitude; the land fill is a texture (render.js
//  "function drawLand").
//
//  File format (little binary, deltas compress well under gzip):
//    'SGC1', varint ring count, varint Q (units per degree), then per ring
//    varint (points * 2 + kind) and the points as zigzag varint deltas of
//    (lon Q, lat Q) from the previous point (the deltas run on across the
//    rings). kind 0 = land, 1 = lake.
//  The file is read with arrayBuffer(), never sized from content-length
//  (the live site gzips data files).
//
//  buildLines(rings) cuts the rings into runs of at most RUN segments and
//  sorts the runs into CELL_DEG cells, so each cell is one contiguous
//  instance range with a bounding cap; visibleRanges() keeps the cells
//  that touch the camera cap and merges neighbours into few draws.
//
//  grep -n targets: "export function encodeCoast", "export function decodeCoast",
//                   "export function buildLines", "export function visibleRanges",
//                   "export function pickLod", "export function coastStyle"
// ============================================================================
const D = Math.PI / 180;
export const CELL_DEG = 15, RUN = 40;
// the near level of detail shows below LOD_ALT (Earth radii), with hysteresis
export const LOD_ALT = { in: 1.0, out: 1.25 };

// ── varints ──────────────────────────────────────────────────────────────
function putV(a, v) { while (v > 127) { a.push((v & 127) | 128); v = Math.floor(v / 128); } a.push(v); }
const zz = v => (v < 0 ? -2 * v - 1 : 2 * v);
const unzz = u => (u & 1 ? -(u + 1) / 2 : u / 2);

export function encodeCoast(rings, Q = 1000) {
  const a = [0x53, 0x47, 0x43, 0x31];
  putV(a, rings.length); putV(a, Q);
  let px = 0, py = 0;
  for (const r of rings) {
    const n = r.pts.length / 2;
    putV(a, n * 2 + (r.kind ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const x = Math.round(r.pts[i * 2] * Q), y = Math.round(r.pts[i * 2 + 1] * Q);
      putV(a, zz(x - px)); putV(a, zz(y - py)); px = x; py = y;
    }
  }
  return Uint8Array.from(a);
}
export function decodeCoast(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] !== 0x53 || b[1] !== 0x47 || b[2] !== 0x43 || b[3] !== 0x31) throw new Error('coast: bad magic');
  let o = 4;
  const getV = () => { let v = 0, m = 1, c; do { c = b[o++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; };
  const nr = getV(), Q = getV(), rings = [];
  let px = 0, py = 0;
  for (let k = 0; k < nr; k++) {
    const h = getV(), n = Math.floor(h / 2), pts = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { px += unzz(getV()); py += unzz(getV()); pts[i * 2] = px / Q; pts[i * 2 + 1] = py / Q; }
    rings.push({ kind: h & 1, pts });
  }
  if (o !== b.length) throw new Error(`coast: ${b.length - o} bytes left over`);
  return rings;
}

// ── line runs, sorted into cells ─────────────────────────────────────────
// -> { pts: Float32Array (x, y, z, w) per point, w 1 = a segment to the next
//      point, 0 = the end of a run; cells: [{ start, count, c: [x,y,z], r }] }
// A last dummy point keeps the read of point i + 1 in range.
export function buildLines(rings, cellDeg = CELL_DEG, run = RUN) {
  const nc = Math.round(360 / cellDeg), nrow = Math.round(180 / cellDeg);
  const bins = Array.from({ length: nc * nrow }, () => []);
  for (const r of rings) {
    const n = r.pts.length / 2;
    for (let i = 0; i < n - 1; i += run) {
      const j = Math.min(n - 1, i + run);
      const lo = r.pts[i * 2], la = r.pts[i * 2 + 1];
      const cx = Math.min(nc - 1, Math.max(0, Math.floor((lo + 180) / cellDeg))), cy = Math.min(nrow - 1, Math.max(0, Math.floor((la + 90) / cellDeg)));
      bins[cy * nc + cx].push([r.pts, i, j]);
    }
  }
  let total = 1;
  for (const b of bins) for (const [, i, j] of b) total += j - i + 1;
  const pts = new Float32Array(total * 4), cells = [];
  let k = 0;
  for (const b of bins) {
    if (!b.length) continue;
    const start = k; let sx = 0, sy = 0, sz = 0;
    for (const [p, i, j] of b) {
      for (let q = i; q <= j; q++) {
        const lo = p[q * 2] * D, la = p[q * 2 + 1] * D, c = Math.cos(la);
        const x = c * Math.cos(lo), y = c * Math.sin(lo), z = Math.sin(la);
        pts.set([x, y, z, q < j ? 1 : 0], k * 4); k++;
        sx += x; sy += y; sz += z;
      }
    }
    const l = Math.hypot(sx, sy, sz) || 1, cen = [sx / l, sy / l, sz / l];
    let cmin = 1;
    for (let q = start; q < k; q++) cmin = Math.min(cmin, cen[0] * pts[q * 4] + cen[1] * pts[q * 4 + 1] + cen[2] * pts[q * 4 + 2]);
    cells.push({ start, count: k - start, c: cen, r: Math.acos(Math.max(-1, Math.min(1, cmin))) });
  }
  return { pts, cells, points: k };
}
// cells that touch the cap (centre c, angular radius capR rad), merged
// into contiguous [start, count] ranges
export function visibleRanges(cells, c, capR) {
  const out = [];
  for (const q of cells) {
    const ang = Math.acos(Math.max(-1, Math.min(1, q.c[0] * c[0] + q.c[1] * c[1] + q.c[2] * c[2])));
    if (ang > capR + q.r + 0.01) continue;
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === q.start) last[1] += q.count; else out.push([q.start, q.count]);
  }
  return out;
}
// 0 = 50m, 1 = 10m; has10: the near file is loaded
export function pickLod(alt, cur, has10) {
  if (!has10) return 0;
  if (cur === 1) return alt > LOD_ALT.out ? 0 : 1;
  return alt < LOD_ALT.in ? 1 : 0;
}
// line width (CSS px) and alpha of the coast stroke at an altitude
export function coastStyle(alt) {
  const k = Math.max(0, Math.min(1, (alt - 0.5) / 2.5));
  return { width: 1.2 - 0.35 * k, alpha: 0.78 - 0.26 * k };
}
