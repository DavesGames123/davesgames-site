/* ============================================================================
   RESONANCE FIGURE  ·  main script
   ----------------------------------------------------------------------------
   Two perpendicular oscillators trace one loop:
       x(t) = sin(2*pi*fx*t + phase)      fx = A + detune   (horizontal)
       y(t) = sin(2*pi*fy*t)              fy = B            (vertical)

   RENDER MODEL. The path is simulated over time onto a phosphor buffer, not
   stamped once. The buffer fades a little each frame. A whole-number ratio
   retraces the same loop, so it stays a crisp bright closed shape. A detuned
   or non-whole ratio never retraces, so the buffer fills with a denser figure.
   A whole ratio also gets an analytic closed loop drawn on top, so it reads
   sharp at once. Every stroke glows with an additive warm bloom.

   GREP MAP
     grep -n 'AUDIO'      the Web Audio tone pair
     grep -n 'INTERVAL'   the ratio-to-interval-name table
     grep -n 'function draw'   the frame render
     grep -n 'buildUI'    the control panel construction
   ========================================================================== */
(() => {
  'use strict';

  // ------------------------------------------------------------------ state
  const G = { A:3, B:2, phase:0.25, detune:0, speed:0.6, baseHz:131, vol:55, playing:false };

  const cv = document.getElementById('fig');
  const ctx = cv.getContext('2d');
  let acc = document.createElement('canvas');      // phosphor buffer
  let actx = acc.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  // warm palette; the two axes read as two shades of amber
  const C_X = '#ffc832', C_Y = '#ff7b00', C_LOOP = '#ffd27a';

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    acc.width = cv.width; acc.height = cv.height;
    actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    actx.fillStyle = '#0a0c11'; actx.fillRect(0, 0, W, H);
  }
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------ geometry map
  // The loop lives in a centred square. x,y in [-1,1] map into that square.
  function box() {
    const s = Math.min(W, H) * 0.62;
    return { cx: W / 2, cy: H / 2, r: s / 2 };
  }
  const mapX = (x, b) => b.cx + x * b.r;
  const mapY = (y, b) => b.cy - y * b.r;

  // --------------------------------------------------------------- INTERVAL
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const NAMES = {
    '1:1':'Unison', '2:1':'Octave', '3:2':'Perfect fifth', '4:3':'Perfect fourth',
    '5:4':'Major third', '6:5':'Minor third', '5:3':'Major sixth', '8:5':'Minor sixth',
    '9:8':'Major second', '15:8':'Major seventh', '9:5':'Minor seventh',
    '7:5':'Tritone', '3:1':'Octave + fifth', '5:2':'Octave + major third',
    '4:1':'Two octaves',
  };
  function nameFor(a, b) {
    const g = gcd(a, b) || 1; const p = a / g, q = b / g;
    const hi = Math.max(p, q), lo = Math.min(p, q);
    return NAMES[hi + ':' + lo] || (p + ':' + q + ' ratio');
  }

  // ------------------------------------------------------------------ AUDIO
  let AC = null, oscX = null, oscY = null, gX = null, gY = null, master = null;
  function ensureAudio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = G.vol / 100 * 0.5;
    master.connect(AC.destination);
  }
  function startTones() {
    ensureAudio();
    stopTones();
    oscX = AC.createOscillator(); gX = AC.createGain();
    oscY = AC.createOscillator(); gY = AC.createGain();
    oscX.type = 'sine'; oscY.type = 'sine';
    gX.gain.value = 0.5; gY.gain.value = 0.5;
    oscX.connect(gX).connect(master); oscY.connect(gY).connect(master);
    updateFreqs();
    oscX.start(); oscY.start();
    G.playing = true; syncSoundBtn();
  }
  function stopTones() {
    if (oscX) { try { oscX.stop(); oscY.stop(); } catch (e) {} oscX = oscY = null; }
    G.playing = false; syncSoundBtn();
  }
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

  // ------------------------------------------------------------------ render
  let simU = 0;            // simulation position, in loop periods
  let last = performance.now();

  const isWhole = () => Number.isInteger(G.A) && Number.isInteger(G.B) && Math.abs(G.detune) < 1e-6;
  const px = u => Math.sin(2 * Math.PI * (G.A + G.detune) * u + G.phase * 2 * Math.PI);
  const py = u => Math.sin(2 * Math.PI * G.B * u);

  function fadeAcc(amount) {
    actx.globalCompositeOperation = 'source-over';
    actx.fillStyle = 'rgba(10,12,17,' + amount + ')';
    actx.fillRect(0, 0, W, H);
  }

  function plotSegment(u0, u1) {
    const b = box();
    const steps = Math.max(2, Math.ceil((u1 - u0) * 900));
    actx.globalCompositeOperation = 'lighter';
    actx.lineCap = 'round'; actx.lineJoin = 'round';
    actx.shadowColor = C_LOOP; actx.shadowBlur = 14;
    actx.strokeStyle = 'rgba(255,180,90,0.55)'; actx.lineWidth = 2.2;
    actx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = u0 + (u1 - u0) * i / steps;
      const X = mapX(px(u), b), Y = mapY(py(u), b);
      i ? actx.lineTo(X, Y) : actx.moveTo(X, Y);
    }
    actx.stroke();
    // bright thin core, no blur
    actx.shadowBlur = 0; actx.strokeStyle = 'rgba(255,235,200,0.5)'; actx.lineWidth = 0.9;
    actx.stroke();
  }

  function drawAnalyticLoop() {
    const b = box();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = C_LOOP; ctx.shadowBlur = 22;
    ctx.strokeStyle = 'rgba(255,190,110,0.85)'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    const N = 1400;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const X = mapX(px(u), b), Y = mapY(py(u), b);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,240,210,0.9)'; ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawAxes(u) {
    const b = box();
    const X = mapX(px(u), b), Y = mapY(py(u), b);
    const top = b.cy - b.r - 26, left = b.cx - b.r - 26;
    ctx.save();
    // guide lines from the moving point to the two axis lights
    ctx.strokeStyle = 'rgba(150,200,255,0.18)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, top); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(left, Y); ctx.stroke();
    ctx.setLineDash([]);
    // axis tracks
    ctx.strokeStyle = 'rgba(150,200,255,0.10)';
    ctx.beginPath(); ctx.moveTo(b.cx - b.r, top); ctx.lineTo(b.cx + b.r, top); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left, b.cy - b.r); ctx.lineTo(left, b.cy + b.r); ctx.stroke();
    // the two axis lights (horizontal = A, vertical = B)
    glowDot(X, top, C_X, 6);
    glowDot(left, Y, C_Y, 6);
    // the moving head
    glowDot(X, Y, '#fff3d6', 5);
    // labels
    ctx.fillStyle = C_X; ctx.font = "600 12px 'JetBrains Mono',monospace"; ctx.textAlign = 'center';
    ctx.fillText('A=' + G.A, b.cx, top - 12);
    ctx.save(); ctx.translate(left - 12, b.cy); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = C_Y; ctx.textAlign = 'center'; ctx.fillText('B=' + G.B, 0, 0); ctx.restore();
    ctx.restore();
  }

  function glowDot(x, y, color, r) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.restore();
  }

  function draw(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    const whole = isWhole();

    if (whole) {
      // analytic path: clear each frame, draw the crisp closed loop and head
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0a0c11'; ctx.fillRect(0, 0, W, H);
      drawAnalyticLoop();
      simU += dt * G.speed;
      drawAxes(simU % 1);
    } else {
      // simulated phosphor: fade, add new arc, never fully closes when detuned
      fadeAcc(0.055);
      const u0 = simU, u1 = simU + dt * G.speed;
      plotSegment(u0, u1);
      simU = u1;
      if (simU > 1e5) simU = 0;
      // composite the buffer, then live overlays
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(acc, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawAxes(simU % 1);
    }
    requestAnimationFrame(draw);
  }

  // ------------------------------------------------------------------ status
  function refreshStatus() {
    const whole = isWhole();
    const nm = nameFor(G.A, G.B);
    document.getElementById('stMain').textContent =
      nm + ' · ' + G.A + ' : ' + G.B + ' · ' + (whole ? 'closed loop' : 'drifting figure');
    const fx = (G.baseHz * (G.A + G.detune)).toFixed(1);
    const fy = (G.baseHz * G.B).toFixed(1);
    document.getElementById('stRight').textContent = fx + ' Hz  /  ' + fy + ' Hz';
    updateFreqs();
  }

  // ------------------------------------------------------------------ buildUI
  const PRESETS = [
    [1,1],[2,1],[3,2],[4,3],[5,4],[6,5],[5,3],[8,5],[9,8],[7,5],[3,1],[5,2],
  ];
  function buildUI() {
    // presets
    const pc = document.getElementById('presets');
    PRESETS.forEach(([a, b]) => {
      const el = document.createElement('button');
      el.innerHTML = '<b>' + a + ':' + b + '</b>' + nameFor(a, b);
      el.addEventListener('click', () => { G.A = a; G.B = b; G.detune = 0;
        document.getElementById('detune').value = 0; fmt('detune'); syncSteppers(); markPreset(); refreshStatus(); });
      pc.appendChild(el);
    });
    markPreset();

    // steppers
    const bindStep = (id, key) => {
      document.getElementById(id).querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          G[key] = Math.max(1, Math.min(12, G[key] + (+btn.dataset.d)));
          syncSteppers(); markPreset(); refreshStatus();
        });
      });
    };
    bindStep('stepA', 'A'); bindStep('stepB', 'B');
    syncSteppers();

    // sliders
    bindRange('phase', 'phase', v => v.toFixed(2) + 'τ');
    bindRange('detune', 'detune', v => (v >= 0 ? '+' : '') + v.toFixed(3));
    bindRange('speed', 'speed', v => v.toFixed(2) + '×');
    bindRange('base', 'baseHz', v => v.toFixed(0) + ' Hz');
    bindRange('vol', 'vol', v => v.toFixed(0) + '%');

    // sound
    document.getElementById('soundBtn').addEventListener('click', () => {
      G.playing ? stopTones() : startTones();
    });

    // panel open / close
    document.getElementById('gear').addEventListener('click', () =>
      document.getElementById('panel').classList.add('open'));
    document.getElementById('panelClose').addEventListener('click', () =>
      document.getElementById('panel').classList.remove('open'));
  }

  function bindRange(id, key, fmtFn) {
    const inp = document.getElementById(id), out = document.getElementById(id + 'V');
    inp._fmt = fmtFn;
    const upd = () => { G[key] = +inp.value; out.textContent = fmtFn(+inp.value); refreshStatus(); };
    inp.addEventListener('input', upd); upd();
  }
  function fmt(id) {
    const inp = document.getElementById(id), out = document.getElementById(id + 'V');
    if (inp._fmt) out.textContent = inp._fmt(+inp.value);
  }
  function syncSteppers() {
    document.getElementById('numA').textContent = G.A;
    document.getElementById('numB').textContent = G.B;
  }
  function markPreset() {
    document.querySelectorAll('#presets button').forEach((el, i) => {
      const [a, b] = PRESETS[i];
      el.classList.toggle('on', a === G.A && b === G.B && Math.abs(G.detune) < 1e-6);
    });
  }

  // ------------------------------------------------------------------- boot
  resize();
  buildUI();
  refreshStatus();
  requestAnimationFrame(draw);
})();
