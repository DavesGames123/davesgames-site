// ============================================================================
//  CORAL REEF  ·  the three.js scene (r160, ES module)
// ----------------------------------------------------------------------------
//  What it draws, back to front:
//    sky dome ...... the surface glow above, the fog colour at the horizon
//    seabed ........ terrain.js groundGrid: the real lidar relief of the
//                    Buck Island lagoon, sand and reef rock by the rock mask
//                    (Poly Haven CC0 textures), turf and coralline algae
//    rocks ......... SDF boulders under the colonies (terrain.js meshRock,
//                    meshed in the worker), triplanar reef-rock texture
//    models ........ scanned rocks and conch shells (assets.js, CC0)
//    corals ........ the SDF meshes of coral-sdf.js: one group per colony
//                    at its base, one mesh per chunk of 6^3 bricks, rebuilt
//                    when a brick of it changes
//    polyps ........ one instanced mesh per chunk: a cup and eight
//                    tentacles that open, close and sway (shaders.js)
//    snow, shafts .. marine snow that drifts with the current, light shafts
//  The caustic map is a render target that the mesh-area pass of
//  shaders.js fills each frame; every surface samples it.
//
//  Per-particle data lives in two float textures (128 x 128 = 16384
//  particles): A = natural rgb, colour t; B = birth s, radius, sway level x
//  2 + tip, height over the base. A colour change writes texels only.
//
//  grep -n targets
//    caustic pass .......... "function makeCaustics"
//    particle textures ..... "function setParticles"
//    coral chunks .......... "function applyBricks"
//    chunk rebuild ......... "function rebuildChunk"
//    polyp template ........ "function polypTemplate"
//    rocks ................. "function setRocks"
//    scanned models ........ "function setDecor"
//    the scene object ...... "export function createScene"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as SH from './shaders.js';
import { groundGrid } from './terrain.js';

export const SURFACE_Y = SH.SURFACE_Y;
export const PART_W = 128;          // particle texture width (and height)
const SPECIES_CODE = { staghorn: 0, fan: 1, table: 2, boulder: 3, finger: 4 };
// polyp look per species: size (units), how far the tentacles reach, tint, green fluorescence
const POLYP_LOOK = {
  staghorn: { size: 0.17, extend: 0.85, tint: [0.92, 0.86, 1.0], fluor: 0.7 },
  fan: { size: 0.1, extend: 1.0, tint: [1.0, 0.95, 0.92], fluor: 0.15 },
  table: { size: 0.15, extend: 0.7, tint: [0.85, 1.0, 0.82], fluor: 0.9 },
  boulder: { size: 0.13, extend: 0.45, tint: [0.95, 0.9, 0.7], fluor: 0.5 },
  finger: { size: 0.23, extend: 1.0, tint: [1.0, 0.94, 0.96], fluor: 0.12 },
};

function sharedU(U) {
  return {
    uTime: U.uTime, uCaust: U.uCaust, uFogDen: U.uFogDen, uFogDeep: U.uFogDeep, uFogShallow: U.uFogShallow,
    uCur: U.uCur, uSun: U.uSun, uCaustTex: U.uCaustTex, uCaustTile: U.uCaustTile, uCaustScale: U.uCaustScale,
  };
}

// ── caustic pass ────────────────────────────────────────────────────────────
function makeCaustics(renderer, U, coarse) {
  const R = coarse ? 256 : 512;
  const half = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  const rt = new THREE.WebGLRenderTarget(R, R, {
    type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  const G = coarse ? 110 : 180;
  const uv = new Float32Array((G + 1) * (G + 1) * 2), idx = [];
  for (let j = 0, k = 0; j <= G; j++) for (let i = 0; i <= G; i++) { uv[k++] = i / G; uv[k++] = j / G; }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const off = [];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) off.push(x, y);
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(off), 2));
  geo.instanceCount = 9;
  const A = 0.13;
  const waves = [[3, 1, A, 0.3], [-1, 3, A * 0.9, 1.7], [2, -3, A * 0.7, 4.1], [4, 2, A * 0.45, 2.2], [-3, -2, A * 0.5, 5.3], [1, 5, A * 0.3, 0.9]]
    .map(w => new THREE.Vector4(w[0], w[1], w[2], w[3]));
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: SH.CAUSTIC_VS, fragmentShader: SH.CAUSTIC_FS,
    uniforms: { uWave: { value: waves }, uL: { value: 48 }, uD: { value: 110 }, uT: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.2, -1, 0.15).normalize() }, uGain: { value: half ? 1 : 0.25 } },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  U.uCaustTex.value = rt.texture;
  U.uCaustTile.value = 48;
  U.uCaustScale.value = half ? 1 : 4;
  return {
    rt, half,
    render(t) {
      mat.uniforms.uT.value = t;
      const prev = renderer.getRenderTarget(), pc = renderer.getClearColor(new THREE.Color()), pa = renderer.getClearAlpha();
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
      renderer.render(sc, cam);
      renderer.setRenderTarget(prev);
      renderer.setClearColor(pc, pa);
    },
    // an unsigned byte target stores E / 4: the scene multiplies it back
    scale: half ? 1 : 4,
  };
}

// ── polyp template: a cup (wall and top) and 8 tentacle ribbons ─────────────
function polypTemplate() {
  const T = [], I = [];
  const v = (a, s, z, w) => { T.push(a, s, z, w); return T.length / 4 - 1; };
  const S = 8;
  for (let i = 0; i < S; i++) {          // wall: radius 0.7 at the base, 1 at the top
    const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2;
    const p = v(a0, 0, 0.7, 0), q = v(a1, 0, 0.7, 0), r = v(a1, 1, 1, 0), t = v(a0, 1, 1, 0);
    I.push(p, r, q, p, t, r);
  }
  for (let i = 0; i < S; i++) {          // top: the rim (z 1) to the mouth (z 0.42)
    const a0 = i / S * Math.PI * 2, a1 = (i + 1) / S * Math.PI * 2;
    const p = v(a0, 1, 1, 1), q = v(a1, 1, 1, 1), r = v(a1, 1, 0.42, 1), t = v(a0, 1, 0.42, 1);
    I.push(p, q, r, p, r, t);
  }
  for (let i = 0; i < S; i++) {          // tentacles: 3 segments, a ribbon (side -1, 1)
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

export function createScene({ canvas, cap, coarse, onNoGL }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 needed');
  } catch (e) { if (onNoGL) onNoGL(e); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1400);
  camera.position.set(110, 70, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.target.set(0, 12, 0);
  controls.minDistance = 8; controls.maxDistance = 420;
  controls.maxPolarAngle = 1.52; controls.enablePan = true; controls.screenSpacePanning = true;
  controls.rotateSpeed = coarse ? 0.6 : 0.8;

  const lutData = new Uint8Array(256 * 4);
  const lutTex = new THREE.DataTexture(lutData, 256, 1, THREE.RGBAFormat);
  lutTex.colorSpace = THREE.SRGBColorSpace; lutTex.magFilter = THREE.LinearFilter; lutTex.minFilter = THREE.LinearFilter;
  lutTex.needsUpdate = true;

  const NP = PART_W * PART_W;
  const partA = new Float32Array(NP * 4), partB = new Float32Array(NP * 4);
  const mkPart = (data) => { const t = new THREE.DataTexture(data, PART_W, PART_W, THREE.RGBAFormat, THREE.FloatType); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
  const texA = mkPart(partA), texB = mkPart(partB);

  const U = {
    uTime: { value: 0 }, uCaust: { value: 1 }, uFogDen: { value: 0.0042 },
    uFogDeep: { value: new THREE.Color('#02131f') }, uFogShallow: { value: new THREE.Color('#1d6f86') },
    uCur: { value: new THREE.Vector2(1, 0) }, uLut: { value: lutTex }, uMode: { value: 0 },
    uCount: { value: 1 }, uBleach: { value: 0 }, uSwayK: { value: 1 }, uSnowOff: { value: new THREE.Vector3() },
    uPxScale: { value: 300 }, uShaft: { value: 1 },
    uSun: { value: new THREE.Vector3(0.2, -1, 0.15).normalize() }, uCaustTex: { value: null }, uCaustTile: { value: 48 }, uCaustScale: { value: 1 },
    uPartA: { value: texA }, uPartB: { value: texB }, uDetail: { value: 1 }, uKeep: { value: 1 },
  };
  const caus = makeCaustics(renderer, U, coarse);

  // sky dome
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
        float sun = pow(max(0.0, dot(vD, normalize(vec3(-0.2, 1.0, -0.15)))), 24.0);
        c += vec3(0.5, 0.75, 0.75) * sun * (0.75 + 0.25 * sin(uTime * 0.8));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -1; sky.frustumCulled = false;
  scene.add(sky);

  // ── textures (CC0, assets/tex) ─────────────────────────────────────────────
  const loader = new THREE.TextureLoader();
  const TX = {};
  const texU = { uTex: { value: 0 } };
  let texLeft = 0;
  function tex(name, srgb) {
    texLeft++;
    const t = loader.load(`assets/tex/${name}.jpg`, () => { if (--texLeft === 0) texU.uTex.value = 1; }, undefined, () => { /* keep the flat colours */ });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = coarse ? 2 : 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    TX[name] = t; return t;
  }
  const texSet = {
    uSand: { value: tex('sand_diff', true) }, uSandN: { value: tex('sand_nor', false) },
    uRock: { value: tex('reefrock_diff', true) }, uRockN: { value: tex('reefrock_nor', false) },
    uGravel: { value: tex('gravel_diff', true) }, uGravelN: { value: tex('gravel_nor', false) },
  };

  // ── seabed ────────────────────────────────────────────────────────────────
  const gg = groundGrid(coarse ? 150 : 230, 600, 2.1);
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute('position', new THREE.BufferAttribute(gg.positions, 3));
  groundGeo.setAttribute('normal', new THREE.BufferAttribute(gg.normals, 3));
  groundGeo.setAttribute('aMask', new THREE.BufferAttribute(gg.mask, 1));
  groundGeo.setIndex(new THREE.BufferAttribute(gg.indices, 1));
  groundGeo.computeBoundingSphere();
  const groundMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: SH.GROUND_VS, fragmentShader: SH.GROUND_FS,
    uniforms: Object.assign(sharedU(U), texSet, texU),
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  scene.add(ground);

  const rockMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: SH.ROCK_VS, fragmentShader: SH.ROCK_FS,
    uniforms: Object.assign(sharedU(U), { uRock: texSet.uRock, uRockN: texSet.uRockN }, texU),
  });
  const rocks = new THREE.Group(); scene.add(rocks);
  const rockCache = new Map();        // rock key -> BufferGeometry
  let rockGen = 0;
  const rockKey = rk => `${rk.x.toFixed(3)},${rk.z.toFixed(3)},${rk.seed.toFixed(4)},${rk.rx.toFixed(3)}`;

  // list: terrain.js rocks. meshRock(rk) -> Promise of { positions, normals, indices }.
  function setRocks(list, meshRock) {
    const gen = ++rockGen;
    for (const m of rocks.children.slice()) rocks.remove(m);
    for (const rk of list) addRock(rk, meshRock, gen);
  }
  function addRock(rk, meshRock, gen = rockGen) {
    const key = rockKey(rk);
    const put = (geo) => { if (gen !== rockGen) return; const m = new THREE.Mesh(geo, rockMat); m.userData.rock = rk; rocks.add(m); };
    if (rockCache.has(key)) { const g0 = rockCache.get(key); rockCache.delete(key); rockCache.set(key, g0); put(g0); return; }
    meshRock(rk).then(r => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
      g.setIndex(new THREE.BufferAttribute(r.indices, 1));
      g.computeBoundingSphere();
      if (rockCache.size > 80) { const k0 = rockCache.keys().next().value; rockCache.get(k0).dispose(); rockCache.delete(k0); }
      rockCache.set(key, g);
      put(g);
    }).catch(() => { /* no rock mesh: the colony still grows */ });
  }

  // ── scanned models ────────────────────────────────────────────────────────
  const decor = new THREE.Group(); scene.add(decor);
  const decorGeo = new Map();          // id -> BufferGeometry
  function decorMat(hasMap, map) {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SH.DECOR_VS, fragmentShader: SH.DECOR_FS,
      uniforms: Object.assign(sharedU(U), { uRock: texSet.uRock, uRockN: texSet.uRockN, uMap: { value: map || texSet.uRock.value }, uHasMap: { value: hasMap ? 1 : 0 } }, texU),
    });
  }
  const shellMap = tex('shell_diff', true);
  const decorRockMat = decorMat(false), decorShellMat = decorMat(true, shellMap);
  // models: { id: parsed CRM }; places: scatterDecor() output; kinds: { id: 'rock' | 'shell' }
  function setDecor(models, places, kinds) {
    for (const m of decor.children.slice()) { decor.remove(m); m.dispose && m.dispose(); }
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
    for (const id of Object.keys(places)) {
      const mod = models[id], list = places[id];
      if (!mod || !list.length) continue;
      let g = decorGeo.get(id);
      if (!g) {
        g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(mod.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(mod.normals, 3));
        if (mod.uv) g.setAttribute('uv', new THREE.BufferAttribute(mod.uv, 2));
        g.setIndex(new THREE.BufferAttribute(mod.indices, 1));
        g.computeBoundingSphere();
        decorGeo.set(id, g);
      }
      const inst = new THREE.InstancedMesh(g, kinds[id] === 'shell' ? decorShellMat : decorRockMat, list.length);
      list.forEach((p, i) => {
        E.set(p.tx, p.ry, p.tz, 'YXZ'); Q.setFromEuler(E);
        M4.compose(P.set(p.x, p.y, p.z), Q, S.set(p.s, p.s, p.s));
        inst.setMatrixAt(i, M4);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      decor.add(inst);
    }
  }

  // ── corals ────────────────────────────────────────────────────────────────
  const coralMats = {}, polypMats = {};
  for (const id of Object.keys(SPECIES_CODE)) {
    coralMats[id] = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SH.CORAL_VS, fragmentShader: SH.CORAL_FS, side: THREE.DoubleSide,
      uniforms: Object.assign(sharedU(U), { uPartA: U.uPartA, uPartB: U.uPartB, uLut: U.uLut, uMode: U.uMode, uCount: U.uCount, uBleach: U.uBleach, uSwayK: U.uSwayK, uDetail: U.uDetail, uSpecies: { value: SPECIES_CODE[id] } }),
    });
    const L = POLYP_LOOK[id];
    polypMats[id] = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SH.POLYP_VS, fragmentShader: SH.POLYP_FS, side: THREE.DoubleSide,
      uniforms: Object.assign(sharedU(U), { uPartA: U.uPartA, uPartB: U.uPartB, uLut: U.uLut, uMode: U.uMode, uCount: U.uCount, uBleach: U.uBleach, uSwayK: U.uSwayK, uKeep: U.uKeep,
        uSize: { value: L.size }, uExtend: { value: L.extend }, uTint: { value: new THREE.Vector3(...L.tint) }, uFluor: { value: L.fluor } }),
    });
  }
  const tpl = polypTemplate();
  const tplAT = new THREE.BufferAttribute(tpl.aT, 4);
  const tplPos = new THREE.BufferAttribute(new Float32Array(tpl.aT.length / 4 * 3), 3);
  const tplIndex = new THREE.Uint16BufferAttribute(tpl.index, 1);

  const coralRoot = new THREE.Group(); scene.add(coralRoot);
  const colonies = new Map();          // k -> { group, id, chunks: Map }
  const dirtyChunks = new Set();
  let polypTotal = 0;
  const polypBudget = coarse ? 9000 : 42000;

  function clearColonies() {
    for (const c of colonies.values()) for (const ch of c.chunks.values()) disposeChunk(ch);
    colonies.clear(); dirtyChunks.clear(); polypTotal = 0;
    for (const g of coralRoot.children.slice()) coralRoot.remove(g);
  }
  function addColonyGroup(k, id, base) {
    const group = new THREE.Group(); group.position.set(base[0], base[1], base[2]);
    coralRoot.add(group);
    const c = { k, id, group, chunks: new Map() };
    colonies.set(k, c);
    return c;
  }
  function disposeChunk(ch) {
    if (ch.mesh) { ch.mesh.geometry.dispose(); ch.mesh.parent && ch.mesh.parent.remove(ch.mesh); ch.mesh = null; }
    if (ch.poly) { ch.poly.geometry.dispose(); ch.poly.parent && ch.poly.parent.remove(ch.poly); ch.poly = null; }
    polypTotal -= ch.np || 0; ch.np = 0;
  }

  // Brick results from the mesher (worker or main): store by chunk.
  function applyBricks(list) {
    for (const r of list) {
      const c = colonies.get(r.k); if (!c) continue;
      let ch = c.chunks.get(r.chunk);
      if (!ch) { ch = { key: r.chunk, col: c, bricks: new Map(), mesh: null, poly: null, np: 0, at: 0 }; c.chunks.set(r.chunk, ch); }
      if (r.indices.length) ch.bricks.set(r.key, r); else ch.bricks.delete(r.key);
      dirtyChunks.add(ch);
    }
  }

  function rebuildChunk(ch) {
    let nv = 0, ni = 0, npol = 0;
    for (const b of ch.bricks.values()) { nv += b.positions.length / 3; ni += b.indices.length; npol += b.polyps.length / 8; }
    const c = ch.col;
    if (!nv) { disposeChunk(ch); c.chunks.delete(ch.key); return; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), G = new Float32Array(nv), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const PP = new Float32Array(npol * 8);
    let ov = 0, oi = 0, op = 0;
    for (const b of ch.bricks.values()) {
      P.set(b.positions, ov * 3); N.set(b.normals, ov * 3); G.set(b.gids, ov);
      const bi = b.indices;
      for (let i = 0; i < bi.length; i++) I[oi + i] = bi[i] + ov;
      ov += b.positions.length / 3; oi += bi.length;
      PP.set(b.polyps, op); op += b.polyps.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('aGid', new THREE.BufferAttribute(G, 1));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius += 1.5;      // room for the sway
    if (ch.mesh) { ch.mesh.geometry.dispose(); ch.mesh.geometry = geo; }
    else { ch.mesh = new THREE.Mesh(geo, coralMats[c.id]); c.group.add(ch.mesh); }
    // polyps
    polypTotal -= ch.np; ch.np = npol; polypTotal += npol;
    if (ch.poly) { ch.poly.geometry.dispose(); }
    if (npol) {
      const pg = new THREE.InstancedBufferGeometry();
      // own copies of the small template: three.js deletes the GPU buffers of
      // every attribute of a disposed geometry, so a shared one would break
      // the other chunks
      pg.setAttribute('position', tplPos.clone()); pg.setAttribute('aT', tplAT.clone()); pg.setIndex(tplIndex.clone());
      const ib = new THREE.InstancedInterleavedBuffer(PP, 8, 1);
      pg.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      pg.setAttribute('iNrm', new THREE.InterleavedBufferAttribute(ib, 3, 3));
      pg.setAttribute('iData', new THREE.InterleavedBufferAttribute(ib, 2, 6));
      pg.instanceCount = npol;
      pg.boundingSphere = geo.boundingSphere ? geo.boundingSphere.clone() : null;
      if (pg.boundingSphere) pg.boundingSphere.radius += 1;
      if (ch.poly) ch.poly.geometry = pg;
      else { ch.poly = new THREE.Mesh(pg, polypMats[c.id]); c.group.add(ch.poly); }
    } else if (ch.poly) { ch.poly.parent && ch.poly.parent.remove(ch.poly); ch.poly = null; }
  }

  // Rebuild dirty chunks for about ms (each at most every minGap ms).
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

  // ── particle data ─────────────────────────────────────────────────────────
  let texDirty = false;
  // Write particles from..to. f(g, A4, B4) fills the 4 + 4 floats of particle g.
  function setParticles(from, to, f) {
    to = Math.min(to, NP);
    for (let g = from; g < to; g++) f(g, partA, partB, g * 4);
    texDirty = true;
  }
  function writeT(t, n) { n = Math.min(n, NP); for (let g = 0; g < n; g++) partA[g * 4 + 3] = t[g]; texDirty = true; }
  let texAt = 0;
  function uploadParticles(nowMs, force) {
    if (!texDirty || (!force && nowMs - texAt < 60)) return;
    texA.needsUpdate = true; texB.needsUpdate = true; texDirty = false; texAt = nowMs;
  }

  // ── marine snow and light shafts ─────────────────────────────────────────
  function makeSnow(n) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 240; p[i * 3 + 1] = Math.random() * 130 - 5; p[i * 3 + 2] = (Math.random() - 0.5) * 240;
      s[i] = 0.5 + Math.random() * Math.random() * 1.8;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.uTime, uOff: U.uSnowOff, uScale: U.uPxScale },
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
  function makeShafts(n) {
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
    return { inst, pos };
  }
  const snow = makeSnow(coarse ? 900 : 2400); scene.add(snow);
  const shafts = makeShafts(coarse ? 6 : 10); scene.add(shafts.inst);

  function setLut(bytes) { lutData.set(bytes); lutTex.needsUpdate = true; }

  const view = { ox: 0, oy: 0, tox: 0, toy: 0 };
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    U.uPxScale.value = h * renderer.getPixelRatio() * 0.35;
    camera.updateProjectionMatrix();
  }

  const M4 = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), V3 = new THREE.Vector3(), S3 = new THREE.Vector3();
  let frameN = 0;
  function render(dt, nowMs = performance.now()) {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const k = 1 - Math.exp(-dt * 6);
    view.ox += (view.tox - view.ox) * k; view.oy += (view.toy - view.oy) * k;
    if (Math.abs(view.ox) > 0.5 || Math.abs(view.oy) > 0.5) camera.setViewOffset(w, h, view.ox, view.oy, w, h);
    else camera.clearViewOffset();
    const az = Math.atan2(camera.position.x, camera.position.z);
    tmpQ.setFromAxisAngle(up, az);
    shafts.pos.forEach((p, i) => { M4.compose(V3.set(p[0], -5, p[1]), tmpQ, S3.set(p[2], 1, 1)); shafts.inst.setMatrixAt(i, M4); });
    shafts.inst.instanceMatrix.needsUpdate = true;
    uploadParticles(nowMs);
    if (U.uCaust.value > 0.5 && (!coarse || (frameN & 1) === 0)) caus.render(U.uTime.value);
    frameN++;
    renderer.render(scene, camera);
  }

  return {
    renderer, scene, camera, controls, U, THREE, view, ground, rocks, decor,
    setRocks, addRock, setDecor, setLut, resize, render,
    clearColonies, addColonyGroup, applyBricks, flushChunks, setParticles, writeT, uploadParticles,
    get polypTotal() { return polypTotal; }, get dirtyChunks() { return dirtyChunks.size; },
    caustics: caus, PART_W,
  };
}
