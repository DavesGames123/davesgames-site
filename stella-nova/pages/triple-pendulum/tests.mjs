// ============================================================================
//  TRIPLE PENDULUM TESTS  ·  node stella-nova/pages/triple-pendulum/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  200 seeds (with the guard) x 300 frames at 100 substeps:
//                 finite and in the box
//  agreement      upstream claim: with 10 000 substeps PBD and the
//                 analytic solution agree at first (end bob within 1 mm
//                 after 0.5 s of sim time, equal preset, upstream start)
//  analytic       the analytic equations keep the energy (small dt)
//  links          PBD keeps every link length
//  butterfly      a copy 1e-6 rad apart ends far apart
//  guard          presets force their own link count
//  hash, saver plan, page boot with saver cuts (sim kit DOM stub)
// ============================================================================
import * as SM from './sim.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SM.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SM.guard }).state, over);
function make(st, seed) { const S = SM.createSim(); SM.buildScene(S, st, SM.sceneRng(seed)); return S; }

{
  const bad = [];
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s * 31, { subIdx: '3' }); const S = make(st, s); for (let f = 0; f < 300; f++) SM.step(S, 1 / 60); const h = SM.health(S); if (h.bad || h.out) bad.push(`seed ${s}: bad ${h.bad} out ${h.out}`); }
  ok(!bad.length, 'random scenes: 200 seeds x 300 frames at 100 substeps, finite and in the box', bad.slice(0, 3).join('; '));
}
{
  const st = Object.assign(K.defaults(SCHEMA), { preset: 'equal', start: 'upstream', twin: false, analytic: true, subIdx: '5', timeScale: 0.6 });
  const S = make(st, 1), [a, b] = S.list;
  const frames = Math.round(0.5 / 0.01); for (let f = 0; f < frames; f++) SM.step(S, 1 / 60);
  const d = Math.hypot(a.x[3] - b.x[3], a.y[3] - b.y[3]);
  ok(d < 1e-3, 'agreement: with 10 000 substeps PBD and the analytic solution agree for the first 0.5 s', `end bob ${(d * 1000).toFixed(3)} mm apart`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { preset: 'equal', start: 'side', twin: false, analytic: true, subIdx: '4', timeScale: 0.6 });
  const S = make(st, 1), p = S.list[1];
  for (let f = 0; f < 2; f++) SM.step(S, 1 / 60);
  const E0 = SM.energy(S, p); let mx = 0;
  for (let f = 0; f < 300; f++) { SM.step(S, 1 / 60); mx = Math.max(mx, Math.abs(SM.energy(S, p) - E0)); }
  const scale = 3 * st.g * 0.45;
  ok(mx / scale < 0.01, 'analytic: the Lagrange equations keep the energy (1000 substeps, 3 s)', `max error ${(100 * mx / scale).toFixed(3)} % of m g L`);
}
{
  const S = make(sceneOf(5, { preset: 'five', subIdx: '3' }), 5); for (let f = 0; f < 300; f++) SM.step(S, 1 / 60);
  const p = S.list[0]; let mx = 0;
  for (let i = 1; i < p.x.length; i++) mx = Math.max(mx, Math.abs(Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]) - p.L[i]) / p.L[i]);
  ok(mx < 2e-3, 'links: PBD keeps every link length', `max ${(mx * 100).toFixed(4)} %`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { preset: 'equal', start: 'up', twin: true, delta: -6, analytic: false, subIdx: '3' });
  const S = make(st, 2); for (let f = 0; f < 900; f++) SM.step(S, 1 / 60);
  const a = S.list[0], b = S.list.find(p => p.kind === 'twin'), d = Math.hypot(a.x[3] - b.x[3], a.y[3] - b.y[3]);
  ok(d > 0.05, 'butterfly: a copy 1e-6 rad apart ends far apart after 15 s', `${d.toFixed(3)} m`);
}
{
  let bad = 0; for (let s = 1; s <= 300; s++) { const st = sceneOf(s); if (st.preset !== 'random' && st.links !== SM.PRESETS[st.preset].L.length) bad++; }
  ok(bad === 0, 'guard: a preset sets its own link count');
  let hb = 0; for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) hb++; }
  ok(hb === 0, 'hash: 200 random scenes round-trip through the share link', `${hb} bad`);
  const plan = K.planShots(Array.from({ length: 6 }, (_, i) => ({ key: 's' + i })), 5, 200);
  ok(plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), 'saver plan: 6 shots, no repeats, 6-12 s cuts');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Triple Pendulum by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const C = window.__tri;
  C.kit.set('subIdx', '3');
  runRaf(30);
  ok(C.kit.playing && C.S.list.length > 0 && C.S.t > 0.1, 'page: boots, builds a random scene and autoplays', `${C.S.list.length} pendulums, seed ${C.kit.seed}`);
  const seed0 = C.kit.seed; C.kit.newScene(); runRaf(2);
  ok(C.kit.seed !== seed0 && C.S.t < 0.1, 'page: a new scene rebuilds the sim');
  ok(view._c.bad === 0 && view._c.calls > 100, 'page: finite canvas calls while running', `${view._c.calls} calls`);
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 12; k++) { window.snSaver.cut(); runRaf(4); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 13 && rep === 0 && !SM.health(C.S).bad && labels.every(L => L.tex && !('code' in L)), 'page saver: 13 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && view._c.bad === 0, 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
