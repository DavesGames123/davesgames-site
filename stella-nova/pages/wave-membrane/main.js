/* ============================================================================
   WAVE MEMBRANE  ·  main script  (three.js r128, global THREE)
   ----------------------------------------------------------------------------
   sim.js steps the membrane. This script draws it, colors it, and binds the
   controls. The grid of the solver maps onto the mesh one node to one vertex:
       solver node (i, j)  ->  vertex j*N + i
       sim x in [0,1]      ->  world X in [-S, S]
       sim y in [0,1]      ->  world Z in [S, -S]
       u                   ->  world Y (height) = u * HEIGHT

   RENDER MODEL. Each frame runs a number of leapfrog substeps. That number is
   the real frame time times a base step rate, times the rate slider, times c.
   The step dt is cfl*h/c, so the factor c keeps the sim time per real second
   fixed. A larger c then gives a shorter period on screen. The mesh reads s.u
   for height and s.acc for the acceleration color modes.

   COLOR. Each color mode maps one field onto a ramp. The scale is a running
   maximum: it rises at once to a new peak, and it falls by 0.2% per frame.
   A standing wave passes through zero twice per period, so a per-frame
   maximum would make the colors flicker. The legend shows the running scale.

   GREP MAP
     grep -n 'function makeSolver'   solver build on a shape or c change
     grep -n 'function applyModes'   the mode list, amplitude normalization
     grep -n 'function buildMesh'    the membrane geometry for each shape
     grep -n 'function paint'        per-vertex color for each color mode
     grep -n 'function drawLegend'   the colorbar and its numeric scale
     grep -n 'function buildNodal'   the analytic nodal-line overlay
     grep -n 'function frame'        the render loop, substeps, and camera
     grep -n 'function refreshReadout'  equation readout, energy, drift
     grep -n 'function buildUI'      the control panel construction
   ========================================================================== */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const S = 1.5;            // half-width of the membrane in world units
  const HEIGHT = 0.85;      // world height per unit of u
  const GRID = 96;          // solver nodes per side
  const CFL = 0.5;          // below the 2D limit 1/sqrt(2)
  const STEP_RATE = 110;    // solver steps per real second at c = 1, rate = 1
  const MOB = window.matchMedia('(max-width:768px)').matches || window.matchMedia('(pointer:coarse)').matches;

  // Mode limits per shape. The square needs m, n >= 1. The drum allows m = 0.
  const LIM = {
    square: { m: [1, 6], n: [1, 6] },
    circle: { m: [0, 5], n: [1, 4] },
  };

  const G = {
    shape: 'square',
    m1: 2, n1: 1,
    two: false, m2: 1, n2: 3, amp2: 0.6,
    amp: 0.7, c: 1.0, speed: 1.0,
    paused: false, color: 'height', nodal: true,
  };

  // ------------------------------------------------------------- color ramps
  const MAGMA = [
    [0.001,0.000,0.014],[0.106,0.058,0.243],[0.271,0.063,0.454],[0.447,0.122,0.506],
    [0.624,0.184,0.494],[0.804,0.251,0.443],[0.945,0.376,0.365],[0.992,0.585,0.404],[0.988,0.992,0.749],
  ];
  // Diverging ramp for signed acceleration: pale blue, blue, near black,
  // orange, pale yellow. The dark center marks zero on the dark page.
  const DIVERGE = [
    [0.66,0.85,1.00],[0.20,0.45,0.85],[0.08,0.06,0.11],[0.85,0.36,0.18],[1.00,0.88,0.62],
  ];
  // Height ramp: purple below, a lit neutral at zero, warm orange above.
  const HEIGHTR = [
    [0.36,0.16,0.50],[0.55,0.35,0.62],[0.60,0.55,0.66],[0.88,0.58,0.40],[0.99,0.72,0.42],
  ];
  function ramp(R, t, o) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = t * (R.length - 1), i = Math.min(Math.floor(x), R.length - 2), f = x - i;
    const a = R[i], b = R[i + 1];
    o[0] = a[0] + (b[0] - a[0]) * f; o[1] = a[1] + (b[1] - a[1]) * f; o[2] = a[2] + (b[2] - a[2]) * f;
    return o;
  }

  // --------------------------------------------------------------- three setup
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const view = { theta: 0.75, phi: 1.02, R: 5.4 };
  // A tall, narrow view needs the camera further out to show the full width.
  view.R /= Math.min(1, (canvas.clientWidth || 1) / (canvas.clientHeight || 1));

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(3, 5, 2); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffd8c0, 0.18); fill.position.set(-3, -2, -2); scene.add(fill);

  // The mesh sits one step behind in depth, so the nodal lines at u = 0 win.
  const memMat = new THREE.MeshPhongMaterial({
    vertexColors: true, side: THREE.DoubleSide, shininess: 28, specular: 0x222222,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const membrane = new THREE.Mesh(new THREE.BufferGeometry(), memMat);
  scene.add(membrane);

  const rimMat = new THREE.LineBasicMaterial({ color: 0x8a7a9a, transparent: true, opacity: 0.8 });
  let rim = null;
  const nodalMat = new THREE.LineBasicMaterial({ color: 0xfcfdbf, transparent: true, opacity: 0.85 });
  let nodal = null;

  // A faint floor grid under the membrane, for depth.
  const floor = new THREE.GridHelper(2 * S, 12, 0x3a2a48, 0x1c1426);
  floor.position.y = -HEIGHT * 1.15;
  floor.material.transparent = true; floor.material.opacity = 0.55;
  scene.add(floor);

  const worldX = x => (x - 0.5) * 2 * S;
  const worldZ = y => (0.5 - y) * 2 * S;

  // --------------------------------------------------------------- solver
  let sim = null, E0 = 0, runMax = 1e-9, stepCarry = 0;
  function makeSolver() {
    sim = new MembraneSolver({ N: GRID, c: G.c, shape: G.shape, cfl: CFL });
    buildMesh();
    applyModes();
  }

  // Peak of |J_m(k r)| over the disk, so each drum mode shows at the set
  // amplitude. A square mode already peaks at 1.
  const peakCache = {};
  function modePeak(m, n) {
    if (G.shape !== 'circle') return 1;
    const key = m + ',' + n;
    if (peakCache[key]) return peakCache[key];
    const k = MembraneSolver.besselZero(m, n) / 0.5;
    let p = 0;
    for (let q = 0; q <= 400; q++) p = Math.max(p, Math.abs(MembraneSolver.besselJ(m, k * 0.5 * q / 400)));
    return (peakCache[key] = p || 1);
  }

  function modeList() {
    const list = [{ m: G.m1, n: G.n1, amp: G.amp / modePeak(G.m1, G.n1) }];
    if (G.two && G.amp2 > 0) list.push({ m: G.m2, n: G.n2, amp: G.amp * G.amp2 / modePeak(G.m2, G.n2) });
    return list;
  }
  const isSingle = () => !G.two || G.amp2 <= 0;
  // Two modes with the same omega still make one standing wave.
  const sameOmega = () => G.two && Math.abs(sim.omega(G.m1, G.n1) - sim.omega(G.m2, G.n2)) < 1e-9;

  // The drum modes go through the solver refine pass. See setMode in sim.js.
  function applyModes() {
    sim.setMode(modeList(), { refine: true });
    E0 = sim.energy();
    runMax = 1e-9;
    stepCarry = 0;
    buildNodal();
    updateMesh();
    refreshReadout();
    refreshStatus();
  }

  // --------------------------------------------------------------- buildMesh
  // One vertex per solver node. The square uses every quad. The drum uses
  // each quad with at least one corner inside the disk, and it draws each
  // vertex outside the disk on the rim. Those nodes are fixed at u = 0, so
  // the move is only visual. It gives a round edge with no gaps, in place of
  // a staircase.
  let POS = null, COL = null;
  function buildMesh() {
    const N = GRID, h = 1 / (N - 1), circ = G.shape === 'circle';
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        let x = i * h, y = j * h;
        if (circ) {
          const dx = x - 0.5, dy = y - 0.5, r = Math.hypot(dx, dy);
          if (r > 0.5) { x = 0.5 + dx * 0.5 / r; y = 0.5 + dy * 0.5 / r; }
        }
        const v = (j * N + i) * 3;
        pos[v] = worldX(x); pos[v + 1] = 0; pos[v + 2] = worldZ(y);
      }
    }
    const idx = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        if (circ) {
          const inside = (ii, jj) => Math.hypot(ii * h - 0.5, jj * h - 0.5) < 0.5;
          if (!inside(i, j) && !inside(i + 1, j) && !inside(i, j + 1) && !inside(i + 1, j + 1)) continue;
        }
        idx.push(a, b, d, a, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    membrane.geometry.dispose();
    membrane.geometry = geo;
    POS = geo.attributes.position; COL = geo.attributes.color;

    if (rim) { scene.remove(rim); rim.geometry.dispose(); }
    const rp = [];
    if (circ) {
      for (let q = 0; q < 128; q++) { const a = TAU * q / 128; rp.push(new THREE.Vector3(worldX(0.5 + 0.5 * Math.cos(a)), 0, worldZ(0.5 + 0.5 * Math.sin(a)))); }
    } else {
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y]) => rp.push(new THREE.Vector3(worldX(x), 0, worldZ(y))));
    }
    rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rp), rimMat);
    scene.add(rim);
  }

  function updateMesh() {
    const u = sim.u, p = POS.array, n = GRID * GRID;
    for (let k = 0; k < n; k++) p[k * 3 + 1] = u[k] * HEIGHT;
    POS.needsUpdate = true;
    membrane.geometry.computeVertexNormals();
    paint();
  }

  // --------------------------------------------------------------- paint
  // The scale for each mode is the running maximum of the field it shows:
  // |u| for HEIGHT, |acc| for the two acceleration modes.
  const _c = [0, 0, 0];
  function paint() {
    const n = GRID * GRID, col = COL.array, mask = sim.mask;
    const f = G.color === 'height' ? sim.u : sim.acc;
    let fmax = 0;
    for (let k = 0; k < n; k++) if (mask[k]) { const a = Math.abs(f[k]); if (a > fmax) fmax = a; }
    runMax = Math.max(fmax, runMax * 0.998, 1e-9);
    const inv = 1 / runMax;
    for (let k = 0; k < n; k++) {
      const v = f[k] * inv;
      if (G.color === 'accmag') ramp(MAGMA, Math.abs(v), _c);
      else if (G.color === 'accsgn') ramp(DIVERGE, 0.5 + 0.5 * v, _c);
      else ramp(HEIGHTR, 0.5 + 0.5 * v, _c);
      col[k * 3] = _c[0]; col[k * 3 + 1] = _c[1]; col[k * 3 + 2] = _c[2];
    }
    COL.needsUpdate = true;
  }

  // --------------------------------------------------------------- legend
  const lgBar = document.getElementById('lgBar');
  function drawLegend() {
    const g = lgBar.getContext('2d'), W = lgBar.width, H = lgBar.height;
    const R = G.color === 'accmag' ? MAGMA : G.color === 'accsgn' ? DIVERGE : HEIGHTR;
    for (let x = 0; x < W; x++) {
      ramp(R, x / (W - 1), _c);
      g.fillStyle = 'rgb(' + (_c[0] * 255 | 0) + ',' + (_c[1] * 255 | 0) + ',' + (_c[2] * 255 | 0) + ')';
      g.fillRect(x, 0, 1, H);
    }
    document.getElementById('lgTitle').textContent =
      G.color === 'accmag' ? '|∂²u/∂t²| = |c²∇²u|' : G.color === 'accsgn' ? '∂²u/∂t²  (signed)' : 'height u';
  }
  const num = v => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) ? v.toExponential(2) : v.toPrecision(3);
  function refreshLegendScale() {
    const m = runMax;
    if (G.color === 'accmag') {
      setText('lgLo', '0'); setText('lgMid', num(m / 2)); setText('lgHi', num(m));
    } else {
      setText('lgLo', num(-m)); setText('lgMid', '0'); setText('lgHi', num(m));
    }
  }

  // --------------------------------------------------------------- buildNodal
  // Nodal lines of a single mode, from the analytic shape.
  //   square: x = k/m and y = k/n
  //   drum:   m diameters where cos(m*theta) = 0, and n-1 circles at the
  //           earlier zeros of J_m, r = j_{m,l} / k_mn
  // A sum of modes with different omega has no fixed nodal lines, so the
  // overlay is off in that case.
  function buildNodal() {
    if (nodal) { scene.remove(nodal); nodal.geometry.dispose(); nodal = null; }
    if (!isSingle()) return;
    const m = G.m1, n = G.n1, seg = [];
    const push = (x0, y0, x1, y1) => seg.push(worldX(x0), 0, worldZ(y0), worldX(x1), 0, worldZ(y1));
    if (G.shape === 'circle') {
      for (let k = 0; k < m; k++) {
        const a = (2 * k + 1) * Math.PI / (2 * m), dx = 0.5 * Math.cos(a), dy = 0.5 * Math.sin(a);
        push(0.5 - dx, 0.5 - dy, 0.5 + dx, 0.5 + dy);
      }
      const kmn = MembraneSolver.besselZero(m, n);
      for (let l = 1; l < n; l++) {
        const r = 0.5 * MembraneSolver.besselZero(m, l) / kmn;
        for (let q = 0; q < 96; q++) {
          const a0 = TAU * q / 96, a1 = TAU * (q + 1) / 96;
          push(0.5 + r * Math.cos(a0), 0.5 + r * Math.sin(a0), 0.5 + r * Math.cos(a1), 0.5 + r * Math.sin(a1));
        }
      }
    } else {
      for (let k = 1; k < m; k++) push(k / m, 0, k / m, 1);
      for (let k = 1; k < n; k++) push(0, k / n, 1, k / n);
    }
    if (!seg.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seg), 3));
    nodal = new THREE.LineSegments(g, nodalMat);
    nodal.renderOrder = 2;
    nodal.visible = G.nodal;
    scene.add(nodal);
  }

  // --------------------------------------------------------------- frame
  let last = performance.now(), frameNo = 0;
  function frame(now) {
    const dtReal = Math.min((now - last) / 1000, 0.05); last = now;
    if (!G.paused) {
      stepCarry += dtReal * STEP_RATE * G.speed * G.c;
      const k = Math.min(Math.floor(stepCarry), 400);
      stepCarry -= k;
      if (k > 0) { sim.step(k); updateMesh(); }
    }
    const st = Math.sin(view.phi), ct = Math.cos(view.phi);
    camera.position.set(view.R * st * Math.sin(view.theta), view.R * ct, view.R * st * Math.cos(view.theta));
    camera.lookAt(0, -0.15, 0);
    renderer.render(scene, camera);
    if (++frameNo % 6 === 0) { refreshReadout(); refreshLegendScale(); }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------- camera drag + pinch
  // One pointer orbits. Two pointers pinch to zoom, so touch works with no wheel.
  const ptrs = new Map();
  let pinchD = 0;
  const clampPhi = p => Math.max(0.05, Math.min(Math.PI - 0.05, p));
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

  // --------------------------------------------------------------- readout
  function setText(id, s) { const el = document.getElementById(id); if (el && el.textContent !== s) el.textContent = s; }
  const modeTxt = (m, n) => '(' + m + ', ' + n + ')';
  function refreshReadout() {
    const w1 = sim.omega(G.m1, G.n1), T1 = TAU / w1;
    if (isSingle()) {
      setText('rdMode', (G.shape === 'circle' ? 'drum ' : 'square ') + modeTxt(G.m1, G.n1));
      setText('rdOmega', w1.toFixed(4) + ' rad/s');
      setText('rdT', T1.toFixed(4) + ' s');
    } else {
      const w2 = sim.omega(G.m2, G.n2);
      setText('rdMode', modeTxt(G.m1, G.n1) + ' + ' + G.amp2.toFixed(2) + '·' + modeTxt(G.m2, G.n2));
      setText('rdOmega', w1.toFixed(3) + ' · ' + w2.toFixed(3));
      setText('rdT', T1.toFixed(3) + ' · ' + (TAU / w2).toFixed(3) + ' s');
    }
    const E = sim.energy();
    setText('rdE', E.toPrecision(6));
    setText('rdDrift', E0 > 0 ? ((E - E0) / E0 * 100).toFixed(4) + ' %' : '—');
    setText('rdTime', sim.t.toFixed(3) + ' s  ·  ' + (sim.t / T1).toFixed(2) + ' T');
    setText('rdGrid', GRID + '² · dt ' + sim.dt.toFixed(5) + ' · CFL ' + CFL);
  }
  function refreshStatus() {
    const w1 = sim.omega(G.m1, G.n1);
    let main = (G.shape === 'circle' ? 'drum ' : 'square ') + modeTxt(G.m1, G.n1);
    if (!isSingle()) main += ' + ' + modeTxt(G.m2, G.n2) + (sameOmega() ? ' · same ω, still one standing wave' : ' · superposition');
    else main += ' · standing wave';
    setText('stMain', main);
    setText('stRight', 'ω ' + w1.toFixed(3) + ' rad/s · T ' + (TAU / w1).toFixed(3) + ' s · c ' + G.c.toFixed(2));
    setText('modeHint', G.shape === 'circle'
      ? 'm nodal diameters, n − 1 nodal circles. Frequency ω = c·j(m,n)/a, where j(m,n) is the n-th zero of Jm and a = 0.5.'
      : 'm half waves along x, n half waves along y. Frequency ω = cπ√(m² + n²) on the unit square.');
    setText('nodalHint', isSingle()
      ? 'The pale lines stay at u = 0 for all time.'
      : sameOmega()
        ? 'Both modes have the same ω. The sum is still one standing wave, but its nodal lines are not drawn.'
        : 'Two modes with different ω have no fixed nodal lines, so none are drawn.');
  }

  // --------------------------------------------------------------- buildUI
  function clampModes() {
    const L = LIM[G.shape];
    const cl = (v, r) => Math.max(r[0], Math.min(r[1], v));
    G.m1 = cl(G.m1, L.m); G.n1 = cl(G.n1, L.n); G.m2 = cl(G.m2, L.m); G.n2 = cl(G.n2, L.n);
  }
  function syncSteppers() {
    const L = LIM[G.shape];
    [['M1', 'm1', 'm'], ['N1', 'n1', 'n'], ['M2', 'm2', 'm'], ['N2', 'n2', 'n']].forEach(([id, key, ax]) => {
      document.getElementById('num' + id).textContent = G[key];
      const b = document.getElementById('step' + id).querySelectorAll('button');
      b[0].disabled = G[key] <= L[ax][0];
      b[1].disabled = G[key] >= L[ax][1];
    });
  }
  function buildUI() {
    const bindStep = (id, key, ax) => document.getElementById(id).querySelectorAll('button').forEach(btn =>
      btn.addEventListener('click', () => {
        const r = LIM[G.shape][ax];
        G[key] = Math.max(r[0], Math.min(r[1], G[key] + (+btn.dataset.d)));
        syncSteppers(); applyModes();
      }));
    bindStep('stepM1', 'm1', 'm'); bindStep('stepN1', 'n1', 'n');
    bindStep('stepM2', 'm2', 'm'); bindStep('stepN2', 'n2', 'n');

    const setShape = s => {
      if (G.shape === s) return;
      G.shape = s;
      document.getElementById('shapeSquare').classList.toggle('on', s === 'square');
      document.getElementById('shapeCircle').classList.toggle('on', s === 'circle');
      clampModes(); syncSteppers(); makeSolver();
    };
    document.getElementById('shapeSquare').addEventListener('click', () => setShape('square'));
    document.getElementById('shapeCircle').addEventListener('click', () => setShape('circle'));

    const m2Btn = document.getElementById('mode2Btn');
    m2Btn.addEventListener('click', () => {
      G.two = !G.two;
      m2Btn.textContent = G.two ? '− REMOVE SECOND MODE' : '+ ADD SECOND MODE';
      m2Btn.classList.toggle('on', G.two);
      document.getElementById('mode2Box').classList.toggle('off', !G.two);
      applyModes();
    });

    bindRange('amp', 'amp', v => v.toFixed(2), applyModes);
    bindRange('amp2', 'amp2', v => v.toFixed(2), applyModes);
    bindRange('c', 'c', v => v.toFixed(2), makeSolver);
    bindRange('speed', 'speed', v => v.toFixed(2) + '×', null);

    const pauseBtn = document.getElementById('pauseBtn');
    const setPaused = p => { G.paused = p; pauseBtn.textContent = p ? '▶ PLAY' : '❚❚ PAUSE'; pauseBtn.classList.toggle('on', p); };
    pauseBtn.addEventListener('click', () => setPaused(!G.paused));
    document.getElementById('stepBtn').addEventListener('click', () => {
      setPaused(true);
      const T = TAU / sim.omega(G.m1, G.n1);
      sim.step(Math.max(1, Math.round(T / 24 / sim.dt)));
      updateMesh(); refreshReadout(); refreshLegendScale();
    });
    document.getElementById('resetBtn').addEventListener('click', () => { applyModes(); refreshLegendScale(); });

    document.querySelectorAll('#colorModes button').forEach(b => b.addEventListener('click', () => {
      G.color = b.dataset.mode;
      document.querySelectorAll('#colorModes button').forEach(x => x.classList.toggle('on', x === b));
      runMax = 1e-9; paint(); drawLegend(); refreshLegendScale();
    }));
    const nodalBtn = document.getElementById('nodalBtn');
    nodalBtn.addEventListener('click', () => {
      G.nodal = !G.nodal;
      nodalBtn.textContent = G.nodal ? 'NODAL LINES · ON' : 'NODAL LINES · OFF';
      nodalBtn.classList.toggle('on', G.nodal);
      if (nodal) nodal.visible = G.nodal;
    });

    const panel = document.getElementById('panel');
    document.getElementById('gear').addEventListener('click', () => panel.classList.toggle('open'));
    document.getElementById('panelClose').addEventListener('click', () => panel.classList.remove('open'));
    if (MOB) panel.classList.remove('open');    // start closed on phones
    syncSteppers();
  }
  // Bind a slider to G[key]. The after hook runs on input, not at boot,
  // because the solver does not exist yet when buildUI runs.
  function bindRange(id, key, fmtFn, after) {
    const inp = document.getElementById(id), out = document.getElementById(id + 'V');
    const show = () => { G[key] = +inp.value; out.textContent = fmtFn(+inp.value); };
    inp.addEventListener('input', () => { show(); if (after) after(); refreshStatus(); });
    show();
  }

  // ------------------------------------------------------------------- boot
  resize();
  buildUI();
  makeSolver();
  drawLegend();
  refreshLegendScale();
  requestAnimationFrame(frame);
})();
