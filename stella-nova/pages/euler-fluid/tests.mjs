// ============================================================================
//  EULER FLUID TESTS  ·  node stella-nova/pages/euler-fluid/tests.mjs
// ----------------------------------------------------------------------------
//  upstream       the module Fluid gives the same fields as the upstream
//                 algorithm on the wind tunnel (a still tank stays still)
//  random scenes  N seeds of the page randomizer run 300 frames each: no
//                 NaN, speeds bounded. N = 40 (EULER_FULL=1: 200)
//  incompress.    the pressure projection drives the divergence to zero
//  cavity         the lid drives one vortex through the viscosity
//  determinism    one seed, one scene, one result
//  hash           every control round-trips through the share link
//  guard          random scenes keep inflow, lid and jets <= 3.5 cells/step
//  render         render.draw makes only finite canvas calls in all views
//  saver          plan: no back-to-back repeats, 6-12 s cuts
//  page           main.js boots under the DOM stub, autoplays, rebuilds on
//                 a new scene, and runs saver cuts with TeX plates
// ============================================================================
import * as SV from './solver.js';
import * as SC from './scene.js';
import { draw, fitView } from './render.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx, makeCanvas } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SC.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);
function run(st, seed, frames, resCap = 100) {
  const S = SV.createSim(), r = SC.sceneRng(seed);
  SC.applyParams(S, st);
  SV.buildScene(S, SC.sceneConfig(Object.assign({}, st, { res: Math.min(st.res, resCap) }), r), r);
  for (let f = 0; f < frames; f++) SV.step(S);
  return S;
}
function divergence(S) {
  const f = S.f, n = f.numY; let mx = 0;
  for (let i = 2; i < f.numX - 2; i++) for (let j = 2; j < f.numY - 2; j++) {
    const k = i * n + j; if (f.s[k] === 0 || f.s[k + n] === 0 || f.s[k - n] === 0 || f.s[k + 1] === 0 || f.s[k - 1] === 0) continue;
    mx = Math.max(mx, Math.abs(f.u[k + n] - f.u[k] + f.v[k + 1] - f.v[k]));
  }
  return mx;
}
{
  // A tank at rest stays at rest (hydrostatics): the upstream solver behaviour.
  // 200 iterations: with the upstream default of 40 the Gauss-Seidel solve
  // leaves about 0.5 m/s near the open top corner (it does upstream too).
  const st = sceneOf(3, { kind: 'tank', nObs: 0, g: 9.81, iters: 200, over: true, dt: '60', visc: 0 });
  const S = run(st, 3, 120, 50), h = SV.health(S), f = S.f, n = f.numY;
  let vi = 0; for (let i = 2; i < f.numX - 2; i++) for (let j = 2; j < f.numY - 4; j++) vi = Math.max(vi, Math.abs(f.v[i * n + j]), Math.abs(f.u[i * n + j]));
  const pTop = f.p[10 * n + n - 3], pBot = f.p[10 * n + 2], want = 1000 * 9.81 * (n - 5) * f.h;
  ok(h.bad === 0 && vi < 0.1 && pBot > pTop && Math.abs((pBot - pTop) - want) < 0.15 * want, 'tank: water below the open top stays still; pressure rises as rho g h', `interior vmax ${vi.toExponential(1)}, dp ${(pBot - pTop).toFixed(0)} Pa vs rho g h ${want.toFixed(0)} Pa`);
}
{
  const N = process.env.EULER_FULL ? 200 : 40;
  const bad = []; const t0 = Date.now(); const kinds = {};
  for (let s = 1; s <= N; s++) {
    const st = sceneOf(s * 104729); kinds[st.kind] = (kinds[st.kind] || 0) + 1;
    const S = run(st, s * 104729, 300, 80), h = SV.health(S);
    if (h.bad || h.vmax > 60) bad.push(`seed ${s * 104729} ${st.kind}: bad ${h.bad} vmax ${h.vmax.toFixed(1)}`);
    for (const o of S.obstacles) if (!Number.isFinite(o.x + o.y + o.a)) bad.push('obstacle NaN ' + s);
  }
  ok(!bad.length, `random scenes: ${N} seeds x 300 frames, finite, speeds bounded`, bad.length ? bad.slice(0, 3).join('; ') : `${JSON.stringify(kinds)} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
{
  const st = sceneOf(8, { kind: 'cavity', nObs: 1, iters: 60, over: true, dt: '60', res: 60 });
  const S = run(st, 8, 120, 60), d0 = divergence(S);
  S.f.solveIncompressibility(200, S.P.dt, 1.9);
  const d1 = divergence(S);
  ok(d1 < 1e-3 && d1 < d0, 'incompressibility: the pressure projection drives the divergence to zero', `max |div| ${d0.toExponential(2)} after advection -> ${d1.toExponential(2)} after 200 iterations`);
}
{
  // lid-driven cavity: viscosity carries the lid into one big vortex
  const st = sceneOf(14, { kind: 'cavity', nObs: 0, res: 60, aspect: 1.2, lid: 1.5, visc: 0.0012, iters: 40, dt: '60' });
  const S = run(st, 14, 500, 60), f = S.f, n = f.numY, ic = f.numX >> 1;
  const top = f.u[ic * n + Math.round(n * 0.8)], bot = f.u[ic * n + Math.round(n * 0.2)];
  ok(top > 0.05 && bot < -0.02, 'cavity: the lid drives a vortex (forward flow on top, return flow below)', `u(0.8 H) ${top.toFixed(2)}, u(0.2 H) ${bot.toFixed(2)} m/s`);
}
{
  const st = sceneOf(4242), a = run(st, 4242, 80, 70), b = run(st, 4242, 80, 70);
  let same = a.f.numCells === b.f.numCells; for (let k = 0; k < a.f.numCells && same; k++) if (a.f.u[k] !== b.f.u[k] || a.f.m[k] !== b.f.m[k]) same = false;
  ok(same, 'determinism: one seed gives the same fields after 80 frames');
}
{
  let bad = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++; }
  ok(bad === 0, 'hash: 200 random scenes round-trip through the share link');
  const g = Array.from({ length: 400 }, (_, s) => sceneOf(s + 1));
  const cfl = st => Math.max(st.inVel, st.lid, st.jet) * (st.dt === '120' ? 1 / 120 : 1 / 60) * st.res;
  ok(g.every(st => cfl(st) <= SC.CFL_MAX + 1e-6 && (st.kind !== 'tank' || st.colorBy !== 'smoke')), 'guard: inflow and lid CFL <= 3.5 cells per step; a tank never shows smoke', `max CFL ${Math.max(...g.map(cfl)).toFixed(2)}`);
  ok(new Set(g.map(st => st.kind)).size === 6 && new Set(g.map(st => st.cmap)).size > 15, 'randomizer: all 6 scenes and many colour maps occur in 400 draws');
}
{
  let bad = 0, calls = 0;
  const lut = new Uint8Array(768).map((_, i) => i % 256), t = K.themeById('night');
  for (const [kind, colorBy] of [['tunnel', 'smoke'], ['tunnel', 'pressure'], ['paint', 'smoke'], ['cavity', 'vorticity'], ['jets', 'speed'], ['tank', 'pressmoke']]) {
    const st = sceneOf(77, { kind, colorBy, nObs: 3, shapes: 'mixed', stream: true, vel: true });
    const S = run(st, 77, 30, 60), ctx = fakeCtx(800, 500);
    draw(ctx, S, fitView(S, { x: 0, y: 0, w: 800, h: 500 }), { bg: t.bg, bg2: t.bg2, ink: t.ink, wall: t.wall, accent: t.accent, wallFill: 'rgba(255,255,255,.08)', outline: '#000', colorBy, lut, stream: true, vel: true, smooth: true, palette: K.paletteColors('toybox'), veil: 0.2, dpr: 1 }, {}, makeCanvas, 800, 500);
    bad += ctx.bad; calls += ctx.calls;
  }
  ok(bad === 0 && calls > 200, 'render: every view draws with finite canvas calls', `${calls} calls`);
}
{
  const { SHOTS } = await import('./saver.js');
  const plan = K.planShots(SHOTS, 5, 200);
  ok(SHOTS.length >= 6 && plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), `saver plan: ${SHOTS.length} shots, no repeats, 6-12 s cuts`);
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Euler Fluid by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  document.createElement = (orig => t => { const e = orig(t); if (t === 'canvas') { e.getContext = () => e._c || (e._c = fakeCtx(e.width, e.height)); } return e; })(document.createElement);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const P = window.__euler;
  runRaf(30);
  const f0 = P.S.frame;
  ok(P.kit.playing && f0 > 0 && P.S.f, 'page: boots, builds a random scene and autoplays', `${P.S.kind}, ${P.S.f.numX}x${P.S.f.numY}, ${f0} frames, seed ${P.kit.seed}`);
  const seed0 = P.kit.seed; P.kit.newScene(); runRaf(5);
  ok(P.kit.seed !== seed0 && P.S.frame < f0 + 10, 'page: a new scene rebuilds the sim');
  ok(view._c.bad === 0, 'page: no non-finite canvas calls while running');
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 10; k++) { window.snSaver.cut(); runRaf(10); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 11 && rep === 0 && SV.health(P.S).bad === 0 && labels.every(L => L.tex && !L.code), 'page saver: 11 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver'), 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
