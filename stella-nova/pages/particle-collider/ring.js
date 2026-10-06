// ============================================================================
//  PARTICLE COLLIDER  ·  ring.js — the accelerator complex in 3D
// ----------------------------------------------------------------------------
//  Units: metres, Y up, the ring on the XZ plane. The layout is a schematic
//  of the CERN complex: the collider ring as a rounded octagon (8 straight
//  sections of 545 m round 8 points, 8 arcs of radius 3549 m, 26 659 m in
//  all), the SPS, the PS, the PS Booster and Linac4 with their transfer
//  lines. Positions are not survey data.
//
//  PATH (grep -n 'function buildPath')
//    A turtle walk gives the ring centre line every 2 m, with the tangent
//    and the beam-separation factor (1 in the arcs, 0 at the four
//    interaction points). A float texture holds it for the GPU.
//  MAGNETS (grep -n 'function magnets')
//    26 FODO cells per arc: QF, 3 dipoles, QD, 3 dipoles, a sextupole next
//    to each quadrupole. Instanced cryostats: dipoles blue, QF red, QD
//    amber, sextupoles green.
//  BEAMS (grep -n 'BUNCH_VS')
//    Two counter-rotating beams of 2808 bunches in trains of 72 (25 ns,
//    7.49 m) with the 3 us abort gap. The vertex shader places each bunch
//    on the path texture at s0 +- v t, with the 194 mm aperture separation
//    in the arcs. No CPU work per frame.
//  CELL CLOSE-UP (grep -n 'function cellView')
//    At the FODO station: the beam envelope (an elliptic tube of radii
//    k sqrt(eps beta_x), k sqrt(eps beta_y), k = 600) breathing through
//    the quadrupoles, and 1600 particles doing betatron oscillations
//    x = sqrt(2 J beta) cos(psi + phi0), from accel.js fodo().
//
//  createRing(THREE, o) -> { scene, stations, labels, frame(dt, cam), setBeams(on),
//    setRamp(B), dumpFlash(), ipOf(n), pathAt(s), cell }
// ============================================================================
import { LHC, fodo, IPS } from './accel.js';
import { gradientBackground, glowTexture } from './stage.js';

const C = LHC.C, LS = 545, RA = (C - 8 * LS) / (2 * Math.PI), STEP = 2;
const NPATH = Math.ceil(C / STEP);

export function buildPath() {
  const P = new Float32Array(NPATH * 4);   // x, z, heading, separation factor
  let x = 0, z = 0, h = 0, s = 0, i = 0;
  const ipS = [];
  const push = () => { if (i < NPATH) { P[i * 4] = x; P[i * 4 + 1] = z; P[i * 4 + 2] = h; i++; } };
  for (let k = 0; k < 8; k++) {
    ipS.push(s);
    const nS = Math.round(LS / 2 / STEP);
    for (let j = 0; j < nS; j++) { push(); x += Math.cos(h) * STEP; z += Math.sin(h) * STEP; s += STEP; }
    const arc = RA * Math.PI / 4, nA = Math.round(arc / STEP), dh = (Math.PI / 4) / nA, ds = arc / nA;
    for (let j = 0; j < nA; j++) { push(); h += dh / 2; x += Math.cos(h) * ds; z += Math.sin(h) * ds; h += dh / 2; s += ds; }
    for (let j = 0; j < nS; j++) { push(); x += Math.cos(h) * STEP; z += Math.sin(h) * STEP; s += STEP; }
  }
  while (i < NPATH) push();
  // centre the ring on the origin
  let cx = 0, cz = 0; for (let j = 0; j < NPATH; j++) { cx += P[j * 4]; cz += P[j * 4 + 1]; }
  cx /= NPATH; cz /= NPATH;
  for (let j = 0; j < NPATH; j++) {
    P[j * 4] -= cx; P[j * 4 + 1] -= cz;
    const sj = j * STEP;
    // the beams share one pipe for 150 m on each side of IP1, 2, 5, 8
    let f = 1;
    for (const k of [0, 1, 4, 7]) { let d = Math.abs(sj - ipS[k]); d = Math.min(d, C - d); f = Math.min(f, Math.max(0, Math.min(1, (d - 30) / 120))); }
    P[j * 4 + 3] = f;
  }
  return { P, ipS, len: C };
}
export function pathAt(PT, s) {
  s = ((s % C) + C) % C;
  const f = s / STEP, i = Math.floor(f) % NPATH, j = (i + 1) % NPATH, w = f - Math.floor(f), P = PT.P;
  return { x: P[i * 4] + (P[j * 4] - P[i * 4]) * w, z: P[i * 4 + 1] + (P[j * 4 + 1] - P[i * 4 + 1]) * w, h: P[i * 4 + 2], sep: P[i * 4 + 3] };
}

const BUNCH_VS = `
uniform sampler2D uPath; uniform float uT, uSpeed, uC, uN, uSep, uPx, uMinPx; uniform vec2 uRes;
attribute vec2 iS;      // s0 (m), beam (+1 / -1)
varying float vB; varying vec2 vQ;
vec4 at(float s){ float f = mod(s, uC) / uC * uN; float i0 = floor(f); float w = f - i0;
  vec4 a = texture2D(uPath, vec2((mod(i0, uN) + 0.5) / uN, 0.5)), b = texture2D(uPath, vec2((mod(i0 + 1.0, uN) + 0.5) / uN, 0.5));
  return vec4(mix(a.xy, b.xy, w), a.z, mix(a.w, b.w, w)); }
void main(){
  float s = iS.x + iS.y * uSpeed * uT;
  vec4 p = at(s);
  vec2 n = vec2(-sin(p.z), cos(p.z));
  vec3 w = vec3(p.x + n.x * uSep * iS.y * p.w, 0.6, p.y + n.y * uSep * iS.y * p.w);
  vec4 c = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
  vec4 c2 = projectionMatrix * modelViewMatrix * vec4(w + vec3(0.0, 0.25, 0.0), 1.0);
  float px = max(uMinPx * uPx, abs(c2.y / c2.w - c.y / c.w) * uRes.y * 0.5);
  c.xy += position.xy * px * 2.0 / uRes * c.w;
  gl_Position = c; vB = iS.y; vQ = position.xy;
}`;
const BUNCH_FS = `
varying float vB; varying vec2 vQ; uniform float uI;
void main(){ float r2 = dot(vQ, vQ); if (r2 > 1.0) discard; float g = exp(-r2 * 4.0);
  vec3 c = vB > 0.0 ? vec3(1.0, 0.42, 0.22) : vec3(0.30, 0.62, 1.0);
  gl_FragColor = vec4((c * g + vec3(g * g) * 0.5) * uI, 1.0); }`;

export function createRing(THREE, o = {}) {
  const scene = new THREE.Scene();
  scene.background = gradientBackground('#0a1222', '#04060b', '#020306');
  scene.fog = new THREE.FogExp2(0x04060b, 0.000012);
  const PT = buildPath();
  const add = { blending: THREE.AdditiveBlending, depthWrite: false, transparent: true };
  const glow = glowTexture();
  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x10131c, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1e0, 1.4); sun.position.set(3000, 6000, 2000); scene.add(sun);

  // ── ground: a dark disc with a faint survey grid ──
  {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d'), gr = g.createRadialGradient(512, 512, 0, 512, 512, 512);
    gr.addColorStop(0, '#0d1424'); gr.addColorStop(0.55, '#080c16'); gr.addColorStop(1, 'rgba(4,6,11,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
    g.strokeStyle = 'rgba(120,150,210,0.07)'; g.lineWidth = 1;
    for (let k = 0; k <= 32; k++) { const p = k * 32; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 1024); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(1024, p); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = -3; m.renderOrder = -1; scene.add(m);
  }

  // ── the ring: a glowing ribbon (far), a tunnel (near) ──
  const ringPts = []; for (let i = 0; i < NPATH; i += 4) ringPts.push(new THREE.Vector3(PT.P[i * 4], 0, PT.P[i * 4 + 1]));
  const curve = new THREE.CatmullRomCurve3(ringPts, true);
  const farMat = new THREE.MeshBasicMaterial({ color: 0x5f8dff, ...add, opacity: 0.8 });
  const far = new THREE.Mesh(new THREE.TubeGeometry(curve, 2400, 5, 6, true), farMat); scene.add(far);
  // the floor light strip of the tunnel
  const strip = new THREE.Mesh(new THREE.TubeGeometry(curve, 6000, 0.05, 4, true), new THREE.MeshBasicMaterial({ color: 0xfff0d0, ...add, opacity: 0 }));
  strip.position.set(0, 2.45, 0); scene.add(strip);

  // ── magnets ──
  const cell = fodo();
  const Q = new THREE.Quaternion(), M = new THREE.Matrix4(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const cryo = (color, len, r, n) => {
    const g = new THREE.CylinderGeometry(r, r, len, 20, 1); g.rotateZ(Math.PI / 2);   // axis on x
    const m = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.35, emissive: color, emissiveIntensity: 0.12, transparent: true, opacity: 1 });
    const im = new THREE.InstancedMesh(g, m, n); im.frustumCulled = false; scene.add(im); return im;
  };
  const arcCells = Math.round(RA * Math.PI / 4 / cell.Lc), nCell = arcCells * 8;
  const DIP = cryo(0x2f6fe0, 14.3, 0.46, nCell * 6), QF = cryo(0xe8453c, 3.1, 0.46, nCell), QD = cryo(0xf2b33d, 3.1, 0.46, nCell), SX = cryo(0x3fd27a, 0.9, 0.42, nCell * 2);
  const place = (im, k, s) => { const p = pathAt(PT, s); V.set(p.x, 0.6, p.z); Q.setFromAxisAngle(Y, -p.h); M.compose(V, Q, Sc.set(1, 1, 1)); im.setMatrixAt(k, M); };
  const cells = [];
  function magnets() {
    let kd = 0, kq = 0, ks = 0;
    for (let a = 0; a < 8; a++) {
      const s0 = PT.ipS[a] + LS / 2;
      for (let c = 0; c < arcCells; c++) {
        const cs = s0 + c * cell.Lc + 6; cells.push(cs);
        place(QF, kq, cs + 1.6); place(SX, ks++, cs + 3.8);
        for (let d = 0; d < 3; d++) place(DIP, kd++, cs + 4.6 + 7.15 + d * 15.3);
        place(QD, kq, cs + cell.L + 1.6); place(SX, ks++, cs + cell.L + 3.8);
        for (let d = 0; d < 3; d++) place(DIP, kd++, cs + cell.L + 4.6 + 7.15 + d * 15.3);
        kq++;
      }
    }
    for (const im of [DIP, QF, QD, SX]) im.instanceMatrix.needsUpdate = true;
  }
  magnets();

  // ── the beams: bunch sprites on the GPU ──
  const tex = new THREE.DataTexture(new Float32Array(PT.P), NPATH, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true; tex.magFilter = tex.minFilter = THREE.NearestFilter;
  const BU = { uPath: { value: tex }, uT: { value: 0 }, uSpeed: { value: 40 }, uC: { value: C }, uN: { value: NPATH }, uSep: { value: 0.097 }, uPx: { value: 1 }, uMinPx: { value: 1.6 }, uRes: { value: new THREE.Vector2(1, 1) }, uI: { value: 1 } };
  const fill = [];
  {
    // 2808 bunches: trains of 72 at 7.49 m, 8 empty buckets between trains, 3 us abort gap
    const sp = 7.4948, gap = 900; let s = 0, n = 0;
    while (n < 2808 && s < C - gap) { for (let k = 0; k < 72 && n < 2808; k++, n++) { fill.push(s); s += sp; } s += 8 * sp; }
  }
  const bg = new THREE.InstancedBufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  const iS = new Float32Array(fill.length * 4);
  fill.forEach((s, i) => { iS.set([s, 1], i * 2); iS.set([C - s, -1], (fill.length + i) * 2); });
  bg.setAttribute('iS', new THREE.InstancedBufferAttribute(iS, 2)); bg.instanceCount = fill.length * 2;
  const bunchMat = new THREE.ShaderMaterial({ uniforms: BU, vertexShader: BUNCH_VS, fragmentShader: BUNCH_FS, ...add, depthTest: true });
  const bunches = new THREE.Mesh(bg, bunchMat); bunches.frustumCulled = false; bunches.renderOrder = 5; scene.add(bunches);

  // ── injectors (schematic positions) ──
  const ip = k => { const p = pathAt(PT, PT.ipS[k - 1]); return new THREE.Vector3(p.x, 0, p.z); };
  const c1 = ip(1), c2 = ip(2), c8 = ip(8);
  const spsC = c1.clone().multiplyScalar(0.62).add(new THREE.Vector3(c1.z, 0, -c1.x).normalize().multiplyScalar(-420));
  const inj = [];
  const ringLine = (cen, r, col, op = 0.9, rad = 3) => {
    const g = new THREE.TorusGeometry(r, rad, 6, Math.max(48, Math.round(r / 6))); g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, ...add, opacity: op })); m.position.copy(cen); m.userData.op = op; inj.push(m); scene.add(m); return m;
  };
  const sps = ringLine(spsC, 1100, 0x7ad7ff, 0.75, 5);
  const psC = spsC.clone().add(spsC.clone().sub(c1).normalize().multiplyScalar(-1).add(new THREE.Vector3(0.6, 0, 0.3)).normalize().multiplyScalar(1400));
  const ps = ringLine(psC, 100, 0x9effc8, 0.9, 2.2);
  const psbC = psC.clone().add(new THREE.Vector3(-170, 0, 90));
  const psb = [0, 1, 2, 3].map(k => { const m = ringLine(psbC, 25, 0xd6a8ff, 0.9, 0.7); m.position.y = k * 0.8; return m; });
  const linA = psbC.clone().add(new THREE.Vector3(-25, 0, 0)), linB = linA.clone().add(new THREE.Vector3(-160, 0, 40));
  const line = (pts, col, op = 0.8, r = 1.2) => { const cv = new THREE.CatmullRomCurve3(pts); const m = new THREE.Mesh(new THREE.TubeGeometry(cv, 64, r, 6, false), new THREE.MeshBasicMaterial({ color: col, ...add, opacity: op })); m.userData.op = op; inj.push(m); scene.add(m); return m; };
  const linac = line([linB, linA], 0xffe08a, 0.7, 0.9);
  // RF cavities along the linac
  const cav = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 1.4, 4, 18).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8743c, metalness: 0.9, roughness: 0.3, emissive: 0x7a3010, emissiveIntensity: 0.35 }), 16);
  { const dir = linA.clone().sub(linB).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir); for (let k = 0; k < 16; k++) { M.compose(linB.clone().addScaledVector(dir, 8 + k * 9.5).setY(0.8), q, Sc.set(1, 1, 1)); cav.setMatrixAt(k, M); } }
  scene.add(cav);
  line([psbC, psbC.clone().lerp(psC, 0.5).add(new THREE.Vector3(0, 0, 20)), psC.clone().add(psbC.clone().sub(psC).normalize().multiplyScalar(100))], 0xd6a8ff, 0.7);
  const spsEdge = spsC.clone().add(psC.clone().sub(spsC).normalize().multiplyScalar(1100));
  line([psC.clone().add(spsC.clone().sub(psC).normalize().multiplyScalar(100)), psC.clone().lerp(spsEdge, 0.5).add(new THREE.Vector3(30, 0, 0)), spsEdge], 0x9effc8, 0.6);
  const ti = (c) => { const e = spsC.clone().add(c.clone().sub(spsC).normalize().multiplyScalar(1100)); return line([e, e.clone().lerp(c, 0.5).add(spsC.clone().sub(c).normalize().multiplyScalar(-150)), c], 0x7ad7ff, 0.55, 2); };
  ti(c2); ti(c8);

  // ── the points: detectors, RF, collimators, dump ──
  const pmats = [];
  const marker = (k, kind) => {
    const p = ip(k), pa = pathAt(PT, PT.ipS[k - 1]);
    if (kind === 'ip') {
      const big = k === 5;
      // a small barrel detector: a 12-sided yoke with an open wedge, the
      // calorimeter rings inside and glowing end rings
      const det = new THREE.Group(), R = big ? 7.5 : 6, Lh = big ? 10.5 : 9;
      const yoke = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2 * Lh, 12, 1, false, 0.9, Math.PI * 2 - 1.2), new THREE.MeshStandardMaterial({ color: big ? 0xb4313f : 0x6b7c99, metalness: 0.7, roughness: 0.35, emissive: big ? 0x3a0a10 : 0x111826, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.45, R * 0.45, 2 * Lh * 0.7, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xd99a4e, metalness: 0.6, roughness: 0.4, emissive: 0x6a3a10, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
      const ecalM = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.25, R * 0.25, 2 * Lh * 0.6, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x36d6b6, ...add, opacity: 0.5, side: THREE.DoubleSide }));
      det.add(yoke, inner, ecalM);
      for (const sg of [-1, 1]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.12, 8, 48), new THREE.MeshBasicMaterial({ color: big ? 0xff8a6a : 0x8fb6ff, ...add, opacity: 0.9 })); ring.rotation.x = Math.PI / 2; ring.position.y = sg * Lh; det.add(ring); }
      det.rotation.z = Math.PI / 2; const holder = new THREE.Group(); holder.add(det); holder.position.set(p.x, 0.6, p.z); holder.rotation.y = -pa.h; scene.add(holder);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: big ? 0xff8a6a : 0x8fb6ff, ...add, opacity: 0.85 })); halo.position.set(p.x, 1, p.z); halo.scale.setScalar(big ? 380 : 240); scene.add(halo); pmats.push(halo);
    } else if (kind === 'rf') {
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 18, 12), new THREE.MeshStandardMaterial({ color: 0xd88a4a, metalness: 0.95, roughness: 0.25, emissive: 0x8a3a12, emissiveIntensity: 0.5 }), 16);
      for (let j = 0; j < 16; j++) { const q = pathAt(PT, PT.ipS[k - 1] - 40 + j * 5.3); M.compose(V.set(q.x, 0.6, q.z), Q.identity(), Sc.set(1.4, 1, 1)); im.setMatrixAt(j, M); }
      scene.add(im);
    } else if (kind === 'col') {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1.0, 1.0), new THREE.MeshStandardMaterial({ color: 0x9aa6b8, metalness: 0.7, roughness: 0.4 }), 12);
      for (let j = 0; j < 12; j++) { const q = pathAt(PT, PT.ipS[k - 1] - 120 + j * 22); M.compose(V.set(q.x, 0.6, q.z), Q.setFromAxisAngle(Y, -q.h), Sc.set(1, 1, 1)); im.setMatrixAt(j, M); }
      scene.add(im);
    } else if (kind === 'dump') {
      const out = new THREE.Vector3(p.x, 0, p.z).normalize(), tang = new THREE.Vector3(Math.cos(pa.h), 0, Math.sin(pa.h));
      const end = p.clone().addScaledVector(tang, 700).addScaledVector(out, 220);
      dumpLine = line([p.clone().addScaledVector(tang, -40), p.clone().addScaledVector(tang, 300).addScaledVector(out, 40), end], 0xff6a4a, 0.4, 1.6);
      dumpBlock = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 4), new THREE.MeshStandardMaterial({ color: 0x3b3f48, metalness: 0.2, roughness: 0.8, emissive: 0xff4a1a, emissiveIntensity: 0 }));
      dumpBlock.position.copy(end).setY(2); dumpBlock.lookAt(p.x, 2, p.z); scene.add(dumpBlock); dumpPos = end;
    }
  };
  let dumpLine = null, dumpBlock = null, dumpPos = null, dumpT = 99;
  for (const q of IPS) marker(q.n, q.kind);

  // ── the FODO close-up: envelope and betatron particles ──
  const CELL_S = cells[Math.floor(arcCells * 2.5)];    // a cell in the third arc
  let envMesh = null, betaPts = null;
  const parts = [];
  function cellView() {
    const N = 3 * cell.Lc, nS = 360, ring = 18, k = 600, eps = 3.75e-6 / 7461;
    const pos = [], idx = [];
    const bx = s => { const u = ((s % cell.Lc) + cell.Lc) % cell.Lc / cell.Lc * (cell.X.pts.length - 1); return cell.X.pts[Math.round(u)][1]; };
    const by = s => { const u = ((s % cell.Lc) + cell.Lc) % cell.Lc / cell.Lc * (cell.Y.pts.length - 1); return cell.Y.pts[Math.round(u)][1]; };
    for (let i = 0; i <= nS; i++) {
      const s = CELL_S - cell.Lc + N * i / nS, p = pathAt(PT, s), nx = -Math.sin(p.h), nz = Math.cos(p.h);
      const ax = k * Math.sqrt(eps * bx(s - CELL_S)), ay = k * Math.sqrt(eps * by(s - CELL_S));
      for (const sg of [1, -1]) for (let j = 0; j < ring; j++) {
        const a = j / ring * Math.PI * 2, off = sg * 0.097;
        pos.push(p.x + nx * (off + ax * Math.cos(a)), 0.6 + ay * Math.sin(a), p.z + nz * (off + ax * Math.cos(a)));
      }
    }
    for (let i = 0; i < nS; i++) for (let sg = 0; sg < 2; sg++) for (let j = 0; j < ring; j++) {
      const a = (i * 2 + sg) * ring + j, b = (i * 2 + sg) * ring + (j + 1) % ring, c = ((i + 1) * 2 + sg) * ring + j, d = ((i + 1) * 2 + sg) * ring + (j + 1) % ring;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    envMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ ...add, depthTest: false, side: THREE.DoubleSide, uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec3 vN, vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uA; varying vec3 vN, vV; void main(){ float r = 1.0 - abs(dot(vN, vV)); gl_FragColor = vec4(vec3(0.35, 0.75, 1.0) * (0.025 + 0.42 * r * r * r) * uA, 1.0); }' }));
    envMesh.frustumCulled = false; envMesh.renderOrder = 8; scene.add(envMesh);
    // betatron particles
    const n = 1600, pg = new THREE.BufferGeometry(), arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) parts.push({ s: Math.random() * N, J: -Math.log(Math.random() || 1e-9) * 0.5, px: Math.random() * 6.283, py: Math.random() * 6.283, Jy: -Math.log(Math.random() || 1e-9) * 0.5, b: i % 2 ? 1 : -1 });
    pg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    betaPts = new THREE.Points(pg, new THREE.PointsMaterial({ map: glow, size: 0.16, color: 0xbfe6ff, ...add, depthTest: false, opacity: 0, sizeAttenuation: true }));
    betaPts.frustumCulled = false; scene.add(betaPts);
    return { bx, by, N, k, eps };
  }
  const CV = cellView();
  // phase advance through the cell, for the particles
  const psiAt = (pl, u) => { const pts = pl.pts, i = Math.round(u * (pts.length - 1)); return pts[i][3]; };
  function betatron(dt) {
    const arr = betaPts.geometry.attributes.position.array, N = CV.N;
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      q.s += dt * 9 * q.b; if (q.s > N) q.s -= N; if (q.s < 0) q.s += N;
      const sl = CELL_S - cell.Lc + q.s, uc = ((q.s % cell.Lc) + cell.Lc) % cell.Lc / cell.Lc, nc = Math.floor(q.s / cell.Lc);
      const psx = nc * cell.mu + psiAt(cell.X, uc), psy = nc * cell.muY + psiAt(cell.Y, uc);
      const x = CV.k * Math.sqrt(2 * q.J * CV.eps * CV.bx(sl - CELL_S)) * Math.cos(psx + q.px), y = CV.k * Math.sqrt(2 * q.Jy * CV.eps * CV.by(sl - CELL_S)) * Math.cos(psy + q.py);
      const p = pathAt(PT, sl), nx = -Math.sin(p.h), nz = Math.cos(p.h), off = q.b * 0.097 * p.sep;
      arr[i * 3] = p.x + nx * (off + x); arr[i * 3 + 1] = 0.6 + y; arr[i * 3 + 2] = p.z + nz * (off + x);
    }
    betaPts.geometry.attributes.position.needsUpdate = true;
  }

  // ── labels ──
  const labels = [
    ...IPS.map(q => ({ id: 'p' + q.n, text: q.label.split(' · ')[0], sub: q.label.split(' · ').slice(1).join(' · '), pos: ip(q.n).setY(40) })),
    { id: 'sps', text: 'SPS', sub: '450 GeV', pos: spsC.clone().add(new THREE.Vector3(0, 40, 1100)) },
    { id: 'ps', text: 'PS', sub: '26 GeV/c', pos: psC.clone().add(new THREE.Vector3(0, 30, 100)) },
    { id: 'psb', text: 'Booster', sub: '2 GeV', pos: psbC.clone().add(new THREE.Vector3(0, 20, 30)) },
    { id: 'linac', text: 'Linac4', sub: '160 MeV', pos: linB.clone().setY(15) },
  ];
  // ── stations: camera poses for the panel cards ──
  const tAt = s => { const p = pathAt(PT, s); return new THREE.Vector3(p.x, 0.6, p.z); };
  const hdg = s => -pathAt(PT, s).h * 180 / Math.PI;
  const stations = {
    source: { target: linB.clone().lerp(linA, 0.4).setY(1), az: 210, el: 24, r: 240 },
    chain: { target: spsC.clone().lerp(psC, 0.35), az: 200, el: 48, r: 5200 },
    dipole: { target: tAt(CELL_S + 20), az: 90 + hdg(CELL_S) + 55, el: 14, r: 15 },
    fodo: { target: tAt(CELL_S + cell.L * 0.5), az: 90 + hdg(CELL_S) + 22, el: 10, r: 24 },
    tune: { target: tAt(CELL_S + 4), az: 90 + hdg(CELL_S) + 80, el: 18, r: 9 },
    rf: { target: tAt(PT.ipS[3]), az: 90 + hdg(PT.ipS[3]) + 40, el: 16, r: 60 },
    ramp: { target: new THREE.Vector3(0, 0, 0), az: 0, el: 62, r: 16500 },
    ip: { target: tAt(PT.ipS[4]), az: 90 + hdg(PT.ipS[4]) + 30, el: 14, r: 70 },
    sr: { target: tAt(CELL_S + 60), az: hdg(CELL_S) - 20, el: 12, r: 300 },
    dump: { target: (dumpPos || new THREE.Vector3()).clone().lerp(ip(6), 0.4), az: 160, el: 35, r: 1100 },
  };

  let time = 0, near = 1, closeUp = 0;
  function frame(dt, cam, res, pxr) {
    time += dt;
    BU.uT.value = time; BU.uRes.value.copy(res); BU.uPx.value = pxr;
    const d = cam.position.length() > 0 ? cam.position.distanceTo(o.target ? o.target() : new THREE.Vector3()) : 1e4;
    // far: the ribbon glows; near: the tunnel, magnets and the cell close-up
    near = Math.max(0, Math.min(1, (1500 - d) / 1200));
    // the ribbon is the far view of the beams: gone below 800 m
    farMat.opacity = 0.85 * Math.max(0, Math.min(1, (d - 800) / 3000));
    strip.material.opacity = 0.12 * near;
    // injector glow: full from afar, faint at close range (no glare)
    const ki = Math.max(0.12, Math.min(1, (d - 120) / 1600));
    for (const m of inj) if (m !== dumpLine) m.material.opacity = m.userData.op * ki;
    for (const h of pmats) h.material.opacity = 0.85 * Math.max(0, Math.min(1, (d - 1200) / 2500));
    const close = Math.max(0, Math.min(1, (260 - d) / 160));
    const cu = close * closeUp;
    envMesh.material.uniforms.uA.value = cu;
    betaPts.material.opacity = cu;
    for (const im of [DIP, QF, QD, SX]) { im.material.opacity = 1 - 0.6 * cu; im.material.depthWrite = cu < 0.5; }
    BU.uI.value = 0.6 + 0.4 * (1 - close);
    if (close * closeUp > 0.01) betatron(dt);
    if (dumpBlock) { dumpT += dt; dumpBlock.material.emissiveIntensity = Math.max(0, 3 * Math.exp(-dumpT / 1.8)); dumpLine.material.opacity = 0.4 + 1.5 * Math.exp(-dumpT / 1.2); }
  }
  return {
    scene, stations, labels, frame, PT, cell, cells, CELL_S, ip, BU,
    setBeams(on) { bunches.visible = on; },
    setCloseUp(on) { closeUp = on ? 1 : 0; },
    setSpeed(v) { BU.uSpeed.value = v; },
    dumpFlash() { dumpT = 0; },
    pathAt: s => pathAt(PT, s),
    sps, ps, psb, linac,
  };
}
