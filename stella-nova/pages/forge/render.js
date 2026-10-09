// ============================================================================
//  PLANET FORGE  ·  render.js — the WebGPU view (no DOM)
// ----------------------------------------------------------------------------
//  createRenderer({ device, format, loadText }) -> renderer
//    setPlanet(P, M, env)  upload the maps (capped by budget.js gpuWidth,
//                          mips on the CPU), the ring strip, and rebuild
//                          the atmosphere LUTs (atmo.js)
//    setAtmo(P)            LUTs only (atmosphere sliders)
//    render(cam, target)   one full-screen pass into a texture view
//    destroy()
//
//  The planet is radius 1 at the origin; it spins about its own y axis,
//  tilted by P.tilt about x. The view rays are moved into that body frame
//  (bodyFrame), so the shader works in one frame. cam = { pos, target,
//  up, fov (rad), w, h, offX, offY, t, exposure, sunDir (world), spin
//  angle, steps, cloudsOn, flowSpeed, quality (0 phone, 1 tablet,
//  2 desktop), sunRadiusDeg, sunGain, starGain, auroraOn (default on),
//  storm (0..1, aurora.js) }.
//  Shaders: atmo-common.wgsl + sky.wgsl (stars, Milky Way, sun) +
//  planet.wgsl, joined in that order into one module.
//
//  Textures (RGBA8): albedo (sRGB), normal (+height), material (AO,
//  roughness, metallic, specular), emissive (sRGB, a = city light),
//  cloud (alpha, flow u, flow v; the view uses only the gas flow), and the
//  evolving cloud map dyn (clouds.wgsl: deck, cirrus), refreshed in a
//  compute pass when cam.hours (the simulated clock) moves. The canvas gets the shader output with
//  no intermediate target: no MSAA, no HDR buffer (memory: swap chain).
//
//  grep -n targets: "export async function createRenderer", "function upload",
//  "function bodyFrame", "function packView", "render(cam"
// ============================================================================
import { createAtmo } from './atmo.js';
import { auroraPack, AURORA_FLOATS } from './aurora.js';
import { mipChain, shrink } from './maps.js';
import { ringProfile } from './gas.js';
import { gpuWidth, cloudWidth } from './budget.js';
import { cloudSetup, packClouds, CLOUD_U_BYTES, DECK_RATE, CIRRUS_RATE } from './clouds.js';

// The sun's angular radius on the sky. The real Sun from 1 AU is 0.27 deg;
// 1.6 deg makes the granulation and the limb darkening read at page size.
export const SUN_RADIUS_DEG = 1.6;
// The densest cloud deck lets 20 % of the ground through (0d73dfc made the
// clouds more transparent at the user's request).
export const CLOUD_MAX = 0.8;

const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

export async function createRenderer({ device, format, loadText }) {
  const atmo = await createAtmo(device, loadText);
  const code = atmo.common + '\n' + await loadText('sky.wgsl') + '\n' + await loadText('planet.wgsl');
  const module = device.createShaderModule({ label: 'forge planet', code });
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  // the evolving cloud map (clouds.wgsl), rebuilt when the simulated hour moves
  const cMod = device.createShaderModule({ label: 'forge clouds', code: await loadText('clouds.wgsl') });
  const cPipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: cMod, entryPoint: 'csClouds' } });
  const cBuf = device.createBuffer({ size: CLOUD_U_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cPack = new ArrayBuffer(CLOUD_U_BYTES);
  let dyn = null, cBind = null, cSetup = null, cHours = NaN, cSlice = 0, cLeft = 0;
  const cF = new Float32Array(cPack);
  const vPack = new Float32Array(VIEW_FLOATS);
  const vbuf = device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sMap = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge', maxAnisotropy: 8 });
  let tex = {}, bind = null, P = null, shellR = 1.006, glow = [0, 0, 0], terr = [1, 0, 0, 0];

  function makeTex(w, h, srgb, data, mips) {
    const levels = mips ? mipChain(data, w, h) : [{ w, h, data }];
    const t = device.createTexture({ size: [w, h], mipLevelCount: levels.length, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    levels.forEach((l, i) => device.queue.writeTexture({ texture: t, mipLevel: i }, l.data, { bytesPerRow: l.w * 4 }, [l.w, l.h]));
    return t;
  }

  function upload(M, env) {
    const gw = gpuWidth(M.W, env), f = M.W / gw, gh = gw / 2;
    const n = M.W * M.H;
    const mat = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { mat[i * 4] = M.ao[i]; mat[i * 4 + 1] = M.mat[i * 4]; mat[i * 4 + 2] = M.mat[i * 4 + 1]; mat[i * 4 + 3] = M.mat[i * 4 + 2]; }
    for (const k in tex) tex[k].destroy();
    // cloud map: 2k on a desktop, 1k on a phone or tablet (budget.js)
    const cw = cloudWidth(env);
    if (!dyn || dyn.width !== cw) {
      if (dyn) dyn.destroy();
      dyn = device.createTexture({ size: [cw, cw / 2], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
      cBind = device.createBindGroup({ layout: cPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: cBuf } }, { binding: 1, resource: dyn.createView() }] });
    }
    cSetup = cloudSetup(P); cHours = NaN; cLeft = 0;
    tex = {
      albedo: makeTex(gw, gh, true, shrink(M.albedo, M.W, M.H, f), true),
      normal: makeTex(gw, gh, false, shrink(M.normal, M.W, M.H, f), true),
      mat: makeTex(gw, gh, false, shrink(mat, M.W, M.H, f), true),
      emis: makeTex(gw, gh, true, shrink(M.emissive, M.W, M.H, f), true),
      cloud: makeTex(gw, gh, false, shrink(M.cloud, M.W, M.H, f), true),
      ring: makeTex(1024, 1, true, ringProfile(P, 1024), false),
    };
    bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: vbuf } }, { binding: 1, resource: { buffer: atmo.ubuf } },
      { binding: 2, resource: tex.albedo.createView() }, { binding: 3, resource: tex.normal.createView() },
      { binding: 4, resource: tex.mat.createView() }, { binding: 5, resource: tex.emis.createView() },
      { binding: 6, resource: tex.cloud.createView() }, { binding: 7, resource: tex.ring.createView() },
      { binding: 8, resource: atmo.trans.createView() }, { binding: 9, resource: atmo.multi.createView() },
      { binding: 10, resource: sMap }, { binding: 11, resource: atmo.sampler },
      { binding: 12, resource: dyn.createView() },
    ] });
    return { gpuW: gw, bytes: Object.values(tex).reduce((a, t) => a + t.width * t.height * 4 * (t.mipLevelCount > 1 ? 4 / 3 : 1), 0) + dyn.width * dyn.height * 4 };
  }

  const R = {
    atmo,
    get planet() { return P; },
    get cloudMap() { return dyn; },   // tests-gpu.mjs reads it back
    setPlanet(planet, M, env = {}) {
      P = planet;
      shellR = 1 + Math.max(0.002, (P.kind === 'gas' ? 0.004 : P.clouds.height || 0.006));
      const info = upload(M, env);
      // cast shadows (planet.wgsl terrainShadow): relief in radii, scaled
      // like the normal map (bump / 2, at least 1), first step 1.5 texels
      terr = P.kind !== 'gas' && M.reliefKm > 0 ? [M.reliefKm / P.radiusKm * Math.max(1, (P.bump ?? 3) / 2), 1, 1.5 * Math.PI / (info.gpuW / 2), 0] : [1, 0, 0, 0];
      glow = M.stats && M.stats.meanEmis ? M.stats.meanEmis.map(v => v * (P.atmo.glow ?? 0)) : [0, 0, 0];
      R.setAtmo(P, M.stats ? M.stats.meanAlbedo : 0.3);
      return info;
    },
    setAtmo(planet, ground = 0.3) { P = planet; atmo.update(P.atmo, Math.min(0.9, ground), glow); },
    render(cam, target) {
      if (!bind) return;
      device.queue.writeBuffer(vbuf, 0, packView(cam, P, shellR, terr, vPack));
      const enc = device.createCommandEncoder();
      // the cloud map follows the simulated hour in row slices (cloudSlices):
      // one slice per frame, so a frame pays 1/k of the map. When the hour
      // stops, the last k slices bring every row to that hour.
      const h = cam.hours || 0;
      // giants draw no separate cloud field (planet.wgsl gasHaze): no dispatch
      if (cSetup && (cSetup.cover > 0 || cSetup.cirrus > 0) && P.kind !== 'gas') {
        const first = Number.isNaN(cHours);
        const k = first ? 1 : cloudSlices(Math.abs(h - cHours));
        if (first || h !== cHours) { cLeft = k; cHours = h; }
        if (cLeft > 0) {
          const H = dyn.height, rows = Math.ceil(H / k / 8) * 8, s = cSlice % Math.ceil(H / rows);
          packClouds(cSetup, h, cPack); cF[12] = s * rows;
          device.queue.writeBuffer(cBuf, 0, cPack);
          const cp = enc.beginComputePass();
          cp.setPipeline(cPipe); cp.setBindGroup(0, cBind);
          cp.dispatchWorkgroups(Math.ceil(dyn.width / 8), Math.min(rows, H - s * rows) / 8);
          cp.end();
          cSlice = s + 1; cLeft--;
        }
      }
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      device.queue.submit([enc.finish()]);
    },
    destroy() { for (const k in tex) tex[k].destroy(); tex = {}; if (dyn) dyn.destroy(); dyn = null; cBuf.destroy(); atmo.destroy(); vbuf.destroy(); bind = null; },
  };
  return R;
}

// ── maths ───────────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// World -> body: undo the tilt (about x), then the spin (about y).
export function bodyFrame(v, tiltDeg, spin) {
  const t = -tiltDeg * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
  const x = v[0], y = v[1] * ct - v[2] * st, z = v[1] * st + v[2] * ct;
  const cs = Math.cos(-spin), ss = Math.sin(-spin);
  return [x * cs + z * ss, y, -x * ss + z * cs];
}

// Body -> world: the spin (about y), then the tilt (about x).
export function worldFrame(v, tiltDeg, spin) {
  const cs = Math.cos(spin), ss = Math.sin(spin);
  const x = v[0] * cs + v[2] * ss, z = -v[0] * ss + v[2] * cs, y = v[1];
  const t = tiltDeg * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
  return [x, y * ct - z * st, y * st + z * ct];
}

// How many row slices the cloud map is split into, from the change of
// the simulated hour in one frame (dh). Rows of one map then differ by
// at most (k - 1) dh <= SLICE_DH hours: corr > 0.999 (clouds.js), so the
// slice edges do not show. At 6 min/s and 60 fps, k = 8; at 1 day/s, 1.
export const SLICE_DH = 0.05, MAX_SLICES = 8;
export function cloudSlices(dh) {
  if (!(dh > 0)) return MAX_SLICES;
  return Math.max(1, Math.min(MAX_SLICES, Math.floor(SLICE_DH / dh) + 1));
}

// out: an optional Float32Array(VIEW_FLOATS) to fill (render() reuses one,
// so a frame allocates no typed array).
export const VIEW_FLOATS = 64 + AURORA_FLOATS;
export function packView(cam, P, shellR, terr = [1, 0, 0, 0], out = new Float32Array(VIEW_FLOATS)) {
  const tilt = P ? P.tilt : 0;
  const fwdW = norm(sub(cam.target || [0, 0, 0], cam.pos));
  const rightW = norm(cross(fwdW, cam.up || [0, 1, 0]));
  const upW = cross(rightW, fwdW);
  const B = v => bodyFrame(v, tilt, cam.spin || 0);
  const pos = B(cam.pos), f = B(fwdW), r = B(rightW), u = B(upW), s = norm(B(cam.sunDir));
  const top = P && P.atmo.on ? 1 + P.atmo.heightKm / P.atmo.radiusKm : 1;
  const rings = P && P.rings && P.rings.on ? [P.rings.inner, P.rings.outer, 1, P.rings.opacity] : [0, 0, 0, 0];
  const cc = P && P.clouds ? P.clouds.color.map(lin) : [1, 1, 1];
  // columns of the body -> world rotation: the world images of the body axes
  const bw = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => worldFrame(e, tilt, cam.spin || 0));
  const sw = norm(cam.sunDir), hrs = cam.hours || 0;
  const cloudsOn = cam.cloudsOn !== false && P && P.clouds && P.clouds.cover > 0 ? 1 : 0;
  const v = [
    pos[0], pos[1], pos[2], cam.t || 0,
    r[0], r[1], r[2], Math.tan(cam.fov / 2),
    u[0], u[1], u[2], cam.w / cam.h,
    f[0], f[1], f[2], cam.exposure ?? 1,
    s[0], s[1], s[2], Math.cos(0.6 * Math.PI / 180),
    cam.w, cam.h, cam.offX || 0, cam.offY || 0,
    top, shellR, cam.steps || 24, cam.emissive ?? 1,
    ...rings,
    0.0004 * (cam.flowSpeed ?? 1), 0.00025 * (cam.flowSpeed ?? 1), cloudsOn, P && P.kind === 'gas' ? 1 : 0,
    cc[0], cc[1], cc[2], 0.0015,
    // body -> world rows (stars stay fixed in the world frame), the sun
    bw[0][0], bw[1][0], bw[2][0], (cam.sunRadiusDeg ?? SUN_RADIUS_DEG) * Math.PI / 180,
    bw[0][1], bw[1][1], bw[2][1], cam.sunGain ?? 1.6,
    bw[0][2], bw[1][2], bw[2][2], cam.quality ?? 2,
    sw[0], sw[1], sw[2], cam.starGain ?? 1,
    // cloud layers: the slow solid drift as a u offset, cirrus opacity, deck opacity max
    -(DECK_RATE * hrs) / (2 * Math.PI) % 1, -(CIRRUS_RATE * hrs) / (2 * Math.PI) % 1, P && P.kind === 'gas' ? 0.22 : 0.55, CLOUD_MAX,
    // cast shadows of the relief: relief (radii), on, first step (rad), 0
    terr[0], terr[1], terr[2], terr[3],
  ];
  out.set(v);
  // aurorae (aurora.js): 6 vec4 after the 16 above, all 0 when off
  auroraPack(P, cam, out, 64);
  return out;
}
