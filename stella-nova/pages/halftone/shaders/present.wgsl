// ============================================================================
//  HALFTONE  ·  shaders/present.wgsl — the view: image, halftone, split, loupe
// ----------------------------------------------------------------------------
//  One full-screen triangle. gpu.js compiles halftone.wgsl + extended.wgsl +
//  this file as one module. The same pipeline draws the canvas and the
//  off-screen PNG export (view = the whole target, img.w = 1: lod 0).
//
//  Each pixel maps to an image uv through the view rectangle (pan and zoom),
//  or through the loupe (a circle that shows the image at loupe.w times the
//  view scale). The halftone is a function of uv, so a zoom or the loupe
//  computes new dots at the new scale; nothing is a scaled copy.
//
//  UNIFORMITY. halftone() and halftone_ext() call dpdx and dpdy, so the
//  shader picks per pixel with select() after the calls, never with a
//  branch before them. The upstream / extended branch reads a uniform.
//
//  grep -n: "struct U"  "fn src_color"  "fn fs_main"  "fn vs_main"
// ============================================================================

struct U {
  canvas: vec4f,   // target w, h (px), time (s), fade 0..1
  view: vec4f,     // image rectangle on the target, px: x, y, w, h
  img: vec4f,      // source w, h, aspect w / h, exact (1: lod 0, export)
  ht: vec4f,       // frequency, mode (0 upstream, 1 extended), split x px (< 0: off), 0
  loupe: vec4f,    // centre x, y px, radius px (0: off), magnification
  bg: vec4f,       // the colour outside the image
  ext: Ext,        // extended.wgsl parameters
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn src_color(uv: vec2f, lod: f32) -> vec3f {
  return textureSampleLevel(src, smp, uv, lod).rgb;
}

@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let lc = u.loupe.xy;
  let in_loupe = (u.loupe.z > 0.0) & (distance(pos.xy, lc) < u.loupe.z);
  let p = select(pos.xy, lc + (pos.xy - lc) / max(u.loupe.w, 1.0), in_loupe);
  let uv = (p - u.view.xy) / u.view.zw;

  // Mip level from the texel footprint of one pixel (0 in exact mode).
  let tx = uv * u.img.xy;
  let foot = max(length(dpdx(tx)), length(dpdy(tx)));
  let lod = select(max(0.0, log2(max(foot, 1e-6))), 0.0, u.img.w > 0.5);

  let tex = src_color(uv, lod);
  let st = vec2f(uv.x * u.img.z, 1.0 - uv.y);
  var ht: vec3f;
  if (u.ht.y < 0.5) {
    ht = halftone(tex, st, u.ht.x);
  } else {
    let e = u.ext;
    let a = vec2f(1.0 / u.img.z, -1.0);   // st offset -> uv offset
    let tc = src_color(uv + misreg_offset(0u, e) * a, lod);
    let tm = src_color(uv + misreg_offset(1u, e) * a, lod);
    let ty = src_color(uv + misreg_offset(2u, e) * a, lod);
    ht = halftone_ext(tc, tm, ty, tex, st, e);
  }

  // The split: the original image left of the line.
  let orig = (u.ht.z >= 0.0) & (p.x < u.ht.z);
  var col = select(ht, tex, orig);
  let inside = all(uv >= vec2f(0.0)) & all(uv <= vec2f(1.0));
  col = select(u.bg.rgb, col, inside);

  // The split line (outside the loupe) and the loupe ring.
  let line_d = abs(pos.x - u.ht.z);
  let on_line = (u.ht.z >= 0.0) & (line_d < 1.0) & !in_loupe;
  col = select(col, vec3f(1.0, 0.78, 0.2), on_line);
  let ring_d = abs(distance(pos.xy, lc) - u.loupe.z);
  let on_ring = (u.loupe.z > 0.0) & (ring_d < 1.6);
  col = select(col, vec3f(1.0, 0.78, 0.2), on_ring);
  let shade = (u.loupe.z > 0.0) & (ring_d < 5.0) & !in_loupe & !on_ring;
  col = select(col, col * 0.35, shade);

  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)) * u.canvas.w, 1.0);
}
