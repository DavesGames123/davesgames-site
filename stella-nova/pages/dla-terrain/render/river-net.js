// ============================================================================
//  DLA TERRAIN  ·  render/river-net.js — rivers carved finer than the height
//  map (GROUND package, no DOM, no GPU)
// ----------------------------------------------------------------------------
//  WHY (2026-10-18, the user): "the rivers arent carving out something high
//  res enough", "rivers aren't carved out realistically enough", "rivers
//  aren't rendered high0-enough resolution". LIB cuts each river into the
//  height map one texel wide (about 20 m at 20 km and 1024), so a 3 m
//  stream showed as a 40 m wide stair-stepped trench under its water.
//
//  NETWORK  buildRiverNet(t, o) takes the centre lines, widths and water
//  surface of the WATER ribbons (render/water.js buildRiverRibbons, the
//  same call that WATER makes, so the carved channel and the water agree
//  to the row). Each row becomes one vertex of RV floats:
//    0 x  1 z  2 water surface y  3 half width m
//    4 depth m (hydraulic geometry: 0.35 + 0.42 Q^0.4, Q the upstream
//      area km2, to 6 m; width comes from LIB as 2 + 3.2 Q^0.5)
//    5 signed curvature 1/m (+ the bend turns left)
//    6 flow (upstream area km2)  7 flags: 1 = the last row of a river
//  A segment is a vertex and the next one (not when flag 1 is set).
//
//  GRID  rasterNearest(net, gridN, ws, origin) gives for each cell of a
//  gridN^2 grid the index of the nearest segment within its reach (the
//  segment half width x 1.4 + REACH_TEXELS height texels), else NONE. The
//  GPU loads the 3 x 3 cells round a point and takes the exact distance to
//  each named segment and to RIVER_WIN segments each way along the same
//  river (a cell is up to 2 rows long, so a short segment may be named by
//  no cell), so the channel edge is exact at any resolution; the grid only
//  names candidates.
//
//  PROFILE  carveProfile(s, sd, v, hC, texel): s distance to the centre
//  line, sd the signed side (+ left), v the interpolated vertex, hC the
//  coarse surface. In the channel (|sd - thalweg| under the half width) a
//  bowl from the bank lip (water + 0.15 m) to the bed (water - depth); the
//  deepest line moves to the outside of a bend (cut bank, steep) and the
//  inside rises gently (point bar). Out to the valley reach the coarse
//  trench is filled to the bank level, which rises 3 cm per m: a flat
//  floodplain on low ground; a V valley stays a V (its sides are higher
//  than the fill). Past the reach the coarse surface is left as it is.
//  shaders/ground.wgsl fn riverCarve is the GPU twin.
//
//  grep -n targets: "export function buildRiverNet", "export function
//  rasterNearest", "export function carveProfile", "export function
//  carveAt", "export const RV", "export const NONE"
// ============================================================================
import { buildRiverRibbons } from './water.js';

export const RV = 8;
export const NONE = 0xffffffff;
export const RIVER_WIN = 3;           // segments each way along the river from a named one
export const REACH_TEXELS = 2.2;     // the fill reach past the half width, height texels
export const BANK_LIP = 0.25;         // m over the water at the channel edge
export const FLOOD_RISE = 0.03;       // m per m: the floodplain fill slope
// The water surface that the carve follows: 'ribbon' = the WATER ribbon
// row y (the drawn water, which can rise over a bump of the bed), 'mono' =
// the running minimum down the river (net.monoY). It stays 'ribbon' until
// WATER draws its ribbons at monoY (NOTES.md SURFACE2 -> WATER), so the
// water and the carved channel agree.
export const CARVE_SURFACE = 'ribbon';
export const hydraulicDepth = (q) => Math.min(6, 0.35 + 0.42 * Math.pow(Math.max(q, 0), 0.4));

// t: the LIB Terrain (rivers, height, n, worldSize). o.heightAt: as WATER.
// -> { verts: Float32Array (RV per row), count, rivers, texel }
export function buildRiverNet(t, o = {}) {
  const rb = buildRiverRibbons(t, { heightAt: o.heightAt, oceanOn: o.oceanOn });
  const out = [], mono = [];
  let rivers = 0, rises = 0;
  for (const r of rb.rivers) {
    if (!r || !r.rows || r.rows.length < 2) continue;
    const rows = r.rows, n = rows.length;
    rivers++;
    // the monotone surface: the ribbon y may rise over a bump of the bed
    // (WATER floorS); a river does not, it cuts the bump (a gorge)
    let m = Infinity;
    for (let i = 0; i < n; i++) { if (i > 0 && rows[i].y > rows[i - 1].y + 1e-3) rises++; m = Math.min(m, rows[i].y); mono.push(m); }
    for (let i = 0; i < n; i++) {
      const a = rows[Math.max(i - 1, 0)], b = rows[i], c = rows[Math.min(i + 1, n - 1)];
      // signed curvature from the turn of the tangent over the two steps
      const t1x = b.x - a.x, t1z = b.z - a.z, t2x = c.x - b.x, t2z = c.z - b.z;
      const l1 = Math.hypot(t1x, t1z) || 1, l2 = Math.hypot(t2x, t2z) || 1;
      const cr = (t1x * t2z - t1z * t2x) / (l1 * l2);
      const curv = (i > 0 && i < n - 1) ? -cr / (0.5 * (l1 + l2)) : 0;
      const q = Math.max(b.flow ?? 0, 0);
      const depth = Math.min(hydraulicDepth(q), Math.max(0.3, b.y - (b.bed ?? b.y - 1) + 0.6));
      const y = CARVE_SURFACE === 'mono' ? mono[mono.length - n + i] : b.y;
      out.push(b.x, b.z, y, Math.max(0.6, b.width * 0.5), depth, curv, q, i === n - 1 ? 1 : 0);
    }
  }
  const texel = t.worldSize / t.n;
  return { verts: new Float32Array(out), count: out.length / RV, rivers, texel, ribbons: rb, monoY: new Float32Array(mono), ribbonRises: rises };
}

// the reach of a segment: the fill zone round it (m)
export const reachOf = (halfW, texel) => halfW * 1.4 + REACH_TEXELS * texel;

// Nearest segment per grid cell (cell centres), within its reach.
// -> Uint32Array gridN^2 (NONE where no segment reaches)
export function rasterNearest(net, gridN, ws, origin) {
  const V = net.verts, cell = ws / gridN;
  const ids = new Uint32Array(gridN * gridN).fill(NONE);
  const best = new Float32Array(gridN * gridN).fill(Infinity);
  for (let i = 0; i + 1 < net.count; i++) {
    if (V[i * RV + 7] >= 0.5) continue;
    const ax = V[i * RV], az = V[i * RV + 1], bx = V[(i + 1) * RV], bz = V[(i + 1) * RV + 1];
    const R = reachOf(Math.max(V[i * RV + 3], V[(i + 1) * RV + 3]), net.texel) + cell;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - origin) / cell)), x1 = Math.min(gridN - 1, Math.floor((Math.max(ax, bx) + R - origin) / cell));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz) - R - origin) / cell)), z1 = Math.min(gridN - 1, Math.floor((Math.max(az, bz) + R - origin) / cell));
    const dx = bx - ax, dz = bz - az, L2 = Math.max(dx * dx + dz * dz, 1e-9);
    for (let gz = z0; gz <= z1; gz++) {
      const pz = origin + (gz + 0.5) * cell;
      for (let gx = x0; gx <= x1; gx++) {
        const px = origin + (gx + 0.5) * cell;
        const u = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
        const d = Math.hypot(px - ax - dx * u, pz - az - dz * u);
        const k = gz * gridN + gx;
        if (d < R && d < best[k]) { best[k] = d; ids[k] = i; }
      }
    }
  }
  return ids;
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The segment i at point (x, z): -> { s, sd, u, v: [y, halfW, depth, curv, flow] }
export function segmentAt(net, i, x, z) {
  const V = net.verts, A = i * RV, B = (i + 1) * RV;
  const ax = V[A], az = V[A + 1], dx = V[B] - ax, dz = V[B + 1] - az;
  const L2 = Math.max(dx * dx + dz * dz, 1e-9);
  const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  const ex = x - ax - dx * u, ez = z - az - dz * u;
  const s = Math.hypot(ex, ez);
  const side = (dx * ez - dz * ex) >= 0 ? 1 : -1;     // + left of the flow
  const lerp = (k) => V[A + k] + (V[B + k] - V[A + k]) * u;
  return { s, sd: s * side, u, v: [lerp(2), lerp(3), lerp(4), lerp(5), lerp(6)] };
}

// The carved height at signed distance sd from the centre line (CPU twin of
// ground.wgsl fn riverProfile). v = [water y, half width, depth, curvature,
// flow]; hC the coarse surface. -> { h, chan 0..1 (under water), bar, cut }
export function carveProfile(sd, v, hC, texel, spacing = 0) {
  const [y, hw, D, curv] = v;
  const chanK = 1 - sstep(hw, hw * 3, spacing);
  const lip = y + BANK_LIP, bed = y - D;
  // the deepest line moves toward the outside of a bend (curv > 0 turns
  // left: the outside is the right, sd < 0)
  const bend = Math.max(-1, Math.min(1, curv * hw * 3));
  const thal = -0.35 * hw * bend;
  const x = sd - thal;
  // the channel edges stay at +-hw: the inside of the bend (the side of
  // the centre of curvature, x * bend > 0) spans more and rises as a
  // gentle point bar, the outside spans less and rises as a cut bank
  const inside = x * bend > 0;
  const span = Math.max(x >= 0 ? hw - thal : hw + thal, hw * 0.3);
  const r = Math.min(Math.abs(x) / span, 1.5);
  const ex = inside ? 2 / (1 + 0.8 * Math.abs(bend)) : 2 + Math.abs(bend);
  const chanH = bed + (lip - bed) * Math.pow(Math.min(r, 1), ex);
  const s = Math.abs(sd);
  const reach = reachOf(hw, texel);
  const fill = Math.max(hC, lip + FLOOD_RISE * Math.max(s - hw, 0));
  const fillH = fill + (hC - fill) * sstep(reach * 0.65, reach, s);
  const cw = (1 - sstep(0.9, 1.15, r)) * chanK;
  let h = Math.min(fillH, chanH * cw + fillH * (1 - cw));
  if (s < hw + 0.5 * spacing * (1 - chanK)) h = Math.min(h, y - 0.1);
  return { h, chan: 1 - sstep(0.95, 1.0, r), bar: inside ? Math.abs(bend) * (1 - sstep(0.4, 1.1, r)) : 0, cut: !inside ? Math.abs(bend) : 0 };
}

// The carved height at (x, z) with the grid (CPU twin of fn riverCarve):
// the nearest of the segments named by the 3 x 3 cells. hC the coarse
// height there. -> { h, chan, s, seg } (seg -1: no river within reach)
export function carveAt(net, ids, gridN, ws, origin, x, z, hC) {
  const cell = ws / gridN, V = net.verts;
  const gx = Math.floor((x - origin) / cell), gz = Math.floor((z - origin) / cell);
  let bestS = Infinity, best = null, seg = -1;
  const tryS = (k) => { const sa = segmentAt(net, k, x, z); if (sa.s < bestS) { bestS = sa.s; best = sa; seg = k; } };
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cz = gz + j;
    if (cx < 0 || cz < 0 || cx >= gridN || cz >= gridN) continue;
    const id = ids[cz * gridN + cx];
    if (id === NONE) continue;
    // the named segment and its neighbours along the same river (a cell
    // names one segment; the segments are shorter than a cell)
    tryS(id);
    for (let k = 1; k <= RIVER_WIN; k++) { const q = id + k; if (q + 1 >= net.count || V[(q - 1) * RV + 7] >= 0.5 || V[q * RV + 7] >= 0.5) break; tryS(q); }
    for (let k = 1; k <= RIVER_WIN; k++) { const q = id - k; if (q < 0 || V[q * RV + 7] >= 0.5) break; tryS(q); }
  }
  if (!best || best.s > reachOf(best.v[1], net.texel)) return { h: hC, chan: 0, s: Infinity, seg: -1 };
  const p = carveProfile(best.sd, best.v, hC, net.texel);
  return { h: p.h, chan: p.chan, s: best.s, seg };
}

// The grid size per profile: twice the height map, at most 2048 (desktop),
// the height map size on a phone (at most 1024). Bytes: gridN^2 x 4.
export function riverGridN(n, phone) {
  return phone ? Math.min(1024, n) : Math.min(2048, n * 2);
}
