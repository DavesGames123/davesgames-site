// sdf.wgsl — the parametric objects of the wind tunnel, as signed distance
// functions. The solver, the 2D view and the 3D view prepend this file to
// their own source. Each of them declares the uniform `SH: ShapeU`.
//
// Frames. The world frame is the lattice: one unit is one cell, x points
// downstream, y points up, z is the span. The local frame is the object
// frame: one unit is the reference length of the object (shapes.js names it).
//     local = R^-1 (world - origin - k * spacing * x) / scale
// R is yaw about y, then pitch about z. Copy k of the object sits k * spacing
// cells downstream of copy 0. A distance in the local frame times scale is a
// distance in cells, because R keeps lengths.
//
// Every shape function returns vec2f(distance, material id). The distance is
// a bound, not always exact (smooth unions, the NACA profile), so a ray march
// must take steps of less than one distance (see view3d.wgsl).
//
// Material ids (view2d.wgsl and view3d.wgsl color them):
//     0 hide (cow coat)   1 dark (hoof, tyre, tuft)   2 glass   3 horn
//     4 pink (muzzle, udder)   5 paint   6 chrome   7 trailer grey   8 metal
//
// Shape kinds (shapes.js KIND):
//     0 cow  1 car  2 truck  3 airfoil  4 cylinder  5 sphere  6 box  7 plate
//
// grep: struct ShapeU  fn P(  fn sdCow  fn sdCar  fn sdTruck  fn sdAirfoil
//       fn shapeLocal  fn objDist  fn projSolid

struct ShapeU {
  inv0: vec4f,        // world -> local rotation, row 0 (w unused)
  inv1: vec4f,        // row 1
  inv2: vec4f,        // row 2
  origin: vec4f,      // xyz: copy 0 origin in cells; w: scale, cells per local unit
  p: array<vec4f, 4>, // 16 shape parameters, slot order from shapes.js
  kind: u32,
  copies: u32,        // 1..4
  proj: u32,          // 0: 3D; 1: 2D side view (sweep z); 2: 2D top view (sweep y)
  pad0: u32,
  spacing: f32,       // cells between copies along x
  extent: f32,        // 2D sweep half range in cells
  sweepC: f32,        // 2D sweep center in cells
  pad1: f32,
};

fn P(i: u32) -> f32 { return SH.p[i / 4u][i % 4u]; }

// ------------------------------------------------------------ primitives

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Union of two (distance, id) pairs. The nearer surface gives the id.
fn opU(a: vec2f, b: vec2f) -> vec2f { return select(b, a, a.x < b.x); }

fn sdEllipsoid(p: vec3f, r: vec3f) -> f32 {
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// A capsule whose radius goes from ra at a to rb at b (a bound, not exact).
fn sdTaper(p: vec3f, a: vec3f, b: vec3f, ra: f32, rb: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b + vec3f(r);
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Capped cylinder, axis z, radius r, half length h.
fn sdCylZ(p: vec3f, r: f32, h: f32) -> f32 {
  let d = abs(vec2f(length(p.xy), p.z)) - vec2f(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

// Capped cylinder, axis y, radius r, half height h.
fn sdCylY(p: vec3f, r: f32, h: f32) -> f32 {
  let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

// A 2D profile d2 pulled along z to half width hw, with edge radius r.
fn extrude(d2: f32, z: f32, hw: f32, r: f32) -> f32 {
  let w = vec2f(d2 + r, abs(z) - hw + r);
  return min(max(w.x, w.y), 0.0) + length(max(w, vec2f(0.0))) - r;
}

fn rot2(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(v.x * c - v.y * s, v.x * s + v.y * c);
}

// Signed distance to a closed polygon of n <= 6 points, any winding.
fn sdPoly(p: vec2f, pts: array<vec2f, 6>, n: i32) -> f32 {
  var v = pts;
  var d = dot(p - v[0], p - v[0]);
  var s = 1.0;
  var j = n - 1;
  for (var i = 0; i < n; i++) {
    let e = v[j] - v[i];
    let w = p - v[i];
    let b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    let c = vec3<bool>(p.y >= v[i].y, (p.y < v[j].y), (e.x * w.y > e.y * w.x));
    if (all(c) || !any(c)) { s = -s; }
    j = i;
  }
  return s * sqrt(d);
}

// ------------------------------------------------------------ cow
// Local frame: hooves on y = 0, head toward -x, about one unit nose to tail.
// P0 body length, P1 girth, P2 leg length, P3 head size, P4 head drop (deg),
// P5 horn length, P6 tail length, P7 sphericity (0 cow .. 1 sphere).
fn sdCow(p: vec3f) -> vec2f {
  let bl = P(0u);
  let g = P(1u);
  let ll = P(2u);
  let hs = P(3u);
  let ha = radians(P(4u));
  let hl = P(5u);
  let tl = P(6u);
  let sph = P(7u);
  let yc = ll + g * 0.5;

  // Torso: barrel, hips and chest.
  var d = sdEllipsoid(p - vec3f(0.0, yc, 0.0), vec3f(bl * 0.5, g * 0.5, g * 0.40));
  d = smin(d, sdEllipsoid(p - vec3f(bl * 0.26, yc + g * 0.06, 0.0), vec3f(bl * 0.26, g * 0.48, g * 0.42)), 0.05);
  d = smin(d, sdEllipsoid(p - vec3f(-bl * 0.24, yc + g * 0.02, 0.0), vec3f(bl * 0.28, g * 0.52, g * 0.40)), 0.05);

  // Legs, mirrored in z.
  let q = vec3f(p.x, p.y, abs(p.z));
  let lz = g * 0.22;
  let lr = g * 0.095;
  let legF = sdTaper(q, vec3f(-bl * 0.31, yc - g * 0.05, lz), vec3f(-bl * 0.33, 0.06, lz), lr * 1.25, lr * 0.8);
  let legH = sdTaper(q, vec3f(bl * 0.31, yc, lz), vec3f(bl * 0.36, 0.06, lz), lr * 1.4, lr * 0.8);
  d = smin(d, min(legF, legH), 0.04);

  // Neck and head. The poll (top of the head) swings down with the head drop.
  let nb = vec3f(-bl * 0.40, yc + g * 0.18, 0.0);
  let poll2 = nb.xy + rot2(vec2f(-0.17, 0.07) * hs, ha);
  let poll = vec3f(poll2, 0.0);
  let hd = rot2(normalize(vec2f(-1.0, -0.55)), ha);
  let muz = poll + vec3f(hd, 0.0) * 0.20 * hs;
  d = smin(d, sdTaper(p, nb, poll, g * 0.30, 0.07 * hs), 0.05);
  d = smin(d, sdTaper(p, poll, muz, 0.075 * hs, 0.058 * hs), 0.03);
  let qe = vec3f(p.x, p.y, abs(p.z));
  d = min(d, sdEllipsoid(qe - (poll + vec3f(0.015, -0.005, 0.08) * hs), vec3f(0.028, 0.014, 0.05) * hs));
  var r = vec2f(d, 0.0);

  // Muzzle and udder.
  r = opU(r, vec2f(sdEllipsoid(p - (muz + vec3f(hd, 0.0) * 0.015 * hs), vec3f(0.055, 0.05, 0.058) * hs), 4.0));
  r = opU(r, vec2f(sdEllipsoid(p - vec3f(bl * 0.22, ll + g * 0.10, 0.0), vec3f(0.07, 0.06, 0.06) * (g / 0.32)), 4.0));

  // Horns, curving out and up.
  if (hl > 0.004) {
    let h0 = poll + vec3f(0.0, 0.03, 0.045) * hs;
    let h1 = poll + vec3f(-0.01, 0.03 + hl * 0.6, 0.05 + hl) * hs;
    r = opU(r, vec2f(sdTaper(qe, h0, h1, 0.017 * hs, 0.006 * hs), 3.0));
  }

  // Hooves.
  let hoofF = sdCylY(q - vec3f(-bl * 0.33, 0.035, lz), lr * 0.95, 0.035);
  let hoofH = sdCylY(q - vec3f(bl * 0.36, 0.035, lz), lr * 0.95, 0.035);
  r = opU(r, vec2f(min(hoofF, hoofH), 1.0));

  // Tail and its tuft.
  if (tl > 0.01) {
    let t0 = vec3f(bl * 0.49, yc + g * 0.30, 0.0);
    let t1 = vec3f(bl * 0.54, yc + g * 0.30 - tl, 0.0);
    r = opU(r, vec2f(sdCapsule(p, t0, t1, 0.012), 0.0));
    r = opU(r, vec2f(sdEllipsoid(p - t1, vec3f(0.022, 0.04, 0.022)), 1.0));
  }

  // The spherical cow: the same animal, with the approximations applied.
  if (sph > 0.0) {
    let rs = 0.34;
    let ds = length(p - vec3f(0.0, rs + 0.002, 0.0)) - rs;
    r.x = mix(r.x, ds, sph);
  }
  return r;
}

// ------------------------------------------------------------ car
// Local frame: wheels on y = 0, nose at x = -0.5, tail at x = +0.5.
// P0 height, P1 width, P2 hood length, P3 windshield angle (deg),
// P4 roof length, P5 rear window angle (deg), P6 ride height, P7 spoiler,
// P8 wheel radius.
fn sdCar(p0: vec3f) -> vec2f {
  let p = vec3f(p0.x + 0.5, p0.y, p0.z);
  let H = P(0u);
  let W = P(1u);
  let hood = P(2u);
  let rake = radians(P(3u));
  let roof = P(4u);
  let rear = radians(P(5u));
  let clr = P(6u);
  let spl = P(7u);
  let wr = P(8u);
  let yb = clr + (H - clr) * 0.56;
  let gh = H - yb;

  // Lower body, side profile.
  var low = array<vec2f, 6>(
    vec2f(0.0, clr + 0.035),
    vec2f(0.012, yb - 0.035),
    vec2f(0.11, yb),
    vec2f(0.975, yb + 0.012),
    vec2f(1.0, yb - 0.045),
    vec2f(0.975, clr + 0.02));
  let dLow = extrude(sdPoly(p.xy, low, 6), p.z, W * 0.5, 0.04);

  // Greenhouse, side profile.
  let xa = hood;
  let xb = xa + gh / tan(rake);
  let xc = min(xb + roof, 0.96);
  let xd = min(xc + gh / tan(rear), 0.99);
  var cab = array<vec2f, 6>(
    vec2f(xa, yb - 0.02),
    vec2f(xd, yb - 0.02),
    vec2f(xc, H),
    vec2f(xb, H),
    vec2f(0.0), vec2f(0.0));
  let dCab = extrude(sdPoly(p.xy, cab, 4), p.z, W * 0.5 * 0.84, 0.03);

  var d = smin(dLow, dCab, 0.02);

  // Wheel arches.
  let q = vec3f(p.x, p.y, abs(p.z));
  let archF = sdCylZ(p - vec3f(0.18, wr, 0.0), wr + 0.012, W);
  let archR = sdCylZ(p - vec3f(0.80, wr, 0.0), wr + 0.012, W);
  d = max(d, -min(archF, archR));

  let glass = p.y > yb + 0.014 && p.y < H - 0.014 && dCab < dLow + 0.005;
  var r = vec2f(d, select(5.0, 2.0, glass));

  // Tyres and hubs.
  let tz = W * 0.5 - 0.042;
  let tyre = min(sdCylZ(q - vec3f(0.18, wr, tz), wr, 0.032), sdCylZ(q - vec3f(0.80, wr, tz), wr, 0.032)) - 0.004;
  r = opU(r, vec2f(tyre, 1.0));
  let hub = min(sdCylZ(q - vec3f(0.18, wr, tz + 0.004), wr * 0.6, 0.032), sdCylZ(q - vec3f(0.80, wr, tz + 0.004), wr * 0.6, 0.032));
  r = opU(r, vec2f(hub, 6.0));

  // Rear wing on two posts.
  if (spl > 0.004) {
    let deck = yb + 0.014;
    let wing = sdRoundBox(p - vec3f(0.955, deck + spl, 0.0), vec3f(0.032, 0.005, W * 0.46), 0.003);
    let post = sdRoundBox(q - vec3f(0.955, deck + spl * 0.5, W * 0.3), vec3f(0.008, spl * 0.5, 0.006), 0.002);
    r = opU(r, vec2f(min(wing, post), 1.0));
  }
  return r;
}

// ------------------------------------------------------------ truck
// A cab-over tractor and a box trailer, on y = 0, nose at x = -0.5.
// P0 cab-trailer gap, P1 cab height, P2 trailer height, P3 roof deflector
// (0..1), P4 cab edge radius, P5 boat tail, P6 side skirts (0..1).
fn sdTruck(p0: vec3f) -> vec2f {
  let p = vec3f(p0.x + 0.5, p0.y, p0.z);
  let gap = P(0u);
  let cabH = P(1u);
  let trH = P(2u);
  let defl = P(3u);
  let rnd = P(4u);
  let boat = P(5u);
  let skirt = P(6u);
  let hw = 0.08;
  let q = vec3f(p.x, p.y, abs(p.z));

  let cab = sdRoundBox(p - vec3f(0.08, (0.045 + cabH) * 0.5, 0.0), vec3f(0.08, (cabH - 0.045) * 0.5, hw), rnd);
  var r = vec2f(cab, 5.0);

  // Trailer box, then the boat-tail chamfers on its top and sides.
  let x0 = 0.16 + gap;
  var tr = sdRoundBox(p - vec3f((x0 + 1.0) * 0.5, (0.075 + trH) * 0.5, 0.0), vec3f((1.0 - x0) * 0.5, (trH - 0.075) * 0.5, hw), 0.004);
  if (boat > 0.002) {
    let nt = normalize(vec2f(boat, boat * 2.5));
    tr = max(tr, dot(p.xy - vec2f(1.0 - boat * 2.5, trH), nt));
    tr = max(tr, dot(q.xz - vec2f(1.0 - boat * 2.5, hw), normalize(vec2f(boat * 0.5, boat * 2.5))));
  }
  r = opU(r, vec2f(tr, 7.0));

  // Roof deflector: a wedge from the cab roof up to the trailer roof line.
  if (defl > 0.02) {
    let top = cabH + (trH - cabH + 0.004) * defl;
    var w = array<vec2f, 6>(
      vec2f(0.015, cabH - 0.01),
      vec2f(0.158, cabH - 0.01),
      vec2f(0.158, top),
      vec2f(0.13, top),
      vec2f(0.0), vec2f(0.0));
    r = opU(r, vec2f(extrude(sdPoly(p.xy, w, 4), p.z, hw * 0.96, 0.006), 5.0));
  }

  // Side skirts under the trailer.
  if (skirt > 0.5) {
    let sk = sdRoundBox(q - vec3f((x0 + 0.13 + 0.82) * 0.5, 0.05, hw - 0.004), vec3f((0.82 - x0 - 0.13) * 0.5, 0.026, 0.003), 0.001);
    r = opU(r, vec2f(sk, 7.0));
  }

  // Wheels: two cab axles and two trailer axles.
  let wz = hw - 0.02;
  var wd = sdCylZ(q - vec3f(0.035, 0.032, wz), 0.032, 0.018);
  wd = min(wd, sdCylZ(q - vec3f(0.125, 0.032, wz), 0.032, 0.018));
  wd = min(wd, sdCylZ(q - vec3f(0.86, 0.032, wz), 0.032, 0.018));
  wd = min(wd, sdCylZ(q - vec3f(0.93, 0.032, wz), 0.032, 0.018));
  r = opU(r, vec2f(wd, 1.0));
  return r;
}

// ------------------------------------------------------------ airfoil
// NACA 4-digit wing. Chord 1 from x = -0.25 to 0.75, so pitch turns it about
// the quarter chord. P0 camber (% chord), P1 camber position (tenths),
// P2 thickness (% chord), P3 span (chords).
fn naca(x: f32, m: f32, pp: f32, t: f32) -> vec2f {
  let sx = sqrt(max(x, 0.0));
  let yt = 5.0 * t * (0.2969 * sx - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  var yc = 0.0;
  if (m > 0.0) {
    if (x < pp) { yc = m / (pp * pp) * (2.0 * pp * x - x * x); }
    else { yc = m / ((1.0 - pp) * (1.0 - pp)) * ((1.0 - 2.0 * pp) + 2.0 * pp * x - x * x); }
  }
  return vec2f(yc, yt);
}

fn sdAirfoil(p: vec3f) -> vec2f {
  let m = P(0u) * 0.01;
  let pp = clamp(P(1u) * 0.1, 0.1, 0.9);
  let t = P(2u) * 0.01;
  let hz = P(3u) * 0.5;
  let xs = p.x + 0.25;
  let X = clamp(xs, 0.0, 1.0);
  let ct = naca(X, m, pp, t);
  let dy = abs(p.y - ct.x) - ct.y;
  let dx = max(-xs, xs - 1.0);
  var d2 = 0.0;
  if (dx > 0.0) {
    d2 = length(vec2f(dx, max(dy, 0.0)));
  } else {
    // The vertical gap overstates the distance where the surface is steep,
    // so scale it, and bound it near the nose by the leading-edge circle.
    let rle = 1.1019 * t * t;
    d2 = min(dy * 0.7, length(vec2f(xs - rle, p.y)) - rle);
    d2 = select(d2, dy * 0.7, dy < 0.0);
  }
  return vec2f(extrude(d2, p.z, hz, 0.0), 8.0);
}

// ------------------------------------------------------------ dispatcher

fn shapeLocal(p: vec3f) -> vec2f {
  switch (SH.kind) {
    case 0u: { return sdCow(p); }
    case 1u: { return sdCar(p); }
    case 2u: { return sdTruck(p); }
    case 3u: { return sdAirfoil(p); }
    case 4u: { return vec2f(sdCylZ(p, P(0u) * 0.5, P(1u) * 0.5), 5.0); }
    case 5u: { return vec2f(length(p) - P(0u) * 0.5, 5.0); }
    case 6u: {
      let b = vec3f(P(0u), P(1u), P(2u)) * 0.5;
      return vec2f(sdRoundBox(p, b, P(3u) * min(b.x, min(b.y, b.z))), 5.0);
    }
    default: { return vec2f(sdRoundBox(p, vec3f(P(0u), P(1u), P(2u)) * 0.5, P(1u) * 0.45), 8.0); }
  }
}

fn toLocal(q: vec3f) -> vec3f {
  return vec3f(dot(SH.inv0.xyz, q), dot(SH.inv1.xyz, q), dot(SH.inv2.xyz, q)) / SH.origin.w;
}

// Distance in cells from world point w to the nearest copy: (dist, id, copy).
fn objDist(w: vec3f) -> vec3f {
  var best = vec3f(1e9, 0.0, 0.0);
  for (var k = 0u; k < SH.copies; k++) {
    let q = w - SH.origin.xyz - vec3f(f32(k) * SH.spacing, 0.0, 0.0);
    let r = shapeLocal(toLocal(q));
    let d = r.x * SH.origin.w;
    if (d < best.x) { best = vec3f(d, r.y, f32(k)); }
  }
  return best;
}

// 2D silhouette test. Sweeps the hidden axis through the object by sphere
// tracing, so thin parts (legs, posts) are not stepped over. Returns the copy
// index of the first solid hit, or -1 for fluid.
fn projSolid(xy: vec2f) -> i32 {
  var s = SH.sweepC - SH.extent;
  let s1 = SH.sweepC + SH.extent;
  for (var i = 0; i < 160; i++) {
    var w = vec3f(xy, s);
    if (SH.proj == 2u) { w = vec3f(xy.x, s, xy.y); }
    let o = objDist(w);
    if (o.x < 0.0) { return i32(o.z); }
    s += max(o.x * 0.8, 0.35);
    if (s > s1) { break; }
  }
  return -1;
}
