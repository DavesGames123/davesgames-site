// ============================================================================
//  CIRCULAR RYDBERG  ·  tests.mjs — node stella-nova/pages/circular-rydberg/tests.mjs
// ----------------------------------------------------------------------------
//  physics   normalization, <r>, width, the closed-form dipole, 2p -> 1s,
//            n^5 scaling, free-space lifetime vs the paper, plate model,
//            Purcell limits, cascade conservation, cloud samples
//  data      the dataset numbers, sources (DOI or URL), timeline links
//  figures   every draw function runs on a recording context, no NaN
//  saver     plan (no kind twice in a row, 6-12 s), every shot draws,
//            plates carry TeX and no code
//  page      head order, [hidden] rule, ids main.js binds, main.js links
//  TeX       with jsdom on NODE_PATH: every equation of the page and the
//            plates typesets through lib/sci-math.js and vendor MathJax
// ============================================================================
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as P from './physics.js';
import { PAPER, MEASURED, SOURCES, TIMELINE, shotPlan, SHOT_KINDS } from './data.js';

const here = new URL('.', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);

// ── physics ───────────────────────────────────────────────────────────────
{
  const integ = (n, l, pow) => {
    const rMax = 4 * n * n + 60, N = 20000, h = rMax / N; let s = 0;
    for (let i = 1; i < N; i++) { const r = i * h, a = P.logRadial(n, l, r); if (!a.sign) continue; s += (i % 2 ? 4 : 2) * Math.exp(2 * a.log + (2 + pow) * Math.log(r)); }
    return s * h / 3;
  };
  const ns = [5, 30, 100];
  ok(ns.every(n => near(integ(n, n - 1, 0), 1, 1e-6)), 'physics: |R_{n,n-1}|^2 r^2 integrates to 1', ns.map(n => integ(n, n - 1, 0).toFixed(8)).join(' '));
  ok(ns.every(n => near(integ(n, n - 1, 1), P.meanR(n), 1e-6)), 'physics: <r> = n(n + 1/2) for circular states', ns.map(n => `${integ(n, n - 1, 1).toFixed(2)}/${P.meanR(n)}`).join(' '));
  const wid = ns.map(n => Math.sqrt(integ(n, n - 1, 2) - P.meanR(n) ** 2) / P.meanR(n) * Math.sqrt(2 * n + 1));
  ok(wid.every(x => near(x, 1, 1e-4)), 'physics: relative radial width = 1/sqrt(2n+1)', wid.map(x => x.toFixed(6)).join(' '));
  ok(near(integ(20, 3, 0), 1, 1e-6) && near(integ(20, 3, 1), (3 * 400 - 12) / 2, 1e-6), 'physics: a low-l state is normalized and <r> = (3n^2 - l(l+1))/2');
  const cd = [10, 50].map(n => [P.circularDipole(n), P.radialMoment(n, n - 1, n - 1, n - 2)]);
  ok(cd.every(([a, b]) => near(a, b, 1e-6)), 'physics: closed-form circular dipole equals the quadrature', cd.map(([a, b]) => `${a.toFixed(3)}/${b.toFixed(3)}`).join(' '));
  const A21 = P.circularRates(2, { T: 0, up: 0 })[0].A;
  ok(near(A21, 6.2649e8, 2e-3), 'physics: hydrogen 2p -> 1s rate is 6.265e8 /s', A21.toExponential(4));
  const r5 = P.radiativeLifetime(100) / P.radiativeLifetime(50);
  ok(r5 > 30 && r5 < 34, 'physics: circular radiative lifetime scales as n^5 (ratio 100/50 near 32)', r5.toFixed(2));
  const t50 = P.radiativeLifetime(50) * 1e3;
  ok(t50 > 25 && t50 < 32, 'physics: |50C> radiative lifetime near 30 ms (hydrogen)', `${t50.toFixed(1)} ms`);
  const tf = P.lifetime(101, { T: 300 }) * 1e6;
  ok(near(tf, PAPER.tauFree101Us, 0.15), 'physics: free-space lifetime of |101C> at 300 K within 15 % of the paper', `${tf.toFixed(0)} µs vs ${PAPER.tauFree101Us} µs`);
  const cap = { d: PAPER.plateGapMm * 1e-3, R: PAPER.reflectivity }, tc = P.lifetime(101, { T: 300, cap }) * 1e3;
  ok(tc / (tf / 1e3) > 10 && tc < 20, 'physics: the plate model lengthens |101C> more than tenfold', `${tc.toFixed(2)} ms`);
  let nOn = 60; while (P.freqHz(nOn, nOn + 1) > P.AU.cSI / (2 * cap.d)) nOn++;
  ok(nOn >= 77 && nOn <= 78, 'physics: lambda > 2d starts near n = 78 for d = 10.5 mm (paper: n >~ 78)', `first n with f(n->n+1) < c/2d: ${nOn}`);
  ok(near(P.xiPar(400), 1, 0.02) && near(P.xiPerp(400), 1, 0.02) && P.xiPar(0.5, 0.04) === 0.04 && near(P.xiPerp(0.5), 3, 1e-12), 'physics: Purcell factors go to 1 for wide plates; below cut-off sigma -> floor, pi -> 3/(2x)');
  const d103 = 2 * P.meanR(103) * P.AU.a0 * 1e6;
  ok(d103 > 1.05 && d103 < 1.2, 'physics: |103C> orbit is about 1.1 µm across', `${d103.toFixed(3)} µm`);
  const c = P.cascade(97, { cap, tMax: 0.02, steps: 80 });
  const sums = c.pops.map((p, i) => p.reduce((a, b) => a + b, 0) + c.other[i]);
  ok(sums.every(s => Math.abs(s - 1) < 1e-6) && c.pops.every(p => p.every(x => x >= -1e-9 && x <= 1 + 1e-9)), 'physics: the cascade keeps total population 1 and every population in [0, 1]');
  const s = P.sampleCircular(60, 20000, 3); let m = 0, z2 = 0;
  for (let i = 0; i < 20000; i++) { m += Math.hypot(s[4 * i], s[4 * i + 1], s[4 * i + 2]); z2 += (s[4 * i + 2] / Math.hypot(s[4 * i], s[4 * i + 1], s[4 * i + 2])) ** 2; }
  ok(near(m / 20000, P.meanR(60), 0.01) && near(Math.sqrt(z2 / 20000), 1 / Math.sqrt(2 * 59 + 1), 0.08), 'physics: the circular sample has the right <r> and polar spread', `<r> ${(m / 20000).toFixed(0)}, rms cos ${Math.sqrt(z2 / 20000).toFixed(4)}`);
  const q = P.sampleState(20, 0, 0, 20000, 2); let mq = 0;
  for (let i = 0; i < 20000; i++) mq += Math.hypot(q[4 * i], q[4 * i + 1], q[4 * i + 2]);
  ok(near(mq / 20000, 600, 0.05) && q.every(Number.isFinite), 'physics: the Metropolis sample of 20s has <r> near 600', (mq / 20000).toFixed(0));
}

// ── data ──────────────────────────────────────────────────────────────────
{
  const m101 = MEASURED.find(x => x[0] === 101);
  ok(Math.abs(m101[1] - PAPER.tau101Ms) <= PAPER.tau101ErrMs && MEASURED.every(([n, t, e]) => n % 2 === 1 && t > 0 && t < 15 && e > 0), 'data: dataset lifetimes in range, |101C> matches the paper within its error', `${m101[1]} vs ${PAPER.tau101Ms}`);
  ok(Math.abs(PAPER.tau101Ms * 1e3 / PAPER.tauFree101Us - PAPER.enhancement) < 0.5, 'data: 11.5 ms / 545 µs is the stated 21-fold gain');
  const ids = Object.keys(SOURCES);
  ok(ids.every(id => (SOURCES[id].doi && /^10\.\d{4,9}\/\S+$/.test(SOURCES[id].doi)) || /^https:\/\//.test(SOURCES[id].url || '')), 'data: every source has a DOI or an https URL', `${ids.length} sources`);
  ok(TIMELINE.every(e => SOURCES[e.src]) && TIMELINE.every((e, i) => !i || e.y >= TIMELINE[i - 1].y), 'data: timeline entries cite known sources, in order');
}

// ── figures (recording 2D context) ────────────────────────────────────────
function recorder() {
  let bad = 0, calls = 0;
  const chk = a => { for (const x of a) if (typeof x === 'number' && !Number.isFinite(x)) bad++; };
  const g = new Proxy({}, {
    get(t, k) {
      if (k === 'bad') return bad; if (k === 'calls') return calls;
      if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      if (k in t) return t[k];
      return (...a) => { calls++; chk(a); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return g;
}
{
  const D = await import('./draw.js');
  const runs = [
    ['spectrum', g => D.drawSpectrum(g, 640, 300, { n: 90 })],
    ['spectrum 4 K', g => D.drawSpectrum(g, 640, 300, { n: 101, T: 4, cap: false })],
    ['lifetime', g => D.drawLifetime(g, 640, 300, { hi: 101, reveal: 0.5 })],
    ['cascade', g => D.drawCascade(g, 520, 300, { res: P.cascade(91, { tMax: 0.003, steps: 60 }), t: 0.001 })],
    ['prep', g => [0, 0.2, 0.35, 0.6, 1].forEach(k => D.drawPrep(g, 640, 300, { k }))],
    ['sizes', g => [1, 10, 103].forEach(n => D.drawSizes(g, 900, 160, { n }))],
  ];
  const res = runs.map(([name, f]) => { const g = recorder(); f(g); return [name, g.bad, g.calls]; });
  ok(res.every(([, b, c]) => b === 0 && c > 20), 'figures: every 2D figure draws with no NaN', res.map(([n, b, c]) => `${n} ${c}`).join(', '));
  ok(D.prepN(0.1) === null && D.prepN(0.3) === 79 && D.prepN(1) === PAPER.nMax, 'figures: the preparation reaches |79C> then |103C>');
  const { createCloud } = await import('./cloud.js');
  const cl = createCloud(200, 120), g = recorder(); let put = null;
  g.putImageData = img => { put = img; };
  cl.render(g, P.sampleCircular(30, 4000, 1), { yaw: 0.3, pitch: 1, scale: 0.05, cx: 100, cy: 60, m: 29, phase: 0.3, colour: 'phase', packet: { phi: 1, width: 0.3 } });
  let lit = 0; for (let i = 0; i < put.data.length; i += 4) if (put.data[i] + put.data[i + 1] + put.data[i + 2] > 60) lit++;
  ok(put && lit > 300 && put.data.every(Number.isFinite), 'figures: the cloud renderer lights pixels and writes finite values', `${lit} lit px`);
  // frame time at the saver's 1.5 MP cap: the full-size three-channel
  // glow took about 68 ms (density) here; the half-size glow takes about 12
  {
    const W = 1500, H = 1000, big = createCloud(W, H), pts = P.sampleState(30, 5, 3, 80000, 7), g2 = recorder();
    g2.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }); g2.putImageData = () => {};
    const v = { yaw: 0.3, pitch: 1, scale: Math.min(W, H) * 0.45 / 1800, cx: W / 2, cy: H / 2, m: 3 };
    for (let i = 0; i < 3; i++) big.render(g2, pts, v);
    const t0 = performance.now(); for (let i = 0; i < 8; i++) big.render(g2, pts, v);
    const ms = (performance.now() - t0) / 8;
    ok(ms < 30, 'figures: a 1.5 MP density cloud renders in under 30 ms', `${ms.toFixed(1)} ms`);
  }
}

// ── saver ─────────────────────────────────────────────────────────────────
{
  let rep = 0, out = 0; const seen = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const p = shotPlan(seed, 40, (seed % 10) / 10);
    p.forEach((s, i) => { seen.add(s.id); if (i && s.id === p[i - 1].id) rep++; if (s.sec < 6 || s.sec > 12) out++; });
  }
  ok(rep === 0 && out === 0 && SHOT_KINDS.every(k => seen.has(k)), 'saver: plans never repeat a kind back to back, shots last 6-12 s, all kinds occur', `${rep} repeats, ${out} out of range`);
  const p1 = shotPlan(5).map(s => s.id).join(), p2 = shotPlan(6).map(s => s.id).join();
  ok(p1 !== p2, 'saver: different seeds give different orders');
  globalThis.window = globalThis.window || {};
  globalThis.matchMedia = globalThis.matchMedia || (() => ({ matches: false }));
  const { SHOTS } = await import('./saver.js');
  ok(typeof globalThis.window.snSaver.enter === 'function' && typeof globalThis.window.snSaver.exit === 'function', 'saver: window.snSaver has enter and exit');
  const D = await import('./draw.js');
  let bad = [], plates = [];
  for (const id of SHOT_KINDS) {
    let s = 9; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const st = SHOTS[id].setup(R), pl = SHOTS[id].plate(st); plates.push(pl);
    let nan = 0, drawn = 0;
    for (const k of [0, 0.3, 0.6, 0.95]) {
      const g = recorder();
      SHOTS[id].draw({ w: 1280, h: 520, k, tau: k * 9, st, N: 3000,
        cloud: (pts, view) => { if (!pts) return; drawn++; for (let i = 0; i < pts.length; i++) if (!Number.isFinite(pts[i])) nan++; for (const v of Object.values(view)) if (typeof v === 'number' && !Number.isFinite(v)) nan++; },
        chart: (x, y, w, h, f) => { drawn++; f(g, w, h); },
        caption: () => {} });
      nan += g.bad;
    }
    if (nan || !drawn) bad.push(`${id} nan ${nan} drawn ${drawn}`);
  }
  ok(!bad.length, 'saver: every shot kind draws its subject with finite numbers', bad.join('; '));
  ok(plates.every(p => p.title && Array.isArray(p.tex) && p.tex.length && !('code' in p)), 'saver: every plate has a title and TeX, and no code');
  globalThis.__plates = plates;
}

// ── page ──────────────────────────────────────────────────────────────────
{
  const html = readFileSync(here + 'index.html', 'utf8'), css = readFileSync(here + 'style.css', 'utf8'), main = readFileSync(here + 'main.js', 'utf8');
  const heads = [...html.matchAll(/<script src="\.\.\/\.\.\/lib\/([a-z-]+)\.js"><\/script>/g)].map(m => m[1]);
  ok(heads.join(',') === 'gpu-guard,wishlist,stats-beacon' && html.indexOf('gpu-guard') < html.indexOf('<meta'), 'page: head scripts gpu-guard, wishlist, stats-beacon first');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'page: [hidden] rule in the stylesheet');
  ok(/@media \(pointer:coarse\)[\s\S]*min-height:44px/.test(css), 'page: 44 px targets on touch screens');
  const ids = [...new Set([...main.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(m => m[1]))];
  const missing = ids.filter(id => !new RegExp(`id="${id}"`).test(html));
  ok(!missing.length, `page: every id main.js binds exists in index.html (${ids.length})`, missing.join(' '));
  let err = null;
  try { await import('./main.js'); } catch (e) { err = e; }
  ok(!err || !(err instanceof SyntaxError), 'page: main.js links (only a browser global may be missing)', err ? `${err.constructor.name}: ${err.message.split('\n')[0]}` : 'ran');
}

// ── TeX on the browser path ───────────────────────────────────────────────
{
  let JSDOM = null;
  try { JSDOM = createRequire((process.env.NODE_PATH || '/nonexistent') + '/')('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) console.log('SKIP  TeX browser path: jsdom not on NODE_PATH');
  else {
    const { pathToFileURL } = await import('node:url');
    const html = readFileSync(here + 'index.html', 'utf8');
    const dec = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const eqs = [...html.matchAll(/data-tex="([^"]+)"/g)].map(m => dec(m[1]));
    for (const p of globalThis.__plates || []) eqs.push(...p.tex);
    const lib = here + '../../lib/sci-math.js';
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: pathToFileURL(here + 'index.html').href, runScripts: 'dangerously', resources: 'usable' });
    const w = dom.window;
    const src = readFileSync(lib, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(lib).href)).replace(/^export /gm, '');
    w.eval(`(function () { ${src}\n window.__sm = { typeset, loadMath }; })();`);
    const els = eqs.map(() => w.document.body.appendChild(w.document.createElement('div')));
    const out = await Promise.race([Promise.all(eqs.map((t, i) => w.__sm.typeset(els[i], t, { display: true }))), new Promise(r => setTimeout(() => r(null), 90000))]);
    const bad = out ? eqs.filter((t, i) => !out[i] || !els[i].querySelector('svg')) : eqs;
    ok(!!out && !bad.length, 'TeX: every equation of the page and the saver plates typesets (vendor MathJax)', bad.length ? bad.slice(0, 3).join(' | ') : `${eqs.length} equations`);
    w.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
