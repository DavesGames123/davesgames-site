// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/utility.js — core library: utility
// ────────────────────────────────────────────────────────────────────────────
//  Switch, reroute and cache nodes, and the nodes that run WGSL text from
//  the user (expression, color expression, custom pass).
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'util.switch' 'util.reroute' 'util.rerouteFloat'
//                   'util.rerouteNormal' 'util.cache' 'util.expression'
//                   'util.expressionColor' 'util.customPass'
// ============================================================================
import { fP, cP, nP, tP, O, B, def, pass } from './build.js';

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
