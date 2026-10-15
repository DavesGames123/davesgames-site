// ============================================================================
//  WEATHER MAP  ·  render/fronts.js — the FRONTS layer: WPC front symbology
// ----------------------------------------------------------------------------
//  createFronts(core, opts) -> layer   (sync; the pipelines build in the
//                    background, layer.ready is a Promise, layer.error a string)
//    layer.setFronts(set)    set = loadFronts() result { analysis, forecasts }
//                            or one parsed set { valid, fronts }
//    layer.set({ visible, reveal })   visible on starts a draw-on (unless a
//                            reveal number is given); reveal 0..1 holds it
//    layer.update(frame, app) / encode(pass, frame) / destroy()   core calls
//    app fields read: t (epoch ms), layers.fronts (boolean, optional)
//
//  Symbology (CONTRACT.md FRONTS). The WPC coded bulletin lists the points
//  of a front so that the warm-air side is on the LEFT as you walk the
//  points. The sample shows it: cold fronts move to the left of their point
//  order (tests/fronts.test.mjs checks the motion). So:
//    COLD   blue line, triangles left
//    WARM   red line, semicircles left
//    STNRY  red / blue line, triangles left (blue), semicircles right (red)
//    OCFNT  purple line, triangles and semicircles in turn, both left
//    TROF   dashed orange-brown line, no symbols
//    DRYLINE tan line, open semicircles left;  SQLN magenta dash-dot-dot
//  Left at point p with walk direction T is cross(p, T) (globe space is
//  right handed: east x north = up).
//
//  Geometry is DOM-free (tested in node): the points are smoothed with a
//  centripetal Catmull-Rom spline in 3D on the unit sphere (no lat/lon
//  wrap, so the antimeridian is safe). Symbol units sit at the middle of
//  the front and at mid +- k * d0 of arc. The level of unit k is the count
//  of trailing zero bits of k, so each coarser level is a subset of the
//  finer one. The shader fades a level in when its spacing on screen is
//  more than the symbol spacing in px (unitAlpha), so symbols keep a screen
//  size and a screen spacing at every altitude without a rebuild. The mid
//  unit always shows, so a short front still has one symbol.
//
//  Morph: between two forecast sets (frontsBracket), fronts of one type are
//  paired by a chamfer distance (matchFronts). A pair is resampled to the
//  same point count by arc fraction, and the vertex shader blends the two
//  states by the eased fraction u. A front without a partner fades.
//
//  Draw order in the pass: line halos, symbol halos, line cores, symbol
//  cores, so a dark halo never crosses a coloured core.
//
//  grep -n targets: "export const STYLES", "export function smoothFront",
//  "export function frontUnits", "export function frontGeometry",
//  "export function unitAlpha", "export function matchFronts",
//  "export function buildFrontBuffers", "export function packFrontU",
//  "export function createFronts", "export const LINE_FLOATS"
// ============================================================================
import { frontsBracket } from '../data/fronts.js';

export const FRONT_R = 1.0026;           // fronts shell radius (CONTRACT.md)
export const FRONTS_ORDER = 50;          // after clouds and fields
export const LINE_FLOATS = 24;           // 6 x vec4 per line vertex
export const SYM_FLOATS = 24;            // 6 x vec4 per symbol instance
export const FRONT_U_FLOATS = 16;        // struct FrontU, 64 bytes
export const PRES = { BOTH: 0, A: 1, B: 2 };
export const KIND = { SOLID: 0, DASH: 1, DASHDOT: 2, STATIONARY: 3, TRI: 10, SEMI: 11, HOLLOW: 12 };

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// display sRGB, 0..1 (layer colours are display referred, core.js)
export const COLORS = {
  cold: [0.13, 0.42, 1.0],
  warm: [0.94, 0.16, 0.14],
  occluded: [0.66, 0.3, 0.9],
  trough: [0.87, 0.56, 0.22],
  dry: [0.86, 0.7, 0.42],
  squall: [0.95, 0.22, 0.7],
  halo: [0.03, 0.05, 0.1],
};

// units: the symbols of one unit, { kind, side (+1 left, -1 right), shift
// (along the line, in symbol radii) }. spacingPx: unit spacing on screen.
export const STYLES = {
  COLD: { label: 'Cold front', line: KIND.SOLID, color: COLORS.cold, spacingPx: 38, units: [{ kind: KIND.TRI, side: 1, shift: 0, color: COLORS.cold }] },
  WARM: { label: 'Warm front', line: KIND.SOLID, color: COLORS.warm, spacingPx: 38, units: [{ kind: KIND.SEMI, side: 1, shift: 0, color: COLORS.warm }] },
  STNRY: { label: 'Stationary front', line: KIND.STATIONARY, color: COLORS.warm, spacingPx: 60, units: [
    { kind: KIND.SEMI, side: -1, shift: -1.35, color: COLORS.warm },
    { kind: KIND.TRI, side: 1, shift: 1.35, color: COLORS.cold }] },
  OCFNT: { label: 'Occluded front', line: KIND.SOLID, color: COLORS.occluded, spacingPx: 60, units: [
    { kind: KIND.TRI, side: 1, shift: -1.35, color: COLORS.occluded },
    { kind: KIND.SEMI, side: 1, shift: 1.35, color: COLORS.occluded }] },
  TROF: { label: 'Trough', line: KIND.DASH, color: COLORS.trough, spacingPx: 0, units: [] },
  DRYLINE: { label: 'Dry line', line: KIND.SOLID, color: COLORS.dry, spacingPx: 32, units: [{ kind: KIND.HOLLOW, side: 1, shift: 0, color: COLORS.dry }] },
  SQLN: { label: 'Squall line', line: KIND.DASHDOT, color: COLORS.squall, spacingPx: 0, units: [] },
};
const STRENGTH_SCALE = { WK: 0.82, MDT: 1, STG: 1.15 };

export const DEFAULTS = {
  stepDeg: 0.2,        // smoothed point spacing
  symbolPx: 7.5,       // symbol radius, CSS px
  linePx: 1.7,         // line half width, CSS px
  haloPx: 1.5,         // dark outline, CSS px
  haloAlpha: 0.55,
  dashPx: 16,          // trough dash period, CSS px
  revealSeconds: 1.8,  // draw-on time
  fadeSeconds: 0.35,   // show / hide fade
  matchDeg: 9,         // largest chamfer distance for a morph pair
};

// ── vector helpers ──
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
const ang = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
export const toXYZ = (lat, lon) => { const p = lat * D2R, l = lon * D2R; return [Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l)]; };
export const toLatLon = v => { const n = norm(v); return [Math.asin(Math.max(-1, Math.min(1, n[1]))) * R2D, Math.atan2(-n[2], n[0]) * R2D]; };
// remove the component of v along the unit vector p, then normalize
const tangentOf = (v, p) => norm([v[0] - p[0] * dot(v, p), v[1] - p[1] * dot(v, p), v[2] - p[2] * dot(v, p)]);

// Centripetal Catmull-Rom (Barry-Goldman) point at t in [t1, t2].
function crPoint(P0, P1, P2, P3, t0, t1, t2, t3, t) {
  const L = (a, b, ta, tb) => lerp3(a, b, (t - ta) / (tb - ta));
  const A1 = L(P0, P1, t0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

// Per-point left vectors (miter joins) and the miter length factor.
function lineNormals(P, closed) {
  const n = P.length, seg = [];
  for (let i = 0; i + 1 < n; i++) {
    const c = cross(P[i], P[i + 1]);
    seg.push(Math.hypot(...c) > 1e-12 ? norm(c) : null);
  }
  for (let i = 0; i < seg.length; i++) if (!seg[i]) seg[i] = seg[i - 1] || seg.find(Boolean) || [0, 1, 0];
  const N = [], M = [];
  for (let i = 0; i < n; i++) {
    let a = seg[i - 1], b = seg[i];
    if (closed && (i === 0 || i === n - 1)) { a = seg[seg.length - 1]; b = seg[0]; }
    a = a || b; b = b || a;
    const v = tangentOf([a[0] + b[0], a[1] + b[1], a[2] + b[2]], P[i]);
    N.push(v);
    M.push(1 / Math.max(dot(v, b), 0.5));
  }
  return { N, M, seg };
}

function cumulative(P) {
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + ang(P[i - 1], P[i]));
  return cum;
}

// Smooth one front. Returns { P (unit xyz), N (left), M (miter), cum (arc,
// radians), L, closed } or null when the front has fewer than 2 points.
export function smoothFront(front, opts = {}) {
  const step = (opts.stepDeg ?? DEFAULTS.stepDeg) * D2R;
  const raw = (front.pts || []).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => toXYZ(p[0], p[1]));
  const C = [];
  for (const v of raw) if (!C.length || ang(C[C.length - 1], v) > 1e-7) C.push(v);
  let closed = opts.closed ?? (C.length >= 4 && ang(C[0], C[C.length - 1]) < 1e-4);
  if (closed && ang(C[0], C[C.length - 1]) < 1e-4) C.pop();
  if (C.length < 2) return null;
  if (C.length < 3) closed = false;
  const n = C.length;
  const ctl = i => {
    if (closed) return C[((i % n) + n) % n];
    if (i < 0) return norm(lerp3(C[1], C[0], 2));        // reflected phantom ends
    if (i >= n) return norm(lerp3(C[n - 2], C[n - 1], 2));
    return C[i];
  };
  const P = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const P0 = ctl(i - 1), P1 = ctl(i), P2 = ctl(i + 1), P3 = ctl(i + 2);
    const d = (a, b) => Math.max(Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])), 1e-6);
    const t0 = 0, t1 = t0 + d(P0, P1), t2 = t1 + d(P1, P2), t3 = t2 + d(P2, P3);
    const m = Math.max(1, Math.ceil(ang(P1, P2) / step));
    for (let k = 0; k < m; k++) P.push(norm(crPoint(P0, P1, P2, P3, t0, t1, t2, t3, t1 + (t2 - t1) * k / m)));
  }
  P.push(closed ? P[0] : C[n - 1]);
  // a spline bulge can make a sub-step longer than step: split those
  const Q = [P[0]];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], m = Math.ceil(ang(a, b) / step - 1e-9);
    for (let k = 1; k < m; k++) Q.push(norm(lerp3(a, b, k / m)));
    Q.push(b);
  }
  const cum = cumulative(Q);
  const { N, M } = lineNormals(Q, closed);
  return { P: Q, N, M, cum, L: cum[cum.length - 1], closed };
}

// Point, left vector and walk tangent at arc length s on a smoothed front.
export function sampleAt(g, s) {
  const { P, N, cum } = g;
  const x = Math.max(0, Math.min(g.L, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= x) lo = mid; else hi = mid; }
  const span = cum[hi] - cum[lo], u = span > 0 ? (x - cum[lo]) / span : 0;
  const p = norm(lerp3(P[lo], P[hi], u));
  const left = tangentOf(lerp3(N[lo], N[hi], u), p);
  return { p, left, tangent: cross(left, p) };
}

// Resample to n points at equal arc fractions (for morph pairs).
export function resample(g, n) {
  const P = [];
  for (let i = 0; i < n; i++) P.push(sampleAt(g, g.L * i / (n - 1)).p);
  if (g.closed) P[n - 1] = P[0];
  const { N, M } = lineNormals(P, g.closed);
  const cum = cumulative(P);
  return { P, N, M, cum, L: cum[n - 1], closed: g.closed };
}

const ctz = k => { let c = 0; while (k > 0 && !(k & 1)) { k >>= 1; c++; } return c; };
export const MID_LEVEL = 99;
export const BIG = 1e9;

// Base unit spacing (radians) for a front of length L.
export const unitBase = L => Math.max(0.001, L / 256);

// Symbol units along a front of length L: { s, f, level, unitRad, edge }.
// unitRad = d0 * 2^level is the spacing of that level; the mid unit has
// level MID_LEVEL, unitRad BIG and edge BIG (it always shows).
export function frontUnits(L, closed, d0 = unitBase(L)) {
  const out = [{ s: L / 2, f: 0.5, level: MID_LEVEL, unitRad: BIG, edge: BIG, k: 0 }];
  if (!(L > 0)) return out;
  for (let k = 1; k * d0 <= L / 2 - d0 * 0.5; k++) {
    const level = Math.min(ctz(k), 30), unitRad = d0 * 2 ** level;
    for (const sg of [-1, 1]) {
      const s = L / 2 + sg * k * d0;
      out.push({ s, f: s / L, level, unitRad, edge: closed ? BIG : Math.min(s, L - s), k: sg * k });
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

// Shader mirror: how visible a unit of level spacing unitRad is when the
// symbol spacing on screen needs neededRad of arc. 1 when unitRad >=
// neededRad, 0 at half of it.
export function unitAlpha(unitRad, neededRad) {
  return Math.max(0, Math.min(1, Math.log2(unitRad / neededRad) + 1));
}

// Full geometry of one front (the tested pure helper).
// opts: { stepDeg, d0, symbolRad (arc radius of one symbol, for the apex) }
export function frontGeometry(front, opts = {}) {
  const style = STYLES[front.type] || STYLES.TROF;
  const g = smoothFront(front, opts);
  if (!g) return null;
  const d0 = opts.d0 ?? unitBase(g.L);
  const rad = opts.symbolRad ?? 0.01;
  const symbols = [];
  if (style.units.length) {
    for (const u of frontUnits(g.L, g.closed, d0)) {
      const at = sampleAt(g, u.s);
      for (const sym of style.units) {
        const facing = at.left.map(v => v * sym.side);
        const center = norm(at.p.map((v, i) => v + at.tangent[i] * sym.shift * rad));
        const apex = norm(center.map((v, i) => v + facing[i] * rad * 1.3));
        symbols.push({
          s: u.s, f: u.f, level: u.level, unitRad: u.unitRad, edge: u.edge, k: u.k,
          kind: sym.kind, side: sym.side, shift: sym.shift, color: sym.color,
          p: at.p, left: at.left, tangent: at.tangent, facing,
          latlon: toLatLon(at.p), apex: toLatLon(apex),
        });
      }
    }
  }
  return {
    type: front.type, style, closed: g.closed, length: g.L, d0,
    line: g, latlon: g.P.map(toLatLon), symbols,
  };
}

// ── morph pairing ──
function chamfer(ga, gb, n = 16) {
  const A = [], B = [];
  for (let i = 0; i < n; i++) { A.push(sampleAt(ga, ga.L * i / (n - 1)).p); B.push(sampleAt(gb, gb.L * i / (n - 1)).p); }
  const one = (X, Y) => X.reduce((sum, x) => sum + Math.min(...Y.map(y => ang(x, y))), 0) / X.length;
  return (one(A, B) + one(B, A)) / 2;
}

// Pair fronts of set a with fronts of set b: same type, same closed state,
// chamfer distance under maxDeg, length ratio 1/4..4. Greedy, best first.
// geoms: optional prebuilt smoothFront arrays { a: [], b: [] }.
export function matchFronts(a, b, opts = {}, geoms = null) {
  const fa = (a && a.fronts) || [], fb = (b && b.fronts) || [];
  const ga = geoms ? geoms.a : fa.map(f => smoothFront(f, opts));
  const gb = geoms ? geoms.b : fb.map(f => smoothFront(f, opts));
  const max = (opts.matchDeg ?? DEFAULTS.matchDeg) * D2R;
  const cand = [];
  for (let i = 0; i < fa.length; i++) {
    if (!ga[i]) continue;
    for (let j = 0; j < fb.length; j++) {
      if (!gb[j] || fa[i].type !== fb[j].type || ga[i].closed !== gb[j].closed) continue;
      const r = ga[i].L / Math.max(gb[j].L, 1e-9);
      if (r > 4 || r < 0.25) continue;
      const c = chamfer(ga[i], gb[j]);
      if (c <= max) cand.push([c, i, j]);
    }
  }
  cand.sort((x, y) => x[0] - y[0]);
  const ua = new Set(), ub = new Set(), pairs = [];
  for (const [c, i, j] of cand) {
    if (ua.has(i) || ub.has(j)) continue;
    ua.add(i); ub.add(j); pairs.push([i, j, c]);
  }
  return {
    pairs,
    aOnly: fa.map((_, i) => i).filter(i => ga[i] && !ua.has(i)),
    bOnly: fb.map((_, j) => j).filter(j => gb[j] && !ub.has(j)),
  };
}

// ── GPU buffers ──
// Line vertex (2 per point, across -1 / +1), 6 x vec4:
//   pA.xyz f | pB.xyz sRel | nA.xyz miterA | nB.xyz miterB | rgb width | across kind pres d0
// Symbol instance, 6 x vec4:
//   pA.xyz f | pB.xyz edge | leftA.xyz spacingPx | leftB.xyz unitRad | rgb size | kind side shift pres
function pushFront(out, front, gA, gB, pres) {
  const style = STYLES[front.type] || STYLES.TROF;
  const scale = STRENGTH_SCALE[front.strength] || 1;
  const n = Math.max(gA.P.length, gB.P.length, 2);
  const A = gA === gB && gA.P.length === n ? gA : resample(gA, n);
  const B = gB === gA ? A : resample(gB, n);
  const Lbar = (gA.L + gB.L) / 2;
  const d0 = unitBase(Lbar);
  const base = out.lineVerts;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    for (const across of [-1, 1]) {
      out.line.push(
        ...A.P[i], f, ...B.P[i], (f - 0.5) * Lbar,
        ...A.N[i], A.M[i], ...B.N[i], B.M[i],
        ...style.color, scale, across, style.line, pres, d0);
      out.lineVerts++;
    }
  }
  for (let i = 0; i + 1 < n; i++) {
    const v = base + 2 * i;
    out.index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  if (!style.units.length) return;
  for (const u of frontUnits(Lbar, gA.closed, d0)) {
    const a = sampleAt(A, u.f * A.L), b = sampleAt(B, u.f * B.L);
    for (const sym of style.units) {
      out.sym.push(
        ...a.p, u.f, ...b.p, u.edge,
        ...a.left, style.spacingPx, ...b.left, u.unitRad,
        ...sym.color, scale, sym.kind, sym.side, sym.shift, pres);
      out.nSym++;
    }
  }
}

// Buffers for the bracket (a, b). a === b (or no b) draws one static set.
export function buildFrontBuffers(a, b = a, opts = {}) {
  const out = { line: [], index: [], sym: [], lineVerts: 0, nSym: 0, pairs: 0, fadeOut: 0, fadeIn: 0 };
  const fa = (a && a.fronts) || [];
  const ga = fa.map(f => smoothFront(f, opts));
  if (!b || b === a) {
    fa.forEach((f, i) => { if (ga[i]) { pushFront(out, f, ga[i], ga[i], PRES.BOTH); out.pairs++; } });
  } else {
    const fb = b.fronts || [];
    const gb = fb.map(f => smoothFront(f, opts));
    const m = matchFronts(a, b, opts, { a: ga, b: gb });
    for (const [i, j] of m.pairs) pushFront(out, fa[i], ga[i], gb[j], PRES.BOTH);
    for (const i of m.aOnly) pushFront(out, fa[i], ga[i], ga[i], PRES.A);
    for (const j of m.bOnly) pushFront(out, fb[j], gb[j], gb[j], PRES.B);
    out.pairs = m.pairs.length; out.fadeOut = m.aOnly.length; out.fadeIn = m.bOnly.length;
  }
  return {
    line: new Float32Array(out.line), index: new Uint32Array(out.index), sym: new Float32Array(out.sym),
    lineVerts: out.lineVerts, nIndex: out.index.length, nSym: out.nSym,
    pairs: out.pairs, fadeOut: out.fadeOut, fadeIn: out.fadeIn,
  };
}

export const ease = u => u * u * (3 - 2 * u);

// struct FrontU (shaders/fronts.wgsl)
// st: { u, reveal, alpha, symbolPx, linePx, haloPx, dashPx, haloAlpha }
export function packFrontU(st, out = new Float32Array(FRONT_U_FLOATS)) {
  const o = { ...DEFAULTS, ...st };
  out.set([
    o.u ?? 0, o.reveal ?? 1, o.alpha ?? 1, STYLES.STNRY.spacingPx,
    o.symbolPx, o.linePx, o.haloPx, o.dashPx,
    ...COLORS.cold, o.haloAlpha,
    ...COLORS.halo, 0,
  ]);
  return out;
}

// One set or a loadFronts() result to a { a, b, u } bracket at time t.
export function bracketOf(set, t) {
  if (!set) return null;
  if (Array.isArray(set.fronts)) return { a: set, b: set, u: 0 };
  return frontsBracket(set, t);
}

// Short summary for UI legends: the style label and colour of each type.
export function frontLegend() {
  return Object.entries(STYLES).map(([type, s]) => ({ type, label: s.label, color: s.color }));
}

// ── the layer ──
export function createFronts(core, opts = {}) {
  const { device } = core;
  const cfg = { ...DEFAULTS, ...opts };
  const st = { set: null, version: 0, key: '', visible: true, alpha: 0, reveal: 0, revealAuto: true, u: 0 };
  const uPack = new Float32Array(FRONT_U_FLOATS);
  let pipes = null, uBuf = null, group = null;
  let lineBuf = null, idxBuf = null, symBuf = null, counts = { nIndex: 0, nSym: 0 };

  const grow = (buf, bytes, usage, label) => {
    if (buf && buf.size >= bytes) return buf;
    if (buf) buf.destroy();
    let size = 256;
    while (size < bytes) size *= 2;
    return device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST });
  };

  function rebuild(br) {
    const B = buildFrontBuffers(br.a, br.b, cfg);
    layer.stats = { lines: B.lineVerts, symbols: B.nSym, pairs: B.pairs, fadeOut: B.fadeOut, fadeIn: B.fadeIn };
    counts = { nIndex: B.nIndex, nSym: B.nSym };
    if (B.line.length) {
      lineBuf = grow(lineBuf, B.line.byteLength, GPUBufferUsage.VERTEX, 'fronts lines');
      device.queue.writeBuffer(lineBuf, 0, B.line);
      idxBuf = grow(idxBuf, B.index.byteLength, GPUBufferUsage.INDEX, 'fronts index');
      device.queue.writeBuffer(idxBuf, 0, B.index);
    }
    if (B.sym.length) {
      symBuf = grow(symBuf, B.sym.byteLength, GPUBufferUsage.VERTEX, 'fronts symbols');
      device.queue.writeBuffer(symBuf, 0, B.sym);
    }
  }

  async function build() {
    const code = (core.frameWGSL || await core.loadText('shaders/frame.wgsl')) + '\n' + await core.loadText('shaders/fronts.wgsl');
    const module = device.createShaderModule({ label: 'weather fronts', code });
    if (module.getCompilationInfo) {
      const info = await module.getCompilationInfo();
      const errs = info.messages.filter(m => m.type === 'error');
      if (errs.length) throw new Error('fronts.wgsl: ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
    }
    const layout = device.createBindGroupLayout({ label: 'fronts', entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    uBuf = device.createBuffer({ label: 'fronts uniform', size: FRONT_U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    group = device.createBindGroup({ label: 'fronts', layout, entries: [{ binding: 0, resource: { buffer: uBuf } }] });
    const pLayout = device.createPipelineLayout({ bindGroupLayouts: [core.frameLayout, layout] });
    const attrs = Array.from({ length: 6 }, (_, i) => ({ shaderLocation: i, offset: i * 16, format: 'float32x4' }));
    const target = [{ format: core.format, blend: core.PREMUL_BLEND }];
    const mk = (vs, fs, topology, stepMode) => device.createRenderPipelineAsync({
      label: 'fronts ' + fs, layout: pLayout,
      vertex: { module, entryPoint: vs, buffers: [{ arrayStride: 96, stepMode, attributes: attrs }] },
      fragment: { module, entryPoint: fs, targets: target },
      primitive: { topology, cullMode: 'none' },
      depthStencil: core.LAYER_DEPTH,
    });
    const [lineHalo, symHalo, lineCore, symCore] = await Promise.all([
      mk('vsLine', 'fsLineHalo', 'triangle-list', 'vertex'),
      mk('vsSym', 'fsSymHalo', 'triangle-strip', 'instance'),
      mk('vsLine', 'fsLineCore', 'triangle-list', 'vertex'),
      mk('vsSym', 'fsSymCore', 'triangle-strip', 'instance'),
    ]);
    pipes = { lineHalo, symHalo, lineCore, symCore };
  }

  const layer = {
    name: 'fronts', order: opts.order ?? FRONTS_ORDER, error: null, stats: null,
    get state() { return { visible: st.visible, alpha: st.alpha, reveal: st.reveal, u: st.u, key: st.key }; },
    setFronts(set) {
      const first = !st.set;
      st.set = set || null; st.version++; st.key = '';
      if (first && st.revealAuto) st.reveal = 0;
    },
    set(o = {}) {
      if (typeof o.visible === 'boolean' && o.visible !== st.visible) {
        st.visible = o.visible;
        if (o.visible && typeof o.reveal !== 'number') { st.reveal = 0; st.revealAuto = true; }
      }
      if (typeof o.reveal === 'number') { st.reveal = Math.max(0, Math.min(1, o.reveal)); st.revealAuto = false; }
      if (o.auto === true) st.revealAuto = true;
    },
    update(frame, app = {}) {
      const want = app.layers && typeof app.layers.fronts === 'boolean' ? app.layers.fronts : null;
      if (want !== null && want !== st.visible) layer.set({ visible: want });
      const dt = frame.dt || 0;
      const target = st.visible ? 1 : 0;
      const k = dt / cfg.fadeSeconds;
      st.alpha = target > st.alpha ? Math.min(target, st.alpha + k) : Math.max(target, st.alpha - k);
      if (st.revealAuto && st.visible && st.set && pipes) st.reveal = Math.min(1, st.reveal + dt / cfg.revealSeconds);
      const br = bracketOf(st.set, frame.t ?? app.t ?? Date.now());
      if (br && pipes) {
        const key = `${st.version}:${br.a.valid}:${br.b.valid}`;
        if (key !== st.key) { st.key = key; rebuild(br); }
      }
      st.u = br ? ease(Math.max(0, Math.min(1, br.u))) : 0;
      if (uBuf) device.queue.writeBuffer(uBuf, 0, packFrontU({ ...cfg, u: st.u, reveal: st.reveal, alpha: st.alpha }, uPack));
    },
    encode(pass) {
      if (!pipes || st.alpha <= 0.001 || !st.key) return;
      pass.setBindGroup(1, group);
      const lines = counts.nIndex > 0 && lineBuf, syms = counts.nSym > 0 && symBuf;
      const drawLine = p => { pass.setPipeline(p); pass.setVertexBuffer(0, lineBuf); pass.setIndexBuffer(idxBuf, 'uint32'); pass.drawIndexed(counts.nIndex); };
      const drawSym = p => { pass.setPipeline(p); pass.setVertexBuffer(0, symBuf); pass.draw(4, counts.nSym); };
      if (lines) drawLine(pipes.lineHalo);
      if (syms) drawSym(pipes.symHalo);
      if (lines) drawLine(pipes.lineCore);
      if (syms) drawSym(pipes.symCore);
    },
    destroy() {
      for (const b of [uBuf, lineBuf, idxBuf, symBuf]) if (b) b.destroy();
      uBuf = lineBuf = idxBuf = symBuf = null; pipes = null;
    },
  };
  layer.ready = build().then(() => layer, e => { layer.error = String(e && e.message || e); console.warn('[weather fronts]', layer.error); return layer; });
  return layer;
}
