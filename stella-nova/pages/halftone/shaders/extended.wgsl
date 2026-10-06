// ============================================================================
//  HALFTONE  ·  shaders/extended.wgsl — this page's extensions (not upstream)
// ----------------------------------------------------------------------------
//  The "extended" mode of the page. It is our own code, built on the port in
//  halftone.wgsl (snoise and aastep). gpu.js compiles halftone.wgsl, this
//  file and present.wgsl as one module. With the default Ext values, the
//  result is the upstream result, except for two things: the angles use
//  exact cos and sin (upstream rounds them to 0.707, 0.966, 0.259), and the
//  inks multiply (upstream subtracts; for the default inks the two are equal).
//
//  EXTENSIONS
//    angles ....... a screen angle for each plate (C, M, Y, K), plus a
//                   rotation of all four (the caller adds it)
//    shape ........ dot shape: 0 round (upstream), 1 ellipse, 2 line,
//                   3 square
//    gain ......... dot gain: ink + gain * 2 ink (1 - ink), the mid tones grow
//    grain ........ the amount (1 = upstream) and scale of the noise that
//                   upstream adds to the paper and to the dot edges
//    mono ......... one K screen of the luma (Rec. 601), no C, M, Y
//    inks, paper .. the colour of each ink (rgb, and the strength in a);
//                   each ink multiplies the paper where its dot is
//    misregistration: misreg_offset moves each plate by part of a screen
//                   cell; the caller samples the image once per plate
//
//  grep -n: "struct Ext"  "fn misreg_offset"  "fn dot_dist"  "fn halftone_ext"
// ============================================================================

struct Ext {
  frequency: f32,
  shape: f32,       // 0 round, 1 ellipse, 2 line, 3 square
  gain: f32,        // dot gain, 0 = none
  mono: f32,        // 1 = one K screen of the luma
  angles: vec4f,    // C, M, Y, K screen angles in radians
  grain: vec2f,     // amount (1 = upstream), scale (1 = upstream)
  misreg: f32,      // plate offset, in screen cells
  pad: f32,
  ink_c: vec4f,     // rgb, strength
  ink_m: vec4f,
  ink_y: vec4f,
  ink_k: vec4f,     // upstream black is 0.1 at strength 0.85
  paper: vec4f,     // rgb, unused
}

// The offset of plate i (0 C, 1 M, 2 Y, 3 K) in st units. K stays in place.
fn misreg_offset(i: u32, e: Ext) -> vec2f {
  var dir = array<vec2f, 4>(vec2f(0.8, 0.35), vec2f(-0.55, 0.75), vec2f(0.25, -0.9), vec2f(0.0, 0.0));
  return dir[i] * (e.misreg / e.frequency);
}

// 2 fract(frequency R st) - 1: the position in the screen cell, -1..1.
// R has the layout of the upstream mat2 (columns first): angle 45 degrees
// gives mat2x2f(0.7071, -0.7071, 0.7071, 0.7071), the upstream K matrix.
fn screen_uv(st: vec2f, angle: f32, frequency: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  let q = frequency * mat2x2f(c, -s, s, c) * st;
  return 2.0 * fract(q) - 1.0;
}

// The distance that the dot edge is measured in, for each shape.
fn dot_dist(uv: vec2f, shape: f32) -> f32 {
  let round_d = length(uv);
  let ellipse_d = length(uv * vec2f(0.8, 1.25));
  let line_d = abs(uv.y);
  let square_d = max(abs(uv.x), abs(uv.y));
  return select(select(select(round_d, ellipse_d, shape > 0.5), line_d, shape > 1.5), square_d, shape > 2.5);
}

// The dot size for an ink coverage: sqrt for the area shapes (upstream),
// linear for lines. Lines and squares get 8 percent more, so that full ink
// closes the gaps between the cells. Round and ellipse dots keep the
// upstream size: at full ink, their corners stay open, as upstream.
fn dot_size(ink: f32, e: Ext) -> f32 {
  let g = clamp(ink + e.gain * 2.0 * ink * (1.0 - ink), 0.0, 1.0);
  let size = select(sqrt(g), g, e.shape > 1.5 && e.shape < 2.5);
  return size * select(1.0, 1.08, e.shape > 1.5);
}

fn rgb_to_cmyk(t: vec3f) -> vec4f {
  let cmy = 1.0 - t;
  let k = min(cmy.x, min(cmy.y, cmy.z));
  return vec4f(cmy - k, k);
}

// tc, tm, ty, tk: the image colour under each plate (the caller samples it
// at st + misreg_offset). st: the upstream coordinate.
fn halftone_ext(tc: vec3f, tm: vec3f, ty: vec3f, tk: vec3f, st: vec2f, e: Ext) -> vec3f {
  let gs = st * e.grain.y;
  var n = 0.1 * snoise(gs * 200.0);
  n += 0.05 * snoise(gs * 400.0);
  n += 0.025 * snoise(gs * 800.0);
  n *= e.grain.x;

  let F = e.frequency;
  let ink_c = rgb_to_cmyk(tc).x;
  let ink_m = rgb_to_cmyk(tm).y;
  let ink_y = rgb_to_cmyk(ty).z;
  let luma = 1.0 - dot(tk, vec3f(0.299, 0.587, 0.114));
  let ink_k = select(rgb_to_cmyk(tk).w, luma, e.mono > 0.5);

  let k = aastep(0.0, dot_size(ink_k, e) - dot_dist(screen_uv(st + misreg_offset(3u, e), e.angles.w, F), e.shape) + n);
  let c = aastep(0.0, dot_size(ink_c, e) - dot_dist(screen_uv(st + misreg_offset(0u, e), e.angles.x, F), e.shape) + n);
  let m = aastep(0.0, dot_size(ink_m, e) - dot_dist(screen_uv(st + misreg_offset(1u, e), e.angles.y, F), e.shape) + n);
  let y = aastep(0.0, dot_size(ink_y, e) - dot_dist(screen_uv(st + misreg_offset(2u, e), e.angles.z, F), e.shape) + n);

  let cmy_on = 1.0 - e.mono;
  var col = e.paper.rgb;
  col *= mix(vec3f(1.0), e.ink_c.rgb, c * e.ink_c.a * cmy_on);
  col *= mix(vec3f(1.0), e.ink_m.rgb, m * e.ink_m.a * cmy_on);
  col *= mix(vec3f(1.0), e.ink_y.rgb, y * e.ink_y.a * cmy_on);
  col += vec3f(n);
  let black = e.ink_k.rgb + n;
  let kw = select(e.ink_k.a, 1.0, e.mono > 0.5);
  return mix(col, black, vec3f(kw * k + 0.3 * n));
}
