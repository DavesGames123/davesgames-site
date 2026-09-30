/* ============================================================================
   SMITH CHART  ·  main script  (2D canvas, global RF from rf.js)
   ----------------------------------------------------------------------------
   rf.js does the math. This script draws the chart, the overlays, and binds
   the controls. All drawing is in the plane of gamma:
       gamma (re, im)  ->  screen (cx + R*re, cy - R*im)
   The Z grid and the Y grid use the same plane. The Y grid is the Z grid
   turned by 180 degrees, so one point gives z on one grid and y on the other.

   STATE. G holds the load in ohms, not normalized. A change of Z0 then moves
   the point, as it does for a real load on a new line. The R and X sliders
   use a normalized scale (r = s/(1-s), x = tan(pi*s/2)), so the middle of
   each slider is r = 1 or x = 0. The number boxes hold ohms.

   LAYERS. buildGrid draws the grid and the rim into an offscreen canvas. It
   runs again only when the chart moves, resizes, or changes grid mode.
   frame() copies that canvas, then draws the overlays: the |gamma| circle,
   the RLC trace, the line walk, the stub path, and the points.

   GREP MAP
     grep -n 'function loadZ'        the load impedance in ohms, per load mode
     grep -n 'function buildGrid'    the Z and Y grid lines and labels
     grep -n 'function drawRim'      the wavelength and angle scales
     grep -n 'function drawOverlays' the circle, trace, walk, stub, points
     grep -n 'function frame'        the render loop
     grep -n 'function clearRect'    the overlay margins that fit the chart
     grep -n 'function refresh'      the readout and the status bar
     grep -n 'function onPointer'    drag the load, and the pointer tip
     grep -n 'function buildUI'      the control panel construction
     grep -n 'function setOpen'      the panel, the phone sheet, and the dock

   FRAMING. The panel, the dock, and the bars cover parts of the canvas.
   clearRect() measures them each frame. The chart center and radius then
   ease to fit the clear part, so the chart follows a sliding panel.
   ========================================================================== */
(() => {
  'use strict';
  const { cx, abs, arg, zToGamma, gammaToZ, towardGen, wtg, inv } = RF;
  const TAU = Math.PI * 2;
  const F_MIN = 50e6, F_MAX = 5e9;         // RLC sweep range, hertz
  const WALK_RATE = 0.04;                  // wavelengths per second
  const G_MAX = 0.995;                     // drag limit for |gamma|
  const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
  const COL = { z: '80,220,232', y: '229,139,208', load: '#fca35e', zin: '#9db4ff', stub: '#7ee0a0', ink: '#d4e4ec', dim: '#7a929e' };

  // Grid lines: [value, extent]. An r circle runs for |x| <= extent. An x arc
  // runs for r <= extent. A minor line stops on a major line, as on a paper chart.
  const LINES = [
    [0.1, 2], [0.2, Infinity], [0.3, 2], [0.4, 2], [0.5, Infinity], [0.6, 2], [0.7, 2], [0.8, 2], [0.9, 2],
    [1, Infinity], [1.5, 5], [2, Infinity], [3, 5], [4, 5], [5, Infinity], [10, Infinity], [20, Infinity],
  ];
  const MAJOR = new Set([0.2, 0.5, 1, 2, 5]);
  const LABELS = [0.2, 0.5, 1, 2, 5];

  const G = {
    loadMode: 'z', z0: 50, R: 60, X: -80,
    rlcR: 30, rlcL: 40, rlcC: 6, rlcT: 0.6,
    len: 0, walking: false,
    stub: 'off', stubSol: 0,
    grid: 'z', circle: true, rim: true,
  };

  const $ = id => document.getElementById(id);
  const canvas = $('chart'), ctx = canvas.getContext('2d');
  const gridCv = document.createElement('canvas'), gctx = gridCv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const view = { cx: 0, cy: 0, R: 100, ready: false, angles: true };
  let gridKey = '', dirty = true, lastT = 0;

  // ------------------------------------------------------------------ model
  const rlcF = () => F_MIN * Math.pow(F_MAX / F_MIN, G.rlcT);
  function loadZAt(f) { return RF.seriesRLC(G.rlcR, G.rlcL * 1e-9, G.rlcC * 1e-12, f); }
  function loadZ() { return G.loadMode === 'rlc' ? loadZAt(rlcF()) : cx(G.R, G.X); }
  const norm = Z => cx(Z.re / G.z0, Z.im / G.z0);
  function model() {
    const Z = loadZ(), z = norm(Z), g = zToGamma(z);
    const gin = towardGen(g, G.len);
    const stubs = G.stub === 'off' ? [] : RF.shuntStub(z, G.stub);
    return { Z, z, g, gin, stubs };
  }

  // ---------------------------------------------------------------- helpers
  const toX = g => view.cx + view.R * g.re;
  const toY = g => view.cy - view.R * g.im;
  function fmtN(v) {
    if (!isFinite(v)) return '∞';
    const a = Math.abs(v);
    if (a >= 1e5) return v.toExponential(2);
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }
  function fmtC(c, unit) {
    if (!isFinite(c.re) || !isFinite(c.im) || abs(c) > 1e7) return '∞ (open)';
    const s = `${fmtN(c.re)} ${c.im < 0 ? '−' : '+'} j${fmtN(Math.abs(c.im))}`;
    return unit ? `${s} ${unit}` : s;
  }
  const fmtF = f => f >= 1e9 ? `${(f / 1e9).toFixed(3)} GHz` : `${(f / 1e6).toFixed(1)} MHz`;
  const deg = t => t * 180 / Math.PI;

  // ------------------------------------------------------------------- grid
  // Stroke a curve z(t) mapped to gamma. flip turns it 180 degrees (Y grid).
  function curve(c, zOf, t0, t1, n, flip) {
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const g = zToGamma(zOf(t0 + (t1 - t0) * i / n));
      const px = view.cx + view.R * (flip ? -g.re : g.re), py = view.cy - view.R * (flip ? -g.im : g.im);
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.stroke();
  }
  function drawFamily(c, rgb, flip, fine) {
    const cxS = view.cx, cyS = view.cy, R = view.R;
    const edge = t => Math.min(t, Math.PI / 2 - 1e-4);
    for (const [v, ext] of LINES) {
      const major = MAJOR.has(v) || v === 1;
      c.strokeStyle = `rgba(${rgb},${major ? 0.42 : 0.16 * fine})`;
      c.lineWidth = major ? 1.1 : 0.8;
      // constant r (or g): a full circle when the extent is infinite
      if (!isFinite(ext)) {
        const k = 1 / (1 + v), ctr = v / (1 + v);
        c.beginPath(); c.arc(cxS + R * (flip ? -ctr : ctr), cyS, R * k, 0, TAU); c.stroke();
      } else {
        const a = Math.atan(ext);
        curve(c, t => cx(v, Math.tan(t)), -a, a, 90, flip);
      }
      // constant x (or b), both signs
      const b = isFinite(ext) ? Math.atan(ext) : edge(Math.PI / 2);
      for (const s of [1, -1]) curve(c, t => cx(Math.tan(t), s * v), 0, b, 120, flip);
    }
    // the real axis and the rim
    c.strokeStyle = `rgba(${rgb},0.55)`; c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(cxS - R, cyS); c.lineTo(cxS + R, cyS); c.stroke();
  }
  function drawLabels(c, rgb, flip, rim, below) {
    const fs = Math.max(9, Math.min(12, view.R / 26));
    c.font = `${fs}px 'JetBrains Mono', monospace`;
    c.fillStyle = `rgba(${rgb},0.85)`;
    const sgn = flip ? -1 : 1;
    for (const v of LABELS) {
      const g = zToGamma(cx(v, 0));
      c.textAlign = flip ? 'right' : 'left';
      c.textBaseline = below ? 'top' : 'bottom';
      c.fillText(String(v), view.cx + view.R * sgn * g.re + (flip ? -3 : 3), view.cy + (below ? 3 : -3));
      if (!rim) continue;
      for (const s of [1, -1]) {
        const q = zToGamma(cx(0, s * v)), t = Math.atan2(sgn * q.im, sgn * q.re);
        const rr = view.R - fs * 1.35;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(`${s > 0 ? '+' : '−'}${v}`, view.cx + rr * Math.cos(t), view.cy - rr * Math.sin(t));
      }
    }
    c.textAlign = flip ? 'right' : 'left'; c.textBaseline = below ? 'top' : 'bottom';
    c.fillText('0', view.cx - sgn * view.R + (flip ? -3 : 3), view.cy + (below ? 3 : -3));
  }
  // The outer scales. Ticks every 0.01 wavelength, measured clockwise from
  // the short circuit. The angle of gamma in degrees sits outside them, only
  // when the clear area is large enough (view.angles, set in place()).
  function drawRim(c) {
    const R = view.R, fs = Math.max(8, Math.min(11, R / 30));
    c.strokeStyle = 'rgba(122,146,158,0.55)'; c.lineWidth = 1;
    for (let i = 0; i < 50; i++) {
      const t = Math.PI - 2 * TAU * (i / 100), len = i % 5 === 0 ? 7 : 3.5;
      c.beginPath();
      c.moveTo(view.cx + (R + 2) * Math.cos(t), view.cy - (R + 2) * Math.sin(t));
      c.lineTo(view.cx + (R + 2 + len) * Math.cos(t), view.cy - (R + 2 + len) * Math.sin(t));
      c.stroke();
    }
    c.font = `${fs}px 'JetBrains Mono', monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(212,228,236,0.75)';
    for (let i = 0; i < 10; i++) {
      const w = i * 0.05, t = Math.PI - 2 * TAU * w, rr = R + 9 + fs;
      c.fillText(i ? w.toFixed(2).slice(1) : '0', view.cx + rr * Math.cos(t), view.cy - rr * Math.sin(t));
    }
    if (!view.angles) return;
    c.fillStyle = 'rgba(122,146,158,0.6)'; c.font = `${fs * 0.9}px 'JetBrains Mono', monospace`;
    for (let a = -150; a <= 180; a += 30) {
      const t = a * Math.PI / 180, rr = R + 16 + fs * 2.9;
      c.fillText(`${a}°`, view.cx + rr * Math.cos(t), view.cy - rr * Math.sin(t));
    }
    c.fillStyle = 'rgba(122,146,158,0.8)'; c.textAlign = 'left';
    c.fillText('λ toward generator ↻', view.cx + R * 0.72, view.cy - R * 1.02 - fs * 2.2);
  }
  function buildGrid() {
    gridCv.width = canvas.width; gridCv.height = canvas.height;
    const c = gctx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    const R = view.R;
    const bg = c.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, R);
    bg.addColorStop(0, 'rgba(80,220,232,0.045)'); bg.addColorStop(1, 'rgba(80,220,232,0.015)');
    c.fillStyle = bg; c.beginPath(); c.arc(view.cx, view.cy, R, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.arc(view.cx, view.cy, R + 0.5, 0, TAU); c.clip();
    const fine = R > 170 ? 1 : R / 170;
    if (G.grid !== 'z') drawFamily(c, COL.y, true, fine);
    if (G.grid !== 'y') drawFamily(c, COL.z, false, fine);
    c.restore();
    c.strokeStyle = 'rgba(212,228,236,0.6)'; c.lineWidth = 1.4;
    c.beginPath(); c.arc(view.cx, view.cy, R, 0, TAU); c.stroke();
    if (G.grid !== 'z') drawLabels(c, COL.y, true, G.grid === 'y', true);
    if (G.grid !== 'y') drawLabels(c, COL.z, false, true, false);
    if (G.rim) drawRim(c);
  }

  // --------------------------------------------------------------- overlays
  function dot(p, col, r, hollow) {
    ctx.beginPath(); ctx.arc(toX(p), toY(p), r, 0, TAU);
    if (hollow) { ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); }
    else { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = 'rgba(5,7,11,0.9)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  function tag(p, text, col, dx, dy) {
    const fs = Math.max(10, Math.min(13, view.R / 22));
    ctx.font = `500 ${fs}px 'JetBrains Mono', monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const x = toX(p) + dx, y = toY(p) + dy;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,11,0.85)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = col; ctx.fillText(text, x, y);
  }
  // A clockwise arc of the circle |gamma| from g, over a length l in wavelengths.
  function walkArc(g, l, col, dash) {
    const m = abs(g), a0 = arg(g), sweep = 2 * TAU * l;
    if (m < 1e-4 || sweep < 1e-4) return;
    ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(view.cx, view.cy, view.R * m, -a0, -a0 + sweep, false); ctx.stroke();
    ctx.setLineDash([]);
    // arrowhead at the end, along the clockwise tangent
    const e = a0 - sweep, p = { re: m * Math.cos(e), im: m * Math.sin(e) };
    const tx = Math.sin(e), ty = Math.cos(e), s = 8;
    const ex = toX(p), ey = toY(p);
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(ex + tx * s * 0.2, ey + ty * s * 0.2);
    ctx.lineTo(ex - tx * s + ty * s * 0.5, ey - ty * s - tx * s * 0.5);
    ctx.lineTo(ex - tx * s - ty * s * 0.5, ey - ty * s + tx * s * 0.5);
    ctx.fill();
  }
  function drawOverlays(M) {
    const { g, gin, stubs } = M, m = abs(g);
    if (G.circle && m > 1e-3) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(252,163,94,0.5)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(view.cx, view.cy, view.R * Math.min(m, 1), 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (G.loadMode === 'rlc') {
      ctx.strokeStyle = 'rgba(252,163,94,0.65)'; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i <= 400; i++) {
        const f = F_MIN * Math.pow(F_MAX / F_MIN, i / 400), q = zToGamma(norm(loadZAt(f)));
        if (i) ctx.lineTo(toX(q), toY(q)); else ctx.moveTo(toX(q), toY(q));
      }
      ctx.stroke();
      const q0 = zToGamma(norm(loadZAt(F_MIN))), q1 = zToGamma(norm(loadZAt(F_MAX)));
      tag(q0, fmtF(F_MIN), COL.dim, 8, 0); tag(q1, fmtF(F_MAX), COL.dim, 8, 0);
    }
    if (G.stub !== 'off' && stubs.length) {
      // the g = 1 circle: center -0.5, radius 0.5 in the gamma plane
      ctx.strokeStyle = 'rgba(126,224,160,0.35)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(view.cx - view.R * 0.5, view.cy, view.R * 0.5, 0, TAU); ctx.stroke();
      const s = stubs[Math.min(G.stubSol, stubs.length - 1)];
      walkArc(g, s.d, COL.stub, [6, 4]);
      // the stub moves y = 1 + jb along g = 1 to y = 1
      ctx.strokeStyle = COL.stub; ctx.lineWidth = 2.2; ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const y = cx(1, s.b * (1 - i / 60)), q = RF.div(RF.sub(cx(1), y), RF.add(cx(1), y));
        if (i) ctx.lineTo(toX(q), toY(q)); else ctx.moveTo(toX(q), toY(q));
      }
      ctx.stroke();
      dot(s.gammaD, COL.stub, 4.5);
      dot(cx(0), COL.stub, 5.5);
      tag(s.gammaD, `d ${s.d.toFixed(3)}λ`, COL.stub, 9, -12);
    }
    if (G.len > 0) {
      walkArc(g, G.len, COL.zin);
      dot(gin, COL.zin, 5.5);
      tag(gin, 'Zin', COL.zin, 9, 12);
    }
    if (G.grid === 'z' && m > 1e-3 && m < 1.001) {
      const yp = cx(-g.re, -g.im);
      ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(229,139,208,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(toX(g), toY(g)); ctx.lineTo(toX(yp), toY(yp)); ctx.stroke(); ctx.setLineDash([]);
      dot(yp, 'rgba(229,139,208,0.9)', 4.5, true);
      tag(yp, 'YL', 'rgba(229,139,208,0.95)', 8, -11);
    }
    dot(g, COL.load, 7);
    tag(g, 'ZL', COL.load, 11, -13);
  }

  // ----------------------------------------------------------------- layout
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    gridKey = ''; dirty = true;
  }
  const shown = el => el && getComputedStyle(el).display !== 'none';
  // The part of the canvas that no panel, dock, or bar covers.
  function clearRect() {
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    const top = document.querySelector('.topbar');
    if (shown(top)) y0 = Math.max(y0, top.getBoundingClientRect().bottom - 6);
    for (const id of ['status', 'dock']) {
      const el = $(id);
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top > H * 0.5) y1 = Math.min(y1, r.top);
    }
    const p = $('panel').getBoundingClientRect();
    if (p.width >= W * 0.9) { if (p.top < H) y1 = Math.min(y1, p.top); }
    else if (p.left < W / 2) { if (p.right > 0) x0 = Math.max(x0, p.right); }
    else if (p.left < W) x1 = Math.min(x1, p.left);
    return { x0, y0, x1, y1 };
  }
  function place() {
    const c = clearRect();
    const span = Math.min(c.x1 - c.x0, c.y1 - c.y0);
    view.angles = span >= 520;
    const pad = G.rim ? (view.angles ? 58 : 30) : 12;
    const tR = Math.max(40, Math.min(c.x1 - c.x0, c.y1 - c.y0) / 2 - pad);
    const tx = (c.x0 + c.x1) / 2, ty = (c.y0 + c.y1) / 2;
    if (!view.ready) { view.cx = tx; view.cy = ty; view.R = tR; view.ready = true; return true; }
    const k = 0.3, d = Math.abs(tx - view.cx) + Math.abs(ty - view.cy) + Math.abs(tR - view.R);
    if (d < 0.3) { view.cx = tx; view.cy = ty; view.R = tR; return false; }
    view.cx += (tx - view.cx) * k; view.cy += (ty - view.cy) * k; view.R += (tR - view.R) * k;
    return true;
  }

  // ------------------------------------------------------------------- loop
  function frame(t) {
    const dt = Math.min(0.1, (t - (lastT || t)) / 1000); lastT = t;
    if (G.walking) {
      G.len = (G.len + dt * WALK_RATE) % 0.5;
      $('len').value = G.len;
      dirty = true;
    }
    const moved = place();
    if (moved || dirty) {
      const key = `${W}|${H}|${view.cx.toFixed(1)}|${view.cy.toFixed(1)}|${view.R.toFixed(1)}|${G.grid}|${G.rim}|${view.angles}`;
      if (key !== gridKey) { buildGrid(); gridKey = key; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(gridCv, 0, 0);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const M = model();
      drawOverlays(M);
      refresh(M);
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- readout
  let lastRead = '';
  function refresh(M) {
    const { Z, z, g, gin, stubs } = M, m = abs(g);
    const Y = inv(Z), zinO = RF.scale(gammaToZ(gin), G.z0);
    const rows = {
      rdZ: fmtC(Z, 'Ω'),
      rdz: fmtC(z),
      rdY: abs(Z) < 1e-9 ? '∞ (short)' : fmtC(RF.scale(Y, 1000), 'mS'),
      rdG: `${m.toFixed(3)} ∠ ${deg(arg(g)).toFixed(1)}°`,
      rdS: m >= 0.9995 ? '∞' : RF.vswr(m).toFixed(2),
      rdRL: m < 1e-6 ? '∞ dB' : `${RF.returnLossDb(m).toFixed(2)} dB`,
      rdML: m >= 0.9995 ? '∞ dB' : `${RF.mismatchLossDb(m).toFixed(3)} dB`,
      rdW: m < 1e-4 ? '—' : `${wtg(g).toFixed(3)} λ  WTG`,
      rdBL: `${G.len.toFixed(3)} λ  ·  ${(G.len * 720).toFixed(1)}°`,
      rdZin: fmtC(zinO, 'Ω'),
    };
    if (G.loadMode === 'rlc') {
      const f0 = 1 / (TAU * Math.sqrt(G.rlcL * 1e-9 * G.rlcC * 1e-12));
      rows.rdF0 = `${fmtF(f0)}  (f ${fmtF(rlcF())})`;
    }
    let stubText = '', hint = '';
    if (G.stub !== 'off') {
      if (m < 1e-4) { stubText = 'matched'; hint = 'The load is matched. No stub is necessary.'; }
      else if (!stubs.length) { stubText = 'none'; hint = 'No match: |Γ| = 1, so the load has no resistance to transform to Z0.'; }
      else {
        const s = stubs[Math.min(G.stubSol, stubs.length - 1)];
        stubText = `d ${s.d.toFixed(3)}λ · l ${s.l.toFixed(3)}λ`;
        hint = `At d = ${s.d.toFixed(3)}λ from the load, y = 1 ${s.b < 0 ? '−' : '+'} j${Math.abs(s.b).toFixed(3)}. ${G.stub === 'open' ? 'An' : 'A'} ${G.stub}-circuit stub of l = ${s.l.toFixed(3)}λ adds ${s.b < 0 ? '+' : '−'}j${Math.abs(s.b).toFixed(3)}, so y = 1.`;
      }
      rows.rdStub = stubText;
    }
    const key = JSON.stringify(rows) + hint;
    if (key === lastRead) return;
    lastRead = key;
    for (const id in rows) $(id).textContent = rows[id];
    $('rowF0').classList.toggle('off', G.loadMode !== 'rlc');
    $('rowStub').classList.toggle('off', G.stub === 'off');
    $('stubHint').textContent = hint;
    $('stubPick').classList.toggle('off', G.stub === 'off');
    for (const b of $('stubPick').children) b.disabled = +b.dataset.sol >= stubs.length;
    $('stMain').textContent = `z = ${fmtC(z)}`;
    $('stRight').textContent = `|Γ| ${m.toFixed(3)} · VSWR ${rows.rdS} · RL ${rows.rdRL}`;
  }

  // ---------------------------------------------------------------- pointer
  let drag = null;
  const tip = $('tip');
  function gammaAt(e) {
    const r = canvas.getBoundingClientRect();
    return cx((e.clientX - r.left - view.cx) / view.R, -(e.clientY - r.top - view.cy) / view.R);
  }
  function setLoadGamma(g) {
    const m = abs(g);
    if (m > G_MAX) g = RF.scale(g, G_MAX / m);
    const Z = RF.scale(gammaToZ(g), G.z0);
    G.R = Math.max(0, Z.re); G.X = Z.im;
    syncZ(); dirty = true;
  }
  function showTip(e, g) {
    const m = abs(g);
    if (m > 1.0 || e.pointerType === 'touch' && !drag) { tip.style.display = 'none'; return; }
    const z = gammaToZ(g), y = inv(z);
    tip.innerHTML = `<span class="cz">z ${fmtC(z)}</span><br><span class="cy">y ${fmtC(y)}</span><br>|Γ| ${m.toFixed(3)} · ${wtg(g).toFixed(3)}λ`;
    tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight, touch = e.pointerType !== 'mouse';
    let x = e.clientX + (touch ? -w / 2 : 16), yy = e.clientY + (touch ? -h - 44 : 16);
    x = Math.max(6, Math.min(W - w - 6, x)); yy = Math.max(6, Math.min(H - h - 6, yy));
    tip.style.left = x + 'px'; tip.style.top = yy + 'px';
  }
  function onPointer(e) {
    const g = gammaAt(e);
    if (e.type === 'pointerdown') {
      if (abs(g) > 1.06) return;
      if (G.loadMode !== 'z') { showTip(e, g); return; }
      drag = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      $('hint').classList.add('gone');
      setLoadGamma(g);
    } else if (e.type === 'pointermove') {
      if (drag === e.pointerId) setLoadGamma(g);
    } else {
      if (drag === e.pointerId) drag = null;
      if (e.pointerType !== 'mouse' || e.type === 'pointerleave') { tip.style.display = 'none'; return; }
    }
    showTip(e, g);
  }

  // --------------------------------------------------------------------- UI
  const rToS = r => Math.min(0.99, r / (1 + r));
  const sToR = s => s / (1 - s);
  const xToS = x => Math.max(-0.97, Math.min(0.97, 2 * Math.atan(x) / Math.PI));
  const sToX = s => Math.tan(Math.PI * s / 2);
  const numStr = v => (Math.abs(v) >= 1e6 ? v.toExponential(2) : (+v.toFixed(2)).toString());
  function syncZ() {
    $('rS').value = rToS(G.R / G.z0); $('xS').value = xToS(G.X / G.z0);
    if (document.activeElement !== $('rN')) $('rN').value = numStr(G.R);
    if (document.activeElement !== $('xN')) $('xN').value = numStr(G.X);
  }
  function setWalk(on) {
    G.walking = on;
    $('walkBtn').textContent = on ? '❚❚ STOP WALK' : '▶ WALK LINE';
    $('walkBtn').classList.toggle('on', on);
    $('dockPlay').textContent = on ? '❚❚' : '▶';
    $('dockPlay').classList.toggle('on', on);
    lastT = 0; dirty = true;
  }
  function setGrid(mode) {
    G.grid = mode;
    for (const b of document.querySelectorAll('[data-grid]')) b.classList.toggle('on', b.dataset.grid === mode);
    dirty = true;
  }
  function radio(groupId, attr, fn) {
    const btns = [...$(groupId).querySelectorAll(`[data-${attr}]`)];
    btns.forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      btns.forEach(o => o.classList.toggle('on', o === b));
      fn(b.dataset[attr], b); dirty = true;
    }));
  }
  function bindRange(id, key, fmtFn) {
    const inp = $(id), out = $(id + 'V');
    const show = () => { G[key] = +inp.value; out.textContent = fmtFn(+inp.value); };
    inp.value = G[key];
    inp.addEventListener('input', () => { show(); dirty = true; });
    show();
  }
  function renderEq() {
    if (!window.katex) return;
    try {
      katex.render('\\Gamma = \\dfrac{Z_L - Z_0}{Z_L + Z_0}', $('eq-gamma'), { throwOnError: false });
      katex.render('Z_{in} = Z_0\\,\\dfrac{Z_L + jZ_0\\tan\\beta\\ell}{Z_0 + jZ_L\\tan\\beta\\ell}', $('eq-zin'), { throwOnError: false });
    } catch (x) {}
  }

  function buildUI() {
    const setLoadMode = mode => {
      G.loadMode = mode;
      $('loadZ').classList.toggle('on', mode === 'z'); $('loadRLC').classList.toggle('on', mode === 'rlc');
      $('boxZ').classList.toggle('off', mode !== 'z'); $('boxRLC').classList.toggle('off', mode !== 'rlc');
      $('hint').textContent = mode === 'z' ? 'drag on the chart to move the load' : 'the trace is Z(f) of the series RLC';
      dirty = true;
    };
    $('loadZ').addEventListener('click', () => setLoadMode('z'));
    $('loadRLC').addEventListener('click', () => setLoadMode('rlc'));

    $('rS').addEventListener('input', e => { G.R = sToR(+e.target.value) * G.z0; syncZ(); dirty = true; });
    $('xS').addEventListener('input', e => { G.X = sToX(+e.target.value) * G.z0; syncZ(); dirty = true; });
    $('rN').addEventListener('input', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { G.R = Math.max(0, v); syncZ(); dirty = true; } });
    $('xN').addEventListener('input', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { G.X = v; syncZ(); dirty = true; } });
    for (const id of ['rN', 'xN']) $(id).addEventListener('blur', syncZ);
    for (const b of $('presets').children) b.addEventListener('click', () => {
      G.R = +b.dataset.r * G.z0; G.X = +b.dataset.x * G.z0; syncZ(); dirty = true;
    });

    bindRange('rlcR', 'rlcR', v => `${v.toFixed(1)}`);
    bindRange('rlcL', 'rlcL', v => `${v.toFixed(1)}`);
    bindRange('rlcC', 'rlcC', v => `${v.toFixed(1)}`);
    bindRange('rlcF', 'rlcT', () => fmtF(rlcF()).replace(' MHz', '').replace(' GHz', 'G'));

    radio('z0Presets', 'z0', v => { G.z0 = +v; syncZ(); });
    const lenOut = $('lenV');
    const showLen = () => { lenOut.textContent = `${G.len.toFixed(3)} λ`; };
    $('len').addEventListener('input', e => { G.len = +e.target.value; setWalk(false); showLen(); });
    $('walkBtn').addEventListener('click', () => setWalk(!G.walking));
    $('dockPlay').addEventListener('click', () => setWalk(!G.walking));
    $('lenReset').addEventListener('click', () => { setWalk(false); G.len = 0; $('len').value = 0; showLen(); });
    setInterval(() => { if (G.walking) showLen(); }, 100);
    showLen();

    radio('stubModes', 'stub', v => { G.stub = v; lastRead = ''; });
    radio('stubPick', 'sol', v => { G.stubSol = +v; });
    for (const b of document.querySelectorAll('[data-grid]')) b.addEventListener('click', () => setGrid(b.dataset.grid));
    $('circleBtn').addEventListener('click', e => {
      G.circle = !G.circle; e.target.textContent = `|Γ| CIRCLE · ${G.circle ? 'ON' : 'OFF'}`;
      e.target.classList.toggle('on', G.circle); dirty = true;
    });
    $('rimBtn').addEventListener('click', e => {
      G.rim = !G.rim; e.target.textContent = `RIM SCALE · ${G.rim ? 'ON' : 'OFF'}`;
      e.target.classList.toggle('on', G.rim); dirty = true;
    });

    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(t, onPointer);

    const panel = $('panel'), dockPanel = $('dockPanel');
    function setOpen(open) {
      panel.classList.toggle('open', open);
      if (!open) panel.classList.remove('full');
      document.body.classList.toggle('panel-closed', !open);
      dockPanel.classList.toggle('on', open);
      dockPanel.setAttribute('aria-expanded', String(open));
    }
    const toggle = () => setOpen(!panel.classList.contains('open'));
    $('gear').addEventListener('click', toggle);
    dockPanel.addEventListener('click', toggle);
    $('panelClose').addEventListener('click', () => setOpen(false));
    setOpen(!PHONE_Q.matches);                  // start closed on phones
    PHONE_Q.addEventListener('change', e => setOpen(!e.matches));

    // The grip of the phone sheet. A tap switches half and full height. A drag
    // up gives full height. A drag down gives half height, then closes.
    const grip = $('sheetGrip');
    let gripY = null;
    grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
    grip.addEventListener('pointerup', e => {
      if (gripY === null) return;
      const dy = e.clientY - gripY; gripY = null;
      if (Math.abs(dy) < 8) panel.classList.toggle('full');
      else if (dy < -40) panel.classList.add('full');
      else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
    });
    grip.addEventListener('pointercancel', () => { gripY = null; });

    syncZ();
    renderEq();
  }

  // ------------------------------------------------------------------- boot
  window.addEventListener('resize', resize);
  resize();
  buildUI();
  setTimeout(() => $('hint').classList.add('gone'), 6000);   // it sits on the -90 degree label
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { gridKey = ''; dirty = true; });
  requestAnimationFrame(frame);
})();
