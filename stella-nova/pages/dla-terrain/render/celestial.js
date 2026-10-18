// ============================================================================
//  DLA TERRAIN  ·  render/celestial.js — the GPU layer of the night sky
//  (package CELESTIAL): the real starfield, the Milky Way, the moons and the
//  gas giant. Raw WebGPU, no DOM. render/sky.js makes it (one hook).
// ----------------------------------------------------------------------------
//  createCelestialLayer(gpu, sky) -> layer
//    sky = { layout, bindGroup (SKY's group 1 L.shaft / BG.shaft),
//            loadText(file) -> the WGSL after the SKY library }
//    layer.update(frame)  fills CelU from frame.celestial (main.js:
//                         world/celestial-gen.js createCelestial().at()),
//                         loads the maps of a new system
//    layer.draw(pass)     after fsSky in CORE's opaque pass: pass 1 (the
//                         Milky Way and the bodies, premultiplied), pass 2
//                         (the stars, additive)
//    layer.ready          true when the stars and the Milky Way are in;
//                         render/sky.js then sets S.cel.x = 1 and fsSky
//                         leaves out its own stars and moon
//    layer.stats()        { stars, bodies, bytes, maps }
//  ASSETS  assets/sky/ (sky-maps.json, CREDITS.txt): the Yale Bright Star
//    Catalogue (stars.bin), NASA SVS Deep Star Maps 2020 (the Milky Way),
//    NASA SVS CGI Moon Kit (LRO), NASA 3D Resources (moons, Jupiter-class
//    maps), NASA/JPL/SSI Cassini PIA07782 (Jupiter), Solar System Scope
//    (Saturn, Uranus, Neptune, the Saturn rings; CC BY 4.0).
//  BUDGET  fixed textures, made once (no growth when the system changes):
//    desktop  Milky Way 2048 x 1024, moons 4 x 1024 x 512, giant
//             2048 x 1024, ring 1024 x 4, all with mips: about 26 MB
//    phone    1024 x 512, 4 x 512 x 256, 1024 x 512: about 6.6 MB
//    stars    9096 x 32 B storage (0.29 MB). CelU 37 vec4.
//  DENO  gpu.celestialImageLoader (or globalThis.__celestialImageLoader)
//    (url, w, h) -> { data (RGBA8), width, height } replaces fetch +
//    createImageBitmap (tools only; Deno cannot decode webp).
//
//  grep -n targets: "export const STAR_E0", "export function psfSum",
//  "export function mapSizes", "export function celestialBytes",
//  "export async function createCelestialLayer", "function loadMaps",
//  "function fillUniform", "draw(pass"
// ============================================================================
import { createCelestial, parseStars, starColor, MAX_BODIES } from '../world/celestial-gen.js';

// a magnitude 0 star: HDR irradiance. With sigma 0.8 px and a pixel of
// 1.1e-3 rad (a 50 deg view on 800 px) its peak is 1.5 (Sirius 5.8).
export const STAR_E0 = 6.8e-6;
export const STAR_SIGMA_PX = 1.05;   // PSF sigma floor in pixels (no aliasing)
export const MILKY_K = 0.006;        // Milky Way radiance of map value 1 (the 99.99th percentile)
export const DISC_K = 5.0;           // body radiance per albedo: a full Moon (p 0.12) is 0.6
export const SHINE_K = 20;           // earthshine gain (the eye adapts; the true ratio is 1e-4)
export const CEL_FLOATS = 37 * 4;    // struct CelU
export const PSF_RK = Math.sqrt(12);   // kernel radius / sigma: (1 - r^2 / R^2)^6

const U = (typeof GPUBufferUsage !== 'undefined') ? GPUBufferUsage : { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 };
const T = (typeof GPUTextureUsage !== 'undefined') ? GPUTextureUsage : { COPY_SRC: 1, TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
const SS = (typeof GPUShaderStage !== 'undefined') ? GPUShaderStage : { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

// The JS twin of fsStar: the sum of the PSF over the pixel grid for a star
// at sub-pixel offset (ox, oy), times the normalisation. 1 = all the flux.
export function psfSum(ox, oy, sig = STAR_SIGMA_PX) {
  const R = sig * PSF_RK, K = Math.ceil(R) + 1;
  let s = 0;
  for (let y = -K; y <= K; y++) for (let x = -K; x <= K; x++) {
    const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
    const u = Math.max(1 - (dx * dx + dy * dy) / (R * R), 0);
    s += u ** 6;
  }
  return s / (Math.PI / 7 * R * R);
}

export function mapSizes(profileId) {
  const phone = /^phone/.test(profileId || '');
  return phone
    ? { milky: [1024, 512], moon: [512, 256], giant: [1024, 512], ring: [1024, 4], tag: 'p', milkyFile: '1k' }
    : { milky: [2048, 1024], moon: [1024, 512], giant: [2048, 1024], ring: [1024, 4], tag: 'd', milkyFile: '2k' };
}
const mips = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;
const texBytes = (w, h, layers = 1) => { let b = 0; for (let l = 0; l < mips(w, h); l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * 4; return b * layers; };
export function celestialBytes(profileId, stars = 9096) {
  const s = mapSizes(profileId);
  return texBytes(...s.milky) + texBytes(...s.moon, 4) + texBytes(...s.giant) + texBytes(...s.ring) + stars * 32 + CEL_FLOATS * 4;
}

// star records -> Float32Array of 2 vec4 per star (see celestial.wgsl)
export function starBuffer(cat) {
  const f = new Float32Array(cat.n * 8);
  for (let i = 0; i < cat.n; i++) {
    const cd = Math.cos(cat.dec[i]);
    f[i * 8] = cd * Math.cos(cat.ra[i]); f[i * 8 + 1] = cd * Math.sin(cat.ra[i]); f[i * 8 + 2] = Math.sin(cat.dec[i]);
    f[i * 8 + 3] = Math.pow(10, -0.4 * cat.mag[i]);
    const c = starColor(cat.bv[i], 0.85).rgb;
    f[i * 8 + 4] = c[0]; f[i * 8 + 5] = c[1]; f[i * 8 + 6] = c[2];
    f[i * 8 + 7] = ((cat.hr[i] * 0.6180339887) % 1);
  }
  return f;
}

export async function createCelestialLayer(gpu, sky) {
  const { device, queue } = gpu;
  const base = new URL('../assets/sky/', import.meta.url);
  const sz = mapSizes(gpu.profileId);
  const st = { ready: false, sysKey: null, loading: null, maps: null, bodies: 0, frame: 0, own: null, error: null };
  const u = new Float32Array(CEL_FLOATS);
  const ubo = device.createBuffer({ label: 'CelU', size: CEL_FLOATS * 4, usage: U.UNIFORM | U.COPY_DST });
  const mk = (label, [w, h], layers, format) => device.createTexture({
    label, size: [w, h, layers], format, mipLevelCount: mips(w, h),
    usage: T.TEXTURE_BINDING | T.COPY_DST | T.RENDER_ATTACHMENT,
  });
  const tex = {
    milky: mk('celestial milky way', sz.milky, 1, 'rgba8unorm'),
    moons: mk('celestial moons', sz.moon, 4, 'rgba8unorm-srgb'),
    giant: mk('celestial giant', sz.giant, 1, 'rgba8unorm-srgb'),
    ring: mk('celestial ring', sz.ring, 1, 'rgba8unorm-srgb'),
  };
  const sampler = device.createSampler({ label: 'celestial', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge', maxAnisotropy: 1 });
  let starBuf = device.createBuffer({ label: 'celestial stars', size: 16 * 2 * 9096, usage: U.STORAGE | U.COPY_DST });
  let nStars = 0;

  const vis = SS.VERTEX | SS.FRAGMENT;
  const layout = device.createBindGroupLayout({
    label: 'celestial g2', entries: [
      { binding: 0, visibility: vis, buffer: { type: 'uniform' } },
      { binding: 1, visibility: SS.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: SS.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 5, visibility: SS.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 6, visibility: SS.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const makeGroup = () => device.createBindGroup({
    label: 'celestial g2', layout, entries: [
      { binding: 0, resource: { buffer: ubo } },
      { binding: 1, resource: { buffer: starBuf } },
      { binding: 2, resource: tex.milky.createView() },
      { binding: 3, resource: tex.moons.createView({ dimension: '2d-array' }) },
      { binding: 4, resource: tex.giant.createView() },
      { binding: 5, resource: tex.ring.createView() },
      { binding: 6, resource: sampler },
    ],
  });
  let group = makeGroup();

  const code = await sky.loadText('shaders/celestial.wgsl');
  const module = device.createShaderModule({ label: 'celestial.wgsl', code });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, sky.layout, layout] });
  const depth = { format: gpu.depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' };
  const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
  const additive = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
  const [pBg, pStar] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'celestial bodies', layout: pl,
      vertex: { module, entryPoint: 'vsCelBg' },
      fragment: { module, entryPoint: 'fsCelBg', targets: [{ format: gpu.hdrFormat, blend: premul }] },
      primitive: { topology: 'triangle-list' }, depthStencil: depth,
    }),
    device.createRenderPipelineAsync({
      label: 'celestial stars', layout: pl,
      vertex: { module, entryPoint: 'vsStar' },
      fragment: { module, entryPoint: 'fsStar', targets: [{ format: gpu.hdrFormat, blend: additive }] },
      primitive: { topology: 'triangle-strip' }, depthStencil: depth,
    }),
  ]);

  // ── image loading ─────────────────────────────────────────────────────────
  // One image into one layer of a texture, with every mip level.
  async function upload(texture, url, [w, h], layer = 0) {
    const levels = mips(w, h);
    const loader = gpu.celestialImageLoader || globalThis.__celestialImageLoader;
    if (loader) {
      let img = await loader(url, w, h);
      let data = img.data, cw = img.width, ch = img.height;
      for (let l = 0; l < levels; l++) {
        queue.writeTexture({ texture, mipLevel: l, origin: [0, 0, layer] }, data, { bytesPerRow: cw * 4, rowsPerImage: ch }, [cw, ch, 1]);
        if (l === levels - 1) break;
        const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1), nd = new Uint8Array(nw * nh * 4);
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
          const x0 = Math.min(cw - 1, 2 * x), x1 = Math.min(cw - 1, 2 * x + 1), y0 = Math.min(ch - 1, 2 * y), y1 = Math.min(ch - 1, 2 * y + 1);
          nd[(y * nw + x) * 4 + c] = (data[(y0 * cw + x0) * 4 + c] + data[(y0 * cw + x1) * 4 + c] + data[(y1 * cw + x0) * 4 + c] + data[(y1 * cw + x1) * 4 + c] + 2) >> 2;
        }
        data = nd; cw = nw; ch = nh;
      }
      return;
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error('celestial: cannot load ' + url);
    const blob = await r.blob();
    for (let l = 0; l < levels; l++) {
      const lw = Math.max(1, w >> l), lh = Math.max(1, h >> l);
      const bmp = await createImageBitmap(blob, { resizeWidth: lw, resizeHeight: lh, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      queue.copyExternalImageToTexture({ source: bmp }, { texture, mipLevel: l, origin: [0, 0, layer] }, [lw, lh, 1]);
      if (bmp.close) bmp.close();
    }
  }

  async function loadBase() {
    const [mr, sr] = await Promise.all([fetch(new URL('sky-maps.json', base)), fetch(new URL('stars.bin', base))]);
    if (!mr.ok || !sr.ok) throw new Error('celestial: no assets/sky');
    st.maps = await mr.json();
    const cat = parseStars(new Uint8Array(await sr.arrayBuffer()));
    const f = starBuffer(cat);
    nStars = Math.min(cat.n, 9096);
    queue.writeBuffer(starBuf, 0, f, 0, nStars * 8);
    await upload(tex.milky, new URL(st.maps.milkyway.files[sz.milkyFile], base).href, sz.milky);
    st.ready = true;
  }
  st.loading = loadBase().catch((e) => { st.error = e.message || String(e); });

  // The maps of a system: the moons into layers 0..3, the giant, the ring.
  // The layer of each body is kept in st.layer (by body id).
  st.layer = new Map();
  async function loadMaps(sys) {
    const key = sys.seed + ':' + sys.mode;
    st.sysKey = key;
    const maps = st.maps.maps;
    const jobs = [];
    let li = 0;
    st.layer.clear();
    for (const b of sys.bodies) {
      if (b.kind === 'giant') {
        st.layer.set(b.id, 9);
        jobs.push(upload(tex.giant, new URL(maps[b.map].files[sz.tag], base).href, sz.giant));
        if (b.ring) jobs.push(upload(tex.ring, new URL(maps.ring.files[sz.tag], base).href, sz.ring));
      } else if (li < 4) {
        st.layer.set(b.id, -1);
        const layer = li++;
        jobs.push(upload(tex.moons, new URL(maps[b.map].files[sz.tag], base).href, sz.moon, layer).then(() => { if (st.sysKey === key) st.layer.set(b.id, layer); }));
      }
    }
    const giant = sys.bodies.find((b) => b.kind === 'giant');
    await Promise.all(jobs);
    if (giant && st.sysKey === key) st.layer.set(giant.id, 9);
  }

  // ── the uniform ─────────────────────────────────────────────────────────────
  function fillUniform(frame, cel) {
    u.fill(0);
    const M = cel.M;
    // rows of M (equatorial -> world); the shader takes the transpose too
    u.set([M[0], M[1], M[2], 0, M[3], M[4], M[5], 0, M[6], M[7], M[8], 0], 0);
    const g = frame.globals;
    const sunY = g ? g[85] : -1;
    const night = smooth(0.06, -0.16, sunY);
    const k = frame.nightSky ?? 1;
    const clock = st.clock = (st.clock || 0) + clamp(Number.isFinite(frame.dt) ? frame.dt : 1 / 60, 0, 0.1);
    u.set([STAR_E0 * k * night, STAR_SIGMA_PX, clock % 3600, nStars], 12);
    u.set([MILKY_K * k, frame.lightPollution || 0, night, DISC_K], 16);
    // bodies, nearest first
    const list = cel.bodies.slice(0, MAX_BODIES).sort((a, b) => a.dist - b.dist);
    let gi = -1;
    const maps = st.maps ? st.maps.maps : {};
    list.forEach((o, i) => {
      const off = 24 + i * 24, b = o.body;
      const layer = st.layer.has(o.id) ? st.layer.get(o.id) : -1;
      if (o.kind === 'giant') gi = i;
      u.set([o.dir[0], o.dir[1], o.dir[2], o.dist / 1000], off);
      u.set([o.pole[0], o.pole[1], o.pole[2], o.R / 1000], off + 4);
      u.set([o.prime[0], o.prime[1], o.prime[2], layer], off + 8);
      const m = (maps[o.map] && maps[o.map].meanLinear) || [0.3, 0.3, 0.3];
      const ml = 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] || 0.3;
      const t = b.tint || [1, 1, 1];
      u.set([t[0] * b.p / ml, t[1] * b.p / ml, t[2] * b.p / ml, b.sat ?? 1], off + 12);
      const ring = o.ring;
      u.set([Math.min(o.shine * SHINE_K, 0.25), ring ? ring.inner : 0, ring ? ring.outer : 0, ring ? ring.opacity : 0], off + 16);
      u.set([o.reach, b.law === 'giant' ? 1 : 0, 0, 0], off + 20);
    });
    u.set([list.length, gi, sz.moon[0], sz.giant[0]], 20);
    queue.writeBuffer(ubo, 0, u);
  }

  const layer = {
    get ready() { return st.ready; },
    get error() { return st.error; },
    loaded: () => st.loading,
    update(frame) {
      if (!st.ready) return;
      let cel = frame.celestial;
      if (!cel) {
        // no state from main.js: a sky of seed 1 from the sky state
        const w = frame.weather || {};
        st.own = st.own || createCelestial(1, 'random');
        cel = st.own.at(w.tod ?? frame.tod ?? 0.5, w.season ?? 0.3, w.latitude ?? 46);
      }
      const sys = cel.system;
      if (sys && st.sysKey !== sys.seed + ':' + sys.mode) {
        st.sysKey = sys.seed + ':' + sys.mode;
        loadMaps(sys).catch((e) => { st.error = e.message || String(e); });
      }
      fillUniform(frame, cel);
      st.bodies = Math.min(cel.bodies.length, MAX_BODIES);
      st.frame++;
    },
    draw(pass) {
      if (!st.ready || !st.frame) return;
      pass.setBindGroup(2, group);
      pass.setPipeline(pBg);
      pass.draw(3);
      if (nStars > 0) { pass.setPipeline(pStar); pass.draw(4, nStars); }
    },
    stats: () => ({ stars: nStars, bodies: st.bodies, bytes: celestialBytes(gpu.profileId, nStars), maps: [...st.layer.entries()], error: st.error }),
    dispose() {
      for (const k in tex) tex[k].destroy();
      ubo.destroy(); starBuf.destroy();
    },
  };
  return layer;
}
