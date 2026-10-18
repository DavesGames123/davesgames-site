// ============================================================================
//  MARINE SNOW  ·  lib/marine-snow-gpu.js — the WebGPU helper
// ----------------------------------------------------------------------------
//  Draws lib/marine-snow.wgsl: the same flakes, atlas, depth mix and CPU
//  state as lib/marine-snow.js (the three.js form). A WebGPU page:
//
//    import { createMarineSnowGPU } from '../../lib/marine-snow-gpu.js';
//    const code = await (await fetch(new URL('../../lib/marine-snow.wgsl', import.meta.url))).text();
//    const ms = createMarineSnowGPU(device, { code, format, depthFormat, count: 3000 });
//    each frame: ms.update({ vp, view, eye, fovY, near, far, width, height, t });
//                ms.draw(pass);           // in a pass with additive room
//    soft fade:  ms.setDepthView(view);   // the scene depth (read only)
//
//  vp, view: Float32Array(16), column-major (WebGPU clip z 0..1). eye: the
//  camera in render space. The page keeps a floating origin with
//  setOrigin(x, y, z); the flakes stay in the world through it.
//
//  grep -n: "export const MS_U_FLOATS" (the layout), "export function
//  packSnowUniforms", "export function createMarineSnowGPU"
// ============================================================================
import { makeSnowAtlas, snowInstances, snowPhase, snowMix, snowProfile, MS_G, MS_GAIN, MS_SHARE, MS_SINK, MS_EDDY_PERIOD } from './marine-snow.js';

// the struct MsU of marine-snow.wgsl: 3 mat4, 21 vec4, 3 arrays of 4 vec4
export const MS_U_VEC4 = ['cam', 'box', 'phase', 'phaseN', 'sink', 'sinkN', 'eddyO', 'lens', 'px', 'share', 'typeK', 'sizeK', 'tintA', 'tintB', 'ext', 'g', 'viewport', 'frag', 'disc', 'sun', 'sunC'];
export const MS_U_FLOATS = 48 + MS_U_VEC4.length * 4 + 3 * 16;

// st: { vp, prevVP, view (16 each), and each MS_U_VEC4 name: 4 numbers,
// spotP, spotD, spotC: 16 numbers each }. -> Float32Array(MS_U_FLOATS)
export function packSnowUniforms(st, out = new Float32Array(MS_U_FLOATS)) {
  out.set(st.vp, 0); out.set(st.prevVP, 16); out.set(st.view, 32);
  MS_U_VEC4.forEach((k, i) => out.set(st[k] || [0, 0, 0, 0], 48 + i * 4));
  const a = 48 + MS_U_VEC4.length * 4;
  out.set(st.spotP, a); out.set(st.spotD, a + 16); out.set(st.spotC, a + 32);
  return out;
}

const posmod = (x, m) => ((x % m) + m) % m;
const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
// m x T(d), column-major: column 3 += m[col 0..2] . d
function mulTranslate(m, d) {
  const o = Float32Array.from(m);
  for (let r = 0; r < 4; r++) o[12 + r] = m[12 + r] + m[r] * d[0] + m[4 + r] * d[1] + m[8 + r] * d[2];
  return o;
}

// The light swap: o.light replaces the text between MS_LIGHT_BEGIN and
// MS_LIGHT_END (a page fn msLight(p: vec3f, V: vec3f) -> vec3f).
export function snowWGSL(code, light) {
  if (!light) return code;
  const a = code.indexOf('// MS_LIGHT_BEGIN'), b = code.indexOf('// MS_LIGHT_END');
  return a < 0 || b < 0 ? code : code.slice(0, a) + light + '\n' + code.slice(b);
}

export function createMarineSnowGPU(device, o = {}) {
  const prof = snowProfile(o.profile);
  const N = Math.max(1, Math.round(o.count ?? prof.count));
  const atlas = o.atlas || makeSnowAtlas({ size: o.atlasSize || prof.atlas, seed: o.seed ?? 1 });
  const GU = globalThis.GPUBufferUsage, GT = globalThis.GPUTextureUsage;
  // the atlas with its mips (WebGPU has no mip maker)
  const tex = device.createTexture({ size: [atlas.size, atlas.size], format: 'rgba8unorm', mipLevelCount: atlas.levels.length, usage: GT.TEXTURE_BINDING | GT.COPY_DST });
  atlas.levels.forEach((l, i) => device.queue.writeTexture({ texture: tex, mipLevel: i }, l.data, { bytesPerRow: l.width * 4 }, [l.width, l.height]));
  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const inst = snowInstances(N, o.seed ?? 1, o.nearShare ?? 0.4);
  const ib = new Float32Array(N * 8);
  for (let i = 0; i < N; i++) { ib.set(inst.seed.subarray(i * 4, i * 4 + 4), i * 8); ib.set(inst.rand.subarray(i * 4, i * 4 + 4), i * 8 + 4); }
  const vbuf = device.createBuffer({ size: ib.byteLength, usage: GU.VERTEX | GU.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, ib);
  const ubuf = device.createBuffer({ size: MS_U_FLOATS * 4, usage: GU.UNIFORM | GU.COPY_DST });
  const dummy = device.createTexture({ size: [1, 1], format: 'depth32float', usage: GT.TEXTURE_BINDING | GT.RENDER_ATTACHMENT });
  const module = device.createShaderModule({ code: snowWGSL(o.code, o.light) });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsSnow', buffers: [{ arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }] },
    fragment: { module, entryPoint: 'fsSnow', targets: [{ format: o.format, blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: o.depthFormat ? { format: o.depthFormat, depthWriteEnabled: false, depthCompare: o.depthCompare || 'less' } : undefined,
    multisample: { count: o.sampleCount || 1 },
  });
  let depthView = null, group = null;
  function makeGroup() {
    group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: tex.createView() }, { binding: 2, resource: samp },
      { binding: 3, resource: depthView || dummy.createView() },
    ] });
  }
  makeGroup();

  const box = o.box ?? prof.box, nearBox = o.nearBox ?? prof.nearBox;
  const st = {
    vp: ident(), prevVP: ident(), view: ident(),
    cam: [0, 0, 0, 0], box: [box, box, box, nearBox], phase: [0, 0, 0, 0], phaseN: [0, 0, 0, 0], sink: [0, 0, 0, 0], sinkN: [0, 0, 0, 0], eddyO: [0, 0, 0, 0],
    lens: [900, o.aperture ?? 0.006, o.focus ?? 2.5, o.shutter ?? 0.5], px: [o.minPx ?? prof.minPx, o.maxPx ?? prof.maxPx, o.maxStreak ?? prof.maxStreak, 0],
    share: [MS_SHARE[0], MS_SHARE[0] + MS_SHARE[1], MS_SHARE[0] + MS_SHARE[1] + MS_SHARE[2], 1],
    typeK: [1, 1, 1, 1], sizeK: [1, 1, 1, 1], tintA: [1, 1, 1, o.gain ?? MS_GAIN], tintB: [1, 1, 1, 1], ext: [0.05, 0.04, 0.03, 0], g: MS_G.slice(),
    viewport: [1, 1, 0.1, 100], frag: [0, o.softLen ?? 0.3, o.post ? 1 : 0, 1], disc: [atlas.meanDisc, 0, 0, 0],
    sun: [0, -1, 0, 0], sunC: [0, 0, 0, 0], spotP: new Float32Array(16), spotD: new Float32Array(16), spotC: new Float32Array(16),
  };
  const S = { t: null, drift: [0, 0, 0], sink: [0, 0, 0, 0], cur: [0, 0, 0], origin: [0, 0, 0], lastOrigin: null, lastEye: null, density: 1, user: 1 };
  const packed = new Float32Array(MS_U_FLOATS);
  let drawCount = N;
  function applyDensity() {
    const d = Math.min(1, Math.max(0, S.density * S.user));
    st.tintB[3] = d;
    drawCount = Math.min(N, Math.ceil(N * Math.min(1, d * 1.03 + 0.001)));
  }
  // c: { vp, view, eye, fovY (rad), near, far, width, height, t }
  function update(c) {
    const dt = S.t === null ? 0 : Math.min(0.25, Math.max(0, c.t - S.t));
    S.t = c.t;
    for (let k = 0; k < 3; k++) S.drift[k] += S.cur[k] * dt;
    for (let k = 0; k < 4; k++) S.sink[k] += MS_SINK[k] * dt;
    const B = st.box;
    st.phase = [...snowPhase(S.drift, S.origin, [B[0], B[1], B[2]]), 0];
    st.phaseN = [...snowPhase(S.drift, S.origin, [B[3], B[3], B[3]]), 0];
    st.sink = S.sink.map(s => posmod(-s, B[1])); st.sinkN = S.sink.map(s => posmod(-s, B[3]));
    st.eddyO = [...S.origin.map(v => posmod(v, MS_EDDY_PERIOD)), 0];
    st.cam = [c.eye[0], c.eye[1], c.eye[2], c.t];
    st.lens[0] = c.height * 0.5 / Math.tan(c.fovY * 0.5);
    st.viewport = [c.width, c.height, c.near, c.far];
    const dO = S.lastOrigin ? S.origin.map((v, k) => v - S.lastOrigin[k]) : [0, 0, 0];
    const jump = S.lastEye ? Math.hypot(c.eye[0] + dO[0] - S.lastEye[0], c.eye[1] + dO[1] - S.lastEye[1], c.eye[2] + dO[2] - S.lastEye[2]) : Infinity;
    const ok = jump < 3 && dt > 0;
    st.prevVP = ok ? mulTranslate(st.vp, dO) : Float32Array.from(c.vp);
    st.px[3] = ok ? 1 : 0;
    st.vp = Float32Array.from(c.vp); st.view = Float32Array.from(c.view);
    S.lastEye = c.eye.slice(0, 3); S.lastOrigin = S.origin.slice();
    device.queue.writeBuffer(ubuf, 0, packSnowUniforms(st, packed));
  }
  return {
    pipeline, atlas, count: N, state: st,
    update,
    draw(pass) { pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.setVertexBuffer(0, vbuf); pass.draw(6, drawCount); },
    setDepthView(view) { depthView = view || null; st.frag[0] = view ? 1 : 0; makeGroup(); },
    setDepth(depth) {
      const m = snowMix(depth);
      S.density = m.density; st.typeK = m.typeK.slice(); st.sizeK = m.sizeK.slice();
      st.tintA = [...m.tintA, st.tintA[3]]; st.tintB = [...m.tintB, st.tintB[3]];
      applyDensity();
    },
    setDensity(v) { S.user = Math.max(0, v); applyDensity(); },
    setCurrent(x, y, z) { S.cur = [x || 0, y || 0, z || 0]; },
    setOrigin(x, y, z) { S.origin = [x || 0, y || 0, z || 0]; },
    setExtinction(r, g, b) { st.ext = [r, g, b, 0]; },
    setExposure(e) { st.frag[3] = e; },
    setSun(dir, col, on = 1) { const l = Math.hypot(...dir) || 1; st.sun = [dir[0] / l, dir[1] / l, dir[2] / l, on]; st.sunC = [col[0], col[1], col[2], st.sunC[3]]; },
    // spots: [{ pos, dir (unit), color (radiance), cosOuter, cosInner, range }]
    setSpots(list) {
      const ls = (list || []).slice(0, 4);
      st.sunC[3] = ls.length;
      ls.forEach((l, i) => {
        st.spotP.set([...l.pos, l.range ?? 30], i * 4); st.spotD.set([...l.dir, l.cosOuter], i * 4);
        st.spotC.set([...l.color, l.cosInner], i * 4);
      });
    },
    destroy() { tex.destroy(); vbuf.destroy(); ubuf.destroy(); dummy.destroy(); },
  };
}
