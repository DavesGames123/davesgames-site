// render.wgsl - draw the display field to the canvas.
// The field (from prep.wgsl) holds t = normalized value and its gradient.
// The program maps each canvas pixel to a grid position, samples the field,
// looks up the colormap, and can shade the field as a lit height map.
// A periodic grid repeats to fill the canvas. Other grids show a background.

struct RenderU {
  v0: vec4<f32>,  // canvas w, canvas h, grid w, grid h
  v1: vec4<f32>,  // origin x, origin y (canvas px of grid cell 0,0), px per cell, tile (0/1)
  v2: vec4<f32>,  // height (0/1), colormap row v, light angle (rad), height scale
  v3: vec4<f32>,  // background rgb, smooth (0/1)
};
@group(0) @binding(0) var<uniform> R: RenderU;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var fieldSampler: sampler;   // linear, repeat
@group(0) @binding(3) var cmap: texture_2d<f32>;
@group(0) @binding(4) var cmapSampler: sampler;    // linear, clamp

struct VOut { @builtin(position) pos: vec4<f32> };

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

fn tap(uv: vec2<f32>) -> vec4<f32> {
  var q = uv;
  if (R.v1.w < 0.5) {
    // Clamp to the edge texel centers so a non-periodic grid does not wrap.
    let half = 0.5 / R.v0.zw;
    q = clamp(uv, half, 1.0 - half);
  }
  return textureSampleLevel(field, fieldSampler, q, 0.0);
}

// Cubic B-spline filter made of four bilinear taps. It gives a smooth
// surface when one grid cell covers many pixels.
fn sample_smooth(uv: vec2<f32>) -> vec4<f32> {
  let size = R.v0.zw;
  let st = uv * size - 0.5;
  let i = floor(st);
  let f = st - i;
  let f2 = f * f;
  let f3 = f2 * f;
  let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  let w3 = f3 / 6.0;
  let g0 = w0 + w1;
  let g1 = w2 + w3;
  let p0 = (i - 0.5 + w1 / g0) / size;
  let p1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * tap(vec2<f32>(p0.x, p0.y)) + g1.x * tap(vec2<f32>(p1.x, p0.y)))
       + g1.y * (g0.x * tap(vec2<f32>(p0.x, p1.y)) + g1.x * tap(vec2<f32>(p1.x, p1.y)));
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let cell = (in.pos.xy - R.v1.xy) / R.v1.z;
  let uv = cell / R.v0.zw;
  if (R.v1.w < 0.5 && (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0)) {
    return vec4<f32>(R.v3.rgb, 1.0);
  }
  var s: vec4<f32>;
  if (R.v3.w > 0.5) { s = sample_smooth(uv); } else { s = tap(uv); }
  let t = clamp(s.x, 0.0, 1.0);
  var col = textureSampleLevel(cmap, cmapSampler, vec2<f32>(t * (255.0 / 256.0) + 0.5 / 256.0, R.v2.y), 0.0).rgb;
  if (R.v2.x > 0.5) {
    // Height field z = hs * t, in cell units. Screen y points down.
    let hs = R.v2.w;
    let n = normalize(vec3<f32>(-hs * s.y, -hs * s.z, 1.0));
    let a = R.v2.z;
    let l = normalize(vec3<f32>(cos(a), -sin(a), 1.1));
    let hv = normalize(l + vec3<f32>(0.0, 0.0, 1.0));
    let ndl = max(dot(n, l), 0.0);
    // Soft Lambert, scaled so that a flat area keeps the colormap color.
    let shade = (0.28 + 0.72 * ndl) / (0.28 + 0.72 * l.z);
    let spec = pow(max(dot(n, hv), 0.0), 48.0) - pow(hv.z, 48.0);
    col = col * shade + vec3<f32>(0.32 * max(spec, 0.0));
    // A little rim darkening in steep valleys gives depth.
    col = col * mix(0.82, 1.0, n.z);
  }
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
