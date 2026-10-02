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
//
//  SCREENSAVER  (lib/screensaver.js calls window.snSaver.enter(opts))
//      enter() hides the page, adds one full-window canvas and draws one calm
//      cell from SAVER_CELLS into it on each frame. grep -n "saverEnter", "saver.t"
//      saverPlate() builds the shell plate (opts.label): the cell name, the
//      knob values and tempo as params, and the formula as TeX (SAVER_TEX,
//      from styles.json eq, which stays as the plain fallback).
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
import { $, G, stage, tiles } from './state.js';
import { initSignals, tickSignals, sigTime } from './signals.js';
import { initControls } from './controls.js';
import { initGPU, device, msurf, visible, stats, makeSurface, sizeSurface, present } from './gpu.js';
import { initInspector, currentInspected } from './inspector.js';
import { TOUCH, fitTable, playhead, maxDpr, initMobile } from '../../lib/table-mobile.js';

// The screensaver hook is defined before the first fetch, so the shell finds
// it in time. enter() waits for the GPU; on a GPU failure it rejects and the
// shell uses its generic mode.
let saverEnter = null, saverReady, saverFail;
const saverGate = new Promise((a, b) => { saverReady = a; saverFail = b; }); saverGate.catch(() => {});
window.snSaver = { enter: opts => saverGate.then(() => saverEnter(opts || {})) };

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
  let saver = null;   // { t, canvas, surf } while the screensaver runs, see saverEnter
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
      const want = (!G.hoverOnly || t.hover || t.focus || inspected === t || (saver && saver.t === t)) ? 1 : 0;
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
      if (t.moving && (t.go || !t.rect || (saver && saver.t === t))) t.phase += dt * t.rate * G.tempo;
      if (saver && saver.t === t) { const r = saver.canvas.getBoundingClientRect(), sd = Math.min(devicePixelRatio || 1, 2); sizeTo(saver.surf, r, sd); drawTo(enc, t, saver.surf, r, sd); any = true; }
      if (inspected === t) { const r = msurf.canvas.getBoundingClientRect(); const rs = sizeTo(msurf, r, dpr); if (t.moving || t.dirty || globalDirty || rs) { drawTo(enc, t, msurf, r, dpr); any = true; } }
      if (!t.go || !t.rect) continue;
      drawTo(enc, t, t.surf, t.rect, dpr); t.dirty = false; t.lastDraw = frameNo; any = true;
    }
    if (any) activeUntil = now + HOLD;
    if (now <= activeUntil) {
      for (const t of tiles) if (t.rect) present(enc, t.surf);
      if (inspected) present(enc, msurf);
      if (saver) present(enc, saver.surf);
      device.queue.submit([enc.finish()]);
    }
  }
  // Screensaver: one calm cell (by opts.seed) draws into a full-window canvas.
  // The hash family (white, ign, sparkle and so on) re-hashes each frame and
  // strobes, so it is not in the list. The tempo slider goes to a speed from
  // opts.calm (1 = slowest). The shell reloads the page when the saver stops.
  const SAVER_CELLS = ['fbm', 'warp', 'warp_self', 'marble', 'wood', 'caustics', 'flow_lines', 'gabor_noise', 'plasma', 'worley_smooth', 'perlin3d', 'gyroid', 'contour', 'interference', 'billow', 'sum_sines'];
  saverEnter = async opts => {
    const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
    const list = tiles.filter(t => SAVER_CELLS.includes(t.s.name));
    let t = list[(opts.seed >>> 0) % list.length];
    for (const t0 = performance.now(); !t.pipeline && performance.now() - t0 < 12000;) await new Promise(r => setTimeout(r, 100));
    if (!t.pipeline) t = list.find(x => x.pipeline);
    if (!t) throw new Error('no cell compiled');
    const bias = $('tempo-bias'); bias.value = ((1.0 + (0.25 - 1.0) * calm) - 0.1) / 2.9; bias.dispatchEvent(new Event('input'));
    const style = document.createElement('style');
    style.textContent = `html.tbl-saver, html.tbl-saver body { background: #000 !important; overflow: hidden !important; cursor: none !important; }
html.tbl-saver body > :not(.tbl-saver-canvas) { display: none !important; }
.tbl-saver-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; z-index: 2147483647; background: #000; }`;
    document.head.appendChild(style);
    const canvas = document.createElement('canvas'); canvas.className = 'tbl-saver-canvas';
    document.body.appendChild(canvas); document.documentElement.classList.add('tbl-saver');
    saver = { t, canvas, surf: makeSurface(canvas) };
    // The plate goes now and again each second with the same title, so the
    // shell swaps the live values in place. It runs only while saver is set.
    if (typeof opts.label === 'function' && opts.labels !== false) {
      const push = () => { if (saver) { try { opts.label(saverPlate(saver.t)); } catch (_) {} } };
      push(); setInterval(push, 1000);
    }
    return { canvas, warmupMs: 600 };
  };
  // The saver plate TeX of each SAVER_CELLS cell: the first two lines of
  // styles.json eq, written as TeX (the page has no TeX of its own). sym
  // gives the TeX symbol of each knob, in knob order ('' for a knob with
  // no name). Colours: v m1, p and q m2, t and tau m3, the knobs m4, m5,
  // m6 in knob order (saverRules).
  const SAVER_TEX = {
    fbm: { sym: ['f', 'n', 'a', 'd'], tex: [String.raw`v = \tfrac12 + \tfrac12\,\mathrm{fbm}(f\,p + 0.2\,d\,t\,\hat{x})`,
      String.raw`\mathrm{fbm}(p) = \frac{\sum_{i<n} a^i\,\mathrm{noise}(R^i\,2^i p)}{\sum_{i<n} a^i}`] },
    warp: { sym: ['s', 'A', 'n', 'd'], tex: [String.raw`q = \big(\mathrm{fbm}(s\,p),\ \mathrm{fbm}(s\,p + (5.2, 1.3))\big)`,
      String.raw`v = \tfrac12 + \tfrac12\,\mathrm{fbm}(s\,p + A\,r),\quad r = \mathrm{fbm}(s\,p + A\,q + \dots)`] },
    warp_self: { sym: ['f', 'A', 'N', 'd'], tex: [String.raw`q \leftarrow q + 0.1\,A\,\big(-\partial_y \mathrm{noise},\ \partial_x \mathrm{noise}\big)\quad (N \text{ times})`,
      String.raw`v = \tfrac12 + \tfrac12\,\mathrm{fbm}(q),\quad q_0 = f\,p`] },
    marble: { sym: ['f', 'V', 'T', 'd'], tex: [String.raw`v = \tfrac12 + \tfrac12 \sin\big(V q_x + T\,\mathrm{turb}(q + 0.05\,d\,t)\big)`,
      String.raw`\mathrm{turb}(q) = \sum_{i<5} a^i\,\big|\mathrm{noise}(2^i q)\big|,\quad q = f\,p`] },
    wood: { sym: ['f', 'N', 'W', 'd'], tex: [String.raw`r = |q + (0.6, 0.2)| + W\,\mathrm{fbm}(2q + 0.05\,d\,t),\quad q = f\,p`,
      String.raw`v = \mathrm{fract}(N r)^{1/2}`] },
    caustics: { sym: ['f', 'A', 'k', '\\dot\\tau'], tex: [String.raw`q \leftarrow R(0.9)\,q + A\,\big(\sin(0.7\tau + i),\ \cos(0.5\tau - i)\big),\quad i = 1 \dots 4`,
      String.raw`s = \sum_i \big|\sin(2q_x + \tau) + \sin(2.3\,q_y - 0.8\,\tau)\big|,\quad v = (1 - 0.1\,s)^k`] },
    flow_lines: { sym: ['f', 'D', 'B', 'd'], tex: [String.raw`\theta = \operatorname{atan2}\big(\nabla \mathrm{fbm}(q)\big),\quad q = f\,p + 0.05\,d\,t`,
      String.raw`v = \tfrac12 + \tfrac12 \sin\big(D\,p\cdot(\cos\theta, \sin\theta) + B\,\mathrm{fbm}(q)\big)`] },
    gabor_noise: { sym: ['c', 'F', '\\iota', 'd'], tex: [String.raw`v = \tfrac12 + 0.35 \sum_i w_i\, g(x - x_i)`,
      String.raw`g(x) = e^{-\pi |x|^2} \cos\big(2\pi F\, x \cdot (\cos\omega_i, \sin\omega_i)\big)`] },
    plasma: { sym: ['f', '\\dot\\tau', 'b', ''], tex: [String.raw`V = \sin(x + \tau) + \sin(y + 0.7\tau) + \sin(x + y + 1.3\tau) + \sin(|q + 2c(\tau)| + \tau)`,
      String.raw`v = \tfrac12 + \tfrac12 \sin(b\,V),\quad q = f\,p`] },
    worley_smooth: { sym: ['f', 'k', '', 'd'], tex: [String.raw`v = -\frac{1}{k} \log_2 \sum_j 2^{-k\,|x - c_j|}`,
      String.raw`x = f\,p + 0.3\,d\,t,\quad 3 \times 3 \text{ cells}`] },
    perlin3d: { sym: ['f', 's', '', ''], tex: [String.raw`v = \tfrac12 + \tfrac12\,\mathrm{noise}_3(f\,p_x,\ f\,p_y,\ s\,t)`] },
    gyroid: { sym: ['f', 'w', 'L', '\\sigma'], tex: [String.raw`g = \sin x \cos y + \sin y \cos z + \sin z \cos x`,
      String.raw`v = 1 - \mathrm{smoothstep}\big(0, w, |g - L|\big),\quad (x, y, z) = (f\,p,\ \sigma t)`] },
    contour: { sym: ['f', 'n', 'w', 'd'], tex: [String.raw`v = \tfrac12 + \tfrac12\,\mathrm{fbm}(f\,p + 0.1\,d\,t)`,
      String.raw`\ell = 1 - \mathrm{smoothstep}\big(0, w, 2\,|\mathrm{fract}(n v) - \tfrac12|\big)`] },
    interference: { sym: ['f', '\\alpha_0', '\\omega', ''], tex: [String.raw`v = \tfrac12 + \tfrac14 \big(\sin(f\,p_x) + \sin(f\,(R(\alpha)\,p)_x)\big)`,
      String.raw`\alpha = \alpha_0 + 0.02 \sin(\omega t),\quad T_{\text{beat}} = \frac{2\pi}{f\alpha}`] },
    billow: { sym: ['f', 'n', 'a', 'd'], tex: [String.raw`v = 1 - 1.6\,\mathrm{turb}(f\,p + 0.2\,d\,t\,\hat{x})`,
      String.raw`\mathrm{turb}(p) = \frac{\sum_{i<n} a^i\,|\mathrm{noise}(2^i R^i p)|}{\sum_{i<n} a^i}`] },
    sum_sines: { sym: ['f', 'k', '\\omega', ''], tex: [String.raw`v = \frac{\sum_i 0.6^i \big(\tfrac12 + \tfrac12 \sin(f_i\,\hat{d}_i \cdot p + \omega(1 + 0.3i)\,t)\big)^k}{\sum_i 0.6^i}`,
      String.raw`f_i = f \cdot 1.6^i,\quad \hat{d}_i \text{ at angle } 1.9\,i,\quad 6 \text{ waves}`] },
  };
  const saverRules = sym => [['v', 'm1'], ['p', 'm2'], ['q', 'm2'], ['t', 'm3'], ['\\tau', 'm3']]
    .concat(sym.filter(Boolean).slice(0, 3).map((k, i) => [k, 'm' + (4 + i)]));
  // The saver plate for cell t: name, family, the knob settings (0 to 1, as
  // the knob sliders show them) as params in the knob colours, the tempo,
  // the species text, and the TeX of SAVER_TEX. eq of styles.json stays as
  // the plain fallback. No anchor: the cell fills the window.
  function saverPlate(t) {
    const s = t.s, X = SAVER_TEX[s.name] || { sym: [], tex: [] }, named = X.sym.filter(Boolean);
    const params = s.knobs.map(([n], i) => n && X.sym[i] ? { sym: X.sym[i], name: n, value: t.knobs[i].toFixed(2), cls: 'm' + (4 + named.indexOf(X.sym[i])) } : null)
      .filter(Boolean).map(p => (p.cls === 'm7' || p.cls === 'm3' ? Object.assign(p, { cls: '' }) : p));
    params.push({ sym: '\\dot t', name: 'tempo', value: G.tempo.toFixed(2) + '×' });
    return {
      title: s.name.replace(/_/g, ' ').replace(/^./, m => m.toUpperCase()),
      sub: (s.family.length <= 3 ? s.family.toUpperCase() : s.family.replace(/^./, m => m.toUpperCase())) + ' noise',
      params: params.slice(0, 5), lines: [s.species.replace(/^./, m => m.toUpperCase())],
      tex: X.tex, rules: saverRules(X.sym), eq: s.eq || [],
    };
  }
  saverReady();
  requestAnimationFrame(frame);
} else saverFail(new Error('no WebGPU'));
