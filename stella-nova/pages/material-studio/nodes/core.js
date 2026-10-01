// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core.js — the built-in node library
// ────────────────────────────────────────────────────────────────────────────
//  Exports NODES, an array of contract NodeDef. main.js puts each def on
//  state.registry before any module init. compile.js turns the defs into
//  WGSL: an `expr` def is fused per texel into its consumer's pass, a `pass`
//  def renders its own texture, and an `expand` def (a macro) is replaced by
//  a small subgraph of other defs before compile.
//
//  DATA FLOW
//      NodeDef.expr(ctx)       -> {outputId: WGSL expr}   ctx = contract ExprCtx
//      NodeDef.pass.wgsl(ctx)  -> WGSL that defines pass_main(uv) -> vec4f
//      NodeDef.expand(values)  -> {nodes, links, inputs, outputs}  (macro)
//      Library helpers (ms_*) come from shaders/bake-lib.wgsl. compile.js
//      adds only the helpers that the generated code names.
//
//  CONVENTIONS
//      Generators are periodic: an integer scale tiles in the uv square.
//      A `uv` input with default 'uv' reads the texel uv when unlinked.
//      Int and bool params reach WGSL as f32 expressions: wrap with i32().
//      Math nodes read a param (va, vb, ...) when the matching input is not
//      linked, so a node with one link still does useful work.
//      Pass outputs of type 'normal' hold raw -1..1 xyz (not encoded).
//      Filter radii and offsets are in tile uv units, so a result does not
//      change with the bake resolution.
//
//  SECTIONS  (grep -n the banner to jump)
//      helpers ......... port, param and node builders
//      output .......... Material Output
//      input ........... uv, tile coord, constants, seed, time, image
//      noise ........... value, gradient, simplex, worley, fbm family, warp
//      generator ....... bricks, tiles, hex, checker, stripes, gradients, shapes
//      pattern ......... tile sampler, splatter
//      filter .......... blur, sharpen, edges, warps, morphology, tileable
//      height & normal . height->normal, blends, AO, curvature, slope
//      transform ....... image transforms (pass) and uv transforms (expr)
//      color ........... hsv, levels of color, gray, channels, gradient map
//      adjust .......... levels, curves, histogram, invert, remap, threshold
//      blend ........... 20 blend modes, mix, mask combine
//      math ............ float math (28 ops)
//      vector .......... vec2/vec3 math
//      utility ......... switch, reroute, cache, WGSL expression, custom pass
//      material ........ PBR from height (macro), presets, layer mix
// ============================================================================
import { OUTPUT_TYPE, MATERIAL_INPUTS, MATERIAL_PARAMS } from '../contract.js';

// ------------------------------------------------------------ helpers
const fP = (id, label, d = 0) => ({ id, label, type: 'float', default: d });
const cP = (id, label, d = [0.5, 0.5, 0.5]) => ({ id, label, type: 'color', default: d });
const v2P = (id, label, d = [0, 0]) => ({ id, label, type: 'vec2', default: d });
const v3P = (id, label, d = [0, 0, 0]) => ({ id, label, type: 'vec3', default: d });
const nP = (id, label) => ({ id, label, type: 'normal', default: [0, 0, 1] });
const tP = (id, label) => ({ id, label, type: 'texture', default: [0, 0, 0, 1] });
const UVIN = { id: 'uv', label: 'UV', type: 'vec2', default: 'uv' };
const O = (id, label, type, swizzle) => (swizzle ? { id, label, type, swizzle } : { id, label, type });

const S = (id, label, min, max, d, step) => ({ id, label, kind: 'slider', min, max, step: step ?? (max - min > 20 ? 1 : 0.001), default: d });
const I = (id, label, min, max, d) => ({ id, label, kind: 'int', min, max, step: 1, default: d });
const E = (id, label, options, d) => ({ id, label, kind: 'enum', options, default: d ?? options[0] });
const B = (id, label, d = false) => ({ id, label, kind: 'bool', default: d });
const K = (id, label, d) => ({ id, label, kind: 'color', default: d });
const V = (id, label, d, min = -1, max = 1) => ({ id, label, kind: 'vec2', min, max, step: 0.001, default: d });
const SEED = I('seed', 'Seed', 0, 9999, 0);

const ix = (c, id, list) => Math.max(0, list.indexOf(c.values[id]));
const sd = c => `(${c.seed} + ${c.params.seed})`;
/** Linked input or the param that stands in for it. */
const lp = (c, inp, par) => (c.linked && c.linked[inp] ? c.inputs[inp] : c.params[par]);

/** Emit the period lets for a noise node and return the vec2i name. */
function per(c) {
  const u = c.uid, p = c.params;
  c.let(`let ${u}_sx = max(i32(round(${p.scale})), 1);`);
  c.let(`let ${u}_per = vec2i(${u}_sx, select(max(i32(round(${p.scaleY})), 1), ${u}_sx, ${p.scaleY} < 0.5));`);
  return `${u}_per`;
}

const NODES_ = [];
function def(type, label, category, inputs, outputs, params, body, doc, extra = {}) {
  const d = { type, label, category, inputs, outputs, params, doc, ...extra };
  if (typeof body === 'function') d.expr = body;
  else if (body && body.wgsl) d.pass = { inputsAsTextures: true, ...body };
  else if (body && body.expand) d.expand = body.expand;
  NODES_.push(d);
  return d;
}
const pass = wgsl => ({ wgsl });

// ------------------------------------------------------------ output
def(OUTPUT_TYPE, 'Material Output', 'Output',
  MATERIAL_INPUTS.map(({ id, label, type, default: d }) => ({ id, label, type, default: d })),
  [], MATERIAL_PARAMS.map(p => ({ ...p, uniform: false })), null,
  'The material: each input bakes into one channel of the PBR maps.', { tags: ['pbr', 'final', 'result'] });

// ------------------------------------------------------------ input
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

// ------------------------------------------------------------ noise
const NOISE_P = [I('scale', 'Scale', 1, 128, 8), I('scaleY', 'Scale Y (0 = same)', 0, 128, 0), SEED];
const KINDS = ['value', 'gradient', 'simplex', 'cellular'];
const FRACTAL_P = [E('kind', 'Base Noise', KINDS, 'gradient'), I('octaves', 'Octaves', 1, 12, 6),
  I('lacunarity', 'Lacunarity', 2, 4, 2), S('gain', 'Gain', 0, 1, 0.5)];

def('noise.value', 'Value Noise', 'Noise', [UVIN], [O('out', 'Value', 'float')], NOISE_P,
  c => ({ out: `ms_vnoise(${c.inputs.uv}, ${per(c)}, ${sd(c)})` }), 'Smooth random values on a grid.', { tags: ['random', 'blur'] });

def('noise.perlin', 'Gradient Noise', 'Noise', [UVIN], [O('out', 'Value', 'float')], NOISE_P,
  c => ({ out: `ms_pnoise(${c.inputs.uv}, ${per(c)}, ${sd(c)})` }), 'Perlin-type gradient noise.', { tags: ['perlin', 'random'] });

def('noise.simplex', 'Simplex Noise', 'Noise', [UVIN], [O('out', 'Value', 'float')], NOISE_P,
  c => ({ out: `ms_snoise(${c.inputs.uv}, ${per(c)}, ${sd(c)})` }), 'Triangle-lattice noise with fewer grid marks (Y scale rounds to even).', { tags: ['random'] });

def('noise.worley', 'Worley Noise', 'Noise', [UVIN],
  [O('f1', 'F1', 'float'), O('f2', 'F2', 'float'), O('edge', 'F2 - F1', 'float'), O('id', 'Cell Random', 'float')],
  [...NOISE_P, S('jitter', 'Jitter', 0, 1, 1)],
  c => {
    const u = c.uid;
    c.let(`let ${u}_w = ms_worley(${c.inputs.uv}, ${per(c)}, ${c.params.jitter}, ${sd(c)});`);
    return { f1: `clamp(${u}_w.x, 0.0, 1.0)`, f2: `clamp(${u}_w.y, 0.0, 1.0)`, edge: `clamp(${u}_w.y - ${u}_w.x, 0.0, 1.0)`, id: `${u}_w.z` };
  }, 'Cellular noise: distance to the nearest and second-nearest feature point.', { tags: ['cellular', 'voronoi'] });

def('noise.voronoiEdges', 'Voronoi Edges', 'Noise', [UVIN],
  [O('edges', 'Edges', 'float'), O('dist', 'Edge Distance', 'float'), O('id', 'Cell Random', 'float'), O('f1', 'Center Distance', 'float')],
  [...NOISE_P, S('jitter', 'Jitter', 0, 1, 1), S('width', 'Width', 0, 0.5, 0.03), S('soft', 'Softness', 0, 0.5, 0.05)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_v = ms_vedge(${c.inputs.uv}, ${per(c)}, ${p.jitter}, ${sd(c)});`);
    return {
      edges: `1.0 - smoothstep(${p.width}, ${p.width} + max(${p.soft}, 0.0001), ${u}_v.x)`,
      dist: `clamp(${u}_v.x * 2.0, 0.0, 1.0)`, id: `${u}_v.y`, f1: `clamp(${u}_v.z, 0.0, 1.0)`,
    };
  }, 'True distance to Voronoi cell borders: cracks, cells, stone joints.', { tags: ['cells', 'cracks'] });

def('noise.fbm', 'Fractal Noise (fBm)', 'Noise', [UVIN], [O('out', 'Value', 'float')], [...NOISE_P, ...FRACTAL_P],
  c => ({ out: `ms_fbm(${ix(c, 'kind', KINDS)}, ${c.inputs.uv}, ${per(c)}, i32(${c.params.octaves}), i32(${c.params.lacunarity}), ${c.params.gain}, ${sd(c)})` }),
  'Octaves of a base noise summed: the general-purpose cloud.', { tags: ['clouds', 'fractal'] });

def('noise.ridged', 'Ridged Noise', 'Noise', [UVIN], [O('out', 'Value', 'float')], [...NOISE_P, ...FRACTAL_P],
  c => ({ out: `ms_ridged(${ix(c, 'kind', KINDS)}, ${c.inputs.uv}, ${per(c)}, i32(${c.params.octaves}), i32(${c.params.lacunarity}), ${c.params.gain}, ${sd(c)})` }),
  'Ridged multifractal: sharp crests, mountain ridges, veins.', { tags: ['fractal', 'mountains'] });

def('noise.billow', 'Billow Noise', 'Noise', [UVIN], [O('out', 'Value', 'float')], [...NOISE_P, ...FRACTAL_P],
  c => ({ out: `ms_billow(${ix(c, 'kind', KINDS)}, ${c.inputs.uv}, ${per(c)}, i32(${c.params.octaves}), i32(${c.params.lacunarity}), ${c.params.gain}, ${sd(c)})` }),
  'Puffy rounded fractal (absolute-value octaves).', { tags: ['fractal', 'turbulence'] });

def('noise.domainWarp', 'Domain Warp', 'Noise', [UVIN], [O('out', 'Value', 'float'), O('warp', 'Warp Vector', 'vec2')],
  [...NOISE_P, I('warpScale', 'Warp Scale', 1, 32, 3), S('strength', 'Strength', 0, 1, 0.25), I('octaves', 'Octaves', 1, 10, 5)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_w = ms_warp2(${c.inputs.uv}, vec2i(max(i32(round(${p.warpScale})), 1)), i32(${p.octaves}), ${sd(c)} + 11.0);`);
    return { out: `ms_fbm(1, ${c.inputs.uv} + (${u}_w * ${p.strength}), ${per(c)}, i32(${p.octaves}), 2, 0.5, ${sd(c)})`, warp: `${u}_w + vec2f(0.5)` };
  }, 'fBm sampled through a second fBm offset field: marble, smoke, swirls.', { tags: ['warp', 'marble'] });

def('noise.clouds', 'Clouds', 'Noise', [UVIN], [O('out', 'Value', 'float')],
  [...NOISE_P, I('octaves', 'Octaves', 1, 12, 8), S('contrast', 'Contrast', 0, 4, 1.4), S('bias', 'Bias', -0.5, 0.5, 0)],
  c => ({ out: `clamp(((ms_fbm(1, ${c.inputs.uv}, ${per(c)}, i32(${c.params.octaves}), 2, 0.5, ${sd(c)}) - 0.5) * ${c.params.contrast}) + 0.5 + ${c.params.bias}, 0.0, 1.0)` }),
  'High-octave fBm with contrast and bias.', { tags: ['fractal'] });

def('noise.cracks', 'Cracks', 'Noise', [UVIN], [O('out', 'Cracks', 'float'), O('id', 'Cell Random', 'float')],
  [...NOISE_P, S('jitter', 'Jitter', 0, 1, 0.9), S('width', 'Width', 0, 0.3, 0.04), S('warp', 'Warp', 0, 0.5, 0.08), I('warpScale', 'Warp Scale', 1, 32, 6)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_w = ms_warp2(${c.inputs.uv}, vec2i(max(i32(round(${p.warpScale})), 1)), 4, ${sd(c)} + 5.0);`);
    c.let(`let ${u}_v = ms_vedge(${c.inputs.uv} + (${u}_w * ${p.warp}), ${per(c)}, ${p.jitter}, ${sd(c)});`);
    return { out: `1.0 - smoothstep(0.0, max(${p.width}, 0.0001), ${u}_v.x)`, id: `${u}_v.y` };
  }, 'Warped Voronoi borders: dry mud, cracked paint, broken tiles.', { tags: ['mud', 'paint'] });

def('noise.dirt', 'Dirt', 'Noise', [UVIN], [O('out', 'Mask', 'float')],
  [...NOISE_P, S('threshold', 'Threshold', 0, 1, 0.5), S('soft', 'Softness', 0, 0.5, 0.15)],
  c => {
    const u = c.uid, p = c.params;
    c.let(`let ${u}_pp = ${per(c)};`);
    c.let(`let ${u}_a = ms_fbm(1, ${c.inputs.uv}, ${u}_pp, 6, 2, 0.55, ${sd(c)});`);
    c.let(`let ${u}_b = ms_worley(${c.inputs.uv}, ${u}_pp * 2, 1.0, ${sd(c)} + 3.0).x;`);
    return { out: `smoothstep(${p.threshold} - ${p.soft}, ${p.threshold} + ${p.soft}, ${u}_a * (0.6 + (0.4 * ${u}_b)))` };
  }, 'Grime mask from fBm modulated by cells.', { tags: ['grime', 'wear'] });

def('noise.blocks', 'Random Blocks', 'Noise', [UVIN], [O('out', 'Value', 'float'), O('color', 'Color', 'color')], NOISE_P,
  c => {
    const u = c.uid;
    c.let(`let ${u}_c = ms_wrap(vec2i(floor(${c.inputs.uv} * vec2f(${per(c)}))), ${u}_per);`);
    return { out: `ms_rnd(${u}_c, ${sd(c)})`, color: `ms_rnd3(${u}_c, ${sd(c)})` };
  }, 'A random gray and color per grid cell.', { tags: ['pixel', 'cells'] });

def('noise.white', 'White Noise', 'Noise', [UVIN], [O('out', 'Value', 'float'), O('color', 'Color', 'color')], [SEED],
  c => {
    const u = c.uid;
    c.let(`let ${u}_c = ms_wrap(vec2i(floor(${c.inputs.uv} * ${c.res})), vec2i(i32(${c.res})));`);
    return { out: `ms_rnd(${u}_c, ${sd(c)})`, color: `ms_rnd3(${u}_c, ${sd(c)})` };
  }, 'An independent random value per texel.', { tags: ['grain', 'static'] });

def('noise.brushed', 'Brushed Lines', 'Noise', [UVIN], [O('out', 'Value', 'float')],
  [E('direction', 'Direction', ['horizontal', 'vertical']), I('density', 'Density', 16, 1024, 256), I('length', 'Length', 1, 16, 2),
    I('octaves', 'Octaves', 1, 6, 3), SEED],
  c => {
    const p = c.params, h = c.values.direction !== 'vertical';
    const pr = h ? `vec2i(max(i32(${p.length}), 1), max(i32(${p.density}), 1))` : `vec2i(max(i32(${p.density}), 1), max(i32(${p.length}), 1))`;
    return { out: `ms_fbm(0, ${c.inputs.uv}, ${pr}, i32(${p.octaves}), 2, 0.6, ${sd(c)})` };
  }, 'Anisotropic streaks for brushed metal and fibers.', { tags: ['metal', 'anisotropic'] });

// ------------------------------------------------------------ generator
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

// ------------------------------------------------------------ pattern
const STAMPS = ['input', 'disc', 'square', 'bump', 'pyramid', 'ring'];
const STAMP_BLEND = ['max', 'add', 'over'];
function scatterWgsl(c) {
  const p = c.params, u = c.uid;
  const shape = ix(c, 'shape', STAMPS);
  const useInput = shape === 0 && c.linked.pattern;
  const stamp = useInput ? c.sample.pattern('st') : `vec3f(${u}_shape(st))`;
  const blend = ix(c, 'blend', STAMP_BLEND);
  const acc = [
    `let lv = ms_lum(v); if (lv > top) { top = lv; acc = v; id = r.z; }`,
    `acc += v; if (ms_lum(v) > 0.001) { id = r.z; }`,
    `if (ms_lum(v) > 0.001) { acc = v; id = r.z; }`][blend];
  return `
fn ${u}_shape(q: vec2f) -> f32 {
  let d = (q * 2.0) - vec2f(1.0);
  switch ${Math.max(shape, 1)} {
    case 2: { return select(0.0, 1.0, max(abs(d.x), abs(d.y)) < 1.0); }
    case 3: { return sqrt(max(1.0 - dot(d, d), 0.0)); }
    case 4: { return max(1.0 - max(abs(d.x), abs(d.y)), 0.0); }
    case 5: { return 1.0 - smoothstep(0.0, 0.06, abs(length(d) - 0.75) - 0.15); }
    default: { return 1.0 - smoothstep(0.96, 1.0, length(d)); }
  }
}
fn pass_main(uv: vec2f) -> vec4f {
  let n = max(i32(round(${p.count})), 1);
  let q = vec2i(n);
  let pp = uv * f32(n);
  let ic = vec2i(floor(pp));
  let f = pp - floor(pp);
  let k = clamp(i32(round(${p.perCell})), 1, 8);
  var acc = vec3f(0.0);
  var top = -1.0;
  var id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2i(x, y);
      let cell = ms_wrap(ic + o, q);
      for (var j = 0; j < k; j++) {
        let r = ms_rnd3(cell + vec2i(j * 131, j * 71), ${sd(c)});
        let r2 = ms_rnd3(cell + vec2i(j * 17, j * 911), ${sd(c)} + 3.0);
        if (r2.z < ${p.dropout}) { continue; }
        let ctr = vec2f(o) + vec2f(0.5) + ((r.xy - vec2f(0.5)) * ${p.offset});
        let sc = max(${p.size} * (1.0 - (${p.sizeRand} * fract(r.z * 5.13))), 0.001);
        let ang = ((r2.x - 0.5) * ${p.rotRand} * 6.2831853) + radians(${p.rotation});
        let st = (ms_rot2(f - ctr, -ang) / sc) + vec2f(0.5);
        if (any(st < vec2f(0.0)) || any(st > vec2f(1.0))) { continue; }
        let v = ${stamp} * (1.0 - (${p.valueRand} * r2.y));
        ${acc}
      }
    }
  }
  return vec4f(acc, id);
}`;
}
const SCATTER_P = (count, perCell, offset, size, sizeRand, rotRand) => [
  E('shape', 'Stamp', STAMPS, 'input'), E('blend', 'Blend', STAMP_BLEND, 'max'), I('count', 'Grid', 1, 64, count), I('perCell', 'Per Cell', 1, 8, perCell),
  S('offset', 'Position Random', 0, 1, offset), S('size', 'Size', 0.05, 2, size), S('sizeRand', 'Size Random', 0, 1, sizeRand),
  S('rotation', 'Rotation', -180, 180, 0, 1), S('rotRand', 'Rotation Random', 0, 1, rotRand), S('valueRand', 'Value Random', 0, 1, 0.3),
  S('dropout', 'Drop Out', 0, 1, 0), SEED];
const SCATTER_OUT = [O('out', 'Pattern', 'color', 'rgb'), O('id', 'Stamp Random', 'float', 'a')];

def('pattern.tileSampler', 'Tile Sampler', 'Pattern', [cP('pattern', 'Pattern', [1, 1, 1])], SCATTER_OUT,
  SCATTER_P(8, 1, 0.1, 0.9, 0.2, 0.1), pass(scatterWgsl),
  'One stamp per grid cell with random offset, rotation, scale and value. Stamp = the input or a built-in shape.', { tags: ['scatter', 'stamp'] });

def('pattern.splatter', 'Splatter', 'Pattern', [cP('pattern', 'Pattern', [1, 1, 1])], SCATTER_OUT,
  SCATTER_P(5, 4, 1, 0.5, 0.6, 1), pass(scatterWgsl),
  'Many stamps per cell at random positions and angles.', { tags: ['scatter', 'pebbles', 'leaves'] });

// ------------------------------------------------------------ filter
const IN_C = cP('in', 'Input', [0.5, 0.5, 0.5]);
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

// ------------------------------------------------------------ height & normal
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

// ------------------------------------------------------------ transform
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

// ------------------------------------------------------------ color
def('color.hsv', 'HSV Adjust', 'Color', [IN_C], [O('out', 'Output', 'color')],
  [S('hue', 'Hue Shift', -0.5, 0.5, 0), S('saturation', 'Saturation', 0, 2, 1), S('value', 'Value', 0, 2, 1)],
  c => {
    c.let(`let ${c.uid}_h = ms_rgb2hsv(max(${c.inputs.in}, vec3f(0.0)));`);
    return { out: `ms_hsv2rgb(vec3f(fract(${c.uid}_h.x + ${c.params.hue}), clamp(${c.uid}_h.y * ${c.params.saturation}, 0.0, 1.0), ${c.uid}_h.z * ${c.params.value}))` };
  }, 'Shift hue, scale saturation and value.', { tags: ['hue', 'saturation'] });

def('color.brightnessContrast', 'Brightness / Contrast', 'Color', [IN_C], [O('out', 'Output', 'color')],
  [S('brightness', 'Brightness', -1, 1, 0), S('contrast', 'Contrast', -1, 1, 0), S('pivot', 'Pivot', 0, 1, 0.5)],
  c => ({ out: `(((${c.inputs.in} - vec3f(${c.params.pivot})) * exp2(${c.params.contrast} * 2.0)) + vec3f(${c.params.pivot} + ${c.params.brightness}))` }),
  'Brightness offset and contrast around a pivot.');

def('color.colorize', 'Colorize', 'Color', [IN_C], [O('out', 'Output', 'color')], [K('tint', 'Tint', '#c08040'), S('amount', 'Amount', 0, 1, 1)],
  c => ({ out: `mix(${c.inputs.in}, ${c.params.tint} * (ms_lum(${c.inputs.in}) / max(ms_lum(${c.params.tint}), 0.0001)), ${c.params.amount})` }),
  'Replace hue and saturation with a tint, keep the luminance.', { tags: ['tint', 'sepia'] });

const GRAY = ['luminance', 'average', 'max', 'min', 'red', 'green', 'blue'];
def('color.toGray', 'Color to Gray', 'Color', [IN_C], [O('out', 'Gray', 'float')], [E('mode', 'Mode', GRAY)],
  c => {
    const x = c.inputs.in;
    return { out: [`ms_lum(${x})`, `dot(${x}, vec3f(0.33333333))`, `max(${x}.r, max(${x}.g, ${x}.b))`, `min(${x}.r, min(${x}.g, ${x}.b))`, `${x}.r`, `${x}.g`, `${x}.b`][ix(c, 'mode', GRAY)] };
  }, 'Desaturate by a chosen rule.', { tags: ['grayscale', 'desaturate'] });

def('color.grayToColor', 'Gray to Color', 'Color', [fP('in', 'Gray', 0.5)], [O('out', 'Color', 'color')], [K('a', 'Dark', '#101418'), K('b', 'Light', '#f0e8d8')],
  c => ({ out: `mix(${c.params.a}, ${c.params.b}, ${c.inputs.in})` }), 'Map gray to a two-color ramp.', { tags: ['duotone'] });

def('color.gradientMap', 'Gradient Map', 'Color', [fP('in', 'Gray', 0.5)], [O('out', 'Color', 'color')],
  [{ id: 'gradient', label: 'Gradient', kind: 'gradient', default: [{ t: 0, color: '#1b1209' }, { t: 0.45, color: '#6b4a2a' }, { t: 0.8, color: '#c89a62' }, { t: 1, color: '#f2dfc0' }] }],
  c => ({ out: `${c.params.gradient}(${c.inputs.in})` }), 'Map gray through a multi-stop gradient.', { tags: ['ramp', 'lut'] });

def('color.split', 'Split RGBA', 'Color', [tP('in', 'Input')], [O('r', 'R', 'float'), O('g', 'G', 'float'), O('b', 'B', 'float'), O('a', 'A', 'float')], [],
  c => ({ r: `${c.inputs.in}.r`, g: `${c.inputs.in}.g`, b: `${c.inputs.in}.b`, a: `${c.inputs.in}.a` }), 'Separate the channels.', { tags: ['channels', 'unpack'] });

def('color.merge', 'Merge RGBA', 'Color', [fP('r', 'R', 0), fP('g', 'G', 0), fP('b', 'B', 0), fP('a', 'A', 1)],
  [O('color', 'Color', 'color'), O('rgba', 'RGBA', 'texture')], [],
  c => ({ color: `vec3f(${c.inputs.r}, ${c.inputs.g}, ${c.inputs.b})`, rgba: `vec4f(${c.inputs.r}, ${c.inputs.g}, ${c.inputs.b}, ${c.inputs.a})` }),
  'Pack four grays into one color (channel packing).', { tags: ['channels', 'pack'] });

def('color.srgbToLinear', 'sRGB to Linear', 'Color', [IN_C], [O('out', 'Output', 'color')], [], c => ({ out: `ms_srgb2lin(${c.inputs.in})` }), 'Decode sRGB gamma.', { tags: ['gamma'] });
def('color.linearToSrgb', 'Linear to sRGB', 'Color', [IN_C], [O('out', 'Output', 'color')], [], c => ({ out: `ms_lin2srgb(${c.inputs.in})` }), 'Encode sRGB gamma.', { tags: ['gamma'] });

def('color.tint', 'Tint', 'Color', [IN_C], [O('out', 'Output', 'color')], [K('tint', 'Tint', '#ffe0c0'), S('intensity', 'Intensity', 0, 4, 1)],
  c => ({ out: `(${c.inputs.in} * ${c.params.tint} * ${c.params.intensity})` }), 'Multiply by a color.', { tags: ['multiply'] });

def('color.select', 'Color Select', 'Color', [IN_C], [O('mask', 'Mask', 'float')],
  [K('target', 'Target', '#808080'), S('tolerance', 'Tolerance', 0, 1, 0.1), S('soft', 'Softness', 0, 1, 0.1)],
  c => ({ mask: `1.0 - smoothstep(${c.params.tolerance}, ${c.params.tolerance} + ${c.params.soft} + 0.00001, distance(${c.inputs.in}, ${c.params.target}))` }),
  'Mask of the texels near a color.', { tags: ['key', 'chroma'] });

def('color.replace', 'Color Replace', 'Color', [IN_C], [O('out', 'Output', 'color'), O('mask', 'Mask', 'float')],
  [K('target', 'Target', '#808080'), K('replacement', 'Replacement', '#a03020'), S('tolerance', 'Tolerance', 0, 1, 0.15), S('soft', 'Softness', 0, 1, 0.1)],
  c => {
    c.let(`let ${c.uid}_m = 1.0 - smoothstep(${c.params.tolerance}, ${c.params.tolerance} + ${c.params.soft} + 0.00001, distance(${c.inputs.in}, ${c.params.target}));`);
    return { out: `mix(${c.inputs.in}, ${c.params.replacement}, ${c.uid}_m)`, mask: `${c.uid}_m` };
  }, 'Swap one color for another.', { tags: ['recolor'] });

def('color.temperature', 'White Balance', 'Color', [IN_C], [O('out', 'Output', 'color')], [S('temperature', 'Temperature', -1, 1, 0), S('tint', 'Tint', -1, 1, 0)],
  c => ({ out: `(${c.inputs.in} * vec3f(1.0 + (0.3 * ${c.params.temperature}), 1.0 + (0.15 * ${c.params.tint}), 1.0 - (0.3 * ${c.params.temperature})))` }),
  'Warm/cool and green/magenta shift.', { tags: ['warm', 'cool'] });

def('color.channelShuffle', 'Channel Shuffle', 'Color', [tP('in', 'Input')], [O('out', 'Output', 'color')],
  [E('r', 'Red From', ['r', 'g', 'b', 'a', '0', '1'], 'r'), E('g', 'Green From', ['r', 'g', 'b', 'a', '0', '1'], 'g'), E('b', 'Blue From', ['r', 'g', 'b', 'a', '0', '1'], 'b')],
  c => {
    const ch = k => (k === '0' ? '0.0' : k === '1' ? '1.0' : `${c.inputs.in}.${k}`);
    return { out: `vec3f(${ch(c.values.r)}, ${ch(c.values.g)}, ${ch(c.values.b)})` };
  }, 'Route any channel to any channel.', { tags: ['swizzle', 'channels'] });

// ------------------------------------------------------------ adjust
def('adjust.levels', 'Levels', 'Adjust', [IN_C], [O('out', 'Output', 'color')],
  [S('inLow', 'In Low', 0, 1, 0), S('inHigh', 'In High', 0, 1, 1), S('gamma', 'Gamma', 0.1, 5, 1), S('outLow', 'Out Low', 0, 1, 0), S('outHigh', 'Out High', 0, 1, 1)],
  c => {
    const p = c.params;
    c.let(`let ${c.uid}_t = clamp((${c.inputs.in} - vec3f(${p.inLow})) / max(${p.inHigh} - ${p.inLow}, 0.00001), vec3f(0.0), vec3f(1.0));`);
    return { out: `mix(vec3f(${p.outLow}), vec3f(${p.outHigh}), pow(${c.uid}_t, vec3f(1.0 / max(${p.gamma}, 0.001))))` };
  }, 'Input range, gamma and output range.', { tags: ['range', 'gamma'] });

def('adjust.curves', 'Curves', 'Adjust', [IN_C], [O('out', 'Output', 'color')],
  [{ id: 'curve', label: 'Curve', kind: 'curve', default: [[0, 0], [0.25, 0.18], [0.75, 0.82], [1, 1]] }, E('channel', 'Channel', ['rgb', 'r', 'g', 'b'])],
  c => {
    const f = c.params.curve, x = c.inputs.in, ch = c.values.channel;
    if (ch === 'r') return { out: `vec3f(${f}(${x}.r), ${x}.g, ${x}.b)` };
    if (ch === 'g') return { out: `vec3f(${x}.r, ${f}(${x}.g), ${x}.b)` };
    if (ch === 'b') return { out: `vec3f(${x}.r, ${x}.g, ${f}(${x}.b))` };
    return { out: `vec3f(${f}(${x}.r), ${f}(${x}.g), ${f}(${x}.b))` };
  }, 'Remap values through a smooth monotone curve.', { tags: ['tone'] });

def('adjust.histogramScan', 'Histogram Scan', 'Adjust', [fP('in', 'Input', 0.5)], [O('out', 'Output', 'float')],
  [S('position', 'Position', 0, 1, 0.5), S('contrast', 'Contrast', 0, 1, 0.5)],
  c => {
    c.let(`let ${c.uid}_w = max(1.0 - ${c.params.contrast}, 0.0001);`);
    c.let(`let ${c.uid}_t = 1.0 - ${c.params.position};`);
    return { out: `clamp((${c.inputs.in} - (${c.uid}_t - (${c.uid}_w * 0.5))) / ${c.uid}_w, 0.0, 1.0)` };
  }, 'Threshold that sweeps through the histogram with a soft edge: masks from heights.', { tags: ['mask', 'threshold'] });

def('adjust.histogramRange', 'Histogram Range', 'Adjust', [fP('in', 'Input', 0.5)], [O('out', 'Output', 'float')],
  [S('range', 'Range', 0, 1, 0.5), S('position', 'Position', 0, 1, 0.5)],
  c => ({ out: `mix(${c.params.position}, ${c.inputs.in}, ${c.params.range})` }), 'Squeeze the values toward a position.', { tags: ['compress'] });

def('adjust.histogramShift', 'Histogram Shift', 'Adjust', [fP('in', 'Input', 0.5)], [O('out', 'Output', 'float')], [S('position', 'Position', 0, 1, 0.5)],
  c => ({ out: `fract(${c.inputs.in} + ${c.params.position})` }), 'Shift values with wrap-around.', { tags: ['offset'] });

def('adjust.invert', 'Invert', 'Adjust', [IN_C], [O('out', 'Output', 'color')], [S('amount', 'Amount', 0, 1, 1)],
  c => ({ out: `mix(${c.inputs.in}, vec3f(1.0) - ${c.inputs.in}, ${c.params.amount})` }), 'One minus the input.', { tags: ['negative'] });

def('adjust.clamp', 'Clamp', 'Adjust', [IN_C], [O('out', 'Output', 'color')], [S('min', 'Min', 0, 1, 0), S('max', 'Max', 0, 1, 1)],
  c => ({ out: `clamp(${c.inputs.in}, vec3f(${c.params.min}), vec3f(max(${c.params.min}, ${c.params.max})))` }), 'Limit values to a range.', { tags: ['limit'] });

def('adjust.remap', 'Remap', 'Adjust', [fP('in', 'Input', 0.5)], [O('out', 'Output', 'float')],
  [S('inLow', 'In Low', -2, 2, 0), S('inHigh', 'In High', -2, 2, 1), S('outLow', 'Out Low', -2, 2, 0), S('outHigh', 'Out High', -2, 2, 1), B('clamp', 'Clamp', true)],
  c => {
    const p = c.params;
    c.let(`let ${c.uid}_t0 = (${c.inputs.in} - ${p.inLow}) / select(${p.inHigh} - ${p.inLow}, 0.00001, abs(${p.inHigh} - ${p.inLow}) < 0.00001);`);
    c.let(`let ${c.uid}_t = select(${c.uid}_t0, clamp(${c.uid}_t0, 0.0, 1.0), ${p.clamp} > 0.5);`);
    return { out: `mix(${p.outLow}, ${p.outHigh}, ${c.uid}_t)` };
  }, 'Linear map from one range to another.', { tags: ['range', 'fit'] });

def('adjust.posterize', 'Posterize', 'Adjust', [IN_C], [O('out', 'Output', 'color')], [I('steps', 'Steps', 2, 64, 4)],
  c => ({ out: `(floor(clamp(${c.inputs.in}, vec3f(0.0), vec3f(0.99999)) * ${c.params.steps}) / max(${c.params.steps} - 1.0, 1.0))` }),
  'Quantize to a number of levels.', { tags: ['quantize', 'steps'] });

def('adjust.threshold', 'Threshold', 'Adjust', [fP('in', 'Input', 0.5)], [O('out', 'Output', 'float')], [S('level', 'Level', 0, 1, 0.5), S('soft', 'Softness', 0, 0.5, 0.01)],
  c => ({ out: `smoothstep(${c.params.level} - ${c.params.soft}, ${c.params.level} + ${c.params.soft} + 0.00001, ${c.inputs.in})` }), 'Binary mask with a soft edge.', { tags: ['mask', 'cutoff'] });

def('adjust.gamma', 'Gamma', 'Adjust', [IN_C], [O('out', 'Output', 'color')], [S('gamma', 'Gamma', 0.05, 8, 1)],
  c => ({ out: `pow(max(${c.inputs.in}, vec3f(0.0)), vec3f(${c.params.gamma}))` }), 'Raise to a power (midtone bend).', { tags: ['power'] });

// ------------------------------------------------------------ blend
const BLEND_MODES = ['normal', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'darken', 'lighten',
  'difference', 'exclusion', 'colorDodge', 'colorBurn', 'linearLight', 'divide', 'hue', 'saturation', 'color', 'luminosity'];
def('blend.blend', 'Blend', 'Blend', [cP('a', 'Background', [0.2, 0.2, 0.2]), cP('b', 'Foreground', [0.8, 0.8, 0.8]), fP('mask', 'Mask', 1)],
  [O('out', 'Output', 'color')], [E('mode', 'Mode', BLEND_MODES, 'normal'), S('opacity', 'Opacity', 0, 1, 1), B('clamp', 'Clamp 0..1', true)],
  c => {
    const i = c.inputs;
    c.let(`let ${c.uid}_r = mix(${i.a}, ms_blend(${ix(c, 'mode', BLEND_MODES)}, ${i.a}, ${i.b}), clamp(${c.params.opacity} * ${i.mask}, 0.0, 1.0));`);
    return { out: `select(${c.uid}_r, clamp(${c.uid}_r, vec3f(0.0), vec3f(1.0)), ${c.params.clamp} > 0.5)` };
  }, '20 blend modes with opacity and a mask.', { tags: ['layer', 'composite', 'multiply', 'overlay', 'screen'] });

def('blend.mix', 'Mix', 'Blend', [cP('a', 'A', [0, 0, 0]), cP('b', 'B', [1, 1, 1]), fP('t', 'Factor', 0.5)], [O('out', 'Output', 'color')], [S('t', 'Factor (unlinked)', 0, 1, 0.5)],
  c => ({ out: `mix(${c.inputs.a}, ${c.inputs.b}, ${lp(c, 't', 't')})` }), 'Linear interpolation of two colors.', { tags: ['lerp'] });

const MASK_OPS = ['min', 'max', 'multiply', 'add', 'subtract', 'difference', 'screen', 'average'];
def('blend.maskCombine', 'Mask Combine', 'Blend', [fP('a', 'A', 0), fP('b', 'B', 0)], [O('out', 'Output', 'float')], [E('mode', 'Mode', MASK_OPS, 'max'), B('clamp', 'Clamp', true)],
  c => {
    const a = c.inputs.a, b = c.inputs.b;
    const e = [`min(${a}, ${b})`, `max(${a}, ${b})`, `(${a} * ${b})`, `(${a} + ${b})`, `(${a} - ${b})`, `abs(${a} - ${b})`, `(1.0 - ((1.0 - ${a}) * (1.0 - ${b})))`, `((${a} + ${b}) * 0.5)`][ix(c, 'mode', MASK_OPS)];
    return { out: `select(${e}, clamp(${e}, 0.0, 1.0), ${c.params.clamp} > 0.5)` };
  }, 'Combine two masks.', { tags: ['union', 'intersect'] });

def('blend.mixFloat', 'Mix Gray', 'Blend', [fP('a', 'A', 0), fP('b', 'B', 1), fP('t', 'Factor', 0.5)], [O('out', 'Output', 'float')], [S('t', 'Factor (unlinked)', 0, 1, 0.5)],
  c => ({ out: `mix(${c.inputs.a}, ${c.inputs.b}, ${lp(c, 't', 't')})` }), 'Linear interpolation of two grays.', { tags: ['lerp'] });

// ------------------------------------------------------------ math
const MATH_RANGE = [-10, 10];
const mathBin = (name, label, fn, doc, tags) => def(`math.${name}`, label, 'Math', [fP('a', 'A'), fP('b', 'B')], [O('out', 'Result', 'float')],
  [S('va', 'A (unlinked)', ...MATH_RANGE, 0, 0.001), S('vb', 'B (unlinked)', ...MATH_RANGE, name === 'mul' || name === 'div' || name === 'pow' ? 1 : 0, 0.001)],
  c => ({ out: fn(lp(c, 'a', 'va'), lp(c, 'b', 'vb')) }), doc, { tags });
mathBin('add', 'Add', (a, b) => `(${a} + ${b})`, 'A + B.', ['plus', 'sum']);
mathBin('sub', 'Subtract', (a, b) => `(${a} - ${b})`, 'A - B.', ['minus']);
mathBin('mul', 'Multiply', (a, b) => `(${a} * ${b})`, 'A x B.', ['times', 'product']);
mathBin('div', 'Divide', (a, b) => `select((${a}) / (${b}), 0.0, abs(${b}) < 0.0000001)`, 'A / B (0 when B is 0).', ['quotient']);
mathBin('pow', 'Power', (a, b) => `pow(max(${a}, 0.0), ${b})`, 'A to the power B (A clamped at 0).', ['exponent']);
mathBin('min', 'Minimum', (a, b) => `min(${a}, ${b})`, 'The smaller of A and B.');
mathBin('max', 'Maximum', (a, b) => `max(${a}, ${b})`, 'The larger of A and B.');
mathBin('mod', 'Modulo', (a, b) => `((${a}) - ((${b}) * floor((${a}) / select(${b}, 1.0, abs(${b}) < 0.0000001))))`, 'A modulo B (floored).', ['wrap', 'remainder']);
mathBin('atan2', 'Arctangent 2', (a, b) => `atan2(${a}, ${b})`, 'Angle of the vector (B, A) in radians.', ['angle']);
mathBin('step', 'Step', (a, b) => `step(${b}, ${a})`, '1 when A >= B, else 0.', ['compare']);

const mathUn = (name, label, fn, doc, tags, dv = 0) => def(`math.${name}`, label, 'Math', [fP('a', 'A')], [O('out', 'Result', 'float')],
  [S('va', 'A (unlinked)', ...MATH_RANGE, dv, 0.001)], c => ({ out: fn(lp(c, 'a', 'va')) }), doc, { tags });
mathUn('abs', 'Absolute', a => `abs(${a})`, '|A|.');
mathUn('frac', 'Fraction', a => `fract(${a})`, 'A minus floor(A).', ['fract']);
mathUn('floor', 'Floor', a => `floor(${a})`, 'Round down.');
mathUn('ceil', 'Ceiling', a => `ceil(${a})`, 'Round up.');
mathUn('round', 'Round', a => `round(${a})`, 'Round to the nearest integer.');
mathUn('sin', 'Sine', a => `sin(${a})`, 'sin(A), A in radians.', ['wave']);
mathUn('cos', 'Cosine', a => `cos(${a})`, 'cos(A), A in radians.', ['wave']);
mathUn('sqrt', 'Square Root', a => `sqrt(max(${a}, 0.0))`, 'Square root (A clamped at 0).');
mathUn('oneMinus', 'One Minus', a => `(1.0 - ${a})`, '1 - A.', ['invert']);
mathUn('negate', 'Negate', a => `(-(${a}))`, '-A.');
mathUn('sign', 'Sign', a => `sign(${a})`, '-1, 0 or 1.');
mathUn('exp', 'Exponential', a => `exp(${a})`, 'e to the power A.');
mathUn('log', 'Logarithm', a => `log(max(${a}, 0.0000001))`, 'Natural logarithm.', [], 1);
mathUn('saturate', 'Saturate', a => `clamp(${a}, 0.0, 1.0)`, 'Clamp to 0..1.');

def('math.lerp', 'Lerp', 'Math', [fP('a', 'A', 0), fP('b', 'B', 1), fP('t', 'T', 0.5)], [O('out', 'Result', 'float')], [S('t', 'T (unlinked)', 0, 1, 0.5)],
  c => ({ out: `mix(${c.inputs.a}, ${c.inputs.b}, ${lp(c, 't', 't')})` }), 'A + (B - A) T.', { tags: ['mix'] });
def('math.smoothstep', 'Smoothstep', 'Math', [fP('x', 'X', 0.5)], [O('out', 'Result', 'float')], [S('e0', 'Edge 0', -2, 2, 0), S('e1', 'Edge 1', -2, 2, 1)],
  c => ({ out: `smoothstep(${c.params.e0}, ${c.params.e1}, ${c.inputs.x})` }), 'Hermite step between two edges.');
def('math.clamp', 'Clamp', 'Math', [fP('x', 'X', 0.5)], [O('out', 'Result', 'float')], [S('min', 'Min', -10, 10, 0, 0.001), S('max', 'Max', -10, 10, 1, 0.001)],
  c => ({ out: `clamp(${c.inputs.x}, ${c.params.min}, max(${c.params.min}, ${c.params.max}))` }), 'Limit X to [min, max].');
def('math.compare', 'Compare', 'Math', [fP('a', 'A', 0), fP('b', 'B', 0), fP('t', 'If True', 1), fP('f', 'If False', 0)], [O('out', 'Result', 'float')],
  [E('op', 'Operator', ['>', '>=', '<', '<=', '==', '!=']), S('eps', 'Equal Tolerance', 0, 0.1, 0.001, 0.0001)],
  c => {
    const a = c.inputs.a, b = c.inputs.b, e = c.params.eps;
    const cond = { '>': `${a} > ${b}`, '>=': `${a} >= ${b}`, '<': `${a} < ${b}`, '<=': `${a} <= ${b}`, '==': `abs(${a} - ${b}) <= ${e}`, '!=': `abs(${a} - ${b}) > ${e}` }[c.values.op] || `${a} > ${b}`;
    return { out: `select(${c.inputs.f}, ${c.inputs.t}, ${cond})` };
  }, 'Choose between two values by comparing A and B.', { tags: ['if', 'condition', 'select'] });

// ------------------------------------------------------------ vector
def('vec.split2', 'Split Vector 2', 'Vector', [v2P('in', 'Vector')], [O('x', 'X', 'float'), O('y', 'Y', 'float')], [],
  c => ({ x: `${c.inputs.in}.x`, y: `${c.inputs.in}.y` }), 'The components of a vec2.', { tags: ['separate'] });
def('vec.split3', 'Split Vector 3', 'Vector', [v3P('in', 'Vector')], [O('x', 'X', 'float'), O('y', 'Y', 'float'), O('z', 'Z', 'float')], [],
  c => ({ x: `${c.inputs.in}.x`, y: `${c.inputs.in}.y`, z: `${c.inputs.in}.z` }), 'The components of a vec3.', { tags: ['separate'] });
def('vec.combine2', 'Combine Vector 2', 'Vector', [fP('x', 'X'), fP('y', 'Y')], [O('out', 'Vector', 'vec2')], [S('vx', 'X (unlinked)', -10, 10, 0, 0.001), S('vy', 'Y (unlinked)', -10, 10, 0, 0.001)],
  c => ({ out: `vec2f(${lp(c, 'x', 'vx')}, ${lp(c, 'y', 'vy')})` }), 'Build a vec2.', { tags: ['join'] });
def('vec.combine3', 'Combine Vector 3', 'Vector', [fP('x', 'X'), fP('y', 'Y'), fP('z', 'Z')], [O('out', 'Vector', 'vec3')],
  [S('vx', 'X (unlinked)', -10, 10, 0, 0.001), S('vy', 'Y (unlinked)', -10, 10, 0, 0.001), S('vz', 'Z (unlinked)', -10, 10, 1, 0.001)],
  c => ({ out: `vec3f(${lp(c, 'x', 'vx')}, ${lp(c, 'y', 'vy')}, ${lp(c, 'z', 'vz')})` }), 'Build a vec3.', { tags: ['join'] });
def('vec.dot', 'Dot Product', 'Vector', [v3P('a', 'A', [0, 0, 1]), v3P('b', 'B', [0, 0, 1])], [O('out', 'Result', 'float')], [],
  c => ({ out: `dot(${c.inputs.a}, ${c.inputs.b})` }), 'A . B.');
def('vec.cross', 'Cross Product', 'Vector', [v3P('a', 'A', [1, 0, 0]), v3P('b', 'B', [0, 1, 0])], [O('out', 'Result', 'vec3')], [],
  c => ({ out: `cross(${c.inputs.a}, ${c.inputs.b})` }), 'A x B.');
def('vec.length', 'Length', 'Vector', [v3P('in', 'Vector')], [O('out', 'Length', 'float')], [], c => ({ out: `length(${c.inputs.in})` }), 'Vector length.', { tags: ['magnitude'] });
def('vec.normalize', 'Normalize', 'Vector', [v3P('in', 'Vector', [0, 0, 1])], [O('out', 'Unit Vector', 'vec3')], [],
  c => ({ out: `(${c.inputs.in} / max(length(${c.inputs.in}), 0.0000001))` }), 'Scale to unit length.');
def('vec.distance', 'Distance', 'Vector', [v3P('a', 'A'), v3P('b', 'B')], [O('out', 'Distance', 'float')], [], c => ({ out: `distance(${c.inputs.a}, ${c.inputs.b})` }), 'Distance between two points.');
def('vec.add', 'Vector Add', 'Vector', [v3P('a', 'A'), v3P('b', 'B')], [O('out', 'Result', 'vec3')], [], c => ({ out: `(${c.inputs.a} + ${c.inputs.b})` }), 'A + B per component.');
def('vec.sub', 'Vector Subtract', 'Vector', [v3P('a', 'A'), v3P('b', 'B')], [O('out', 'Result', 'vec3')], [], c => ({ out: `(${c.inputs.a} - ${c.inputs.b})` }), 'A - B per component.');
def('vec.mul', 'Vector Multiply', 'Vector', [v3P('a', 'A', [1, 1, 1]), v3P('b', 'B', [1, 1, 1])], [O('out', 'Result', 'vec3')], [], c => ({ out: `(${c.inputs.a} * ${c.inputs.b})` }), 'A x B per component.');
def('vec.scale', 'Vector Scale', 'Vector', [v3P('in', 'Vector'), fP('s', 'Scale', 1)], [O('out', 'Result', 'vec3')], [S('vs', 'Scale (unlinked)', -10, 10, 1, 0.001)],
  c => ({ out: `(${c.inputs.in} * ${lp(c, 's', 'vs')})` }), 'Multiply a vector by a number.');
def('vec.mix', 'Vector Mix', 'Vector', [v3P('a', 'A'), v3P('b', 'B', [1, 1, 1]), fP('t', 'T', 0.5)], [O('out', 'Result', 'vec3')], [S('t', 'T (unlinked)', 0, 1, 0.5)],
  c => ({ out: `mix(${c.inputs.a}, ${c.inputs.b}, ${lp(c, 't', 't')})` }), 'Interpolate two vectors.', { tags: ['lerp'] });
def('vec.rotate2', 'Rotate Vector 2', 'Vector', [v2P('in', 'Vector', [1, 0])], [O('out', 'Result', 'vec2')], [S('angle', 'Angle', -180, 180, 90, 1), V('pivot', 'Pivot', [0, 0], -1, 1)],
  c => ({ out: `(ms_rot2(${c.inputs.in} - ${c.params.pivot}, radians(${c.params.angle})) + ${c.params.pivot})` }), 'Rotate a 2D vector around a pivot.');

// ------------------------------------------------------------ utility
def('util.switch', 'Switch', 'Utility', [cP('a', 'A', [0, 0, 0]), cP('b', 'B', [1, 1, 1])], [O('out', 'Output', 'color')], [B('useB', 'Use B')],
  c => ({ out: `select(${c.inputs.a}, ${c.inputs.b}, ${c.params.useB} > 0.5)` }), 'Pick one of two inputs (A/B test).', { tags: ['toggle', 'choose'] });
def('util.reroute', 'Reroute', 'Utility', [cP('in', 'In')], [O('out', 'Out', 'color')], [], c => ({ out: c.inputs.in }), 'A pass-through dot for tidy wires (color).', { tags: ['dot', 'wire'] });
def('util.rerouteFloat', 'Reroute Gray', 'Utility', [fP('in', 'In')], [O('out', 'Out', 'float')], [], c => ({ out: c.inputs.in }), 'A pass-through dot for tidy wires (gray).', { tags: ['dot', 'wire'] });
def('util.rerouteNormal', 'Reroute Normal', 'Utility', [nP('in', 'In')], [O('out', 'Out', 'normal')], [], c => ({ out: c.inputs.in }), 'A pass-through dot for tidy wires (normal).', { tags: ['dot', 'wire'] });
def('util.cache', 'Cache', 'Utility', [tP('in', 'In')], [O('out', 'Out', 'texture', 'rgba')], [],
  pass(c => `fn pass_main(uv: vec2f) -> vec4f { return ${c.sample.in('uv')}; }`),
  'Bake the input to a texture: heavy upstream math then runs once, not per consumer.', { tags: ['bake', 'freeze'] });

def('util.expression', 'WGSL Expression', 'Utility', [fP('a', 'a'), fP('b', 'b'), fP('c', 'c'), fP('d', 'd')], [O('out', 'Result', 'float')],
  [{ id: 'code', label: 'Expression (a, b, c, d, uv, res)', kind: 'text', default: 'a * 0.5 + 0.5 * sin(uv.x * 6.2831853 * 4.0)' }],
  c => {
    c.fn(`fn ${c.uid}_x(a: f32, b: f32, c: f32, d: f32, uv: vec2f, res: f32) -> f32 {\n  return f32(${String(c.values.code || '0.0')});\n}`);
    const i = c.inputs;
    return { out: `${c.uid}_x(${i.a}, ${i.b}, ${i.c}, ${i.d}, ${c.uv}, ${c.res})` };
  }, 'A WGSL f32 expression of a, b, c, d, uv and res.', { tags: ['code', 'formula', 'custom'] });

def('util.expressionColor', 'WGSL Color Expression', 'Utility', [cP('a', 'a'), cP('b', 'b'), fP('t', 't')], [O('out', 'Result', 'color')],
  [{ id: 'code', label: 'Expression (a, b, t, uv, res)', kind: 'text', default: 'mix(a, b, smoothstep(0.4, 0.6, t))' }],
  c => {
    c.fn(`fn ${c.uid}_x(a: vec3f, b: vec3f, t: f32, uv: vec2f, res: f32) -> vec3f {\n  return vec3f(${String(c.values.code || 'a')});\n}`);
    return { out: `${c.uid}_x(${c.inputs.a}, ${c.inputs.b}, ${c.inputs.t}, ${c.uv}, ${c.res})` };
  }, 'A WGSL vec3f expression of a, b, t, uv and res.', { tags: ['code', 'formula', 'custom'] });

def('util.customPass', 'WGSL Custom Pass', 'Utility', [tP('a', 'a'), tP('b', 'b')], [O('out', 'Output', 'texture', 'rgba')],
  [{ id: 'code', label: 'pass_main body (inA(p), inB(p) sample; res)', kind: 'text', default: 'let e = 2.0 / res;\nreturn (inA(uv + vec2f(e, 0.0)) + inA(uv - vec2f(e, 0.0)) + inB(uv)) / 3.0;' }],
  pass(c => `
fn inA(p: vec2f) -> vec4f { return ${c.sample.a('p')}; }
fn inB(p: vec2f) -> vec4f { return ${c.sample.b('p')}; }
fn pass_main(uv: vec2f) -> vec4f {
  let res = ${c.res};
${String(c.values.code || 'return inA(uv);')}
}`), 'A WGSL pass body: sample the inputs at any uv (filters, kernels).', { tags: ['code', 'shader', 'custom'] });

// ------------------------------------------------------------ material
def('material.pbrFromHeight', 'PBR from Height', 'Output', [fP('height', 'Height', 0.5), cP('color', 'Color', [0.6, 0.6, 0.6])],
  [O('baseColor', 'Base Color', 'color'), O('normal', 'Normal', 'normal'), O('ao', 'AO', 'float'), O('roughness', 'Roughness', 'float'),
    O('metallic', 'Metallic', 'float'), O('height', 'Height', 'float')],
  [S('normalStrength', 'Normal Strength', 0, 20, 2, 0.01), S('roughLow', 'Roughness at Peaks', 0, 1, 0.35), S('roughHigh', 'Roughness in Cavities', 0, 1, 0.8),
    S('aoRadius', 'AO Radius', 0.001, 0.2, 0.03, 0.0005), S('aoDepth', 'AO Depth', 0, 0.5, 0.06, 0.001), S('metallic', 'Metallic', 0, 1, 0)],
  { expand: v => ({
    nodes: [
      { id: 'n', type: 'hn.heightToNormal', params: { strength: v.normalStrength } },
      { id: 'ao', type: 'hn.aoFromHeight', params: { radius: v.aoRadius, depth: v.aoDepth } },
      { id: 'r', type: 'adjust.remap', params: { inLow: 0, inHigh: 1, outLow: v.roughHigh, outHigh: v.roughLow, clamp: true } },
      { id: 'c', type: 'util.reroute', params: {} },
      { id: 'h', type: 'util.rerouteFloat', params: {} },
      { id: 'm', type: 'input.value', params: { v: v.metallic } },
    ],
    links: [],
    inputs: { height: [['n', 'height'], ['ao', 'height'], ['r', 'in'], ['h', 'in']], color: [['c', 'in']] },
    outputs: { baseColor: ['c', 'out'], normal: ['n', 'normal'], ao: ['ao', 'ao'], roughness: ['r', 'out'], metallic: ['m', 'out'], height: ['h', 'out'] },
  }) }, 'One height map in, a full set of PBR channels out (macro: normal, AO, roughness).', { tags: ['macro', 'quick'] });

const METALS = {
  iron: [0.560, 0.570, 0.580], silver: [0.972, 0.960, 0.915], aluminum: [0.913, 0.922, 0.924], gold: [1.000, 0.766, 0.336],
  copper: [0.955, 0.637, 0.538], chromium: [0.550, 0.556, 0.554], nickel: [0.660, 0.609, 0.526], titanium: [0.542, 0.497, 0.449],
  cobalt: [0.662, 0.655, 0.634], platinum: [0.673, 0.637, 0.585], brass: [0.910, 0.778, 0.423], zinc: [0.664, 0.824, 0.850],
};
const vec3lit = a => `vec3f(${a.map(x => x.toFixed(3)).join(', ')})`;
def('material.metal', 'Metal Preset', 'Output', [], [O('baseColor', 'Base Color', 'color'), O('metallic', 'Metallic', 'float'), O('roughness', 'Roughness', 'float')],
  [E('metal', 'Metal', Object.keys(METALS), 'iron'), S('roughness', 'Roughness', 0, 1, 0.3)],
  c => ({ baseColor: vec3lit(METALS[c.values.metal] || METALS.iron), metallic: '1.0', roughness: c.params.roughness }),
  'Measured base color (linear F0) of common metals, metallic 1.', { tags: ['gold', 'copper', 'steel', 'f0'] });

const DIELECTRICS = {
  plastic: [[0.5, 0.5, 0.5], 0.4], rubber: [[0.03, 0.03, 0.03], 0.85], concrete: [[0.51, 0.51, 0.51], 0.9], charcoal: [[0.02, 0.02, 0.02], 0.9],
  freshSnow: [[0.81, 0.81, 0.81], 0.6], oakWood: [[0.40, 0.27, 0.15], 0.6], sand: [[0.44, 0.39, 0.23], 0.85], skin: [[0.61, 0.43, 0.36], 0.5],
  grass: [[0.21, 0.28, 0.06], 0.7], brick: [[0.36, 0.16, 0.10], 0.8], ceramic: [[0.85, 0.85, 0.82], 0.15], asphalt: [[0.05, 0.05, 0.05], 0.9],
};
def('material.dielectric', 'Dielectric Preset', 'Output', [], [O('baseColor', 'Base Color', 'color'), O('roughness', 'Roughness', 'float')],
  [E('material', 'Material', Object.keys(DIELECTRICS), 'plastic')],
  c => {
    const d = DIELECTRICS[c.values.material] || DIELECTRICS.plastic;
    return { baseColor: vec3lit(d[0]), roughness: d[1].toFixed(3) };
  }, 'Plausible albedo and roughness for common non-metals.', { tags: ['albedo', 'reference'] });

def('material.glossToRoughness', 'Gloss to Roughness', 'Output', [fP('in', 'Gloss / Smoothness', 0.5)], [O('out', 'Roughness', 'float')], [E('mode', 'Mode', ['linear', 'squared', 'sqrt'])],
  c => {
    const x = `(1.0 - clamp(${c.inputs.in}, 0.0, 1.0))`;
    return { out: { linear: x, squared: `(${x} * ${x})`, sqrt: `sqrt(${x})` }[c.values.mode] || x };
  }, 'Convert gloss/smoothness maps (Unity) to roughness.', { tags: ['smoothness', 'unity'] });

def('material.aoCombine', 'AO Combine', 'Output', [fP('a', 'AO A', 1), fP('b', 'AO B', 1)], [O('out', 'AO', 'float')], [S('strengthA', 'Strength A', 0, 2, 1), S('strengthB', 'Strength B', 0, 2, 1)],
  c => ({ out: `clamp(mix(1.0, ${c.inputs.a}, ${c.params.strengthA}) * mix(1.0, ${c.inputs.b}, ${c.params.strengthB}), 0.0, 1.0)` }),
  'Multiply two occlusion maps with separate strengths.', { tags: ['occlusion'] });

def('material.emission', 'Emission', 'Output', [fP('mask', 'Mask', 1), cP('color', 'Color', [1, 0.5, 0.1])], [O('out', 'Emissive', 'color')], [S('intensity', 'Intensity', 0, 20, 1, 0.01)],
  c => ({ out: `(${c.inputs.color} * ${c.inputs.mask} * ${c.params.intensity})` }), 'Glow color masked and scaled.', { tags: ['glow', 'light'] });

def('material.layer', 'Material Layer Mix', 'Output',
  [cP('colorA', 'A Color', [0.3, 0.3, 0.3]), fP('roughA', 'A Roughness', 0.6), fP('metalA', 'A Metallic', 0), nP('normalA', 'A Normal'), fP('heightA', 'A Height', 0.5),
    cP('colorB', 'B Color', [0.7, 0.7, 0.7]), fP('roughB', 'B Roughness', 0.3), fP('metalB', 'B Metallic', 0), nP('normalB', 'B Normal'), fP('heightB', 'B Height', 0.5),
    fP('mask', 'Mask', 0.5)],
  [O('color', 'Color', 'color'), O('roughness', 'Roughness', 'float'), O('metallic', 'Metallic', 'float'), O('normal', 'Normal', 'normal'), O('height', 'Height', 'float')],
  [S('contrast', 'Mask Contrast', 0, 1, 0)],
  c => {
    const i = c.inputs, u = c.uid;
    c.let(`let ${u}_w = max(1.0 - ${c.params.contrast}, 0.0005) * 0.5;`);
    c.let(`let ${u}_m = smoothstep(0.5 - ${u}_w, 0.5 + ${u}_w, ${i.mask});`);
    return {
      color: `mix(${i.colorA}, ${i.colorB}, ${u}_m)`, roughness: `mix(${i.roughA}, ${i.roughB}, ${u}_m)`, metallic: `mix(${i.metalA}, ${i.metalB}, ${u}_m)`,
      normal: `normalize(mix(${i.normalA}, ${i.normalB}, ${u}_m))`, height: `mix(${i.heightA}, ${i.heightB}, ${u}_m)`,
    };
  }, 'Blend two full materials (color, roughness, metallic, normal, height) by a mask.', { tags: ['layer', 'blend', 'mix'] });

/** @type {import('../contract.js').NodeDef[]} */
export const NODES = NODES_;

/** Category -> count, for the self test and the library header. */
export function catalogSummary() {
  const out = {};
  for (const d of NODES) out[d.category] = (out[d.category] || 0) + 1;
  return { total: NODES.length, byCategory: out };
}

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  ctx.register('core', { NODES, catalogSummary, selfTest: () => catalogSummary() });
}
