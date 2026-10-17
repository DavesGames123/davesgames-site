// ============================================================================
//  CORAL REEF  ·  the three.js scene (r160, ES module)
// ----------------------------------------------------------------------------
//  One instanced sphere per polyp. The instance matrix holds the place and
//  the radius. Two instance attributes hold the rest:
//    aInfo = (birth time s, global index, sway code, height over the base)
//    aCol  = (natural r g b, colour t)
//  The vertex shader scales a new polyp in from its birth time and sways
//  soft corals and fans with the current. The fragment shader takes the
//  colour from the natural rgb or from a gradient row texture (uLut), so a
//  gradient change writes 256 texels and nothing else.
//
//  The water: a gradient sky dome, depth fog (the fog colour gets darker
//  with depth), animated caustics on the sand, the rocks and the corals,
//  light shafts (camera-facing planes, additive) and marine snow (points
//  that drift with the same current as the walkers of the growth model).
//
//  grep -n targets
//    shared GLSL (fog, caustics) ... "const WATER_GLSL"
//    coral material ................ "function coralMaterial"
//    sand and rocks ................ "function groundMaterial"
//    rocks ......................... "function rockMesh"
//    marine snow ................... "function makeSnow"
//    light shafts .................. "function makeShafts"
//    polyp buffers ................. "function writePolyp"
//    the scene object .............. "export function createScene"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sandY } from './reef.js';

export const SURFACE_Y = 120;

const WATER_GLSL = /* glsl */`
uniform float uTime, uCaust, uFogDen;
uniform vec3 uFogDeep, uFogShallow;
uniform vec2 uCur;
// Caustics: a sine lattice, warped three times by itself. The light lines
// are where the lattice product is near zero. Our own small function.
float caustic(vec2 p, float t) {
  float c = 0.0; vec2 q = p;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += vec2(sin(q.y * 0.9 + t * (0.55 + 0.2 * fi) + fi * 1.7), cos(q.x * 0.8 - t * (0.5 + 0.15 * fi) + fi * 2.3)) * 0.55;
    vec2 s = sin(q * (1.3 + 0.35 * fi));
    c += 0.07 / (abs(s.x * s.y) + 0.07);
  }
  c /= 3.0;
  return c * c;
}
float causticAt(vec3 w, vec3 n) {
  if (uCaust < 0.5) return 0.0;
  vec2 drift = uCur * uTime * 0.6;
  float a = caustic(w.xz * 0.11 + drift * 0.11 + w.y * 0.015, uTime * 0.9);
  float up = clamp(n.y * 0.75 + 0.25, 0.0, 1.0);
  float depth = clamp(1.0 - (${SURFACE_Y.toFixed(1)} - w.y) / 260.0, 0.25, 1.0);
  return a * up * depth;
}
vec3 fogCol(float y) { return mix(uFogDeep, uFogShallow, clamp((y + 20.0) / 170.0, 0.0, 1.0)); }
vec3 underwater(vec3 col, vec3 w) {
  float d = length(w - cameraPosition);
  col *= exp(-d * uFogDen * vec3(0.55, 0.2, 0.12));       // water takes the red first
  float f = exp(-d * uFogDen);
  return mix(fogCol(mix(w.y, cameraPosition.y, 0.5)), col, f);
}`;

function waterUniforms(U) {
  return {
    uTime: U.uTime, uCaust: U.uCaust, uFogDen: U.uFogDen, uFogDeep: U.uFogDeep, uFogShallow: U.uFogShallow, uCur: U.uCur,
  };
}

function coralMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign(waterUniforms(U), { uLut: U.uLut, uMode: U.uMode, uCount: U.uCount, uBleach: U.uBleach, uSwayK: U.uSwayK }),
    vertexShader: /* glsl */`
      attribute vec4 aInfo;
      attribute vec4 aCol;
      uniform float uTime, uCount, uMode, uSwayK;
      uniform vec2 uCur;
      varying vec3 vN, vW, vNat;
      varying float vT, vGlow;
      void main() {
        float age = uTime - aInfo.x;
        float g = clamp(age / 0.8, 0.0, 1.0);
        float s = g * g * (3.0 - 2.0 * g) * (1.0 + 0.3 * sin(g * 3.14159));
        vec4 w = modelMatrix * instanceMatrix * vec4(position * s, 1.0);
        // sway: the code is floor(amplitude * 8) + phase / (2 pi)
        float amp = floor(aInfo.z) / 8.0, ph = fract(aInfo.z) * 6.2832;
        float h = aInfo.w;
        float wave = sin(uTime * 1.05 + ph - h * 0.07) + 0.35 * sin(uTime * 2.3 + ph * 1.7 - h * 0.11);
        vec2 dir = normalize(uCur + vec2(0.0001)) * 0.8 + vec2(cos(ph), sin(ph)) * 0.35;
        w.xz += dir * wave * amp * uSwayK * pow(h * 0.045, 1.5);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vNat = pow(aCol.rgb, vec3(2.2));
        vT = (uMode > 0.5 && uMode < 1.5) ? aInfo.y / max(1.0, uCount - 1.0) : aCol.w;
        vGlow = exp(-max(age, 0.0) / 1.3);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${WATER_GLSL}
      uniform sampler2D uLut;
      uniform float uMode, uBleach;
      varying vec3 vN, vW, vNat;
      varying float vT, vGlow;
      void main() {
        vec3 n = normalize(vN);
        vec3 lutC = texture2D(uLut, vec2(clamp(vT, 0.0, 1.0) * 0.992 + 0.004, 0.5)).rgb;
        vec3 base = uMode < 0.5 ? vNat : lutC;
        float bl = uMode < 0.5 ? uBleach : uBleach * 0.35;
        base = mix(base, vec3(0.86, 0.86, 0.82), bl * 0.88);
        vec3 L = normalize(vec3(0.25, 1.0, 0.18));
        float dif = pow(clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0), 1.6);
        vec3 hemi = mix(vec3(0.05, 0.09, 0.13), vec3(0.32, 0.48, 0.58), n.y * 0.5 + 0.5);
        float ca = causticAt(vW, n);
        vec3 col = base * (hemi * 0.9 + dif * vec3(0.9, 0.97, 1.0) * 1.05 + ca * vec3(0.85, 1.0, 1.0) * 1.1);
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        col += rim * 0.10 * vec3(0.45, 0.75, 0.85);
        vec3 hot = uMode < 0.5 ? mix(vNat, vec3(1.0, 0.9, 0.75), 0.6) : texture2D(uLut, vec2(0.995, 0.5)).rgb;
        col += hot * vGlow * 1.1 * (1.0 - uBleach);
        gl_FragColor = vec4(underwater(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function groundMaterial(U, rock) {
  return new THREE.ShaderMaterial({
    uniforms: waterUniforms(U),
    vertexShader: /* glsl */`
      varying vec3 vN, vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${WATER_GLSL}
      varying vec3 vN, vW;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec3 n = normalize(vN);
        float nz = vnoise(vW.xz * 0.35) * 0.6 + vnoise(vW.xz * 1.7) * 0.4;
        ${rock ? `
        float sp = vnoise(vW.xz * 2.3 + vW.y * 1.7) * 0.5 + vnoise(vec2(vW.x + vW.y, vW.z) * 0.6) * 0.5;
        vec3 base = mix(vec3(0.16, 0.17, 0.15), vec3(0.36, 0.34, 0.28), sp);
        base = mix(base, vec3(0.20, 0.28, 0.16), smoothstep(0.55, 0.9, n.y) * 0.6 * nz);  // turf algae on top
        ` : `
        float rip = sin(dot(vW.xz, vec2(0.62, 0.38)) * 1.6 + nz * 5.0) * 0.5 + 0.5;
        vec3 base = mix(vec3(0.62, 0.56, 0.42), vec3(0.80, 0.74, 0.58), nz);
        base *= 0.86 + 0.14 * rip;
        `}
        vec3 L = normalize(vec3(0.25, 1.0, 0.18));
        float dif = clamp(dot(n, L), 0.0, 1.0);
        float ca = causticAt(vW, n);
        vec3 col = base * (vec3(0.16, 0.24, 0.30) + dif * vec3(0.62, 0.72, 0.76) + ca * vec3(0.9, 1.0, 1.0) * 1.25);
        gl_FragColor = vec4(underwater(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// A rock {x, z, r, h, base}: an ellipsoid with radii (r, h, r) at
// (x, base, z), with some noise. Its top follows rockY of reef.js.
function rockMesh(rk, mat, seed) {
  const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.07 * Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 - seed) + 0.04 * Math.sin(y * 9.0 + x * 3.0);
    p.setXYZ(i, x * k, y * (y > 0 ? Math.min(k, 1) : k), z * k);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.scale.set(rk.r, rk.h, rk.r); m.position.set(rk.x, rk.base, rk.z);
  m.rotation.y = seed;
  return m;
}

function makeSnow(U, n) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p[i * 3] = (Math.random() - 0.5) * 240; p[i * 3 + 1] = Math.random() * 130 - 5; p[i * 3 + 2] = (Math.random() - 0.5) * 240;
    s[i] = 0.5 + Math.random() * Math.random() * 1.8;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: Object.assign(waterUniforms(U), { uOff: U.uSnowOff, uScale: U.uPxScale }),
    vertexShader: /* glsl */`
      attribute float aSize;
      uniform vec3 uOff; uniform float uTime, uScale;
      varying float vA;
      void main() {
        vec3 box = vec3(240.0, 130.0, 240.0), lo = vec3(-120.0, -5.0, -120.0);
        vec3 q = lo + mod(position + uOff - lo, box);
        q.x += sin(uTime * 0.7 + position.y) * 0.6; q.z += cos(uTime * 0.6 + position.x) * 0.6;
        vec4 mv = viewMatrix * vec4(q, 1.0);
        gl_PointSize = aSize * uScale / max(1.0, -mv.z);
        float d = length(mv.xyz);
        vA = exp(-d * 0.008) * smoothstep(-5.0, 4.0, q.y) * smoothstep(125.0, 100.0, q.y);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r = dot(c, c);
        if (r > 0.25) discard;
        gl_FragColor = vec4(vec3(0.75, 0.9, 0.95) * (1.0 - r * 4.0) * vA * 0.42, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return pts;
}

function makeShafts(U, n) {
  const grp = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: U.uTime, uShaft: U.uShaft },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vSeed;
      void main() { vUv = uv; vSeed = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uShaft;
      varying vec2 vUv; varying float vSeed;
      void main() {
        float x = vUv.x - 0.5;
        float edge = exp(-x * x * 14.0);
        float flick = 0.6 + 0.4 * sin(uTime * 0.45 + vSeed * 9.0) * sin(uTime * 0.31 + vSeed * 3.0 + vUv.x * 4.0);
        float fade = smoothstep(0.0, 0.55, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
        gl_FragColor = vec4(vec3(0.42, 0.68, 0.72) * edge * fade * flick * 0.10 * uShaft, 1.0);
      }`,
  });
  const geo = new THREE.PlaneGeometry(14, 170); geo.translate(0, 70, 0);
  const inst = new THREE.InstancedMesh(geo, mat, n);
  inst.frustumCulled = false;
  const pos = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + Math.random(), r = 20 + Math.random() * 70; pos.push([Math.cos(a) * r, Math.sin(a) * r, 0.7 + Math.random() * 0.8]); }
  grp.add(inst);
  return { grp, inst, pos };
}

// ── polyp buffers ───────────────────────────────────────────────────────────
const M4 = new THREE.Matrix4();
function writePolyp(C, g, x, y, z, r) {
  M4.makeScale(r, r, r); M4.setPosition(x, y, z);
  M4.toArray(C.mesh.instanceMatrix.array, g * 16);
}

export function createScene({ canvas, cap, coarse, onNoGL }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
  } catch (e) { if (onNoGL) onNoGL(e); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 1400);
  camera.position.set(110, 70, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.target.set(0, 12, 0);
  controls.minDistance = 25; controls.maxDistance = 420;
  controls.maxPolarAngle = 1.5; controls.enablePan = true; controls.screenSpacePanning = true;
  controls.rotateSpeed = coarse ? 0.6 : 0.8;

  const lutData = new Uint8Array(256 * 4);
  const lutTex = new THREE.DataTexture(lutData, 256, 1, THREE.RGBAFormat);
  lutTex.colorSpace = THREE.SRGBColorSpace; lutTex.magFilter = THREE.LinearFilter; lutTex.minFilter = THREE.LinearFilter;
  lutTex.needsUpdate = true;

  const U = {
    uTime: { value: 0 }, uCaust: { value: 1 }, uFogDen: { value: 0.0042 },
    uFogDeep: { value: new THREE.Color('#02131f') }, uFogShallow: { value: new THREE.Color('#1d6f86') },
    uCur: { value: new THREE.Vector2(1, 0) }, uLut: { value: lutTex }, uMode: { value: 0 },
    uCount: { value: 1 }, uBleach: { value: 0 }, uSwayK: { value: 1 }, uSnowOff: { value: new THREE.Vector3() },
    uPxScale: { value: 300 }, uShaft: { value: 1 },
  };

  // sky dome: the surface glow above, the fog colour at the horizon, deep below
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uFogDeep: U.uFogDeep, uFogShallow: U.uFogShallow, uTime: U.uTime },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec3 uFogDeep, uFogShallow; uniform float uTime; varying vec3 vD;
      void main() {
        float y = vD.y;
        vec3 c = mix(uFogDeep, uFogShallow, smoothstep(-0.35, 0.25, y));
        c = mix(c, vec3(0.42, 0.78, 0.86), smoothstep(0.35, 1.0, y) * 0.75);
        float sun = pow(max(0.0, dot(vD, normalize(vec3(0.2, 1.0, 0.15)))), 24.0);
        c += vec3(0.5, 0.75, 0.75) * sun * (0.75 + 0.25 * sin(uTime * 0.8));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -1;
  scene.add(sky);

  // seabed
  const sandMat = groundMaterial(U, false), rockMat = groundMaterial(U, true);
  const N = coarse ? 160 : 240, S = 1600;
  const sg = new THREE.PlaneGeometry(S, S, N, N); sg.rotateX(-Math.PI / 2);
  { const p = sg.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, sandY(p.getX(i), p.getZ(i))); sg.computeVertexNormals(); }
  const sand = new THREE.Mesh(sg, sandMat);
  scene.add(sand);
  const rocks = new THREE.Group(); scene.add(rocks);

  // polyps
  const geo = new THREE.IcosahedronGeometry(1, coarse ? 1 : 2);
  const mat = coralMaterial(U);
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.count = 0; mesh.frustumCulled = false;
  const aInfo = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  aInfo.setUsage(THREE.DynamicDrawUsage); aCol.setUsage(THREE.DynamicDrawUsage); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aInfo', aInfo); geo.setAttribute('aCol', aCol);
  scene.add(mesh);
  const C = { mesh, aInfo, aCol };

  const snow = makeSnow(U, coarse ? 900 : 2400); scene.add(snow);
  const shafts = makeShafts(U, coarse ? 6 : 10); scene.add(shafts.grp);

  function setRocks(list) {
    for (const m of rocks.children.slice()) { rocks.remove(m); m.geometry.dispose(); }
    list.forEach((rk, i) => rocks.add(rockMesh(rk, rockMat, i * 1.37 + rk.x * 0.01)));
  }
  function addRock(rk) { rocks.add(rockMesh(rk, rockMat, rocks.children.length * 1.37)); }

  function setLut(bytes) { lutData.set(bytes); lutTex.needsUpdate = true; }

  // Write polyps from..to: place, radius, birth, sway, height, colour.
  // rad, nat, t: arrays in global order (nat rgb, may be null for a guess).
  function writePolyps(reef, from, to, rad, nat, t, natGuess) {
    const I = aInfo.array, K = aCol.array;
    for (let g = from; g < to; g++) {
      const c = reef.colonies[reef.col[g]];
      writePolyp(C, g, reef.px[g], reef.py[g], reef.pz[g], rad[g]);
      I[g * 4] = reef.birth[g] / 1000; I[g * 4 + 1] = g;
      I[g * 4 + 2] = Math.floor(c.sp.sway * 8) + ((c.k * 0.381966) % 1) * 0.999;
      I[g * 4 + 3] = reef.py[g] - c.user.by;
      if (nat) { K[g * 4] = nat[g * 3]; K[g * 4 + 1] = nat[g * 3 + 1]; K[g * 4 + 2] = nat[g * 3 + 2]; }
      else { const q = natGuess(c); K[g * 4] = q[0]; K[g * 4 + 1] = q[1]; K[g * 4 + 2] = q[2]; }
      K[g * 4 + 3] = t[g];
    }
    mesh.count = reef.count;
    mesh.instanceMatrix.needsUpdate = true; aInfo.needsUpdate = true; aCol.needsUpdate = true;
  }
  function writeT(t, n) {
    const K = aCol.array; for (let g = 0; g < n; g++) K[g * 4 + 3] = t[g];
    aCol.needsUpdate = true;
  }

  const view = { ox: 0, oy: 0, tox: 0, toy: 0 };
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    U.uPxScale.value = h * renderer.getPixelRatio() * 0.35;
    camera.updateProjectionMatrix();
  }

  const tmpQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  function render(dt) {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const k = 1 - Math.exp(-dt * 6);
    view.ox += (view.tox - view.ox) * k; view.oy += (view.toy - view.oy) * k;
    if (Math.abs(view.ox) > 0.5 || Math.abs(view.oy) > 0.5) camera.setViewOffset(w, h, view.ox, view.oy, w, h);
    else camera.clearViewOffset();
    // shafts face the camera about the vertical axis
    const az = Math.atan2(camera.position.x, camera.position.z);
    tmpQ.setFromAxisAngle(up, az);
    shafts.pos.forEach((p, i) => { M4.compose(new THREE.Vector3(p[0], -5, p[1]), tmpQ, new THREE.Vector3(p[2], 1, 1)); shafts.inst.setMatrixAt(i, M4); });
    shafts.inst.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, controls, U, sand, setRocks, addRock, setLut, writePolyps, writeT, resize, render, view, mesh, THREE };
}
