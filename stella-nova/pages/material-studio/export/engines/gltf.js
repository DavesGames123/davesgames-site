// ============================================================================
//  MATERIAL STUDIO  ·  export/engines/gltf.js — the glTF 2.0 .glb package
// ────────────────────────────────────────────────────────────────────────────
//  gltfPackage encodes the plan images as PNG and builds the glTF material
//  with the KHR extensions that the maps need. A folded map becomes a
//  factor (the mean). previewMesh takes the viewport mesh (or mesh.js, or a
//  UV sphere) and can move the vertices by the height map, as pbr.wgsl does.
//
//  GREP TARGETS
//      previewMesh  gltfPackage  KHR_  displaceMesh
// ============================================================================
import { buildGLB, uvSphere } from '../../glb.js';
import { S } from '../ctx.js';
import { H2F, luts } from '../half.js';
import { packImage } from '../pack.js';

async function previewMesh(o, src, sc) {
  let mesh = null;
  try {
    const vp = window.__studio?.viewport;
    if (vp && typeof vp.meshData === 'function') mesh = await vp.meshData();
    if (!mesh) {
      const M = await import('../../mesh.js');
      mesh = M.buildMesh(o.mesh || S.view.mesh || 'sphere', { subdiv: Math.min(S.view.subdiv || 96, 128) });
    }
  } catch (e) { mesh = null; }
  if (!mesh || !mesh.positions || !mesh.positions.length) mesh = uvSphere(96);
  // tangents are rebuilt by glb.js with the glTF handedness rule, so the
  // viewport tangent convention does not leak into the file
  mesh = { positions: Float32Array.from(mesh.positions), normals: mesh.normals && Float32Array.from(mesh.normals), uvs: mesh.uvs, indices: mesh.indices };
  if (o.displaceMesh && mesh.normals && mesh.uvs) {
    luts();
    const h = await src.get('height'), r = src.res, P = mesh.positions, N = mesh.normals, U = mesh.uvs;
    for (let i = 0; i < P.length / 3; i++) {
      let x = (((U[i * 2] * o.uvScale) % 1) + 1) % 1, y = (((U[(i * 2) + 1] * o.uvScale) % 1) + 1) % 1;
      x = (x * r) - 0.5; y = (y * r) - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const t = (xx, yy) => H2F[h[((((yy % r) + r) % r) * r * 4) + ((((xx % r) + r) % r) * 4)]];
      const v = ((t(x0, y0) * (1 - fx)) + (t(x0 + 1, y0) * fx)) * (1 - fy) + ((t(x0, y0 + 1) * (1 - fx)) + (t(x0 + 1, y0 + 1) * fx)) * fy;
      const d = (v - 0.5) * 2 * sc.displacementScale;   // as pbr.wgsl displace
      P[i * 3] += N[i * 3] * d; P[(i * 3) + 1] += N[(i * 3) + 1] * d; P[(i * 3) + 2] += N[(i * 3) + 2] * d;
    }
  }
  return mesh;
}

export async function gltfPackage(o, src, sc, u, st, plan, progress) {
  const images = [], index = {};
  for (let i = 0; i < plan.length; i++) {
    const img = plan[i];
    progress?.(`encoding ${img.file}`, 0.35 + (0.5 * (i / plan.length)));
    const data = await packImage({ ...img, fmt: 'png' }, src);
    index[img.key] = images.length;
    images.push({ name: img.file, mime: 'image/png', data });
  }
  const tt = o.uvScale !== 1 ? { extensions: { KHR_texture_transform: { scale: [o.uvScale, o.uvScale] } } } : {};
  const T = (key, extra = {}) => ({ index: index[key], ...extra, ...JSON.parse(JSON.stringify(tt)) });
  const mean = (s, c) => (st[s] ? st[s].mean[c] : 0);
  const mat = { name: o.name, pbrMetallicRoughness: {} };
  const pbr = mat.pbrMetallicRoughness;
  const lin = c => c; // factors are linear in glTF
  if (index.base !== undefined) { pbr.baseColorTexture = T('base'); pbr.baseColorFactor = [1, 1, 1, 1]; }
  else pbr.baseColorFactor = [lin(mean('albedo', 0)), lin(mean('albedo', 1)), lin(mean('albedo', 2)), u.opacity ? mean('albedo', 3) : 1];
  if (index.orm !== undefined) {
    pbr.metallicRoughnessTexture = T('orm'); pbr.metallicFactor = 1; pbr.roughnessFactor = 1;
    if (!u.aoOne) mat.occlusionTexture = T('orm', { strength: 1 });
  } else { pbr.metallicFactor = mean('orm', 2); pbr.roughnessFactor = mean('orm', 1); }
  if (index.normal !== undefined) mat.normalTexture = T('normal', { scale: 1 });
  if (index.emissive !== undefined) {
    mat.emissiveTexture = T('emissive'); mat.emissiveFactor = [1, 1, 1];
    const es = sc.emissiveStrength * (u.emissiveScale ?? 1);
    if (es !== 1) mat.extensions = { ...mat.extensions, KHR_materials_emissive_strength: { emissiveStrength: es } };
  }
  if (sc.alphaMode !== 'opaque') { mat.alphaMode = sc.alphaMode === 'mask' ? 'MASK' : 'BLEND'; if (sc.alphaMode === 'mask') mat.alphaCutoff = sc.alphaCutoff; }
  if (sc.doubleSided) mat.doubleSided = true;
  const ext = mat.extensions || {};
  if (index.clearcoat !== undefined) ext.KHR_materials_clearcoat = { clearcoatFactor: 1, clearcoatTexture: T('clearcoat'), clearcoatRoughnessFactor: 1, clearcoatRoughnessTexture: T('clearcoat') };
  if (index.sheen !== undefined) ext.KHR_materials_sheen = { sheenColorFactor: [1, 1, 1], sheenColorTexture: T('sheen'), sheenRoughnessFactor: 0.5 };
  if (index.aniso !== undefined) ext.KHR_materials_anisotropy = { anisotropyStrength: 1, anisotropyRotation: 0, anisotropyTexture: T('aniso') };
  if (Math.abs(sc.ior - 1.5) > 1e-4) ext.KHR_materials_ior = { ior: sc.ior };
  if (sc.transmission > 0) ext.KHR_materials_transmission = { transmissionFactor: sc.transmission };
  if (Object.keys(ext).length) mat.extensions = ext;
  progress?.('building mesh', 0.88);
  const mesh = await previewMesh(o, src, sc);
  const glb = buildGLB({ mesh, images, material: mat, name: o.name, extras: { studio: { scalars: sc, uvScale: o.uvScale, res: src.res } } });
  return { glb, images, material: mat };
}
