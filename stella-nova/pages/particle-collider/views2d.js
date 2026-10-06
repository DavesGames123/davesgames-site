// ============================================================================
//  PARTICLE COLLIDER  ·  views2d.js — r-phi, r-z and the eta-phi lego plot
// ----------------------------------------------------------------------------
//  Canvas 2D views of the same event, next to the 3D display.
//    rphi .. the transverse view: the beam comes out of the screen. Layer
//            rings, tracks (x, y), hits, ECAL and HCAL E_T per phi bin as
//            bars outside each calorimeter, the MET arrow.
//    rz .... the longitudinal view: z across, r up for phi in the upper
//            half (y > 0) and down for the lower half, as CMS draws rho-z.
//    lego .. E_T per tower (0.087 x 0.087) over eta and phi, the EM part
//            and the hadronic part stacked (two series, a legend), jets as
//            rings on the floor. Hover a bar: its eta, phi and E_T.
//  Tracks are glowing strokes with globalCompositeOperation 'lighter'.
//  The views redraw when the time or the event changes (at most 20 Hz).
//
//  createViews({ rphi, rz, lego, tip }) -> { show(R, O), draw(t), resize() }
//  GREP MAP  function drawRphi / drawRz / drawLego / function prep
// ============================================================================
import { CLASS_COLOR } from './particles.js';
import { CLS } from './transport.js';
import { ramp, logU } from './display.js';
import { ECAL, HCAL, cellCenter } from './geometry.js';
import { KHCAL } from './reco.js';

const RING = [  // [r0, r1, colour, alpha] for the r-phi view (mm)
  [21.7, 22.5, '#9fc4ff', 0.6], [1290, 1520, '#36d6b6', 0.13], [1770, 2950, '#d99a4e', 0.11], [2980, 3300, '#c7d0de', 0.14],
  [3750, 4300, '#b4313f', 0.2], [4600, 5200, '#b4313f', 0.2], [5500, 6200, '#b4313f', 0.2],
  [3500, 3700, '#e7ecf6', 0.1], [4350, 4550, '#e7ecf6', 0.1], [5250, 5450, '#e7ecf6', 0.1], [6250, 6450, '#e7ecf6', 0.1],
];
const LAYERS = [29, 68, 109, 160, 255, 339, 418, 498, 608, 692, 780, 868, 965, 1080];
const EM_C = '#ff8a5c', HAD_C = '#6aaeff';

export function createViews(o) {
  let ev = null, lastT = -1e9, lastDraw = 0, legoHit = [];
  const dprOf = () => Math.min(2, devicePixelRatio || 1);
  function fit(c) {
    const r = c.getBoundingClientRect(), d = dprOf(), w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
    return { w: c.width, h: c.height, d };
  }
  // ── per-event preparation ──
  function prep(R, O) {
    const segs = [];
    for (let i = 0; i < R.nSeg; i++) {
      const k = i * 9, cls = CLS[R.segCls[i]], E = R.seg[k + 8];
      if (cls === 'shower' && E < 80) continue;
      if (cls === 'shower' && segs.length > 60000) continue;
      segs.push([R.seg[k], R.seg[k + 1], R.seg[k + 2], R.seg[k + 3], R.seg[k + 4], R.seg[k + 5], R.seg[k + 6], R.seg[k + 7], cls, E]);
    }
    const ePhi = new Float64Array(ECAL.nphi), hPhi = new Float64Array(HCAL.nphi), cellsRz = [];
    for (let c = 0; c < R.ecal.length; c++) {
      const e = R.ecal[c]; if (e < 200) continue;
      const [eta, phi] = cellCenter(ECAL, c), et = e / Math.cosh(eta);
      ePhi[c % ECAL.nphi] += et; cellsRz.push([eta, phi, e, 'e', R.ecalT[c]]);
    }
    for (let c = 0; c < R.hcalS.length; c++) {
      const e = R.hcalS[c] * KHCAL; if (e < 400) continue;
      const [eta, phi] = cellCenter(HCAL, c), et = e / Math.cosh(eta);
      hPhi[c % HCAL.nphi] += et; cellsRz.push([eta, phi, e, 'h', R.hcalT[c]]);
    }
    const hits = []; for (let i = 0; i < R.hits.n; i++) hits.push([R.hits.f[i * 6], R.hits.f[i * 6 + 1], R.hits.f[i * 6 + 2], R.hits.f[i * 6 + 3], 0]);
    for (let i = 0; i < R.mhits.n; i++) hits.push([R.mhits.f[i * 6], R.mhits.f[i * 6 + 1], R.mhits.f[i * 6 + 2], R.mhits.f[i * 6 + 3], 1]);
    return { segs, ePhi, hPhi, cellsRz, hits, O };
  }
  // stroke all visible parts of the segments of one class
  function strokeSegs(g, list, t, map, color, width, alpha) {
    g.beginPath();
    for (const s of list) {
      if (s[3] > t) continue;
      const f = s[7] > s[3] ? Math.min(1, (t - s[3]) / (s[7] - s[3])) : 1;
      const [ax, ay] = map(s[0], s[1], s[2]), [bx, by] = map(s[0] + (s[4] - s[0]) * f, s[1] + (s[5] - s[1]) * f, s[2] + (s[6] - s[2]) * f);
      g.moveTo(ax, ay); g.lineTo(bx, by);
    }
    g.strokeStyle = color; g.globalAlpha = alpha; g.lineWidth = width; g.stroke();
  }
  function tracks(g, t, map, d) {
    const by = {}; for (const s of ev.segs) (by[s[8]] = by[s[8]] || []).push(s);
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    const W = { shower: 0.7, gamma: 0.8, neu: 0.8, had: 1.1, e: 1.4, mu: 1.8 };
    for (const cls of ['shower', 'gamma', 'neu', 'had', 'e', 'mu']) {
      const L = by[cls]; if (!L) continue;
      if (cls === 'gamma' || cls === 'neu') g.setLineDash([5 * d, 4 * d]); else g.setLineDash([]);
      strokeSegs(g, L, t, map, CLASS_COLOR[cls], W[cls] * 4 * d, cls === 'shower' ? 0.08 : 0.16);
      strokeSegs(g, L, t, map, CLASS_COLOR[cls], W[cls] * d, cls === 'shower' ? 0.35 : 0.95);
    }
    g.setLineDash([]); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function hitDots(g, t, map, d) {
    g.globalCompositeOperation = 'lighter';
    for (const h of ev.hits) { if (h[3] > t) continue; const [x, y] = map(h[0], h[1], h[2]); g.fillStyle = h[4] ? '#ff86c0' : '#bff3ff'; g.globalAlpha = 0.9; g.fillRect(x - 1.2 * d, y - 1.2 * d, 2.4 * d, 2.4 * d); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function label(g, txt, x, y, d, al = 'left', col = '#8d93a8') { g.font = `${10 * d}px "IBM Plex Mono", ui-monospace, Menlo, monospace`; g.fillStyle = col; g.textAlign = al; g.fillText(txt, x, y); g.textAlign = 'left'; }

  function drawRphi(t) {
    const c = o.rphi; if (!c) return;
    const { w, h, d } = fit(c), g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const S = Math.min(w, h) / 2 / 7400 * 0.98, cx = w / 2, cy = h / 2, map = (x, y) => [cx + x * S, cy - y * S];
    for (const [r0, r1, col, a] of RING) { g.beginPath(); g.arc(cx, cy, r1 * S, 0, 6.2832); g.arc(cx, cy, r0 * S, 0, 6.2832, true); g.fillStyle = col; g.globalAlpha = a; g.fill(); }
    g.globalAlpha = 0.35; g.strokeStyle = '#64b5f0'; g.lineWidth = d * 0.6;
    for (const r of LAYERS) { g.beginPath(); g.arc(cx, cy, r * S, 0, 6.2832); g.stroke(); }
    g.globalAlpha = 1;
    if (!ev) return;
    // calorimeter E_T bars (after their first deposit time)
    const bar = (arr, n, r0, col, k) => {
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const e = arr[i]; if (e < 300) continue;
        const phi = -Math.PI + (i + 0.5) * 2 * Math.PI / n, len = Math.min(2400, 240 * Math.log2(1 + e / 500)) * k, dp = Math.PI / n * 0.85;
        g.beginPath(); g.arc(cx, cy, r0 * S, -phi - dp, -phi + dp); g.arc(cx, cy, (r0 + len) * S, -phi + dp, -phi - dp, true); g.closePath();
        const rgb = ramp(logU(e, 300, 100000)).map(v => Math.round(v * 255));
        g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.85)`; g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    };
    const kE = Math.max(0, Math.min(1, (t - 4.2) / 1.5)), kH = Math.max(0, Math.min(1, (t - 6.2) / 2));
    if (kE > 0) bar(ev.ePhi, ECAL.nphi, 1525, EM_C, kE);
    if (kH > 0) bar(ev.hPhi, HCAL.nphi, 2955, HAD_C, kH);
    tracks(g, t, (x, y) => map(x, y), d);
    hitDots(g, t, (x, y) => map(x, y), d);
    const O = ev.O;
    if (O && O.met.et > 15000 && t > 9) {
      const L = Math.min(5600, 1200 + O.met.et / 100000 * 2600), [x1, y1] = map(L * Math.cos(O.met.phi), L * Math.sin(O.met.phi));
      g.strokeStyle = CLASS_COLOR.nu; g.lineWidth = 2.4 * d; g.setLineDash([7 * d, 4 * d]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
      label(g, `MET ${(O.met.et / 1000).toFixed(0)} GeV`, x1 + 6 * d, y1, d, 'left', '#f2c5ff');
    }
    label(g, 'r-φ  ·  transverse', 8 * d, 14 * d, d, 'left', '#c7cede');
    label(g, '1 m', 8 * d, h - 8 * d, d); g.fillStyle = '#c7cede'; g.fillRect(36 * d, h - 12 * d, 1000 * S, 1.2 * d);
  }
  function drawRz(t) {
    const c = o.rz; if (!c) return;
    const { w, h, d } = fit(c), g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const S = Math.min(w / 2 / 7300, h / 2 / 7300) * 0.98, cx = w / 2, cy = h / 2;
    const map = (x, y, z) => [cx + z * S, cy - Math.sign(y || 1) * Math.hypot(x, y) * S];
    const box = (r0, r1, z0, z1, col, a) => { g.fillStyle = col; g.globalAlpha = a; for (const sg of [1, -1]) g.fillRect(cx + z0 * S, cy - sg * r1 * S, (z1 - z0) * S, (r1 - r0) * S * sg); };
    const V = [[1290, 1520, -2900, 2900, '#36d6b6', 0.13], [320, 1520, 3000, 3230, '#36d6b6', 0.13], [320, 1520, -3230, -3000, '#36d6b6', 0.13], [1770, 2950, -3300, 3300, '#d99a4e', 0.11],
      [300, 2950, 3300, 4900, '#d99a4e', 0.11], [300, 2950, -4900, -3300, '#d99a4e', 0.11], [2980, 3300, -5000, 5000, '#c7d0de', 0.14],
      [3750, 4300, -5000, 5000, '#b4313f', 0.2], [4600, 5200, -5000, 5000, '#b4313f', 0.2], [5500, 6200, -5000, 5000, '#b4313f', 0.2],
      [400, 6500, 5300, 5600, '#b4313f', 0.2], [400, 6500, 5850, 6250, '#b4313f', 0.2], [400, 6500, 6500, 6800, '#b4313f', 0.2],
      [400, 6500, -5600, -5300, '#b4313f', 0.2], [400, 6500, -6250, -5850, '#b4313f', 0.2], [400, 6500, -6800, -6500, '#b4313f', 0.2]];
    for (const v of V) box(...v);
    g.globalAlpha = 0.3; g.strokeStyle = '#64b5f0'; g.lineWidth = 0.6 * d;
    for (const r of LAYERS) for (const sg of [1, -1]) { const z = r < 200 ? 270 : r < 520 ? 700 : 1100; g.beginPath(); g.moveTo(cx - z * S, cy - sg * r * S); g.lineTo(cx + z * S, cy - sg * r * S); g.stroke(); }
    g.globalAlpha = 0.6; g.strokeStyle = '#9fc4ff'; g.beginPath(); g.moveTo(0, cy); g.lineTo(w, cy); g.stroke(); g.globalAlpha = 1;
    if (!ev) return;
    // cells as small marks at their eta, coloured by energy
    g.globalCompositeOperation = 'lighter';
    for (const [eta, phi, e, kind, tc] of ev.cellsRz) {
      if (tc > t) continue;
      const th = 2 * Math.atan(Math.exp(-eta)), sg = Math.sin(phi) >= 0 ? 1 : -1;
      const rr = kind === 'e' ? 1405 : 2360, zz = kind === 'e' ? 3115 : 4100;
      let r = rr, z = rr / Math.tan(th);
      if (Math.abs(z) > (kind === 'e' ? 2900 : 3300)) { z = Math.sign(z) * zz; r = Math.abs(z * Math.tan(th)); }
      const rgb = ramp(logU(e, 200, 100000)).map(v => Math.round(v * 255)), sz = (kind === 'e' ? 2 : 3.5) * d * (0.6 + logU(e, 200, 100000));
      g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`; g.fillRect(cx + z * S - sz / 2, cy - sg * r * S - sz / 2, sz, sz);
    }
    g.globalCompositeOperation = 'source-over';
    tracks(g, t, map, d);
    hitDots(g, t, map, d);
    label(g, 'r-z  ·  longitudinal', 8 * d, 14 * d, d, 'left', '#c7cede');
  }
  function drawLego(t) {
    const c = o.lego; if (!c) return;
    const { w, h, d } = fit(c), g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    // floor: eta from -3 to 3 to the right and up, phi to the left and up
    const ox = w * 0.5, oy = h * 0.86, ax = [w * 0.42 / 6, -h * 0.13 / 6], ay = [-w * 0.40 / (2 * Math.PI), -h * 0.30 / (2 * Math.PI)];
    const P = (eta, phi, z = 0) => [ox + eta * ax[0] + (phi) * ay[0], oy + eta * ax[1] + (phi) * ay[1] - z];
    const phiOff = Math.PI;   // phi from -pi..pi drawn as 0..2pi
    g.strokeStyle = 'rgba(160,170,200,0.18)'; g.lineWidth = d * 0.7;
    for (let e = -3; e <= 3; e += 1) { const [a, b] = P(e, 0), [c2, d2] = P(e, 2 * Math.PI); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke(); }
    for (let k = 0; k <= 4; k++) { const ph = k * Math.PI / 2, [a, b] = P(-3, ph), [c2, d2] = P(3, ph); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke(); }
    label(g, 'η', P(3.25, 0)[0], P(3.25, 0)[1] + 4 * d, d, 'left', '#c7cede');
    label(g, 'φ', P(-3, 2 * Math.PI)[0] - 12 * d, P(-3, 2 * Math.PI)[1], d, 'left', '#c7cede');
    label(g, 'E_T per tower, 0.087 × 0.087', 8 * d, 14 * d, d, 'left', '#c7cede');
    g.fillStyle = EM_C; g.fillRect(8 * d, 22 * d, 9 * d, 9 * d); label(g, 'EM (ECAL)', 21 * d, 30 * d, d, 'left', '#c7cede');
    g.fillStyle = HAD_C; g.fillRect(96 * d, 22 * d, 9 * d, 9 * d); label(g, 'hadronic (HCAL)', 109 * d, 30 * d, d, 'left', '#c7cede');
    legoHit = [];
    if (!ev || !ev.O) return;
    const tw = ev.O.towers.filter(q => q.ET > 300).map(q => ({ ...q, ph: q.phi + phiOff }));
    const maxET = Math.max(20000, ...tw.map(q => q.ET)), Hs = h * 0.5 / Math.sqrt(maxET);
    const grow = Math.max(0, Math.min(1, (t - 5) / 3));
    // jets: rings on the floor
    for (const j of ev.O.jets.slice(0, 6)) {
      g.beginPath();
      for (let k = 0; k <= 48; k++) { const a = k / 48 * 2 * Math.PI, [x, y] = P(j.eta + 0.4 * Math.cos(a), j.phi + phiOff + 0.4 * Math.sin(a)); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = 'rgba(255,212,92,0.65)'; g.lineWidth = 1.2 * d; g.stroke();
    }
    // back to front
    tw.sort((a, b) => (a.eta * ax[1] + a.ph * ay[1]) - (b.eta * ax[1] + b.ph * ay[1]));   // screen height of the base: far (high) first
    const dE = 0.087 / 2 * 0.9, dP = Math.PI / 72 * 0.9;
    for (const q of tw) {
      // bar height ~ sqrt(E_T) so that small towers stay visible; the tooltip gives the number
      const hEm = Math.sqrt(q.ET) * Hs * (q.em / q.E) * grow, hAll = Math.sqrt(q.ET) * Hs * grow;
      const face = (z0, z1, col) => {
        const c0 = P(q.eta - dE, q.ph - dP), c1 = P(q.eta + dE, q.ph - dP), c2 = P(q.eta + dE, q.ph + dP), c3 = P(q.eta - dE, q.ph + dP);
        const up = (p, z) => [p[0], p[1] - z];
        g.fillStyle = col;
        g.globalAlpha = 0.95; g.beginPath(); [c0, c1].map(p => up(p, z0)).concat([c1, c0].map(p => up(p, z1))).forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.fill();
        g.globalAlpha = 0.7; g.beginPath(); [c1, c2].map(p => up(p, z0)).concat([c2, c1].map(p => up(p, z1))).forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.fill();
        g.globalAlpha = 1; g.beginPath(); [c0, c1, c2, c3].map(p => up(p, z1)).forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.fill();
      };
      if (hEm > 0.3) face(0, hEm, EM_C);
      if (hAll - hEm > 0.3) face(hEm + 0.6 * d, hAll, HAD_C);
      const [bx, by] = P(q.eta, q.ph);
      legoHit.push({ x: bx, y: by - hAll / 2, r: Math.max(6 * d, 0), h: hAll, q });
    }
    g.globalAlpha = 1;
  }

  // hover: the nearest bar whose column covers the pointer
  if (o.lego && o.tip) {
    o.lego.addEventListener('pointermove', e => {
      const r = o.lego.getBoundingClientRect(), d = dprOf(), x = (e.clientX - r.left) * d, y = (e.clientY - r.top) * d;
      let best = null, bd = 14 * d;
      for (const b of legoHit) { const dx = Math.abs(x - b.x), dy = y < b.y - b.h / 2 - 4 * d || y > b.y + b.h / 2 + 6 * d ? 1e9 : 0; if (dx + dy < bd) { bd = dx + dy; best = b; } }
      if (!best) { o.tip.hidden = true; return; }
      const q = best.q; o.tip.hidden = false;
      o.tip.innerHTML = `<b>${(q.ET / 1000).toFixed(1)} GeV</b> E<sub>T</sub><br>η ${q.eta.toFixed(2)} · φ ${q.phi.toFixed(2)}<br><i style="color:${EM_C}">■</i> EM ${(q.em / Math.cosh(q.eta) / 1000).toFixed(1)} · <i style="color:${HAD_C}">■</i> had ${((q.E - q.em) / Math.cosh(q.eta) / 1000).toFixed(1)} GeV`;
      o.tip.style.left = `${e.clientX - r.left + 12}px`; o.tip.style.top = `${e.clientY - r.top - 10}px`;
    });
    o.lego.addEventListener('pointerleave', () => { o.tip.hidden = true; });
  }
  return {
    show(R, O) { ev = prep(R, O); lastT = -1e9; },
    clear() { ev = null; lastT = -1e9; },
    draw(t, force) {
      const now = performance.now();
      if (!force && (Math.abs(t - lastT) < 1e-3 || now - lastDraw < 50)) return;
      lastT = t; lastDraw = now;
      drawRphi(t); drawRz(t); drawLego(t);
    },
  };
}
