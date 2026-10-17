// ============================================================================
//  DLA TERRAIN  ·  render/ground.js — the terrain surface (GROUND package)
// ----------------------------------------------------------------------------
//  createGround(gpu) -> module (CONTRACT.md "Module interface").
//
//  MESH  CDLOD (Strugar 2010, "Continuous Distance-Dependent Level of Detail
//  for Rendering Heightmaps"). One quadtree over the whole world. Each frame
//  update() selects nodes by distance spheres: a node of level i is drawn
//  where it is inside range r[i] and out of r[i-1]. A node that is partly
//  inside r[i-1] recurses; a child quadrant that the finer level does not
//  take is drawn at the parent resolution (a half grid). All patches share
//  one index buffer per grid size; the vertex shader (ground.wgsl fn vs)
//  morphs the odd vertices onto the even ones as the camera distance goes
//  from morph start to morph end. Morph start of level i is past the far
//  edge of any level i-1 node (r[i-1] + 1.6 node size), so at a level seam
//  the fine side is fully morphed and the coarse side is not morphed: no
//  cracks and no T-junctions. tests/ground.test.mjs checks this on random
//  cameras with the JS twin of the vertex shader (morphVertex).
//  Node height bounds come from a min / max pyramid of Terrain.height plus a
//  pad for detailHeight. Frustum culling uses the planes of G.viewProj.
//  The shadow pass draws its own node list (no frustum cull, ranges at
//  0.55 of the view ranges, within the shadow distance): coarser, and
//  crack-free by the same rule.
//
//  MATERIAL  shaders/ground.wgsl. ASSETS ground textures, when the
//  manifest lists them, load into three texture arrays (albedo, normal,
//  ORM) with mips; until then the procedural layers draw alone.
//
//  Shadows: CORE owns the cascaded map (gpu/shadows.js) and sets group 2
//  on the pass: gpu.shadowSampleLayout for drawOpaque (common.wgsl fn
//  sunShadow), gpu.shadowPassLayout (SP, one cascade) for drawShadow. The
//  height-field march in ground.wgsl adds long ridge shadows past the
//  cascades.
//
//  grep -n targets: "export function lodConfig", "export function buildMinMax",
//  "export function nodeBounds", "export function frustumPlanes",
//  "export function selectNodes", "export function morphVertex",
//  "export function gridIndices", "export function matchGroundTextures",
//  "export async function createGround", "drawOpaque", "drawShadow"
// ============================================================================

const INST_FLOATS = 8;          // a: x0, z0, size, N; b: morph start, morph end, level, 0
const MAX_INST = 6144;
export const LAYERS = ['rock', 'cliff', 'grass', 'forest floor', 'sand', 'snow', 'mud', 'gravel'];
const LAYER_RES = 1024;

// ------------------------------------------------------------ LOD config --

// LOD set-up for a world. quality 0..1 sets the patch grid, the leaf
// spacing and the range factor.
export function lodConfig(worldSize, quality = 1, coarse = false, rangeScale = 1) {
  const q = Math.max(0, Math.min(1, quality));
  const N = q >= 0.45 ? 32 : 16;
  const spacing = q >= 0.8 ? 0.5 : q >= 0.45 ? 1.0 : 2.0;
  const want = Math.max(N * spacing, 4);
  const levels = Math.max(1, Math.min(14, Math.round(Math.log2(worldSize / want)) + 1));
  const leaf = worldSize / Math.pow(2, levels - 1);
  const rangeK = Math.max(2.2, (q >= 0.45 ? 4.0 : 3.4) * (coarse ? 0.9 : 1) * rangeScale);
  const ranges = [];
  const mStart = [];
  const mEnd = [];
  for (let i = 0; i < levels; i++) {
    const size = leaf * Math.pow(2, i);
    ranges.push(rangeK * size);
  }
  ranges[levels - 1] = Infinity;
  for (let i = 0; i < levels; i++) {
    const size = leaf * Math.pow(2, i);
    const r = ranges[i];
    const prev = i === 0 ? 0 : ranges[i - 1] + 1.6 * (size / 2);
    const end = Number.isFinite(r) ? r * 0.96 : 1e12;
    const start = i === 0 ? end * 0.6 : Math.min(prev, end - 1);
    mStart.push(start);
    mEnd.push(end);
  }
  return { N, leaf, levels, ranges, mStart, mEnd, worldSize };
}

// --------------------------------------------------------- height bounds --

// Min / max pyramid of an n x n height grid: level k holds cells of 2^k
// texels (min, max interleaved).
export function buildMinMax(height, n) {
  const levels = [];
  let w = n;
  let cur = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) { cur[2 * i] = height[i]; cur[2 * i + 1] = height[i]; }
  levels.push({ w, data: cur });
  while (w > 1) {
    const nw = Math.ceil(w / 2);
    const nx = new Float32Array(nw * nw * 2);
    for (let y = 0; y < nw; y++) {
      for (let x = 0; x < nw; x++) {
        let lo = Infinity, hi = -Infinity;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(2 * x + dx, w - 1), sy = Math.min(2 * y + dy, w - 1);
            const k = 2 * (sy * w + sx);
            if (cur[k] < lo) lo = cur[k];
            if (cur[k + 1] > hi) hi = cur[k + 1];
          }
        }
        nx[2 * (y * nw + x)] = lo;
        nx[2 * (y * nw + x) + 1] = hi;
      }
    }
    levels.push({ w: nw, data: nx });
    cur = nx;
    w = nw;
  }
  return { n, levels };
}

// Height range over the world rect [x0, x0 + size] x [z0, z0 + size].
export function nodeBounds(mm, origin, worldSize, x0, z0, size, out) {
  if (!mm) { out[0] = -1e4; out[1] = 1e4; return out; }
  if (mm.bounds) return mm.bounds(origin, worldSize, x0, z0, size, out);
  const n = mm.n;
  const tex = worldSize / n;
  const tx0 = Math.floor((x0 - origin) / tex - 1), tz0 = Math.floor((z0 - origin) / tex - 1);
  const tx1 = Math.ceil((x0 + size - origin) / tex + 1), tz1 = Math.ceil((z0 + size - origin) / tex + 1);
  const span = Math.max(tx1 - tx0, tz1 - tz0, 1);
  const k = Math.min(mm.levels.length - 1, Math.max(0, Math.ceil(Math.log2(span)) - 1));
  const L = mm.levels[k];
  const c = 1 << k;
  const cx0 = Math.max(0, Math.floor(tx0 / c)), cz0 = Math.max(0, Math.floor(tz0 / c));
  const cx1 = Math.min(L.w - 1, Math.floor(tx1 / c)), cz1 = Math.min(L.w - 1, Math.floor(tz1 / c));
  let lo = Infinity, hi = -Infinity;
  for (let z = cz0; z <= cz1; z++) {
    for (let x = cx0; x <= cx1; x++) {
      const i = 2 * (z * L.w + x);
      if (L.data[i] < lo) lo = L.data[i];
      if (L.data[i + 1] > hi) hi = L.data[i + 1];
    }
  }
  if (lo === Infinity) { lo = 0; hi = 0; }
  out[0] = lo; out[1] = hi;
  return out;
}

// ---------------------------------------------------------------- frustum --

// Side and near planes of a column-major view-projection (WebGPU clip,
// reverse-Z, infinite far: no far plane). Each plane: a, b, c, d with
// a x + b y + c z + d >= 0 inside.
export function frustumPlanes(m) {
  const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a, b, s) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]];
  const planes = [add(r3, r0, 1), add(r3, r0, -1), add(r3, r1, 1), add(r3, r1, -1), add(r3, r2, -1)];
  for (const p of planes) {
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    p[0] /= l; p[1] /= l; p[2] /= l; p[3] /= l;
  }
  return planes;
}

function boxInFrustum(planes, x0, y0, z0, x1, y1, z1) {
  for (const p of planes) {
    const x = p[0] >= 0 ? x1 : x0, y = p[1] >= 0 ? y1 : y0, z = p[2] >= 0 ? z1 : z0;
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}

// LOD distance: horizontal distance, plus the camera height over the top
// of the terrain (one constant per frame). ground.wgsl uses the same
// metric, so the distance of any vertex of a node is at most the node
// distance + its diagonal, and the seam rule of lodConfig holds for any
// relief (a full 3D distance broke it on tall nodes).
export function lodDistance(cam, hTop, x, z) {
  const dy = Math.max(cam[1] - hTop, 0);
  return Math.sqrt((cam[0] - x) ** 2 + (cam[2] - z) ** 2 + dy * dy);
}
function rectSphere(cam, hTop, r, x0, z0, x1, z1) {
  const dx = Math.max(x0 - cam[0], 0, cam[0] - x1);
  const dz = Math.max(z0 - cam[2], 0, cam[2] - z1);
  const dy = Math.max(cam[1] - hTop, 0);
  return dx * dx + dy * dy + dz * dz <= r * r;
}

// ------------------------------------------------------------- selection --

// CDLOD selection. opts: { cfg, cam [x, y, z], origin, mm (minmax), pad,
// hTop (top of the terrain, m), planes (or null: no cull), maxRange,
// out (Float32Array), max }. Returns { count, full, half } where the
// instances in out are sorted: full grids first (count full), then half
// grids (count half).
export function selectNodes(o) {
  const { cfg, cam, origin, mm, pad = 12, planes = null, maxRange = Infinity } = o;
  const hTop = o.hTop ?? (mm ? mm.levels[mm.levels.length - 1].data[1] + pad : 0);
  const full = [];
  const half = [];
  const b = [0, 0];
  const top = cfg.levels - 1;
  const R = (lvl) => cfg.ranges[lvl];
  const emit = (list, x0, z0, size, lvl, N) => {
    list.push(x0, z0, size, N, cfg.mStart[lvl], cfg.mEnd[lvl], lvl, 0);
  };
  const visible = (x0, z0, size, lo, hi) => {
    if (!planes) return true;
    return boxInFrustum(planes, x0, lo, z0, x0 + size, hi, z0 + size);
  };
  const select = (x0, z0, size, lvl) => {
    nodeBounds(mm, origin, cfg.worldSize, x0, z0, size, b);
    const lo = b[0] - pad, hi = b[1] + pad;
    const near = (r) => rectSphere(cam, hTop, r, x0, z0, x0 + size, z0 + size);
    if (lvl < top && !near(R(lvl))) return false;
    if (!rectSphere(cam, hTop, maxRange, x0, z0, x0 + size, z0 + size)) return true;
    if (!visible(x0, z0, size, lo, hi)) return true;
    if (lvl === 0 || !near(R(lvl - 1))) { emit(full, x0, z0, size, lvl, cfg.N); return true; }
    const h = size / 2;
    for (let c = 0; c < 4; c++) {
      const cx = x0 + (c & 1) * h, cz = z0 + (c >> 1) * h;
      if (!select(cx, cz, h, lvl - 1)) {
        nodeBounds(mm, origin, cfg.worldSize, cx, cz, h, b);
        if (visible(cx, cz, h, b[0] - pad, b[1] + pad)) emit(half, cx, cz, h, lvl, cfg.N / 2);
      }
    }
    return true;
  };
  select(origin, origin, cfg.worldSize, top);
  const max = o.max ?? MAX_INST;
  const nf = Math.min(full.length / INST_FLOATS, max);
  const nh = Math.min(half.length / INST_FLOATS, max - nf);
  const out = o.out && o.out.length >= (nf + nh) * INST_FLOATS ? o.out : new Float32Array((nf + nh) * INST_FLOATS);
  out.set(full.slice(0, nf * INST_FLOATS), 0);
  out.set(half.slice(0, nh * INST_FLOATS), nf * INST_FLOATS);
  return { count: nf + nh, full: nf, half: nh, out };
}

// JS twin of ground.wgsl fn cdlodVertex: grid vertex (gx, gz) of instance
// inst (8 floats) -> [x, z, k]. hTop: the top of the terrain (U.misc.z).
export function morphVertex(gx, gz, inst, cam, hTop, worldMin, worldMax) {
  const N = inst[3];
  const sp = inst[2] / N;
  const clampW = (v) => Math.min(worldMax, Math.max(worldMin, v));
  const x0 = inst[0] + gx * sp, z0 = inst[1] + gz * sp;
  const d = lodDistance(cam, hTop, x0, z0);
  const k = Math.min(1, Math.max(0, (d - inst[4]) / Math.max(inst[5] - inst[4], 1e-3)));
  const fx = ((gx * 0.5) % 1) * 2, fz = ((gz * 0.5) % 1) * 2;
  return [clampW(x0 - fx * sp * k), clampW(z0 - fz * sp * k), k];
}

// Index buffer of an N x N quad grid ((N + 1)^2 vertices). Winding is
// counter-clockwise seen from +y.
export function gridIndices(N) {
  const idx = new Uint32Array(N * N * 6);
  let k = 0;
  const v = (x, z) => z * (N + 1) + x;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const a = v(x, z), b = v(x + 1, z), c = v(x, z + 1), d = v(x + 1, z + 1);
      // alternate the diagonal for a symmetric mesh
      if ((x + z) & 1) { idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
      else { idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    }
  }
  return idx;
}

// ------------------------------------------------------- ground textures --

const LAYER_KEYS = [
  [/cliff/i, 1], [/forest|litter|leaf|needle|moss/i, 3], [/snow|ice/i, 5], [/mud|soil|dirt|clay/i, 6],
  [/gravel|pebble|scree/i, 7], [/sand|beach|dune/i, 4], [/grass|meadow|lawn/i, 2], [/rock|stone|granite/i, 0],
];

function pickFile(files, re) {
  if (!files) return null;
  if (Array.isArray(files)) {
    for (const f of files) {
      const s = typeof f === 'string' ? f : (f.file || f.url || f.path || '');
      if (re.test(s) || (f && re.test(f.map || f.role || ''))) return s;
    }
    return null;
  }
  for (const [k, v] of Object.entries(files)) {
    const s = typeof v === 'string' ? v : (v && (v.file || v.url || v.path || (Array.isArray(v) ? v[0] : '')));
    if (s && (re.test(k) || re.test(s))) return s;
  }
  return null;
}

// Match the ground textures of an ASSETS manifest to the eight layers.
// Returns [{ layer, id, albedo, normal, orm }] (file paths as listed).
export function matchGroundTextures(manifest) {
  if (!manifest) return [];
  const list = Array.isArray(manifest) ? manifest : (manifest.assets || manifest.items || manifest.entries || []);
  const out = [];
  const taken = new Set();
  for (const a of list) {
    if (!a || !/ground|terrain|texture|surface/i.test(String(a.kind || a.type || ''))) continue;
    const name = `${a.id || ''} ${a.name || ''} ${(a.tags || a.biomes || []).join?.(' ') || ''}`;
    let layer = -1;
    for (const [re, l] of LAYER_KEYS) { if (re.test(name)) { layer = l; break; } }
    if (layer < 0 || taken.has(layer)) continue;
    const files = a.files || a.maps || a.textures || a.lods || a;
    const albedo = pickFile(files, /albedo|diff|basecolor|base_color|colou?r|_col/i);
    if (!albedo) continue;
    out.push({
      layer, id: a.id || a.name,
      albedo,
      normal: pickFile(files, /normal|_nor|nrm/i),
      orm: pickFile(files, /orm|arm|rough/i),
    });
    taken.add(layer);
  }
  // cliff falls back to rock
  if (!taken.has(1)) { const r = out.find((e) => e.layer === 0); if (r) out.push({ ...r, layer: 1 }); }
  return out;
}

// ----------------------------------------------------------------- module --

const MIP_WGSL = /* wgsl */`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VO { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let q = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO; o.p = vec4f(q * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(q.x, 1.0 - q.y); return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f { return textureSampleLevel(src, smp, v.uv, 0.0); }`;

export async function createGround(gpu) {
  const { device, queue } = gpu;
  const hdrFormat = gpu.hdrFormat || 'rgba16float';
  const depthFormat = gpu.depthFormat || 'depth32float';
  let quality = gpu.quality ?? 1;
  const code = await gpu.loadWGSL(new URL('../shaders/ground.wgsl', import.meta.url).href);
  const module = device.createShaderModule({ code, label: 'ground' });
  if (module.getCompilationInfo) {
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    if (errs.length) throw new Error('ground.wgsl: ' + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  }

  // group 1: uniform + layer textures + repeat sampler
  const groundLayout = device.createBindGroupLayout({
    label: 'ground g1',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  // the shadow pass reads U (group 1) too: the morph needs the terrain top
  const uBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'ground U' });
  const uData = new Float32Array(16);
  const sRepeat = gpu.sRepeat || device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });

  // layer arrays: a 4x4 dummy until ASSETS textures arrive
  const mkArray = (size, format, mips, label) => device.createTexture({
    size: [size, size, 8], format, mipLevelCount: mips, label,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  let texAlb = mkArray(4, 'rgba8unorm-srgb', 1, 'ground alb dummy');
  let texNrm = mkArray(4, 'rgba8unorm', 1, 'ground nrm dummy');
  let texOrm = mkArray(4, 'rgba8unorm', 1, 'ground orm dummy');
  let texOn = 0;
  const makeBG = () => device.createBindGroup({
    layout: groundLayout, label: 'ground g1',
    entries: [
      { binding: 0, resource: { buffer: uBuf } },
      { binding: 1, resource: texAlb.createView({ dimension: '2d-array' }) },
      { binding: 2, resource: texNrm.createView({ dimension: '2d-array' }) },
      { binding: 3, resource: texOrm.createView({ dimension: '2d-array' }) },
      { binding: 4, resource: sRepeat },
    ],
  });
  let groundBG = makeBG();

  const vbufs = [{
    arrayStride: INST_FLOATS * 4, stepMode: 'instance',
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }],
  }];
  // group 2 is CORE's: the shadow sample group in the opaque pass, the
  // shadow pass group (SP) in drawShadow; CORE sets both bind groups
  const mainPipe = await device.createRenderPipelineAsync({
    label: 'ground opaque',
    layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, groundLayout, gpu.shadowSampleLayout] }),
    vertex: { module, entryPoint: 'vs', buffers: vbufs },
    fragment: { module, entryPoint: 'fs', targets: [{ format: hdrFormat }] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: gpu.depthState ? gpu.depthState(true, 'greater') : { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
  });
  const shadowPipe = await device.createRenderPipelineAsync({
    label: 'ground shadow',
    layout: device.createPipelineLayout({ bindGroupLayouts: [gpu.globalsLayout, groundLayout, gpu.shadowPassLayout] }),
    vertex: { module, entryPoint: 'vsShadow', buffers: vbufs },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: gpu.shadowDepthState,
  });

  // grids
  const idxBufs = {};
  const gridBuf = (N) => {
    if (!idxBufs[N]) {
      const idx = gridIndices(N);
      const b = device.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: `ground grid ${N}` });
      queue.writeBuffer(b, 0, idx);
      idxBufs[N] = { buf: b, count: idx.length };
    }
    return idxBufs[N];
  };
  const instBuf = device.createBuffer({ size: MAX_INST * INST_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'ground inst' });
  const shInstBuf = device.createBuffer({ size: MAX_INST * INST_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'ground shadow inst' });
  let instArr = new Float32Array(MAX_INST * INST_FLOATS);
  let shArr = new Float32Array(MAX_INST * INST_FLOATS);

  let terrain = null;
  let mm = null, mmPrev = null, mmPrevUntil = 0;
  let hMin = 0, hMax = 1, hMaxPrev = 1;
  let cfg = null, cfgSh = null;
  let sel = { count: 0, full: 0, half: 0 };
  let shSel = { count: 0, full: 0, half: 0 };
  let debug = 0;
  let aerialOn = gpu.groundAerial === false ? 0 : 1;
  let lastTime = 0;

  // the min / max pyramid of the newest heights; during the stage blend
  // (gpu/terrain-gpu.js BLEND_S) the bounds are the union of old and new
  function setTerrain(t) {
    terrain = t;
    const src = (t.cpu && t.cpu.height) ? t.cpu : (t.snapshot && t.snapshot.height ? t.snapshot : null);
    const h = src ? src.height : null;
    const n = src ? (src.n || Math.round(Math.sqrt(h.length))) : 0;
    mmPrev = mm; hMaxPrev = hMax; mmPrevUntil = lastTime + 1.2;
    if (h && n && h.length >= n * n) {
      mm = buildMinMax(h, n);
      const top = mm.levels[mm.levels.length - 1].data;
      hMin = top[0]; hMax = top[1];
    } else {
      mm = null; hMin = t.minH ?? 0; hMax = t.maxH ?? (t.heightScale || 1000);
    }
    cfg = lodConfig(t.worldSize, quality, gpu.coarse);
    cfgSh = lodConfig(t.worldSize, quality, gpu.coarse, 0.55);
  }

  const unionMM = {
    get n() { return mm.n; },
    bounds(origin, ws, x0, z0, size, out) {
      nodeBounds(mm, origin, ws, x0, z0, size, out);
      const lo = out[0], hi = out[1];
      nodeBounds(mmPrev, origin, ws, x0, z0, size, out);
      out[0] = Math.min(lo, out[0]); out[1] = Math.max(hi, out[1]);
      return out;
    },
  };

  function update(frame) {
    if (!terrain) return;
    const g = frame.globals;
    lastTime = frame.time || 0;
    const q = frame.quality ?? (g ? g[130] : quality);
    if (Math.abs(q - quality) > 1e-3) {
      quality = q;
      cfg = lodConfig(terrain.worldSize, quality, frame.coarse);
      cfgSh = lodConfig(terrain.worldSize, quality, frame.coarse, 0.55);
    }
    const cam = frame.camera?.pos ? [frame.camera.pos[0], frame.camera.pos[1], frame.camera.pos[2]] : [g[80], g[81], g[82]];
    const origin = -terrain.worldSize / 2;
    const planes = g ? frustumPlanes(g.subarray(0, 16)) : null;
    const pad = 12 + (terrain.heightScale || 0) * 0.002;
    const blending = mm && mmPrev && lastTime < mmPrevUntil;
    const mmUse = blending ? unionMM : mm;
    const hTop = (blending ? Math.max(hMax, hMaxPrev) : hMax) + pad;
    sel = selectNodes({ cfg, cam, origin, mm: mmUse, pad, hTop, planes, out: instArr });
    instArr = sel.out;
    queue.writeBuffer(instBuf, 0, instArr, 0, sel.count * INST_FLOATS);
    const splits = frame.shadowInfo?.splits || gpu.shadowSplits;
    const shDist = frame.shadowDistance || (splits ? splits[splits.length - 1] * 1.5 : Math.min(terrain.worldSize, 4000));
    shSel = selectNodes({ cfg: cfgSh, cam, origin, mm: mmUse, pad, hTop, planes: null, maxRange: shDist, out: shArr });
    shArr = shSel.out;
    queue.writeBuffer(shInstBuf, 0, shArr, 0, shSel.count * INST_FLOATS);

    uData.set([cfg.N, cfg.ranges[0], cfg.levels, pad,
      texOn, 4.0, debug, quality,
      aerialOn, 1, Math.min(terrain.worldSize * 0.3, 8000), 0,
      frame.time || 0, hMin, hTop, 1]);
    queue.writeBuffer(uBuf, 0, uData);
  }

  function drawList(pass, buf, s, c) {
    if (s.full) {
      const g = gridBuf(c.N);
      pass.setVertexBuffer(0, buf, 0);
      pass.setIndexBuffer(g.buf, 'uint32');
      pass.drawIndexed(g.count, s.full);
    }
    if (s.half) {
      const g = gridBuf(c.N / 2);
      pass.setVertexBuffer(0, buf, s.full * INST_FLOATS * 4);
      pass.setIndexBuffer(g.buf, 'uint32');
      pass.drawIndexed(g.count, s.half);
    }
  }

  // CORE has set group 0 (Globals) and group 2 (shadow sample) on the pass
  function drawOpaque(pass) {
    if (!terrain || !sel.count) return;
    pass.setPipeline(mainPipe);
    pass.setBindGroup(1, groundBG);
    drawList(pass, instBuf, sel, cfg);
  }

  // CORE has set group 0 and group 2 (SP of cascade frame.cascade)
  function drawShadow(pass) {
    if (!terrain || !shSel.count) return;
    pass.setPipeline(shadowPipe);
    pass.setBindGroup(1, groundBG);
    drawList(pass, shInstBuf, shSel, cfgSh);
  }

  // ---- ASSETS ground textures
  const mipPipes = {};
  const mipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  function genMips(tex, format, layer, levels) {
    if (!mipPipes[format]) {
      const m = device.createShaderModule({ code: MIP_WGSL });
      mipPipes[format] = device.createRenderPipeline({
        layout: 'auto', vertex: { module: m, entryPoint: 'vs' },
        fragment: { module: m, entryPoint: 'fs', targets: [{ format }] },
      });
    }
    const pipe = mipPipes[format];
    const enc = device.createCommandEncoder();
    for (let l = 1; l < levels; l++) {
      const src = tex.createView({ dimension: '2d', baseMipLevel: l - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const dst = tex.createView({ dimension: '2d', baseMipLevel: l, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: mipSampler }] });
      const p = enc.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
    }
    queue.submit([enc.finish()]);
  }

  async function loadImage(src) {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`${src}: ${r.status}`);
    const blob = await r.blob();
    return createImageBitmap(blob, { resizeWidth: LAYER_RES, resizeHeight: LAYER_RES, resizeQuality: 'high', colorSpaceConversion: 'none' });
  }

  // Load the ground textures listed in the ASSETS manifest. Resolves to the
  // number of layers loaded (0: the procedural layers stay alone).
  async function loadAssetTextures() {
    const a = gpu.assets;
    const manifest = a && (a.manifest || a);
    const found = matchGroundTextures(manifest);
    if (!found.length || typeof createImageBitmap === 'undefined') return 0;
    const base = (a && (a.baseURL || a.base)) || new URL('../../../assets/nature/', import.meta.url).href;
    const mips = Math.floor(Math.log2(LAYER_RES)) + 1;
    const alb = mkArray(LAYER_RES, 'rgba8unorm-srgb', mips, 'ground alb');
    const nrm = mkArray(LAYER_RES, 'rgba8unorm', mips, 'ground nrm');
    const orm = mkArray(LAYER_RES, 'rgba8unorm', mips, 'ground orm');
    let ok = 0;
    for (const f of found) {
      try {
        const jobs = [[f.albedo, alb, 'rgba8unorm-srgb'], [f.normal, nrm, 'rgba8unorm'], [f.orm, orm, 'rgba8unorm']];
        for (const [file, tex, fmt] of jobs) {
          if (!file) continue;
          const img = await loadImage(new URL(file, base).href);
          queue.copyExternalImageToTexture({ source: img }, { texture: tex, origin: [0, 0, f.layer] }, [LAYER_RES, LAYER_RES, 1]);
          genMips(tex, fmt, f.layer, mips);
        }
        ok++;
      } catch (e) {
        console.warn('ground: texture', f.id, e.message);
      }
    }
    if (!ok) { alb.destroy(); nrm.destroy(); orm.destroy(); return 0; }
    texAlb.destroy(); texNrm.destroy(); texOrm.destroy();
    texAlb = alb; texNrm = nrm; texOrm = orm;
    groundBG = makeBG();
    texOn = 1;
    return ok;
  }
  const texturesReady = loadAssetTextures().catch((e) => { console.warn('ground: textures', e.message); return 0; });

  return {
    name: 'ground',
    role: 'ground',
    setTerrain,
    update,
    drawOpaque,
    drawShadow,
    texturesReady,
    setDebug(mode) { debug = mode | 0; },     // 0 lit, 1 layer weights, 2 normals, 3 LOD
    setAerial(on) { aerialOn = on ? 1 : 0; }, // off when SKY's volume does all of the haze
    stats() { return { patches: sel.count, full: sel.full, half: sel.half, shadowPatches: shSel.count, levels: cfg?.levels, N: cfg?.N, textures: texOn }; },
    resize() {},
    dispose() {
      for (const b of [uBuf, instBuf, shInstBuf]) b.destroy();
      for (const k of Object.keys(idxBufs)) idxBufs[k].buf.destroy();
      texAlb.destroy(); texNrm.destroy(); texOrm.destroy();
    },
  };
}
