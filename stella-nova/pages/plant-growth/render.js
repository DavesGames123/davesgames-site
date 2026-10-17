// ============================================================================
//  PLANT GROWTH  ·  three.js scene: branches, leaves, roots, soil, sky
// ----------------------------------------------------------------------------
//  The GPU reads the plant from two float textures per structure (pose.js
//  fills them each frame, 4 floats per node):
//    pos  x, y, z, shown radius        col  t, light, parent id, growth
//  Branches: one instanced open cylinder per node. The vertex shader
//  fetches the node and its parent by gl_InstanceID and builds a tapered
//  segment from parent (radius A) to node (radius B), a little longer
//  than the gap so the joints close.
//  Leaves and flowers: one instanced quad each, with two vec4 attributes
//  that are the plant leaf array itself (grow.js LEAF_STRIDE = 8). A leaf
//  opens after its twig is grown, unfolds along the midrib, flutters in
//  the wind, and falls when its branch gets thick. Shapes come from an
//  atlas drawn on a canvas (8 cells: 6 leaves, 2 flowers).
//  Colour: "Natural" uses bark, twig, leaf and flower colours; the heatmap
//  modes read a 256 x 1 gradient texture at t. A gradient change only
//  rewrites that texture, so the plant recolours at once.
//  Roots: the same branch material on their own textures, inside a soil
//  plinth with a quarter cut away (the cut faces are part transparent).
//
//  grep -n targets
//    leaf atlas .............. "function drawAtlas"
//    branch shader ........... "function branchMaterial"
//    leaf shader ............. "function leafMaterial"
//    sky ..................... "function makeSky"
//    plinth and cut-away ..... "function buildPlinth"
//    public api .............. "return api"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { lut } from '../../lib/growth-gradients.js';

const TEX_W = 128;

// ---------------------------------------------------------------- textures
function dataTex(cap) {
  const rows = Math.max(1, Math.ceil(cap / TEX_W));
  const data = new Float32Array(TEX_W * rows * 4);
  const t = new THREE.DataTexture(data, TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

function lutTex() {
  const t = new THREE.DataTexture(lut('forest', 256), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}

// The leaf atlas: 4 x 2 cells of 256 px, drawn in white and grey (the
// shader tints them). Stem at the bottom of each cell, tip at the top.
// Cells: 0 oak, 1 needles, 2 willow, 3 cherry, 4 fern pinna, 5 glossy
// oval, 6 blossom, 7 azalea.
function drawAtlas() {
  const S = 256, cv = document.createElement('canvas'); cv.width = S * 4; cv.height = S * 2;
  const g = cv.getContext('2d');
  const cell = (i, fn) => { g.save(); g.translate((i % 4) * S, Math.floor(i / 4) * S); fn(); g.restore(); };
  const leafPath = (w, lobes, amp, tipK = 1) => {
    // midrib from (128, 250) to (128, 8); half-width w(t) with lobes
    g.beginPath(); g.moveTo(128, 250);
    const N = 80;
    for (let k = 0; k <= N; k++) {
      const t = k / N, y = 250 - t * 242;
      let hw = w * Math.sin(Math.PI * Math.pow(t, 0.8 * tipK)) * (1 + amp * Math.sin(t * Math.PI * 2 * lobes) );
      g.lineTo(128 + hw, y);
    }
    for (let k = N; k >= 0; k--) {
      const t = k / N, y = 250 - t * 242;
      let hw = w * Math.sin(Math.PI * Math.pow(t, 0.8 * tipK)) * (1 + amp * Math.sin(t * Math.PI * 2 * lobes));
      g.lineTo(128 - hw, y);
    }
    g.closePath();
  };
  const fillLeaf = () => {
    const gr = g.createLinearGradient(0, 250, 0, 0);
    gr.addColorStop(0, '#d8d8d8'); gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr; g.fill();
  };
  const veins = (n, len, w = 2) => {
    g.strokeStyle = 'rgba(120,120,120,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(128, 250); g.lineTo(128, 14); g.stroke();
    g.lineWidth = w; g.strokeStyle = 'rgba(140,140,140,0.45)';
    for (let k = 1; k <= n; k++) {
      const y = 250 - k / (n + 1) * 230, l = len * Math.sin(Math.PI * k / (n + 1));
      g.beginPath(); g.moveTo(128, y); g.lineTo(128 + l, y - l * 0.6); g.moveTo(128, y); g.lineTo(128 - l, y - l * 0.6); g.stroke();
    }
  };
  g.clearRect(0, 0, cv.width, cv.height);
  cell(0, () => { leafPath(70, 3.5, 0.28); fillLeaf(); veins(6, 50); });                         // oak, lobed
  cell(1, () => {                                                                                // needle spray
    g.strokeStyle = '#f2f2f2'; g.lineCap = 'round';
    g.lineWidth = 5; g.beginPath(); g.moveTo(128, 250); g.lineTo(128, 10); g.stroke();
    g.lineWidth = 4;
    for (let k = 0; k < 26; k++) {
      const y = 240 - k * 9, s = k % 2 ? 1 : -1, l = 70 * Math.sin(Math.PI * (0.15 + 0.85 * k / 26));
      g.strokeStyle = k % 3 ? '#ffffff' : '#d4d4d4';
      g.beginPath(); g.moveTo(128, y); g.lineTo(128 + s * l, y - l * 0.55); g.stroke();
    }
  });
  cell(2, () => { leafPath(26, 0, 0, 1.2); fillLeaf(); veins(8, 18, 1.5); });                    // willow
  cell(3, () => { leafPath(62, 22, 0.035, 1.1); fillLeaf(); veins(7, 44); });                    // cherry
  cell(4, () => {                                                                                // fern pinna
    g.fillStyle = '#f4f4f4';
    g.fillRect(125, 12, 6, 238);
    for (let k = 0; k < 14; k++) {
      const y = 236 - k * 16, l = 56 * Math.sin(Math.PI * (0.12 + 0.88 * k / 14));
      for (const s of [-1, 1]) {
        g.beginPath(); g.ellipse(128 + s * l * 0.55, y - 4, l * 0.55, 7, s * -0.35, 0, Math.PI * 2);
        g.fillStyle = k % 2 ? '#ffffff' : '#e6e6e6'; g.fill();
      }
    }
  });
  cell(5, () => { leafPath(54, 0, 0, 0.9); fillLeaf(); veins(5, 36); });                         // glossy oval
  const flower = (petals, rIn, rOut, notch, centre) => {
    g.save(); g.translate(128, 128);
    for (let k = 0; k < petals; k++) {
      g.save(); g.rotate(k / petals * Math.PI * 2);
      g.beginPath(); g.moveTo(0, -rIn);
      g.bezierCurveTo(rOut * 0.75, -rIn - rOut * 0.3, rOut * 0.55, -rOut, notch ? rOut * 0.12 : 0, -rOut);
      if (notch) g.lineTo(0, -rOut * 0.9); g.lineTo(-(notch ? rOut * 0.12 : 0), -rOut);
      g.bezierCurveTo(-rOut * 0.55, -rOut, -rOut * 0.75, -rIn - rOut * 0.3, 0, -rIn);
      const gr = g.createLinearGradient(0, -rIn, 0, -rOut); gr.addColorStop(0, '#e8e8e8'); gr.addColorStop(1, '#ffffff');
      g.fillStyle = gr; g.fill(); g.restore();
    }
    g.beginPath(); g.arc(0, 0, rIn * 1.6, 0, Math.PI * 2); g.fillStyle = centre; g.fill();
    g.strokeStyle = 'rgba(150,150,150,0.8)'; g.lineWidth = 2;
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * rIn * 3, Math.sin(a) * rIn * 3); g.stroke(); }
    g.restore();
  };
  cell(6, () => flower(5, 10, 118, true, '#c8c8c8'));
  cell(7, () => flower(5, 12, 122, false, '#b4b4b4'));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ shaders
const FETCH = /* glsl */`
uniform highp sampler2D uPos;
uniform highp sampler2D uCol;
uniform sampler2D uLut;
uniform float uNatural;
uniform float uGlow;
vec4 fetchP(int i) { return texelFetch(uPos, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0); }
vec4 fetchC(int i) { return texelFetch(uCol, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0); }
`;

function branchMaterial(texPos, texCol, texLut, colours) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
  const U = {
    uPos: { value: texPos }, uCol: { value: texCol }, uLut: { value: texLut },
    uNatural: { value: 1 }, uGlow: { value: 0 }, uRTip: { value: 0.02 },
    uBark: { value: new THREE.Color(colours.bark) }, uTwig: { value: new THREE.Color(colours.twig) },
  };
  m.userData.U = U;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FETCH + 'varying float vT; varying float vLight; varying float vR; varying float vGrain;')
      .replace('#include <beginnormal_vertex>', /* glsl */`
        int iN = gl_InstanceID;
        vec4 cB = fetchC(iN);
        int iP = int(cB.z + 0.5);
        vec4 pA = fetchP(iP), pB = fetchP(iN);
        vec3 ax = pB.xyz - pA.xyz; float L = length(ax);
        vec3 bw = L > 1e-6 ? ax / L : vec3(0.0, 1.0, 0.0);
        vec3 bu = normalize(abs(bw.y) < 0.99 ? cross(bw, vec3(0.0, 1.0, 0.0)) : cross(bw, vec3(1.0, 0.0, 0.0)));
        vec3 bv = cross(bw, bu);
        vec3 objectNormal = normalize(bu * normal.x + bv * normal.z);
        float rr = mix(pA.w, pB.w, position.y);
        if (L < 1e-6) rr = 0.0;
        vT = cB.x; vLight = cB.y; vR = rr;
        vGrain = (pA.y + position.y * ax.y) * 9.0 + atan(position.z, position.x) * 1.5;`)
      .replace('#include <begin_vertex>', /* glsl */`
        float ext = position.y * (L + (L > 1e-6 ? 0.6 * pB.w : 0.0));
        vec3 transformed = pA.xyz + bw * ext + (bu * position.x + bv * position.z) * rr;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uLut; uniform float uNatural; uniform float uGlow; uniform float uRTip; uniform vec3 uBark; uniform vec3 uTwig;\nvarying float vT; varying float vLight; varying float vR; varying float vGrain;')
      .replace('#include <color_fragment>', /* glsl */`
        vec3 heat = texture2D(uLut, vec2(clamp(vT, 0.002, 0.998), 0.5)).rgb;
        float barkK = smoothstep(uRTip * 1.4, uRTip * 7.0, vR);
        vec3 nat = mix(uTwig, uBark, barkK) * (0.9 + 0.1 * sin(vGrain * 3.0) * barkK) * (0.7 + 0.3 * vLight);
        diffuseColor.rgb = mix(heat, nat, uNatural);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += heat * uGlow * pow(vT, 7.0) * 1.4;');
  };
  return m;
}

function leafMaterial(texPos, texCol, texLut, atlas) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
  const U = {
    uPos: { value: texPos }, uCol: { value: texCol }, uLut: { value: texLut },
    uNatural: { value: 1 }, uGlow: { value: 0 }, uClock: { value: 0 }, uTime: { value: 0 }, uWind: { value: 0.4 },
    uShedR: { value: 0.1 }, uLeafDur: { value: 3 }, uFlowerDur: { value: 6 }, uLeafCell: { value: 0 }, uFlowerCell: { value: 6 },
    uLeafCol: { value: new THREE.Color('#4a7a2a') }, uLeafYoung: { value: new THREE.Color('#b5cf62') }, uFlowerCol: { value: new THREE.Color('#ffffff') },
  };
  m.userData.U = U;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FETCH + /* glsl */`
        attribute vec4 aLeaf; attribute vec4 aLeaf2;
        uniform float uClock; uniform float uTime; uniform float uWind; uniform float uShedR;
        uniform float uLeafDur; uniform float uFlowerDur; uniform float uLeafCell; uniform float uFlowerCell;
        uniform vec3 uLeafCol; uniform vec3 uLeafYoung; uniform vec3 uFlowerCol;
        varying vec3 vTint; varying float vGlowK;`)
      .replace('#include <uv_vertex>', /* glsl */`#include <uv_vertex>
        float cellI = aLeaf2.y > 0.5 ? uFlowerCell : uLeafCell;
        vMapUv = vec2(mod(cellI, 4.0) * 0.25, 0.5 - floor(cellI / 4.0) * 0.5) + uv * vec2(0.25, 0.5);`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        int iN = int(aLeaf.x + 0.5);
        vec4 pN = fetchP(iN), cN = fetchC(iN);
        vec4 pP = fetchP(int(cN.z + 0.5));
        vec3 lw = pN.xyz - pP.xyz; float lwl = length(lw); lw = lwl > 1e-6 ? lw / lwl : vec3(0.0, 1.0, 0.0);
        vec3 lu = normalize(abs(lw.y) < 0.95 ? cross(lw, vec3(0.0, 1.0, 0.0)) : cross(lw, vec3(1.0, 0.0, 0.0)));
        vec3 lv = cross(lw, lu);
        float isF = step(0.5, aLeaf2.y);
        float age = clamp((uClock - aLeaf.y) / mix(uLeafDur, uFlowerDur, isF), 0.0, 1.0) * step(0.999, cN.w);
        age = age * age * (3.0 - 2.0 * age);
        float shed = 1.0 - (1.0 - isF) * smoothstep(uShedR * 0.55, uShedR, pN.w);
        float sz = aLeaf.w * age * shed;
        float flut = uWind * sin(uTime * 2.3 + aLeaf2.z * 6.283);
        float ang = aLeaf.z + 0.25 * flut;
        vec3 side = cos(ang) * lu + sin(ang) * lv;
        vec3 lp; vec3 objectNormal;
        if (isF > 0.5) {
          // a flower faces out along its twig and opens from a cup
          vec2 q = vec2(position.x, position.y - 0.5);
          float cup = (1.0 - age) * 0.9 + 0.12;
          lp = side * q.x + cross(lw, side) * q.y + lw * (dot(q, q) * cup + 0.03);
          objectNormal = lw;
        } else {
          vec3 dL = normalize(mix(lw, side, aLeaf2.x));
          dL = normalize(dL + vec3(0.0, -aLeaf2.w * (0.3 + 0.7 * age) - 0.15, 0.0));
          vec3 wid = cross(vec3(0.0, 1.0, 0.0), dL); float wl = length(wid);
          wid = wl > 1e-3 ? wid / wl : lu;
          vec3 nL = cross(wid, dL);
          float fold = mix(1.25, 0.14, age) + 0.12 * flut;
          lp = dL * position.y + wid * (position.x * cos(fold)) + nL * (abs(position.x) * sin(fold) - 0.16 * position.y * position.y);
          objectNormal = nL;
        }
        vec3 heat = texture2D(uLut, vec2(clamp(cN.x, 0.002, 0.998), 0.5)).rgb;
        vec3 natLeaf = mix(uLeafYoung, uLeafCol, age) * (0.45 + 0.55 * cN.y) * (0.82 + 0.36 * aLeaf2.z);
        vec3 nat = mix(natLeaf, uFlowerCol * (0.92 + 0.16 * aLeaf2.z), isF);
        vTint = mix(heat, nat, uNatural);
        vGlowK = uGlow * pow(cN.x, 7.0) * 1.2 + 0.05;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = pN.xyz + lp * sz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint; varying float vGlowK;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vTint;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vTint * vGlowK;');
  };
  return m;
}

// --------------------------------------------------------------------- sky
function makeSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color('#6f9fd0') }, uHor: { value: new THREE.Color('#f3e6d2') },
      uLow: { value: new THREE.Color('#d9cdb8') }, uSun: { value: new THREE.Vector3(0.45, 0.55, 0.7).normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uLow; uniform vec3 uSun; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir); float h = d.y;
        vec3 c = h > 0.0 ? mix(uHor, uTop, pow(clamp(h, 0.0, 1.0), 0.6)) : mix(uHor, uLow, pow(clamp(-h, 0.0, 1.0), 0.5));
        float s = max(dot(d, uSun), 0.0);
        c += vec3(1.0, 0.86, 0.62) * (pow(s, 90.0) * 0.5 + pow(s, 7.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const g = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), m);
  g.renderOrder = -10; g.frustumCulled = false;
  return g;
}

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function noiseDots(g, w, h, n, cols, rmax) {
  let s = 12345; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.globalAlpha = 0.25 + 0.5 * r(); g.beginPath(); g.arc(r() * w, r() * h, 0.5 + r() * rmax, 0, 7); g.fill(); }
  g.globalAlpha = 1;
}

// ------------------------------------------------------------------ plinth
// A disc of grass on a block of soil. With roots on, the quarter x >= 0,
// z >= 0 is cut away and two part-transparent cut faces show the roots.
function buildPlinth(group, R, Dp, mats) {
  while (group.children.length) { const c = group.children.pop(); c.geometry.dispose(); }
  const seg = 72;
  const top = new THREE.CircleGeometry(R, seg, 0, Math.PI * 1.5); top.rotateX(-Math.PI / 2);
  const quarter = new THREE.CircleGeometry(R, seg / 4, Math.PI * 1.5, Math.PI / 2); quarter.rotateX(-Math.PI / 2);
  const wall = new THREE.CylinderGeometry(R, R, Dp, seg, 1, true, Math.PI / 2, Math.PI * 1.5); wall.translate(0, -Dp / 2, 0);
  const wallQ = new THREE.CylinderGeometry(R, R, Dp, seg / 4, 1, true, 0, Math.PI / 2); wallQ.translate(0, -Dp / 2, 0);
  const faceA = new THREE.PlaneGeometry(R, Dp); faceA.translate(R / 2, -Dp / 2, 0);
  const faceB = new THREE.PlaneGeometry(R, Dp); faceB.rotateY(Math.PI / 2); faceB.translate(0, -Dp / 2, R / 2);
  const bottom = new THREE.CircleGeometry(R, seg); bottom.rotateX(Math.PI / 2); bottom.translate(0, -Dp, 0);
  const lip = new THREE.TorusGeometry(R, Math.min(0.06, R * 0.012), 6, seg, Math.PI * 2); lip.rotateX(Math.PI / 2);
  const P = {
    top: new THREE.Mesh(top, mats.grass), quarter: new THREE.Mesh(quarter, mats.grass),
    wall: new THREE.Mesh(wall, mats.wall), wallQ: new THREE.Mesh(wallQ, mats.wall),
    faceA: new THREE.Mesh(faceA, mats.cut), faceB: new THREE.Mesh(faceB, mats.cut),
    bottom: new THREE.Mesh(bottom, mats.wall),
  };
  P.faceA.renderOrder = P.faceB.renderOrder = 5;
  for (const k in P) group.add(P[k]);
  return P;
}

// The materials, for a shader check in node (no GPU).
export { branchMaterial, leafMaterial, FETCH };

// ===================================================================== api
// opts: canvas, coarse, capNodes, capRoots, capLeaves
export function createRender(opts) {
  const { canvas } = opts;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.coarse || devicePixelRatio < 2, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, opts.coarse ? 1.75 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const horizon = new THREE.Color('#e9dfcf');
  scene.fog = new THREE.Fog(horizon, 60, 260);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 900);
  camera.position.set(14, 7, 14);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = true;
  controls.minDistance = 1.2; controls.maxDistance = 80; controls.maxPolarAngle = Math.PI * 0.62;
  controls.target.set(0, 4, 0);

  scene.add(makeSky());
  scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x6a5a3c, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.3); sun.position.set(6, 9, 7.5); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.45); fill.position.set(-7, 3, -5); scene.add(fill);

  // grass, soil wall, cut faces
  const grassTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#7d9a4e'; g.fillRect(0, 0, w, h);
    noiseDots(g, w, h, 9000, ['#6c8a40', '#8faa58', '#5f7c38', '#9cb466', '#a7a25a'], 2.2);
  }, true);
  grassTex.repeat.set(3, 3);
  const soilTex = canvasTex(256, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#3a2a1c'); gr.addColorStop(0.18, '#4b3524'); gr.addColorStop(0.5, '#6a4a30'); gr.addColorStop(1, '#8a6a46');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5c8a3c'; g.fillRect(0, 0, w, 10);
    noiseDots(g, w, h, 2200, ['#2c2016', '#7a5a3a', '#9a8060', '#4a3a2a'], 3.5);
    for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(170,150,120,0.5)'; g.beginPath(); g.ellipse(Math.random() * w, 120 + Math.random() * (h - 120), 3 + Math.random() * 7, 2 + Math.random() * 4, Math.random() * 3, 0, 7); g.fill(); }
  }, true);
  const mats = {
    grass: new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }),
    wall: new THREE.MeshStandardMaterial({ map: soilTex, roughness: 1 }),
    cut: new THREE.MeshStandardMaterial({ map: soilTex, roughness: 1, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide }),
  };
  const plinth = new THREE.Group(); scene.add(plinth);
  let P = null, plinthR = 6, plinthD = 3, rootsOn = false;

  // contact shadow under the crown
  const blobTex = canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(20,28,10,0.55)'); gr.addColorStop(0.6, 'rgba(20,28,10,0.22)'); gr.addColorStop(1, 'rgba(20,28,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  blobTex.colorSpace = THREE.SRGBColorSpace;
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const blobFull = new THREE.CircleGeometry(1, 48); blobFull.rotateX(-Math.PI / 2);
  const blobPie = new THREE.CircleGeometry(1, 48, 0, Math.PI * 1.5); blobPie.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(blobFull, blobMat); blob.position.y = 0.005; blob.renderOrder = 2; scene.add(blob);

  // structures
  const texLut = lutTex(), atlas = drawAtlas();
  const cyl = new THREE.CylinderGeometry(1, 1, 1, opts.coarse ? 6 : 8, 1, true); cyl.translate(0, 0.5, 0);
  function structure(cap, colours) {
    const pos = dataTex(cap), col = dataTex(cap);
    const geo = new THREE.InstancedBufferGeometry(); geo.index = cyl.index;
    geo.setAttribute('position', cyl.getAttribute('position')); geo.setAttribute('normal', cyl.getAttribute('normal'));
    geo.instanceCount = 0;
    const mat = branchMaterial(pos, col, texLut, colours);
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
    scene.add(mesh);
    return {
      cap, mesh, mat, posData: pos.image.data, colData: col.image.data,
      setCount(n) { geo.instanceCount = Math.min(n, cap); pos.needsUpdate = true; col.needsUpdate = true; },
    };
  }
  const branches = structure(opts.capNodes, { bark: '#55412f', twig: '#7d6a48' });
  const roots = structure(opts.capRoots, { bark: '#8a6a4a', twig: '#d8c4a0' });
  roots.mesh.visible = false;

  // leaves: the plant leaf array is the instance buffer (8 floats per leaf)
  const leafQuad = new THREE.PlaneGeometry(1, 1, 2, 4); leafQuad.translate(0, 0.5, 0);
  const leafGeo = new THREE.InstancedBufferGeometry(); leafGeo.index = leafQuad.index;
  for (const k of ['position', 'normal', 'uv']) leafGeo.setAttribute(k, leafQuad.getAttribute(k));
  const leafArr = new Float32Array(opts.capLeaves * 8);
  const leafBuf = new THREE.InstancedInterleavedBuffer(leafArr, 8, 1);
  leafGeo.setAttribute('aLeaf', new THREE.InterleavedBufferAttribute(leafBuf, 4, 0));
  leafGeo.setAttribute('aLeaf2', new THREE.InterleavedBufferAttribute(leafBuf, 4, 4));
  leafGeo.instanceCount = 0;
  const leafMat = leafMaterial(branches.mesh.material.userData.U.uPos.value, branches.mesh.material.userData.U.uCol.value, texLut, atlas);
  const leaves = new THREE.Mesh(leafGeo, leafMat); leaves.frustumCulled = false; scene.add(leaves);

  const mats3 = [branches.mat, roots.mat, leafMat];
  function setMode(mode) {
    const nat = mode === 'natural' ? 1 : 0, glow = mode === 'age' ? 1 : 0;
    for (const m of mats3) { m.userData.U.uNatural.value = nat; m.userData.U.uGlow.value = glow; }
  }
  function setGradient(id, rev) {
    texLut.image.data.set(lut(id, 256, rev)); texLut.needsUpdate = true;
  }
  function setSpecies(sp, crown) {
    const c = sp.col, B = branches.mat.userData.U, L = leafMat.userData.U;
    B.uBark.value.set(c.bark); B.uTwig.value.set(c.twig);
    L.uLeafCol.value.set(c.leaf); L.uLeafYoung.value.set(c.young); L.uFlowerCol.value.set(c.flower);
    L.uLeafCell.value = sp.leaf.cell; L.uFlowerCell.value = sp.flower ? sp.flower.cell : 6;
    L.uShedR.value = sp.leaf.shedR * crown;
  }
  function setPlant(p) { branches.mat.userData.U.uRTip.value = p.r0; roots.mat.userData.U.uRTip.value = 0.008; leafGeo.instanceCount = 0; }
  function setLeaves(src, n) {
    const k = Math.min(n, opts.capLeaves);
    leafArr.set(src.subarray(0, k * 8)); leafBuf.needsUpdate = true; leafGeo.instanceCount = k;
  }
  function setPlinth(R, Dp) {
    plinthR = R; plinthD = Dp;
    P = buildPlinth(plinth, R, Dp, mats);
    setRootsOn(rootsOn);
  }
  function setRootsOn(on) {
    rootsOn = on; roots.mesh.visible = on;
    if (!P) return;
    P.quarter.visible = !on; P.wallQ.visible = !on; P.faceA.visible = on; P.faceB.visible = on;
    blob.geometry = on ? blobPie : blobFull;
  }
  function setBlob(r) { blob.scale.set(r, 1, r); }

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function frame(o) {
    const L = leafMat.userData.U;
    L.uClock.value = o.clock; L.uTime.value = o.time; L.uWind.value = o.wind;
  }

  const api = {
    renderer, scene, camera, controls, branches, roots, leaves,
    setMode, setGradient, setSpecies, setPlant, setLeaves, setPlinth, setRootsOn, setBlob, resize, frame,
    get plinth() { return { R: plinthR, D: plinthD }; },
    setLeavesOn(on) { leaves.visible = on; },
    render() { renderer.render(scene, camera); },
  };
  return api;
}
