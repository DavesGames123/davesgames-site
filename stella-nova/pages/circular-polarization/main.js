const errEl = document.getElementById('err');
function showErr(msg){errEl.style.display='block';errEl.textContent='ERROR: '+msg;console.error(msg)}
window.addEventListener('error', e => showErr((e.message||'unknown')+' @ '+(e.filename||'?')+':'+(e.lineno||'?')));
window.addEventListener('unhandledrejection', e => showErr('Promise: '+(e.reason?.message||e.reason)));

// Update slider gradient fill
function paintSlider(el){const min=+el.min,max=+el.max,val=+el.value;el.style.setProperty('--pct',((val-min)/(max-min)*100)+'%')}
document.querySelectorAll('input[type=range]').forEach(s=>{paintSlider(s);s.addEventListener('input',()=>paintSlider(s))});

try {

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

let idleTimer = 0;
controls.addEventListener('start', () => { idleTimer = -1; controls.autoRotate = false; });
controls.addEventListener('end',   () => { idleTimer = 0; });

// ─── Source: vertical axis with three colored spheres ─────────────────────
const sourceGroup = new THREE.Group();
scene.add(sourceGroup);

sourceGroup.add(new THREE.Mesh(
  new THREE.CylinderGeometry(0.035, 0.035, 5.6, 8),
  new THREE.MeshBasicMaterial({ color:0x4a4538, transparent:true, opacity:0.55 })
));

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

sourceGroup.add(new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 20, 20),
  new THREE.MeshBasicMaterial({ color:0xffe9a8 })
));

// ─── Helix & FieldLobes ────────────────────────────────────────────────────
const HELIX_POINTS = 220;
const LOBE_RIBS = 64;  // perpendicular vectors per helix
const R_MIN = 0.55;
const R_MAX = 22.0;

const E_COLOR = 0xffb84d;
const B_COLOR = 0x60e0ee;

class Helix {
  constructor(direction, color, isMagnetic = false) {
    this.dir = direction.clone().normalize();
    this.isMagnetic = isMagnetic;

    const ref = Math.abs(this.dir.y) > 0.95
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    this.e1 = new THREE.Vector3().crossVectors(ref, this.dir).normalize();
    this.e2 = new THREE.Vector3().crossVectors(this.dir, this.e1).normalize();

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

  update(t, k, omega, amp, lobesOn) {
    const pos = this.positions;
    const dx=this.dir.x, dy=this.dir.y, dz=this.dir.z;
    const a1x=this.e1.x, a1y=this.e1.y, a1z=this.e1.z;
    const a2x=this.e2.x, a2y=this.e2.y, a2z=this.e2.z;
    const isB = this.isMagnetic;

    // Helix curve
    for (let i = 0; i < HELIX_POINTS; i++) {
      const r = R_MIN + (R_MAX - R_MIN) * (i / (HELIX_POINTS - 1));
      const phase = k * r - omega * t;
      const ampR = amp / Math.max(r, 1.6);

      let c1, c2;
      if (isB) { c1 = -Math.sin(phase) * ampR; c2 =  Math.cos(phase) * ampR; }
      else     { c1 =  Math.cos(phase) * ampR; c2 =  Math.sin(phase) * ampR; }

      pos[i*3]   = r*dx + c1*a1x + c2*a2x;
      pos[i*3+1] = r*dy + c1*a1y + c2*a2y;
      pos[i*3+2] = r*dz + c1*a1z + c2*a2z;
    }
    this.line.geometry.attributes.position.needsUpdate = true;

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

  setVisible(v){ this.line.visible = v; this.lobes.visible = v && params.showLobes; }
  setLobesVisible(v){ this.lobes.visible = v && this.line.visible; }

  dispose(){
    this.line.geometry.dispose();
    this.line.material.dispose();
    scene.remove(this.line);
    this.lobes.geometry.dispose();
    this.lobes.material.dispose();
    scene.remove(this.lobes);
  }
}

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

function equatorialRing(N){
  const points = [];
  for (let i = 0; i < N; i++) {
    const theta = (i / N) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)));
  }
  return points;
}

let helicesE = [];
let helicesB = [];

function rebuild(n, dist) {
  helicesE.forEach(h => h.dispose());
  helicesB.forEach(h => h.dispose());
  helicesE = []; helicesB = [];

  let dirs;
  if (dist === 'single') {
    dirs = [new THREE.Vector3(1.0, 0.18, 0.55).normalize()];
  } else if (dist === 'ring') {
    dirs = equatorialRing(n);
  } else {
    dirs = fibonacciSphere(n);
  }

  dirs.forEach(d => {
    helicesE.push(new Helix(d, E_COLOR, false));
    helicesB.push(new Helix(d, B_COLOR, true));
  });

  helicesB.forEach(h => h.setVisible(params.showB));
  helicesE.forEach(h => h.setLobesVisible(params.showLobes));
  helicesB.forEach(h => h.setLobesVisible(params.showLobes));

  for (let i = 0; i < helicesE.length; i++) {
    helicesE[i].update(0, params.k, params.omega, params.amp, params.showLobes);
    helicesB[i].update(0, params.k, params.omega, params.amp, params.showLobes);
  }
}

// ─── Parameters & UI ───────────────────────────────────────────────────────
const params = {
  n: 36, k: 2.0, omega: 1.0,
  dist: 'ring', showB: true, showLobes: false, amp: 4.2,
};

const $ = id => document.getElementById(id);

$('numHelices').addEventListener('input', e => {
  params.n = +e.target.value;
  $('vNum').textContent = params.n;
  if (params.dist !== 'single') rebuild(params.n, params.dist);
});
$('k').addEventListener('input', e => {
  params.k = +e.target.value;
  $('vK').textContent = params.k.toFixed(1);
});
$('omega').addEventListener('input', e => {
  params.omega = +e.target.value;
  $('vW').textContent = params.omega.toFixed(2);
});
$('showB').addEventListener('change', e => {
  params.showB = e.target.checked;
  helicesB.forEach(h => h.setVisible(params.showB));
});
$('showLobes').addEventListener('change', e => {
  params.showLobes = e.target.checked;
  helicesE.forEach(h => h.setLobesVisible(params.showLobes));
  helicesB.forEach(h => h.setLobesVisible(params.showLobes));
});

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

rebuild(params.n, params.dist);

// ─── Animation loop ────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let t = 0;

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;

  if (idleTimer >= 0) {
    idleTimer += dt;
    if (idleTimer > 4 && !controls.autoRotate) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;
    }
  }

  const lobesOn = params.showLobes;
  for (let i = 0; i < helicesE.length; i++) {
    helicesE[i].update(t, params.k, params.omega, params.amp, lobesOn);
    if (params.showB) helicesB[i].update(t, params.k, params.omega, params.amp, lobesOn);
  }

  const pulse = 1 + 0.06 * Math.sin(params.omega * t * 2);
  sourceSpheres.forEach((s, i) => {
    s.scale.setScalar(pulse + 0.04 * Math.sin(params.omega * t * 2 + i * 1.8));
  });

  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

} catch (err) {
  showErr(err.message || String(err));
}
