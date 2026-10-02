// ============================================================================
//  CHLADNI PLATE  ·  curve.js — the frequency response chart (2D canvas)
// ----------------------------------------------------------------------------
//  x: frequency on a log scale. y: the peak acceleration on the plate, in g,
//  on a log scale. A dashed line marks 1 g: above it the sand lifts. Each
//  peak is a mode, with its number. The marker is the drive frequency. A
//  drag on the chart sets the frequency (onPick).
//
//  grep -n targets
//    draw .......... "function draw"
//    pointer ....... "pointerdown"
// ============================================================================
export function makeCurve(canvas, onPick) {
  const ctx = canvas.getContext('2d');
  let data = null, cur = 0, peaks = [], marks = {}, dpr = 1, W = 0, H = 0;
  const pad = { l: 34, r: 10, t: 16, b: 18 };
  const C = {
    set(d, p, m) { data = d; peaks = p || []; marks = m || {}; draw(); },
    cursor(f) { cur = f; draw(); },
    resize,
  };
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    draw();
  }
  const fx = f => pad.l + (W - pad.l - pad.r) * Math.log(f / data.F[0]) / Math.log(data.F[data.F.length - 1] / data.F[0]);
  const ylo = 0.05;
  let yhi = 100;
  const fy = a => pad.t + (H - pad.t - pad.b) * (1 - Math.log(Math.max(a, ylo) / ylo) / Math.log(yhi / ylo));
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!data || W < 40) return;
    let mx = 0; for (const a of data.A) mx = Math.max(mx, a);
    yhi = Math.max(4, mx * 1.6);
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    // grid: decades of g, and frequency ticks
    ctx.strokeStyle = 'rgba(232,213,169,0.07)'; ctx.fillStyle = 'rgba(200,190,170,0.55)'; ctx.lineWidth = 1;
    for (const g of [0.1, 1, 10, 100]) {
      if (g > yhi) break;
      const y = Math.round(fy(g)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(g + ' g', pad.l - 4, y);
    }
    const f0 = data.F[0], f1 = data.F[data.F.length - 1];
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const base of [10, 100, 1000, 10000]) for (const m of [1, 2, 5]) {
      const f = base * m; if (f < f0 || f > f1) continue;
      const x = Math.round(fx(f)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
      ctx.fillText(f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz', x, H - 5);
    }
    // 1 g: the sand lifts above this line
    const y1 = fy(1);
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(240,170,90,0.45)';
    ctx.beginPath(); ctx.moveTo(pad.l, y1); ctx.lineTo(W - pad.r, y1); ctx.stroke(); ctx.setLineDash([]);
    // the curve, filled
    ctx.beginPath();
    for (let q = 0; q < data.F.length; q++) { const x = fx(data.F[q]), y = fy(data.A[q]); if (q) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.strokeStyle = 'rgba(236,214,168,0.92)'; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.lineTo(fx(f1), H - pad.b); ctx.lineTo(fx(f0), H - pad.b); ctx.closePath();
    const gr = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    gr.addColorStop(0, 'rgba(236,214,168,0.20)'); gr.addColorStop(1, 'rgba(236,214,168,0.0)');
    ctx.fillStyle = gr; ctx.fill();
    // mode numbers over the peaks that pass 1 g, others dim
    ctx.textAlign = 'center';
    let lastX = -99;
    for (const p of peaks) {
      if (p.f < f0 || p.f > f1) continue;
      const x = fx(p.f), y = fy(p.a);
      const key = marks[p.n];
      if (x - lastX < 12 && !key) continue;
      lastX = x;
      ctx.fillStyle = key ? 'rgba(255,196,120,0.95)' : p.a > 1 ? 'rgba(232,213,169,0.8)' : 'rgba(232,213,169,0.35)';
      ctx.font = key ? '600 10px Inter, system-ui, sans-serif' : '10px Inter, system-ui, sans-serif';
      ctx.fillText(String(p.n), x, Math.max(10, y - 4));
    }
    // the drive frequency
    if (cur) {
      const x = Math.round(fx(cur)) + 0.5;
      ctx.strokeStyle = 'rgba(255,170,90,0.95)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, pad.t - 4); ctx.lineTo(x, H - pad.b); ctx.stroke();
      let q = 0; while (q < data.F.length - 1 && data.F[q] < cur) q++;
      ctx.fillStyle = '#ffb066';
      ctx.beginPath(); ctx.arc(x, fy(data.A[q]), 3.2, 0, 7); ctx.fill();
    }
  }
  let drag = false;
  const pickAt = e => {
    if (!data) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left;
    const t = Math.min(1, Math.max(0, (x - pad.l) / (W - pad.l - pad.r)));
    onPick(data.F[0] * Math.pow(data.F[data.F.length - 1] / data.F[0], t), e.type === 'pointerup');
  };
  canvas.addEventListener('pointerdown', e => { drag = true; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} pickAt(e); });
  canvas.addEventListener('pointermove', e => { if (drag) pickAt(e); });
  canvas.addEventListener('pointerup', e => { if (drag) pickAt(e); drag = false; });
  canvas.addEventListener('pointercancel', () => { drag = false; });
  return C;
}
