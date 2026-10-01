// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/noise.js — core library: noise
// ────────────────────────────────────────────────────────────────────────────
//  Periodic noise nodes: value, gradient, simplex, Worley, Voronoi edges,
//  the fBm family, domain warp, and surface noises such as cracks and dirt.
//  per() makes the tile period of a noise node from its scale params.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'noise.value' 'noise.perlin' 'noise.simplex' 'noise.worley'
//                   'noise.voronoiEdges' 'noise.fbm' 'noise.ridged' 'noise.billow'
//                   'noise.domainWarp' 'noise.clouds' 'noise.cracks' 'noise.dirt'
//                   'noise.blocks' 'noise.white' 'noise.brushed'
//      helpers .... per NOISE_P KINDS FRACTAL_P
// ============================================================================
import { UVIN, O, S, I, E, SEED, ix, sd, def } from './build.js';

/** Emit the period lets for a noise node and return the vec2i name. */
function per(c) {
  const u = c.uid, p = c.params;
  c.let(`let ${u}_sx = max(i32(round(${p.scale})), 1);`);
  c.let(`let ${u}_per = vec2i(${u}_sx, select(max(i32(round(${p.scaleY})), 1), ${u}_sx, ${p.scaleY} < 0.5));`);
  return `${u}_per`;
}

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
