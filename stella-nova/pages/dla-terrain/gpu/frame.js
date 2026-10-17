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
//  grep -n targets: "export function createFrameGraph", "function targets",
//  "── 2 shadow", "── 3 opaque", "── 5 water", "── 6 volumetric", "export function scaleStep"
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

export function createFrameGraph(gpu, parts) {
  const device = gpu.device, U = GPUTextureUsage;
  const fg = {
    modules: [], fallbacks: {}, scale: gpu.qualityPreset.scale, maxScale: gpu.qualityPreset.scale,
    cssW: 1, cssH: 1, dpr: 1, outW: 1, outH: 1, w: 1, h: 1, key: 0, T: null,
    dyn: { scale: gpu.qualityPreset.scale, over: 0, under: 0 }, dynamic: true,
    budgetMs: 1000 / 58, stats: { passes: 0 },
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
    const cap = gpu.qualityIndex >= 3 ? 2 : 1.5;
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
    if (scaleStep(fg.dyn, ms, fg.budgetMs, fg.maxScale)) { fg.scale = fg.dyn.scale; targets(); }
  };

  const guard = (m, what, f) => {
    try { f(); } catch (e) {
      console.warn(`dla-terrain: ${m.name || m.role} ${what} failed`, e);
      m.failed = true;
      if (fg.onModuleError) fg.onModuleError(m, what, e);
    }
  };

  fg.render = frame => {
    const T = fg.T, sh = parts.shadows;
    const mods = fg.active();
    frame.shadowBindGroup = sh.sampleBindGroup;
    frame.shadowInfo = sh.info;
    const enc = device.createCommandEncoder({ label: 'frame' });
    let passes = 0;
    // ── 1 compute
    parts.terrain.compute(enc, frame.dt);
    for (const m of mods) if (m.compute) guard(m, 'compute', () => m.compute(enc, frame));
    // ── 2 shadow
    const casters = mods.filter(m => m.drawShadow);
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
    fg.stats.passes = passes;
  };
  fg.targets = targets;
  return fg;
}
