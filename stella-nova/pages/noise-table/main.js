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
//
//  DATA
//      shaders/noise.wgsl .. the one pack, 78 fragment entry points, fetched
//      styles.json ......... the 78 primitive records (name/family/fn/knobs)
//
//  FRAME LOOP  (requestAnimationFrame)
//  ----------------------------------------------------------------------------
//      tick signals -> ease each tile's hover rate -> advance the hovered phase
//      -> redraw the moving, dirty or globally changed tiles -> submit if any
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
import { $, G, stage, tiles } from './state.js';
import { initSignals, tickSignals, sigTime } from './signals.js';
import { initControls } from './controls.js';
import { initGPU, device, msurf, visible, stats } from './gpu.js';
import { initInspector, currentInspected } from './inspector.js';

// Pack source lives in a real .wgsl file under shaders/. Fetch it up front.
const SH = await loadShaders(import.meta.url, ['shaders/noise.wgsl']);
const PACK = SH['shaders/noise.wgsl'];
const STYLES = await (await fetch(new URL('styles.json', import.meta.url))).json();

// table sizing: 6 wide, square cells, the stage scrolls
const COLS = 6;
function fit() { const w = stage.clientWidth - 24; document.documentElement.style.setProperty('--cell', Math.max(40, Math.floor(w / COLS)) + 'px'); }
new ResizeObserver(fit).observe(stage); fit();

initSignals();
initControls();

// initGPU reports its own failure (the note plus the FPS line), so a false
// return ends the boot; a true return means the table is live.
if (await initGPU(STYLES, PACK)) {
  initInspector(PACK);

  // The tab shell removes this iframe on a page swap, which fires pagehide.
  // Release the device and stop the loop there. Without it every swap orphans
  // a live device and the renderer runs out of GPU memory.
  let torn = false;
  addEventListener('pagehide', () => { if (torn) return; torn = true; try { device.destroy(); } catch (_) {} });

  // ANIM_CAP bounds how many tiles run the animated redraw in one frame. A
  // mouse sweep leaves many tiles easing out at once, and each tile owns its
  // own canvas, so an overrun frame lets neighbours present out of step. That
  // reads as flicker. The hovered tile always draws; the overflow holds.
  const ANIM_CAP = 12;
  let fpsT = 0, frames = 0, prev = { scale: 1, gain: 1, ink: '', tone: '', cream: '' };
  function fill(t, surf, rect, dpr) {
    const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = t.phase; d[3] = dpr;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    d[16] = G.scale; d[17] = G.gain; d[18] = 0; d[19] = 0;
    d.set(t.knobs, 20);
    device.queue.writeBuffer(surf.buf, 0, d);
  }
  function drawTo(enc, t, surf, rect, dpr) {
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (surf.canvas.width !== w || surf.canvas.height !== h) { surf.canvas.width = w; surf.canvas.height = h; t.dirty = true; }
    fill(t, surf, rect, dpr);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, surf.bind); pass.draw(3); pass.end();
  }
  function frame() {
    if (torn) return;
    requestAnimationFrame(frame);
    const dt = tickSignals(); const now = sigTime();
    let animBudget = ANIM_CAP;
    frames++; if (now - fpsT > 1) { $('fps').textContent = `${Math.round(frames / (now - fpsT))} FPS · ${stats.compiled}/${tiles.length}`; fpsT = now; frames = 0; }
    // global changes redraw everything once
    const key = { scale: G.scale, gain: G.gain, ink: G.ink.join(), tone: G.tone.join(), cream: G.cream.join() };
    const globalDirty = Object.keys(key).some(k => key[k] !== prev[k]); prev = key;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const enc = device.createCommandEncoder(); let any = false;
    const inspected = currentInspected();
    for (const t of tiles) {
      // the hovered cell's clock eases in over ~0.4 s and eases out again; nothing snaps
      const want = (!G.hoverOnly || t.hover || inspected === t) ? 1 : 0;
      t.rate += (want - t.rate) * (1 - Math.exp(-dt / 0.18));
      const moving = t.rate > 0.002;
      if (moving) t.phase += dt * t.rate * G.tempo;
      if (!t.pipeline) continue;
      const mustDraw = t.dirty || globalDirty;
      const needs = moving || mustDraw;
      if (inspected === t && needs) { drawTo(enc, t, msurf, msurf.canvas.getBoundingClientRect(), dpr); any = true; }
      if (!visible.has(t) || !needs) continue;
      if (!mustDraw) {
        const priority = t.hover || inspected === t;   // what the pointer is on draws every frame
        if (!priority) { if (animBudget <= 0) continue; animBudget--; }
      }
      const rect = t.canvas.getBoundingClientRect(); if (rect.width < 1) continue;
      drawTo(enc, t, t.surf, rect, dpr); t.dirty = false; any = true;
    }
    if (any) device.queue.submit([enc.finish()]);
  }
  requestAnimationFrame(frame);
}
