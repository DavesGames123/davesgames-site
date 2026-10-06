// ============================================================================
//  FRACTAL FLAMES  ·  render.wgsl — density estimation and the tone map
// ----------------------------------------------------------------------------
//  A port of flam3 by Scott Draves and the flam3 authors,
//  https://github.com/scottdraves/flam3 (flam3 is Copyright (C) 1992-2009
//  Spotworks LLC). This file ports rect.c (de_thread, the log-density scale
//  k1 * log(1 + n k2) / n, the spatial filter and the final tone map) and
//  palettes.c (flam3_calc_alpha, flam3_calc_newrgb, rgb2hsv, hsv2rgb).
//
//  SPDX-License-Identifier: GPL-3.0-or-later
//  This program is free software: you can redistribute it and/or modify it
//  under the terms of the GNU General Public License as published by the
//  Free Software Foundation, either version 3 of the License, or (at your
//  option) any later version. It is distributed WITHOUT ANY WARRANTY. See
//  the file LICENSE in this directory.
//
//  de (compute): flam3 spreads each bucket over a gaussian disc whose
//  radius falls as the hit count rises (variable-width density
//  estimation). That is a scatter. This pass does the same sum as a
//  gather: each pixel adds every neighbour whose disc reaches it, with the
//  neighbour's own kernel. An 8x8 workgroup loads a tile with an apron of
//  RMAX pixels into workgroup memory. With d.deOn 0 a pixel only takes its
//  own log-scaled value (flam3 with estimator_radius 0).
//  vs / fs (render): the gaussian spatial filter (filter radius, 1-D
//  weights in v.w), then flam3's gamma, gamma threshold, vibrancy,
//  highlight power and background.
//
//  grep -n targets: "fn de", "fn calcNewRgb", "fn fs"
// ============================================================================

const RMAX: i32 = 9;
const TS: u32 = 8u;
const TILE: u32 = 26u;          // TS + 2 * RMAX
const TILE_N: u32 = 676u;       // TILE * TILE

struct D {
  W: u32, H: u32, R: i32, maxIdx: u32,
  k1: f32, k2: f32, invScale: f32, curve: f32,
  maxCounts: f32, deOn: u32, pad0: u32, pad1: u32,
}
@group(0) @binding(0) var<uniform> d: D;
@group(0) @binding(1) var<storage, read> histR: array<u32>;
@group(0) @binding(2) var<storage, read> tab: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> accum: array<vec4<f32>>;

var<workgroup> tc: array<vec4<f32>, 676>;
var<workgroup> th: array<vec2<f32>, 676>;

// The filter index of flam3's de_thread for a bucket with f hits.
fn filterIndex(f: f32) -> u32 {
  var idx: u32;
  if (f > d.maxCounts) { idx = d.maxIdx; }
  else if (f <= 100.0) { idx = u32(max(ceil(f) - 1.0, 0.0)); }
  else { idx = 100u + u32(floor(pow(f - 100.0, d.curve))); }
  return min(idx, d.maxIdx);
}

@compute @workgroup_size(8, 8)
fn de(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>,
      @builtin(local_invocation_index) li: u32) {
  let x0 = i32(wg.x * TS) - RMAX;
  let y0 = i32(wg.y * TS) - RMAX;
  for (var t = li; t < TILE_N; t += 64u) {
    let gx = x0 + i32(t % TILE);
    let gy = y0 + i32(t / TILE);
    var c = vec4<f32>(0.0);
    var hw = vec2<f32>(0.0);
    if ((gx >= 0) && (gy >= 0) && (gx < i32(d.W)) && (gy < i32(d.H))) {
      let k = (u32(gy) * d.W + u32(gx)) * 4u;
      let n = f32(histR[k + 3u]) * d.invScale;
      if (n > 0.0) {
        let ls = d.k1 * log(1.0 + n * d.k2) / n;
        c = vec4<f32>(f32(histR[k]) * d.invScale, f32(histR[k + 1u]) * d.invScale, f32(histR[k + 2u]) * d.invScale, n) * ls;
        hw = tab[filterIndex(n)];
      }
    }
    tc[t] = c;
    th[t] = hw;
  }
  workgroupBarrier();
  let px = wg.x * TS + lid.x;
  let py = wg.y * TS + lid.y;
  if ((px >= d.W) || (py >= d.H)) { return; }
  let cx = i32(lid.x) + RMAX;
  let cy = i32(lid.y) + RMAX;
  var acc = vec4<f32>(0.0);
  if (d.deOn == 0u) {
    acc = tc[u32(cy) * TILE + u32(cx)];
  } else {
    for (var oy = -d.R; oy <= d.R; oy++) {
      for (var ox = -d.R; ox <= d.R; ox++) {
        let ti = u32(cy + oy) * TILE + u32(cx + ox);
        let hw = th[ti];
        if (hw.x <= 0.0) { continue; }
        // flam3 visits offsets up to ceil(width) - 1 and drops d / width > 1.
        if (f32(max(abs(ox), abs(oy))) > ceil(hw.x) - 1.0) { continue; }
        let q = sqrt(f32(ox * ox + oy * oy)) / hw.x;
        if (q > 1.0) { continue; }
        acc += tc[ti] * (exp(-4.5 * q * q) * hw.y);
      }
    }
  }
  accum[py * d.W + px] = acc;
}

// ── display ────────────────────────────────────────────────────────────────
struct V {
  W: u32, H: u32, fw: u32, pad0: u32,
  gam: f32, lin: f32, vib: f32, hp: f32,
  bg: vec4<f32>,
  w0: vec4<f32>,
  w1: vec4<f32>,
}
@group(0) @binding(0) var<uniform> v: V;
@group(0) @binding(1) var<storage, read> acc: array<vec4<f32>>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let del = mx - mn;
  var s = 0.0;
  if (mx != 0.0) { s = del / mx; }
  var h = 0.0;
  if (s != 0.0) {
    let rc = (mx - c.r) / del;
    let gc = (mx - c.g) / del;
    let bc = (mx - c.b) / del;
    if (c.r == mx) { h = bc - gc; } else if (c.g == mx) { h = 2.0 + rc - bc; } else { h = 4.0 + gc - rc; }
    if (h < 0.0) { h += 6.0; }
  }
  return vec3<f32>(h, s, mx);
}
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  var h = c.x - 6.0 * floor(c.x / 6.0);
  let j = i32(floor(h));
  let f = h - f32(j);
  let p = c.z * (1.0 - c.y);
  let q = c.z * (1.0 - c.y * f);
  let t = c.z * (1.0 - c.y * (1.0 - f));
  switch j {
    case 1: { return vec3<f32>(q, c.z, p); }
    case 2: { return vec3<f32>(p, c.z, t); }
    case 3: { return vec3<f32>(p, q, c.z); }
    case 4: { return vec3<f32>(t, p, c.z); }
    case 5: { return vec3<f32>(c.z, p, q); }
    default: { return vec3<f32>(c.z, t, p); }
  }
}
fn calcAlpha(den: f32, g: f32, lin: f32) -> f32 {
  if (den <= 0.0) { return 0.0; }
  if (den < lin) {
    let fr = den / lin;
    return (1.0 - fr) * den * (pow(lin, g) / lin) + fr * pow(den, g);
  }
  return pow(den, g);
}
// flam3_calc_newrgb: c in accumulator units (PREFILTER_WHITE 255).
fn calcNewRgb(c: vec3<f32>, ls: f32, hp: f32) -> vec3<f32> {
  if ((ls == 0.0) || ((c.r == 0.0) && (c.g == 0.0) && (c.b == 0.0))) { return vec3<f32>(0.0); }
  var maxa = -1.0;
  var maxc = 0.0;
  for (var i = 0; i < 3; i++) {
    let a = ls * (c[i] / 255.0);
    if (a > maxa) { maxa = a; maxc = c[i] / 255.0; }
  }
  let newls = 255.0 / maxc;
  if ((maxa > 255.0) && (hp >= 0.0)) {
    let lsratio = pow(newls / ls, hp);
    var hsv = rgb2hsv(newls * (c / 255.0) / 255.0);
    hsv.y *= lsratio;
    return hsv2rgb(hsv) * 255.0;
  }
  var adj = min(-hp, 1.0);
  if (maxa <= 255.0) { adj = 1.0; }
  return ((1.0 - adj) * newls + adj * ls) * (c / 255.0);
}

fn wgt(i: u32) -> f32 {
  if (i < 4u) { return v.w0[i]; }
  return v.w1[i - 4u];
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let x = i32(pos.x);
  let y = i32(pos.y);
  let hf = i32(v.fw / 2u);
  var t = vec4<f32>(0.0);
  for (var j = 0u; j < v.fw; j++) {
    let yy = y + i32(j) - hf;
    if ((yy < 0) || (yy >= i32(v.H))) { continue; }
    for (var i = 0u; i < v.fw; i++) {
      let xx = x + i32(i) - hf;
      if ((xx < 0) || (xx >= i32(v.W))) { continue; }
      t += acc[u32(yy) * v.W + u32(xx)] * (wgt(i) * wgt(j));
    }
  }
  var alpha = 0.0;
  var ls = 0.0;
  if (t.w > 0.0) {
    let tmp = t.w / 255.0;
    alpha = calcAlpha(tmp, v.gam, v.lin);
    ls = v.vib * 256.0 * alpha / tmp;
    alpha = clamp(alpha, 0.0, 1.0);
  }
  var o = calcNewRgb(t.rgb, ls, v.hp);
  o += (1.0 - v.vib) * 256.0 * pow(max(t.rgb, vec3<f32>(1e-20)) / 255.0, vec3<f32>(v.gam));
  o += (1.0 - alpha) * v.bg.rgb * 256.0;
  return vec4<f32>(clamp(o, vec3<f32>(0.0), vec3<f32>(255.0)) / 255.0, 1.0);
}
