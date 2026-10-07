// ============================================================================
//  MAXWELL'S EQUATIONS  ·  panels.js  ·  one live scene per law  (no DOM)
// ----------------------------------------------------------------------------
//  Each scene draws one law into a pixel rectangle of a 2D canvas context,
//  and gives the two sides of its law as numbers. All numbers come from
//  physics.js. main.js gives each scene a canvas in the four-up, and the
//  saver draws the same scenes into one canvas. tests.mjs imports this file
//  in Node and checks that each readout obeys its law.
//
//  SCENE INTERFACE   (world units, x right, y up, z out of the page)
//      keys            the hover keys the scene draws (see KEYS)
//      reset()         the start state
//      step(dt, sim)   advance the scene clock. sim = { t, strength }
//      draw(ctx, rect, look)   rect = { x, y, w, h } in px. look = { hot,
//                      px, font }: hot is a key to show bright, px a line
//                      width scale.
//      pick(px, py)    a drag handle under the pointer, or null
//      drag(h, px, py) move the handle.   release()  end the drag
//      hit(px, py)     the hover key under the pointer, or null
//      readout()       { lhs, rhs: [..], unit } each { k, h, v }: the key,
//                      an HTML label and the value
//      auto(t)         slow drift for the saver
//
//  KEYS AND COLOURS   (the lib/sci.css math classes)
//      S  the closed surface or loop   m3 green
//      E  electric field, flux Φ_E     m2 orange
//      B  magnetic field, flux Φ_B     m1 blue
//      Q  charge                       m4 pink (negative: Qn periwinkle)
//      J  current                      m5 yellow
//
//  THE TWO VIEWS
//      Four laws:     GaussE (charges), GaussB (bar magnet), Faraday (a
//                     magnet through a loop), Ampere (a charging capacitor).
//      Link the four: CapGaussE, CapGaussB, CapFaraday and Ampere. All four
//                     look at one capacitor on one AC clock (capState).
//      Light:         Light, the Yee grid of physics.js Wave1D.
//
//  SECTION MAP   (jump with grep -n "<anchor>" panels.js)
//      colours ............ "export const COL"
//      view fit ........... "export function fitView"
//      draw helpers ....... "function arrow"
//      magnet lines ....... "function magnetLines"
//      Faraday table ...... "export function faradayTable"
//      capacitor clock .... "export function capState"
//      capacitor art ...... "function drawCap"
//      Gauss E ............ "export class GaussE"
//      Gauss B ............ "export class GaussB"
//      Faraday ............ "export class Faraday"
//      Ampere-Maxwell ..... "export class Ampere"
//      linked Gauss E ..... "export class CapGaussE"
//      linked Gauss B ..... "export class CapGaussB"
//      linked Faraday ..... "export class CapFaraday"
//      light .............. "export class Light"
// ============================================================================
import {
  coulomb, sphereFluxCharges, chargeInside, sphereFlux, discFlux, loopIntegral, segB, segA,
  magnetSegments, makeCapacitor, capCharges, capE, capB, faradayRect, ampereMaxwell,
  traceLine, Wave1D, SI_EPS0, SI_MU0, lightSpeed,
} from './physics.js';

/* ═══ COLOURS ═══ */
export const COL = { S: '#86dc7c', E: '#ff9a62', B: '#62c4ff', Q: '#e889dc', Qn: '#8c9cff', J: '#ffd666', ink: '#eef3fb', dim: '#7f91ad', bg: '#0b0e14' };
export const KEYCLASS = { S: 'm3', E: 'm2', B: 'm1', Q: 'm4', J: 'm5' };
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const tanh = Math.tanh, TAU = 2 * Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ═══ VIEW FIT ═══ */
// Fit the world box { cx, cy, w, h } in the px rectangle (contain). The
// view maps world to px (y turns down) and back.
export function fitView(rect, box, pad = 6) {
  const k = Math.max(1e-3, Math.min((rect.w - 2 * pad) / box.w, (rect.h - 2 * pad) / box.h));
  const ox = rect.x + rect.w / 2 - box.cx * k, oy = rect.y + rect.h / 2 + box.cy * k;
  return { k, rect, X: x => ox + x * k, Y: y => oy - y * k, inv: (px, py) => [(px - ox) / k, (oy - py) / k] };
}
// Line alpha and width for a key: bright when hot, dim when another key is.
function tone(look, key, a = 0.8) {
  if (!look.hot) return { a, w: 1 };
  return look.hot === key ? { a: 1, w: 1.7 } : { a: a * 0.32, w: 1 };
}

/* ═══ DRAW HELPERS ═══ */
function arrow(ctx, x1, y1, x2, y2, head, color, width) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 0.5) return;
  const ux = dx / L, uy = dy / L, h = Math.min(head, L * 0.6);
  ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - ux * h * 0.7, y2 - uy * h * 0.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * h - uy * h * 0.45, y2 - uy * h + ux * h * 0.45);
  ctx.lineTo(x2 - ux * h + uy * h * 0.45, y2 - uy * h - ux * h * 0.45); ctx.closePath(); ctx.fill();
}
function headAt(ctx, x, y, ux, uy, h, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x + ux * h * 0.6, y + uy * h * 0.6);
  ctx.lineTo(x - ux * h * 0.6 - uy * h * 0.5, y - uy * h * 0.6 + ux * h * 0.5);
  ctx.lineTo(x - ux * h * 0.6 + uy * h * 0.5, y - uy * h * 0.6 - ux * h * 0.5); ctx.closePath(); ctx.fill();
}
// A traced line (flat world points), mapped by map(x, y) -> [px, py],
// dashed so the dashes flow along the line at speed flow (px/s).
function flowPath(ctx, pts, map, color, width, t, flow) {
  if (pts.length < 4) return;
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.setLineDash([7, 6]); ctx.lineDashOffset = -t * flow;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) { const [x, y] = map(pts[i], pts[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke(); ctx.setLineDash([]);
}
function nearPath(lines, x, y, d, map) {
  for (const pts of lines) for (let i = 0; i < pts.length; i += 4) {
    const p = map ? map(pts[i], pts[i + 1]) : [pts[i], pts[i + 1]];
    if (Math.abs(p[0] - x) < d && Math.abs(p[1] - y) < d) return true;
  }
  return false;
}
function charge(ctx, x, y, r, q, look, hot) {
  const c = q > 0 ? COL.Q : COL.Qn, t = tone(look, 'Q', 1);
  if (hot) { ctx.fillStyle = rgba(c, 0.18); ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, TAU); ctx.fill(); }
  ctx.fillStyle = rgba(c, t.a); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = COL.bg; ctx.lineWidth = Math.max(1.4, r * 0.18);
  ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y);
  if (q > 0) { ctx.moveTo(x, y - r * 0.5); ctx.lineTo(x, y + r * 0.5); }
  ctx.stroke();
}
function text(ctx, s, x, y, color, size, look, align = 'left', base = 'alphabetic') {
  ctx.font = `500 ${Math.round(size)}px ${look.font || 'Inter, system-ui, sans-serif'}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y);
}
// A circle seen as a sphere: the green outline with a soft fill.
function sphereRing(ctx, v, s, look) {
  const t = tone(look, 'S', 0.95), r = s.R * v.k;
  ctx.fillStyle = rgba(COL.S, 0.05 * t.a); ctx.beginPath(); ctx.arc(v.X(s.x), v.Y(s.y), r, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba(COL.S, t.a); ctx.lineWidth = 1.6 * t.w * look.px; ctx.stroke();
  ctx.fillStyle = rgba(COL.S, t.a); ctx.beginPath(); ctx.arc(v.X(s.x + s.R), v.Y(s.y), 3.2 * look.px, 0, TAU); ctx.fill();
}
// Flux arrows round a circle: n points, field(x, y) -> [fx, fy] in the page.
// An arrow points out where the field leaves the surface, in where it enters.
function fluxArrows(ctx, v, s, field, ref, color, key, look, n = 28) {
  const t = tone(look, key, 0.9), L = 15 * v.k;
  for (let i = 0; i < n; i++) {
    const p = TAU * (i + 0.5) / n, nx = Math.cos(p), ny = Math.sin(p), x = s.x + s.R * nx, y = s.y + s.R * ny;
    const f = field(x, y), fn = f[0] * nx + f[1] * ny, m = tanh(Math.abs(fn) / ref);
    if (m < 0.04) continue;
    const l = L * m, X = v.X(x), Y = v.Y(y), ex = X + nx * l, ey = Y - ny * l, c = rgba(color, t.a * (0.4 + 0.6 * m));
    if (fn > 0) arrow(ctx, X, Y, ex, ey, 5 * look.px, c, 1.2 * t.w * look.px);   // leaves the surface
    else arrow(ctx, ex, ey, X, Y, 5 * look.px, c, 1.2 * t.w * look.px);          // enters it
  }
}
function pickSphere(s, x, y, tol) {
  const d = Math.hypot(x - s.x, y - s.y);
  if (Math.abs(d - s.R) < tol) return { type: 'R' };
  if (d < s.R) return { type: 'move', ox: x - s.x, oy: y - s.y };
  return null;
}
function dragSphere(s, h, x, y, box, Rmin = 14, Rmax = 140) {
  if (h.type === 'R') s.R = clamp(Math.hypot(x - s.x, y - s.y), Rmin, Rmax);
  else { s.x = clamp(x - h.ox, -box.w / 2, box.w / 2); s.y = clamp(y - h.oy, -box.h / 2, box.h / 2); }
}
// A circular loop in the y-z plane at x, radius r, seen at an angle: the
// ellipse x + 0.35 r sin p, r cos p. The z > 0 half (sin p > 0) is in front.
const SKEW = 0.35;
function loopPath(ctx, v, x, r, front) {
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const p = (front ? 0 : Math.PI) + Math.PI * i / 48, X = v.X(x + SKEW * r * Math.sin(p)), Y = v.Y(r * Math.cos(p));
    if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
  }
}
// Arrow heads on the front half of a loop, in the right-hand sense about +x
// when sign > 0 (the direction of increasing p).
function loopHeads(ctx, v, x, r, sign, color, size) {
  if (!sign) return;
  for (const p of [Math.PI * 0.3, Math.PI * 0.5, Math.PI * 0.7]) {
    const X = v.X(x + SKEW * r * Math.sin(p)), Y = v.Y(r * Math.cos(p));
    let tx = SKEW * r * Math.cos(p) * v.k, ty = r * Math.sin(p) * v.k;   // d/dp in px (y down)
    const L = Math.hypot(tx, ty) || 1; tx *= sign / L; ty *= sign / L;
    headAt(ctx, X, Y, tx, ty, size, color);
  }
}
const fmt = (v, d = 3) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d);
export { fmt };

/* ═══ BAR MAGNET ═══ */
// The page magnet: a light copy of physics.js MAGNET (8 rings of 16
// segments, the same length, radius and total turns current).
export const PMAG = { half: 38, radius: 13, rings: 8, segs: 16, current: 37.5, soft: 4 };
const MAG0 = magnetSegments(0, 0, 0, PMAG);
const Bmag = (x, y, z, o) => segB(MAG0, x, y, z, PMAG.soft, 1, o);
// The flux through the bore at the middle of the magnet. Readouts of the
// magnet scenes are in units of PHI0 / 10, so the numbers are near 1 to 10.
export const PHI0 = discFlux(Bmag, [0, 0, 0], [1, 0, 0], PMAG.radius, 16, 32);
export const MAGUNIT = 10 / PHI0;
// Field lines of the magnet at the origin, axis along +x, in the page plane.
// Each starts in the bore and runs until it closes or leaves the box.
let magLinesCache = null;
function magnetLines() {
  if (magLinesCache) return magLinesCache;
  const f = (x, y) => { const o = Bmag(x, y, 0, [0, 0, 0]); return [o[0], o[1]]; };
  magLinesCache = [-9.5, -6, -2.5, 2.5, 6, 9.5].map(y0 =>
    traceLine(f, 0, y0, 1, 2.5, 1600, (x, y, n) => (n > 40 && Math.hypot(x, y - y0) < 2.6) || Math.abs(x) > 420 || Math.abs(y) > 320));
  return magLinesCache;
}
function drawMagnet(ctx, v, x, y, a, look, s = 1) {
  const ca = Math.cos(a), sa = Math.sin(a), h = PMAG.half, r = PMAG.radius;
  const P = (u, w) => [v.X(x + u * ca - w * sa), v.Y(y + u * sa + w * ca)];
  const t = tone(look, 'B', 1);
  const half = (u0, u1, fill) => {
    ctx.fillStyle = fill; ctx.beginPath();
    for (const [u, w] of [[u0, -r], [u1, -r], [u1, r], [u0, r]]) { const p = P(u, w); ctx.lineTo(p[0], p[1]); }
    ctx.closePath(); ctx.fill();
  };
  half(-h, 0, rgba('#3a4256', 0.95)); half(0, h, rgba('#24496a', 0.95));
  ctx.strokeStyle = rgba(COL.B, 0.55 * t.a); ctx.lineWidth = 1 * look.px; ctx.beginPath();
  for (const [u, w] of [[-h, -r], [h, -r], [h, r], [-h, r], [-h, -r]]) { const p = P(u, w); ctx.lineTo(p[0], p[1]); }
  ctx.stroke();
  const fs = Math.max(9, Math.min(13, r * v.k * 0.95)) * look.px;
  const pn = P(h * 0.62, 0), ps = P(-h * 0.62, 0);
  text(ctx, 'N', pn[0], pn[1], rgba(COL.ink, 0.9), fs, look, 'center', 'middle');
  text(ctx, 'S', ps[0], ps[1], rgba(COL.ink, 0.6), fs, look, 'center', 'middle');
}
function inMagnet(lx, ly, pad) { return Math.abs(lx) < PMAG.half + pad && Math.abs(ly) < PMAG.radius + pad; }

/* ═══ FARADAY TABLE ═══ */
// The flux Phi(d) of the page magnet through a loop of radius R (normal +x)
// at distance d from the magnet centre, and the line integral L(d) of the
// vector potential round the same loop (Stokes: L = Phi, computed apart).
// The magnet is symmetric, so Phi(-d) = Phi(d): the table holds d >= 0.
// EMF from the flux: -V dPhi/dd. EMF from the line integral of the
// induced E = -dA/dt = -V dA/dd: -V dL/dd. Both use the table slopes.
export function faradayTable(R, dmax = 300, step = 2, m = PMAG) {
  const n = Math.round(dmax / step) + 1, phi = new Float64Array(n), line = new Float64Array(n);
  const c = [0, 0, 0], nrm = [1, 0, 0];
  let i = 0;
  const tab = { R, step, n, phi, line, done: false, fill(maxRows = n) {
    for (let k = 0; k < maxRows && i < n; k++, i++) {
      const segs = magnetSegments(i * step, 0, 0, m);
      phi[i] = discFlux((x, y, z, o) => segB(segs, x, y, z, m.soft, 1, o), c, nrm, R, 16, 32);
      line[i] = loopIntegral((x, y, z, o) => segA(segs, x, y, z, m.soft, 1, o), c, nrm, R, 96);
    }
    this.done = i >= n; return this.done;
  } };
  return tab;
}
// Value and slope at signed distance d (linear in the value, the slope from
// central differences of the nodes, linear between nodes).
export function tableAt(tab, arr, d) {
  const s = Math.sign(d) || 1, u = Math.abs(d) / tab.step, i = Math.floor(u), f = u - i, n = tab.n;
  if (i >= n - 1) return { v: 0, dv: 0 };
  const val = j => arr[Math.min(n - 1, j)];
  const slope = j => j <= 0 ? 0 : (val(j + 1) - val(j - 1)) / (2 * tab.step);
  return { v: val(i) * (1 - f) + val(i + 1) * f, dv: s * (slope(i) * (1 - f) + slope(i + 1) * f) };
}

/* ═══ CAPACITOR ═══ */
// One capacitor for every capacitor scene, on one AC clock:
//   I(t) = s cos(w t),  Q(t) = (s / w) sin(w t),  dI/dt = -s w sin(w t).
// The wire current I is dQ/dt, so the scenes agree at every instant.
export const CAP = makeCapacitor();
export const CAP_W = TAU / 6;
export function capState(sim) {
  const w = CAP_W, s = sim.strength, p = w * sim.t;
  return { I: s * Math.cos(p), Q: s / w * Math.sin(p), dIdt: -s * w * Math.sin(p) };
}
// B (z part) per unit current on a grid of the page, for the dot and cross
// markers; E (x part) per unit charge across the gap.
const BGRID = (() => {
  const g = [];
  for (let x = -176; x <= 176; x += 22) for (let y = -110; y <= 110; y += 22) {
    if (Math.abs(y) < 10) continue;
    g.push({ x, y, b: capB(CAP, 1, x, y, 0)[2] });
  }
  return g;
})();
const EGAP = (() => { const g = []; for (let y = -52; y <= 52; y += 13) g.push({ y, e: capE(CAP, 1, 0, y, 0)[0] }); return g; })();
const BREF = 0.006, EREF = 4e-5;
// The capacitor art: wires with moving current dots, plates with charge
// marks, E arrows in the gap, displacement arrows, and the B markers.
function drawCap(ctx, v, st, look, opt = {}) {
  const { I, Q } = st, xl = CAP.xl, xr = CAP.xr, Rp = CAP.Rp, px = look.px;
  // B markers: a dot (out of the page) or a cross (into it).
  if (opt.bgrid !== false) {
    const tb = tone(look, 'B', 0.75);
    for (const g of BGRID) {
      const b = g.b * I, m = tanh(Math.abs(b) / BREF); if (m < 0.06) continue;
      const X = v.X(g.x), Y = v.Y(g.y), r = (1.5 + 4.5 * m) * px * Math.min(1.4, v.k * 1.2);
      ctx.strokeStyle = ctx.fillStyle = rgba(COL.B, tb.a * (0.3 + 0.7 * m)); ctx.lineWidth = 1 * px * tb.w;
      if (b > 0) { ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(X, Y, Math.max(1, r * 0.28), 0, TAU); ctx.fill(); }
      else { const q = r * 0.75; ctx.beginPath(); ctx.moveTo(X - q, Y - q); ctx.lineTo(X + q, Y + q); ctx.moveTo(X + q, Y - q); ctx.lineTo(X - q, Y + q); ctx.stroke(); }
    }
  }
  // Wires and the current dots.
  const tj = tone(look, 'J', 0.9), wx0 = v.inv(v.rect.x, 0)[0] - 10, wx1 = v.inv(v.rect.x + v.rect.w, 0)[0] + 10;
  ctx.strokeStyle = rgba(COL.J, 0.55 * tj.a); ctx.lineWidth = 2 * px * tj.w;
  ctx.beginPath(); ctx.moveTo(v.X(wx0), v.Y(0)); ctx.lineTo(v.X(xl), v.Y(0)); ctx.moveTo(v.X(xr), v.Y(0)); ctx.lineTo(v.X(wx1), v.Y(0)); ctx.stroke();
  const ph = st.phase || 0, m = tanh(Math.abs(I) / 0.5);
  ctx.fillStyle = rgba(COL.J, tj.a * (0.25 + 0.75 * m));
  for (let x = Math.floor(wx0 / 20) * 20; x < wx1; x += 20) {
    const xx = x + ((ph % 20) + 20) % 20; if (xx > xl - 3 && xx < xr + 3) continue;
    ctx.beginPath(); ctx.arc(v.X(xx), v.Y(0), 2.2 * px, 0, TAU); ctx.fill();
  }
  if (Math.abs(I) > 0.04) for (const xa of [-120, 120]) headAt(ctx, v.X(xa), v.Y(0) - 9 * px, Math.sign(I), 0, 6 * px, rgba(COL.J, tj.a));
  // Plates and charge marks.
  const tq = tone(look, 'Q', 1);
  for (const [x, sg] of [[xl, 1], [xr, -1]]) {
    ctx.fillStyle = '#566179'; ctx.fillRect(v.X(x) - 2 * px, v.Y(Rp), 4 * px, 2 * Rp * v.k);
    const q = Q * sg, n = Math.round(5 * tanh(Math.abs(q) / 0.6));
    for (let i = 0; i < n; i++) {
      const y = Rp * (-0.8 + 1.6 * (i + 0.5) / n), X = v.X(x) + (sg > 0 ? -9 : 9) * px, Y = v.Y(y);
      ctx.strokeStyle = rgba(q > 0 ? COL.Q : COL.Qn, tq.a); ctx.lineWidth = 1.5 * px;
      ctx.beginPath(); ctx.moveTo(X - 3 * px, Y); ctx.lineTo(X + 3 * px, Y); if (q > 0) { ctx.moveTo(X, Y - 3 * px); ctx.lineTo(X, Y + 3 * px); } ctx.stroke();
    }
  }
  // E across the gap (solid) and its rate of change (dashed).
  if (opt.egap !== false) {
    const te = tone(look, 'E', 0.9), gw = (xr - xl) * v.k;
    for (const g of EGAP) {
      const e = g.e * Q, me = tanh(Math.abs(e) / EREF), Y = v.Y(g.y);
      if (me > 0.05) { const L = (gw - 14 * px) * me * Math.sign(e), X0 = v.X(0) - L / 2; arrow(ctx, X0, Y, X0 + L, Y, 5 * px, rgba(COL.E, te.a * (0.35 + 0.65 * me)), 1.4 * px * te.w); }
    }
    if (opt.disp) {
      const md = tanh(Math.abs(I) / 0.5);
      if (md > 0.05) {
        ctx.setLineDash([3, 3]);
        for (const y of [-58, 58]) { const L = (gw - 10 * px) * md * Math.sign(I), X0 = v.X(0) - L / 2; arrow(ctx, X0, v.Y(y), X0 + L, v.Y(y), 5 * px, rgba(COL.E, te.a * 0.75), 1.2 * px); }
        ctx.setLineDash([]);
      }
    }
  }
}
function capHit(x, y, tol) {
  if (Math.abs(y) < tol && (x < CAP.xl || x > CAP.xr)) return 'J';
  if ((Math.abs(x - CAP.xl) < tol || Math.abs(x - CAP.xr) < tol) && Math.abs(y) < CAP.Rp) return 'Q';
  if (x > CAP.xl && x < CAP.xr && Math.abs(y) < CAP.Rp) return 'E';
  return null;
}

// A base for the scenes: the world box, the view of the last draw, the
// pointer in world units.
class Scene {
  constructor(box) { this.box = box; this.v = null; this.t = 0; }
  w(px, py) { return this.v ? this.v.inv(px, py) : [0, 0]; }
  tol() { return this.v ? 10 / this.v.k : 10; }
  release() {}
  auto() {}
}

/* ═══ GAUSS E ═══ */
// Point charges in the page and a sphere (seen as a circle). The flux of E
// out of the sphere is sphereFluxCharges; the right side is the charge
// inside over eps0. Drag a charge, the sphere, or its rim.
export class GaussE extends Scene {
  constructor() { super({ cx: 0, cy: 0, w: 380, h: 220 }); this.keys = ['S', 'E', 'Q']; this.reset(); }
  reset() { this.charges = [{ x: -78, y: 22, q: 2 }, { x: 0, y: -30, q: -1 }, { x: 110, y: 40, q: 1 }]; this.surf = { x: -40, y: 0, R: 78 }; this.dirty = true; }
  field(x, y) { return coulomb(this.charges, x, y, 0, [0, 0, 0]); }
  update() {
    if (!this.dirty) return; this.dirty = false;
    const f = (x, y) => this.field(x, y), cs = this.charges, B = 300;
    const stop = (x, y) => Math.abs(x) > B || Math.abs(y) > B * 0.8 || cs.some(c => Math.hypot(x - c.x, y - c.y) < 7);
    this.lines = [];
    for (const c of cs) {
      const n = 6 * Math.abs(c.q), dir = Math.sign(c.q);
      for (let i = 0; i < n; i++) {
        const p = TAU * (i + 0.5) / n, pts = traceLine(f, c.x + 9 * Math.cos(p), c.y + 9 * Math.sin(p), dir, 3, 300, stop);
        pts.dir = dir; this.lines.push(pts);
      }
    }
    const s = this.surf;
    this.flux1 = sphereFluxCharges(cs, s.x, s.y, 0, s.R);
    this.qenc1 = chargeInside(cs, s.x, s.y, 0, s.R);
  }
  step(dt, sim) { this.t += dt; this.s = sim.strength; }
  draw(ctx, rect, look) {
    this.update();
    const v = this.v = fitView(rect, this.box), map = (x, y) => [v.X(x), v.Y(y)], te = tone(look, 'E', 0.55);
    for (const L of this.lines) flowPath(ctx, L, map, rgba(COL.E, te.a), 1.1 * look.px * te.w, this.t, 14 * L.dir);
    sphereRing(ctx, v, this.surf, look);
    fluxArrows(ctx, v, this.surf, (x, y) => this.field(x, y), 1 / (4 * Math.PI * 60 * 60) * 1.4, COL.E, 'E', look);
    const s = this.surf;
    for (const c of this.charges) {
      const inside = Math.hypot(c.x - s.x, c.y - s.y) < s.R;
      charge(ctx, v.X(c.x), v.Y(c.y), 9 * look.px * Math.min(1.3, Math.max(0.8, v.k)), c.q, look, inside && look.hot === 'Q');
      text(ctx, (c.q > 0 ? '+' : '−') + Math.abs(c.q * (this.s || 1)).toFixed(this.s === 1 ? 0 : 1), v.X(c.x) + 13 * look.px, v.Y(c.y) - 9 * look.px, rgba(c.q > 0 ? COL.Q : COL.Qn, 0.85), 11 * look.px, look);
    }
  }
  pick(px, py) {
    const [x, y] = this.w(px, py), tol = this.tol();
    const i = this.charges.findIndex(c => Math.hypot(x - c.x, y - c.y) < Math.max(14, tol * 1.4));
    if (i >= 0) return { type: 'q', i, ox: x - this.charges[i].x, oy: y - this.charges[i].y };
    return pickSphere(this.surf, x, y, tol);
  }
  drag(h, px, py) {
    const [x, y] = this.w(px, py), b = this.box;
    if (h.type === 'q') { const c = this.charges[h.i]; c.x = clamp(x - h.ox, -b.w / 2 + 8, b.w / 2 - 8); c.y = clamp(y - h.oy, -b.h / 2 + 8, b.h / 2 - 8); }
    else dragSphere(this.surf, h, x, y, b);
    this.dirty = true;
  }
  hit(px, py) {
    const [x, y] = this.w(px, py), tol = this.tol();
    if (this.charges.some(c => Math.hypot(x - c.x, y - c.y) < Math.max(13, tol))) return 'Q';
    if (Math.abs(Math.hypot(x - this.surf.x, y - this.surf.y) - this.surf.R) < tol) return 'S';
    if (this.lines && nearPath(this.lines, x, y, tol * 0.7)) return 'E';
    return null;
  }
  readout() {
    this.update(); const s = this.s || 1;
    return { lhs: { k: 'S', h: '<i class="m3">∮</i> <b class="m2">E</b>·<i class="m3">dA</i>', v: this.flux1 * s },
      rhs: [{ k: 'Q', h: '<i class="m4">Q</i><sub>enc</sub>/ε₀', v: this.qenc1 * s }], unit: 'q/ε₀' };
  }
  auto(t) {
    const p = t * 0.05;
    this.charges[0].x = -78 + 26 * Math.sin(p * 1.3); this.charges[0].y = 22 + 20 * Math.cos(p);
    this.charges[1].x = 30 * Math.sin(p * 0.9 + 1); this.surf.x = -40 + 70 * Math.sin(p * 0.7); this.surf.R = 78 + 18 * Math.sin(p * 1.1);
    this.dirty = true;
  }
}

/* ═══ GAUSS B ═══ */
// A bar magnet (a short solenoid) and a sphere. B lines close on
// themselves, so what leaves the sphere comes back in: out + in = 0.
// Drag the magnet body to move it, an end to turn it, the sphere or its rim.
export class GaussB extends Scene {
  constructor() { super({ cx: 0, cy: 0, w: 380, h: 220 }); this.keys = ['S', 'B']; this.reset(); }
  reset() { this.mag = { x: -30, y: -6, a: 0.3 }; this.surf = { x: 22, y: 18, R: 56 }; this.dirty = true; }
  local(x, y) { const m = this.mag, c = Math.cos(m.a), s = Math.sin(m.a), dx = x - m.x, dy = y - m.y; return [dx * c + dy * s, -dx * s + dy * c]; }
  world(lx, ly) { const m = this.mag, c = Math.cos(m.a), s = Math.sin(m.a); return [m.x + lx * c - ly * s, m.y + lx * s + ly * c]; }
  fieldW(x, y) {
    const [lx, ly] = this.local(x, y), o = Bmag(lx, ly, 0, [0, 0, 0]), c = Math.cos(this.mag.a), s = Math.sin(this.mag.a);
    return [o[0] * c - o[1] * s, o[0] * s + o[1] * c];
  }
  update() {
    if (!this.dirty) return; this.dirty = false;
    const [lx, ly] = this.local(this.surf.x, this.surf.y);
    this.f = sphereFlux(Bmag, lx, ly, 0, this.surf.R, 64, 128);
  }
  step(dt, sim) { this.t += dt; this.s = sim.strength; }
  draw(ctx, rect, look) {
    this.update();
    const v = this.v = fitView(rect, this.box), tb = tone(look, 'B', 0.55);
    const map = (lx, ly) => { const [x, y] = this.world(lx, ly); return [v.X(x), v.Y(y)]; };
    for (const L of magnetLines()) flowPath(ctx, L, map, rgba(COL.B, tb.a), 1.1 * look.px * tb.w, this.t, 14);
    sphereRing(ctx, v, this.surf, look);
    fluxArrows(ctx, v, this.surf, (x, y) => this.fieldW(x, y), 0.25, COL.B, 'B', look);
    drawMagnet(ctx, v, this.mag.x, this.mag.y, this.mag.a, look);
  }
  pick(px, py) {
    const [x, y] = this.w(px, py), [lx, ly] = this.local(x, y);
    if (inMagnet(lx, ly, 4)) return Math.abs(lx) > PMAG.half * 0.55 ? { type: 'turn', a0: this.mag.a - Math.atan2(y - this.mag.y, x - this.mag.x) } : { type: 'mag', ox: x - this.mag.x, oy: y - this.mag.y };
    return pickSphere(this.surf, x, y, this.tol());
  }
  drag(h, px, py) {
    const [x, y] = this.w(px, py), b = this.box;
    if (h.type === 'turn') this.mag.a = Math.atan2(y - this.mag.y, x - this.mag.x) + h.a0;
    else if (h.type === 'mag') { this.mag.x = clamp(x - h.ox, -b.w / 2 + 20, b.w / 2 - 20); this.mag.y = clamp(y - h.oy, -b.h / 2 + 14, b.h / 2 - 14); }
    else dragSphere(this.surf, h, x, y, b);
    this.dirty = true;
  }
  hit(px, py) {
    const [x, y] = this.w(px, py), tol = this.tol(), [lx, ly] = this.local(x, y);
    if (Math.abs(Math.hypot(x - this.surf.x, y - this.surf.y) - this.surf.R) < tol) return 'S';
    if (inMagnet(lx, ly, 2) || nearPath(magnetLines(), lx, ly, tol * 0.7)) return 'B';
    return null;
  }
  readout() {
    this.update(); const k = MAGUNIT * (this.s || 1);
    return { lhs: { k: 'S', h: '<i class="m3">∮</i> <b class="m1">B</b>·<i class="m3">dA</i>', v: this.f.net * k },
      rhs: [{ k: 'B', h: 'out', v: this.f.out * k, part: true }, { k: 'B', h: 'in', v: this.f.in * k, part: true }], zero: true, unit: '' };
  }
  auto(t) { this.mag.a = 0.3 + t * 0.07; this.mag.x = -30 + 26 * Math.sin(t * 0.05); this.surf.x = 22 + 40 * Math.sin(t * 0.04 + 1); this.dirty = true; }
}

/* ═══ FARADAY ═══ */
// A magnet moves along the axis of a fixed loop (radius LOOPR at x = 0).
// The flux and the EMF come from faradayTable. A trace below the scene
// shows the EMF and the flux over the last seconds. The arrows on the loop
// show the induced current (Lenz): its own B, at the loop centre, points
// against the change of the flux.
export const LOOPR = 34, FAR_A = 112, FAR_W = TAU / 7;
let FTAB = null;
export function faradayPageTable() { if (!FTAB) FTAB = faradayTable(LOOPR); return FTAB; }
export class Faraday extends Scene {
  constructor() { super({ cx: 0, cy: 0, w: 380, h: 150 }); this.keys = ['S', 'E', 'B']; this.tab = faradayPageTable(); this.reset(); }
  reset() { this.ph = -Math.PI / 2; this.X = -FAR_A; this.V = 0; this.hist = []; this.held = null; }
  slopeMax() {
    if (this.sm) return this.sm;
    let m = 0; for (let d = 0; d < 300; d += 1) m = Math.max(m, Math.abs(tableAt(this.tab, this.tab.phi, d).dv));
    if (this.tab.done) this.sm = m; return m || 1;
  }
  state() {
    const s = this.s || 1, a = tableAt(this.tab, this.tab.phi, this.X), l = tableAt(this.tab, this.tab.line, this.X);
    return { phi: a.v * s * MAGUNIT, emfFlux: -this.V * a.dv * s * MAGUNIT, emfLine: -this.V * l.dv * s * MAGUNIT };
  }
  step(dt, sim) {
    if (!this.tab.done) this.tab.fill(6);
    this.t += dt; this.s = sim.strength;
    if (this.held) {
      const V = (this.held.x - this.X) / Math.max(dt, 1e-3);
      this.V = this.V * 0.6 + V * 0.4; this.X = this.held.x;
      this.ph = Math.asin(clamp(this.X / FAR_A, -1, 1)); if (this.V < 0) this.ph = Math.PI - this.ph;
    } else if (dt > 0) {
      this.ph += FAR_W * dt; this.X = FAR_A * Math.sin(this.ph); this.V = FAR_A * FAR_W * Math.cos(this.ph);
    }
    if (dt > 0 && this.tab.done) {
      const st = this.state(); this.hist.push({ t: this.t, e: st.emfLine, p: st.phi });
      while (this.hist.length && this.t - this.hist[0].t > 7) this.hist.shift();
    }
  }
  draw(ctx, rect, look) {
    const chartH = Math.max(36, rect.h * 0.27), sr = { x: rect.x, y: rect.y, w: rect.w, h: rect.h - chartH };
    const v = this.v = fitView(sr, this.box), px = look.px, st = this.state();
    const map = (x, y) => [v.X(x + this.X), v.Y(y)], tb = tone(look, 'B', 0.5), ts = tone(look, 'S', 1);
    // The flux disc, tinted by the flux through it.
    const s1 = this.s || 1, pRef = 0.5 * this.tab.phi[0] * MAGUNIT * s1, eRef = 0.4 * this.slopeMax() * FAR_A * FAR_W * MAGUNIT * s1;
    const fm = this.tab.done ? tanh(Math.abs(st.phi) / pRef) : 0;
    loopPath(ctx, v, 0, LOOPR, true); for (let i = 48; i >= 0; i--) { const p = Math.PI + Math.PI * i / 48; ctx.lineTo(v.X(SKEW * LOOPR * Math.sin(p)), v.Y(LOOPR * Math.cos(p))); }
    ctx.fillStyle = rgba(COL.B, 0.05 + 0.22 * fm * (look.hot === 'B' ? 1.6 : 1)); ctx.fill();
    loopPath(ctx, v, 0, LOOPR, false); ctx.strokeStyle = rgba(COL.S, 0.5 * ts.a); ctx.lineWidth = 2 * px * ts.w; ctx.stroke();
    for (const L of magnetLines()) flowPath(ctx, L, map, rgba(COL.B, tb.a), 1.1 * px * tb.w, this.t, 14);
    drawMagnet(ctx, v, this.X, 0, 0, look);
    loopPath(ctx, v, 0, LOOPR, true); ctx.strokeStyle = rgba(COL.S, ts.a); ctx.lineWidth = 2.4 * px * ts.w; ctx.stroke();
    // Lenz: the induced current and its B at the loop centre.
    if (this.tab.done) {
      const em = tanh(Math.abs(st.emfLine) / eRef), te = tone(look, 'E', 1);
      if (em > 0.05) {
        loopHeads(ctx, v, 0, LOOPR, Math.sign(st.emfLine), rgba(COL.E, te.a * (0.4 + 0.6 * em)), 7 * px);
        const L = 26 * em * Math.sign(st.emfLine) * v.k, y0 = v.Y(0) - LOOPR * v.k - 10 * px;
        arrow(ctx, v.X(0) - L / 2, y0, v.X(0) + L / 2, y0, 5 * px, rgba(COL.B, 0.9), 1.5 * px);
        text(ctx, 'induced B', v.X(0) + Math.abs(L) / 2 + 6 * px, y0 + 4 * px, rgba(COL.dim, 0.95), 10 * px, look);
      }
    } else text(ctx, 'computing the flux table…', rect.x + 10, rect.y + 16, COL.dim, 11 * px, look);
    // The trace: EMF (orange) and flux (blue) over the last 7 s.
    const cx0 = rect.x + 8 * px, cw = rect.w - 16 * px, cy0 = rect.y + rect.h - chartH + 4, ch = chartH - 8, mid = cy0 + ch / 2;
    ctx.strokeStyle = 'rgba(150,200,255,0.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx0, mid); ctx.lineTo(cx0 + cw, mid); ctx.stroke();
    const sMax = Math.max(1e-9, ...this.hist.map(h => Math.abs(h.e))) * 1.1, pMax = Math.max(1e-9, ...this.hist.map(h => Math.abs(h.p))) * 1.1;
    const line = (key, col, val, mx) => {
      const t = tone(look, key, 0.9); ctx.strokeStyle = rgba(col, t.a); ctx.lineWidth = 1.4 * px * t.w; ctx.beginPath();
      this.hist.forEach((h, i) => { const X = cx0 + cw * (1 - (this.t - h.t) / 7), Y = mid - val(h) / mx * ch / 2; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
    };
    line('B', COL.B, h => h.p, pMax); line('E', COL.E, h => h.e, sMax);
    text(ctx, 'Φ_B', cx0, cy0 + 9 * px, rgba(COL.B, 0.9), 10 * px, look);
    text(ctx, 'EMF', cx0 + 30 * px, cy0 + 9 * px, rgba(COL.E, 0.9), 10 * px, look);
  }
  pick(px, py) { const [x, y] = this.w(px, py); return Math.abs(x - this.X) < PMAG.half + 6 && Math.abs(y) < PMAG.radius + 10 ? { type: 'mag', ox: x - this.X } : null; }
  drag(h, px) { const [x] = this.w(px, 0); this.held = { x: clamp(x - h.ox, -FAR_A - 30, FAR_A + 30) }; }
  release() { this.held = null; }
  hit(px, py) {
    const [x, y] = this.w(px, py), tol = this.tol();
    if (Math.abs(x - SKEW * LOOPR * Math.sin(Math.acos(clamp(y / LOOPR, -1, 1)))) < tol && Math.abs(y) <= LOOPR + tol) return 'S';
    if (Math.abs(x - this.X) < PMAG.half && Math.abs(y) < PMAG.radius) return 'B';
    if (Math.abs(y) < LOOPR && Math.abs(x) < SKEW * LOOPR + tol) return 'B';
    if (nearPath(magnetLines(), x - this.X, y, tol * 0.7)) return 'B';
    if (this.v && py > this.v.rect.y + this.v.rect.h) return 'E';
    return null;
  }
  readout() {
    const st = this.state();
    return { lhs: { k: 'S', h: '<i class="m3">∮</i> <b class="m2">E</b>·<i class="m3">dℓ</i>', v: st.emfLine },
      rhs: [{ k: 'B', h: '−d<i class="m1">Φ</i><sub>B</sub>/dt', v: st.emfFlux }], unit: '', wait: !this.tab.done };
  }
}

/* ═══ AMPERE-MAXWELL ═══ */
// The capacitor on its AC clock and a loop round the axis (seen at an
// angle). Both sides come from physics.js ampereMaxwell, per unit current,
// times I(t). Drag the loop along the wire, or its top to change the radius.
export class Ampere extends Scene {
  constructor() { super({ cx: 0, cy: 0, w: 380, h: 240 }); this.keys = ['S', 'B', 'J', 'E']; this.reset(); }
  reset() { this.loop = { x: 0, s: 44 }; this.dirty = true; this.phase = 0; }
  update() {
    if (!this.dirty) return; this.dirty = false;
    this.r1 = ampereMaxwell(CAP, 1, { x: this.loop.x, s: this.loop.s }, 180);
  }
  step(dt, sim) { this.t += dt; this.st = capState(sim); this.phase += this.st.I * dt * 40; }
  draw(ctx, rect, look) {
    this.update();
    const v = this.v = fitView(rect, this.box), px = look.px, st = { ...this.st, phase: this.phase }, L = this.loop, ts = tone(look, 'S', 1);
    loopPath(ctx, v, L.x, L.s, false); ctx.strokeStyle = rgba(COL.S, 0.45 * ts.a); ctx.lineWidth = 2 * px * ts.w; ctx.stroke();
    drawCap(ctx, v, st, look, { disp: true });
    loopPath(ctx, v, L.x, L.s, true); ctx.strokeStyle = rgba(COL.S, ts.a); ctx.lineWidth = 2.4 * px * ts.w; ctx.stroke();
    ctx.fillStyle = rgba(COL.S, ts.a); ctx.beginPath(); ctx.arc(v.X(L.x), v.Y(L.s), 3.4 * px, 0, TAU); ctx.fill();
    const lhs = this.r1.lhs * st.I, mb = tanh(Math.abs(lhs) / 0.3);
    if (mb > 0.05) loopHeads(ctx, v, L.x, L.s, Math.sign(lhs), rgba(COL.B, 0.4 + 0.6 * mb), 7 * px);
    // Bars: the left side, and the two parts of the right side.
    const r = this.readout(), bx = rect.x + 10 * px, by = rect.y + 10 * px, bw = Math.min(110 * px, rect.w * 0.26), bh = 5 * px;
    const scale = bw / Math.max(1e-6, 1.05 * this.sMax);
    const bar = (y, a, b, ca, cb, key) => {
      const t = tone(look, key, 1); ctx.fillStyle = 'rgba(150,200,255,0.08)'; ctx.fillRect(bx, y, bw, bh);
      ctx.fillStyle = rgba(ca, t.a); ctx.fillRect(bx, y, Math.abs(a) * scale, bh);
      if (b !== undefined) { ctx.fillStyle = rgba(cb, tone(look, 'E', 1).a); ctx.fillRect(bx + Math.abs(a) * scale, y, Math.abs(b) * scale, bh); }
    };
    bar(by, r.lhs.v, undefined, COL.B, null, 'B');
    bar(by + bh + 4 * px, r.rhs[0].v, r.rhs[1].v, COL.J, COL.E, 'J');
  }
  pick(px, py) {
    const [x, y] = this.w(px, py), tol = this.tol(), L = this.loop;
    if (Math.hypot(x - L.x, y - L.s) < tol * 1.3 || Math.hypot(x - L.x, y + L.s) < tol * 1.3) return { type: 'R' };
    if (Math.abs(x - L.x) < SKEW * L.s + tol && Math.abs(y) < L.s + tol) return { type: 'move', ox: x - L.x };
    return null;
  }
  drag(h, px, py) {
    const [x, y] = this.w(px, py), L = this.loop;
    if (h.type === 'R') L.s = clamp(Math.abs(y), 10, 112);
    else {
      let nx = clamp(x - h.ox, -172, 172);
      for (const p of [CAP.xl, CAP.xr]) if (Math.abs(nx - p) < 4) nx = p + (nx < p ? -4 : 4);
      L.x = nx;
    }
    this.dirty = true;
  }
  hit(px, py) {
    const [x, y] = this.w(px, py), tol = this.tol(), L = this.loop;
    if (Math.abs(x - L.x) < SKEW * L.s + tol && Math.abs(Math.abs(y) - L.s) < tol * 1.2) return 'S';
    const c = capHit(x, y, tol * 0.8); if (c && c !== 'Q') return c;
    if (Math.abs(y) > 10) return 'B';
    return null;
  }
  readout() {
    this.update(); const I = this.st ? this.st.I : 0, r = this.r1;
    this.sMax = Math.max(this.sMax || 0, Math.abs(r.lhs * I), Math.abs(r.Ienc * I) + Math.abs(r.disp * I));
    return { lhs: { k: 'S', h: '<i class="m3">∮</i> <b class="m1">B</b>·<i class="m3">dℓ</i>', v: r.lhs * I },
      rhs: [{ k: 'J', h: 'μ₀<i class="m5">I</i><sub>enc</sub>', v: r.Ienc * I }, { k: 'E', h: 'μ₀ε₀d<i class="m2">Φ</i><sub>E</sub>/dt', v: r.disp * I }], unit: '' };
  }
  auto(t) { this.loop.x = 70 * Math.sin(t * 0.05); for (const p of [CAP.xl, CAP.xr]) if (Math.abs(this.loop.x - p) < 4) this.loop.x = p + (this.loop.x < p ? -4 : 4); this.dirty = true; }
}

/* ═══ LINKED: GAUSS E ═══ */
// The same capacitor: a sphere round one plate holds the plate charge Q(t).
// Flux and Q_enc are per unit charge (linear in Q), times Q(t).
let capELines = null;
function capFieldLines() {
  if (capELines) return capELines;
  const f = (x, y) => { const o = capE(CAP, 1, x, y, 0); return [o[0], o[1]]; }, xr = CAP.xr, xl = CAP.xl, Rp = CAP.Rp;
  const stop = (x, y, n) => (n > 2 && Math.abs(x - xr) < 2.5 && Math.abs(y) < Rp + 2) || (n > 4 && Math.abs(x - xl) < 1.5 && Math.abs(y) < Rp) || Math.abs(x) > 300 || Math.abs(y) > 240;
  capELines = [];
  for (let y = -56; y <= 56; y += 14) capELines.push(traceLine(f, xl + 3, y, 1, 2.5, 400, stop));
  for (const y of [-58, -40, -20, 20, 40, 58]) capELines.push(traceLine(f, xl - 3, y, 1, 2.5, 600, stop));
  return capELines;
}
export class CapGaussE extends Scene {
  constructor() { super({ cx: 0, cy: 0, w: 380, h: 240 }); this.keys = ['S', 'E', 'Q']; this.reset(); }
  reset() { this.surf = { x: -62, y: 0, R: 76 }; this.dirty = true; this.phase = 0; }
  update() {
    if (!this.dirty) return; this.dirty = false;
    const cs = capCharges(CAP, 1), s = this.surf;
    this.flux1 = sphereFluxCharges(cs, s.x, s.y, 0, s.R); this.qenc1 = chargeInside(cs, s.x, s.y, 0, s.R);
  }
  step(dt, sim) { this.t += dt; this.st = capState(sim); this.phase += this.st.I * dt * 40; }
  draw(ctx, rect, look) {
    this.update();
    const v = this.v = fitView(rect, this.box), map = (x, y) => [v.X(x), v.Y(y)], te = tone(look, 'E', 0.55), Q = this.st.Q;
    const m = tanh(Math.abs(Q) / 0.4);
    for (const L of capFieldLines()) flowPath(ctx, L, map, rgba(COL.E, te.a * (0.15 + 0.85 * m)), 1.1 * look.px * te.w, this.t, 14 * Math.sign(Q));
    drawCap(ctx, v, { ...this.st, phase: this.phase }, look, { bgrid: false });
    sphereRing(ctx, v, this.surf, look);
    fluxArrows(ctx, v, this.surf, (x, y) => capE(CAP, Q, x, y, 0), EREF * 0.8, COL.E, 'E', look);
  }
  pick(px, py) { const [x, y] = this.w(px, py); return pickSphere(this.surf, x, y, this.tol()); }
  drag(h, px, py) { const [x, y] = this.w(px, py); dragSphere(this.surf, h, x, y, this.box, 14, 150); this.dirty = true; }
  hit(px, py) {
    const [x, y] = this.w(px, py), tol = this.tol();
    if (Math.abs(Math.hypot(x - this.surf.x, y - this.surf.y) - this.surf.R) < tol) return 'S';
    return capHit(x, y, tol * 0.8) || (nearPath(capFieldLines(), x, y, tol * 0.7) ? 'E' : null);
  }
  readout() {
    this.update(); const Q = this.st ? this.st.Q : 0;
    return { lhs: { k: 'S', h: '<i class="m3">∮</i> <b class="m2">E</b>·<i class="m3">dA</i>', v: this.flux1 * Q },
      rhs: [{ k: 'Q', h: '<i class="m4">Q</i><sub>enc</sub>/ε₀', v: this.qenc1 * Q }], unit: '' };
  }
  auto(t) { this.surf.x = -62 + 50 * Math.sin(t * 0.05); this.dirty = true; }
}

/* ═══ LINKED: GAUSS B ═══ */
// The same capacitor: B circles the wire, so on the page it points in or
// out (dots and crosses). Through a sphere off the axis, B leaves through
// one part and comes back through another. Net zero.
export class CapGaussB extends Scene {
  constructor() { super({ cx: 0, cy: 0, w: 380, h: 240 }); this.keys = ['S', 'B']; this.reset(); }
  reset() { this.surf = { x: -96, y: 30, R: 52 }; this.dirty = true; this.phase = 0; }
  update() {
    if (!this.dirty) return; this.dirty = false;
    const s = this.surf; this.f1 = sphereFlux((x, y, z, o) => capB(CAP, 1, x, y, z, o), s.x, s.y, 0, s.R, 24, 48);
  }
  step(dt, sim) { this.t += dt; this.st = capState(sim); this.phase += this.st.I * dt * 40; }
  draw(ctx, rect, look) {
    const v = this.v = fitView(rect, this.box);
    drawCap(ctx, v, { ...this.st, phase: this.phase }, look, { egap: false });
    sphereRing(ctx, v, this.surf, look);
  }
  pick(px, py) { const [x, y] = this.w(px, py); return pickSphere(this.surf, x, y, this.tol()); }
  drag(h, px, py) { const [x, y] = this.w(px, py); dragSphere(this.surf, h, x, y, this.box, 14, 110); this.dirty = true; }
  hit(px, py) {
    const [x, y] = this.w(px, py), tol = this.tol();
    if (Math.abs(Math.hypot(x - this.surf.x, y - this.surf.y) - this.surf.R) < tol) return 'S';
    const c = capHit(x, y, tol * 0.8); if (c === 'J') return c;
    return Math.abs(y) > 10 ? 'B' : null;
  }
  readout() {
    this.update(); const I = this.st ? this.st.I : 0, k = 1;
    return { lhs: { k: 'S', h: '<i class="m3">∮</i> <b class="m1">B</b>·<i class="m3">dA</i>', v: this.f1.net * I * k },
      rhs: [{ k: 'B', h: 'out', v: this.f1.out * I * k, part: true }, { k: 'B', h: 'in', v: this.f1.in * I * k, part: true }], zero: true, unit: '' };
  }
  auto(t) { this.surf.x = -96 + 40 * Math.sin(t * 0.04); this.dirty = true; }
}

/* ═══ LINKED: FARADAY ═══ */
// The same capacitor: a rectangle loop in the page above the wire. The
// wire's B goes through it, and changes with I(t), so an EMF goes round it.
// Both sides from physics.js faradayRect, per unit current.
export class CapFaraday extends Scene {
  constructor() { super({ cx: 0, cy: 0, w: 380, h: 170 }); this.keys = ['S', 'E', 'B', 'J']; this.reset(); }
  reset() { this.rect = { x0: -150, y0: 16, x1: -60, y1: 62 }; this.dirty = true; this.hist = []; this.phase = 0; }
  update() {
    if (!this.dirty) return; this.dirty = false;
    const r = faradayRect(CAP, this.rect, 1, 1); this.phi1 = r.phi1; this.line1 = r.line1;
  }
  vals() { this.update(); const st = this.st || { I: 0, dIdt: 0 }; return { phi: this.phi1 * st.I, emfFlux: -this.phi1 * st.dIdt, emfLine: -this.line1 * st.dIdt }; }
  step(dt, sim) {
    this.t += dt; this.sim = sim.strength; this.st = capState(sim); this.phase += this.st.I * dt * 40;
    if (dt > 0) { const s = this.vals(); this.hist.push({ t: this.t, e: s.emfLine, p: s.phi }); while (this.hist.length && this.t - this.hist[0].t > 7) this.hist.shift(); }
  }
  draw(ctx, rect, look) {
    const chartH = Math.max(36, rect.h * 0.27), sr = { x: rect.x, y: rect.y, w: rect.w, h: rect.h - chartH };
    const v = this.v = fitView(sr, { cx: 0, cy: 10, w: 380, h: 150 }), px = look.px, r = this.rect, s = this.vals(), ts = tone(look, 'S', 1);
    drawCap(ctx, v, { ...this.st, phase: this.phase }, look, { egap: false });
    const X0 = v.X(r.x0), Y0 = v.Y(r.y1), W = (r.x1 - r.x0) * v.k, H = (r.y1 - r.y0) * v.k;
    const amp = Math.abs(this.phi1) * (this.sim || 1);
    ctx.fillStyle = rgba(COL.B, 0.04 + 0.12 * tanh(Math.abs(s.phi) / (0.5 * amp + 1e-9)) * (look.hot === 'B' ? 1.8 : 1)); ctx.fillRect(X0, Y0, W, H);
    ctx.strokeStyle = rgba(COL.S, ts.a); ctx.lineWidth = 2.2 * px * ts.w; ctx.strokeRect(X0, Y0, W, H);
    const em = tanh(Math.abs(s.emfLine) / (0.5 * amp * CAP_W + 1e-9)), te = tone(look, 'E', 1);
    if (em > 0.05) {
      const sg = Math.sign(s.emfLine), c = rgba(COL.E, te.a * (0.4 + 0.6 * em));   // + : counterclockwise
      headAt(ctx, X0 + W / 2, Y0 + H, sg, 0, 7 * px, c); headAt(ctx, X0 + W, Y0 + H / 2, 0, -sg, 7 * px, c);
      headAt(ctx, X0 + W / 2, Y0, -sg, 0, 7 * px, c); headAt(ctx, X0, Y0 + H / 2, 0, sg, 7 * px, c);
    }
    const cx0 = rect.x + 8 * px, cw = rect.w - 16 * px, cy0 = rect.y + rect.h - chartH + 4, ch = chartH - 8, mid = cy0 + ch / 2;
    ctx.strokeStyle = 'rgba(150,200,255,0.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx0, mid); ctx.lineTo(cx0 + cw, mid); ctx.stroke();
    const sMax = Math.max(1e-9, ...this.hist.map(h => Math.abs(h.e))) * 1.1, pMax = Math.max(1e-9, ...this.hist.map(h => Math.abs(h.p))) * 1.1;
    const line = (key, col, val, mx) => {
      const t = tone(look, key, 0.9); ctx.strokeStyle = rgba(col, t.a); ctx.lineWidth = 1.4 * px * t.w; ctx.beginPath();
      this.hist.forEach((h, i) => { const X = cx0 + cw * (1 - (this.t - h.t) / 7), Y = mid - val(h) / mx * ch / 2; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
    };
    line('B', COL.B, h => h.p, pMax); line('E', COL.E, h => h.e, sMax);
    text(ctx, 'Φ_B', cx0, cy0 + 9 * px, rgba(COL.B, 0.9), 10 * px, look);
    text(ctx, 'EMF', cx0 + 30 * px, cy0 + 9 * px, rgba(COL.E, 0.9), 10 * px, look);
  }
  pick(px, py) { const [x, y] = this.w(px, py), r = this.rect, t = this.tol(); return x > r.x0 - t && x < r.x1 + t && y > r.y0 - t && y < r.y1 + t ? { ox: x - r.x0, oy: y - r.y0 } : null; }
  drag(h, px, py) {
    const [x, y] = this.w(px, py), r = this.rect, w = r.x1 - r.x0, hh = r.y1 - r.y0;
    let y0 = clamp(y - h.oy, -78, 78 - hh); if (y0 < 6 && y0 + hh > -6) y0 = y0 + hh / 2 > 0 ? 6 : -6 - hh;   // not across the wire
    r.x0 = clamp(x - h.ox, -186, 186 - w); r.x1 = r.x0 + w; r.y0 = y0; r.y1 = y0 + hh; this.dirty = true;
  }
  hit(px, py) {
    const [x, y] = this.w(px, py), r = this.rect, t = this.tol();
    const onEdge = (Math.abs(x - r.x0) < t || Math.abs(x - r.x1) < t) && y > r.y0 - t && y < r.y1 + t || (Math.abs(y - r.y0) < t || Math.abs(y - r.y1) < t) && x > r.x0 - t && x < r.x1 + t;
    if (onEdge) return 'S';
    if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return 'B';
    if (this.v && py > this.v.rect.y + this.v.rect.h) return 'E';
    return capHit(x, y, t * 0.8) === 'J' ? 'J' : null;
  }
  readout() {
    const s = this.vals();
    return { lhs: { k: 'S', h: '<i class="m3">∮</i> <b class="m2">E</b>·<i class="m3">dℓ</i>', v: s.emfLine },
      rhs: [{ k: 'B', h: '−d<i class="m1">Φ</i><sub>B</sub>/dt', v: s.emfFlux }], unit: '' };
  }
  auto(t) { const w = this.rect.x1 - this.rect.x0; this.rect.x0 = -150 + 60 * Math.sin(t * 0.04); this.rect.x1 = this.rect.x0 + w; this.dirty = true; }
}

/* ═══ LIGHT ═══ */
// Faraday and Ampere-Maxwell on a 1D Yee grid (physics.js Wave1D), in SI
// units, 1 m cells. A sine source at cell SRC ramps on. Two probes time the
// front: the first step where |E| passes half the source amplitude. The
// measured speed is (b - a) dx / (t_b - t_a). Nothing in the update holds
// c. Only the absorbing ends use it. mu_r and eps_r scale mu0 and eps0.
export const LIGHT = { n: 420, dx: 1, dt: 1.5e-9, src: 20, a: 120, b: 320, period: 80 };
export class Light extends Scene {
  constructor() { super({ cx: 0, cy: 0, w: 440, h: 170 }); this.keys = ['E', 'B']; this.mur = 1; this.epsr = 1; this.reset(); }
  reset() {
    const L = LIGHT;
    this.w1 = new Wave1D({ n: L.n, dx: L.dx, dt: L.dt, mu0: SI_MU0 * this.mur, eps0: SI_EPS0 * this.epsr });
    this.k = 0; this.amp = 0; this.ta = null; this.tb = null; this.vMeas = this.vMeas || null; this.acc = 0;
  }
  setMedium(mur, epsr) { this.mur = mur; this.epsr = epsr; this.vMeas = null; this.reset(); }
  get c() { return lightSpeed(SI_MU0 * this.mur, SI_EPS0 * this.epsr); }
  tick() {
    const L = LIGHT, w = this.w1, ramp = Math.min(1, this.k / (2 * L.period)), env = ramp * ramp * (3 - 2 * ramp);
    w.step(L.src, env * Math.sin(TAU * this.k / L.period) * w.eps0 / w.dt * 0.04);
    this.k++;
    this.amp = Math.max(this.amp, Math.abs(w.E[L.src + 8]));
    const th = 0.5 * this.amp;
    if (this.amp > 0 && this.ta === null && Math.abs(w.E[L.a]) > th) this.ta = w.t;
    if (this.amp > 0 && this.tb === null && Math.abs(w.E[L.b]) > th) { this.tb = w.t; this.vMeas = (L.b - L.a) * L.dx / (this.tb - this.ta); }
  }
  step(dt, sim) { this.t += dt; this.acc += dt * 60 * 5 * (sim.speed || 1); let n = Math.min(40, Math.floor(this.acc)); this.acc -= n; while (n-- > 0) this.tick(); }
  draw(ctx, rect, look) {
    const v = this.v = fitView(rect, this.box), px = look.px, L = LIGHT, w = this.w1, n = L.n;
    const x0 = -200, sx = 400 / n, A = 52 / Math.max(1e-12, this.amp || 1), c = this.c;
    const te = tone(look, 'E', 0.95), tb = tone(look, 'B', 0.95), dx = 0.55, dy = -0.4;   // B leans into the page
    ctx.strokeStyle = 'rgba(150,200,255,0.25)'; ctx.lineWidth = 1 * px; ctx.beginPath(); ctx.moveTo(v.X(x0), v.Y(0)); ctx.lineTo(v.X(x0 + 400), v.Y(0)); ctx.stroke();
    ctx.lineWidth = 1 * px;
    for (let i = 0; i < n; i += 6) {
      const X = v.X(x0 + i * sx), e = w.E[i] * A, b = w.B[i] * c * A;
      ctx.strokeStyle = rgba(COL.E, te.a * 0.35); ctx.beginPath(); ctx.moveTo(X, v.Y(0)); ctx.lineTo(X, v.Y(e)); ctx.stroke();
      ctx.strokeStyle = rgba(COL.B, tb.a * 0.35); ctx.beginPath(); ctx.moveTo(X, v.Y(0)); ctx.lineTo(X + b * dx * v.k, v.Y(0) - b * dy * v.k); ctx.stroke();
    }
    ctx.lineWidth = 1.8 * px * te.w; ctx.strokeStyle = rgba(COL.E, te.a); ctx.beginPath();
    for (let i = 0; i < n; i++) { const X = v.X(x0 + i * sx), Y = v.Y(w.E[i] * A); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    ctx.stroke();
    ctx.lineWidth = 1.8 * px * tb.w; ctx.strokeStyle = rgba(COL.B, tb.a); ctx.beginPath();
    for (let i = 0; i < n; i++) { const b = w.B[i] * c * A, X = v.X(x0 + i * sx) + b * dx * v.k, Y = v.Y(0) - b * dy * v.k; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    ctx.stroke();
    for (const [i, lb] of [[L.a, 'a'], [L.b, 'b']]) {
      const X = v.X(x0 + i * sx); ctx.strokeStyle = 'rgba(200,215,235,0.35)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X, v.Y(70)); ctx.lineTo(X, v.Y(-70)); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, 'probe ' + lb, X + 4 * px, v.Y(-66), COL.dim, 10 * px, look);
    }
    text(ctx, 'E', v.X(x0) - 4 * px, v.Y(58), rgba(COL.E, 0.95), 12 * px, look, 'right');
    text(ctx, 'cB', v.X(x0) + 34 * dx * v.k, v.Y(0) + 34 * 0.4 * v.k + 12 * px, rgba(COL.B, 0.95), 12 * px, look);
    text(ctx, 'source', v.X(x0 + L.src * sx), v.Y(-66), COL.dim, 10 * px, look, 'center');
  }
  pick() { return null; }
  drag() {}
  hit(px, py) { const [, y] = this.w(px, py); return y > 4 ? 'E' : y < -4 ? 'B' : null; }
  readout() {
    return { lhs: { k: 'E', h: 'front speed on the grid', v: this.vMeas },
      rhs: [{ k: 'S', h: '1/√(μ₀ε₀)', v: this.c }], unit: 'm/s', sci: true };
  }
}
