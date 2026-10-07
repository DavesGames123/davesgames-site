// ============================================================================
//  STORM GLOBE  ·  shaders/overlay.wgsl  ·  particles, tracks, markers
// ----------------------------------------------------------------------------
//  Drawn after globe.wgsl, in the same render pass, with alpha blending and
//  no depth buffer. Each kind sits at its own fixed height above the unit
//  sphere (particles 1.0015, tracks 1.003, markers 1.004), and a vertex is
//  kept only when the surface point faces the eye (horizon test), so an
//  overlay never fights the globe for depth and never shows through it.
//
//  particles   compute "advance": each particle moves along the great
//              circle of the solver wind at its place (bilinear on the C
//              grid). The step is display time, not model time: kv.x model
//              seconds per frame, scaled with the camera altitude, so the
//              streaks keep a steady screen speed. Particles live in the
//              visible cap and respawn there. A ring of H positions per
//              particle makes the streak; "pvs" draws H-1 segments.
//  tracks      "svs": one screen-space quad per great-circle piece
//  markers     "mvs": one quad per marker, shapes by signed distance
//
//  grep -n targets: "fn advance", "fn pvs", "fn svs", "fn mvs", "fn mfs"
// ============================================================================
struct Frame {
  eye: vec4f, right: vec4f, up: vec4f, fwd: vec4f,
  view: vec4f, sun: vec4f, look: vec4f, look2: vec4f,
};
struct PU {
  nx: u32, ny: u32, count: u32, H: u32,
  head: u32, frame: u32, live: u32, colour: u32,
  cap: vec4f,     // cap centre xyz, cos(cap radius)
  kv: vec4f,      // model seconds per frame, R (m), life (frames), alpha
};
const PI: f32 = 3.14159265358979;

// ── shared: projection with the principal point offset ──────────────────
fn toClip(p: vec3f) -> vec4f {
  let v = p - FR.eye.xyz;
  let z = dot(v, FR.fwd.xyz);
  let x = dot(v, FR.right.xyz) / FR.right.w + FR.view.x * z;
  let y = dot(v, FR.up.xyz) / FR.up.w + FR.view.y * z;
  return vec4f(x, y, 0.5 * z, z);
}
fn facing(p: vec3f) -> f32 {
  let a = dot(normalize(p), normalize(FR.eye.xyz - p));
  return smoothstep(-0.02, 0.06, a);
}
// a quad corner around the segment a -> b, w px wide; corner 0..5
fn segCorner(ca: vec4f, cb: vec4f, w: f32, corner: u32) -> vec4f {
  let px = vec2f(FR.view.z, FR.view.w);
  let sa = ca.xy / max(ca.w, 1e-4) * px * 0.5;
  let sb = cb.xy / max(cb.w, 1e-4) * px * 0.5;
  var dir = sb - sa;
  if (length(dir) < 1e-4) { dir = vec2f(1.0, 0.0); }
  let nrm = normalize(vec2f(-dir.y, dir.x)) * w * 0.5;
  var side = 1.0; var end = 0.0;
  switch corner {
    case 0u: { side = -1.0; end = 0.0; }
    case 1u: { side = 1.0; end = 0.0; }
    case 2u: { side = -1.0; end = 1.0; }
    case 3u: { side = -1.0; end = 1.0; }
    case 4u: { side = 1.0; end = 0.0; }
    default: { side = 1.0; end = 1.0; }
  }
  let base = select(ca, cb, end > 0.5);
  let off = nrm * side / (px * 0.5) * base.w;
  return vec4f(base.xy + off, base.z, base.w);
}

@group(0) @binding(0) var<uniform> FR: Frame;

// ── particles: compute ──────────────────────────────────────────────────
@group(1) @binding(0) var<uniform> PP: PU;
@group(1) @binding(1) var<storage, read> SV: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> PART: array<vec4f>;
@group(1) @binding(3) var<storage, read_write> HIST: array<vec4f>;

fn wrapI(i: i32) -> u32 { let n = i32(PP.nx); return u32(((i % n) + n) % n); }
fn idx(i: i32, j: i32) -> u32 { return u32(j) * PP.nx + wrapI(i); }
fn fu(i: i32, j: i32) -> f32 {
  let ny = i32(PP.ny); let h = i32(PP.nx / 2u);
  if (j < 0) { return -SV[idx(i + h, -1 - j)].x; }
  if (j >= ny) { return -SV[idx(i + h, 2 * ny - 1 - j)].x; }
  return SV[idx(i, j)].x;
}
fn fv(i: i32, j: i32) -> f32 {
  let ny = i32(PP.ny); let h = i32(PP.nx / 2u);
  if (j == -1) { return 0.5 * (SV[idx(i, 0)].y - SV[idx(i + h, 0)].y); }
  if (j == ny - 1) { return 0.5 * (SV[idx(i, ny - 2)].y - SV[idx(i + h, ny - 2)].y); }
  if (j < -1) { return -SV[idx(i + h, -2 - j)].y; }
  if (j > ny - 1) { return -SV[idx(i + h, 2 * (ny - 1) - j)].y; }
  return SV[idx(i, j)].y;
}
fn wind(p: vec3f) -> vec3f {
  let lat = asin(clamp(p.z, -1.0, 1.0));
  var lon = atan2(p.y, p.x); if (lon < 0.0) { lon = lon + 2.0 * PI; }
  let dl = 2.0 * PI / f32(PP.nx); let dp = PI / f32(PP.ny);
  let fi = lon / dl - 1.0; let fj = (lat + 0.5 * PI) / dp - 0.5;
  let i0 = i32(floor(fi)); let j0 = i32(floor(fj)); let tx = fi - floor(fi); let ty = fj - floor(fj);
  let u = mix(mix(fu(i0, j0), fu(i0 + 1, j0), tx), mix(fu(i0, j0 + 1), fu(i0 + 1, j0 + 1), tx), ty);
  let gi = lon / dl - 0.5; let gj = (lat + 0.5 * PI) / dp - 1.0;
  let k0 = i32(floor(gi)); let m0 = i32(floor(gj)); let sx = gi - floor(gi); let sy = gj - floor(gj);
  let v = mix(mix(fv(k0, m0), fv(k0 + 1, m0), sx), mix(fv(k0, m0 + 1), fv(k0 + 1, m0 + 1), sx), sy);
  let e = vec3f(-sin(lon), cos(lon), 0.0);
  let nn = vec3f(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
  return u * e + v * nn;
}
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd(a: u32, b: u32) -> f32 { return f32(pcg(a ^ pcg(b)) & 0xffffffu) / 16777216.0; }
fn spawn(i: u32) -> vec3f {
  let c = normalize(PP.cap.xyz);
  let z = 1.0 - rnd(i, PP.frame * 2u + 1u) * (1.0 - PP.cap.w);
  let ph = 2.0 * PI * rnd(i * 3u + 7u, PP.frame);
  let r = sqrt(max(0.0, 1.0 - z * z));
  var a = vec3f(1.0, 0.0, 0.0);
  if (abs(c.x) > 0.9) { a = vec3f(0.0, 1.0, 0.0); }
  let e1 = normalize(cross(c, a)); let e2 = cross(c, e1);
  return normalize(c * z + (e1 * cos(ph) + e2 * sin(ph)) * r);
}
@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= PP.count) { return; }
  var p = PART[i];
  let H = PP.H;
  if (i >= PP.live) {
    for (var k = 0u; k < H; k++) { HIST[i * H + k] = vec4f(p.xyz, 0.0); }
    return;
  }
  p.w = p.w + 1.0;
  let life = PP.kv.z * (0.6 + 0.8 * rnd(i, 99u));
  if (p.w > life || dot(p.xyz, PP.cap.xyz) < PP.cap.w || length(p.xyz) < 0.5) {
    let q = spawn(i);
    p = vec4f(q, 0.0);
    for (var k = 0u; k < H; k++) { HIST[i * H + k] = vec4f(q, 0.0); }
    PART[i] = p;
    return;
  }
  let w = wind(p.xyz);
  let s = length(w);
  var q = p.xyz;
  if (s > 1e-4) {
    let th = s * PP.kv.x / PP.kv.y;
    q = normalize(p.xyz * cos(th) + (w / s) * sin(th));
  }
  PART[i] = vec4f(q, p.w);
  HIST[i * H + PP.head] = vec4f(q, s);
}

// ── particles: draw ─────────────────────────────────────────────────────
@group(1) @binding(8) var<storage, read> HISTR: array<vec4f>;   // HIST, read-only for the vertex stage
@group(1) @binding(4) var lutP: texture_2d<f32>;
@group(1) @binding(5) var sampP: sampler;
struct PV { @builtin(position) pos: vec4f, @location(0) col: vec4f, };
@vertex fn pvs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PV {
  var o: PV;
  let H = PP.H;
  let k = vi / 6u; let corner = vi % 6u;
  let ia = (PP.head + H - k) % H; let ib = (PP.head + H - k - 1u) % H;
  let A = HISTR[ii * H + ia]; let B = HISTR[ii * H + ib];
  let pa = A.xyz * 1.0015; let pb = B.xyz * 1.0015;
  let ca = toClip(pa); let cb = toClip(pb);
  let fade = 1.0 - f32(k) / f32(H - 1u);
  let vis = facing(pa) * select(1.0, 0.0, B.w <= 0.0 || A.w <= 0.0 || ii >= PP.live || ca.w <= 0.0 || cb.w <= 0.0);
  let x = sqrt(clamp(A.w / 75.0, 0.0, 1.0));
  var c = vec3f(1.0, 0.95, 0.88);
  if (PP.colour == 1u) { c = textureSampleLevel(lutP, sampP, vec2f(clamp(0.35 + 0.65 * x, 0.0, 0.998), 0.125), 0.0).rgb; }
  let a = PP.kv.w * fade * vis * (0.2 + 0.8 * smoothstep(0.15, 0.6, x));
  o.pos = segCorner(ca, cb, 1.1 * FR.fwd.w, corner);
  o.col = vec4f(c * a, a);
  return o;
}
@fragment fn pfs(i: PV) -> @location(0) vec4f { return i.col * FR.look2.w; }

// ── tracks: great-circle pieces ─────────────────────────────────────────
struct Seg { a: vec4f, b: vec4f, col: vec4f, };   // a.w = width px
@group(1) @binding(6) var<storage, read> SEG: array<Seg>;
struct SV2 { @builtin(position) pos: vec4f, @location(0) col: vec4f, };
@vertex fn svs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SV2 {
  let s = SEG[ii];
  let ca = toClip(s.a.xyz * 1.003); let cb = toClip(s.b.xyz * 1.003);
  let vis = min(facing(s.a.xyz), facing(s.b.xyz)) * select(1.0, 0.0, ca.w <= 0.0 || cb.w <= 0.0);
  var o: SV2;
  o.pos = segCorner(ca, cb, s.a.w * FR.fwd.w, vi % 6u);
  let a = s.col.a * vis;
  o.col = vec4f(s.col.rgb * a, a);
  return o;
}
@fragment fn sfs(i: SV2) -> @location(0) vec4f { return i.col * FR.look2.w; }

// ── markers ─────────────────────────────────────────────────────────────
struct Mark { p: vec4f, col: vec4f, k: vec4f, };  // p.w size px; k: shape, spin, ring, alpha
@group(1) @binding(7) var<storage, read> MK: array<Mark>;
struct MV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f, @location(2) k: vec4f, };
@vertex fn mvs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MV {
  let m = MK[ii];
  let c = toClip(m.p.xyz * 1.004);
  var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let uv = q[vi % 6u];
  let px = vec2f(FR.view.z, FR.view.w);
  var o: MV;
  o.pos = vec4f(c.xy + uv * m.p.w * FR.fwd.w / (px * 0.5) * c.w, c.z, c.w);
  o.uv = uv;
  let vis = facing(m.p.xyz) * select(1.0, 0.0, c.w <= 0.0);
  o.col = vec4f(m.col.rgb, m.col.a * m.k.w * vis);
  o.k = m.k;
  return o;
}
fn sdTri(p: vec2f) -> f32 {
  let k = sqrt(3.0);
  var q = vec2f(abs(p.x) - 0.8, p.y + 0.8 / k);
  if (q.x + k * q.y > 0.0) { q = vec2f(q.x - k * q.y, -k * q.x - q.y) / 2.0; }
  q.x = q.x - clamp(q.x, -1.6, 0.0);
  return -length(q) * sign(q.y);
}
@fragment fn mfs(i: MV) -> @location(0) vec4f {
  let p = i.uv; let r = length(p);
  let shape = i32(i.k.x + 0.5);
  var a = 0.0;
  let aa = 0.08;
  if (shape == 0) {
    // tropical cyclone: eye dot, two arms that turn with i.k.y (radians)
    let ang = atan2(p.y, p.x) + i.k.y;
    let arm = abs(sin(ang + 4.0 * log(max(r, 0.05))));
    let arms = (1.0 - smoothstep(0.55, 0.85, arm)) * smoothstep(0.25, 0.4, r) * (1.0 - smoothstep(0.8, 0.98, r));
    let eye = 1.0 - smoothstep(0.16, 0.16 + aa, abs(r - 0.22));
    a = max(arms, eye);
  } else if (shape == 1) {
    // fire: a diamond
    let dd = abs(p.x) + abs(p.y);
    a = 1.0 - smoothstep(0.62, 0.62 + aa, dd);
  } else if (shape == 3) {
    a = 1.0 - smoothstep(0.0, aa, sdTri(p * 1.15));
  } else if (shape == 5) {
    // deep low: ring
    a = 1.0 - smoothstep(0.08, 0.08 + aa, abs(r - 0.6));
  } else {
    a = 1.0 - smoothstep(0.5, 0.5 + aa, r);
  }
  // selection ring
  a = max(a, i.k.z * (1.0 - smoothstep(0.05, 0.05 + aa, abs(r - 0.92))));
  let al = a * i.col.a * FR.look2.w;
  return vec4f(i.col.rgb * al, al);
}
