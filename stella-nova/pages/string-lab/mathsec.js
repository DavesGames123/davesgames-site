// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · mathsec.js — "The mathematics of a string" (live figures)
// ────────────────────────────────────────────────────────────────────────────
//  The #math article under the explainer derives the string's equations in
//  twelve steps. Each step has TeX ([data-tex], lib/sci-math.js), a boxed
//  result, a live figure (<canvas data-mfig="name">) and a "See it in the
//  lab" button ([data-see="name"]) that sets the main 2D and 3D views
//  through window.__strings and scrolls up to them.
//
//  The figures take their numbers from the page's own engine
//  (engine/strings.js, engine/instruments.js), so a figure and the lab
//  agree: the Fourier bars are measured from a StringSim, the acceleration
//  figure runs a StringSim, and the inharmonicity uses the instrument data.
//  The pure functions under "maths" are exported for tests.mjs.
//
//  SECTION MAP   (grep -n "<anchor>" mathsec.js)
//    maths (exported) .......... "export const MATH"
//    string element ............ "element:"
//    images (odd extension) .... "images:"
//    separation of variables ... "modes:"
//    Fourier of a pluck ........ "fourier:"
//    energy per mode ........... "energy:"
//    stiffness, dispersion ..... "dispersion:"
//    damping and T60 ........... "decay:"
//    acceleration field ........ "accel:"
//    impedance, bridge ......... "impedance:"
//    Helmholtz series .......... "helmholtz:"
//    beats, coupling ........... "beats:"
//    12-TET and just ratios .... "tet:"
//    "see it" actions .......... "export const SEE"
//    entry ..................... "export function initMath"
// ════════════════════════════════════════════════════════════════════════════

import { typesetAll } from '../../lib/sci-math.js';
import { StringSim, pluckCoefficients, modalProject, modalFrequencies, modalDecay, inharmonicity, smoothField } from './engine/strings.js';
import { INSTRUMENTS, stringParams } from './engine/instruments.js';
import * as CM from '../ct-lab/colormaps/maps.js';
import { floorLut } from './stringlut.js';

const C = { m1: '#62c4ff', m2: '#ff9a62', m3: '#86dc7c', m4: '#e889dc', m5: '#ffd666', m6: '#a8a4ff', text: '#dde1ec', dim: '#8b92a8', line: 'rgba(143,182,255,0.16)', bg: '#0a0c14', red: '#ff6a6a', str: '#c9cfdc' };
const FONT = '500 11px Inter, system-ui, sans-serif';
const TAU = Math.PI * 2;

// ── maths (exported) ────────────────────────────────────────────────────────

export const MATH = {
  /** Energy of mode n (J) for a string of length L, density mu: (mu L / 4) w^2 b^2. */
  modeEnergy(mu, L, f, b) { const w = TAU * f; return 0.25 * mu * L * w * w * b * b; },
  /** Strain energy of a triangle pluck at p with height h: (T h^2 / 2L) / (p (1 - p)). */
  pluckEnergy(T, L, p, h) { return (T * h * h) / (2 * L * p * (1 - p)); },
  /** Displacement and force reflection coefficients at a junction Z1 -> Z2. */
  reflection(Z1, Z2) {
    const rF = (Z2 - Z1) / (Z2 + Z1);
    return { rF, rU: -rF, tU: (2 * Z1) / (Z1 + Z2), energyIn: 1 - rF * rF };
  },
  /** Amplitude decay rate (1/s) from one lossy end per period: sigma = f1 (-ln|r|). */
  bridgeDecay(f1, r) { return f1 * -Math.log(Math.abs(r)); },
  /** T60 (s) of an amplitude decay rate sigma: 3 ln 10 / sigma. */
  t60(sigma) { return (3 * Math.LN10) / sigma; },
  /** Two coupled oscillators: angular frequencies of the normal modes. */
  coupled(w1, w2, k) {
    const a = w1 * w1 + k, d = w2 * w2 + k, m = (a + d) / 2, q = Math.sqrt(((a - d) / 2) ** 2 + k * k);
    return [Math.sqrt(m - q), Math.sqrt(m + q)];
  },
  cents(r) { return 1200 * Math.log2(r); },
};

// ── draw helpers ────────────────────────────────────────────────────────────

function label(ctx, text, x, y, color = C.dim, align = 'left') {
  ctx.fillStyle = color; ctx.font = FONT; ctx.textAlign = align; ctx.fillText(text, x, y);
}
function hline(ctx, x0, x1, y, color = C.line) {
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke();
}
function poly(ctx, pts, color, lw = 2, dash = null) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.setLineDash(dash || []);
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
}
function fn(ctx, x0, x1, y, amp, f, color, lw = 2, n = 240, dash) {
  const pts = []; for (let i = 0; i <= n; i++) { const s = i / n; pts.push([x0 + (x1 - x0) * s, y - amp * f(s)]); }
  poly(ctx, pts, color, lw, dash);
}
function arrow(ctx, x, y, dx, dy, color, lw = 2) {
  const L = Math.hypot(dx, dy); if (L < 1) return;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
  const ux = dx / L, uy = dy / L, hl = Math.min(9, L * 0.5);
  ctx.beginPath(); ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x + dx - ux * hl - uy * hl * 0.45, y + dy - uy * hl + ux * hl * 0.45);
  ctx.lineTo(x + dx - ux * hl + uy * hl * 0.45, y + dy - uy * hl - ux * hl * 0.45); ctx.closePath(); ctx.fill();
}
function ends(ctx, x0, x1, y, h) { ctx.fillStyle = '#8e7b62'; ctx.fillRect(x0 - 4, y - h, 4, 2 * h); ctx.fillRect(x1, y - h, 4, 2 * h); }
function ctlVal(fig, name, dflt) { const el = fig.ctl && fig.ctl[name]; return el ? +el.value : dflt; }
const fmt = (v, d = 2) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(d - 1) : v.toFixed(d));

/** Odd 2-periodic extension of a triangle pluck at p (peak 1). */
function tri(x, p) {
  let y = ((x % 2) + 2) % 2, s = 1;
  if (y > 1) { y = 2 - y; s = -1; }
  return s * (y <= p ? y / p : (1 - y) / (1 - p));
}

const A2 = () => INSTRUMENTS.steel.strings[1];

// ── figures ─────────────────────────────────────────────────────────────────

export const FIGURES = {
  // A short element of string between x and x + dx, bent with curvature K.
  element: {
    animated: false,
    draw(ctx, w, h, t, fig) {
      const K = ctlVal(fig, 'K', 0.6), T = A2().T;
      const x0 = w * 0.18, x1 = w * 0.82, ym = h * 0.62, span = x1 - x0;
      const u = (s) => -K * 0.55 * h * ((s - 0.5) ** 2 - 0.25);       // parabola, u'' = const
      const pts = []; for (let i = 0; i <= 80; i++) { const s = i / 80; pts.push([x0 + span * s, ym - u(s)]); }
      poly(ctx, pts, C.str, 3);
      // tangents at the ends: slope du/dx in pixels
      const d = (s) => (u(s + 1e-3) - u(s - 1e-3)) / (2e-3 * span);
      const L = Math.min(110, w * 0.16);
      const tA = [-1, d(0)], tB = [1, -d(1)];
      const nA = Math.hypot(...tA), nB = Math.hypot(...tB);
      arrow(ctx, x0, ym - u(0), (L * tA[0]) / nA, (L * tA[1]) / nA, C.m2, 2.4);
      arrow(ctx, x1, ym - u(1), (L * tB[0]) / nB, (L * tB[1]) / nB, C.m2, 2.4);
      label(ctx, 'T', x0 - L * 0.55, ym - u(0) - 10 + (L * tA[1]) / nA / 2, C.m2);
      label(ctx, 'T', x1 + L * 0.5, ym - u(1) - 10 + (L * tB[1]) / nB / 2, C.m2);
      // net vertical force: T (sin th2 - sin th1), drawn at the middle
      const net = (-tA[1] / nA - tB[1] / nB) * L;      // up is negative y
      arrow(ctx, (x0 + x1) / 2, ym - u(0.5), 0, -net, C.m5, 3);
      label(ctx, 'net force  T(θ2 - θ1) ≈ T u_xx dx', (x0 + x1) / 2 + 10, ym - u(0.5) - net / 2, C.m5);
      label(ctx, `curvature u_xx ∝ ${K.toFixed(2)}   T = ${T.toFixed(0)} N (steel A2)`, 14, 18);
      label(ctx, 'x', x0, h - 10, C.dim, 'center'); label(ctx, 'x + dx', x1, h - 10, C.dim, 'center');
      if (Math.abs(K) < 0.02) label(ctx, 'straight: the two pulls cancel, no net force', w / 2, 40, C.m3, 'center');
    },
  },

  // The odd periodic extension: the string is one window of an infinite line.
  images: {
    animated: true,
    draw(ctx, w, h, t) {
      const p = 0.3, ct = (t * 0.1) % 2;
      const X0 = 20, X1 = w - 20, xs = (X1 - X0) / 4, y = h * 0.55, A = h * 0.3;
      const xp = (x) => X0 + (x + 1) * xs;                  // world x in [-1, 3]
      ctx.fillStyle = 'rgba(98,196,255,0.06)'; ctx.fillRect(xp(0), 0, xs, h);
      hline(ctx, X0, X1, y);
      for (let k = -1; k <= 3; k++) { ctx.fillStyle = C.line; ctx.fillRect(xp(k) - 0.5, y - A, 1, 2 * A); }
      const f = (s) => 0.5 * tri(s * 4 - 1 - ct, p) + 0.5 * tri(s * 4 - 1 + ct, p);
      fn(ctx, X0, X1, y, A, (s) => 0.5 * tri(s * 4 - 1 - ct, p), 'rgba(98,196,255,0.45)', 1.2, 480);
      fn(ctx, X0, X1, y, A, (s) => 0.5 * tri(s * 4 - 1 + ct, p), 'rgba(255,154,98,0.45)', 1.2, 480);
      fn(ctx, X0, X1, y, A, f, 'rgba(244,245,250,0.35)', 1.6, 480);
      fn(ctx, xp(0), xp(1), y, A, (s) => f((s + 1) / 4), '#f4f5fa', 3, 160);
      ends(ctx, xp(0), xp(1), y, A * 0.35);
      label(ctx, 'the string: 0 ≤ x ≤ L', xp(0.5), 18, C.text, 'center');
      label(ctx, 'odd image', xp(-0.5), 18, C.dim, 'center'); label(ctx, 'odd image', xp(1.5), 18, C.dim, 'center');
      label(ctx, `t = ${(ct / 2).toFixed(2)} of a period`, X1, h - 10, C.dim, 'right');
    },
  },

  // Separation of variables: X_n(x) T_n(t) for mode n.
  modes: {
    animated: true,
    draw(ctx, w, h, t, fig) {
      const n = Math.round(ctlVal(fig, 'n', 3)), f1 = 110;
      const x0 = 30, x1 = w - 150, y = h * 0.52, A = h * 0.34, ph = (t * 0.6 * n) % 1;
      const Tt = Math.cos(TAU * ph);
      hline(ctx, x0, x1, y); ends(ctx, x0, x1, y, A * 0.3);
      fn(ctx, x0, x1, y, A, (s) => Math.sin(n * Math.PI * s), C.m6, 1.2, 240, [4, 4]);
      fn(ctx, x0, x1, y, A, (s) => -Math.sin(n * Math.PI * s), C.m6, 1.2, 240, [4, 4]);
      fn(ctx, x0, x1, y, A, (s) => Tt * Math.sin(n * Math.PI * s), '#f4f5fa', 3);
      for (let k = 0; k <= n; k++) { ctx.fillStyle = C.m3; ctx.beginPath(); ctx.arc(x0 + ((x1 - x0) * k) / n, y, 4, 0, TAU); ctx.fill(); }
      // phasor T_n(t) = cos(w_n t)
      const cx = w - 75, cy = y, R = Math.min(52, h * 0.3);
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
      arrow(ctx, cx, cy, R * Math.cos(TAU * ph), -R * Math.sin(TAU * ph), C.m5, 2);
      ctx.fillStyle = C.m5; ctx.fillRect(cx + R * Tt - 1, cy + R + 8, 3, 6);
      label(ctx, 'T(t) = cos ωnt', cx, cy - R - 10, C.m5, 'center');
      label(ctx, `X(x) = sin(${n}πx/L)   fn = ${n} × ${f1} = ${n * f1} Hz   nodes: ${n + 1}`, x0, 18, C.text);
    },
  },

  // Fourier coefficients of a pluck: theory bars and the engine's measured dots.
  fourier: {
    animated: false,
    setup(fig) { fig.cache = null; },
    draw(ctx, w, h, t, fig) {
      const p = ctlVal(fig, 'p', 0.2), NM = 16;
      if (!fig.cache || fig.cache.p !== p) fig.cache = { p, ...fourierData(p, NM) };
      const { theory, measured } = fig.cache;
      const x0 = 34, x1 = w - 14, yb = h - 34, top = 40, bw = (x1 - x0) / NM, max = Math.max(...theory.map(Math.abs));
      hline(ctx, x0, x1, yb, 'rgba(143,182,255,0.35)');
      for (let n = 1; n <= NM; n++) {
        const b = theory[n - 1], hb = (Math.abs(b) / max) * (yb - top), xc = x0 + (n - 0.5) * bw;
        const dead = Math.abs(Math.sin(n * Math.PI * p)) < 0.03;      // node at the pluck point
        ctx.fillStyle = dead ? C.red : b >= 0 ? C.m1 : C.m2;
        ctx.fillRect(xc - bw * 0.3, yb - Math.max(hb, dead ? 2 : 0), bw * 0.6, Math.max(hb, dead ? 2 : 0));
        const hm = (Math.abs(measured[n - 1]) / max) * (yb - top);
        ctx.fillStyle = '#f4f5fa'; ctx.beginPath(); ctx.arc(xc, yb - hm, 3, 0, TAU); ctx.fill();
        label(ctx, String(n), xc, yb + 14, dead ? C.red : C.dim, 'center');
      }
      label(ctx, `pluck at p = ${p.toFixed(3)} of L   bars: |bn| from the formula (blue +, orange -)   dots: measured from the lab's StringSim`, x0, 18, C.text);
      const k = Math.round(1 / p);
      if (Math.abs(1 / p - k) < 0.02) label(ctx, `p = 1/${k}: harmonics ${k}, ${2 * k}, … have a node at the pluck point and vanish`, x0, 32, C.red);
    },
  },

  // Energy of each mode and its sum, with the decay of each mode.
  energy: {
    animated: true,
    draw(ctx, w, h, t, fig) {
      const S = A2(), L = INSTRUMENTS.steel.scaleM, p = 0.2, amp = 0.002, NM = 12;
      const P = stringParams(INSTRUMENTS.steel, 1, 0);
      const b = pluckCoefficients(p, amp, NM), f = modalFrequencies(P, NM), sg = modalDecay(P, NM);
      const tt = (t * 0.35) % 4;                                   // simulated seconds, loops
      const E = Array.from(b, (bn, i) => MATH.modeEnergy(S.mu, L, f[i], bn) * Math.exp(-2 * sg[i] * tt));
      const E0 = Array.from(b, (bn, i) => MATH.modeEnergy(S.mu, L, f[i], bn));
      const tot0 = E0.reduce((a, c) => a + c, 0), tot = E.reduce((a, c) => a + c, 0);
      const x0 = 34, x1 = w * 0.62, yb = h - 34, top = 44, bw = (x1 - x0) / NM, max = Math.max(...E0);
      hline(ctx, x0, x1, yb, 'rgba(143,182,255,0.35)');
      for (let n = 1; n <= NM; n++) {
        const xc = x0 + (n - 0.5) * bw, h0 = (E0[n - 1] / max) * (yb - top), he = (E[n - 1] / max) * (yb - top);
        ctx.fillStyle = 'rgba(143,182,255,0.18)'; ctx.fillRect(xc - bw * 0.3, yb - h0, bw * 0.6, h0);
        ctx.fillStyle = C.m5; ctx.fillRect(xc - bw * 0.3, yb - he, bw * 0.6, he);
        label(ctx, String(n), xc, yb + 14, C.dim, 'center');
      }
      // total over time
      const gx0 = w * 0.68, gx1 = w - 16, gy0 = top, gy1 = yb;
      ctx.strokeStyle = C.line; ctx.strokeRect(gx0 + 0.5, gy0 + 0.5, gx1 - gx0, gy1 - gy0);
      const pts = []; for (let i = 0; i <= 120; i++) { const s = (i / 120) * 4; let e = 0; for (let n = 0; n < NM; n++) e += E0[n] * Math.exp(-2 * sg[n] * s); pts.push([gx0 + ((gx1 - gx0) * s) / 4, gy1 - (e / tot0) * (gy1 - gy0)]); }
      poly(ctx, pts, C.m5, 2);
      ctx.fillStyle = '#f4f5fa'; ctx.beginPath(); ctx.arc(gx0 + ((gx1 - gx0) * tt) / 4, gy1 - (tot / tot0) * (gy1 - gy0), 4, 0, TAU); ctx.fill();
      label(ctx, 'total energy / start', gx0, gy0 - 8);
      label(ctx, '4 s', gx1, gy1 + 14, C.dim, 'right');
      label(ctx, `steel A2 plucked at 0.2 L, 2 mm: Σ En = ${(tot0 * 1e3).toFixed(2)} mJ   t = ${tt.toFixed(2)} s`, x0, 18, C.text);
      label(ctx, 'high modes lose energy first (σn grows with n²)', x0, 32, C.dim);
    },
  },

  // Dispersion of a stiff string and the cents offset of each partial.
  dispersion: {
    animated: false,
    draw(ctx, w, h, t, fig) {
      const i = Math.round(ctlVal(fig, 'str', 0)), inst = INSTRUMENTS.steel, s = inst.strings[i];
      const P = stringParams(inst, i, 0), L = inst.scaleM;
      const B = inharmonicity({ E: s.E, d: s.d, T: s.T, L });
      const NM = 24, f = modalFrequencies(P, NM), f1 = f[0] / Math.sqrt(1 + B);
      const x0 = 40, x1 = w * 0.48, yb = h - 30, top = 40;
      // left: w(k) for a flexible and a stiff string, on k_n = n pi / L
      ctx.strokeStyle = C.line; ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0, yb - top);
      const fmax = f[NM - 1];
      poly(ctx, Array.from({ length: NM + 1 }, (_, n) => [x0 + ((x1 - x0) * n) / NM, yb - ((n * f1) / fmax) * (yb - top)]), C.m1, 1.6, [5, 4]);
      poly(ctx, Array.from({ length: NM + 1 }, (_, n) => [x0 + ((x1 - x0) * n) / NM, yb - ((n ? f[n - 1] : 0) / fmax) * (yb - top)]), C.m4, 2.2);
      label(ctx, 'ω = ck (flexible)', x0 + 8, top + 16, C.m1); label(ctx, 'ω = √(c²k² + κ²k⁴)', x0 + 8, top + 30, C.m4);
      label(ctx, 'k = nπ/L →', x1, yb + 16, C.dim, 'right');
      // right: cents sharp of each partial
      const gx0 = w * 0.54, gx1 = w - 14, bw = (gx1 - gx0) / NM, cents = Array.from(f, (fn_, k) => MATH.cents(fn_ / ((k + 1) * f1)));
      const cmax = Math.max(1, cents[NM - 1]);
      hline(ctx, gx0, gx1, yb, 'rgba(143,182,255,0.35)');
      for (let n = 1; n <= NM; n++) { const hb = (cents[n - 1] / cmax) * (yb - top); ctx.fillStyle = C.m4; ctx.fillRect(gx0 + (n - 0.8) * bw, yb - hb, bw * 0.6, hb); if (n % 4 === 0 || n === 1) label(ctx, String(n), gx0 + (n - 0.5) * bw, yb + 14, C.dim, 'center'); }
      label(ctx, `partial n is sharp by 1200 log2√(1 + Bn²) cents (n = ${NM}: ${cents[NM - 1].toFixed(1)} ¢)`, gx0, top - 6, C.text);
      label(ctx, `steel ${s.name}: d = ${(s.d * 1e3).toFixed(3)} mm core, T = ${s.T.toFixed(0)} N, L = ${(L * 1e3).toFixed(0)} mm  →  B = ${B.toExponential(2)}`, x0, 18, C.text);
    },
  },

  // Damping: sigma_n = sigma0 + sigma1 (n pi / L)^2 and T60 per mode.
  decay: {
    animated: true,
    draw(ctx, w, h, t, fig) {
      const s0 = ctlVal(fig, 's0', 1.05), s1 = ctlVal(fig, 's1', 4.3e-4), L = INSTRUMENTS.steel.scaleM, NM = 20;
      const sg = Array.from({ length: NM }, (_, k) => s0 + s1 * (((k + 1) * Math.PI) / L) ** 2);
      const T60 = sg.map(MATH.t60);
      const x0 = 40, x1 = w * 0.5, yb = h - 30, top = 40, bw = (x1 - x0) / NM, tmax = Math.max(...T60);
      hline(ctx, x0, x1, yb, 'rgba(143,182,255,0.35)');
      for (let n = 1; n <= NM; n++) { const hb = (T60[n - 1] / tmax) * (yb - top); ctx.fillStyle = C.m3; ctx.fillRect(x0 + (n - 0.8) * bw, yb - hb, bw * 0.6, hb); if (n % 4 === 0 || n === 1) label(ctx, String(n), x0 + (n - 0.5) * bw, yb + 14, C.dim, 'center'); }
      label(ctx, `T60 of mode 1: ${T60[0].toFixed(2)} s   mode ${NM}: ${T60[NM - 1].toFixed(2)} s`, x0, top - 6, C.text);
      // right: decaying modes 1, 4, 8
      const gx0 = w * 0.56, gx1 = w - 14, gm = (top + yb) / 2, tt = (t * 0.5) % 3;
      ctx.strokeStyle = C.line; ctx.strokeRect(gx0 + 0.5, top + 0.5, gx1 - gx0, yb - top);
      [[1, C.m1], [4, C.m2], [8, C.m4]].forEach(([n, col]) => {
        const pts = []; for (let i = 0; i <= 300; i++) { const s = (i / 300) * 3; pts.push([gx0 + ((gx1 - gx0) * i) / 300, gm - ((yb - top) / 2.2) * Math.exp(-sg[n - 1] * s) * Math.cos(TAU * n * 2.2 * s)]); }
        poly(ctx, pts, col, 1.2);
        label(ctx, `n = ${n}`, gx1 - 8, top + 16 + [1, 4, 8].indexOf(n) * 13, col, 'right');
      });
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(gx0 + ((gx1 - gx0) * tt) / 3, top, 1, yb - top);
      label(ctx, '3 s (oscillation drawn slow)', gx1, yb + 14, C.dim, 'right');
      label(ctx, `σ0 = ${s0.toFixed(2)} 1/s (air, frequency-flat)   σ1 = ${s1.toExponential(2)} m²/s (internal, ∝ k²)`, 14, 18, C.text);
    },
  },

  // The acceleration field: a = c^2 u_xx + stiffness + damping, from a StringSim.
  accel: {
    animated: true,
    setup(fig) {
      const P = stringParams(INSTRUMENTS.classical, 5, 0);
      fig.sim = new StringSim(P);
      fig.sim.pluck({ pos: 0.22, amp: 0.002, width: 0.02 });
      fig.lut = floorLut(CM.variant('magma'));
      fig.smooth = new Float64Array(fig.sim.N + 1);
    },
    draw(ctx, w, h, t, fig) {
      const sim = fig.sim, N = sim.N;
      sim.step(Math.max(1, Math.round((fig.dt || 0.016) * 44100 * 0.0015)));      // 1/667 of real time
      if (sim.time > 2 / sim.f1 * 6) { sim.reset(); sim.pluck({ pos: 0.22, amp: 0.002, width: 0.02 }); }
      const x0 = 30, x1 = w - 16, rows = [h * 0.24, h * 0.52, h * 0.8], amp = h * 0.11;
      const X = (j) => x0 + ((x1 - x0) * j) / N;
      smoothField(sim.aTension, 3, fig.curv || (fig.curv = new Float64Array(N + 1)));
      let um = 1e-9, cm = 1e-9;
      for (let j = 0; j <= N; j++) { um = Math.max(um, Math.abs(sim.u[j])); cm = Math.max(cm, Math.abs(fig.curv[j])); }
      smoothField(sim.a, 3, fig.smooth);
      let am = 1e-9; for (let j = 0; j <= N; j++) am = Math.max(am, Math.abs(fig.smooth[j]));
      // row 1: u
      hline(ctx, x0, x1, rows[0]);
      poly(ctx, Array.from({ length: N + 1 }, (_, j) => [X(j), rows[0] - (sim.u[j] / um) * amp]), C.str, 2);
      label(ctx, 'u(x, t)  displacement', x0, rows[0] - amp - 6, C.text);
      // row 2: curvature u_xx = aTension / c^2
      hline(ctx, x0, x1, rows[1]);
      poly(ctx, Array.from({ length: N + 1 }, (_, j) => [X(j), rows[1] - (fig.curv[j] / cm) * amp]), C.m1, 1.6);
      label(ctx, 'u_xx  curvature (bend)', x0, rows[1] - amp - 6, C.m1);
      // row 3: |a| in magma, the lab's colour
      const lut = fig.lut, bh = 16;
      for (let j = 0; j < N; j++) {
        const v = Math.abs(0.5 * (fig.smooth[j] + fig.smooth[j + 1])) / am, k = Math.round(Math.min(1, v) * 255) * 3;
        ctx.fillStyle = `rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})`; ctx.fillRect(X(j), rows[2] - bh / 2, X(j + 1) - X(j) + 0.6, bh);
      }
      label(ctx, '|a| = |c² u_xx - κ² u_xxxx - damping|  in magma: the colour the lab draws', x0, rows[2] - bh / 2 - 8, C.m5);
      label(ctx, `classical E4, t = ${(sim.time * 1e3).toFixed(2)} ms (1/667 speed)   bright where the string bends, dark where it is straight`, x0, h - 6, C.dim);
    },
  },

  // Impedance: a pulse on string 1 meets string 2 (or the bridge).
  impedance: {
    animated: true,
    draw(ctx, w, h, t, fig) {
      const ratio = 10 ** ctlVal(fig, 'lz', 1);            // Z2 / Z1
      const { rU, tU, energyIn } = MATH.reflection(1, ratio);
      const x0 = 20, x1 = w - 20, xm = (x0 + x1) / 2, y = h * 0.55, A = h * 0.26;
      const ph = (t * 0.25) % 1.4, pulse = (d) => Math.exp(-((d / 0.06) ** 2));
      const s = ph - 0.5;                                    // incident centre, in half-widths (0 = junction)
      hline(ctx, x0, xm, y, 'rgba(98,196,255,0.4)'); hline(ctx, xm, x1, y, 'rgba(255,154,98,0.4)');
      ctx.fillStyle = '#8e7b62'; ctx.fillRect(xm - 1, y - A * 0.4, 2, A * 0.8);
      const left = (q) => (s < 0 ? pulse(q - s) : 0) + (s > 0 ? rU * pulse(q + s) : 0);
      const right = (q) => (s > 0 ? tU * pulse(q - s) : 0);
      fn(ctx, x0, xm, y, A, (u) => left(u - 1), C.m1, 2.4);
      fn(ctx, xm, x1, y, A, (u) => right(u), C.m2, 2.4);
      label(ctx, `Z2/Z1 = ${fmt(ratio, 2)}   displacement: r = ${rU.toFixed(3)}, τ = ${tU.toFixed(3)}   energy into string 2: ${(energyIn * 100).toFixed(energyIn < 0.01 ? 3 : 1)} %`, x0, 18, C.text);
      const Zs = Math.sqrt(A2().T * A2().mu), Zb = 300, r = MATH.reflection(Zs, Zb);
      label(ctx, `steel A2: Z = √(Tμ) = ${Zs.toFixed(2)} kg/s; against a bridge of Z ≈ ${Zb} kg/s, ${(r.energyIn * 100).toFixed(2)} % goes to the body per bounce`, x0, h - 8, C.dim);
    },
  },

  // Helmholtz motion as a Fourier series: sum of sin(n pi x) sin(n w t) / n^2.
  helmholtz: {
    animated: true,
    draw(ctx, w, h, t, fig) {
      const NM = Math.round(ctlVal(fig, 'nm', 40));
      const x0 = 30, x1 = w - 30, y = h * 0.52, A = h * 0.36 / (Math.PI * Math.PI / 8);
      const ph = (t * 0.18) % 1, sAt = (s) => { let v = 0; for (let n = 1; n <= NM; n++) v += (Math.sin(n * Math.PI * s) * Math.sin(n * TAU * ph)) / (n * n); return v; };
      hline(ctx, x0, x1, y); ends(ctx, x0, x1, y, h * 0.12);
      // the parabolic envelope: max over time of the series is (pi^2 / 8) * 4 s (1 - s) / ... (pi^2/2) s(1-s)
      fn(ctx, x0, x1, y, A, (s) => (Math.PI * Math.PI / 2) * s * (1 - s), C.m6, 1.2, 200, [4, 4]);
      fn(ctx, x0, x1, y, A, (s) => -(Math.PI * Math.PI / 2) * s * (1 - s), C.m6, 1.2, 200, [4, 4]);
      fn(ctx, x0, x1, y, A, sAt, '#f4f5fa', 2.6, 300);
      // the corner: position s = 2 ph (out) then 2 - 2 ph (back)
      const sc = ph < 0.5 ? 2 * ph : 2 - 2 * ph;
      ctx.fillStyle = C.m5; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * sc, y - A * sAt(sc), 5, 0, TAU); ctx.fill();
      label(ctx, `Σ sin(nπx/L) sin(nωt) / n²,  n = 1 … ${NM}: two straight lines and a corner that runs round the dashed parabolas`, x0, 18, C.text);
    },
  },

  // Beats, and two strings coupled through the bridge.
  beats: {
    animated: true,
    draw(ctx, w, h, t, fig) {
      const df = ctlVal(fig, 'df', 2), kc = ctlVal(fig, 'kc', 0.04);
      const x0 = 20, x1 = w - 20, y1 = h * 0.28, y2 = h * 0.74, A = h * 0.17, span = 2;       // seconds shown
      hline(ctx, x0, x1, y1);
      const f0 = 12;                                                                        // drawn slow
      fn(ctx, x0, x1, y1, A * 0.5, (s) => Math.cos(TAU * f0 * s * span) + Math.cos(TAU * (f0 + df) * s * span), 'rgba(244,245,250,0.85)', 1, 900);
      fn(ctx, x0, x1, y1, A * 0.5, (s) => 2 * Math.abs(Math.cos(Math.PI * df * s * span)), C.m5, 1.6, 300);
      label(ctx, `two tones f and f + Δf: envelope 2|cos(πΔf t)|, ${df.toFixed(1)} beats per second`, x0, 16, C.text);
      // coupled: energies of string 1 and 2 (normal-mode beating)
      const w0 = TAU * 5, [wa, wb] = MATH.coupled(w0, w0, kc * w0 * w0), dw = wb - wa;
      hline(ctx, x0, x1, y2 + A);
      const tt = (t * 0.6) % span;
      const e1 = (s) => Math.cos((dw * s * span) / 2) ** 2, e2 = (s) => Math.sin((dw * s * span) / 2) ** 2;
      fn(ctx, x0, x1, y2 + A, 2 * A, e1, C.m1, 2, 300); fn(ctx, x0, x1, y2 + A, 2 * A, e2, C.m2, 2, 300);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x0 + ((x1 - x0) * tt) / span, y2 - A, 1, 2 * A);
      label(ctx, `coupled strings, coupling ${kc.toFixed(3)}: energy swaps every ${(Math.PI / dw).toFixed(2)} s (normal modes ${(wa / TAU).toFixed(2)} and ${(wb / TAU).toFixed(2)} Hz)`, x0, y2 - A - 8, C.text);
      label(ctx, 'string 1', x0 + 4, y2 - A + 22, C.m1); label(ctx, 'string 2 (sympathetic)', x0 + 4, y2 + A - 6, C.m2);
    },
  },

  // 12-TET against just ratios: cents and the beat rate on A3.
  tet: {
    animated: false,
    draw(ctx, w, h, t, fig) {
      const JUST = [[1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3], [45, 32], [3, 2], [8, 5], [5, 3], [9, 5], [15, 8], [2, 1]];
      const NAMES = ['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];
      const x0 = 40, x1 = w - 20, yr = h * 0.3, yb = h - 30, f0 = 220;
      hline(ctx, x0, x1, yr, 'rgba(143,182,255,0.35)');
      const X = (c) => x0 + ((x1 - x0) * c) / 1200;
      for (let k = 0; k <= 12; k++) {
        const [p, q] = JUST[k], cj = MATH.cents(p / q);
        ctx.fillStyle = C.m1; ctx.fillRect(X(100 * k) - 1, yr - 14, 2, 14);
        ctx.fillStyle = C.m2; ctx.fillRect(X(cj) - 1, yr, 2, 14);
        label(ctx, NAMES[k], X(100 * k), yr - 20, C.dim, 'center');
      }
      label(ctx, 'equal (2^{k/12})', x0, 18, C.m1); label(ctx, 'just (p/q)', x0 + 120, 18, C.m2);
      // beat rate between coinciding partials on A3: |q f_upper - p f_lower|
      const bw = (x1 - x0) / 12, top = yr + 58;
      const beats = JUST.slice(1, 12).map(([p, q], i) => Math.abs(q * f0 * 2 ** ((i + 1) / 12) - p * f0));
      const bmax = Math.max(...beats);
      hline(ctx, x0, x1, yb, 'rgba(143,182,255,0.35)');
      beats.forEach((b, i) => { const hb = (b / bmax) * (yb - top); ctx.fillStyle = C.m5; ctx.fillRect(x0 + (i + 0.6) * bw, yb - hb, bw * 0.6, hb); label(ctx, `${b.toFixed(1)}`, x0 + (i + 0.9) * bw, yb - hb - 4, C.dim, 'center'); });
      label(ctx, 'beats per second between the coinciding partials, equal-tempered intervals on A3 (220 Hz)', x0, yr + 34, C.text);
    },
  },
};

/** Theory and engine-measured Fourier coefficients of a pluck at p (fraction). */
export function fourierData(p, NM, which = 5) {
  const inst = INSTRUMENTS.classical, P = stringParams(inst, which, 0);
  const sim = new StringSim(P);
  sim.pluck({ pos: p, amp: 0.002, width: 0 });
  return { theory: Array.from(pluckCoefficients(p, 0.002, NM)), measured: Array.from(modalProject(sim.u, NM)), sim };
}

// ── "see it" actions ───────────────────────────────────────────────────────

/** Each action sets the lab through window.__strings (the page API). */
export const SEE = {
  element: (S) => { S.loadInstrument('steel'); S.selectString(1); S.setFret(1, 0); S.setField('aTension'); S.setColormap('magma'); S.setTimeScale(0.001); S.setExaggeration(100); S.pluck(1, { pos: 0.5, amp: 0.002 }); },
  images: (S) => { S.loadInstrument('steel'); S.selectString(1); S.setField('u'); S.setTimeScale(0.001); S.setExaggeration(100); S.pluck(1, { pos: 0.2, amp: 0.002 }); },
  modes: (S) => { S.loadInstrument('steel'); S.selectString(1); S.setField('u'); S.setTimeScale(0.01); S.setExaggeration(200); S.harmonic(1, 3); },
  fourier: (S) => { S.loadInstrument('classical'); S.selectString(5); S.setField('a'); S.setColormap('magma'); S.setTimeScale(0.001); S.pluck(5, { pos: 0.2, amp: 0.002 }); },
  energy: (S) => { S.loadInstrument('steel'); S.selectString(1); S.setField('v'); S.setTimeScale(0.1); S.pluck(1, { pos: 0.2, amp: 0.002 }); },
  dispersion: (S) => { S.loadInstrument('steel'); S.selectString(0); S.setField('aStiff'); S.setColormap('viridis'); S.setTimeScale(0.001); S.pluck(0, { pos: 0.12, amp: 0.002 }); },
  decay: (S) => { S.loadInstrument('steel'); S.selectString(1); S.setField('aDamp'); S.setTimeScale(1); S.pluck(1, { pos: 0.2, amp: 0.002 }); },
  accel: (S) => { S.loadInstrument('classical'); S.selectString(5); S.setField('a'); S.setColormap('magma'); S.setTimeScale(0.001); S.setExaggeration(50); S.pluck(5, { pos: 0.22, amp: 0.002 }); },
  impedance: (S) => { S.loadInstrument('steel'); S.selectString(1); S.setField('aTension'); S.setTimeScale(0.001); S.camera && S.camera('soundhole'); S.pluck(1, { pos: 0.08, amp: 0.002 }); },
  helmholtz: (S) => { S.loadInstrument('violin'); S.selectString(2); S.setField('v'); S.setTimeScale(0.001); S.camera && S.camera('bow'); S.bow(2, { pos: 0.09 }); },
  beats: (S) => { S.loadInstrument('steel'); S.setTimeScale(1); S.setFret(4, 5); S.playNote({ string: 4, fret: 5 }); S.playNote({ string: 5, fret: 0 }); },
  tet: (S) => { S.loadInstrument('steel'); S.setTimeScale(1); S.playChord('E'); },
};

// ── entry ───────────────────────────────────────────────────────────────────

export function initMath(root, api = () => window.__strings) {
  if (!root) return null;
  typesetAll(root).catch(() => {});
  for (const b of root.querySelectorAll('[data-see]')) {
    b.addEventListener('click', () => {
      const S = api(), act = SEE[b.dataset.see];
      if (!S || !act) return;
      try { act(S); } catch (e) { console.warn('string-lab math see-it:', e); }
      const lab = document.getElementById('lab');
      if (lab && lab.scrollIntoView) lab.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  const figs = [];
  for (const canvas of root.querySelectorAll('canvas[data-mfig]')) {
    const def = FIGURES[canvas.dataset.mfig];
    if (!def) continue;
    const fig = { canvas, def, ctx: canvas.getContext('2d'), figure: canvas.closest('figure'), visible: false, w: 0, h: 0, dirty: true, ctl: {} };
    if (fig.figure) {
      for (const el of fig.figure.querySelectorAll('[data-ctl]')) fig.ctl[el.dataset.ctl] = el;
      fig.figure.addEventListener('input', () => { fig.dirty = true; });
    }
    def.setup?.(fig);
    figs.push(fig);
  }
  const size = (f) => {
    const r = f.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    f.w = Math.max(1, Math.round(r.width)); f.h = Math.max(1, Math.round(r.height)); f.dpr = dpr;
    f.canvas.width = Math.round(f.w * dpr); f.canvas.height = Math.round(f.h * dpr);
    f.dirty = true;
  };
  figs.forEach(size);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((es) => { for (const e of es) { const f = figs.find((x) => x.canvas === e.target); if (f) size(f); } });
    figs.forEach((f) => ro.observe(f.canvas));
  }
  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((es) => { for (const e of es) { const f = figs.find((x) => x.canvas === e.target); if (f) { f.visible = e.isIntersecting; f.dirty = true; } } }, { rootMargin: '80px' });
    figs.forEach((f) => io.observe(f.canvas));
  } else figs.forEach((f) => { f.visible = true; });

  let raf = 0, last = 0, alive = true;
  const t0 = performance.now();
  const loop = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const t = (now - t0) / 1000;
    for (const f of figs) {
      if (!f.visible || (!f.def.animated && !f.dirty)) continue;
      f.dirty = false; f.dt = dt;
      const ctx = f.ctx;
      ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, f.w, f.h);
      f.def.draw(ctx, f.w, f.h, t, f);
    }
  };
  raf = requestAnimationFrame(loop);
  window.addEventListener('pagehide', () => { alive = false; cancelAnimationFrame(raf); });
  window.addEventListener('pageshow', (e) => { if (e.persisted && !alive) { alive = true; last = 0; raf = requestAnimationFrame(loop); } });
  return { figs };
}
