/* ============================================================================
   RESONANCE FIGURE  ·  main script
   ----------------------------------------------------------------------------
   Two perpendicular oscillators trace one loop:
       x(u) = sin(2*pi*(A+detune)*u + phase)      (horizontal)
       y(u) = sin(2*pi*B*u)                        (vertical)

   RENDER MODEL. A slow tip walks the path and stores a timed history. The
   history draws as a trail that cools along the magma ramp, from a white-hot
   tip through orange and red to deep purple, over several seconds. The two
   component sine waves draw in strips along the top and left axes. A moving
   frame at the tip shows the velocity vector and the two vectors perpendicular
   to it.

   GREP MAP
     grep -n 'AUDIO'        the Web Audio tone pair
     grep -n 'INTERVAL'     the ratio-to-interval-name table
     grep -n 'function magma'   the magma color ramp
     grep -n 'function draw'    the frame render
     grep -n 'drawAxisWaves'    the component sine waves on the axes
     grep -n 'drawFrame'    the velocity and perpendicular vectors
     grep -n 'buildUI'      the control panel construction
   ========================================================================== */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const MOB = window.matchMedia('(max-width:768px)').matches || (window.matchMedia('(pointer:coarse)').matches);

  const G = { A:3, B:2, phase:0.25, detune:0, speed:0.09, baseHz:131, vol:55, playing:false };

  const cv = document.getElementById('fig');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------ geometry map
  // Layout: the wave panels get a wide band; the figure gets what is left. A
  // gap separates each panel from the figure so all three have their own frame.
  function box() {
    const pad = MOB ? 12 : 22;
    const gap = MOB ? 10 : 16;
    const avail = Math.min(W, H) - pad * 2;
    const strip = Math.round(avail * (MOB ? 0.26 : 0.30));   // wave panels: more space
    const r = Math.max(40, (avail - strip - gap) / 2);       // figure: less space
    const cx = pad + strip + gap + r, cy = pad + strip + gap + r;
    return { cx, cy, r, strip, gap, pad,
      figL: cx - r, figR: cx + r, figT: cy - r, figB: cy + r };
  }
  const mapX = (x, b) => b.cx + x * b.r;
  const mapY = (y, b) => b.cy - y * b.r;

  // position and velocity in unit coordinates
  const px = u => Math.sin(TAU * (G.A + G.detune) * u + G.phase * TAU);
  const py = u => Math.sin(TAU * G.B * u);
  const vx = u => TAU * (G.A + G.detune) * Math.cos(TAU * (G.A + G.detune) * u + G.phase * TAU);
  const vy = u => TAU * G.B * Math.cos(TAU * G.B * u);

  // --------------------------------------------------------------- INTERVAL
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const NAMES = {
    '1:1':'Unison', '2:1':'Octave', '3:2':'Perfect fifth', '4:3':'Perfect fourth',
    '5:4':'Major third', '6:5':'Minor third', '5:3':'Major sixth', '8:5':'Minor sixth',
    '9:8':'Major second', '15:8':'Major seventh', '9:5':'Minor seventh',
    '7:5':'Tritone', '3:1':'Octave + fifth', '5:2':'Octave + major third', '4:1':'Two octaves',
  };
  function nameFor(a, b) {
    const g = gcd(a, b) || 1; const p = a / g, q = b / g;
    const hi = Math.max(p, q), lo = Math.min(p, q);
    return NAMES[hi + ':' + lo] || (p + ':' + q + ' ratio');
  }

  // --------------------------------------------------------------- magma
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
  function magStr(t, alpha) {
    const c = magma(t);
    return 'rgba(' + (c[0] * 255 | 0) + ',' + (c[1] * 255 | 0) + ',' + (c[2] * 255 | 0) + ',' + alpha + ')';
  }

  // ------------------------------------------------------------------ AUDIO
  let AC = null, oscX = null, oscY = null, gX = null, gY = null, master = null;
  function ensureAudio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = G.vol / 100 * 0.5; master.connect(AC.destination);
  }
  function startTones() {
    ensureAudio(); stopTones();
    oscX = AC.createOscillator(); gX = AC.createGain();
    oscY = AC.createOscillator(); gY = AC.createGain();
    oscX.type = 'sine'; oscY.type = 'sine'; gX.gain.value = 0.5; gY.gain.value = 0.5;
    oscX.connect(gX).connect(master); oscY.connect(gY).connect(master);
    updateFreqs(); oscX.start(); oscY.start(); G.playing = true; syncSoundBtn();
  }
  function stopTones() { if (oscX) { try { oscX.stop(); oscY.stop(); } catch (e) {} oscX = oscY = null; } G.playing = false; syncSoundBtn(); }
  function updateFreqs() {
    if (!AC || !oscX) return;
    const t = AC.currentTime;
    oscX.frequency.setTargetAtTime(G.baseHz * (G.A + G.detune), t, 0.02);
    oscY.frequency.setTargetAtTime(G.baseHz * G.B, t, 0.02);
    if (master) master.gain.setTargetAtTime(G.vol / 100 * 0.5, t, 0.02);
  }
  function syncSoundBtn() {
    const b = document.getElementById('soundBtn');
    b.textContent = G.playing ? '■ STOP TONES' : '▶ PLAY TONES';
    b.classList.toggle('on', G.playing);
  }

  // ------------------------------------------------------------------ trail
  const LIFE = 7.5;             // seconds a point stays in the trail (long cool-down)
  const MAXPTS = MOB ? 700 : 1600;
  let simU = 0, prevU = 0, last = performance.now();
  let hist = [];               // { x, y, u, born }
  function clearTrail() { hist = []; }

  // sample the arc densely, so the curve and its gradient stay smooth
  function pushHistory(now, u0, u1) {
    const du = u1 - u0, steps = Math.max(2, Math.ceil(du * 1600));
    for (let i = 1; i <= steps; i++) {
      const u = u0 + du * i / steps;
      hist.push({ x: px(u), y: py(u), u, born: now });
    }
    const cut = now - LIFE;
    let k = 0; while (k < hist.length && hist[k].born < cut) k++;
    if (hist.length - k > MAXPTS) k = hist.length - MAXPTS;
    if (k) hist.splice(0, k);
  }

  // ------------------------------------------------------------------ draw parts
  function drawContextLoop(b) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = magStr(0.32, 0.16); ctx.lineWidth = 1.2;
    ctx.beginPath();
    const N = 900;
    for (let i = 0; i <= N; i++) { const u = i / N, X = mapX(px(u), b), Y = mapY(py(u), b); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.stroke(); ctx.restore();
  }

  // the magma trail: one soft glow pass, then a true per-segment gradient by age
  function drawTrail(b, now) {
    if (hist.length < 2) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // pass 1: soft magma glow under the whole trail, one cheap stroke
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) { const X = mapX(hist[i].x, b), Y = mapY(hist[i].y, b); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.strokeStyle = magStr(0.72, 0.10); ctx.lineWidth = MOB ? 6 : 10;
    ctx.shadowColor = magStr(0.82, 1); ctx.shadowBlur = MOB ? 8 : 16; ctx.stroke();
    ctx.shadowBlur = 0;

    // pass 2: crisp color per segment, so the gradient is exact along the line
    let px0 = mapX(hist[0].x, b), py0 = mapY(hist[0].y, b);
    for (let i = 1; i < hist.length; i++) {
      const p = hist[i], heat = 1 - (now - p.born) / LIFE;
      const X = mapX(p.x, b), Y = mapY(p.y, b);
      if (heat >= 0) {
        ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(X, Y);
        ctx.strokeStyle = magStr(heat, 0.15 + 0.8 * heat);
        ctx.lineWidth = (0.9 + heat * 2.8) * (MOB ? 0.9 : 1); ctx.stroke();
      }
      px0 = X; py0 = Y;
    }
    ctx.restore();
  }

  // --- static frames: bounding box, grid lines, axes and labels ---------------
  const GRID = 'rgba(200,170,210,0.09)', AXIS = 'rgba(212,182,222,0.30)', BOX = 'rgba(212,182,222,0.34)';
  const TICK = 'rgba(185,155,195,0.65)';
  const cyclesX = () => Math.min(2.4, LIFE * Math.abs(G.A + G.detune) * G.speed);
  const cyclesY = () => Math.min(2.4, LIFE * Math.abs(G.B) * G.speed);

  function drawFigureFrame(b) {
    ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) {                     // grid at -1, -0.5, 0, 0.5, 1
      const gx = b.cx + k * 0.5 * b.r, gy = b.cy + k * 0.5 * b.r, mid = k === 0;
      ctx.strokeStyle = mid ? AXIS : GRID;
      ctx.beginPath(); ctx.moveTo(gx, b.figT); ctx.lineTo(gx, b.figB); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.figL, gy); ctx.lineTo(b.figR, gy); ctx.stroke();
    }
    ctx.strokeStyle = BOX; ctx.lineWidth = 1.2; ctx.strokeRect(b.figL, b.figT, 2 * b.r, 2 * b.r);
    ctx.fillStyle = TICK; ctx.font = "500 " + (MOB ? 9 : 11) + "px 'JetBrains Mono',monospace";
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('x', b.figR - 4, b.figB - 3);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('y', b.figL + 4, b.figT + 3);
    ctx.restore();
  }

  function drawWaveFrames(b) {
    const pBot = b.figT - b.gap, pTop = pBot - b.strip;         // top panel
    const pRight = b.figL - b.gap, pLeft = pRight - b.strip;    // left panel
    ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1;
    ctx.font = "500 " + (MOB ? 8 : 10) + "px 'JetBrains Mono',monospace";

    // ---- top panel: horizontal component; amplitude across, time up ----
    for (let k = -2; k <= 2; k++) {                             // amplitude grid (vertical)
      const gx = b.cx + k * 0.5 * b.r, mid = k === 0; ctx.strokeStyle = mid ? AXIS : GRID;
      ctx.beginPath(); ctx.moveTo(gx, pTop); ctx.lineTo(gx, pBot); ctx.stroke();
    }
    const cX = cyclesX();                                       // time grid (per period)
    for (let p = 1; p <= cX; p++) { const gy = pBot - (p / cX) * b.strip; ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(b.figL, gy); ctx.lineTo(b.figR, gy); ctx.stroke(); }
    ctx.strokeStyle = BOX; ctx.lineWidth = 1.2; ctx.strokeRect(b.figL, pTop, 2 * b.r, b.strip);
    ctx.fillStyle = magStr(0.86, 0.85); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('x = sin 2π·' + G.A + '·t', b.figL + 4, pTop + 3);
    ctx.fillStyle = TICK; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillText('−1', b.figL + 2, pBot - 2);
    ctx.textAlign = 'right'; ctx.fillText('+1', b.figR - 2, pBot - 2);
    ctx.save(); ctx.translate(b.figR + 3, pTop + b.strip / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('t →', 0, 0); ctx.restore();

    // ---- left panel: vertical component; amplitude down, time left ----
    for (let k = -2; k <= 2; k++) {                             // amplitude grid (horizontal)
      const gy = b.cy + k * 0.5 * b.r, mid = k === 0; ctx.strokeStyle = mid ? AXIS : GRID;
      ctx.beginPath(); ctx.moveTo(pLeft, gy); ctx.lineTo(pRight, gy); ctx.stroke();
    }
    const cY = cyclesY();                                       // time grid (per period)
    for (let p = 1; p <= cY; p++) { const gx = pRight - (p / cY) * b.strip; ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(gx, b.figT); ctx.lineTo(gx, b.figB); ctx.stroke(); }
    ctx.strokeStyle = BOX; ctx.lineWidth = 1.2; ctx.strokeRect(pLeft, b.figT, b.strip, 2 * b.r);
    ctx.fillStyle = magStr(0.66, 0.85); ctx.save(); ctx.translate(pLeft + 3, b.figB - 4); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('y = sin 2π·' + G.B + '·t', 0, 0); ctx.restore();
    ctx.fillStyle = TICK; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('+1', pRight - 2, b.figT + 2);
    ctx.textBaseline = 'bottom'; ctx.fillText('−1', pRight - 2, b.figB - 2);
    ctx.restore();
  }

  // The two moving component sine waves. Amplitude aligns with the figure axis;
  // time runs away from the figure. The newest sample sits on the panel edge.
  function drawAxisWaves(b, now) {
    if (hist.length < 2) return;
    const pBot = b.figT - b.gap, pRight = b.figL - b.gap;
    const fx = Math.abs(G.A + G.detune) * G.speed, fy = Math.abs(G.B) * G.speed;   // cycles/sec
    const winX = Math.min(LIFE, cyclesX() / Math.max(fx, 1e-6));
    const winY = Math.min(LIFE, cyclesY() / Math.max(fy, 1e-6));
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = magStr(0.86, 0.9); ctx.lineWidth = 1.8; ctx.shadowColor = magStr(0.86, 1); ctx.shadowBlur = 6;
    ctx.beginPath();                                             // horizontal component, top panel
    for (let i = hist.length - 1, first = true; i >= 0; i--) {
      const age = now - hist[i].born; if (age > winX) break;
      const X = mapX(hist[i].x, b), Y = pBot - (age / winX) * b.strip;
      first ? (ctx.moveTo(X, Y), first = false) : ctx.lineTo(X, Y);
    }
    ctx.stroke();
    ctx.strokeStyle = magStr(0.66, 0.9); ctx.shadowColor = magStr(0.66, 1);
    ctx.beginPath();                                             // vertical component, left panel
    for (let i = hist.length - 1, first = true; i >= 0; i--) {
      const age = now - hist[i].born; if (age > winY) break;
      const X = pRight - (age / winY) * b.strip, Y = mapY(hist[i].y, b);
      first ? (ctx.moveTo(X, Y), first = false) : ctx.lineTo(X, Y);
    }
    ctx.stroke(); ctx.restore();
  }

  // the pointer lines and dots that connect each wave to the moving tip
  function drawGuides(b, u) {
    const X = mapX(px(u), b), Y = mapY(py(u), b);
    const pBot = b.figT - b.gap, pRight = b.figL - b.gap;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([2, 4]); ctx.lineWidth = 1.2;
    ctx.strokeStyle = magStr(0.86, 0.45);
    ctx.beginPath(); ctx.moveTo(X, pBot); ctx.lineTo(X, Y); ctx.stroke();        // top wave -> tip
    ctx.strokeStyle = magStr(0.66, 0.45);
    ctx.beginPath(); ctx.moveTo(pRight, Y); ctx.lineTo(X, Y); ctx.stroke();      // left wave -> tip
    ctx.setLineDash([]);
    glowDot(X, pBot, magStr(0.9, 1), MOB ? 4 : 5);         // attach dot, top panel edge
    glowDot(pRight, Y, magStr(0.66, 1), MOB ? 4 : 5);      // attach dot, left panel edge
    ctx.restore();
  }

  function glowDot(x, y, color, r) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore();
  }

  function arrow(x, y, dx, dy, len, color, lw) {
    const m = Math.hypot(dx, dy) || 1, ux = dx / m, uy = dy / m, ex = x + ux * len, ey = y + uy * len;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const hl = Math.min(6, len * 0.34), a = 0.5, ca = Math.cos(a), sa = Math.sin(a);
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * (ux * ca - uy * sa), ey - hl * (uy * ca + ux * sa));
    ctx.lineTo(ex - hl * (ux * ca + uy * sa), ey - hl * (uy * ca - ux * sa));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  // velocity vector plus the single vector perpendicular to it (2D has one).
  // Kept small and dim, so it reads as an annotation, not the main mark.
  function drawFrame(b, u) {
    const X = mapX(px(u), b), Y = mapY(py(u), b);
    const dx = vx(u), dy = -vy(u);                 // screen-space velocity (y is flipped)
    const sp = Math.hypot(dx, dy) || 1, tx = dx / sp, ty = dy / sp;
    const nx = -ty, ny = tx;                        // in-plane perpendicular (normal)
    const Lv = Math.max(0.06, Math.min(0.16, sp / (TAU * Math.max(G.A, G.B) + 1))) * b.r;
    const Ln = b.r * 0.09;
    arrow(X, Y, tx, ty, Lv, magStr(0.95, 0.7), 1.6);       // velocity
    arrow(X, Y, nx, ny, Ln, magStr(0.6, 0.6), 1.3);        // perpendicular (normal)
  }

  function drawHotTip(b, u) {
    const X = mapX(px(u), b), Y = mapY(py(u), b);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, MOB ? 16 : 22);
    g.addColorStop(0, 'rgba(255,255,240,0.98)');
    g.addColorStop(0.25, magStr(0.9, 0.85));
    g.addColorStop(0.6, magStr(0.7, 0.4));
    g.addColorStop(1, magStr(0.5, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, MOB ? 16 : 22, 0, 7); ctx.fill(); ctx.restore();
  }

  // ------------------------------------------------------------------ frame
  function draw(now) {
    const t = now / 1000, dt = Math.min((t - last), 0.05); last = t;
    prevU = simU; simU += dt * G.speed; if (simU > 1e6) { simU %= 1; prevU = simU; }
    pushHistory(t, prevU, simU);

    const b = box();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05040a'; ctx.fillRect(0, 0, W, H);
    drawFigureFrame(b);          // bounded box, grid, axes for the pattern
    drawWaveFrames(b);           // bounded boxes, grids, axes for both waves
    if (isWholeCtx()) drawContextLoop(b);
    drawAxisWaves(b, t);
    drawTrail(b, t);
    const u = simU % 1;
    drawGuides(b, u);
    drawFrame(b, u);
    drawHotTip(b, u);
    requestAnimationFrame(draw);
  }
  const isWholeCtx = () => Number.isInteger(G.A) && Number.isInteger(G.B) && Math.abs(G.detune) < 1e-6;

  // ------------------------------------------------------------------ status
  function refreshStatus() {
    const whole = isWholeCtx(), nm = nameFor(G.A, G.B);
    document.getElementById('stMain').textContent = nm + ' · ' + G.A + ' : ' + G.B + ' · ' + (whole ? 'closed loop' : 'drifting figure');
    document.getElementById('stRight').textContent =
      (G.baseHz * (G.A + G.detune)).toFixed(1) + ' Hz  /  ' + (G.baseHz * G.B).toFixed(1) + ' Hz';
    updateFreqs();
  }

  // ------------------------------------------------------------------ buildUI
  const PRESETS = [[1,1],[2,1],[3,2],[4,3],[5,4],[6,5],[5,3],[8,5],[9,8],[7,5],[3,1],[5,2]];
  function buildUI() {
    const pc = document.getElementById('presets');
    PRESETS.forEach(([a, b]) => {
      const el = document.createElement('button');
      el.innerHTML = '<b>' + a + ':' + b + '</b>' + nameFor(a, b);
      el.addEventListener('click', () => {
        G.A = a; G.B = b; G.detune = 0;
        document.getElementById('detune').value = 0; fmt('detune');
        syncSteppers(); markPreset(); clearTrail(); refreshStatus();
      });
      pc.appendChild(el);
    });
    markPreset();

    const bindStep = (id, key) => document.getElementById(id).querySelectorAll('button').forEach(btn =>
      btn.addEventListener('click', () => {
        G[key] = Math.max(1, Math.min(12, G[key] + (+btn.dataset.d)));
        syncSteppers(); markPreset(); clearTrail(); refreshStatus();
      }));
    bindStep('stepA', 'A'); bindStep('stepB', 'B'); syncSteppers();

    bindRange('phase', 'phase', v => v.toFixed(2) + 'τ', clearTrail);
    bindRange('detune', 'detune', v => (v >= 0 ? '+' : '') + v.toFixed(3), clearTrail);
    bindRange('speed', 'speed', v => v.toFixed(2) + '×');
    bindRange('base', 'baseHz', v => v.toFixed(0) + ' Hz');
    bindRange('vol', 'vol', v => v.toFixed(0) + '%');

    document.getElementById('soundBtn').addEventListener('click', () => G.playing ? stopTones() : startTones());
    const panel = document.getElementById('panel');
    document.getElementById('gear').addEventListener('click', () => panel.classList.toggle('open'));
    document.getElementById('panelClose').addEventListener('click', () => panel.classList.remove('open'));
    if (MOB) panel.classList.remove('open');    // start closed on phones
  }
  function bindRange(id, key, fmtFn, after) {
    const inp = document.getElementById(id), out = document.getElementById(id + 'V');
    inp._fmt = fmtFn;
    const upd = () => { G[key] = +inp.value; out.textContent = fmtFn(+inp.value); if (after) after(); refreshStatus(); };
    inp.addEventListener('input', upd); upd();
  }
  function fmt(id) { const inp = document.getElementById(id), out = document.getElementById(id + 'V'); if (inp._fmt) out.textContent = inp._fmt(+inp.value); }
  function syncSteppers() { document.getElementById('numA').textContent = G.A; document.getElementById('numB').textContent = G.B; }
  function markPreset() {
    document.querySelectorAll('#presets button').forEach((el, i) => {
      const [a, b] = PRESETS[i];
      el.classList.toggle('on', a === G.A && b === G.B && Math.abs(G.detune) < 1e-6);
    });
  }

  // ------------------------------------------------------------------- boot
  resize(); buildUI(); refreshStatus(); requestAnimationFrame(draw);
})();
