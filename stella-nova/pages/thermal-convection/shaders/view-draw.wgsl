// ============================================================================
//  THERMAL CONVECTION  ·  shaders/view-draw.wgsl — surface, slice, block (VIEW)
// ----------------------------------------------------------------------------
//  All draws of one render pass (view-common.wgsl is put in front). Each
//  draw has its own viewport (views.js), so a quad's uv runs 0..1 over its
//  rect, uv (0, 0) = top left. Opaque bases write alpha 1; overlays write
//  premultiplied colour (blend one, one-minus-src-alpha).
//    vsQuad + fsSurface  surface section at surfaceZ: palette(T), relief
//                        light from the w field (upflow domes bright, lanes
//                        sunk), sheen for broth, the cut line with end ticks
//    vsQuad + fsSlice    vertical section: palette(T), isotherms (fwidth),
//                        dashed surfaceZ mark, top surface line
//    vsQuad + fsPlate    hot-plate bar coloured by the bottom-wall T
//    vsArrow + fsArrow   velocity arrows on a coarse grid of the section
//    vsDot + fsMark      tracers near the surface ("pepper flakes")
//    vsStreak + fsMark   tracers in a thin slab of the cut, as streaks
//    vsBlock + fsBlock   cutaway block faces (top = surface section, cut
//                        face = section, sides = boundary sections)
//    vsEdge + fsEdge     block edges, screen-space quads
//
//  grep -n targets: "fn surfAt", "fn sectAt", "fn paletteAt", "fn outColor",
//  "fn relief", "fn cutLine", "fn isoInk", "fn fsSurface", "fn fsSlice",
//  "fn fsPlate", "fn vsArrow", "fn fsArrow", "fn vsDot", "fn vsStreak",
//  "fn fsMark", "fn vsBlock", "fn fsBlock", "fn vsEdge", "fn fsEdge"
// ============================================================================

@group(0) @binding(3) var<storage, read> tracers : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> surf : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> sect : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> range : array<vec4<f32>, 2>;
@group(0) @binding(7) var lutTex : texture_2d<f32>;
@group(0) @binding(8) var lutSmp : sampler;

const INK_LIGHT : vec3<f32> = vec3<f32>(0.94, 0.96, 0.98);
const INK_DARK : vec3<f32> = vec3<f32>(0.03, 0.035, 0.045);

// ---- sampling ---------------------------------------------------------------

// Catmull-Rom (T, w, dw/dx, dw/dy) of the surface section, periodic
fn surfAt(x : f32, y : f32) -> vec4<f32> {
  let nx = i32(V.dims.x);
  let ny = i32(V.dims.y);
  let gx = (x * (V.dims.x / V.box.x)) - 0.5;
  let gy = (y * (V.dims.y / V.box.y)) - 0.5;
  let bx = floor(gx);
  let by = floor(gy);
  var wx = crw(gx - bx);
  var wy = crw(gy - by);
  let i0 = i32(bx) - 1;
  let j0 = i32(by) - 1;
  var acc = vec4<f32>(0.0);
  for (var b = 0; b < 4; b++) {
    let jj = wrapi(j0 + b, ny);
    var row = vec4<f32>(0.0);
    for (var a = 0; a < 4; a++) {
      let ii = wrapi(i0 + a, nx);
      row += surf[u32(ii + (nx * jj))] * wx[a];
    }
    acc += row * wy[b];
  }
  return acc;
}

// Catmull-Rom (T, u_s, w, speed) of the section at s01 in [0, 1], z in [0, 1]
fn sectAt(s01 : f32, z : f32) -> vec4<f32> {
  let ns = i32(V.segB.y);
  let nzs = i32(V.segB.z);
  let gx = clamp(s01, 0.0, 1.0) * f32(ns - 1);
  let gy = sectRow(z);
  let bx = floor(gx);
  let by = floor(gy);
  var wx = crw(gx - bx);
  var wy = crw(gy - by);
  let i0 = i32(bx) - 1;
  let j0 = i32(by) - 1;
  var acc = vec4<f32>(0.0);
  for (var b = 0; b < 4; b++) {
    let jj = clamp(j0 + b, 0, nzs - 1);
    var row = vec4<f32>(0.0);
    for (var a = 0; a < 4; a++) {
      let ii = clamp(i0 + a, 0, ns - 1);
      row += sect[u32(ii + (ns * jj))] * wx[a];
    }
    acc += row * wy[b];
  }
  return acc;
}

// ---- colour -----------------------------------------------------------------

fn paletteAt(t : f32) -> vec3<f32> {
  let u = (clamp(t, 0.0, 1.0) * (255.0 / 256.0)) + (0.5 / 256.0);
  return textureSampleLevel(lutTex, lutSmp, vec2<f32>(u, 0.5), 0.0).rgb;
}

fn outColor(c : vec3<f32>, a : f32) -> vec4<f32> {
  var o = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  if (V.tone.w > 0.5) { o = toLinear(o); }
  return vec4<f32>(o * a, a);
}

// relief light: height h = relief * 0.12 * w / max|w| (box units), light from
// the upper left at 40 deg, flat ground = 1; sheen adds a specular spot
fn relief(col : vec3<f32>, s : vec4<f32>) -> vec3<f32> {
  let rl = V.look.x;
  if (rl <= 0.0) { return col; }
  let wmax = max(range[1].x, 1e-5);
  let k = (rl * 0.12) / wmax;
  let n = normalize(vec3<f32>(-k * s.z, -k * s.w, 1.0));
  let L = normalize(vec3<f32>(-0.55, 0.5, 0.67));
  let diff = max(dot(n, L), 0.0) / L.z;
  let lift = clamp(s.y / wmax, -1.0, 1.0) * rl * 0.10;
  var c = col * clamp(mix(1.0, diff, 0.85) + lift, 0.45, 1.45);
  let H = normalize(L + vec3<f32>(0.0, 0.0, 1.0));
  let sp = pow(max(dot(n, H), 0.0), 90.0);
  c += vec3<f32>(1.0, 0.96, 0.86) * (sp * V.look.y * rl * 0.9);
  return c;
}

// lines that stay readable on any palette colour: dark on light, light on dark
fn isoInk(col : vec3<f32>) -> vec3<f32> {
  let y = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  return select(INK_LIGHT, INK_DARK, y > 0.45);
}

fn segDist(p : vec2<f32>, a : vec2<f32>, b : vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - (ba * h));
}

// the cut line on the surface: white core, dark halo, end ticks
fn cutLine(col : vec3<f32>, px : vec2<f32>) -> vec3<f32> {
  let len = V.segB.x;
  if ((len < 1e-4) || (V.eye.w < 0.5)) { return col; }
  let dpr = V.look.w;
  let sx = V.rSurf.z / V.box.x;
  let sy = V.rSurf.w / V.box.y;
  let dir = vec2<f32>(V.seg.z, V.seg.w);
  let p0 = vec2<f32>(V.seg.x, V.seg.y);
  let p1 = p0 + (dir * len);
  let a = vec2<f32>(p0.x * sx, (V.box.y - p0.y) * sy);
  let b = vec2<f32>(p1.x * sx, (V.box.y - p1.y) * sy);
  let core = 0.85 * dpr;
  let halo = core + (1.1 * dpr);
  let sd = normalize(b - a + vec2<f32>(1e-6, 0.0));
  let sn = vec2<f32>(-sd.y, sd.x);
  let ta = a + (sd * halo);
  let tb = b - (sd * halo);
  let tick = 6.5 * dpr;
  let d0 = segDist(px, ta, tb);
  let d1 = segDist(px, ta - (sn * tick), ta + (sn * tick));
  let d2 = segDist(px, tb - (sn * tick), tb + (sn * tick));
  let d = min(d0, min(d1, d2));
  let aH = 1.0 - smoothstep(halo - 0.6, halo + 0.6, d);
  let aC = 1.0 - smoothstep(core - 0.6, core + 0.6, d);
  var c = mix(col, INK_DARK, aH * 0.7);
  c = mix(c, INK_LIGHT, aC);
  return c;
}

// ---- full-rect quad ---------------------------------------------------------

struct QuadOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vsQuad(@builtin(vertex_index) vi : u32) -> QuadOut {
  var c = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));
  let uv = c[vi];
  var o : QuadOut;
  o.pos = vec4<f32>((uv.x * 2.0) - 1.0, 1.0 - (uv.y * 2.0), 0.0, 1.0);
  o.uv = uv;
  return o;
}

@fragment
fn fsSurface(q : QuadOut) -> @location(0) vec4<f32> {
  let p = vec2<f32>(q.uv.x * V.box.x, (1.0 - q.uv.y) * V.box.y);
  let s = surfAt(p.x, p.y);
  let r = range[0];
  var col = paletteAt(toneT(s.x, r.x, r.y));
  col = relief(col, s);
  col = cutLine(col, q.uv * V.rSurf.zw);
  return outColor(col, 1.0);
}

@fragment
fn fsSlice(q : QuadOut) -> @location(0) vec4<f32> {
  let z = 1.0 - q.uv.y;
  let s = sectAt(q.uv.x, z);
  let r = range[0];
  let t = toneT(s.x, r.z, r.w);
  let f = t * 10.0;
  let fw = fwidth(f);
  let dpr = V.look.w;
  var col = paletteAt(t);
  let px = q.uv * V.rFluid.zw;
  if ((V.look.z > 0.5) && (f > 0.5) && (f < 9.5)) {
    let d = abs(fract(f + 0.5) - 0.5) / max(fw, 1e-6);
    let w = 0.55 * dpr;
    let a = 1.0 - smoothstep(w - 0.5, w + 0.5, d);
    col = mix(col, isoInk(col), a * 0.55);
  }
  // dashed mark at surfaceZ: the height the surface view shows
  let yS = (1.0 - V.box.w) * V.rFluid.w;
  let dashOn = fract(px.x / (10.0 * dpr)) < 0.6;
  let aS = (1.0 - smoothstep(0.5 * dpr - 0.5, 0.5 * dpr + 0.5, abs(px.y - yS))) * select(0.0, 1.0, dashOn);
  col = mix(col, isoInk(col), aS * 0.5);
  // top surface line
  let aT = 1.0 - smoothstep(1.1 * dpr - 0.5, 1.1 * dpr + 0.5, px.y);
  col = mix(col, INK_LIGHT, aT * 0.85);
  return outColor(col, 1.0);
}

@fragment
fn fsPlate(q : QuadOut) -> @location(0) vec4<f32> {
  let s = sectAt(q.uv.x, 0.0);
  let r = range[0];
  let hot = paletteAt(toneT(s.x, r.z, r.w));
  let dpr = V.look.w;
  let py = q.uv.y * V.rBar.w;
  let metal = vec3<f32>(0.10, 0.10, 0.115);
  var col = mix(hot, (hot * 0.35) + metal, smoothstep(0.0, 1.0, q.uv.y));
  let aTop = 1.0 - smoothstep(dpr - 0.5, dpr + 0.5, py);
  col = mix(col, vec3<f32>(1.0, 0.97, 0.9), aTop * 0.35);
  let aBot = 1.0 - smoothstep(dpr - 0.5, dpr + 0.5, V.rBar.w - py);
  col = mix(col, INK_DARK, aBot * 0.8);
  return outColor(col, 1.0);
}

// ---- arrows -----------------------------------------------------------------

struct ArrowOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) local : vec2<f32>,   // px along / across the arrow, 0 = centre
  @location(1) dims : vec2<f32>,    // arrow length px, alpha
};

fn fluidClip(px : vec2<f32>) -> vec4<f32> {
  return vec4<f32>(((px.x / V.rFluid.z) * 2.0) - 1.0, 1.0 - ((px.y / V.rFluid.w) * 2.0), 0.0, 1.0);
}

fn quadCorner(vi : u32) -> vec2<f32> {
  var c = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0));
  return c[vi % 6u];
}

@vertex
fn vsArrow(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> ArrowOut {
  let na = max(u32(V.over.y), 1u);
  let nza = max(u32(V.over.z), 1u);
  let ia = ii % na;
  let ka = ii / na;
  let c01 = vec2<f32>((f32(ia) + 0.5) / f32(na), (f32(ka) + 0.5) / f32(nza));
  let q = sectAt(c01.x, c01.y);
  let vmax = max(range[1].y, 1e-5);
  let dpr = V.look.w;
  let len = max(V.segB.x, 1e-4);
  let v = vec2<f32>(q.y * (V.rFluid.z / len), -q.z * V.rFluid.w);
  let cell = min(V.rFluid.z / f32(na), V.rFluid.w / f32(nza));
  let L = cell * 0.9 * clamp(length(vec2<f32>(q.y, q.z)) / vmax, 0.0, 1.0);
  let lv = length(v);
  let dir = select(vec2<f32>(1.0, 0.0), v / max(lv, 1e-9), lv > 1e-9);
  let nrm = vec2<f32>(-dir.y, dir.x);
  let pad = 2.0 * dpr;
  let hw = (min(L * 0.45, 6.0 * dpr) * 0.6) + pad;
  let corner = quadCorner(vi);
  let local = vec2<f32>(corner.x * ((0.5 * L) + pad), corner.y * hw);
  let ctr = vec2<f32>(c01.x * V.rFluid.z, (1.0 - c01.y) * V.rFluid.w);
  var o : ArrowOut;
  o.pos = fluidClip(ctr + (dir * local.x) + (nrm * local.y));
  o.local = local;
  o.dims = vec2<f32>(L, select(0.0, 1.0, L > (2.5 * dpr)));
  return o;
}

@fragment
fn fsArrow(a : ArrowOut) -> @location(0) vec4<f32> {
  let dpr = V.look.w;
  let L = a.dims.x;
  let hl = min(L * 0.45, 6.0 * dpr);
  let hw = hl * 0.6;
  let x = a.local.x;
  let y = abs(a.local.y);
  let tip = 0.5 * L;
  let base = tip - hl;
  let sw = 0.6 * dpr;
  // shaft: capsule from -L/2 to the head base
  let sx = clamp(x, -tip, base);
  let dShaft = length(vec2<f32>(x - sx, y)) - sw;
  // head: triangle tip at (tip, 0), base at x = base, half width hw
  let slant = ((y * hl) - (hw * (tip - x))) / max(length(vec2<f32>(hl, hw)), 1e-6);
  let dHead = max(base - x, slant);
  let d = min(dShaft, dHead);
  let aC = 1.0 - smoothstep(-0.5, 0.5, d);
  let aH = (1.0 - smoothstep(-0.5, 0.5, d - (1.0 * dpr))) * 0.6;
  let al = max(aC, aH) * a.dims.y;
  let rgb = (INK_LIGHT * aC) + (INK_DARK * max(aH - aC, 0.0));
  var o = rgb * a.dims.y;
  if (V.tone.w > 0.5) { o = toLinear(o); }
  return vec4<f32>(o, al);
}

// ---- tracers ----------------------------------------------------------------

struct MarkOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) local : vec2<f32>,   // px, x along the streak (head at +hl)
  @location(1) shape : vec3<f32>,   // half length px, radius px, alpha
};

fn hiddenMark() -> MarkOut {
  var o : MarkOut;
  o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  o.local = vec2<f32>(0.0);
  o.shape = vec3<f32>(0.0);
  return o;
}

@vertex
fn vsDot(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> MarkOut {
  if (ii >= u32(V.over.x)) { return hiddenMark(); }
  let p = tracers[ii];
  let band = 0.12;
  let depth = V.box.w - p.z;
  if ((p.w < 0.0) || (depth > band) || (p.z > 1.0)) { return hiddenMark(); }
  let dpr = V.look.w;
  let r = 1.25 * dpr;
  let ext = r + (1.5 * dpr);
  let corner = quadCorner(vi);
  let ctr = vec2<f32>((p.x / V.box.x) * V.rSurf.z, (1.0 - (p.y / V.box.y)) * V.rSurf.w);
  let px = ctr + (corner * ext);
  var o : MarkOut;
  o.pos = vec4<f32>(((px.x / V.rSurf.z) * 2.0) - 1.0, 1.0 - ((px.y / V.rSurf.w) * 2.0), 0.0, 1.0);
  o.local = corner * ext;
  o.shape = vec3<f32>(0.0, r, 0.9 * clamp(1.0 - (max(depth, 0.0) / band), 0.0, 1.0));
  return o;
}

@vertex
fn vsStreak(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> MarkOut {
  if (ii >= u32(V.over.x)) { return hiddenMark(); }
  let p = tracers[ii];
  let len = V.segB.x;
  let p0 = vec2<f32>(V.seg.x, V.seg.y);
  let dir = vec2<f32>(V.seg.z, V.seg.w);
  let nrm = vec2<f32>(-dir.y, dir.x);
  let rel = p.xy - p0;
  let s = dot(rel, dir);
  let dn = abs(dot(rel, nrm));
  let slab = V.segB.w;
  if ((p.w < 0.0) || (dn > slab) || (s < 0.0) || (s > len) || (p.z < 0.0) || (p.z > 1.0) || (len < 1e-4)) {
    return hiddenMark();
  }
  let dpr = V.look.w;
  let vel = sampleV(p.xyz);
  let vs = (vel.x * dir.x) + (vel.y * dir.y);
  let v = vec2<f32>(vs * (V.rFluid.z / len), -vel.z * V.rFluid.w);
  let lv = length(v) * V.over.w;
  let slen = clamp(lv, 2.0 * dpr, 26.0 * dpr);
  let sd = select(vec2<f32>(1.0, 0.0), v / max(length(v), 1e-9), length(v) > 1e-9);
  let sn = vec2<f32>(-sd.y, sd.x);
  let head = vec2<f32>((s / len) * V.rFluid.z, (1.0 - p.z) * V.rFluid.w);
  let hl = 0.5 * slen;
  let ctr = head - (sd * hl);
  let r = 0.75 * dpr;
  let ext = r + (1.5 * dpr);
  let corner = quadCorner(vi);
  let local = vec2<f32>(corner.x * (hl + ext), corner.y * ext);
  var o : MarkOut;
  o.pos = fluidClip(ctr + (sd * local.x) + (sn * local.y));
  o.local = local;
  o.shape = vec3<f32>(hl, r, 0.85 * (1.0 - (dn / max(slab, 1e-6))));
  return o;
}

@fragment
fn fsMark(m : MarkOut) -> @location(0) vec4<f32> {
  let dpr = V.look.w;
  let hl = m.shape.x;
  let x = clamp(m.local.x, -hl, hl);
  let d = length(vec2<f32>(m.local.x - x, m.local.y)) - m.shape.y;
  let aC = 1.0 - smoothstep(-0.5, 0.5, d);
  let aH = (1.0 - smoothstep(-0.5, 0.5, d - (0.9 * dpr))) * 0.55;
  var fade = 1.0;
  if (hl > 0.5) { fade = mix(0.2, 1.0, clamp((m.local.x + hl) / (2.0 * hl), 0.0, 1.0)); }
  let k = m.shape.z * fade;
  let al = max(aC, aH) * k;
  var rgb = ((INK_LIGHT * aC) + (INK_DARK * max(aH - aC, 0.0))) * k;
  if (V.tone.w > 0.5) { rgb = toLinear(rgb); }
  return vec4<f32>(rgb, al);
}

// ---- block ------------------------------------------------------------------

struct BlockOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) world : vec3<f32>,                     // box units (z unscaled)
  @location(1) @interpolate(flat) kind : u32,         // 0 top, 1 bottom, 2 side, 3 cut
};

@vertex
fn vsBlock(@location(0) p : vec4<f32>) -> BlockOut {
  var o : BlockOut;
  o.pos = V.viewProj * vec4<f32>(p.x, p.y, p.z * V.box.z, 1.0);
  o.world = p.xyz;
  o.kind = u32(p.w + 0.5);
  return o;
}

@fragment
fn fsBlock(b : BlockOut) -> @location(0) vec4<f32> {
  let r = range[0];
  var T = 0.0;
  var s4 = vec4<f32>(0.0);
  var shade = 0.84;
  if (b.kind == 0u) {
    s4 = surfAt(b.world.x, b.world.y);
    T = s4.x;
    shade = 1.0;
  } else if (b.kind == 3u) {
    let len = max(V.segB.x, 1e-4);
    let sv = dot(b.world.xy - vec2<f32>(V.seg.x, V.seg.y), vec2<f32>(V.seg.z, V.seg.w));
    T = sectAt(sv / len, b.world.z).x;
    shade = 0.97;
  } else {
    T = sampleT(b.world);
    shade = select(0.84, 0.6, b.kind == 1u);
  }
  let t = toneT(T, r.z, r.w);
  let f = t * 10.0;
  let fw = fwidth(f);
  var col = paletteAt(t);
  if (b.kind == 0u) { col = relief(col, s4); }
  col = col * shade;
  if ((V.look.z > 0.5) && (b.kind == 3u) && (f > 0.5) && (f < 9.5)) {
    let d = abs(fract(f + 0.5) - 0.5) / max(fw, 1e-6);
    let w = 0.5 * V.look.w;
    let a = 1.0 - smoothstep(w - 0.5, w + 0.5, d);
    col = mix(col, isoInk(col), a * 0.5);
  }
  return outColor(col, 1.0);
}

struct EdgeOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) across : f32,   // px from the edge centre line
};

@vertex
fn vsEdge(@builtin(vertex_index) vi : u32, @location(0) a : vec4<f32>, @location(1) b : vec4<f32>) -> EdgeOut {
  let ca = V.viewProj * vec4<f32>(a.x, a.y, a.z * V.box.z, 1.0);
  let cb = V.viewProj * vec4<f32>(b.x, b.y, b.z * V.box.z, 1.0);
  let halfPx = 0.5 * V.rBlock.zw;
  let na = (ca.xy / max(ca.w, 1e-6)) * halfPx;
  let nb = (cb.xy / max(cb.w, 1e-6)) * halfPx;
  let d = nb - na;
  let sd = select(vec2<f32>(1.0, 0.0), d / max(length(d), 1e-9), length(d) > 1e-9);
  let sn = vec2<f32>(-sd.y, sd.x);
  let ext = (0.6 * V.look.w) + 1.0;
  let corner = quadCorner(vi);
  let along = select(na, nb, corner.x > 0.0) + (sd * (corner.x * 0.5 * V.look.w));
  let px = along + (sn * (corner.y * ext));
  var o : EdgeOut;
  o.pos = vec4<f32>(px / halfPx, 0.0, 1.0);
  o.across = corner.y * ext;
  return o;
}

@fragment
fn fsEdge(e : EdgeOut) -> @location(0) vec4<f32> {
  let w = 0.6 * V.look.w;
  let a = (1.0 - smoothstep(w - 0.5, w + 0.5, abs(e.across))) * 0.75;
  var rgb = INK_LIGHT * a;
  if (V.tone.w > 0.5) { rgb = toLinear(rgb); }
  return vec4<f32>(rgb, a);
}
