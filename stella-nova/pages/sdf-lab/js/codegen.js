// ============================================================================
//  SDF FORGE  ·  codegen.js — the document compiled to WGSL, GLSL and JS
// ----------------------------------------------------------------------------
//  PURE. One emitter walks the node tree and writes the same field in three
//  dialects, so the GPU shader, the exported GLSL and the CPU field (picking,
//  the SLICE probe, marching cubes) have one structure and one operation order.
//
//  STRUCTURE AND PARAMETERS ARE SEPARATE. The code depends only on the
//  STRUCTURE of the document: which nodes, their kinds and order, the group
//  operators, the smooth flags, the modifier types and order, hidden flags.
//  Every number (transforms, sizes, k, modifier amounts, materials) lives in
//  the parameter buffer P, an array of vec4. A drag writes P and the shader
//  stays; a structure change rebuilds the shader. layout.sig is the key.
//
//  THE BUFFER  (slots are vec4; b is the node base, see buildLayout)
//    b+0  position xyz, min(scale)       the distance is multiplied by w
//    b+1  row 0 of S^-1 R^T  ┐
//    b+2  row 1              ├ world-to-local: q = L (p - position)
//    b+3  row 2              ┘
//    b+4  shape params (prim) or (k, 0, 0, 0) (group)
//    b+5  reserved
//    b+6  colour rgb, roughness
//    b+7  metal, ord (the pick id), 0, 0
//    b+8+j   modifier j params
//
//  MODIFIER ORDER. The stack is listed bottom first, like Max: modifier 0
//  acts on the shape, modifier 1 acts on that result, and so on. A domain
//  modifier warps the point before what is below it; a distance modifier
//  changes the distance after. So the point goes through the domain warps
//  from the TOP of the stack down, the shape is evaluated, and the distance
//  goes through the distance modifiers from the BOTTOM up. Each distance
//  modifier sees the point at its own level (displace needs it).
//
//  GREP MAP
//    buildLayout ........ ids to slots, pick ords, ranges, the structure sig
//    packParams ......... the document into a Float32Array (matches the table)
//    lipschitz .......... the step factor that keeps warps safe
//    emit ............... the tree walk (dialects: WGSL, GLSL, JS)
//    WGSL_LIB / GLSL_LIB  the shape, modifier and operator library
//    genWGSL / genGLSL / genJS   the three outputs
//
//  Distance functions, the smooth minimum and the smooth subtract and
//  intersect after Inigo Quilez (iquilezles.org). All code original.
// ============================================================================
import * as D from './doc.js';
import * as M from './math.js';

export const NODE_SLOTS = 8;
const PRIM_FN = { sphere: 'sdSphere', box: 'sdBox', roundbox: 'sdRoundBox', cylinder: 'sdCylinder', cone: 'sdCone', torus: 'sdTorus', plane: 'sdPlane', capsule: 'sdCapsule', octa: 'sdOcta', link: 'sdLink', hexprism: 'sdHex', ellipsoid: 'sdEllipsoid' };
const MOD_FN = { round: 'dRound', onion: 'dOnion', displace: 'dDisplace', twist: 'wTwist', bend: 'wBend', elongate: 'wElong', repeat: 'wRepeat', mirror: 'wMirror' };

// ── layout ──────────────────────────────────────────────────────────────────
export function buildLayout(doc) {
  const order = [], base = {}, ord = {}, range = {}, sigs = [];
  let s = 0;
  const visit = (id, depth) => {
    const n = doc.nodes[id];
    if (!n || n.hidden) return;
    ord[id] = order.length; order.push(id); base[id] = s;
    s += NODE_SLOTS + n.mods.length;
    const mods = n.mods.map(m => m.on ? m.type : '-').join(',');
    sigs.push(`${depth}:${n.kind === 'group' ? `${n.op}${n.smooth ? '~' : ''}` : n.type}[${mods}]`);
    if (n.kind === 'group') n.children.forEach(c => visit(c, depth + 1));
    range[id] = [ord[id], order.length - 1];
  };
  doc.roots.forEach(r => visit(r, 0));
  return { order, base, ord, range, size: Math.max(s, 1), sig: sigs.join(' ') };
}

// ── parameters ──────────────────────────────────────────────────────────────
export function packParams(doc, L, out) {
  const P = out && out.length >= L.size * 4 ? out : new Float32Array(Math.max(L.size, 1) * 4);
  for (const id of L.order) {
    const n = doc.nodes[id], o = L.base[id] * 4;
    const R = M.eulerToM3(n.rot), s = n.scl;
    P[o] = n.pos[0]; P[o + 1] = n.pos[1]; P[o + 2] = n.pos[2]; P[o + 3] = Math.min(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]));
    for (let i = 0; i < 3; i++) {   // row i of S^-1 R^T = column i of R, over s_i
      const si = s[i] || 1e-6;
      P[o + 4 + i * 4] = R[i * 3] / si; P[o + 5 + i * 4] = R[i * 3 + 1] / si; P[o + 6 + i * 4] = R[i * 3 + 2] / si; P[o + 7 + i * 4] = 0;
    }
    const pv = n.kind === 'group' ? [n.p.k, 0, 0, 0] : D.PRIMS[n.type].params.map(r => n.p[r[0]]);
    for (let i = 0; i < 8; i++) P[o + 16 + i] = pv[i] ?? 0;
    const mat = n.mat || D.MAT_DEFAULT();
    P[o + 24] = mat.color[0]; P[o + 25] = mat.color[1]; P[o + 26] = mat.color[2]; P[o + 27] = mat.rough;
    P[o + 28] = mat.metal; P[o + 29] = L.ord[id]; P[o + 30] = 0; P[o + 31] = 0;
    n.mods.forEach((m, j) => {
      const q = o + (NODE_SLOTS + j) * 4, vals = D.MODS[m.type].params.map(r => m.p[r[0]]);
      for (let i = 0; i < 4; i++) P[q + i] = vals[i] ?? 0;
    });
  }
  return P;
}

// The largest gradient a warp can add. Sphere tracing steps by d / L, so the
// march stays safe through a twist, a bend or a displacement (Hart 1996).
export function lipschitz(doc) {
  let worst = 1;
  const visit = (id, acc) => {
    const n = doc.nodes[id];
    if (!n || n.hidden) return;
    let f = acc;
    const b = D.localBounds(doc, id);
    for (const m of n.mods) {
      if (!m.on) continue;
      const p = m.p;
      if (m.type === 'twist' && b) f *= Math.hypot(1, p.k * Math.hypot(Math.max(-b.lo[0], b.hi[0]), Math.max(-b.lo[2], b.hi[2])));
      if (m.type === 'bend' && b) f *= Math.hypot(1, p.k * Math.hypot(Math.max(-b.lo[0], b.hi[0]), Math.max(-b.lo[1], b.hi[1])));
      if (m.type === 'displace') f *= 1 + Math.abs(p.a) * p.f * 3;
    }
    worst = Math.max(worst, f);
    if (n.kind === 'group') n.children.forEach(c => visit(c, f));
  };
  doc.roots.forEach(r => visit(r, 1));
  return Math.min(worst, 6);
}

// ── dialects ────────────────────────────────────────────────────────────────
// slots(i, n): the arguments that hand slots i..i+n-1 to a library function
// comp(i, c): one float of slot i
function dialect(name, P) {
  const lit = x => { const v = Number.isFinite(x) ? x : 0; const s = String(+v.toPrecision(7)); return /[.e]/.test(s) ? s : s + '.0'; };
  const vec = (i, ty) => `${ty}(${[0, 1, 2, 3].map(c => lit(P[i * 4 + c])).join(', ')})`;
  if (name === 'js') return {
    name, slots: (i) => `P, ${i * 4}`, comp: (i, c) => `P[${i * 4 + c}]`,
    fnD: (n, body) => `function ${n}(p) {\n${body}}\n`, fnM: (n, body) => `function ${n}(p) {\n${body}}\n`,
    let3: (n, e) => `  const ${n} = ${e};\n`, varF: (n, e) => `  let ${n} = ${e};\n`, varS: (n, e) => `  let ${n} = ${e};\n`,
    num: lit, big: '1e9',
  };
  const gl = name.startsWith('glsl'), baked = name.endsWith('baked');
  const v4 = gl ? 'vec4' : 'vec4f';
  return {
    name, gl,
    slots: (i, n) => Array.from({ length: n }, (_, k) => baked ? vec(i + k, v4) : `P[${i + k}]`).join(', '),
    comp: (i, c) => baked ? lit(P[i * 4 + c]) : `P[${i}].${'xyzw'[c]}`,
    fnD: (n, body) => gl ? `float ${n}(vec3 p) {\n${body}}\n` : `fn ${n}(p: vec3f) -> f32 {\n${body}}\n`,
    fnM: (n, body) => `fn ${n}(p: vec3f) -> Sd {\n${body}}\n`,
    let3: (n, e) => gl ? `  vec3 ${n} = ${e};\n` : `  let ${n} = ${e};\n`,
    varF: (n, e) => gl ? `  float ${n} = ${e};\n` : `  var ${n} = ${e};\n`,
    varS: (n, e) => `  var ${n} = ${e};\n`,
    num: lit, big: '1e9',
  };
}

// ── the tree walk ───────────────────────────────────────────────────────────
// mode 'd' writes distance-only functions d_<ord>; mode 'm' writes material
// functions m_<ord> that return an Sd record (distance, colour, pick id).
function emitNode(doc, L, X, id, mode) {
  const n = doc.nodes[id], b = L.base[id], tag = L.ord[id];
  const pre = mode === 'd' ? 'd_' : 'm_';
  let s = '';
  const mods = n.mods.map((m, j) => ({ m, j })).filter(o => o.m.on);
  const K = mods.length;
  // the local point, then the domain warps from the top of the stack down
  s += X.let3(`q${K}`, `xf(p, ${X.slots(b, 4)})`);
  for (let i = K; i >= 1; i--) {
    const { m, j } = mods[i - 1];
    const e = D.MODS[m.type].kind === 'domain' ? `${MOD_FN[m.type]}(q${i}, ${X.slots(b + NODE_SLOTS + j, 1)})` : `q${i}`;
    s += X.let3(`q${i - 1}`, e);
  }
  // the shape below the stack
  const v = mode === 'd' ? 'd' : 's';
  const ref = mode === 'd' ? 'd' : 's.d';
  if (n.kind === 'prim') {
    const shape = `${PRIM_FN[n.type]}(q0, ${X.slots(b + 4, 1)})`;
    if (mode === 'd') s += X.varF('d', shape);
    else s += X.varS('s', X.name === 'js' ? `sdm(${shape}, P, ${(b + 6) * 4})` : `sdm(${shape}, ${X.slots(b + 6, 2)})`);
  } else {
    const kids = n.children.filter(c => L.ord[c] !== undefined);
    if (!kids.length) {
      if (mode === 'd') s += X.varF('d', X.big);
      else s += X.varS('s', X.name === 'js' ? `sdm(1e9, P, ${(b + 6) * 4})` : `sdm(${X.big}, ${X.slots(b + 6, 2)})`);
    } else {
      s += mode === 'd' ? X.varF('d', `${pre}${L.ord[kids[0]]}(q0)`) : X.varS('s', `${pre}${L.ord[kids[0]]}(q0)`);
      const k = X.comp(b + 4, 0);
      const op = { union: 'U', subtract: 'S', intersect: 'I' }[n.op];
      for (const c of kids.slice(1)) {
        const call = `${pre}${L.ord[c]}(q0)`;
        const fn = mode === 'd' ? (n.smooth ? `sm${op}` : `op${op}`) : (n.smooth ? `ms${op}` : `mo${op}`);
        s += `  ${v} = ${fn}(${v}, ${call}${n.smooth ? ', ' + k : ''});\n`;
      }
    }
  }
  // the distance modifiers from the bottom up, each at its own level
  for (let i = 1; i <= K; i++) {
    const { m, j } = mods[i - 1];
    if (D.MODS[m.type].kind !== 'dist') continue;
    s += `  ${ref} = ${MOD_FN[m.type]}(${ref}, q${i}, ${X.slots(b + NODE_SLOTS + j, 1)});\n`;
  }
  s += `  ${ref} = ${ref} * ${X.comp(b, 3)};\n`;
  s += `  return ${v};\n`;
  void tag;
  return mode === 'd' ? X.fnD(pre + L.ord[id], s) : X.fnM(pre + L.ord[id], s);
}

function emitAll(doc, L, X, withM) {
  let out = '';
  // children before parents: emit in reverse depth-first order (WGSL and GLSL
  // need a function declared before use only in GLSL; reverse order serves both)
  const ids = L.order.slice().reverse();
  for (const id of ids) out += emitNode(doc, L, X, id, 'd');
  if (withM) for (const id of ids) out += emitNode(doc, L, X, id, 'm');
  const roots = doc.roots.filter(r => L.ord[r] !== undefined);
  // the root: a hard union of the top-level nodes
  let body = X.varF('d', X.big);
  for (const r of roots) body += `  d = min(d, d_${L.ord[r]}(p));\n`;
  body += '  return d;\n';
  out += X.fnD('mapD', body);
  if (withM) {
    let mb = X.varS('s', X.name === 'js' ? 'sdNone()' : 'Sd(1e9, vec3f(0.6), 0.5, 0.0, -1.0)');
    for (const r of roots) mb += `  s = moU(s, m_${L.ord[r]}(p));\n`;
    mb += '  return s;\n';
    out += X.fnM('mapM', mb);
    out += emitGhost(doc, L, X);
  }
  return out;
}

// ghostD(p, ord): one node alone, in world space through its parents'
// transforms (not their modifiers). The viewport draws a selected cutter with
// it, so a shape that a subtract hides can still be seen and grabbed.
function emitGhost(doc, L, X) {
  const cases = [];
  for (const id of L.order) {
    const chain = [];
    let p = D.parentOf(doc, id);
    while (p) { chain.unshift(p.id); p = D.parentOf(doc, p.id); }
    if (!chain.length) continue;   // a root node is drawn by mapD already
    let e = 'p', sc = [];
    for (const c of chain) { e = `xf(${e}, ${X.slots(L.base[c], 4)})`; sc.push(X.comp(L.base[c], 3)); }
    const expr = `d_${L.ord[id]}(${e}) * ${sc.join(' * ')}`;
    cases.push([L.ord[id], expr]);
  }
  if (X.name === 'js') {
    let s = 'function ghostD(p, w) {\n  switch (w) {\n';
    for (const [o, e] of cases) s += `    case ${o}: return ${e};\n`;
    return s + '  }\n  return 1e9;\n}\n';
  }
  let s = 'fn ghostD(p: vec3f, w: i32) -> f32 {\n  switch w {\n';
  for (const [o, e] of cases) s += `    case ${o}: { return ${e}; }\n`;
  return s + '    default: { return 1e9; }\n  }\n}\n';
}

// ── the WGSL library ────────────────────────────────────────────────────────
export const WGSL_LIB = /* wgsl */`
fn xf(p: vec3f, t: vec4f, r0: vec4f, r1: vec4f, r2: vec4f) -> vec3f {
  let q = p - t.xyz;
  return vec3f(dot(r0.xyz, q), dot(r1.xyz, q), dot(r2.xyz, q));
}
fn boxD(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
fn dot2(v: vec2f) -> f32 { return dot(v, v); }
fn sdSphere(p: vec3f, a: vec4f) -> f32 { return length(p) - a.x; }
fn sdBox(p: vec3f, a: vec4f) -> f32 { return boxD(p, a.xyz * 0.5); }
fn sdRoundBox(p: vec3f, a: vec4f) -> f32 {
  let r = clamp(a.w, 0.0, min(a.x, min(a.y, a.z)) * 0.5);
  return boxD(p, a.xyz * 0.5 - vec3f(r)) - r;
}
fn sdCylinder(p: vec3f, a: vec4f) -> f32 {
  let d = abs(vec2f(length(p.xz), p.y)) - vec2f(a.x, a.y * 0.5);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}
fn sdCone(p: vec3f, a: vec4f) -> f32 {
  let h = a.z * 0.5; let r1 = a.x; let r2 = a.y;
  let q = vec2f(length(p.xz), p.y);
  let k1 = vec2f(r2, h);
  let k2 = vec2f(r2 - r1, 2.0 * h);
  let ca = vec2f(q.x - min(q.x, select(r2, r1, q.y < 0.0)), abs(q.y) - h);
  let cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot2(k2), 0.0, 1.0);
  let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
  return s * sqrt(min(dot2(ca), dot2(cb)));
}
fn sdTorus(p: vec3f, a: vec4f) -> f32 { return length(vec2f(length(p.xz) - a.x, p.y)) - a.y; }
fn sdPlane(p: vec3f, a: vec4f) -> f32 { return p.y; }
fn sdCapsule(p: vec3f, a: vec4f) -> f32 {
  let h = a.y * 0.5;
  return length(vec3f(p.x, p.y - clamp(p.y, -h, h), p.z)) - a.x;
}
fn sdOcta(p0: vec3f, a: vec4f) -> f32 {
  let s = a.x; let p = abs(p0);
  let m = p.x + p.y + p.z - s;
  var q = p;
  if (3.0 * p.x < m) { q = p.xyz; }
  else if (3.0 * p.y < m) { q = p.yzx; }
  else if (3.0 * p.z < m) { q = p.zxy; }
  else { return m * 0.57735027; }
  let k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
  return length(vec3f(q.x, q.y - s + k, q.z - k));
}
fn sdLink(p: vec3f, a: vec4f) -> f32 {
  let q = vec3f(p.x, max(abs(p.y) - a.x, 0.0), p.z);
  return length(vec2f(length(q.xy) - a.y, q.z)) - a.z;
}
fn sdHex(p0: vec3f, a: vec4f) -> f32 {
  let k = vec3f(-0.8660254, 0.5, 0.57735);
  var p = abs(vec3f(p0.x, p0.z, p0.y));
  let xy = p.xy - 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  p = vec3f(xy, p.z);
  let hx = a.x;
  let d = vec2f(length(p.xy - vec2f(clamp(p.x, -k.z * hx, k.z * hx), hx)) * sign(p.y - hx), p.z - a.y * 0.5);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}
fn sdEllipsoid(p: vec3f, a: vec4f) -> f32 {
  let r = a.xyz;
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return select(-min(r.x, min(r.y, r.z)), k0 * (k0 - 1.0) / k1, k1 > 1e-9);
}
fn wTwist(p: vec3f, a: vec4f) -> vec3f {
  let c = cos(a.x * p.y); let s = sin(a.x * p.y);
  return vec3f(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}
fn wBend(p: vec3f, a: vec4f) -> vec3f {
  let c = cos(a.x * p.x); let s = sin(a.x * p.x);
  return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}
fn wElong(p: vec3f, a: vec4f) -> vec3f { return p - clamp(p, -a.xyz, a.xyz); }
fn wRepeat(p: vec3f, a: vec4f) -> vec3f {
  let s = a.x; let n = floor(a.yzw + 0.5);
  return p - s * clamp(floor(p / s + 0.5), -n, n);
}
fn wMirror(p: vec3f, a: vec4f) -> vec3f { return mix(p, abs(p) - vec3f(a.w), step(vec3f(0.5), a.xyz)); }
fn hash3(i: vec3i) -> f32 {
  var h = (u32(i.x) * 0x8da6b343u) ^ (u32(i.y) * 0xd8163841u) ^ (u32(i.z) * 0xcb1ab31fu);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h = h ^ (h >> 15u);
  return f32(h & 0xffffffu) * (2.0 / 16777215.0) - 1.0;
}
fn vnoise(p: vec3f) -> f32 {
  let fl = floor(p); let i = vec3i(fl); let f = p - fl;
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(hash3(i), hash3(i + vec3i(1, 0, 0)), u.x);
  let b = mix(hash3(i + vec3i(0, 1, 0)), hash3(i + vec3i(1, 1, 0)), u.x);
  let c = mix(hash3(i + vec3i(0, 0, 1)), hash3(i + vec3i(1, 0, 1)), u.x);
  let d = mix(hash3(i + vec3i(0, 1, 1)), hash3(i + vec3i(1, 1, 1)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
fn dRound(d: f32, p: vec3f, a: vec4f) -> f32 { return d - a.x; }
fn dOnion(d: f32, p: vec3f, a: vec4f) -> f32 { return abs(d) - a.x; }
fn dDisplace(d: f32, p: vec3f, a: vec4f) -> f32 { return d + a.x * vnoise(p * a.y); }
fn opU(a: f32, b: f32) -> f32 { return min(a, b); }
fn opS(a: f32, b: f32) -> f32 { return max(a, -b); }
fn opI(a: f32, b: f32) -> f32 { return max(a, b); }
fn smU(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
fn smS(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 - 0.5 * (a + b) / k, 0.0, 1.0); return mix(a, -b, h) + k * h * (1.0 - h); }
fn smI(a: f32, b: f32, k: f32) -> f32 { let h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
`;

// The material record and its operators: the renderer and the CPU field only.
export const WGSL_MAT_LIB = /* wgsl */`
struct Sd { d: f32, c: vec3f, r: f32, mt: f32, id: f32 };
fn sdm(d: f32, a: vec4f, b: vec4f) -> Sd { return Sd(d, a.xyz, a.w, b.x, b.y); }
fn moU(a: Sd, b: Sd) -> Sd { if (b.d < a.d) { return b; } return a; }
fn moS(a: Sd, b: Sd) -> Sd { var r = a; r.d = max(a.d, -b.d); return r; }
fn moI(a: Sd, b: Sd) -> Sd { if (b.d > a.d) { return b; } return a; }
fn msU(a: Sd, b: Sd, k: f32) -> Sd {
  let h = clamp(0.5 + 0.5 * (b.d - a.d) / k, 0.0, 1.0);
  return Sd(mix(b.d, a.d, h) - k * h * (1.0 - h), mix(b.c, a.c, h), mix(b.r, a.r, h), mix(b.mt, a.mt, h), select(b.id, a.id, h > 0.5));
}
fn msS(a: Sd, b: Sd, k: f32) -> Sd {
  let h = clamp(0.5 - 0.5 * (a.d + b.d) / k, 0.0, 1.0);
  var r = a; r.d = mix(a.d, -b.d, h) + k * h * (1.0 - h); return r;
}
fn msI(a: Sd, b: Sd, k: f32) -> Sd {
  let h = clamp(0.5 - 0.5 * (b.d - a.d) / k, 0.0, 1.0);
  return Sd(mix(b.d, a.d, h) + k * h * (1.0 - h), mix(b.c, a.c, h), mix(b.r, a.r, h), mix(b.mt, a.mt, h), select(b.id, a.id, h > 0.5));
}
`;

// ── the GLSL library (distance only, for export) ────────────────────────────
export const GLSL_LIB = /* glsl */`
vec3 xf(vec3 p, vec4 t, vec4 r0, vec4 r1, vec4 r2) {
  vec3 q = p - t.xyz;
  return vec3(dot(r0.xyz, q), dot(r1.xyz, q), dot(r2.xyz, q));
}
float boxD(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0); }
float dot2(vec2 v) { return dot(v, v); }
float sdSphere(vec3 p, vec4 a) { return length(p) - a.x; }
float sdBox(vec3 p, vec4 a) { return boxD(p, a.xyz * 0.5); }
float sdRoundBox(vec3 p, vec4 a) { float r = clamp(a.w, 0.0, min(a.x, min(a.y, a.z)) * 0.5); return boxD(p, a.xyz * 0.5 - vec3(r)) - r; }
float sdCylinder(vec3 p, vec4 a) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(a.x, a.y * 0.5); return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0))); }
float sdCone(vec3 p, vec4 a) {
  float h = a.z * 0.5; float r1 = a.x; float r2 = a.y;
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h); vec2 k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, q.y < 0.0 ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot2(k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot2(ca), dot2(cb)));
}
float sdTorus(vec3 p, vec4 a) { return length(vec2(length(p.xz) - a.x, p.y)) - a.y; }
float sdPlane(vec3 p, vec4 a) { return p.y; }
float sdCapsule(vec3 p, vec4 a) { float h = a.y * 0.5; return length(vec3(p.x, p.y - clamp(p.y, -h, h), p.z)) - a.x; }
float sdOcta(vec3 p0, vec4 a) {
  float s = a.x; vec3 p = abs(p0); float m = p.x + p.y + p.z - s; vec3 q;
  if (3.0 * p.x < m) q = p.xyz; else if (3.0 * p.y < m) q = p.yzx; else if (3.0 * p.z < m) q = p.zxy; else return m * 0.57735027;
  float k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
  return length(vec3(q.x, q.y - s + k, q.z - k));
}
float sdLink(vec3 p, vec4 a) { vec3 q = vec3(p.x, max(abs(p.y) - a.x, 0.0), p.z); return length(vec2(length(q.xy) - a.y, q.z)) - a.z; }
float sdHex(vec3 p0, vec4 a) {
  vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  vec3 p = abs(vec3(p0.x, p0.z, p0.y));
  p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  float hx = a.x;
  vec2 d = vec2(length(p.xy - vec2(clamp(p.x, -k.z * hx, k.z * hx), hx)) * sign(p.y - hx), p.z - a.y * 0.5);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)));
}
float sdEllipsoid(vec3 p, vec4 a) { vec3 r = a.xyz; float k0 = length(p / r); float k1 = length(p / (r * r)); return k1 > 1e-9 ? k0 * (k0 - 1.0) / k1 : -min(r.x, min(r.y, r.z)); }
vec3 wTwist(vec3 p, vec4 a) { float c = cos(a.x * p.y); float s = sin(a.x * p.y); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
vec3 wBend(vec3 p, vec4 a) { float c = cos(a.x * p.x); float s = sin(a.x * p.x); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
vec3 wElong(vec3 p, vec4 a) { return p - clamp(p, -a.xyz, a.xyz); }
vec3 wRepeat(vec3 p, vec4 a) { float s = a.x; vec3 n = floor(a.yzw + 0.5); return p - s * clamp(floor(p / s + 0.5), -n, n); }
vec3 wMirror(vec3 p, vec4 a) { return mix(p, abs(p) - vec3(a.w), step(vec3(0.5), a.xyz)); }
float hash3(ivec3 i) {
  uint h = (uint(i.x) * 0x8da6b343u) ^ (uint(i.y) * 0xd8163841u) ^ (uint(i.z) * 0xcb1ab31fu);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h = h ^ (h >> 15u);
  return float(h & 0xffffffu) * (2.0 / 16777215.0) - 1.0;
}
float vnoise(vec3 p) {
  vec3 fl = floor(p); ivec3 i = ivec3(fl); vec3 f = p - fl; vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash3(i), hash3(i + ivec3(1, 0, 0)), u.x);
  float b = mix(hash3(i + ivec3(0, 1, 0)), hash3(i + ivec3(1, 1, 0)), u.x);
  float c = mix(hash3(i + ivec3(0, 0, 1)), hash3(i + ivec3(1, 0, 1)), u.x);
  float d = mix(hash3(i + ivec3(0, 1, 1)), hash3(i + ivec3(1, 1, 1)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float dRound(float d, vec3 p, vec4 a) { return d - a.x; }
float dOnion(float d, vec3 p, vec4 a) { return abs(d) - a.x; }
float dDisplace(float d, vec3 p, vec4 a) { return d + a.x * vnoise(p * a.y); }
float opU(float a, float b) { return min(a, b); }
float opS(float a, float b) { return max(a, -b); }
float opI(float a, float b) { return max(a, b); }
float smU(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float smS(float a, float b, float k) { float h = clamp(0.5 - 0.5 * (a + b) / k, 0.0, 1.0); return mix(a, -b, h) + k * h * (1.0 - h); }
float smI(float a, float b, float k) { float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
`;

// ── outputs ─────────────────────────────────────────────────────────────────
const HEAD = (what) => `// SDF Forge ${what}. Generated code. Distance functions and smooth operators\n// after Inigo Quilez; sphere tracing after Hart 1996.\n`;
// The field for the renderer: P is a storage buffer the caller binds.
export function genWGSL(doc, L) {
  const X = dialect('wgsl', null);
  return `@group(0) @binding(1) var<storage, read> P: array<vec4f>;\n${WGSL_LIB}${WGSL_MAT_LIB}\n${emitAll(doc, L, X, true)}`;
}
// A standalone field with the numbers written in: fn mapD(p: vec3f) -> f32.
export function genWGSLBaked(doc, L, P) {
  const X = dialect('wgsl-baked', P);
  return HEAD('WGSL export') + WGSL_LIB + '\n' + emitAll(doc, L, X, false);
}
export function genGLSL(doc, L, P) {
  const X = dialect('glsl-baked', P);
  return HEAD('GLSL export') + GLSL_LIB + '\n' + emitAll(doc, L, X, false);
}
// The CPU field: source text for new Function('P', 'H', src).
export function genJS(doc, L) {
  const X = dialect('js', null);
  return `const min = Math.min;\nconst {xf, sdm, sdNone, ${Object.values(PRIM_FN).join(', ')}, ${Object.values(MOD_FN).join(', ')}, opU, opS, opI, smU, smS, smI, moU, moS, moI, msU, msS, msI} = H;\n`
    + emitAll(doc, L, X, true) + 'return { mapD, mapM, ghostD };\n';
}
