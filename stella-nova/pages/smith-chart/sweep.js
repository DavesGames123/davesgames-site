/* ============================================================================
   SMITH CHART  ·  sweep.js  (load models over frequency, uses SC and RF)
   ----------------------------------------------------------------------------
   Three load models give Z at any f (SC.models):
     series     R + jwL + 1/(jwC)          (rf.js seriesRLC)
     parallel   R || L || C                (rf.js parallelRLC)
     file       a Touchstone .s1p/.s2p     (rf.js parseTouchstone; S11 only)
   The load at the design frequency f is the point that the readout and the
   Match section use. The Sweep section sets a span (start, stop) and draws:
     on the chart   the trace of gamma(f) over the span, with the start and
                    stop frequencies, and the best match (minimum |gamma|)
     in the panel   |S11| in dB against f (#sweepPlot). A -10 dB line marks
                    VSWR 1.92. A click or drag on the plot sets f.
   A file loads from the file button, from a paste, or by a drop of the file
   on the page. The file data does not go in the URL.

   GREP MAP
     grep -n 'const P = '          model parameters and the span
     grep -n 'function freqs'      the sweep frequencies (log or linear)
     grep -n 'function sweep'      gamma and |S11| over the span
     grep -n 'function drawTrace'  the trace and its markers on the chart
     grep -n 'function drawPlot'   the |S11| plot in the panel
     grep -n 'function loadText'   parse a Touchstone text into P.file
     grep -n 'function example'    a made-up antenna file for a demo
   ========================================================================== */
(() => {
  'use strict';
  const { S, RF } = SC;
  const { cx, abs, fmtEng, zToGamma } = RF;
  const $ = id => document.getElementById(id);
  const N_PTS = 401;
  const P = {
    sR: 30, sL: 40e-9, sC: 6e-12,
    pR: 60, pL: 5e-9, pC: 2e-12,
    fa: 100e6, fb: 3e9,
    file: null,                         // { name, ref, points, fmt, ports }
  };

  SC.models.series = { label: 'series RLC', zAt: f => RF.seriesRLC(P.sR, P.sL, P.sC > 0 ? P.sC : Infinity, f) };
  SC.models.parallel = { label: 'parallel RLC', zAt: f => RF.parallelRLC(P.pR > 0 ? P.pR : Infinity, P.pL > 0 ? P.pL : Infinity, P.pC, f) };
  SC.models.file = {
    label: 'Touchstone file',
    zAt: f => {
      if (!P.file) return null;
      const g = RF.gammaAtFreq(P.file.points, f);
      return g ? RF.zFromGammaRef(g, P.file.ref) : null;
    },
  };
  const isModel = () => !!SC.models[S.mode];

  // ------------------------------------------------------------- the sweep
  // Log spacing when the span is more than a decade, else linear. A file
  // sweep uses the file points inside the span.
  function freqs() {
    if (S.mode === 'file' && P.file) return P.file.points.map(p => p.f).filter(f => f >= P.fa && f <= P.fb);
    const a = P.fa, b = P.fb, out = [];
    const log = b / a > 10;
    for (let i = 0; i < N_PTS; i++) {
      const t = i / (N_PTS - 1);
      out.push(log ? a * Math.pow(b / a, t) : a + (b - a) * t);
    }
    return out;
  }
  let cache = { key: '', pts: [] };
  // Each point: { f, g (relative to Z0), db (|S11| in dB) }.
  function sweep() {
    const key = `${S.mode}|${S.z0}|${P.fa}|${P.fb}|${P.sR}|${P.sL}|${P.sC}|${P.pR}|${P.pL}|${P.pC}|${P.file ? P.file.name + P.file.points.length : ''}`;
    if (key === cache.key) return cache.pts;
    const m = SC.models[S.mode], pts = [];
    if (m) for (const f of freqs()) {
      const Z = m.zAt(f);
      if (!Z) continue;
      const g = zToGamma(RF.scale(Z, 1 / S.z0)), a = abs(g);
      pts.push({ f, g, db: a > 0 ? 20 * Math.log10(a) : -120 });
    }
    cache = { key, pts };
    return pts;
  }
  const best = pts => pts.reduce((b, p) => (!b || p.db < b.db ? p : b), null);

  // ------------------------------------------------------------- the chart
  function drawTrace(ctx, M) {
    if (!isModel()) return;
    const pts = sweep();
    if (pts.length < 2) return;
    // the trace: a warm line that gets brighter toward the stop frequency
    ctx.lineWidth = 1.8;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1].g, b = pts[i].g, t = i / pts.length;
      ctx.strokeStyle = `rgba(252,163,94,${0.3 + 0.55 * t})`;
      ctx.beginPath(); ctx.moveTo(SC.toX(a), SC.toY(a)); ctx.lineTo(SC.toX(b), SC.toY(b)); ctx.stroke();
    }
    const s0 = pts[0], s1 = pts[pts.length - 1], bm = best(pts);
    SC.dot(s0.g, '#71859a', 3.5); SC.tag(s0.g, fmtEng(s0.f, 'Hz', 3), SC.COL.dim, 7, 0);
    SC.dot(s1.g, '#fca35e', 3.5); SC.tag(s1.g, fmtEng(s1.f, 'Hz', 3), SC.COL.load, 7, 0);
    // The best-match marker is left out when f is on it: the load point is there.
    if (bm && bm !== s0 && bm !== s1 && Math.abs(bm.f - S.f) > 2e-3 * S.f) {
      SC.dot(bm.g, SC.COL.match, 4, true);
      SC.tag(bm.g, `min ${bm.db.toFixed(1)} dB · ${fmtEng(bm.f, 'Hz', 4)}`, SC.COL.match, 8, 12);
    }
  }

  // --------------------------------------------------------- the |S11| plot
  const plot = $('sweepPlot'), pctx = plot.getContext('2d');
  let plotHover = null;
  const PAD = { l: 34, r: 8, t: 10, b: 20 };
  function plotGeom() {
    const w = plot.clientWidth, h = plot.clientHeight;
    return { w, h, x0: PAD.l, x1: w - PAD.r, y0: PAD.t, y1: h - PAD.b };
  }
  const logAxis = () => P.fb / P.fa > 10;
  function fx(f, G) {
    const t = logAxis() ? Math.log(f / P.fa) / Math.log(P.fb / P.fa) : (f - P.fa) / (P.fb - P.fa);
    return G.x0 + t * (G.x1 - G.x0);
  }
  function xf(x, G) {
    const t = Math.max(0, Math.min(1, (x - G.x0) / (G.x1 - G.x0)));
    return logAxis() ? P.fa * Math.pow(P.fb / P.fa, t) : P.fa + t * (P.fb - P.fa);
  }
  function drawPlot() {
    if (!isModel() || !plot.clientWidth) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5), G = plotGeom();
    if (plot.width !== Math.round(G.w * dpr) || plot.height !== Math.round(G.h * dpr)) { plot.width = Math.round(G.w * dpr); plot.height = Math.round(G.h * dpr); }
    const c = pctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, G.w, G.h);
    const pts = sweep();
    const lo = Math.min(-30, Math.floor(Math.min(...pts.map(p => p.db), -1) / 10) * 10);
    const fy = db => G.y0 + (Math.min(0, db) / lo) * (G.y1 - G.y0);
    c.font = `9px ${SC.FONT}`; c.fillStyle = '#71859a'; c.strokeStyle = 'rgba(120,200,232,0.10)'; c.lineWidth = 1;
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let d = 0; d >= lo; d -= 10) {
      const y = fy(d); c.beginPath(); c.moveTo(G.x0, y); c.lineTo(G.x1, y); c.stroke();
      c.fillText(`${d}`, G.x0 - 4, y);
    }
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const t of [0, 0.5, 1]) {
      const f = logAxis() ? P.fa * Math.pow(P.fb / P.fa, t) : P.fa + t * (P.fb - P.fa);
      c.fillText(fmtEng(f, 'Hz', 3), Math.max(G.x0 + 14, Math.min(G.x1 - 14, fx(f, G))), G.y1 + 5);
    }
    // -10 dB: VSWR 1.92
    c.setLineDash([3, 4]); c.strokeStyle = 'rgba(126,224,160,0.45)';
    c.beginPath(); c.moveTo(G.x0, fy(-10)); c.lineTo(G.x1, fy(-10)); c.stroke(); c.setLineDash([]);
    if (pts.length > 1) {
      c.strokeStyle = '#fca35e'; c.lineWidth = 1.6; c.beginPath();
      pts.forEach((p, i) => { const x = fx(p.f, G), y = fy(p.db); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.stroke();
      const bm = best(pts);
      if (bm) { c.fillStyle = '#7ee0a0'; c.beginPath(); c.arc(fx(bm.f, G), fy(bm.db), 3, 0, Math.PI * 2); c.fill(); }
    }
    // the design frequency f
    if (S.f >= P.fa && S.f <= P.fb) {
      const x = fx(S.f, G);
      c.strokeStyle = '#50dce8'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x, G.y0); c.lineTo(x, G.y1); c.stroke();
    }
    if (plotHover != null) {
      const f = xf(plotHover, G), m = SC.models[S.mode], Z = m && m.zAt(f);
      if (Z) {
        const db = 20 * Math.log10(Math.max(1e-6, abs(zToGamma(RF.scale(Z, 1 / S.z0)))));
        c.strokeStyle = 'rgba(230,238,246,0.35)'; c.beginPath(); c.moveTo(plotHover, G.y0); c.lineTo(plotHover, G.y1); c.stroke();
        c.fillStyle = '#e6eef6'; c.textAlign = plotHover > G.w / 2 ? 'right' : 'left'; c.textBaseline = 'top';
        c.fillText(`${fmtEng(f, 'Hz', 4)}  ${db.toFixed(1)} dB`, plotHover + (plotHover > G.w / 2 ? -5 : 5), G.y0 + 2);
      }
    }
  }
  // A click or drag on the plot sets f.
  let plotDrag = false;
  const plotF = e => xf(e.clientX - plot.getBoundingClientRect().left, plotGeom());
  plot.addEventListener('pointerdown', e => { plotDrag = true; try { plot.setPointerCapture(e.pointerId); } catch (x) {} S.f = plotF(e); SC.lastReadReset(); });
  plot.addEventListener('pointermove', e => {
    plotHover = e.clientX - plot.getBoundingClientRect().left;
    if (plotDrag) { S.f = plotF(e); SC.lastReadReset(); }
    drawPlot();
  });
  for (const t of ['pointerup', 'pointercancel']) plot.addEventListener(t, () => { plotDrag = false; });
  plot.addEventListener('pointerleave', () => { plotHover = null; drawPlot(); });

  // ------------------------------------------------------------ the panel
  let lastInfo = '';
  function readout(M) {
    $('secSweep').classList.toggle('off', !isModel());
    if (!isModel()) return;
    const pts = sweep(), bm = best(pts);
    let info = '';
    if (S.mode === 'series' && P.sL > 0 && P.sC > 0) info = `f0 = 1/(2π√LC) = ${fmtEng(1 / (2 * Math.PI * Math.sqrt(P.sL * P.sC)), 'Hz', 4)}. `;
    if (S.mode === 'parallel' && P.pL > 0 && P.pC > 0) info = `f0 = ${fmtEng(1 / (2 * Math.PI * Math.sqrt(P.pL * P.pC)), 'Hz', 4)}. `;
    if (bm) {
      info += `Best match ${(-bm.db).toFixed(2)} dB RL (VSWR ${SC.fmtVswr(Math.pow(10, bm.db / 20))}) at ${fmtEng(bm.f, 'Hz', 4)}.`;
      const band = bandAt(pts, -10);
      if (band) info += ` −10 dB band ${fmtEng(band[0], 'Hz', 4)} – ${fmtEng(band[1], 'Hz', 4)}.`;
    }
    if (!M.ok) info += ` f = ${fmtEng(S.f, 'Hz', 4)} is outside the data.`;
    if (info !== lastInfo) { $('sweepInfo').textContent = info; lastInfo = info; }
    drawPlot();
  }
  // The band around the best match where |S11| stays under th dB, or null.
  function bandAt(pts, th) {
    if (!pts.length) return null;
    let i = pts.indexOf(best(pts));
    if (pts[i].db > th) return null;
    let a = i, b = i;
    while (a > 0 && pts[a - 1].db <= th) a--;
    while (b < pts.length - 1 && pts[b + 1].db <= th) b++;
    return [pts[a].f, pts[b].f];
  }

  function loadText(text, name) {
    try {
      const t = RF.parseTouchstone(text, name);
      P.file = { name: name || 'pasted data', ...t };
      const ps = t.points;
      P.fa = ps[0].f; P.fb = ps[ps.length - 1].f;
      // f goes to the best match in the file (|gamma| relative to the file R)
      const bm = best(ps.map(p => ({ f: p.f, db: 20 * Math.log10(Math.max(1e-9, abs(p.g))) })));
      if (bm) S.f = bm.f;
      $('fileInfo').textContent = `${P.file.name}: ${ps.length} points, ${fmtEng(P.fa, 'Hz', 4)} – ${fmtEng(P.fb, 'Hz', 4)}, ${t.ports}-port, ${t.fmt}, R ${t.ref} Ω. f is set to the best match.`;
      $('fileInfo').classList.remove('bad');
      SC.setLoadMode('file');
      cache.key = '';
      SC.lastReadReset();
    } catch (e) {
      $('fileInfo').textContent = `Could not read the file: ${e.message}`;
      $('fileInfo').classList.add('bad');
    }
  }
  // A made-up 2.45 GHz antenna: a parallel RLC behind a short line, written
  // as a Touchstone DB file and read back by the real parser.
  function example() {
    const lines = ['! Example: a made-up 2.45 GHz antenna (parallel RLC + line), not a measurement', '# GHz S DB R 50'];
    for (let i = 0; i <= 200; i++) {
      const f = 2.0e9 + i * 1e9 / 200;
      const Zp = RF.parallelRLC(58, 0.42e-9, 10.05e-12, f);
      const z = RF.zIn(RF.scale(Zp, 1 / 50), 0.06 * f / 2.45e9);
      const g = zToGamma(z);
      lines.push(`${(f / 1e9).toFixed(4)} ${(20 * Math.log10(abs(g))).toFixed(4)} ${(RF.arg(g) * 180 / Math.PI).toFixed(3)}`);
    }
    return lines.join('\n') + '\n';
  }

  // ------------------------------------------------------------- binding
  const F = SC.field;
  const pos = (key, unit) => ({ get: () => P[key], set: v => { if (!(v >= 0)) return false; P[key] = v; cache.key = ''; }, kind: 'pos', fmt: v => (v === 0 ? '0' : fmtEng(v, '', 4, true)) });
  F($('fsR'), pos('sR')); F($('fsL'), pos('sL')); F($('fsC'), pos('sC'));
  F($('fpR'), pos('pR')); F($('fpL'), pos('pL')); F($('fpC'), pos('pC'));
  F($('fFa'), { get: () => P.fa, set: v => { if (!(v > 0 && v < P.fb)) return false; P.fa = v; cache.key = ''; }, kind: 'pos', fmt: v => fmtEng(v, '', 4, true) });
  F($('fFb'), { get: () => P.fb, set: v => { if (!(v > P.fa)) return false; P.fb = v; cache.key = ''; }, kind: 'pos', fmt: v => fmtEng(v, '', 4, true) });
  for (const b of $('modelTabs').querySelectorAll('[data-mode]')) b.addEventListener('click', () => {
    if (b.dataset.mode === 'file' && !P.file) { $('fileInfo').textContent = 'Open, paste or drop a .s1p or .s2p file. Only S11 is used.'; }
    SC.setLoadMode(b.dataset.mode);
  });
  $('fileInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    f.text().then(t => loadText(t, f.name));
    e.target.value = '';
  });
  $('pasteBtn').addEventListener('click', () => loadText($('pasteBox').value, 'pasted.s1p'));
  $('exampleBtn').addEventListener('click', () => { const t = example(); $('pasteBox').value = t; loadText(t, 'example-2g45.s1p'); });
  // a drop of a file anywhere on the page
  window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    f.text().then(t => loadText(t, f.name));
  });
  window.addEventListener('resize', () => drawPlot());

  SC.hooks.overlay.push(drawTrace);
  SC.hooks.readout.push(readout);
  SC.hooks.copy.push(M => {
    if (!isModel()) return [];
    const pts = sweep(), bm = best(pts), out = [`Load model: ${SC.models[S.mode].label}${S.mode === 'file' && P.file ? ' (' + P.file.name + ')' : ''}`];
    if (S.mode === 'series') out.push(`  R ${fmtEng(P.sR, 'Ω', 4)}, L ${fmtEng(P.sL, 'H', 4)}, C ${P.sC > 0 ? fmtEng(P.sC, 'F', 4) : 'none'}`);
    if (S.mode === 'parallel') out.push(`  R ${P.pR > 0 ? fmtEng(P.pR, 'Ω', 4) : 'none'}, L ${P.pL > 0 ? fmtEng(P.pL, 'H', 4) : 'none'}, C ${P.pC > 0 ? fmtEng(P.pC, 'F', 4) : 'none'}`);
    out.push(`  span ${fmtEng(P.fa, 'Hz', 4)} – ${fmtEng(P.fb, 'Hz', 4)}`);
    if (bm) out.push(`  best match ${(-bm.db).toFixed(2)} dB RL at ${fmtEng(bm.f, 'Hz', 4)}`);
    return out;
  });
  SC.hooks.state.push({
    // The model values go in the URL only when a model is the load.
    get: () => (isModel() ? { sr: P.sR, sl: P.sL, sc: P.sC, pr: P.pR, pl: P.pL, pc: P.pC, fa: P.fa, fb: P.fb } : {}),
    set: o => {
      for (const [k, key] of [['sr', 'sR'], ['sl', 'sL'], ['sc', 'sC'], ['pr', 'pR'], ['pl', 'pL'], ['pc', 'pC'], ['fa', 'fa'], ['fb', 'fb']]) {
        const v = RF.parseEng(o[k]);
        if (o[k] != null && v >= 0) P[key] = v;
      }
      if (!(P.fb > P.fa)) { P.fa = 100e6; P.fb = 3e9; }
      cache.key = '';
    },
  });
  SC.sweep = { P, sweep, loadText };
})();
