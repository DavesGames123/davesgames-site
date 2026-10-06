// ============================================================================
//  FRACTAL FLAMES  ·  genome.js — the flam3 genome and the genome operators
// ----------------------------------------------------------------------------
//  A port of flam3 by Scott Draves and the flam3 authors,
//  https://github.com/scottdraves/flam3 (flam3 is Copyright (C) 1992-2009
//  Spotworks LLC). This file ports flam3.h (the genome), flam3.c
//  (flam3_random, flam3_add_symmetry, flam3_mutate, flam3_cross,
//  flam3_print, flam3_create_xform_distrib), interpolation.c (flam3_align,
//  flam3_interpolate_n, the log-polar affine blend), parser.c (the XML
//  reader) and palettes.c (palette lookup, hue rotation, rgb2hsv, hsv2rgb).
//
//  SPDX-License-Identifier: GPL-3.0-or-later
//  This program is free software: you can redistribute it and/or modify it
//  under the terms of the GNU General Public License as published by the
//  Free Software Foundation, either version 3 of the License, or (at your
//  option) any later version. This program is distributed WITHOUT ANY
//  WARRANTY. See the file LICENSE in this directory.
//
//  A genome is a plain object (see "function newGenome"). xforms holds all
//  xforms. The final xform, when there is one, is the last entry and
//  finalIndex points to it, as in flam3. chaos is null (all ones) or one row
//  per standard xform. No DOM, so node tests can import this module.
//
//  grep -n targets
//    variation names ...... "export const VAR_NAMES"
//    parameter table ...... "export const PARAM_DEFS"
//    GPU block layout ..... "export const XF_BLOCK"
//    seeded random ........ "export class Rng"
//    palettes ............. "export function getPalette"
//    random genome ........ "export function flam3Random"
//    symmetry ............. "export function addSymmetry"
//    mutate / cross ....... "export function mutate"  "export function cross"
//    align + interpolate .. "export function align"  "export function interpolate"
//    xform choice table ... "export function xformDistrib"
//    pack for the GPU ..... "export function packGenome"
//    XML out / in ......... "export function toXML"  "export function parseXML"
// ============================================================================

export const VAR_NAMES = [
  'linear', 'sinusoidal', 'spherical', 'swirl', 'horseshoe', 'polar', 'handkerchief', 'heart', 'disc', 'spiral',
  'hyperbolic', 'diamond', 'ex', 'julia', 'bent', 'waves', 'fisheye', 'popcorn', 'exponential', 'power',
  'cosine', 'rings', 'fan', 'blob', 'pdj', 'fan2', 'rings2', 'eyefish', 'bubble', 'cylinder',
  'perspective', 'noise', 'julian', 'juliascope', 'blur', 'gaussian_blur', 'radial_blur', 'pie', 'ngon', 'curl',
  'rectangles', 'arch', 'tangent', 'square', 'rays', 'blade', 'secant2', 'twintrian', 'cross', 'disc2',
  'super_shape', 'flower', 'conic', 'parabola', 'bent2', 'bipolar', 'boarders', 'butterfly', 'cell', 'cpow',
  'curve', 'edisc', 'elliptic', 'escher', 'foci', 'lazysusan', 'loonie', 'pre_blur', 'modulus', 'oscilloscope',
  'polar2', 'popcorn2', 'scry', 'separation', 'split', 'splits', 'stripes', 'wedge', 'wedge_julia', 'wedge_sph',
  'whorl', 'waves2', 'exp', 'log', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth', 'auger', 'flux', 'mobius',
];
export const NVARS = VAR_NAMES.length;   // 99, flam3_nvariations
export const VAR = Object.fromEntries(VAR_NAMES.map((n, i) => [n, i]));

// The parameters of the parametric variations: [XML name, default (from
// initialize_xforms in variations.c), variation]. The order is the index in
// the GPU block, and flame.wgsl has one "const P_<name>" for each. tests.mjs
// checks that the two lists agree.
export const PARAM_DEFS = [
  ['blob_low', 0, 'blob'], ['blob_high', 1, 'blob'], ['blob_waves', 1, 'blob'],
  ['pdj_a', 0, 'pdj'], ['pdj_b', 0, 'pdj'], ['pdj_c', 0, 'pdj'], ['pdj_d', 0, 'pdj'],
  ['fan2_x', 0, 'fan2'], ['fan2_y', 0, 'fan2'],
  ['rings2_val', 0, 'rings2'],
  ['perspective_angle', 0, 'perspective'], ['perspective_dist', 0, 'perspective'],
  ['julian_power', 1, 'julian'], ['julian_dist', 1, 'julian'],
  ['juliascope_power', 1, 'juliascope'], ['juliascope_dist', 1, 'juliascope'],
  ['radial_blur_angle', 0, 'radial_blur'],
  ['pie_slices', 6, 'pie'], ['pie_rotation', 0, 'pie'], ['pie_thickness', 0.5, 'pie'],
  ['ngon_sides', 5, 'ngon'], ['ngon_power', 3, 'ngon'], ['ngon_circle', 1, 'ngon'], ['ngon_corners', 2, 'ngon'],
  ['curl_c1', 1, 'curl'], ['curl_c2', 0, 'curl'],
  ['rectangles_x', 1, 'rectangles'], ['rectangles_y', 1, 'rectangles'],
  ['disc2_rot', 0, 'disc2'], ['disc2_twist', 0, 'disc2'],
  ['super_shape_rnd', 0, 'super_shape'], ['super_shape_m', 0, 'super_shape'], ['super_shape_n1', 1, 'super_shape'],
  ['super_shape_n2', 1, 'super_shape'], ['super_shape_n3', 1, 'super_shape'], ['super_shape_holes', 0, 'super_shape'],
  ['flower_petals', 0, 'flower'], ['flower_holes', 0, 'flower'],
  ['conic_eccentricity', 1, 'conic'], ['conic_holes', 0, 'conic'],
  ['parabola_height', 0, 'parabola'], ['parabola_width', 0, 'parabola'],
  ['bent2_x', 1, 'bent2'], ['bent2_y', 1, 'bent2'],
  ['bipolar_shift', 0, 'bipolar'],
  ['cell_size', 1, 'cell'],
  ['cpow_r', 1, 'cpow'], ['cpow_i', 0, 'cpow'], ['cpow_power', 1, 'cpow'],
  ['curve_xamp', 0, 'curve'], ['curve_yamp', 0, 'curve'], ['curve_xlength', 1, 'curve'], ['curve_ylength', 1, 'curve'],
  ['escher_beta', 0, 'escher'],
  ['lazysusan_spin', 0, 'lazysusan'], ['lazysusan_space', 0, 'lazysusan'], ['lazysusan_twist', 0, 'lazysusan'],
  ['lazysusan_x', 0, 'lazysusan'], ['lazysusan_y', 0, 'lazysusan'],
  ['modulus_x', 0, 'modulus'], ['modulus_y', 0, 'modulus'],
  ['oscilloscope_separation', 1, 'oscilloscope'], ['oscilloscope_frequency', Math.PI, 'oscilloscope'],
  ['oscilloscope_amplitude', 1, 'oscilloscope'], ['oscilloscope_damping', 0, 'oscilloscope'],
  ['popcorn2_x', 0, 'popcorn2'], ['popcorn2_y', 0, 'popcorn2'], ['popcorn2_c', 0, 'popcorn2'],
  ['separation_x', 0, 'separation'], ['separation_xinside', 0, 'separation'],
  ['separation_y', 0, 'separation'], ['separation_yinside', 0, 'separation'],
  ['split_xsize', 0, 'split'], ['split_ysize', 0, 'split'],
  ['splits_x', 0, 'splits'], ['splits_y', 0, 'splits'],
  ['stripes_space', 0, 'stripes'], ['stripes_warp', 0, 'stripes'],
  ['wedge_angle', 0, 'wedge'], ['wedge_hole', 0, 'wedge'], ['wedge_count', 1, 'wedge'], ['wedge_swirl', 0, 'wedge'],
  ['wedge_julia_angle', 0, 'wedge_julia'], ['wedge_julia_count', 1, 'wedge_julia'],
  ['wedge_julia_power', 1, 'wedge_julia'], ['wedge_julia_dist', 0, 'wedge_julia'],
  ['wedge_sph_angle', 0, 'wedge_sph'], ['wedge_sph_count', 1, 'wedge_sph'],
  ['wedge_sph_hole', 0, 'wedge_sph'], ['wedge_sph_swirl', 0, 'wedge_sph'],
  ['whorl_inside', 0, 'whorl'], ['whorl_outside', 0, 'whorl'],
  ['waves2_freqx', 0, 'waves2'], ['waves2_scalex', 0, 'waves2'], ['waves2_freqy', 0, 'waves2'], ['waves2_scaley', 0, 'waves2'],
  ['auger_sym', 0, 'auger'], ['auger_weight', 0.5, 'auger'], ['auger_freq', 1, 'auger'], ['auger_scale', 1, 'auger'],
  ['flux_spread', 0, 'flux'],
  ['mobius_re_a', 0, 'mobius'], ['mobius_im_a', 0, 'mobius'], ['mobius_re_b', 0, 'mobius'], ['mobius_im_b', 0, 'mobius'],
  ['mobius_re_c', 0, 'mobius'], ['mobius_im_c', 0, 'mobius'], ['mobius_re_d', 0, 'mobius'], ['mobius_im_d', 0, 'mobius'],
];
// Values that xform_precalc (variations.c) derives from the parameters.
// They follow the parameters in the block. They are never exported.
export const PRECALC_NAMES = [
  'persp_vsin', 'persp_vfcos', 'julian_rN', 'julian_cn', 'juliascope_rN', 'juliascope_cn',
  'radialBlur_spinvar', 'radialBlur_zoomvar', 'waves_dx2', 'waves_dy2',
  'disc2_sinadd', 'disc2_cosadd', 'disc2_timespi', 'super_shape_pm_4', 'super_shape_pneg1_n1',
  'wedgeJulia_cf', 'wedgeJulia_rN', 'wedgeJulia_cn',
];
export const PARAM_NAMES = PARAM_DEFS.map(d => d[0]);
export const ALL_PARAM_NAMES = PARAM_NAMES.concat(PRECALC_NAMES);
export const PI_ = Object.fromEntries(ALL_PARAM_NAMES.map((n, i) => [n, i]));   // name -> index
export const VAR_PARAMS = {};
for (const [n, , v] of PARAM_DEFS) (VAR_PARAMS[v] = VAR_PARAMS[v] || []).push(n);
// parser.c accepts the old oscope_* names as well.
const PARAM_ALIAS = { oscope_separation: 'oscilloscope_separation', oscope_frequency: 'oscilloscope_frequency', oscope_amplitude: 'oscilloscope_amplitude', oscope_damping: 'oscilloscope_damping' };

// The variations that flam3-genome leaves out of random genomes when no
// variation list is given (flam3-genome.c, the novars list).
export const NOVARS = ['noise', 'blur', 'gaussian_blur', 'radial_blur', 'ngon', 'square', 'rays', 'cross', 'pre_blur', 'separation', 'split', 'splits'].map(n => VAR[n]);
export const DEFAULT_IVARS = VAR_NAMES.map((n, i) => i).filter(i => !NOVARS.includes(i));

// ── GPU block layout ───────────────────────────────────────────────────────
// One xform is XF_BLOCK floats in the storage buffer that flame.wgsl reads.
// The OFF_* constants are also in flame.wgsl. tests.mjs checks them.
export const MAX_VARS_PER_XF = 16;
export const OFF_C = 0, OFF_POST = 6, OFF_COLOR = 12, OFF_CSPEED = 13, OFF_VIS = 14, OFF_HASPOST = 15,
  OFF_NV = 16, OFF_PREBLUR = 17, OFF_VARS = 20, OFF_PARAMS = 52;
export const XF_BLOCK = 192;
export const MAX_XF = 48;          // standard xforms plus the final xform
export const DIST_GRAIN = 1024;    // flam3 uses CHOOSE_XFORM_GRAIN 16384
export const EPS = 1e-10;

// ── seeded random numbers ──────────────────────────────────────────────────
// flam3 uses random() and ISAAC. This port uses one 32-bit generator
// (mulberry32) for all of them, so a seed gives the same genome every time.
export class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 0x9e3779b9; }
  u32() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  r01() { return this.u32() / 4294967296; }
  r11() { return this.r01() * 2 - 1; }
  bit() { return this.u32() & 1; }
  int(n) { return Math.floor(this.r01() * n); }
  pick(a) { return a[this.int(a.length)]; }
}

// ── genome and xform ───────────────────────────────────────────────────────
export function defaultParams() {
  const p = {};
  for (const [n, d] of PARAM_DEFS) p[n] = d;
  return p;
}
// initialize_xforms (variations.c): weight 0, linear 1, identity affine.
export function newXform(i = 0) {
  const v = new Float64Array(NVARS); v[0] = 1;
  return { density: 0, color: i & 1, colorSpeed: 0.5, animate: 1, opacity: 1,
    c: [1, 0, 0, 1, 0, 0], post: [1, 0, 0, 1, 0, 0], v, p: defaultParams(), padding: 0 };
}
export function copyXform(x) {
  return { density: x.density, color: x.color, colorSpeed: x.colorSpeed, animate: x.animate, opacity: x.opacity,
    c: x.c.slice(), post: x.post.slice(), v: Float64Array.from(x.v), p: Object.assign({}, x.p), padding: x.padding || 0 };
}
// clear_cp (flam3.c) with flam3_defaults_on.
export function newGenome() {
  const pal = new Float32Array(768).fill(1);
  return {
    name: '', time: 0, width: 1000, height: 1000, center: [0, 0], ppu: 50, zoom: 0, rotate: 0,
    quality: 250, brightness: 4, contrast: 1, gamma: 4, highlight: -1, vibrancy: 1, gamLin: 0.01,
    estimator: 9, estMin: 0, estCurve: 0.4, background: [0, 0, 0], supersample: 1, filter: 0.5,
    hue: 0, paletteIndex: -1, palette: pal, paletteMode: 'step', interpolationType: 'log',
    symmetry: 0, xforms: [], finalIndex: -1, chaos: null,
  };
}
export function copyGenome(g) {
  const o = Object.assign({}, g);
  o.center = g.center.slice(); o.background = g.background.slice();
  o.palette = Float32Array.from(g.palette);
  o.xforms = g.xforms.map(copyXform);
  o.chaos = g.chaos ? g.chaos.map(r => r.slice()) : null;
  return o;
}
export const numStd = g => g.xforms.length - (g.finalIndex >= 0 ? 1 : 0);
export function stdXforms(g) { return g.finalIndex >= 0 ? g.xforms.slice(0, g.finalIndex) : g.xforms; }

// flam3_add_xforms: n new standard xforms before the final, chaos padded with 1.
export function addStdXforms(g, n, padding = 0) {
  const at = numStd(g), old = at;
  const add = [];
  for (let k = 0; k < n; k++) { const x = newXform(g.xforms.length + k); x.padding = padding; add.push(x); }
  g.xforms.splice(at, 0, ...add);
  if (g.finalIndex >= 0) g.finalIndex = g.xforms.length - 1;
  if (g.chaos) {
    const ns = old + n;
    for (const r of g.chaos) while (r.length < ns) r.push(1);
    while (g.chaos.length < ns) g.chaos.push(new Array(ns).fill(1));
  }
  return at;
}
export function addFinal(g) {
  if (g.finalIndex >= 0) return g.finalIndex;
  const x = newXform(g.xforms.length); x.v[0] = 1;
  g.xforms.push(x); g.finalIndex = g.xforms.length - 1;
  return g.finalIndex;
}
// flam3_delete_xform
export function deleteXform(g, i) {
  if (i !== g.finalIndex && g.chaos) {
    g.chaos.splice(i, 1);
    for (const r of g.chaos) r.splice(i, 1);
  }
  g.xforms.splice(i, 1);
  if (g.finalIndex === i) g.finalIndex = -1;
  else if (g.finalIndex > i) g.finalIndex--;
}
export function chaosAt(g, i, j) { return g.chaos ? g.chaos[i][j] : 1; }
export function isUnityChaos(g) {
  if (!g.chaos) return true;
  for (const r of g.chaos) for (const v of r) if (Math.abs(v - 1) > EPS) return false;
  return true;
}
// flam3_copy_params: the parameters of one variation.
export function copyParams(dst, src, j) {
  for (const n of VAR_PARAMS[VAR_NAMES[j]] || []) dst.p[n] = src.p[n];
}

// ── palettes (palettes.c) ──────────────────────────────────────────────────
// rgb 0-1, h 0-6, s 0-1, v 0-1
export function rgb2hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), del = max - min;
  const v = max, s = max !== 0 ? del / max : 0;
  let h = 0;
  if (s !== 0) {
    const rc = (max - r) / del, gc = (max - g) / del, bc = (max - b) / del;
    if (r === max) h = bc - gc; else if (g === max) h = 2 + rc - bc; else h = 4 + gc - rc;
    if (h < 0) h += 6;
  }
  return [h, s, v];
}
export function hsv2rgb(h, s, v) {
  while (h >= 6) h -= 6;
  while (h < 0) h += 6;
  const j = Math.floor(h), f = h - j, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  switch (j) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
    default: return [v, t, p];
  }
}
// The palette library is { count, numbers, names, data: Uint8Array(count*768) },
// built from flam3-palettes.xml by build-palettes.mjs. flam3_get_palette:
// look up by palette number, then turn the hue by hue_rotation (0-1).
export function getPalette(lib, number, hue = 0) {
  const out = new Float32Array(768).fill(1);
  if (!lib) return { index: -1, palette: out };
  let idx = lib.numbers.indexOf(number);
  if (idx < 0) return { index: -1, palette: out };
  const d = lib.data, o = idx * 768;
  for (let i = 0; i < 256; i++) {
    const r = d[o + i * 3] / 255, g = d[o + i * 3 + 1] / 255, b = d[o + i * 3 + 2] / 255;
    if (hue) {
      const hsv = rgb2hsv(r, g, b);
      const c = hsv2rgb(hsv[0] + hue * 6, hsv[1], hsv[2]);
      out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
    } else { out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b; }
  }
  return { index: number, palette: out };
}
export function randomPalette(lib, rng, hue = 0) {
  if (!lib || !lib.count) return getPalette(null, -1, 0);
  return getPalette(lib, lib.numbers[rng.int(lib.count)], hue);
}
export function setPalette(g, lib, number, hue) {
  const r = getPalette(lib, number, hue);
  g.paletteIndex = r.index; g.hue = hue; g.palette = r.palette;
}

// ── symmetry (flam3_add_symmetry) ──────────────────────────────────────────
// sym >= 2 rotational, 1 none, 0 random, -1 bilateral, <= -2 dihedral.
const SYM_DISTRIB = [-4, -3, -2, -2, -2, -1, -1, -1, 2, 2, 2, 3, 3, 4, 4];
function round6(x) { x *= 1e6; if (x < 0) x -= 1; return 1e-6 * Math.trunc(x + 0.5); }
const det2 = c => c[0] * c[3] - c[1] * c[2];
function compareXforms(a, b) {
  if (a.colorSpeed > b.colorSpeed) return 1;
  if (a.colorSpeed < b.colorSpeed) return -1;
  let ad = det2(a.c), bd = det2(b.c);
  if (a.colorSpeed) {
    if (ad < 0) return -1;
    if (bd < 0) return 1;
    ad = Math.atan2(a.c[0], a.c[1]); bd = Math.atan2(b.c[0], b.c[1]);
  }
  return ad < bd ? -1 : ad > bd ? 1 : 0;
}
export function pickSymmetry(rng, maxAbs = 25) {
  let sym;
  if (rng.bit()) sym = rng.pick(SYM_DISTRIB);
  else if (rng.u32() & 31) sym = rng.int(13) - 6;
  else sym = rng.int(51) - 25;
  if (Math.abs(sym) > maxAbs) sym = Math.sign(sym) * maxAbs;
  return sym;
}
export function addSymmetry(g, sym, rng, maxAbs = 25) {
  if (sym === 0) sym = pickSymmetry(rng, maxAbs);
  if (sym === 1 || sym === 0) return;
  // Keep the xform count inside the GPU table.
  const room = MAX_XF - g.xforms.length;
  const need = s => (s < 0 ? -s : s) - 1 + (s < 0 ? 1 : 0);
  while (Math.abs(sym) > 1 && need(sym) > room) sym -= Math.sign(sym);
  if (sym === 1 || sym === 0 || sym === -1 && room < 1) return;
  g.symmetry = sym;
  let result = 0;
  const mk = () => {
    const i = addStdXforms(g, 1, 0);
    const x = g.xforms[i];
    x.density = 1; x.colorSpeed = 0; x.animate = 0; x.v.fill(0); x.v[0] = 1;
    return x;
  };
  if (sym < 0) {
    const x = mk();
    x.color = 1; x.c = [-1, 0, 0, 1, 0, 0];
    result++; sym = -sym;
  }
  const a = 2 * Math.PI / sym;
  for (let k = 1; k < sym; k++) {
    const x = mk();
    x.color = sym < 3 ? 0 : (k - 1) / (sym - 2);
    const c00 = round6(Math.cos(k * a)), c01 = round6(Math.sin(k * a));
    x.c = [c00, c01, round6(-c01), c00, 0, 0];
    result++;
  }
  const ns = numStd(g);
  const tail = g.xforms.slice(ns - result, ns).sort(compareXforms);
  g.xforms.splice(ns - result, result, ...tail);
}
// The xforms that flam3_add_symmetry made carry animate 0 (they do not
// turn in sheep). Remove them, so a new symmetry can replace the old one.
export function removeSymmetry(g) {
  for (let i = numStd(g) - 1; i >= 0; i--) {
    const x = g.xforms[i];
    if (x.animate === 0 && x.colorSpeed === 0 && x.v[0] === 1 && x.v.reduce((s, v) => s + (v !== 0), 0) === 1) deleteXform(g, i);
  }
  g.symmetry = 0;
}

// ── random genome (flam3_random) ───────────────────────────────────────────
// opts: { ivars (variation list, default DEFAULT_IVARS), weights (optional
// per-variation weights for the choice; flam3 picks uniformly), sym (0 =
// random), specXforms (0 = random count), lib (palettes), maxSym }
const XFORM_DISTRIB = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6];
function makePicker(rng, ivars, weights) {
  if (!weights) return () => ivars[rng.int(ivars.length)];
  const w = ivars.map(i => Math.max(0, weights[i] == null ? 1 : weights[i]));
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  return () => {
    let r = rng.r01() * tot;
    for (let k = 0; k < ivars.length; k++) { r -= w[k]; if (r < 0) return ivars[k]; }
    return ivars[ivars.length - 1];
  };
}
export function flam3Random(rng, opts = {}) {
  const ivars = opts.ivars || DEFAULT_IVARS;
  const pick = makePicker(rng, ivars, opts.weights);
  const g = newGenome();
  g.hue = (rng.u32() & 7) ? 0 : rng.r01();
  if (opts.lib) { const p = randomPalette(opts.lib, rng, g.hue); g.paletteIndex = p.index; g.palette = p.palette; }
  let nxforms, addfinal = 0, finum = -1;
  if (opts.specXforms > 0) { nxforms = opts.specXforms; addStdXforms(g, nxforms); }
  else {
    nxforms = rng.pick(XFORM_DISTRIB); addStdXforms(g, nxforms);
    addfinal = rng.r01() < 0.15 ? 1 : 0;
    if (addfinal) { addFinal(g); nxforms += 1; finum = nxforms - 1; }
  }
  const samed = rng.bit();
  rng.bit();   // multid: drawn by flam3, used only when ivars is "random"
  const postid = rng.r01() < 0.6, samepost = rng.bit();
  for (let i = 0; i < nxforms; i++) {
    const x = g.xforms[i];
    x.density = 1 / nxforms; x.color = i & 1; x.colorSpeed = 0.5; x.animate = 1;
    for (let k = 0; k < 6; k++) { x.c[k] = rng.r11(); }
    x.post = [1, 0, 0, 1, 0, 0];
    if (i !== finum) {
      if (!postid) for (let k = 0; k < 6; k++) x.post[k] = (samepost || i === 0) ? rng.r11() : g.xforms[0].post[k];
      x.v.fill(0);
      if (samed && i > 0) {
        for (let j = 0; j < NVARS; j++) { x.v[j] = g.xforms[i - 1].v[j]; copyParams(x, g.xforms[i - 1], j); }
      } else {
        let n = 2;
        while (rng.bit() && n < NVARS) n++;
        for (let j = 0; j < n; j++) x.v[pick()] = rng.r01();
        normalizeVars(x, rng);
      }
    } else {
      x.density = 0;   // a final xform has no weight
      x.v.fill(0);
      let n = 1; if (rng.bit()) n++;
      for (let j = 0; j < n; j++) x.v[pick()] = rng.r01();
      normalizeVars(x, rng);
    }
    randomParams(x, rng);
  }
  if (opts.sym || (rng.int(4) === 0 && !addfinal)) addSymmetry(g, opts.sym || 0, rng, opts.maxSym || 25);
  else g.symmetry = 0;
  return g;
}
function normalizeVars(x, rng) {
  let sum = 0;
  for (let j = 0; j < NVARS; j++) sum += x.v[j];
  if (sum === 0) x.v[rng.int(NVARS)] = 1;
  else for (let j = 0; j < NVARS; j++) x.v[j] /= sum;
}
// The random parameters of flam3_random, one block per parametric variation.
export function randomParams(x, rng) {
  const p = x.p, v = x.v, r01 = () => rng.r01(), r11 = () => rng.r11(), PI = Math.PI;
  if (v[VAR.blob] > 0) { p.blob_low = 0.2 + 0.5 * r01(); p.blob_high = 0.8 + 0.4 * r01(); p.blob_waves = Math.trunc(2 + 5 * r01()); }
  if (v[VAR.pdj] > 0) { p.pdj_a = 3 * r11(); p.pdj_b = 3 * r11(); p.pdj_c = 3 * r11(); p.pdj_d = 3 * r11(); }
  if (v[VAR.fan2] > 0) { p.fan2_x = r11(); p.fan2_y = r11(); }
  if (v[VAR.rings2] > 0) p.rings2_val = 2 * r01();
  if (v[VAR.perspective] > 0) { p.perspective_angle = r01(); p.perspective_dist = 2 * r01() + 1; }
  if (v[VAR.julian] > 0) { p.julian_power = Math.trunc(5 * r01() + 2); p.julian_dist = 1; }
  if (v[VAR.juliascope] > 0) { p.juliascope_power = Math.trunc(5 * r01() + 2); p.juliascope_dist = 1; }
  if (v[VAR.radial_blur] > 0) p.radial_blur_angle = 2 * r01() - 1;
  // flam3 writes (int) 10.0*random01(): the cast binds to 10.0, so slices = 10*r.
  if (v[VAR.pie] > 0) { p.pie_slices = 10 * r01(); p.pie_thickness = r01(); p.pie_rotation = 2 * PI * r11(); }
  // Same for ngon_sides: (int) random01() is 0, so sides = 3.
  if (v[VAR.ngon] > 0) { p.ngon_sides = Math.trunc(r01()) * 10 + 3; p.ngon_power = 3 * r01() + 1; p.ngon_circle = 3 * r01(); p.ngon_corners = 2 * r01() * p.ngon_circle; }
  if (v[VAR.curl] > 0) { p.curl_c1 = r01(); p.curl_c2 = r01(); }
  if (v[VAR.rectangles] > 0) { p.rectangles_x = r01(); p.rectangles_y = r01(); }
  if (v[VAR.disc2] > 0) { p.disc2_rot = 0.5 * r01(); p.disc2_twist = 0.5 * r01(); }
  if (v[VAR.super_shape] > 0) {
    p.super_shape_rnd = r01(); p.super_shape_m = Math.trunc(r01()) * 6; p.super_shape_n1 = r01() * 40;
    p.super_shape_n2 = r01() * 20; p.super_shape_n3 = p.super_shape_n2; p.super_shape_holes = 0;
  }
  if (v[VAR.flower] > 0) { p.flower_petals = 4 * r01(); p.flower_holes = r01(); }
  if (v[VAR.conic] > 0) { p.conic_eccentricity = r01(); p.conic_holes = r01(); }
  if (v[VAR.parabola] > 0) { p.parabola_height = 0.5 + r01(); p.parabola_width = 0.5 + r01(); }
  if (v[VAR.bent2] > 0) { p.bent2_x = 3 * (-0.5 + r01()); p.bent2_y = 3 * (-0.5 + r01()); }
  if (v[VAR.bipolar] > 0) p.bipolar_shift = 2 * r01() - 1;
  if (v[VAR.cell] > 0) p.cell_size = 2 * r01() + 0.5;
  if (v[VAR.cpow] > 0) { p.cpow_r = 3 * r01(); p.cpow_i = r01() - 0.5; p.cpow_power = Math.trunc(5 * r01()); }
  if (v[VAR.curve] > 0) { p.curve_xamp = 5 * (r01() - 0.5); p.curve_yamp = 4 * (r01() - 0.5); p.curve_xlength = 2 * (r01() + 0.5); p.curve_ylength = 2 * (r01() + 0.5); }
  if (v[VAR.escher] > 0) p.escher_beta = PI * r11();
  if (v[VAR.lazysusan] > 0) { p.lazysusan_x = 2 * r11(); p.lazysusan_y = 2 * r11(); p.lazysusan_spin = PI * r11(); p.lazysusan_space = 2 * r11(); p.lazysusan_twist = 2 * r11(); }
  if (v[VAR.modulus] > 0) { p.modulus_x = r11(); p.modulus_y = r11(); }
  if (v[VAR.oscilloscope] > 0) { p.oscilloscope_separation = 1 + r11(); p.oscilloscope_frequency = PI * r11(); p.oscilloscope_amplitude = 1 + 2 * r01(); p.oscilloscope_damping = r01(); }
  if (v[VAR.popcorn2] > 0) { p.popcorn2_x = 0.2 * r01(); p.popcorn2_y = 0.2 * r01(); p.popcorn2_c = 5 * r01(); }
  if (v[VAR.separation] > 0) { p.separation_x = 1 + r11(); p.separation_y = 1 + r11(); p.separation_xinside = r11(); p.separation_yinside = r11(); }
  if (v[VAR.split] > 0) { p.split_xsize = r11(); p.split_ysize = r11(); }
  if (v[VAR.splits] > 0) { p.splits_x = r11(); p.splits_y = r11(); }
  if (v[VAR.stripes] > 0) { p.stripes_space = r01(); p.stripes_warp = 5 * r01(); }
  if (v[VAR.wedge] > 0) { p.wedge_angle = PI * r01(); p.wedge_hole = 0.5 * r11(); p.wedge_count = Math.floor(5 * r01()) + 1; p.wedge_swirl = r01(); }
  if (v[VAR.wedge_julia] > 0) { p.wedge_julia_power = Math.trunc(5 * r01() + 2); p.wedge_julia_dist = 1; p.wedge_julia_count = Math.trunc(3 * r01() + 1); p.wedge_julia_angle = PI * r01(); }
  if (v[VAR.wedge_sph] > 0) { p.wedge_sph_angle = PI * r01(); p.wedge_sph_hole = 0.5 * r11(); p.wedge_sph_count = Math.floor(5 * r01()) + 1; p.wedge_sph_swirl = r01(); }
  if (v[VAR.whorl] > 0) { p.whorl_inside = r01(); p.whorl_outside = r01(); }
  if (v[VAR.waves2] > 0) { p.waves2_scalex = 0.5 + r01(); p.waves2_scaley = 0.5 + r01(); p.waves2_freqx = 4 * r01(); p.waves2_freqy = 4 * r01(); }
  if (v[VAR.auger] > 0) { p.auger_sym = 0; p.auger_weight = 0.5 + r01() / 2; p.auger_freq = Math.floor(5 * r01()) + 1; p.auger_scale = r01(); }
  if (v[VAR.flux] > 0) p.flux_spread = 0.5 + r01() / 2;
  if (v[VAR.mobius] > 0) for (const n of VAR_PARAMS.mobius) p[n] = r11();
}

// truncate_variations (flam3-genome.c): drop xforms of weight < 0.001 and
// keep at most maxVars variations per xform (the smallest go first).
export function truncateVariations(g, maxVars = 5) {
  for (let i = 0; i < g.xforms.length; i++) {
    const x = g.xforms[i];
    if (x.density < 0.001 && g.finalIndex !== i) {
      if (numStd(g) > 1) { deleteXform(g, i); i--; }
      continue;
    }
    for (;;) {
      let n = 0, smallest = -1, sv = 0;
      for (let j = 0; j < NVARS; j++) {
        const v = x.v[j];
        if (v !== 0) { n++; if (smallest === -1 || Math.abs(v) < sv) { smallest = j; sv = Math.abs(v); } }
      }
      if (n > maxVars) x.v[smallest] = 0; else break;
    }
  }
}

// ── mutate (flam3_mutate) ──────────────────────────────────────────────────
// mode: 'all_vars' | 'one_xform' | 'add_symmetry' | 'post_xforms' | 'color_palette'
// | 'delete_xform' | 'all_coefs' | null (random, with flam3's odds).
// opts.improveColors(g, ntries, changePalette, res) runs flam3_improve_colors
// (it needs a renderer; variations.js has one). Returns the action text.
export function mutate(g, mode, rng, opts = {}) {
  if (!mode) {
    const r = rng.r01();
    mode = r < 0.1 ? 'all_vars' : r < 0.3 ? 'one_xform' : r < 0.5 ? 'add_symmetry' : r < 0.6 ? 'post_xforms'
      : r < 0.7 ? 'color_palette' : r < 0.8 ? 'delete_xform' : 'all_coefs';
  }
  const speed = opts.speed == null ? 0.1 : opts.speed;
  const nx = g.xforms.length;
  if (mode === 'all_vars') {
    let done = false, tries = 0;
    do {
      const m = flam3Random(rng, Object.assign({}, opts, { specXforms: nx, sym: 0 }));
      for (let i = 0; i < nx; i++) for (let j = 0; j < NVARS; j++) {
        if (g.xforms[i].v[j] !== m.xforms[i].v[j]) { g.xforms[i].v[j] = m.xforms[i].v[j]; copyParams(g.xforms[i], m.xforms[i], j); done = true; }
      }
    } while (!done && ++tries < 20);
    return 'mutate all variations';
  }
  if (mode === 'one_xform') {
    const m = flam3Random(rng, Object.assign({}, opts, { specXforms: 2, sym: 0 }));
    const k = rng.int(nx);
    if (nx <= 2) { g.xforms[k].c[4] = m.xforms[0].c[4]; g.xforms[k].c[5] = m.xforms[0].c[5]; }
    else g.xforms[k].c = m.xforms[0].c.slice();
    return 'mutate xform ' + k + ' coefs';
  }
  if (mode === 'add_symmetry') { addSymmetry(g, 0, rng, opts.maxSym || 25); return 'mutate symmetry'; }
  if (mode === 'post_xforms') {
    const b = 1 + rng.int(6), same = rng.u32() & 3;
    for (let i = 0; i < nx; i++) {
      const x = g.xforms[i];
      if (i > 0 && same) { x.post = g.xforms[0].post.slice(); continue; }
      if (b & 1) {
        let f = Math.PI * rng.r11();
        const rot = (m, f) => {
          const cf = Math.cos(f), sf = Math.sin(f);
          const t00 = m[0] * cf + m[1] * -sf, t01 = m[0] * sf + m[1] * cf;
          const t10 = m[2] * cf + m[3] * -sf, t11 = m[2] * sf + m[3] * cf;
          m[0] = t00; m[1] = t01; m[2] = t10; m[3] = t11;
        };
        rot(x.c, f); f = -f; rot(x.post, f);
      }
      if (b & 2) {
        let f = 0.2 + rng.r01(), gg = 0.2 + rng.r01();
        if (rng.bit()) f = 1 / f;
        if (rng.bit()) gg = f; else if (rng.bit()) gg = 1 / gg;
        x.c[0] /= f; x.c[1] /= f; x.c[3] /= gg; x.c[2] /= gg;
        x.post[0] *= f; x.post[2] *= f; x.post[1] *= gg; x.post[3] *= gg;
      }
      if (b & 4) {
        const f = rng.r11(), gg = rng.r11();
        x.c[4] -= f; x.c[5] -= gg; x.post[4] += f; x.post[5] += gg;
      }
    }
    return 'mutate post xforms (' + b + (same ? ' same' : '') + ')';
  }
  if (mode === 'color_palette') {
    const s = rng.r01();
    if (s < 0.4 && opts.improveColors) { opts.improveColors(g, 100, false, 10, rng); return 'mutate color coords'; }
    if (s < 0.8 && opts.improveColors) { opts.improveColors(g, 25, true, 10, rng); return 'mutate color all'; }
    const p = randomPalette(opts.lib, rng, g.hue); g.paletteIndex = p.index; g.palette = p.palette;
    return 'mutate color palette';
  }
  if (mode === 'delete_xform') {
    const k = rng.int(nx);
    if (nx > 1 && numStd(g) > 1 || k === g.finalIndex) deleteXform(g, k);
    return 'mutate delete xform ' + k;
  }
  // all_coefs
  const m = flam3Random(rng, Object.assign({}, opts, { specXforms: nx, sym: 0 }));
  for (let i = 0; i < nx; i++) for (let k = 0; k < 6; k++) g.xforms[i].c[k] += speed * m.xforms[i].c[k];
  return 'mutate all coefs';
}

// ── cross (flam3_cross) ────────────────────────────────────────────────────
// mode: 'union' | 'interpolate' | 'alternate' | null (random, flam3's odds).
export function cross(g0, g1, mode, rng) {
  if (!mode) { const s = rng.r01(); mode = s < 0.1 ? 'union' : s < 0.2 ? 'interpolate' : 'alternate'; }
  let out, action;
  if (mode === 'union') {
    out = copyGenome(g0);
    for (let j = 0; j < g1.xforms.length; j++) {
      if (j === g1.finalIndex) continue;
      if (out.xforms.length >= MAX_XF) break;
      const i = addStdXforms(out, 1);
      out.xforms[i] = copyXform(g1.xforms[j]);
    }
    action = 'cross union';
  } else if (mode === 'interpolate') {
    const t = rng.r01();
    out = interpolate(g0, g1, t);
    action = 'cross interpolate ' + t.toPrecision(5);
  } else {
    let tries = 0;
    for (;;) {
      let got0 = false, got1 = false;
      let rb = rng.bit();
      out = copyGenome(rb ? g1 : g0);
      const used = rb;
      const nstd = numStd(out);
      let i;
      for (i = 0; i < nstd; i++) {
        rb = rng.bit();
        if (rb === 1) {
          if (used === 0) {
            if (i < numStd(g1) && g1.xforms[i].density > 0) { out.xforms[i] = copyXform(g1.xforms[i]); got1 = true; } else got0 = true;
          } else {
            if (i < numStd(g0) && g0.xforms[i].density > 0) { out.xforms[i] = copyXform(g0.xforms[i]); got0 = true; } else got1 = true;
          }
        } else if (used) got1 = true; else got0 = true;
      }
      if (used === 0 && g0.finalIndex >= 0) got0 = true;
      else if (used === 1 && g1.finalIndex >= 0) got1 = true;
      if (!(i > 1 && !(got0 && got1)) || ++tries > 50) break;
    }
    action = 'cross alternate';
  }
  for (let i = 0; i < out.xforms.length; i++) out.xforms[i].color = i & 1;
  if (rng.r01() < 0.4) {
    let sp = rng.bit();
    const pal = new Float32Array(768);
    for (let ci = 0; ci < 256; ci++) {
      if (rng.r01() < 0.01) sp = 1 - sp;
      const src = sp ? g1.palette : g0.palette;
      pal[ci * 3] = src[ci * 3]; pal[ci * 3 + 1] = src[ci * 3 + 1]; pal[ci * 3 + 2] = src[ci * 3 + 2];
    }
    out.palette = pal; out.paletteIndex = -1;
    action += ' cmap_cross';
  }
  out.action = action;
  return out;
}

// ── align (flam3_align, for two genomes) ───────────────────────────────────
// Pads both genomes to the same number of standard xforms and the same final
// flag. A padding xform takes a better identity from its partner when the
// partner uses a variation with holes (spherical, julian, ...).
function copyx(src, nstd, wantFinal) {
  const d = copyGenome(src);
  const ns = numStd(src);
  const fin = src.finalIndex >= 0 ? d.xforms[src.finalIndex] : null;
  d.xforms = d.xforms.slice(0, ns); d.finalIndex = -1;
  if (d.chaos) { for (const r of d.chaos) while (r.length < nstd) r.push(1); while (d.chaos.length < nstd) d.chaos.push(new Array(nstd).fill(1)); }
  for (let i = ns; i < nstd; i++) { const x = newXform(i); x.padding = 1; d.xforms.push(x); }
  if (wantFinal) {
    if (fin) d.xforms.push(fin);
    else { const x = newXform(d.xforms.length); x.padding = 1; x.animate = 0; x.colorSpeed = 0; d.xforms.push(x); }
    d.finalIndex = d.xforms.length - 1;
  }
  return d;
}
export function align(g0, g1) {
  const n0 = numStd(g0), n1 = numStd(g1);
  const maxNx = Math.max(n0, n1), maxFx = (g0.finalIndex >= 0 || g1.finalIndex >= 0) ? 1 : 0;
  const already = n0 === n1 && (g0.finalIndex >= 0) === (g1.finalIndex >= 0);
  const d = [copyx(g0, maxNx, maxFx), copyx(g1, maxNx, maxFx)];
  if (d[0].interpolationType === 'old' || d[0].interpolationType === 'older') return d;
  for (let i = 0; i < 2; i++) {
    for (let xf = 0; xf < maxNx + maxFx; xf++) {
      const X = d[i].xforms[xf], O = d[1 - i].xforms[xf];
      for (let j = 23; j < NVARS; j++) if (X.v[j] === 0 && O.v[j] !== 0) copyParams(X, O, j);
      if (X.padding === 1 && !already) {
        X.v[0] = 0;
        let fnd = 0;
        const logInterp = (i === 0 ? d[0] : d[0]).interpolationType === 'log';
        if (logInterp && O.padding !== 1) {
          if (O.v[VAR.spherical] > 0 || O.v[VAR.ngon] > 0 || O.v[VAR.julian] > 0 || O.v[VAR.juliascope] > 0 ||
              O.v[VAR.polar] > 0 || O.v[VAR.wedge_sph] > 0 || O.v[VAR.wedge_julia] > 0) {
            X.v[VAR.linear] = -1; X.c = [-1, 0, 0, -1, 0, 0]; fnd = -1;
          }
        }
        if (fnd === 0 && O.padding !== 1) {
          if (O.v[VAR.rectangles] > 0) { X.v[VAR.rectangles] = 1; X.p.rectangles_x = 0; X.p.rectangles_y = 0; fnd++; }
          if (O.v[VAR.rings2] > 0) { X.v[VAR.rings2] = 1; X.p.rings2_val = 0; fnd++; }
          if (O.v[VAR.fan2] > 0) { X.v[VAR.fan2] = 1; X.p.fan2_x = 0; X.p.fan2_y = 0; fnd++; }
          if (O.v[VAR.blob] > 0) { X.v[VAR.blob] = 1; X.p.blob_low = 1; X.p.blob_high = 1; X.p.blob_waves = 1; fnd++; }
          if (O.v[VAR.perspective] > 0) { X.v[VAR.perspective] = 1; X.p.perspective_angle = 0; fnd++; }
          if (O.v[VAR.curl] > 0) { X.v[VAR.curl] = 1; X.p.curl_c1 = 0; X.p.curl_c2 = 0; fnd++; }
          if (O.v[VAR.super_shape] > 0) {
            X.v[VAR.super_shape] = 1; X.p.super_shape_n1 = 2; X.p.super_shape_n2 = 2; X.p.super_shape_n3 = 2;
            X.p.super_shape_rnd = 0; X.p.super_shape_holes = 0; fnd++;
          }
        }
        if (fnd === 0 && O.padding !== 1) {
          if (O.v[VAR.fan] > 0) { X.v[VAR.fan] = 1; fnd++; }
          if (O.v[VAR.rings] > 0) { X.v[VAR.rings] = 1; fnd++; }
          if (fnd > 0) X.c = [0, 1, 1, 0, 0, 0];
        }
        if (fnd === 0) X.v[VAR.linear] = 1;
        else if (fnd > 0) { let s = 0; for (let j = 0; j < NVARS; j++) s += X.v[j]; for (let j = 0; j < NVARS; j++) X.v[j] /= s; }
      }
    }
  }
  return d;
}

// ── interpolate (flam3_interpolate + flam3_interpolate_n, two genomes) ─────
// t = 0 gives g0, t = 1 gives g1. Scalars blend linearly. The palette blends
// in HSV the short way round the hue circle (hsv_circular). With the "log"
// interpolation type the affine columns blend as angle and log magnitude,
// so a turning xform turns instead of shrinking through zero.
function polar(cps, xfi, post) {
  const ang = [[0, 0], [0, 0]], mag = [[0, 0], [0, 0]], trn = [[0, 0], [0, 0]];
  for (let k = 0; k < 2; k++) {
    const m = post ? cps[k].xforms[xfi].post : cps[k].xforms[xfi].c;
    const zlm = [0, 0];
    for (let col = 0; col < 2; col++) {
      const c0 = m[col * 2], c1 = m[col * 2 + 1];
      ang[k][col] = Math.atan2(c1, c0);
      mag[k][col] = Math.sqrt(c0 * c0 + c1 * c1);
      if (mag[k][col] === 0) zlm[col] = 1;
      trn[k][col] = m[4 + col];
    }
    if (zlm[0] === 1 && zlm[1] === 0) ang[k][0] = ang[k][1];
    else if (zlm[0] === 0 && zlm[1] === 1) ang[k][1] = ang[k][0];
  }
  for (let col = 0; col < 2; col++) {
    const d = ang[1][col] - ang[0][col];
    if (d > Math.PI + EPS) ang[1][col] -= 2 * Math.PI;
    else if (d < -(Math.PI - EPS)) ang[1][col] += 2 * Math.PI;
  }
  return { ang, mag, trn };
}
function polarBack(c, P) {
  const out = [0, 0, 0, 0, 0, 0];
  for (let col = 0; col < 2; col++) {
    const linear = Math.log(P.mag[0][col]) < -10 || Math.log(P.mag[1][col]) < -10;
    let a = 0, m = 0;
    for (let k = 0; k < 2; k++) {
      a += c[k] * P.ang[k][col];
      m += c[k] * (linear ? P.mag[k][col] : Math.log(P.mag[k][col]));
      out[4 + col] += c[k] * P.trn[k][col];
    }
    const e = linear ? m : Math.exp(m);
    out[col * 2] = e * Math.cos(a); out[col * 2 + 1] = e * Math.sin(a);
  }
  return out;
}
const isId = m => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
export function interpolate(ga, gb, t) {
  if (t <= 0 && ga === gb) return copyGenome(ga);
  const cps = align(ga, gb);
  const c = [1 - t, t];
  const L = (a, b) => c[0] * a + c[1] * b;
  const r = copyGenome(cps[0]);
  // palette, hsv_circular with hsv_rgb_palette_blend 0
  const pal = new Float32Array(768);
  for (let i = 0; i < 256; i++) {
    const A = rgb2hsv(cps[0].palette[i * 3], cps[0].palette[i * 3 + 1], cps[0].palette[i * 3 + 2]);
    const B = rgb2hsv(cps[1].palette[i * 3], cps[1].palette[i * 3 + 1], cps[1].palette[i * 3 + 2]);
    if (B[0] - A[0] > 3) A[0] += 6; else if (B[0] - A[0] < -3) A[0] -= 6;
    const o = hsv2rgb(L(A[0], B[0]), L(A[1], B[1]), L(A[2], B[2]));
    for (let k = 0; k < 3; k++) pal[i * 3 + k] = Math.min(1, Math.max(0, o[k]));
  }
  r.palette = pal; r.paletteIndex = -1; r.symmetry = 0;
  for (const k of ['brightness', 'contrast', 'highlight', 'gamma', 'vibrancy', 'hue', 'ppu', 'zoom', 'rotate',
    'estimator', 'estMin', 'estCurve', 'gamLin', 'quality', 'filter']) r[k] = L(cps[0][k], cps[1][k]);
  for (const k of ['width', 'height']) r[k] = Math.round(L(cps[0][k], cps[1][k]));
  r.center = [L(cps[0].center[0], cps[1].center[0]), L(cps[0].center[1], cps[1].center[1])];
  r.background = [0, 1, 2].map(k => L(cps[0].background[k], cps[1].background[k]));
  const ns = numStd(r);
  if (cps[0].chaos || cps[1].chaos) {
    r.chaos = [];
    for (let i = 0; i < ns; i++) { r.chaos.push([]); for (let j = 0; j < ns; j++) r.chaos[i].push(Math.max(0, L(chaosAt(cps[0], i, j), chaosAt(cps[1], i, j)))); }
  } else r.chaos = null;
  const logType = cps[0].interpolationType === 'log';
  for (let i = 0; i < r.xforms.length; i++) {
    const X = r.xforms[i], A = cps[0].xforms[i], B = cps[1].xforms[i];
    X.density = Math.max(0, L(A.density, B.density));
    X.color = Math.min(1, Math.max(0, L(A.color, B.color)));
    X.colorSpeed = Math.min(1, Math.max(0, L(A.colorSpeed, B.colorSpeed)));
    X.opacity = L(A.opacity, B.opacity); X.animate = L(A.animate, B.animate);
    X.padding = 0;
    for (const n of PARAM_NAMES) X.p[n] = L(A.p[n], B.p[n]);
    for (let j = 0; j < NVARS; j++) X.v[j] = L(A.v[j], B.v[j]);
    const allId = isId(A.post) && isId(B.post);
    if (logType) {
      X.c = polarBack(c, polar(cps, i, false));
      X.post = allId ? [1, 0, 0, 1, 0, 0] : polarBack(c, polar(cps, i, true));
    } else {
      X.c = A.c.map((v, k) => L(v, B.c[k]));
      X.post = allId ? [1, 0, 0, 1, 0, 0] : A.post.map((v, k) => L(v, B.post[k]));
    }
  }
  return r;
}

// ── xform choice table (flam3_create_xform_distrib) ────────────────────────
// Row 0 holds the plain weights. With xaos (chaos not all ones), row 1 + i
// holds the weights times chaos[i][*], used after xform i ran.
export function xformDistrib(g, grain = DIST_GRAIN) {
  const ns = numStd(g);
  const chaosOn = !isUnityChaos(g);
  const rows = chaosOn ? ns + 1 : 1;
  const out = new Uint32Array(rows * grain);
  for (let row = 0; row < rows; row++) {
    const xi = row - 1;
    const w = j => g.xforms[j].density * (xi >= 0 ? chaosAt(g, xi, j) : 1);
    let dr = 0;
    for (let j = 0; j < ns; j++) dr += Math.max(0, w(j));
    if (dr === 0) { for (let k = 0; k < grain; k++) out[row * grain + k] = 0; continue; }
    dr /= grain;
    let j = 0, t = Math.max(0, w(0)), r = 0;
    for (let k = 0; k < grain; k++) {
      while (r >= t && j < ns - 1) { j++; t += Math.max(0, w(j)); }
      out[row * grain + k] = j; r += dr;
    }
  }
  return { table: out, chaosOn, rows };
}

// adjust_percentage (interpolation.c): opacity -> visibility.
export function adjustPercentage(x) { return x === 0 ? 0 : Math.pow(10, -Math.log(1 / x) / Math.log(2)); }

// xform_precalc (variations.c): values derived from the parameters.
export function precalc(x) {
  const p = x.p, o = {};
  const ang = p.perspective_angle * Math.PI / 2;
  o.persp_vsin = Math.sin(ang); o.persp_vfcos = p.perspective_dist * Math.cos(ang);
  o.julian_rN = Math.abs(p.julian_power); o.julian_cn = p.julian_dist / p.julian_power / 2;
  o.juliascope_rN = Math.abs(p.juliascope_power); o.juliascope_cn = p.juliascope_dist / p.juliascope_power / 2;
  o.radialBlur_spinvar = Math.sin(p.radial_blur_angle * Math.PI / 2); o.radialBlur_zoomvar = Math.cos(p.radial_blur_angle * Math.PI / 2);
  o.waves_dx2 = 1 / (x.c[4] * x.c[4] + EPS); o.waves_dy2 = 1 / (x.c[5] * x.c[5] + EPS);
  const add = p.disc2_twist;
  o.disc2_timespi = p.disc2_rot * Math.PI;
  o.disc2_sinadd = Math.sin(add); o.disc2_cosadd = Math.cos(add) - 1;
  if (add > 2 * Math.PI) { const k = 1 + add - 2 * Math.PI; o.disc2_cosadd *= k; o.disc2_sinadd *= k; }
  if (add < -2 * Math.PI) { const k = 1 + add + 2 * Math.PI; o.disc2_cosadd *= k; o.disc2_sinadd *= k; }
  o.super_shape_pm_4 = p.super_shape_m / 4; o.super_shape_pneg1_n1 = -1 / p.super_shape_n1;
  o.wedgeJulia_cf = 1 - p.wedge_julia_angle * p.wedge_julia_count / Math.PI * 0.5;
  o.wedgeJulia_rN = Math.abs(p.wedge_julia_power); o.wedgeJulia_cn = p.wedge_julia_dist / p.wedge_julia_power / 2;
  return o;
}

// One xform as the renderer sees it (prepare_precalc_flags): the active
// variations in index order, the pre_blur weight, the visibility and the
// full parameter vector. Shared by the CPU port and the GPU packer.
export function prepareXform(x) {
  const vars = [], ws = [];
  let preblur = 0;
  for (let j = 0; j < NVARS; j++) {
    if (x.v[j] === 0) continue;
    if (j === VAR.pre_blur) { preblur = x.v[j]; continue; }
    vars.push(j); ws.push(x.v[j]);
  }
  // More than MAX_VARS_PER_XF: keep the largest weights (truncate_variations).
  while (vars.length > MAX_VARS_PER_XF) {
    let k = 0; for (let i = 1; i < ws.length; i++) if (Math.abs(ws[i]) < Math.abs(ws[k])) k = i;
    vars.splice(k, 1); ws.splice(k, 1);
  }
  const P = new Float64Array(ALL_PARAM_NAMES.length);
  PARAM_NAMES.forEach((n, i) => { P[i] = x.p[n]; });
  const pc = precalc(x);
  PRECALC_NAMES.forEach((n, i) => { P[PARAM_NAMES.length + i] = pc[n]; });
  return { c: x.c.slice(), post: x.post.slice(), hasPost: !isId(x.post), color: x.color, colorSpeed: x.colorSpeed,
    vis: adjustPercentage(x.opacity), opacity: x.opacity, vars, ws, preblur, P, density: x.density };
}
export function prepareGenome(g) {
  const xf = g.xforms.map(prepareXform);
  const d = xformDistrib(g);
  return { xf, nstd: numStd(g), finalIndex: g.finalIndex, dist: d.table, chaosOn: d.chaosOn, rows: d.rows };
}

// Pack for flame.wgsl: the xform blocks and the choice table.
export function packGenome(g) {
  const pg = prepareGenome(g);
  const n = Math.min(pg.xf.length, MAX_XF);
  const blocks = new Float32Array(MAX_XF * XF_BLOCK);
  for (let i = 0; i < n; i++) {
    const x = pg.xf[i], b = i * XF_BLOCK;
    for (let k = 0; k < 6; k++) { blocks[b + OFF_C + k] = x.c[k]; blocks[b + OFF_POST + k] = x.post[k]; }
    blocks[b + OFF_COLOR] = x.color; blocks[b + OFF_CSPEED] = x.colorSpeed; blocks[b + OFF_VIS] = x.vis;
    blocks[b + OFF_HASPOST] = x.hasPost ? 1 : 0; blocks[b + OFF_NV] = x.vars.length; blocks[b + OFF_PREBLUR] = x.preblur;
    for (let k = 0; k < x.vars.length; k++) { blocks[b + OFF_VARS + 2 * k] = x.vars[k]; blocks[b + OFF_VARS + 2 * k + 1] = x.ws[k]; }
    for (let k = 0; k < x.P.length; k++) blocks[b + OFF_PARAMS + k] = x.P[k];
  }
  const fin = pg.finalIndex >= 0 && pg.finalIndex < MAX_XF ? pg.finalIndex : -1;
  return { blocks, dist: pg.dist, chaosOn: pg.chaosOn, rows: pg.rows, nstd: Math.min(pg.nstd, MAX_XF - (fin >= 0 ? 1 : 0)),
    finalIndex: fin, finalOpacity: fin >= 0 ? g.xforms[fin].opacity : 1 };
}

// Variation names and weights of each xform, for the panel and the plate.
export function describe(g) {
  return g.xforms.map((x, i) => ({
    i, final: i === g.finalIndex, weight: x.density, sym: x.animate === 0 && x.colorSpeed === 0,
    vars: VAR_NAMES.map((n, j) => [n, x.v[j], j]).filter(e => e[1] !== 0),
  }));
}

// ── XML out (flam3_print) ──────────────────────────────────────────────────
// %g: six significant digits.
export function fmtG(x) {
  if (!isFinite(x)) return '0';
  if (x === 0) return '0';
  let s = Number(x.toPrecision(6)).toString();
  return s.replace(/e([+-])(\d)$/, 'e$10$2');
}
export function toXML(g) {
  const F = fmtG, out = [];
  let head = `<flame version="FLAM3-3.1.1-webgpu" time="${F(g.time)}"`;
  if (g.name) head += ` name="${g.name.replace(/[<>&"]/g, '')}"`;
  head += ` size="${Math.round(g.width)} ${Math.round(g.height)}" center="${F(g.center[0])} ${F(g.center[1])}" scale="${F(g.ppu)}"`;
  if (g.zoom !== 0) head += ` zoom="${F(g.zoom)}"`;
  head += ` rotate="${F(g.rotate)}" supersample="${g.supersample | 0 || 1}" filter="${F(g.filter)}" filter_shape="gaussian"`;
  head += ` temporal_filter_type="box" temporal_filter_width="1" quality="${F(g.quality)}" passes="1" temporal_samples="1000"`;
  head += ` background="${g.background.map(F).join(' ')}" brightness="${F(g.brightness)}" gamma="${F(g.gamma)}"`;
  head += ` highlight_power="${F(g.highlight)}" vibrancy="${F(g.vibrancy)}" estimator_radius="${F(g.estimator)}"`;
  head += ` estimator_minimum="${F(g.estMin)}" estimator_curve="${F(g.estCurve)}" gamma_threshold="${F(g.gamLin)}"`;
  head += ` palette_mode="${g.paletteMode}" interpolation_type="${g.interpolationType}" palette_interpolation="hsv_circular">`;
  out.push(head);
  // flam3 prints <symmetry kind=N/> and the symmetry xforms too; read back
  // by flam3, that doubles them. This port writes the kind as a comment.
  if (g.symmetry) out.push(`   <!-- symmetry kind="${g.symmetry}" (its xforms are listed below) -->`);
  const ns = numStd(g);
  g.xforms.forEach((x, i) => {
    const fin = i === g.finalIndex;
    let s = fin ? '   <finalxform ' : `   <xform weight="${F(x.density)}" `;
    s += `color="${F(x.color)}" color_speed="${F(x.colorSpeed)}" `;
    if (!fin) s += `animate="${F(x.animate)}" `;
    const used = new Set();
    for (let j = 0; j < NVARS; j++) if (x.v[j] !== 0) { s += `${VAR_NAMES[j]}="${F(x.v[j])}" `; used.add(VAR_NAMES[j]); }
    for (const [n, , v] of PARAM_DEFS) if (used.has(v)) s += `${n}="${F(x.p[n])}" `;
    s += `coefs="${x.c.map(F).join(' ')}"`;
    if (!isId(x.post)) s += ` post="${x.post.map(F).join(' ')}"`;
    if (!fin && g.chaos) {
      const row = g.chaos[i].slice(0, ns);
      let nc = ns; while (nc > 0 && row[nc - 1] === 1) nc--;
      if (nc > 0) s += ` chaos="${row.slice(0, nc).map(F).join(' ')} "`;
    }
    s += ` opacity="${F(x.opacity)}"/>`;
    out.push(s);
  });
  for (let i = 0; i < 256; i++) {
    const r = g.palette[i * 3] * 255, gg = g.palette[i * 3 + 1] * 255, b = g.palette[i * 3 + 2] * 255;
    out.push(`   <color index="${i}" rgb="${F(r)} ${F(gg)} ${F(b)}"/>`);
  }
  out.push('</flame>');
  return out.join('\n') + '\n';
}

// ── XML in (parser.c) ──────────────────────────────────────────────────────
// A small tag scanner, not a full XML parser: enough for .flam3 files. It
// reads every <flame> that is not inside an <edit> and returns the genomes.
// opts.lib resolves palette="N" with hue="h".
function attrs(s) {
  const o = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[3] != null ? m[3] : m[4];
  return o;
}
const nums = s => String(s).trim().split(/[\s,]+/).filter(Boolean).map(Number);
export function parseXML(text, opts = {}) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m, depthEdit = 0, g = null, hexAt = -1, hexAttrs = null;
  while ((m = re.exec(text))) {
    if (!m[2]) {
      // This port's export notes the symmetry kind in a comment (see toXML).
      const sk = g && depthEdit === 0 && /^<!--\s*symmetry kind="(-?\d+)"/.exec(m[0]);
      if (sk) g.symmetry = parseInt(sk[1], 10);
      continue;
    }
    const close = m[1] === '/', name = m[2].toLowerCase(), self = m[4] === '/';
    if (name === 'edit') { if (close) depthEdit--; else if (!self) depthEdit++; continue; }
    if (depthEdit > 0) continue;
    if (name === 'flame') {
      if (close) { if (g) { finishParse(g, opts); out.push(g); g = null; } continue; }
      g = startFlame(attrs(m[3]), opts);
      if (self) { finishParse(g, opts); out.push(g); g = null; }
      continue;
    }
    if (!g) continue;
    if (name === 'palette') {
      if (close) { if (hexAt >= 0) parseHexPalette(g, text.slice(hexAt, m.index), hexAttrs); hexAt = -1; }
      else if (!self) { hexAt = re.lastIndex; hexAttrs = attrs(m[3]); }
      continue;
    }
    if (close) continue;
    const a = attrs(m[3]);
    if (name === 'xform' || name === 'finalxform') parseXform(g, a, name === 'finalxform');
    else if (name === 'color') {
      const i = Math.round(+a.index);
      const c = nums(a.rgb || a.rgba || '255 255 255');
      if (i >= 0 && i < 256) { g.palette[i * 3] = c[0] / 255; g.palette[i * 3 + 1] = c[1] / 255; g.palette[i * 3 + 2] = c[2] / 255; g._colors = true; }
    } else if (name === 'colors') {
      const n = +a.count || 256, d = String(a.data || '').replace(/\s+/g, '');
      for (let i = 0; i < Math.min(n, 256); i++) {
        const h = d.substr(i * 8 + 2, 6);
        if (h.length < 6) break;
        g.palette[i * 3] = parseInt(h.slice(0, 2), 16) / 255; g.palette[i * 3 + 1] = parseInt(h.slice(2, 4), 16) / 255; g.palette[i * 3 + 2] = parseInt(h.slice(4, 6), 16) / 255;
      }
      g._colors = true;
    } else if (name === 'symmetry') g._sym = parseInt(a.kind, 10) || 0;
  }
  return out;
}
function parseHexPalette(g, body, a) {
  const d = body.replace(/\s+/g, '');
  const fmt = String(a.format || 'RGB').toUpperCase(), step = fmt === 'RGBA' ? 8 : 6;
  for (let i = 0; i < 256; i++) {
    const h = d.substr(i * step, step);
    if (h.length < step) break;
    const o = step === 8 ? 2 : 0;
    g.palette[i * 3] = parseInt(h.substr(o, 2), 16) / 255; g.palette[i * 3 + 1] = parseInt(h.substr(o + 2, 2), 16) / 255; g.palette[i * 3 + 2] = parseInt(h.substr(o + 4, 2), 16) / 255;
  }
  g._colors = true;
}
function startFlame(a, opts) {
  const g = newGenome();
  g.quality = 50; g.estimator = 9; g._xaos = [];
  const f = (k, d) => (a[k] != null && a[k] !== '' && isFinite(+a[k]) ? +a[k] : d);
  if (a.name) g.name = a.name;
  g.time = f('time', 0);
  if (a.size) { const s = nums(a.size); g.width = s[0] || 100; g.height = s[1] || 100; }
  if (a.center) { const c = nums(a.center); g.center = [c[0] || 0, c[1] || 0]; }
  g.ppu = f('scale', 50); g.zoom = f('zoom', 0); g.rotate = f('rotate', 0);
  g.supersample = f('supersample', f('oversample', 1)); g.filter = f('filter', 0.5);
  g.quality = f('quality', 50); g.brightness = f('brightness', 4); g.contrast = f('contrast', 1);
  g.gamma = f('gamma', 4); g.highlight = f('highlight_power', -1); g.vibrancy = f('vibrancy', 1);
  g.hue = f('hue', 0) % 1; g.estimator = f('estimator_radius', 9); g.estMin = f('estimator_minimum', 0);
  g.estCurve = f('estimator_curve', 0.4); g.gamLin = f('gamma_threshold', 0.01);
  if (a.background) { const b = nums(a.background); g.background = [b[0] || 0, b[1] || 0, b[2] || 0]; }
  if (a.palette_mode) g.paletteMode = a.palette_mode === 'linear' ? 'linear' : 'step';
  if (a.interpolation_type) g.interpolationType = a.interpolation_type;
  if (a.palette != null) {
    const r = getPalette(opts.lib, parseInt(a.palette, 10), g.hue);
    g.paletteIndex = r.index; g.palette = r.palette;
  }
  return g;
}
function parseXform(g, a, fin) {
  let x;
  if (fin) { if (g.finalIndex >= 0) return; addFinal(g); x = g.xforms[g.finalIndex]; }
  else { const i = addStdXforms(g, 1); x = g.xforms[i]; }
  x.v[0] = 0;
  for (const k in a) {
    const val = a[k];
    if (k === 'weight') x.density = +val;
    else if (k === 'color') x.color = nums(val)[0] || 0;
    else if (k === 'symmetry') { x.colorSpeed = (1 - +val) / 2; x.animate = +val > 0 ? 0 : 1; }
    else if (k === 'color_speed') x.colorSpeed = +val;
    else if (k === 'animate') x.animate = +val;
    else if (k === 'opacity') x.opacity = +val;
    else if (k === 'coefs') { const c = nums(val); if (c.length >= 6) x.c = c.slice(0, 6); }
    else if (k === 'post') { const c = nums(val); if (c.length >= 6) x.post = c.slice(0, 6); }
    else if (k === 'chaos') x._chaos = nums(val);
    else if (k === 'var1') { x.v.fill(0); const j = parseInt(val, 10); if (j >= 0 && j < NVARS) x.v[j] = 1; }
    else if (k === 'var') { const w = nums(val); for (let j = 0; j < Math.min(NVARS, w.length); j++) x.v[j] = w[j]; }
    else if (k in VAR) x.v[VAR[k]] = +val;
    else if (k in PI_ && k in x.p) x.p[k] = +val;
    else if (k in PARAM_ALIAS) x.p[PARAM_ALIAS[k]] = +val;
  }
  if (fin) x.density = 0;
}
function finishParse(g, opts) {
  // xaos rows
  const ns = numStd(g);
  const rows = g.xforms.slice(0, ns).map(x => x._chaos);
  if (rows.some(Boolean)) {
    g.chaos = [];
    for (let i = 0; i < ns; i++) { const r = new Array(ns).fill(1); (rows[i] || []).forEach((v, j) => { if (j < ns) r[j] = v; }); g.chaos.push(r); }
  }
  for (const x of g.xforms) delete x._chaos;
  if (g._sym) addSymmetry(g, g._sym, new Rng(1));
  delete g._sym; delete g._xaos;
  if (g._colors) g.paletteIndex = g.paletteIndex >= 0 ? g.paletteIndex : -1;
  delete g._colors;
  if (!g.xforms.length) { const i = addStdXforms(g, 1); g.xforms[i].density = 1; }
}
