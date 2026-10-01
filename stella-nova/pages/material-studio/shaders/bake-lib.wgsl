// ============================================================================
//  MATERIAL STUDIO  ·  shaders/bake-lib.wgsl — the bake function library
// ────────────────────────────────────────────────────────────────────────────
//  compile.js splits this file into its top-level `fn` and `struct` items and
//  puts into each generated pass only the items that the pass code names,
//  plus their dependencies. Thus a large library costs nothing per pass.
//  Keep each item at top level, and start each item on a new line with
//  `fn ms_` or `struct Ms`. All names start with ms_ / Ms, so node code and
//  bench code do not collide with them.
//
//  CONVENTIONS
//      Every generator takes (uv, per, s): uv in tile space, per = the integer
//      cell count per tile on x and y, s = a f32 seed. The result tiles when
//      uv moves by 1 on x or y. Results are in 0..1 unless the item says other.
//      Integer hashes wrap the cell index modulo per, which makes them periodic.
//
//  CONTENTS  (grep -n the name to jump)
//      hash .......... ms_pcg ms_hu ms_rnd ms_rnd2 ms_rnd3 ms_rnd1 ms_wrap
//      noise ......... ms_vnoise ms_pnoise ms_snoise ms_worley ms_vedge
//      fractal ....... ms_noise ms_fbm ms_ridged ms_billow ms_warp2
//      color ......... ms_srgb2lin ms_lin2srgb ms_lum ms_rgb2hsv ms_hsv2rgb ms_blend
//      geometry ...... ms_rot2 ms_sd_box ms_sd_ngon ms_sd_star ms_shape
//      tiles ......... MsTile ms_bricks ms_hex ms_weave ms_scratches ms_dots
//      normals ....... ms_nenc ms_ndec ms_rnm ms_udn ms_whiteout
//      curves ........ ms_herm
// ============================================================================

// ------------------------------------------------------------ hash
// 32-bit integer permutation (PCG output stage).
fn ms_pcg(v: u32) -> u32 {
  let s = (v * 747796405u) + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn ms_hu(p: vec2i, s: f32) -> u32 {
  return ms_pcg(bitcast<u32>(p.x) ^ ms_pcg(bitcast<u32>(p.y) ^ ms_pcg(bitcast<u32>(s))));
}

fn ms_rnd(p: vec2i, s: f32) -> f32 {
  return f32(ms_hu(p, s) >> 8u) * (1.0 / 16777216.0);
}

fn ms_rnd2(p: vec2i, s: f32) -> vec2f {
  let a = ms_hu(p, s);
  let b = ms_pcg(a);
  return vec2f(f32(a >> 8u), f32(b >> 8u)) * (1.0 / 16777216.0);
}

fn ms_rnd3(p: vec2i, s: f32) -> vec3f {
  let a = ms_hu(p, s);
  let b = ms_pcg(a);
  let c = ms_pcg(b);
  return vec3f(f32(a >> 8u), f32(b >> 8u), f32(c >> 8u)) * (1.0 / 16777216.0);
}

fn ms_rnd1(i: i32, s: f32) -> f32 {
  return ms_rnd(vec2i(i, 23417), s);
}

// Cell index modulo the period, also for negative indices.
fn ms_wrap(i: vec2i, per: vec2i) -> vec2i {
  let q = max(per, vec2i(1));
  return ((i % q) + q) % q;
}

fn ms_fade2(f: vec2f) -> vec2f {
  return f * f * f * ((f * ((f * 6.0) - vec2f(15.0))) + vec2f(10.0));
}

// ------------------------------------------------------------ noise
// Value noise: one random value per lattice point, quintic interpolation.
fn ms_vnoise(uv: vec2f, per: vec2i, s: f32) -> f32 {
  let q = max(per, vec2i(1));
  let p = uv * vec2f(q);
  let i = vec2i(floor(p));
  let w = ms_fade2(p - floor(p));
  let a = ms_rnd(ms_wrap(i, q), s);
  let b = ms_rnd(ms_wrap(i + vec2i(1, 0), q), s);
  let c = ms_rnd(ms_wrap(i + vec2i(0, 1), q), s);
  let d = ms_rnd(ms_wrap(i + vec2i(1, 1), q), s);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn ms_gvec(c: vec2i, s: f32) -> vec2f {
  let a = ms_rnd(c, s) * 6.2831853;
  return vec2f(cos(a), sin(a));
}

// Gradient (Perlin-type) noise with unit gradients, remapped to 0..1.
fn ms_pnoise(uv: vec2f, per: vec2i, s: f32) -> f32 {
  let q = max(per, vec2i(1));
  let p = uv * vec2f(q);
  let i = vec2i(floor(p));
  let f = p - floor(p);
  let w = ms_fade2(f);
  let ga = dot(ms_gvec(ms_wrap(i, q), s), f);
  let gb = dot(ms_gvec(ms_wrap(i + vec2i(1, 0), q), s), f - vec2f(1.0, 0.0));
  let gc = dot(ms_gvec(ms_wrap(i + vec2i(0, 1), q), s), f - vec2f(0.0, 1.0));
  let gd = dot(ms_gvec(ms_wrap(i + vec2i(1, 1), q), s), f - vec2f(1.0, 1.0));
  let n = mix(mix(ga, gb, w.x), mix(gc, gd, w.x), w.y);
  return clamp(0.5 + (n * 0.7071), 0.0, 1.0);
}

// Simplex-type noise on a triangle lattice with basis (1,0) and (0.5,1).
// Lattice point (i,j) sits at (i + 0.5 j, j). The y period is made even, so
// a shift of one period maps the lattice onto itself. Each texel sums radial
// kernels from the four corners of its lattice cell. The kernel radius
// (sqrt 0.78) is less than the distance (0.894) from any triangle to a
// lattice point that is not one of its corners, so the sum is continuous.
fn ms_snoise(uv: vec2f, per: vec2i, s: f32) -> f32 {
  let px = max(per.x, 1);
  let py = max(2 * ((per.y + 1) / 2), 2);
  let p = uv * vec2f(f32(px), f32(py));
  let l = vec2f(p.x - (0.5 * p.y), p.y);
  let li = vec2i(floor(l));
  let m = 2 * px;
  var n = 0.0;
  for (var k = 0; k < 4; k++) {
    let c = li + vec2i(k & 1, k >> 1u);
    let cp = vec2f(f32(c.x) + (0.5 * f32(c.y)), f32(c.y));
    let d = p - cp;
    let t = max(0.78 - dot(d, d), 0.0);
    let kx = (2 * c.x) + c.y;
    let key = vec2i(((kx % m) + m) % m, ((c.y % py) + py) % py);
    let t2 = t * t;
    n += (t2 * t2) * dot(ms_gvec(key, s), d);
  }
  return clamp(0.5 + (n * 5.0), 0.0, 1.0);
}

// Cellular noise. Returns (F1, F2, random of the nearest cell, second random
// of the nearest cell). Distances are in cell units.
fn ms_worley(uv: vec2f, per: vec2i, jit: f32, s: f32) -> vec4f {
  let q = max(per, vec2i(1));
  let p = uv * vec2f(q);
  let i = vec2i(floor(p));
  let f = p - floor(p);
  var f1 = 8.0;
  var f2 = 8.0;
  var id = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2i(x, y);
      let c = ms_wrap(i + o, q);
      let r = (vec2f(o) + vec2f(0.5) + ((ms_rnd2(c, s) - vec2f(0.5)) * jit)) - f;
      let d = dot(r, r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = ms_rnd2(c, s + 7.0);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec4f(sqrt(f1), sqrt(f2), id.x, id.y);
}

// Distance to the nearest Voronoi cell border (true bisector distance), in
// cell units. Returns (edge distance, random of the cell, F1, 0).
fn ms_vedge(uv: vec2f, per: vec2i, jit: f32, s: f32) -> vec4f {
  let q = max(per, vec2i(1));
  let p = uv * vec2f(q);
  let i = vec2i(floor(p));
  let f = p - floor(p);
  var mr = vec2f(0.0);
  var mo = vec2i(0);
  var md = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2i(x, y);
      let r = (vec2f(o) + vec2f(0.5) + ((ms_rnd2(ms_wrap(i + o, q), s) - vec2f(0.5)) * jit)) - f;
      let d = dot(r, r);
      if (d < md) { md = d; mr = r; mo = o; }
    }
  }
  var ed = 8.0;
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let o = mo + vec2i(x, y);
      let r = (vec2f(o) + vec2f(0.5) + ((ms_rnd2(ms_wrap(i + o, q), s) - vec2f(0.5)) * jit)) - f;
      let dv = r - mr;
      if (dot(dv, dv) > 0.00001) {
        ed = min(ed, dot(0.5 * (mr + r), normalize(dv)));
      }
    }
  }
  return vec4f(ed, ms_rnd(ms_wrap(i + mo, q), s + 7.0), sqrt(md), 0.0);
}

// ------------------------------------------------------------ fractal
// Base noise by kind: 0 value, 1 gradient, 2 simplex, 3 cellular (1 - F1).
fn ms_noise(kind: i32, uv: vec2f, per: vec2i, s: f32) -> f32 {
  switch kind {
    case 0: { return ms_vnoise(uv, per, s); }
    case 2: { return ms_snoise(uv, per, s); }
    case 3: { return 1.0 - clamp(ms_worley(uv, per, 1.0, s).x, 0.0, 1.0); }
    default: { return ms_pnoise(uv, per, s); }
  }
}

// Fractal sum. The period grows by `lac` (an integer) per octave, so every
// octave tiles. Result is centered on 0.5.
fn ms_fbm(kind: i32, uv: vec2f, per: vec2i, oct: i32, lac: i32, gain: f32, s: f32) -> f32 {
  var amp = 0.5;
  var sum = 0.0;
  var pp = max(per, vec2i(1));
  let n = clamp(oct, 1, 12);
  let l = clamp(lac, 1, 4);
  for (var o = 0; o < n; o++) {
    sum += amp * (ms_noise(kind, uv, pp, s + (f32(o) * 13.17)) - 0.5);
    amp *= gain;
    pp = min(pp * l, vec2i(1048576));
  }
  return 0.5 + sum;
}

// Ridged multifractal: sharp crests where the base noise crosses 0.5.
fn ms_ridged(kind: i32, uv: vec2f, per: vec2i, oct: i32, lac: i32, gain: f32, s: f32) -> f32 {
  var amp = 0.5;
  var sum = 0.0;
  var w = 1.0;
  var pp = max(per, vec2i(1));
  let n = clamp(oct, 1, 12);
  let l = clamp(lac, 1, 4);
  for (var o = 0; o < n; o++) {
    var r = 1.0 - abs((ms_noise(kind, uv, pp, s + (f32(o) * 13.17)) * 2.0) - 1.0);
    r = r * r * w;
    w = clamp(r * 2.0, 0.0, 1.0);
    sum += r * amp;
    amp *= gain;
    pp = min(pp * l, vec2i(1048576));
  }
  return clamp(sum * 1.25, 0.0, 1.0);
}

// Billow: the sum of |2n - 1|, puffy round shapes.
fn ms_billow(kind: i32, uv: vec2f, per: vec2i, oct: i32, lac: i32, gain: f32, s: f32) -> f32 {
  var amp = 0.5;
  var sum = 0.0;
  var pp = max(per, vec2i(1));
  let n = clamp(oct, 1, 12);
  let l = clamp(lac, 1, 4);
  for (var o = 0; o < n; o++) {
    sum += amp * abs((ms_noise(kind, uv, pp, s + (f32(o) * 13.17)) * 2.0) - 1.0);
    amp *= gain;
    pp = min(pp * l, vec2i(1048576));
  }
  return clamp(sum * 1.4, 0.0, 1.0);
}

// A periodic 2D offset field from two fbm calls, values in -0.5..0.5.
fn ms_warp2(uv: vec2f, per: vec2i, oct: i32, s: f32) -> vec2f {
  return vec2f(ms_fbm(1, uv, per, oct, 2, 0.5, s), ms_fbm(1, uv, per, oct, 2, 0.5, s + 31.7)) - vec2f(0.5);
}

// ------------------------------------------------------------ color
fn ms_srgb2lin(c: vec3f) -> vec3f {
  return select(pow((max(c, vec3f(0.0)) + vec3f(0.055)) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn ms_lin2srgb(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return select((1.055 * pow(x, vec3f(1.0 / 2.4))) - vec3f(0.055), x * 12.92, x <= vec3f(0.0031308));
}

fn ms_lum(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn ms_rgb2hsv(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let d = mx - mn;
  var h = 0.0;
  if (d > 0.000001) {
    if (mx == c.r) {
      h = (c.g - c.b) / d;
    } else if (mx == c.g) {
      h = 2.0 + ((c.b - c.r) / d);
    } else {
      h = 4.0 + ((c.r - c.g) / d);
    }
    h = fract(h / 6.0);
  }
  return vec3f(h, select(0.0, d / mx, mx > 0.000001), mx);
}

fn ms_hsv2rgb(c: vec3f) -> vec3f {
  let k = ((vec3f(fract(c.x) * 6.0) + vec3f(0.0, 4.0, 2.0)) % vec3f(6.0));
  let rgb = clamp(abs(k - vec3f(3.0)) - vec3f(1.0), vec3f(0.0), vec3f(1.0));
  return c.z * mix(vec3f(1.0), rgb, clamp(c.y, 0.0, 1.0));
}

// Blend `b` over the base `a`. Modes: 0 normal, 1 add, 2 subtract,
// 3 multiply, 4 screen, 5 overlay, 6 soft light, 7 hard light, 8 darken,
// 9 lighten, 10 difference, 11 exclusion, 12 color dodge, 13 color burn,
// 14 linear light, 15 divide, 16 hue, 17 saturation, 18 color, 19 luminosity.
fn ms_blend(mode: i32, a: vec3f, b: vec3f) -> vec3f {
  let one = vec3f(1.0);
  switch mode {
    case 1: { return a + b; }
    case 2: { return a - b; }
    case 3: { return a * b; }
    case 4: { return one - ((one - a) * (one - b)); }
    case 5: { return select(one - (2.0 * (one - a) * (one - b)), 2.0 * a * b, a < vec3f(0.5)); }
    case 6: { return ((one - (2.0 * b)) * a * a) + (2.0 * b * a); }
    case 7: { return select(one - (2.0 * (one - a) * (one - b)), 2.0 * a * b, b < vec3f(0.5)); }
    case 8: { return min(a, b); }
    case 9: { return max(a, b); }
    case 10: { return abs(a - b); }
    case 11: { return (a + b) - (2.0 * a * b); }
    case 12: { return clamp(a / max(one - b, vec3f(0.0001)), vec3f(0.0), vec3f(1.0)); }
    case 13: { return clamp(one - ((one - a) / max(b, vec3f(0.0001))), vec3f(0.0), vec3f(1.0)); }
    case 14: { return (a + (2.0 * b)) - one; }
    case 15: { return a / max(b, vec3f(0.0001)); }
    case 16: { let x = ms_rgb2hsv(a); let y = ms_rgb2hsv(b); return ms_hsv2rgb(vec3f(y.x, x.y, x.z)); }
    case 17: { let x = ms_rgb2hsv(a); let y = ms_rgb2hsv(b); return ms_hsv2rgb(vec3f(x.x, y.y, x.z)); }
    case 18: { let x = ms_rgb2hsv(a); let y = ms_rgb2hsv(b); return ms_hsv2rgb(vec3f(y.x, y.y, x.z)); }
    case 19: { let x = ms_rgb2hsv(a); let y = ms_rgb2hsv(b); return ms_hsv2rgb(vec3f(x.x, x.y, y.z)); }
    default: { return b; }
  }
}

// ------------------------------------------------------------ geometry
fn ms_rot2(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f((c * v.x) - (s * v.y), (s * v.x) + (c * v.y));
}

fn ms_sd_box(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

// Regular polygon with n sides and circumradius r.
fn ms_sd_ngon(p: vec2f, r: f32, n: f32) -> f32 {
  let an = 3.14159265 / max(n, 3.0);
  let a = atan2(p.y, p.x) + 1.5707963;
  let bn = 2.0 * an;
  let a2 = (((a % bn) + bn) % bn) - an;
  return (length(p) * cos(a2)) - (r * cos(an));
}

// Star with n points, outer radius r, inner radius r * inner.
fn ms_sd_star(p: vec2f, r: f32, n: f32, inner: f32) -> f32 {
  let an = 3.14159265 / max(n, 2.0);
  let a = atan2(p.y, p.x) + 1.5707963;
  let bn = 2.0 * an;
  let a2 = (((a % bn) + bn) % bn) - an;
  let q = length(p) * vec2f(cos(a2), abs(sin(a2)));
  let ta = vec2f(r, 0.0);
  let tb = (r * inner) * vec2f(cos(an), sin(an));
  let e = tb - ta;
  let w = q - ta;
  let h = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
  let dist = length(w - (e * h));
  let cr = (e.x * w.y) - (e.y * w.x);
  return select(dist, -dist, cr > 0.0);
}

// Shape kinds: 0 disc, 1 square, 2 polygon, 3 star, 4 ring, 5 cross,
// 6 rounded square, 7 diamond. p is in -1..1, size is the radius.
fn ms_shape(kind: i32, p: vec2f, size: f32, sides: f32, inner: f32) -> f32 {
  switch kind {
    case 1: { return ms_sd_box(p, vec2f(size)); }
    case 2: { return ms_sd_ngon(p, size, sides); }
    case 3: { return ms_sd_star(p, size, sides, inner); }
    case 4: { return abs(length(p) - size) - (size * (1.0 - inner) * 0.5); }
    case 5: { return min(ms_sd_box(p, vec2f(size, size * inner * 0.5)), ms_sd_box(p, vec2f(size * inner * 0.5, size))); }
    case 6: { return ms_sd_box(p, vec2f(size * (1.0 - (inner * 0.5)))) - (size * inner * 0.5); }
    case 7: { return (abs(p.x) + abs(p.y) - size) * 0.70710678; }
    default: { return length(p) - size; }
  }
}

// ------------------------------------------------------------ tiles
// h: bevelled height 0..1, mask: 1 inside a tile, rnd: random per tile,
// luv: uv inside the tile 0..1, cell: integer tile index (wrapped).
struct MsTile {
  h: f32,
  mask: f32,
  rnd: f32,
  luv: vec2f,
  cell: vec2f,
}

// Running-bond bricks. shift is the per-row offset in brick widths
// (0.5 = half bond); rshift adds a random offset per row (planks).
// gap and bevel are in tile uv units.
fn ms_bricks(uv: vec2f, cols: i32, rows: i32, shift: f32, rshift: f32, gap: f32, bevel: f32, s: f32) -> MsTile {
  let nc = max(cols, 1);
  let nr = max(rows, 1);
  let q0 = uv * vec2f(f32(nc), f32(nr));
  let row = i32(floor(q0.y));
  let rw = ((row % nr) + nr) % nr;
  let off = (shift * f32(rw)) + (rshift * ms_rnd1(rw, s + 3.0));
  let q = vec2f(q0.x + off, q0.y);
  let fq = q - floor(q);
  let cell = ms_wrap(vec2i(floor(q)), vec2i(nc, nr));
  let dx = min(fq.x, 1.0 - fq.x) / f32(nc);
  let dy = min(fq.y, 1.0 - fq.y) / f32(nr);
  let d = min(dx, dy) - (gap * 0.5);
  var t: MsTile;
  t.mask = select(0.0, 1.0, d > 0.0);
  t.h = clamp(d / max(bevel, 0.00001), 0.0, 1.0) * t.mask;
  t.rnd = ms_rnd(cell, s);
  t.luv = fq;
  t.cell = vec2f(cell);
  return t;
}

// Hexagon tiles. n hexagons across; the row count is rounded so that the
// pattern tiles (a slight stretch on y).
fn ms_hex(uv: vec2f, n: i32, gap: f32, bevel: f32, s: f32) -> MsTile {
  let nx = max(n, 1);
  let ny = max(i32(round(f32(nx) / 1.7320508)), 1);
  let r = vec2f(1.0, 1.7320508);
  let p = uv * vec2f(f32(nx), f32(ny) * 1.7320508);
  let ca = floor(p / r);
  let cb = floor((p - (r * 0.5)) / r);
  let a = (p - (ca * r)) - (r * 0.5);
  let b = (p - (cb * r)) - r;
  let useA = dot(a, a) < dot(b, b);
  let g = select(b, a, useA);
  let key = select(vec2i(cb) * 2 + vec2i(1), vec2i(ca) * 2, useA);
  let cell = ms_wrap(key, vec2i(2 * nx, 2 * ny));
  let ag = abs(g);
  let hd = 0.5 - max(dot(ag, vec2f(0.5, 0.8660254)), ag.x);
  let d = (hd / f32(nx)) - (gap * 0.5);
  var t: MsTile;
  t.mask = select(0.0, 1.0, d > 0.0);
  t.h = clamp(d / max(bevel, 0.00001), 0.0, 1.0) * t.mask;
  t.rnd = ms_rnd(cell, s);
  t.luv = (g / r) + vec2f(0.5);
  t.cell = vec2f(cell);
  return t;
}

// Plain weave: n threads per tile on each axis. h is the thread height,
// mask is 1 where the warp (vertical thread) is on top.
fn ms_weave(uv: vec2f, n: i32, width: f32, s: f32) -> MsTile {
  let nn = max(n, 1);
  let p = uv * f32(nn);
  let c = vec2i(floor(p));
  let f = p - floor(p);
  let warpTop = ((c.x + c.y) & 1) == 0;
  let w = clamp(width, 0.05, 1.0);
  let px = abs(f.x - 0.5) * 2.0;
  let py = abs(f.y - 0.5) * 2.0;
  let inX = select(0.0, sqrt(max(1.0 - ((px / w) * (px / w)), 0.0)), px < w);
  let inY = select(0.0, sqrt(max(1.0 - ((py / w) * (py / w)), 0.0)), py < w);
  let bendV = 0.6 + (0.4 * sin(f.y * 3.14159265));
  let bendU = 0.6 + (0.4 * sin(f.x * 3.14159265));
  let hv = inX * bendV;
  let hu = inY * bendU;
  var t: MsTile;
  if (warpTop) {
    t.h = max(hv, hu * 0.55);
    t.mask = select(0.0, 1.0, hv >= (hu * 0.55));
  } else {
    t.h = max(hu, hv * 0.55);
    t.mask = select(1.0, 0.0, hu >= (hv * 0.55));
  }
  let cell = ms_wrap(c, vec2i(nn));
  t.rnd = ms_rnd(cell, s);
  t.luv = f;
  t.cell = vec2f(cell);
  return t;
}

// Scratches: `count` random line segments per cell of an n x n grid.
// Returns the brightest scratch value (0..1) at uv.
fn ms_scratches(uv: vec2f, n: i32, count: i32, len: f32, width: f32, angle: f32, spread: f32, s: f32) -> f32 {
  let q = vec2i(max(n, 1));
  let p = uv * vec2f(q);
  let i = vec2i(floor(p));
  let f = p - floor(p);
  var v = 0.0;
  let k = clamp(count, 1, 16);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2i(x, y);
      let c = ms_wrap(i + o, q);
      for (var j = 0; j < k; j++) {
        let r = ms_rnd3(c + vec2i(j * 7919, j * 104729), s);
        let r2 = ms_rnd2(c + vec2i(j * 31, j * 17), s + 5.0);
        let center = vec2f(o) + r.xy;
        let a = angle + ((r.z - 0.5) * spread * 6.2831853);
        let dir = vec2f(cos(a), sin(a));
        let hl = len * (0.4 + (0.6 * r2.x)) * 0.5;
        let w = f - center;
        let t = clamp(dot(w, dir), -hl, hl);
        let d = length(w - (dir * t));
        let fade = 1.0 - smoothstep(0.6 * hl, hl, abs(t));
        let line = (1.0 - smoothstep(0.0, width, d)) * fade * (0.35 + (0.65 * r2.y));
        v = max(v, line);
      }
    }
  }
  return v;
}

// Halftone dots on an n x n grid; every second row shifts by half a cell
// when `stagger` is on (n must be even for that to tile).
fn ms_dots(uv: vec2f, n: i32, radius: f32, soft: f32, stagger: f32) -> f32 {
  let nn = max(n, 1);
  let p = uv * f32(nn);
  let row = floor(p.y);
  let off = select(0.0, 0.5, (stagger > 0.5) && ((i32(row) & 1) == 1));
  let f = fract(vec2f(p.x + off, p.y)) - vec2f(0.5);
  let d = length(f) - (radius * 0.5);
  return 1.0 - smoothstep(-max(soft, 0.0001) * 0.5, max(soft, 0.0001) * 0.5, d);
}

// ------------------------------------------------------------ normals
fn ms_nenc(n: vec3f) -> vec3f { return (normalize(n) * 0.5) + vec3f(0.5); }
fn ms_ndec(c: vec3f) -> vec3f { return normalize((c * 2.0) - vec3f(1.0)); }

// Reoriented normal mapping: rotate the detail normal d onto the base n.
fn ms_rnm(n: vec3f, d: vec3f) -> vec3f {
  let t = n + vec3f(0.0, 0.0, 1.0);
  let u = d * vec3f(-1.0, -1.0, 1.0);
  return normalize(((t * dot(t, u)) / max(t.z, 0.0001)) - u);
}

fn ms_udn(n: vec3f, d: vec3f) -> vec3f { return normalize(vec3f(n.xy + d.xy, n.z)); }
fn ms_whiteout(n: vec3f, d: vec3f) -> vec3f { return normalize(vec3f(n.xy + d.xy, n.z * d.z)); }

// ------------------------------------------------------------ curves
// Cubic Hermite between curve points a and b, stored as (x, y, tangent, 0).
fn ms_herm(a: vec4f, b: vec4f, x: f32) -> f32 {
  let h = max(b.x - a.x, 0.00001);
  let t = clamp((x - a.x) / h, 0.0, 1.0);
  let t2 = t * t;
  let t3 = t2 * t;
  return ((((2.0 * t3) - (3.0 * t2)) + 1.0) * a.y) + (((t3 - (2.0 * t2)) + t) * h * a.z)
    + (((-2.0 * t3) + (3.0 * t2)) * b.y) + ((t3 - t2) * h * b.z);
}
