/* ============================================================================
   SMITH CHART  ·  tools.js  (chart tools and sharing, uses SC and RF)
   ----------------------------------------------------------------------------
   Chart tools:
     Q circle       the curves |x| / r = Q (0 is off)
     spec circle    a constant-VSWR circle for a target, for example 2
     markers        up to 8 pinned impedances (ohms, with the f of the pin).
                    The button or P pins the load. Shift + click on the
                    chart pins the point under the pointer. They stay in
                    ohms, so a change of Z0 moves them as real loads.
   Sharing:
     copy results   the readout, the match, the model and the markers as
                    plain text on the clipboard
     copy link      the page URL with the state in the hash
     URL state      the hash holds the state as key=value pairs (Z0, f,
                    vf, load, line, grid, tools, and the state hooks of
                    match.js and sweep.js). The page reads it at load and
                    writes it back with location.replace, so no history
                    entry is added. In the Stella Nova shell, the shell
                    copies the frame hash into its own URL.

   GREP MAP
     grep -n 'function drawTools'   Q circles, spec circle, markers
     grep -n 'function pin'         add a marker
     grep -n 'function copyText'    the "copy results" text
     grep -n 'function stateString' the hash, from the state
     grep -n 'function applyState'  the state, from the hash
   ========================================================================== */
(() => {
  'use strict';
  const { S, RF } = SC;
  const { cx, abs, fmtEng, zToGamma } = RF;
  const $ = id => document.getElementById(id);
  const T = { q: 0, spec: 0, marks: [] };      // marks: [{ R, X, f }]
  const MAX_MARKS = 8;
  const MARK_COL = '#ffd166';

  // ------------------------------------------------------------- drawing
  function drawTools(ctx, M) {
    const v = SC.view;
    if (T.q > 0) {
      ctx.strokeStyle = 'rgba(255,209,102,0.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
      for (const s of [1, -1]) SC.curve(ctx, t => RF.scale(cx(1, s * T.q), Math.tan(t)), 0, Math.PI / 2 - 1e-4, 160, false);
      ctx.setLineDash([]);
      const g = zToGamma(RF.scale(cx(1, T.q), 0.35));
      SC.tag(g, `Q ${T.q}`, 'rgba(255,209,102,0.9)', -40, -10);
    }
    if (T.spec > 1) {
      const m = (T.spec - 1) / (T.spec + 1);
      ctx.strokeStyle = 'rgba(126,224,160,0.55)'; ctx.lineWidth = 1.3; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(v.cx, v.cy, v.R * m, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      SC.tag(cx(-m * 0.7071, m * 0.7071), `VSWR ${T.spec}`, 'rgba(126,224,160,0.9)', -64, -10);
    }
  }
  function drawMarks(ctx) {
    T.marks.forEach((k, i) => {
      const g = zToGamma(cx(k.R / S.z0, k.X / S.z0)), x = SC.toX(g), y = SC.toY(g), s = 5.5;
      ctx.fillStyle = MARK_COL; ctx.strokeStyle = 'rgba(6,8,12,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      SC.tag(g, `M${i + 1}`, MARK_COL, -30, 10);   // left and below: ZL is right and above
    });
  }

  // ------------------------------------------------------------- markers
  function pin(Z, f) {
    if (!Z || !isFinite(Z.re) || !isFinite(Z.im)) return;
    if (T.marks.length >= MAX_MARKS) T.marks.shift();
    T.marks.push({ R: Z.re, X: Z.im, f });
    renderMarks(); SC.setDirty();
  }
  let lastMarks = '';
  function renderMarks() {
    const key = JSON.stringify(T.marks) + S.z0;
    if (key === lastMarks) return;
    lastMarks = key;
    $('markList').innerHTML = T.marks.map((k, i) => {
      const g = zToGamma(cx(k.R / S.z0, k.X / S.z0)), m = abs(g);
      return `<li><span class="mk">M${i + 1}</span><span class="mv">${SC.fmtC(cx(k.R, k.X), 'Ω')}<br><small>VSWR ${SC.fmtVswr(m)} · RL ${SC.fmtRL(m)} · ${fmtEng(k.f, 'Hz', 4)}</small></span><button data-del="${i}" aria-label="Remove M${i + 1}">✕</button></li>`;
    }).join('');
    $('markClear').disabled = !T.marks.length;
  }

  // ------------------------------------------------------------ copy text
  function copyText() {
    const M = SC.model(), rows = SC.readRows(M);
    const lines = [
      `Smith chart  ·  Z0 ${fmtEng(S.z0, 'Ω', 4)}  ·  f ${fmtEng(S.f, 'Hz', 4)}  ·  vf ${S.vf}`,
      `Z ${rows.rdZ}   (z ${rows.rdz})`,
      `Y ${rows.rdY}`,
      `Γ ${rows.rdG}   (${rows.rdGri})`,
      `VSWR ${rows.rdS}   RL ${rows.rdRL}   ML ${rows.rdML}   Q ${rows.rdQ}`,
      `series ${rows.rdSer}   parallel ${rows.rdPar}`,
    ];
    if (S.len > 0) lines.push(`after ${S.len.toFixed(4)} λ toward ${S.dir === 'load' ? 'load' : 'generator'}: Zin ${rows.rdZin}, Γin ${rows.rdGin}`);
    for (const h of SC.hooks.copy) for (const l of h(M)) lines.push(l);
    T.marks.forEach((k, i) => {
      const m = abs(zToGamma(cx(k.R / S.z0, k.X / S.z0)));
      lines.push(`M${i + 1} ${SC.fmtC(cx(k.R, k.X), 'Ω')}  VSWR ${SC.fmtVswr(m)}  RL ${SC.fmtRL(m)}  @ ${fmtEng(k.f, 'Hz', 4)}`);
    });
    lines.push(location.href);
    return lines.join('\n');
  }
  function toClipboard(text, msg) {
    const done = ok => toast(ok ? msg : 'Copy failed: select the text by hand.');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(true), () => done(fallback(text)));
    else done(fallback(text));
  }
  function fallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }
  let toastT = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 1800);
  }

  // ------------------------------------------------------------ URL state
  const num = v => fmtEng(v, '', 6, true);
  function stateString() {
    const o = { z0: num(S.z0), f: num(S.f), vf: S.vf, m: S.mode };
    if (SC.POINT_MODES.has(S.mode)) { o.r = num(S.R); o.x = num(S.X); }
    if (S.len > 0) { o.l = S.len.toFixed(4); if (S.dir === 'load') o.d = 'load'; }
    if (S.grid !== 'z') o.g = S.grid;
    if (!S.circle) o.c = 0;
    if (T.q > 0) o.q = T.q;
    if (T.spec > 1) o.vs = T.spec;
    if (T.marks.length) o.mk = T.marks.map(k => `${num(k.R)}_${num(k.X)}_${num(k.f)}`).join('~');
    for (const h of SC.hooks.state) {
      const p = h.get();
      for (const k in p) o[k] = typeof p[k] === 'number' ? num(p[k]) : p[k];
    }
    return new URLSearchParams(o).toString();
  }
  function applyState(hash) {
    const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    if (![...q.keys()].length) return false;
    const n = k => RF.parseEng(q.get(k));
    if (n('z0') > 0) S.z0 = n('z0');
    if (n('f') > 0) S.f = n('f');
    if (n('vf') > 0 && n('vf') <= 1) S.vf = n('vf');
    if (isFinite(n('r')) && n('r') >= 0) S.R = n('r');
    if (isFinite(n('x'))) S.X = n('x');
    if (n('l') >= 0) { S.len = n('l') % 0.5; $('len').value = S.len; }
    if (q.get('d') === 'load') { S.dir = 'load'; for (const b of document.querySelectorAll('#dirTabs [data-dir]')) b.classList.toggle('on', b.dataset.dir === 'load'); }
    if (/^(z|y|zy)$/.test(q.get('g'))) SC.setGrid(q.get('g'));
    if (q.get('c') === '0') { S.circle = false; $('circleBtn').classList.remove('on'); }
    if (n('q') > 0) T.q = n('q');
    if (n('vs') > 1) T.spec = n('vs');
    if (q.get('mk')) {
      T.marks = q.get('mk').split('~').map(s => s.split('_').map(RF.parseEng))
        .filter(a => a.length === 3 && a.every(isFinite)).slice(0, MAX_MARKS).map(([R, X, f]) => ({ R, X, f }));
    }
    const o = Object.fromEntries(q.entries());
    for (const h of SC.hooks.state) h.set(o);
    const mode = q.get('m');
    if (mode && (SC.POINT_MODES.has(mode) || SC.models[mode])) SC.setLoadMode(mode);
    return true;
  }
  // The hash is written only when the state differs from the state at
  // load, so a plain visit keeps a clean URL.
  let baseState = '', lastHash = '', writeT = 0;
  function scheduleWrite() {
    if (SC.saverOn) return;               // the screensaver writes no hash
    clearTimeout(writeT);
    writeT = setTimeout(() => {
      const s = stateString();
      if (s === lastHash) return;
      if (s === baseState && !location.hash) return;
      lastHash = s;
      try { location.replace('#' + s); } catch (e) {}
    }, 400);
  }

  // -------------------------------------------------------------- binding
  SC.field($('fQ'), { get: () => T.q, set: v => { if (!(v >= 0)) return false; T.q = v; }, kind: 'lin', step: 0.5, fmt: v => (v ? (+v.toFixed(3)).toString() : '0') });
  SC.field($('fSpec'), { get: () => T.spec, set: v => { if (!(v === 0 || v > 1)) return false; T.spec = v; }, kind: 'lin', step: 0.1, fmt: v => (v ? (+v.toFixed(3)).toString() : '0') });
  $('markPin').addEventListener('click', () => { const M = SC.model(); if (M.ok) pin(M.Z, M.f); });
  $('markClear').addEventListener('click', () => { T.marks = []; renderMarks(); SC.setDirty(); });
  $('markList').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    T.marks.splice(+b.dataset.del, 1); renderMarks(); SC.setDirty();
  });
  $('copyBtn').addEventListener('click', () => toClipboard(copyText(), 'Results copied'));
  $('linkBtn').addEventListener('click', () => { lastHash = ''; const s = stateString(); try { location.replace('#' + s); } catch (e) {} toClipboard(location.href, 'Link copied'); });
  // Shift + click on the chart pins the point under the pointer. The
  // capture phase runs first, so the load does not move.
  $('chart').addEventListener('pointerdown', e => {
    if (!e.shiftKey) return;
    const g = SC.gammaAt(e);
    if (abs(g) > 1) return;
    e.stopImmediatePropagation();
    pin(RF.scale(RF.gammaToZ(g), S.z0), S.f);
  }, true);
  SC.hooks.overlay.push(drawTools);
  SC.hooks.overlay.push(drawMarks);           // under the load point, so ZL stays readable
  SC.hooks.readout.push(() => { renderMarks(); scheduleWrite(); });
  SC.hooks.copy.push(() => (T.q > 0 || T.spec > 1 ? [`chart: ${T.q > 0 ? 'Q circle ' + T.q : ''}${T.q > 0 && T.spec > 1 ? ', ' : ''}${T.spec > 1 ? 'spec VSWR ' + T.spec : ''}`] : []));
  SC.hooks.key.push(e => {
    if (e.key === 'p' || e.key === 'P') { const M = SC.model(); if (M.ok) pin(M.Z, M.f); return true; }
    if (e.key === 'w' || e.key === 'W') { SC.setWalk(!S.walking); return true; }
    return false;
  });

  // Read the hash after every script has registered its hooks.
  setTimeout(() => {
    baseState = stateString();
    if (applyState(location.hash)) { lastHash = stateString(); SC.lastReadReset(); }
    SC.syncFields();
    renderMarks();
  }, 0);
  SC.tools = { T, copyText, stateString, applyState, pin };
})();
