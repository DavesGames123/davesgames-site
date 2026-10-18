// ============================================================================
//  DLA TERRAIN  ·  shaders/grass.wgsl — GPU grass blades (package VEG)
// ----------------------------------------------------------------------------
//  CORE joins common.wgsl + lib/dla-terrain-detail.wgsl in front of this
//  file. render/vegetation.js runs cs_blades0..3, cs_final, then draws
//  vs_grass / fs_grass with drawIndirect (one triangle strip per blade).
//
//  RINGS  A blade lives on a global fine grid of spacing d (GP.grid.y).
//  Its level is the number of trailing zero bits of its grid indices
//  (at most 3). Ring L (radius R0 * 2^L) enumerates the grid of spacing
//  d * 2^L, that is only the blades of level >= L. A blade shows while its
//  distance is under R(level) and fades over the last 25 % of it (it
//  shrinks into the ground). So the density falls by 4 per ring with no
//  seams, and the blades do not swim when the camera moves: a blade has
//  the same place, size and colour from every ring. Every ring has the
//  same N x N threads (N = 2 R0 / d). Far blades get wider, so the screen
//  cover stays the same.
//
//  DENSITY  biome table x moisture x slope x no water, river or sea; the
//  biome lookup is jittered by one texel so biome edges are not square.
//  HEIGHT AND COLOUR  by biome (the grass colours of GROUND ground.wgsl
//  fn biomeBase, so far blades match the ground), clump noise, season (the
//  seasonGrass windows of GROUND), dry patches, tips lighter. Snow cover
//  presses the blades flat and white. Wet blades go darker and glossy.
//  TUFTS  blades lean out of tuft centres (TUFT m cells), so the sward
//  reads as clumps, with a tint per tuft.
//  WIND  The blade is a quadratic Bezier curve (after Jahrmann and Wimmer
//  2017, "Responsive real-time grass rendering", ideas only, no code), an
//  arch with the tip curled over, the tip pushed by G.wind times the gust
//  noise field that travels downwind (the same field as props.wgsl
//  vegGust), plus a slow small sway (CHILL). The length correction keeps
//  the blade length. Soft sun shadow (common.wgsl sunShadowSoft).
//
//  GREP MAP
//    grep -n 'fn gFrustum'    sphere against the view frustum
//    grep -n 'fn cs_blades'   one entry per ring (near rings first)
//    grep -n 'fn bladeAt'     ring grid, density, cull, the blade record
//    grep -n 'fn grassBiome'  height, density and colour per biome
//    grep -n 'fn bladeCurve'  Bezier control points with wind
//    grep -n 'fn vs_grass'    the strip vertex
//    grep -n 'fn fs_grass'    the lit blade fragment
// ============================================================================

struct GrassParams {
  rings: array<vec4f, 4>,  // x, y fine grid index of the ring origin, z spacing m, w radius m
  grid: vec4f,             // x N, y fine spacing d m, z capacity, w quality
  cam: vec4f,              // xyz camera, w time s
  misc: vec4f,             // x width scale, y height scale, z R0 m, w shadows on
  flags: vec4f,            // x 1 = own aerial fog (0 when SKY haze does it)
  cloud: vec4f,            // SKY cloud shadow: x0, z0, size m (0 = none), cloud base y
};
struct Blade { a: vec4f, b: vec4f, c: vec4f };
  // a: xyz root, w height m; b: facing rad, width m, lean rad, seed; c: rgb, fade 0..1

@group(1) @binding(0) var<uniform> GP: GrassParams;
@group(1) @binding(1) var<storage, read_write> blades: array<Blade>;
@group(1) @binding(2) var<storage, read_write> gargs: array<atomic<u32>>;
@group(1) @binding(3) var<storage, read> bladesR: array<Blade>;
@group(1) @binding(4) var tCloudSh: texture_2d<f32>;   // SKY module.cloudShadow.view
@group(1) @binding(5) var sCloudSh: sampler;

const SEG: u32 = 5u;
const TUFT: f32 = 0.42;    // m: the tuft cell (blades lean out of its centre)

fn ghash(x: u32) -> u32 {
  var v = x * 747796405u + 2891336453u;
  let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (w >> 22u) ^ w;
}
fn ghash2(i: vec2i, salt: u32) -> u32 { return ghash(bitcast<u32>(i.x) ^ ghash(bitcast<u32>(i.y) ^ (salt * 0x9e3779b9u))); }
fn gfloat(h: u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }

// value noise for clumps and patches
fn gnoise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = gfloat(ghash2(i, 7u));
  let b = gfloat(ghash2(i + vec2i(1, 0), 7u));
  let c = gfloat(ghash2(i + vec2i(0, 1), 7u));
  let d = gfloat(ghash2(i + vec2i(1, 1), 7u));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// the season windows of GROUND fn seasonGrass
fn grassSeason(c: vec3f, season: f32, dry: f32) -> vec3f {
  let s = fract(season);
  let autumn = smoothstep(0.30, 0.50, s) * (1.0 - smoothstep(0.62, 0.75, s));
  let winter = smoothstep(0.58, 0.75, s) * (1.0 - smoothstep(0.92, 1.0, s));
  let spring = 1.0 - smoothstep(0.0, 0.18, s) + smoothstep(0.94, 1.0, s);
  var g = c;
  g = mix(g, g * vec3f(1.15, 1.18, 0.85), spring * 0.5);
  g = mix(g, vec3f(0.24, 0.17, 0.065), clamp(autumn * 0.6 + dry * 0.55, 0.0, 1.0));
  g = mix(g, vec3f(0.135, 0.115, 0.075), winter * 0.7);
  return g;
}

struct GB { density: f32, height: f32, col: vec3f, dryness: f32 };
// lib BIOMES ids: 0 ocean, 1 beach, 2 desert, 3 savanna, 4 grassland,
// 5 temperate forest, 6 rainforest, 7 boreal forest, 8 tundra, 9 bare rock,
// 10 snow, 11 wetland, 12 river, 13 lake, 14 scree, 15 alpine meadow.
fn grassBiome(id: u32) -> GB {
  var g: GB;
  g.density = 0.0; g.height = 0.4; g.col = vec3f(0.11, 0.165, 0.045); g.dryness = 0.0;
  switch (id) {
    case 1u: { g.density = 0.10; g.height = 0.45; g.col = vec3f(0.20, 0.19, 0.10); g.dryness = 0.5; }
    case 2u: { g.density = 0.05; g.height = 0.30; g.col = vec3f(0.30, 0.22, 0.11); g.dryness = 0.9; }
    case 3u: { g.density = 0.90; g.height = 0.75; g.col = vec3f(0.26, 0.205, 0.085); g.dryness = 0.65; }
    case 4u: { g.density = 1.00; g.height = 0.45; g.col = vec3f(0.11, 0.165, 0.045); }
    case 5u: { g.density = 0.42; g.height = 0.30; g.col = vec3f(0.075, 0.130, 0.035); }
    case 6u: { g.density = 0.50; g.height = 0.40; g.col = vec3f(0.045, 0.120, 0.028); }
    case 7u: { g.density = 0.32; g.height = 0.25; g.col = vec3f(0.080, 0.105, 0.045); }
    case 8u: { g.density = 0.55; g.height = 0.14; g.col = vec3f(0.150, 0.130, 0.072); g.dryness = 0.3; }
    case 9u: { g.density = 0.05; g.height = 0.15; g.col = vec3f(0.12, 0.13, 0.07); }
    case 11u: { g.density = 0.95; g.height = 0.70; g.col = vec3f(0.090, 0.130, 0.045); }
    case 14u: { g.density = 0.08; g.height = 0.18; g.col = vec3f(0.12, 0.14, 0.06); }
    case 15u: { g.density = 0.95; g.height = 0.22; g.col = vec3f(0.125, 0.170, 0.050); }
    default: {}
  }
  return g;
}

fn ringRadius(l: u32) -> f32 { return GP.rings[min(l, 3u)].w; }

// Sphere against the view frustum: the same plane test as props.wgsl
// fn inFrustum (side planes from the viewProj rows, scaled to metres, and
// the reverse-Z near plane w = G.proj[3][2]). The old test took
// r * proj[0][0] as the margin, which is too small by up to 30 % at the
// screen edges, and cut blades at the feet out of the view.
fn gFrustum(c: vec3f, r: f32) -> bool {
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

// One entry point per ring. render/vegetation.js dispatches ring 0 first,
// then 1, 2, 3 (in order in one pass), so the blade buffer fills from the
// camera outward: when it is full, the far blades are dropped, never the
// blades at the feet (one dispatch of all rings took the slots in any order).
@compute @workgroup_size(8, 8, 1)
fn cs_blades0(@builtin(global_invocation_id) gid: vec3u) { bladeAt(gid, 0u); }
@compute @workgroup_size(8, 8, 1)
fn cs_blades1(@builtin(global_invocation_id) gid: vec3u) { bladeAt(gid, 1u); }
@compute @workgroup_size(8, 8, 1)
fn cs_blades2(@builtin(global_invocation_id) gid: vec3u) { bladeAt(gid, 2u); }
@compute @workgroup_size(8, 8, 1)
fn cs_blades3(@builtin(global_invocation_id) gid: vec3u) { bladeAt(gid, 3u); }

fn bladeAt(gid: vec3u, L: u32) {
  let N = u32(GP.grid.x);
  if (gid.x >= N || gid.y >= N || L > 3u) { return; }
  let stp = 1 << L;
  let gi = i32(GP.rings[L].x) + i32(gid.x) * stp;
  let gj = i32(GP.rings[L].y) + i32(gid.y) * stp;
  let lvl = min(min(countTrailingZeros(bitcast<u32>(gi)), countTrailingZeros(bitcast<u32>(gj))), 3u);
  let ij = vec2i(gi, gj);
  let h0 = ghash2(ij, 1u);
  let h1 = ghash(h0);
  let jit = vec2f(gfloat(h0), gfloat(h1));
  let d = GP.grid.y;
  let xz = (vec2f(f32(gi), f32(gj)) + jit) * d;
  let dist = distance(xz, GP.cam.xz);
  // region of ring L, then the fade of the blade's own level
  var r0 = 0.0;
  if (L > 0u) { r0 = ringRadius(L - 1u); }
  if (dist < r0 || dist >= ringRadius(L)) { return; }
  let rl = ringRadius(lvl);
  let fade = 1.0 - smoothstep(rl * 0.75, max(rl, 1e-3), dist);   // rising edges (Metal)
  if (fade <= 0.0) { return; }
  if (!insideTerrain(xz)) { return; }
  // biome with a jittered lookup (one texel), so edges are not square
  let h2 = ghash(h1);
  let h3 = ghash(h2);
  let tex = G.terrain.x / f32(textureDimensions(tBiome).x);
  let bj = (vec2f(gfloat(h2), gfloat(h3)) - 0.5) * tex * 1.4;
  var gb = grassBiome(biomeAt(xz + bj));
  if (gb.density <= 0.0) { return; }
  let aux = terrainAux(xz);
  if (aux.a > 0.03 || aux.g > 0.4) { return; }
  let nrm = terrainNormal(xz);
  if (nrm.y < 0.62) { return; }
  let moist = aux.b;
  // clumps (a few metres) and patches (tens of metres)
  let clump = gnoise(xz * 0.55);
  let patchN = gnoise(xz * 0.045 + vec2f(17.0, 3.0));
  var dens = gb.density * smoothstep(0.62, 0.8, nrm.y);
  dens *= mix(0.25, 1.0, smoothstep(0.04, 0.35, moist + (1.0 - gb.dryness) * 0.15));
  dens *= mix(0.55, 1.15, smoothstep(0.25, 0.7, clump));
  dens *= mix(0.6, 1.0, smoothstep(0.15, 0.55, patchN));
  let h4 = ghash(h3);
  if (gfloat(h4) >= dens) { return; }
  let y = terrainHeight(xz);
  if (y < G.terrain.z + 0.25) { return; }
  // height: biome x clump x random; snow presses it down
  let h5 = ghash(h4);
  let h6 = ghash(h5);
  var hgt = gb.height * mix(0.55, 1.35, clump) * mix(0.7, 1.3, gfloat(h5)) * GP.misc.y;
  hgt *= mix(0.65, 1.15, smoothstep(0.1, 0.7, moist));
  let snowC = G.weather2.y;
  hgt *= 1.0 - snowC * 0.8;
  // the wind pushes the tip up to 1.25 h downwind (bladeCurve): radius 1.4 h
  if (!gFrustum(vec3f(xz.x, y + hgt * 0.5, xz.y), (hgt * 1.4) + 0.3)) { return; }
  // colour (linear): the GROUND grass colour, lifted for the blade body
  let dry = clamp(gb.dryness + (0.35 - moist) + (patchN - 0.5) * 0.6, 0.0, 1.0);
  var col = grassSeason(gb.col, G.weather2.w, dry * 0.6);
  let h7 = ghash(h6);
  let v = gfloat(h7);
  col *= mix(0.8, 1.25, v) * mix(0.9, 1.1, clump);
  col = mix(col, col * vec3f(1.25, 1.1, 0.7), step(0.93, v) * 0.6);   // odd dry blades
  // TUFTS: blades group round tuft centres (a cell of TUFT m with a
  // jittered centre); a blade faces out from its centre and leans more
  // the farther out it stands, and each tuft has its own tint
  let tc = floor(xz / TUFT);
  let th = ghash2(vec2i(tc), 23u);
  let tctr = (tc + vec2f(0.2, 0.2) + (vec2f(gfloat(th), gfloat(ghash(th))) * 0.6)) * TUFT;
  let toOut = xz - tctr;
  let od = length(toOut);
  let outA = atan2(toOut.y, toOut.x);
  let rnd = gfloat(ghash(h7));
  let face = select(rnd * 6.2831853, outA + ((rnd - 0.5) * 0.9), od > 0.02);
  let lean = 0.12 + (0.55 * smoothstep(0.0, TUFT * 0.6, od)) + ((gfloat(h5 ^ h6) - 0.5) * 0.25) + (snowC * 1.1);
  col *= mix(0.86, 1.14, gfloat(ghash(th ^ 77u)));
  col = mix(col, col * vec3f(1.08, 1.0, 0.82), step(0.8, gfloat(ghash(th ^ 91u))) * 0.5);
  let k = atomicAdd(&gargs[1], 1u);
  if (k >= u32(GP.grid.z)) { return; }
  var bl: Blade;
  let wmul = clamp(dist / GP.misc.z, 1.0, 8.0);
  bl.a = vec4f(xz.x, y - 0.03, xz.y, hgt * mix(0.25, 1.0, fade));
  bl.b = vec4f(face, (0.009 + 0.012 * gfloat(h6)) * GP.misc.x * wmul * mix(1.0, 1.6, gb.dryness),
               lean, gfloat(h0 ^ h7));
  bl.c = vec4f(col, fade);
  blades[k] = bl;
}

@compute @workgroup_size(1)
fn cs_final() {
  let n = atomicLoad(&gargs[1]);
  atomicStore(&gargs[1], min(n, u32(GP.grid.z)));
}

// ---------------------------------------------------------------- draw --
// the travelling gust field of props.wgsl vegGust (same noise, same
// motion): patches of about 40 m that move downwind at about the wind speed
fn grassGust(xz: vec2f, t: f32) -> f32 {
  let w = G.wind.xy;
  let sp = max(length(w), 0.01);
  let dir = w / sp;
  let side = vec2f(-dir.y, dir.x);
  let q = vec2f(dot(xz, dir) - (t * (1.5 + (sp * 0.8))), dot(xz, side)) / vec2f(38.0, 55.0);
  let g = (gVNoise(q) * 0.65) + (gVNoise((q * 2.3) + vec2f(7.1, 3.7)) * 0.35);
  return mix(0.3, 1.0, smoothstep(0.25, 0.85, g)) * (0.7 + (G.wind.z * 0.6));
}
// value noise on cm_hash12 (the props.wgsl vegNoise lattice)
fn gVNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - (2.0 * f));
  let a = cm_hash12(i); let b = cm_hash12(i + vec2f(1.0, 0.0));
  let c = cm_hash12(i + vec2f(0.0, 1.0)); let d = cm_hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

struct Curve { p0: vec3f, p1: vec3f, p2: vec3f, side: vec3f, face: vec3f };
fn bladeCurve(bl: Blade) -> Curve {
  var c: Curve;
  let t = G.camPos.w;
  let h = bl.a.w;
  let a = bl.b.x;
  c.face = vec3f(cos(a), 0.0, sin(a));
  c.side = vec3f(-sin(a), 0.0, cos(a));
  c.p0 = bl.a.xyz;
  let lean = bl.b.z;
  // an arched blade: the mid point stands high, the tip curls over
  var tip = c.p0 + vec3f(0.0, h * cos(lean), 0.0) + c.face * (h * sin(lean));
  var mid = c.p0 + vec3f(0.0, h * 0.72, 0.0) + c.face * (h * sin(lean) * 0.18);
  // wind: gusts push the tip downwind, a small flutter per blade
  let w = G.wind.xy;
  let speed = length(w);
  let dir = select(vec2f(1.0, 0.0), w / max(speed, 1e-3), speed > 1e-3);
  let g = grassGust(c.p0.xz, t);
  let ph = bl.b.w * 6.2831853;
  // CHILL: a slow sway (0.5 to 0.9 Hz) of a few per cent, the gust does
  // the rest as it travels across the field
  let flutter = sin((t * 6.2831853 * (0.5 + (bl.b.w * 0.4))) + ph + dot(c.p0.xz, vec2f(0.7, 0.4))) * (0.025 + (speed * 0.008)) * g;
  let push = clamp(speed * 0.065 * g, 0.0, 1.1) + flutter;
  let wv = vec3f(dir.x, 0.0, dir.y) * (push * h);
  tip += wv;
  mid += wv * 0.45;
  // keep the length (approximate Bezier length, Jahrmann and Wimmer)
  let l0 = distance(c.p0, tip);
  let l1 = distance(c.p0, mid) + distance(mid, tip);
  let len = (2.0 * l0 + l1) / 3.0;
  let r = h / max(len, 1e-4);
  c.p1 = c.p0 + (mid - c.p0) * r;
  c.p2 = c.p0 + (tip - c.p0) * r;
  return c;
}

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
  @location(3) t: f32,
  @location(4) fade: f32,
};

@vertex
fn vs_grass(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  let bl = bladesR[ii];
  let c = bladeCurve(bl);
  let seg = vi / 2u;
  let t = f32(seg) / f32(SEG);
  var sideK = select(-1.0, 1.0, (vi & 1u) == 1u);
  if (seg >= SEG) { sideK = 0.0; }
  let u = 1.0 - t;
  let p = c.p0 * (u * u) + c.p1 * (2.0 * u * t) + c.p2 * (t * t);
  let tan = normalize((c.p1 - c.p0) * (2.0 * u) + (c.p2 - c.p1) * (2.0 * t) + vec3f(0.0, 1e-4, 0.0));
  let w = bl.b.y * pow(1.0 - t, 0.85) * 0.5;
  let wp = p + c.side * (sideK * w);
  var n = normalize(cross(c.side, tan));
  // rounded blade: bend the normal across the width
  n = normalize(n + c.side * (sideK * 0.45));
  o.wp = wp;
  o.pos = G.viewProj * vec4f(wp, 1.0);
  o.nrm = n;
  o.col = bl.c.rgb;
  o.t = t;
  o.fade = bl.c.w;
  return o;
}

// SKY's moving cloud shadows (as GROUND fn cloudShadowAt). 1 = lit.
fn grassCloud(p: vec3f) -> f32 {
  if (GP.cloud.z <= 0.0) { return 1.0; }
  let t = max(GP.cloud.w - p.y, 0.0) / max(G.sunDir.y, 0.08);
  let q = p.xz + (G.sunDir.xz * t);
  let uv = (q - GP.cloud.xy) / GP.cloud.z;
  let inside = all(uv > vec2f(0.0)) && all(uv < vec2f(1.0));
  let T = select(1.0 - (0.7 * G.weather.x), textureSampleLevel(tCloudSh, sCloudSh, uv, 0.0).r, inside);
  return mix(1.0, T, smoothstep(-0.04, 0.03, G.sunDir.y));
}

fn grassAerial(col: vec3f, world: vec3f) -> vec3f {
  // after GROUND shaders/ground.wgsl fn aerial (height falloff fog)
  if (GP.flags.x < 0.5) { return col; }
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

@fragment
fn fs_grass(o: GOut) -> @location(0) vec4f {
  let V = normalize(G.camPos.xyz - o.wp);
  var n = normalize(o.nrm);
  if (dot(n, V) < 0.0) { n = -n; }
  // blades near the ground lean their normal to the terrain (soft look)
  let tn = terrainNormal(o.wp.xz);
  n = normalize(mix(tn, n, 0.35 + 0.5 * o.t));
  // albedo: root darker, tip lighter and drier
  var alb = o.col * mix(0.55, 1.15, o.t);
  alb = mix(alb, alb * vec3f(1.25, 1.12, 0.75), smoothstep(0.7, 1.0, o.t) * 0.5);
  // at the fade, toward the ground colour (the blade sinks into it)
  alb = mix(o.col * 0.75, alb, smoothstep(0.0, 0.6, o.fade));
  let wet = G.weather2.x;
  alb *= 1.0 - wet * 0.35;
  let snow = G.weather2.y * (0.4 + 0.6 * o.t);
  alb = mix(alb, vec3f(0.82, 0.86, 0.90), clamp(snow, 0.0, 1.0) * 0.85);
  let L = normalize(G.sunDir.xyz);
  let sunE = G.sunColor.rgb;   // radiance at ground (as GROUND and WATER)
  var sh = 1.0;
  // the soft shadow of the trees and rocks (PCSS, as the ground under it)
  if ((GP.misc.w > 0.5) && (L.y > -0.05)) { sh = sunShadowSoft(o.wp, tn, o.pos.xy); }
  sh *= grassCloud(o.wp);
  sh *= smoothstep(-0.06, 0.05, L.y);
  // self shadow inside the sward: deep blades see less sun and sky. The
  // contact hint: the lowest fifth of a blade goes near black, so the
  // sward reads as standing on the ground, not pasted over it
  let contact = mix(0.35, 1.0, smoothstep(0.0, 0.22, o.t));
  let ao = mix(0.2, 1.0, pow(o.t, 0.65)) * contact * terrainAO(o.wp.xz);
  sh *= mix(0.45, 1.0, smoothstep(0.0, 0.3, o.t));
  let ndl = dot(n, L);
  var col = alb / CM_PI * max((ndl + 0.5) / 1.5, 0.0) * sunE * sh * mix(0.5, 1.0, o.t);
  // light through the blade, strongest toward the sun
  let back = pow(clamp(dot(-V, L), 0.0, 1.0), 4.0) * 1.1 + 0.15;
  col += alb * vec3f(1.1, 1.2, 0.5) * sunE * sh * back * o.t / CM_PI * 0.8;
  // sheen (wet blades shine more)
  let hv = normalize(V + L);
  col += sunE * sh * pow(max(dot(n, hv), 0.0), mix(24.0, 80.0, wet)) * mix(0.02, 0.10, wet) * o.t;
  // moon and sky
  let M = normalize(G.moonDir.xyz);
  if (M.y > 0.0) { col += alb / CM_PI * max(dot(n, M) + 0.4, 0.0) * vec3f(0.55, 0.62, 0.80) * G.moonDir.w; }
  let hemi = mix(0.35, 1.0, (n.y * 0.5) + 0.5);
  col += alb * G.ambient.rgb * 0.5 * hemi * ao;
  // terrain bounce, as GROUND and the props: fill light in shaded valleys
  col += alb * sunE * (clamp(L.y + 0.1, 0.0, 1.0) * 0.06 * ao);
  col = grassAerial(col, o.wp);
  return vec4f(col, 1.0);
}
