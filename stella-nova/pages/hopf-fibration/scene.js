// ============================================================================
//  HOPF FIBRATION  ·  scene.js — the three.js view of the fibres
// ----------------------------------------------------------------------------
//  One instanced mesh draws all fibres. The geometry is one tube template:
//  SEG segments along the fibre and RING vertices around it. position.x is
//  the fibre parameter t / 2 pi, position.y the angle around the tube. Each
//  instance has a base point aBase on S2, a colour, and aAux:
//      aAux.x  tube radius scale     aAux.y  glow (emissive)
//      aAux.z  stripe weight         aAux.w  unused
//  The vertex shader (FIBRE_GLSL) puts each vertex on the fibre over aBase,
//  rotates it by uRot (4x4), projects it from e4 to R3, and builds the tube
//  frame from three points of the circle (tangent, and normal to the
//  centre). uPQ holds the weights (p, q) of the circle action (1, 1 is the
//  Hopf fibration) and the weights of a change in progress, uPQMix how far
//  it has gone. No geometry is rebuilt when the rotation or the base points
//  change: only uniforms and the instance attributes.
//
//  In the saver, setBand(band) fades each tube, disc and dot fragment to the fog colour
//  above and below the clear band of the plate (BAND_GLSL), so a tail
//  through infinity or a push-in never shows under the plate text.
//
//  Near infinity a tube vertex can go very far. A vertex farther than uFar,
//  or on a segment longer than uSegMax, sets vFar = 1, and the fragment
//  shader discards each triangle that touches it.
//
//  The material is MeshStandardMaterial with onBeforeCompile, so the
//  fibres get the three.js lights, the room environment map, the fog and
//  the tone mapping. Desktop renders through an EffectComposer: one MSAA
//  target, a soft bloom, and OutputPass (ACES tone map, sRGB). A touch
//  screen renders direct with antialias and no bloom.
//
//  MEMORY  resize() takes the pixel ratio and the MSAA sample count from
//  postBudget (budget.js): at most 2560 x 1440 device px, and at most
//  160 MB for the scene target. Nothing in this file allocates per frame.
//
//  EXPORTS  createScene(canvas, opts) -> api   (grep -n "export function")
//  FIBRE_GLSL is also the code extract on the saver plate.
//  grep -n targets: "FIBRE_GLSL", "function patchMaterial", "function setFibres",
//                   "function setDiscs", "function setBand", "BAND_GLSL",
//                   "function render", "function resize"
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { postBudget } from './budget.js';

// The fibre and the projection, as in hopf.js (fibrePoint, stereo).
export const FIBRE_GLSL = `// the orbit of t -> (e^{ipt} z0, e^{iqt} z1) through b in S2 (seifertPoint)
vec4 seifert(vec3 b, float t, vec2 w) {
  float c = sqrt(max(0.0, 0.5 * (1.0 + b.z)));   // cos(theta/2)
  float s = sqrt(max(0.0, 0.5 * (1.0 - b.z)));   // sin(theta/2)
  float r = length(b.xy);
  vec2 e = r > 1e-6 ? b.xy / r : vec2(1.0, 0.0);  // e^{i phi}
  float ca = cos(w.x * t), sa = sin(w.x * t);
  return vec4(c * (ca * e.x - sa * e.y), c * (sa * e.x + ca * e.y), s * cos(w.y * t), s * sin(w.y * t));
}
// the fibre at weights uPQ.xy; during a change of weights, a blend on S3
// toward the orbit at uPQ.zw. At (1, 1) it is the Hopf fibre:
// (z0, z1) = e^{it} (cos(theta/2) e^{i phi}, sin(theta/2))
vec4 hopfFibre(vec3 b, float t) {
  vec4 q = seifert(b, t, uPQ.xy);
  if (uPQMix > 0.0) {
    vec4 m = mix(q, seifert(b, t, uPQ.zw), uPQMix);
    float l = length(m);
    q = l > 1e-4 ? m / l : seifert(b, t, uPQ.zw);
  }
  return q;
}
// rotate in R4, then project from the pole e4 to R3
vec3 hopfStereo(vec4 q, out float d) {
  q = uRot * q;
  d = 1.0 - q.w;
  return q.xyz / max(d, 1e-5);
}`;

const VERT_HEAD = `
attribute vec3 aBase;
attribute vec4 aAux;
uniform mat4 uRot;
uniform vec4 uPQ;
uniform float uPQMix;
uniform float uRad, uFar, uSegMax, uSeg, uConf;
varying float vT;
varying float vFar;
varying vec4 vAux;
${FIBRE_GLSL}
`;
const VERT_TUBE = `
  float tt = position.x * 6.28318530718, ang = position.y, h = 6.28318530718 / uSeg;
  float d0, d1, d2;
  vec3 P  = hopfStereo(hopfFibre(aBase, tt), d0);
  vec3 Pa = hopfStereo(hopfFibre(aBase, tt + h), d1);
  vec3 Pb = hopfStereo(hopfFibre(aBase, tt - h), d2);
  vec3 Tg = Pa - Pb; float segL = length(Tg); Tg /= max(segL, 1e-12);
  vec3 K = Pa + Pb - 2.0 * P; K -= dot(K, Tg) * Tg; float kl = length(K);
  vec3 Nn = kl > 1e-6 * segL ? K / kl : normalize(cross(Tg, abs(Tg.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 Bn = cross(Tg, Nn);
  vec3 ringN = cos(ang) * Nn + sin(ang) * Bn;
  float rad = uRad * aAux.x * mix(1.0, clamp(1.0 / max(d0, 1e-3), 0.5, 30.0), uConf);
  vec3 hopfPos = P + rad * ringN;
  vFar = (length(P) > uFar || segL > uSegMax || d0 < 1e-4) ? 1.0 : 0.0;
  vT = position.x;
  vAux = aAux;
  vec3 objectNormal = ringN;
`;
const FRAG_HEAD = `
uniform float uStripes;
uniform vec3 uBand;
uniform float uBandOn;
varying float vT;
varying float vFar;
varying vec4 vAux;
`;

// The saver band: a tube fades to the fog colour above and below the clear
// band of the plate, so no tube shows under the plate text. uBand is
// (lo, hi, soft) in drawing-buffer pixels from the base of the view.
const BAND_GLSL = `  if (uBandOn > 0.5) {
    float yb = gl_FragCoord.y;
    float kb = smoothstep(uBand.x - uBand.z, uBand.x + uBand.z, yb) * (1.0 - smoothstep(uBand.y - uBand.z, uBand.y + uBand.z, yb));
#ifdef USE_FOG
    gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, kb);
#else
    gl_FragColor.rgb *= kb;
#endif
  }`;

// The same band fade for the discs and the pierce dots (MeshBasicMaterial).
function bandPatch(mat, uniforms) {
  mat.fog = true;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uBand = uniforms.uBand; sh.uniforms.uBandOn = uniforms.uBandOn;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBand;\nuniform float uBandOn;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n' + BAND_GLSL);
  };
  mat.customProgramCacheKey = () => 'hopf-band-v1';
  return mat;
}

function patchMaterial(mat, uniforms) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <beginnormal_vertex>', VERT_TUBE)
      .replace('#include <begin_vertex>', 'vec3 transformed = hopfPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (vFar > 0.0005) discard;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  float ph = fract(vT * uStripes);
  float band = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.42, 0.5, ph));
  diffuseColor.rgb *= mix(1.0, 0.5 + 0.62 * band, vAux.z);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vAux.y;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n' + BAND_GLSL);
  };
  mat.customProgramCacheKey = () => 'hopf-tube-v3';
}

export function createScene(canvas, opts = {}) {
  const coarse = !!opts.coarse;
  const SEG = coarse ? 120 : 200, RING = coarse ? 7 : 10;
  const CAP = opts.cap || (coarse ? 900 : 2400);
  const BG = new THREE.Color(0x06070b);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: coarse, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(1);   // resize() sets the budget ratio
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = BG;
  scene.fog = new THREE.FogExp2(BG, 0.038);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 400);
  camera.position.set(4.6, 3.4, 6.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 1.2; controls.maxDistance = 40;
  controls.rotateSpeed = coarse ? 0.7 : 0.9;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20140c, 0.55));
  const key = new THREE.DirectionalLight(0xfff1e0, 1.6); key.position.set(4, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc0ff, 0.7); rim.position.set(-6, -2, -5); scene.add(rim);

  // ---- tube template
  const tmpl = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array((SEG + 1) * RING * 3), idx = [];
  for (let i = 0; i <= SEG; i++) for (let j = 0; j < RING; j++) {
    const k = (i * RING + j) * 3; pos[k] = i / SEG; pos[k + 1] = j / RING * Math.PI * 2; pos[k + 2] = 0;
  }
  for (let i = 0; i < SEG; i++) for (let j = 0; j < RING; j++) {
    const a = i * RING + j, b = i * RING + (j + 1) % RING, c = (i + 1) * RING + j, d = (i + 1) * RING + (j + 1) % RING;
    idx.push(a, c, b, b, c, d);
  }
  tmpl.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tmpl.setIndex(idx);
  const aBase = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aAux = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
  tmpl.setAttribute('aBase', aBase); tmpl.setAttribute('color', aCol); tmpl.setAttribute('aAux', aAux);
  tmpl.instanceCount = 0;

  const uniforms = {
    uRot: { value: new THREE.Matrix4() }, uRad: { value: 0.035 }, uFar: { value: 34 }, uSegMax: { value: 5 },
    uSeg: { value: SEG }, uConf: { value: 0 }, uStripes: { value: 6 },
    uPQ: { value: new THREE.Vector4(1, 1, 1, 1) }, uPQMix: { value: 0 },
    uBand: { value: new THREE.Vector3(0, 1e5, 1) }, uBandOn: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.08, envMapIntensity: 0.75 });
  patchMaterial(mat, uniforms);
  const fibres = new THREE.Mesh(tmpl, mat);
  fibres.frustumCulled = false;
  scene.add(fibres);

  // ---- linking discs and the pierce points
  const discGeo = new THREE.CircleGeometry(1, 128);
  const discs = [0, 1].map(() => {
    const m = new THREE.Mesh(discGeo, bandPatch(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), uniforms));
    m.visible = false; m.renderOrder = 2; scene.add(m); return m;
  });
  const dotGeo = new THREE.SphereGeometry(1, 24, 16);
  const dots = [0, 1].map(() => {
    const m = new THREE.Mesh(dotGeo, bandPatch(new THREE.MeshBasicMaterial({ color: 0xffffff }), uniforms));
    const halo = new THREE.Mesh(dotGeo, bandPatch(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false }), uniforms));
    halo.scale.setScalar(2.4); m.add(halo); m.userData.halo = halo;
    m.visible = false; m.renderOrder = 3; scene.add(m); return m;
  });

  // ---- post
  // The GPU memory has a hard budget (budget.js). No pass swaps, so the
  // scene always draws into composer.readBuffer, the one MSAA target. The
  // write buffer is never bound, so WebGL never allocates it. The bloom
  // chain runs at half the size the composer gives it.
  let composer = null, bloom = null, sceneRT = null;
  if (!coarse) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0 });
    composer = new EffectComposer(renderer, rt);
    sceneRT = composer.readBuffer;
    composer.writeBuffer.samples = 0;
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.32, 0.55, 0.86);
    const bloomSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w, h) => bloomSize(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)));
    composer.addPass(bloom);
    const out = new OutputPass();
    out.needsSwap = false;
    composer.addPass(out);
  }

  const view = { w: 1, h: 1, ox: 0, oy: 0, pr: 0, samples: -1 };
  // Called only on a real change of the window size (main.js).
  function resize(w, h) {
    view.w = w; view.h = h;
    const B = postBudget(w, h, window.devicePixelRatio || 1);
    view.budget = B;
    if (B.pr !== view.pr) { view.pr = B.pr; renderer.setPixelRatio(B.pr); }
    renderer.setSize(w, h, false);
    if (composer) {
      if (B.samples !== view.samples) {
        // a new sample count needs a new allocation: free the old one
        view.samples = B.samples; sceneRT.samples = B.samples; sceneRT.dispose();
      }
      // one setSize, one allocation (setPixelRatio would size twice)
      composer._pixelRatio = B.pr;
      composer.setSize(w, h);
    }
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  // Shift the view so the origin sits at the centre of the clear part.
  function setOffset(ox, oy) {
    view.ox = ox; view.oy = oy;
    camera.setViewOffset(view.w, view.h, ox, oy, view.w, view.h);
  }

  // The clear band of the saver plate, in CSS px from the top (t) and from
  // the base (b) of the view. null turns the fade off.
  function setBand(band) {
    if (!band) { uniforms.uBandOn.value = 0; return; }
    const pr = renderer.getPixelRatio();
    uniforms.uBand.value.set(band.b * pr, (view.h - band.t) * pr, 0.035 * view.h * pr);
    uniforms.uBandOn.value = 1;
  }

  // fibres: [{ b, rgb, rad, glow, stripe }]
  function setFibres(list) {
    const n = Math.min(CAP, list.length);
    const B = aBase.array, C = aCol.array, A = aAux.array;
    for (let i = 0; i < n; i++) {
      const f = list[i];
      B[i * 3] = f.b[0]; B[i * 3 + 1] = f.b[1]; B[i * 3 + 2] = f.b[2];
      C[i * 3] = f.rgb[0]; C[i * 3 + 1] = f.rgb[1]; C[i * 3 + 2] = f.rgb[2];
      A[i * 4] = f.rad ?? 1; A[i * 4 + 1] = f.glow ?? 0; A[i * 4 + 2] = f.stripe ?? 1; A[i * 4 + 3] = 0;
    }
    aBase.needsUpdate = aCol.needsUpdate = aAux.needsUpdate = true;
    tmpl.instanceCount = n;
    return n;
  }
  // M: row-major 16 numbers.
  function setRotation(M) { uniforms.uRot.value.set(...M); }

  // d: null, or { centre, radius, normal, rgb } for disc k
  function setDisc(k, d) {
    const m = discs[k];
    if (!d || !(d.radius < 60)) { m.visible = false; return; }
    m.visible = true;
    m.position.set(...d.centre); m.scale.setScalar(d.radius);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...d.normal));
    m.material.color.setRGB(...d.rgb);
  }
  function setDot(k, p, rgb, size) {
    const m = dots[k];
    if (!p) { m.visible = false; return; }
    m.visible = true; m.position.set(...p); m.scale.setScalar(size);
    m.material.color.setRGB(...rgb.map(v => Math.min(1, v * 1.4 + 0.15)));
    m.userData.halo.material.color.setRGB(...rgb);
  }

  function render() {
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  return {
    THREE, renderer, scene, camera, controls, uniforms, dots, CAP, coarse,
    resize, setOffset, setBand, setFibres, setRotation, setDisc, setDot, render,
    budget: () => view.budget,
  };
}
