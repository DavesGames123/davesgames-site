// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/transform.js — core library: transform
// ────────────────────────────────────────────────────────────────────────────
//  Image transforms (pass nodes that sample the input at moved uv) and uv
//  transforms (expr nodes that change uv before a generator).
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'xform.transform' 'xform.offset' 'xform.tile' 'xform.mirror'
//                   'xform.rotate90' 'xform.polar' 'xform.twirl' 'uv.transform'
//                   'uv.tile' 'uv.polar' 'uv.twirl' 'uv.distort'
//      helpers .... MIRRORS
// ============================================================================
import { UVIN, IN_C, O, S, I, E, V, SEED, ix, sd, def, pass } from './build.js';

def('xform.transform', 'Transform 2D', 'Transform', [IN_C], [O('out', 'Output', 'color')],
  [V('offset', 'Offset', [0, 0]), S('rotation', 'Rotation', -180, 180, 0, 1), V('scale', 'Scale', [1, 1], 0.01, 16), I('tile', 'Tile', 1, 32, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let p = ms_rot2(((uv - vec2f(0.5) - ${c.params.offset}) * ${c.params.tile}) / max(${c.params.scale}, vec2f(0.0001)), -radians(${c.params.rotation}));
  return vec4f(${c.sample.in('p + vec2f(0.5)')}, 1.0);
}`), 'Offset, rotate, scale and repeat an image (repeat addressing).', { tags: ['move', 'rotate', 'scale'] });

def('xform.offset', 'Offset', 'Transform', [IN_C], [O('out', 'Output', 'color')], [V('offset', 'Offset', [0.5, 0.5], -1, 1)],
  pass(c => `fn pass_main(uv: vec2f) -> vec4f { return vec4f(${c.sample.in(`uv - ${c.params.offset}`)}, 1.0); }`),
  'Shift with wrap-around: check the seams of a tileable map.', { tags: ['shift', 'wrap'] });

def('xform.tile', 'Tile', 'Transform', [IN_C], [O('out', 'Output', 'color')], [I('x', 'Repeat X', 1, 64, 2), I('y', 'Repeat Y', 1, 64, 2)],
  pass(c => `fn pass_main(uv: vec2f) -> vec4f { return vec4f(${c.sample.in(`uv * vec2f(${c.params.x}, ${c.params.y})`)}, 1.0); }`),
  'Repeat the input in the tile.', { tags: ['repeat'] });

const MIRRORS = ['x', 'y', 'both', 'kaleido'];
def('xform.mirror', 'Mirror', 'Transform', [IN_C], [O('out', 'Output', 'color')], [E('mode', 'Mode', MIRRORS)],
  pass(c => {
    const m = ix(c, 'mode', MIRRORS);
    const q = ['vec2f(0.5 - abs(f.x - 0.5), f.y)', 'vec2f(f.x, 0.5 - abs(f.y - 0.5))', 'vec2f(0.5) - abs(f - vec2f(0.5))',
      'select(vec2f(0.5) - abs(f - vec2f(0.5)), (vec2f(0.5) - abs(f - vec2f(0.5))).yx, abs(f.x - 0.5) < abs(f.y - 0.5))'][m];
    return `fn pass_main(uv: vec2f) -> vec4f { let f = fract(uv); return vec4f(${c.sample.in(q)}, 1.0); }`;
  }), 'Mirror one half (or quarter) onto the other.', { tags: ['symmetry', 'flip'] });

def('xform.rotate90', 'Rotate 90', 'Transform', [IN_C], [O('out', 'Output', 'color')], [E('angle', 'Angle', ['90', '180', '270'])],
  pass(c => {
    const q = { 90: 'vec2f(uv.y, 1.0 - uv.x)', 180: 'vec2f(1.0) - uv', 270: 'vec2f(1.0 - uv.y, uv.x)' }[c.values.angle] || 'uv';
    return `fn pass_main(uv: vec2f) -> vec4f { return vec4f(${c.sample.in(q)}, 1.0); }`;
  }), 'Rotate by a multiple of 90 degrees (keeps tiling).');

def('xform.polar', 'Polar Transform', 'Transform', [IN_C], [O('out', 'Output', 'color')], [E('mode', 'Mode', ['toPolar', 'fromPolar']), S('repeat', 'Angular Repeat', 1, 32, 1, 1)],
  pass(c => c.values.mode === 'fromPolar' ? `
fn pass_main(uv: vec2f) -> vec4f {
  let a = (uv.x - 0.5) * 6.2831853 / ${c.params.repeat};
  let r = uv.y * 0.5;
  return vec4f(${c.sample.in('vec2f(0.5) + (vec2f(cos(a), sin(a)) * r)')}, 1.0);
}` : `
fn pass_main(uv: vec2f) -> vec4f {
  let d = uv - vec2f(0.5);
  return vec4f(${c.sample.in(`vec2f(fract(((atan2(d.y, d.x) / 6.2831853) + 0.5) * ${c.params.repeat}), length(d) * 2.0)`)}, 1.0);
}`), 'Wrap an image around the center, or unwrap it.', { tags: ['radial', 'circular'] });

def('xform.twirl', 'Twirl', 'Transform', [IN_C], [O('out', 'Output', 'color')],
  [V('center', 'Center', [0.5, 0.5], 0, 1), S('radius', 'Radius', 0.01, 1, 0.4), S('angle', 'Angle', -720, 720, 180, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let d = uv - ${c.params.center};
  let t = clamp(1.0 - (length(d) / ${c.params.radius}), 0.0, 1.0);
  return vec4f(${c.sample.in(`${c.params.center} + ms_rot2(d, radians(${c.params.angle}) * t * t)`)}, 1.0);
}`), 'Swirl the image around a center.', { tags: ['swirl', 'vortex'] });

def('uv.transform', 'UV Transform', 'Transform', [UVIN], [O('uv', 'UV', 'vec2')],
  [V('offset', 'Offset', [0, 0], -4, 4), S('rotation', 'Rotation', -180, 180, 0, 1), V('scale', 'Scale', [1, 1], -16, 16), V('pivot', 'Pivot', [0.5, 0.5], 0, 1)],
  c => ({ uv: `(ms_rot2((${c.inputs.uv} - ${c.params.pivot}) * ${c.params.scale}, radians(${c.params.rotation})) + ${c.params.pivot} + ${c.params.offset})` }),
  'Transform uv before a generator (integer scale keeps tiling).', { tags: ['coordinates'] });

def('uv.tile', 'UV Tile', 'Transform', [UVIN], [O('uv', 'UV', 'vec2'), O('cell', 'Cell', 'vec2')], [I('x', 'Repeat X', 1, 64, 2), I('y', 'Repeat Y', 1, 64, 2)],
  c => {
    c.let(`let ${c.uid}_p = ${c.inputs.uv} * vec2f(${c.params.x}, ${c.params.y});`);
    return { uv: `fract(${c.uid}_p)`, cell: `floor(${c.uid}_p)` };
  }, 'Repeat uv: generators downstream repeat inside the tile.');

def('uv.polar', 'UV Polar', 'Transform', [UVIN], [O('uv', 'UV', 'vec2')], [V('center', 'Center', [0.5, 0.5], 0, 1), I('repeat', 'Angular Repeat', 1, 32, 1)],
  c => {
    c.let(`let ${c.uid}_d = fract(${c.inputs.uv}) - ${c.params.center};`);
    return { uv: `vec2f(fract(((atan2(${c.uid}_d.y, ${c.uid}_d.x) / 6.2831853) + 0.5) * ${c.params.repeat}), length(${c.uid}_d) * 2.0)` };
  }, 'uv as (angle, radius): turns stripes into rays and rings.', { tags: ['radial'] });

def('uv.twirl', 'UV Twirl', 'Transform', [UVIN], [O('uv', 'UV', 'vec2')],
  [V('center', 'Center', [0.5, 0.5], 0, 1), S('radius', 'Radius', 0.01, 1, 0.5), S('angle', 'Angle', -720, 720, 180, 1)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_d = ${c.inputs.uv} - ${p.center};`);
    c.let(`let ${u}_t = clamp(1.0 - (length(${u}_d) / ${p.radius}), 0.0, 1.0);`);
    return { uv: `${p.center} + ms_rot2(${u}_d, radians(${p.angle}) * ${u}_t * ${u}_t)` };
  }, 'Swirl uv around a center.');

def('uv.distort', 'UV Noise Distort', 'Transform', [UVIN], [O('uv', 'UV', 'vec2')],
  [I('scale', 'Scale', 1, 64, 4), S('amount', 'Amount', 0, 0.5, 0.05), I('octaves', 'Octaves', 1, 8, 3), SEED],
  c => ({ uv: `(${c.inputs.uv} + (ms_warp2(${c.inputs.uv}, vec2i(max(i32(${c.params.scale}), 1)), i32(${c.params.octaves}), ${sd(c)}) * ${c.params.amount}))` }),
  'Add a periodic noise offset to uv (keeps tiling).', { tags: ['warp', 'wobble'] });
