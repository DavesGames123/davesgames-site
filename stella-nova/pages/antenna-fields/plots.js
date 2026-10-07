// ============================================================================
//  ANTENNA FIELDS  ·  plots.js — polar pattern cuts and the impedance sweep
// ----------------------------------------------------------------------------
//  2D canvas drawing only. main.js gives the numbers.
//    drawPolar(canvas, { side, top, sideLabel, topLabel, beam })
//        side, top: U over 0..2pi in the xz plane (angle from +x toward +z)
//        and in the xy plane (from +x toward +y). The screen angle is the
//        same as in the field view: x to the right, z or y up. Scale: dB
//        from 0 to -30, normalised to the larger maximum of the two cuts.
//    drawSweep(canvas, { xs, R, X, xLabel, mark, title })
//        R (warm) and X (cool) against xs; a vertical line at mark.
//  grep -n: "export function drawPolar"  "export function drawSweep"
// ============================================================================

function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), r = canvas.getBoundingClientRect();
  const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w, h, dpr };
}
const FONT = 'Inter, system-ui, sans-serif';

export function drawPolar(canvas, d) {
  const { w, h, dpr } = fit(canvas), ctx = canvas.getContext('2d');
  if (!ctx) return;   // the page is being torn down
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 18 * dpr;
  // rings: 0, -10, -20, -30 dB
  ctx.strokeStyle = 'rgba(140,170,200,0.16)'; ctx.lineWidth = 1 * dpr;
  ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = 'rgba(160,175,195,0.7)';
  for (let k = 0; k <= 3; k++) {
    const r = R * (1 - k / 3);
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.5, r), 0, 2 * Math.PI); ctx.stroke();
    if (k < 3) ctx.fillText(k ? -10 * k + ' dB' : '0 dB', cx + 3 * dpr, cy - r + 11 * dpr);
  }
  for (let a = 0; a < 360; a += 30) {
    const t = a * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(t), cy - R * Math.sin(t)); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [a, lab] of [[0, d.sideX || 'x'], [90, d.upLabel || 'z / y'], [180, ''], [270, '']]) {
    if (!lab) continue;
    const t = a * Math.PI / 180;
    ctx.fillText(lab, cx + (R + 10 * dpr) * Math.cos(t), cy - (R + 10 * dpr) * Math.sin(t));
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let umax = 1e-30;
  for (const c of [d.side, d.top]) if (c) for (const u of c) umax = Math.max(umax, u);
  const curve = (U, col, fill) => {
    if (!U) return;
    const n = U.length;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const u = U[i % n], db = 10 * Math.log10(Math.max(u / umax, 1e-6)), r = R * Math.max(0, 1 + db / 30), t = 2 * Math.PI * i / n;
      const x = cx + r * Math.cos(t), y = cy - r * Math.sin(t);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.8 * dpr; ctx.stroke();
  };
  curve(d.side, '#60e0ee', 'rgba(96,224,238,0.07)');
  curve(d.top, '#ffb478', 'rgba(255,180,120,0.07)');
  if (d.beam) {
    ctx.strokeStyle = 'rgba(255,214,102,0.8)'; ctx.setLineDash([3 * dpr, 4 * dpr]); ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(d.beam), cy - R * Math.sin(d.beam)); ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function drawSweep(canvas, d) {
  const { w, h, dpr } = fit(canvas), ctx = canvas.getContext('2d');
  if (!ctx) return;   // the page is being torn down
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const L = 40 * dpr, Rr = 10 * dpr, T = 10 * dpr, B = 26 * dpr, pw = w - L - Rr, ph = h - T - B;
  if (!d || !d.xs || d.xs.length < 2) {
    ctx.fillStyle = 'rgba(160,175,195,0.7)'; ctx.font = `${11 * dpr}px ${FONT}`;
    ctx.fillText(d && d.msg ? d.msg : 'computing…', L, T + ph / 2);
    return;
  }
  const xs = d.xs, x0 = xs[0], x1 = xs[xs.length - 1];
  let lo = Infinity, hi = -Infinity;
  for (const arr of [d.R, d.X]) for (const v of arr) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  lo = Math.max(lo, d.clipLo ?? -800); hi = Math.min(hi, d.clipHi ?? 1200);
  if (!(hi > lo)) { lo = -1; hi = 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const X = x => L + (x - x0) / (x1 - x0) * pw, Y = v => T + (hi - Math.max(lo, Math.min(hi, v))) / (hi - lo) * ph;
  ctx.strokeStyle = 'rgba(140,170,200,0.16)'; ctx.lineWidth = 1 * dpr;
  ctx.font = `${10 * dpr}px ${FONT}`; ctx.fillStyle = 'rgba(160,175,195,0.75)';
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + pw, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(fmt(v), L - 4 * dpr, Y(v) + 3 * dpr);
  }
  if (lo < 0 && hi > 0) { ctx.strokeStyle = 'rgba(200,210,222,0.35)'; ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(L + pw, Y(0)); ctx.stroke(); }
  const xstep = niceStep((x1 - x0) / 4);
  ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(140,170,200,0.16)';
  for (let x = Math.ceil(x0 / xstep) * xstep; x <= x1 + 1e-9; x += xstep) {
    ctx.beginPath(); ctx.moveTo(X(x), T); ctx.lineTo(X(x), T + ph); ctx.stroke();
    ctx.fillText(fmt(x), X(x), T + ph + 13 * dpr);
  }
  ctx.fillText(d.xLabel || '', L + pw / 2, h - 2 * dpr);
  ctx.textAlign = 'left';
  const line = (arr, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.7 * dpr; ctx.beginPath();
    let pen = false;
    arr.forEach((v, i) => {
      if (!isFinite(v)) { pen = false; return; }
      const px = X(xs[i]), py = Y(v);
      pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true;
    });
    ctx.stroke();
  };
  line(d.R, '#ffb478');
  line(d.X, '#60e0ee');
  if (d.mark != null && d.mark >= x0 && d.mark <= x1) {
    ctx.strokeStyle = 'rgba(255,214,102,0.85)'; ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.moveTo(X(d.mark), T); ctx.lineTo(X(d.mark), T + ph); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.font = `${10.5 * dpr}px ${FONT}`;
  ctx.fillStyle = '#ffb478'; ctx.fillText('R', L + 6 * dpr, T + 12 * dpr);
  ctx.fillStyle = '#60e0ee'; ctx.fillText('X', L + 20 * dpr, T + 12 * dpr);
  ctx.fillStyle = 'rgba(160,175,195,0.75)'; ctx.fillText('Ω', L + 34 * dpr, T + 12 * dpr);
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); return [1, 2, 5, 10].map(q => q * p).find(q => q >= x) || 10 * p; }
function fmt(v) { const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2); }
