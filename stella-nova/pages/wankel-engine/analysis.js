// ============================================================================
//  WANKEL ENGINE  ·  analysis.js — the chamber table, three plots, numbers
// ────────────────────────────────────────────────────────────────────────────
//  createAnalysis(els) fills the analysis group:
//    #chams .. the three chambers of rotor 1 now: stroke, volume, pressure
//    #vol .... the volume of each chamber over one rotor turn (1080° of the
//              shaft), each stretch in the colour of its stroke
//    #pv ..... the P-V loop of one chamber (ideal air-standard cycle)
//    #tq ..... the gas torque on the shaft over one shaft turn, with its mean
//    #nums ... the numbers, #eqs the relations (plain text and Unicode)
//  The curves are drawn once per layout (setVariant) into cache canvases.
//  Each frame draws the cache and the moving marks.
//
//  GREP MAP
//    function setVariant ..... sample the curves for this layout
//    function plotFrame ...... axes and grid in a cache canvas
//    function drawVol / drawPV / drawTq
//    function frame .......... per-frame marks and the tables
// ============================================================================
import * as E from './engine.js';

const { GEO, TAU, D, STROKES } = E;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function createAnalysis(el) {
  const A = { V: null };
  const cache = { vol: document.createElement('canvas'), pv: document.createElement('canvas'), tq: document.createElement('canvas') };
  const maps = {};
  let dpr = 1, dirty = true;
  const M = { l: 40, r: 10, t: 10, b: 22 };

  function size(c) {
    dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(10, c.clientWidth), h = Math.max(10, c.clientHeight);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); return true; }
    return false;
  }
  const ticks = (a, b, n) => { const st = Math.pow(10, Math.floor(Math.log10((b - a) / n))); const m = [1, 2, 5, 10].find(k => (b - a) / (st * k) <= n) * st; const out = []; for (let v = Math.ceil(a / m) * m; v <= b + 1e-9; v += m) out.push(+v.toFixed(6)); return out; };

  // the curves for a layout: volumes of rotor 1, the loop, the torque
  function setVariant(V) {
    A.V = V;
    const vt = E.volumes();
    A.Vmax = vt.Vmax / 1000; A.Vmin = vt.Vmin / 1000;
    A.loop = E.cycleLoop(720);
    const offs = V.rotors.map(r => r.off), N = 360;
    A.tq = [];
    let mean = 0;
    for (let i = 0; i <= N; i++) { const T = E.torque(i / N * TAU, offs); A.tq.push(T); if (i < N) mean += T / N; }
    A.tqMean = mean;
    A.tqMin = Math.min(...A.tq); A.tqMax = Math.max(...A.tq);
    dirty = true;
    fillNums();
  }

  // axes and grid into a cache canvas; returns the maps X, Y
  function plotFrame(c, cc, x0, x1, y0, y1, xl, yl, xt, yt) {
    cc.width = c.width; cc.height = c.height;
    const g = cc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = c.width / dpr, H = c.height / dpr;
    const X = v => M.l + (v - x0) / (x1 - x0) * (W - M.l - M.r), Y = v => H - M.b - (v - y0) / (y1 - y0) * (H - M.t - M.b);
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(217,179,106,0.10)'; g.lineWidth = 1; g.fillStyle = css('--dim') || '#8d90a6'; g.font = '10px ' + (css('--mono') || 'monospace');
    g.textAlign = 'center';
    for (const v of xt || ticks(x0, x1, 5)) { g.beginPath(); g.moveTo(X(v), M.t); g.lineTo(X(v), H - M.b); g.stroke(); g.fillText(String(v), X(v), H - M.b + 13); }
    g.textAlign = 'right';
    for (const v of yt || ticks(y0, y1, 4)) { g.beginPath(); g.moveTo(M.l, Y(v)); g.lineTo(W - M.r, Y(v)); g.stroke(); g.fillText(String(Math.round(v)), M.l - 5, Y(v) + 3); }
    g.textAlign = 'right'; g.fillText(xl, W - M.r - 2, M.t + 9);   // the x unit, top right, clear of the ticks
    g.save(); g.translate(10, M.t + 4); g.rotate(-Math.PI / 2); g.textAlign = 'right'; g.fillText(yl, 0, 0); g.restore();
    return { g, X, Y, W, H };
  }
  const strokeAt = (w) => Math.min(3, Math.floor((((w % TAU) + TAU) % TAU) / (Math.PI / 2)));

  function drawVol(state) {
    const c = el.vol; if (!c.clientWidth) return;
    const ch = size(c);
    if (dirty || ch || !maps.vol) {
      const f = plotFrame(c, cache.vol, 0, 1080, 0, A.Vmax * 1.08, 'θ°', 'V cm³', [0, 180, 360, 540, 720, 900, 1080], ticks(0, A.Vmax, 3));
      const g = f.g; g.lineWidth = 2; g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        let prev = null;
        for (let i = 0; i <= 540; i++) {
          const th = i / 540 * 1080 * D, a = th / 3, v = E.volumeAt(a + k * TAU / 3) / 1000, s = strokeAt(E.phaseOf(a, k));
          const p = [f.X(th / D), f.Y(v)];
          if (prev) { g.strokeStyle = STROKES[s].col; g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke(); }
          prev = p;
        }
      }
      maps.vol = f;
    }
    const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.drawImage(cache.vol, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f = maps.vol, th = ((state.t % (3 * TAU)) + 3 * TAU) % (3 * TAU), x = f.X(th / D);
    g.strokeStyle = 'rgba(255,224,170,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, f.H - M.b); g.stroke();
    state.units[0].ch.forEach((q, k) => { g.fillStyle = STROKES[q.stroke].col; g.beginPath(); g.arc(x, f.Y(q.V / 1000), 3.6, 0, TAU); g.fill(); g.fillStyle = '#0b0c12'; g.font = '600 8px ' + css('--sans'); g.textAlign = 'center'; g.fillText(String(k + 1), x, f.Y(q.V / 1000) + 3); });
  }

  function drawPV(state) {
    const c = el.pv; if (!c.clientWidth) return;
    const ch = size(c), L = A.loop.pts;
    const pmax = Math.max(...L.map(q => q.p));
    if (dirty || ch || !maps.pv) {
      const f = plotFrame(c, cache.pv, 0, A.Vmax * 1.06, 0, pmax * 1.08, 'V cm³', 'p bar');
      const g = f.g;
      g.beginPath(); L.forEach((q, i) => i ? g.lineTo(f.X(q.V), f.Y(q.p)) : g.moveTo(f.X(q.V), f.Y(q.p))); g.closePath();
      g.fillStyle = 'rgba(255,224,170,0.06)'; g.fill();
      g.lineWidth = 2.2; g.lineCap = 'round';
      for (let i = 0; i < L.length - 1; i++) {
        const a = L[i], b = L[i + 1];
        g.strokeStyle = STROKES[strokeAt(a.w)].col;
        g.beginPath(); g.moveTo(f.X(a.V), f.Y(a.p)); g.lineTo(f.X(b.V), f.Y(b.p)); g.stroke();
      }
      g.font = '10px ' + css('--sans'); g.fillStyle = STROKES[2].col; g.textAlign = 'left';
      g.fillText('power', f.X(A.Vmin) + 26, f.Y(pmax * 0.55));
      g.fillStyle = STROKES[1].col; g.fillText('compression', f.X(A.Vmax * 0.42), f.Y(pmax * 0.12) - 4);
      maps.pv = f;
    }
    const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.drawImage(cache.pv, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f = maps.pv;
    state.units[0].ch.forEach((q, k) => {
      const x = f.X(q.V / 1000), y = f.Y(q.p);
      g.fillStyle = STROKES[q.stroke].col; g.beginPath(); g.arc(x, y, 3.8, 0, TAU); g.fill();
      g.fillStyle = '#0b0c12'; g.font = '600 8px ' + css('--sans'); g.textAlign = 'center'; g.fillText(String(k + 1), x, y + 3);
    });
  }

  function drawTq(state) {
    const c = el.tq; if (!c.clientWidth) return;
    const ch = size(c);
    if (dirty || ch || !maps.tq) {
      const lo = Math.min(0, A.tqMin), hi = A.tqMax, pad = (hi - lo) * 0.08;
      const f = plotFrame(c, cache.tq, 0, 360, lo - pad, hi + pad, 'θ°', 'N·m', [0, 90, 180, 270, 360]);
      const g = f.g;
      g.strokeStyle = 'rgba(220,221,230,0.35)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(f.X(0), f.Y(0)); g.lineTo(f.X(360), f.Y(0)); g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#ffe0aa'; g.lineWidth = 1.8; g.beginPath();
      A.tq.forEach((T, i) => { const x = f.X(i), y = f.Y(T); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      g.strokeStyle = '#7fdcb8'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(f.X(0), f.Y(A.tqMean)); g.lineTo(f.X(360), f.Y(A.tqMean)); g.stroke();
      g.fillStyle = '#7fdcb8'; g.font = '10px ' + css('--sans'); g.textAlign = 'right'; g.fillText(`mean ${A.tqMean.toFixed(0)}`, f.X(360) - 2, f.Y(A.tqMean) - 4);
      maps.tq = f;
    }
    const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.drawImage(cache.tq, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const f = maps.tq, th = ((state.t % TAU) + TAU) % TAU / D;
    g.fillStyle = '#ffe0aa'; g.beginPath(); g.arc(f.X(th), f.Y(state.torque), 3.6, 0, TAU); g.fill();
  }

  // ── tables ───────────────────────────────────────────────────────────────
  function fillNums() {
    const V = A.V, vt = E.volumes(), n = V.rotors.length, C = A.loop;
    A.numRows = [
      ['Shaft speed', 'rpm', s => `${s.rpm} rpm`],
      ['Rotor speed', 'rotorRpm', s => `${+(s.rpm / 3).toFixed(1)} rpm`],
      ['Shaft : rotor', '', () => '3 : 1'],
      ['Gears (ring : fixed)', '', () => `${GEO.gear.ring} : ${GEO.gear.fixed}`],
      ['R · e · W', '', () => `${GEO.R} · ${GEO.e} · ${GEO.W} mm`],
      ['K = R / e', '', () => E.K.toFixed(1)],
      ['Swept, each chamber', '', () => `${(E.SWEPT / 1000).toFixed(0)} cm³`],
      ['Engine (rated)', '', () => `${n} × ${(E.SWEPT / 1000).toFixed(0)} = ${(n * E.SWEPT / 1000).toFixed(0)} cm³`],
      ['Compression ratio', '', () => `${vt.CR.toFixed(1)} : 1`],
      ['Apex seal lean, now', 'lean', s => `${(s.units[0].k.lean[0] / D).toFixed(1)}°`],
      ['Apex speed, now', 'apex', s => `${s.apexSpeed.toFixed(1)} m/s`],
      ['Power strokes / shaft turn', '', () => String(n)],
      ['Work / cycle (ideal)', '', () => `${C.work.toFixed(0)} J`],
      ['Mean torque (ideal)', '', () => `${(n * C.meanTorque).toFixed(0)} N·m`],
      ['Gas torque, now', 'tq', s => `${s.torque.toFixed(0)} N·m`],
      ['Power at this speed', 'pw', s => `${(n * C.meanTorque * s.rpm / 60 * TAU / 1000).toFixed(1)} kW`],
    ];
    el.nums.innerHTML = A.numRows.map(([k], i) => `<tr><td>${esc(k)}</td><td data-n="${i}">—</td></tr>`).join('');
    el.eqs.innerHTML = [
      ['Housing (epitrochoid)', 'x = e cos 3α + R cos α<br>y = e sin 3α + R sin α'],
      ['Rotor centre and angle', 'c = e (cos θ, sin θ),  α = θ / 3'],
      ['Phasing gears', `r<sub>ring</sub> − r<sub>fixed</sub> = e,  r<sub>ring</sub> : r<sub>fixed</sub> = 3 : 2`],
      ['Swept volume', `V<sub>s</sub> = 3√3 e R W = ${(E.SWEPT / 1000).toFixed(0)} cm³`],
      ['Chamber volume', 'V(θ) = V<sub>min</sub> + ½ V<sub>s</sub> (1 − cos ⅔θ)'],
      ['Apex seal lean', `φ<sub>max</sub> = asin(3e / R) = ${(E.LEAN_MAX / D).toFixed(1)}°`],
      ['Shaft torque', 'T = Σ (p − p₀) dV/dθ'],
    ].map(([h, t]) => `<div class="eq"><span>${esc(h)}</span><div>${t}</div></div>`).join('');
  }
  let tick = 0;
  function frame(state) {
    drawVol(state); drawPV(state); drawTq(state);
    dirty = false;
    if (++tick % 4) return;
    el.chams.innerHTML = '<tr><th>chamber</th><th>stroke</th><th>V cm³</th><th>p bar</th></tr>' + state.units[0].ch.map((q, k) =>
      `<tr><td><i style="background:${STROKES[q.stroke].col}"></i>${k + 1}</td><td><b style="color:${STROKES[q.stroke].col}">${STROKES[q.stroke].name}</b></td><td>${(q.V / 1000).toFixed(0)}</td><td>${q.p.toFixed(1)}</td></tr>`).join('');
    for (const n of el.nums.querySelectorAll('[data-n]')) { const t = A.numRows[+n.dataset.n][2](state); if (n.textContent !== t) n.textContent = t; }
  }
  return { setVariant, frame, redraw: () => { dirty = true; } };
}
