// ============================================================================
//  WEATHER MAP  ·  fronts.wgsl — front lines and symbols (render/fronts.js)
// ----------------------------------------------------------------------------
//  Prepend shaders/frame.wgsl (struct Frame, F, fr_*). This file uses the
//  prefix fx_ and defines no PI.
//
//  Lines: indexed triangle list, 2 vertices per point (across -1, +1). The
//  vertex shader blends state A and state B by U.a.x (the morph), moves the
//  vertex across the line by a width in CSS px (fr_pxSize), and the
//  fragment shader draws an anti-aliased core and a dark halo.
//  Symbols: one instance per symbol, a 4-vertex strip. The quad sits in the
//  tangent plane, sized in CSS px, and a signed distance field draws a
//  triangle, a semicircle or an open semicircle.
//
//  Screen spacing: a unit of level spacing unitRad shows when unitRad is at
//  least the arc of spacingPx on screen (render/fronts.js unitAlpha).
//
//  Passes: fsLineHalo, fsSymHalo, then fsLineCore, fsSymCore.
//
//  grep -n targets: "struct FrontU", "fn vsLine", "fn vsSym", "fn fx_dash",
//  "fn fx_symDist", "fn fsLineCore", "fn fsSymCore", "const FX_R"
// ============================================================================

struct FrontU {
  a: vec4f,      // x morph u (eased), y reveal 0..1, z layer alpha, w stationary unit spacing (CSS px)
  b: vec4f,      // x symbol radius, y line half width, z halo width, w dash period (all CSS px)
  cold: vec4f,   // rgb cold colour (stationary line), a halo alpha
  halo: vec4f,   // rgb halo colour, a free
}
@group(1) @binding(0) var<uniform> U: FrontU;

const FX_R: f32 = 1.0026;       // fronts shell (render/fronts.js FRONT_R)
const FX_DASH_BASE: f32 = 0.0001;

struct LineIn {
  @location(0) pa: vec4f,   // xyz state A, w arc fraction
  @location(1) pb: vec4f,   // xyz state B, w arc from the middle (radians)
  @location(2) na: vec4f,   // xyz left A, w miter
  @location(3) nb: vec4f,   // xyz left B, w miter
  @location(4) col: vec4f,  // rgb, w width scale
  @location(5) st: vec4f,   // x across -1 / +1, y kind, z presence code, w unit base d0
}

struct LineOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) y: f32,                            // across, device px
  @location(2) f: f32,                            // arc fraction
  @location(3) s: f32,                            // arc from the middle, radians
  @location(4) px: f32,                           // globe length of one device px
  @location(5) @interpolate(flat) kind: f32,
  @location(6) @interpolate(flat) hw: f32,        // half width, device px
  @location(7) @interpolate(flat) d0: f32,
}

struct SymIn {
  @location(0) pa: vec4f,   // xyz state A, w arc fraction
  @location(1) pb: vec4f,   // xyz state B, w arc to the nearer end (radians)
  @location(2) na: vec4f,   // xyz left A, w unit spacing (CSS px)
  @location(3) nb: vec4f,   // xyz left B, w level spacing unitRad (radians)
  @location(4) col: vec4f,  // rgb, w size scale
  @location(5) st: vec4f,   // x kind, y side, z shift (radii), w presence code
}

struct SymOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) q: vec2f,                          // symbol space (radii)
  @location(2) @interpolate(flat) kind: f32,
  @location(3) @interpolate(flat) scale: f32,     // device px per radius
}

fn fx_presence(code: f32, u: f32) -> f32 {
  if (code > 1.5) { return u; }
  if (code > 0.5) { return 1.0 - u; }
  return 1.0;
}

fn fx_blend(a: vec3f, b: vec3f, u: f32) -> vec3f {
  return normalize(mix(a, b, u));
}

// left vector at p: blend, then remove the radial part
fn fx_left(a: vec3f, b: vec3f, u: f32, pn: vec3f) -> vec3f {
  let n = mix(a, b, u);
  return normalize(n - pn * dot(n, pn));
}

// the line shows up to the reveal fraction, with a short soft head
fn fx_revealLine(f: f32) -> f32 {
  let r = U.a.y * 1.04;
  return 1.0 - smoothstep(r - 0.04, r, f);
}

// ── lines ──
@vertex
fn vsLine(i: LineIn) -> LineOut {
  var o: LineOut;
  let u = U.a.x;
  let pn = fx_blend(i.pa.xyz, i.pb.xyz, u);
  let p = pn * FX_R;
  let n = fx_left(i.na.xyz, i.nb.xyz, u, pn);
  let miter = mix(i.na.w, i.nb.w, u);
  let px = fr_pxSize(p);
  let dpr = F.viewport.z;
  let hw = U.b.y * i.col.w * dpr;
  let ext = hw + U.b.z * dpr + 1.0;
  let across = i.st.x * ext;
  o.pos = fr_clip(p + n * (across * miter * px));
  let a = fx_presence(i.st.z, u) * fr_limbFade(p) * U.a.z;
  o.col = vec4f(i.col.rgb, a);
  o.y = across;
  o.f = i.pa.w;
  o.s = i.pb.w;
  o.px = px;
  o.kind = i.st.y;
  o.hw = hw;
  o.d0 = i.st.w;
  return o;
}

// coverage of [a, b] (device px) at position e, anti-aliased
fn fx_seg(e: f32, a: f32, b: f32) -> f32 {
  return clamp(min(e - a, b - e) + 0.5, 0.0, 1.0);
}

// one dash period P (radians): kind 1 dash, kind 2 dash-dot-dot
fn fx_dashAt(s: f32, P: f32, px: f32, kind: f32) -> f32 {
  let ppx = P / px;
  let e = fract(s / P) * ppx;
  if (kind < 1.5) { return fx_seg(e, 0.0, 0.58 * ppx); }
  let dash = fx_seg(e, 0.0, 0.46 * ppx);
  let dot1 = fx_seg(e, 0.6 * ppx, 0.68 * ppx);
  let dot2 = fx_seg(e, 0.8 * ppx, 0.88 * ppx);
  return max(dash, max(dot1, dot2));
}

// Dash pattern with a period of about U.b.w CSS px. The period steps by
// powers of 2 of a fixed arc, and the two nearest steps cross-fade, so the
// dashes do not crawl along the line during a zoom.
fn fx_dash(s: f32, px: f32, kind: f32) -> f32 {
  let lam = max(log2(U.b.w * F.viewport.z * px / FX_DASH_BASE), 0.0);
  let l0 = floor(lam);
  let P0 = FX_DASH_BASE * exp2(l0);
  return mix(fx_dashAt(s, P0, px, kind), fx_dashAt(s, P0 * 2.0, px, kind), lam - l0);
}

// x: core coverage, y: halo coverage, z: pattern, w: 1 for the cold colour
fn fx_lineCover(i: LineOut) -> vec4f {
  let d = abs(i.y) - i.hw;
  let core = clamp(0.5 - d, 0.0, 1.0);
  let halo = clamp(0.5 - (d - U.b.z * F.viewport.z), 0.0, 1.0);
  var pat = 1.0;
  var cold = 0.0;
  if (i.kind > 0.5 && i.kind < 2.5) {
    pat = fx_dash(i.s, i.px, i.kind);
  } else if (i.kind > 2.5 && i.kind < 3.5) {
    // stationary: red before each unit centre, blue after (render/fronts.js STYLES.STNRY)
    let need = U.a.w * F.viewport.z * i.px;
    let lev = max(round(log2(need / i.d0)), 0.0);
    let P = i.d0 * exp2(lev);
    let t = fract(i.s / P + 0.5) - 0.5;
    cold = clamp(t * P / i.px + 0.5, 0.0, 1.0) * clamp((0.5 - abs(t)) * P / i.px + 0.5, 0.0, 1.0);
  }
  return vec4f(core, halo, pat * fx_revealLine(i.f), cold);
}

@fragment
fn fsLineHalo(i: LineOut) -> @location(0) vec4f {
  let c = fx_lineCover(i);
  let a = c.y * c.z * i.col.a * U.cold.a;
  return vec4f(U.halo.rgb * a, a);
}

@fragment
fn fsLineCore(i: LineOut) -> @location(0) vec4f {
  let c = fx_lineCover(i);
  let rgb = mix(i.col.rgb, U.cold.rgb, c.w);
  let a = c.x * c.z * i.col.a;
  return vec4f(rgb * a, a);
}

// ── symbols ──
fn fx_backOut(k: f32) -> f32 {
  let c = 1.6;
  let x = k - 1.0;
  return 1.0 + (c + 1.0) * x * x * x + c * x * x;
}

@vertex
fn vsSym(@builtin(vertex_index) vi: u32, i: SymIn) -> SymOut {
  var o: SymOut;
  let u = U.a.x;
  let pn = fx_blend(i.pa.xyz, i.pb.xyz, u);
  let p = pn * FX_R;
  let left = fx_left(i.na.xyz, i.nb.xyz, u, pn);
  let tng = cross(left, pn);
  let px = fr_pxSize(p);
  let dpr = F.viewport.z;
  let R = U.b.x * i.col.w * dpr;
  let shift = i.st.z;
  // level fade: show when the level spacing covers the screen spacing
  let need = i.na.w * dpr * px;
  var a = clamp(log2(i.nb.w / need) + 1.0, 0.0, 1.0);
  // keep symbols off the ends of the line (the mid unit has a huge edge)
  let edgePx = i.pb.w / px;
  a = a * smoothstep(R * (abs(shift) + 1.0), R * (abs(shift) + 1.5), edgePx);
  // draw-on: each symbol pops up when the reveal passes it
  let k = clamp((U.a.y * 1.04 - i.pa.w) / 0.08, 0.0, 1.0);
  let pop = max(fx_backOut(k), 0.0);
  a = a * min(k * 2.0, 1.0) * fx_presence(i.st.w, u) * fr_limbFade(p) * U.a.z;
  let cx = select(-1.4, 1.4, (vi & 1u) == 1u);
  let cy = select(-0.75, 1.65, vi >= 2u);
  let s = R * pop;
  let off = tng * ((shift * R + cx * s) * px) + left * (i.st.y * cy * s * px);
  o.pos = fr_clip(p + off);
  if (a < 0.002) { o.pos = vec4f(0.0, 0.0, 2.0, 1.0); }
  o.col = vec4f(i.col.rgb, a);
  o.q = vec2f(cx, cy);
  o.kind = i.st.x;
  o.scale = max(s, 1e-3);
  return o;
}

// signed distance to a triangle (Inigo Quilez, sdTriangle)
fn fx_sdTri(p: vec2f, p0: vec2f, p1: vec2f, p2: vec2f) -> f32 {
  let e0 = p1 - p0;
  let e1 = p2 - p1;
  let e2 = p0 - p2;
  let v0 = p - p0;
  let v1 = p - p1;
  let v2 = p - p2;
  let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  let s = sign(e0.x * e2.y - e0.y * e2.x);
  let d0 = vec2f(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x));
  let d1 = vec2f(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x));
  let d2 = vec2f(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x));
  let d = min(min(d0, d1), d2);
  return -sqrt(d.x) * sign(d.y);
}

// distance in radii: kind 10 triangle, 11 semicircle, 12 open semicircle
fn fx_symDist(q: vec2f, kind: f32) -> f32 {
  let base = -(q.y + 0.15);
  if (kind < 10.5) {
    return fx_sdTri(q, vec2f(-1.0, -0.15), vec2f(1.0, -0.15), vec2f(0.0, 1.35));
  }
  if (kind < 11.5) {
    return max(length(q) - 0.95, base);
  }
  return max(abs(length(q) - 0.8) - 0.17, base);
}

@fragment
fn fsSymHalo(i: SymOut) -> @location(0) vec4f {
  let d = fx_symDist(i.q, i.kind) * i.scale;
  // no halo below the base: the line core covers that edge
  let up = clamp((i.q.y + 0.15) * i.scale + 0.5, 0.0, 1.0);
  let h = clamp(0.5 - (d - U.b.z * F.viewport.z), 0.0, 1.0) * up;
  let a = h * i.col.a * U.cold.a;
  return vec4f(U.halo.rgb * a, a);
}

@fragment
fn fsSymCore(i: SymOut) -> @location(0) vec4f {
  let d = fx_symDist(i.q, i.kind) * i.scale;
  let a = clamp(0.5 - d, 0.0, 1.0) * i.col.a;
  // a soft top light so symbols read as solid shapes on the imagery
  let lit = 1.0 + 0.12 * clamp(i.q.y, 0.0, 1.0);
  return vec4f(min(i.col.rgb * lit, vec3f(1.0)) * a, a);
}
