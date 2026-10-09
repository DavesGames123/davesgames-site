// ============================================================================
//  PERIODIC TABLE  ·  atom.js  ·  the live atomic structure of one element
// ----------------------------------------------------------------------------
//  Two pictures, both drawn into any canvas 2D context inside a rectangle,
//  so the hover card, the inspect panel, the saver and the node renders
//  share them. No DOM: the sprites come from a canvas factory that the page
//  (or the node script) sets with setCanvasFactory().
//
//  BOHR   the nucleus of the main isotope as a ball of Z protons and N
//         neutrons, turning slowly, and one ring per shell with its
//         electrons in orbit (inner shells faster). The valence shell has
//         the accent colour. The sizes are for legibility, not to scale:
//         a real nucleus is about 1/100,000 of the atom.
//  CLOUD  electron positions sampled from |psi|^2 of every occupied
//         subshell, drawn as glowing points that turn in 3D. psi is the
//         hydrogen-like orbital of hydrogen-table/physics.js with Z replaced
//         by Slater's Z_eff of that subshell: psi_Z(r) = Z^(3/2) psi_1(Z r).
//         A partly filled subshell fills its real orbitals by Hund's rule
//         (one electron in each, then pairs), so p3 shows three lobes pairs
//         and p1 shows one. Colours: s blue, p amber, d green, f violet; the
//         lighter shade is the positive lobe. The radius axis is
//         compressed (r^0.45), so the tiny 1s core and the wide valence
//         shell fit in one picture.
//
//  GREP MAP
//    grep -n "export function setCanvasFactory"
//    grep -n "export function nucleus"       nucleon positions (cached)
//    grep -n "export function drawBohr"
//    grep -n "export function cloudPoints"   the sampled cloud (cached)
//    grep -n "export function orbitalPlan"   Hund filling of the real orbitals
//    grep -n "export function drawCloud"
//    grep -n "export function drawAtom"      Bohr, cloud, or a cross-fade
// ============================================================================
import { radialR, legendre, ylmNorm } from '../hydrogen-table/physics.js';
import { expand, zeff, mainIsotope, valence, CAT, SHELL_LETTER, L_LETTER } from './chem.js';

let makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};
export function setCanvasFactory(fn) { makeCanvas = fn; SPRITES.clear(); }
export const canvasOf = (w, h) => makeCanvas(w, h);

// A seeded random source (mulberry32), so a given element always samples
// the same cloud and the tests are repeatable.
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── sprites ────────────────────────────────────────────────────────────────
const SPRITES = new Map();
function sprite(key, size, paint) {
  const k = key + '@' + size;
  let c = SPRITES.get(k);
  if (!c) { c = makeCanvas(size, size); paint(c.getContext('2d'), size); SPRITES.set(k, c); }
  return c;
}
// A shaded ball (proton or neutron).
function ball(color, size) {
  return sprite('ball' + color, size, (g, s) => {
    const r = s / 2;
    const gr = g.createRadialGradient(r * 0.7, r * 0.62, r * 0.08, r, r, r);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.18, color);
    gr.addColorStop(0.75, shade(color, 0.42));
    gr.addColorStop(1, shade(color, 0.16));
    g.fillStyle = gr; g.beginPath(); g.arc(r, r, r * 0.98, 0, Math.PI * 2); g.fill();
  });
}
// A soft glow dot (an electron, or a cloud point).
function glow(color, size) {
  return sprite('glow' + color, size, (g, s) => {
    const r = s / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, hexA(color, 0.95));
    gr.addColorStop(0.45, hexA(color, 0.28));
    gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}
export function hexRGB(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
export function hexA(h, a) { const [r, g, b] = hexRGB(h); return `rgba(${r},${g},${b},${a})`; }
export function shade(h, k) { const [r, g, b] = hexRGB(h); return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`; }
export function mix(h1, h2, t) { const a = hexRGB(h1), b = hexRGB(h2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

const PROTON = '#ff5a4e', NEUTRON = '#9fb4cc';

// ── nucleus ────────────────────────────────────────────────────────────────
const NUC = new Map();
// Nucleon positions in a unit ball: [x, y, z, isProton]. Seeded random
// points in the ball, pushed apart until no two overlap (a packed drop),
// then the protons are spread evenly through the list.
export function nucleus(e) {
  if (NUC.has(e.z)) return NUC.get(e.z);
  const A = mainIsotope(e), Z = e.z;
  const rand = rng(e.z * 104729 + 7);
  const pts = [];
  while (pts.length < A) {
    const x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
    if (x * x + y * y + z * z <= 1) pts.push([x, y, z, false]);
  }
  if (A === 1) pts[0] = [0, 0, 0, false];
  const d0 = 1.62 / Math.cbrt(A);       // nucleon diameter in ball units
  for (let it = 0; it < 24 && A > 1; it++) {
    for (let i = 0; i < A; i++) for (let j = i + 1; j < A; j++) {
      const p = pts[i], q = pts[j];
      const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      if (d >= d0) continue;
      const k = (d0 - d) / d / 2;
      p[0] -= dx * k; p[1] -= dy * k; p[2] -= dz * k; q[0] += dx * k; q[1] += dy * k; q[2] += dz * k;
    }
    const lim = 1 - d0 / 2;
    for (const p of pts) { const r = Math.hypot(p[0], p[1], p[2]); if (r > lim) { p[0] *= lim / r; p[1] *= lim / r; p[2] *= lim / r; } }
  }
  let acc = 0, np = 0;
  for (let i = 0; i < A; i++) { acc += Z / A; if (acc >= 1 - 1e-9 && np < Z) { pts[i][3] = true; acc -= 1; np++; } }
  for (let i = 0; np < Z && i < A; i++) if (!pts[i][3]) { pts[i][3] = true; np++; }
  const out = { A, Z, N: A - Z, pts };
  NUC.set(e.z, out);
  return out;
}

function drawNucleus(g, e, cx, cy, R, t, alpha) {
  const nuc = nucleus(e);
  const b = Math.max(2, R * 0.86 / Math.cbrt(nuc.A) * (nuc.A === 1 ? 0.7 : 1));
  const size = Math.max(4, Math.ceil(b * 2));
  const ps = ball(PROTON, size), ns = ball(NEUTRON, size);
  const a = t * 0.35, ca = Math.cos(a), sa = Math.sin(a);
  const tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
  const rot = nuc.pts.map(([x, y, z, p]) => {
    const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
    const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
    return [x1, y2, z2, p];
  }).sort((u, v) => u[2] - v[2]);
  // halo under the ball
  const hg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 2.4);
  hg.addColorStop(0, `rgba(255,150,120,${0.32 * alpha})`); hg.addColorStop(1, 'rgba(255,150,120,0)');
  g.fillStyle = hg; g.beginPath(); g.arc(cx, cy, R * 2.4, 0, Math.PI * 2); g.fill();
  const base = g.globalAlpha;
  for (const [x, y, z, p] of rot) {
    g.globalAlpha = base * alpha * (0.72 + 0.28 * (z + 1) / 2);
    const s = b * (0.92 + 0.12 * z);
    g.drawImage(p ? ps : ns, cx + x * R - s, cy + y * R - s, s * 2, s * 2);
  }
  g.globalAlpha = base;
}

// ── Bohr picture ───────────────────────────────────────────────────────────
// rect = { x, y, w, h } in the units of the context. opts.labels shows
// the shell letters and counts. opts.scale is the text scale (CSS px to
// context units).
export function drawBohr(g, e, rect, t, opts = {}) {
  const alpha = opts.alpha ?? 1, sc = opts.scale || 1;
  const accent = opts.accent || CAT[e.cat].color;
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const Rmax = Math.min(rect.w, rect.h) / 2 * 0.94;
  const shells = e.shells;
  const ns = shells.length;
  const Rn = Rmax * (0.075 + 0.085 * Math.cbrt(mainIsotope(e) / 294));
  const gap = (Rmax - Rn * 1.9) / ns;
  const radius = k => Rn * 1.9 + gap * (k + 0.75);
  g.save();
  // rings
  for (let k = 0; k < ns; k++) {
    const r = radius(k), val = k === ns - 1;
    g.strokeStyle = val ? hexA(accent, 0.55 * alpha) : `rgba(170,200,255,${0.16 * alpha})`;
    g.lineWidth = (val ? 1.5 : 1) * sc;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }
  drawNucleus(g, e, cx, cy, Rn, t, alpha);
  // electrons, each with a short fading trail along its ring
  for (let k = 0; k < ns; k++) {
    const r = radius(k), n = shells[k], val = k === ns - 1;
    const col = val ? accent : '#9ecbff';
    const eSize = Math.max(3 * sc, Math.min(9 * sc, gap * 0.36, Math.PI * r / n * 0.62));
    const spr = glow(col, Math.ceil(eSize * 4));
    const w = (0.9 / Math.pow(k + 1, 0.85)) * (k % 2 ? -1 : 1);
    const ph = k * 1.7;
    const tail = Math.min(0.55, Math.PI * 2 / n * 0.45) * Math.sign(w);
    g.lineWidth = Math.max(1, eSize * 0.55); g.lineCap = 'round';
    for (let j = 0; j < n; j++) {
      const a = t * w + ph + Math.PI * 2 * j / n;
      const steps = 6;
      for (let q = 0; q < steps; q++) {
        const a0 = a - tail * (q + 1) / steps, a1 = a - tail * q / steps;
        g.strokeStyle = hexA(col, (val ? 0.42 : 0.24) * alpha * (1 - q / steps));
        g.beginPath(); g.arc(cx, cy, r, Math.min(a0, a1), Math.max(a0, a1)); g.stroke();
      }
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      g.globalAlpha = alpha * (val ? 1 : 0.85);
      g.drawImage(spr, x - eSize * 2, y - eSize * 2, eSize * 4, eSize * 4);
      g.globalAlpha = 1;
    }
  }
  // shell letters and counts, where the rings are far enough apart
  if (opts.labels !== false && gap >= 22 * sc) {
    const fs = Math.min(12 * sc, gap * 0.42);
    g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let k = 0; k < ns; k++) {
      const r = radius(k), val = k === ns - 1;
      const x = cx + r * Math.cos(-Math.PI / 4) + 4 * sc, y = cy + r * Math.sin(-Math.PI / 4) - 2 * sc;
      g.fillStyle = val ? hexA(accent, 0.95 * alpha) : `rgba(200,215,240,${0.72 * alpha})`;
      g.fillText(SHELL_LETTER[k] + ' ' + shells[k], x, y);
    }
  }
  g.restore();
}

// ── orbital cloud ──────────────────────────────────────────────────────────
// Real orbitals in Hund order: each m gets one electron, then a second.
const M_ORDER = [0, 1, -1, 2, -2, 3, -3];
export function orbitalPlan(l, k) {
  const m = M_ORDER.slice(0, 2 * l + 1);
  const occ = m.map(() => 0);
  for (let i = 0; i < k; i++) occ[i % m.length] += 1;
  return m.map((mm, i) => [mm, occ[i]]).filter(x => x[1] > 0);
}
function yReal(l, m, c, phi) {
  const am = Math.abs(m), N = ylmNorm(l, am), P = legendre(l, am, c);
  if (m === 0) return N * P;
  return Math.SQRT2 * N * P * (m > 0 ? Math.cos(am * phi) : Math.sin(am * phi));
}
const YMAX = new Map();
function yMax2(l, m) {
  const k = l * 10 + m;
  if (YMAX.has(k)) return YMAX.get(k);
  let best = 0;
  for (let i = 0; i <= 90; i++) for (let j = 0; j < 180; j++) {
    const v = yReal(l, m, Math.cos(Math.PI * i / 90), Math.PI * 2 * j / 180);
    best = Math.max(best, v * v);
  }
  YMAX.set(k, best * 1.02);
  return best * 1.02;
}
export const L_COLORS = ['#58b6ff', '#ffb54a', '#5be39b', '#c58cff'];
export const L_COLORS_NEG = ['#2f6fd0', '#e0662f', '#22a37a', '#8a4fe0'];
// A small hue step per m, so the orbitals of one subshell read apart.
const M_TINT = { 0: '#ffffff', 1: '#ff7b9c', '-1': '#7bd3ff', 2: '#ffe27b', '-2': '#a6ff7b', 3: '#d9a6ff', '-3': '#7bffe0' };
function mOffset(c, m) { return m == null ? c : mix(c, M_TINT[m], m === 0 ? 0.25 : 0.38); }

const CLOUD = new Map();
// Points [x, y, z, l, sign, valence] in compressed display units (the
// valence shell near radius 1). budget: the number of points.
export function cloudPoints(e, budget = 2600) {
  const key = e.z + ':' + budget;
  if (CLOUD.has(key)) return CLOUD.get(key);
  const sub = expand(e.cfg).filter(s => s[2] > 0);
  const val = valence(e);
  const nVal = val[0];
  const rand = rng(e.z * 7919 + budget);
  // the reference radius: the mean radius of the valence subshell
  const zv = Math.max(1, zeff(e.z, sub, val[0], val[1]));
  const rRef = (3 * nVal * nVal - val[1] * (val[1] + 1)) / (2 * zv);
  // weights: valence shell electrons count 3x, so the outside reads clearly
  const isVal = (n, l) => n >= nVal - (l >= 2 ? l - 1 : 0);   // ns, np, (n-1)d, (n-2)f
  const W = sub.map(([n, l, k]) => k * (isVal(n, l) ? 5 : 0.6));
  const wsum = W.reduce((a, b) => a + b, 0);
  const pts = [];
  sub.forEach(([n, l, k], si) => {
    const Z = Math.max(1, zeff(e.z, sub, n, l));
    const count = Math.max(36, Math.round(budget * W[si] / wsum));
    // radial CDF of r^2 R^2 for the hydrogen-like orbital with charge Z
    const rmax = (4 * n * n + 12) / Z;
    const STEPS = 480;
    const cdf = new Float64Array(STEPS + 1);
    for (let i = 1; i <= STEPS; i++) {
      const r = rmax * i / STEPS, R = radialR(n, l, Z * r);
      cdf[i] = cdf[i - 1] + r * r * R * R;
    }
    const tot = cdf[STEPS];
    const plan = orbitalPlan(l, k);
    const occTot = plan.reduce((a, p) => a + p[1], 0);
    for (const [m, occ] of plan) {
      const cnt = Math.round(count * occ / occTot);
      const ym = yMax2(l, m);
      for (let q = 0; q < cnt; q++) {
        // r from the CDF (binary search)
        const u = rand() * tot;
        let lo = 0, hi = STEPS;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid; else hi = mid; }
        const r = rmax * (lo + rand()) / STEPS;
        // direction by rejection on |Y|^2
        let c, phi, y;
        for (let tries = 0; tries < 200; tries++) {
          c = rand() * 2 - 1; phi = rand() * Math.PI * 2;
          y = yReal(l, m, c, phi);
          if (rand() * ym <= y * y) break;
        }
        const s = Math.sqrt(1 - c * c);
        const rd = Math.pow(r / rRef, 0.45);
        const sign = (radialR(n, l, Z * r) * y) >= 0 ? 1 : -1;
        pts.push([rd * s * Math.cos(phi), rd * c, rd * s * Math.sin(phi), l, sign, n >= nVal - (l >= 2 ? l - 1 : 0) ? 1 : 0, m]);
      }
    }
  });
  // scale so that 97 % of the points fall inside radius 1
  const rs = pts.map(p => Math.hypot(p[0], p[1], p[2])).sort((a, b) => a - b);
  const r97 = rs[Math.floor(rs.length * 0.97)] || 1;
  for (const p of pts) { p[0] /= r97; p[1] /= r97; p[2] /= r97; }
  const out = { pts, sub, rRef };
  CLOUD.set(key, out);
  return out;
}

export function drawCloud(g, e, rect, t, opts = {}) {
  const alpha = opts.alpha ?? 1, sc = opts.scale || 1;
  const { pts } = cloudPoints(e, opts.budget || 3600);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const R = Math.min(rect.w, rect.h) / 2 * 0.9;
  const a = t * 0.4, ca = Math.cos(a), sa = Math.sin(a);
  const tl = 0.42 + 0.1 * Math.sin(t * 0.23), ct = Math.cos(tl), st = Math.sin(tl);
  const dot = Math.max(2.5, R * 0.034 * (opts.dot || 1));
  const spr = (l, m, sign, val) => {
    if (!val) return glow(sign > 0 ? "#b8c8e8" : "#7d8fb8", Math.ceil(dot * 2));
    const base = mOffset(L_COLORS[l], m);
    return glow(sign > 0 ? base : mix(base, L_COLORS_NEG[l], 0.7), Math.ceil(dot * 2));
  };
  g.save();
  // faint halo
  const hg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.05);
  hg.addColorStop(0, `rgba(120,160,255,${0.10 * alpha})`); hg.addColorStop(1, 'rgba(120,160,255,0)');
  g.fillStyle = hg; g.beginPath(); g.arc(cx, cy, R * 1.05, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'lighter';
  const focus = opts.focusL;
  for (const p of pts) {
    const x1 = p[0] * ca + p[2] * sa, z1 = -p[0] * sa + p[2] * ca;
    const y2 = p[1] * ct - z1 * st, z2 = p[1] * st + z1 * ct;
    const depth = 0.55 + 0.45 * (z2 + 1) / 2;
    const dim = focus == null || focus === p[3] ? 1 : 0.18;
    g.globalAlpha = alpha * depth * dim * (p[5] ? 0.7 : 0.3);
    const s = dot * (p[5] ? 0.7 + 0.5 * depth : 0.55);
    g.drawImage(spr(p[3], p[6], p[4], p[5]), cx + x1 * R - s, cy - y2 * R - s, s * 2, s * 2);
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = alpha;
  // nucleus point
  const ng = g.createRadialGradient(cx, cy, 0, cx, cy, 6 * sc);
  ng.addColorStop(0, '#fff'); ng.addColorStop(0.4, '#ff8a70'); ng.addColorStop(1, 'rgba(255,90,70,0)');
  g.fillStyle = ng; g.beginPath(); g.arc(cx, cy, 6 * sc, 0, Math.PI * 2); g.fill();
  // legend of subshell letters present
  if (opts.labels !== false) {
    const ls = [...new Set(cloudPoints(e, opts.budget || 3600).sub.map(s => s[1]))].sort();
    const fs = 10 * sc;
    g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    let x = rect.x + 6 * sc;
    const y = rect.y + rect.h - 9 * sc;
    for (const l of ls) {
      g.fillStyle = L_COLORS[l];
      g.beginPath(); g.arc(x + 3 * sc, y, 3 * sc, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(220,228,245,0.85)';
      g.fillText(L_LETTER[l], x + 9 * sc, y);
      x += 24 * sc;
    }
  }
  g.restore();
}

// Bohr (mix = 0), cloud (mix = 1), or a cross-fade between them.
export function drawAtom(g, e, rect, t, mixT, opts = {}) {
  const a = opts.alpha ?? 1;
  if (mixT < 0.999) drawBohr(g, e, rect, t, { ...opts, alpha: a * (1 - mixT) });
  if (mixT > 0.001) drawCloud(g, e, rect, t, { ...opts, alpha: a * mixT });
}
