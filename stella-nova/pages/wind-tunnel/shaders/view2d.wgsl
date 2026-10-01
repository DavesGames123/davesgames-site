// view2d.wgsl — what the 2D tunnel shows. sdf.wgsl is prepended.
//
// Passes, in frame order (engine2d.js):
//   dye      compute  semi-Lagrangian smoke: back-trace each cell along the
//                     velocity, sample the old smoke, add stripes at the inlet
//   advect   compute  move each streamline particle one frame (RK2), write the
//                     new head point into its trail ring
//   vsField/fsField   full-screen: the field color (speed, vorticity, pressure,
//                     smoke or plain) and the shaded object
//   vsLine/fsLine     one screen-space quad per trail segment, alpha blended
//
// Frames. A cell (x, y) covers [x, x+1] x [y, y+1], y up. The domain origin
// sits at V.offset pixels from the bottom left of the canvas, and one cell
// is V.cellPx pixels. The macro texture holds (ux, uy, rho - 1, solid) per cell: solid is 1 in a
// solid, 0.5 in a porous part, 0 in fluid. Particles and smoke stop at 0.75.
//
// Particles move the distance the fluid moves: lattice velocity (cells per
// step) times the steps of this frame (P.dt). So the streaks keep pace with
// the solver at any sim rate.
//
// grep: struct ViewU  struct PartU  fn dye  fn advect  fn pref  fn fsField  fn vsLine
//       fn speedRamp  fn divRamp  fn shadeObject

struct ViewU {
  canvas: vec2f,
  offset: vec2f,
  dims: vec2f,
  cellPx: f32,
  field: u32,     // 0 speed, 1 vorticity, 2 pressure, 3 smoke, 4 plain
  U: f32,
  refL: f32,      // reference length in cells
  time: f32,
  lineW: f32,     // streak width in pixels
  vortScale: f32,
  presScale: f32,
  lineAlpha: f32,
  pad: f32,
};

struct PartU {
  count: u32,
  K: u32,         // trail points per particle
  head: u32,      // ring index of the newest point
  seed: u32,
  dt: f32,        // lattice steps in this frame
  mode: u32,      // 0 field (spawn anywhere), 1 rake (spawn upstream)
  life: f32,      // mean life in frames
  reseed: u32,
  rake: vec4f,    // x0, x1, y0, y1 in cells
};

@group(0) @binding(0) var<uniform> V: ViewU;
@group(0) @binding(1) var<uniform> SH: ShapeU;
@group(0) @binding(2) var macroTex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var dyeTex: texture_2d<f32>;
@group(0) @binding(5) var dyeOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> PU: PartU;
@group(0) @binding(7) var<storage, read_write> parts: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> trail: array<vec4f>;
@group(0) @binding(9) var<storage, read> partsR: array<vec4f>;
@group(0) @binding(10) var<storage, read> trailR: array<vec4f>;
@group(0) @binding(11) var<storage, read_write> prefOut: array<f32>;
@group(0) @binding(12) var<storage, read> prefR: array<f32>;

fn hashU(a: u32) -> u32 {
  var x = a;
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
fn rand01(a: u32) -> f32 { return f32(hashU(a) & 0xffffffu) / 16777216.0; }

fn macroAt(c: vec2f) -> vec4f {
  return textureSampleLevel(macroTex, samp, c / V.dims, 0.0);
}

// ------------------------------------------------------------ smoke

@compute @workgroup_size(8, 8)
fn dye(@builtin(global_invocation_id) g: vec3u) {
  let d = vec2u(V.dims);
  if (g.x >= d.x || g.y >= d.y) { return; }
  let m = textureLoad(macroTex, g.xy, 0);
  let c = vec2f(g.xy) + 0.5;
  let back = c - m.xy * PU.dt;
  var v = textureSampleLevel(dyeTex, samp, back / V.dims, 0.0).r * 0.9985;
  if (g.x < 3u) {
    let band = fract(c.y / max(V.dims.y / 28.0, 3.0));
    v = select(0.0, 1.0, band < 0.38);
  }
  if (m.w > 0.75) { v = 0.0; }
  textureStore(dyeOut, g.xy, vec4f(v, 0.0, 0.0, 1.0));
}

// ------------------------------------------------------------ particles

fn spawn(i: u32) -> vec2f {
  let base = i * 9781u + PU.seed * 6271u;
  var p = vec2f(0.0);
  for (var tries = 0u; tries < 6u; tries++) {
    let a = rand01(base + tries * 2u);
    let b = rand01(base + tries * 2u + 1u);
    if (PU.mode == 1u) {
      p = vec2f(mix(PU.rake.x, PU.rake.y, a), mix(PU.rake.z, PU.rake.w, b));
    } else {
      p = vec2f(1.0 + a * (V.dims.x - 2.0), 1.0 + b * (V.dims.y - 2.0));
    }
    if (macroAt(p).w < 0.75) { break; }
  }
  return p;
}

@compute @workgroup_size(64)
fn advect(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= PU.count) { return; }
  var pa = parts[i];
  var pos = pa.xy;
  var fresh = PU.reseed != 0u || pa.w <= 0.0;
  if (!fresh) {
    let u1 = macroAt(pos).xy;
    let mid = pos + u1 * PU.dt * 0.5;
    let m2 = macroAt(mid);
    pos += m2.xy * PU.dt;
    pa.z += 1.0;
    let out = pos.x < 0.5 || pos.y < 0.5 || pos.x > V.dims.x - 1.0 || pos.y > V.dims.y - 1.0;
    if (out || pa.z > pa.w || macroAt(pos).w > 0.75) { fresh = true; }
  }
  if (fresh) {
    pos = spawn(i);
    let r = rand01(i * 131u + PU.seed * 17u + 5u);
    let life = PU.life * (0.5 + r);
    // A reseed starts each particle at a random point of its life, so the
    // whole set does not respawn on one frame.
    pa = vec4f(pos, select(0.0, r * life, PU.reseed != 0u), life);
    for (var k = 0u; k < PU.K; k++) { trail[i * PU.K + k] = vec4f(pos, 0.0, 0.0); }
  }
  pa.x = pos.x;
  pa.y = pos.y;
  parts[i] = pa;
  let sp = length(macroAt(pos).xy);
  trail[i * PU.K + PU.head] = vec4f(pos, sp, pa.z);
}

// ------------------------------------------------------------ color ramps

fn rampN(t: f32, c0: vec3f, c1: vec3f, c2: vec3f, c3: vec3f, c4: vec3f) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 4.0;
  if (x < 1.0) { return mix(c0, c1, x); }
  if (x < 2.0) { return mix(c1, c2, x - 1.0); }
  if (x < 3.0) { return mix(c2, c3, x - 2.0); }
  return mix(c3, c4, x - 3.0);
}

// Speed: deep navy, teal, pale cyan, warm white, amber. 0 = still, 1 = U.
fn speedRamp(t: f32) -> vec3f {
  return rampN(t / 1.5, vec3f(0.02, 0.03, 0.08), vec3f(0.04, 0.22, 0.38), vec3f(0.10, 0.58, 0.66),
               vec3f(0.80, 0.90, 0.88), vec3f(1.0, 0.66, 0.24));
}

// Signed: blue, dark, red-orange. t in [-1, 1].
fn divRamp(t: f32) -> vec3f {
  return rampN(t * 0.5 + 0.5, vec3f(0.55, 0.80, 1.0), vec3f(0.12, 0.36, 0.78), vec3f(0.035, 0.04, 0.07),
               vec3f(0.82, 0.30, 0.14), vec3f(1.0, 0.86, 0.55));
}

// ------------------------------------------------------------ field

struct VOut {
  @builtin(position) pos: vec4f,
};

// Pressure reference: the static port of a real tunnel. The inlet holds
// rho = 1 and the sponge pulls rho toward 1 at the roof and the outlet,
// but the static pressure inside the tunnel sits higher (the drag of the
// body needs a pressure drop along it). Cp from rho - 1 showed the whole
// free stream as positive. pref averages rho - 1 over 256 points of the
// column x = 6, clear of the sponge bands; fsField uses rho - pref.
var<workgroup> pacc: array<f32, 256>;
@compute @workgroup_size(256)
fn pref(@builtin(local_invocation_index) li: u32) {
  let ny = i32(V.dims.y);
  let sp = 10;
  let y0 = sp; let y1 = max(ny - 1 - sp, sp + 1);
  let y = y0 + i32(f32(y1 - y0) * (f32(li) + 0.5) / 256.0);
  pacc[li] = textureLoad(macroTex, vec2i(min(6, i32(V.dims.x) - 1), y), 0).z;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { pacc[li] += pacc[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) { prefOut[0] = pacc[0] / 256.0; }
}

@vertex
fn vsField(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

// The object as seen from the viewer side of the swept axis: sphere trace
// toward the viewer's far side, then light the hit with its normal.
fn shadeObject(c: vec2f) -> vec3f {
  var s = SH.sweepC + SH.extent;
  let s0 = SH.sweepC - SH.extent;
  var hitW = vec3f(0.0);
  var hit = vec3f(1e9, 0.0, 0.0);
  for (var i = 0; i < 96; i++) {
    var w = vec3f(c, s);
    if (SH.proj == 2u) { w = vec3f(c.x, s, c.y); }
    let o = objDist(w);
    if (o.x < 0.05) { hit = o; hitW = w; break; }
    s -= max(o.x * 0.8, 0.3);
    if (s < s0) { break; }
  }
  if (hit.x > 1e8) { return vec3f(0.55, 0.57, 0.6); }
  let e = 0.5;
  let nrm = normalize(vec3f(
    objDist(hitW + vec3f(e, 0.0, 0.0)).x - objDist(hitW - vec3f(e, 0.0, 0.0)).x,
    objDist(hitW + vec3f(0.0, e, 0.0)).x - objDist(hitW - vec3f(0.0, e, 0.0)).x,
    objDist(hitW + vec3f(0.0, 0.0, e)).x - objDist(hitW - vec3f(0.0, 0.0, e)).x));
  let q = hitW - SH.origin.xyz - vec3f(hit.z * SH.spacing, 0.0, 0.0);
  let base = matColor(hit.y, toLocal(q));
  var L = normalize(vec3f(-0.35, 0.75, 0.55));
  if (SH.proj == 2u) { L = normalize(vec3f(-0.35, 0.75, -0.55)); }
  let dif = max(dot(nrm, L), 0.0);
  let rim = pow(1.0 - abs(select(nrm.z, nrm.y, SH.proj == 2u)), 3.0);
  return base * (0.32 + 0.78 * dif) + vec3f(0.10, 0.16, 0.22) * rim;
}

@fragment
fn fsField(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2f(fc.x, V.canvas.y - fc.y);
  let c = (px - V.offset) / V.cellPx;
  let bg = vec3f(0.018, 0.02, 0.03);
  if (c.x < 0.0 || c.y < 0.0 || c.x > V.dims.x || c.y > V.dims.y) {
    return vec4f(bg, 1.0);
  }
  let m = macroAt(c);
  var col = vec3f(0.0);
  switch (V.field) {
    case 0u: { col = speedRamp(length(m.xy) / V.U); }
    case 1u: {
      let h = 1.5;
      let dvx = macroAt(c + vec2f(h, 0.0)).y - macroAt(c - vec2f(h, 0.0)).y;
      let duy = macroAt(c + vec2f(0.0, h)).x - macroAt(c - vec2f(0.0, h)).x;
      let w = (dvx - duy) * 0.5 / h * V.refL / V.U;
      col = divRamp(w * V.vortScale);
    }
    case 2u: {
      let cp = (m.z - prefR[0]) / 3.0 / (0.5 * V.U * V.U);
      col = divRamp(cp * V.presScale);
    }
    case 3u: {
      let d = textureSampleLevel(dyeTex, samp, c / V.dims, 0.0).r;
      let base = mix(vec3f(0.02, 0.03, 0.06), vec3f(0.03, 0.08, 0.14), clamp(length(m.xy) / V.U, 0.0, 1.5) * 0.6);
      col = mix(base, vec3f(0.95, 0.96, 0.98), smoothstep(0.02, 0.9, d));
    }
    default: { col = vec3f(0.03, 0.035, 0.05); }
  }
  // Faint lattice grid when zoomed in far enough to see cells.
  if (V.cellPx > 7.0) {
    let gd = abs(fract(c) - 0.5);
    let gl = 1.0 - smoothstep(0.0, 1.2 / V.cellPx, 0.5 - max(gd.x, gd.y));
    col += vec3f(0.035) * gl;
  }
  if (m.w > 0.02) {
    let obj = shadeObject(c);
    col = mix(col, obj, smoothstep(0.05, 0.45, m.w));
  }
  return vec4f(col, 1.0);
}

// ------------------------------------------------------------ streaks

struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) across: f32,
};

@vertex
fn vsLine(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  var o: LOut;
  let segs = PU.K - 1u;
  let p = ii / segs;
  let s = ii % segs;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.col = vec4f(0.0);
  o.across = 0.0;
  if (p >= PU.count) { return o; }
  let ia = (PU.head + 1u + s) % PU.K;
  let ib = (ia + 1u) % PU.K;
  let a = trailR[p * PU.K + ia];
  let b = trailR[p * PU.K + ib];
  let pa = V.offset + a.xy * V.cellPx;
  let pb = V.offset + b.xy * V.cellPx;
  let dv = pb - pa;
  let len = length(dv);
  if (len < 0.01 || len > 60.0 * V.cellPx) { return o; }
  let dir = dv / len;
  let nrm = vec2f(-dir.y, dir.x);
  var corner = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
                               vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let k = corner[vi];
  let w = V.lineW * 0.5 + 0.75;
  let px = mix(pa, pb, k.x) + nrm * k.y * w;
  o.pos = vec4f(px / V.canvas * 2.0 - 1.0, 0.0, 1.0);
  let life = partsR[p].w;
  let age = b.w;
  let tailF = pow(f32(s + 1u) / f32(segs), 1.4);
  let ageF = clamp(age / 6.0, 0.0, 1.0) * clamp((life - age) / 10.0, 0.0, 1.0);
  let sp = mix(a.z, b.z, k.x) / V.U;
  // Over a colored field the streaks are near white. Over the plain field
  // they carry the speed color themselves.
  var base = mix(vec3f(0.80, 0.88, 0.95), vec3f(1.0, 0.97, 0.92), clamp(sp, 0.0, 1.0));
  if (V.field == 4u) { base = speedRamp(0.25 + sp * 0.9) * 1.15 + vec3f(0.06); }
  o.col = vec4f(base, tailF * ageF * V.lineAlpha);
  o.across = k.y * w;
  return o;
}

@fragment
fn fsLine(i: LOut) -> @location(0) vec4f {
  let edge = 1.0 - smoothstep(V.lineW * 0.5 - 0.25, V.lineW * 0.5 + 0.75, abs(i.across));
  let a = i.col.a * edge;
  return vec4f(i.col.rgb * a, a);
}
