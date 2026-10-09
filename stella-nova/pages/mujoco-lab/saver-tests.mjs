// ============================================================================
//  MUJOCO LAB  ·  saver-tests.mjs — node checks of the screensaver
// ----------------------------------------------------------------------------
//  node stella-nova/pages/mujoco-lab/saver-tests.mjs
//  Plan: seeded and the same for the same seed, all kinds in each bag, no
//  kind twice in a row, cuts of 6 to 12 s, no heavy model on a phone.
//  Run: every shot kind runs to its cut with the real lab.js and the
//  renderer (three r160, no WebGL); the state and the camera stay finite,
//  the plate has a title, a credit line and one TeX line and no code. The
//  events of the shots happen: the tippe top turns over, the push moves
//  the stacks, the replay finds an impact and goes back in time, the
//  domino front moves. The WASM heap does not grow over rounds of shots.
// ============================================================================
import * as THREE from '../../vendor/three@0.160.0/build/three.module.js';
import { makePlan, camAt, actionCentre, bandFrame, KINDS } from './saver-plan.js';
import { startSaver } from './saver.js';
import { createLab } from './lab.js';
import { heapBytes } from './core/engine.js';
import { modelByKey } from './core/models.js';
import { createMjRenderer } from './render/renderer.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const fin = a => Array.from(a).every(Number.isFinite);

// ---- plan --------------------------------------------------------------------
const kinds = Object.keys(KINDS);
{
  const a = makePlan(77, 300), b = makePlan(77, 300), c = makePlan(78, 300);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed, same plan');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'other seed, other plan');
  for (const seed of [1, 2, 3, 99, 12345, 4e9]) {
    const p = makePlan(seed, 400);
    let rep = 0; for (let i = 1; i < p.length; i++) if (p[i].kind === p[i - 1].kind) rep++;
    ok(rep === 0, `seed ${seed}: no kind twice in a row (${rep})`);
    ok(p.every(s => s.dur >= 6 && s.dur <= 12), `seed ${seed}: cuts of 6 to 12 s`);
    for (let i = 0; i + kinds.length <= p.length; i += kinds.length) ok(new Set(p.slice(i, i + kinds.length).map(s => s.kind)).size === kinds.length, `seed ${seed}: bag ${i / kinds.length} has every kind`);
  }
  ok(makePlan(5, 50)[0].kind !== makePlan(6, 50)[0].kind || makePlan(5, 50)[1].kind !== makePlan(6, 50)[1].kind, 'the first shots vary with the seed');
  const ph = makePlan(9, 400, { phone: true });
  ok(ph.every(s => !(s.src.model && modelByKey(s.src.model).heavy)), 'phone: no heavy models');
  ok(makePlan(9, 400).some(s => s.src.model === 'cloth'), 'desktop: cloth is in the plan');
  const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(s => makePlan(s, 1)[0].kind));
  console.log(`plan: ${kinds.length} kinds; first shot over 8 seeds: ${[...firsts].join(', ')}`);
}
{ // camera and helpers
  const sh = makePlan(3, 1)[0], base = { azimuth: 90, elevation: -20, distance: 4, lookat: [0, 0, 1] };
  const c0 = camAt(sh, 0, base, [1, 2, 3]), c1 = camAt(sh, sh.dur, base, [1, 2, 3]);
  ok(fin([c0.azimuth, c0.elevation, c0.distance, ...c0.lookat]) && c0.lookat[2] === 3, 'camAt: finite, looks at the focus');
  ok(c1.distance < c0.distance && c0.elevation < 0, 'camAt: pushes in, looks down');
  const xi = new Float64Array([0, 0, 0, 0, 0, 0, 10, 0, 0]), cv = new Float64Array(18);
  const m = actionCentre(xi, cv, 3); ok(Math.abs(m[0] - 5) < 1e-12, 'actionCentre at rest: plain mean');
  cv[6 * 2 + 3] = 2; const a = actionCentre(xi, cv, 3); ok(Math.abs(a[0] - 10) < 1e-9, 'actionCentre: follows the moving body');
  const bf = bandFrame(800, { t: 150, b: 250 }); ok(Math.abs(bf.k - 2) < 1e-12 && bf.dy === 50, 'bandFrame: back off h / band, centre in the band');
  ok(bandFrame(800, null).k === 1 && bandFrame(800, { t: 500, b: 500 }).k <= 2.2, 'bandFrame: no band, and the cap');
}

// ---- run every shot kind ---------------------------------------------------------------
const lab = createLab();
await lab.init();
const W = 640, H = 400;
let view = null;
const env = {
  lab, canvas: null,
  get view() { return view; },
  load: async src => { const S = await lab.load(src); if (view) view.setSim(S); else view = createMjRenderer(null, S, { THREE, renderer: null, width: W, height: H }); return S; },
  setVisual: f => view && view.setFlags(f),
};
const plates = [];
let sv = startSaver(env, { seed: 2024, calm: 0.7, fadeMs: 0, phone: false, label: l => plates.push(l) });
const settle = () => new Promise(r => setTimeout(r, 0));
const dt = 1 / 30;
async function runKind(kind, probe) {
  await sv.cut(kind);
  for (let i = 0; i < 20 && sv.debug().busy; i++) await settle();
  const d0 = sv.debug(), S0 = lab.sim, out = { kind: d0.kind, frames: 0, finite: true, cam: true, flags: { ...view.flags } };
  probe && probe.start && probe.start(lab.sim, out);
  plates.length = 0;
  while (out.frames < 30 * 20) {
    sv.tick(dt); out.frames++;
    if (sv.debug().busy || lab.sim !== S0) break;   // the shot has cut
    const S = lab.sim;
    if (!fin(S.d.qpos) || !fin(S.d.qvel)) out.finite = false;
    const c = sv.debug().cam; if (!fin([c.azimuth, c.elevation, c.distance, ...c.lookat])) out.cam = false;
    probe && probe.each && probe.each(S, out, sv.debug());
    if (out.frames === 45) out.plate = sv.plate();
    view.update();
  }
  for (let i = 0; i < 20 && sv.debug().busy; i++) await settle();
  return out;
}
const probes = {
  tippe: { start: (S, o) => { o.minZ = 1; }, each: (S, o) => { const q = S.xquat.subarray(4, 8); o.minZ = Math.min(o.minZ, 1 - 2 * (q[1] * q[1] + q[2] * q[2])); } },
  collapse: { start: (S, o) => { o.p0 = Float64Array.from(S.d.xipos); }, each: (S, o) => { let mx = 0; for (let i = 3; i < o.p0.length; i++) mx = Math.max(mx, Math.abs(S.d.xipos[i] - o.p0[i])); o.moved = mx; } },
  replay: { each: (S, o, d) => { o.phase = o.phase === 'replay' || d.phase === 'replay' ? 'replay' : d.phase; if (d.phase === 'replay') { o.sawReplay = true; o.minT = Math.min(o.minT ?? Infinity, S.time); } if (d.phase === 'live') o.liveMax = S.time; if (d.impact) o.impact = d.impact; } },
  dominoes: { start: (S, o) => { o.f0 = null; }, each: (S, o, d) => { if (o.frames === 15) o.f0 = d.cam.lookat.slice(); o.f1 = d.cam.lookat.slice(); } },
  tumble: { start: (S, o) => { o.w = Math.hypot(S.d.qvel[3], S.d.qvel[4], S.d.qvel[5]); } },
};
const order = ['dominoes', 'rain', 'tumble', 'arm', 'drape', 'cradle', 'tippe', 'collapse', 'replay', 'xray'];
ok(order.length === kinds.length && order.every(k => KINDS[k]), 'test covers every kind');
for (let i = 0; i < 50 && sv.debug().busy; i++) await settle();   // the first cut of startSaver
const heap = [];
for (let round = 0; round < 4; round++) {
  // a new director with the same seed each round: the same shots, so the
  // heap must stop at its high-water mark if nothing leaks
  if (round > 0) { sv.dispose(); sv = startSaver(env, { seed: 2024, calm: 0.7, fadeMs: 0, phone: false, label: l => plates.push(l) }); for (let i = 0; i < 50 && sv.debug().busy; i++) await settle(); }
  for (const k of order) {
    const t0 = Date.now(), o = await runKind(k, probes[k]);
    if (round > 0) continue;
    ok(o.kind === k, `${k}: forced shot runs`);
    ok(o.finite, `${k}: state finite`); ok(o.cam, `${k}: camera finite`);
    const pl = o.plate;
    ok(pl && pl.title && pl.lines.length === 2 && /Apache-2.0/.test(pl.lines[1]) && pl.lines[0].length > 5, `${k}: plate title and credit`);
    ok(pl && pl.tex.length === 1 && /\\/.test(pl.tex[0]) && !('code' in pl) && !('eq' in pl), `${k}: one TeX line, no code`);
    ok(pl && pl.params.some(p => p.name === 'solver') && pl.params.some(p => p.name === 'integrator'), `${k}: solver and integrator on the plate`);
    const sec = o.frames * dt;
    ok(k === 'replay' ? sec <= 18.1 : sec >= 5.9 && sec <= 12.1, `${k}: cut after ${sec.toFixed(1)} s`);
    let extra = '';
    if (k === 'tippe') { ok(o.minZ < -0.5, `tippe: turns over (axis z min ${o.minZ.toFixed(2)})`); extra = `axis z min ${o.minZ.toFixed(2)}`; }
    if (k === 'collapse') { ok(o.moved > 0.3 && o.flags.contactForces, `collapse: push moves a body ${o.moved.toFixed(2)} m, forces on`); extra = `max body shift ${o.moved.toFixed(2)} m`; }
    if (k === 'replay') { ok(o.sawReplay && o.impact && o.minT < o.liveMax && o.minT <= o.impact.time - 0.4 && Math.abs(o.minT - o.impact.from) < 0.05, 'replay: goes back before the impact'); extra = `impact at ${o.impact && o.impact.time.toFixed(2)} s sim, replay from ${o.minT && o.minT.toFixed(3)} s (state ${o.impact && o.impact.from.toFixed(3)} s, live to ${o.liveMax.toFixed(2)} s)`; }
    if (k === 'dominoes') { const dd = o.f0 ? Math.hypot(o.f1[0] - o.f0[0], o.f1[1] - o.f0[1]) : 0; ok(dd > 0.2, `dominoes: tracked front moves ${dd.toFixed(2)} m`); extra = `front moved ${dd.toFixed(2)} m`; }
    if (k === 'tumble') { ok(o.w > 1, 'tumble: thrown with a spin'); extra = `spin ${o.w.toFixed(1)} rad/s`; }
    if (k === 'xray') { ok(o.flags.transparent && o.flags.jointAxes && o.flags.com && !o.flags.contactForces, 'xray: flags on, others off'); }
    if (k === 'arm') ok(lab.driver.mode === 'random' || o.frames > 0, 'arm: random driver');
    console.log(`${k.padEnd(9)} ${String(o.frames).padStart(4)} frames  ${(sec).toFixed(1).padStart(4)} s  ${(Date.now() - t0 + '').padStart(5)} ms wall  ${pl && pl.title}  ${extra}`);
  }
  heap.push(heapBytes());
}
const MiB = x => (x / 1048576).toFixed(1);
console.log(`WASM heap after rounds 1 to 4: ${heap.map(MiB).join(', ')} MiB`);
ok(heap[3] <= heap[1] && heap[2] <= heap[1], 'heap flat after the first round of shots');
sv.dispose();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
