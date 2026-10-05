// ============================================================================
//  CIRCULAR POLARIZATION  ·  outgoing polarized EM radiation
// ----------------------------------------------------------------------------
//  A small source radiates outward. Each ray carries the transverse field of
//  an outgoing wave. On a ray with direction û_r and a transverse frame
//  (ê1, ê2), with ê1 × ê2 = û_r:
//
//      φ  = k·r − ω·t                               (outgoing phase)
//      E  = (E0/r) [ cos φ · ê1 + cos(φ − δ) · ê2 ]
//      B  = (1/c) û_r × E  =  (E0/r) [ −cos(φ − δ) · ê1 + cos φ · ê2 ] / c
//
//  δ = ±90° gives circular polarization, δ = 0 or 180° linear, others
//  elliptical. The amplitude floor max(r, 1.6) stops a spike at the source.
//
//  HANDEDNESS  (at a fixed point, as time runs, φ goes down)
//      The rate of turn of E in the (ê1, ê2) plane has the sign of −sin δ
//      per unit time, so sin δ > 0 turns clockwise as seen by the receiver
//      (ê1 right, ê2 up, û_r toward the viewer). The optics convention calls
//      that right-circular; the IEEE convention calls it left-hand (LHCP).
//      The Jones vector of E is (1, e^(−iδ)) / √2.
//
//  WHAT THE SCENE SHOWS
//      every mode .. E helix (amber), B helix (cyan), field vectors (ribs
//                    from the ray to the field tip); the field fades in near
//                    the source and out at the far end
//      one ray ..... the two components as flat waves on faint planes
//                    through the ray (ê1 coral, ê2 blue), the ray axis, and
//                    an observer plane at R_OBS where the E tip draws its
//                    ellipse, with the live E and B arrows
//      ring/sphere . N rays on the equator or over a Fibonacci sphere
//  The #ellipse canvas draws the same observer plane flat, as the receiver
//  sees it. The readouts (Jones vector, state, turn, χ) come from δ.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//      error overlay ........ "function showErr"
//      colours .............. "const COL"
//      polarization maths ... polar.js (polState, jonesText)
//      scene setup .......... "Scene setup"
//      source ............... "Source"
//      Ray class ............ "class Ray"
//      one-ray extras ....... "class Single"
//      direction sets ....... "function fibonacciSphere"
//      rebuild .............. "function rebuild"
//      camera framing ....... "function frameFor"
//      ellipse inset ........ "function drawEllipse"
//      readouts ............. "function updateReadouts"
//      controls ............. "Controls"
//      animation loop ....... "function animate"
//      screensaver hook ..... "window.snSaver" (stub), "saverEnter((" (hook)
//      saver plate .......... "function saverPlate", "function rayAnchor"
//      headset (VR / AR) .... "XR: the wave in a headset"
// ============================================================================
import { EQ, SYM } from './equations.js';
import { polState, jonesText } from './polar.js';

// Any thrown error or rejected promise shows on the page, so a broken CDN
// import is visible instead of a blank canvas.
const errEl = document.getElementById('err');
function showErr(msg) { errEl.style.display = 'block'; errEl.textContent = 'ERROR: ' + msg; console.error(msg); }
window.addEventListener('error', e => showErr((e.message || 'unknown') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || '?')));
window.addEventListener('unhandledrejection', e => showErr('Promise: ' + (e.reason?.message || e.reason)));

const $ = id => document.getElementById(id);

// The screensaver stub is set before the three.js import, which can take
// more than the shell's 2.5 s hook wait. enter() waits for the real hook
// (saverEnter, set after the scene) and fails after 10 s, so the
// shell then uses its generic mode.
let saverEnter;
const saverReady = new Promise(r => { saverEnter = r; });
window.snSaver = { enter: o => Promise.race([saverReady.then(f => f(o)),
  new Promise((_, no) => setTimeout(() => no(new Error('scene not ready')), 10000))]) };

// Range fill: the CSS gradient reads --pct.
function paintSlider(el) { el.style.setProperty('--pct', ((+el.value - +el.min) / (+el.max - +el.min) * 100) + '%'); }
document.querySelectorAll('input[type=range]').forEach(s => { paintSlider(s); s.addEventListener('input', () => paintSlider(s)); });

// The formulas: static MathJax SVG from equations.js (typeset.mjs).
$('eqE').innerHTML = EQ.E;
$('eqB').innerHTML = EQ.B;
$('eqJ').innerHTML = EQ.J;
// Label symbols: each [data-sym] element gets its MathJax SVG from SYM.
document.querySelectorAll('[data-sym]').forEach(el => { const s = SYM[el.dataset.sym]; if (s) el.innerHTML = s; });

// Scene colours. They are the lib/sci.css math colors of the same symbols
// (E --m2, B --m1, ê1 --m4, ê2 --m6). style.css uses the same values, and
// typeset.mjs puts the same .mN classes on the formula symbols.
const COL = { E: 0xff9a62, B: 0x62c4ff, e1: 0xe889dc, e2: 0xa8a4ff, axis: 0x8a96ad, source: 0xffe9a8 };
const CSS = { E: '#ff9a62', B: '#62c4ff', e1: '#e889dc', e2: '#a8a4ff', dim: '#3a4a64' };

try {

const THREE = await import('three');
const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

// ─── Scene setup ───────────────────────────────────────────────────────────
// The renderer fills #stage, not the window: the panel sits beside it.
const stage = $('stage');
const canvas = $('scene');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 4;
controls.maxDistance = 110;

// Idle auto-rotate: after a few seconds with no drag, a slow spin starts.
let idleTimer = 0;
controls.addEventListener('start', () => { idleTimer = -1; controls.autoRotate = false; tween = null; });
controls.addEventListener('end', () => { idleTimer = 0; });

// A faint polar grid under the scene gives depth without competing.
const grid = new THREE.PolarGridHelper(24, 12, 6, 96, 0x3a4a64, 0x222c3c);
grid.position.y = -7.5;
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.material.depthWrite = false;
scene.add(grid);

// ─── Source ────────────────────────────────────────────────────────────────
// A small rod with a bright core: the radiating source. The three beads
// breathe with ω. The colours stay neutral, so they do not read as field.
const sourceGroup = new THREE.Group();
scene.add(sourceGroup);
sourceGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.4, 8),
  new THREE.MeshBasicMaterial({ color: 0x4a5368, transparent: true, opacity: 0.7 })));
const beads = [1.6, 0, -1.6].map(y => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(y === 0 ? 0.3 : 0.2, 24, 24),
    new THREE.MeshBasicMaterial({ color: y === 0 ? COL.source : 0xb9b09a }));
  m.position.y = y; sourceGroup.add(m); return m;
});

// ─── Ray geometry ──────────────────────────────────────────────────────────
const HELIX_POINTS = 260;
const RIBS = 56;
const R_MIN = 0.55, R_MAX = 22.0;
const R_OBS = 15.0;          // the observer plane on the single ray
// Ring and sphere show E itself, with the 1/r fall. One ray shows r·E (the
// far-field pattern), so the helix and the observer ellipse keep their size.
let rScaled = true;
const R_E_SIZE = 1.9;
const ampAt = (amp, r) => rScaled ? R_E_SIZE : amp / Math.max(r, 1.6);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// brightness along the ray: fade in near the source, fade out at the end
const fade = (r, fadeIn) => smooth(R_MIN, R_MIN + fadeIn, r) * (1 - smooth(R_MAX - 6, R_MAX, r));

// A transverse frame for a ray: ê1 = ref × û_r, ê2 = û_r × ê1, so ê1 × ê2 = û_r.
function frame(dir) {
  const ref = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(ref, dir).normalize();
  const e2 = new THREE.Vector3().crossVectors(dir, e1).normalize();
  return { e1, e2 };
}

// A line whose vertices move each frame and whose colour is fixed per vertex
// (base colour times the fade). Additive blending, so crossings read as light.
function dynLine(n, color, weights, opacity, segments = false) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { const w = weights(i); col[i * 3] = c.r * w; col[i * 3 + 1] = c.g * w; col[i * 3 + 2] = c.b * w; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = segments ? new THREE.LineSegments(g, m) : new THREE.Line(g, m);
  line.frustumCulled = false;
  scene.add(line);
  return line;
}
function disposeObj(o) { scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); }

// ─── class Ray: the E and B helices and their field vectors on one ray ────
class Ray {
  constructor(dir, single, opacity) {
    this.dir = dir.clone().normalize();
    Object.assign(this, frame(this.dir));
    const fadeIn = single ? 0.9 : 3.6;
    const rH = i => R_MIN + (R_MAX - R_MIN) * i / (HELIX_POINTS - 1);
    const rR = i => R_MIN + (R_MAX - R_MIN) * Math.floor(i / 2) / (RIBS - 1);
    this.eLine = dynLine(HELIX_POINTS, COL.E, i => fade(rH(i), fadeIn), opacity);
    this.bLine = dynLine(HELIX_POINTS, COL.B, i => fade(rH(i), fadeIn) * 0.8, opacity * 0.85);
    // rib i: vertex 2i on the ray (dim), vertex 2i+1 at the field tip
    this.eRibs = dynLine(RIBS * 2, COL.E, i => fade(rR(i), fadeIn) * (i % 2 ? 0.75 : 0.25), opacity * 0.7, true);
    this.bRibs = dynLine(RIBS * 2, COL.B, i => fade(rR(i), fadeIn) * (i % 2 ? 0.45 : 0.12), opacity * 0.4, true);
  }
  // Rewrite the vertices for time t. E = c1 ê1 + c2 ê2; B = −c2 ê1 + c1 ê2.
  update(t, p) {
    const { dir: d, e1: a, e2: b } = this;
    const dl = p.delta * Math.PI / 180;
    const ep = this.eLine.geometry.attributes.position.array, bp = this.bLine.geometry.attributes.position.array;
    for (let i = 0; i < HELIX_POINTS; i++) {
      const r = R_MIN + (R_MAX - R_MIN) * i / (HELIX_POINTS - 1);
      const ph = p.k * r - p.omega * t, A = ampAt(p.amp, r);
      const c1 = A * Math.cos(ph), c2 = A * Math.cos(ph - dl);
      const j = i * 3;
      ep[j] = r * d.x + c1 * a.x + c2 * b.x; ep[j + 1] = r * d.y + c1 * a.y + c2 * b.y; ep[j + 2] = r * d.z + c1 * a.z + c2 * b.z;
      bp[j] = r * d.x - c2 * a.x + c1 * b.x; bp[j + 1] = r * d.y - c2 * a.y + c1 * b.y; bp[j + 2] = r * d.z - c2 * a.z + c1 * b.z;
    }
    this.eLine.geometry.attributes.position.needsUpdate = true;
    this.bLine.geometry.attributes.position.needsUpdate = true;
    if (!p.showLobes) return;
    const er = this.eRibs.geometry.attributes.position.array, br = this.bRibs.geometry.attributes.position.array;
    for (let i = 0; i < RIBS; i++) {
      const r = R_MIN + (R_MAX - R_MIN) * i / (RIBS - 1);
      const ph = p.k * r - p.omega * t, A = ampAt(p.amp, r);
      const c1 = A * Math.cos(ph), c2 = A * Math.cos(ph - dl);
      const x = r * d.x, y = r * d.y, z = r * d.z, j = i * 6;
      er[j] = br[j] = x; er[j + 1] = br[j + 1] = y; er[j + 2] = br[j + 2] = z;
      er[j + 3] = x + c1 * a.x + c2 * b.x; er[j + 4] = y + c1 * a.y + c2 * b.y; er[j + 5] = z + c1 * a.z + c2 * b.z;
      br[j + 3] = x - c2 * a.x + c1 * b.x; br[j + 4] = y - c2 * a.y + c1 * b.y; br[j + 5] = z - c2 * a.z + c1 * b.z;
    }
    this.eRibs.geometry.attributes.position.needsUpdate = true;
    this.bRibs.geometry.attributes.position.needsUpdate = true;
  }
  setVisible(p) {
    this.bLine.visible = p.showB;
    this.eRibs.visible = p.showLobes;
    this.bRibs.visible = p.showLobes && p.showB;
  }
  dispose() { [this.eLine, this.bLine, this.eRibs, this.bRibs].forEach(disposeObj); }
}

// ─── class Single: the extras of the one-ray view ─────────────────────────
// The two components as flat waves on faint planes through the ray, the ray
// axis, and the observer plane at R_OBS with the E tip ellipse and arrows.
class Single {
  constructor(ray, p) {
    this.ray = ray;
    const { dir: d, e1, e2 } = ray;
    const Amax = ampAt(p.amp, 1.6) * 1.05;
    this.objs = [];
    const keep = o => { this.objs.push(o); scene.add(o); return o; };
    // component planes: r in [R_MIN, R_MAX], offset in [−Amax, Amax] along ê
    const plane = (e, color) => {
      const g = new THREE.BufferGeometry();
      const P = (r, s) => [r * d.x + s * e.x, r * d.y + s * e.y, r * d.z + s * e.z];
      g.setAttribute('position', new THREE.Float32BufferAttribute([...P(R_MIN, -Amax), ...P(R_MAX, -Amax), ...P(R_MAX, Amax), ...P(R_MIN, Amax)], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      return keep(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.028, side: THREE.DoubleSide, depthWrite: false })));
    };
    this.planes = [plane(e1, COL.e1), plane(e2, COL.e2)];
    const rH = i => R_MIN + (R_MAX - R_MIN) * i / (HELIX_POINTS - 1);
    this.comp1 = dynLine(HELIX_POINTS, COL.e1, i => fade(rH(i), 0.9), 0.95); this.objs.push(this.comp1);
    this.comp2 = dynLine(HELIX_POINTS, COL.e2, i => fade(rH(i), 0.9), 0.95); this.objs.push(this.comp2);
    // the ray axis
    const ag = new THREE.BufferGeometry().setFromPoints([d.clone().multiplyScalar(R_MIN), d.clone().multiplyScalar(R_MAX + 1.5)]);
    this.axis = keep(new THREE.Line(ag, new THREE.LineDashedMaterial({ color: COL.axis, dashSize: 0.35, gapSize: 0.3, transparent: true, opacity: 0.45 })));
    this.axis.computeLineDistances();
    // observer plane: a faint disc and a ring at R_OBS, normal along û_r
    const o = d.clone().multiplyScalar(R_OBS);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    const Aobs = ampAt(p.amp, R_OBS);
    this.disc = keep(new THREE.Mesh(new THREE.CircleGeometry(Aobs * 1.45, 64),
      new THREE.MeshBasicMaterial({ color: 0x96c8ff, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false })));
    this.disc.position.copy(o); this.disc.quaternion.copy(q);
    this.rim = keep(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos(i / 96 * Math.PI * 2), Math.sin(i / 96 * Math.PI * 2), 0).multiplyScalar(Aobs * 1.45))),
      new THREE.LineBasicMaterial({ color: 0x96c8ff, transparent: true, opacity: 0.18 })));
    this.rim.position.copy(o); this.rim.quaternion.copy(q);
    // the ellipse that the E tip draws at R_OBS
    this.trace = keep(new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(128 * 3), 3)),
      new THREE.LineBasicMaterial({ color: COL.E, transparent: true, opacity: 0.55 })));
    this.trace.frustumCulled = false;
    this.eArrow = new THREE.ArrowHelper(e1, o, 1, COL.E, 0.5, 0.32); this.eArrow.frustumCulled = false; keep(this.eArrow);
    this.bArrow = new THREE.ArrowHelper(e2, o, 1, COL.B, 0.42, 0.26); keep(this.bArrow);
    this.origin = o; this.lastDelta = null;
  }
  update(t, p) {
    const { dir: d, e1: a, e2: b } = this.ray;
    const dl = p.delta * Math.PI / 180;
    const c1p = this.comp1.geometry.attributes.position.array, c2p = this.comp2.geometry.attributes.position.array;
    for (let i = 0; i < HELIX_POINTS; i++) {
      const r = R_MIN + (R_MAX - R_MIN) * i / (HELIX_POINTS - 1);
      const ph = p.k * r - p.omega * t, A = ampAt(p.amp, r);
      const c1 = A * Math.cos(ph), c2 = A * Math.cos(ph - dl), j = i * 3;
      c1p[j] = r * d.x + c1 * a.x; c1p[j + 1] = r * d.y + c1 * a.y; c1p[j + 2] = r * d.z + c1 * a.z;
      c2p[j] = r * d.x + c2 * b.x; c2p[j + 1] = r * d.y + c2 * b.y; c2p[j + 2] = r * d.z + c2 * b.z;
    }
    this.comp1.geometry.attributes.position.needsUpdate = true;
    this.comp2.geometry.attributes.position.needsUpdate = true;
    const A = ampAt(p.amp, R_OBS), o = this.origin;
    if (this.lastDelta !== p.delta) {
      const tp = this.trace.geometry.attributes.position.array;
      for (let i = 0; i < 128; i++) {
        const s = i / 128 * Math.PI * 2, c1 = A * Math.cos(s), c2 = A * Math.cos(s - dl);
        tp[i * 3] = o.x + c1 * a.x + c2 * b.x; tp[i * 3 + 1] = o.y + c1 * a.y + c2 * b.y; tp[i * 3 + 2] = o.z + c1 * a.z + c2 * b.z;
      }
      this.trace.geometry.attributes.position.needsUpdate = true;
      this.lastDelta = p.delta;
    }
    const ph = p.k * R_OBS - p.omega * t;
    const c1 = A * Math.cos(ph), c2 = A * Math.cos(ph - dl);
    const E = a.clone().multiplyScalar(c1).addScaledVector(b, c2);
    const B = a.clone().multiplyScalar(-c2).addScaledVector(b, c1);
    const arrow = (h, v) => { const L = v.length(); h.visible = L > 0.05; if (h.visible) { h.setDirection(v.divideScalar(L)); h.setLength(L, Math.min(0.5, L * 0.4), Math.min(0.32, L * 0.25)); } };
    arrow(this.eArrow, E);
    arrow(this.bArrow, B);
    if (!p.showB) this.bArrow.visible = false;
  }
  setVisible(p) {
    [this.comp1, this.comp2, ...this.planes].forEach(o => { o.visible = p.showComp; });
  }
  dispose() {
    this.objs.forEach(o => {
      scene.remove(o);
      if (o.isArrowHelper) { o.line.geometry.dispose(); o.line.material.dispose(); o.cone.geometry.dispose(); o.cone.material.dispose(); }
      else { o.geometry?.dispose(); o.material?.dispose(); }
    });
  }
}

// Ray directions spread over a sphere with the Fibonacci lattice.
function fibonacciSphere(N) {
  const out = [], g = Math.PI * (Math.sqrt(5) - 1);
  for (let i = 0; i < N; i++) {
    const y = N === 1 ? 0 : 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y));
    out.push(new THREE.Vector3(Math.cos(g * i) * r, y, Math.sin(g * i) * r));
  }
  return out;
}
// Ray directions spaced evenly around the horizontal equator.
function equatorialRing(N) {
  return Array.from({ length: N }, (_, i) => { const a = i / N * Math.PI * 2; return new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); });
}

// ─── state ─────────────────────────────────────────────────────────────────
// delta in degrees; amp is E0 in scene units.
const params = { n: 24, k: 1.6, omega: 1.0, delta: 90, dist: 'single', showB: true, showLobes: true, showComp: true, amp: 4.0, playing: true };
const SINGLE_DIR = new THREE.Vector3(1.0, 0.16, 0.5).normalize();
let rays = [], single = null;

// Tear down and rebuild the rays for the current mode and count. Many rays
// share the light, so each gets a lower opacity and the sum does not clip.
function rebuild() {
  rays.forEach(r => r.dispose()); rays = [];
  if (single) { single.dispose(); single = null; }
  const one = params.dist === 'single';
  rScaled = one;
  const dirs = one ? [SINGLE_DIR] : params.dist === 'ring' ? equatorialRing(params.n) : fibonacciSphere(params.n);
  const opacity = one ? 1 : Math.min(0.9, 3.2 / Math.sqrt(dirs.length));
  rays = dirs.map(d => new Ray(d, one, opacity));
  if (one) single = new Single(rays[0], params);
  applyVisibility();
  update(t);
}
function applyVisibility() {
  rays.forEach(r => r.setVisible(params));
  single?.setVisible(params);
  const one = params.dist === 'single';
  $('cellNum').hidden = one;
  $('togComp').hidden = !one;
  $('rNote').hidden = !one;
  document.querySelector('.lg-b').hidden = !params.showB;
  document.querySelectorAll('.lg-comp').forEach(li => { li.hidden = !(one && params.showComp); });
}

// ─── function frameFor: a camera pose per mode, eased in ─────────────────
let tween = null;
function frameFor(mode, instant = false) {
  const asp = Math.max(0.45, camera.aspect), far = asp < 1 ? 1 / Math.pow(asp, 0.75) : 1;
  let target, pos;
  if (mode === 'single') {
    target = SINGLE_DIR.clone().multiplyScalar(10.5);
    const side = new THREE.Vector3(-SINGLE_DIR.z, 0, SINGLE_DIR.x).normalize();
    pos = target.clone().addScaledVector(side, 31 * far).addScaledVector(SINGLE_DIR, -7 * far).add(new THREE.Vector3(0, 10 * far, 0));
  } else {
    target = new THREE.Vector3(0, 0, 0);
    pos = new THREE.Vector3(26, 15, 30).multiplyScalar(far * (mode === 'sphere' ? 1.05 : 1));
  }
  if (instant) { controls.target.copy(target); camera.position.copy(pos); controls.update(); return; }
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target };
}

// ─── function drawEllipse: the observer plane, flat, as the receiver sees it
// ê1 points right and ê2 up, so û_r points out of the screen at the viewer.
const ell = $('ellipse'), ctx = ell.getContext('2d');
function drawEllipse(t) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = ell.clientWidth || 132;
  if (ell.width !== Math.round(W * dpr)) { ell.width = ell.height = Math.round(W * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, W);
  const cx = W / 2, cy = W / 2, R = W * 0.36, dl = params.delta * Math.PI / 180;
  // axes in the component colours
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(232,137,220,0.35)'; ctx.beginPath(); ctx.moveTo(cx - R * 1.25, cy); ctx.lineTo(cx + R * 1.25, cy); ctx.stroke();
  ctx.strokeStyle = 'rgba(168,164,255,0.35)'; ctx.beginPath(); ctx.moveTo(cx, cy - R * 1.25); ctx.lineTo(cx, cy + R * 1.25); ctx.stroke();
  ctx.font = 'italic 400 12px "STIX Two Text", "Times New Roman", serif';
  ctx.fillStyle = CSS.e1; ctx.fillText('ê₁', cx + R * 1.12, cy - 5);
  ctx.fillStyle = CSS.e2; ctx.fillText('ê₂', cx + 5, cy - R * 1.12 + 4);
  // the traced ellipse
  ctx.strokeStyle = 'rgba(255,154,98,0.5)'; ctx.lineWidth = 1.4; ctx.beginPath();
  for (let i = 0; i <= 96; i++) { const s = i / 96 * Math.PI * 2; const x = cx + R * Math.cos(s), y = cy - R * Math.cos(s - dl); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  // the turn direction: a small arrowhead on the ellipse, pointing forward in time
  const st = polState(params.delta);
  if (st.turn !== 0) {
    const s0 = 0.9, s1 = s0 - 0.12;            // time forward = phase down
    const x0 = cx + R * Math.cos(s0), y0 = cy - R * Math.cos(s0 - dl);
    const x1 = cx + R * Math.cos(s1), y1 = cy - R * Math.cos(s1 - dl);
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.fillStyle = 'rgba(255,154,98,0.85)'; ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x1 - 7 * Math.cos(a - 0.45), y1 - 7 * Math.sin(a - 0.45)); ctx.lineTo(x1 - 7 * Math.cos(a + 0.45), y1 - 7 * Math.sin(a + 0.45)); ctx.fill();
  }
  // the live field at R_OBS: components on the axes, then E and B
  const ph = params.k * R_OBS - params.omega * t;
  const c1 = Math.cos(ph), c2 = Math.cos(ph - dl);
  const ex = cx + R * c1, ey = cy - R * c2;
  ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(232,137,220,0.6)'; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex, cy); ctx.stroke();
  ctx.strokeStyle = 'rgba(168,164,255,0.6)'; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(cx, ey); ctx.stroke();
  ctx.setLineDash([]);
  const vec = (x, y, col, w) => {
    const a = Math.atan2(y - cy, x - cx), L = Math.hypot(x - cx, y - cy);
    if (L < 2) return;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x - 5 * Math.cos(a), y - 5 * Math.sin(a)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 8 * Math.cos(a - 0.4), y - 8 * Math.sin(a - 0.4)); ctx.lineTo(x - 8 * Math.cos(a + 0.4), y - 8 * Math.sin(a + 0.4)); ctx.fill();
  };
  if (params.showB) vec(cx - R * c2 * 0.75, cy - R * c1 * 0.75, 'rgba(98,196,255,0.8)', 1.4);
  vec(ex, ey, CSS.E, 2);
  ctx.fillStyle = CSS.e1; ctx.beginPath(); ctx.arc(ex, cy, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = CSS.e2; ctx.beginPath(); ctx.arc(cx, ey, 2.6, 0, Math.PI * 2); ctx.fill();
}

// ─── function updateReadouts: Jones vector, state, turn, χ ───────────────
function updateReadouts() {
  const st = polState(params.delta);
  $('vD').textContent = params.delta + '°';
  $('rJones').textContent = jonesText(params.delta);
  $('rState').textContent = st.kind + (st.psi != null && st.kind !== 'circular' ? ` · ψ ${st.psi > 0 ? '+' : '−'}45°` : '');
  $('rHand').textContent = st.turn > 0 ? 'clockwise' : st.turn < 0 ? 'counter-clockwise' : 'does not turn';
  $('rChi').textContent = (st.chi < -0.05 ? '−' : '') + Math.abs(st.chi).toFixed(1) + '°';
  $('rHandNote').textContent = st.turn > 0
    ? 'As seen by the receiver, looking back at the source: right-handed in the optics convention, left-hand (LHCP) in the IEEE convention.'
    : st.turn < 0
      ? 'As seen by the receiver, looking back at the source: left-handed in the optics convention, right-hand (RHCP) in the IEEE convention.'
      : 'E stays on one line, at 45° between ê₁ and ê₂. Its length goes up and down, but it does not turn.';
  document.querySelectorAll('.snaps button').forEach(b => b.classList.toggle('on', +b.dataset.delta === params.delta));
}

// ─── Controls ──────────────────────────────────────────────────────────────
function setDelta(v) {
  params.delta = Math.round(v);
  $('delta').value = params.delta; paintSlider($('delta'));
  updateReadouts();
}
$('delta').addEventListener('input', e => setDelta(+e.target.value));
document.querySelectorAll('.snaps button').forEach(b => b.addEventListener('click', () => setDelta(+b.dataset.delta)));
$('numHelices').addEventListener('input', e => { params.n = +e.target.value; $('vNum').textContent = params.n; if (params.dist !== 'single') rebuild(); });
$('k').addEventListener('input', e => { params.k = +e.target.value; $('vK').textContent = params.k.toFixed(1); });
$('omega').addEventListener('input', e => { params.omega = +e.target.value; $('vW').textContent = params.omega.toFixed(2); });
$('showB').addEventListener('change', e => { params.showB = e.target.checked; applyVisibility(); });
$('showLobes').addEventListener('change', e => { params.showLobes = e.target.checked; applyVisibility(); update(t); });
$('showComp').addEventListener('change', e => { params.showComp = e.target.checked; applyVisibility(); });
$('play').addEventListener('click', () => {
  params.playing = !params.playing;
  $('play').textContent = params.playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed', String(params.playing));
});
document.querySelectorAll('.mode-btn').forEach(btn => btn.addEventListener('click', () => {
  const mode = btn.dataset.mode;
  if (mode === params.dist) return;
  params.dist = mode;
  document.querySelectorAll('.mode-btn').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  rebuild();
  frameFor(mode);
}));

// ─── size: the renderer follows #stage ────────────────────────────────────
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// ─── function animate ──────────────────────────────────────────────────────
const clock = new THREE.Clock();
let t = 0;
function update(time) {
  for (const r of rays) r.update(time, params);
  single?.update(time, params);
}
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (params.playing) t += dt;
  if (saver) saverTick();
  if (idleTimer >= 0) {
    idleTimer += dt;
    if (idleTimer > 5 && !controls.autoRotate && !tween) { controls.autoRotate = true; controls.autoRotateSpeed = 0.3; }
  }
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.9);
    const e = 1 - Math.pow(1 - tween.t, 3);
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (tween.t >= 1) tween = null;
  }
  update(t);
  const pulse = 1 + 0.06 * Math.sin(params.omega * t * 2);
  beads.forEach((s, i) => s.scale.setScalar(pulse + 0.04 * Math.sin(params.omega * t * 2 + i * 1.8)));
  drawEllipse(t);
  controls.update();
  renderer.render(scene, camera);
}

// ─── Screensaver hook (lib/screensaver.js has the protocol) ───────────────
// The CSS under html.sn-saver hides the panel, the legend and the hint, so
// #stage and the renderer fill the frame. The seed picks one ray or the
// ring (sphere is too busy). The clear colour is opaque, so a recording has
// no alpha. calm 1 gives the slowest wave.
//
// SHOTS. The saver owns the camera (no autoRotate). Each shot holds 5 s
// (5 to 6.5 s with calm) and the camera eases to the next one in 1.5 s.
// A shot is a pose function of its own time u, so a dolly or an orbit
// moves during the hold. The order is a seeded shuffle of SAVER_SHOTS,
// one shot never twice in a row. The far factor of frameFor keeps the ray
// in a tall frame.
//   down the beam ... on the axis past R_MAX, looking back: the helix
//                     projects to the ellipse the receiver sees
//   side-on ......... square to the ray: the E and B helices
//   three-quarter ... an orbit about the middle of the ray
//   dolly ........... beside the ray, from the source out, looking ahead
//                     (the ring: a push in toward the source)
//   grazing ......... low beside the source, along the ray
// The ring has its own five poses with the same names.
//
// STATES. Every second shot the next state of SAVER_STATES (seeded order)
// starts: δ eases to its target in 2 s (the short way round), or for the
// sweep runs through 360° in the state time. k eases to a seeded value in
// [1.1, 2.2], so the pitch of the helix changes too. The page models equal
// component amplitudes, so the states vary δ and k only.
const SAVER_STATES = [
  { name: 'Right circular', d: 90 }, { name: 'Left circular', d: -90 },
  { name: 'Elliptical', d: 45 }, { name: 'Elliptical', d: -135 },
  { name: 'Linear at +45°', d: 0 }, { name: 'Linear at −45°', d: 180 },
  { name: 'Phase sweep', sweep: true },
];
const SAVER_SHOTS = ['Down the beam', 'Side-on', 'Three-quarter', 'Dolly along the beam', 'Grazing'];
let saver = null;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// The pose of shot i at time u (s), for the saver mode: { pos, target }.
function saverPose(i, u) {
  const asp = Math.max(0.45, camera.aspect), far = asp < 1 ? 1 / Math.pow(asp, 0.75) : 1;
  if (params.dist === 'single') {
    const d = SINGLE_DIR, side = V3(-d.z, 0, d.x).normalize(), up = V3().crossVectors(side, d).normalize();
    const at = r => d.clone().multiplyScalar(r), mid = at(10.5);
    if (i === 0) return { pos: at(R_MAX + 5 * far).addScaledVector(side, 0.8).addScaledVector(up, 0.6), target: at(R_OBS) };
    if (i === 1) return { pos: mid.clone().addScaledVector(side, 30 * far).addScaledVector(up, 2), target: mid };
    if (i === 2) {
      const a = 0.9 + 0.12 * u, el = 0.38;
      return { pos: mid.clone().addScaledVector(side, Math.cos(a) * Math.cos(el) * 30 * far).addScaledVector(d, Math.sin(a) * Math.cos(el) * 30 * far).addScaledVector(up, Math.sin(el) * 30 * far), target: mid };
    }
    if (i === 3) { const r = 2 + 1.6 * u; return { pos: at(r).addScaledVector(side, 13 * far).addScaledVector(up, 4), target: at(r + 7) }; }
    return { pos: at(3).addScaledVector(side, 12 * far).addScaledVector(up, -1.2), target: at(14).addScaledVector(up, 0.5) };
  }
  // ring: the rays lie in the y = 0 plane
  const R = 40 * far;
  if (i === 0) return { pos: V3(0.01, R * 0.85, R * 0.22), target: V3() };
  if (i === 1) { const a = 0.4 + 0.05 * u; return { pos: V3(Math.cos(a) * R * 1.2, 1.5, Math.sin(a) * R * 1.2), target: V3() }; }
  if (i === 2) { const a = 0.7 + 0.12 * u; return { pos: V3(Math.cos(a) * R, R * 0.55, Math.sin(a) * R), target: V3() }; }
  if (i === 3) { const r = R * Math.max(0.42, 0.95 - 0.07 * u), a = 1.1; return { pos: V3(Math.cos(a) * r, r * 0.3, Math.sin(a) * r), target: V3() }; }
  const a = -0.5 + 0.08 * u; return { pos: V3(Math.cos(a) * R * 0.75, 3.5, Math.sin(a) * R * 0.75), target: V3(0, 1, 0) };
}
function saverTick() {
  const s = saver, now = performance.now() / 1000, dt = Math.min(0.1, now - s.last); s.last = now;
  s.u += dt; s.su += dt;
  if (s.u >= s.hold) {
    s.u = 0; s.n++;
    s.from = { pos: camera.position.clone(), target: controls.target.clone() };
    let j; do { j = Math.floor(s.r() * SAVER_SHOTS.length); } while (j === s.shot);
    s.shot = j;
    if (s.n % 2 === 0) saverState();
  }
  // camera: the live pose of the shot, eased in from the pose at the cut
  const P = saverPose(s.shot, s.u), e = s.from ? 1 - Math.pow(1 - Math.min(1, s.u / 1.5), 3) : 1;
  if (e < 1) { camera.position.lerpVectors(s.from.pos, P.pos, e); controls.target.lerpVectors(s.from.target, P.target, e); }
  else { s.from = null; camera.position.copy(P.pos); controls.target.copy(P.target); }
  // state: δ and k
  const st = SAVER_STATES[s.state], k = Math.min(1, s.su / 2), ek = k * k * (3 - 2 * k);
  let d;
  if (st.sweep) d = s.d0 + 360 * s.su / (2 * s.hold);
  else { let dd = st.d - s.d0; dd -= 360 * Math.round(dd / 360); d = s.d0 + dd * ek; }
  d = ((d + 180) % 360 + 360) % 360 - 180;
  params.k = s.k0 + (s.k1 - s.k0) * ek;
  if (Math.round(d) !== params.delta) setDelta(d);
}
// The next state: δ and k start from the live values.
function saverState() {
  const s = saver;
  s.si++; s.state = s.order[s.si % s.order.length];
  s.su = 0; s.d0 = params.delta; s.k0 = params.k; s.k1 = 1.1 + 1.1 * s.r();
}
saverEnter((o = {}) => {
  const calm = o.calm ?? 0.7, seed = (o.seed >>> 0) || 0;
  document.documentElement.classList.add('sn-saver');
  renderer.setClearColor(0x0a0c12, 1);
  resize();
  const mode = seed % 3 === 2 ? 'ring' : 'single';
  if (mode !== params.dist) document.querySelector(`.mode-btn[data-mode="${mode}"]`).click();
  tween = null;
  params.playing = true;
  params.omega = 0.45 + 0.5 * (1 - calm);
  idleTimer = -1;
  controls.autoRotate = false;
  let x = seed * 2654435761 + 1 >>> 0;
  const r = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const order = SAVER_STATES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  saver = { r, order, si: -1, state: 0, su: 0, d0: params.delta, k0: params.k, k1: params.k,
    shot: Math.floor(r() * SAVER_SHOTS.length), n: 0, u: 0, hold: 5 + 1.5 * calm, from: null, last: performance.now() / 1000 };
  saverState();
  saver.d0 = SAVER_STATES[saver.state].sweep ? 0 : SAVER_STATES[saver.state].d; setDelta(saver.d0);
  saverTick();
  controls.update();
  saverLabel = o.labels !== false && typeof o.label === 'function' ? o.label : null;
  clearInterval(saverTimer); saverPlate();
  if (saverLabel) saverTimer = setInterval(saverPlate, 1000);
  return { canvas, warmupMs: 500 };
});
window.snSaver.exit = () => { saverLabel = null; clearInterval(saverTimer); saverTimer = 0; };
// The plate (opts.label) names the mode and shows the field that update()
// draws, with the live state from polar.js: δ, the Jones vector from
// jonesText(), the kind and tilt ψ, the turn sense in both conventions and
// the ellipticity χ from polState(). k and ω are the live params.
let saverLabel = null, saverTimer = 0;
function saverPlate() {
  if (!saverLabel) return;
  const st = polState(params.delta), sg = v => (v < -0.05 ? '−' : '') + Math.abs(v).toFixed(1);
  const hand = st.turn > 0 ? 'clockwise to the receiver · optics right, IEEE LHCP'
    : st.turn < 0 ? 'counter-clockwise to the receiver · optics left, IEEE RHCP' : 'does not turn (linear)';
  // Parameters: TeX symbol, short name, live value. The classes are those
  // of typeset.mjs: E m2, B m1, e1 m4, e2 m6, delta m3, omega m5. The TeX
  // is the panel TeX of typeset.mjs, the classes written as rules.
  saverLabel({
    title: (saver ? SAVER_STATES[saver.state].name : 'Circular polarization') + ' · ' + (params.dist === 'single' ? 'one ray' : params.dist === 'ring' ? 'ring of ' + params.n + ' rays' : 'sphere of ' + params.n + ' rays'),
    sub: (saver ? SAVER_SHOTS[saver.shot] + ' · ' : '') + 'the E helix is amber, the B helix cyan',
    params: [
      { sym: '\\delta', name: 'phase, ' + st.kind, value: (params.delta < 0 ? '−' : '') + Math.abs(params.delta) + '°', cls: 'm3' },
      { sym: '\\chi', name: 'ellipticity', value: sg(st.chi) + '°' },
      { sym: 'k', name: 'wave number', value: params.k.toFixed(2) },
      { sym: '\\omega', name: 'angular frequency', value: params.omega.toFixed(2), cls: 'm5' },
    ],
    lines: ['Turn: ' + hand + '.', rScaled ? 'Drawn as r·E, the far-field pattern.' : 'E₀ = ' + params.amp.toFixed(1) + ', falling as 1/r.'],
    tex: [
      String.raw`\vec{E}=\frac{E_0}{r}\Big[\cos(kr-\omega t)\,\hat{e}_1+\cos(kr-\omega t-\delta)\,\hat{e}_2\Big]`,
      String.raw`\vec{B}=\frac{1}{c}\,\hat{u}_r\times\vec{E}`,
      String.raw`\mathbf{J}=\frac{1}{\sqrt{2}}\begin{pmatrix}1\\ e^{-i\delta}\end{pmatrix},\qquad \sin 2\chi=\sin\delta`,
    ],
    rules: [['\\vec{E}', 'm2'], ['\\vec{B}', 'm1'], ['\\hat{e}_1', 'm4'], ['\\hat{e}_2', 'm6'], ['\\delta', 'm3'], ['\\omega', 'm5']],
    eq: [
      'φ = k r − ω t',
      'E = (E₀/r) [cos φ ê₁ + cos(φ − δ) ê₂]',
      'B = (1/c) û_r × E',
      'J = (1, e^(−iδ))/√2,   sin 2χ = sin δ',
    ],
    anchor: rayAnchor,
  });
}
// The rays on screen, for the plate leader: points along each ray from
// R_MIN to R_MAX - 4 (the far end fades out), projected through the camera
// to page px. The anchor is their mean, the radius holds them plus 30 px for
// the helix width, and the key points are the source and the ray ends.
// One ray for 'single', the equatorial ring for 'ring'; the sphere fills
// the view, so it has no anchor.
function rayAnchor() {
  if (params.dist === 'sphere') return null;
  const b = canvas.getBoundingClientRect(), v = new THREE.Vector3(), all = [], keys = [];
  const P = (d, r) => { v.copy(d).multiplyScalar(r).project(camera); return v.z < 1 ? { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height } : null; };
  const dirs = params.dist === 'single' ? [SINGLE_DIR] : equatorialRing(params.n);
  const src = P(SINGLE_DIR, 0); if (src) keys.push(src);
  for (const d of dirs) for (let k = 0; k <= 6; k++) { const q = P(d, R_MIN + (R_MAX - 4 - R_MIN) * k / 6); if (q) { all.push(q); if (k === 6 && keys.length < 8) keys.push(q); } }
  if (!all.length) return null;
  let x = 0, y = 0; for (const q of all) { x += q.x; y += q.y; } x /= all.length; y /= all.length;
  let r = 0; for (const q of all) r = Math.max(r, Math.hypot(q.x - x, q.y - y));
  return { x, y, r: r + 30, pts: keys };
}

rebuild();
updateReadouts();
frameFor(params.dist, true);
animate();
// ─── XR: the wave in a headset (lib/xr-view.js) ───────────────────────────
// VR and AR place the field on a table. xrBounds() gives a box whose height
// is the longest side of the field, so tableHeight sets that longest side:
// one ray is a wave 1 m long, a ring or a sphere is 1 m across. The polar
// grid is the page floor, and the headset has its own, so the grid hides in
// XR. A mode change in the headset places the field again at its new size.
// After exit, a mode change also frames the desktop camera for the new mode.
const { attachXR } = await import('../../lib/xr-view.js');
const XR_SIDE = 1.0;
const XR_PAD = 2.6;
function xrBounds() {
  const b = new THREE.Box3(new THREE.Vector3(-XR_PAD, -XR_PAD, -XR_PAD), new THREE.Vector3(XR_PAD, XR_PAD, XR_PAD));
  if (params.dist === 'single') {
    const end = SINGLE_DIR.clone().multiplyScalar(R_MAX);
    b.expandByPoint(end.clone().addScalar(-XR_PAD)).expandByPoint(end.clone().addScalar(XR_PAD));
  } else {
    const r = R_MAX + XR_PAD, h = params.dist === 'sphere' ? r : XR_PAD;
    b.expandByPoint(new THREE.Vector3(-r, -h, -r)).expandByPoint(new THREE.Vector3(r, h, r));
  }
  const side = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  b.max.y = b.min.y + side;
  return b;
}
const XR_MODES = ['single', 'ring', 'sphere'];
const XR_MODE_NAME = { single: 'One ray', ring: 'Ring', sphere: 'Sphere' };
const XR_SNAPS = [90, 45, 0, -90];
const XR_SNAP_NAME = { 90: '90° R', 45: '45°', 0: '0° linear', '-90': '−90° L' };
let xrModeAtEnter = null;
const xr = attachXR({
  renderer, scene, camera, controls,
  bounds: xrBounds, tableHeight: XR_SIDE,
  vrButton: $('bVR'), arButton: $('bAR'),
  title: 'Circular polarization',
  hideInXR: [grid],
  actions: [
    { label: () => 'Rays: ' + XR_MODE_NAME[params.dist],
      run: () => {
        const next = XR_MODES[(XR_MODES.indexOf(params.dist) + 1) % XR_MODES.length];
        document.querySelector(`.mode-btn[data-mode="${next}"]`).click();
        xr.reset();
      } },
    { label: () => 'Phase δ: ' + (XR_SNAP_NAME[params.delta] || params.delta + '°'),
      run: () => setDelta(XR_SNAPS[(XR_SNAPS.indexOf(params.delta) + 1) % XR_SNAPS.length]) },
    { label: () => params.showB ? 'B field: on' : 'B field: off', on: () => params.showB, run: () => $('showB').click() },
    { label: () => params.playing ? 'Pause' : 'Play', run: () => $('play').click() },
  ],
  onEnter() { xrModeAtEnter = params.dist; },
  onExit() { if (params.dist !== xrModeAtEnter) { tween = null; frameFor(params.dist, true); } },
  onSupport(s) { $('xrSec').hidden = !(s.vr || s.ar); },
});

window.__polar = { params, polState, jonesText, setDelta, rays: () => rays.length, single: () => !!single, xr, scene, camera, renderer, controls };

} catch (err) {
  showErr(err.message || String(err));
}
