// ============================================================================
//  FRACTAL FLAMES  ·  flame.wgsl — the chaos game on the GPU
// ----------------------------------------------------------------------------
//  A port of flam3 by Scott Draves and the flam3 authors,
//  https://github.com/scottdraves/flam3 (flam3 is Copyright (C) 1992-2009
//  Spotworks LLC). This file ports variations.c (the variations and
//  apply_xform), flam3.c (flam3_iterate) and the bucket splat of rect.c.
//
//  SPDX-License-Identifier: GPL-3.0-or-later
//  This program is free software: you can redistribute it and/or modify it
//  under the terms of the GNU General Public License as published by the
//  Free Software Foundation, either version 3 of the License, or (at your
//  option) any later version. It is distributed WITHOUT ANY WARRANTY. See
//  the file LICENSE in this directory.
//
//  Each invocation is one walker: a point (x, y, colour) that keeps its
//  place between frames. A walker runs u.iters steps per dispatch. Each
//  step picks an xform from the weight table (or the xaos row of the last
//  xform), applies it, applies the final xform, and adds the palette colour
//  to the u32 histogram (fixed point, u.scale per hit: r, g, b, count).
//  After a reset a walker discards u.fuse steps (the flam3 fuse).
//  Entry points: iterate (the chaos game), decay (scale the histogram down,
//  used while the genome moves).
//
//  grep -n targets
//    layout constants ..... "const OFF_"   (genome.js has the same values)
//    parameter indices .... "const P_"     (genome.js PARAM_DEFS order)
//    one variation ........ "fn v13_julia" (each is "fn v<id>_<name>")
//    dispatcher ........... "fn variation"
//    apply_xform .......... "fn applyXf"
//    chaos game ........... "fn iterate"
// ============================================================================

const OFF_C: u32 = 0u;
const OFF_POST: u32 = 6u;
const OFF_COLOR: u32 = 12u;
const OFF_CSPEED: u32 = 13u;
const OFF_VIS: u32 = 14u;
const OFF_HASPOST: u32 = 15u;
const OFF_NV: u32 = 16u;
const OFF_PREBLUR: u32 = 17u;
const OFF_VARS: u32 = 20u;
const OFF_PARAMS: u32 = 52u;
const XF_BLOCK: u32 = 192u;

const P_blob_low = 0u; const P_blob_high = 1u; const P_blob_waves = 2u;
const P_pdj_a = 3u; const P_pdj_b = 4u; const P_pdj_c = 5u; const P_pdj_d = 6u;
const P_fan2_x = 7u; const P_fan2_y = 8u;
const P_rings2_val = 9u;
const P_perspective_angle = 10u; const P_perspective_dist = 11u;
const P_julian_power = 12u; const P_julian_dist = 13u;
const P_juliascope_power = 14u; const P_juliascope_dist = 15u;
const P_radial_blur_angle = 16u;
const P_pie_slices = 17u; const P_pie_rotation = 18u; const P_pie_thickness = 19u;
const P_ngon_sides = 20u; const P_ngon_power = 21u; const P_ngon_circle = 22u; const P_ngon_corners = 23u;
const P_curl_c1 = 24u; const P_curl_c2 = 25u;
const P_rectangles_x = 26u; const P_rectangles_y = 27u;
const P_disc2_rot = 28u; const P_disc2_twist = 29u;
const P_super_shape_rnd = 30u; const P_super_shape_m = 31u; const P_super_shape_n1 = 32u;
const P_super_shape_n2 = 33u; const P_super_shape_n3 = 34u; const P_super_shape_holes = 35u;
const P_flower_petals = 36u; const P_flower_holes = 37u;
const P_conic_eccentricity = 38u; const P_conic_holes = 39u;
const P_parabola_height = 40u; const P_parabola_width = 41u;
const P_bent2_x = 42u; const P_bent2_y = 43u;
const P_bipolar_shift = 44u;
const P_cell_size = 45u;
const P_cpow_r = 46u; const P_cpow_i = 47u; const P_cpow_power = 48u;
const P_curve_xamp = 49u; const P_curve_yamp = 50u; const P_curve_xlength = 51u; const P_curve_ylength = 52u;
const P_escher_beta = 53u;
const P_lazysusan_spin = 54u; const P_lazysusan_space = 55u; const P_lazysusan_twist = 56u;
const P_lazysusan_x = 57u; const P_lazysusan_y = 58u;
const P_modulus_x = 59u; const P_modulus_y = 60u;
const P_oscilloscope_separation = 61u; const P_oscilloscope_frequency = 62u;
const P_oscilloscope_amplitude = 63u; const P_oscilloscope_damping = 64u;
const P_popcorn2_x = 65u; const P_popcorn2_y = 66u; const P_popcorn2_c = 67u;
const P_separation_x = 68u; const P_separation_xinside = 69u;
const P_separation_y = 70u; const P_separation_yinside = 71u;
const P_split_xsize = 72u; const P_split_ysize = 73u;
const P_splits_x = 74u; const P_splits_y = 75u;
const P_stripes_space = 76u; const P_stripes_warp = 77u;
const P_wedge_angle = 78u; const P_wedge_hole = 79u; const P_wedge_count = 80u; const P_wedge_swirl = 81u;
const P_wedge_julia_angle = 82u; const P_wedge_julia_count = 83u;
const P_wedge_julia_power = 84u; const P_wedge_julia_dist = 85u;
const P_wedge_sph_angle = 86u; const P_wedge_sph_count = 87u;
const P_wedge_sph_hole = 88u; const P_wedge_sph_swirl = 89u;
const P_whorl_inside = 90u; const P_whorl_outside = 91u;
const P_waves2_freqx = 92u; const P_waves2_scalex = 93u; const P_waves2_freqy = 94u; const P_waves2_scaley = 95u;
const P_auger_sym = 96u; const P_auger_weight = 97u; const P_auger_freq = 98u; const P_auger_scale = 99u;
const P_flux_spread = 100u;
const P_mobius_re_a = 101u; const P_mobius_im_a = 102u; const P_mobius_re_b = 103u; const P_mobius_im_b = 104u;
const P_mobius_re_c = 105u; const P_mobius_im_c = 106u; const P_mobius_re_d = 107u; const P_mobius_im_d = 108u;
const P_persp_vsin = 109u; const P_persp_vfcos = 110u;
const P_julian_rN = 111u; const P_julian_cn = 112u;
const P_juliascope_rN = 113u; const P_juliascope_cn = 114u;
const P_radialBlur_spinvar = 115u; const P_radialBlur_zoomvar = 116u;
const P_waves_dx2 = 117u; const P_waves_dy2 = 118u;
const P_disc2_sinadd = 119u; const P_disc2_cosadd = 120u; const P_disc2_timespi = 121u;
const P_super_shape_pm_4 = 122u; const P_super_shape_pneg1_n1 = 123u;
const P_wedgeJulia_cf = 124u; const P_wedgeJulia_rN = 125u; const P_wedgeJulia_cn = 126u;

const PI: f32 = 3.14159265358979;
const M_1_PI: f32 = 0.318309886183791;
const M_PI_2: f32 = 1.5707963267949;
const M_PI_4: f32 = 0.785398163397448;
const M_2_PI: f32 = 0.636619772367581;
const EPS: f32 = 1e-10;

struct U {
  nStd: u32, finalIdx: i32, chaosOn: u32, iters: u32,
  seed: u32, reinit: u32, fuse: u32, W: u32,
  H: u32, scale: f32, finalOpacity: f32, decay: f32,
  r00: f32, r01: f32, r10: f32, r11: f32,
  c0: f32, c1: f32, ox: f32, oy: f32,
  ppu: f32, nWalkers: u32, grain: u32, total: u32,
}
struct Walker { x: f32, y: f32, c: f32, lastxf: u32, rng: u32, fuse: u32, pad0: u32, pad1: u32 }

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> xf: array<f32>;
@group(0) @binding(2) var<storage, read> dist: array<u32>;
@group(0) @binding(3) var<storage, read> pal: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> walkers: array<Walker>;
@group(0) @binding(5) var<storage, read_write> hist: array<atomic<u32>>;

// ── random numbers (PCG hash; flam3 uses ISAAC) ────────────────────────────
var<private> rs: u32;
fn rndu() -> u32 {
  rs = rs * 747796405u + 2891336453u;
  let w = ((rs >> ((rs >> 28u) + 4u)) ^ rs) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rnd() -> f32 { return f32(rndu() >> 8u) * (1.0 / 16777216.0); }
fn hash(x: u32) -> u32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}

// ── helpers ────────────────────────────────────────────────────────────────
// The iteration helper of flam3: the affine image (tx, ty) and the values
// that prepare_precalc_flags computes. at = atan2(tx, ty) (flam3's
// precalc_atan has x first), atyx = atan2(ty, tx). b is the xform block.
struct H { tx: f32, ty: f32, sumsq: f32, sq: f32, at: f32, sina: f32, cosa: f32, atyx: f32, b: u32 }
fn P(h: H, i: u32) -> f32 { return xf[h.b + OFF_PARAMS + i]; }
fn C(h: H, k: u32) -> f32 { return xf[h.b + OFF_C + k]; }
fn bad(x: f32) -> bool {
  let bits = bitcast<u32>(x);
  return ((bits & 0x7f800000u) == 0x7f800000u) || (abs(x) > 1e10);
}
fn fmodc(a: f32, b: f32) -> f32 { return a - b * trunc(a / b); }
fn polar(r: f32, a: f32) -> vec2<f32> { return vec2<f32>(r * cos(a), r * sin(a)); }

// ── the variations (variations.c, var0 .. var98) ───────────────────────────
fn v0_linear(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(h.tx, h.ty); }
fn v1_sinusoidal(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(sin(h.tx), sin(h.ty)); }
fn v2_spherical(h: H, w: f32) -> vec2<f32> {
  let r2 = w / (h.sumsq + EPS);
  return r2 * vec2<f32>(h.tx, h.ty);
}
fn v3_swirl(h: H, w: f32) -> vec2<f32> {
  let c1 = sin(h.sumsq);
  let c2 = cos(h.sumsq);
  return w * vec2<f32>(c1 * h.tx - c2 * h.ty, c2 * h.tx + c1 * h.ty);
}
fn v4_horseshoe(h: H, w: f32) -> vec2<f32> {
  let r = w / (h.sq + EPS);
  return vec2<f32>((h.tx - h.ty) * (h.tx + h.ty) * r, 2.0 * h.tx * h.ty * r);
}
fn v5_polar(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(h.at * M_1_PI, h.sq - 1.0); }
fn v6_handkerchief(h: H, w: f32) -> vec2<f32> {
  return w * h.sq * vec2<f32>(sin(h.at + h.sq), cos(h.at - h.sq));
}
fn v7_heart(h: H, w: f32) -> vec2<f32> {
  let a = h.sq * h.at;
  let r = w * h.sq;
  return vec2<f32>(r * sin(a), -r * cos(a));
}
fn v8_disc(h: H, w: f32) -> vec2<f32> {
  let a = h.at * M_1_PI;
  let r = PI * h.sq;
  return w * a * vec2<f32>(sin(r), cos(r));
}
fn v9_spiral(h: H, w: f32) -> vec2<f32> {
  let r = h.sq + EPS;
  let r1 = w / r;
  return r1 * vec2<f32>(h.cosa + sin(r), h.sina - cos(r));
}
fn v10_hyperbolic(h: H, w: f32) -> vec2<f32> {
  let r = h.sq + EPS;
  return w * vec2<f32>(h.sina / r, h.cosa * r);
}
fn v11_diamond(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(h.sina * cos(h.sq), h.cosa * sin(h.sq)); }
fn v12_ex(h: H, w: f32) -> vec2<f32> {
  let n0 = sin(h.at + h.sq);
  let n1 = cos(h.at - h.sq);
  let m0 = n0 * n0 * n0 * h.sq;
  let m1 = n1 * n1 * n1 * h.sq;
  return w * vec2<f32>(m0 + m1, m0 - m1);
}
fn v13_julia(h: H, w: f32) -> vec2<f32> {
  var a = 0.5 * h.at;
  if (rnd() < 0.5) { a += PI; }
  let r = w * sqrt(h.sq);
  return polar(r, a);
}
fn v14_bent(h: H, w: f32) -> vec2<f32> {
  var nx = h.tx;
  var ny = h.ty;
  if (nx < 0.0) { nx = nx * 2.0; }
  if (ny < 0.0) { ny = ny / 2.0; }
  return w * vec2<f32>(nx, ny);
}
fn v15_waves(h: H, w: f32) -> vec2<f32> {
  return w * vec2<f32>(h.tx + C(h, 2u) * sin(h.ty * P(h, P_waves_dx2)), h.ty + C(h, 3u) * sin(h.tx * P(h, P_waves_dy2)));
}
fn v16_fisheye(h: H, w: f32) -> vec2<f32> {
  let r = 2.0 * w / (h.sq + 1.0);
  return r * vec2<f32>(h.ty, h.tx);
}
fn v17_popcorn(h: H, w: f32) -> vec2<f32> {
  return w * vec2<f32>(h.tx + C(h, 4u) * sin(tan(3.0 * h.ty)), h.ty + C(h, 5u) * sin(tan(3.0 * h.tx)));
}
fn v18_exponential(h: H, w: f32) -> vec2<f32> {
  let dx = w * exp(h.tx - 1.0);
  let dy = PI * h.ty;
  return dx * vec2<f32>(cos(dy), sin(dy));
}
fn v19_power(h: H, w: f32) -> vec2<f32> {
  let r = w * pow(h.sq, h.sina);
  return r * vec2<f32>(h.cosa, h.sina);
}
fn v20_cosine(h: H, w: f32) -> vec2<f32> {
  let a = h.tx * PI;
  return w * vec2<f32>(cos(a) * cosh(h.ty), -sin(a) * sinh(h.ty));
}
fn v21_rings(h: H, w: f32) -> vec2<f32> {
  let dx = C(h, 4u) * C(h, 4u) + EPS;
  let r = w * (fmodc(h.sq + dx, 2.0 * dx) - dx + h.sq * (1.0 - dx));
  return r * vec2<f32>(h.cosa, h.sina);
}
fn v22_fan(h: H, w: f32) -> vec2<f32> {
  let dx = PI * (C(h, 4u) * C(h, 4u) + EPS);
  let dy = C(h, 5u);
  let dx2 = 0.5 * dx;
  var a = h.at;
  if (fmodc(a + dy, dx) > dx2) { a -= dx2; } else { a += dx2; }
  return polar(w * h.sq, a);
}
fn v23_blob(h: H, w: f32) -> vec2<f32> {
  let lo = P(h, P_blob_low);
  let hi = P(h, P_blob_high);
  let r = h.sq * (lo + (hi - lo) * (0.5 + 0.5 * sin(P(h, P_blob_waves) * h.at)));
  return w * r * vec2<f32>(h.sina, h.cosa);
}
fn v24_pdj(h: H, w: f32) -> vec2<f32> {
  return w * vec2<f32>(sin(P(h, P_pdj_a) * h.ty) - cos(P(h, P_pdj_b) * h.tx), sin(P(h, P_pdj_c) * h.tx) - cos(P(h, P_pdj_d) * h.ty));
}
fn v25_fan2(h: H, w: f32) -> vec2<f32> {
  let dy = P(h, P_fan2_y);
  let dx = PI * (P(h, P_fan2_x) * P(h, P_fan2_x) + EPS);
  let dx2 = 0.5 * dx;
  var a = h.at;
  let t = a + dy - dx * trunc((a + dy) / dx);
  if (t > dx2) { a = a - dx2; } else { a = a + dx2; }
  let r = w * h.sq;
  return r * vec2<f32>(sin(a), cos(a));
}
fn v26_rings2(h: H, w: f32) -> vec2<f32> {
  let dx = P(h, P_rings2_val) * P(h, P_rings2_val) + EPS;
  let r = h.sq - 2.0 * dx * trunc((h.sq + dx) / (2.0 * dx)) + h.sq * (1.0 - dx);
  return w * r * vec2<f32>(h.sina, h.cosa);
}
fn v27_eyefish(h: H, w: f32) -> vec2<f32> {
  let r = (w * 2.0) / (h.sq + 1.0);
  return r * vec2<f32>(h.tx, h.ty);
}
fn v28_bubble(h: H, w: f32) -> vec2<f32> {
  let r = w / (0.25 * h.sumsq + 1.0);
  return r * vec2<f32>(h.tx, h.ty);
}
fn v29_cylinder(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(sin(h.tx), h.ty); }
fn v30_perspective(h: H, w: f32) -> vec2<f32> {
  let t = 1.0 / (P(h, P_perspective_dist) - h.ty * P(h, P_persp_vsin));
  return w * vec2<f32>(P(h, P_perspective_dist) * h.tx * t, P(h, P_persp_vfcos) * h.ty * t);
}
fn v31_noise(h: H, w: f32) -> vec2<f32> {
  let a = rnd() * 2.0 * PI;
  let r = w * rnd();
  return vec2<f32>(h.tx * r * cos(a), h.ty * r * sin(a));
}
fn v32_julian(h: H, w: f32) -> vec2<f32> {
  let tr = trunc(P(h, P_julian_rN) * rnd());
  let a = (h.atyx + 2.0 * PI * tr) / P(h, P_julian_power);
  let r = w * pow(h.sumsq, P(h, P_julian_cn));
  return polar(r, a);
}
fn v33_juliascope(h: H, w: f32) -> vec2<f32> {
  let tr = trunc(P(h, P_juliascope_rN) * rnd());
  var a: f32;
  if ((i32(tr) & 1) == 0) { a = (2.0 * PI * tr + h.atyx) / P(h, P_juliascope_power); }
  else { a = (2.0 * PI * tr - h.atyx) / P(h, P_juliascope_power); }
  let r = w * pow(h.sumsq, P(h, P_juliascope_cn));
  return polar(r, a);
}
fn v34_blur(h: H, w: f32) -> vec2<f32> {
  let a = rnd() * 2.0 * PI;
  let r = w * rnd();
  return polar(r, a);
}
fn v35_gaussian_blur(h: H, w: f32) -> vec2<f32> {
  let a = rnd() * 2.0 * PI;
  let r = w * (rnd() + rnd() + rnd() + rnd() - 2.0);
  return polar(r, a);
}
fn v36_radial_blur(h: H, w: f32) -> vec2<f32> {
  let g = w * (rnd() + rnd() + rnd() + rnd() - 2.0);
  let a = h.atyx + P(h, P_radialBlur_spinvar) * g;
  let rz = P(h, P_radialBlur_zoomvar) * g - 1.0;
  return vec2<f32>(h.sq * cos(a) + rz * h.tx, h.sq * sin(a) + rz * h.ty);
}
fn v37_pie(h: H, w: f32) -> vec2<f32> {
  let sl = trunc(rnd() * P(h, P_pie_slices) + 0.5);
  let a = P(h, P_pie_rotation) + 2.0 * PI * (sl + rnd() * P(h, P_pie_thickness)) / P(h, P_pie_slices);
  return polar(w * rnd(), a);
}
fn v38_ngon(h: H, w: f32) -> vec2<f32> {
  let rf = pow(h.sumsq, P(h, P_ngon_power) / 2.0);
  let b = 2.0 * PI / P(h, P_ngon_sides);
  var phi = h.atyx - b * floor(h.atyx / b);
  if (phi > b / 2.0) { phi -= b; }
  var amp = P(h, P_ngon_corners) * (1.0 / (cos(phi) + EPS) - 1.0) + P(h, P_ngon_circle);
  amp /= (rf + EPS);
  return w * amp * vec2<f32>(h.tx, h.ty);
}
fn v39_curl(h: H, w: f32) -> vec2<f32> {
  let c1 = P(h, P_curl_c1);
  let c2 = P(h, P_curl_c2);
  let re = 1.0 + c1 * h.tx + c2 * (h.tx * h.tx - h.ty * h.ty);
  let im = c1 * h.ty + 2.0 * c2 * h.tx * h.ty;
  let r = w / (re * re + im * im);
  return r * vec2<f32>(h.tx * re + h.ty * im, h.ty * re - h.tx * im);
}
fn v40_rectangles(h: H, w: f32) -> vec2<f32> {
  let rx = P(h, P_rectangles_x);
  let ry = P(h, P_rectangles_y);
  var o = w * vec2<f32>(h.tx, h.ty);
  if (rx != 0.0) { o.x = w * ((2.0 * floor(h.tx / rx) + 1.0) * rx - h.tx); }
  if (ry != 0.0) { o.y = w * ((2.0 * floor(h.ty / ry) + 1.0) * ry - h.ty); }
  return o;
}
fn v41_arch(h: H, w: f32) -> vec2<f32> {
  let a = rnd() * w * PI;
  let s = sin(a);
  return w * vec2<f32>(s, (s * s) / cos(a));
}
fn v42_tangent(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(sin(h.tx) / cos(h.ty), tan(h.ty)); }
fn v43_square(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(rnd() - 0.5, rnd() - 0.5); }
fn v44_rays(h: H, w: f32) -> vec2<f32> {
  let a = w * rnd() * PI;
  let r = w / (h.sumsq + EPS);
  let tr = w * tan(a) * r;
  return tr * vec2<f32>(cos(h.tx), sin(h.ty));
}
fn v45_blade(h: H, w: f32) -> vec2<f32> {
  let r = rnd() * w * h.sq;
  return w * h.tx * vec2<f32>(cos(r) + sin(r), cos(r) - sin(r));
}
fn v46_secant2(h: H, w: f32) -> vec2<f32> {
  let cr = cos(w * h.sq);
  let icr = 1.0 / cr;
  if (cr < 0.0) { return vec2<f32>(w * h.tx, w * (icr + 1.0)); }
  return vec2<f32>(w * h.tx, w * (icr - 1.0));
}
fn v47_twintrian(h: H, w: f32) -> vec2<f32> {
  let r = rnd() * w * h.sq;
  let s = sin(r);
  var diff = log(s * s) * 0.434294481903252 + cos(r);
  if (bad(diff)) { diff = -30.0; }
  return w * h.tx * vec2<f32>(diff, diff - s * PI);
}
fn v48_cross(h: H, w: f32) -> vec2<f32> {
  let s = h.tx * h.tx - h.ty * h.ty;
  let r = w * sqrt(1.0 / (s * s + EPS));
  return r * vec2<f32>(h.tx, h.ty);
}
fn v49_disc2(h: H, w: f32) -> vec2<f32> {
  let t = P(h, P_disc2_timespi) * (h.tx + h.ty);
  let r = w * h.at / PI;
  return r * vec2<f32>(sin(t) + P(h, P_disc2_cosadd), cos(t) + P(h, P_disc2_sinadd));
}
fn v50_super_shape(h: H, w: f32) -> vec2<f32> {
  let th = P(h, P_super_shape_pm_4) * h.atyx + M_PI_4;
  let t1 = pow(abs(cos(th)), P(h, P_super_shape_n2));
  let t2 = pow(abs(sin(th)), P(h, P_super_shape_n3));
  let rr = P(h, P_super_shape_rnd);
  let r = w * ((rr * rnd() + (1.0 - rr) * h.sq) - P(h, P_super_shape_holes)) * pow(t1 + t2, P(h, P_super_shape_pneg1_n1)) / h.sq;
  return r * vec2<f32>(h.tx, h.ty);
}
fn v51_flower(h: H, w: f32) -> vec2<f32> {
  let r = w * (rnd() - P(h, P_flower_holes)) * cos(P(h, P_flower_petals) * h.atyx) / h.sq;
  return r * vec2<f32>(h.tx, h.ty);
}
fn v52_conic(h: H, w: f32) -> vec2<f32> {
  let ct = h.tx / h.sq;
  let e = P(h, P_conic_eccentricity);
  let r = w * (rnd() - P(h, P_conic_holes)) * e / (1.0 + e * ct) / h.sq;
  return r * vec2<f32>(h.tx, h.ty);
}
fn v53_parabola(h: H, w: f32) -> vec2<f32> {
  let s = sin(h.sq);
  let c = cos(h.sq);
  return vec2<f32>(P(h, P_parabola_height) * w * s * s * rnd(), P(h, P_parabola_width) * w * c * rnd());
}
fn v54_bent2(h: H, w: f32) -> vec2<f32> {
  var nx = h.tx;
  var ny = h.ty;
  if (nx < 0.0) { nx = nx * P(h, P_bent2_x); }
  if (ny < 0.0) { ny = ny * P(h, P_bent2_y); }
  return w * vec2<f32>(nx, ny);
}
fn v55_bipolar(h: H, w: f32) -> vec2<f32> {
  let t = h.sumsq + 1.0;
  let x2 = 2.0 * h.tx;
  let ps = -M_PI_2 * P(h, P_bipolar_shift);
  var y = 0.5 * atan2(2.0 * h.ty, h.sumsq - 1.0) + ps;
  if (y > M_PI_2) { y = -M_PI_2 + fmodc(y + M_PI_2, PI); }
  else if (y < -M_PI_2) { y = M_PI_2 - fmodc(M_PI_2 - y, PI); }
  return w * vec2<f32>(0.25 * M_2_PI * log((t + x2) / (t - x2)), M_2_PI * y);
}
fn v56_boarders(h: H, w: f32) -> vec2<f32> {
  let rx = round(h.tx);
  let ry = round(h.ty);
  let ox = h.tx - rx;
  let oy = h.ty - ry;
  if (rnd() >= 0.75) { return w * vec2<f32>(ox * 0.5 + rx, oy * 0.5 + ry); }
  if (abs(ox) >= abs(oy)) {
    if (ox >= 0.0) { return w * vec2<f32>(ox * 0.5 + rx + 0.25, oy * 0.5 + ry + 0.25 * oy / ox); }
    return w * vec2<f32>(ox * 0.5 + rx - 0.25, oy * 0.5 + ry - 0.25 * oy / ox);
  }
  if (oy >= 0.0) { return w * vec2<f32>(ox * 0.5 + rx + ox / oy * 0.25, oy * 0.5 + ry + 0.25); }
  return w * vec2<f32>(ox * 0.5 + rx - ox / oy * 0.25, oy * 0.5 + ry - 0.25);
}
fn v57_butterfly(h: H, w: f32) -> vec2<f32> {
  let wx = w * 1.30294003174112;
  let y2 = h.ty * 2.0;
  let r = wx * sqrt(abs(h.ty * h.tx) / (EPS + h.tx * h.tx + y2 * y2));
  return r * vec2<f32>(h.tx, y2);
}
fn v58_cell(h: H, w: f32) -> vec2<f32> {
  let cs = P(h, P_cell_size);
  let inv = 1.0 / cs;
  var X = floor(h.tx * inv);
  var Y = floor(h.ty * inv);
  let dx = h.tx - X * cs;
  let dy = h.ty - Y * cs;
  if (Y >= 0.0) {
    if (X >= 0.0) { Y *= 2.0; X *= 2.0; } else { Y *= 2.0; X = -(2.0 * X + 1.0); }
  } else {
    if (X >= 0.0) { Y = -(2.0 * Y + 1.0); X *= 2.0; } else { Y = -(2.0 * Y + 1.0); X = -(2.0 * X + 1.0); }
  }
  return vec2<f32>(w * (dx + X * cs), -w * (dy + Y * cs));
}
fn v59_cpow(h: H, w: f32) -> vec2<f32> {
  let lnr = 0.5 * log(h.sumsq);
  let pw = P(h, P_cpow_power);
  let va = 2.0 * PI / pw;
  let vc = P(h, P_cpow_r) / pw;
  let vd = P(h, P_cpow_i) / pw;
  let ang = vc * h.atyx + vd * lnr + va * floor(pw * rnd());
  return polar(w * exp(vc * lnr - vd * h.atyx), ang);
}
fn v60_curve(h: H, w: f32) -> vec2<f32> {
  let xl = max(P(h, P_curve_xlength) * P(h, P_curve_xlength), 1e-20);
  let yl = max(P(h, P_curve_ylength) * P(h, P_curve_ylength), 1e-20);
  return w * vec2<f32>(h.tx + P(h, P_curve_xamp) * exp(-h.ty * h.ty / xl), h.ty + P(h, P_curve_yamp) * exp(-h.tx * h.tx / yl));
}
fn v61_edisc(h: H, w: f32) -> vec2<f32> {
  let tmp = h.sumsq + 1.0;
  let tmp2 = 2.0 * h.tx;
  let xmax = (sqrt(tmp + tmp2) + sqrt(tmp - tmp2)) * 0.5;
  let a1 = log(xmax + sqrt(xmax - 1.0));
  let a2 = -acos(h.tx / xmax);
  let ww = w / 11.57034632;
  var snv = sin(a1);
  if (h.ty > 0.0) { snv = -snv; }
  return ww * vec2<f32>(cosh(a2) * cos(a1), sinh(a2) * snv);
}
fn v62_elliptic(h: H, w: f32) -> vec2<f32> {
  let tmp = h.sumsq + 1.0;
  let x2 = 2.0 * h.tx;
  let xmax = 0.5 * (sqrt(tmp + x2) + sqrt(tmp - x2));
  let a = h.tx / xmax;
  let b = sqrt(max(1.0 - a * a, 0.0));
  let ssx = sqrt(max(xmax - 1.0, 0.0));
  let ww = w / M_PI_2;
  var y = ww * log(xmax + ssx);
  if (!(h.ty > 0.0)) { y = -y; }
  return vec2<f32>(ww * atan2(a, b), y);
}
fn v63_escher(h: H, w: f32) -> vec2<f32> {
  let lnr = 0.5 * log(h.sumsq);
  let be = P(h, P_escher_beta);
  let vc = 0.5 * (1.0 + cos(be));
  let vd = 0.5 * sin(be);
  return polar(w * exp(vc * lnr - vd * h.atyx), vc * h.atyx + vd * lnr);
}
fn v64_foci(h: H, w: f32) -> vec2<f32> {
  let ex = exp(h.tx) * 0.5;
  let enx = 0.25 / ex;
  let t = w / (ex + enx - cos(h.ty));
  return t * vec2<f32>(ex - enx, sin(h.ty));
}
fn v65_lazysusan(h: H, w: f32) -> vec2<f32> {
  let lx = P(h, P_lazysusan_x);
  let ly = P(h, P_lazysusan_y);
  let X = h.tx - lx;
  let Y = h.ty + ly;
  let r = sqrt(X * X + Y * Y);
  if (r < w) {
    let a = atan2(Y, X) + P(h, P_lazysusan_spin) + P(h, P_lazysusan_twist) * (w - r);
    return polar(w * r, a) + vec2<f32>(lx, -ly);
  }
  let rr = w * (1.0 + P(h, P_lazysusan_space) / r);
  return vec2<f32>(rr * X + lx, rr * Y - ly);
}
fn v66_loonie(h: H, w: f32) -> vec2<f32> {
  let w2 = w * w;
  if (h.sumsq < w2) {
    let r = w * sqrt(w2 / h.sumsq - 1.0);
    return r * vec2<f32>(h.tx, h.ty);
  }
  return w * vec2<f32>(h.tx, h.ty);
}
fn v68_modulus(h: H, w: f32) -> vec2<f32> {
  let mx = P(h, P_modulus_x);
  let my = P(h, P_modulus_y);
  var o = w * vec2<f32>(h.tx, h.ty);
  if (h.tx > mx) { o.x = w * (-mx + fmodc(h.tx + mx, 2.0 * mx)); }
  else if (h.tx < -mx) { o.x = w * (mx - fmodc(mx - h.tx, 2.0 * mx)); }
  if (h.ty > my) { o.y = w * (-my + fmodc(h.ty + my, 2.0 * my)); }
  else if (h.ty < -my) { o.y = w * (my - fmodc(my - h.ty, 2.0 * my)); }
  return o;
}
fn v69_oscilloscope(h: H, w: f32) -> vec2<f32> {
  let tpf = 2.0 * PI * P(h, P_oscilloscope_frequency);
  let dmp = P(h, P_oscilloscope_damping);
  var t = P(h, P_oscilloscope_amplitude) * cos(tpf * h.tx) + P(h, P_oscilloscope_separation);
  if (dmp != 0.0) { t = P(h, P_oscilloscope_amplitude) * exp(-abs(h.tx) * dmp) * cos(tpf * h.tx) + P(h, P_oscilloscope_separation); }
  if (abs(h.ty) <= t) { return vec2<f32>(w * h.tx, -w * h.ty); }
  return w * vec2<f32>(h.tx, h.ty);
}
fn v70_polar2(h: H, w: f32) -> vec2<f32> {
  let v = w / PI;
  return vec2<f32>(v * h.at, v / 2.0 * log(h.sumsq));
}
fn v71_popcorn2(h: H, w: f32) -> vec2<f32> {
  let c = P(h, P_popcorn2_c);
  return w * vec2<f32>(h.tx + P(h, P_popcorn2_x) * sin(tan(h.ty * c)), h.ty + P(h, P_popcorn2_y) * sin(tan(h.tx * c)));
}
fn v72_scry(h: H, w: f32) -> vec2<f32> {
  let r = 1.0 / (h.sq * (h.sumsq + 1.0 / (w + EPS)));
  return r * vec2<f32>(h.tx, h.ty);
}
fn v73_separation(h: H, w: f32) -> vec2<f32> {
  let sx2 = P(h, P_separation_x) * P(h, P_separation_x);
  let sy2 = P(h, P_separation_y) * P(h, P_separation_y);
  var o: vec2<f32>;
  if (h.tx > 0.0) { o.x = w * (sqrt(h.tx * h.tx + sx2) - h.tx * P(h, P_separation_xinside)); }
  else { o.x = -w * (sqrt(h.tx * h.tx + sx2) + h.tx * P(h, P_separation_xinside)); }
  if (h.ty > 0.0) { o.y = w * (sqrt(h.ty * h.ty + sy2) - h.ty * P(h, P_separation_yinside)); }
  else { o.y = -w * (sqrt(h.ty * h.ty + sy2) + h.ty * P(h, P_separation_yinside)); }
  return o;
}
fn v74_split(h: H, w: f32) -> vec2<f32> {
  var o = w * vec2<f32>(h.tx, h.ty);
  if (cos(h.tx * P(h, P_split_xsize) * PI) < 0.0) { o.y = -o.y; }
  if (cos(h.ty * P(h, P_split_ysize) * PI) < 0.0) { o.x = -o.x; }
  return o;
}
fn v75_splits(h: H, w: f32) -> vec2<f32> {
  var o = vec2<f32>(w * (h.tx - P(h, P_splits_x)), w * (h.ty - P(h, P_splits_y)));
  if (h.tx >= 0.0) { o.x = w * (h.tx + P(h, P_splits_x)); }
  if (h.ty >= 0.0) { o.y = w * (h.ty + P(h, P_splits_y)); }
  return o;
}
fn v76_stripes(h: H, w: f32) -> vec2<f32> {
  let rx = floor(h.tx + 0.5);
  let ox = h.tx - rx;
  return w * vec2<f32>(ox * (1.0 - P(h, P_stripes_space)) + rx, h.ty + ox * ox * P(h, P_stripes_warp));
}
fn v77_wedge(h: H, w: f32) -> vec2<f32> {
  var a = h.atyx + P(h, P_wedge_swirl) * h.sq;
  let c = floor((P(h, P_wedge_count) * a + PI) * M_1_PI * 0.5);
  let cf = 1.0 - P(h, P_wedge_angle) * P(h, P_wedge_count) * M_1_PI * 0.5;
  a = a * cf + c * P(h, P_wedge_angle);
  return polar(w * (h.sq + P(h, P_wedge_hole)), a);
}
fn v78_wedge_julia(h: H, w: f32) -> vec2<f32> {
  let r = w * pow(h.sumsq, P(h, P_wedgeJulia_cn));
  let tr = trunc(P(h, P_wedgeJulia_rN) * rnd());
  var a = (h.atyx + 2.0 * PI * tr) / P(h, P_wedge_julia_power);
  let c = floor((P(h, P_wedge_julia_count) * a + PI) * M_1_PI * 0.5);
  a = a * P(h, P_wedgeJulia_cf) + c * P(h, P_wedge_julia_angle);
  return polar(r, a);
}
fn v79_wedge_sph(h: H, w: f32) -> vec2<f32> {
  let r = 1.0 / (h.sq + EPS);
  var a = h.atyx + P(h, P_wedge_sph_swirl) * r;
  let c = floor((P(h, P_wedge_sph_count) * a + PI) * M_1_PI * 0.5);
  let cf = 1.0 - P(h, P_wedge_sph_angle) * P(h, P_wedge_sph_count) * M_1_PI * 0.5;
  a = a * cf + c * P(h, P_wedge_sph_angle);
  return polar(w * (r + P(h, P_wedge_sph_hole)), a);
}
fn v80_whorl(h: H, w: f32) -> vec2<f32> {
  var a = h.atyx + P(h, P_whorl_outside) / (w - h.sq);
  if (h.sq < w) { a = h.atyx + P(h, P_whorl_inside) / (w - h.sq); }
  return polar(w * h.sq, a);
}
fn v81_waves2(h: H, w: f32) -> vec2<f32> {
  return w * vec2<f32>(h.tx + P(h, P_waves2_scalex) * sin(h.ty * P(h, P_waves2_freqx)), h.ty + P(h, P_waves2_scaley) * sin(h.tx * P(h, P_waves2_freqy)));
}
fn v82_exp(h: H, w: f32) -> vec2<f32> { return polar(w * exp(h.tx), h.ty); }
fn v83_log(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(0.5 * log(h.sumsq), h.atyx); }
fn v84_sin(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(sin(h.tx) * cosh(h.ty), cos(h.tx) * sinh(h.ty)); }
fn v85_cos(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(cos(h.tx) * cosh(h.ty), -sin(h.tx) * sinh(h.ty)); }
fn v86_tan(h: H, w: f32) -> vec2<f32> {
  let d = 1.0 / (cos(2.0 * h.tx) + cosh(2.0 * h.ty));
  return w * d * vec2<f32>(sin(2.0 * h.tx), sinh(2.0 * h.ty));
}
fn v87_sec(h: H, w: f32) -> vec2<f32> {
  let d = 2.0 / (cos(2.0 * h.tx) + cosh(2.0 * h.ty));
  return w * d * vec2<f32>(cos(h.tx) * cosh(h.ty), sin(h.tx) * sinh(h.ty));
}
fn v88_csc(h: H, w: f32) -> vec2<f32> {
  let d = 2.0 / (cosh(2.0 * h.ty) - cos(2.0 * h.tx));
  return w * d * vec2<f32>(sin(h.tx) * cosh(h.ty), -cos(h.tx) * sinh(h.ty));
}
fn v89_cot(h: H, w: f32) -> vec2<f32> {
  let d = 1.0 / (cosh(2.0 * h.ty) - cos(2.0 * h.tx));
  return w * d * vec2<f32>(sin(2.0 * h.tx), -sinh(2.0 * h.ty));
}
fn v90_sinh(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(sinh(h.tx) * cos(h.ty), cosh(h.tx) * sin(h.ty)); }
fn v91_cosh(h: H, w: f32) -> vec2<f32> { return w * vec2<f32>(cosh(h.tx) * cos(h.ty), sinh(h.tx) * sin(h.ty)); }
fn v92_tanh(h: H, w: f32) -> vec2<f32> {
  let d = 1.0 / (cos(2.0 * h.ty) + cosh(2.0 * h.tx));
  return w * d * vec2<f32>(sinh(2.0 * h.tx), sin(2.0 * h.ty));
}
fn v93_sech(h: H, w: f32) -> vec2<f32> {
  let d = 2.0 / (cos(2.0 * h.ty) + cosh(2.0 * h.tx));
  return w * d * vec2<f32>(cos(h.ty) * cosh(h.tx), -sin(h.ty) * sinh(h.tx));
}
fn v94_csch(h: H, w: f32) -> vec2<f32> {
  let d = 2.0 / (cosh(2.0 * h.tx) - cos(2.0 * h.ty));
  return w * d * vec2<f32>(sinh(h.tx) * cos(h.ty), -cosh(h.tx) * sin(h.ty));
}
fn v95_coth(h: H, w: f32) -> vec2<f32> {
  let d = 1.0 / (cosh(2.0 * h.tx) - cos(2.0 * h.ty));
  return w * d * vec2<f32>(sinh(2.0 * h.tx), sin(2.0 * h.ty));
}
fn v96_auger(h: H, w: f32) -> vec2<f32> {
  let fr = P(h, P_auger_freq);
  let aw = P(h, P_auger_weight);
  let sc = P(h, P_auger_scale);
  let s = sin(fr * h.tx);
  let t = sin(fr * h.ty);
  let dy = h.ty + aw * (sc * s / 2.0 + abs(h.ty) * s);
  let dx = h.tx + aw * (sc * t / 2.0 + abs(h.tx) * t);
  return w * vec2<f32>(h.tx + P(h, P_auger_sym) * (dx - h.tx), dy);
}
fn v97_flux(h: H, w: f32) -> vec2<f32> {
  let xpw = h.tx + w;
  let xmw = h.tx - w;
  let avgr = w * (2.0 + P(h, P_flux_spread)) * sqrt(sqrt(h.ty * h.ty + xpw * xpw) / sqrt(h.ty * h.ty + xmw * xmw));
  let avga = (atan2(h.ty, xmw) - atan2(h.ty, xpw)) * 0.5;
  return polar(avgr, avga);
}
fn v98_mobius(h: H, w: f32) -> vec2<f32> {
  let ra = P(h, P_mobius_re_a); let ia = P(h, P_mobius_im_a);
  let rb = P(h, P_mobius_re_b); let ib = P(h, P_mobius_im_b);
  let rc = P(h, P_mobius_re_c); let ic = P(h, P_mobius_im_c);
  let rd = P(h, P_mobius_re_d); let idd = P(h, P_mobius_im_d);
  let reU = ra * h.tx - ia * h.ty + rb;
  let imU = ra * h.ty + ia * h.tx + ib;
  let reV = rc * h.tx - ic * h.ty + rd;
  let imV = rc * h.ty + ic * h.tx + idd;
  let rv = w / (reV * reV + imV * imV);
  return rv * vec2<f32>(reU * reV + imU * imV, imU * reV - reU * imV);
}

fn variation(id: u32, h: H, w: f32) -> vec2<f32> {
  switch id {
    case 0u: { return v0_linear(h, w); }
    case 1u: { return v1_sinusoidal(h, w); }
    case 2u: { return v2_spherical(h, w); }
    case 3u: { return v3_swirl(h, w); }
    case 4u: { return v4_horseshoe(h, w); }
    case 5u: { return v5_polar(h, w); }
    case 6u: { return v6_handkerchief(h, w); }
    case 7u: { return v7_heart(h, w); }
    case 8u: { return v8_disc(h, w); }
    case 9u: { return v9_spiral(h, w); }
    case 10u: { return v10_hyperbolic(h, w); }
    case 11u: { return v11_diamond(h, w); }
    case 12u: { return v12_ex(h, w); }
    case 13u: { return v13_julia(h, w); }
    case 14u: { return v14_bent(h, w); }
    case 15u: { return v15_waves(h, w); }
    case 16u: { return v16_fisheye(h, w); }
    case 17u: { return v17_popcorn(h, w); }
    case 18u: { return v18_exponential(h, w); }
    case 19u: { return v19_power(h, w); }
    case 20u: { return v20_cosine(h, w); }
    case 21u: { return v21_rings(h, w); }
    case 22u: { return v22_fan(h, w); }
    case 23u: { return v23_blob(h, w); }
    case 24u: { return v24_pdj(h, w); }
    case 25u: { return v25_fan2(h, w); }
    case 26u: { return v26_rings2(h, w); }
    case 27u: { return v27_eyefish(h, w); }
    case 28u: { return v28_bubble(h, w); }
    case 29u: { return v29_cylinder(h, w); }
    case 30u: { return v30_perspective(h, w); }
    case 31u: { return v31_noise(h, w); }
    case 32u: { return v32_julian(h, w); }
    case 33u: { return v33_juliascope(h, w); }
    case 34u: { return v34_blur(h, w); }
    case 35u: { return v35_gaussian_blur(h, w); }
    case 36u: { return v36_radial_blur(h, w); }
    case 37u: { return v37_pie(h, w); }
    case 38u: { return v38_ngon(h, w); }
    case 39u: { return v39_curl(h, w); }
    case 40u: { return v40_rectangles(h, w); }
    case 41u: { return v41_arch(h, w); }
    case 42u: { return v42_tangent(h, w); }
    case 43u: { return v43_square(h, w); }
    case 44u: { return v44_rays(h, w); }
    case 45u: { return v45_blade(h, w); }
    case 46u: { return v46_secant2(h, w); }
    case 47u: { return v47_twintrian(h, w); }
    case 48u: { return v48_cross(h, w); }
    case 49u: { return v49_disc2(h, w); }
    case 50u: { return v50_super_shape(h, w); }
    case 51u: { return v51_flower(h, w); }
    case 52u: { return v52_conic(h, w); }
    case 53u: { return v53_parabola(h, w); }
    case 54u: { return v54_bent2(h, w); }
    case 55u: { return v55_bipolar(h, w); }
    case 56u: { return v56_boarders(h, w); }
    case 57u: { return v57_butterfly(h, w); }
    case 58u: { return v58_cell(h, w); }
    case 59u: { return v59_cpow(h, w); }
    case 60u: { return v60_curve(h, w); }
    case 61u: { return v61_edisc(h, w); }
    case 62u: { return v62_elliptic(h, w); }
    case 63u: { return v63_escher(h, w); }
    case 64u: { return v64_foci(h, w); }
    case 65u: { return v65_lazysusan(h, w); }
    case 66u: { return v66_loonie(h, w); }
    case 68u: { return v68_modulus(h, w); }
    case 69u: { return v69_oscilloscope(h, w); }
    case 70u: { return v70_polar2(h, w); }
    case 71u: { return v71_popcorn2(h, w); }
    case 72u: { return v72_scry(h, w); }
    case 73u: { return v73_separation(h, w); }
    case 74u: { return v74_split(h, w); }
    case 75u: { return v75_splits(h, w); }
    case 76u: { return v76_stripes(h, w); }
    case 77u: { return v77_wedge(h, w); }
    case 78u: { return v78_wedge_julia(h, w); }
    case 79u: { return v79_wedge_sph(h, w); }
    case 80u: { return v80_whorl(h, w); }
    case 81u: { return v81_waves2(h, w); }
    case 82u: { return v82_exp(h, w); }
    case 83u: { return v83_log(h, w); }
    case 84u: { return v84_sin(h, w); }
    case 85u: { return v85_cos(h, w); }
    case 86u: { return v86_tan(h, w); }
    case 87u: { return v87_sec(h, w); }
    case 88u: { return v88_csc(h, w); }
    case 89u: { return v89_cot(h, w); }
    case 90u: { return v90_sinh(h, w); }
    case 91u: { return v91_cosh(h, w); }
    case 92u: { return v92_tanh(h, w); }
    case 93u: { return v93_sech(h, w); }
    case 94u: { return v94_csch(h, w); }
    case 95u: { return v95_coth(h, w); }
    case 96u: { return v96_auger(h, w); }
    case 97u: { return v97_flux(h, w); }
    case 98u: { return v98_mobius(h, w); }
    default: { return vec2<f32>(0.0, 0.0); }
  }
}

// apply_xform: returns (x, y, colour, bad). On a bad value the point is a
// random point in [-1, 1]^2, as in flam3.
fn applyXf(i: u32, p: vec3<f32>) -> vec4<f32> {
  let b = i * XF_BLOCK;
  let s1 = xf[b + OFF_CSPEED];
  let col = s1 * xf[b + OFF_COLOR] + (1.0 - s1) * p.z;
  var tx = xf[b + 0u] * p.x + xf[b + 2u] * p.y + xf[b + 4u];
  var ty = xf[b + 1u] * p.x + xf[b + 3u] * p.y + xf[b + 5u];
  let pb = xf[b + OFF_PREBLUR];
  if (pb != 0.0) {
    let g = pb * (rnd() + rnd() + rnd() + rnd() - 2.0);
    let a = rnd() * 2.0 * PI;
    tx += g * cos(a);
    ty += g * sin(a);
  }
  var h: H;
  h.tx = tx;
  h.ty = ty;
  h.sumsq = tx * tx + ty * ty;
  h.sq = sqrt(h.sumsq);
  h.at = atan2(tx, ty);
  h.sina = tx / h.sq;
  h.cosa = ty / h.sq;
  h.atyx = atan2(ty, tx);
  h.b = b;
  var acc = vec2<f32>(0.0, 0.0);
  let nv = u32(xf[b + OFF_NV]);
  for (var k = 0u; k < nv; k++) {
    acc += variation(u32(xf[b + OFF_VARS + 2u * k]), h, xf[b + OFF_VARS + 2u * k + 1u]);
  }
  var q = acc;
  if (xf[b + OFF_HASPOST] != 0.0) {
    q = vec2<f32>(xf[b + 6u] * acc.x + xf[b + 8u] * acc.y + xf[b + 10u], xf[b + 7u] * acc.x + xf[b + 9u] * acc.y + xf[b + 11u]);
  }
  if (bad(q.x) || bad(q.y)) { return vec4<f32>(rnd() * 2.0 - 1.0, rnd() * 2.0 - 1.0, col, 1.0); }
  return vec4<f32>(q, col, 0.0);
}

// The bucket splat of rect.c: rotate about the camera centre, map to the
// pixel, look up the palette (step mode) and add colour times visibility.
fn splat(o: vec3<f32>, vis: f32) {
  let dx = o.x - u.c0;
  let dy = o.y - u.c1;
  let px = u.ox + u.ppu * (u.r00 * dx + u.r01 * dy);
  let py = u.oy + u.ppu * (u.r10 * dx + u.r11 * dy);
  if (!((px >= 0.0) && (py >= 0.0) && (px < f32(u.W)) && (py < f32(u.H)))) { return; }
  let ci = clamp(i32(o.z * 256.0), 0, 255);
  let col = pal[ci].rgb * (vis * u.scale);
  let k = (u32(py) * u.W + u32(px)) * 4u;
  atomicAdd(&hist[k], u32(col.r + 0.5));
  atomicAdd(&hist[k + 1u], u32(col.g + 0.5));
  atomicAdd(&hist[k + 2u], u32(col.b + 0.5));
  atomicAdd(&hist[k + 3u], u32(vis * u.scale + 0.5));
}

@compute @workgroup_size(64)
fn iterate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let wi = gid.x;
  if (wi >= u.nWalkers) { return; }
  var wk = walkers[wi];
  if (u.reinit != 0u) {
    rs = hash(wi ^ hash(u.seed));
    wk.x = rnd() * 2.0 - 1.0;
    wk.y = rnd() * 2.0 - 1.0;
    wk.c = rnd();
    wk.lastxf = 0u;
    wk.fuse = u.fuse;
  } else {
    rs = wk.rng;
  }
  var p = vec3<f32>(wk.x, wk.y, wk.c);
  var lastxf = wk.lastxf;
  var fuse = wk.fuse;
  for (var it = 0u; it < u.iters; it++) {
    var row = 0u;
    if (u.chaosOn != 0u) { row = lastxf; }
    let fi = dist[row * u.grain + (rndu() & (u.grain - 1u))];
    let q = applyXf(fi, p);
    p = q.xyz;
    if (q.w != 0.0) {
      // flam3 retries a bad value from a random point; here the walker
      // restarts there and discards a few steps.
      fuse = max(fuse, 4u);
      continue;
    }
    lastxf = fi + 1u;
    var o = p;
    if (u.finalIdx >= 0) {
      if ((u.finalOpacity >= 1.0) || (rnd() < u.finalOpacity)) {
        o = applyXf(u32(u.finalIdx), p).xyz;
      }
    }
    if (fuse > 0u) { fuse -= 1u; continue; }
    let vis = xf[fi * XF_BLOCK + OFF_VIS];
    if (vis > 0.0) { splat(o, vis); }
  }
  wk.x = p.x;
  wk.y = p.y;
  wk.c = p.z;
  wk.lastxf = lastxf;
  wk.fuse = fuse;
  wk.rng = rs;
  walkers[wi] = wk;
}

// Scale the histogram by u.decay: the old frames fade while the genome or
// the camera moves (a box-like temporal filter, in place of flam3's
// temporal samples).
@compute @workgroup_size(256)
fn decay(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + gid.y * 65535u * 256u;
  if (i >= u.total) { return; }
  let v = atomicLoad(&hist[i]);
  atomicStore(&hist[i], u32(f32(v) * u.decay));
}
