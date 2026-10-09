// ============================================================================
//  FIRE SIMULATION TESTS  ·  node stella-nova/pages/fire-simulation/tests.mjs
// ----------------------------------------------------------------------------
//  plume          the upstream ring with upstream settings: heat rises above
//                 the ring, smoke cools, nothing goes NaN
//  burners        each burner kind lights cells; an unlit burner does not
//  random scenes  N seeds x 300 frames (FIRE_FULL=1: 200): finite, bounded
//  determinism    one seed, one scene, one result (seeded swirls)
//  hash, guard    share link round-trip; floor follows the preset; smoke
//                 cools slower than fire
//  render, saver, page   as in the other sim kit pages
// ============================================================================
import * as SV from './solver.js';
import * as SC from './scene.js';
import { draw, fitView, rampLut } from './render.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx, makeCanvas } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SC.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);
function run(st, seed, frames, cellsCap = 30000) {
  const S = SV.createSim(); SC.applyParams(S, st);
  SV.buildScene(S, SC.sceneConfig(Object.assign({}, st, { cells: Math.min(st.cells, cellsCap) }), SC.sceneRng(seed)), SC.sceneRng(seed + 1));
  for (let f = 0; f < frames; f++) SV.step(S);
  return S;
}
function heatCentroid(S) { const f = S.f, n = f.numY; let w = 0, y = 0; for (let i = 0; i < f.numX; i++) for (let j = 0; j < f.numY; j++) { const t = f.t[i * n + j]; w += t; y += t * (j + 0.5) * f.h; } return w > 0 ? y / w : 0; }
{
  const st = Object.assign(K.defaults(SCHEMA), { preset: 'ring', nBurn: 1, motion: 'static', floor: false });
  const S = run(st, 1, 240, 40000), h = SV.health(S), b = S.cfg.burners[0], yc = heatCentroid(S);
  const n = S.f.numY; let sy = 0, sw = 0, fy = 0, fw = 0;
  for (let i = 0; i < S.f.numX; i++) for (let j = 0; j < n; j++) { const t = S.f.t[i * n + j], y = (j + 0.5) * S.f.h; if (t > 0.02 && t < 0.3) { sy += y; sw++; } else if (t >= 0.3) { fy += y; fw++; } }
  ok(h.bad === 0 && yc > b.y + 0.05 && sw > 100 && fw > 100 && sy / sw > fy / fw, 'plume: upstream ring and settings: heat rises above the ring; smoke rides above the flame', `heat centroid ${yc.toFixed(2)} m, ring ${b.y.toFixed(2)} m; smoke at ${(sy / sw).toFixed(2)} m over flame at ${(fy / fw).toFixed(2)} m`);
}
{
  const f = new SV.Fluid(60, 40, 1 / 40, SV.defaultCfg(), K.rng(1));
  const lit = kind => { let c = 0; for (let i = 0; i < f.numX; i++) for (let j = 0; j < f.numY; j++) if (SV.burnCell(f, { kind, x: 0.75, y: 0.4, r: 0.15 }, i, j)) c++; return c; };
  const counts = SV.BURNERS.map(lit);
  ok(counts.every(c => c > 0), 'burners: every kind lights cells', SV.BURNERS.map((k, i) => `${k} ${counts[i]}`).join(', '));
  const st = Object.assign(K.defaults(SCHEMA), { preset: 'floor', nBurn: 1, floor: false });
  const S = run(st, 2, 60, 20000);
  ok(SV.health(S).heat === 0, 'burners: an unlit burner (the floor preset ring) gives no heat when the floor is off');
}
{
  const N = process.env.FIRE_FULL ? 200 : 30, bad = [], t0 = Date.now(), kinds = {};
  for (let s = 1; s <= N; s++) {
    const st = sceneOf(s * 7907); kinds[st.preset] = (kinds[st.preset] || 0) + 1;
    const S = run(st, s * 7907, 300, 20000), h = SV.health(S);
    if (h.bad || h.vmax > 80) bad.push(`seed ${s * 7907} ${st.preset}: bad ${h.bad} vmax ${h.vmax.toFixed(1)}`);
  }
  ok(!bad.length, `random scenes: ${N} seeds x 300 frames, finite, bounded`, bad.length ? bad.slice(0, 3).join('; ') : `${JSON.stringify(kinds)} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
{
  const st = sceneOf(4242), a = run(st, 4242, 90, 15000), b = run(st, 4242, 90, 15000);
  let same = true; for (let k = 0; k < a.f.numCells && same; k++) if (a.f.t[k] !== b.f.t[k] || a.f.u[k] !== b.f.u[k]) same = false;
  ok(same, 'determinism: one seed gives the same fire after 90 frames (seeded swirls)');
}
{
  let bad = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++; }
  ok(bad === 0, 'hash: 200 random scenes round-trip through the share link');
  const g = Array.from({ length: 300 }, (_, s) => sceneOf(s + 1));
  ok(g.every(st => st.floor === (st.preset === 'floor' || st.preset === 'both') && st.smokeCool <= st.fireCool * 0.8 + 1e-9), 'guard: the floor follows the preset; smoke cools slower than fire');
}
{
  let bad = 0, calls = 0; const t = K.themeById('night');
  for (const [preset, colorBy, fire] of [['ring', 'flame', 'upstream'], ['campfire', 'flame', 'campfire'], ['torches', 'map', 'blue'], ['mixed', 'speed', 'violet']]) {
    const st = sceneOf(5, { preset, colorBy, fire, showSwirls: true, nBurn: 3 }), S = run(st, 5, 40, 10000), ctx = fakeCtx(800, 500);
    const f = SC.FIRE.find(x => x.id === fire);
    draw(ctx, S, fitView(S, { x: 0, y: 0, w: 800, h: 500 }), { bg: t.bg, bg2: t.bg2, ink: t.ink, wall: t.wall, accent: t.accent, burner: '#444', log: '#5b3a24', lut: rampLut(f.colors, SC.FIRE_STOPS), colorBy, glow: 0.6, showBurners: true, showSwirls: true, veil: 0.2 }, {}, makeCanvas, 800, 500);
    bad += ctx.bad; calls += ctx.calls;
  }
  ok(bad === 0 && calls > 20, 'render: every mode draws with finite canvas calls', `${calls} calls`);
  const up = rampLut(SC.FIRE[0].colors, SC.FIRE_STOPS);
  ok(up[0] === 0 && up[255 * 3] === 255 && up[255 * 3 + 1] === 255 && up[255 * 3 + 2] === 0, 'render: the Classic ramp runs black to yellow like upstream getFireColor');
}
{
  const { SHOTS } = await import('./saver.js');
  const plan = K.planShots(SHOTS, 5, 200);
  ok(SHOTS.length >= 6 && plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), `saver plan: ${SHOTS.length} shots, no repeats, 6-12 s cuts`);
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Fire Simulation by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  document.createElement = (orig => t => { const e = orig(t); if (t === 'canvas') { e.getContext = () => e._c || (e._c = fakeCtx(e.width, e.height)); } return e; })(document.createElement);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const P = window.__fire;
  runRaf(20);
  const f0 = P.S.frame;
  ok(P.kit.playing && f0 > 0 && P.S.f, 'page: boots, builds a random scene and autoplays', `${P.kit.state.preset}, ${P.S.f.numX}x${P.S.f.numY}, ${f0} frames`);
  const seed0 = P.kit.seed; P.kit.newScene(); runRaf(3);
  ok(P.kit.seed !== seed0 && P.S.frame < f0 + 5, 'page: a new scene rebuilds the sim');
  ok(view._c.bad === 0, 'page: no non-finite canvas calls while running');
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 9; k++) { window.snSaver.cut(); runRaf(4); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 10 && rep === 0 && SV.health(P.S).bad === 0 && labels.every(L => L.tex && !L.code), 'page saver: 10 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver'), 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
