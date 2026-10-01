// ============================================================================
//  STELLA NOVA  ·  lib/bench-wgsl.js — Composition Bench catalog and WGSL assembly
// ────────────────────────────────────────────────────────────────────────────
//  The DOM-free part of the Composition Bench runtime. Two pages use it:
//  pages/composition-bench/main.js (the bench itself) and
//  pages/material-studio/nodes/bench.js (bench cells as material nodes).
//  It holds no GPU objects and touches no DOM, so it also runs in Node.
//
//  DATA FLOW
//      loadBenchCatalog(base) ... fetch libs/index.json, generic.json and the
//                                 four header shaders under `base` (the bench
//                                 folder URL). It returns one catalog object.
//      catalog.ensureLib(key) ... fetch libs/<key>.json on first use and merge
//                                 its WGSL into catalog.LIBS[key].
//      catalog.moduleFor(n) ..... one complete WGSL module for a node
//                                 n = {kind, fn?, op?, code}.
//      catalog.fillUniform(n, d, env)  pack the 256-byte bench uniform.
//
//  SECTIONS  (grep -n the name to jump)
//      constants ........... BENCH_TEX / BENCH_UBYTES / BENCH_STATES / hexToRgb
//      layouts ............. BENCH_BGL_ENTRIES / BENCH_CBGL_ENTRIES / BENCH_PBGL_ENTRIES
//      loadBenchCatalog .... fetch the catalog, compile the extras maps
//      ensureLib ........... lazy fetch of one library's WGSL
//      cellOf / defOf ...... node -> catalog cell / library or generic kind
//      templateCode ........ the default WGSL of a node (entry + adapter)
//      entryOf ............. the entry point name of a node
//      coreKeyOf / coreSrcOf  the library core a node needs (packSrc dedup)
//      moduleFor ........... uniform + head + vertex stage + core + node code
//      fillUniform ......... the bench uniform: swatches, knobs, extras, fill
//      cellCount ........... number of cells over all libraries
//
//  NODE SHAPE  (what the functions read)
//      kind ... a library key (noise, orb, ...) or a generic kind (blend, ...)
//      fn ..... library cell name        op ...... generic op name
//      code ... the WGSL of the node     k ....... four knobs 0..1
//      xk ..... one value per library extra      state, stateAt ... orb only
//
//  THE BENCH UNIFORM  (fillUniform)
//      Floats 0..15 hold size, time, pixelScale and the ink, tone and cream
//      swatches, as in every shader table. L.kAt places the four knobs.
//      L.extras place the sliders (slot i; -1 is a value only the fill reads).
//      L.fixed holds constants. L.fillFn computes the rest (refraction).
//      Orb libraries use their own layout (OrbU), written field by field.
// ============================================================================

// ------------------------------------------------------------ constants
/** Pass texture size of the bench graph, in texels (square). */
export const BENCH_TEX = 512;
/** Byte size of every bench uniform buffer. */
export const BENCH_UBYTES = 256;
/** Orb presence states, in uniform order. */
export const BENCH_STATES = Object.freeze(['idle', 'listening', 'thinking', 'responding', 'success', 'error']);
/** Default bench swatches (sRGB hex), as in composition-bench/index.html. */
export const BENCH_PALETTE = Object.freeze({ ink: '#0e1118', tone: '#5a8cc0', cream: '#e8ecf4' });
/** '#rrggbb' -> [r, g, b] in 0..1, no transfer function (the bench writes swatches raw). */
export const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

// ------------------------------------------------------------ layouts
// Bind group layout entries of the bench passes. Pass them to
// device.createBindGroupLayout({ entries }). GPUShaderStage is read lazily
// so this module loads in Node too.
const stage = name => (globalThis.GPUShaderStage ? globalThis.GPUShaderStage[name] : 0);
/** Render pass: 0 library uniform, 1 in0, 2 sampler, 3 in1, 4 BenchB {has0, has1, mode, pad}. */
export function BENCH_BGL_ENTRIES() {
  const F = stage('FRAGMENT');
  return [
    { binding: 0, visibility: F, buffer: { type: 'uniform' } },
    { binding: 1, visibility: F, texture: {} },
    { binding: 2, visibility: F, sampler: {} },
    { binding: 3, visibility: F, texture: {} },
    { binding: 4, visibility: F, buffer: { type: 'uniform' } },
  ];
}
/** Simulation step: 0 SimU, 1 src state (rgba32float), 2 dst storage state. */
export function BENCH_CBGL_ENTRIES() {
  const C = stage('COMPUTE');
  return [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility: C, storageTexture: { format: 'rgba32float', access: 'write-only' } },
  ];
}
/** Simulation present: 0 SimU (mode in the reset slot), 1 state texture. */
export function BENCH_PBGL_ENTRIES() {
  const F = stage('FRAGMENT');
  return [
    { binding: 0, visibility: F, buffer: { type: 'uniform' } },
    { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
  ];
}

// ------------------------------------------------------------ loadBenchCatalog
const HEADER_FILES = ['shaders/head.wgsl', 'shaders/genu.wgsl', 'shaders/vs.wgsl', 'shaders/blit.wgsl'];
const catalogs = new Map();   // base URL -> Promise<catalog>

async function fetchOk(url, as) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`bench fetch failed (${r.status}): ${url}`);
  return as === 'json' ? r.json() : r.text();
}

/**
 * Load the bench catalog once per base URL. `base` is the URL of the
 * composition-bench folder (it must end in '/'). The default resolves the
 * folder from this module's own URL.
 * @param {string|URL} [base]
 * @param {{fresh?:boolean}} [opts]  fresh: skip the per-URL cache
 * @returns {Promise<BenchCatalog>}
 */
export function loadBenchCatalog(base = new URL('../pages/composition-bench/', import.meta.url), opts = {}) {
  const key = String(base);
  if (!opts.fresh && catalogs.has(key)) return catalogs.get(key);
  const p = buildCatalog(key).catch(e => { catalogs.delete(key); throw e; });
  catalogs.set(key, p);
  return p;
}

/**
 * @typedef {Object} BenchCatalog
 * @property {string} base
 * @property {Object} INDEX       libs/index.json (groups, libs, generated)
 * @property {Object} LIBS        INDEX.libs: key -> library (WGSL merged in on ensureLib)
 * @property {Object} GENERIC     generic.json: kind -> generic node kind
 * @property {string} HEAD @property {string} GEN_UNIFORM @property {string} VS @property {string} BLIT
 */
async function buildCatalog(base) {
  const [INDEX, GENERIC, ...sh] = await Promise.all([
    fetchOk(new URL('libs/index.json', base), 'json'),
    fetchOk(new URL('generic.json', base), 'json'),
    ...HEADER_FILES.map(f => fetchOk(new URL(f, base), 'text')),
  ]);
  const [HEAD, GEN_UNIFORM, VS, BLIT] = sh;
  const LIBS = INDEX.libs;
  // Each extra maps its 0..1 slider through a JS arrow from the catalog.
  for (const L of Object.values(LIBS)) for (const e of L.extras) e.fn = new Function('return (' + e.map + ')')();
  const loading = {};

  // ---------------------------------------------------------- ensureLib
  // LIBS holds the catalog metadata at boot. ensureLib merges in the WGSL
  // (uniform, core, entries, adapter, fams, fill) the first time a library is used.
  function ensureLib(key) {
    const L = LIBS[key]; if (!L) return Promise.reject(new Error('no library ' + key));
    if (L.loaded) return Promise.resolve(L);
    return loading[key] || (loading[key] = fetch(new URL('libs/' + L.file, base)).then(r => { if (!r.ok) throw new Error(L.file + ' ' + r.status); return r.json(); }).then(code => {
      Object.assign(L, code); if (L.fill) L.fillFn = new Function('return ' + L.fill)(); L.loaded = true; return L;
    }).catch(e => { delete loading[key]; throw e; }));
  }
  const ensureLibs = keys => Promise.all([...new Set(keys)].filter(k => LIBS[k]).map(ensureLib));

  // ---------------------------------------------------------- cellOf / defOf
  const cellOf = n => LIBS[n.kind] ? LIBS[n.kind].cells.find(c => c.name === n.fn) : null;
  const defOf = n => LIBS[n.kind] || GENERIC[n.kind];

  // ---------------------------------------------------------- templateCode
  // A library node needs its library loaded (ensureLib) first.
  function templateCode(n) {
    if (LIBS[n.kind]) { const L = LIBS[n.kind]; const e = L.entries[n.fn] ?? L.entries['*'] ?? ''; return (e + L.adapter.replace(/__NAME__/g, n.fn)).trim() + '\n'; }
    const Gk = GENERIC[n.kind]; return (Gk.ops ? Gk.code.replace('__OP__', Gk.ops[n.op]) : Gk.code).trim() + '\n';
  }

  // ---------------------------------------------------------- entryOf
  const entryOf = n => LIBS[n.kind] ? LIBS[n.kind].entry.replace(/__NAME__/g, n.fn) : 'fs_main';

  // ---------------------------------------------------------- coreKeyOf / coreSrcOf
  // One key per distinct core: an orb family, a library, or 'generic'.
  function coreKeyOf(n) { const L = LIBS[n.kind]; return L ? (L.orb ? 'orb:' + cellOf(n).family : n.kind) : 'generic'; }
  // The core text packSrc prints once per key (uniform plus core, no header).
  function coreSrcOf(n) { const L = LIBS[n.kind]; return L ? (L.sim ? L.core : (L.uniform + (L.orb ? L.fams[cellOf(n).family].core : L.core))) : GEN_UNIFORM; }

  // ---------------------------------------------------------- moduleFor
  function moduleFor(n, code = n.code) {
    if (LIBS[n.kind]) {
      const L = LIBS[n.kind];
      if (L.sim) return L.core + '\n' + code;
      const core = L.orb ? L.fams[cellOf(n).family].core : L.core;
      return L.uniform + HEAD + VS + core + '\n' + code;
    }
    return GEN_UNIFORM + HEAD + VS + '\n' + code;
  }

  // ---------------------------------------------------------- fillUniform
  /**
   * Pack the bench uniform of node n into the Float32Array d (64 floats).
   * env: {T: time, TEX: pass size in texels, G: {ink, tone, cream} as [r,g,b]}.
   * A sim library writes only the header and the knobs (its step and
   * present passes write their own SimU).
   */
  function fillUniform(n, d, env) {
    const { T, TEX, G } = env;
    d.fill(0); const L = LIBS[n.kind];
    if (L && L.orb) {
      d[0] = TEX; d[1] = TEX; d[2] = 0; d[3] = 0; d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
      d[16] = 0; d[17] = 0; d[18] = T; d[19] = 1; d[21] = 1; d[22] = 1; d.set(n.k, 25); d[29] = 0; d[30] = n.state || 0; d[31] = Math.max(T - (n.stateAt || 0), 0);
      for (let j = 0; j < L.extras.length; j++) d[L.extras[j].i] = L.extras[j].fn(n.xk[j]);
      const lv = d[32], ac = d[33]; d.set([T * 0.6, T * 0.6, T * 0.6, T * 0.6, T * 0.6, T * lv, T * ac], 34); return;
    }
    d[0] = TEX; d[1] = TEX; d[2] = T; d[3] = 1; d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    if (!L || L.sim) { d.set(n.k, 16); return; }
    d.set(n.k, L.kAt ?? 20);
    for (const [i, v] of Object.entries(L.fixed)) d[+i] = v;
    const x = {};
    for (let j = 0; j < L.extras.length; j++) { const e = L.extras[j]; const v = e.fn(n.xk[j]); x[e.name] = v; if (e.i >= 0) d[e.i] = v; }
    if (L.samp) { d[16] = Math.round(32 + 480 * n.k[0] * n.k[0]); d[17] = (1.2 + 3.0 * n.k[1]) * TEX / 174; }
    if (L.fillFn) L.fillFn(d, { k: n.k, x, cell: cellOf(n), T, TEX, G });
  }

  const cellCount = () => Object.values(LIBS).reduce((s, L) => s + L.cells.length, 0);

  return {
    base, INDEX, LIBS, GENERIC, HEAD, GEN_UNIFORM, VS, BLIT,
    ensureLib, ensureLibs, cellOf, defOf, templateCode, entryOf, coreKeyOf, coreSrcOf, moduleFor, fillUniform, cellCount,
  };
}
