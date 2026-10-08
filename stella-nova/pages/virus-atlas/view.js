// ============================================================================
//  VIRUS ATLAS  ·  view.js — the three.js view: bead impostors on the GPU
// ----------------------------------------------------------------------------
//  One "part" is one PDB entry on screen: its asymmetric unit (AU) as one
//  bead per residue, and its copy operators. The GPU does the expansion:
//  instance i draws bead (i mod nb) * stride of copy floor(i / nb). Three
//  float textures hold the data, so a part costs a few MB at most and an
//  animation never rebuilds geometry:
//    uBeads   RGBA32F per bead: x y z (nm, AU frame), w = chain + 4096 flags
//    uOps     RGBA32F, 3 texels per copy: the rows of a 3x4 operator
//    uUnits   RGBA32F, 2 texels per unit (copy k, chain c -> k nChains + c):
//             centroid + assembly delay, then flight direction + sway phase
//    uChainCol RGBA8 per chain: colour, alpha 0 hides the chain
//  Each bead is a camera-facing quad with a sphere drawn in the fragment
//  shader (normal, depth, light, rim, fog). The vertex shader moves whole
//  units for the assembly (uAsm), explode, peel and breathing, and bends
//  spikes for the sway; a fragment test cuts the slice.
//
//  OTHER OBJECTS  membrane shell (an illustration), spike stalks, the
//  symmetry axes with 5-, 3- and 2-fold markers, a soft dust field.
//
//  MEMORY  The canvas follows budget.js canvasBudget (no render targets,
//  no MSAA at a pixel ratio of 1.5 or more). dispose() frees every
//  texture, geometry and material and loses the WebGL context; main.js
//  calls it on pagehide.
//
//  grep -n targets: "const BEAD_VS", "const BEAD_FS", "export function createView",
//    "function makePart", "function setColors", "function makeMembrane",
//    "function makeAxes", "function makeStalks", "const PAL"
// ============================================================================
import * as THREE from 'three';
import { unitCentroids, assemblyDelays, explodeDirs, axesOf, ASM_SPREAD } from './symmetry.js';
import { canvasBudget } from './budget.js';
import { ROW, packBeads, packOps, packUnits } from './pack.js';

const W = ROW;   // texture row width

const BEAD_VS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uBeads, uOps, uUnits, uChainCol;
uniform int uNB, uStride, uNChains, uColMode, uHiK, uNCopies;
uniform float uRad, uAsm, uSpread, uFly, uJitter, uExplode, uPeelD, uPeelW, uPeelOn,
  uSliceD, uSliceOn, uBreath, uTime, uSway, uSwayH, uSwayBase, uDim, uRadialR, uFade;
uniform vec3 uPeelN, uSliceN, uOffset;
out vec2 vUV; out vec3 vCol; out vec3 vVC; out float vR; out float vClip; out float vShade;

vec4 fetchT(sampler2D t, int i) { return texelFetch(t, ivec2(i & 2047, i >> 11), 0); }
float hash(int n) { return fract(sin(float(n % 100003) * 12.9898 + float(n / 100003) * 78.233) * 43758.5453); }
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
vec3 radial(float t) {
  // deep blue -> teal -> straw -> warm white, the radial colour of capsid maps
  vec3 a = vec3(0.13, 0.22, 0.62), b = vec3(0.16, 0.66, 0.74), c = vec3(0.93, 0.80, 0.45), d = vec3(1.0, 0.95, 0.88);
  return t < 0.4 ? mix(a, b, t / 0.4) : t < 0.8 ? mix(b, c, (t - 0.4) / 0.4) : mix(c, d, (t - 0.8) / 0.2);
}
void main() {
  int i = gl_InstanceID;
  int k = i / uNB;
  int b = (i - k * uNB) * uStride;
  vec4 bd = fetchT(uBeads, b);
  int code = int(bd.w + 0.5);
  int ch = code & 4095, fl = code >> 12, cls = (fl >> 2) & 7, ss = fl & 3;
  int u = k * uNChains + ch;
  vec4 U0 = fetchT(uUnits, 2 * u), U1 = fetchT(uUnits, 2 * u + 1);
  vec4 r0 = fetchT(uOps, 3 * k), r1 = fetchT(uOps, 3 * k + 1), r2 = fetchT(uOps, 3 * k + 2);
  vec3 p = bd.xyz;
  if (uSway > 0.0) {
    // a spike bends on its stalk: more at the top, phase per copy
    float h = clamp((p.y - uSwayBase) / uSwayH, 0.0, 1.4);
    vec2 bend = uSway * vec2(sin(uTime * 0.83 + U1.w), sin(uTime * 0.61 + 1.7 * U1.w));
    p.xz += bend * h * h * uSwayH;
  }
  vec3 w = vec3(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w);
  vec3 c = U0.xyz, dir = U1.xyz;
  float a = clamp((uAsm - U0.w * uSpread) / (1.0 - uSpread), 0.0, 1.0);
  float e = a < 0.5 ? 4.0 * a * a * a : 1.0 - pow(-2.0 * a + 2.0, 3.0) / 2.0;
  vec3 off = dir * ((1.0 - e) * uFly + uExplode);
  vec3 jv = vec3(hash(b * 3 + k * 7919 + 1), hash(b * 3 + k * 7919 + 2), hash(b * 3 + k * 7919 + 3)) - 0.5;
  off += jv * uJitter * (1.0 - e) * (1.0 - e);
  float s = 0.0;
  if (uPeelOn > 0.5) { s = smoothstep(uPeelD, uPeelD + uPeelW, dot(c, uPeelN)); off += dir * s * uRadialR * 0.7; }
  w += off + c * uBreath;
  vec4 cc = fetchT(uChainCol, ch);
  float rad = uRad * (cls == 6 ? 0.72 : 1.0) * smoothstep(0.0, 0.2, e) * (1.0 - s) * uFade;
  if (cc.a < 0.5) rad = 0.0;
  vec3 col = cc.rgb;
  if (uColMode == 1) col = hsv(fract(float(k) * 0.618034 + 0.08), 0.5, 0.95);
  else if (uColMode == 2) col = ss == 1 ? vec3(0.93, 0.36, 0.45) : ss == 2 ? vec3(0.98, 0.80, 0.30) : vec3(0.62, 0.68, 0.78);
  else if (uColMode == 3) col = cls == 0 ? vec3(0.92, 0.90, 0.84) : cls == 1 ? vec3(0.45, 0.80, 0.55) : cls == 2 ? vec3(0.35, 0.55, 0.98)
    : cls == 3 ? vec3(0.95, 0.35, 0.32) : cls == 4 ? vec3(0.62, 0.62, 0.66) : cls == 5 ? vec3(1.0, 0.62, 0.25) : vec3(0.85, 0.95, 0.80);
  else if (uColMode == 4) col = radial(clamp((length(w - c * uBreath) / uRadialR - 0.45) / 0.55, 0.0, 1.0));
  if (cls == 6 && uColMode != 3) col = vec3(0.86, 0.95, 0.78);
  if (cls == 5 && uColMode != 3) col = vec3(1.0, 0.63, 0.28);
  if (uHiK >= 0 && k != uHiK) col *= uDim;
  else if (uHiK >= 0) col = mix(col, vec3(1.0), 0.18);
  vCol = col;
  vShade = mix(0.5, 1.0, smoothstep(0.35, 1.0, length(w) / max(uRadialR, 1e-3)));
  vec3 world = w + uOffset;
  vClip = uSliceOn > 0.5 ? dot(w, uSliceN) - uSliceD : -1.0;
  vec4 vc = modelViewMatrix * vec4(world, 1.0);
  vVC = vc.xyz; vR = rad;
  vec3 q = vc.xyz + vec3(position.xy * rad * 1.08, rad);
  gl_Position = projectionMatrix * vec4(q, 1.0);
  vUV = position.xy * 1.08;
}`;

const BEAD_FS = /* glsl */`
precision highp float;
uniform mat4 projectionMatrix;
uniform vec3 uBg; uniform vec2 uFog; uniform float uSliceOn;
in vec2 vUV; in vec3 vCol; in vec3 vVC; in float vR; in float vClip; in float vShade;
out vec4 outColor;
void main() {
  if (vClip > 0.0 || vR <= 0.0) discard;
  float r2 = dot(vUV, vUV);
  if (r2 > 1.0) discard;
  float z = sqrt(1.0 - r2);
  vec3 n = vec3(vUV, z);
  vec3 vp = vVC + n * vR;
  vec4 cp = projectionMatrix * vec4(vp, 1.0);
  gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.45, 0.65, 0.62)), F = normalize(vec3(0.6, -0.2, 0.5));
  float dif = max(dot(n, L), 0.0), fill = max(dot(n, F), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  float rim = pow(1.0 - z, 2.2);
  // a cut bead near the slice plane glows a little, so the cut reads
  float cut = uSliceOn > 0.5 ? smoothstep(-0.9, 0.0, vClip) * 0.35 : 0.0;
  vec3 col = vCol * (0.22 + 0.68 * dif + 0.18 * fill) * vShade + vec3(0.9, 0.95, 1.0) * spec * 0.22 + vCol * rim * 0.32 + vec3(1.0, 0.85, 0.6) * cut;
  float f = smoothstep(uFog.x, uFog.y, -vp.z);
  outColor = vec4(mix(col, uBg, f * 0.88), 1.0);
}`;

// role and entity colours
export const PAL = {
  main: ['#ec7a5c', '#f2c14e', '#5fb7ea', '#8fd17f', '#c592f0', '#f193b8', '#79d8c9', '#e0a35b', '#9db4ff', '#d6e36a'],
  antibody: '#8e97ab', receptor: '#e7c45d', glycan: '#dcefc6', nucleic: '#ff9f43',
};
// '#rrggbb' -> [r, g, b] bytes; hsl (0..1) -> bytes
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function hsl(h, s, l) {
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
const srgb = h => { const c = hex(h); return new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255); };
export const COLOR_MODES = ['protein', 'copy', 'structure', 'residue', 'radius', 'chain'];

function tex32(data) {
  const t = new THREE.DataTexture(data, ROW, data.length / 4 / ROW, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

export function createView(canvas, opts = {}) {
  const coarse = !!opts.coarse;
  const bud = canvasBudget(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: bud.antialias, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(bud.pr);
  renderer.setClearColor(0x05070c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 5000);
  camera.position.set(0, 0, 120);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x221a14, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-0.5, 0.8, 0.7); scene.add(sun);
  const bg = srgb('#05070c');   // raw sRGB: the bead shader writes it as is
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const fog = new THREE.Vector2(100, 400);
  let budget = bud;

  // ── a part ───────────────────────────────────────────────────────────
  // d: decoded data, ops: Float32Array 3x4 rows (nm), o: { stride, kind,
  // fibril, phase (per copy), sway {h, base}, radius (nm), offset }
  function makePart(d, ops, o = {}) {
    const stride = Math.max(1, o.stride || 1), nc = d.info.chains.length, m = ops.length / 12;
    const nb = Math.ceil(d.n / stride);
    const beads = tex32(packBeads(d)), opsT = tex32(packOps(ops));
    const kind = o.kind || d.info.sym.type;
    const cent = unitCentroids(d, ops);
    const axes = kind === 'icosa' ? axesOf(ops) : [];
    const delays = o.delays || assemblyDelays(kind === 'none' ? 'single' : kind, cent, nc, { axes, fibril: !!o.fibril });
    const dirs = explodeDirs(kind, cent, { axes, fibril: !!o.fibril });
    const units = tex32(packUnits(cent, delays, dirs, nc, o.phase));
    const ccData = new Uint8Array(W * Math.ceil(nc / W) * 4);
    const chainCol = new THREE.DataTexture(ccData, W, Math.ceil(nc / W), THREE.RGBAFormat, THREE.UnsignedByteType);
    chainCol.minFilter = chainCol.magFilter = THREE.NearestFilter; chainCol.generateMipmaps = false;
    const uniforms = {
      uBeads: { value: beads }, uOps: { value: opsT }, uUnits: { value: units }, uChainCol: { value: chainCol },
      uNB: { value: nb }, uStride: { value: stride }, uNChains: { value: nc }, uNCopies: { value: m }, uColMode: { value: 0 }, uHiK: { value: -1 },
      uRad: { value: 0.3 * (1 + 0.3 * (stride - 1)) }, uAsm: { value: 1 }, uSpread: { value: ASM_SPREAD }, uFly: { value: 0 }, uJitter: { value: 0 },
      uExplode: { value: 0 }, uPeelD: { value: 0 }, uPeelW: { value: 1 }, uPeelOn: { value: 0 }, uPeelN: { value: new THREE.Vector3(0, 0, 1) },
      uSliceD: { value: 0 }, uSliceOn: { value: 0 }, uSliceN: { value: new THREE.Vector3(0, 0, 1) }, uBreath: { value: 0 }, uTime: { value: 0 },
      uSway: { value: 0 }, uSwayH: { value: o.sway ? o.sway.h : 1 }, uSwayBase: { value: o.sway ? o.sway.base : 0 },
      uDim: { value: 0.35 }, uRadialR: { value: o.radius || 10 }, uFade: { value: 1 }, uOffset: { value: new THREE.Vector3() },
      uBg: { value: bg }, uFog: { value: fog },
    };
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BEAD_VS, fragmentShader: BEAD_FS, uniforms });
    const geo = quad.clone();
    geo.instanceCount = nb * m;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    if (o.offset) uniforms.uOffset.value.set(...o.offset);
    const part = { d, ops, mesh, uniforms, stride, nb, m, nc, cent, dirs, delays, axes, kind, instances: nb * m,
      gpuBytes: (beads.image.data.byteLength + opsT.image.data.byteLength + units.image.data.byteLength + ccData.byteLength),
      dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); beads.dispose(); opsT.dispose(); units.dispose(); chainCol.dispose(); } };
    part.setColors = (mode, hide = {}) => setColors(part, mode, hide);
    part.setColors('protein');
    scene.add(mesh);
    return part;
  }

  // Colour per chain: by entity role (protein mode) or one hue per chain.
  // hide: { antibody: true, glycan: true } drops those roles (alpha 0).
  function setColors(part, mode, hide = {}) {
    const { d } = part, ents = d.info.entities, a = part.uniforms.uChainCol.value.image.data;
    const mainIx = {}; let nMain = 0;
    ents.forEach((e, i) => { if (e.role === 'main') mainIx[i] = nMain++; });
    // raw sRGB bytes: the shader writes them out as they are
    d.info.chains.forEach((c, i) => {
      const e = ents[c[2]];
      let col;
      if (mode === 'chain') col = hsl((i * 0.618034 + 0.05) % 1, 0.55, 0.62);
      else if (part.tint) col = hex(part.tint);
      else if (e.role === 'main') col = hex(PAL.main[mainIx[c[2]] % PAL.main.length]);
      else col = hex(PAL[e.role] || '#cccccc');
      a[4 * i] = col[0]; a[4 * i + 1] = col[1]; a[4 * i + 2] = col[2];
      a[4 * i + 3] = hide[e.role] ? 0 : 255;
    });
    part.uniforms.uChainCol.value.needsUpdate = true;
    const m = { protein: 0, chain: 0, copy: 1, structure: 2, residue: 3, radius: 4 }[mode];
    part.uniforms.uColMode.value = m == null ? 0 : m;
  }

  // ── membrane (an illustration) ────────────────────────────────────────
  function makeMembrane(R, color = '#d9a46c') {
    const geo = new THREE.SphereGeometry(R, coarse ? 64 : 96, coarse ? 48 : 72);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: srgb(color) }, uTime: { value: 0 }, uBg: { value: bg }, uFog: { value: fog }, uR: { value: R }, uA: { value: 1 } },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vP; varying vec3 vV;
        void main() { vN = normalize(normalMatrix * normal); vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol; uniform float uTime; uniform vec3 uBg; uniform vec2 uFog; uniform float uR; uniform float uA;
        varying vec3 vN; varying vec3 vP; varying vec3 vV;
        float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          // lipid head groups: a fine cell pattern of soft dots on the shell
          vec3 q = vP / uR * 60.0 + vec3(0.0, uTime * 0.05, 0.0);
          vec3 g = floor(q), f = fract(q) - 0.5;
          float dots = smoothstep(0.42, 0.18, length(f)) * (0.6 + 0.4 * h3(g));
          vec3 n = normalize(vN);
          float dif = max(dot(n, normalize(vec3(-0.45, 0.65, 0.62))), 0.0);
          float fr = pow(1.0 - abs(n.z), 2.0);
          vec3 c = uCol * (0.25 + 0.55 * dif) * (0.75 + 0.35 * dots) + uCol * fr * 0.35;
          float f2 = smoothstep(uFog.x, uFog.y, -vV.z);
          gl_FragColor = vec4(mix(c, uBg, f2 * 0.88), uA);
        }`,
      transparent: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return { mesh, mat, R, dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); } };
  }

  // ── stalks: thin cylinders from the membrane to each spike base ───────
  function makeStalks(segs, color = 0xc9b089) {
    const geo = new THREE.CylinderGeometry(0.9, 1.2, 1, 7, 1, true);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, segs.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), dv = new THREE.Vector3();
    segs.forEach((s, i) => {
      a.set(s[0], s[1], s[2]); b.set(s[3], s[4], s[5]); dv.subVectors(b, a);
      const len = dv.length(); q.setFromUnitVectors(up, dv.normalize());
      m4.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1));
      mesh.setMatrixAt(i, m4);
    });
    mesh.count = segs.length;
    scene.add(mesh);
    return { mesh, dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose && mesh.dispose(); } };
  }

  // ── the symmetry axes ─────────────────────────────────────────────────
  // axes: [{order, dir}] from axesOf; R: the particle radius (nm).
  const AXIS_COL = { 5: 0xff6b6b, 3: 0xffd166, 2: 0x5cc8ff, 6: 0xff6b6b, 4: 0xffd166 };
  function makeAxes(axes, R) {
    const group = new THREE.Group(), geos = [], mats = [];
    for (const a of axes) {
      const col = AXIS_COL[a.order] || 0xffffff, d = new THREE.Vector3(...a.dir);
      const lg = new THREE.BufferGeometry().setFromPoints([d.clone().multiplyScalar(-R * 1.28), d.clone().multiplyScalar(R * 1.28)]);
      const lm = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false });
      group.add(new THREE.Line(lg, lm)); geos.push(lg); mats.push(lm);
      // a marker at each end: pentagon, triangle or lens (an ellipse)
      const seg = a.order === 2 ? 24 : a.order, size = R * (a.order === 5 ? 0.075 : a.order === 3 ? 0.062 : 0.05);
      const mg = new THREE.CircleGeometry(size, seg);
      if (a.order === 2) mg.scale(1, 0.5, 1);
      const mm = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.92, depthWrite: false });
      geos.push(mg); mats.push(mm);
      for (const sgn of [1, -1]) {
        const mk = new THREE.Mesh(mg, mm);
        const nd = d.clone().multiplyScalar(sgn);
        mk.position.copy(nd).multiplyScalar(R * 1.18);
        mk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nd);
        group.add(mk);
      }
    }
    group.renderOrder = 2;
    scene.add(group);
    return { group, dispose() { scene.remove(group); geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); } };
  }

  // ── a dust field far behind, for depth when the camera moves ──────────
  const dustGeo = new THREE.BufferGeometry();
  { const n = coarse ? 500 : 1200, p = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u); p.set([r * Math.cos(t), u, r * Math.sin(t)], 3 * i); }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(p, 3)); }
  const dustMat = new THREE.PointsMaterial({ color: 0x6f86b8, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.35, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  function resize(w, h) {
    budget = canvasBudget(w, h, window.devicePixelRatio || 1);
    renderer.setPixelRatio(budget.pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  // near/far and fog follow the camera distance to the target
  function frameScale(dist, radius) {
    camera.near = Math.max(0.05, (dist - radius * 1.6) * 0.5, dist * 0.01);
    camera.far = dist + radius * 6 + 50;
    camera.updateProjectionMatrix();
    fog.set(dist - radius * 0.2, dist + radius * 2.2);
    dust.scale.setScalar(dist * 4 + radius * 4);
    dust.position.copy(camera.position);
  }
  let lost = false;
  function render() { if (!lost) renderer.render(scene, camera); }
  function dispose() {
    if (lost) return;
    lost = true;
    dustGeo.dispose(); dustMat.dispose(); quad.dispose();
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (e) { /* already lost */ }
  }
  return { renderer, scene, camera, makePart, makeMembrane, makeStalks, makeAxes, resize, frameScale, render, dispose, get budget() { return budget; }, coarse };
}
