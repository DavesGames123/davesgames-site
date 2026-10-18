// ============================================================================
//  SELECTION  ·  light.js — one sun, normal maps and sphere shading (no DOM)
// ----------------------------------------------------------------------------
//  Pure functions on pixel arrays. main.js calls them through window.SNLight
//  and caches the results in canvases. tests.mjs and the node thumbnail call
//  them through require(). This file has no game code.
//
//  FRAME   world and screen: +x right, +y down, +z out of the screen to the
//          viewer. A normal map holds (nx, ny, nz) in that frame. A sprite
//          drawn with rotation a takes the light in its own frame: rotate
//          the world light by -a (localLight). The sun sits ELEV radians
//          over the plane, so a face that looks up is lit too.
//
//  SHADING (shade, shadePlanet), in linear light
//      colour = albedo * (AMBIENT + SUN * wrapLambert(n.L))
//             + SUN * specular(n.h) + SUN * rim
//      rim    = (1 - nz)^2 * the part of the edge normal that points to
//               the sun: a thin warm line on the lit edge only.
//      Planets take a lower sun (ELEV_PLANET), so the terminator crosses
//      the disc. The ambient term is small and cool, so a shadow side is dark blue
//      grey, never pure black.
//
//  SPRITE NORMALS (spriteHeight, normalsFromHeight)
//      height = bevel(distance to the alpha edge) + detail * luminance.
//      The bevel is a quarter circle, so a hull reads round at its rim and
//      flat on top; the luminance adds panel relief.
//
//  ASTEROIDS (asteroid)  a seeded rock: a lumpy outline from a few
//      harmonics, a dome height with craters and noise bumps, and an
//      albedo from natural rock tones (grey basalt, brown, dark carbon,
//      tan, rust). No ore colours.
//
//  PLANETS (planetTable, shadePlanet)  an orthographic sphere. Each pixel
//      keeps its longitude, its texture row and its local east and north,
//      so a frame only adds the spin to the longitude and shades. The
//      buffer is HALO times the disc, so the atmosphere glow fits in it.
//
//  grep -n targets: "function sunDir", "function localLight", "function lightBin",
//  "function edgeDistance", "function spriteHeight", "function normalsFromHeight",
//  "function shadeTerms", "function shade(", "function asteroid", "function planetTable",
//  "function shadePlanet", "function mipTexture", "const MATERIALS"
// ============================================================================
(function (root) {
  'use strict';

  var ELEV = 0.45;                    // sun height over the plane, radians
  var ELEV_PLANET = 0.16;             // lower for spheres: a clear terminator
  var AMBIENT = [0.055, 0.065, 0.09]; // linear, cool fill from the sky
  var SUN = [1.32, 1.24, 1.1];        // linear sun colour and power
  var HALO = 1.26;                    // planet buffer side / disc diameter

  // sRGB <-> linear lookup tables.
  var TO_LIN = new Float32Array(256);
  for (var i = 0; i < 256; i++) { var c = i / 255; TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  var LUT_N = 4096, TO_SRGB = new Uint8Array(LUT_N + 1);
  for (i = 0; i <= LUT_N; i++) { var l = i / LUT_N; TO_SRGB[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); }
  // Linear to sRGB byte, with a soft shoulder over 0.8 so hot spots do not
  // clip hard.
  function enc(v) {
    if (v > 0.8) v = 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) / 0.2));
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return TO_SRGB[(v * LUT_N) | 0];
  }

  // ── sun ─────────────────────────────────────────────────────────────────
  // Unit vector from the point (ex,ey) to the sun at (sx,sy), raised by the
  // sun elevation. az is the plane angle of the direction.
  function sunDir(ex, ey, sx, sy, elev) {
    var e = elev == null ? ELEV : elev;
    var az = Math.atan2(sy - ey, sx - ex), c = Math.cos(e);
    return { x: c * Math.cos(az), y: c * Math.sin(az), z: Math.sin(e), az: az };
  }
  // The light seen from a sprite drawn with rotation a (radians, the canvas
  // rotate sense): turn the light by -a.
  function localLight(L, a) {
    var c = Math.cos(-a), s = Math.sin(-a);
    var x = L.x * c - L.y * s, y = L.x * s + L.y * c;
    return { x: x, y: y, z: L.z, az: Math.atan2(y, x) };
  }
  // Two cache bins round a plane angle, and the blend weight of the second.
  function lightBin(az, n) {
    var t = ((az / (2 * Math.PI)) % 1 + 1) % 1 * n;
    var i0 = Math.floor(t) % n;
    return { i0: i0, i1: (i0 + 1) % n, f: t - Math.floor(t) };
  }
  function binLight(i, n, elev) {
    var a = i / n * 2 * Math.PI, e = elev == null ? ELEV : elev, c = Math.cos(e);
    return { x: c * Math.cos(a), y: c * Math.sin(a), z: Math.sin(e), az: a };
  }

  // ── sprite normals ──────────────────────────────────────────────────────
  // Distance in pixels from each opaque pixel to the nearest clear one
  // (two-pass chamfer 3-4). Outside the sprite the distance is 0.
  function edgeDistance(alpha, w, h, thr) {
    var t = thr == null ? 0.5 : thr, n = w * h, d = new Float32Array(n), BIG = 1e9;
    for (var k = 0; k < n; k++) d[k] = alpha[k] > t ? BIG : 0;
    var x, y, p, v;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      p = y * w + x; if (!d[p]) continue;
      v = d[p];
      v = Math.min(v, x > 0 ? d[p - 1] + 3 : 3, y > 0 ? d[p - w] + 3 : 3);
      v = Math.min(v, x > 0 && y > 0 ? d[p - w - 1] + 4 : 4, x < w - 1 && y > 0 ? d[p - w + 1] + 4 : 4);
      d[p] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      p = y * w + x; if (!d[p]) continue;
      v = d[p];
      v = Math.min(v, x < w - 1 ? d[p + 1] + 3 : 3, y < h - 1 ? d[p + w] + 3 : 3);
      v = Math.min(v, x < w - 1 && y < h - 1 ? d[p + w + 1] + 4 : 4, x > 0 && y < h - 1 ? d[p + w - 1] + 4 : 4);
      d[p] = v;
    }
    for (k = 0; k < n; k++) d[k] /= 3;
    return d;
  }

  // Height of a sprite from its RGBA bytes. o.bevel is the rim width in
  // pixels, o.detail the luminance relief (0..1), o.base the flat top.
  function spriteHeight(rgba, w, h, o) {
    o = o || {};
    var n = w * h, alpha = new Float32Array(n), hgt = new Float32Array(n);
    for (var k = 0; k < n; k++) alpha[k] = rgba[k * 4 + 3] / 255;
    var dist = edgeDistance(alpha, w, h, 0.35);
    var bevel = Math.max(1, o.bevel || w * 0.1), det = o.detail == null ? 0.3 : o.detail;
    for (k = 0; k < n; k++) {
      if (alpha[k] <= 0.02) continue;
      var t = Math.min(1, dist[k] / bevel), prof = Math.sqrt(1 - (1 - t) * (1 - t));
      var lum = (0.3 * rgba[k * 4] + 0.59 * rgba[k * 4 + 1] + 0.11 * rgba[k * 4 + 2]) / 255;
      hgt[k] = (prof * (1 - det) + lum * det) * bevel * (o.lift == null ? 0.9 : o.lift);
    }
    return { height: hgt, alpha: alpha };
  }

  // Normals from a height field in pixels (central differences). The
  // strength scales the slope. The result is 3 floats per pixel.
  function normalsFromHeight(hgt, w, h, strength) {
    var s = strength == null ? 1 : strength, out = new Float32Array(w * h * 3);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = y * w + x;
      var hl = hgt[x > 0 ? p - 1 : p], hr = hgt[x < w - 1 ? p + 1 : p];
      var hu = hgt[y > 0 ? p - w : p], hd = hgt[y < h - 1 ? p + w : p];
      var nx = -(hr - hl) * 0.5 * s, ny = -(hd - hu) * 0.5 * s, nz = 1;
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      out[p * 3] = nx / l; out[p * 3 + 1] = ny / l; out[p * 3 + 2] = nz / l;
    }
    return out;
  }

  // ── shading ─────────────────────────────────────────────────────────────
  // Surface types. wrap softens the terminator, spec and shin set the
  // highlight, rim the lit-edge line.
  var MATERIALS = {
    hull:   { wrap: 0.12, spec: 0.55, shin: 36, rim: 0.55 },
    module: { wrap: 0.12, spec: 0.35, shin: 24, rim: 0.4 },
    rock:   { wrap: 0.06, spec: 0.05, shin: 10, rim: 0.3 },
    flat:   { wrap: 0.2,  spec: 0.0,  shin: 1,  rim: 0.0 }
  };

  // The light terms for one normal: diffuse, specular and rim (scalars).
  function shadeTerms(nx, ny, nz, L, m) {
    var ndl = nx * L.x + ny * L.y + nz * L.z;
    var dif = Math.max(0, (ndl + m.wrap) / (1 + m.wrap));
    var hx = L.x, hy = L.y, hz = L.z + 1, hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
    var ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
    var spec = m.spec ? m.spec * Math.pow(ndh, m.shin) * (ndl > 0 ? 1 : 0) : 0;
    var rim = 0;
    if (m.rim) {
      var e = 1 - nz, nl = Math.sqrt(nx * nx + ny * ny), ll = Math.sqrt(L.x * L.x + L.y * L.y);
      if (nl > 1e-4 && ll > 1e-4) rim = m.rim * e * e * Math.max(0, (nx * L.x + ny * L.y) / (nl * ll));
    }
    return { dif: dif, spec: spec, rim: rim };
  }

  // Shade an RGBA sprite with its normals under light L. out gets RGBA
  // bytes with the source alpha.
  function shade(rgba, nrm, w, h, L, m, out) {
    m = m || MATERIALS.hull;
    var n = w * h;
    out = out || new Uint8ClampedArray(n * 4);
    var hx = L.x, hy = L.y, hz = L.z + 1, hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
    hx /= hl; hy /= hl; hz /= hl;
    var ll = Math.sqrt(L.x * L.x + L.y * L.y) || 1, lx = L.x / ll, ly = L.y / ll;
    for (var k = 0; k < n; k++) {
      var a = rgba[k * 4 + 3];
      out[k * 4 + 3] = a;
      if (!a) { out[k * 4] = out[k * 4 + 1] = out[k * 4 + 2] = 0; continue; }
      var nx = nrm[k * 3], ny = nrm[k * 3 + 1], nz = nrm[k * 3 + 2];
      var ndl = nx * L.x + ny * L.y + nz * L.z;
      var dif = ndl + m.wrap > 0 ? (ndl + m.wrap) / (1 + m.wrap) : 0;
      var spec = 0;
      if (m.spec && ndl > 0) { var ndh = nx * hx + ny * hy + nz * hz; if (ndh > 0) spec = m.spec * Math.pow(ndh, m.shin); }
      var rim = 0;
      if (m.rim) {
        var nl = Math.sqrt(nx * nx + ny * ny);
        if (nl > 1e-4) { var e = 1 - nz, q = (nx * lx + ny * ly) / nl; if (q > 0) rim = m.rim * e * e * q; }
      }
      for (var c = 0; c < 3; c++) {
        var al = TO_LIN[rgba[k * 4 + c]];
        out[k * 4 + c] = enc(al * (AMBIENT[c] + SUN[c] * dif) + SUN[c] * (spec + rim * (0.35 + al)));
      }
    }
    return out;
  }

  // ── asteroids ───────────────────────────────────────────────────────────
  function mulberry(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hash2(x, y, s) {
    var h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct) {
    var f = 0, amp = 0.5, tot = 0;
    for (var o = 0; o < oct; o++) { f += amp * vnoise(x, y, s + o * 17); tot += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
    return f / tot;
  }
  // Natural rock tones (sRGB): grey basalt, brown, dark carbon, tan, rust.
  var ROCK = [[112, 108, 104], [118, 100, 82], [74, 71, 68], [140, 128, 110], [124, 92, 74], [96, 92, 86]];

  // A seeded asteroid of side S pixels: { w, h, rgba, height, nrm }.
  function asteroid(seed, S) {
    var rnd = mulberry(seed * 9973 + 17), w = S, h = S, n = w * h;
    var K = 6, amp = [], ph = [];
    for (var k = 1; k <= K; k++) { amp.push((rnd() * 0.6 + 0.4) * 0.16 / Math.pow(k, 1.15)); ph.push(rnd() * 6.283); }
    var R0 = 0.36 * S, stretch = 1 + rnd() * 0.32, tilt = rnd() * Math.PI;
    var ct = Math.cos(tilt), st = Math.sin(tilt);
    var c1 = ROCK[(rnd() * ROCK.length) | 0], c2 = ROCK[(rnd() * ROCK.length) | 0];
    var craters = [], nc = 2 + ((rnd() * 4) | 0);
    for (k = 0; k < nc; k++) {
      var a = rnd() * 6.283, rr = Math.sqrt(rnd()) * 0.75 * R0;
      craters.push({ x: S / 2 + Math.cos(a) * rr, y: S / 2 + Math.sin(a) * rr, r: (0.05 + rnd() * 0.13) * S, d: 0.15 + rnd() * 0.3 });
    }
    var sd = (seed * 31 + 7) | 0, fq = 6 / S;
    var rgba = new Uint8ClampedArray(n * 4), hgt = new Float32Array(n);
    function edgeR(th) {
      var r = 1;
      for (var j = 0; j < K; j++) r += amp[j] * Math.sin((j + 1) * th + ph[j]);
      return R0 * r;
    }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
      // squash along the tilt axis for an oblong body
      var u = (dx * ct + dy * st) / stretch, v = -dx * st + dy * ct;
      var dist = Math.sqrt(u * u + v * v), th = Math.atan2(dy, dx);
      var er = edgeR(th) * (1 + 0.06 * (fbm(Math.cos(th) * 2 + 9, Math.sin(th) * 2 + 9, sd, 3) - 0.5));
      var p = y * w + x, al = Math.max(0, Math.min(1, er - dist + 0.5));
      if (al <= 0) continue;
      var t = Math.min(1, dist / er), dome = Math.sqrt(Math.max(0, 1 - t * t * t));
      var bump = fbm(x * fq, y * fq, sd + 3, 4) - 0.5, fine = fbm(x * fq * 4, y * fq * 4, sd + 11, 2) - 0.5;
      var hh = dome * 0.62 * er + bump * 0.24 * er + fine * 0.05 * er, cr = 0;
      for (k = 0; k < craters.length; k++) {
        var C = craters[k], q = Math.hypot(x - C.x, y - C.y) / C.r;
        if (q < 1) { hh -= C.d * C.r * 0.55 * (1 - q * q); cr = Math.max(cr, 1 - q); }
        else if (q < 1.35) { var rimq = 1 - Math.abs(q - 1.12) / 0.23; if (rimq > 0) hh += C.d * C.r * 0.12 * rimq; }
      }
      hgt[p] = hh;
      var mixv = Math.max(0, Math.min(1, fbm(x * fq * 0.7, y * fq * 0.7, sd + 5, 3) * 1.6 - 0.3));
      var tone = 1 + bump * 0.28 + fine * 0.18 - cr * 0.12;
      for (var c = 0; c < 3; c++) rgba[p * 4 + c] = (c1[c] + (c2[c] - c1[c]) * mixv) * tone;
      rgba[p * 4 + 3] = al * 255;
    }
    return { w: w, h: h, rgba: rgba, height: hgt, nrm: normalsFromHeight(hgt, w, h, 1.6) };
  }

  // ── planets ─────────────────────────────────────────────────────────────
  // Pick the smallest mip level of a texture that still has about one texel
  // per screen pixel across the disc of diameter D.
  function mipTexture(levels, D) {
    for (var i = levels.length - 1; i >= 0; i--) if (levels[i].w >= D * 3.3) return levels[i];
    return levels[0];
  }
  // Halve an RGBA texture (2x2 box) until it is narrower than minW.
  function mipChain(tex, minW) {
    var out = [tex], t = tex;
    while (t.w / 2 >= (minW || 32)) {
      var w = t.w >> 1, h = t.h >> 1, d = new Uint8ClampedArray(w * h * 4);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) for (var c = 0; c < 4; c++) {
        var a = ((2 * y) * t.w + 2 * x) * 4 + c, b = a + t.w * 4;
        d[(y * w + x) * 4 + c] = (t.data[a] + t.data[a + 4] + t.data[b] + t.data[b + 4]) / 4;
      }
      t = { w: w, h: h, data: d }; out.push(t);
    }
    return out;
  }

  // Per-pixel geometry of a sphere of diameter D in a buffer of side
  // ceil(D * HALO). tilt turns the spin axis in the screen plane.
  function planetTable(D, tilt) {
    var B = Math.ceil(D * HALO), n = B * B, R = D / 2, o = B / 2;
    var T = { D: D, B: B, inside: new Uint8Array(n), rr: new Float32Array(n),
      p: new Float32Array(n * 3), e: new Float32Array(n * 3), q: new Float32Array(n * 3), lon: new Float32Array(n), lat: new Float32Array(n) };
    var t = tilt || 0, Nx = Math.sin(t), Ny = -Math.cos(t), Ex = Math.cos(t), Ey = Math.sin(t);
    for (var y = 0; y < B; y++) for (var x = 0; x < B; x++) {
      var k = y * B + x, px = (x + 0.5 - o) / R, py = (y + 0.5 - o) / R, r2 = px * px + py * py;
      T.rr[k] = Math.sqrt(r2);
      if (r2 >= 1.0 + 2 / R) continue;
      T.inside[k] = 1;
      var pz = Math.sqrt(Math.max(0, 1 - r2)), l = Math.sqrt(px * px + py * py + pz * pz);
      var sx = px / l, sy = py / l, sz = pz / l;
      T.p[k * 3] = sx; T.p[k * 3 + 1] = sy; T.p[k * 3 + 2] = sz;
      var sn = sx * Nx + sy * Ny;
      T.lat[k] = Math.asin(Math.max(-1, Math.min(1, sn)));
      T.lon[k] = Math.atan2(sx * Ex + sy * Ey, sz);
      // east = p x N, north = east x p
      var ex = sy * 0 - sz * Ny, ey = sz * Nx - sx * 0, ez = sx * Ny - sy * Nx, el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
      ex /= el; ey /= el; ez /= el;
      T.e[k * 3] = ex; T.e[k * 3 + 1] = ey; T.e[k * 3 + 2] = ez;
      T.q[k * 3] = ey * sz - ez * sy; T.q[k * 3 + 1] = ez * sx - ex * sz; T.q[k * 3 + 2] = ex * sy - ey * sx;
    }
    return T;
  }

  // Shade a planet into out (RGBA bytes, B x B). tex: { w, h, data RGBA }
  // equirect albedo; nmap: same size, R G = tangent normal x y, B = specular
  // mask (optional). spin: turns (0..1). L: light. atm: [r, g, b] linear or
  // null, atmK its strength.
  function shadePlanet(T, tex, nmap, spin, L, atm, atmK, out) {
    var B = T.B, n = B * B, R = T.D / 2;
    out = out || new Uint8ClampedArray(n * 4);
    var tw = tex.w, th = tex.h, td = tex.data, sh = ((spin % 1) + 1) % 1;
    var nd = nmap && nmap.w === tw ? nmap.data : null, bump = 0.6;
    var hx = L.x, hy = L.y, hz = L.z + 1, hl = Math.sqrt(hx * hx + hy * hy + hz * hz); hx /= hl; hy /= hl; hz /= hl;
    var ll = Math.sqrt(L.x * L.x + L.y * L.y) || 1, lx = L.x / ll, ly = L.y / ll;
    var ak = atm ? (atmK == null ? 1 : atmK) : 0;
    for (var k = 0; k < n; k++) {
      var r = T.rr[k], j = k * 4;
      if (!T.inside[k]) {
        // atmosphere halo outside the disc, bright on the day side
        if (ak && r < HALO) {
          var s = (r - 1) / (HALO - 1), px = ((k % B) + 0.5 - B / 2), py = (((k / B) | 0) + 0.5 - B / 2), pl = Math.sqrt(px * px + py * py) || 1;
          var side = Math.max(0, (px * lx + py * ly) / pl * 0.75 + 0.35);
          var a = Math.pow(Math.max(0, 1 - s), 3) * side * ak * 0.85;
          out[j] = enc(atm[0] * 1.6); out[j + 1] = enc(atm[1] * 1.6); out[j + 2] = enc(atm[2] * 1.6); out[j + 3] = Math.min(255, a * 255);
        } else out[j + 3] = 0;
        continue;
      }
      var sx = T.p[k * 3], sy = T.p[k * 3 + 1], sz = T.p[k * 3 + 2];
      var u = ((T.lon[k] / 6.283185 + 0.5 + sh) % 1) * tw, v = (0.5 - T.lat[k] / Math.PI) * th;
      var ui = u | 0, vi = Math.min(th - 1, Math.max(0, v | 0)), ti = (vi * tw + (ui >= tw ? ui - tw : ui)) * 4;
      var nx = sx, ny = sy, nz = sz, spm = 0;
      if (nd) {
        var tx = (nd[ti] / 127.5 - 1) * bump, ty = (nd[ti + 1] / 127.5 - 1) * bump;
        nx = sx + T.e[k * 3] * tx + T.q[k * 3] * ty; ny = sy + T.e[k * 3 + 1] * tx + T.q[k * 3 + 1] * ty; nz = sz + T.e[k * 3 + 2] * tx + T.q[k * 3 + 2] * ty;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= nl; ny /= nl; nz /= nl;
        spm = nd[ti + 2] / 255;
      }
      var ndlS = sx * L.x + sy * L.y + sz * L.z, ndl = nx * L.x + ny * L.y + nz * L.z;
      // the smooth sphere sets the terminator, the relief only modulates it
      var term = Math.max(0, Math.min(1, (ndlS + 0.06) / 0.2));
      var dif = Math.max(0, ndl) * term;
      var spec = 0;
      if (spm > 0.05 && ndlS > 0) { var ndh = nx * hx + ny * hy + nz * hz; if (ndh > 0) spec = spm * 0.9 * Math.pow(ndh, 60); }
      var limb = 1 - sz, rimF = limb * limb * limb, dayA = Math.max(0, Math.min(1, ndlS * 1.4 + 0.3));
      var edge = Math.max(0, Math.min(1, (1 - r) * R + 0.5));
      for (var c = 0; c < 3; c++) {
        var al = TO_LIN[td[ti + c]];
        var col = al * (AMBIENT[c] * 0.5 + SUN[c] * dif) + SUN[c] * spec;
        if (ak) col = col * (1 - rimF * 0.5 * dayA) + atm[c] * ak * (rimF * 1.4 + 0.08) * dayA;
        out[j + c] = enc(col);
      }
      out[j + 3] = 255 * edge;
      // blend the halo under the antialiased rim
      if (edge < 1 && ak) {
        var hs = Math.max(0, (px2(k, B) * lx + py2(k, B) * ly) * 0.75 + 0.35) * ak * 0.85;
        var ha = 255 * hs, a2 = out[j + 3];
        if (ha > a2) { out[j + 3] = a2 + (ha - a2) * (1 - edge); }
      }
    }
    return out;
  }
  function px2(k, B) { var x = (k % B) + 0.5 - B / 2, y = ((k / B) | 0) + 0.5 - B / 2; return x / (Math.sqrt(x * x + y * y) || 1); }
  function py2(k, B) { var x = (k % B) + 0.5 - B / 2, y = ((k / B) | 0) + 0.5 - B / 2; return y / (Math.sqrt(x * x + y * y) || 1); }

  var API = {
    ELEV: ELEV, ELEV_PLANET: ELEV_PLANET, AMBIENT: AMBIENT, SUN: SUN, HALO: HALO, MATERIALS: MATERIALS, ROCK: ROCK,
    sunDir: sunDir, localLight: localLight, lightBin: lightBin, binLight: binLight,
    edgeDistance: edgeDistance, spriteHeight: spriteHeight, normalsFromHeight: normalsFromHeight,
    shadeTerms: shadeTerms, shade: shade, asteroid: asteroid, mulberry: mulberry,
    planetTable: planetTable, shadePlanet: shadePlanet, mipChain: mipChain, mipTexture: mipTexture,
    toLinear: function (b) { return TO_LIN[b]; }, toSRGB: enc
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SNLight = API;
})(this);
