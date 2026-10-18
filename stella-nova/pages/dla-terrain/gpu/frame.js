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
//    6 volumetric module.volumetricPrep(encoder, frame, ctx) first (compute,
//                 ctx.depthView = the live depth after water), then
//                 HDR only, no depth attachment: module.drawVolumetric(pass,
//                 frame, ctx), ctx.depthView = the live depth after water,
//                 ctx.sceneDepthView = the copy before water. Group 2 too.
//    7 post       render/post.js: TAA, exposure, bloom, AgX, to the swap chain
//
//  GOVERNOR (gpu/governor.js has the ladder, the rules and the numbers).
//  One state (fg.gov, also fg.dyn) holds the render scale and the level.
//  fg.tick(ms) gives it the frame time and fg.gpuMs. Slow frames lower the
//  scale to the soft floor (profile scaleFloor: 0.75 desktop and Safari,
//  0.5 phones), then take ladder rungs (1 screen shafts, 2 no POM, 3 no
//  AO, 4 no grass, 5 half shadow maps, 6 2 cascades, 7 1 cascade). GPU
//  headroom (or calm frames) steps back up in the reverse order, with a
//  probe and a backoff. Level 8 (emergency: no shadow casters, clouds,
//  shafts or TAA) comes only from heavy frames. fg.prepare(frame) puts the
//  plan on the frame object before the module updates (main.js):
//  frame.govLevel (the old level numbers the modules read: 1 = no POM,
//  5 = emergency), frame.ao, frame.shafts.mode, frame.layers.grass and
//  .clouds, frame.taa, frame.gov = { level, keys, cloudK, text }.
//  fg.govText() is the status line text. fg.rebase() after a quality
//  change takes the new shadow size, cascades and TAA as the base.
//  fg.render skips the frame while document.visibilityState is "hidden";
//  fg.tick drops a frame time over 250 ms (a stall or a return from a
//  hidden tab). An out-of-memory error (gpu.onPressure) lowers the pixel
//  ratio and the scale and keeps the level at RELIEF_LEVEL or more.
//
//  UPSCALE (gpu/upscale.js): when the render size is under the swap chain
//  size, post writes at the render size into fg.U (the canvas format) and
//  the upscale pass (Catmull-Rom, clamped, adaptive sharpen) draws it to
//  the swap chain. Without the pipeline (a fake device), post draws to the
//  swap chain as before.
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
//  when the GPU itself was slow. A heavy frame also stops the step up of
//  the governor at once (governorHeavy: a pause, and a step up just
//  before it counts as a failed probe).
//
//  SAFARI GUARD (2026-10-18: the user still saw the computer go down at
//  full zoom, in Safari on a Mac). The profile (gpu/budget.js) now sets:
//    pxCap, nearPxCap  budget.js pixelCap: the swap chain under pxCap, and
//                 the render size under nearPxCap while fg.near (main.js
//                 fg.setNear(eye height over the ground), on under NEAR_IN
//                 m, off over NEAR_OUT m and after NEAR_HOLD ms: a
//                 hysteresis, so a zoom loop does not make new targets
//                 each step)
//    maxInFlight  1 on Safari; on every profile 1 while the last GPU time
//                 was over half of heavyMs
//    heavyMs      the heavy frame limit (Safari 50 ms, desktop 120 ms)
//    dutyIdle     after a done frame of g ms, no submit for dutyIdle x g
//                 ms (fg.readyAt): the GPU is idle for part of each heavy
//                 frame, so the window server can draw
//    budgetMB     with memGuard (safari, safe): every MEM_CHECK frames
//                 gpu.mem.live (device.js tally) is checked; over the
//                 budget, relieve() lowers the pixel ratio, the scale and
//                 the level (at most once per 3 s, and not again when
//                 nothing is left to lower)
//    govForce     rungs on at every level (safe: pom, cascade1)
//    scaleFloor   the soft floor of the render scale (gpu/governor.js)
//  A frame that is not done after STUCK_MS frees its slot and counts as a
//  heavy frame of that length (fg.stuck), so a lost promise does not stop
//  the page and a stuck GPU takes the lowest settings.
//  fg.ready() is false when fg.render would skip: main.js then also skips
//  the module updates and the queue writes of that frame.
//
//  grep -n targets: "export function createFrameGraph", "function targets",
//  "function upTargets", "fg.prepare", "function applyFeatures", "fg.govText",
//  "fg.ready", "fg.setNear", "function relieve", "STUCK_MS", "NEAR_IN",
//  "export function heavyStep", "MAX_IN_FLIGHT", "fg.inFlight",
//  "── 2 shadow", "── 3 opaque", "── 5 water", "── 6 volumetric", "── 7 post",
//  "fg.tick", "fg.level"
// ============================================================================

import { createGovernor, governorStep, governorHeavy, featuresOf, planOf, describe, MAX_LEVEL, STEADY_MAX, RELIEF_LEVEL } from './governor.js';
import { createUpscaler } from './upscale.js';
export { MAX_LEVEL, STEADY_MAX, RELIEF_LEVEL };
import { pixelCap, MB } from './budget.js';

// SAFARI GUARD constants (see the header)
export const NEAR_IN = 60, NEAR_OUT = 120;   // m of eye height over the ground
export const NEAR_HOLD = 1500;               // ms in the near state before it can end
export const STUCK_MS = 4000;                // ms: a frame that is not done
export const MEM_CHECK = 30;                 // frames between memory checks
// the near state with hysteresis: -> true or false
export function nearStep(near, agl) {
  if (!Number.isFinite(agl)) return near;
  if (near) return agl < NEAR_OUT;
  return agl < NEAR_IN;
}
// the frames that may be on the queue: the profile cap, and 1 while the
// last GPU time was over half of the heavy limit
export function inFlightCap(profile, gpuMs) {
  const cap = Math.max(1, (profile && profile.maxInFlight) || MAX_IN_FLIGHT);
  const heavy = (profile && profile.heavyMs) || HEAVY_MS;
  return gpuMs > heavy * 0.5 ? 1 : cap;
}

// HANG GUARD constants (see the header)
export const MAX_IN_FLIGHT = 2;      // frames on the GPU queue
export const HEAVY_MS = 120;         // ms of GPU time: a heavy frame
export const HEAVY_FLOOR = 0.4;      // the least scale after a heavy frame
// state = { scale, level, cool } (cool: frames to wait, so the frames in
// flight when the scale changed do not count two times). Returns
// { scale, level, changed } for the GPU time gpuMs of one frame.
export function heavyStep(state, gpuMs, floor = HEAVY_FLOOR, heavyMs = HEAVY_MS) {
  if (state.cool > 0) { state.cool--; return { scale: state.scale, level: state.level, changed: false }; }
  if (!(gpuMs > heavyMs)) return { scale: state.scale, level: state.level, changed: false };
  const s0 = state.scale, l0 = state.level;
  if (state.scale > floor + 1e-6) state.scale = Math.max(floor, Math.round(state.scale * 70) / 100);
  else state.level = Math.min(MAX_LEVEL, state.level + 1);
  // a very heavy frame (4 x the limit) also takes a level at once
  if (gpuMs > heavyMs * 4 && state.level === l0) state.level = Math.min(MAX_LEVEL, state.level + 1);
  state.cool = MAX_IN_FLIGHT + 1;
  return { scale: state.scale, level: state.level, changed: state.scale !== s0 || state.level !== l0 };
}

export function createFrameGraph(gpu, parts) {
  const device = gpu.device, U = GPUTextureUsage;
  // GOVERNOR: one state for the scale and the level (fg.dyn = fg.gov)
  const gv = createGovernor(gpu.qualityPreset.scale, 0);
  const fg = {
    modules: [], fallbacks: {}, scale: gpu.qualityPreset.scale, maxScale: gpu.qualityPreset.scale,
    cssW: 1, cssH: 1, dpr: 1, outW: 1, outH: 1, w: 1, h: 1, key: 0, T: null, U: null,
    dyn: gv, gov: gv, dynamic: true,
    budgetMs: (gpu.profile && gpu.profile.budgetMs) || 1000 / 58, stats: { passes: 0 },
    level: 0, pressure: 0, skipped: 0, nearCapped: false,
    // HANG GUARD: frames on the GPU queue, the GPU time of the last done one
    inFlight: 0, maxInFlight: MAX_IN_FLIGHT, gpuMs: 0, stalls: 0, heavy: 0,
    hv: { scale: 1, level: 0, cool: 0 },
    // SAFARI GUARD
    near: false, nearAt: -1e9, readyAt: 0, stuck: 0, memOver: 0, relieved: 0, lastRelief: -1e9, targetBuilds: 0,
    pending: [],   // { t0, done } of the frames on the queue
  };
  const P = () => gpu.profile || {};
  const now = () => (globalThis.performance ? performance.now() : Date.now());

  // the render size: budget.js pixelCap of the swap chain size
  const renderSize = () => pixelCap(P(), { cssW: fg.cssW, cssH: fg.cssH, dpr: fg.dpr, qualityIndex: gpu.qualityIndex, scale: fg.scale, near: fg.near, pressure: fg.pressure });
  // the soft scale floor of the slow-frame path (a heavy frame goes under it)
  const floorOf = () => Math.min(P().scaleFloor ?? (/^phone/.test(gpu.profileId || P().id || '') ? 0.5 : 0.75), fg.maxScale);
  // the lowest level: after a memory relief the shadow memory stays down
  const levelFloor = () => Math.max(P().govMin | 0, fg.pressure ? RELIEF_LEVEL : 0);

  // UPSCALE: the pass, and the mid target at the render size
  const up = gpu.canvasFormat ? createUpscaler(device, gpu.canvasFormat) : null;
  fg.upscaler = up;
  function upTargets() {
    const need = !!(up && up.ready && fg.T && (fg.w < fg.outW || fg.h < fg.outH));
    if (fg.U && (!need || fg.U.w !== fg.w || fg.U.h !== fg.h)) { fg.U.tex.destroy(); fg.U = null; }
    if (need && !fg.U) {
      const tex = device.createTexture({ label: 'upscale source', size: [fg.w, fg.h], format: gpu.canvasFormat, usage: U.RENDER_ATTACHMENT | U.TEXTURE_BINDING });
      const view = tex.createView();
      fg.U = { tex, view, w: fg.w, h: fg.h, bg: up.bindGroup(view) };
    }
    if (fg.T) parts.post.resize(fg.w, fg.h, fg.U ? fg.w : fg.outW, fg.U ? fg.h : fg.outH);
  }
  if (up) up.onReady = () => upTargets();

  function targets() {
    const rs = renderSize();
    const w = rs.w, h = rs.h;
    if (fg.T && fg.w === w && fg.h === h) return false;
    if (fg.T) for (const t of fg.T.all) t.destroy();
    fg.w = w; fg.h = h; fg.targetBuilds++;
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
    // the near-ground cap is on when it made the render smaller (status line)
    fg.nearCapped = !!rs.near && w * h + 2 * (w + h) < Math.round(rs.outW * fg.scale) * Math.round(rs.outH * fg.scale);
    upTargets();
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
    // the pixel ratio cap by quality (Low 1x), the profile caps (a phone
    // 1.5, Safari pxCap 3.5 Mpx), 1x after a memory relief, 8.3 Mpx at most
    const rs = renderSize();
    fg.outW = rs.outW; fg.outH = rs.outH;
    if (!targets()) upTargets();
  };
  // the eye height over the ground (main.js, each frame): near the ground
  // the render size is under the profile nearPxCap (with hysteresis)
  fg.setNear = agl => {
    const n = nearStep(fg.near, agl);
    if (n === fg.near) return false;
    // into the near state at once (before the heavy frames); out of it
    // only after NEAR_HOLD, so a wheel to and fro makes no target storm
    if (!n && now() - fg.nearAt < NEAR_HOLD) return false;
    if (n) fg.nearAt = now();
    fg.near = n;
    return P().nearPxCap ? targets() : false;
  };
  // too much GPU memory or a stuck GPU: the pixel ratio 1, the scale under
  // 0.75, RELIEF_LEVEL (half shadow maps and the rungs before it) as the
  // floor of the level from now on; at most one time per 3 s
  function relieve(why) {
    const t = now();
    if (t - fg.lastRelief < 3000) return false;
    // nothing left to lower (the modules keep what they made): no loop
    if (fg.pressure && fg.maxScale <= 0.75 && fg.level >= RELIEF_LEVEL) return false;
    fg.lastRelief = t; fg.relieved++;
    console.warn('dla-terrain: GPU relief (' + why + ')');
    fg.pressure++;
    fg.maxScale = Math.min(fg.maxScale, 0.75);
    gv.scale = Math.min(gv.scale, fg.maxScale);
    fg.scale = gv.scale;
    setLevel(Math.max(fg.level, RELIEF_LEVEL));
    fg.resize(fg.cssW, fg.cssH, fg.dpr);
    return true;
  }
  fg.relieve = relieve;
  // false when fg.render would skip this frame (see the header)
  fg.ready = () => {
    if (globalThis.document && document.visibilityState === 'hidden') return false;
    const t = now();
    // a frame that is not done after STUCK_MS frees its slot (heavy)
    for (const r of fg.pending) if (!r.done && t - r.t0 > STUCK_MS) {
      r.done = true; fg.stuck++;
      fg.inFlight = Math.max(0, fg.inFlight - 1);
      fg.onGpuTime(t - r.t0);
    }
    fg.pending = fg.pending.filter(r => !r.done);
    if (fg.inFlight >= Math.min(fg.maxInFlight, inFlightCap(P(), fg.gpuMs))) return false;
    if (t < fg.readyAt) return false;
    return true;
  };
  fg.setScale = s => { fg.scale = Math.max(0.4, Math.min(1, s)); gv.scale = fg.scale; targets(); };
  fg.tick = ms => {
    if (!fg.dynamic) return;
    // a CPU gap over 250 ms is a stall of the page (a hidden tab, a GC),
    // but a GPU time over 250 ms is a real slow frame: it counts
    const g = fg.gpuMs > 0 ? fg.gpuMs : 0;
    if (ms > 250) ms = g > 250 ? g : 0;
    if (!(ms > 0)) return;
    const r = governorStep(gv, { ms, gpuMs: g }, { budget: fg.budgetMs, maxScale: fg.maxScale, floor: floorOf(), minLevel: levelFloor(), maxLevel: STEADY_MAX });
    if (!r) return;
    if (r.what === 'scale') { fg.scale = gv.scale; targets(); }
    else setLevel(gv.level);
  };
  // the features of the level (gpu/governor.js planOf). base: the shadow
  // size, the cascades and TAA of the quality preset (and the user), taken
  // when the first rung goes on and given back when the last goes off
  let base = null;
  const baseOf = () => {
    if (!base) {
      const sh = parts.shadows || {};
      base = { size: sh.size || 2048, count: sh.count || 1, taa: !(parts.post && parts.post.settings && parts.post.settings.taa === false) };
    }
    return base;
  };
  fg.plan = planOf(featuresOf(0), { taa: true, size: 2048, count: 4 });
  fg.feats = featuresOf(0);
  fg.govInfo = { level: 0, keys: [], cloudK: 1, text: '' };
  function applyFeatures() {
    const f = featuresOf(fg.level, P().govForce);
    if (!f.size && !base) { fg.feats = f; fg.plan = planOf(f, baseOf()); base = null; }
    else {
      const b = baseOf(), pl = planOf(f, b);
      const sh = parts.shadows;
      if (sh && sh.resize && (sh.size !== pl.shadowSize || sh.count !== pl.cascades)) sh.resize(pl.shadowSize, pl.cascades);
      if (parts.post && parts.post.settings) parts.post.settings.taa = pl.taa;
      fg.feats = f; fg.plan = pl;
      // back at full: forget the base (the preset values are in place)
      if (!f.size) base = null;
    }
    fg.govInfo = { level: fg.level, keys: [...fg.feats], cloudK: fg.plan.cloudK, text: fg.govText() };
  }
  function setLevel(l) {
    fg.level = gv.level = Math.max(levelFloor(), Math.min(MAX_LEVEL, l | 0));
    applyFeatures();
  }
  fg.setLevel = setLevel;
  // main.js after a quality change: the new preset values are the base
  fg.rebase = () => { base = null; applyFeatures(); };
  // the status line: what is lower than the preset ('' when nothing)
  fg.govText = () => describe({ scale: fg.scale, maxScale: fg.maxScale, level: fg.level, force: P().govForce, nearCap: fg.near && fg.nearCapped });
  // the plan on the frame object (main.js calls it before the module
  // updates; fg.render calls it again, it is idempotent)
  fg.prepare = frame => {
    const pl = fg.plan;
    frame.govLevel = pl.compatLevel;
    frame.gov = fg.govInfo;
    frame.taa = !(parts.post && parts.post.settings && parts.post.settings.taa === false);
    if (!pl.ao) frame.ao = false;
    if (pl.shafts) {
      const s0 = frame.shafts || {};
      if (s0.mode !== 'off' && s0.mode !== pl.shafts) frame.shafts = { ...s0, mode: pl.shafts };
    }
    if (!pl.grass || !pl.clouds) {
      const ly = frame.layers || {};
      if ((!pl.grass && ly.grass !== false) || (!pl.clouds && ly.clouds !== false)) {
        frame.layers = { ...ly, ...(pl.grass ? {} : { grass: false }), ...(pl.clouds ? {} : { clouds: false }) };
      }
    }
    return frame;
  };
  // HANG GUARD: the GPU time of each done frame
  fg.onGpuTime = ms => {
    fg.gpuMs = ms;
    if (!fg.dynamic) return;
    const heavyMs = P().heavyMs || HEAVY_MS;
    // a heavy frame stops the step up at once (and pauses it)
    if (ms > heavyMs) governorHeavy(gv);
    fg.hv.scale = gv.scale; fg.hv.level = gv.level;
    const r = heavyStep(fg.hv, ms, HEAVY_FLOOR, heavyMs);
    if (!r.changed) return;
    fg.heavy++;
    console.warn(`dla-terrain: heavy GPU frame ${ms.toFixed(0)} ms: scale ${r.scale}, level ${r.level}`);
    gv.over = 0; gv.head = 0; gv.calm = 0;
    if (r.scale !== gv.scale) { gv.scale = fg.scale = r.scale; targets(); }
    if (r.level !== gv.level) setLevel(r.level);
  };
  // out of memory (gpu/device.js): smaller targets now, then the profile
  // caps apply to what the modules make next
  if (gpu.onPressure) gpu.onPressure(() => { fg.lastRelief = -1e9; relieve('out of memory'); });
  // the forced rungs of the profile (safe: no POM, 1 cascade) from the
  // first frame
  setLevel(P().govMin | 0);

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
    // HANG GUARD: no backlog on the GPU queue, and the idle gap of a heavy
    // frame (SAFARI GUARD)
    if (!fg.ready()) { fg.stalls++; return false; }
    // SAFARI GUARD: the GPU bytes under the profile budget
    if (gpu.mem && P().memGuard && P().budgetMB && (fg.stats.frames = (fg.stats.frames || 0) + 1) % MEM_CHECK === 0
      && gpu.mem.live > P().budgetMB * MB) { fg.memOver++; relieve(`GPU memory ${(gpu.mem.live / MB).toFixed(0)} MB over ${P().budgetMB} MB`); }
    fg.prepare(frame);
    frame.near = fg.near;   // SAFARI GUARD: the eye near the ground (modules may do less)
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
    // the casters go last: only the emergency level takes them away
    const casters = fg.plan.casters ? mods.filter(m => m.drawShadow) : [];
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
    // ── 6 volumetric (volumetricPrep first: compute passes that read the
    // depth after water and the shadow map of this frame, SKY's shafts)
    for (const m of mods) if (m.volumetricPrep) guard(m, 'volumetricPrep', () => m.volumetricPrep(enc, frame, { ...ctx, depthView: T.depthView, depthTexture: T.depth, depthIsCopy: false }));
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
    if (fg.U) {
      // UPSCALE: post at the render size, then the filter to the swap chain
      parts.post.run(enc, { hdrView: T.hdrView, depthView: T.depthView, key: fg.key }, fg.U.view, frame.dt);
      up.draw(enc, fg.U.bg, out); passes++;
    } else parts.post.run(enc, { hdrView: T.hdrView, depthView: T.depthView, key: fg.key }, out, frame.dt);
    device.queue.submit([enc.finish()]);
    parts.post.afterSubmit();
    const q = device.queue;
    if (q.onSubmittedWorkDone) {
      fg.inFlight++;
      const rec = { t0: now(), done: false };
      fg.pending.push(rec);
      const fin = ok => {
        if (rec.done) return;   // freed by the STUCK_MS check
        rec.done = true;
        fg.inFlight = Math.max(0, fg.inFlight - 1);
        if (!ok) return;
        const ms = now() - rec.t0;
        fg.onGpuTime(ms);
        // the idle gap: the GPU rests for dutyIdle x the frame time
        const k = P().dutyIdle || 0;
        if (k > 0 && ms > Math.max(fg.budgetMs, (P().heavyMs || HEAVY_MS) * 0.5)) fg.readyAt = now() + Math.min(ms * k, 1000);
      };
      q.onSubmittedWorkDone().then(() => fin(true), () => fin(false));
    }
    fg.stats.passes = passes;
    return true;
  };
  fg.targets = targets;
  return fg;
}
