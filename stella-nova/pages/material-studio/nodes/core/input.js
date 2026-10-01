// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/input.js — core library: input
// ────────────────────────────────────────────────────────────────────────────
//  Source nodes that read no other node: uv, tile coordinates, constants,
//  the graph seed, time, resolution, polar coordinates and bitmap images.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'input.uv' 'input.tileCoord' 'input.value' 'input.number'
//                   'input.color' 'input.vec2' 'input.vec3' 'input.seed'
//                   'input.time' 'input.texel' 'input.polar' 'input.image'
// ============================================================================
import { UVIN, O, S, I, E, K, V, SEED, sd, def, pass } from './build.js';

def('input.uv', 'UV', 'Input', [], [O('uv', 'UV', 'vec2'), O('u', 'U', 'float'), O('v', 'V', 'float')], [],
  c => ({ uv: c.uv, u: `${c.uv}.x`, v: `${c.uv}.y` }), 'The texel uv in tile space (graph tiling applied).', { tags: ['coordinates'] });

def('input.tileCoord', 'Tile Coordinates', 'Input', [UVIN],
  [O('local', 'Local UV', 'vec2'), O('cell', 'Cell', 'vec2'), O('random', 'Random', 'float')],
  [I('count', 'Count', 1, 64, 4), SEED],
  c => {
    const u = c.uid;
    c.let(`let ${u}_n = max(i32(round(${c.params.count})), 1);`);
    c.let(`let ${u}_p = ${c.inputs.uv} * f32(${u}_n);`);
    c.let(`let ${u}_c = ms_wrap(vec2i(floor(${u}_p)), vec2i(${u}_n));`);
    return { local: `fract(${u}_p)`, cell: `vec2f(${u}_c)`, random: `ms_rnd(${u}_c, ${sd(c)})` };
  }, 'Split the tile into a grid: local uv, cell index and a random value per cell.');

def('input.value', 'Value', 'Input', [], [O('out', 'Value', 'float')],
  [S('v', 'Value', 0, 1, 0.5)], c => ({ out: c.params.v }), 'A constant number in 0..1.', { tags: ['constant', 'scalar'] });

def('input.number', 'Number', 'Input', [], [O('out', 'Value', 'float')],
  [S('v', 'Value', -100, 100, 1, 0.01)], c => ({ out: c.params.v }), 'A constant number with a wide range.', { tags: ['constant', 'scalar'] });

def('input.color', 'Color', 'Input', [], [O('out', 'Color', 'color')],
  [K('c', 'Color', '#b0b0b0')], c => ({ out: c.params.c }), 'A constant color (sRGB picker, linear output).', { tags: ['constant', 'rgb'] });

def('input.vec2', 'Vector 2', 'Input', [], [O('out', 'Vector', 'vec2')],
  [V('v', 'Value', [0.5, 0.5], -10, 10)], c => ({ out: c.params.v }), 'A constant 2D vector.');

def('input.vec3', 'Vector 3', 'Input', [], [O('out', 'Vector', 'vec3')],
  [S('x', 'X', -10, 10, 0, 0.01), S('y', 'Y', -10, 10, 0, 0.01), S('z', 'Z', -10, 10, 1, 0.01)],
  c => ({ out: `vec3f(${c.params.x}, ${c.params.y}, ${c.params.z})` }), 'A constant 3D vector.');

def('input.seed', 'Graph Seed', 'Input', [], [O('out', 'Seed', 'float')], [],
  () => ({ out: 'ms_u.h.y' }), 'The graph random seed (settings.seed).');

def('input.time', 'Time', 'Input', [], [O('out', 'Seconds', 'float'), O('phase', 'Phase 0..1', 'float')],
  [S('speed', 'Speed', 0, 10, 1, 0.01)],
  c => ({ out: `(ms_u.h.w * ${c.params.speed})`, phase: `fract(ms_u.h.w * ${c.params.speed})` }),
  'Bake time in seconds (__studio.bake.setTime). Static unless the time is set.');

def('input.texel', 'Resolution', 'Input', [], [O('res', 'Resolution', 'float'), O('texel', 'Texel Size', 'float')], [],
  c => ({ res: c.res, texel: `(1.0 / ${c.res})` }), 'The bake resolution and the size of one texel in uv.');

def('input.polar', 'Polar Coordinates', 'Input', [UVIN], [O('radius', 'Radius', 'float'), O('angle', 'Angle 0..1', 'float')],
  [V('center', 'Center', [0.5, 0.5], 0, 1)],
  c => {
    const u = c.uid;
    c.let(`let ${u}_d = fract(${c.inputs.uv}) - ${c.params.center};`);
    return { radius: `(length(${u}_d) * 2.0)`, angle: `(atan2(${u}_d.y, ${u}_d.x) / 6.2831853) + 0.5` };
  }, 'Distance and angle from a center point.');

def('input.image', 'Image', 'Input', [UVIN],
  [O('color', 'Color', 'color', 'rgb'), O('alpha', 'Alpha', 'float', 'a'), O('rgba', 'RGBA', 'texture', 'rgba')],
  [{ id: 'image', label: 'Image', kind: 'image', default: null }, E('colorspace', 'Color Space', ['srgb', 'linear'], 'srgb'),
    I('tile', 'Tile', 1, 16, 1)],
  pass(c => `
fn pass_main(uv: vec2f) -> vec4f {
  let q = ${c.linked.uv ? c.sample.uv('uv') : 'uv'} * ${c.params.tile};
  return textureSampleLevel(${c.img.image}, ${c.samp}, q, 0.0);
}`), 'A bitmap. Use linear color space for normal, roughness and other data maps.', { tags: ['texture', 'bitmap', 'photo'] });
