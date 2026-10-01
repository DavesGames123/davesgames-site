// ============================================================================
//  MATERIAL STUDIO  ·  compile.js — graph to WGSL passes
// ────────────────────────────────────────────────────────────────────────────
//  compileGraph(graph, registry) turns contract Graph JSON into an ordered
//  list of render passes. Each pass is one full-screen draw into one or more
//  textures. The compiler does no GPU work: bake.js runs the passes.
//
//  DATA FLOW
//      graph JSON ──flatten──> macros (NodeDef.expand) replaced by subgraphs
//                 ──order────> topological order, cycles cut and reported
//                 ──passes───> one 'node' pass per boundary (pass) node,
//                              one 'mat' pass per expr output that a pass
//                              node reads as a texture, and one or two
//                              'out' passes (MRT) for the Material Output
//                 ──thumbSpec> on request, a 'thumb' pass per node output
//
//  FUSION
//      Expr nodes do not get a pass. Each pass that needs an expr value emits
//      the expr nodes it depends on as `let` statements in one fragment
//      function (a fused per-texel program). An expr node reads a pass node
//      output with one texture sample at the same texel. An expr output that
//      some pass node already forced into a texture ('mat') is sampled, not
//      recomputed (except vec2 outputs, which hold uv and need f32 precision).
//
//  DEDUPE
//      Inside one pass, two nodes with the same type, param values, input
//      expressions (and seed, when the code reads it) share one result: the
//      second node's code and uniform slots are dropped (CSE at node level).
//
//  UNIFORMS
//      Each pass has one uniform buffer: struct MsU { h, o, p: array<vec4f,N> }.
//      h = (res, seed, tiling, time), o = (origin x, origin y, size, 0) — bake
//      fills h and o. p holds one vec4 per uniform param (slider, int, bool,
//      color, vec2), plus gradient stops and curve points. A param edit thus
//      changes only uniform bytes: the WGSL, its hash and the pipeline stay.
//
//  ERRORS
//      compile errors and WGSL compile messages map to node ids. Each pass
//      keeps a lineMap [{line, nodeId}], and lineToNode(spec, line) resolves
//      a WGSL line number. Errors on macro internals map to the macro node.
//
//  CONTENTS  (grep -n the name to jump)
//      loadLib / parseLib / libFor ... the shaders/bake-lib.wgsl splitter
//      hashStr ........................ 64-bit FNV-1a string hash (hex)
//      fl / lit / hexToLinear .......... WGSL literal helpers
//      class Scope .................... one pass under construction
//      class Compiler ................. flatten, order, emit, finishPass
//      compileGraph ................... the entry point
//      prepareGraph ................... await lazy NodeDef loaders (bench libs)
//      lineToNode ..................... WGSL line -> node id
//      selfTest / init ................ __studio.compile
// ============================================================================
import {
  WGSL_TYPE, PORT_DEFAULTS, convertExpr, canConnect, OUTPUT_TYPE, MATERIAL_INPUTS, MATERIAL_PARAMS,
  DEFAULT_SCALARS, DEFAULT_SETTINGS, MAP_NAMES,
} from './contract.js';

// ------------------------------------------------------------ library
let lib = null;   // { items: Map<name,{name,src,deps}>, order: string[] }
const NAME_RE = /\b(ms_\w+|Ms\w+)\b/g;

/** Split bake-lib.wgsl into top-level fn/struct items with their dependencies. */
export function parseLib(src) {
  const items = new Map(), order = [];
  let cur = null, depth = 0, opened = false;
  for (const line of src.split('\n')) {
    if (!cur) {
      const m = /^(?:fn\s+(ms_\w+)|struct\s+(Ms\w+))/.exec(line);
      if (!m) continue;
      cur = { name: m[1] || m[2], lines: [] }; depth = 0; opened = false;
    }
    cur.lines.push(line);
    for (const ch of line.replace(/\/\/.*$/, '')) {
      if (ch === '{') { depth++; opened = true; } else if (ch === '}') depth--;
    }
    if (opened && depth === 0) {
      const s = cur.lines.join('\n');
      items.set(cur.name, { name: cur.name, src: s, deps: [] });
      order.push(cur.name);
      cur = null;
    }
  }
  for (const it of items.values()) {
    const deps = new Set();
    for (const m of it.src.matchAll(NAME_RE)) if (m[1] !== it.name && items.has(m[1])) deps.add(m[1]);
    it.deps = [...deps];
  }
  return { items, order };
}

/** Load and split the library once. Safe to call more than once. */
export async function loadLib(src) {
  if (lib && !src) return lib;
  if (!src) {
    const res = await fetch(new URL('shaders/bake-lib.wgsl', import.meta.url));
    if (!res.ok) throw new Error('bake-lib.wgsl fetch failed: ' + res.status);
    src = await res.text();
  }
  lib = parseLib(src);
  return lib;
}

/** The library items that `code` names, with their dependencies, in file order. */
export function libFor(code) {
  if (!lib) return '';
  const need = new Set();
  const stack = [];
  for (const m of code.matchAll(NAME_RE)) if (lib.items.has(m[1])) stack.push(m[1]);
  while (stack.length) {
    const n = stack.pop();
    if (need.has(n)) continue;
    need.add(n);
    stack.push(...lib.items.get(n).deps);
  }
  return lib.order.filter(n => need.has(n)).map(n => lib.items.get(n).src).join('\n\n');
}

// ------------------------------------------------------------ hash
/** 64-bit FNV-1a (two 32-bit lanes) as 16 hex chars. */
export function hashStr(s) {
  let h1 = 0x811c9dc5, h2 = 0x050c5d1f;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h1 >>> 7);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------ literals
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
/** WGSL f32 literal; negative values in parentheses (no `--` tokens). */
export function fl(v) {
  const x = num(v);
  let s = String(x);
  if (!/[.eE]/.test(s)) s += '.0';
  return x < 0 || Object.is(x, -0) ? `(${s})` : s;
}

/** '#rgb' / '#rrggbb' sRGB -> linear [r,g,b]. Arrays pass through. */
export function hexToLinear(v) {
  if (Array.isArray(v)) return [num(v[0]), num(v[1]), num(v[2])];
  if (typeof v === 'number') return [v, v, v];
  let h = String(v || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}/.test(h)) return [0.5, 0.5, 0.5];
  const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [0, 2, 4].map(i => toLin(parseInt(h.slice(i, i + 2), 16) / 255));
}

/** A port value as a JS vec4 (for uniform and constant textures). */
function valueVec4(type, v) {
  if (type === 'float') return [num(Array.isArray(v) ? v[0] : v), 0, 0, 0];
  if (type === 'vec2') { const a = Array.isArray(v) ? v : [v, v]; return [num(a[0]), num(a[1]), 0, 0]; }
  if (type === 'color') { const a = hexToLinear(v); return [a[0], a[1], a[2], 1]; }
  if (type === 'texture') { const a = Array.isArray(v) ? v : (typeof v === 'string' ? [...hexToLinear(v), 1] : [v, v, v, 1]); return [num(a[0]), num(a[1]), num(a[2]), a[3] === undefined ? 1 : num(a[3])]; }
  const a = Array.isArray(v) ? v : [v, v, v];
  return [num(a[0]), num(a[1]), num(a[2]), 1];
}

/** WGSL literal of a port value. */
export function lit(type, v) {
  const a = valueVec4(type, v);
  switch (type) {
    case 'float': return fl(a[0]);
    case 'vec2': return `vec2f(${fl(a[0])}, ${fl(a[1])})`;
    case 'texture': return `vec4f(${fl(a[0])}, ${fl(a[1])}, ${fl(a[2])}, ${fl(a[3])})`;
    default: return `vec3f(${fl(a[0])}, ${fl(a[1])}, ${fl(a[2])})`;
  }
}

/** Default output swizzle of a pass texture for a socket type. */
const swzFor = type => (type === 'float' ? 'r' : type === 'vec2' ? 'rg' : type === 'texture' ? '' : 'rgb');

/** Store a typed value as the vec4 of an intermediate texture. */
function storeExpr(e, type) {
  if (type === 'float') return `vec4f(vec3f(${e}), 1.0)`;
  if (type === 'vec2') return `vec4f(${e}, 0.0, 1.0)`;
  if (type === 'texture') return `(${e})`;
  return `vec4f(${e}, 1.0)`;
}

/** Display a typed value in a thumbnail (rgba8unorm target, no gamma on grays). */
function displayExpr(e, type) {
  switch (type) {
    case 'float': return `vec4f(vec3f(clamp(${e}, 0.0, 1.0)), 1.0)`;
    case 'vec2': return `vec4f(clamp(${e}, vec2f(0.0), vec2f(1.0)), 0.0, 1.0)`;
    case 'normal': return `vec4f(ms_nenc(${e}), 1.0)`;
    case 'vec3': return `vec4f(clamp(${e}, vec3f(0.0), vec3f(1.0)), 1.0)`;
    case 'texture': return `vec4f(ms_lin2srgb(clamp((${e}).rgb, vec3f(0.0), vec3f(1.0))), 1.0)`;
    default: return `vec4f(ms_lin2srgb(clamp(${e}, vec3f(0.0), vec3f(1.0))), 1.0)`;
  }
}

/** Monotone (Fritsch-Carlson) tangents for curve points sorted by x. */
function curveTangents(pts) {
  const n = pts.length, m = new Array(n).fill(0);
  if (n < 2) return m;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / Math.max(pts[i + 1][0] - pts[i][0], 1e-6));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
}

/** Stable small seed offset per node id. */
function seedOffset(id) { return (parseInt(hashStr(String(id)).slice(0, 6), 16) % 997) + 1; }

const refKey = r => (r.kind === 'pass' ? 'p:' + r.pass : r.kind === 'const' ? 'c:' + r.value.join(',') : 'i:' + r.nodeId + ':' + r.paramId);

// ------------------------------------------------------------ scope
/** One pass under construction: its body, uniforms and texture bindings. */
class Scope {
  constructor(kind) {
    this.kind = kind;
    this.body = [];          // [{nodeId, lines[]}]
    this.fns = [];           // [{nodeId, src}] per-instance module-scope functions
    this.typeFns = new Map();// type -> NodeDef.functions
    this.uni = [];           // [[x,y,z,w]]
    this.tex = [];           // texture refs, binding 2 + index
    this.texKey = new Map();
    this.done = new Map();   // nodeId -> {outId: wgsl}
    this.cse = new Map();    // dedupe key -> {outId: wgsl}
    this.uids = new Map();
    this.nodeIds = new Set();
  }
  uid(id) { if (!this.uids.has(id)) this.uids.set(id, 'v' + this.uids.size); return this.uids.get(id); }
  slot(v4) { this.uni.push(v4.map(num)); return `ms_u.p[${this.uni.length - 1}]`; }
  bind(ref) {
    const k = refKey(ref);
    if (!this.texKey.has(k)) { this.texKey.set(k, `ms_t${this.tex.length}`); this.tex.push(ref); }
    return this.texKey.get(k);
  }
}

// ------------------------------------------------------------ compiler
class Compiler {
  constructor(graph, registry, opts = {}) {
    this.src = graph || {};
    this.reg = registry || new Map();
    this.opts = opts;
    this.errors = [];
    this.nodes = new Map();       // id -> GraphNode (after flatten)
    this.origin = new Map();      // internal id -> macro node id
    this.macroOut = new Map();    // macro id -> {outId: [internalId, out]}
    this.rerouted = new Map();    // reroute id -> [srcId, out] | null
    this.inLinks = new Map();     // nodeId -> {inId: {node, out}}
    this.passes = [];
    this.passOf = new Map();      // pass node id -> spec
    this.mat = new Map();         // 'id:out' -> spec
    this.seq = 0;
    this.maxMRT = opts.maxMRT || 3;
  }

  err(nodeId, message) {
    const id = this.origin.get(nodeId) || nodeId;
    if (!this.errors.some(e => e.nodeId === id && e.message === message)) this.errors.push({ nodeId: id, message });
  }
  def(id) { const n = this.nodes.get(id); return n ? this.reg.get(n.type) : null; }

  // ---------------- flatten macros
  flatten() {
    const g = this.src;
    for (const n of g.nodes || []) this.nodes.set(n.id, { ...n, params: { ...(n.params || {}) } });
    let links = (g.links || []).map(l => ({ from: [...l.from], to: [...l.to] }));
    for (let depth = 0; depth < 8; depth++) {
      const macros = [...this.nodes.values()].filter(n => this.reg.get(n.type)?.expand);
      if (!macros.length) break;
      for (const m of macros) {
        const d = this.reg.get(m.type);
        const values = this.values(m, d);
        let sub;
        try { sub = d.expand(values, m) || {}; } catch (e) { this.err(m.id, 'expand failed: ' + e.message); this.nodes.delete(m.id); continue; }
        const pre = m.id + '/';
        const root = this.origin.get(m.id) || m.id;
        for (const sn of sub.nodes || []) {
          const id = pre + sn.id;
          this.nodes.set(id, { id, type: sn.type, x: m.x, y: m.y, params: { ...(sn.params || {}) } });
          this.origin.set(id, root);
        }
        const next = [];
        for (const l of sub.links || []) next.push({ from: [pre + l.from[0], l.from[1]], to: [pre + l.to[0], l.to[1]] });
        for (const l of links) {
          if (l.to[0] === m.id) {
            for (const t of (sub.inputs || {})[l.to[1]] || []) next.push({ from: l.from, to: [pre + t[0], t[1]] });
          } else if (l.from[0] === m.id) {
            const o = (sub.outputs || {})[l.from[1]];
            if (o) next.push({ from: [pre + o[0], o[1]], to: l.to });
            else this.err(m.id, `macro output ${l.from[1]} is missing`);
          } else next.push(l);
        }
        links = next;
        const outs = {};
        for (const [k, o] of Object.entries(sub.outputs || {})) outs[k] = [pre + o[0], o[1]];
        // A nested macro output points at a node that the next round replaces;
        // resolve that later through macroOut chains.
        this.macroOut.set(m.id, outs);
        this.nodes.delete(m.id);
      }
    }
    // Reroute dots (NodeDef.reroute, graph.js 'utility.reroute'): bypass them so
    // each wire keeps its exact source type.
    const rr = new Set([...this.nodes.values()].filter(n => this.reg.get(n.type)?.reroute).map(n => n.id));
    if (rr.size) {
      const feed = new Map();
      for (const l of links) if (rr.has(l.to[0])) feed.set(l.to[0], l.from);
      const srcOf = id => { let f = feed.get(id); for (let i = 0; f && rr.has(f[0]) && i < 64; i++) f = feed.get(f[0]); return f && !rr.has(f[0]) ? f : null; };
      const next = [];
      for (const l of links) {
        if (rr.has(l.to[0])) continue;
        if (rr.has(l.from[0])) { const f = srcOf(l.from[0]); if (f) next.push({ from: [...f], to: l.to }); } else next.push(l);
      }
      links = next;
      for (const id of rr) { this.rerouted.set(id, srcOf(id)); this.nodes.delete(id); }
    }
    this.links = links;
  }

  /** Resolve a (possibly macro) output to the flattened [nodeId, outId]. */
  resolveOut(id, out) {
    for (let i = 0; i < 8 && !this.nodes.has(id); i++) {
      if (this.rerouted.has(id)) { const f = this.rerouted.get(id); if (!f) return null; [id, out] = f; continue; }
      const m = this.macroOut.get(id);
      if (!m || !m[out]) return null;
      [id, out] = m[out];
    }
    return this.nodes.has(id) ? [id, out] : null;
  }

  // ---------------- links and order
  index() {
    for (const l of this.links) {
      let from = l.from;
      if (!this.nodes.has(from[0])) { from = this.resolveOut(from[0], from[1]); if (!from) continue; }
      if (!this.nodes.has(l.to[0])) continue;
      if (!this.inLinks.has(l.to[0])) this.inLinks.set(l.to[0], {});
      const slot = this.inLinks.get(l.to[0]);
      if (slot[l.to[1]]) this.err(l.to[0], `input ${l.to[1]} has two links; the first one is used`);
      else slot[l.to[1]] = { node: from[0], out: from[1] };
    }
    for (const n of this.nodes.values()) if (!this.reg.has(n.type)) this.err(n.id, `unknown node type ${n.type}`);
  }

  order(roots) {
    const mark = new Map(), out = [];
    const visit = (id, path) => {
      const s = mark.get(id);
      if (s === 2) return;
      if (s === 1) return 'cycle';
      mark.set(id, 1);
      const ins = this.inLinks.get(id) || {};
      for (const [inId, l] of Object.entries(ins)) {
        if (!this.nodes.has(l.node)) continue;
        if (visit(l.node, path) === 'cycle') {
          this.err(id, `cycle through input ${inId}; the link is ignored`);
          delete ins[inId];
        }
      }
      mark.set(id, 2);
      out.push(id);
    };
    for (const r of roots) if (this.nodes.has(r)) visit(r);
    return out;
  }

  // ---------------- params
  values(node, def) {
    const v = {};
    for (const p of def.params || []) {
      const x = node.params ? node.params[p.id] : undefined;
      v[p.id] = x === undefined || x === null ? p.default : x;
      if (p.kind === 'enum' && v[p.id] && typeof v[p.id] === 'object') v[p.id] = v[p.id].value;
    }
    return v;
  }

  params(scope, node, def, uid) {
    const values = this.values(node, def), params = {};
    for (const p of def.params || []) {
      const v = values[p.id], uni = p.uniform !== false;
      switch (p.kind) {
        case 'slider': params[p.id] = uni ? scope.slot([num(v), 0, 0, 0]) + '.x' : fl(v); break;
        case 'int': params[p.id] = uni ? scope.slot([Math.round(num(v)), 0, 0, 0]) + '.x' : fl(Math.round(num(v))); break;
        case 'bool': params[p.id] = uni ? scope.slot([v ? 1 : 0, 0, 0, 0]) + '.x' : (v ? '1.0' : '0.0'); break;
        case 'color': { const c = hexToLinear(v); params[p.id] = uni ? scope.slot([...c, 1]) + '.xyz' : lit('color', c); break; }
        case 'vec2': { const a = Array.isArray(v) ? v : [v, v]; params[p.id] = uni ? scope.slot([num(a[0]), num(a[1]), 0, 0]) + '.xy' : lit('vec2', a); break; }
        case 'gradient': params[p.id] = this.gradientFn(scope, node.id, `${uid}_${p.id}`, v); break;
        case 'curve': params[p.id] = this.curveFn(scope, node.id, `${uid}_${p.id}`, v); break;
        case 'image': params[p.id] = scope.bind({ kind: 'image', nodeId: node.id, paramId: p.id, value: v, srgb: values.colorspace !== 'linear' }); break;
        default: params[p.id] = v; // enum, text: the raw value
      }
    }
    return { params, values };
  }

  gradientFn(scope, nodeId, name, stops) {
    let s = Array.isArray(stops) && stops.length ? stops.map(x => ({ t: num(x.t), color: x.color })) : [{ t: 0, color: '#000000' }, { t: 1, color: '#ffffff' }];
    s = s.sort((a, b) => a.t - b.t).slice(0, 64);
    const slots = s.map(x => scope.slot([...hexToLinear(x.color), x.t]));
    const lines = [`fn ${name}(t: f32) -> vec3f {`, '  let x = clamp(t, 0.0, 1.0);', `  var c = ${slots[0]}.xyz;`];
    for (let i = 1; i < slots.length; i++) {
      const a = slots[i - 1], b = slots[i];
      lines.push(`  c = mix(c, ${b}.xyz, clamp((x - ${a}.w) / max(${b}.w - ${a}.w, 0.00001), 0.0, 1.0));`);
    }
    lines.push('  return c;', '}');
    scope.fns.push({ nodeId, src: lines.join('\n') });
    return name;
  }

  curveFn(scope, nodeId, name, pts) {
    let p = Array.isArray(pts) && pts.length ? pts.map(x => [num(x[0]), num(x[1])]) : [[0, 0], [1, 1]];
    p = p.sort((a, b) => a[0] - b[0]).slice(0, 64);
    const m = curveTangents(p);
    const slots = p.map((x, i) => scope.slot([x[0], x[1], m[i], 0]));
    const lines = [`fn ${name}(t: f32) -> f32 {`, `  var y = ${slots[0]}.y;`];
    for (let i = 0; i < slots.length - 1; i++) lines.push(`  if (t >= ${slots[i]}.x) { y = ms_herm(${slots[i]}, ${slots[i + 1]}, t); }`);
    if (slots.length > 1) lines.push(`  if (t >= ${slots[slots.length - 1]}.x) { y = ${slots[slots.length - 1]}.y; }`);
    lines.push('  return y;', '}');
    scope.fns.push({ nodeId, src: lines.join('\n') });
    return name;
  }

  // ---------------- inputs
  /** Constant WGSL for an unlinked input: node.params[inputId] overrides the default. */
  constInput(node, inp, def) {
    const isParam = (def.params || []).some(p => p.id === inp.id);
    let v = !isParam && node.params && node.params[inp.id] !== undefined ? node.params[inp.id] : inp.default;
    if (v === 'uv') return inp.type === 'vec2' ? 'uv' : convertExpr('uv', 'vec2', inp.type);
    if (v === undefined || v === null) v = PORT_DEFAULTS[inp.type];
    return lit(inp.type, v);
  }
  constValue(node, inp, def) {
    const isParam = (def.params || []).some(p => p.id === inp.id);
    let v = !isParam && node.params && node.params[inp.id] !== undefined ? node.params[inp.id] : inp.default;
    if (v === 'uv' || v === undefined || v === null) v = PORT_DEFAULTS[inp.type];
    const a = valueVec4(inp.type, v);
    if (inp.type === 'float') return [a[0], a[0], a[0], 1];
    if (inp.type === 'vec2') return [a[0], a[1], 0, 1];
    if (inp.type === 'texture') return a;
    return [a[0], a[1], a[2], 1];
  }

  /** Check a link and return {src, sdef, odef} or null (with an error). */
  linkInfo(node, inp) {
    const l = (this.inLinks.get(node.id) || {})[inp.id];
    if (!l) return null;
    const src = this.nodes.get(l.node), sdef = src && this.reg.get(src.type);
    if (!sdef) { this.err(node.id, `input ${inp.id}: source node ${l.node} has no definition`); return null; }
    const odef = (sdef.outputs || []).find(o => o.id === l.out);
    if (!odef) { this.err(node.id, `input ${inp.id}: ${l.node} has no output ${l.out}`); return null; }
    if (!canConnect(odef.type, inp.type)) { this.err(node.id, `input ${inp.id}: ${odef.type} does not convert to ${inp.type}`); return null; }
    return { src, sdef, odef };
  }

  /** The texture ref that holds a source output, or null if it is computed in-pass. */
  texRefOf(srcId, sdef, odef, allowMat) {
    if (sdef.pass) { const p = this.passOf.get(srcId); return p ? { kind: 'pass', pass: p.id } : null; }
    if (!allowMat || odef.type === 'vec2') return null;
    const m = this.mat.get(srcId + ':' + odef.id);
    return m ? { kind: 'pass', pass: m.id } : null;
  }

  sampleRef(scope, ref, odef, sdef, uvExpr) {
    const b = scope.bind(ref);
    const swz = sdef.pass ? (odef.swizzle !== undefined ? odef.swizzle : swzFor(odef.type)) : swzFor(odef.type);
    return `textureSampleLevel(${b}, ms_samp, ${uvExpr}, 0.0)${swz ? '.' + swz : ''}`;
  }

  /** WGSL for one input of a node inside a fused scope (already converted). */
  resolveInput(scope, node, def, inp) {
    const info = this.linkInfo(node, inp);
    if (!info) return { expr: this.constInput(node, inp, def), linked: false };
    const { src, sdef, odef } = info;
    let e;
    const ref = this.texRefOf(src.id, sdef, odef, true);
    if (ref) e = this.sampleRef(scope, ref, odef, sdef, 'uv0');
    else if (sdef.pass) { this.err(node.id, `input ${inp.id}: ${src.id} did not render`); return { expr: this.constInput(node, inp, def), linked: false }; }
    else {
      const outs = this.emitNode(scope, src.id);
      e = outs[odef.id];
      if (e === undefined) return { expr: this.constInput(node, inp, def), linked: false };
    }
    return { expr: convertExpr(e, odef.type, inp.type), linked: true };
  }

  // ---------------- fused emission
  emitNode(scope, id) {
    if (scope.done.has(id)) return scope.done.get(id);
    const node = this.nodes.get(id), def = this.reg.get(node.type);
    if (!def) { scope.done.set(id, {}); return {}; }
    if (def.pass) {
      const outs = {};
      const p = this.passOf.get(id);
      for (const o of def.outputs || []) outs[o.id] = p ? this.sampleRef(scope, { kind: 'pass', pass: p.id }, o, def, 'uv0') : lit(o.type, PORT_DEFAULTS[o.type]);
      scope.done.set(id, outs);
      return outs;
    }
    if (typeof def.expr !== 'function') {
      this.err(id, `${node.type} has no expr or pass and cannot feed other nodes`);
      scope.done.set(id, {}); return {};
    }
    scope.done.set(id, {}); // guard against re-entry
    const inputs = {}, linked = {};
    for (const inp of def.inputs || []) {
      const r = this.resolveInput(scope, node, def, inp);
      inputs[inp.id] = r.expr; linked[inp.id] = r.linked;
    }
    const mark = { uni: scope.uni.length, fns: scope.fns.length };
    const uid = scope.uid(id);
    const { params, values } = this.params(scope, node, def, uid);
    const lets = [];
    const off = seedOffset(this.origin.get(id) ? id : id);
    const ctx = {
      inputs, params, values, linked, uv: 'uv', seed: `(ms_u.h.y + ${off}.0)`, res: 'ms_u.h.x', time: 'ms_u.h.w', uid,
      let: s => lets.push(String(s)),
      fn: s => scope.fns.push({ nodeId: id, src: String(s) }),
    };
    let outs;
    try { outs = def.expr(ctx) || {}; } catch (e) { this.err(id, 'expr failed: ' + e.message); outs = {}; }
    const text = lets.join('\n') + JSON.stringify(outs);
    const usesSeed = text.includes(ctx.seed);
    const fnText = scope.fns.slice(mark.fns).map(f => f.src.split(uid + '_').join('#_')).join('\n');
    const key = [node.type, JSON.stringify(values), JSON.stringify(inputs), usesSeed ? off : '', fnText].join('|');
    if (scope.cse.has(key)) {
      scope.uni.length = mark.uni;
      scope.fns.length = mark.fns;
      const prev = scope.cse.get(key);
      scope.done.set(id, prev);
      return prev;
    }
    const lines = [`  // ${id} ${node.type}`, ...lets.map(s => '  ' + s)];
    const res = {};
    for (const o of def.outputs || []) {
      let e = outs[o.id];
      if (e === undefined || e === null) { this.err(id, `output ${o.id} has no expression`); e = lit(o.type, PORT_DEFAULTS[o.type]); }
      const v = `${uid}_o${(def.outputs || []).indexOf(o)}`;
      lines.push(`  let ${v}: ${WGSL_TYPE[o.type]} = ${e};`);
      res[o.id] = v;
    }
    if (def.functions) scope.typeFns.set(node.type, def.functions);
    scope.body.push({ nodeId: id, lines });
    scope.nodeIds.add(id);
    scope.cse.set(key, res);
    scope.done.set(id, res);
    return res;
  }

  // ---------------- passes
  ensureMat(srcId, outId) {
    const key = srcId + ':' + outId;
    if (this.mat.has(key)) return this.mat.get(key);
    const node = this.nodes.get(srcId), def = this.reg.get(node.type);
    const odef = def.outputs.find(o => o.id === outId);
    const scope = new Scope('mat');
    const outs = this.emitNode(scope, srcId);
    const e = outs[outId] !== undefined ? outs[outId] : lit(odef.type, PORT_DEFAULTS[odef.type]);
    const spec = this.finishPass(scope, { kind: 'mat', nodeId: srcId, outId, label: `${srcId}.${outId}`, outs: [storeExpr(e, odef.type)], targets: ['inter'], type: odef.type });
    this.mat.set(key, spec);
    return spec;
  }

  makeNodePass(id) {
    const node = this.nodes.get(id), def = this.reg.get(node.type);
    if (typeof def.pass.run === 'function') return this.makeExternalPass(id, node, def);
    const scope = new Scope('node');
    const uid = scope.uid(id);
    const tex = {}, sample = {}, linked = {};
    for (const inp of def.inputs || []) {
      const info = this.linkInfo(node, inp);
      let ref = null, odef = null, sdef = null;
      if (info) {
        ({ odef, sdef } = info);
        if (!sdef.pass) this.ensureMat(info.src.id, odef.id);
        ref = this.texRefOf(info.src.id, sdef, odef, true) || (sdef.pass ? null : { kind: 'pass', pass: this.ensureMat(info.src.id, odef.id).id });
      }
      if (ref) {
        const b = scope.bind(ref);
        const swz = sdef.pass ? (odef.swizzle !== undefined ? odef.swizzle : swzFor(odef.type)) : swzFor(odef.type);
        const ft = odef.type, tt = inp.type;
        tex[inp.id] = b;
        sample[inp.id] = uvE => convertExpr(`textureSampleLevel(${b}, ms_samp, ${uvE}, 0.0)${swz ? '.' + swz : ''}`, ft, tt);
        linked[inp.id] = true;
      } else {
        const c = this.constInput(node, inp, def);
        tex[inp.id] = scope.bind({ kind: 'const', value: this.constValue(node, inp, def) });
        sample[inp.id] = () => c;
        linked[inp.id] = false;
      }
    }
    const { params, values } = this.params(scope, node, def, uid);
    const img = {};
    for (const p of def.params || []) if (p.kind === 'image') img[p.id] = params[p.id];
    const off = seedOffset(id);
    const ctx = { tex, sample, samp: 'ms_samp', params, values, linked, img, seed: `(ms_u.h.y + ${off}.0)`, res: 'ms_u.h.x', time: 'ms_u.h.w', uid };
    let code;
    try { code = def.pass.wgsl(ctx); } catch (e) { this.err(id, 'pass.wgsl failed: ' + e.message); code = 'fn pass_main(uv: vec2f) -> vec4f { return vec4f(1.0, 0.0, 1.0, 1.0); }'; }
    if (def.functions) scope.typeFns.set(node.type, def.functions);
    scope.nodeIds.add(id);
    const spec = this.finishPass(scope, { kind: 'node', nodeId: id, label: `${id} ${node.type}`, passCode: String(code), targets: ['inter'], size: def.pass.size || 0 });
    this.passOf.set(id, spec);
    return spec;
  }

  /** A pass node that runs its own GPU work (NodeDef.pass.run, for example
   *  bench cells). No WGSL here: bake.js calls run(job) with the input
   *  textures. inputs maps inputId -> texture index (or null = unlinked). */
  makeExternalPass(id, node, def) {
    const scope = new Scope('node');
    const inputs = {};
    for (const inp of def.inputs || []) {
      const info = this.linkInfo(node, inp);
      if (!info) { inputs[inp.id] = null; continue; }
      const { src, sdef, odef } = info;
      let ref = this.texRefOf(src.id, sdef, odef, true);
      if (!ref && !sdef.pass) ref = { kind: 'pass', pass: this.ensureMat(src.id, odef.id).id };
      if (!ref) { inputs[inp.id] = null; continue; }
      scope.bind(ref);
      inputs[inp.id] = scope.tex.findIndex(t => refKey(t) === refKey(ref));
    }
    const values = this.values(node, def);
    const spec = {
      id: 'p' + this.seq++, kind: 'node', external: true, nodeId: id, label: `${id} ${node.type}`, nodeType: node.type,
      wgsl: '', hash: hashStr('external|' + node.type + '|' + JSON.stringify(values)), targets: ['rgba16float'], size: 0,
      uniforms: new Float32Array(8), textures: scope.tex, inputs, values, seed: seedOffset(id), lineMap: [], nodes: [this.origin.get(id) || id],
    };
    this.passes.push(spec);
    this.passOf.set(id, spec);
    return spec;
  }

  /** The Material Output passes: MRT groups of MAP_NAMES. */
  makeOutPasses(outId) {
    const node = this.nodes.get(outId);
    const def = this.reg.get(OUTPUT_TYPE) || { type: OUTPUT_TYPE, inputs: MATERIAL_INPUTS, params: MATERIAL_PARAMS, outputs: [] };
    const inDef = id => (def.inputs || []).find(i => i.id === id) || MATERIAL_INPUTS.find(i => i.id === id);
    const enc = {
      albedo: v => `vec4f(max(${v('baseColor')}, vec3f(0.0)), clamp(${v('opacity')}, 0.0, 1.0))`,
      normal: v => `vec4f((normalize(${v('normal')}) * 0.5) + vec3f(0.5), 1.0)`,
      orm: v => `vec4f(clamp(${v('ao')}, 0.0, 1.0), clamp(${v('roughness')}, 0.0, 1.0), clamp(${v('metallic')}, 0.0, 1.0), 1.0)`,
      height: v => `vec4f(vec3f(${v('height')}), 1.0)`,
      emissive: v => `vec4f(max(${v('emissive')}, vec3f(0.0)), 1.0)`,
      extra: v => `vec4f(clamp(${v('clearcoat')}, 0.0, 1.0), clamp(${v('clearcoatRoughness')}, 0.0, 1.0), clamp(${v('sheen')}, 0.0, 1.0), clamp(${v('anisotropy')}, -1.0, 1.0))`,
    };
    const outputs = {}, specs = [];
    const per = Math.max(1, Math.min(this.maxMRT, MAP_NAMES.length));
    for (let g = 0; g < MAP_NAMES.length; g += per) {
      const names = MAP_NAMES.slice(g, g + per);
      const scope = new Scope('out');
      const cache = {};
      const v = id => {
        if (cache[id]) return cache[id];
        const r = node ? this.resolveInput(scope, node, def, inDef(id)) : { expr: lit(inDef(id).type, inDef(id).default) };
        // Bind the input to a let so the encoders can repeat it.
        const name = `mo_${id}`;
        scope.body.push({ nodeId: outId, lines: [`  let ${name}: ${WGSL_TYPE[inDef(id).type]} = ${r.expr};`] });
        cache[id] = name;
        return name;
      };
      const outs = names.map(n => enc[n](v));
      const spec = this.finishPass(scope, { kind: 'out', nodeId: outId, label: 'out ' + names.join('+'), outs, targets: names.map(() => 'map'), slots: names });
      names.forEach((n, i) => { outputs[n] = { pass: spec.id, index: i }; });
      specs.push(spec);
    }
    return { outputs, specs };
  }

  /** Assemble the WGSL module and the pass spec. */
  finishPass(scope, o) {
    const N = Math.max(1, scope.uni.length);
    const lines = [], lineMap = [];
    const push = (text, nodeId) => {
      if (nodeId !== undefined) lineMap.push({ line: lines.length + 1, nodeId: this.origin.get(nodeId) || nodeId });
      for (const l of String(text).split('\n')) lines.push(l);
    };
    const bodyText = scope.body.map(b => b.lines.join('\n')).join('\n');
    const fnText = scope.fns.map(f => f.src).join('\n');
    const typeText = [...scope.typeFns.values()].join('\n');
    const outText = (o.outs || []).join('\n');
    const libText = libFor([bodyText, fnText, typeText, o.passCode || '', outText].join('\n'));
    push(`// material-studio ${o.kind} pass: ${o.label || ''}`);
    push(`struct MsU {\n  h: vec4f,\n  o: vec4f,\n  p: array<vec4f, ${N}>,\n}`);
    push('@group(0) @binding(0) var<uniform> ms_u: MsU;');
    push('@group(0) @binding(1) var ms_samp: sampler;');
    scope.tex.forEach((t, i) => push(`@group(0) @binding(${i + 2}) var ms_t${i}: texture_2d<f32>;`));
    if (libText) push(libText);
    for (const [type, src] of scope.typeFns) push(src, [...scope.nodeIds].find(id => this.nodes.get(id)?.type === type));
    for (const f of scope.fns) push(f.src, f.nodeId);
    if (o.passCode) push(o.passCode, o.nodeId);
    push('@vertex\nfn ms_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {\n  let x = f32((i << 1u) & 2u);\n  let y = f32(i & 2u);\n  return vec4f((x * 2.0) - 1.0, 1.0 - (y * 2.0), 0.0, 1.0);\n}');
    const nOut = o.kind === 'node' ? 1 : o.outs.length;
    push(`struct MsOut {\n${Array.from({ length: nOut }, (_, i) => `  @location(${i}) c${i}: vec4f,`).join('\n')}\n}`);
    push('@fragment\nfn ms_fs(@builtin(position) fp: vec4f) -> MsOut {\n  let uv0 = (fp.xy - ms_u.o.xy) / ms_u.o.z;\n  let uv = uv0 * ms_u.h.z;\n  var mo: MsOut;');
    if (o.kind === 'node') push('  mo.c0 = pass_main(uv0);', o.nodeId);
    else {
      for (const b of scope.body) push(b.lines.join('\n'), b.nodeId);
      o.outs.forEach((e, i) => push(`  mo.c${i} = ${e};`, o.nodeId));
    }
    push('  return mo;\n}');
    const wgsl = lines.join('\n');
    const uniforms = new Float32Array(8 + N * 4);
    scope.uni.forEach((v, i) => uniforms.set(v, 8 + i * 4));
    const spec = {
      id: 'p' + this.seq++, kind: o.kind, nodeId: o.nodeId, outId: o.outId, label: o.label || o.kind,
      wgsl, hash: hashStr(wgsl), targets: o.targets, size: o.size || 0, slots: o.slots, type: o.type,
      uniforms, textures: scope.tex, lineMap, nodes: [...scope.nodeIds].map(id => this.origin.get(id) || id),
    };
    if (o.kind !== 'thumb') this.passes.push(spec);
    return spec;
  }

  // ---------------- run
  run() {
    this.flatten();
    this.index();
    let outId = this.src.output;
    if (!outId || !this.nodes.has(outId) || this.nodes.get(outId).type !== OUTPUT_TYPE) {
      const o = [...this.nodes.values()].find(n => n.type === OUTPUT_TYPE);
      outId = o ? o.id : null;
    }
    if (!outId) this.errors.push({ nodeId: null, message: 'the graph has no Material Output node' });
    const outs = [...this.nodes.values()].filter(n => n.type === OUTPUT_TYPE);
    if (outs.length > 1) for (const n of outs) if (n.id !== outId) this.err(n.id, 'only one Material Output is used');
    const roots = this.opts.prune ? (outId ? [outId] : []) : [...(outId ? [outId] : []), ...this.nodes.keys()];
    const order = this.order(roots);
    for (const id of order) {
      const d = this.def(id);
      if (d && d.pass) {
        try { this.makeNodePass(id); } catch (e) { this.err(id, 'compile failed: ' + e.message); }
      }
    }
    let outputs = {};
    if (outId) {
      try { outputs = this.makeOutPasses(outId).outputs; } catch (e) { this.err(outId, 'output compile failed: ' + e.message); }
    }
    const outNode = outId ? this.nodes.get(outId) : null;
    const outDef = this.reg.get(OUTPUT_TYPE);
    const scalars = { ...DEFAULT_SCALARS };
    if (outNode) {
      const v = this.values(outNode, outDef || { params: MATERIAL_PARAMS });
      for (const k of Object.keys(DEFAULT_SCALARS)) if (v[k] !== undefined) scalars[k] = typeof DEFAULT_SCALARS[k] === 'number' ? num(v[k]) : v[k];
      scalars.doubleSided = !!scalars.doubleSided;
    }
    const settings = { ...DEFAULT_SETTINGS, ...(this.src.settings || {}) };
    const self = this;
    return {
      passes: this.passes, outputs, scalars, errors: this.errors, order, output: outId, settings,
      nodeCount: this.nodes.size, origin: this.origin,
      hash: hashStr(this.passes.map(p => p.hash).join(',')),
      /** Build a thumbnail pass for a node output (macro ids resolve to their internals). */
      thumbSpec(nodeId, outId2) { return self.thumbSpec(nodeId, outId2); },
      thumbTargets() { return self.thumbTargets(); },
    };
  }

  /** Every node that can show a thumbnail: [{id, out}] (first output). */
  thumbTargets() {
    const list = [];
    for (const n of this.src.nodes || []) {
      if (n.type === OUTPUT_TYPE) continue;
      const d = this.reg.get(n.type);
      if (!d || !(d.outputs || []).length) continue;
      list.push({ id: n.id, out: d.outputs[0].id });
    }
    return list;
  }

  thumbSpec(nodeId, outId) {
    let id = nodeId, d0 = null;
    const orig = (this.src.nodes || []).find(n => n.id === nodeId);
    if (orig) d0 = this.reg.get(orig.type);
    if (!outId) outId = d0 && d0.outputs && d0.outputs[0] ? d0.outputs[0].id : null;
    if (!outId) return null;
    if (!this.nodes.has(id)) { const r = this.resolveOut(id, outId); if (!r) return null; [id, outId] = r; }
    const node = this.nodes.get(id), def = this.reg.get(node.type);
    if (!def) return null;
    const odef = (def.outputs || []).find(o => o.id === outId);
    if (!odef) return null;
    const scope = new Scope('thumb');
    let e;
    if (def.pass) {
      const p = this.passOf.get(id);
      if (!p) return null;
      e = this.sampleRef(scope, { kind: 'pass', pass: p.id }, odef, def, 'uv0');
    } else {
      const ref = this.texRefOf(id, def, odef, true);
      e = ref ? this.sampleRef(scope, ref, odef, def, 'uv0') : this.emitNode(scope, id)[outId];
      if (e === undefined) return null;
    }
    const dispType = odef.type;
    const spec = this.finishPass(scope, { kind: 'thumb', nodeId: id, label: 'thumb ' + nodeId, outs: [displayExpr(e, dispType)], targets: ['rgba8unorm'] });
    spec.thumbOf = nodeId;
    spec.id = 't:' + nodeId;
    return spec;
  }
}

// ------------------------------------------------------------ entry
/**
 * Compile contract Graph JSON into passes.
 * @param {import('./contract.js').Graph} graph   contract JSON (not the live graph)
 * @param {Map<string, import('./contract.js').NodeDef>} registry
 * @param {{prune?:boolean, maxMRT?:number}} [opts]
 *        prune: compile only the nodes that feed the output (export bakes).
 *        maxMRT: maps per output pass (bake.js sets it from device limits).
 * @returns {CompiledGraph}
 *
 * @typedef {Object} CompiledGraph
 * @property {PassSpec[]} passes  in run order
 * @property {Object<string,{pass:string,index:number}>} outputs  map name -> out pass target
 * @property {import('./contract.js').Scalars} scalars
 * @property {Array<{nodeId:string|null, message:string}>} errors
 * @property {string[]} order @property {string|null} output @property {object} settings
 * @property {string} hash  hash of every pass WGSL (topology and code, not uniforms)
 * @property {(nodeId:string, outId?:string)=>PassSpec|null} thumbSpec
 * @property {()=>Array<{id:string,out:string}>} thumbTargets
 *
 * @typedef {Object} PassSpec
 * @property {string} id  @property {'node'|'mat'|'out'|'thumb'} kind
 * @property {string} nodeId  @property {string} label
 * @property {string} wgsl  @property {string} hash
 * @property {string[]} targets  'inter' (intermediate), 'map' (rgba16float + mips), or a format
 * @property {number} size  0 = bake resolution
 * @property {Float32Array} uniforms  slots 0..7 are the header bake fills
 * @property {Array<{kind:'pass',pass:string}|{kind:'const',value:number[]}|{kind:'image',nodeId:string,paramId:string,value:any,srgb:boolean}>} textures
 * @property {Array<{line:number,nodeId:string}>} lineMap
 * @property {boolean} [external]  NodeDef.pass.run pass: no WGSL; bake calls run(job)
 * @property {Object<string,number|null>} [inputs]  external only: inputId -> textures index
 * @property {Object<string,*>} [values]  external only: the node param values with defaults
 */
export function compileGraph(graph, registry, opts = {}) {
  if (!lib) throw new Error('compile.js: call loadLib() (init) before compileGraph');
  return new Compiler(graph, registry, opts).run();
}

/**
 * Await the lazy loaders of every def the graph uses: NodeDef.pass.load()
 * or NodeDef.load() (bench nodes fetch their library WGSL on first use).
 * Call it before compileGraph; compileGraph itself is synchronous.
 * @returns {Promise<Array<{nodeId:string, message:string}>>} load errors
 */
export async function prepareGraph(graph, registry) {
  const errors = [], seen = new Map();
  for (const n of (graph && graph.nodes) || []) {
    const d = registry.get(n.type);
    if (!d) continue;
    const fn = (d.pass && typeof d.pass.load === 'function' && d.pass.load) || (typeof d.load === 'function' && d.load);
    if (!fn) continue;
    if (!seen.has(n.type)) seen.set(n.type, Promise.resolve().then(() => fn.call(d.pass || d)).then(() => null, e => e));
    const e = await seen.get(n.type);
    if (e) errors.push({ nodeId: n.id, message: `load failed: ${e.message || e}` });
  }
  return errors;
}

/** Map a WGSL line number of a pass to the node whose code holds it. */
export function lineToNode(spec, line) {
  let best = null;
  for (const m of spec.lineMap || []) if (m.line <= line) best = m.nodeId;
  return best || spec.nodeId || null;
}

/** Contract Graph JSON from the live graph (graph.js serialize when present). */
export function graphJSON(state, modules) {
  const g = state.graph;
  if (!g) return null;
  try {
    if (modules && modules.graph && typeof modules.graph.serialize === 'function') {
      const j = modules.graph.serialize(g);
      return typeof j === 'string' ? JSON.parse(j) : j;
    }
  } catch (e) { console.warn('[compile] serialize failed, using the live graph', e); }
  return g;
}

// ------------------------------------------------------------ self test
/** Compile every registry type alone (JS side only; bake.selfTest runs the GPU). */
export function selfTestCompile(registry) {
  const fail = [];
  let n = 0;
  for (const [type, d] of registry) {
    if (type === OUTPUT_TYPE || !(d.outputs || []).length) continue;
    n++;
    const g = testGraph(type, d, false);
    try {
      const c = compileGraph(g, registry, { prune: true });
      if (c.errors.length) fail.push({ type, errors: c.errors.map(e => e.message) });
    } catch (e) { fail.push({ type, errors: [e.message] }); }
  }
  return { types: n, failed: fail.length, failures: fail.slice(0, 20) };
}

/** A small graph that wires `type` into the Material Output. chain=true also
 *  feeds every input from upstream nodes and adds a downstream expr and pass. */
export function testGraph(type, d, chain) {
  const out = d.outputs[0];
  const slot = out.type === 'normal' ? 'normal' : out.type === 'float' ? 'height' : 'baseColor';
  const nodes = [{ id: 'out', type: OUTPUT_TYPE, x: 600, y: 0, params: {} }, { id: 't', type, x: 300, y: 0, params: {} }];
  const links = [];
  if (!chain) {
    links.push({ from: ['t', out.id], to: ['out', slot] });
  } else {
    nodes.push({ id: 'g', type: 'noise.perlin', x: 0, y: 0, params: { scale: 4 } });
    nodes.push({ id: 'u', type: 'uv.transform', x: 0, y: 100, params: { rotation: 15 } });
    nodes.push({ id: 'hn', type: 'hn.heightToNormal', x: 0, y: 200, params: {} });
    links.push({ from: ['g', 'out'], to: ['hn', 'height'] });
    for (const inp of d.inputs || []) {
      if (inp.type === 'vec2') links.push({ from: ['u', 'uv'], to: ['t', inp.id] });
      else if (inp.type === 'normal') links.push({ from: ['hn', 'normal'], to: ['t', inp.id] });
      else links.push({ from: ['g', 'out'], to: ['t', inp.id] });
    }
    nodes.push({ id: 'm', type: 'math.add', x: 450, y: 0, params: { vb: 0.1 } });
    nodes.push({ id: 'b', type: 'filter.gaussian1d', x: 450, y: 100, params: { radius: 0.004 } });
    links.push({ from: ['t', out.id], to: ['m', 'a'] });
    links.push({ from: ['t', out.id], to: ['b', 'in'] });
    links.push({ from: ['m', 'out'], to: ['out', 'roughness'] });
    links.push({ from: ['b', 'out'], to: ['out', 'emissive'] });
    links.push({ from: ['t', out.id], to: ['out', slot] });
  }
  return { version: 1, nodes, links, frames: [], output: 'out', settings: { res: 256, tiling: 1, seed: 0 } };
}

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  await loadLib();
  ctx.register('compile', {
    compileGraph, prepareGraph, lineToNode, hashStr, libFor, testGraph,
    get libItems() { return lib ? lib.order.length : 0; },
    /** Compile the live graph now and return the result (no GPU). */
    compileNow(opts) { return compileGraph(graphJSON(ctx.store.state, ctx.modules), ctx.store.state.registry, opts); },
    selfTest: () => selfTestCompile(ctx.store.state.registry),
  });
}
