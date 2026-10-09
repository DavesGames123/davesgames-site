// ============================================================================
//  MUJOCO LAB  ·  explain/tests.mjs — node checks of the explainer
// ----------------------------------------------------------------------------
//  node stella-nova/pages/mujoco-lab/explain/tests.mjs
//  No browser and no network. The jsdom parts need jsdom on NODE_PATH; they
//  print SKIP when it is missing.
//
//  GREP MAP
//    "── figures"        each figure: make, tick, draw into a recording ctx
//    "── physics"        the claims that the captions make, checked
//    "── heap"           make and dispose every figure, WASM heap stable
//    "── TeX"            every equation typesets with the vendored MathJax
//    "── jsdom boot"     mountExplainer in a jsdom page, 0 errors
// ============================================================================

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMuJoCo, heapBytes } from '../core/engine.js';
import { FIGS, solimpCurve, convergence, energyRun, dropSeries, benchmark, PUSH } from './figs.js';
import { SECTIONS, REFS, allTex, mountExplainer } from './index.js';
import { fakeCtx } from '../../../widgets/sim-kit/test/stubs.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`); }

const mj = await loadMuJoCo();

// ── figures ────────────────────────────────────────────────────────────────
for (const id in FIGS) {
  const spec = FIGS[id];
  let F, err = null;
  try {
    F = spec.make(mj);
    if (F.done) while (!F.done()) F.tick(0.016); else for (let i = 0; i < 30; i++) F.tick(1 / 30);
    for (const w of [760, 360]) { const c = fakeCtx(w, spec.height); F.draw(c, w, spec.height, (await import('./figs.js')).PALETTE); if (!c.calls || c.bad) throw new Error(`${w}px: ${c.calls} calls, ${c.bad} non-finite`); }
    for (const c of F.controls || []) { F.set(c.key, c.max * (c.scale || 1)); F.tick(0.016); F.set(c.key, c.value * (c.scale || 1)); }
    F.dispose();
  } catch (e) { err = e; }
  ok(!err, `figure ${id}: make, tick, draw (760 and 360 px), controls, dispose`, err ? err.message : '');
}

// ── physics ────────────────────────────────────────────────────────────────
{
  const F = FIGS.coords.make(mj);
  const a = F.info();
  const M = a.M, sym = Math.abs(M[1] - M[2]) < 1e-12, pd = M[0] > 0 && M[0] * M[3] - M[1] * M[2] > 0;
  F.tick(0.4); const b = F.info();
  ok(a.nq === 2 && a.nv === 2 && sym && pd, 'coords: M(q) from mj_fullM is 2 x 2, symmetric, positive definite', M.map(v => v.toFixed(4)).join(' '));
  ok(Math.abs(a.M[1] - b.M[1]) > 1e-3 && Math.abs(a.M[3] - b.M[3]) < 1e-9, 'coords: the off-diagonal changes with q2, M22 does not', `${a.M[1].toFixed(4)} -> ${b.M[1].toFixed(4)}`);
  F.dispose();
}
{
  const F = FIGS.chain.make(mj); const r = [];
  for (const n of [1, 12, 40]) { F.set('n', n); r.push(F.info()); }
  ok(r.every(I => I.nv === I.n && I.maximal === 6 * I.n && I.rows === 5 * I.n), 'chain: nv = links; maximal = 6 n + 5 n rows', r.map(I => `${I.n}:${I.nv}/${I.maximal}+${I.rows}`).join(' '));
  F.dispose();
}
{
  const peak = s => Math.max(...s.map(x => x[2])), reb = s => Math.max(...s.filter(x => x[0] > 0.45).map(x => x[1]));
  const soft = dropSeries(mj, 0.05, 1), stiff = dropSeries(mj, 0.005, 1), bouncy = dropSeries(mj, 0.02, 0.1), damped = dropSeries(mj, 0.02, 1);
  ok(peak(stiff) < peak(soft), 'contact: a shorter solref time constant gives less overlap', `${peak(stiff).toFixed(2)} mm < ${peak(soft).toFixed(2)} mm`);
  ok(reb(bouncy) > reb(damped) + 0.01, 'contact: a lower damping ratio bounces higher', `${(reb(bouncy) * 100).toFixed(1)} cm > ${(reb(damped) * 100).toFixed(1)} cm`);
  const rest = damped[damped.length - 1][2];
  ok(rest > 0 && rest < 1, 'contact: the resting ball overlaps the floor a little (soft constraint)', `${rest.toFixed(3)} mm`);
}
{
  const s = [0.9, 0.95, 0.001, 0.5, 2], s2 = [0.2, 0.9, 0.01, 0.3, 6];
  let mono = true; for (let i = 1; i <= 100; i++) if (solimpCurve(i * 1e-4, s2) < solimpCurve((i - 1) * 1e-4, s2) - 1e-12) mono = false;
  ok(solimpCurve(0, s) === 0.9 && solimpCurve(0.001, s) === 0.95 && solimpCurve(1, s) === 0.95 && Math.abs(solimpCurve(0.0005, s) - 0.925) < 1e-12 && Math.abs(solimpCurve(0.003, s2) - (0.2 + 0.3 * 0.7)) < 1e-12 && mono,
    'impedance: d(0) = d0, d(width) = dw, d(mid) = d0 + mid (dw - d0), monotonic');
}
{
  const F = FIGS.cones.make(mj), run = a => { F.setAngle(a); for (let i = 0; i < 20; i++) F.stepFor(0.05); return F.info(); };
  const ax = run(0), diag = run(Math.PI / 4), ax2 = run(Math.PI / 2);
  const p = diag[0], e = diag[1];
  ok(ax.every(o => o.speed < 0.02) && ax2.every(o => o.speed < 0.02), `cones: a push of ${PUSH} m g along a tangent axis: both cones stick`, ax.map(o => o.speed.toFixed(3)).join(' '));
  ok(p.speed > 0.3 && e.speed < 0.02, 'cones: along the diagonal the pyramidal box slides, the elliptic box sticks', `${p.speed.toFixed(3)} / ${e.speed.toFixed(3)} m/s`);
  const l1 = Math.abs(p.friction[0]) + Math.abs(p.friction[1]);
  ok(Math.abs(l1 - 0.5) < 0.03, 'cones: sliding friction lies on the pyramid edge |fx| + |fy| = mu fN', `${l1.toFixed(3)}`);
  F.dispose();
}
{
  const C = convergence(mj, 1), n = Object.fromEntries(C.runs.map(r => [r.solver, r.niter]));
  ok(n.Newton < n.CG && n.CG < n.PGS && C.runs.every(r => r.improvement.length === r.niter && r.niter < 200), 'solvers: all converge; Newton < CG < PGS iterations', `${n.Newton} / ${n.CG} / ${n.PGS}, ${C.nefc} rows`);
}
{
  const e = energyRun(mj, 'Euler', 0.002), r = energyRun(mj, 'RK4', 0.002);
  ok(r.max * 100 < e.max, 'integrators: RK4 energy error is 100 times below Euler', `${r.max.toExponential(1)} vs ${e.max.toExponential(1)}`);
}
{
  const F = FIGS.actuators.make(mj); let worst = 0, coup = 0, rope = 0, lift = -1;
  for (let i = 0; i < 400; i++) {
    F.tick(0.02); const I = F.info();
    if (i > 50) worst = Math.max(worst, Math.abs(I.ctrl - I.q[0]));
    coup = Math.max(coup, Math.abs(I.q[1] + I.q[0])); rope = Math.max(rope, I.ten); lift = Math.max(lift, I.q[2]);
  }
  ok(worst < 0.1, 'actuators: the position servo tracks its target', `worst error ${worst.toFixed(3)} rad`);
  ok(coup < 0.02, 'actuators: the equality keeps q_mirror = -q_drive', `worst ${coup.toFixed(4)} rad`);
  ok(rope < 1.245 && lift > 0.25, 'actuators: the rope tendon stops at its range and lifts the weight', `max length ${rope.toFixed(4)} m, lift ${lift.toFixed(3)} m`);
  F.dispose();
}
{
  const F = FIGS.sensors.make(mj); F.tick(0.01);
  const fall = F.info(); let touch = 0;
  for (let i = 0; i < 150; i++) { F.tick(0.02); touch = Math.max(touch, F.info().touch[0]); }
  ok(Math.abs(fall.acc[2]) < 0.05 && touch > 1, 'sensors: accelerometer reads 0 in free fall; touch reads the impact', `acc ${fall.acc[2].toFixed(3)}, touch max ${touch.toFixed(1)} N`);
  F.dispose();
}
{
  const B = benchmark(mj, 20);
  ok(B.length === 3 && B.every(b => b.stepsPerSec > 0 && Number.isFinite(b.usPerStep)), 'speed: benchmark measures three models', B.map(b => `${b.name.split(',')[0]} ${b.usPerStep.toFixed(1)} us`).join('; '));
}

// ── heap ───────────────────────────────────────────────────────────────────
{
  const once = () => { for (const id in FIGS) { const F = FIGS[id].make(mj); F.tick(0.016); F.dispose(); } };
  once(); const h0 = heapBytes();
  for (let i = 0; i < 5; i++) once();
  const h1 = heapBytes();
  ok(h1 === h0, 'heap: five make/dispose rounds of every figure do not grow the WASM heap', `${(h0 / 2 ** 20).toFixed(1)} -> ${(h1 / 2 ** 20).toFixed(1)} MiB`);
}

// ── structure ──────────────────────────────────────────────────────────────
{
  const ids = SECTIONS.map(s => s.id);
  const need = ['coords', 'joint-space', 'contacts', 'cones', 'solvers', 'integrators', 'actuators', 'sensors', 'fast', 'history'];
  ok(need.every(x => ids.includes(x)), 'sections: all ten topics present', ids.join(' '));
  const cites = SECTIONS.flatMap(s => [...s.html.matchAll(/href="#mx-ref-([^"]+)"/g)].map(m => m[1]));
  ok(cites.length > 0 && cites.every(c => REFS.some(r => r.id === c)), 'citations: every [n] points at a reference');
  ok(REFS.some(r => r.doi === '10.1109/IROS.2012.6386109') && REFS.some(r => r.url === 'https://github.com/google-deepmind/mujoco'), 'citations: Todorov, Erez, Tassa 2012 (DOI) and the repo are listed');
  ok(SECTIONS.every(s => !s.fig || FIGS[s.fig]), 'sections: each figure id exists');
}

// ── TeX ────────────────────────────────────────────────────────────────────
let JSDOM = null;
try { JSDOM = createRequire((process.env.NODE_PATH || '/nonexistent') + '/')('jsdom').JSDOM; } catch (e) { JSDOM = null; }
if (!JSDOM) console.log('SKIP  TeX and jsdom boot: jsdom not on NODE_PATH');
else {
  const eqs = allTex();
  const lib = here + '../../../lib/sci-math.js';
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: pathToFileURL(here + 'index.html').href, runScripts: 'dangerously', resources: 'usable' });
  const w = dom.window;
  const src = readFileSync(lib, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(lib).href)).replace(/^export /gm, '');
  w.eval(`(function () { ${src}\n window.__sm = { typeset, loadMath }; })();`);
  const els = eqs.map(() => w.document.body.appendChild(w.document.createElement('div')));
  const t0 = performance.now();
  const all = Promise.all(eqs.map(([, tex, display], i) => w.__sm.typeset(els[i], tex, { display })));
  const out = await Promise.race([all, new Promise(r => setTimeout(() => r(null), 120000))]);
  const bad = out ? eqs.filter((e, i) => !out[i] || els[i].classList.contains('raw') || !els[i].querySelector('svg')) : eqs;
  ok(!!out && !bad.length, 'TeX: every equation typesets (lib/sci-math.js + vendor MathJax 3.2.2, jsdom)',
    bad.length ? `${bad.length} raw: ` + bad.slice(0, 3).map(b => b[0] + ' ' + b[1]).join(' | ') : `${eqs.length} equations (${eqs.filter(e => e[2]).length} display), ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  w.close();
}

// ── jsdom boot ─────────────────────────────────────────────────────────────
if (JSDOM) {
  const errors = [];
  const { VirtualConsole } = createRequire((process.env.NODE_PATH) + '/')('jsdom');
  const vc = new VirtualConsole();
  vc.on('error', e => errors.push(String(e && e.message || e))); vc.on('jsdomError', e => errors.push(String(e && e.message || e)));
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main><div id="explain"></div></body></html>', { url: pathToFileURL(here + 'index.html').href, pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, ctxs = [];
  w.HTMLCanvasElement.prototype.getContext = function () { return this._c || (this._c = (ctxs.push(fakeCtx(this.width, this.height)), ctxs[ctxs.length - 1])); };
  const cerr = console.error; console.error = (...a) => { errors.push(a.join(' ')); };
  let ex;
  try {
    ex = mountExplainer(w.document.getElementById('explain'), { mj });
    await ex.drawAll();
    await new Promise(r => setTimeout(r, 400));   // the rAF loop runs (pretendToBeVisual)
  } catch (e) { errors.push('mount: ' + e.message); }
  console.error = cerr;
  const d = w.document;
  const nFig = d.querySelectorAll('.mx-fig canvas').length, nEq = d.querySelectorAll('.mx-eq[data-tex]').length, nIn = d.querySelectorAll('.mx-m[data-tex]').length;
  const figErr = ex ? ex.figs.filter(f => f.error || !f.F).map(f => f.id + ': ' + (f.error ? f.error.message : 'not built')) : ['no explainer'];
  ok(!errors.length && !figErr.length, 'jsdom boot: mountExplainer runs with 0 errors and builds every figure', errors.concat(figErr).slice(0, 3).join(' | ') || `${nFig} figures, ${nEq} display + ${nIn} inline equations`);
  ok(ctxs.length === nFig && ctxs.every(c => c.calls > 0 && c.bad === 0), 'jsdom boot: every canvas drew, no NaN or Infinity in any draw call', ctxs.map(c => c.calls).join(' '));
  ok(d.querySelectorAll('.mx-toc a').length === SECTIONS.filter(s => !s.sub).length && d.querySelectorAll('.mx-refs li').length === REFS.length, 'jsdom boot: contents links and reference list');
  ok(d.querySelectorAll('.mx-ctl input[type=range]').length === 4 && d.querySelectorAll('.mx-ctl button').length === 2, 'jsdom boot: sliders and buttons', `${d.querySelectorAll('.mx-ctl input').length} sliders`);
  const h0 = heapBytes(); ex && ex.dispose();
  ok(!d.querySelector('.mx-explain') && ex.figs.every(f => !f.F), 'jsdom boot: dispose removes the section and frees every figure', `heap ${(h0 / 2 ** 20).toFixed(1)} MiB`);
  w.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
