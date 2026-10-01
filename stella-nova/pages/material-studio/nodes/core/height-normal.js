// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/height-normal.js — core library: height & normal
// ────────────────────────────────────────────────────────────────────────────
//  Nodes that make or change height and normal maps: height to normal,
//  normal blends and edits, normal to height, AO, curvature, slope and
//  height blend.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'hn.heightToNormal' 'hn.normalBlend' 'hn.normalStrength'
//                   'hn.normalInvertY' 'hn.normalNormalize' 'hn.normalRotate'
//                   'hn.normalToHeight' 'hn.aoFromHeight' 'hn.curvature'
//                   'hn.slope' 'hn.heightBlend'
//      helpers .... NBLEND
// ============================================================================
import { fP, cP, nP, O, S, E, B, ix, def, pass } from './build.js';

def('hn.heightToNormal', 'Height to Normal', 'Height & Normal', [fP('height', 'Height', 0.5)], [O('normal', 'Normal', 'normal', 'rgb')],
  [S('strength', 'Strength', 0, 20, 1, 0.01), E('format', 'Green Channel', ['opengl', 'directx'], 'opengl'), E('filter', 'Filter', ['sobel', 'central'])],
  pass(c => {
    const H = q => c.sample.height(q);
    const sob = c.values.filter !== 'central';
    return `
fn pass_main(uv: vec2f) -> vec4f {
  let e = 1.0 / ${c.res};
  ${sob ? `let h00 = ${H('uv + vec2f(-e, -e)')}; let h10 = ${H('uv + vec2f(0.0, -e)')}; let h20 = ${H('uv + vec2f(e, -e)')};
  let h01 = ${H('uv + vec2f(-e, 0.0)')}; let h21 = ${H('uv + vec2f(e, 0.0)')};
  let h02 = ${H('uv + vec2f(-e, e)')}; let h12 = ${H('uv + vec2f(0.0, e)')}; let h22 = ${H('uv + vec2f(e, e)')};
  let du = ((h20 + (2.0 * h21) + h22) - (h00 + (2.0 * h01) + h02)) / (8.0 * e);
  let dv = ((h02 + (2.0 * h12) + h22) - (h00 + (2.0 * h10) + h20)) / (8.0 * e);`
    : `let du = (${H('uv + vec2f(e, 0.0)')} - ${H('uv - vec2f(e, 0.0)')}) / (2.0 * e);
  let dv = (${H('uv + vec2f(0.0, e)')} - ${H('uv - vec2f(0.0, e)')}) / (2.0 * e);`}
  let k = ${c.params.strength} * 0.1;
  let n = normalize(vec3f(-du * k, dv * k, 1.0));
  return vec4f(${c.values.format === 'directx' ? 'vec3f(n.x, -n.y, n.z)' : 'n'}, 1.0);
}`;
  }), 'Tangent normal from a height map (strength 1 = 0.1 tile units per height unit).', { tags: ['bump', 'normal map'] });

const NBLEND = ['rnm', 'udn', 'whiteout', 'linear'];
def('hn.normalBlend', 'Normal Blend', 'Height & Normal', [nP('base', 'Base'), nP('detail', 'Detail'), fP('mask', 'Mask', 1)],
  [O('out', 'Normal', 'normal')], [E('mode', 'Mode', NBLEND, 'rnm'), S('strength', 'Detail Strength', 0, 2, 1)],
  c => {
    const u = c.uid, i = c.inputs;
    c.let(`let ${u}_d = normalize(vec3f(${i.detail}.xy * (${c.params.strength} * ${i.mask}), max(${i.detail}.z, 0.0001)));`);
    const m = ix(c, 'mode', NBLEND);
    return { out: [`ms_rnm(${i.base}, ${u}_d)`, `ms_udn(${i.base}, ${u}_d)`, `ms_whiteout(${i.base}, ${u}_d)`, `normalize(${i.base} + ${u}_d - vec3f(0.0, 0.0, 1.0))`][m] };
  }, 'Combine two normal maps (reoriented, UDN, whiteout or linear).', { tags: ['detail normal', 'rnm'] });

def('hn.normalStrength', 'Normal Strength', 'Height & Normal', [nP('in', 'Normal')], [O('out', 'Normal', 'normal')], [S('strength', 'Strength', 0, 4, 1)],
  c => ({ out: `normalize(vec3f(${c.inputs.in}.xy * ${c.params.strength}, max(${c.inputs.in}.z, 0.0001)))` }), 'Scale the tilt of a normal.', { tags: ['intensity', 'flatten'] });

def('hn.normalInvertY', 'Normal Flip Green', 'Height & Normal', [nP('in', 'Normal')], [O('out', 'Normal', 'normal')], [B('flipX', 'Flip Red Too')],
  c => ({ out: `vec3f(select(${c.inputs.in}.x, -${c.inputs.in}.x, ${c.params.flipX} > 0.5), -${c.inputs.in}.y, ${c.inputs.in}.z)` }),
  'Convert between OpenGL (+Y) and DirectX (-Y) normal maps.', { tags: ['directx', 'opengl', 'convert'] });

def('hn.normalNormalize', 'Normal Normalize', 'Height & Normal', [nP('in', 'Normal')], [O('out', 'Normal', 'normal')], [],
  c => ({ out: `normalize(${c.inputs.in})` }), 'Normalize to unit length.');

def('hn.normalRotate', 'Normal Rotate', 'Height & Normal', [nP('in', 'Normal')], [O('out', 'Normal', 'normal')], [S('angle', 'Angle', -180, 180, 0, 1)],
  c => {
    const u = c.uid;
    c.let(`let ${u}_r = ms_rot2(${c.inputs.in}.xy, radians(${c.params.angle}));`);
    return { out: `vec3f(${u}_r, ${c.inputs.in}.z)` };
  }, 'Rotate the tangent-space tilt (after you rotate the texture).');

def('hn.normalToHeight', 'Normal to Height', 'Height & Normal', [nP('normal', 'Normal')], [O('height', 'Height', 'float', 'r')],
  [S('range', 'Range', 0.01, 0.5, 0.08), S('scale', 'Scale', 0, 4, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let L = ${c.params.range};
  var h = 0.0;
  for (var d = 0; d < 8; d++) {
    let a = (f32(d) * 0.78539816) + 0.3927;
    let dir = vec2f(cos(a), sin(a));
    for (var k = 1; k <= 16; k++) {
      let t = (f32(k) / 16.0) * L;
      let n = ${c.sample.normal('uv - (dir * t)')};
      let g = vec2f(-n.x, n.y) / (max(n.z, 0.05) * 0.1);
      h += dot(g, dir) * (L / 16.0);
    }
  }
  return vec4f(vec3f(0.5 + ((h / 8.0) * ${c.params.scale})), 1.0);
}`), 'Approximate height by integrating the normal slope along 8 rays (relative height).', { tags: ['integrate', 'displacement'] });

def('hn.aoFromHeight', 'AO from Height', 'Height & Normal', [fP('height', 'Height', 0.5)], [O('ao', 'AO', 'float', 'r')],
  [S('radius', 'Radius', 0.001, 0.25, 0.04, 0.0005), S('depth', 'Height Depth', 0, 0.5, 0.05, 0.001), S('power', 'Power', 0.1, 4, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let h0 = ${c.sample.height('uv')};
  var occ = 0.0;
  for (var d = 0; d < 8; d++) {
    let a = (f32(d) * 0.78539816) + 0.19634954;
    let dir = vec2f(cos(a), sin(a));
    var mx = 0.0;
    for (var k = 1; k <= 12; k++) {
      let t = (f32(k) / 12.0) * ${c.params.radius};
      let dh = (${c.sample.height('uv + (dir * t)')} - h0) * ${c.params.depth};
      mx = max(mx, dh / t);
    }
    occ += mx / sqrt(1.0 + (mx * mx));
  }
  return vec4f(vec3f(pow(clamp(1.0 - (occ / 8.0), 0.0, 1.0), ${c.params.power})), 1.0);
}`), 'Horizon-based ambient occlusion from a height map.', { tags: ['occlusion', 'cavity'] });

def('hn.curvature', 'Curvature', 'Height & Normal', [nP('normal', 'Normal')],
  [O('curvature', 'Curvature', 'float', 'r'), O('convex', 'Convex', 'float', 'g'), O('concave', 'Concave', 'float', 'b')],
  [S('width', 'Width', 0, 0.02, 0.002, 0.0001), S('scale', 'Scale', 0, 4, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let e = max(${c.params.width}, 1.0 / ${c.res});
  let dx = ${c.sample.normal('uv + vec2f(e, 0.0)')}.x - ${c.sample.normal('uv - vec2f(e, 0.0)')}.x;
  let dy = ${c.sample.normal('uv - vec2f(0.0, e)')}.y - ${c.sample.normal('uv + vec2f(0.0, e)')}.y;
  let cv = (dx + dy) * ${c.params.scale} * 2.0;
  return vec4f(clamp(0.5 + cv, 0.0, 1.0), clamp(cv * 2.0, 0.0, 1.0), clamp(-cv * 2.0, 0.0, 1.0), 1.0);
}`), 'Edges (convex) and cavities (concave) from a normal map.', { tags: ['edge wear', 'cavity'] });

def('hn.slope', 'Slope', 'Height & Normal', [fP('height', 'Height', 0.5)], [O('slope', 'Slope', 'float', 'r'), O('angle', 'Direction 0..1', 'float', 'g')],
  [S('scale', 'Scale', 0, 20, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let e = 1.0 / ${c.res};
  let g = vec2f(${c.sample.height('uv + vec2f(e, 0.0)')} - ${c.sample.height('uv - vec2f(e, 0.0)')},
                ${c.sample.height('uv + vec2f(0.0, e)')} - ${c.sample.height('uv - vec2f(0.0, e)')}) / (2.0 * e);
  return vec4f(clamp(length(g) * ${c.params.scale} * 0.1, 0.0, 1.0), (atan2(g.y, g.x) / 6.2831853) + 0.5, 0.0, 1.0);
}`), 'Steepness and downhill direction of a height map.', { tags: ['gradient', 'steep'] });

def('hn.heightBlend', 'Height Blend', 'Height & Normal',
  [fP('heightA', 'Height A', 0.5), fP('heightB', 'Height B', 0.5), cP('colorA', 'Color A', [0.2, 0.2, 0.2]), cP('colorB', 'Color B', [0.8, 0.8, 0.8])],
  [O('height', 'Height', 'float'), O('mask', 'B on Top', 'float'), O('color', 'Color', 'color')],
  [S('offset', 'B Offset', -1, 1, 0), S('contrast', 'Contrast', 0, 1, 0.9)],
  c => {
    const u = c.uid, i = c.inputs;
    c.let(`let ${u}_d = (${i.heightB} + ${c.params.offset}) - ${i.heightA};`);
    c.let(`let ${u}_w = max(1.0 - ${c.params.contrast}, 0.0005);`);
    c.let(`let ${u}_m = smoothstep(-${u}_w, ${u}_w, ${u}_d);`);
    return { height: `mix(${i.heightA}, ${i.heightB} + ${c.params.offset}, ${u}_m)`, mask: `${u}_m`, color: `mix(${i.colorA}, ${i.colorB}, ${u}_m)` };
  }, 'Blend two surfaces by which one is higher (puddles in cracks, moss on stones).', { tags: ['layer', 'mix'] });
