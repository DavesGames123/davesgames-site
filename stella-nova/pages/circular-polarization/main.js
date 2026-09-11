// ============================================================================
//  CIRCULAR POLARIZATION  ·  outgoing circularly polarized EM radiation
// ----------------------------------------------------------------------------
//  A vertical dipole-like source radiates outward. Each ray direction carries a
//  helix: the E field (amber) and the B field (cyan) spiral around the ray as it
//  leaves the source. Every helix point is  r·dir + c1·e1 + c2·e2, where (e1,e2)
//  is a frame perpendicular to the ray and (c1,c2) rotate with the wave phase
//  φ = k·r − ω·t. E uses (cos, sin); B uses (−sin, cos), a 90° lead — so B stays
//  perpendicular to E, matching B = (1/c)·(û_r × E). Amplitude falls as 1/r.
//
//  POLARIZATION GEOMETRY   (one ray; the transverse plane rotates along r)
//  ----------------------------------------------------------------------------
//         e2 ▲                              E = cos φ · e1 + sin φ · e2
//            │   ● E tip                    B = −sin φ · e1 + cos φ · e2  (⟂ E)
//            │  ╱                           φ = k·r − ω·t   (outgoing wave)
//     source ●───────▶ dir (propagation)   amplitude ∝ 1/max(r, 1.6)
//            │  ╲
//            │   ● B tip
//         e1 ┘        the (e1,e2) frame is perpendicular to dir at every r
//
//  DATA FLOW
//  ----------------------------------------------------------------------------
//      mode button ─▶ rebuild() ─▶ Helix[] (E + B per direction)
//      slider input ─▶ params ────▶ (k, ω, amp) read each frame
//      animate(): t += dt ─▶ every Helix.update(t, k, ω) rewrites its vertices
//
//  DIRECTION SETS (chosen by the mode buttons)
//      single ... one slanted ray            "if (dist === 'single')"
//      ring ..... N rays on the equator      "equatorialRing"
//      sphere ... N rays over a full sphere   "fibonacciSphere"
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      error overlay ........ "function showErr"     on-screen error catcher
//      slider fill .......... "function paintSlider" range track progress
//      three import ......... "await import('three')" dynamic module load
//      equations ............ "Render equations"     KaTeX field equations
//      scene setup .......... "Scene setup"          camera, renderer, controls
//      source ............... "Source: vertical"     axis + colored spheres
//      Helix class .......... "class Helix"          one E or B spiral
//      direction sets ....... "function fibonacciSphere" ray distributions
//      rebuild .............. "function rebuild"     recreate all helices
//      parameters ........... "const params ="       live control state
//      control bindings ..... "numHelices').addEvent" wire inputs to params
//      animation loop ....... "function animate"     per-frame update
// ============================================================================

// Fixed on-page error overlay: any thrown error or rejected promise is shown in
// the corner instead of failing silently, so a broken CDN import is visible.
const errEl = document.getElementById('err');
function showErr(msg){errEl.style.display='block';errEl.textContent='ERROR: '+msg;console.error(msg)}
// Catch both synchronous errors and unhandled promise rejections.
window.addEventListener('error', e => showErr((e.message||'unknown')+' @ '+(e.filename||'?')+':'+(e.lineno||'?')));
window.addEventListener('unhandledrejection', e => showErr('Promise: '+(e.reason?.message||e.reason)));

// Paint a range input's filled portion: set the --pct custom property the CSS
// gradient reads, so the track shows progress up to the thumb.
// Update slider gradient fill
function paintSlider(el){const min=+el.min,max=+el.max,val=+el.value;el.style.setProperty('--pct',((val-min)/(max-min)*100)+'%')}
document.querySelectorAll('input[type=range]').forEach(s=>{paintSlider(s);s.addEventListener('input',()=>paintSlider(s))});

// Everything below runs inside one try/catch so a load failure surfaces in the
// overlay rather than leaving a blank canvas.
try {

// three is loaded with dynamic import() (not a static top-level import) so the
// try/catch above can report a CDN failure. The import map resolves the bare
// specifier "three" to the pinned CDN build.
const THREE = await import('three');
const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

// ─── Render equations ──────────────────────────────────────────────────────
// Color coding by role:
//   E vector         → amber (matches helix)
//   B vector         → cyan  (matches helix)
//   cos·û_z term     → red    (first orthogonal component — "vertical" oscillation)
//   sin·û_x term     → blue   (second orthogonal component — "horizontal" oscillation)
//   û_r              → white  (propagation direction)
//   1/r              → gold   (page accent, the amplitude falloff)
const C_E    = '#ffb84d';
const C_B    = '#60e0ee';
const C_UZ   = '#ff7878';
const C_UX   = '#8aa8ff';
const C_UR   = '#e8ecf4';
const C_FALL = '#d4a847';
// Render the two field equations with KaTeX, colouring each symbol to match its
// counterpart in the 3D scene. Skipped silently if the KaTeX CDN did not load.
if (window.katex) {
  katex.render(
    String.raw`\textcolor{${C_E}}{\vec{E}} \;\propto\; \textcolor{${C_FALL}}{\tfrac{1}{r}}\left[\textcolor{${C_UZ}}{\cos(kr-\omega t)\,\hat{u}_z} \;+\; \textcolor{${C_UX}}{\sin(kr-\omega t)\,\hat{u}_x}\right]`,
    document.getElementById('eq1'),
    { throwOnError:false, displayMode:true }
  );
  katex.render(
    String.raw`\textcolor{${C_B}}{\vec{B}} \;=\; \tfrac{1}{c}\,\bigl(\textcolor{${C_UR}}{\hat{u}_r} \times \textcolor{${C_E}}{\vec{E}}\bigr)`,
    document.getElementById('eq2'),
    { throwOnError:false, displayMode:true }
  );
}

// Standard three.js stack: scene, a perspective camera set back and above the
// origin, a WebGL renderer on the existing #scene canvas, and OrbitControls for
// drag-to-orbit and scroll-to-zoom.
// ─── Scene setup ───────────────────────────────────────────────────────────
const canvas = document.getElementById('scene');
const scene  = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, window.innerWidth/window.innerHeight, 0.1, 500);
camera.position.set(24, 14, 28);

const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0e1118, 1);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 4;
controls.maxDistance = 90;

// Idle auto-rotate: while the user is not dragging, idleTimer counts up in the
// animation loop; after a few idle seconds the camera begins a slow spin. A
// value of -1 marks "actively dragging" and suspends the count.
let idleTimer = 0;
controls.addEventListener('start', () => { idleTimer = -1; controls.autoRotate = false; });
controls.addEventListener('end',   () => { idleTimer = 0; });

// The radiating source: a thin vertical rod with three coloured spheres (a
// stylised oscillating dipole) plus a small bright core at the origin. Grouped
// so it can be treated as one object.
// ─── Source: vertical axis with three colored spheres ─────────────────────
const sourceGroup = new THREE.Group();
scene.add(sourceGroup);

// The rod: a faint dim cylinder standing on the y axis.
sourceGroup.add(new THREE.Mesh(
  new THREE.CylinderGeometry(0.035, 0.035, 5.6, 8),
  new THREE.MeshBasicMaterial({ color:0x4a4538, transparent:true, opacity:0.55 })
));

// Three charge markers along the rod; kept in sourceSpheres so the loop can
// pulse their scale in time with ω.
const sphereSpec = [
  { y: 2.0, color:0xff5566 },
  { y: 0.0, color:0xc36bff },
  { y:-2.0, color:0x5b9eff },
];
const sourceSpheres = sphereSpec.map(({y,color}) => {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 28, 28),
    new THREE.MeshBasicMaterial({ color })
  );
  m.position.y = y;
  sourceGroup.add(m);
  return m;
});

// The bright core at the origin where all rays originate.
sourceGroup.add(new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 20, 20),
  new THREE.MeshBasicMaterial({ color:0xffe9a8 })
));

// Geometry budget per helix. HELIX_POINTS is the smooth spiral resolution;
// LOBE_RIBS is the coarser set of transverse E·B vectors drawn from the axis to
// the field tip when "Field Lobes" is on. R_MIN/R_MAX bound the radial extent.
// ─── Helix & FieldLobes ────────────────────────────────────────────────────
const HELIX_POINTS = 220;
const LOBE_RIBS = 64;  // perpendicular vectors per helix
const R_MIN = 0.55;
const R_MAX = 22.0;

const E_COLOR = 0xffb84d;
const B_COLOR = 0x60e0ee;

// One spiral along a single ray. It owns two line meshes: the continuous helix
// curve and the optional field lobes. An E helix and a B helix share a direction
// but differ by the isMagnetic flag, which swaps cos/sin so B leads E by 90°.
class Helix {
  constructor(direction, color, isMagnetic = false) {
    this.dir = direction.clone().normalize();
    this.isMagnetic = isMagnetic;

    // Build an orthonormal transverse frame (e1, e2) around dir. The reference
    // vector avoids the pole: near a vertical ray, cross with x instead of y so
    // the cross product does not collapse to zero.
    const ref = Math.abs(this.dir.y) > 0.95
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    this.e1 = new THREE.Vector3().crossVectors(ref, this.dir).normalize();
    this.e2 = new THREE.Vector3().crossVectors(this.dir, this.e1).normalize();

    // The spiral itself: a dynamic position buffer rewritten every frame, drawn
    // additively so overlapping helices read as light.
    // Continuous helix curve
    const geom = new THREE.BufferGeometry();
    this.positions = new Float32Array(HELIX_POINTS * 3);
    const attr = new THREE.BufferAttribute(this.positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', attr);
    const mat = new THREE.LineBasicMaterial({
      color, transparent:true,
      opacity: isMagnetic ? 0.65 : 0.88,
      blending: THREE.AdditiveBlending, depthWrite:false,
    });
    this.line = new THREE.Line(geom, mat);
    this.line.frustumCulled = false;
    scene.add(this.line);

    // Field lobes: perpendicular line segments from propagation axis → field tip
    const lobeGeom = new THREE.BufferGeometry();
    this.lobePositions = new Float32Array(LOBE_RIBS * 2 * 3); // 2 verts per rib
    const lobeAttr = new THREE.BufferAttribute(this.lobePositions, 3);
    lobeAttr.setUsage(THREE.DynamicDrawUsage);
    lobeGeom.setAttribute('position', lobeAttr);
    const lobeMat = new THREE.LineBasicMaterial({
      color, transparent:true,
      opacity: isMagnetic ? 0.35 : 0.5,
      blending: THREE.AdditiveBlending, depthWrite:false,
    });
    this.lobes = new THREE.LineSegments(lobeGeom, lobeMat);
    this.lobes.frustumCulled = false;
    this.lobes.visible = false;
    scene.add(this.lobes);
  }

  // Rewrite the vertex positions for the current time. Each point is the axis
  // point r·dir plus a transverse offset c1·e1 + c2·e2 that rotates with the
  // wave phase φ = k·r − ω·t. amp/max(r,1.6) is the 1/r amplitude falloff, with
  // the 1.6 floor preventing a spike near the source.
  update(t, k, omega, amp, lobesOn) {
    const pos = this.positions;
    const dx=this.dir.x, dy=this.dir.y, dz=this.dir.z;
    const a1x=this.e1.x, a1y=this.e1.y, a1z=this.e1.z;
    const a2x=this.e2.x, a2y=this.e2.y, a2z=this.e2.z;
    const isB = this.isMagnetic;

    // March out along the ray, placing one spiral point per step.
    // Helix curve
    for (let i = 0; i < HELIX_POINTS; i++) {
      const r = R_MIN + (R_MAX - R_MIN) * (i / (HELIX_POINTS - 1));
      const phase = k * r - omega * t;
      const ampR = amp / Math.max(r, 1.6);

      // B uses (−sin, cos): a quarter-turn ahead of E's (cos, sin), which keeps
      // B perpendicular to E as required by B = (1/c)(û_r × E).
      let c1, c2;
      if (isB) { c1 = -Math.sin(phase) * ampR; c2 =  Math.cos(phase) * ampR; }
      else     { c1 =  Math.cos(phase) * ampR; c2 =  Math.sin(phase) * ampR; }

      pos[i*3]   = r*dx + c1*a1x + c2*a2x;
      pos[i*3+1] = r*dy + c1*a1y + c2*a2y;
      pos[i*3+2] = r*dz + c1*a1z + c2*a2z;
    }
    this.line.geometry.attributes.position.needsUpdate = true;

    // Field lobes: a rib per sample joins the propagation axis to the field tip,
    // so the transverse E (or B) vector is drawn explicitly. Skipped when off.
    // Lobes (only if visible)
    if (lobesOn) {
      const lp = this.lobePositions;
      for (let i = 0; i < LOBE_RIBS; i++) {
        const r = R_MIN + (R_MAX - R_MIN) * (i / (LOBE_RIBS - 1));
        const phase = k * r - omega * t;
        const ampR = amp / Math.max(r, 1.6);

        let c1, c2;
        if (isB) { c1 = -Math.sin(phase) * ampR; c2 =  Math.cos(phase) * ampR; }
        else     { c1 =  Math.cos(phase) * ampR; c2 =  Math.sin(phase) * ampR; }

        // Each rib is two vertices: the axis point, then the field tip. base
        // strides by 6 floats (2 verts × 3 components) per rib.
        const ax = r*dx, ay = r*dy, az = r*dz;
        const base = i * 6;
        lp[base    ] = ax;                          // axis point
        lp[base + 1] = ay;
        lp[base + 2] = az;
        lp[base + 3] = ax + c1*a1x + c2*a2x;        // field tip
        lp[base + 4] = ay + c1*a1y + c2*a2y;
        lp[base + 5] = az + c1*a1z + c2*a2z;
      }
      this.lobes.geometry.attributes.position.needsUpdate = true;
    }
  }

  // Show or hide the spiral (and its lobes, gated on the global lobe toggle).
  setVisible(v){ this.line.visible = v; this.lobes.visible = v && params.showLobes; }
  // Toggle only the lobes, but never show them while the spiral itself is hidden.
  setLobesVisible(v){ this.lobes.visible = v && this.line.visible; }

  // Free GPU buffers and remove both meshes; called before every rebuild.
  dispose(){
    this.line.geometry.dispose();
    this.line.material.dispose();
    scene.remove(this.line);
    this.lobes.geometry.dispose();
    this.lobes.material.dispose();
    scene.remove(this.lobes);
  }
}

// Ray directions spread evenly over a sphere using the Fibonacci lattice: the
// golden-angle spiral gives near-uniform coverage for any N without clustering.
function fibonacciSphere(N){
  const points = [];
  const phi = Math.PI * (Math.sqrt(5) - 1);
  for (let i = 0; i < N; i++) {
    const y = N === 1 ? 0 : 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y*y));
    const theta = phi * i;
    points.push(new THREE.Vector3(Math.cos(theta)*r, y, Math.sin(theta)*r));
  }
  return points;
}

// Ray directions spaced evenly around the horizontal (xz) equator.
function equatorialRing(N){
  const points = [];
  for (let i = 0; i < N; i++) {
    const theta = (i / N) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)));
  }
  return points;
}

// Parallel arrays: one E helix and one B helix per ray direction.
let helicesE = [];
let helicesB = [];

// Tear down all helices and recreate the set for a given count and distribution.
// Called on mode change and on the helix-count slider (except in single mode).
function rebuild(n, dist) {
  helicesE.forEach(h => h.dispose());
  helicesB.forEach(h => h.dispose());
  helicesE = []; helicesB = [];

  // Pick the direction set for the current mode.
  let dirs;
  if (dist === 'single') {
    dirs = [new THREE.Vector3(1.0, 0.18, 0.55).normalize()];
  } else if (dist === 'ring') {
    dirs = equatorialRing(n);
  } else {
    dirs = fibonacciSphere(n);
  }

  // Build the E (amber) and B (cyan) helix pair for every direction.
  dirs.forEach(d => {
    helicesE.push(new Helix(d, E_COLOR, false));
    helicesB.push(new Helix(d, B_COLOR, true));
  });

  // Apply the current visibility toggles, then seed vertices at t=0.
  helicesB.forEach(h => h.setVisible(params.showB));
  helicesE.forEach(h => h.setLobesVisible(params.showLobes));
  helicesB.forEach(h => h.setLobesVisible(params.showLobes));

  for (let i = 0; i < helicesE.length; i++) {
    helicesE[i].update(0, params.k, params.omega, params.amp, params.showLobes);
    helicesB[i].update(0, params.k, params.omega, params.amp, params.showLobes);
  }
}

// The single mutable control state. n = helix count, k = wavenumber, omega =
// angular frequency, dist = distribution mode, amp = base helix amplitude.
// ─── Parameters & UI ───────────────────────────────────────────────────────
const params = {
  n: 36, k: 2.0, omega: 1.0,
  dist: 'ring', showB: true, showLobes: false, amp: 4.2,
};

const $ = id => document.getElementById(id);

// Helix count: rebuild the set (single mode ignores count and stays at one ray).
$('numHelices').addEventListener('input', e => {
  params.n = +e.target.value;
  $('vNum').textContent = params.n;
  if (params.dist !== 'single') rebuild(params.n, params.dist);
});
// Wavenumber and frequency feed the phase directly; no rebuild needed since the
// loop reads params every frame.
$('k').addEventListener('input', e => {
  params.k = +e.target.value;
  $('vK').textContent = params.k.toFixed(1);
});
$('omega').addEventListener('input', e => {
  params.omega = +e.target.value;
  $('vW').textContent = params.omega.toFixed(2);
});
// Toggle the B-field helices on or off.
$('showB').addEventListener('change', e => {
  params.showB = e.target.checked;
  helicesB.forEach(h => h.setVisible(params.showB));
});
// Toggle the transverse E·B field lobes on both families.
$('showLobes').addEventListener('change', e => {
  params.showLobes = e.target.checked;
  helicesE.forEach(h => h.setLobesVisible(params.showLobes));
  helicesB.forEach(h => h.setLobesVisible(params.showLobes));
});

// Mode buttons switch the direction distribution and disable the count slider
// in single mode (one ray has no count to vary).
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === params.dist) return;
    params.dist = mode;
    document.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode));
    const isSingle = (mode === 'single');
    $('numHelices').disabled = isSingle;
    $('numHelices').style.opacity = isSingle ? 0.35 : 1;
    rebuild(params.n, mode);
  });
});

// First build.
rebuild(params.n, params.dist);

// The per-frame loop. It advances wave time by clamped real seconds, kicks in
// idle auto-rotate, rewrites every visible helix, pulses the source spheres, and
// renders.
// ─── Animation loop ────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let t = 0;

function animate() {
  requestAnimationFrame(animate);

  // Clamp dt so a background tab that resumes does not jump the wave forward.
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;

  // After four idle seconds, start the slow camera spin.
  if (idleTimer >= 0) {
    idleTimer += dt;
    if (idleTimer > 4 && !controls.autoRotate) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;
    }
  }

  // Refresh every E helix; refresh B helices only while they are shown.
  const lobesOn = params.showLobes;
  for (let i = 0; i < helicesE.length; i++) {
    helicesE[i].update(t, params.k, params.omega, params.amp, lobesOn);
    if (params.showB) helicesB[i].update(t, params.k, params.omega, params.amp, lobesOn);
  }

  // Breathe the source spheres in time with ω, each slightly phase-offset.
  const pulse = 1 + 0.06 * Math.sin(params.omega * t * 2);
  sourceSpheres.forEach((s, i) => {
    s.scale.setScalar(pulse + 0.04 * Math.sin(params.omega * t * 2 + i * 1.8));
  });

  controls.update();
  renderer.render(scene, camera);
}
animate();

// Keep the camera aspect and renderer size matched to the window.
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

} catch (err) {
  showErr(err.message || String(err));
}
