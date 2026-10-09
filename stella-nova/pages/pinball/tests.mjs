// ============================================================================
//  PINBALL TESTS  ·  node stella-nova/pages/pinball/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  200 seeds (with the guard) x 900 frames: finite, every
//                 ball in the table (closed tables)
//  bumper         upstream rule: after a hit the normal speed equals the push
//  flipper        a ball resting on a raised flipper goes up when it flips
//  autopilot      with an open drain, the autopilot loses fewer balls than
//                 still flippers over 60 s, and it scores
//  guard, hash, saver plan, page boot with saver cuts (sim kit DOM stub)
// ============================================================================
import * as SM from './sim.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SM.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SM.guard }).state, over);
const make = (st, seed) => { const S = SM.createSim(); SM.buildScene(S, st, SM.sceneRng(seed)); return S; };

{
  const bad = []; let balls = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s * 37, { drain: false }); const S = make(st, s); for (let f = 0; f < 900; f++) SM.step(S, 1 / 60); const h = SM.health(S); balls += S.balls.length; if (h.bad || h.out) bad.push(`seed ${s} ${st.layout}: bad ${h.bad} out ${h.out}`); }
  ok(!bad.length, 'random scenes: 200 seeds x 900 frames, finite, every ball in the table', bad.length ? bad.slice(0, 3).join('; ') : `${balls} balls`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { layout: 'upstream', balls: 1, auto: false, push: 2, g: 3, sub: 4 });
  const S = make(st, 1), o = S.obstacles[0], b = S.balls[0];
  b.x = o.x; b.y = o.y + o.r + b.r + 0.05; b.vx = 0; b.vy = -1.5;
  let after = null;
  for (let f = 0; f < 60 && !after; f++) { SM.step(S, 1 / 60); if (o.hit) { const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy); after = (b.vx * dx + b.vy * dy) / d; } }
  ok(after !== null && Math.abs(after - 2) < 0.15, 'bumper: after a hit the normal speed is the push velocity', `normal speed ${after && after.toFixed(3)} m/s (push 2)`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { layout: 'upstream', balls: 1, auto: false, g: 3, flipW: 10, sub: 4 });
  const S = make(st, 1), f = S.flippers[0], b = S.balls[0];
  const [tx, ty] = SM.flipperTip(f);
  b.x = f.x + 0.6 * (tx - f.x); b.y = f.y + 0.6 * (ty - f.y) + f.r + b.r + 0.002; b.vx = 0; b.vy = 0;
  for (let k = 0; k < 10; k++) SM.step(S, 1 / 60);
  S.keys[0] = true; S.manualT = 4;
  let top = b.y; for (let k = 0; k < 40; k++) { SM.step(S, 1 / 60); top = Math.max(top, b.y); }
  ok(top > f.y + 0.4, 'flipper: a ball on the flipper goes up the table when it flips', `rose to ${top.toFixed(2)} m (pivot ${f.y} m)`);
}
{
  const lostOf = auto => { let lost = 0, score = 0; for (let s = 1; s <= 6; s++) { const S = make(Object.assign(K.defaults(SCHEMA), { layout: 'upstream', balls: 2, auto, drain: true, sub: 4 }), s); for (let f = 0; f < 3600; f++) SM.step(S, 1 / 60); lost += S.lost; score += S.score; } return [lost, score]; };
  const [la, sa] = lostOf(true), [ln] = lostOf(false);
  ok(la < ln && sa > 0, 'autopilot: with an open drain it loses fewer balls than still flippers, and scores', `lost ${la} vs ${ln} in 6 x 60 s, score ${sa}`);
}
{
  let bad = 0; for (let s = 1; s <= 300; s++) { const st = sceneOf(s); if ((st.push > 2.8 && st.g < 2.6) || (st.balls > 5 && st.layout === 'pachinko')) bad++; }
  ok(bad === 0, 'guard: no strong push in a flat table; pachinko keeps five balls at most');
  let hb = 0; for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) hb++; }
  ok(hb === 0, 'hash: 200 random scenes round-trip through the share link', `${hb} bad`);
  const plan = K.planShots(Array.from({ length: 6 }, (_, i) => ({ key: 's' + i })), 5, 200);
  ok(plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), 'saver plan: 6 shots, no repeats, 6-12 s cuts');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Pinball by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const C = window.__pin;
  runRaf(30);
  ok(C.kit.playing && C.S.balls.length > 0 && C.S.t > 0.3, 'page: boots, builds a random table and autoplays', `${C.S.balls.length} balls, ${C.kit.state.layout}, seed ${C.kit.seed}`);
  const seed0 = C.kit.seed; C.kit.newScene(); runRaf(2);
  ok(C.kit.seed !== seed0 && C.S.t < 0.1, 'page: a new scene rebuilds the table');
  ok(view._c.bad === 0 && view._c.calls > 100, 'page: finite canvas calls while running', `${view._c.calls} calls`);
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
