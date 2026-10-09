// ============================================================================
//  BILLIARD TESTS  ·  node stella-nova/pages/billiard/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  200 seeds (with the guard) x 300 frames: finite, in the box
//  energy         e = 1, no friction, no gravity: kinetic energy constant
//  head-on        two equal balls, e = 1: the speeds swap (upstream rule)
//  gas            equal balls relax to 2D Maxwell-Boltzmann:
//                 <v> / sqrt(<v^2>) -> sqrt(pi)/2 = 0.886
//  mixing         after the divider lifts, each half holds both colours
//  pockets        a break on the pool table pots balls
//  guard, hash, saver plan, page boot with saver cuts (sim kit DOM stub)
// ============================================================================
import * as SM from './sim.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SM.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SM.guard }).state, over);
const make = (st, seed) => { const S = SM.createSim(420); SM.buildScene(S, st, SM.sceneRng(seed)); return S; };
const base = over => Object.assign(K.defaults(SCHEMA), { e: 1, eWall: 1, roll: 0, g: 0, bumpers: 0, trail: 0, sub: 4 }, over);

{
  const bad = []; let balls = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s * 29); const S = make(st, s); for (let f = 0; f < 300; f++) SM.step(S, 1 / 60); const h = SM.health(S); balls += S.n; if (h.bad || h.out) bad.push(`seed ${s} ${st.layout}/${st.table}: bad ${h.bad} out ${h.out}`); }
  ok(!bad.length, 'random scenes: 200 seeds x 300 frames, finite, in the box', bad.length ? bad.slice(0, 3).join('; ') : `${balls} balls`);
}
{
  const S = make(base({ layout: 'random', table: 'box', count: 60, rMin: 0.04, rMax: 0.08, speed: 2 }), 3);
  const E0 = SM.kinetic(S); for (let f = 0; f < 600; f++) SM.step(S, 1 / 60);
  const rel = Math.abs(SM.kinetic(S) - E0) / E0;
  ok(rel < 1e-9, 'energy: e = 1, no friction: kinetic energy stays constant over 10 s', `relative change ${rel.toExponential(2)}`);
}
{
  const S = make(base({ layout: 'random', table: 'box', count: 2, rMin: 0.05, rMax: 0.05, speed: 0 }), 1);
  S.x[0] = 0.8; S.y[0] = 0.65; S.vx[0] = 1; S.vy[0] = 0; S.x[1] = 1.2; S.y[1] = 0.65; S.vx[1] = 0; S.vy[1] = 0;
  const p0 = SM.momentum(S)[0]; for (let f = 0; f < 30; f++) SM.step(S, 1 / 60);
  ok(Math.abs(S.vx[0]) < 1e-9 && Math.abs(S.vx[1] - 1) < 1e-9 && Math.abs(SM.momentum(S)[0] - p0) < 1e-12, 'head-on: equal balls with e = 1 swap speeds, momentum kept', `v ${S.vx[0].toFixed(6)}, ${S.vx[1].toFixed(6)}`);
}
{
  const S = make(base({ layout: 'gas', table: 'box', count: 300, rMin: 0.02, rMax: 0.02, speed: 2 }), 8);
  let ratio = 0, k = 0;
  for (let f = 0; f < 1200; f++) { SM.step(S, 1 / 60); if (f >= 600 && f % 20 === 0) { let a = 0, b = 0; for (let i = 0; i < S.n; i++) { const v = Math.hypot(S.vx[i], S.vy[i]); a += v; b += v * v; } ratio += (a / S.n) / Math.sqrt(b / S.n); k++; } }
  ratio /= k;
  ok(Math.abs(ratio - Math.sqrt(Math.PI) / 2) < 0.02, 'gas: equal balls relax to 2D Maxwell-Boltzmann, <v>/sqrt(<v^2>) = 0.886', `measured ${ratio.toFixed(4)}`);
}
{
  const S = make(base({ layout: 'mixing', table: 'box', count: 200, rMin: 0.018, rMax: 0.024, speed: 1.6 }), 5);
  let before = 0; for (let i = 0; i < S.n; i++) if ((S.x[i] > SM.W / 2) !== !!S.side[i]) before++;
  for (let f = 0; f < 1800; f++) SM.step(S, 1 / 60);
  let crossed = 0; for (let i = 0; i < S.n; i++) if ((S.x[i] > SM.W / 2) !== !!S.side[i]) crossed++;
  ok(before === 0 && crossed > 0.3 * S.n, 'mixing: after the divider lifts, the colours spread over both halves', `${crossed} of ${S.n} on the other side after 30 s`);
}
{
  let potted = 0; for (let s = 1; s <= 10; s++) { const S = make(base({ layout: 'break', table: 'pool', count: 16, rMin: 0.035, rMax: 0.035, e: 0.95, eWall: 0.85, roll: 0.15 }), s); for (let f = 0; f < 900; f++) SM.step(S, 1 / 60); potted += S.potted; }
  ok(potted > 0, 'pockets: ten breaks on the pool table pot balls', `${potted} potted`);
}
{
  let bad = 0; for (let s = 1; s <= 300; s++) { const st = sceneOf(s); const area = st.table === 'round' ? Math.PI * 0.36 : (SM.W - 0.2) * (SM.H - 0.2); if (st.count * Math.PI * ((st.rMin + st.rMax) / 2) ** 2 > 0.41 * area || st.rMax < st.rMin) bad++; }
  ok(bad === 0, 'guard: the balls cover at most 40 % of the table', `${bad} over`);
  let hb = 0; for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) hb++; }
  ok(hb === 0, 'hash: 200 random scenes round-trip through the share link', `${hb} bad`);
  const plan = K.planShots(Array.from({ length: 7 }, (_, i) => ({ key: 's' + i })), 5, 200);
  ok(plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), 'saver plan: 7 shots, no repeats, 6-12 s cuts');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Billiard by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const C = window.__bil;
  runRaf(30);
  ok(C.kit.playing && C.S.n > 0 && C.S.t > 0.3, 'page: boots, builds a random scene and autoplays', `${C.S.n} balls, seed ${C.kit.seed}`);
  const seed0 = C.kit.seed; C.kit.newScene(); runRaf(2);
  ok(C.kit.seed !== seed0 && C.S.t < 0.1, 'page: a new scene rebuilds the sim');
  C.kit.set('hist', true); runRaf(5);
  ok(view._c.bad === 0 && view._c.calls > 100, 'page: finite canvas calls while running (with the histogram)', `${view._c.calls} calls`);
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 12; k++) { window.snSaver.cut(); runRaf(10); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 13 && rep === 0 && !SM.health(C.S).bad && labels.every(L => L.tex && !('code' in L)), 'page saver: 13 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && view._c.bad === 0, 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
