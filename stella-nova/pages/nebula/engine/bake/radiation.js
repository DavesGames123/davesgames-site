// radiation.js: StarRays at half and full resolution, and AmbientScan (WebGL2 bake).
// Owner: row A5. Spec: nebula-spec.md 2.8, 2.13.4, 2.6 item 3, 2.2, 7.4 (table), 7.4.4.
//
// Exports (grep -n "^export"):
//   Q_NORM, BOX_PX, F_O                       constants (2.1, 2.8)
//   simTimeAtStep(comp, stepU)               sim time (t_u) at a tier U step number (2.7)
//   lightSources(comp, sources, t)           the stars that StarRays marches, in dominant-index order
//   starRaysChunks(ctx, state, comp, { res, sources, t, chunkSamples })   generator
//   ambientChunks(ctx, state, opts)          generator
//
// starRaysChunks
//   res 'half': reads state.OptH (rho, rho chi_d). Writes state.IonH = (B_min, B_He, G_FUV, 0) and
//     state.RadH = (a_rad.xyz, 0) on the OptH grid. Step 2 cells. Called once per ionization update.
//   res 'full': reads state.Opt. Writes state.LA0 = (B_min, B_He, tau_dom, dom) and
//     state.LB0 = (I_sc.rgb, G_FUV) on the Opt grid. Step 1 cell. state.LA and state.LB point to the
//     same entries (the slab stage reads them). LA1 and LB1 are the ping-pong partners. This module
//     releases them at the end, so one LA and one LB stay live (7.4.4 retain set).
//   One draw adds one star to one z-layer. The accumulators ping-pong. The parity of the star count
//   sets the first target, so the last star always lands in IonH / RadH (LA0 / LB0).
//   The half pass needs a scratch pair "IonH~pp", "RadH~pp". This module makes the pair at the
//   start of each update and releases it at the end.
//   dom = the index of the star in lightSources(comp, sources), as a float. -1 = no star.
//   The generator yields { stage, star, z0, z1, of } after each chunk of z-layers.
//
// ambientChunks: reads state.Opt (or state.OptH). Writes state.Amb (R16F, half the Opt grid).
//
// Geometry: box px = state.boxPx if it is set (dev pages), else BOX_PX. The cell is box / texture dims.
// Voxel (i, j, k) has its centre at ((i, j, k) + 0.5) cell. y is up, z = 0 is nearest the viewer.
// state values are registry entries. A name string is also accepted; the registry resolves it.

import { program } from '../gl/context.js';
import { runSlicePass } from '../gl/passes.js';
import { CONTENT_W, CONTENT_H, DEPTH, depthOf } from '../params.js';
import { RAYS_HALF_FS, RAYS_FULL_FS, AMB_FS } from './shaders/radiation.glsl.js';

export const Q_NORM = 1.2156e45;                 // 4 pi alpha_B n0^2 l^3 (2.1)
export const BOX_PX = [CONTENT_W, CONTENT_H, DEPTH];
export const F_O = 0.1;                          // [O III] budget share (2.8)
const MAX_STEPS = 256;
const AMB_CAP_PX = 600;
const DEFAULT_CHUNK = 4.0e7;                     // march samples per chunk

const programs = new WeakMap();                  // gl -> { half, full, amb }

// Lab nest (LAB-DESIGN 3.4, 3.7): the fine-box variants of the three programs. Positions are world px
// (_Origin + local). A ray sample inside the box reads the fine _Opt, outside it the coarse _OptC.
const NEST_UNIFORMS = 'uniform highp sampler3D _OptC; uniform vec3 _Origin; uniform vec3 _CBox;\n';
const NEST_OPT = `
float2 NestOpt(float3 q, float3 boxPx)
{
    float3 l = q - _Origin;
    if (l.x >= 0.0 && l.y >= 0.0 && l.z >= 0.0 && l.x <= boxPx.x && l.y <= boxPx.y && l.z <= boxPx.z) return SAMPLE3D(_Opt, l / boxPx).xy;
    q.x = Wrap(q.x, _CBox.x);
    return SAMPLE3D(_OptC, q / _CBox).xy;
}
`;
const NEST_MARCH = `
float2 MarchToStar(float3 p, float3 starPx, float3 boxPx, float stepPx, int maxSteps)
{
    float3 toS = starPx - p; float dist = length(toS);
    float3 dir = toS / max(dist, 0.001);
    int n = min(maxSteps, int(ceil(dist / stepPx)));
    float ds = dist / float(max(n, 1));
    float R = 0.0; float tau = 0.0;
    LOOP for (int i = 0; i < 256; i++)
    {
        if (i >= n) break;
        float t = (float(i) + 0.5) * ds;
        float3 q = p + dir * t;
        if (q.y < 0.0 || q.z < 0.0 || q.y > _CBox.y || q.z > _CBox.z) continue;
        float2 o = NestOpt(q, boxPx);
        float r = (dist - t) / 10.0; float dsl = ds / 10.0;
        R   += o.x * o.x * r * r * dsl;
        tau += 0.02374 * o.y * dsl;
    }
    return float2(R, tau);
}
`;
function nestText(fs, kind) {
  const rep = (t, a, b) => { if (t.split(a).length !== 2) throw new Error('[radiation] nest text: ' + a.slice(0, 50)); return t.replace(a, () => b); };
  let t = rep(fs, 'uniform highp sampler3D _Opt;\n', 'uniform highp sampler3D _Opt;\n' + NEST_UNIFORMS);
  if (kind === 'amb') {
    t = rep(t, 'float AxisTau(', NEST_OPT + 'float AxisTau(');
    t = rep(t, 'if (q.y < 0.0 || q.z < 0.0 || q.y > _Box.y || q.z > _Box.z) break;\n        q.x = Wrap(q.x, _Box.x);\n        tau += NM_KV * SAMPLE3D(_Opt, q / _Box).y * ds;',
      'if (q.y < 0.0 || q.z < 0.0 || q.y > _CBox.y || q.z > _CBox.z) break;\n        tau += NM_KV * NestOpt(q, _Box).y * ds;');
    t = rep(t, 'float3 p = (float3(float(c.x), float(c.y), float(c.z)) + float3(0.5, 0.5, 0.5)) * _Cell;',
      'float3 p = (float3(float(c.x), float(c.y), float(c.z)) + float3(0.5, 0.5, 0.5)) * _Cell + _Origin;');
    return t;
  }
  t = rep(t, '#define NM_HAS_OPT\n', '');
  t = rep(t, 'const float RAD_CLAMP = 60000.0;', NEST_OPT + NEST_MARCH + 'const float RAD_CLAMP = 60000.0;');
  t = rep(t, 's.x = p.x + Wrap(s.x - p.x + 0.5 * _Box.x, _Box.x) - 0.5 * _Box.x;', 's.x = p.x + Wrap(s.x - p.x + 2880.0, 5760.0) - 2880.0;');
  t = rep(t, 'return (float3(float(c.x), float(c.y), float(c.z)) + float3(0.5, 0.5, 0.5)) * _Cell;',
    'return (float3(float(c.x), float(c.y), float(c.z)) + float3(0.5, 0.5, 0.5)) * _Cell + _Origin;');
  return t;
}
const nestPrograms = new WeakMap();
function nestProgs(gl) {
  let p = nestPrograms.get(gl);
  if (!p) {
    p = {
      half: program(gl, 'nest.StarRaysHalf', null, nestText(RAYS_HALF_FS, 'rays')),
      full: program(gl, 'nest.StarRaysFull', null, nestText(RAYS_FULL_FS, 'rays')),
      amb: program(gl, 'nest.AmbientScan', null, nestText(AMB_FS, 'amb')),
    };
    nestPrograms.set(gl, p);
  }
  return p;
}
function nestUniforms(state) { return state.nest ? { _Origin: state.nest.origin, _CBox: BOX_PX } : {}; }
function nestTextures(state, half) { return state.nest ? { _OptC: half ? state.nest.optHC() : state.nest.optC() } : {}; }

function progs(gl) {
  let p = programs.get(gl);
  if (!p) {
    p = {
      half: program(gl, 'StarRaysHalf', null, RAYS_HALF_FS),
      full: program(gl, 'StarRaysFull', null, RAYS_FULL_FS),
      amb: program(gl, 'AmbientScan', null, AMB_FS),
    };
    programs.set(gl, p);
  }
  return p;
}

function entry(ctx, v, label) {
  const e = typeof v === 'string' ? ctx.registry.get(v) : v;
  if (!e || !e.tex) throw new Error(`[radiation] ${label} is not live`);
  return e;
}

function boxOf(state) { return state.boxPx || BOX_PX; }

// Make a 3D texture in the registry and in state, or keep the live one when dims and format match.
function ensure(ctx, state, name, dims, fmt, filter) {
  const v = state[name];
  const old = v && (typeof v === 'string' ? ctx.registry.get(v) : v);
  if (old && old.tex && old.w === dims[0] && old.h === dims[1] && old.d === dims[2] && old.internalFormat === fmt) return old;
  const e = ctx.registry.tex3D(name, dims, fmt, { filter, wrapX: 'repeat' });
  state[name] = e;
  return e;
}

function drop(ctx, state, name) {
  ctx.registry.release(name);
  delete state[name];
}

// Sim time in t_u at a tier U step. Tier W has the same time, because dt doubles and the steps halve.
export function simTimeAtStep(comp, stepU) {
  const s = comp.steps.U;
  return stepU <= s.A ? stepU * s.dtA : s.A * s.dtA + (stepU - s.A) * s.dtB;
}

function endTime(comp) { const s = comp.steps.U; return s.A * s.dtA + s.B * s.dtB; }

// The stars with a photon field (qMode is not 'none'), in a fixed order. Each item:
//   { id, index, posPx: [x, y, z], qhat, qhat1, qhatFuv, teffK, logL, influencePx }
// pos is [x px, y px, p]; z = depthOf(p). An item with posPx uses it as given.
// A moving source (move: { dir, v }) moves from the start step of its wind at v l per t_u (2.6 item 4).
// t: sim time in t_u. Without t, a moving source stays at pos.
export function lightSources(comp, sources, t) {
  const list = [];
  for (const s of sources || comp.sources) {
    if (!s || s.qMode === 'none' || s.qMode == null) continue;
    let qhat;
    if (s.qMode === 'qhat') qhat = s.qhat;
    else if (s.qMode === 'logQ0') qhat = Math.pow(10, s.logQ0) / Q_NORM;
    else throw new Error(`[radiation] ${s.id}: unknown qMode ${s.qMode}`);
    if (!(qhat >= 0)) throw new Error(`[radiation] ${s.id}: qMode ${s.qMode} has no value`);
    const pos = s.posPx ? s.posPx.slice() : [s.pos[0], s.pos[1], depthOf(s.pos[2])];
    if (s.move && t != null) {
      const t0 = simTimeAtStep(comp, s.wind ? s.wind.step : 0);
      const dt = Math.max(0, t - t0);
      const pxPerL = (comp.units && comp.units.pxPerL) || 10;
      for (let i = 0; i < 3; i++) pos[i] += s.move.dir[i] * s.move.v * dt * pxPerL;
    }
    list.push({
      id: s.id, index: list.length, posPx: pos, qhat,
      qhat1: s.logQ1 != null ? Math.pow(10, s.logQ1) / Q_NORM : 0,          // missing logQ1: Qhat1 = 0 (2.8)
      qhatFuv: s.logQfuv != null ? Math.pow(10, s.logQfuv) / Q_NORM : 0,
      teffK: s.teffK != null ? s.teffK : 20000,
      logL: s.logL != null ? s.logL : -40,                                    // no logL: no scattered light
      influencePx: s.influencePx != null ? s.influencePx : 1.0e9,
    });
  }
  return list;
}

function slicesPerChunk(w, h, d, samplesPerTexel, budget) {
  return Math.max(1, Math.min(d, Math.floor(budget / Math.max(1, w * h * samplesPerTexel))));
}

export function* starRaysChunks(ctx, state, comp, opts) {
  const o = opts || {};
  const half = o.res === 'half';
  if (!half && o.res !== 'full') throw new Error(`[radiation] res must be 'half' or 'full', not ${o.res}`);
  const { gl, registry } = ctx;
  const P = state.nest ? nestProgs(gl) : progs(gl);
  const prog = half ? P.half : P.full;
  const src = entry(ctx, half ? state.OptH : state.Opt, half ? 'state.OptH' : 'state.Opt');
  const dims = [src.w, src.h, src.d];
  const box = boxOf(state);
  const cell = [box[0] / dims[0], box[1] / dims[1], box[2] / dims[2]];
  const stepPx = (half ? 2 : 1) * Math.min(cell[0], cell[1], cell[2]);
  const t = o.t != null ? o.t : (half ? null : endTime(comp));
  const stars = lightSources(comp, o.sources, t);
  const budget = o.chunkSamples || DEFAULT_CHUNK;
  const diag = (state.diag = state.diag || {});
  const rad = (diag.radiation = diag.radiation || {});

  let pairP, pairQ;
  if (half) {
    pairP = [ensure(ctx, state, 'IonH', dims, 'RGBA16F', 'linear'), ensure(ctx, state, 'RadH', dims, 'RGBA16F', 'linear')];
    pairQ = [registry.tex3D('IonH~pp', dims, 'RGBA16F', { filter: 'nearest', wrapX: 'repeat' }),
             registry.tex3D('RadH~pp', dims, 'RGBA16F', { filter: 'nearest', wrapX: 'repeat' })];
  } else {
    pairP = [ensure(ctx, state, 'LA0', dims, 'RGBA16F', 'linear'), ensure(ctx, state, 'LB0', dims, 'RGBA16F', 'linear')];
    pairQ = [ensure(ctx, state, 'LA1', dims, 'RGBA16F', 'linear'), ensure(ctx, state, 'LB1', dims, 'RGBA16F', 'linear')];
  }

  try {
    const passes = Math.max(1, stars.length);
    const diagLen = state.nest ? Math.hypot(BOX_PX[0] * 0.5, BOX_PX[1], BOX_PX[2]) : Math.hypot(box[0] * 0.5, box[1], box[2]);
    for (let k = 0; k < passes; k++) {
      const s = stars[k];
      const tgt = ((passes - 1 - k) & 1) === 0 ? pairP : pairQ;   // the last pass writes pairP
      const prev = tgt === pairP ? pairQ : pairP;                  // never bound while it is a target
      const reach = s ? Math.min(s.influencePx, diagLen) : 0;
      const steps = Math.min(MAX_STEPS, Math.ceil(reach / stepPx));
      const uniforms = {
        _First: k === 0 ? 1 : 0,
        _Box: box, _Cell: cell, ...nestUniforms(state),
        _StarPx: s ? s.posPx : [0, 0, 0],
        _Q: s ? [s.qhat, s.qhat1, s.qhatFuv, s.influencePx] : [0, 0, 0, -1],
        _Lum: s ? [s.teffK, s.logL] : [20000, -40],
        _StepPx: stepPx, _MaxSteps: MAX_STEPS, _Index: s ? s.index : -1,
        ...(half ? {} : { _ScatBand: comp.dustBand != null ? comp.dustBand : 0.6 }),
      };
      const per = slicesPerChunk(dims[0], dims[1], dims[2], Math.max(1, steps), budget);
      for (let z0 = 0; z0 < dims[2]; z0 += per) {
        const z1 = Math.min(dims[2], z0 + per);
        runSlicePass(ctx, prog, {
          targets: tgt, uniforms, layers: [z0, z1],
          textures: { _Opt: src, _AccA: prev[0], _AccB: prev[1], ...nestTextures(state, half) },
        });
        yield { stage: half ? 'starRaysHalf' : 'starRaysFull', star: s ? s.id : null, z0, z1, of: dims[2] };
      }
    }
  } finally {
    if (half) { registry.release('IonH~pp'); registry.release('RadH~pp'); }
    else { drop(ctx, state, 'LA1'); drop(ctx, state, 'LB1'); }
  }

  if (half) {
    rad.half = { updates: ((rad.half && rad.half.updates) || 0) + 1, stars: stars.length, dims, stepPx };
  } else {
    state.LA = state.LA0;
    state.LB = state.LB0;
    rad.full = {
      stars: stars.map((s) => ({ id: s.id, index: s.index, posPx: s.posPx, qhat: s.qhat, qhat1: s.qhat1, qhatFuv: s.qhatFuv })),
      dims, stepPx, t,
    };
  }
}

export function* ambientChunks(ctx, state, opts) {
  const o = opts || {};
  const P = state.nest ? nestProgs(ctx.gl) : progs(ctx.gl);
  const src = entry(ctx, state.Opt || state.OptH, 'state.Opt');
  const box = boxOf(state);
  const dims = [Math.ceil(src.w / 2), Math.ceil(src.h / 2), Math.ceil(src.d / 2)];
  const cell = [box[0] / dims[0], box[1] / dims[1], box[2] / dims[2]];
  const amb = ensure(ctx, state, 'Amb', dims, 'R16F', 'linear');
  const samples = 2 * (AMB_CAP_PX / cell[0] + AMB_CAP_PX / cell[1] + AMB_CAP_PX / cell[2]);
  const per = slicesPerChunk(dims[0], dims[1], dims[2], samples, o.chunkSamples || DEFAULT_CHUNK);
  for (let z0 = 0; z0 < dims[2]; z0 += per) {
    const z1 = Math.min(dims[2], z0 + per);
    runSlicePass(ctx, P.amb, {
      targets: amb, layers: [z0, z1], textures: { _Opt: src, ...nestTextures(state, false) },
      uniforms: { _Box: box, _Cell: cell, _CapPx: AMB_CAP_PX, ...nestUniforms(state) },
    });
    yield { stage: 'ambient', z0, z1, of: dims[2] };
  }
  const diag = (state.diag = state.diag || {});
  (diag.radiation = diag.radiation || {}).amb = { dims, capPx: AMB_CAP_PX };
}
