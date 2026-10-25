// ============================================================================
//  STRANDS · tests.mjs — node checks for the thread figures (no browser)
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/alpha-qudits/strands/tests.mjs
//  The jsdom part needs jsdom@24.1.3 on NODE_PATH (CONTRACT.md); without
//  it, that part is reported as skipped and the exit code is not changed.
//
//  Groups (grep -n "group(" tests.mjs):
//    quantum ... Eq. (1), Eq. (S1), MUBs, Corollary S3 (iii), Eq. (S2)
//    params .... normParams clamps and defaults
//    frames .... every scene at many times and widths on a recording 2D
//                context: no NaN, text inside the figure, text >= 11 px
//    steps ..... the timelines reach every step
//    text ...... analogy notes complete, stance words, TeX braces
//    shots ..... saver shots: fields, durations, 16:9 and 9:16 boxes
//    model ..... model-link: the stub and the real MODEL agree on slots, N
//    dom ....... jsdom: mount, controls, play(t), show, dispose
// ============================================================================
import * as Q from './quantum.js';
import { drawScene, normParams, SCENES, OBJECT_STAGES, termTiles, objectLayout } from './scenes.js';
import { THEMES } from './paint.js';
import { ANALOGY, STEPS, TEX } from './text.js';
import { SAVER_SHOTS, renderShot, shotRect } from './shots.js';
import { STUB, facts, loadModel } from './model-link.js';

let pass = 0, fail = 0, skip = 0;
const fails = [];
let cur = '';
function group(name) { cur = name; }
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; fails.push(`[${cur}] ${msg}`); }
}
const near = (a, b, e = 1e-12) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------------------
group('quantum');
for (let d1 = 1; d1 <= 4; d1++) for (let d2 = 1; d2 <= 4; d2++) {
  const w = Q.pairKet(d1, d2), m = Math.min(d1, d2), T = Q.terms(w);
  ok(T.length === m, `pairKet(${d1},${d2}) has ${m} terms`);
  ok(T.every(t => near(t.re, 1 / Math.sqrt(m)) && t.idx[0] === t.idx[1] && t.idx[0] < m), `pairKet(${d1},${d2}) terms are 1/sqrt(m) on matched directions of the support`);
  ok(near(Q.norm(w), 1), `pairKet(${d1},${d2}) is normalized`);
}
for (let d = 2; d <= 4; d++) {
  const s = Q.swapContraction(d);
  ok(near(s.ratio, 1 / d, 1e-14), `Eq. (S1): overlap is (1/${d})|w>_14 (got ${s.ratio})`);
  ok(near(s.termAmp, d ** -1.5, 1e-14), `Eq. (S1): each term is d^(-3/2) at d=${d}`);
  ok(s.residual < 1e-14, `Eq. (S1): the result is proportional to |w>_14 at d=${d}`);
}
for (const d of [2, 3]) {
  const B = Q.mubs(d);
  ok(B.length === d + 1, `d+1 = ${d + 1} MUBs at d=${d} (Corollary S3 (i))`);
  const ip = (a, b) => { let re = 0, im = 0; for (let i = 0; i < d; i++) { re += a[i][0] * b[i][0] + a[i][1] * b[i][1]; im += a[i][0] * b[i][1] - a[i][1] * b[i][0]; } return [re, im]; };
  let orth = true, unb = true;
  for (let x = 0; x < B.length; x++) for (let y = 0; y < B.length; y++) for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
    const [re, im] = ip(B[x].basis[i], B[y].basis[j]), m2 = re * re + im * im;
    if (x === y) { if (!near(m2, i === j ? 1 : 0, 1e-12)) orth = false; }
    else if (!near(m2, 1 / d, 1e-12)) unb = false;
  }
  ok(orth, `each MUB at d=${d} is orthonormal`);
  ok(unb, `MUBs at d=${d} are mutually unbiased (|<a|b>|^2 = 1/d)`);
  for (const b of B) {
    for (const df of [2, 3]) {
      const f1 = Q.farStates(d, df, b.basis), f2 = Q.farStatesByContraction(d, df, b.basis);
      let same = true;
      for (let k = 0; k < d; k++) for (let i = 0; i < df; i++) if (!near(f1[k].re[i], f2[k].re[i]) || !near(f1[k].im[i], f2[k].im[i])) same = false;
      ok(same, `farStates = (<e| x 1)|w> for (${d},${df}) basis ${b.name}`);
    }
  }
}
{
  const B3 = Q.mubs(3);
  const std = Q.farStates(3, 2, B3[0].basis);
  ok(near(std[2].norm, 0), 'qutrit-end read, standard basis: the third element gives the zero vector (Corollary S3 (iii))');
  ok(near(std[0].norm, Math.SQRT1_2) && near(std[1].norm, Math.SQRT1_2), 'the other two far states have length 1/sqrt 2');
  // a qutrit-end read reaches the whole qubit: the far states span C^2 for every basis
  for (const b of B3) {
    const f = Q.farStates(3, 2, b.basis);
    let best = 0;
    for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
      const det = [f[a].re[0] * f[c].re[1] - f[a].im[0] * f[c].im[1] - (f[a].re[1] * f[c].re[0] - f[a].im[1] * f[c].im[0]),
        f[a].re[0] * f[c].im[1] + f[a].im[0] * f[c].re[1] - (f[a].re[1] * f[c].im[0] + f[a].im[1] * f[c].re[0])];
      best = Math.max(best, Math.hypot(det[0], det[1]));
    }
    ok(best > 1e-6, `qutrit-end read in basis ${b.name} spans the qubit`);
  }
  // a qubit-end read never reaches the qutrit's third direction
  for (const b of Q.mubs(2)) {
    const f = Q.farStates(2, 3, b.basis);
    ok(f.every(s => near(s.re[2], 0) && near(s.im[2], 0)), `qubit-end read in basis ${b.name}: third qutrit direction stays 0 (end rule)`);
  }
  // the transpose identity: the far end gets the complex conjugate
  const fy = Q.farStates(2, 2, Q.mubs(2)[2].basis);
  ok(near(fy[0].im[1], -Math.SQRT1_2 / Math.SQRT2), 'far state of Y basis element is the conjugate (sign of the imaginary part flips)');
}
{
  const o = Q.objectState();
  ok(o.terms.length === 12, `Eq. (S2): 12 terms (got ${o.terms.length})`);
  ok(o.terms.every(t => near(t.re, 1 / (2 * Math.sqrt(3)), 1e-14) && near(t.im, 0)), 'Eq. (S2): each term is 1/(2 sqrt 3)');
  ok(near(o.norm, 1, 1e-14), 'Eq. (S2): the joint state is normalized by the factor sqrt 6');
  ok(o.terms.every(t => t.idx[0] === t.idx[1] && t.idx[2] === t.idx[3] && t.idx[4] === t.idx[5]), 'terms: Q1=Q2 (join), q1=q2 (qubit pair), Q3=f (unread link)');
  const J = Q.terms(o.joinOverlap);
  ok(J.length === 2 && J.every(t => near(t.re, 1 / Math.sqrt(2) / Math.sqrt(6), 1e-14)), 'two routes give |w2>_{q1q2}/sqrt 6 (Fig. S1(b))');
  const P = Q.pathAmplitudes();
  ok(P.length === 2 && P.every(p => near(p.amp, 1 / (2 * Math.sqrt(3)), 1e-14)), 'each route q1 -> q2 is 1/sqrt2 * 1/sqrt3 * 1/sqrt2 = 1/(2 sqrt 3)');
  ok(near(3 / Math.sqrt(3), Math.sqrt(3)) && near(2 / Math.sqrt(2), Math.SQRT2), 'weights: d * (1/sqrt d) = sqrt d');
}

// ---------------------------------------------------------------------------
group('params');
ok(normParams('nope').name === 'pair', 'unknown scene falls back to pair');
ok(normParams('pair', { d1: 9, d2: -3 }).params.d1 === 4 && normParams('pair', { d1: 9, d2: -3 }).params.d2 === 1, 'pair d clamps to 1..4');
ok(normParams('pair', { d: 3, unequal: true }).params.d2 === 2, 'pair { d: 3, unequal } is a qutrit and a qubit');
ok(normParams('swap', { d: 1 }).params.d === 2, 'swap d clamps to 2..4');
ok(normParams('read', { link: 'x', basis: 9 }).params.link === 'qutrit-qubit', 'read link falls back');
ok(normParams('read', { link: 'qubit-qubit', basis: 9 }).params.basis === 2, 'read basis clamps to d');
ok(normParams('object', { stage: 'zzz' }).params.stage === 'auto', 'object stage falls back to auto');
ok(normParams('shared', { k: 0 }).params.k === 1, 'shared k clamps');

// ---------------------------------------------------------------------------
// A recording 2D context: checks numbers and keeps text boxes.
function mockCtx() {
  const st = { font: '12px sans', textAlign: 'left' };
  const log = { bad: [], texts: [], calls: 0 };
  const chk = (name, args) => { log.calls++; for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) log.bad.push(`${name}(${args.join(',')})`); };
  const grad = { addColorStop(o, c) { if (!Number.isFinite(o) || o < 0 || o > 1) log.bad.push('colorstop ' + o); if (/NaN|undefined/.test(c)) log.bad.push('colour ' + c); } };
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'log') return log;
      if (k === 'measureText') return s => ({ width: String(s).length * (parseFloat(/(\d+(\.\d+)?)px/.exec(st.font)[1]) * 0.56) });
      if (k === 'fillText') return (s, x, y) => {
        chk('fillText', [x, y]);
        const size = parseFloat(/(\d+(\.\d+)?)px/.exec(st.font)[1]);
        const w = String(s).length * size * 0.5;
        const x0 = st.textAlign === 'center' ? x - w / 2 : st.textAlign === 'right' ? x - w : x;
        log.texts.push({ s, x0, x1: x0 + w, y, size });
      };
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return (...a) => { chk(k, a); return grad; };
      if (k in st) return st[k];
      return (...a) => { chk(String(k), a); };
    },
    set(_, k, v) {
      if ((k === 'strokeStyle' || k === 'fillStyle') && /NaN|undefined/.test(String(v))) log.bad.push(`${k}=${v}`);
      if ((k === 'lineWidth' || k === 'globalAlpha') && !Number.isFinite(v)) log.bad.push(`${k}=${v}`);
      st[k] = v; return true;
    },
  });
  return ctx;
}

group('frames');
const CASES = [
  ['pair', { d1: 3, d2: 2 }], ['pair', { d1: 4, d2: 4 }], ['pair', { d1: 1, d2: 3 }], ['pair', { d1: 2, d2: 4 }],
  ['swap', { d: 2 }], ['swap', { d: 3 }], ['swap', { d: 4 }],
  ['read', { link: 'qutrit-qubit', basis: 0 }], ['read', { link: 'qutrit-qubit', basis: 3 }], ['read', { link: 'qubit-qutrit', basis: 2 }], ['read', { link: 'qubit-qubit', basis: 1 }],
  ['shared', { k: 1 }], ['shared', { k: 2 }], ['shared', { k: 3 }], ['shared', { k: 4, copies: 1 }],
  ...OBJECT_STAGES.map(stage => ['object', { stage }]), ['object', { stage: 'auto' }],
];
const ASP = { pair: [0.6, 0.98], swap: [0.6, 0.95], read: [0.64, 1.22], shared: [0.72, 1.02], object: [0.66, 1.3] };
const WIDTHS = [296, 328, 360, 640, 860];
const TIMES = [0, 0.7, 1.9, 2.6, 3.3, 4.4, 5.1, 6.2, 7.7, 9.3, 10.9, 12.4, 14.2, 18.5, 23.1, 30.2, 34.4];
let frames = 0, badFrames = 0, outside = new Set(), small = new Set();
const facts0 = facts(null);
for (const th of ['dark', 'light']) for (const [scene, params] of CASES) for (const w of WIDTHS) {
  const h = Math.round(Math.max(260, Math.min(620, w * ASP[scene][w < 480 ? 1 : 0])));
  const r = { x: 0, y: 0, w, h };
  for (const t of TIMES) {
    const g = mockCtx();
    let info;
    try { info = drawScene(g, scene, params, t, r, { th: THEMES[th], live: { plucks: [{ t0: t - 0.3, amp: 12 }] }, facts: facts0 }); }
    catch (e) { badFrames++; fails.push(`[frames] ${scene} ${JSON.stringify(params)} w=${w} t=${t} threw ${e.stack}`); continue; }
    frames++;
    const L = g.log;
    if (L.bad.length) { badFrames++; if (badFrames < 5) fails.push(`[frames] ${scene} w=${w} t=${t} bad: ${L.bad.slice(0, 3).join(' | ')}`); }
    if (!(L.calls > 20)) { badFrames++; fails.push(`[frames] ${scene} w=${w} t=${t} drew almost nothing`); }
    if (!(info && Number.isInteger(info.step) && info.step >= 0 && info.step < info.stepCount)) { badFrames++; fails.push(`[frames] ${scene} bad step ${JSON.stringify(info)}`); }
    for (const tx of L.texts) {
      if (tx.x0 < r.x - 3 || tx.x1 > r.x + r.w + 3 || tx.y < r.y || tx.y > r.y + r.h + 2) outside.add(`${scene} w=${w}: "${tx.s}" [${tx.x0.toFixed(0)}, ${tx.x1.toFixed(0)}] y=${tx.y.toFixed(0)}`);
      if (tx.size < 11) small.add(`${scene}: "${tx.s}" ${tx.size}px`);
    }
  }
}
ok(badFrames === 0, `every frame draws with finite numbers (${frames} frames, ${badFrames} bad)`);
ok(outside.size === 0, `canvas text stays inside the figure at widths ${WIDTHS.join(', ')} (${outside.size} out): ${[...outside].slice(0, 6).join(' ; ')}`);
ok(small.size === 0, `canvas text is 11 px or more: ${[...small].slice(0, 4).join(' ; ')}`);
// object layout: the copies keep their order and stay inside the figure
for (const w of [328, 860]) {
  const r = { x: 0, y: 0, w, h: w * (w < 480 ? 1.3 : 0.66) };
  for (const st of OBJECT_STAGES) {
    const L = objectLayout(r, st, 1);
    ok(L.q1.x < L.Q1.x && L.Q1.x < L.Q2.x && L.Q2.x < L.q2.x, `object ${st} w=${w}: q1 < Q1 < Q2 < q2`);
    ok(L.f.y < r.h * 0.9, `object ${st} w=${w}: f stays above the foot lines`);
  }
  const tiles = termTiles(r, 12);
  ok(tiles.every(b => b.x >= 0 && b.x + b.w <= r.w && b.y + b.h <= r.h), `term tiles fit at w=${w}`);
  const Lt = objectLayout(r, 'terms', 1);
  ok(Lt.f.y + 20 < tiles[0].y - 12, `terms w=${w}: tiles sit below f`);
}

// ---------------------------------------------------------------------------
group('steps');
for (const [scene, params, period, n] of [['swap', { d: 3 }, SCENES.swap.period, 4], ['shared', { k: 3 }, SCENES.shared.period, 3], ['object', { stage: 'auto' }, SCENES.object.period, 5]]) {
  const seen = new Set();
  for (let t = 0; t < period; t += 0.25) seen.add(drawScene(mockCtx(), scene, params, t, { x: 0, y: 0, w: 640, h: 420 }, { th: THEMES.dark, live: {}, facts: facts0 }).step);
  ok(seen.size === n, `${scene}: the loop reaches all ${n} steps (saw ${[...seen].join(',')})`);
  ok(STEPS[scene].length === n, `${scene}: STEPS has ${n} captions`);
}
{
  const a = drawScene(mockCtx(), 'object', { stage: 'terms' }, 5, { x: 0, y: 0, w: 640, h: 420 }, { th: THEMES.dark, live: {}, facts: facts0, focus: 7 });
  ok(a.term === 7, 'object terms: focus picks the term');
}

// ---------------------------------------------------------------------------
group('text');
const NAMES = ['pair', 'swap', 'read', 'shared', 'object'];
for (const n of NAMES) {
  const a = ANALOGY[n];
  ok(a && a.title && a.right.length > 120 && a.breaks.length > 80 && a.source, `${n}: analogy note has title, right, breaks, source`);
  ok(typeof TEX[n] === 'string' && TEX[n].length > 10, `${n}: TeX line`);
  let depth = 0, neg = false;
  for (const ch of TEX[n].replace(/\\[{}]/g, '')) { if (ch === '{') depth++; if (ch === '}') depth--; if (depth < 0) neg = true; }
  ok(depth === 0 && !neg, `${n}: TeX braces balance`);
}
{
  const all = JSON.stringify([ANALOGY, STEPS]);
  ok(!/\bproves?\b|\bconfirms?\b|\bderives? alpha\b/i.test(all), 'stance: no "proves", "confirms" or "derives alpha" in the figure text');
  ok(!/137|0\.0072/.test(all), 'figure text does not state the alpha value (COMPARE owns the number)');
  ok(/paper proposes|paper says|in the paper/i.test(all), 'figure text attributes claims to the paper');
}

// ---------------------------------------------------------------------------
group('shots');
ok(SAVER_SHOTS.length >= 8, `at least 8 saver shots (${SAVER_SHOTS.length})`);
ok(new Set(SAVER_SHOTS.map(s => s.id)).size === SAVER_SHOTS.length, 'shot ids are unique');
for (const s of SAVER_SHOTS) {
  ok(NAMES.includes(s.scene) && s.seconds >= 5 && s.seconds <= 12 && s.label && s.tex, `shot ${s.id}: scene, 5-12 s, label, tex`);
  for (const box of [{ x: 0, y: 140, w: 1920, h: 700 }, { x: 0, y: 420, w: 1080, h: 900 }, { x: 0, y: 0, w: 360, h: 640 }]) {
    const r = shotRect(s, box);
    ok(r.x >= box.x - 1e-9 && r.y >= box.y - 1e-9 && r.x + r.w <= box.x + box.w + 1e-9 && r.y + r.h <= box.y + box.h + 1e-9, `shot ${s.id} fits box ${box.w}x${box.h}`);
    const g = mockCtx();
    for (const t of [0, s.seconds / 2, s.seconds]) renderShot(g, s, t, box, { calm: true });
    ok(g.log.bad.length === 0, `shot ${s.id} renders in box ${box.w}x${box.h}`);
  }
}

// ---------------------------------------------------------------------------
group('model');
{
  const f = facts(null);
  ok(f.slots.map(s => s.letters).join() === '8,3,8,3', 'stub slots (8, 3, 8, 3) letters');
  ok(f.N === 24 * 36 * 36 && f.N === 31104, 'stub N = 24 * 36 * 36 = 31104 (Eq. (4))');
  ok(STUB.readoutDimension() === 31104, 'stub readoutDimension');
  const link = await loadModel();
  if (link.real) {
    const g = facts(link);
    ok(g.slots.map(s => `${s.id}:${s.letters}`).join() === 'Q1:8,q1:3,Q2:8,q2:3', 'MODEL slots match the stub');
    ok(g.N === 31104, 'MODEL readout dimension matches');
    ok(g.records === null || g.records === 172, `MODEL records 172 (got ${g.records})`);
  } else {
    skip++; console.log('  skip: ../model/index.js not loaded; the stub is in use');
  }
}

// ---------------------------------------------------------------------------
group('dom');
let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch (e) {
  try { const { createRequire } = await import('node:module'); ({ JSDOM } = createRequire(import.meta.url)('jsdom')); } catch (e2) { JSDOM = null; }
}
if (!JSDOM) {
  skip++; console.log('  skip: jsdom not found (install jsdom@24.1.3 and set NODE_PATH)');
} else {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="h" style="width:360px"></div></body></html>', { pretendToBeVisual: true });
  const { window } = dom;
  const ctxs = [];
  window.HTMLCanvasElement.prototype.getContext = function () { const c = mockCtx(); ctxs.push(c); return c; };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 360; } });
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  const G = globalThis;
  const saved = { window: G.window, document: G.document };
  G.window = window; G.document = window.document;
  try {
    const { createStrands } = await import('./index.js');
    const host = window.document.getElementById('h');
    const v = createStrands(host, { scene: 'pair', autoplay: false });
    ok(['show', 'play', 'resize', 'dispose'].every(k => typeof v[k] === 'function'), 'API: show, play, resize, dispose');
    ok(['pause', 'resume', 'seek'].every(k => typeof v[k] === 'function'), 'API: pause, resume, seek (NOTES.md)');
    ok(v.scenes.join() === NAMES.join(), 'scenes list');
    ok(Array.isArray(v.saverShots) && v.saverShots.length === SAVER_SHOTS.length, 'saverShots on the instance');
    ok(host.querySelector('canvas') && parseInt(v.canvas.style.height, 10) >= 260, 'canvas mounted with a height');
    ok(window.document.getElementById('aq-strands-css').textContent.includes('min-height:44px'), 'buttons are 44 px targets');
    for (const n of NAMES) {
      v.show(n, {});
      const bs = host.querySelectorAll('.aq-st-controls button');
      ok(bs.length >= 2, `${n}: controls (${bs.length})`);
      for (const b of bs) b.click();
      ok(v.scene === n, `${n}: still on the scene after every button`);
      for (const t of [0.5, 1, 3, 9]) v.play(t);
      ok(v.time > 0 && Number.isFinite(v.time), `${n}: play(t) advances the scene clock (${v.time})`);
      ok(host.querySelector('.aq-st-step').textContent.length > 10, `${n}: step caption`);
      ok(host.querySelector('.aq-st-analogy').textContent.includes('Breaks'), `${n}: analogy note`);
    }
    v.play(100);
    v.show('swap', { d: 3 });
    v.play(103.5);
    ok(Math.abs(v.time - 3.5) < 1e-9, `show() restarts the clock under CORE's play(t) (time ${v.time})`);
    v.seek(9); ok(v.step.step === 3, 'seek(9) on swap shows the result step');
    v.pause(); v.resume();
    const bad = ctxs.reduce((a, c) => a + c.log.bad.length, 0);
    ok(bad === 0, `no bad draw calls in the DOM run (${bad})`);
    v.dispose();
    ok(!host.querySelector('.aq-strands'), 'dispose removes the figure');
    const r2 = createStrands(host, { scene: 'object', reduced: true });
    ok(r2.time > 0, 'reduced motion shows a still frame, not t = 0');
    r2.dispose();
  } catch (e) { fail++; fails.push('[dom] threw ' + e.stack); }
  finally { G.window = saved.window; G.document = saved.document; window.close(); }
}

console.log(`strands: ${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) { for (const f of fails.slice(0, 40)) console.log('  FAIL ' + f); process.exitCode = 1; }
