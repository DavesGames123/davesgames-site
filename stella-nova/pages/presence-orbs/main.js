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
//
//  SCREENSAVER  (grep "window.snSaver", "function saverEnter", "function saverFrame")
//  ----------------------------------------------------------------------------
//      The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts).
//      One full-window canvas shows one calm species at a time, centered on the
//      ink ground. The species changes 3 times per dwell behind a fade to ink.
//      Each species goes idle -> listening -> idle. Nothing else draws.
//      saverPlate() sends opts.label the species record and the shared drive
//      equations, refreshed once a second.
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
import { $, STATES, SEED, ENTRY, ease, sstep, ACT_LIFT, LVL_LIFT, ATTACK, RELEASE, G, stage, clock, tiles, hexToRgb } from './state.js';
import { initSignals, tickSignals } from './signals.js';
import { initControls } from './controls.js';
import { fitTable, maxDpr, initMobile } from '../../lib/table-mobile.js';
import { initGPU, device, msurf, visible, stats, makeSurface } from './gpu.js';
import { initInspector, currentInspected } from './inspector.js';

// Pack source lives in real .wgsl files under shaders/. Fetch it all up front.
// The hook is defined before the awaits, so the shell finds it at once.
// enter() waits for initGPU and rejects if WebGPU is absent (generic mode).
let saverBoot; const saverGate = new Promise(r => { saverBoot = r; });
window.snSaver = { enter: opts => saverGate.then(go => go ? go(opts || {}) : Promise.reject(new Error('no WebGPU'))) };

const FAMILIES = ['glass', 'liquid', 'ink', 'light', 'signal', 'orb', 'presence'];
const SH = await loadShaders(import.meta.url, FAMILIES.map(f => `shaders/${f}.wgsl`));
const PACKS = Object.fromEntries(FAMILIES.map(f => [f, SH[`shaders/${f}.wgsl`]]));
const STYLES = await (await fetch(new URL('styles.json', import.meta.url))).json();

// table sizing: 6 wide on a desktop, 3 or 4 on a phone (lib/table-mobile.js), square cells, the stage scrolls
const COLS = 6;
const fit = () => fitTable(stage, COLS);
new ResizeObserver(fit).observe(stage); fit();

initSignals();
initControls();
initMobile();

// initGPU reports its own failure (the note plus the FPS line), so a false
// return ends the boot; a true return means the grid is live.
if (await initGPU(STYLES, PACKS)) {
  initInspector(PACKS);

  let last = clock(), fpsT = 0, frames = 0;
  function fill(t, surf, rect, dpr, now, ox, oy) {
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
    d[0] = rect.width; d[1] = rect.height; d[2] = ox || 0; d[3] = oy || 0;
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
  // The tab shell removes this iframe on a page swap, which fires pagehide.
  // Release the device and stop the loop there. Without it every swap orphans
  // a live device and the renderer runs out of GPU memory.
  let torn = false;
  addEventListener('pagehide', () => { if (torn) return; torn = true; try { device.destroy(); } catch (_) {} });
  function frame() {
    if (torn) return;
    requestAnimationFrame(frame);
    const now = clock();
    let dt = Math.min(Math.max(now - last, 0), 0.25); last = now;
    if (G.paused) dt = 0;
    frames++;
    if (now - fpsT > 1) { $('fps').textContent = `${Math.round(frames / (now - fpsT))} FPS · ${stats.compiled}/66`; fpsT = now; frames = 0; }
    tickSignals();
    const ap = (v, g) => v + (g - v) * (1 - Math.exp(-dt / (g > v ? ATTACK : RELEASE)));
    G.live.level = ap(G.live.level, G.level); G.live.activity = ap(G.live.activity, G.activity);
    const dpr = Math.min(devicePixelRatio || 1, maxDpr());
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
      if (saver || modalOpen || !visible.has(t)) continue;   // behind the blur or off-screen: skip the draw
      const rect = t.canvas.getBoundingClientRect();
      if (rect.width < 1) continue;
      drawTo(enc, t, t.surf, rect, dpr, now);
    }
    if (saver) saverFrame(enc, now);
    device.queue.submit([enc.finish()]);
  }

  // ── screensaver ──────────────────────────────────────────────────────────
  // Calm species only: no lightning (tempest), no colour flashes (opal), no
  // counted sparkles (glimmer), no near-black (abyss). Order, tones and the
  // first species come from opts.seed. G.tempo follows opts.calm.
  const SAVER_CELLS = ['aura', 'nebula', 'fathom', 'duet', 'helix', 'flux', 'sol', 'still', 'eddy', 'tide', 'meander', 'confluence',
    'marbling', 'strata', 'halation', 'caustic', 'aurora', 'lantern', 'eclipse', 'murmuration', 'veil', 'breathe', 'orbit', 'daybreak', 'skein', 'nucleus', 'braid'];
  const SAVER_TONES = ['#5a8cc0', '#7a72c8', '#4fa39a', '#c0905a', '#8fb0d8', '#b07aa8'];
  const FADE = 1.6;
  let saver = null;
  function saverEnter(opts) {
    const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7)), secs = Math.max(20, +opts.seconds || 60);
    let r = (opts.seed >>> 0) || 1; const rnd = () => { r = (r + 0x6D2B79F5) >>> 0; let x = Math.imul(r ^ (r >>> 15), 1 | r); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const list = tiles.filter(t => SAVER_CELLS.includes(t.s.name));
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const style = document.createElement('style');
    style.textContent = `html.orb-saver, html.orb-saver body { background: #0e1118 !important; overflow: hidden !important; cursor: none !important; }
html.orb-saver body > :not(#orb-saver) { display: none !important; }
#orb-saver { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; z-index: 2147483647; background: #0e1118; }`;
    document.head.appendChild(style);
    const canvas = document.createElement('canvas'); canvas.id = 'orb-saver';
    document.body.appendChild(canvas); document.documentElement.classList.add('orb-saver');
    G.ink = hexToRgb('#0e1118'); G.pointer = null; G.paused = false; G.tempo = 1 - 0.55 * calm;
    // the fade draws the ink colour over the orb with blend constant a: out = ink * a + orb * (1 - a)
    const k = G.ink.map(v => v.toFixed(4)).join(', ');
    const mod = device.createShaderModule({ code: `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); return vec4f(p[i], 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(${k}, 1.0); }` });
    const format = navigator.gpu.getPreferredCanvasFormat();
    const fade = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, primitive: { topology: 'triangle-list' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'constant', dstFactor: 'one-minus-constant' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] } });
    saver = { canvas, surf: makeSurface(canvas), fade, list, i: -1, t: null, t0: 0, per: Math.max(14, secs / 3), rnd, step: 0,
      label: typeof opts.label === 'function' ? opts.label : null, plateAt: 0, tone: SAVER_TONES[0] };
    saverNext(clock());
    return { canvas, warmupMs: 1200 };
  }
  // the next species starts idle from a fresh phase, under a full ink fade
  function saverNext(now) {
    const s = saver; s.i = (s.i + 1) % s.list.length; s.t = s.list[s.i]; s.t0 = now; s.step = 0;
    const t = s.t; t.prev = t.cur = 'idle'; t.changedAt = now - 5; t.phase = 0; t.sig.fill(0);
    s.tone = SAVER_TONES[Math.floor(s.rnd() * SAVER_TONES.length)];
    G.tone = G.tone2 = hexToRgb(s.tone);
    saverPlate(now);
  }
  // The plate: the species record from styles.json (name, description, WGSL
  // function, knobs) and the shared drive that fill() and frame() compute for
  // every orb (state crossfade, phase rate, glow lift, voice signal). The
  // per-species WGSL body is not restated. One title per species, so the
  // live values refresh in place.
  function saverPlate(now) {
    const s = saver; if (!s.label || !s.t) return;
    s.plateAt = now;
    const t = s.t, tau = now - t.changedAt, from = SEED[t.prev], to = SEED[t.cur], k = ease(tau);
    const mix = f => from[f] * (1 - k) + to[f] * k, f2 = v => v.toFixed(2);
    s.label({ title: 'Presence orb · ' + t.s.name, sub: t.s.species,
      eq: ['k = smoothstep(τ / 0.6)   (state crossfade)',
        'x = x_from·(1 − k) + x_to·k',
        'φ ← φ + dt·speed·(1 + 0.25·A)·tempo',
        'glow = glow_state·(1 + 0.35·L)',
        'voice ← voice + L^0.65·(1 or 0.55)·dφ',
        'fade: out = ink·a + orb·(1 − a)'],
      lines: ['fn ' + t.s.fn + ' · ' + t.s.family + ' pack · ' + t.s.knobs.map((q, i) => 'c' + i + ' ' + q[0] + ' ' + f2(t.knobs[i])).join(', '),
        'state ' + (t.prev === t.cur ? t.cur : t.prev + ' → ' + t.cur) + ' · speed ' + f2(mix('speed')) + ' · glow ' + f2(mix('glow')) + ' · depth ' + f2(mix('depth')),
        'listening from ' + Math.round(s.per * 0.34) + ' s to ' + Math.round(s.per * 0.7) + ' s of ' + Math.round(s.per) + ' s · tempo ' + f2(G.tempo),
        'level L = ' + f2(G.live.level) + ' · activity A = ' + f2(G.live.activity) + ' · tone ' + s.tone] });
  }
  function saverState(t, st, now) { if (t.cur !== st) { t.prev = t.cur; t.cur = st; t.changedAt = now; } }
  function saverFrame(enc, now) {
    const s = saver; let tau = now - s.t0;
    if (tau >= s.per) { saverNext(now); tau = 0; }
    const t = s.t;
    saverState(t, tau > s.per * 0.34 && tau < s.per * 0.7 ? 'listening' : 'idle', now);
    if (now - s.plateAt >= 1) saverPlate(now);
    if (!t.pipeline) return;
    const cv = s.canvas, r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const S = Math.round(Math.min(r.width, r.height) * 0.78);
    fill(t, s.surf, { width: S, height: S, left: 0, right: S, top: 0, bottom: S }, dpr, now, (w - S * dpr) / 2, (h - S * dpr) / 2);
    const a = 1 - sstep(Math.min(tau, s.per - tau) / FADE);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: s.surf.ctx.getCurrentTexture().createView(), clearValue: { r: G.ink[0], g: G.ink[1], b: G.ink[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(t.pipeline); pass.setBindGroup(0, s.surf.bind); pass.draw(3);
    if (a > 0.001) { pass.setPipeline(s.fade); pass.setBlendConstant({ r: a, g: a, b: a, a }); pass.draw(3); }
    pass.end();
  }
  saverBoot(saverEnter);
  requestAnimationFrame(frame);
} else saverBoot(null);
