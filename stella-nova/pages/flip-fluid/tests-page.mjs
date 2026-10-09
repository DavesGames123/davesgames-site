// ============================================================================
//  FLIP WATER  ·  tests-page.mjs  —  the sim kit page, in its own process
// ----------------------------------------------------------------------------
//  tests.mjs runs this file with node (its tools test stubs the DOM a
//  different way). Checks: the kit schema round-trips through the share
//  link; toScenesState maps variants to scenes.js sub seeds and leaves
//  "auto" adjust values out; random looks keep the water readable; main.js
//  boots under the sim kit DOM stub, autoplays, rebuilds on New scene, and
//  the saver cuts 8 times with no shot twice in a row, TeX and no code.
//  Prints "N passed, M failed" and exits 1 on a failure.
// ============================================================================
import * as SC from './scene.js';
import * as K from '../../widgets/sim-kit/core.js';
import { OVERRIDES, CATS } from './scenes.js';
import { SCHEMES, BACKGROUNDS, contrast } from './looks.js';
import { installDom, fakeCtx } from '../../widgets/sim-kit/test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SC.makeSchema();
const sceneOf = s => K.randomize(SCHEMA, s, K.defaults(SCHEMA), { guard: SC.guard }).state;
{
  let bad = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s), d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++; }
  ok(bad === 0, 'kit: 200 random scenes round-trip through the share link');
}
{
  const d = K.defaults(SCHEMA), a = SC.toScenesState(d, 7);
  const st = Object.assign({}, d, { preset: 'seeded', v_water: 42, o_flip: 0.5, o_g: SC.makeSchema().groups.find(g => g.id === 'gravity').controls.find(c => c.key === 'o_g').min });
  const b = SC.toScenesState(st, 7);
  ok(a.seed === 'harbour' && !Object.keys(a.sub).length && !Object.keys(a.over).length, 'kit -> scenes: defaults give the harbour scene, no sub seeds, no overrides');
  ok(b.seed === 'k7' && b.sub.water === 'v42' && Object.keys(b.sub).length === 1 && b.over.flip === 0.5 && !('g' in b.over), 'kit -> scenes: a variant is a sub seed; an "auto" adjust value is no override');
  const groups = new Set(SCHEMA.groups.map(g => g.id));
  ok(CATS.every(c => groups.has(c)) && Object.keys(OVERRIDES).every(k => SCHEMA.groups.some(g => g.controls.some(c => c.key === 'o_' + k))), 'kit: every scenes.js category is a group; every old Adjust slider is a control');
}
{
  const g = Array.from({ length: 300 }, (_, s) => sceneOf(s + 1));
  ok(g.every(st => contrast(SCHEMES[st.water], BACKGROUNDS[st.bg]) > 0.1 && st.theme === SC.themeForBg(st.bg)), 'guard: random looks keep the water readable; the panel theme follows the background');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['FLIP Water by Matthias Müller'] };
  globalThis.screen = { width: 1280, height: 800 };
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  document.createElement = (orig => t => { const e = orig(t); e.dataset = e.dataset || {}; if (t === 'canvas') e.getContext = () => e._c || (e._c = fakeCtx(e.width, e.height)); return e; })(document.createElement);
  view.getContext = () => view._c || (view._c = Object.assign(fakeCtx(1280, 800), { getImageData: () => ({ data: new Uint8ClampedArray(4) }) }));
  await import('./main.js');
  const app = window.ffApp;
  runRaf(20);
  ok(app.kit.playing && app.sim && app.sim.time > 0 && app.state.seed === 'harbour', 'page: boots on the harbour scene and autoplays', `${app.sim.numParticles} particles, t ${app.sim.time.toFixed(2)} s`);
  const s0 = app.sim; app.kit.newScene(); runRaf(3);
  ok(app.sim !== s0 && /^k\d+$/.test(app.state.seed), 'page: New scene draws every variant and rebuilds', `seed ${app.state.seed}, ${Object.keys(app.state.sub).length} variants`);
  app.kit.set('view', 'vorticity'); runRaf(2);
  ok(app.drawOpts.colours.view === 'vorticity', 'page: a Look change is live (no rebuild)');
  ok(view._c.bad === 0, 'page: no non-finite canvas calls while running');
  const labels = [];
  await window.snSaver.enter({ seed: 3, label: L => labels.push(L) });
  for (let k = 0; k < 8; k++) { window.snSaver.cut(); runRaf(3); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 9 && rep === 0 && labels.every(L => L.tex && !L.code) && app.sim.stats().nan === 0, 'page saver: 9 cuts, no repeats, TeX plates, no code, finite sim', hist.map(x => x.shot).join(' '));
  window.snSaver.exit(); runRaf(2);
  ok(!app.saver && app.state.seed === 'k' + app.kit.seed, 'page saver: exit rebuilds the visitor scene', app.state.seed);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
