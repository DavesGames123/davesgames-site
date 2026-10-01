// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/generator.js — core library: generator
// ────────────────────────────────────────────────────────────────────────────
//  Procedural pattern nodes: tile layouts (bricks, tiles, planks, hexagons,
//  weave), checker, stripes, lines, gradients, SDF shapes, dots, waves,
//  scratches, cells, flakes and wood grain.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'gen.bricks' 'gen.tiles' 'gen.planks' 'gen.hex' 'gen.weave'
//                   'gen.checker' 'gen.stripes' 'gen.grid' 'gen.gradLinear'
//                   'gen.gradRadial' 'gen.gradAngular' 'gen.rings' 'gen.shape'
//                   'gen.dots' 'gen.waves' 'gen.scratches' 'gen.cells'
//                   'gen.flakes' 'gen.woodRings'
//      helpers .... TILE_OUT tileOut WAVES SHAPES
// ============================================================================
import { UVIN, O, S, I, E, B, K, V, SEED, ix, sd, def } from './build.js';

const TILE_OUT = [O('height', 'Height', 'float'), O('mask', 'Mask', 'float'), O('random', 'Random', 'float'), O('local', 'Local UV', 'vec2')];
const tileOut = (u, hv) => ({
  height: hv ? `(${u}_b.h * (1.0 - (${hv} * ${u}_b.rnd)))` : `${u}_b.h`, mask: `${u}_b.mask`, random: `${u}_b.rnd`, local: `${u}_b.luv`,
});

def('gen.bricks', 'Bricks', 'Generator', [UVIN], TILE_OUT,
  [I('cols', 'Columns', 1, 32, 4), I('rows', 'Rows', 1, 64, 8), S('shift', 'Row Offset', 0, 1, 0.5), S('gap', 'Mortar', 0, 0.1, 0.008),
    S('bevel', 'Bevel', 0, 0.2, 0.015), S('heightVar', 'Height Variation', 0, 1, 0.2), SEED],
  c => {
    const p = c.params;
    c.let(`let ${c.uid}_b = ms_bricks(${c.inputs.uv}, i32(${p.cols}), i32(${p.rows}), ${p.shift}, 0.0, ${p.gap}, ${p.bevel}, ${sd(c)});`);
    return tileOut(c.uid, p.heightVar);
  }, 'Running-bond bricks with mortar and bevel (offset x rows must be whole to tile).', { tags: ['wall', 'masonry'] });

def('gen.tiles', 'Tiles', 'Generator', [UVIN], TILE_OUT,
  [I('cols', 'Columns', 1, 64, 4), I('rows', 'Rows', 1, 64, 4), S('gap', 'Grout', 0, 0.1, 0.01), S('bevel', 'Bevel', 0, 0.2, 0.02),
    S('heightVar', 'Height Variation', 0, 1, 0.1), SEED],
  c => {
    const p = c.params;
    c.let(`let ${c.uid}_b = ms_bricks(${c.inputs.uv}, i32(${p.cols}), i32(${p.rows}), 0.0, 0.0, ${p.gap}, ${p.bevel}, ${sd(c)});`);
    return tileOut(c.uid, p.heightVar);
  }, 'A square tile grid with grout and bevel.', { tags: ['floor', 'grid'] });

def('gen.planks', 'Planks', 'Generator', [UVIN], TILE_OUT,
  [I('rows', 'Rows', 1, 32, 6), I('cols', 'Planks per Row', 1, 8, 2), S('randomShift', 'Random Offset', 0, 1, 1),
    S('gap', 'Gap', 0, 0.05, 0.004), S('bevel', 'Bevel', 0, 0.1, 0.006), S('heightVar', 'Height Variation', 0, 1, 0.1), SEED],
  c => {
    const p = c.params;
    c.let(`let ${c.uid}_b = ms_bricks(${c.inputs.uv}, i32(${p.cols}), i32(${p.rows}), 0.0, ${p.randomShift}, ${p.gap}, ${p.bevel}, ${sd(c)});`);
    return tileOut(c.uid, p.heightVar);
  }, 'Floor planks with a random stagger per row.', { tags: ['wood', 'floor'] });

def('gen.hex', 'Hexagons', 'Generator', [UVIN], TILE_OUT,
  [I('count', 'Count', 1, 64, 6), S('gap', 'Gap', 0, 0.1, 0.01), S('bevel', 'Bevel', 0, 0.2, 0.02), S('heightVar', 'Height Variation', 0, 1, 0.1), SEED],
  c => {
    const p = c.params;
    c.let(`let ${c.uid}_b = ms_hex(${c.inputs.uv}, i32(${p.count}), ${p.gap}, ${p.bevel}, ${sd(c)});`);
    return tileOut(c.uid, p.heightVar);
  }, 'Hexagon tiles (rows round so that the pattern tiles).', { tags: ['honeycomb'] });

def('gen.weave', 'Weave', 'Generator', [UVIN], [O('height', 'Height', 'float'), O('mask', 'Warp Mask', 'float'), O('random', 'Random', 'float')],
  [I('count', 'Threads', 1, 128, 16), S('width', 'Thread Width', 0.05, 1, 0.85), SEED],
  c => {
    c.let(`let ${c.uid}_b = ms_weave(${c.inputs.uv}, i32(${c.params.count}), ${c.params.width}, ${sd(c)});`);
    return { height: `${c.uid}_b.h`, mask: `${c.uid}_b.mask`, random: `${c.uid}_b.rnd` };
  }, 'Plain over-under fabric weave.', { tags: ['fabric', 'cloth', 'textile'] });

def('gen.checker', 'Checker', 'Generator', [UVIN], [O('mask', 'Mask', 'float'), O('color', 'Color', 'color')],
  [I('count', 'Count', 1, 128, 8), K('a', 'Color A', '#1a1a1a'), K('b', 'Color B', '#e0e0e0')],
  c => {
    const u = c.uid;
    c.let(`let ${u}_c = vec2i(floor(${c.inputs.uv} * ${c.params.count}));`);
    c.let(`let ${u}_m = f32((${u}_c.x + ${u}_c.y) & 1);`);
    return { mask: `${u}_m`, color: `mix(${c.params.a}, ${c.params.b}, ${u}_m)` };
  }, 'A checkerboard.', { tags: ['grid', 'test'] });

const WAVES = ['square', 'sine', 'triangle', 'saw'];
def('gen.stripes', 'Stripes', 'Generator', [UVIN], [O('out', 'Value', 'float')],
  [I('count', 'Count', 1, 128, 8), I('skew', 'Skew', -16, 16, 0), E('direction', 'Direction', ['vertical', 'horizontal']),
    E('wave', 'Profile', WAVES), S('duty', 'Duty', 0, 1, 0.5), S('soft', 'Softness', 0, 0.5, 0.02)],
  c => {
    const u = c.uid, p = c.params, q = c.values.direction === 'horizontal' ? `${c.inputs.uv}.yx` : c.inputs.uv;
    c.let(`let ${u}_t = fract((${q}.x * ${p.count}) + (${q}.y * ${p.skew}));`);
    const w = ix(c, 'wave', WAVES);
    const out = [
      `1.0 - smoothstep(${p.duty} - ${p.soft}, ${p.duty} + ${p.soft} + 0.00001, ${u}_t)`,
      `0.5 + (0.5 * cos(${u}_t * 6.2831853))`,
      `1.0 - abs((${u}_t * 2.0) - 1.0)`,
      `${u}_t`][w];
    return { out };
  }, 'Parallel stripes; integer skew makes diagonals that still tile.', { tags: ['lines'] });

def('gen.grid', 'Grid Lines', 'Generator', [UVIN], [O('out', 'Lines', 'float')],
  [I('count', 'Count', 1, 128, 8), S('width', 'Width', 0, 0.5, 0.04), S('soft', 'Softness', 0, 0.2, 0.01)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_f = abs(fract(${c.inputs.uv} * ${p.count}) - vec2f(0.5));`);
    c.let(`let ${u}_d = 0.5 - max(${u}_f.x, ${u}_f.y);`);
    return { out: `1.0 - smoothstep(${p.width} * 0.5, (${p.width} * 0.5) + ${p.soft} + 0.00001, ${u}_d)` };
  }, 'Thin lines on a square grid.', { tags: ['lines', 'mesh'] });

def('gen.gradLinear', 'Linear Gradient', 'Generator', [UVIN], [O('out', 'Value', 'float')],
  [S('angle', 'Angle', 0, 360, 0, 1), I('repeat', 'Repeat', 1, 32, 1), B('mirror', 'Mirror')],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_a = radians(${p.angle});`);
    c.let(`let ${u}_t = (dot(${c.inputs.uv} - vec2f(0.5), vec2f(cos(${u}_a), sin(${u}_a))) + 0.5) * ${p.repeat};`);
    return { out: `select(fract(${u}_t), 1.0 - abs((fract(${u}_t * 0.5) * 2.0) - 1.0), ${p.mirror} > 0.5)` };
  }, 'A ramp along an angle (tiles at 0 and 90 degrees).', { tags: ['ramp'] });

def('gen.gradRadial', 'Radial Gradient', 'Generator', [UVIN], [O('out', 'Value', 'float')],
  [V('center', 'Center', [0.5, 0.5], 0, 1), S('radius', 'Radius', 0.01, 1, 0.5), S('exponent', 'Falloff', 0.1, 8, 1), I('tile', 'Tile', 1, 32, 1)],
  c => {
    const p = c.params;
    return { out: `pow(clamp(1.0 - (length(fract(${c.inputs.uv} * ${p.tile}) - ${p.center}) / ${p.radius}), 0.0, 1.0), ${p.exponent})` };
  }, 'A radial falloff from a center.', { tags: ['circle', 'falloff'] });

def('gen.gradAngular', 'Angular Gradient', 'Generator', [UVIN], [O('out', 'Value', 'float')],
  [V('center', 'Center', [0.5, 0.5], 0, 1), S('rotation', 'Rotation', 0, 360, 0, 1), I('repeat', 'Repeat', 1, 32, 1)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_d = fract(${c.inputs.uv}) - ${p.center};`);
    return { out: `fract(((atan2(${u}_d.y, ${u}_d.x) / 6.2831853) + 0.5 + (${p.rotation} / 360.0)) * ${p.repeat})` };
  }, 'A ramp around a center (cone gradient).', { tags: ['conic', 'sweep'] });

def('gen.rings', 'Concentric Rings', 'Generator', [UVIN], [O('out', 'Value', 'float')],
  [I('tile', 'Tile', 1, 32, 1), S('count', 'Rings', 1, 64, 6, 0.1), S('sharp', 'Sharpness', 0, 1, 0)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_w = 0.5 + (0.5 * cos(length(fract(${c.inputs.uv} * ${p.tile}) - vec2f(0.5)) * ${p.count} * 6.2831853));`);
    return { out: `mix(${u}_w, step(0.5, ${u}_w), ${p.sharp})` };
  }, 'Concentric rings per tile.', { tags: ['target', 'ripple'] });

const SHAPES = ['disc', 'square', 'polygon', 'star', 'ring', 'cross', 'rounded', 'diamond'];
def('gen.shape', 'Shape', 'Generator', [UVIN], [O('mask', 'Mask', 'float'), O('bevel', 'Bevel', 'float'), O('sdf', 'Distance', 'float')],
  [E('kind', 'Shape', SHAPES), I('tile', 'Tile', 1, 64, 1), S('size', 'Size', 0, 1, 0.6), I('sides', 'Sides / Points', 3, 16, 6),
    S('inner', 'Inner', 0, 1, 0.5), S('rotation', 'Rotation', -180, 180, 0, 1), S('soft', 'Softness', 0, 0.5, 0.01), S('bevelW', 'Bevel Width', 0, 1, 0.2)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_p = ms_rot2((fract(${c.inputs.uv} * ${p.tile}) * 2.0) - vec2f(1.0), -radians(${p.rotation}));`);
    c.let(`let ${u}_d = ms_shape(${ix(c, 'kind', SHAPES)}, ${u}_p, ${p.size}, ${p.sides}, ${p.inner});`);
    return {
      mask: `1.0 - smoothstep(-${p.soft}, ${p.soft} + 0.00001, ${u}_d)`,
      bevel: `clamp(-${u}_d / max(${p.bevelW} * ${p.size}, 0.0001), 0.0, 1.0)`,
      sdf: `${u}_d`,
    };
  }, 'A signed-distance shape, repeated per tile.', { tags: ['sdf', 'polygon', 'star', 'circle'] });

def('gen.dots', 'Dots', 'Generator', [UVIN], [O('out', 'Mask', 'float')],
  [I('count', 'Count', 1, 128, 8), S('radius', 'Radius', 0, 1.5, 0.6), S('soft', 'Softness', 0, 0.5, 0.05), B('stagger', 'Stagger Rows')],
  c => ({ out: `ms_dots(${c.inputs.uv}, i32(${c.params.count}), ${c.params.radius}, ${c.params.soft}, ${c.params.stagger})` }),
  'Halftone dots on a grid.', { tags: ['polka', 'perforated'] });

def('gen.waves', 'Waves', 'Generator', [UVIN], [O('out', 'Value', 'float')],
  [I('count', 'Count', 1, 64, 8), I('freq', 'Wiggle Frequency', 0, 16, 2), S('amp', 'Wiggle Amount', 0, 1, 0.15), E('direction', 'Direction', ['horizontal', 'vertical'])],
  c => {
    const p = c.params, q = c.values.direction === 'vertical' ? `${c.inputs.uv}.yx` : c.inputs.uv;
    return { out: `0.5 + (0.5 * sin(6.2831853 * ((${q}.y * ${p.count}) + (${p.amp} * sin(6.2831853 * ${q}.x * ${p.freq})))))` };
  }, 'Wavy parallel lines: corrugation, sand ripples.', { tags: ['sine', 'ripples'] });

def('gen.scratches', 'Scratches', 'Generator', [UVIN], [O('out', 'Scratches', 'float')],
  [I('count', 'Grid', 1, 32, 4), I('perCell', 'Per Cell', 1, 16, 3), S('length', 'Length', 0, 2, 0.8), S('width', 'Width', 0, 0.1, 0.012),
    S('angle', 'Angle', -180, 180, 20, 1), S('spread', 'Angle Spread', 0, 1, 0.3), SEED],
  c => {
    const p = c.params;
    return { out: `ms_scratches(${c.inputs.uv}, i32(${p.count}), i32(${p.perCell}), ${p.length}, ${p.width}, radians(${p.angle}), ${p.spread}, ${sd(c)})` };
  }, 'Random thin line segments: wear, scuffs, brushed marks.', { tags: ['wear', 'damage'] });

def('gen.cells', 'Cells', 'Generator', [UVIN],
  [O('value', 'Random Gray', 'float'), O('color', 'Random Color', 'color'), O('dist', 'Center Distance', 'float'), O('border', 'Border', 'float')],
  [I('count', 'Count', 1, 128, 8), S('jitter', 'Jitter', 0, 1, 1), S('saturation', 'Color Saturation', 0, 1, 0.6), SEED],
  c => {
    const u = c.uid;
    c.let(`let ${u}_w = ms_worley(${c.inputs.uv}, vec2i(max(i32(${c.params.count}), 1)), ${c.params.jitter}, ${sd(c)});`);
    return {
      value: `${u}_w.z`, color: `ms_hsv2rgb(vec3f(${u}_w.z, ${c.params.saturation} * (0.5 + (0.5 * ${u}_w.w)), 0.4 + (0.6 * fract(${u}_w.z * 7.31))))`,
      dist: `clamp(${u}_w.x, 0.0, 1.0)`, border: `clamp(${u}_w.y - ${u}_w.x, 0.0, 1.0)`,
    };
  }, 'Voronoi cells with a random value and color each.', { tags: ['voronoi', 'mosaic', 'stones'] });

def('gen.flakes', 'Flakes', 'Generator', [UVIN], [O('normal', 'Normal', 'normal'), O('sparkle', 'Sparkle', 'float'), O('id', 'Random', 'float')],
  [I('count', 'Count', 4, 512, 96), S('jitter', 'Jitter', 0, 1, 1), S('tilt', 'Tilt', 0, 1, 0.45), S('density', 'Density', 0, 1, 1), SEED],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_w = ms_worley(${c.inputs.uv}, vec2i(max(i32(${p.count}), 1)), ${p.jitter}, ${sd(c)});`);
    c.let(`let ${u}_a = ${u}_w.w * 6.2831853;`);
    c.let(`let ${u}_r = ${p.tilt} * sqrt(fract(${u}_w.z * 13.7));`);
    c.let(`let ${u}_on = fract(${u}_w.z * 3.3) < ${p.density};`);
    return {
      normal: `select(vec3f(0.0, 0.0, 1.0), normalize(vec3f(cos(${u}_a) * ${u}_r, sin(${u}_a) * ${u}_r, 1.0)), ${u}_on)`,
      sparkle: `select(0.0, fract(${u}_w.z * 7.7), ${u}_on)`, id: `${u}_w.z`,
    };
  }, 'Tilted metallic flakes as a normal field (car paint, glitter).', { tags: ['glitter', 'paint', 'metallic'] });

def('gen.woodRings', 'Wood Grain', 'Generator', [UVIN], [O('rings', 'Rings', 'float'), O('grain', 'Fibers', 'float')],
  [I('count', 'Rings', 1, 64, 10), S('distortion', 'Distortion', 0, 2, 0.6), I('noiseScale', 'Noise Scale', 1, 16, 3), S('sharp', 'Late-wood Sharpness', 0.5, 8, 2.5), SEED],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_n = ms_fbm(1, ${c.inputs.uv}, vec2i(max(i32(${p.noiseScale}), 1), max(i32(${p.noiseScale}), 1) * 4), 5, 2, 0.5, ${sd(c)});`);
    c.let(`let ${u}_t = fract((${c.inputs.uv}.y * ${p.count}) + ((${u}_n - 0.5) * ${p.distortion} * 2.0));`);
    return { rings: `pow(${u}_t, ${p.sharp})`, grain: `ms_fbm(0, ${c.inputs.uv}, vec2i(2, 384), 3, 2, 0.5, ${sd(c)} + 5.0)` };
  }, 'Distorted growth rings plus fine fibers along x.', { tags: ['wood', 'timber'] });
