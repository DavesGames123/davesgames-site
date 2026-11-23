// pipeline.js: the bake pipeline of the artifact. It runs the bake stages in order and owns the report.
// Owner: row A8. Spec: nebula-spec.md 2.7, 2.9, 2.12, 3.7, 6.7 (stage order), 7.3, 7.4 (table), 7.4.3,
// 7.4.4 (state names, retain set, Layers), 7.4.6 (report).
//
// Exports (grep -n "^export"):
//   runBake(ctx, comp, sites, opts, onProgress) -> Promise<Layers>
//        opts = { tier, palette, channelMask, strands: { S, F }, seats, budgetMs }
//   rerun(stage, opts) -> Promise<Layers>      stage 'prelight' (palette, channel solo, strands) or 'fromSnap' (seats)
//   currentSession() -> the last session { ctx, comp, sites, opts, state, report, layers } or null
//   disposeBake()                              releases every texture of the last session
//   RETAIN_NAMES, retainCount(tier)            the look-dev retain set of 7.4.4
//   displayY(r, g, b, e, soft)                 the display chain of 2.12 on one linear pixel (soft: stretch knee)
//   bisectExposure(rgba, w, h, rect, pct, target, stride)   the revision 3 bisection (28 steps, [-40, 40] EV)
//   bisectExposureFast(rgba, w, h, rect, pct, target, o)    L1: a pixel lattice, a bracket, stop at 1/256 EV
//   bisectPixels(px, pct, target, o)            L1 on pixels that are already sampled (trimSample, stage X)
//   bisectPixelsFull(px, pct, target, o)        the same result with a full P(mid) per step (test only)
//
// STAGE ORDER (6.7, the same order as StarMapBakeSession):
//   hydro phase A -> [Snap] -> phase B (StarRays half-res every ionEvery steps) and Striate
//   -> strand trace -> CPU bins -> release (3.7 item 2) -> StarRays full -> AmbientScan -> JFA
//   -> Preview -> E0 -> [sites: pre-light, 5 tour scrolls of the march, site luma, pick seats;
//      seats kept: release, restore from Snap, add seat sources, phase B again (pass 2)]
//   -> pre-light (Stats, Prelight, SkinPack: Vol, SkinD, SkinA) and the strand store -> exposure trim
//   -> foreground check -> release per tier -> report. Revision 3: no slab stage.
// Each stage runs as a generator. The driver runs chunks until about budgetMs (12 ms) of GPU work is
// in flight, puts a fenceSync, and waits for the fence in later tasks. So the page stays responsive.
// L3 (pass3-bake-speed.md B6): two fences are open at a time, so the GPU runs batch k while the page
// submits batch k + 1. opts.debug.fences = 1 gives the revision 3 driver (one fence) for a timing check.
// L1: the exposure bisections run on a pixel lattice inside a bracket. opts.debug.exposure = 'full' gives
// the revision 3 bisection; opts.debug.exposureCompare runs both and writes report.exposureCheck (BS7).
//
// RELEASE (3.7, 7.4.4): both tiers keep the volume set Vol, SkinD, SkinA. Preview also keeps Opt, one
// S, LA, LB, Amb, Jd, Jr and Snap_U, Snap_S, Snap_X (13 3D textures). Full keeps only the volume set
// (3). The pipeline asserts live3D() === retainCount(tier).
// Layers = { vol, skinD, skinA, strandSeg, strandBin, volMeta, look, strandFamily, strandAbsorb,
//            dustBand, exposure, exposureTrimEv, catalogue, report } (7.4.4). The textures are registry entries.

import { TIERS, CONTENT_W } from '../params.js';
import { program, programTimes, onContextLost } from '../gl/context.js';
import { runSlicePass, readFloat } from '../gl/passes.js';
import { compositionSha256 } from '../data/composition.js';
import { hydroChunks } from './hydro.js';
import { starRaysChunks, ambientChunks } from './radiation.js';
import { jfaChunks } from './surface.js';
import { strandTraceChunks, binStrands3D } from './strands.js';
import { pickSeats, seatSources, TOUR_SCROLLS } from './seats.js';
import { prelightChunks, previewChunks, uploadStrandStore, lookOf, VOLUME_NAMES } from './prelight.js';
import { createCompositor } from '../render/compositor.js';
import { buildCatalogue } from '../render/catalogue.js';

export const RETAIN_NAMES = ['Opt', 'S', 'LA', 'LB', 'Amb', 'Jd', 'Jr', 'Snap_U', 'Snap_S', 'Snap_X'];
export function retainCount(tier) { return tierName(tier) === 'W' ? 13 : 3; }

const PREVIEW_W = 1920, PREVIEW_H = 360, PREVIEW_PX = CONTENT_W / PREVIEW_W;   // 3 px per texel
const SEAT_FRAME = [960, 540];
const TRIM_FRAME = [1920, 1080];
const BYTES_LIMIT_W = 190 * 1024 * 1024;
const FG_TAU_CAP = 0.35;   // 3.2: p99 of the summed tau_V over z < 520
const FG_Z = 520;
const FG_FRAME = [960, 540];
const STRAND_ABSORB = 0.15; // tau_V at the core of an absorbing strand (F_ABSORB of strands.js)

let session = null;
let lostHooked = false;

function tierName(t) { return typeof t === 'string' ? t : (t && t.name) || 'W'; }

// ---- Display chain (2.12, 3.4.2) on the CPU ----

function asinhF(x) { return Math.log(x + Math.sqrt(x * x + 1)); }
const STRETCH_SOFT = 20;                    // beta 3: spec deviation, fixer round 3 (see nebula-math)
const ASINH_NORM = asinhF(60 / STRETCH_SOFT);
function srgbDecode1(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function srgbEncode1(v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }

// Display Y of one linear pixel scaled by e: StretchAsinh, then Rec.709 luma. The stretch sets the
// lightness, and the sRGB encode sets the colour (fixer round 3, the same as nebula-math StretchAsinh).
// The output is display-encoded, so no second encode follows.
export function displayY(r, g, b, e, soft = STRETCH_SOFT) {
  r = Math.max(0, r * e); g = Math.max(0, g * e); b = Math.max(0, b * e);
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b + 1e-9;
  const yd = soft === STRETCH_SOFT ? asinhF(L / STRETCH_SOFT) / ASINH_NORM : asinhF(L / soft) / asinhF(60 / soft);
  const f = srgbDecode1(yd) / L;
  let o0 = r * f, o1 = g * f, o2 = b * f;
  const mx = Math.max(o0, o1, o2);
  if (mx > 1) {
    const k = (mx - 1) / mx * 0.9;
    o0 = Math.min(1, o0 / mx + k); o1 = Math.min(1, o1 / mx + k); o2 = Math.min(1, o2 / mx + k);
  }
  return 0.2126 * srgbEncode1(o0) + 0.7152 * srgbEncode1(o1) + 0.0722 * srgbEncode1(o2);
}

function percentileOf(values, pct) {
  const a = Float32Array.from(values);
  if (!a.length) return 0;
  return selectK(a, Math.min(a.length - 1, Math.max(0, Math.floor((pct / 100) * a.length))));
}

// The k-th smallest value (quickselect, in place). Deterministic: the pivot is the middle element.
function selectK(a, k) {
  let lo = 0, hi = a.length - 1;
  while (hi > lo) {
    const piv = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < piv) i++;
      while (a[j] > piv) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
  }
  return a[k];
}

function pixelsIn(rgba, w, rect, stride = 1) {
  const [x0, y0, rw, rh] = rect;
  const out = new Float32Array(Math.ceil(rw / stride) * Math.ceil(rh / stride) * 3);
  let n = 0;
  for (let y = y0; y < y0 + rh; y += stride) {
    for (let x = x0; x < x0 + rw; x += stride) {
      const i = 4 * (y * w + x);
      out[n++] = rgba[i]; out[n++] = rgba[i + 1]; out[n++] = rgba[i + 2];
    }
  }
  return out;
}

function pctY(px, e, pct) {
  const n = px.length / 3, y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = displayY(px[3 * i], px[3 * i + 1], px[3 * i + 2], e);
  return selectK(y, Math.min(n - 1, Math.floor((pct / 100) * n)));
}

// The scale e that puts the pct-th percentile of display Y inside rect at target (bisection in log2 e).
// stride > 1 takes every stride-th pixel in x and y (the 2 Mpx trim frame uses 2).
export function bisectExposure(rgba, w, h, rect, pct, target, stride = 1) {
  const px = pixelsIn(rgba, w, rect || [0, 0, w, h], stride);
  let lo = -40, hi = 40;
  if (pctY(px, Math.pow(2, hi), pct) < target) return { scale: Math.pow(2, hi), y: pctY(px, Math.pow(2, hi), pct), clampedHigh: true };
  for (let i = 0; i < 28; i++) {
    const mid = 0.5 * (lo + hi);
    if (pctY(px, Math.pow(2, mid), pct) < target) lo = mid; else hi = mid;
  }
  const scale = Math.pow(2, 0.5 * (lo + hi));
  return { scale, y: pctY(px, scale, pct), ev: 0.5 * (lo + hi) };
}

// L1: the same rule as bisectExposure, on a regular pixel lattice (never random), inside a bracket of
// +-span EV around guessEv. If the target is outside the bracket, the full bracket [-40, 40] runs.
// The bisection stops when the bracket is under 1/256 EV (15 steps full, 10 steps at span 2).
export function bisectPixels(px, pct, target, { guessEv = null, span = 2, soft = STRETCH_SOFT } = {}) {
  const n = px.length / 3, y = new Float32Array(n);
  const k = Math.min(n - 1, Math.floor((pct / 100) * n));
  let calls = 0;
  const P = (ev) => {
    const e = Math.pow(2, ev);
    for (let i = 0; i < n; i++) y[i] = displayY(px[3 * i], px[3 * i + 1], px[3 * i + 2], e, soft);
    calls += n;
    return selectK(y, k);
  };
  let lo = -40, hi = 40;
  if (guessEv != null) {
    lo = guessEv - span; hi = guessEv + span;
    if (P(lo) > target || P(hi) < target) { lo = -40; hi = 40; }
  }
  if (lo === -40 && P(hi) < target) return { scale: Math.pow(2, hi), y: P(hi), ev: hi, clampedHigh: true, calls };
  // Decided pixels: displayY rises with e for every pixel (the stretch and the clip both rise with L).
  // A pixel under the target at a midpoint that becomes hi stays under it for every e in the new
  // bracket; a pixel at or over the target at a midpoint that becomes lo stays over it. So each step
  // runs displayY only on the open pixels. "k-th smallest Y < target" is "more than k pixels under the
  // target", so the bracket moves exactly as with the full P(mid), with fewer calls.
  let open = new Uint32Array(n), m = n, under = 0;
  for (let i = 0; i < n; i++) open[i] = i;
  const yo = new Float32Array(n);
  while (hi - lo > 1 / 256) {
    const mid = 0.5 * (lo + hi), e = Math.pow(2, mid);
    let c = 0;
    for (let j = 0; j < m; j++) {
      const i = 3 * open[j];
      const v = displayY(px[i], px[i + 1], px[i + 2], e, soft);
      yo[j] = v; if (v < target) c++;
    }
    calls += m;
    const midUnder = under + c > k;
    let w = 0;
    if (midUnder) { lo = mid; for (let j = 0; j < m; j++) if (yo[j] < target) open[w++] = open[j]; }
    else { hi = mid; under += c; for (let j = 0; j < m; j++) if (!(yo[j] < target)) open[w++] = open[j]; }
    m = w;
  }
  const ev = 0.5 * (lo + hi);
  return { scale: Math.pow(2, ev), y: P(ev), ev, calls };
}

// The revision 4 first form of bisectPixels (a full P(mid) per step). Kept for the Node equality test
// tools/test-exposure.mjs; the bake does not call it.
export function bisectPixelsFull(px, pct, target, { guessEv = null, span = 2, soft = STRETCH_SOFT } = {}) {
  const n = px.length / 3, y = new Float32Array(n);
  const k = Math.min(n - 1, Math.floor((pct / 100) * n));
  let calls = 0;
  const P = (ev) => {
    const e = Math.pow(2, ev);
    for (let i = 0; i < n; i++) y[i] = displayY(px[3 * i], px[3 * i + 1], px[3 * i + 2], e, soft);
    calls += n;
    return selectK(y, k);
  };
  let lo = -40, hi = 40;
  if (guessEv != null) {
    lo = guessEv - span; hi = guessEv + span;
    if (P(lo) > target || P(hi) < target) { lo = -40; hi = 40; }
  }
  if (lo === -40 && P(hi) < target) return { scale: Math.pow(2, hi), y: P(hi), ev: hi, clampedHigh: true, calls };
  while (hi - lo > 1 / 256) {
    const mid = 0.5 * (lo + hi);
    if (P(mid) < target) lo = mid; else hi = mid;
  }
  const ev = 0.5 * (lo + hi);
  return { scale: Math.pow(2, ev), y: P(ev), ev, calls };
}

export function bisectExposureFast(rgba, w, h, rect, pct, target, { stride = 2, guessEv = null, span = 2, soft } = {}) {
  return bisectPixels(pixelsIn(rgba, w, rect || [0, 0, w, h], stride), pct, target, { guessEv, span, soft });
}

// ---- Small GPU helpers ----

const COPY_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform highp sampler3D _Src;
uniform int _Slice;
out vec4 o;
void main() { o = texelFetch(_Src, ivec3(ivec2(gl_FragCoord.xy), _Slice), 0); }
`;
const progCache = new WeakMap();
function copyProg(gl) {
  let p = progCache.get(gl);
  if (!p) { p = program(gl, 'pipeline.copy3D', null, COPY_FS); progCache.set(gl, p); }
  return p;
}

function nameOf(v) { return v == null ? null : (typeof v === 'string' ? v : v.name); }
function live(ctx, v) { const n = nameOf(v); return n ? ctx.registry.get(n) : null; }
function drop(ctx, state, key) {
  const e = live(ctx, state[key]);
  if (e) ctx.registry.release(e.name);
  state[key] = null;
}

function copy3D(ctx, src, dstName, fmt, filter) {
  const s = live(ctx, src);
  if (!s) throw new Error(`[pipeline] copy3D: ${nameOf(src)} is not live`);
  const d = ctx.registry.tex3D(dstName, [s.w, s.h, s.d], fmt, { filter, wrapX: 'repeat' });
  runSlicePass(ctx, copyProg(ctx.gl), { targets: [d], dims: [s.w, s.h, s.d], textures: { _Src: s } });
  return d;
}

// ---- The chunk driver (12 ms of GPU work per frame, fenceSync) ----

const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const waiters = [];
if (channel) channel.port1.onmessage = () => { const w = waiters.shift(); if (w) w(); };
function nextTask() {
  return new Promise((r) => { if (channel) { waiters.push(r); channel.port2.postMessage(0); } else setTimeout(r, 0); });
}

function fenceStart(gl) {
  const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  return f;
}
async function fenceWait(gl) { await fenceDone(gl, fenceStart(gl)); }
async function fenceDone(gl, f) {
  for (;;) {
    await nextTask();
    const st = gl.clientWaitSync(f, 0, 0);
    if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED || gl.isContextLost()) break;
  }
  gl.deleteSync(f);
}

async function drive(S, name, gen) {
  const { gl } = S.ctx;
  const t0 = performance.now();
  const inFlight = S.opts.debug && S.opts.debug.fences === 1 ? 1 : 2;
  const open = [];
  let last = null, lastSignal = t0;
  const settle = async () => {
    const o = open.shift();
    await fenceDone(gl, o.f);
    // The GPU time of one batch is the time between two signals: with two open fences, the submit
    // of a batch is not the start of its GPU work. Adapt the chunk count to about budgetMs per batch.
    const now = performance.now();
    const ms = now - Math.max(o.t, lastSignal);
    lastSignal = now;
    const k = S.budgetMs / Math.max(0.25, ms);
    S.chunks = Math.max(1, Math.min(4096, Math.round(S.chunks * Math.min(2, Math.max(0.25, k)))));
    if (S.onProgress) {
      try { S.onProgress({ stage: name, detail: last, elapsedMs: now - S.t0 }); } catch (e) { console.error(e); }
    }
  };
  for (;;) {
    if (S.lost) throw new Error('[pipeline] WebGL context lost');
    const f0 = performance.now();
    let done = false, n = 0;
    for (;;) {
      const r = gen.next();
      n++;
      if (r.done) { done = true; break; }
      last = r.value;
      if (n >= S.chunks || performance.now() - f0 >= S.budgetMs) break;
    }
    open.push({ f: fenceStart(gl), t: f0 });
    if (open.length >= inFlight) await settle();
    if (done) { while (open.length) await settle(); break; }
  }
  const ms = performance.now() - t0;
  S.report.stagesMs[name] = (S.report.stagesMs[name] || 0) + ms;
  return ms;
}

// Runs a synchronous CPU step as a stage, with a fence before the clock stops.
async function step(S, name, fn) {
  const t0 = performance.now();
  const out = fn();
  await fenceWait(S.ctx.gl);
  S.report.stagesMs[name] = (S.report.stagesMs[name] || 0) + performance.now() - t0;
  return out;
}

// ---- Stages ----

function newReport(S) {
  return {
    tier: S.tier.name, seed: S.comp.seed, compositionSha256, steps: null, pass2: false, stagesMs: {},
    sigmaS: null, machRms: null, coherenceMedianA: null, massDrift: null, seamRatio: null, striationPeakPx: null,
    seats: { kept: [], candidates: [], clamped: [] }, compositionGuardDy: null,
    exposure: null, exposureTrimEv: null, lmax: null, bytesPeak: 0, live3DAtEnd: null, retainBytes: 0, programsMs: {},
  };
}

function snapshot(S) {
  const { ctx, state } = S;
  for (const k of ['Snap_U', 'Snap_S', 'Snap_X']) if (ctx.registry.get(k)) ctx.registry.release(k);
  state.Snap_U = copy3D(ctx, state.U0, 'Snap_U', 'RGBA32F', 'nearest');
  state.Snap_S = copy3D(ctx, state.S0, 'Snap_S', 'RGBA16F', 'linear');
  state.Snap_X = copy3D(ctx, state.X, 'Snap_X', 'R16F', 'linear');
}

// Release the light stage and later textures of a pass, then restore U, S and X from Snap (2.9 step 4).
function restoreFromSnap(S) {
  const { ctx, state } = S;
  for (const k of ['Vol', 'SkinD', 'SkinA', 'StrandSeg', 'StrandBin', 'preview', 'LA', 'LB', 'LA0', 'LB0', 'LA1', 'LB1', 'Amb', 'Jd', 'Jr', 'Opt', 'OptH', 'Vel',
    'IonH', 'RadH', 'U0', 'U1', 'S0', 'S1', 'X', 'Xb', 'F']) drop(ctx, state, k);
  for (const n of ['U0', 'U1', 'S0', 'S1', 'X', 'X_b', 'LA0', 'LB0', 'LA1', 'LB1']) if (ctx.registry.get(n)) ctx.registry.release(n);
  state.U0 = copy3D(ctx, state.Snap_U, 'U0', 'RGBA32F', 'nearest');
  state.S0 = copy3D(ctx, state.Snap_S, 'S0', 'RGBA16F', 'linear');
  state.X = copy3D(ctx, state.Snap_X, 'X', 'R16F', 'linear');
  state.U = state.U0;
  state.S = state.S0;
  state.strandBins = null;
}

// Phase B and every later stage up to E0 (one pass). sources: the bake sources of this pass.
async function passFromB(S, sources, pass) {
  const { ctx, comp, state, report } = S;
  const sfx = pass === 2 ? '.p2' : '';
  const ion = function* ionUpdate(c, st, cp, o) {
    yield* starRaysChunks(c, st, cp, { res: 'half', sources: o.sources, t: o.time });
  };
  await drive(S, 'hydroB' + sfx, hydroChunks(ctx, state, comp, { phase: 'B', sources, pass, ion, stepsPerChunk: 1 }));

  // Strands on Vel and IonH, then the CPU bins (deterministic).
  await drive(S, 'strands' + sfx, strandTraceChunks(ctx, state, { ...comp, strands: { ...comp.strands, S: true, F: true } }));
  state.strandBins = await step(S, 'strandBins' + sfx, () => binStrands3D(state.strandPts, comp));
  state.diag.strands = Object.assign(state.diag.strands || {}, state.strandBins.stats);

  // 3.7 item 2: release both U, one S, X, F, IonH, RadH (and Vel, which only the trace reads).
  state.S = state.S0;
  for (const k of ['U0', 'U1', 'S1', 'X', 'Xb', 'F', 'IonH', 'RadH', 'Vel', 'OptH']) drop(ctx, state, k);
  state.U = null;
  state.strandPts = null;

  // Light stage at full resolution, ambient, jump flood (3.7 item 3 releases Seed0/1 inside jfaChunks).
  await drive(S, 'starRaysFull' + sfx, starRaysChunks(ctx, state, comp, { res: 'full', sources }));
  state.lightSources = state.diag.radiation.full.stars;
  await drive(S, 'ambient' + sfx, ambientChunks(ctx, state));
  await drive(S, 'jfa' + sfx, jfaChunks(ctx, state));
  state.cur = { S: nameOf(state.S), LA: nameOf(state.LA), LB: nameOf(state.LB) };

  // Preview and the coarse exposure E0 (2.12 step 1).
  await drive(S, 'preview' + sfx, previewChunks(ctx, state, comp, { ...lookOpts(S), sources: state.lightSources, inputs: inputs(state) }));
  await step(S, 'exposureE0' + sfx, () => coarseExposure(S));
  report.steps = { A: S.plan.A, B: S.plan.B };
}

function lookOpts(S) { return { palette: S.opts.palette || 'nircam', channelMask: S.opts.channelMask || 'all' }; }
function inputs(state) {
  return { Opt: state.Opt, S: state.S, LA: state.LA, LB: state.LB, Amb: state.Amb, Jd: state.Jd, Jr: state.Jr };
}

function previewPixels(S) { return readFloat(S.ctx, S.state.preview, 0); }

// Screen M (x 1920-3840) of the 1920 x 360 Preview is texel x 640-1280.
function coarseExposure(S) {
  const { comp, state } = S;
  const ex = comp.exposure;
  const px = previewPixels(S);
  const rect = [Math.round(ex.screen[0] / PREVIEW_PX), 0, Math.round((ex.screen[1] - ex.screen[0]) / PREVIEW_PX), PREVIEW_H];
  // L1: pass 1 bisects the full bracket; pass 2 bisects +-0.5 EV around the pass-1 E0. Both take every
  // pixel of the rect, as before: a stride-2 lattice moved E0 by up to 0.037 EV (check BS7, limit 0.02).
  const guessEv = S.pass2Running && S.e0Pass1Ev != null ? S.e0Pass1Ev : null;
  const b = exposureRule(S, guessEv != null ? 'E0.p2' : 'E0',
    () => bisectExposure(px, PREVIEW_W, PREVIEW_H, rect, ex.percentile, ex.targetY),
    () => bisectExposureFast(px, PREVIEW_W, PREVIEW_H, rect, ex.percentile, ex.targetY, { stride: 1, guessEv, span: 0.5 }));
  if (guessEv == null) S.e0Pass1Ev = Math.log2(b.scale);
  state.exposure = b.scale;
  // Lmax: 64, raised to the 99.99th percentile of E0 L when more than 0.01 % of texels clip.
  const lum = new Float32Array(PREVIEW_W * PREVIEW_H);
  let over = 0;
  for (let i = 0; i < lum.length; i++) {
    lum[i] = b.scale * Math.max(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
    if (lum[i] > ex.lmax) over++;
  }
  state.lmax = over > 1e-4 * lum.length ? Math.max(ex.lmax, percentileOf(lum, 99.99)) : ex.lmax;
  S.previewPx = px;
  S.report.exposureE0Y = b.y;
}

// L1 with the BS7 check: debug.exposure 'full' takes the revision 3 rule; debug.exposureCompare runs both,
// keeps the new value and writes { oldEv, newEv, dEv } into report.exposureCheck[key].
function exposureRule(S, key, oldFn, newFn) {
  const dbg = S.opts.debug || {};
  if (dbg.exposure === 'full') return oldFn();
  const t0 = performance.now();
  const b = newFn();
  const newMs = performance.now() - t0;
  if (dbg.exposureCompare) {
    const t1 = performance.now();
    const a = oldFn();
    const oldMs = performance.now() - t1;
    const oldEv = Math.log2(a.scale), newEv = Math.log2(b.scale);
    S.report.exposureCheck = S.report.exposureCheck || {};
    S.report.exposureCheck[key] = { oldEv, newEv, dEv: newEv - oldEv, oldMs, newMs, calls: b.calls };
  }
  return b;
}

function siteList(S) { return (S.sites || []).map((s) => ({ id: s.id, x: s.x, y: s.y })); }

function catalogueOf(S, seatsKept) {
  return buildCatalogue(S.comp, siteList(S), S.layerMeta(), {
    fluxScale: S.state.exposure, seats: seatsKept, palette: S.opts.palette || 'nircam', cepheids: false,
  });
}

function layerMeta(S) {
  const st = S.state;
  const look = lookOf(S.comp, S.opts.palette || 'nircam', S.opts.channelMask || 'all');
  const f = S.strandFlags();
  return {
    vol: st.Vol, skinD: st.SkinD, skinA: st.SkinA, strandSeg: st.StrandSeg, strandBin: st.StrandBin,
    volMeta: st.volMeta, look: look.uniforms, strandFamily: [f.S ? 1 : 0, f.F ? 1 : 0], strandAbsorb: STRAND_ABSORB,
    lmax: st.lmax, dustBand: look.dustBand, exposure: st.exposure, exposureTrimEv: st.exposureTrimEv || 0,
  };
}
// Linear composite (stretch off) of the current volume set into a registry 2D target, read back.
function linearFrame(S, comp, w, h, scrollX, debug) {
  const { ctx } = S;
  const name = 'pipeline.frame';
  if (ctx.registry.get(name)) ctx.registry.release(name);
  ctx.registry.tex2D(name, w, h, 'RGBA16F', { filter: 'nearest' });
  comp.drawLinear(name, scrollX, 1920, debug);
  const px = readFloat(ctx, name, 0);
  ctx.registry.release(name);
  return px;
}

// 2.9 steps 2-3: the pass-1 pre-light, 5 tour scrolls of the march at 960 x 540, site luma, seat choice.
async function seatChoice(S) {
  const { ctx, comp, state } = S;
  await volumeSet(S, 'seatPrelight');
  return step(S, 'seatLuma', () => {
    const cmp = createCompositor(ctx, S.layerMeta(), catalogueOf(S, []));
    cmp.setExposure(0, 0);
    const frames = [];
    for (const t of TOUR_SCROLLS) {
      const px = linearFrame(S, cmp, SEAT_FRAME[0], SEAT_FRAME[1], t * (CONTENT_W - 1920));
      const y = new Float32Array(SEAT_FRAME[0] * SEAT_FRAME[1]);
      for (let i = 0; i < y.length; i++) y[i] = displayY(px[4 * i], px[4 * i + 1], px[4 * i + 2], 1);
      frames.push(y);
    }
    cmp.dispose();
    const luma = { width: SEAT_FRAME[0], height: SEAT_FRAME[1], viewW: 1920, scrolls: TOUR_SCROLLS.slice(), frames, rowsFromTop: false };
    return pickSeats(luma, siteList(S), comp);
  });
}

// 2.9 step 5: median |dY| on the Preview outside 3 r_b of every seat, with the pass-1 E0 for both.
function compositionGuard(S, px1, px2, e, kept) {
  const rb3 = 3 * ((S.comp.seats && S.comp.seats.rbPx) || 56);
  const d = [];
  for (let j = 0; j < PREVIEW_H; j++) {
    for (let i = 0; i < PREVIEW_W; i++) {
      const x = (i + 0.5) * PREVIEW_PX, y = (j + 0.5) * PREVIEW_PX;
      let near = false;
      for (const s of kept) {
        let dx = Math.abs(x - s.x); dx = Math.min(dx, CONTENT_W - dx);
        if (dx * dx + (y - s.y) * (y - s.y) < rb3 * rb3) { near = true; break; }
      }
      if (near) continue;
      const q = 4 * (j * PREVIEW_W + i);
      d.push(Math.abs(displayY(px2[q], px2[q + 1], px2[q + 2], e) - displayY(px1[q], px1[q + 1], px1[q + 2], e)));
    }
  }
  return percentileOf(d, 50);
}

// The strand store and the pre-light kernels (3.2, 2.13.6). Leaves Vol, SkinD, SkinA, StrandSeg, StrandBin live.
async function volumeSet(S, name) {
  const { ctx, comp, state } = S;
  // Filaments (pass 3): with both strand families off, the store is empty and nothing is taken from the
  // volume (phi = 0). That is the base of the conservation check (pass3-filaments.md F8-1). With one family
  // on, both stay on: the per-family split needs the trace again (attempt 1 limit).
  const fl = S.strandFlags();
  const store = state.strandBins && !(fl.S || fl.F)
    ? { seg: new Float32Array(0), bin: new Uint8Array(state.strandBins.bin.length), tube: null, stats: state.strandBins.stats }
    : state.strandBins;
  if (store) await step(S, name + '.strands', () => { state.diag.strandStore = uploadStrandStore(ctx, state, store); });
  await drive(S, name, prelightChunks(ctx, state, comp, { ...lookOpts(S), sources: state.lightSources, inputs: inputs(state) }));
}

// The volume stage: pre-light, the trim (2.12 step 2), the catalogue, the foreground check (3.2).
async function volumeStage(S) {
  const { ctx, comp, state, report } = S;
  await volumeSet(S, 'prelight');
  S.catalogue = catalogueOf(S, S.seatsKept || []);
  await step(S, 'exposureTrim', () => {
    const cmp = createCompositor(ctx, S.layerMeta(), S.catalogue);
    cmp.setExposure(0, 0);
    const ex = comp.exposure;
    const px = linearFrame(S, cmp, TRIM_FRAME[0], TRIM_FRAME[1], 0.5 * (CONTENT_W - 1920));
    // Acceptance of 3.2 and 8.3: the summed tau_V over z < 520 (debug view 2), at mid-scroll.
    const tp = linearFrame(S, cmp, FG_FRAME[0], FG_FRAME[1], 0.5 * (CONTENT_W - 1920), { view: 2, z: [0, FG_Z] });
    cmp.dispose();
    // L1: every 2nd pixel of the 1920 x 1080 frame (960 x 540, the revision 3 trim sample) is the trim
    // lattice; the bracket is +-0.5 EV around 0. The pipeline keeps it as S.trimSample (11.5 item 5), so a
    // later stage X reruns the trim without a new frame. A stride-4 lattice moved the trim by up to
    // 0.028 EV (check BS7, limit 0.02), so the lattice stays at stride 2 (6,220,800 B of floats).
    S.trimSample = { px: pixelsIn(px, TRIM_FRAME[0], [0, 0, TRIM_FRAME[0], TRIM_FRAME[1]], 2), w: TRIM_FRAME[0] / 2, h: TRIM_FRAME[1] / 2 };
    const b = exposureRule(S, 'trim',
      () => bisectExposure(px, TRIM_FRAME[0], TRIM_FRAME[1], null, ex.percentile, ex.targetY, 2),
      () => bisectPixels(S.trimSample.px, ex.percentile, ex.targetY, { guessEv: 0, span: 0.5 }));
    state.exposureTrimEv = Math.log2(b.scale);
    report.exposureTrimY = b.y;
    const tau = new Float32Array(FG_FRAME[0] * FG_FRAME[1]);
    for (let i = 0; i < tau.length; i++) { const g = srgbEncode1(Math.max(0, tp[4 * i])); tau[i] = 12 * g * g; }
    report.foregroundTauP99 = percentileOf(tau, 99);
  });
  report.foregroundOk = report.foregroundTauP99 != null && report.foregroundTauP99 <= FG_TAU_CAP;
  if (!report.foregroundOk) console.warn(`[pipeline] FAIL foreground tau p99 ${report.foregroundTauP99} > ${FG_TAU_CAP} (3.2)`);
  report.volume = state.diag.prelight ? {
    dims: state.diag.prelight.dims, volScale: state.diag.prelight.volScale, sigScale: state.diag.prelight.sigScale,
    skinLo: state.diag.prelight.skinLo, skinHi: state.diag.prelight.skinHi, bytes: state.diag.prelight.bytes,
  } : null;
  report.strands = state.diag.strands ? { ...state.diag.strands, upload: state.diag.strandStore || null } : null;
}

// Everything after phase A (pass 1, the seat choice, pass 2), then the volume stage.
async function afterPhaseA(S) {
  const { ctx, comp, state, report } = S;
  S.seatsKept = [];
  report.pass2 = false;
  report.seats = { kept: [], candidates: [], clamped: [] };
  report.compositionGuardDy = null;
  await passFromB(S, comp.sources, 1);
  const wantSeats = S.opts.seats !== false && (S.sites || []).length > 0;
  if (wantSeats) {
    const pick = await seatChoice(S);
    report.seats.candidates = pick.candidates.map((c) => ({ id: c.id, luma: c.luma }));
    if (pick.kept.length) {
      const px1 = S.previewPx, e1 = state.exposure;
      await step(S, 'restore', () => restoreFromSnap(S));
      S.pass2Running = true;
      const seatSrc = seatSources(pick.kept, state, comp, ctx);
      state.seatSources = seatSrc;
      report.seats.kept = pick.kept.map((s) => s.id);
      report.seats.clamped = seatSrc.clamped.slice();
      S.seatsKept = pick.kept.map((s) => ({ id: s.id, x: s.x, y: s.y }));
      if (S.tier.name !== 'W') { for (const k of ['Snap_U', 'Snap_S', 'Snap_X']) drop(ctx, state, k); }
      report.pass2 = true;
      await passFromB(S, comp.sources.concat(seatSrc), 2);
      S.pass2Running = false;
      report.compositionGuardDy = compositionGuard(S, px1, S.previewPx, e1, S.seatsKept);
    } else {
      for (const k of VOLUME_NAMES) drop(ctx, state, k);
    }
  }
  drop(ctx, state, 'preview');
  await volumeStage(S);
}

// Releases per tier (3.7 item 5, 7.4.4) and fills the report.
function finish(S) {
  const { ctx, state, report } = S;
  const reg = ctx.registry;
  if (S.tier.name !== 'W') {
    // 3.7 item 5: only the volume set stays (gl.deleteTexture through the registry).
    for (const e of reg.list()) if (e.kind === '3d' && !VOLUME_NAMES.includes(e.name)) reg.release(e.name);
    for (const k of ['Opt', 'S', 'S0', 'LA', 'LB', 'LA0', 'LB0', 'Amb', 'Jd', 'Jr', 'Snap_U', 'Snap_S', 'Snap_X']) state[k] = null;
  } else {
    // Only the retain set and the volume set stay among the 3D textures.
    const keep = new Set([nameOf(state.Opt), nameOf(state.S), nameOf(state.LA), nameOf(state.LB), nameOf(state.Amb),
      nameOf(state.Jd), nameOf(state.Jr), 'Snap_U', 'Snap_S', 'Snap_X', ...VOLUME_NAMES]);
    for (const e of reg.list()) if (e.kind === '3d' && !keep.has(e.name)) { console.warn(`[pipeline] release stray 3D ${e.name}`); reg.release(e.name); }
  }
  const h = state.diag.hydro || {};
  Object.assign(report, {
    sigmaS: h.sigmaS, machRms: h.machRms, coherenceMedianA: h.coherenceMedianA, massDrift: h.massDrift,
    seamRatio: h.seamRatio, striationPeakPx: h.striationPeakPx, sigmaSB: h.sigmaSB, densityContrast: h.contrast,
    exposure: state.exposure, exposureTrimEv: state.exposureTrimEv, lmax: state.lmax,
    bytesPeak: reg.bytesPeak(), bytesLive: reg.bytesLive(), live3DAtEnd: reg.live3D(),
    retainBytes: reg.list().filter((e) => e.kind === '3d' && !VOLUME_NAMES.includes(e.name)).reduce((a, e) => a + e.bytes, 0),
    volumeBytes: reg.list().filter((e) => VOLUME_NAMES.includes(e.name) || e.name === 'StrandSeg' || e.name === 'StrandBin')
      .reduce((a, e) => a + e.bytes, 0),
    programsMs: { ...programTimes },
    totalMs: Object.values(report.stagesMs).reduce((a, b) => a + b, 0),
  });
  const want = retainCount(S.tier);
  if (report.live3DAtEnd !== want) throw new Error(`[pipeline] live3D ${report.live3DAtEnd} != retain count ${want}`);
  if (S.tier.name === 'W' && report.bytesLive > BYTES_LIMIT_W) console.warn(`[pipeline] bytesLive ${report.bytesLive} > 190 MB`);
  state.report = report;
  const layers = { ...S.layerMeta(), catalogue: S.catalogue, report };
  S.layers = layers;
  return layers;
}

function makeSession(ctx, comp, sites, opts, onProgress) {
  const tier = TIERS[tierName(opts.tier || ctx.tier)];
  const S = {
    ctx: { ...ctx, tier: tier.name }, comp, sites: sites || [], opts: { ...opts }, onProgress, tier,
    state: { diag: {} }, budgetMs: opts.budgetMs || 12, chunks: 1, t0: performance.now(), lost: false,
  };
  const st = comp.steps.U;
  S.plan = { A: Math.round(st.A * tier.scale), B: Math.round(st.B * tier.scale) };
  S.report = newReport(S);
  S.layerMeta = () => layerMeta(S);
  S.strandFlags = () => {
    const f = S.opts.strands || {};
    return { S: f.S !== undefined ? !!f.S : comp.strands.S !== false, F: f.F !== undefined ? !!f.F : comp.strands.F !== false };
  };
  return S;
}

function hookContextLoss() {
  if (lostHooked) return;
  lostHooked = true;
  onContextLost(() => {
    if (!session) return;
    session.lost = true;
    try { session.ctx.registry.releaseAll(); } catch (e) { console.error(e); }
  });
}

// ---- Public API ----

export function currentSession() { return session; }

export function disposeBake() {
  if (!session) return;
  const reg = session.ctx.registry;
  for (const e of reg.list()) if (e.kind === '3d' || ['preview', 'StrandSeg', 'StrandBin'].includes(e.name)) reg.release(e.name);
  session = null;
}

export async function runBake(ctx, comp, sites, opts, onProgress) {
  hookContextLoss();
  if (session) disposeBake();
  const S = makeSession(ctx, comp, sites, opts || {}, onProgress);
  session = S;
  const { state } = S;
  // Phase A, then Snap (Preview always keeps Snap for the seat toggle; Full only when sites exist).
  await drive(S, 'hydroA', hydroChunks(S.ctx, state, comp, { phase: 'A', sources: comp.sources, pass: 1, stepsPerChunk: 1 }));
  const needSnap = S.tier.name === 'W' || ((S.sites.length > 0) && S.opts.seats !== false);
  if (needSnap) await step(S, 'snap', () => snapshot(S));
  await afterPhaseA(S);
  return finish(S);
}

// rerun('prelight', { palette, channelMask, strands }) reruns only the volume stage (Preview).
// rerun('fromSnap', { seats }) restores U, S, X from Snap and reruns phase B onward (Preview).
// The Full tier keeps no retain set, so both rerun the whole bake there.
// A third argument comp replaces the session composition first (the shuffle panel, pass3-shuffle S3.5).
// The caller makes sure that comp differs from the session only in fields that the stage reads.
export async function rerun(stage, opts, comp) {
  const S = session;
  if (!S) throw new Error('[pipeline] rerun needs a bake first');
  Object.assign(S.opts, opts || {});
  if (comp) S.comp = comp;
  if (S.tier.name !== 'W') return runBake(S.ctx, S.comp, S.sites, S.opts, S.onProgress);
  S.report.stagesMs = {};
  S.chunks = 1;
  S.t0 = performance.now();
  if (stage === 'prelight') {
    for (const k of VOLUME_NAMES) drop(S.ctx, S.state, k);
    await volumeStage(S);
  } else if (stage === 'fromSnap') {
    await step(S, 'restore', () => restoreFromSnap(S));
    S.state.seatSources = null;
    await afterPhaseA(S);
  } else {
    throw new Error(`[pipeline] unknown rerun stage ${stage}`);
  }
  S.report.rerun = stage;
  return finish(S);
}
