// ============================================================================
//  NUCLEAR BLAST  ·  blast.js — the detonation in the scene
// ----------------------------------------------------------------------------
//  createBlast(st) adds the burst to the stage. blast.set(burst) takes the
//  yield, height, wind and air; blast.update(t, dt) poses everything for
//  time t (s after the burst) from effects.js:
//
//    fireball .... a noise-shaded sphere, radius fireballRadius(t), colour
//                  a black body at fireballTemperature(t), brightness the
//                  thermal power over its area. It rises with the cloud.
//    flash ....... st.U.uFbPow / uFbCol / uFbPos light the ground and the
//                  city (glsl.js light()); the sky and the haze glow; the
//                  stage exposure closes (st.adaptIn).
//    shock ....... thin shells in st.dscene that bend the image (stage.js
//                  DistortPass), with a faint rim: the incident sphere, its
//                  ground reflection, and past the Mach stem range a stem
//                  that grows up from the ground (machStemRange()).
//    Wilson ...... in humid air a condensation dome, then a ring, for a
//                  second or two (wilsonWindow(), G&D 2.48-2.50).
//    cloud ....... CPU particles drawn as lit, sorted billboards: a rolling
//                  torus cap, a dome over it, the stem, and the dust raised
//                  behind the shock that the afterwinds pull back in. The
//                  cap rises with cloudTop(t) and drifts with the wind.
//    haze ........ heat shimmer over the fireball and the hot stem
//
//  GREP MAP
//    const FIREBALL_FS ...... the fireball surface
//    const SHELL_VS/FS ...... the shock shells (offset field and rim)
//    const PUFF_VS/FS ....... the cloud billboards
//    function cloudShape .... cap, stem and dust sizes at time t
//    function stepParticles . particle positions, colours, sorting
//    blast.update ........... everything for time t
// ============================================================================
import * as THREE from 'three';
import * as E from './effects.js';
import { NOISE, LIGHT, FOG, blackbody } from './glsl.js';

const KT_W = 4.184e12;   // W per kt/s
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ── fireball ─────────────────────────────────────────────────────────────
const FIREBALL_VS = /* glsl */`
varying vec3 vN; varying vec3 vW; varying vec3 vO;
void main(){ vO = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FIREBALL_FS = /* glsl */`
${NOISE}
uniform vec3 uCol; uniform float uRad; uniform float uClock; uniform float uCool; uniform float uAlpha; uniform float uExpo;
varying vec3 vN; varying vec3 vW; varying vec3 vO;
void main(){
  if (vW.y < -0.5) discard;
  vec3 V = normalize(cameraPosition - vW);
  float mu = clamp(dot(normalize(vN), V), 0.0, 1.0);
  float n = fbm3(vO * 3.0 + vec3(0.0, -uClock * 0.35, uClock * 0.2));
  float n2 = fbm3(vO * 9.0 + uClock * 0.6);
  // hot ball: limb darkened, a turbulent skin; cooling: dark smoke with hot gaps
  float lum = (0.55 + 0.45 * mu) * (0.75 + 0.5 * n) * (0.85 + 0.3 * n2);
  vec3 hot = uCol * uRad * lum;
  float gap = smoothstep(0.45, 0.75, n * 0.7 + n2 * 0.5);
  vec3 cool = vec3(0.09, 0.06, 0.05) * (0.6 + 0.6 * mu) + uCol * uRad * gap * 0.6;
  vec3 c = mix(hot, cool, uCool);
  gl_FragColor = vec4(min(c * uExpo, vec3(10.0)), uAlpha * mix(1.0, 0.85 + 0.15 * mu, uCool));
}`;

// ── shock shells: offset field (dscene) and faint rim (scene) ───────────
const SHELL_VS = /* glsl */`
varying vec3 vW; varying vec3 vNv; varying vec3 vNw;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vNw = normalize(mat3(modelMatrix) * normal); vNv = normalize(normalMatrix * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const SHELL_FS = /* glsl */`
uniform float uAmp; uniform float uRim; uniform vec3 uCenter2; uniform float uR2; uniform float uClip; uniform float uMode; uniform float uExpo; uniform vec3 uRimCol;
varying vec3 vW; varying vec3 vNv; varying vec3 vNw;
void main(){
  if (vW.y < 0.0) discard;
  // the reflected shell lies inside the incident one; the stem below its top
  if (uClip > 0.5 && length(vW - uCenter2) > uR2) discard;
  vec3 V = normalize(cameraPosition - vW);
  float mu = abs(dot(normalize(vNw), V));
  float limb = pow(1.0 - mu, 5.0);
  if (uMode < 0.5) {
    vec2 o = normalize(vNv.xy + 1e-5) * limb * uAmp;
    gl_FragColor = vec4(o, limb * uAmp * 6.0, 1.0);
  } else {
    gl_FragColor = vec4(min(uRimCol * limb * uRim * uExpo, vec3(10.0)), 1.0);
  }
}`;

// ── Wilson cloud ─────────────────────────────────────────────────────────
const WILSON_FS = /* glsl */`
${NOISE}
${LIGHT}
${FOG}
uniform float uA; uniform float uRing; uniform vec3 uC; uniform float uR;
varying vec3 vN; varying vec3 vW; varying vec3 vO;
void main(){
  if (vW.y < 0.0) discard;
  vec3 V = normalize(cameraPosition - vW);
  float mu = abs(dot(normalize(vN), V));
  float n = fbm3(vO * 5.0);
  // dome first, then a ring: the top clears as it warms (G&D 2.50)
  float hgt = (vW.y - uC.y) / uR;
  float ring = 1.0 - smoothstep(-0.1 + 0.9 * (1.0 - uRing), 0.25 + 0.75 * (1.0 - uRing), hgt);
  float a = uA * (0.25 + 0.75 * pow(1.0 - mu, 1.5)) * smoothstep(0.3, 0.7, n) * ring;
  vec3 col = light(vW, normalize(vN), vec3(0.85));
  gl_FragColor = vec4(outCol(fogMix(col, vW, cameraPosition)), clamp(a, 0.0, 0.9));
}`;

// ── cloud billboards ─────────────────────────────────────────────────────
const PUFF_VS = /* glsl */`
attribute vec4 iPos; attribute vec4 iCol; attribute vec4 iEm;
varying vec2 vUv; varying vec4 vCol; varying vec4 vEm; varying vec3 vW; varying vec3 vC; varying float vSize;
void main(){
  vUv = uv; vCol = iCol; vEm = iEm; vSize = iPos.w; vC = iPos.xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // turn each puff a little so the noise does not repeat
  float a = iEm.w * 6.2831; float c = cos(a), s = sin(a);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  vUv = q + 0.5;
  vec3 w = iPos.xyz + (right * position.x + up * position.y) * iPos.w;
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const PUFF_FS = /* glsl */`
${NOISE}
${LIGHT}
${FOG}
uniform sampler2D uPuff;
varying vec2 vUv; varying vec4 vCol; varying vec4 vEm; varying vec3 vW; varying vec3 vC; varying float vSize;
void main(){
  vec2 c = vUv * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float d = texture2D(uPuff, vUv).r;
  float a = d * vCol.a;
  // soft against the ground: fade the part of the puff near y = 0
  a *= smoothstep(0.0, vSize * 0.35, vW.y);
  if (a < 0.004) discard;
  // a ball-like normal, turned to the world. vCol.rgb already holds the
  // albedo times the self-shadow of the cloud (stepParticles).
  vec3 nv = vec3(c, sqrt(max(0.0, 1.0 - r2)));
  vec3 nw = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]) * nv.x + vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]) * nv.y + vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) * nv.z);
  vec3 amb = mix(uGndAmb, uSkyAmb, 0.5 + 0.5 * nw.y);
  vec3 toF = uFbPos - vC; float dF = max(length(toF), 1.0);
  vec3 fb = uFbCol * fbIrr(vC) * (0.35 + 0.65 * max(dot(nw, toF / dF), 0.0));
  vec3 col = vCol.rgb * (uSunCol * (0.3 + 0.7 * max(dot(nw, uSunDir), 0.0)) + amb + fb) * (0.7 + 0.3 * d);
  col += vEm.rgb * (0.4 + 0.6 * d);
  gl_FragColor = vec4(outCol(fogMix(col, vW, cameraPosition)), a);
}`;

// a 128 px atlas-free puff: soft round density with fbm holes
function puffTexture(n = 128) {
  const data = new Uint8Array(n * n), h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = x / n * 2 - 1, py = y / n * 2 - 1, r = Math.hypot(px, py);
    let f = 0, a = 0.5, s = 4;
    for (let k = 0; k < 5; k++) { f += a * vn(px * s + 9, py * s + 3); a *= 0.5; s *= 2.1; }
    // cauliflower lumps: the fbm eats into a round core
    const v = clamp((1 - r * r) * 1.7 - (1 - f) * 1.15, 0, 1);
    data[y * n + x] = Math.round(clamp(v, 0, 1) * 255);
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export function createBlast(st, o = {}) {
  const U = st.U, low = !!o.low;
  const lightU = { uSunDir: U.uSunDir, uSunCol: U.uSunCol, uSkyAmb: U.uSkyAmb, uGndAmb: U.uGndAmb, uFbPos: U.uFbPos, uFbCol: U.uFbCol, uFbPow: U.uFbPow, uTauL: U.uTauL, uFogCol: U.uFogCol, uFogDen: U.uFogDen, uFogFlash: U.uFogFlash, uExpo: U.uExpo };
  const root = new THREE.Group(); st.scene.add(root);
  const droot = new THREE.Group(); st.dscene.add(droot);

  // fireball
  const fbU = { uCol: { value: new THREE.Color(1, 1, 1) }, uRad: { value: 1 }, uClock: U.uClock, uCool: { value: 0 }, uAlpha: { value: 1 }, uExpo: U.uExpo };
  const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, low ? 48 : 96, low ? 24 : 48), new THREE.ShaderMaterial({ vertexShader: FIREBALL_VS, fragmentShader: FIREBALL_FS, uniforms: fbU, transparent: true }));
  fireball.renderOrder = 2;
  root.add(fireball);

  // shells: the same geometry in both scenes
  const shellGeo = new THREE.SphereGeometry(1, 96, 48), stemGeo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true).translate(0, 0.5, 0);
  const shell = (geo, mode, clip) => {
    const u = { uAmp: { value: 0 }, uRim: { value: 0 }, uCenter2: { value: new THREE.Vector3() }, uR2: { value: 1 }, uClip: { value: clip ? 1 : 0 }, uMode: { value: mode }, uExpo: U.uExpo, uRimCol: { value: new THREE.Color(0.9, 0.95, 1) } };
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: SHELL_VS, fragmentShader: SHELL_FS, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.frustumCulled = false; return m;
  };
  const S = {
    inc: [shell(shellGeo, 0, false), shell(shellGeo, 1, false)],
    ref: [shell(shellGeo, 0, true), shell(shellGeo, 1, true)],
    stem: [shell(stemGeo, 0, false), shell(stemGeo, 1, false)],
  };
  for (const k in S) { droot.add(S[k][0]); root.add(S[k][1]); }

  // Wilson cloud
  const wU = { ...lightU, uA: { value: 0 }, uRing: { value: 0 }, uC: { value: new THREE.Vector3() }, uR: { value: 1 } };
  const wilson = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({ vertexShader: FIREBALL_VS, fragmentShader: WILSON_FS, uniforms: wU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  wilson.renderOrder = 3; wilson.frustumCulled = false;
  root.add(wilson);

  // cloud particles
  const NP = { cap: low ? 560 : 1300, dome: low ? 140 : 320, stem: low ? 220 : 520, dust: low ? 240 : 520 };
  const N = NP.cap + NP.dome + NP.stem + NP.dust;
  const P = { role: new Uint8Array(N), a: new Float32Array(N), b: new Float32Array(N), c: new Float32Array(N), d: new Float32Array(N), s: new Float32Array(N), r0: new Float32Array(N), ta: new Float32Array(N), dur: new Float32Array(N) };
  let rs = 12345; const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  let k = 0;
  const put = (role, n) => { for (let i = 0; i < n; i++, k++) { P.role[k] = role; P.a[k] = rnd(); P.b[k] = rnd(); P.c[k] = rnd(); P.d[k] = rnd(); P.s[k] = rnd(); } };
  put(0, NP.cap); put(1, NP.dome); put(2, NP.stem); put(3, NP.dust);
  const quad = new THREE.PlaneGeometry(1, 1);
  const pgeo = new THREE.InstancedBufferGeometry();
  pgeo.setIndex(quad.index); pgeo.setAttribute('position', quad.attributes.position); pgeo.setAttribute('uv', quad.attributes.uv);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4), iCol = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4), iEm = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  for (const a of [iPos, iCol, iEm]) a.setUsage(THREE.DynamicDrawUsage);
  pgeo.setAttribute('iPos', iPos); pgeo.setAttribute('iCol', iCol); pgeo.setAttribute('iEm', iEm);
  pgeo.instanceCount = 0;
  const puffs = new THREE.Mesh(pgeo, new THREE.ShaderMaterial({ vertexShader: PUFF_VS, fragmentShader: PUFF_FS, uniforms: { ...lightU, uPuff: { value: puffTexture() } }, transparent: true, depthWrite: false }));
  puffs.frustumCulled = false; puffs.renderOrder = 4;
  root.add(puffs);
  const tmp = { pos: new Float32Array(N * 4), col: new Float32Array(N * 4), em: new Float32Array(N * 4), key: new Float32Array(N), idx: [] };

  // heat haze: a camera-facing disc over the fireball, in the offset field
  const hazeU = { uAmp: { value: 0 }, uClock: U.uClock };
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: hazeU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${NOISE}\nuniform float uAmp; uniform float uClock; varying vec2 vUv; varying vec3 vW;\nvoid main(){ if (vW.y < 0.0) discard; vec2 c = vUv * 2.0 - 1.0; float f = 1.0 - smoothstep(0.3, 1.0, length(c));\n vec2 q = vUv * 6.0 + vec2(0.0, -uClock * 1.5); vec2 o = vec2(vnoise2(q) - 0.5, vnoise2(q + 17.3) - 0.5);\n gl_FragColor = vec4(o * uAmp * f, 0.0, 1.0); }`,
  }));
  haze.frustumCulled = false;
  droot.add(haze);

  const B = { root, fireball, wilson, puffs, haze, shells: S, burst: null, info: {} };
  const col = [0, 0, 0];

  B.set = b => {
    const W = b.W, h = b.h, F = E.fireballSizes(W, h);
    B.burst = { ...b, F, tfm: E.tFireballMax(W), topF: E.cloudTopFinal(W), Rc: E.cloudRadius(W), surface: F.surface, xm: E.machStemRange(W, h), wil: E.wilsonWindow(W), lf: E.falloutShare(W, h) };
    // the dust ring: where the ground sees more than 3 psi
    const dm = E.rangeFor(3 * E.PSI, W, h) || F.max * 2;
    B.burst.dustMax = dm; B.burst.dustH = 0.04 * dm + 20;
    for (let i = 0; i < N; i++) if (P.role[i] === 3) {
      const r0 = Math.max(F.max * 0.3, dm * Math.sqrt(P.a[i]));
      P.r0[i] = r0; P.ta[i] = E.arrivalTime(r0, W, h); P.dur[i] = E.positiveDuration(r0, W, h);
    }
  };

  // cap, stem and dust at time t (metres, absolute heights)
  function cloudShape(t) {
    const b = B.burst, W = b.W, h = b.h, F = b.F;
    const rise = E.cloudTop(t, W, h), riseF = E.cloudTop(1e6, W, h), g = clamp(rise / Math.max(1, riseF), 0, 1);
    const Rfb = E.fireballRadius(t, W, h);
    const topAbs = Math.max(h + rise, h + Rfb);
    const Rm = Math.max(F.max * 0.95, b.Rc * 0.92 * Math.pow(g, 0.9)) * (1 + 0.25 * smooth(0.85, 1, g) * smooth(300, 900, t));
    const halfT = Math.max(F.max * 0.8, 0.13 * b.topF * g);
    const Yc = Math.max(h + Rfb * 0.2, topAbs - halfT);
    const form = smooth(b.tfm * 0.8, b.tfm * 4, t);                  // fireball -> cap
    const stemOn = smooth(b.tfm * 1.5, b.tfm * 8, t);
    const stemTop = Math.max(0, Math.min(Yc - halfT * 0.55, (t - b.tfm * 1.5) * Math.max(30, riseF / 300)));
    const surf = b.surface ? 1 : clamp(1 - (h - F.max) / (3 * F.max), 0.25, 1);
    return { Rfb, topAbs, Rm, halfT, Yc, form, stemOn, stemTop, surf, g, roll: 2.2 * Math.log(1 + t / b.tfm) };
  }

  // self-shadow of the cap: the side toward the sun is lit, the underside
  // and the core are darker (a cheap stand-in for light marching)
  const sun = new THREE.Vector3();
  function cloudShade(x, y, z, C, rho) {
    const dy = (y - C.Yc) * 1.6, l = Math.max(1, Math.hypot(x, dy, z));
    const s = (x * sun.x + dy * sun.y + z * sun.z) / l;
    const lit = 0.3 + 0.7 * smooth(-0.7, 0.8, s);
    const under = 0.55 + 0.45 * smooth(-1, 0.45, (y - C.Yc) / Math.max(1, C.halfT));
    return lit * under * (0.72 + 0.28 * rho);
  }
  const v3 = new THREE.Vector3(), camDir = new THREE.Vector3();
  function stepParticles(t, C) {
    sun.copy(U.uSunDir.value);
    const b = B.burst, W = b.W, h = b.h, F = b.F;
    const wx = Math.cos(b.windDir) * b.wind, wz = Math.sin(b.windDir) * b.wind;
    const cool = smooth(b.tfm * 1.2, b.tfm * 40, t);
    const Tc = E.fireballTemperature(t, W);
    blackbody(Tc, col);
    const glow = Math.min(40, Math.pow(Tc / 2000, 4) * 12) * (1 - cool * 0.97);
    // airburst caps go from a reddish brown (nitrogen oxides) to white as
    // water condenses; surface bursts carry soil and stay brown-grey
    const tw = smooth(5, 90 * Math.pow(W / 1000, 0.2), t);
    const airC = [0.55 + 0.23 * tw, 0.42 + 0.34 * tw, 0.36 + 0.38 * tw], dirtC = [0.40 + 0.12 * tw, 0.34 + 0.13 * tw, 0.29 + 0.13 * tw];
    const mixS = C.surf;
    const capC = [airC[0] * (1 - mixS) + dirtC[0] * mixS, airC[1] * (1 - mixS) + dirtC[1] * mixS, airC[2] * (1 - mixS) + dirtC[2] * mixS];
    const frontR = Math.sqrt(Math.max(0, E.shockRadius(t, W, b.surface) ** 2 - h * h));
    const dustMax = b.dustMax, dustH = b.dustH;
    const cam = st.camera.position; st.camera.getWorldDirection(camDir);
    let n = 0;
    for (let i = 0; i < N; i++) {
      const role = P.role[i], pa = P.a[i], pb = P.b[i], pc = P.c[i], pd = P.d[i], ps = P.s[i];
      let x, y, z, size, alpha, cr = capC[0], cg = capC[1], cb = capC[2], er = 0, eg = 0, eb = 0, shade = 1, rhoOut = 1;
      if (role === 0 || role === 1) {
        if (C.form <= 0.001) continue;
        const th = pa * Math.PI * 2;
        let rad, yy;
        if (role === 0) {
          const ph = pb * Math.PI * 2 - C.roll * (0.6 + 0.8 * pd), rho = Math.sqrt(0.25 + 0.75 * pc); rhoOut = rho;
          const R0 = C.Rm * 0.52, ar = C.Rm * 0.48;
          rad = R0 + ar * rho * Math.cos(ph); yy = C.Yc + C.halfT * 0.72 * rho * Math.sin(ph);
          size = C.Rm * (0.2 + 0.2 * ps);
          const inner = 1 - rho;
          er = col[0] * glow * (0.3 + inner); eg = col[1] * glow * (0.3 + inner); eb = col[2] * glow * (0.3 + inner);
        } else {
          const rho = Math.sqrt(pc);
          rad = C.Rm * 0.66 * rho; yy = C.Yc + C.halfT * (0.5 + 0.3 * (1 - rho * rho)) * (0.85 + 0.15 * pd);
          size = C.Rm * (0.22 + 0.16 * ps);
          er = col[0] * glow * 0.6; eg = col[1] * glow * 0.6; eb = col[2] * glow * 0.6;
        }
        x = rad * Math.cos(th); z = rad * Math.sin(th); y = Math.max(yy, size * 0.4);
        alpha = (role === 0 ? 0.42 : 0.36) * C.form;
        shade = cloudShade(x, y, z, C, role === 0 ? rhoOut : 0.6);
        // drift with the wind, more at the top
        const dr = t * clamp(y / b.topF, 0, 1) ** 0.5;
        x += wx * dr; z += wz * dr;
      } else if (role === 2) {
        if (C.stemOn <= 0.001 || C.stemTop < 5) continue;
        const s = (pa + t * 0.012 * (0.5 + pd)) % 1;          // the column flows up
        const yy = s * C.stemTop;
        const rr = C.Rm * (0.14 + 0.1 * s) * (0.5 + 0.5 * C.surf) * Math.sqrt(pc);
        const th = pb * Math.PI * 2 + t * 0.05;
        x = rr * Math.cos(th); z = rr * Math.sin(th); y = Math.max(yy, 10);
        size = C.Rm * (0.09 + 0.06 * s) * (0.6 + 0.6 * ps) * (0.6 + 0.4 * C.surf);
        alpha = 0.5 * C.stemOn * (0.4 + 0.6 * C.surf) * smooth(0, 0.08, s) * (1 - smooth(0.9, 1, s));
        cr = cr * 0.92; cg = cg * 0.9; cb = cb * 0.88;
        shade = 0.55 + 0.45 * Math.max(0, (x * sun.x + z * sun.z) / Math.max(1, Math.hypot(x, z)));
        const dr = t * clamp(y / b.topF, 0, 1) ** 0.5; x += wx * dr; z += wz * dr;
      } else {
        // dust raised behind the front, then pulled in by the afterwinds
        const r0 = P.r0[i], ta = P.ta[i];
        if (t < ta || r0 > frontR + 1) continue;
        const pull = Math.max(0, t - ta - 2 * P.dur[i]);
        const Tin = 90 * Math.cbrt(W / 1000) + 40;
        const r = r0 * Math.exp(-pull / Tin);
        const th = pb * Math.PI * 2;
        x = r * Math.cos(th); z = r * Math.sin(th);
        const grow = smooth(0, 8 + Math.cbrt(W) * 1.2, t - ta);
        size = dustH * (1.2 + 1.4 * ps) * (0.4 + 0.6 * grow) * (1 + 0.6 * (1 - r / r0));
        y = size * 0.42 + dustH * pc * grow;
        alpha = 0.42 * grow * smooth(0, dustMax * 0.08, r) * (0.5 + 0.5 * C.surf);
        cr = 0.52; cg = 0.46; cb = 0.38; shade = 0.85;
      }
      const j = n * 4;
      tmp.pos[j] = x; tmp.pos[j + 1] = y; tmp.pos[j + 2] = z; tmp.pos[j + 3] = size;
      tmp.col[j] = cr * shade; tmp.col[j + 1] = cg * shade; tmp.col[j + 2] = cb * shade; tmp.col[j + 3] = alpha;
      tmp.em[j] = er; tmp.em[j + 1] = eg; tmp.em[j + 2] = eb; tmp.em[j + 3] = ps;
      v3.set(x - cam.x, y - cam.y, z - cam.z);
      tmp.key[n] = v3.dot(camDir);
      n++;
    }
    // far to near
    const idx = tmp.idx; idx.length = n;
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((p, q) => tmp.key[q] - tmp.key[p]);
    const A = iPos.array, Cc = iCol.array, Em = iEm.array;
    for (let i = 0; i < n; i++) {
      const s = idx[i] * 4, d = i * 4;
      for (let c = 0; c < 4; c++) { A[d + c] = tmp.pos[s + c]; Cc[d + c] = tmp.col[s + c]; Em[d + c] = tmp.em[s + c]; }
    }
    pgeo.instanceCount = n;
    iPos.needsUpdate = iCol.needsUpdate = iEm.needsUpdate = true;
    iPos.clearUpdateRanges?.(); iCol.clearUpdateRanges?.(); iEm.clearUpdateRanges?.();
  }

  // pose everything for time t; armed (t < 0) hides the burst
  B.update = (t, dt) => {
    const b = B.burst;
    const on = !!b && t > 0;
    root.visible = on; droot.visible = on;
    if (!on) { U.uFbPow.value = 0; U.uFogFlash.value.setRGB(0, 0, 0); st.sky.material.uniforms.uFbGlow.value.setRGB(0, 0, 0); st.adaptIn = 0; B.info = {}; return; }
    const W = b.W, h = b.h, C = cloudShape(t);
    // fireball
    const R = C.Rfb, T = E.fireballTemperature(t, W);
    const yc = Math.max(h, Math.min(C.Yc, h + Math.max(0, C.topAbs - h - R)));
    const fbY = C.form > 0.5 ? C.Yc : yc;
    fireball.position.set(0, fbY, 0);
    const squash = 1 - 0.25 * C.form;
    fireball.scale.set(R, R * squash, R);
    blackbody(T, col);
    const Pkt = E.thermalPowerTotal(t, W), Pw = Pkt * KT_W;
    const M = Pw / (4 * Math.PI * R * R) / 1000;                      // exitance in suns
    fbU.uCol.value.setRGB(col[0], col[1], col[2]);
    const cool = smooth(b.tfm * 1.5, b.tfm * 25, t);
    fbU.uRad.value = Math.max(M, Math.min(60, Math.pow(T / 2000, 4) * 14));
    fbU.uCool.value = cool;
    fbU.uAlpha.value = 1 - smooth(b.tfm * 3, b.tfm * 12, t);
    fireball.visible = fbU.uAlpha.value > 0.01;
    // the light: thermal power, plus the glow of the hot cloud
    U.uFbPos.value.set(0, fbY, 0);
    U.uFbCol.value.setRGB(col[0], col[1], col[2]);
    U.uFbPow.value = Pw / (4 * Math.PI) / 1000;
    // the eye: irradiance at the camera target, plus glare if the ball is in view
    const tgt = st.controls.target, dT = Math.max(1, Math.hypot(tgt.x, tgt.y - fbY, tgt.z)), dC = Math.max(1, st.camera.position.distanceTo(U.uFbPos.value));
    const tau = Math.exp(-dT / U.uTauL.value);
    st.adaptIn = U.uFbPow.value / (dT * dT) * tau * 0.6 + U.uFbPow.value / (dC * dC) * Math.exp(-dC / U.uTauL.value) * 0.4;
    // sky and haze glow around the burst
    const sg = st.sky.material.uniforms;
    sg.uFbDir.value.set(0, fbY, 0).sub(st.camera.position).normalize();
    const glowE = Math.min(4e3, U.uFbPow.value / (dC * dC) * Math.exp(-dC / U.uTauL.value));
    sg.uFbGlow.value.setRGB(col[0], col[1], col[2]).multiplyScalar(glowE * 0.6);
    U.uFogFlash.value.setRGB(col[0], col[1], col[2]).multiplyScalar(Math.min(2e3, glowE * 0.08));
    // shock shells
    const Rs = E.shockRadius(t, W, b.surface);
    const pf = E.psi(E.freeAir1kt(Rs / Math.cbrt(b.surface ? 2 * W : W)));
    const amp = clamp(Math.log10(pf + 1) / 1.6, 0, 1) * 0.012 * (st.lowQ ? 0.7 : 1);
    const rimA = clamp(Math.log10(pf + 1) / 2, 0, 1) * 0.25 * Math.max(1, Math.min(30, st.todSpec.level * 3 + 0.2));
    const center = b.surface ? 0 : h;
    for (const m of S.inc) { m.position.set(0, center, 0); m.scale.setScalar(Rs); m.visible = Rs > R * 1.05; }
    S.inc[0].material.uniforms.uAmp.value = amp; S.inc[1].material.uniforms.uRim.value = rimA;
    const showRef = !b.surface && Rs > h;
    for (const m of S.ref) { m.position.set(0, -h, 0); m.scale.setScalar(Rs); m.visible = showRef; m.material.uniforms.uCenter2.value.set(0, h, 0); m.material.uniforms.uR2.value = Rs; }
    S.ref[0].material.uniforms.uAmp.value = amp * 0.8; S.ref[1].material.uniforms.uRim.value = rimA * 0.8;
    const rFront = showRef ? Math.sqrt(Rs * Rs - h * h) : Rs;
    const machOn = showRef && rFront > b.xm;
    // triple point height: grows from 0 at the Mach stem range (illustrative)
    const ytp = machOn ? Math.min(Rs * 0.6, 0.55 * h * Math.pow((rFront - b.xm) / (b.xm + 2 * h), 1.25)) : 0;
    for (const m of S.stem) { m.scale.set(rFront, Math.max(1, ytp), rFront); m.visible = machOn && ytp > 1; }
    S.stem[0].material.uniforms.uAmp.value = amp * 1.3; S.stem[1].material.uniforms.uRim.value = rimA * 1.5;
    // Wilson cloud
    const wl = b.wil, hum = b.humid ?? 0;
    const wt = (t - wl.t0) / wl.life;
    if (hum > 0.02 && wt > 0 && wt < 1) {
      const R0 = E.shockRadius(wl.t0, W, b.surface);
      wilson.visible = true;
      wilson.position.set(0, center, 0); wilson.scale.setScalar(R0 * (1 + 0.15 * wt));
      wU.uA.value = hum * Math.sin(Math.PI * Math.min(1, wt * 1.6)) ** 0.7 * (1 - smooth(0.6, 1, wt));
      wU.uRing.value = smooth(0.15, 0.85, wt);
      wU.uC.value.set(0, center, 0); wU.uR.value = R0;
    } else wilson.visible = false;
    // heat haze over the fireball and the young stem
    haze.position.set(0, fbY + R * 0.4, 0); haze.scale.setScalar(R * 3.2);
    haze.quaternion.copy(st.camera.quaternion);
    hazeU.uAmp.value = 0.006 * (1 - smooth(b.tfm * 20, b.tfm * 120, t));
    stepParticles(t, C);
    B.info = { R, T, Rs, rFront, pf, machOn, ytp, P: Pkt, top: C.topAbs, cap: C.Rm, fbY };
  };
  B.dispose = () => { st.scene.remove(root); st.dscene.remove(droot); };
  return B;
}
