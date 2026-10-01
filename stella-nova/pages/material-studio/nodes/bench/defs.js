// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/defs.js — NodeDefs of the bench cells
// ────────────────────────────────────────────────────────────────────────────
//  Builds one boundary pass NodeDef per bench cell ("bench.<lib>.<cell>")
//  and per generic kind ("bench.gen.<kind>"). The params are uniform:false,
//  so an edit recompiles. def.pass connects the def to the fallback
//  (fallback.js) and to the GPU runner (runner.js).
//
//  GREP TARGETS  (grep -n the name to jump)
//      P / SHARED / tileParam / decodeParam
//      paramsFor / portsFor
//      makePass / cellDef / genericDef
//      loadBenchNodes
// ============================================================================
import { BENCH_STATES, BENCH_PALETTE } from '../../../../lib/bench-wgsl.js';
import { catalog, LIB_TRAITS, BENCH_NON_TILEABLE_CELLS, TILE_MODES, VALUE_MODES, GEN_KINDS, DEFS } from './catalog.js';
import { fallbackWGSL } from './fallback.js';
import { runBenchPass, prepareBenchPass } from './runner.js';

const pretty = s => s.replace(/_/g, ' ');

const P = {
  slider: (id, label, def, min = 0, max = 1, step = 0.01) => ({ id, label, kind: 'slider', min, max, step, default: def, uniform: false }),
  int: (id, label, def, min, max, step = 1) => ({ id, label, kind: 'int', min, max, step, default: def, uniform: false }),
  enm: (id, label, def, options) => ({ id, label, kind: 'enum', options, default: def, uniform: false }),
  color: (id, label, def) => ({ id, label, kind: 'color', default: def, uniform: false }),
  bool: (id, label, def) => ({ id, label, kind: 'bool', default: def, uniform: false }),
  vec2: (id, label, def, min, max, step) => ({ id, label, kind: 'vec2', min, max, step, default: def, uniform: false }),
  text: (id, label, def) => ({ id, label, kind: 'text', default: def, uniform: false }),
};

// Shared param objects (frozen, reused by every def to keep 1125 defs light).
const SHARED = Object.freeze({
  time: Object.freeze(P.slider('time', 'Time (s)', 2, 0, 60, 0.01)),
  ink: Object.freeze(P.color('ink', 'Ink', BENCH_PALETTE.ink)),
  tone: Object.freeze(P.color('tone', 'Tone', BENCH_PALETTE.tone)),
  cream: Object.freeze(P.color('cream', 'Cream', BENCH_PALETTE.cream)),
  edge: Object.freeze(P.slider('edge', 'Seam blend', 0.18, 0.02, 0.5, 0.01)),
  zoom: Object.freeze(P.slider('zoom', 'Zoom', 1, 0.25, 4, 0.01)),
  rotate: Object.freeze(P.slider('rotate', 'Rotate (deg)', 0, -180, 180, 1)),
  offset: Object.freeze(P.vec2('offset', 'Offset', [0, 0], -1, 1, 0.001)),
  quality: Object.freeze(P.enm('quality', 'Supersample', '1', [{ value: '1', label: '1x' }, { value: '2', label: '2x (antialias)' }])),
  value: Object.freeze(P.enm('value', 'Value channel', 'luma', VALUE_MODES)),
  matte: Object.freeze(P.enm('matte', 'Alpha matte', 'ink', [{ value: 'ink', label: 'over ink (bench look)' }, { value: 'keep', label: 'keep color' }])),
  coordSpace: Object.freeze(P.enm('coordSpace', 'Coord input space', 'uv', [{ value: 'uv', label: 'studio uv 0..1' }, { value: 'bench', label: 'bench p (raw)' }])),
  coordScale: Object.freeze(P.slider('coordScale', 'Coord scale', 1, 0.05, 8, 0.01)),
  outSpace: Object.freeze(P.enm('outSpace', 'Coord output space', 'uv', [{ value: 'uv', label: 'studio uv 0..1' }, { value: 'bench', label: 'bench p (raw)' }])),
  state: Object.freeze(P.enm('state', 'Orb state', 'idle', BENCH_STATES.slice())),
  steps: Object.freeze(P.int('steps', 'Sim steps', 240, 0, 6000, 1)),
  grid: Object.freeze(P.enm('grid', 'Sim grid', '128', ['128', '256', '512'])),
  simSeed: Object.freeze(P.int('simSeed', 'Sim seed', 0, 0, 9999, 1)),
  filter: Object.freeze(P.enm('filter', 'Sim filter', 'linear', ['linear', 'nearest'])),
  code: Object.freeze(P.text('code', 'WGSL override', '')),
});
const tileParam = Object.fromEntries(TILE_MODES.map(m => [m, Object.freeze(P.enm('tile', 'Tile', m, TILE_MODES))]));
const decodeParam = Object.fromEntries(['raw', 'srgb'].map(m => [m, Object.freeze(P.enm('decode', 'Color decode', m, [{ value: 'srgb', label: 'sRGB to linear (color)' }, { value: 'raw', label: 'raw (data)' }]))]));

/** Params of a library cell node, in inspector order. */
function paramsFor(L, key, cell) {
  const T = LIB_TRAITS[key] || { tile: 'none', decode: 'srgb' };
  const ps = [];
  (cell.knobs || []).forEach((kn, i) => { if (kn) ps.push(P.slider('k' + i, kn, (cell.defaults || [0.5, 0.5, 0.5, 0.5])[i])); });
  L.extras.forEach((e, j) => ps.push(P.slider('x' + j, e.name, e.d)));
  if (L.orb) ps.push(SHARED.state);
  if (L.sim) ps.push(SHARED.steps, SHARED.grid, SHARED.simSeed, SHARED.filter);
  ps.push(SHARED.time, SHARED.ink, SHARED.tone, SHARED.cream);
  if (L.inputs.some(i => i[1] === 'coord')) ps.push(SHARED.coordSpace, SHARED.coordScale);
  if (L.out === 'coord') ps.push(SHARED.outSpace);
  ps.push(tileParam[BENCH_NON_TILEABLE_CELLS.has(`${key}.${cell.name}`) ? 'none' : T.tile], SHARED.edge, SHARED.zoom, SHARED.rotate, SHARED.offset);
  if (L.out !== 'coord') ps.push(decodeParam[T.decode], SHARED.value, SHARED.matte);
  if (!L.sim) ps.push(SHARED.quality, SHARED.code);
  return ps;
}

/** Input and output sockets for bench inputs [[name, 'img'|'coord', optional]] and out. */
function portsFor(inputs, out) {
  const ins = inputs.map(([name, ty, opt]) => ty === 'coord'
    ? { id: name, label: name === 'p' ? 'Coord (p)' : name, type: 'vec2', default: [0, 0], optional: !!opt }
    : { id: name, label: name === 'img' ? 'Image' : name, type: 'color', default: [0, 0, 0], optional: !!opt });
  const outs = out === 'coord'
    ? [{ id: 'uv', label: 'Coord', type: 'vec2', swizzle: 'rg' }, { id: 'tex', label: 'Texture', type: 'texture', swizzle: 'rgba' }]
    : [{ id: 'color', label: 'Color', type: 'color', swizzle: 'rgb' }, { id: 'value', label: 'Value', type: 'float', swizzle: 'a' }, { id: 'tex', label: 'Texture', type: 'texture', swizzle: 'rgba' }];
  return { ins, outs };
}

function makePass(def) {
  return {
    inputsAsTextures: true,
    external: 'bench',
    wgsl: ctx => fallbackWGSL(def, ctx),
    run: job => runBenchPass(def, job),
    prepare: (device, values) => prepareBenchPass(def, device, values),
    load: () => (def.bench.lib ? catalog().then(c => c.ensureLib(def.bench.lib)) : catalog()),
  };
}

function cellDef(key, L, cell, group) {
  const { ins, outs } = portsFor(L.inputs, L.out);
  const def = {
    type: `bench.${key}.${cell.name}`,
    label: pretty(cell.name),
    category: `Bench / ${group} / ${L.label}`,
    inputs: ins, outputs: outs,
    params: paramsFor(L, key, cell),
    doc: cell.line,
    tags: ['bench', key, L.label.toLowerCase(), cell.family, group.toLowerCase(), L.page],
    source: 'bench',
    bench: { lib: key, cell: cell.name, family: cell.family, page: L.page, sim: !!L.sim, orb: !!L.orb, out: L.out,
      inputs: L.inputs.map(i => ({ name: i[0], type: i[1] })), traits: LIB_TRAITS[key] || {} },
  };
  def.pass = makePass(def);
  return def;
}

function genericDef(kind, Gk) {
  const { ins, outs } = portsFor(Gk.inputs, Gk.out);
  const ps = [];
  if (Gk.ops) ps.push(P.enm('op', 'Op', Object.keys(Gk.ops)[0], Object.keys(Gk.ops)));
  Gk.knobs.forEach((kn, i) => { if (kn) ps.push(P.slider('k' + i, kn, Gk.defaults[i])); });
  ps.push(SHARED.time);
  if (Gk.inputs.some(i => i[1] === 'coord')) ps.push(SHARED.coordSpace, SHARED.coordScale);
  if (Gk.out === 'coord') ps.push(SHARED.outSpace);
  ps.push(tileParam.none, SHARED.edge, SHARED.zoom, SHARED.rotate, SHARED.offset);
  if (Gk.out !== 'coord') ps.push(decodeParam.raw, SHARED.value, SHARED.matte);
  ps.push(SHARED.quality, SHARED.code);
  const def = {
    type: `bench.gen.${kind}`, label: Gk.label, category: 'Bench / Generic',
    inputs: ins, outputs: outs, params: ps,
    doc: { transform: 'Scale, rotate and offset a bench coordinate field.', warp: 'Resample an image through a coordinate field (domain warp).',
      displace: 'Push an image around by the red channel of a second image.', blend: 'Blend two bench images with one of nine ops.',
      map: 'Remap an image value: gamma, contrast, posterize, contour and more.' }[kind] || Gk.label,
    tags: ['bench', 'generic', kind], source: 'bench',
    bench: { gen: kind, out: Gk.out, inputs: Gk.inputs.map(i => ({ name: i[0], type: i[1] })), traits: {} },
  };
  def.pass = makePass(def);
  return def;
}

/**
 * Build the bench NodeDefs. main.js calls this once before module init and
 * adds the result to state.registry. It fetches the catalog only; each
 * library's WGSL loads on first use (def.pass.load / run / wgsl).
 * @returns {Promise<import('../../contract.js').NodeDef[]>}
 */
export async function loadBenchNodes() {
  const C = await catalog();
  const out = [];
  for (const g of C.INDEX.groups) for (const key of g.libs) {
    const L = C.LIBS[key];
    for (const cell of L.cells) out.push(cellDef(key, L, cell, g.name));
  }
  for (const kind of GEN_KINDS) if (C.GENERIC[kind]) out.push(genericDef(kind, C.GENERIC[kind]));
  DEFS.clear(); for (const d of out) DEFS.set(d.type, d);
  return out;
}
