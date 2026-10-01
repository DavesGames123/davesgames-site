// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/blend.js — core library: blend
// ────────────────────────────────────────────────────────────────────────────
//  Nodes that combine two inputs: Blend (20 modes), Mix, Mask Combine and
//  Mix Gray.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'blend.blend' 'blend.mix' 'blend.maskCombine' 'blend.mixFloat'
//      helpers .... BLEND_MODES MASK_OPS
// ============================================================================
import { fP, cP, O, S, E, B, ix, lp, def } from './build.js';

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
