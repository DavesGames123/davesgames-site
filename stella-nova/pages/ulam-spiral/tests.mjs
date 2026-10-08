// tests.mjs - checks for the Ulam spiral page (no browser).
//
// RUN
//   node stella-nova/pages/ulam-spiral/tests.mjs
// The GPU twins of the maps (glsl.js) are checked in the page itself:
// window.__ulam.selfTest() over CDP (transform feedback and read-back).
// The process exits with code 1 when a check fails.
import * as T from './numtheory.js';
import * as L from './layouts.js';
import { densestRays, cellFamilies } from './diagonals.js';
import { fieldPlan, tentCells, TOUCH_CELLS } from './glsl.js';
import { fit3Step } from './saver.js';

let fails = 0, passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++; else fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };

// ------------------------------------------------------------- the sieve
const t0 = Date.now();
const bits = T.sieveOdd(1e8), blocks = T.prefixCounts(bits);
console.log(`sieve to 1e8: ${Date.now() - t0} ms`);
{
  // reference: trial division to 10^6
  const ref = n => { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
  let bad = 0;
  for (let n = 0; n <= 1000000; n++) if (T.bitPrime(bits, n) !== ref(n)) bad++;
  check('sieve = trial division, n <= 10^6', bad === 0, `${bad} differ`);
  for (let k = 1; k <= 8; k++) { const p = T.piFrom(bits, blocks, 10 ** k); check(`pi(10^${k}) = ${T.PI_POW10[k - 1]}`, p === T.PI_POW10[k - 1], String(p)); }
  const small = T.sieveOdd(1000);
  check('pi(1000) from a small sieve', T.piFrom(small, T.prefixCounts(small), 1000) === 168);
  check('no prime above the limit (sieve 100)', !T.bitPrime(T.sieveOdd(100), 101));
}

// ------------------------------------------------------------- Miller-Rabin
{
  let bad = 0;
  for (let i = 0; i < 1000000; i++) { const n = Math.floor(rnd() * 1e8); if (T.isPrime(n) !== T.bitPrime(bits, n)) bad++; }
  check('Miller-Rabin = sieve on 10^6 random n < 10^8', bad === 0, `${bad} differ`);
  for (const n of [2047, 3277, 4033, 4681, 8321, 15841, 29341, 42799, 49141, 52633]) check(`strong pseudoprime base 2: ${n}`, T.strongProbable(n, 2) && !T.isPrime(n));
  check('strong pseudoprime to 2,3,5,7: 3215031751', [2, 3, 5, 7].every(b => T.strongProbable(3215031751, b)) && !T.isPrime(3215031751));
  for (const n of [561, 1105, 1729, 2465, 2821, 6601, 8911]) check(`Carmichael ${n} is composite`, !T.isPrime(n));
  check('3825123056546413051 (spsp to bases 2..23) composite', !T.isPrime(3825123056546413051n));
  check('2^61 - 1 prime', T.isPrime(2n ** 61n - 1n));
  check('2^64 - 59 prime', T.isPrime(18446744073709551557n));
  check('2^64 - 1 composite', !T.isPrime(18446744073709551615n));
  check('10^12 + 39 prime', T.isPrime(1e12 + 39));
  check('10^12 + 37 composite', !T.isPrime(1e12 + 37));
  check('4294967291 (largest prime < 2^32) prime, 2^32 - 1 composite', T.isPrime(4294967291) && !T.isPrime(4294967295));
  // primes in [10^12, 10^12 + 10^4]: Miller-Rabin against a segmented reference
  const lo = 1e12, hi = lo + 10000, seg = new Uint8Array(hi - lo + 1).fill(1);
  for (let p = 2; p * p <= hi; p++) { if (!T.bitPrime(bits, p)) continue; for (let m = Math.ceil(lo / p) * p; m <= hi; m += p) seg[m - lo] = 0; }
  let b2 = 0, cnt = 0;
  for (let n = lo; n <= hi; n++) { if (seg[n - lo]) cnt++; if (T.isPrime(n) !== !!seg[n - lo]) b2++; }
  check('Miller-Rabin = segmented sieve on [10^12, 10^12 + 10^4]', b2 === 0, `${cnt} primes, ${b2} differ`);
}

// ------------------------------------------------------------- factors, li
{
  check('factor 2^53 - 1', JSON.stringify(T.factor(2 ** 53 - 1)) === '[[6361,1],[69431,1],[20394401,1]]');
  check('factor 10^12 + 38', T.factor(1e12 + 38).reduce((a, [p, e]) => a * p ** e, 1) === 1e12 + 38);
  check('factor of a square of a large prime', JSON.stringify(T.factor(999983 ** 2)) === '[[999983,2]]');
  let bad = 0;
  for (let i = 0; i < 2000; i++) { const n = 2 + Math.floor(rnd() * 1e14); const f = T.factor(n); if (f.reduce((a, [p, e]) => a * p ** e, 1) !== n || !f.every(([p]) => T.isPrime(p))) bad++; }
  check('factor: 2000 random n < 10^14 multiply back to n, all factors prime', bad === 0, `${bad} bad`);
  check('li(10^8) = 5762209.375', Math.abs(T.li(1e8) - 5762209.375) < 0.01, T.li(1e8).toFixed(3));
  check('li(10^12) = 37607950280.8', Math.abs(T.li(1e12) - 37607950280.8) < 2, T.li(1e12).toFixed(1));
}

// ------------------------------------------------------------- classes
{
  const spf = T.spfTable(1 << 20);
  const pr = n => T.bitPrime(bits, n);
  for (const mode of T.ARITH_MODES) {
    const table = T.arithBytes(mode, spf);
    let bad = 0;
    for (let i = 0; i < 20000; i++) { const n = Math.floor(rnd() * (1 << 20)); if (table[n] !== T.classify(mode, n, pr)) bad++; }
    check(`arithBytes = classify, mode ${mode}`, bad === 0, `${bad} differ`);
  }
  check('d(720720) = 240', T.classify(T.MODE.divisors, 720720, pr) === 240);
  check('twin: 17 (19), isolated: 23', T.classify(T.MODE.twin, 17, pr) === 3 && T.classify(T.MODE.twin, 23, pr) === 1);
  check('Sophie Germain 11, safe 23, both 5', T.classify(T.MODE.sophie, 11, pr) === 5 && T.classify(T.MODE.sophie, 23, pr) === 5 && T.classify(T.MODE.sophie, 29, pr) === 3 && T.classify(T.MODE.sophie, 7, pr) === 4);
  check('Gaussian primes 1+i, 3, 2+i; not 2, 5, 1+3i', T.gaussPrime(1, 1, pr) && T.gaussPrime(3, 0, pr) && T.gaussPrime(2, 1, pr) && !T.gaussPrime(2, 0, pr) && !T.gaussPrime(5, 0, pr) && !T.gaussPrime(1, 3, pr));
  check('Eisenstein primes 2, 1-w (norm 3), 2+w... not 7', T.eisensteinPrime(2, 0, pr) && T.eisensteinPrime(1, -1, pr) && !T.eisensteinPrime(7, 0, pr) && !T.eisensteinPrime(3, 0, pr));
  // Gaussian primes of norm <= 1000, counted directly: a+bi with a^2+b^2 <= 1000
  let g = 0; for (let a = -32; a <= 32; a++) for (let b = -32; b <= 32; b++) if (a * a + b * b <= 1000 && T.gaussPrime(a, b, pr)) g++;
  check('Gaussian primes with norm <= 1000: count is a multiple of 4', g % 4 === 0 && g > 0, String(g));
  check('figurate 1 (square, triangular, Fibonacci)', T.classify(T.MODE.figurate, 1, pr) === 7);
  check('figurate 36 (square, triangular), 55 (triangular, Fibonacci)', T.classify(T.MODE.figurate, 36, pr) === 3 && T.classify(T.MODE.figurate, 55, pr) === 6);
}

// ------------------------------------------------------------- the shapes
{
  const P = { ...L.DEFAULT_P };
  const variants = [P, { ...P, start: 41, cw: true, rot: 3, w: 7, L: 3, cut: 2, K: 0.75, ang: 99.5, g: 3 }, { ...P, start: 0, rot: 2, w: 210, L: 31, cut: 7, K: 2.5 }];
  for (const s of L.SHAPES) {
    let bad = 0, first = '';
    for (const Q of variants) {
      const st = L.startOf(s, Q);
      const ns = [];
      for (let k = 0; k < 3000; k++) ns.push(st + k);
      const top = s.kind === 'pt' || s.kind === '3d' ? 3e6 : s.key === 'hilbert' || s.key === 'zorder' ? 4.2e9 : 9e14;
      for (let i = 0; i < 3000; i++) ns.push(st + Math.floor(rnd() * top));
      for (const n of ns) {
        const p = L.posOf(s, n, Q);
        const m = L.nAt(s, Q, p[0], p[1], p[2] || 0);
        if (m !== n) { bad++; if (!first) first = `n=${n} -> ${p.map(v => +v.toFixed(3))} -> ${m}`; }
      }
    }
    check(`round trip n -> position -> n: ${s.key}`, bad === 0, bad ? `${bad} bad, first ${first}` : '');
  }
  // lattice shapes: the inverse covers every cell of a region exactly once
  const lat = L.SHAPES.filter(L.isLattice);
  for (const s of lat) {
    const Q = { ...P, cut: 3, L: 5, w: 13 };
    let bad = 0, cells = 0;
    const seen = new Set();
    const R = 60;
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
      const n = L.nAt(s, Q, x, y);
      const quadrant = ['cantor', 'hilbert', 'zorder'].includes(s.key) ? x >= 0 && y >= 0 : ['rows', 'snake'].includes(s.key) ? x >= 0 && x < Q.w && y <= 0 : s.key === 'klauber' ? y <= 0 && Math.abs(x) <= -y : true;
      if (!quadrant) { if (n >= 0) bad++; continue; }
      cells++;
      if (n < 0 || seen.has(n)) { bad++; continue; }
      seen.add(n);
      const p = L.posOf(s, n, Q);
      if (p[0] !== x || p[1] !== y) bad++;
    }
    check(`every cell of a ${2 * R + 1}^2 window has one number: ${s.key}`, bad === 0, `${cells} cells, ${bad} bad`);
  }
  // the spirals are paths: each step moves to a neighbour cell (square
  // family: 4-neighbour, hex family: 6-neighbour)
  for (const key of ['square', 'rect', 'rings', 'hex', 'tri', 'hilbert', 'snake']) {
    const s = L.SHAPE[key]; let bad = 0;
    for (let k = 0; k < 20000; k++) {
      if (key === 'rings' && L.sqRing(k + 1) !== L.sqRing(k)) continue;   // concentric rings jump between rings
      const a = L.posOf(s, k + L.startOf(s, P), P), b = L.posOf(s, k + 1 + L.startOf(s, P), P);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const ok = s.kind === 'hex' ? L.HD.some(d => d[0] === dx && d[1] === dy) : Math.abs(dx) + Math.abs(dy) === 1;
      if (!ok) bad++;
    }
    check(`consecutive numbers are neighbours: ${key}`, bad === 0, `${bad} jumps`);
  }
  check('square spiral: 1 at the centre, 2 to the right, 3 above 2', String(L.posOf(L.SHAPE.square, 1, P)) === '0,0' && String(L.posOf(L.SHAPE.square, 2, P)) === '1,0' && String(L.posOf(L.SHAPE.square, 3, P)) === '1,1');
  check('square spiral: 9 = 3^2 at (1,-1), 25 at (2,-2)', String(L.posOf(L.SHAPE.square, 9, P)) === '1,-1' && String(L.posOf(L.SHAPE.square, 25, P)) === '2,-2');
  check('Sacks: perfect squares on the positive x axis', [4, 9, 100, 10000].every(n => { const p = L.posOf(L.SHAPE.sacks, n, P); return Math.abs(p[1]) < 1e-9 && p[0] > 0; }));
  check('octagon cut 8 = square rings, cut 0 = diamond rings', [0, 8].every(c => { for (let k = 0; k < 5000; k++) { const p = L.octPos(k, c); const r = c ? Math.max(Math.abs(p[0]), Math.abs(p[1])) : Math.abs(p[0]) + Math.abs(p[1]); const r0 = c ? L.sqRing(k) : (() => { const q = L.diaPos(k); return Math.abs(q[0]) + Math.abs(q[1]); })(); if (r !== r0) return false; } return true; }));
}

// ------------------------------------------------------------- quadratics
{
  const pr = n => (n <= 1e8 ? T.bitPrime(bits, n) : T.isPrime(n));
  const e = T.quadConstant(1, 1, 41);
  check('C(n^2 + n + 41) = 6.6395 (2 x 3.3197732, Jacobson-Williams) within 0.1%', Math.abs(e.C / 6.6395464 - 1) < 1e-3, e.C.toFixed(5));
  const o = T.quadConstant(1, 0, 1);
  check('C(n^2 + 1) = 1.3728 (Hardy-Littlewood) within 0.1%', Math.abs(o.C / 1.3728134 - 1) < 1e-3, o.C.toFixed(5));
  const d1 = T.quadDensity(1, 1, 41, 1000, pr);
  check('n^2 + n + 41 is prime for 581 of n = 0..999', d1.observed === 581, String(d1.observed));
  check('n^2 + n + 41 is prime for n = 0..39', (() => { for (let n = 0; n < 40; n++) if (!pr(n * n + n + 41)) return false; return !pr(40 * 40 + 40 + 41); })());
  const d2 = T.quadDensity(1, 1, 41, 100000, pr);
  check('n^2 + n + 41, n < 10^5: observed / Bateman-Horn expected within 2%', Math.abs(d2.ratio - 1) < 0.02, `${d2.observed} / ${d2.expected.toFixed(0)} = ${d2.ratio.toFixed(4)}`);
  const d3 = T.quadDensity(1, 0, 1, 100000, pr);
  check('n^2 + 1, n < 10^5: observed / expected within 2%', Math.abs(d3.ratio - 1) < 0.02, `${d3.observed} / ${d3.expected.toFixed(0)} = ${d3.ratio.toFixed(4)}`);
  check('2n^2 + 2n + 2: a fixed divisor (2), C = 0', T.quadConstant(2, 2, 2).C === 0);
  check('n^2 + n: fixed divisor 2, C = 0', T.quadConstant(1, 1, 0).C === 0 && T.quadConstant(1, 1, 0).fixed === 2);
  check('n^2 - 1 is reducible', T.quadConstant(1, 0, -1).reducible);
  check('quadText', T.quadText(4, -2, 41) === '4n² − 2n + 41' && T.quadText(1, 0, -1) === 'n² − 1');
}

// ------------------------------------------------------------- diagonals
{
  const pr = n => T.bitPrime(bits, n);
  const r = densestRays({ C: 40, M: 400, start: 41, prime: pr });
  const top = r.slice(0, 2).map(x => T.quadText(x.a, x.b, x.c0, 'm')).sort().join(' | ');
  check('start 41: the two densest half-lines are the halves of n^2 + n + 41', top === '4m² + 10m + 47 | 4m² − 2m + 41', top);
  let bad = 0;
  for (let i = 0; i < 5000; i++) {
    const x = Math.floor(rnd() * 400 - 200), y = Math.floor(rnd() * 400 - 200);
    for (const q of cellFamilies(x, y, 1)) if (q.a * q.m * q.m + q.b * q.m + q.c !== 1 + L.sqIdx(x, y)) bad++;
  }
  check('cellFamilies: the quadratic gives the cell value', bad === 0, `${bad} bad`);
  const k = densestRays({ C: 40, M: 400, start: 1, prime: pr, shape: 'klauber' });
  check('Klauber: the densest column is n^2 + n + 41 shifted', k[0].a === 1 && k[0].b === 81 && k[0].c0 === 1681, T.quadText(k[0].a, k[0].b, k[0].c0, 'm'));
}

// The zoomed-out filter (glsl.js boxCells, a JS port of one axis). The odd
// n sit on one parity of the checkerboard, so along a row the marks have
// period 2 cells. Pixels pxW cells apart sample that row; the spread of the
// filtered values across pixels is the band strength (0 = no bands). The
// tent (half-width max(pxW, 2), exact integral per cell, tentCdf) must cut
// the band spread to at most 0.02 (the box: up to 0.34) and below the box
// at every zoom, and its weights must sum to 1.
{
  const cdf = (x, w) => { const u = Math.max(-1, Math.min(1, x / w)); return u < 0 ? 0.5 * (u + 1) ** 2 : 1 - 0.5 * (1 - u) ** 2; };
  const mark = x => ((x % 2) + 2) % 2;
  const box = (c, h) => { let a = 0; for (let x = Math.floor(c - h + 0.5); x <= Math.floor(c + h + 0.5); x++) a += mark(x) * Math.max(0, Math.min(c + h, x + 0.5) - Math.max(c - h, x - 0.5)); return a / (2 * h); };
  const tent = (c, w) => { let a = 0, ws = 0; for (let x = Math.floor(c - w + 0.5); x <= Math.floor(c + w + 0.5); x++) { const k = cdf(x + 0.5 - c, w) - cdf(x - 0.5 - c, w); a += mark(x) * k; ws += k; } return [a / ws, ws]; };
  let worst = 0, sumBad = 0;
  const rows = [];
  for (const pxW of [0.8, 1.1, 1.5, 1.9, 2.5, 3.3, 4.5, 5.7]) {
    const sb = [], st = [];
    for (let k = 0; k < 400; k++) { const c = 0.37 + k * pxW; sb.push(box(c, pxW / 2)); const [v, ws] = tent(c, Math.max(pxW, 2)); st.push(v); if (Math.abs(ws - 1) > 1e-9) sumBad++; }
    const sd = a => { const m = a.reduce((x, y) => x + y) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    rows.push(`${pxW}: box ${sd(sb).toFixed(3)} tent ${sd(st).toFixed(3)}`);
    worst = Math.max(worst, sd(st)); if (sd(st) > sd(sb) + 1e-9) sumBad++;
  }
  check('zoomed-out filter: the tent keeps the checkerboard bands under 0.02', worst <= 0.02 && sumBad === 0, `worst tent spread ${worst.toFixed(3)}; ${rows.join(', ')}`);
}

// The field cost on phones (glsl.js fieldPlan). The tent reads up to
// tentCells(boxMax) cells for a pixel. A touch device gets boxMax 3 and a
// pixel ratio of 1.5 to 2, so pixels x cells stay near TOUCH_CELLS (the
// box filter before f2e3ed5: 25 cells x 1.3 M px = 33 M on a 390 x 844
// phone at ratio 2). A desktop keeps ratio 2 and boxMax 6.
{
  const wantCells = [[2, 25], [3, 49], [4, 81], [6, 169]].every(([b, n]) => tentCells(b) === n);
  const rows = [], frames = [[360, 640, 3], [390, 844, 3], [844, 390, 3], [820, 1180, 2]];
  let ok = wantCells;
  for (const [w, h, d] of frames) {
    const p = fieldPlan({ w, h, dpr: d, touch: true }), px = w * h * p.dpr * p.dpr, cells = px * tentCells(p.boxMax);
    rows.push(`${w}x${h}@${d}: dpr ${p.dpr.toFixed(2)} boxMax ${p.boxMax} ${(cells / 1e6).toFixed(0)} M cells`);
    if (p.boxMax !== 3 || p.dpr < 1.5 || p.dpr > 2) ok = false;
    if (p.dpr > 1.5 && cells > TOUCH_CELLS * 1.001) ok = false;
  }
  const dk = fieldPlan({ w: 1920, h: 1080, dpr: 2, touch: false }), lo = fieldPlan({ w: 390, h: 844, dpr: 1, touch: true });
  if (dk.dpr !== 2 || dk.boxMax !== 6 || lo.dpr !== 1) ok = false;
  check('field cost: touch devices read at most 49 cells a pixel, about 40 M a frame', ok, rows.join(', ') + `; desktop dpr ${dk.dpr} boxMax ${dk.boxMax}`);
}

// The 3D saver framing (saver.js fit3Step). A model projection: the box
// scales as 1 / zoom and moves by -shift / wpp. Start too large and off
// centre (the cone hangs under the target): the loop must bring the box
// inside 86% of the clear band and centre it, and zoom must stay in 1 .. 4.
{
  const v = { cx: 195, cy: 442, cw: 390, ch: 300 };
  const rows = [];
  let ok = true;
  for (const [bw, bh, ox, oy] of [[520, 300, 0, 90], [300, 420, -40, 60], [100, 80, 0, 0]]) {
    let f = { zoom: 1, sx: 0, uy: 0 };
    const wpp = 0.5;
    const boxOf = () => { const w = bw / f.zoom, hh = bh / f.zoom, cx = v.cx + ox - f.sx / wpp, cy = v.cy + oy + f.uy / wpp; return [cx - w / 2, cy - hh / 2, cx + w / 2, cy + hh / 2]; };
    for (let i = 0; i < 300; i++) f = fit3Step(f, boxOf(), v, wpp, 1 / 60);
    const b = boxOf(), fitW = (b[2] - b[0]) / v.cw, fitH = (b[3] - b[1]) / v.ch, dx = (b[0] + b[2]) / 2 - v.cx, dy = (b[1] + b[3]) / 2 - v.cy;
    rows.push(`${bw}x${bh}: zoom ${f.zoom.toFixed(2)} fill ${Math.max(fitW, fitH).toFixed(3)} off ${dx.toFixed(1)},${dy.toFixed(1)}`);
    if (Math.max(fitW, fitH) > 0.87 || Math.abs(dx) > 2 || Math.abs(dy) > 2 || f.zoom < 1 || f.zoom > 4) ok = false;
  }
  check('3D saver framing: fit3Step puts the subject inside the clear band', ok, rows.join(', '));
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
