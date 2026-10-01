// ============================================================================
//  MATERIAL STUDIO  ·  contract.js — the shared types and constants
// ────────────────────────────────────────────────────────────────────────────
//  Every module codes against this file. It holds no state and no DOM code.
//  Do not redefine these names in other modules: import them from here.
//  To change the contract, change it here first, then the modules that use it.
//
//  CONTENTS  (grep -n the name to jump)
//      PORT_TYPES / WGSL_TYPE ...... socket types and their WGSL types
//      canConnect / convertExpr .... implicit conversion between socket types
//      PARAM_KINDS ................. inspector widget kinds for node params
//      NodeDef / ExprCtx / PassCtx . JSDoc typedefs for node definitions
//      Graph / GraphNode / Link .... JSDoc typedefs for the graph JSON
//      GRAPH_VERSION / emptyGraph .. graph JSON version and a blank graph
//      validateGraph ............... shape check for imported graph JSON
//      OUTPUT_TYPE / MATERIAL_INPUTS the Material Output node sockets
//      MAP_FORMAT / MAP_SLOTS ...... baked map textures and their channels
//      MaterialMaps / Scalars ...... the bake result typedefs
//      DEFAULT_SCALARS ............. scalar defaults
//      RES_OPTIONS / DEFAULT_SETTINGS  bake resolution, tiling, seed
//      EVENTS ...................... store event names and their payloads
//      MESHES / DEBUG_VIEWS / TONEMAPPERS  viewport choices
//      EXPORT_TARGETS .............. engine export targets
//      NODE_CATEGORIES ............. library categories in display order
//
//  CONVENTIONS
//      Node type ids are "<category>.<name>", for example "noise.perlin".
//      Composition Bench cells are "bench.<lib>.<cell>".
//      Texture space: uv in [0,1)^2, origin top-left, +v goes down the image.
//      Normals: tangent space, OpenGL convention (+Y up), stored n*0.5+0.5.
//      Colors in the graph are linear RGB. Color params store sRGB hex strings;
//      the compiler converts them to linear.
// ============================================================================

/** Socket types. 'normal' is a vec3 in tangent space (-1..1, OpenGL +Y).
 *  'texture' is a whole rgba image; only a pass node consumes it as a texture. */
export const PORT_TYPES = Object.freeze(['float', 'color', 'vec2', 'vec3', 'normal', 'texture']);

/** WGSL value type for each socket type. A 'texture' value in a fused
 *  expression is the sampled texel, a vec4f. */
export const WGSL_TYPE = Object.freeze({
  float: 'f32', color: 'vec3f', vec2: 'vec2f', vec3: 'vec3f', normal: 'vec3f', texture: 'vec4f',
});

/** Socket colors for the graph editor (CSS colors). */
export const PORT_COLORS = Object.freeze({
  float: '#a0a8b8', color: '#ffc832', vec2: '#7ad0c0', vec3: '#96c8ff', normal: '#b090ff', texture: '#ff8a5c',
});

/** Default value of an unconnected input with no explicit default. */
export const PORT_DEFAULTS = Object.freeze({
  float: 0, color: [0.5, 0.5, 0.5], vec2: [0, 0], vec3: [0, 0, 0], normal: [0, 0, 1], texture: [0, 0, 0, 1],
});

/**
 * True when a link from a socket of type `from` into a socket of type `to`
 * is legal. Every pair converts (see convertExpr) except: nothing converts
 * into 'normal' except 'normal', 'vec3' and 'color' (a color wired into a
 * normal socket is decoded from 0..1, so a normal-map image works).
 * @param {string} from @param {string} to @returns {boolean}
 */
export function canConnect(from, to) {
  if (!PORT_TYPES.includes(from) || !PORT_TYPES.includes(to)) return false;
  if (to === 'normal') return from === 'normal' || from === 'vec3' || from === 'color' || from === 'texture';
  return true;
}

/**
 * Wrap a WGSL expression of socket type `from` so that it has socket type `to`.
 *   float -> vec*      splat
 *   color/vec3 -> float  luminance (Rec.709 weights)
 *   vec2 -> float      .x            vec2 -> vec3   (x, y, 0)
 *   vec3 -> vec2       .xy           texture -> *   from .rgb / .r / .rg
 *   color -> normal    decode 0..1 to -1..1, then normalize
 *   normal -> color    encode -1..1 to 0..1
 * @param {string} expr WGSL expression
 * @param {string} from socket type of expr
 * @param {string} to wanted socket type
 * @returns {string} WGSL expression of WGSL_TYPE[to]
 */
export function convertExpr(expr, from, to) {
  if (from === to) return expr;
  const e = `(${expr})`;
  const lum = v => `dot(${v}, vec3f(0.2126, 0.7152, 0.0722))`;
  if (from === 'texture') {
    if (to === 'float') return `${e}.r`;
    if (to === 'vec2') return `${e}.rg`;
    if (to === 'normal') return `normalize((${e}.rgb * 2.0) - vec3f(1.0))`;
    return `${e}.rgb`;
  }
  if (to === 'texture') {
    if (from === 'float') return `vec4f(vec3f${e}, 1.0)`;
    if (from === 'vec2') return `vec4f(${e}, 0.0, 1.0)`;
    if (from === 'normal') return `vec4f((${e} * 0.5) + vec3f(0.5), 1.0)`;
    return `vec4f(${e}, 1.0)`;
  }
  if (from === 'float') {
    if (to === 'vec2') return `vec2f${e}`;
    return `vec3f${e}`;
  }
  if (from === 'vec2') {
    if (to === 'float') return `${e}.x`;
    return `vec3f(${e}, 0.0)`;
  }
  // from is color, vec3 or normal
  if (to === 'float') return lum(e);
  if (to === 'vec2') return `${e}.xy`;
  if (to === 'normal') return from === 'color' ? `normalize((${e} * 2.0) - vec3f(1.0))` : `normalize(${e})`;
  if (from === 'normal' && to === 'color') return `((${e} * 0.5) + vec3f(0.5))`;
  return expr; // color <-> vec3, normal -> vec3
}

/** Inspector widget kinds for node params.
 *  slider:float  int:integer  color:'#rrggbb' sRGB  enum:option value  bool
 *  vec2:[x,y]  gradient:[{t,color}] sorted by t  curve:[[x,y]] control points
 *  image:{name,url|bitmap} (pass nodes only)  text:string (for example WGSL). */
export const PARAM_KINDS = Object.freeze(['slider', 'int', 'color', 'enum', 'bool', 'vec2', 'gradient', 'curve', 'image', 'text']);

/**
 * @typedef {Object} PortDef
 * @property {string} id      unique inside its node side (inputs or outputs)
 * @property {string} label
 * @property {string} type    one of PORT_TYPES
 * @property {*} [default]    value when unconnected (inputs only): number or array
 * @property {string} [swizzle] pass nodes only: channels of the pass texture this
 *                            output reads, for example 'rgb', 'r', 'a', 'xy'.
 *                            Default: 'r' for float, 'rg' for vec2, 'rgb' otherwise.
 */

/**
 * @typedef {Object} ParamDef
 * @property {string} id
 * @property {string} label
 * @property {string} kind    one of PARAM_KINDS
 * @property {number} [min] @property {number} [max] @property {number} [step]
 * @property {*} default
 * @property {Array<{value:string,label:string}>|string[]} [options]  enum only
 * @property {boolean} [uniform]  slider/int/color/vec2/bool: true (default) makes
 *                            the compiler feed it through a uniform, so an edit
 *                            re-bakes without a pipeline rebuild. false bakes
 *                            the value into the WGSL source as a literal.
 */

/**
 * Context passed to NodeDef.expr. Every string is a WGSL expression that is
 * valid inside the fused per-texel function.
 * @typedef {Object} ExprCtx
 * @property {Object<string,string>} inputs  inputId -> expr, already converted
 *                     to the input's WGSL_TYPE (a constant when unconnected)
 * @property {Object<string,string>} params  paramId -> expr (uniform read or
 *                     literal). gradient/curve params give the name of a
 *                     generated WGSL function: call it as `${params.g}(t)`.
 *                     enum/text params give the raw JS value (a string).
 * @property {Object<string,*>} values  paramId -> the raw JS param value
 * @property {string} uv    vec2f expr: the texel uv, with graph tiling applied
 * @property {string} seed  f32 expr: graph seed plus a per-node offset
 * @property {string} res   f32 expr: bake resolution in texels
 * @property {string} uid   unique identifier prefix for this node instance
 *                          (use it to name let-bindings: `${uid}_t`)
 * @property {(wgsl:string)=>void} let  emit a statement before the outputs,
 *                          for example ctx.let(`let ${uid}_t = ...;`)
 */

/**
 * Context passed to NodeDef.pass.wgsl. The returned source must define
 *   fn pass_main(uv: vec2f) -> vec4f
 * The compiler wraps it in a full-screen render pass that writes one
 * rgba16float texture at bake resolution.
 * @typedef {Object} PassCtx
 * @property {Object<string,string>} tex    inputId -> texture_2d<f32> binding name
 * @property {Object<string,(uv:string)=>string>} sample  inputId -> function
 *                     that returns a WGSL expr which samples that input (with
 *                     repeat addressing) converted to the input's WGSL_TYPE
 * @property {string} samp  name of the filtering repeat sampler
 * @property {Object<string,string>} params  as ExprCtx.params
 * @property {Object<string,*>} values  as ExprCtx.values
 * @property {string} seed @property {string} res  as ExprCtx
 * @property {string} uid
 */

/**
 * One node kind. A node has exactly one of `expr` (fusable per-texel math)
 * or `pass` (a boundary node: its own render pass writes a texture; use it
 * for blur, height to normal, AO from height, warps, images, bench cells).
 * @typedef {Object} NodeDef
 * @property {string} type       "<category>.<name>", unique in the registry
 * @property {string} label
 * @property {string} category   one of NODE_CATEGORIES (free text is shown last)
 * @property {PortDef[]} inputs
 * @property {PortDef[]} outputs
 * @property {ParamDef[]} params
 * @property {(ctx:ExprCtx)=>Object<string,string>} [expr]  outputId -> WGSL expr
 * @property {string} [functions] WGSL helper source, emitted once per node type
 * @property {{wgsl:(ctx:PassCtx)=>string, inputsAsTextures:true, size?:number}} [pass]
 * @property {string} doc        one-line help
 * @property {string[]} [tags]   extra search words
 * @property {string} [source]   'core' | 'bench' | 'custom'
 */

/**
 * @typedef {Object} GraphNode
 * @property {string} id   unique in the graph, for example "n12"
 * @property {string} type a registry key
 * @property {number} x @property {number} y  canvas position, graph units
 * @property {Object<string,*>} params  paramId -> value (missing -> default)
 * @property {boolean} [collapsed]
 * @property {string} [label]  user rename
 */
/** @typedef {{from:[string,string], to:[string,string]}} Link  [nodeId, portId] */
/** @typedef {{id:string, label:string, x:number, y:number, w:number, h:number, color?:string}} Frame */
/**
 * @typedef {Object} Graph
 * @property {1} version
 * @property {GraphNode[]} nodes
 * @property {Link[]} links   an input takes at most one link
 * @property {Frame[]} frames
 * @property {string} output  id of the Material Output node
 * @property {{res:number, tiling:number, seed:number}} settings
 * @property {string} [name]
 */

export const GRAPH_VERSION = 1;

/** Type id of the Material Output node. Exactly one per graph. */
export const OUTPUT_TYPE = 'output.material';

/** Inputs of the Material Output node, in inspector order.
 *  `map` names the MaterialMaps slot and channel each input bakes into. */
export const MATERIAL_INPUTS = Object.freeze([
  { id: 'baseColor',          label: 'Base Color',          type: 'color',  default: [0.8, 0.8, 0.8], map: 'albedo.rgb' },
  { id: 'opacity',            label: 'Opacity',             type: 'float',  default: 1,   map: 'albedo.a' },
  { id: 'normal',             label: 'Normal',              type: 'normal', default: [0, 0, 1], map: 'normal.rgb' },
  { id: 'ao',                 label: 'Ambient Occlusion',   type: 'float',  default: 1,   map: 'orm.r' },
  { id: 'roughness',          label: 'Roughness',           type: 'float',  default: 0.5, map: 'orm.g' },
  { id: 'metallic',           label: 'Metallic',            type: 'float',  default: 0,   map: 'orm.b' },
  { id: 'height',             label: 'Height',              type: 'float',  default: 0.5, map: 'height.r' },
  { id: 'emissive',           label: 'Emissive',            type: 'color',  default: [0, 0, 0], map: 'emissive.rgb' },
  { id: 'clearcoat',          label: 'Clearcoat',           type: 'float',  default: 0,   map: 'extra.r' },
  { id: 'clearcoatRoughness', label: 'Clearcoat Roughness', type: 'float',  default: 0.1, map: 'extra.g' },
  { id: 'sheen',              label: 'Sheen',               type: 'float',  default: 0,   map: 'extra.b' },
  { id: 'anisotropy',         label: 'Anisotropy',          type: 'float',  default: 0,   map: 'extra.a' },
]);

/** Params of the Material Output node: the material scalars (see Scalars). */
export const MATERIAL_PARAMS = Object.freeze([
  { id: 'ior',               label: 'IOR',                kind: 'slider', min: 1, max: 3, step: 0.01, default: 1.5 },
  { id: 'transmission',      label: 'Transmission',       kind: 'slider', min: 0, max: 1, step: 0.01, default: 0 },
  { id: 'displacementScale', label: 'Displacement Scale', kind: 'slider', min: 0, max: 0.5, step: 0.001, default: 0.05 },
  { id: 'emissiveStrength',  label: 'Emissive Strength',  kind: 'slider', min: 0, max: 50, step: 0.1, default: 1 },
  { id: 'alphaMode',         label: 'Alpha Mode',         kind: 'enum', options: ['opaque', 'mask', 'blend'], default: 'opaque' },
  { id: 'alphaCutoff',       label: 'Alpha Cutoff',       kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 },
  { id: 'doubleSided',       label: 'Double Sided',       kind: 'bool', default: false },
]);

/** Texture format of every baked map. */
export const MAP_FORMAT = 'rgba16float';

/** Baked map slots and what each channel holds. */
export const MAP_SLOTS = Object.freeze({
  albedo:   { label: 'Base Color', channels: ['r', 'g', 'b', 'opacity'], srgbOnExport: true },
  normal:   { label: 'Normal',     channels: ['x', 'y', 'z', '1'], encoded: 'n*0.5+0.5, OpenGL +Y' },
  orm:      { label: 'ORM',        channels: ['ao', 'roughness', 'metallic', '1'] },
  height:   { label: 'Height',     channels: ['height', '-', '-', '1'] },
  emissive: { label: 'Emissive',   channels: ['r', 'g', 'b', '1'], srgbOnExport: true },
  extra:    { label: 'Extra',      channels: ['clearcoat', 'clearcoatRoughness', 'sheen', 'anisotropy'] },
});
export const MAP_NAMES = Object.freeze(Object.keys(MAP_SLOTS));

/**
 * The bake result. Every texture is MAP_FORMAT, res x res, with usage
 * TEXTURE_BINDING | COPY_SRC | RENDER_ATTACHMENT. Linear values, not sRGB.
 * The bake module owns the textures: a consumer must not destroy them, and
 * must not keep them past the next 'bake:done' (the bake module may reuse or
 * destroy the previous set).
 * @typedef {Object} MaterialMaps
 * @property {GPUTexture} albedo   rgb base color, a opacity
 * @property {GPUTexture} normal   encoded tangent normal, OpenGL convention
 * @property {GPUTexture} orm      ao, roughness, metallic, 1
 * @property {GPUTexture} height   r = height 0..1 (0.5 = no displacement)
 * @property {GPUTexture} emissive rgb emissive color (multiply by emissiveStrength)
 * @property {GPUTexture} extra    clearcoat, clearcoatRoughness, sheen, anisotropy
 * @property {number} res
 * @property {Scalars} scalars
 * @property {number} [ms]         bake time in milliseconds
 */

/**
 * @typedef {Object} Scalars
 * @property {number} ior @property {number} transmission
 * @property {number} displacementScale  object-space units at height 1
 * @property {number} emissiveStrength
 * @property {'opaque'|'mask'|'blend'} alphaMode
 * @property {number} alphaCutoff @property {boolean} doubleSided
 */
export const DEFAULT_SCALARS = Object.freeze({
  ior: 1.5, transmission: 0, displacementScale: 0.05, emissiveStrength: 1,
  alphaMode: 'opaque', alphaCutoff: 0.5, doubleSided: false,
});

export const RES_OPTIONS = Object.freeze([256, 512, 1024, 2048, 4096]);
export const DEFAULT_SETTINGS = Object.freeze({ res: 1024, tiling: 1, seed: 0 });

/** A graph with only a Material Output node. */
export function emptyGraph() {
  return {
    version: GRAPH_VERSION,
    nodes: [{ id: 'out', type: OUTPUT_TYPE, x: 600, y: 120, params: {} }],
    links: [], frames: [], output: 'out',
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Check the shape of graph JSON (for example a file import). It does not
 * check node types against a registry: pass `registry` to do that too.
 * @param {*} g
 * @param {Map<string,NodeDef>} [registry]
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateGraph(g, registry) {
  const errors = [];
  if (!g || typeof g !== 'object') return { ok: false, errors: ['not an object'] };
  if (g.version !== GRAPH_VERSION) errors.push(`version ${g.version} is not ${GRAPH_VERSION}`);
  if (!Array.isArray(g.nodes)) errors.push('nodes is not an array');
  if (!Array.isArray(g.links)) errors.push('links is not an array');
  const ids = new Set();
  for (const n of g.nodes || []) {
    if (!n || typeof n.id !== 'string') { errors.push('node without id'); continue; }
    if (ids.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (registry && !registry.has(n.type)) errors.push(`unknown node type ${n.type}`);
  }
  const taken = new Set();
  for (const l of g.links || []) {
    if (!l || !Array.isArray(l.from) || !Array.isArray(l.to)) { errors.push('bad link'); continue; }
    if (!ids.has(l.from[0]) || !ids.has(l.to[0])) errors.push(`link to a missing node ${l.from[0]} -> ${l.to[0]}`);
    const k = l.to.join(':');
    if (taken.has(k)) errors.push(`input ${k} has two links`);
    taken.add(k);
  }
  if (g.output && !ids.has(g.output)) errors.push(`output ${g.output} is not a node`);
  return { ok: errors.length === 0, errors };
}

/**
 * Store events. Payload shapes:
 *   graph:changed   {reason:string, nodeIds?:string[], paramOnly?:boolean}
 *                   reason: 'edit' | 'param' | 'load' | 'undo' | 'redo' | 'boot'
 *                   paramOnly true means no topology change (uniform update)
 *   graph:select    {ids:string[]}            the selected node ids
 *   bake:start      {res:number}
 *   bake:done       MaterialMaps
 *   bake:error      {message:string, nodeId?:string}
 *   env:changed     the new state.env
 *   view:changed    the new state.view
 *   res:changed     {res:number}
 *   history:changed {canUndo:boolean, canRedo:boolean, label:string}
 *   toast           {message:string, kind:'info'|'ok'|'warn'|'error', ms?:number}
 *   module:ready    {name:string}              after a module's init resolves
 *   boot:done       {failed:string[]}          after every module init ran
 */
export const EVENTS = Object.freeze([
  'graph:changed', 'graph:select', 'bake:start', 'bake:done', 'bake:error',
  'env:changed', 'view:changed', 'res:changed', 'history:changed', 'toast',
  'module:ready', 'boot:done',
]);

/** Viewport meshes. */
export const MESHES = Object.freeze(['sphere', 'cube', 'roundedCube', 'plane', 'cylinder', 'torus', 'shaderBall']);

/** Viewport debug views: 'lit' is the full shade, the rest show one input. */
export const DEBUG_VIEWS = Object.freeze([
  'lit', 'albedo', 'opacity', 'normal', 'worldNormal', 'ao', 'roughness', 'metallic',
  'height', 'emissive', 'clearcoat', 'sheen', 'anisotropy', 'uv', 'diffuseOnly', 'specularOnly',
]);

export const TONEMAPPERS = Object.freeze(['aces', 'agx', 'khronosNeutral', 'reinhard', 'filmic', 'linear']);

/** Export targets. normalY: the green-channel convention the engine wants.
 *  packing: how the target packs the ORM data into its own maps. */
export const EXPORT_TARGETS = Object.freeze([
  { id: 'unity-urp',      label: 'Unity URP',      normalY: '+Y', packing: 'MetallicSmoothness (R=metal, A=smoothness), separate AO' },
  { id: 'unity-hdrp',     label: 'Unity HDRP',     normalY: '+Y', packing: 'MaskMap (R=metal, G=AO, B=detail, A=smoothness)' },
  { id: 'unity-builtin',  label: 'Unity Built-in', normalY: '+Y', packing: 'MetallicGloss (R=metal, A=smoothness), separate AO' },
  { id: 'unreal',         label: 'Unreal Engine',  normalY: '-Y', packing: 'ORM (R=AO, G=rough, B=metal)' },
  { id: 'godot',          label: 'Godot 4',        normalY: '+Y', packing: 'ORM (R=AO, G=rough, B=metal)' },
  { id: 'gltf',           label: 'glTF 2.0 (.glb)', normalY: '+Y', packing: 'metallicRoughness (G=rough, B=metal), occlusion R' },
  { id: 'png',            label: 'PNG maps',       normalY: '+Y', packing: 'one PNG per map' },
]);

/** Node library categories, in palette order. */
export const NODE_CATEGORIES = Object.freeze([
  'Output', 'Input', 'Generator', 'Noise', 'Pattern', 'Math', 'Vector', 'Color',
  'Adjust', 'Blend', 'Filter', 'Height & Normal', 'Transform', 'Utility', 'Bench',
]);
