// terrain.wgsl — the ground, the sea and the map overlays (common.wgsl in front).
//
// One grid mesh per raster: the outer raster (64 km, 250 m cells) and the
// inner raster (12 km, 23 m cells). The vertex shader makes the vertices
// from vertex_index, at the cell centres, and lifts them by surfaceZ(). The
// inner mesh has one extra ring of vertices, a skirt one cell out and 4 m
// down. The outer mesh drops its fragments under the inner mesh, except in
// a band one cell wide inside the inner edge, so no ray finds a gap.
//
// Water is drawn at the water level, never at the sea floor, so land and
// water are one surface and cannot z-fight. The terrain overlay (G.terr.x)
// shades the water by depth and by the relief of the sea floor below it.
// The wind heat map and the ocean speed tint are mixed in here as well, so
// they need no extra pass and no depth bias.
//
// grep: struct Mesh  fn vs  fn landColour  fn fs

struct Mesh {
  half: f32,       // m
  n: f32,          // cells per side
  level: f32,      // 0 outer, 1 inner
  skirt: f32,      // m
};
@group(2) @binding(0) var<uniform> M: Mesh;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) nG: vec3f,       // normal of the ground or sea floor
  @location(2) ground: f32,     // ground or sea floor height, m (not exaggerated)
  @location(3) surf: f32,       // surface height, m
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  let n = u32(M.n);
  let side = select(n, n + 2u, M.level > 0.5);
  let i = i32(vid % side);
  let j = i32(vid / side);
  var gx = i;
  var gy = j;
  var skirt = 0.0;
  var out = vec2f(0.0);
  if (M.level > 0.5) {
    gx = clamp(i - 1, 0, i32(n) - 1);
    gy = clamp(j - 1, 0, i32(n) - 1);
    // the skirt ring flares one cell outward and goes down, under the outer mesh
    out = vec2f(f32(i - 1 - gx), f32(j - 1 - gy));
    if (i == 0 || j == 0 || i == i32(n) + 1 || j == i32(n) + 1) { skirt = M.skirt; }
  }
  let cell = 2.0 * M.half / M.n;
  let p = vec2f(-M.half + (f32(gx) + 0.5) * cell, -M.half + (f32(gy) + 0.5) * cell) + out * cell;
  let e = exag();
  let d = cell;
  var h: vec4f;
  var hx: f32;
  var hy: f32;
  // Fast path: away from the inner edge a vertex sits on a texel centre of
  // its own raster, so 5 direct loads give the height and the normal. The
  // blend of heightAt() (40 loads) is needed only near the inner edge.
  let wIn = innerW(p);
  let inner = M.level > 0.5;
  let pure = select(innerW(p + vec2f(d, d)) <= 0.0 && innerW(p - vec2f(d, d)) <= 0.0 && wIn <= 0.0,
                    wIn >= 1.0 && innerW(p + vec2f(d, d)) >= 1.0 && innerW(p - vec2f(d, d)) >= 1.0, inner);
  if (pure && skirt == 0.0) {
    let g = vec2i(gx, gy);
    if (inner) {
      let n = vec2i(textureDimensions(hIn)) - 1;
      h = textureLoad(hIn, g, 0);
      hx = textureLoad(hIn, min(g + vec2i(1, 0), n), 0).x - textureLoad(hIn, max(g - vec2i(1, 0), vec2i(0)), 0).x;
      hy = textureLoad(hIn, min(g + vec2i(0, 1), n), 0).x - textureLoad(hIn, max(g - vec2i(0, 1), vec2i(0)), 0).x;
    } else {
      let n = vec2i(textureDimensions(hOut)) - 1;
      h = textureLoad(hOut, g, 0);
      hx = textureLoad(hOut, min(g + vec2i(1, 0), n), 0).x - textureLoad(hOut, max(g - vec2i(1, 0), vec2i(0)), 0).x;
      hy = textureLoad(hOut, min(g + vec2i(0, 1), n), 0).x - textureLoad(hOut, max(g - vec2i(0, 1), vec2i(0)), 0).x;
    }
  } else {
    h = heightAt(p);
    hx = heightAt(p + vec2f(d, 0.0)).x - heightAt(p - vec2f(d, 0.0)).x;
    hy = heightAt(p + vec2f(0.0, d)).x - heightAt(p - vec2f(0.0, d)).x;
  }
  var o: VOut;
  let z = h.y * e - skirt;
  o.world = vec3f(p, z);
  o.pos = G.viewProj * vec4f(p, z, 1.0);
  o.nG = normalize(vec3f(-hx * e / (2.0 * d), -hy * e / (2.0 * d), 1.0));
  o.ground = h.x;
  o.surf = h.y;
  return o;
}

// WorldCover class -> albedo. Muted, so the buildings and overlays read first.
fn landColour(c: u32) -> vec3f {
  var a = vec3f(0.36, 0.35, 0.31);                         // default: bare ground
  if (c == 10u) { a = vec3f(0.17, 0.25, 0.15); }           // tree cover
  else if (c == 20u) { a = vec3f(0.33, 0.34, 0.24); }      // shrub
  else if (c == 30u) { a = vec3f(0.30, 0.36, 0.22); }      // grass
  else if (c == 40u) { a = vec3f(0.38, 0.38, 0.26); }      // crop
  else if (c == 50u) { a = vec3f(0.30, 0.30, 0.31); }      // built-up
  else if (c == 60u) { a = vec3f(0.52, 0.48, 0.40); }      // bare
  else if (c == 70u) { a = vec3f(0.85, 0.87, 0.90); }      // snow
  else if (c == 90u) { a = vec3f(0.22, 0.30, 0.25); }      // wetland
  else if (c == 95u) { a = vec3f(0.14, 0.24, 0.16); }      // mangrove
  else if (c == 100u) { a = vec3f(0.36, 0.38, 0.30); }     // moss
  return a;
}

// Land colour at p: the class colours of the four nearest texels, blended
// bilinearly, so the 125 m outer classes do not show as blocks.
fn landAt(p: vec2f) -> vec3f {
  var half = G.grid.y;
  var n = vec2i(textureDimensions(cOut));
  let inner = innerW(p) > 0.5;
  if (inner) { half = G.grid.x; n = vec2i(textureDimensions(cIn)); }
  let g = (p + half) / (2.0 * half) * vec2f(n) - 0.5;
  let i = vec2i(floor(g));
  let f = g - floor(g);
  var c = array<vec3f, 4>();
  for (var k = 0; k < 4; k++) {
    let q = clamp(i + vec2i(k & 1, k >> 1), vec2i(0), n - 1);
    var cl = 0u;
    if (inner) { cl = textureLoad(cIn, q, 0).r; } else { cl = textureLoad(cOut, q, 0).r; }
    // water texels take the colour of the land around them (the water layer draws on top)
    if (cl == 80u) { cl = 30u; }
    c[k] = landColour(cl);
  }
  let jit = hashCell(vec3f(floor(p / 37.0), 0.0), 11u) * 0.08 - 0.04;
  return mix(mix(c[0], c[1], f.x), mix(c[2], c[3], f.x), f.y) * (1.18 + jit);
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let p = v.world.xy;
  let edge = max(abs(p.x), abs(p.y));
  // under the inner mesh; the outer stops one inner cell inside the inner
  // edge, so the two overlap and no ray passes between them
  if (M.level < 0.5 && edge < G.grid.x - 3.0 * G.grid.x / G.grid.z) { discard; }
  let t = G.terr.x;
  let night = G.sun.w;
  let L = normalize(G.sun.xyz);
  let V = normalize(G.eye.xyz - v.world);
  let amb = G.sunCol.w;
  let skyAmb = max(mix(G.skyH.rgb, G.skyZ.rgb, 0.5), vec3f(0.06, 0.07, 0.10) * night);

  // land
  let cls = coverAt(p);
  var land = landAt(p);
  let nL = normalize(mix(vec3f(0.0, 0.0, 1.0), v.nG, clamp(t * 1.5, 0.0, 1.0)));
  let sh = shadowAt(v.world, vec3f(0.0, 0.0, 1.0));
  let lamb = max(dot(nL, L), 0.0) * sh;
  var col = land * (G.sunCol.rgb * lamb + skyAmb * amb * (0.6 + 0.4 * nL.z));
  // contours on the land, only with the terrain overlay
  if (t > 0.01 && G.terr.y > 0.0) {
    let hh = v.ground / G.terr.y;
    let fw = max(fwidth(hh), 1e-4);
    let line = 1.0 - smoothstep(0.0, 1.2 * fw, abs(fract(hh + 0.5) - 0.5));
    let major = 1.0 - smoothstep(0.0, 1.2 * fw / 5.0, abs(fract(hh / 5.0 + 0.5) - 0.5));
    col = mix(col, col * 0.55 + vec3f(0.06), t * (0.25 * line + 0.35 * major) * smoothstep(1.0, 0.25, fw));
  }
  // street lights in built-up land after dusk
  if (night > 0.0 && cls == 50u) {
    let s = hashCell(vec3f(floor(p / 18.0), 1.0), 23u);
    col += night * vec3f(1.0, 0.72, 0.42) * 0.10 * smoothstep(0.55, 1.0, s);
  }

  // water
  let w = waterAt(p);
  if (w > 0.002) {
    let depth = max(v.surf - v.ground, 0.0);
    let deep = 1.0 - exp(-depth / mix(1e9, 30.0, t));
    var wc = mix(vec3f(0.07, 0.17, 0.22), vec3f(0.02, 0.05, 0.10), deep);
    // relief of the sea floor, seen through the water
    let lambB = max(dot(v.nG, L), 0.0);
    wc *= mix(1.0, 0.55 + 0.9 * lambB, t * exp(-depth / 120.0));
    var wl = wc * (G.sunCol.rgb * 0.55 * (0.4 + 0.6 * sh) + skyAmb * amb);
    // sky reflection and the sun glint on a flat surface
    let N = vec3f(0.0, 0.0, 1.0);
    let fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    wl = mix(wl, G.skyH.rgb * 0.9, fres * 0.6);
    let H = normalize(L + V);
    wl += G.sunCol.rgb * pow(max(dot(N, H), 0.0), 220.0) * 0.6 * (1.0 - night) * sh;
    // ocean speed tint
    if (O.ocean.x > 0.0) {
      let sp = length(oceanAt(p));
      wl = mix(wl, ramp(sp / max(O.oceanB.y, 0.05)) * 0.35, O.ocean.x * 0.35 * smoothstep(0.02, 0.3, sp / max(O.oceanB.y, 0.05)));
    }
    col = mix(col, wl, smoothstep(0.35, 0.65, w));
  }

  // wind heat map
  if (O.wind.x > 0.0 && O.wind.y > 0.0) {
    let wa = windAt(p);
    let sp = length(wa.xy) / max(O.windC.x, 0.1);
    let a = O.wind.x * O.wind.y * wa.w * (1.0 - wa.z) * 0.34;
    col = mix(col, ramp(sqrt(sp)) * 0.85, a);    // square root: slow streets still show
  }

  col = fogMix(col, distance(G.eye.xyz, v.world), v.world.z);
  return vec4f(col, 1.0);
}
