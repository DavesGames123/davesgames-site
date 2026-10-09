// ============================================================================
//  JULIA FRACTALS TESTS  ·  node stella-nova/pages/julia-fractals/tests.mjs
// ----------------------------------------------------------------------------
//  upstream      escapeIters and gradientColor equal the upstream functions
//                (copied verbatim here); smoothMu agrees on inside/outside
//  maths         the Mandelbrot area is near 1.506; cardioid and bulb paths
//                with k < 1 stay inside M, k > 1 leaves it
//  render        renderCPU fills every pixel at block sizes 1, 2, 4, 8 in
//                every colouring, finite colours
//  glsl          FRAG validates in naga (when ~/.cargo/bin/naga exists)
//  hash, guard   share link round-trip; most random scenes keep d = 2
//  saver, page   plan without repeats; main.js boots under the DOM stub
//                (no WebGL there: the CPU path), saver cuts with TeX
// ============================================================================
import * as F from './fractal.js';
import * as SC from './scene.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx } from '../../widgets/sim-kit/test/stubs.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SC.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);

// upstream 19-julia.html, verbatim apart from let/var
function upstreamNumIters(x1, x2, c1, c2, maxIters) { let iters; for (iters = 0; iters < maxIters; iters++) { if (x1 * x1 + x2 * x2 > 4.0) return iters; const x = x1; x1 = x1 * x1 - x2 * x2; x2 = 2.0 * x * x2; x1 += c1; x2 += c2; } return maxIters; }
const gc = [[15, 2, 66], [191, 41, 12], [222, 99, 11], [229, 208, 14], [255, 255, 255], [102, 173, 183], [14, 29, 104]];
function upstreamGradient(nr, steps) { const numCols = gc.length, col0 = Math.floor(nr / steps) % numCols, col1 = (col0 + 1) % numCols, step = nr % steps, color = [0, 0, 0]; for (let i = 0; i < 3; i++) { const c0 = gc[col0][i], c1 = gc[col1][i]; color[i] = Math.floor(c0 + (c1 - c0) / steps * step); } return color; }
{
  const r = K.rng(5); let same = 0, agree = 0; const N = 4000;
  for (let k = 0; k < N; k++) {
    const x = -2 + 3 * r(), y = -1.3 + 2.6 * r(), cx = -0.6258, cy = 0.4025;
    if (F.escapeIters(x, y, cx, cy, 100) === upstreamNumIters(x, y, cx, cy, 100)) same++;
    if ((F.smoothMu(x, y, cx, cy, 100) < 0) === (upstreamNumIters(x, y, cx, cy, 100) >= 100)) agree++;
  }
  let g = 0; for (let n = 0; n < 300; n++) if (JSON.stringify(F.gradientColor(n, 20)) === JSON.stringify(upstreamGradient(n, 20))) g++;
  ok(same === N && g === 300, 'upstream: escapeIters and gradientColor equal the upstream functions', `${same}/${N} counts, ${g}/300 colours`);
  ok(agree / N > 0.995, 'upstream: smoothMu agrees with upstream on inside/outside', `${(100 * agree / N).toFixed(2)} %`);
}
{
  const r = K.rng(9); let inside = 0; const N = 60000;
  for (let k = 0; k < N; k++) if (F.smoothMu(0, 0, -2 + 2.6 * r(), -1.3 + 2.6 * r(), 400) < 0) inside++;
  const A = inside / N * 2.6 * 2.6;
  ok(Math.abs(A - 1.506) < 0.05, 'maths: the Mandelbrot area is near 1.506', `A = ${A.toFixed(3)}`);
  const inn = p => [0.2, 0.45, 0.7].every(u => { const [x, y] = F.cAt(p, u, { k: 0.97 }); return F.smoothMu(0, 0, x, y, 3000) < 0; });
  // k > 1 leaves the cardioid; it can land in a bulb attached there (u = 0.2), so
  // the outside check uses points away from the big bulbs
  const out = p => [0.45, 0.7].every(u => { const [x, y] = F.cAt(p, u, { k: 1.06 }); return F.smoothMu(0, 0, x, y, 3000) >= 0; });
  ok(inn('cardioid') && inn('bulb') && out('cardioid') && out('bulb'), 'maths: cardioid and bulb paths with k = 0.97 stay in M; k = 1.06 leaves it away from attached bulbs');
}
{
  let bad = 0, unfilled = 0; const W = 64, H = 40, lut = new Uint8Array(768).map((_, i) => i % 256);
  for (const color of ['smooth', 'bands', 'gradient', 'mono']) for (const k of [1, 2, 4, 8]) for (const mandel of [false, true]) {
    const buf = new Uint8ClampedArray(W * H * 4);
    F.renderCPU(buf, W, H, { cx: mandel ? -0.6 : 0, cy: 0, scale: 3 / H, mandel, c: [-0.6258, 0.4025], iters: 120, power: color === 'bands' ? 3 : 2 }, { color, lut, density: 8, offset: 0.2, mirror: true, inside: [0, 0, 0] }, k);
    for (let i = 3; i < buf.length; i += 4) if (buf[i] !== 255) unfilled++;
    for (const v of buf) if (!Number.isFinite(v)) bad++;
  }
  ok(!bad && !unfilled, 'render: renderCPU fills every pixel at blocks 1, 2, 4, 8 in all colourings');
}
{
  const naga = os.homedir() + '/.cargo/bin/naga';
  if (fs.existsSync(naga)) {
    const loose = [...F.FRAG.matchAll(/^uniform (\w+) (\w+);$/gm)];
    let s = F.FRAG.replace(/^uniform (\w+) (\w+);\n/gm, '').replace('#version 300 es', '#version 450');
    s = s.replace('precision highp float;\n', 'precision highp float;\nlayout(set=0, binding=0) uniform U {\n' + loose.filter(m => m[1] !== 'sampler2D').map(m => `  ${m[1]} ${m[2]};`).join('\n') + '\n};\nlayout(set=0, binding=1) uniform texture2D uLutT;\nlayout(set=0, binding=2) uniform sampler uLutS;\n');
    s = s.replaceAll('texture(uLut,', 'texture(sampler2D(uLutT, uLutS),').replace('out vec4 outColor;', 'layout(location=0) out vec4 outColor;');
    const p = os.tmpdir() + '/julia-frag-check.frag'; fs.writeFileSync(p, s);
    let out = ''; try { out = execFileSync(naga, [p, '--input-kind', 'glsl', '--shader-stage', 'frag'], { encoding: 'utf8' }); } catch (e) { out = String(e.stdout || e.message); }
    ok(/Validation successful/.test(out), 'glsl: the fragment shader validates in naga (Vulkan GLSL form)', out.trim().split('\n').pop());
  } else console.log('SKIP  glsl: no ~/.cargo/bin/naga');
}
{
  let bad = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++; }
  ok(bad === 0, 'hash: 200 random scenes round-trip through the share link');
  const g = Array.from({ length: 400 }, (_, s) => sceneOf(s + 1)), d2 = g.filter(st => st.power === 2).length / g.length;
  ok(d2 > 0.55 && d2 < 0.8 && g.every(st => st.mode !== 'mandel' || !st.inset), 'guard: about 2/3 of random scenes keep d = 2; a Mandelbrot scene has no inset', `d = 2 in ${(100 * d2).toFixed(0)} %`);
  const V = SC.viewOf(sceneOf(3, { mode: 'mandel', dive: true, spot: 'seahorse' }), 30, 800, 600);
  ok(Math.abs(V.span - 2e-4) < 1e-6 && V.iters > 200, 'view: a dive reaches the spot depth at its midpoint and adds iterations', `span ${V.span.toExponential(2)}, iters ${V.iters}`);
}
{
  const { SHOTS } = await import('./saver.js');
  const plan = K.planShots(SHOTS, 5, 200);
  ok(SHOTS.length >= 6 && plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), `saver plan: ${SHOTS.length} shots, no repeats, 6-12 s cuts`);
}
{
  installDom({ w: 640, h: 400 });
  globalThis.TMP = { page() {}, creditLines: () => ['Julia Fractals by Matthias Müller'] };
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 640; view.height = 400; document.body.appendChild(view);
  document.createElement = (orig => t => { const e = orig(t); if (t === 'canvas') { e.getContext = kind => kind === '2d' ? (e._c || (e._c = fakeCtx(e.width, e.height))) : null; } return e; })(document.createElement);
  view.getContext = () => view._c || (view._c = fakeCtx(640, 400));
  await import('./main.js');
  const P = window.__julia;
  runRaf(12);
  ok(P.kit.playing && P.t > 0 && !P.gl, 'page: boots without WebGL (CPU path) and autoplays', `t ${P.t.toFixed(2)} s, ${P.kit.state.mode} ${P.kit.state.path}`);
  ok(view._c.bad === 0 && view._c.images > 0, 'page: draws with finite canvas calls');
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 9; k++) { window.snSaver.cut(); runRaf(2); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 10 && rep === 0 && labels.every(L => L.tex && !L.code), 'page saver: 10 cuts, no repeats, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver'), 'page saver: exit restores the page');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
