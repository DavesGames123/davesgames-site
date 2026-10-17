// ============================================================================
//  TENSOR CALCULUS  ·  viz/scenes/curvi.js  ·  coordinates and the metric
// ----------------------------------------------------------------------------
//  curvilinear  Polar or spherical coordinates. The coordinate lines (or
//      surfaces) are the level sets of the coordinate functions, so they
//      are the dual basis dr, dθ (dφ). At a moving point P the coordinate
//      basis d/dr, d/dθ (d/dφ) is drawn as arrows: |d/dθ| = r, so the
//      metric is diag(1, r^2) (polar) or diag(1, r^2, r^2 sin^2 θ). One
//      fixed vector V shows that its components change from place to place.
//  metric-field  The Tissot field. Equal small circles on the sphere go
//      to a flat chart (Mercator, plate carree, stereographic). In the
//      chart they are ellipses: the set g_ij dx^i dx^j = eps^2 of the
//      chart metric. The morph slider unrolls the sphere onto the chart.
//  christoffel  The coordinate basis turns and stretches from point to
//      point. d e_i / dx^j = Gamma^k_ij e_k. Polar plane: moving along a
//      circle, d e_r/dθ = (1/r) e_θ and d e_θ/dθ = -r e_r. On the sphere,
//      d e_φ/dφ has a part along the normal; the Christoffel symbols are
//      only the tangent part (-sin θ cos θ e_θ).
//
//  DOM-free maths for tests: grep -n "export function chart\|export function chartMetric\|export function polarGamma"
// ============================================================================
import { LOOK, tn, num, ic, idx } from '../look.js';
import { AX } from './basis.js';
import { sph, sphBasis, add, sub, scl, dot, cross, len, unit, wave, seg, ease, clamp, lerp3, eigSym3 } from '../vmath.js';

// ---- curvilinear ---------------------------------------------------------------
const pol = (r, th, y = 0) => [r * Math.cos(th), y, -r * Math.sin(th)];

export const curvilinear = {
  id: 'curvilinear',
  label: 'Curvilinear coordinates',
  blurb: 'Coordinate lines are the dual basis; the coordinate basis stretches and turns from point to point.',
  params: [
    { key: 'system', label: 'coordinates', options: ['polar', 'spherical'], def: null },
    { key: 'speed', label: 'speed of P', min: 0, max: 2, step: 0.01, def: 1 },
  ],
  camera: { pos: [3.4, 4.2, 5.2], target: [0, 0.3, -0.2], fov: 42 },
  fog: 0.035,
  frame(dl, S) {
    const T = S.time, p = S.p, cyc = Math.floor(T / 24);
    const sys = p.system ?? (cyc % 2 ? 'spherical' : 'polar');
    const w = (p.speed ?? 1) * T;
    if (sys === 'polar') polarFrame(dl, w, S); else sphericalFrame(dl, w, S);
  },
};

function polarFrame(dl, w, S) {
  const rP = 1.7 + 0.9 * Math.sin(w * 0.23), thP = 0.6 + w * 0.17;
  const P = pol(rP, thP, 0.02);
  // the r level sets (circles) and the θ level sets (rays)
  for (let k = 1; k <= 7; k++) {
    const r = k * 0.45, pts = [];
    for (let i = 0; i <= 128; i++) pts.push(pol(r, (2 * Math.PI * i) / 128));
    const near = Math.abs(r - rP) < 0.225;
    dl.poly(pts, AX[0], { w: near ? 2.2 : 1.2, a: near ? 0.8 : 0.3, sym: 'i' });
  }
  for (let k = 0; k < 24; k++) {
    const th = (2 * Math.PI * k) / 24;
    const d = Math.abs(((th - thP) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    const near = d < Math.PI / 24;
    dl.seg(pol(0.05, th), pol(3.3, th), AX[1], { w: near ? 2.2 : 1.1, a: near ? 0.8 : 0.28, sym: 'i' });
  }
  // the level sets through P, raised as sheets: dr (a ring wall), dθ (a fin)
  const ring = [];
  for (let i = 0; i <= 32; i++) ring.push(pol(rP, thP - 0.7 + (1.4 * i) / 32));
  for (let i = 0; i < 32; i++) {
    const f = Math.sin(Math.PI * (i + 0.5) / 32);
    dl.quad(lerp3(add(ring[i], [0, 0.2, 0]), add(ring[i + 1], [0, 0.2, 0]), 0.5), scl(sub(ring[i + 1], ring[i]), 0.5), [0, 0.2, 0], AX[0], { a: 0.12 * f, sym: 'i' });
  }
  dl.quad(add(pol(rP, thP), [0, 0.2, 0]), scl(pol(0.7, thP), 1), [0, 0.2, 0], AX[1], { a: 0.12, sym: 'i' });
  // the basis at P
  const er = pol(1, thP), eth = pol(rP, thP + Math.PI / 2);
  dl.arrow(P, er, AX[0], { r: 0.045, sym: 'i' });
  dl.arrow(P, eth, AX[1], { r: 0.045, sym: 'i' });
  dl.ball(P, 0.06, LOOK.ink);
  dl.label(add(add(P, er), [0.1, 0.2, 0]), `${tn('e', [], ['r'])} = ∂/∂r`, { c: AX[0], size: 15, sym: 'i', anchor: 'l' });
  dl.label(add(add(P, eth), [0, 0.25, 0]), `${tn('e', [], ['θ'])} = ∂/∂θ, &nbsp;|${tn('e', [], ['θ'])}| = r = ${num(rP)}`, { c: AX[1], size: 15, sym: 'i' });
  // a fixed vector V (same arrow everywhere), its components at P
  const Vw = [1.1, 0, -0.55];
  dl.arrow(add(P, [0, 0.35, 0]), Vw, LOOK.vec, { r: 0.035, sym: 'v' });
  const Vr = dot(Vw, er), Vth = dot(Vw, unit(eth)) / rP;
  dl.label(add(add(P, Vw), [0.15, 0.45, 0]), tn('V'), { c: LOOK.vec, size: 17, sym: 'v' });
  dl.label(null, `${tn('V', ['r'])} = ${num(Vr)} &nbsp; ${tn('V', ['θ'])} = ${num(Vth)} &nbsp; (the same arrow)`, { screen: [0.5, 0.94], size: 15, c: LOOK.vec });
  dl.label(null, `${tn('g', [], ['i', 'j'])} = diag(1, r²) = diag(1, ${num(rP * rP)})`, { screen: [0.5, 0.06], size: 17, c: LOOK.metric });
  dl.label(pol(3.35, 0.15, 0.05), 'r = const: level sets of dr', { c: AX[0], size: 12, a: 0.8, anchor: 'l' });
  dl.read('r', rP); dl.read('Vr', Vr); dl.read('Vth', Vth);
}

function sphericalFrame(dl, w, S) {
  const rP = 1.8, thP = 1.0 + 0.35 * Math.sin(w * 0.21), phP = 0.5 + w * 0.15;
  const P = sph(thP, phP, rP);
  // coordinate surfaces through P: the sphere r = rP, the cone θ = θP,
  // the half plane φ = φP
  dl.surface((u, v) => sph(Math.PI * v, 2 * Math.PI * u, rP), 56, 28, AX[0], { a: 0.05, closeU: true, flipN: true, sym: 'i', wire: { nu: 18, nv: 9, c: AX[0], a: 0.08, w: 1 } });
  dl.surface((u, v) => sph(thP, 2 * Math.PI * u, 2.8 * v), 56, 4, AX[1], { a: 0.08, closeU: true, sym: 'i', wire: { nu: 24, nv: 4, c: AX[1], a: 0.22, w: 1 } });
  dl.surface((u, v) => sph(Math.PI * u, phP, 2.8 * v), 24, 4, AX[2], { a: 0.09, sym: 'i', wire: { nu: 12, nv: 4, c: AX[2], a: 0.25, w: 1 } });
  // the three lines through P
  const lat = [], mer = [];
  for (let i = 0; i <= 96; i++) { lat.push(sph(thP, (2 * Math.PI * i) / 96, rP)); mer.push(sph((Math.PI * i) / 96, phP, rP)); }
  dl.poly(lat, AX[2], { w: 2, a: 0.8, sym: 'i' }); dl.poly(mer, AX[1], { w: 2, a: 0.8, sym: 'i' });
  dl.seg([0, 0, 0], scl(unit(P), 3), AX[0], { w: 2, a: 0.7, sym: 'i' });
  const b = sphBasis(thP, phP, rP), er = unit(P);
  dl.arrow(P, er, AX[0], { r: 0.04, sym: 'i' });
  dl.arrow(P, scl(b.eth, 0.55), AX[1], { r: 0.05, sym: 'i' });
  dl.arrow(P, scl(b.eph, 0.55), AX[2], { r: 0.05, sym: 'i' });
  dl.ball(P, 0.06, LOOK.ink);
  dl.label(add(P, scl(er, 1.25)), tn('e', [], ['r']), { c: AX[0], size: 16, sym: 'i' });
  dl.label(add(P, scl(b.eth, 0.7)), `${tn('e', [], ['θ'])} (×0.55)`, { c: AX[1], size: 15, sym: 'i' });
  dl.label(add(P, scl(b.eph, 0.7)), `${tn('e', [], ['φ'])} (×0.55)`, { c: AX[2], size: 15, sym: 'i' });
  dl.label(null, `${tn('g', [], ['i', 'j'])} = diag(1, r², r² sin²θ) = diag(1, ${num(rP * rP)}, ${num((rP * Math.sin(thP)) ** 2)})`, { screen: [0.5, 0.06], size: 17, c: LOOK.metric });
  dl.label(null, `|${tn('e', [], ['θ'])}| = r = ${num(len(b.eth))} &nbsp; |${tn('e', [], ['φ'])}| = r sin θ = ${num(len(b.eph))}`, { screen: [0.5, 0.94], size: 15, c: LOOK.ink });
  dl.read('th', thP); dl.read('eph', len(b.eph));
}

// ---- metric field (Tissot) -------------------------------------------------------
const CH = 0.6;    // chart scale (world units per radian)
// chart(name, th, ph) -> [x, y] in chart units (before CH)
export function chart(name, th, ph) {
  const lat = Math.PI / 2 - th;
  if (name === 'mercator') return [ph, Math.log(Math.tan(Math.PI / 4 + clamp(lat, -1.35, 1.35) / 2))];
  if (name === 'stereographic') { const k = 2 * Math.tan(th / 2); return [k * Math.cos(ph) * 0.55, k * Math.sin(ph) * 0.55]; }
  return [ph, lat];
}
// The pull-back of the round metric to the chart coordinates (x, y) at
// (th, ph): g = J^-T diag(1, sin^2 th) J^-1, with J = d(x, y)/d(th, ph).
export function chartMetric(name, th, ph) {
  const h = 1e-5;
  const a = chart(name, th + h, ph), b = chart(name, th - h, ph), c = chart(name, th, ph + h), d = chart(name, th, ph - h);
  const J = [[(a[0] - b[0]) / (2 * h), (c[0] - d[0]) / (2 * h)], [(a[1] - b[1]) / (2 * h), (c[1] - d[1]) / (2 * h)]];
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  const Ji = [[J[1][1] / det, -J[0][1] / det], [-J[1][0] / det, J[0][0] / det]];
  const G = [[1, 0], [0, Math.sin(th) ** 2]];
  // g_ab = Ji^k_a G_kl Ji^l_b
  const g = [[0, 0], [0, 0]];
  for (let a2 = 0; a2 < 2; a2++) for (let b2 = 0; b2 < 2; b2++) {
    let s = 0;
    for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++) s += Ji[k][a2] * G[k][l] * Ji[l][b2];
    g[a2][b2] = s;
  }
  return g;
}

export const metricField = {
  id: 'metric-field',
  label: 'The metric as an ellipse field',
  blurb: 'Equal circles on the sphere become the ellipses g_ij dx^i dx^j = ε² of a flat chart (Tissot).',
  params: [
    { key: 'chart', label: 'chart', options: ['mercator', 'equirect', 'stereographic'], def: null },
    { key: 'morph', label: 'sphere → chart', min: 0, max: 1, step: 0.01, def: null },
  ],
  camera: { pos: [0.1, 3.5, 3.5], target: [0, 0.45, -0.1], fov: 44 },
  fog: 0.03,
  frame(dl, S) {
    const T = S.time, p = S.p, cyc = Math.floor(T / 18);
    const name = p.chart ?? ['mercator', 'equirect', 'stereographic'][cyc % 3];
    const m = p.morph ?? (S.t != null ? ease(S.t) : (() => { const u = T % 18; return u < 2 ? 0 : u < 8 ? seg(u, 2, 8) : u < 14 ? 1 : 1 - seg(u, 14, 17.5); })());
    const Rg = 1.25, base = [0, 1.35, 0];
    const flat = name !== 'stereographic';
    // the morph: a point (th, ph) on the sphere -> the chart on the ground
    const place = (th, ph) => {
      const s = add(base, sph(th, ph, Rg));
      const c = chart(name, th, ph);
      const f = flat ? [c[0] * CH, 0.01, -c[1] * CH] : [c[0] * CH * 1.5, 0.01, -c[1] * CH * 1.5];
      const k = ease(m);
      // a lift in the middle of the morph, so the sheet peels off the sphere
      const y = Math.sin(Math.PI * k) * 0.25;
      return [s[0] + (f[0] - s[0]) * k, s[1] + (f[1] - s[1]) * k + y, s[2] + (f[2] - s[2]) * k];
    };
    const phLo = flat ? -Math.PI + 1e-3 : -Math.PI, phHi = flat ? Math.PI - 1e-3 : Math.PI;
    const thLo = name === 'mercator' ? 0.22 : name === 'stereographic' ? 0.02 : 0.02;
    const thHi = name === 'stereographic' ? 2.2 : Math.PI - thLo;
    dl.surface((u, v) => place(thLo + (thHi - thLo) * v, phLo + (phHi - phLo) * u), 64, 32, (u, v) => {
      const k = 0.6 + 0.4 * Math.sin(Math.PI * v);
      return [0.1 * k + 0.04, 0.13 * k + 0.05, 0.24 * k + 0.08];
    }, { wire: { nu: 16, nv: 8, c: '#7d8fc4', a: 0.2, w: 1, lift: 0.006 } });
    // the Tissot circles: radius eps on the sphere
    const eps = 0.16;
    const lats = name === 'stereographic' ? [0.4, 0.8, 1.2, 1.6, 2.0] : [-60, -30, 0, 30, 60].map(d => Math.PI / 2 - d * Math.PI / 180);
    const nph = 8;
    let readG = null;
    for (const th of lats) for (let j = 0; j < nph; j++) {
      const ph = -Math.PI + (j + 0.5) * (2 * Math.PI / nph);
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const a = (2 * Math.PI * i) / 40;
        const pt = place(th + eps * Math.cos(a), ph + eps * Math.sin(a) / Math.sin(th));
        pts.push(add(pt, [0, 0.012, 0]));
      }
      const g = chartMetric(name, th, ph), det = g[0][0] * g[1][1] - g[0][1] * g[1][0];
      const areaScale = 1 / Math.sqrt(det);      // chart area per sphere area
      const tcol = clamp(Math.log(areaScale) / 2.2 + 0.2, 0, 1);
      const col = [0.79 + 0.21 * tcol, 0.65 + 0.2 * tcol, 1 - 0.5 * tcol];
      const c = add(scl(pts.reduce((s, q) => add(s, q), [0, 0, 0]), 1 / pts.length), [0, 0, 0]);
      for (let i = 0; i < 40; i++) dl.tri(c, pts[i], pts[i + 1], col, { a: 0.28 });
      dl.poly(pts, col, { w: 1.6, a: 0.95, sym: 'i' });
      if (Math.abs(th - Math.PI / 2 + (name === 'stereographic' ? 0 : Math.PI / 6)) < 1e-6 && j === 5) readG = { g, c };
    }
    if (readG) {
      const g = readG.g;
      dl.label(add(readG.c, [0, 0.25, 0]), `${tn('g', [], ['i', 'j'])}`, { c: LOOK.metric, size: 15, sym: 'i', a: m });
      dl.label(null, `<div class="tc-mat"><span class="tc-mat-n">${tn('g', [], ['i', 'j'])} =</span><span class="tc-br">(</span><span class="tc-grid2"><span>${num(g[0][0])}</span><span>${num(g[0][1])}</span><span>${num(g[1][0])}</span><span>${num(g[1][1])}</span></span><span class="tc-br">)</span></div>`, { screen: [0.04, 0.14], size: 14, c: LOOK.metric, anchor: 'l', a: 0.4 + 0.6 * m });
    }
    const title = { mercator: 'Mercator', equirect: 'plate carrée', stereographic: 'stereographic' }[name];
    dl.label(null, `${title}: &nbsp;${tn('g', [], ['i', 'j'])} d${tn('x', ['i'])} d${tn('x', ['j'])} = ε²`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
    dl.read('morph', m);
  },
};

// ---- Christoffel symbols ---------------------------------------------------------
// Polar coordinates (r, θ): Gamma^r_θθ = -r, Gamma^θ_rθ = Gamma^θ_θr = 1/r.
export function polarGamma(r) {
  return { r: { rr: 0, rth: 0, thth: -r }, th: { rr: 0, rth: 1 / r, thth: 0 } };
}

export const christoffel = {
  id: 'christoffel',
  label: 'Christoffel symbols',
  blurb: 'Basis vectors turn and stretch along coordinate lines: ∂_j e_i = Γ^k_ij e_k.',
  params: [
    { key: 'surface', label: 'space', options: ['polar', 'sphere'], def: null },
    { key: 'line', label: 'move along', options: ['theta', 'r'], def: null },
  ],
  camera: { pos: [2.7, 3.1, 2.1], target: [0.8, 0.3, -0.9], fov: 42 },
  fog: 0.035,
  frame(dl, S) {
    const T = S.time, p = S.p, cyc = Math.floor(T / 30);
    const surf = p.surface ?? (cyc % 2 ? 'sphere' : 'polar');
    if (surf === 'polar') christoffelPolar(dl, S, p.line ?? ((Math.floor(T / 15) % 2) ? 'r' : 'theta'));
    else christoffelSphere(dl, S);
  },
};

function christoffelPolar(dl, S, line) {
  const T = S.time, u = S.t != null ? S.t : (T % 15) / 15;
  // faint polar grid
  for (let k = 1; k <= 7; k++) {
    const pts = [];
    for (let i = 0; i <= 128; i++) pts.push(pol(k * 0.45, (2 * Math.PI * i) / 128));
    dl.poly(pts, LOOK.grid, { w: 1, a: 0.16 });
  }
  for (let k = 0; k < 24; k++) dl.seg(pol(0.05, (2 * Math.PI * k) / 24), pol(3.3, (2 * Math.PI * k) / 24), LOOK.grid, { w: 1, a: 0.14 });
  let r, th;
  if (line === 'theta') { r = 1.8; th = 0.15 + 1.4 * ease(u); }
  else { th = 0.75; r = 0.7 + 2.2 * ease(u); }
  const path = [];
  for (let i = 0; i <= 64; i++) path.push(line === 'theta' ? pol(r, 0.15 + 1.4 * i / 64, 0.02) : pol(0.7 + 2.2 * i / 64, th, 0.02));
  dl.poly(path, LOOK.gold, { w: 2.4, a: 0.7 });
  // a trail of bases
  const n = 7;
  for (let i = 0; i < n; i++) {
    const q = i / (n - 1) * ease(u);
    const rr = line === 'theta' ? r : 0.7 + 2.2 * q, tt = line === 'theta' ? 0.15 + 1.4 * q : th;
    const Pq = pol(rr, tt, 0.02);
    dl.arrow(Pq, scl(pol(1, tt), 0.8), AX[0], { r: 0.012, a: 0.3, sym: 'i' });
    dl.arrow(Pq, scl(pol(rr, tt + Math.PI / 2), 0.4), AX[1], { r: 0.012, a: 0.3, sym: 'i' });
  }
  const P = pol(r, th, 0.02);
  const er = scl(pol(1, th), 0.8), eth = scl(pol(r, th + Math.PI / 2), 0.4);   // drawn at scale
  dl.arrow(P, er, AX[0], { r: 0.04, sym: 'i' });
  dl.arrow(P, eth, AX[1], { r: 0.04, sym: 'i' });
  dl.ball(P, 0.05, LOOK.ink);
  dl.label(add(add(P, er), [0.12, 0.15, 0]), tn('e', [], ['r']), { c: AX[0], size: 16, sym: 'i', anchor: 'l' });
  dl.label(add(add(P, eth), [0, 0.2, 0]), tn('e', [], ['θ']), { c: AX[1], size: 16, sym: 'i' });
  const G = polarGamma(r);
  // the derivative vectors at the tips, decomposed on the basis
  if (line === 'theta') {
    // d e_r / dθ = (1/r) e_θ ; d e_θ / dθ = -r e_r   (drawn at the same scales)
    const d1 = scl(pol(r, th + Math.PI / 2), 0.8 * G.th.rth), d2 = scl(pol(1, th), 0.4 * G.r.thth);
    dl.arrow(add(P, er), d1, LOOK.gold, { r: 0.022, sym: 'k' });
    dl.arrow(add(P, eth), d2, LOOK.gold, { r: 0.022, sym: 'k' });
    dl.label(add(add(P, er), scl(d1, 1.25)), `∂<sub>θ</sub>${tn('e', [], ['r'])} = ${tn('Γ', ['θ'], ['r', 'θ'])}${tn('e', [], ['θ'])}, &nbsp;${tn('Γ', ['θ'], ['r', 'θ'])} = 1/r = ${num(G.th.rth)}`, { c: LOOK.gold, size: 14, anchor: 'l', sym: 'k' });
    dl.label(add(add(P, eth), add(scl(d2, 1.1), [0, 0.25, 0])), `∂<sub>θ</sub>${tn('e', [], ['θ'])} = ${tn('Γ', ['r'], ['θ', 'θ'])}${tn('e', [], ['r'])}, &nbsp;${tn('Γ', ['r'], ['θ', 'θ'])} = −r = ${num(G.r.thth)}`, { c: LOOK.gold, size: 14, anchor: 'r', sym: 'k' });
  } else {
    // d e_θ / dr = (1/r) e_θ ; d e_r / dr = 0
    const d1 = scl(pol(r, th + Math.PI / 2), 0.4 * G.th.rth);
    dl.arrow(add(P, eth), d1, LOOK.gold, { r: 0.022, sym: 'k' });
    dl.label(add(add(P, eth), add(scl(d1, 1.2), [0, 0.2, 0])), `∂<sub>r</sub>${tn('e', [], ['θ'])} = ${tn('Γ', ['θ'], ['θ', 'r'])}${tn('e', [], ['θ'])}, &nbsp;1/r = ${num(G.th.rth)}`, { c: LOOK.gold, size: 14, sym: 'k' });
    dl.label(add(add(P, er), [0.2, -0.15, 0.1]), `∂<sub>r</sub>${tn('e', [], ['r'])} = 0`, { c: LOOK.gold, size: 14, anchor: 'l', sym: 'k' });
  }
  dl.label(null, `∂<sub>${idx('j')}</sub>${tn('e', [], ['i'])} = ${tn('Γ', ['k'], ['i', 'j'])} ${tn('e', [], ['k'])}`, { screen: [0.5, 0.06], size: 17, c: LOOK.ink });
  dl.read('r', r); dl.read('G_th_rth', G.th.rth); dl.read('G_r_thth', G.r.thth);
}

function christoffelSphere(dl, S) {
  const T = S.time, u = S.t != null ? S.t : (T % 15) / 15;
  const Rs = 1.5, c0 = [0.6, 0, -0.9];
  const th = 0.9, ph = -0.4 + 2.0 * ease(u);
  dl.surface((a, b) => add(c0, sph(Math.PI * b, 2 * Math.PI * a, Rs)), 64, 32, (a, b) => [0.1, 0.13, 0.25], { closeU: true, flipN: true, wire: { nu: 24, nv: 12, c: '#7d8fc4', a: 0.15, w: 1, lift: 0.004 } });
  const lat = [];
  for (let i = 0; i <= 96; i++) lat.push(add(c0, sph(th, (2 * Math.PI * i) / 96, Rs * 1.004)));
  dl.poly(lat, LOOK.gold, { w: 2.2, a: 0.7 });
  const P = add(c0, sph(th, ph, Rs * 1.004)), b = sphBasis(th, ph, Rs), n = unit(sph(th, ph));
  const s = 0.55;
  dl.arrow(P, scl(b.eth, s), AX[1], { r: 0.035, sym: 'i' });
  dl.arrow(P, scl(b.eph, s), AX[2], { r: 0.035, sym: 'i' });
  dl.ball(P, 0.045, LOOK.ink);
  // d e_φ / dφ in R^3 = -R sin th (cos ph, 0, sin ph): split into normal and tangent parts
  const de = [-Rs * Math.sin(th) * Math.cos(ph), 0, -Rs * Math.sin(th) * Math.sin(ph)];
  const nPart = scl(n, dot(de, n)), tPart = sub(de, nPart);
  const tip = add(P, scl(b.eph, s));
  dl.arrow(tip, scl(de, s), LOOK.dim, { r: 0.012, a: 0.6 });
  dl.arrow(tip, scl(nPart, s), '#d58cff', { r: 0.014, a: 0.8 });
  dl.arrow(tip, scl(tPart, s), LOOK.gold, { r: 0.022, sym: 'k' });
  const Gt = -Math.sin(th) * Math.cos(th);
  dl.label(add(tip, scl(tPart, s * 1.3)), `${tn('Γ', ['θ'], ['φ', 'φ'])}${tn('e', [], ['θ'])}`, { c: LOOK.gold, size: 15, sym: 'k', anchor: 'l' });
  dl.label(add(tip, add(scl(nPart, s * 1.1), [0, -0.1, 0])), 'normal part (not in the surface)', { c: '#d58cff', size: 12, anchor: 'l' });
  dl.label(add(P, scl(b.eph, s * 0.5 + 0.2)), tn('e', [], ['φ']), { c: AX[2], size: 16, sym: 'i' });
  dl.label(add(P, scl(b.eth, s * 1.15)), tn('e', [], ['θ']), { c: AX[1], size: 16, sym: 'i' });
  dl.label(null, `∂<sub>φ</sub>${tn('e', [], ['φ'])} = ${tn('Γ', ['θ'], ['φ', 'φ'])}${tn('e', [], ['θ'])} + normal, &nbsp; ${tn('Γ', ['θ'], ['φ', 'φ'])} = −sin θ cos θ = ${num(Gt)}`, { screen: [0.5, 0.06], size: 16, c: LOOK.ink });
  dl.read('G_th_phph', Gt); dl.read('tangentLen', len(tPart)); dl.read('expected', Math.abs(Gt) * Rs);
}
