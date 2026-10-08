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
//    uAux     RGBA8 per bead (trace.js): burial, place along the chain,
//             break count, ribbon weight
//  Each bead is a camera-facing quad with a sphere drawn in the fragment
//  shader (glsl.js BEAD_VS, BEAD_FS). The vertex shader moves whole units
//  for the assembly (uAsm), explode, peel and breathing, and bends spikes
//  for the sway; a fragment test cuts the slice. The same quads draw
//  space-filling (uRadMul, uAO) and toon (uToon); reps.js adds the glow,
//  tube, blob and cage meshes on the same textures.
//
//  PALETTE AND LIGHT  setPalette(key) and setLight(key) (colors.js) write
//  shared uniform objects that every material holds.
//
//  OTHER OBJECTS  membrane shell (an illustration), spike stalks, the
//  symmetry axes with 5-, 3- and 2-fold markers, a soft dust field.
//
//  MEMORY  The canvas follows budget.js canvasBudget (no render targets,
//  no MSAA at a pixel ratio of 1.5 or more). dispose() frees every
//  texture, geometry and material and loses the WebGL context; main.js
//  calls it on pagehide.
//
//  grep -n targets: "export function createView", "function setPalette",
//    "function setLight", "function makePart", "function setColors",
//    "function makeMembrane", "function makeAxes", "function makeStalks"
// ============================================================================
import * as THREE from 'three';
import { unitCentroids, assemblyDelays, explodeDirs, axesOf, ASM_SPREAD } from './symmetry.js';
import { canvasBudget } from './budget.js';
import { ROW, packBeads, packOps, packUnits } from './pack.js';
import { packAux, opsKey } from './trace.js';
import { SCHEMES, MODE, LIGHTS, hex01, chainColors, paletteUniforms } from './colors.js';
import { BEAD_VS, BEAD_FS } from './glsl.js';
import { addReps } from './reps.js';

const W = ROW;   // texture row width

export { PALETTES as PALS } from './colors.js';
const srgb = h => { const c = hex01(h); return new THREE.Vector3(c[0], c[1], c[2]); };
export const COLOR_MODES = SCHEMES.map(x => x.id);

function tex32(data) {
  const t = new THREE.DataTexture(data, ROW, data.length / 4 / ROW, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

export function createView(canvas, opts = {}) {
  const coarse = !!opts.coarse;
  const bud = canvasBudget(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, { coarse });
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: bud.antialias, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(bud.pr);
  renderer.setClearColor(0x05070c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 5000);
  camera.position.set(0, 0, 120);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x221a14, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-0.5, 0.8, 0.7); scene.add(sun);
  const bg = srgb('#05070c');   // raw sRGB: the shaders write it as is
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const fog = new THREE.Vector2(100, 400);
  let budget = bud;
  // shared uniform objects: every material of every part holds these, so
  // one write changes the light, the palette or the fog everywhere
  const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
  const LIGHT = { uKey: { value: v3(LIGHTS.studio.key) }, uKeyCol: { value: v3(LIGHTS.studio.keyCol) }, uFill: { value: v3(LIGHTS.studio.fill) },
    uAmb: { value: LIGHTS.studio.amb }, uRimK: { value: LIGHTS.studio.rim }, uSpecK: { value: LIGHTS.studio.spec }, uBg: { value: bg }, uFog: { value: fog } };
  const PU = paletteUniforms('atlas');
  const PALU = { uRamp: { value: PU.ramp.map(v3) }, uDiv: { value: PU.div.map(v3) }, uSS: { value: PU.ss.map(v3) }, uCls: { value: PU.cls.map(v3) }, uCopy: { value: v3(PU.copy) } };
  let palKey = 'atlas', lightKey = 'studio';
  const parts = new Set();
  function setPalette(key) {
    palKey = key; const u = paletteUniforms(key);
    for (const n of ['ramp', 'div', 'ss', 'cls']) u[n].forEach((c, i) => PALU['u' + n[0].toUpperCase() + n.slice(1)].value[i].set(c[0], c[1], c[2]));
    PALU.uCopy.value.set(...u.copy);
  }
  function setLight(key) {
    const L = LIGHTS[key] || LIGHTS.studio; lightKey = key;
    LIGHT.uKey.value.set(...L.key).normalize(); LIGHT.uKeyCol.value.set(...L.keyCol); LIGHT.uFill.value.set(...L.fill).normalize();
    LIGHT.uAmb.value = L.amb; LIGHT.uRimK.value = L.rim; LIGHT.uSpecK.value = L.spec;
    const c = hex01(L.bg); bg.set(c[0], c[1], c[2]); renderer.setClearColor(new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace), 1);
  }

  // ── a part ───────────────────────────────────────────────────────────
  // d: decoded data, ops: Float32Array 3x4 rows (nm), o: { stride,
  // tubeStride, kind, fibril, phase (per copy), sway {h, base}, radius
  // (nm), offset }. The bead quads draw beads, space and toon (by
  // uniforms) and the glow; reps.js adds the tube, blob and cage meshes
  // when a view first needs them.
  function makePart(d, ops, o = {}) {
    const stride = Math.max(1, o.stride || 1), nc = d.info.chains.length, m = ops.length / 12;
    const nb = Math.ceil(d.n / stride);
    const beads = tex32(packBeads(d)), opsT = tex32(packOps(ops));
    const auxData = packAux(d, ops, d._bur && d._bur.key === opsKey(ops) ? d._bur.v : null);
    const aux = new THREE.DataTexture(auxData, ROW, auxData.length / 4 / ROW, THREE.RGBAFormat, THREE.UnsignedByteType);
    aux.minFilter = aux.magFilter = THREE.NearestFilter; aux.generateMipmaps = false; aux.needsUpdate = true;
    const kind = o.kind || d.info.sym.type;
    const cent = unitCentroids(d, ops);
    const axes = kind === 'icosa' ? axesOf(ops) : [];
    const delays = o.delays || assemblyDelays(kind === 'none' ? 'single' : kind, cent, nc, { axes, fibril: !!o.fibril });
    const dirs = explodeDirs(kind, cent, { axes, fibril: !!o.fibril });
    const units = tex32(packUnits(cent, delays, dirs, nc, o.phase));
    const ccData = new Uint8Array(W * Math.ceil(nc / W) * 4);
    const chainCol = new THREE.DataTexture(ccData, W, Math.ceil(nc / W), THREE.RGBAFormat, THREE.UnsignedByteType);
    chainCol.minFilter = chainCol.magFilter = THREE.NearestFilter; chainCol.generateMipmaps = false;
    const base = {
      uBeads: { value: beads }, uAux: { value: aux }, uOps: { value: opsT }, uUnits: { value: units }, uChainCol: { value: chainCol },
      uNB: { value: nb }, uStride: { value: stride }, uNChains: { value: nc }, uNCopies: { value: m }, uNBead: { value: d.n }, uColMode: { value: 0 }, uHiK: { value: -1 },
      uRad: { value: 0.3 * (1 + 0.3 * (stride - 1)) }, uAsm: { value: 1 }, uSpread: { value: ASM_SPREAD }, uFly: { value: 0 }, uJitter: { value: 0 },
      uExplode: { value: 0 }, uExMode: { value: 0 }, uNAx: { value: 0 }, uAx: { value: Array.from({ length: 15 }, () => new THREE.Vector3(0, 1, 0)) },
      uPeelD: { value: 0 }, uPeelW: { value: 1 }, uPeelOn: { value: 0 }, uPeelN: { value: new THREE.Vector3(0, 0, 1) }, uPeelMode: { value: 0 }, uSpiral: { value: 5 },
      uSliceD: { value: 0 }, uSliceOn: { value: 0 }, uSlab: { value: 0 }, uSliceN: { value: new THREE.Vector3(0, 0, 1) }, uBreath: { value: 0 }, uTime: { value: 0 },
      uSway: { value: 0 }, uSwayH: { value: o.sway ? o.sway.h : 1 }, uSwayBase: { value: o.sway ? o.sway.base : 0 },
      uDim: { value: 0.35 }, uRadialR: { value: o.radius || 10 }, uFade: { value: 1 }, uOffset: { value: new THREE.Vector3() }, uGather: { value: 0 },
      ...LIGHT, ...PALU,
    };
    const uniforms = { ...base, uRadMul: { value: 1 }, uRepScale: { value: 1 }, uSprite: { value: 1 }, uAO: { value: 0 }, uToon: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BEAD_VS, fragmentShader: BEAD_FS, uniforms });
    const geo = quad.clone();
    geo.instanceCount = nb * m;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    if (o.offset) base.uOffset.value.set(...o.offset);
    const part = { d, ops, mesh, uniforms, base, stride, nb, m, nc, cent, dirs, delays, axes, kind, instances: nb * m, auxData, aux,
      tubeStride: Math.max(1, o.tubeStride || stride), radius: o.radius || 10, coarse, palKey: () => palKey,
      gpuBytes: (beads.image.data.byteLength + opsT.image.data.byteLength + units.image.data.byteLength + ccData.byteLength + auxData.byteLength),
      extra: [],
      dispose() { parts.delete(part); scene.remove(mesh); geo.dispose(); mat.dispose(); beads.dispose(); opsT.dispose(); units.dispose(); chainCol.dispose(); aux.dispose(); part.extra.forEach(f => f()); } };
    part.setColors = (mode, hide = {}) => setColors(part, mode, hide);
    addReps(THREE, part, { scene, quad, coarse, budget: () => budget });
    part.setColors('protein');
    scene.add(mesh);
    parts.add(part);
    return part;
  }

  // Colour per chain (protein and chain schemes) into the chain texture,
  // and the shader mode of the other schemes. hide: { antibody: true,
  // glycan: true } drops those roles (alpha 0). part.tint: one main colour
  // index for every chain (the spikes of a virion).
  function setColors(part, mode, hide = {}) {
    const a = part.uniforms.uChainCol.value.image.data;
    chainColors(part.d.info, mode, palKey, { hide, tint: part.tint, shift: part.shift || 0 }).forEach((c, i) => {
      a[4 * i] = Math.round(c[0] * 255); a[4 * i + 1] = Math.round(c[1] * 255); a[4 * i + 2] = Math.round(c[2] * 255); a[4 * i + 3] = c[3] ? 255 : 0;
    });
    part.uniforms.uChainCol.value.needsUpdate = true;
    part.uniforms.uColMode.value = MODE[mode] ?? 0;
    part.scheme = mode;
    if (mode === 'burial') part.needBurial();
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
    budget = canvasBudget(w, h, window.devicePixelRatio || 1, { coarse });
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
  return { renderer, scene, camera, makePart, makeMembrane, makeStalks, makeAxes, resize, frameScale, render, dispose, setPalette, setLight,
    get palette() { return palKey; }, get light() { return lightKey; }, get budget() { return budget; }, coarse };
}
