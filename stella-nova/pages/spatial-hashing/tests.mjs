// ============================================================================
//  SPATIAL HASHING TESTS  ·  node stella-nova/pages/spatial-hashing/tests.mjs
// ----------------------------------------------------------------------------
//  hash          the upstream Hash finds every pair closer than 2r (against
//                a brute-force search), and checks far fewer pairs
//  random scenes N seeds of the randomizer (scene.js with its guard), at a
//                ball cap of 2500, run 600 frames each: no NaN, every ball
//                inside the box. N = 30 (SH_FULL=1: 200).
//  energy        the upstream gas (e = 1, no gravity) keeps its kinetic
//                energy within 1 % over 600 frames
//  stirrer       a moving stirrer sphere pushes balls out of its volume
//  probe         the probe query holds the probe and its true neighbours
//  determinism   one seed, one scene, one result
//  hash link     every control round-trips through the share link
//  saver         the saver plan: no back-to-back repeats, 6-12 s cuts
//  page          main.js boots under the DOM stub (no WebGL), autoplays,
//                rebuilds on a new scene, and the saver cuts with TeX
// ============================================================================
import vm from 'node:vm';
import fs from 'node:fs';
import * as SIM from './sim.js';
import * as SC from './scene.js';
import { SHOTS } from './saver.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SC.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);
function run(st, seed, frames) {
  const S = SIM.createSim();
  SC.applyParams(S, st);
  SIM.buildScene(S, SC.sceneConfig(st), SC.sceneRng(seed));
  for (let f = 0; f < frames; f++) S.step(1 / 60);
  return S;
}
const inside = S => { const b = S.bounds, r = S.radius; for (let i = 0; i < S.n; i++) { const x = S.pos[3 * i], y = S.pos[3 * i + 1], z = S.pos[3 * i + 2]; if (!Number.isFinite(x + y + z + S.vel[3 * i] + S.vel[3 * i + 1] + S.vel[3 * i + 2])) return false; if (x < b[0] + r - 1e-4 || x > b[3] - r + 1e-4 || y < b[1] + r - 1e-4 || y > b[4] - r + 1e-4 || z < b[2] + r - 1e-4 || z > b[5] - r + 1e-4) return false; } return true; };

{
  const r = 0.03, n = 1500, pos = new Float32Array(3 * n), rnd = K.rng(4);
  for (let i = 0; i < 3 * n; i++) pos[i] = rnd() * 1.2;
  const H = new SIM.Hash(2 * r, n); H.create(pos);
  let miss = 0, checked = 0, truth = 0;
  for (let i = 0; i < n; i++) {
    H.query(pos, i, 2 * r); checked += H.querySize;
    const got = new Set(H.queryIds.subarray(0, H.querySize));
    for (let j = 0; j < n; j++) { if (j === i) continue; const d = Math.hypot(pos[3 * i] - pos[3 * j], pos[3 * i + 1] - pos[3 * j + 1], pos[3 * i + 2] - pos[3 * j + 2]); if (d < 2 * r) { truth++; if (!got.has(j)) miss++; } }
  }
  ok(miss === 0 && checked < n * n / 4, 'hash: the query finds every pair closer than 2r, and checks far fewer pairs', `${truth} close pairs, 0 missed; ${checked} checked against ${n * n}`);
}
{
  const N = process.env.SH_FULL ? 200 : 30, bad = [];
  for (let s = 1; s <= N; s++) { const st = sceneOf(s); st.count = Math.min(st.count, 2500); const S = run(st, s, 600); if (!inside(S) || S.n < 8) bad.push(s + ':' + st.start); }
  ok(!bad.length, `random scenes: ${N} seeds x 600 frames stay finite and inside the box`, bad.slice(0, 6).join(' '));
}
{
  const st = sceneOf(3, { start: 'gas', g: 0, e: 1, eWall: 1, stir: false, count: 2000, radius: 0.03, speed: 0.4 }), S = SIM.createSim();
  SC.applyParams(S, st); SIM.buildScene(S, SC.sceneConfig(st), SC.sceneRng(3));
  const E0 = SIM.energy(S); for (let f = 0; f < 600; f++) S.step(1 / 60);
  const dE = Math.abs(SIM.energy(S) - E0) / E0;
  ok(dE < 0.01, 'energy: the upstream gas (e = 1, no gravity) keeps its kinetic energy within 1 %', `${(100 * dE).toFixed(3)} % over 600 frames, ${S.n} balls`);
}
{
  const st = sceneOf(8, { start: 'gas', g: 0, stir: true, stirAuto: true, stirR: 0.25, count: 3000, radius: 0.025 }), S = run(st, 8, 240);
  const so = S.stirrer; let inS = 0;
  for (let i = 0; i < S.n; i++) if (Math.hypot(S.pos[3 * i] - so.x, S.pos[3 * i + 1] - so.y, S.pos[3 * i + 2] - so.z) < so.r + S.radius - 0.01) inS++;
  ok(inS === 0 && so.t > 3, 'stirrer: a moving sphere keeps the balls out of its volume', `${inS} balls inside after ${so.t.toFixed(1)} s`);
}
{
  const st = sceneOf(9, { start: 'gas', count: 3000 }), S = run(st, 9, 60);
  SIM.queryProbe(S);
  const ids = new Set(S.probeIds.subarray(0, S.probeN)), i = S.probe, r = S.radius; let missing = 0;
  for (let j = 0; j < S.n; j++) if (j !== i && Math.hypot(S.pos[3 * i] - S.pos[3 * j], S.pos[3 * i + 1] - S.pos[3 * j + 1], S.pos[3 * i + 2] - S.pos[3 * j + 2]) < 2 * r && !ids.has(j)) missing++;
  ok(ids.has(i) && missing === 0, 'probe: the shown query holds the probe and all its true neighbours', `${S.probeN} candidates`);
}
{
  const st = sceneOf(77), a = run(Object.assign({}, st, { count: 1500 }), 77, 200), b = run(Object.assign({}, st, { count: 1500 }), 77, 200);
  let same = a.n === b.n; for (let i = 0; i < a.pos.length && same; i++) if (a.pos[i] !== b.pos[i]) same = false;
  ok(same, 'determinism: one seed gives one result');
}
{
  let bad = [];
  for (let s = 1; s <= 30; s++) { const st = sceneOf(s), d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); for (const k of Object.keys(st)) if (JSON.stringify(d.state[k]) !== JSON.stringify(st[k])) bad.push(k); }
  ok(!bad.length, 'hash link: every control round-trips through the share link', bad.slice(0, 5).join(' '));
}
{
  const plan = K.planShots(SHOTS, 5, 200);
  ok(SHOTS.length >= 6 && plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12) && SHOTS.every(s => s.tex && !s.code), `saver plan: ${SHOTS.length} shots, no repeats, 6-12 s cuts, TeX and no code`);
}
{
  installDom({ w: 1280, h: 800 });
  vm.runInThisContext(fs.readFileSync(new URL('../../vendor/three@0.139.2/build/three.min.js', import.meta.url), 'utf8'));
  globalThis.TMP = { page() {}, creditLines: () => ['Spatial Hashing by Matthias Müller'] };
  await import('./main.js');
  const P = window.__sh;
  runRaf(20);
  const f0 = P.S.frame;
  ok(P.kit.playing && f0 > 0 && P.S.n > 0 && !P.stage.gl, 'page: boots without WebGL, builds a random scene and autoplays', `${P.S.n} balls, ${f0} frames`);
  const seed0 = P.kit.seed; P.kit.newScene(); runRaf(3);
  ok(P.kit.seed !== seed0 && P.S.frame < f0, 'page: a new scene rebuilds the sim');
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 10; k++) { window.snSaver.cut(); runRaf(6); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  const cam = P.stage.camera.position;
  ok(hist.length === 11 && rep === 0 && inside(P.S) && Number.isFinite(cam.x + cam.y + cam.z) && labels.every(L => L.tex && !L.code), 'page saver: 11 cuts, no repeats, finite sim and camera, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver') && !P.stage.cam.auto, 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
