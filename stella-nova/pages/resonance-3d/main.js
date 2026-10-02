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
     grep -n 'SAMPLE DENSITY'        sample count from the curve speed
     grep -n 'function glowSprite'   the soft point texture
     grep -n 'function frame'        the render loop and camera
     grep -n 'function buildUI'      the control panel construction
     grep -n '__res3d'               the objects xr.js reads (VR and AR)
     grep -n 'snSaver'               the screensaver hook (lib/screensaver.js)
     grep -n 'R3_RULES'              symbol -> math color class
   ========================================================================== */
(() => {
  'use strict';
  const TAU = Math.PI * 2, S = 1.5;
  // Math colors (lib/sci.css), one per axis: x, A, phi_x m1; y, B, phi_y m2;
  // z, C, phi_z m3; detune delta m4. u, pi and f0 keep the default color.
  const R3_RULES = [['x', 'm1'], ['A', 'm1'], ['\\varphi_x', 'm1'], ['y', 'm2'], ['B', 'm2'], ['\\varphi_y', 'm2'],
    ['z', 'm3'], ['C', 'm3'], ['\\varphi_z', 'm3'], ['\\delta', 'm4']];
  import('../../lib/sci-math.js').then(m => m.typesetAll(document, R3_RULES)).catch(err => console.error('[math]', err));

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
    persp.aspect = a;
    // In saver mode on a wide screen, the view window moves right, so the knot
    // sits left of centre and the shell label plate (lower right) is clear.
    if (SAVER.on && a > 1.2) persp.setViewOffset(w, h, w * 0.12, 0, w, h); else persp.clearViewOffset();
    persp.updateProjectionMatrix();
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
    g.fillStyle = hex; g.font = "600 46px Inter,system-ui,sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
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
  // SAMPLE DENSITY. The sample count comes from the curve, not a fixed
  // count per period. The speed bound is 2 pi S sqrt((A + d)^2 + B^2 + C^2)
  // world units per unit of u. One sample per SEG world units of it keeps
  // each chord short (the box is 2 S = 3 units wide). A whole triple gets
  // one period. A detuned triple gets as many periods as BUDGET allows
  // (4 to 38), so a complex atonal triad gets fewer but round periods, not
  // 38 polygon periods. While the phases animate, the budget is smaller,
  // because buildCurve runs every frame then.
  const SEG = 0.012;
  function buildCurve() {
    const whole = isWhole(), anim = animating();   // animating reduces detail for speed
    const speed = TAU * S * Math.hypot(G.A + detv(), G.B, G.C);
    const BUDGET = anim ? (MOB ? 1500 : 3000) : (MOB ? 8000 : 24000);
    let perPeriod = Math.max(whole ? 900 : 90, Math.ceil(speed / SEG)), periods = 1;
    if (whole) perPeriod = Math.min(perPeriod, BUDGET);
    else {
      perPeriod = Math.min(perPeriod, Math.floor(BUDGET / 4));
      periods = Math.max(4, Math.min(MOB ? 26 : 38, Math.floor(BUDGET / perPeriod)));
    }
    const n = periods * perPeriod;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(pt(i / perPeriod, new THREE.Vector3()));
    CURVE = new THREE.CatmullRomCurve3(pts, whole, 'centripetal');
    CURVE.arcLengthDivisions = Math.max(200, n);   // getPointAt follows the samples, not 200 chords

    const TUB = n;                                 // tubular segments: one per sample
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
    // All RING vertices of one tube ring share VT, so the color is found
    // once per ring and copied (VCOUNT can be 24000 rings x RING now).
    for (let i = 0; i < VCOUNT; i += RING) {
      let d = tt - VT[i]; if (d < 0) d += 1;      // distance behind the tip
      const heat = Math.exp(-d * 3.5);            // long, slow cool-down
      const temp = 0.25 + 0.75 * heat;            // magma parameter: indigo -> cream
      const glow = 0.5 + 1.7 * heat;              // dim base, very hot tip
      magma(temp, _col);
      const r = _col[0] * glow, g = _col[1] * glow, bl = _col[2] * glow, e = Math.min(VCOUNT, i + RING);
      for (let j = i; j < e; j++) { a[j * 3] = r; a[j * 3 + 1] = g; a[j * 3 + 2] = bl; }
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
    b.textContent = G.playing ? 'Stop triad' : 'Play triad';
    b.classList.toggle('on', G.playing);
  }

  // ------------------------------------------------------------------ frame
  const TRACE = 0.06;                 // tip speed, in path lengths per second (gentle)
  let last = performance.now(), tt = 0;
  // The first rAF timestamp can be earlier than the performance.now() that set
  // last, so dt can be negative. A negative dt made tt negative (% keeps the
  // sign), and CURVE.getPointAt(tt) then read past the curve points and threw.
  // dt is clamped to 0..0.05 and tt is wrapped into 0..1.
  // The next frame is requested first, so one bad frame cannot stop the loop.
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); last = now;
    // live phases = static offset + rate * elapsed time
    const el = (now - startT) / 1000;
    ephX = (G.phaseX + G.pRateX * el) * TAU;
    ephY = (G.phaseY + G.pRateY * el) * TAU;
    ephZ = (G.phaseZ + G.pRateZ * el) * TAU;
    if (SAVER.on) saverStep(dt, el);
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
    tt = (((tt + dt * TRACE) % 1) + 1) % 1;
    updateHeat(tt);
    if (CURVE) { CURVE.getPointAt(tt, _p); head.position.copy(_p); updateFrame(tt); }
    renderer.render(scene, c);
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
    const setOrtho = on => { useOrtho = on; projBtn.textContent = on ? 'Orthographic' : 'Perspective'; projBtn.classList.toggle('on', on); resize(); };
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

  // ------------------------------------------------------------ screensaver
  // lib/screensaver.js has the protocol. The CSS under html.sn-saver hides the
  // panel, gear, hint and status; #gl is already full-window. enter() plays a
  // seeded tour of SAVER_TOUR. Each figure holds for a dwell. One phase drifts
  // slowly, so the knot morphs, and the camera spins. A figure change fades
  // the tube out and in (tube, head and arrow opacity). Each figure sends
  // opts.label the three oscillator equations, the ratio a:b:c, the phases
  // and what the curve is. calm 1 is the slowest. The triad stays off.
  const SAVER = { on: false, opts: null, order: [], k: 0, t: 0, dwell: 18, slow: 1, st: null };
  // [a, b, c, drifting axis (0 x, 1 y, 2 z, -1 none), start phase in turns,
  //  base drift rate in turns/s, detune ε]
  const SAVER_TOUR = [
    [3, 2, 4, 1, 0.25, 0.010, 0], [1, 2, 3, 0, 0.0, 0.012, 0], [2, 3, 5, 2, 0.1, 0.008, 0],
    [3, 4, 5, 1, 0.2, 0.008, 0], [2, 5, 3, 0, 0.15, 0.009, 0], [1, 1, 2, 2, 0.0, 0.012, 0],
    [3, 5, 4, 1, 0.3, 0.007, 0], [2, 3, 4, -1, 0.25, 0, 0.02], [3, 2, 5, 0, 0.1, 0.009, 0],
  ];
  const SAVER_FADE = 1.2;
  function saverRand(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const gcd = (p, q) => q ? gcd(q, p % q) : p;
  const turns = v => (((v % 1) + 1) % 1).toFixed(2) + 'τ';
  function saverOpacity(f) {
    tubeMat.opacity = f; head.material.opacity = f;
    [arrowV, arrowN, arrowB].forEach(a => { a.line.material.transparent = true; a.cone.material.transparent = true;
      a.line.material.opacity = f; a.cone.material.opacity = f; });
  }
  function saverFigure(k, el) {
    SAVER.k = k; SAVER.t = 0;
    const [a, b, c, ax, d0, rate, eps] = SAVER_TOUR[SAVER.order[k % SAVER.order.length]];
    const r = rate * SAVER.slow;
    SAVER.st = { a, b, c, ax, d0, r, eps };
    G.A = a; G.B = b; G.C = c; G.detuneCoarse = eps; G.detuneFine = 0;
    // Fixed phases: δx = 0, δy = 0.25τ, δz = 0. The drifting axis starts at d0
    // now: its live phase is phase + rate * el (see frame()).
    G.phaseX = 0; G.phaseY = 0.25; G.phaseZ = 0; G.pRateX = G.pRateY = G.pRateZ = 0;
    const PK = ['phaseX', 'phaseY', 'phaseZ'], RK = ['pRateX', 'pRateY', 'pRateZ'];
    if (ax >= 0) { G[RK[ax]] = r; G[PK[ax]] = d0 - r * el; }
    // frame() set the live phases before this call; set them again from the new
    // G, so buildCurve() does not use the phases of the last figure.
    ephX = (G.phaseX + G.pRateX * el) * TAU; ephY = (G.phaseY + G.pRateY * el) * TAU; ephZ = (G.phaseZ + G.pRateZ * el) * TAU;
    syncSteppers(); markPreset(); buildCurve(); refreshStatus(); tt = 0;
    const ph = [0, 0.25, 0]; if (ax >= 0) ph[ax] = d0;
    const AX = ['x', 'y', 'z'], d1 = d0 + r * SAVER.dwell;
    const coprime = gcd(a, b) === 1 && gcd(b, c) === 1 && gcd(a, c) === 1;
    // Each line: the general form, then the live values (δ at the figure start).
    const live = (n, d) => 'sin(' + n + 'ωt' + (d ? ' + ' + turns(d) : '') + ')';
    const eq = [
      'x = A sin(' + (eps ? '(a + ε)' : 'a') + 'ωt + δx) = ' + live(eps ? '(' + a + ' + ' + eps + ')' : a, ph[0]),
      'y = B sin(bωt + δy) = ' + live(b, ph[1]),
      'z = C sin(cωt + δz) = ' + live(c, ph[2]),
    ];
    const lines = ['a : b : c = ' + a + ' : ' + b + ' : ' + c + ', A = B = C = 1'];
    if (eps) lines.push('ε = +' + eps + ': the loop closes only after 1/ε = ' + Math.round(1 / eps) + ' periods, so the path fills a shell');
    else lines.push('δ' + AX[ax] + ' drifts ' + turns(d0) + ' → ' + turns(d1) + ' (τ = 2π) over this figure');
    lines.push(eps ? 'a detuned 3D Lissajous curve'
      : coprime ? 'pairwise coprime: a Lissajous knot, one closed loop with no self-crossing for most phases'
      : 'closed 3D Lissajous curve; ' + a + ', ' + b + ', ' + c + ' are not pairwise coprime, so it can cross itself');
    lines.push('arrows: velocity, normal, binormal · triad ' + a + '·f₀ ' + b + '·f₀ ' + c + '·f₀ (sound off)');
    if (SAVER.opts && SAVER.opts.label) SAVER.opts.label({
      title: '3D Lissajous ' + (eps || !coprime ? 'curve' : 'knot') + ' · ' + a + ' : ' + b + ' : ' + c,
      sub: 'three perpendicular oscillators · ' + (eps ? 'drifting shell' : 'closed loop'),
      eq, lines,
    });
  }
  function saverStep(dt, el) {
    SAVER.t += dt;
    if (SAVER.t >= SAVER.dwell) saverFigure(SAVER.k + 1, el);
    const left = SAVER.dwell - SAVER.t;
    // The detuned shell has many strands that add up, so it shows at 0.6.
    const top = SAVER.st && SAVER.st.eps ? 0.6 : 1;
    saverOpacity(top * Math.max(0, Math.min(1, SAVER.t / SAVER_FADE, left / SAVER_FADE)));
  }
  window.snSaver = {
    enter(o) {
      o = o || {};
      const calm = o.calm != null ? Math.min(1, Math.max(0, o.calm)) : 0.7;
      document.documentElement.classList.add('sn-saver');
      if (G.playing) stopTones();
      renderer.setClearColor(0x040308, 1);     // opaque, so a recording has no alpha
      const rnd = saverRand(o.seed || 1);
      SAVER.order = SAVER_TOUR.map((_, i) => i);
      for (let i = SAVER.order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [SAVER.order[i], SAVER.order[j]] = [SAVER.order[j], SAVER.order[i]]; }
      SAVER.slow = 1 - 0.7 * calm;
      SAVER.dwell = Math.max(12, Math.min(24, (o.seconds || 60) / 4));
      SAVER.opts = o; SAVER.on = true;
      G.spin = 0.15 + 0.25 * (1 - calm);
      view.R = 6; view.snapUp = false;          // a margin round the knot
      resize();
      saverFigure(0, (performance.now() - startT) / 1000);
      SAVER.t = SAVER_FADE;                      // the shell fades the first figure in
      return { canvas, warmupMs: 500 };
    },
    exit() { SAVER.on = false; saverOpacity(1); resize(); },
  };

  // ------------------------------------------------------------------- boot
  resize();
  buildUI();
  buildCurve();
  refreshStatus();
  requestAnimationFrame(frame);
  // xr.js (a module, lib/xr-view.js) reads these for the VR and AR view
  window.__res3d = { renderer, scene, camera: persp, G, S };
})();
