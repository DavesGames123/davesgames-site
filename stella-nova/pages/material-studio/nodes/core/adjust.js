// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/adjust.js — core library: adjust
// ────────────────────────────────────────────────────────────────────────────
//  Per-texel value adjustments: levels, curves, the histogram nodes,
//  invert, clamp, remap, posterize, threshold and gamma.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'adjust.levels' 'adjust.curves' 'adjust.histogramScan'
//                   'adjust.histogramRange' 'adjust.histogramShift'
//                   'adjust.invert' 'adjust.clamp' 'adjust.remap'
//                   'adjust.posterize' 'adjust.threshold' 'adjust.gamma'
// ============================================================================
import { fP, IN_C, O, S, I, E, B, def } from './build.js';

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
