// nest.js: the lab fine boxes of the gas (LAB-DESIGN.md 2, 3, 4). Offline prebake only; the page never runs it.
// Lab-hires round 2. Owner: the lab. Not in Unity.
//
// WHAT: one-way nesting of a fine box (refinement 4: 5 x 5 x 10 px) inside the coarse tier W grid. A second
//   coarse run and the fine run step in lockstep: 1 coarse step, then 4 fine steps with dt / 4. Before each fine
//   step, Ghost writes the 2 outer layers of each inner box face from the coarse state (trilinear, no time
//   interpolation: the boundary leads the fine run by at most one coarse step). The fine run uses the same
//   kernels as the coarse run (Init, Sources, Sweep, AddFeatures, Striate, GasCopy), with _Origin in PosOf.
//   The half-res ionization rays and the full light stage march the fine Opt inside the box and the coarse
//   Opt outside it (radiation.js nest variants). Then AmbientScan, JFA and the pre-light run on the fine grid.
//   The fine Vol is read back, z pairs are summed to the ship grid (5 x 5 x 20 px), and encoded as RG8
//   log2 codes: R = sigma_V per px, G = Rec.709 luma of j (the colour stays on the coarse grid).
//
// EXPORTS (grep -n "^export"):
//   BOXES                         the hero boxes in world px (L, M, R)
//   fineTier(box)                 { name, dims, cell, scale, origin, ext } of a box at refinement 4
//   nsRegistry(reg, prefix)       a registry view whose names carry a prefix (two bake states in one context)
//   runNest(ctx, S, id, log)      -> Promise<{ section, meta, report }>; S is the finished coarse session
//   encodeFine(layers, w, h, d, volMeta) -> { data, meta, stats }   the z-pair reduce and the RG8 codes
//   packAtlas(results) -> { section 'Fine', metas }   round 3: all boxes side by side in x in one RG8 texture
//   ATLAS_PAD                     the edge-copy pad in cells around each box in the atlas
//
// GREP TARGETS: GHOST_FS, lockstep, lostError, drive, lightStage, encodeFine, boxStats, packAtlas, sinkK.

import { program } from '../gl/context.js';
import { runSlicePass, readFloat } from '../gl/passes.js';
import { TIERS } from '../params.js';
import { hydroChunks } from './hydro.js';
import { starRaysChunks, ambientChunks } from './radiation.js';
import { jfaChunks } from './surface.js';
import { prelightChunks } from './prelight.js';

export const BOXES = {
  L: { x: [560, 1920], y: [40, 1080], z: [440, 1080] },
  M: { x: [1920, 3840], y: [0, 1080], z: [440, 1240] },
  R: { x: [4160, 5600], y: [40, 1080], z: [440, 1240] },
};
const FINE_CELL = [5, 5, 10];
const GHOST_W = 2;
const LUMA = [0.2126, 0.7152, 0.0722];

export function fineTier(box) {
  const origin = [box.x[0], box.y[0], box.z[0]];
  const ext = [box.x[1] - box.x[0], box.y[1] - box.y[0], box.z[1] - box.z[0]];
  return { name: 'F', dims: ext.map((e, i) => Math.round(e / FINE_CELL[i])), cell: FINE_CELL.slice(), scale: 2, origin, ext };
}

export function nsRegistry(reg, pre) {
  const n = (s) => (typeof s === 'string' && !s.startsWith(pre) ? pre + s : s);
  return new Proxy(reg, {
    get(t, k) {
      if (k === 'tex3D' || k === 'tex2D') return (name, ...a) => t[k](n(name), ...a);
      if (k === 'get' || k === 'release' || k === 'releasePrefix') return (name) => t[k](n(name));
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

// Ghost: copy of the fine state, with the outer GHOST_W layers of each inner face taken from the coarse state.
const GHOST_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler3D;
uniform ivec3 _Dims; uniform int _Slice; uniform vec3 _Cell; uniform vec3 _Origin;
uniform ivec3 _CDims; uniform vec3 _CCell; uniform ivec3 _FaceLo; uniform ivec3 _FaceHi; uniform int _GW;
uniform highp sampler3D _U; uniform highp sampler3D _S; uniform highp sampler3D _X;
uniform highp sampler3D _UC; uniform highp sampler3D _SC; uniform highp sampler3D _XC;
layout(location = 0) out vec4 oU; layout(location = 1) out vec4 oS; layout(location = 2) out vec4 oX;
ivec3 CWrap(ivec3 c)
{
    int x = c.x; if (x < 0) x += _CDims.x; if (x >= _CDims.x) x -= _CDims.x;
    return ivec3(x, clamp(c.y, 0, _CDims.y - 1), clamp(c.z, 0, _CDims.z - 1));
}
vec4 TriC(highp sampler3D t, vec3 p)
{
    vec3 u = p / _CCell - vec3(0.5);
    vec3 fl = floor(u); vec3 f = u - fl; ivec3 i = ivec3(fl);
    vec4 a = mix(texelFetch(t, CWrap(i), 0), texelFetch(t, CWrap(i + ivec3(1, 0, 0)), 0), f.x);
    vec4 b = mix(texelFetch(t, CWrap(i + ivec3(0, 1, 0)), 0), texelFetch(t, CWrap(i + ivec3(1, 1, 0)), 0), f.x);
    vec4 c = mix(texelFetch(t, CWrap(i + ivec3(0, 0, 1)), 0), texelFetch(t, CWrap(i + ivec3(1, 0, 1)), 0), f.x);
    vec4 d = mix(texelFetch(t, CWrap(i + ivec3(0, 1, 1)), 0), texelFetch(t, CWrap(i + ivec3(1, 1, 1)), 0), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
void main()
{
    ivec3 c = ivec3(ivec2(gl_FragCoord.xy), _Slice);
    bvec3 lo = lessThan(c, ivec3(_GW)); bvec3 hi = greaterThanEqual(c, _Dims - ivec3(_GW));
    bool g = (lo.x && _FaceLo.x != 0) || (lo.y && _FaceLo.y != 0) || (lo.z && _FaceLo.z != 0)
          || (hi.x && _FaceHi.x != 0) || (hi.y && _FaceHi.y != 0) || (hi.z && _FaceHi.z != 0);
    if (!g) { oU = texelFetch(_U, c, 0); oS = texelFetch(_S, c, 0); oX = texelFetch(_X, c, 0); return; }
    vec3 p = (vec3(c) + vec3(0.5)) * _Cell + _Origin;
    oU = TriC(_UC, p); oS = TriC(_SC, p); oX = TriC(_XC, p);
}
`;
const ghostCache = new WeakMap();
function ghostProg(gl) {
  let p = ghostCache.get(gl);
  if (!p) { p = program(gl, 'nest.Ghost', null, GHOST_FS); ghostCache.set(gl, p); }
  return p;
}

function swap(st, a, b) { const t = st[a]; st[a] = st[b]; st[b] = t; }
const nameOf = (v) => (v == null ? null : typeof v === 'string' ? v : v.name);

// Pull a generator until it yields one hydro step (or ends). Returns false at the end.
const STEP_STAGES = new Set(['hydro.init', 'hydro.A', 'hydro.B']);
function* pull(gen) {
  for (;;) {
    const r = gen.next();
    if (r.done) return false;
    yield r.value;
    if (r.value && STEP_STAGES.has(r.value.stage)) return true;
  }
}
function* finish(gen) { for (;;) { const r = gen.next(); if (r.done) return; yield r.value; } }

// The lockstep of one phase: the coarse init or step first, then 4 fine steps (refinement 4 in time).
function* lockstep(gC, gF) {
  if (!(yield* pull(gC))) throw new Error('[nest] coarse run ended before its first step');
  if (!(yield* pull(gF))) throw new Error('[nest] fine run ended before its first step');
  for (;;) {
    const c = yield* pull(gC);
    for (let k = 0; k < 4; k++) if (!(yield* pull(gF))) break;
    if (!c) break;
  }
  yield* finish(gC);
  yield* finish(gF);
}

function* lightStage(ctxF, stF, comp, sources, palette) {
  stF.S = stF.S0;
  for (const k of ['U0', 'U1', 'S1', 'X', 'Xb', 'F', 'IonH', 'RadH', 'Vel', 'OptH']) {
    const n = nameOf(stF[k]);
    if (n && ctxF.registry.get(n)) ctxF.registry.release(n);
    stF[k] = null;
  }
  yield* starRaysChunks(ctxF, stF, comp, { res: 'full', sources });
  stF.lightSources = stF.diag.radiation.full.stars;
  yield* ambientChunks(ctxF, stF);
  yield* jfaChunks(ctxF, stF);
  stF.cur = { S: nameOf(stF.S), LA: nameOf(stF.LA), LB: nameOf(stF.LB) };
  yield* prelightChunks(ctxF, stF, comp, {
    palette, channelMask: 'all', sources: stF.lightSources,
    inputs: { Opt: stF.Opt, S: stF.S, LA: stF.LA, LB: stF.LB, Amb: stF.Amb, Jd: stF.Jd, Jr: stF.Jr },
  });
}

async function fence(gl) {
  const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  for (;;) {
    await new Promise((r) => setTimeout(r, 0));
    const s = gl.clientWaitSync(f, 0, 0);
    if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED || s === gl.WAIT_FAILED || gl.isContextLost()) break;
  }
  gl.deleteSync(f);
}
// A context loss makes pipeline.js release every registry entry, also the 'c.' and 'f.' textures of this run.
// Before, drive() went on after the loss and the next pass threw "[passes] no live texture c.U0" (or f.U0),
// so the log did not show the loss. Now drive() stops with the real cause.
function lostError(what) { return new Error(`[nest] the WebGL context was lost during ${what}`); }
async function drive(gl, gen, every = 4, what = 'the nest run') {
  let k = 0;
  for (;;) {
    if (gl.isContextLost()) throw lostError(what);
    const r = gen.next(); if (r.done) break;
    if (++k % every === 0) await fence(gl);
  }
  await fence(gl);
  if (gl.isContextLost()) throw lostError(what);
  return k;
}

function stepWeight(s, l) { const a = s * l; return a < 1e-4 ? l * (1 - 0.5 * a) : (1 - Math.exp(-a)) / s; }
function pctOf(arr, p) {
  if (!arr.length) return 0;
  const a = Float32Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * a.length)))];
}

// The z-pair reduce (LAB-DESIGN 3.7) and the RG8 log2 codes (4). layers[z] = RGBA float32 of fine Vol layer z.
export function encodeFine(layers, w, h, d, volMeta, dzSim) {
  const n = w * h, d2 = d >> 1;
  const sig = new Float32Array(n * d2), lum = new Float32Array(n * d2);
  for (let k = 0; k < d2; k++) {
    const A = layers[2 * k], B = layers[2 * k + 1];
    for (let i = 0; i < n; i++) {
      const s0 = Math.max(0, A[4 * i + 3]) / volMeta.sigScale, s1 = Math.max(0, B[4 * i + 3]) / volMeta.sigScale;
      const j0 = Math.max(0, LUMA[0] * A[4 * i] + LUMA[1] * A[4 * i + 1] + LUMA[2] * A[4 * i + 2]) / volMeta.volScale;
      const j1 = Math.max(0, LUMA[0] * B[4 * i] + LUMA[1] * B[4 * i + 1] + LUMA[2] * B[4 * i + 2]) / volMeta.volScale;
      const E = j0 * stepWeight(s0, dzSim) + Math.exp(-s0 * dzSim) * j1 * stepWeight(s1, dzSim);
      const s = 0.5 * (s0 + s1);
      sig[k * n + i] = s;
      lum[k * n + i] = E / stepWeight(s, 2 * dzSim);
    }
  }
  const range = (a) => {
    const pos = [];
    for (let i = 0; i < a.length; i += 7) if (a[i] > 0) pos.push(Math.log2(a[i]));
    const hi = pos.length ? pctOf(pos, 99.995) : 0;
    const lo = pos.length ? Math.max(pctOf(pos, 0.5), hi - 24) : -16;
    return [lo, hi];
  };
  // R is the cube root of sigma / sigMax, not log2 (round 2 fix): the hardware filter then interpolates sigma
  // close to linear, so a front keeps its position inside a 20 px ship cell. Log2 codes snapped every front
  // to a layer (terraces) and gave square iso-contours in x and y. Step at sigma 1e-3 per px: 10 %.
  const rj = range(lum);
  const sigMax = Math.pow(2, range(sig)[1]);
  const data = new Uint8Array(n * d2 * 2);
  const code = (v, r) => (v > 0 ? Math.max(0, Math.min(255, Math.round(255 * (Math.log2(v) - r[0]) / (r[1] - r[0])))) : 0);
  for (let i = 0; i < n * d2; i++) {
    data[2 * i] = Math.min(255, Math.round(255 * Math.cbrt(Math.max(0, sig[i]) / sigMax)));
    data[2 * i + 1] = code(lum[i], rj);
  }
  return { data, meta: { dims: [w, h, d2], sigCode: 'cbrt', sigMax, lumLog2: rj }, sig, lum };
}

// Column statistics of a sigma grid over z (px): column tau p50 / p90, and the skin depth (tau 0.3 -> 3).
function boxStats(sig, w, h, d, dz) {
  const n = w * h, tauCol = [], skin = [], vals = [];
  for (let i = 0; i < n; i++) {
    let tau = 0, z03 = -1, z3 = -1;
    for (let k = 0; k < d; k++) {
      const s = sig[k * n + i];
      if ((i + k) % 5 === 0) vals.push(s);
      const t1 = tau + s * dz;
      if (z03 < 0 && t1 >= 0.3) z03 = (k + (0.3 - tau) / Math.max(s * dz, 1e-9)) * dz;
      if (z3 < 0 && t1 >= 3) z3 = (k + (3 - tau) / Math.max(s * dz, 1e-9)) * dz;
      tau = t1;
    }
    tauCol.push(tau);
    if (z03 >= 0 && z3 >= 0) skin.push(z3 - z03);
  }
  const r = (a, p) => +pctOf(a, p).toFixed(4);
  return { sigmaP50: r(vals, 50), sigmaP99: r(vals, 99), sigmaP999: r(vals, 99.9), tauColP50: r(tauCol, 50), tauColP90: r(tauCol, 90),
    skinP10: r(skin, 10), skinP50: r(skin, 50), skinColumns: skin.length / n };
}

// The coarse sigma of the same box from the shipped coarse Vol (cell 20 x 20 x 40), resampled to its own cells.
function coarseBoxSigma(ctx, volName, volMeta, box) {
  const e = ctx.registry.get(volName);
  const cw = 5760 / e.w, ch = 1080 / e.h, cd = 1920 / e.d;
  const x0 = Math.round(box.x[0] / cw), x1 = Math.round(box.x[1] / cw), y0 = Math.round(box.y[0] / ch), y1 = Math.round(box.y[1] / ch);
  const z0 = Math.round(box.z[0] / cd), z1 = Math.round(box.z[1] / cd);
  const w = x1 - x0, h = y1 - y0, d = z1 - z0, out = new Float32Array(w * h * d);
  for (let k = 0; k < d; k++) {
    const L = readFloat(ctx, volName, z0 + k, [x0, y0, w, h]);
    for (let i = 0; i < w * h; i++) out[k * w * h + i] = Math.max(0, L[4 * i + 3]) / volMeta.sigScale;
  }
  return { sig: out, w, h, d, dz: cd };
}

// Runs box id on top of the finished coarse session S (pipeline.currentSession()). Returns the RG8 section.
export async function runNest(ctx, S, id = 'M', log = () => {}) {
  const t0 = performance.now();
  const { gl } = ctx;
  const comp = S.comp;
  const box = BOXES[id];
  const tier = fineTier(box);
  const W = TIERS.W;
  const ctxC = { ...ctx, registry: nsRegistry(ctx.registry, 'c.'), tier: 'W' };
  const ctxF = { ...ctx, registry: nsRegistry(ctx.registry, 'f.'), tier };
  const stC = { diag: {} };
  const stF = { diag: {}, boxPx: tier.ext };
  stF.nest = {
    origin: tier.origin, ext: tier.ext, tier,
    optHC: () => stC.OptH || stC.Opt, optC: () => stC.Opt,
  };
  const faceLo = [box.x[0] > 0 ? 1 : 0, box.y[0] > 0 ? 1 : 0, box.z[0] > 0 ? 1 : 0];
  const faceHi = [box.x[1] < 5760 ? 1 : 0, box.y[1] < 1080 ? 1 : 0, box.z[1] < 1920 ? 1 : 0];
  const ghost = ghostProg(gl);
  let ghosts = 0;
  // Lab round 4: the probe trace (comp.nest.probe = [[x, y, zPx], ...], every comp.nest.probeEvery fine steps).
  // It logs the fine max rho and x in a 9 x 9 x 3 cell block and the coarse rho and x of the cell at each point.
  const probe = (comp.nest && comp.nest.probe) || [];
  const probeEvery = (comp.nest && comp.nest.probeEvery) || 80;
  const trace = [];
  const probeAt = (st, k) => {
    const row = { k };
    for (const [px, py, pz] of probe) {
      const fx = Math.floor((px - tier.origin[0]) / tier.cell[0]), fy = Math.floor((py - tier.origin[1]) / tier.cell[1]);
      const fz = Math.floor((pz - tier.origin[2]) / tier.cell[2]);
      if (fx < 0 || fy < 0 || fz < 0 || fx >= tier.dims[0] || fy >= tier.dims[1] || fz >= tier.dims[2]) continue;
      let rmax = 0, xAt = 0, sum = 0, n = 0;
      for (let dz = -1; dz <= 1; dz++) {
        const z = Math.min(tier.dims[2] - 1, Math.max(0, fz + dz));
        const x0 = Math.max(0, fx - 4), y0 = Math.max(0, fy - 4);
        const U = readFloat(ctxF, nameOf(st.U0), z, [x0, y0, 9, 9]);
        const X = readFloat(ctxF, nameOf(st.X), z, [x0, y0, 9, 9]);
        for (let i = 0; i < 81; i++) { sum += U[4 * i]; n++; if (U[4 * i] > rmax) { rmax = U[4 * i]; xAt = X[4 * i]; } }
      }
      const cx = Math.floor(px / W.cell[0]), cy = Math.floor(py / W.cell[1]), cz = Math.floor(pz / W.cell[2]);
      const UC = readFloat(ctxC, nameOf(stC.U0), cz, [cx, cy, 1, 1]), XC = readFloat(ctxC, nameOf(stC.X), cz, [cx, cy, 1, 1]);
      row[px + ',' + py] = { fMax: +rmax.toFixed(2), fMean: +(sum / n).toFixed(2), fX: +xAt.toFixed(2), c: +UC[0].toFixed(2), cX: +XC[0].toFixed(2) };
    }
    trace.push(row);
    log('[nest] probe ' + JSON.stringify(row));
  };
  const fine = {
    origin: tier.origin, ext: tier.ext,
    get normScale() { return 1 / stC.diag.hydro.meanRhoInit; },
    get contrast() { return stC.diag.hydro.contrast; },
    preStep(st) {
      if (probe.length && ghosts % probeEvery === 0) probeAt(st, ghosts);
      runSlicePass(ctxF, ghost, {
        targets: [st.U1, st.S1, st.Xb], dims: tier.dims,
        uniforms: { _Dims: tier.dims, _Cell: tier.cell, _Origin: tier.origin, _CDims: W.dims, _CCell: W.cell,
          _FaceLo: faceLo, _FaceHi: faceHi, _GW: GHOST_W },
        textures: { _U: st.U0, _S: st.S0, _X: st.X, _UC: stC.U0, _SC: stC.S0, _XC: stC.X },
      });
      swap(st, 'U0', 'U1'); swap(st, 'S0', 'S1'); swap(st, 'X', 'Xb');
      ghosts++;
    },
  };
  const sources = comp.sources.concat(S.state.seatSources || []);
  // Lab round 3: a hook for the sink accretion threshold of the fine run (comp.nest.sinkRhoScale, default 1).
  // Tested: x16 (a Jeans threshold scales as dx^-2) did not change box L (mass drift -27 % -> -26 %,
  // sigma p99.9 0.49 -> 0.54 against 6.1 coarse), so the sink is not what takes the hub mass. Default off.
  const sinkK = (comp.nest && comp.nest.sinkRhoScale) || 1;
  const fineSrc = (list) => list.map((q) => (q.sink ? { ...q, sink: { ...q.sink, rhoMax: q.sink.rhoMax * sinkK } } : q));
  const compF = { ...comp, sources: fineSrc(comp.sources) };
  const sourcesF = fineSrc(sources);
  const ionC = function* (c, st, cp, o) { yield* starRaysChunks(c, st, cp, { res: 'half', sources: o.sources, t: o.time }); };
  const ms = {};
  let t = performance.now();
  await drive(gl, lockstep(
    hydroChunks(ctxC, stC, comp, { phase: 'A', sources: comp.sources, pass: 1, stepsPerChunk: 1 }),
    hydroChunks(ctxF, stF, compF, { phase: 'A', sources: compF.sources, pass: 1, stepsPerChunk: 1, fine })), 4, 'box ' + id + ' phase A');
  ms.hydroA = performance.now() - t; log('[nest] phase A ' + Math.round(ms.hydroA) + ' ms');
  t = performance.now();
  await drive(gl, lockstep(
    hydroChunks(ctxC, stC, comp, { phase: 'B', sources, pass: 2, ion: ionC, stepsPerChunk: 1 }),
    hydroChunks(ctxF, stF, compF, { phase: 'B', sources: sourcesF, pass: 2, ion: ionC, stepsPerChunk: 1, fine })), 4, 'box ' + id + ' phase B');
  ms.hydroB = performance.now() - t; log('[nest] phase B ' + Math.round(ms.hydroB) + ' ms');
  const bytesPeakHydro = ctx.registry.bytesPeak();
  // The coarse run keeps only Opt for the fine light stage.
  for (const e of ctx.registry.list()) if (e.name.startsWith('c.') && e.name !== nameOf(stC.Opt)) ctx.registry.release(e.name);
  t = performance.now();
  await drive(gl, lightStage(ctxF, stF, comp, sources, S.opts.palette || 'nircam'), 2, 'box ' + id + ' light');
  ms.light = performance.now() - t; log('[nest] light ' + Math.round(ms.light) + ' ms');
  const vm = stF.volMeta;
  t = performance.now();
  const [w, h, d] = tier.dims;
  const layers = [];
  for (let z = 0; z < d; z++) layers.push(readFloat(ctxF, stF.Vol, z));
  const enc = encodeFine(layers, w, h, d, vm, tier.cell[2]);
  ms.encode = performance.now() - t;
  const cb = coarseBoxSigma(ctx, nameOf(S.state.Vol) || 'Vol', S.state.volMeta, box);
  const report = {
    box: id, boxPx: box, simDims: tier.dims, shipDims: enc.meta.dims, ms, ghosts, trace,
    sinkRhoScale: sinkK, hydroFine: { sigmaS: stF.diag.hydro.sigmaS, sigmaSB: stF.diag.hydro.sigmaSB, machRms: stF.diag.hydro.machRms,
      massDrift: stF.diag.hydro.massDrift, contrast: stF.diag.hydro.contrast },
    hydroCoarse2: { sigmaSB: stC.diag.hydro.sigmaSB, massDrift: stC.diag.hydro.massDrift },
    volMeta: { volScale: vm.volScale, sigScale: vm.sigScale },
    fineShip: boxStats(enc.sig, w, h, d >> 1, 2 * tier.cell[2]),
    coarse: boxStats(cb.sig, cb.w, cb.h, cb.d, cb.dz),
    bytesPeak: ctx.registry.bytesPeak(), bytesPeakHydro,
  };
  // Release everything of the nest (fine and coarse); the shipped coarse set stays.
  for (const e of ctx.registry.list()) if (e.name.startsWith('f.') || e.name.startsWith('c.')) ctx.registry.release(e.name);
  report.totalMs = performance.now() - t0;
  const section = { name: 'Fine' + id, kind: '3d', dims: enc.meta.dims, format: 'RG8', channels: 2, codec: 'u8-planar-dx', data: enc.data };
  const meta = { id, origin: tier.origin, ext: tier.ext, ...enc.meta };
  return { section, meta, report };
}

// Lab round 3: the fine atlas. The RG8 ship grids of all boxes go side by side in x into one 3D texture
// (one sampler and one B-spline read in the compositor). Each box has a pad of ATLAS_PAD cells on each x side
// and on the high y and z sides, filled with copies of its edge cells, so the read of one box never takes
// texels of the next box. The meta of each box gets atlasX, the x cell of its first data column.
export const ATLAS_PAD = 2;
export function packAtlas(results) {
  const P = ATLAS_PAD;
  const AH = Math.max(...results.map((r) => r.section.dims[1])) + P;
  const AD = Math.max(...results.map((r) => r.section.dims[2])) + 1;
  let AW = 0;
  for (const r of results) { r.meta.atlasX = AW + P; AW += r.section.dims[0] + 2 * P; }
  const data = new Uint8Array(AW * AH * AD * 2);
  for (const r of results) {
    const [w, h, d] = r.section.dims, src = r.section.data, x0 = r.meta.atlasX - P;
    for (let z = 0; z < AD; z++) {
      const zs = Math.min(z, d - 1);
      for (let y = 0; y < AH; y++) {
        const ys = Math.min(y, h - 1);
        for (let x = 0; x < w + 2 * P; x++) {
          const xs = Math.min(Math.max(x - P, 0), w - 1);
          const si = 2 * ((zs * h + ys) * w + xs), di = 2 * ((z * AH + y) * AW + x0 + x);
          data[di] = src[si]; data[di + 1] = src[si + 1];
        }
      }
    }
  }
  return { section: { name: 'Fine', kind: '3d', dims: [AW, AH, AD], format: 'RG8', channels: 2, codec: 'u8-planar-dx', data },
    metas: results.map((r) => ({ ...r.meta, atlasDims: [AW, AH, AD] })) };
}
