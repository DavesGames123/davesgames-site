// ============================================================================
//  DLA TERRAIN  ·  shaders/props.wgsl — trees, bushes, rocks, ferns (VEG)
// ----------------------------------------------------------------------------
//  CORE joins common.wgsl + lib/dla-terrain-detail.wgsl in front of this
//  file (G, terrainHeight, sunShadow, cm_ign, cascades, SP).
//
//  GPU CULL AND LOD (render/vegetation.js runs the passes in this order)
//    cs_snap   new instance pages: y = terrainHeight(xz) (ground contact)
//    cs_count  per instance: distance band of its layer (dither cross-fade
//              of canopy and far canopy), frustum sphere test, LOD from the
//              projected height in px (VP.lodPx), a dither cross-fade band
//              between two LODs, and a shadow list. atomicAdd into counts.
//    cs_scan   one workgroup: prefix sum of the counts -> offsets, then the
//              drawIndexedIndirect args of every draw slot.
//    cs_emit   the same classify() again, writes visible[offset + k].
//  A list is (species, lod) for the camera (lod 3 = the impostor) and
//  (species, near | far) for the sun shadow. A draw slot is one mesh part
//  of one list. The vertex shader reads visible[offsets[list] + instance].
//
//  SHADING  PBR (GGX + Lambert), leaf cards two sided with wrap diffuse and
//  sun transmission (light through leaves), alpha test with a mip bias so
//  far crowns keep their cover, season colours for broadleaf trees (autumn
//  tints, bare winter crowns), snow on top faces, rain darkening, CORE's
//  cascaded sun shadow, aerial perspective (the formula of GROUND's
//  shaders/ground.wgsl fn aerial, so trees and ground fog alike).
//  Impostors: 8 baked side views per tree species (vegetation.js bakes
//  them at start), the two nearest views blended, lit from the baked
//  normals.
//
//  WIND  trunk bend by (height / tree height)^2 (vertex bend weight),
//  a travelling gust wave along G.wind, and leaf flutter by the flutter
//  weight (distance from the branch).
//
//  GREP MAP
//    grep -n 'fn inFrustum'     sphere against the 4 side planes and near
//    grep -n 'fn instanceBounds' the bounding sphere of a plant
//    grep -n 'fn classify'      band, frustum, LOD and shadow choice
//    grep -n 'fn cs_scan'       offsets and indirect args
//    grep -n 'fn windOffset'    tree sway and flutter
//    grep -n 'fn vs_mesh'       the instanced mesh vertex
//    grep -n 'fn fs_mesh'       the PBR foliage and bark fragment
//    grep -n 'fn vs_imp'        the impostor quad
//    grep -n 'fn vs_imp_shadow' the far shadow caster (sun facing quad)
//    grep -n 'fn vs_bake'       the impostor bake
//    grep -n 'fn vegAerial'     fog
// ============================================================================

struct VegParams {
  cam: vec4f,       // xyz camera, w time s
  misc: vec4f,      // x shadow far m, y instance slots, z lod scale, w frame
  proj: vec4f,      // x proj[0][0], y proj[1][1], z screen height px, w quality
  lodPx: vec4f,     // px: lod0 above x, lod1 above y, lod2 above z, cull below w
  sun: vec4f,       // xyz toward the sun, w 1 when shadows are on
  counts: vec4f,    // x lists, y slots, z species, w 1 = own aerial fog (0 when SKY haze does it)
  cloud: vec4f,     // SKY cloud shadow: x0, z0, size m (0 = none), cloud base y
  layers: array<vec4f, 8>,  // near m, far m, band m, far-end band m (0 = band)
};
// Per species: a = height m, radius m, lod count, flags (bit 0 impostor,
// 1 deciduous, 2 no shadow, 3 rock triplanar, 4 conifer, 5 flower tint)
// b = bend m per m/s, flutter, sink fraction, lean rad
struct Species { a: vec4f, b: vec4f };
struct Inst { p: vec4f, q: vec4f };   // x y z scale | yaw, species + 256 layer, tint, seed
struct Slot { list: u32, indexCount: u32, firstIndex: u32, baseVertex: u32 };
struct Draw { list: u32, layer: u32, flags: u32, species: u32 };  // flags bit 0 leaf, 1 impostor, 2 rock
struct Bake { viewProj: mat4x4f, info: vec4f };   // info x view index

@group(1) @binding(0) var<uniform> VP: VegParams;
@group(1) @binding(1) var<storage, read> species: array<Species>;
@group(1) @binding(2) var<storage, read_write> inst: array<Inst>;
@group(1) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;   // [0, lists) counts, [lists, 2 lists) emit cursors
@group(1) @binding(4) var<storage, read_write> offsets: array<u32>;
@group(1) @binding(5) var<storage, read_write> visible: array<vec2u>;
@group(1) @binding(6) var<storage, read_write> args: array<u32>;
@group(1) @binding(7) var<storage, read> slots: array<Slot>;
@group(1) @binding(8) var<storage, read> pages: array<u32>;

@group(1) @binding(10) var<storage, read> instR: array<Inst>;
@group(1) @binding(11) var<storage, read> offsetsR: array<u32>;
@group(1) @binding(12) var<storage, read> visibleR: array<vec2u>;
@group(1) @binding(13) var tMat: texture_2d_array<f32>;
@group(1) @binding(14) var sRep: sampler;
@group(1) @binding(15) var tImpA: texture_2d_array<f32>;
@group(1) @binding(16) var tImpN: texture_2d_array<f32>;
@group(1) @binding(17) var<uniform> BK: Bake;
@group(1) @binding(18) var tCloudSh: texture_2d<f32>;   // SKY module.cloudShadow.view (r: sun transmittance)
@group(1) @binding(19) var sCloudSh: sampler;
@group(3) @binding(0) var<uniform> D: Draw;

const PAGE: u32 = 128u;      // render/vegetation.js PAGE
const LODS: u32 = 4u;        // camera lists per species (3 meshes + impostor)
const NEAR_FULL: f32 = 7.0;  // m: the least size for the LOD choice (vegetation.js NEAR_FULL)

fn spOf(q: vec4f) -> u32 { return u32(q.y + 0.5) % 256u; }
fn layerOf(q: vec4f) -> u32 { return u32(q.y + 0.5) / 256u; }

// ---------------------------------------------------------------- snap --
@compute @workgroup_size(256)
fn cs_snap(@builtin(global_invocation_id) gid: vec3u) {
  let pg = gid.x / PAGE;
  if (pg >= arrayLength(&pages)) { return; }
  let i = pages[pg] * PAGE + (gid.x % PAGE);
  if (i >= arrayLength(&inst)) { return; }
  var it = inst[i];
  if (it.p.w <= 0.0) { return; }
  it.p.y = terrainHeight(it.p.xz);
  inst[i] = it;
}

// ------------------------------------------------------------ classify --
struct Cls { n: u32, list0: u32, fade0: u32, list1: u32, fade1: u32, shadow: u32 };

// Sphere against the view frustum (render/vegetation.js sphereInFrustum
// is the CPU twin). The four side planes come from the rows of viewProj
// (w + x >= 0, w - x >= 0, w + y >= 0, w - y >= 0), each scaled to metres
// by the length of its normal, so the margin is the true sphere radius at
// every distance and screen edge (with the TAA jitter and the saver lens
// shift in the matrix). The near plane: reverse-Z, infinite far, so
// clip w is the view depth and the plane is w = near (G.proj[3][2]).
fn inFrustum(c: vec3f, r: f32) -> bool {
  let m = G.viewProj;
  let q = m * vec4f(c, 1.0);
  let r0 = vec3f(m[0].x, m[1].x, m[2].x);
  let r1 = vec3f(m[0].y, m[1].y, m[2].y);
  let r3 = vec3f(m[0].w, m[1].w, m[2].w);
  if (q.w < G.proj[3][2] - (r * length(r3))) { return false; }
  if ((q.w + q.x) < -(r * length(r3 + r0))) { return false; }
  if ((q.w - q.x) < -(r * length(r3 - r0))) { return false; }
  if ((q.w + q.y) < -(r * length(r3 + r1))) { return false; }
  if ((q.w - q.y) < -(r * length(r3 - r1))) { return false; }
  return true;
}

// The bounding sphere of one instance (CPU twin: vegetation.js
// instanceBounds). The sphere holds the whole plant: centre at half height
// over the sunk root, radius from the half height and the crown radius
// (the old max(0.55 h, crown radius) missed the crown rim at the top), plus
// the lean (a tilt round the root moves the centre by h/2 sin lean), the
// wider crown of far impostors, and the most that the wind moves a vertex
// (windOffset: bend at most 0.122 speed bend min(h, 30), flutter at most
// 1.9 flutter (0.15 + 0.05 speed)). LOD 1 and 2 cards are a little larger:
// 10 % more.
struct Bounds { c: vec3f, r: f32 };
fn instanceBounds(it: Inst, sp: Species) -> Bounds {
  var b: Bounds;
  let s = it.p.w;
  let h = sp.a.x * s;
  let root = it.p.xyz - vec3f(0.0, sp.b.z * h, 0.0);
  b.c = root + vec3f(0.0, h * 0.5, 0.0);
  var rad = sp.a.y * s;
  if (layerOf(it.q) == 1u) { rad = rad * (1.0 + (0.7 * smoothstep(1200.0, 5000.0, distance(VP.cam.xyz, root)))); }
  let speed = length(G.wind.xy);
  let wind = (0.122 * speed * sp.b.x * min(h, 30.0)) + (1.9 * sp.b.y * (0.15 + (0.05 * speed)));
  b.r = (length(vec2f(h * 0.5, rad)) * 1.1) + (h * 0.5 * abs(sp.b.w)) + wind;
  return b;
}

// fade value packing: v > 0 keeps dither < v (1 keeps all), v < 0 keeps
// dither >= -v (never -0: use 1 for all);
// the layer fade rides in the high half (keep hash < lf).
fn packFade(v: f32, lf: f32) -> u32 { return pack2x16float(vec2f(v, lf)); }

fn classify(i: u32) -> Cls {
  var c: Cls;
  c.n = 0u; c.shadow = 0xffffffffu;
  let it = inst[i];
  if (it.p.w <= 0.0) { return c; }
  let s = spOf(it.q);
  let L = layerOf(it.q);
  let sp = species[s];
  let h = sp.a.x * it.p.w;
  let bd = instanceBounds(it, sp);
  let center = bd.c;
  let r = bd.r;
  let d = distance(center, VP.cam.xyz);
  // layer band
  let lb = VP.layers[L];
  var lf = 1.0;
  // edges always rise (Metal: smoothstep with a >= b is undefined); the
  // far edge fades over lb.w when it is set (a wide band at the horizon)
  let band = max(lb.z, 1.0);
  let farBand = max(select(band, lb.w, lb.w > 0.0), 1.0);
  if (lb.x > 0.0) { lf = smoothstep(lb.x, lb.x + band, d); }
  lf = lf * (1.0 - smoothstep(max(lb.y - farBand, 0.0), max(lb.y, 1.0), d));
  if (lf <= 0.002) { return c; }
  let flags = u32(sp.a.w + 0.5);
  // shadow list: near the camera, and the sphere or its shadow in view.
  // The shadow reaches (h + 8) / sun height from the plant (to 400 m), so
  // a low sun keeps the casters outside the view whose shadows fall in it
  if (VP.sun.w > 0.5 && (flags & 4u) == 0u && d < VP.misc.x) {
    let off = -VP.sun.xyz * min((h + 8.0) / max(VP.sun.y, 0.12), 400.0);
    if (inFrustum(center + off * 0.5, r + length(off) * 0.5)) {
      let near = select(1u, 0u, d < 45.0);
      c.shadow = u32(VP.counts.z) * LODS + s * 2u + near;
    }
  }
  if (!inFrustum(center, r)) { return c; }
  // screen size: the larger of the height and the crown width (a log is
  // 0.6 m high and 4.5 m long). The LOD takes at least NEAR_FULL m, so a
  // fern or a flower near the camera draws its full LOD0 mesh (by height
  // alone a 0.45 m flower was LOD 1 or 2 from 1 m out); the small prop cut
  // takes the true size.
  let size = max(h, 2.0 * sp.a.y * it.p.w);
  let pk = VP.proj.y * 0.5 * VP.proj.z / max(d, 0.5) * VP.misc.z;
  let pxC = size * pk;
  let px = max(size, NEAR_FULL) * pk;
  let lods = u32(sp.a.z + 0.5);
  let imp = (flags & 1u) != 0u;
  let last = select(lods, lods + 1u, imp);   // levels incl. impostor
  // continuous level: thresholds lodPx.x > y > z; band 25 % below each
  var th = array<f32, 3>(VP.lodPx.x, VP.lodPx.y, VP.lodPx.z);
  var lvl = 0u;
  var b = 0.0;
  // bounded: lvl counts up from 0 and the loop breaks at 3
  loop {
    if (lvl >= 3u || lvl + 1u >= last) { break; }
    let t = th[lvl];
    if (px >= t) { break; }
    let lo = t * 0.75;
    if (px > lo) { b = (t - px) / (t - lo); break; }
    lvl += 1u;
  }
  let base = s * LODS;
  // mesh level lvl < lods, or the impostor (list 3)
  let l0 = select(3u, lvl, lvl < lods);
  let l1i = lvl + 1u;
  let l1 = select(3u, l1i, l1i < lods);
  // small props without an impostor fade out below the cull size
  if (!imp && lvl + 1u >= lods) {
    let cut = max(VP.lodPx.w, 0.01);
    if (pxC < cut) { return c; }
    let fb = 1.0 - smoothstep(cut, cut * 1.6, pxC);
    c.n = 1u; c.list0 = base + l0; c.fade0 = select(packFade(-fb, lf), packFade(1.0, lf), fb <= 0.001);
    return c;
  }
  if (b > 0.0 && l1i < last) {
    c.n = 2u;
    c.list0 = base + l0; c.fade0 = packFade(-b, lf);
    c.list1 = base + l1; c.fade1 = packFade(b, lf);
  } else {
    c.n = 1u; c.list0 = base + l0; c.fade0 = packFade(1.0, lf);
  }
  return c;
}

@compute @workgroup_size(256)
fn cs_count(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(VP.misc.y)) { return; }
  let c = classify(i);
  if (c.n > 0u) { atomicAdd(&counts[c.list0], 1u); }
  if (c.n > 1u) { atomicAdd(&counts[c.list1], 1u); }
  if (c.shadow != 0xffffffffu) { atomicAdd(&counts[c.shadow], 1u); }
}

@compute @workgroup_size(64)
fn cs_scan(@builtin(local_invocation_id) lid: vec3u) {
  // constant caps on the list and slot loops (render/vegetation.js sizes)
  let nl = min(u32(max(VP.counts.x, 0.0)), 4096u);
  if (lid.x == 0u) {
    var acc = 0u;
    for (var k = 0u; k < nl; k++) {
      offsets[k] = acc;
      acc += atomicLoad(&counts[k]);
    }
  }
  workgroupBarrier();
  storageBarrier();
  let ns = min(u32(max(VP.counts.y, 0.0)), 16384u);
  for (var k = lid.x; k < ns; k += 64u) {
    let sl = slots[k];
    let o = k * 5u;
    args[o] = sl.indexCount;
    args[o + 1u] = atomicLoad(&counts[sl.list]);
    args[o + 2u] = sl.firstIndex;
    args[o + 3u] = sl.baseVertex;
    args[o + 4u] = 0u;
  }
}

@compute @workgroup_size(256)
fn cs_emit(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(VP.misc.y)) { return; }
  let c = classify(i);
  let nl = u32(VP.counts.x);
  if (c.n > 0u) { let k = atomicAdd(&counts[nl + c.list0], 1u); visible[offsets[c.list0] + k] = vec2u(i, c.fade0); }
  if (c.n > 1u) { let k = atomicAdd(&counts[nl + c.list1], 1u); visible[offsets[c.list1] + k] = vec2u(i, c.fade1); }
  if (c.shadow != 0xffffffffu) { let k = atomicAdd(&counts[nl + c.shadow], 1u); visible[offsets[c.shadow] + k] = vec2u(i, packFade(1.0, 1.0)); }
}

// ---------------------------------------------------------------- wind --
fn rotY(a: f32) -> mat3x3f {
  let c = cos(a); let s = sin(a);
  return mat3x3f(vec3f(c, 0.0, -s), vec3f(0.0, 1.0, 0.0), vec3f(s, 0.0, c));
}
// the gust field 0..1 at a world xz (shared idea with grass.wgsl gust)
fn vegGust(xz: vec2f, t: f32) -> f32 {
  let w = G.wind.xy;
  let sp = max(length(w), 0.01);
  let dir = w / sp;
  let a = dot(xz, dir) * 0.045 - t * (0.35 + sp * 0.06);
  let b = dot(xz, vec2f(-dir.y, dir.x)) * 0.021;
  let g = 0.5 + 0.5 * sin(a * 6.2831 + sin(b * 6.2831) * 1.7);
  return mix(0.35, 1.0, g * g) * (0.6 + G.wind.z * 0.8);
}
// local offset (world axes) for a vertex at height y (m, scaled) of a
// plant of height h: bend weight wb, flutter weight wf.
fn windOffset(root: vec3f, lp: vec3f, h: f32, wb: f32, wf: f32, sp: Species, seed: f32, nrm: vec3f) -> vec3f {
  let t = G.camPos.w;
  let w = G.wind.xy;
  let speed = length(w);
  let dir = select(vec2f(1.0, 0.0), w / max(speed, 1e-3), speed > 1e-3);
  let gust = vegGust(root.xz, t);
  let push = speed * sp.b.x * gust;               // tip offset m
  let sway = sin(t * (1.1 + seed * 0.6) + seed * 31.0) * (0.25 + 0.2 * G.wind.z);
  let bendAmt = (push + push * sway) * wb * min(h, 30.0) * 0.06;
  var o = vec3f(dir.x, 0.0, dir.y) * bendAmt;
  o.y = -bendAmt * bendAmt / max(h, 1.0) * 0.5;   // keep the length
  // flutter: leaves and twigs, fast and small
  let ph = dot(root + lp, vec3f(1.7, 2.3, 1.9));
  let fl = sin(t * 7.3 + ph) * 0.6 + sin(t * 11.1 + ph * 1.3) * 0.4;
  o += nrm * (fl * wf * sp.b.y * (0.15 + speed * 0.05) * (0.5 + gust));
  return o;
}

// -------------------------------------------------------------- shading --
fn vegAerial(col: vec3f, world: vec3f) -> vec3f {
  // after GROUND shaders/ground.wgsl fn aerial (height falloff fog)
  if (VP.counts.w < 0.5) { return col; }
  let cam = G.camPos.xyz;
  let dv = world - cam;
  let dist = length(dv);
  let rd = dv / max(dist, 1e-3);
  let hf = 900.0;
  let y0 = cam.y - G.terrain.z;
  let k = dv.y / hf;
  let integ = select((1.0 - exp(-k)) / k, 1.0 - (0.5 * k), abs(k) < 1e-3);
  let od = G.fog.w * exp(-max(y0, -200.0) / hf) * dist * integ;
  let tr = exp(-od * vec3f(0.85, 1.0, 1.25));
  let mu = dot(rd, normalize(G.sunDir.xyz));
  let g = 0.72;
  let hg = (1.0 - (g * g)) / (4.0 * CM_PI * pow(1.0 + (g * g) - (2.0 * g * mu), 1.5));
  let ins = G.fog.rgb + (G.sunColor.rgb * hg * 0.02 * smoothstep(-0.1, 0.1, G.sunDir.y));
  return (col * tr) + (ins * (1.0 - tr));
}

fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: f32) -> f32 {
  let h = normalize(v + l);
  let a = rough * rough;
  let a2 = a * a;
  let nh = max(dot(n, h), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nl = max(dot(n, l), 0.0);
  let dd = (nh * nh) * (a2 - 1.0) + 1.0;
  let D = a2 / (CM_PI * dd * dd);
  let k = (a + 1.0) * (a + 1.0) / 8.0;
  let Vis = 1.0 / ((nv * (1.0 - k) + k) * (nl * (1.0 - k) + k));
  let F = f0 + (1.0 - f0) * pow(1.0 - max(dot(v, h), 0.0), 5.0);
  return D * Vis * F * 0.25 * nl;
}

// season factors (the same windows as GROUND fn seasonGrass)
fn autumnF() -> f32 { let s = fract(G.weather2.w); return smoothstep(0.30, 0.50, s) * (1.0 - smoothstep(0.62, 0.75, s)); }
fn winterF() -> f32 { let s = fract(G.weather2.w); return smoothstep(0.58, 0.75, s) * (1.0 - smoothstep(0.92, 1.0, s)); }
fn springF() -> f32 { let s = fract(G.weather2.w); return 1.0 - smoothstep(0.0, 0.18, s) + smoothstep(0.94, 1.0, s); }

// conifer needles read darker and bluer than broadleaf crowns; the
// species seed spreads the forest colour (some stands lighter, some darker)
fn crownTint(c: vec3f, flags: u32, it: Inst) -> vec3f {
  var k = c;
  if ((flags & 16u) != 0u) { k = k * vec3f(0.62, 0.74, 0.70); }
  let stand = fract(sin(dot(floor(it.p.xz / 37.0), vec2f(12.9898, 78.233))) * 43758.547);
  return k * mix(0.82, 1.12, stand);
}

fn hueTint(c: vec3f, t: f32) -> vec3f {
  // t -1..1: cooler and darker .. warmer and lighter
  let warm = vec3f(1.10, 1.04, 0.80);
  let cool = vec3f(0.82, 0.95, 0.92);
  return c * mix(cool, warm, t * 0.5 + 0.5) * (0.88 + 0.16 * t);
}

// SKY's moving cloud shadows (NOTES.md SKY -> ALL, as GROUND fn
// cloudShadowAt): project p along the sun to the cloud base. 1 = lit.
fn vegCloud(p: vec3f) -> f32 {
  if (VP.cloud.z <= 0.0) { return 1.0; }
  let t = max(VP.cloud.w - p.y, 0.0) / max(G.sunDir.y, 0.08);
  let q = p.xz + (G.sunDir.xz * t);
  let uv = (q - VP.cloud.xy) / VP.cloud.z;
  let inside = all(uv > vec2f(0.0)) && all(uv < vec2f(1.0));
  let T = select(1.0 - (0.7 * G.weather.x), textureSampleLevel(tCloudSh, sCloudSh, uv, 0.0).r, inside);
  return mix(1.0, T, smoothstep(-0.04, 0.03, G.sunDir.y));
}

fn shadeVeg(alb: vec3f, n0: vec3f, wp: vec3f, leaf: bool, rough: f32, ao: f32, trans: f32, specK: f32, fc: vec2f) -> vec3f {
  let V = normalize(G.camPos.xyz - wp);
  var n = n0;
  let L = normalize(G.sunDir.xyz);
  let sunE = G.sunColor.rgb;   // radiance at ground (GROUND and WATER read it so)
  var sh = 1.0;
  if (L.y > -0.05) { sh = sunShadowSoft(wp, n, fc) * vegCloud(wp); }
  sh *= smoothstep(-0.06, 0.05, L.y);
  let ndl = dot(n, L);
  var diff: f32;
  if (leaf) { diff = max((ndl + 0.45) / 1.45, 0.0); } else { diff = max(ndl, 0.0); }
  var col = alb / CM_PI * diff * sunE * sh;
  col += vec3f(ggx(n, V, L, rough, 0.035)) * sunE * sh * specK * ao;
  if (leaf) {
    // light through the leaf: strongest looking toward the sun
    // (thin leaves pass about as much light as they reflect, more yellow)
    let back = pow(clamp(dot(-V, L), 0.0, 1.0), 4.0) * 0.6 + max(-ndl, 0.0) * 0.25;
    col += alb * vec3f(0.85, 1.0, 0.35) * sunE * sh * back * trans / CM_PI;
  }
  // moon
  let M = normalize(G.moonDir.xyz);
  if (M.y > 0.0) { col += alb / CM_PI * max(dot(n, M) + 0.3, 0.0) * vec3f(0.55, 0.62, 0.80) * G.moonDir.w; }
  // sky ambient (hemisphere), as GROUND does it
  let hemi = mix(0.35, 1.0, (n.y * 0.5) + 0.5);
  let aoA = mix(0.4, 1.0, ao);
  col += alb * G.ambient.rgb * (1.25 / CM_PI) * hemi * aoA;
  // terrain bounce, as GROUND: lit slopes across a valley fill the shade
  // (without it rocks and trunks in a shaded valley read as black cut-outs)
  col += alb * sunE * (clamp(L.y + 0.1, 0.0, 1.0) * 0.045 * (1.0 - (0.5 * n.y)) * aoA);
  return col;
}

// ------------------------------------------------------------- vertices --
struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) wind: vec2f,   // bend weight, flutter weight
  @location(4) ao: vec2f,     // ambient occlusion, leaf flag
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) ao: f32,
  @location(4) @interpolate(flat) ii: vec2u,   // instance index, fade
  @location(5) lp: vec3f,                     // local position (triplanar)
};

fn placeVertex(v: VIn, it: Inst, sp: Species) -> VOut {
  var o: VOut;
  let s = it.p.w;
  let R = rotY(it.q.x);
  let seed = it.q.w;
  // lean: a small random tilt round the yaw axis
  let lean = sp.b.w * (seed - 0.5) * 2.0;
  let cl = cos(lean); let sl = sin(lean);
  var lp = v.pos * s;
  lp = vec3f(lp.x * cl - lp.y * sl, lp.x * sl + lp.y * cl, lp.z);
  var nl = vec3f(v.nrm.x * cl - v.nrm.y * sl, v.nrm.x * sl + v.nrm.y * cl, v.nrm.z);
  var wp = R * lp;
  let nw = normalize(R * nl);
  let h = sp.a.x * s;
  let root = it.p.xyz - vec3f(0.0, sp.b.z * h, 0.0);
  wp += windOffset(root, wp, h, v.wind.x, v.wind.y, sp, seed, nw);
  o.wp = root + wp;
  o.nrm = nw;
  o.uv = v.uv;
  o.ao = v.ao.x;
  o.lp = v.pos * s;
  return o;
}

@vertex
fn vs_mesh(v: VIn, @builtin(instance_index) k: u32) -> VOut {
  let rec = visibleR[offsetsR[D.list] + k];
  let it = instR[rec.x];
  let sp = species[spOf(it.q)];
  var o = placeVertex(v, it, sp);
  o.pos = G.viewProj * vec4f(o.wp, 1.0);
  o.ii = rec;
  return o;
}

@vertex
fn vs_shadow(v: VIn, @builtin(instance_index) k: u32) -> VOut {
  let rec = visibleR[offsetsR[D.list] + k];
  let it = instR[rec.x];
  let sp = species[spOf(it.q)];
  var o = placeVertex(v, it, sp);
  o.pos = SP.viewProj * vec4f(o.wp, 1.0);
  o.ii = rec;
  return o;
}

fn ditherKeep(fc: vec2f, fade: u32, seed: f32) -> bool {
  let f = unpack2x16float(fade);
  let d = fract(cm_ign(fc) + G.frame.x * 0.6180339);
  if (f.x >= 0.0) { if (d >= f.x) { return false; } }
  else { if (d < -f.x) { return false; } }
  if (f.y < 0.999) {
    let e = fract(cm_hash12(fc + vec2f(seed * 113.0, seed * 71.0)) + G.frame.x * 0.381966);
    if (e >= f.y) { return false; }
  }
  return true;
}

// alpha with a mip bias, so far cutout crowns keep their cover
fn cutAlpha(a: f32, uv: vec2f) -> f32 {
  let dims = vec2f(textureDimensions(tMat, 0));
  let dx = dpdx(uv * dims); let dy = dpdy(uv * dims);
  let lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
  return a * (1.0 + lod * 0.22);
}

fn leafSeason(alb: vec3f, sp: Species, it: Inst) -> vec3f {
  let flags = u32(sp.a.w + 0.5);
  var c = alb;
  if ((flags & 2u) != 0u) {
    let au = autumnF();
    let pick = fract(it.q.w * 7.31);
    let autumnCol = mix(mix(vec3f(0.62, 0.22, 0.05), vec3f(0.80, 0.52, 0.08), pick), vec3f(0.55, 0.10, 0.06), step(0.8, pick));
    let l = dot(c, vec3f(0.3, 0.6, 0.1));
    c = mix(c, autumnCol * (l * 2.4 + 0.1), au * smoothstep(0.1, 0.9, fract(it.q.w * 3.7) * 0.6 + au * 0.7));
    c = mix(c, c * vec3f(1.12, 1.15, 0.80), springF() * 0.4);
  }
  return c;
}

@fragment
fn fs_mesh(o: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let it = instR[o.ii.x];
  let sp = species[spOf(it.q)];
  if (!ditherKeep(o.pos.xy, o.ii.y, it.q.w)) { discard; }
  let flags = u32(sp.a.w + 0.5);
  let leaf = (D.flags & 1u) != 0u;
  let rock = (D.flags & 4u) != 0u;
  var n = normalize(o.nrm);
  var alb: vec3f;
  var rough = 0.8;
  if (rock) {
    // triplanar on the local position (rocks have no good uv)
    let w = pow(abs(n), vec3f(4.0));
    let ws = w / (w.x + w.y + w.z);
    let p = o.lp * 0.3 + vec3f(it.q.w * 17.0);
    let cx = textureSample(tMat, sRep, p.zy, D.layer).rgb;
    let cy = textureSample(tMat, sRep, p.xz, D.layer).rgb;
    let cz = textureSample(tMat, sRep, p.xy, D.layer).rgb;
    alb = cx * ws.x + cy * ws.y + cz * ws.z;
    // moss and lichen on the top faces in moist land
    let moist = terrainAux(it.p.xz).b;
    alb = mix(alb, vec3f(0.07, 0.10, 0.035), smoothstep(0.55, 0.95, n.y) * smoothstep(0.35, 0.8, moist) * 0.7);
    rough = 0.75;
  } else {
    let tx = textureSample(tMat, sRep, o.uv, D.layer);
    if (leaf) {
      var a = cutAlpha(tx.a, o.uv);
      // near leaves (under 40 m): alpha to coverage done by hand (the HDR
      // target has one sample). The alpha is sharpened to a 1 px ramp
      // (alpha - 0.5) / fwidth(alpha), then a per pixel threshold that
      // moves each frame cuts it, so TAA resolves an anti-aliased leaf
      // edge instead of a hard stair-step. Far leaves keep the 0.5 cut.
      let fw = max(fwidth(tx.a), 1e-3);
      let sharp = clamp(((tx.a - 0.5) / fw) + 0.5, 0.0, 1.0);
      let nearK = 1.0 - smoothstep(25.0, 40.0, distance(o.wp, G.camPos.xyz));
      let thr = fract(cm_ign(o.pos.xy + vec2f(5.0, 13.0)) + (G.frame.x * 0.7548777));
      // winter: broadleaf crowns go bare (most of the leaves drop)
      if ((flags & 2u) != 0u) {
        let drop = winterF() * 0.9 + autumnF() * 0.15;
        if (fract(it.q.w * 13.7 + o.uv.x * 0.37) < drop) { a = 0.0; }
      }
      if (a <= 0.0) { discard; }
      if (nearK > 0.0) { if (sharp <= mix(0.5, thr, nearK)) { discard; } }
      else if (a < 0.5) { discard; }
      if (!ff) { n = -n; }
      rough = 0.55;
    }
    alb = tx.rgb;
  }
  if (leaf || (flags & 32u) != 0u) {
    alb = leafSeason(alb, sp, it);
    alb = hueTint(alb, it.q.z);
    if (leaf) { alb = crownTint(alb, flags, it); }
  } else {
    alb *= 0.9 + 0.1 * it.q.z;
  }
  // flowers: the tint picks the petal colour (bright parts only)
  if ((flags & 32u) != 0u && leaf) {
    let pick = fract(it.q.z * 3.3 + 0.5);
    let petal = select(select(select(vec3f(0.62, 0.60, 0.56), vec3f(0.70, 0.50, 0.04), pick > 0.3), vec3f(0.36, 0.16, 0.52), pick > 0.55), vec3f(0.62, 0.08, 0.06), pick > 0.82);
    let bright = smoothstep(0.25, 0.45, max(alb.r, alb.b) - alb.g * 0.5);
    alb = mix(alb, petal * (dot(alb, vec3f(0.33)) * 1.6 + 0.2), bright);
  }
  // weather: rain darkens, snow lies on top faces
  let wet = G.weather2.x;
  alb *= 1.0 - wet * 0.3;
  rough = mix(rough, rough * 0.5, wet);
  let snow = G.weather2.y * smoothstep(0.2, 0.85, n.y) * select(1.0, 0.7, leaf);
  alb = mix(alb, vec3f(0.85, 0.88, 0.92), snow);
  let ao = mix(1.0, o.ao, 0.85) * terrainAO(it.p.xz);
  var col = shadeVeg(alb, n, o.wp, leaf, rough, ao, select(0.0, 1.0, leaf), select(1.0, 0.35, leaf), o.pos.xy);
  col = vegAerial(col, o.wp);
  return vec4f(col, 1.0);
}

@fragment
fn fs_shadow(o: VOut) {
  let it = instR[o.ii.x];
  let a = textureSample(tMat, sRep, o.uv, D.layer).a;
  let sp = species[spOf(it.q)];
  var drop = 0.0;
  if ((u32(sp.a.w + 0.5) & 2u) != 0u) { drop = winterF() * 0.9; }
  if (cutAlpha(a, o.uv) < 0.5 || fract(it.q.w * 13.7 + o.uv.x * 0.37) < drop) { discard; }
}

// ------------------------------------------------------------- impostor --
// The quad mesh: pos.xy in -0.5..0.5 x 0..1 (width, height), the frame
// half width (m) and height (m) per species ride in the draw: the vertex
// mesh pos.z holds the frame width / height ratio.
struct IOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) ii: vec2u,
  @location(3) @interpolate(flat) views: vec2u,
  @location(4) blendW: f32,
  @location(5) @interpolate(flat) basis: vec4f,  // right.xz, toward cam.xz
};

const NVIEW: u32 = 8u;

@vertex
fn vs_imp(v: VIn, @builtin(instance_index) k: u32) -> IOut {
  var o: IOut;
  let rec = visibleR[offsetsR[D.list] + k];
  let it = instR[rec.x];
  let sp = species[spOf(it.q)];
  let s = it.p.w;
  let h = sp.a.x * s;
  let root = it.p.xyz - vec3f(0.0, sp.b.z * h, 0.0);
  var toC = G.camPos.xz - root.xz;
  toC = toC / max(length(toC), 1e-3);
  let right = vec2f(toC.y, -toC.x);
  // view angle in the tree frame (yaw), pick the two nearest of 8 views
  let ang = atan2(toC.x, toC.y) - it.q.x;
  let fv = fract(ang / 6.2831853) * f32(NVIEW);
  let v0 = u32(floor(fv)) % NVIEW;
  o.views = vec2u(v0, (v0 + 1u) % NVIEW);
  o.blendW = fract(fv);
  // far canopy: one far tree stands for about five near ones (spacing 6.5
  // m against 3.4 m), so its crown widens with distance to keep the cover
  let dC = distance(G.camPos.xyz, root);
  let widen = select(1.0, 1.0 + (0.7 * smoothstep(1200.0, 5000.0, dC)), layerOf(it.q) == 1u);
  let fw = v.pos.z * h * widen;      // frame width m
  // wind: the top sways like the mesh trunk
  let wb = v.pos.y * v.pos.y;
  let wo = windOffset(root, vec3f(0.0, v.pos.y * h, 0.0), h, wb, 0.0, sp, it.q.w, vec3f(0.0, 1.0, 0.0));
  let wp = root + vec3f(right.x, 0.0, right.y) * (v.pos.x * fw) + vec3f(0.0, v.pos.y * h, 0.0) + wo;
  o.wp = wp;
  o.pos = G.viewProj * vec4f(wp, 1.0);
  o.uv = vec2f(v.pos.x + 0.5, 1.0 - v.pos.y);
  o.ii = rec;
  o.basis = vec4f(right, toC);
  return o;
}

fn impUV(uv: vec2f, view: u32) -> vec2f {
  // 4 x 2 frames per atlas layer
  let col = f32(view % 4u); let row = f32(view / 4u);
  return (vec2f(col, row) + clamp(uv, vec2f(0.004), vec2f(0.996))) * vec2f(0.25, 0.5);
}

@fragment
fn fs_imp(o: IOut) -> @location(0) vec4f {
  let it = instR[o.ii.x];
  let sp = species[spOf(it.q)];
  if (!ditherKeep(o.pos.xy, o.ii.y, it.q.w)) { discard; }
  let layer = D.layer;
  // per pixel choice of view (dither on the blend), no double exposure
  let pickB = cm_ign(o.pos.xy + vec2f(17.0, 5.0)) < o.blendW;
  let view = select(o.views.x, o.views.y, pickB);
  // the view frame turns with its own angle: shift u to match
  let uv = impUV(o.uv, view);
  // A frame is 256 px, a far tree a few px: the right mip (4 to 6) has
  // averaged the crown with the empty frame, and a 0.5 cut on it draws the
  // whole frame as a square block. So the sample level stops at 2.5 (the
  // crown silhouette still holds there) and, past mip 4, the cut turns
  // into a per pixel dither (coverage, as alpha to coverage; TAA smooths it)
  let dimsA = vec2f(textureDimensions(tImpA, 0));
  let ddx = dpdx(uv * dimsA); let ddy = dpdy(uv * dimsA);
  let mipA = max(0.0, 0.5 * log2(max(max(dot(ddx, ddx), dot(ddy, ddy)), 1e-8)));
  let lodS = min(mipA, 2.5);
  let a = textureSampleLevel(tImpA, sRep, uv, layer, lodS);
  let cutT = mix(0.5, 0.2 + (0.6 * fract(cm_ign(o.pos.xy) + (G.frame.x * 0.6180339))), smoothstep(4.0, 6.0, mipA));
  let alpha = a.a;
  if (alpha < cutT) { discard; }
  let nt = textureSampleLevel(tImpN, sRep, uv, layer, lodS);
  // baked normal is in the frame space of that view: x right, y up, z out
  let nf = nt.xyz * 2.0 - 1.0;
  let vAng = f32(view) / f32(NVIEW) * 6.2831853 + it.q.x;
  // world basis of that view: out = (sin, cos) in xz, right = (cos, -sin)
  let outW = vec2f(sin(vAng), cos(vAng));
  let rightW = vec2f(outW.y, -outW.x);
  let n = normalize(vec3f(rightW.x * nf.x + outW.x * nf.z, nf.y, rightW.y * nf.x + outW.y * nf.z));
  let leafy = nt.a > 0.5;
  var alb = a.rgb;
  let flags = u32(sp.a.w + 0.5);
  if (leafy) { alb = crownTint(hueTint(leafSeason(alb, sp, it), it.q.z), flags, it); }
  let wet = G.weather2.x;
  alb *= 1.0 - wet * 0.3;
  let snow = G.weather2.y * smoothstep(0.2, 0.85, n.y) * 0.7;
  alb = mix(alb, vec3f(0.85, 0.88, 0.92), snow);
  // crown self shadow: the lower crown and the inner frame get less sky
  // and sun (the bake has the mesh AO only); dense stands read as a canopy
  // with dark gaps, not as lit balls
  let hgt = 1.0 - o.uv.y;
  let rim = abs(o.uv.x - 0.5) * 2.0;
  let crown = mix(0.42, 1.0, pow(clamp(hgt, 0.0, 1.0), 0.8)) * mix(1.0, 0.85, 1.0 - rim);
  var col = shadeVeg(alb * crown, n, o.wp, leafy, 0.7, 0.85 * terrainAO(it.p.xz), select(0.0, 0.5, leafy), 0.12, o.pos.xy);
  col = vegAerial(col, o.wp);
  return vec4f(col, 1.0);
}

// The far shadow caster: the impostor quad turned to face the sun (in xz),
// with the view of the atlas that looks along the sun, alpha tested. Its
// shadow is the crown silhouette, at 2 triangles a tree.
@vertex
fn vs_imp_shadow(v: VIn, @builtin(instance_index) k: u32) -> IOut {
  var o: IOut;
  let rec = visibleR[offsetsR[D.list] + k];
  let it = instR[rec.x];
  let sp = species[spOf(it.q)];
  let h = sp.a.x * it.p.w;
  let root = it.p.xyz - vec3f(0.0, sp.b.z * h, 0.0);
  var toS = G.sunDir.xz;
  toS = select(vec2f(0.0, 1.0), toS / max(length(toS), 1e-4), length(toS) > 1e-4);
  let right = vec2f(toS.y, -toS.x);
  let ang = atan2(toS.x, toS.y) - it.q.x;
  let fv = fract(ang / 6.2831853) * f32(NVIEW);
  let v0 = u32(floor(fv + 0.5)) % NVIEW;
  o.views = vec2u(v0, v0);
  o.blendW = 0.0;
  let fw = v.pos.z * h;
  let wb = v.pos.y * v.pos.y;
  let wo = windOffset(root, vec3f(0.0, v.pos.y * h, 0.0), h, wb, 0.0, sp, it.q.w, vec3f(0.0, 1.0, 0.0));
  let wp = root + vec3f(right.x, 0.0, right.y) * (v.pos.x * fw) + vec3f(0.0, v.pos.y * h, 0.0) + wo;
  o.wp = wp;
  o.pos = SP.viewProj * vec4f(wp, 1.0);
  o.uv = vec2f(v.pos.x + 0.5, 1.0 - v.pos.y);
  o.ii = rec;
  o.basis = vec4f(right, toS);
  return o;
}

@fragment
fn fs_imp_shadow(o: IOut) {
  let a = textureSampleLevel(tImpA, sRep, impUV(o.uv, o.views.x), D.layer, 1.0).a;
  if (a < 0.5) { discard; }
}

// ----------------------------------------------------------------- bake --
// Renders one species mesh (no instance, no wind) into one impostor view.
struct BOut {
  @builtin(position) pos: vec4f,
  @location(0) nrm: vec3f,
  @location(1) uv: vec2f,
  @location(2) ao: f32,
};
struct BTarget { @location(0) albedo: vec4f, @location(1) normal: vec4f };

@vertex
fn vs_bake(v: VIn) -> BOut {
  var o: BOut;
  o.pos = BK.viewProj * vec4f(v.pos, 1.0);
  // normal into the view frame: BK.info.yz = (sin, cos) of the view angle
  let outW = vec2f(BK.info.y, BK.info.z);
  let rightW = vec2f(outW.y, -outW.x);
  o.nrm = vec3f(dot(v.nrm.xz, rightW), v.nrm.y, dot(v.nrm.xz, outW));
  o.uv = v.uv;
  o.ao = v.ao.x;
  return o;
}

@fragment
fn fs_bake(o: BOut, @builtin(front_facing) ff: bool) -> BTarget {
  let tx = textureSample(tMat, sRep, o.uv, D.layer);
  let leaf = (D.flags & 1u) != 0u;
  if (leaf && tx.a < 0.5) { discard; }
  var n = normalize(o.nrm);
  if (leaf && n.z < 0.0) { n = -n; }
  var t: BTarget;
  t.albedo = vec4f(tx.rgb * mix(1.0, o.ao, 0.85), 1.0);
  t.normal = vec4f(n * 0.5 + 0.5, select(0.0, 1.0, leaf));
  return t;
}
