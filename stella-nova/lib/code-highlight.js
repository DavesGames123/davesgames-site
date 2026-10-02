// ============================================================================
//  CODE HIGHLIGHT  ·  lib/code-highlight.js — syntax colour for short listings
// ----------------------------------------------------------------------------
//  highlight(src, lang) returns HTML: each token is in a <span> with a tk-*
//  class, and all other text is escaped. The caller supplies the colours.
//  One regular expression per language splits the source into comment,
//  string, attribute, number, identifier, swizzle, operator and other text.
//  The identifier arm sorts each word into keyword, type, built-in, constant,
//  function call (a word before "(") or plain name.
//
//  Languages (lang is matched loosely, case does not matter):
//    wgsl     "wgsl"                      @attributes, vec3f, textureSample
//    glsl     "glsl", "frag", "vert"      #version and #define lines
//    js       "js", "javascript", "ts"    strings in ' " `
//    python   "py", "python", "qiskit"    # comments, decorators
//    pseudo   "pseudo", "algorithm", and anything else: keywords such as
//             for each, while, if then else, return; arrows and set symbols
//             as operators
//
//  Token classes:
//    tk-cm comment   tk-st string    tk-num number   tk-at attribute
//    tk-kw keyword   tk-ty type      tk-bi built-in  tk-con constant
//    tk-fn call      tk-sw swizzle   tk-op operator  tk-pp preprocessor
//
//  grep -n targets
//    language tables ...... "const LANGS"
//    language from a name . "export function langOf"
//    tokenizer ............ "export function highlight"
// ============================================================================

const words = s => new Set(s.split(/\s+/).filter(Boolean));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Shared shader built-ins (GLSL and WGSL spell most of them the same).
const SHADER_BI = 'abs acos acosh asin asinh atan atan2 atanh ceil clamp cos cosh cross degrees determinant distance dot exp exp2 faceforward floor fma fract frexp inverseSqrt inversesqrt ldexp length log log2 max min mix modf normalize pow radians reflect refract round saturate sign sin sinh smoothstep sqrt step tan tanh transpose trunc select any all dpdx dpdy fwidth dFdx dFdy mod texture textureLod texelFetch textureSize textureSample textureSampleLevel textureLoad textureStore textureDimensions arrayLength atomicAdd atomicLoad atomicStore workgroupBarrier storageBarrier pack4x8unorm unpack4x8unorm bitcast';

const LANGS = {
  wgsl: {
    kw: words('fn let var const struct return if else for while loop break continue continuing switch case default discard override alias enable requires const_assert diagnostic'),
    ty: /^(f32|f16|i32|u32|bool|vec[234][fihu]?|mat[234]x[234][fh]?|array|ptr|atomic|sampler|sampler_comparison|texture_\w+|function|private|workgroup|uniform|storage|read|write|read_write)$/,
    bi: words(SHADER_BI),
    con: words('true false'),
    line: '//', block: true, at: true, swz: true,
  },
  glsl: {
    kw: words('if else for while do break continue return discard switch case default struct const in out inout uniform varying attribute layout precision highp mediump lowp flat smooth centroid invariant'),
    ty: /^(void|bool|int|uint|float|double|[biud]?vec[234]|d?mat[234](x[234])?|sampler\w*|isampler\w*|usampler\w*|image\w*)$/,
    bi: words(SHADER_BI),
    con: words('true false gl_FragCoord gl_Position gl_FragColor gl_VertexID gl_InstanceID gl_PointCoord'),
    line: '//', block: true, pp: true, swz: true,
  },
  js: {
    kw: words('const let var function return if else for while do break continue switch case default new delete class extends import export from as async await yield of in instanceof typeof void this super try catch finally throw'),
    ty: /^(Float32Array|Float64Array|Uint8Array|Uint16Array|Uint32Array|Int32Array|Array|Map|Set|Promise|Math|Number|String|Object|GPUBufferUsage|GPUTextureUsage)$/,
    bi: words(''),
    con: words('true false null undefined NaN Infinity'),
    line: '//', block: true, str: '\'"`',
  },
  python: {
    kw: words('def class return if elif else for while in not and or is import from as with lambda yield pass break continue try except finally raise global nonlocal assert del async await'),
    ty: /^(int|float|complex|str|bool|list|dict|tuple|set|QuantumCircuit|QuantumRegister|ClassicalRegister|Statevector|np)$/,
    bi: words('range len print abs min max sum zip enumerate map filter sorted round pow'),
    con: words('True False None pi'),
    line: '#', str: '\'"', at: true,
  },
  pseudo: {
    kw: words('for each forall in to downto step do while repeat until if then else elif end return function procedure algorithm input output let set and or not break continue yield loop'),
    ty: /^$/,
    bi: words('min max sum abs floor ceil sqrt exp log sin cos argmin argmax len length mix clamp smoothstep step fract dot normalize'),
    con: words('true false null nil none'),
    line: '//', hash: true, ops: '←→⇐⇒↦∈∉∀∃≤≥≠≈∑∏∫∂∇√×·÷±∧∨¬∪∩⊂⊆∅',
  },
};

// The language table for a free-form name ("GLSL", "jacobi.frag", "WGSL").
export function langOf(name) {
  const n = String(name || '').toLowerCase();
  if (/wgsl/.test(n)) return 'wgsl';
  if (/glsl|\.frag|\.vert|fragment|vertex/.test(n)) return 'glsl';
  if (/python|qiskit|\bpy\b/.test(n)) return 'python';
  if (/\bjs\b|javascript|typescript|\bts\b/.test(n)) return 'js';
  return 'pseudo';
}

// One regular expression per language, built once.
const RES = {};
function reOf(lang) {
  if (RES[lang]) return RES[lang];
  const L = LANGS[lang];
  const alts = [];
  // 1 comment
  const cm = [];
  if (L.line === '//') cm.push('\\/\\/[^\\n]*');
  if (L.line === '#' || L.hash) cm.push('#[^\\n]*');
  if (L.block) cm.push('\\/\\*[\\s\\S]*?\\*\\/');
  alts.push(`(${cm.join('|')})`);
  // 2 preprocessor line (GLSL), before the comment arm can take "#"
  alts.push(L.pp ? '(^[ \\t]*#[^\\n]*)' : '(\\b\\B)');
  // 3 string
  const q = L.str || '';
  // Quote marks need no escape in a regular expression (and the u flag
  // rejects a needless escape), so each string arm is q ( \\. | [^\\ q \n] )* q.
  alts.push(q ? `(${[...q].map(c => `${c}(?:\\\\.|[^\\\\${c}\\n])*${c}`).join('|')})` : '(\\b\\B)');
  // 4 attribute / decorator
  alts.push(L.at ? '(@[A-Za-z_]\\w*)' : '(\\b\\B)');
  // 5 number
  alts.push('(0[xX][0-9a-fA-F]+[uU]?|\\d+\\.\\d*(?:[eE][+-]?\\d+)?[fh]?|\\.\\d+(?:[eE][+-]?\\d+)?[fh]?|\\d+(?:[eE][+-]?\\d+)?[fhiuU]?)');
  // 6 identifier
  alts.push('([A-Za-z_]\\w*)');
  // 7 swizzle (shaders)
  alts.push(L.swz ? '(\\.[xyzwrgba]{1,4}\\b)' : '(\\b\\B)');
  // 8 operator
  alts.push(`([-+*\\/%<>=!&|^~?:${L.ops || ''}]+)`);
  // 9 other
  alts.push('([\\s\\S])');
  // The preprocessor arm goes first, so a GLSL "#define" is not a comment.
  const order = L.pp ? [1, 0, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return (RES[lang] = { re: new RegExp(order.map(i => alts[i]).join('|'), 'gmu'), order });
}

export function highlight(src, lang) {
  const key = LANGS[lang] ? lang : langOf(lang);
  const L = LANGS[key], { re, order } = reOf(key);
  const s = String(src == null ? '' : src);
  let out = '';
  s.replace(re, (m, ...g) => {
    const off = g[9];
    // g[k] is the k-th group in regex order; map it back to the arm number.
    const arm = order.findIndex((_, k) => g[k] !== undefined);
    const t = order[arm], e = esc(m);
    if (t === 0) out += `<span class="tk-cm">${e}</span>`;
    else if (t === 1) out += `<span class="tk-pp">${e}</span>`;
    else if (t === 2) out += `<span class="tk-st">${e}</span>`;
    else if (t === 3) out += `<span class="tk-at">${e}</span>`;
    else if (t === 4) out += `<span class="tk-num">${e}</span>`;
    else if (t === 5) {
      const kwKey = key === 'pseudo' ? m.toLowerCase() : m;
      if (L.kw.has(kwKey)) out += `<span class="tk-kw">${e}</span>`;
      else if (L.con.has(key === 'pseudo' ? m.toLowerCase() : m)) out += `<span class="tk-con">${e}</span>`;
      else if (L.ty.test(m)) out += `<span class="tk-ty">${e}</span>`;
      else if (L.bi.has(m)) out += `<span class="tk-bi">${e}</span>`;
      else if (/^\s*\(/.test(s.slice(off + m.length, off + m.length + 4))) out += `<span class="tk-fn">${e}</span>`;
      else out += e;
    }
    else if (t === 6) out += `<span class="tk-sw">${e}</span>`;
    else if (t === 7) out += `<span class="tk-op">${e}</span>`;
    else out += e;
    return m;
  });
  return out;
}
