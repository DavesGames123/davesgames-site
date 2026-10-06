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
     grep -n 'function occlusion'    the overlay margins that frame the camera
     grep -n 'function refreshReadout'  equation readout, energy, drift
     grep -n 'function buildUI'      the control panel construction
     grep -n 'function setOpen'      the panel, the phone sheet, and the dock
     grep -n 'snSaver'               the screensaver hook (lib/screensaver.js)

   FRAMING. The panel, the dock, and the bars cover parts of the canvas.
   occlusion() measures them each frame. The camera then shifts its view so
   the membrane sits in the center of the clear part, and it moves back until
   the membrane fits there. The shift eases, so it follows a sliding panel.
   ========================================================================== */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const S = 1.5;            // half-width of the membrane in world units
  const HEIGHT = 0.85;      // world height per unit of u
  let heightK = 1;          // height scale: 1 on the page, 0.5-0.8 in the saver
  const GRID = 96;          // solver nodes per side
  const CFL = 0.5;          // below the 2D limit 1/sqrt(2)
  const STEP_RATE = 110;    // solver steps per real second at c = 1, rate = 1
  // The phone layout. This query matches the PHONE block in style.css.
  const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');

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
  // Height ramp: bright violet below, a dark neutral at zero, bright amber
  // above. The two ends differ in hue, and both differ in lightness from zero,
  // so a crest, a trough, and a nodal line each read clearly.
  const HEIGHTR = [
    [0.62,0.44,1.00],[0.42,0.20,0.78],[0.13,0.10,0.17],[0.93,0.42,0.12],[1.00,0.86,0.45],
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
  const VIEW0 = { theta: 0.75, phi: 1.02 };
  const view = { theta: VIEW0.theta, phi: VIEW0.phi, zoom: 1, R: 5.4 };

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // Overlay margins in CSS px. An overlay wider than tall (relative to the
  // canvas) covers the top or the base. Any other overlay covers a side. An
  // overlay counts only when it spans half of that edge or more, so a small
  // corner box (the desktop legend) does not move the membrane.
  const OVERLAYS = ['panel', 'dock', 'status', 'legend', 'eqPanel'].map(id => document.getElementById(id))
    .concat([document.querySelector('.topbar')]).filter(Boolean);
  const occ = { l: 0, r: 0, t: 0, b: 0 };
  function occlusion(w, h) {
    const o = { l: 0, r: 0, t: 0, b: 0 };
    for (const el of OVERLAYS) {
      const q = el.getBoundingClientRect();
      const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right);
      const y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
      if (fw >= fh) {
        if (fw < 0.5) continue;
        if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1);
      } else {
        if (fh < 0.5) continue;
        if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0);
      }
    }
    // The saver adds the shell plate: its top text and bottom text
    // (plateBand, lib/saver-clear.js, read 4 times a second) count as bars,
    // so the membrane sits and fits in the clear band between them. The
    // band keeps at least 35% of the height; a taller plate gives up its
    // margin in proportion.
    if (saverOn && plateBandFn) {
      const now = performance.now();
      if (now - bandAt > 250) { bandAt = now; band = plateBandFn(h); }
      if (band) {
        let t = band.t, b = band.b; const k = (t + b) / (0.65 * h);
        if (k > 1) { t /= k; b /= k; }
        o.t = Math.max(o.t, t); o.b = Math.max(o.b, b);
      }
    }
    return o;
  }
  let plateBandFn = null, band = null, bandAt = -1e9;
  // Camera distance that fits the membrane in the clear part. At R = 5.4 the
  // membrane spans about 0.85 h across and 0.55 h high, with h the canvas
  // height. The fit keeps it inside 92% of the clear width and 85% of the
  // clear height. 5.4 is the floor, so a large screen keeps the desktop view.
  function fitR(w, h, wV, hV) { return Math.max(5.4, 4.96 * h / wV, 3.5 * h / hV); }

  // Low ambient and a strong key light, so the slope of the membrane shades.
  const amb = new THREE.AmbientLight(0xffffff, 0.42); scene.add(amb);
  const sun = new THREE.DirectionalLight(0xffffff, 0.85); sun.position.set(3, 5, 2); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffd8c0, 0.18); fill.position.set(-3, -2, -2); scene.add(fill);

  // The mesh sits one step behind in depth, so the nodal lines at u = 0 win.
  const memMat = new THREE.MeshPhongMaterial({
    vertexColors: true, side: THREE.DoubleSide, shininess: 40, specular: 0x3a3a3a,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const membrane = new THREE.Mesh(new THREE.BufferGeometry(), memMat);
  scene.add(membrane);
  // Saver only: a wire overlay that shares the membrane geometry, and a
  // black plane in front of the camera for the fade between scenes. Both
  // stay hidden on the page.
  const wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false });
  const wire = new THREE.Mesh(membrane.geometry, wireMat);
  wire.visible = false; wire.renderOrder = 1; scene.add(wire);
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const fadePlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), fadeMat);
  fadePlane.position.z = -0.5; fadePlane.renderOrder = 999; fadePlane.visible = false;
  camera.add(fadePlane); scene.add(camera);

  const rimMat = new THREE.LineBasicMaterial({ color: 0xd6cfe0, transparent: true, opacity: 0.9 });
  let rim = null;
  const nodalMat = new THREE.LineBasicMaterial({ color: 0xfcfdbf, transparent: true, opacity: 1 });
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
    if (saverLabel) saverPlate();
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
    for (let k = 0; k < n; k++) p[k * 3 + 1] = u[k] * HEIGHT * heightK;
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
    const sv = saverOn ? saverScene : null;
    for (let k = 0; k < n; k++) {
      const v = f[k] * inv;
      if (sv) saverColor(sv, v);
      else if (G.color === 'accmag') ramp(MAGMA, Math.abs(v), _c);
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
    // A word in plain text, then the quantity as MathJax SVG (equations.js).
    const lg = G.color === 'accmag' ? ['Acceleration ', String.raw`\left|\partial^2 u/\partial t^2\right|`]
      : G.color === 'accsgn' ? ['Signed acceleration ', String.raw`\partial^2 u/\partial t^2`] : ['Height ', 'u'];
    const lgEl = document.getElementById('lgTitle'), sym = document.createElement('span');
    sym.className = 'sci-sym'; lgEl.replaceChildren(lg[0], sym);
    if (window.WM_MATH) WM_MATH.typeset(sym, lg[1]); else sym.textContent = lg[1];
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
  let last = performance.now(), frameNo = 0, saverSpin = 0;
  function frame(now) {
    const dtReal = Math.min((now - last) / 1000, 0.05); last = now;
    if (!G.paused) {
      stepCarry += dtReal * STEP_RATE * G.speed * G.c;
      const k = Math.min(Math.floor(stepCarry), 400);
      stepCarry -= k;
      if (k > 0) { sim.step(k); updateMesh(); }
    }
    if (saverSpin) view.theta += saverSpin * dtReal;   // screensaver orbit only
    if (saverOn) saverTick(dtReal);
    wire.geometry = membrane.geometry;
    const w = canvas.clientWidth, h = canvas.clientHeight, o = occlusion(w, h);
    for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.18;
    const wV = Math.max(80, w - occ.l - occ.r), hV = Math.max(80, h - occ.t - occ.b);
    // Saver: on a tall frame the 0.85 close-up cut off the corners of the
    // membrane, so it uses zoom 1 there.
    const zoom = saverOn && h > w * 1.2 ? Math.max(1, view.zoom) : view.zoom;
    view.R = fitR(w, h, wV, hV) * zoom;
    camera.setViewOffset(w, h, (occ.r - occ.l) / 2, (occ.b - occ.t) / 2, w, h);
    const st = Math.sin(view.phi), ct = Math.cos(view.phi);
    camera.position.set(view.R * st * Math.sin(view.theta), view.R * ct, view.R * st * Math.cos(view.theta));
    // The page aims a little below the centre, for its panels. The saver
    // aims at the centre of the membrane, so it sits at the centre of the
    // clear part (between the plate's top and bottom text).
    camera.lookAt(0, saverOn ? 0 : -0.15, 0);
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
  // A short tap with no drag, twice within 320 ms, resets the view.
  const ZOOM = [0.4, 2.6];
  let tap = null, lastTap = 0;
  const hint = document.getElementById('hint');
  canvas.addEventListener('pointerdown', e => {
    if (hint) hint.classList.add('gone');
    tap = ptrs.size === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
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
      if (pinchD > 0) view.zoom = Math.max(ZOOM[0], Math.min(ZOOM[1], view.zoom * pinchD / d));
      pinchD = d;
    }
  });
  const drop = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinchD = 0; try { canvas.releasePointerCapture(e.pointerId); } catch (x) {} };
  canvas.addEventListener('pointerup', e => {
    const now = performance.now();
    if (tap && ptrs.size === 1 && now - tap.t < 250 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10) {
      if (now - lastTap < 320) { view.theta = VIEW0.theta; view.phi = VIEW0.phi; view.zoom = 1; lastTap = 0; }
      else lastTap = now;
    }
    tap = null;
    drop(e);
  });
  canvas.addEventListener('pointercancel', drop);
  canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoom = Math.max(ZOOM[0], Math.min(ZOOM[1], view.zoom * (1 + e.deltaY * 0.001))); }, { passive: false });

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
      m2Btn.textContent = G.two ? 'Remove second mode' : 'Add second mode';
      m2Btn.classList.toggle('on', G.two);
      document.getElementById('mode2Box').classList.toggle('off', !G.two);
      applyModes();
    });

    bindRange('amp', 'amp', v => v.toFixed(2), applyModes);
    bindRange('amp2', 'amp2', v => v.toFixed(2), applyModes);
    bindRange('c', 'c', v => v.toFixed(2), makeSolver);
    bindRange('speed', 'speed', v => v.toFixed(2) + '×', null);

    const pauseBtn = document.getElementById('pauseBtn');
    const dockPlay = document.getElementById('dockPlay');
    const setPaused = p => {
      G.paused = p;
      pauseBtn.textContent = p ? 'Play' : 'Pause'; pauseBtn.classList.toggle('on', p);
      dockPlay.textContent = p ? '▶' : '❚❚'; dockPlay.classList.toggle('on', p);
      dockPlay.setAttribute('aria-label', p ? 'Play' : 'Pause');
    };
    pauseBtn.addEventListener('click', () => setPaused(!G.paused));
    dockPlay.addEventListener('click', () => setPaused(!G.paused));
    document.getElementById('stepBtn').addEventListener('click', () => {
      setPaused(true);
      const T = TAU / sim.omega(G.m1, G.n1);
      sim.step(Math.max(1, Math.round(T / 24 / sim.dt)));
      updateMesh(); refreshReadout(); refreshLegendScale();
    });
    document.getElementById('resetBtn').addEventListener('click', () => { applyModes(); refreshLegendScale(); });

    // The panel and the phone dock each hold the three color buttons.
    const colorBtns = document.querySelectorAll('#colorModes button, #dockColors button');
    colorBtns.forEach(b => b.addEventListener('click', () => {
      G.color = b.dataset.mode;
      colorBtns.forEach(x => x.classList.toggle('on', x.dataset.mode === G.color));
      runMax = 1e-9; paint(); drawLegend(); refreshLegendScale();
    }));
    const nodalBtn = document.getElementById('nodalBtn');
    nodalBtn.addEventListener('click', () => {
      G.nodal = !G.nodal;
      nodalBtn.textContent = G.nodal ? 'Nodal lines on' : 'Nodal lines off';
      nodalBtn.classList.toggle('on', G.nodal);
      if (nodal) nodal.visible = G.nodal;
    });

    const panel = document.getElementById('panel'), dockPanel = document.getElementById('dockPanel');
    function setOpen(open) {
      panel.classList.toggle('open', open);
      if (!open) panel.classList.remove('full');
      document.body.classList.toggle('panel-closed', !open);
      dockPanel.classList.toggle('on', open);
      dockPanel.setAttribute('aria-expanded', String(open));
    }
    const toggle = () => setOpen(!panel.classList.contains('open'));
    document.getElementById('gear').addEventListener('click', toggle);
    dockPanel.addEventListener('click', toggle);
    document.getElementById('panelClose').addEventListener('click', () => setOpen(false));
    setOpen(!PHONE_Q.matches);                  // start closed on phones
    PHONE_Q.addEventListener('change', e => setOpen(!e.matches));

    // The grip of the phone sheet. A tap switches half and full height. A drag
    // up gives full height. A drag down gives half height, then closes.
    const grip = document.getElementById('sheetGrip');
    let gripY = null;
    grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
    grip.addEventListener('pointerup', e => {
      if (gripY === null) return;
      const dy = e.clientY - gripY; gripY = null;
      if (Math.abs(dy) < 8) panel.classList.toggle('full');
      else if (dy < -40) panel.classList.add('full');
      else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
    });
    grip.addEventListener('pointercancel', () => { gripY = null; });
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

  // ------------------------------------------------------------ screensaver
  // lib/screensaver.js has the protocol. The CSS under html.sn-saver hides
  // every overlay, so occlusion() reads no margins and the membrane sits in
  // the center of the full frame. calm 1 gives the slowest time and orbit.
  //
  // SCENES. opts.seed drives rnd(). A scene is one curated look (SAVER_LOOKS:
  // material, height ramp, background, line colours, the render styles that
  // suit it), a lighting rig (SAVER_RIGS), a render style, a shape, an
  // excitation, a height scale and a camera (polar angle, start azimuth,
  // orbit speed and sense). The excitation is one mode with its nodal lines,
  // a pair of modes with different omega (the sum beats), or a strike: a
  // Gaussian bump at rest, which holds many modes. A new scene comes every
  // hold = seconds / 5, clamped to 8-12 s, behind a 0.6 s fade to black
  // (fadePlane), and the look never repeats twice in a row. On the page
  // (saverOn false) none of this runs: paint() keeps its ramps, heightK
  // stays 1, the wire and the fade plane stay hidden.
  // BRIGHTNESS AND MOTION. Ambient plus key light is 0.85 or less in each
  // rig, and the looks have a wide, dim specular lobe (shininess 20 to 36).
  // A narrow white lobe on the steep crests of a fine mesh gave white
  // speckles. The modes stop at about omega = pi sqrt(13), and a strike
  // bump is 0.08 to 0.12 wide, so no scene holds many fine ripples.
  const SAVER_PAIRS = {
    square: [[2, 1, 1, 3], [3, 2, 1, 2], [2, 3, 3, 1], [1, 2, 3, 1], [2, 2, 1, 3]],
    circle: [[1, 2, 0, 2], [2, 1, 0, 3], [3, 1, 1, 2], [0, 3, 2, 1], [2, 2, 0, 1]],
  };
  const SAVER_SINGLES = {
    square: [[3, 2], [2, 3], [3, 3], [4, 2], [1, 3]],
    circle: [[2, 2], [3, 2], [0, 3], [1, 3], [4, 1]],
  };
  // Ramps run trough, zero, crest (paint maps u/|u|max from -1..1 to 0..1).
  // The zero entry is a mid tone (0.62 or less), so a lit flat is not white.
  const SAVER_LOOKS = [
    { name: 'Calfskin', ramp: [[0.25,0.14,0.06],[0.45,0.30,0.17],[0.62,0.50,0.36],[0.78,0.66,0.46],[0.92,0.84,0.66]], shin: 6, spec: 0x1a140c, opacity: 1, bg: 0x0c0805, rim: 0xc9a77a, node: [0.35,0.18,0.07], wire: 0x6b4a2a, floor: 0x3a2a18, styles: ['smooth', 'contour', 'nodal'] },
    { name: 'Mylar', ramp: [[0.08,0.16,0.42],[0.25,0.36,0.62],[0.38,0.42,0.50],[0.78,0.62,0.32],[0.95,0.82,0.55]], shin: 30, spec: 0x3c4048, opacity: 1, bg: 0x05070c, rim: 0xdfe6f2, node: [1.00,0.45,0.25], wire: 0x9fb4d6, floor: 0x26304a, styles: ['smooth', 'nodal', 'wire'] },
    { name: 'Brushed steel', ramp: [[0.12,0.13,0.16],[0.28,0.30,0.34],[0.44,0.46,0.50],[0.62,0.64,0.68],[0.82,0.84,0.88]], shin: 30, spec: 0x3a3a3a, opacity: 1, bg: 0x060708, rim: 0xb8c0cc, node: [0.95,0.70,0.25], wire: 0x8a929e, floor: 0x2a2e36, styles: ['smooth', 'contour', 'wire'] },
    { name: 'Glass', ramp: [[0.04,0.25,0.40],[0.12,0.45,0.60],[0.30,0.60,0.68],[0.50,0.75,0.70],[0.80,0.92,0.85]], shin: 36, spec: 0x404448, opacity: 0.62, bg: 0x03080b, rim: 0xbff4ff, node: [1.00,1.00,1.00], wire: 0x7fe0f0, floor: 0x10303a, styles: ['smooth', 'wire', 'nodal'] },
    { name: 'Graphite', ramp: [[0.05,0.05,0.07],[0.14,0.15,0.18],[0.24,0.25,0.29],[0.30,0.45,0.70],[0.55,0.80,1.00]], shin: 20, spec: 0x2a2e36, opacity: 1, bg: 0x030305, rim: 0x6a7488, node: [0.40,0.85,1.00], wire: 0x5f7aa8, floor: 0x1a1d26, styles: ['contour', 'wire', 'nodal'] },
    { name: 'Iridescent', ramp: [[0.55,0.25,0.95],[0.20,0.55,1.00],[0.20,0.90,0.75],[0.95,0.85,0.25],[1.00,0.35,0.55]], shin: 28, spec: 0x383838, opacity: 1, bg: 0x06040a, rim: 0xe8dcff, node: [1.00,1.00,1.00], wire: 0xc0a8ff, floor: 0x2a1c3a, styles: ['smooth', 'contour'] },
    { name: 'Copper', ramp: [[0.10,0.02,0.02],[0.45,0.10,0.04],[0.72,0.33,0.12],[0.98,0.62,0.25],[1.00,0.92,0.65]], shin: 28, spec: 0x402818, opacity: 1, bg: 0x0a0503, rim: 0xffc890, node: [0.30,0.95,0.85], wire: 0xb0602a, floor: 0x3a1c10, styles: ['smooth', 'nodal', 'contour'] },
    { name: 'Violet and amber', ramp: HEIGHTR, shin: 40, spec: 0x3a3a3a, opacity: 1, bg: 0x040308, rim: 0xd6cfe0, node: [0.99,0.99,0.75], wire: 0x8a70c0, floor: 0x3a2a48, styles: ['smooth', 'nodal', 'wire'] },
  ];
  const SAVER_RIGS = [
    { name: 'key', amb: 0.30, sun: [3, 5, 2, 0.55], fill: [-3, -2, -2, 0.12] },
    { name: 'top', amb: 0.24, sun: [0.3, 8, 0.2, 0.6], fill: [0, -3, 0, 0.08] },
    { name: 'rim', amb: 0.22, sun: [-4, 1.2, -3, 0.62], fill: [3, 2, 3, 0.18] },
    { name: 'grazing', amb: 0.16, sun: [6, 0.8, 1, 0.68], fill: [-3, 2, -1, 0.10] },
  ];
  const SAVER_STYLE = { smooth: 'smooth shaded', contour: 'contour bands', nodal: 'nodal lines', wire: 'mesh overlay' };
  let saverScene = null;
  // The colour of one vertex in the saver, from v = u / running max.
  // SAVER_EXPOSURE scales the ramp, so a lit crest stays below white.
  const SAVER_EXPOSURE = 0.86;
  function saverColor(sv, v) {
    ramp(sv.look.ramp, 0.5 + 0.5 * v, _c);
    _c[0] *= SAVER_EXPOSURE; _c[1] *= SAVER_EXPOSURE; _c[2] *= SAVER_EXPOSURE;
    if (sv.style === 'contour') {
      const b = (0.5 + 0.5 * v) * 9, f = b - Math.floor(b);
      if (f < 0.14) { _c[0] *= 0.3; _c[1] *= 0.3; _c[2] *= 0.3; }
    } else if (sv.style === 'nodal') {
      // the zero set of u: the nodal lines of the sum, which move as it beats
      const a = Math.abs(v);
      if (a < 0.07) { const t = 1 - a / 0.07, nc = sv.look.node; _c[0] += (nc[0] - _c[0]) * t; _c[1] += (nc[1] - _c[1]) * t; _c[2] += (nc[2] - _c[2]) * t; }
    }
  }
  function pickScene(rnd, prev, calm) {
    const pick = a => a[Math.floor(rnd() * a.length)];
    let look; do look = pick(SAVER_LOOKS); while (prev && look === prev.look);
    const shape = rnd() < 0.5 ? 'circle' : 'square', kr = rnd();
    let ex;
    if (kr < 0.45) { const q = pick(SAVER_PAIRS[shape]); ex = { kind: 'pair', m1: q[0], n1: q[1], m2: q[2], n2: q[3] }; }
    else if (kr < 0.85) { const q = pick(SAVER_SINGLES[shape]); ex = { kind: 'single', m1: q[0], n1: q[1] }; }
    else {
      // a strike off the centre: within r 0.22 of the centre on the drum,
      // and 0.25-0.75 on the square, so the bump is inside the edge
      const a = rnd() * TAU, r = 0.08 + 0.14 * rnd();
      ex = shape === 'circle' ? { kind: 'strike', x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) } : { kind: 'strike', x: 0.25 + 0.5 * rnd(), y: 0.25 + 0.5 * rnd() };
      ex.w = 0.08 + 0.04 * rnd();
    }
    return {
      look, shape, ex, style: pick(look.styles), rig: pick(SAVER_RIGS),
      heightK: 0.5 + 0.3 * rnd(), phi: 0.62 + 0.58 * rnd(), theta: rnd() * TAU,
      spin: (rnd() < 0.5 ? -1 : 1) * (0.025 + 0.025 * rnd()) * (1 - 0.5 * calm), floor: rnd() < 0.6,
    };
  }
  // A Gaussian bump at rest: uPrev = u + dt^2/2 acc, as setMode does.
  function applyStrike(ex) {
    const N = GRID, h = 1 / (N - 1), u = sim.u, up = sim.uPrev, mask = sim.mask;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const id = j * N + i, dx = i * h - ex.x, dy = j * h - ex.y;
      u[id] = mask[id] ? G.amp * Math.exp(-(dx * dx + dy * dy) / (2 * ex.w * ex.w)) : 0;
    }
    sim._computeAcc();
    const k2 = 0.5 * sim.dt * sim.dt;
    for (let id = 0; id < N * N; id++) up[id] = mask[id] ? u[id] + k2 * sim.acc[id] : 0;
    sim.t = 0; E0 = sim.energy(); runMax = 1e-9; stepCarry = 0;
    updateMesh();
  }
  function applyScene(sc) {
    saverScene = sc;
    const L = sc.look, R = sc.rig;
    memMat.shininess = L.shin; memMat.specular.setHex(L.spec);
    memMat.transparent = L.opacity < 1; memMat.opacity = L.opacity; memMat.depthWrite = L.opacity >= 1; memMat.needsUpdate = true;
    renderer.setClearColor(L.bg, 1);
    rimMat.color.setHex(L.rim); nodalMat.color.setRGB(L.node[0], L.node[1], L.node[2]);
    wireMat.color.setHex(L.wire); wire.visible = sc.style === 'wire';
    // the grid keeps its own vertex colours on the page; the saver tints it
    floor.visible = sc.floor; floor.material.vertexColors = false; floor.material.color.setHex(L.floor); floor.material.needsUpdate = true;
    amb.intensity = R.amb;
    sun.position.set(R.sun[0], R.sun[1], R.sun[2]); sun.intensity = R.sun[3];
    fill.position.set(R.fill[0], R.fill[1], R.fill[2]); fill.intensity = R.fill[3];
    heightK = sc.heightK; floor.position.y = -HEIGHT * 1.15 * heightK;
    view.theta = sc.theta; view.phi = sc.phi; saverSpin = sc.spin;
    const ex = sc.ex;
    G.nodal = sc.style === 'nodal' && ex.kind === 'single';
    if (ex.kind === 'pair') Object.assign(G, { m1: ex.m1, n1: ex.n1, m2: ex.m2, n2: ex.n2, two: true, amp2: 0.45 });
    else if (ex.kind === 'single') Object.assign(G, { m1: ex.m1, n1: ex.n1, two: false });
    else G.two = false;
    if (sc.shape !== G.shape) { G.shape = sc.shape; makeSolver(); } else applyModes();
    if (ex.kind === 'strike') { applyStrike(ex); if (nodal) nodal.visible = false; }
    saverPlate();
  }
  let saverRnd = null, saverCalm = 0.7, saverT = 0, saverHold = 10;
  const SAVER_FADE = 0.6;
  function saverTick(dt) {
    saverT += dt;
    const k = Math.min(1, saverT / SAVER_FADE, (saverHold - saverT) / SAVER_FADE);
    fadeMat.opacity = 1 - Math.max(0, k);
    if (saverT >= saverHold) { saverT = 0; applyScene(pickScene(saverRnd, saverScene, saverCalm)); }
  }
  // The plate (opts.label): the look and the excitation in the title, the
  // render style, the light and the shape in the sub. The TeX is the wave
  // equation and the mode shape that setMode() in sim.js builds; a strike
  // adds its start shape. params: the modes and amplitudes (or the strike
  // point and width), c, the beat |f1 − f2| or f1 (f = ω/2π from
  // sim.omega()), and the energy ratio. The solver is a lossless leapfrog,
  // so E/E0 shows the drift. Sim time runs at STEP_RATE·speed·c·dt per real
  // second, so a sim frequency times that rate is the frequency on screen.
  // applyModes() calls saverPlate(), so a mode change updates the plate.
  let saverLabel = null, saverTimer = 0, saverOn = false;
  function saverPlate() {
    if (!saverLabel || !sim) return;
    const sc = saverScene, circ = G.shape === 'circle', TAUv = 2 * Math.PI;
    const strike = sc && sc.ex.kind === 'strike';
    const md = modeList(), f = md.map(q => sim.omega(q.m, q.n) / TAUv);
    const rate = STEP_RATE * G.speed * G.c * sim.dt;      // sim time per real second
    const hz = v => (v * rate).toFixed(2) + ' Hz';
    const P = [];
    if (strike) {
      P.push({ sym: '\\mathbf{x}_0', name: 'strike point', value: '(' + sc.ex.x.toFixed(2) + ', ' + sc.ex.y.toFixed(2) + ')', cls: 'm4' });
      P.push({ sym: 'w', name: 'strike width', value: sc.ex.w.toFixed(3) });
      P.push({ sym: 'f_{1}', name: 'lowest mode', value: hz(sim.omega(circ ? 0 : 1, 1) / TAUv) });
    } else {
      md.forEach((q, k) => P.push({ sym: '(m, n)_' + (k + 1), name: 'mode, amplitude', value: '(' + q.m + ', ' + q.n + '), ' + q.amp.toFixed(2), cls: 'm4' }));
      if (f.length > 1) {
        const fb = Math.abs(f[0] - f[1]);
        P.push({ sym: '|f_1 - f_2|', name: 'beat', value: hz(fb) + (fb > 0 ? ', ' + (1 / (fb * rate)).toFixed(1) + ' s' : '') });
      } else P.push({ sym: 'f_1', name: 'frequency', value: hz(f[0]) });
    }
    P.push({ sym: 'c', name: 'wave speed', value: G.c.toFixed(2), cls: 'm2' });
    P.push({ sym: 'E/E_0', name: 'energy ratio', value: E0 > 0 ? (sim.energy() / E0).toFixed(4) : '1', cls: 'm5' });
    const exName = !sc ? 'two modes' : strike ? 'struck' : sc.ex.kind === 'pair'
      ? 'modes (' + sc.ex.m1 + ',' + sc.ex.n1 + ') + (' + sc.ex.m2 + ',' + sc.ex.n2 + ')' : 'mode (' + sc.ex.m1 + ',' + sc.ex.n1 + ')';
    const tex = (circ ? SAVER_TEX.circle : SAVER_TEX.square).slice();
    if (strike) tex.splice(1, 1, String.raw`u(\mathbf{x},0)=A\,e^{-|\mathbf{x}-\mathbf{x}_0|^2/2w^2}=\sum_k A_k\,\phi_k(\mathbf{x})`);
    saverLabel({
      title: (sc ? sc.look.name : (circ ? 'Drum membrane' : 'Square membrane')) + ' · ' + exName,
      sub: sc ? SAVER_STYLE[sc.style] + ' · ' + sc.rig.name + ' light · ' + (circ ? 'drum' : 'square') + ', clamped edge' : 'Clamped edge',
      params: P,
      lines: [GRID + ' × ' + GRID + ' leapfrog grid, lossless, so E/E₀ shows the drift'],
      tex, rules: SAVER_RULES,
      eq: circ
        ? ['∂²u/∂t² = c²∇²u,   u = 0 at r = R', strike ? 'u(x, 0) = A exp(−|x − x₀|²/2w²)' : 'u = Σ Aₖ Jₘ(k r) cos(mθ) cos(ωₖ t)', 'k = jₘ,ₙ / R,   ω = c k,   f = ω/2π']
        : ['∂²u/∂t² = c²∇²u,   u = 0 on the edge', strike ? 'u(x, 0) = A exp(−|x − x₀|²/2w²)' : 'u = Σ Aₖ sin(mₖπx) sin(nₖπy) cos(ωₖ t)', 'ω = cπ√(m² + n²),   f = ω/2π'],
      anchor: membraneAnchor,
    });
  }
  // The plate TeX: the mode equation of the panel (equations.js WM_EQ), the
  // sum of the two modes, and the dispersion relation. SAVER_RULES are the
  // panel WM_RULES (u m1, c m2, omega m3, A m4, E m5).
  const SAVER_TEX = {
    square: [String.raw`\frac{\partial^2 u}{\partial t^2}=c^2\nabla^2 u,\quad u=0 \text{ on the edge}`,
      String.raw`u=\sum_k A_k \sin(m_k\pi x)\,\sin(n_k\pi y)\,\cos(\omega_k t)`,
      String.raw`\omega=c\pi\sqrt{m^2+n^2},\quad f=\frac{\omega}{2\pi}`],
    circle: [String.raw`\frac{\partial^2 u}{\partial t^2}=c^2\nabla^2 u,\quad u=0 \text{ at } r=R`,
      String.raw`u=\sum_k A_k\, J_m(k r)\cos(m\theta)\cos(\omega_k t)`,
      String.raw`k=\frac{j_{m,n}}{R},\quad \omega=c\,k,\quad f=\frac{\omega}{2\pi}`],
  };
  const SAVER_RULES = [['u', 'm1'], ['c', 'm2'], ['\\omega', 'm3'], ['\\omega_k', 'm3'], ['A', 'm4'], ['A_k', 'm4'], ['E', 'm5']];
  // The membrane on screen, for the shell's label plate: the rim loop and
  // the highest and lowest vertex, projected with the live camera onto the
  // canvas rect. Centre is the middle of their screen box, r the largest
  // distance from it. pts are the peak and the trough (the antinodes that
  // move most). Page CSS px.
  const _wa = new THREE.Vector3();
  function membraneAnchor() {
    if (!rim || !POS) return null;
    const rc = canvas.getBoundingClientRect(), R = rim.geometry.attributes.position, p = POS.array;
    const to = (x, y, z) => { _wa.set(x, y, z).project(camera); return { x: rc.left + (_wa.x + 1) / 2 * rc.width, y: rc.top + (1 - _wa.y) / 2 * rc.height }; };
    let hi = 0, lo = 0;
    for (let k = 3; k < p.length; k += 3) { if (p[k + 1] > p[hi + 1]) hi = k; if (p[k + 1] < p[lo + 1]) lo = k; }
    const pk = [to(p[hi], p[hi + 1], p[hi + 2]), to(p[lo], p[lo + 1], p[lo + 2])], q = pk.slice();
    for (let i = 0; i < R.count; i++) q.push(to(R.getX(i), R.getY(i), R.getZ(i)));
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const v of q) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let r = 0; for (const v of q) r = Math.max(r, Math.hypot(v.x - cx, v.y - cy));
    return { x: cx, y: cy, r, pts: pk };
  }
  window.snSaver = {
    exit() {
      band = null;
      saverLabel = null; saverOn = false; saverScene = null; clearInterval(saverTimer); saverTimer = 0;
      fadePlane.visible = false; wire.visible = false; heightK = 1;
    },
    enter(o) {
      import('../../lib/saver-clear.js').then(m => { plateBandFn = m.plateBand; }).catch(() => { /* no band: the frame centre */ });
      const calm = o && o.calm != null ? o.calm : 0.7;
      let seed = ((o && o.seed) >>> 0) || 1;
      saverRnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      saverCalm = calm;
      saverHold = Math.max(8, Math.min(12, ((o && o.seconds) || 60) / 5)); saverT = 0;
      document.documentElement.classList.add('sn-saver'); saverOn = true;
      resize();
      Object.assign(G, { amp: 0.7, paused: false, color: 'height' });
      G.speed = 0.22 + 0.2 * (1 - calm);
      view.zoom = 0.85;
      saverLabel = o && o.labels !== false && typeof o.label === 'function' ? o.label : null;
      fadePlane.visible = true;
      applyScene(pickScene(saverRnd, null, calm));
      drawLegend();
      clearInterval(saverTimer);
      if (saverLabel) saverTimer = setInterval(saverPlate, 1000);
      return { canvas, warmupMs: 500 };
    },
  };

  // ------------------------------------------------------------------- boot
  resize();
  buildUI();
  makeSolver();
  drawLegend();
  refreshLegendScale();
  requestAnimationFrame(frame);
})();
