// engine.js - WebGPU engine for the Lenia page.
//
// Lenia (Bert Chan, 2018) is a continuous cellular automaton. Each cell holds
// a value A in [0, 1]. One step does three things:
//   U  = K * A                    convolution with a ring kernel K of radius R
//   G  = growth(U; m, s)          a bump in [-1, 1], positive near U = m
//   A' = clip(A + G / T, 0, 1)    T steps make one unit of time
// The field buffer keeps U and the clipped change (A' - A) T of each cell
// for the potential and growth views.
// The world is a torus of W x H cells.
//
// The convolution is direct, not FFT. kernelTaps() lists every kernel cell
// with a weight that is not zero, as (dx, dy, weight), sorted by row. The step
// program adds weight * A over that list. For R = 13 that is about 530 taps
// per cell. The list is small and the reads go along rows, so the GPU caches
// keep up well at the grid sizes that the page uses.
//
// This module has no DOM code. A Deno script can import it, give canvas =
// null, and step and read the world without a screen (tools/engine_test.js).
//
// API (grep -n "^  engine\.[a-zA-Z]* = " engine.js):
//   const engine = await createEngine(canvas | null, {mobile})
//                                  throws Error('webgpu-unavailable')
//   engine.setWorld(W, H)          new empty world (all cells 0)
//   engine.setRule({R, T, m, s, b, kn, gn})
//                                  b: ring heights, kn 1..4 kernel core,
//                                  gn 1..3 growth function (see KERNEL_CORE, GROWTH)
//   engine.clear()
//   engine.stamp(patch, x, y, op)  patch {w, h, data: Float32Array}; x, y is
//                                  the cell under the patch center.
//                                  op 'set': write the cells where patch > 0
//                                  op 'erase': A = mix(A, 0, patch)
//   engine.step(n)                 n steps in one command buffer
//   engine.stats()                 Promise<{mass, cx, cy, sx, sy, max, rms,
//                                  focus}> or null when a readback is still
//                                  in flight. cx, cy: the circular mean of A,
//                                  in cells. sx, sy: the circular standard
//                                  deviation of A about it, in cells.
//   engine.readState()             Promise<Float32Array(W * H)>
//   engine.setView({mode, palette, zoom, cx, cy, ox, oy, blend})
//                                  mode 'world' | 'potential' | 'growth';
//                                  palette: 256 x rgb Float32Array or a name
//                                  from PALETTES; zoom: screen px per cell as
//                                  a multiple of the "cover" fit; cx, cy: the
//                                  world cell at the view center; ox, oy: the
//                                  view center minus the canvas center, in
//                                  CSS px (a sheet over part of the canvas);
//                                  blend 0..1: render mix of the state one
//                                  step back (0) and the current state (1)
//   engine.cellPx()                screen px per cell (CSS px)
//   engine.resize(pixelW, pixelH, dpr)
//   engine.render()
//   engine.info                    {W, H, R, taps, steps, lost}
//   engine.onLost = info => {}
//   engine.destroy()
//
// Pure exports, also for the page UI and the tools:
//   KERNEL_CORE, GROWTH, kernelShell(r, b, kn), kernelTaps(R, b, kn),
//   resample(patch, k), PALETTES, paletteData(name)

// ------------------------------------------------------------------ math
// Index kn - 1 and gn - 1, the same order as Chan's LeniaND.py.
export const KERNEL_CORE = [
  r => (4 * r * (1 - r)) ** 4,                                   // 1 polynomial (quad4)
  r => (r > 0 && r < 1) ? Math.exp(4 - 1 / (r * (1 - r))) : 0,   // 2 exponential bump (bump4)
  r => (r >= 0.25 && r <= 0.75) ? 1 : 0,                         // 3 step (stpz1/4)
  r => (r >= 0.25 && r <= 0.75) ? 1 : (r < 0.25 ? 0.5 : 0),      // 4 staircase (life)
];
export const GROWTH = [
  (u, m, s) => Math.max(0, 1 - (u - m) ** 2 / (9 * s * s)) ** 4 * 2 - 1,  // 1 polynomial
  (u, m, s) => Math.exp(-((u - m) ** 2) / (2 * s * s)) * 2 - 1,           // 2 gaussian
  (u, m, s) => (Math.abs(u - m) <= s ? 1 : -1),                           // 3 step
];

// The kernel shell at radius r in [0, 1): ring number floor(B r) takes
// height b[i], and the core function shapes each ring.
export function kernelShell(r, b, kn) {
  if (r >= 1) return 0;
  const B = b.length, Br = B * r;
  const i = Math.min(Math.floor(Br), B - 1);
  return b[i] * KERNEL_CORE[kn - 1](Math.min(Br % 1, 1));
}

// Every cell of the kernel with a weight > 0, normalized to sum 1.
// Returns {data: Float32Array(n * 4) of (dx, dy, w, 0), n}. Rows go in order,
// so the step program reads the world along rows.
export function kernelTaps(R, b, kn) {
  const out = [];
  let sum = 0;
  const ri = Math.ceil(R);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      const w = kernelShell(Math.hypot(dx, dy) / R, b, kn);
      if (w > 1e-7) { out.push(dx, dy, w); sum += w; }
    }
  }
  const n = out.length / 3;
  const data = new Float32Array(Math.max(n, 1) * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = out[i * 3];
    data[i * 4 + 1] = out[i * 3 + 1];
    data[i * 4 + 2] = out[i * 3 + 2] / sum;
  }
  return { data, n };
}

// Bilinear resize of a patch by the factor k (k = 1 returns the same patch).
export function resample(patch, k) {
  if (Math.abs(k - 1) < 1e-6) return patch;
  const w = Math.max(1, Math.round(patch.w * k)), h = Math.max(1, Math.round(patch.h * k));
  const data = new Float32Array(w * h);
  const at = (x, y) => (x < 0 || y < 0 || x >= patch.w || y >= patch.h) ? 0 : patch.data[y * patch.w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / k - 0.5, sy = (y + 0.5) / k - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      data[y * w + x] =
        (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
        (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return { w, h, data };
}

// ------------------------------------------------------------------ palettes
// Color stops, evenly spaced from 0 to 1. paletteData() expands them to 256
// rgb entries in linear-light order for the render program.
export const PALETTES = {
  lenia:   ['#000000', '#0b1a4a', '#1f4fb4', '#1fa7d8', '#6fe0c8', '#f2e36b', '#ff9a3c', '#e8412b', '#6e0f12'],
  aurora:  ['#020409', '#0a2a3a', '#0f5e5a', '#2fa37a', '#9fdc7a', '#f4f1b8', '#ffffff'],
  ember:   ['#000000', '#1c0710', '#4f0f23', '#96202c', '#dd4a1c', '#f8962d', '#fde07a', '#fffbe8'],
  ice:     ['#000000', '#08101e', '#15305a', '#2a5ea0', '#5aa2da', '#a8dcf4', '#ffffff'],
  viridis: ['#440154', '#472c7a', '#3b518b', '#2c718e', '#21908d', '#27ad81', '#5cc863', '#aadc32', '#fde725'],
  mono:    ['#000000', '#ffffff'],
};

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
export function paletteData(name) {
  const stops = (PALETTES[name] || PALETTES.lenia).map(hexRgb);
  const out = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (stops.length - 1);
    const j = Math.min(Math.floor(t), stops.length - 2), f = t - j;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = stops[j][c] * (1 - f) + stops[j + 1][c] * f;
    out[i * 4 + 3] = 1;
  }
  return out;
}

// ------------------------------------------------------------------ WGSL
const STEP_WGSL = /* wgsl */`
struct Rule { w: u32, h: u32, n: u32, gn: u32, m: f32, s: f32, dt: f32, pad: f32 }
@group(0) @binding(0) var<uniform> rule: Rule;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@group(0) @binding(3) var<storage, read_write> fld: array<vec2f>;
@group(0) @binding(4) var<storage, read> taps: array<vec4f>;

fn growth(u: f32) -> f32 {
  let d = u - rule.m;
  let s2 = rule.s * rule.s;
  switch rule.gn {
    case 1u: {
      let q = max(0.0, 1.0 - d * d / (9.0 * s2));
      let q2 = q * q;
      return 2.0 * q2 * q2 - 1.0;
    }
    case 3u: { return select(-1.0, 1.0, abs(d) <= rule.s); }
    default: { return 2.0 * exp(-d * d / (2.0 * s2)) - 1.0; }
  }
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= rule.w || id.y >= rule.h) { return; }
  let W = i32(rule.w);
  let H = i32(rule.h);
  let x = i32(id.x);
  let y = i32(id.y);
  var u = 0.0;
  for (var i = 0u; i < rule.n; i++) {
    let t = taps[i];
    var xx = x + i32(t.x);
    var yy = y + i32(t.y);
    xx = select(xx, xx - W, xx >= W);
    xx = select(xx, xx + W, xx < 0);
    yy = select(yy, yy - H, yy >= H);
    yy = select(yy, yy + H, yy < 0);
    u += t.z * src[yy * W + xx];
  }
  let k = id.y * rule.w + id.x;
  let a = clamp(src[k] + rule.dt * growth(u), 0.0, 1.0);
  dst[k] = a;
  // The real change per unit of time, after the clip. An empty cell with
  // G = -1 cannot decay, so it shows 0 in the growth view, not -1.
  fld[k] = vec2f(u, (a - src[k]) / rule.dt);
}
`;

// op 0 'set':   A = patch where patch > 0
// op 1 'erase': A = mix(A, 0, patch)
const STAMP_WGSL = /* wgsl */`
struct Stamp { w: u32, h: u32, pw: u32, ph: u32, x0: i32, y0: i32, op: u32, pad: u32 }
@group(0) @binding(0) var<uniform> st: Stamp;
@group(0) @binding(1) var<storage, read> pat: array<f32>;
@group(0) @binding(2) var<storage, read_write> world: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= st.pw || id.y >= st.ph) { return; }
  let p = pat[id.y * st.pw + id.x];
  let W = i32(st.w);
  let H = i32(st.h);
  let x = ((st.x0 + i32(id.x)) % W + W) % W;
  let y = ((st.y0 + i32(id.y)) % H + H) % H;
  let k = u32(y * W + x);
  if (st.op == 0u) {
    if (p > 1e-4) { world[k] = p; }
  } else {
    world[k] = world[k] * (1.0 - clamp(p, 0.0, 1.0));
  }
}
`;

// One pass. Each of the 64 workgroups sums a strided part of the world, then
// reduces in workgroup memory. The CPU adds the 64 partial results.
const REDUCE_GROUPS = 64;
const REDUCE_WGSL = /* wgsl */`
struct Rule { w: u32, h: u32, n: u32, gn: u32, m: f32, s: f32, dt: f32, pad: f32 }
@group(0) @binding(0) var<uniform> rule: Rule;
@group(0) @binding(1) var<storage, read> world: array<f32>;
@group(0) @binding(2) var<storage, read_write> part: array<vec4f>;
var<workgroup> sa: array<vec4f, 256>;
var<workgroup> sb: array<vec4f, 256>;
const TAU = 6.2831853;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let total = rule.w * rule.h;
  var a = vec4f(0.0);   // mass, mass cos(x), mass sin(x), sum A^2
  var b = vec4f(0.0);   // mass cos(y), mass sin(y), max A, 0
  for (var k = wg.x * 256u + li; k < total; k += ${REDUCE_GROUPS}u * 256u) {
    let v = world[k];
    if (v > 0.0) {
      let tx = TAU * f32(k % rule.w) / f32(rule.w);
      let ty = TAU * f32(k / rule.w) / f32(rule.h);
      a += vec4f(v, v * cos(tx), v * sin(tx), v * v);
      b += vec4f(v * cos(ty), v * sin(ty), 0.0, 0.0);
      b.z = max(b.z, v);
    }
  }
  sa[li] = a;
  sb[li] = b;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) {
      sa[li] += sa[li + s];
      let o = sb[li + s];
      sb[li] = vec4f(sb[li].xy + o.xy, max(sb[li].z, o.z), 0.0);
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    part[wg.x * 2u] = sa[0];
    part[wg.x * 2u + 1u] = sb[0];
  }
}
`;

const RENDER_WGSL = /* wgsl */`
struct View {
  canvas: vec2f, center: vec2f,
  world: vec2f, cellPx: f32, mode: u32,
  m: f32, blend: f32, offset: vec2f,
}
@group(0) @binding(0) var<uniform> v: View;
@group(0) @binding(1) var<storage, read> world: array<f32>;
@group(0) @binding(2) var<storage, read> fld: array<vec2f>;
@group(0) @binding(3) var<storage, read> pal: array<vec4f, 256>;
@group(0) @binding(4) var<storage, read> worldPrev: array<f32>;
@group(0) @binding(5) var<storage, read> fldPrev: array<vec2f>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// The state one step back mixed with the current state by v.blend, the
// part of the next step that the clock has used. The picture then moves at
// each frame, also when a step comes only at every third or fifth frame.
fn cellValue(k: u32) -> f32 {
  switch v.mode {
    case 1u: { return clamp(mix(fldPrev[k].x, fld[k].x, v.blend) / max(2.0 * v.m, 1e-4), 0.0, 1.0); }
    case 2u: { return mix(fldPrev[k].y, fld[k].y, v.blend) * 0.5 + 0.5; }
    default: { return mix(worldPrev[k], world[k], v.blend); }
  }
}

fn wrapi(a: i32, n: i32) -> i32 { return ((a % n) + n) % n; }

fn sampleAt(p: vec2f) -> f32 {
  let W = i32(v.world.x);
  let H = i32(v.world.y);
  let q = p - 0.5;
  let f = fract(q);
  let x0 = wrapi(i32(floor(q.x)), W);
  let y0 = wrapi(i32(floor(q.y)), H);
  let x1 = (x0 + 1) % W;
  let y1 = (y0 + 1) % H;
  let a = cellValue(u32(y0 * W + x0));
  let b = cellValue(u32(y0 * W + x1));
  let c = cellValue(u32(y1 * W + x0));
  let d = cellValue(u32(y1 * W + x1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Blue for decay, black at zero, amber for growth.
fn diverging(t: f32) -> vec3f {
  let d = t * 2.0 - 1.0;
  let neg = vec3f(0.15, 0.45, 1.0);
  let pos = vec3f(1.0, 0.72, 0.25);
  return select(neg, pos, d > 0.0) * pow(abs(d), 0.8);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = (pos.xy - v.canvas * 0.5 - v.offset) / v.cellPx + v.center;
  let t = clamp(sampleAt(p), 0.0, 1.0);
  var c: vec3f;
  if (v.mode == 2u) {
    c = diverging(t);
  } else {
    let i = t * 255.0;
    let i0 = u32(floor(i));
    c = mix(pal[i0].rgb, pal[min(i0 + 1u, 255u)].rgb, fract(i));
  }
  return vec4f(c, 1.0);
}
`;

// ------------------------------------------------------------------ engine
async function compile(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter(m => m.type === 'error');
  if (errs.length) throw new Error(errs.map(m => `${label}:${m.lineNum}:${m.linePos}: ${m.message}`).join('\n'));
  return module;
}

export async function createEngine(canvas, { mobile = false } = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('webgpu-unavailable');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: mobile ? 'low-power' : 'high-performance' });
  if (!adapter) throw new Error('webgpu-unavailable');
  const device = await adapter.requestDevice();
  let context = null, format = null;
  if (canvas) {
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('webgpu-unavailable');
    format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
  }

  const engine = {};
  const info = { W: 0, H: 0, R: 0, taps: 0, steps: 0, lost: false };
  engine.info = info;
  device.lost.then(i => {
    info.lost = true;
    console.error('[lenia] GPU device lost:', i.reason, i.message);
    if (typeof engine.onLost === 'function') engine.onLost(i);
  });

  const SU = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
  const buf = (size, usage, label) => device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage, label });

  const [stepMod, stampMod, reduceMod] = await Promise.all([
    compile(device, STEP_WGSL, 'step.wgsl'),
    compile(device, STAMP_WGSL, 'stamp.wgsl'),
    compile(device, REDUCE_WGSL, 'reduce.wgsl'),
  ]);
  const stepPipe = device.createComputePipeline({ layout: 'auto', compute: { module: stepMod, entryPoint: 'main' } });
  const stampPipe = device.createComputePipeline({ layout: 'auto', compute: { module: stampMod, entryPoint: 'main' } });
  const reducePipe = device.createComputePipeline({ layout: 'auto', compute: { module: reduceMod, entryPoint: 'main' } });
  let renderPipe = null;
  if (context) {
    const mod = await compile(device, RENDER_WGSL, 'render.wgsl');
    renderPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  const ruleBuf = buf(32, GPUBufferUsage.UNIFORM | CD, 'rule');
  const stampBuf = buf(32, GPUBufferUsage.UNIFORM | CD, 'stamp');
  const viewBuf = buf(48, GPUBufferUsage.UNIFORM | CD, 'view');
  const palBuf = buf(256 * 16, SU | CD, 'palette');
  const partBuf = buf(REDUCE_GROUPS * 32, SU | CS, 'partials');
  const readBuf = buf(REDUCE_GROUPS * 32, GPUBufferUsage.MAP_READ | CD, 'partials-read');
  let tapBuf = null, patchBuf = null;
  let A = [null, null], F = [null, null], cur = 0;
  let stepBG = [null, null], reduceBG = [null, null], renderBG = [null, null];
  let reading = false;

  const rule = { R: 13, T: 10, m: 0.15, s: 0.015, b: [1], kn: 1, gn: 1 };
  const view = { mode: 'world', zoom: 1, cx: 0, cy: 0, ox: 0, oy: 0, blend: 1 };
  let px = { w: 1, h: 1, dpr: 1 };
  engine.view = view;

  function writeRule() {
    const d = new ArrayBuffer(32), u = new Uint32Array(d), f = new Float32Array(d);
    u[0] = info.W; u[1] = info.H; u[2] = info.taps; u[3] = rule.gn;
    f[4] = rule.m; f[5] = rule.s; f[6] = 1 / rule.T;
    device.queue.writeBuffer(ruleBuf, 0, d);
  }

  function bindAll() {
    if (!A[0] || !tapBuf) return;
    for (let i = 0; i < 2; i++) {
      stepBG[i] = device.createBindGroup({
        layout: stepPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ruleBuf } },
          { binding: 1, resource: { buffer: A[i] } },
          { binding: 2, resource: { buffer: A[1 - i] } },
          { binding: 3, resource: { buffer: F[1 - i] } },
          { binding: 4, resource: { buffer: tapBuf } },
        ],
      });
      reduceBG[i] = device.createBindGroup({
        layout: reducePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ruleBuf } },
          { binding: 1, resource: { buffer: A[i] } },
          { binding: 2, resource: { buffer: partBuf } },
        ],
      });
      if (renderPipe) {
        renderBG[i] = device.createBindGroup({
          layout: renderPipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: viewBuf } },
            { binding: 1, resource: { buffer: A[i] } },
            { binding: 2, resource: { buffer: F[i] } },
            { binding: 3, resource: { buffer: palBuf } },
            { binding: 4, resource: { buffer: A[1 - i] } },
            { binding: 5, resource: { buffer: F[1 - i] } },
          ],
        });
      }
    }
  }

  engine.setWorld = (W, H) => {
    W = Math.max(16, Math.round(W)); H = Math.max(16, Math.round(H));
    for (const b of [A[0], A[1], F[0], F[1]]) if (b) b.destroy();
    A = [buf(W * H * 4, SU | CD | CS, 'A0'), buf(W * H * 4, SU | CD | CS, 'A1')];
    // F[i] is the field of the step that wrote A[i].
    F = [buf(W * H * 8, SU | CD, 'field0'), buf(W * H * 8, SU | CD, 'field1')];
    cur = 0;
    info.W = W; info.H = H; info.steps = 0;
    view.cx = W / 2; view.cy = H / 2;
    writeRule();
    bindAll();
  };

  engine.setRule = r => {
    const key = () => `${rule.R}|${rule.b}|${rule.kn}`;
    const before = key();
    Object.assign(rule, r);
    // One wrap per axis in the step program needs the kernel inside the world.
    if (info.W) rule.R = Math.min(rule.R, Math.floor(Math.min(info.W, info.H) / 2) - 1);
    if (key() !== before || !tapBuf) {
      const { data, n } = kernelTaps(rule.R, rule.b, rule.kn);
      if (tapBuf) tapBuf.destroy();
      tapBuf = buf(data.byteLength, SU | CD, 'taps');
      device.queue.writeBuffer(tapBuf, 0, data);
      info.taps = n;
      info.R = rule.R;
      bindAll();
    }
    writeRule();
  };
  engine.rule = rule;

  engine.clear = () => {
    if (!A[0]) return;
    // Both states and both fields, so the render mix shows an empty world.
    const z = new Float32Array(info.W * info.H), zf = new Float32Array(info.W * info.H * 2);
    for (let i = 0; i < 2; i++) { device.queue.writeBuffer(A[i], 0, z); device.queue.writeBuffer(F[i], 0, zf); }
    info.steps = 0;
  };

  engine.stamp = (patch, x, y, op = 'set') => {
    if (!A[0] || !patch || !patch.w || !patch.h) return;
    const bytes = patch.w * patch.h * 4;
    if (!patchBuf || patchBuf.size < bytes) {
      if (patchBuf) patchBuf.destroy();
      patchBuf = buf(Math.max(bytes, 4096), SU | CD, 'patch');
    }
    device.queue.writeBuffer(patchBuf, 0, patch.data, 0, patch.w * patch.h);
    const d = new ArrayBuffer(32), u = new Uint32Array(d), s = new Int32Array(d);
    u[0] = info.W; u[1] = info.H; u[2] = patch.w; u[3] = patch.h;
    s[4] = Math.round(x - patch.w / 2); s[5] = Math.round(y - patch.h / 2);
    u[6] = op === 'erase' ? 1 : 0;
    device.queue.writeBuffer(stampBuf, 0, d);
    // The patch goes into the current state and the state one step back, so
    // the render mix shows it at full strength at once.
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(stampPipe);
    for (const b of [A[cur], A[1 - cur]]) {
      pass.setBindGroup(0, device.createBindGroup({
        layout: stampPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: stampBuf } },
          { binding: 1, resource: { buffer: patchBuf } },
          { binding: 2, resource: { buffer: b } },
        ],
      }));
      pass.dispatchWorkgroups(Math.ceil(patch.w / 16), Math.ceil(patch.h / 16));
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  };

  engine.step = n => {
    if (!A[0] || !tapBuf || n <= 0 || info.lost) return 0;
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(stepPipe);
    const gx = Math.ceil(info.W / 16), gy = Math.ceil(info.H / 16);
    for (let i = 0; i < n; i++) {
      pass.setBindGroup(0, stepBG[cur]);
      pass.dispatchWorkgroups(gx, gy);
      cur = 1 - cur;
    }
    pass.end();
    device.queue.submit([enc.finish()]);
    info.steps += n;
    return n;
  };

  engine.stats = async () => {
    if (!A[0] || reading || info.lost) return null;
    reading = true;
    try {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(reducePipe);
      pass.setBindGroup(0, reduceBG[cur]);
      pass.dispatchWorkgroups(REDUCE_GROUPS);
      pass.end();
      enc.copyBufferToBuffer(partBuf, 0, readBuf, 0, REDUCE_GROUPS * 32);
      device.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const p = new Float32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      let mass = 0, cxx = 0, sxx = 0, sq = 0, cyy = 0, syy = 0, max = 0;
      for (let g = 0; g < REDUCE_GROUPS; g++) {
        const o = g * 8;
        mass += p[o]; cxx += p[o + 1]; sxx += p[o + 2]; sq += p[o + 3];
        cyy += p[o + 4]; syy += p[o + 5]; max = Math.max(max, p[o + 6]);
      }
      const ang = (s, c, n) => ((Math.atan2(s, c) / (2 * Math.PI) + 1) % 1) * n;
      const N = info.W * info.H;
      // The wrapped normal: a resultant length rl = exp(-sigma^2 / 2) in
      // radians, so sigma = sqrt(-2 ln rl), times n / 2 pi for cells.
      const sd = (s, c, n) => { const rl = mass > 0 ? Math.min(1, Math.hypot(s, c) / mass) : 0; return rl > 0 ? Math.sqrt(-2 * Math.log(rl)) * n / (2 * Math.PI) : n; };
      return {
        mass, max, rms: Math.sqrt(sq / N),
        cx: ang(sxx, cxx, info.W), cy: ang(syy, cyy, info.H),
        sx: sd(sxx, cxx, info.W), sy: sd(syy, cyy, info.H),
        // 1 when the mass sits in one spot, near 0 when it is spread over the torus.
        focus: mass > 0 ? Math.min(Math.hypot(cxx, sxx), Math.hypot(cyy, syy)) / mass : 0,
      };
    } finally {
      reading = false;
    }
  };

  engine.readState = async () => {
    const bytes = info.W * info.H * 4;
    const rb = buf(bytes, GPUBufferUsage.MAP_READ | CD, 'state-read');
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(A[cur], 0, rb, 0, bytes);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(rb.getMappedRange().slice(0));
    rb.unmap();
    rb.destroy();
    return out;
  };

  engine.setView = o => {
    for (const k of ['mode', 'zoom', 'cx', 'cy', 'ox', 'oy', 'blend']) if (o[k] !== undefined && o[k] !== null) view[k] = o[k];
    if (o.palette) device.queue.writeBuffer(palBuf, 0, typeof o.palette === 'string' ? paletteData(o.palette) : o.palette);
  };
  engine.setView({ palette: 'lenia' });

  // Screen px per cell, in CSS px. zoom 1 is the "cover" fit of the world.
  engine.cellPx = () => {
    if (!info.W) return 1;
    return Math.max(px.w / px.dpr / info.W, px.h / px.dpr / info.H) * view.zoom;
  };

  engine.resize = (w, h, dpr = 1) => {
    px = { w: Math.max(1, w | 0), h: Math.max(1, h | 0), dpr };
    if (canvas) { canvas.width = px.w; canvas.height = px.h; }
  };

  engine.render = () => {
    if (!context || !A[0] || info.lost) return;
    const d = new ArrayBuffer(48), f = new Float32Array(d), u = new Uint32Array(d);
    f[0] = px.w; f[1] = px.h; f[2] = view.cx; f[3] = view.cy;
    f[4] = info.W; f[5] = info.H; f[6] = engine.cellPx() * px.dpr;
    u[7] = view.mode === 'potential' ? 1 : view.mode === 'growth' ? 2 : 0;
    f[8] = rule.m; f[9] = Math.max(0, Math.min(1, view.blend)); f[10] = view.ox * px.dpr; f[11] = view.oy * px.dpr;
    device.queue.writeBuffer(viewBuf, 0, d);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(renderPipe);
    pass.setBindGroup(0, renderBG[cur]);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  };

  engine.destroy = () => {
    for (const b of [A[0], A[1], F[0], F[1], tapBuf, patchBuf, ruleBuf, stampBuf, viewBuf, palBuf, partBuf, readBuf]) if (b) b.destroy();
    if (context) context.unconfigure();
    device.destroy();
  };

  return engine;
}
