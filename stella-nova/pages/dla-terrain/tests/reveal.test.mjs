// ============================================================================
//  DLA TERRAIN  ·  tests/reveal.test.mjs — the loading veil and the fade-in
//  (node, no GPU, no browser)
//  Run: node stella-nova/pages/dla-terrain/tests/reveal.test.mjs
// ----------------------------------------------------------------------------
//  Why (2026-10-18, the user): "dla doesn't need to show everything as it
//  loads". reveal.js keeps the canvas at opacity 0 under a calm veil until
//  the terrain is done, the modules and their textures are in and the
//  plant stream is empty, draws REVEAL.WARM_FRAMES more frames (the cloud
//  and froxel histories settle), then fades the canvas in over FADE_S.
//  "Watch it build" (the player) and the saver are never veiled.
//    1 the state machine with fake inputs: hidden until ready, the warm
//      frames, a monotonic fade of about 0.6 s, the caps on slow modules
//    2 Watch it build and the saver: shown at once, also mid-load
//    3 the DOM part with a fake document: canvas opacity, the veil
//    4 main.js wiring: begin in generate with player.active, the tick in
//      the loop, no snapshots to the GPU under the veil, show() in the
//      saver and the build toggle
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REVEAL, revealState, revealBegin, revealTick, createReveal } from '../reveal.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   reveal: ' + name); }
  catch (e) { fail++; console.log('  FAIL reveal: ' + name + '\n       ' + (e && e.message)); }
}
const DT = 1 / 60;

check('1 hidden while the terrain forms, the modules load and the plants stream; then warm frames and a 0.6 s fade', () => {
  const st = revealBegin(revealState(), {});
  const ops = [];
  let f = 0;
  const step = (inp) => { revealTick(st, { dt: DT, drawn: true, ...inp }); ops.push(st.opacity); f++; };
  for (let i = 0; i < 120; i++) step({ terrainDone: false, modulesDone: true });
  assert.ok(ops.every((o) => o === 0), 'visible while the terrain forms');
  for (let i = 0; i < 60; i++) step({ terrainDone: true, modulesDone: false });
  assert.equal(st.opacity, 0, 'visible while the modules load');
  for (let i = 0; i < 30; i++) step({ terrainDone: true, modulesDone: true, vegPending: 5 });
  assert.equal(st.opacity, 0, 'visible while the plants stream');
  const n0 = ops.length;
  for (let i = 0; i < 200; i++) step({ terrainDone: true, modulesDone: true, vegPending: 0 });
  const tail = ops.slice(n0);
  const firstVis = tail.findIndex((o) => o > 0);
  assert.ok(firstVis >= REVEAL.WARM_FRAMES, `the fade starts after ${REVEAL.WARM_FRAMES} warm frames (at ${firstVis})`);
  const full = tail.findIndex((o) => o >= 1);
  const fadeS = (full - firstVis + 1) * DT;
  assert.ok(Math.abs(fadeS - REVEAL.FADE_S) < 0.05, 'fade ' + fadeS.toFixed(3) + ' s');
  for (let i = 1; i < tail.length; i++) assert.ok(tail[i] >= tail[i - 1], 'the fade never goes back');
  assert.equal(st.phase, 'shown');
  console.log(`# veil: warm ${firstVis} frames, fade ${fadeS.toFixed(2)} s`);
});
check('1 caps: modules that never load, plants that never settle', () => {
  const st = revealBegin(revealState(), {});
  let t = 0;
  while (st.phase !== 'shown' && t < 30) { revealTick(st, { dt: DT, drawn: true, terrainDone: true, modulesDone: false, vegPending: 9 }); t += DT; }
  assert.equal(st.phase, 'shown');
  assert.ok(t > REVEAL.MODULE_WAIT_S && t < REVEAL.MODULE_WAIT_S + REVEAL.VEG_WAIT_S + 2, 'shown at ' + t.toFixed(1) + ' s');
  const s2 = revealBegin(revealState(), {});
  for (let i = 0; i < 100; i++) revealTick(s2, { dt: DT, drawn: false, terrainDone: true, modulesDone: true });
  assert.equal(s2.phase, 'warm', 'warm frames count only drawn frames');
});
check('2 Watch it build and the saver are never veiled', () => {
  for (const o of [{ build: true }, { saver: true }]) {
    const st = revealBegin(revealState(), o);
    revealTick(st, { dt: DT, drawn: true, terrainDone: false });
    assert.ok(st.phase === 'shown' && st.opacity === 1, JSON.stringify(o));
  }
});
check('3 the DOM part: canvas opacity 0 under a veil, then 1 and the veil gone', () => {
  const made = [];
  const el = (tag) => { const e = { tag, style: {}, children: [], attrs: {}, textContent: '', appendChild(c) { this.children.push(c); }, setAttribute(k, v) { this.attrs[k] = v; } }; made.push(e); return e; };
  const parent = { inserted: [], insertBefore(n) { this.inserted.push(n); } };
  const canvas = { style: {}, parentNode: parent, nextSibling: null };
  const r = createReveal({ canvas, doc: { createElement: el } });
  r.begin({});
  assert.equal(canvas.style.opacity, '0.000');
  assert.ok(r.veil && parent.inserted[0] === r.veil && r.veil.style.display === 'flex' && /pointer-events:none/.test(r.veil.style.cssText));
  r.label('Growing DLA ridges', 0.4);
  assert.ok(made.some((e) => e.textContent === 'Growing DLA ridges'));
  let i = 0;
  while (r.state.phase !== 'shown' && i++ < 400) r.tick({ dt: DT, drawn: true, terrainDone: true, modulesDone: true, vegPending: 0 });
  assert.equal(canvas.style.opacity, '');
  assert.equal(r.veil.style.display, 'none');
  r.begin({ build: true });
  assert.equal(canvas.style.opacity, '');
  r.begin({});
  r.show();
  assert.ok(r.state.phase === 'shown' && canvas.style.opacity === '');
});
check('4 main.js: begin in generate (player.active), the tick in the loop, no snapshots under the veil, show() for the saver and the build toggle', () => {
  const main = readFileSync(join(page, 'main.js'), 'utf8');
  assert.ok(/import \{ createReveal \} from '\.\/reveal\.js';/.test(main), 'import');
  assert.ok(/player\.begin\(\);\s*reveal\.begin\(\{ build: player\.active, saver: !!app\.saverRun \}\);/.test(main), 'begin');
  assert.ok(/if \(m\.snapshot && !reveal\.hiding\) pendingSnap/.test(main), 'snapshots');
  assert.ok(/reveal\.tick\(\{ dt, drawn, terrainDone: !!\(app\.gen && !app\.gen\.running\), modulesDone: !!loading\.done/.test(main), 'tick');
  assert.ok(/function saverEnter\(opts = \{\}\) \{[\s\S]{0,80}reveal\.show\(\);/.test(main), 'saver');
  assert.ok(/if \(on\) \{\s*reveal\.show\(\);/.test(main), 'build toggle');
});
console.log(`reveal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
