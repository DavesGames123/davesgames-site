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
  const MOB = window.matchMedia('(max-width:768px)').matches || window.matchMedia('(pointer:coarse)').matches;

  // --------------------------------------------------------------- magma ramp
  const MAGMA = [
    [0.001,0.000,0.014],[0.106,0.058,0.243],[0.271,0.063,0.454],[0.447,0.122,0.506],
    [0.624,0.184,0.494],[0.804,0.251,0.443],[0.945,0.376,0.365],[0.992,0.585,0.404],[0.988,0.992,0.749],
  ];
  function magma(t, o) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = t * (MAGMA.length - 1), i = Math.min(Math.floor(x), MAGMA.length - 2), f = x - i;
    const a = MAGMA[i], b = MAGMA[i + 1];
    o[0] = a[0] + (b[0] - a[0]) * f; o[1] = a[1] + (b[1] - a[1]) * f; o[2] = a[2] + (b[2] - a[2]) * f;
    return o;
  }

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

  // the knot: one continuous tube, not a series of points. A Catmull-Rom curve
  // stitches the samples, so the render is a smooth line with real thickness.
  const tubeMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false,
  });
  let tube = new THREE.Mesh(new THREE.BufferGeometry(), tubeMat);
  scene.add(tube);

  // the travelling hot tip
  const head = new THREE.Sprite(new THREE.SpriteMaterial({
    map: SPRITE, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  head.scale.setScalar(MOB ? 0.3 : 0.24); scene.add(head);

  // the moving frame: velocity plus the two vectors perpendicular to it
  const arrowV = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.6, 0xfff2c0, 0.18, 0.11);
  const arrowN = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.45, 0xfd9567, 0.14, 0.09);
  const arrowB = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.45, 0xcd4071, 0.14, 0.09);
  [arrowV, arrowN, arrowB].forEach(a => { a.line.material.depthTest = false; a.cone.material.depthTest = false; scene.add(a); });

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

  // ------------------------------------------------------------------ buildCurve
  const _p = new THREE.Vector3(), _col = [0, 0, 0];
  let CURVE = null, COL = null, VT = null, VCOUNT = 0, RING = 0;
  function buildCurve() {
    const whole = isWhole();
    const periods = whole ? 1 : (MOB ? 28 : 40);
    const perPeriod = whole ? (MOB ? 640 : 900) : (MOB ? 60 : 90);
    const n = periods * perPeriod;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(pt(i / perPeriod, new THREE.Vector3()));
    CURVE = new THREE.CatmullRomCurve3(pts, whole, 'centripetal');

    const TUB = whole ? (MOB ? 700 : 1200) : n;   // tubular segments along the path
    const RSEG = MOB ? 4 : 6;                      // segments around the tube
    const geo = new THREE.TubeGeometry(CURVE, TUB, whole ? 0.02 : 0.014, RSEG, whole);
    VCOUNT = geo.attributes.position.count;
    RING = RSEG + 1;
    const colors = new Float32Array(VCOUNT * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tube.geometry.dispose();
    tube.geometry = geo;
    COL = geo.attributes.color;
    // path parameter t per vertex, so the heat band can be found quickly
    VT = new Float32Array(VCOUNT);
    for (let i = 0; i < VCOUNT; i++) VT[i] = Math.floor(i / RING) / TUB;
    updateHeat(0);
  }

  // heat the tube on the magma ramp: white-hot just behind the tip tt, cooling
  // through orange and red to deep purple over a long tail
  function updateHeat(tt) {
    if (!COL) return;
    const a = COL.array;
    for (let i = 0; i < VCOUNT; i++) {
      let d = tt - VT[i]; if (d < 0) d += 1;      // distance behind the tip
      const heat = Math.exp(-d * 3.5);            // long, slow cool-down
      const temp = 0.25 + 0.75 * heat;            // magma parameter: indigo -> cream
      const glow = 0.5 + 1.7 * heat;              // dim base, very hot tip
      magma(temp, _col);
      a[i * 3] = _col[0] * glow; a[i * 3 + 1] = _col[1] * glow; a[i * 3 + 2] = _col[2] * glow;
    }
    COL.needsUpdate = true;
  }

  // analytic velocity, then the Frenet frame: velocity + two perpendiculars
  const _V = new THREE.Vector3(), _Aa = new THREE.Vector3(), _T = new THREE.Vector3(), _N = new THREE.Vector3(), _Bn = new THREE.Vector3();
  function updateFrame(u) {
    const a = TAU * (G.A + G.detune), b = TAU * G.B, c = TAU * G.C, pxs = G.phaseX * TAU, pys = G.phaseY * TAU;
    pt(u, _p);
    _V.set(a * Math.cos(a * u + pxs), b * Math.cos(b * u + pys), c * Math.cos(c * u)).multiplyScalar(S);
    _Aa.set(-a * a * Math.sin(a * u + pxs), -b * b * Math.sin(b * u + pys), -c * c * Math.sin(c * u)).multiplyScalar(S);
    _T.copy(_V); if (_T.length() < 1e-6) _T.set(1, 0, 0); _T.normalize();
    _N.copy(_Aa).addScaledVector(_T, -_Aa.dot(_T));
    if (_N.length() < 1e-6) { _N.set(-_T.y, _T.x, 0); if (_N.length() < 1e-6) _N.set(0, -_T.z, _T.y); }
    _N.normalize();
    _Bn.crossVectors(_T, _N).normalize();
    const Lv = 0.55, Ln = 0.42;
    arrowV.position.copy(_p); arrowV.setDirection(_T); arrowV.setLength(Lv, 0.16, 0.1);
    arrowN.position.copy(_p); arrowN.setDirection(_N); arrowN.setLength(Ln, 0.13, 0.085);
    arrowB.position.copy(_p); arrowB.setDirection(_Bn); arrowB.setLength(Ln, 0.13, 0.085);
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
  const TRACE = 0.06;                 // tip speed, in path lengths per second (gentle)
  let last = performance.now(), tt = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    view.theta += G.spin * 0.0025;
    const st = Math.sin(view.phi), ct = Math.cos(view.phi);
    camera.position.set(view.R * st * Math.sin(view.theta), view.R * ct, view.R * st * Math.cos(view.theta));
    camera.lookAt(0, 0, 0);
    tt = (tt + dt * TRACE) % 1;
    updateHeat(tt);
    if (CURVE) { CURVE.getPointAt(tt, _p); head.position.copy(_p); updateFrame(tt); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------- camera drag + pinch
  // One pointer orbits. Two pointers pinch to zoom, so touch works with no wheel.
  const ptrs = new Map();
  let pinchD = 0;
  const clampPhi = p => Math.max(0.2, Math.min(Math.PI - 0.2, p));
  function pdist() { const v = [...ptrs.values()]; return Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y); }
  canvas.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    if (ptrs.size === 2) pinchD = pdist();
  });
  canvas.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    if (ptrs.size === 1) {
      view.theta -= (e.clientX - prev.x) * 0.006;
      view.phi = clampPhi(view.phi - (e.clientY - prev.y) * 0.006);
    }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const d = pdist();
      if (pinchD > 0) view.R = Math.max(2.2, Math.min(14, view.R * pinchD / d));
      pinchD = d;
    }
  });
  const drop = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinchD = 0; try { canvas.releasePointerCapture(e.pointerId); } catch (x) {} };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);
  canvas.addEventListener('wheel', e => { e.preventDefault(); view.R = Math.max(2.2, Math.min(14, view.R * (1 + e.deltaY * 0.001))); }, { passive: false });

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
