// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/pattern.js — core library: pattern
// ────────────────────────────────────────────────────────────────────────────
//  Scatter pass nodes (Tile Sampler, Splatter) that put random stamps on a
//  grid of cells. scatterWgsl() writes the WGSL for both nodes.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'pattern.tileSampler' 'pattern.splatter'
//      helpers .... STAMPS STAMP_BLEND scatterWgsl SCATTER_P SCATTER_OUT
// ============================================================================
import { cP, O, S, I, E, SEED, ix, sd, def } from './build.js';

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
  SCATTER_P(8, 1, 0.1, 0.9, 0.2, 0.1), { wgsl: scatterWgsl, tiled: true },
  'One stamp per grid cell with random offset, rotation, scale and value. Stamp = the input or a built-in shape.', { tags: ['scatter', 'stamp'] });

def('pattern.splatter', 'Splatter', 'Pattern', [cP('pattern', 'Pattern', [1, 1, 1])], SCATTER_OUT,
  SCATTER_P(5, 4, 1, 0.5, 0.6, 1), { wgsl: scatterWgsl, tiled: true },
  'Many stamps per cell at random positions and angles.', { tags: ['scatter', 'pebbles', 'leaves'] });
