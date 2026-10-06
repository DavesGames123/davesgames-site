// ============================================================================
//  FRACTAL FLAMES  ·  variations.js — the CPU reference port of the flam3
//  variations, the chaos game, the bounding box and the probe renders
// ----------------------------------------------------------------------------
//  A port of flam3 by Scott Draves and the flam3 authors,
//  https://github.com/scottdraves/flam3 (flam3 is Copyright (C) 1992-2009
//  Spotworks LLC). This file ports variations.c (the 99 variations and
//  apply_xform), flam3.c (flam3_iterate, flam3_estimate_bounding_box),
//  rect.c (the log-density tone map, without density estimation), palettes.c
//  (flam3_calc_alpha, flam3_calc_newrgb, flam3_improve_colors) and the
//  random-genome loop of flam3-genome.c (framing and the image test).
//
//  SPDX-License-Identifier: GPL-3.0-or-later
//  This program is free software: you can redistribute it and/or modify it
//  under the terms of the GNU General Public License as published by the
//  Free Software Foundation, either version 3 of the License, or (at your
//  option) any later version. This program is distributed WITHOUT ANY
//  WARRANTY. See the file LICENSE in this directory.
//
//  The GPU renders the page (flame.wgsl). This module is the CPU side: the
//  quality gate for random genomes runs a short probe render here, and
//  tests.mjs compares single variations against flame.wgsl through it.
//  No DOM.
//
//  grep -n targets
//    one variation ........ "export function applyVar"
//    one xform ............ "export function applyXform"
//    chaos game ........... "export function iterate"
//    bounding box ......... "export function boundingBox"
//    probe render ......... "export function probeRender"
//    image test ........... "export function imageStats"
//    color improvement .... "export function improveColors"
//    random genome loop ... "export async function makeGenome"
// ============================================================================
import { VAR, NVARS, PI_, EPS, Rng, prepareGenome, flam3Random, truncateVariations, mutate, cross,
  copyGenome, randomPalette, numStd } from './genome.js';

const M_PI = Math.PI, M_1_PI = 1 / Math.PI, M_PI_2 = Math.PI / 2, M_PI_4 = Math.PI / 4, M_2_PI = 2 / Math.PI;
const bad = v => v !== v || v > 1e10 || v < -1e10;
const fmod = (a, b) => a - b * Math.trunc(a / b);
// rint: round half to even (glibc rint in the default rounding mode).
const rint = x => { const r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r; };
const P = PI_;

// f is the iteration helper (flam3_iter_helper): tx, ty and the precalc
// values. x is a prepared xform (genome.js prepareXform). rnd() is [0,1).
export function applyVar(id, f, w, x, rnd) {
  const p = x.P, tx = f.tx, ty = f.ty;
  switch (id) {
    case 0: f.p0 += w * tx; f.p1 += w * ty; break;                                       // linear
    case 1: f.p0 += w * Math.sin(tx); f.p1 += w * Math.sin(ty); break;                   // sinusoidal
    case 2: { const r2 = w / (f.sumsq + EPS); f.p0 += r2 * tx; f.p1 += r2 * ty; break; } // spherical
    case 3: { const r2 = f.sumsq, c1 = Math.sin(r2), c2 = Math.cos(r2);                  // swirl
      f.p0 += w * (c1 * tx - c2 * ty); f.p1 += w * (c2 * tx + c1 * ty); break; }
    case 4: { const r = w / (f.sqrt + EPS); f.p0 += (tx - ty) * (tx + ty) * r; f.p1 += 2 * tx * ty * r; break; } // horseshoe
    case 5: f.p0 += w * f.atan * M_1_PI; f.p1 += w * (f.sqrt - 1); break;                // polar
    case 6: { const a = f.atan, r = f.sqrt; f.p0 += w * r * Math.sin(a + r); f.p1 += w * r * Math.cos(a - r); break; } // handkerchief
    case 7: { const a = f.sqrt * f.atan, r = w * f.sqrt; f.p0 += r * Math.sin(a); f.p1 += -r * Math.cos(a); break; } // heart
    case 8: { const a = f.atan * M_1_PI, r = M_PI * f.sqrt; f.p0 += w * Math.sin(r) * a; f.p1 += w * Math.cos(r) * a; break; } // disc
    case 9: { const r = f.sqrt + EPS, r1 = w / r; f.p0 += r1 * (f.cosa + Math.sin(r)); f.p1 += r1 * (f.sina - Math.cos(r)); break; } // spiral
    case 10: { const r = f.sqrt + EPS; f.p0 += w * f.sina / r; f.p1 += w * f.cosa * r; break; } // hyperbolic
    case 11: { const r = f.sqrt; f.p0 += w * f.sina * Math.cos(r); f.p1 += w * f.cosa * Math.sin(r); break; } // diamond
    case 12: { const a = f.atan, r = f.sqrt, n0 = Math.sin(a + r), n1 = Math.cos(a - r);   // ex
      const m0 = n0 * n0 * n0 * r, m1 = n1 * n1 * n1 * r; f.p0 += w * (m0 + m1); f.p1 += w * (m0 - m1); break; }
    case 13: { let a = 0.5 * f.atan; if (rnd() < 0.5) a += M_PI;                          // julia
      const r = w * Math.sqrt(f.sqrt); f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 14: { let nx = tx, ny = ty; if (nx < 0) nx *= 2; if (ny < 0) ny /= 2; f.p0 += w * nx; f.p1 += w * ny; break; } // bent
    case 15: f.p0 += w * (tx + x.c[2] * Math.sin(ty * p[P.waves_dx2])); f.p1 += w * (ty + x.c[3] * Math.sin(tx * p[P.waves_dy2])); break; // waves
    case 16: { const r = 2 * w / (f.sqrt + 1); f.p0 += r * ty; f.p1 += r * tx; break; }     // fisheye
    case 17: f.p0 += w * (tx + x.c[4] * Math.sin(Math.tan(3 * ty))); f.p1 += w * (ty + x.c[5] * Math.sin(Math.tan(3 * tx))); break; // popcorn
    case 18: { const dx = w * Math.exp(tx - 1), dy = M_PI * ty; f.p0 += dx * Math.cos(dy); f.p1 += dx * Math.sin(dy); break; } // exponential
    case 19: { const r = w * Math.pow(f.sqrt, f.sina); f.p0 += r * f.cosa; f.p1 += r * f.sina; break; } // power
    case 20: { const a = tx * M_PI; f.p0 += w * Math.cos(a) * Math.cosh(ty); f.p1 += w * -Math.sin(a) * Math.sinh(ty); break; } // cosine
    case 21: { const dx = x.c[4] * x.c[4] + EPS, r0 = f.sqrt;                              // rings
      const r = w * (fmod(r0 + dx, 2 * dx) - dx + r0 * (1 - dx)); f.p0 += r * f.cosa; f.p1 += r * f.sina; break; }
    case 22: { const dx = M_PI * (x.c[4] * x.c[4] + EPS), dy = x.c[5], dx2 = 0.5 * dx;    // fan
      let a = f.atan; const r = w * f.sqrt; a += fmod(a + dy, dx) > dx2 ? -dx2 : dx2;
      f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 23: { const lo = p[P.blob_low], hi = p[P.blob_high];                                // blob
      const r = f.sqrt * (lo + (hi - lo) * (0.5 + 0.5 * Math.sin(p[P.blob_waves] * f.atan)));
      f.p0 += w * f.sina * r; f.p1 += w * f.cosa * r; break; }
    case 24: f.p0 += w * (Math.sin(p[P.pdj_a] * ty) - Math.cos(p[P.pdj_b] * tx));            // pdj
      f.p1 += w * (Math.sin(p[P.pdj_c] * tx) - Math.cos(p[P.pdj_d] * ty)); break;
    case 25: { const dy = p[P.fan2_y], dx = M_PI * (p[P.fan2_x] * p[P.fan2_x] + EPS), dx2 = 0.5 * dx; // fan2
      let a = f.atan; const r = w * f.sqrt, t = a + dy - dx * Math.trunc((a + dy) / dx);
      a = t > dx2 ? a - dx2 : a + dx2; f.p0 += r * Math.sin(a); f.p1 += r * Math.cos(a); break; }
    case 26: { let r = f.sqrt; const dx = p[P.rings2_val] * p[P.rings2_val] + EPS;          // rings2
      r += -2 * dx * Math.trunc((r + dx) / (2 * dx)) + r * (1 - dx); f.p0 += w * f.sina * r; f.p1 += w * f.cosa * r; break; }
    case 27: { const r = (w * 2) / (f.sqrt + 1); f.p0 += r * tx; f.p1 += r * ty; break; }    // eyefish
    case 28: { const r = w / (0.25 * f.sumsq + 1); f.p0 += r * tx; f.p1 += r * ty; break; }  // bubble
    case 29: f.p0 += w * Math.sin(tx); f.p1 += w * ty; break;                               // cylinder
    case 30: { const t = 1 / (p[P.perspective_dist] - ty * p[P.persp_vsin]);                 // perspective
      f.p0 += w * p[P.perspective_dist] * tx * t; f.p1 += w * p[P.persp_vfcos] * ty * t; break; }
    case 31: { const a = rnd() * 2 * M_PI, r = w * rnd(); f.p0 += tx * r * Math.cos(a); f.p1 += ty * r * Math.sin(a); break; } // noise
    case 32: { const tr = Math.trunc(p[P.julian_rN] * rnd());                                // julian
      const a = (f.atanyx + 2 * M_PI * tr) / p[P.julian_power], r = w * Math.pow(f.sumsq, p[P.julian_cn]);
      f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 33: { const tr = Math.trunc(p[P.juliascope_rN] * rnd());                            // juliascope
      const a = ((tr & 1) === 0 ? 2 * M_PI * tr + f.atanyx : 2 * M_PI * tr - f.atanyx) / p[P.juliascope_power];
      const r = w * Math.pow(f.sumsq, p[P.juliascope_cn]); f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 34: { const a = rnd() * 2 * M_PI, r = w * rnd(); f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; } // blur
    case 35: { const a = rnd() * 2 * M_PI, r = w * (rnd() + rnd() + rnd() + rnd() - 2);     // gaussian_blur
      f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 36: { const g = w * (rnd() + rnd() + rnd() + rnd() - 2), ra = f.sqrt;              // radial_blur
      const a = f.atanyx + p[P.radialBlur_spinvar] * g, rz = p[P.radialBlur_zoomvar] * g - 1;
      f.p0 += ra * Math.cos(a) + rz * tx; f.p1 += ra * Math.sin(a) + rz * ty; break; }
    case 37: { const sl = Math.trunc(rnd() * p[P.pie_slices] + 0.5);                         // pie
      const a = p[P.pie_rotation] + 2 * M_PI * (sl + rnd() * p[P.pie_thickness]) / p[P.pie_slices], r = w * rnd();
      f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 38: { const rf = Math.pow(f.sumsq, p[P.ngon_power] / 2), th = f.atanyx, b = 2 * M_PI / p[P.ngon_sides]; // ngon
      let phi = th - b * Math.floor(th / b); if (phi > b / 2) phi -= b;
      let amp = p[P.ngon_corners] * (1 / (Math.cos(phi) + EPS) - 1) + p[P.ngon_circle]; amp /= (rf + EPS);
      f.p0 += w * tx * amp; f.p1 += w * ty * amp; break; }
    case 39: { const c1 = p[P.curl_c1], c2 = p[P.curl_c2];                                   // curl
      const re = 1 + c1 * tx + c2 * (tx * tx - ty * ty), im = c1 * ty + 2 * c2 * tx * ty, r = w / (re * re + im * im);
      f.p0 += (tx * re + ty * im) * r; f.p1 += (ty * re - tx * im) * r; break; }
    case 40: { const rx = p[P.rectangles_x], ry = p[P.rectangles_y];                         // rectangles
      f.p0 += rx === 0 ? w * tx : w * ((2 * Math.floor(tx / rx) + 1) * rx - tx);
      f.p1 += ry === 0 ? w * ty : w * ((2 * Math.floor(ty / ry) + 1) * ry - ty); break; }
    case 41: { const a = rnd() * w * M_PI, s = Math.sin(a), c = Math.cos(a); f.p0 += w * s; f.p1 += w * (s * s) / c; break; } // arch
    case 42: f.p0 += w * Math.sin(tx) / Math.cos(ty); f.p1 += w * Math.tan(ty); break;       // tangent
    case 43: f.p0 += w * (rnd() - 0.5); f.p1 += w * (rnd() - 0.5); break;                   // square
    case 44: { const a = w * rnd() * M_PI, r = w / (f.sumsq + EPS), tr = w * Math.tan(a) * r; // rays
      f.p0 += tr * Math.cos(tx); f.p1 += tr * Math.sin(ty); break; }
    case 45: { const r = rnd() * w * f.sqrt, s = Math.sin(r), c = Math.cos(r);               // blade
      f.p0 += w * tx * (c + s); f.p1 += w * tx * (c - s); break; }
    case 46: { const r = w * f.sqrt, cr = Math.cos(r), icr = 1 / cr;                          // secant2
      f.p0 += w * tx; f.p1 += cr < 0 ? w * (icr + 1) : w * (icr - 1); break; }
    case 47: { const r = rnd() * w * f.sqrt, s = Math.sin(r), c = Math.cos(r);                // twintrian
      let diff = Math.log10(s * s) + c; if (bad(diff)) diff = -30;
      f.p0 += w * tx * diff; f.p1 += w * tx * (diff - s * M_PI); break; }
    case 48: { const s = tx * tx - ty * ty, r = w * Math.sqrt(1 / (s * s + EPS)); f.p0 += tx * r; f.p1 += ty * r; break; } // cross
    case 49: { const t = p[P.disc2_timespi] * (tx + ty), r = w * f.atan / M_PI;              // disc2
      f.p0 += (Math.sin(t) + p[P.disc2_cosadd]) * r; f.p1 += (Math.cos(t) + p[P.disc2_sinadd]) * r; break; }
    case 50: { const th = p[P.super_shape_pm_4] * f.atanyx + M_PI_4;                         // super_shape
      const t1 = Math.pow(Math.abs(Math.cos(th)), p[P.super_shape_n2]), t2 = Math.pow(Math.abs(Math.sin(th)), p[P.super_shape_n3]);
      const rr = p[P.super_shape_rnd];
      const r = w * ((rr * rnd() + (1 - rr) * f.sqrt) - p[P.super_shape_holes]) * Math.pow(t1 + t2, p[P.super_shape_pneg1_n1]) / f.sqrt;
      f.p0 += r * tx; f.p1 += r * ty; break; }
    case 51: { const r = w * (rnd() - p[P.flower_holes]) * Math.cos(p[P.flower_petals] * f.atanyx) / f.sqrt; // flower
      f.p0 += r * tx; f.p1 += r * ty; break; }
    case 52: { const ct = tx / f.sqrt, e = p[P.conic_eccentricity];                           // conic
      const r = w * (rnd() - p[P.conic_holes]) * e / (1 + e * ct) / f.sqrt; f.p0 += r * tx; f.p1 += r * ty; break; }
    case 53: { const r = f.sqrt, s = Math.sin(r), c = Math.cos(r);                            // parabola
      f.p0 += p[P.parabola_height] * w * s * s * rnd(); f.p1 += p[P.parabola_width] * w * c * rnd(); break; }
    case 54: { let nx = tx, ny = ty; if (nx < 0) nx *= p[P.bent2_x]; if (ny < 0) ny *= p[P.bent2_y]; // bent2
      f.p0 += w * nx; f.p1 += w * ny; break; }
    case 55: { const x2y2 = f.sumsq, t = x2y2 + 1, x2 = 2 * tx, ps = -M_PI_2 * p[P.bipolar_shift]; // bipolar
      let y = 0.5 * Math.atan2(2 * ty, x2y2 - 1) + ps;
      if (y > M_PI_2) y = -M_PI_2 + fmod(y + M_PI_2, M_PI); else if (y < -M_PI_2) y = M_PI_2 - fmod(M_PI_2 - y, M_PI);
      f.p0 += w * 0.25 * M_2_PI * Math.log((t + x2) / (t - x2)); f.p1 += w * M_2_PI * y; break; }
    case 56: { const rx = rint(tx), ry = rint(ty), ox = tx - rx, oy = ty - ry;               // boarders
      if (rnd() >= 0.75) { f.p0 += w * (ox * 0.5 + rx); f.p1 += w * (oy * 0.5 + ry); }
      else if (Math.abs(ox) >= Math.abs(oy)) {
        if (ox >= 0) { f.p0 += w * (ox * 0.5 + rx + 0.25); f.p1 += w * (oy * 0.5 + ry + 0.25 * oy / ox); }
        else { f.p0 += w * (ox * 0.5 + rx - 0.25); f.p1 += w * (oy * 0.5 + ry - 0.25 * oy / ox); }
      } else {
        if (oy >= 0) { f.p1 += w * (oy * 0.5 + ry + 0.25); f.p0 += w * (ox * 0.5 + rx + ox / oy * 0.25); }
        else { f.p1 += w * (oy * 0.5 + ry - 0.25); f.p0 += w * (ox * 0.5 + rx - ox / oy * 0.25); }
      }
      break; }
    case 57: { const wx = w * 1.3029400317411197908970256609023, y2 = ty * 2;                 // butterfly
      const r = wx * Math.sqrt(Math.abs(ty * tx) / (EPS + tx * tx + y2 * y2)); f.p0 += r * tx; f.p1 += r * y2; break; }
    case 58: { const cs = p[P.cell_size], inv = 1 / cs;                                       // cell
      let X = Math.floor(tx * inv), Y = Math.floor(ty * inv); const dx = tx - X * cs, dy = ty - Y * cs;
      if (Y >= 0) { if (X >= 0) { Y *= 2; X *= 2; } else { Y *= 2; X = -(2 * X + 1); } }
      else { if (X >= 0) { Y = -(2 * Y + 1); X *= 2; } else { Y = -(2 * Y + 1); X = -(2 * X + 1); } }
      f.p0 += w * (dx + X * cs); f.p1 -= w * (dy + Y * cs); break; }
    case 59: { const a = f.atanyx, lnr = 0.5 * Math.log(f.sumsq), pw = p[P.cpow_power];       // cpow
      const va = 2 * M_PI / pw, vc = p[P.cpow_r] / pw, vd = p[P.cpow_i] / pw;
      const ang = vc * a + vd * lnr + va * Math.floor(pw * rnd()), m = w * Math.exp(vc * lnr - vd * a);
      f.p0 += m * Math.cos(ang); f.p1 += m * Math.sin(ang); break; }
    case 60: { let xl = p[P.curve_xlength] * p[P.curve_xlength], yl = p[P.curve_ylength] * p[P.curve_ylength]; // curve
      if (xl < 1e-20) xl = 1e-20; if (yl < 1e-20) yl = 1e-20;
      f.p0 += w * (tx + p[P.curve_xamp] * Math.exp(-ty * ty / xl)); f.p1 += w * (ty + p[P.curve_yamp] * Math.exp(-tx * tx / yl)); break; }
    case 61: { const tmp = f.sumsq + 1, tmp2 = 2 * tx, r1 = Math.sqrt(tmp + tmp2), r2 = Math.sqrt(tmp - tmp2); // edisc
      const xmax = (r1 + r2) * 0.5, a1 = Math.log(xmax + Math.sqrt(xmax - 1)), a2 = -Math.acos(tx / xmax), ww = w / 11.57034632;
      let snv = Math.sin(a1); const csv = Math.cos(a1), snhu = Math.sinh(a2), cshu = Math.cosh(a2);
      if (ty > 0) snv = -snv; f.p0 += ww * cshu * csv; f.p1 += ww * snhu * snv; break; }
    case 62: { const tmp = f.sumsq + 1, x2 = 2 * tx, xmax = 0.5 * (Math.sqrt(tmp + x2) + Math.sqrt(tmp - x2)); // elliptic
      const a = tx / xmax; let b = 1 - a * a, ssx = xmax - 1; const ww = w / M_PI_2;
      b = b < 0 ? 0 : Math.sqrt(b); ssx = ssx < 0 ? 0 : Math.sqrt(ssx);
      f.p0 += ww * Math.atan2(a, b); if (ty > 0) f.p1 += ww * Math.log(xmax + ssx); else f.p1 -= ww * Math.log(xmax + ssx); break; }
    case 63: { const a = f.atanyx, lnr = 0.5 * Math.log(f.sumsq), be = p[P.escher_beta];      // escher
      const vc = 0.5 * (1 + Math.cos(be)), vd = 0.5 * Math.sin(be), m = w * Math.exp(vc * lnr - vd * a), n = vc * a + vd * lnr;
      f.p0 += m * Math.cos(n); f.p1 += m * Math.sin(n); break; }
    case 64: { const ex = Math.exp(tx) * 0.5, enx = 0.25 / ex, t = w / (ex + enx - Math.cos(ty)); // foci
      f.p0 += t * (ex - enx); f.p1 += t * Math.sin(ty); break; }
    case 65: { const lx = p[P.lazysusan_x], ly = p[P.lazysusan_y], X = tx - lx, Y = ty + ly;  // lazysusan
      let r = Math.sqrt(X * X + Y * Y);
      if (r < w) { const a = Math.atan2(Y, X) + p[P.lazysusan_spin] + p[P.lazysusan_twist] * (w - r); r = w * r;
        f.p0 += r * Math.cos(a) + lx; f.p1 += r * Math.sin(a) - ly; }
      else { r = w * (1 + p[P.lazysusan_space] / r); f.p0 += r * X + lx; f.p1 += r * Y - ly; }
      break; }
    case 66: { const r2 = f.sumsq, w2 = w * w;                                                // loonie
      if (r2 < w2) { const r = w * Math.sqrt(w2 / r2 - 1); f.p0 += r * tx; f.p1 += r * ty; } else { f.p0 += w * tx; f.p1 += w * ty; }
      break; }
    case 67: break;                                                                           // pre_blur (see applyXform)
    case 68: { const mx = p[P.modulus_x], my = p[P.modulus_y], xr = 2 * mx, yr = 2 * my;      // modulus
      if (tx > mx) f.p0 += w * (-mx + fmod(tx + mx, xr)); else if (tx < -mx) f.p0 += w * (mx - fmod(mx - tx, xr)); else f.p0 += w * tx;
      if (ty > my) f.p1 += w * (-my + fmod(ty + my, yr)); else if (ty < -my) f.p1 += w * (my - fmod(my - ty, yr)); else f.p1 += w * ty;
      break; }
    case 69: { const tpf = 2 * M_PI * p[P.oscilloscope_frequency], dmp = p[P.oscilloscope_damping]; // oscilloscope
      const t = dmp === 0 ? p[P.oscilloscope_amplitude] * Math.cos(tpf * tx) + p[P.oscilloscope_separation]
        : p[P.oscilloscope_amplitude] * Math.exp(-Math.abs(tx) * dmp) * Math.cos(tpf * tx) + p[P.oscilloscope_separation];
      f.p0 += w * tx; if (Math.abs(ty) <= t) f.p1 -= w * ty; else f.p1 += w * ty; break; }
    case 70: { const v = w / M_PI; f.p0 += v * f.atan; f.p1 += v / 2 * Math.log(f.sumsq); break; } // polar2
    case 71: { const c = p[P.popcorn2_c];                                                      // popcorn2
      f.p0 += w * (tx + p[P.popcorn2_x] * Math.sin(Math.tan(ty * c))); f.p1 += w * (ty + p[P.popcorn2_y] * Math.sin(Math.tan(tx * c))); break; }
    case 72: { const r = 1 / (f.sqrt * (f.sumsq + 1 / (w + EPS))); f.p0 += tx * r; f.p1 += ty * r; break; } // scry
    case 73: { const sx2 = p[P.separation_x] ** 2, sy2 = p[P.separation_y] ** 2;               // separation
      if (tx > 0) f.p0 += w * (Math.sqrt(tx * tx + sx2) - tx * p[P.separation_xinside]); else f.p0 -= w * (Math.sqrt(tx * tx + sx2) + tx * p[P.separation_xinside]);
      if (ty > 0) f.p1 += w * (Math.sqrt(ty * ty + sy2) - ty * p[P.separation_yinside]); else f.p1 -= w * (Math.sqrt(ty * ty + sy2) + ty * p[P.separation_yinside]);
      break; }
    case 74: if (Math.cos(tx * p[P.split_xsize] * M_PI) >= 0) f.p1 += w * ty; else f.p1 -= w * ty;  // split
      if (Math.cos(ty * p[P.split_ysize] * M_PI) >= 0) f.p0 += w * tx; else f.p0 -= w * tx; break;
    case 75: f.p0 += tx >= 0 ? w * (tx + p[P.splits_x]) : w * (tx - p[P.splits_x]);          // splits
      f.p1 += ty >= 0 ? w * (ty + p[P.splits_y]) : w * (ty - p[P.splits_y]); break;
    case 76: { const rx = Math.floor(tx + 0.5), ox = tx - rx;                                  // stripes
      f.p0 += w * (ox * (1 - p[P.stripes_space]) + rx); f.p1 += w * (ty + ox * ox * p[P.stripes_warp]); break; }
    case 77: { let r = f.sqrt, a = f.atanyx + p[P.wedge_swirl] * r;                            // wedge
      const c = Math.floor((p[P.wedge_count] * a + M_PI) * M_1_PI * 0.5), cf = 1 - p[P.wedge_angle] * p[P.wedge_count] * M_1_PI * 0.5;
      a = a * cf + c * p[P.wedge_angle]; r = w * (r + p[P.wedge_hole]); f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 78: { const r = w * Math.pow(f.sumsq, p[P.wedgeJulia_cn]), tr = Math.trunc(p[P.wedgeJulia_rN] * rnd()); // wedge_julia
      let a = (f.atanyx + 2 * M_PI * tr) / p[P.wedge_julia_power];
      const c = Math.floor((p[P.wedge_julia_count] * a + M_PI) * M_1_PI * 0.5);
      a = a * p[P.wedgeJulia_cf] + c * p[P.wedge_julia_angle]; f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 79: { let r = 1 / (f.sqrt + EPS), a = f.atanyx + p[P.wedge_sph_swirl] * r;            // wedge_sph
      const c = Math.floor((p[P.wedge_sph_count] * a + M_PI) * M_1_PI * 0.5), cf = 1 - p[P.wedge_sph_angle] * p[P.wedge_sph_count] * M_1_PI * 0.5;
      a = a * cf + c * p[P.wedge_sph_angle]; r = w * (r + p[P.wedge_sph_hole]); f.p0 += r * Math.cos(a); f.p1 += r * Math.sin(a); break; }
    case 80: { const r = f.sqrt;                                                               // whorl
      const a = r < w ? f.atanyx + p[P.whorl_inside] / (w - r) : f.atanyx + p[P.whorl_outside] / (w - r);
      f.p0 += w * r * Math.cos(a); f.p1 += w * r * Math.sin(a); break; }
    case 81: f.p0 += w * (tx + p[P.waves2_scalex] * Math.sin(ty * p[P.waves2_freqx]));       // waves2
      f.p1 += w * (ty + p[P.waves2_scaley] * Math.sin(tx * p[P.waves2_freqy])); break;
    case 82: { const e = Math.exp(tx); f.p0 += w * e * Math.cos(ty); f.p1 += w * e * Math.sin(ty); break; } // exp
    case 83: f.p0 += w * 0.5 * Math.log(f.sumsq); f.p1 += w * f.atanyx; break;               // log
    case 84: f.p0 += w * Math.sin(tx) * Math.cosh(ty); f.p1 += w * Math.cos(tx) * Math.sinh(ty); break; // sin
    case 85: f.p0 += w * Math.cos(tx) * Math.cosh(ty); f.p1 -= w * Math.sin(tx) * Math.sinh(ty); break; // cos
    case 86: { const d = 1 / (Math.cos(2 * tx) + Math.cosh(2 * ty)); f.p0 += w * d * Math.sin(2 * tx); f.p1 += w * d * Math.sinh(2 * ty); break; } // tan
    case 87: { const d = 2 / (Math.cos(2 * tx) + Math.cosh(2 * ty));                            // sec
      f.p0 += w * d * Math.cos(tx) * Math.cosh(ty); f.p1 += w * d * Math.sin(tx) * Math.sinh(ty); break; }
    case 88: { const d = 2 / (Math.cosh(2 * ty) - Math.cos(2 * tx));                            // csc
      f.p0 += w * d * Math.sin(tx) * Math.cosh(ty); f.p1 -= w * d * Math.cos(tx) * Math.sinh(ty); break; }
    case 89: { const d = 1 / (Math.cosh(2 * ty) - Math.cos(2 * tx));                            // cot
      f.p0 += w * d * Math.sin(2 * tx); f.p1 += w * d * -1 * Math.sinh(2 * ty); break; }
    case 90: f.p0 += w * Math.sinh(tx) * Math.cos(ty); f.p1 += w * Math.cosh(tx) * Math.sin(ty); break; // sinh
    case 91: f.p0 += w * Math.cosh(tx) * Math.cos(ty); f.p1 += w * Math.sinh(tx) * Math.sin(ty); break; // cosh
    case 92: { const d = 1 / (Math.cos(2 * ty) + Math.cosh(2 * tx)); f.p0 += w * d * Math.sinh(2 * tx); f.p1 += w * d * Math.sin(2 * ty); break; } // tanh
    case 93: { const d = 2 / (Math.cos(2 * ty) + Math.cosh(2 * tx));                            // sech
      f.p0 += w * d * Math.cos(ty) * Math.cosh(tx); f.p1 -= w * d * Math.sin(ty) * Math.sinh(tx); break; }
    case 94: { const d = 2 / (Math.cosh(2 * tx) - Math.cos(2 * ty));                            // csch
      f.p0 += w * d * Math.sinh(tx) * Math.cos(ty); f.p1 -= w * d * Math.cosh(tx) * Math.sin(ty); break; }
    case 95: { const d = 1 / (Math.cosh(2 * tx) - Math.cos(2 * ty)); f.p0 += w * d * Math.sinh(2 * tx); f.p1 += w * d * Math.sin(2 * ty); break; } // coth
    case 96: { const fr = p[P.auger_freq], aw = p[P.auger_weight], sc = p[P.auger_scale];        // auger
      const s = Math.sin(fr * tx), t = Math.sin(fr * ty);
      const dy = ty + aw * (sc * s / 2 + Math.abs(ty) * s), dx = tx + aw * (sc * t / 2 + Math.abs(tx) * t);
      f.p0 += w * (tx + p[P.auger_sym] * (dx - tx)); f.p1 += w * dy; break; }
    case 97: { const xpw = tx + w, xmw = tx - w;                                               // flux
      const avgr = w * (2 + p[P.flux_spread]) * Math.sqrt(Math.sqrt(ty * ty + xpw * xpw) / Math.sqrt(ty * ty + xmw * xmw));
      const avga = (Math.atan2(ty, xmw) - Math.atan2(ty, xpw)) * 0.5; f.p0 += avgr * Math.cos(avga); f.p1 += avgr * Math.sin(avga); break; }
    case 98: { const ra = p[P.mobius_re_a], ia = p[P.mobius_im_a], rb = p[P.mobius_re_b], ib = p[P.mobius_im_b]; // mobius
      const rc = p[P.mobius_re_c], ic = p[P.mobius_im_c], rd = p[P.mobius_re_d], id_ = p[P.mobius_im_d];
      const reU = ra * tx - ia * ty + rb, imU = ra * ty + ia * tx + ib, reV = rc * tx - ic * ty + rd, imV = rc * ty + ic * tx + id_;
      const rv = w / (reV * reV + imV * imV); f.p0 += rv * (reU * reV + imU * imV); f.p1 += rv * (imU * reV - reU * imV); break; }
  }
}

// apply_xform: q = F(p). p and q are [x, y, color, visibility]. Returns
// true for a bad value (then q is a random point in [-1, 1]^2, as in flam3).
const F = { tx: 0, ty: 0, sumsq: 0, sqrt: 0, atan: 0, sina: 0, cosa: 0, atanyx: 0, p0: 0, p1: 0 };
export function applyXform(x, p, q, rnd) {
  const s1 = x.colorSpeed;
  q[2] = s1 * x.color + (1 - s1) * p[2];
  q[3] = x.vis;
  const c = x.c;
  F.tx = c[0] * p[0] + c[2] * p[1] + c[4];
  F.ty = c[1] * p[0] + c[3] * p[1] + c[5];
  if (x.preblur !== 0) {
    const g = x.preblur * (rnd() + rnd() + rnd() + rnd() - 2), a = rnd() * 2 * M_PI;
    F.tx += g * Math.cos(a); F.ty += g * Math.sin(a);
  }
  F.sumsq = F.tx * F.tx + F.ty * F.ty; F.sqrt = Math.sqrt(F.sumsq);
  F.atan = Math.atan2(F.tx, F.ty);
  F.sina = F.tx / F.sqrt; F.cosa = F.ty / F.sqrt;
  F.atanyx = Math.atan2(F.ty, F.tx);
  F.p0 = 0; F.p1 = 0;
  for (let k = 0; k < x.vars.length; k++) applyVar(x.vars[k], F, x.ws[k], x, rnd);
  if (x.hasPost) {
    const m = x.post;
    q[0] = m[0] * F.p0 + m[2] * F.p1 + m[4];
    q[1] = m[1] * F.p0 + m[3] * F.p1 + m[5];
  } else { q[0] = F.p0; q[1] = F.p1; }
  if (bad(q[0]) || bad(q[1])) { q[0] = rnd() * 2 - 1; q[1] = rnd() * 2 - 1; return true; }
  return false;
}

// flam3_iterate: run the function system n steps after fuse warm-up steps.
// emit(x, y, color, vis) gets each point. Returns the bad-value count.
export function iterate(pg, n, fuse, rng, emit, start) {
  const rnd = () => rng.r01();
  const p = start ? start.slice() : [rng.r11(), rng.r11(), 0, 0], q = [0, 0, 0, 0];
  const G = 1024, grain = pg.dist.length / pg.rows;
  let lastxf = 0, consec = 0, badvals = 0;
  const fin = pg.finalIndex >= 0 ? pg.xf[pg.finalIndex] : null;
  for (let i = -fuse; i < n; i++) {
    const row = pg.chaosOn ? lastxf : 0;
    const fn = pg.dist[row * grain + (rng.u32() & (grain - 1))];
    if (applyXform(pg.xf[fn], p, q, rnd)) {
      consec++; badvals++;
      if (consec < 5) { p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; p[3] = q[3]; i--; continue; }
      consec = 0;
    } else consec = 0;
    lastxf = fn + 1;
    p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; p[3] = q[3];
    if (fin && (fin.opacity === 1 || rnd() < fin.opacity)) {
      applyXform(fin, p, q, rnd);
      q[3] = p[3];
    }
    if (i >= 0) emit(q[0], q[1], q[2], q[3]);
  }
  void G;
  return badvals;
}

// flam3_estimate_bounding_box: the box that holds all but eps of the points
// on each axis.
export function boundingBox(g, eps = 0.01, n = 100000, rng = new Rng(7)) {
  const pg = prepareGenome(g);
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let k = 0;
  const bv = iterate(pg, n, 20, rng, (x, y) => { xs[k] = x; ys[k] = y; k++; });
  if (bv / n > eps) eps = 3 * bv / n;
  if (eps > 0.3) eps = 0.3;
  const lo = Math.floor(n * eps), hi = n - lo;
  if (lo === 0) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]); }
    return { min: [x0, y0], max: [x1, y1], bad: bv };
  }
  xs.sort(); ys.sort();
  return { min: [xs[lo], ys[lo]], max: [xs[Math.min(hi, n - 1)], ys[Math.min(hi, n - 1)]], bad: bv };
}

// ── tone map (rect.c, palettes.c) ──────────────────────────────────────────
export function calcAlpha(density, gamma, linrange) {
  const funcval = Math.pow(linrange, gamma);
  if (density > 0) {
    if (density < linrange) { const frac = density / linrange; return (1 - frac) * density * (funcval / linrange) + frac * Math.pow(density, gamma); }
    return Math.pow(density, gamma);
  }
  return 0;
}
// cbuf in flam3 accumulator units (PREFILTER_WHITE 255). Returns rgb 0..255+.
export function calcNewRgb(cbuf, ls, highpow) {
  if (ls === 0 || (cbuf[0] === 0 && cbuf[1] === 0 && cbuf[2] === 0)) return [0, 0, 0];
  let maxa = -1, maxc = 0;
  for (let i = 0; i < 3; i++) { const a = ls * (cbuf[i] / 255); if (a > maxa) { maxa = a; maxc = cbuf[i] / 255; } }
  const out = [0, 0, 0];
  if (maxa > 255 && highpow >= 0) {
    const newls = 255 / maxc, lsratio = Math.pow(newls / ls, highpow);
    for (let i = 0; i < 3; i++) out[i] = newls * (cbuf[i] / 255) / 255;
    const hsv = rgbToHsv(out); hsv[1] *= lsratio; const o = hsvToRgb(hsv);
    return [o[0] * 255, o[1] * 255, o[2] * 255];
  }
  const newls = 255 / maxc;
  let adj = -highpow; if (adj > 1) adj = 1; if (maxa <= 255) adj = 1;
  for (let i = 0; i < 3; i++) out[i] = ((1 - adj) * newls + adj * ls) * (cbuf[i] / 255);
  return out;
}
function rgbToHsv(c) {
  const [r, g, b] = c, max = Math.max(r, g, b), min = Math.min(r, g, b), del = max - min, s = max !== 0 ? del / max : 0;
  let h = 0;
  if (s !== 0) { const rc = (max - r) / del, gc = (max - g) / del, bc = (max - b) / del; h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc; if (h < 0) h += 6; }
  return [h, s, max];
}
function hsvToRgb([h, s, v]) {
  while (h >= 6) h -= 6; while (h < 0) h += 6;
  const j = Math.floor(h), f = h - j, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][j] || [v, t, p];
}

// A small CPU render with flam3's math and no density estimation (the
// probe settings of flam3-genome: estimator 0, oversample 1). cam: { w, h,
// center, ppu, rotate }. Returns { rgb: Uint8ClampedArray(w*h*3), hist }.
export function probeRender(g, cam, quality, rng = new Rng(11)) {
  const { w, h } = cam, pg = prepareGenome(g);
  const hist = new Float64Array(w * h * 4);
  const ppu = cam.ppu, cx = cam.center[0], cy = cam.center[1];
  const th = (cam.rotate || 0) * 2 * Math.PI / 360, r00 = Math.cos(th), r01 = -Math.sin(th), r10 = -r01, r11 = r00;
  const n = Math.max(1, Math.round(quality * w * h));
  const pal = g.palette;
  iterate(pg, n, 20, rng, (x, y, c, vis) => {
    if (vis === 0) return;
    const dx = x - cx, dy = y - cy;
    const px = Math.floor(w / 2 + ppu * (r00 * dx + r01 * dy)), py = Math.floor(h / 2 + ppu * (r10 * dx + r11 * dy));
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    let ci = Math.trunc(c * 256); if (ci < 0) ci = 0; if (ci > 255) ci = 255;
    const o = (py * w + px) * 4;
    hist[o] += pal[ci * 3] * vis; hist[o + 1] += pal[ci * 3 + 1] * vis; hist[o + 2] += pal[ci * 3 + 2] * vis; hist[o + 3] += vis;
  });
  return { rgb: toneMap(g, hist, w, h, ppu, n), hist };
}
// rect.c from the bucket to the 8-bit image, oversample 1, the gaussian
// spatial filter of radius g.filter.
export function toneMap(g, hist, w, h, ppu, nsamples) {
  const k1 = g.contrast * g.brightness * 255 * 268 / 256;
  const k2 = ppu * ppu / (g.contrast * nsamples);
  const acc = new Float64Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const n = hist[i * 4 + 3]; if (n <= 0) continue;
    const ls = k1 * Math.log(1 + n * k2) / n;
    for (let k = 0; k < 4; k++) acc[i * 4 + k] = hist[i * 4 + k] * ls;
  }
  const filt = spatialFilter(g.filter), fw = filt.width, half = (fw - 1) / 2;
  const gam = 1 / g.gamma, lin = g.gamLin, vib = g.vibrancy, hp = g.highlight, out = new Uint8ClampedArray(w * h * 3);
  const t = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    t[0] = t[1] = t[2] = t[3] = 0;
    for (let j = 0; j < fw; j++) for (let i = 0; i < fw; i++) {
      const xx = x + i - half, yy = y + j - half;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = filt.k[i + j * fw], o = (yy * w + xx) * 4;
      t[0] += k * acc[o]; t[1] += k * acc[o + 1]; t[2] += k * acc[o + 2]; t[3] += k * acc[o + 3];
    }
    const px = tonePixel(t, gam, lin, vib, hp, g.background);
    const o = (y * w + x) * 3; out[o] = px[0]; out[o + 1] = px[1]; out[o + 2] = px[2];
  }
  return out;
}
export function tonePixel(t, gam, lin, vib, hp, bg) {
  let alpha = 0, ls = 0;
  if (t[3] > 0) {
    const tmp = t[3] / 255;
    alpha = calcAlpha(tmp, gam, lin); ls = vib * 256 * alpha / tmp;
    if (alpha < 0) alpha = 0; if (alpha > 1) alpha = 1;
  }
  const nr = calcNewRgb(t, ls, hp), o = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let a = nr[i] + (1 - vib) * 256 * Math.pow(Math.max(0, t[i]) / 255, gam) + (1 - alpha) * bg[i] * 256;
    o[i] = a > 255 ? 255 : a < 0 ? 0 : a;
  }
  return o;
}
// flam3_create_spatial_filter, gaussian kernel, oversample 1, aspect 1.
export function spatialFilter(radius) {
  const supp = 1.5, fw = 2 * supp * 1 * radius;
  let width = Math.trunc(fw) + 1;
  if ((width ^ 1) & 1) width++;
  const adjust = fw > 0 ? supp * width / fw : 1;
  const k = new Float64Array(width * width);
  const gauss = x => Math.exp(-2 * x * x) * Math.sqrt(2 / Math.PI);
  let s = 0;
  for (let i = 0; i < width; i++) for (let j = 0; j < width; j++) {
    const ii = ((2 * i + 1) / width - 1) * adjust, jj = ((2 * j + 1) / width - 1) * adjust;
    k[i + j * width] = gauss(ii) * gauss(jj); s += k[i + j * width];
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { width, k };
}

// The image test of flam3-genome: avg_pix, fraction_black, fraction_white,
// plus the lit fraction (coverage) that the page gate adds.
export function imageStats(rgb) {
  const n = rgb.length / 3;
  let tot = 0, black = 0, white = 0, lit = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const a = rgb[i], b = rgb[i + 1], c = rgb[i + 2];
    tot += a + b + c;
    if (a === 0 && b === 0 && c === 0) black++;
    if (a === 255 && b === 255 && c === 255) white++;
    if (a + b + c > 24) lit++;
  }
  return { avg: tot / (3 * n), black: black / n, white: white / n, lit: lit / n };
}

// try_colors + flam3_improve_colors (palettes.c). flam3 returns
// (double)(hits / res3) with integer division, which is 0 for all but a
// full cube, so its search never keeps a change. This port divides in
// floating point, the evident intent.
export function tryColors(g, res = 10, rng = new Rng(3)) {
  const scalar = Math.sqrt(10000 / (g.width * g.height));
  const w = Math.max(8, Math.round(g.width * scalar)), h = Math.max(8, Math.round(g.height * scalar));
  const ppu = g.ppu * Math.pow(2, g.zoom) * scalar;
  const { rgb } = probeRender(g, { w, h, center: g.center, ppu, rotate: g.rotate }, 1, rng);
  const seen = new Uint8Array(res * res * res);
  let hits = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const k = Math.floor(rgb[i] * res / 256) + Math.floor(rgb[i + 1] * res / 256) * res + Math.floor(rgb[i + 2] * res / 256) * res * res;
    if (!seen[k]) { seen[k] = 1; hits++; }
  }
  return hits / (res * res * res);
}
export function improveColors(g, ntries, changePalette, res, rng, lib) {
  let best = tryColors(g, res, rng), bestG = copyGenome(g);
  for (let i = 0; i < ntries; i++) {
    if (changePalette && lib) { const p = randomPalette(lib, rng, 0); g.hue = 0; g.paletteIndex = p.index; g.palette = p.palette; }
    for (const x of g.xforms) x.color = rng.r01();
    const pick = ex => { for (let t = 0; t < 100; t++) { const i = rng.int(g.xforms.length); if (g.xforms[i].density > 0 && i !== ex) return i; } return -1; };
    const x0 = pick(-1), x1 = pick(x0);
    if (x0 >= 0 && rng.bit()) g.xforms[x0].color = 0;
    if (x1 >= 0 && rng.bit()) g.xforms[x1].color = 1;
    const b = tryColors(g, res, rng);
    if (b > best) { best = b; bestG = copyGenome(g); }
  }
  Object.assign(g, bestG);
  return best;
}

// Frame a genome as flam3-genome does after a random or a mutation: the
// bounding box sets the scale (x extent to the image width), and the
// centre goes to the box centre (30%) or a golden-section point.
export function reframe(g, rng) {
  const bb = boundingBox(g, 0.01, 100000, rng);
  if (!(bb.max[0] > bb.min[0]) || !isFinite(bb.max[0] - bb.min[0])) return false;
  const golden = () => (rng.bit() ? 0.38196 : 0.61804);
  if (rng.r01() < 0.3) g.center = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2];
  else {
    let m0, m1;
    if (rng.bit()) { m0 = golden() + rng.r11() / 5; m1 = golden(); }
    else if (rng.bit()) { m0 = golden(); m1 = golden() + rng.r11() / 5; }
    else { m0 = golden() + rng.r11() / 5; m1 = golden() + rng.r11() / 5; }
    g.center = [m0 * bb.min[0] + (1 - m0) * bb.max[0], m1 * bb.min[1] + (1 - m1) * bb.max[1]];
  }
  g.ppu = g.width / (bb.max[0] - bb.min[0]);
  g.zoom = 0;
  return isFinite(g.ppu) && g.ppu > 0;
}
// Centre the box and fit both axes (used by the screensaver, where the
// frame must hold the whole flame).
export function fitFrame(g, rng, margin = 1.08) {
  const bb = boundingBox(g, 0.01, 40000, rng);
  const wx = bb.max[0] - bb.min[0], wy = bb.max[1] - bb.min[1];
  if (!(wx > 0 && wy > 0) || !isFinite(wx + wy)) return false;
  g.center = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2];
  g.ppu = Math.min(g.width / wx, g.height / wy) / margin;
  g.zoom = 0;
  return isFinite(g.ppu) && g.ppu > 0;
}

// The test render of flam3-genome (test_cp: 128x128, scale 64 at the
// origin, quality 1) and the thresholds avg 20, black 0.01, white 0.05.
// The page adds a framed probe in the genome's own camera: lit >= minLit
// and white <= maxWhite, so a flame that is a speck or a white-out fails.
export function gate(g, opts = {}, rng = new Rng(5)) {
  const t = probeRender(g, { w: 128, h: 128, center: [0, 0], ppu: 64, rotate: 0 }, 1, rng);
  const s = imageStats(t.rgb);
  const okFlam3 = !(s.avg < 20 || s.black < 0.01 || s.white > 0.05);
  const fw = 96, fh = Math.max(32, Math.round(96 * g.height / g.width));
  const sc = fw / g.width;
  const f = probeRender(g, { w: fw, h: fh, center: g.center, ppu: g.ppu * Math.pow(2, g.zoom) * sc, rotate: g.rotate }, opts.quality || 6, rng);
  const fs = imageStats(f.rgb);
  const okFrame = fs.lit >= (opts.minLit || 0.06) && fs.white <= (opts.maxWhite || 0.08) && fs.lit <= (opts.maxLit || 0.985);
  return { ok: (opts.flam3Test === false || okFlam3) && okFrame, flam3: s, frame: fs };
}

// The random-genome loop of flam3-genome (random, mutate or cross), with
// up to `tries` attempts until the gate passes. kind: 'random' | 'mutate'
// | 'cross'. base, other: the parents. It yields to the event loop between
// attempts so the page keeps drawing. Returns { genome, tries, gate }.
export async function makeGenome(kind, rng, opts = {}) {
  const tries = opts.tries || 10, lib = opts.lib;
  let best = null;
  for (let n = 1; n <= tries; n++) {
    let g, action, didColor = false;
    if (kind === 'mutate' && opts.base) {
      g = copyGenome(opts.base);
      action = mutate(g, opts.mode || null, rng, { lib, ivars: opts.ivars, weights: opts.weights, maxSym: opts.maxSym,
        improveColors: (gg, nt, cp, res, r) => improveColors(gg, Math.min(nt, 30), cp, res, r, lib) });
      didColor = /color/.test(action);
    } else if (kind === 'cross' && opts.base && opts.other) {
      g = cross(opts.base, opts.other, opts.mode || null, rng); action = g.action; delete g.action;
    } else {
      g = flam3Random(rng, { lib, ivars: opts.ivars, weights: opts.weights, sym: opts.sym || 0, maxSym: opts.maxSym });
      action = 'random';
    }
    g.width = opts.width || g.width; g.height = opts.height || g.height;
    for (const k of ['quality', 'brightness', 'gamma', 'vibrancy', 'highlight', 'gamLin', 'estimator', 'estCurve', 'estMin', 'contrast'])
      if (opts.render && opts.render[k] != null) g[k] = opts.render[k];
    if (kind === 'random' || rng.bit()) {
      const ok = opts.fit ? fitFrame(g, rng) : reframe(g, rng);
      if (!ok) continue;
    }
    truncateVariations(g, 5);
    if (!didColor && (rng.u32() & 1)) improveColors(g, opts.colorTries || 20, false, 10, rng, lib);
    const gt = gate(g, opts.gate || {}, rng);
    g.action = action;
    if (!best || score(gt) > score(best.gate)) best = { genome: g, tries: n, gate: gt };
    if (gt.ok) return { genome: g, tries: n, gate: gt };
    if (opts.yield !== false) await new Promise(r => setTimeout(r, 0));
  }
  return best || { genome: flam3Random(rng, { lib }), tries, gate: null };
}
const score = s => (s ? (s.ok ? 10 : 0) + Math.min(s.frame.lit, 0.5) - s.frame.white : -1);
void numStd; void NVARS; void VAR;
