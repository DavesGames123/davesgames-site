// ============================================================================
//  PARTICLE COLLIDER  ·  display.js — the 3D event display
// ----------------------------------------------------------------------------
//  createDisplay(THREE, o) -> { group, show(R, O, info), setTime(t), ... }
//  R is the merged transport result, O the reconstruction (reco.js).
//  Everything is drawn with additive blending and no depth writes, so the
//  bloom pass turns it into light. One uniform, uT (ns), drives all parts:
//  the 25 ns crossing plays in slow motion by moving uT.
//
//  LAYERS (grep -n 'function build')
//    tracks ..... one instanced quad per track segment. The vertex shader
//                 cuts the segment at uT, so a particle draws its own path
//                 as it flies; the fresh end glows hotter (a comet tail).
//                 Width and brightness by class; neutral hadrons and
//                 photons dashed; shower e, gamma dimmer by log E.
//    heads ...... a glowing point at the moving end of each live segment
//    hits ....... silicon and muon-chamber hits; a flash when struck
//    cells ...... ECAL crystals and HCAL towers lit by log E (an inferno-
//                 like ramp, monotone in lightness). A cell grows from its
//                 front face when its first deposit arrives.
//    MET, jets .. an arrow in the transverse plane; translucent jet cones
//    Cherenkov .. light-blue cones of half-angle acos(1/(n beta))
//    bunches .... two proton bunches meet at z = 0, t = 0, with a flash;
//                 pile-up vertices flash where they sit along the beam
//
//  Selection: setSel(trackIndex) brightens one track and dims the rest.
// ============================================================================
import { ECAL, HCAL, cellCenter } from './geometry.js';
import { CLASS_COLOR } from './particles.js';
import { CLS } from './transport.js';
import { KHCAL } from './reco.js';

const C_MM = 299.792458;
// inferno-like log ramp (dark violet -> magenta -> orange -> pale yellow)
const RAMP = [[0, [0.10, 0.03, 0.30]], [0.3, [0.58, 0.12, 0.45]], [0.6, [1.0, 0.42, 0.14]], [0.82, [1.0, 0.78, 0.30]], [1, [1.0, 0.98, 0.86]]];
export function ramp(u) {
  u = Math.max(0, Math.min(1, u));
  for (let i = 1; i < RAMP.length; i++) if (u <= RAMP[i][0]) { const [a, A] = RAMP[i - 1], [b, B] = RAMP[i], k = (u - a) / (b - a); return A.map((v, j) => v + (B[j] - v) * k); }
  return RAMP[RAMP.length - 1][1];
}
export const logU = (eMeV, lo = 200, hi = 150000) => Math.log(Math.max(lo, eMeV) / lo) / Math.log(hi / lo);

const SEG_VS = `
uniform float uT, uPx, uSel, uGain, uWk, uDim; uniform vec2 uRes;
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec3 iD;
varying vec3 vCol; varying float vSide, vI, vDash, vAlong, vHot;
void main(){
  if (uT < iA.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float f = clamp((uT - iA.w) / max(1e-5, iB.w - iA.w), 0.0, 1.0);
  vec3 b = mix(iA.xyz, iB.xyz, f);
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(iA.xyz, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
  if (ca.w <= 0.0 || cb.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uRes;
  float l = length(d); vec2 dir = l > 1e-4 ? d / l : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  float w = iC.w * uPx * uWk;
  vec4 c = mix(ca, cb, position.x);
  c.xy += (nrm * position.y * w + dir * (position.x * 2.0 - 1.0) * w * 0.5) * 2.0 / uRes * c.w;
  gl_Position = c;
  float sel = uSel < 0.0 ? 1.0 : (abs(iD.z - uSel) < 0.5 ? 2.2 : 0.18);
  vCol = iC.rgb; vSide = position.y; vI = iD.x * sel * uGain * uDim; vDash = iD.y; vAlong = position.x * length(b - iA.xyz);
  vHot = exp(-max(0.0, uT - mix(iA.w, iB.w, f * position.x)) / 0.7);
}`;
const SEG_FS = `
varying vec3 vCol; varying float vSide, vI, vDash, vAlong, vHot;
void main(){
  if (vDash > 0.5 && fract(vAlong / 45.0) > 0.55) discard;
  float s = abs(vSide), glow = exp(-s * s * 3.0), core = smoothstep(0.55, 0.0, s);
  vec3 col = vCol * (0.55 * glow + 0.9 * core) * vI * (0.45 + 3.0 * vHot) + vec3(1.0) * core * core * vHot * 0.22 * vI;
  gl_FragColor = vec4(col, 1.0);
}`;
const PT_VS = `
uniform float uT, uPx, uGain, uDim; uniform vec2 uRes;
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
varying vec3 vCol; varying vec2 vQ; varying float vI;
void main(){
  // a moving head when iB.w > iA.w; a static point (hit, vertex, flash)
  // when iB.w <= iA.w, with iB.x its lasting brightness after the flash
  bool mv = iB.w > iA.w + 1e-6;
  float f = (uT - iA.w) / max(1e-5, iB.w - iA.w);
  if ((mv && (f < 0.0 || f >= 1.0)) || (!mv && uT < iA.w)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = mv ? mix(iA.xyz, iB.xyz, f) : iA.xyz;
  vec4 c = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  float age = max(0.0, uT - iA.w), fl = exp(-age / 0.45);
  float sz = iC.w * uPx * (mv ? 1.0 : (0.6 + 1.6 * fl));
  c.xy += position.xy * sz * 2.0 / uRes * c.w;
  gl_Position = c;
  vCol = iC.rgb; vQ = position.xy; vI = (mv ? uGain : iB.x + (0.4 + 1.6 * iB.x) * fl) * uDim;
}`;
const PT_FS = `
varying vec3 vCol; varying vec2 vQ; varying float vI;
void main(){ float r2 = dot(vQ, vQ); if (r2 > 1.0) discard; float g = exp(-r2 * 4.5); gl_FragColor = vec4(vCol * g * vI + vec3(g * g * 0.3 * vI), 1.0); }`;
const CELL_VS = `
uniform float uT, uCellGain, uDim;
attribute vec4 iCol; attribute float iT;
varying vec3 vCol; varying vec3 vL; varying float vA;
void main(){
  float u = clamp((uT - iT) / 1.4, 0.0, 1.0), s = u * u * (3.0 - 2.0 * u);
  vec3 p = position; p.x *= max(0.001, s);
  vec4 w = instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * w;
  vCol = iCol.rgb; vL = position; vA = s > 0.0 ? iCol.a * (0.65 + 0.35 * s) * uCellGain * uDim * (1.0 + 1.3 * exp(-max(0.0, uT - iT - 1.0) / 0.9)) : 0.0;
}`;
const CELL_FS = `
varying vec3 vCol; varying vec3 vL; varying float vA;
void main(){
  if (vA <= 0.0) discard;
  float e = max(abs(vL.y), abs(vL.z)) * 2.0, edge = smoothstep(0.78, 1.0, e);
  gl_FragColor = vec4(vCol * vA * (0.30 + 1.25 * edge), 1.0);
}`;

export function createDisplay(THREE, o = {}) {
  const group = new THREE.Group();
  const U = { uT: { value: 0 }, uPx: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uSel: { value: -1 }, uGain: { value: 1 }, uCellGain: { value: 1 }, uWk: { value: 1 }, uDim: { value: 1 } };
  const add = { blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true };
  const segMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SEG_VS, fragmentShader: SEG_FS, ...add });
  const ptMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: PT_VS, fragmentShader: PT_FS, ...add });
  const cellMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: CELL_VS, fragmentShader: CELL_FS, ...add, side: THREE.FrontSide });
  const quad = (x0, x1) => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([x0, -1, 0, x1, -1, 0, x1, 1, 0, x0, -1, 0, x1, 1, 0, x0, 1, 0], 3)); return g; };
  const col = Object.fromEntries(Object.entries(CLASS_COLOR).map(([k, v]) => [k, new THREE.Color(v)]));
  let objs = [], tEnd = 30, meta = null;

  function clear() { for (const m of objs) { group.remove(m.isArrow ? m.grp : m); m.geometry.dispose(); if (m.material && m.material.userData.own) m.material.dispose(); } objs = []; }
  const put = m => { m.frustumCulled = false; group.add(m); objs.push(m); return m; };

  // ── tracks and heads ──
  function tracks(R) {
    const n = R.nSeg, A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4), Dd = new Float32Array(n * 3);
    const hA = [], hB = [], hC = [];
    const W = { mu: 3.4, e: 2.6, gamma: 1.5, had: 2.1, neu: 1.4, nu: 1, shower: 1.15 };
    let tmax = 0, ink = 0;
    for (let i = 0; i < n; i++) {
      const k = i * 9, S = R.seg, cls = CLS[R.segCls[i]], E = S[k + 8];
      A.set([S[k], S[k + 1], S[k + 2], S[k + 3]], i * 4); B.set([S[k + 4], S[k + 5], S[k + 6], S[k + 7]], i * 4);
      if (S[k + 7] < 60) tmax = Math.max(tmax, S[k + 7]);
      const c = col[cls] || col.had;
      let I = cls === 'shower' ? 0.07 + 0.38 * Math.min(1, Math.log10(Math.max(1, E)) / 4.5) : cls === 'gamma' ? 0.45 : cls === 'neu' ? 0.35 : cls === 'mu' ? 1.2 : 0.85;
      if (cls !== 'shower' && cls !== 'mu' && E < 300) I *= 0.6;
      C.set([c.r, c.g, c.b, W[cls] || 1.5], i * 4);
      ink += cls === 'shower' ? 0.25 : 1;
      Dd.set([I, cls === 'neu' || cls === 'gamma' ? 1 : 0, R.segTrk[i]], i * 3);
      // a head only on a segment that takes time (a zero-length one would read as a static point)
      if ((cls !== 'shower' || E > 400) && S[k + 7] - S[k + 3] > 2e-5) { hA.push(S[k], S[k + 1], S[k + 2], S[k + 3]); hB.push(S[k + 4], S[k + 5], S[k + 6], S[k + 7]); hC.push(c.r, c.g, c.b, cls === 'shower' ? 2.5 : cls === 'mu' ? 6 : 4.5); }
    }
    const g = quad(0, 1);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 4)); g.setAttribute('iD', new THREE.InstancedBufferAttribute(Dd, 3));
    g.instanceCount = n;
    // busy events: scale the glow down with the amount of ink, so that
    // additive blending does not burn the centre to white
    U.uGain.value = Math.max(0.025, Math.pow(Math.min(1, 1500 / Math.max(1, ink)), 0.75));
    U.uWk.value = Math.max(0.5, Math.min(1, Math.sqrt(5000 / Math.max(1, ink))));
    put(new THREE.Mesh(g, segMat)).renderOrder = 10;
    const h = quad(-1, 1);
    h.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(hA), 4)); h.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(hB), 4)); h.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(hC), 4));
    h.instanceCount = hA.length / 4;
    put(new THREE.Mesh(h, ptMat)).renderOrder = 12;
    return tmax;
  }
  // points: [x, y, z, t, r, g, b, size]
  function points(list, order = 11) {
    const n = list.length; if (!n) return;
    const A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4);
    list.forEach((p, i) => { A.set([p[0], p[1], p[2], p[3]], i * 4); B.set([p[8] ?? 0.55, 0, 0, p[3] - 1], i * 4); C.set([p[4], p[5], p[6], p[7]], i * 4); });
    const g = quad(-1, 1);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4)); g.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 4));
    g.instanceCount = n;
    put(new THREE.Mesh(g, ptMat)).renderOrder = order;
  }
  // ── calorimeter cells ──
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  function cells(list) {
    // list: [{ eta, phi, deta, dphi, E, t, kind: 'ecal' | 'hcal', depth }]
    if (!list.length) return;
    // many lit cells overlap on screen: keep their sum below white
    let w = 0; for (const c of list) w += c.kind === 'ecal' ? 0.5 : 1;
    U.uCellGain.value = Math.max(0.04, Math.pow(Math.min(1, 90 / Math.max(1, w)), 0.8));
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0.5, 0, 0);
    const mesh = new THREE.InstancedMesh(g, cellMat, list.length);
    const iCol = new Float32Array(list.length * 4), iT = new Float32Array(list.length);
    list.forEach((c, i) => {
      const barrel = c.kind === 'ecal' ? Math.abs(c.eta) < 1.479 : Math.abs(c.eta) < 1.305;
      const [r0, r1, zf, zb] = c.kind === 'ecal' ? [1290, 1520, 3000, 3230] : [1770, 2950, 3300, 4900];
      const sh = Math.sinh(c.eta), cp = Math.cos(c.phi), sp = Math.sin(c.phi);
      if (barrel) {
        const rm = (r0 + r1) / 2, dz = rm * (Math.sinh(c.eta + c.deta / 2) - Math.sinh(c.eta - c.deta / 2));
        const depth = (r1 - r0) * c.depth;
        _p.set(r0 * cp, r0 * sp, r0 * sh); _x.set(cp, sp, 0); _y.set(-sp, cp, 0); _z.set(0, 0, 1);
        _s.set(depth, rm * c.dphi * 0.9, dz * 0.9);
      } else {
        const sg = Math.sign(c.eta), zm = (zf + zb) / 2, rA = zm / Math.abs(Math.sinh(c.eta + c.deta / 2)), rB = zm / Math.abs(Math.sinh(c.eta - c.deta / 2)), rr = zm / Math.abs(sh);
        _p.set(rr * cp, rr * sp, sg * zf); _x.set(0, 0, sg); _y.set(-sp, cp, 0); _z.set(cp, sp, 0).multiplyScalar(-sg);   // x cross y
        _s.set((zb - zf) * c.depth, rr * c.dphi * 0.9, Math.abs(rB - rA) * 0.9);
      }
      _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
      _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
      const u = logU(c.E, c.kind === 'ecal' ? 150 : 300), rgb = ramp(u), a = 0.35 + 0.65 * u;
      iCol.set([rgb[0], rgb[1], rgb[2], a * (c.kind === 'ecal' ? 1.0 : 0.75)], i * 4); iT[i] = c.t;
    });
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(iCol, 4)); g.setAttribute('iT', new THREE.InstancedBufferAttribute(iT, 1));
    put(mesh).renderOrder = 6;
  }
  // a glowing translucent cone, apex at a, axis u, length L, half-angle th
  function cone(a, u, L, th, color, alpha, t0, order = 5) {
    const g = new THREE.ConeGeometry(L * Math.tan(th), L, 40, 1, true); g.translate(0, -L / 2, 0); g.rotateX(Math.PI);
    const m = new THREE.ShaderMaterial({
      uniforms: { uT: U.uT, uC: { value: new THREE.Color(color) }, uA: { value: alpha }, uT0: { value: t0 }, uL: { value: L } }, ...add, side: THREE.DoubleSide,
      vertexShader: 'varying float vY; varying vec3 vN, vV; void main(){ vY = position.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uT, uA, uT0, uL; uniform vec3 uC; varying float vY; varying vec3 vN, vV; void main(){ float grow = clamp((uT - uT0) * 299.79 / uL, 0.0, 1.0); if (vY / uL > grow) discard; float rim = 1.0 - abs(dot(vN, vV)); float k = uA * (0.25 + 0.75 * rim * rim) * (1.0 - 0.7 * vY / uL) * (1.0 + 3.0 * exp(-max(0.0, uT - uT0 - uL / 299.79) / 0.6)); gl_FragColor = vec4(uC * k, 1.0); }',
    });
    m.userData.own = true;
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(a[0], a[1], a[2]);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(u[0], u[1], u[2]).normalize());
    put(mesh).renderOrder = order;
  }
  function arrow(phi, len, color, t0) {
    const grp = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    m.userData.own = true;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, len - 260, 16), m); shaft.position.y = (len - 260) / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(90, 260, 24), m); head.position.y = len - 130;
    grp.add(shaft, head); grp.rotation.z = phi - Math.PI / 2;
    grp.userData.fade = { m, t0 };
    for (const q of [shaft, head]) { q.frustumCulled = false; q.userData.own = false; }
    group.add(grp); objs.push({ geometry: { dispose() { shaft.geometry.dispose(); head.geometry.dispose(); } }, material: m, isArrow: true, grp });
    return grp;
  }
  // the two bunches and the beam line
  function bunches(info) {
    const pts = [], rnd = mulberry(7);
    for (const s of [-1, 1]) for (let i = 0; i < 360; i++) {
      const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(6.283 * rnd());
      pts.push([g() * 9, g() * 9, s, g() * 75, s > 0 ? 1.0 : 0.45, s > 0 ? 0.55 : 0.7, s > 0 ? 0.35 : 1.0, 5 + 3 * rnd()]);
    }
    const n = pts.length, A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4);
    pts.forEach((p, i) => {
      // a proton of beam s at z(t) = s c t + dz: written as a segment from t = -6 to t = 6 ns
      const zA = p[2] * C_MM * -6 + p[3], zB = p[2] * C_MM * 6 + p[3];
      A.set([p[0], p[1], -zA, -6], i * 4); B.set([p[0], p[1], -zB, 6], i * 4); C.set([p[4], p[5], p[6], p[7]], i * 4);
    });
    const g = quad(-1, 1);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4)); g.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 4));
    g.instanceCount = n;
    put(new THREE.Mesh(g, ptMat)).renderOrder = 13;
    // collision flashes: the hard vertex and the pile-up vertices
    const fl = (info.vertices || [[0, 0, 0, 0]]).map((v, i) => [v[0], v[1], v[2], v[3], 1, 0.85, 0.6, i ? 22 : 46, 0]);
    points(fl, 14);
  }

  // the crossing flash: a rim-lit shell that runs out from the hard vertex
  // over the first ns and fades (a visual mark of t = 0, not a physical front)
  const shock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), new THREE.ShaderMaterial({ uniforms: { uT: U.uT }, ...add, side: THREE.DoubleSide,
    vertexShader: 'uniform float uT; varying vec3 vN, vV; varying float vA; void main(){ float r = 40.0 + 2600.0 * (1.0 - exp(-max(0.0, uT) / 0.6)); vA = uT > 0.0 ? smoothstep(0.0, 0.08, uT) * exp(-uT / 0.9) : 0.0; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position * r, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vN, vV; varying float vA; void main(){ if (vA < 0.003) discard; float rim = 1.0 - abs(dot(vN, vV)); gl_FragColor = vec4(vec3(1.0, 0.86, 0.68) * vA * (0.04 + 1.1 * pow(rim, 3.0)), 1.0); }' }));
  shock.frustumCulled = false; shock.renderOrder = 15; group.add(shock);
  function show(R, O, info, opt = {}) {
    clear();
    meta = { R, O, info };
    const tm = tracks(R);
    tEnd = Math.min(32, Math.max(14, tm + 1));
    // hits
    const hits = [];
    // the lasting glow of a hit falls with the number of hits, as the tracks' gain does
    const hg = 0.55 * Math.max(0.12, Math.min(1, Math.sqrt(300 / Math.max(1, R.hits.n + R.mhits.n))));
    for (let i = 0; i < R.hits.n; i++) hits.push([R.hits.f[i * 6], R.hits.f[i * 6 + 1], R.hits.f[i * 6 + 2], R.hits.f[i * 6 + 3], 0.55, 0.95, 1.0, 5, hg]);
    for (let i = 0; i < R.mhits.n; i++) hits.push([R.mhits.f[i * 6], R.mhits.f[i * 6 + 1], R.mhits.f[i * 6 + 2], R.mhits.f[i * 6 + 3], 1.0, 0.45, 0.75, 9, Math.max(hg, 0.3)]);
    points(hits, 11);
    // decay and conversion vertices
    points(R.vtx.filter(v => v[4] !== 2 && Math.hypot(v[0], v[1]) < 1200).slice(0, 400).map(v => [v[0], v[1], v[2], v[3], 1, 1, 1, v[4] === 1 ? 7 : 5]), 11);
    // calorimeter cells
    const list = [];
    for (let c = 0; c < R.ecal.length; c++) { const e = R.ecal[c]; if (e < 250) continue; const [eta, phi] = cellCenter(ECAL, c); list.push({ eta, phi, deta: ECAL.deta, dphi: 2 * Math.PI / ECAL.nphi, E: e, t: R.ecalT[c], kind: 'ecal', depth: 0.25 + 0.75 * logU(e, 250, 60000) }); }
    for (let c = 0; c < R.hcalS.length; c++) { const e = R.hcalS[c] * KHCAL; if (e < 600) continue; const [eta, phi] = cellCenter(HCAL, c); list.push({ eta, phi, deta: HCAL.deta, dphi: 2 * Math.PI / HCAL.nphi, E: e, t: R.hcalT[c], kind: 'hcal', depth: 0.2 + 0.8 * logU(e, 600, 150000) }); }
    cells(list);
    // Cherenkov cones
    for (const c of R.cones.slice(0, opt.cones ?? 160)) cone([c[0], c[1], c[2]], [c[4], c[5], c[6]], 70, c[7], '#8fd0ff', 0.55, c[3], 7);
    // jets
    if (O) for (const j of O.jets.slice(0, 6)) {
      const th = 2 * Math.atan(Math.exp(-j.eta)), u = [Math.sin(th) * Math.cos(j.phi), Math.sin(th) * Math.sin(j.phi), Math.cos(th)];
      const L = Math.min(3000 / Math.max(0.2, Math.sin(th)), 4800 / Math.max(0.2, Math.abs(Math.cos(th))), 3600);
      cone([0, 0, 0], u, L, Math.min(0.5, 0.4 / Math.cosh(j.eta) + 0.05), '#ffd45c', 0.10 + 0.15 * Math.min(1, j.pT / 200000), 0.5, 4);
    }
    // MET
    if (O && O.met.et > 15000) arrow(O.met.phi, Math.min(5200, 1400 + O.met.et / 100000 * 2600), new THREE.Color(CLASS_COLOR.nu), 9);
    bunches(info || {});
    const v = (info && info.vertex) || [0, 0, 0]; shock.position.set(v[0], v[1], v[2]);
    // how much the event shakes the camera: the calorimeter energy, log scale
    let ec = 0; for (let c = 0; c < R.ecal.length; c++) ec += R.ecal[c]; for (let c = 0; c < R.hcalS.length; c++) ec += R.hcalS[c] * KHCAL;
    return { tEnd, energy: ec };
  }
  function setTime(t) {
    U.uT.value = t;
    for (const o of objs) if (o.isArrow) { const f = o.grp.userData.fade; f.m.opacity = Math.max(0, Math.min(0.9, (t - f.t0) / 3)); }
  }
  function frame(renderer) {
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    U.uRes.value.copy(sz); U.uPx.value = renderer.getPixelRatio();
  }
  return { group, show, setTime, frame, clear, setSel: k => { U.uSel.value = k; }, dim: k => { U.uDim.value = k; }, get tEnd() { return tEnd; }, get meta() { return meta; }, U };
}
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
