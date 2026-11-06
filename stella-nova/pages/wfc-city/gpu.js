// ============================================================================
//  COLLAPSE CITY  ·  gpu.js — WebGPU device, pipelines, chunk buffers, light
// ----------------------------------------------------------------------------
//  Raw WebGPU (no three.js). main.js owns the camera and the world; this
//  module owns the GPU side. The import has no side effects, so node tests
//  can import it and drive createRenderer() with a stub device.
//
//  PASSES (one frame)
//    1. sun shadow map, depth32float, an ortho box that follows the camera
//       and snaps to whole texels (no shimmer)
//    2. main pass, 4x MSAA, depth32float with reversed depth (near 1, far 0):
//       the far ground plane, each visible chunk, then the sky at depth 0
//  At most 2 frames are in flight (queue.onSubmittedWorkDone). render()
//  returns false and draws nothing when 2 are queued. A governor cuts the
//  render scale when the GPU time stays high, and gives it back later.
//
//  CHUNKS. One vertex buffer for each chunk (cx, cz). uploadChunk() reuses
//  the buffer when it is large enough. A chunk is culled against the view
//  frustum and against the sun box. Vertex = 32 bytes (VERTEX_STRIDE).
//
//  GREP MAP
//    export const VERTEX_STRIDE / VERTEX_ATTRS   the contract layout
//    export const M4 ............................ mat4 helpers (column-major)
//    export function skyState ................... time of day -> light colours
//    export function glossOf .................... palette rgb -> gloss
//    export async function createRenderer ....... device, pipelines, API
//    function writeUniforms ..................... Frame layout (common.wgsl)
//    function render ............................ the frame
//    function govern ............................ the render scale governor
// ============================================================================

export const VERTEX_STRIDE = 32;
export const VERTEX_FLOATS = 8;
export const VERTEX_ATTRS = [
  { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position (m)
  { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
  { shaderLocation: 2, offset: 24, format: 'float32' },    // colour index
  { shaderLocation: 3, offset: 28, format: 'float32' },    // birth
];
export const UNIFORM_BYTES = 608;
export const GROUND_Y = -0.6;      // the far ground plane, under layer 0
const CELL = 2, CHUNK_M = 16;

// ---- mat4 (column-major, WebGPU clip z 0..1) -----------------------------------------
export const M4 = {
  ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  // reversed depth, infinite far: z_ndc = near / -z_view
  perspective(fovy, aspect, near) {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[11] = -1; m[14] = near;
    return m;
  },
  ortho(l, r, b, t, n, f) {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = 1 / (n - f);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = n / (n - f); m[15] = 1;
    return m;
  },
  lookAt(eye, at, up) {
    let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx; m[4] = xy; m[8] = xz;
    m[1] = yx; m[5] = yy; m[9] = yz;
    m[2] = zx; m[6] = zy; m[10] = zz;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    m[15] = 1;
    return m;
  },
  // view from an eye, a yaw (0 = look to -z) and a pitch (up positive)
  viewYawPitch(eye, yaw, pitch) {
    const cp = Math.cos(pitch);
    const f = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    return M4.lookAt(eye, [eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]], [0, 1, 0]);
  },
  invert(m) {
    const a = m, o = new Float32Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
    const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
    const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M4.ident();
    det = 1 / det;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  },
  // the side planes of a clip matrix: [nx, ny, nz, d] with n.p + d >= 0 inside
  sidePlanes(m) {
    const row = r => [m[r], m[4 + r], m[8 + r], m[12 + r]];
    const r0 = row(0), r1 = row(1), r3 = row(3);
    return [
      r3.map((v, n) => v + r0[n]), r3.map((v, n) => v - r0[n]),
      r3.map((v, n) => v + r1[n]), r3.map((v, n) => v - r1[n]),
    ];
  },
  boxVisible(planes, x0, y0, z0, x1, y1, z1) {
    for (const p of planes) {
      const x = p[0] >= 0 ? x1 : x0, y = p[1] >= 0 ? y1 : y0, z = p[2] >= 0 ? z1 : z0;
      if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
    }
    return true;
  },
};

// ---- time of day ---------------------------------------------------------------------
// hour 0..24 -> sun direction and the colours of the sky and the light (all
// linear). The keys are by sun elevation in degrees.
const SKY_KEYS = [
  // elev, sun rgb (x intensity), sky top, horizon, amb sky, amb ground, ground
  [-14, [0.30, 0.38, 0.62, 0.30], [0.006, 0.010, 0.030], [0.030, 0.042, 0.080], [0.050, 0.065, 0.120], [0.020, 0.020, 0.030], [0.025, 0.028, 0.035]],
  [-3, [0.90, 0.40, 0.30, 0.45], [0.040, 0.050, 0.120], [0.420, 0.230, 0.220], [0.120, 0.110, 0.170], [0.060, 0.045, 0.050], [0.070, 0.060, 0.060]],
  [4, [1.00, 0.52, 0.26, 1.80], [0.120, 0.180, 0.380], [1.000, 0.560, 0.330], [0.300, 0.300, 0.400], [0.180, 0.120, 0.080], [0.180, 0.140, 0.110]],
  [14, [1.00, 0.72, 0.46, 2.50], [0.160, 0.280, 0.560], [0.900, 0.700, 0.540], [0.380, 0.420, 0.560], [0.240, 0.180, 0.130], [0.250, 0.210, 0.170]],
  [32, [1.00, 0.88, 0.72, 2.70], [0.170, 0.340, 0.680], [0.620, 0.700, 0.780], [0.400, 0.480, 0.640], [0.260, 0.220, 0.180], [0.280, 0.250, 0.210]],
  [70, [1.00, 0.95, 0.86, 2.90], [0.150, 0.330, 0.700], [0.560, 0.680, 0.800], [0.400, 0.500, 0.680], [0.260, 0.230, 0.200], [0.280, 0.260, 0.230]],
];
export function skyState(hour) {
  hour = ((hour % 24) + 24) % 24;
  const elev = 64 * Math.sin((hour - 6) / 12 * Math.PI);      // deg
  const az = (hour / 24) * Math.PI * 2 + Math.PI * 0.15;
  let a = SKY_KEYS[0], b = SKY_KEYS[0], s = 0;
  if (elev <= SKY_KEYS[0][0]) { a = b = SKY_KEYS[0]; }
  else if (elev >= SKY_KEYS[SKY_KEYS.length - 1][0]) { a = b = SKY_KEYS[SKY_KEYS.length - 1]; }
  else for (let n = 0; n < SKY_KEYS.length - 1; n++) {
    if (elev >= SKY_KEYS[n][0] && elev <= SKY_KEYS[n + 1][0]) { a = SKY_KEYS[n]; b = SKY_KEYS[n + 1]; s = (elev - a[0]) / (b[0] - a[0]); break; }
  }
  const L = (x, y) => x.map((v, n) => v + (y[n] - v) * s);
  const sun = L(a[1], b[1]);
  const night = Math.min(1, Math.max(0, (-elev + 1) / 9));
  // under the horizon the key light is the moon, high in the other half
  let e = elev * Math.PI / 180, azl = az;
  if (elev < 2) { const m = Math.min(1, (2 - elev) / 8); e = e * (1 - m) + (0.75) * m; azl = az + Math.PI * m; }
  const dir = [Math.cos(e) * Math.sin(azl), Math.sin(Math.max(e, 0.06)), Math.cos(e) * Math.cos(azl)];
  const dl = Math.hypot(...dir);
  return {
    hour, elev, night,
    sunDir: dir.map(v => v / dl),
    sunColor: [sun[0] * sun[3], sun[1] * sun[3], sun[2] * sun[3]],
    skyTop: L(a[2], b[2]), skyHorizon: L(a[3], b[3]),
    ambSky: L(a[4], b[4]), ambGround: L(a[5], b[5]), ground: L(a[6], b[6]),
    disc: night > 0.5 ? 0.0012 : 0.0016,
    exposure: 0.95 + night * 0.95,
  };
}

// The page cannot know which palette index lane A gave to glass, so it
// reads the colour (linear rgb). The alpha of a palette entry in the uniform
// is: gloss 0..1, plus 2 for an emissive colour.
//   glass     dark (luminance < 0.05) and blue (b > 1.8 r)   gloss 0.9, lit
//                                                            windows at night
//   water     blue (b > g, b > 2.5 r), luminance 0.05..0.3   gloss 0.5
//   lamp      bright warm (r > 0.85, 0.3 < g < 0.85, b < 0.3) emissive
//   others    matte
export function materialOf(r, g, b) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (r > 0.85 && g > 0.3 && g < 0.85 && b < 0.3) return 2;
  if (lum < 0.05 && b > 1.8 * r && b >= g) return 0.9;
  if (b > g && b > 2.5 * r && lum >= 0.05 && lum < 0.3) return 0.5;
  return 0;
}
export const glossOf = (r, g, b) => { const m = materialOf(r, g, b); return m >= 2 ? 0 : m; };

// ---- the renderer -------------------------------------------------------------------
// opts: { phone, loadText(path) -> Promise<string>, onLost(info), height }
export async function createRenderer(canvas, opts = {}) {
  const gpu = (typeof navigator !== 'undefined' && navigator.gpu) || opts.gpu;
  if (!gpu) throw new Error('WebGPU is not available in this browser');
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  let dead = false;
  device.lost.then(info => { dead = true; if (opts.onLost) opts.onLost(info); });
  const ctx = canvas.getContext('webgpu');
  if (!ctx) throw new Error('no webgpu canvas context');
  const format = gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const phone = !!opts.phone;
  const loadText = opts.loadText || (p => fetch(new URL(p, import.meta.url)).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.text(); }));
  const [common, city, sky] = await Promise.all(['shaders/common.wgsl', 'shaders/city.wgsl', 'shaders/sky.wgsl'].map(loadText));
  const modCity = device.createShaderModule({ label: 'city', code: common + '\n' + city });
  const modSky = device.createShaderModule({ label: 'sky', code: common + '\n' + sky });

  const SAMPLES = 4, DEPTH = 'depth32float';
  const SHADOW = phone ? 1024 : 2048;
  const VIS = (typeof GPUShaderStage !== 'undefined') ? GPUShaderStage : { VERTEX: 1, FRAGMENT: 2 };
  const BU = (typeof GPUBufferUsage !== 'undefined') ? GPUBufferUsage : { VERTEX: 32, COPY_DST: 8, UNIFORM: 64 };
  const TU = (typeof GPUTextureUsage !== 'undefined') ? GPUTextureUsage : { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 };

  const bglMain = device.createBindGroupLayout({
    label: 'main', entries: [
      { binding: 0, visibility: VIS.VERTEX | VIS.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VIS.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: VIS.FRAGMENT, sampler: { type: 'comparison' } },
    ],
  });
  const bglShadow = device.createBindGroupLayout({
    label: 'shadow', entries: [{ binding: 0, visibility: VIS.VERTEX | VIS.FRAGMENT, buffer: { type: 'uniform' } }],
  });
  const vbuf = [{ arrayStride: VERTEX_STRIDE, attributes: VERTEX_ATTRS }];
  const pipeCity = device.createRenderPipeline({
    label: 'city', layout: device.createPipelineLayout({ bindGroupLayouts: [bglMain] }),
    vertex: { module: modCity, entryPoint: 'vs_city', buffers: vbuf },
    fragment: { module: modCity, entryPoint: 'fs_city', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: SAMPLES },
  });
  const pipeShadow = device.createRenderPipeline({
    label: 'shadow', layout: device.createPipelineLayout({ bindGroupLayouts: [bglShadow] }),
    vertex: { module: modCity, entryPoint: 'vs_shadow', buffers: vbuf },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.5, depthBiasClamp: 0.01 },
  });
  const pipeSky = device.createRenderPipeline({
    label: 'sky', layout: device.createPipelineLayout({ bindGroupLayouts: [bglShadow] }),
    vertex: { module: modSky, entryPoint: 'vs_sky' },
    fragment: { module: modSky, entryPoint: 'fs_sky', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater-equal' },
    multisample: { count: SAMPLES },
  });

  const ubuf = device.createBuffer({ label: 'frame', size: UNIFORM_BYTES, usage: BU.UNIFORM | BU.COPY_DST });
  const shadowTex = device.createTexture({ label: 'sun map', size: [SHADOW, SHADOW], format: DEPTH, usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
  const shadowView = shadowTex.createView();
  const cmp = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const bgMain = device.createBindGroup({ layout: bglMain, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: shadowView }, { binding: 2, resource: cmp }] });
  const bgShadow = device.createBindGroup({ layout: bglShadow, entries: [{ binding: 0, resource: { buffer: ubuf } }] });

  // the far ground: 6 vertices round the camera, colour index 16
  const groundBuf = device.createBuffer({ label: 'ground', size: 6 * VERTEX_STRIDE, usage: BU.VERTEX | BU.COPY_DST });
  const groundData = new Float32Array(6 * VERTEX_FLOATS);
  let groundAt = null;

  const U = new Float32Array(UNIFORM_BYTES / 4);
  const palette = new Float32Array(64);
  for (let n = 0; n < 16; n++) { palette[n * 4] = palette[n * 4 + 1] = palette[n * 4 + 2] = 0.5; }

  const chunks = new Map();     // "cx,cz" -> { cx, cz, buf, cap, count }
  let msaaTex = null, depthTex = null, msaaView = null, depthView = null, W = 0, Hh = 0;
  let inFlight = 0, gpuMs = 0, scale = 1, lastGovern = 0, slowRun = 0, fastRun = 0, frames = 0;
  const st = { draws: 0, verts: 0, shadowDraws: 0, chunks: 0, bytes: 0, skipped: 0 };

  function setPalette(rgb) {
    for (let n = 0; n < 16; n++) {
      const r = rgb[n * 3] ?? 0.5, g = rgb[n * 3 + 1] ?? 0.5, b = rgb[n * 3 + 2] ?? 0.5;
      palette[n * 4] = r; palette[n * 4 + 1] = g; palette[n * 4 + 2] = b; palette[n * 4 + 3] = materialOf(r, g, b);
    }
  }

  // w, h: CSS px; dpr: device pixel ratio
  function resize(w, h, dpr) {
    const cap = phone ? 2.4e6 : 4.6e6;
    let k = Math.min(dpr || 1, phone ? 2 : 2) * scale;
    if (w * h * k * k > cap) k = Math.sqrt(cap / (w * h));
    const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
    if (pw === W && ph === Hh && msaaTex) return false;
    W = pw; Hh = ph; canvas.width = pw; canvas.height = ph;
    if (msaaTex) msaaTex.destroy();
    if (depthTex) depthTex.destroy();
    msaaTex = device.createTexture({ size: [pw, ph], sampleCount: SAMPLES, format, usage: TU.RENDER_ATTACHMENT });
    depthTex = device.createTexture({ size: [pw, ph], sampleCount: SAMPLES, format: DEPTH, usage: TU.RENDER_ATTACHMENT });
    msaaView = msaaTex.createView(); depthView = depthTex.createView();
    return true;
  }

  function uploadChunk(cx, cz, data) {
    const key = cx + ',' + cz;
    if (!data || data.length < VERTEX_FLOATS * 3) { dropChunk(cx, cz); return; }
    const bytes = data.byteLength;
    let c = chunks.get(key);
    if (!c || c.cap < bytes) {
      if (c) { c.buf.destroy(); st.bytes -= c.cap; }
      const cap = Math.ceil(bytes * 1.25 / 256) * 256;
      c = { cx, cz, buf: device.createBuffer({ label: 'chunk ' + key, size: cap, usage: BU.VERTEX | BU.COPY_DST }), cap, count: 0 };
      st.bytes += cap;
      chunks.set(key, c);
    }
    device.queue.writeBuffer(c.buf, 0, data.buffer, data.byteOffset, bytes);
    c.count = Math.floor(data.length / VERTEX_FLOATS / 3) * 3;
  }
  function dropChunk(cx, cz) {
    const key = cx + ',' + cz, c = chunks.get(key);
    if (!c) return;
    c.buf.destroy(); st.bytes -= c.cap; chunks.delete(key);
  }
  function clearChunks() { for (const c of chunks.values()) c.buf.destroy(); chunks.clear(); st.bytes = 0; }

  // Frame layout: see common.wgsl. F is the frame state from main.js.
  function writeUniforms(F, lvp, texel) {
    U.set(F.viewProj, 0); U.set(lvp, 16); U.set(F.invViewProj, 32);
    const S = F.sky;
    U.set([F.eye[0], F.eye[1], F.eye[2], F.time || 0], 48);
    U.set([S.sunDir[0], S.sunDir[1], S.sunDir[2], S.night], 52);
    U.set([S.sunColor[0], S.sunColor[1], S.sunColor[2], F.shadows === false ? 0 : 1], 56);
    U.set([S.skyTop[0], S.skyTop[1], S.skyTop[2], S.disc], 60);
    const fc = F.focus || F.eye;
    U.set([S.skyHorizon[0], S.skyHorizon[1], S.skyHorizon[2], fc[0]], 64);
    U.set([S.ground[0], S.ground[1], S.ground[2], GROUND_Y], 68);
    U.set([S.ambSky[0], S.ambSky[1], S.ambSky[2], fc[2]], 72);
    U.set([S.ambGround[0], S.ambGround[1], S.ambGround[2], 0], 76);
    U.set([F.clock, Math.max(1, F.span), F.drop, texel], 80);
    U.set([F.fogStart, F.fogEnd, F.haze, S.exposure], 84);
    U.set(palette, 88);
    device.queue.writeBuffer(ubuf, 0, U.buffer, 0, UNIFORM_BYTES);
  }

  function groundUpdate(eye) {
    const s = 64, gx = Math.round(eye[0] / s) * s, gz = Math.round(eye[2] / s) * s;
    if (groundAt && groundAt[0] === gx && groundAt[1] === gz) return;
    groundAt = [gx, gz];
    const R = 6000, y = GROUND_Y;
    const P = [[gx - R, gz - R], [gx - R, gz + R], [gx + R, gz + R], [gx - R, gz - R], [gx + R, gz + R], [gx + R, gz - R]];
    P.forEach((p, n) => groundData.set([p[0], y, p[1], 0, 1, 0, 16, -1e9], n * VERTEX_FLOATS));
    device.queue.writeBuffer(groundBuf, 0, groundData.buffer, 0, groundData.byteLength);
  }

  // The sun box: centre on the ground ahead of the eye, half size S (m).
  function lightMatrix(F) {
    const S = Math.max(30, Math.min(F.shadowHalf || 80, 140));
    const L = F.sky.sunDir, c = F.shadowCentre || F.eye, D = 250;
    const up = Math.abs(L[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    const view = M4.lookAt([c[0] + L[0] * D, c[1] + L[1] * D, c[2] + L[2] * D], c, up);
    const lvp = M4.mul(M4.ortho(-S, S, -S, S, 1, D * 2), view);
    // snap to whole texels: move the world origin onto a texel centre
    const half = SHADOW / 2;
    const ox = lvp[12] * half, oy = lvp[13] * half;
    lvp[12] += (Math.round(ox) - ox) / half; lvp[13] += (Math.round(oy) - oy) / half;
    return { lvp, texel: (2 * S) / SHADOW };
  }

  // F = { viewProj, invViewProj, eye, focus, sky, clock, span, drop,
  //       fogStart, fogEnd (m from the focus, on the ground), haze, time,
  //       shadowCentre, shadowHalf, worldH (m), shadows }
  function render(F) {
    if (dead) return false;
    if (inFlight >= 2) { st.skipped++; return false; }
    if (!msaaTex) return false;
    groundUpdate(F.eye);
    const { lvp, texel } = lightMatrix(F);
    writeUniforms(F, lvp, texel);
    const top = (F.worldH || 24) + (F.drop || 0) * 1.4 + 4;
    const vp = M4.sidePlanes(F.viewProj), lp = M4.sidePlanes(lvp);
    st.draws = 0; st.verts = 0; st.shadowDraws = 0; st.chunks = chunks.size;

    const enc = device.createCommandEncoder({ label: 'frame' });
    if (F.shadows !== false) {
      const sp = enc.beginRenderPass({
        label: 'sun', colorAttachments: [],
        depthStencilAttachment: { view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      sp.setPipeline(pipeShadow); sp.setBindGroup(0, bgShadow);
      for (const c of chunks.values()) {
        const x0 = c.cx * CHUNK_M, z0 = c.cz * CHUNK_M;
        if (!M4.boxVisible(lp, x0, -1, z0, x0 + CHUNK_M, top, z0 + CHUNK_M)) continue;
        sp.setVertexBuffer(0, c.buf); sp.draw(c.count); st.shadowDraws++;
      }
      sp.end();
    }
    const tex = ctx.getCurrentTexture();
    const mp = enc.beginRenderPass({
      label: 'main',
      colorAttachments: [{ view: msaaView, resolveTarget: tex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    mp.setPipeline(pipeCity); mp.setBindGroup(0, bgMain);
    for (const c of chunks.values()) {
      const x0 = c.cx * CHUNK_M, z0 = c.cz * CHUNK_M;
      if (!M4.boxVisible(vp, x0, -1, z0, x0 + CHUNK_M, top, z0 + CHUNK_M)) continue;
      mp.setVertexBuffer(0, c.buf); mp.draw(c.count); st.draws++; st.verts += c.count;
    }
    mp.setVertexBuffer(0, groundBuf); mp.draw(6);
    mp.setPipeline(pipeSky); mp.setBindGroup(0, bgShadow); mp.draw(3);
    mp.end();
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    device.queue.submit([enc.finish()]);
    inFlight++;
    frames++;
    const done = device.queue.onSubmittedWorkDone ? device.queue.onSubmittedWorkDone() : Promise.resolve();
    done.then(() => {
      inFlight = Math.max(0, inFlight - 1);
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      gpuMs = gpuMs ? gpuMs * 0.9 + ms * 0.1 : ms;
    }, () => { inFlight = Math.max(0, inFlight - 1); });
    return true;
  }

  // The governor reads the time from submit to "work done". That time also
  // holds the wait for the display, so it reacts only to long runs: 40
  // frames over 30 ms cut the scale, 240 frames under 12 ms give it back.
  // frameMs is the wall time of a frame, a check on the GPU figure.
  function govern(frameMs) {
    const now = frames;
    if (now === lastGovern) return false;
    lastGovern = now;
    const heavy = gpuMs > 30 && frameMs > 26;
    if (heavy) { slowRun++; fastRun = 0; } else if (gpuMs < 12) { fastRun++; slowRun = 0; } else { slowRun = Math.max(0, slowRun - 1); }
    if (slowRun > 40 && scale > 0.55) { scale = Math.max(0.55, scale * 0.85); slowRun = 0; W = 0; return true; }
    if (fastRun > 240 && scale < 1) { scale = Math.min(1, scale / 0.85); fastRun = 0; W = 0; return true; }
    return false;
  }

  function destroy() {
    dead = true;
    clearChunks();
    for (const t of [msaaTex, depthTex, shadowTex]) if (t) t.destroy();
    ubuf.destroy(); groundBuf.destroy();
    try { ctx.unconfigure(); } catch (e) { /* old browser */ }
    try { device.destroy(); } catch (e) { /* lost */ }
  }

  return {
    device, format, resize, setPalette, uploadChunk, dropChunk, clearChunks, render, govern, destroy,
    get chunkCount() { return chunks.size; },
    get gpuMs() { return gpuMs; },
    get scale() { return scale; },
    get inFlight() { return inFlight; },
    get lost() { return dead; },
    stats: st,
    hasChunk: (cx, cz) => chunks.has(cx + ',' + cz),
    size: () => [W, Hh],
  };
}
