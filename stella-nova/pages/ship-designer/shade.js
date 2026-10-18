// ============================================================================
//  SHIP DESIGNER  ·  shade.js — one sun on the painted ship (no DOM)
// ----------------------------------------------------------------------------
//  Pure functions on pixel arrays. main.js calls them through window.SDShade
//  and caches the results in canvases. tests.mjs and the node thumbnail call
//  them through require(). This file has no game code. It makes the look of
//  the game ship shading again: one directional sun, a soft terminator, hot
//  highlights on the hull plates, a cool fill so that the shadow side stays
//  readable, a thin rim on the lit edge, and shadows that the cockpit and the
//  parts cast on the hull.
//
//  FRAME   +x right, +y down (screen), +z out of the screen to the viewer.
//          The sprite nose points to +y. A light vector points from the
//          surface to the sun. A sprite drawn with rotation a takes the
//          light in its own frame: rotateLight(L, a) turns it by -a.
//
//  NORMAL MAP  RGBA bytes, R = (nx + 1) / 2, G = (ny + 1) / 2,
//          B = (nz + 1) / 2, all in the frame above (+y down). A map made
//          with +y up (the OpenGL hand) decodes with yUp = true.
//
//  SURFACE (buildSurface)  from the six livery layers at one size S:
//      alpha   = union of the hull, cockpit and accent alpha
//      height  = bevel(distance to the alpha edge)      round rim
//              + body(distance, wide)                     broad form: the
//                                                         spine stands high
//              + relief * (lum - blur(lum))              panel lines
//              + dome(blur(cockpit mask))                raised canopy
//              + lift * blur(accent mask)                raised parts
//      nmap    = normals of the height (central differences), encoded
//      ao      = 1 - k * (blur(height) - height)+         creases go dark
//      mat     = 0 hull, 1 cockpit glass, 2 accent part
//      gloss   = hull plates: brighter plate, more gloss
//      All lengths are in pixels of a 512 sprite times S / 512.
//
//  SHADING (shade), in linear light
//      dif    = soft terminator: smoothstep of n.L over a narrow band
//      spec   = gloss * KS[mat] * (n.h)^SHIN[mat], h = half of L and view
//      fill   = cool light from the side away from the sun
//      sheen  = a broad cool sky glow on glossy plates, also in shadow
//      rim    = (1 - nz)^2 * the edge normal toward the sun
//      shadow = march toward the sun through the height; a higher sample
//               than the ray darkens the pixel (soft over SOFT pixels)
//      colour = albedo * (AMB * ao + SUN * dif * shadow + FILL * fill * ao)
//             + SUN * shadow * (spec + rim * (0.3 + albedo)) + SHEEN * sheen * gloss
//
//  grep -n targets: "function lightDir", "function rotateLight",
//  "function decodeNormal", "function encodeNormal", "function edgeDistance",
//  "function boxBlur", "function buildSurface", "function shadowAt",
//  "function shade(", "function terms", "var LOOK"
// ============================================================================
(function (root) {
  'use strict';

  // The look. These numbers belong to this page; they are not from the game.
  var LOOK = {
    AMB: [0.045, 0.05, 0.07],    // linear ambient, cool and low: deep space
    SUN: [1.45, 1.36, 1.2],      // linear sun colour and power, warm white
    FILL: [0.07, 0.10, 0.17],    // linear fill from the side away from the sun
    SHEEN: [0.05, 0.065, 0.10],  // cool sky sheen on glossy plates
    BAND: 0.22,                  // width of the terminator band in n.L
    KS: [0.5, 1.1, 0.6],         // highlight strength: hull, cockpit, accent
    SHIN: [30, 110, 26],         // highlight tightness: hull, cockpit, accent
    RIM: 0.45,                   // lit edge line
    SOFT: 2.5,                   // shadow softness, pixels of height at 512
    BEVEL: 9, FORM: 46, RELIEF: 6, DOME: 7, LIFT: 2.2, AO: 0.55
  };

  // sRGB <-> linear tables.
  var TO_LIN = new Float32Array(256);
  for (var i = 0; i < 256; i++) { var c = i / 255; TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  var LUT_N = 4096, TO_SRGB = new Uint8Array(LUT_N + 1);
  for (i = 0; i <= LUT_N; i++) { var l = i / LUT_N; TO_SRGB[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); }
  // Linear to an sRGB byte, with a soft shoulder over 0.85 so a hot
  // highlight does not clip hard.
  function enc(v) {
    if (v > 0.85) v = 0.85 + 0.15 * (1 - Math.exp(-(v - 0.85) / 0.15));
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return TO_SRGB[(v * LUT_N) | 0];
  }
  // Byte to a signed normal component.
  var DEC = new Float32Array(256);
  for (i = 0; i < 256; i++) DEC[i] = i / 127.5 - 1;

  // ── light ───────────────────────────────────────────────────────────────
  // The unit vector to a sun at plane angle az (radians, screen sense:
  // 0 = right, PI/2 = down) and elevation elev over the plane.
  function lightDir(az, elev) {
    var ce = Math.cos(elev);
    return { x: ce * Math.cos(az), y: ce * Math.sin(az), z: Math.sin(elev) };
  }
  // The light in the frame of a sprite drawn with canvas rotation a.
  function rotateLight(L, a) {
    var c = Math.cos(-a), s = Math.sin(-a);
    return { x: L.x * c - L.y * s, y: L.x * s + L.y * c, z: L.z };
  }

  // ── normal map ──────────────────────────────────────────────────────────
  function decodeNormal(r, g, b, yUp) {
    var x = DEC[r], y = yUp ? -DEC[g] : DEC[g], z = DEC[b];
    var l = Math.sqrt(x * x + y * y + z * z);
    if (l < 1e-6) return [0, 0, 1];
    return [x / l, y / l, z / l];
  }
  function encodeNormal(x, y, z) {
    var l = Math.sqrt(x * x + y * y + z * z) || 1;
    return [Math.round((x / l + 1) * 127.5), Math.round((y / l + 1) * 127.5), Math.round((z / l + 1) * 127.5)];
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  // Distance in pixels from each opaque pixel to the nearest clear one
  // (two passes, chamfer 3-4). Clear pixels get 0.
  function edgeDistance(alpha, w, h) {
    var n = w * h, d = new Float32Array(n), BIG = 1e9, x, y, p, v;
    for (p = 0; p < n; p++) d[p] = alpha[p] > 0.5 ? BIG : 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x; if (!d[p]) continue;
      v = Math.min(d[p], x > 0 ? d[p - 1] + 3 : 3, y > 0 ? d[p - w] + 3 : 3,
        x > 0 && y > 0 ? d[p - w - 1] + 4 : 4, x < w - 1 && y > 0 ? d[p - w + 1] + 4 : 4);
      d[p] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      p = y * w + x; if (!d[p]) continue;
      v = Math.min(d[p], x < w - 1 ? d[p + 1] + 3 : 3, y < h - 1 ? d[p + w] + 3 : 3,
        x < w - 1 && y < h - 1 ? d[p + w + 1] + 4 : 4, x > 0 && y < h - 1 ? d[p + w - 1] + 4 : 4);
      d[p] = v;
    }
    for (p = 0; p < n; p++) d[p] /= 3;
    return d;
  }
  // Box blur of radius r (running sums, rows then columns). Edges clamp.
  function boxBlur(src, w, h, r) {
    r = Math.max(0, Math.round(r));
    if (!r) return Float32Array.from(src);
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 1 / (2 * r + 1), x, y, s, row;
    for (y = 0; y < h; y++) {
      row = y * w; s = 0;
      for (x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) {
        tmp[row + x] = s * k;
        s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      s = 0;
      for (y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) {
        out[y * w + x] = s * k;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  function chan(rgba, n, c) {
    var o = new Float32Array(n);
    if (rgba) for (var p = 0; p < n; p++) o[p] = rgba[p * 4 + c] / 255;
    return o;
  }

  // ── surface ─────────────────────────────────────────────────────────────
  // lay: { hull, hullMask, cockpit, cockpitMask, accents, accentsMask } as
  // RGBA byte arrays of w x h. A missing mask counts as the layer alpha.
  function buildSurface(lay, w, h) {
    var n = w * h, k = w / 512, p;
    var aH = chan(lay.hull, n, 3), mH = lay.hullMask ? chan(lay.hullMask, n, 3) : aH;
    var aC = chan(lay.cockpitMask || lay.cockpit, n, 3), aA = chan(lay.accentsMask || lay.accents, n, 3);
    var alpha = new Float32Array(n), lum = new Float32Array(n);
    for (p = 0; p < n; p++) {
      var hh = aH[p] * mH[p];
      alpha[p] = 1 - (1 - hh) * (1 - aC[p]) * (1 - aA[p]);
      if (lay.hull) lum[p] = (0.3 * lay.hull[p * 4] + 0.59 * lay.hull[p * 4 + 1] + 0.11 * lay.hull[p * 4 + 2]) / 255;
    }
    var dist = edgeDistance(alpha, w, h);
    var lumS = boxBlur(lum, w, h, Math.max(1, k)), lumB = boxBlur(lum, w, h, 3 * k);
    var dome = boxBlur(aC, w, h, 6 * k), lift = boxBlur(aA, w, h, 1.5 * k);
    var bevel = Math.max(1, LOOK.BEVEL * k), height = new Float32Array(n);
    for (p = 0; p < n; p++) {
      if (alpha[p] <= 0.02) continue;
      var t = Math.min(1, dist[p] / bevel), prof = Math.sqrt(1 - (1 - t) * (1 - t));
      var body = Math.sqrt(Math.min(1, dist[p] / (LOOK.FORM * k)));
      height[p] = prof * bevel * 0.8 + body * LOOK.FORM * k * 0.35 + (lumS[p] - lumB[p]) * LOOK.RELIEF * k * 4 +
        dome[p] * LOOK.DOME * k + lift[p] * LOOK.LIFT * k;
    }
    // Normals, encoded into a map. Clear pixels keep a flat normal.
    var nmap = new Uint8ClampedArray(n * 4);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      p = y * w + x;
      var hl = height[x > 0 ? p - 1 : p], hr = height[x < w - 1 ? p + 1 : p];
      var hu = height[y > 0 ? p - w : p], hd = height[y < h - 1 ? p + w : p];
      var e = encodeNormal(-(hr - hl) * 0.5, -(hd - hu) * 0.5, 1);
      nmap[p * 4] = e[0]; nmap[p * 4 + 1] = e[1]; nmap[p * 4 + 2] = e[2]; nmap[p * 4 + 3] = alpha[p] * 255;
    }
    // Ambient occlusion: a crease is lower than the blur of its region.
    var b1 = boxBlur(height, w, h, 5 * k), b2 = boxBlur(height, w, h, 16 * k), ao = new Float32Array(n);
    var mat = new Uint8Array(n), gloss = new Float32Array(n), idx = [];
    for (p = 0; p < n; p++) {
      if (alpha[p] <= 0.02) { ao[p] = 1; continue; }
      idx.push(p);
      var occ = Math.max(0, b1[p] - height[p]) / (3 * k) * 0.7 + Math.max(0, b2[p] - height[p]) / (8 * k) * 0.3;
      ao[p] = 1 - LOOK.AO * Math.min(1, occ);
      mat[p] = aA[p] > 0.5 ? 2 : aC[p] > 0.5 ? 1 : 0;
      gloss[p] = mat[p] === 0 ? Math.max(0.15, Math.min(1, 0.2 + 1.3 * (lum[p] - 0.25))) : mat[p] === 1 ? 1 : 0.8;
    }
    return { w: w, h: h, k: k, alpha: alpha, height: height, nmap: nmap, ao: ao, mat: mat, gloss: gloss, idx: Int32Array.from(idx) };
  }

  // ── shading ─────────────────────────────────────────────────────────────
  // The light terms for one normal (no shadow): { dif, spec, rim, fill }.
  function terms(nx, ny, nz, L, m, gl) {
    m = m || 0; gl = gl == null ? 1 : gl;
    var ndl = nx * L.x + ny * L.y + nz * L.z;
    var t = Math.max(0, Math.min(1, (ndl + LOOK.BAND * 0.5) / LOOK.BAND));
    var dif = Math.max(0, ndl) * 0.85 + 0.15 * t * t * (3 - 2 * t);
    var hx = L.x, hy = L.y, hz = L.z + 1, hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
    var ndh = (nx * hx + ny * hy + nz * hz) / hl;
    var spec = ndl > 0 && ndh > 0 ? gl * LOOK.KS[m] * Math.pow(ndh, LOOK.SHIN[m]) : 0;
    var lxy = Math.sqrt(L.x * L.x + L.y * L.y), nxy = Math.sqrt(nx * nx + ny * ny), rim = 0;
    if (lxy > 1e-4 && nxy > 1e-4) { var q = (nx * L.x + ny * L.y) / (lxy * nxy); if (q > 0) rim = LOOK.RIM * (1 - nz) * (1 - nz) * q; }
    var fx = -L.x, fy = -L.y, fz = 0.7, fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    var fill = Math.max(0, (nx * fx + ny * fy + nz * fz) / fl);
    // Sheen: a broad sky glow on plates that face the viewer, so that a
    // glossy plate in shadow still shows its form.
    var sheen = nz * nz * (0.6 + 0.4 * (1 - Math.max(0, ndl)));
    return { dif: dif, spec: spec, rim: rim, fill: fill, sheen: sheen };
  }

  // Light that reaches pixel p through the height field (1 lit, 0 dark).
  function shadowAt(s, p, L, steps) {
    var lxy = Math.sqrt(L.x * L.x + L.y * L.y);
    if (lxy < 0.02) return 1;
    var w = s.w, h = s.h, dx = L.x / lxy, dy = L.y / lxy, rise = L.z / lxy;
    var stride = Math.max(1, 2 * s.k), soft = LOOK.SOFT * Math.max(0.5, s.k * 2);
    var x0 = p % w, y0 = (p / w) | 0, h0 = s.height[p], occ = 0;
    for (var i = 1; i <= steps; i++) {
      var d = i * stride, x = (x0 + dx * d + 0.5) | 0, y = (y0 + dy * d + 0.5) | 0;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      var o = s.height[y * w + x] - (h0 + d * rise);
      if (o > occ) occ = o;
    }
    return 1 - Math.min(1, occ / soft) * 0.85;
  }

  // Shade the flat composite (RGBA bytes, the size of the surface) under
  // light L. o.shadow (default true) marches self shadows, o.steps sets the
  // march length, o.yUp decodes a +y up normal map. out gets RGBA bytes
  // with the composite alpha.
  function shade(albedo, s, L, o, out) {
    o = o || {};
    var n = s.w * s.h, nm = s.nmap, idx = s.idx, sh = o.shadow !== false;
    var steps = o.steps || Math.max(4, Math.round(10 * Math.min(1, s.k * 2)));
    out = out || new Uint8ClampedArray(n * 4);
    out.fill(0);
    var A = LOOK.AMB, S = LOOK.SUN, F = LOOK.FILL, E = LOOK.SHEEN;
    for (var j = 0; j < idx.length; j++) {
      var p = idx[j], q = p * 4, a = albedo[q + 3];
      if (!a) continue;
      var N = decodeNormal(nm[q], nm[q + 1], nm[q + 2], o.yUp);
      var T = terms(N[0], N[1], N[2], L, s.mat[p], s.gloss[p]);
      var sd = sh && T.dif > 0 ? shadowAt(s, p, L, steps) : 1, ao = s.ao[p];
      for (var c = 0; c < 3; c++) {
        var al = TO_LIN[albedo[q + c]];
        out[q + c] = enc(al * (A[c] * ao + S[c] * T.dif * sd + F[c] * T.fill * ao) +
          S[c] * sd * (T.spec + T.rim * (0.3 + al)) + E[c] * T.sheen * s.gloss[p] * ao);
      }
      out[q + 3] = a;
    }
    return out;
  }

  var API = {
    LOOK: LOOK, lightDir: lightDir, rotateLight: rotateLight,
    decodeNormal: decodeNormal, encodeNormal: encodeNormal,
    edgeDistance: edgeDistance, boxBlur: boxBlur, buildSurface: buildSurface,
    terms: terms, shadowAt: shadowAt, shade: shade,
    toLinear: function (b) { return TO_LIN[b]; }, toSRGB: enc
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SDShade = API;
})(this);
