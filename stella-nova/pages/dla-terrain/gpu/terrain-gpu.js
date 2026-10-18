// ============================================================================
//  DLA TERRAIN  ·  gpu/terrain-gpu.js — terrain snapshots to GPU textures
// ----------------------------------------------------------------------------
//  createTerrainGPU(gpu) -> tg
//    tg.begin(opts)              a new generation: size n, world size, height
//                                scale, sea level (from the LIB options)
//    tg.snapshot(snap, stage, s) a LIB progress snapshot { n, height, flow?,
//                                river?, moisture?, water?, biome? }: upload
//                                it and start a blend (s seconds, default
//                                BLEND_S) from the state on screen now
//    tg.finish(terrain)          the final Terrain: upload, keep tg.cpu
//    tg.compute(encoder, dt)     advance the blend: blend + normals passes
//    tg.view -> TerrainGPU       { n, worldSize, heightScale, seaLevel,
//                                heightTex, normalTex, auxTex, biomeTex, cpu,
//                                stage, minH, maxH, version }
//    tg.heightAt(x, z)           CPU height (m) of the target state, for the
//                                camera collision (bilinear, cell centres)
//    tg.blending                 true while a blend runs
//  The four textures stay the same objects while n stays the same, so a
//  module that keeps them from setTerrain sees each blend frame. A new n
//  makes new textures and a new globals bind group (gpu.globalsBindGroup).
//
//  aux packing (CONTRACT): r = log(1 + flow), g = river 0..1, b = moisture,
//  a = water depth m. Missing fields pack as 0.
//
//  grep -n targets: "export function createTerrainGPU", "BLEND_S", "function packAux",
//  "export function sampleHeight", "export function heightRange"
// ============================================================================
import { makeGlobalsBindGroup } from './device.js';

export const BLEND_S = 0.6;

export function sampleHeight(h, n, worldSize, x, z) {
  const t = worldSize / n;
  const fx = (x + worldSize / 2) / t - 0.5, fz = (z + worldSize / 2) / t - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const at = (a, b) => h[Math.max(0, Math.min(n - 1, b)) * n + Math.max(0, Math.min(n - 1, a))];
  return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
}
export function heightRange(h) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) { const v = h[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return lo <= hi ? [lo, hi] : [0, 0];
}
// interleave the aux fields of a snapshot into vec4 (Float32Array n*n*4)
export function packAux(s) {
  const n = s.n, N = n * n, out = new Float32Array(N * 4);
  const flow = s.flow, river = s.river, moist = s.moisture, water = s.water;
  if (!flow && !river && !moist && !water) return null;
  for (let i = 0; i < N; i++) {
    out[i * 4] = flow ? Math.log1p(Math.max(0, flow[i])) : 0;
    out[i * 4 + 1] = river ? river[i] : 0;
    out[i * 4 + 2] = moist ? moist[i] : 0;
    out[i * 4 + 3] = water ? water[i] : 0;
  }
  return out;
}
// nearest resample of a byte grid (biome ids) from n0 to n1, rows padded
// to 256 bytes for writeTexture
export function biomeRows(b, n0, n1) {
  const row = Math.ceil(n1 / 256) * 256, out = new Uint8Array(row * n1);
  for (let j = 0; j < n1; j++) {
    const sj = Math.min(n0 - 1, Math.floor((j + 0.5) * n0 / n1));
    for (let i = 0; i < n1; i++) out[j * row + i] = b[sj * n0 + Math.min(n0 - 1, Math.floor((i + 0.5) * n0 / n1))];
  }
  return { data: out, bytesPerRow: row };
}

export async function createTerrainGPU(gpu) {
  const device = gpu.device, U = GPUTextureUsage;
  const code = await (await fetch(new URL('./terrain.wgsl', import.meta.url))).text();
  const mod = device.createShaderModule({ label: 'terrain prep', code });
  const pBlend = device.createComputePipeline({ label: 'terrain blend', layout: 'auto', compute: { module: mod, entryPoint: 'blend' } });
  const pNorm = device.createComputePipeline({ label: 'terrain normals', layout: 'auto', compute: { module: mod, entryPoint: 'normals' } });
  const prepBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const prep = new Float32Array(8);

  const tg = {
    n: 0, worldSize: 1, heightScale: 1, seaLevel: 0, minH: 0, maxH: 1, stage: null,
    cpu: null, cpuHeight: null, cpuN: 1, version: 0, blending: false,
    tex: null, view: null, t: 1, hasAux: 0, aoScale: 1.4,
  };
  let srcH = null, srcA = null, srcN = 0, bgBlend = null, bgNorm0 = null, bgNorm1 = null, needNormals = false;

  function makeTextures(n) {
    if (tg.tex) for (const k in tg.tex) tg.tex[k].destroy();
    const mk = (label, format, usage) => device.createTexture({ label, size: [n, n], format, usage });
    tg.tex = {
      height: mk('height', 'r32float', U.TEXTURE_BINDING | U.STORAGE_BINDING | U.COPY_SRC | U.COPY_DST),
      heightPrev: mk('height prev', 'r32float', U.TEXTURE_BINDING | U.COPY_DST),
      normal: mk('normal ao', 'rgba16float', U.TEXTURE_BINDING | U.STORAGE_BINDING),
      aux: mk('aux', 'rgba16float', U.TEXTURE_BINDING | U.STORAGE_BINDING | U.COPY_SRC | U.COPY_DST),
      auxPrev: mk('aux prev', 'rgba16float', U.TEXTURE_BINDING | U.COPY_DST),
      biome: mk('biome', 'r8uint', U.TEXTURE_BINDING | U.COPY_DST),
    };
    tg.n = n;
    makeGlobalsBindGroup(gpu, tg.tex);
    bgNorm0 = device.createBindGroup({ layout: pNorm.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: prepBuf } }] });
    bgNorm1 = device.createBindGroup({
      layout: pNorm.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: tg.tex.height.createView() }, { binding: 1, resource: tg.tex.normal.createView() }],
    });
    bgBlend = null;
    // a flat start at the sea floor, so the first snapshot rises out of it
    const z = biomeRows(new Uint8Array(1), 1, n);
    device.queue.writeTexture({ texture: tg.tex.biome }, z.data, { bytesPerRow: z.bytesPerRow }, [n, n]);
    needNormals = true;
  }

  function ensureSrc(n) {
    if (srcN === n && srcH) return;
    if (srcH) { srcH.destroy(); srcA.destroy(); }
    srcN = n;
    srcH = device.createBuffer({ label: 'snapshot height', size: n * n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    srcA = device.createBuffer({ label: 'snapshot aux', size: n * n * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    bgBlend = null;
  }

  function refreshView() {
    tg.view = {
      n: tg.n, worldSize: tg.worldSize, heightScale: tg.heightScale, seaLevel: tg.seaLevel,
      heightTex: tg.tex.height, normalTex: tg.tex.normal, auxTex: tg.tex.aux, biomeTex: tg.tex.biome,
      cpu: tg.cpu, stage: tg.stage, minH: tg.minH, maxH: tg.maxH, version: tg.version,
      snapshot: tg.lastSnap || null,
    };
    return tg.view;
  }

  tg.begin = o => {
    const n = Math.max(16, Math.min(device.limits.maxTextureDimension2D, o.n | 0 || 512));
    tg.worldSize = o.worldSize || 8000; tg.heightScale = o.heightScale || 1200; tg.seaLevel = o.seaLevel ?? 0;
    tg.cpu = null; tg.stage = null;
    if (tg.n !== n || !tg.tex) makeTextures(n);
    tg.version++;
    return refreshView();
  };

  tg.snapshot = (s, stage, blendS) => {
    if (!s || !s.height || !tg.tex) return tg.view;
    const n = s.n || Math.round(Math.sqrt(s.height.length));
    ensureSrc(n);
    device.queue.writeBuffer(srcH, 0, s.height.buffer, s.height.byteOffset, n * n * 4);
    const aux = packAux({ ...s, n });
    tg.hasAux = aux ? 1 : 0;
    if (aux) device.queue.writeBuffer(srcA, 0, aux.buffer, 0, aux.byteLength);
    if (s.biome) {
      const b = biomeRows(s.biome, n, tg.n);
      device.queue.writeTexture({ texture: tg.tex.biome }, b.data, { bytesPerRow: b.bytesPerRow }, [tg.n, tg.n]);
    }
    if (s.seaLevel !== undefined) tg.seaLevel = s.seaLevel;
    if (s.worldSize) tg.worldSize = s.worldSize;
    if (s.heightScale) tg.heightScale = s.heightScale;
    // the state on screen now is the start of the new blend
    const enc = device.createCommandEncoder();
    enc.copyTextureToTexture({ texture: tg.tex.height }, { texture: tg.tex.heightPrev }, [tg.n, tg.n]);
    enc.copyTextureToTexture({ texture: tg.tex.aux }, { texture: tg.tex.auxPrev }, [tg.n, tg.n]);
    device.queue.submit([enc.finish()]);
    if (!bgBlend) {
      bgBlend = device.createBindGroup({
        layout: pBlend.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: prepBuf } },
          { binding: 1, resource: { buffer: srcH } },
          { binding: 2, resource: { buffer: srcA } },
          { binding: 3, resource: tg.tex.heightPrev.createView() },
          { binding: 4, resource: tg.tex.auxPrev.createView() },
          { binding: 5, resource: tg.tex.height.createView() },
          { binding: 6, resource: tg.tex.aux.createView() },
        ],
      });
    }
    const [lo, hi] = heightRange(s.height);
    tg.minH = Math.min(lo, tg.seaLevel); tg.maxH = Math.max(hi, tg.seaLevel + 1);
    tg.cpuHeight = s.height; tg.cpuN = n;
    tg.stage = stage || s.stage || null;
    tg.lastSnap = s;
    tg.t = 0; tg.blending = true; tg.version++;
    tg.blendS = blendS > 0 ? blendS : BLEND_S;
    return refreshView();
  };

  tg.finish = (terrain, blendS) => {
    tg.cpu = terrain;
    if (terrain && terrain.height) {
      const v = tg.snapshot({ ...terrain, n: terrain.n }, 'done', blendS);
      tg.cpu = terrain;
      v.cpu = terrain;
      return v;
    }
    return refreshView();
  };

  tg.compute = (enc, dt) => {
    if (!tg.tex) return false;
    if (!tg.blending && !needNormals) return false;
    if (tg.blending) {
      tg.t = Math.min(1, tg.t + dt / (tg.blendS || BLEND_S));
    }
    prep[0] = tg.n; prep[1] = srcN || 1; prep[2] = tg.t; prep[3] = tg.worldSize / tg.n;
    prep[4] = tg.hasAux; prep[5] = tg.aoScale;
    device.queue.writeBuffer(prepBuf, 0, prep);
    const g = Math.ceil(tg.n / 8);
    const pass = enc.beginComputePass({ label: 'terrain prep' });
    if (tg.blending && bgBlend) {
      pass.setPipeline(pBlend); pass.setBindGroup(0, bgBlend); pass.dispatchWorkgroups(g, g);
    }
    pass.setPipeline(pNorm); pass.setBindGroup(0, bgNorm0); pass.setBindGroup(1, bgNorm1); pass.dispatchWorkgroups(g, g);
    pass.end();
    needNormals = false;
    if (tg.t >= 1) tg.blending = false;
    return true;
  };

  tg.heightAt = (x, z) => tg.cpuHeight ? sampleHeight(tg.cpuHeight, tg.cpuN, tg.worldSize, x, z) : 0;
  tg.dispose = () => { if (tg.tex) for (const k in tg.tex) tg.tex[k].destroy(); if (srcH) { srcH.destroy(); srcA.destroy(); } prepBuf.destroy(); };
  tg.begin({ n: 256, worldSize: 8000, heightScale: 1200, seaLevel: 0 });
  return tg;
}
