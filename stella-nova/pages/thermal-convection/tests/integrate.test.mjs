// integrate (package INTEGRATE): the real SIM, VIEW, SAVER and UI modules
// together on a fake WebGPU device that checks the API rules a browser
// checks. No browser runs here (project rule), so this test is the seam
// check between the packages.
//
//  The fake device (checkDevice) parses each WGSL module: the bindings it
//  declares and the bindings that each entry point reaches through its
//  calls. It reports an error when:
//    - a pipeline entry point is missing or has the wrong stage attribute
//    - an entry point uses a binding that its bind group layout does not
//      have, or with a different type (uniform, read-only-storage, storage,
//      texture, sampler) or without the visibility of its stage
//    - a vertex stage uses read_write storage
//    - a bind group does not match its layout, or binds a buffer without
//      the STORAGE or UNIFORM usage that the layout entry needs
//    - a dispatch or a draw has no pipeline or a bind group of an other
//      layout, a workgroup count is out of 1..65535, or one dispatch binds
//      the same buffer as writable storage and as a second binding
//    - a viewport or a scissor rect goes out of the target
//    - writeBuffer, copyBufferToBuffer or clearBuffer misses COPY_DST or
//      COPY_SRC, goes past the end, or is not 4-byte aligned
//    - mapAsync runs on a buffer without MAP_READ or that is not unmapped,
//      or a submit copies into a buffer that is mapped or mapping
//    - a destroyed buffer is used
//
//  Part A (no DOM): createSim + createViews on the fake device, frames in
//  every view, the stats readback.
//  Part B (jsdom on NODE_PATH, else skipped): main.js boots on the fake
//  device, frames run, the screensaver enters, cuts to every shot kind,
//  shows the real WGSL extract, and exits; a lost device boots again.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSim } from '../sim/gpu.js';
import { PRESETS, clampParams, DEFAULTS } from '../sim/params.js';
import { createViews } from '../render/views.js';
import { layoutRects } from '../render/layout.js';
import { fitBlock, orbitCam } from '../render/orbit.js';
import { CODE_SOURCE, KINDS, extractWgsl } from '../director.js';

const page = new URL('../', import.meta.url);
const fileText = async u => readFileSync(fileURLToPath(new URL(u, page)), 'utf8');

// ── WGSL parse ───────────────────────────────────────────────────────────
function parseWgsl(code) {
  const src = code.replace(/\/\/[^\n]*/g, '');
  const vars = {};
  const re = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]*)>)?\s+(\w+)\s*:\s*([^;]+);/g;
  for (let m; (m = re.exec(src));) {
    const q = (m[3] || '').split(',').map(s => s.trim());
    const ty = m[5].trim();
    let kind;
    if (q[0] === 'uniform') kind = 'uniform';
    else if (q[0] === 'storage') kind = q[1] === 'read_write' ? 'storage' : 'read-only-storage';
    else if (/^texture_/.test(ty)) kind = 'texture';
    else if (/^sampler/.test(ty)) kind = 'sampler';
    else kind = 'other';
    vars[m[4]] = { group: +m[1], binding: +m[2], kind };
  }
  const fns = {};
  const fre = /((?:@\w+(?:\([^)]*\))?\s*)*)fn\s+(\w+)\s*\(/g;
  for (let m; (m = fre.exec(src));) {
    let i = src.indexOf('{', m.index + m[0].length);
    const b0 = i;
    let d = 0;
    for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
    const attrs = m[1] || '';
    const stage = /@compute/.test(attrs) ? 'compute' : /@vertex/.test(attrs) ? 'vertex' : /@fragment/.test(attrs) ? 'fragment' : null;
    fns[m[2]] = { stage, body: src.slice(m.index + m[0].length, i + 1), start: b0 };
  }
  // global consts and helper fns reach bindings too: walk the call graph
  const used = name => {
    const seen = new Set(), out = new Set(), stack = [name];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f) || !fns[f]) continue;
      seen.add(f);
      for (const t of fns[f].body.match(/\b[A-Za-z_]\w*\b/g) || []) {
        if (vars[t]) out.add(t);
        if (fns[t] && !seen.has(t)) stack.push(t);
      }
    }
    return [...out].map(v => ({ name: v, ...vars[v] }));
  };
  return { vars, fns, used };
}

// ── fake device ──────────────────────────────────────────────────────────
const BU = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
const VIS = { vertex: 1, fragment: 2, compute: 4 };
export function checkDevice() {
  const errors = [], stats = { dispatch: {}, draws: 0, renderPasses: 0, computePasses: 0, submits: 0, buffers: 0, maps: 0 };
  const err = m => { if (errors.length < 200) errors.push(m); };
  let lostRes = null;
  const tex = { width: 1, height: 1 };
  const live = b => { if (b.destroyed) err(`use of destroyed buffer ${b.label}`); };
  const device = {
    errors, stats, tex,
    lost: new Promise(r => { lostRes = r; }),
    loseNow(reason = 'unknown') { lostRes({ reason, message: 'test' }); },
    limits: { maxStorageBuffersPerShaderStage: 8, maxComputeWorkgroupsPerDimension: 65535 },
    createBuffer(d) {
      stats.buffers++;
      if (!(d.size > 0) || d.size % 4) err(`buffer ${d.label} size ${d.size}`);
      if (d.size > 128 * 1024 * 1024 && d.usage & BU.STORAGE) err(`storage buffer ${d.label} over 128 MB`);
      if ((d.usage & BU.MAP_READ) && (d.usage & ~(BU.MAP_READ | BU.COPY_DST))) err(`MAP_READ buffer ${d.label} has other usages`);
      const b = {
        label: d.label, size: d.size, usage: d.usage, destroyed: false, mapState: 'unmapped', data: new ArrayBuffer(d.size),
        destroy() { b.destroyed = true; },
        mapAsync(_mode) {
          stats.maps++;
          if (!(b.usage & BU.MAP_READ)) err(`mapAsync on ${b.label} without MAP_READ`);
          if (b.mapState !== 'unmapped') err(`mapAsync on ${b.label} in state ${b.mapState}`);
          b.mapState = 'pending';
          return Promise.resolve().then(() => { b.mapState = 'mapped'; });
        },
        getMappedRange() { if (b.mapState !== 'mapped') err(`getMappedRange on ${b.label} in state ${b.mapState}`); return b.data; },
        unmap() { b.mapState = 'unmapped'; },
      };
      return b;
    },
    createShaderModule({ code, label }) {
      const parsed = parseWgsl(code);
      return { label, code, parsed, getCompilationInfo: async () => ({ messages: [] }) };
    },
    createBindGroupLayout(d) {
      const ids = d.entries.map(e => e.binding);
      if (new Set(ids).size !== ids.length) err(`layout ${d.label} repeats a binding`);
      for (const st of ['vertex', 'fragment', 'compute']) {
        const n = d.entries.filter(e => (e.visibility & VIS[st]) && e.buffer && /storage/.test(e.buffer.type || 'uniform')).length;
        if (n > 8) err(`layout ${d.label}: ${n} storage buffers in the ${st} stage`);
      }
      return { label: d.label, entries: d.entries };
    },
    createPipelineLayout(d) { return { bgls: d.bindGroupLayouts }; },
    createBindGroup(d) {
      const L = d.layout;
      const a = L.entries.map(e => e.binding).sort().join(','), b = d.entries.map(e => e.binding).sort().join(',');
      if (a !== b) err(`bind group ${d.label || L.label}: bindings ${b} vs layout ${a}`);
      for (const e of d.entries) {
        const le = L.entries.find(x => x.binding === e.binding);
        if (!le) continue;
        if (le.buffer) {
          const buf = e.resource && e.resource.buffer;
          if (!buf) { err(`bind group ${L.label} binding ${e.binding}: no buffer`); continue; }
          live(buf);
          const t = le.buffer.type || 'uniform';
          if (t === 'uniform' && !(buf.usage & BU.UNIFORM)) err(`${L.label} binding ${e.binding}: ${buf.label} lacks UNIFORM`);
          if (/storage/.test(t) && !(buf.usage & BU.STORAGE)) err(`${L.label} binding ${e.binding}: ${buf.label} lacks STORAGE`);
        } else if (le.texture && !(e.resource && e.resource.isTextureView)) err(`${L.label} binding ${e.binding}: not a texture view`);
        else if (le.sampler && !(e.resource && e.resource.isSampler)) err(`${L.label} binding ${e.binding}: not a sampler`);
      }
      return { layout: L, entries: d.entries, label: d.label };
    },
    async createComputePipelineAsync(d) { return mkPipe(d, [['compute', d.compute]]); },
    async createRenderPipelineAsync(d) { return mkPipe(d, [['vertex', d.vertex], ['fragment', d.fragment]]); },
    createTexture(d) { const t = { ...d, destroy() {}, createView: () => ({ isTextureView: true, tex: t }) }; return t; },
    createSampler() { return { isSampler: true }; },
    createCommandEncoder() { return mkEncoder(); },
    queue: {
      writeBuffer(b, off, data, dOff = 0, size) {
        live(b);
        const n = size ?? (data.byteLength - dOff * (data.BYTES_PER_ELEMENT || 1));
        if (!(b.usage & BU.COPY_DST)) err(`writeBuffer to ${b.label} without COPY_DST`);
        if (off % 4 || n % 4) err(`writeBuffer to ${b.label} not 4-byte aligned`);
        if (off + n > b.size) err(`writeBuffer to ${b.label} past the end: ${off + n} > ${b.size}`);
        if (b.mapState !== 'unmapped') err(`writeBuffer to mapped ${b.label}`);
      },
      writeTexture() {},
      submit(cbs) {
        stats.submits++;
        for (const cb of cbs) {
          if (!cb || !cb.finished) err('submit of an unfinished command buffer');
          for (const c of cb.copies || []) if (c.mapState !== 'unmapped') err(`submit copies into ${c.label} in state ${c.mapState}`);
          for (const bb of cb.uses || []) live(bb);
        }
      },
    },
    destroy() { lostRes({ reason: 'destroyed' }); },
  };

  function mkPipe(d, stages) {
    const bgl = d.layout && d.layout.bgls ? d.layout.bgls[0] : null;
    if (!bgl) err(`pipeline ${d.label}: no explicit layout`);
    for (const [st, s] of stages) {
      if (!s) continue;
      const P = s.module.parsed, f = P.fns[s.entryPoint];
      if (!f) { err(`${d.label}: entry point ${s.entryPoint} is not in ${s.module.label}`); continue; }
      if (f.stage !== st) err(`${d.label}: ${s.entryPoint} is @${f.stage}, used as ${st}`);
      for (const u of P.used(s.entryPoint)) {
        if (u.group !== 0) { err(`${s.entryPoint}: group ${u.group}`); continue; }
        const le = bgl && bgl.entries.find(e => e.binding === u.binding);
        if (!le) { err(`${s.entryPoint} (${s.module.label}) uses ${u.name} @binding(${u.binding}), not in layout ${bgl && bgl.label}`); continue; }
        if (!(le.visibility & VIS[st])) err(`${s.entryPoint}: binding ${u.binding} not visible to ${st}`);
        const lk = le.buffer ? (le.buffer.type || 'uniform') : le.texture ? 'texture' : le.sampler ? 'sampler' : 'other';
        if (lk !== u.kind) err(`${s.entryPoint}: ${u.name} @binding(${u.binding}) is ${u.kind} in WGSL, ${lk} in layout ${bgl.label}`);
        if (st === 'vertex' && u.kind === 'storage') err(`${s.entryPoint}: read_write storage ${u.name} in a vertex shader`);
      }
    }
    return { label: d.label, bgl, buffers: (d.vertex && d.vertex.buffers) || [], kind: d.compute ? 'compute' : 'render', targets: d.fragment && d.fragment.targets };
  }

  function bindCheck(where, pipe, bg) {
    if (!pipe) { err(`${where}: no pipeline`); return false; }
    if (!bg) { err(`${where} ${pipe.label}: no bind group`); return false; }
    if (bg.layout !== pipe.bgl) err(`${where} ${pipe.label}: bind group layout ${bg.layout.label} vs pipeline ${pipe.bgl && pipe.bgl.label}`);
    return true;
  }

  function mkEncoder() {
    const cb = { finished: false, copies: [], uses: [] };
    let open = null;
    const enc = {
      beginComputePass() {
        if (open) err('a pass begins while a pass is open');
        stats.computePasses++;
        let pipe = null, bg = null;
        const pass = open = {
          setPipeline(p) { pipe = p; if (p.kind !== 'compute') err(`compute pass: ${p.label} is a render pipeline`); },
          setBindGroup(i, g) { if (i !== 0) err('bind group index'); bg = g; },
          dispatchWorkgroups(x, y = 1, z = 1) {
            if (!bindCheck('dispatch', pipe, bg)) return;
            for (const v of [x, y, z]) if (!Number.isInteger(v) || v < 1 || v > 65535) err(`dispatch ${pipe.label}: workgroup count ${x},${y},${z}`);
            stats.dispatch[pipe.label] = (stats.dispatch[pipe.label] || 0) + 1;
            const seen = new Map();
            for (const e of bg.entries) {
              const le = bg.layout.entries.find(q => q.binding === e.binding), buf = e.resource && e.resource.buffer;
              if (!buf || !le || !le.buffer) continue;
              cb.uses.push(buf);
              const w = le.buffer.type === 'storage';
              if (seen.has(buf) && (w || seen.get(buf))) err(`dispatch ${pipe.label}: ${buf.label} bound twice with a writable binding`);
              seen.set(buf, w || seen.get(buf) || false);
            }
          },
          end() { open = null; },
        };
        return pass;
      },
      beginRenderPass(d) {
        if (open) err('a pass begins while a pass is open');
        stats.renderPasses++;
        const at = d.colorAttachments[0];
        if (!at || !at.view) err('render pass without a colour view');
        const W = tex.width, H = tex.height;
        let pipe = null, bg = null, vb = null;
        const writable = new Set();
        const pass = open = {
          setPipeline(p) { pipe = p; if (p.kind !== 'render') err(`render pass: ${p.label} is a compute pipeline`); },
          setBindGroup(_i, g) {
            bg = g;
            for (const e of g.entries) {
              const le = g.layout.entries.find(q => q.binding === e.binding);
              if (le && le.buffer && le.buffer.type === 'storage') writable.add(e.resource.buffer);
              if (e.resource && e.resource.buffer) cb.uses.push(e.resource.buffer);
            }
          },
          setVertexBuffer(_i, b) { vb = b; if (!(b.usage & BU.VERTEX)) err(`vertex buffer ${b.label} lacks VERTEX`); if (writable.has(b)) err(`${b.label} is vertex and writable storage`); },
          setViewport(x, y, w, h, z0, z1) {
            const e = 1e-3;
            if (!(w > 0 && h > 0) || x < -e || y < -e || x + w > W + e || y + h > H + e || z0 < 0 || z1 > 1) err(`viewport ${x.toFixed(1)},${y.toFixed(1)} ${w.toFixed(1)}x${h.toFixed(1)} in ${W}x${H}`);
          },
          setScissorRect(x, y, w, h) {
            if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || x + w > W || y + h > H) err(`scissor ${x},${y} ${w}x${h} in ${W}x${H}`);
          },
          draw(n, inst = 1) {
            if (!bindCheck('draw', pipe, bg)) return;
            if (pipe.buffers.length && !vb) err(`draw ${pipe.label}: no vertex buffer`);
            if (!(n > 0) || !(inst > 0) || !Number.isInteger(n) || !Number.isInteger(inst)) err(`draw ${pipe.label}: ${n} x ${inst}`);
            stats.draws++;
          },
          end() { open = null; },
        };
        return pass;
      },
      copyBufferToBuffer(s, so, d, dOff, n) {
        live(s); live(d);
        if (!(s.usage & BU.COPY_SRC)) err(`copy from ${s.label} without COPY_SRC`);
        if (!(d.usage & BU.COPY_DST)) err(`copy to ${d.label} without COPY_DST`);
        if (so + n > s.size || dOff + n > d.size || n % 4) err(`copy ${s.label} -> ${d.label} size ${n}`);
        cb.copies.push(d);
      },
      clearBuffer(b) { live(b); if (!(b.usage & BU.COPY_DST)) err(`clearBuffer ${b.label} without COPY_DST`); },
      finish() { if (open) err('finish with an open pass'); cb.finished = true; return cb; },
    };
    return enc;
  }
  return device;
}

const SUB = ['advA', 'advB', 'fwdX', 'fwdY', 'tri', 'invY', 'invX', 'velPass'];
const tick = () => new Promise(r => setTimeout(r, 0));

async function partA(ok) {
  const ex = extractWgsl(await fileText(CODE_SOURCE.url), CODE_SOURCE.marker);
  ok('integrate: the saver code extract is real sim WGSL with the buoyancy line', !!ex && ex.split('\n').length <= 12 && /fn tri\(/.test(ex) && /let tw = 0\.5 \* dt/.test(ex), ex ? `${ex.split('\n').length} lines` : 'no extract');
  const dev = checkDevice();
  const sim = await createSim(dev, { quality: 0, seed: 3, loadText: fileText });
  const views = await createViews(dev, 'bgra8unorm', sim, { loadText: fileText });
  ok('integrate: sim and views build on the checking device', !!sim && !!views, dev.errors.slice(0, 3).join(' | '));
  ok('integrate: sim gives what the views read', sim.buffers.T && sim.buffers.vel && sim.buffers.tracers && sim.tracerCount === 6000 && sim.dims.nx === 64 && sim.dims.Lx === 4 && sim.dims.dx === 1 / 16, JSON.stringify(sim.dims));
  dev.tex.width = 2560; dev.tex.height = 1600;
  const size = { w: 1280, h: 800, dpr: 2, pw: 2560, ph: 1600 };
  const target = { isTextureView: true };
  const clear = { t: 50, b: 80, l: 0, r: 300 };
  let frames = 0;
  for (const [pid, view] of [['soup', 'split'], ['granulation', 'surface'], ['benard', 'block'], ['hexagons', 'slice'], ['turbulent', 'split']]) {
    const pp = PRESETS[pid];
    sim.set(clampParams({ ...DEFAULTS, ...pp.params }));
    const rects = layoutRects(size.w, size.h, view, clear, { zScale: 1.6, side: pid === 'turbulent' });
    let cam = null;
    if (rects.block) cam = orbitCam({ ...fitBlock({ Lx: 4, Ly: 4, Lz: 1.6 }, rects.block.w / rects.block.h), aspect: rects.block.w / rects.block.h });
    views.set({ palette: pp.palette, slice: { angle: 0.4, offset: 0.3 }, zScale: 1.6, tracers: true, arrows: true, isotherms: true, relief: 0.7, cam });
    for (let f = 0; f < 6; f++) {
      const enc = dev.createCommandEncoder();
      sim.step(enc, 1 / 60);
      views.render(enc, target, size, rects);
      dev.queue.submit([enc.finish()]);
      frames++;
      await tick();
    }
  }
  ok('integrate: frames in every view pass the device checks', dev.errors.length === 0, dev.errors.slice(0, 4).join(' | ') || `${frames} frames, ${dev.stats.draws} draws`);
  const d = dev.stats.dispatch;
  // velPass also runs once in sim.reset (the start state)
  ok('integrate: each substep dispatches the 8 sim kernels', SUB.every(k => d[`tc-${k}`] > 0 && d[`tc-${k}`] === d['tc-advA'] + (k === 'velPass' ? 1 : 0)), JSON.stringify(d));
  ok('integrate: the view prep runs once per frame', d['tc csSurface'] === frames && d['tc csSection'] === frames && d['tc csRange'] === frames);
  ok('integrate: one render pass per frame', dev.stats.renderPasses === frames, String(dev.stats.renderPasses));
  ok('integrate: sim.time moves when a step is encoded', sim.time > 0, String(sim.time));
  ok('integrate: the stats readback maps and parses', dev.stats.maps > 0 && sim.stats().simTime > 0 && Array.isArray(sim.stats().plume), JSON.stringify(sim.stats()));
  // a views.set with the saver director's camera shape (dist: null = fit)
  const rb = layoutRects(size.w, size.h, 'block', clear, {});
  views.set({ cam: { yaw: 1, pitch: 0.5, dist: null, target: [2, 2, 0.5] }, sliceLine: false });
  const enc = dev.createCommandEncoder();
  views.render(enc, target, size, rb);
  dev.queue.submit([enc.finish()]);
  ok('integrate: the director camera shape (dist null) renders the block', dev.errors.length === 0 && views.lastCam && Number.isFinite(views.lastCam.dist), dev.errors.slice(0, 2).join(' | '));
  views.destroy(); sim.destroy();
  await tick(); await tick();
  ok('integrate: destroy leaves no late errors', dev.errors.length === 0, dev.errors.slice(0, 2).join(' | '));
}

// ── Part B: main.js in jsdom ─────────────────────────────────────────────
function findJsdom() {
  try { return createRequire(import.meta.url)('jsdom'); } catch { /* not on the path */ }
  for (const p of (process.env.NODE_PATH || '').split(':').filter(Boolean)) {
    try { return createRequire(join(p, 'x.js'))('jsdom'); } catch { /* next */ }
  }
  return null;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const GLOBALS = ['window', 'document', 'location', 'screen', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'getComputedStyle', 'navigator', 'innerWidth', 'innerHeight', 'addEventListener', 'removeEventListener', 'fetch', 'snSaver'];

async function partB(ok) {
  const jsdom = findJsdom();
  if (!jsdom) { ok('integrate boot: jsdom runs skipped (jsdom is not on NODE_PATH)', true); return; }
  const { JSDOM } = jsdom;
  const saved = {};
  for (const k of GLOBALS) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const consoleError = console.error, consoleWarn = console.warn, logged = [];
  try {
    const html = readFileSync(fileURLToPath(new URL('index.html', page)), 'utf8').replace(/<script type="module"[^>]*><\/script>/, '');
    const dom = new JSDOM(html, { url: 'http://localhost/stella-nova/pages/thermal-convection/index.html?q=0&seed=5', pretendToBeVisual: true });
    const w = dom.window;
    w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    const devs = [];
    let ctxTex = null;
    w.HTMLCanvasElement.prototype.getContext = function (kind) {
      if (kind === 'webgpu') {
        return {
          configure(c) { this.cfg = c; },
          getCurrentTexture: () => {
            const d = devs.at(-1);
            d.tex.width = this.width; d.tex.height = this.height;
            ctxTex = { width: this.width, height: this.height, createView: () => ({ isTextureView: true }) };
            return ctxTex;
          },
        };
      }
      if (kind === '2d') return { fillRect() {}, set fillStyle(v) { /* legend */ } };
      return null;
    };
    Object.defineProperty(w.navigator, 'gpu', {
      value: {
        requestAdapter: async () => ({ requestDevice: async () => { const d = checkDevice(); devs.push(d); return d; } }),
        getPreferredCanvasFormat: () => 'bgra8unorm',
      }, configurable: true,
    });
    const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    for (const k of ['document', 'location', 'screen', 'HTMLElement']) def(k, w[k]);
    def('window', w);
    for (const k of ['requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'addEventListener', 'removeEventListener']) def(k, w[k].bind(w));
    def('innerWidth', w.innerWidth); def('innerHeight', w.innerHeight);
    def('navigator', w.navigator);
    def('fetch', async u => {
      const url = new URL(String(u), 'http://localhost/');
      if (url.protocol !== 'file:') return { ok: false, status: 404, text: async () => '' };
      try { const t = readFileSync(fileURLToPath(url), 'utf8'); return { ok: true, status: 200, text: async () => t }; } catch { return { ok: false, status: 404, text: async () => '' }; }
    });
    console.error = (...a) => { logged.push(['error', a.map(String).join(' ')]); };
    console.warn = (...a) => { logged.push(['warn', a.map(String).join(' ')]); };
    const errs = [];
    const onErr = e => errs.push(String(e && e.stack || e));
    process.on('unhandledRejection', onErr);

    await import(new URL('main.js', page).href + '?integrate=1');
    for (let i = 0; i < 100 && !(w.TC && w.TC.ok && w.TC.saverObj); i++) await wait(20);
    await wait(300);
    const app = w.TC, doc = w.document;
    const dev = devs[0];
    ok('integrate boot: main.js boots the real sim and views', app && app.ok === true && !!app.sim && !!app.views, app && app.failed);
    ok('integrate boot: q=0 gives the phone grid', app.sim && app.sim.dims.nx === 64 && app.sim.dims.nz === 16);
    ok('integrate boot: frames render on the checking device', dev && dev.stats.renderPasses > 5 && dev.stats.dispatch['tc-advA'] > 5, dev && JSON.stringify({ rp: dev.stats.renderPasses, adv: dev.stats.dispatch['tc-advA'] }));
    ok('integrate boot: no device errors in the page frames', dev && dev.errors.length === 0, dev && dev.errors.slice(0, 4).join(' | '));
    ok('integrate boot: the frame loop logs no error', !logged.some(l => l[0] === 'error'), logged.filter(l => l[0] === 'error').map(l => l[1]).slice(0, 2).join(' | '));
    ok('integrate boot: saver installed, buttons show', !!app.saverObj && doc.getElementById('saverBtn').hidden === false && typeof globalThis.snSaver === 'object');
    ok('integrate boot: views get the granulation look', app.views.state.palette === 'solar' && app.view === 'surface');

    // every view from the page side
    for (const v of ['split', 'block', 'slice', 'surface']) { app.setView(v); await wait(60); }
    ok('integrate boot: the four views render with no device error', dev.errors.length === 0, dev.errors.slice(0, 3).join(' | '));
    ok('integrate boot: block view gave the views a camera with matrices', !!(app.views.lastCam && app.views.lastCam.viewProj));

    // prewarm
    const a0 = dev.stats.dispatch['tc-advA'], t0 = app.sim.time;
    app.prewarm(5);
    ok('integrate boot: prewarm(5) runs the field 5 tff', app.sim.time - t0 >= 5 - 1e-6 && dev.stats.dispatch['tc-advA'] > a0, `${(app.sim.time - t0).toFixed(2)} tff, ${dev.stats.dispatch['tc-advA'] - a0} substeps`);

    // the screensaver: enter, every kind, exit
    const before = { view: app.view, palette: app.palette };
    const r = globalThis.snSaver.enter({ seed: 11, calm: 0.7 });
    ok('integrate saver: enter gives the page canvas', r && r.canvas === doc.getElementById('view') && r.warmupMs > 0);
    await wait(150);
    const seen = [];
    for (const k of KINDS) {
      app.saverObj.cut(k);
      await wait(120);
      const dbg = globalThis.snSaver.debug();
      seen.push(`${k}:${dbg.kind}/${dbg.view}/${app.views.state.palette}`);
      if (k === 'granulation') ok('integrate saver: granulation hides the cut line', app.views.state.sliceLine === false && app.view === 'surface');
      if (k === 'block') ok('integrate saver: block shot drives the camera', !!(app.cam && Number.isFinite(app.cam.dist)) && !!app.views.lastCam, JSON.stringify(app.cam && { yaw: app.cam.yaw, dist: app.cam.dist }));
    }
    ok('integrate saver: a cut to each kind lands on that kind', seen.every(s => { const [k, rest] = s.split(':'); return rest.startsWith(k + '/'); }), seen.join(' '));
    ok('integrate saver: the shots render with no device error', dev.errors.length === 0, dev.errors.slice(0, 3).join(' | '));
    const dbg = globalThis.snSaver.debug();
    ok('integrate saver: the plate shows the real WGSL extract', dbg.code === CODE_SOURCE.name, dbg.code);
    const plate = doc.getElementById('tcSaverPlate');
    ok('integrate saver: the in-page plate shows Ra, Pr, Nu, t', plate && !plate.hidden && /Ra = .*Pr = .*Nu = .*t = /.test(plate.querySelector('.tcs-params').textContent), plate && plate.querySelector('.tcs-params').textContent);
    ok('integrate saver: html has tc-saver', doc.documentElement.classList.contains('tc-saver'));
    globalThis.snSaver.exit();
    await wait(80);
    ok('integrate saver: exit restores the view and the palette', app.view === before.view && app.palette === before.palette && app.views.state.sliceLine === true && !doc.documentElement.classList.contains('tc-saver'), `${app.view} ${app.palette}`);
    ok('integrate saver: the page frames go on after exit', dev.errors.length === 0 && app.saver === false);

    // device loss: boot again
    const rp = dev.stats.renderPasses;
    dev.loseNow('unknown');
    await wait(50);
    ok('integrate loss: a lost device drops the sim', app.sim === null);
    for (let i = 0; i < 100 && !(app.ok && devs.length > 1); i++) await wait(20);
    await wait(150);
    ok('integrate loss: it boots again on a new device and renders', devs.length === 2 && app.ok && devs[1].stats.renderPasses > 2 && dev.stats.renderPasses - rp < 3, `${devs.length} devices`);
    ok('integrate loss: the new device has no errors', devs[1] && devs[1].errors.length === 0, devs[1] && devs[1].errors.slice(0, 3).join(' | '));
    ok('integrate boot: no unhandled rejections', errs.length === 0, errs.slice(0, 2).join(' | '));
    devs[1].destroy();
    await wait(30);
    process.off('unhandledRejection', onErr);
    w.close();
  } finally {
    console.error = consoleError; console.warn = consoleWarn;
    for (const k of GLOBALS) { const d = saved[k]; if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
}

export default async function run(ok) {
  await partA(ok);
  await partB(ok);
}
