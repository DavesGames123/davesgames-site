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
//  angle, steps, cloudsOn, flowSpeed }.
//
//  Textures (RGBA8): albedo (sRGB), normal (+height), material (AO,
//  roughness, metallic, specular), emissive (sRGB, a = city light),
//  cloud (alpha, flow u, flow v). The canvas gets the shader output with
//  no intermediate target: no MSAA, no HDR buffer (memory: swap chain).
//
//  grep -n targets: "export async function createRenderer", "function upload",
//  "function bodyFrame", "function packView", "render(cam"
// ============================================================================
import { createAtmo } from './atmo.js';
import { mipChain, shrink } from './maps.js';
import { ringProfile } from './gas.js';
import { gpuWidth } from './budget.js';

const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

export async function createRenderer({ device, format, loadText }) {
  const atmo = await createAtmo(device, loadText);
  const code = atmo.common + '\n' + await loadText('planet.wgsl');
  const module = device.createShaderModule({ label: 'forge planet', code });
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const vbuf = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sMap = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge', maxAnisotropy: 8 });
  let tex = {}, bind = null, P = null, shellR = 1.012;

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
    ] });
    return { gpuW: gw, bytes: Object.values(tex).reduce((a, t) => a + t.width * t.height * 4 * (t.mipLevelCount > 1 ? 4 / 3 : 1), 0) };
  }

  const R = {
    atmo,
    get planet() { return P; },
    setPlanet(planet, M, env = {}) {
      P = planet;
      shellR = 1 + Math.max(0.004, (P.kind === 'gas' ? 0.004 : P.clouds.height || 0.012));
      const info = upload(M, env);
      R.setAtmo(P, M.stats ? M.stats.meanAlbedo : 0.3);
      return info;
    },
    setAtmo(planet, ground = 0.3) { P = planet; atmo.update(P.atmo, Math.min(0.9, ground)); },
    render(cam, target) {
      if (!bind) return;
      device.queue.writeBuffer(vbuf, 0, packView(cam, P, shellR));
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      device.queue.submit([enc.finish()]);
    },
    destroy() { for (const k in tex) tex[k].destroy(); tex = {}; atmo.destroy(); vbuf.destroy(); bind = null; },
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

export function packView(cam, P, shellR) {
  const tilt = P ? P.tilt : 0;
  const fwdW = norm(sub(cam.target || [0, 0, 0], cam.pos));
  const rightW = norm(cross(fwdW, cam.up || [0, 1, 0]));
  const upW = cross(rightW, fwdW);
  const B = v => bodyFrame(v, tilt, cam.spin || 0);
  const pos = B(cam.pos), f = B(fwdW), r = B(rightW), u = B(upW), s = norm(B(cam.sunDir));
  const top = P && P.atmo.on ? 1 + P.atmo.heightKm / P.atmo.radiusKm : 1;
  const rings = P && P.rings && P.rings.on ? [P.rings.inner, P.rings.outer, 1, P.rings.opacity] : [0, 0, 0, 0];
  const cc = P && P.clouds ? P.clouds.color.map(lin) : [1, 1, 1];
  const cloudsOn = cam.cloudsOn !== false && P && P.clouds && P.clouds.cover > 0 ? 1 : 0;
  return new Float32Array([
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
  ]);
}
