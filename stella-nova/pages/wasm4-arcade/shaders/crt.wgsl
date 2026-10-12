// ============================================================================
//  WASM-4 ARCADE  ·  shaders/crt.wgsl — the CRT tube and its bezel
// ----------------------------------------------------------------------------
//  One full-canvas triangle. The fragment shader draws two things:
//    bezel   dark moulded plastic over the cabinet rect U.box, a bevel and a
//            recess around the glass, rounded outer corners (alpha 0
//            outside them)
//    glass   the 160 x 160 picture through a CRT model:
//              barrel curvature of the glass (k = strength)
//              one Gaussian beam per picture row (scanlines); a bright
//              row makes a wider beam, as on a real tube
//              three horizontal taps per row (beam spread)
//              an aperture-grille mask (RGB stripes in device px)
//              bloom: 12 bilinear taps of the small texture
//              vignette, a rolling hum bar, 60 Hz flicker, a glass glint
//              static (channel change) and the power-on line
//  When U.fx is 0 (CRT off), the glass shows the plain pixels, flat.
//
//  The style follows the 2D tube of pages/sstv/crt.js (bezel colours,
//  vignette and glint). No mixed * and ^, and no mixed && and || without
//  parentheses (Tint refuses them, naga does not).
//
//  grep -n targets  "struct U"  "fn picture"  "fn bezel"  "fn fs_main"
// ============================================================================

struct U {
  res: vec2f,      // canvas size in device px
  time: f32,       // s
  fx: f32,         // CRT strength 0..1 (0 = CRT off)
  scr: vec4f,      // glass rect in device px: x, y, w, h
  stat: f32,       // static 0..1 (channel change)
  power: f32,      // 0..1 power-on (1 = on)
  radius: f32,     // outer corner radius in px
  dpr: f32,        // device px per CSS px
  box: vec4f,      // cabinet rect in device px (bezel outer edge)
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;

struct VO { @builtin(position) pos: vec4f };

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VO;
  o.pos = vec4f(p[i], 0.0, 1.0);
  return o;
}

fn hash(v: vec2f) -> f32 {
  return fract(sin(dot(v, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn sd_round_box(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn texel(ix: i32, iy: i32) -> vec3f {
  let c = vec2i(clamp(ix, 0, 159), clamp(iy, 0, 159));
  return textureLoad(tex, c, 0).rgb;
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

// One row of the picture at x (texel units), spread by three taps.
fn row_color(x: f32, iy: i32) -> vec3f {
  let ix = i32(floor(x));
  let f = fract(x) - 0.5;
  let w0 = exp(-((f + 1.0) * (f + 1.0)) * 2.2);
  let w1 = exp(-(f * f) * 2.2);
  let w2 = exp(-((f - 1.0) * (f - 1.0)) * 2.2);
  let s = texel(ix - 1, iy) * w0 + texel(ix, iy) * w1 + texel(ix + 1, iy) * w2;
  return s / (w0 + w1 + w2);
}

// The beam profile of one row at a distance d (in rows) from its centre.
fn beam(c: vec3f, d: f32) -> vec3f {
  let w = mix(0.24, 0.42, luma(c));
  return c * exp(-(d * d) / (2.0 * w * w));
}

// The picture at glass coordinate g (0..1), with the CRT model at strength k.
fn picture(g: vec2f, k: f32, px: vec2f) -> vec3f {
  let t = g * 160.0;
  let plain = texel(i32(floor(t.x)), i32(floor(t.y)));
  if (k <= 0.0) { return plain; }
  let iy = i32(floor(t.y));
  let fy = fract(t.y) - 0.5;
  var nb = iy + 1;
  if (fy < 0.0) { nb = iy - 1; }
  let ca = row_color(t.x, iy);
  let cb = row_color(t.x, nb);
  var col = beam(ca, fy) + beam(cb, 1.0 - abs(fy));
  col = col * 1.55;
  // aperture grille, 3 device px per triad
  let m = i32(floor(px.x)) % 3;
  var mask = vec3f(1.0, 0.72, 0.72);
  if (m == 1) { mask = vec3f(0.72, 1.0, 0.72); }
  if (m == 2) { mask = vec3f(0.72, 0.72, 1.0); }
  col = col * mix(vec3f(1.0), mask * 1.18, 0.75 * k);
  // bloom from the small texture
  var b = vec3f(0.0);
  for (var i = 0; i < 12; i = i + 1) {
    let a = f32(i) * 0.5236;
    var r = 1.6;
    if (i % 2 == 1) { r = 3.6; }
    b = b + textureSampleLevel(tex, smp, g + vec2f(cos(a), sin(a)) * (r / 160.0), 0.0).rgb;
  }
  b = b / 12.0;
  col = col + b * b * 0.55 * k;
  return mix(plain, col, k);
}

fn bezel(p: vec2f, dglass: f32) -> vec4f {
  let y = (p.y - u.box.y) / u.box.w;
  var c = mix(vec3f(0.17, 0.165, 0.152), vec3f(0.06, 0.058, 0.054), y);
  // fine grain of the plastic
  c = c + (hash(floor(p * 0.5)) - 0.5) * 0.012;
  // bevel and recess round the glass (dglass in px outside the glass)
  let e = 0.018 * min(u.box.z, u.box.w);
  let rim = 1.0 - smoothstep(0.0, e, dglass);
  c = mix(c, vec3f(0.012), rim * 0.92);
  let lip = smoothstep(e * 0.9, e * 1.05, dglass) * (1.0 - smoothstep(e * 1.05, e * 1.6, dglass));
  c = c + vec3f(0.06) * lip * (1.0 - y);
  // outer edge highlight and rounded outer corners
  let hs = u.box.zw * 0.5;
  let dout = sd_round_box(p - u.box.xy - hs, hs - vec2f(1.0), u.radius);
  let edge = 1.0 - smoothstep(0.0, 3.0 * u.dpr, -dout);
  c = c + vec3f(0.07) * edge;
  let a = 1.0 - smoothstep(-1.0, 0.5, dout);
  return vec4f(c * a, a);
}

@fragment
fn fs_main(v: VO) -> @location(0) vec4f {
  let p = v.pos.xy;
  let k = clamp(u.fx, 0.0, 1.0);
  let uv = (p - u.scr.xy) / u.scr.zw;
  var c = uv * 2.0 - vec2f(1.0);
  // barrel curvature of the glass
  let cw = c * (vec2f(1.0) + (c.yx * c.yx) * (0.11 * k));
  let rr = 0.035 + 0.05 * k;
  let dg = sd_round_box(cw, vec2f(1.0), rr);
  let pxs = 0.5 * min(u.scr.z, u.scr.w);
  if (dg > 0.0) {
    return bezel(p, dg * pxs);
  }
  var g = cw * 0.5 + vec2f(0.5);
  // power-on: the picture grows out of a bright line
  let pw = clamp(u.power, 0.0, 1.0);
  let sq = max(pw * pw, 0.004);
  let gy = (g.y - 0.5) / sq + 0.5;
  var col = vec3f(0.0);
  if (gy >= 0.0 && gy <= 1.0) {
    col = picture(vec2f(g.x, gy), k, p);
  }
  if (pw < 1.0) {
    let ln = exp(-pow((g.y - 0.5) / (0.004 + 0.06 * sq), 2.0));
    col = col * smoothstep(0.0, 0.6, pw) + vec3f(0.85, 0.95, 1.0) * ln * (1.0 - pw) * 1.4;
  }
  // static of a channel change: snow, a roll and a grey lift
  let st = clamp(u.stat, 0.0, 1.0);
  if (st > 0.0) {
    let cell = floor(p / (1.5 * u.dpr));
    let n = hash(cell + vec2f(floor(u.time * 60.0) * 7.31, 3.7));
    let roll = smoothstep(0.0, 0.08, abs(fract(g.y + u.time * 1.7) - 0.5) - 0.38);
    col = mix(col, vec3f(n) * (0.75 + 0.25 * roll), st);
  }
  // hum bar, flicker, vignette and glint (only with the CRT on)
  let hb = exp(-pow((fract(u.time * 0.07) * 1.4 - 0.2 - g.y) / 0.12, 2.0));
  col = col * (1.0 + 0.035 * k * hb);
  col = col * (1.0 - 0.03 * k * (0.5 + 0.5 * sin(u.time * 377.0) * sin(u.time * 13.3)));
  let vig = 1.0 - 0.55 * k * pow(length(cw) * 0.72, 3.0);
  col = col * clamp(vig, 0.0, 1.0);
  let glint = exp(-pow(length((g - vec2f(0.3, 0.16)) * vec2f(1.0, 3.2)) / 0.32, 2.0));
  col = col + vec3f(0.05) * glint * k + vec3f(0.018) * (1.0 - g.y) * k;
  // a soft dark edge inside the glass
  let inner = smoothstep(-0.05, 0.0, dg);
  col = col * (1.0 - 0.7 * inner * k);
  // dark phosphor glass when the picture is black
  col = max(col, vec3f(0.018, 0.02, 0.019) * k);
  return vec4f(col, 1.0);
}
