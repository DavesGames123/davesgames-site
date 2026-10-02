// ============================================================================
//  SDF FORGE  ·  shader.js — the fixed part of the WGSL module
// ----------------------------------------------------------------------------
//  The renderer joins codegen.genWGSL (mapD, mapM, ghostD and the parameter
//  buffer P) with FRAME below into one module. FRAME never changes; only the
//  generated half does.
//
//  ONE PANE, ONE UNIFORM BUFFER. Each pane writes its own camera into its own
//  buffer (Forge decision 15: a shared buffer would draw every pane with the
//  last camera written).
//
//  THE GRID IS ANALYTIC. Each plane is hit by the ray in closed form, and the
//  pixel footprint of the plane coordinates is the analytic derivative of
//  that hit, so no derivative builtin runs after the data-dependent march.
//  Line widths are in PIXELS and the coverage is the exact area a line leaves
//  in a one-pixel box filter, so a line's ink does not pulse as the camera
//  moves (Forge decision 12). Each pane grids its own construction plane; a
//  perspective pane also grids a wall plane the camera faces, scaled by a
//  per-pane gate (decision 17).
//
//  GREP MAP
//    struct U ............. the per-pane uniform block (render.js packPane)
//    fn cover / fn gridPlane   pixel-width lines and one plane of grid
//    fn calcNormal / calcAO / softShadow / env   shading terms (Quilez)
//    fn sceneBnd / shadowClear / sceneSpan   early outs from the scene sphere
//    fn shade ............. clay, lit, normals
//    fn fieldCol .......... the signed field as colour (BANDS and SLICE)
//    fn fs_view ........... the 3D panes        fn fs_slice ... the SLICE pane
//    fn cs_probe .......... (probe module only) mapD at given points
//
//  Sphere tracing after Hart 1996; the tetrahedron normal, ambient occlusion
//  and the soft shadow after Inigo Quilez. The grid kernel follows Forge.
// ============================================================================
export const FRAME = /* wgsl */`
struct U {
  res: vec4f,
  eye: vec4f,
  right: vec4f,
  up: vec4f,
  fwd: vec4f,
  grid: vec4f,
  gate: vec4f,
  sel: vec4f,
  mrch: vec4f,
  sn: vec4f,
  su: vec4f,
  sv: vec4f,
  sx: vec4f,
  scene: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;

const PI: f32 = 3.14159265;
const ACCENT: vec3f = vec3f(0.42, 0.62, 0.89);
const KEY: vec3f = vec3f(0.5403, 0.7663, 0.3477);

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var v = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(v[i], 0.0, 1.0);
}

// ── grid ────────────────────────────────────────────────────────────────────
// The area of a line L px wide, centred dpx px from the pixel centre, inside
// a one-pixel box. It sums to L at every phase.
fn coverPx(dpx: f32, L: f32) -> f32 {
  return clamp(min(dpx + 0.5 * L, 0.5) - max(dpx - 0.5 * L, -0.5), 0.0, 1.0);
}
fn cover(x: f32, s: f32, w: f32, L: f32) -> f32 {
  return coverPx(abs(x - s * round(x / s)) / w, L);
}
fn planeN(k: i32) -> vec3f { return select(select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), k == 1), vec3f(0.0, 1.0, 0.0), k == 0); }
fn planeU(k: i32) -> vec3f { return select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), k == 2); }
fn planeV(k: i32) -> vec3f { return select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), k == 0); }
fn axisCol(a: vec3f) -> vec3f {
  let w = abs(a);
  return vec3f(0.80, 0.25, 0.27) * w.x + vec3f(0.30, 0.70, 0.32) * w.y + vec3f(0.27, 0.45, 0.85) * w.z;
}
struct G { c: vec3f, a: f32, t: f32, w: f32 };
// One plane of grid. ro and d are the ray (d not normalised); dox/doy and
// ddx/ddy are their changes per pixel in x and y.
fn gridPlane(k: i32, ro: vec3f, d: vec3f, dox: vec3f, doy: vec3f, ddx: vec3f, ddy: vec3f, axisPane: bool) -> G {
  var g = G(vec3f(0.0), 0.0, -1.0, 1.0);
  let n = planeN(k); let U0 = planeU(k); let V0 = planeV(k);
  let nd = dot(n, d);
  if (abs(nd) < 1e-7) { return g; }
  let t = -dot(n, ro) / nd;
  if (t <= 0.0) { return g; }
  let p = ro + d * t;
  let ex = dox + ddx * t; let ey = doy + ddy * t;
  let dpx = ex - d * (dot(n, ex) / nd);
  let dpy = ey - d * (dot(n, ey) / nd);
  let a = dot(p, U0); let b = dot(p, V0);
  let wa = max(length(vec2f(dot(dpx, U0), dot(dpy, U0))), 1e-7);
  let wb = max(length(vec2f(dot(dpx, V0), dot(dpy, V0))), 1e-7);
  let wm = max(wa, wb);
  let s0 = pow(10.0, ceil(log2(wm * 9.0) / log2(10.0)));
  let fade = smoothstep(9.0, 40.0, s0 / wm);
  let minor = max(cover(a, s0, wa, 1.0), cover(b, s0, wb, 1.0)) * fade;
  let major = max(cover(a, s0 * 10.0, wa, 1.0), cover(b, s0 * 10.0, wb, 1.0));
  var alpha = max(minor * 0.17, major * 0.34);
  var col = vec3f(0.62, 0.63, 0.68);
  // the two world axes that lie in the plane: the line b = 0 runs along U0
  if (u.grid.z > 0.5) {
    let ax = coverPx(abs(b) / wb, 1.6);
    let bx = coverPx(abs(a) / wa, 1.6);
    var acol = col; var aa = 0.0;
    if (ax > aa) { acol = axisCol(U0); aa = ax; }
    if (bx > aa) { acol = axisCol(V0); aa = bx; }
    col = mix(col, acol, step(0.001, aa));
    alpha = max(alpha, aa * 0.95);
  }
  // the horizon: a plane seen edge-on covers less than a pixel per cell
  let graze = abs(nd) / length(d);
  if (!axisPane) { alpha *= smoothstep(0.012, 0.10, graze); }
  g.c = col; g.a = alpha; g.t = t * length(d); g.w = wm;
  return g;
}

// ── shading terms ───────────────────────────────────────────────────────────
// The tetrahedron normal. The loop keeps mapD from being inlined four times.
fn calcNormal(p: vec3f, h: f32) -> vec3f {
  var n = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    let e = 0.5773 * (2.0 * vec3f(f32(((i + 3) >> 1u) & 1), f32((i >> 1u) & 1), f32(i & 1)) - 1.0);
    n += e * mapD(p + e * h);
  }
  return normalize(n);
}
fn calcAO(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0; var sca = 1.0;
  for (var i = 0; i < 5; i++) {
    let h = 0.02 + 0.12 * f32(i);
    occ += (h - mapD(p + n * h)) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 1.8 * occ, 0.0, 1.0);
}
fn softShadow(ro: vec3f, rd: vec3f, tmax: f32, k: f32) -> f32 {
  var res = 1.0; var t = 0.02; var ph = 1e10;
  for (var i = 0; i < 48; i++) {
    let h = mapD(ro + rd * t) * u.mrch.x;
    let y = h * h / (2.0 * ph);
    let dd = sqrt(max(h * h - y * y, 0.0));
    res = min(res, k * dd / max(1e-4, t - y));
    ph = h;
    t += clamp(h, 0.012, 0.5);
    if (res < 0.002 || t > tmax) { break; }
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}
// THE SCENE BOUNDING SPHERE. u.scene holds a world sphere (centre, radius)
// that holds every visible shape; radius < 0 means none (a plane primitive
// has no bound). sceneBnd is a lower bound of the TRUE distance to the
// scene. mapD can sit below the true distance by the factor u.mrch.w (rho,
// codegen nodeBound: non-uniform scale, the ellipsoid estimate), and the
// shadow march also multiplies mapD by the step factor u.mrch.x. Each test
// below applies those factors, so it decides the same way as the code it
// skips.
fn sceneBnd(p: vec3f) -> f32 {
  if (u.scene.w < 0.0) { return -1e9; }
  return length(p - u.scene.xyz) - u.scene.w;
}
// True when a shadow ray from o along unit d cannot be shaded: the cone
// round the ray, of half-angle atan(1 / k2), misses the sphere for all t >= 0.
// softShadow sees h = mapD * stepK >= stepK * rho * (true distance), so with
// k' = k * stepK * rho every sample keeps k h / t >= 1 and it returns 1.
// k2 = 2 k' is a margin for the improved penumbra term, which can sit below
// k h / t. A cone of k2 <= 1 is never clear.
fn shadowClear(o: vec3f, d: vec3f, k: f32) -> bool {
  if (u.scene.w < 0.0) { return false; }
  let k2 = 2.0 * k * u.mrch.x * u.mrch.w;
  if (k2 <= 1.01) { return false; }
  let w = o - u.scene.xyz;
  let b = dot(d, w);
  let q = sqrt(max(dot(w, w) - b * b, 0.0));
  let s = q / sqrt(k2 * k2 - 1.0);
  var f = length(w) - u.scene.w;
  if (s - b > 0.0) { f = q * sqrt(k2 * k2 - 1.0) / k2 - u.scene.w + b / k2; }
  return f > 0.0;
}
// The part [t0, t1] of a ray (unit d) inside the scene sphere grown by m.
// x > y means the ray misses it, and the march has nothing to find.
fn sceneSpan(o: vec3f, d: vec3f, m: f32) -> vec2f {
  if (u.scene.w < 0.0) { return vec2f(0.0, 1e9); }
  let w = o - u.scene.xyz;
  let r = u.scene.w + m;
  let b = dot(d, w);
  let h = b * b - (dot(w, w) - r * r);
  if (h < 0.0) { return vec2f(1.0, 0.0); }
  let s = sqrt(h);
  return vec2f(max(-b - s, 0.0), -b + s);
}
// A studio: a soft grey dome, a dark floor and one big softbox over the key.
fn env(r: vec3f) -> vec3f {
  var c = mix(vec3f(0.05, 0.05, 0.056), vec3f(0.62, 0.64, 0.7), smoothstep(-0.25, 0.8, r.y));
  c += vec3f(0.25) * exp(-12.0 * abs(r.y - 0.05));
  c += vec3f(2.4) * smoothstep(0.86, 0.97, dot(r, KEY));
  c += vec3f(0.5, 0.55, 0.65) * smoothstep(0.9, 0.99, dot(r, normalize(vec3f(-0.7, 0.3, -0.5)))) ;
  return c;
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
fn toSrgb(c: vec3f) -> vec3f { return pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)); }

fn shade(mode: i32, p: vec3f, rd: vec3f, n: vec3f, s: Sd) -> vec3f {
  let ndv = max(dot(n, -rd), 1e-3);
  if (mode == 2) { return n * 0.5 + 0.5; }
  if (mode == 1) {
    let alb = pow(clamp(s.c, vec3f(0.0), vec3f(1.0)), vec3f(2.2)); let rough = clamp(s.r, 0.04, 1.0); let metal = clamp(s.mt, 0.0, 1.0);
    let ao = calcAO(p, n);
    var sh = 1.0;
    if (u.gate.w > 0.5) { sh = softShadow(p + n * 0.004, KEY, 24.0, 10.0); }
    let ndl = max(dot(n, KEY), 0.0);
    let h = normalize(KEY - rd);
    let ndh = max(dot(n, h), 0.0);
    let a = rough * rough; let a2 = a * a;
    let dd = ndh * ndh * (a2 - 1.0) + 1.0;
    let D = a2 / (PI * dd * dd);
    let vis = 0.5 / max(ndl * (ndv * (1.0 - a) + a) + ndv * (ndl * (1.0 - a) + a), 1e-4);
    let f0 = mix(vec3f(0.04), alb, metal);
    let F = f0 + (1.0 - f0) * pow(1.0 - max(dot(h, -rd), 0.0), 5.0);
    let spec = D * vis * F * ndl * sh * 1.6;
    let sky = 0.55 + 0.45 * n.y;
    let fill = max(dot(n, normalize(vec3f(-0.6, 0.25, -0.5))), 0.0);
    let diff = alb * (1.0 - metal) * (vec3f(1.45, 1.4, 1.32) * ndl * sh + vec3f(0.34, 0.36, 0.42) * sky * ao + vec3f(0.16, 0.18, 0.24) * fill * ao);
    let fe = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0) * (1.0 - rough);
    let refl = env(reflect(rd, n)) * fe * ao * (1.0 - 0.75 * rough);
    return aces(diff + spec + refl);
  }
  // clay: Forge's grey modelling look, with the material showing through
  let base = mix(vec3f(0.70, 0.70, 0.72), s.c, 0.45);
  let w = clamp(dot(n, KEY) * 0.5 + 0.5, 0.0, 1.0);
  var c = base * (0.18 + 0.72 * w * w + 0.12 * n.y);
  c += vec3f(0.06) * pow(1.0 - ndv, 3.0);
  return clamp(c, vec3f(0.0), vec3f(1.0));
}
fn heat(x: f32) -> vec3f {
  let v = clamp(x, 0.0, 1.0);
  let a = mix(vec3f(0.06, 0.07, 0.12), vec3f(0.2, 0.42, 0.85), smoothstep(0.0, 0.4, v));
  let b = mix(a, vec3f(0.95, 0.93, 0.85), smoothstep(0.35, 0.75, v));
  return mix(b, vec3f(1.0, 0.38, 0.22), smoothstep(0.8, 1.0, v));
}
// The signed field as colour: dark steel outside, amber inside, a band per
// 0.25, an iso line per unit and a bright zero line. w is world units per pixel.
fn fieldCol(d: f32, w: f32) -> vec3f {
  var c = select(vec3f(0.50, 0.28, 0.09), vec3f(0.085, 0.15, 0.25), d > 0.0);
  c *= 0.45 + 0.55 * (1.0 - exp(-2.5 * abs(d)));
  c *= 0.84 + 0.16 * cos(25.1327 * d);
  c = mix(c, vec3f(0.55, 0.6, 0.68), cover(d, 1.0, w, 1.0) * 0.5);
  c = mix(c, vec3f(1.0), coverPx(abs(d) / w, 2.0));
  return c;
}

// ── the 3D panes ────────────────────────────────────────────────────────────
@fragment fn fs_view(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let W = u.res.x; let Hh = u.res.y;
  let nx = (2.0 * fc.x - W) / Hh;
  let ny = (Hh - 2.0 * fc.y) / Hh;
  let px = 2.0 / Hh;
  let mode = i32(u.up.w);
  let ortho = u.eye.w > 0.0;
  let R = u.right.xyz; let Up = u.up.xyz; let Fw = u.fwd.xyz;
  var ro = u.eye.xyz; var d = Fw;
  var dox = vec3f(0.0); var doy = vec3f(0.0); var ddx = vec3f(0.0); var ddy = vec3f(0.0);
  if (ortho) {
    ro = u.eye.xyz + (R * nx + Up * ny) * u.eye.w;
    dox = R * u.eye.w * px; doy = -Up * u.eye.w * px;
  } else {
    d = Fw + (R * nx + Up * ny) * u.right.w;
    ddx = R * u.right.w * px; ddy = -Up * u.right.w * px;
  }
  let rd = normalize(d);
  let pixW = select(u.right.w * px / length(d), 0.0, ortho);
  let pixO = select(0.0, u.eye.w * px, ortho);

  // background: Forge's flat dark ground with a slight fall-off
  var col = mix(vec3f(0.098, 0.098, 0.108), vec3f(0.118, 0.118, 0.13), clamp(0.5 + 0.5 * ny, 0.0, 1.0));

  // the march, only where the scene sphere can be hit: a ray that misses
  // the sphere skips the loop, and a ray stops where it leaves the sphere.
  // A ray that hits still starts at 0, so its steps and its hit point are
  // the same as before. The margin covers the hit test (eps grows with t)
  // and a field that sits below the true distance (rho, a step factor < 1).
  let maxSteps = i32(u.fwd.w);
  let k = u.mrch.x;
  let span = sceneSpan(ro, rd, 4.0 * (pixW * u.mrch.y + pixO) / max(u.mrch.w, 1e-3) + 0.05);
  var t = 0.0; var hit = false; var steps = 0;
  let tEnd = select(-1.0, min(u.mrch.y, span.y), span.x <= span.y);
  for (var i = 0; i < 512; i++) {
    if (i >= maxSteps || t > tEnd) { break; }
    let h = mapD(ro + rd * t);
    steps = i + 1;
    let eps = max(2e-4, 0.6 * (pixW * t + pixO));
    if (h < eps) { hit = true; break; }
    t += h * k;
  }
  let tHit = select(1e9, t, hit);
  var surf = vec3f(0.0);
  if (hit) {
    let p = ro + rd * t;
    let n = calcNormal(p, max(1e-4, 0.5 * (pixW * t + pixO)));
    let s = mapM(p);
    surf = shade(mode, p, rd, n, s);
    if (mode == 1) { surf = toSrgb(surf); }
    // selection and hover: a rim in the accent colour
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
    if (s.id >= u.sel.x - 0.5 && s.id <= u.sel.y + 0.5) { surf = mix(surf, ACCENT, 0.06 + 0.5 * rim); }
    else if (abs(s.id - u.sel.z) < 0.5) { surf = mix(surf, ACCENT, 0.35 * rim); }
  }
  if (mode == 3) {
    let f = log(1.0 + f32(steps)) / log(1.0 + f32(maxSteps));
    surf = heat(select(f * 0.85, 1.0, !hit && steps >= maxSteps));
    col = mix(col, heat(f) * 0.9, select(0.0, 1.0, !hit));
  }
  if (hit || mode == 3) { col = surf; }

  // the grids, nearest last
  let pane = i32(u.grid.x);
  if (u.grid.y > 0.5) {
    for (var kk = 0; kk < 3; kk++) {
      let gate = u.gate[kk];
      if (gate <= 0.0) { continue; }
      let g = gridPlane(kk, ro, d, dox, doy, ddx, ddy, ortho && kk == pane);
      if (g.t < 0.0) { continue; }
      if (g.t < tHit) {
        if (mode == 4 && kk == pane) {
          let pp = ro + rd * g.t;
          col = toSrgb(fieldCol(mapD(pp), g.w) * 0.85);
        } else if (mode == 1 && kk == 0 && !ortho) {
          // the ground takes a soft shadow and a contact shade in LIT
          // Most ground pixels see the key light past the scene. The bound
          // tests skip the 48-step shadow march and the contact sample there.
          let pp = ro + rd * g.t;
          let po = pp + vec3f(0.0, 0.003, 0.0);
          var sh = 1.0;
          if (!shadowClear(po, KEY, 8.0)) { sh = softShadow(po, KEY, 20.0, 8.0); }
          var ao = 1.0;
          if (sceneBnd(pp) * u.mrch.w < 1.2) { ao = clamp(0.35 + 0.65 * mapD(pp) / 0.6, 0.0, 1.0); }
          let fall = exp(-0.012 * g.t);
          col = mix(col, col * 0.35, (1.0 - sh * ao) * fall);
        }
        col = mix(col, g.c, g.a * gate);
      } else if (mode == 4 && kk == pane) {
        // BANDS shows the slice through the surface in front of it
        let pp = ro + rd * g.t;
        col = mix(col, toSrgb(fieldCol(mapD(pp), g.w) * 0.85), 0.55);
      }
    }
  }

  // a selected node that a boolean hides: drawn as a ghost through the surface
  let gid = i32(u.sel.w);
  if (gid >= 0 && u.mrch.z > 0.5) {
    var tg = 0.0; var gh = false;
    for (var i = 0; i < 96; i++) {
      let h = ghostD(ro + rd * tg, gid);
      if (h < max(2e-4, 0.6 * (pixW * tg + pixO))) { gh = true; break; }
      tg += h * k;
      if (tg > u.mrch.y) { break; }
    }
    if (gh) {
      let p = ro + rd * tg;
      var n = vec3f(0.0);
      for (var i = 0; i < 4; i++) {
        let e = 0.5773 * (2.0 * vec3f(f32(((i + 3) >> 1u) & 1), f32((i >> 1u) & 1), f32(i & 1)) - 1.0);
        n += e * ghostD(p + e * 1e-3, gid);
      }
      n = normalize(n);
      let edge = pow(1.0 - abs(dot(n, rd)), 1.5);
      let a = select(0.16, 0.34, tg < tHit) + 0.5 * edge;
      col = mix(col, ACCENT, clamp(a, 0.0, 0.85));
    }
  }
  return vec4f(col, 1.0);
}

// ── the SLICE pane ──────────────────────────────────────────────────────────
@fragment fn fs_slice(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let W = u.res.x; let Hh = u.res.y;
  let nx = (2.0 * fc.x - W) / Hh;
  let ny = (Hh - 2.0 * fc.y) / Hh;
  let ext = u.sx.x;
  let a = u.su.w + nx * ext;
  let b = u.sv.w + ny * ext;
  let p = u.sn.xyz * u.sn.w + u.su.xyz * a + u.sv.xyz * b;
  let w = 2.0 * ext / Hh;
  var col = fieldCol(mapD(p), w);
  let s0 = pow(10.0, ceil(log2(w * 9.0) / log2(10.0)));
  let fade = smoothstep(9.0, 40.0, s0 / w);
  let g = max(max(cover(a, s0, w, 1.0), cover(b, s0, w, 1.0)) * fade * 0.10, max(cover(a, s0 * 10.0, w, 1.0), cover(b, s0 * 10.0, w, 1.0)) * 0.22);
  col = mix(col, vec3f(0.9), g);
  col = mix(col, axisCol(u.su.xyz), coverPx(abs(b) / w, 1.6) * 0.9);
  col = mix(col, axisCol(u.sv.xyz), coverPx(abs(a) / w, 1.6) * 0.9);
  return vec4f(toSrgb(col), 1.0);
}
`;

// A compute entry for the tests: mapD at a list of points, read back.
export const PROBE = /* wgsl */`
@group(0) @binding(2) var<storage, read> pts: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outv: array<f32>;
@compute @workgroup_size(64) fn cs_probe(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  outv[i] = mapD(pts[i].xyz);
}
`;
