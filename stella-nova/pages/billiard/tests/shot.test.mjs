// ============================================================================
//  POOL PHYSICS  ·  tests/shot.test.mjs — predictions and the maths steps
// ----------------------------------------------------------------------------
//  prediction ... predict() equals a fresh simulation of the same shot, bit
//                 for bit (the page plays the prediction back)
//  steps ........ every step has a title, TeX, a plain-text fallback with
//                 no TeX in it, and drawing items; the numbers in them agree
//                 with the geometry (cut angle, v cos theta, v sin theta,
//                 the slide-to-roll time)
//  showy shots .. banks (the mirror step), kicks, combinations (the chain
//                 of two ghost balls) and the stroke error step (aimed vs
//                 observed) go through the same checks
//  TeX .......... every TeX string of 40 seeded shots typesets in MathJax
//                 3.2.2 (mathjax-full from MATHJAX_DIR or NODE_PATH, with
//                 the html extension for \class); a missing MathJax fails
// ============================================================================
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, done, D } from './util.mjs';
import { newGame } from '../core/rules.js';
import { autoTurn, plan } from '../core/ai.js';
import { predict, mathsOf, contactOf, lensOf } from '../core/shot.js';
import { shotGeometry } from '../core/geometry.js';
import { clone, beginShot, strike, simulate, PHYS } from '../core/physics.js';

const shots = [];
for (let seed = 1; seed <= 10; seed++) {
  const G = newGame({ seed: seed * 7 });
  for (let k = 0; k < 4 && G.phase !== 'over'; k++) {
    const pl = plan(G, {});
    const S = clone(G.S);
    const geo = pl.n > 0 && pl.pocket >= 0 && !pl.place ? shotGeometry(G.S, G.T, pl.n, G.T.pockets[pl.pocket]) : null;
    const pred = predict(G.S, pl);
    shots.push({ G, S, pl, geo, pred, steps: mathsOf(G.T, G.S, pl, pred, geo) });
    autoTurn(G, {});
  }
}
// banks, kicks and combinations (flair 0.9): their own steps (the mirror,
// the chain of ghost balls) go through the same checks and MathJax
const fancyKinds = {};
for (let seed = 1; seed <= 12 && Object.keys(fancyKinds).length < 3; seed++) {
  const G = newGame({ seed: seed * 13, type: seed % 2 ? '8' : '9' });
  for (let k = 0; k < 14 && G.phase !== 'over'; k++) {
    const pl = plan(G, { flair: 0.9 });
    if (['bank', 'kickpot', 'combo'].includes(pl.kind) && !pl.place) {
      fancyKinds[pl.kind] = (fancyKinds[pl.kind] || 0) + 1;
      const S = clone(G.S), geo = pl.chosen, pred = predict(G.S, pl);
      shots.push({ G, S, pl, geo, pred, steps: mathsOf(G.T, G.S, pl, pred, geo), fancy: true });
    }
    autoTurn(G, { flair: 0.9 });
  }
}
{
  const f = shots.filter(s => s.fancy), ids = new Set(f.flatMap(s => s.steps.map(x => x.id)));
  const strokes = shots.filter(s => s.steps.some(x => x.id === 'stroke')).length;
  ok(f.length >= 3 && ids.has('mirror') && (ids.has('chain') || fancyKinds.kickpot) && strokes === shots.length,
    'steps: banks show the mirror, combinations the chain of ghost balls, and every AI shot the stroke error step',
    `${f.length} showy shots ${JSON.stringify(fancyKinds)}; step ids ${[...ids].join(' ')}; ${strokes}/${shots.length} with the stroke step`);
}
{
  let bad = 0;
  for (const s of shots.slice(0, 12)) {
    const C = clone(s.S);
    if (s.pl.place) { C.x[0] = s.pl.place.x; C.y[0] = s.pl.place.y; }
    beginShot(C, { log: true }); strike(C, 0, s.pl); simulate(C, { maxT: 60 });
    for (let n = 0; n < 16; n++) if (C.x[n] !== s.pred.S.x[n] || C.y[n] !== s.pred.S.y[n] || C.paths[n].join() !== s.pred.paths[n].join()) bad++;
  }
  ok(bad === 0, 'prediction: predict() equals a fresh simulation of the same shot, bit for bit (12 shots)', `${bad} differences`);
}
{
  let bad = [], n = 0;
  for (const s of shots) for (const st of s.steps) {
    n++;
    if (!st.title || !st.tex || !st.plain || !Array.isArray(st.draw)) bad.push(st.id + ': missing');
    if (/\\[a-zA-Z]/.test(st.plain)) bad.push(st.id + ': TeX in plain');
    if (!(st.at === 'aim' || Number.isFinite(st.at))) bad.push(st.id + ': at');
  }
  ok(!bad.length, `steps: ${n} steps of ${shots.length} shots have a title, TeX, a plain fallback (no TeX) and drawing items`, bad.slice(0, 3).join('; '));
}
{
  let worst = 0, comp = 0, roll = 0, rollN = 0, lens = 0;
  for (const s of shots) {
    const cut = s.steps.find(x => x.id === 'cut');
    if (cut && s.geo) worst = Math.max(worst, Math.abs(cut.val.theta - s.geo.theta * D));
    const ct = contactOf(s.pred);
    if (ct) { comp = Math.max(comp, Math.abs(Math.hypot(ct.vn, ct.vt) - ct.v)); if (!lensOf(s.pred, s.geo)) lens++; }
    const a = s.pl.b || 0, slide = s.steps.find(x => x.id === 'slide'), r = s.pred.events.find(e => e.type === 'roll' && e.i === 0);
    // (a kick meets the rail before it rolls: the rail changes the slide)
    const rail0 = s.pred.events.find(e => e.type === 'cushion' && e.i === 0);
    if (slide && r && (!ct || r.t < ct.t) && (!rail0 || rail0.t > r.t)) { const want = +/= ([\d.]+) s$/.exec(slide.plain)[1]; roll = Math.max(roll, Math.abs(want - r.t)); rollN++; }
  }
  ok(worst < 1e-9, 'steps: the cut angle in the maths is the ghost ball geometry', `worst ${worst.toExponential(1)} deg`);
  ok(comp < 1e-9 && lens === 0, 'steps: |v| = sqrt((v cos theta)^2 + (v sin theta)^2) at every contact, and the zoom lens finds it', `worst ${comp.toExponential(1)}`);
  ok(rollN > 5 && roll <= 0.006, 'steps: t_r = 2|u0| / (7 mu_s g) in the maths equals the roll time of the simulation', `${rollN} shots, worst ${(roll * 1000).toFixed(1)} ms (two-decimal text)`);
}
// TeX in MathJax
{
  const require = createRequire(import.meta.url);
  const dirs = [process.env.MATHJAX_DIR, process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
  let mj = null;
  try {
    const req = m => require(require.resolve(m, { paths: dirs }));
    const { mathjax } = req('mathjax-full/js/mathjax.js');
    const { TeX } = req('mathjax-full/js/input/tex.js');
    const { SVG } = req('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
    req('mathjax-full/js/input/tex/base/BaseConfiguration.js');
    req('mathjax-full/js/input/tex/ams/AmsConfiguration.js');
    req('mathjax-full/js/input/tex/html/HtmlConfiguration.js');
    req('mathjax-full/js/input/tex/color/ColorConfiguration.js');
    const ad = liteAdaptor(); RegisterHTMLHandler(ad);
    const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html', 'color'], formatError: (jax, err) => { throw err; } }), OutputJax: new SVG({ fontCache: 'none' }) });
    mj = tex => ad.outerHTML(doc.convert(tex, { display: true }));
  } catch (e) { mj = null; }
  if (!mj) ok(false, 'TeX: mathjax-full not found (set MATHJAX_DIR to a folder with mathjax-full@3.2.2)');
  else {
    const all = new Set(); for (const s of shots) for (const st of s.steps) all.add(st.tex);
    const bad = [];
    for (const t of all) { try { const out = mj(t); if (/merror|data-mjx-error|fill="red"/.test(out)) bad.push(t); } catch (e) { bad.push(t + ' :: ' + e.message); } }
    ok(!bad.length, `TeX: all ${all.size} distinct step equations typeset in MathJax 3.2.2 (base, ams, html, color)`, bad.slice(0, 2).join(' || '));
  }
}
done();
