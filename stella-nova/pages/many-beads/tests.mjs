// ============================================================================
//  MANY BEADS TESTS  ·  node stella-nova/pages/many-beads/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  200 seeds (with the guard) x 300 frames: finite, every
//                 bead on its wire, no deep overlaps
//  cradle         equal beads, e = 1: the struck row passes the swing to
//                 the last bead, the first one nearly stops
//  restitution    two equal beads: e = 1 swaps the speeds, e = 0 halves them
//  guard          the beads of a wire always fit on it
//  hash, saver plan, page boot with saver cuts (sim kit DOM stub)
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
  const bad = []; let beads = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s * 17, { sub: 50 }); const S = make(st, s); for (let f = 0; f < 300; f++) SM.step(S, 1 / 60); const h = SM.health(S); beads += S.b.length; if (h.bad || h.out || h.overlap) bad.push(`seed ${s}: bad ${h.bad} out ${h.out} overlap ${h.overlap}`); }
  ok(!bad.length, 'random scenes: 200 seeds x 300 frames, finite, on the wires, no deep overlaps', bad.length ? bad.slice(0, 3).join('; ') : `${beads} beads`);
}
{
  const st = Object.assign(K.defaults(SCHEMA), { rings: 1, count: 5, start: 'cradle', massRule: 'equal', e: 1, friction: 0, tilt: 0, turn: 0, rMin: 0.08, rMax: 0.08, sub: 100 });
  const S = make(st, 1); let hitT = -1;
  const sp = b => Math.hypot(b.vx, b.vy);
  // run until the first impact, then a little after it
  for (let f = 0; f < 120; f++) { SM.step(S, 1 / 60); if (hitT < 0 && S.hits > 0) hitT = f; if (hitT >= 0 && f > hitT + 4) break; }
  const first = sp(S.b[0]), last = sp(S.b[S.b.length - 1]), mid = sp(S.b[2]);
  ok(hitT >= 0 && last > 1 && first < 0.25 * last && mid < 0.25 * last, "cradle: the swing passes along the row to the last bead", `first ${first.toFixed(2)}, middle ${mid.toFixed(2)}, last ${last.toFixed(2)} m/s`);
}
{
  // Two equal beads, no gravity, one moving into the other: e = 1 swaps
  // the speeds; e = 0 leaves both at half the speed (upstream formula).
  const after = e => {
    const st = Object.assign(K.defaults(SCHEMA), { rings: 1, count: 2, start: 'random', massRule: 'equal', e, friction: 0, g: 1, tilt: 0, turn: 0, rMin: 0.05, rMax: 0.05, sub: 100 });
    const S = make(st, 1); S.P.g = 0;
    const R = S.wires[0], [cx, cy] = SM.CENTER, a0 = -Math.PI / 2, a1 = a0 + 0.4;
    const put = (b, a, v) => { b.x = cx + R * Math.cos(a); b.y = cy + R * Math.sin(a); b.vx = -Math.sin(a) * v; b.vy = Math.cos(a) * v; };
    put(S.b[0], a0, 2); put(S.b[1], a1, 0);
    for (let f = 0; f < 30; f++) SM.step(S, 1 / 60);
    return S.b.map(b => Math.hypot(b.vx, b.vy));
  };
  const [a1, b1] = after(1), [a0, b0] = after(0);
  ok(a1 < 0.05 && Math.abs(b1 - 2) < 0.1 && Math.abs(a0 - 1) < 0.1 && Math.abs(b0 - 1) < 0.1, 'restitution: e = 1 swaps the speeds of equal beads; e = 0 leaves both at half', `e=1: ${a1.toFixed(3)}, ${b1.toFixed(3)}; e=0: ${a0.toFixed(3)}, ${b0.toFixed(3)} m/s`);
}
{
  let bad = 0; for (let s = 1; s <= 300; s++) { const st = sceneOf(s); const R = 0.82 * (st.rings === 3 ? 0.38 : st.rings === 2 ? 0.55 : 1); if (st.count * (st.rMin + st.rMax) > 2 * Math.PI * R * 0.7 + 0.02) bad++; }
  ok(bad === 0, 'guard: the beads of every wire fit on it', `${bad} too full`);
  let hb = 0; for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) hb++; }
  ok(hb === 0, 'hash: 200 random scenes round-trip through the share link', `${hb} bad`);
  const plan = K.planShots(Array.from({ length: 6 }, (_, i) => ({ key: 's' + i })), 5, 200);
  ok(plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), 'saver plan: 6 shots, no repeats, 6-12 s cuts');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Many Beads by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const C = window.__beads;
  runRaf(30);
  ok(C.kit.playing && C.S.b.length > 0 && C.S.t > 0.3, 'page: boots, builds a random scene and autoplays', `${C.S.b.length} beads, seed ${C.kit.seed}`);
  const seed0 = C.kit.seed; C.kit.newScene(); runRaf(2);
  ok(C.kit.seed !== seed0 && C.S.t < 0.1, 'page: a new scene rebuilds the sim');
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
