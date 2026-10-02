// ============================================================================
//  STIRLING ENGINE  ·  analysis.js — the P-V loop, the phase plot, the numbers
// ────────────────────────────────────────────────────────────────────────────
//  createAnalysis(els) draws into two 2D canvases and fills the readouts:
//    #pv ..... the P-V loop of one turn (engine.js E.cycle), each stretch in
//              the colour of its process, the area shaded (that area is the
//              work per turn), and a dot that rides the loop with the crank
//    #ph ..... displacer and piston position against crank angle, with the
//              phase gap between their tops marked
//    #gasBar . where the gas is now: mass in the hot space, the regenerator
//              and the cold side
//  The loop is drawn once per change (setCycle) into a cache canvas; each
//  frame only draws the cache and the moving marks.
//
//  GREP MAP
//    function setCycle ....... sample the loop and the phase curves, cache
//    function drawPV / drawPH  the two plots
//    function frame .......... per-frame marks and the readouts
// ============================================================================
import { PROC, D, TAU } from './engine.js';
import { tempCss } from './gas.js';

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function createAnalysis(el) {
  const A = { cyc: null, E: null };
  const cache = { pv: document.createElement('canvas'), ph: document.createElement('canvas') };
  let dpr = 1;

  function size(c) {
    dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(10, c.clientWidth), h = Math.max(10, c.clientHeight);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); return true; }
    return false;
  }
  // plot frame inside a canvas: margins for the axis labels
  const M = { l: 44, r: 10, t: 12, b: 26 };
  let pvMap = null, phMap = null;

  function setCycle(E, cyc, al) {
    A.E = E; A.cyc = cyc; A.al = al;
    // phase curves: displacer and piston positions over one turn
    const N = 180, dp = [], pp = [];
    for (let i = 0; i <= N; i++) { const k = E.kin(i / N * TAU, al); dp.push(k.clevis); pp.push(k.pin); }
    const nrm = a => { const lo = Math.min(...a), hi = Math.max(...a); return a.map(v => (v - lo) / (hi - lo)); };
    A.dp = nrm(dp); A.pp = nrm(pp);
    A.dirty = true;
  }

  function drawPV() {
    const c = el.pv; if (!c.clientWidth) return;
    const changed = size(c);
    const W = c.width / dpr, H = c.height / dpr, cyc = A.cyc;
    if (A.dirty || changed || !pvMap) {
      const cc = cache.pv; cc.width = c.width; cc.height = c.height;
      const g = cc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const vlo = cyc.Vmin / 1000, vhi = cyc.Vmax / 1000, plo = cyc.Pmin / 1000, phi = cyc.Pmax / 1000;
      const vp = (vhi - vlo) * 0.12 || 1, pp = (phi - plo) * 0.12 || 1;
      const x0 = vlo - vp, x1 = vhi + vp, y0 = plo - pp, y1 = phi + pp;
      const X = v => M.l + (v - x0) / (x1 - x0) * (W - M.l - M.r), Y = p => H - M.b - (p - y0) / (y1 - y0) * (H - M.t - M.b);
      pvMap = { X, Y };
      g.clearRect(0, 0, W, H);
      // grid and axes
      g.strokeStyle = 'rgba(217,179,106,0.10)'; g.lineWidth = 1; g.fillStyle = css('--dim') || '#8d90a6'; g.font = '10px ' + (css('--mono') || 'monospace');
      const ticks = (a, b, n) => { const st = Math.pow(10, Math.floor(Math.log10((b - a) / n))); const m = [1, 2, 5, 10].find(k => (b - a) / (st * k) <= n) * st; const out = []; for (let v = Math.ceil(a / m) * m; v <= b; v += m) out.push(+v.toFixed(6)); return out; };
      g.textAlign = 'center';
      for (const v of ticks(x0, x1, 5)) { g.beginPath(); g.moveTo(X(v), M.t); g.lineTo(X(v), H - M.b); g.stroke(); g.fillText(String(+v.toFixed(1)), X(v), H - M.b + 13); }
      g.textAlign = 'right';
      for (const p of ticks(y0, y1, 4)) { g.beginPath(); g.moveTo(M.l, Y(p)); g.lineTo(W - M.r, Y(p)); g.stroke(); g.fillText(String(Math.round(p)), M.l - 5, Y(p) + 3); }
      g.textAlign = 'left'; g.fillText('V  cm³', W - M.r - 40, H - 3);
      g.save(); g.translate(10, M.t + 34); g.rotate(-Math.PI / 2); g.textAlign = 'right'; g.fillText('P  kPa', 0, 0); g.restore();
      // the enclosed area: the work of one turn
      const pts = cyc.pts;
      g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(X(q.V / 1000), Y(q.P / 1000)) : g.moveTo(X(q.V / 1000), Y(q.P / 1000))); g.closePath();
      g.fillStyle = 'rgba(255,224,170,0.07)'; g.fill();
      // each stretch in its process colour
      g.lineWidth = 2.6; g.lineCap = 'round';
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        g.strokeStyle = PROC[a.proc].col;
        g.beginPath(); g.moveTo(X(a.V / 1000), Y(a.P / 1000)); g.lineTo(X(b.V / 1000), Y(b.P / 1000)); g.stroke();
      }
      // process names at the middle of each stretch, pushed outward
      const cx = pts.reduce((s, q) => s + X(q.V / 1000), 0) / pts.length, cy = pts.reduce((s, q) => s + Y(q.P / 1000), 0) / pts.length;
      const runs = []; let cur = null;
      for (const q of pts) { if (!cur || cur.proc !== q.proc) { cur = { proc: q.proc, a: [] }; runs.push(cur); } cur.a.push(q); }
      if (runs.length > 1 && runs[0].proc === runs[runs.length - 1].proc) { runs[0].a = runs.pop().a.concat(runs[0].a); }
      g.font = '600 10px ' + (css('--sans') || 'sans-serif'); g.textAlign = 'center';
      for (const r of runs) {
        const q = r.a[Math.floor(r.a.length / 2)], x = X(q.V / 1000), y = Y(q.P / 1000);
        const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1;
        let lx = x + dx / L * 16, ly = y + dy / L * 14 + 3;
        lx = Math.max(M.l + 30, Math.min(W - M.r - 30, lx)); ly = Math.max(M.t + 8, Math.min(H - M.b - 4, ly));
        g.fillStyle = PROC[r.proc].col; g.fillText(PROC[r.proc].name, lx, ly);
        // a small arrow along the loop, in the direction of travel
        const j = r.a.indexOf(q), q2 = r.a[Math.min(r.a.length - 1, j + 2)];
        const ang = Math.atan2(Y(q2.P / 1000) - y, X(q2.V / 1000) - x);
        g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -3.6); g.lineTo(-3, 3.6); g.closePath(); g.fillStyle = PROC[r.proc].col; g.fill(); g.restore();
      }
      g.fillStyle = 'rgba(255,224,170,0.55)'; g.font = 'italic 12px ' + (css('--serif') || 'serif'); g.textAlign = 'center';
      g.fillText('W = ∮ P dV', cx, cy + 4);
    }
  }
  function drawPH() {
    const c = el.ph; if (!c.clientWidth) return;
    const changed = size(c);
    const W = c.width / dpr, H = c.height / dpr;
    if (A.dirty || changed || !phMap) {
      const cc = cache.ph; cc.width = c.width; cc.height = c.height;
      const g = cc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const m = { l: 10, r: 10, t: 14, b: 18 };
      const X = t => m.l + t / 360 * (W - m.l - m.r), Y = v => H - m.b - v * (H - m.t - m.b);
      phMap = { X, Y, m };
      g.clearRect(0, 0, W, H);
      // process bands behind the curves
      const pts = A.cyc.pts;
      for (let i = 0; i < pts.length; i++) { g.fillStyle = PROC[pts[i].proc].col + '1c'; g.fillRect(X(i / pts.length * 360), m.t, X(1 / pts.length * 360) - X(0) + 0.6, H - m.t - m.b); }
      g.fillStyle = css('--dim') || '#8d90a6'; g.font = '10px ' + (css('--mono') || 'monospace'); g.textAlign = 'center';
      for (const t of [0, 90, 180, 270, 360]) { g.fillText(t + '°', X(t), H - 4); g.strokeStyle = 'rgba(217,179,106,0.10)'; g.beginPath(); g.moveTo(X(t), m.t); g.lineTo(X(t), H - m.b); g.stroke(); }
      const curve = (a, col) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); a.forEach((v, i) => { const x = X(i / (a.length - 1) * 360), y = Y(v); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
      curve(A.dp, '#e2c27a'); curve(A.pp, '#e9a0a8');
      // the phase gap between the two tops
      const top = a => a.indexOf(Math.max(...a)) / (a.length - 1) * 360;
      let td = top(A.dp), tp = top(A.pp); if (tp < td) tp += 360;
      g.strokeStyle = 'rgba(255,224,170,0.7)'; g.lineWidth = 1; g.setLineDash([3, 3]);
      const yb = Y(0.08);
      g.beginPath(); g.moveTo(X(td), yb); g.lineTo(X(Math.min(360, tp)), yb); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffe0aa'; g.font = '600 10px ' + (css('--sans') || 'sans-serif');
      g.fillText(`φ = ${Math.round(tp - td)}°`, X((td + Math.min(360, tp)) / 2), yb - 5);
    }
  }

  let tick = 0;
  // st: { th, k, gs, proc, Th, Tc, rpm, torque }
  function frame(st) {
    if (!A.cyc) return;
    drawPV(); drawPH();
    A.dirty = false;
    // P-V: cache plus the moving dot
    if (el.pv.clientWidth && pvMap) {
      const g = el.pv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, el.pv.width, el.pv.height); g.drawImage(cache.pv, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x = pvMap.X(st.gs.V / 1000), y = pvMap.Y(st.gs.P / 1000), col = PROC[st.proc].col;
      g.strokeStyle = 'rgba(255,224,170,0.22)'; g.setLineDash([2, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, el.pv.height / dpr - M.b); g.moveTo(x, y); g.lineTo(M.l, y); g.stroke(); g.setLineDash([]);
      const rg = g.createRadialGradient(x, y, 0, x, y, 12); rg.addColorStop(0, col + 'aa'); rg.addColorStop(1, col + '00');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, 12, 0, TAU); g.fill();
      g.fillStyle = '#fff6e6'; g.beginPath(); g.arc(x, y, 3.6, 0, TAU); g.fill();
      g.strokeStyle = col; g.lineWidth = 1.6; g.stroke();
    }
    if (el.ph.clientWidth && phMap) {
      const g = el.ph.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, el.ph.width, el.ph.height); g.drawImage(cache.ph, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = ((st.th / D) % 360 + 360) % 360, x = phMap.X(t), H = el.ph.height / dpr;
      g.strokeStyle = 'rgba(255,240,220,0.65)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, phMap.m.t); g.lineTo(x, H - phMap.m.b); g.stroke();
      const i = Math.round(t / 360 * (A.dp.length - 1));
      for (const [a, c] of [[A.dp, '#e2c27a'], [A.pp, '#e9a0a8']]) { g.fillStyle = c; g.beginPath(); g.arc(x, phMap.Y(a[i]), 3.4, 0, TAU); g.fill(); }
    }
    if (++tick % 3) return;
    // where the gas is
    const gs = st.gs;
    el.bar.innerHTML = `<i style="width:${(gs.mh * 100).toFixed(1)}%;background:${tempCss(1)}"></i><i style="width:${(gs.mr * 100).toFixed(1)}%;background:linear-gradient(90deg,${tempCss(1)},${tempCss(0)})"></i><i style="width:${(gs.mc * 100).toFixed(1)}%;background:${tempCss(0)}"></i>`;
    el.barLab.innerHTML = `<span>hot ${(gs.mh * 100).toFixed(0)}%</span><span>regenerator ${(gs.mr * 100).toFixed(0)}%</span><span>cold ${(gs.mc * 100).toFixed(0)}%</span>`;
    const P = PROC[st.proc];
    el.proc.innerHTML = `<b style="color:${P.col}">${P.name}</b><span>${P.sub}</span>`;
    const cyc = A.cyc, E = A.E, f = st.rpm / 60;
    const rows = [
      ['Crank angle θ', `${(((st.th / D) % 360) + 360) % 360 | 0}°`],
      ['Phase angle φ', `${Math.round(A.al / D)}°`],
      ['Pressure P', `${(gs.P / 1000).toFixed(1)} kPa`],
      ['Volume V', `${(gs.V / 1000).toFixed(2)} cm³`],
      ['Hot / cold space', `${(gs.Vh / 1000).toFixed(1)} / ${(gs.Vc / 1000).toFixed(1)} cm³`],
      ['Shaft torque', `${st.torque >= 0 ? '+' : '−'}${Math.abs(st.torque * 1000).toFixed(0)} mN·m`],
      ['Work per turn W', `${cyc.W.toFixed(3)} J`],
      ['Heat in per turn Qh', `${cyc.Qh.toFixed(3)} J`],
      ['Efficiency W / Qh', `${(cyc.eta * 100).toFixed(1)}%`],
      ['Power at ' + Math.round(st.rpm) + ' rpm', `${(cyc.W * f).toFixed(2)} W`],
      ['Swept: displacer / piston', `${(E.sweptD / 1000).toFixed(1)} / ${(E.sweptP / 1000).toFixed(1)} cm³`],
    ];
    const html = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    if (el.nums._h !== html) { el.nums.innerHTML = html; el.nums._h = html; }
    const Tr = gs.Tr;
    const eq = [
      ['Schmidt pressure', `P = M ⁄ (V<sub>h</sub>/T<sub>h</sub> + V<sub>r</sub>/T<sub>r</sub> + V<sub>c</sub>/T<sub>c</sub>) = ${(gs.P / 1000).toFixed(1)} kPa`],
      ['Regenerator mean', `T<sub>r</sub> = (T<sub>h</sub> − T<sub>c</sub>) ⁄ ln(T<sub>h</sub>/T<sub>c</sub>) = ${Tr.toFixed(0)} K`],
      ['Work of one turn', `W = ∮ P dV = ${cyc.W.toFixed(3)} J`],
      ['Efficiency', `η = 1 − T<sub>c</sub>/T<sub>h</sub> = 1 − ${st.Tc}/${Math.round(st.Th)} = ${(1 - st.Tc / st.Th).toFixed(3)}`],
      ['Piston position', `y = r cos θ + √(l² − r² sin² θ)`],
    ];
    const eh = eq.map(([k, v]) => `<div class="eq"><span>${k}</span><div>${v}</div></div>`).join('');
    if (el.eqs._h !== eh) { el.eqs.innerHTML = eh; el.eqs._h = eh; }
  }
  return { setCycle, frame, redraw: () => { A.dirty = true; } };
}
