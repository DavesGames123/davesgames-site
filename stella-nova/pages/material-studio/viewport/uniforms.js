// ============================================================================
//  MATERIAL STUDIO  ·  viewport/uniforms.js — the frame and material uniform buffers
// ────────────────────────────────────────────────────────────────────────────
//  Writes the two uniform buffers of a frame. writeFrame() fills struct Frame
//  (camera, shadow matrix, environment, background, debug view, lights, SH)
//  into R.frameBuf. writeMaterial() fills struct Material of one material set
//  from its scalars and the view settings. The float offsets here must agree
//  with viewport-common.wgsl.
//
//  GREP TARGETS
//      RAW_VIEWS / DATA_VIEWS . debug views with no lighting / no sRGB encode
//      writeFrame ............. struct Frame, 144 floats
//      activeScalars .......... scalars of the current set, else state.scalars
//      writeMaterial .......... struct Material, 20 floats
// ============================================================================
import * as C from '../contract.js';
import { VIEWPORT_DEBUG_VIEWS, MAT_FLOATS, device, state, cam, R, clamp, hexToLinear } from './state.js';
import { shadowMatrix } from './lights.js';

const RAW_VIEWS = new Set(VIEWPORT_DEBUG_VIEWS.filter(v => !['lit', 'diffuseOnly', 'specularOnly'].includes(v)));
// Raw views that show map data, not a color: the post pass writes them with
// no sRGB encode and no dither, so roughness 0.5 shows as 128, as in the PNG.
const DATA_VIEWS = new Set(['opacity', 'normal', 'worldNormal', 'ao', 'roughness', 'metallic', 'height', 'clearcoat', 'anisotropy', 'ndotl']);

export function writeFrame(T, e, L, mesh, o) {
  const f = R.frameData; f.fill(0);
  const v = state.view, env = state.env;
  f.set(cam.viewProj, 0); f.set(cam.invViewProj, 16);
  const groundY = mesh.minY - 0.002 - (v.displacement ? (activeScalars().displacementScale || 0) : 0);
  const shadowM = shadowMatrix(L.key, mesh.radius, groundY);
  f.set(shadowM, 32);
  f.set([cam.eye[0], cam.eye[1], cam.eye[2], performance.now() / 1000], 48);
  const mips = e.kind === 'proc' ? 8 : e.mips;
  const inten = e.kind === 'lib' ? (+e.b.intensity || 0) : (Number.isFinite(+env.intensity) ? +env.intensity : 1);
  f.set([((Number(env.rotation) || 0) * Math.PI) / 180, inten, e.kind === 'proc' ? 8 : mips, e.kind === 'proc' ? 0 : 1], 52);
  const debug = o.debug || v.debug;
  const raw = RAW_VIEWS.has(debug);
  let mode = 0, lod = 0;
  const bgc = hexToLinear(env.bgColor || '#1a1f2a');
  if (raw) mode = 3;
  else if (v.background === 'solid') mode = 1;
  else if (v.background === 'checker') mode = 2;
  else if (v.background === 'gradient') mode = 3;
  else if (env.background === 'color' && e.kind !== 'lib') mode = 1;
  else if (env.background === 'hdri') lod = 0;
  else lod = clamp(Number(env.blur ?? 0.35), 0, 1) * (mips - 1);
  f.set([bgc[0], bgc[1], bgc[2], mode], 56);
  const groundOn = v.ground !== false && mesh.name !== 'plane';
  f.set([lod, groundY, groundOn ? 1 : 0, v.grid ? 1 : 0], 60);
  const shadowsOn = v.shadows !== false;
  f.set([VIEWPORT_DEBUG_VIEWS.indexOf(debug), L.lights.length, shadowsOn ? clamp(+v.shadowStrength || 0, 0, 1) : 0, clamp(+v.specOcclusion, 0, 1)], 64);
  f.set([T.w, T.h, 1 / T.w, 1 / T.h], 68);
  f.set([L.key[0], L.key[1], L.key[2], shadowsOn ? 1 : 0], 72);
  for (let i = 0; i < L.lights.length; i++) {
    const l = L.lights[i], b = 76 + i * 8;
    f.set([l.v[0], l.v[1], l.v[2], l.type], b);
    f.set([l.color[0], l.color[1], l.color[2], i === L.keyIdx && shadowsOn ? 1 : 0], b + 4);
  }
  if (e.sh) {
    const s = e.sh, stride = s.length >= 36 ? 4 : 3;
    for (let i = 0; i < 9; i++) f.set([s[i * stride], s[i * stride + 1], s[i * stride + 2], 0], 108 + i * 4);
  }
  device.queue.writeBuffer(R.frameBuf, 0, f);
  return { groundOn, shadowM, raw, data: DATA_VIEWS.has(debug) };
}

function activeScalars() { return (R.cur && R.cur.scalars) || state.scalars || C.DEFAULT_SCALARS; }

export function writeMaterial(set) {
  const v = state.view, s = set.scalars;
  const uvs = +v.uvScale || 1, off = Array.isArray(v.uvOffset) ? v.uvOffset : [0, 0];
  const alpha = s.alphaMode === 'blend' ? 2 : s.alphaMode === 'mask' ? 1 : 0;
  const disp = v.displacement ? 1 : 0;
  const pom = v.parallax && !disp ? (s.displacementScale || 0) * (+v.parallaxScale || 0) : 0;
  const m = new Float32Array(MAT_FLOATS);
  m.set([uvs, uvs, +off[0] || 0, +off[1] || 0], 0);
  m.set([s.ior ?? 1.5, s.transmission ?? 0, s.displacementScale ?? 0.05, s.emissiveStrength ?? 1], 4);
  m.set([alpha, s.alphaCutoff ?? 0.5, pom, disp], 8);
  m.set([+v.normalStrength || 0, v.flipGreen ? -1 : 1, ((+v.anisoRotation || 0) * Math.PI) / 180, clamp(+v.sheenRoughness || 0.5, 0.07, 1)], 12);
  m.set([clamp(+v.pomSteps || 32, 4, 64), s.doubleSided ? 1 : 0, 0, 0], 16);
  device.queue.writeBuffer(set.ubuf, 0, m);
}
