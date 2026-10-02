// ============================================================================
//  FOUR-STROKE ENGINE  ·  analysis.js — the analysis panel, live
// ────────────────────────────────────────────────────────────────────────────
//  Fills #ana: the crank angle, x(θ) with the numbers put in, a table of
//  the four cylinders, and four small canvases:
//    #cvFire ..... firing order 1-3-4-2: the stroke of each cylinder over 720°
//    #cvTiming ... the valve timing diagram (a crank circle, TDC at the top)
//    #cvLift ..... cylinder 1: piston position x(ψ) and both valve lifts
//    #cvPV ....... the p–V loop of each cylinder, with its point now
//  Each canvas keeps its static drawing in a cache; a frame draws the cache
//  and then the cursor. All values come from engine.js.
//
//  GREP MAP
//    const SCOL ............ the stroke colours (the gas uses the same)
//    function drawFire / drawTiming / drawLift / drawPV
//    function frame ........ the live text and the cursors
// ============================================================================
import * as E from './engine.js';
const { GEO, D, TIMING, CYLS, FIRE_AT } = E;
export const SCOL = { Intake: '#4aa3ff', Compression: '#b48cff', Power: '#ffb14a', Exhaust: '#a0948a' };
const INK = '#08090f', DIM = '#8d90a6', TEXT = '#dcdde6', CREAM = '#ffe0aa', GRID = 'rgba(217,179,106,0.12)';
const f1 = v => v.toFixed(1);

export function createAnalysis({ $, getTrain }) {
  const cvs = { fire: $('cvFire'), timing: $('cvTiming'), lift: $('cvLift'), pv: $('cvPV') };
  const cache = {};
  let T = getTrain(), liftCurve = null;
  function prep() {
    T = getTrain();
    const vi = T.valves.find(v => v.k === 1 && v.kind === 'in'), ve = T.valves.find(v => v.k === 1 && v.kind === 'ex');
    liftCurve = { in: [], ex: [] };
    for (let psi = 0; psi <= 720; psi += 2) { liftCurve.in.push(E.valveLift(T, vi, psi)); liftCurve.ex.push(E.valveLift(T, ve, psi)); }
    for (const k in cache) delete cache[k];
    const m = E.measuredTiming(T);
    $('anaTrain').textContent = T.name;
    $('anaEvents').innerHTML = `IVO <b>${f1(360 - m.in.open)}°</b> BTDC · IVC <b>${f1(m.in.close - 540)}°</b> ABDC · EVO <b>${f1(180 - m.ex.open)}°</b> BBDC · EVC <b>${f1(m.ex.close - 360)}°</b> ATDC · overlap <b>${f1(m.ex.close - m.in.open)}°</b> · max lift <b>${m.in.max.toFixed(1)} mm</b>`;
  }
  // canvas size follows its CSS box; the static layer is cached per size
  function ctxOf(name, draw) {
    const c = cvs[name], w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return null;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); delete cache[name]; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!cache[name]) {
      const off = document.createElement('canvas'); off.width = c.width; off.height = c.height;
      const og = off.getContext('2d'); og.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(og, w, h);
      cache[name] = off;
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.drawImage(cache[name], 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }
  const font = (g, px, w = 500) => { g.font = `${w} ${px}px Inter, system-ui, sans-serif`; };

  // ── firing order chart ────────────────────────────────────────────────────
  const fireBox = (w, h) => ({ x0: 30, x1: w - 6, y0: 4, rh: (h - 22) / 4 });
  function drawFire(g, w, h) {
    const b = fireBox(w, h), X = th => b.x0 + (b.x1 - b.x0) * th / 720;
    CYLS.forEach((k, row) => {
      const y = b.y0 + row * b.rh;
      font(g, 10, 600); g.fillStyle = TEXT; g.textBaseline = 'middle'; g.fillText(`#${k}`, 4, y + b.rh / 2);
      for (let s = 0; s < 4; s++) {
        // stroke s of cylinder k starts at θ = φ_k + 180 s
        const st = E.STROKES[s];
        let a = E.mod(FIRE_AT[k] + 180 * s, 720), e = a + 180;
        const seg = (p, q) => { g.fillStyle = SCOL[st]; g.globalAlpha = 0.75; g.fillRect(X(p), y + 2, X(q) - X(p) - 0.5, b.rh - 4); g.globalAlpha = 1; };
        if (e <= 720) seg(a, e); else { seg(a, 720); seg(0, e - 720); }
        if (s === 0) { g.fillStyle = INK; font(g, 9, 600); const mid = E.mod(a + 90, 720); g.fillText('power', X(mid) - 14, y + b.rh / 2); }
      }
    });
    g.strokeStyle = GRID; g.fillStyle = DIM; font(g, 9);
    for (let th = 0; th <= 720; th += 180) { g.beginPath(); g.moveTo(X(th), b.y0); g.lineTo(X(th), b.y0 + 4 * b.rh); g.stroke(); g.fillText(`${th}°`, Math.min(X(th) - 8, w - 26), h - 8); }
  }
  // ── valve timing diagram ──────────────────────────────────────────────────
  function drawTiming(g, w, h) {
    const cx = w / 2, cy = h / 2 + 4, R = Math.min(w, h) / 2 - 22;
    const P = (deg, r) => [cx + r * Math.sin(deg * D), cy - r * Math.cos(deg * D)];   // clockwise from TDC
    const m = E.measuredTiming(T);
    g.strokeStyle = GRID; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx, cy - R - 6); g.lineTo(cx, cy + R + 6); g.stroke();
    const arc = (a0, a1, r, col, lw) => {
      g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath();
      g.arc(cx, cy, r, (a0 - 90) * D, (a1 - 90) * D, false); g.stroke();
    };
    // intake ψ 350..580 → crank 350..220 (+360), exhaust 140..370
    arc(m.in.open, m.in.close, R - 6, SCOL.Intake, 7);
    arc(m.ex.open, m.ex.close, R - 18, SCOL.Exhaust, 7);
    g.lineWidth = 1;
    const tag = (deg, r, t, col) => { const [x, y] = P(deg, r); g.fillStyle = col; font(g, 9, 600); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); g.textAlign = 'left'; };
    tag(0, R + 12, 'TDC', TEXT); tag(180, R + 12, 'BDC', TEXT);
    tag(m.in.open - 18, R + 8, 'IVO', SCOL.Intake); tag(m.in.close + 14, R + 9, 'IVC', SCOL.Intake);
    tag(m.ex.open - 14, R - 30, 'EVO', SCOL.Exhaust); tag(m.ex.close + 14, R - 30, 'EVC', SCOL.Exhaust);
    const [sx, sy] = P(TIMING.spark, R - 34); g.fillStyle = '#fff2c0'; g.beginPath(); g.arc(sx, sy, 3, 0, Math.PI * 2); g.fill();
    tag(TIMING.spark - 12, R - 44, 'spark', '#fff2c0');
  }
  // ── piston and valves for cylinder 1 ──────────────────────────────────────
  const liftBox = (w, h) => ({ x0: 6, x1: w - 6, y0: 8, y1: h - 18 });
  function drawLift(g, w, h) {
    const b = liftBox(w, h), X = p => b.x0 + (b.x1 - b.x0) * p / 720;
    for (let s = 0; s < 4; s++) { g.fillStyle = SCOL[E.STROKES[s]]; g.globalAlpha = 0.09; g.fillRect(X(180 * s), b.y0, X(180) - X(0), b.y1 - b.y0); g.globalAlpha = 1; }
    // x(ψ): TDC at the top
    const xMax = GEO.r + GEO.l, xMin = GEO.l - GEO.r, Yx = x => b.y0 + (xMax - x) / (xMax - xMin) * (b.y1 - b.y0) * 0.62;
    g.strokeStyle = CREAM; g.lineWidth = 1.6; g.beginPath();
    for (let p = 0; p <= 720; p += 2) { const y = Yx(E.pistonX(p)); p ? g.lineTo(X(p), y) : g.moveTo(X(p), y); }
    g.stroke();
    // lifts at the base
    const Lmax = 10, Yl = L => b.y1 - L / Lmax * (b.y1 - b.y0) * 0.34;
    for (const [kind, col] of [['in', SCOL.Intake], ['ex', SCOL.Exhaust]]) {
      g.fillStyle = col; g.globalAlpha = 0.55; g.beginPath(); g.moveTo(X(0), Yl(0));
      liftCurve[kind].forEach((L, i) => g.lineTo(X(i * 2), Yl(L)));
      g.lineTo(X(720), Yl(0)); g.closePath(); g.fill(); g.globalAlpha = 1;
    }
    g.strokeStyle = '#fff2c0'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(TIMING.spark), b.y0); g.lineTo(X(TIMING.spark), b.y1); g.stroke(); g.setLineDash([]);
    font(g, 9); g.fillStyle = DIM;
    E.STROKES.forEach((s, i) => g.fillText(s.toLowerCase(), X(180 * i) + 4, h - 6));
    g.fillStyle = CREAM; g.fillText('x(ψ)', X(8), b.y0 + 9);
  }
  // ── p–V ───────────────────────────────────────────────────────────────────
  const pvBox = (w, h) => ({ x0: 30, x1: w - 8, y0: 8, y1: h - 18, Vmax: GEO.Vc + GEO.Vs, pMax: Math.ceil(E.cycleStats.pMax / 10) * 10 });
  function drawPV(g, w, h) {
    const b = pvBox(w, h), X = V => b.x0 + (b.x1 - b.x0) * V / b.Vmax, Y = p => b.y1 - (b.y1 - b.y0) * p / b.pMax;
    g.strokeStyle = GRID; g.fillStyle = DIM; font(g, 9);
    for (let p = 0; p <= b.pMax; p += 10) { g.beginPath(); g.moveTo(b.x0, Y(p)); g.lineTo(b.x1, Y(p)); g.stroke(); g.fillText(String(p), 4, Y(p) + 3); }
    g.fillText('bar', 4, b.y0 + 2); g.fillText(`V (cc) → ${b.Vmax.toFixed(0)}`, b.x1 - 78, h - 5);
    // the loop, coloured by stroke
    for (let psi = 0; psi < 720; psi += 1) {
      const a = E.gasState(psi), c = E.gasState(psi + 1);
      g.strokeStyle = SCOL[a.stroke]; g.lineWidth = 1.8; g.beginPath(); g.moveTo(X(a.V), Y(a.p)); g.lineTo(X(c.V), Y(c.p)); g.stroke();
    }
  }

  // ── per frame ─────────────────────────────────────────────────────────────
  let tick = 0;
  function frame(th, rpm) {
    if (++tick % 2) return;
    const panel = $('ana');
    if (!panel.offsetParent && getComputedStyle(panel).position !== 'fixed') return;
    if (panel.getBoundingClientRect().width < 10) return;
    const thc = E.mod(th, 720), psi1 = E.psiOf(1, th), a1 = E.crankOf(1, th);
    $('anaTheta').textContent = `${thc.toFixed(1)}°`;
    $('anaCam').textContent = `${(thc / 2).toFixed(1)}°`;
    const s = Math.sin(a1 * D), x1 = E.pistonX(a1);
    $('anaX').textContent = `x = ${GEO.r} cos ${a1.toFixed(1)}° + √(${GEO.l}² − ${GEO.r}² sin² ${a1.toFixed(1)}°) = ${x1.toFixed(1)} mm`;
    $('anaXdot').textContent = `dx/dθ = ${E.pistonDx(a1).toFixed(1)} mm/rad · piston speed at ${rpm} rpm: ${(Math.abs(E.pistonDx(a1)) * rpm * Math.PI / 30 / 1000).toFixed(3)} m/s`;
    void s;
    // the table, in firing order
    let html = '<tr><th>cyl</th><th>stroke</th><th>ψ</th><th>x mm</th><th>p bar</th><th>I</th><th>E</th></tr>';
    for (const k of E.FIRING) {
      const psi = E.psiOf(k, th), g = E.gasState(psi), x = E.pistonX(E.crankOf(k, th));
      const li = Math.max(...T.valves.filter(v => v.k === k && v.kind === 'in').map(v => E.valveLift(T, v, th)));
      const le = Math.max(...T.valves.filter(v => v.k === k && v.kind === 'ex').map(v => E.valveLift(T, v, th)));
      html += `<tr><td>${k}</td><td style="color:${SCOL[g.stroke]}">${g.stroke}</td><td>${psi.toFixed(0)}°</td><td>${x.toFixed(1)}</td><td>${g.p.toFixed(1)}</td><td>${li > 0.15 ? li.toFixed(1) : '·'}</td><td>${le > 0.15 ? le.toFixed(1) : '·'}</td></tr>`;
    }
    $('cylTable').innerHTML = html;
    const Tq = E.torque(th);
    $('anaTorque').textContent = `${Tq.toFixed(0)} N·m`;
    $('anaTorqueBar').style.left = `${50 + 50 * Math.max(-1, Math.min(1, Tq / E.cycleStats.Tmax)) * (Tq < 0 ? 1 : 0)}%`;
    $('anaTorqueBar').style.width = `${50 * Math.min(1, Math.abs(Tq) / E.cycleStats.Tmax)}%`;
    $('anaTorqueBar').classList.toggle('neg', Tq < 0);

    let c = ctxOf('fire', drawFire);
    if (c) { const b = fireBox(c.w, c.h), x = b.x0 + (b.x1 - b.x0) * thc / 720; c.g.strokeStyle = '#fff'; c.g.lineWidth = 1.5; c.g.beginPath(); c.g.moveTo(x, b.y0); c.g.lineTo(x, b.y0 + 4 * b.rh); c.g.stroke(); }
    c = ctxOf('timing', drawTiming);
    if (c) {
      const cx = c.w / 2, cy = c.h / 2 + 4, R = Math.min(c.w, c.h) / 2 - 22, a = E.mod(psi1, 360) * D;
      c.g.strokeStyle = '#fff'; c.g.lineWidth = 2; c.g.beginPath(); c.g.moveTo(cx, cy); c.g.lineTo(cx + (R - 26) * Math.sin(a), cy - (R - 26) * Math.cos(a)); c.g.stroke();
      c.g.fillStyle = SCOL[E.strokeOf(psi1)]; c.g.beginPath(); c.g.arc(cx, cy, 5, 0, Math.PI * 2); c.g.fill();
      font(c.g, 9); c.g.fillStyle = DIM; c.g.textAlign = 'center'; c.g.fillText(psi1 < 360 ? 'turn 1 of 2' : 'turn 2 of 2', cx, cy + 18); c.g.textAlign = 'left';
    }
    c = ctxOf('lift', drawLift);
    if (c) { const b = liftBox(c.w, c.h), x = b.x0 + (b.x1 - b.x0) * psi1 / 720; c.g.strokeStyle = '#fff'; c.g.lineWidth = 1.5; c.g.beginPath(); c.g.moveTo(x, b.y0); c.g.lineTo(x, b.y1); c.g.stroke(); }
    c = ctxOf('pv', drawPV);
    if (c) {
      const b = pvBox(c.w, c.h), X = V => b.x0 + (b.x1 - b.x0) * V / b.Vmax, Y = p => b.y1 - (b.y1 - b.y0) * p / b.pMax;
      for (const k of CYLS) {
        const g = E.gasState(E.psiOf(k, th));
        c.g.fillStyle = '#fff'; c.g.beginPath(); c.g.arc(X(g.V), Y(g.p), k === 1 ? 4.5 : 3, 0, Math.PI * 2); c.g.fill();
        c.g.fillStyle = INK; font(c.g, 8, 700); c.g.textAlign = 'center'; c.g.textBaseline = 'middle'; c.g.fillText(String(k), X(g.V), Y(g.p) + 0.5); c.g.textAlign = 'left'; c.g.textBaseline = 'alphabetic';
      }
    }
  }
  prep();
  const st = E.cycleStats;
  $('anaNums').innerHTML = [
    ['Displacement', `${GEO.displacement.toFixed(0)} cc`], ['Compression ratio ε', `${GEO.cr} : 1`],
    ['Rod ratio l / r', (GEO.l / GEO.r).toFixed(2)], ['Ideal Otto η = 1 − ε^(1−γ)', `${(st.otto * 100).toFixed(1)} %  (γ = 1.4)`],
    ['Work per cylinder ∮p dV', `${st.W.toFixed(0)} J per cycle`], ['IMEP', `${st.imep.toFixed(1)} bar`],
    ['Peak pressure', `${st.pMax.toFixed(0)} bar at ${st.pMaxAt.toFixed(0)}° ATDC`], ['Mean torque (gas)', `${st.Tmean.toFixed(0)} N·m`],
  ].map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');
  return { frame, setTrain: prep };
}
