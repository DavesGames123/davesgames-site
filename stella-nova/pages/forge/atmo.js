// ============================================================================
//  PLANET FORGE  ·  atmo.js — the atmosphere: parameters and LUT passes
// ----------------------------------------------------------------------------
//  The view shades the sky with single scattering along each view ray
//  (Rayleigh + Mie + an absorbing layer), plus Hillaire's multiple
//  scattering term. Two small LUTs make that cheap per pixel:
//    trans  256 x 64 rgba16float  T(r, mu) to the top of the atmosphere
//    multi   32 x 32 rgba16float  Psi_ms(mu_s, h)
//  They are rebuilt when the planet changes (a few ms), not per frame.
//
//  packAtmo(a, ground, glow) -> Float32Array(28), the WGSL struct Atmo
//  (atmo-common.wgsl). The JSON keeps the coefficients in 1/km x 1e-3;
//  the GPU gets 1/km. density scales all coefficients. ground is the
//  mean albedo of the generated surface. glow (linear rgb) is the haze
//  light from a hot surface (render.js: mean emission x atmo.glow).
//  a.clarity (0..1, view only) keeps that share of the haze on rays that
//  end on the ground at the nadir; the limb stays physical. Earth's real
//  optical depths over a dark sea read as a milky veil at page size.
//
//  transmittanceRef(a, r, mu) is a JS reference integral of T, for tests
//  and for the Deno check of the GPU LUT.
//
//  grep -n targets: "export function packAtmo", "export async function createAtmo",
//  "export function transmittanceRef", "export const LUT"
// ============================================================================

export const LUT = { transW: 256, transH: 64, multi: 32 };

export function packAtmo(a, groundAlbedo = 0.3, glow = [0, 0, 0]) {
  const k = 1e-3 * (a.density ?? 1);
  const bot = a.radiusKm, top = a.radiusKm + a.heightKm;
  return new Float32Array([
    a.rayleigh[0] * k, a.rayleigh[1] * k, a.rayleigh[2] * k, a.rayleighH,
    a.mie[0] * k, a.mie[1] * k, a.mie[2] * k, a.mieH,
    a.mieAbs[0] * k, a.mieAbs[1] * k, a.mieAbs[2] * k, a.mieG,
    a.absorb[0] * k, a.absorb[1] * k, a.absorb[2] * k, a.absorbC,
    bot, top, a.absorbW, a.sun,
    groundAlbedo, groundAlbedo, groundAlbedo, a.on ? 1 : 0,
    glow[0], glow[1], glow[2], a.clarity ?? 1,
  ]);
}

// JS reference: T along a ray from radius r with zenith cosine mu to the top.
export function transmittanceRef(a, r, mu, n = 400) {
  const U = packAtmo(a);
  const bot = U[16], top = U[17];
  const b = r * mu, c = r * r - top * top, t = -b + Math.sqrt(Math.max(0, b * b - c));
  const dt = t / n, tau = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * dt, x = Math.sqrt(1 - mu * mu) * s, y = r + mu * s;
    const h = Math.max(0, Math.hypot(x, y) - bot);
    const dR = Math.exp(-h / U[3]), dM = Math.exp(-h / U[7]), dA = Math.max(0, 1 - Math.abs(h - U[15]) / Math.max(U[18], 1e-3));
    for (let k = 0; k < 3; k++) tau[k] += (U[k] * dR + (U[4 + k] + U[8 + k]) * dM + U[12 + k] * dA) * dt;
  }
  return tau.map(v => Math.exp(-v));
}

// The LUT textures and passes. loadText(name) returns a shader file's text.
export async function createAtmo(device, loadText) {
  const common = await loadText('atmo-common.wgsl');
  const code = common + '\n' + await loadText('atmo-lut.wgsl');
  const module = device.createShaderModule({ label: 'forge atmo lut', code });
  const ubuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
  const trans = device.createTexture({ size: [LUT.transW, LUT.transH], format: 'rgba16float', usage });
  const multi = device.createTexture({ size: [LUT.multi, LUT.multi], format: 'rgba16float', usage });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const pTrans = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'csTrans' } });
  const pMulti = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'csMulti' } });
  const bTrans = device.createBindGroup({ layout: pTrans.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: trans.createView() }] });
  const bMulti = device.createBindGroup({ layout: pMulti.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: ubuf } }, { binding: 2, resource: trans.createView() },
    { binding: 3, resource: sampler }, { binding: 4, resource: multi.createView() }] });
  let packed = null;
  return {
    trans, multi, sampler, ubuf, common,
    get packed() { return packed; },
    // Rebuild both LUTs for atmosphere a (a JSON atmo block).
    update(a, groundAlbedo, glow) {
      packed = packAtmo(a, groundAlbedo, glow);
      device.queue.writeBuffer(ubuf, 0, packed);
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pTrans); pass.setBindGroup(0, bTrans);
      pass.dispatchWorkgroups(Math.ceil(LUT.transW / 8), Math.ceil(LUT.transH / 8));
      pass.end();
      const p2 = enc.beginComputePass();
      p2.setPipeline(pMulti); p2.setBindGroup(0, bMulti);
      p2.dispatchWorkgroups(LUT.multi, LUT.multi);
      p2.end();
      device.queue.submit([enc.finish()]);
    },
    destroy() { trans.destroy(); multi.destroy(); ubuf.destroy(); },
  };
}
