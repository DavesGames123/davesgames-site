/* ============================================================================
   RESONANCE TABLE  ·  main script
   ----------------------------------------------------------------------------
   Builds a grid of Lissajous cells. Column integer A drives the horizontal
   tone, row integer B drives the vertical tone. Each cell traces the closed
   loop of ratio A:B. A simple ratio is a sparse loop; a complex ratio is a
   denser loop. main.js colors each cell by consonance from the reduced ratio.

   GREP MAP
     grep -n 'AUDIO'      the Web Audio tone pair
     grep -n 'consonance' the ratio-complexity color map
     grep -n 'function drawCell'  the per-cell loop render
     grep -n 'function buildGrid' the grid construction
   ========================================================================== */
(() => {
  'use strict';

  const G = { N:7, baseHz:131, vol:55 };
  let CELL = 104;                   // logical cell size in px, fitted per build
  const PHASE = Math.PI / 2;        // quarter-turn offset gives a circle at 1:1
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let active = null;                // { A, B, el }

  // fit the cell so the grid fills the wrapper in both axes without scrolling
  function fitCell() {
    const wrap = document.getElementById('gridwrap');
    const cs = getComputedStyle(wrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const gap = window.innerWidth <= 768 ? 5 : 8;    // matches #grid gap in CSS
    const hdrW = 30, hdrH = 26;                       // the row/column header tracks
    const w = (wrap.clientWidth - padX) || 600, h = (wrap.clientHeight - padY) || 600;
    const cw = (w - hdrW - G.N * gap) / G.N;
    const ch = (h - hdrH - G.N * gap) / G.N;
    CELL = Math.max(40, Math.floor(Math.min(cw, ch)));
  }

  // --------------------------------------------------------------- magma ramp
  const MAGMA = [
    [0.001,0.000,0.014],[0.106,0.058,0.243],[0.271,0.063,0.454],[0.447,0.122,0.506],
    [0.624,0.184,0.494],[0.804,0.251,0.443],[0.945,0.376,0.365],[0.992,0.585,0.404],[0.988,0.992,0.749],
  ];
  function magma(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = t * (MAGMA.length - 1), i = Math.min(Math.floor(x), MAGMA.length - 2), f = x - i;
    const a = MAGMA[i], b = MAGMA[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  // --------------------------------------------------------------- INTERVAL
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const NAMES = {
    '1:1':'Unison','2:1':'Octave','3:2':'Fifth','4:3':'Fourth','5:4':'Maj 3rd',
    '6:5':'Min 3rd','5:3':'Maj 6th','8:5':'Min 6th','9:8':'Maj 2nd','15:8':'Maj 7th',
    '9:5':'Min 7th','7:5':'Tritone','7:4':'Harm 7th','7:6':'Sept 3rd','8:7':'Sept 2nd',
    '3:1':'Oct+5th','4:1':'2 oct','5:2':'Oct+M3','7:2':'','9:7':'','9:4':'',
  };
  function reduced(a, b) { const g = gcd(a, b) || 1; return [a / g, b / g]; }
  function nameFor(a, b) {
    const [p, q] = reduced(a, b);
    const hi = Math.max(p, q), lo = Math.min(p, q);
    return NAMES[hi + ':' + lo] || (p + ':' + q);
  }

  // --------------------------------------------------------------- consonance
  // Tenney height log2(p*q): 0 for the unison, larger for a complex ratio.
  function consonance(a, b) {
    const [p, q] = reduced(a, b);
    return Math.log2(p * q);
  }
  function cellColor(a, b) {
    const t = Math.min(consonance(a, b) / 6, 1);   // 0 consonant .. 1 dissonant
    const temp = 0.95 - 0.66 * t;                    // consonant = hot magma, dissonant = cold
    const c = magma(temp);
    return { rgb: `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`, alpha: 0.95 - 0.45 * t };
  }

  // ------------------------------------------------------------------ AUDIO
  let AC = null, oscX = null, oscY = null, master = null;
  function ensureAudio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = G.vol / 100 * 0.5;
    master.connect(AC.destination);
  }
  function playRatio(A, B) {
    ensureAudio(); stopTones();
    oscX = AC.createOscillator(); oscY = AC.createOscillator();
    const gx = AC.createGain(), gy = AC.createGain();
    oscX.type = oscY.type = 'sine';
    oscX.frequency.value = G.baseHz * A; oscY.frequency.value = G.baseHz * B;
    const t = AC.currentTime;
    gx.gain.setValueAtTime(0, t); gx.gain.linearRampToValueAtTime(0.5, t + 0.02);
    gy.gain.setValueAtTime(0, t); gy.gain.linearRampToValueAtTime(0.5, t + 0.02);
    oscX.connect(gx).connect(master); oscY.connect(gy).connect(master);
    oscX.start(); oscY.start();
  }
  function stopTones() {
    if (oscX) { try { oscX.stop(); oscY.stop(); } catch (e) {} oscX = oscY = null; }
  }

  // ------------------------------------------------------------------ drawCell
  function drawCell(canvas, A, B) {
    const cx = canvas.getContext('2d');
    canvas.width = Math.round(CELL * dpr); canvas.height = Math.round(CELL * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.fillStyle = '#08060e'; cx.fillRect(0, 0, CELL, CELL);
    const r = CELL * 0.38, mx = CELL / 2, my = CELL / 2;
    const { rgb, alpha } = cellColor(A, B);
    // the closed loop, drawn analytically because a whole ratio closes
    const N = 900;
    cx.globalCompositeOperation = 'lighter';
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.shadowColor = rgb; cx.shadowBlur = 10;
    cx.strokeStyle = rgb; cx.globalAlpha = alpha; cx.lineWidth = 1.7;
    cx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const X = mx + Math.cos(2 * Math.PI * A * u + PHASE) * r;
      const Y = my - Math.sin(2 * Math.PI * B * u) * r;
      i ? cx.lineTo(X, Y) : cx.moveTo(X, Y);
    }
    cx.stroke();
    cx.shadowBlur = 0; cx.globalAlpha = Math.min(1, alpha + 0.2); cx.lineWidth = 0.7;
    cx.strokeStyle = 'rgba(255,245,225,0.8)'; cx.stroke();
    cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ buildGrid
  function buildGrid() {
    stopTones(); active = null;
    fitCell();
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = 'auto repeat(' + G.N + ', ' + CELL + 'px)';

    // corner + column headers (A across the top)
    const corner = document.createElement('div');
    corner.className = 'hd corner'; corner.textContent = 'A→ / B↓';
    grid.appendChild(corner);
    for (let a = 1; a <= G.N; a++) {
      const h = document.createElement('div'); h.className = 'hd col'; h.textContent = a;
      grid.appendChild(h);
    }
    // one row per B
    for (let b = 1; b <= G.N; b++) {
      const rh = document.createElement('div'); rh.className = 'hd row'; rh.textContent = b;
      grid.appendChild(rh);
      for (let a = 1; a <= G.N; a++) {
        const cell = document.createElement('div');
        cell.className = 'cell'; cell.style.width = CELL + 'px'; cell.style.height = CELL + 'px';
        const cv = document.createElement('canvas');
        cell.appendChild(cv);
        const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = nameFor(a, b);
        nm.style.fontSize = Math.max(8, Math.min(15, CELL * 0.11)) + 'px';
        const lb = document.createElement('div'); lb.className = 'lbl'; lb.textContent = a + ':' + b;
        lb.style.fontSize = Math.max(9, Math.min(18, CELL * 0.14)) + 'px';
        cell.appendChild(nm); cell.appendChild(lb);
        drawCell(cv, a, b);
        cell.addEventListener('click', () => select(a, b, cell));
        grid.appendChild(cell);
      }
    }
  }

  function select(a, b, el) {
    if (active && active.el === el) {       // second tap stops
      stopTones(); el.classList.remove('on'); active = null; setStatus(); return;
    }
    if (active) active.el.classList.remove('on');
    el.classList.add('on'); active = { A: a, B: b, el };
    playRatio(a, b); setStatus();
  }

  function setStatus() {
    const m = document.getElementById('stMain'), r = document.getElementById('stRight');
    if (!active) { m.textContent = 'Tap a cell to hear its ratio.'; r.textContent = ''; return; }
    const { A, B } = active;
    m.textContent = nameFor(A, B) + ' · ' + A + ' : ' + B;
    r.textContent = (G.baseHz * A).toFixed(1) + ' Hz  /  ' + (G.baseHz * B).toFixed(1) + ' Hz';
  }

  // ------------------------------------------------------------------ controls
  function bind(id, key, fmt, after) {
    const inp = document.getElementById(id), out = document.getElementById(id + 'V');
    const upd = () => { G[key] = +inp.value; out.textContent = fmt(+inp.value); if (after) after(); };
    inp.addEventListener('input', upd); upd();
  }
  bind('size', 'N', v => v + ' × ' + v, buildGrid);
  bind('base', 'baseHz', v => v + ' Hz', () => { if (active) playRatio(active.A, active.B); setStatus(); });
  bind('vol', 'vol', v => v + '%', () => { if (master && AC) master.gain.setTargetAtTime(G.vol / 100 * 0.5, AC.currentTime, 0.02); });

  // The size control's initial upd() already ran buildGrid once.
  setStatus();

  // refit the cells when the viewport changes, for example on phone rotation
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(buildGrid, 150); });
})();
