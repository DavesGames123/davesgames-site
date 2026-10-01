// ============================================================================
//  MATERIAL STUDIO  ·  nodes/bench/fallback.js — contract fallback: a fused pass_main
// ────────────────────────────────────────────────────────────────────────────
//  def.pass.wgsl: the WGSL of a non-sim cell as one pass_main(uv) for the
//  graph compiler. The cell bindings become var<private> structs filled
//  with literals. Sim cells throw, because they need def.pass.run.
//
//  GREP TARGETS  (grep -n the name to jump)
//      lit / parseStruct / uniformCtor
//      RE_UBIND / RE_FRAG / fallbackWGSL
// ============================================================================
import { BENCH_UBYTES } from '../../../../lib/bench-wgsl.js';
import { CAT } from './catalog.js';
import { withDefaults, nodeOf, paletteOf } from './values.js';
import { RE_IN } from './cell-wgsl.js';
import { FRAME_STRUCT, FRAME_FNS, tiledStatic, frameUniform } from './frame-wgsl.js';

// The contract path: one pass_main(uv) that inlines the cell. The binding
// declarations of the bench go: the uniform u and the wiring flags b become
// var<private> structs that pass_main fills with literals; in0/in1 reads go
// to the compiler's texture bindings (ctx.tex) or to a black constant.
export const lit = x => { x = +x; if (!Number.isFinite(x)) return '0.0'; const s = String(Math.fround(x)); return /[.eE]/.test(s) ? s : s + '.0'; };
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
