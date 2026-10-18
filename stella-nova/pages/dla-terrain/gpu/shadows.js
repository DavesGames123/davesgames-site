// ============================================================================
//  DLA TERRAIN  ·  gpu/shadows.js — cascaded sun shadow maps
// ----------------------------------------------------------------------------
//  cascadeSplits(near, far, count, lambda) -> [far of each cascade]
//      the practical split scheme: lambda mixes the log and the uniform split.
//  computeCascades(cam, sunDir, opts) -> { count, size, mats, splits, texel,
//      depthBias, normalBias, centers, radii }   (no GPU, node tests use it)
//      cam = { pos, forward, right, up, fovY, aspect, near }
//      opts = { count, size, far, bounds: { min:[x,y,z], max:[x,y,z] } }
//      STABLE: each cascade is a bounding sphere of its view slice, so the
//      ortho box does not change size when the camera turns. The light
//      basis depends on the sun only, and the box centre snaps to whole
//      shadow texels in that basis, so the edges do not crawl when the
//      camera moves. The depth range covers the whole terrain box, so a far
//      ridge outside the slice still casts into it.
//  createShadowMaps(gpu) -> { tex, layerViews, sampleBindGroup, passBindGroups,
//      update(c), resize(size, count) }
//      The map has one layer per cascade (it had 4 at all counts: 16 MB at
//      1024 for a phone with 2 cascades, now 8 MB). resize clamps size and
//      count to gpu.profile (gpu/budget.js), so a quality change on a phone
//      does not make a 2048 x 4 map.
//
//  grep -n targets: "export function computeCascades", "export function cascadeSplits",
//  "export function createShadowMaps", "SNAP"
// ============================================================================
import { lookAt, orthoRZ, mul, xform } from './mat.js';
import { packCascades, packShadowPass, CASCADE_FLOATS, SHADOWPASS_FLOATS } from './globals.js';

export function cascadeSplits(near, far, count, lambda = 0.8) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    const f = i / count;
    const lg = near * Math.pow(far / near, f), un = near + (far - near) * f;
    out.push(lambda * lg + (1 - lambda) * un);
  }
  return out;
}

export function lightBasis(sunDir) {
  const up = Math.abs(sunDir[2]) > 0.98 ? [1, 0, 0] : [0, 0, 1];
  return lookAt([0, 0, 0], [-sunDir[0], -sunDir[1], -sunDir[2]], up);
}

export function computeCascades(cam, sunDir, opts) {
  const count = opts.count || 3, size = opts.size || 2048;
  const far = opts.far || 2000;
  const splits = cascadeSplits(Math.max(cam.near, 0.1), far, count, opts.lambda ?? 0.82);
  const L = lightBasis(sunDir);
  // the terrain box in light view space: the depth range of every cascade
  const bmin = opts.bounds ? opts.bounds.min : [-1e4, -100, -1e4], bmax = opts.bounds ? opts.bounds.max : [1e4, 3000, 1e4];
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = [(i & 1) ? bmax[0] : bmin[0], (i & 2) ? bmax[1] : bmin[1], (i & 4) ? bmax[2] : bmin[2]];
    const z = xform(L, p)[2];
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }
  const th = Math.tan(cam.fovY / 2), tw = th * cam.aspect;
  const mats = [], texel = [], centers = [], radii = [];
  let prev = Math.max(cam.near, 0.1);
  for (let c = 0; c < count; c++) {
    const d0 = prev, d1 = splits[c];
    prev = d1;
    // the slice is symmetric round the view axis: its bounding sphere has
    // its centre on the axis (closed form, so the radius never changes as
    // the camera turns)
    const k2 = tw * tw + th * th;
    let zc = 0.5 * (d0 + d1) * (1 + k2);
    zc = Math.min(zc, d1);
    const r0 = Math.hypot(zc - d0, d0 * Math.sqrt(k2)), r1 = Math.hypot(d1 - zc, d1 * Math.sqrt(k2));
    let r = Math.max(r0, r1);
    r = Math.ceil(r * 16) / 16;
    const ctr = [cam.pos[0] + cam.forward[0] * zc, cam.pos[1] + cam.forward[1] * zc, cam.pos[2] + cam.forward[2] * zc];
    // SNAP the centre to whole texels in the light basis
    const tx = (2 * r) / size;
    const lc = xform(L, ctr);
    const sx = Math.floor(lc[0] / tx) * tx, sy = Math.floor(lc[1] / tx) * tx;
    const margin = 50;
    const P = orthoRZ(sx - r, sx + r, sy - r, sy + r, -(zMax + margin), -(zMin - margin));
    mats.push(mul(P, L));
    texel.push(tx); centers.push(ctr); radii.push(r);
  }
  return {
    count, size, mats, splits, texel, centers, radii,
    // in reverse-Z clip depth over the whole box: about 1.5 m of slack
    depthBias: 1.5 / Math.max(1, (zMax - zMin) + 100),
    normalBias: 1.4,
  };
}

export function createShadowMaps(gpu) {
  const device = gpu.device;
  const sh = {
    tex: null, layerViews: [], arrayView: null, sampleBindGroup: null, passBindGroups: [],
    size: 0, count: 0, info: null,
  };
  const cascadeBuf = device.createBuffer({ label: 'CascadeInfo', size: CASCADE_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const passBuf = device.createBuffer({ label: 'ShadowPass x4', size: 256 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cmp = device.createSampler({ label: 'shadow compare', compare: 'greater-equal', magFilter: 'linear', minFilter: 'linear' });
  const cf = new Float32Array(CASCADE_FLOATS), pf = new Float32Array(SHADOWPASS_FLOATS);
  sh.resize = (size, count) => {
    const pf = gpu.profile || {};
    if (pf.shadowSize) size = Math.min(size, pf.shadowSize);
    if (pf.cascades) count = Math.min(count, pf.cascades);
    count = Math.max(1, Math.min(4, count | 0 || 1));
    if (sh.tex && sh.size === size && sh.count === count) return;
    if (sh.tex) sh.tex.destroy();
    sh.size = size; sh.count = count;
    gpu.shadowSize = size; gpu.shadowCascades = count;
    sh.tex = device.createTexture({
      label: 'sun shadow', size: [size, size, count], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    sh.layerViews = Array.from({ length: count }, (_, i) => sh.tex.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    sh.arrayView = sh.tex.createView({ dimension: '2d-array' });
    sh.sampleBindGroup = device.createBindGroup({
      label: 'shadow sample', layout: gpu.shadowSampleLayout,
      entries: [
        { binding: 0, resource: sh.arrayView },
        { binding: 1, resource: cmp },
        { binding: 2, resource: { buffer: cascadeBuf } },
      ],
    });
    sh.passBindGroups = Array.from({ length: count }, (_, i) => device.createBindGroup({
      label: 'shadow pass ' + i, layout: gpu.shadowPassLayout,
      entries: [{ binding: 3, resource: { buffer: passBuf, offset: i * 256, size: SHADOWPASS_FLOATS * 4 } }],
    }));
  };
  sh.update = c => {
    sh.info = c;
    gpu.queue.writeBuffer(cascadeBuf, 0, packCascades(cf, c));
    for (let i = 0; i < c.count; i++) gpu.queue.writeBuffer(passBuf, i * 256, packShadowPass(pf, c, i));
  };
  // no cascades: everything lit (count 0)
  sh.disable = () => {
    cf.fill(0);
    gpu.queue.writeBuffer(cascadeBuf, 0, cf);
    sh.info = null;
  };
  sh.dispose = () => { if (sh.tex) sh.tex.destroy(); cascadeBuf.destroy(); passBuf.destroy(); };
  sh.resize(gpu.shadowSize, gpu.shadowCascades);
  return sh;
}
