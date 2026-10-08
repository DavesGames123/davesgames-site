// ============================================================================
//  ROCHE LIMIT  ·  app/history.js — readback, analysis and the history records
// ----------------------------------------------------------------------------
//  readAll() reads every moon, has worker.js analyse it and keeps one
//  record in run.snaps. restoreSnap() puts a record back on the GPU.
//
//  grep -n targets
//    readback ............ "async function readAll"
//    analysis ............ "function onAnalysis"
//    runs plot points .... "function addRunPoint"
//    restore ............. "function restoreSnap"
//    truncate ............ "function truncateHistory"
// ============================================================================
import * as P from '../physics.js';
import { updatePace } from '../pacing.js';
import { syncScrub } from './controls.js';
import { SNAP_CAP, RUNS_KEY } from './env.js';
import { workerCall } from './jobs.js';
import { allFree } from './loop.js';
import { refreshReadout } from './readout.js';
import { S } from './state.js';
import { updatePhase, storyKeyAt, syncStory } from './story.js';

// Read every moon, analyse, then keep one history record for the read.
export async function readAll(potential) {
  const serial = S.run.serial, epoch = S.run.epoch;
  const parts = await Promise.all(S.run.sats.map(s => readAndAnalyze(s, potential, epoch)));
  if (serial !== S.runSerial || epoch !== S.run.epoch || parts.some(p => !p)) return;
  updatePhase(parts[0].t);
  const s0 = S.run.sats[0];
  if (S.run.pace && s0.an) updatePace(S.run.pace, { f: s0.an.f, el: s0.an.el }, parts[0].t, S.run.T0);
  const t = parts[0].t, last = S.run.snaps[S.run.snaps.length - 1];
  if (last && t <= last.t + 1e-9) return;
  S.run.snaps.push({ t, sats: parts, story: Object.assign({}, S.run.story), pace: S.run.pace ? Object.assign({}, S.run.pace) : null });
  if (S.run.snaps.length > SNAP_CAP) {
    // drop the record whose neighbours are closest in time
    let best = 1, gap = Infinity;
    for (let i = 1; i < S.run.snaps.length - 1; i++) { const g = S.run.snaps[i + 1].t - S.run.snaps[i - 1].t; if (g < gap) { gap = g; best = i; } }
    S.run.snaps.splice(best, 1);
  }
  S.run.viewIdx = S.run.snaps.length - 1;
  syncScrub();
}
async function readAndAnalyze(s, potential, epoch) {
  const serial = S.run.serial;
  s.waiting = true;
  const rb = await s.gpu.readback(potential);
  if (!rb) { s.waiting = false; return null; }
  if (serial !== S.runSerial) return null;
  // the compact copy for the history: position, velocity, spin
  const N = s.N, st = new Float32Array(N * 9), b = rb.body;
  for (let i = 0; i < N; i++) {
    const o = 12 * i, q = 9 * i;
    st[q] = b[o]; st[q + 1] = b[o + 1]; st[q + 2] = b[o + 2];
    st[q + 3] = b[o + 4]; st[q + 4] = b[o + 5]; st[q + 5] = b[o + 6];
    st[q + 6] = b[o + 8]; st[q + 7] = b[o + 9]; st[q + 8] = b[o + 10];
  }
  const res = await workerCall({ type: 'analyze', N: s.N, np: s.gpu.np, body: rb.body, grav: rb.grav, rad: s.rad, X: rb.X, V: rb.V, GMp: s.pl.GM, t: rb.t, fragCount: 24, seed: S.run.frames }, [rb.body.buffer, rb.grav.buffer]);
  s.waiting = false;
  if (serial !== S.runSerial || epoch !== S.run.epoch) return null;
  onAnalysis(s, res, rb);
  return { t: rb.t, X: rb.X, V: rb.V, W: rb.W, Llost: rb.Llost, drag: s.pl.drag, st, tags: res.tags, an: s.an, E0: s.E0, Us0: s.Us0, L0: s.L0 };
}
function onAnalysis(s, a, rb) {
  S.ren.setTags(s.e, a.tags);
  const T0 = S.run.T0, tt = a.t / T0;
  const f = a.M / s.M0;
  // energy ledger: E - W, relative to |U_self| at the start; only from a
  // readback with a fresh potential
  const prevDrift = s.an ? s.an.drift : NaN;
  let drift = prevDrift;
  if (rb.fresh) {
    const ledger = a.E - rb.W;
    if (s.E0 === null) { s.E0 = ledger; s.Us0 = Math.abs(a.Us); }
    drift = Math.abs(ledger - s.E0) / s.Us0;
  }
  if (s.L0 === null || s.L0 === undefined) s.L0 = a.L[2];
  const Ldrift = (a.L[2] + rb.Llost[2] - s.L0) / Math.abs(s.L0);
  // once the bound mass is small, the field and the labels use the frame
  // point (the start orbit of the moon) instead of the remnant
  const live = f > 0.2 && a.M > 0;
  s.an = { f, live, el: live ? a.el : 1, axis: a.axis, com: live ? a.com : [0, 0, 0], vcm: live ? a.vcm : [0, 0, 0], rH: live ? a.rH : NaN, comAll: a.comAll, vcmAll: a.vcmAll, spread: a.spread, groups: a.groups, M: a.M, X: a.X, V: a.V, t: a.t, drift, Ldrift, accreted: a.accreted, wall: performance.now() };
  // the ledger E - W holds only without the drag: it starts again when
  // the drag stops
  if (s.pl.drag > 0) { s.an.drift = NaN; s.E0 = null; }
  if (!s.hist.length || tt > s.hist[s.hist.length - 1][0]) { s.hist.push([tt, f]); if (s.hist.length > 2000) s.hist.splice(0, s.hist.length - 2000); }
  if (rb.fresh && Number.isFinite(s.an.drift)) { s.ehist.push([tt, Math.max(drift, 1e-12)]); if (s.ehist.length > 2000) s.ehist.splice(0, 1); }
  // shed-grain conics
  s.frag = [];
  const fr = a.frag;
  for (let i = 0; i + 5 < fr.length && s.frag.length < 6; i += 6) {
    const r = [fr[i], fr[i + 1], fr[i + 2]], v = [fr[i + 3], fr[i + 4], fr[i + 5]];
    s.frag.push(P.keplerPath(r, v, s.pl.GM, 0.1 * T0, 24).pts);
  }
  // a run point after 3 orbits (circular kinds only)
  if (!S.run.recorded && tt >= 3 && (S.run.spec.kind === 'circular' || S.run.spec.kind === 'compare' || S.run.spec.kind === 'real')) {
    if (s.idx === S.run.sats.length - 1) S.run.recorded = true;
    addRunPoint({ x: S.run.spec.d / Math.cbrt(S.run.spec.q), y: f, mat: s.matName });
  }
}
function addRunPoint(p) {
  const list = loadRuns(); list.push(p); while (list.length > 60) list.shift();
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(list)); } catch (e) {}
}
export function loadRuns() { try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '[]'); } catch (e) { return []; } }

// Put history record i back onto the GPU: the grains, the frame point, the
// drag, the tags and the analysis. The run stays paused on it.
export function restoreSnap(i) {
  if (!S.run || S.run.phase !== 'orbit' || !S.run.snaps.length) return;
  i = Math.max(0, Math.min(S.run.snaps.length - 1, i | 0));
  if (!allFree()) { S.run.pendingRestore = i; return; }
  const rec = S.run.snaps[i];
  S.run.epoch++;
  S.run.sats.forEach((s, k) => {
    const sn = rec.sats[k], N = s.N;
    const pos = new Float64Array(N * 3), vel = new Float64Array(N * 3), spin = new Float64Array(N * 3);
    for (let j = 0; j < N; j++) for (let c = 0; c < 3; c++) { pos[3 * j + c] = sn.st[9 * j + c]; vel[3 * j + c] = sn.st[9 * j + 3 + c]; spin[3 * j + c] = sn.st[9 * j + 6 + c]; }
    s.ref.X = sn.X.slice(); s.ref.V = sn.V.slice(); s.ref.t = sn.t;
    s.pl.drag = sn.drag;
    s.gpu.setParams(s.C, s.pl, 0);
    s.gpu.setState(pos, vel, spin, s.rad, s.mass);
    s.gpu.t = sn.t; s.gpu.W = sn.W; s.gpu.Llost = sn.Llost.slice();
    s.gpu.prime();
    S.ren.setTags(s.e, sn.tags); s.e.fresh = true;
    s.an = sn.an; s.E0 = sn.E0; s.Us0 = sn.Us0; s.L0 = sn.L0;
  });
  S.run.t = rec.t; S.run.viewIdx = i; S.run.track = []; S.warpCarry = 0; S.run.stepLeft = 0;
  S.run.story = Object.assign({}, rec.story);
  if (rec.pace) S.run.pace = Object.assign({}, rec.pace);
  S.run.storyKey = storyKeyAt(S.run.story);
  syncScrub(); syncStory(); refreshReadout(true);
}
// Play or step after a scrub: the records after the current one, and the
// plot points after its time, are gone.
export function truncateHistory() {
  if (!S.run || S.run.viewIdx < 0 || S.run.viewIdx >= S.run.snaps.length - 1) return;
  S.run.snaps.length = S.run.viewIdx + 1;
  const tt = S.run.t / S.run.T0;
  for (const s of S.run.sats) { s.hist = s.hist.filter(p => p[0] <= tt + 1e-9); s.ehist = s.ehist.filter(p => p[0] <= tt + 1e-9); }
  syncScrub();
}
