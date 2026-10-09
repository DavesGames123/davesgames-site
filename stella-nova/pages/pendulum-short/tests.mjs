// ============================================================================
//  PENDULUM TESTS  ·  node stella-nova/pages/pendulum-short/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  200 seeds (with the guard) x 600 frames: finite, in the box
//  links          every link keeps its length (upstream PBD correction)
//  energy         one link keeps its energy; the triple's PBD error falls
//                 with more substeps (first order)
//  chaos fan      copies a hair apart end far apart; one seed repeats
//  guard          links x copies x substeps stays within the frame budget
//  hash, saver plan, page boot with saver cuts (sim kit DOM stub)
// ============================================================================
import * as SM from './sim.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SM.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SM.guard }).state, over);
function run(st, seed, frames) { const S = SM.createSim(); SM.buildScene(S, st, SM.sceneRng(seed)); for (let f = 0; f < frames; f++) SM.step(S, 1 / 60); return S; }

{
  const bad = [];
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s * 7907); const S = run(st, s, 600); const h = SM.health(S); if (h.bad || h.out) bad.push(`seed ${s}: bad ${h.bad} out ${h.out}`); }
  ok(!bad.length, 'random scenes: 200 seeds x 600 frames, finite and in the box', bad.slice(0, 3).join('; '));
}
{
  const S = run(sceneOf(3, { links: 6, copies: 1, driveA: 0 }), 3, 600); let mx = 0;
  for (const ch of S.chains) for (let i = 1; i < ch.x.length; i++) mx = Math.max(mx, Math.abs(Math.hypot(ch.x[i] - ch.x[i - 1], ch.y[i] - ch.y[i - 1]) - ch.L[i]) / ch.L[i]);
  ok(mx < 2e-3, 'links: every link keeps its length within 0.2 %', `max ${(mx * 100).toFixed(3)} %`);
}
{
  // PBD loses a little energy per substep (first order in the substep).
  // One link: under 5 % in 10 s (about (v dt / L)^2 per substep). The upstream triple start (a folded,
  // whipping chain): the error halves or better when the substeps go x4.
  const errOf = (links, start, sub) => {
    const st = Object.assign(K.defaults(SCHEMA), { links, massMode: 'upstream', start, copies: 1, damp: 0, driveA: 0, sub, timeScale: 1, lenVar: 0 });
    const S = SM.createSim(); SM.buildScene(S, st, SM.sceneRng(1));
    const E0 = SM.energy(S); let mx = 0;
    for (let f = 0; f < 600; f++) { SM.step(S, 1 / 60); mx = Math.max(mx, Math.abs(SM.energy(S) - E0)); }
    return mx / (1.8 * st.g * st.length);
  };
  const one = errOf(1, 'side', 100), a = errOf(3, 'upstream', 100), b = errOf(3, 'upstream', 400);
  ok(one < 0.05 && b < 0.5 * a, 'energy: one link loses under 5 % in 10 s; the triple error falls with more substeps', `one link ${(100 * one).toFixed(2)} %, triple ${(100 * a).toFixed(1)} % at 100, ${(100 * b).toFixed(1)} % at 400 substeps`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { links: 3, start: 'up', copies: 6, delta: -5, damp: 0, driveA: 0 });
  const S = run(st, 2, 1200), a = S.chains[0], b = S.chains[5], n = a.x.length - 1;
  const sep = Math.hypot(a.x[n] - b.x[n], a.y[n] - b.y[n]);
  const S2 = run(st, 2, 1200), same = S2.chains[0].x[n] === a.x[n];
  ok(sep > 0.05 && same, 'chaos fan: copies 1e-5 rad apart end far apart, and one seed repeats', `separation ${sep.toFixed(3)} m`);
}
{
  let over = 0; for (let s = 1; s <= 500; s++) { const st = sceneOf(s); if (st.links * st.copies * st.sub > 4000) over++; }
  ok(over === 0, 'guard: links x copies x substeps stays within 4000 per frame', `${over} over`);
}
{
  let bad = 0; for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++; }
  ok(bad === 0, 'hash: 200 random scenes round-trip through the share link', `${bad} bad`);
  const plan = K.planShots(Array.from({ length: 7 }, (_, i) => ({ key: 's' + i })), 5, 200);
  ok(plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), 'saver plan: 7 shots, no repeats, 6-12 s cuts');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Pendulum in 100 Lines by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const C = window.__pend;
  runRaf(40);
  ok(C.kit.playing && C.S.chains.length > 0 && C.S.t > 0.1, 'page: boots, builds a random scene and autoplays', `${C.S.chains.length} copies, seed ${C.kit.seed}`);
  const seed0 = C.kit.seed; C.kit.newScene(); runRaf(2);
  ok(C.kit.seed !== seed0 && C.S.t < 0.1, 'page: a new scene rebuilds the sim');
  ok(view._c.bad === 0 && view._c.calls > 100, 'page: finite canvas calls while running', `${view._c.calls} calls`);
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 12; k++) { window.snSaver.cut(); runRaf(20); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 13 && rep === 0 && !SM.health(C.S).bad && labels.every(L => L.tex && !('code' in L)), 'page saver: 13 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && view._c.bad === 0, 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
