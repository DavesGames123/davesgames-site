// ============================================================================
//  THUNDER ACOUSTICS  ·  render.js — the figure: cross-section and record
// ----------------------------------------------------------------------------
//  Canvas 2D only. One canvas (#fig) holds three panels with axes:
//    (a) the cross-section: p'(x, z, t) or the energy, terrain, buildings,
//        the channel, the microphone, the colour bar
//    (b) p(t) at the microphone (3D model), with the grid trace over it
//    (c) the spectrogram of (b), 20 Hz to 5 kHz, log frequency
//  layout() gives the panel rectangles in CSS pixels; main.js maps the
//  pointer with toWorld() / toScreen().
//
//  grep -n: "export function layout"  "export function divColor"
//           "export function drawField"  "export function drawScene"
//           "export function drawRecord"  "export function spectrogram"
//           "export function drawProfile"
// ============================================================================
import { fft } from './fft.js';
import { surfaceAt } from './scene.js';

export const FONT = "11px Inter, system-ui, sans-serif";
export const MONO = "10.5px ui-monospace, 'SF Mono', Menlo, monospace";
const INK = '#d8dee6', DIM = '#7d8995', GRID = 'rgba(150,180,210,0.10)', AX = 'rgba(150,180,210,0.35)';

// Panel rectangles. box = the free area {x, y, w, h}; W, H the domain (m).
export function layout(box, W, H, compact) {
  const ml = compact ? 34 : 50, mr = compact ? 10 : 70, mt = compact ? 22 : 30, mb = compact ? 28 : 36;
  const gap = compact ? 30 : 40;
  const recMin = compact ? 150 : 190;
  const availW = box.w - ml - mr;
  let s = availW / W, fh = H * s;
  const maxFh = box.h - mt - mb - gap - recMin - 26;
  if (fh > maxFh) { s = Math.max(1e-6, maxFh / H); fh = H * s; }
  const fw = W * s;
  const field = { x: box.x + ml + (availW - fw) / 2, y: box.y + mt, w: fw, h: fh, s };
  const ry = field.y + fh + mb + gap * 0.4;
  const rh = Math.max(80, box.y + box.h - ry - (compact ? 26 : 32));
  const rec = { x: box.x + ml, y: ry, w: availW, h: rh * 0.5 - 8 };
  const spec = { x: box.x + ml, y: ry + rh * 0.5 + 8, w: availW, h: rh * 0.5 - 8 };
  return { field, rec, spec, compact };
}
export const toScreen = (L, x, z) => [L.field.x + x * L.field.s, L.field.y + L.field.h - z * L.field.s];
export const toWorld = (L, px, py) => [(px - L.field.x) / L.field.s, (L.field.y + L.field.h - py) / L.field.s];

// Diverging map for p': blue below 0, black at 0, amber above.
export function divColor(v, out, o) {
  const a = Math.max(-1, Math.min(1, v)), m = Math.sqrt(Math.abs(a));
  if (a >= 0) { out[o] = 8 + 247 * m; out[o + 1] = 10 + 160 * m * m + 20 * m; out[o + 2] = 14 + 60 * m * m * m; }
  else { out[o] = 8 + 60 * m * m * m; out[o + 1] = 10 + 150 * m * m + 20 * m; out[o + 2] = 14 + 241 * m; }
  out[o + 3] = 255;
}
// Sequential map for the energy (log), black to violet to white.
export function seqColor(v, out, o) {
  const a = Math.max(0, Math.min(1, v));
  out[o] = 6 + 249 * Math.min(1, a * 1.25); out[o + 1] = 8 + 247 * a * a * a; out[o + 2] = 16 + 239 * Math.min(1, Math.sqrt(a) * 1.15); out[o + 3] = 255;
}

let off = null, offCtx = null, img = null;
// Paint the grid into an offscreen canvas and draw it into the field panel.
//   view 'p' or 'e'; gain multiplies p (spreading compensation).
export function drawField(ctx, L, g, view, gain, ref) {
  const { nx, nz, p, e, solid } = g;
  if (!off || off.width !== nx || off.height !== nz) {
    off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(nx, nz) : Object.assign(document.createElement('canvas'), { width: nx, height: nz });
    offCtx = off.getContext('2d'); img = offCtx.createImageData(nx, nz);
  }
  const d = img.data, inv = gain / ref;
  const le = Math.log10(ref * ref / (gain * gain) * 1e-4), span = 4.2;
  for (let k = 0; k < nz; k++) {
    const row = (nz - 1 - k) * nx;
    for (let i = 0; i < nx; i++) {
      const j = i + k * nx, o = (row + i) * 4;
      if (solid[j]) { d[o] = 16; d[o + 1] = 19; d[o + 2] = 24; d[o + 3] = 255; continue; }
      if (view === 'e') { const v = e[j] > 0 ? (Math.log10(e[j] * 0.02) - le) / span : 0; seqColor(v, d, o); }
      else divColor(p[j] * inv, d, o);
    }
  }
  offCtx.putImageData(img, 0, 0);
  const F = L.field;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, F.x, F.y, F.w, F.h);
}

function ticks(lo, hi, want) {
  const span = hi - lo, raw = span / want, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const st = [1, 2, 5, 10].map(m => m * mag).find(m => m >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toFixed(10));
  return out;
}

// Axes, terrain outline, buildings, channel, microphone, colour bar.
export function drawScene(ctx, L, S) {
  const F = L.field, sc = S.sc, c = L.compact;
  ctx.save();
  // terrain and buildings (drawn over the grid image so the edge is crisp)
  ctx.beginPath();
  ctx.moveTo(F.x, F.y + F.h);
  for (let x = 0; x <= sc.W; x += 20) { const [px, py] = toScreen(L, x, surfaceAt(sc, x)); ctx.lineTo(px, py); }
  ctx.lineTo(F.x + F.w, F.y + F.h); ctx.closePath();
  ctx.fillStyle = '#12161c'; ctx.fill();
  ctx.strokeStyle = 'rgba(200,214,228,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  // grid lines and frame
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  const xt = ticks(0, sc.W / 1000, c ? 4 : 8), zt = ticks(0, sc.H / 1000, c ? 3 : 6);
  ctx.beginPath();
  for (const v of xt) { const px = Math.round(F.x + v * 1000 * F.s) + 0.5; ctx.moveTo(px, F.y); ctx.lineTo(px, F.y + F.h); }
  for (const v of zt) { const py = Math.round(F.y + F.h - v * 1000 * F.s) + 0.5; ctx.moveTo(F.x, py); ctx.lineTo(F.x + F.w, py); }
  ctx.stroke();
  ctx.strokeStyle = AX; ctx.strokeRect(Math.round(F.x) + 0.5, Math.round(F.y) + 0.5, Math.round(F.w), Math.round(F.h));
  ctx.fillStyle = DIM; ctx.font = MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of xt) ctx.fillText(String(v), F.x + v * 1000 * F.s, F.y + F.h + 5);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of zt) ctx.fillText(String(v), F.x - 6, F.y + F.h - v * 1000 * F.s);
  ctx.font = FONT; ctx.fillStyle = DIM; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('range x (km)', F.x + F.w / 2, F.y + F.h + (c ? 16 : 19));
  ctx.save(); ctx.translate(F.x - (c ? 26 : 36), F.y + F.h / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'bottom'; ctx.fillText('height z (km)', 0, 0); ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = INK;
  ctx.fillText(S.view === 'e' ? '(a)  acoustic energy, log scale' : '(a)  overpressure p′(x, z, t)', F.x, F.y - 7);
  ctx.textAlign = 'right'; ctx.fillStyle = DIM; ctx.font = MONO;
  ctx.fillText('t = ' + S.t.toFixed(2) + ' s', F.x + F.w, F.y - 7);

  // buildings outline
  ctx.strokeStyle = 'rgba(200,214,228,0.45)';
  for (const b of sc.buildings) {
    const [x0, y0] = toScreen(L, b.x - b.w / 2, b.base + b.h), [x1, y1] = toScreen(L, b.x + b.w / 2, b.base);
    ctx.fillStyle = '#171c23'; ctx.fillRect(x0, y0, Math.max(1, x1 - x0), y1 - y0);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0 - 1), y1 - y0 - 1);
  }

  // clip the overlays to the field panel
  ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
  // the channel: bright at the flash, then a thin trace
  const segs = S.channel ? S.channel.segs : [];
  const flash = S.running || S.t > 0 ? Math.max(0, 1 - S.t / 0.6) : 0;
  if (segs.length) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let pass = 0; pass < (flash > 0 ? 2 : 1); pass++) {
      for (let o = 2; o >= 0; o--) {
        ctx.beginPath();
        for (const s of segs) {
          if (s.order !== o) continue;
          const [a, b] = toScreen(L, s.x0, s.z0), [c2, d] = toScreen(L, s.x1, s.z1);
          ctx.moveTo(a, b); ctx.lineTo(c2, d);
        }
        const al = o === 0 ? 1 : o === 1 ? 0.6 : 0.4;
        if (pass === 0 && flash > 0) { ctx.strokeStyle = `rgba(170,190,255,${0.35 * flash * al})`; ctx.lineWidth = (o === 0 ? 7 : 4); }
        else { ctx.strokeStyle = flash > 0 ? `rgba(245,248,255,${al})` : `rgba(196,206,255,${0.75 * al})`; ctx.lineWidth = o === 0 ? 1.4 : 0.9; }
        ctx.stroke();
      }
    }
  }
  // stroke being drawn
  if (S.drawing && S.drawing.length > 1) {
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(220,228,255,0.8)'; ctx.lineWidth = 1.2; ctx.beginPath();
    S.drawing.forEach(([x, z], i) => { const [a, b] = toScreen(L, x, z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  // ray to the nearest point of the channel, with the distance
  const M = S.mic, [mx, my] = toScreen(L, M[0], M[1]);
  if (S.synth && S.nearest) {
    const [nx, ny] = toScreen(L, S.nearest[0], S.nearest[1]);
    ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(134,220,124,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(nx, ny); ctx.stroke(); ctx.setLineDash([]);
    // the first-arrival front: a circle of radius c0 t around the nearest point
    if (S.t > 0 && S.showFront) {
      const r = S.synth.c0 * S.t * F.s;
      ctx.strokeStyle = 'rgba(134,220,124,0.35)'; ctx.beginPath(); ctx.arc(nx, ny, r, 0, 2 * Math.PI); ctx.stroke();
    }
    if (!c) {
      ctx.fillStyle = '#86dc7c'; ctx.font = MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('r_min ' + (S.synth.rMin / 1000).toFixed(2) + ' km', (mx + nx) / 2 + 8, (my + ny) / 2);
    }
  }
  // the microphone
  ctx.fillStyle = '#ffd666'; ctx.strokeStyle = '#05070a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(mx, my - 2); ctx.lineTo(mx - 6, my - 14); ctx.lineTo(mx + 6, my - 14); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(mx, my - 16, 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.font = FONT; ctx.fillStyle = '#ffd666'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('M', mx + 8, my - 10);
  // the brush ring
  if (S.hover && (S.tool === 'raise' || S.tool === 'lower')) {
    const [hx, hy] = toScreen(L, S.hover[0], surfaceAt(sc, S.hover[0]));
    ctx.strokeStyle = S.tool === 'raise' ? 'rgba(134,220,124,0.8)' : 'rgba(255,154,98,0.8)';
    ctx.beginPath(); ctx.arc(hx, hy, 500 * F.s, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.restore();

  // colour bar
  if (!c) {
    const bx = F.x + F.w + 18, by = F.y + 4, bh = Math.min(160, F.h - 8), bw = 9;
    const tmp = new Uint8ClampedArray(4);
    for (let y = 0; y < bh; y++) {
      const v = 1 - 2 * y / (bh - 1);
      if (S.view === 'e') seqColor(1 - y / (bh - 1), tmp, 0); else divColor(v, tmp, 0);
      ctx.fillStyle = `rgb(${tmp[0]},${tmp[1]},${tmp[2]})`; ctx.fillRect(bx, by + y, bw, 1);
    }
    ctx.strokeStyle = AX; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = DIM; ctx.font = MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (S.view === 'e') { ctx.fillText('high', bx + bw + 4, by + 4); ctx.fillText('−42 dB', bx + bw + 4, by + bh - 4); }
    else { ctx.fillText('+1', bx + bw + 4, by + 3); ctx.fillText('0', bx + bw + 4, by + bh / 2); ctx.fillText('−1', bx + bw + 4, by + bh - 3); }
    ctx.save(); ctx.translate(bx + bw + 4, by + bh + 12); ctx.textBaseline = 'top'; ctx.fillText(S.view === 'e' ? '⟨p′²⟩' : 'p′ / p_ref', 0, 0); ctx.restore();
  }
}

// The spectrogram of a signal into an offscreen canvas (cols x rows).
export function spectrogram(sig, fs, { nfft = 2048, hop = 512, rows = 140, fLo = 20, fHi = 5000, range = 60 } = {}) {
  const cols = Math.max(1, Math.floor((sig.length - nfft) / hop) + 1);
  const re = new Float64Array(nfft), im = new Float64Array(nfft), win = new Float64Array(nfft);
  for (let i = 0; i < nfft; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (nfft - 1));
  const db = new Float32Array(cols * rows);
  const bins = new Int32Array(rows + 1);
  for (let r = 0; r <= rows; r++) bins[r] = Math.round(fLo * Math.pow(fHi / fLo, r / rows) * nfft / fs);
  let mx = -Infinity;
  for (let c = 0; c < cols; c++) {
    const o = c * hop;
    for (let i = 0; i < nfft; i++) { re[i] = (sig[o + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let r = 0; r < rows; r++) {
      let s = 0, n = 0;
      for (let b = bins[r]; b <= Math.max(bins[r], bins[r + 1] - 1); b++) { s += re[b] * re[b] + im[b] * im[b]; n++; }
      const v = 10 * Math.log10(s / n + 1e-30);
      db[c * rows + r] = v; if (v > mx) mx = v;
    }
  }
  return { db, cols, rows, max: mx, range, hop, nfft, fs, fLo, fHi };
}
let specCanvas = null, specFor = null;
function specImage(sp) {
  if (specFor === sp) return specCanvas;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(sp.cols, sp.rows) : Object.assign(document.createElement('canvas'), { width: sp.cols, height: sp.rows });
  const cx = cv.getContext('2d'), im = cx.createImageData(sp.cols, sp.rows), d = im.data;
  for (let c = 0; c < sp.cols; c++) for (let r = 0; r < sp.rows; r++) {
    const v = (sp.db[c * sp.rows + r] - sp.max + sp.range) / sp.range;
    seqColor(v, d, ((sp.rows - 1 - r) * sp.cols + c) * 4);
  }
  cx.putImageData(im, 0, 0);
  specCanvas = cv; specFor = sp;
  return cv;
}

// (b) the waveform and (c) the spectrogram, with a shared time axis.
export function drawRecord(ctx, L, S) {
  const R = L.rec, P = L.spec, sy = S.synth, c = L.compact;
  const T = sy ? sy.dur : 20;
  const tx = t => R.x + t / T * R.w;
  ctx.save();
  ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = INK;
  ctx.fillText('(b)  p(t) at M, 3D model' + (S.showGrid ? '  ·  grid trace (low-pass, scaled)' : ''), R.x, R.y - 6);
  ctx.fillText('(c)  spectrogram of (b)', P.x, P.y - 6);
  for (const B of [R, P]) { ctx.strokeStyle = AX; ctx.strokeRect(Math.round(B.x) + 0.5, Math.round(B.y) + 0.5, Math.round(B.w), Math.round(B.h)); }
  const tt = ticks(0, T, c ? 5 : 10);
  ctx.strokeStyle = GRID; ctx.beginPath();
  for (const v of tt) { const x = Math.round(tx(v)) + 0.5; ctx.moveTo(x, R.y); ctx.lineTo(x, R.y + R.h); ctx.moveTo(x, P.y); ctx.lineTo(x, P.y + P.h); }
  ctx.stroke();
  ctx.fillStyle = DIM; ctx.font = MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of tt) ctx.fillText(String(v), tx(v), P.y + P.h + 5);
  ctx.font = FONT; ctx.fillText('time since the flash (s)', P.x + P.w / 2, P.y + P.h + (c ? 15 : 18));
  if (sy) {
    // waveform: min/max per pixel column
    const sig = sy.signal, n = sig.length, cols = Math.max(1, Math.floor(R.w));
    const amp = Math.max(sy.peak, 1e-6) * 1.08, mid = R.y + R.h / 2;
    ctx.strokeStyle = '#ffd666'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x < cols; x++) {
      const a = Math.floor(x / cols * n), b = Math.min(n, Math.floor((x + 1) / cols * n));
      let lo = 0, hi = 0;
      for (let i = a; i < b; i++) { const v = sig[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      ctx.moveTo(R.x + x + 0.5, mid - hi / amp * R.h / 2); ctx.lineTo(R.x + x + 0.5, mid - lo / amp * R.h / 2 + 0.5);
    }
    ctx.stroke();
    // grid trace, scaled to the same peak
    if (S.showGrid && S.trace && S.trace.n > 2) {
      const tr = S.trace; let pk = 1e-12;
      for (let i = 0; i < tr.n; i++) pk = Math.max(pk, Math.abs(tr.v[i]));
      ctx.strokeStyle = 'rgba(98,196,255,0.85)'; ctx.lineWidth = 1.3; ctx.beginPath();
      for (let i = 0; i < tr.n; i++) { const x = tx(tr.t[i]), y = mid - tr.v[i] / pk * 0.9 * R.h / 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = DIM; ctx.font = MONO; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const pl = amp >= 10 ? amp.toFixed(0) : amp >= 1 ? amp.toFixed(1) : amp.toFixed(2);
    ctx.fillText('+' + pl, R.x - 4, R.y + 6); ctx.fillText('0', R.x - 4, mid); ctx.fillText('−' + pl, R.x - 4, R.y + R.h - 6);
    if (!c) { ctx.save(); ctx.translate(R.x - 40, mid); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.font = FONT; ctx.fillText('Pa', 0, 0); ctx.restore(); }
    // arrival markers
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(134,220,124,0.8)';
    for (const t of [sy.tFirst, sy.tLast]) { if (!isFinite(t)) continue; const x = Math.round(tx(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, R.y); ctx.lineTo(x, R.y + R.h); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = '#86dc7c'; ctx.font = MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    if (isFinite(sy.tFirst)) ctx.fillText('first ' + sy.tFirst.toFixed(1) + ' s', tx(sy.tFirst) + 4, R.y + 3);
    // spectrogram
    if (S.spec) {
      const sp = S.spec, cv = specImage(sp);
      const t0 = sp.nfft / 2 / sp.fs, t1 = t0 + (sp.cols - 1) * sp.hop / sp.fs;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cv, tx(t0), P.y + 1, tx(t1) - tx(t0), P.h - 2);
      ctx.fillStyle = DIM; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const f of [50, 200, 1000, 5000]) {
        const y = P.y + P.h - Math.log(f / sp.fLo) / Math.log(sp.fHi / sp.fLo) * P.h;
        if (y < P.y - 1) continue;
        ctx.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), P.x - 4, Math.max(P.y + 5, y));
      }
      if (!c) { ctx.save(); ctx.translate(P.x - 40, P.y + P.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.font = FONT; ctx.fillText('Hz', 0, 0); ctx.restore(); }
      // f_m marker
      const ym = P.y + P.h - Math.log(sy.fm / sp.fLo) / Math.log(sp.fHi / sp.fLo) * P.h;
      ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,154,98,0.7)'; ctx.beginPath(); ctx.moveTo(P.x, ym); ctx.lineTo(P.x + P.w, ym); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ff9a62'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText('f_m ' + sy.fm.toFixed(0) + ' Hz', P.x + P.w - 4, ym - 2);
    }
  } else {
    ctx.fillStyle = DIM; ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Draw a channel or press Strike.', R.x + R.w / 2, R.y + R.h / 2);
  }
  // the time cursor
  if (S.t > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
    const x = Math.round(tx(Math.min(S.t, T))) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, R.y); ctx.lineTo(x, R.y + R.h); ctx.moveTo(x, P.y); ctx.lineTo(x, P.y + P.h); ctx.stroke();
  }
  ctx.restore();
}

// The sound-speed profile c(z) for the panel.
export function drawProfile(cv, cOf, H, dpr) {
  const w = cv.clientWidth || 280, h = cv.clientHeight || 120;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const zs = [], cs = [];
  for (let i = 0; i <= 60; i++) { const z = H * i / 60; zs.push(z); cs.push(cOf(z)); }
  const lo = Math.min(...cs) - 2, hi = Math.max(...cs) + 2;
  const x = c => 36 + (c - lo) / (hi - lo) * (w - 48), y = z => h - 20 - z / H * (h - 30);
  ctx.strokeStyle = AX; ctx.strokeRect(36.5, 10.5, w - 48, h - 30);
  ctx.strokeStyle = '#62c4ff'; ctx.lineWidth = 1.5; ctx.beginPath();
  zs.forEach((z, i) => { i ? ctx.lineTo(x(cs[i]), y(z)) : ctx.moveTo(x(cs[i]), y(z)); }); ctx.stroke();
  ctx.fillStyle = DIM; ctx.font = MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(lo.toFixed(0), 36, h - 17); ctx.fillText(hi.toFixed(0) + ' m/s', w - 22, h - 17);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('0', 32, h - 20); ctx.fillText((H / 1000).toFixed(0) + ' km', 32, 14);
}
