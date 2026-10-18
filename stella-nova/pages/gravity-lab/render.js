// ============================================================================
//  GRAVITY LAB  ·  render.js — the WebGPU renderer (no DOM beyond the canvas)
// ----------------------------------------------------------------------------
//  Draws one Lab (engine.js): the bodies from a small instance buffer the
//  CPU writes each frame, the particles straight from the Lab's GPU rows
//  (nothing is copied to the CPU for drawing), and line segments (trails,
//  the predicted path of a throw, the throw arrow, guides).
//
//  FRAME
//    scene   rgba16float + depth32float, reversed Z (clear 0, 'greater-
//            equal'): sky (no depth), bodies (exact spheres, depth from
//            the hit point), particles (additive), lines (over)
//    bloom   LEVELS half-size levels down (a threshold on the first), then
//            up with a tent filter. Only light far above white passes the
//            threshold: stars, cores, impact flashes.
//    final   scene + bloom, exposure, ACES, vignette, sRGB -> canvas
//
//  COORDINATES. Everything is in frame coordinates (shaders/bodies.wgsl
//  header): the CPU passes the frame (c, theta) in the camera uniform and
//  writes bodies and segments already in frame coordinates; points.wgsl
//  moves each particle row into the frame on the GPU.
//
//  CAMERA UNIFORM (CAM_FLOATS floats, the WGSL struct Cam): vp, eye (w sim
//  time), right (w focal px), up (w device px per CSS px), fwd (w 1),
//  vpSize, frame, l0, l1, c0, c1, p0, p1, vref. writeCam() fills it.
//
//  grep -n targets
//    math ................ "export const M4"
//    pipelines ........... "_make("
//    targets ............. "resize("
//    particle buffers .... "setLab("
//    group colours ....... "setColors("
//    bodies .............. "setBodies("
//    segments ............ "setSegments("
//    camera uniform ...... "writeCam("
//    one frame ........... "render("
//    projection .......... "project("
// ============================================================================

import { tiltEye } from '../../lib/tilt.js';

const HDR = 'rgba16float';
const DEPTH = 'depth32float';
const LEVELS = 5;
export const CAM_FLOATS = 68;
export const BODY_FLOATS = 12;
export const SEG_FLOATS = 12;
export const MAX_BODIES = 32;

// ── 4x4 matrices, column-major (WGSL mat4x4f) ─────────────────────────────
export const M4 = {
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  // reversed-Z infinite perspective: z/w = near / depth (1 at near, 0 far).
  // shiftY moves the image centre by that much in NDC (+ is up).
  persp(fovy, aspect, near, shiftY = 0) { const f = 1 / Math.tan(fovy / 2); const o = new Float32Array(16); o[0] = f / aspect; o[5] = f; o[9] = -shiftY; o[11] = -1; o[14] = near; return o; },
  lookAt(eye, at, up) {
    const f = norm(sub(at, eye)), r = norm(cross(f, up)), u = cross(r, f);
    const o = new Float32Array(16);
    o[0] = r[0]; o[4] = r[1]; o[8] = r[2]; o[12] = -dot(r, eye);
    o[1] = u[0]; o[5] = u[1]; o[9] = u[2]; o[13] = -dot(u, eye);
    o[2] = -f[0]; o[6] = -f[1]; o[10] = -f[2]; o[14] = dot(f, eye);
    o[15] = 1;
    return { m: o, r, u, f };
  },
};
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export async function loadRenderCode() {
  const names = ['bodies', 'points', 'lines', 'post'];
  const out = {};
  await Promise.all(names.map(async n => {
    const r = await fetch(new URL(`./shaders/${n}.wgsl`, import.meta.url));
    if (!r.ok) throw new Error(`${n}.wgsl: HTTP ${r.status}`);
    out[n] = await r.text();
  }));
  return out;
}

const PREMUL = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
const ADD = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };

export class Renderer {
  constructor(device, context, format, code) {
    this.dev = device; this.ctx = context; this.format = format;
    this.modules = {};
    for (const [k, v] of Object.entries(code)) this.modules[k] = device.createShaderModule({ code: v, label: 'glab ' + k + '.wgsl' });
    this.cam = new Float32Array(CAM_FLOATS);
    this.vp = new Float32Array(16);
    this.nBodies = 0; this.nSegs = 0; this.segCap = 0; this.np = 0;
    this.W = 0; this.H = 0;
    this.bloomStrength = 0.1; this.exposure = 1; this.threshold = 2.2; this.vignette = 0.35;
    this._make();
  }
  async compilationMessages() {
    const out = [];
    for (const [k, m] of Object.entries(this.modules)) { const info = await m.getCompilationInfo(); for (const x of info.messages) out.push(`${k}.wgsl ${x.type} ${x.lineNum}:${x.linePos} ${x.message}`); }
    return out;
  }
  _make() {
    const dev = this.dev, U = GPUBufferUsage, M = this.modules;
    this.camBuf = dev.createBuffer({ size: CAM_FLOATS * 4, usage: U.UNIFORM | U.COPY_DST });
    this.bodyBuf = dev.createBuffer({ size: MAX_BODIES * BODY_FLOATS * 4, usage: U.STORAGE | U.COPY_DST });
    this._segBuf(4096);
    // a stand-in particle set (one parked row) until setLab
    this.dummyRows = dev.createBuffer({ size: 48, usage: U.STORAGE | U.COPY_DST });
    this.dummyDiag = dev.createBuffer({ size: 16, usage: U.STORAGE | U.COPY_DST });
    this.colorBuf = dev.createBuffer({ size: 16, usage: U.STORAGE | U.COPY_DST });
    const depth = (write, cmp) => ({ format: DEPTH, depthWriteEnabled: write, depthCompare: cmp });
    const tgt = blend => [{ format: HDR, blend }];
    const rp = (mod, vs, fs, targets, ds) => dev.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: vs }, fragment: { module: mod, entryPoint: fs, targets }, primitive: { topology: 'triangle-list' }, depthStencil: ds });
    this.pSky = rp(M.bodies, 'vs_full', 'fs_sky', tgt(undefined), depth(false, 'always'));
    this.pBody = rp(M.bodies, 'vs_body', 'fs_body', tgt(PREMUL), depth(true, 'greater-equal'));
    this.pPts = rp(M.points, 'vs_main', 'fs_main', tgt(ADD), depth(false, 'greater-equal'));
    this.pLine = rp(M.lines, 'vs_main', 'fs_main', tgt(PREMUL), depth(false, 'greater-equal'));
    const pp = (fs, fmt, blend) => dev.createRenderPipeline({ layout: 'auto', vertex: { module: M.post, entryPoint: 'vs_full' }, fragment: { module: M.post, entryPoint: fs, targets: [{ format: fmt, blend }] }, primitive: { topology: 'triangle-list' } });
    this.pDown = pp('fs_down', HDR);
    this.pUp = pp('fs_up', HDR, ADD);
    this.pFinal = pp('fs_final', this.format);
    this.samp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.ppBufs = Array.from({ length: 2 * LEVELS + 1 }, () => dev.createBuffer({ size: 32, usage: U.UNIFORM | U.COPY_DST }));
    this.bgSky = dev.createBindGroup({ layout: this.pSky.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.camBuf } }] });
    this.bgBody = dev.createBindGroup({ layout: this.pBody.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.camBuf } }, { binding: 1, resource: { buffer: this.bodyBuf } }] });
    this._bgLines();
    this.setLab(null);
  }
  _segBuf(n) {
    if (this.segBuf) this.segBuf.destroy();
    this.segCap = n;
    this.segBuf = this.dev.createBuffer({ size: n * SEG_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }
  _bgLines() {
    this.bgLine = this.dev.createBindGroup({ layout: this.pLine.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.camBuf } }, { binding: 1, resource: { buffer: this.segBuf } }] });
  }
  // The particle rows of a Lab backend (or null): binds its bufBody and
  // bufDiag, and makes the colour buffer (one u32 per row).
  setLab(be) {
    const dev = this.dev;
    this.np = be ? be.cap : 0;
    if (this.colorBuf) this.colorBuf.destroy();
    this.colorBuf = dev.createBuffer({ size: Math.max(16, this.np * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bgPts = dev.createBindGroup({ layout: this.pPts.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.camBuf } }, { binding: 1, resource: { buffer: this.bodyBuf } },
      { binding: 2, resource: { buffer: be ? be.bufBody : this.dummyRows } }, { binding: 3, resource: { buffer: be ? be.bufDiag : this.dummyDiag } },
      { binding: 4, resource: { buffer: this.colorBuf } }] });
  }
  // rows start .. start + u32.length - 1 get the packed colours
  setColors(start, u32) {
    if (!u32.length || start >= this.np) return;
    const n = Math.min(u32.length, this.np - start);
    this.dev.queue.writeBuffer(this.colorBuf, start * 4, u32.buffer, u32.byteOffset, n * 4);
  }
  // f: Float32Array, BODY_FLOATS per body (pos.xyz r, rgb kind, seed sel glow 0)
  setBodies(f, n) {
    this.nBodies = Math.min(n, MAX_BODIES);
    if (this.nBodies) this.dev.queue.writeBuffer(this.bodyBuf, 0, f.buffer, f.byteOffset, this.nBodies * BODY_FLOATS * 4);
  }
  // f: Float32Array, SEG_FLOATS per segment (lines.wgsl Seg)
  setSegments(f, n) {
    if (n > this.segCap) { let c = this.segCap; while (c < n) c *= 2; this._segBuf(c); this._bgLines(); }
    this.nSegs = n;
    if (n) this.dev.queue.writeBuffer(this.segBuf, 0, f.buffer, f.byteOffset, n * SEG_FLOATS * 4);
  }
  resize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    const dev = this.dev, T = GPUTextureUsage;
    for (const t of [this.hdr, this.depth, ...(this.levels || [])]) if (t) t.destroy();
    this.hdr = dev.createTexture({ size: [w, h], format: HDR, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
    this.depth = dev.createTexture({ size: [w, h], format: DEPTH, usage: T.RENDER_ATTACHMENT });
    this.levels = []; this.lsize = [];
    let lw = w, lh = h;
    for (let k = 0; k < LEVELS; k++) {
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
      this.lsize.push([lw, lh]);
      this.levels.push(dev.createTexture({ size: [lw, lh], format: HDR, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING }));
    }
    this.hdrView = this.hdr.createView(); this.depthView = this.depth.createView();
    this.lviews = this.levels.map(t => t.createView());
    // pass uniforms and bind groups: down 0..LEVELS-1, up LEVELS-1..1, final
    const ppw = (buf, tx, ty, first) => { const a = new Float32Array(8); a[0] = tx; a[1] = ty; a[2] = this.threshold; a[3] = first; this.dev.queue.writeBuffer(buf, 0, a); };
    this.bgDown = []; this.bgUp = [];
    for (let k = 0; k < LEVELS; k++) {
      const srcView = k === 0 ? this.hdrView : this.lviews[k - 1];
      const [sw, sh] = k === 0 ? [w, h] : this.lsize[k - 1];
      ppw(this.ppBufs[k], 1 / sw, 1 / sh, k === 0 ? 1 : 0);
      this.bgDown.push(dev.createBindGroup({ layout: this.pDown.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.ppBufs[k] } }, { binding: 1, resource: srcView }, { binding: 2, resource: this.samp }] }));
    }
    for (let k = LEVELS - 1; k >= 1; k--) {
      const [sw, sh] = this.lsize[k];
      ppw(this.ppBufs[LEVELS + k - 1], 1 / sw, 1 / sh, 0);
      this.bgUp[k] = dev.createBindGroup({ layout: this.pUp.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.ppBufs[LEVELS + k - 1] } }, { binding: 1, resource: this.lviews[k] }, { binding: 2, resource: this.samp }] });
    }
    this.bgFinal = dev.createBindGroup({ layout: this.pFinal.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.ppBufs[2 * LEVELS] } }, { binding: 1, resource: this.hdrView }, { binding: 2, resource: this.samp }, { binding: 3, resource: this.lviews[0] }] });
  }
  // c: { eye, target, up, fovy, near, shiftY, t, frame: [cx, cy, cz, theta],
  //      lights: [{ pos, point, color, I }] (at most 2), minBodyPx,
  //      minPtPx, flashT, colorMode, gain, speedScale, skyGain, vref, dpr }
  writeCam(c) {
    const W = this.W, H = this.H, a = this.cam;
    const eye = tiltEye(c.eye, c.target, c.up || [0, 0, 1]); // lib/tilt.js: phone tilt parallax
    const P = M4.persp(c.fovy, W / H, c.near, c.shiftY || 0), V = M4.lookAt(eye, c.target, c.up || [0, 0, 1]);
    this.vp = M4.mul(P, V.m); this.basis = V;
    a.set(this.vp, 0);
    const focal = 0.5 * H / Math.tan(c.fovy / 2);
    this.focal = focal;
    const put = (o, v, w) => { a[o] = v[0]; a[o + 1] = v[1]; a[o + 2] = v[2]; a[o + 3] = w; };
    put(16, eye, c.t || 0);
    put(20, V.r, focal);
    put(24, V.u, c.dpr || 1);
    put(28, V.f, 1);
    a[32] = W; a[33] = H; a[34] = 1 / W; a[35] = 1 / H;
    const fr = c.frame || [0, 0, 0, 0];
    a[36] = fr[0]; a[37] = fr[1]; a[38] = fr[2]; a[39] = fr[3];
    const L = c.lights || [];
    for (let k = 0; k < 2; k++) {
      const l = L[k];
      if (l) { put(40 + 4 * k, l.pos, l.point ? 1 : 0); put(48 + 4 * k, l.color, l.I); }
      else { put(40 + 4 * k, [0, 0, 1], 0); put(48 + 4 * k, [0, 0, 0], 0); }
    }
    a[56] = c.minBodyPx ?? 2.5; a[57] = c.minPtPx ?? 1.1; a[58] = c.flashT ?? 1; a[59] = c.colorMode ?? 0;
    a[60] = c.gain ?? 0.6; a[61] = c.speedScale ?? 1; a[62] = this.nBodies; a[63] = c.skyGain ?? 1;
    const vr = c.vref || [0, 0, 0];
    a[64] = vr[0]; a[65] = vr[1]; a[66] = vr[2]; a[67] = 0;
    this.dev.queue.writeBuffer(this.camBuf, 0, a);
    const fin = new Float32Array(8);
    fin[4] = this.bloomStrength; fin[5] = this.exposure; fin[6] = this.vignette;
    this.dev.queue.writeBuffer(this.ppBufs[2 * LEVELS], 0, fin);
  }
  // frame point -> { x, y (device px from the top left), w (view depth) }
  project(p) {
    const m = this.vp;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 0) return null;
    return { x: (x / w * 0.5 + 0.5) * this.W, y: (0.5 - y / w * 0.5) * this.H, w };
  }
  render() {
    if (!this.W) return;
    const dev = this.dev, enc = dev.createCommandEncoder();
    const scene = enc.beginRenderPass({
      colorAttachments: [{ view: this.hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    scene.setPipeline(this.pSky); scene.setBindGroup(0, this.bgSky); scene.draw(3);
    if (this.nBodies) { scene.setPipeline(this.pBody); scene.setBindGroup(0, this.bgBody); scene.draw(6, this.nBodies); }
    if (this.np) { scene.setPipeline(this.pPts); scene.setBindGroup(0, this.bgPts); scene.draw(6, this.np); }
    if (this.nSegs) { scene.setPipeline(this.pLine); scene.setBindGroup(0, this.bgLine); scene.draw(6, this.nSegs); }
    scene.end();
    const pass = (view, pipe, bg, load) => {
      const p = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: load ? 'load' : 'clear', storeOp: 'store' }] });
      p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
    };
    for (let k = 0; k < LEVELS; k++) pass(this.lviews[k], this.pDown, this.bgDown[k], false);
    for (let k = LEVELS - 1; k >= 1; k--) pass(this.lviews[k - 1], this.pUp, this.bgUp[k], true);
    pass(this.ctx.getCurrentTexture().createView(), this.pFinal, this.bgFinal, false);
    dev.queue.submit([enc.finish()]);
  }
  destroy() {
    for (const t of [this.hdr, this.depth, ...(this.levels || [])]) if (t) t.destroy();
    for (const b of [this.camBuf, this.bodyBuf, this.segBuf, this.colorBuf, this.dummyRows, this.dummyDiag, ...this.ppBufs]) b.destroy();
  }
}
