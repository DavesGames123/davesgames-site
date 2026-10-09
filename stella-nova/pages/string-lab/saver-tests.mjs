// STRING LAB · saver-tests.mjs — node tests for the pure parts of saver.js
//   node stella-nova/pages/string-lab/saver-tests.mjs
// The plan (seeded bag, no repeats, 6-12 s), the colour maps, the slow-motion
// choice, the spring, the plates (no code, one TeX line), the pane rects and
// the TAB columns. The page run of every shot is a jsdom check outside the repo.
import {
  makePlan, shuffleBag, rngFrom, shotSeconds, pickMap, slowFor, springStep, plateFor, seriesRatio,
  layoutRects, tabColumns, fallbackSteps, drawTab, settleTouch, exaggerationFor, SHOT_KEYS, SHOTS, TEX, SEQ_MAPS, DIV_MAPS,
} from './saver.js';
import { INSTRUMENTS, stringParams } from './engine/instruments.js';
import { StringSim } from './engine/strings.js';
import * as CM from '../ct-lab/colormaps/maps.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const group = (name, fn) => { const p = pass, f = fail; fn(); console.log(`${name}: ${pass - p} passed, ${fail - f} failed`); };

group('plan', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const P = makePlan({ seed, calm: (seed % 11) / 10 });
    let last = null, lastMap = null;
    const seen = [];
    for (let k = 0; k < 60; k++) {
      const s = P.next();
      seen.push(s.key);
      if (s.key === last) { ok(false, `seed ${seed} repeat ${s.key} at ${k}`); break; }
      if (s.cmap === lastMap) { ok(false, `seed ${seed} map repeat ${s.cmap}`); break; }
      if (!(s.seconds >= 6 && s.seconds <= 12)) { ok(false, `seed ${seed} seconds ${s.seconds}`); break; }
      last = s.key; lastMap = s.cmap;
    }
    // every bag of 6 holds each shot once
    for (let b = 0; b < 10; b++) ok(new Set(seen.slice(b * 6, b * 6 + 6)).size === 6, `seed ${seed} bag ${b} complete`);
  }
  const orders = new Set();
  for (let seed = 1; seed <= 50; seed++) { const P = makePlan({ seed }); orders.add([0, 1, 2, 3, 4, 5].map(() => P.next().key).join(',')); }
  ok(orders.size >= 30, `seeds give different orders (${orders.size} of 50)`);
  const P = makePlan({ seed: 9 });
  P.next();
  const f = P.next('melody');
  ok(f.key === 'melody', 'forced shot');
});

group('bag and maps', () => {
  const rng = rngFrom(5);
  for (let k = 0; k < 500; k++) { const b = shuffleBag(rng, SHOT_KEYS, 'bow'); ok(b[0] !== 'bow' && b.length === 6, 'bag start'); }
  for (let k = 0; k < 200; k++) ok(pickMap(rng, ['magma', 'inferno'], 'magma') === 'inferno', 'pluck map alternates');
  for (const id of [...SEQ_MAPS, ...DIV_MAPS]) ok(CM.has(id), `map ${id} exists in ct-lab`);
  for (const id of DIV_MAPS) ok(CM.get(id).kind === 'diverging', `${id} is diverging`);
  const P = makePlan({ seed: 3 });
  for (let k = 0; k < 120; k++) { const s = P.next(); if (s.key === 'pluck') ok(s.cmap === 'magma' || s.cmap === 'inferno', 'pluck blooms in magma or inferno'); if (s.key === 'bow') ok(DIV_MAPS.includes(s.cmap), 'bow uses a diverging map'); }
  ok(shotSeconds(() => 0, 0) === 6 && shotSeconds(() => 0.999999, 1) <= 12, 'seconds bounds');
});

group('slow motion', () => {
  ok(Math.abs(slowFor(110, 0.11) - 1e-3) < 1e-12, '110 Hz at 0.11 cycles/s is 1/1000');
  ok(slowFor(1e6) === 1e-4 && slowFor(0.01) === 1, 'clamped to the page range');
  ok(slowFor(NaN) === 0.01, 'bad frequency');
  for (const inst of Object.values(INSTRUMENTS)) for (const s of inst.strings) {
    const f = 1 / (2 * inst.scaleM) * Math.sqrt(s.T / s.mu);
    const ts = slowFor(f, 0.14);
    ok(ts * f > 0.13 && ts * f < 0.15, `${inst.label} ${s.name}: a pluck cycle every ~7 s`);
  }
});

group('spring', () => {
  let x = 0, v = 0;
  for (let k = 0; k < 600; k++) [x, v] = springStep(x, v, 1, 2.5, 1 / 60);
  ok(Math.abs(x - 1) < 1e-3 && Math.abs(v) < 1e-3, `settles (${x.toFixed(5)})`);
  x = 0; v = 0; let over = 0;
  for (let k = 0; k < 600; k++) { [x, v] = springStep(x, v, 1, 2.5, 1 / 60); over = Math.max(over, x - 1); }
  ok(over <= 1e-12, 'critically damped: no overshoot');
  [x, v] = springStep(0.3, 0.2, 0.3, 2, 0);
  ok(x === 0.3 && v === 0.2, 'dt 0 keeps the state');
  let a = [0, 0], b = [0, 0];
  for (let k = 0; k < 60; k++) a = springStep(a[0], a[1], 1, 2, 1 / 60);
  for (let k = 0; k < 6; k++) b = springStep(b[0], b[1], 1, 2, 1 / 6);
  ok(Math.abs(a[0] - b[0]) < 1e-12, 'exact: frame rate does not change the path');
});

group('plates', () => {
  const facts = {
    pluck: { inst: 'steel', string: 'A', note: 'A2', f: 110, n: 5, ts: 1e-3 },
    strum: { inst: 'classical', chord: 'Am', note: 'A2', f: 110, chordRatio: '4 : 6 : 8 : 10 : 12', ts: 0.01 },
    bow: { inst: 'violin', string: 'A', note: 'A4', f: 440, ts: 0.003 },
    nodes: { inst: 'violin', string: 'D', note: 'D4', f: 293.7, n: 3, ts: 0.001 },
    melody: { inst: 'violin', track: 'Minuet in G', note: 'D5', f: 587.3, ratio: '3 : 2', ratioName: 'perfect fifth', ts: 0.02 },
    series: { inst: 'steel', string: 'E', note: 'E2', f: 82.4, n: 3, ts: 1e-3, ...seriesRatio(3) },
  };
  for (const k of SHOT_KEYS) {
    for (const f of [facts[k], {}]) {
      const p = plateFor(k, f);
      ok(p.title && typeof p.title === 'string', `${k} title`);
      ok(!('code' in p), `${k} has no code`);
      ok(Array.isArray(p.tex) && p.tex.length === 1 && Object.values(TEX).includes(p.tex[0]), `${k} one TeX line from the three`);
      const txt = JSON.stringify(p);
      ok(!/undefined|NaN|null/.test(txt), `${k} plate has no undefined/NaN (${Object.keys(f).length ? 'facts' : 'empty'})`);
      ok(!/yamaha/i.test(txt), `${k} plate has no brand name`);
      ok(p.params.some((q) => q.name === 'instrument'), `${k} names the instrument`);
    }
    ok(SHOTS[k] && typeof SHOTS[k].start === 'function', `${k} shot exists`);
  }
  ok(/Hz/.test(JSON.stringify(plateFor('pluck', facts.pluck))), 'pluck frequency in Hz');
  ok(JSON.stringify(plateFor('nodes', facts.nodes)).includes('3 : 1'), 'nodes ratio');
  ok(JSON.stringify(plateFor('melody', facts.melody)).includes('perfect fifth'), 'melody interval');
  ok(seriesRatio(2).ratioName === 'octave' && seriesRatio(3).ratioName === 'perfect fifth' && seriesRatio(4).ratioName === 'perfect fourth' && seriesRatio(5).ratioName === 'major third', 'series ratios name the intervals');
});

group('rects', () => {
  for (const [W, H] of [[1280, 800], [1920, 1080], [390, 844], [800, 800], [720, 1280]]) {
    for (const band of [null, { t: 220, b: 260 }, { t: H * 0.35, b: H * 0.35 }]) {
      for (const lay of ['split', 'full3d', 'full2d']) for (const tab of [false, true]) {
        const r = layoutRects(lay, W, H, band, tab);
        const t = band ? band.t : H * 0.06, b = band ? band.b : H * 0.06;
        const inside = (q) => q.x >= 0 && q.y >= t - 0.5 && q.x + q.w <= W + 0.5 && q.y + q.h <= H - b + 0.5 && q.w > 0 && q.h > 0;
        if (r.p2) ok(inside(r.p2), `${W}x${H} ${lay} 2D pane in the band`);
        if (r.tab) ok(inside(r.tab) && r.tab.y >= r.p2.y + r.p2.h, `${W}x${H} ${lay} TAB under the 2D pane`);
        ok(lay === 'full3d' ? r.p2 === null : !!r.p2, `${W}x${H} ${lay} pane shown or hidden`);
        ok(r.c3.y >= t - 0.5 && r.c3.y <= H - b + 0.5 && r.c3.fit >= 1 && Number.isFinite(r.c3.fit), `${W}x${H} ${lay} 3D centre in the band`);
      }
    }
  }
});

group('tab', () => {
  for (const inst of Object.values(INSTRUMENTS)) {
    const st = fallbackSteps(inst);
    ok(st.length === 15 && st.every((s) => s.notes.length === 1), `${inst.label} fallback phrase maps every note`);
    const cols = tabColumns(st, inst.strings.length);
    ok(cols.every((c) => c.frets.length === inst.strings.length && c.frets.filter((f) => f >= 0).length === 1), `${inst.label} TAB columns`);
    const calls = [];
    const g = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, a])), set: (t, k, v) => { t[k] = v; return true; } });
    drawTab(g, { x: 10, y: 10, w: 600, h: 100 }, cols, 3, inst.strings.map((s) => s.name));
    const nums = calls.filter((c) => c[0] === 'fillText').flatMap((c) => c[1].slice(1));
    ok(nums.length > 0 && nums.every(Number.isFinite), `${inst.label} TAB draws finite text positions`);
  }
});

group('touch', () => {
  // projections of u and v on sin(m pi x / L): harmonic n must dominate
  const amps = (s) => { const N = s.N, out = []; for (let m = 1; m <= 10; m++) { let b = 0, c = 0; for (let i = 1; i < N; i++) { const w = Math.sin(m * Math.PI * i / N); b += s.u[i] * w; c += s.v[i] * w; } out.push(Math.hypot(b, c / (2 * Math.PI * m * s.f1Stiff))); } return out; };
  for (const inst of Object.values(INSTRUMENTS)) for (let si = 0; si < inst.strings.length; si++) for (const n of [2, 3, 4, 5]) {
    const s = new StringSim(stringParams(inst, si, 0));
    const pp = Math.abs(Math.sin(n * Math.PI * inst.pluckPos)) < 0.2 ? 0.13 : inst.pluckPos;
    s.pluck({ pos: pp, amp: 0.002, width: 0.02 });
    s.touch({ pos: 1 / n, strength: 4000, seconds: 0.08 });     // the page's harmonic() touch
    settleTouch(s, n);
    const a = amps(s), other = Math.max(...a.filter((_, m) => (m + 1) % n));
    const x = exaggerationFor(s, n * s.f1Stiff);
    ok(x >= 1 && x <= 500, `${inst.label} ${inst.strings[si].name} harmonic ${n}: exaggeration ${x.toFixed(0)} in the page range`);
    ok(a[n - 1] / other > 50 && Number.isFinite(s.energy()), `${inst.label} ${inst.strings[si].name} harmonic ${n}: ${(a[n - 1] / other).toFixed(0)}x the strongest other mode`);
  }
});

console.log(`\nsaver: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
