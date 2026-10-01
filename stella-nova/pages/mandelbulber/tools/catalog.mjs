// catalog.mjs — builds the Mandelbulber page data files from an upstream Mandelbulber2 checkout.
//
// Reads (never copies) the upstream GPL-3.0 sources of Mandelbulber2,
// Copyright (C) Krzysztof Marczak and the Mandelbulber team, GPL-3.0-or-later.
// The full licence is in ../COPYING.
//
// Writes into <outDir>:
//   params.json    every param: type, default, min/max, sFractal / sParamRender path, derived fields
//   catalog.json   one entry per formula: ids, DE metadata, group, panel params from the .ui form
//   examples.json  the example scenes, only the params each file sets
//   collections.json  the example collections whose licence allows commercial use, by folder
//   CREDITS-examples.md  author and licence of each collection, and the excluded folders
//   thumbs.jpg     all formula thumbnails as one 64 px sprite grid
//   thumbs.json    sprite index: { cols, size, count, index: { <file stem>: i } }
//
// Usage:  node tools/catalog.mjs <UP> [outDir] [--no-collections]   (outDir defaults to gen/)
//         import { buildCatalog } from './catalog.mjs'; await buildCatalog(UP, outDir)
//
// grep: buildCatalog buildParams parseCppBlock execInit evalExpr mapFieldPaths buildDerived
//       templateFrom parseXml parseUi parseCsv buildFormulaList buildExamples buildThumbs
//       buildCollections parseCollectionDir LICENCE_OK MISSING_FEATURES writeCredits

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fractToScene } from './fract-core.mjs';

const read = f => fs.readFileSync(f, 'utf8');
const SLOTS = 9;

// ---------------------------------------------------------------- C++ text helpers

// Remove // and /* */ comments, keep string literals intact.
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; out += ' '; continue; }
    out += c;
  }
  return out;
}

// Index just after the bracket that closes the one at `open`.
function matchClose(s, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { let j = i + 1; while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; j++; } i = j; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') { stack.pop(); if (!stack.length) return i + 1; }
  }
  return s.length;
}

// Body text (inside the braces) of the first function whose header matches `re`.
function functionBody(src, re) {
  const m = re.exec(src);
  if (!m) throw new Error(`function not found: ${re}`);
  const open = src.indexOf('{', m.index + m[0].length);
  return src.slice(open + 1, matchClose(src, open) - 1);
}

// Split on a separator at bracket depth 0 (strings respected).
function splitTop(s, sep = ',') {
  const out = []; let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { let j = i + 1; while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; j++; } i = j; continue; }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (depth === 0 && s.startsWith(sep, i)) { out.push(s.slice(last, i)); last = i + sep.length; i += sep.length - 1; }
  }
  out.push(s.slice(last));
  return out.map(t => t.trim());
}

// Parse a C++ block into nodes: stmt | block | for | if | switch | label.
function parseCppBlock(src) {
  const nodes = [];
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  function one() {
    ws();
    if (i >= src.length) return null;
    const rest = src.slice(i);
    let m;
    if ((m = rest.match(/^(case\s+((?:\w+::)*\w+)|default)\s*:(?!:)/))) {
      i += m[0].length;
      return { t: 'label', value: m[2] || null, text: m[0] };
    }
    if ((m = rest.match(/^(for|if|switch|while)\s*\(/))) {
      const kw = m[1];
      const po = i + m[0].length - 1;
      const pc = matchClose(src, po);
      const head = src.slice(po + 1, pc - 1);
      const start = i;
      i = pc;
      if (kw === 'switch') {
        ws();
        const bc = matchClose(src, i);
        const body = parseCppBlock(src.slice(i + 1, bc - 1));
        i = bc;
        return { t: 'switch', head, body, text: src.slice(start, i) };
      }
      const body = one();
      const node = { t: kw, head, body: body.t === 'block' ? body.body : [body] };
      if (kw === 'if') {
        ws();
        if (/^else\b/.test(src.slice(i))) {
          i += 4;
          const e = one();
          node.else = e.t === 'block' ? e.body : [e];
        }
      }
      node.text = src.slice(start, i);
      return node;
    }
    if (src[i] === '{') {
      const bc = matchClose(src, i);
      const node = { t: 'block', body: parseCppBlock(src.slice(i + 1, bc - 1)), text: src.slice(i, bc) };
      i = bc;
      return node;
    }
    // Plain statement up to ';' at depth 0.
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '"' || c === "'") { let k = j + 1; while (k < src.length && src[k] !== c) { if (src[k] === '\\') k++; k++; } j = k; continue; }
      if ('({['.includes(c)) depth++;
      else if (')}]'.includes(c)) depth--;
      else if (c === ';' && depth === 0) break;
    }
    const text = src.slice(i, j).trim();
    i = j + 1;
    return { t: 'stmt', text };
  }
  for (;;) { const n = one(); if (!n) break; if (n.t !== 'stmt' || n.text) nodes.push(n); }
  return nodes;
}

const norm = s => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- constants and enums

// Scan headers for `enum X { a = 1, b, ... }` and `const int X = N;`.
function scanEnums(files) {
  const E = new Map();
  for (const f of files) {
    const src = stripComments(read(f));
    const re = /enum\s+(?:class\s+)?(\w+)\s*(?::\s*\w+\s*)?\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      let v = -1;
      for (const part of m[2].split(',')) {
        const p = part.trim();
        if (!p) continue;
        const pm = p.match(/^(\w+)\s*(?:=\s*(.+))?$/);
        if (!pm) continue;
        if (pm[2] !== undefined) {
          const n = pm[2].trim();
          v = /^-?(0x)?[0-9a-fA-F]+$/.test(n) ? Number(n) : (E.has(n) ? E.get(n) : v + 1);
        } else v += 1;
        if (!E.has(pm[1])) E.set(pm[1], v);
        E.set(`${m[1]}::${pm[1]}`, v);
      }
    }
    const cre = /const\s+int\s+(\w+)\s*=\s*(-?\d+)\s*;/g;
    while ((m = cre.exec(src))) if (!E.has(m[1])) E.set(m[1], Number(m[2]));
  }
  return E;
}

const MATHFN = new Set(['sqrt', 'cos', 'sin', 'tan', 'pow', 'abs', 'fabs', 'atan', 'atan2', 'exp', 'log']);

// Evaluate a C++ default-value expression. Returns undefined when it is not a constant.
function evalExpr(expr, env, E) {
  let e = expr.trim();
  if (!e) return undefined;
  while (e[0] === '(' && matchClose(e, 0) === e.length) e = e.slice(1, -1).trim();
  e = e.replace(/par->GetContainerName\(\)/g, JSON.stringify(env.__container || ''));
  // Ternary at depth 0.
  const q = splitTop(e, '?');
  if (q.length === 2) {
    const tern = splitTernary(q[1]);
    if (tern) {
      const c = evalExpr(q[0], env, E);
      if (c === undefined) return undefined;
      return evalExpr(c ? tern[0] : tern[1], env, E);
    }
  }
  let m;
  if (/^(?:"(?:[^"\\]|\\.)*"\s*)+$/.test(e)) return [...e.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => x[1].replace(/\\(.)/g, '$1')).join('');
  if (e === 'true') return true;
  if (e === 'false') return false;
  if ((m = e.match(/^QString\(/))) {
    const c = matchClose(e, 7);
    let s = evalExpr(e.slice(8, c - 1), env, E);
    if (typeof s !== 'string') return undefined;
    let rest = e.slice(c);
    let n = 1;
    while ((m = rest.match(/^\.arg\(/))) {
      const cc = matchClose(rest, 4);
      const a = evalExpr(rest.slice(5, cc - 1).split(',')[0], env, E);
      if (a === undefined) return undefined;
      s = s.replace(`%${n}`, String(a)); n++;
      rest = rest.slice(cc);
    }
    if (rest.trim()) {
      const plus = rest.trim().match(/^\+(.*)$/s);
      if (!plus) return undefined;
      const r = evalExpr(plus[1], env, E);
      return typeof r === 'string' ? s + r : undefined;
    }
    return s;
  }
  if ((m = e.match(/^QStringList\s*\(?\s*\{(.*)\}\s*\)?$/s))) return splitTop(m[1]).map(t => evalExpr(t, env, E));
  if ((m = e.match(/^\{(.*)\}$/s))) return splitTop(m[1]).map(t => evalExpr(t, env, E));
  if ((m = e.match(/^(CVector3|CVector4|sRGB)\s*\((.*)\)$/s)) && matchClose(e, e.indexOf('(')) === e.length) {
    const a = splitTop(m[2]).filter(Boolean).map(t => evalExpr(t, env, E));
    if (m[1] === 'CVector4' && a.length === 2 && a[0] && a[0].kind === 'vec3') return { kind: 'vec4', x: a[0].x, y: a[0].y, z: a[0].z, w: a[1] };
    if (a.some(v => typeof v !== 'number')) return undefined;
    if (m[1] === 'sRGB') return { kind: 'rgb', r: a[0], g: a[1], b: a[2] };
    if (m[1] === 'CVector3') return { kind: 'vec3', x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0 };
    return { kind: 'vec4', x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0, w: a[3] ?? 0 };
  }
  if ((m = e.match(/^(?:int|double|float|bool|qint32|unsigned)\s*\((.*)\)$/s)) && matchClose(e, e.indexOf('(')) === e.length) return evalExpr(m[1], env, E);
  if ((m = e.match(/^static_cast<\w+>\((.*)\)$/s))) return evalExpr(m[1], env, E);
  if ((m = e.match(/^cMaterial::Name\((.*)\)$/s))) {
    const [n, id] = splitTop(m[1]).map(t => evalExpr(t, env, E));
    return typeof n === 'string' && id !== undefined ? `mat${id}_${n}` : undefined;
  }
  if ((m = e.match(/^cLight::Name\((.*)\)$/s))) {
    const [n, id] = splitTop(m[1]).map(t => evalExpr(t, env, E));
    return typeof n === 'string' && id !== undefined ? `light${id}_${n}` : undefined;
  }
  // String concatenation.
  const plus = splitTop(e, '+');
  if (plus.length > 1 && plus.every(p => p)) {
    const vals = plus.map(p => evalExpr(p, env, E));
    if (vals.some(v => typeof v === 'string') && vals.every(v => typeof v === 'string' || typeof v === 'number')) return vals.join('');
  }
  if (/^[A-Za-z_][\w]*(?:(?:\.|::|->)[A-Za-z_]\w*)*$/.test(e)) {
    if (e in env) return env[e];
    if (E.has(e)) return E.get(e);
    const tail = e.split('::').pop();
    if (e.includes('::') && E.has(tail)) return E.get(tail);
    return undefined;
  }
  return arith(e, env, E);
}

// Split "a : b" of a ternary body, ignoring '::'.
function splitTernary(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { let j = i + 1; while (j < s.length && s[j] !== '"') j++; i = j; continue; }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ':' && depth === 0 && s[i + 1] !== ':' && s[i - 1] !== ':') return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  return null;
}

// Numeric / boolean arithmetic with identifiers replaced by values.
function arith(e, env, E) {
  const toks = e.match(/"(?:[^"\\]|\\.)*"|[A-Za-z_]\w*(?:(?:\.|::|->)[A-Za-z_]\w*)*|\d*\.?\d+(?:[eE][-+]?\d+)?[fF]?|==|!=|<=|>=|&&|\|\||[-+*/%()<>!,?:]|\s+|./g);
  if (!toks) return undefined;
  let js = '';
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (/^\s+$/.test(t)) { js += ' '; continue; }
    if (/^"/.test(t)) { js += t; continue; }
    if (/^\d|^\.\d/.test(t)) { js += t.replace(/[fF]$/, ''); continue; }
    if (/^[A-Za-z_]/.test(t)) {
      const next = toks.slice(k + 1).find(x => !/^\s+$/.test(x));
      if (MATHFN.has(t) && next === '(') { js += `Math.${t === 'fabs' ? 'abs' : t}`; continue; }
      if (t === 'M_PI') { js += String(Math.PI); continue; }
      if (t === 'M_PI_180') { js += String(Math.PI / 180); continue; }
      if (t === 'M_PI_2') { js += String(Math.PI / 2); continue; }
      if (t === 'true' || t === 'false') { js += t; continue; }
      const v = evalExpr(t, env, E);
      if (typeof v === 'number' || typeof v === 'boolean') { js += `(${v})`; continue; }
      if (typeof v === 'string') { js += JSON.stringify(v); continue; }
      return undefined;
    }
    if (/^[-+*/%()<>!=&|,?:]+$/.test(t)) { js += t === '==' ? '===' : t === '!=' ? '!==' : t; continue; }
    return undefined;
  }
  try { const v = Function(`"use strict";return (${js});`)(); return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : undefined; } catch { return undefined; }
}

// ---------------------------------------------------------------- init functions -> params

const DECL = /^(?:const\s+)?(int|double|bool|float|CVector3|CVector4|sRGB|QString|QStringList)\s+(\w+)\s*(?:=\s*([\s\S]+)|\(([\s\S]*)\)|\{([\s\S]*)\})?$/;

function typeOfDefault(text, v, env) {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'string';
  if (v && v.kind === 'vec3') return 'vect3';
  if (v && v.kind === 'vec4') return 'vect4';
  if (v && v.kind === 'rgb') return 'rgb';
  if (typeof v === 'number') {
    const t = text.trim();
    if (/^(int|qint32)\s*\(/.test(t)) return 'int';
    if (env.__types && env.__types[t]) return env.__types[t] === 'int' ? 'int' : 'double';
    if (/^-?\d+$/.test(t)) return 'int';
    if (/[.eE]/.test(t) && /^[-+\d.eE]+$/.test(t)) return 'double';
    if (/^[A-Za-z_][\w:]*$/.test(t)) return 'int';
    return /\d\.\d|\de/.test(t) ? 'double' : 'int';
  }
  return null;
}

function jsonValue(type, v) {
  switch (type) {
    case 'vect3': return { x: v.x, y: v.y, z: v.z };
    case 'vect4': return { x: v.x, y: v.y, z: v.z, w: v.w };
    case 'rgb': return { r: v.r / 65536, g: v.g / 65536, b: v.b / 65536 };
    default: return v;
  }
}

// Execute an init function AST; call add(name, record) for every addParam.
function execInit(nodes, env, E, add, gradients) {
  env.__types = env.__types || {};
  const run = list => {
    for (let k = 0; k < list.length; k++) {
      const r = exec(list[k]);
      if (r === 'break') return 'break';
    }
    return null;
  };
  function exec(n) {
    if (n.t === 'block') return run(n.body);
    if (n.t === 'label') return null;
    if (n.t === 'for') {
      const m = n.head.match(/^\s*int\s+(\w+)\s*=\s*(.+?)\s*;\s*\1\s*(<=|<)\s*(.+?)\s*;/);
      if (!m) return null;
      const a = evalExpr(m[2], env, E), b = evalExpr(m[4], env, E);
      if (typeof a !== 'number' || typeof b !== 'number') return null;
      for (let i = a; m[3] === '<' ? i < b : i <= b; i++) { env[m[1]] = i; env.__types[m[1]] = 'int'; run(n.body); }
      delete env[m[1]];
      return null;
    }
    if (n.t === 'if') {
      const c = evalExpr(n.head, env, E);
      if (c === undefined) return null;
      return c ? run(n.body) : n.else ? run(n.else) : null;
    }
    if (n.t === 'switch') {
      const v = evalExpr(n.head, env, E);
      let start = n.body.findIndex(x => x.t === 'label' && x.value && evalExpr(x.value, env, E) === v);
      if (start < 0) start = n.body.findIndex(x => x.t === 'label' && !x.value);
      if (start < 0) return null;
      run(n.body.slice(start + 1));
      return null;
    }
    const s = n.text;
    if (s === 'break') return 'break';
    let m;
    if ((m = s.match(/^par->addParam\(([\s\S]*)\)$/))) { addParam(m[1]); return null; }
    if ((m = s.match(/^par->SetAsGradient\(([\s\S]*)\)$/))) { const g = evalExpr(m[1], env, E); if (g) gradients.add(g); return null; }
    if ((m = s.match(DECL))) {
      const [, type, name, eq, ctor, brace] = m;
      env.__types[name] = type;
      if (eq !== undefined) env[name] = evalExpr(eq, env, E);
      else if (ctor !== undefined || brace !== undefined) env[name] = evalExpr(type === 'QStringList' ? `QStringList(${ctor ?? `{${brace}}`})` : `${type}(${ctor ?? brace})`, env, E);
      else env[name] = type === 'CVector3' ? { kind: 'vec3', x: 0, y: 0, z: 0 } : type === 'sRGB' ? { kind: 'rgb', r: 0, g: 0, b: 0 } : 0;
      return null;
    }
    if ((m = s.match(/^(\w+)\s*=\s*([\s\S]+)$/))) {
      let v = evalExpr(m[2], env, E);
      const type = env.__types[m[1]];
      if (Array.isArray(v) && type === 'CVector3') v = { kind: 'vec3', x: v[0], y: v[1], z: v[2] };
      if (Array.isArray(v) && type === 'sRGB') v = { kind: 'rgb', r: v[0], g: v[1], b: v[2] };
      env[m[1]] = v;
    }
    return null;
  }
  function addParam(argText) {
    const args = splitTop(argText);
    const mi = args.findIndex(a => /^morph\w+$/.test(a));
    if (mi < 0) return;
    const before = args.slice(0, mi);
    const scope = args[mi + 1];
    const listText = args[mi + 2];
    let name = evalExpr(before[0], env, E);
    if (typeof name !== 'string') { add(null, { error: `name ${before[0]}` }); return; }
    let defText, minText, maxText;
    if (before.length === 2) defText = before[1];
    else if (before.length === 3) { name += '_' + evalExpr(before[1], env, E); defText = before[2]; }
    else if (before.length === 4) [, defText, minText, maxText] = before;
    else if (before.length === 5) { name += '_' + evalExpr(before[1], env, E); [, , defText, minText, maxText] = before; }
    else { add(name, { error: 'arg count' }); return; }
    const v = evalExpr(defText, env, E);
    let type = typeOfDefault(defText, v, env);
    let def;
    if (type) def = jsonValue(type, v);
    else if (/QDir|systemDirectories|systemData/.test(defText)) { type = 'string'; def = ''; }
    else { add(name, { error: `default ${norm(defText)}` }); return; }
    const rec = { type, default: def };
    if (minText !== undefined) {
      const lo = evalExpr(minText, env, E), hi = evalExpr(maxText, env, E);
      if (typeof lo === 'number') rec.min = lo;
      if (typeof hi === 'number') rec.max = hi;
    }
    if (listText) {
      const l = evalExpr(listText, env, E);
      if (Array.isArray(l)) rec.options = l;
    }
    rec.scope = scope;
    add(name, rec);
  }
  run(nodes);
}

function collect(nodes, env, E) {
  const out = {}, errors = [], gradients = new Set();
  execInit(nodes, env, E, (name, rec) => {
    if (rec.error) errors.push(`${name}: ${rec.error}`);
    else out[name] = rec;
  }, gradients);
  for (const g of gradients) if (out[g]) out[g].gradient = true;
  return { out, errors };
}

const keep = rec => rec.scope === 'paramStandard' || rec.scope === 'paramNoSave';
const clean = rec => { const r = { ...rec }; if (r.scope === 'paramNoSave') r.noSave = true; delete r.scope; return r; };

// ---------------------------------------------------------------- sFractal / sParamRender paths

const GET_RE = /container->Get<(\w+)>\(\s*("[^"]*"|[^,)]+)\s*(?:,\s*([^)]+))?\)/g;

// Walk a constructor body: simple `field = container->Get<T>("name")` lines become paths,
// everything else that touches params becomes a derived entry.
function mapFieldPaths(nodes, E, { loopBlocks = true } = {}) {
  const paths = {}, derived = [];
  const env = {};
  function evalIdx(p) {
    return p.replace(/\[([^\]]+)\]/g, (_, x) => { const v = evalExpr(x, env, E); return `[${v === undefined ? x : v}]`; });
  }
  function getName(nameText, idxText) {
    let n = evalExpr(nameText, env, E);
    if (typeof n !== 'string') return null;
    if (idxText !== undefined) n += '_' + evalExpr(idxText, env, E);
    return n;
  }
  function stmt(s, raw) {
    const m = s.match(/^([\w.\[\]\s+\-*]+?)\s*=\s*([\s\S]+)$/);
    const gets = [...s.matchAll(GET_RE)];
    if (m && gets.length === 1 && !/[+\-*/]=$/.test(m[1])) {
      const lhs = evalIdx(m[1].replace(/\s+/g, ''));
      let rhs = m[2].trim();
      const g = gets[0];
      const name = getName(g[2], g[3]);
      // Peel conversions the packer must repeat.
      let w, convert;
      let inner = rhs;
      let mm;
      if ((mm = inner.match(/^CVector4\(\s*(container->Get<CVector3>\([^)]*\))\s*,\s*([-\d.]+)\s*\)$/))) { w = Number(mm[2]); inner = mm[1]; }
      if ((mm = inner.match(/^toRGBFloat\((container->Get<sRGB>\([^)]*\))\)$/))) { convert = 'toRGBFloat'; inner = mm[1]; }
      if ((mm = inner.match(/^(?:[\w:]+::)?enum\w+\((container->Get<int>\([^)]*\))\)$/))) inner = mm[1];
      if (inner === g[0] && name) {
        const rec = { path: lhs };
        if (w !== undefined) rec.w = w;
        if (convert) rec.convert = convert;
        if (paths[name]) (paths[name].also = paths[name].also || []).push(rec);
        else paths[name] = rec;
        return;
      }
      derived.push({ target: lhs, expr: norm(raw), getParams: name ? [name] : [] });
      return;
    }
    if (gets.length) {
      const names = gets.map(g => getName(g[2], g[3])).filter(Boolean);
      derived.push({ target: m ? m[1].replace(/\s*[-+*\/]$/, "").trim() : null, expr: norm(raw), getParams: names });
      return;
    }
    if (/^WriteLog|^RecalculateFractalParams\(\)$/.test(s)) return;
    derived.push({ target: m ? m[1].replace(/\s*[-+*\/]$/, "").trim() : targetOf(s), expr: norm(raw), match: norm(raw).replace(/\[[^\]]*\]/g, ''), getParams: [] });
  }
  function walk(list) {
    for (const n of list) {
      if (n.t === 'stmt') stmt(n.text, n.text + ';');
      else if (n.t === 'for' && loopBlocks) {
        const m = n.head.match(/^\s*int\s+(\w+)\s*=\s*(.+?)\s*;\s*\1\s*(<=|<)\s*(.+?)\s*;/);
        const a = m && evalExpr(m[2], env, E), b = m && evalExpr(m[4], env, E);
        if (typeof a !== 'number' || typeof b !== 'number') { derived.push({ target: null, expr: norm(n.text), getParams: [] }); continue; }
        // Keep the whole loop as one derived entry when it does more than fetch params.
        const before = derived.length;
        for (let i = a; m[3] === '<' ? i < b : i <= b; i++) { env[m[1]] = i; walk(n.body); }
        delete env[m[1]];
        if (derived.length > before) {
          const inner = derived.splice(before);
          const names = [...new Set(inner.flatMap(d => d.getParams))];
          const match = [...new Set(inner.map(d => d.match || d.expr))].join(' ');
          derived.push({ target: null, expr: norm(n.text), match, getParams: names });
        }
      } else if (n.t === 'block') walk(n.body);
      else derived.push({ target: null, expr: norm(n.text), getParams: [], skipped: true });
    }
  }
  walk(nodes);
  return { paths, derived };
}

function targetOf(s) {
  const m = s.match(/^([\w.\[\]]+?)\.(\w+)\(/);
  if (m) return m[1];
  const d = s.match(/^(?:const\s+)?(?:double|float|int)\s+(\w+)\s*=/);
  if (d) return `local:${d[1]}`;
  return null;
}

// Attach "from" (param names) to derived entries by matching field paths in the expression.
function buildDerived(list, paths, stage) {
  const byBase = new Map();
  for (const [name, rec] of Object.entries(paths)) {
    for (const r of [rec, ...(rec.also || [])]) {
      const base = r.path.replace(/\[\d+\]/g, '');
      if (!byBase.has(base)) byBase.set(base, new Set());
      byBase.get(base).add(name);
    }
  }
  return list.map(d => {
    const from = new Set(d.getParams);
    const text = (d.match || d.expr).replace(/\[[^\]]*\]/g, '');
    for (const tok of text.match(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g) || []) {
      // Try every prefix: "IFS.direction.Normalize" also reads the field "IFS.direction".
      const segs = tok.split('.');
      for (let k = 1; k <= segs.length; k++) {
        const hit = byBase.get(segs.slice(0, k).join('.'));
        if (hit) for (const n of hit) from.add(n);
      }
    }
    // Later entries may read a field an earlier entry computed: chain its sources.
    if (d.target && !d.target.startsWith('local:')) {
      const base = d.target.replace(/\[[^\]]*\]/g, '');
      if (!byBase.has(base)) byBase.set(base, new Set());
      for (const n of from) byBase.get(base).add(n);
    }
    let kind;
    if (/SetRotation/.test(d.expr)) kind = 'rotation matrix from angles in degrees';
    else if (/Transpose\(\)/.test(d.expr)) kind = 'rotation matrix and its transpose from angles in degrees';
    else if (/\*=\s*M_PI_180/.test(d.expr)) kind = 'degrees to radians in place';
    else if (/Normalize\(\)/.test(d.expr)) kind = 'normalized in place';
    else if (/toRGBFloat/.test(d.expr)) kind = 'color converted to float';
    else if (!from.size) kind = 'constant';
    else kind = 'computed from params';
    const out = { target: d.target, derived: kind, from: [...from], expr: d.expr, stage };
    if (d.skipped) out.note = 'control block, not evaluated by the generator';
    return out;
  });
}

// ---------------------------------------------------------------- params.json

function buildParams(UP) {
  const src = stripComments(read(path.join(UP, 'src/initparameters.cpp')));
  const hdrs = [
    ...fs.readdirSync(path.join(UP, 'src')).filter(f => /\.(h|hpp)$/.test(f) && f !== 'old_settings.hpp').map(f => path.join(UP, 'src', f)),
    path.join(UP, 'formula/definition/all_fractal_list_enums.hpp'),
  ];
  const E = scanEnums(hdrs);
  const errors = [];

  // Main params.
  const mainRun = collect(parseCppBlock(functionBody(src, /void\s+InitParams\s*\(/g)), { __container: 'main' }, E);
  errors.push(...mainRun.errors.map(e => `InitParams ${e}`));
  const main = {};
  for (const [k, r] of Object.entries(mainRun.out)) if (keep(r)) main[k] = clean(r);

  // Per-fractal params, evaluated for slot 1 (container "fractal0") and slot 2.
  const fracBody = parseCppBlock(functionBody(src, /void\s+InitFractalParams\s*\(/g));
  const f0 = collect(fracBody, { __container: 'fractal0' }, E);
  const f1 = collect(fracBody, { __container: 'fractal1' }, E);
  errors.push(...f1.errors.map(e => `InitFractalParams ${e}`));
  const fractalAll = {};
  for (const [k, r] of Object.entries(f1.out)) if (keep(r)) fractalAll[k] = clean(r);

  // Slot-level general params: everything InitFractalParams adds before "power", plus the
  // legacy transform params (settings.cpp InjectTemporaryLegacyFormulaTransformParams).
  const names = Object.keys(fractalAll);
  const slotNames = names.slice(0, names.indexOf('power'));
  const legacySlot = {
    formula_position: { type: 'vect3', default: { x: 0, y: 0, z: 0 } },
    formula_rotation: { type: 'vect3', default: { x: 0, y: 0, z: 0 } },
    formula_repeat: { type: 'vect3', default: { x: 0, y: 0, z: 0 } },
    formula_scale: { type: 'double', default: 1 },
  };

  // Field paths.
  const fsrc = stripComments(read(path.join(UP, 'src/fractal.cpp')));
  const ctor = mapFieldPaths(parseCppBlock(functionBody(fsrc, /sFractal::sFractal\s*\(/g)), E);
  const recalc = mapFieldPaths(parseCppBlock(functionBody(fsrc, /void\s+sFractal::RecalculateFractalParams\s*\(/g)), E);
  const derivedFields = [
    ...buildDerived(ctor.derived, ctor.paths, 'sFractal constructor'),
    ...buildDerived(recalc.derived, ctor.paths, 'sFractal::RecalculateFractalParams'),
  ];

  const fractal = {};
  const slot = {};
  for (const [k, r] of Object.entries(fractalAll)) {
    const p = ctor.paths[k];
    const rec = { path: p ? p.path : null, ...r };
    if (p && p.w !== undefined) rec.w = p.w;
    if (p && p.also) rec.also = p.also.map(a => a.path);
    if (slotNames.includes(k)) {
      const d0 = f0.out[k] && clean(f0.out[k]).default;
      if (JSON.stringify(d0) !== JSON.stringify(rec.default)) rec.defaultSlot1 = d0;
      slot[k] = rec;
    } else fractal[k] = rec;
  }
  for (const [k, r] of Object.entries(legacySlot)) if (!slot[k]) slot[k] = { path: null, ...r, legacy: true };
  // Legacy flat main params that settings.cpp injects for files older than 2.35.
  if (!main.formula_material_id) main.formula_material_id = { type: 'int', default: 1, legacy: true };
  if (!main.boolean_operators) main.boolean_operators = { type: 'bool', default: false, legacy: true };
  for (let s = 1; s < SLOTS; s++) if (!main[`boolean_operator_${s}`]) main[`boolean_operator_${s}`] = { type: 'int', default: 1, legacy: true, note: '0 = mul (intersection), 1 = add (union), 2 = sub (settings.cpp ToNodeType)' };
  // Slot-level params live in main as "<name>_<k>", as legacy .fract files write them.
  for (let s = 1; s <= SLOTS; s++) {
    for (const [k, r] of Object.entries(slot)) {
      const key = `${k}_${s}`;
      const rec = { type: r.type, default: s === 1 && r.defaultSlot1 !== undefined ? r.defaultSlot1 : r.default, slot: s, base: k };
      if (r.min !== undefined) rec.min = r.min;
      if (r.max !== undefined) rec.max = r.max;
      if (r.path) rec.fractalPath = r.path;
      if (main[key]) rec.alsoMain = true;
      main[key] = rec;
    }
  }

  // Main render paths.
  const psrc = stripComments(read(path.join(UP, 'src/fractparams.cpp')));
  const pctor = mapFieldPaths(parseCppBlock(functionBody(psrc, /sParamRender::sParamRender\s*\([^{]*\)\s*:[^{]*/g)), E, { loopBlocks: false });
  const mainPaths = {};
  for (const [k, p] of Object.entries(pctor.paths)) {
    const rec = { path: p.path };
    if (p.convert) rec.convert = p.convert;
    if (p.also) rec.also = p.also.map(a => a.path);
    mainPaths[k] = rec;
  }
  const mainDerived = buildDerived(pctor.derived.filter(d => !d.skipped), pctor.paths, 'sParamRender constructor');

  // Templates: materials, lights, primitives.
  const matBody = parseCppBlock(functionBody(src, /void\s+InitMaterialParams\s*\(/g));
  const mat1 = collect(matBody, { materialId: 1 }, E), mat2 = collect(matBody, { materialId: 2 }, E);
  errors.push(...mat1.errors.map(e => `InitMaterialParams ${e}`));
  const material = templateFrom([[1, mat1.out], [2, mat2.out]], id => `mat${id}_`, 2);

  const lightBody = parseCppBlock(functionBody(src, /void\s+InitLightParams\s*\(/g));
  const lightRuns = [1, 2, 3, 4, 5, 6].map(id => [id, collect(lightBody, { lightId: id }, E).out]);
  const light = templateFrom(lightRuns, id => `light${id}_`, 6);

  const primBody = parseCppBlock(functionBody(src, /void\s+InitPrimitiveParams\s*\(/g));
  const objTypes = [...E.keys()].filter(k => /^enumObjectType::obj\w+$/.test(k)).map(k => k.split('::')[1])
    .filter(n => !['objNone', 'objFractal'].includes(n));
  const primRun = (typeVal, tname) => collect(primBody, {
    'primitive.type': typeVal, 'primitive.id': 1, 'primitive.fullName': `primitive_${tname}_1`,
    'primitive.typeName': tname, primitiveName: `primitive_${tname}_1`,
  }, E).out;
  const strip = (o, pre) => Object.fromEntries(Object.entries(o).filter(([, r]) => keep(r)).map(([k, r]) => [k.slice(pre.length), clean(r)]));
  // primitiveName is declared from primitive.fullName inside the function body.
  const common = strip(primRun(-1, 'none'), 'primitive_none_1_');
  delete common.name;
  // Legacy per-primitive params (settings.cpp InjectTemporaryLegacyPrimitive*Params, files < 2.35).
  Object.assign(common, {
    position: { type: 'vect3', default: { x: 0, y: 0, z: 0 }, legacy: true },
    rotation: { type: 'vect3', default: { x: 0, y: 0, z: 0 }, legacy: true },
    scale: { type: 'double', default: 1, legacy: true },
    repeat: { type: 'vect3', default: { x: 0, y: 0, z: 0 }, legacy: true },
    calculation_order: { type: 'int', default: 0, legacy: true },
    boolean_operator: { type: 'int', default: 1, legacy: true },
    smooth_de_combine_enable: { type: 'bool', default: false, legacy: true },
    smooth_de_combine_distance: { type: 'double', default: 0.1, legacy: true },
  });
  const types = {};
  for (const t of objTypes) {
    const tname = t.slice(3).toLowerCase();
    const all = strip(primRun(E.get(`enumObjectType::${t}`), tname), `primitive_${tname}_1_`);
    for (const k of Object.keys(common)) if (JSON.stringify(all[k]) === JSON.stringify(common[k])) delete all[k];
    types[tname] = all;
  }

  const P = {
    _units: {
      rgb: '{r,g,b} in 0..1 = upstream 16-bit channel / 65536 (color_structures.hpp toRGBFloat); .fract stores 4-digit hex per channel',
      angles: 'degrees, as in .fract files; derivedFields convert to radians',
      vect3: '{x,y,z}', vect4: '{x,y,z,w}',
      gradient: 'type string with gradient:true, text "pos rrggbb pos rrggbb ...", pos 0..9999',
      formula: 'main["formula_<k>"] = fractal::enumFractalFormula value (catalog.json enumId), 0 = none',
      paths: 'sFractal / sParamRender field path; array elements as name[i]',
    },
    slots: SLOTS,
    slotParams: Object.keys(slot),
    fractal,
    main,
    templates: {
      material: { prefix: 'mat<N>_', params: material },
      light: { prefix: 'light<N>_', params: light },
      primitive: { prefix: 'primitive_<type>_<N>_', common, types },
    },
    derivedFields,
    mainPaths,
    mainDerived,
  };
  return { P, errors, slotSrc: slot, E };
}

// Merge per-id runs into one template; defaultById keeps ids whose default differs.
function templateFrom(runs, prefix, baseId) {
  const base = runs.find(([id]) => id === baseId)[1];
  const pre = prefix(baseId);
  const out = {};
  for (const [k, r] of Object.entries(base)) {
    if (!keep(r)) continue;
    const key = k.slice(pre.length);
    const rec = clean(r);
    for (const [id, o] of runs) {
      if (id === baseId) continue;
      const other = o[prefix(id) + key];
      if (other && JSON.stringify(other.default) !== JSON.stringify(r.default)) (rec.defaultById = rec.defaultById || {})[id] = other.default;
    }
    out[key] = rec;
  }
  return out;
}

// ---------------------------------------------------------------- .ui forms

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|lt|gt|amp|quot|apos);/g, (_, e) => {
    if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&';
    if (e === 'quot') return '"'; if (e === 'apos') return "'";
    return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

// Minimal XML parser: { tag, attrs, children, text }.
function parseXml(src) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) { stack.pop(); continue; }
    if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = decodeEntities(a[2]);
      const el = { tag: m[2], attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
      continue;
    }
    if (m[5]) stack[stack.length - 1].text += decodeEntities(m[5]);
  }
  return root;
}

const kids = (el, tag) => el.children.filter(c => c.tag === tag);
function prop(w, name) {
  const p = kids(w, 'property').find(p => p.attrs.name === name);
  if (!p || !p.children[0]) return undefined;
  const v = p.children[0];
  if (v.tag === 'double' || v.tag === 'number') return Number(v.text);
  if (v.tag === 'bool') return v.text.trim() === 'true';
  if (v.tag === 'string') return v.text;
  return v.text;
}
const plain = s => (s || '').replace(/<[^>]*>/g, ' ').replace(/&(?!\w+;)/g, '').replace(/\s+/g, ' ').trim();
const labelText = s => plain(s).replace(/\s*:\s*$/, '').trim();

const PREFIX = {
  spinbox: { kind: 'double' }, spinboxd: { kind: 'double', angle: true }, logedit: { kind: 'double', log: true },
  logslider: { kind: 'double', log: true }, spinboxInt: { kind: 'int' },
  checkBox: { kind: 'bool' }, checkbox: { kind: 'bool' }, groupCheck: { kind: 'bool', group: true },
  comboBox: { kind: 'list' },
  spinbox3: { kind: 'vect3' }, spinboxd3: { kind: 'vect3', angle: true }, vect3: { kind: 'vect3' }, logvect3: { kind: 'vect3', log: true },
  spinbox4: { kind: 'vect4' }, spinboxd4: { kind: 'vect4', angle: true }, vect4: { kind: 'vect4' },
};

// Walk one .ui form: returns ordered params and the form info text.
function parseUi(file, survey) {
  const root = parseXml(read(file));
  const params = new Map();
  let info = '';
  function visit(el, ctx) {
    if (el.tag === 'widget') {
      const cls = el.attrs.class, name = el.attrs.name || '';
      if (name === 'label_information_general') info = plain(prop(el, 'text') || '');
      if (name === 'groupCheck_info' || name === 'label_code_content') { if (name === 'groupCheck_info') el.children.forEach(c => visit(c, ctx)); return; }
      const us = name.indexOf('_');
      const pre = us > 0 ? name.slice(0, us) : name;
      if (cls !== 'QLabel' && cls !== 'QWidget' && cls !== 'Line' && cls !== 'QFrame') survey.set(`${cls} ${pre}`, (survey.get(`${cls} ${pre}`) || 0) + 1);
      const spec = PREFIX[pre];
      let groupTitle = ctx.group;
      if (cls === 'MyGroupBox' || cls === 'QGroupBox') groupTitle = labelText(prop(el, 'title')) || ctx.group;
      if (spec && us > 0) {
        let pname = name.slice(us + 1), axis = null;
        if (spec.kind === 'vect3' || spec.kind === 'vect4') {
          const am = pname.match(/^(.*)_([xyzw])$/);
          if (am) { pname = am[1]; axis = am[2]; }
        }
        let label = '';
        if (spec.group) label = labelText(prop(el, 'title'));
        else if (spec.kind === 'bool') label = labelText(prop(el, 'text'));
        if (!label && ctx.gridLabel) label = ctx.gridLabel(ctx.cell, !!axis);
        if (axis && label) label = label.replace(/\s*[xyzwXYZW]\s*$/, '').replace(/\s*:$/, '').trim();
        let p = params.get(pname);
        if (!p) {
          p = { name: pname, label: axis ? "" : label, group: ctx.group, kind: spec.kind };
          if (spec.angle) p.angle = true;
          if (spec.log) p.log = true;
          if (ctx.enabledBy) p.enabledBy = ctx.enabledBy;
          params.set(pname, p);
        }
        if (axis) (p._axis = p._axis || []).push(label);
        else if (!p.label && label) p.label = label;
        if (!axis || axis === 'x') {
          // Qt defaults where the form leaves a property out (MyDoubleSpinBox keeps them).
          const qt = /DoubleSpinBox/.test(cls) ? { min: 0, max: 99.99, step: 1, decimals: 2 }
            : /SpinBox/.test(cls) ? { min: 0, max: 99, step: 1 } : {};
          const lo = prop(el, 'minimum'), hi = prop(el, 'maximum'), st = prop(el, 'singleStep'), dec = prop(el, 'decimals');
          const r = x => +x.toPrecision(12);
          if (typeof lo === 'number') p.min = r(lo); else if (qt.min !== undefined) p.min = qt.min;
          if (typeof hi === 'number') p.max = r(hi); else if (qt.max !== undefined) p.max = qt.max;
          if (typeof st === 'number') p.step = r(st); else if (qt.step !== undefined) p.step = qt.step;
          const d = typeof dec === 'number' ? dec : qt.decimals;
          if (d !== undefined && d !== 6) p.decimals = d;
        }
        if (spec.kind === 'list') p.options = kids(el, 'item').map(it => plain(prop(it, 'text')));
      }
      const next = { ...ctx, group: groupTitle };
      if (spec && spec.group && us > 0) next.enabledBy = name.slice(us + 1);
      for (const c of el.children) if (c.tag === 'layout' || c.tag === 'widget') visit(c, next);
      return;
    }
    if (el.tag === 'layout') {
      let items = kids(el, 'item');
      if (el.attrs.class === 'QGridLayout') {
        items = [...items].sort((a, b) => (+a.attrs.row - +b.attrs.row) || (+a.attrs.column - +b.attrs.column));
        const labels = items.filter(it => it.children[0] && it.children[0].tag === 'widget' && it.children[0].attrs.class === 'QLabel')
          .map(it => ({ row: +it.attrs.row, col: +it.attrs.column, span: +(it.attrs.rowspan || 1), text: labelText(prop(it.children[0], 'text')) }));
        const axisLike = t => t.replace(/[xyzwXYZWαβγ]\s*:?$/, '').trim().length < 3;
        const gridLabel = (cell, isAxis) => {
          const c = labels.filter(l => l.row <= cell.row && cell.row < l.row + l.span && l.col < cell.col && l.text).sort((a, b) => b.col - a.col);
          if (!c.length) return '';
          // Vector component: its own nearest label, unless that is only an axis letter and a
          // label spanning several rows names the whole vector.
          if (isAxis) {
            if (!axisLike(c[0].text)) return c[0].text;
            const span = c.find(l => l.span > 1 && !axisLike(l.text));
            return span ? span.text : c[0].text;
          }
          // Scalar: nearest label to the left that is more than an axis letter.
          const named = c.find(l => !axisLike(l.text));
          return named ? named.text : c[0].text;
        };
        for (const it of items) for (const c of it.children) visit(c, { ...ctx, gridLabel, cell: { row: +it.attrs.row, col: +it.attrs.column } });
        return;
      }
      // Vertical box: a lone short QLabel works as a section header for what follows.
      // Horizontal box: a QLabel names the widget that follows it.
      const horiz = el.attrs.class === 'QHBoxLayout';
      let header = ctx.group, pending = '';
      for (const it of items) {
        const w = it.children[0];
        if (w && w.tag === 'widget' && w.attrs.class === 'QLabel' && !/information|code/.test(w.attrs.name)) {
          const t = labelText(prop(w, 'text'));
          if (horiz) pending = t;
          else if (t && t.length < 60) header = t;
          continue;
        }
        const lab = pending;
        for (const c of it.children) visit(c, { ...ctx, group: header, gridLabel: horiz && lab ? () => lab : null, cell: null });
      }
      return;
    }
    for (const c of el.children) visit(c, ctx);
  }
  visit(root, { group: '' });
  info = info.replace(/Examples using this formula[\s\S]*$/, '').replace(/\bCode\b\s*$/, '').trim();
  if (info.length > 400) info = info.slice(0, 397).replace(/\s+\S*$/, '') + '...';
  // Vector label: the shared text of the axis labels, else the section, else the axis labels joined.
  for (const p of params.values()) {
    if (p._axis) {
      const ax = p._axis.filter(Boolean);
      const uniq = [...new Set(ax)];
      if (uniq.length === 1) p.label = uniq[0];
      else if (uniq.length > 1) { p.axisLabels = p._axis; if (!p.label) p.label = p.group || uniq.join(' / '); }
      delete p._axis;
    }
    if (!p.group) delete p.group;
    if (!p.label) p.label = p.group || p.name;
    else if (/^[xyzw]$/i.test(p.label) && p.group) p.label = `${p.group} ${p.label}`;
  }
  return { params: [...params.values()], info };
}

// ---------------------------------------------------------------- formula list

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const head = rows.shift();
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function buildFormulaList(UP, E) {
  const dir = path.join(UP, 'formula/definition');
  const defs = new Map(), byClass = new Map();
  for (const f of fs.readdirSync(dir).filter(f => /^fractal_.*\.cpp$/.test(f))) {
    const s = read(path.join(dir, f));
    const id = (s.match(/internalID\s*=\s*fractal::(\w+)/) || [])[1];
    const iname = (s.match(/internalName\s*=\s*"([^"]*)"/) || [])[1];
    const cls = (s.match(/(cFractal\w+)::cFractal\w+\s*\(\s*\)/) || [])[1];
    const combo = (s.match(/nameInComboBox\s*=\s*"([^"]*)"/) || [])[1];
    if (!id) continue;
    const d = { enumName: id, file: iname, cls, combo, def: f };
    defs.set(id, d);
    if (cls) byClass.set(cls, d);
  }
  const list = read(path.join(dir, 'all_fractal_list.cpp'));
  const order = [...stripComments(list).matchAll(/fractalList->append\(new (cFractal\w+)\(\)\)/g)].map(m => m[1]);
  const headers = [...read(path.join(UP, 'qt/fractal_object.cpp')).matchAll(/insertHeader\s*<<\s*QPair<int,\s*QString>\(\s*fractal::(\w+),\s*QObject::tr\("([^"]+)"\)\)/g)]
    .map(m => ({ enumName: m[1], title: m[2] }));
  return { defs, byClass, order, headers };
}

// ---------------------------------------------------------------- thumbnails

function buildThumbs(UP, outDir) {
  const imgDir = path.join(UP, 'formula/img');
  const files = fs.readdirSync(imgDir).filter(f => f.endsWith('.png')).sort();
  const size = 64, cols = 24;
  const out = path.join(outDir, 'thumbs.jpg');
  // One +append row per `cols` images, then -append the rows (no montage: it needs a font).
  const args = [];
  for (let r = 0; r * cols < files.length; r++) {
    args.push('(');
    for (const f of files.slice(r * cols, r * cols + cols)) args.push(path.join(imgDir, f));
    args.push('-resize', `${size}x${size}!`, '-background', 'black', '-gravity', 'west', '+append',
      '-extent', `${cols * size}x${size}`, ')');
  }
  execFileSync('magick', [...args, '-background', 'black', '-alpha', 'remove', '-alpha', 'off', '-append',
    '-strip', '-quality', '80', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  const index = {};
  files.forEach((f, i) => { index[f.slice(0, -4)] = i; });
  const meta = { cols, size, count: files.length, index };
  fs.writeFileSync(path.join(outDir, 'thumbs.json'), JSON.stringify(meta));
  return meta;
}

// ---------------------------------------------------------------- examples

function buildExamples(UP, P) {
  const dir = path.join(UP, 'deploy/share/mandelbulber2/examples');
  const files = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .filter(e => !e.isDirectory() && e.name.endsWith('.fract')).map(e => e.name);
  const examples = [], unknown = new Map();
  for (const f of files) {
    const r = fractToScene(read(path.join(dir, f)), P, { fill: false });
    const ex = { file: f, title: path.basename(f, '.fract').replace(/[_]+/g, ' ').trim(), version: r.version, main: r.scene.main, fractal: r.scene.fractal };
    if (r.description) ex.description = r.description;
    if (r.unknown.length) ex.unknown = Object.fromEntries(r.unknown.map(u => [`${u.section === 'main_parameters' ? '' : u.section + ':'}${u.name}`, u.raw]));
    for (const u of r.unknown) unknown.set(u.name, (unknown.get(u.name) || 0) + 1);
    examples.push(ex);
  }
  return { examples, unknown };
}

// ---------------------------------------------------------------- example collections

// Each collection folder upstream names its author and licence, for example
// "Graeme McLaren  collection - license Creative Commons  (CC-BY 4.0)". No folder has a licence
// file, so the folder name is the licence statement. The site may be commercial, so only a
// licence with no NC (non-commercial) and no ND (no derivatives) term is used.
const LICENCE_OK = (lic) => /^CC-BY(-SA)? \d/.test(lic) && !/-(NC|ND)\b/.test(lic);
const LICENCE_URL = (lic) => {
  const m = lic.match(/^CC-([A-Z-]+) ([\d.]+)$/);
  return m ? `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/` : null;
};

export function parseCollectionDir(name) {
  const lic = (name.match(/\(\s*(CC-[A-Z-]+\s+[\d.]+)\s*\)/) || [])[1]?.replace(/\s+/g, ' ') ?? null;
  const head = name.replace(/\s*-?\s*license\b.*$/i, '').trim();
  const [who, ...rest] = head.split(/\s+-\s+|\s+collection\b/i).map(t => t.trim()).filter(Boolean);
  return { author: who || head, subject: rest.join(' ').replace(/-$/, '').trim() || null, licence: lic };
}

// Scene features the WebGPU port does not render (see the "Not ported" notes in shaders/).
// A collection scene that turns one on would look wrong, so it is left out.
const MISSING_FEATURES = [
  [/^boolean_operators$/, 'boolean operators (objects tree)'],
  [/^primitive_\w+_enabled$/, 'primitive objects'],
  [/^mat\d+_use_\w*texture$|^mat\d+_texture_fractalize$/, 'textures'],
  [/^fake_lights_enabled$/, 'fake lights'],
  [/^clouds_enable$/, 'clouds'],
  [/^stereo_enabled$/, 'stereo'],
];

function missingFeature(main) {
  for (const [k, v] of Object.entries(main)) {
    if (v !== true) continue;
    for (const [re, why] of MISSING_FEATURES) if (re.test(k)) return why;
  }
  return null;
}

// drop: { "<folder>/<file>": reason } from tools/collections-drop.json (render check failures).
function buildCollections(UP, P, drop = {}) {
  const dir = path.join(UP, 'deploy/share/mandelbulber2/examples');
  const collections = [], examples = [];
  const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    .sort((a, b) => a.localeCompare(b));
  for (const d of dirs) {
    const info = parseCollectionDir(d);
    const files = fs.readdirSync(path.join(dir, d)).filter(f => f.endsWith('.fract')).sort((a, b) => a.localeCompare(b));
    const c = { dir: d, ...info, licenceUrl: info.licence ? LICENCE_URL(info.licence) : null,
      files: files.length, included: 0, dropped: {} };
    c.allowed = !!info.licence && LICENCE_OK(info.licence);
    collections.push(c);
    if (!c.allowed) continue;
    const ci = collections.length - 1;
    for (const f of files) {
      const rel = `${d}/${f}`;
      const r = fractToScene(read(path.join(dir, d, f)), P, { fill: false });
      const why = drop[rel] ? `render check: ${drop[rel]}` : missingFeature(r.scene.main);
      if (why) { const k = why.replace(/:.*$/, ''); c.dropped[k] = (c.dropped[k] || 0) + 1; (c.droppedFiles ||= []).push(`${f}: ${why}`); continue; }
      const ex = { file: rel, title: path.basename(f, '.fract').replace(/[_]+/g, ' ').trim(), collection: ci,
        version: r.version, main: r.scene.main, fractal: r.scene.fractal };
      if (r.description) ex.description = r.description;
      examples.push(ex);
      c.included++;
    }
  }
  return { collections, examples };
}

function writeCredits(outDir, collections) {
  const ok = collections.filter(c => c.allowed), no = collections.filter(c => !c.allowed);
  const lines = [
    '# Example collection credits',
    '',
    'gen/collections.json holds scenes from the example collection folders of Mandelbulber2',
    '(github.com/buddhi1980/mandelbulber2, commit 600da8d,',
    '`mandelbulber2/deploy/share/mandelbulber2/examples/<folder>/`). Each folder name states the',
    'author and the licence. The page shows the author and the licence on every scene from a',
    'collection. tools/catalog.mjs migrates each file to the current settings, as for the main',
    'examples. It changes no value of the scene.',
    '',
    '## Included',
    '',
    '| Collection | Author | Licence | Files | Included |',
    '| --- | --- | --- | --- | --- |',
    ...ok.map(c => `| ${c.dir} | ${c.author} | [${c.licence}](${c.licenceUrl}) | ${c.files} | ${c.included} |`),
    '',
    'A scene is left out when it turns on a feature that the WebGPU port does not render, or when',
    'it failed the headless render check (tools/collections-drop.json):',
    '',
    ...ok.filter(c => c.droppedFiles?.length).flatMap(c => [`- ${c.author}:`, ...c.droppedFiles.map(f => `  - ${f}`)]),
    '',
    '## Excluded',
    '',
    'These folders carry a non-commercial licence, so the site does not ship them:',
    '',
    ...no.map(c => `- ${c.dir} (${c.files} files): ${c.licence ?? 'no licence'}, not free for commercial use`),
    '',
    '## Site originals',
    '',
    'gen/originals.json holds scenes made for this site (tools/originals.mjs). They use the',
    'Mandelbulber formulas and the same GPL-3.0 terms as the page.',
    '',
  ];
  fs.writeFileSync(path.join(outDir, 'CREDITS-examples.md'), lines.join('\n'));
}

// ---------------------------------------------------------------- host-only fields

// Some sFractal fields exist only on the CPU side (for example bulb.degree, which no
// OpenCL formula reads), so sFractalCl and gen/layout.json have no slot for them. Such a
// param keeps its record, but its path becomes null and hostPath keeps the upstream path.
// Without gen/layout.json (translate.mjs has not run) nothing changes.
function dropHostOnlyPaths(P, outDir) {
  const file = path.join(outDir, 'layout.json');
  if (!fs.existsSync(file)) return [];
  const fields = Object.keys(JSON.parse(read(file)).Fractal.fields).map(k => k.replace(/\[(\d+)\]/g, '.$1'));
  const known = new Set();
  for (const f of fields) { const parts = f.split('.'); for (let i = 1; i <= parts.length; i++) known.add(parts.slice(0, i).join('.')); }
  const out = [];
  for (const [name, rec] of Object.entries(P.fractal)) {
    if (!rec.path || known.has(rec.path.replace(/\[(\d+)\]/g, '.$1'))) continue;
    rec.hostPath = rec.path;
    rec.path = null;
    out.push(`${name}->${rec.hostPath}`);
  }
  return out;
}

// ---------------------------------------------------------------- main entry

export async function buildCatalog(UP, outDir, opts = {}) {
  const log = opts.log || console.log;
  fs.mkdirSync(outDir, { recursive: true });

  // params.json
  const { P, errors, E } = buildParams(UP);
  const hostOnly = dropHostOnlyPaths(P, outDir);
  if (hostOnly.length) log(`params.json: ${hostOnly.length} sFractal paths have no sFractalCl field, path set to null: ${hostOnly.join(' ')}`);
  const writeJson = (name, obj) => { const t = JSON.stringify(obj); fs.writeFileSync(path.join(outDir, name), t); return t.length; };
  const sizes = {};
  sizes['params.json'] = writeJson('params.json', P);

  // Formula list.
  const csv = parseCsv(read(path.join(UP, 'deploy/formulaData.csv')));
  const { defs, byClass, order, headers } = buildFormulaList(UP, E);
  const has = (sub, ext) => new Set(fs.readdirSync(path.join(UP, 'formula', sub)).filter(f => f.endsWith(ext)).map(f => f.slice(0, -ext.length)));
  const cl = has('opencl', '.cl'), ui = has('ui', '.ui'), img = has('img', '.png');

  const thumbs = opts.skipThumbs ? JSON.parse(read(path.join(outDir, 'thumbs.json'))) : buildThumbs(UP, outDir);

  // Groups from the combo box headers, in list order.
  const groups = [];
  const groupOf = new Map(), listIndex = new Map();
  let section = '', cur = null;
  order.forEach((cls, i) => {
    const d = byClass.get(cls);
    if (!d) return;
    listIndex.set(d.enumName, i);
    for (const h of headers.filter(h => h.enumName === d.enumName)) {
      if (h.title.startsWith('***')) { section = h.title.replace(/\*/g, '').trim(); cur = null; }
      if (!h.title.startsWith('***') || !headers.some(x => x.enumName === d.enumName && !x.title.startsWith('***'))) {
        cur = { name: h.title.startsWith('***') ? section : h.title, section, ids: [] };
        groups.push(cur);
      }
    }
    if (cur) { cur.ids.push(d.enumName); groupOf.set(d.enumName, groups.length - 1); }
  });

  const survey = new Map();
  const formulas = [], problems = [];
  const missParams = new Map();
  for (const row of csv) {
    const d = defs.get(row.index);
    if (!d) { problems.push(`csv ${row.index}: no definition .cpp`); continue; }
    const file = d.file;
    const enumId = E.get(`enumFractalFormula::${row.index}`);
    const f = {
      id: row.index, file, name: row.name, enumId,
      deType: row.deType, deFunction: row.deFunctionType, bailout: Number(row.defaultBailout),
      coloring: row.coloringFunction, cpixel: row.pixelAddition, analytic: row.analyticFunction,
      group: groupOf.has(row.index) ? groupOf.get(row.index) : null,
      order: listIndex.has(row.index) ? listIndex.get(row.index) : null,
      thumb: thumbs.index[file] ?? null,
      params: [],
    };
    if (enumId === undefined) problems.push(`${row.index}: no enumFractalFormula value`);
    if (!cl.has(file)) { f.noCl = true; problems.push(`${row.index} (${file}): no .cl`); }
    if (!img.has(file)) problems.push(`${row.index} (${file}): no .png`);
    if (ui.has(file)) {
      const u = parseUi(path.join(UP, 'formula/ui', file + '.ui'), survey);
      if (u.info) f.info = u.info;
      for (const p of u.params) {
        const spec = P.fractal[p.name];
        if (!spec) {
          if (!missParams.has(p.name)) missParams.set(p.name, []);
          missParams.get(p.name).push(file);
          p.missing = true;
        } else {
          if (p.min === undefined && spec.min !== undefined) p.min = spec.min;
          if (p.max === undefined && spec.max !== undefined) p.max = spec.max;
          if (spec.options && p.kind === 'list' && !p.options?.length) p.options = spec.options;
        }
        f.params.push(p);
      }
    } else { f.noUi = true; problems.push(`${row.index} (${file}): no .ui`); }
    formulas.push(f);
  }
  const catalog = { formulas, groups: groups.map(g => ({ name: g.name, section: g.section, count: g.ids.length })) };
  sizes['catalog.json'] = writeJson('catalog.json', catalog);

  // Examples. The main folder goes to examples.json, the collection folders to collections.json.
  const ex = buildExamples(UP, P);
  sizes['examples.json'] = writeJson('examples.json', { examples: ex.examples });
  let col = null;
  if (opts.collections !== false) {
    const dropFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'collections-drop.json');
    const drop = fs.existsSync(dropFile) ? JSON.parse(read(dropFile)) : {};
    col = buildCollections(UP, P, drop);
    const strip = ({ allowed, droppedFiles, ...c }) => ({ ...c, allowed });
    sizes['collections.json'] = writeJson('collections.json', { collections: col.collections.map(strip), examples: col.examples });
    writeCredits(outDir, col.collections);
  }

  // Validation report.
  const csvFiles = new Set(formulas.map(f => f.file));
  const defFiles = new Set([...defs.values()].map(d => d.file).filter(Boolean));
  const stats = {
    counts: {
      csvRows: csv.length, definitions: defs.size, cl: cl.size, ui: ui.size, png: img.size,
      catalogFormulas: formulas.length,
      withUi: formulas.filter(f => !f.noUi).length, withCl: formulas.filter(f => !f.noCl).length,
      withThumb: formulas.filter(f => f.thumb !== null).length,
      catalogParams: formulas.reduce((a, f) => a + f.params.length, 0),
      groups: groups.length,
    },
    params: {
      fractal: Object.keys(P.fractal).length, slotLevel: P.slotParams.length, main: Object.keys(P.main).length,
      mainSlotKeys: Object.keys(P.main).filter(k => P.main[k].slot).length,
      fractalWithPath: Object.values(P.fractal).filter(r => r.path).length,
      fractalNoPath: Object.entries(P.fractal).filter(([, r]) => !r.path).map(([k]) => k),
      derivedFields: P.derivedFields.length, mainPaths: Object.keys(P.mainPaths).length, mainDerived: P.mainDerived.length,
      material: Object.keys(P.templates.material.params).length, light: Object.keys(P.templates.light.params).length,
      primitiveCommon: Object.keys(P.templates.primitive.common).length,
      primitiveTypes: Object.fromEntries(Object.entries(P.templates.primitive.types).map(([k, v]) => [k, Object.keys(v).length])),
      initErrors: errors,
    },
    mainPathsNotInParams: Object.keys(P.mainPaths).filter(k => !P.main[k]),
    problems,
    extraDefs: [...defFiles].filter(f => !csvFiles.has(f)),
    clNotInCsv: [...cl].filter(f => !csvFiles.has(f)),
    uiNotInCsv: [...ui].filter(f => !csvFiles.has(f)),
    uiParamsMissing: Object.fromEntries(missParams),
    uiParamKindMismatch: [],
    widgetSurvey: Object.fromEntries([...survey.entries()].sort((a, b) => b[1] - a[1])),
    examples: { files: ex.examples.length, unknownParams: Object.fromEntries([...ex.unknown.entries()].sort((a, b) => b[1] - a[1])) },
    collections: col ? col.collections.map(c => ({ dir: c.dir, author: c.author, licence: c.licence, allowed: c.allowed, files: c.files, included: c.included, dropped: c.dropped })) : 'skipped',
    sizes,
  };
  const kindMap = { double: ['double'], int: ['int'], bool: ['bool'], vect3: ['vect3'], vect4: ['vect4'], list: ['int'] };
  for (const f of formulas) for (const p of f.params) {
    const s = P.fractal[p.name];
    if (s && !kindMap[p.kind].includes(s.type)) stats.uiParamKindMismatch.push(`${f.file}:${p.name} ui=${p.kind} param=${s.type}`);
  }
  sizes['thumbs.jpg'] = fs.statSync(path.join(outDir, 'thumbs.jpg')).size;
  sizes['thumbs.json'] = fs.statSync(path.join(outDir, 'thumbs.json')).size;
  return stats;
}

// CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const UP = process.argv[2];
  if (!UP) { console.error('usage: node tools/catalog.mjs <UP> [outDir] [--no-collections]'); process.exit(2); }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const outDir = outArg ? path.resolve(outArg === 'gen' ? path.join(here, '..', 'gen') : outArg) : path.join(here, '..', 'gen');
  const stats = await buildCatalog(UP, outDir, { collections: !process.argv.includes('--no-collections') });
  console.log(JSON.stringify(stats, null, 1));
}
