// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/math.js — core library: math
// ────────────────────────────────────────────────────────────────────────────
//  Float math nodes. mathBin() and mathUn() make the two-operand and one-
//  operand nodes. An operand that is not linked reads its va or vb param.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'math.lerp' 'math.smoothstep' 'math.clamp' 'math.compare'
//      math ops ... 'add' 'sub' 'mul' 'div' 'pow' 'min' 'max' 'mod' 'atan2' 'step'
//                   'abs' 'frac' 'floor' 'ceil' 'round' 'sin' 'cos' 'sqrt'
//                   'oneMinus' 'negate' 'sign' 'exp' 'log' 'saturate'
//      helpers .... MATH_RANGE mathBin mathUn
// ============================================================================
import { fP, O, S, E, lp, def } from './build.js';

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
