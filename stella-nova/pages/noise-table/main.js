// ============================================================================
//  NOISE TABLE  ·  main.js — data load and frame loop (the entry module)
// ----------------------------------------------------------------------------
//  This module loads the data, starts each subsystem and runs the frame loop.
//  It fetches the WGSL pack and the styles.json catalog before it builds any
//  GPU object, so the original synchronous order is kept.
//
//  MODULE MAP  (this file is the entry; each subsystem is its own ES module)
//  ----------------------------------------------------------------------------
//      state.js ....... shared globals, G, tiles, palette
//      signals.js ..... the three signal generators (initSignals/tickSignals/sigTime)
//      controls.js .... palette and hover-mode chip (initControls)
//      highlight.js ... WGSL colorizer for the inspector
//      gpu.js ......... device, surfaces, tiles, pipelines (initGPU)
//      inspector.js ... the modal (initInspector/currentInspected)
//      ../../lib/table-mobile.js .. phone columns, controls drawer, touch
//                       autoplay line (playhead), pixel-ratio cap
//
//  DATA
//      shaders/noise.wgsl .. the one pack, 80 fragment entry points, fetched
//      styles.json ......... the 80 primitive records (name/family/fn/knobs)
//
//  FRAME LOOP  (requestAnimationFrame)
//  ----------------------------------------------------------------------------
//      tick signals -> ease each tile's hover rate -> pick the tiles that draw
//      -> advance their clocks -> draw them into their caches -> on an active
//      frame, present every visible cache into its canvas -> submit
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
import { $, G, stage, tiles } from './state.js';
import { initSignals, tickSignals, sigTime } from './signals.js';
import { initControls } from './controls.js';
import { initGPU, device, msurf, visible, stats, sizeSurface, present } from './gpu.js';
import { initInspector, currentInspected } from './inspector.js';
import { TOUCH, fitTable, playhead, maxDpr, initMobile } from '../../lib/table-mobile.js';

// Pack source lives in a real .wgsl file under shaders/. Fetch it up front.
const SH = await loadShaders(import.meta.url, ['shaders/noise.wgsl']);
const PACK = SH['shaders/noise.wgsl'];
const STYLES = await (await fetch(new URL('styles.json', import.meta.url))).json();

// table sizing: 6 wide on a desktop, 3 or 4 on a phone, square cells, the stage scrolls
const COLS = 6;
const fit = () => fitTable(stage, COLS);
new ResizeObserver(fit).observe(stage); fit();

initSignals();
initControls();
initMobile();

// initGPU reports its own failure (the note plus the FPS line), so a false
// return ends the boot; a true return means the table is live.
if (await initGPU(STYLES, PACK)) {
  initInspector(PACK);

  // The tab shell removes this iframe on a page swap, which fires pagehide.
  // Release the device and stop the loop there. Without it every swap orphans
  // a live device and the renderer runs out of GPU memory.
  let torn = false;
  addEventListener('pagehide', () => { if (torn) return; torn = true; try { device.destroy(); } catch (_) {} });

  // ANIM_CAP bounds how many easing-out tiles run the shader in one frame. A
  // mouse sweep leaves many tiles easing out at once. The hovered and
  // inspected tiles always draw. The overflow goes to the tiles that drew
  // least recently, and a tile that does not draw does not advance its
  // clock, so it pauses and does not jump.
  //
  // Presentation is separate from drawing. On an active frame (a draw, a
  // scroll, or HOLD seconds after one), every visible surface copies its
  // cache into its canvas, drawn or not. See gpu.js.
  const ANIM_CAP = 12, HOLD = 0.5;
  let fpsT = 0, frames = 0, frameNo = 0, activeUntil = 0, prev = { scale: 1, gain: 1, ink: '', tone: '', cream: '' };
  stage.addEventListener('scroll', () => { activeUntil = sigTime() + HOLD; }, { passive: true });
  function fill(t, surf, rect, dpr) {
    const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.scale; d[17] = G.gain; d[18] = 0; d[19] = 0;
    d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
  }
  const sizeTo = (surf, rect, dpr) => sizeSurface(surf, Math.max(1, Math.round(rect.width * dpr)), Math.max(1, Math.round(rect.height * dpr)));
  function drawTo(enc, t, surf, rect, dpr) {
    fill(t, surf, rect, dpr);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.cache.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, surf.bind); pass.draw(3); pass.end();
    surf.drawn = true;
  }
  function frame() {
    if (torn) return;
    requestAnimationFrame(frame);
    const dt = tickSignals(); const now = sigTime(); frameNo++;
    frames++; if (now - fpsT > 1) { $('fps').textContent = `${Math.round(frames / (now - fpsT))} FPS · ${stats.compiled}/${tiles.length}`; fpsT = now; frames = 0; }
    // global changes redraw everything once
    const key = { scale: G.scale, gain: G.gain, ink: G.ink.join(), tone: G.tone.join(), cream: G.cream.join() };
    const globalDirty = Object.keys(key).some(k => key[k] !== prev[k]); prev = key;
    const dpr = Math.min(devicePixelRatio || 1, maxDpr());
    const enc = device.createCommandEncoder(); let any = false;
    const inspected = currentInspected();
    // on a touch screen with no hover, the row under the playhead line animates (t.focus)
    const band = (TOUCH && G.hoverOnly && !inspected) ? playhead(stage) : null;
    // pass 1: ease the rates (the clock eases in and out, nothing snaps), size the surfaces, pick the tiles that draw
    const eased = [];
    for (const t of tiles) {
      t.go = false; t.rect = null;
      if (t.pipeline && visible.has(t)) { const rect = t.canvas.getBoundingClientRect(); if (rect.width >= 1) t.rect = rect; }
      const focus = band !== null && !!t.rect && t.rect.top <= band && t.rect.bottom > band;
      if (focus !== !!t.focus) { t.focus = focus; t.el.classList.toggle('tm-live', focus); }
      const want = (!G.hoverOnly || t.hover || t.focus || inspected === t) ? 1 : 0;
      t.rate += (want - t.rate) * (1 - Math.exp(-dt / 0.18));
      t.moving = t.rate > 0.002;
      if (!t.pipeline) { if (t.moving) t.phase += dt * t.rate * G.tempo; continue; }
      if (t.rect) {
        // a resized surface has a new, empty cache, so a size change is a reason to draw on its own
        const resized = sizeTo(t.surf, t.rect, dpr);
        if (t.dirty || globalDirty || resized || t.hover || t.focus || inspected === t) t.go = true;
        else if (t.moving) eased.push(t);
      }
      if (inspected === t) t.go = true;
    }
    eased.sort((a, b) => (a.lastDraw || 0) - (b.lastDraw || 0));
    for (let i = 0; i < eased.length && i < ANIM_CAP; i++) eased[i].go = true;
    // pass 2: advance the clocks of the tiles that draw, then draw
    for (const t of tiles) {
      if (!t.pipeline) continue;
      if (t.moving && (t.go || !t.rect)) t.phase += dt * t.rate * G.tempo;
      if (inspected === t) { const r = msurf.canvas.getBoundingClientRect(); const rs = sizeTo(msurf, r, dpr); if (t.moving || t.dirty || globalDirty || rs) { drawTo(enc, t, msurf, r, dpr); any = true; } }
      if (!t.go || !t.rect) continue;
      drawTo(enc, t, t.surf, t.rect, dpr); t.dirty = false; t.lastDraw = frameNo; any = true;
    }
    if (any) activeUntil = now + HOLD;
    if (now <= activeUntil) {
      for (const t of tiles) if (t.rect) present(enc, t.surf);
      if (inspected) present(enc, msurf);
      device.queue.submit([enc.finish()]);
    }
  }
  requestAnimationFrame(frame);
}
