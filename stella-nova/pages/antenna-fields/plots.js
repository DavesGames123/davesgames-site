// ============================================================================
//  ANTENNA FIELDS  ·  plots.js — the pattern cut in the Details drawer
// ----------------------------------------------------------------------------
//  2D canvas drawing only. main.js gives the numbers.
//    drawPolar(canvas, { side?, top?, sideX, upLabel, beam? })
//        side, top: U over 0..2pi in the xz plane (angle from +x toward +z)
//        or in the xy plane (from +x toward +y). The screen angle is the
//        same as in the field view: x to the right, z or y up. Scale: dB
//        from 0 to -30, normalised to the maximum.
//  grep -n: "export function drawPolar"
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
