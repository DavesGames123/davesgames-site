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
//  palette        blackbody chain: Planck locus check, hue and luminance
//                 rise with t, no green or blue cast, smoke does not glow,
//                 the renderer LUT matches palette.js per cell
//  render, saver, page   as in the other sim kit pages
// ============================================================================
import * as SV from './solver.js';
import * as SC from './scene.js';
import { draw, fitView, rampLut } from './render.js';
import * as PL from './palette.js';
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
  for (const [preset, colorBy, fire] of [['ring', 'flame', 'blackbody'], ['ring', 'flame', 'upstream'], ['campfire', 'flame', 'campfire'], ['torches', 'map', 'blue'], ['mixed', 'speed', 'violet']]) {
    const st = sceneOf(5, { preset, colorBy, fire, showSwirls: true, nBurn: 3 }), S = run(st, 5, 40, 10000), ctx = fakeCtx(800, 500);
    draw(ctx, S, fitView(S, { x: 0, y: 0, w: 800, h: 500 }), { bg: t.bg, bg2: t.bg2, ink: t.ink, wall: t.wall, accent: t.accent, burner: '#444', log: '#5b3a24', lut: PL.paletteLut(fire), colorBy, glow: 0.6, showBurners: true, showSwirls: true, veil: 0.2 }, {}, makeCanvas, 800, 500);
    bad += ctx.bad; calls += ctx.calls;
  }
  ok(bad === 0 && calls > 20, 'render: every mode draws with finite canvas calls', `${calls} calls`);
  const up = rampLut(SC.FIRE.find(x => x.id === 'upstream').colors, SC.FIRE_STOPS);
  ok(up[0] === 0 && up[255 * 3] === 255 && up[255 * 3 + 1] === 255 && up[255 * 3 + 2] === 0, 'render: the Classic ramp runs black to yellow like upstream getFireColor');
}
{
  // palette: the blackbody chain in palette.js
  const D65 = PL.planckRGB(6504);
  ok(D65.every(v => v > 0.93), 'palette: Planck 6504 K is near white in linear sRGB (CIE 1931 fit + XYZ matrix)', D65.map(v => v.toFixed(3)).join(' '));
  const lo = PL.planckRGB(1000), mid = PL.planckRGB(2000);
  ok(lo[0] === 1 && lo[1] < 0.1 && lo[2] < 0.01 && mid[1] > 0.2 && mid[1] < 0.35, 'palette: Planck 1000 K is red, 2000 K is orange', `1000 K ${lo.map(v => v.toFixed(3)).join(' ')}, 2000 K ${mid.map(v => v.toFixed(3)).join(' ')}`);
  const E = 0.5 / 255;
  for (const id of ['blackbody', 'campfire', 'white']) {
    const p = PL.paletteById(id), N = 141, F = [], A = [];
    for (let k = 0; k < N; k++) { const t = 0.3 + 0.7 * k / (N - 1); F.push(PL.flameDisplay(p, t)); A.push(PL.samplePalette(p, t).rgb); }
    const Y = F.map(c => PL.luminance(c.map(PL.srgbDecode)));
    let order = 0, ratio = 0, lum = 0, hueDrop = 0, tailDrop = 0;
    for (let k = 0; k < N; k++) {
      for (const c of [F[k], A[k]]) if (c[1] > c[0] + E || c[2] > c[1] + E) order++;
      if (k && !(Math.max(...F[k - 1]) > 0)) { if (!(Y[k] > Y[k - 1])) lum++; continue; }
      if (k) {
        // a ratio drop counts only where that channel shows (>= 1/255): the
        // ACES toe bends G/R a little in the first 2 % of the fade-in
        if ((F[k][1] >= 1 / 255 && F[k][1] / F[k][0] < F[k - 1][1] / F[k - 1][0] - 1e-6) || (F[k][2] >= 1 / 255 && F[k][2] / F[k][0] < F[k - 1][2] / F[k - 1][0] - 1e-6)) ratio++;
        if (!(Y[k] > Y[k - 1])) lum++;
        const sat = 1 - Math.min(...F[k]) / Math.max(...F[k]), dh = PL.hue(F[k - 1]) - PL.hue(F[k]);
        if (sat >= 0.5 && dh > 1e-6 && F[k][1] >= 1 / 255) hueDrop++;
        if (sat < 0.5) tailDrop = Math.max(tailDrop, dh);
      }
    }
    const h0 = PL.hue(F[1]), hN = PL.hue(F[N - 1]), cN = F[N - 1];
    ok(order === 0, `palette ${id}: red >= green >= blue at every flame sample (no green, no magenta)`, `${N} flame + ${N} composited samples`);
    ok(ratio === 0 && lum === 0, `palette ${id}: G/R and B/R rise and luminance rises with t (red, orange, yellow, white)`, `Y ${Y[0].toFixed(4)} .. ${Y[N - 1].toFixed(3)}`);
    ok(hueDrop === 0 && h0 < 8, `palette ${id}: hue rises from red while the colour is saturated`, `hue ${h0.toFixed(1)} .. ${hN.toFixed(1)} deg; near-white tail drift ${tailDrop.toFixed(1)} deg`);
    if (id === 'blackbody') ok(Math.min(...cN) > 0.75 && F[0].every(v => v === 0) && F[14][0] < 0.45 && F[14][1] < 0.1 * F[14][0], 'palette blackbody: emission starts at zero, the edge is a dim deep red, the core is near white', `t 0.37 ${F[14].map(v => Math.round(v * 255))}, core ${cN.map(v => Math.round(v * 255))}`);
  }
  {
    let glow = 0, light = 0, order = 0, prevA = 0, mono = 0;
    for (let k = 1; k < 60; k++) {
      const t = 0.3 * k / 60, s = PL.samplePalette(PL.paletteById('blackbody'), t);
      if (Math.max(...s.emit) > 0) glow++;
      if (Math.max(...s.rgb) > 70 / 255) light++;
      if (s.rgb[1] > s.rgb[0] + E || s.rgb[2] > s.rgb[1] + E) order++;
      if (!(s.a > prevA)) mono++; prevA = s.a;
    }
    ok(!glow && !light && !order && !mono, 'palette: smoke (t < 0.3) absorbs and does not glow: dark grey-brown, alpha rises with t');
  }
  {
    let worst = 0, cells = 0;
    for (const id of ['blackbody', 'campfire', 'sodium', 'blue']) {
      const L = PL.paletteLut(id), p = PL.paletteById(id);
      for (let k = 0; k < L.n; k++) { const s = PL.samplePalette(p, k / (L.n - 1)); for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(L.rgba[k * 4 + c] - Math.round(s.rgb[c] * 255))); worst = Math.max(worst, Math.abs(L.rgba[k * 4 + 3] - Math.round(s.a * 255))); }
    }
    const st = sceneOf(11, { preset: 'ring', colorBy: 'flame', fire: 'blackbody' }), S = run(st, 11, 60, 10000), cache = {}, t = K.themeById('night');
    draw(fakeCtx(800, 500), S, fitView(S, { x: 0, y: 0, w: 800, h: 500 }), { bg: t.bg, bg2: t.bg2, ink: t.ink, wall: t.wall, accent: t.accent, burner: '#444', log: '#5b3a24', lut: PL.paletteLut('blackbody'), colorBy: 'flame', glow: 0.6, showBurners: true, showSwirls: false, veil: 0 }, cache, makeCanvas, 800, 500);
    const f = S.f, n = f.numY, d = cache.img.data, p = PL.paletteById('blackbody');
    let px = 0;
    for (let i = 0; i < f.numX; i++) for (let j = 0; j < n; j++) {
      const tv = Math.min(1, Math.max(0, f.t[i * n + j])), s = PL.samplePalette(p, tv), o = ((n - 1 - j) * f.numX + i) * 4;
      if (tv > 0.3) cells++;
      // premultiplied: the colour of a near-transparent cell does not show
      for (let c = 0; c < 3; c++) px = Math.max(px, Math.abs(d[o + c] * d[o + 3] / 255 - s.rgb[c] * s.a * 255));
      px = Math.max(px, Math.abs(d[o + 3] - s.a * 255));
    }
    ok(worst === 0 && px <= 3, 'palette: the renderer LUT matches palette.js (table exact, per cell within 3/255 premultiplied after the 1024-step lookup)', `table max diff ${worst}, per-cell max diff ${px.toFixed(2)} over ${f.numCells} cells (${cells} flame)`);
  }
  if (process.env.FIRE_TABLE) {
    console.log('\n  t     T (K)   flame sRGB      hue   Y      pixel sRGB + alpha');
    const p = PL.paletteById('blackbody');
    for (const t of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      const T = PL.temperatureAt(p, t), F = PL.flameDisplay(p, t), s = PL.samplePalette(p, t), hx = c => '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
      console.log(`  ${t.toFixed(1)}  ${T == null ? ' smoke' : String(Math.round(T)).padStart(6)}  ${hx(F)}  ${PL.hue(F).toFixed(1).padStart(5)}  ${PL.luminance(F.map(PL.srgbDecode)).toFixed(3)}  ${hx(s.rgb)} a ${s.a.toFixed(2)}`);
    }
    console.log('');
  }
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
