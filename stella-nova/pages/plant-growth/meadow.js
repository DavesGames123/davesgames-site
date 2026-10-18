// ============================================================================
//  PLANT GROWTH  ·  the ground ecosystem on the GPU (three.js r160, WebGL 2)
// ----------------------------------------------------------------------------
//  eco.js places the community once per sowing. This file draws it. The
//  shaders read the live crowns (uCrown), so the community answers the
//  crown as it grows (ECO_GLSL fLight):
//
//  GRASS     one instance per tussock, BLADES curved tapered blades. The
//            vertex shader is the GLSL twin of eco.js bladeAt / bladePoint:
//            the share of tussocks that grow at the light (grassKeep), the
//            season (grassState: green-up, seed heads, curing, browning,
//            lodging, snow), gusts that travel downwind, a flutter.
//  PROPS     nature pack meshes (CC0, stella-nova/assets/nature), one
//            InstancedMesh per mesh and material:
//              stones  moss on the north and shaded faces, snow on top
//              forbs   size = niche(light) x life(season); the petals show
//                      only in the bloom window (petal texels are the
//                      non-green ones); brown in senescence; wind sway
//              shrubs  the edge mantle: autumn colour, bare in winter
//  PETALS    falling petals at the end of each bloom, then lying, then gone
//  LITTER    drifted leaves from eco.js litterPiles: in hollows, against
//            stones, at the trunk base; they come in at leaf fall and rot
//            over the winter (litterSeason)
//  SEEDLINGS the tree seedlings of eco.js seedlings(): they grow, leaf out
//            and colour with the season, and wilt and go when they die
//  WOODLAND  impostor billboards (3 x 3 view atlases of the nature pack):
//            the edge behind the tree and far stands. Deciduous crowns turn
//            in autumn and go bare in winter.
//
//  The material builders take THREE as an argument and return materials,
//  so glsl-check.mjs can assemble and compile every shader in node.
//
//  grep -n targets
//    forb GLSL tables ...... "const FORB_GLSL"
//    grass ................. "export function grassMaterial"
//    nature props .......... "export function natureMaterial"
//    litter ................ "export function litterMaterial"
//    petals ................ "export function petalMaterial"
//    seedlings ............. "export function seedlingMaterial"
//    impostors ............. "export function impostorMaterial"
//    asset loading ......... "function loadAsset"
//    the meadow object ..... "export function createMeadow"
// ============================================================================
import { FORBS, BLADES, BLADE_W, LEAN, LOD_D, GRASS_COL, GROUND_COL, GRASS, PROC } from './eco.js';
import { groundY } from './ground.js';
import { parseGLB } from '../../lib/glb-lite.js';

const NAT = new URL('../../assets/nature/', import.meta.url).href;   // the CC0 nature pack
const v3 = c => `vec3(${c.map(v => v.toFixed(4)).join(', ')})`;
const hexLin = h => [1, 3, 5].map(i => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
const KIND_CODE = { flower: 0, herb: 1, fern: 2, fungus: 3, moss: 4 };

// Forb tables as GLSL constants (from eco.js FORBS, so the two agree).
export const FORB_GLSL = /* glsl */`
#define NFORB ${FORBS.length}
const vec4 FLIFE[NFORB] = vec4[NFORB](${FORBS.map(f => `vec4(${f.life.map(v => v.toFixed(3)).join(', ')})`).join(', ')});
const vec4 FNICHE[NFORB] = vec4[NFORB](${FORBS.map(f => `vec4(${f.niche[0].toFixed(3)}, ${f.niche[1].toFixed(3)}, ${f.winter.toFixed(3)}, ${KIND_CODE[f.kind].toFixed(1)})`).join(', ')});
const vec2 FBLOOM[NFORB] = vec2[NFORB](${FORBS.map(f => f.bloom ? `vec2(${f.bloom[0].toFixed(3)}, ${f.bloom[1].toFixed(3)})` : 'vec2(-1.0, -1.0)').join(', ')});
float forbVigour(int sp, float L) { vec4 n = FNICHE[sp]; return smoothstep(n.x - 0.12, n.x + 0.12, L) * (1.0 - smoothstep(n.y - 0.12, n.y + 0.12, L)); }
float forbLife(int sp, float p) { vec4 l = FLIFE[sp]; return max(FNICHE[sp].z, smoothstep(l.x, l.y, p) * (1.0 - smoothstep(l.z, l.w, p))); }
float forbBloom(int sp, float p) { vec2 b = FBLOOM[sp]; if (b.x < 0.0) return 0.0; return smoothstep(b.x - 0.02, b.x + 0.015, p) * (1.0 - smoothstep(b.y - 0.015, b.y + 0.02, p)); }
`;

// ------------------------------------------------------------------ grass
// Instance attributes (eco.js tussock records): aT0 = x, z, kind, height;
// aT1 = spread, rand, rank, width factor. position: x side (-1, 1), y t
// along the blade (0..1), z the blade index.
export function grassGeometry(THREE, T) {
  const segs = 4, pos = [], idx = [];
  for (let b = 0; b < BLADES; b++) {
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) { const t = s / segs; pos.push(-1, t, b, 1, t, b); }
    for (let s = 0; s < segs; s++) { const a = base + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  geo.setIndex(idx);
  const ib = new THREE.InstancedInterleavedBuffer(T, 8, 1);
  geo.setAttribute('aT0', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  geo.setAttribute('aT1', new THREE.InterleavedBufferAttribute(ib, 4, 4));
  geo.instanceCount = T.length / 8;
  return geo;
}
// proc: the far meadow round the camera (eco.js procGrass): no instance
// attributes, the tussock comes from gl_InstanceID and the fields.
export function grassMaterial(THREE, U, COMMON, proc = false) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.55 });
  const own = { uGrassR: { value: 24 }, uProcN: { value: PROC.n } };
  m.userData.own = own;
  const G = GRASS;
  const PROC_GLSL = /* glsl */`
        int pid = gl_InstanceID, pn = int(uProcN + 0.5), phalf = pn / 2;
        int lvl = pid / (pn * pn), pj = pid - lvl * pn * pn;
        float cs = lvl == 0 ? ${PROC.cell[0].toFixed(3)} : ${PROC.cell[1].toFixed(3)};
        uint salt = lvl == 0 ? 41u : 42u;
        ivec2 ic = ivec2(floor(cameraPosition.xz / cs)) - ivec2(phalf) + ivec2(pj % pn, pj / pn);
        vec2 pp2 = (vec2(ic) + vec2(ehash(ic, salt), ehash(ic, salt + 7u))) * cs;
        float procKeep = 1.0;
        float dcam = max(abs(pp2.x - cameraPosition.x), abs(pp2.y - cameraPosition.z));
        if (lvl == 1 && dcam < ${PROC.cell[0].toFixed(3)} * float(phalf) - ${PROC.cell[0].toFixed(3)}) procKeep = 0.0;
        procKeep *= (1.0 - smoothstep(cs * float(phalf) * 0.8, cs * float(phalf), dcam)) * smoothstep(0.82 * uGrassR, uGrassR, length(pp2));
        float psw = fSward(pp2), pmead = fMeadow(pp2), ppth = fPath(pp2), pwd = fWood(pp2);
        int pkind = ppth > 0.08 && ppth < 0.75 ? 3 : (ehash(ic, salt + 23u) < pmead ? 0 : 1);
        if (pwd > 0.5) pkind = 2;
        float pdens = pkind == 0 ? pow(psw, 1.4) * (1.0 - 0.92 * ppth) : pkind == 1 ? (0.3 + 0.7 * psw) * (1.0 - 0.75 * ppth) : pkind == 2 ? 0.45 : 1.0;
        pdens *= 1.0 - 0.9 * smoothstep(0.85, 1.0, ppth);
        if (ehash(ic, salt + 29u) >= pdens * 1.8) procKeep = 0.0;
        vec2 GH = pkind == 0 ? vec2(${G[0].h[0]}, ${G[0].h[1]}) : pkind == 1 ? vec2(${G[1].h[0]}, ${G[1].h[1]}) : pkind == 2 ? vec2(${G[2].h[0]}, ${G[2].h[1]}) : vec2(${G[3].h[0]}, ${G[3].h[1]});
        vec2 GS = pkind == 0 ? vec2(${G[0].spread[0]}, ${G[0].spread[1]}) : pkind == 1 ? vec2(${G[1].spread[0]}, ${G[1].spread[1]}) : pkind == 2 ? vec2(${G[2].spread[0]}, ${G[2].spread[1]}) : vec2(${G[3].spread[0]}, ${G[3].spread[1]});
        float pwk = sqrt(cs / ${PROC.cell[0].toFixed(3)});
        float pH = GH.x + (GH.y - GH.x) * (0.35 * ehash(ic, salt + 31u) + 0.65 * pmead * (pkind == 0 ? 1.0 : 0.5)) * (0.8 + 0.4 * fMoist(pp2));
        vec4 T0 = vec4(pp2, float(pkind), pH);
        vec4 T1 = vec4((GS.x + (GS.y - GS.x) * ehash(ic, salt + 37u)) * min(1.8, pwk), ehash(ic, salt + 19u), ehash(ic, salt + 13u) * 0.92, pwk);`;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON + /* glsl */`
        uniform float uGrassR, uProcN;
        ${proc ? '' : 'attribute vec4 aT0, aT1;'}
        varying vec3 vGc; varying float vGt, vGsnow;
        const float BLADE_W[4] = float[4](${BLADE_W.map(v => v.toFixed(4)).join(', ')});
        const vec2 LEAN[4] = vec2[4](${LEAN.map(l => `vec2(${l[0].toFixed(3)}, ${l[1].toFixed(3)})`).join(', ')});`)
      .replace('#include <beginnormal_vertex>', (proc ? PROC_GLSL : 'vec4 T0 = aT0, T1 = aT1; float procKeep = 1.0;') + /* glsl */`
        float bI = position.z, tt = position.y, side = position.x;
        // distance LOD: 8 blades near the camera, 4 past 18 m, 2 past 40 m
        // (wider); the dropped blades skip all the work below
        float camD = distance(cameraPosition.xz, T0.xy);
        float nB = camD > ${LOD_D[1].toFixed(1)} ? 2.0 : camD > ${LOD_D[0].toFixed(1)} ? 4.0 : 8.0;
        vec3 bladeP = vec3(0.0, -50.0, 0.0), objectNormal = vec3(0.0, 1.0, 0.0);
        vGc = vec3(0.0); vGt = 0.0; vGsnow = 0.0;
        if (bI < 0.5 || bI > 8.5 - nB) {   // the culm blade and the last nB - 1 leaves (eco.js bladeAt)
        int kind = int(T0.z + 0.5);
        float rb = fract(T1.y * 31.7 + bI * 0.618), rb2 = fract(T1.y * 17.3 + bI * 0.377);
        float ang = bI * 2.39996 + T1.y * 6.2832;
        float rr = T1.x * sqrt((bI + 0.5) / ${BLADES.toFixed(1)});
        vec2 bp = T0.xy + vec2(cos(ang), sin(ang)) * rr;
        float Lt = fLight(bp);
        float vis = smoothstep(T1.z, T1.z + 0.12, grassKeep(kind, Lt)) * ${proc ? 'procKeep' : '(1.0 - smoothstep(0.85 * uGrassR, uGrassR, length(bp)))'};
        if (uCut > 0.0 && bp.x > -0.05 && bp.y > -0.05 && dot(bp, bp) < (uCut + 0.1) * (uCut + 0.1)) vis = 0.0;
        float pp = uClock - floor(uClock), lodge;
        vec4 st = grassState(pp, kind, uSnow, lodge);
        bool culm = bI < 0.5 && kind <= 1 && rb < 0.85;
        float h = culm ? T0.w * 1.45 * (0.85 + 0.3 * rb) * st.z * vis * (1.0 - 0.65 * uSnow) : T0.w * (0.6 + 0.55 * rb) * st.x * vis;
        float tw = (rb2 - 0.5) * 1.2;
        vec2 dir = vec2(cos(ang + tw), sin(ang + tw));
        float lean = culm ? 0.05 + 0.3 * lodge : LEAN[kind].x + LEAN[kind].y * rb2 + 0.6 * lodge;
        float gs = gust(bp, uTime, uWindDir);
        float wv = uWind * (0.25 + 1.2 * gs) * (1.0 - 0.5 * lodge);
        float wdt = culm ? (tt > 0.8 ? 0.0022 + 0.0045 * st.z * sin(3.14159 * (tt - 0.8) / 0.2) : 0.0016) : BLADE_W[kind] * (0.75 + 0.5 * rb) * T1.w * (7.0 / (nB - 1.0)) * (1.0 - 0.8 * tt);
        float hz = lean * h * pow(tt, 1.6) + (culm ? 0.12 * h * tt * tt * tt * tt : 0.0);
        float vy = h * tt * (1.0 - 0.55 * min(lean, 1.2) * tt) - 0.3 * wv * h * tt * tt;
        float fl = 0.03 * uWind * h * tt * tt * sin(uTime * 6.0 + rb * 30.0 + bp.x * 2.0);
        float sway = wv * h * tt * tt * 0.8 + fl;
        bladeP = vec3(bp.x + dir.x * hz + uWindDir.x * sway - dir.y * wdt * side,
                           groundY(bp.x, bp.y) + max(0.002, vy),
                           bp.y + dir.y * hz + uWindDir.y * sway + dir.x * wdt * side);
        if (h < 0.004) bladeP = vec3(0.0, -50.0, 0.0);
        vec3 tng = normalize(vec3(dir.x * lean * 1.6 + uWindDir.x * wv * 1.6 * tt, 1.0 - lean * tt, dir.y * lean * 1.6 + uWindDir.y * wv * 1.6 * tt));
        vec3 acr = vec3(-dir.y, 0.0, dir.x);
        objectNormal = normalize(mix(cross(acr, tng), vec3(0.0, 1.0, 0.0), 0.45));
        float tint = fract(T1.y * 7.31), tint2 = fract(T1.y * 3.17);
        vec3 fresh = mix(${v3(GRASS_COL.base)}, ${v3(GRASS_COL.tip)}, 0.5) * (0.82 + 0.36 * tint);
        fresh = mix(fresh, fresh * vec3(1.2, 1.0, 0.7), tint2 * 0.6);
        if (kind == 2) fresh *= vec3(0.7, 0.85, 1.1);
        vec3 dry = mix(${v3(GRASS_COL.dead)}, ${v3(GRASS_COL.straw)}, st.w * 0.6 + 0.25);
        vec3 gc = mix(dry, fresh, pow(st.y, 0.8 + 0.6 * rb));
        if (!culm && rb > 0.9) gc = dry * 0.85;
        gc *= (0.55 + 0.6 * tt) * (1.0 - 0.5 * fWoodShade(bp));
        if (culm && tt > 0.8) gc = mix(mix(gc, mix(${v3(GRASS_COL.flower)}, ${v3(GRASS_COL.flower2)}, tint), 0.6), ${v3(GRASS_COL.ripe)}, st.w);
        vGc = gc * (1.0 + 0.2 * gs * uWind);
        vGt = tt; vGsnow = uSnow * tt;
        }`)
      .replace('#include <begin_vertex>', 'vec3 transformed = bladeP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGc; varying float vGt, vGsnow;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb = mix(vGc, vec3(0.8, 0.83, 0.88), vGsnow * 0.6);')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= 0.4 + 0.6 * vGt;');
  };
  m.customProgramCacheKey = () => 'pg-grass2' + (proc ? 'p' : '');
  return m;
}

// ------------------------------------------------------------ nature props
// role: 'stone' | 'forb' | 'shrub' | 'stump'. Instance attribute aE = (sp
// (forb index), rand, object height (m, unscaled), stone size (m)).
export function natureMaterial(THREE, U, COMMON, role, tex) {
  const foliage = !!tex.alpha;
  const m = new THREE.MeshStandardMaterial({ roughness: role === 'stone' ? 0.92 : 0.82, metalness: 0, envMapIntensity: 0.6 });
  if (tex.map) m.map = tex.map;
  if (tex.normal) m.normalMap = tex.normal;
  if (foliage) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; m.alphaToCoverage = true; }
  const R = { stone: 0, forb: 1, shrub: 2, stump: 3 }[role];
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON + FORB_GLSL + /* glsl */`
        attribute vec4 aE;
        varying vec3 vNw, vWpos; varying float vBloom, vBrown, vBare, vLight, vRand, vSize;`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float pp = uClock - floor(uClock);
        vLight = fLight(ip.xz); vRand = aE.y; vBloom = 0.0; vBrown = 0.0; vBare = 0.0; vSize = aE.w;
        float hrel = clamp(position.y / max(aE.z, 1e-3), 0.0, 1.0);
        ${R === 1 ? /* glsl */`
        int sp = int(aE.x + 0.5);
        float vig = forbVigour(sp, vLight), life = forbLife(sp, pp);
        float kk = vig * life;
        vec4 fl4 = FLIFE[sp];
        vBrown = smoothstep(fl4.z - 0.05, fl4.w, pp) * (1.0 - FNICHE[sp].z * 0.7);
        vBloom = forbBloom(sp, pp) * smoothstep(0.25, 0.5, vig);
        float unf = FNICHE[sp].w > 1.5 && FNICHE[sp].w < 2.5 ? kk * kk : kk;
        transformed = vec3(transformed.x * mix(0.35, 1.0, kk), transformed.y * unf, transformed.z * mix(0.35, 1.0, kk));
        if (kk < 0.03) transformed = vec3(0.0, -50.0, 0.0);
        transformed.y *= 1.0 - 0.6 * uSnow * (1.0 - FNICHE[sp].z);` : ''}
        ${R === 2 ? /* glsl */`
        vBrown = smoothstep(0.74, 0.86, pp);
        vBare = smoothstep(0.84, 0.92, pp) * (1.0 - smoothstep(0.27, 0.36, pp)) + (pp < 0.3 ? 1.0 - smoothstep(0.27, 0.36, pp) : 0.0);
        vBare = clamp(vBare, 0.0, 1.0);` : ''}
        ${R === 1 || R === 2 ? /* glsl */`
        float gsP = gust(ip.xz, uTime, uWindDir);
        vec3 wo = normalize(vec3(uWindDir.x, 0.0, uWindDir.y) * mat3(instanceMatrix));
        transformed += wo * aE.z * uWind * (0.06 + 0.16 * gsP) * hrel * hrel * ${R === 2 ? '0.35' : '1.0'};
        transformed += wo * aE.z * 0.02 * uWind * hrel * sin(uTime * 3.1 + vRand * 20.0);` : ''}
        vNw = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        vWpos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON + /* glsl */`
        varying vec3 vNw, vWpos; varying float vBloom, vBrown, vBare, vLight, vRand, vSize;
        float dith(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`)
      .replace('#include <alphatest_fragment>', /* glsl */`
        ${R === 1 ? /* glsl */`
        {
          vec3 a = diffuseColor.rgb;
          bool green = a.g > a.r * 1.05 && a.g > a.b * 1.05;
          float mx = max(a.r, max(a.g, a.b));
          if (!green && mx > 0.16 && dith(gl_FragCoord.xy + vRand * 97.0) > vBloom) discard;
        }` : ''}
        ${R === 2 ? /* glsl */`
        {
          vec3 a = diffuseColor.rgb;
          float leaf = smoothstep(-0.01, 0.04, a.g - max(a.r, a.b) * 0.9);
          if (leaf > 0.5 && dith(gl_FragCoord.xy + vRand * 97.0) < vBare * 0.85) discard;
        }` : ''}
        #include <alphatest_fragment>`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        ${R === 0 ? /* glsl */`
        {
          float north = clamp(dot(vNw.xz, -SUN_XZ) * 0.75 + vNw.y * 0.35, 0.0, 1.0);
          float wet = vnoise(vWpos.xz * 9.0 + vWpos.y * 3.0, 31u);
          float moss = clamp(north * (1.35 - vLight) * smoothstep(0.06, 0.4, vSize) * (0.55 + 0.9 * wet) - 0.1, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, ${v3(GROUND_COL.moss)} * (0.7 + 0.6 * wet), moss);
        }` : ''}
        ${R === 1 || R === 2 ? 'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 0.82, 0.38) * 0.8, vBrown * 0.85);' : ''}
        diffuseColor.rgb *= 1.0 - 0.45 * fWoodShade(vWpos.xz);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.94), uSnow * smoothstep(0.35, 0.8, vNw.y) * ${R === 0 || R === 3 ? '0.95' : '0.55'});`);
  };
  m.customProgramCacheKey = () => 'pg-nat-' + R + (foliage ? 'f' : '') + (tex.normal ? 'n' : '');
  return m;
}

// ------------------------------------------------------------------ litter
// aL0 = x, z, rot, rand; aL1 = rank, plant, size, tilt. uPlantLeaf[k] =
// (species index, first atlas cell, cells, deciduous) of plant k.
export function litterMaterial(THREE, U, COMMON, atlas) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5, alphaTest: 0.5 });
  const own = { uAtlasC: { value: atlas.c }, uAtlasA: { value: atlas.a }, uLitK: { value: 0 }, uDecay: { value: 0 }, uPlantLeaf: { value: [] } };
  for (let k = 0; k < 12; k++) own.uPlantLeaf.value.push(new THREE.Vector4(0, 0, 1, 0));
  m.userData.own = own;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON + /* glsl */`
        attribute vec4 aL0, aL1;
        uniform float uLitK, uDecay; uniform vec4 uPlantLeaf[12];
        varying vec2 vLuv; varying vec3 vLc;`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        int pk = int(aL1.y + 0.5);
        vec4 cr = uCrown[pk], pl = uPlantLeaf[pk];
        float d = length(aL0.xy - cr.xy);
        float supply = clamp(cr.z * cr.z / 30.0, 0.0, 1.0) * pl.w * step(float(pk), uNCrown - 0.5);
        float show = step(d, cr.z * 1.35 + 0.6) * step(aL1.x, uLitK * supply);
        int cell = int(pl.y + floor(fract(aL0.w * 7.7) * pl.z));
        vec4 cc = uCells[cell];
        float sz = aL1.z * (1.0 - 0.3 * uDecay) * show;
        vec2 q = vec2(position.x * sz * 0.62, (position.y - 0.5) * sz);
        float ca = cos(aL0.z), sa = sin(aL0.z);
        vec2 xz = aL0.xy + vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
        float curl = (0.012 + 0.02 * aL1.w) * (1.0 - uDecay) * sz * 10.0;
        vec3 objectNormal = vec3(0.0, 1.0, 0.0);
        vec3 litP = vec3(xz.x, groundY(xz.x, xz.y) + 0.003 + 0.004 * aL1.w + curl * position.x * position.x, xz.y);
        if (show < 0.5) litP = vec3(0.0, -50.0, 0.0);
        vLuv = vec2(mix(cc.x, cc.z, position.x + 0.5), mix(cc.y, cc.w, position.y));
        int sp = int(pl.x + 0.5);
        float r3 = fract(aL0.w * 13.1);
        vec3 aut = r3 < 0.33 ? uAut0[sp].rgb : r3 < 0.66 ? uAut1[sp].rgb : uAut2[sp].rgb;
        vLc = mix(aut, ${v3(GROUND_COL.rot)}, uDecay * 0.8) * (0.8 + 0.4 * fract(aL0.w * 3.3));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = litP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uAtlasC, uAtlasA; uniform float uSnow; varying vec2 vLuv; varying vec3 vLc;')
      .replace('#include <map_fragment>', /* glsl */`
        float la = texture(uAtlasA, vLuv).r;
        vec3 lt = texture(uAtlasC, vLuv).rgb;
        diffuseColor.rgb = mix(vLc * (0.65 + 0.7 * dot(lt, vec3(0.333))), vec3(0.84, 0.87, 0.92), uSnow * 0.85);
        diffuseColor.a = la;`);
  };
  m.customProgramCacheKey = () => 'pg-litter';
  return m;
}

// ------------------------------------------------------------------ petals
// aP0 = x, z, top height (m), rand; aP1 = forb index, r, g, b (linear).
export function petalMaterial(THREE, U, COMMON) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON + FORB_GLSL + /* glsl */`
        attribute vec4 aP0, aP1; varying vec3 vPc; varying vec2 vPq;`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        int sp = int(aP1.x + 0.5);
        float pp = uClock - floor(uClock);
        vec2 bl = FBLOOM[sp];
        float t0 = bl.y - 0.012 + 0.03 * aP0.w;
        float f = clamp((pp - t0) / 0.02, 0.0, 1.0), lie = clamp((pp - t0 - 0.02) / 0.05, 0.0, 1.0);
        float vig = forbVigour(sp, fLight(aP0.xy));
        float on = (bl.x > 0.0 && pp > t0 && pp < t0 + 0.075 && vig > 0.3) ? 1.0 : 0.0;
        float gy = groundY(aP0.x, aP0.y);
        float hgt = mix(aP0.z, 0.003, f * f);
        float ph = aP0.w * 40.0;
        vec2 drift = uWindDir * f * (0.15 + 0.35 * aP0.w) * aP0.z * 2.0 + vec2(sin(ph + f * 9.0), cos(ph * 1.3 + f * 7.0)) * 0.04 * f * (1.0 - lie);
        float tumble = f < 1.0 ? f * 12.0 + ph : ph;
        float s = 0.011 * (1.0 - lie) * on;
        vec2 q = position.xy * s;
        float ct = cos(tumble), st2 = sin(tumble);
        vec3 off = f < 1.0 ? vec3(q.x, q.y * ct, q.y * st2) : vec3(q.x, 0.0, q.y);
        vec3 objectNormal = f < 1.0 ? vec3(0.0, -st2, ct) : vec3(0.0, 1.0, 0.0);
        vec3 petP = vec3(aP0.x + drift.x, gy + hgt + 0.002, aP0.y + drift.y) + off;
        if (s <= 0.0) petP = vec3(0.0, -50.0, 0.0);
        vPc = aP1.yzw; vPq = position.xy;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = petP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPc; varying vec2 vPq;')
      .replace('#include <map_fragment>', 'if (dot(vPq * vec2(1.0, 1.7), vPq * vec2(1.0, 1.7)) > 0.25) discard; diffuseColor.rgb = vPc;');
  };
  m.customProgramCacheKey = () => 'pg-petal';
  return m;
}

// --------------------------------------------------------------- seedlings
// Geometry: a stem (4 sides, position.z = -1) and 6 leaves (position.z =
// leaf index). aS0 = x, z, born, died; aS1 = growth (m/yr), species index,
// rand, first atlas cell; aS2 = cells, evergreen, 0, 0.
export function seedlingGeometry(THREE) {
  const pos = [], idx = [];
  for (let s = 0; s < 4; s++) {
    const b = pos.length / 3;
    pos.push(s, 0, -1, s + 1, 0, -1, s, 1, -1, s + 1, 1, -1);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  for (let l = 0; l < 6; l++) {
    const b = pos.length / 3;
    pos.push(-0.5, 0, l, 0.5, 0, l, -0.5, 1, l, 0.5, 1, l);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  geo.setIndex(idx);
  geo.instanceCount = 0;
  return geo;
}
export function seedlingMaterial(THREE, U, COMMON, atlas) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6, alphaTest: 0.5 });
  const own = { uAtlasC: { value: atlas.c }, uAtlasA: { value: atlas.a } };
  m.userData.own = own;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON + /* glsl */`
        attribute vec4 aS0, aS1, aS2;
        varying vec2 vSuv; varying vec3 vSc; varying float vStem;`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float age = uClock - aS0.z;
        float dead = clamp((uClock - aS0.w) / 0.25, 0.0, 1.0);
        float on = age > 0.0 && uClock < aS0.w + 0.25 ? 1.0 : 0.0;
        float h = min(${(1.7).toFixed(2)}, 0.035 + aS1.x * max(age, 0.0));
        float pp = uClock - floor(uClock);
        float ever = aS2.y;
        float leafOn = ever > 0.5 ? 1.0 : smoothstep(0.29, 0.35, pp) * (1.0 - smoothstep(0.8, 0.87, pp));
        if (age < 0.7) leafOn = max(leafOn, smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.55, 0.62, pp)));
        float aut = ever > 0.5 ? 0.0 : smoothstep(0.72, 0.8, pp);
        int sp = int(aS1.y + 0.5);
        float gy = groundY(aS0.x, aS0.y);
        float lean = (fract(aS1.z * 5.3) - 0.5) * 0.25 * h;
        float swayS = uWind * 0.04 * h * sin(uTime * 2.3 + aS1.z * 30.0);
        vec3 sP; vec3 objectNormal;
        vStem = 0.0; vSuv = vec2(0.0);
        if (position.z < -0.5) {
          float r = (0.0015 + 0.006 * h) * (1.0 - 0.7 * position.y);
          float a = position.x * 1.5707963;
          vec2 rd = vec2(cos(a), sin(a));
          sP = vec3(aS0.x + rd.x * r + (lean + swayS) * position.y * position.y, gy + position.y * h, aS0.y + rd.y * r);
          objectNormal = vec3(rd.x, 0.0, rd.y);
          vStem = 1.0;
        } else {
          float li = position.z;
          float nLeaf = clamp(2.0 + h * 9.0, 2.0, 6.0);
          float lvis = li < nLeaf ? 1.0 : 0.0;
          float at = 0.35 + 0.65 * (li + 1.0) / max(nLeaf, 1.0);
          float ls = (0.025 + 0.05 * min(1.0, h * 1.5)) * leafOn * lvis * (1.0 - 0.5 * dead);
          float la = li * 2.39996 + aS1.z * 6.28;
          vec2 ld = vec2(cos(la), sin(la));
          vec3 o = vec3(aS0.x + (lean + swayS) * at * at, gy + at * h, aS0.y);
          float droop = 0.35 + 0.3 * dead;
          vec3 dl = normalize(vec3(ld.x, 0.45 - droop, ld.y));
          vec3 wd = vec3(-ld.y, 0.0, ld.x);
          sP = o + dl * position.y * ls + wd * position.x * ls * 0.75;
          objectNormal = normalize(cross(wd, dl));
          if (objectNormal.y < 0.0) objectNormal = -objectNormal;
          int cell = int(aS1.w + floor(fract(aS1.z * 3.7 + li * 0.31) * aS2.x));
          vec4 cc = uCells[cell];
          vSuv = vec2(mix(cc.x, cc.z, position.x + 0.5), mix(cc.y, cc.w, position.y));
          if (ls <= 0.0) sP = vec3(0.0, -50.0, 0.0);
        }
        if (on < 0.5) sP = vec3(0.0, -50.0, 0.0);
        vec3 autC = uAut0[sp].rgb;
        vSc = mix(mix(vec3(1.0), autC * 2.2, aut), vec3(0.55, 0.42, 0.25), dead);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = sP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uAtlasC, uAtlasA; varying vec2 vSuv; varying vec3 vSc; varying float vStem;')
      .replace('#include <map_fragment>', /* glsl */`
        if (vStem > 0.5) { diffuseColor.rgb = vec3(0.16, 0.11, 0.07); diffuseColor.a = 1.0; }
        else {
          vec3 lc = texture(uAtlasC, vSuv).rgb;
          diffuseColor.rgb = vSc.r > 0.99 && vSc.g > 0.99 ? lc : lc * 0.3 + vSc * 0.35 * dot(lc, vec3(0.6));
          diffuseColor.a = texture(uAtlasA, vSuv).r;
        }`);
  };
  m.customProgramCacheKey = () => 'pg-seedling';
  return m;
}

// --------------------------------------------------------------- impostors
// One quad per tree. aW0 = x, y, z, scale; aW1 = rot, rand. The view atlas
// is 3 x 3: cell k < 8 a side view from azimuth k * 45 deg, cell 8 the top.
export function impostorMaterial(THREE, U, imp, deciduous) {
  return new THREE.ShaderMaterial({
    fog: true, transparent: false, alphaToCoverage: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uAlb: { value: imp.tex }, uHalf: { value: new THREE.Vector2(imp.half[0], imp.half[1]) }, uCy: { value: imp.cy },
      uSunK: { value: 1 }, uSunDir: { value: new THREE.Vector3(0.5, 0.75, 0.4) },
    }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aW0, aW1;
      uniform vec2 uHalf; uniform float uCy;
      varying vec2 vUv; varying vec3 vK; varying float vRand, vSide;
      void main() {
        vec3 base = aW0.xyz; float s = aW0.w;
        vec3 toC = cameraPosition - base;
        vec3 fw = normalize(vec3(toC.x, 0.0, toC.z) + vec3(1e-5, 0.0, 0.0));
        vec3 rt = vec3(fw.z, 0.0, -fw.x);
        float az = atan(fw.x, fw.z) - aW1.x;
        float f = az / 0.78539816;
        f = f - 8.0 * floor(f / 8.0);
        float k0 = floor(f);
        vK = vec3(k0, mod(k0 + 1.0, 8.0), f - k0);
        vec3 P = base + vec3(0.0, uCy * s, 0.0) + rt * position.x * uHalf.x * s + vec3(0.0, position.y * uHalf.y * s, 0.0);
        vUv = position.xy * 0.5 + 0.5;
        vRand = aW1.y; vSide = dot(fw, vec3(0.5, 0.0, 0.42));
        vec4 mvPosition = viewMatrix * vec4(P, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uAlb; uniform float uClock, uSnow, uSunK;
      varying vec2 vUv; varying vec3 vK; varying float vRand, vSide;
      vec4 cellAt(float k) {
        float col = mod(k, 3.0), row = floor(k / 3.0);
        vec2 uv = vec2((col + vUv.x) / 3.0, 1.0 - (row + 1.0 - vUv.y) / 3.0);
        return texture2D(uAlb, uv);
      }
      float dith(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void main() {
        vec4 a = mix(cellAt(vK.x), cellAt(vK.y), vK.z);
        if (a.a < 0.5) discard;
        vec3 c = a.rgb;
        float pp = uClock - floor(uClock);
        ${deciduous ? /* glsl */`
        float leaf = smoothstep(-0.01, 0.04, c.g - max(c.r, c.b) * 0.92);
        float aut = smoothstep(0.73, 0.82, pp) * (1.0 - smoothstep(0.88, 0.93, pp));
        float bare = smoothstep(0.86, 0.93, pp) + 1.0 - smoothstep(0.28, 0.37, pp);
        bare = clamp(bare, 0.0, 1.0);
        float lum = dot(c, vec3(0.3, 0.55, 0.15));
        vec3 autC = mix(vec3(0.62, 0.3, 0.06), vec3(0.75, 0.55, 0.12), fract(vRand * 7.3)) * lum * 2.2;
        c = mix(c, autC, aut * leaf * 0.85);
        c = mix(c, c * vec3(1.05, 1.12, 0.8), (1.0 - smoothstep(0.36, 0.45, pp)) * leaf * 0.5);
        if (leaf > 0.5 && dith(gl_FragCoord.xy) < bare * 0.72) discard;
        c = mix(c, vec3(0.2, 0.17, 0.15) * (0.7 + lum), bare * leaf);` : ''}
        c = mix(c, vec3(0.82, 0.85, 0.9), uSnow * 0.25);
        c *= 0.62 * (0.62 + 0.38 * uSunK) * (0.85 + 0.25 * vSide);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ---------------------------------------------------------- asset loading
// The nature pack: manifest.json, GLB meshes (glb-lite parseGLB) and WebP
// maps (TextureLoader, glTF uv: flipY off). Each asset gives [{ geo,
// material record }] per material.
function loadAsset(THREE, cache, man, id, lod) {
  const key = id + '|' + lod;
  if (cache.geo.has(key)) return cache.geo.get(key);
  const rec = man.assets.find(a => a.id === id);
  if (!rec) return Promise.resolve(null);
  const L = rec.lods[Math.min(lod, rec.lods.length - 1)];
  const url = NAT + L.file;
  const p = fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }).then(buf => {
    const sc = parseGLB(buf);
    const parts = sc.meshes.map(mm => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(mm.positions, 3));
      if (mm.normals) g.setAttribute('normal', new THREE.BufferAttribute(mm.normals, 3));
      if (mm.uvs) g.setAttribute('uv', new THREE.BufferAttribute(mm.uvs, 2));
      g.setIndex(new THREE.BufferAttribute(mm.indices, 1));
      if (!mm.normals) g.computeVertexNormals();
      const mat = mm.material, base = new URL(L.file, NAT).href;
      const texOf = (img, srgb) => {
        if (!img || !img.uri) return null;
        const u = new URL(img.uri, base).href;
        if (!cache.tex.has(u)) {
          const t = cache.loader.load(u);
          t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          cache.tex.set(u, t);
        }
        return cache.tex.get(u);
      };
      return { geo: g, map: texOf(mat.baseColor, true), normal: texOf(mat.normal, false), alpha: mat.alphaMode === 'MASK', name: mat.name };
    });
    return { rec, parts };
  }).catch(() => null);
  cache.geo.set(key, p);
  return p;
}

// ------------------------------------------------------------ the meadow
// ctx: { THREE, scene, U, COMMON, coarse, atlas, limits, cellOf(spIndex,
// variant) -> cell, cellsOf(spIndex) -> [first, n], evergreen(spIndex) }
export function createMeadow(ctx) {
  const { THREE, scene, U, COMMON, coarse } = ctx;
  const group = new THREE.Group(); scene.add(group);
  const cache = { geo: new Map(), tex: new Map(), loader: new THREE.TextureLoader(), mats: new Map(), imp: new Map() };
  let man = null, eco = null, token = 0;
  const manP = fetch(NAT + 'manifest.json').then(r => r.json()).then(j => { man = j; }).catch(() => { man = null; });

  // grass: the tussocks round the plants, and the far meadow round the camera
  const grassMat = grassMaterial(THREE, U, COMMON);
  let grass = null;
  const procMat = grassMaterial(THREE, U, COMMON, true);
  const procN = ctx.limits.procN || PROC.n;
  procMat.userData.own.uProcN.value = procN;
  const procGeo = grassGeometry(THREE, new Float32Array(8));
  procGeo.deleteAttribute('aT0'); procGeo.deleteAttribute('aT1');
  procGeo.instanceCount = 2 * procN * procN;
  const procMesh = new THREE.Mesh(procGeo, procMat);
  procMesh.frustumCulled = false; procMesh.receiveShadow = true;
  group.add(procMesh);
  // litter, petals, seedlings
  const litMat = litterMaterial(THREE, U, COMMON, ctx.atlas);
  const quad = new THREE.PlaneGeometry(1, 1, 2, 2); quad.translate(0, 0.5, 0);
  let litter = null, petals = null;
  const petMat = petalMaterial(THREE, U, COMMON);
  const seedGeo = seedlingGeometry(THREE), seedMat = seedlingMaterial(THREE, U, COMMON, ctx.atlas);
  const seedMesh = new THREE.Mesh(seedGeo, seedMat); seedMesh.frustumCulled = false; seedMesh.castShadow = false; seedMesh.receiveShadow = true;
  group.add(seedMesh);
  let props = [], woods = [];
  const impMats = [];

  // each sowing (each saver shot) rebuilds the props: free the per-build
  // geometry (a clone with its own aE buffer, or an instanced quad) and
  // the instance matrices
  function clear(list) {
    for (const o of list) { group.remove(o); if (o.isInstancedMesh) o.dispose(); if (o.geometry) o.geometry.dispose(); }
    list.length = 0;
  }
  function instGeo(src, attrs, n) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = src.index;
    for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]);
    for (const [name, arr, size] of attrs) g.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size));
    g.instanceCount = n;
    return g;
  }

  // one call per new community
  function setEco(e, plantLeaf) {
    eco = e; const my = ++token;
    // grass
    if (grass) { group.remove(grass); grass.geometry.dispose(); }
    grass = new THREE.Mesh(grassGeometry(THREE, e.tussocks), grassMat);
    grass.frustumCulled = false; grass.receiveShadow = true;
    grassMat.userData.own.uGrassR.value = ctx.limits.R;
    procMat.userData.own.uGrassR.value = ctx.limits.R;
    group.add(grass);
    // litter
    if (litter) { group.remove(litter); litter.geometry.dispose(); }
    const n = e.litter.length / 8;
    const lg = new THREE.InstancedBufferGeometry(); lg.index = quad.index;
    lg.setAttribute('position', quad.getAttribute('position')); lg.setAttribute('normal', quad.getAttribute('normal'));
    const lb = new THREE.InstancedInterleavedBuffer(e.litter, 8, 1);
    lg.setAttribute('aL0', new THREE.InterleavedBufferAttribute(lb, 4, 0)); lg.setAttribute('aL1', new THREE.InterleavedBufferAttribute(lb, 4, 4));
    lg.instanceCount = n;
    litter = new THREE.Mesh(lg, litMat); litter.frustumCulled = false; litter.receiveShadow = true; group.add(litter);
    const pl = litMat.userData.own.uPlantLeaf.value;
    (plantLeaf || []).slice(0, 12).forEach((q, k) => pl[k].set(q[0], q[1], q[2], q[3]));
    // petals: three per flowering forb
    if (petals) { group.remove(petals); petals.geometry.dispose(); petals = null; }
    const fl = e.forbs.filter(f => FORBS[f.sp].petal);
    if (fl.length) {
      const P0 = new Float32Array(fl.length * 3 * 4), P1 = new Float32Array(fl.length * 3 * 4);
      let k = 0;
      for (const f of fl) {
        const S = FORBS[f.sp], col = hexLin(S.petal);
        for (let j = 0; j < 3; j++, k++) {
          const a = f.rot + j * 2.1;
          P0.set([f.x + Math.cos(a) * 0.02, f.z + Math.sin(a) * 0.02, S.h0 * f.scale * 0.92, (f.rand * 3.7 + j * 0.31) % 1], k * 4);
          P1.set([f.sp, col[0], col[1], col[2]], k * 4);
        }
      }
      const pq = new THREE.PlaneGeometry(1, 1);
      const pg = instGeo(pq, [['aP0', P0, 4], ['aP1', P1, 4]], k);
      petals = new THREE.Mesh(pg, petMat); petals.frustumCulled = false; group.add(petals);
    }
    // props and woodland once the manifest is in
    manP.then(() => { if (man && my === token) buildProps(my); });
  }

  async function buildProps(my) {
    clear(props); clear(woods);
    const lod = ctx.limits.lod;
    const groups = new Map();   // asset|lod -> { role, items }
    const add = (asset, lodI, role, item) => { const k = asset + '|' + lodI; if (!groups.has(k)) groups.set(k, { asset, lod: lodI, role, items: [] }); groups.get(k).items.push(item); };
    for (const s of eco.stones) add(s.asset, s.cls === 2 ? lod : 2, 'stone', s);
    for (const f of eco.forbs) add(f.asset, FORBS[f.sp].kind === 'fern' ? lod : 2, 'forb', f);
    for (const s of eco.shrubs) add(s.asset, lod, 'shrub', s);
    if (eco.stump) add(eco.stump.asset, lod, 'stump', eco.stump);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), SC = new THREE.Vector3();
    await Promise.all([...groups.values()].map(async G => {
      const a = await loadAsset(THREE, cache, man, G.asset, G.lod);
      if (!a || my !== token) return;
      const rec = a.rec, H = rec.height || 1;
      const n = G.items.length;
      const aE = new Float32Array(n * 4), mats = [];
      G.items.forEach((o, i) => {
        let sc;
        if (G.role === 'stone') sc = o.s / Math.max(0.02, rec.footprint);
        else sc = o.scale;
        const h = H * sc;
        const sink = G.role === 'stone' ? o.sink * h : G.role === 'stump' ? 0.04 : 0.01;
        E.set(o.tilt || 0, o.rot, (o.tilt || 0) * 0.7); Q.setFromEuler(E);
        P.set(o.x, groundY(o.x, o.z) - sink, o.z); SC.setScalar(sc);
        M.compose(P, Q, SC); mats.push(M.clone());
        aE.set([o.sp ?? 0, o.rand ?? 0, H, G.role === 'stone' ? o.s : h], i * 4);
      });
      for (const part of a.parts) {
        const mk = G.role + '|' + part.name;
        if (!cache.mats.has(mk)) cache.mats.set(mk, natureMaterial(THREE, U, COMMON, G.role, part));
        const geo = part.geo.clone();
        geo.setAttribute('aE', new THREE.InstancedBufferAttribute(aE, 4));
        const im = new THREE.InstancedMesh(geo, cache.mats.get(mk), n);
        mats.forEach((mm, i) => im.setMatrixAt(i, mm));
        im.castShadow = G.role === 'stone' || G.role === 'stump';
        im.receiveShadow = true;
        im.frustumCulled = false;
        group.add(im); props.push(im);
      }
    }));
    if (my !== token) return;
    // woodland impostors, one mesh per tree asset
    const byA = new Map();
    for (const w of eco.woodland) { if (!byA.has(w.asset)) byA.set(w.asset, []); byA.get(w.asset).push(w); }
    const quadW = new THREE.PlaneGeometry(2, 2);
    for (const [id, items] of byA) {
      const rec = man.assets.find(a => a.id === id);
      if (!rec || !rec.impostor) continue;
      const im = rec.impostor, url = new URL(im.albedo, NAT).href;
      if (!cache.tex.has(url)) { const t = cache.loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; cache.tex.set(url, t); }
      let mat = cache.imp.get(id);   // one material per tree asset, kept across sowings
      if (!mat) {
        mat = impostorMaterial(THREE, U, { tex: cache.tex.get(url), half: im.sideHalfSize, cy: im.centre[1] }, !/fir|pine/.test(id));
        mat.uniforms.uClock = U.uClock; mat.uniforms.uSnow = U.uSnow;
        cache.imp.set(id, mat); impMats.push(mat);
      }
      const W0 = new Float32Array(items.length * 4), W1 = new Float32Array(items.length * 4);
      items.forEach((w, i) => { W0.set([w.x, groundY(w.x, w.z) - 0.2, w.z, w.scale], i * 4); W1.set([w.rot, w.rand, 0, 0], i * 4); });
      const g = instGeo(quadW, [['aW0', W0, 4], ['aW1', W1, 4]], items.length);
      const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; group.add(mesh); woods.push(mesh);
    }
  }

  // seedlings: list from eco.js seedlings(), info(spIndex) -> [first cell, cells, evergreen]
  let seedCap = 0, sb = null;
  function setSeedlings(list, info) {
    const n = Math.min(list.length, ctx.limits.seedlings);
    if (n > seedCap) {
      seedCap = Math.max(16, Math.ceil(n * 1.5));
      sb = [new Float32Array(seedCap * 4), new Float32Array(seedCap * 4), new Float32Array(seedCap * 4)];
      seedGeo.setAttribute('aS0', new THREE.InstancedBufferAttribute(sb[0], 4));
      seedGeo.setAttribute('aS1', new THREE.InstancedBufferAttribute(sb[1], 4));
      seedGeo.setAttribute('aS2', new THREE.InstancedBufferAttribute(sb[2], 4));
    }
    for (let i = 0; i < n; i++) {
      const s = list[i], q = info(s.spIndex);
      sb[0].set([s.x, s.z, s.born, Number.isFinite(s.died) ? s.died : 1e6], i * 4);
      sb[1].set([s.growth, s.spIndex, s.rand, q[0]], i * 4);
      sb[2].set([q[1], q[2], 0, 0], i * 4);
    }
    if (sb) for (const k of ['aS0', 'aS1', 'aS2']) seedGeo.getAttribute(k).needsUpdate = true;
    seedGeo.instanceCount = n;
  }

  function frame(o) {
    litMat.userData.own.uLitK.value = o.litterK; litMat.userData.own.uDecay.value = o.decay;
    for (const m of impMats) { m.uniforms.uSunK.value = o.sunK; }
  }
  function stats() {
    return { tussocks: grass ? grass.geometry.instanceCount : 0, farMeadow: procGeo.instanceCount, props: props.reduce((s, m) => s + m.count, 0), woodland: eco ? eco.woodland.length : 0, seedlings: seedGeo.instanceCount };
  }
  return { group, setEco, setSeedlings, frame, stats };
}
