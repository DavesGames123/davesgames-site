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

  const G = {
    A:3, B:2, C:4,
    phaseX:0, phaseY:0.25, phaseZ:0,      // static phase offsets, in turns
    pRateX:0, pRateY:0, pRateZ:0,         // phase animation rates, in turns/sec
    detuneCoarse:0, detuneFine:0,         // detune split into two adjusters
    spin:0, baseHz:131, vol:50, playing:false,
  };
  const detv = () => G.detuneCoarse + G.detuneFine;          // effective detune
  const animating = () => G.pRateX || G.pRateY || G.pRateZ;  // any phase moving
  let ephX = 0, ephY = 0, ephZ = 0;                          // live phases, radians
  const startT = performance.now();
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
  const persp = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  const ORTHO_H = 2.4;                     // half-height the ortho frustum frames
  let useOrtho = false;
  const cam = () => (useOrtho ? ortho : persp);
  const view = { theta: 0.9, phi: 1.15, R: 5, up: new THREE.Vector3(0, 1, 0), snapUp: false };

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight, a = w / h;
    renderer.setSize(w, h, false);
    persp.aspect = a; persp.updateProjectionMatrix();
    ortho.left = -ORTHO_H * a; ortho.right = ORTHO_H * a; ortho.top = ORTHO_H; ortho.bottom = -ORTHO_H;
    ortho.updateProjectionMatrix();
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

  // labeled X/Y/Z axes: a colored line per axis and a text sprite at its end
  function makeLabel(text, hex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = hex; g.font = "bold 46px 'JetBrains Mono',monospace"; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 32, 34);
    const t = new THREE.Texture(c); t.needsUpdate = true;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
    s.scale.setScalar(MOB ? 0.5 : 0.42); return s;
  }
  function axisLine(ax, hex) {
    const e = S * 1.15;
    const p = ax === 0 ? [-e, 0, 0, e, 0, 0] : ax === 1 ? [0, -e, 0, 0, e, 0] : [0, 0, -e, 0, 0, e];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.6, depthTest: false }));
  }
  scene.add(axisLine(0, 0xff5a5a)); scene.add(axisLine(1, 0x64d264)); scene.add(axisLine(2, 0x64a0ff));
  const lblX = makeLabel('X', '#ff8a8a'), lblY = makeLabel('Y', '#8ae08a'), lblZ = makeLabel('Z', '#8ac0ff');
  lblX.position.set(S * 1.3, 0, 0); lblY.position.set(0, S * 1.3, 0); lblZ.position.set(0, 0, S * 1.3);
  scene.add(lblX); scene.add(lblY); scene.add(lblZ);

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
      Math.sin(TAU * (G.A + detv()) * u + ephX) * S,
      Math.sin(TAU * G.B * u + ephY) * S,
      Math.sin(TAU * G.C * u + ephZ) * S
    );
    return out;
  };
  const isWhole = () => Number.isInteger(G.A) && Number.isInteger(G.B) && Number.isInteger(G.C) && Math.abs(detv()) < 1e-6;

  // ------------------------------------------------------------------ buildCurve
  const _p = new THREE.Vector3(), _col = [0, 0, 0];
  let CURVE = null, COL = null, VT = null, VCOUNT = 0, RING = 0;
  function buildCurve() {
    const whole = isWhole(), anim = animating();   // animating reduces detail for speed
    const periods = whole ? 1 : (MOB ? 26 : 38);
    const perPeriod = whole ? (anim ? (MOB ? 340 : 560) : (MOB ? 640 : 900)) : (anim ? (MOB ? 44 : 60) : (MOB ? 60 : 90));
    const n = periods * perPeriod;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(pt(i / perPeriod, new THREE.Vector3()));
    CURVE = new THREE.CatmullRomCurve3(pts, whole, 'centripetal');

    const TUB = whole ? (anim ? (MOB ? 340 : 560) : (MOB ? 700 : 1200)) : n;   // tubular segments
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

  // The frame comes from the curve itself, at the same arc-length fraction the
  // head uses, so the vectors sit exactly on the tracer point. tt is arc-length,
  // not the raw parameter, so pt(tt) would land elsewhere.
  const _T = new THREE.Vector3(), _N = new THREE.Vector3(), _Bn = new THREE.Vector3(), _T2 = new THREE.Vector3();
  function updateFrame(tt) {
    if (!CURVE) return;
    CURVE.getPointAt(tt, _p);                          // exactly the head position
    CURVE.getTangentAt(tt, _T); if (_T.length() < 1e-6) _T.set(1, 0, 0); _T.normalize();
    CURVE.getTangentAt((tt + 1e-3) % 1, _T2);          // tangent just ahead
    _N.copy(_T2).sub(_T);                              // dT: turns toward the normal
    _N.addScaledVector(_T, -_N.dot(_T));               // drop the tangential part
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
    [G.A + detv(), G.B, G.C].forEach(mult => {
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
    const t = AC.currentTime, m = [G.A + detv(), G.B, G.C];
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
    // live phases = static offset + rate * elapsed time
    const el = (now - startT) / 1000;
    ephX = (G.phaseX + G.pRateX * el) * TAU;
    ephY = (G.phaseY + G.pRateY * el) * TAU;
    ephZ = (G.phaseZ + G.pRateZ * el) * TAU;
    if (animating()) buildCurve();      // rebuild the morphing knot each frame

    view.theta += G.spin * 0.0025;
    const c = cam(), st = Math.sin(view.phi), ct = Math.cos(view.phi);
    c.position.set(view.R * st * Math.sin(view.theta), view.R * ct, view.R * st * Math.cos(view.theta));
    // pick an up that stays stable at the poles (straight up / straight down)
    if (!view.snapUp) {
      if (Math.abs(ct) > 0.985) view.up.set(Math.sin(view.theta), 0, Math.cos(view.theta));
      else view.up.set(0, 1, 0);
    }
    c.up.copy(view.up); c.lookAt(0, 0, 0);
    if (useOrtho) { ortho.zoom = 5 / view.R; ortho.updateProjectionMatrix(); }   // wheel/pinch still zoom
    tt = (tt + dt * TRACE) % 1;
    updateHeat(tt);
    if (CURVE) { CURVE.getPointAt(tt, _p); head.position.copy(_p); updateFrame(tt); }
    renderer.render(scene, c);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------- camera drag + pinch
  // One pointer orbits. Two pointers pinch to zoom, so touch works with no wheel.
  const ptrs = new Map();
  let pinchD = 0;
  const clampPhi = p => Math.max(0.001, Math.min(Math.PI - 0.001, p));   // allow straight down/up
  function pdist() { const v = [...ptrs.values()]; return Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y); }
  canvas.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    if (ptrs.size === 2) pinchD = pdist();
  });
  canvas.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    if (ptrs.size === 1) {
      view.snapUp = false;                    // free orbit returns to the dynamic up
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
        G.A = a; G.B = b; G.C = c; G.detuneCoarse = 0; G.detuneFine = 0;
        setVal('detuneCoarse', 0); setVal('detuneFine', 0);
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

    // a static offset rebuilds only when nothing is animating (the frame loop
    // rebuilds otherwise); a rate change rebuilds once when it returns to still
    const onStill = () => { if (!animating()) buildCurve(); };
    const turns = v => v.toFixed(2) + 'τ';
    const rate = v => (v >= 0 ? '+' : '') + v.toFixed(3);
    bindRange('phaseX', 'phaseX', turns, onStill);
    bindRange('phaseY', 'phaseY', turns, onStill);
    bindRange('phaseZ', 'phaseZ', turns, onStill);
    bindRange('rateX', 'pRateX', rate, onStill);
    bindRange('rateY', 'pRateY', rate, onStill);
    bindRange('rateZ', 'pRateZ', rate, onStill);
    bindRange('detuneCoarse', 'detuneCoarse', v => (v >= 0 ? '+' : '') + v.toFixed(2), onStill);
    bindRange('detuneFine', 'detuneFine', v => (v >= 0 ? '+' : '') + v.toFixed(4), onStill);
    bindRange('spin', 'spin', v => v.toFixed(2), null);
    bindRange('base', 'baseHz', v => v.toFixed(0) + ' Hz', null);
    bindRange('vol', 'vol', v => v.toFixed(0) + '%', null);

    const projBtn = document.getElementById('projBtn');
    const setOrtho = on => { useOrtho = on; projBtn.textContent = on ? 'ORTHOGRAPHIC' : 'PERSPECTIVE'; projBtn.classList.toggle('on', on); resize(); };
    projBtn.addEventListener('click', () => setOrtho(!useOrtho));

    // snap straight onto a plane, in orthographic, looking down the third axis
    function snap(theta, phi, ux, uy, uz) {
      view.theta = theta; view.phi = phi; view.up.set(ux, uy, uz); view.snapUp = true;
      G.spin = 0; setVal('spin', 0); setOrtho(true);
    }
    document.getElementById('snapXY').addEventListener('click', () => snap(0, Math.PI / 2, 0, 1, 0));         // down +Z
    document.getElementById('snapXZ').addEventListener('click', () => snap(0, 0.001, 0, 0, -1));              // down +Y
    document.getElementById('snapYZ').addEventListener('click', () => snap(Math.PI / 2, Math.PI / 2, 0, 1, 0)); // down +X

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
  function setVal(id, v) { const inp = document.getElementById(id); if (inp) { inp.value = v; fmt(id); } }
  function syncSteppers() {
    document.getElementById('numA').textContent = G.A;
    document.getElementById('numB').textContent = G.B;
    document.getElementById('numC').textContent = G.C;
  }
  function markPreset() {
    document.querySelectorAll('#presets button').forEach((el, i) => {
      const [a, b, c] = PRESETS[i];
      el.classList.toggle('on', a === G.A && b === G.B && c === G.C && Math.abs(detv()) < 1e-6);
    });
  }

  // ------------------------------------------------------------------- boot
  resize();
  buildUI();
  buildCurve();
  refreshStatus();
  requestAnimationFrame(frame);
})();
