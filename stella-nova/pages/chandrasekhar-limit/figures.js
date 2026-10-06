// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  figures.js — the 2D canvas figures
// ----------------------------------------------------------------------------
//  Each init function binds one figure to its elements (ids in index.html)
//  and draws it from physics.js. Canvases size to their CSS box times the
//  device pixel ratio and redraw on resize (ResizeObserver).
//
//  FIGURES   (jump with grep -n "<anchor>" figures.js)
//    chart helper ..... "function chart"         canvas sizing, axes
//    Fermi sea ........ "export function initFermi"    section 2
//    n = 1.5 M-R ...... "export function initPoly"     section 3
//    electron energy .. "export function initEnergyP"  section 4, eps(p), Gamma
//    E(R) ............. "export function initER"       section 4, the ball
//    E(R) painter ..... "export function drawER"       also used by saver.js
//    Lane-Emden ....... "export function initLE"       section 5
//    exact M-R ........ "export function initFull"     section 5
//    Hubble diagram ... "export function initHubble"   section 6
//
//  COLOURS: the m1..m6 maths colours of lib/sci.css. m1 blue = electrons,
//  momentum; m2 orange = gravity, mass; m3 green = pressure, kinetic;
//  m4 pink = density; m5 gold = the limit; m6 violet = radius.
// ============================================================================
import * as P from './physics.js';

export const COL = { m1: '#62c4ff', m2: '#ff9a62', m3: '#86dc7c', m4: '#e889dc', m5: '#ffd666', m6: '#a8a4ff',
  ink: '#e8eaf0', ink2: '#c2c7d4', dim: '#8a91a5', faint: 'rgba(255,255,255,0.08)', grid: 'rgba(255,255,255,0.06)', red: '#ff5f57', wd: '#cfe3ff' };
const FONT = '12px Inter, system-ui, sans-serif', FONT_S = '11px Inter, system-ui, sans-serif';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const fmtE = (v, d = 2) => {
  if (!isFinite(v)) return '—';
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= -2 && e < 4) return v.toFixed(Math.max(0, d - Math.max(0, e)));
  const m = v / 10 ** e;
  return `${m.toFixed(d - 1)} × 10${String(e).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c] || (c === '-' ? '⁻' : c)).join('')}`;
};
const MCH = P.massChandra(2).Msun;

// ── chart helper ───────────────────────────────────────────────────────────
// chart(cv, draw): draw(ctx, w, h) in CSS px. Returns redraw().
function chart(cv, draw) {
  const ctx = cv.getContext('2d');
  let queued = false;
  const redraw = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(10, r.width), h = Math.max(10, r.height);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h);
    });
  };
  new ResizeObserver(redraw).observe(cv);
  return redraw;
}
// Axes in a box {x, y, w, h}. sx, sy: data -> px. Returns {sx, sy, ix}.
function axes(ctx, box, xr, yr, o = {}) {
  const lx = o.xlog, ly = o.ylog;
  const fx = v => lx ? Math.log10(v) : v, fy = v => ly ? Math.log10(v) : v;
  const x0 = fx(xr[0]), x1 = fx(xr[1]), y0 = fy(yr[0]), y1 = fy(yr[1]);
  const sx = v => box.x + (fx(v) - x0) / (x1 - x0) * box.w;
  const sy = v => box.y + box.h - (fy(v) - y0) / (y1 - y0) * box.h;
  const ix = px => { const u = x0 + (px - box.x) / box.w * (x1 - x0); return lx ? 10 ** u : u; };
  ctx.save();
  ctx.font = FONT_S; ctx.fillStyle = COL.dim; ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
  for (const t of o.xt || []) {
    const X = sx(t); if (X < box.x - 1 || X > box.x + box.w + 1) continue;
    ctx.beginPath(); ctx.moveTo(X, box.y); ctx.lineTo(X, box.y + box.h); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(o.xf ? o.xf(t) : String(t), X, box.y + box.h + 5);
  }
  for (const t of o.yt || []) {
    const Y = sy(t); if (Y < box.y - 1 || Y > box.y + box.h + 1) continue;
    ctx.beginPath(); ctx.moveTo(box.x, Y); ctx.lineTo(box.x + box.w, Y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(o.yf ? o.yf(t) : String(t), box.x - 6, Y);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  ctx.fillStyle = COL.ink2; ctx.font = FONT;
  if (o.xl) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xl, box.x + box.w - 6, box.y + box.h - 5); }
  if (o.yl) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(o.yl, box.x + 6, box.y + 5); }
  ctx.restore();
  return { sx, sy, ix };
}
function line(ctx, pts, color, width = 2, dash = null) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); let pen = false;
  for (const [x, y] of pts) { if (!isFinite(x) || !isFinite(y)) { pen = false; continue; } if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y); }
  ctx.stroke(); ctx.restore();
}
function label(ctx, text, x, y, color, align = 'left', base = 'middle', font = FONT) {
  ctx.save(); ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4; ctx.fillText(text, x, y); ctx.restore();
}
function dot(ctx, x, y, r, color, ring = null) {
  ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.restore();
}
function bindRange(id, fn) {
  const el = $(id); if (!el) return () => {};
  const f = () => fn(+el.value);
  el.addEventListener('input', f); f();
  return v => { el.value = v; f(); };
}
const out = (id, html) => { const el = $(id); if (el && el.innerHTML !== html) el.innerHTML = html; };
const isPhone = () => window.matchMedia('(max-width: 640px)').matches;
function boxOf(w, h, l = 52, r = 14, t = 14, b = 30) { return { x: l, y: t, w: w - l - r, h: h - t - b }; }
// Horizontal drag on a canvas -> callback(px). Vertical drags scroll.
function hdrag(cv, fn) {
  let id = null;
  cv.addEventListener('pointerdown', e => { id = e.pointerId; cv.setPointerCapture(id); fn(e.offsetX, e.offsetY); });
  cv.addEventListener('pointermove', e => { if (e.pointerId === id) fn(e.offsetX, e.offsetY); });
  const up = e => { if (e.pointerId === id) id = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}

// ── Fermi sea (section 2) ──────────────────────────────────────────────────
// Left: a box of electrons, side L proportional to rho^(-1/3); dots move
// at speeds up to v_F. Right: the k_z = 0 slice of momentum space. Each
// lattice point (spacing 2 pi hbar / L) holds two electrons (spin up and
// down). The filled disc has radius p_F = hbar (3 pi^2 n)^(1/3).
export function initFermi() {
  const cvB = $('fermiBox'), cvP = $('fermiMom');
  if (!cvB || !cvP) return;
  const AX = 5;                 // momentum axis: +-5 m_e c
  const NR = 5.2;               // p_F / dp: fixed electron number in the box
  const st = { lr: 6.43, x: 1, parts: [] };
  for (let i = 0; i < 90; i++) st.parts.push({ x: Math.random(), y: Math.random(), a: Math.random() * 6.283, s: Math.cbrt(Math.random()) });
  const drawBox = chart(cvB, (ctx, w, h) => {
    const F = P.fermi(10 ** st.lr * 1e3);
    const side = Math.min(w, h) - 30;
    if (side < 12) return;
    const L = side * clamp((10 ** (5 - st.lr)) ** (1 / 3) * 2.2, 0.16, 1);
    const x0 = (w - L) / 2, y0 = (h - L) / 2;
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y0, L, L);
    for (const p of st.parts) dot(ctx, x0 + 3 + p.x * (L - 6), y0 + 3 + p.y * (L - 6), 2.1, COL.m1);
    label(ctx, `box side ∝ ρ^(−1/3)`, 8, h - 10, COL.dim, 'left', 'middle', FONT_S);
    label(ctx, `v_F = ${F.v.toFixed(2)} c`, w - 8, h - 10, COL.m1, 'right', 'middle', FONT_S);
  });
  const drawMom = chart(cvP, (ctx, w, h) => {
    const x = st.x, s = Math.min(w, h) / 2 - 16, cx = w / 2, cy = h / 2, k = s / AX;
    if (s < 12) return;                       // hidden (saver) or not laid out yet
    ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy); ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s); ctx.stroke();
    // Filled sea, shaded by energy.
    const R = x * k;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, R));
    g.addColorStop(0, 'rgba(98,196,255,0.05)'); g.addColorStop(1, 'rgba(98,196,255,0.28)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.fill();
    // Lattice: spacing dp = p_F / NR in this slice.
    const dp = x / NR * k;
    if (dp > 2.2) {
      const n = Math.ceil(s / dp);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const X = cx + i * dp, Y = cy + j * dp; const r = Math.hypot(i * dp, j * dp);
        if (Math.abs(X - cx) > s || Math.abs(Y - cy) > s) continue;
        if (r <= R) { dot(ctx, X - 1.6, Y, 1.5, COL.m1); dot(ctx, X + 1.6, Y, 1.5, '#b9e4ff'); }
        else dot(ctx, X, Y, 0.9, 'rgba(255,255,255,0.18)');
      }
    }
    ctx.strokeStyle = COL.m1; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke();
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = COL.m5; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, k, 0, 6.283); ctx.stroke(); ctx.restore();
    label(ctx, 'p = mₑc', cx + k * 0.72 + 4, cy - k * 0.72 - 4, COL.m5, 'left', 'bottom', FONT_S);
    label(ctx, `p_F = ${x.toFixed(2)} mₑc`, cx + Math.min(R, s - 4) * 0.71 + 6, cy + Math.min(R, s - 4) * 0.71 + 6, COL.m1, 'left', 'top', FONT_S);
    label(ctx, 'pₓ', cx + s - 2, cy - 8, COL.dim, 'right', 'bottom', FONT_S);
    label(ctx, 'p_y', cx + 6, cy - s + 2, COL.dim, 'left', 'top', FONT_S);
  });
  bindRange('fermiRho', v => {
    st.lr = v;
    const F = P.fermi(10 ** v * 1e3);
    st.x = F.x;
    $('fermiRhoOut').textContent = `${fmtE(10 ** v)} g/cm³`;
    out('fermiRead', `<span>n<sub>e</sub><b>${fmtE(F.n * 1e-6)} cm⁻³</b></span><span>p<sub>F</sub><b>${F.x.toFixed(3)} mₑc</b></span><span>E<sub>F</sub><b>${(F.EFMeV * 1e3).toFixed(1)} keV</b></span><span>v<sub>F</sub><b>${F.v.toFixed(3)} c</b></span><span>P<b>${fmtE(F.P)} Pa</b></span><span>Γ<b>${F.Gamma.toFixed(3)}</b></span>`);
    drawBox(); drawMom();
  });
  document.querySelectorAll('[data-fermi]').forEach(b => b.addEventListener('click', () => {
    const el = $('fermiRho'); el.value = b.dataset.fermi; el.dispatchEvent(new Event('input'));
  }));
  // The electrons move: speed share s of v_F, bouncing off the walls.
  let last = performance.now(), vis = false;
  new IntersectionObserver(es => { vis = es[0].isIntersecting; if (vis) requestAnimationFrame(tick); }).observe(cvB);
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const v = P.fermi(10 ** st.lr * 1e3).v;
    for (const p of st.parts) {
      p.x += Math.cos(p.a) * p.s * v * dt * 0.9; p.y += Math.sin(p.a) * p.s * v * dt * 0.9;
      if (p.x < 0 || p.x > 1) { p.a = Math.PI - p.a; p.x = clamp(p.x, 0, 1); }
      if (p.y < 0 || p.y > 1) { p.a = -p.a; p.y = clamp(p.y, 0, 1); }
    }
    drawBox();
    if (vis) requestAnimationFrame(tick);
  }
}

// ── n = 1.5 mass-radius (section 3) ────────────────────────────────────────
export function initPoly() {
  const cv = $('polyCv'); if (!cv) return;
  const st = { M: 0.6, exact: false };
  const R1 = P.radiusNR(1);
  const curve = P.massRadiusCurve(2, { n: 80 });
  const draw = chart(cv, (ctx, w, h) => {
    const phone = w < 520;
    const box = boxOf(w, h, 54, phone ? 12 : 150, 12, 30);
    const A = axes(ctx, box, [0.05, 2], [1e3, 6e4], { xlog: true, ylog: true, xt: [0.05, 0.1, 0.2, 0.5, 1, 2], yt: [1e3, 2e3, 5e3, 1e4, 2e4, 5e4], yf: v => (v / 1e3) + 'k', xl: 'M / M☉', yl: 'R (km)' });
    // Earth radius line.
    line(ctx, [[box.x, A.sy(6371)], [box.x + box.w, A.sy(6371)]], 'rgba(120,170,255,0.35)', 1, [3, 4]);
    label(ctx, 'Earth', box.x + 6, A.sy(6371) - 8, 'rgba(150,190,255,0.8)', 'left', 'middle', FONT_S);
    if (st.exact) line(ctx, curve.map(c => [A.sx(c.M), A.sy(c.R / 1e3)]), 'rgba(255,214,102,0.7)', 2, [6, 4]);
    const pts = []; for (let i = 0; i <= 80; i++) { const M = 0.05 * (40) ** (i / 80); pts.push([A.sx(M), A.sy(R1 * M ** (-1 / 3) / 1e3)]); }
    line(ctx, pts, COL.m6, 2.4);
    label(ctx, 'R ∝ M^(−1/3)', A.sx(0.09), A.sy(R1 * 0.09 ** (-1 / 3) / 1e3) - 12, COL.m6, 'left', 'bottom');
    const R = R1 * st.M ** (-1 / 3) / 1e3;
    dot(ctx, A.sx(st.M), A.sy(R), 6, COL.m6, '#fff');
    if (st.exact) { label(ctx, 'exact (section 5)', A.sx(1.2), A.sy(2500), COL.m5, 'right', 'middle', FONT_S); line(ctx, [[A.sx(MCH), box.y], [A.sx(MCH), box.y + box.h]], 'rgba(255,214,102,0.35)', 1, [2, 3]); }
    // Size comparison: the dwarf and the Earth, to scale.
    if (!phone) {
      const cx = w - 72, cy = box.y + box.h * 0.5, sc = 58 / 12000;
      ctx.save();
      const g = ctx.createRadialGradient(cx, cy - 40, 0, cx, cy - 40, R * 1e3 * sc / 1e3 + 6);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#cfe3ff'); g.addColorStop(1, 'rgba(160,200,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy - 40, R * sc + 4, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#2b5fb0'; ctx.beginPath(); ctx.arc(cx, cy + 62, 6371 * sc, 0, 6.283); ctx.fill();
      ctx.restore();
      label(ctx, 'dwarf', cx, cy - 40 - R * sc - 10, COL.ink2, 'center', 'bottom', FONT_S);
      label(ctx, 'Earth', cx, cy + 62 + 6371 * sc + 12, COL.ink2, 'center', 'top', FONT_S);
    }
  });
  hdrag(cv, px => { const r = cv.getBoundingClientRect(); const box = boxOf(r.width, r.height, 54, r.width < 520 ? 12 : 150); const M = clamp(10 ** (Math.log10(0.05) + (px - box.x) / box.w * Math.log10(40)), 0.05, 2); setM(Math.log10(M)); });
  const setM = bindRange('polyM', v => {
    st.M = 10 ** v;
    $('polyMOut').textContent = `${st.M.toFixed(3)} M☉`;
    const Rn = P.radiusNR(st.M), ex = P.dwarfOfMass(st.M);
    const rhoMean = st.M * P.K.Msun / (4 / 3 * Math.PI * Rn ** 3);
    out('polyRead', `<span>R (n = 1.5)<b>${(Rn / 1e3).toFixed(0)} km</b></span><span>mean ρ<b>${fmtE(rhoMean / 1e3)} g/cm³</b></span><span>R (exact)<b>${ex ? (ex.R / 1e3).toFixed(0) + ' km' : 'none: past M_Ch'}</b></span><span>error of n = 1.5<b>${ex ? ((Rn / ex.R - 1) * 100).toFixed(1) + ' %' : '∞'}</b></span>`);
    draw();
  });
  $('polyExact')?.addEventListener('click', e => { st.exact = !st.exact; e.currentTarget.classList.toggle('on', st.exact); draw(); });
}

// ── electron energy and Gamma (section 4) ──────────────────────────────────
export function initEnergyP() {
  const cv = $('epCv'); if (!cv) return;
  const st = { x: 1 };
  const E = P.eos(2);
  const draw = chart(cv, (ctx, w, h) => {
    const split = h * 0.62;
    const b1 = { x: 52, y: 12, w: w - 66, h: split - 40 };
    const A = axes(ctx, b1, [0, 5], [0, 5], { xt: [0, 1, 2, 3, 4, 5], yt: [0, 1, 2, 3, 4, 5], xl: 'p / mₑc', yl: 'kinetic energy / mₑc²' });
    const ex = [], nr = [], ur = [];
    for (let i = 0; i <= 200; i++) { const p = 5 * i / 200; ex.push([A.sx(p), A.sy(Math.sqrt(1 + p * p) - 1)]); nr.push([A.sx(p), A.sy(p * p / 2)]); ur.push([A.sx(p), A.sy(p)]); }
    ctx.save(); ctx.beginPath(); ctx.rect(b1.x, b1.y, b1.w, b1.h); ctx.clip();
    line(ctx, nr, COL.m3, 1.6, [5, 4]); line(ctx, ur, COL.m2, 1.6, [5, 4]); line(ctx, ex, COL.m1, 2.6);
    ctx.restore();
    label(ctx, 'p²/2mₑ', A.sx(2.6), A.sy(3.6), COL.m3, 'right', 'middle');
    label(ctx, 'pc', A.sx(4.4), A.sy(4.4) - 10, COL.m2, 'right', 'bottom');
    label(ctx, '√(p²c² + mₑ²c⁴) − mₑc²', A.sx(4.9), A.sy(Math.sqrt(1 + 4.9 ** 2) - 1) + 14, COL.m1, 'right', 'top');
    const xs = Math.min(st.x, 5);
    dot(ctx, A.sx(xs), A.sy(Math.sqrt(1 + xs * xs) - 1), 6, COL.m1, '#fff');
    // Gamma(x).
    const b2 = { x: 52, y: split, w: w - 66, h: h - split - 28 };
    const B = axes(ctx, b2, [0.01, 100], [1.3, 1.7], { xlog: true, xt: [0.01, 0.1, 1, 10, 100], yt: [4 / 3, 5 / 3], yf: v => v > 1.5 ? '5/3' : '4/3', xl: 'x = p_F / mₑc', yl: 'Γ = d ln P / d ln ρ' });
    const g = []; for (let i = 0; i <= 160; i++) { const x = 0.01 * 1e4 ** (i / 160); g.push([B.sx(x), B.sy(E.Gamma(x))]); }
    line(ctx, g, COL.m3, 2.4);
    const xg = clamp(st.x, 0.01, 100);
    dot(ctx, B.sx(xg), B.sy(E.Gamma(xg)), 5, COL.m3, '#fff');
  });
  bindRange('epRho', v => {
    const F = P.fermi(10 ** v * 1e3);
    st.x = F.x;
    $('epRhoOut').textContent = `${fmtE(10 ** v)} g/cm³`;
    out('epRead', `<span>x<b>${F.x.toFixed(2)}</b></span><span>Γ<b>${F.Gamma.toFixed(3)}</b></span><span>P ∝ ρ<sup>Γ</sup><b>${F.Gamma > 1.6 ? 'soft, n^(5/3)' : F.Gamma < 1.37 ? 'n^(4/3): too soft' : 'in between'}</b></span>`);
    draw();
  });
}

// ── E(R) (section 4) ───────────────────────────────────────────────────────
// Plot E in units of G Msun^2 / R_earth on a symmetric log axis, against
// log R. A ball rolls on the curve: damped motion in the plot's own
// coordinates, so it settles in the minimum or runs off to R -> 0.
const R0 = 10e3, R1 = 6e7, EU = P.K.G * P.K.Msun ** 2 / P.K.Rearth;
const sl = (v, k = 0.03) => Math.sign(v) * Math.log10(1 + Math.abs(v) / k);
const isl = (y, k = 0.03) => Math.sign(y) * k * (10 ** Math.abs(y) - 1);
export function drawER(ctx, w, h, M, model, ball, o = {}) {
  const box = o.box || boxOf(w, h, 58, 14, 14, 30);
  const yr = [sl(-200), sl(300)];
  const yt = [-100, -10, -1, -0.1, 0, 0.1, 1, 10].map(v => sl(v));
  const A = axes(ctx, box, [R0, R1], yr, { xlog: true, xt: [1e4, 1e5, 1e6, 1e7], xf: v => v >= 1e6 ? (v / 1e6) + '000 km' : (v / 1e3) + ' km', yt, yf: y => { const v = isl(y); return Math.abs(v) < 1e-9 ? '0' : (Math.abs(v) >= 1 ? v.toFixed(0) : v.toFixed(1)); }, xl: o.xl ?? 'radius R', yl: o.yl ?? 'E / (G M☉² / R⊕)' });
  const kin = [], grav = [], tot = [];
  for (let i = 0; i <= 260; i++) {
    const R = R0 * (R1 / R0) ** (i / 260), e = model.at(M, R);
    kin.push([A.sx(R), A.sy(sl(e.Ek / EU))]); grav.push([A.sx(R), A.sy(sl(e.Eg / EU))]); tot.push([A.sx(R), A.sy(sl(e.E / EU))]);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  line(ctx, [[box.x, A.sy(0)], [box.x + box.w, A.sy(0)]], 'rgba(255,255,255,0.3)', 1);
  line(ctx, kin, COL.m3, 1.6, [5, 4]); line(ctx, grav, COL.m2, 1.6, [5, 4]);
  line(ctx, tot, M >= model.Mcrit ? COL.red : COL.m1, 3);
  const mn = model.minimum(M);
  if (mn) {
    const X = A.sx(mn.R), Y = A.sy(sl(mn.E / EU));
    line(ctx, [[X, Y], [X, box.y + box.h]], 'rgba(98,196,255,0.4)', 1, [3, 3]);
    label(ctx, `minimum at R = ${(mn.R / 1e3).toFixed(0)} km`, X + 8, Y + 16, COL.m1, 'left', 'top');
  } else {
    label(ctx, 'no minimum: E falls without end as R → 0', box.x + box.w * 0.35, A.sy(sl(-0.3)), COL.red, 'center', 'middle');
  }
  if (ball) {
    const R = Math.exp(ball.u), e = model.at(M, R);
    dot(ctx, A.sx(R), A.sy(sl(e.E / EU)) - 7, 7, '#fff', M >= model.Mcrit ? COL.red : COL.m1);
  }
  ctx.restore();
  { const R = 3e6, e = model.at(M, R); label(ctx, 'kinetic (electrons)', A.sx(R), A.sy(sl(e.Ek / EU)) - 10, COL.m3, 'left', 'bottom', FONT_S); label(ctx, 'gravity', A.sx(R), A.sy(sl(e.Eg / EU)) + 10, COL.m2, 'left', 'top', FONT_S); }
  return A;
}
export function initER() {
  const cv = $('erCv'); if (!cv) return;
  const st = { M: 1.0, mode: 'profile', model: P.energyModel(2, 'profile'), ball: { u: Math.log(3e6), v: 0 } };
  const draw = chart(cv, (ctx, w, h) => drawER(ctx, w, h, st.M, st.model, st.ball));
  const read = () => {
    const mn = st.model.minimum(st.M);
    out('erRead', `<span>M<b>${st.M.toFixed(3)} M☉</b></span><span>M / M<sub>crit</sub><b>${(st.M / st.model.Mcrit).toFixed(3)}</b></span><span>M<sub>crit</sub> of this toy<b>${st.model.Mcrit.toFixed(3)} M☉</b></span><span>equilibrium<b>${mn ? (mn.R / 1e3).toFixed(0) + ' km, p_F = ' + mn.x.toFixed(2) + ' mₑc' : 'none'}</b></span>`);
    const v = $('erVerdict');
    if (v) { v.className = 'verdict ' + (mn ? 'yes' : 'no'); v.textContent = mn ? 'Stable: the ball settles in the minimum.' : 'Collapse: the ball rolls to R = 0.'; }
  };
  bindRange('erM', v => { st.M = v; $('erMOut').textContent = `${v.toFixed(3)} M☉`; read(); draw(); });
  document.querySelectorAll('#erMode button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#erMode button').forEach(q => q.classList.toggle('on', q === b));
    st.mode = b.dataset.mode; st.model = P.energyModel(2, st.mode); read(); draw();
  }));
  $('erDrop')?.addEventListener('click', () => { st.ball.u = Math.log(3e7); st.ball.v = 0; });
  // Ball dynamics in plot units: u = ln R, force -dE_plot/du.
  let last = performance.now(), vis = false;
  new IntersectionObserver(es => { vis = es[0].isIntersecting; if (vis) { last = performance.now(); requestAnimationFrame(tick); } }).observe(cv);
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const f = u => sl(st.model.at(st.M, Math.exp(u)).E / EU);
    const b = st.ball, du = 0.01;
    const g = -(f(b.u + du) - f(b.u - du)) / (2 * du);
    b.v += (g * 6 - b.v * 1.6) * dt;
    b.u += b.v * dt;
    if (b.u < Math.log(R0)) { b.u = Math.log(3e7); b.v = 0; }
    if (b.u > Math.log(R1)) { b.u = Math.log(R1); b.v = 0; }
    draw();
    if (vis) requestAnimationFrame(tick);
  }
}

// ── Lane-Emden (section 5) ─────────────────────────────────────────────────
export function initLE() {
  const cv = $('leCv'); if (!cv) return;
  const ref = [1.5, 3].map(n => ({ n, L: P.laneEmden(n, { keep: 300 }) }));
  const st = { n: 2.25, L: null };
  const draw = chart(cv, (ctx, w, h) => {
    const box = boxOf(w, h, 46, 14, 12, 30);
    const A = axes(ctx, box, [0, 16], [0, 1], { xt: [0, 2, 4, 6, 8, 10, 12, 14, 16], yt: [0, 0.25, 0.5, 0.75, 1], xl: 'ξ', yl: 'θ  (ρ/ρc = θⁿ)' });
    const put = (L, color, wd, dash) => line(ctx, L.prof.map(([x, y]) => [A.sx(x), A.sy(y)]), color, wd, dash);
    put(ref[0].L, COL.m6, 1.6, [5, 4]); put(ref[1].L, COL.m5, 1.6, [5, 4]);
    label(ctx, 'n = 1.5', A.sx(ref[0].L.xi1) + 4, A.sy(0) - 10, COL.m6, 'left', 'bottom', FONT_S);
    label(ctx, 'n = 3', A.sx(ref[1].L.xi1) + 4, A.sy(0) - 24, COL.m5, 'left', 'bottom', FONT_S);
    if (st.L) {
      put(st.L, COL.m1, 2.6);
      dot(ctx, A.sx(Math.min(16, st.L.xi1)), A.sy(0), 5, COL.m1, '#fff');
    }
  });
  bindRange('leN', v => {
    st.n = v;
    st.L = v < 4.95 ? P.laneEmden(v, { keep: 300, h: v > 4 ? 4e-3 : 1e-3 }) : null;
    $('leNOut').textContent = `n = ${v.toFixed(2)}`;
    out('leRead', st.L ? `<span>ξ₁<b>${st.L.xi1.toFixed(4)}</b></span><span>ω<sub>n</sub> = −ξ₁²θ′(ξ₁)<b>${st.L.omega.toFixed(4)}</b></span><span>R ∝ M<sup>(1−n)/(3−n)</sup><b>${Math.abs(v - 3) < 0.01 ? 'M fixed: M_Ch' : 'exponent ' + ((1 - v) / (3 - v)).toFixed(3)}</b></span>` : '<span>n ≥ 5: no surface</span>');
    draw();
  });
}

// ── exact mass-radius (section 5) ──────────────────────────────────────────
export function initFull({ onModel } = {}) {
  const cv = $('fullCv'); if (!cv) return;
  const C2 = P.massRadiusCurve(2, { n: 140, x0: 0.05, x1: 3000 });
  const CFe = P.massRadiusCurve(56 / 26, { n: 140, x0: 0.05, x1: 3000 });
  const R1 = P.radiusNR(1), R1Fe = P.radiusNR(1, 56 / 26);
  const MFe = P.massChandra(56 / 26).Msun;
  const st = { lx: 0.4, iron: false, model: null, prof: null };
  const draw = chart(cv, (ctx, w, h) => {
    const phone = w < 520;
    const box = boxOf(w, h, 56, 14, 12, 30);
    const A = axes(ctx, box, [0, 1.6], [0, 22000], { xt: [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6], yt: [0, 5000, 10000, 15000, 20000], yf: v => v ? (v / 1000) + 'k' : '0', xl: 'M / M☉', yl: 'R (km)' });
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    const nr = []; for (let i = 0; i <= 120; i++) { const M = 0.02 + 1.6 * i / 120; nr.push([A.sx(M), A.sy(R1 * M ** (-1 / 3) / 1e3)]); }
    line(ctx, nr, COL.m6, 1.6, [5, 4]);
    line(ctx, [[A.sx(MCH), box.y], [A.sx(MCH), box.y + box.h]], COL.m5, 1.6, [5, 4]);
    if (st.iron) {
      const nf = []; for (let i = 0; i <= 120; i++) { const M = 0.02 + 1.6 * i / 120; nf.push([A.sx(M), A.sy(R1Fe * M ** (-1 / 3) / 1e3)]); }
      line(ctx, CFe.map(c => [A.sx(c.M), A.sy(c.R / 1e3)]), 'rgba(255,154,98,0.9)', 2.2);
      line(ctx, [[A.sx(MFe), box.y], [A.sx(MFe), box.y + box.h]], 'rgba(255,154,98,0.6)', 1.2, [2, 3]);
    }
    line(ctx, C2.map(c => [A.sx(c.M), A.sy(c.R / 1e3)]), COL.m1, 3);
    ctx.restore();
    label(ctx, 'n = 1.5: R ∝ M^(−1/3)', A.sx(0.42), A.sy(R1 * 0.42 ** (-1 / 3) / 1e3) - 10, COL.m6, 'left', 'bottom', FONT_S);
    label(ctx, `n = 3: M_Ch = ${MCH.toFixed(3)} M☉`, A.sx(MCH) - 6, box.y + box.h * 0.5, COL.m5, 'right', 'middle', FONT_S);
    if (st.iron) label(ctx, `iron, μₑ = 2.15: ${MFe.toFixed(3)}`, A.sx(MFe) - 6, box.y + box.h * 0.58, COL.m2, 'right', 'middle', FONT_S);
    // Measured dwarfs with 1 sigma bars.
    for (const s of P.STARS) {
      const X = A.sx(s.M), Y = A.sy(s.R * P.K.Rsun / 1e3);
      const ex = (A.sx(s.M + s.dM) - A.sx(s.M - s.dM)) / 2, ey = Math.abs(A.sy((s.R + s.dR) * P.K.Rsun / 1e3) - A.sy((s.R - s.dR) * P.K.Rsun / 1e3)) / 2;
      ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(X - ex, Y); ctx.lineTo(X + ex, Y); ctx.moveTo(X, Y - ey); ctx.lineTo(X, Y + ey); ctx.stroke(); ctx.restore();
      dot(ctx, X, Y, 3.5, '#fff');
      label(ctx, s.name, X + 7, Y - (s.id === 'eri40B' ? 10 : -10), COL.ink, 'left', 'middle', FONT_S);
    }
    if (st.model) {
      const X = A.sx(st.model.M), Y = A.sy(st.model.R / 1e3);
      dot(ctx, X, Y, 7, COL.m1, '#fff');
    }
    // Inset: rho / rho_c against r / R for the chosen model.
    if (st.prof && !phone) {
      const ib = { x: box.x + box.w * 0.5, y: box.y + box.h * 0.06, w: box.w * 0.34, h: box.h * 0.32 };
      ctx.fillStyle = 'rgba(6,8,14,0.82)'; ctx.fillRect(ib.x - 34, ib.y - 6, ib.w + 40, ib.h + 30);
      const B = axes(ctx, ib, [0, 1], [0, 1], { xt: [0, 0.5, 1], yt: [0, 0.5, 1], xl: 'r / R', yl: 'ρ / ρc' });
      const p15 = P.leCached(1.5), L15 = P.laneEmden(1.5, { keep: 100 }), L3 = P.laneEmden(3, { keep: 100 });
      line(ctx, L15.prof.map(([x, y]) => [B.sx(x / p15.xi1), B.sy(Math.max(0, y) ** 1.5)]), COL.m6, 1.2, [4, 3]);
      line(ctx, L3.prof.map(([x, y]) => [B.sx(x / L3.xi1), B.sy(Math.max(0, y) ** 3)]), COL.m5, 1.2, [4, 3]);
      line(ctx, st.prof.map(p => [B.sx(p.s), B.sy(p.rho)]), COL.m4, 2.4);
    }
  });
  const read = () => {
    const m = st.model;
    out('fullRead', `<span>x<sub>c</sub> = p<sub>F</sub>/mₑc<b>${m.xc.toFixed(3)}</b></span><span>M<b>${m.M.toFixed(4)} M☉</b></span><span>M / M<sub>Ch</sub><b>${(m.M / P.massChandra(m.mue).Msun).toFixed(4)}</b></span><span>R<b>${(m.R / 1e3).toFixed(0)} km</b></span><span>ρ<sub>c</sub><b>${fmtE(m.rhoc / 1e3)} g/cm³</b></span><span>mean ρ<b>${fmtE(m.rhoMean / 1e3)} g/cm³</b></span>`);
  };
  const setX = bindRange('fullX', v => {
    st.lx = v;
    st.model = P.whiteDwarf(10 ** v, st.iron ? 56 / 26 : 2, { keep: 160 });
    st.prof = st.model.prof;
    $('fullXOut').textContent = `x_c = ${fmtE(10 ** v)}`;
    read(); draw(); onModel && onModel(st.model);
  });
  $('fullIron')?.addEventListener('click', e => { st.iron = !st.iron; e.currentTarget.classList.toggle('on', st.iron); setX(st.lx); });
  // Drag across the plot picks the model nearest in M.
  hdrag(cv, px => {
    const r = cv.getBoundingClientRect(), box = boxOf(r.width, r.height, 56, 14, 12, 30);
    const M = clamp((px - box.x) / box.w * 1.6, 0.05, MCH * 0.9999);
    const curve = st.iron ? CFe : C2; let best = curve[0];
    for (const c of curve) if (Math.abs(c.M - M) < Math.abs(best.M - M)) best = c;
    setX(clamp(Math.log10(best.xc), -1.3, 3.4));
  });
}

// ── Hubble diagram (section 6) ─────────────────────────────────────────────
export function initHubble() {
  const cv = $('hubCv'); if (!cv) return;
  const st = { L: 0.7 };
  const draw = chart(cv, (ctx, w, h) => {
    const box = boxOf(w, h, 52, 14, 12, 30);
    const A = axes(ctx, box, [0, 1.6], [-0.9, 0.5], { xt: [0, 0.4, 0.8, 1.2, 1.6], yt: [-0.8, -0.4, 0, 0.4], yf: v => (v > 0 ? '+' : '') + v.toFixed(1), xl: 'redshift z', yl: 'Δ magnitude (fainter ↑)' });
    const curve = L => { const pts = []; for (let i = 1; i <= 80; i++) { const z = 1.6 * i / 80; pts.push([A.sx(z), A.sy(P.distanceModulus(z, L) - P.distanceModulusEmpty(z))]); } return pts; };
    line(ctx, [[box.x, A.sy(0)], [box.x + box.w, A.sy(0)]], 'rgba(255,255,255,0.35)', 1);
    line(ctx, curve(0), COL.m2, 1.6, [5, 4]);
    line(ctx, curve(st.L), COL.m1, 3);
    label(ctx, 'no dark energy (Ωm = 1)', A.sx(1.55), A.sy(P.distanceModulus(1.55, 0) - P.distanceModulusEmpty(1.55)) - 10, COL.m2, 'right', 'bottom', FONT_S);
    label(ctx, 'coasting, empty universe', A.sx(1.55), A.sy(0) - 8, COL.dim, 'right', 'bottom', FONT_S);
    const d = P.distanceModulus(0.5, st.L) - P.distanceModulus(0.5, 0);
    dot(ctx, A.sx(0.5), A.sy(P.distanceModulus(0.5, st.L) - P.distanceModulusEmpty(0.5)), 5, COL.m1, '#fff');
    out('hubRead', `<span>Ω<sub>Λ</sub><b>${st.L.toFixed(2)}</b></span><span>Ω<sub>m</sub><b>${(1 - st.L).toFixed(2)}</b></span><span>at z = 0.5, vs Ω<sub>m</sub> = 1<b>${d >= 0 ? '+' : ''}${d.toFixed(2)} mag, ${((10 ** (0.4 * d) - 1) * 100).toFixed(0)} % dimmer</b></span>`);
  });
  bindRange('hubL', v => { st.L = v; $('hubLOut').textContent = `Ω_Λ = ${v.toFixed(2)}`; draw(); });
}
