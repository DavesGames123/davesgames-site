// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/color.js — core library: color
// ────────────────────────────────────────────────────────────────────────────
//  Per-texel color nodes: HSV, brightness and contrast, colorize, gray
//  conversion, gradient map, channel split, merge and shuffle, gamma decode
//  and encode, tint, color select and replace, white balance.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'color.hsv' 'color.brightnessContrast' 'color.colorize'
//                   'color.toGray' 'color.grayToColor' 'color.gradientMap'
//                   'color.split' 'color.merge' 'color.srgbToLinear'
//                   'color.linearToSrgb' 'color.tint' 'color.select'
//                   'color.replace' 'color.temperature' 'color.channelShuffle'
//      helpers .... GRAY
// ============================================================================
import { fP, tP, IN_C, O, S, E, K, ix, def } from './build.js';

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
