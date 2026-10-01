// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/vector.js — core library: vector
// ────────────────────────────────────────────────────────────────────────────
//  vec2 and vec3 math nodes: split, combine, dot, cross, length, normalize,
//  distance, add, subtract, multiply, scale, mix and rotate.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'vec.split2' 'vec.split3' 'vec.combine2' 'vec.combine3'
//                   'vec.dot' 'vec.cross' 'vec.length' 'vec.normalize'
//                   'vec.distance' 'vec.add' 'vec.sub' 'vec.mul' 'vec.scale'
//                   'vec.mix' 'vec.rotate2'
// ============================================================================
import { fP, v2P, v3P, O, S, V, lp, def } from './build.js';

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
