// ============================================================================
//  CORAL REEF  ·  the ROV dive scene (three.js r160, ES module)
// ----------------------------------------------------------------------------
//  Dark deep water over one circular reef plot of radius R. What it draws:
//    water ......... a dome with the fog colour and a dim Snell window
//    rock .......... the ROCK meshes (rock/index.js), triplanar CC0 stone
//    sand .......... the ROCK sand floor in the hollows
//    corals ........ the SDF meshes of the CORAL mesher: one group per
//                    species and lod (coarse), one group per fine colony
//                    (lod 0, k >= 0), one mesh per chunk of bricks. A
//                    chunk rebuild swaps the geometry of its mesh in place.
//    polyps ........ one instanced mesh per chunk (shaders.js POLYP_*)
//    snow .......... marine snow round the eye (lib/marine-snow.js): flocs,
//                    strings, pellets, bokeh near the eye, forward scatter
//  The ROV package adds its vehicles to the scene. setLights() takes
//  their SpotLights: the main lamp of each ROV comes first and has a
//  shadow map (lead: profile.shadow, others: profile.shadowExtra). The
//  rock, the coral and (desktop) the polyps cast into them; the coral and
//  polyps with a custom depth material (shaders.js CORAL_DEPTH_VS).
//
//  FRAME. Each frame (render):
//    1. caustics .. the mesh-area pass fills the caustic map (water.js
//                   waves, CAUSTIC_VS / CAUSTIC_FS), over the plot
//    2. scene ..... into a float target with a depth texture (linear
//                   light); three renders the lamp shadow maps first
//    3. volume .... VOL_FS at vol.scale: the lamp cones, the shadow
//                   shafts of each mapped lamp and the downwell shafts,
//                   blue-noise jitter (volume.js has the plan)
//    3b. history .. VOL_TAA_FS: reprojection with the last view-
//                   projection, neighbourhood clip, two ping-pong targets
//    4. frame ..... COMP_FS: scene + volume (joint bilateral upsample
//                   with the full-res depth), ACES, vignette, grain,
//                   dither, sRGB
//    5. exposure .. every 12 frames LUM_FS fills a 32 x 32 log-luminance
//                   target; gpu-safe.js exposureFrom sets uExposure
//  With no float target (old phones) the scene goes straight to the
//  canvas with no volume pass. The full-frame passes use gpu-safe.js
//  fullTri (a finite draw range: three r160 skips a geometry with no
//  index and no 'position'). The first frames clear the canvas to the
//  SENTINEL colour and read the centre pixel after the composite: two
//  misses and the scene goes straight to the canvas (S.post has the state).
//
//  Per-particle coral data lives in three float textures (PART_W wide):
//  A = natural rgb, colour t; B = birth s, radius, sway level x 2 + tip,
//  height over the base; C = the parent minus the particle (m, xyz: the
//  grow-in slides a new tip out from its parent), the base height of the
//  colony (the sway). A colour change writes texels only.
//  setParticles(from, to, f): f(g, A, B, o, C) writes the texels at o.
//
//  WORLD (CONTRACT-V4.md). On the infinite seafloor the page uses the
//  world group instead of setRock and applyBricks: worldRoot at minus the
//  floating origin, a group per chunk (rock and sand, coarse coral) and per
//  fine colony, the caustic square round the eye (setCausticCentre), no
//  plot fade (setWorldMode). grep -n 'the infinite world'.
//
//  grep -n targets
//    world chunks ........... "the infinite world (CONTRACT-V4.md"
//    shared uniforms ........ "const U = {"
//    caustic pass ........... "function makeCaustics"
//    lamps .................. "function setLights"
//    rock and sand .......... "function setRock"
//    coral chunks ........... "function applyBricks"
//    shadow depth materials . "const coralDepth"
//    chunk rebuild .......... "function rebuildChunk"
//    fine groups (gate) ..... "const fineGroups"
//    polyp template ......... "function polypTemplate"
//    particle textures ...... "function setParticles"
//    snow ................... "const snowFx"
//    passes ................. "function makePasses"
//    the frame .............. "function render"
//    the scene object ....... "export function createScene"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as SH from './shaders.js';
import { waveSpectrum, CAUSTIC_D, FADE_K, N_WAVES } from './water.js';
import { fullTri, SENTINEL, isSentinel, exposureFrom } from './gpu-safe.js';
import { createMarineSnow } from '../../lib/marine-snow.js';
import { blueNoise, VOL_K } from './volume.js';

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
  // The infinite world (CONTRACT-V4.md): a square of `size` m round the eye
  // (render space). The rays start at absolute positions, so the pattern
  // at a point does not change when the square moves; the centre snaps to
  // 4 m steps.
  function setCentre(x, z, size = 96) {
    const cx = Math.round(x / 4) * 4, cz = Math.round(z / 4) * 4;
    box.set(cx - size / 2, cz - size / 2, size, 0.06);
    U.uCaustBox.value.set(cx - size / 2, cz - size / 2, size, 0);
  }
  setSeed(1); setPlot(R);
  U.uCaustTex.value = rt.texture;
  U.uCaustScale.value = half ? 1 : 4;
  const T0 = refractY(mat.uniforms.uSunDir.value);
  U.uSunXZ.value.set(T0[0] / -T0[1], T0[2] / -T0[1], 0);
  return {
    rt, half, setSeed, setPlot, setCentre,
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
    // the maps of the main lamps of the other ROVs (0: none), and polyps
    // in the shadow pass (many small instances: desktop only)
    shadowExtra: profile ? profile.shadowExtra ?? 0 : coarse ? 0 : 1024,
    polypShadow: profile ? !!profile.polypShadow : !coarse,
    volScale: profile ? profile.vol.scale : coarse ? 0.4 : 0.5, volSteps: profile ? profile.vol.steps : coarse ? 14 : 30,
    snow: profile ? profile.snow : coarse ? 2600 : 9000, polypDraw: profile ? profile.polypDraw : coarse ? 30000 : 160000,
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
  const partA = new Float32Array(NP * 4), partB = new Float32Array(NP * 4), partC = new Float32Array(NP * 4);
  const mkPart = (data) => { const t = new THREE.DataTexture(data, PART_W, PH, THREE.RGBAFormat, THREE.FloatType); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
  const texA = mkPart(partA), texB = mkPart(partB), texC = mkPart(partC);

  const v4 = () => new THREE.Vector4();
  const U = {
    uTime: { value: 0 }, uCaust: { value: 1 }, uR: { value: R }, uDown: { value: 0.6 },
    uFogK: { value: new THREE.Vector3(0.07, 0.04, 0.03) }, uFogCol: { value: new THREE.Vector3(0.0016, 0.0062, 0.0105) },
    uSunXZ: { value: new THREE.Vector3() }, uCaustBox: { value: new THREE.Vector4() }, uCaustTex: { value: null }, uCaustScale: { value: 1 },
    uCur: { value: new THREE.Vector2(1, 0) },
    uSpotN: { value: 0 }, uSpotP: { value: [v4(), v4(), v4(), v4()] }, uSpotD: { value: [v4(), v4(), v4(), v4()] }, uSpotC: { value: [v4(), v4(), v4(), v4()] },
    uShadowM: { value: Array.from({ length: SH.MAX_SPOTS }, () => new THREE.Matrix4()) }, uShadowOn: { value: new THREE.Vector4() }, uShadowBias: { value: -0.0006 }, uShadowTexel: { value: new THREE.Vector4(1 / 2048, 1 / 2048, 1 / 2048, 1 / 2048) },
    uShadow0: { value: null }, uShadow1: { value: null }, uShadow2: { value: null }, uShadow3: { value: null },
    uLut: { value: lutTex }, uMode: { value: 0 }, uCount: { value: 1 }, uBleach: { value: 0 }, uSwayK: { value: 1 },
    uPartA: { value: texA }, uPartB: { value: texB }, uPartC: { value: texC }, uPartW: { value: PART_W }, uDetail: { value: 1 }, uDetailK: { value: 14 }, uKeep: { value: 1 },
  };
  const waterU = () => {
    const o = {};
    for (const k of ['uTime', 'uCaust', 'uR', 'uDown', 'uFogK', 'uFogCol', 'uSunXZ', 'uCaustBox', 'uCaustTex', 'uCaustScale', 'uCur', 'uSpotN', 'uSpotP', 'uSpotD', 'uSpotC', 'uShadow0', 'uShadow1', 'uShadow2', 'uShadow3', 'uShadowM', 'uShadowOn', 'uShadowBias', 'uShadowTexel']) o[k] = U[k];
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
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.rock = true;
      rockGroup.add(mesh);
    }
  }

  // ── corals ────────────────────────────────────────────────────────────────
  const coralMats = {}, coarseMats = {}, polypMats = {};
  const coralU = () => Object.assign(waterU(), { uPartA: U.uPartA, uPartB: U.uPartB, uPartC: U.uPartC, uPartW: U.uPartW, uLut: U.uLut, uMode: U.uMode, uCount: U.uCount, uBleach: U.uBleach, uSwayK: U.uSwayK });
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
  // the shadow depth of the coral and the polyps: the same vertex motion
  // (grow-in, the hidden coarse mesh of a focus colony, sway) as the colour
  // pass, RGBA packed depth (shaders.js DEPTH_FS); three's default depth
  // material would cast the full grown shape
  const depthU = () => ({ uTime: U.uTime, uCur: U.uCur, uPartA: U.uPartA, uPartB: U.uPartB, uPartC: U.uPartC, uPartW: U.uPartW, uSwayK: U.uSwayK });
  const coralDepth = [0, 1].map(c => new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: SH.CORAL_DEPTH_VS, fragmentShader: SH.DEPTH_FS, side: THREE.DoubleSide,
    uniforms: Object.assign(depthU(), { uCoarse: { value: c } }),
  }));
  const polypDepth = {};
  for (const id of Object.keys(SPECIES_CODE)) {
    polypDepth[id] = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SH.POLYP_DEPTH_VS, fragmentShader: SH.DEPTH_FS, side: THREE.DoubleSide,
      uniforms: Object.assign(depthU(), { uKeep: U.uKeep, uSize: polypMats[id].uniforms.uSize, uExtend: polypMats[id].uniforms.uExtend }),
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

  // Fine groups: one group per fine colony (bricks with k >= 0 and lod 0).
  // With the gate on (setFineGate), a new fine group is hidden until
  // showFine(k): the next flushChunks then builds all its dirty chunks and
  // shows it in one frame (takeShown() lists it, so the page hides the
  // coarse mesh of k then). dropFine(k) takes the group out of the map at
  // once (new bricks of k go to a new group) and removes it after one more
  // render, so the coarse mesh (shown first by the page) is there before
  // the fine one goes. No frame shows a colony with neither mesh.
  const fineGroups = new Map(), dying = [], shownQ = [];
  let fineGate = false;
  function clearColonies() {
    for (const c of colonies.values()) for (const ch of c.chunks.values()) disposeChunk(ch);
    for (const c of dying) for (const ch of c.chunks.values()) disposeChunk(ch);
    colonies.clear(); dirtyChunks.clear(); polypTotal = 0; fineGroups.clear(); dying.length = 0; shownQ.length = 0;
    for (const g of coralRoot.children.slice()) coralRoot.remove(g);
  }
  function setFineGate(on) { fineGate = !!on; }
  function showFine(k) { const c = fineGroups.get(k); if (c && !c.shown) c.want = true; return !!c; }
  function dropFine(k) {
    const c = fineGroups.get(k); if (!c) return false;
    fineGroups.delete(k); colonies.delete(c.key);
    for (const ch of c.chunks.values()) dirtyChunks.delete(ch);
    c.dieAt = frameN; dying.push(c);
    return true;
  }
  function reapDying() {
    for (let i = dying.length - 1; i >= 0; i--) {
      const c = dying[i]; if (frameN <= c.dieAt) continue;
      for (const ch of c.chunks.values()) disposeChunk(ch);
      c.group.parent && c.group.parent.remove(c.group);
      dying.splice(i, 1);
    }
  }
  function takeShown() { return shownQ.splice(0, shownQ.length); }
  function fineState(k) { const c = fineGroups.get(k); return c ? { shown: !!c.shown, want: !!c.want, chunks: c.chunks.size, dirty: [...c.chunks.values()].filter(ch => dirtyChunks.has(ch)).length } : null; }
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
    const fine = r.sp && !(r.lod || 0) && r.k >= 0;
    const key = r.sp ? (fine ? `${r.sp}|0|${r.k}` : `${r.sp}|${r.lod || 0}`) : r.k;
    let c = colonies.get(key);
    if (!c && r.sp) {
      c = addColonyGroup(key, r.sp, [0, 0, 0]); c.lod = r.lod || 0; c.key = key;
      if (fine) { c.fineK = r.k; c.shown = !fineGate; c.want = false; c.group.visible = c.shown; fineGroups.set(r.k, c); }
    }
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
    else { ch.mesh = new THREE.Mesh(geo, (c.lod ? coarseMats : coralMats)[c.id]); ch.mesh.castShadow = true; ch.mesh.receiveShadow = true; ch.mesh.customDepthMaterial = coralDepth[c.lod ? 1 : 0]; c.group.add(ch.mesh); }
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
      else { ch.poly = new THREE.Mesh(pg, polypMats[c.id]); ch.poly.castShadow = LD.polypShadow; ch.poly.customDepthMaterial = polypDepth[c.id]; c.group.add(ch.poly); }
    } else if (ch.poly) { ch.poly.parent && ch.poly.parent.remove(ch.poly); ch.poly = null; }
  }
  function flushChunks(ms = 3, nowMs = 0, minGap = 180) {
    // fine groups that may show now: all their chunks, then visible
    for (const c of fineGroups.values()) {
      if (!c.want || c.shown) continue;
      for (const ch of [...c.chunks.values()]) if (dirtyChunks.has(ch)) { dirtyChunks.delete(ch); ch.at = nowMs; rebuildChunk(ch); }
      c.want = false; c.shown = true; c.group.visible = true; shownQ.push(c.fineK);
    }
    const t0 = performance.now();
    for (const ch of dirtyChunks) {
      // a hidden fine group builds with no gap (it shows when complete)
      if (nowMs - ch.at < minGap && ch.col.shown !== false) continue;
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
    for (let g = from; g < to; g++) f(g, partA, partB, g * 4, partC);
    texDirty = true;
  }
  function writeT(t, n) { n = Math.min(n, NP); for (let g = 0; g < n; g++) partA[g * 4 + 3] = t[g]; texDirty = true; }
  function uploadParticles(nowMs, force) {
    if (!texDirty || (!force && nowMs - texAt < 60)) return;
    texA.needsUpdate = true; texB.needsUpdate = true; texC.needsUpdate = true; texDirty = false; texAt = nowMs;
  }

  // ── marine snow ───────────────────────────────────────────────────────────
  // lib/marine-snow.js with the light of this page (shaders.js SNOW_LIGHT).
  // snow: in the scene (the ROV feeds, and the frame when there is no post
  // chain). snowPost (after the passes): the main frame draws it after the
  // tone map, with the soft fade against the scene depth.
  const snowFx = createMarineSnow(THREE, {
    count: LD.snow, atlasSize: coarse ? 256 : 512, maxPx: coarse ? 14 : 24, maxStreak: coarse ? 20 : 36,
    box: coarse ? 20 : 24, nearBox: coarse ? 7 : 8,
    vertexShader: SH.SNOW_VS, fragmentShader: SH.SNOW_FS, uniforms: waterU(), ext: U.uFogK,
  });
  const snow = snowFx.mesh; scene.add(snow);
  let snowDepth = null;

  // ── lamps ─────────────────────────────────────────────────────────────────
  let lamps = [], mainN = 0;
  // list: THREE.SpotLight objects (the ROV lamps), the main lamp of each
  // ROV first (main.js buildROVs). mains: how many of the first lamps are
  // main lamps (default: the first lamps of distinct light.userData.vehicle,
  // at least 1). Lamp 0 (the lead) gets a map of LD.shadow, the other main
  // lamps a map of LD.shadowExtra, the rest none. A lamp that loses its
  // map frees it.
  function dropMap(l) { if (l.shadow && l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } }
  function setLights(list, mains) {
    lamps = (list || []).filter(l => l && l.isSpotLight).slice(0, SH.MAX_SPOTS);
    if (mains === undefined) {
      const seen = new Set(); mains = 0;
      for (const l of lamps) { const v = l.userData ? l.userData.vehicle : undefined; if (v === undefined || seen.has(v)) break; seen.add(v); mains++; }
    }
    mainN = lamps.length ? Math.max(1, Math.min(lamps.length, mains)) : 0;
    lamps.forEach((l, i) => {
      const sz = i === 0 ? LD.shadow : i < mainN ? LD.shadowExtra : 0;
      if (sz > 0) {
        const s = Math.max(256, sz);
        if (l.shadow.mapSize.x !== s) { l.shadow.mapSize.set(s, s); dropMap(l); }
        l.shadow.bias = 0;
        l.shadow.camera.near = 0.3;
        l.castShadow = true;
      } else { l.castShadow = false; dropMap(l); }
    });
  }
  const P3 = new THREE.Vector3(), T3 = new THREE.Vector3();
  const shadowTex = [U.uShadow0, U.uShadow1, U.uShadow2, U.uShadow3];
  // -> true when a lamp casts but three has not made its map yet
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
    let wait = false;
    for (let i = 0; i < SH.MAX_SPOTS; i++) {
      const l = lamps[i], map = l && l.castShadow && l.shadow && l.shadow.map;
      if (map) {
        shadowTex[i].value = map.texture; U.uShadowM.value[i].copy(l.shadow.matrix);
        U.uShadowOn.value.setComponent(i, 1); U.uShadowTexel.value.setComponent(i, 1 / l.shadow.mapSize.x);
      } else {
        U.uShadowOn.value.setComponent(i, 0); shadowTex[i].value = null;
        if (l && l.castShadow) wait = true;
      }
    }
    return wait;
  }

  // ── passes ────────────────────────────────────────────────────────────────
  const passes = makePasses();
  const snowScene = new THREE.Scene();
  if (passes) snowScene.add(snowFx.makeMesh({ soft: true, softLen: 0.3, post: true, depth: passes.rtScene.depthTexture, exposure: passes.compU.uExposure }));
  function makePasses() {
    const fl = caus.half;
    if (!fl) return null;
    // aPos only: fullTri sets the draw range (three r160 draws nothing
    // for a geometry with no index and no 'position', gpu-safe.js)
    const tri = fullTri(THREE);
    const depthTex = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    const rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: depthTex, depthBuffer: true, stencilBuffer: false });
    const rtVol = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    // the history of the volume: two targets, read one, write the other
    const rtHist = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    // 64 x 64 blue noise (volume.js blueNoise, made once: about 40 ms)
    const bn = blueNoise(64), bnData = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < bn.length; i++) bnData[i * 4] = bnData[i * 4 + 1] = bnData[i * 4 + 2] = bnData[i * 4 + 3] = bn[i];
    const blueTex = new THREE.DataTexture(bnData, 64, 64, THREE.RGBAFormat);
    blueTex.minFilter = blueTex.magFilter = THREE.NearestFilter; blueTex.wrapS = blueTex.wrapT = THREE.RepeatWrapping; blueTex.needsUpdate = true;
    const projInv = new THREE.Matrix4(), camW = new THREE.Matrix4();
    const volU = Object.assign(waterU(), {
      uEye: { value: new THREE.Vector3() }, uDepth: { value: depthTex }, uProjInv: { value: projInv }, uCamW: { value: camW }, uBlue: { value: blueTex },
      uSteps: { value: LD.volSteps }, uVolMax: { value: 40 }, uScatter: { value: VOL_K.scatter }, uShaft: { value: 1 }, uFrame: { value: 0 }, uNearLamp: { value: VOL_K.nearLamp },
    });
    const volMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.FULL_VS, fragmentShader: SH.VOL_FS, uniforms: volU, depthTest: false, depthWrite: false });
    const taaU = {
      uCur: { value: rtVol.texture }, uHist: { value: rtHist[0].texture }, uProjInv: { value: projInv }, uCamW: { value: camW }, uPrevVP: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2() }, uBlend: { value: VOL_K.blend }, uReset: { value: 1 }, uClip: { value: VOL_K.clipSd }, uReject: { value: VOL_K.depthReject },
    };
    const taaMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.FULL_VS, fragmentShader: SH.VOL_TAA_FS, uniforms: taaU, depthTest: false, depthWrite: false });
    const debugNaN = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search || '') ? 1 : 0;
    const compU = {
      uScene: { value: rtScene.texture }, uVol: { value: rtHist[0].texture }, uDepth: { value: depthTex }, uVolTexel: { value: new THREE.Vector2() }, uNearFar: { value: new THREE.Vector2(0.08, 400) },
      uSigRel: { value: VOL_K.sigmaRel }, uSigAbs: { value: VOL_K.sigmaAbs }, uExposure: { value: 4 }, uGrain: { value: 0.012 }, uTime: U.uTime, uVig: { value: 0.55 }, uDebugNaN: { value: debugNaN },
    };
    const compMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.FULL_VS, fragmentShader: SH.COMP_FS, uniforms: compU, depthTest: false, depthWrite: false });
    const volMesh = new THREE.Mesh(tri, volMat), compMesh = new THREE.Mesh(tri, compMat), taaMesh = new THREE.Mesh(tri, taaMat);
    volMesh.frustumCulled = compMesh.frustumCulled = taaMesh.frustumCulled = false;
    const volScene = new THREE.Scene(), compScene = new THREE.Scene(), taaScene = new THREE.Scene();
    volScene.add(volMesh); compScene.add(compMesh); taaScene.add(taaMesh);
    // the auto exposure: the log luminance of the frame in a 32 x 32 RGBA8 target
    const LUM_N = 32;
    const rtLum = new THREE.WebGLRenderTarget(LUM_N, LUM_N, { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false });
    const lumU = { uScene: { value: rtScene.texture }, uVol: { value: rtVol.texture }, uTap: { value: new THREE.Vector2() } };
    const lumMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: SH.FULL_VS, fragmentShader: SH.LUM_FS, uniforms: lumU, depthTest: false, depthWrite: false });
    const lumMesh = new THREE.Mesh(tri, lumMat); lumMesh.frustumCulled = false;
    const lumScene = new THREE.Scene(); lumScene.add(lumMesh);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      rtScene, rtVol, rtHist, rtLum, lumScene, lumBuf: new Uint8Array(LUM_N * LUM_N * 4), LUM_N, lumU, blueTex,
      volU, taaU, compU, volScene, taaScene, compScene, ortho, scale: LD.volScale,
      // the history state: which target to read, the last view-projection
      // and floating origin, and whether the history is good
      hist: { read: 0, valid: false, prevVP: new THREE.Matrix4(), origin: [0, 0] },
      size(w, h) {
        rtScene.setSize(w, h);
        const vw = Math.max(1, Math.round(w * this.scale)), vh = Math.max(1, Math.round(h * this.scale));
        rtVol.setSize(vw, vh); for (const t of rtHist) t.setSize(vw, vh);
        compU.uVolTexel.value.set(1 / vw, 1 / vh); taaU.uTexel.value.set(1 / vw, 1 / vh);
        this.hist.valid = false;
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
  // { volScale, volSteps, polypDraw, shadow (the lead map size, 0 off),
  // shadowExtra (the map size of the other main lamps, 0 off), polypShadow }.
  function setLoads(o = {}) {
    if (o.polypDraw !== undefined) polypBudget = Math.max(0, o.polypDraw);
    if (passes && o.volSteps !== undefined) passes.volU.uSteps.value = Math.max(4, Math.round(o.volSteps));
    if (passes && o.volScale !== undefined && o.volScale !== passes.scale) { passes.scale = o.volScale; resize(); }
    let relight = false;
    for (const k of ['shadow', 'shadowExtra']) if (o[k] !== undefined && o[k] !== LD[k]) { LD[k] = o[k]; relight = true; }
    if (o.polypShadow !== undefined && !!o.polypShadow !== LD.polypShadow) {
      LD.polypShadow = !!o.polypShadow;
      for (const c of colonies.values()) for (const ch of c.chunks.values()) if (ch.poly) ch.poly.castShadow = LD.polypShadow;
    }
    Object.assign(LD, o);
    if (relight) { setLights(lamps, mainN); updateLamps(); }
  }
  const view = { ox: 0, oy: 0, tox: 0, toy: 0 };
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
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
    // max 8 (was 24): a dark frame does not lift the far water (the user:
    // "it is dark up close and then bright at a distance")
    post.exposure = exposureFrom(passes.lumBuf, post.exposure, { max: 8 });
    passes.compU.uExposure.value = post.exposure;
  }
  // ── the infinite world (CONTRACT-V4.md, world/stream.js) ─────────────────
  // worldRoot sits at minus the floating origin O (render space = world -
  // O). Each chunk group sits at its true chunk centre under it, so three
  // makes the model matrix in double precision and the GPU gets small
  // numbers. The streamer gives finished results only:
  //   addWorldRock(key, [cx, cz], { rock, sand })   the rock and sand of a
  //       chunk (chunk-local arrays, world/mesh.js); it replaces the old
  //       LOD of the chunk in the same call
  //   addWorldCoral(key, co)   all the coarse coral meshes of a chunk
  //       (world/corals.js), group at (cx, oy, cz); gids + co.base (the
  //       slab of the chunk in the data textures)
  //   addWorldFine(fkey, co, mesh)   one colony: fine mesh and polyps
  //   removeWorld*(key)   a fine group goes after one more render (the
  //       page shows the coarse part first: no frame with neither)
  // Each add returns the bytes it gave to the GPU. The arrays are dropped
  // after the upload (onUpload), so the page keeps no copy of them.
  const worldRoot = new THREE.Group(); worldRoot.name = 'world'; scene.add(worldRoot);
  const W3 = { rock: new Map(), coral: new Map(), fine: new Map(), dying: [], gpu: 0, origin: [0, 0], on: false };
  function release() { this.array = null; }
  function attr(arr, n) { const a = new THREE.BufferAttribute(arr, n); a.onUpload(release); return a; }
  function geoBytes(g) { let b = 0; for (const k in g.attributes) { const a = g.attributes[k]; b += a.isInterleavedBufferAttribute ? 0 : (a.array ? a.array.byteLength : 0); } if (g.index && g.index.array) b += g.index.array.byteLength; return b; }
  function setWorldMode(on = true) {
    W3.on = !!on;
    U.uR.value = on ? 1e7 : R;               // no plot fade: the fog takes the far world
    if (!on) caus.setPlot(R);
  }
  function setOrigin(ox, oz) { W3.origin = [ox, oz]; worldRoot.position.set(-ox, 0, -oz); worldRoot.updateMatrixWorld(true); snowFx.setOrigin(ox, 0, oz); }
  function worldGeo(m, extra) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attr(m.positions, 3));
    g.setAttribute('normal', attr(m.normals, 3));
    if (extra) extra(g);
    g.setIndex(attr(m.indices, 1));
    g.computeBoundingSphere();
    return g;
  }
  function disposeGroup(grp) {
    grp.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (grp.parent) grp.parent.remove(grp);
  }
  function addWorldRock(key, pos, r) {
    const old = W3.rock.get(key);
    const grp = new THREE.Group(); grp.position.set(pos[0], 0, pos[1]); grp.name = 'rock ' + key;
    let b = 0;
    if (r.rock) {
      const n = r.rock.positions.length / 3;
      const g = worldGeo(r.rock, g2 => {
        g2.setAttribute('cavity', attr(r.rock.cavity && r.rock.cavity.length === n ? r.rock.cavity : new Float32Array(n), 1));
        g2.setAttribute('band', attr(r.rock.band && r.rock.band.length === n ? r.rock.band : new Float32Array(n), 1));
      });
      b += geoBytes(g);
      const m = new THREE.Mesh(g, rockMat); m.castShadow = true; m.receiveShadow = true; m.userData.rock = true;
      grp.add(m);
    }
    if (r.sand) {
      const n = r.sand.positions.length / 3;
      const g = worldGeo(r.sand, g2 => { g2.setAttribute('cavity', attr(new Float32Array(n), 1)); g2.setAttribute('band', attr(new Float32Array(n), 1)); });
      b += geoBytes(g);
      const m = new THREE.Mesh(g, sandMat); m.receiveShadow = true; m.castShadow = false; m.userData.sand = true;
      grp.add(m);
    }
    worldRoot.add(grp);
    if (old) { disposeGroup(old.grp); W3.gpu -= old.bytes; }
    W3.rock.set(key, { grp, bytes: b, lod: r.lod });
    W3.gpu += b;
    return b;
  }
  function removeWorldRock(key) { const o = W3.rock.get(key); if (!o) return; disposeGroup(o.grp); W3.gpu -= o.bytes; W3.rock.delete(key); }
  function gidAttr(gids, base) { const g = new Float32Array(gids.length); for (let i = 0; i < gids.length; i++) g[i] = gids[i] < 0 ? -1 : gids[i] + base; return attr(g, 1); }
  function addWorldCoral(key, co) {
    removeWorldCoral(key);
    const grp = new THREE.Group(); grp.position.set(co.cx, co.oy, co.cz); grp.name = 'coral ' + key;
    let b = 0;
    for (const sp of Object.keys(co.coarse || {})) {
      const m = co.coarse[sp]; if (!m || !m.indices.length) continue;
      const g = worldGeo(m, g2 => g2.setAttribute('aGid', gidAttr(m.gids, co.base)));
      if (g.boundingSphere) g.boundingSphere.radius += 0.2;
      b += geoBytes(g);
      const id = SPECIES_CODE[sp] !== undefined ? sp : 'staghorn';
      const mesh = new THREE.Mesh(g, coarseMats[id]); mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = coralDepth[1];
      grp.add(mesh);
    }
    worldRoot.add(grp);
    W3.coral.set(key, { grp, bytes: b });
    W3.gpu += b;
    return b;
  }
  function removeWorldCoral(key) { const o = W3.coral.get(key); if (!o) return; disposeGroup(o.grp); W3.gpu -= o.bytes; W3.coral.delete(key); }
  function addWorldFine(fkey, co, m) {
    removeWorldFine(fkey, true);
    const grp = new THREE.Group(); grp.position.set(co.cx, co.oy, co.cz); grp.name = 'fine ' + fkey;
    const id = SPECIES_CODE[m.sp] !== undefined ? m.sp : 'staghorn';
    const g = worldGeo(m, g2 => g2.setAttribute('aGid', gidAttr(m.gids, co.base)));
    if (g.boundingSphere) g.boundingSphere.radius += 0.2;
    let b = geoBytes(g);
    const mesh = new THREE.Mesh(g, coralMats[id]); mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = coralDepth[0];
    grp.add(mesh);
    const np = m.polyps ? m.polyps.length / 8 : 0;
    if (np) {
      const PP = m.polyps;
      for (let q = 6; q < PP.length; q += 8) PP[q] += co.base;
      const pg = new THREE.InstancedBufferGeometry();
      pg.setAttribute('position', tplPos.clone()); pg.setAttribute('aT', tplAT.clone()); pg.setIndex(tplIndex.clone());
      const ib = new THREE.InstancedInterleavedBuffer(PP, 8, 1);
      ib.onUpload(release);
      pg.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      pg.setAttribute('iNrm', new THREE.InterleavedBufferAttribute(ib, 3, 3));
      pg.setAttribute('iData', new THREE.InterleavedBufferAttribute(ib, 2, 6));
      pg.instanceCount = np;
      pg.boundingSphere = g.boundingSphere ? g.boundingSphere.clone() : null;
      if (pg.boundingSphere) pg.boundingSphere.radius += 0.05;
      b += PP.byteLength;
      const pm = new THREE.Mesh(pg, polypMats[id]); pm.castShadow = LD.polypShadow; pm.customDepthMaterial = polypDepth[id]; pm.userData.polyps = true;
      grp.add(pm);
    }
    polypTotal += np;
    worldRoot.add(grp);
    W3.fine.set(fkey, { grp, bytes: b, np });
    W3.gpu += b;
    return b;
  }
  // now: at once (a replace); else after one more render
  function removeWorldFine(fkey, now = false) {
    const o = W3.fine.get(fkey); if (!o) return;
    W3.fine.delete(fkey);
    polypTotal -= o.np; W3.gpu -= o.bytes;
    if (now) disposeGroup(o.grp); else { o.dieAt = frameN; W3.dying.push(o); }
  }
  function reapWorld() {
    for (let i = W3.dying.length - 1; i >= 0; i--) { const o = W3.dying[i]; if (frameN <= o.dieAt) continue; disposeGroup(o.grp); W3.dying.splice(i, 1); }
  }
  function clearWorld() {
    for (const k of [...W3.rock.keys()]) removeWorldRock(k);
    for (const k of [...W3.coral.keys()]) removeWorldCoral(k);
    for (const k of [...W3.fine.keys()]) removeWorldFine(k, true);
    for (const o of W3.dying) disposeGroup(o.grp);
    W3.dying.length = 0;
  }
  function setWorldPolyps(on) { for (const o of W3.fine.values()) o.grp.traverse(q => { if (q.userData.polyps) q.visible = on; }); }

  const M4 = new THREE.Matrix4();
  // cam: the camera to draw with (the main camera, or a saver camera).
  function render(dt, nowMs = performance.now()) {
    if (dying.length) reapDying();
    if (W3.dying.length) reapWorld();
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
    // the snow: the current (a slow share of the page current), the depth
    // (setSnowDepth, else from the eye height: depth = SURFACE_Y - y)
    camera.updateMatrixWorld();
    snowFx.setCurrent(U.uCur.value.x * 0.1, 0, U.uCur.value.y * 0.1);
    snowFx.setDepth(snowDepth ?? (SURFACE_Y - camera.matrixWorld.elements[13]));
    snowFx.update(camera, U.uTime.value);
    // the shadow matrices of this frame (the shadow pass of render() computes the same)
    for (const l of lamps) if (l.castShadow) l.shadow.updateMatrices(l);
    const wait = updateLamps();
    frameN++;
    if (!passes || !post.on) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(passes.rtScene);
    snow.visible = false;                                  // snowPost draws it, after the tone map
    renderer.render(scene, camera);
    snow.visible = opts.snow;
    if (wait) updateLamps();                               // the first shadow maps are there now
    const vu = passes.volU;
    if (opts.volume) {
      vu.uEye.value.setFromMatrixPosition(camera.matrixWorld);
      vu.uProjInv.value.copy(camera.projectionMatrixInverse);
      vu.uCamW.value.copy(camera.matrixWorld);
      vu.uFrame.value = frameN % 1024;
      renderer.setRenderTarget(passes.rtVol);
      renderer.render(passes.volScene, passes.ortho);
      // the history: render space = world - origin, so a move of the
      // floating origin by d moves the last view-projection by d
      const H = passes.hist, tu = passes.taaU, o = W3.origin;
      tu.uPrevVP.value.copy(H.prevVP);
      if (o[0] !== H.origin[0] || o[1] !== H.origin[1]) tu.uPrevVP.value.multiply(M4.makeTranslation(o[0] - H.origin[0], 0, o[1] - H.origin[1]));
      tu.uReset.value = H.valid ? 0 : 1;
      tu.uHist.value = passes.rtHist[H.read].texture;
      const wr = passes.rtHist[1 - H.read];
      renderer.setRenderTarget(wr);
      renderer.render(passes.taaScene, passes.ortho);
      passes.compU.uVol.value = passes.lumU.uVol.value = wr.texture;
      H.read = 1 - H.read; H.valid = true;
      H.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); H.origin = [o[0], o[1]];
    } else {
      renderer.setRenderTarget(passes.rtVol); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
      passes.compU.uVol.value = passes.lumU.uVol.value = passes.rtVol.texture; passes.hist.valid = false;
    }
    passes.compU.uNearFar.value.set(camera.near, camera.far);
    if (frameN % 12 === 3) autoExposure();
    renderer.setRenderTarget(null);
    const check = post.checks < 4 && frameN > 1;
    if (check) renderer.setClearColor(new THREE.Color(SENTINEL[0], SENTINEL[1], SENTINEL[2]), 1);
    renderer.render(passes.compScene, passes.ortho);
    if (check) { checkFrame(); if (post.on) renderer.setClearColor(0x000000, 1); }
    if (opts.snow) { const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(snowScene, camera); renderer.autoClear = ac; }
  }

  return {
    renderer, scene, camera, controls, U, THREE, view, opts, rockGroup, coralRoot, snow, caustics: caus, passes,
    // marine snow (lib/marine-snow.js): depth in metres (null: from the eye height), density 0..1 (user)
    marineSnow: snowFx, setSnowDepth(d) { snowDepth = Number.isFinite(d) ? d : null; }, setSnowDensity(v) { snowFx.setDensity(v); },
    get sand() { return sandMesh; }, post,
    setRock, addRockMeshes, setPlot, setLoads, get loads() { return Object.assign({}, LD); }, setPolypSizes, setLights, setLut, resize, render,
    clearColonies, addColonyGroup, applyBricks, flushChunks, setParticles, writeT, uploadParticles, setPolypsVisible,
    setFineGate, showFine, dropFine, takeShown, fineState, get fineGroups() { return fineGroups; }, get dyingGroups() { return dying.length; },
    get polypTotal() { return polypTotal; }, get dirtyChunks() { return dirtyChunks.size; }, get lamps() { return lamps; }, get shadowLamps() { return lamps.filter(l => l.castShadow).length; },
    PART_W, maxParticles: NP,
    // the infinite world (CONTRACT-V4.md)
    worldRoot, setWorldMode, setOrigin, addWorldRock, removeWorldRock, addWorldCoral, removeWorldCoral, addWorldFine, removeWorldFine, clearWorld, setWorldPolyps,
    setCausticCentre: (x, z, size) => caus.setCentre(x, z, size),
    get world() { return { rock: W3.rock.size, coral: W3.coral.size, fine: W3.fine.size, dying: W3.dying.length, gpu: W3.gpu, origin: W3.origin.slice() }; },
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
