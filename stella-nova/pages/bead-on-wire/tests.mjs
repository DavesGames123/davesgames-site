// ============================================================================
//  BEAD ON A WIRE TESTS  ·  node stella-nova/pages/bead-on-wire/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  200 seeds (with the guard) x 300 frames at 200 substeps:
//                 finite, in the box, every bead on its wire
//  upstream       circle, 1000 substeps: the PBD bead follows the analytic
//                 bead (within 2 cm over 2 s) and the forces agree (5 %)
//  loop           a start speed above 2 sqrt(gR) carries the bead over
//                 the top; below sqrt(2gR) it never passes the side
//  one step       with one substep per frame the PBD bead loses energy
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
const base = over => Object.assign(K.defaults(SCHEMA), { shape: 'circle', beads: 1, v0: 0, analytic: true, tilt: 0, friction: 0, g: 10, timeScale: 1, sub: '1000' }, over);

{
  const bad = []; let maxOff = 0;
  for (let s = 1; s <= 200; s++) {
    const st = sceneOf(s * 13, { sub: '200' }); const S = make(st, s);
    for (let f = 0; f < 300; f++) SM.step(S, 1 / 60);
    const h = SM.health(S); for (const b of S.beads) maxOff = Math.max(maxOff, SM.distToWire(S, b.x, b.y));
    if (h.bad || h.out) bad.push(`seed ${s} ${st.shape}: bad ${h.bad} out ${h.out}`);
  }
  ok(!bad.length && maxOff < 1e-3, 'random scenes: 200 seeds x 300 frames, finite, in the box, on the wire', bad.length ? bad.slice(0, 3).join('; ') : `max distance to the wire ${(maxOff * 1000).toFixed(3)} mm`);
}
{
  const S = make(base({ start: 90 }), 1); let dmax = 0, fmax = 0;
  for (let f = 0; f < 120; f++) { SM.step(S, 1 / 60); const b = S.beads[0], a = S.twins[0]; dmax = Math.max(dmax, Math.hypot(b.x - a.x, b.y - a.y)); if (Math.abs(a.force) > 1) fmax = Math.max(fmax, Math.abs(b.force - Math.abs(a.force)) / Math.abs(a.force)); }
  ok(dmax < 0.02 && fmax < 0.05, 'upstream: on the circle the PBD bead follows the analytic bead, forces agree', `max gap ${(dmax * 1000).toFixed(2)} mm, force ${(fmax * 100).toFixed(2)} %`);
}
{
  const R = 0.8, g = 10, over = (v0) => { const S = make(base({ start: 0, v0, size: R, analytic: false }), 1); let top = -9; for (let f = 0; f < 120; f++) { SM.step(S, 1 / 60); top = Math.max(top, S.beads[0].y - S.C.cy); } return top; };
  const fast = over(2 * Math.sqrt(g * R) + 0.3), slow = over(Math.sqrt(2 * g * R) - 0.3);
  ok(fast > 0.99 * R && slow < 0.01, 'loop: above 2 sqrt(gR) the bead goes over the top; below sqrt(2gR) it stays under the side', `top ${fast.toFixed(3)} m vs ${slow.toFixed(3)} m`);
}
{
  const E = S => { const b = S.beads[0]; return 0.5 * (b.vx ** 2 + b.vy ** 2) + 10 * (b.y - S.C.cy); };
  const a = make(base({ start: 90, sub: '1', analytic: false }), 1), b = make(base({ start: 90, sub: '1000', analytic: false }), 1);
  const ea = E(a), eb = E(b); for (let f = 0; f < 300; f++) { SM.step(a, 1 / 60); SM.step(b, 1 / 60); }
  const la = ea - E(a), lb = eb - E(b);
  ok(la > 5 * Math.abs(lb) && la > 0.2, 'one step: one substep per frame loses far more energy than 1000', `loss ${la.toFixed(3)} vs ${lb.toFixed(4)} J/kg`);
}
{
  let bad = 0; for (let s = 1; s <= 300; s++) { const st = sceneOf(s); if ((st.shape === 'circle' && st.aspect !== 1) || (st.shape === 'wave' && st.v0 > 5)) bad++; }
  ok(bad === 0, 'guard: a circle keeps aspect 1; the wave track starts slower');
  let hb = 0; for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) hb++; }
  ok(hb === 0, 'hash: 200 random scenes round-trip through the share link', `${hb} bad`);
  const plan = K.planShots(Array.from({ length: 6 }, (_, i) => ({ key: 's' + i })), 5, 200);
  ok(plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), 'saver plan: 6 shots, no repeats, 6-12 s cuts');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Bead on a Wire by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const C = window.__bead;
  runRaf(30);
  ok(C.kit.playing && C.S.beads.length > 0 && C.S.t > 0.1, 'page: boots, builds a random scene and autoplays', `${C.S.beads.length} beads, ${C.S.C.type}, seed ${C.kit.seed}`);
  const seed0 = C.kit.seed; C.kit.newScene(); runRaf(2);
  ok(C.kit.seed !== seed0 && C.S.t < 0.1, 'page: a new scene rebuilds the sim');
  ok(view._c.bad === 0 && view._c.calls > 100, 'page: finite canvas calls while running', `${view._c.calls} calls`);
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 12; k++) { window.snSaver.cut(); runRaf(6); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 13 && rep === 0 && !SM.health(C.S).bad && labels.every(L => L.tex && !('code' in L)), 'page saver: 13 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && view._c.bad === 0, 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
