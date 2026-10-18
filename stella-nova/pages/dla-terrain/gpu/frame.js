// ============================================================================
//  DLA TERRAIN  ·  gpu/frame.js — the frame graph (package CORE)
// ----------------------------------------------------------------------------
//  createFrameGraph(gpu, { terrain, post, shadows }) -> fg
//    fg.modules                  the loaded package modules, in draw order
//    fg.resize(cssW, cssH, dpr)  the swap chain size; the render size is that
//                                times fg.scale (dynamic resolution)
//    fg.render(frame)            one frame (frame = the CONTRACT frame object
//                                plus frame.cam for the cascades)
//
//  PASS ORDER (CONTRACT.md)
//    1 compute    terrain blend + normals (gpu/terrain-gpu.js), then each
//                 module.compute(encoder, frame)
//    2 shadow     one depth pass per cascade into the sun shadow array:
//                 group 0 Globals, group 2 SP; module.drawShadow(pass, frame)
//                 with frame.cascade = i
//    3 opaque     HDR rgba16float + depth32float (reverse-Z, clear 0):
//                 group 0, group 2 = shadow sample; module.drawOpaque, then
//                 module.drawSky (sky at depth 0, compare greater-equal)
//    4 copy       HDR -> sceneColor, depth -> sceneDepth (the state before water)
//    5 water      HDR + depth (load, store): module.drawWater(pass, frame, ctx)
//                 ctx.sceneColorView, ctx.depthView = the copy (sceneDepth),
//                 ctx.depthIsCopy = true
//    6 volumetric HDR only, no depth attachment: module.drawVolumetric(pass,
//                 frame, ctx), ctx.depthView = the live depth after water,
//                 ctx.sceneDepthView = the copy before water. Group 2 too.
//    7 post       render/post.js: TAA, exposure, bloom, AgX, to the swap chain
//
//  DYNAMIC RESOLUTION: fg.scale starts at the quality scale. fg.tick(ms)
//  takes the frame time; over budget for 1 s lowers the scale by 0.1, under
//  70% of budget for 3 s raises it by 0.05 (never over the preset).
//
//  GOVERNOR (phones, gpu/budget.js): fg.budgetMs is the profile budget (a
//  phone: 33 ms). When the scale is at its floor and the frames stay slow
//  for 2 s, featureStep takes fg.level one step up: 1 one shadow cascade,
//  2 TAA off, 3 no shadow casters, 4 no grass, 5 no clouds. Fast frames for
//  8 s take it one step down. fg.render skips the frame while
//  document.visibilityState is "hidden"; fg.tick drops a frame time over 250 ms (a stall
//  or a return from a hidden tab). An out-of-memory error (gpu.onPressure)
//  lowers the pixel ratio and the scale and sets the level to 2 or more.
//
//  HANG GUARD (2026-10-17: a full zoom on the ground took the whole computer
//  down). The GPU queue holds at most MAX_IN_FLIGHT frames: fg.render skips
//  a frame (fg.stalls) while that many are not done, so a slow GPU never
//  gets a backlog that stalls the window server. queue.onSubmittedWorkDone
//  gives fg.gpuMs, the GPU time of a frame. A heavy frame (fg.gpuMs over
//  HEAVY_MS) calls heavyStep: the scale falls to 0.7 of itself at once
//  (floor HEAVY_FLOOR), and at the floor the governor level goes up one
//  step. The scale step and the governor also take fg.gpuMs, so a frame
//  over 250 ms (which tick drops as a stall of the page) still counts
//  when the GPU itself was slow. Level 1 and up also turns off the close-up
//  rock effects of GROUND (POM and vertex relief, frame.govLevel).
//
//  grep -n targets: "export function createFrameGraph", "function targets",
//  "export function heavyStep", "MAX_IN_FLIGHT", "fg.inFlight",
//  "── 2 shadow", "── 3 opaque", "── 5 water", "── 6 volumetric", "export function scaleStep",
//  "export function featureStep", "fg.level"
// ============================================================================

export function scaleStep(state, ms, budget, max) {
  // state = { scale, over, under } (s of time over / under budget)
  const dt = Math.min(ms, 100) / 1000;
  if (ms > budget * 1.08) { state.over += dt; state.under = 0; }
  else if (ms < budget * 0.7) { state.under += dt; state.over = 0; }
  else { state.over = Math.max(0, state.over - dt); state.under = 0; }
  let changed = false;
  if (state.over > 1 && state.scale > 0.5) { state.scale = Math.max(0.5, +(state.scale - 0.1).toFixed(2)); state.over = 0; changed = true; }
  if (state.under > 3 && state.scale < max) { state.scale = Math.min(max, +(state.scale + 0.05).toFixed(2)); state.under = 0; changed = true; }
  return changed;
}

// state = { level, slow, fast } (s); atFloor: the scale is at its floor.
// Returns -1, 0 or +1 (the change of level).
export const MAX_LEVEL = 5;
export function featureStep(state, ms, budget, atFloor) {
  const dt = Math.min(ms, 100) / 1000;
  if (ms > budget * 1.08 && atFloor) { state.slow += dt; state.fast = 0; }
  else if (ms < budget * 0.6) { state.fast += dt; state.slow = 0; }
  else { state.slow = Math.max(0, state.slow - dt); state.fast = 0; }
  if (state.slow > 2 && state.level < MAX_LEVEL) { state.level++; state.slow = 0; return 1; }
  if (state.fast > 8 && state.level > 0) { state.level--; state.fast = 0; return -1; }
  return 0;
}

// HANG GUARD constants (see the header)
export const MAX_IN_FLIGHT = 2;      // frames on the GPU queue
export const HEAVY_MS = 120;         // ms of GPU time: a heavy frame
export const HEAVY_FLOOR = 0.4;      // the least scale after a heavy frame
// state = { scale, level, cool } (cool: frames to wait, so the frames in
// flight when the scale changed do not count two times). Returns
// { scale, level, changed } for the GPU time gpuMs of one frame.
export function heavyStep(state, gpuMs, floor = HEAVY_FLOOR) {
  if (state.cool > 0) { state.cool--; return { scale: state.scale, level: state.level, changed: false }; }
  if (!(gpuMs > HEAVY_MS)) return { scale: state.scale, level: state.level, changed: false };
  const s0 = state.scale, l0 = state.level;
  if (state.scale > floor + 1e-6) state.scale = Math.max(floor, Math.round(state.scale * 70) / 100);
  else state.level = Math.min(MAX_LEVEL, state.level + 1);
  // a very heavy frame (4 x the limit) also takes a level at once
  if (gpuMs > HEAVY_MS * 4 && state.level === l0) state.level = Math.min(MAX_LEVEL, state.level + 1);
  state.cool = MAX_IN_FLIGHT + 1;
  return { scale: state.scale, level: state.level, changed: state.scale !== s0 || state.level !== l0 };
}

export function createFrameGraph(gpu, parts) {
  const device = gpu.device, U = GPUTextureUsage;
  const fg = {
    modules: [], fallbacks: {}, scale: gpu.qualityPreset.scale, maxScale: gpu.qualityPreset.scale,
    cssW: 1, cssH: 1, dpr: 1, outW: 1, outH: 1, w: 1, h: 1, key: 0, T: null,
    dyn: { scale: gpu.qualityPreset.scale, over: 0, under: 0 }, dynamic: true,
    budgetMs: (gpu.profile && gpu.profile.budgetMs) || 1000 / 58, stats: { passes: 0 },
    level: 0, gov: { level: 0, slow: 0, fast: 0 }, minScale: 0.5, pressure: 0, skipped: 0,
    // HANG GUARD: frames on the GPU queue, the GPU time of the last done one
    inFlight: 0, maxInFlight: MAX_IN_FLIGHT, gpuMs: 0, stalls: 0, heavy: 0,
    hv: { scale: 1, level: 0, cool: 0 },
  };

  function targets() {
    const w = Math.max(16, Math.round(fg.outW * fg.scale)), h = Math.max(16, Math.round(fg.outH * fg.scale));
    if (fg.T && fg.w === w && fg.h === h) return false;
    if (fg.T) for (const t of fg.T.all) t.destroy();
    fg.w = w; fg.h = h;
    const all = [];
    const tex = (label, format, usage) => { const t = device.createTexture({ label, size: [w, h], format, usage }); all.push(t); return t; };
    const hdr = tex('hdr', gpu.hdrFormat, U.RENDER_ATTACHMENT | U.TEXTURE_BINDING | U.COPY_SRC);
    const depth = tex('depth', gpu.depthFormat, U.RENDER_ATTACHMENT | U.TEXTURE_BINDING | U.COPY_SRC);
    const sceneColor = tex('scene colour', gpu.hdrFormat, U.TEXTURE_BINDING | U.COPY_DST);
    const sceneDepth = tex('scene depth', gpu.depthFormat, U.TEXTURE_BINDING | U.COPY_DST);
    fg.T = {
      all, hdr, depth, sceneColor, sceneDepth,
      hdrView: hdr.createView(), depthView: depth.createView(),
      sceneColorView: sceneColor.createView(), sceneDepthView: sceneDepth.createView(),
    };
    fg.key++;
    const ctx = fg.ctx();
    for (const m of fg.active()) if (m.resize) try { m.resize(w, h, ctx); } catch (e) { console.warn(m.name, e); }
    parts.post.resize(w, h, fg.outW, fg.outH);
    return true;
  }

  fg.ctx = () => ({
    width: fg.w, height: fg.h,
    hdrView: fg.T.hdrView, hdrTexture: fg.T.hdr,
    sceneColorView: fg.T.sceneColorView, sceneColorTexture: fg.T.sceneColor,
    depthView: fg.T.depthView, depthTexture: fg.T.depth,
    sceneDepthView: fg.T.sceneDepthView, sceneDepthTexture: fg.T.sceneDepth,
    shadow: parts.shadows, shadowBindGroup: parts.shadows.sampleBindGroup,
  });

  // the modules that draw: the loaded ones, plus a fallback for a missing
  // ground or sky
  fg.active = () => {
    const list = fg.modules.filter(m => !m.failed && !m.off);
    if (!list.some(m => m.role === 'ground') && fg.fallbacks.ground) list.unshift(fg.fallbacks.ground);
    if (!list.some(m => m.role === 'sky') && fg.fallbacks.sky) list.push(fg.fallbacks.sky);
    return list;
  };

  fg.resize = (cssW, cssH, dpr) => {
    fg.cssW = cssW; fg.cssH = cssH; fg.dpr = dpr;
    // device pixel ratio cap by quality: Low renders at 1x (phones)
    let cap = [1, 1.25, 1.5, 2][gpu.qualityIndex] ?? 1.5;
    // the device profile caps it more (a phone 1.5, a low-memory phone 1)
    if (gpu.profile && gpu.profile.dprCap) cap = Math.min(cap, gpu.profile.dprCap);
    if (fg.pressure) cap = Math.min(cap, 1);
    fg.outW = Math.max(16, Math.round(cssW * Math.min(dpr, cap)));
    fg.outH = Math.max(16, Math.round(cssH * Math.min(dpr, cap)));
    // 4K and up: keep the render under about 8.3 M px
    const px = fg.outW * fg.outH;
    if (px > 8.3e6) { const k = Math.sqrt(8.3e6 / px); fg.outW = Math.round(fg.outW * k); fg.outH = Math.round(fg.outH * k); }
    targets();
  };
  fg.setScale = s => { fg.scale = Math.max(0.4, Math.min(1, s)); fg.dyn.scale = fg.scale; targets(); };
  fg.tick = ms => {
    if (!fg.dynamic) return;
    // a CPU gap over 250 ms is a stall of the page (a hidden tab, a GC),
    // but a GPU time over 250 ms is a real slow frame: it counts
    const g = fg.gpuMs > 0 ? fg.gpuMs : 0;
    if (ms > 250) ms = g > 250 ? g : 0;
    else ms = Math.max(ms, g);
    if (!(ms > 0)) return;
    if (scaleStep(fg.dyn, ms, fg.budgetMs, fg.maxScale)) { fg.scale = fg.dyn.scale; targets(); }
    const d = featureStep(fg.gov, ms, fg.budgetMs, fg.dyn.scale <= fg.minScale + 1e-6);
    if (d) setLevel(fg.gov.level);
  };
  // the features that a level turns off (see GOVERNOR)
  let taaUser = null, cascUser = null;
  function setLevel(l) {
    fg.level = fg.gov.level = Math.max(0, Math.min(MAX_LEVEL, l));
    const sh = parts.shadows;
    if (sh && sh.resize) {
      if (fg.level >= 1) { if (cascUser === null) cascUser = sh.count; sh.resize(sh.size, 1); }
      else if (cascUser !== null) { sh.resize(sh.size, cascUser); cascUser = null; }
    }
    if (parts.post && parts.post.settings) {
      if (fg.level >= 2) { if (taaUser === null) taaUser = parts.post.settings.taa; parts.post.settings.taa = false; }
      else if (taaUser !== null) { parts.post.settings.taa = taaUser; taaUser = null; }
    }
  }
  fg.setLevel = setLevel;
  // HANG GUARD: the GPU time of each done frame
  fg.onGpuTime = ms => {
    fg.gpuMs = ms;
    if (!fg.dynamic) return;
    fg.hv.scale = fg.dyn.scale; fg.hv.level = fg.gov.level;
    const r = heavyStep(fg.hv, ms, Math.min(HEAVY_FLOOR, fg.minScale));
    if (!r.changed) return;
    fg.heavy++;
    console.warn(`dla-terrain: heavy GPU frame ${ms.toFixed(0)} ms: scale ${r.scale}, level ${r.level}`);
    if (r.scale !== fg.dyn.scale) { fg.dyn.scale = fg.scale = r.scale; fg.dyn.over = 0; fg.dyn.under = 0; targets(); }
    if (r.level !== fg.gov.level) { fg.gov.slow = 0; fg.gov.fast = 0; setLevel(r.level); }
  };
  // out of memory (gpu/device.js): smaller targets now, then the profile
  // caps apply to what the modules make next
  if (gpu.onPressure) gpu.onPressure(() => {
    fg.pressure++;
    fg.maxScale = Math.min(fg.maxScale, 0.75);
    fg.dyn.scale = Math.min(fg.dyn.scale, fg.maxScale);
    fg.scale = fg.dyn.scale;
    setLevel(Math.max(fg.level, 2));
    fg.resize(fg.cssW, fg.cssH, fg.dpr);
  });

  const guard = (m, what, f) => {
    try { f(); } catch (e) {
      console.warn(`dla-terrain: ${m.name || m.role} ${what} failed`, e);
      m.failed = true;
      if (fg.onModuleError) fg.onModuleError(m, what, e);
    }
  };

  fg.render = frame => {
    // a hidden tab draws nothing (rAF also stops there in most browsers)
    if (globalThis.document && document.visibilityState === 'hidden') { fg.skipped++; return false; }
    // HANG GUARD: no backlog on the GPU queue
    if (fg.inFlight >= fg.maxInFlight) { fg.stalls++; return false; }
    frame.govLevel = fg.level;
    const T = fg.T, sh = parts.shadows;
    const mods = fg.active();
    if (fg.level >= 4) frame.layers = { ...(frame.layers || {}), grass: false, ...(fg.level >= 5 ? { clouds: false } : {}) };
    frame.shadowBindGroup = sh.sampleBindGroup;
    frame.shadowInfo = sh.info;
    const enc = device.createCommandEncoder({ label: 'frame' });
    let passes = 0;
    // ── 1 compute
    parts.terrain.compute(enc, frame.dt);
    for (const m of mods) if (m.compute) guard(m, 'compute', () => m.compute(enc, frame));
    // ── 2 shadow
    const casters = fg.level >= 3 ? [] : mods.filter(m => m.drawShadow);
    if (sh.info && casters.length) {
      for (let c = 0; c < sh.info.count; c++) {
        const pass = enc.beginRenderPass({
          label: 'shadow ' + c, colorAttachments: [],
          depthStencilAttachment: { view: sh.layerViews[c], depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        pass.setBindGroup(0, gpu.globalsBindGroup);
        pass.setBindGroup(2, sh.passBindGroups[c]);
        frame.cascade = c;
        for (const m of casters) guard(m, 'drawShadow', () => m.drawShadow(pass, frame));
        pass.end(); passes++;
      }
    } else {
      // clear the map: everything lit
      for (let c = 0; c < sh.count; c++) {
        const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: sh.layerViews[c], depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } });
        pass.end();
      }
    }
    frame.cascade = -1;
    // ── 3 opaque (+ sky)
    {
      const pass = enc.beginRenderPass({
        label: 'opaque',
        colorAttachments: [{ view: T.hdrView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: T.depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(2, sh.sampleBindGroup);
      for (const m of mods) if (m.drawOpaque) guard(m, 'drawOpaque', () => m.drawOpaque(pass, frame));
      for (const m of mods) if (m.drawSky) guard(m, 'drawSky', () => m.drawSky(pass, frame));
      pass.end(); passes++;
    }
    // ── 4 copy
    enc.copyTextureToTexture({ texture: T.hdr }, { texture: T.sceneColor }, [fg.w, fg.h]);
    enc.copyTextureToTexture({ texture: T.depth }, { texture: T.sceneDepth }, [fg.w, fg.h]);
    const ctx = fg.ctx();
    // ── 5 water
    const water = mods.filter(m => m.drawWater);
    if (water.length) {
      const pass = enc.beginRenderPass({
        label: 'water',
        colorAttachments: [{ view: T.hdrView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: T.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(2, sh.sampleBindGroup);
      ctx.depthView = T.sceneDepthView; ctx.depthTexture = T.sceneDepth; ctx.depthIsCopy = true;
      for (const m of water) guard(m, 'drawWater', () => m.drawWater(pass, frame, ctx));
      pass.end(); passes++;
    }
    // ── 6 volumetric
    const vol = mods.filter(m => m.drawVolumetric);
    if (vol.length) {
      const pass = enc.beginRenderPass({
        label: 'volumetric',
        colorAttachments: [{ view: T.hdrView, loadOp: 'load', storeOp: 'store' }],
      });
      pass.setBindGroup(0, gpu.globalsBindGroup);
      pass.setBindGroup(2, sh.sampleBindGroup);
      ctx.depthView = T.depthView; ctx.depthTexture = T.depth; ctx.depthIsCopy = false;
      for (const m of vol) guard(m, 'drawVolumetric', () => m.drawVolumetric(pass, frame, ctx));
      pass.end(); passes++;
    }
    // ── 7 post
    const out = frame.outView || gpu.context.getCurrentTexture().createView();
    parts.post.run(enc, { hdrView: T.hdrView, depthView: T.depthView, key: fg.key }, out, frame.dt);
    device.queue.submit([enc.finish()]);
    parts.post.afterSubmit();
    const q = device.queue;
    if (q.onSubmittedWorkDone) {
      fg.inFlight++;
      const t0 = performance.now();
      q.onSubmittedWorkDone().then(() => { fg.inFlight = Math.max(0, fg.inFlight - 1); fg.onGpuTime(performance.now() - t0); },
        () => { fg.inFlight = Math.max(0, fg.inFlight - 1); });
    }
    fg.stats.passes = passes;
    return true;
  };
  fg.targets = targets;
  return fg;
}
