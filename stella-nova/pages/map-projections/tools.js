// ============================================================================
//  MAP PROJECTIONS  ·  tools.js — the distortion tools, drawn over the map
// ----------------------------------------------------------------------------
//  Every tool works on the frames of the MapView (one map, or the two maps
//  of a morph), so the same code runs on the page and in the saver.
//
//  TISSOT. At each centre the screen Jacobian comes from central differences
//  of pointAt (geo.js), the full map to the screen. The ellipse is the image
//  of a small ground circle of radius r: c + r (E cos t + N sin t), with E
//  and N the screen images of one radian east and north. All circles have
//  the same ground size, so their sizes compare areas and their shapes show
//  angle distortion.
//  HEATMAP. Each cell of a grid at 1/3 of the canvas is inverted (proj.js
//  invWorld) and distortion() gives the area scale a b or the angle
//  distortion w. Area is shown as log2(s / s0), with s0 the area scale at
//  the map centre. Isolines come from marching squares on the same grid.
//  TRUE SIZE. A country is turned on the sphere about the axis that takes
//  its label point to the target point, then drawn through the map. The
//  shape on the ground does not change; the map changes its drawn size.
//  ROUTES. The great circle (gcPath) and the rhumb line (rhumbPath)
//  between two points. MEASURE. Two points: the true distance (Vincenty on
//  WGS84 and the great circle on the sphere) and the straight map distance
//  at the nominal scale of the map.
//
//  GREP MAP
//    grep -n 'export function drawTissot'    ellipses
//    grep -n 'export function buildHeat'     the heatmap image + isolines
//    grep -n 'export function moveRings'     true size: turn a country
//    grep -n 'export function drawCountry'   true size: draw it
//    grep -n 'export function drawRoutes'    great circle vs rhumb line
//    grep -n 'export function measure'       distance readout values
// ============================================================================
import { D, PI, vec, lonlat, distortion, gcPath, rhumbPath, gcDist, rhumb, vincenty, sphArea, R_EARTH, bearing } from './proj.js';
import { pointAt, clipPolygon, clipLine } from './geo.js';
import { addPieces } from './render.js';

const { sin, cos, sqrt, hypot, atan2, abs, log2, max, min } = Math;

// Screen Jacobian at world (lo, la), radians: E = d/dlon / cos(lat), N = d/dlat.
export function screenJacobian(frames, lo, la, h = 2e-4) {
  const e = pointAt(frames, lo + h, la), w = pointAt(frames, lo - h, la), n = pointAt(frames, lo, la + h), s = pointAt(frames, lo, la - h), c = pointAt(frames, lo, la);
  if (!e || !w || !n || !s || !c) return null;
  const k = 2 * h * cos(la);
  return { c, E: [(e[0] - w[0]) / k, (e[1] - w[1]) / k], N: [(n[0] - s[0]) / (2 * h), (n[1] - s[1]) / (2 * h)] };
}

export function tissotCentres(step = 30, latMax = 75) {
  const out = [];
  for (let la = -latMax + ((latMax * 2) % step) / 2; la <= latMax + 1e-9; la += step)
    for (let lo = -180 + step / 2; lo < 180; lo += step) out.push([lo, la]);
  return out;
}
// opt: { step, radius (deg), grow 0..1 per centre via fn, fill, stroke, max px }
export function drawTissot(g, frames, opt = {}) {
  const r = (opt.radius ?? 5) * D, step = opt.step ?? 30, cs = opt.centres || tissotCentres(step, opt.latMax ?? 75);
  const fill = opt.fill ?? 'rgba(255,138,92,0.30)', stroke = opt.stroke ?? 'rgba(255,170,130,0.95)';
  const limit = opt.max ?? 4000;
  g.save(); if (opt.clip) g.clip(opt.clip);
  for (let i = 0; i < cs.length; i++) {
    const [lo, la] = cs[i], grow = opt.grow ? opt.grow(i, lo, la) : 1;
    if (grow <= 0.001) continue;
    const J = screenJacobian(frames, lo * D, la * D); if (!J) continue;
    const rr = r * grow;
    if (hypot(J.E[0], J.E[1]) * rr > limit || hypot(J.N[0], J.N[1]) * rr > limit) continue;
    g.beginPath();
    for (let t = 0; t <= 64; t++) {
      const a = t / 64 * 2 * PI, x = J.c[0] + rr * (J.E[0] * cos(a) + J.N[0] * sin(a)), y = J.c[1] + rr * (J.E[1] * cos(a) + J.N[1] * sin(a));
      t ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = fill; g.fill();
    g.strokeStyle = stroke; g.lineWidth = opt.lineWidth ?? 1; g.stroke();
    if (opt.axes) {
      // the two Tissot axes: the singular vectors of [E N]
      const t = distortionAxes(J.E, J.N);
      g.beginPath();
      for (const [vx, vy, len] of t) { g.moveTo(J.c[0] - vx * len * rr, J.c[1] - vy * len * rr); g.lineTo(J.c[0] + vx * len * rr, J.c[1] + vy * len * rr); }
      g.strokeStyle = 'rgba(255,230,210,0.7)'; g.lineWidth = 0.7; g.stroke();
    }
  }
  g.restore();
}
function distortionAxes(E, N) {
  // M = [E N] (columns). Singular directions in the screen: eigenvectors of M M^T.
  const a = E[0] * E[0] + N[0] * N[0], b = E[0] * E[1] + N[0] * N[1], d = E[1] * E[1] + N[1] * N[1];
  const tr = a + d, det = a * d - b * b, disc = sqrt(max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = max(0, tr / 2 - disc);
  const th = 0.5 * atan2(2 * b, a - d);
  return [[cos(th), sin(th), sqrt(l1)], [-sin(th), cos(th), sqrt(l2)]];
}

// ── heatmap ────────────────────────────────────────────────────────────────
// Diverging scale for log2 area (blue: shrunk, grey: true, orange: grown)
// and a sequential scale for the angle (dark to bright).
const DIV = [[-3, [40, 92, 196]], [-1.5, [86, 150, 230]], [-0.4, [160, 196, 236]], [0, [214, 214, 210]], [0.4, [246, 196, 140]], [1.5, [236, 128, 62]], [3, [178, 46, 34]]];
const SEQ = [[0, [16, 26, 52]], [5, [44, 64, 132]], [15, [118, 70, 170]], [30, [206, 84, 120]], [50, [246, 150, 70]], [75, [252, 236, 160]]];
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
    return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
  }
  return stops[stops.length - 1][1];
}
export const HEAT_LEGEND = {
  area: { stops: DIV, ticks: [[-3, '1/8'], [-2, '1/4'], [-1, '1/2'], [0, '1'], [1, '2'], [2, '4'], [3, '8']], label: 'Area scale, relative to the map centre', iso: [-2, -1, -0.5, 0.5, 1, 2] },
  angle: { stops: SEQ, ticks: [[0, '0°'], [15, '15°'], [30, '30°'], [50, '50°'], [75, '75°']], label: 'Largest angle error', iso: [5, 15, 30, 50] },
};
export function legendColor(mode, v) { const c = ramp(HEAT_LEGEND[mode].stops, v); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }

// Builds the heatmap for map m (one frame, screen transform scr) in a
// canvas of the view size / cell. Async: yields every ~12 ms. Returns
// { canvas, iso: [[x, y, x, y] segments in CSS px per level], mode } or
// null when cancelled (token.stop).
export async function buildHeat(m, scr, W, H, mode, token = {}, cell = 3) {
  const gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1;
  const val = new Float32Array(gw * gh).fill(NaN);
  const c0 = distortion(m, (m.st.lon ?? 0) * D, 0) || distortion(m, 0.01, 0.01);
  const s0 = c0 ? c0.s : 1;
  let t0 = performance.now();
  for (let j = 0; j < gh; j++) {
    let guess = null;
    for (let i = 0; i < gw; i++) {
      const X = i * cell, Y = j * cell;
      const x = (X - scr.x) / scr.k, y = -(Y - scr.y) / scr.k;
      const ll = m.inv(x, y, guess);
      if (!ll) { guess = null; continue; }
      guess = ll.clip;
      const t = distortion(m, ll[0], ll[1]); if (!t) continue;
      val[j * gw + i] = mode === 'area' ? log2(t.s / s0) : t.w / D;
    }
    if (performance.now() - t0 > 12) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); if (token.stop) return null; }
  }
  const cv = document.createElement('canvas'); cv.width = gw; cv.height = gh;
  const g = cv.getContext('2d'), img = g.createImageData(gw, gh), stops = HEAT_LEGEND[mode].stops;
  for (let k = 0; k < gw * gh; k++) {
    const v = val[k]; if (v !== v) continue;
    const c = ramp(stops, v);
    img.data[4 * k] = c[0]; img.data[4 * k + 1] = c[1]; img.data[4 * k + 2] = c[2]; img.data[4 * k + 3] = 235;
  }
  g.putImageData(img, 0, 0);
  // The canvas is drawn at (gw - 1) cells = W.. so scale = cell.
  const iso = HEAT_LEGEND[mode].iso.map(lv => ({ lv, seg: march(val, gw, gh, lv, cell) }));
  return { canvas: cv, iso, mode, cell, gw, gh, val, s0 };
}
// Marching squares: segments where the grid crosses level lv.
function march(v, gw, gh, lv, cell) {
  const seg = [];
  const lerp = (a, b) => (lv - a) / (b - a);
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const a = v[j * gw + i], b = v[j * gw + i + 1], c = v[(j + 1) * gw + i + 1], d = v[(j + 1) * gw + i];
    if (a !== a || b !== b || c !== c || d !== d) continue;
    // skip cells over a jump (an interruption or the cut)
    if (max(a, b, c, d) - min(a, b, c, d) > 2.5 * (abs(lv) + 1)) continue;
    const p = [];
    if ((a < lv) !== (b < lv)) p.push([i + lerp(a, b), j]);
    if ((b < lv) !== (c < lv)) p.push([i + 1, j + lerp(b, c)]);
    if ((d < lv) !== (c < lv)) p.push([i + lerp(d, c), j + 1]);
    if ((a < lv) !== (d < lv)) p.push([i, j + lerp(a, d)]);
    if (p.length >= 2) seg.push(p[0][0] * cell, p[0][1] * cell, p[1][0] * cell, p[1][1] * cell);
    if (p.length === 4) seg.push(p[2][0] * cell, p[2][1] * cell, p[3][0] * cell, p[3][1] * cell);
  }
  return seg;
}
export function drawIso(g, heat, clip) {
  if (!heat) return;
  g.save(); if (clip) g.clip(clip);
  for (const { lv, seg } of heat.iso) {
    g.beginPath();
    for (let i = 0; i < seg.length; i += 4) { g.moveTo(seg[i], seg[i + 1]); g.lineTo(seg[i + 2], seg[i + 3]); }
    g.strokeStyle = 'rgba(8,10,16,0.55)'; g.lineWidth = 1; g.stroke();
  }
  g.restore();
}

// ── true size ──────────────────────────────────────────────────────────────
// The rotation that takes unit vector a to b (Rodrigues), applied to rings.
export function rotTo(a, b) {
  const k = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const s = hypot(k[0], k[1], k[2]), c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (s < 1e-12) return v => v.slice();
  const x = k[0] / s, y = k[1] / s, z = k[2] / s, C = 1 - c;
  const R = [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  return v => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
}
// country: { rings, lines, lx, ly }. target: [lon, lat] in degrees.
export function moveRings(country, target) {
  const f = rotTo(vec(country.lx * D, country.ly * D), vec(target[0] * D, target[1] * D));
  return { rings: country.rings.map(r => r.map(f)), lines: country.lines.map(l => l.map(f)) };
}
export function countryArea(country) {
  // km^2 on the mean-radius sphere; holes are negative rings.
  let s = 0;
  for (const r of country.flat) s += sphArea(r.map((v, i) => v * 0.01 * D));
  return abs(s) * R_EARTH * R_EARTH;
}
export function drawCountry(g, frames, shape, style = {}) {
  const fp = new Path2D(); addPieces(fp, clipPolygon(shape.rings, frames, { tol: 0.3 }), true);
  const lp = new Path2D(); addPieces(lp, shape.lines.flatMap(l => clipLine(l, frames, { tol: 0.3 })), false);
  g.fillStyle = style.fill ?? 'rgba(98,196,255,0.42)'; g.fill(fp);
  g.strokeStyle = style.stroke ?? 'rgba(170,225,255,0.95)'; g.lineWidth = style.lineWidth ?? 1.4; g.lineJoin = 'round'; g.stroke(lp);
  return fp;
}
// The drawn area scale at (lon, lat) relative to the map centre (screen).
export function areaFactor(frames, lo, la, ref) {
  const J = screenJacobian(frames, lo * D, la * D), R = screenJacobian(frames, ref[0] * D, ref[1] * D);
  if (!J || !R) return null;
  const det = M => abs(M.E[0] * M.N[1] - M.E[1] * M.N[0]);
  return det(J) / det(R);
}

// ── routes ─────────────────────────────────────────────────────────────────
export function routeInfo(a, b) {
  const A = [a[0] * D, a[1] * D], B = [b[0] * D, b[1] * D];
  const v = vincenty(A[0], A[1], B[0], B[1]);
  const r = rhumb(A[0], A[1], B[0], B[1]);
  return {
    gcKm: gcDist(A[0], A[1], B[0], B[1]) * R_EARTH, geoKm: v ? v.m / 1000 : null,
    rhumbKm: r.dist * R_EARTH, gcBearing: (bearing(A[0], A[1], B[0], B[1]) / D + 360) % 360, rhumbBearing: (r.brg / D + 360) % 360,
  };
}
export function drawRoutes(g, frames, a, b, opt = {}) {
  const A = [a[0] * D, a[1] * D], B = [b[0] * D, b[1] * D];
  const gc = gcPath(A[0], A[1], B[0], B[1], 96).map(([lo, la]) => vec(lo, la));
  const rh = rhumbPath(A[0], A[1], B[0], B[1], 192).map(([lo, la]) => vec(lo, la));
  const draw = (pts, color, dash, w) => {
    const p = new Path2D(); addPieces(p, clipLine(pts, frames, { tol: 0.25 }), false);
    g.save(); g.setLineDash(dash); g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.stroke(p); g.restore();
  };
  if (opt.rhumb !== false) draw(rh, opt.rhumbColor ?? '#ffd666', [7, 5], 2);
  if (opt.gc !== false) draw(gc, opt.gcColor ?? '#ff7a8a', [], 2.4);
  for (const [p, lab] of [[a, opt.labels?.[0]], [b, opt.labels?.[1]]]) {
    const s = pointAt(frames, p[0] * D, p[1] * D); if (!s) continue;
    g.beginPath(); g.arc(s[0], s[1], 6, 0, 2 * PI); g.fillStyle = '#0b0f16'; g.fill(); g.lineWidth = 2.4; g.strokeStyle = '#ffffff'; g.stroke();
    if (lab) label(g, lab, s[0] + 10, s[1] - 10);
  }
}
export function label(g, text, x, y, color = '#eef2f6') {
  g.save(); g.font = '600 12px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
  g.lineWidth = 3.5; g.strokeStyle = 'rgba(5,8,13,0.85)'; g.lineJoin = 'round'; g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y); g.restore();
}

// ── measure ────────────────────────────────────────────────────────────────
// a, b: [lon, lat] degrees; sa, sb: their screen points; k: px per radian
// at the nominal scale of the map (the fit transform). Map distance is
// the straight line on the map at that scale.
export function measure(a, b, sa, sb, k) {
  const A = [a[0] * D, a[1] * D], B = [b[0] * D, b[1] * D];
  const v = vincenty(A[0], A[1], B[0], B[1]);
  const sphere = gcDist(A[0], A[1], B[0], B[1]) * R_EARTH;
  const mapKm = sa && sb ? hypot(sb[0] - sa[0], sb[1] - sa[1]) / k * R_EARTH : null;
  return { trueKm: v ? v.m / 1000 : sphere, sphereKm: sphere, mapKm, ratio: mapKm != null ? mapKm / (v ? v.m / 1000 : sphere) : null };
}
export { lonlat };
