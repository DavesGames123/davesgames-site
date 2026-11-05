// ============================================================================
//  SPECTRAL LINES  ·  saver-tests.mjs — node checks of the screensaver
// ----------------------------------------------------------------------------
//  node stella-nova/pages/spectral-lines/saver-tests.mjs
//  Colour: 450 / 550 / 650 nm give blue / green / red; UV and IR muted.
//  Physics: Boltzmann weights finite, 0..1, and monotone in T for a line.
//  Plan: seeded, 5 to 12 s, every kind, no kind twice in a row, every
//  element and ion exists in data/lines.js with lines.
//  Plate: title, one TeX line, the NIST credit, no code.
//  Director: every kind draws frames on a stub 2D context with finite
//  numbers, and cuts at the shot length.
//  Hook (stub DOM): enter() returns { canvas, warmupMs } with the canvas in
//  the document and snSaverActive true; exit() removes canvas and style,
//  clears the plate, stops the frame loop and sets snSaverActive false.
// ============================================================================
import { createRequire } from 'node:module';
import { wlRGB, boltz, planShots, plateFor, makeDirector, installHook, termKey, lampRGB, linW, candidates, KINDS, DUR, CREDIT } from './saver.js';

const require = createRequire(import.meta.url);
const SPECTRA = require('./data/lines.js');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const dom = c => c.indexOf(Math.max(...c));
console.log(`data: ${SPECTRA.elements.length} elements, ${candidates(SPECTRA).length} spectra with 6+ visible lines`);

// ---- colour and physics ----------------------------------------------------
ok(dom(wlRGB(450)) === 2, '450 nm is blue');
ok(dom(wlRGB(550)) === 1, '550 nm is green');
ok(dom(wlRGB(650)) === 0, '650 nm is red');
ok(dom(wlRGB(300)) === 2 && Math.max(...wlRGB(300)) < 0.9, 'UV is a muted violet');
ok(dom(wlRGB(900)) === 0 && Math.max(...wlRGB(900)) < 0.9, 'IR is a muted red');
for (let nm = 200; nm <= 1100; nm += 7) ok(wlRGB(nm).every(v => v >= 0 && v <= 1), `colour in 0..1 at ${nm}`);
const na = SPECTRA.elements.find(e => e.sym === 'Na');
if (na && na.I) {
  const lamp = lampRGB(na.I.lines, l => linW(l[1]));
  ok(lamp[0] > lamp[2] && lamp[1] > lamp[2], `Na I lamp is yellow-orange (${lamp.map(v => v.toFixed(2))})`);
}
{
  let mono = 0, all = 0, fin = true;
  for (const e of SPECTRA.elements) for (const ion of ['I', 'II']) {
    const s = e[ion]; if (!s) continue;
    const Ts = [2000, 4000, 8000, 16000, 32000].map(T => boltz(s, T));
    fin = fin && Ts.every(w => Array.from(w).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
    // the raw factor exp(-Ek/kT) grows with T: the line with the largest Ek
    // must not lose weight relative to the line with the smallest Ek
    const up = s.lines.map(l => (s.levels[l[5]] || [0])[0]);
    const hi = up.indexOf(Math.max(...up)), lo = up.indexOf(Math.min(...up));
    for (let k = 1; k < Ts.length; k++) {
      all++;
      const a = Ts[k - 1][lo] > 0 ? Ts[k - 1][hi] / Ts[k - 1][lo] : 0, b = Ts[k][lo] > 0 ? Ts[k][hi] / Ts[k][lo] : 0;
      if (b >= a - 1e-12) mono++;
    }
  }
  ok(fin, 'Boltzmann weights finite and in 0..1');
  ok(mono === all, `high-level / low-level weight ratio grows with T (${mono}/${all})`);
}
ok(termKey('2p6.3p 2P* 3/2') === 'P*' && termKey('1s2.2s 2S 1/2') === 'S' && termKey('2') === '-', 'termKey');

// ---- plan ------------------------------------------------------------------
{
  const a = planShots(77, SPECTRA, 200), b = planShots(77, SPECTRA, 200), c = planShots(78, SPECTRA, 200);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed, same plan');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'other seed, other plan');
  for (const seed of [1, 2, 3, 99, 12345, 4e9]) for (const calm of [0, 0.5, 1]) {
    const p = planShots(seed, SPECTRA, 150, { calm });
    ok(p.length === 150, `seed ${seed}: 150 shots`);
    ok(p.every(s => s.dur >= DUR[0] && s.dur <= DUR[1] && s.dur >= 5 && s.dur <= 12), `seed ${seed} calm ${calm}: shots of 5 to 12 s`);
    let rep = 0; for (let i = 1; i < p.length; i++) if (p[i].kind === p[i - 1].kind) rep++;
    ok(rep === 0, `seed ${seed}: no kind twice in a row`);
    ok(KINDS.every(k => p.some(s => s.kind === k)), `seed ${seed}: every kind plays`);
    const has = (z, ion) => { const e = SPECTRA.elements.find(x => x.z === z); return !!(e && e[ion] && e[ion].lines.length); };
    ok(p.every(s => (s.kind === 'stack' ? s.from >= 0 && s.from < SPECTRA.elements.length : s.kind === 'compare' ? has(s.a.z, s.a.ion) && has(s.b.z, s.b.ion) && s.a.z !== s.b.z : has(s.z, s.ion))), `seed ${seed}: every element and ion exists`);
  }
}

// ---- plate -----------------------------------------------------------------
{
  const p = planShots(5, SPECTRA, 40);
  for (const sh of p) {
    const P = plateFor(sh, null, { Na: 'Sodium' }, SPECTRA);
    ok(P.title && P.title.length > 1, `${sh.kind}: title`);
    ok(Array.isArray(P.tex) && P.tex.length === 1, `${sh.kind}: one TeX line`);
    ok(P.lines.includes(CREDIT) && /NIST/.test(CREDIT), `${sh.kind}: NIST credit`);
    ok(!('code' in P), `${sh.kind}: no code`);
  }
}

// ---- director on a stub 2D context -----------------------------------------
function stubCtx() {
  const st = { calls: 0, bad: 0 };
  const grad = { addColorStop() {} };
  const g = new Proxy({}, {
    get(o, k) {
      if (k === 'st') return st;
      if (k in o) return o[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      return (...args) => { st.calls++; if (args.some(a => typeof a === 'number' && !Number.isFinite(a))) st.bad++; };
    },
    set(o, k, v) { o[k] = v; if (typeof v === 'number' && !Number.isFinite(v)) st.bad++; return true; },
  });
  return g;
}
{
  const plates = [];
  for (const kind of KINDS) {
    const D = makeDirector(SPECTRA, { seed: 9, calm: 0.4, label: x => plates.push(x) });
    let n = 0; while (D.shot().kind !== kind && n++ < 20) D.cut();
    ok(D.shot().kind === kind, `director reaches ${kind}`);
    const g = stubCtx(), dur = D.shot().dur;
    for (let f = 0; f < Math.ceil(dur * 30) - 2; f++) { D.tick(1 / 30); D.draw(g, 1280, 720, f % 2 ? { t: 160, b: 190, w: 1280 } : null, 1 / 30); }
    ok(D.shot().kind === kind, `${kind}: holds until its end`);
    ok(g.st.calls > 100 && g.st.bad === 0, `${kind}: draws with finite numbers (${g.st.calls} calls, ${g.st.bad} bad)`);
    for (let f = 0; f < 10; f++) D.tick(1 / 30);
    ok(D.shot().kind !== kind, `${kind}: cuts at ${dur} s`);
  }
  ok(plates.length > KINDS.length && plates.every(p => p && p.title), `plates sent (${plates.length})`);
}

// ---- hook with a stub DOM --------------------------------------------------
{
  const nodes = new Set(), rafs = new Map(); let rid = 0;
  const el = tag => {
    const e = { tagName: tag, style: {}, attrs: {}, clientWidth: 800, clientHeight: 600, width: 0, height: 0,
      setAttribute(k, v) { this.attrs[k] = v; }, remove() { nodes.delete(this); }, getContext: () => stubCtx() };
    return e;
  };
  const doc = { createElement: el, head: { appendChild: n => nodes.add(n) }, body: { appendChild: n => nodes.add(n) }, getElementById: () => null };
  const events = [];
  const win = { document: doc, SPECTRA, innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, parent: null,
    requestAnimationFrame: f => { rafs.set(++rid, f); return rid; }, cancelAnimationFrame: id => rafs.delete(id),
    CustomEvent: class { constructor(n) { this.type = n; } }, dispatchEvent: e => events.push(e.type) };
  win.parent = win;
  globalThis.window = win;   // plateBand reads window.parent
  const hook = installHook(win);
  let plateNull = false; const plates = [];
  const r = hook.enter({ calm: 0.5, seconds: 60, caption: true, seed: 42, label: x => { if (x === null) plateNull = true; else plates.push(x); } });
  ok(r && r.canvas && nodes.has(r.canvas) && r.warmupMs > 0, 'enter returns { canvas, warmupMs } with the canvas in the document');
  ok(win.snSaverActive === true && events.includes('sn-saver-enter'), 'snSaverActive and sn-saver-enter');
  await new Promise(res => setTimeout(res, 20));
  let ts = 0;
  for (let f = 0; f < 400; f++) { const fns = [...rafs.entries()]; rafs.clear(); for (const [, fn] of fns) fn(ts += 33); }
  ok(r.canvas.width === 1600 && r.canvas.height === 1200, 'canvas at device pixels');
  ok(plates.length >= 2, `hook sends plates (${plates.length})`);
  ok(hook.debug() && hook.debug().i >= 1, 'hook cuts to the next shot');
  hook.exit();
  ok(!nodes.has(r.canvas) && nodes.size === 0, 'exit removes the canvas and the style');
  ok(plateNull && win.snSaverActive === false && events.includes('sn-saver-exit'), 'exit clears the plate and snSaverActive');
  ok(rafs.size === 0, 'exit stops the frame loop');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
