/* ============================================================================
   RESONANCE 3D  ·  main script  (three.js r128, global THREE)
   ----------------------------------------------------------------------------
   Three perpendicular oscillators trace a knot:
       x = sin(2*pi*(A+detune)*u + phaseX)
       y = sin(2*pi*B*u + phaseY)
       z = sin(2*pi*C*u)

   RENDER MODEL. The path is sampled over u. A whole triple A:B:C closes after
   one period, so buildCurve samples one clean loop. A detuned or non-whole
   triple never closes, so buildCurve samples many periods and the path fills a
   denser shell. The curve draws as additive glow points, so it reads as one
   bright string. A hand-rolled spherical camera orbits the origin.

   GREP MAP
     grep -n 'AUDIO'        the three-tone Web Audio triad
     grep -n 'function buildCurve'   the knot geometry build
     grep -n 'function glowSprite'   the soft point texture
     grep -n 'function frame'        the render loop and camera
     grep -n 'function buildUI'      the control panel construction
   ========================================================================== */
(() => {
  'use strict';
  const TAU = Math.PI * 2, S = 1.5;

  const G = { A:3, B:2, C:4, phaseX:0, phaseY:0.25, detune:0, spin:0.3, baseHz:131, vol:50, playing:false };

  // --------------------------------------------------------------- three setup
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const view = { theta: 0.9, phi: 1.15, R: 5 };

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // --------------------------------------------------------------- glowSprite
  function glowSprite() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,240,210,0.9)');
    grd.addColorStop(0.6, 'rgba(255,180,120,0.25)');
    grd.addColorStop(1, 'rgba(255,150,90,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  const SPRITE = glowSprite();

  // faint bounding cube for depth
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * S, 2 * S, 2 * S)),
    new THREE.LineBasicMaterial({ color: 0x2a3850, transparent: true, opacity: 0.5 })
  );
  scene.add(box);

  // the knot points
  const mat = new THREE.PointsMaterial({
    size: 0.06, map: SPRITE, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, sizeAttenuation: true,
  });
  let points = new THREE.Points(new THREE.BufferGeometry(), mat);
  scene.add(points);

  // the travelling head
  const head = new THREE.Sprite(new THREE.SpriteMaterial({
    map: SPRITE, color: 0xfff2d6, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  head.scale.setScalar(0.3); scene.add(head);

  // ------------------------------------------------------------------- helpers
  const pt = (u, out) => {
    out.set(
      Math.sin(TAU * (G.A + G.detune) * u + G.phaseX * TAU) * S,
      Math.sin(TAU * G.B * u + G.phaseY * TAU) * S,
      Math.sin(TAU * G.C * u) * S
    );
    return out;
  };
  const isWhole = () => Number.isInteger(G.A) && Number.isInteger(G.B) && Number.isInteger(G.C) && Math.abs(G.detune) < 1e-6;

  // gradient gold -> pink along the path
  function colorAt(f, o) {
    const stops = [[1, 0.78, 0.2], [1, 0.48, 0.24], [1, 0.35, 0.55]];
    const x = f * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), t = x - i;
    o.r = stops[i][0] + (stops[i + 1][0] - stops[i][0]) * t;
    o.g = stops[i][1] + (stops[i + 1][1] - stops[i][1]) * t;
    o.b = stops[i][2] + (stops[i + 1][2] - stops[i][2]) * t;
  }

  // ------------------------------------------------------------------ buildCurve
  const _p = new THREE.Vector3(), _c = { r: 0, g: 0, b: 0 };
  function buildCurve() {
    const whole = isWhole();
    const periods = whole ? 1 : 80;
    const perPeriod = whole ? 2400 : 320;
    const total = periods * perPeriod;
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      const u = (i / perPeriod);
      pt(u, _p);
      pos[i * 3] = _p.x; pos[i * 3 + 1] = _p.y; pos[i * 3 + 2] = _p.z;
      colorAt((i / total), _c);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    points.geometry.dispose();
    points.geometry = geo;
    // denser shells dim each point so the whole shell stays readable
    mat.opacity = whole ? 0.95 : 0.5;
    mat.size = whole ? 0.06 : 0.05;
  }

  // ------------------------------------------------------------------ AUDIO
  let AC = null, osc = [], master = null;
  function ensureAudio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = G.vol / 100 * 0.4; master.connect(AC.destination);
  }
  function startTones() {
    ensureAudio(); stopTones();
    [G.A + G.detune, G.B, G.C].forEach(mult => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine'; o.frequency.value = G.baseHz * mult; g.gain.value = 0.34;
      o.connect(g).connect(master); o.start(); osc.push(o);
    });
    G.playing = true; syncSoundBtn();
  }
  function stopTones() {
    osc.forEach(o => { try { o.stop(); } catch (e) {} }); osc = [];
    G.playing = false; syncSoundBtn();
  }
  function updateFreqs() {
    if (!AC || osc.length !== 3) return;
    const t = AC.currentTime, m = [G.A + G.detune, G.B, G.C];
    osc.forEach((o, i) => o.frequency.setTargetAtTime(G.baseHz * m[i], t, 0.02));
    if (master) master.gain.setTargetAtTime(G.vol / 100 * 0.4, t, 0.02);
  }
  function syncSoundBtn() {
    const b = document.getElementById('soundBtn');
    b.textContent = G.playing ? '■ STOP TRIAD' : '▶ PLAY TRIAD';
    b.classList.toggle('on', G.playing);
  }

  // ------------------------------------------------------------------ frame
  let last = performance.now(), headU = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    view.theta += G.spin * 0.004;
    const st = Math.sin(view.phi), ct = Math.cos(view.phi);
    camera.position.set(view.R * st * Math.sin(view.theta), view.R * ct, view.R * st * Math.cos(view.theta));
    camera.lookAt(0, 0, 0);
    headU = (headU + dt * 0.16) % 1;
    pt(headU, _p); head.position.copy(_p);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ camera drag
  let drag = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', e => { drag = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    view.theta -= (e.clientX - lx) * 0.006;
    view.phi = Math.max(0.2, Math.min(Math.PI - 0.2, view.phi - (e.clientY - ly) * 0.006));
    lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener('pointerup', e => { drag = false; try { canvas.releasePointerCapture(e.pointerId); } catch (x) {} });
  canvas.addEventListener('wheel', e => { e.preventDefault(); view.R = Math.max(2.2, Math.min(12, view.R * (1 + e.deltaY * 0.001))); }, { passive: false });

  // ------------------------------------------------------------------ status
  function refreshStatus() {
    document.getElementById('stMain').textContent =
      G.A + ' : ' + G.B + ' : ' + G.C + ' · ' + (isWhole() ? 'closed knot' : 'drifting shell');
    document.getElementById('stRight').textContent =
      (G.baseHz * G.A).toFixed(0) + ' / ' + (G.baseHz * G.B).toFixed(0) + ' / ' + (G.baseHz * G.C).toFixed(0) + ' Hz';
    updateFreqs();
  }

  // ------------------------------------------------------------------ buildUI
  const PRESETS = [[1,2,3],[2,3,4],[3,4,5],[1,3,2],[3,2,4],[2,5,3],[3,5,4],[1,1,2],[2,3,5]];
  function buildUI() {
    const pc = document.getElementById('presets');
    PRESETS.forEach(([a, b, c]) => {
      const el = document.createElement('button');
      el.textContent = a + ':' + b + ':' + c;
      el.addEventListener('click', () => {
        G.A = a; G.B = b; G.C = c; G.detune = 0;
        document.getElementById('detune').value = 0; fmt('detune');
        syncSteppers(); markPreset(); buildCurve(); refreshStatus();
      });
      pc.appendChild(el);
    });
    markPreset();

    const bindStep = (id, key) => document.getElementById(id).querySelectorAll('button').forEach(btn =>
      btn.addEventListener('click', () => {
        G[key] = Math.max(1, Math.min(9, G[key] + (+btn.dataset.d)));
        syncSteppers(); markPreset(); buildCurve(); refreshStatus();
      }));
    bindStep('stepA', 'A'); bindStep('stepB', 'B'); bindStep('stepC', 'C');
    syncSteppers();

    bindRange('phaseX', 'phaseX', v => v.toFixed(2), buildCurve);
    bindRange('phaseY', 'phaseY', v => v.toFixed(2), buildCurve);
    bindRange('detune', 'detune', v => (v >= 0 ? '+' : '') + v.toFixed(3), buildCurve);
    bindRange('spin', 'spin', v => v.toFixed(2), null);
    bindRange('base', 'baseHz', v => v.toFixed(0) + ' Hz', null);
    bindRange('vol', 'vol', v => v.toFixed(0) + '%', null);

    document.getElementById('soundBtn').addEventListener('click', () => G.playing ? stopTones() : startTones());
    document.getElementById('gear').addEventListener('click', () => document.getElementById('panel').classList.add('open'));
    document.getElementById('panelClose').addEventListener('click', () => document.getElementById('panel').classList.remove('open'));
  }
  function bindRange(id, key, fmtFn, after) {
    const inp = document.getElementById(id), out = document.getElementById(id + 'V');
    inp._fmt = fmtFn;
    const upd = () => { G[key] = +inp.value; out.textContent = fmtFn(+inp.value); if (after) after(); refreshStatus(); };
    inp.addEventListener('input', upd); upd();
  }
  function fmt(id) { const inp = document.getElementById(id), out = document.getElementById(id + 'V'); if (inp._fmt) out.textContent = inp._fmt(+inp.value); }
  function syncSteppers() {
    document.getElementById('numA').textContent = G.A;
    document.getElementById('numB').textContent = G.B;
    document.getElementById('numC').textContent = G.C;
  }
  function markPreset() {
    document.querySelectorAll('#presets button').forEach((el, i) => {
      const [a, b, c] = PRESETS[i];
      el.classList.toggle('on', a === G.A && b === G.B && c === G.C && Math.abs(G.detune) < 1e-6);
    });
  }

  // ------------------------------------------------------------------- boot
  resize();
  buildUI();
  buildCurve();
  refreshStatus();
  requestAnimationFrame(frame);
})();
