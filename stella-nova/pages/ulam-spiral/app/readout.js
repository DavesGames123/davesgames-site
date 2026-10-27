// ============================================================================
//  ULAM SPIRAL  ·  app/readout.js — hover, the readout card, the tables
// ----------------------------------------------------------------------------
//  hoverAt finds the number under a screen point (2D cell, point or 3D
//  point). showReadout fills #readout with its factors, its prime tags
//  and the quadratics through it. updatePi and updateQuad fill the prime
//  count and quadratic tables of the panel; updateStatus and statusRight
//  fill the status line.
//
//  GREP MAP
//    grep -n 'export function hoverAt'      the number under a screen point
//    grep -n 'export function showReadout'  the readout card
//    grep -n 'function quadIndex'           k with f(k) = n, or -1
//    grep -n 'export function updatePi'     pi(N), N / ln N, li(N)
//    grep -n 'export function updateQuad'   C(f), observed / expected
//    grep -n 'export function statusRight'  the n range and the sieve
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';
import { cellFamilies } from '../diagonals.js';
import { S, rt } from './state.js';
import { $ } from './dom.js';
import { MODES } from './palettes.js';
import { fmt, fmtS, gaussText, eisenText } from './format.js';
import { is3D, toWorld, cam3Mats, project3 } from './camera.js';
import { startOf, home3, n3Count, nSpan } from './framing.js';
import { frameState } from './frame.js';
import { isPrimeN } from './numbers.js';

// The number under the screen point (sx, sy): { n, w (world xy), cell }.
export function hoverAt(sx, sy, v = rt.VW) {
  const sh = S.shape;
  if (S.morph) return null;
  if (is3D(sh)) {
    const fs = frameState(v), c3 = cam3Mats(S.cam3 || home3(sh), v);
    if (!fs.points || fs.points.count > 200000) return null;
    let best = null, bd = 14 * 14;
    for (let n = fs.points.n0; n < fs.points.n0 + fs.points.count; n++) {
      const p = L.posOf(sh, n, S.P), q = p && project3(c3.mvp, p, v);
      if (!q) continue;
      const d = (q[0] - sx) ** 2 + (q[1] - sy) ** 2;
      if (d < bd) { bd = d; best = { n, w: null, scr: q }; }
    }
    return best;
  }
  const [wx, wy] = toWorld(sx, sy, v);
  if (L.isLattice(sh)) {
    const cell = L.cellAt(sh, wx, wy), n = L.nAt(sh, S.P, cell[0], cell[1]);
    return { n, w: L.worldOf(sh, cell[0], cell[1]), cell };
  }
  const n = L.nAt(sh, S.P, wx, wy, 0, Math.max(0.9, 10 / S.cam.z));
  if (n < 0) return { n: -1 };
  const p = L.posOf(sh, n, S.P);
  return { n, w: [p[0], p[1]] };
}
export function showReadout(h) {
  const el = $('readout');
  if (!h || h.n < 0) { el.innerHTML = ''; return; }
  const sh = S.shape, n = h.n;
  if (sh.lattice && h.cell) {
    const [a, b] = L.latticeNumber(sh, h.cell[0], h.cell[1]);
    const gauss = sh.lattice === 'gauss';
    const gp = gauss ? T.gaussPrime(a, b, isPrimeN) : T.eisensteinPrime(a, b, isPrimeN);
    const N = gauss ? a * a + b * b : a * a - a * b + b * b;
    el.innerHTML = `<div class="n${gp ? ' p' : ''}">${gauss ? gaussText(a, b) : eisenText(a, b)}</div><div class="f">norm ${fmt(N)} = ${N > 1 ? T.factorText(N) : N}</div>`
      + `<div class="k">${gp ? `<b>${gauss ? 'Gaussian' : 'Eisenstein'} prime</b>` : 'not prime in this ring'} · index ${fmt(n)}</div>`;
    return;
  }
  const pr = isPrimeN(n);
  const f = n > 1 && n < 2 ** 53 ? T.factor(n) : [];
  const fact = n < 2 ? String(n) : pr ? 'prime' : T.factorText(n);
  const lines = [];
  if (n > 1 && !pr) lines.push(`d(n) <b>${T.divisorsOf(f)}</b> · φ(n)/n <b>${(T.totientOf(n, f) / n).toFixed(3)}</b>`);
  if (pr) {
    const tw = [2, 4, 6].filter(g => isPrimeN(n - g) || isPrimeN(n + g)).map(g => ({ 2: 'twin', 4: 'cousin', 6: 'sexy' })[g]);
    const sg = isPrimeN(2 * n + 1), sf = n > 2 && isPrimeN((n - 1) / 2);
    const tags = [...tw, sg ? 'Sophie Germain' : '', sf ? 'safe' : ''].filter(Boolean);
    lines.push(tags.length ? tags.join(' · ') : 'isolated prime');
  }
  if (sh.key === 'square' && h.cell) {
    const [cx, cy] = L.unorient(h.cell[0], h.cell[1], S.P);
    const fam = cellFamilies(cx, cy, S.P.start);
    for (const q of fam) lines.push(`<span class="q">${T.quadText(q.a, q.b, q.c, 'm')}</span>, m = ${q.m}`);
  }
  if (S.quad.on) {
    const k = quadIndex(n);
    if (k >= 0) lines.push(`<span class="q">f(${k}) = n</span>`);
  }
  el.innerHTML = `<div class="n${pr ? ' p' : ''}">${fmt(n)}</div><div class="f">${fact}</div><div class="k">${lines.join('<br>')}</div>`;
}
function quadIndex(n) {
  const { a, b, c } = S.quad;
  let k0;
  if (a === 0) { if (b === 0) return n === c ? 0 : -1; k0 = (n - c) / b; }
  else { const D = b * b - 4 * a * (c - n); if (D < 0) return -1; k0 = (-b + Math.sqrt(D)) / (2 * a); }
  const k = Math.round(k0);
  for (let kk = k - 1; kk <= k + 1; kk++) if (kk >= 0 && a * kk * kk + b * kk + c === n) return kk;
  return -1;
}

// --- prime count and quadratic readouts -------------------------------------------------------
export function updatePi(v) {
  if (!S.bits) return;
  let N;
  if (is3D(S.shape)) N = startOf() + n3Count(S.shape, S.cam3 || home3(S.shape));
  else if (L.isLattice(S.shape)) N = nSpan(S.shape, v).hi;
  else { const fs = frameState(v); N = fs.points ? fs.points.n0 + fs.points.count - 1 : 0; }
  if (!(N > 2)) return;
  const cap = Math.min(N, S.limit);
  if (cap === rt.piAt) return;
  rt.piAt = cap;
  const pi = T.piFrom(S.bits, S.blocks, cap), nl = cap / Math.log(cap), li = T.li(cap) - T.li(2);
  $('piRead').innerHTML = `<tr><td>N${N > S.limit ? ' (sieve end)' : ''}</td><td>${fmt(cap)}</td></tr>`
    + `<tr><td>π(N)</td><td class="big">${fmt(pi)}</td></tr>`
    + `<tr><td>N / ln N</td><td>${fmt(nl)} <small>(${(pi / nl).toFixed(4)})</small></td></tr>`
    + `<tr><td>li(N)</td><td>${fmt(li)} <small>(${(pi / li).toFixed(5)})</small></td></tr>`;
  S.piInfo = { N: cap, pi, nl, li };
}
export function updateQuad() {
  const q = S.quad, el = $('quadRead');
  if (!S.bits) { el.innerHTML = ''; return; }
  const info = T.quadConstant(q.a, q.b, q.c);
  const N = 10000;
  const d = T.quadDensity(q.a, q.b, q.c, N, isPrimeN, info);
  let note = '';
  if (q.a < 0) note = 'a < 0: the values turn negative.';
  else if (d.reducible) note = 'f factors over the integers: only finitely many primes.';
  else if (d.fixed) note = `every f(n) is divisible by ${d.fixed}.`;
  el.innerHTML = `<tr><td>f(n)</td><td>${T.quadText(q.a, q.b, q.c)}</td></tr>`
    + `<tr><td>C(f)</td><td class="big">${d.C.toFixed(4)}</td></tr>`
    + `<tr><td>primes, n &lt; ${fmt(N)}</td><td>${fmt(d.observed)}</td></tr>`
    + `<tr><td>expected</td><td>${fmt(d.expected)}</td></tr>`
    + `<tr><td>observed / expected</td><td>${d.ratio.toFixed(3)}</td></tr>`
    + (note ? `<tr><td colspan="2" style="text-align:left;color:var(--warm)">${note}</td></tr>` : '');
  S.quadInfo = d;
}

// --- the status line ----------------------------------------------------------------------------
export function updateStatus() {
  const m = MODES.find(x => x.id === S.mode);
  $('stShape').textContent = `${S.shape.name} · ${m ? m.name : ''}${S.quad.on ? ' · f(n) = ' + T.quadText(S.quad.a, S.quad.b, S.quad.c) : ''}`;
}
export function statusRight(v) {
  let t = '';
  if (L.isLattice(S.shape) && !S.morph) { const sp = nSpan(S.shape, v); if (sp.hi >= 0) t = `n ${fmtS(Math.max(0, sp.lo))} – ${fmtS(sp.hi)}`; if (S.tileOn) t += S.tile.pending ? ' · Miller–Rabin …' : ' · Miller–Rabin tile'; }
  else if (rt.lastState && rt.lastState.points) t = `${fmt(rt.lastState.points.count)} numbers`;
  $('stRight').textContent = t + (S.bits ? ` · sieve ${fmtS(S.limit)}` : ' · sieving …');
}
