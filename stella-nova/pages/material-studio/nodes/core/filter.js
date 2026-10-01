// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/filter.js — core library: filter
// ────────────────────────────────────────────────────────────────────────────
//  Image filter pass nodes that sample their input at other uv: blurs,
//  sharpen, high pass, edges, slope blur, warps, morphology, tileable
//  blend, auto levels, emboss and pixelate. spiral() writes the golden-
//  angle disc loop.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'filter.gaussian1d' 'filter.blur' 'filter.quickBlur'
//                   'filter.sharpen' 'filter.highPass' 'filter.edgeDetect'
//                   'filter.slopeBlur' 'filter.directionalWarp' 'filter.warp'
//                   'filter.directionalBlur' 'filter.morph' 'filter.makeTileable'
//                   'filter.autoLevels' 'filter.emboss' 'filter.pixelate'
//      helpers .... AXES spiral
// ============================================================================
import { fP, v2P, IN_C, O, S, I, E, B, ix, def, pass } from './build.js';

const AXES = ['x', 'y'];
def('filter.gaussian1d', 'Blur 1D', 'Filter', [IN_C], [O('out', 'Output', 'color')],
  [E('axis', 'Axis', AXES), S('radius', 'Radius', 0, 0.25, 0.01, 0.0005)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let sigma = max(${c.params.radius}, 0.000001);
  let px = 1.0 / ${c.res};
  let span = sigma * 3.0;
  let n = clamp(i32(ceil(span / px)), 1, 48);
  let stp = span / f32(n);
  let dir = ${c.values.axis === 'y' ? 'vec2f(0.0, 1.0)' : 'vec2f(1.0, 0.0)'};
  var acc = ${c.sample.in('uv')};
  var ws = 1.0;
  for (var i = 1; i <= n; i++) {
    let x = f32(i) * stp;
    let w = exp(-0.5 * (x * x) / (sigma * sigma));
    acc += (${c.sample.in('uv + (dir * x)')} + ${c.sample.in('uv - (dir * x)')}) * w;
    ws += 2.0 * w;
  }
  return vec4f(acc / ws, 1.0);
}`), 'Separable Gaussian blur along one axis.', { tags: ['gaussian'] });

def('filter.blur', 'Blur', 'Filter', [IN_C], [O('out', 'Output', 'color')], [S('radius', 'Radius', 0, 0.25, 0.01, 0.0005)],
  { expand: v => ({
    nodes: [{ id: 'x', type: 'filter.gaussian1d', params: { axis: 'x', radius: v.radius } },
      { id: 'y', type: 'filter.gaussian1d', params: { axis: 'y', radius: v.radius } }],
    links: [{ from: ['x', 'out'], to: ['y', 'in'] }],
    inputs: { in: [['x', 'in']] }, outputs: { out: ['y', 'out'] },
  }) }, 'Two-pass Gaussian blur (radius = sigma in tile uv).', { tags: ['gaussian', 'soften'] });

/** Golden-angle spiral taps over a disc of radius R (uv): WGSL loop text. */
const spiral = (n, R, body) => `
  for (var i = 0; i < ${n}; i++) {
    let fi = f32(i) + 0.5;
    let rr = sqrt(fi / ${n}.0);
    let an = fi * 2.3999632;
    let off = vec2f(cos(an), sin(an)) * (rr * ${R});
    ${body}
  }`;

def('filter.quickBlur', 'Quick Blur', 'Filter', [IN_C], [O('out', 'Output', 'color')], [S('radius', 'Radius', 0, 0.25, 0.01, 0.0005)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  var acc = vec3f(0.0);
  var ws = 0.0;${spiral(64, c.params.radius, `let w = exp(-2.0 * rr * rr);
    acc += ${c.sample.in('uv + off')} * w;
    ws += w;`)}
  return vec4f(acc / ws, 1.0);
}`), 'One-pass 64-tap disc blur: cheaper, slightly grainy at large radii.');

def('filter.sharpen', 'Sharpen', 'Filter', [IN_C], [O('out', 'Output', 'color')],
  [S('amount', 'Amount', 0, 4, 1), S('radius', 'Radius', 0, 0.02, 0.002, 0.0001)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let r = max(${c.params.radius}, 1.0 / ${c.res});
  let c0 = ${c.sample.in('uv')};
  var b = vec3f(0.0);
  for (var i = 0; i < 8; i++) {
    let a = f32(i) * 0.78539816;
    b += ${c.sample.in('uv + (vec2f(cos(a), sin(a)) * r)')};
  }
  return vec4f(c0 + ((c0 - (b / 8.0)) * ${c.params.amount}), 1.0);
}`), 'Unsharp mask.', { tags: ['detail'] });

def('filter.highPass', 'High Pass', 'Filter', [IN_C], [O('out', 'Output', 'color')], [S('radius', 'Radius', 0, 0.25, 0.02, 0.0005), S('gain', 'Gain', 0, 8, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  var acc = vec3f(0.0);
  var ws = 0.0;${spiral(64, c.params.radius, `let w = exp(-2.0 * rr * rr);
    acc += ${c.sample.in('uv + off')} * w;
    ws += w;`)}
  return vec4f(((${c.sample.in('uv')} - (acc / ws)) * ${c.params.gain}) + vec3f(0.5), 1.0);
}`), 'Detail only: input minus its blur, centered on 0.5.', { tags: ['detail', 'flatten'] });

def('filter.edgeDetect', 'Edge Detect', 'Filter', [IN_C], [O('out', 'Edges', 'float', 'r')],
  [S('width', 'Width', 0, 0.02, 0.002, 0.0001), S('strength', 'Strength', 0, 10, 1)],
  pass(c => {
    const L = q => `ms_lum(${c.sample.in(q)})`;
    return `
fn pass_main(uv: vec2f) -> vec4f {
  let e = max(${c.params.width}, 1.0 / ${c.res});
  let a = ${L('uv + vec2f(-e, -e)')}; let b = ${L('uv + vec2f(0.0, -e)')}; let cc = ${L('uv + vec2f(e, -e)')};
  let d = ${L('uv + vec2f(-e, 0.0)')}; let f = ${L('uv + vec2f(e, 0.0)')};
  let g = ${L('uv + vec2f(-e, e)')}; let h = ${L('uv + vec2f(0.0, e)')}; let k = ${L('uv + vec2f(e, e)')};
  let gx = (cc + (2.0 * f) + k) - (a + (2.0 * d) + g);
  let gy = (g + (2.0 * h) + k) - (a + (2.0 * b) + cc);
  let m = clamp(length(vec2f(gx, gy)) * ${c.params.strength}, 0.0, 1.0);
  return vec4f(vec3f(m), 1.0);
}`;
  }), 'Sobel edge magnitude of the luminance.', { tags: ['sobel', 'outline'] });

def('filter.slopeBlur', 'Slope Blur', 'Filter', [IN_C, fP('slope', 'Slope', 0.5)], [O('out', 'Output', 'color')],
  [S('intensity', 'Intensity', -0.2, 0.2, 0.03, 0.0005), I('samples', 'Samples', 1, 64, 16), E('mode', 'Mode', ['blur', 'min', 'max'])],
  pass(c => {
    const m = ix(c, 'mode', ['blur', 'min', 'max']);
    return `
fn pass_main(uv: vec2f) -> vec4f {
  let px = 1.0 / ${c.res};
  let n = clamp(i32(${c.params.samples}), 1, 64);
  let stp = ${c.params.intensity} / f32(n);
  var p = uv;
  let c0 = ${c.sample.in('uv')};
  var acc = c0; var mn = c0; var mx = c0;
  for (var i = 0; i < n; i++) {
    let gx = ${c.sample.slope('p + vec2f(px, 0.0)')} - ${c.sample.slope('p - vec2f(px, 0.0)')};
    let gy = ${c.sample.slope('p + vec2f(0.0, px)')} - ${c.sample.slope('p - vec2f(0.0, px)')};
    let g = vec2f(gx, gy);
    let l = length(g);
    p = p - (select(vec2f(0.0), g / max(l, 0.000001), l > 0.000001) * stp);
    let v = ${c.sample.in('p')};
    acc += v; mn = min(mn, v); mx = max(mx, v);
  }
  return vec4f(${['acc / f32(n + 1)', 'mn', 'mx'][m]}, 1.0);
}`;
  }), 'Smear the input along the slope of a second map: erosion, drips, melted edges.', { tags: ['erosion', 'smudge'] });

def('filter.directionalWarp', 'Directional Warp', 'Filter', [IN_C, fP('intensity', 'Intensity', 1)], [O('out', 'Output', 'color')],
  [S('amount', 'Amount', -0.5, 0.5, 0.05, 0.0005), S('angle', 'Angle', -180, 180, 0, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let a = radians(${c.params.angle});
  let o = vec2f(cos(a), sin(a)) * (${c.sample.intensity('uv')} * ${c.params.amount});
  return vec4f(${c.sample.in('uv + o')}, 1.0);
}`), 'Offset the input along an angle, scaled by an intensity map.', { tags: ['distort'] });

def('filter.warp', 'Vector Warp', 'Filter', [IN_C, v2P('vector', 'Vector', [0.5, 0.5])], [O('out', 'Output', 'color')],
  [S('amount', 'Amount', -1, 1, 0.1, 0.001), B('centered', 'Vector Centered on 0.5', true)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let v = ${c.sample.vector('uv')};
  let o = select(v, v - vec2f(0.5), ${c.params.centered} > 0.5) * ${c.params.amount};
  return vec4f(${c.sample.in('uv + o')}, 1.0);
}`), 'Offset the input by a vector map (flow map, warp vector).', { tags: ['distort', 'flow'] });

def('filter.directionalBlur', 'Directional Blur', 'Filter', [IN_C], [O('out', 'Output', 'color')],
  [S('length', 'Length', 0, 0.25, 0.03, 0.0005), S('angle', 'Angle', -180, 180, 0, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let a = radians(${c.params.angle});
  let d = vec2f(cos(a), sin(a)) * ${c.params.length};
  var acc = vec3f(0.0);
  for (var i = 0; i < 33; i++) {
    let t = (f32(i) / 32.0) - 0.5;
    acc += ${c.sample.in('uv + (d * t)')};
  }
  return vec4f(acc / 33.0, 1.0);
}`), 'Motion blur along an angle.', { tags: ['motion', 'streak'] });

def('filter.morph', 'Dilate / Erode', 'Filter', [IN_C], [O('out', 'Output', 'color')],
  [E('mode', 'Mode', ['dilate', 'erode']), S('radius', 'Radius', 0, 0.1, 0.005, 0.0001)],
  pass(c => {
    const er = c.values.mode === 'erode';
    return `
fn pass_main(uv: vec2f) -> vec4f {
  var m = ${c.sample.in('uv')};${spiral(48, c.params.radius, `m = ${er ? 'min' : 'max'}(m, ${c.sample.in('uv + off')});`)}
  return vec4f(m, 1.0);
}`;
  }), 'Grow (max) or shrink (min) bright areas over a disc.', { tags: ['grow', 'shrink', 'morphology'] });

def('filter.makeTileable', 'Make Tileable', 'Filter', [IN_C], [O('out', 'Output', 'color')],
  [S('width', 'Blend Width', 0.01, 0.5, 0.2)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let q = fract(uv);
  let e = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
  let w = 1.0 - smoothstep(0.0, ${c.params.width}, e);
  return vec4f(mix(${c.sample.in('q')}, ${c.sample.in('q + vec2f(0.5)')}, w), 1.0);
}`), 'Hide the tile seam: cross-fade toward a half-offset copy near the borders.', { tags: ['seamless'] });

def('filter.autoLevels', 'Auto Levels', 'Filter', [IN_C], [O('out', 'Output', 'color')], [],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  var mn = 1e9; var mx = -1e9;
  for (var y = 0; y < 16; y++) {
    for (var x = 0; x < 16; x++) {
      let l = ms_lum(${c.sample.in('(vec2f(f32(x), f32(y)) + vec2f(0.5)) / 16.0')});
      mn = min(mn, l); mx = max(mx, l);
    }
  }
  return vec4f((${c.sample.in('uv')} - vec3f(mn)) / max(mx - mn, 0.0001), 1.0);
}`), 'Stretch the range to 0..1 (16 x 16 sample estimate).', { tags: ['normalize', 'stretch'] });

def('filter.emboss', 'Emboss', 'Filter', [fP('height', 'Height', 0.5)], [O('out', 'Shade', 'float', 'r')],
  [S('angle', 'Light Angle', -180, 180, 135, 1), S('strength', 'Strength', 0, 20, 4)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let a = radians(${c.params.angle});
  let d = vec2f(cos(a), sin(a)) / ${c.res};
  let s = (${c.sample.height('uv + d')} - ${c.sample.height('uv - d')}) * ${c.params.strength} * (${c.res} / 64.0);
  return vec4f(vec3f(clamp(0.5 + s, 0.0, 1.0)), 1.0);
}`), 'Directional relief shading of a height map.', { tags: ['relief', 'bevel'] });

def('filter.pixelate', 'Pixelate', 'Filter', [IN_C], [O('out', 'Output', 'color')], [I('cells', 'Cells', 2, 512, 32)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let n = max(${c.params.cells}, 1.0);
  return vec4f(${c.sample.in('(floor(uv * n) + vec2f(0.5)) / n')}, 1.0);
}`), 'Sample once per block.', { tags: ['mosaic', 'blocks'] });
