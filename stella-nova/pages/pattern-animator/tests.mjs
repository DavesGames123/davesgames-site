// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  tests.mjs — node tests (no DOM)
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/pattern-animator/tests.mjs
//  1. curves: each curve is periodic, -1 at x = 0 and +1 at x = 0.5 (noise
//     near that); wrapT(L) = 0; cleanAnim keeps every value in range.
//  2. every pattern x every channel: the frame at t = 0 differs from the
//     frame at half a period (where the channel applies to the pattern),
//     and the frame at t = L equals the frame at t = 0. Each pattern also
//     has a family motion (randomAnim) that animates and loops.
//  3. presets: each names a real pattern and palette, animates, loops
//     (also with its morph), and starts dense (density at the default
//     unless the frame budget is lower).
//  4. determinism: the same state gives the same geometry and frames;
//     another seed gives other ones.
//  5. frame budget: the motion time of each preset on the desktop profile
//     (200 000 points) and the phone profile (60 000 points), and the
//     draw calls and points of render.js on a recording context.
//  6. governor: slow frames step down, fast frames step back up, a quick
//     step back down doubles the wait, gaps are not samples.
//  7. export: framePlan frame count and times for a loop; GIF bytes decode
//     back to the same frames with delays that add up to the length; ZIP
//     entries and CRC; even video sizes; the video type pick.
//  8. cover: a turned or moved view stays inside the geometry board.
//  9. saver framing: boardForBand and boxInBand for 16:9 and 9:16 views.
//  Prints one line per failure and a summary; exits 1 on any failure.
// ============================================================================
import { PATTERNS, byId } from '../pattern-designer/patterns/index.js';
import { runJob } from '../pattern-designer/worker.js';
import { defaults, makeRng } from '../pattern-designer/engine.js';
import { PALETTES, paletteById } from '../pattern-designer/palettes.js';
import { applyMode } from '../pattern-designer/export.js';
import { DENSITY, densityDefault } from '../pattern-designer/density.js';
import { CHANNELS, CHANNEL_IDS, CURVES, animDefaults, cleanAnim, curveValue, wrapT, pack, compile, makeFrame, frame, coverFor, pairUp, materialise, colourTable, geoInfo, drawOrder, Q } from './motion.js';
import { PRESETS, presetAnim, randomAnim, FAMILY_POOL } from './presets.js';
import { buildScene, makePlayer, BUDGET } from './scene.js';
import { drawFrame, cls } from './render.js';
import { Governor, LEVELS, GOV } from './governor.js';
import { framePlan, GifWriter, gifPalette, quantize, zipStore, crc32 } from './encode.js';
import { exportDims, videoType } from './exporter.js';
import { boardForBand, boxInBand } from './saver.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const run = async j => runJob(j);
const VIEW = { W: 1000, H: 1250 };

// ── 1. curves ──────────────────────────────────────────────────────────────
for (const k in CURVES) {
  const a = curveValue(k, 0, 1.3, 4.1), b = curveValue(k, 0.5, 1.3, 4.1), c = curveValue(k, 0.999999, 1.3, 4.1);
  ok(Math.abs(a - c) < 1e-3, `curve ${k} is periodic (${a.toFixed(4)} vs ${c.toFixed(4)})`);
  ok(b - a > 0.9, `curve ${k}: half a period is far from the start (${a.toFixed(2)} -> ${b.toFixed(2)})`);
  let lo = 9, hi = -9; for (let i = 0; i <= 400; i++) { const v = curveValue(k, i / 400, 2.2, 5.5); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok(lo >= -1.0001 && hi <= 1.0001, `curve ${k} stays in [-1, 1] (${lo.toFixed(3)}..${hi.toFixed(3)})`);
}
ok(wrapT(8, 8) === 0 && wrapT(16, 8) === 0 && Math.abs(wrapT(9, 8) - 1) < 1e-12 && wrapT(-1, 8) === 7, 'wrapT folds the time into the loop');
{
  const a = animDefaults(8); a.ch.spin = { on: 1, curve: 'zzz', amount: 9999, freq: -5, cycles: 3.7, phase: 4 }; a.L = 999;
  const c = cleanAnim(a);
  ok(c.ch.spin.curve === CHANNELS.spin.curve && c.ch.spin.amount === CHANNELS.spin.amount[1] && c.ch.spin.freq === CHANNELS.spin.freq[0] && c.ch.spin.cycles === 4 && c.ch.spin.phase === 1 && c.L === 60, 'cleanAnim clamps every value');
}

// ── 2. every pattern x every channel ───────────────────────────────────────
// A field-ready geometry at D 1 (fast) on a 4:5 board, then each channel
// alone with its defaults and 1 cycle in a loop of 8 s.
const pal4 = paletteById('bone');
const sameFrame = (A, B, eps = 1e-3) => {
  for (const k of ['pts', 'cx', 'cy', 'cr', 'sc']) { const a = A[k], b = B[k]; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps) return false; }
  for (const k of ['fc', 'kc']) { const a = A[k], b = B[k]; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; }
  for (let i = 0; i < 6; i++) if (Math.abs(A.M[i] - B.M[i]) > 1e-6) return false;
  if (!!A.dash !== !!B.dash) return false;
  if (A.dash && Math.abs(A.dash[2] - B.dash[2]) > 1e-6) return false;
  return true;
};
const snap = F => ({ pts: F.pts.slice(), cx: F.cx.slice(), cy: F.cy.slice(), cr: F.cr.slice(), sc: F.sc.slice(), fc: F.fc.slice(), kc: F.kc.slice(), M: F.M.slice(), dash: F.dash ? F.dash.slice() : null });
// Does a channel apply to this geometry?
function applies(id, G) {
  let lines = 0, nonCircle = 0;
  for (let i = 0; i < G.n; i++) { if (G.s[i] >= 0) lines++; if (G.t[i] !== 1) nonCircle++; }
  if (id === 'dash') return lines > 0;
  if (id === 'spin') return nonCircle > 0;
  return G.n > 0;
}
let combos = 0, moved = 0, skipped = [];
const famMoved = {};
for (const p of PATTERNS) {
  const res = runJob({ pat: p.id, P: defaults(p), seed: 7, W: VIEW.W, H: VIEW.H, mods: [], D: 1, detail: 0.3 });
  const G = pack(applyMode(res.items, 'auto'), { W: VIEW.W, H: VIEW.H, seed: 7, step: 1000 / 90 });
  ok(G.n > 0 && G.nP >= 0, `${p.id} packs (${G.n} elements, ${G.nP} points)`);
  const F = makeFrame(G);
  for (const id of CHANNEL_IDS) {
    const a = animDefaults(8); a.ch[id].on = 1;
    const C = compile(a, VIEW, G, pal4.ink.length, 7), per = 8 / a.ch[id].cycles;
    const f0 = snap(frame(G, C, 0, F)), fh = snap(frame(G, C, per / 2, F)), fq = snap(frame(G, C, per / 4, F)), fL = snap(frame(G, C, 8, F));
    combos++;
    ok(sameFrame(f0, fL), `${p.id} + ${id}: frame at t = L equals frame at t = 0`);
    if (!applies(id, G)) { skipped.push(`${p.id}/${id}`); continue; }
    const anim = !sameFrame(f0, fh) || !sameFrame(f0, fq);
    ok(anim, `${p.id} + ${id}: the frame at half a period differs from t = 0`);
    if (anim) moved++;
  }
  // The family motion (a fixed random source per pattern).
  const fa = randomAnim(makeRng(11, p.id), p, { morph: false, geo: geoInfo(G) });
  ok(fa && Object.values(fa.ch).some(s => s.on) && (FAMILY_POOL[p.family] || []).length > 0, `${p.id} has a family motion`);
  const C = compile(fa, VIEW, G, pal4.ink.length, 7);
  const f0 = snap(frame(G, C, 0, F)), fL = snap(frame(G, C, fa.L, F));
  let any = false;
  for (const id in fa.ch) { const s = fa.ch[id]; if (!s.on) continue; for (const u of [2, 4]) if (!sameFrame(f0, snap(frame(G, C, fa.L / s.cycles / u, F)))) any = true; }
  ok(any, `${p.id}: the family motion animates`);
  ok(sameFrame(f0, fL), `${p.id}: the family motion loops`);
  famMoved[p.family] = (famMoved[p.family] || 0) + (any ? 1 : 0);
}
console.log(`patterns x channels: ${combos} pairs loop; ${moved} move at half a period; ${skipped.length} do not apply (${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? ', ...' : ''})`);
ok(PATTERNS.length >= 80, `the book has 80 or more patterns (${PATTERNS.length})`);

// ── 3. presets ─────────────────────────────────────────────────────────────
const presetScenes = [];
const ids = new Set();
for (const pr of PRESETS) {
  ok(!ids.has(pr.id), `preset id ${pr.id} is unique`); ids.add(pr.id);
  ok(!!byId(pr.pat), `preset ${pr.id}: pattern ${pr.pat} exists`);
  ok(PALETTES.some(q => q.id === pr.pal), `preset ${pr.id}: palette ${pr.pal} exists`);
  const a = presetAnim(pr);
  ok(Object.values(a.ch).some(s => s.on), `preset ${pr.id} has motion`);
  for (const id in pr.ch) ok(a.ch[id].on && a.ch[id].curve === pr.ch[id].curve, `preset ${pr.id}: channel ${id} survives cleanAnim`);
  if (pr.morph && pr.morph.pat) ok(!!byId(pr.morph.pat), `preset ${pr.id}: morph pattern exists`);
}
ok(PRESETS.length >= 20, `20 or more presets (${PRESETS.length})`);
for (const coarse of [false, true]) {
  for (const pr of PRESETS) {
    const st = { pat: pr.pat, P: null, seed: pr.seed, D: densityDefault(coarse), detail: 0.5, mode: 'auto', board: '4x5', mods: pr.mods || [], anim: presetAnim(pr) };
    const sc = await buildScene(run, st, { coarse });
    const pl = makePlayer(sc, st.anim, paletteById(pr.pal));
    const L = st.anim.L;
    const l0 = pl.play(0).map(l => snap(l.F)), lL = pl.play(L).map(l => snap(l.F)), lh = pl.play(L / 2).map(l => snap(l.F)), lq = pl.play(L / 4).map(l => snap(l.F));
    ok(l0.every((f, i) => sameFrame(f, lL[i])), `preset ${pr.id} (${coarse ? 'phone' : 'desktop'}) loops: t = L equals t = 0`);
    ok(l0.some((f, i) => !sameFrame(f, lh[i]) || !sameFrame(f, lq[i])), `preset ${pr.id} (${coarse ? 'phone' : 'desktop'}) animates`);
    const budget = (coarse ? BUDGET.phone : BUDGET.desktop);
    ok(sc.cost <= budget * 1.15 || sc.D <= 0.55, `preset ${pr.id} (${coarse ? 'phone' : 'desktop'}) fits the frame budget (cost ${sc.cost}, budget ${budget}, D ${sc.D.toFixed(2)})`);
    if (sc.D < densityDefault(coarse) - 1e-9) ok(sc.cost > budget * 0.25, `preset ${pr.id} (${coarse ? 'phone' : 'desktop'}): a lower density only when the budget needs it`);
    if (pr.morph) ok(!!sc.B && sc.B.n > 0, `preset ${pr.id}: the morph has a B geometry (${sc.B ? sc.B.n : 0} elements, ${sc.pair ? sc.pair.count : 0} pairs)`);
    presetScenes.push({ pr, sc, pl, coarse });
  }
}
{
  const dense = presetScenes.filter(s => !s.coarse && s.sc.D >= densityDefault(false) - 1e-9).length;
  console.log(`presets at the default density ${densityDefault(false)} on the desktop profile: ${dense} of ${PRESETS.length}`);
  ok(dense >= PRESETS.length * 0.6, `most presets start dense on a desktop (${dense} of ${PRESETS.length})`);
}

// ── 4. determinism ─────────────────────────────────────────────────────────
{
  const pr = PRESETS[0], st = { pat: pr.pat, seed: pr.seed, D: 2.2, detail: 0.5, mode: 'auto', board: '4x5', mods: [], anim: presetAnim(pr) };
  const a = await buildScene(run, st, {}), b = await buildScene(run, st, {}), c = await buildScene(run, Object.assign({}, st, { seed: pr.seed + 1 }), {});
  const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  ok(eq(a.G.pts, b.G.pts) && eq(a.G.key, b.G.key), 'the same state gives the same geometry');
  ok(!eq(a.G.pts, c.G.pts) || a.G.n !== c.G.n, 'another seed gives another geometry');
  const pa = makePlayer(a, st.anim, pal4), pb = makePlayer(b, st.anim, pal4);
  ok(sameFrame(snap(pa.play(3.3)[0].F), snap(pb.play(3.3)[0].F), 0), 'the same state and time give the same frame');
  const pal5 = paletteById('okabe'), lut = colourTable(pal5);
  ok(lut.length === pal5.ink.length * Q && lut[0] === pal5.ink[0].toLowerCase() && lut[Q] === pal5.ink[1].toLowerCase(), 'the colour table starts each ink step on the ink');
}

// ── 5. frame budget ────────────────────────────────────────────────────────
// Motion time in node (mean of 30 frames over the loop) per preset, and
// the draw of render.js on a recording context (calls and points).
function recorder() {
  const c = { calls: 0, segs: 0 };
  const g = new Proxy({}, { get(t, k) {
    if (k in t) return t[k];
    if (k === 'fill' || k === 'stroke') return () => { c.calls++; };
    if (k === 'lineTo' || k === 'bezierCurveTo' || k === 'arc') return () => { c.segs++; };
    return () => {};
  }, set(t, k, v) { t[k] = v; return true; } });
  return { g, c };
}
const MOTION_MS = { desktop: 10, phone: 6 }, MEAN_MS = { desktop: 4, phone: 2.5 }, CALLS_MAX = 4000;
const times = { desktop: [], phone: [] };
for (const { pr, sc, pl, coarse } of presetScenes) {
  const prof = coarse ? 'phone' : 'desktop', L = pl.anim.L;
  pl.play(0); pl.play(0.5);           // warm up the JIT
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) pl.play(L * i / 30);
  const ms = (performance.now() - t0) / 30;
  times[prof].push([pr.id, ms, sc.cost]);
  ok(ms <= MOTION_MS[prof], `preset ${pr.id} motion ${ms.toFixed(2)} ms per frame on the ${prof} profile (budget ${MOTION_MS[prof]} ms, ${sc.cost} points)`);
  const { g, c } = recorder();
  const st = drawFrame(g, pl.play(L / 3), { W: sc.view.W, H: sc.view.H, base: [0.5, 0, 0], lut: pl.lut, paper: pl.pal.bg, lw: 2, lwScale: sc.lwScale, clip: null });
  const groups = (sc.G.gs.length - 1) + (sc.B ? sc.B.gs.length - 1 : 0);
  ok(st.calls === c.calls && c.calls <= 2 * groups + 64 * (pl.FA.cvar ? groups : 1), `preset ${pr.id} (${prof}): ${c.calls} calls for ${groups} draw groups`);
  ok(c.calls <= CALLS_MAX, `preset ${pr.id} (${prof}) draws in ${c.calls} fill and stroke calls (at most ${CALLS_MAX})`);
  ok(st.pts <= (coarse ? BUDGET.phone : BUDGET.desktop) * 1.2 || sc.D <= 0.55, `preset ${pr.id} (${prof}) draws ${st.pts} points`);
}
for (const prof of ['desktop', 'phone']) {
  const t = times[prof].map(x => x[1]), mean = t.reduce((a, b) => a + b, 0) / t.length, worst = times[prof].reduce((a, b) => b[1] > a[1] ? b : a);
  console.log(`${prof} profile: motion mean ${mean.toFixed(2)} ms, worst ${worst[0]} ${worst[1].toFixed(2)} ms (${worst[2]} points)`);
  ok(mean <= MEAN_MS[prof], `${prof} mean motion time ${mean.toFixed(2)} ms <= ${MEAN_MS[prof]} ms`);
}
{
  // A still animation (board channels only) draws cached Path2D batches.
  class P2 { constructor() { this.n = 0; } moveTo() { this.n++; } lineTo() {} closePath() {} arc() {} bezierCurveTo() {} }
  globalThis.Path2D = P2;
  const pr = PRESETS.find(p => p.id === 'iso-tide'), st = { pat: pr.pat, seed: 3, D: 1.5, detail: 0.3, mode: 'auto', board: 'sq', mods: [], anim: animDefaults(8) };
  st.anim.ch.rotate.on = 1; st.anim.ch.colour.on = 1; st.anim.ch.colour.freq = 0;
  const sc = await buildScene(run, st, {}), pl = makePlayer(sc, st.anim, pal4);
  ok(pl.C.still, 'board channels and a global colour cycle give a still geometry');
  const r1 = recorder(); drawFrame(r1.g, pl.play(1), { W: sc.view.W, H: sc.view.H, base: [0.5, 0, 0], lut: pl.lut, paper: '#fff', lw: 2 });
  const r2 = recorder(); drawFrame(r2.g, pl.play(2), { W: sc.view.W, H: sc.view.H, base: [0.5, 0, 0], lut: pl.lut, paper: '#fff', lw: 2 });
  ok(sc.G._still && sc.G._still.length > 0 && r1.c.segs === 0 && r2.c.calls === r1.c.calls, `a still frame reuses ${sc.G._still ? sc.G._still.length : 0} cached paths and traces no point`);
  delete globalThis.Path2D;
  const it = materialise(sc.G, pl.FA);
  ok(it.length > 0 && it.every(e => e.t === 'circle' ? Number.isFinite(e.x + e.y + e.r) : (e.t === 'multi' ? e.rr.flat() : e.p).every(Number.isFinite)), `materialise gives ${it.length} finite elements`);
}

{
  // The draw order keeps every overlapping pair of two styles in the
  // pattern order (a brute force check of the boxes on small runs).
  let pairs = 0, bad = 0, checked = 0;
  for (const id of ['cube-stacks', 'tumbling-blocks', 'arc-lattice', 'star-rosettes', 'module-grid', 'iso-towers', 'lead-glass', 'bracket-plants', 'cairo-tiles', 'apollonian']) {
    const p = byId(id), res = runJob({ pat: id, P: defaults(p), seed: 3, W: 1000, H: 1000, mods: [], D: 1, detail: 0.4 });
    const G = pack(applyMode(res.items, 'auto'), { W: 1000, H: 1000, seed: 3 }), n = Math.min(G.n, 2500);
    const pos = new Int32Array(G.n); G.order.forEach((e, q) => { pos[e] = q; });
    const box = i => {
      if (G.t[i] === 1) { const m = 0.5 + 0.42 * G.cr[i]; return [G.cx[i] - G.cr[i] - m, G.cy[i] - G.cr[i] - m, G.cx[i] + G.cr[i] + m, G.cy[i] + G.cr[i] + m]; }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let ri = G.r0[i]; ri < G.r1[i]; ri++) for (let q = G.rs[ri]; q < G.rs[ri] + G.rn[ri]; q++) { const x = G.pts[2 * q], y = G.pts[2 * q + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const m = 0.5 + 0.21 * Math.max(x1 - x0, y1 - y0);
      return [x0 - m, y0 - m, x1 + m, y1 + m];
    };
    const B = Array.from({ length: n }, (_, i) => box(i)), sk = i => { const c = cls(G.f[i], G.s[i], G.t[i]); return c === 1 ? 's' + G.s[i] + '|' + G.w[i] : c === 2 ? 'f' + G.f[i] : c === 3 ? 'k' + G.f[i] + '|' + G.s[i] + '|' + G.w[i] : 'u' + i; };
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const A = B[a], C = B[b];
      if (A[2] < C[0] || C[2] < A[0] || A[3] < C[1] || C[3] < A[1] || sk(a) === sk(b)) continue;
      pairs++; if (pos[a] > pos[b]) bad++;
    }
    checked += n;
  }
  ok(bad === 0, `the draw order keeps ${pairs} overlapping pairs of two styles in order (${bad} swapped, ${checked} elements)`);
}

// ── 6. governor ────────────────────────────────────────────────────────────
{
  const g = new Governor();
  let t = 0, l = null;
  for (let i = 0; i < 200 && g.level === 0; i++) { t += 33; l = g.sample(33, 25, t); }
  ok(g.level === 1 && l === 1, `slow frames (33 ms, cost 25 ms) step down to level 1 (level ${g.level})`);
  for (let i = 0; i < 400; i++) { t += 33; g.sample(33, 25, t); }
  ok(g.level === LEVELS.length - 1, `a steady slow page goes to the last level (${g.level})`);
  for (let i = 0; i < 4000 && g.level > 0; i++) { t += 16.7; g.sample(16.7, 3, t); }
  ok(g.level === 0, `fast frames bring the level back to 0 (${g.level})`);
  const g2 = new Governor(); let t2 = 0;
  for (let i = 0; i < 50; i++) { t2 += 16.7; g2.sample(16.7, 30, t2); }
  ok(g2.level === 0, 'a high cost at a full frame rate is not a reason to step down');
  const g3 = new Governor(); let t3 = 0;
  g3.sample(400, 400, t3 += 400); g3.sample(500, 500, t3 += 500);
  ok(g3.level === 0, 'gaps (a hidden tab) are not samples');
  g3.sample(16, 90, t3 += 16); g3.sample(16, 95, t3 += 16);
  ok(g3.level === 1, 'two very slow frames in a row step down at once');
  const g4 = new Governor({ level: 2 }); let t4 = 0;
  while (g4.level === 2) { t4 += 16.7; g4.sample(16.7, 2, t4); }
  const up1 = g4.upN; for (let i = 0; i < 40; i++) { t4 += 33; g4.sample(33, 25, t4); }
  ok(g4.level === 2 && g4.upN === up1 * 2, `a step down soon after a step up doubles the wait (${up1} -> ${g4.upN})`);
  ok(GOV.SLOW > 16.7 && GOV.FAST < GOV.SLOW, 'the slow and fast marks bracket 60 Hz');
}

// ── 7. export ──────────────────────────────────────────────────────────────
{
  const P = framePlan(8, 30, 1);
  ok(P.n === 240 && Math.abs(P.dt - 1 / 30) < 1e-12 && P.times[0] === 0 && Math.abs(P.times[239] - 239 / 30) < 1e-9, `8 s at 30 fps: 240 frames at 1/30 s (${P.n})`);
  ok(P.delays.reduce((a, b) => a + b, 0) === 800, 'the GIF delays add up to 8.00 s');
  const P2 = framePlan(10, 15, 2);
  ok(P2.n === 300 && P2.times[150] === 0 && P2.delays.reduce((a, b) => a + b, 0) === 2000, `two loops of 10 s at 15 fps: 300 frames, frame 150 back at t = 0`);
  const P3 = framePlan(6, 24, 1);
  ok(P3.delays.every(d => d === 4 || d === 5) && P3.delays.reduce((a, b) => a + b, 0) === 600, 'delays of 4.17 cs are 4 or 5 and add up');
  // GIF: encode three frames, decode them again.
  const lut = colourTable(pal4), gp = gifPalette(lut, pal4.bg), W = 37, H = 23;
  ok(gp.n <= 256 && gp.n >= lut.length / 2, `GIF table: ${gp.n} colours`);
  const w = new GifWriter(W, H, gp), frames = [];
  for (let f = 0; f < 3; f++) {
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const k = (i * (f + 3) + f) % gp.n; rgba[4 * i] = gp.rgb[3 * k]; rgba[4 * i + 1] = gp.rgb[3 * k + 1]; rgba[4 * i + 2] = gp.rgb[3 * k + 2]; rgba[4 * i + 3] = 255; }
    const idx = quantize(rgba, gp, new Int16Array(32768).fill(-1), new Uint8Array(W * H));
    frames.push(idx); w.frame(idx, 7 + f);
  }
  const bytes = w.end(), dec = decodeGif(bytes);
  ok(dec.w === W && dec.h === H && dec.loop === true, `GIF header ${dec.w} x ${dec.h}, loops for ever`);
  ok(dec.frames.length === 3 && dec.frames.every((f, i) => f.delay === 7 + i), `GIF has 3 frames with their delays (${dec.frames.map(f => f.delay)})`);
  ok(dec.frames.every((f, i) => f.idx.length === W * H && f.idx.every((v, j) => v === frames[i][j])), 'GIF frames decode to the same pixels');
  // A large frame (LZW table resets).
  const big = new Uint8Array(640 * 400); const r = makeRng(5, 'gif');
  for (let i = 0; i < big.length; i++) big[i] = r.next() < 0.6 ? (i >> 5) % 200 : r.int(0, 255);
  const w2 = new GifWriter(640, 400, gp); w2.frame(big, 4); const d2 = decodeGif(w2.end());
  ok(d2.frames[0].idx.every((v, j) => v === big[j]), 'a 640 x 400 noisy frame survives the LZW table resets');
  // ZIP
  const files = [{ name: 'frame_0000.png', data: new Uint8Array([1, 2, 3, 4]) }, { name: 'README.txt', data: new TextEncoder().encode('loop') }];
  const z = zipStore(files), zd = readZip(z);
  ok(zd.length === 2 && zd[0].name === 'frame_0000.png' && zd[1].name === 'README.txt', 'ZIP lists its two entries');
  ok(zd.every((e, i) => e.crc === crc32(files[i].data) && e.data.every((v, j) => v === files[i].data[j])), 'ZIP entries keep their bytes and CRC');
  ok(crc32(new TextEncoder().encode('123456789')) === 0xCBF43926, 'CRC-32 check value');
  const d = exportDims({ W: 1000, H: 1250 }, 720), d9 = exportDims({ W: 1000, H: 1777.78 }, 1080);
  ok(d.w === 720 && d.h === 900 && d9.w === 1080 && d9.h % 2 === 0, `video sizes are even (${d.w}x${d.h}, ${d9.w}x${d9.h})`);
  ok(videoType({ isTypeSupported: t => t === 'video/mp4' }) === 'video/mp4' && videoType({ isTypeSupported: t => t.startsWith('video/webm') }) === 'video/webm;codecs=vp9' && videoType(null) === '', 'the video type pick prefers VP9 WebM, then MP4');
}

// ── 8. cover ───────────────────────────────────────────────────────────────
{
  const a = animDefaults(8); a.ch.rotate.on = 1; a.ch.rotate.curve = 'ramp';
  for (const v of [{ W: 1000, H: 1250 }, { W: 1777.78, H: 1000 }, { W: 1000, H: 1777.78 }]) {
    const cv = coverFor(v, a, false); let worst = 0;
    for (let i = 0; i < 64; i++) {
      const th = Math.PI * 2 * i / 64, c = Math.cos(th), s = Math.sin(th);
      for (const [x, y] of [[-v.W / 2, -v.H / 2], [v.W / 2, -v.H / 2], [v.W / 2, v.H / 2], [-v.W / 2, v.H / 2]]) {
        const gx = c * x + s * y, gy = -s * x + c * y;
        worst = Math.max(worst, Math.abs(gx) / (cv.W / 2), Math.abs(gy) / (cv.H / 2));
      }
    }
    ok(worst <= 1.0001, `a full turn of a ${v.W}x${v.H} view stays on the ${cv.W}x${cv.H} board (${worst.toFixed(3)})`);
  }
  ok(coverFor(VIEW, a, true).k === 1, 'a centred motif keeps its board when it turns');
  ok(coverFor(VIEW, animDefaults(8), false).k === 1, 'no motion: the geometry board is the view');
}

// ── 9. saver framing ───────────────────────────────────────────────────────
{
  ok(boardForBand(1700, 480) === 'desk' && boardForBand(1000, 1500) === '9x16' && boardForBand(1000, 1100) === '4x5', 'the board follows the band aspect');
  for (const [vw, vh, band] of [[1920, 1080, { t: 250, b: 280 }], [1080, 1920, { t: 420, b: 520 }], [1280, 800, null], [390, 844, { t: 210, b: 260 }]]) {
    const bw = vw * 0.92, bh = band ? vh - band.t - band.b : vh * 0.8, id = boardForBand(bw, bh), asp = { desk: 16 / 9, '9x16': 9 / 16, sq: 1, '4x5': 0.8 }[id];
    const b = boxInBand(vw, vh, band, asp), t = band ? band.t : vh * 0.1, bot = band ? vh - band.b : vh * 0.9;
    ok(b.y >= t - 0.5 && b.y + b.h <= bot + 0.5 && b.x >= 0 && b.x + b.w <= vw, `${vw}x${vh}: the ${id} board sits in the clear band (${b.y.toFixed(0)}..${(b.y + b.h).toFixed(0)} in ${t}..${bot})`);
    ok(Math.abs(b.w / b.h - asp) < 1e-6 && Math.abs(b.x + b.w / 2 - vw / 2) < 0.5 && Math.abs(b.y + b.h / 2 - (t + bot) / 2) < 0.5, `${vw}x${vh}: the board is centred with its aspect`);
    ok(b.w * b.h >= 0.3 * (vw - 2 * Math.max(16, vw * 0.04)) * (bot - t) * (Math.min(asp, (vw * 0.92) / (bot - t)) / Math.max(asp, (vw * 0.92) / (bot - t))), `${vw}x${vh}: the board uses the band`);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
function decodeGif(b) {
  let p = 0; const u8 = () => b[p++], u16 = () => { const v = b[p] | b[p + 1] << 8; p += 2; return v; };
  const sig = String.fromCharCode(...b.slice(0, 6)); p = 6;
  const w = u16(), h = u16(), fl = u8(); u8(); u8();
  if (fl & 0x80) p += 3 * (1 << ((fl & 7) + 1));
  const out = { sig, w, h, loop: false, frames: [] }; let delay = 0;
  for (;;) {
    const c = u8();
    if (c === 0x3b || c === undefined) break;
    if (c === 0x21) {
      const lab = u8();
      if (lab === 0xf9) { u8(); u8(); delay = u16(); u8(); u8(); continue; }
      if (lab === 0xff) { const n = u8(); const id = String.fromCharCode(...b.slice(p, p + n)); p += n; if (id === 'NETSCAPE2.0') out.loop = true; }
      for (let n = u8(); n; n = u8()) p += n;
      continue;
    }
    if (c === 0x2c) {
      u16(); u16(); const fw = u16(), fh = u16(); u8();
      const min = u8(), data = [];
      for (let n = u8(); n; n = u8()) { for (let i = 0; i < n; i++) data.push(b[p + i]); p += n; }
      out.frames.push({ delay, idx: lzwDecode(data, min, fw * fh) });
    }
  }
  return out;
}
function lzwDecode(data, min, n) {
  const out = new Uint8Array(n), CL = 1 << min, EOI = CL + 1;
  let size = min + 1, dict = [], pos = 0, bit = 0, prev = null, o = 0;
  const reset = () => { dict = []; for (let i = 0; i < CL; i++) dict[i] = [i]; dict[CL] = null; dict[EOI] = null; size = min + 1; prev = null; };
  reset();
  const read = () => { let v = 0; for (let i = 0; i < size; i++) { const byte = data[(bit >> 3)]; v |= ((byte >> (bit & 7)) & 1) << i; bit++; } return v; };
  while ((bit >> 3) < data.length) {
    const code = read();
    if (code === CL) { reset(); continue; }
    if (code === EOI) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) entry = prev.concat([prev[0]]);
    else break;
    for (const v of entry) out[o++] = v;
    if (prev) dict.push(prev.concat([entry[0]]));
    prev = entry;
    if (dict.length === (1 << size) && size < 12) size++;
    pos++;
  }
  return out;
}
function readZip(z) {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let e = z.length - 22; while (dv.getUint32(e, true) !== 0x06054b50) e--;
  const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [];
  for (let i = 0; i < cnt; i++) {
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), at = dv.getUint32(p + 42, true);
    const name = String.fromCharCode(...z.slice(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(at + 26, true), lxl = dv.getUint16(at + 28, true), d0 = at + 30 + lnl + lxl;
    out.push({ name, crc, data: z.slice(d0, d0 + size) });
    p += 46 + nl;
  }
  return out;
}

console.log(`${n - fail} of ${n} checks pass${fail ? `, ${fail} fail` : ''}`);
process.exit(fail ? 1 : 0);
