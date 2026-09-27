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
  function box() {
    const strip = MOB ? 34 : 52;            // room for the axis waves
    const s = Math.min(W - strip - 24, H - strip - 24) * 0.9;
    const r = Math.max(40, s / 2);
    return { cx: (W + strip) / 2, cy: (H + strip) / 2, r, strip };
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
  let simU = 0, prevU = 0, last = performance.now();
  let hist = [];               // { x, y, u, born }
  function clearTrail() { hist = []; }

  function pushHistory(now, u0, u1) {
    const du = u1 - u0, steps = Math.max(1, Math.ceil(du * 700));
    for (let i = 1; i <= steps; i++) {
      const u = u0 + du * i / steps;
      hist.push({ x: px(u), y: py(u), u, born: now });
    }
    const cut = now - LIFE;
    let k = 0; while (k < hist.length && hist[k].born < cut) k++;
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

  // the magma trail: contiguous bands by heat, hottest (newest) last
  function drawTrail(b, now) {
    if (hist.length < 2) return;
    const B = 22;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const heatOf = p => 1 - (now - p.born) / LIFE;
    const bandOf = p => Math.max(0, Math.min(B - 1, Math.floor(heatOf(p) * B)));
    let s = 0;
    while (s < hist.length) {
      const band = bandOf(hist[s]);
      let e = s; while (e + 1 < hist.length && bandOf(hist[e + 1]) === band) e++;
      const temp = band / (B - 1);
      ctx.beginPath();
      const end = Math.min(e + 1, hist.length - 1);
      for (let i = s; i <= end; i++) { const X = mapX(hist[i].x, b), Y = mapY(hist[i].y, b); i === s ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
      ctx.shadowColor = magStr(temp, 1); ctx.shadowBlur = 3 + temp * (MOB ? 10 : 18);
      ctx.strokeStyle = magStr(temp, 0.12 + 0.85 * temp);
      ctx.lineWidth = (1.2 + temp * 3.2) * (MOB ? 0.85 : 1);
      ctx.stroke();
      s = e + 1;
    }
    ctx.restore();
  }

  // the component sine waves drawing the object, along the top and left axes
  function drawAxisWaves(b, now) {
    if (hist.length < 2) return;
    const topY = b.cy - b.r, leftX = b.cx - b.r, span = b.strip - 6;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // horizontal component along the top: x value sets screen-x, age climbs upward
    ctx.strokeStyle = magStr(0.86, 0.7); ctx.lineWidth = 1.6; ctx.shadowColor = magStr(0.86, 1); ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = hist.length - 1; i >= 0; i--) {
      const age = (now - hist[i].born) / LIFE; if (age > 1) break;
      const X = mapX(hist[i].x, b), Y = topY - age * span;
      i === hist.length - 1 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    }
    ctx.stroke();
    // vertical component along the left: y value sets screen-y, age climbs leftward
    ctx.strokeStyle = magStr(0.68, 0.7); ctx.shadowColor = magStr(0.68, 1);
    ctx.beginPath();
    for (let i = hist.length - 1; i >= 0; i--) {
      const age = (now - hist[i].born) / LIFE; if (age > 1) break;
      const X = leftX - age * span, Y = mapY(hist[i].y, b);
      i === hist.length - 1 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    }
    ctx.stroke(); ctx.restore();
  }

  function drawGuides(b, u) {
    const X = mapX(px(u), b), Y = mapY(py(u), b);
    const topY = b.cy - b.r - b.strip, leftX = b.cx - b.r - b.strip;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,180,220,0.16)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, topY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(leftX, Y); ctx.stroke();
    ctx.setLineDash([]);
    glowDot(mapX(px(u), b), topY, magStr(0.86, 1), MOB ? 5 : 6);
    glowDot(leftX, mapY(py(u), b), magStr(0.68, 1), MOB ? 5 : 6);
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
    ctx.shadowColor = color; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const hl = Math.min(10, len * 0.42), a = 0.5, ca = Math.cos(a), sa = Math.sin(a);
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * (ux * ca - uy * sa), ey - hl * (uy * ca + ux * sa));
    ctx.lineTo(ex - hl * (ux * ca + uy * sa), ey - hl * (uy * ca - ux * sa));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  // velocity vector plus the single vector perpendicular to it (2D has one)
  function drawFrame(b, u) {
    const X = mapX(px(u), b), Y = mapY(py(u), b);
    const dx = vx(u), dy = -vy(u);                 // screen-space velocity (y is flipped)
    const sp = Math.hypot(dx, dy) || 1, tx = dx / sp, ty = dy / sp;
    const nx = -ty, ny = tx;                        // in-plane perpendicular (normal)
    const Lv = Math.max(0.1, Math.min(0.34, sp / (TAU * Math.max(G.A, G.B) + 1))) * b.r;
    const Ln = b.r * 0.17;
    arrow(X, Y, tx, ty, Lv, magStr(1.0, 0.95), 3);         // velocity (white-hot)
    arrow(X, Y, nx, ny, Ln, magStr(0.66, 0.9), 2);         // perpendicular (normal)
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
