// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  figures.js — the 2D canvas figures
// ----------------------------------------------------------------------------
//  Each init function binds one figure to its elements (ids in index.html)
//  and draws it from physics.js. A figure redraws only on a control change
//  or a resize: nothing moves unless the reader moves it.
//
//  STYLE: thin lines, one blue for the model, one warm colour for the
//  limit, greys for references and axes. No glows, no gradients.
//
//  FIGURES   (jump with grep -n "<anchor>" figures.js)
//    palette .......... "export const COL"
//    chart helper ..... "function chart"         canvas sizing, axes
//    hero curve ....... "export function drawHero"    also used by saver.js
//    hero ............. "export function initHero"    the opening figure
//    Fermi sea ........ "export function initFermi"   section 2
//    n = 1.5 M-R ...... "export function initPoly"    section 3
//    electron energy .. "export function initEnergyP" section 4
//    E(R) painter ..... "export function drawER"      also used by saver.js
//    E(R) ............. "export function initER"      section 4
//    Lane-Emden ....... "export function initLE"      section 5
//    composition ...... "export function initFull"    section 5
//    Hubble diagram ... "export function initHubble"  section 6
// ============================================================================
import * as P from './physics.js';

export const COL = {
  ink: '#e7e5e0', ink2: '#b9b8b3', dim: '#86878b', faint: '#55575c',
  axis: 'rgba(255,255,255,0.22)', grid: 'rgba(255,255,255,0.055)',
  blue: '#9ec1ff', warm: '#d9a45b', bg: '#0e0f11',
};
const FONT = '12.5px Inter, system-ui, sans-serif', FONT_S = '11.5px Inter, system-ui, sans-serif';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const fmtE = (v, d = 2) => {
  if (!isFinite(v)) return '—';
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= -2 && e < 4) return v.toFixed(Math.max(0, d - Math.max(0, e)));
  return `${(v / 10 ** e).toFixed(d - 1)} × 10${String(e).split('').map(c => SUP[c] ?? c).join('')}`;
};
const km = m => Math.round(m / 1e3).toLocaleString('en');
const MCH = P.massChandra(2).Msun;

// ── chart helper ───────────────────────────────────────────────────────────
function chart(cv, draw) {
  const ctx = cv.getContext('2d');
  let queued = false;
  const redraw = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (r.width < 20 || r.height < 20) return;          // hidden or not laid out
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      draw(ctx, r.width, r.height);
    });
  };
  new ResizeObserver(redraw).observe(cv);
  return redraw;
}
function axes(ctx, box, xr, yr, o = {}) {
  const lx = o.xlog, ly = o.ylog;
  const fx = v => lx ? Math.log10(v) : v, fy = v => ly ? Math.log10(v) : v;
  const x0 = fx(xr[0]), x1 = fx(xr[1]), y0 = fy(yr[0]), y1 = fy(yr[1]);
  const sx = v => box.x + (fx(v) - x0) / (x1 - x0) * box.w;
  const sy = v => box.y + box.h - (fy(v) - y0) / (y1 - y0) * box.h;
  const ix = px => { const u = x0 + (px - box.x) / box.w * (x1 - x0); return lx ? 10 ** u : u; };
  ctx.save();
  ctx.font = FONT_S; ctx.fillStyle = COL.dim; ctx.lineWidth = 1;
  for (const t of o.xt || []) {
    const X = Math.round(sx(t)) + 0.5; if (X < box.x - 1 || X > box.x + box.w + 1) continue;
    if (o.grid !== false) { ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(X, box.y); ctx.lineTo(X, box.y + box.h); ctx.stroke(); }
    ctx.strokeStyle = COL.axis; ctx.beginPath(); ctx.moveTo(X, box.y + box.h); ctx.lineTo(X, box.y + box.h + 4); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(o.xf ? o.xf(t) : String(t), X, box.y + box.h + 7);
  }
  for (const t of o.yt || []) {
    const Y = Math.round(sy(t)) + 0.5; if (Y < box.y - 1 || Y > box.y + box.h + 1) continue;
    if (o.grid !== false) { ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(box.x, Y); ctx.lineTo(box.x + box.w, Y); ctx.stroke(); }
    ctx.strokeStyle = COL.axis; ctx.beginPath(); ctx.moveTo(box.x - 4, Y); ctx.lineTo(box.x, Y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(o.yf ? o.yf(t) : String(t), box.x - 7, Y);
  }
  // Two axis lines only (left and bottom).
  ctx.strokeStyle = COL.axis;
  ctx.beginPath(); ctx.moveTo(box.x + 0.5, box.y); ctx.lineTo(box.x + 0.5, box.y + box.h + 0.5); ctx.lineTo(box.x + box.w, box.y + box.h + 0.5); ctx.stroke();
  ctx.fillStyle = COL.ink2; ctx.font = FONT_S;
  if (o.xl) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(o.xl, box.x + box.w, box.y + box.h + 22); }
  if (o.yl) { ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(o.yl, box.x - (o.ylx ?? 0), box.y - 8); }
  ctx.restore();
  return { sx, sy, ix };
}
function line(ctx, pts, color, width = 1.5, dash = null) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); let pen = false;
  for (const [x, y] of pts) { if (!isFinite(x) || !isFinite(y)) { pen = false; continue; } if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y); }
  ctx.stroke(); ctx.restore();
}
function text(ctx, s, x, y, color = COL.ink2, align = 'left', base = 'middle', font = FONT_S) {
  ctx.save(); ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y); ctx.restore();
}
function ring(ctx, x, y, r, color, fill = COL.bg) {
  ctx.save(); ctx.fillStyle = fill; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
}
function dot(ctx, x, y, r, color) { ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
function bindRange(id, fn) {
  const el = $(id); if (!el) return () => {};
  const f = () => fn(+el.value);
  el.addEventListener('input', f); f();
  return v => { el.value = v; f(); };
}
const out = (id, html) => { const el = $(id); if (el && el.innerHTML !== html) el.innerHTML = html; };
// Pointer drag on a canvas (horizontal moves; vertical drags still scroll).
function hdrag(cv, fn) {
  let id = null;
  cv.addEventListener('pointerdown', e => { id = e.pointerId; cv.setPointerCapture(id); fn(e.offsetX, e.offsetY); });
  cv.addEventListener('pointermove', e => { if (e.pointerId === id) fn(e.offsetX, e.offsetY); });
  const up = e => { if (e.pointerId === id) id = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}
// Model of mass M from a precomputed curve: interpolate ln x_c in M, then
// solve that one star (fast enough for a drag).
function modelOfMass(curve, M, mue = 2) {
  if (M <= curve[0].M) return P.whiteDwarf(curve[0].xc, mue, { keep: 160 });
  for (let i = 1; i < curve.length; i++) if (curve[i].M >= M) {
    const a = curve[i - 1], b = curve[i], f = (M - a.M) / (b.M - a.M);
    return P.whiteDwarf(Math.exp(Math.log(a.xc) + f * Math.log(b.xc / a.xc)), mue, { keep: 160 });
  }
  return P.whiteDwarf(curve[curve.length - 1].xc, mue, { keep: 160 });
}

// ── hero: the mass-radius curve and the dwarf to scale ────────────────────
// st = { curve, model, trace (0..1, share of the curve drawn; saver) }.
// Wide: plot on the left, the disc on the right. Narrow: plot above.
export function heroLayout(w, h) {
  const wide = w >= 640;
  if (wide) {
    const pw = Math.round(w * 0.62);
    return { wide, plot: { x: 64, y: 26, w: pw - 84, h: h - 26 - 52 }, disc: { x: pw, y: 0, w: w - pw, h } };
  }
  const ph = Math.round(h * 0.6);
  return { wide, plot: { x: 54, y: 26, w: w - 54 - 14, h: ph - 26 - 50 }, disc: { x: 0, y: ph, w, h: h - ph } };
}
// Limb-darkened disc: I(mu) = 1 - 0.6 (1 - mu), colour of a 25,000 K
// photosphere (pale blue-white). One radial gradient sampled from I(mu),
// so the disc has no bands. No blur, no halo.
function dwarfDisc(ctx, cx, cy, r) {
  if (r < 0.6) { dot(ctx, cx, cy, 0.8, '#dfe8ff'); return; }
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (let i = 0; i <= 16; i++) {
    const s = i / 16, mu = Math.sqrt(Math.max(0, 1 - s * s)), I = 1 - 0.6 * (1 - mu);
    g.addColorStop(s, `rgb(${Math.round(205 * I + 20)},${Math.round(220 * I + 18)},${Math.round(255 * I)})`);
  }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
}
export function drawHero(ctx, w, h, st) {
  const L = heroLayout(w, h), b = L.plot, m = st.model;
  const A = axes(ctx, b, [0, 1.6], [0, 20000], { xt: [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6], yt: [0, 5000, 10000, 15000, 20000], yf: v => v ? (v / 1000) + ',000' : '0', xl: 'mass (solar masses)', yl: 'radius (km)', ylx: 52 });
  // n = 1.5 law: what slow electrons alone would give.
  const R1 = P.radiusNR(1), nr = [];
  for (let i = 0; i <= 120; i++) { const M = 0.03 + 1.57 * i / 120; nr.push([A.sx(M), A.sy(R1 * M ** (-1 / 3) / 1e3)]); }
  ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y - 2, b.w + 2, b.h + 4); ctx.clip();
  line(ctx, nr, COL.faint, 1, [4, 4]);
  // The limit.
  line(ctx, [[A.sx(MCH), b.y], [A.sx(MCH), b.y + b.h]], COL.warm, 1, [3, 4]);
  // The exact curve, drawn up to st.trace of its length.
  const C = st.curve, nDraw = Math.max(2, Math.round((st.trace ?? 1) * C.length));
  line(ctx, C.slice(0, nDraw).map(c => [A.sx(c.M), A.sy(c.R / 1e3)]), COL.blue, 2);
  ctx.restore();
  // The label runs along the dashed line, above it, so the line never
  // crosses the text.
  const nrAt = M => [A.sx(M), A.sy(R1 * M ** (-1 / 3) / 1e3)];
  const [ax, ay] = nrAt(1.0), [bx, by] = nrAt(1.4);
  ctx.save(); ctx.translate((ax + bx) / 2, (ay + by) / 2); ctx.rotate(Math.atan2(by - ay, bx - ax));
  text(ctx, 'slow electrons only', 0, -5, COL.dim, 'center', 'bottom'); ctx.restore();
  text(ctx, `${MCH.toFixed(3)}`, A.sx(MCH) + 5, b.y + 6, COL.warm, 'left', 'top');
  // Sirius B, measured.
  const s = P.STARS[0], X = A.sx(s.M), Y = A.sy(s.R * P.K.Rsun / 1e3);
  ctx.save(); ctx.strokeStyle = COL.ink; ctx.lineWidth = 1;
  const ex = (A.sx(s.M + s.dM) - A.sx(s.M - s.dM)) / 2;
  ctx.beginPath(); ctx.moveTo(X - ex, Y); ctx.lineTo(X + ex, Y); ctx.stroke(); ctx.restore();
  dot(ctx, X, Y, 2.5, COL.ink);
  text(ctx, 'Sirius B', X - 8, Y + 12, COL.ink2, 'right', 'top');
  // The chosen star on the curve.
  if (m) ring(ctx, A.sx(m.M), A.sy(m.R / 1e3), 5.5, COL.blue);

  // Disc panel: the dwarf and the Earth, same scale.
  const d = L.disc, cx = d.x + d.w / 2, cy = d.y + d.h * (L.wide ? 0.42 : 0.38);
  const room = Math.min(d.w * 0.4, d.h * (L.wide ? 0.32 : 0.3));
  const R = m ? m.R : 0, Re = P.K.Rearth, sc = room / Math.max(R, Re);
  ctx.save(); ctx.strokeStyle = COL.faint; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(cx, cy, Re * sc, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  dwarfDisc(ctx, cx, cy, R * sc);
  text(ctx, 'Earth, outline', cx, cy - Re * sc - 8, COL.dim, 'center', 'bottom');
  if (m) text(ctx, `${m.M.toFixed(3)} M☉ · radius ${km(m.R)} km`, cx, cy + room + 20, COL.ink, 'center', 'middle', FONT);
  // Scale bar under the label: 1,000 or 5,000 km, whichever fits.
  const len = 5e6 * sc > d.w * 0.5 ? 1e6 : 5e6, bar = len * sc;
  if (bar > 6) {
    const bx = cx - bar / 2, by = cy + room + 48;
    ctx.save(); ctx.strokeStyle = COL.dim; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(bx, by - 3); ctx.lineTo(bx, by); ctx.lineTo(bx + bar, by); ctx.lineTo(bx + bar, by - 3); ctx.stroke(); ctx.restore();
    text(ctx, (len / 1e3).toLocaleString('en') + ' km', cx, by + 5, COL.dim, 'center', 'top');
  }
  return A;
}
export function initHero() {
  const cv = $('heroCv'); if (!cv) return null;
  const st = { curve: P.massRadiusCurve(2, { n: 160, x0: 0.04, x1: 4000 }), model: null };
  const draw = chart(cv, (ctx, w, h) => drawHero(ctx, w, h, st));
  const set = bindRange('heroM', v => {
    st.model = modelOfMass(st.curve, Math.min(v, MCH * 0.9995));
    const m = st.model;
    $('heroMOut').textContent = `${m.M.toFixed(3)} M☉`;
    out('heroRead', `At ${m.M.toFixed(3)} solar masses the cold model has a radius of <b>${km(m.R)} km</b> (${(m.R / P.K.Rearth).toFixed(2)} Earth radii) and a central density of <b>${fmtE(m.rhoc / 1e3)} g/cm³</b>.` +
      (m.M > 1.3 ? ` It is ${(m.M / MCH * 100).toFixed(1)} % of the limit; the radius falls toward zero.` : ''));
    draw();
  });
  hdrag(cv, px => {
    const r = cv.getBoundingClientRect(), b = heroLayout(r.width, r.height).plot;
    if (px < b.x - 10 || px > b.x + b.w + 10) return;
    set(clamp((px - b.x) / b.w * 1.6, 0.15, MCH * 0.9995).toFixed(4));
  });
  $('heroSirius')?.addEventListener('click', () => set(1.018));
  return st;
}

// ── Fermi sea (section 2) ──────────────────────────────────────────────────
// Left: the box, side proportional to rho^(-1/3), with a fixed set of
// electrons. Right: the p_z = 0 slice of momentum space. Each cell
// (spacing 2 pi hbar / L) holds two electrons; the filled disc has radius
// p_F = hbar (3 pi^2 n)^(1/3). The dashed circle is p = m_e c.
export function initFermi() {
  const cvB = $('fermiBox'), cvP = $('fermiMom');
  if (!cvB || !cvP) return;
  const AX = 5, NR = 5.2;
  const st = { lr: 6.43, x: 1 };
  let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pts = Array.from({ length: 80 }, () => [rnd(), rnd()]);
  const drawBox = chart(cvB, (ctx, w, h) => {
    const side = Math.min(w, h) - 36;
    const L = side * clamp((10 ** (5 - st.lr)) ** (1 / 3) * 2.2, 0.16, 1);
    const x0 = (w - L) / 2, y0 = (h - L) / 2 - 6;
    ctx.strokeStyle = COL.ink2; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(L), Math.round(L));
    for (const [u, v] of pts) dot(ctx, x0 + 3 + u * (L - 6), y0 + 3 + v * (L - 6), 1.6, COL.blue);
    text(ctx, `side ∝ ρ^(−1/3)`, w / 2, h - 8, COL.dim, 'center', 'bottom');
  });
  const drawMom = chart(cvP, (ctx, w, h) => {
    const x = st.x, s = Math.min(w, h) / 2 - 16, cx = w / 2, cy = h / 2 - 4, k = s / AX;
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy); ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s); ctx.stroke();
    const R = x * k, dp = x / NR * k;
    if (dp > 2.2) {
      const n = Math.ceil(s / dp);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const X = cx + i * dp, Y = cy + j * dp;
        if (Math.abs(X - cx) > s || Math.abs(Y - cy) > s) continue;
        if (Math.hypot(i * dp, j * dp) <= R) { dot(ctx, X - 1.3, Y, 1.1, COL.blue); dot(ctx, X + 1.3, Y, 1.1, COL.blue); }
        else dot(ctx, X, Y, 0.7, COL.faint);
      }
    }
    ctx.strokeStyle = COL.blue; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = COL.warm; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, k, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    text(ctx, 'p = mₑc', cx + k * 0.71 + 4, cy - k * 0.71 - 3, COL.warm, 'left', 'bottom');
    text(ctx, `p_F = ${x.toFixed(2)} mₑc`, w / 2, h - 8, COL.blue, 'center', 'bottom');
  });
  bindRange('fermiRho', v => {
    st.lr = v;
    const F = P.fermi(10 ** v * 1e3);
    st.x = F.x;
    $('fermiRhoOut').textContent = `${fmtE(10 ** v)} g/cm³`;
    out('fermiRead', `Electron density ${fmtE(F.n * 1e-6)} per cm³. Fermi momentum ${F.x.toFixed(2)} mₑc, Fermi energy ${(F.EFMeV * 1e3).toFixed(0)} keV, top speed ${F.v.toFixed(2)} c. Pressure ${fmtE(F.P)} Pa, with Γ = ${F.Gamma.toFixed(3)}.`);
    drawBox(); drawMom();
  });
  document.querySelectorAll('[data-fermi]').forEach(b => b.addEventListener('click', () => {
    const el = $('fermiRho'); el.value = b.dataset.fermi; el.dispatchEvent(new Event('input'));
  }));
}

// ── n = 1.5 mass-radius (section 3) ────────────────────────────────────────
export function initPoly() {
  const cv = $('polyCv'); if (!cv) return;
  const st = { M: 0.6, exact: false };
  const R1 = P.radiusNR(1);
  const curve = P.massRadiusCurve(2, { n: 90 });
  const boxOf = (w, h) => ({ x: 60, y: 26, w: w - 60 - 16, h: h - 26 - 46 });
  const draw = chart(cv, (ctx, w, h) => {
    const box = boxOf(w, h);
    const A = axes(ctx, box, [0.05, 2], [1e3, 6e4], { xlog: true, ylog: true, xt: [0.05, 0.1, 0.2, 0.5, 1, 2], yt: [1e3, 2e3, 5e3, 1e4, 2e4, 5e4], yf: v => (v / 1e3) + ',000', xl: 'mass (solar masses, log)', yl: 'radius (km, log)', ylx: 50 });
    line(ctx, [[box.x, A.sy(6371)], [box.x + box.w, A.sy(6371)]], COL.faint, 1, [2, 4]);
    text(ctx, 'Earth', box.x + box.w - 2, A.sy(6371) - 6, COL.dim, 'right', 'bottom');
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    if (st.exact) {
      line(ctx, curve.map(c => [A.sx(c.M), A.sy(c.R / 1e3)]), COL.ink2, 1.2, [5, 4]);
      line(ctx, [[A.sx(MCH), box.y], [A.sx(MCH), box.y + box.h]], COL.warm, 1, [3, 4]);
    }
    const pts = []; for (let i = 0; i <= 80; i++) { const M = 0.05 * 40 ** (i / 80); pts.push([A.sx(M), A.sy(R1 * M ** (-1 / 3) / 1e3)]); }
    line(ctx, pts, COL.blue, 2);
    ctx.restore();
    text(ctx, 'R ∝ M^(−1/3)', A.sx(0.075), A.sy(R1 * 0.075 ** (-1 / 3) / 1e3) - 10, COL.blue, 'left', 'bottom');
    if (st.exact) text(ctx, 'exact (section 5)', A.sx(1.25), A.sy(2600), COL.ink2, 'right', 'middle');
    ring(ctx, A.sx(st.M), A.sy(R1 * st.M ** (-1 / 3) / 1e3), 5.5, COL.blue);
  });
  hdrag(cv, px => { const r = cv.getBoundingClientRect(), b = boxOf(r.width, r.height); setM(clamp(Math.log10(0.05) + (px - b.x) / b.w * Math.log10(40), -1.3, 0.3)); });
  const setM = bindRange('polyM', v => {
    st.M = 10 ** v;
    $('polyMOut').textContent = `${st.M.toFixed(3)} M☉`;
    const Rn = P.radiusNR(st.M), ex = P.dwarfOfMass(st.M);
    out('polyRead', `The slow-electron law gives ${km(Rn)} km. ` + (ex ? `The exact model gives ${km(ex.R)} km, so the law is off by ${((Rn / ex.R - 1) * 100).toFixed(1)} %.` : 'The exact model has no star of this mass.'));
    draw();
  });
  $('polyExact')?.addEventListener('click', e => { st.exact = !st.exact; e.currentTarget.setAttribute('aria-pressed', st.exact); draw(); });
}

// ── electron energy and Gamma (section 4) ──────────────────────────────────
export function initEnergyP() {
  const cv = $('epCv'); if (!cv) return;
  const st = { x: 1 };
  const E = P.eos(2);
  const draw = chart(cv, (ctx, w, h) => {
    const wide = w >= 600;
    const b1 = wide ? { x: 56, y: 26, w: w * 0.55 - 70, h: h - 72 } : { x: 50, y: 26, w: w - 64, h: h * 0.55 - 60 };
    const b2 = wide ? { x: w * 0.55 + 44, y: 26, w: w * 0.45 - 58, h: h - 72 } : { x: 50, y: h * 0.55 + 22, w: w - 64, h: h * 0.45 - 66 };
    const A = axes(ctx, b1, [0, 5], [0, 5], { xt: [0, 1, 2, 3, 4, 5], yt: [0, 1, 2, 3, 4, 5], xl: 'momentum p / mₑc', yl: 'kinetic energy / mₑc²', ylx: 44 });
    const ex = [], nr = [], ur = [];
    for (let i = 0; i <= 200; i++) { const p = 5 * i / 200; ex.push([A.sx(p), A.sy(Math.sqrt(1 + p * p) - 1)]); nr.push([A.sx(p), A.sy(p * p / 2)]); ur.push([A.sx(p), A.sy(p)]); }
    ctx.save(); ctx.beginPath(); ctx.rect(b1.x, b1.y, b1.w, b1.h); ctx.clip();
    line(ctx, nr, COL.faint, 1, [4, 4]); line(ctx, ur, COL.faint, 1, [1.5, 3]); line(ctx, ex, COL.blue, 2);
    ctx.restore();
    text(ctx, 'p²/2mₑ', A.sx(2.85), A.sy(4.4), COL.dim, 'right', 'middle');
    text(ctx, 'pc', A.sx(4.6), A.sy(4.6) - 8, COL.dim, 'right', 'bottom');
    const xs = Math.min(st.x, 5);
    ring(ctx, A.sx(xs), A.sy(Math.sqrt(1 + xs * xs) - 1), 5, COL.blue);
    const B = axes(ctx, b2, [0.01, 100], [1.3, 1.7], { xlog: true, xt: [0.01, 0.1, 1, 10, 100], yt: [4 / 3, 1.5, 5 / 3], yf: v => v > 1.6 ? '5/3' : v < 1.4 ? '4/3' : '1.5', xl: 'p_F / mₑc (log)', yl: 'Γ = d ln P / d ln ρ', ylx: 44 });
    const g = []; for (let i = 0; i <= 160; i++) { const x = 0.01 * 1e4 ** (i / 160); g.push([B.sx(x), B.sy(E.Gamma(x))]); }
    line(ctx, [[b2.x, B.sy(4 / 3)], [b2.x + b2.w, B.sy(4 / 3)]], COL.warm, 1, [3, 4]);
    line(ctx, g, COL.blue, 2);
    const xg = clamp(st.x, 0.01, 100);
    ring(ctx, B.sx(xg), B.sy(E.Gamma(xg)), 5, COL.blue);
  });
  bindRange('epRho', v => {
    const F = P.fermi(10 ** v * 1e3);
    st.x = F.x;
    $('epRhoOut').textContent = `${fmtE(10 ** v)} g/cm³`;
    out('epRead', `p_F = ${F.x.toFixed(2)} mₑc and Γ = ${F.Gamma.toFixed(3)}.`);
    draw();
  });
}

// ── E(R) (section 4) ───────────────────────────────────────────────────────
// E in units of G Msun^2 / R_earth on a symmetric log axis, against log R.
const R0 = 10e3, R1 = 6e7, EU = P.K.G * P.K.Msun ** 2 / P.K.Rearth;
const sl = (v, k = 0.03) => Math.sign(v) * Math.log10(1 + Math.abs(v) / k);
const isl = (y, k = 0.03) => Math.sign(y) * k * (10 ** Math.abs(y) - 1);
export function drawER(ctx, w, h, M, model, o = {}) {
  const box = o.box || { x: 62, y: 26, w: w - 62 - 16, h: h - 26 - 46 };
  const yr = [sl(-200), sl(300)];
  const yt = [-100, -10, -1, 0, 1, 10, 100].map(v => sl(v));
  const A = axes(ctx, box, [R0, R1], yr, { xlog: true, xt: [1e4, 1e5, 1e6, 1e7], xf: v => (v / 1e3).toLocaleString('en') + ' km', yt, yf: y => { const v = isl(y); return Math.abs(v) < 1e-9 ? '0' : v.toFixed(0); }, xl: 'radius R (log)', yl: 'energy (symmetric log scale)', ylx: 54 });
  const kin = [], grav = [], tot = [];
  for (let i = 0; i <= 260; i++) {
    const R = R0 * (R1 / R0) ** (i / 260), e = model.at(M, R);
    kin.push([A.sx(R), A.sy(sl(e.Ek / EU))]); grav.push([A.sx(R), A.sy(sl(e.Eg / EU))]); tot.push([A.sx(R), A.sy(sl(e.E / EU))]);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  line(ctx, [[box.x, A.sy(0)], [box.x + box.w, A.sy(0)]], COL.axis, 1);
  line(ctx, kin, COL.faint, 1, [4, 4]); line(ctx, grav, COL.faint, 1, [1.5, 3]);
  const past = M >= model.Mcrit;
  line(ctx, tot, past ? COL.warm : COL.blue, 2);
  const mn = model.minimum(M);
  if (mn) {
    const X = A.sx(mn.R), Y = A.sy(sl(mn.E / EU));
    ring(ctx, X, Y, 5, COL.blue);
    // A page-colour outline under the label cuts the curve where they
    // cross on a narrow chart (no glow: it is the background colour).
    const s = `minimum at ${km(mn.R)} km`;
    ctx.save(); ctx.font = FONT_S; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = COL.bg; ctx.strokeText(s, X, Y - 10); ctx.restore();
    text(ctx, s, X, Y - 10, COL.blue, 'center', 'bottom');
  } else {
    text(ctx, 'no minimum: the energy keeps falling as R → 0', box.x + box.w * 0.36, A.sy(sl(-0.3)), COL.warm, 'center', 'middle', FONT);
  }
  ctx.restore();
  { const R = 3e6, e = model.at(M, R);
    text(ctx, 'electrons', A.sx(R), A.sy(sl(e.Ek / EU)) - 8, COL.dim, 'left', 'bottom');
    text(ctx, 'gravity', A.sx(R), A.sy(sl(e.Eg / EU)) + 8, COL.dim, 'left', 'top'); }
  return A;
}
export function initER() {
  const cv = $('erCv'); if (!cv) return;
  const st = { M: 1.0, mode: 'profile', model: P.energyModel(2, 'profile') };
  const draw = chart(cv, (ctx, w, h) => drawER(ctx, w, h, st.M, st.model));
  const read = () => {
    const mn = st.model.minimum(st.M);
    out('erRead', `Critical mass of this model: ${st.model.Mcrit.toFixed(3)} M☉. ` + (mn ? `At ${st.M.toFixed(3)} M☉ the minimum is at ${km(mn.R)} km, where p_F = ${mn.x.toFixed(2)} mₑc. The star is stable.` : `At ${st.M.toFixed(3)} M☉ there is no minimum. The star collapses.`));
  };
  bindRange('erM', v => { st.M = v; $('erMOut').textContent = `${v.toFixed(3)} M☉`; read(); draw(); });
  document.querySelectorAll('#erMode button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#erMode button').forEach(q => q.setAttribute('aria-pressed', q === b));
    st.mode = b.dataset.mode; st.model = P.energyModel(2, st.mode); read(); draw();
  }));
}

// ── Lane-Emden (section 5) ─────────────────────────────────────────────────
export function initLE() {
  const cv = $('leCv'); if (!cv) return;
  const ref = [1.5, 3].map(n => ({ n, L: P.laneEmden(n, { keep: 300 }) }));
  const st = { n: 2.25, L: null };
  const draw = chart(cv, (ctx, w, h) => {
    const box = { x: 50, y: 26, w: w - 50 - 16, h: h - 26 - 46 };
    const A = axes(ctx, box, [0, 16], [0, 1], { xt: [0, 2, 4, 6, 8, 10, 12, 14, 16], yt: [0, 0.5, 1], xl: 'ξ (scaled radius)', yl: 'θ (ρ/ρc = θⁿ)', ylx: 40 });
    const put = (L, color, wd, dash) => line(ctx, L.prof.map(([x, y]) => [A.sx(x), A.sy(y)]), color, wd, dash);
    put(ref[0].L, COL.faint, 1, [4, 4]); put(ref[1].L, COL.faint, 1, [1.5, 3]);
    text(ctx, 'n = 1.5', A.sx(ref[0].L.xi1), A.sy(0) - 8, COL.dim, 'center', 'bottom');
    text(ctx, 'n = 3', A.sx(ref[1].L.xi1), A.sy(0) - 8, COL.dim, 'center', 'bottom');
    if (st.L) { put(st.L, COL.blue, 2); ring(ctx, A.sx(Math.min(16, st.L.xi1)), A.sy(0), 4.5, COL.blue); }
  });
  bindRange('leN', v => {
    st.n = v;
    st.L = v < 4.95 ? P.laneEmden(v, { keep: 300, h: v > 4 ? 4e-3 : 1e-3 }) : null;
    $('leNOut').textContent = `n = ${v.toFixed(2)}`;
    out('leRead', st.L ? `Surface at ξ₁ = ${st.L.xi1.toFixed(4)}; ω = ${st.L.omega.toFixed(4)}. ` + (Math.abs(v - 3) < 0.01 ? 'At n = 3 the mass does not depend on the radius.' : `Mass-radius exponent (1 − n)/(3 − n) = ${((1 - v) / (3 - v)).toFixed(3)}.`) : 'At n ≥ 5 there is no surface.');
    draw();
  });
}

// ── composition and structure (section 5) ──────────────────────────────────
// Left: the exact curves for mu_e = 2 and for iron (mu_e = 2.15), with the
// three measured dwarfs. Right: rho/rho_c against r/R for the chosen star,
// between the n = 1.5 and n = 3 profiles.
export function initFull() {
  const cv = $('fullCv'); if (!cv) return;
  const C2 = P.massRadiusCurve(2, { n: 140, x0: 0.05, x1: 3000 });
  const CFe = P.massRadiusCurve(56 / 26, { n: 140, x0: 0.05, x1: 3000 });
  const MFe = P.massChandra(56 / 26).Msun;
  const L15 = P.laneEmden(1.5, { keep: 120 }), L3 = P.laneEmden(3, { keep: 120 });
  const st = { lx: 0.4, iron: false, model: null };
  const layout = (w, h) => {
    const wide = w >= 640;
    return wide
      ? { a: { x: 64, y: 26, w: w * 0.6 - 84, h: h - 72 }, b: { x: w * 0.6 + 40, y: 26, w: w * 0.4 - 56, h: h - 72 } }
      : { a: { x: 56, y: 26, w: w - 72, h: h * 0.58 - 66 }, b: { x: 56, y: h * 0.58 + 22, w: w - 72, h: h * 0.42 - 68 } };
  };
  const draw = chart(cv, (ctx, w, h) => {
    const Lo = layout(w, h), box = Lo.a;
    const A = axes(ctx, box, [0, 1.6], [0, 22000], { xt: [0, 0.4, 0.8, 1.2, 1.6], yt: [0, 10000, 20000], yf: v => v ? (v / 1000) + ',000' : '0', xl: 'mass (solar masses)', yl: 'radius (km)', ylx: 52 });
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    line(ctx, [[A.sx(MCH), box.y], [A.sx(MCH), box.y + box.h]], COL.warm, 1, [3, 4]);
    if (st.iron) {
      line(ctx, CFe.map(c => [A.sx(c.M), A.sy(c.R / 1e3)]), COL.ink2, 1.2, [5, 3]);
      line(ctx, [[A.sx(MFe), box.y], [A.sx(MFe), box.y + box.h]], COL.ink2, 1, [1.5, 3]);
    }
    line(ctx, C2.map(c => [A.sx(c.M), A.sy(c.R / 1e3)]), COL.blue, 2);
    ctx.restore();
    if (st.iron) text(ctx, `iron ${MFe.toFixed(2)}`, A.sx(MFe) - 5, box.y + 6, COL.ink2, 'right', 'top');
    text(ctx, MCH.toFixed(3), A.sx(MCH) + 5, box.y + 6, COL.warm, 'left', 'top');
    for (const s of P.STARS) {
      const X = A.sx(s.M), Y = A.sy(s.R * P.K.Rsun / 1e3);
      const ex = (A.sx(s.M + s.dM) - A.sx(s.M - s.dM)) / 2;
      ctx.save(); ctx.strokeStyle = COL.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X - ex, Y); ctx.lineTo(X + ex, Y); ctx.stroke(); ctx.restore();
      dot(ctx, X, Y, 2.5, COL.ink);
      const up = s.id === 'eri40B';
      text(ctx, s.name, X + (up ? -6 : 6), Y + (up ? -10 : 10), COL.ink2, up ? 'right' : 'left', 'middle');
    }
    if (st.model) ring(ctx, A.sx(st.model.M), A.sy(st.model.R / 1e3), 5.5, COL.blue);
    // Profile.
    const B = axes(ctx, Lo.b, [0, 1], [0, 1], { xt: [0, 0.5, 1], yt: [0, 0.5, 1], xl: 'r / R', yl: 'ρ / ρc', ylx: 40 });
    line(ctx, L15.prof.map(([x, y]) => [B.sx(x / L15.xi1), B.sy(Math.max(0, y) ** 1.5)]), COL.faint, 1, [4, 4]);
    line(ctx, L3.prof.map(([x, y]) => [B.sx(x / L3.xi1), B.sy(Math.max(0, y) ** 3)]), COL.faint, 1, [1.5, 3]);
    if (st.model) line(ctx, st.model.prof.map(p => [B.sx(p.s), B.sy(p.rho)]), COL.blue, 2);
    text(ctx, 'n = 1.5', B.sx(0.62), B.sy(0.62), COL.dim, 'left', 'bottom');
    text(ctx, 'n = 3', B.sx(0.08), B.sy(0.12), COL.dim, 'left', 'bottom');
  });
  const setX = bindRange('fullX', v => {
    st.lx = v;
    st.model = P.whiteDwarf(10 ** v, st.iron ? 56 / 26 : 2, { keep: 160 });
    const m = st.model;
    $('fullXOut').textContent = `p_F = ${fmtE(10 ** v)} mₑc`;
    out('fullRead', `Central Fermi momentum ${m.xc.toFixed(2)} mₑc: mass ${m.M.toFixed(4)} M☉ (${(m.M / P.massChandra(m.mue).Msun * 100).toFixed(2)} % of the limit), radius ${km(m.R)} km, central density ${fmtE(m.rhoc / 1e3)} g/cm³.`);
    draw();
  });
  $('fullIron')?.addEventListener('click', e => { st.iron = !st.iron; e.currentTarget.setAttribute('aria-pressed', st.iron); setX(st.lx); });
  hdrag(cv, (px, py) => {
    const r = cv.getBoundingClientRect(), a = layout(r.width, r.height).a;
    if (px < a.x || px > a.x + a.w || py > a.y + a.h + 10) return;
    const M = clamp((px - a.x) / a.w * 1.6, 0.05, (st.iron ? MFe : MCH) * 0.9999);
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
    const box = { x: 56, y: 26, w: w - 56 - 16, h: h - 26 - 46 };
    const A = axes(ctx, box, [0, 1.6], [-0.9, 0.5], { xt: [0, 0.4, 0.8, 1.2, 1.6], yt: [-0.8, -0.4, 0, 0.4], yf: v => (v > 0 ? '+' : '') + v.toFixed(1), xl: 'redshift z', yl: 'magnitude difference (fainter up)', ylx: 48 });
    const curve = L => { const pts = []; for (let i = 1; i <= 80; i++) { const z = 1.6 * i / 80; pts.push([A.sx(z), A.sy(P.distanceModulus(z, L) - P.distanceModulusEmpty(z))]); } return pts; };
    line(ctx, [[box.x, A.sy(0)], [box.x + box.w, A.sy(0)]], COL.axis, 1);
    line(ctx, curve(0), COL.faint, 1.2, [4, 4]);
    line(ctx, curve(st.L), COL.blue, 2);
    text(ctx, 'matter only', A.sx(1.55), A.sy(P.distanceModulus(1.55, 0) - P.distanceModulusEmpty(1.55)) - 8, COL.dim, 'right', 'bottom');
    text(ctx, 'empty, coasting', A.sx(1.55), A.sy(0) - 6, COL.dim, 'right', 'bottom');
    const d = P.distanceModulus(0.5, st.L) - P.distanceModulus(0.5, 0);
    ring(ctx, A.sx(0.5), A.sy(P.distanceModulus(0.5, st.L) - P.distanceModulusEmpty(0.5)), 4.5, COL.blue);
    out('hubRead', `With Ω_Λ = ${st.L.toFixed(2)}, a candle at z = 0.5 is ${d.toFixed(2)} magnitudes (${((10 ** (0.4 * d) - 1) * 100).toFixed(0)} %) fainter than in a matter-only universe.`);
  });
  bindRange('hubL', v => { st.L = v; $('hubLOut').textContent = v.toFixed(2); draw(); });
}
