// ============================================================================
//  CORAL REEF  ·  the ROV dive scene (three.js r160, ES module)
// ----------------------------------------------------------------------------
//  Dark deep water over one circular reef plot of radius R. What it draws:
//    water ......... a dome with the fog colour and a dim Snell window
//    rock .......... the ROCK meshes (rock/index.js), triplanar CC0 stone
//    sand .......... the ROCK sand floor in the hollows
//    corals ........ the SDF meshes of the CORAL mesher: one group per
//                    colony at its base, one mesh per chunk of bricks
//    polyps ........ one instanced mesh per chunk (shaders.js POLYP_*)
//    snow .......... marine snow round the eye, lit only in the beams
//  The ROV package adds its vehicles to the scene. setLights() takes
//  their SpotLights: the first one is the lead lamp, with a shadow map.
//
//  FRAME. Each frame (render):
//    1. caustics .. the mesh-area pass fills the caustic map (water.js
//                   waves, CAUSTIC_VS / CAUSTIC_FS), over the plot
//    2. scene ..... into a float target with a depth texture (linear
//                   light); three renders the lead shadow map first
//    3. volume .... VOL_FS at half size: the lamp cones, the lead shadow
//                   shafts and the downwell shafts, from the depth
//    4. frame ..... COMP_FS: scene + volume, ACES, vignette, grain, sRGB
//    5. exposure .. every 12 frames LUM_FS fills a 32 x 32 log-luminance
//                   target; gpu-safe.js exposureFrom sets uExposure
//  With no float target (old phones) the scene goes straight to the
//  canvas with no volume pass. The full-frame passes use gpu-safe.js
//  fullTri (a finite draw range: three r160 skips a geometry with no
//  index and no 'position'). The first frames clear the canvas to the
//  SENTINEL colour and read the centre pixel after the composite: two
//  misses and the scene goes straight to the canvas (S.post has the state).
//
//  Per-particle coral data lives in two float textures (PART_W wide):
//  A = natural rgb, colour t; B = birth s, radius, sway level x 2 + tip,
//  height over the base. A colour change writes texels only.
//
//  grep -n targets
//    shared uniforms ........ "const U = {"
//    caustic pass ........... "function makeCaustics"
//    lamps .................. "function setLights"
//    rock and sand .......... "function setRock"
//    coral chunks ........... "function applyBricks"
//    chunk rebuild .......... "function rebuildChunk"
//    polyp template ......... "function polypTemplate"
//    particle textures ...... "function setParticles"
//    snow ................... "function makeSnow"
//    passes ................. "function makePasses"
//    the frame .............. "function render"
//    the scene object ....... "export function createScene"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as SH from './shaders.js';
import { waveSpectrum, CAUSTIC_D, FADE_K, N_WAVES } from './water.js';
import { fullTri, SENTINEL, isSentinel, exposureFrom } from './gpu-safe.js';

export const SURFACE_Y = SH.SURFACE_Y;
export const PART_W = 512;          // particle texture width
const SPECIES_CODE = { staghorn: 0, fan: 1, table: 2, boulder: 3, finger: 4 };
// polyp look per species: size (m), how far the tentacles reach, tint, green fluorescence
const POLYP_LOOK = {
  staghorn: { size: 0.0045, extend: 0.85, tint: [0.92, 0.86, 1.0], fluor: 0.7 },
  fan: { size: 0.003, extend: 1.0, tint: [1.0, 0.95, 0.92], fluor: 0.15 },
  table: { size: 0.004, extend: 0.7, tint: [0.85, 1.0, 0.82], fluor: 0.9 },
  boulder: { size: 0.0036, extend: 0.45, tint: [0.95, 0.9, 0.7], fluor: 0.5 },
  finger: { size: 0.006, extend: 1.0, tint: [1.0, 0.94, 0.96], fluor: 0.12 },
};
// The lamp intensity scale: a three.js SpotLight intensity (candela) to
// the radiance unit of shaders.js spotRad.
export const LAMP_K = 0.004;

// ── caustic pass ────────────────────────────────────────────────────────────
// One grid of rays over the plot square and a margin (no tile, no repeat).
function makeCaustics(renderer, U, coarse, R, cfg) {
  const RES = cfg && cfg.res ? cfg.res : coarse ? 512 : 1024;
  const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(RES, RES, {
    type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  const G = cfg && cfg.grid ? cfg.grid : coarse ? 200 : 360;
  const uv = new Float32Array((G + 1) * (G + 1) * 2), idx = new Uint32Array(G * G * 6);
  for (let j = 0, k = 0; j <= G; j++) for (let i = 0; i <= G; i++) { uv[k++] = i / G; uv[k++] = j / G; }
  for (let j = 0, o = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1; idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = b; idx[o++] = d; idx[o++] = c; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const box = new THREE.Vector4();
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: SH.CAUSTIC_VS, fragmentShader: SH.CAUSTIC_FS,
    uniforms: {
      uWave: { value: Array.from({ length: N_WAVES }, () => new THREE.Vector4()) }, uBox: { value: box },
      uD: { value: CAUSTIC_D }, uT: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.18, -1, 0.1).normalize() }, uGain: { value: half ? 1 : 0.25 },
    },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function setSeed(seed) { waveSpectrum(seed).forEach((w, i) => mat.uniforms.uWave.value[i].set(w[0], w[1], w[2], w[3])); }
  // The map square covers the plot fade; the grid has a 6% margin each side.
  function setPlot(r) {
    const size = 2 * FADE_K * r + 8;
    box.set(-size / 2, -size / 2, size, 0.06);
    U.uCaustBox.value.set(-size / 2, -size / 2, size, 0);
  }
  setSeed(1); setPlot(R);
  U.uCaustTex.value = rt.texture;
  U.uCaustScale.value = half ? 1 : 4;
  const T0 = refractY(mat.uniforms.uSunDir.value);
  U.uSunXZ.value.set(T0[0] / -T0[1], T0[2] / -T0[1], 0);
  return {
    rt, half, setSeed, setPlot,
    render(t) {
      mat.uniforms.uT.value = t;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
      renderer.render(sc, cam);
      renderer.setRenderTarget(prev);
    },
  };
}
// The refracted sun direction for a flat sea (index 1.333).
function refractY(d) {
  const eta = 1 / 1.333, c = -d.y, k = 1 - eta * eta * (1 - c * c), s = eta * c - Math.sqrt(k);
  return [eta * d.x, eta * d.y + s, eta * d.z];
}

// ── polyp template: a cup (wall and top) and 8 tentacle ribbons ─────────────
function polypTemplate() {
  const T = [], I = [];
  const v = (a, s, z, w) => { T.push(a, s, z, w); return T.length / 4 - 1; };
  const S = 8;
  for (let i = 0; i < S; i++) {
    const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2;
    const p = v(a0, 0, 0.7, 0), q = v(a1, 0, 0.7, 0), r = v(a1, 1, 1, 0), t = v(a0, 1, 1, 0);
    I.push(p, r, q, p, t, r);
  }
  for (let i = 0; i < S; i++) {
    const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2;
    const p = v(a0, 1, 1, 1), q = v(a1, 1, 1, 1), r = v(a1, 1, 0.42, 1), t = v(a0, 1, 0.42, 1);
    I.push(p, q, r, p, r, t);
  }
  for (let i = 0; i < S; i++) {
    const a = (i + 0.5) / S * Math.PI * 2;
    let prev = null;
    for (let s = 0; s <= 3; s++) {
      const l = v(a, s / 3, -1, 2), r = v(a, s / 3, 1, 2);
      if (prev) I.push(prev[0], prev[1], r, prev[0], r, l);
      prev = [l, r];
    }
  }
  return { aT: new Float32Array(T), index: I };
}

// A geometry from { positions, normals, indices, uv?, cavity?, band? }.
function geomOf(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  else g.computeVertexNormals();
  const n = m.positions.length / 3;
  g.setAttribute('cavity', new THREE.BufferAttribute(m.cavity && m.cavity.length === n ? m.cavity : new Float32Array(n), 1));
  let band = m.band;
  if (!band || band.length !== n) { band = new Float32Array(n); for (let i = 0; i < n; i++) band[i] = m.positions[i * 3 + 1] / 1.1; }
  g.setAttribute('band', new THREE.BufferAttribute(band, 1));
  if (m.indices) g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

// profile: a budget.js profile (caustic, shadow, vol, snow, polypDraw);
// none: the old coarse / fine sizes. onShaderError(text): a shader did
// not compile or link (three r160 renderer.debug.onShaderError).
export function createScene({ canvas, coarse, onNoGL, R = 30, maxParticles = 131072, profile = null, onShaderError = null }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 needed');
  } catch (e) { if (onNoGL) onNoGL(e); return null; }
  const LD = {
    shadow: profile ? profile.shadow : coarse ? 1024 : 2048,
    volScale: profile ? profile.vol.scale : coarse ? 0.4 : 0.5, volSteps: profile ? profile.vol.steps : coarse ? 14 : 30,
    snow: profile ? profile.snow : coarse ? 2600 : 7000, polypDraw: profile ? profile.polypDraw : coarse ? 30000 : 160000,
  };
  renderer.debug.checkShaderErrors = true;
  if (onShaderError) renderer.debug.onShaderError = (gl, program, vs, fs) => { try { onShaderError(shaderErrorText(gl, program, vs, fs)); } catch (e) { onShaderError(String(e)); } };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;          // shaders.js does its own PCF on the packed depth
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x01060a, 0.045);           // for the ROV package's standard materials
  const camera = new THREE.PerspectiveCamera(50, 1, 0.08, 400);
  camera.position.set(18, 12, 22);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.target.set(0, 2, 0);
  controls.minDistance = 1.2; controls.maxDistance = 90;
  controls.maxPolarAngle = 1.62; controls.enablePan = true; controls.screenSpacePanning = true;
  controls.rotateSpeed = coarse ? 0.6 : 0.8;

  const lutData = new Uint8Array(256 * 4);
  const lutTex = new THREE.DataTexture(lutData, 256, 1, THREE.RGBAFormat);
  lutTex.colorSpace = THREE.SRGBColorSpace; lutTex.magFilter = THREE.LinearFilter; lutTex.minFilter = THREE.LinearFilter;
  lutTex.needsUpdate = true;

  const PH = Math.ceil(maxParticles / PART_W), NP = PART_W * PH;
  const partA = new Float32Array(NP * 4), partB = new Float32Array(NP * 4);
  const mkPart = (data) => { const t = new THREE.DataTexture(data, PART_W, PH, THREE.RGBAFormat, THREE.FloatType); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
  const texA = mkPart(partA), texB = mkPart(partB);

  const v4 = () => new THREE.Vector4();
  const U = {
    uTime: { value: 0 }, uCaust: { value: 1 }, uR: { value: R }, uDown: { value: 0.6 },
    uFogK: { value: new THREE.Vector3(0.07, 0.04, 0.03) }, uFogCol: { value: new THREE.Vector3(0.0016, 0.0062, 0.0105) },
    uSunXZ: { value: new THREE.Vector3() }, uCaustBox: { value: new THREE.Vector4() }, uCaustTex: { value: null }, uCaustScale: { value: 1 },
    uCur: { value: new THREE.Vector2(1, 0) },
    uSpotN: { value: 0 }, uSpotP: { value: [v4(), v4(), v4(), v4()] }, uSpotD: { value: [v4(), v4(), v4(), v4()] }, uSpotC: { value: [v4(), v4(), v4(), v4()] },
    uShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uShadowBias: { value: -0.0006 }, uShadowTexel: { value: 1 / 2048 },
    uLut: { value: lutTex }, uMode: { value: 0 }, uCount: { value: 1 }, uBleach: { value: 0 }, uSwayK: { value: 1 },
    uPartA: { value: texA }, uPartB: { value: texB }, uPartW: { value: PART_W }, uDetail: { value: 1 }, uDetailK: { value: 14 }, uKeep: { value: 1 },
  };
  const waterU = () => {
    const o = {};
    for (const k of ['uTime', 'uCaust', 'uR', 'uDown', 'uFogK', 'uFogCol', 'uSunXZ', 'uCaustBox', 'uCaustTex', 'uCaustScale', 'uCur', 'uSpotN', 'uSpotP', 'uSpotD', 'uSpotC', 'uShadow', 'uShadowM', 'uShadowOn', 'uShadowBias', 'uShadowTexel']) o[k] = U[k];
    return o;
  };
  const caus = makeCaustics(renderer, U, coarse, R, profile && profile.caustic);

  // ── the water: fog colour, a dim Snell window above ─────────────────────
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, side: THREE.BackSide, depthWrite: false,
    uniforms: { uFogCol: U.uFogCol, uTime: U.uTime, uDown: U.uDown },
    vertexShader: 'out vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec3 uFogCol; uniform float uTime, uDown; in vec3 vD; out vec4 oCol;
      void main() {
        vec3 c = uFogCol * (0.55 + 0.9 * clamp(vD.y * 0.5 + 0.5, 0.0, 1.0));
        float win = smoothstep(0.62, 0.8, vD.y);
        c += vec3(0.004, 0.016, 0.03) * uDown * win * (0.85 + 0.15 * sin(uTime * 0.4 + vD.x * 9.0) * sin(uTime * 0.31 + vD.z * 7.0));
        oCol = linearToOutputTexel(vec4(c, 1.0));
      }`,
  }));
  dome.renderOrder = -1; dome.frustumCulled = false;
  scene.add(dome);

  // ── textures ──────────────────────────────────────────────────────────────
  const loader = new THREE.TextureLoader();
  function tex(path, srgb, onDone) {
    const t = loader.load(path, () => onDone && onDone(true), undefined, () => onDone && onDone(false));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = coarse ? 2 : 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const sandU = { uSand: { value: null }, uSandN: { value: null }, uTex: { value: 0 } };
  { let left = 2; const d = ok => { if (ok && --left === 0) sandU.uTex.value = 1; }; sandU.uSand.value = tex('assets/tex/sand_diff.jpg', true, d); sandU.uSandN.value = tex('assets/tex/sand_nor.jpg', false, d); }
  const rockU = { uAlb: { value: null }, uNrm: { value: null }, uOrm: { value: null }, uTex: { value: 0 }, uTexS: { value: 1 / 1.5 } };
  function setRockTextures(t = {}) {
    const albedo = t.albedo || 'assets/tex/rock/reef_rock_albedo.webp', normal = t.normal || 'assets/tex/rock/reef_rock_normal.webp', orm = t.orm || null;
    rockU.uTex.value = 0;
    let left = orm ? 3 : 2;
    const d = ok => { if (ok && --left === 0) rockU.uTex.value = 1; };
    rockU.uAlb.value = tex(albedo, true, d); rockU.uNrm.value = tex(normal, false, d);
    if (orm) rockU.uOrm.value = tex(orm, false, d);
    else { const w = new THREE.DataTexture(new Uint8Array([255, 150, 0, 255]), 1, 1); w.needsUpdate = true; rockU.uOrm.value = w; }
  }
  setRockTextures();

  // ── rock and sand ─────────────────────────────────────────────────────────
  const rockMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.ROCK_VS, fragmentShader: SH.ROCK_FS, uniforms: Object.assign(waterU(), rockU) });
  const sandMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.SURF_VS, fragmentShader: SH.SAND_FS, uniforms: Object.assign(waterU(), sandU) });
  const rockGroup = new THREE.Group(); scene.add(rockGroup);
  let sandMesh = null;
  // rock: the ROCK object (rock/index.js createRock). Meshes may come later
  // (a worker): addRockMeshes() takes more chunks.
  function setRock(rock) {
    for (const m of rockGroup.children.slice()) { rockGroup.remove(m); m.geometry.dispose(); }
    if (sandMesh) { scene.remove(sandMesh); sandMesh.geometry.dispose(); sandMesh = null; }
    if (!rock) return;
    if (rock.textures) setRockTextures(rock.textures);
    const tri = rock.material && rock.material.triplanar;
    rockU.uTexS.value = tri && tri.scale ? tri.scale : 1 / 1.5;
    addRockMeshes(rock.meshes || []);
    const sm = rock.sand && rock.sand.mesh;
    if (sm && sm.positions && sm.positions.length) {
      sandMesh = new THREE.Mesh(geomOf(sm), sandMat);
      sandMesh.receiveShadow = true; sandMesh.castShadow = false; sandMesh.userData.sand = true;
      scene.add(sandMesh);
    }
  }
  function addRockMeshes(list) {
    for (const m of list) {
      if (!m || !m.positions || !m.positions.length) continue;
      const mesh = new THREE.Mesh(geomOf(m), m.material === 'sand' ? sandMat : rockMat);
      mesh.castShadow = true; mesh.userData.rock = true;
      rockGroup.add(mesh);
    }
  }

  // ── corals ────────────────────────────────────────────────────────────────
  const coralMats = {}, coarseMats = {}, polypMats = {};
  const coralU = () => Object.assign(waterU(), { uPartA: U.uPartA, uPartB: U.uPartB, uPartW: U.uPartW, uLut: U.uLut, uMode: U.uMode, uCount: U.uCount, uBleach: U.uBleach, uSwayK: U.uSwayK });
  for (const id of Object.keys(SPECIES_CODE)) {
    coralMats[id] = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SH.CORAL_VS, fragmentShader: SH.CORAL_FS, side: THREE.DoubleSide,
      uniforms: Object.assign(coralU(), { uDetail: U.uDetail, uDetailK: U.uDetailK, uSpecies: { value: SPECIES_CODE[id] }, uCoarse: { value: 0 } }),
    });
    coarseMats[id] = coralMats[id].clone();
    Object.assign(coarseMats[id].uniforms, coralU(), { uDetail: U.uDetail, uDetailK: U.uDetailK, uSpecies: { value: SPECIES_CODE[id] }, uCoarse: { value: 1 } });
    const L = POLYP_LOOK[id];
    polypMats[id] = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SH.POLYP_VS, fragmentShader: SH.POLYP_FS, side: THREE.DoubleSide,
      uniforms: Object.assign(coralU(), { uKeep: U.uKeep, uSize: { value: L.size }, uExtend: { value: L.extend }, uTint: { value: new THREE.Vector3(...L.tint) }, uFluor: { value: L.fluor } }),
    });
  }
  const tpl = polypTemplate();
  const tplAT = new THREE.BufferAttribute(tpl.aT, 4);
  const tplPos = new THREE.BufferAttribute(new Float32Array(tpl.aT.length / 4 * 3), 3);
  const tplIndex = new THREE.Uint16BufferAttribute(tpl.index, 1);

  const coralRoot = new THREE.Group(); scene.add(coralRoot);
  const colonies = new Map();
  const dirtyChunks = new Set();
  let polypTotal = 0;
  let polypBudget = LD.polypDraw;

  function clearColonies() {
    for (const c of colonies.values()) for (const ch of c.chunks.values()) disposeChunk(ch);
    colonies.clear(); dirtyChunks.clear(); polypTotal = 0;
    for (const g of coralRoot.children.slice()) coralRoot.remove(g);
  }
  function addColonyGroup(k, id, base) {
    const group = new THREE.Group(); group.position.set(base[0], base[1], base[2]);
    coralRoot.add(group);
    const c = { k, id: SPECIES_CODE[id] !== undefined ? id : 'staghorn', group, chunks: new Map() };
    colonies.set(k, c);
    return c;
  }
  function disposeChunk(ch) {
    if (ch.mesh) { ch.mesh.geometry.dispose(); ch.mesh.parent && ch.mesh.parent.remove(ch.mesh); ch.mesh = null; }
    if (ch.poly) { ch.poly.geometry.dispose(); ch.poly.parent && ch.poly.parent.remove(ch.poly); ch.poly = null; }
    polypTotal -= ch.np || 0; ch.np = 0;
  }
  // Brick results from the mesher: { k, chunk, key, positions, normals, gids, indices, polyps }.
  // A brick of the world-frame mesher (k -1) goes to the group of its
  // species (sp) at the origin; an older brick to the group of colony k.
  function groupFor(r) {
    const key = r.sp ? `${r.sp}|${r.lod || 0}` : r.k;
    let c = colonies.get(key);
    if (!c && r.sp) { c = addColonyGroup(key, r.sp, [0, 0, 0]); c.lod = r.lod || 0; }
    return c;
  }
  function applyBricks(list) {
    for (const r of list) {
      const c = groupFor(r); if (!c) continue;
      let ch = c.chunks.get(r.chunk);
      if (!ch) { ch = { key: r.chunk, col: c, bricks: new Map(), mesh: null, poly: null, np: 0, at: 0 }; c.chunks.set(r.chunk, ch); }
      if (r.indices.length) ch.bricks.set(r.key, r); else ch.bricks.delete(r.key);
      dirtyChunks.add(ch);
    }
  }
  function rebuildChunk(ch) {
    let nv = 0, ni = 0, npol = 0;
    for (const b of ch.bricks.values()) { nv += b.positions.length / 3; ni += b.indices.length; npol += (b.polyps ? b.polyps.length : 0) / 8; }
    const c = ch.col;
    if (!nv) { disposeChunk(ch); c.chunks.delete(ch.key); return; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), Gd = new Float32Array(nv), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const PP = new Float32Array(npol * 8);
    let ov = 0, oi = 0, op = 0;
    for (const b of ch.bricks.values()) {
      P.set(b.positions, ov * 3); N.set(b.normals, ov * 3); Gd.set(b.gids, ov);
      const bi = b.indices;
      for (let i = 0; i < bi.length; i++) I[oi + i] = bi[i] + ov;
      ov += b.positions.length / 3; oi += bi.length;
      if (b.polyps) { PP.set(b.polyps, op); op += b.polyps.length; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('aGid', new THREE.BufferAttribute(Gd, 1));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius += 0.1;
    if (ch.mesh) { ch.mesh.geometry.dispose(); ch.mesh.geometry = geo; }
    else { ch.mesh = new THREE.Mesh(geo, (c.lod ? coarseMats : coralMats)[c.id]); ch.mesh.castShadow = true; c.group.add(ch.mesh); }
    polypTotal -= ch.np; ch.np = npol; polypTotal += npol;
    if (ch.poly) ch.poly.geometry.dispose();
    if (npol) {
      const pg = new THREE.InstancedBufferGeometry();
      pg.setAttribute('position', tplPos.clone()); pg.setAttribute('aT', tplAT.clone()); pg.setIndex(tplIndex.clone());
      const ib = new THREE.InstancedInterleavedBuffer(PP, 8, 1);
      pg.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      pg.setAttribute('iNrm', new THREE.InterleavedBufferAttribute(ib, 3, 3));
      pg.setAttribute('iData', new THREE.InterleavedBufferAttribute(ib, 2, 6));
      pg.instanceCount = npol;
      pg.boundingSphere = geo.boundingSphere ? geo.boundingSphere.clone() : null;
      if (pg.boundingSphere) pg.boundingSphere.radius += 0.05;
      if (ch.poly) ch.poly.geometry = pg;
      else { ch.poly = new THREE.Mesh(pg, polypMats[c.id]); c.group.add(ch.poly); }
    } else if (ch.poly) { ch.poly.parent && ch.poly.parent.remove(ch.poly); ch.poly = null; }
  }
  function flushChunks(ms = 3, nowMs = 0, minGap = 180) {
    const t0 = performance.now();
    for (const ch of dirtyChunks) {
      if (nowMs - ch.at < minGap) continue;
      dirtyChunks.delete(ch);
      ch.at = nowMs;
      rebuildChunk(ch);
      if (performance.now() - t0 > ms) break;
    }
    U.uKeep.value = Math.min(1, polypBudget / Math.max(1, polypTotal));
  }
  function setPolypsVisible(on) {
    for (const c of colonies.values()) for (const ch of c.chunks.values()) if (ch.poly) ch.poly.visible = on;
  }

  // ── particle data ─────────────────────────────────────────────────────────
  let texDirty = false, texAt = 0;
  function setParticles(from, to, f) {
    to = Math.min(to, NP);
    for (let g = from; g < to; g++) f(g, partA, partB, g * 4);
    texDirty = true;
  }
  function writeT(t, n) { n = Math.min(n, NP); for (let g = 0; g < n; g++) partA[g * 4 + 3] = t[g]; texDirty = true; }
  function uploadParticles(nowMs, force) {
    if (!texDirty || (!force && nowMs - texAt < 60)) return;
    texA.needsUpdate = true; texB.needsUpdate = true; texDirty = false; texAt = nowMs;
  }

  // ── marine snow ───────────────────────────────────────────────────────────
  const snowU = { uOff: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(26, 26, 26) }, uPx: { value: 300 } };
  function makeSnow(n) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = Math.random() * 26; p[i * 3 + 1] = Math.random() * 26; p[i * 3 + 2] = Math.random() * 26;
      s[i] = 0.004 + Math.random() * Math.random() * 0.016;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: Object.assign(waterU(), snowU), vertexShader: SH.SNOW_VS, fragmentShader: SH.SNOW_FS,
    });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
    return pts;
  }
  const snow = makeSnow(LD.snow); scene.add(snow);

  // ── lamps ─────────────────────────────────────────────────────────────────
  let lamps = [];
  // list: THREE.SpotLight objects (the ROV lamps). The first is the lead lamp.
  function setLights(list) {
    lamps = (list || []).filter(l => l && l.isSpotLight).slice(0, SH.MAX_SPOTS);
    const lead = lamps[0];
    if (lead) {
      lead.castShadow = LD.shadow > 0;
      const sz = Math.max(256, LD.shadow || 512);
      if (lead.shadow.mapSize.x !== sz) { lead.shadow.mapSize.set(sz, sz); if (lead.shadow.map) { lead.shadow.map.dispose(); lead.shadow.map = null; } }
      lead.shadow.bias = 0;
      U.uShadowTexel.value = 1 / sz;
    }
    for (const l of lamps.slice(1)) l.castShadow = false;
  }
  const P3 = new THREE.Vector3(), T3 = new THREE.Vector3();
  function updateLamps() {
    U.uSpotN.value = lamps.length;
    lamps.forEach((l, i) => {
      l.getWorldPosition(P3);
      if (l.target) l.target.getWorldPosition(T3); else T3.set(P3.x, P3.y - 1, P3.z);
      T3.sub(P3).normalize();
      const k = (l.visible === false ? 0 : l.intensity) * LAMP_K;
      U.uSpotP.value[i].set(P3.x, P3.y, P3.z, l.distance || 30);
      U.uSpotD.value[i].set(T3.x, T3.y, T3.z, Math.cos(l.angle));
      U.uSpotC.value[i].set(l.color.r * k, l.color.g * k, l.color.b * k, Math.cos(l.angle * (1 - Math.max(0.05, l.penumbra))));
    });
    const lead = lamps[0];
    const map = lead && lead.castShadow && lead.shadow && lead.shadow.map;
    if (map) { U.uShadow.value = map.texture; U.uShadowM.value.copy(lead.shadow.matrix); U.uShadowOn.value = 1; }
    else U.uShadowOn.value = 0;
  }

  // ── passes ────────────────────────────────────────────────────────────────
  const passes = makePasses();
  function makePasses() {
    const fl = caus.half;
    if (!fl) return null;
    // aPos only: fullTri sets the draw range (three r160 draws nothing
    // for a geometry with no index and no 'position', gpu-safe.js)
    const tri = fullTri(THREE);
    const depthTex = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    const rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: depthTex, depthBuffer: true, stencilBuffer: false });
    const rtVol = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const volU = Object.assign(waterU(), {
      uEye: { value: new THREE.Vector3() }, uDepth: { value: depthTex }, uProjInv: { value: new THREE.Matrix4() }, uCamW: { value: new THREE.Matrix4() },
      uSteps: { value: LD.volSteps }, uVolMax: { value: 40 }, uScatter: { value: 1 }, uShaft: { value: 1 }, uFrame: { value: 0 },
    });
    const volMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.FULL_VS, fragmentShader: SH.VOL_FS, uniforms: volU, depthTest: false, depthWrite: false });
    const debugNaN = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search || '') ? 1 : 0;
    const compU = { uScene: { value: rtScene.texture }, uVol: { value: rtVol.texture }, uVolTexel: { value: new THREE.Vector2() }, uExposure: { value: 4 }, uGrain: { value: 0.012 }, uTime: U.uTime, uVig: { value: 0.55 }, uDebugNaN: { value: debugNaN } };
    const compMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.FULL_VS, fragmentShader: SH.COMP_FS, uniforms: compU, depthTest: false, depthWrite: false });
    const volMesh = new THREE.Mesh(tri, volMat), compMesh = new THREE.Mesh(tri, compMat);
    volMesh.frustumCulled = compMesh.frustumCulled = false;
    const volScene = new THREE.Scene(), compScene = new THREE.Scene();
    volScene.add(volMesh); compScene.add(compMesh);
    // the auto exposure: the log luminance of the frame in a 32 x 32 RGBA8 target
    const LUM_N = 32;
    const rtLum = new THREE.WebGLRenderTarget(LUM_N, LUM_N, { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false });
    const lumU = { uScene: { value: rtScene.texture }, uVol: { value: rtVol.texture }, uTap: { value: new THREE.Vector2() } };
    const lumMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.FULL_VS, fragmentShader: SH.LUM_FS, uniforms: lumU, depthTest: false, depthWrite: false });
    const lumMesh = new THREE.Mesh(tri, lumMat); lumMesh.frustumCulled = false;
    const lumScene = new THREE.Scene(); lumScene.add(lumMesh);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      rtScene, rtVol, rtLum, lumScene, lumBuf: new Uint8Array(LUM_N * LUM_N * 4), LUM_N, lumU,
      volU, compU, volScene, compScene, ortho, scale: LD.volScale,
      size(w, h) {
        rtScene.setSize(w, h);
        const vw = Math.max(1, Math.round(w * this.scale)), vh = Math.max(1, Math.round(h * this.scale));
        rtVol.setSize(vw, vh); compU.uVolTexel.value.set(1 / vw, 1 / vh);
        lumU.uTap.value.set(0.25 / LUM_N, 0.25 / LUM_N);
      },
    };
  }

  // Polyp radius per species (coral-sdf.js SHAPES[id].polyp.size, metres).
  function setPolypSizes(shapes) {
    for (const id of Object.keys(polypMats)) { const z = shapes && shapes[id] && shapes[id].polyp && shapes[id].polyp.size; if (z) polypMats[id].uniforms.uSize.value = z; }
  }
  function setLut(bytes) { lutData.set(bytes); lutTex.needsUpdate = true; }
  function setPlot(r) { U.uR.value = r; caus.setPlot(r); }

  // The loads that the frame governor (budget.js frameGovernor) changes:
  // { volScale, volSteps, polypDraw, shadow (map size, 0 off) }.
  function setLoads(o = {}) {
    if (o.polypDraw !== undefined) polypBudget = Math.max(0, o.polypDraw);
    if (passes && o.volSteps !== undefined) passes.volU.uSteps.value = Math.max(4, Math.round(o.volSteps));
    if (passes && o.volScale !== undefined && o.volScale !== passes.scale) { passes.scale = o.volScale; resize(); }
    if (o.shadow !== undefined && o.shadow !== LD.shadow) { LD.shadow = o.shadow; setLights(lamps); if (!o.shadow) U.uShadowOn.value = 0; }
    Object.assign(LD, o);
  }
  const view = { ox: 0, oy: 0, tox: 0, toy: 0 };
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    snowU.uPx.value = h * pr * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    if (passes) passes.size(Math.round(w * pr), Math.round(h * pr));
  }

  const opts = { volume: true, caustics: true, snow: true };
  let frameN = 0;
  // post: the state of the post chain. checks: the first frames read the
  // centre pixel after the composite (gpu-safe.js SENTINEL); two misses
  // and the page draws the scene straight to the canvas.
  const post = { on: !!passes, checks: 0, misses: 0, failed: false, exposure: passes ? passes.compU.uExposure.value : 1, reason: '' };
  const px1 = new Uint8Array(4);
  function postFail(why) {
    post.on = false; post.failed = true; post.reason = why;
    renderer.setClearColor(0x000000, 1);
    console.warn('coral-reef: the post chain did not draw; the scene goes straight to the canvas (' + why + ')');
  }
  function checkFrame() {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    try { gl.readPixels(w >> 1, h >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); } catch (e) { return; }
    post.checks++;
    if (isSentinel(px1)) { post.misses++; if (post.misses >= 2) postFail('the composite left the sentinel'); }
  }
  function autoExposure() {
    if (!passes) return;
    renderer.setRenderTarget(passes.rtLum);
    renderer.render(passes.lumScene, passes.ortho);
    try { renderer.readRenderTargetPixels(passes.rtLum, 0, 0, passes.LUM_N, passes.LUM_N, passes.lumBuf); } catch (e) { return; }
    post.exposure = exposureFrom(passes.lumBuf, post.exposure);
    passes.compU.uExposure.value = post.exposure;
  }
  // cam: the camera to draw with (the main camera, or a saver camera).
  function render(dt, nowMs = performance.now()) {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const k = 1 - Math.exp(-dt * 6);
    view.ox += (view.tox - view.ox) * k; view.oy += (view.toy - view.oy) * k;
    if (Math.abs(view.ox) > 0.5 || Math.abs(view.oy) > 0.5) camera.setViewOffset(w, h, view.ox, view.oy, w, h);
    else camera.clearViewOffset();
    uploadParticles(nowMs);
    U.uCaust.value = opts.caustics ? Math.max(0.0001, U.uCaust.value) : 0;
    if (opts.caustics && (!coarse || (frameN & 1) === 0)) caus.render(U.uTime.value);
    snow.visible = opts.snow;
    scene.updateMatrixWorld();
    // the shadow matrix of this frame (the shadow pass of render() computes the same)
    if (lamps[0] && lamps[0].castShadow) lamps[0].shadow.updateMatrices(lamps[0]);
    updateLamps();
    frameN++;
    if (!passes || !post.on) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(passes.rtScene);
    renderer.render(scene, camera);
    if (U.uShadowOn.value < 0.5) updateLamps();            // the first shadow map is there now
    const vu = passes.volU;
    if (opts.volume) {
      vu.uEye.value.setFromMatrixPosition(camera.matrixWorld);
      vu.uProjInv.value.copy(camera.projectionMatrixInverse);
      vu.uCamW.value.copy(camera.matrixWorld);
      vu.uFrame.value = frameN % 64;
      renderer.setRenderTarget(passes.rtVol);
      renderer.render(passes.volScene, passes.ortho);
    } else {
      renderer.setRenderTarget(passes.rtVol); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
    }
    if (frameN % 12 === 3) autoExposure();
    renderer.setRenderTarget(null);
    const check = post.checks < 4 && frameN > 1;
    if (check) renderer.setClearColor(new THREE.Color(SENTINEL[0], SENTINEL[1], SENTINEL[2]), 1);
    renderer.render(passes.compScene, passes.ortho);
    if (check) { checkFrame(); if (post.on) renderer.setClearColor(0x000000, 1); }
  }

  return {
    renderer, scene, camera, controls, U, THREE, view, opts, rockGroup, coralRoot, snow, caustics: caus, passes,
    get sand() { return sandMesh; }, post,
    setRock, addRockMeshes, setPlot, setLoads, get loads() { return Object.assign({}, LD); }, setPolypSizes, setLights, setLut, resize, render,
    clearColonies, addColonyGroup, applyBricks, flushChunks, setParticles, writeT, uploadParticles, setPolypsVisible,
    get polypTotal() { return polypTotal; }, get dirtyChunks() { return dirtyChunks.size; }, get lamps() { return lamps; },
    PART_W, maxParticles: NP,
  };
}

// The text of a shader that did not compile or link: the program log, each
// shader log, and the source lines that the logs name (with numbers), so
// the user can report it.
export function shaderErrorText(gl, program, vs, fs) {
  const out = [];
  const plog = gl.getProgramInfoLog(program) || '';
  if (plog.trim()) out.push('program: ' + plog.trim());
  for (const [name, sh] of [['vertex', vs], ['fragment', fs]]) {
    if (!sh) continue;
    const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
    const log = (gl.getShaderInfoLog(sh) || '').trim();
    if (ok && !log) continue;
    out.push(`${name}: ${log || '(no log)'}`);
    const src = (gl.getShaderSource(sh) || '').split('\n');
    const nums = new Set();
    for (const m of log.matchAll(/ERROR:\s*\d+:(\d+)/g)) nums.add(+m[1]);
    for (const n of [...nums].slice(0, 3)) for (let i = Math.max(1, n - 2); i <= Math.min(src.length, n + 2); i++) out.push(`  ${String(i).padStart(4)}${i === n ? ' >' : '  '} ${src[i - 1]}`);
  }
  return out.join('\n').slice(0, 4000);
}
