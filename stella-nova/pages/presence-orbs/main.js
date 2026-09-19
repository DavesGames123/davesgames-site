// ============================================================================
//  PRESENCE ORBS  ·  main.js — data load and frame loop (the entry module)
// ----------------------------------------------------------------------------
//  This module loads the data, starts each subsystem and runs the frame loop.
//  It fetches the seven WGSL packs and the styles.json catalog before it builds
//  any GPU object, so the original synchronous order is kept.
//
//  MODULE MAP  (this file is the entry; each subsystem is its own ES module)
//  ----------------------------------------------------------------------------
//      state.js ....... shared constants, seeds, easing, G, tiles, clock
//      signals.js ..... the three signal generators (initSignals/tickSignals)
//      controls.js .... state buttons, palette, pause (initControls)
//      highlight.js ... WGSL colorizer for the inspector
//      gpu.js ......... device, surfaces, tiles, pipelines (initGPU)
//      inspector.js ... the modal (initInspector/currentInspected)
//
//  DATA
//      shaders/<family>.wgsl .. one pack per family, fetched into PACKS
//      styles.json ............ the 66 species records (name/family/fn/knobs/arc)
//
//  FRAME LOOP  (requestAnimationFrame)
//  ----------------------------------------------------------------------------
//      tick signals -> attack/release the live level and activity -> per tile:
//      advance phase, integrate the signal accumulators, draw the inspected orb,
//      then draw the visible grid -> submit
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
import { $, STATES, SEED, ENTRY, ease, sstep, ACT_LIFT, LVL_LIFT, ATTACK, RELEASE, G, stage, clock, tiles } from './state.js';
import { initSignals, tickSignals } from './signals.js';
import { initControls } from './controls.js';
import { initGPU, device, msurf, visible, stats } from './gpu.js';
import { initInspector, currentInspected } from './inspector.js';

// Pack source lives in real .wgsl files under shaders/. Fetch it all up front.
const FAMILIES = ['glass', 'liquid', 'ink', 'light', 'signal', 'orb', 'presence'];
const SH = await loadShaders(import.meta.url, FAMILIES.map(f => `shaders/${f}.wgsl`));
const PACKS = Object.fromEntries(FAMILIES.map(f => [f, SH[`shaders/${f}.wgsl`]]));
const STYLES = await (await fetch(new URL('styles.json', import.meta.url))).json();

// table sizing: 6 wide, square cells, the stage scrolls
const COLS = 6;
function fit() {
  const w = stage.clientWidth - 24;
  const cell = Math.max(40, Math.floor(w / COLS));
  document.documentElement.style.setProperty('--cell', cell + 'px');
}
new ResizeObserver(fit).observe(stage); fit();

initSignals();
initControls();

// initGPU reports its own failure (the note plus the FPS line), so a false
// return ends the boot; a true return means the grid is live.
if (await initGPU(STYLES, PACKS)) {
  initInspector(PACKS);

  let last = clock(), fpsT = 0, frames = 0;
  function fill(t, surf, rect, dpr, now) {
    const tau = now - t.changedAt;
    const from = SEED[t.prev], to = SEED[t.cur], k = ease(tau), entry = ENTRY[to.entry];
    const speed = from.speed * (1 - k) + to.speed * k;
    const quick = speed * entry.speed(tau) * (1 + ACT_LIFT * G.live.activity) * G.tempo;
    const glow = (from.glow * (1 - k) + to.glow * k) * entry.glow(tau) * (1 + LVL_LIFT * G.live.level);
    let tilt = [0, 0];
    if (G.pointer && t.s.family === 'glass') {
      const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2, R = Math.max(rect.width, 1);
      tilt = [Math.max(-1, Math.min(1, (G.pointer[0] - cx) / (R * 3))), Math.max(-1, Math.min(1, (G.pointer[1] - cy) / (R * 3)))];
    }
    const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = 0; d[3] = 0;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.tone2[0], G.tone2[1], G.tone2[2], 1], 12);
    d[16] = tilt[0]; d[17] = tilt[1];
    d[18] = Math.max(t.phase + entry.phase(tau) * to.speed, 0) / Math.max(quick, 1e-6); d[19] = dpr;
    d[20] = from.hue * (1 - k) + to.hue * k; d[21] = 1; d[22] = quick; d[23] = from.depth * (1 - k) + to.depth * k;
    d[24] = glow; d[25] = t.knobs[0]; d[26] = t.knobs[1]; d[27] = t.knobs[2];
    d[28] = t.knobs[3]; d[29] = 0; d[30] = STATES.indexOf(t.cur); d[31] = Math.max(tau, 0);
    d[32] = G.live.level; d[33] = G.live.activity; d.set(t.sig, 34);
    device.queue.writeBuffer(surf.buf, 0, d);
  }
  function drawTo(enc, t, surf, rect, dpr, now) {
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (surf.canvas.width !== w || surf.canvas.height !== h) { surf.canvas.width = w; surf.canvas.height = h; }
    fill(t, surf, rect, dpr, now);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: surf.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, surf.bind); pass.draw(3); pass.end();
  }
  function frame() {
    requestAnimationFrame(frame);
    const now = clock();
    let dt = Math.min(Math.max(now - last, 0), 0.25); last = now;
    if (G.paused) dt = 0;
    frames++;
    if (now - fpsT > 1) { $('fps').textContent = `${Math.round(frames / (now - fpsT))} FPS · ${stats.compiled}/66`; fpsT = now; frames = 0; }
    tickSignals();
    const ap = (v, g) => v + (g - v) * (1 - Math.exp(-dt / (g > v ? ATTACK : RELEASE)));
    G.live.level = ap(G.live.level, G.level); G.live.activity = ap(G.live.activity, G.activity);
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const enc = device.createCommandEncoder();
    const inspected = currentInspected();
    const modalOpen = !!inspected;
    for (const t of tiles) {
      const tau = now - t.changedAt, from = SEED[t.prev], to = SEED[t.cur], k = ease(tau);
      const dp = dt * (from.speed * (1 - k) + to.speed * k) * ENTRY[to.entry].speed(tau) * (1 + ACT_LIFT * G.live.activity) * G.tempo;
      t.phase += dp;
      // integrate the signals over the shader's own clock, shaped exactly as the packs shape them
      { const L = G.live.level, A = G.live.activity;
        const voice = Math.pow(L, 0.65) * (t.cur === 'listening' ? 1.0 : 0.55);
        const pace = Math.pow(A, 0.85) * ((t.cur === 'thinking' || t.cur === 'responding') ? 1.0 : 0.60);
        const drive = t.cur === 'responding' ? sstep(tau / 0.55) : 0;
        const g = t.sig; g[0] += voice * dp; g[1] += pace * dp; g[2] += drive * dp; g[3] += voice * drive * dp; g[4] += pace * drive * dp; g[5] += L * dp; g[6] += A * dp; }
      if (!t.pipeline) continue;
      if (inspected === t) drawTo(enc, t, msurf, msurf.canvas.getBoundingClientRect(), dpr, now);
      if (modalOpen || !visible.has(t)) continue;   // behind the blur or off-screen: skip the draw
      const rect = t.canvas.getBoundingClientRect();
      if (rect.width < 1) continue;
      drawTo(enc, t, t.surf, rect, dpr, now);
    }
    device.queue.submit([enc.finish()]);
  }
  requestAnimationFrame(frame);
}
