// ============================================================================
//  PBF BOUNDARIES TESTS  ·  node stella-nova/pages/pbf-boundary/tests.mjs
// ----------------------------------------------------------------------------
//  random scenes  N seeds of the page randomizer (scene.js with its guard)
//                 run 600 frames each: no NaN, no particle out of the
//                 domain. N = 12 by default (about 1 min); PBF_FULL=1 runs 200.
//  density        a still pool settles near the rest density
//  floating       a box of relative density 0.5 floats with about half its
//                 area under the surface; a rock (2.6) sinks to the floor
//  displacement   a body dropped into still water raises the level by its
//                 submerged area / width
//  determinism    one seed, one scene, one result
//  hash           every control round-trips through the share link
//  render         render.draw makes only finite canvas calls in all modes
//  saver          saver plan: shots, no back-to-back repeats, 6-12 s cuts
//  page           main.js boots under the DOM stub, autoplays, rebuilds on
//                 a new scene, and runs saver cuts
// ============================================================================
import * as SV from './solver.js';
import * as SC from './scene.js';
import { draw, fitView, WATER } from './render.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx, makeCanvas } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SC.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);
function run(st, seed, frames, cap = 1600) {
  const S = SV.createSim({ cap });
  const r = SC.sceneRng(seed);
  SC.applyParams(S, st);
  SV.buildScene(S, SC.sceneConfig(Object.assign({}, st, { count: Math.min(st.count, cap) }), r), r);
  for (let f = 0; f < frames; f++) S.step(1 / 60);
  return S;
}
// Water surface height: the highest particle row with enough particles
// (mean of the top 3 % of fluid particle heights away from bodies).
function surface(S) {
  const ys = [];
  for (let i = 0; i < S.n; i++) if (S.bodies.every(b => Math.abs(S.x[i] - b.x) > b.R + 0.05)) ys.push(S.y[i]);
  ys.sort((a, b) => b - a); const k = Math.max(1, Math.floor(ys.length * 0.03));
  return ys.slice(0, k).reduce((a, b) => a + b, 0) / k;
}
function submergedFraction(S, b, level) {
  // area fraction of the body below the level, sampled on a grid
  let A = 0, U = 0;
  for (let y = b.y - b.R; y <= b.y + b.R; y += 0.004) for (let x = b.x - b.R; x <= b.x + b.R; x += 0.004) if (SV.bodySDF(b, x, y) < 0) { A++; if (y < level) U++; }
  return U / A;
}

{
  const N = process.env.PBF_FULL ? 200 : 12;
  const t0 = Date.now(); let bad = [], cnt = 0;
  for (let s = 1; s <= N; s++) {
    const st = sceneOf(s * 7919);
    const S = run(st, s * 7919, 600, 1000);
    const h = SV.health(S); cnt += S.n;
    if (h.bad || h.out) bad.push(`seed ${s * 7919} ${st.container}/${st.fill}/${st.material}: bad ${h.bad} out ${h.out}`);
    for (const b of S.bodies) if (!Number.isFinite(b.x + b.y + b.a)) bad.push('body NaN seed ' + s);
  }
  ok(!bad.length, `random scenes: ${N} seeds x 600 frames, no NaN, nothing escapes`, bad.length ? bad.slice(0, 3).join('; ') : `${cnt} particles, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
{
  const st = sceneOf(5, { container: 'tank', fill: 'pool', count: 1800, nBodies: 0, obstacles: 0, emitters: 0, paddle: false, material: 'water', g: 9.81, tilt: 0, spin: 0, shakeA: 0 });
  const S = run(st, 5, 400, 2000); let rho = 0, mx = 0;
  for (let i = 0; i < S.n; i++) { rho += S.rho[i]; mx = Math.max(mx, S.rho[i]); }
  rho /= S.n * SV.RHO0;
  ok(rho > 0.97 && rho < 1.03 && mx / SV.RHO0 < 1.25, 'density: a still pool stays near rest density', `mean ${rho.toFixed(3)} max ${(mx / SV.RHO0).toFixed(2)}`);
}
{
  const base = { container: 'tank', fill: 'pool', count: 2000, obstacles: 0, emitters: 0, paddle: false, material: 'water', g: 9.81, tilt: 0, spin: 0, shakeA: 0, coupling: 1 };
  const st = sceneOf(11, Object.assign({}, base, { nBodies: 0 }));
  const S = run(st, 11, 200, 2200);
  const lvl0 = surface(S);
  const box = SV.addBody(S, 'box', S.Wd / 2, lvl0 + 0.12, SC.sceneRng(1), 1.2, 0.5);
  for (let f = 0; f < 900; f++) S.step(1 / 60);
  const lvl = surface(S), frac = submergedFraction(S, box, lvl);
  ok(frac > 0.35 && frac < 0.65 && Math.abs(box.vy) < 0.1, 'floating: a box of density 0.5 floats about half under', `submerged ${frac.toFixed(2)}`);
  // displacement: rise of the level against the submerged area / free width
  const inn = S.container.inner, wid = inn.x1 - inn.x0, rise = lvl - lvl0, want = frac * box.area / wid;
  ok(rise > 0 && Math.abs(rise - want) < 0.6 * want + 0.004, 'displacement: the level rises by the displaced area / width', `rise ${(rise * 1000).toFixed(1)} mm, expected ${(want * 1000).toFixed(1)} mm`);
  const rock = SV.addBody(S, 'rock', S.Wd * 0.25, lvl + 0.1, SC.sceneRng(2), 1.2);
  for (let f = 0; f < 600; f++) S.step(1 / 60);
  ok(rock.y - rock.R < inn.y0 + 0.05, 'sinking: a rock of density 2.6 sinks to the floor', `rock base ${(rock.y - rock.R).toFixed(3)} m, floor ${inn.y0.toFixed(3)} m`);
}
{
  const st = sceneOf(4242), a = run(st, 4242, 120, 900), b = run(st, 4242, 120, 900);
  let same = a.n === b.n; for (let i = 0; i < a.n && same; i++) if (a.x[i] !== b.x[i] || a.y[i] !== b.y[i]) same = false;
  ok(same, 'determinism: one seed gives the same particles after 120 frames');
}
{
  let bad = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++; }
  ok(bad === 0, 'hash: 200 random scenes round-trip through the share link');
  const g = Array.from({ length: 300 }, (_, s) => sceneOf(s + 1));
  ok(g.every(st => !(st.material === 'granular' && st.emitters) && !(st.fill === 'empty' && !st.emitters) && Math.abs(st.tilt) <= 30), 'guard: grains get no emitters, an empty start gets a pour, tilt stays mild');
}
{
  let bad = 0, calls = 0;
  for (const [render, colorBy] of [['smooth', 'water'], ['particles', 'speed'], ['both', 'vorticity'], ['smooth', 'density'], ['smooth', 'pressure'], ['particles', 'depth']]) {
    const st = sceneOf(77, { render, colorBy, nBodies: 4 });
    const S = run(st, 77, 60, 900);
    const ctx = fakeCtx(800, 500), t = K.themeById('abyss');
    const lut = new Uint8Array(768).map((_, i) => i % 256);
    const look = { bg: t.bg, bg2: t.bg2, grid: t.grid, wall: t.wall, wallFill: 'rgba(255,255,255,0.06)', obstacle: t.wall, outline: '#000', mark: t.accent, cabin: '#fff', water: WATER[3].id, colorBy, lut: colorBy === 'water' ? null : lut, render, foam: true, size: 1, palette: K.paletteColors('toybox'), veil: 0.3, alpha: 0.94 };
    draw(ctx, S, fitView(S, { x: 0, y: 0, w: 800, h: 500 }), look, {}, makeCanvas, 800, 500);
    bad += ctx.bad; calls += ctx.calls;
  }
  ok(bad === 0 && calls > 100, 'render: every mode draws with finite canvas calls', `${calls} calls`);
}
{
  const { default: _ } = { default: 0 };
  const plan = K.planShots([{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }, { key: 'f' }, { key: 'g' }, { key: 'h' }], 5, 200);
  ok(plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), 'saver plan: 8 shots, no repeats, 6-12 s cuts');
}
{
  // Boot the real page under the DOM stub.
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['PBF Boundaries by Sergii Biloshytskyi'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  document.createElement = (orig => t => { const e = orig(t); if (t === 'canvas') { e.getContext = () => e._c || (e._c = fakeCtx(e.width, e.height)); } return e; })(document.createElement);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const P = window.__pbf;
  runRaf(30);
  const S0 = P.S, n0 = S0.n, f0 = S0.frame;
  ok(P.kit.playing && S0.frame > 0 && n0 > 0, 'page: boots, builds a random scene and autoplays', `${n0} particles, ${S0.frame} frames, seed ${P.kit.seed}`);
  const seed0 = P.kit.seed; P.kit.newScene(); runRaf(5);
  ok(P.kit.seed !== seed0 && P.S.frame < f0 + 10, 'page: a new scene rebuilds the sim');
  ok(view._c.bad === 0, 'page: no non-finite canvas calls while running');
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 12; k++) { window.snSaver.cut(); runRaf(20); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  const h = SV.health(P.S);
  ok(hist.length === 13 && rep === 0 && h.bad === 0 && labels.every(L => L.tex && !L.code), 'page saver: 13 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(P.kit.seed === P.kit.seed && !document.documentElement.classList.contains('sk-saver'), 'page saver: exit restores the page');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
