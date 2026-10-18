// ============================================================================
//  THERMAL CONVECTION  ·  render/views.js — surface, slice and block views (VIEW)
// ----------------------------------------------------------------------------
//  createViews(device, format, sim, { loadText }) -> Promise<views>
//    loadText(url) gets an absolute URL of a shaders/view-*.wgsl file
//    (default: fetch). The views read sim.buffers { T, vel, tracers } and
//    sim.dims { nx, ny, nz, Lx, Ly, dx } directly (no CPU readback). The
//    bind groups are made again when a sim buffer object or the dims change.
//  views.set({ palette, gain, bias, auto, slice: { angle, offset }, surfaceZ,
//              zScale, tracers, arrows, isotherms, relief, cam, streak, sliceLine })
//    cam = null (fit) | { yaw, pitch } (fit dist) | { yaw, pitch, dist, target }
//    sliceLine = false hides the cut line on the surface (saver granulation)
//  views.render(encoder, target, { w, h, dpr, pw?, ph? }, rects)
//    target = a GPUTexture (its size is used) or a GPUTextureView (then
//    pw x ph = the backing size, default round(w dpr) x round(h dpr)).
//    rects = layoutRects(...) in CSS px. One compute pass (view-prep.wgsl),
//    then ONE render pass with a transparent-black clear (view-draw.wgsl).
//  views.pickSurface(px, py, rects) -> { x, y } | null   (box units)
//  views.sliceFromDrag(p0, p1) -> { angle, offset } | null (p0, p1 box units)
//  views.segment() -> sliceSegment of the current slice
//  views.sectionRect(rects) -> { fluid, bar } in CSS px (for labels)
//  views.state, views.destroy()
//
//  Colour: the surface view maps T with its own smoothed min / max (crisp
//  pattern at any depth); the slice and the block share the section range
//  (one scale over the whole depth). auto = false uses T directly. Then
//  t = 0.5 + gain (tn - bias), defaults gain 1, bias 0.5.
//
//  The pure helpers below are JS copies of the WGSL in view-common.wgsl and
//  view-prep.wgsl / view-draw.wgsl (same names). tests/view.test.mjs checks
//  them against direct math.
//
//  grep -n targets: "export async function createViews", "export const VIEW_FIELDS",
//  "export function packView", "export function cellIndex", "export function sampleField",
//  "export function crWeights", "export function sectRowCoord", "export function fkey",
//  "export function funkey", "export function toneT", "export function refSurface",
//  "export function refSection", "export function sectSample", "export function surfSample",
//  "export function cutBlock", "export function blockGeometry", "export function arrowGrid",
//  "export function sectionCount", "export const DEFAULT_VIEW_STATE", "render(encoder"
// ============================================================================
import { PALETTES, lut } from './palettes.js';
import { sectionFit, sliceSegment, sliceFromPoints, surfaceToBox } from './layout.js';
import { orbitCam, fitBlock, clampCam } from './orbit.js';

export { layoutRects, sectionFit, sliceSegment, sliceFromPoints, surfaceToBox, boxToSurface, wrapOffset, zScaleLabel } from './layout.js';
export { orbitCam, fitBlock } from './orbit.js';

export const VIEW_FIELDS = Object.freeze(['viewProj', 'dims', 'box', 'seg', 'segB', 'tone', 'look', 'rSurf', 'rFluid', 'rBar', 'rBlock', 'over', 'eye']);
export const VIEW_FLOATS = 64;
const MAX_BLOCK_VERTS = 128, MAX_EDGES = 64;

export const DEFAULT_VIEW_STATE = Object.freeze({
  palette: 'solar', gain: 1, bias: 0.5, auto: true,
  slice: Object.freeze({ angle: 0, offset: 0 }),
  surfaceZ: 0.94, zScale: 1, tracers: true, arrows: false, isotherms: true,
  relief: 0.6, cam: null, streak: 0.6, sliceLine: true,
});

// ---- pure helpers (mirrors of the WGSL) ------------------------------------

export const wrapi = (i, n) => ((i % n) + n) % n;

export function cellIndex(i, j, k, d) {
  const kk = Math.min(d.nz - 1, Math.max(0, k));
  return wrapi(i, d.nx) + d.nx * (wrapi(j, d.ny) + d.ny * kk);
}

export function gridCoord(d, x, y, z) {
  return [x * (d.nx / d.Lx) - 0.5, y * (d.ny / d.Ly) - 0.5, Math.min(d.nz - 1, Math.max(0, z * d.nz - 0.5))];
}

// trilinear sample of a field (stride 1 for T, stride 4 + comp for vel)
export function sampleField(a, d, x, y, z, stride = 1, comp = 0) {
  const [gx, gy, gz] = gridCoord(d, x, y, z);
  const bx = Math.floor(gx), by = Math.floor(gy), bz = Math.floor(gz);
  const fx = gx - bx, fy = gy - by, fz = gz - bz;
  const at = (i, j, k) => a[cellIndex(i, j, k, d) * stride + comp];
  const m = (p, q, t) => p + (q - p) * t;
  const c00 = m(at(bx, by, bz), at(bx + 1, by, bz), fx);
  const c10 = m(at(bx, by + 1, bz), at(bx + 1, by + 1, bz), fx);
  const c01 = m(at(bx, by, bz + 1), at(bx + 1, by, bz + 1), fx);
  const c11 = m(at(bx, by + 1, bz + 1), at(bx + 1, by + 1, bz + 1), fx);
  return m(m(c00, c10, fy), m(c01, c11, fy), fz);
}

export function crWeights(t) {
  const t2 = t * t, t3 = t2 * t;
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
}

export function sectRowCoord(z, nz) {
  const h = 0.5 / nz, zc = Math.min(1, Math.max(0, z));
  if (zc <= h) return zc / h;
  if (zc >= 1 - h) return nz + (zc - (1 - h)) / h;
  return 1 + (zc - h) * nz;
}

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function fkey(f) {
  f32[0] = f;
  const b = u32[0];
  return (b & 0x80000000) !== 0 ? (~b) >>> 0 : (b | 0x80000000) >>> 0;
}
export function funkey(k) {
  u32[0] = (k & 0x80000000) !== 0 ? (k & 0x7fffffff) >>> 0 : (~k) >>> 0;
  return f32[0];
}

export function toneT(T, lo, hi, { gain = 1, bias = 0.5, auto = true } = {}) {
  const tn = auto ? (T - lo) / Math.max(hi - lo, 1e-4) : T;
  return Math.min(1, Math.max(0, 0.5 + gain * (tn - bias)));
}

// csSurface: (T, w, dw/dx, dw/dy) per column at surfaceZ
export function refSurface(T, vel, d, surfaceZ) {
  const out = new Float32Array(4 * d.nx * d.ny);
  const gz = Math.min(d.nz - 1, Math.max(0, surfaceZ * d.nz - 0.5));
  const k0 = Math.floor(gz), k1 = Math.min(k0 + 1, d.nz - 1), fz = gz - k0;
  const lay = (i, j) => {
    const a = cellIndex(i, j, k0, d), b = cellIndex(i, j, k1, d);
    return [T[a] + (T[b] - T[a]) * fz, vel[4 * a + 2] + (vel[4 * b + 2] - vel[4 * a + 2]) * fz];
  };
  const dxs = d.Lx / d.nx, dys = d.Ly / d.ny;
  for (let j = 0; j < d.ny; j++) for (let i = 0; i < d.nx; i++) {
    const c = lay(i, j), o = 4 * (i + d.nx * j);
    out[o] = c[0]; out[o + 1] = c[1];
    out[o + 2] = (lay(i + 1, j)[1] - lay(i - 1, j)[1]) / (2 * dxs);
    out[o + 3] = (lay(i, j + 1)[1] - lay(i, j - 1)[1]) / (2 * dys);
  }
  return out;
}

// csSection: (T, u_s, w, speed) at ns points along the cut x nz + 2 rows
export function refSection(T, vel, d, seg, ns) {
  const nzs = d.nz + 2, out = new Float32Array(4 * ns * nzs);
  const layer = (x, y, k) => {
    const g = [x * (d.nx / d.Lx) - 0.5, y * (d.ny / d.Ly) - 0.5];
    const bx = Math.floor(g[0]), by = Math.floor(g[1]), fx = g[0] - bx, fy = g[1] - by;
    const v = c => {
      const at = (i, j) => (c === 0 ? T[cellIndex(i, j, k, d)] : vel[4 * cellIndex(i, j, k, d) + c - 1]);
      const a = at(bx, by) + (at(bx + 1, by) - at(bx, by)) * fx;
      const b = at(bx, by + 1) + (at(bx + 1, by + 1) - at(bx, by + 1)) * fx;
      return a + (b - a) * fy;
    };
    return [v(0), v(1), v(2), v(3)];
  };
  for (let r = 0; r < nzs; r++) for (let i = 0; i < ns; i++) {
    const s = seg.len * (i / Math.max(ns - 1, 1));
    const x = seg.p0[0] + seg.dir[0] * s, y = seg.p0[1] + seg.dir[1] * s;
    let q;
    if (r === 0) { const a = layer(x, y, 0), b = layer(x, y, Math.min(1, d.nz - 1)); q = [1.5 * a[0] - 0.5 * b[0], 0, 0, 0]; }
    else if (r === d.nz + 1) { const a = layer(x, y, d.nz - 1), b = layer(x, y, Math.max(d.nz - 2, 0)); q = [1.5 * a[0] - 0.5 * b[0], a[1], a[2], 0]; }
    else q = layer(x, y, r - 1);
    const us = q[1] * seg.dir[0] + q[2] * seg.dir[1];
    const o = 4 * (i + ns * r);
    out[o] = q[0]; out[o + 1] = us; out[o + 2] = q[3]; out[o + 3] = Math.hypot(us, q[3]);
  }
  return out;
}

// sectAt: Catmull-Rom of the section, clamped at the ends
export function sectSample(sect, ns, nz, s01, z, comp = 0) {
  const nzs = nz + 2;
  const gx = Math.min(1, Math.max(0, s01)) * (ns - 1), gy = sectRowCoord(z, nz);
  const bx = Math.floor(gx), by = Math.floor(gy), wx = crWeights(gx - bx), wy = crWeights(gy - by);
  let acc = 0;
  for (let b = 0; b < 4; b++) {
    const jj = Math.min(nzs - 1, Math.max(0, by - 1 + b));
    let row = 0;
    for (let a = 0; a < 4; a++) row += sect[4 * (Math.min(ns - 1, Math.max(0, bx - 1 + a)) + ns * jj) + comp] * wx[a];
    acc += row * wy[b];
  }
  return acc;
}

// surfAt: periodic Catmull-Rom of the surface section
export function surfSample(surf, d, x, y, comp = 0) {
  const gx = x * (d.nx / d.Lx) - 0.5, gy = y * (d.ny / d.Ly) - 0.5;
  const bx = Math.floor(gx), by = Math.floor(gy), wx = crWeights(gx - bx), wy = crWeights(gy - by);
  let acc = 0;
  for (let b = 0; b < 4; b++) {
    const jj = wrapi(by - 1 + b, d.ny);
    let row = 0;
    for (let a = 0; a < 4; a++) row += surf[4 * (wrapi(bx - 1 + a, d.nx) + d.nx * jj) + comp] * wx[a];
    acc += row * wy[b];
  }
  return acc;
}

export function sectionCount(len, dx, nsMax) {
  return Math.min(nsMax, Math.max(2, Math.ceil(len / dx) + 1));
}

export function arrowGrid(fluidW, fluidH, spacing = 28) {
  return {
    na: Math.min(96, Math.max(3, Math.round(fluidW / spacing))),
    nza: Math.min(32, Math.max(2, Math.round(fluidH / spacing))),
  };
}

// ---- cutaway block geometry ------------------------------------------------

function clipPoly(pts, f) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

// The box minus the part on the eye side of the slice plane.
// -> [{ kind (0 top, 1 bottom, 2 side, 3 cut), n: outward normal, pts }]
export function cutBlock(seg, eye, Lx = 4, Ly = 4) {
  const faces = [
    { kind: 0, n: [0, 0, 1], pts: [[0, 0, 1], [Lx, 0, 1], [Lx, Ly, 1], [0, Ly, 1]] },
    { kind: 1, n: [0, 0, -1], pts: [[0, 0, 0], [0, Ly, 0], [Lx, Ly, 0], [Lx, 0, 0]] },
    { kind: 2, n: [0, -1, 0], pts: [[0, 0, 0], [Lx, 0, 0], [Lx, 0, 1], [0, 0, 1]] },
    { kind: 2, n: [1, 0, 0], pts: [[Lx, 0, 0], [Lx, Ly, 0], [Lx, Ly, 1], [Lx, 0, 1]] },
    { kind: 2, n: [0, 1, 0], pts: [[Lx, Ly, 0], [0, Ly, 0], [0, Ly, 1], [Lx, Ly, 1]] },
    { kind: 2, n: [-1, 0, 0], pts: [[0, Ly, 0], [0, 0, 0], [0, 0, 1], [0, Ly, 1]] },
  ];
  if (!seg || !(seg.len > 1e-4)) return faces;
  const ds = (eye[0] - seg.p0[0]) * seg.nrm[0] + (eye[1] - seg.p0[1]) * seg.nrm[1];
  const side = Math.sign(ds);
  if (side === 0) return faces;
  const f = p => side * ((p[0] - seg.p0[0]) * seg.nrm[0] + (p[1] - seg.p0[1]) * seg.nrm[1]);
  const out = [];
  for (const F of faces) {
    const pts = clipPoly(F.pts, f);
    if (pts.length >= 3) out.push({ ...F, pts });
  }
  const { p0, p1 } = seg;
  out.push({ kind: 3, n: [side * seg.nrm[0], side * seg.nrm[1], 0], pts: [[p0[0], p0[1], 0], [p1[0], p1[1], 0], [p1[0], p1[1], 1], [p0[0], p0[1], 1]] });
  return out;
}

// Front faces as a triangle list (x, y, z, kind) and their edges, deduped.
// eye in world units (z scaled by zScale).
export function blockGeometry(polys, eye, zScale = 1) {
  const tris = [], edges = [], seen = new Set();
  const key = p => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
  const faces = [];
  for (const P of polys) {
    const c = [0, 0, 0];
    for (const p of P.pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] * zScale; }
    c[0] /= P.pts.length; c[1] /= P.pts.length; c[2] /= P.pts.length;
    const v = P.n[0] * (eye[0] - c[0]) + P.n[1] * (eye[1] - c[1]) + P.n[2] * (eye[2] - c[2]);
    if (!(v > 1e-9)) continue;
    faces.push(P.kind);
    for (let i = 1; i + 1 < P.pts.length; i++) for (const p of [P.pts[0], P.pts[i], P.pts[i + 1]]) tris.push(p[0], p[1], p[2], P.kind);
    for (let i = 0; i < P.pts.length; i++) {
      const a = P.pts[i], b = P.pts[(i + 1) % P.pts.length];
      const ka = key(a), kb = key(b), k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (ka === kb || seen.has(k)) continue;
      seen.add(k);
      edges.push(a[0], a[1], a[2], 0, b[0], b[1], b[2], 0);
    }
  }
  return { tris: new Float32Array(tris), nv: tris.length / 4, edges: new Float32Array(edges), ne: edges.length / 8, faces };
}

// ---- uniform ---------------------------------------------------------------

export function packView(u) {
  const o = new Float32Array(VIEW_FLOATS);
  o.set(u.viewProj || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  const put = (i, a) => { o[16 + 4 * i] = a[0] || 0; o[17 + 4 * i] = a[1] || 0; o[18 + 4 * i] = a[2] || 0; o[19 + 4 * i] = a[3] || 0; };
  const R = r => (r ? [r.x, r.y, r.w, r.h] : [0, 0, 0, 0]);
  put(0, [u.nx, u.ny, u.nz, 1 / u.nz]);
  put(1, [u.Lx, u.Ly, u.zScale, u.surfaceZ]);
  put(2, [u.seg.p0[0], u.seg.p0[1], u.seg.dir[0], u.seg.dir[1]]);
  put(3, [u.seg.len, u.ns, u.nz + 2, u.slab]);
  put(4, [u.gain, u.bias, u.auto ? 1 : 0, u.srgb ? 1 : 0]);
  put(5, [u.relief, u.sheen, u.isotherms ? 1 : 0, u.dpr]);
  put(6, R(u.rSurf)); put(7, R(u.rFluid)); put(8, R(u.rBar)); put(9, R(u.rBlock));
  put(10, [u.tracerCount, u.na, u.nza, u.streak]);
  put(11, [u.eye ? u.eye[0] : 0, u.eye ? u.eye[1] : 0, u.eye ? u.eye[2] : 0, u.sliceLine === false ? 0 : 1]);
  return o;
}

// ---- GPU -------------------------------------------------------------------

const BU = { COPY_DST: 8, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
const SS = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const TU = { COPY_DST: 2, TEXTURE_BINDING: 4 };
const PREMUL = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

async function checkModule(mod, name) {
  if (!mod.getCompilationInfo) return;
  const info = await mod.getCompilationInfo();
  const errs = info.messages.filter(m => m.type === 'error');
  if (errs.length) throw new Error(`${name}: ${errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
}

export async function createViews(device, format, sim, { loadText } = {}) {
  const load = loadText || (async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.text(); });
  const url = n => new URL(`../shaders/${n}`, import.meta.url).href;
  const [common, prepSrc, drawSrc] = await Promise.all(['view-common.wgsl', 'view-prep.wgsl', 'view-draw.wgsl'].map(n => load(url(n))));
  const prepMod = device.createShaderModule({ label: 'tc view-prep', code: common + '\n' + prepSrc });
  const drawMod = device.createShaderModule({ label: 'tc view-draw', code: common + '\n' + drawSrc });
  await Promise.all([checkModule(prepMod, 'view-prep.wgsl'), checkModule(drawMod, 'view-draw.wgsl')]);

  const VF = SS.VERTEX | SS.FRAGMENT;
  const ro = { type: 'read-only-storage' };
  const drawBGL = device.createBindGroupLayout({
    label: 'tc view-draw', entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      ...[1, 2, 3, 4, 5, 6].map(binding => ({ binding, visibility: VF, buffer: ro })),
      { binding: 7, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 8, visibility: VF, sampler: { type: 'filtering' } },
    ],
  });
  const prepBGL = device.createBindGroupLayout({
    label: 'tc view-prep', entries: [
      { binding: 0, visibility: SS.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: SS.COMPUTE, buffer: ro },
      { binding: 2, visibility: SS.COMPUTE, buffer: ro },
      ...[3, 4, 5, 6].map(binding => ({ binding, visibility: SS.COMPUTE, buffer: { type: 'storage' } })),
    ],
  });
  const drawPL = device.createPipelineLayout({ bindGroupLayouts: [drawBGL] });
  const prepPL = device.createPipelineLayout({ bindGroupLayouts: [prepBGL] });

  const cp = entryPoint => device.createComputePipelineAsync({ label: `tc ${entryPoint}`, layout: prepPL, compute: { module: prepMod, entryPoint } });
  const rp = (vs, fs, blend, buffers = []) => device.createRenderPipelineAsync({
    label: `tc ${fs}`, layout: drawPL,
    vertex: { module: drawMod, entryPoint: vs, buffers },
    fragment: { module: drawMod, entryPoint: fs, targets: [blend ? { format, blend } : { format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });
  const blockBuf = [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }];
  const edgeBuf = [{ arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }];
  const [csSurface, csSection, csRange, pSurface, pSlice, pPlate, pArrow, pDot, pStreak, pBlock, pEdge] = await Promise.all([
    cp('csSurface'), cp('csSection'), cp('csRange'),
    rp('vsQuad', 'fsSurface'), rp('vsQuad', 'fsSlice'), rp('vsQuad', 'fsPlate'),
    rp('vsArrow', 'fsArrow', PREMUL), rp('vsDot', 'fsMark', PREMUL), rp('vsStreak', 'fsMark', PREMUL),
    rp('vsBlock', 'fsBlock', null, blockBuf), rp('vsEdge', 'fsEdge', PREMUL, edgeBuf),
  ]);

  const srgb = /-srgb$/.test(format);
  const uni = device.createBuffer({ label: 'tc view uniform', size: VIEW_FLOATS * 4, usage: BU.UNIFORM | BU.COPY_DST });
  const atoms = device.createBuffer({ label: 'tc view atoms', size: 32, usage: BU.STORAGE | BU.COPY_DST });
  const range = device.createBuffer({ label: 'tc view range', size: 32, usage: BU.STORAGE | BU.COPY_DST });
  const resetAtoms = () => device.queue.writeBuffer(atoms, 0, new Uint32Array([0xffffffff, 0, 0, 0xffffffff, 0, 0, 0, 0]));
  resetAtoms();
  device.queue.writeBuffer(range, 0, new Float32Array([0, 1, 0, 1, 0.1, 0.1, 0, 0]));
  const blockVB = device.createBuffer({ label: 'tc block faces', size: MAX_BLOCK_VERTS * 16, usage: BU.VERTEX | BU.COPY_DST });
  const edgeVB = device.createBuffer({ label: 'tc block edges', size: MAX_EDGES * 32, usage: BU.VERTEX | BU.COPY_DST });
  const dummy = device.createBuffer({ label: 'tc no tracers', size: 16, usage: BU.STORAGE });
  const lutTex = device.createTexture({ label: 'tc palette', size: [256, 1], format: 'rgba8unorm', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  const lutView = lutTex.createView();
  const smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  const state = { ...DEFAULT_VIEW_STATE, slice: { ...DEFAULT_VIEW_STATE.slice } };
  let lutId = null;
  const uploadLut = () => {
    if (lutId === state.palette) return;
    lutId = PALETTES[state.palette] ? state.palette : 'solar';
    state.palette = lutId;
    device.queue.writeTexture({ texture: lutTex }, lut(lutId, 256), { bytesPerRow: 1024 }, [256, 1]);
  };
  uploadLut();

  // per-dims resources and bind groups
  let res = null;
  const dimsOf = () => {
    const d = sim.dims;
    return { nx: d.nx, ny: d.ny, nz: d.nz, Lx: d.Lx || 4, Ly: d.Ly || 4, dx: d.dx || (d.Lx || 4) / d.nx };
  };
  function ensure() {
    const d = dimsOf(), B = sim.buffers || {};
    if (!B.T || !B.vel) return null;
    const tr = B.tracers || dummy;
    const sameDims = res && res.d.nx === d.nx && res.d.ny === d.ny && res.d.nz === d.nz && res.d.Lx === d.Lx && res.d.Ly === d.Ly;
    if (sameDims && res.T === B.T && res.vel === B.vel && res.tr === tr) return res;
    if (!sameDims) {
      if (res) { res.surf.destroy(); res.sect.destroy(); }
      const nsMax = Math.ceil(Math.hypot(d.Lx, d.Ly) / d.dx) + 2;
      res = {
        d, nsMax,
        surf: device.createBuffer({ label: 'tc surface section', size: Math.max(16, d.nx * d.ny * 16), usage: BU.STORAGE }),
        sect: device.createBuffer({ label: 'tc vertical section', size: Math.max(16, nsMax * (d.nz + 2) * 16), usage: BU.STORAGE }),
      };
      device.queue.writeBuffer(range, 0, new Float32Array([0, 1, 0, 1, 0.1, 0.1, 0, 0]));
      resetAtoms();
    }
    res.T = B.T; res.vel = B.vel; res.tr = tr;
    res.prepBG = device.createBindGroup({
      layout: prepBGL, entries: [
        { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: B.T } }, { binding: 2, resource: { buffer: B.vel } },
        { binding: 3, resource: { buffer: res.surf } }, { binding: 4, resource: { buffer: res.sect } },
        { binding: 5, resource: { buffer: atoms } }, { binding: 6, resource: { buffer: range } },
      ],
    });
    res.drawBG = device.createBindGroup({
      layout: drawBGL, entries: [
        { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: B.T } }, { binding: 2, resource: { buffer: B.vel } },
        { binding: 3, resource: { buffer: tr } }, { binding: 4, resource: { buffer: res.surf } }, { binding: 5, resource: { buffer: res.sect } },
        { binding: 6, resource: { buffer: range } }, { binding: 7, resource: lutView }, { binding: 8, resource: smp },
      ],
    });
    return res;
  }

  const views = {
    state,
    set(p = {}) {
      for (const k of ['palette', 'gain', 'bias', 'auto', 'tracers', 'arrows', 'isotherms', 'streak', 'sliceLine']) if (p[k] !== undefined) state[k] = p[k];
      if (p.slice) state.slice = { angle: p.slice.angle ?? state.slice.angle, offset: p.slice.offset ?? state.slice.offset };
      if (p.surfaceZ !== undefined) state.surfaceZ = Math.min(1, Math.max(0.5, +p.surfaceZ || 0.94));
      if (p.zScale !== undefined) state.zScale = Math.min(2.5, Math.max(1, +p.zScale || 1));
      if (p.relief !== undefined) state.relief = Math.min(1, Math.max(0, +p.relief || 0));
      if (p.cam !== undefined) state.cam = p.cam;
      uploadLut();
      return views;
    },
    segment() { const d = dimsOf(); return sliceSegment(state.slice, d.Lx, d.Ly); },
    sectionRect(rects) {
      if (!rects || !rects.slice) return null;
      return sectionFit(rects.slice, Math.max(1e-3, views.segment().len), state.zScale);
    },
    pickSurface(px, py, rects) { const d = dimsOf(); return surfaceToBox(px, py, rects && rects.surface, d.Lx, d.Ly); },
    sliceFromDrag(p0, p1) { const d = dimsOf(); return sliceFromPoints(p0, p1, d.Lx, d.Ly); },
    lastCam: null,

    render(encoder, target, size = {}, rects = {}) {
      const R = ensure();
      if (!R) return;
      const d = R.d;
      const tex = target && typeof target.createView === 'function' ? target : null;
      const view = tex ? tex.createView() : target;
      const pw = tex ? tex.width : (size.pw || Math.round((size.w || 1) * (size.dpr || 1)));
      const ph = tex ? tex.height : (size.ph || Math.round((size.h || 1) * (size.dpr || 1)));
      const k = size.w > 0 ? pw / size.w : (size.dpr || 1);
      const dev = r => {
        if (!r) return null;
        const x0 = Math.max(0, r.x * k), y0 = Math.max(0, r.y * k);
        const x1 = Math.min(pw, (r.x + r.w) * k), y1 = Math.min(ph, (r.y + r.h) * k);
        return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
      };
      const seg = sliceSegment(state.slice, d.Lx, d.Ly);
      const ns = sectionCount(seg.len, d.dx, R.nsMax);
      const pal = PALETTES[state.palette] || PALETTES.solar;
      const rSurf = dev(rects.surface);
      let rFluid = null, rBar = null, na = 3, nza = 2;
      if (rects.slice) {
        const sf = sectionFit(rects.slice, Math.max(1e-3, seg.len), state.zScale);
        rFluid = dev(sf.fluid); rBar = dev(sf.bar);
        ({ na, nza } = arrowGrid(sf.fluid.w, sf.fluid.h));
      }
      const rBlock = dev(rects.block);
      let cam = null, geo = null;
      if (rBlock) {
        const aspect = rBlock.w / rBlock.h;
        const c = state.cam ? clampCam(state.cam) : null;
        const fitted = fitBlock({ Lx: d.Lx, Ly: d.Ly, Lz: state.zScale }, aspect, c ? { yaw: c.yaw, pitch: c.pitch } : {});
        const use = c && state.cam && Number.isFinite(state.cam.dist) ? { ...fitted, ...c, target: state.cam.target || fitted.target } : fitted;
        cam = orbitCam({ ...use, aspect, tilt: true });
        views.lastCam = cam;
        geo = blockGeometry(cutBlock(seg, cam.eye, d.Lx, d.Ly), cam.eye, state.zScale);
        if (geo.nv) device.queue.writeBuffer(blockVB, 0, geo.tris.subarray(0, Math.min(geo.tris.length, MAX_BLOCK_VERTS * 4)));
        if (geo.ne) device.queue.writeBuffer(edgeVB, 0, geo.edges.subarray(0, Math.min(geo.edges.length, MAX_EDGES * 8)));
      }
      const tracerCount = state.tracers && sim.buffers && sim.buffers.tracers ? Math.max(0, sim.tracerCount | 0) : 0;
      device.queue.writeBuffer(uni, 0, packView({
        viewProj: cam ? cam.viewProj : null,
        nx: d.nx, ny: d.ny, nz: d.nz, Lx: d.Lx, Ly: d.Ly, zScale: state.zScale, surfaceZ: state.surfaceZ,
        seg, ns, slab: Math.max(1.5 * d.dx, 0.05),
        gain: state.gain, bias: state.bias, auto: state.auto, srgb,
        relief: state.relief * pal.relief, sheen: pal.sheen, isotherms: state.isotherms, dpr: k,
        rSurf, rFluid, rBar, rBlock, tracerCount, na, nza, streak: state.streak,
        eye: cam ? cam.eye : null, sliceLine: state.sliceLine !== false,
      }));

      const cpass = encoder.beginComputePass({ label: 'tc view prep' });
      cpass.setBindGroup(0, R.prepBG);
      cpass.setPipeline(csSurface); cpass.dispatchWorkgroups(Math.ceil(d.nx / 8), Math.ceil(d.ny / 8));
      cpass.setPipeline(csSection); cpass.dispatchWorkgroups(Math.ceil(ns / 8), Math.ceil((d.nz + 2) / 8));
      cpass.setPipeline(csRange); cpass.dispatchWorkgroups(1);
      cpass.end();

      const pass = encoder.beginRenderPass({
        label: 'tc views',
        colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setBindGroup(0, R.drawBG);
      const vp = r => {
        pass.setViewport(r.x, r.y, r.w, r.h, 0, 1);
        const sx = Math.floor(r.x), sy = Math.floor(r.y);
        pass.setScissorRect(sx, sy, Math.max(1, Math.min(pw - sx, Math.ceil(r.x + r.w) - sx)), Math.max(1, Math.min(ph - sy, Math.ceil(r.y + r.h) - sy)));
      };
      if (rSurf) {
        vp(rSurf);
        pass.setPipeline(pSurface); pass.draw(6);
        if (tracerCount) { pass.setPipeline(pDot); pass.draw(6, tracerCount); }
      }
      if (rFluid) {
        vp(rFluid);
        pass.setPipeline(pSlice); pass.draw(6);
        if (state.arrows) { pass.setPipeline(pArrow); pass.draw(6, na * nza); }
        if (tracerCount) { pass.setPipeline(pStreak); pass.draw(6, tracerCount); }
        if (rBar) { vp(rBar); pass.setPipeline(pPlate); pass.draw(6); }
      }
      if (rBlock && geo) {
        vp(rBlock);
        if (geo.nv) { pass.setPipeline(pBlock); pass.setVertexBuffer(0, blockVB); pass.draw(Math.min(geo.nv, MAX_BLOCK_VERTS)); }
        if (geo.ne) { pass.setPipeline(pEdge); pass.setVertexBuffer(0, edgeVB); pass.draw(6, Math.min(geo.ne, MAX_EDGES)); }
      }
      pass.end();
    },

    destroy() {
      for (const b of [uni, atoms, range, blockVB, edgeVB, dummy]) b.destroy();
      lutTex.destroy();
      if (res) { res.surf.destroy(); res.sect.destroy(); res = null; }
    },
  };
  return views;
}
