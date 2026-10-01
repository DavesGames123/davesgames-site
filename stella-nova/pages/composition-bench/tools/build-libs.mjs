#!/usr/bin/env node
// ============================================================================
//  COMPOSITION BENCH  ·  tools/build-libs.mjs — the node-library generator
// ────────────────────────────────────────────────────────────────────────────
//  Reads each shader-table page (spec.json or styles.json, its WGSL pack and
//  its page.js) and writes the bench node libraries. Run it again when a table
//  changes. It writes nothing outside ../libs/.
//
//      node stella-nova/pages/composition-bench/tools/build-libs.mjs
//      node .../build-libs.mjs --check      parse and report, write no file
//
//  OUTPUT  (../libs/)
//      index.json ...... the catalog: groups, per-library metadata and cells
//                        (no WGSL). The page loads it at boot.
//      <key>.json ...... one library's WGSL: uniform, core, entries, adapter,
//                        fams (orb) and fill (refraction). Loaded on first use.
//      ids.lock.json ... every node id that ever shipped, per library. A run
//                        that would drop a locked id stops and writes nothing,
//                        so saved graphs keep loading.
//
//  HOW A TABLE BECOMES A LIBRARY  (grep the kind name to find it)
//      kind 'fn' ....... a cell is a plain WGSL function (n_, v_, sample_);
//                        a shared adapter wraps it into fs_main.
//      kind 'fs' ....... a cell is a fragment entry fs_<name>; the node code is
//                        that entry. Image tables rebind their source texture
//                        to the bench input in0 and the sampler to smp.
//      kind 'sim' ...... a cell is a compute entry cs_<name>; the core keeps
//                        the table's bindings and its fs_present pass.
//      kind 'orb' ...... one pack per family (presence-orbs).
//      shared entry .... refraction: every cell runs fs_glass; a JS fill
//                        resolves the material config into the uniform.
//
//  WGSL PROCESSING  (splitTop / shake)
//      The pack splits into top-level declarations with their leading
//      comments. The bindings and the vertex stage go (the bench supplies
//      them). The core keeps only declarations that a cell or the adapter
//      reaches, so the bench never compiles a dead helper that reads a
//      binding the bench does not have.
//
//  UNIFORM MAPPING  (slotsFromPage)
//      The bench writes size, time, pixelScale and the three swatches at
//      floats 0..15, as every table does. page.js says where the rest go:
//      "d[16] = G.exposure" becomes an extra slider at slot 16 with the gen
//      map from spec.json, "d[18] = 1.0" becomes a fixed value, and
//      "d.set(t.knobs, 20)" sets the knob slot. TABLES overrides what a
//      regex cannot read.
// ============================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE, '..');
const PAGES = join(BENCH, '..');
const OUT = join(BENCH, 'libs');
const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------- the catalog
// Group names follow the Shader Library nav in stella-nova/index.html.
const GROUPS = ['Procedural Fields', 'Image & Color', 'Shading & Sampling', 'Surfaces & Effects', 'Elements', 'Volumetric'];

const ADAPTER = {
  noise: `
@fragment fn fs_main(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let p = select(domain(fp.xy), textureSampleLevel(in0, smp, fp.xy / u.size, 0.0).xy, b.has0 > 0.5);
    let v = n___NAME__(p, u.time, u.k);
    return vec4f(v, v, v, 1.0);
}`,
  field: `
@fragment fn fs_main(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let p = select(bench_p(fp.xy), textureSampleLevel(in0, smp, fp.xy / u.size, 0.0).xy, b.has0 > 0.5);
    let v = v___NAME__(p, u.time, u.k);
    return vec4f(p + u.speed * 0.5 * v, 0.0, 1.0);
}`,
  sampling: `
@fragment fn fs_main(@builtin(position) fp: vec4f) -> @location(0) vec4f {
    let uv = select(cell_uv(fp.xy), textureSampleLevel(in0, smp, fp.xy / u.size, 0.0).xy * 0.5 + 0.5, b.has0 > 0.5);
    let n = u32(u.count); let m = shown(); var d0 = 1e9;
    for (var i = 0u; i < m; i++) { let p = sample___NAME__(i, n, u.k); d0 = min(d0, distance(uv, p)); }
    let px = 1.12 / max(min(u.size.x, u.size.y), 1.0) / u.pixelScale; let r = u.radius * px;
    let cov = 1.0 - smoothstep(r - px, r + px, d0);
    return vec4f(cov, cov, cov, 1.0);
}`,
};

// key: the library id saved graphs use. page: the table folder.
// Only the first eight keys existed before; their ids are locked.
const TABLES = [
  { key: 'noise', page: 'noise-table', label: 'Noise', group: 'Procedural Fields', kind: 'fn', spec: 'styles.json', pack: 'shaders/noise.wgsl', pagejs: null,
    out: 'img', inputs: [['p', 'coord', true]], view: 1, adapter: ADAPTER.noise, kAt: 20,
    extras: [{ name: 'scale', i: 16, map: 'x => 0.25 + 1.75 * x', d: 0.43 }], fixed: { 17: 1 } },
  { key: 'field', page: 'field-table', label: 'Field', group: 'Procedural Fields', kind: 'fn',
    out: 'coord', inputs: [['p', 'coord', true]], view: 2, adapter: ADAPTER.field, kAt: 16,
    extras: [{ name: 'amount', i: 20, map: 'x => x * 2.0', d: 0.35 }], fixed: {} },
  { key: 'sim', page: 'simulation-table', label: 'Simulation', group: 'Procedural Fields', kind: 'sim' },
  { key: 'dotfield', page: 'dot-field-table', label: 'Dot Field', group: 'Procedural Fields', kind: 'fs' },
  { key: 'polar', page: 'polar-table', label: 'Polar & Lattice', group: 'Procedural Fields', kind: 'fs' },
  { key: 'color', page: 'color-table', label: 'Color', group: 'Image & Color', kind: 'fs', inputName: 'v' },
  { key: 'postfx', page: 'postfx-table', label: 'Post-fx', group: 'Image & Color', kind: 'fs', inputName: 'img' },
  { key: 'lighting', page: 'lighting-table', label: 'Lighting', group: 'Shading & Sampling', kind: 'fs',
    // d[18], d[19] carry the light direction, which page.js computes from the pointer
    extraSlots: { 18: { name: 'light x', map: 'x => (x - 0.5) * 1.8', d: 0.75 }, 19: { name: 'light y', map: 'x => (x - 0.5) * 1.8', d: 0.7 } } },
  { key: 'sampling', page: 'sampling-table', label: 'Sampling', group: 'Shading & Sampling', kind: 'fn',
    out: 'img', inputs: [['p', 'coord', true]], view: 1, adapter: ADAPTER.sampling, kAt: 20, extras: [], fixed: {}, samp: true },
  { key: 'refraction', page: 'refraction-table', label: 'Refraction', group: 'Surfaces & Effects', kind: 'fs', shared: 'fs_glass', inputName: 'img', fill: 'refraction', kAt: 48 },
  { key: 'solids', page: 'sdf-solids-table', label: 'SDF Solids', group: 'Surfaces & Effects', kind: 'fs' },
  { key: 'sdf2d', page: 'sdf2d-table', label: 'SDF 2D', group: 'Surfaces & Effects', kind: 'fs' },
  { key: 'metal', page: 'liquid-metal-table', label: 'Liquid Metal', group: 'Surfaces & Effects', kind: 'fs' },
  { key: 'beam', page: 'beam-table', label: 'Beam & Decal', group: 'Surfaces & Effects', kind: 'fs' },
  { key: 'fire', page: 'fire-table', label: 'Fire', group: 'Elements', kind: 'fs' },
  { key: 'fire_evolved', page: 'fire-table-evolved-1', label: 'Fire · evolved', group: 'Elements', kind: 'fs' },
  { key: 'smoke', page: 'smoke-table', label: 'Smoke', group: 'Elements', kind: 'fs' },
  { key: 'heat_haze', page: 'heat-diffraction', label: 'Heat Haze', group: 'Elements', kind: 'fs', inputName: 'img' },
  { key: 'heat_metal', page: 'heat-metal', label: 'Heat Metal', group: 'Elements', kind: 'sim' },
  { key: 'frost', page: 'frost-table', label: 'Frost', group: 'Elements', kind: 'fs' },
  { key: 'orb', page: 'presence-orbs', label: 'Orb', group: 'Volumetric', kind: 'orb', spec: 'styles.json', pagejs: null },
];
const SKIPPED_TABLES = [
  { page: 'thinking-orbs', reason: 'each cell is an instanced dot mesh: vertex entries vs_<mode> pull dot positions, two passes share a depth buffer, and page.js packs 32 profile floats per frame. The bench pass model is one full-screen fragment or compute entry per node, so no cell fits.' },
];

// ---------------------------------------------------------------- WGSL parsing
// Strip comments but keep offsets: a comment becomes spaces.
function blankComments(src) {
  let out = '', i = 0, depth = 0;
  while (i < src.length) {
    if (depth === 0 && src.startsWith('//', i)) { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; out += ' '.repeat(e - i); i = e; continue; }
    if (src.startsWith('/*', i)) { depth++; out += '  '; i += 2; continue; }
    if (depth > 0 && src.startsWith('*/', i)) { depth--; out += '  '; i += 2; continue; }
    out += depth > 0 ? (src[i] === '\n' ? '\n' : ' ') : src[i]; i++;
  }
  return out;
}
const NAME_RE = /^(?:@[\w]+(?:\([^)]*\))?\s*)*(fn|struct|const|override|alias|var(?:<[^>]*>)?|const_assert|enable|requires|diagnostic)\s*(\w*)/;
// Split into top-level declarations. Each: { lead, code, kind, name, deps, attrs }.
function splitTop(src) {
  const clean = blankComments(src); const decls = []; let start = 0, i = 0;
  const n = clean.length;
  while (i < n) {
    while (i < n && /\s/.test(clean[i])) i++;
    if (i >= n) break;
    const codeStart = i; let depth = 0; let isBlock = null;
    for (; i < n; i++) {
      const c = clean[i];
      if (isBlock === null && c !== ' ' && c !== '\n') { const head = clean.slice(codeStart, codeStart + 400); const m = head.match(NAME_RE); isBlock = !!m && (m[1] === 'fn' || m[1] === 'struct'); }
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0 && c === '}' && isBlock) { i++; break; } }
      else if (c === ';' && depth === 0) { i++; break; }
    }
    // a stray ';' after a struct belongs to it
    let j = i; while (j < n && (clean[j] === ' ' || clean[j] === '\t')) j++; if (clean[j] === ';') i = j + 1;
    const code = src.slice(codeStart, i), cc = clean.slice(codeStart, i);
    const m = cc.trim().match(NAME_RE);
    const kind = m ? m[1].replace(/<.*/, '') : '?'; const name = m ? m[2] : '';
    const attrs = (cc.match(/@(vertex|fragment|compute|group)\b/g) || []).map(s => s.slice(1));
    const deps = new Set(cc.match(/[A-Za-z_]\w*/g) || []); deps.delete(name);
    decls.push({ lead: src.slice(start, codeStart), code, clean: cc, kind, name, deps, attrs });
    start = i;
  }
  return { decls, tail: src.slice(start) };
}
// Keep a run of comment lines that touches the declaration; drop the rest of the lead.
const nearLead = lead => { const lines = lead.replace(/\s+$/, '').split('\n'); const out = []; for (let k = lines.length - 1; k >= 0; k--) { if (/^\s*\/\//.test(lines[k])) out.unshift(lines[k]); else break; } return out.length ? out.join('\n') + '\n' : ''; };
const declText = d => nearLead(d.lead) + d.code;
// the names a set of WGSL sources reach through top-level declarations
function shake(decls, rootSrc) {
  const byName = new Map(); for (const d of decls) if (d.name) { if (!byName.has(d.name)) byName.set(d.name, []); byName.get(d.name).push(d); }
  const keep = new Set(); const work = [...new Set(blankComments(rootSrc).match(/[A-Za-z_]\w*/g) || [])];
  while (work.length) { const nm = work.pop(); for (const d of byName.get(nm) || []) { if (keep.has(d)) continue; keep.add(d); for (const x of d.deps) work.push(x); } }
  return keep;
}
const fileHeader = src => { const m = src.match(/^(\s*\/\/[^\n]*\n)+/); return m ? m[0] : ''; };
const replaceIdent = (s, from, to) => s.replace(new RegExp('\\b' + from + '\\b', 'g'), to);

// ---------------------------------------------------------------- page.js slots
function slotsFromPage(js) {
  const m = js.match(/draw\(enc[\s\S]*?\n {2}\},?\n/); const body = m ? m[0] : js;
  const slots = {}; let kAt = null;
  for (const [, i, expr] of body.matchAll(/d\[(\d+)\]\s*=\s*([^;]+);/g)) if (+i >= 16) slots[+i] = expr.trim();
  const k = body.match(/d\.set\(t\.knobs,\s*(\d+)\)/); if (k) kAt = +k[1];
  return { slots, kAt };
}
const constObj = (js, name) => { const m = js.match(new RegExp('const ' + name + '\\s*=\\s*(\\{[^}]*\\})')); return m ? JSON.parse(m[1]) : null; };

// ---------------------------------------------------------------- builders
const warn = []; const skipped = [];
const read = (...p) => readFileSync(join(PAGES, ...p), 'utf8');
const cellsOf = (T) => { const j = JSON.parse(read(T.page, T.spec || 'spec.json')); return Array.isArray(j) ? { cells: j, gens: [] } : j; };
const knobsOf = c => Array.isArray(c.knobs[0]) ? c.knobs.map(k => k[0]) : c.knobs;
const defaultsOf = c => c.defaults || (Array.isArray(c.knobs[0]) ? c.knobs.map(k => k[1]) : [0.5, 0.5, 0.5, 0.5]);
const benchCell = c => { const o = { name: c.name, family: c.family, line: c.species || c.line || '', knobs: knobsOf(c), defaults: defaultsOf(c) }; return o; };

// The bench header (shaders/head.wgsl) owns these names at module scope.
const RESERVED = ['in0', 'in1', 'smp', 'b', 'BenchB', 'bench_p', 'vs_main'];

function uniformBlock(decls) {
  const ub = decls.find(d => d.kind === 'var' && /var<uniform>\s*u\s*:/.test(d.clean));
  if (!ub) return null; const sname = ub.clean.match(/:\s*(\w+)/)[1];
  const st = decls.find(d => d.kind === 'struct' && d.name === sname);
  return { ub, st, text: declText(st).trim() + '\n@group(0) @binding(0) var<uniform> u: ' + sname + ';\n' };
}

function buildFnOrFs(T) {
  const spec = cellsOf(T); const src = read(T.page, T.pack || 'shaders/pack.wgsl');
  const { decls } = splitTop(src); const U = uniformBlock(decls);
  if (!U) throw new Error(T.page + ': no var<uniform> u');
  if (!/size:\s*vec2f,\s*time:\s*f32,\s*pixelScale:\s*f32,\s*ink:\s*vec4f,\s*tone:\s*vec4f,\s*cream:\s*vec4f/.test(U.st.clean.replace(/\s+/g, ' ').replace(/ ,/g, ','))) warn.push(`${T.key}: uniform header differs from size/time/pixelScale/ink/tone/cream`);
  // bindings: the uniform goes to the uniform block, a source texture becomes in0, a sampler smp
  const ren = {}; let tex = 0;
  for (const d of decls) if (d.kind === 'var' && d.attrs.includes('group') && d !== U.ub) {
    if (/texture_2d/.test(d.clean)) ren[d.name] = tex++ === 0 ? 'in0' : 'in1';
    else if (/sampler/.test(d.clean)) ren[d.name] = 'smp';
  }
  const fix = s => { for (const [a, b2] of Object.entries(ren)) if (a !== b2) s = replaceIdent(s, a, b2); return s; };
  const body = decls.filter(d => !(d.kind === 'var' && d.attrs.includes('group')) && d !== U.st && !d.attrs.includes('vertex'));
  for (const d of body) if (RESERVED.includes(d.name)) warn.push(`${T.key}: module-scope name '${d.name}' clashes with the bench header`);
  const byName = new Map(body.map(d => [d.name, d]));
  const cells = []; const entries = {}; const cellDecls = new Set(); const missing = [];
  const fnName = c => T.shared || c.fn || (T.kind === 'fn' ? '' : 'fs_' + c.name);
  for (const c of spec.cells) {
    const d = byName.get(fnName(c));
    if (!d) { missing.push(c.name); continue; }
    cells.push(Object.assign(benchCell(c), T.shared && c.cfg ? { cfg: c.cfg } : {}));
    if (!T.shared) { cellDecls.add(d); entries[c.name] = fix(declText(d)); }
  }
  if (T.shared) { const d = byName.get(T.shared); cellDecls.add(d); entries['*'] = fix(declText(d)); }
  for (const nm of missing) skipped.push({ lib: T.key, node: nm, reason: `no ${fnName({ name: nm })} in the pack` });
  // A cell function that the core or another cell calls stays in the core, and
  // its node code is the adapter alone. Entry points cannot be called, so this
  // applies to kind 'fn' only.
  const rest = body.filter(d => !cellDecls.has(d)); const inCore = new Set();
  const adapterRoot = (T.adapter || '').replace(/__NAME__/g, '');
  const cellOfDecl = new Map(); for (const c of spec.cells) { const d = byName.get(fnName(c)); if (d) cellOfDecl.set(d, c.name); }
  let core;
  for (let moved = true; moved;) {
    moved = false; core = shake([...rest, ...inCore], Object.values(entries).join('\n') + adapterRoot);
    if (T.kind !== 'fn') break;
    for (const d of cellDecls) {
      if (inCore.has(d)) continue; const re = new RegExp('\\b' + d.name + '\\b'); const own = cellOfDecl.get(d);
      const used = [...core].some(k => k.deps.has(d.name)) || Object.entries(entries).some(([nm, e]) => nm !== own && re.test(blankComments(e)));
      if (used) { inCore.add(d); moved = true; entries[own] = `// ${d.name} lives in the library core: other code calls it\n`; }
    }
  }
  const coreText = fileHeader(src) + '\n' + body.filter(d => core.has(d)).map(d => fix(declText(d))).join('\n') + '\n';
  return { cells, gens: spec.gens || [], uniform: U.text, core: coreText, entries };
}

function buildSim(T) {
  const spec = cellsOf(T); const src = read(T.page, 'shaders/pack.wgsl'); const js = read(T.page, 'page.js');
  const MODES = constObj(js, 'MODES'), STEPS = constObj(js, 'STEPS');
  if (!MODES || !STEPS) throw new Error(T.page + ': no MODES/STEPS in page.js');
  const { decls, tail } = splitTop(src); const byName = new Map(decls.map(d => [d.name, d]));
  const cells = []; const entries = {}; const cellDecls = new Set();
  for (const c of spec.cells) {
    const d = byName.get(c.fn || 'cs_' + c.name);
    if (!d || !d.attrs.includes('compute')) { skipped.push({ lib: T.key, node: c.name, reason: 'no compute entry in the pack' }); continue; }
    cells.push(Object.assign(benchCell(c), { mode: MODES[c.name] ?? 0, steps: STEPS[c.name] ?? 1 }));
    entries[c.name] = declText(d); cellDecls.add(d);
  }
  const core = decls.filter(d => !cellDecls.has(d)).map(d => d.lead + d.code).join('') + tail;
  if (!/fn fs_present/.test(core)) throw new Error(T.page + ': no fs_present');
  return { cells, gens: spec.gens || [], uniform: '', core, entries };
}

function buildOrb(T) {
  const spec = cellsOf(T); const fams = {}; const cells = []; const entries = {};
  const famNames = [...new Set(spec.cells.map(c => c.family))];
  for (const f of famNames) {
    const src = read(T.page, 'shaders', f + '.wgsl'); const { decls } = splitTop(src);
    const body = decls.filter(d => !d.attrs.includes('vertex'));
    const byName = new Map(body.map(d => [d.name, d]));
    const cellDecls = new Set(); const fe = {};
    for (const c of spec.cells.filter(c => c.family === f)) {
      const a = byName.get(c.fn), e = byName.get('fs_' + c.name);
      if (!a || !e) { skipped.push({ lib: T.key, node: c.name, reason: `no ${c.fn} or fs_${c.name} in ${f}.wgsl` }); continue; }
      cellDecls.add(a); cellDecls.add(e); fe[c.name] = declText(a) + '\n' + declText(e);
      cells.push(benchCell(c)); entries[c.name] = fe[c.name];
    }
    const rest = body.filter(d => !cellDecls.has(d));
    const keep = shake(rest, Object.values(fe).join('\n'));
    fams[f] = { core: fileHeader(src) + body.filter(d => keep.has(d)).map(declText).join('\n') + '\n', entries: fe };
  }
  return { cells, gens: [], uniform: '', core: '', entries, fams };
}

// Refraction: page.js resolves the glass config per frame. This fill is a port
// of PAGE.resolve and the uniform half of PAGE.draw. The constants and
// profilePeak are copied from page.js on each run, so preset edits carry over.
function refractionFill(js) {
  const grab = re => { const m = js.match(re); if (!m) throw new Error('refraction-table/page.js: ' + re); return m[0]; };
  const DEF = grab(/const DEFAULT_CONFIG = \{[^\n]*\};/);
  const MAT = grab(/const MATERIAL_PRESETS = \{[\s\S]*?\n\};/);
  const LUMA = grab(/const LUMA_LIGHT = [^\n]*;/);
  const PEAK = grab(/const peakCache = new Map\(\);\nfunction profilePeak[\s\S]*?\n\}/);
  if (!/d\.set\(\[cx, cy, hw, hh, radius, c\.bezelWidth/.test(js) || !/d\.set\(t\.knobs, 48\)/.test(js)) warn.push('refraction: page.js draw() changed; check the fill port in build-libs.mjs');
  return `(() => {
${DEF}
${MAT}
${LUMA}
${PEAK}
return (d, a) => {
  const o = a.cell.cfg || {}; const preset = o.material ? MATERIAL_PRESETS[o.material] : {};
  const c = { ...DEFAULT_CONFIG, ...preset, ...o }; const k = a.k;
  c.refractionStrength *= Math.pow(4, k[0] - 0.5); c.bezelWidth *= Math.pow(4, k[1] - 0.5); c.blur *= Math.pow(4, k[2] - 0.5) * (k[2] > 0.02 ? 1 : 0); c.chromaticAberration = Math.min(1, c.chromaticAberration * 2 * k[3]);
  c.refractionStrength *= a.x.lensing;
  const zoom = a.TEX / 420, W = 420, H = 420, cell = 420; const shape = o.shape || 'rect';
  const half = shape === 'pill' ? [0.39, 0.17] : shape === 'circle' ? [0.26, 0.26] : shape === 'squircle' ? [0.3, 0.3] : [0.36, 0.26];
  const hw = half[0] * cell, hh = half[1] * cell; const radius = shape === 'rect' ? c.borderRadius : 1e4;
  const drift = a.x.drift; const cx = W / 2 + drift * 0.17 * cell * Math.sin(a.T * 0.6), cy = H / 2 + drift * 0.1 * cell * Math.sin(a.T * 0.45 + 1.3);
  const dark = o.appearance ? o.appearance === 'dark' : true; const L = dark ? LUMA_DARK : LUMA_LIGHT;
  const bezel = Math.min(c.bezelWidth, hw, hh); const peak = profilePeak(c.thickness, bezel, c.ior);
  const tint = c.tint.split(',').map(x => +x / 255);
  d[0] = W; d[1] = H; d[3] = zoom;
  d.set([cx, cy, hw, hh, radius, c.bezelWidth, c.thickness, c.ior, c.refractionStrength, c.blur, c.saturation, c.tintOpacity, tint[0], tint[1], tint[2], c.chromaticAberration,
    c.lightAngle, c.edgeHighlight, c.specularStrength, c.fresnelPower, c.elevation, c.noiseOpacity, c.noiseScale, L, dark ? 1 : 0, 1, peak, c.adaptiveTint ? 1 : 0, 0, c.showMap || 0, c.superN || 0, 0], 16);
  d.set(k, 48);
};
})()`;
}

// ---------------------------------------------------------------- run
const index = { generated: new Date().toISOString(), generator: 'tools/build-libs.mjs', groups: GROUPS.map(g => ({ name: g, libs: [] })), libs: {}, skipped: [] };
const files = {};
for (const T of TABLES) {
  let r;
  try { r = T.kind === 'sim' ? buildSim(T) : T.kind === 'orb' ? buildOrb(T) : buildFnOrFs(T); }
  catch (e) { console.error(`FAIL ${T.key} (${T.page}): ${e.message}`); process.exitCode = 1; continue; }
  const meta = { label: T.label, page: T.page, group: T.group, cells: r.cells, file: T.key + '.json' };
  if (T.kind === 'fn') Object.assign(meta, { out: T.out, inputs: T.inputs, view: T.view, entry: 'fs_main', kAt: T.kAt, extras: T.extras, fixed: T.fixed }, T.samp ? { samp: true } : {});
  else if (T.kind === 'sim') Object.assign(meta, { out: 'img', inputs: [], view: 0, entry: 'cs___NAME__', kAt: 16, extras: [], fixed: {}, sim: true });
  else if (T.kind === 'orb') Object.assign(meta, { out: 'img', inputs: [], view: 0, entry: 'fs___NAME__', kAt: 25, extras: [{ name: 'hue', i: 20, map: 'x => x - 0.5', d: 0.5 }, { name: 'depth', i: 23, map: 'x => x', d: 0.5 }, { name: 'glow', i: 24, map: 'x => x', d: 0.5 }, { name: 'level', i: 32, map: 'x => x', d: 0.5 }, { name: 'activity', i: 33, map: 'x => x', d: 0.5 }], fixed: {}, orb: true });
  else {
    const js = read(T.page, 'page.js'); const { slots, kAt } = slotsFromPage(js);
    const src = read(T.page, 'shaders/pack.wgsl'); const image = /texture_2d<f32>/.test(src);
    const extras = [], fixed = {};
    for (const [i, expr] of Object.entries(slots)) {
      if (T.kAt && +i >= T.kAt) continue;
      const gm = expr.match(/^G\.(\w+)$/);
      if (T.extraSlots && T.extraSlots[i]) extras.push(Object.assign({ i: +i }, T.extraSlots[i]));
      else if (gm) { const g = (r.gens || []).find(x => x.id === gm[1]); if (!g) { warn.push(`${T.key}: slot ${i} reads G.${gm[1]}, no such gen`); continue; } extras.push({ name: g.title.split('·')[0].trim().toLowerCase(), i: +i, map: g.map, d: g.bias }); }
      else if (/^-?\d+(\.\d+)?$/.test(expr)) fixed[i] = +expr;
      else warn.push(`${T.key}: slot ${i} = '${expr}' has no bench mapping; it stays 0`);
    }
    if (T.fill) for (const g of r.gens || []) if (g.id !== 'tempo') extras.push({ name: g.id, i: -1, map: g.map, d: g.bias });
    Object.assign(meta, { out: 'img', inputs: image ? [[T.inputName || 'img', 'img', false]] : [], view: 0, entry: T.shared || 'fs___NAME__', kAt: T.kAt || kAt || 20, extras, fixed });
    if (T.shared) meta.shared = true;
    if (T.fill) r.fill = refractionFill(js);
  }
  index.libs[T.key] = meta; index.groups.find(g => g.name === T.group).libs.push(T.key);
  files[T.key] = { uniform: r.uniform, core: r.core, entries: r.entries, adapter: T.adapter || '' };
  if (r.fams) files[T.key].fams = r.fams;
  if (r.fill) files[T.key].fill = r.fill;
}
index.skipped = [...SKIPPED_TABLES.map(s => ({ lib: null, page: s.page, node: '*', reason: s.reason })), ...skipped];

// ---------------------------------------------------------------- id lock
const lockPath = join(OUT, 'ids.lock.json');
let lock = {};
if (existsSync(lockPath)) lock = JSON.parse(readFileSync(lockPath, 'utf8'));
else if (existsSync(join(BENCH, 'libs.json'))) { const old = JSON.parse(readFileSync(join(BENCH, 'libs.json'), 'utf8')); for (const [k, L] of Object.entries(old)) lock[k] = L.cells.map(c => c.name); console.log('seeded ids.lock.json from libs.json'); }
const lost = [];
for (const [k, ids] of Object.entries(lock)) { const now = new Set((index.libs[k] || { cells: [] }).cells.map(c => c.name)); for (const id of ids) if (!now.has(id)) lost.push(k + '/' + id); }
for (const [k, L] of Object.entries(index.libs)) lock[k] = [...new Set([...(lock[k] || []), ...L.cells.map(c => c.name)])];

// ---------------------------------------------------------------- report and write
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log('library        group                cells  file');
let total = 0;
for (const [k, L] of Object.entries(index.libs)) { const s = JSON.stringify(files[k]); total += s.length; L.bytes = s.length; console.log(`${k.padEnd(14)} ${L.group.padEnd(20)} ${String(L.cells.length).padStart(5)}  ${kb(s.length)}`); }
console.log(`total ${Object.values(index.libs).reduce((a, L) => a + L.cells.length, 0)} nodes in ${Object.keys(index.libs).length} libraries, ${kb(total)} of WGSL files`);
for (const s of index.skipped) console.log(`skipped ${s.lib || s.page}/${s.node}: ${s.reason}`);
for (const w of warn) console.log('warning ' + w);
if (lost.length) { console.error('STOP: these locked node ids are gone, saved graphs would break:\n  ' + lost.join('\n  ')); process.exit(1); }
if (process.exitCode) { console.error('STOP: a library failed; nothing written'); process.exit(1); }
if (CHECK_ONLY) { console.log('--check: nothing written'); process.exit(0); }
mkdirSync(OUT, { recursive: true });
for (const [k, f] of Object.entries(files)) writeFileSync(join(OUT, k + '.json'), JSON.stringify(f));
const idx = JSON.stringify(index); writeFileSync(join(OUT, 'index.json'), idx);
writeFileSync(lockPath, JSON.stringify(lock, null, 1) + '\n');
console.log(`wrote libs/index.json (${kb(idx.length)}), ${Object.keys(files).length} library files, ids.lock.json`);
