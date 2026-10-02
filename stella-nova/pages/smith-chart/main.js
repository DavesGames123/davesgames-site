/* ============================================================================
   SMITH CHART  ·  main script  (2D canvas, global RF from rf.js)
   ----------------------------------------------------------------------------
   rf.js does the math. This script owns the state, draws the chart and the
   overlays, and binds the panel. All drawing is in the plane of gamma:
       gamma (re, im)  ->  screen (cx + R*re, cy - R*im)
   The Z grid and the Y grid use the same plane. The Y grid is the Z grid
   turned by 180 degrees, so one point gives z on one grid and y on the other.

   STATE (S). The load is kept in ohms (S.R, S.X), not normalized. A change
   of Z0 then moves the point, as it does for a real load on a new line.
   The four point forms (R + jX, |gamma|, VSWR, S11 dB, each with a phase)
   are views of the same S.R, S.X. A load model (a sweep) sets S.mode to its
   own id and gives Z at f through SC.models[id].zAt(f).

   FIELDS. SC.field() binds a text input that reads engineering units
   (rf.js parseEng). Typing updates the state when the text parses. Enter
   or blur writes the value back in a clean form. Up and Down change the
   value, Shift for a larger step.

   EXTENSION (window.SC). Other scripts add features through hooks:
     SC.hooks.overlay   fn(ctx, M)  draw on the chart, under the load point
     SC.hooks.top       fn(ctx, M)  draw on the chart, over the load point
     SC.hooks.readout   fn(M)       update their panel part
     SC.hooks.copy      fn(M)       return lines for "copy results"
     SC.hooks.state     { get() -> object, set(object) }  for the URL
     SC.hooks.key       fn(e) -> true when the key was used
     SC.models[id]      { zAt(f) -> Z ohms | null, label }  load models
   M (from model()) is { f, Z, z, g, gin, Zin, len, ok }. ok is false when
   the model has no value at f (for example f outside a Touchstone file).

   LAYERS. buildGrid draws the grid and the rim into an offscreen canvas. It
   runs again only when the chart moves, resizes, or changes grid mode.
   frame() copies that canvas, then draws the overlays and the points.

   GREP MAP
     grep -n 'const S = '            the state and its defaults
     grep -n 'function model'        the load and the line at f
     grep -n 'function field'        the engineering-unit text field
     grep -n 'function buildGrid'    the Z and Y grid lines and labels
     grep -n 'function drawRim'      the wavelength and angle scales
     grep -n 'function drawOverlays' the circle, the line walk, the points
     grep -n 'function frame'        the render loop
     grep -n 'function clearRect'    the overlay margins that fit the chart
     grep -n 'function refresh'      the readout and the status bar
     grep -n 'function cursorText'   the hover cursor readout
     grep -n 'function onPointer'    drag the load, and the cursor
     grep -n 'function buildUI'      the panel bindings
     grep -n 'function setOpen'      the panel, the phone sheet, and the dock
     grep -n 'window.snSaver'        the shell screensaver hook

   FRAMING. The panel, the dock, and the bars cover parts of the canvas.
   clearRect() measures them each frame. The chart center and radius then
   ease to fit the clear part, so the chart follows a sliding panel.
   ========================================================================== */
(() => {
  'use strict';
  const { cx, abs, arg, zToGamma, gammaToZ, towardGen, wtg, inv, fmtEng, parseEng } = RF;
  const TAU = Math.PI * 2;
  const WALK_RATE = 0.04;                  // wavelengths per second
  const G_MAX = 0.995;                     // drag limit for |gamma|
  const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
  const COL = { z: '80,220,232', y: '229,139,208', load: '#fca35e', zin: '#9db4ff', match: '#7ee0a0', ink: '#e6eef6', dim: '#71859a' };
  const FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

  // Grid lines: [value, extent]. An r circle runs for |x| <= extent. An x arc
  // runs for r <= extent. A minor line stops on a major line, as on a paper chart.
  const LINES = [
    [0.1, 2], [0.2, Infinity], [0.3, 2], [0.4, 2], [0.5, Infinity], [0.6, 2], [0.7, 2], [0.8, 2], [0.9, 2],
    [1, Infinity], [1.5, 5], [2, Infinity], [3, 5], [4, 5], [5, Infinity], [10, Infinity], [20, Infinity],
  ];
  const MAJOR = new Set([0.2, 0.5, 1, 2, 5]);
  const LABELS = [0.2, 0.5, 1, 2, 5];

  const S = {
    z0: 50, f: 1e9, vf: 1,
    mode: 'z', R: 60, X: -80,
    len: 0, dir: 'gen', walking: false,
    grid: 'z', circle: true, rim: true,
  };
  const POINT_MODES = new Set(['z', 'g', 'vswr', 's11']);

  const $ = id => document.getElementById(id);
  const canvas = $('chart'), ctx = canvas.getContext('2d');
  const gridCv = document.createElement('canvas'), gctx = gridCv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const view = { cx: 0, cy: 0, R: 100, ready: false, angles: true };
  let gridKey = '', dirty = true, lastT = 0;

  const SC = window.SC = {
    S, RF, COL, FONT, view, POINT_MODES,
    hooks: { overlay: [], top: [], readout: [], copy: [], state: [], key: [] },
    models: {},
    setDirty() { dirty = true; },
    gridDirty() { gridKey = ''; dirty = true; },
  };

  // ------------------------------------------------------------------ model
  const lenSigned = () => (S.dir === 'load' ? -S.len : S.len);
  function loadZ(f) {
    if (POINT_MODES.has(S.mode)) return cx(S.R, S.X);
    const m = SC.models[S.mode];
    return m ? m.zAt(f) : null;
  }
  const norm = Z => cx(Z.re / S.z0, Z.im / S.z0);
  function model() {
    const f = S.f, Z = loadZ(f);
    if (!Z || isNaN(Z.re) || isNaN(Z.im)) return { f, ok: false, len: lenSigned() };
    const z = norm(Z), g = zToGamma(z), len = lenSigned();
    const gin = towardGen(g, len);
    return { f, Z, z, g, gin, Zin: RF.scale(gammaToZ(gin), S.z0), len, ok: true };
  }
  SC.model = model;
  SC.loadZ = loadZ;

  // ---------------------------------------------------------------- helpers
  const toX = g => view.cx + view.R * g.re;
  const toY = g => view.cy - view.R * g.im;
  SC.toX = toX; SC.toY = toY;
  function fmtN(v) {
    if (!isFinite(v)) return '∞';
    const a = Math.abs(v);
    if (a >= 1e5) return v.toExponential(2);
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }
  function fmtC(c, unit) {
    if (!isFinite(c.re) || !isFinite(c.im) || abs(c) > 1e9) return '∞ (open)';
    const s = `${fmtN(c.re)} ${c.im < 0 ? '−' : '+'} j${fmtN(Math.abs(c.im))}`;
    return unit ? `${s} ${unit}` : s;
  }
  const deg = t => t * 180 / Math.PI;
  const fmtG = g => `${abs(g).toFixed(3)} ∠ ${deg(arg(g)).toFixed(1)}°`;
  const fmtVswr = m => (m >= 0.99995 ? '∞' : RF.vswr(m).toFixed(m > 0.9 ? 1 : 2));
  const fmtRL = m => (m < 1e-6 ? '∞ dB' : `${RF.returnLossDb(m).toFixed(2)} dB`);
  const fmtPart = p => (p.kind ? fmtEng(p.value, p.kind === 'L' ? 'H' : 'F') : '—');
  Object.assign(SC, { fmtN, fmtC, fmtG, fmtVswr, fmtRL, fmtPart, deg });

  // ------------------------------------------------------------------ field
  // A text input that reads engineering units.
  //   get()        the value to show
  //   set(v)       store a parsed value; return false to reject it
  //   unit         the unit for the clean form (fmtEng), '' for none
  //   fmt(v)       a custom clean form (overrides unit)
  //   kind         'pos': Up/Down scale by 1% (Shift 10%)
  //                'lin': Up/Down add step (Shift 10 * step)
  //   step         the step for 'lin'
  // The field shows the clean form whenever it does not have the focus.
  const fields = [];
  function field(input, o) {
    const box = input.closest('.fld') || input;
    const clean = v => (o.fmt ? o.fmt(v) : fmtEng(v, '', o.sig || 4, true));
    const show = () => { if (document.activeElement !== input) input.value = clean(o.get()); };
    const take = () => {
      const v = parseEng(input.value);
      const ok = isFinite(v) && o.set(v) !== false;
      box.classList.toggle('bad', !ok);
      if (ok) dirty = true;
      return ok;
    };
    input.addEventListener('input', take);
    input.addEventListener('blur', () => { box.classList.remove('bad'); input.value = clean(o.get()); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { take(); input.value = clean(o.get()); input.select(); e.preventDefault(); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const d = e.key === 'ArrowUp' ? 1 : -1, v = o.get();
      let n;
      if (o.kind === 'pos') n = v > 0 ? v * Math.pow(e.shiftKey ? 1.1 : 1.01, d) : (o.step || 1) * Math.max(0, d);
      else n = v + d * (o.step || 1) * (e.shiftKey ? 10 : 1);
      if (o.set(n) !== false) { input.value = clean(o.get()); dirty = true; }
    });
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('enterkeyhint', 'done');
    const f = { input, show };
    fields.push(f); show();
    return f;
  }
  SC.field = field;
  SC.syncFields = () => fields.forEach(f => f.show());

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
  SC.curve = curve;
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
    // the real axis
    c.strokeStyle = `rgba(${rgb},0.55)`; c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(cxS - R, cyS); c.lineTo(cxS + R, cyS); c.stroke();
  }
  function drawLabels(c, rgb, flip, rim, below) {
    const fs = Math.max(9, Math.min(12, view.R / 26));
    c.font = `${fs}px ${FONT}`;
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
    c.strokeStyle = 'rgba(113,133,154,0.6)'; c.lineWidth = 1;
    for (let i = 0; i < 50; i++) {
      const t = Math.PI - 2 * TAU * (i / 100), len = i % 5 === 0 ? 7 : 3.5;
      c.beginPath();
      c.moveTo(view.cx + (R + 2) * Math.cos(t), view.cy - (R + 2) * Math.sin(t));
      c.lineTo(view.cx + (R + 2 + len) * Math.cos(t), view.cy - (R + 2 + len) * Math.sin(t));
      c.stroke();
    }
    c.font = `${fs}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(230,238,246,0.75)';
    for (let i = 0; i < 10; i++) {
      const w = i * 0.05, t = Math.PI - 2 * TAU * w, rr = R + 9 + fs;
      c.fillText(i ? w.toFixed(2).slice(1) : '0', view.cx + rr * Math.cos(t), view.cy - rr * Math.sin(t));
    }
    if (!view.angles) return;
    c.fillStyle = 'rgba(113,133,154,0.7)'; c.font = `${fs * 0.9}px ${FONT}`;
    for (let a = -150; a <= 180; a += 30) {
      const t = a * Math.PI / 180, rr = R + 16 + fs * 2.9;
      c.fillText(`${a}°`, view.cx + rr * Math.cos(t), view.cy - rr * Math.sin(t));
    }
    c.fillStyle = 'rgba(113,133,154,0.85)'; c.textAlign = 'left';
    c.fillText('λ toward generator ↻', view.cx + R * 0.72, view.cy - R * 1.02 - fs * 2.2);
  }
  function buildGrid() {
    gridCv.width = canvas.width; gridCv.height = canvas.height;
    const c = gctx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    const R = view.R;
    const bg = c.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, R);
    bg.addColorStop(0, 'rgba(80,220,232,0.05)'); bg.addColorStop(1, 'rgba(80,220,232,0.015)');
    c.fillStyle = bg; c.beginPath(); c.arc(view.cx, view.cy, R, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.arc(view.cx, view.cy, R + 0.5, 0, TAU); c.clip();
    const fine = R > 170 ? 1 : R / 170;
    if (S.grid !== 'z') drawFamily(c, COL.y, true, fine);
    if (S.grid !== 'y') drawFamily(c, COL.z, false, fine);
    c.restore();
    c.strokeStyle = 'rgba(230,238,246,0.6)'; c.lineWidth = 1.4;
    c.beginPath(); c.arc(view.cx, view.cy, R, 0, TAU); c.stroke();
    if (S.grid !== 'z') drawLabels(c, COL.y, true, S.grid === 'y', true);
    if (S.grid !== 'y') drawLabels(c, COL.z, false, true, false);
    if (S.rim) drawRim(c);
  }

  // --------------------------------------------------------------- overlays
  function dot(p, col, r, hollow) {
    ctx.beginPath(); ctx.arc(toX(p), toY(p), r, 0, TAU);
    if (hollow) { ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); }
    else { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = 'rgba(6,8,12,0.9)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  function tag(p, text, col, dx, dy) {
    const fs = Math.max(10, Math.min(13, view.R / 22));
    ctx.font = `500 ${fs}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const x = toX(p) + dx, y = toY(p) + dy;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(6,8,12,0.85)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = col; ctx.fillText(text, x, y);
  }
  // An arc of the circle |gamma| from g, over a length l in wavelengths.
  // l > 0 turns clockwise (toward the generator), l < 0 counterclockwise.
  function walkArc(g, l, col, dash) {
    const m = abs(g), a0 = arg(g), sweep = 2 * TAU * l;
    if (m < 1e-4 || Math.abs(sweep) < 1e-4) return;
    ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(view.cx, view.cy, view.R * m, -a0, -a0 + sweep, sweep < 0); ctx.stroke();
    ctx.setLineDash([]);
    // arrowhead at the end, along the tangent of travel
    const e = a0 - sweep, p = { re: m * Math.cos(e), im: m * Math.sin(e) };
    const sg = sweep > 0 ? 1 : -1, tx = sg * Math.sin(e), ty = sg * Math.cos(e), s = 8;
    const ex = toX(p), ey = toY(p);
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(ex + tx * s * 0.2, ey + ty * s * 0.2);
    ctx.lineTo(ex - tx * s + ty * s * 0.5, ey - ty * s - tx * s * 0.5);
    ctx.lineTo(ex - tx * s - ty * s * 0.5, ey - ty * s + tx * s * 0.5);
    ctx.fill();
  }
  // A path of z values (normalized), drawn on the chart.
  function zPath(zs, col, width, dash) {
    ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = width || 2.2; ctx.beginPath();
    zs.forEach((z, i) => { const q = zToGamma(z); if (i) ctx.lineTo(toX(q), toY(q)); else ctx.moveTo(toX(q), toY(q)); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  Object.assign(SC, { ctx, dot, tag, walkArc, zPath });

  function drawOverlays(M) {
    for (const h of SC.hooks.overlay) h(ctx, M);
    if (!M.ok) return;
    const { g, gin } = M, m = abs(g);
    if (S.circle && m > 1e-3) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(252,163,94,0.5)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(view.cx, view.cy, view.R * Math.min(m, 1), 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (S.len > 0) {
      walkArc(g, M.len, COL.zin);
      dot(gin, COL.zin, 5.5);
      tag(gin, 'Zin', COL.zin, 9, 12);
    }
    if (S.grid === 'z' && m > 1e-3 && m < 1.001) {
      const yp = cx(-g.re, -g.im);
      ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(229,139,208,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(toX(g), toY(g)); ctx.lineTo(toX(yp), toY(yp)); ctx.stroke(); ctx.setLineDash([]);
      dot(yp, 'rgba(229,139,208,0.9)', 4.5, true);
      tag(yp, 'YL', 'rgba(229,139,208,0.95)', 8, -11);
    }
    dot(g, COL.load, 7);
    tag(g, 'ZL', COL.load, 11, -13);
    for (const h of SC.hooks.top) h(ctx, M);
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
    for (const el of document.querySelectorAll('[data-occlude]')) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.left > (x0 + x1) / 2) x1 = Math.min(x1, r.left);
    }
    return { x0, y0, x1, y1 };
  }
  function place() {
    const c = clearRect();
    const span = Math.min(c.x1 - c.x0, c.y1 - c.y0);
    view.angles = span >= 520;
    const pad = S.rim ? (view.angles ? 58 : 30) : 12;
    const tR = Math.max(40, span / 2 - pad);
    const tx = (c.x0 + c.x1) / 2, ty = (c.y0 + c.y1) / 2;
    if (!view.ready) { view.cx = tx; view.cy = ty; view.R = tR; view.ready = true; return true; }
    const k = 0.3, d = Math.abs(tx - view.cx) + Math.abs(ty - view.cy) + Math.abs(tR - view.R);
    if (d < 0.3) { view.cx = tx; view.cy = ty; view.R = tR; return false; }
    view.cx += (tx - view.cx) * k; view.cy += (ty - view.cy) * k; view.R += (tR - view.R) * k;
    return true;
  }

  // ------------------------------------------------------------------- loop
  function frame(t) {
    // The next frame is asked for first, so an error in a hook does not stop
    // the loop.
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - (lastT || t)) / 1000); lastT = t;
    if (S.walking) {
      S.len = (S.len + dt * WALK_RATE) % 0.5;
      $('len').value = S.len;
      dirty = true;
    }
    const moved = place();
    if (moved || dirty) {
      const key = `${W}|${H}|${view.cx.toFixed(1)}|${view.cy.toFixed(1)}|${view.R.toFixed(1)}|${S.grid}|${S.rim}|${view.angles}`;
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
  }

  // ---------------------------------------------------------------- readout
  // The rows of the readout for a model M, as text. "copy results" uses the
  // same rows.
  function readRows(M) {
    if (!M.ok) {
      const dash = '—';
      return { rdZ: dash, rdz: dash, rdY: dash, rdG: dash, rdGri: dash, rdS: dash, rdRL: dash, rdML: dash, rdQ: dash, rdSer: dash, rdPar: dash, rdW: dash, rdZin: dash, rdGin: dash };
    }
    const { Z, z, g, gin, Zin, f } = M, m = abs(g);
    const open = !isFinite(Z.re) || abs(z) > 1e9;
    const Y = inv(Z), eq = RF.equivalent(Z, f);
    const wl = wtg(g);
    return {
      rdZ: fmtC(Z, 'Ω'),
      rdz: fmtC(z),
      rdY: abs(Z) < 1e-12 ? '∞ (short)' : open ? '0 mS' : fmtC(RF.scale(Y, 1000), 'mS'),
      rdG: fmtG(g),
      rdGri: `${g.re.toFixed(4)} ${g.im < 0 ? '−' : '+'} j${Math.abs(g.im).toFixed(4)}`,
      rdS: fmtVswr(m),
      rdRL: fmtRL(m),
      rdML: m >= 0.99995 ? '∞ dB' : `${RF.mismatchLossDb(m).toFixed(3)} dB`,
      rdQ: open || Z.re <= 0 ? '∞' : RF.qOf(z).toFixed(3),
      rdSer: open ? 'open' : `${fmtEng(eq.series.R, 'Ω', 4)} + ${eq.series.part.kind ? (eq.series.part.kind === 'L' ? 'L ' : 'C ') + fmtPart(eq.series.part) : '—'}`,
      rdPar: abs(Z) < 1e-12 ? 'short' : `${isFinite(eq.parallel.R) ? fmtEng(eq.parallel.R, 'Ω', 4) : '∞ Ω'} ∥ ${eq.parallel.part.kind ? (eq.parallel.part.kind === 'L' ? 'L ' : 'C ') + fmtPart(eq.parallel.part) : '—'}`,
      rdW: m < 1e-4 ? '—' : `${wl.toFixed(3)} λ WTG · ${((0.5 - wl) % 0.5).toFixed(3)} λ WTL`,
      rdZin: fmtC(Zin, 'Ω'),
      rdGin: `${fmtG(gin)} · VSWR ${fmtVswr(abs(gin))}`,
    };
  }
  SC.readRows = readRows;
  let lastRead = '';
  function refresh(M) {
    const rows = readRows(M);
    const lenNote = lenText();
    const key = JSON.stringify(rows) + S.len + S.dir + S.f + S.mode + lenNote;
    for (const h of SC.hooks.readout) h(M);
    if (key === lastRead) return;
    lastRead = key;
    for (const id in rows) $(id).textContent = rows[id];
    for (const tr of document.querySelectorAll('.readout tr.zin')) tr.classList.toggle('off', !(S.len > 0));
    $('readAt').textContent = `@ ${fmtEng(S.f, 'Hz', 4)}`;
    $('lenNote').textContent = lenNote;
    $('stMain').textContent = M.ok ? `Z ${rows.rdZ}` : 'no load at f';
    $('stRight').textContent = M.ok ? `|Γ| ${abs(M.g).toFixed(3)} · VSWR ${rows.rdS} · RL ${rows.rdRL} · ${fmtEng(S.f, 'Hz', 4)}` : '';
    SC.syncFields();
  }
  SC.lastReadReset = () => { lastRead = ''; dirty = true; };
  // The line length in degrees and in millimetres at f and vf.
  function lenText() {
    const lam = RF.lambdaOf(S.f, S.vf);
    const mm = S.len * lam * 1000;
    return `${(S.len * 360).toFixed(1)}° of line · ${mm >= 1000 ? (mm / 1000).toFixed(3) + ' m' : mm.toFixed(2) + ' mm'} at ${fmtEng(S.f, 'Hz', 4)}, vf ${S.vf}. λ = ${(lam * 1000).toFixed(2)} mm.`;
  }

  // --------------------------------------------------------- hover cursor
  const tip = $('tip');
  // The readout of any point g on the chart (not the load).
  function cursorText(g) {
    const m = abs(g), z = gammaToZ(g), y = inv(z), Z = RF.scale(z, S.z0);
    return `<b>Z ${fmtC(Z, 'Ω')}</b><br><span class="cz">z ${fmtC(z)}</span> · <span class="cy">y ${fmtC(y)}</span><br>`
      + `Γ ${fmtG(g)} · VSWR ${fmtVswr(m)}<br>RL ${fmtRL(m)} · Q ${z.re > 0 ? RF.qOf(z).toFixed(2) : '∞'} · ${wtg(g).toFixed(3)} λ`;
  }
  SC.cursorText = cursorText;

  // ---------------------------------------------------------------- pointer
  let drag = null;
  function gammaAt(e) {
    const r = canvas.getBoundingClientRect();
    return cx((e.clientX - r.left - view.cx) / view.R, -(e.clientY - r.top - view.cy) / view.R);
  }
  SC.gammaAt = gammaAt;
  function setLoadGamma(g) {
    const m = abs(g);
    if (m > G_MAX) g = RF.scale(g, G_MAX / m);
    const Z = RF.scale(gammaToZ(g), S.z0);
    S.R = Math.max(0, Z.re); S.X = Z.im;
    dirty = true;
  }
  function showTip(e, g) {
    const m = abs(g);
    if (m > 1.0 || e.pointerType === 'touch' && !drag) { tip.style.display = 'none'; return; }
    tip.innerHTML = cursorText(g);
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
      if (!POINT_MODES.has(S.mode)) { showTip(e, g); return; }
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
  function setWalk(on) {
    S.walking = on;
    $('walkBtn').textContent = on ? 'Stop walk' : 'Walk line';
    $('walkBtn').classList.toggle('on', on);
    $('dockPlay').textContent = on ? '❚❚' : '▶';
    $('dockPlay').classList.toggle('on', on);
    lastT = 0; dirty = true;
  }
  function setGrid(mode) {
    S.grid = mode;
    for (const b of document.querySelectorAll('[data-grid]')) b.classList.toggle('on', b.dataset.grid === mode);
    dirty = true;
  }
  // Exclusive buttons in one group. fn(value) runs on a click.
  function radio(groupEl, attr, fn) {
    const btns = [...groupEl.querySelectorAll(`[data-${attr}]`)];
    btns.forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      btns.forEach(o => o.classList.toggle('on', o === b));
      fn(b.dataset[attr], b); dirty = true;
    }));
    return v => btns.forEach(o => o.classList.toggle('on', o.dataset[attr] === String(v)));
  }
  SC.radio = radio;

  // The labels of the two point fields in each form: [text, unit, symbol].
  // The symbol key selects an inline MathJax symbol from window.SMITH_SYM
  // (equations.js). Without a key, the label stays text.
  const POINT_FORMS = {
    z: { a: ['R', 'Ω', 'R'], b: ['X', 'Ω', 'X'] },
    g: { a: ['|Γ|', '', 'absG'], b: ['∠', '°'] },
    vswr: { a: ['VSWR', ''], b: ['∠', '°'] },
    s11: { a: ['S11', 'dB'], b: ['∠', '°'] },
  };
  const curG = () => zToGamma(norm(cx(S.R, S.X)));
  const setG = g => {
    if (abs(g) > 1) return false;
    const Z = abs(sub1(g)) < 1e-12 ? cx(1e12, 0) : RF.scale(gammaToZ(g), S.z0);
    S.R = Math.max(0, Z.re); S.X = Z.im;
  };
  const sub1 = g => cx(1 - g.re, -g.im);
  const phase = () => deg(arg(curG()));
  // Field A and field B, by form. The phase field is the same in 3 forms.
  const FORM_IO = {
    z: {
      a: { get: () => S.R, set: v => { if (v < 0) return false; S.R = v; }, kind: 'pos', fmt: v => fmtEng(v, '', 4, true) },
      b: { get: () => S.X, set: v => { S.X = v; }, kind: 'lin', step: 1, fmt: v => fmtEng(v, '', 4, true) },
    },
    g: {
      a: { get: () => abs(curG()), set: v => (v >= 0 && v <= 1 ? setG(RF.polar(v, phase() * Math.PI / 180)) : false), kind: 'lin', step: 0.01, fmt: v => v.toFixed(4) },
    },
    vswr: {
      a: { get: () => RF.vswr(abs(curG())), set: v => (v >= 1 ? setG(RF.gammaFrom('vswr', v, phase())) : false), kind: 'pos', step: 1, fmt: v => (isFinite(v) ? (+v.toFixed(4)).toString() : '∞') },
    },
    s11: {
      a: { get: () => -RF.returnLossDb(abs(curG())), set: v => setG(RF.gammaFrom('db', v, phase())), kind: 'lin', step: 0.1, fmt: v => (isFinite(v) ? v.toFixed(2) : '−∞') },
    },
  };
  const PHASE_IO = { get: () => phase(), set: v => setG(RF.polar(abs(curG()), v * Math.PI / 180)), kind: 'lin', step: 1, fmt: v => v.toFixed(2) };
  // The A and B fields delegate to the current form, so one pair of inputs
  // serves all four forms.
  const ioA = k => (...a) => { const io = FORM_IO[S.mode] && FORM_IO[S.mode].a; return io ? io[k](...a) : (k === 'get' ? NaN : false); };
  const ioB = k => (...a) => { const io = S.mode === 'z' ? FORM_IO.z.b : PHASE_IO; return io[k](...a); };
  function setPointForm(mode) {
    S.mode = mode;
    const F = POINT_FORMS[mode];
    const label = (el, [text, , sym]) => {
      const svg = sym && window.SMITH_SYM && window.SMITH_SYM[sym];
      if (sym) el.dataset.sym = sym; else delete el.dataset.sym;
      if (svg) el.innerHTML = svg; else el.textContent = text;
    };
    label($('pfA'), F.a); $('pfAu').textContent = F.a[1];
    label($('pfB'), F.b); $('pfBu').textContent = F.b[1];
    $('presets').classList.toggle('off', mode !== 'z');
    SC.syncFields();
  }
  SC.setPointForm = setPointForm;
  SC.setLoadMode = mode => {
    for (const b of document.querySelectorAll('#secLoad [data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    const point = POINT_MODES.has(mode);
    $('pointFields').classList.toggle('off', !point);
    $('presets').classList.toggle('off', mode !== 'z');
    $('loadNote').classList.toggle('off', !point);
    for (const el of document.querySelectorAll('[data-model-box]')) el.classList.toggle('off', el.dataset.modelBox !== mode);
    if (point) setPointForm(mode); else S.mode = mode;
    $('hint').textContent = point ? 'Drag on the chart to move the load' : 'The trace is Z(f) of the load model';
    SC.lastReadReset();
  };

  function buildUI() {
    field($('fZ0'), { get: () => S.z0, set: v => { if (!(v > 0)) return false; S.z0 = v; SC.gridDirty(); }, kind: 'pos', fmt: v => fmtEng(v, '', 4, true) });
    field($('fF'), { get: () => S.f, set: v => { if (!(v > 0)) return false; S.f = v; }, kind: 'pos', fmt: v => fmtEng(v, '', 4, true) });
    field($('fVf'), { get: () => S.vf, set: v => { if (!(v > 0 && v <= 1)) return false; S.vf = v; }, kind: 'lin', step: 0.01, fmt: v => (+v.toFixed(4)).toString() });
    for (const b of $('z0Chips').querySelectorAll('[data-z0]')) b.addEventListener('click', () => { S.z0 = +b.dataset.z0; SC.lastReadReset(); });
    for (const b of $('z0Chips').querySelectorAll('[data-vf]')) b.addEventListener('click', () => { S.vf = +b.dataset.vf; SC.lastReadReset(); });

    field($('fA'), { get: ioA('get'), set: ioA('set'), get kind() { return (FORM_IO[S.mode] && FORM_IO[S.mode].a.kind) || 'lin'; }, get step() { return (FORM_IO[S.mode] && FORM_IO[S.mode].a.step) || 1; }, fmt: v => { const io = FORM_IO[S.mode] && FORM_IO[S.mode].a; return io ? io.fmt(v) : ''; } });
    field($('fB'), { get: ioB('get'), set: ioB('set'), get kind() { return S.mode === 'z' ? 'lin' : 'lin'; }, get step() { return 1; }, fmt: v => (S.mode === 'z' ? FORM_IO.z.b.fmt(v) : PHASE_IO.fmt(v)) });
    for (const b of $('loadTabs').querySelectorAll('[data-mode]')) b.addEventListener('click', () => SC.setLoadMode(b.dataset.mode));
    for (const b of $('presets').children) b.addEventListener('click', () => {
      S.R = +b.dataset.r * S.z0; S.X = +b.dataset.x * S.z0; SC.lastReadReset();
    });

    field($('fLen'), { get: () => S.len, set: v => { if (!(v >= 0)) return false; S.len = v % 0.5; $('len').value = S.len; setWalk(false); }, kind: 'lin', step: 0.001, fmt: v => v.toFixed(4) });
    $('len').addEventListener('input', e => { S.len = +e.target.value; setWalk(false); dirty = true; });
    radio($('dirTabs'), 'dir', v => { S.dir = v; });
    $('walkBtn').addEventListener('click', () => setWalk(!S.walking));
    $('dockPlay').addEventListener('click', () => setWalk(!S.walking));
    $('lenReset').addEventListener('click', () => { setWalk(false); S.len = 0; $('len').value = 0; dirty = true; });

    for (const b of document.querySelectorAll('[data-grid]')) b.addEventListener('click', () => setGrid(b.dataset.grid));
    $('circleBtn').addEventListener('click', e => { S.circle = !S.circle; e.currentTarget.classList.toggle('on', S.circle); dirty = true; });
    $('rimBtn').addEventListener('click', e => { S.rim = !S.rim; e.currentTarget.classList.toggle('on', S.rim); dirty = true; });

    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(t, onPointer);

    // Keys on the page (not in a field): G cycles the grid. Other scripts
    // add keys through SC.hooks.key.
    window.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      for (const h of SC.hooks.key) if (h(e)) { e.preventDefault(); return; }
      if (e.key === 'g' || e.key === 'G') { setGrid({ z: 'y', y: 'zy', zy: 'z' }[S.grid]); e.preventDefault(); }
    });

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
    SC.setGrid = setGrid; SC.setWalk = setWalk;
  }

  // -------------------------------------------------------------- screensaver
  // Shell screensaver hook (lib/screensaver.js). enter() hides the GUI, so
  // clearRect() gives the full window and place() eases the chart to it. The
  // autopilot moves the load on a slow loop in the gamma plane, eases the
  // line length from 0 to 0.5 wavelength and back, and turns the grid
  // through Z, Z + Y and Y three times per dwell, with a canvas fade. A top
  // hook draws the load values on the canvas and fills the background under
  // the chart, so a recording is opaque. SC.saverOn stops the hash write.
  window.snSaver = {
    enter(opts) {
      const calm = Math.max(0, Math.min(1, +opts.calm || 0)), sp = 1 - 0.6 * calm;
      const st = document.createElement('style');
      st.textContent = 'html.saver #panel,html.saver .topbar,html.saver #status,html.saver #dock,html.saver #hint,html.saver #tip,'
        + 'html.saver #gear,html.saver #toast,html.saver [data-occlude]{display:none!important}html.saver #chart{cursor:none}';
      document.head.appendChild(st); document.documentElement.classList.add('saver');
      SC.saverOn = true;
      S.mode = 'z'; S.dir = 'gen'; S.circle = true; S.rim = true; setWalk(false);
      if (SC.tools) { SC.tools.T.spec = 2; SC.tools.T.q = 0; SC.tools.T.marks = []; }
      const grids = ['z', 'zy', 'y'], hold = Math.max(10, (+opts.seconds || 60) / 3), FADE = 0.8;
      let gi = (opts.seed >>> 0) % 3, t = 0, tg = 0, last = 0;
      const ph = ((opts.seed >>> 0) % 997) / 997 * TAU;
      setGrid(grids[gi]);
      saverLabel = opts.labels !== false && typeof opts.label === 'function' ? opts.label : null;
      clearInterval(saverTimer);
      if (saverLabel) saverTimer = setInterval(saverPlate, 1000);
      SC.hooks.top.push((c, M) => {
        c.save(); c.globalCompositeOperation = 'destination-over'; c.fillStyle = '#06080c'; c.fillRect(0, 0, W, H); c.restore();
        c.font = `500 13px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
        const m = abs(M.g), x = 28;
        c.fillStyle = COL.load; c.fillText(`ZL  ${fmtC(M.Z, 'Ω')}   |Γ| ${m.toFixed(3)}   VSWR ${fmtVswr(m)}`, x, H - 48);
        c.fillStyle = COL.zin; c.fillText(`Zin ${fmtC(M.Zin, 'Ω')}   ${(S.len).toFixed(3)} λ toward the generator`, x, H - 26);
        c.fillStyle = COL.dim; c.fillText({ z: 'Z grid', zy: 'Z + Y grid', y: 'Y grid' }[S.grid], x, 34);
        const f = Math.max(0, 1 - tg / FADE, 1 - (hold - tg) / FADE);
        if (f > 0) { c.fillStyle = `rgba(6,8,12,${Math.min(1, f)})`; c.fillRect(0, 0, W, H); }
      });
      (function drive(now) {
        requestAnimationFrame(drive);
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
        t += dt * sp; tg += dt;
        if (tg > hold) { tg = 0; gi = (gi + 1) % 3; setGrid(grids[gi]); saverPlate(); }
        // The load: |gamma| from 0.2 to 0.75, the angle turns slowly.
        const r = 0.47 + 0.27 * Math.sin(t * 0.21 + ph), a = ph + t * 0.09 + 0.6 * Math.sin(t * 0.13);
        const Z = RF.scale(gammaToZ(cx(r * Math.cos(a), r * Math.sin(a))), S.z0);
        S.R = Math.max(0, Z.re); S.X = Z.im;
        S.len = 0.25 * (1 - Math.cos(t * 0.17));
        dirty = true;
      })(0);
      saverPlate();
      return { canvas, warmupMs: 1500 };
    },
    exit() { saverLabel = null; clearInterval(saverTimer); saverTimer = 0; },
  };
  // The plate (opts.label) names the grid and shows the load point that
  // model() gives: Z0, ZL, z = ZL/Z0, gamma with its angle, VSWR and return
  // loss (rf.js), then the line length and Zin, gamma_in toward the
  // generator. The equations are the ones that zToGamma(), RF.vswr() and
  // towardGen() compute. The autopilot sets S.R, S.X and S.len each frame.
  let saverLabel = null, saverTimer = 0;
  function saverPlate() {
    if (!saverLabel) return;
    const M = model(), gname = { z: 'Z grid', zy: 'Z + Y grid', y: 'Y grid' }[S.grid] || 'Z grid';
    const lines = ['Z₀ = ' + fmtN(S.z0) + ' Ω · f = ' + fmtEng(S.f, 'Hz', 4)];
    if (M.ok) {
      const m = abs(M.g), gd = v => deg(arg(v)).toFixed(1) + '°', rl = RF.returnLossDb(m);
      lines.push('Z_L = ' + fmtC(M.Z, 'Ω') + ' · z = ' + fmtC(M.z));
      lines.push('Γ = ' + m.toFixed(3) + ' ∠ ' + gd(M.g) + ' · VSWR = ' + fmtVswr(m) + ' · return loss ' + (isFinite(rl) ? rl.toFixed(1) + ' dB' : '∞'));
      lines.push('ℓ = ' + M.len.toFixed(3) + ' λ toward the generator · Γ_in ∠ ' + gd(M.gin));
      lines.push('Z_in = ' + fmtC(M.Zin, 'Ω'));
    }
    saverLabel({
      title: 'Smith chart · ' + gname,
      sub: 'lossless line · the load moves on a slow loop in the Γ plane',
      lines,
      eq: ['Γ = (Z − Z₀)/(Z + Z₀) = (z − 1)/(z + 1)',
        'VSWR = (1 + |Γ|)/(1 − |Γ|),   RL = −20 log₁₀|Γ|',
        'Γ_in = Γ e^(−j4πℓ/λ)',
        'Z_in = Z₀ (1 + Γ_in)/(1 − Γ_in)'],
    });
  }

  // ------------------------------------------------------------------- boot
  window.addEventListener('resize', resize);
  resize();
  buildUI();
  setTimeout(() => $('hint').classList.add('gone'), 6000);   // it sits on the -90 degree label
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { gridKey = ''; dirty = true; });
  // Other scripts load after this one. They register in this task, so the
  // first frame waits one task for them.
  setTimeout(() => requestAnimationFrame(frame), 0);
})();
