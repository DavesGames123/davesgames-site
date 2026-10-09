// ============================================================================
//  CANNONBALL 2D TESTS  ·  node stella-nova/pages/cannonball-2d/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  200 seeds of the page randomizer (with its guard) run
//                 900 frames each: no NaN, nothing leaves the box
//  upstream       one ball, e = 1, no drag: the energy error of the
//                 upstream step stays bounded (below 10 %, no growth)
//  bounce         e < 1: each bounce apex is about e² of the last
//  guard          an arc never goes over the box when there is no ceiling
//  determinism    one seed, one scene, one result
//  hash           every control round-trips through the share link
//  saver plan     shots, no back-to-back repeats, 6-12 s cuts
//  page           main.js boots under the DOM stub, autoplays, rebuilds on
//                 a new scene, and runs saver cuts with TeX and no code
// ============================================================================
import * as SM from './sim.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SM.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SM.guard }).state, over);
function run(st, seed, frames) { const S = SM.createSim(160); SM.buildScene(S, st, SM.sceneRng(seed)); for (let f = 0; f < frames; f++) SM.step(S, 1 / 60); return S; }

{
  const bad = []; let balls = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s * 104729); const S = run(st, s, 900); const h = SM.health(S); balls += S.n; if (h.bad || h.out) bad.push(`seed ${s}: bad ${h.bad} out ${h.out}`); }
  ok(!bad.length, 'random scenes: 200 seeds x 900 frames, no NaN, nothing leaves the box', bad.length ? bad.slice(0, 3).join('; ') : `${balls} balls`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { rate: 0, e: 1, drag: 0, wind: 0, mu: 0, pegs: 'none', collide: false, sub: 1 });
  const S = SM.createSim(4); SM.buildScene(S, st, SM.sceneRng(1));
  SM.addBall(S, 3, 6, 0, 0, 0.2);
  const E = () => 0.5 * (S.vx[0] ** 2 + S.vy[0] ** 2) + st.g * S.y[0];
  const E0 = E(); let mx = 0, early = 0, late = 0;
  for (let f = 0; f < 3600; f++) { SM.step(S, 1 / 60); const d = Math.abs(E() - E0) / E0; mx = Math.max(mx, d); if (f < 600) early = Math.max(early, d); if (f >= 3000) late = Math.max(late, d); }
  ok(mx < 0.1 && late < early + 0.02, 'upstream: one ball with e = 1: the Euler step keeps the energy bounded, no growth over 60 s', `max ${(mx * 100).toFixed(2)} %, first 10 s ${(early * 100).toFixed(2)} %, last 10 s ${(late * 100).toFixed(2)} %`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { rate: 0, e: 0.8, drag: 0, wind: 0, mu: 0, pegs: 'none', collide: false, sub: 4 });
  const S = SM.createSim(4); SM.buildScene(S, st, SM.sceneRng(1));
  SM.addBall(S, 3, 8, 0, 0, 0.2);
  const apex = []; let up = false, top = 0;
  for (let f = 0; f < 1500; f++) { SM.step(S, 1 / 240); if (S.vy[0] > 0) { up = true; top = Math.max(top, S.y[0]); } else if (up) { apex.push(top - 0.2); up = false; top = 0; } }
  const ratios = apex.slice(0, 3).map((a, i) => (i ? a / apex[i - 1] : (a / 7.8)));
  ok(apex.length >= 3 && ratios.every(q => Math.abs(q - 0.64) < 0.06), 'bounce: each apex is about e² = 0.64 of the last', ratios.map(q => q.toFixed(3)).join(' '));
}
{
  let over = 0;
  for (let s = 1; s <= 500; s++) { const st = sceneOf(s); if (st.ceiling) continue; const vy = st.speed * Math.sin(st.angle * Math.PI / 180); if (vy * vy / (2 * st.g) > SM.H) over++; }
  ok(over === 0, 'guard: with no ceiling, no random arc rises over the box', `${over} over`);
}
{
  const st = sceneOf(4242), a = run(st, 7, 300), b = run(st, 7, 300);
  let same = a.n === b.n; for (let i = 0; i < a.n && same; i++) if (a.x[i] !== b.x[i] || a.y[i] !== b.y[i]) same = false;
  ok(same, 'determinism: one seed gives the same balls after 300 frames', `${a.n} balls`);
}
{
  let bad = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++; }
  ok(bad === 0, 'hash: 200 random scenes round-trip through the share link');
}
{
  const plan = K.planShots(Array.from({ length: 7 }, (_, i) => ({ key: 's' + i })), 5, 200);
  ok(plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), 'saver plan: 7 shots, no repeats, 6-12 s cuts');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Cannonball 2D by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const C = window.__cb2;
  runRaf(40);
  ok(C.kit.playing && C.S.n > 0 && C.S.t > 0.3, 'page: boots, builds a random scene and autoplays', `${C.S.n} balls, t ${C.S.t.toFixed(2)} s, seed ${C.kit.seed}`);
  const seed0 = C.kit.seed; C.kit.newScene(); runRaf(3);
  ok(C.kit.seed !== seed0 && C.S.t < 0.2, 'page: a new scene rebuilds the sim');
  ok(view._c.bad === 0 && view._c.calls > 100, 'page: finite canvas calls while running', `${view._c.calls} calls`);
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 12; k++) { window.snSaver.cut(); runRaf(20); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  const h = SM.health(C.S);
  ok(hist.length === 13 && rep === 0 && !h.bad && labels.every(L => L.tex && !('code' in L)), 'page saver: 13 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && view._c.bad === 0, 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
