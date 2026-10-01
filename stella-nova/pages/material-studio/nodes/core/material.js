// ============================================================================
//  MATERIAL STUDIO  ·  nodes/core/material.js — core library: material
// ────────────────────────────────────────────────────────────────────────────
//  Material-level nodes: the PBR from Height macro, the metal and
//  dielectric presets, gloss to roughness, AO combine, emission and the
//  material layer mix.
//
//  nodes/core.js imports this file for its side effect: each def() call
//  appends one NodeDef to the shared list in nodes/core/build.js.
//
//  GREP TARGETS  (grep -n the quoted type id or the name)
//      def types .. 'material.pbrFromHeight' 'material.metal'
//                   'material.dielectric' 'material.glossToRoughness'
//                   'material.aoCombine' 'material.emission' 'material.layer'
//      helpers .... METALS vec3lit DIELECTRICS
// ============================================================================
import { fP, cP, nP, O, S, E, def } from './build.js';

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
