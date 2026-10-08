// ============================================================================
//  ROCHE LIMIT  ·  app/debug.js — profile and debug state
// ----------------------------------------------------------------------------
//  profile() times each GPU and CPU stage. debugState() is the
//  snapshot that window.__roche.state() gives the headless checks.
//
//  grep -n targets
//    stage times .... "async function profile"
//    snapshot ....... "function debugState"
// ============================================================================
import { camStats } from './camera.js';
import { $, UI, Q } from './env.js';
import { workerCall } from './jobs.js';
import { buildSegments } from './lines.js';
import { stepsWanted, orbitsPerMin } from './loop.js';
import { refreshReadout } from './readout.js';
import { satState } from './sat.js';
import { S } from './state.js';

// Per-stage GPU time (ms, median of n): each stage is submitted alone and
// timed to its completion on the queue (onSubmittedWorkDone). The frame
// loop stops while it runs. Stages: sim blocks (1 and 4), the gravity sum
// alone, a readback, the worker analysis, then the render stages and each
// scene draw alone.
export async function profile(n = 7) {
  S.profiling = true;
  await new Promise(r => setTimeout(r, 100));
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const q = S.dev.queue, s = S.run.sats[0], g = s.gpu, out = {};
  const time = async fn => { await q.onSubmittedWorkDone(); const t0 = performance.now(); await fn(); await q.onSubmittedWorkDone(); return performance.now() - t0; };
  const rep = async (name, fn) => { const a = []; for (let i = 0; i < n; i++) a.push(await time(fn)); out[name] = +med(a).toFixed(2); };
  const steps = Math.max(1, Math.round(stepsWanted()));
  await rep('sim 1 block', () => { const e = S.dev.createCommandEncoder(); for (const x of S.run.sats) x.gpu.encode(e, 1, false); q.submit([e.finish()]); });
  await rep(`sim ${steps} steps (one frame at this speed)`, () => { const e = S.dev.createCommandEncoder(); for (const x of S.run.sats) x.gpu.encodeSteps(e, steps, false); q.submit([e.finish()]); });
  await rep('gravity sum', () => { const e = S.dev.createCommandEncoder(); const p = e.beginComputePass(); for (const x of S.run.sats) x.gpu._dispatch(p, 'gravity', x.gpu.bg.gravity, null, x.gpu.np); p.end(); q.submit([e.finish()]); });
  await rep('readback', async () => { await g.readback(); });
  { const a = []; for (let i = 0; i < 3; i++) { const rb = await g.readback(); const t0 = performance.now(); await workerCall({ type: 'analyze', N: s.N, np: g.np, body: rb.body, grav: rb.grav, rad: s.rad, X: rb.X, V: rb.V, GMp: s.pl.GM, t: rb.t, fragCount: 24 }, [rb.body.buffer, rb.grav.buffer]); a.push(performance.now() - t0); } out['analysis (worker, CPU)'] = +med(a).toFixed(2); }
  S.run.t = S.run.sats[0].gpu.t;
  const { frame, sims } = S.run.lastFrame;
  if (S.dev.features.has('timestamp-query')) {
    // GPU timestamps: the sim steps of one frame at this speed, then each
    // render stage, all in one submit
    const runs = [];
    for (let i = 0; i < n; i++) runs.push(await S.ren.renderGPU(frame, sims, null, enc => {
      for (const x of S.run.sats) { x.gpu.tw = () => S.ren._tw('sim ' + steps + ' steps'); x.gpu.encodeSteps(enc, steps, false); x.gpu.tw = null; }
    }));
    for (const k of Object.keys(runs[0])) out['GPU ' + k] = +med(runs.map(x => x[k] || 0)).toFixed(3);
    out['GPU frame at this speed'] = +med(runs.map(x => Object.values(x).reduce((a, v) => a + v, 0))).toFixed(3);
    for (const d of ['sky', 'surface', 'part', 'disk', 'field', 'lines', 'atmo']) {
      const a = []; for (let i = 0; i < n; i++) a.push((await S.ren.renderGPU(frame, sims, { [d]: true })).scene);
      out['GPU scene: ' + d + ' alone'] = +med(a).toFixed(3);
    }
  }
  const st = []; for (let i = 0; i < n; i++) st.push(await S.ren.renderTimed(frame, sims));
  for (const k of Object.keys(st[0])) out['render ' + k] = +med(st.map(x => x[k])).toFixed(2);
  for (const d of ['sky', 'surface', 'part', 'disk', 'field', 'lines', 'atmo']) {
    const a = []; for (let i = 0; i < n; i++) a.push((await S.ren.renderTimed(frame, sims, { [d]: true })).scene);
    out['scene: ' + d + ' alone'] = +med(a).toFixed(2);
  }
  { const a = []; for (let i = 0; i < n; i++) a.push((await S.ren.renderTimed(frame, sims, {})).scene); out['scene: empty pass'] = +med(a).toFixed(2); }
  { const t0 = performance.now(); for (let i = 0; i < 20; i++) buildSegments(S.ren.W / $('gpu').clientWidth); out['CPU buildSegments'] = +((performance.now() - t0) / 20).toFixed(2); }
  { const t0 = performance.now(); for (let i = 0; i < 10; i++) refreshReadout(false); out['CPU readouts'] = +((performance.now() - t0) / 10).toFixed(2); }
  out.canvas = `${S.ren.W}x${S.ren.H}`; out.N = S.run.sats.map(x => x.N).join('+'); out.field = UI.field; out['steps per frame'] = steps;
  S.profiling = false;
  return out;
}

export function debugState() {
  if (!S.run) return null;
  return {
    phase: S.run.phase, scen: UI.scen, story: S.run.storyKey, storyT: Object.fromEntries(Object.entries(S.run.story).map(([k, v]) => [k, +(v / S.run.T0).toFixed(3)])),
    quality: { preset: Q.preset, scale: Q.scale, bloom: Q.bloom, stepsMax: S.stepsMax, px: S.ren.W * S.ren.H }, cam: Object.assign({}, camStats, { prev: undefined }), calm: UI.calm,
    orbitsPerMin: orbitsPerMin(), gotOrbitsPerMin: S.run.sats[0] ? S.run.rate * S.run.sats[0].C.dt / S.run.T0 * 60 : 0, paused: UI.paused,
    t: S.run.t, T0: S.run.T0, orbits: S.run.t / S.run.T0, hours: S.run.t * (S.run.tUnitSec || 0) / 3600, snaps: S.run.snaps.length, viewIdx: S.run.viewIdx, wallS: (performance.now() - S.run.started) / 1000,
    gpuMs: S.gpuMs, cpuMs: S.cpuMs, stepsMax: S.stepsMax, fps: S.fps,
    sats: S.run.sats.filter(s => s.ref).map(s => ({ N: s.N, mat: s.matName, f: s.an && s.an.f, drift: s.an && s.an.drift, Ldrift: s.an && s.an.Ldrift, groups: s.an && s.an.groups, accreted: s.an && s.an.accreted, overflow: s.gpu.overflow, d: Math.hypot(...satState(s).r) / s.Rp, drag: s.pl.drag })),
  };
}
