// ============================================================================
//  TWENTY TO FOUR  ·  tests.mjs — node stella-nova/pages/twenty-to-four/tests.mjs
// ----------------------------------------------------------------------------
//  FIELD (field.js)
//    falloff     near field |E| r³ constant, far field |E| r constant,
//                the three terms equal at kr = 1
//    pattern     radiated power per solid angle ∝ sin²θ
//    laws        ∇·B = 0, ∇·E = 0, ∇×E = −∂B/∂t, ∇×B = ∂E/∂t away from
//                the source (c = 1)
//    potentials  E = −∇φ − ∂A/∂t, B = ∇×A, Lorenz condition
//    gauge       A + ∇χ, φ − ∂χ/∂t give the same E and B
//    lines       E is tangent to the level lines of Q
//    reduction   the three written-out curl lines equal the ε_ijk vector
//                curl and the loop circulation over area; the three
//                ∂_iF_i terms equal the cube's face-pair fluxes over volume
//    forms       dF = 0 and d⋆F = 0 in all four components, and each
//                component equals the vector law it names
//    display     the shader's display value (quantity / k² times r) peaks
//                near 1 in the far zone for every λ, and SHEET_FS
//                multiplies no display value by kr
//  EQUATIONS AND STORY (tex.js, glyphs.js, math.js, story.js)
//    twenty      Maxwell's 20 lines in 8 groups, each line in one group
//    glyphs      every TeX entry is typeset; indices, colours and numbers
//                in range
//    colours     each law carries the colours of its fields
//    story       every {{key}} and data-eq in the chapters exists; every
//                widget name is one main.js builds
//    svg         eqSVG gives one <use> per glyph, with the colour class
//  SHELL (index.html, style.css)
//    head        gpu-guard, wishlist, stats-beacon first, in that order;
//                sci.css after style.css; main.js as a module
//    css         [hidden] guard; no uppercase or letter-spaced labels;
//                no KaTeX anywhere in the page
// ============================================================================
import * as f from './field.js';
import { TEX, MAXWELL, GROUPS } from './tex.js';
import { GLYPHS, EQ } from './glyphs.js';
import { eqSVG, eqBox } from './math.js';
import { CHAPTERS } from './story.js';
import { SHEET_FS } from './render.js';
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
const norm = v => Math.hypot(...v);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const k = f.kOf(1);   // λ = 1

// Sample points off the axis and off the source, in general position.
const PTS = [[0.55, 0.12, 0.35], [-0.3, 0.7, -0.4], [1.3, -0.9, 0.6], [0.2, 0.05, -0.25], [2.4, 1.1, -1.7]];
const TS = [0, 0.137, 0.61];

// ── falloff ───────────────────────────────────────────────────────────────
{
  const r0 = 0.002, a = f.ampE(r0, Math.PI / 2, k) * r0 ** 3, b = f.ampE(2 * r0, Math.PI / 2, k) * (2 * r0) ** 3;
  ok(rel(a, b) < 0.01, 'falloff: near field |E| r³ is constant (kr ≪ 1)', `ratio ${(a / b).toFixed(5)}`);
  const R = 60, c = f.ampE(R, Math.PI / 2, k) * R, d = f.ampE(2 * R, Math.PI / 2, k) * 2 * R;
  ok(rel(c, d) < 0.01, 'falloff: far field |E| r is constant (kr ≫ 1)', `ratio ${(c / d).toFixed(5)}`);
  // Log slope of |E| between two radii: −3 near, −1 far.
  const slope = (r1, r2) => Math.log(f.ampE(r2, Math.PI / 2, k) / f.ampE(r1, Math.PI / 2, k)) / Math.log(r2 / r1);
  const sn = slope(0.001, 0.002), sf = slope(40, 80);
  ok(Math.abs(sn + 3) < 0.02 && Math.abs(sf + 1) < 0.02, 'falloff: log slope −3 near, −1 far', `near ${sn.toFixed(3)}, far ${sf.toFixed(3)}`);
  let worst = 0;
  for (const x of [0.05, 0.3, 1, 2.5, 9, 40]) worst = Math.max(worst, rel(f.ampEquator(x) * k ** 3, f.ampE(x / k, Math.PI / 2, k, 512)));
  ok(worst < 1e-3, 'falloff: the chart curve (closed form) matches the sampled |E| on the equator', `max ${worst.toExponential(2)}`);
  const t = f.termAmps(1);
  ok(t[0] === 1 && t[1] === 1 && t[2] === 1, 'falloff: the three terms are equal at kr = 1');
}

// ── pattern ───────────────────────────────────────────────────────────────
{
  const R = 80, p90 = f.powerPattern(R, Math.PI / 2, k);
  let worst = 0;
  for (const th of [0.3, 0.6, 0.9, 1.2, 2.0, 2.6]) worst = Math.max(worst, rel(f.powerPattern(R, th, k) / p90, Math.sin(th) ** 2));
  ok(worst < 0.01 && p90 > 0, 'pattern: radiated power per solid angle is ∝ sin²θ', `worst relative error ${worst.toExponential(2)}`);
  ok(Math.abs(f.powerPattern(R, 1e-4, k) / p90) < 1e-6, 'pattern: no power along the axis');
}

// ── laws ──────────────────────────────────────────────────────────────────
{
  let dB = 0, dE = 0, far = 0, amp = 0;
  const E = [0, 0, 0], B = [0, 0, 0], Et = [0, 0, 0], Bt = [0, 0, 0];
  for (const P of PTS) for (const t of TS) {
    const FE = f.fieldFn('E', t, k), FB = f.fieldFn('B', t, k);
    const sc = f.ampE(norm(P), Math.acos(P[2] / norm(P)), k) * k;   // a natural size for a derivative here
    dB = Math.max(dB, Math.abs(f.divFD(FB, P, 1e-4)) / sc);
    dE = Math.max(dE, Math.abs(f.divFD(FE, P, 1e-4)) / sc);
    f.dEdt(P[0], P[1], P[2], t, k, Et, Bt);
    far = Math.max(far, norm(f.curlFD(FE, P, 1e-4).map((v, i) => v + Bt[i])) / sc);
    amp = Math.max(amp, norm(f.curlFD(FB, P, 1e-4).map((v, i) => v - Et[i])) / sc);
    f.EB(P[0], P[1], P[2], t, k, E, B);
  }
  ok(dB < 1e-6, 'laws: ∇·B = 0', `max ${dB.toExponential(2)}`);
  ok(dE < 1e-6, 'laws: ∇·E = 0 away from the source', `max ${dE.toExponential(2)}`);
  ok(far < 1e-6, 'laws: ∇×E = −∂B/∂t (Faraday)', `max ${far.toExponential(2)}`);
  ok(amp < 1e-6, 'laws: ∇×B = ∂E/∂t (Ampère–Maxwell in vacuum, c = 1)', `max ${amp.toExponential(2)}`);
  // The closed-form time derivative agrees with a finite difference in t.
  const P = PTS[0], h = 1e-6, a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
  f.EB(...P, 0.3 + h, k, a, c); f.EB(...P, 0.3 - h, k, b, d); f.dEdt(...P, 0.3, k, Et, Bt);
  ok(rel(norm(Et), norm(a.map((v, i) => (v - b[i]) / (2 * h)))) < 1e-6, 'laws: closed-form ∂E/∂t agrees with a finite difference');
}

// ── potentials ────────────────────────────────────────────────────────────
const fromPotentials = f.fromPotentials;
{
  let eE = 0, eB = 0, eL = 0;
  const E = [0, 0, 0], B = [0, 0, 0];
  for (const P of PTS) for (const t of TS) {
    const r = fromPotentials(P, t, (x, y, z, tt) => f.potentials(x, y, z, tt, k));
    f.EB(...P, t, k, E, B);
    const s = Math.max(norm(E), 1e-3);
    eE = Math.max(eE, norm(sub(r.E, E)) / s); eB = Math.max(eB, norm(sub(r.B, B)) / s); eL = Math.max(eL, Math.abs(r.lorenz) / (s * k));
  }
  ok(eE < 1e-5, 'potentials: E = −∇φ − ∂A/∂t', `max ${eE.toExponential(2)}`);
  ok(eB < 1e-5, 'potentials: B = ∇×A', `max ${eB.toExponential(2)}`);
  ok(eL < 1e-5, 'potentials: Lorenz condition ∇·A + ∂φ/∂t = 0', `max ${eL.toExponential(2)}`);
}

// ── gauge ─────────────────────────────────────────────────────────────────
{
  let worst = 0, moved = 0;
  const c = [0.6, 0, 0.3], w = 0.35, g = 0.8;
  for (const P of [[0.55, 0.05, 0.35], [0.8, -0.1, 0.1], [0.4, 0.2, 0.5]]) for (const t of TS) {
    const plain = fromPotentials(P, t, (x, y, z, tt) => f.potentials(x, y, z, tt, k));
    const gauged = fromPotentials(P, t, (x, y, z, tt) => {
      const p = f.potentials(x, y, z, tt, k), G = f.gauge(x, y, z, tt, k, g, c, w);
      return [p[0] - G[4], p[1] + G[1], p[2] + G[2], p[3] + G[3]];
    });
    const s = Math.max(norm(plain.E), 1e-3);
    worst = Math.max(worst, norm(sub(gauged.E, plain.E)) / s, norm(sub(gauged.B, plain.B)) / s);
    const G = f.gauge(...P, t, k, g, c, w);
    moved = Math.max(moved, Math.hypot(G[1], G[2], G[3]));
  }
  ok(moved > 0.5, 'gauge: the blob changes A a lot', `max |∇χ| ${moved.toFixed(2)}`);
  ok(worst < 1e-5, 'gauge: E and B do not change', `max ${worst.toExponential(2)}`);
}

// ── lines ─────────────────────────────────────────────────────────────────
{
  let worst = 0;
  const E = [0, 0, 0], B = [0, 0, 0], h = 1e-6;
  for (const [x, z] of [[0.4, 0.3], [0.9, -0.6], [0.15, 0.05], [1.7, 1.2], [0.33, 0]]) for (const t of TS) {
    f.EB(x, 0, z, t, k, E, B);
    const gx = (f.fluxQ(x + h, z, t, k) - f.fluxQ(x - h, z, t, k)) / (2 * h), gz = (f.fluxQ(x, z + h, t, k) - f.fluxQ(x, z - h, t, k)) / (2 * h);
    const c = Math.abs(E[0] * gx + E[2] * gz) / (Math.hypot(E[0], E[2]) * Math.hypot(gx, gz) + 1e-300);
    worst = Math.max(worst, c);
  }
  ok(worst < 1e-6, 'lines: E is tangent to the level lines of Q (|cos| of E with ∇Q)', `max ${worst.toExponential(2)}`);
  // B_φ = ∂Q/∂t / ρ
  const x = 0.7, z = 0.2, t = 0.25, ht = 1e-6;
  f.EB(x, 0, z, t, k, E, B);
  const dQ = (f.fluxQ(x, z, t + ht, k) - f.fluxQ(x, z, t - ht, k)) / (2 * ht);
  ok(rel(dQ / x, B[1]) < 1e-6, 'lines: B_φ = (∂Q/∂t)/ρ');
}

// ── reduction ─────────────────────────────────────────────────────────────
{
  let c1 = 0, c2 = 0, d1 = 0;
  for (const P of PTS) for (const which of ['E', 'B']) {
    const F = f.fieldFn(which, 0.2, k);
    const lines = f.curlFD(F, P, 1e-5), vec = f.curlLC(F, P, 1e-5);
    const s = Math.max(norm(lines), 1e-6);
    c1 = Math.max(c1, norm(sub(lines, vec)) / s);
    const h = 2e-3, loop = [0, 1, 2].map(a => f.circulation(F, P, a, h) / (h * h));
    c2 = Math.max(c2, norm(sub(lines, loop)) / s);
    const J = f.jacobian(F, P, 1e-5), fl = f.faceFlux(F, P, h);
    const pairs = [0, 1, 2].map(a => (fl[2 * a] + fl[2 * a + 1]) / h ** 3);
    const sc = Math.max(Math.abs(J[0][0]), Math.abs(J[1][1]), Math.abs(J[2][2]), 1e-6);
    d1 = Math.max(d1, ...[0, 1, 2].map(a => Math.abs(pairs[a] - J[a][a]) / sc));
  }
  ok(c1 < 1e-9, 'reduction: three curl lines = ε_ijk ∂_j F_k', `max ${c1.toExponential(2)}`);
  ok(c2 < 1e-3, 'reduction: loop circulation / area = curl component, three planes', `max ${c2.toExponential(2)}`);
  ok(d1 < 1e-3, 'reduction: face-pair flux / volume = ∂_i F_i, three axes', `max ${d1.toExponential(2)}`);
  ok(f.eps3(0, 1, 2) === 1 && f.eps3(1, 0, 2) === -1 && f.eps3(0, 0, 2) === 0, 'reduction: Levi-Civita signs');
}

// ── forms ─────────────────────────────────────────────────────────────────
{
  let w1 = 0, w2 = 0;
  for (const P of PTS.slice(0, 3)) for (const t of TS) {
    const s = f.ampE(norm(P), Math.acos(P[2] / norm(P)), k) * k;
    const a = f.dF(...P, t, k), b = f.dStarF(...P, t, k);
    w1 = Math.max(w1, ...a.map(v => Math.abs(v) / s)); w2 = Math.max(w2, ...b.map(v => Math.abs(v) / s));
  }
  ok(w1 < 1e-6, 'forms: dF = 0 in all four components', `max ${w1.toExponential(2)}`);
  ok(w2 < 1e-6, 'forms: d⋆F = 0 in all four components (vacuum)', `max ${w2.toExponential(2)}`);
  // Each component is one written-out law. Fields that break one law at a
  // time must show up in exactly that slot of dF or d⋆F.
  //   dF slots:  (x y z) ∇·B,  (t y z) (∂tB + ∇×E)_x,  (t z x) _y,  (t x y) _z
  //   d⋆F slots: t −∇·E,  x, y, z (∂tE − ∇×B)_x, _y, _z
  const P = [0.3, -0.2, 0.5], z4 = [0, 0, 0];
  const cases = [
    ['B = (x,0,0): ∇·B = 1', () => f.dF(...P, 0, k, 1e-5, (t, x) => [z4, [x, 0, 0]]), [1, 0, 0, 0]],
    ['E = (0,0,x): (∇×E)_y = −1', () => f.dF(...P, 0, k, 1e-5, (t, x) => [[0, 0, x], z4]), [0, 0, -1, 0]],
    ['B = (0,0,t): (∂tB)_z = 1', () => f.dF(...P, 0, k, 1e-5, (t) => [z4, [0, 0, t]]), [0, 0, 0, 1]],
    ['E = (y,0,0): ∇·E = 0, (∇×E)_z = −1', () => f.dF(...P, 0, k, 1e-5, (t, x, y) => [[y, 0, 0], z4]), [0, 0, 0, -1]],
    ['E = (x,0,0): d⋆F_t = −∇·E = −1', () => f.dStarF(...P, 0, k, 1e-5, (t, x) => [[x, 0, 0], z4]), [-1, 0, 0, 0]],
    ['B = (0,x,0): −(∇×B)_z = −1', () => f.dStarF(...P, 0, k, 1e-5, (t, x) => [z4, [0, x, 0]]), [0, 0, 0, -1]],
    ['E = (0,t,0): (∂tE)_y = 1', () => f.dStarF(...P, 0, k, 1e-5, (t) => [[0, t, 0], z4]), [0, 0, 1, 0]],
  ];
  for (const [name, run, want] of cases) {
    const got = run();
    ok(got.every((v, i) => Math.abs(v - want[i]) < 1e-6), 'forms: slot of ' + name, `[${got.map(v => v.toFixed(3)).join(', ')}]`);
  }
  // F is antisymmetric with six independent entries: three E, three B.
  const F = f.tensorF([1, 2, 3], [4, 5, 6]);
  ok(F.every((row, a) => row.every((v, b) => v === -F[b][a])), 'forms: F_{μν} is antisymmetric');
}

// ── display ───────────────────────────────────────────────────────────────
{
  const E = [0, 0, 0], B = [0, 0, 0];
  let worst = 0, near = 0;
  for (const lam of [0.6, 1, 1.6]) {
    const kk = f.kOf(lam);
    let m = 0, mn = 0;
    for (let i = 0; i < 64; i++) {
      const t = i / 64 * lam;
      f.EB(3 * lam, 0, 0, t, kk, E, B); m = Math.max(m, Math.abs(B[1]) / kk ** 2 * 3 * lam);
      f.EB(0.03 * lam, 0, 0, t, kk, E, B); mn = Math.max(mn, Math.abs(B[1]) / kk ** 2 * 0.03 * lam);
    }
    worst = Math.max(worst, Math.abs(m - 1)); near = Math.max(near, mn);
  }
  ok(worst < 0.03, 'display: far-zone B·r/k² peaks at 1 for λ = 0.6, 1, 1.6', `max |peak − 1| ${worst.toFixed(3)}`);
  ok(near > 2, 'display: the near zone is brighter than the far zone', `peak at r = 0.03λ: ${near.toFixed(1)}`);
  const lines = SHEET_FS.split('\n').filter(l => /\*\s*kr\b/.test(l));
  ok(lines.length === 0, 'display: no map, arrow or line brightness is scaled by kr', lines.join(' | '));
}

// ── twenty ────────────────────────────────────────────────────────────────
{
  const seen = GROUPS.flatMap(g => g.lines).sort((a, b) => a - b);
  ok(MAXWELL.length === 20 && seen.length === 20 && seen.every((v, i) => v === i), 'twenty: 20 lines in 8 groups, each line once', `groups ${GROUPS.map(g => g.g + g.lines.length).join(' ')}`);
  const laws = new Set(['I', 'II', 'III', 'IV', 'diel', 'ohm', 'cont']);
  ok(GROUPS.every(g => laws.has(g.law)) && ['I', 'II', 'III', 'IV'].every(l => GROUPS.some(g => g.law === l)), 'twenty: every group folds into a law, and every law gets a group');
}

// ── glyphs ────────────────────────────────────────────────────────────────
{
  const keys = Object.keys(TEX), missing = keys.filter(k => !EQ[k]);
  ok(missing.length === 0 && Object.keys(EQ).length === keys.length, `glyphs: all ${keys.length} TeX entries are typeset`, missing.join(' '));
  let bad = [];
  for (const [k, [vb, mode, g, r]] of Object.entries(EQ)) {
    if (vb.length !== 4 || !vb.every(Number.isFinite) || vb[2] <= 0 || vb[3] <= 0 || (mode !== 'd' && mode !== 'i')) bad.push(k + ':box');
    if (g.length % 8 || r.length % 11 || !g.length) bad.push(k + ':runs');
    for (let i = 0; i < g.length; i += 8) if (!(g[i] >= 0 && g[i] < GLYPHS.length) || !(g[i + 7] >= 0 && g[i + 7] <= 6) || !g.slice(i, i + 8).every(Number.isFinite)) { bad.push(k + ':glyph'); break; }
    for (let i = 0; i < r.length; i += 11) if (!(r[i + 10] >= 0 && r[i + 10] <= 6) || !r.slice(i, i + 11).every(Number.isFinite)) { bad.push(k + ':rule'); break; }
  }
  ok(bad.length === 0, 'glyphs: boxes, glyph indices, colours and numbers are in range', bad.slice(0, 6).join(' '));
  ok(GLYPHS.every(d => /^M/.test(d) && !/[a-z]/.test(d.replace(/e-?\d/g, ''))), 'glyphs: every outline is absolute path data', `${GLYPHS.length} outlines`);
  const b = eqBox('lawI', 20);
  ok(b.w > 40 && b.asc > 5 && b.desc > 2, 'glyphs: a fraction has height above and below the baseline', `lawI at 20px: ${b.w.toFixed(1)} × ${b.h.toFixed(1)}`);
}

// ── colours ───────────────────────────────────────────────────────────────
{
  const cols = k => new Set(EQ[k][2].filter((v, i) => i % 8 === 7));
  const want = { lawI: [2, 4], lawII: [1], lawIII: [2, 1], lawIV: [1, 5, 2], pB: [1, 3], pE: [2, 3], cBx: [1], cEx: [2] };
  const bad = Object.entries(want).filter(([k, c]) => !c.every(x => cols(k).has(x))).map(([k]) => k);
  ok(bad.length === 0, 'colours: E is m2, B m1, A and φ m3, ρ m4, J m5 in the laws', bad.join(' '));
  const m = MAXWELL.map((t, i) => cols('m' + String(i + 1).padStart(2, '0')));
  ok(m[3].has(1) && m[3].has(3) && m[9].has(2) && m[9].has(1) && m[9].has(3) && m[18].has(4), 'colours: Maxwell’s α β γ blue, F G H Ψ green, P Q R orange, e pink');
}

// ── story ─────────────────────────────────────────────────────────────────
{
  const WIDGETS = new Set(['groups', 'quantities', 'four', 'falloff', 'maps', 'fieldctl', 'curl', 'div', 'gauge', 'forms']);
  const SCENES = new Set(['fold', 'field', 'curlB', 'curlE', 'div', 'four', 'gauge', 'forms']);
  const miss = [], wid = [];
  for (const c of CHAPTERS) {
    for (const m of c.html.matchAll(/\{\{(\w+)\}\}/g)) if (!EQ[m[1]]) miss.push(c.id + ':' + m[1]);
    for (const m of c.html.matchAll(/data-eq="(\w+)"/g)) if (!EQ[m[1]]) miss.push(c.id + ':' + m[1]);
    for (const m of c.html.matchAll(/data-w="(\w+)"/g)) if (!WIDGETS.has(m[1])) wid.push(c.id + ':' + m[1]);
  }
  ok(miss.length === 0, 'story: every inline and display formula key exists', miss.join(' '));
  ok(wid.length === 0, 'story: every widget is one main.js builds', wid.join(' '));
  ok(CHAPTERS.every(c => SCENES.has(c.scene)) && new Set(CHAPTERS.map(c => c.id)).size === CHAPTERS.length, `story: ${CHAPTERS.length} chapters, unique ids, known scenes`);
  const caps = CHAPTERS.filter(c => !/^[A-Z0-9]/.test(c.title) || /[A-Z]{3,}/.test(c.title.replace(/[IVX]+/g, '')));
  ok(caps.length === 0, 'story: chapter titles are sentence case', caps.map(c => c.title).join(' | '));
}

// ── svg ───────────────────────────────────────────────────────────────────
{
  const svg = eqSVG('lawIV'), n = (svg.match(/<use /g) || []).length;
  ok(n === EQ.lawIV[2].length / 8 && /class="m1"/.test(svg) && /class="m5"/.test(svg) && /aria-label=/.test(svg), 'svg: eqSVG has one <use> per glyph and the colour classes', `${n} glyphs`);
}

// ── shell ─────────────────────────────────────────────────────────────────
{
  const here = new URL('.', import.meta.url);
  const html = readFileSync(new URL('index.html', here), 'utf8'), css = readFileSync(new URL('style.css', here), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  ok(srcs.slice(0, 3).join(' ') === '../../lib/gpu-guard.js ../../lib/wishlist.js ../../lib/stats-beacon.js', 'head: gpu-guard, wishlist, stats-beacon load first', srcs.join(' '));
  ok(/<script type="module" src="main.js"><\/script>/.test(html) && html.indexOf('style.css') < html.indexOf('lib/sci.css'), 'head: style.css before sci.css, main.js as a module');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'css: [hidden] {display:none!important}');
  ok(!/text-transform\s*:\s*uppercase/i.test(css) && !/letter-spacing\s*:/i.test(css), 'css: no uppercase or letter-spaced labels');
  const files = readdirSync(here).filter(n => /\.(js|mjs|html|css)$/.test(n) && n !== 'tests.mjs');
  const kx = files.filter(n => /(src|href)=["'][^"']*katex|import[^;\n]*katex|katex\.render/i.test(readFileSync(new URL(n, here), 'utf8')));
  ok(kx.length === 0, 'css: no KaTeX is loaded or called', kx.join(' '));
  const hid = [...html.matchAll(/<(\w+)[^>]*id="([^"]+)"[^>]*\shidden[\s>]/g)].map(m => m[2]);
  ok(hid.length > 0, 'css: hidden elements rely on the guard', hid.join(' '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
