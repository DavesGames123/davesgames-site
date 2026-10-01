// ============================================================================
//  HUMAN SKULL  ·  skull.js — load data/skull.*, build the parts, bone shader
// ────────────────────────────────────────────────────────────────────────────
//  loadSkull() fetches the manifest and the one binary, decodes each part
//  (Uint16 position in the part box, Int16 oct normal, Uint8 AO pair,
//  Uint16 index) and returns one Mesh per part, placed at its home centre.
//
//  THE BONE MATERIAL  (MeshStandardMaterial + onBeforeCompile, one program)
//    colour    ivory with a slow mottle (fbm on the object-space position in
//              mm, so the pattern sticks to the bone as it moves), a small
//              tint change per part, and a warm brown in the cavities
//    AO        two baked channels: aoPair.x the part alone, .y the whole
//              skull. uAsm (1 at home, 0 far out) mixes them per part.
//    surface   a micro relief (grain and pores) as a screen-space bump; it
//              fades out where a pore is smaller than a pixel. The same
//              noise moves the roughness.
//    warmth    a wrap-light band at the terminator of the key light, warm
//              red-orange: a cheap stand-in for light that scatters under
//              the surface of real bone
//    teeth     uEnamel = 1: glossy pale enamel on the crown, a translucent
//              edge at the tip, yellow dentin on the root (uCrown gives the
//              crown end along y)
//    state     uHL (hover / pick glow with a rim), uGhost (fade and grey for
//              the parts that are not isolated)
//
//  GREP MAP
//    export async function loadSkull ... fetch, decode, meshes
//    function decodePart .............. the binary layout of one part
//    const BONE_GLSL .................. noise and helpers for the shader
//    function boneMaterial ............ the shader injection
// ============================================================================
import * as THREE from 'three';

const BONE_GLSL = /* glsl */`
uniform float uAsm, uHL, uGhost, uEnamel, uCrown, uHalfY, uSeed, uBump, uSSSk;
uniform vec3 uTint, uCav, uSSS, uHLc, uKey, uEnamelC, uRootC;
varying vec2 vAO;
varying vec3 vObj;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// one shared program; each material carries its own uniforms
function boneMaterial(part) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
  const tooth = part.group === 'dentition';
  // a small, steady tint change per part, like the stain on a real specimen
  const rnd = k => { const x = Math.sin((part.i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const tint = new THREE.Color(0xe6d6b8).multiplyScalar(0.97 + rnd(1) * 0.05);
  tint.offsetHSL((rnd(2) - 0.5) * 0.012, (rnd(3) - 0.5) * 0.06, 0);
  const U = {
    uAsm: { value: 1 }, uHL: { value: 0 }, uGhost: { value: 0 },
    uEnamel: { value: tooth ? 1 : 0 }, uCrown: { value: part.crown || 1 }, uHalfY: { value: part.ext[1] / 2 },
    uSeed: { value: rnd(4) * 40 }, uBump: { value: 1 }, uSSSk: { value: 1 },
    uTint: { value: tint }, uCav: { value: new THREE.Color(0x553520) }, uSSS: { value: new THREE.Color(0xff7448) },
    uHLc: { value: new THREE.Color(0xffc777) }, uKey: { value: new THREE.Vector3(0, 0, 1) },
    uEnamelC: { value: new THREE.Color(0xeee7d6) }, uRootC: { value: new THREE.Color(0xdcc195) },
  };
  mat.userData.U = U;
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aoPair;\nvarying vec2 vAO;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;\nvAO = aoPair;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + BONE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
float aoS = mix(vAO.x, vAO.y, uAsm);
float ao = pow(aoS, 1.6);
vec3 P = vObj + uSeed;
float mott = fbm(P * 0.055);
float grain = vn(P * 0.42);
float pores = vn(P * 1.35);
vec3 base = uTint * (0.9 + 0.17 * mott) * (0.97 + 0.05 * grain);
base = mix(base, base * vec3(1.0, 0.94, 0.84), smoothstep(0.45, 0.8, mott) * 0.5);
float yy = vObj.y * uCrown / max(uHalfY, 1.0);
float crown = uEnamel * smoothstep(0.02, 0.22, yy);
float tip = uEnamel * smoothstep(0.78, 1.0, yy);
base = mix(base, uRootC * (0.95 + 0.08 * mott), uEnamel * (1.0 - crown));
base = mix(base, uEnamelC * (0.97 + 0.04 * grain), crown);
base = mix(base, vec3(0.78, 0.8, 0.8), tip * 0.3);
base = mix(base, uCav, (1.0 - ao) * mix(0.7, 0.4, uEnamel));
diffuseColor.rgb = base;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor * (0.84 + 0.3 * grain) + (1.0 - ao) * 0.18, 0.18, 1.0);
roughnessFactor = mix(roughnessFactor, 0.26 + 0.08 * grain, crown);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float fw = length(fwidth(vObj));
  float k = uBump * (1.0 - smoothstep(0.25, 0.9, fw)) * (1.0 - crown * 0.8);
  if (k > 0.001) {
    float hgt = (grain * 0.10 - pores * 0.07 * (1.0 - smoothstep(0.12, 0.35, fw))) * k;
    vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 g = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
    normal = normalize(abs(det) * normal - g);
  }
}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= ao;
reflectedLight.indirectSpecular *= mix(1.0, ao, 0.85);
reflectedLight.directDiffuse *= mix(1.0, ao, 0.8);
reflectedLight.directSpecular *= mix(1.0, ao, 0.9);`)
      .replace('#include <opaque_fragment>', `{
  float ndl = dot(normal, uKey);
  float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0) - clamp(ndl, 0.0, 1.0);
  outgoingLight += uSSS * diffuseColor.rgb * wrap * 0.22 * uSSSk * mix(0.4, 1.0, ao);
  vec3 V = normalize(vViewPosition);
  float fr = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 2.5);
  outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.1, 1.05, 0.96), uHL);
  outgoingLight += uHLc * (fr * 0.55 + 0.05) * uHL;
  float lum = dot(outgoingLight, vec3(0.3, 0.55, 0.15));
  outgoingLight = mix(outgoingLight, vec3(lum) * vec3(0.92, 0.96, 1.02), uGhost * 0.75);
  diffuseColor.a = 1.0 - uGhost * 0.88;
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'skull-bone-v1';
  return mat;
}

function decodePart(buf, p) {
  const V = p.v;
  const qp = new Uint16Array(buf, p.off.pos, V * 3), qn = new Int16Array(buf, p.off.nrm, V * 2);
  const qa = new Uint8Array(buf, p.off.ao, V * 2), qi = new Uint16Array(buf, p.off.idx, p.t * 3);
  const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3);
  for (let i = 0; i < V; i++) {
    for (let k = 0; k < 3; k++) pos[3 * i + k] = p.min[k] + qp[3 * i + k] / 65535 * p.ext[k];
    let x = qn[2 * i] / 32767, y = qn[2 * i + 1] / 32767, z = 1 - Math.abs(x) - Math.abs(y);
    if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
    const l = Math.hypot(x, y, z) || 1;
    nrm[3 * i] = x / l; nrm[3 * i + 1] = y / l; nrm[3 * i + 2] = z / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aoPair', new THREE.BufferAttribute(new Uint8Array(qa), 2, true));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(qi), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// fetch with progress; onProgress(0..1)
async function fetchBuf(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader(), out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got); got += value.length;
    onProgress(got / total);
  }
  return out.buffer;
}

export async function loadSkull(base, onProgress = () => {}) {
  const man = await (await fetch(base + 'skull.json')).json();
  const buf = await fetchBuf(base + 'skull.bin', onProgress);
  const parts = man.parts.map((m, i) => {
    m.i = i;
    const geo = decodePart(buf, m), mat = boneMaterial(m);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.part = i;
    mesh.position.fromArray(m.center);
    return { i, m, mesh, mat, U: mat.userData.U, home: new THREE.Vector3().fromArray(m.center), size: Math.hypot(...m.ext) };
  });
  return { man, parts };
}

export function disposeSkull(parts) {
  for (const p of parts) { p.mesh.geometry.dispose(); p.mat.dispose(); }
}
