// hydro.js: the hydro stage of the bake, phase A (driven turbulence) and phase B (feedback).
// Owner: row A4. Spec: nebula-spec.md 2.3-2.7, 2.10.2, 2.13.2, 2.13.3, 7.4 (table), 7.4.4.
// Unity twin: StarMapHydro.compute and StarMapBakeSession (rows U3, U5).
//
// Exports (grep -n "^export"):
//   function* hydroChunks(ctx, state, comp, opts)   opts = { phase: 'A' | 'B', sources, pass, ion, stepsPerChunk }
//   hydroPrograms(gl) -> { Init, Normalize, ... }   compiled once for each context
//   runSweep(ctx, progs, { U, S, X, Uout, Sout, axis, dtdx })   one sweep (the shock tube page uses it)
//   stepPlan(comp, tier) -> { A, B, dtA, dtB, ionEvery, scale, timeAt(n), tierStep(s) }   2.7 by tier
//   srcTexels(comp, sources, plan) -> Float32Array   the _Src layout of hydro.glsl.js
//   featTexels(comp, plan) -> { data, count }        the _Feat layout of hydro.glsl.js
//   coherenceMedian(map, w, h, win, stride) -> { median, values }   structure-tensor coherence (8.2)
//   striationPeak(shellMap, w, h, comp, tier) -> px  FFT peak of the shell column along F1 (8.2)
//
// STATE (7.4.4). After each yield, state.U0, state.S0 and state.X hold the current fields, and
// state.U1, state.S1 are scratch. The ping-pong swaps the references, so a state slot can hold
// the registry texture of the other name (state.U0.name can be 'U1'). Other readers use the slots.
//   phase A writes: U0, U1, S0, S1, X, F, state.diag.hydro (sigmaS, machRms, coherenceMedianA, seamRatio,
//                   columnA, mass0, massA), state.forcingA (CPU snapshot of the OU stream for phase B)
//   phase B reads:  IonH, RadH (row A5) when they exist; writes U0..S1, X, OptH (before each
//                   ionization update), Opt, Vel (after Striate), state.diag.hydro (massDrift, striationPeakPx,
//                   machRmsB). Phase B releases F, OptH and the private textures at its end.
//   Private registry names: 'X_b' (the X partner), 'hydro.src', 'hydro.feat', 'hydro.modes', 'hydro.col0..2'.
//   It never writes report (row A8 owns it).
//
// IONIZATION UPDATES (phase B, every ionEvery steps). hydroChunks writes OptH, sets state.hydroTime and
// state.hydroStep, then runs opts.ion(ctx, state, comp, { res: 'half', sources, time, step }) with yield*,
// when opts.ion is a generator function (for example starRaysChunks of row A5). Without opts.ion it
// yields { stage: 'hydro.ion', ion: true, step, time } so that the caller can run StarRays before it
// calls next(). The Sources kernel reads IonH and RadH only when state.IonH and state.RadH exist.

import { program } from '../gl/context.js';
import { runSlicePass, readFloat } from '../gl/passes.js';
import { TIERS, CONTENT_W, CONTENT_H, DEPTH, depthOf } from '../params.js';
import { HYDRO_FS, MAX_SRC, SRC_ROWS, MAX_FEAT, FEAT_ROWS } from './shaders/hydro.glsl.js';
import { pcg32, buildModes, ouUpdate } from './forcing.js';

const BOX = [CONTENT_W, CONTENT_H, DEPTH];
const QDEN = 1.2156e45;   // Qhat denominator, s^-1 (2.1)
const F_CELL = [40, 40, 80];   // the force grid: 1/4 of tier U on both tiers (144 x 27 x 24)

const progCache = new WeakMap();

export function hydroPrograms(gl) {
  let p = progCache.get(gl);
  if (p) return p;
  p = {};
  for (const name of Object.keys(HYDRO_FS)) p[name] = program(gl, 'hydro.' + name, null, HYDRO_FS[name]);
  progCache.set(gl, p);
  return p;
}

function tierOfCtx(ctx) {
  const t = ctx.tier;
  if (typeof t === 'string') return TIERS[t];
  return t && t.dims ? t : TIERS.W;
}

export function stepPlan(comp, tier) {
  const s = comp.steps.U;
  const scale = tier.scale;
  const A = Math.round(s.A * scale), B = Math.round(s.B * scale);
  const dtA = s.dtA / scale, dtB = s.dtB / scale;
  const ionEvery = Math.max(1, Math.round(s.ionEvery * scale));
  const tierStep = (st) => Math.round(st * scale);
  const timeAt = (n) => (n <= A ? n * dtA : A * dtA + (n - A) * dtB);
  return { A, B, dtA, dtB, ionEvery, scale, tierStep, timeAt };
}

function qhatOf(s) {
  if (s.qMode === 'qhat') return s.qhat;
  if (s.qMode === 'logQ0') return Math.pow(10, s.logQ0) / QDEN;
  return 0;
}

export function srcTexels(comp, sources, plan) {
  const n = Math.min(sources.length, MAX_SRC);
  if (sources.length > MAX_SRC) console.warn(`[hydro] ${sources.length} sources; the _Src texture holds ${MAX_SRC}`);
  const d = new Float32Array(MAX_SRC * SRC_ROWS * 4);
  const put = (i, r, v) => { const o = (r * MAX_SRC + i) * 4; for (let c = 0; c < 4; c++) d[o + c] = v[c] || 0; };
  for (let i = 0; i < n; i++) {
    const s = sources[i];
    const [x, y, p] = s.pos;
    put(i, 0, [x, y, depthOf(p), p]);
    put(i, 1, [qhatOf(s), s.logQ1 != null ? Math.pow(10, s.logQ1) / QDEN : 0,
               s.logQfuv != null ? Math.pow(10, s.logQfuv) / QDEN : 0, s.influencePx || 0]);
    if (s.wind) put(i, 2, [s.wind.v, s.wind.rPx, s.wind.rho, s.wind.ejecta ? 1 : 0]);
    if (s.jet) {
      put(i, 3, [s.jet.axisDeg, s.jet.tiltDeg, s.jet.v, 1]);
      put(i, 4, [s.jet.period, s.jet.duty, plan.timeAt(plan.tierStep(s.jet.step)), s.jet.precessDeg || 0]);
    }
    if (s.sink) put(i, 5, [s.sink.gm, s.sink.softL, s.sink.rhoMax, plan.timeAt(plan.tierStep(s.sink.step))]);
    if (s.move) put(i, 6, [s.move.dir[0], s.move.dir[1], s.move.dir[2], s.move.v]);
    put(i, 7, [s.wind ? plan.timeAt(plan.tierStep(s.wind.step)) : 0, s.sink ? s.sink.accL : 0,
               s.sink ? s.sink.rate : 0, s.wind ? 1 : 0]);
  }
  return { data: d, count: n };
}

const SHAPE_ID = { filament: 0, clump: 1, halfspace: 2 };

export function featTexels(comp, plan) {
  const d = new Float32Array(MAX_FEAT * FEAT_ROWS * 4);
  const fs = comp.features.slice(0, MAX_FEAT);
  const put = (i, r, v) => { const o = (r * MAX_FEAT + i) * 4; for (let c = 0; c < 4; c++) d[o + c] = v[c] || 0; };
  fs.forEach((f, i) => {
    if (!(f.shape in SHAPE_ID)) throw new Error(`[hydro] unknown shape ${f.shape}`);
    put(i, 0, [SHAPE_ID[f.shape], f.contrast, f.size || 0, plan.tierStep(f.step)]);
    if (f.a) put(i, 1, [f.a[0], f.a[1], depthOf(f.a[2]), 0]);
    if (f.b) put(i, 2, [f.b[0], f.b[1], depthOf(f.b[2]), 0]);
    if (f.shape === 'halfspace') {
      put(i, 3, [f.x[0], f.x[1], f.x[2], f.ySoft]);
      // p 1.00 -> 0.80 is z 520 -> 1160: the band runs from the smaller z to the larger z.
      const z0 = depthOf(f.p[0]), z1 = depthOf(f.p[1]);
      put(i, 4, [Math.min(z0, z1), Math.max(z0, z1), f.zSoft, 0]);
    }
  });
  return { data: d, count: fs.length };
}

function f1Of(comp) {
  const id = comp.striations.feature;
  const f = comp.features.find((q) => q.id === id);
  if (!f) throw new Error(`[hydro] striation feature ${id} is missing`);
  return { A: [f.a[0], f.a[1], depthOf(f.a[2])], B: [f.b[0], f.b[1], depthOf(f.b[2])], r: f.size };
}

// Density contrast of GasCopy (pass 3 volume body). The target width is the lognormal width of
// isothermal turbulence at the rms Mach number that phase A measured (the design Mach of the forcing when
// there is none), sigma_t = sqrt(ln(1 + b^2 M^2)), b = 0.43 (2.5). gamma = sigma_t / sigma_s(phase B), at least 1
// and at most 2. mu = mean ln rho.
export function densityContrastOf(comp, d, machA) {
  const M = machA > 0 ? machA : comp.forcing.mach;
  const sigmaT = Math.sqrt(Math.log(1 + 0.43 * 0.43 * M * M));
  const gamma = d.sigmaS > 0 ? Math.min(2, Math.max(1, sigmaT / d.sigmaS)) : 1;
  return { gamma, mu: d.meanLn, sigmaT, sigmaSB: d.sigmaS, mach: M };
}

// Lab (LAB-DESIGN.md 5): the polytropic neutral gas of the sweep and the dense-dust factor of GasCopy.
// Without comp.eos or comp.dust they give the isothermal gas and the plain opacity.
export function polyOf(comp) {
  const e = comp.eos;
  return e ? [e.gamma - 1, e.rhoC, e.floor] : [0, 1, 1];
}
export function dustOf(comp) {
  const d = comp.dust;
  return d ? [Math.min(2, d.boost), d.rho[0], d.rho[1]] : [0, 1, 2];
}

// Foreground cap of GasCopy (3.2, C3): (rho cap, z0, z1, 0). Without envelope.fgCap: no cap.
function fgCapOf(comp) {
  const g = comp.envelope.fgCap;
  return g ? [g.rho, g.z[0], g.z[1], 0] : [1e9, 0, 1, 0];
}

function envUniforms(comp, scale) {
  const E = comp.envelope;
  const f1 = comp.features.find((q) => q.id === E.inflow.feature);
  return {
    _RhoBase: E.rhoBase, _YTop: E.yTop,
    _CavX: [E.cavM.x[0], E.cavM.x[1], E.cavM.x[2], E.cavM.depth], _CavY: [E.cavM.y[0], E.cavM.y[1], 0, 0],
    _Tail: [E.tailR.x[0], E.tailR.x[1], E.tailR.x[2], E.tailR.depth],
    _InA: [f1.a[0], f1.a[1], depthOf(f1.a[2])], _InB: [f1.b[0], f1.b[1], depthOf(f1.b[2])],
    _InR: [E.inflow.speed, E.inflow.r[0], E.inflow.r[1], E.inflow.r[2]],
    _Scale: scale,
  };
}

function shellUniforms(comp) {
  const f1 = f1Of(comp);
  return { _F1A: f1.A, _F1B: f1.B, _F1R: f1.r, _Shell: comp.striations.shell };
}

function common(dims, cell) {
  return { _Dims: dims, _Cell: cell, _Box: BOX };
}

function swap(state, a, b) { const t = state[a]; state[a] = state[b]; state[b] = t; }

// poly: (gamma - 1, rhoC, floor) of the lab polytropic neutral gas (LAB-DESIGN.md 5.1). (0, 1, 1) is isothermal.
export function runSweep(ctx, progs, { U, S, X, Uout, Sout, axis, dtdx, poly = [0, 1, 1] }) {
  const e = typeof U === 'string' ? ctx.registry.get(U) : U;
  const dims = [e.w, e.h, e.d];
  runSlicePass(ctx, progs.Sweep, {
    targets: [Uout, Sout], dims,
    uniforms: { _Dims: dims, _Axis: axis, _DtDx: dtdx, _Poly: poly },
    textures: { _U: U, _S: S, _X: X },
  });
}

// ---- CPU diagnostics (level 2 of the two-level sum: fixed order, float64) ----

export function coherenceMedian(map, w, h, win, stride) {
  const L = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = Math.log(Math.max(map[i], 1e-12));
  const gx = new Float64Array(w * h), gy = new Float64Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const xp = (i + 1) % w, xm = (i - 1 + w) % w;
      const yp = Math.min(h - 1, j + 1), ym = Math.max(0, j - 1);
      gx[j * w + i] = 0.5 * (L[j * w + xp] - L[j * w + xm]);
      gy[j * w + i] = (L[yp * w + i] - L[ym * w + i]) / Math.max(1, yp - ym);
    }
  }
  const values = [];
  for (let y0 = 0; y0 + win <= h; y0 += stride) {
    for (let x0 = 0; x0 + win <= w; x0 += stride) {
      let xx = 0, yy = 0, xy = 0;
      for (let j = y0; j < y0 + win; j++) {
        for (let i = x0; i < x0 + win; i++) {
          const a = gx[j * w + i], b = gy[j * w + i];
          xx += a * a; yy += b * b; xy += a * b;
        }
      }
      const tr = xx + yy;
      values.push(tr > 1e-20 ? Math.sqrt((xx - yy) * (xx - yy) + 4 * xy * xy) / tr : 0);
    }
  }
  const s = [...values].sort((a, b) => a - b);
  const median = s.length ? (s.length % 2 ? s[(s.length - 1) >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : 0;
  return { median, values };
}

// Shell column (sum rho m / sum m over z) sampled along the F1 axis in xy, on the upper side,
// then a periodogram over 30-300 px. Returns the wavelength of the peak in px.
export function striationPeak(shell, w, h, comp, tier) {
  const f1 = f1Of(comp);
  const ax = f1.B[0] - f1.A[0], ay = f1.B[1] - f1.A[1];
  const len = Math.hypot(ax, ay);
  const tx = ax / len, ty = ay / len;
  let nx = -ty, ny = tx;
  if (ny < 0) { nx = -nx; ny = -ny; }   // upper side: the normal with +y
  const cw = BOX[0] / w, ch = BOX[1] / h;
  const sample = (x, y) => {   // bilinear, x wraps, y clamps
    const fx = x / cw - 0.5, fy = Math.min(h - 1, Math.max(0, y / ch - 0.5));
    const i0 = Math.floor(fx), j0 = Math.floor(fy);
    const ax0 = fx - i0, ay0 = fy - j0;
    const i1 = i0 + 1, j1 = Math.min(h - 1, j0 + 1);
    const at = (i, j) => shell[j * w + ((i % w) + w) % w];
    return (1 - ay0) * ((1 - ax0) * at(i0, j0) + ax0 * at(i1, j0)) + ay0 * ((1 - ax0) * at(i0, j1) + ax0 * at(i1, j1));
  };
  const ds = 5;
  const n = Math.floor(len / ds);
  const prof = new Float64Array(n);
  const offs = [];
  for (let q = comp.striations.shell[0] + 0.1; q <= comp.striations.shell[1] - 0.1; q += 0.25) offs.push(q * f1.r);
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    let acc = 0;
    for (const o of offs) acc += sample(f1.A[0] + tx * s + nx * o, f1.A[1] + ty * s + ny * o);
    prof[i] = acc / offs.length;
  }
  // Remove the trend with a 150 px moving mean.
  const half = Math.round(75 / ds);
  const det = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0, c = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) { a += prof[j]; c++; }
    det[i] = prof[i] - a / c;
  }
  let best = 0, bestLam = 0;
  for (let lam = 30; lam <= 300; lam += 1) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { const ph = 2 * Math.PI * i * ds / lam; re += det[i] * Math.cos(ph); im += det[i] * Math.sin(ph); }
    const pw = re * re + im * im;
    if (pw > best) { best = pw; bestLam = lam; }
  }
  void tier;
  return bestLam;
}

// ---- The generator ----

export function* hydroChunks(ctx, state, comp, opts) {
  const { gl, registry } = ctx;
  const tier = tierOfCtx(ctx);
  const dims = tier.dims, cell = tier.cell;
  const plan = stepPlan(comp, tier);
  const progs = hydroPrograms(gl);
  const sources = (opts && opts.sources) || comp.sources;
  const phase = (opts && opts.phase) || 'A';
  const perChunk = Math.max(1, (opts && opts.stepsPerChunk) || 2);
  const fine = (opts && opts.fine) || null;   // lab nest: { origin, ext, normScale, contrast, preStep }
  const C = fine ? { ...common(dims, cell), _Origin: fine.origin, _Ext: fine.ext } : common(dims, cell);
  const cellL = cell.map((c) => c / comp.units.pxPerL);
  const halfDiag = 0.5 * Math.hypot(cell[0], cell[1], cell[2]);
  const fDims = [BOX[0] / F_CELL[0], BOX[1] / F_CELL[1], BOX[2] / F_CELL[2]];
  const diag = (state.diag = state.diag || {});
  const dh = (diag.hydro = diag.hydro || {});
  const f = comp.forcing;
  const updateEvery = Math.max(1, Math.round(f.updateEvery * plan.scale));
  const ramp0 = plan.tierStep(f.rampSteps[0]), ramp1 = plan.tierStep(f.rampSteps[1]);
  const half = [Math.ceil(dims[0] / 2), Math.ceil(dims[1] / 2), Math.ceil(dims[2] / 2)];
  const wave = comp.striations.wave;
  const waveStep = wave ? plan.tierStep(wave.step) : -1;

  // Private data textures (2D).
  const src = srcTexels(comp, sources, plan);
  registry.tex2D('hydro.src', MAX_SRC, SRC_ROWS, 'RGBA32F', { filter: 'nearest', data: src.data });
  const feat = featTexels(comp, plan);
  registry.tex2D('hydro.feat', MAX_FEAT, FEAT_ROWS, 'RGBA32F', { filter: 'nearest', data: feat.data });
  for (let i = 0; i < 3; i++) registry.tex2D('hydro.col' + i, dims[0], dims[1], 'RGBA32F', { filter: 'nearest' });

  const featU = { _Feat: 'hydro.feat' };
  const featN = { _FeatCount: feat.count, _YTop: comp.envelope.yTop };

  // Forcing: CPU modes and the F grid.
  let rng, modes;
  const uploadForce = () => {
    const e = registry.get('hydro.modes');
    if (!e) registry.tex2D('hydro.modes', 768, 1, 'RGBA32F', { filter: 'nearest', data: modes });
    else {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 768, 1, gl.RGBA, gl.FLOAT, modes);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    runSlicePass(ctx, progs.Force, {
      targets: ['F'], dims: fDims,
      uniforms: { _Dims: fDims, _Cell: F_CELL, _Box: BOX, _ForceAmp: (opts && opts.forceAmp != null) ? opts.forceAmp : f.forceAmp },
      textures: { _Modes: 'hydro.modes' },
    });
  };

  const diagnose = (U = state.U0) => {
    runSlicePass(ctx, progs.Diagnose, {
      targets: ['hydro.col0', 'hydro.col1', 'hydro.col2'], dims: [dims[0], dims[1], 1],
      uniforms: { ...C, ...shellUniforms(comp) },
      textures: { _U: U, _S: state.S0, _X: state.X },
    });
    const a = readFloat(ctx, 'hydro.col0', 0), b = readFloat(ctx, 'hydro.col1', 0), c = readFloat(ctx, 'hydro.col2', 0);
    const n = dims[0] * dims[1];
    let mass = 0, n3 = 0, s1 = 0, s2 = 0, n5 = 0, m2 = 0;
    const column = new Float32Array(n), shell = new Float32Array(n), diffX = new Float64Array(dims[0]);
    for (let i = 0; i < n; i++) {
      mass += a[4 * i]; n3 += a[4 * i + 1]; s1 += a[4 * i + 2]; s2 += a[4 * i + 3];
      n5 += b[4 * i]; m2 += b[4 * i + 1];
      diffX[i % dims[0]] += b[4 * i + 2];
      column[i] = a[4 * i];
      shell[i] = c[4 * i + 1] > 1e-6 ? c[4 * i] / c[4 * i + 1] : 0;
    }
    const mean = n3 > 0 ? s1 / n3 : 0;
    const sigmaS = n3 > 0 ? Math.sqrt(Math.max(0, s2 / n3 - mean * mean)) : 0;
    const machRms = n5 > 0 ? Math.sqrt(m2 / n5) : 0;
    const sorted = [...diffX].sort((p, q) => p - q);
    const med = sorted[sorted.length >> 1];
    const seamRatio = med > 0 ? diffX[dims[0] - 1] / med : 0;
    return { mass, sigmaS, machRms, column, shell, seamRatio, meanLn: mean };
  };

  const sourcesPass = (n, hasIon, hasRad) => {
    const t = plan.timeAt(n), dt = n < plan.A ? plan.dtA : plan.dtB;
    let rampF = 1;
    if (n >= ramp1) rampF = 0; else if (n > ramp0) rampF = 1 - (n - ramp0) / (ramp1 - ramp0);
    runSlicePass(ctx, progs.Sources, {
      targets: [state.U1, state.S1, state.Xb], dims,
      uniforms: { ...C, _SrcCount: src.count, _Time: t, _Dt: dt, _ForceRamp: rampF, _HasIon: hasIon ? 1 : 0,
                  _HasRad: hasRad ? 1 : 0, _CellL: cellL, _HalfDiag: halfDiag, _PxPerL: comp.units.pxPerL },
      textures: { _U: state.U0, _S: state.S0, _X: state.X, _F: 'F',
                  _IonH: hasIon ? state.IonH : state.U0, _RadH: hasRad ? state.RadH : state.U0, _Src: 'hydro.src' },
    });
    swap(state, 'U0', 'U1'); swap(state, 'S0', 'S1'); swap(state, 'X', 'Xb');
    return { rampF, dt };
  };

  const poly = polyOf(comp);
  const sweeps = (n, dt) => {
    const order = (n % 2 === 0) ? [0, 1, 2] : [2, 1, 0];
    for (const axis of order) {
      runSweep(ctx, progs, { U: state.U0, S: state.S0, X: state.X, Uout: state.U1, Sout: state.S1, axis, dtdx: dt / cellL[axis], poly });
      swap(state, 'U0', 'U1'); swap(state, 'S0', 'S1');
    }
  };

  const forceStep = (n, rampF) => {
    // OU update every updateEvery steps, over the sim time of those steps.
    if (n > 0 && n % updateEvery === 0 && rampF > 0) {
      const dtOu = plan.timeAt(n) - plan.timeAt(n - updateEvery);
      ouUpdate(modes, rng, dtOu, f.ouT);
      uploadForce();
    }
  };

  if (phase === 'A') {
    // Allocation (7.4.3): every bake 3D texture wraps in x.
    const o32 = { filter: 'nearest', wrapX: 'repeat' };
    const o16 = { filter: 'linear', wrapX: 'repeat' };
    state.U0 = registry.tex3D('U0', dims, 'RGBA32F', o32);
    state.U1 = registry.tex3D('U1', dims, 'RGBA32F', o32);
    state.S0 = registry.tex3D('S0', dims, 'RGBA16F', o16);
    state.S1 = registry.tex3D('S1', dims, 'RGBA16F', o16);
    state.X = registry.tex3D('X', dims, 'R16F', o16);
    state.Xb = registry.tex3D('X_b', dims, 'R16F', o16);
    state.F = registry.tex3D('F', fDims, 'RGBA16F', o16);

    // Init, then Normalize (the box mean of rho becomes 1).
    runSlicePass(ctx, progs.Init, {
      targets: [state.U0, state.S0, state.X], dims,
      uniforms: { ...C, ...featN, ...envUniforms(comp, 1) }, textures: featU,
    });
    let d0 = diagnose();
    const nVox = dims[0] * dims[1] * dims[2];
    dh.meanRhoInit = d0.mass / nVox;
    runSlicePass(ctx, progs.Normalize, {
      targets: [state.U1], dims, uniforms: { ...C, _Scale: fine ? fine.normScale : 1 / dh.meanRhoInit }, textures: { _U: state.U0 },
    });
    swap(state, 'U0', 'U1');
    d0 = diagnose();
    dh.mass0 = d0.mass;
    dh.sigmaS0 = d0.sigmaS;
    yield { stage: 'hydro.init', step: 0, steps: plan.A };

    rng = pcg32(comp.seed);
    modes = buildModes(comp, tier, rng);
    uploadForce();

    for (let n = 0; n < plan.A; n++) {
      if (fine && fine.preStep) fine.preStep(state, n);
      const { rampF, dt } = sourcesPass(n, false, false);
      sweeps(n, dt);
      forceStep(n + 1, rampF);
      if ((n + 1) % perChunk === 0 || n + 1 === plan.A) yield { stage: 'hydro.A', step: n + 1, steps: plan.A };
    }

    const dA = diagnose();
    const win = Math.round(26 * tier.scale), stride = Math.max(1, Math.round(13 * tier.scale));
    const coh = coherenceMedian(dA.column, dims[0], dims[1], win, stride);
    Object.assign(dh, {
      sigmaS: dA.sigmaS, machRms: dA.machRms, coherenceMedianA: coh.median, coherenceWindows: coh.values.length,
      seamRatio: dA.seamRatio, massA: dA.mass, massDrift: dA.mass / dh.mass0 - 1,
      columnA: { w: dims[0], h: dims[1], data: dA.column },
    });
    state.forcingA = { modes: Float32Array.from(modes), rng: rng.save() };
    registry.releasePrefix('hydro.');
    yield { stage: 'hydro.diagnoseA', step: plan.A, steps: plan.A };
    return;
  }

  // ---- Phase B (pass 1, or pass 2 after the restore from Snap) ----
  if (!state.U0 || !state.S0 || !state.X) throw new Error('[hydro] phase B needs the phase-A fields U0, S0, X');
  if (!state.U1 || !registry.get(state.U1.name)) state.U1 = registry.tex3D(state.U0.name === 'U0' ? 'U1' : 'U0', dims, 'RGBA32F', { filter: 'nearest', wrapX: 'repeat' });
  if (!state.S1 || !registry.get(state.S1.name)) state.S1 = registry.tex3D(state.S0.name === 'S0' ? 'S1' : 'S0', dims, 'RGBA16F', { filter: 'linear', wrapX: 'repeat' });
  if (!state.Xb || !registry.get(state.Xb.name)) state.Xb = registry.tex3D(state.X.name === 'X' ? 'X_b' : 'X', dims, 'R16F', { filter: 'linear', wrapX: 'repeat' });
  if (!state.F || !registry.get(state.F.name)) state.F = registry.tex3D('F', fDims, 'RGBA16F', { filter: 'linear', wrapX: 'repeat' });
  rng = pcg32(comp.seed);
  if (state.forcingA) { modes = Float32Array.from(state.forcingA.modes); rng.load(state.forcingA.rng); } else modes = buildModes(comp, tier, rng);
  uploadForce();
  state.OptH = registry.tex3D('OptH', half, 'RG16F', { filter: 'linear', wrapX: 'repeat' });

  const n0 = plan.A, n1 = plan.A + plan.B;
  const featSteps = new Set(comp.features.map((q) => plan.tierStep(q.step)).filter((s) => s > 0));
  for (let n = n0; n < n1; n++) {
    // AddFeatures (with the striation wave at its step).
    if (featSteps.has(n) || n === waveStep) {
      runSlicePass(ctx, progs.AddFeatures, {
        targets: [state.U1], dims,
        uniforms: { ...C, ...featN, ...shellUniforms(comp), _Step: featSteps.has(n) ? n : -1000,
                    _Wave: n === waveStep ? 1 : 0, _WaveAmp: wave ? wave.amp : 0, _WaveLambda: wave ? wave.lambdaPx : 60 },
        textures: { ...featU, _U: state.U0 },
      });
      swap(state, 'U0', 'U1');
    }
    // Ionization and push update.
    if ((n - n0) % plan.ionEvery === 0) {
      runSlicePass(ctx, progs.GasCopyH, {
        targets: [state.OptH], dims: half, uniforms: { _Dims: dims, _Cell: cell, _Box: BOX },
        textures: { _U: state.U0, _S: state.S0 },
      });
      state.hydroTime = plan.timeAt(n);
      state.hydroStep = n;
      if (opts && typeof opts.ion === 'function') {
        yield* opts.ion(ctx, state, comp, { res: 'half', sources, time: state.hydroTime, step: n });
      } else {
        yield { stage: 'hydro.ion', ion: true, step: n, time: state.hydroTime };
      }
    }
    const hasIon = !!(state.IonH && registry.get(state.IonH.name || state.IonH));
    const hasRad = !!(state.RadH && registry.get(state.RadH.name || state.RadH));
    if (fine && fine.preStep) fine.preStep(state, n);
    const { rampF, dt } = sourcesPass(n, hasIon, hasRad);
    sweeps(n, dt);
    forceStep(n + 1, rampF);
    if ((n + 1 - n0) % perChunk === 0 || n + 1 === n1) yield { stage: 'hydro.B', step: n + 1, steps: n1 };
  }

  // Striations: field-aligned diffusion in the F1 shell (2.10.2).
  const sx = f1Of(comp);
  const bl = Math.hypot(sx.B[0] - sx.A[0], sx.B[1] - sx.A[1]);
  const bHat = [-(sx.B[1] - sx.A[1]) / bl, (sx.B[0] - sx.A[0]) / bl];
  for (let it = 0; it < comp.striations.iterations; it++) {
    runSlicePass(ctx, progs.Striate, {
      targets: [state.U1], dims, uniforms: { ...C, ...shellUniforms(comp), _B: bHat, _K: comp.striations.k },
      textures: { _U: state.U0 },
    });
    swap(state, 'U0', 'U1');
  }
  yield { stage: 'hydro.striate', step: n1, steps: n1 };

  // GasCopy: Opt and Vel at full resolution for the light stage and the strand trace.
  // Pass 3 volume body: Diagnose runs first, so GasCopy can give the neutral gas the log-density width
  // of the phase A rms Mach number (2.5): sigma_t = sqrt(ln(1 + b^2 M^2)), b = 0.43.
  const dB = diagnose();
  const contrast = fine && fine.contrast ? fine.contrast : densityContrastOf(comp, dB, dh.machRms);
  state.Opt = registry.tex3D('Opt', dims, 'RG16F', { filter: 'linear', wrapX: 'repeat' });
  state.Vel = registry.tex3D('Vel', dims, 'RGBA16F', { filter: 'linear', wrapX: 'repeat' });
  runSlicePass(ctx, progs.GasCopy, {
    targets: [state.Opt, state.Vel], dims, textures: { _U: state.U0, _S: state.S0, _X: state.X },
    uniforms: { ...C, _FgCap: fgCapOf(comp), _Contrast: [contrast.gamma, contrast.mu, 0, 0], _Dust: dustOf(comp) },
  });
  const dO = diagnose(state.Opt);
  dh.contrast = { ...contrast, sigmaSOpt: dO.sigmaS, massRatio: dB.mass > 0 ? dO.mass / dB.mass : 0 };

  dh.massB = dB.mass;
  dh.massDrift = dB.mass / dh.mass0 - 1;
  dh.machRmsB = dB.machRms;
  dh.sigmaSB = dB.sigmaS;
  dh.striationPeakPx = striationPeak(dB.shell, dims[0], dims[1], comp, tier);
  dh.columnB = { w: dims[0], h: dims[1], data: dB.column };

  // Release what only the hydro stage reads (3.7 item 2 releases U, S and X later, in row A8).
  registry.release(state.F.name); state.F = null;
  registry.release(state.OptH.name); state.OptH = null;
  registry.release(state.Xb.name); state.Xb = null;
  registry.releasePrefix('hydro.');
  yield { stage: 'hydro.diagnoseB', step: n1, steps: n1 };
}
