// ============================================================================
//  PLANT GROWTH  ·  the three.js scene (r160, WebGL 2)
// ----------------------------------------------------------------------------
//  The plant is drawn from five float textures per structure (pose.js
//  packYear: T0..T4, 256 texels per row). Two instanced meshes read them:
//
//  BRANCHES  one instance per node: a ring at the parent and a ring at the
//            node, each with the frame of its node (the bisector of the two
//            segments that meet there), so all segments of an axis join into
//            one smooth tapered tube (a generalised cylinder). The vertex
//            shader grows the segment from its parent (born, dur), swells
//            the radius from last year's ring to this year's (girth), drops
//            a shed branch to the ground, flares the trunk foot and bends
//            all of it in the wind. Bark: scanned CC0 colour and normal maps
//            in a texture array (one layer per species), twig colour on thin
//            shoots, snow on the upper side in winter.
//  LEAVES    one instance per leaf record (8 floats). The vertex shader runs
//            the leaf calendar of season.js (unfold, autumn colour, detach,
//            fall and tumble, lie on the ground, rot), sets the blade on its
//            twig (blade, spray, pinna, hanging), folds and curls it, and
//            flutters it in the wind. The fragment shader reads the leaf
//            atlas (scans, alpha, normal), turns the colour to the autumn
//            palette, and lights the leaf from both sides with a
//            translucent back light. Alpha to coverage with a mip-aware
//            alpha keeps far leaves dense and edges smooth.
//  Both cast shadows into the sun shadow map (custom depth materials that
//  run the same vertex code). The light value of each node (the shadow
//  grid of the model) darkens the sky light inside the crown (AO).
//
//  The scene round the plant: an analytic sky with a seasonal sun (and its
//  PMREM as the environment light), a ground of scanned CC0 grass and
//  litter maps on gentle hills, instanced grass blades that sway, the soil
//  cut-away for the roots, the seed before it germinates, and fog.
//
//  grep -n targets
//    shared uniforms ......... "function makeUniforms"
//    node fetch GLSL ......... "const NODE_GLSL"
//    branch shader ........... "function branchMaterial"
//    leaf shader ............. "function leafMaterial"
//    sky ..................... "function makeSky"
//    ground .................. "function makeGround"
//    grass ................... "function makeGrass"
//    cut-away ................ "function makeCutaway"
//    texture loading ......... "function loadArray"
//    public api .............. "const api = {"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { lut } from '../../lib/growth-gradients.js';
import { TEX_W, CELLS, speciesTables, WIND_GLSL } from './pose.js';
import { SEASON_GLSL } from './season.js';
import { GROUND_GLSL, grassField } from './ground.js';
import { BARKS } from './look.js';
import { ATLAS_SIZE } from './atlas.js';

const TAB = speciesTables();
const NSP = TAB.n, NCELL = CELLS.length;
const lin = v => Math.pow(v, 2.2);

// ------------------------------------------------------------ uniforms
function vec4Array(f32, linear) {
  const out = [];
  for (let k = 0; k < f32.length; k += 4) out.push(new THREE.Vector4(linear ? lin(f32[k]) : f32[k], linear ? lin(f32[k + 1]) : f32[k + 1], linear ? lin(f32[k + 2]) : f32[k + 2], f32[k + 3]));
  return out;
}
function makeUniforms(lutTex) {
  return {
    uClock: { value: 0 }, uTime: { value: 0 }, uWind: { value: 0.35 }, uWindDir: { value: new THREE.Vector2(0.93, 0.37) },
    uYear: { value: 0 }, uMode: { value: 0 }, uGlow: { value: 0 }, uSnow: { value: 0 }, uCut: { value: 0 },
    uRange: { value: new THREE.Vector2(0, 10) }, uLut: { value: lutTex }, uTrans: { value: 1 },
    uPheno: { value: vec4Array(TAB.pheno) }, uPheno2: { value: vec4Array(TAB.pheno2) }, uLeafA: { value: vec4Array(TAB.leafA) },
    uTint: { value: vec4Array(TAB.tint) }, uAut0: { value: vec4Array(TAB.aut0, true) }, uAut1: { value: vec4Array(TAB.aut1, true) },
    uAut2: { value: vec4Array(TAB.aut2, true) }, uLitter: { value: vec4Array(TAB.litter, true) }, uTwig: { value: vec4Array(TAB.twig, true) },
    uCells: { value: CELLS.map(c => new THREE.Vector4(c[0], c[1], c[2], c[3])) },
  };
}
const COMMON_GLSL = /* glsl */`
#define TEX_W ${TEX_W}
#define NSP ${NSP}
#define NCELL ${NCELL}
uniform float uClock, uTime, uWind, uYear, uMode, uGlow, uSnow, uCut, uTrans;
uniform vec2 uWindDir, uRange;
uniform vec4 uPheno[NSP], uPheno2[NSP], uLeafA[NSP], uTint[NSP], uAut0[NSP], uAut1[NSP], uAut2[NSP], uLitter[NSP], uTwig[NSP];
uniform vec4 uCells[NCELL];
uniform sampler2D uLut;
${SEASON_GLSL}
${WIND_GLSL}
${GROUND_GLSL}
vec3 heatOf(float t) { return texture(uLut, vec2(clamp(t, 0.002, 0.998), 0.5)).rgb; }
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;
const NODE_GLSL = /* glsl */`
uniform highp sampler2D uT0, uT1, uT2, uT3, uT4;
uniform float uRoot;
vec4 fT0(int i) { return texelFetch(uT0, ivec2(i % TEX_W, i / TEX_W), 0); }
vec4 fT1(int i) { return texelFetch(uT1, ivec2(i % TEX_W, i / TEX_W), 0); }
vec4 fT2(int i) { return texelFetch(uT2, ivec2(i % TEX_W, i / TEX_W), 0); }
vec4 fT3(int i) { return texelFetch(uT3, ivec2(i % TEX_W, i / TEX_W), 0); }
vec4 fT4(int i) { return texelFetch(uT4, ivec2(i % TEX_W, i / TEX_W), 0); }
int parentOf(float pe) { return pe >= 0.0 ? int(pe + 0.5) : int(-pe - 0.5); }
// the shown node: growth of its segment, girth, a death drop, the wind
vec4 nodeShown(int j, float t, out float g) {
  vec4 a0 = fT0(j), a1 = fT1(j), a4 = fT4(j);
  int sp = int(a4.x + 0.5);
  float dur = uPheno2[sp].y;
  int q = parentOf(a1.z);
  g = clamp((t - a0.w) / dur, 0.0, 1.0);
  vec3 p = a0.xyz;
  float pdied = a1.w;
  if (q != j) { vec4 b0 = fT0(q); p = b0.xyz + (p - b0.xyz) * g; pdied = fT1(q).w; }
  float r = mix(a1.x, a1.y, girthPhase(clamp(t - uYear, 0.0, 1.0)));
  if (t >= uYear + 1.0) r = a1.y;
  float frond = mod(a4.w, 2.0);
  float died = a1.w;
  if (t > died) {
    p.y -= deathDrop(t - died, p.y, frond);
    r *= deathFade(t - died, frond);
    if (q != j && pdied > died + 1e-4) r = 0.0;
  }
  if (uRoot < 0.5) p += windOffset(p, r, uWind, uTime, uWindDir);
  return vec4(p, g > 0.0 ? r : 0.0);
}
`;

// ------------------------------------------------------- branch material
// The body sets bPos (world position), objectNormal, and (not in the depth
// pass) the varyings.
const BRANCH_BODY = /* glsl */`
  int j = gl_InstanceID;
  vec4 a0 = fT0(j), a1 = fT1(j), a3 = fT3(j), a4 = fT4(j);
  int q = parentOf(a1.z);
  bool mainAx = a1.z >= 0.0;
  float gB, gA;
  vec4 B = nodeShown(j, uClock, gB);
  vec4 A = nodeShown(q, uClock, gA);
  int sp = int(a4.x + 0.5);
  vec3 seg = B.xyz - A.xyz; float L = length(seg);
  vec3 sd = L > 1e-6 ? seg / L : vec3(0.0, 1.0, 0.0);
  vec4 qq = fT2(q), qj = fT2(j);
  vec3 tA = mainAx ? qrot(qq, vec3(0.0, 1.0, 0.0)) : sd;
  float gc = clamp((uClock - a3.y) / uPheno2[sp].y, 0.0, 1.0);
  vec3 tB = normalize(mix(sd, qrot(qj, vec3(0.0, 1.0, 0.0)), gc));
  float ring = position.x;
  vec3 tt = ring < 0.5 ? tA : tB;
  vec3 n0 = ring < 0.5 ? qrot(qq, vec3(1.0, 0.0, 0.0)) : qrot(qj, vec3(1.0, 0.0, 0.0));
  vec3 nn = n0 - dot(n0, tt) * tt; float nl = length(nn);
  nn = nl > 1e-4 ? nn / nl : normalize(vec3(-tt.z, 0.0, tt.x) + vec3(1e-4, 0.0, 0.0));
  vec3 bb = cross(tt, nn);
  float ang = position.y * 6.2831853;
  vec3 dirO = cos(ang) * nn + sin(ang) * bb;
  float rA = mainAx ? A.w : B.w;
  float r = ring < 0.5 ? rA : B.w;
  if (q == j || B.w <= 0.0 || L < 1e-6) r = 0.0;
  float sq = fT3(q).x;
  float s = ring < 0.5 ? sq : sq + (a3.x - sq) * gB;
  if (a4.w >= 1.5 && s < 1.2) r *= 1.0 + 0.5 * exp(-s / 0.28) * min(1.0, r / 0.04) * (1.0 + 0.35 * max(0.0, sin(5.0 * ang)));
  vec3 C = ring < 0.5 ? A.xyz : B.xyz;
  vec3 bPos = C + dirO * r;
  if (r <= 0.0) bPos = vec3(0.0, -50.0, 0.0);
  vec3 objectNormal = dirO;
#ifndef DEPTH_PASS
  float tile = uTint[sp].w;
  float around = max(1.0, floor(6.2831853 * max(rA, 0.01) / tile * 2.0 + 0.5) * 0.5);
  vBarkUv = vec2(position.y * around, s / tile);
  vLayer = uLeafA[sp].w;
  vTwig = uRoot > 0.5 ? 1.0 - smoothstep(0.004, 0.05, r) : 1.0 - smoothstep(uTwig[sp].w * 1.6, uTwig[sp].w * 7.0, r);
  vTwigCol = uRoot > 0.5 ? vec3(0.78, 0.66, 0.48) : uTwig[sp].rgb;
  vHeatT = uMode < 1.5 ? clamp(a0.w / max(uClock, 1e-3), 0.0, 1.0) : uMode < 2.5 ? a3.w : clamp((C.y - uRange.x) / max(1e-3, uRange.y - uRange.x), 0.0, 1.0);
  vAO = uRoot > 0.5 ? 0.55 : (0.38 + 0.62 * a3.z) * (0.55 + 0.45 * smoothstep(0.0, 0.8, C.y));
  vSnowK = uRoot > 0.5 ? 0.0 : uSnow * smoothstep(0.2, 0.75, dirO.y);
  vTanW = -sin(ang) * nn + cos(ang) * bb;
  vBitW = tt;
#endif
`;
function branchMaterial(U, tex) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, envMapIntensity: 0.8 });
  const own = { uT0: { value: tex[0] }, uT1: { value: tex[1] }, uT2: { value: tex[2] }, uT3: { value: tex[3] }, uT4: { value: tex[4] }, uRoot: { value: 0 } };
  m.userData.own = own;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + NODE_GLSL +
        'varying vec2 vBarkUv; varying float vLayer, vTwig, vHeatT, vAO, vSnowK; varying vec3 vTwigCol, vTanV, vBitV;\nvec3 vTanW, vBitW;\n')
      .replace('#include <beginnormal_vertex>', BRANCH_BODY + '\n vTanV = normalize(normalMatrix * vTanW); vBitV = normalize(normalMatrix * vBitW);')
      .replace('#include <begin_vertex>', 'vec3 transformed = bPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL +
        'uniform highp sampler2DArray uBarkC, uBarkN; uniform float uRoot;\nvarying vec2 vBarkUv; varying float vLayer, vTwig, vHeatT, vAO, vSnowK; varying vec3 vTwigCol, vTanV, vBitV;\n')
      .replace('#include <map_fragment>', /* glsl */`
        vec3 barkC = texture(uBarkC, vec3(vBarkUv, vLayer)).rgb;
        if (uRoot > 0.5) barkC = mix(vec3(0.33, 0.24, 0.16), barkC, 0.35);
        float grain = 0.82 + 0.36 * barkC.g / max(0.05, dot(barkC, vec3(0.333)));
        vec3 nat = mix(barkC, vTwigCol * grain, vTwig);
        nat = mix(nat, vec3(0.86, 0.89, 0.93), vSnowK * 0.9);
        vec3 heat = heatOf(vHeatT);
        diffuseColor.rgb = uMode < 0.5 ? nat : heat * (0.75 + 0.25 * grain);`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        vec3 mapN = texture(uBarkN, vec3(vBarkUv, vLayer)).xyz * 2.0 - 1.0;
        mapN.xy *= (1.0 - vTwig) * (1.0 - vSnowK);
        normal = normalize(mat3(normalize(vTanV), normalize(vBitV), normal) * mapN);`)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= vAO; reflectedLight.indirectSpecular *= vAO;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += heat * uGlow * pow(vHeatT, 9.0) * 2.2;');
  };
  m.customProgramCacheKey = () => 'pg-branch';
  return m;
}
function branchDepth(U, own) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n#define DEPTH_PASS\n' + COMMON_GLSL + NODE_GLSL)
      .replace('#include <begin_vertex>', BRANCH_BODY + '\n vec3 transformed = bPos;');
  };
  m.customProgramCacheKey = () => 'pg-branch-depth';
  return m;
}

// --------------------------------------------------------- leaf material
const LEAF_BODY = /* glsl */`
  int j = int(aL0.x + 0.5);
  vec4 a0 = fT0(j), a3 = fT3(j), a4 = fT4(j);
  int sp = int(a4.x + 0.5);
  float code = aL1.w;
  float kind = mod(code, 4.0);
  int cell = int(floor(code / 4.0) + 0.5);
  vec4 rec = vec4(kind, aL0.y, aL0.z, aL1.z);
  vec4 st = leafState(uPheno[sp], uPheno2[sp].x, rec, a0.w, vec2(uPheno2[sp].z, uPheno2[sp].w), uClock);
  float g; vec4 N = nodeShown(j, uClock, g);
  bool hide = st.x <= 0.001 || (g < 1.0 && st.z < 0.0) || (N.w <= 0.0 && st.z < 0.0);
  vec4 qj = fT2(j);
  vec3 tt = qrot(qj, vec3(0.0, 1.0, 0.0)), nn = qrot(qj, vec3(1.0, 0.0, 0.0)), bb = qrot(qj, vec3(0.0, 0.0, 1.0));
  float lmode = uLeafA[sp].x, droop = uLeafA[sp].y, tiltK = uLeafA[sp].z;
  float ang = aL1.x, tilt = aL1.y * tiltK, rnd = aL1.z, size = aL0.w;
  vec3 side = cos(ang) * nn + sin(ang) * bb;
  vec3 dL;
  if (kind > 1.5) dL = side + vec3(0.0, 0.3, 0.0);
  else if (lmode > 1.5 && lmode < 2.5) {
    vec2 s2 = normalize(vec2(tt.z, -tt.x) + vec2(1e-5, 0.0));
    float sg = cos(ang) >= 0.0 ? 1.0 : -1.0;
    dL = vec3(sg * s2.x + 0.3 * tt.x, 0.12 + 0.3 * tt.y, sg * s2.y + 0.3 * tt.z);
  } else if (lmode > 0.5 && lmode < 1.5) dL = tt * 0.8 + side * 0.55 - vec3(0.0, droop * 0.4, 0.0);
  else {
    dL = normalize(mix(tt, side, tilt));
    dL.y -= droop * (0.4 + 0.6 * st.x) * (lmode > 2.5 ? 1.6 : 1.0);
  }
  dL = normalize(dL);
  vec3 wid = vec3(-dL.z, 0.0, dL.x);
  if (length(wid.xz) < 1e-3) wid = nn;
  wid = normalize(wid);
  vec3 nL = cross(wid, dL);
  if (nL.y < 0.0) { wid = -wid; nL = -nL; }
  vec3 O = N.xyz;
  if (kind > 0.5 && kind < 1.5) {
    vec3 f = normalize(side * 0.7 + tt * 0.3 + vec3(0.0, 0.55, 0.0));
    nL = f; wid = cross(vec3(0.0, 1.0, 0.0), f);
    wid = length(wid) > 0.5 ? normalize(wid) : vec3(1.0, 0.0, 0.0);
    dL = normalize(cross(f, wid));
    O += f * (0.012 + size * 0.35) - dL * size * 0.5;
  }
  // wind flutter: a quick turn of the blade round its own axis
  float fl = uWind * (0.25 + 0.3 * rnd) * sin(uTime * (3.5 + 3.0 * rnd) + rnd * 40.0 + O.x * 0.7);
  nL = normalize(nL + wid * fl * 0.6); wid = normalize(cross(dL, nL)); if (dot(cross(wid, dL), nL) < 0.0) wid = -wid;
  // falling, tumbling and lying on the ground
  float fall = st.z;
  if (fall >= 0.0) {
    float gy = groundY(O.x, O.z);
    float h = max(0.0, O.y - gy);
    float a2 = rnd * 40.0;
    float drift = h * (0.35 + 0.5 * rnd);
    vec2 wd = uWindDir;
    float gx = O.x + wd.x * drift + cos(a2) * 0.12 * h, gz = O.z + wd.y * drift + sin(a2) * 0.12 * h;
    float e = pow(fall, 1.15);
    float wob = (1.0 - fall) * min(1.0, h * 0.3) * 0.35;
    O = vec3(O.x + (gx - O.x) * e + sin(fall * 9.0 + rnd * 6.0) * wob, O.y + (gy + 0.006 + 0.01 * rnd - O.y) * e, O.z + (gz - O.z) * e + cos(fall * 7.0 + rnd * 5.0) * wob);
    float sg = smoothstep(0.82, 1.0, fall);
    float th = rnd * 43.7;
    vec3 gL = vec3(cos(th), 0.04, sin(th)), gW = vec3(-sin(th), 0.0, cos(th)), gN = vec3(0.0, 1.0, 0.0);
    vec3 ax = normalize(vec3(sin(rnd * 17.0), 0.6, cos(rnd * 23.0)));
    float aa = fall * (5.0 + 4.0 * rnd) * (1.0 - sg);
    float ca = cos(aa), sa = sin(aa);
    dL = dL * ca + cross(ax, dL) * sa + ax * dot(ax, dL) * (1.0 - ca);
    wid = wid * ca + cross(ax, wid) * sa + ax * dot(ax, wid) * (1.0 - ca);
    nL = nL * ca + cross(ax, nL) * sa + ax * dot(ax, nL) * (1.0 - ca);
    dL = normalize(mix(dL, gL, sg)); wid = normalize(mix(wid, gW, sg)); nL = normalize(mix(nL, gN, sg));
    if (fall >= 1.0) O.y = max(O.y, gy + 0.004);
  }
  vec4 cr = uCells[cell];
  float qa = (cr.z - cr.x) * ${ATLAS_SIZE[0].toFixed(1)} / ((cr.w - cr.y) * ${ATLAS_SIZE[1].toFixed(1)});
  float len = size * st.x * (fall >= 1.0 ? 0.75 + 0.25 * st.w : 1.0);
  float w = len * qa;
  float lx = position.x, ly = position.y;
  float fold = fall >= 1.0 ? 0.05 : (1.0 - st.x) * 1.1 + 0.12;
  float curl = fall >= 1.0 ? 0.02 : 0.1 + 0.1 * rnd;
  float az = abs(lx) * w * sin(fold) - curl * ly * ly * len;
  if (kind > 0.5 && kind < 1.5) az += lx * lx * w * 0.5 * (1.0 - st.x);
  vec3 lPos = O + dL * (ly * len) + wid * (lx * w * cos(fold)) + nL * az;
  if (hide || len < 1e-4) lPos = vec3(0.0, -50.0, 0.0);
  vec3 objectNormal = normalize(nL * cos(fold) - sign(lx) * wid * sin(fold) * 0.7 - dL * curl * ly * 0.8);
  vec2 lUv = vec2(mix(cr.x, cr.z, lx + 0.5), mix(cr.y, cr.w, ly));
#ifndef DEPTH_PASS
  vLeafUv = lUv;
  vInfo = vec4(st.y, fall >= 1.0 ? st.w : 1.0, kind, rnd);
  vSp = float(sp);
  vHeatT = uMode < 1.5 ? clamp(a0.w / max(uClock, 1e-3), 0.0, 1.0) : uMode < 2.5 ? a3.w : clamp((O.y - uRange.x) / max(1e-3, uRange.y - uRange.x), 0.0, 1.0);
  vAO = fall >= 0.0 ? 0.7 : 0.3 + 0.7 * a3.z;
  vTanW = wid; vBitW = dL;
#else
  vLeafUvD = lUv;
#endif
`;
function leafMaterial(U, tex, atlas) {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.62, metalness: 0, alphaTest: 0.02, envMapIntensity: 0.7 });
  m.alphaToCoverage = true;
  m.shadowSide = THREE.DoubleSide;
  const own = { uT0: { value: tex[0] }, uT1: { value: tex[1] }, uT2: { value: tex[2] }, uT3: { value: tex[3] }, uT4: { value: tex[4] }, uRoot: { value: 0 },
    uAtlasC: { value: atlas.c }, uAtlasA: { value: atlas.a }, uAtlasN: { value: atlas.n } };
  m.userData.own = own;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + NODE_GLSL +
        'attribute vec4 aL0; attribute vec4 aL1;\nvarying vec2 vLeafUv; varying vec4 vInfo; varying float vSp, vHeatT, vAO; varying vec3 vTanV, vBitV;\nvec3 vTanW, vBitW;\n')
      .replace('#include <beginnormal_vertex>', LEAF_BODY + '\n vTanV = normalize(normalMatrix * vTanW); vBitV = normalize(normalMatrix * vBitW);')
      .replace('#include <begin_vertex>', 'vec3 transformed = lPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL +
        'uniform sampler2D uAtlasC, uAtlasA, uAtlasN;\nvarying vec2 vLeafUv; varying vec4 vInfo; varying float vSp, vHeatT, vAO; varying vec3 vTanV, vBitV;\n')
      .replace('#include <map_fragment>', /* glsl */`
        float la = texture(uAtlasA, vLeafUv).r;
        vec2 tsz = vec2(textureSize(uAtlasA, 0));
        vec2 ddx = dFdx(vLeafUv * tsz), ddy = dFdy(vLeafUv * tsz);
        float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        la *= 1.0 + lod * 0.3;
        la = clamp((la - 0.5) / max(fwidth(la), 1e-4) + 0.5, 0.0, 1.0);
        if (la < 0.02) discard;
        int sp = int(vSp + 0.5);
        vec3 c = texture(uAtlasC, vLeafUv).rgb * uTint[sp].rgb;
        float lum = dot(c, vec3(0.3, 0.6, 0.1));
        float rnd = fract(vInfo.w * 7.31), kind = vInfo.z;   // the palette pick does not follow the fall time
        vec3 ac = rnd < 0.5 ? mix(uAut0[sp].rgb, uAut1[sp].rgb, rnd * 2.0) : mix(uAut1[sp].rgb, uAut2[sp].rgb, (rnd - 0.5) * 2.0);
        float isLeaf = (kind < 0.5 || kind > 1.5) ? 1.0 : 0.0;
        c = mix(c, ac * (0.6 + 3.2 * lum), vInfo.x * isLeaf);
        vec3 lit = uLitter[sp].rgb * (0.5 + 2.0 * lum);
        c = mix(mix(lit, c, isLeaf > 0.5 ? 0.0 : 0.6), c, clamp(vInfo.y, 0.0, 1.0));
        vec3 heat = heatOf(vHeatT);
        c = uMode < 0.5 ? c : heat * (0.7 + 1.3 * lum);
        diffuseColor = vec4(c, la);`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        vec3 mapN = texture(uAtlasN, vLeafUv).xyz * 2.0 - 1.0;
        mapN.xy *= 0.6;
        normal = normalize(mat3(normalize(vTanV) * faceDirection, normalize(vBitV), normal) * mapN);`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
        void RE_Direct_Leaf(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          float back = saturate(-dot(geometryNormal, directLight.direction));
          float through = pow(saturate(dot(-geometryViewDir, directLight.direction)), 4.0);
          reflectedLight.directDiffuse += directLight.color * material.diffuseColor * vec3(1.0, 1.08, 0.55) * back * (0.45 + 1.1 * through) * uTrans;
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Leaf`)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= vAO; reflectedLight.indirectSpecular *= vAO * vAO;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += heat * uGlow * pow(vHeatT, 9.0) * 2.0;')
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(outgoingLight, diffuseColor.a);');
  };
  m.customProgramCacheKey = () => 'pg-leaf';
  return m;
}
function leafDepth(U, own) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n#define DEPTH_PASS\n' + COMMON_GLSL + NODE_GLSL + 'attribute vec4 aL0; attribute vec4 aL1;\nvarying vec2 vLeafUvD;\n')
      .replace('#include <begin_vertex>', LEAF_BODY + '\n vec3 transformed = lPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uAtlasA;\nvarying vec2 vLeafUvD;\n')
      .replace('#include <alphatest_fragment>', 'if (texture(uAtlasA, vLeafUvD).r < 0.5) discard;');
  };
  m.customProgramCacheKey = () => 'pg-leaf-depth';
  return m;
}

// ----------------------------------------------------------------- sky
// A sky dome: a blue that deepens up, a warm glow round the sun, haze at
// the horizon, and soft clouds from a little fbm. The same mesh in its own
// scene gives the PMREM environment light.
function makeSky(sunDir) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 }, uWinter: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uTime, uWinter; varying vec3 vDir;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0), sd = max(dot(d, uSun), 0.0);
        vec3 zen = mix(vec3(0.16, 0.34, 0.72), vec3(0.32, 0.42, 0.6), uWinter);
        vec3 hor = mix(vec3(0.72, 0.8, 0.88), vec3(0.8, 0.82, 0.85), uWinter);
        vec3 c = mix(hor, zen, pow(h, 0.55));
        c += vec3(1.0, 0.78, 0.5) * pow(sd, 6.0) * 0.25 * (1.0 - h * 0.5);
        c += vec3(1.0, 0.9, 0.7) * pow(sd, 900.0) * 18.0;
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.004, 0.0);
          float cl = smoothstep(0.52, 0.85, fbm(uv)) * smoothstep(0.0, 0.25, d.y);
          vec3 cc = mix(vec3(0.92, 0.94, 0.97), vec3(1.0, 0.95, 0.85), pow(sd, 4.0));
          c = mix(c, cc * (0.85 + 0.15 * fbm(uv * 3.0)), cl * 0.8);
        } else c = mix(hor * 0.8, vec3(0.3, 0.32, 0.28), min(1.0, -d.y * 4.0));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), m);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

// -------------------------------------------------------------- ground
function makeGround(U, tex) {
  // a polar grid: fine near the plants, coarse at the horizon
  const rings = 90, segs = 160, pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const r = i === 0 ? 0 : 0.25 * Math.pow(i, 1.75);
    for (let k = 0; k <= segs; k++) { const a = k / segs * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let i = 0; i < rings; i++) for (let k = 0; k < segs; k++) {
    const a = i * (segs + 1) + k, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);   // front faces up
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((v, i) => i % 3 === 1 ? 1 : 0), 3));
  geo.setIndex(idx);
  const m = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, envMapIntensity: 0.6 });
  const own = { uGrassC: { value: tex.grassC }, uGrassN: { value: tex.grassN }, uMeadowC: { value: tex.meadowC }, uLitterC: { value: tex.litterC }, uLitterK: { value: 0 }, uPlants: { value: [] }, uNP: { value: 0 } };
  for (let k = 0; k < 12; k++) own.uPlants.value.push(new THREE.Vector4(0, 0, 0, 0));
  m.userData.own = own;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + 'varying vec3 vWp;')
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float gx = position.x, gz = position.z, e = 0.25;
        float hy = groundY(gx, gz);
        vec3 objectNormal = normalize(vec3(groundY(gx - e, gz) - groundY(gx + e, gz), 2.0 * e, groundY(gx, gz - e) - groundY(gx, gz + e)));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(gx, hy, gz); vWp = transformed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL +
        'uniform sampler2D uGrassC, uGrassN, uMeadowC, uLitterC; uniform float uLitterK, uNP; uniform vec4 uPlants[12]; varying vec3 vWp;\n' +
        'float gh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.7); }\nfloat gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }\n')
      .replace('#include <map_fragment>', /* glsl */`
        if (uCut > 0.0 && vWp.x > 0.0 && vWp.z > 0.0 && dot(vWp.xz, vWp.xz) < uCut * uCut) discard;
        vec2 guv = vWp.xz / 3.2;
        float mixK = smoothstep(0.35, 0.7, gn(vWp.xz * 0.11) * 0.7 + gn(vWp.xz * 0.37) * 0.3);
        vec3 gc = mix(texture(uGrassC, guv).rgb, texture(uMeadowC, guv * 0.83 + 0.37).rgb, mixK);
        // far off: the tile repeats less when it blends to its mean colour
        float far = smoothstep(25.0, 90.0, length(vWp.xz));
        gc = mix(gc, texture(uGrassC, vWp.xz / 41.0).rgb * 0.9 + vec3(0.0, 0.01, 0.0), far * 0.7);
        // litter under each crown, from autumn to spring
        float lk = 0.0;
        for (int k = 0; k < 12; k++) { if (float(k) >= uNP) break; vec4 pp = uPlants[k]; float d = length(vWp.xz - pp.xy); lk = max(lk, (1.0 - smoothstep(pp.z * 0.5, pp.z * 1.15, d)) * pp.w); }
        gc = mix(gc, texture(uLitterC, guv * 0.9).rgb, lk * uLitterK * (0.6 + 0.4 * gn(vWp.xz * 1.7)));
        // winter: snow, thinner near the trunks
        float sn = uSnow * (0.75 + 0.25 * gn(vWp.xz * 2.3)) * (1.0 - 0.6 * lk);
        gc = mix(gc, vec3(0.86, 0.89, 0.94), clamp(sn, 0.0, 1.0));
        diffuseColor.rgb = gc;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        vec3 gN = texture(uGrassN, vWp.xz / 3.2).xyz * 2.0 - 1.0;
        gN.xy *= 0.8 * (1.0 - uSnow * 0.8);
        vec3 tW = normalize(vec3(1.0, 0.0, 0.0)), bW = normalize(vec3(0.0, 0.0, -1.0));
        normal = normalize(mat3(normalize((viewMatrix * vec4(tW, 0.0)).xyz), normalize((viewMatrix * vec4(bW, 0.0)).xyz), normal) * gN);`);
  };
  m.customProgramCacheKey = () => 'pg-ground';
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}

// --------------------------------------------------------------- grass
// Instanced blades: each tuft is 3 curved, tapered blades. They sway with
// the wind, yellow in late summer, brown in winter and hide under snow.
function makeGrass(U, n, avoid) {
  const field = grassField({ n, radius: 24, seed: 11, avoid });
  const segs = 4, pos = [], idx = [];
  for (let b = 0; b < 3; b++) {
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) { const t = s / segs; pos.push(-1, t, b, 1, t, b); }
    for (let s = 0; s < segs; s++) { const a = base + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  geo.setIndex(idx);
  geo.setAttribute('aTuft', new THREE.InstancedBufferAttribute(field, 4));
  geo.instanceCount = field.length / 4;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + 'attribute vec4 aTuft; varying vec3 vGc; varying float vGt;')
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float rnd = fract(aTuft.w * 13.7 + position.z * 0.37);
        float a = (aTuft.w + position.z * 0.33) * 6.2831853 * 3.0;
        vec2 dir = vec2(cos(a), sin(a));
        vec2 side = vec2(-dir.y, dir.x);
        float t = position.y;
        float p = uClock - floor(uClock);
        float season = 0.55 + 0.45 * smoothstep(0.12, 0.4, p) - 0.25 * smoothstep(0.75, 1.0, p);
        float hgt = (0.2 + 0.28 * rnd) * aTuft.z * season * (1.0 - 0.85 * uSnow);
        float wbl = 0.012 * (1.0 - t * 0.85) * (0.7 + 0.6 * rnd);
        float lean = (0.25 + 0.35 * rnd) * t * t;
        vec2 wv = uWindDir * uWind * (0.35 + 0.25 * sin(uTime * 2.1 + aTuft.x * 0.6 + aTuft.y * 0.4)) * t * t;
        vec2 base = aTuft.xy + side * position.z * 0.025 + dir * 0.01 * position.z;
        float gy0 = groundY(base.x, base.y);
        vec3 bp = vec3(base.x + side.x * position.x * wbl + dir.x * lean * hgt + wv.x * hgt, gy0 + t * hgt * (1.0 - 0.3 * lean), base.y + side.y * position.x * wbl + dir.y * lean * hgt + wv.y * hgt);
        if (uCut > 0.0 && base.x > -0.05 && base.y > -0.05 && dot(base, base) < (uCut + 0.1) * (uCut + 0.1)) bp = vec3(0.0, -50.0, 0.0);
        vec3 objectNormal = normalize(vec3(dir.x * 0.4, 1.0, dir.y * 0.4));
        float autumn = smoothstep(0.6, 0.85, p) + 1.0 - smoothstep(0.05, 0.25, p);
        vec3 green = mix(vec3(0.05, 0.12, 0.02), vec3(0.2, 0.36, 0.06), t) * (0.8 + 0.4 * rnd);
        vec3 straw = mix(vec3(0.16, 0.13, 0.05), vec3(0.42, 0.36, 0.16), t);
        vGc = mix(green, straw, clamp(autumn * (0.5 + 0.5 * rnd), 0.0, 1.0));
        vGt = t;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = bp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGc; varying float vGt;')
      .replace('#include <map_fragment>', 'diffuseColor.rgb = vGc;')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= 0.45 + 0.55 * vGt;');
  };
  m.customProgramCacheKey = () => 'pg-grass';
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------ cut-away
// The soil block under the quarter x > 0, z > 0: two cut faces, the curved
// outer wall and the floor, with soil horizons drawn on a canvas.
function soilTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#2c2116'); gr.addColorStop(0.12, '#3a2b1c'); gr.addColorStop(0.45, '#5e4430'); gr.addColorStop(1, '#7c6146');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 2600; i++) { const y = r() * 512; g.fillStyle = `rgba(${20 + r() * 60},${15 + r() * 40},${10 + r() * 25},${0.2 + 0.4 * r()})`; g.beginPath(); g.arc(r() * 512, y, 0.5 + r() * 2.2, 0, 7); g.fill(); }
  for (let i = 0; i < 70; i++) { const y = 140 + r() * 370; g.fillStyle = `rgba(${150 + r() * 50},${130 + r() * 40},${100 + r() * 40},0.75)`; g.beginPath(); g.ellipse(r() * 512, y, 2 + r() * 7, 2 + r() * 5, r() * 3, 0, 7); g.fill(); }
  g.fillStyle = '#34501f'; g.fillRect(0, 0, 512, 6);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}
function makeCutaway() {
  const tex = soilTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  const group = new THREE.Group();
  function build(R, D) {
    while (group.children.length) { const c = group.children.pop(); c.geometry.dispose(); }
    const fA = new THREE.PlaneGeometry(R, D); fA.translate(R / 2, -D / 2, 0);
    const fB = new THREE.PlaneGeometry(R, D); fB.rotateY(-Math.PI / 2); fB.translate(0, -D / 2, R / 2);
    const wall = new THREE.CylinderGeometry(R, R, D, 24, 1, true, 0, Math.PI / 2); wall.translate(0, -D / 2, 0);
    const floor = new THREE.CircleGeometry(R, 24, 0, Math.PI / 2); floor.rotateX(-Math.PI / 2); floor.translate(0, -D, 0);
    for (const gm of [fA, fB, wall, floor]) { const m = new THREE.Mesh(gm, mat); m.receiveShadow = true; group.add(m); }
    tex.repeat.set(Math.max(1, R / 2), 1);
  }
  return { group, build };
}

// ------------------------------------------------------- texture loading
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + url)); im.src = url; });
}
// A 2D array texture: one layer per bark (BARKS order), square, size px.
// A layer that fails to load stays a flat mid brown.
async function loadArray(urls, size, srgb, flat) {
  const data = new Uint8Array(size * size * 4 * urls.length);
  for (let k = 0; k < data.length; k += 4) { data[k] = flat[0]; data[k + 1] = flat[1]; data[k + 2] = flat[2]; data[k + 3] = 255; }
  const tex = new THREE.DataArrayTexture(data, size, size, urls.length);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  await Promise.all(urls.map(async (u, k) => {
    try {
      const im = await loadImage(u);
      g.clearRect(0, 0, size, size); g.drawImage(im, 0, 0, size, size);
      data.set(g.getImageData(0, 0, size, size).data, k * size * size * 4);
      tex.needsUpdate = true;
    } catch (e) { /* keep the flat layer */ }
  }));
  return tex;
}
function loadTex(loader, url, srgb, repeat) {
  const t = loader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ===================================================================== api
// opts: canvas, coarse, onReady()
export function createRender(opts) {
  const { canvas, coarse } = opts;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { return null; }
  if (!renderer.capabilities.isWebGL2) return { renderer, failed: true };
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const fogCol = new THREE.Color(0.74, 0.8, 0.86);
  scene.fog = new THREE.FogExp2(fogCol, 0.0065);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.03, 2500);
  camera.position.set(1.2, 0.5, 1.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = true;
  controls.minDistance = 0.12; controls.maxDistance = 140; controls.maxPolarAngle = Math.PI * 0.53;
  controls.target.set(0, 0.1, 0);

  const lutTex = new THREE.DataTexture(lut('forest', 256), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  lutTex.colorSpace = THREE.SRGBColorSpace; lutTex.minFilter = lutTex.magFilter = THREE.LinearFilter; lutTex.needsUpdate = true;
  const U = makeUniforms(lutTex);

  // sun and sky
  const sunDir = new THREE.Vector3(0.5, 0.75, 0.42).normalize();
  const sky = makeSky(sunDir); scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.castShadow = true;
  const SM = coarse ? 2048 : 4096;
  sun.shadow.mapSize.set(SM, SM); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
  scene.add(sun); scene.add(sun.target);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene(); const sky2 = makeSky(sunDir); skyScene.add(sky2);
  let envRT = null, envKey = '';
  function updateEnv(winter) {
    const key = sunDir.toArray().map(v => v.toFixed(2)).join() + winter.toFixed(1);
    if (key === envKey) return;
    envKey = key;
    sky2.material.uniforms.uWinter.value = winter;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(skyScene, 0.02, 1, 1000);
    scene.environment = envRT.texture;
  }

  // until the arrays load, one-layer placeholders keep the shader valid
  const ph = (rgb, srgb) => { const t = new THREE.DataArrayTexture(new Uint8Array([...rgb, 255]), 1, 1, 1); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  U.uBarkC = { value: ph([90, 72, 56], true) }; U.uBarkN = { value: ph([128, 128, 255], false) };
  // textures
  const loader = new THREE.TextureLoader();
  const A = 'assets/';
  const atlas = {
    c: loadTex(loader, A + 'leaf-color.jpg', true), a: loadTex(loader, A + 'leaf-alpha.png', false), n: loadTex(loader, A + 'leaf-normal.jpg', false),
  };
  for (const k in atlas) { atlas[k].wrapS = atlas[k].wrapT = THREE.ClampToEdgeWrapping; atlas[k].anisotropy = 8; }
  const BS = coarse ? 512 : 1024;
  const ready = Promise.all([
    loadArray(BARKS.map(b => A + 'bark-' + b + '-color.jpg'), BS, true, [90, 72, 56]),
    loadArray(BARKS.map(b => A + 'bark-' + b + '-normal.jpg'), coarse ? 256 : 512, false, [128, 128, 255]),
  ]).then(([c, n]) => { U.uBarkC.value = c; U.uBarkN.value = n; if (opts.onReady) opts.onReady(); });
  const groundTex = {
    grassC: loadTex(loader, A + 'ground-grass-color.jpg', true, true), grassN: loadTex(loader, A + 'ground-grass-normal.jpg', false, true),
    meadowC: loadTex(loader, A + 'ground-meadow-color.jpg', true, true), litterC: loadTex(loader, A + 'ground-litter-color.jpg', true, true),
  };

  // ground, grass, cut-away
  const ground = makeGround(U, groundTex); scene.add(ground);
  let grass = null;
  function setGrass(avoid) {
    if (grass) { scene.remove(grass); grass.geometry.dispose(); }
    grass = makeGrass(U, coarse ? 22000 : 70000, avoid);
    scene.add(grass);
  }
  const cut = makeCutaway(); scene.add(cut.group); cut.group.visible = false;

  // the node structures: plant and roots
  function dataTex(rows) {
    const t = new THREE.DataTexture(new Float32Array(TEX_W * rows * 4), TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  const RADIAL = coarse ? 6 : 10;
  function ringGeometry(R) {
    const pos = [], idx = [];
    for (let ring = 0; ring < 2; ring++) for (let k = 0; k <= R; k++) pos.push(ring, k / R, 0);
    // counter-clockwise seen from outside, so the front faces point out
    for (let k = 0; k < R; k++) { const a = k, b = k + 1, c = R + 1 + k, d = R + 2 + k; idx.push(a, b, c, b, d, c); }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx); g.instanceCount = 0;
    return g;
  }
  const structs = [];
  function makeStruct(root) {
    const st = { rows: 1, tex: [0, 1, 2, 3, 4].map(() => dataTex(1)) };
    st.geo = ringGeometry(RADIAL);
    st.mat = branchMaterial(U, st.tex);
    st.mat.userData.own.uRoot.value = root ? 1 : 0;
    st.mesh = new THREE.Mesh(st.geo, st.mat);
    st.mesh.frustumCulled = false; st.mesh.castShadow = !root; st.mesh.receiveShadow = true;
    st.mesh.customDepthMaterial = branchDepth(U, st.mat.userData.own);
    scene.add(st.mesh);
    st.upload = (T, n) => {
      const rows = Math.max(1, Math.ceil(n / TEX_W));
      if (rows > st.rows) {
        const cap = Math.ceil(rows * 1.4);
        st.tex.forEach(t => t.dispose());
        st.tex = [0, 1, 2, 3, 4].map(() => dataTex(cap)); st.rows = cap;
        const o = st.mat.userData.own;
        o.uT0.value = st.tex[0]; o.uT1.value = st.tex[1]; o.uT2.value = st.tex[2]; o.uT3.value = st.tex[3]; o.uT4.value = st.tex[4];
        if (st.onTex) st.onTex();
      }
      for (let k = 0; k < 5; k++) { const d = st.tex[k].image.data; d.set(T[k].subarray(0, Math.min(T[k].length, d.length))); st.tex[k].needsUpdate = true; }
      st.geo.instanceCount = n;
    };
    structs.push(st);
    return st;
  }
  const plant = makeStruct(false);
  const roots = makeStruct(true);
  roots.mesh.visible = false;

  // leaves: the instance buffer is the pack leaf array (8 floats each)
  const leafQuad = new THREE.PlaneGeometry(1, 1, 2, coarse ? 2 : 3); leafQuad.translate(0, 0.5, 0);
  const leafGeo = new THREE.InstancedBufferGeometry();
  leafGeo.index = leafQuad.index;
  leafGeo.setAttribute('position', leafQuad.getAttribute('position'));
  leafGeo.setAttribute('normal', leafQuad.getAttribute('normal'));
  let leafCap = 0, leafBuf = null;
  function ensureLeaves(n) {
    if (n <= leafCap) return;
    leafCap = Math.ceil(n * 1.3);
    leafBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(leafCap * 8), 8, 1);
    leafBuf.setUsage(THREE.DynamicDrawUsage);
    leafGeo.setAttribute('aL0', new THREE.InterleavedBufferAttribute(leafBuf, 4, 0));
    leafGeo.setAttribute('aL1', new THREE.InterleavedBufferAttribute(leafBuf, 4, 4));
  }
  ensureLeaves(4096); leafGeo.instanceCount = 0;
  const leafMat = leafMaterial(U, plant.tex, atlas);
  const leaves = new THREE.Mesh(leafGeo, leafMat);
  leaves.frustumCulled = false; leaves.castShadow = true; leaves.receiveShadow = true;
  leaves.customDepthMaterial = leafDepth(U, leafMat.userData.own);
  scene.add(leaves);
  plant.onTex = () => { const o = leafMat.userData.own; for (let k = 0; k < 5; k++) o['uT' + k].value = plant.tex[k]; };

  // seeds: a small acorn-like seed on the ground until it germinates
  const seedGeo = new THREE.SphereGeometry(1, 12, 8); seedGeo.scale(0.009, 0.007, 0.007);
  const seedMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.55 });
  const seeds = new THREE.InstancedMesh(seedGeo, seedMat, 16); seeds.count = 0; seeds.castShadow = true; scene.add(seeds);
  let seedList = [];

  // ---------------------------------------------------------- state set
  let box = [-0.3, 0, -0.3, 0.3, 0.3, 0.3];
  function setPack(pk) {
    plant.upload(pk.T, pk.n);
    ensureLeaves(pk.leafN);
    leafBuf.array.set(pk.leaves.subarray(0, pk.leafN * 8));
    leafBuf.needsUpdate = true;
    leafGeo.instanceCount = pk.leafN;
    U.uYear.value = pk.year;
    box = pk.box;
  }
  function setRootPack(rp) { roots.upload(rp.T, rp.n); }
  function setPlants(list) {
    // list: [{ x, z, germ, r (crown radius), species }]
    seedList = list;
    const o = ground.material.userData.own;
    o.uNP.value = Math.min(12, list.length);
    list.slice(0, 12).forEach((p, k) => o.uPlants.value[k].set(p.x, p.z, Math.max(0.6, p.r), 1));
    setGrass(list.map(p => ({ x: p.x, z: p.z, r: p.form === 'tree' ? 0.45 : 0.25 })));
  }
  function setCrowns(list) {   // live crown radius for the litter
    const o = ground.material.userData.own;
    list.slice(0, 12).forEach((p, k) => o.uPlants.value[k].set(p.x, p.z, Math.max(0.4, p.r), p.w ?? 1));
  }
  function setMode(mode) {
    U.uMode.value = mode === 'natural' ? 0 : mode === 'age' ? 1 : mode === 'height' ? 3 : 2;
    U.uGlow.value = mode === 'age' ? 1 : 0;
  }
  function setGradient(id, rev) { lutTex.image.data.set(lut(id, 256, rev)); lutTex.needsUpdate = true; }
  function setRootsOn(on, R, D) {
    roots.mesh.visible = on; cut.group.visible = on;
    U.uCut.value = on ? R : 0;
    if (on) cut.build(R, D);
  }
  function setLeavesOn(on) { leaves.visible = on; }

  // the sun through the year: high in June, low in December
  function seasonSun(t) {
    const p = t - Math.floor(t);
    const el = (38 + 24 * Math.sin(2 * Math.PI * (p - 0.22))) * Math.PI / 180;
    const az = 0.9 + 0.25 * Math.sin(2 * Math.PI * p);
    sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    const warm = 1 - Math.min(1, el / 0.9);
    sun.color.setRGB(1, 0.93 - 0.12 * warm, 0.84 - 0.25 * warm);
    sun.intensity = 2.4 + 1.2 * Math.sin(el);
    return el;
  }
  function fitShadow() {
    const cx = (box[0] + box[3]) / 2, cz = (box[2] + box[5]) / 2;
    const R = Math.max(1.5, Math.hypot(box[3] - box[0], box[4], box[5] - box[2]) * 0.62 + 1.5);
    sun.target.position.set(cx, box[4] * 0.4, cz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, R * 3);
    const c = sun.shadow.camera;
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 0.1; c.far = R * 6;
    c.updateProjectionMatrix();
  }

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  // o: { clock (years), time (s), wind, snow, range: [y0, y1], litter }
  function frame(o) {
    U.uClock.value = o.clock; U.uTime.value = o.time; U.uWind.value = o.wind;
    U.uSnow.value = o.snow; U.uRange.value.set(o.range[0], o.range[1]);
    ground.material.userData.own.uLitterK.value = o.litter;
    seasonSun(o.clock);
    const winter = o.snow;
    sky.material.uniforms.uTime.value = o.time; sky.material.uniforms.uWinter.value = winter;
    updateEnv(Math.round(winter * 4) / 4);
    fitShadow();
    // fog follows the sky at the horizon
    fogCol.setRGB(0.74 + 0.06 * winter, 0.8 + 0.02 * winter, 0.86);
    // seeds before germination
    let n = 0;
    const M = new THREE.Matrix4();
    for (const s of seedList) {
      if (n >= 16 || o.clock > s.germ + 0.06) continue;
      const k = 1 - Math.max(0, Math.min(1, (o.clock - s.germ) / 0.06));
      M.makeScale(k, k, k).setPosition(s.x, 0.006 * k, s.z);
      seeds.setMatrixAt(n++, M);
    }
    seeds.count = n; seeds.instanceMatrix.needsUpdate = true;
  }

  const api = {
    renderer, scene, camera, controls, uniforms: U, ready,
    setPack, setRootPack, setPlants, setCrowns, setMode, setGradient, setRootsOn, setLeavesOn, resize, frame,
    get box() { return box; },
    render() { renderer.render(scene, camera); },
    stats() { return { nodes: plant.geo.instanceCount, leaves: leafGeo.instanceCount, roots: roots.geo.instanceCount }; },
  };
  return api;
}

// The materials and GLSL, for a shader check in node (no GPU).
export { branchMaterial, leafMaterial, branchDepth, leafDepth, makeSky, COMMON_GLSL, NODE_GLSL, BRANCH_BODY, LEAF_BODY };
