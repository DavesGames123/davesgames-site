// ============================================================================
//  BIOME PARTS  ·  part.js — the feature tape as a signed distance field
// ----------------------------------------------------------------------------
//  PURE. fcsim.js keeps the solid as a tape of ops (one per sketch profile of
//  a feature, plus a shell). This module evaluates the tape as a distance
//  field in three places that must agree: the WGSL the renderer runs, the CPU
//  field (tests, IoU, marching cubes) and the packed parameter buffer.
//
//  THE FIELD (FreeCAD frame, millimetres; the renderer is +Y up in world
//  units: p_fc = (x, -z, y) * MM, d_world = d_fc / MM)
//    prism op    a 2D profile (rect, circle, hex; vertical round rv)
//                extruded along the sketch normal n over [z0, z1]
//                top round r:  max(d, |max(d2 + r, w - z1 + r, 0)| ... - r)
//                top chamfer:  max(d, (d2 + w - z1 + s) / sqrt 2)
//    revolve op  the profile in (radius, height) about the sketch v axis
//    add / sub   min(d, tool) / max(d, -tool)
//    patterns    DOMAIN REPETITION: polar folds the angle about Z into the
//                nearest copy (and its neighbour), linear folds x into the
//                nearest of n slots, mirror takes the nearer of x and -x
//    shell       max(d, -(d_before(p') + t)), p' = p pulled back along the
//                open face normal to the plane t below the face, so the
//                cavity runs out through the removed face
//
//  THE BUFFER  (vec4 slots; header slot 0, then OP_SLOTS per op)
//    0  count, mm per world unit, shell op index (-1), time
//    b+0  type (1 add, 2 sub, 3 shell), geom (0 prism, 1 revolve), prof (0 rect,
//         1 circle, 2 hex), pattern (0 none, 1 polar, 2 linear, 3 mirror)
//    b+1  o.xyz, pattern n        b+2  u.xyz, pattern step (polar: a0)
//    b+3  v.xyz, op id            b+4  n.xyz, explode (mm along +Z)
//    b+5  cu, cv, a, b            b+6  z0, z1, top round, top chamfer
//    b+7  vertical round, shell t, shell offset, linear x0
//    b+8  appear (0..1), colour index, 0, 0
//
//  GREP MAP
//    MAX_OPS / OP_SLOTS / packTape ..... the buffer
//    WGSL_PART ......................... mapD, mapM, ghostD for shader.FRAME
//    fieldFC / fieldWorld .............. the CPU field
//    volumeOf / iou .................... voxel measures (tests, success check)
//    meshOf / toSTL .................... marching cubes (sdf-lab mc.js) to STL
//    toSdfLabDoc ....................... an approximate SDF Forge document
// ============================================================================
import { polygonize, meshStats, vertexNormals } from '../../sdf-lab/js/mc.js';
import * as D from '../../sdf-lab/js/doc.js';

export const MAX_OPS = 48, OP_SLOTS = 9, MM = 10, LIFT = 1.5;
const TYPE = { add: 1, sub: 2, shell: 3 }, PROF = { rect: 0, circle: 1, hex: 2 }, PAT = { polar: 1, linear: 2, mirror: 3 };
const DIRV = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
const BIG = 1e4;

// Global centre of an op's profile (for pattern origins).
function opCentre(op) {
  const F = op.F, p = op.p;
  return [0, 1, 2].map(i => F.o[i] + F.u[i] * p.cu + F.v[i] * p.cv);
}

// opts: { appear: {opIndex: 0..1}, explode: mm, colour: (op) -> index }
export function packTape(ops, out = new Float32Array((1 + MAX_OPS * OP_SLOTS) * 4), opts = {}) {
  out.fill(0);
  const n = Math.min(ops.length, MAX_OPS);
  let shell = -1;
  for (let i = 0; i < n; i++) {
    const op = ops[i], b = (1 + i * OP_SLOTS) * 4;
    if (op.type === 'shell') {
      if (shell < 0) shell = i;
      out[b] = 3; out.set(DIRV[op.dir] || [0, 0, 1], b + 16);
      out[b + 29] = op.t; out[b + 30] = op.off;
      out[b + 32] = 1;
      continue;
    }
    out[b] = TYPE[op.type]; out[b + 1] = op.geom === 'revolve' ? 1 : 0; out[b + 2] = PROF[op.p.kind]; out[b + 3] = op.pat ? PAT[op.pat.kind] : 0;
    out.set(op.F.o, b + 4); out[b + 7] = op.pat ? op.pat.n : 1;
    out.set(op.F.u, b + 8);
    const c = opCentre(op);
    out[b + 11] = op.pat && op.pat.kind === 'polar' ? Math.atan2(c[1], c[0]) : op.pat ? op.pat.step : 0;
    out.set(op.F.v, b + 12); out[b + 15] = op.id || 0;
    out.set(op.F.n, b + 16); out[b + 19] = op.type === 'add' && opts.explodeOf ? opts.explodeOf(i, op) : 0;
    out[b + 20] = op.p.cu; out[b + 21] = op.p.cv; out[b + 22] = op.p.a; out[b + 23] = op.p.b;
    out[b + 24] = Math.max(op.z0, -(opts.depthClamp || BIG)); out[b + 25] = op.z1; out[b + 26] = op.rTop || 0; out[b + 27] = op.chTop || 0;
    out[b + 28] = op.rVert || 0; out[b + 31] = c[0];
    out[b + 32] = opts.appearOf ? opts.appearOf(i, op) : 1;
    out[b + 33] = opts.colourOf ? opts.colourOf(i, op) : 0;
  }
  out[0] = n; out[1] = MM; out[2] = shell; out[3] = opts.time || 0;
  return out;
}

// ── the CPU field (the same operations as WGSL_PART, in the same order) ────
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function box2(x, y, a, b) {
  const qx = Math.abs(x) - a, qy = Math.abs(y) - b;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}
function hex2(x, y, ap) {   // flats at +-y, apothem ap (Quilez sdHexagon)
  const kx = -0.8660254, ky = 0.5, kz = 0.57735027;
  let px = Math.abs(x), py = Math.abs(y);
  const t = 2 * Math.min(kx * px + ky * py, 0);
  px -= t * kx; py -= t * ky;
  px -= clamp(px, -kz * ap, kz * ap); py -= ap;
  return Math.hypot(px, py) * Math.sign(py);
}
function prof2(P, b, x, y) {
  const kind = P[b + 2], a = P[b + 22], bb = P[b + 23], rv = P[b + 28];
  if (kind === 1) return Math.hypot(x, y) - a;
  if (kind === 0) { const r = Math.min(rv, a, bb); return box2(x, y, a - r, bb - r) - r; }
  const ap = a * 0.8660254, r = Math.min(rv, ap);
  return hex2(x, y, ap - r) - r;
}
const quad = (a, b) => Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
// One tool at a point q (FC frame), no pattern.
function toolAt(P, b, q0, q1, q2) {
  const ox = q0 - P[b + 4], oy = q1 - P[b + 5], oz = q2 - (P[b + 6] + P[b + 19]);
  const lu = ox * P[b + 8] + oy * P[b + 9] + oz * P[b + 10];
  const lv = ox * P[b + 12] + oy * P[b + 13] + oz * P[b + 14];
  const ln = ox * P[b + 16] + oy * P[b + 17] + oz * P[b + 18];
  const cu = P[b + 20], cv = P[b + 21], rT = P[b + 26], cT = P[b + 27], ap = P[b + 32];
  if (P[b + 1] === 1) {   // revolve about v
    const r = Math.hypot(lu, ln);
    let d = Math.min(prof2(P, b, r - cu, lv - cv), prof2(P, b, -r - cu, lv - cv));
    const top = cv + P[b + 23], out = cu + P[b + 22];
    if (rT > 0) d = Math.max(d, quad(r - (out - rT), lv - (top - rT)) - rT);
    if (cT > 0) d = Math.max(d, (r - out + lv - top + cT) * 0.70710678);
    return d;
  }
  // appear: a pad grows from its sketch, a cut sinks from its sketch
  const sub = P[b] === 2, zs = P[b + 24], ze = P[b + 25];
  // a cut starts LIFT mm above its sketch plane: a tool cap that lies in
  // the face it cuts leaves a zero-thickness skin in a distance field, and
  // a small lift still leaves a valley of distance LIFT / 2 that a sphere
  // tracer with a pixel-sized hit test stops in. 1.5 mm keeps the valley
  // above the hit threshold at phone resolutions.
  const z0 = sub ? ze - (ze - zs) * ap : zs, z1 = sub ? ze + LIFT : zs + (ze - zs) * ap;
  const d2 = prof2(P, b, lu - cu, lv - cv);
  const dz = Math.max(z0 - ln, ln - z1);
  let d = Math.min(Math.max(d2, dz), 0) + Math.hypot(Math.max(d2, 0), Math.max(dz, 0));
  if (rT > 0) d = Math.max(d, quad(d2 + rT, ln - z1 + rT) - rT);
  if (cT > 0) d = Math.max(d, (d2 + ln - z1 + cT) * 0.70710678);
  return d;
}
// A tool with its pattern copies (domain repetition: nearest copy and its neighbour).
function patTool(P, b, q0, q1, q2) {
  const pk = P[b + 3], n = P[b + 7];
  if (pk === 0) return toolAt(P, b, q0, q1, q2);
  if (pk === 3) return Math.min(toolAt(P, b, q0, q1, q2), toolAt(P, b, -q0, q1, q2));
  if (pk === 1) {
    const sec = 2 * Math.PI / n, a0 = P[b + 11];
    const k = Math.round((Math.atan2(q1, q0) - a0) / sec);
    let d = 1e9;
    for (const kk of [k - 1, k, k + 1]) {
      const t = -kk * sec, c = Math.cos(t), s = Math.sin(t);
      d = Math.min(d, toolAt(P, b, c * q0 - s * q1, s * q0 + c * q1, q2));
    }
    return d;
  }
  const st = P[b + 11], x0 = P[b + 31];
  const k = clamp(Math.round((q0 - x0) / st), 0, n - 1);
  let d = 1e9;
  for (const kk of [Math.max(k - 1, 0), k, Math.min(k + 1, n - 1)]) d = Math.min(d, toolAt(P, b, q0 - kk * st, q1, q2));
  return d;
}
// Ops [from, to) applied to (d, id).
function stack(P, q0, q1, q2, d, id, from, to) {
  for (let i = from; i < to; i++) {
    const b = (1 + i * OP_SLOTS) * 4, ty = P[b];
    if (ty === 3) continue;
    const t = patTool(P, b, q0, q1, q2);
    if (ty === 1) { if (t < d) { d = t; id = P[b + 15]; } }
    else if (-t > d) { d = -t; id = P[b + 15]; }
  }
  return [d, id];
}
export function fieldFC(P, q0, q1, q2) {
  const n = P[0], sh = P[2];
  if (sh < 0) return stack(P, q0, q1, q2, 1e9, 0, 0, n);
  let r = stack(P, q0, q1, q2, 1e9, 0, 0, sh);
  const b = (1 + sh * OP_SLOTS) * 4, nx = P[b + 16], ny = P[b + 17], nz = P[b + 18], t = P[b + 29], off = P[b + 30];
  const w = q0 * nx + q1 * ny + q2 * nz, back = Math.max(w - (off - 2 * t), 0);
  const c = stack(P, q0 - nx * back, q1 - ny * back, q2 - nz * back, 1e9, 0, 0, sh)[0] + t;
  if (-c > r[0]) r = [-c, P[(1 + sh * OP_SLOTS) * 4 + 15]];
  return stack(P, q0, q1, q2, r[0], r[1], sh + 1, n);
}
// World (+Y up, units) -> distance in units.
export const fieldWorld = P => (x, y, z) => fieldFC(P, x * MM, -z * MM, y * MM)[0] / MM;

// ── measures ────────────────────────────────────────────────────────────────
export function tapeBounds(A, pad = 2) {
  return { lo: A.bbox[0].map(v => v - pad), hi: A.bbox[1].map(v => v + pad) };
}
// Voxel volume (mm^3) of a packed tape inside FC bounds.
export function volumeOf(P, bounds, res = 64) {
  const s = [0, 1, 2].map(i => (bounds.hi[i] - bounds.lo[i]) / res);
  let n = 0;
  for (let k = 0; k < res; k++) for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    if (fieldFC(P, bounds.lo[0] + (i + 0.5) * s[0], bounds.lo[1] + (j + 0.5) * s[1], bounds.lo[2] + (k + 0.5) * s[2])[0] < 0) n++;
  }
  return n * s[0] * s[1] * s[2];
}
export function iou(opsA, opsB, bounds, res = 48) {
  const PA = packTape(opsA), PB = packTape(opsB);
  const s = [0, 1, 2].map(i => (bounds.hi[i] - bounds.lo[i]) / res);
  let I = 0, Un = 0;
  for (let k = 0; k < res; k++) for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = bounds.lo[0] + (i + 0.5) * s[0], y = bounds.lo[1] + (j + 0.5) * s[1], z = bounds.lo[2] + (k + 0.5) * s[2];
    const a = fieldFC(PA, x, y, z)[0] < 0, b = fieldFC(PB, x, y, z)[0] < 0;
    if (a && b) I++; if (a || b) Un++;
  }
  return Un ? I / Un : 0;
}

// ── mesh export ─────────────────────────────────────────────────────────────
// Marching cubes in millimetres, FreeCAD axes (Z up), like an STL from CAD.
export function meshOf(ops, A, res = 96) {
  const P = packTape(ops);
  const f = (x, y, z) => fieldFC(P, x, y, z)[0];
  const m = polygonize(f, tapeBounds(A, 1.5), res);
  return { m, stats: meshStats(m), N: vertexNormals(f, m.pos, m.h * 0.5) };
}
export function toSTL(m, name = 'biome_part') {
  const out = [`solid ${name}`];
  const P = m.pos, r = x => x.toExponential(6);
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    out.push(` facet normal ${r(nx)} ${r(ny)} ${r(nz)}`, '  outer loop',
      `   vertex ${r(P[a])} ${r(P[a + 1])} ${r(P[a + 2])}`, `   vertex ${r(P[b])} ${r(P[b + 1])} ${r(P[b + 2])}`, `   vertex ${r(P[c])} ${r(P[c + 1])} ${r(P[c + 2])}`,
      '  endloop', ' endfacet');
  }
  out.push(`endsolid ${name}`);
  return out.join('\n') + '\n';
}

// ── SDF Forge hand-off ──────────────────────────────────────────────────────
// An APPROXIMATE SDF Forge document: prisms become box / cylinder / hexprism
// primitives, cuts become Subtract groups, pattern copies are written out,
// a vertical round becomes a RoundBox, the top round and chamfer and the
// shell are left out (SDF Forge has no top-only round). Units: 1 = 10 mm,
// +Y up, the same frame the renderer uses.
export function toSdfLabDoc(ops) {
  const doc = D.newDoc();
  const steel = { color: [0.72, 0.74, 0.78], rough: 0.35, metal: 0.6 };
  const prims = [];
  const instancesOf = op => {
    const c = opCentre(op), list = [c];
    if (!op.pat) return list;
    if (op.pat.kind === 'mirror') return [c, [-c[0], c[1], c[2]]];
    const out = [];
    for (let k = 0; k < op.pat.n; k++) {
      if (op.pat.kind === 'polar') { const a = 2 * Math.PI * k / op.pat.n, co = Math.cos(a), si = Math.sin(a); out.push([co * c[0] - si * c[1], si * c[0] + co * c[1], c[2]]); }
      else out.push([c[0] + k * op.pat.step, c[1], c[2]]);
    }
    return out;
  };
  for (const op of ops) {
    if (op.type === 'shell' || op.geom !== 'prism' || Math.abs(Math.abs(op.F.n[2]) - 1) > 1e-6) continue;
    const z0 = Math.max(op.z0, -200), z1 = op.z1, h = (z1 - z0) / MM, sgn = op.F.n[2];
    for (const c of instancesOf(op)) {
      const zc = (op.F.o[2] + sgn * (z0 + z1) / 2) / MM;
      const pos = [c[0] / MM, zc, -c[1] / MM];
      const p = op.p;
      let n;
      if (p.kind === 'circle') n = D.makePrim(doc, 'cylinder', { pos, p: { r: p.a / MM, h }, mat: steel });
      else if (p.kind === 'hex') n = D.makePrim(doc, 'hexprism', { pos, p: { r: p.a * 0.8660254 / MM, h }, mat: steel });
      else if (op.rVert) n = D.makePrim(doc, 'roundbox', { pos, p: { w: 2 * p.a / MM, h, d: 2 * p.b / MM, r: op.rVert / MM }, mat: steel });
      else n = D.makePrim(doc, 'box', { pos, p: { w: 2 * p.a / MM, h, d: 2 * p.b / MM }, mat: steel });
      prims.push([op.type, n]);
    }
  }
  if (!prims.length) return doc;
  // left to right: a union of the solids so far, minus the cuts that follow
  let cur = null;
  for (const [type, n] of prims) {
    if (!cur) { D.addNode(doc, n); cur = n; continue; }
    const g = D.makeGroup(doc, type === 'add' ? 'union' : 'subtract');
    D.addNode(doc, g);
    D.moveNode(doc, cur.id, g.id);
    D.addNode(doc, n, g.id);
    cur = g;
  }
  return doc;
}

// ── WGSL: mapD / mapM / ghostD over the tape, for shader.FRAME ─────────────
export const WGSL_PART = /* wgsl */`
// LIFT ${LIFT} mm: see toolAt in part.js
@group(0) @binding(1) var<storage, read> P: array<vec4f>;
const OPS: u32 = 9u;
fn box2(p: vec2f, b: vec2f) -> f32 { let q = abs(p) - b; return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0); }
fn hex2(p0: vec2f, ap: f32) -> f32 {
  let k = vec3f(-0.8660254, 0.5, 0.57735027);
  var p = abs(p0);
  p = p - 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p = p - vec2f(clamp(p.x, -k.z * ap, k.z * ap), ap);
  return length(p) * sign(p.y);
}
fn prof2(b: u32, q: vec2f) -> f32 {
  let h = P[b]; let s = P[b + 5u]; let kind = i32(h.z); let rv = P[b + 7u].x;
  if (kind == 1) { return length(q) - s.z; }
  if (kind == 0) { let r = min(rv, min(s.z, s.w)); return box2(q, vec2f(s.z - r, s.w - r)) - r; }
  let ap = s.z * 0.8660254; let r = min(rv, ap);
  return hex2(q, ap - r) - r;
}
fn quad2(a: f32, b: f32) -> f32 { return length(max(vec2f(a, b), vec2f(0.0))) + min(max(a, b), 0.0); }
fn toolAt(b: u32, q: vec3f) -> f32 {
  let h = P[b]; let o = P[b + 1u]; let u = P[b + 2u]; let v = P[b + 3u]; let n = P[b + 4u];
  let s = P[b + 5u]; let z = P[b + 6u]; let ap = P[b + 8u].x;
  let rel = q - vec3f(o.x, o.y, o.z + n.w);
  let l = vec3f(dot(rel, u.xyz), dot(rel, v.xyz), dot(rel, n.xyz));
  if (i32(h.y) == 1) {
    let r = length(vec2f(l.x, l.z));
    var d = min(prof2(b, vec2f(r - s.x, l.y - s.y)), prof2(b, vec2f(-r - s.x, l.y - s.y)));
    let top = s.y + s.w; let outR = s.x + s.z;
    if (z.z > 0.0) { d = max(d, quad2(r - (outR - z.z), l.y - (top - z.z)) - z.z); }
    if (z.w > 0.0) { d = max(d, (r - outR + l.y - top + z.w) * 0.70710678); }
    return d;
  }
  let sub = i32(h.x) == 2;
  let z0 = select(z.x, z.y - (z.y - z.x) * ap, sub);
  let z1 = select(z.x + (z.y - z.x) * ap, z.y + ${LIFT}, sub);
  let d2 = prof2(b, l.xy - s.xy);
  let dz = max(z0 - l.z, l.z - z1);
  var d = min(max(d2, dz), 0.0) + length(max(vec2f(d2, dz), vec2f(0.0)));
  if (z.z > 0.0) { d = max(d, quad2(d2 + z.z, l.z - z1 + z.z) - z.z); }
  if (z.w > 0.0) { d = max(d, (d2 + l.z - z1 + z.w) * 0.70710678); }
  return d;
}
fn patTool(b: u32, q: vec3f) -> f32 {
  let pk = i32(P[b].w); let n = P[b + 1u].w;
  if (pk == 0) { return toolAt(b, q); }
  if (pk == 3) { return min(toolAt(b, q), toolAt(b, vec3f(-q.x, q.y, q.z))); }
  if (pk == 1) {
    let sec = 6.28318531 / n; let a0 = P[b + 2u].w;
    let k = round((atan2(q.y, q.x) - a0) / sec);
    var d = 1e9;
    for (var j = -1; j <= 1; j++) {
      let t = -(k + f32(j)) * sec; let c = cos(t); let sn = sin(t);
      d = min(d, toolAt(b, vec3f(c * q.x - sn * q.y, sn * q.x + c * q.y, q.z)));
    }
    return d;
  }
  let st = P[b + 2u].w; let x0 = P[b + 7u].w;
  let k = clamp(round((q.x - x0) / st), 0.0, n - 1.0);
  var d = 1e9;
  for (var j = -1; j <= 1; j++) {
    let kk = clamp(k + f32(j), 0.0, n - 1.0);
    d = min(d, toolAt(b, q - vec3f(kk * st, 0.0, 0.0)));
  }
  return d;
}
fn stackD(q: vec3f, d0: vec2f, i0: u32, i1: u32) -> vec2f {
  var r = d0;
  for (var i = i0; i < i1; i++) {
    let b = 1u + i * OPS;
    let ty = i32(P[b].x);
    if (ty == 3) { continue; }
    let t = patTool(b, q);
    if (ty == 1) { if (t < r.x) { r = vec2f(t, f32(i)); } }
    else if (-t > r.x) { r = vec2f(-t, f32(i)); }
  }
  return r;
}
fn fieldFC(q: vec3f) -> vec2f {
  let hd = P[0];
  let n = u32(hd.x);
  if (hd.z < 0.0) { return stackD(q, vec2f(1e9, 0.0), 0u, n); }
  let sh = u32(hd.z);
  var r = stackD(q, vec2f(1e9, 0.0), 0u, sh);
  let b = 1u + sh * OPS;
  let nn = P[b + 4u].xyz; let t = P[b + 7u].y; let off = P[b + 7u].z;
  let back = max(dot(q, nn) - (off - 2.0 * t), 0.0);
  let c = stackD(q - nn * back, vec2f(1e9, 0.0), 0u, sh).x + t;
  if (-c > r.x) { r = vec2f(-c, f32(sh)); }
  return stackD(q, r, sh + 1u, n);
}
fn toFC(p: vec3f) -> vec3f { return vec3f(p.x, -p.z, p.y) * P[0].y; }
fn mapD(p: vec3f) -> f32 { return fieldFC(toFC(p)).x / P[0].y; }
fn pal(i: u32) -> vec3f {
  var c = array<vec3f, 8>(vec3f(0.74, 0.76, 0.80), vec3f(0.93, 0.62, 0.36), vec3f(0.45, 0.70, 0.95), vec3f(0.62, 0.86, 0.55),
    vec3f(0.95, 0.80, 0.42), vec3f(0.80, 0.58, 0.92), vec3f(0.52, 0.86, 0.84), vec3f(0.96, 0.52, 0.56));
  return c[i % 8u];
}
fn mapM(p: vec3f) -> Sd {
  let r = fieldFC(toFC(p));
  let i = u32(r.y);
  let b = 1u + i * OPS;
  let ci = u32(P[b + 8u].y);
  let metal = select(0.55, 0.25, i32(P[b].x) == 2);
  return Sd(r.x / P[0].y, pal(ci), 0.32, metal, P[b + 3u].w);
}
fn ghostD(p: vec3f, w: i32) -> f32 {
  if (w < 0 || w >= i32(P[0].x)) { return 1e9; }
  let b = 1u + u32(w) * OPS;
  return patTool(b, toFC(p)) / P[0].y;
}
`;
