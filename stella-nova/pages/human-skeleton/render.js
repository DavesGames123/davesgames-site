// ============================================================================
//  HUMAN SKELETON  ·  render.js — bone materials, state texture, studio
// ────────────────────────────────────────────────────────────────────────────
//  All bones of one body group are one mesh (one draw call). Each vertex
//  carries aBone, the row of its bone in a small float texture; the vertex
//  shader reads the bone's move, turn and flags from that texture:
//
//    texel (i, 0)  off.xyz, appear 0..1      (appear < 1 dissolves in)
//    texel (i, 1)  rotation quaternion xyzw  (about the bone centre)
//    texel (i, 2)  centre.xyz, flag          (0 shown, 1 hidden, 2 ghost)
//    texel (i, 3)  picked, hovered, region glow, -
//
//  Passes that share the texture:
//    bone material   MeshPhysical (MeshStandard on touch) plus cavity
//                    tint, roughness noise, picked-bone glow
//    depth material  the shadow map sees the same moves
//    ghost material  isolate mode: the other bones as faint glass
//    pick material   the bone row as a colour, read back round a tap
//  A hidden bone (or a ghost in the opaque pass) folds all its vertices
//  to one point, so the GPU draws no triangle for it.
//
//  GREP MAP
//    class BoneState          the texture and its CPU arrays
//    function boneMaterial    onBeforeCompile for the physical material
//    function depthMaterial   for the shadow pass
//    function ghostMaterial   fresnel glass for isolate mode
//    function pickMaterial    id colour for GPU picking
//    function groupMesh       decoded arrays to a BufferGeometry + meshes
//    function studioEnvironment  procedural PMREM: softboxes in a dome
// ============================================================================
import * as THREE from 'three';

export class BoneState {
  constructor(n) {
    this.n = n;
    this.w = 256;
    this.rows = Math.ceil(n / 256);
    // 4 rows of texels per band of 256 bones
    this.data = new Float32Array(this.w * 4 * this.rows * 4);
    this.tex = new THREE.DataTexture(this.data, this.w, 4 * this.rows, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    for (let i = 0; i < n; i++) this.set(1, i, 0, 0, 0, 1);
    this.tex.needsUpdate = true;
  }
  at(row, i) { const band = (i / 256) | 0, x = i % 256; return ((band * 4 + row) * this.w + x) * 4; }
  set(row, i, a, b, c, d) { const k = this.at(row, i); this.data[k] = a; this.data[k + 1] = b; this.data[k + 2] = c; this.data[k + 3] = d; }
  get(row, i, k) { return this.data[this.at(row, i) + k]; }
  setK(row, i, k, v) { this.data[this.at(row, i) + k] = v; }
  dirty() { this.tex.needsUpdate = true; }
  dispose() { this.tex.dispose(); }
}

// shared GLSL: fetch the bone and move a point
const GLSL_COMMON = /* glsl */`
uniform sampler2D uBones;
uniform float uPass;
attribute float aBone;
ivec2 boneTexel(float id, int row) { int i = int(id + 0.5); return ivec2(i - (i / 256) * 256, (i / 256) * 4 + row); }
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
// pass 0: opaque (hide hidden + ghost), 1: ghost (only ghosts), 2: pick
float boneHidden(float flag) {
  if (uPass > 0.5 && uPass < 1.5) return abs(flag - 2.0) < 0.5 ? 0.0 : 1.0;
  return flag > 0.5 ? 1.0 : 0.0;
}
vec3 boneMove(vec3 p, out float hide, out float appear) {
  vec4 b0 = texelFetch(uBones, boneTexel(aBone, 0), 0);
  vec4 b1 = texelFetch(uBones, boneTexel(aBone, 1), 0);
  vec4 b2 = texelFetch(uBones, boneTexel(aBone, 2), 0);
  hide = boneHidden(b2.w);
  appear = b0.w;
  vec3 q = qrot(b1, p - b2.xyz) + b2.xyz + b0.xyz;
  q.y += (1.0 - appear) * (1.0 - appear) * 0.06;
  return hide > 0.5 ? vec3(0.0, -50.0, 0.0) : q;
}
`;

const GLSL_NOISE = /* glsl */`
float hs_hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hs_noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hs_hash(i), hs_hash(i + vec3(1, 0, 0)), f.x), mix(hs_hash(i + vec3(0, 1, 0)), hs_hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hs_hash(i + vec3(0, 0, 1)), hs_hash(i + vec3(1, 0, 1)), f.x), mix(hs_hash(i + vec3(0, 1, 1)), hs_hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float hs_fbm(vec3 p) { return 0.55 * hs_noise(p) + 0.28 * hs_noise(p * 2.13) + 0.17 * hs_noise(p * 4.71); }
`;

export function boneMaterial(state, U, { physical = true } = {}) {
  const Mat = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const opts = { color: 0xffffff, roughness: 0.62, metalness: 0.0, envMapIntensity: 1.0 };
  if (physical) Object.assign(opts, { sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff1d6), specularIntensity: 0.55 });
  const m = new Mat(opts);
  m.onBeforeCompile = sh => {
    sh.uniforms.uBones = { value: state.tex };
    sh.uniforms.uPass = { value: 0 };
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\nattribute float aCav;\nflat varying float vBone;\nvarying float vCav;\nvarying vec3 vRest;\nvarying float vAppear;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n  objectNormal = qrot(texelFetch(uBones, boneTexel(aBone, 1), 0), objectNormal);`)
      .replace('#include <begin_vertex>', `float hsHide, hsAppear;\n  vec3 transformed = boneMove(position, hsHide, hsAppear);\n  vBone = aBone; vCav = aCav; vRest = position; vAppear = hsAppear;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uBones;\nuniform vec3 uBone;\nuniform vec3 uCav;\nuniform vec3 uSel;\nuniform vec3 uHov;\nflat varying float vBone;\nvarying float vCav;\nvarying vec3 vRest;\nvarying float vAppear;\n${GLSL_NOISE}\nivec2 boneTexel(float id, int row) { int i = int(id + 0.5); return ivec2(i - (i / 256) * 256, (i / 256) * 4 + row); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vAppear < 0.999) { float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453); if (h > vAppear) discard; }
  vec4 hsSel = texelFetch(uBones, boneTexel(vBone, 3), 0);
  float hsN = hs_fbm(vRest * 140.0);
  float hsBig = hs_noise(vRest * 18.0 + vBone * 3.1);
  vec3 hsCol = uBone * (0.93 + 0.12 * hsN) * mix(vec3(1.0), vec3(1.04, 0.99, 0.92), hsBig);
  float hsCav = smoothstep(0.02, 0.9, vCav);
  hsCol = mix(hsCol, hsCol * uCav, hsCav);
  hsCol = mix(hsCol, uSel, hsSel.x * 0.3);
  diffuseColor.rgb = hsCol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + (hsN - 0.5) * 0.28 + hsCav * 0.18, 0.28, 0.95);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float hsFr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
  totalEmissiveRadiance += uSel * hsSel.x * (0.1 + 0.8 * hsFr) + uHov * hsSel.y * (0.03 + 0.45 * hsFr) + uSel * hsSel.z * 0.05;`);
  };
  m.customProgramCacheKey = () => 'hs-bone-' + (physical ? 'p' : 's');
  return m;
}

export function depthMaterial(state) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => {
    sh.uniforms.uBones = { value: state.tex };
    sh.uniforms.uPass = { value: 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
      .replace('#include <begin_vertex>', `float hsHide, hsAppear;\n  vec3 transformed = boneMove(position, hsHide, hsAppear);`);
  };
  m.customProgramCacheKey = () => 'hs-depth';
  return m;
}

export function ghostMaterial(state, U) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uBones: { value: state.tex }, uPass: { value: 1 } }, U),
    vertexShader: /* glsl */`${GLSL_COMMON}
      varying vec3 vN; varying vec3 vV;
      void main() {
        float hide, appear;
        vec3 p = boneMove(position, hide, appear);
        vec3 n = qrot(texelFetch(uBones, boneTexel(aBone, 1), 0), normal);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * n); vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uGhost; uniform float uGhostA;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        // edges only, and nothing right in front of the lens
        float near = smoothstep(0.04, 0.35, length(vV));
        float a = uGhostA * pow(f, 3.0) * near;
        gl_FragColor = vec4(uGhost, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
}

export function pickMaterial(state) {
  return new THREE.ShaderMaterial({
    uniforms: { uBones: { value: state.tex }, uPass: { value: 2 } },
    vertexShader: /* glsl */`${GLSL_COMMON}
      flat varying float vId;
      void main() {
        float hide, appear;
        vec3 p = boneMove(position, hide, appear);
        vId = aBone + 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      flat varying float vId;
      void main() {
        float id = floor(vId + 0.5);
        gl_FragColor = vec4(mod(id, 256.0) / 255.0, floor(id / 256.0) / 255.0, 0.0, 1.0);
      }`,
  });
}

// decoded group (decode.js) to geometry; the same geometry feeds the bone,
// ghost and pick passes. Bounds move with the bones, so no frustum culling.
export function groupMesh(g, mats) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.nrm, 3, true));
  geo.setAttribute('aCav', new THREE.BufferAttribute(g.cav, 1, true));
  geo.setAttribute('aBone', new THREE.BufferAttribute(g.bone, 1));
  geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
  const mesh = new THREE.Mesh(geo, mats.bone);
  mesh.customDepthMaterial = mats.depth;
  mesh.castShadow = true;
  mesh.receiveShadow = mats.receive;
  mesh.frustumCulled = false;
  mesh.layers.enable(1);
  const ghost = new THREE.Mesh(geo, mats.ghost);
  ghost.frustumCulled = false;
  ghost.renderOrder = 5;
  ghost.visible = false;
  return { geo, mesh, ghost };
}

// A dome with a warm key softbox, a cool rim strip and a low fill: the
// image-based light for the bone material.
export function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD; void main(){
      float y = vD.y;
      vec3 top = vec3(0.42, 0.40, 0.38), hor = vec3(0.20, 0.18, 0.165), floorC = vec3(0.055, 0.05, 0.045);
      vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.7)) : mix(hor, floorC, pow(-y, 0.5));
      gl_FragColor = vec4(c, 1.0); }`,
  }));
  env.add(dome);
  const box = (w, h, color, k, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  box(5, 3.2, 0xffe6c4, 7.0, [-4.5, 6, 5]);     // key, warm, high front left
  box(1.2, 7, 0xcfe0ff, 4.0, [6.5, 2.5, -4]);   // rim, cool, back right
  box(7, 1.4, 0xfff4e6, 1.5, [2, -1.0, 7]);     // low fill from the front
  box(3, 3, 0xffffff, 2.2, [0, 9.5, 0]);        // top
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.035);
  pm.dispose();
  env.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt;
}
