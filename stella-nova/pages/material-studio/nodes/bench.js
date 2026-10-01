// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench.js — Composition Bench cells as material nodes
// ────────────────────────────────────────────────────────────────────────────
//  Every cell of every Composition Bench library (21 libraries, 1120 cells,
//  composition-bench/libs/index.json) becomes one boundary 'pass' NodeDef of
//  type "bench.<lib>.<cell>". The five generic bench kinds (transform, warp,
//  displace, blend, map) become "bench.gen.<kind>". The WGSL assembly and the
//  uniform packing come from ../../../lib/bench-wgsl.js, the same code the
//  bench page runs, so a node renders here as it does on the bench.
//
//  DATA FLOW
//      loadBenchNodes() ── index.json only ──▶ 1125 NodeDefs (no WGSL yet)
//      bake ── def.pass.run(job) ──▶ ensureLib (fetch libs/<key>.json once)
//          ──▶ cell pass: moduleFor + in0/in1 hook ──▶ cell texture (res x ss)
//              (sim libraries: compute steps on an N x N state, then present)
//          ──▶ frame pass: zoom / rotate / offset, tile mode, matte, value,
//              sRGB decode ──▶ job.target (rgba16float, res x res)
//      compiler without run() ── def.pass.wgsl(ctx) ──▶ a fused pass_main
//          fallback (the cell inlined as a function, uniforms as literals)
//      importBenchGraph(json) ──▶ contract Graph (bench nodes + Material Output)
//      exportBenchGraph(graph) ──▶ bench graph JSON ── openInBench ──▶ new tab
//
//  SECTIONS  (grep -n the name to jump)
//      catalog .............. BENCH_BASE / catalog() / LIB_TRAITS / BENCH_NON_TILEABLE
//                             BENCH_NON_TILEABLE_CELLS
//      param builders ....... P / sharedParams / paramsFor / portsFor
//      NodeDef builders ..... cellDef / genericDef / loadBenchNodes
//      values ............... withDefaults / nodeOf / paletteOf
//      WGSL: cell module .... hookInputs / cellSource
//      WGSL: frame pass ..... FRAME_WGSL / frameUniform
//      WGSL: fallback ....... parseStruct / uniformCtor / fallbackWGSL
//      GPU runner ........... BenchRunner (pipelines, pools, run, sims, trim, flush), trimBench
//      pass entry points .... runBenchPass / prepareBenchPass / renderBenchNode
//      graph import ......... importBenchGraph
//      graph export ......... exportBenchGraph / openInBench
//      self test ............ selfTest / selfTestAll
//      init ................. registers __studio.bench
//
//  PASS PROTOCOL  (beyond contract.js; the compiler and bake should use it)
//      def.pass.external === 'bench' marks a node that runs its own GPU work.
//      await def.pass.run(job) renders the node into job.target and submits
//      its own command buffers on device.queue. Submit the passes that write
//      the input textures before you call run (queue order does the rest).
//        job = { device, target: GPUTexture|GPUTextureView (rgba16float,
//                res x res, RENDER_ATTACHMENT), res, values: node.params,
//                inputs: {inputId: GPUTexture|GPUTextureView|null} (null or
//                missing = not linked), seed?: number, time?: number }
//      def.pass.prepare(device, values) compiles the pipelines ahead of time.
//      def.pass.wgsl(ctx) is the contract fallback: a pass_main that inlines
//      the cell. It reads ctx.values (all bench params are uniform:false, so
//      an edit recompiles) and ctx.linked?.[id] (else ctx.tex[id] presence)
//      to know if an input is wired. Sim libraries have no fallback: their
//      wgsl() throws, and they need run().
//
//  OUTPUTS OF A NODE  (the rgba16float texture the node writes)
//      image cells .... rgb = color (linear after sRGB decode), a = value
//                       outputs: color (rgb), value (a), tex (rgba)
//      coord cells .... rg = coordinate in studio uv space (bench p*0.5+0.5)
//                       outputs: uv (rg), tex (rgba)
//
//  COORDINATES
//      Studio uv is [0,1)^2, origin top-left, +v down. The cell renders with
//      fp.xy = uv * size, which is the bench framebuffer convention, so no
//      flip is needed. A coord input converts studio uv to the bench space
//      p = (uv*2-1)*scale (param coordSpace 'uv') or passes it raw ('bench').
//      Tiling: see LIB_TRAITS and the 'tile' param (none, seamless, mirror,
//      repeat). BENCH_NON_TILEABLE names the libraries whose cells draw one
//      centered subject, where 'seamless' blends ghosts instead of a texture.
//      BENCH_NON_TILEABLE_CELLS names single cells of tiling libraries that
//      still have an edge seam: their default tile mode is 'none'.
//      Graph tiling: a cell with no linked input repeats job.tiling times
//      (frameUniform xf.w = tiling / res, fract in fs_frame).
// ============================================================================
import {
  loadBenchCatalog, BENCH_STATES, BENCH_PALETTE, BENCH_UBYTES,
  BENCH_BGL_ENTRIES, BENCH_CBGL_ENTRIES, BENCH_PBGL_ENTRIES, hexToRgb,
} from '../../../lib/bench-wgsl.js';
import { OUTPUT_TYPE, GRAPH_VERSION, DEFAULT_SETTINGS, validateGraph } from '../contract.js';

// ------------------------------------------------------------ catalog
/** URL of the composition-bench folder. */
export const BENCH_BASE = new URL('../../composition-bench/', import.meta.url);
/** URL of the bench page (Open in Composition Bench). */
export const BENCH_PAGE = new URL('index.html', BENCH_BASE);
/** localStorage key of the one-shot graph hand-off to the bench page. */
export const BENCH_HANDOFF_KEY = 'composition-bench.import';

let CAT = null;          // the loaded catalog (lib/bench-wgsl.js)
let catP = null;
/** The shared bench catalog. Resolves once; later calls reuse it. */
export function catalog() {
  if (!catP) catP = loadBenchCatalog(BENCH_BASE).then(c => (CAT = c));
  return catP;
}

/**
 * Per-library defaults. tile: the default tile mode. decode: 'srgb' for
 * display-referred image cells, 'raw' for data cells (noise, coordinates).
 * centered: the cells draw one subject in the middle (not a texture).
 * operator: the cell transforms its input image (it tiles if the input does).
 */
export const LIB_TRAITS = Object.freeze({
  noise:        { tile: 'seamless', decode: 'raw' },
  field:        { tile: 'none',     decode: 'raw' },
  sim:          { tile: 'repeat',   decode: 'srgb', periodic: true },
  dotfield:     { tile: 'seamless', decode: 'srgb' },
  polar:        { tile: 'none',     decode: 'srgb', centered: true },
  color:        { tile: 'none',     decode: 'srgb', operator: true },
  postfx:       { tile: 'none',     decode: 'srgb', operator: true },
  lighting:     { tile: 'none',     decode: 'srgb', centered: true },
  sampling:     { tile: 'seamless', decode: 'raw' },
  refraction:   { tile: 'none',     decode: 'srgb', operator: true, centered: true },
  solids:       { tile: 'none',     decode: 'srgb', centered: true },
  sdf2d:        { tile: 'none',     decode: 'srgb', centered: true },
  metal:        { tile: 'seamless', decode: 'srgb' },
  beam:         { tile: 'none',     decode: 'srgb', centered: true },
  fire:         { tile: 'none',     decode: 'srgb', centered: true },
  fire_evolved: { tile: 'none',     decode: 'srgb', centered: true },
  smoke:        { tile: 'none',     decode: 'srgb', centered: true },
  heat_haze:    { tile: 'none',     decode: 'srgb', operator: true },
  heat_metal:   { tile: 'repeat',   decode: 'srgb', periodic: true },
  frost:        { tile: 'seamless', decode: 'srgb' },
  orb:          { tile: 'none',     decode: 'srgb', centered: true },
});
/** Libraries whose cells draw one centered subject: they do not tile. */
export const BENCH_NON_TILEABLE = Object.freeze(Object.keys(LIB_TRAITS).filter(k => LIB_TRAITS[k].centered));
/**
 * Cells in a tiling library that still draw a framed subject or a
 * non-periodic field, so 'seamless' or 'repeat' leaves a hard seam at the
 * texture edge. Their default tile mode is 'none'. Found by an edge test:
 * the wrap-edge texel difference was 5x to 40x the neighbor difference.
 */
export const BENCH_NON_TILEABLE_CELLS = Object.freeze(new Set([
  'heat_metal.rolled', 'frost.chill_drain', 'frost.sweat_wet', 'frost.hoar_dust',
  'frost.decal_vs_crust', 'frost.inner_surface', 'frost.lod_levels', 'sim.sand',
]));
/** Libraries that are periodic by construction (wrapped simulation grids). */
export const BENCH_PERIODIC = Object.freeze(Object.keys(LIB_TRAITS).filter(k => LIB_TRAITS[k].periodic));

const TILE_MODES = ['none', 'seamless', 'mirror', 'repeat'];
const VALUE_MODES = ['luma', 'alpha', 'red', 'max'];
const GEN_KINDS = ['transform', 'warp', 'displace', 'blend', 'map'];
const pretty = s => s.replace(/_/g, ' ');

// ------------------------------------------------------------ param builders
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

// ------------------------------------------------------------ NodeDef builders
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

const DEFS = new Map();   // type -> def (bench defs only)

/**
 * Build the bench NodeDefs. main.js calls this once before module init and
 * adds the result to state.registry. It fetches the catalog only; each
 * library's WGSL loads on first use (def.pass.load / run / wgsl).
 * @returns {Promise<import('../contract.js').NodeDef[]>}
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
/** The bench NodeDef of a type, after loadBenchNodes. */
export const benchDef = type => DEFS.get(type) || null;

// ------------------------------------------------------------ values
/** Node params merged over the def defaults (arrays copied). */
export function withDefaults(def, values = {}) {
  const v = {};
  for (const p of def.params) v[p.id] = values[p.id] !== undefined ? values[p.id] : (Array.isArray(p.default) ? p.default.slice() : p.default);
  return v;
}
/** The bench node shape (lib/bench-wgsl.js NODE SHAPE) for a def and its values. */
function nodeOf(def, v) {
  const B = def.bench;
  if (B.gen) {
    const Gk = CAT.GENERIC[B.gen];
    const n = { kind: B.gen, op: v.op, k: Gk.defaults.map((d, i) => (v['k' + i] !== undefined ? +v['k' + i] : d)), xk: [] };
    n.code = (v.code && v.code.trim()) ? v.code : CAT.templateCode(n);
    return n;
  }
  const L = CAT.LIBS[B.lib]; const cell = L.cells.find(c => c.name === B.cell);
  const n = { kind: B.lib, fn: B.cell, k: (cell.defaults || [0.5, 0.5, 0.5, 0.5]).map((d, i) => (v['k' + i] !== undefined ? +v['k' + i] : d)),
    xk: L.extras.map((e, j) => (v['x' + j] !== undefined ? +v['x' + j] : e.d)) };
  if (L.orb) { n.state = Math.max(0, BENCH_STATES.indexOf(v.state)); n.stateAt = 0; }
  n.code = (!L.sim && v.code && v.code.trim()) ? v.code : CAT.templateCode(n);
  return n;
}
const paletteOf = v => ({ ink: hexToRgb(v.ink || BENCH_PALETTE.ink), tone: hexToRgb(v.tone || BENCH_PALETTE.tone), cream: hexToRgb(v.cream || BENCH_PALETTE.cream) });

// ------------------------------------------------------------ WGSL: cell module
// The bench reads its inputs with textureSampleLevel(in0|in1, smp, uv, lod).
// hookInputs routes those reads through bench_in0/bench_in1, which convert a
// studio uv coordinate into bench p space when b.pad > 0 (the coord scale).
const RE_IN = /textureSampleLevel\(\s*(in0|in1)\s*,\s*smp\s*,/g;
function hookInputs(code, inputs) {
  const hooked = code.replace(RE_IN, (m, which) => `bench_${which}(`);
  const fn = (which, i) => {
    const ty = inputs[i] ? inputs[i].type : 'img';
    const conv = ty === 'coord'
      ? `select(t, vec4f(((t.xy * 2.0) - vec2f(1.0)) * b.pad, t.z, t.w), b.pad > 0.0)`
      : 't';
    return `fn bench_${which}(uv: vec2f, lod: f32) -> vec4f { let t = textureSampleLevel(${which}, smp, uv, lod); return ${conv}; }\n`;
  };
  return hooked + '\n// ── studio input hooks (nodes/bench.js hookInputs)\n' + fn('in0', 0) + fn('in1', 1);
}
/** The complete WGSL module of a non-sim node, as the bench assembles it plus the input hooks. */
function cellSource(def, n) {
  return CAT.moduleFor(n, hookInputs(n.code, def.bench.inputs));
}

// ------------------------------------------------------------ WGSL: frame pass
// The frame pass maps the cell texture onto the studio tile. FrameU:
//   xf  = (1/zoom, cos rot, sin rot, 1/res)
//   off = (offset.x, offset.y, seam blend width, tile mode 0 none 1 seamless 2 mirror 3 repeat)
//   m   = (decode 0 raw 1 srgb, value 0 luma 1 alpha 2 red 3 max, matte 0 keep 1 ink, coord out 0 no 1 uv 2 raw)
//   ink = matte color
// FRAME_FNS needs a function bfr_src(q: vec2f) -> vec4f (the cell at cell uv q).
const FRAME_STRUCT = `struct BenchFrameU { xf: vec4f, off: vec4f, m: vec4f, ink: vec4f }\n`;
const FRAME_FNS = `
fn bfr_at(t: vec2f) -> vec4f {
    let c = t - vec2f(0.5);
    let r = vec2f((c.x * bfu.xf.y) + (c.y * bfu.xf.z), (c.y * bfu.xf.y) - (c.x * bfu.xf.z)) * bfu.xf.x;
    return bfr_src((r + vec2f(0.5)) - bfu.off.xy);
}
fn bfr_win(x: f32) -> f32 { return 1.0 - smoothstep(0.0, max(bfu.off.z, 0.0001), min(x, 1.0 - x)); }
fn bfr_row(t: vec2f) -> vec4f { return mix(bfr_at(t), bfr_at(vec2f(fract(t.x + 0.5), t.y)), bfr_win(t.x)); }
fn bfr_srgb(c: vec3f) -> vec3f {
    let lo = c / 12.92;
    let hi = pow((max(c, vec3f(0.0)) + vec3f(0.055)) / 1.055, vec3f(2.4));
    return select(hi, lo, c <= vec3f(0.04045));
}
fn bfr_finish(c: vec4f) -> vec4f {
    if (bfu.m.w > 0.5) {
        let q = select(c.xy, (c.xy * 0.5) + vec2f(0.5), bfu.m.w < 1.5);
        return vec4f(q, c.z, 1.0);
    }
    var rgb = c.rgb;
    if (bfu.m.z > 0.5) { rgb = rgb + (bfu.ink.rgb * (1.0 - clamp(c.a, 0.0, 1.0))); }
    let vm = i32(bfu.m.y + 0.5);
    var v = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
    if (vm == 1) { v = c.a; } else if (vm == 2) { v = rgb.r; } else if (vm == 3) { v = max(rgb.r, max(rgb.g, rgb.b)); }
    if (bfu.m.x > 0.5) { rgb = bfr_srgb(rgb); }
    return vec4f(rgb, v);
}
`;
// The tile body per mode. The runner branches on bfu.off.w at run time. The
// fallback emits one branch-free body (tiledStatic), because a cell that
// calls fwidth must stay in uniform control flow.
const TILE_BODY = [
  'return bfr_at(uv);',
  'let t = fract(uv); return mix(bfr_row(t), bfr_row(vec2f(t.x, fract(t.y + 0.5))), bfr_win(t.y));',
  'let t = vec2f(1.0) - abs((fract(uv) * 2.0) - vec2f(1.0)); return bfr_at(t);',
  'return bfr_at(fract(uv));',
];
const tiledStatic = mode => `fn bfr_tiled(uv: vec2f) -> vec4f { ${TILE_BODY[Math.max(0, TILE_MODES.indexOf(mode))]} }\n`;
const TILED_DYNAMIC = `
fn bfr_tiled(uv: vec2f) -> vec4f {
    let mode = i32(bfu.off.w + 0.5);
    if (mode == 1) { ${TILE_BODY[1]} }
    if (mode == 2) { ${TILE_BODY[2]} }
    if (mode == 3) { ${TILE_BODY[3]} }
    ${TILE_BODY[0]}
}
`;
const FRAME_WGSL = FRAME_STRUCT + `
@group(0) @binding(0) var<uniform> bfu: BenchFrameU;
@group(0) @binding(1) var bfr_tex: texture_2d<f32>;
@group(0) @binding(2) var bfr_smp: sampler;
fn bfr_src(q: vec2f) -> vec4f { return textureSampleLevel(bfr_tex, bfr_smp, q, 0.0); }
` + FRAME_FNS + TILED_DYNAMIC + `
@vertex fn vs_frame(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs_frame(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    return bfr_finish(bfr_tiled(fract(fp.xy * bfu.xf.w)));
}
`;
/** FrameU floats for a def and values at output size res. tiling repeats
 *  the cell across the output (xf.w = tiling / res, then fract in fs_frame). */
function frameUniform(def, v, res, tiling = 1) {
  const z = Math.max(+v.zoom || 1, 1e-3), a = (+v.rotate || 0) * Math.PI / 180, off = v.offset || [0, 0];
  const out = def.bench.out === 'coord';
  const ink = hexToRgb(v.ink || BENCH_PALETTE.ink);
  return new Float32Array([
    1 / z, Math.cos(a), Math.sin(a), tiling / res,
    +off[0] || 0, +off[1] || 0, Math.min(0.5, Math.max(0.0001, +v.edge || 0.18)), Math.max(0, TILE_MODES.indexOf(v.tile)),
    out ? 0 : (v.decode === 'srgb' ? 1 : 0), Math.max(0, VALUE_MODES.indexOf(v.value)), v.matte === 'keep' ? 0 : 1, out ? (v.outSpace === 'bench' ? 2 : 1) : 0,
    ink[0], ink[1], ink[2], 1,
  ]);
}

// ------------------------------------------------------------ WGSL: fallback
// The contract path: one pass_main(uv) that inlines the cell. The binding
// declarations of the bench go: the uniform u and the wiring flags b become
// var<private> structs that pass_main fills with literals; in0/in1 reads go
// to the compiler's texture bindings (ctx.tex) or to a black constant.
const lit = x => { x = +x; if (!Number.isFinite(x)) return '0.0'; const s = String(Math.fround(x)); return /[.eE]/.test(s) ? s : s + '.0'; };
/** Parse `struct Name { a: f32, b: vec2f, ... }` into [{name, type}] (comments removed). */
export function parseStruct(src, name) {
  const m = new RegExp(`struct\\s+${name}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) return null;
  return m[1].replace(/\/\/[^\n]*/g, '').split(/,(?![^<]*>)/).map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf(':'); return { name: s.slice(0, i).trim(), type: s.slice(i + 1).trim() };
  });
}
/** A WGSL constructor expression of struct `name` from the flat uniform floats d. */
export function uniformCtor(src, name, d, sizeExpr) {
  const fields = parseStruct(src, name); if (!fields) throw new Error('bench fallback: no struct ' + name);
  let off = 0; const args = [];
  for (const f of fields) {
    let al = 4, sz = 4, expr;
    const arr = /^array<\s*vec4f\s*,\s*(\d+)\s*>$/.exec(f.type);
    if (f.type === 'f32') { al = 4; sz = 4; }
    else if (f.type === 'vec2f') { al = 8; sz = 8; }
    else if (f.type === 'vec3f') { al = 16; sz = 12; }
    else if (f.type === 'vec4f') { al = 16; sz = 16; }
    else if (arr) { al = 16; sz = 16 * +arr[1]; }
    else throw new Error(`bench fallback: field ${f.name}: ${f.type} is not handled`);
    off = Math.ceil(off / al) * al; const i = off / 4;
    const at = j => lit(d[i + j] || 0);
    if (f.type === 'f32') expr = at(0);
    else if (f.type === 'vec2f') expr = f.name === 'size' && sizeExpr ? `vec2f(${sizeExpr}, ${sizeExpr})` : `vec2f(${at(0)}, ${at(1)})`;
    else if (f.type === 'vec3f') expr = `vec3f(${at(0)}, ${at(1)}, ${at(2)})`;
    else if (f.type === 'vec4f') expr = `vec4f(${at(0)}, ${at(1)}, ${at(2)}, ${at(3)})`;
    else { const n = +arr[1]; const items = []; for (let k = 0; k < n; k++) items.push(`vec4f(${lit(d[i + 4 * k] || 0)}, ${lit(d[i + 4 * k + 1] || 0)}, ${lit(d[i + 4 * k + 2] || 0)}, ${lit(d[i + 4 * k + 3] || 0)})`); expr = `array<vec4f, ${n}>(${items.join(', ')})`; }
    args.push(expr); off += sz;
  }
  return `${name}(${args.join(', ')})`;
}
const RE_UBIND = /@group\(0\)\s*@binding\(0\)\s*var<uniform>\s*u\s*:\s*(\w+)\s*;/;
const RE_FRAG = /@fragment\s+fn\s+(\w+)\s*\(\s*@builtin\(position\)\s*(\w+)\s*:\s*vec4f\s*\)\s*->\s*@location\(0\)\s*vec4f/g;

/**
 * The contract pass source (fn pass_main(uv) -> vec4f) for a bench node.
 * Throws for sim libraries (they need def.pass.run) and before the
 * library WGSL is loaded (call def.pass.load() first).
 */
export function fallbackWGSL(def, ctx) {
  if (!CAT) throw new Error('bench catalog is not loaded');
  const B = def.bench;
  if (B.sim) throw new Error(`${def.type}: simulation cells need pass.run (compute steps), not a fused pass`);
  if (B.lib && !CAT.LIBS[B.lib].loaded) throw new Error(`${def.type}: library ${B.lib} is not loaded yet (await def.pass.load())`);
  const v = withDefaults(def, ctx.values || {});
  const n = nodeOf(def, v);
  const resN = Number.isFinite(+ctx.res) ? +ctx.res : 1024;
  const resE = ctx.res != null ? `f32(${ctx.res})` : lit(resN);
  // the cell module without the vertex stage
  const L = B.lib ? CAT.LIBS[B.lib] : null;
  const ucode = L ? L.uniform : CAT.GEN_UNIFORM;
  const core = L ? (L.orb ? L.fams[CAT.cellOf(n).family].core : L.core) : '';
  let src = ucode + CAT.HEAD + core + '\n' + n.code;
  const um = RE_UBIND.exec(src); if (!um) throw new Error(`${def.type}: no uniform binding found`);
  const uName = um[1];
  src = src.replace(RE_UBIND, `var<private> u: ${uName};`);
  src = src.replace(/@group\(0\)\s*@binding\(1\)\s*var\s+in0\s*:\s*texture_2d<f32>\s*;/, '')
    .replace(/@group\(0\)\s*@binding\(2\)\s*var\s+smp\s*:\s*sampler\s*;/, '')
    .replace(/@group\(0\)\s*@binding\(3\)\s*var\s+in1\s*:\s*texture_2d<f32>\s*;/, '')
    .replace(/@group\(0\)\s*@binding\(4\)\s*var<uniform>\s*b\s*:\s*BenchB\s*;/, 'var<private> b: BenchB;');
  const entry = CAT.entryOf(n);
  src = src.replace(RE_FRAG, (m, name, arg) => `fn ${name}(${arg}: vec4f) -> vec4f`);
  src = src.replace(RE_IN, (m, which) => `bench_${which}(`);
  if (/@(fragment|vertex|compute|builtin|location|group|binding)\b/.test(src)) throw new Error(`${def.type}: the cell keeps a stage attribute the fallback cannot inline`);
  // input reads
  const linked = id => (ctx.linked && id in ctx.linked) ? !!ctx.linked[id] : !!(ctx.tex && ctx.tex[id]);
  const ins = B.inputs;
  const inFn = (which, i) => {
    const port = ins[i];
    if (!port || !linked(port.name) || !(ctx.tex && ctx.tex[port.name])) return `fn bench_${which}(uv: vec2f, lod: f32) -> vec4f { return vec4f(0.0, 0.0, 0.0, 0.0); }\n`;
    const t = `textureSampleLevel(${ctx.tex[port.name]}, ${ctx.samp}, uv, lod)`;
    const conv = port.type === 'coord' ? `select(t, vec4f(((t.xy * 2.0) - vec2f(1.0)) * b.pad, t.z, t.w), b.pad > 0.0)` : 't';
    return `fn bench_${which}(uv: vec2f, lod: f32) -> vec4f { let t = ${t}; return ${conv}; }\n`;
  };
  const d = new Float32Array(BENCH_UBYTES / 4);
  CAT.fillUniform(n, d, { T: +v.time || 0, TEX: resN, G: paletteOf(v) });
  const has = i => (ins[i] && linked(ins[i].name) ? 1 : 0);
  const viewMode = L ? L.view : CAT.GENERIC[B.gen].view;
  const pad = ins.some(p => p.type === 'coord') && v.coordSpace !== 'bench' ? (+v.coordScale || 1) : 0;
  const f = frameUniform(def, v, resN);
  const fv = i => `vec4f(${lit(f[i])}, ${lit(f[i + 1])}, ${lit(f[i + 2])}, ${lit(f[i + 3])})`;
  // addressing of the cell lookups: mirror-repeat, or repeat in repeat mode
  const addr = v.tile === 'repeat' ? 'fract(q)' : 'vec2f(1.0) - abs(vec2f(1.0) - (fract(q * 0.5) * 2.0))';
  return `// ═══ bench node ${def.type} (nodes/bench.js fallbackWGSL) ═══
${src}
${inFn('in0', 0)}${inFn('in1', 1)}
${FRAME_STRUCT}var<private> bfu: BenchFrameU;
fn bfr_src(q: vec2f) -> vec4f { let a = ${addr}; return ${entry}(vec4f(a * ${resE}, 0.0, 1.0)); }
${FRAME_FNS}${tiledStatic(v.tile)}
fn pass_main(uv: vec2f) -> vec4f {
    u = ${uniformCtor(src, uName, d, resE)};
    b = BenchB(${lit(has(0))}, ${lit(has(1))}, ${lit(viewMode)}, ${lit(pad)});
    bfu = BenchFrameU(${fv(0)}, ${fv(4)}, ${fv(8)}, ${fv(12)});
    return bfr_finish(bfr_tiled(uv));
}
`;
}

// ------------------------------------------------------------ GPU runner
const TEX_USE = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
const viewOf = t => (t && typeof t.createView === 'function' ? t.createView() : t);
const hash = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };

/**
 * One runner per GPUDevice: layouts, samplers, pipeline caches and a small
 * texture pool. Run calls are serialized on device.queue in submit order, so
 * the pooled intermediate textures are safe to reuse from node to node.
 */
class BenchRunner {
  constructor(device) {
    this.device = device; this.dead = false;
    const d = device;
    this.bgl = d.createBindGroupLayout({ label: 'bench cell', entries: BENCH_BGL_ENTRIES() });
    this.layout = d.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
    this.cbgl = d.createBindGroupLayout({ label: 'bench sim step', entries: BENCH_CBGL_ENTRIES() });
    this.clayout = d.createPipelineLayout({ bindGroupLayouts: [this.cbgl] });
    this.pbgl = d.createBindGroupLayout({ label: 'bench sim present', entries: BENCH_PBGL_ENTRIES() });
    this.playout = d.createPipelineLayout({ bindGroupLayouts: [this.pbgl] });
    const F = GPUShaderStage.FRAGMENT;
    this.fbgl = d.createBindGroupLayout({ label: 'bench frame', entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } }, { binding: 1, visibility: F, texture: {} }, { binding: 2, visibility: F, sampler: {} }] });
    this.flayout = d.createPipelineLayout({ bindGroupLayouts: [this.fbgl] });
    const S = (filter, mode) => d.createSampler({ magFilter: filter, minFilter: filter, addressModeU: mode, addressModeV: mode });
    // smp in the cell: mirror-repeat, as on the bench
    this.smpCell = S('linear', 'mirror-repeat');
    this.smp = { 'linear:mirror': this.smpCell, 'linear:repeat': S('linear', 'repeat'), 'nearest:mirror': S('nearest', 'mirror-repeat'), 'nearest:repeat': S('nearest', 'repeat') };
    this.dummy = d.createTexture({ label: 'bench dummy', size: [1, 1], format: 'rgba16float', usage: TEX_USE() });
    this.dummyView = this.dummy.createView();
    this.ubuf = d.createBuffer({ label: 'bench cell U', size: BENCH_UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bbuf = d.createBuffer({ label: 'bench BenchB', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.fbuf = d.createBuffer({ label: 'bench frame U', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.simU = Array.from({ length: 8 }, (_, i) => d.createBuffer({ label: 'bench sim U' + i, size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.simP = d.createBuffer({ label: 'bench sim present U', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.udata = new Float32Array(BENCH_UBYTES / 4);
    this.pipes = new Map();      // key -> Promise<pipeline | {compute, present}>
    this.pool = new Map();       // key -> GPUTexture
    this.stale = [];             // pooled textures to destroy when no run is busy
    this.busy = 0;               // run() calls in flight
    this.framePipe = null;
    this.stats = { runs: 0, compiles: 0, ms: 0 };
  }
  destroy() {
    this.dead = true;
    for (const t of this.pool.values()) try { t.destroy(); } catch (e) {}
    this.pool.clear(); this.pipes.clear();
    for (const b of [this.ubuf, this.bbuf, this.fbuf, this.simP, ...this.simU]) try { b.destroy(); } catch (e) {}
    try { this.dummy.destroy(); } catch (e) {}
  }
  /** Destroy the stale textures, but only when no run can still bind them. */
  flush() {
    if (this.busy) return;
    for (const t of this.stale.splice(0)) try { t.destroy(); } catch (e) {}
  }
  /** Release all pooled textures (after an export, or a res change). */
  trim() {
    for (const t of this.pool.values()) this.stale.push(t);
    this.pool.clear();
    this.flush();
  }
  tex(key, w, h, format = 'rgba16float', usage = TEX_USE()) {
    const k = `${key}:${w}x${h}:${format}`;
    // One texture per pool key: a new size makes the old size stale.
    for (const [pk, pt] of this.pool) if (pk !== k && pk.startsWith(key + ':')) { this.pool.delete(pk); this.stale.push(pt); }
    let t = this.pool.get(k);
    if (!t) { t = this.device.createTexture({ label: 'bench ' + k, size: [w, h], format, usage }); this.pool.set(k, t); }
    return t;
  }
  async module(code, label) {
    const m = this.device.createShaderModule({ label, code });
    const info = await m.getCompilationInfo();
    const e = info.messages.find(x => x.type === 'error');
    if (e) throw new Error(`${label}: WGSL line ${e.lineNum}: ${e.message.slice(0, 240)}`);
    return m;
  }
  frame() {
    if (!this.framePipe) this.framePipe = this.module(FRAME_WGSL, 'bench frame').then(m => this.device.createRenderPipelineAsync({
      label: 'bench frame', layout: this.flayout, vertex: { module: m, entryPoint: 'vs_frame' },
      fragment: { module: m, entryPoint: 'fs_frame', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } }));
    return this.framePipe;
  }
  /** Compile (once) the pipelines of a node. Sim nodes get {compute, present, N}. */
  pipeline(def, n, v) {
    const B = def.bench;
    const L = B.lib ? CAT.LIBS[B.lib] : null;
    if (L && L.sim) {
      const N = Math.max(8, +v.grid || 128);
      const key = `sim:${B.lib}:${B.cell}:${N}`;
      if (!this.pipes.has(key)) {
        const core = L.core.replace(/const N: i32 = \d+;/, `const N: i32 = ${N};`);
        const p = (async () => {
          const m = await this.module(core + '\n' + n.code, def.type);
          const pm = await this.module(core, def.type + ' present');
          const [compute, present] = await Promise.all([
            this.device.createComputePipelineAsync({ label: def.type, layout: this.clayout, compute: { module: m, entryPoint: CAT.entryOf(n) } }),
            this.device.createRenderPipelineAsync({ label: def.type + ' present', layout: this.playout, vertex: { module: pm, entryPoint: 'vs_main' },
              fragment: { module: pm, entryPoint: 'fs_present', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } }),
          ]);
          this.stats.compiles++;
          return { compute, present, N };
        })();
        p.catch(() => this.pipes.delete(key));
        this.pipes.set(key, p);
      }
      return this.pipes.get(key);
    }
    const code = cellSource(def, n);
    const key = `cell:${def.type}:${hash(code)}`;
    if (!this.pipes.has(key)) {
      const p = (async () => {
        const m = await this.module(code, def.type);
        const pipe = await this.device.createRenderPipelineAsync({ label: def.type, layout: this.layout, vertex: { module: m, entryPoint: 'vs_main' },
          fragment: { module: m, entryPoint: CAT.entryOf(n), targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
        this.stats.compiles++;
        return pipe;
      })();
      p.catch(() => this.pipes.delete(key));
      this.pipes.set(key, p);
    }
    return this.pipes.get(key);
  }
  /** Render one node into job.target. See PASS PROTOCOL in the header. */
  async run(def, job) {
    this.busy++;
    try { return await this.runInner(def, job); } finally { this.busy--; this.flush(); }
  }
  async runInner(def, job) {
    const t0 = performance.now();
    const d = this.device, B = def.bench;
    await catalog(); if (B.lib) await CAT.ensureLib(B.lib);
    const v = withDefaults(def, job.values || {});
    const n = nodeOf(def, v);
    const res = Math.max(1, job.res | 0 || 1024);
    const target = viewOf(job.target); if (!target) throw new Error(def.type + ': job.target is missing');
    const G = paletteOf(v);
    const L = B.lib ? CAT.LIBS[B.lib] : null;
    const pipe = await this.pipeline(def, n, v);
    if (this.dead) return { ms: 0 };
    let cellView, samplerKey;
    if (L && L.sim) {
      cellView = this.runSim(def, n, v, pipe, G, job);
      samplerKey = (v.filter === 'nearest' ? 'nearest' : 'linear') + ':' + (v.tile === 'repeat' ? 'repeat' : 'mirror');
    } else {
      const maxDim = d.limits.maxTextureDimension2D || 8192;
      const S = Math.min(maxDim, res * (v.quality === '2' ? 2 : 1));
      const cell = this.tex('cell', S, S);
      this.udata.fill(0);
      CAT.fillUniform(n, this.udata, { T: +v.time || 0, TEX: S, G });
      d.queue.writeBuffer(this.ubuf, 0, this.udata);
      const ins = B.inputs;
      const inView = i => { const p = ins[i]; const t = p && job.inputs ? job.inputs[p.name] : null; return t ? viewOf(t) : null; };
      const v0 = inView(0), v1 = inView(1);
      const pad = ins.some(p => p.type === 'coord') && v.coordSpace !== 'bench' ? (+v.coordScale || 1) : 0;
      const view = L ? L.view : CAT.GENERIC[B.gen].view;
      d.queue.writeBuffer(this.bbuf, 0, new Float32Array([v0 ? 1 : 0, v1 ? 1 : 0, view, pad]));
      const bind = d.createBindGroup({ layout: this.bgl, entries: [
        { binding: 0, resource: { buffer: this.ubuf } }, { binding: 1, resource: v0 || this.dummyView }, { binding: 2, resource: this.smpCell },
        { binding: 3, resource: v1 || this.dummyView }, { binding: 4, resource: { buffer: this.bbuf } }] });
      const enc = d.createCommandEncoder({ label: def.type });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: cell.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      d.queue.submit([enc.finish()]);
      cellView = cell.createView();
      samplerKey = 'linear:' + (v.tile === 'repeat' ? 'repeat' : 'mirror');
    }
    // frame pass
    const fp = await this.frame();
    // A generator (no linked input) repeats with the graph tiling. A cell that
    // reads an input keeps the texel uv, because its input is already tiled.
    const linked = Object.values(job.inputs || {}).some(Boolean);
    const tiling = linked ? 1 : Math.max(1, Math.round(+job.tiling || 1));
    d.queue.writeBuffer(this.fbuf, 0, frameUniform(def, v, res, tiling));
    const fbind = d.createBindGroup({ layout: this.fbgl, entries: [
      { binding: 0, resource: { buffer: this.fbuf } }, { binding: 1, resource: cellView }, { binding: 2, resource: this.smp[samplerKey] }] });
    const enc = d.createCommandEncoder({ label: def.type + ' frame' });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(fp); pass.setBindGroup(0, fbind); pass.draw(3); pass.end();
    d.queue.submit([enc.finish()]);
    const ms = performance.now() - t0;
    this.stats.runs++; this.stats.ms += ms;
    return { ms };
  }
  /** Step a simulation cell from reset, then present its state. Returns the present view (N x N). */
  runSim(def, n, v, pipe, G, job) {
    const d = this.device, c = CAT.cellOf(n), N = pipe.N;
    const state = [0, 1].map(i => this.tex('sim' + i, N, N, 'rgba32float', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING));
    const views = state.map(t => t.createView());
    const cb = [0, 1].map(i => this.simU.map(buf => d.createBindGroup({ layout: this.cbgl, entries: [
      { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: views[i] }, { binding: 2, resource: views[1 - i] }] })));
    const seed = ((+v.simSeed || 0) * 7.31 + (+job.seed || 0) * 13.7) % 100;
    const steps = Math.max(1, (+v.steps | 0) + 1);
    const dT = 1 / Math.max(1, (c.steps || 1) * 12);
    let cur = 0, T = Math.max(0, (+v.time || 0) - steps * dT);
    const sd = new Float32Array(24);
    const head = () => { sd.fill(0); sd[0] = N; sd[1] = N; sd[3] = 1; sd.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); sd.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); sd.set([G.cream[0], G.cream[1], G.cream[2], 1], 12); sd.set(n.k, 16); };
    for (let s0 = 0; s0 < steps; s0 += 8) {
      const enc = d.createCommandEncoder({ label: def.type + ' steps' });
      for (let r = 0; r < 8 && s0 + r < steps; r++) {
        const s = s0 + r; head(); sd[2] = T; sd[20] = s; sd[21] = seed; sd[22] = 1 / 60; sd[23] = s === 0 ? 1 : 0;
        d.queue.writeBuffer(this.simU[r], 0, sd);
        const p = enc.beginComputePass(); p.setPipeline(pipe.compute); p.setBindGroup(0, cb[cur][r]); p.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8)); p.end();
        cur = 1 - cur; T += dT;
      }
      d.queue.submit([enc.finish()]);
    }
    // present at grid size: the frame pass filters and tiles it
    head(); sd[2] = T; sd[20] = steps; sd[21] = seed; sd[22] = 0; sd[23] = c.mode || 0;
    d.queue.writeBuffer(this.simP, 0, sd);
    const out = this.tex('simOut', N, N);
    const pb = d.createBindGroup({ layout: this.pbgl, entries: [{ binding: 0, resource: { buffer: this.simP } }, { binding: 1, resource: views[cur] }] });
    const enc = d.createCommandEncoder({ label: def.type + ' present' });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipe.present); pass.setBindGroup(0, pb); pass.draw(3); pass.end();
    d.queue.submit([enc.finish()]);
    return out.createView();
  }
}
const runners = new WeakMap();
function runnerFor(device) {
  if (!device) throw new Error('bench pass: no GPUDevice');
  let r = runners.get(device);
  if (!r || r.dead) { r = new BenchRunner(device); runners.set(device, r); }
  return r;
}

/** Release the pooled cell textures of the runner of a device (bake.js calls
 *  it after an export bake at another res). */
export function trimBench(device) { const r = device && runners.get(device); if (r) r.trim(); }

// ------------------------------------------------------------ pass entry points
/** def.pass.run: render a bench node into job.target. Resolves {ms}. */
export async function runBenchPass(def, job) {
  await catalog();
  return runnerFor(job.device).run(def, job);
}
/** def.pass.prepare: load the library and compile the node's pipelines. */
export async function prepareBenchPass(def, device, values = {}) {
  await catalog(); if (def.bench.lib) await CAT.ensureLib(def.bench.lib);
  const v = withDefaults(def, values); const r = runnerFor(device);
  await Promise.all([r.pipeline(def, nodeOf(def, v), v), r.frame()]);
  return true;
}
/**
 * Render a bench node into a new texture (the caller owns and destroys it).
 * @param {string|object} typeOrDef  'bench.<lib>.<cell>' or a def
 * @returns {Promise<GPUTexture>}  rgba16float res x res (TEXTURE_BINDING | COPY_SRC | RENDER_ATTACHMENT)
 */
export async function renderBenchNode(device, typeOrDef, { values = {}, res = 512, inputs = {}, seed = 0 } = {}) {
  const def = typeof typeOrDef === 'string' ? benchDef(typeOrDef) : typeOrDef;
  if (!def) throw new Error('no bench node ' + typeOrDef);
  const target = device.createTexture({ label: def.type, size: [res, res], format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
  await runBenchPass(def, { device, target, res, values, inputs, seed });
  return target;
}

// ------------------------------------------------------------ graph import
/**
 * Convert a Composition Bench graph JSON (the bench "copy graph" format:
 * {nodes:[{id, kind, x, y, k, xk, fn, op, state, code?}], links:[{from, to, input}]},
 * optional palette {ink, tone, cream}) into a material graph (contract Graph).
 * Library nodes become bench.<lib>.<cell>, generic kinds bench.gen.<kind>,
 * and the bench output node becomes the Material Output. Image links use the
 * 'tex' output, coordinate links the 'uv' output. The node that fed the bench
 * output drives opts.wire (default ['baseColor']); pass for example
 * ['baseColor', 'height'] to also wire its value into height.
 * Needs loadBenchNodes() to have run (it does at boot).
 * @param {object|string} json
 * @param {{wire?:string[], idPrefix?:string, palette?:object, settings?:object}} [opts]
 * @returns {import('../contract.js').Graph}
 */
export function importBenchGraph(json, opts = {}) {
  if (!CAT) throw new Error('bench catalog is not loaded yet');
  const g = typeof json === 'string' ? JSON.parse(json) : json;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new Error('not a Composition Bench graph (needs nodes[] and links[])');
  const pre = opts.idPrefix || 'b';
  const palette = { ...BENCH_PALETTE, ...(g.palette || {}), ...(opts.palette || {}) };
  const out = { version: GRAPH_VERSION, nodes: [], links: [], frames: [], output: 'out', settings: { ...DEFAULT_SETTINGS, ...(opts.settings || {}) }, name: g.name || 'Composition Bench import' };
  const skipped = [];
  const map = new Map();   // bench id -> {id, def}
  let outNode = null;
  for (const bn of g.nodes) {
    if (bn.kind === 'output') { outNode = bn; continue; }
    let type;
    if (CAT.LIBS[bn.kind]) {
      const L = CAT.LIBS[bn.kind]; const fn = L.cells.some(c => c.name === bn.fn) ? bn.fn : L.cells[0].name;
      type = `bench.${bn.kind}.${fn}`;
    } else if (GEN_KINDS.includes(bn.kind)) type = `bench.gen.${bn.kind}`;
    const def = type && benchDef(type);
    if (!def) { skipped.push(bn.kind); continue; }
    const params = {};
    const k = Array.isArray(bn.k) ? bn.k : [];
    def.params.forEach(p => { if (/^k\d$/.test(p.id) && k[+p.id[1]] !== undefined) params[p.id] = +k[+p.id[1]]; });
    if (def.bench.lib) {
      const L = CAT.LIBS[def.bench.lib];
      if (Array.isArray(bn.xk) && bn.xk.length === L.extras.length) bn.xk.forEach((x, j) => { params['x' + j] = +x; });
      if (L.orb && bn.state != null) params.state = BENCH_STATES[bn.state | 0] || 'idle';
      params.ink = palette.ink; params.tone = palette.tone; params.cream = palette.cream;
    }
    if (def.bench.gen && bn.op && CAT.GENERIC[bn.kind].ops && bn.op in CAT.GENERIC[bn.kind].ops) params.op = bn.op;
    if (typeof bn.code === 'string' && bn.code.trim()) params.code = bn.code;
    const id = pre + bn.id;
    out.nodes.push({ id, type, x: +bn.x || 0, y: +bn.y || 0, params });
    map.set(bn.id, { id, def });
  }
  const ox = outNode ? +outNode.x || 0 : Math.max(0, ...out.nodes.map(n => n.x)) + 340;
  const oy = outNode ? +outNode.y || 0 : 0;
  out.nodes.push({ id: 'out', type: OUTPUT_TYPE, x: ox, y: oy, params: {} });
  const taken = new Set();
  for (const l of g.links) {
    const a = map.get(l.from);
    if (outNode && l.to === outNode.id) {
      if (!a) continue;
      const wires = opts.wire || ['baseColor'];
      for (const w of wires) {
        const fromPort = a.def.bench.out === 'coord' ? 'uv' : (w === 'baseColor' || w === 'emissive' ? 'color' : (w === 'normal' ? 'color' : 'value'));
        if (taken.has('out:' + w)) continue; taken.add('out:' + w);
        out.links.push({ from: [a.id, fromPort], to: ['out', w] });
      }
      continue;
    }
    const b = map.get(l.to); if (!a || !b) continue;
    const port = b.def.inputs.find(p => p.id === l.input); if (!port) continue;
    const key = b.id + ':' + port.id; if (taken.has(key)) continue; taken.add(key);
    out.links.push({ from: [a.id, a.def.bench.out === 'coord' ? 'uv' : 'tex'], to: [b.id, port.id] });
  }
  if (out.nodes.length > 1) {
    const xs = out.nodes.map(n => n.x), ys = out.nodes.map(n => n.y);
    const x0 = Math.min(...xs) - 40, y0 = Math.min(...ys) - 60;
    out.frames.push({ id: 'f_bench', label: 'Composition Bench import', x: x0, y: y0, w: Math.max(...xs) - x0 + 300, h: Math.max(...ys) - y0 + 360, color: '#5a8cc0' });
  }
  const check = validateGraph(out);
  if (!check.ok) throw new Error('bench import produced a bad graph: ' + check.errors.join('; '));
  out.importNotes = { skipped, nodes: out.nodes.length - 1, links: out.links.length };
  return out;
}

// ------------------------------------------------------------ graph export
/**
 * Convert the bench nodes of a material graph into a Composition Bench graph
 * JSON. Links between bench nodes are kept. The bench output takes the node
 * that feeds Material Output baseColor (else emissive, else the last bench
 * node). Studio-only nodes are left out (the bench cannot run them).
 * @param {import('../contract.js').Graph} graph
 * @returns {{nodes:object[], links:object[], palette:object, name:string, dropped:number}}
 */
export function exportBenchGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error('no graph');
  const ids = new Map(); const nodes = []; let next = 1; let dropped = 0; let palette = null;
  for (const gn of graph.nodes) {
    const def = benchDef(gn.type);
    if (!def) { if (gn.type !== OUTPUT_TYPE) dropped++; continue; }
    const v = withDefaults(def, gn.params || {});
    const id = next++; ids.set(gn.id, id);
    const B = def.bench; const bn = { id, kind: B.lib || B.gen, x: gn.x, y: gn.y };
    if (B.lib) {
      const L = CAT.LIBS[B.lib]; const cell = L.cells.find(c => c.name === B.cell);
      bn.fn = B.cell; bn.k = (cell.defaults || [0.5, 0.5, 0.5, 0.5]).map((dv, i) => (v['k' + i] !== undefined ? +v['k' + i] : dv));
      bn.xk = L.extras.map((e, j) => +v['x' + j]);
      if (L.orb) bn.state = Math.max(0, BENCH_STATES.indexOf(v.state));
      if (!palette) palette = { ink: v.ink, tone: v.tone, cream: v.cream };
    } else {
      const Gk = CAT.GENERIC[B.gen]; bn.op = v.op; bn.k = Gk.defaults.map((dv, i) => (v['k' + i] !== undefined ? +v['k' + i] : dv)); bn.xk = [];
    }
    if (v.code && String(v.code).trim()) bn.code = v.code;
    nodes.push(bn);
  }
  const links = [];
  for (const l of graph.links || []) {
    const a = ids.get(l.from[0]), b = ids.get(l.to[0]); if (!a || !b) continue;
    links.push({ from: a, to: b, input: l.to[1] });
  }
  const feed = ['baseColor', 'emissive'].map(w => (graph.links || []).find(l => l.to[0] === graph.output && l.to[1] === w && ids.has(l.from[0]))).find(Boolean);
  const src = feed ? ids.get(feed.from[0]) : (nodes.length ? nodes[nodes.length - 1].id : null);
  if (src) {
    const sx = nodes.find(n => n.id === src);
    const oid = next++; nodes.push({ id: oid, kind: 'output', x: Math.max(...nodes.map(n => n.x)) + 340, y: sx.y, k: [0.5, 0.5, 0.5, 0.5], xk: [] });
    links.push({ from: src, to: oid, input: 'img' });
  }
  return { nodes, links, palette: palette || { ...BENCH_PALETTE }, name: graph.name || 'Material Studio export', dropped };
}

/**
 * Hand a material graph to the Composition Bench page: the bench JSON goes
 * to localStorage (BENCH_HANDOFF_KEY) and the bench opens with #import in a
 * new tab, where it loads the graph once and clears the key.
 * @returns {{url:string, json:object}}
 */
export function openInBench(graph, opts = {}) {
  const json = exportBenchGraph(graph);
  if (!json.nodes.length) throw new Error('the graph has no Composition Bench nodes');
  try { localStorage.setItem(BENCH_HANDOFF_KEY, JSON.stringify(json)); } catch (e) { throw new Error('localStorage is blocked, so the graph cannot be handed to the bench'); }
  const url = BENCH_PAGE.href + '#import';
  if (opts.open !== false && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  return { url, json };
}

// ------------------------------------------------------------ self test
// Decode rgba16float texels to numbers (no Float16Array dependency).
function f16(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
/** Read back an rgba16float texture: per-channel mean, NaN/Inf count, min/max. */
async function readStats(device, tex, res) {
  const bpr = Math.ceil(res * 8 / 256) * 256;
  const buf = device.createBuffer({ size: bpr * res, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [res, res]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const u16 = new Uint16Array(buf.getMappedRange());
  const sum = [0, 0, 0, 0]; let bad = 0, lo = Infinity, hi = -Infinity;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) for (let c = 0; c < 4; c++) {
    const val = f16(u16[(y * bpr) / 2 + x * 4 + c]);
    if (!Number.isFinite(val)) { bad++; continue; }
    sum[c] += val; if (c < 3) { lo = Math.min(lo, val); hi = Math.max(hi, val); }
  }
  buf.unmap(); buf.destroy();
  const n = res * res;
  return { mean: sum.map(s => +(s / n).toFixed(4)), bad, min: +lo.toFixed(3), max: +hi.toFixed(3) };
}
// A minimal contract host for the fallback: the shape a compiler wraps pass_main in.
function fallbackHost(src, res) {
  return `@group(0) @binding(0) var t_in0: texture_2d<f32>;
@group(0) @binding(1) var t_in1: texture_2d<f32>;
@group(0) @binding(2) var s_rep: sampler;
${src}
@vertex fn host_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
}
@fragment fn host_fs(@builtin(position) fp: vec4f) -> @location(0) vec4f { return pass_main(fp.xy / ${lit(res)}); }
`;
}
async function runFallback(device, def, res, values, inputs) {
  const tex = {}, linked = {};
  def.bench.inputs.forEach((p, i) => { if (inputs[p.name]) { tex[p.name] = i ? 't_in1' : 't_in0'; linked[p.name] = true; } });
  const src = fallbackWGSL(def, { values, res: String(res), tex, samp: 's_rep', linked, inputs: {}, params: {}, sample: {}, seed: '0.0', uid: 'n0' });
  const r = runnerFor(device);
  const m = await r.module(fallbackHost(src, res), def.type + ' fallback');
  const F = GPUShaderStage.FRAGMENT;
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F, texture: {} }, { binding: 1, visibility: F, texture: {} }, { binding: 2, visibility: F, sampler: {} }] });
  const pipe = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), vertex: { module: m, entryPoint: 'host_vs' },
    fragment: { module: m, entryPoint: 'host_fs', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
  const out = device.createTexture({ size: [res, res], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
  const iv = i => { const p = def.bench.inputs[i]; const t = p && inputs[p.name]; return t ? viewOf(t) : r.dummyView; };
  const bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: iv(0) }, { binding: 1, resource: iv(1) }, { binding: 2, resource: r.smp['linear:repeat'] }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
  device.queue.submit([enc.finish()]);
  return out;
}

// One representative cell per library: a source cell, or for an operator
// library a cell fed by a noise source.
const PICK = { noise: 'fbm', field: 'vortex', postfx: 'gaussian', color: 'magma', heat_haze: 'rising_haze', refraction: null, sampling: 'poisson_disc', sim: 'life', heat_metal: 'orbit' };

/**
 * Instantiate one cell of every library (and every generic kind) as a studio
 * node, run it through pass.run at `res`, and (for non-sim nodes) through the
 * contract fallback in a minimal host; compare the two means.
 * @param {{device?:GPUDevice, res?:number, libs?:string[]}} [opts]
 */
export async function selfTest(opts = {}) {
  const device = opts.device || (typeof window !== 'undefined' && window.__studio && window.__studio.gpu && window.__studio.gpu.device);
  if (!device) return { ok: false, error: 'no GPUDevice' };
  await catalog(); if (!DEFS.size) await loadBenchNodes();
  const res = opts.res || 128;
  const src = await renderBenchNode(device, 'bench.noise.fbm', { res });
  const coordSrc = await renderBenchNode(device, 'bench.field.vortex', { res });
  const rows = []; let fails = 0;
  const libs = opts.libs || Object.keys(CAT.LIBS);
  const targets = libs.map(key => {
    const L = CAT.LIBS[key]; const name = PICK[key] && L.cells.some(c => c.name === PICK[key]) ? PICK[key] : L.cells[0].name; return `bench.${key}.${name}`;
  });
  if (!opts.libs) for (const k of GEN_KINDS) targets.push('bench.gen.' + k);
  for (const type of targets) {
    const def = benchDef(type); const row = { type };
    const inputs = {};
    for (const p of def.bench.inputs) inputs[p.name] = p.type === 'coord' ? coordSrc : src;
    device.pushErrorScope('validation');
    try {
      const t = await renderBenchNode(device, def, { res, inputs, values: def.bench.sim ? { steps: 60 } : {} });
      row.run = await readStats(device, t, res); t.destroy();
      if (!def.bench.sim) {
        const fb = await runFallback(device, def, res, {}, inputs);
        row.fallback = await readStats(device, fb, res); fb.destroy();
        row.meanDiff = +Math.max(...row.run.mean.map((m, i) => Math.abs(m - row.fallback.mean[i]))).toFixed(4);
      }
    } catch (e) { row.error = String(e.message || e).slice(0, 300); }
    const ve = await device.popErrorScope(); if (ve) row.validation = ve.message.slice(0, 300);
    if (row.error || row.validation || (row.run && row.run.bad) || (row.fallback && row.fallback.bad)) { row.fail = true; fails++; }
    rows.push(row);
  }
  src.destroy(); coordSrc.destroy();
  return { ok: fails === 0, defs: DEFS.size, libs: Object.keys(CAT.LIBS).length, cells: CAT.cellCount(), tested: rows.length, fails, rows };
}

/** Run every cell of the given libraries (default all) through pass.run at res. */
export async function selfTestAll(opts = {}) {
  const device = opts.device || window.__studio.gpu.device;
  await catalog(); if (!DEFS.size) await loadBenchNodes();
  const res = opts.res || 64; const libs = opts.libs || Object.keys(CAT.LIBS);
  const src = await renderBenchNode(device, 'bench.noise.fbm', { res });
  const out = {}; let pass = 0, fail = 0; const t0 = performance.now();
  for (const key of libs) {
    const L = await CAT.ensureLib(key); const r = { pass: 0, fail: [] };
    for (const c of L.cells) {
      const def = benchDef(`bench.${key}.${c.name}`);
      const inputs = {}; for (const p of def.bench.inputs) if (p.type === 'img') inputs[p.name] = src;
      device.pushErrorScope('validation');
      let err = null;
      try {
        const t = await renderBenchNode(device, def, { res, inputs, values: L.sim ? { steps: 16 } : {} });
        if (opts.fallback && !L.sim) { const fb = await runFallback(device, def, res, {}, inputs); fb.destroy(); }
        t.destroy();
      } catch (e) { err = String(e.message || e).slice(0, 200); }
      const ve = await device.popErrorScope(); if (ve) err = (err ? err + ' | ' : '') + ve.message.slice(0, 200);
      if (err) { r.fail.push({ cell: c.name, err }); fail++; } else { r.pass++; pass++; }
    }
    out[key] = r;
  }
  src.destroy();
  return { pass, fail, s: +((performance.now() - t0) / 1000).toFixed(1), libs: out };
}

// ------------------------------------------------------------ init
/** @param {object} ctx main.js module context */
export async function init(ctx) {
  const { store, gpu } = ctx;
  await catalog();
  if (gpu && gpu.onTeardown) gpu.onTeardown(() => { const r = gpu.device && runners.get(gpu.device); if (r) r.destroy(); });
  /** Install a graph (contract JSON) as the live graph, with undo. */
  const install = (graph, label) => {
    const G = ctx.modules.graph;
    store.state.graph = G && typeof G.deserialize === 'function' ? G.deserialize(graph) : graph;
    store.emit('graph:changed', { reason: 'load' });
    store.checkpoint(label);
  };
  const api = {
    catalog: () => CAT, defs: () => [...DEFS.values()], def: benchDef,
    LIB_TRAITS, BENCH_NON_TILEABLE, BENCH_NON_TILEABLE_CELLS, BENCH_PERIODIC,
    run: (type, job) => runBenchPass(typeof type === 'string' ? benchDef(type) : type, job),
    render: (type, opts) => renderBenchNode(gpu.device, type, opts),
    prepare: (type, values) => prepareBenchPass(benchDef(type), gpu.device, values),
    fallbackWGSL: (type, passCtx) => fallbackWGSL(benchDef(type), passCtx),
    importBenchGraph, exportBenchGraph, openInBench: (graph, opts) => openInBench(graph || store.state.graph, opts),
    /** Parse bench graph JSON text and load it as the live graph. */
    loadBenchGraph(text, opts) {
      const g = importBenchGraph(text, opts);
      const C = CAT; const libs = [...new Set(g.nodes.map(n => benchDef(n.type)).filter(Boolean).map(d => d.bench.lib).filter(Boolean))];
      return Promise.all(libs.map(k => C.ensureLib(k))).then(() => {
        install(g, 'Import bench graph');
        store.toast(`Imported ${g.importNotes.nodes} bench nodes${g.importNotes.skipped.length ? `, skipped ${g.importNotes.skipped.length}` : ''}`, 'ok');
        return g;
      });
    },
    /** Release the pooled cell textures (bake.js calls it after an export bake). */
    trim: () => trimBench(gpu.device),
    stats: () => { const r = gpu.device && runners.get(gpu.device); return r ? { ...r.stats, pipelines: r.pipes.size, pooled: r.pool.size } : null; },
    selfTest: o => selfTest({ device: gpu.device, ...(o || {}) }),
    selfTestAll: o => selfTestAll({ device: gpu.device, ...(o || {}) }),
  };
  ctx.register('bench', api);
}
