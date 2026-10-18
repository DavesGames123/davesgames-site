// ============================================================================
//  MARINE SNOW  ·  lib/marine-snow.js — particles of detritus in sea water
// ----------------------------------------------------------------------------
//  The user said: "a great shader for marine snow that looks super realistic
//  (not just simple gaussian dots) make sure to apply that across all
//  pages". Before that: "marine snow is too intense". So the snow is
//  subtle by default.
//
//  Real marine snow is aggregates: fluffy flocs of detritus, faecal pellets,
//  diatom chains and mucus strings, from 0.5 mm motes to cm clumps. It
//  sinks at about 10 to 100 m a day (a slow drift with the current and
//  small eddies). It shows mainly where a lamp hits it, and it scatters
//  forward: bright when you look toward the lamp, faint from the side.
//
//  The parts:
//    atlas ......... makeSnowAtlas: 16 aggregate shapes in a 4 x 4 atlas,
//                    made at load from a seed (noise, blobs, fibres,
//                    strings, beads), with box-filtered mips. Cells 0-3
//                    motes, 4-9 flocs, 10-12 strings, 13-15 pellets.
//    instances ..... snowInstances: a place in the box (xyz 0..1), the
//                    index fraction (for the density) and 4 randoms
//                    (type, cell, size, spin).
//    place ......... the box of side B wraps round the eye. A flake has the
//                    world position S B + drift + k B (k an integer), so
//                    it stays in the world when the camera moves, and it
//                    wraps only where it is faded out (radius 0.5 B).
//                    The CPU keeps the drift and the floating origin in
//                    double precision (uMsPhase), see snowPlace.
//    light ......... a GLSL hook vec3 msLight(vec3 p, vec3 V): radiance
//                    times phase. MS_LIGHT_SPOTS is the default (4 spots
//                    and a sun). msPhase is a two-lobe Henyey-Greenstein
//                    phase (forward g 0.8, back g -0.3).
//    lens .......... the thin-lens circle of confusion from the focus
//                    distance (cocPx); near flakes become bokeh discs with
//                    a soft bright rim and a red / blue edge. The light
//                    of a flake spreads over its disc (coverage), so far
//                    flakes are small and dim.
//    streak ........ the screen motion of the flake since the last frame
//                    (uMsPrevVP), times the shutter, stretches the quad.
//    soft .......... optional: the scene depth texture fades a flake in
//                    front of a surface (no hard cut).
//    budgets ....... SNOW_PROFILES: count, atlas size, disc size caps.
//    depth mix ..... snowMix(depth): shallows few small green specks;
//                    twilight and abyss more and larger flocs.
//
//  DOM-free ES module (node tests import it). THREE comes in as an
//  argument (createMarineSnow), so the module needs no import map.
//
//  USE
//    import { createMarineSnow } from '../../lib/marine-snow.js';
//    const ms = createMarineSnow(THREE, { count: 3000, atlasSize: 512 });
//    scene.add(ms.mesh);
//    ms.setSpots([spotA, spotB]);           // default light hook only
//    each frame: ms.update(camera, tSeconds);
//
//  grep -n to reach the parts:
//    "export function makeSnowAtlas"   the atlas and its shape makers
//    "export function shapeStats"      the irregularity measures
//    "export function snowInstances"   the instance data
//    "export function snowPlace"       the CPU copy of the wrap
//    "export function msPhaseJS"       the CPU copy of the phase
//    "export function cocPx"           the CPU copy of the lens
//    "export function snowMix"         the depth mix
//    "export const SNOW_PROFILES"      the budgets
//    "export const MS_VS_DECL"         the GLSL: declarations, phase
//    "export const MS_LIGHT_SPOTS"     the GLSL: default light hook
//    "export const MS_VS_MAIN"         the GLSL: place, lens, streak
//    "export const MARINE_SNOW_FS"     the GLSL: shape, bokeh, soft, post
//    "export function createMarineSnow" the three.js object
// ============================================================================

// ── constants (the GLSL and WGSL use the same numbers) ─────────────────────
export const MS_TYPES = ['mote', 'floc', 'string', 'pellet'];
// first cell and cell count of each type in the 4 x 4 atlas
export const MS_CELL_BASE = [0, 4, 10, 13];
export const MS_CELL_COUNT = [4, 6, 3, 3];
// the share of each type in the instances (cumulative in the shader)
export const MS_SHARE = [0.58, 0.24, 0.08, 0.10];
// the size range of each type: quad diameter, metres (a string: its length)
export const MS_SIZE_MIN = [0.0006, 0.003, 0.008, 0.0015];
export const MS_SIZE_MAX = [0.0025, 0.016, 0.035, 0.0045];
// sink speed of each type, m/s (mote 43, floc 104, string 69, pellet 216 m/day)
export const MS_SINK = [0.0005, 0.0012, 0.0008, 0.0025];
// the eddy field has a period of 9 m (wave numbers 2 pi / 9 and 2 pi / 4.5)
export const MS_EDDY_PERIOD = 9;
// the phase: forward g, back g, back weight, cap (1.2: a flake that you
// see against a lamp is at most 18 times as bright as one in the beam
// beside you, so the glare round a far lamp stays soft)
export const MS_G = [0.8, -0.3, 0.3, 1.2];
// the default gain: with the depth mix at 80 m the total light of the snow
// is about 0.55 of the old coral-reef snow (e5c58f18), at 2000 m about 1.8
// times (the abyss shows the snow most). Mean of 8 views of a node CPU
// copy of the shaders, the same lamps for the old and the new snow.
export const MS_GAIN = 7;

// ── random numbers and noise (deterministic) ──────────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, s) {
  let v = 0, a = 0.5;
  for (let o = 0; o < 4; o++) { v += a * vnoise(x, y, s + o * 101); x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; a *= 0.5; }
  return v / 0.9375;
}
const gauss = R => { let u = 0; for (let i = 0; i < 4; i++) u += R(); return (u - 2) * 1.732; };   // about N(0, 1)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── one cell: an n x n float field over u, v in -1..1 ──────────────────────
function makeCell(n) { return { n, a: new Float32Array(n * n) }; }
// a soft blob at (x, y), radius r (cell units), stretch sx along angle ang
function splat(c, x, y, r, amp, sx = 1, ang = 0) {
  const n = c.n, k = n * 0.5, cx = (x + 1) * k - 0.5, cy = (y + 1) * k - 0.5;
  const rp = Math.max(0.6, r * k), ext = rp * Math.max(1, sx) + 1;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const x0 = Math.max(0, Math.floor(cx - ext)), x1 = Math.min(n - 1, Math.ceil(cx + ext));
  const y0 = Math.max(0, Math.floor(cy - ext)), y1 = Math.min(n - 1, Math.ceil(cy + ext));
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const dx = i - cx, dy = j - cy;
    const u = (dx * ca + dy * sa) / (rp * sx), v = (-dx * sa + dy * ca) / rp;
    const d2 = u * u + v * v;
    if (d2 < 1) c.a[j * n + i] += amp * (1 - d2) * (1 - d2);
  }
}
// a line through the points pts ([[x, y], ...]) of width w (cell units)
function stroke(c, pts, w, amp, wFn) {
  const step = 0.7 / c.n;
  for (let p = 0; p + 1 < pts.length; p++) {
    const [ax, ay] = pts[p], [bx, by] = pts[p + 1];
    const len = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < m; s++) {
      const t = s / m, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const f = wFn ? wFn((p + t) / (pts.length - 1)) : 1;
      splat(c, x, y, w * f, amp * step / Math.max(w * f, step) * 1.6);
    }
  }
}
function bezier(p0, p1, p2, p3, m = 48) {
  const out = [];
  for (let i = 0; i <= m; i++) {
    const t = i / m, s = 1 - t;
    out.push([s * s * s * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t * t * t * p3[0], s * s * s * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
function catmull(pts, m = 12) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function modulate(c, fn) {
  const n = c.n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n * 2 - 1, v = (j + 0.5) / n * 2 - 1;
    c.a[j * n + i] *= fn(u, v);
  }
}

// ── the shape makers ──────────────────────────────────────────────────────
// a mote: a small lump of a few blobs (it draws at a few pixels)
function moteShape(c, R, s) {
  const nb = 3 + Math.floor(R() * 5), sx = 1 + R() * 0.9, ang = R() * Math.PI;
  for (let i = 0; i < nb; i++) {
    const x = gauss(R) * 0.2, y = gauss(R) * 0.2 / sx;
    splat(c, x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang), 0.16 + R() * 0.26, 0.5 + 0.5 * R(), 1 + R() * 0.8, R() * Math.PI);
  }
  modulate(c, (u, v) => 0.6 + 0.6 * fbm(u * 5 + s, v * 5 - s, s));
}
// a floc: lobes of many blobs, porous, with fibres that stick out
function flocShape(c, R, s) {
  const nl = 2 + Math.floor(R() * 3), lobes = [];
  for (let i = 0; i < nl; i++) lobes.push([gauss(R) * 0.24, gauss(R) * 0.24, R() * Math.PI, 0.7 + R() * 1.0]);
  // the body: a few wide faint blobs (the mucus that holds the floc)
  for (const L of lobes) splat(c, L[0], L[1], 0.2 + 0.14 * R(), 0.22 + 0.12 * R(), 1 + 0.5 * L[3], L[2]);
  const nb = 110 + Math.floor(R() * 110), pos = [];
  for (let i = 0; i < nb; i++) {
    const L = lobes[Math.floor(R() * nl)];
    const a = gauss(R) * 0.22 * L[3], b = gauss(R) * 0.15;
    const x = L[0] + a * Math.cos(L[2]) - b * Math.sin(L[2]), y = L[1] + a * Math.sin(L[2]) + b * Math.cos(L[2]);
    const r = 0.025 + 0.1 * R() * R();
    splat(c, x, y, r, 0.12 + 0.3 * R(), 1 + R() * 0.6, R() * Math.PI);
    pos.push([x, y]);
  }
  // tendrils: random walks of small blobs out from the body
  const nt = 2 + Math.floor(R() * 3);
  for (let i = 0; i < nt; i++) {
    let [x, y] = pos[Math.floor(R() * pos.length)], ang = R() * Math.PI * 2;
    const steps = 10 + Math.floor(R() * 16);
    for (let k = 0; k < steps; k++) {
      ang += gauss(R) * 0.5; x += Math.cos(ang) * 0.028; y += Math.sin(ang) * 0.028;
      if (Math.hypot(x, y) > 0.82) break;
      splat(c, x, y, 0.018 + 0.015 * R(), 0.25 + 0.2 * R());
    }
  }
  // fibres: thin curved lines (detritus threads, diatom spines)
  const nf = 2 + Math.floor(R() * 6);
  for (let i = 0; i < nf; i++) {
    const [x, y] = pos[Math.floor(R() * pos.length)], ang = R() * Math.PI * 2, len = 0.22 + 0.42 * R();
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len, bend = gauss(R) * 0.12;
    const mx = (x + ex) / 2 - Math.sin(ang) * bend, my = (y + ey) / 2 + Math.cos(ang) * bend;
    stroke(c, bezier([x, y], [mx, my], [mx, my], [ex, ey], 24), 0.9 / c.n, 0.08 + 0.12 * R());
  }
  // pores: the noise opens holes, so the floc looks translucent
  modulate(c, (u, v) => 0.35 + 0.65 * sstep(0.25, 0.75, fbm(u * 6.5 + s * 1.3, v * 6.5 - s, s + 7)));
}
// a string: a mucus string, a diatom chain with setae, or a tangle
function stringShape(c, R, s, variant) {
  const y0 = gauss(R) * 0.15, y1 = gauss(R) * 0.15;
  if (variant === 0) {
    const pts = bezier([-0.84, y0], [-0.3, y0 + gauss(R) * 0.35], [0.3, y1 + gauss(R) * 0.35], [0.84, y1], 64);
    stroke(c, pts, 0.07, 0.05);                                           // the faint sheath
    stroke(c, pts, 0.02, 0.5, t => 0.6 + 1.2 * fbm(t * 5 + s, s, s));    // the core, of varied width
    for (let i = 0; i < 10; i++) { const p = pts[Math.floor(R() * pts.length)]; splat(c, p[0] + gauss(R) * 0.03, p[1] + gauss(R) * 0.03, 0.02 + 0.035 * R(), 0.3 + 0.3 * R()); }
  } else if (variant === 1) {
    const pts = bezier([-0.82, y0], [-0.3, y0 + gauss(R) * 0.2], [0.3, y1 + gauss(R) * 0.2], [0.82, y1], 200);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      acc += Math.hypot(bx - ax, by - ay);
      if (acc < 0.085) continue;
      acc = 0;
      const ang = Math.atan2(by - ay, bx - ax);
      splat(c, bx, by, 0.034, 0.8, 1.35, ang);                           // a frustule
      if (R() < 0.45) {                                                   // a seta out to the side
        const sgn = R() < 0.5 ? -1 : 1, a2 = ang + sgn * (1.2 + R() * 0.6), len = 0.1 + 0.18 * R();
        stroke(c, [[bx, by], [bx + Math.cos(a2) * len, by + Math.sin(a2) * len]], 0.8 / c.n, 0.12);
      }
    }
  } else {
    const k = 5 + Math.floor(R() * 3), ctrl = [];
    for (let i = 0; i < k; i++) { const a = R() * Math.PI * 2, r = 0.2 + 0.5 * R(); ctrl.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const pts = catmull(ctrl, 16);
    stroke(c, pts, 0.013, 0.45);
    for (let i = 0; i < 8; i++) { const p = pts[Math.floor(R() * pts.length)]; splat(c, p[0], p[1], 0.025 + 0.04 * R(), 0.3 + 0.3 * R(), 1.2, R() * 3); }
  }
}
// a pellet: a dense rod with round ends (bent a little), or an ovoid
function pelletShape(c, R, s, variant) {
  const ovoid = variant === 2;
  const h = ovoid ? 0.08 + 0.08 * R() : 0.36 + 0.2 * R(), rr = ovoid ? 0.2 + 0.08 * R() : 0.12 + 0.08 * R();
  const bend = (R() - 0.5) * 0.6, n = c.n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n * 2 - 1, v0 = (j + 0.5) / n * 2 - 1;
    const v = v0 - bend * (u * u - h * h * 0.5);
    const px = Math.max(Math.abs(u) - h, 0);
    const d = Math.hypot(px, v) - rr * (1 + 0.12 * (fbm(u * 9 + s, v * 9, s) - 0.5));
    c.a[j * n + i] += sstep(0.03, -0.035, d) * (0.7 + 0.45 * fbm(u * 12 - s, v * 12, s + 3)) + 0.1 * sstep(0.12, 0, d);
  }
  for (let i = 0; i < 4; i++) splat(c, (R() - 0.5) * 2 * (h + rr), (R() - 0.5) * 2 * rr * 1.2, 0.03 + 0.03 * R(), 0.3);
}
// the end of each cell: soft compression, max 1, and zero past radius 0.95
function finishCell(c) {
  const n = c.n;
  let mx = 0;
  for (let i = 0; i < c.a.length; i++) { c.a[i] = 1 - Math.exp(-1.6 * c.a[i]); mx = Math.max(mx, c.a[i]); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n * 2 - 1, v = (j + 0.5) / n * 2 - 1;
    const w = 1 - sstep(0.85, 0.95, Math.hypot(u, v));
    const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1 ? 0 : 1;
    c.a[j * n + i] = mx > 0 ? c.a[j * n + i] / mx * w * edge : 0;
  }
  return c;
}

// The atlas: { size, cell, levels: [{ width, height, data: Uint8Array RGBA }],
// cells: [Float32Array] (level 0 of each cell), meanDisc (the mean of the
// shapes in the unit disc: the bokeh disc gets this brightness) }.
export function makeSnowAtlas({ size = 512, seed = 1 } = {}) {
  const cell = size >> 2, cells = [];
  for (let k = 0; k < 16; k++) {
    const R = rng((seed * 7919 + k * 104729) >>> 0), c = makeCell(cell), s = (seed * 31 + k * 13) % 997;
    if (k < 4) moteShape(c, R, s);
    else if (k < 10) flocShape(c, R, s);
    else if (k < 13) stringShape(c, R, s, k - 10);
    else pelletShape(c, R, s, k - 13);
    cells.push(finishCell(c).a);
  }
  const lv0 = new Uint8Array(size * size * 4);
  for (let k = 0; k < 16; k++) {
    const ox = (k & 3) * cell, oy = (k >> 2) * cell, a = cells[k];
    for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) {
      const v = Math.round(Math.min(1, Math.max(0, a[j * cell + i])) * 255), o = ((oy + j) * size + ox + i) * 4;
      lv0[o] = lv0[o + 1] = lv0[o + 2] = lv0[o + 3] = v;
    }
  }
  const levels = [{ width: size, height: size, data: lv0 }];
  for (let w = size >> 1; w >= 1; w >>= 1) {
    const p = levels[levels.length - 1], d = new Uint8Array(w * w * 4), pw = p.width;
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) for (let ch = 0; ch < 4; ch++) {
      const o = (j * 2 * pw + i * 2) * 4 + ch;
      d[(j * w + i) * 4 + ch] = (p.data[o] + p.data[o + 4] + p.data[o + pw * 4] + p.data[o + pw * 4 + 4] + 2) >> 2;
    }
    levels.push({ width: w, height: w, data: d });
  }
  let sum = 0, cnt = 0;
  for (const a of cells) for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) {
    const u = (i + 0.5) / cell * 2 - 1, v = (j + 0.5) / cell * 2 - 1;
    if (u * u + v * v < 1) { sum += a[j * cell + i]; cnt++; }
  }
  return { size, cell, levels, cells, meanDisc: sum / cnt };
}

// Irregularity of one cell mask (Float32Array n x n): anisotropy 1 - l_min /
// l_max of the second moments (0 for a disc), angular: the coefficient of
// variation of the mass in 16 sectors round the centroid (0 for a disc),
// radial: 1 - the correlation of the mask with its own radial average (0
// for any radially symmetric profile, a Gaussian too), fill: the share of
// the unit disc over 0.1.
export function shapeStats(a, n) {
  let m = 0, cx = 0, cy = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = a[j * n + i]; m += v; cx += v * i; cy += v * j; }
  cx /= m; cy /= m;
  let xx = 0, yy = 0, xy = 0;
  const sec = new Float64Array(16), rb = 48, rs = new Float64Array(rb), rc = new Float64Array(rb), rmax = n * 0.75;
  let fill = 0, disc = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = a[j * n + i], dx = i - cx, dy = j - cy;
    xx += v * dx * dx; yy += v * dy * dy; xy += v * dx * dy;
    sec[Math.min(15, Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 16))] += v;
    const b = Math.min(rb - 1, Math.floor(Math.hypot(dx, dy) / rmax * rb));
    rs[b] += v; rc[b]++;
    const u = (i + 0.5) / n * 2 - 1, w = (j + 0.5) / n * 2 - 1;
    if (u * u + w * w < 1) { disc++; if (v > 0.1) fill++; }
  }
  const tr = xx + yy, det = xx * yy - xy * xy, root = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + root, l2 = tr / 2 - root;
  const sm = sec.reduce((s, v) => s + v, 0) / 16;
  const sv = Math.sqrt(sec.reduce((s, v) => s + (v - sm) ** 2, 0) / 16) / sm;
  // correlation with the radial average
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, N = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = a[j * n + i], b = Math.min(rb - 1, Math.floor(Math.hypot(i - cx, j - cy) / rmax * rb)), r = rc[b] ? rs[b] / rc[b] : 0;
    sa += v; sb += r; saa += v * v; sbb += r * r; sab += v * r; N++;
  }
  const cov = sab / N - sa * sb / N / N, va = saa / N - (sa / N) ** 2, vb = sbb / N - (sb / N) ** 2;
  const corr = cov / Math.sqrt(Math.max(1e-12, va * vb));
  return { anisotropy: 1 - l2 / l1, angular: sv, radial: 1 - corr, fill: fill / disc };
}

// ── instances ─────────────────────────────────────────────────────────────
// seed: xyz the place in the box (0..1), w the index fraction i / n (the
// density takes the first instances; they are random, so any prefix is a
// fair sample), negative for a flake of the near box (nearShare of them). rand: x type, y cell (and a free random under it), z
// size, w spin and angle.
export function snowInstances(n, seed = 1, nearShare = 0.4) {
  const R = rng((seed * 2654435761) >>> 0), s = new Float32Array(n * 4), r = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    s[i * 4] = R(); s[i * 4 + 1] = R(); s[i * 4 + 2] = R(); s[i * 4 + 3] = (i + 0.5) / n * (R() < nearShare ? -1 : 1);
    r[i * 4] = R(); r[i * 4 + 1] = R(); r[i * 4 + 2] = R(); r[i * 4 + 3] = R();
  }
  return { seed: s, rand: r, n };
}

// ── CPU copies of the shader maths (the tests use them) ───────────────────
const posmod = (x, m) => ((x % m) + m) % m;
// The wrap. seed: [0..1]^3, cam: the eye in render space, phase: uMsPhase
// (snowPhase), box: B. Returns the render-space place (no eddy).
export function snowPlace(seed, cam, phase, box, sinkY = 0) {
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const base = cam[k] - box[k] * 0.5;
    out[k] = base + posmod(seed[k] * box[k] + phase[k] + (k === 1 ? sinkY : 0) - base, box[k]);
  }
  return out;
}
// uMsPhase from the drift (metres, world) and the floating origin O:
// mod(drift - O, B) in double precision.
export function snowPhase(drift, origin, box) { return [0, 1, 2].map(k => posmod(drift[k] - origin[k], box[k])); }

export function hgJS(g, c) { const d = 1 + g * g - 2 * g * c; return (1 - g * g) / (4 * Math.PI * d * Math.sqrt(d)); }
// c: cos of the angle between the light direction (lamp -> flake) and the
// view direction (flake -> eye); 1 = the eye looks into the lamp.
export function msPhaseJS(c, G = MS_G) { return Math.min(hgJS(G[0], c) * (1 - G[2]) + hgJS(G[1], c) * G[2], G[3]); }
// The circle of confusion (px) of a point at distance z (m) with the focus
// f (m), aperture A (m) and pxPerM (px at 1 m): A pxPerM |1/f - 1/z|.
export function cocPx(z, f, A, pxPerM) { return A * pxPerM * Math.abs(1 / f - 1 / z); }
// The lens of one flake, as the vertex shader does it: disc diameter dPx,
// kS (the shape size / the disc size), cover (the light of the flake
// spread over the disc), coverS (spread over the shape quad, under the
// min px), bok (the weight of the bokeh disc).
export function lensOf(size, z, o) {
  const zc = Math.max(z, 0.04), sPx = size * o.pxPerM / zc;
  const coc = Math.min(cocPx(zc, o.focus, o.aperture, o.pxPerM), o.maxPx);
  const d2 = sPx * sPx + coc * coc, dPx = Math.min(Math.max(Math.sqrt(d2), o.minPx), o.maxPx), sE = Math.max(sPx, o.minPx);
  return { sPx, coc, dPx, kS: Math.min(sE / dPx, 1), cover: Math.min(sPx * sPx / (dPx * dPx), 1), coverS: Math.min(sPx * sPx / (sE * sE), 1), bok: coc * coc / Math.max(d2, 1e-8) };
}

// ── budgets ───────────────────────────────────────────────────────────────
// count: flakes at full density; atlas: px; maxPx: the largest disc;
// box: the side of the wrap box (m); nearBox: the side of the near box
// (nearShare of the flakes, dense round the eye: the flakes that show
// their shape and the bokeh discs). The page budget may set its own count.
export const SNOW_PROFILES = {
  desktop: { count: 9000, atlas: 512, maxPx: 26, minPx: 1.6, maxStreak: 36, box: 24, nearBox: 8 },
  'laptop-low': { count: 5000, atlas: 512, maxPx: 20, minPx: 1.6, maxStreak: 28, box: 22, nearBox: 8 },
  phone: { count: 2600, atlas: 256, maxPx: 14, minPx: 1.5, maxStreak: 20, box: 20, nearBox: 7 },
  'phone-min': { count: 1400, atlas: 256, maxPx: 10, minPx: 1.5, maxStreak: 14, box: 18, nearBox: 7 },
};
export function snowProfile(id) { return SNOW_PROFILES[id] || SNOW_PROFILES.desktop; }

// ── depth mix ─────────────────────────────────────────────────────────────
// keys: depth (m), density, typeK (the visible share of each type), sizeK,
// tintA (motes: green phytoplankton in the light), tintB (aggregates)
const MIX_KEYS = [
  { d: 0, density: 0.3, typeK: [1, 0.25, 0.15, 0.3], sizeK: [0.8, 0.7, 0.7, 0.9], tintA: [0.6, 1.0, 0.55], tintB: [0.88, 1.0, 0.8] },
  { d: 20, density: 0.45, typeK: [1, 0.45, 0.3, 0.5], sizeK: [0.9, 0.85, 0.85, 1], tintA: [0.78, 1.0, 0.72], tintB: [0.95, 1.0, 0.9] },
  { d: 60, density: 0.65, typeK: [1, 0.7, 0.6, 0.7], sizeK: [1, 1, 1, 1], tintA: [0.95, 1.0, 0.95], tintB: [1.0, 0.98, 0.92] },
  { d: 300, density: 0.85, typeK: [1, 0.9, 0.85, 0.85], sizeK: [1, 1.2, 1.15, 1], tintA: [1.0, 0.98, 0.94], tintB: [1.0, 0.96, 0.88] },
  { d: 1500, density: 0.9, typeK: [1, 1, 1, 1], sizeK: [1, 1.4, 1.3, 1.05], tintA: [1.0, 0.97, 0.92], tintB: [1.0, 0.95, 0.86] },
];
export function snowMix(depth) {
  const x = Math.log1p(Math.max(0, depth || 0));
  let i = 0;
  while (i + 2 < MIX_KEYS.length && x > Math.log1p(MIX_KEYS[i + 1].d)) i++;
  const A = MIX_KEYS[i], B = MIX_KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (x - Math.log1p(A.d)) / (Math.log1p(B.d) - Math.log1p(A.d))));
  const L = (a, b) => Array.isArray(a) ? a.map((v, k) => v + (b[k] - v) * t) : a + (b - a) * t;
  return { depth, density: L(A.density, B.density), typeK: L(A.typeK, B.typeK), sizeK: L(A.sizeK, B.sizeK), tintA: L(A.tintA, B.tintA), tintB: L(A.tintB, B.tintB) };
}

// ── GLSL (three.js ShaderMaterial, GLSL3) ─────────────────────────────────
const f = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const v4 = a => `vec4(${a.map(f).join(', ')})`;
// The declarations and the phase. The light hook comes after this.
export const MS_VS_DECL = /* glsl */`
in vec4 aSeed;
in vec4 aRand;
uniform vec4 uMsBox;
uniform vec3 uMsPhase;
uniform vec3 uMsPhaseN;
uniform vec4 uMsSink;
uniform vec4 uMsSinkN;
uniform vec3 uMsEddyO;
uniform float uMsTime;
uniform vec4 uMsLens;
uniform vec4 uMsPx;
uniform vec4 uMsShare;
uniform vec4 uMsTypeK;
uniform vec4 uMsSizeK;
uniform vec4 uMsTintA;
uniform vec4 uMsTintB;
uniform vec3 uMsExt;
uniform vec4 uMsG;
uniform vec2 uMsView;
uniform mat4 uMsPrevVP;
out vec3 vMsCol;
out vec4 vMsQuad;
out vec4 vMsRot;
out vec4 vMsCell;
// uMsBox: xyz the far box (m), w the side of the near box. A flake with
// aSeed.w < 0 is in the near box (dense, round the eye); |aSeed.w| is its
// index fraction. uMsPhase(N), uMsSink(N): the drift of each box.
// uMsLens: x px per metre at 1 m, y aperture (m), z focus (m), w shutter
// uMsPx: x min disc px, y max disc px, z max streak px, w streak on
// uMsTintA: rgb mote tint, w gain. uMsTintB: rgb aggregate tint, w density
// Henyey-Greenstein, c = cos(light direction, view direction)
float msHG(float g, float c) { float d = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (12.566371 * d * sqrt(d)); }
float msPhase(float c) { return min(mix(msHG(uMsG.x, c), msHG(uMsG.y, c), uMsG.z), uMsG.w); }
`;
// The default light: up to 4 spots and a sun (or the downwelling light).
export const MS_LIGHT_SPOTS = /* glsl */`
uniform vec4 uMsSpotP[4];
uniform vec4 uMsSpotD[4];
uniform vec4 uMsSpotC[4];
uniform float uMsSpotN;
uniform vec4 uMsSun;
uniform vec3 uMsSunC;
// uMsSpotP: xyz place, w range. uMsSpotD: xyz direction, w cos(outer).
// uMsSpotC: rgb radiance, w cos(inner). uMsSun: xyz the way the light
// goes (unit), w on.
vec3 msLight(vec3 p, vec3 V) {
  vec3 c = uMsSunC * (msPhase(dot(uMsSun.xyz, V)) * uMsSun.w);
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uMsSpotN) break;
    vec3 d = uMsSpotP[i].xyz - p;
    float dist = max(length(d), 0.05);
    vec3 L = d / dist;
    float cone = smoothstep(uMsSpotD[i].w, uMsSpotC[i].w, dot(-L, uMsSpotD[i].xyz));
    float att = cone / (1.0 + 0.06 * dist * dist) * (1.0 - smoothstep(uMsSpotP[i].w * 0.55, uMsSpotP[i].w, dist));
    c += uMsSpotC[i].rgb * (att * msPhase(dot(-L, V))) * exp(-dist * uMsExt);
  }
  return c;
}
`;
export const MS_VS_MAIN = /* glsl */`
const vec4 MS_SMIN = ${v4(MS_SIZE_MIN)};
const vec4 MS_SMAX = ${v4(MS_SIZE_MAX)};
const vec4 MS_CB = ${v4(MS_CELL_BASE)};
const vec4 MS_CN = ${v4(MS_CELL_COUNT)};
const vec4 MS_SPIN = vec4(0.25, 0.12, 0.08, 0.2);
const vec4 MS_TUMBLE = vec4(0.0, 0.6, 0.75, 0.7);
void main() {
  // the type, the cell and a free random under the cell pick
  float u = aRand.x;
  float ty = u < uMsShare.x ? 0.0 : (u < uMsShare.y ? 1.0 : (u < uMsShare.z ? 2.0 : 3.0));
  vec4 oh = vec4(equal(vec4(ty), vec4(0.0, 1.0, 2.0, 3.0)));
  float cn = dot(MS_CN, oh);
  float cell = dot(MS_CB, oh) + min(floor(aRand.y * cn), cn - 1.0);
  float r5 = fract(aRand.y * cn);
  float tk = dot(uMsTypeK, oh) * 1.08, dk = uMsTintB.w * 1.03;
  float vis = (1.0 - smoothstep(tk - 0.08, tk, r5)) * (1.0 - smoothstep(dk - 0.03, dk, abs(aSeed.w)));
  bool nearL = aSeed.w < 0.0;
  float smin = dot(MS_SMIN, oh);
  float size = smin * pow(dot(MS_SMAX, oh) / smin, pow(aRand.z, 1.7)) * dot(uMsSizeK, oh);
  // the place: world-locked, wraps round the eye (see snowPlace)
  vec3 B = nearL ? vec3(uMsBox.w) : uMsBox.xyz;
  vec3 base = cameraPosition - 0.5 * B;
  vec3 q = aSeed.xyz * B + (nearL ? uMsPhaseN : uMsPhase);
  q.y += dot(nearL ? uMsSinkN : uMsSink, oh);
  q = base + mod(q - base, B);
  float t = uMsTime;
  vec3 e = q + uMsEddyO;
  q += vec3(sin(e.z * 0.6981317 + t * 0.21) + sin(e.y * 1.3962634 - t * 0.17),
            0.5 * sin(e.x * 0.6981317 + t * 0.13),
            cos(e.x * 1.3962634 + t * 0.19) + sin(e.y * 0.6981317 + t * 0.23)) * 0.03;
  q += vec3(sin(t * 0.9 + aRand.z * 40.0), 0.6 * sin(t * 0.7 + aRand.w * 40.0), cos(t * 0.8 + aRand.x * 40.0)) * 0.005;
  vec4 mv = viewMatrix * vec4(q, 1.0);
  float z = -mv.z;
  vec3 dq = cameraPosition - q;
  float dist = length(dq);
  vec3 V = dq / max(dist, 1e-4);
  // the fade to the wrap radius (a wide band in the near box, so a fast
  // camera does not pop near flakes; it also hides the edge of the box)
  float fadeR = 0.5 * min(B.x, min(B.y, B.z));
  float fade = (1.0 - smoothstep(fadeR * (nearL ? 0.4 : 0.62), fadeR, dist)) * smoothstep(0.04, 0.12, z);
  vec3 tint = mix(uMsTintB.rgb, uMsTintA.rgb, oh.x) * (1.0 - 0.45 * oh.w);
  // the lens: thin-lens circle of confusion, light spread over the disc
  float zc = max(z, 0.04);
  float sPx = size * uMsLens.x / zc;
  float coc = min(uMsLens.y * uMsLens.x * abs(1.0 / uMsLens.z - 1.0 / zc), uMsPx.y);
  float d2 = sPx * sPx + coc * coc;
  float dPx = clamp(sqrt(d2), uMsPx.x, uMsPx.y);
  float sE = max(sPx, uMsPx.x);
  float cover = min(sPx * sPx / (dPx * dPx), 1.0);
  float coverS = min(sPx * sPx / (sE * sE), 1.0);
  float bok = coc * coc / max(d2, 1e-8);
  // the streak: the screen motion since the last frame, times the shutter
  vec4 cNow = projectionMatrix * mv;
  vec4 cPrev = uMsPrevVP * vec4(q, 1.0);
  vec2 dS = vec2(0.0);
  if (uMsPx.w > 0.5 && cPrev.w > 0.04 && cNow.w > 0.04) dS = (cNow.xy / cNow.w - cPrev.xy / cPrev.w) * 0.5 * uMsView * uMsLens.w;
  float sl = length(dS);
  float L = min(sl, uMsPx.z);
  vec2 ax = sl > 0.25 ? dS / sl : vec2(1.0, 0.0);
  float R = 0.5 * dPx;
  float hl = 0.5 * L;
  vec2 c = position.xy;
  vec2 off = ax * (c.x * (R + hl)) + vec2(-ax.y, ax.x) * (c.y * R);
  cNow.xy += off * 2.0 / uMsView * cNow.w;
  // the shape turns slowly and tumbles (a flat floc edge-on looks thin)
  float spin = (aRand.w - 0.5) * 2.0 * dot(MS_SPIN, oh);
  float th = fract(aRand.w * 7.13) * 6.2831853 + t * spin - atan(ax.y, ax.x);
  float sq = 1.0 - dot(MS_TUMBLE, oh) * (0.5 - 0.5 * cos(t * spin * 0.7 + aRand.x * 37.0));
  vMsRot = vec4(cos(th), sin(th), max(sq, 0.25), z);
  vMsQuad = vec4(c.x * (R + hl) / R, c.y, hl / R, bok);
  vMsCell = vec4(vec2(mod(cell, 4.0), floor(cell / 4.0)) * 0.25, min(sE / dPx, 1.0), cover / max(coverS, 1e-6));
  float k = uMsTintA.w * coverS * fade * vis * R / (R + hl);
  vMsCol = k > 0.0 ? msLight(q, V) * tint * k * exp(-dist * uMsExt) : vec3(0.0);
  if (k <= 0.0) cNow = vec4(0.0, 0.0, 2.0, 1.0);
  gl_Position = cNow;
}`;
export function marineSnowVS(hook = MS_LIGHT_SPOTS, pre = '') { return pre + MS_VS_DECL + hook + MS_VS_MAIN; }

export const MARINE_SNOW_FS = /* glsl */`
uniform sampler2D uMsAtlas;
uniform sampler2D uMsDepth;
uniform vec4 uMsFrag;
uniform vec4 uMsCam;
uniform vec2 uMsView;
in vec3 vMsCol;
in vec4 vMsQuad;
in vec4 vMsRot;
in vec4 vMsCell;
out vec4 oCol;
// uMsFrag: x soft (0 / 1), y soft length (m), z post (0 / 1: tone map
// here, for a draw after the frame tone map), w exposure.
// uMsCam: x near, y far, z disc brightness (atlas meanDisc).
void main() {
  float hl = vMsQuad.z, bok = vMsQuad.w;
  // back along the streak: the shape at the nearest point of the segment
  vec2 l = vec2(sign(vMsQuad.x) * max(abs(vMsQuad.x) - hl, 0.0), vMsQuad.y);
  float r = length(l);
  vec2 s = vec2(vMsRot.x * l.x + vMsRot.y * l.y, vMsRot.x * l.y - vMsRot.y * l.x);
  s.y /= vMsRot.z;
  // the shape at its own size (vMsCell.z of the disc), blurred by the mips
  s /= vMsCell.z;
  vec2 uv = vMsCell.xy + clamp(s * 0.5 + 0.5, 0.0, 1.0) * 0.25;
  float sh = texture(uMsAtlas, uv, -log2(vMsCell.z)).r * step(abs(s.x), 1.0) * step(abs(s.y), 1.0);
  // the bokeh disc: soft edge, bright rim, red out and blue in
  vec3 rr = vec3(r * 0.97, r, r * 1.03);
  vec3 disc = (1.0 - smoothstep(vec3(0.8), vec3(1.0), rr)) * (0.6 + 0.55 * smoothstep(vec3(0.35), vec3(0.92), rr));
  // vMsCell.w: the disc spreads the light of the shape over its area
  vec3 col = vMsCol * mix(vec3(sh), disc * (uMsCam.z * vMsCell.w), bok) * step(r, 1.0);
  if (uMsFrag.x > 0.5) {
    float dz = texture(uMsDepth, gl_FragCoord.xy / uMsView).r;
    float zs = uMsCam.x * uMsCam.y / (uMsCam.y - dz * (uMsCam.y - uMsCam.x));
    col *= clamp((zs - vMsRot.w) / uMsFrag.y, 0.0, 1.0);
  }
  if (uMsFrag.z > 0.5) {
    vec3 x = col * uMsFrag.w;
    x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    col = mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
  }
  oCol = vec4(col, 1.0);
}`;

// ── the three.js object ───────────────────────────────────────────────────
// o: count, atlasSize, box (m), maxPx, minPx, maxStreak, seed, gain,
//    aperture (m), focus (m), shutter (0..1), vertexShader, fragmentShader
//    (the defaults: marineSnowVS(), MARINE_SNOW_FS), uniforms (extra
//    uniform objects for a page light hook), ext (a uniform object for
//    uMsExt, to share the fog of the page).
export function createMarineSnow(THREE, o = {}) {
  const prof = snowProfile(o.profile);
  const N = Math.max(1, Math.round(o.count ?? prof.count));
  const atlas = o.atlas || makeSnowAtlas({ size: o.atlasSize || prof.atlas, seed: o.seed ?? 1 });
  const tex = new THREE.DataTexture(atlas.levels[0].data, atlas.size, atlas.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = atlas.levels.map(l => ({ data: l.data, width: l.width, height: l.height }));
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const inst = snowInstances(N, o.seed ?? 1, o.nearShare ?? 0.4);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(inst.seed, 4));
  g.setAttribute('aRand', new THREE.InstancedBufferAttribute(inst.rand, 4));
  g.instanceCount = N;

  const box = o.box ?? prof.box;
  const share = [MS_SHARE[0], MS_SHARE[0] + MS_SHARE[1], MS_SHARE[0] + MS_SHARE[1] + MS_SHARE[2], 1];
  const U = {
    uMsBox: { value: new THREE.Vector4(box, box, box, o.nearBox ?? prof.nearBox) },
    uMsPhase: { value: new THREE.Vector3() },
    uMsPhaseN: { value: new THREE.Vector3() },
    uMsSink: { value: new THREE.Vector4() },
    uMsSinkN: { value: new THREE.Vector4() },
    uMsEddyO: { value: new THREE.Vector3() },
    uMsTime: { value: 0 },
    uMsLens: { value: new THREE.Vector4(900, o.aperture ?? 0.006, o.focus ?? 2.5, o.shutter ?? 0.5) },
    uMsPx: { value: new THREE.Vector4(o.minPx ?? prof.minPx, o.maxPx ?? prof.maxPx, o.maxStreak ?? prof.maxStreak, 0) },
    uMsShare: { value: new THREE.Vector4(...share) },
    uMsTypeK: { value: new THREE.Vector4(1, 1, 1, 1) },
    uMsSizeK: { value: new THREE.Vector4(1, 1, 1, 1) },
    uMsTintA: { value: new THREE.Vector4(1, 1, 1, o.gain ?? MS_GAIN) },
    uMsTintB: { value: new THREE.Vector4(1, 1, 1, 1) },
    uMsExt: o.ext || { value: new THREE.Vector3(0.05, 0.04, 0.03) },
    uMsG: { value: new THREE.Vector4(...MS_G) },
    uMsView: { value: new THREE.Vector2(1, 1) },
    uMsPrevVP: { value: new THREE.Matrix4() },
    uMsAtlas: { value: tex },
    uMsCam: { value: new THREE.Vector4(0.1, 100, atlas.meanDisc, 0) },
    // the default light hook
    uMsSpotP: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    uMsSpotD: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1, 0, 0.9)) },
    uMsSpotC: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0.95)) },
    uMsSpotN: { value: 0 },
    uMsSun: { value: new THREE.Vector4(0, -1, 0, 0) },
    uMsSunC: { value: new THREE.Vector3(0, 0, 0) },
  };
  Object.assign(U, o.uniforms || {});
  const vs = o.vertexShader || marineSnowVS(), fs = o.fragmentShader || MARINE_SNOW_FS;

  // per camera: the size of the target, px per metre, near / far; the
  // streak only for the camera that update() follows
  const tmpV2 = new THREE.Vector2();
  const meshes = [];
  function makeMesh(flags = {}) {
    const own = { uMsFrag: { value: new THREE.Vector4(flags.soft ? 1 : 0, flags.softLen ?? 0.3, flags.post ? 1 : 0, 1) }, uMsDepth: { value: flags.depth || null } };
    if (flags.exposure) own.uMsExposure = flags.exposure;
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: vs, fragmentShader: fs,
      uniforms: Object.assign({}, U, own), transparent: true, depthWrite: false, depthTest: !flags.soft,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.onBeforeRender = (renderer, scene, cam) => {
      const rt = renderer.getRenderTarget();
      if (rt) tmpV2.set(rt.width, rt.height); else renderer.getDrawingBufferSize(tmpV2);
      const u = mat.uniforms;
      u.uMsView.value.copy(tmpV2);
      if (cam.isPerspectiveCamera) {
        const zoom = cam.zoom || 1, vh = cam.view && cam.view.enabled ? cam.view.height / cam.view.fullHeight : 1;
        u.uMsLens.value.x = tmpV2.y * 0.5 / (Math.tan(cam.fov * Math.PI / 360) / zoom * vh);
        u.uMsCam.value.x = cam.near; u.uMsCam.value.y = cam.far;
      }
      u.uMsPx.value.w = cam === S.camera && S.streakOK ? 1 : 0;
      if (own.uMsExposure) u.uMsFrag.value.w = own.uMsExposure.value;
      mat.uniformsNeedUpdate = true;
    };
    meshes.push(mesh);
    return mesh;
  }
  const mesh = makeMesh();

  // the CPU state, in double precision
  const S = {
    camera: null, streakOK: false, t: null, drift: [0, 0, 0], sink: [0, 0, 0, 0], cur: [0, 0, 0],
    origin: [0, 0, 0], lastOrigin: null, lastCam: null, density: 1, user: 1, depth: null, mix: null,
    vp: new THREE.Matrix4(), prev: new THREE.Matrix4(), T: new THREE.Matrix4(), cam: new THREE.Vector3(),
  };
  function applyDensity() {
    const d = Math.min(1, Math.max(0, S.density * S.user));
    U.uMsTintB.value.w = d;
    g.instanceCount = Math.min(N, Math.ceil(N * Math.min(1, d * 1.03 + 0.001)));
  }
  function setDepth(depth) {
    if (depth == null || !Number.isFinite(depth)) return;
    const m = snowMix(depth);
    S.depth = depth; S.mix = m; S.density = m.density;
    U.uMsTypeK.value.set(...m.typeK); U.uMsSizeK.value.set(...m.sizeK);
    U.uMsTintA.value.set(m.tintA[0], m.tintA[1], m.tintA[2], U.uMsTintA.value.w);
    U.uMsTintB.value.set(m.tintB[0], m.tintB[1], m.tintB[2], U.uMsTintB.value.w);
    applyDensity();
  }
  // camera: the main camera (the streak follows it); t: seconds
  function update(camera, t) {
    const dt = S.t === null ? 0 : Math.min(0.25, Math.max(0, t - S.t));
    S.t = t;
    for (let k = 0; k < 3; k++) S.drift[k] += S.cur[k] * dt;
    for (let k = 0; k < 4; k++) S.sink[k] += MS_SINK[k] * dt;
    const B = U.uMsBox.value;
    const ph = snowPhase(S.drift, S.origin, [B.x, B.y, B.z]), pn = snowPhase(S.drift, S.origin, [B.w, B.w, B.w]);
    U.uMsPhase.value.set(ph[0], ph[1], ph[2]); U.uMsPhaseN.value.set(pn[0], pn[1], pn[2]);
    U.uMsSink.value.set(...S.sink.map(s => posmod(-s, B.y))); U.uMsSinkN.value.set(...S.sink.map(s => posmod(-s, B.w)));
    U.uMsEddyO.value.set(...S.origin.map(v => posmod(v, MS_EDDY_PERIOD)));
    U.uMsTime.value = t;
    if (camera) {
      camera.updateMatrixWorld();
      S.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      S.cam.setFromMatrixPosition(camera.matrixWorld);
      const dO = S.lastOrigin ? S.origin.map((v, k) => v - S.lastOrigin[k]) : [0, 0, 0];
      const jump = S.lastCam ? Math.hypot(S.cam.x + dO[0] - S.lastCam[0], S.cam.y + dO[1] - S.lastCam[1], S.cam.z + dO[2] - S.lastCam[2]) : Infinity;
      // a cut or a teleport: no streak this frame
      S.streakOK = camera === S.camera && jump < 3 && dt > 0;
      if (S.streakOK) {
        // the last frame was in render space plus dO: prev x T(dO)
        S.T.makeTranslation(dO[0], dO[1], dO[2]);
        U.uMsPrevVP.value.multiplyMatrices(S.prev, S.T);
      } else U.uMsPrevVP.value.copy(S.vp);
      S.prev.copy(S.vp);
      S.camera = camera; S.lastCam = [S.cam.x, S.cam.y, S.cam.z]; S.lastOrigin = S.origin.slice();
    }
  }
  function setSpots(list, k = 1) {
    const ls = (list || []).filter(l => l && l.isSpotLight).slice(0, 4), P = new THREE.Vector3(), T = new THREE.Vector3();
    U.uMsSpotN.value = ls.length;
    ls.forEach((l, i) => {
      l.getWorldPosition(P);
      if (l.target) l.target.getWorldPosition(T); else T.set(P.x, P.y - 1, P.z);
      T.sub(P).normalize();
      const q = (l.visible === false ? 0 : l.intensity) * k;
      U.uMsSpotP.value[i].set(P.x, P.y, P.z, l.distance || 30);
      U.uMsSpotD.value[i].set(T.x, T.y, T.z, Math.cos(l.angle));
      U.uMsSpotC.value[i].set(l.color.r * q, l.color.g * q, l.color.b * q, Math.cos(l.angle * (1 - Math.max(0.05, l.penumbra || 0))));
    });
  }
  return {
    mesh, meshes, material: mesh.material, uniforms: U, geometry: g, atlas, texture: tex, count: N, state: S,
    makeMesh, update, setDepth, setSpots,
    setDensity(v) { S.user = Math.max(0, v); applyDensity(); },
    get density() { return S.user; },
    setCurrent(x, y, z) { S.cur = [x || 0, y || 0, z || 0]; },
    setOrigin(x, y, z) { S.origin = [x || 0, y || 0, z || 0]; },
    setFocus(f) { U.uMsLens.value.z = Math.max(0.2, f); },
    setGain(v) { U.uMsTintA.value.w = v; },
    setSun(dir, col, on = 1) { const l = Math.hypot(...dir) || 1; U.uMsSun.value.set(dir[0] / l, dir[1] / l, dir[2] / l, on); U.uMsSunC.value.set(...col); },
    set visible(v) { for (const m of meshes) m.visible = v; },
    dispose() { g.dispose(); tex.dispose(); for (const m of meshes) m.material.dispose(); },
  };
}
