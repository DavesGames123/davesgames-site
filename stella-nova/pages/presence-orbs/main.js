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
//      One full-window canvas shows a sequence of shots from director.js:
//      activity waves across a grid, colour waves, a push-in on one orb
//      through all six states, a conversation, and a relay along one family.
//      A shot lasts 5 to 12 s; opts.seed sets the order and opts.calm the pace.
//      Each orb in a shot draws into its own scissor square with its own tile
//      uniform buffer, so the cost is close to one full-window orb. The
//      squares sit in the clear band of the label plate (plateBand).
//      saverPlate() sends opts.label the shot text, the focus orb values and
//      the shared drive equations, refreshed once a second.
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
import { $, STATES, SEED, ENTRY, ease, sstep, ACT_LIFT, LVL_LIFT, ATTACK, RELEASE, G, stage, clock, tiles, hexToRgb } from './state.js';
import { initSignals, tickSignals } from './signals.js';
import { initControls } from './controls.js';
import { fitTable, maxDpr, initMobile } from '../../lib/table-mobile.js';
import { initGPU, device, msurf, visible, stats, makeSurface } from './gpu.js';
import { initInspector, currentInspected } from './inspector.js';
import { makeDirector, sampleShot, layoutShot, shotLabel } from './director.js';
import { plateBand } from '../../lib/saver-clear.js';

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
  // t.live and t.tone are per-orb values that the saver sets; the grid
  // uses the shared G.live and G.tone
  function fill(t, surf, rect, dpr, now, ox, oy) {
    const tau = now - t.changedAt, lv = t.live || G.live, tone = t.tone || G.tone, tone2 = t.tone || G.tone2;
    const from = SEED[t.prev], to = SEED[t.cur], k = ease(tau), entry = ENTRY[to.entry];
    const speed = from.speed * (1 - k) + to.speed * k;
    const quick = speed * entry.speed(tau) * (1 + ACT_LIFT * lv.activity) * G.tempo;
    const glow = (from.glow * (1 - k) + to.glow * k) * entry.glow(tau) * (1 + LVL_LIFT * lv.level);
    let tilt = [0, 0];
    if (G.pointer && t.s.family === 'glass') {
      const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2, R = Math.max(rect.width, 1);
      tilt = [Math.max(-1, Math.min(1, (G.pointer[0] - cx) / (R * 3))), Math.max(-1, Math.min(1, (G.pointer[1] - cy) / (R * 3)))];
    }
    const d = surf.data;
    d[0] = rect.width; d[1] = rect.height; d[2] = ox || 0; d[3] = oy || 0;
    d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([tone[0], tone[1], tone[2], 1], 8); d.set([tone2[0], tone2[1], tone2[2], 1], 12);
    d[16] = tilt[0]; d[17] = tilt[1];
    d[18] = Math.max(t.phase + entry.phase(tau) * to.speed, 0) / Math.max(quick, 1e-6); d[19] = dpr;
    d[20] = from.hue * (1 - k) + to.hue * k; d[21] = 1; d[22] = quick; d[23] = from.depth * (1 - k) + to.depth * k;
    d[24] = glow; d[25] = t.knobs[0]; d[26] = t.knobs[1]; d[27] = t.knobs[2];
    d[28] = t.knobs[3]; d[29] = 0; d[30] = STATES.indexOf(t.cur); d[31] = Math.max(tau, 0);
    d[32] = lv.level; d[33] = lv.activity; d.set(t.sig, 34);
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
      const tau = now - t.changedAt, from = SEED[t.prev], to = SEED[t.cur], k = ease(tau), lv = t.live || G.live;
      const dp = dt * (from.speed * (1 - k) + to.speed * k) * ENTRY[to.entry].speed(tau) * (1 + ACT_LIFT * lv.activity) * G.tempo;
      t.phase += dp;
      // integrate the signals over the shader's own clock, shaped exactly as the packs shape them
      { const L = lv.level, A = lv.activity;
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
    if (saver) saverFrame(enc, now, dt);
    device.queue.submit([enc.finish()]);
  }

  // ── screensaver ──────────────────────────────────────────────────────────
  // director.js plans the shots from opts.seed and opts.calm. Four species
  // stay out: no lightning (tempest), no colour flashes (opal), no counted
  // sparkles (glimmer), no near-black (abyss). G.tempo follows opts.calm.
  // Each orb of a shot writes its own tile uniform buffer (t.surf) and draws
  // into a scissor square of the one saver canvas, so the fragment count
  // stays near one full-window orb. A grid shot caps the DPR at 1.5.
  const SAVER_OUT = ['tempest', 'opal', 'glimmer', 'abyss'];
  const FADE = 0.45;
  let saver = null;
  function saverEnter(opts) {
    const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
    const pool = tiles.filter(t => !SAVER_OUT.includes(t.s.name)).map(t => t.s);
    const style = document.createElement('style');
    style.textContent = `html.orb-saver, html.orb-saver body { background: #0e1118 !important; overflow: hidden !important; cursor: none !important; }
html.orb-saver body > :not(#orb-saver) { display: none !important; }
#orb-saver { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; z-index: 2147483647; background: #0e1118; }`;
    document.head.appendChild(style);
    const canvas = document.createElement('canvas'); canvas.id = 'orb-saver';
    document.body.appendChild(canvas); document.documentElement.classList.add('orb-saver');
    G.ink = hexToRgb('#0e1118'); G.pointer = null; G.paused = false; G.tempo = 1 - 0.4 * calm;
    // the fade draws the ink colour over the orbs with blend constant a: out = ink * a + orb * (1 - a)
    const k = G.ink.map(v => v.toFixed(4)).join(', ');
    const mod = device.createShaderModule({ code: `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); return vec4f(p[i], 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(${k}, 1.0); }` });
    const format = navigator.gpu.getPreferredCanvasFormat();
    const fade = device.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, primitive: { topology: 'triangle-list' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'constant', dstFactor: 'one-minus-constant' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] } });
    saver = { canvas, surf: makeSurface(canvas), fade, dir: makeDirector({ seed: (opts.seed >>> 0) || 1, calm, pool }),
      byName: new Map(tiles.map(t => [t.s.name, t])), shot: null, cells: [], samp: null, layout: [], t0: 0,
      band: null, bandAt: -1e9, rect: null, label: typeof opts.label === 'function' ? opts.label : null, plateAt: 0 };
    saverNext(clock());
    return { canvas, warmupMs: 1200 };
  }
  // the next shot: its orbs start idle from a fresh phase, under the ink fade
  function saverNext(now) {
    const s = saver;
    for (const t of s.cells) { t.live = null; t.tone = null; }
    s.shot = s.dir.next(); s.t0 = now; s.samp = null; s.layout = [];
    s.cells = s.shot.cells.map(c => s.byName.get(c.name));
    for (const t of s.cells) { t.prev = t.cur = 'idle'; t.changedAt = now - 5; t.phase = 0; t.sig.fill(0); t.live = { level: 0, activity: 0 }; t.tone = null; }
    saverPlate(now);
  }
  // The plate: the shot text from director.js, the values of the focus orb
  // (the speaker, or the newest orb a wave woke), and the shared drive that
  // fill() and frame() compute for every orb. One title per shot, so the
  // live values refresh in place.
  function saverPlate(now) {
    const s = saver; if (!s.label || !s.shot) return;
    s.plateAt = now;
    const L = shotLabel(s.shot), fi = s.samp ? s.samp.focus : 0, t = s.cells[fi] || s.cells[0];
    const tau = now - t.changedAt, from = SEED[t.prev], to = SEED[t.cur], k = ease(tau);
    const mix = f => from[f] * (1 - k) + to[f] * k, f2 = v => v.toFixed(2);
    const awake = s.samp ? s.samp.cells.filter(c => c.st !== 'idle').length : 0, lv = t.live || G.live;
    // Colours: time and phase (tau, phi) m1, glow g m2, awake count m3, the
    // crossfade k m4, the voice inputs (L, A) m5, the rates (v, T) m6.
    s.label({ title: L.title, sub: L.sub,
      params: [{ sym: 'n', name: 'orbs awake', value: awake + ' / ' + s.cells.length, cls: 'm3' },
        { sym: 'L', name: 'voice level', value: f2(lv.level), cls: 'm5' },
        { sym: 'A', name: 'voice activity', value: f2(lv.activity), cls: 'm5' },
        { sym: 'v', name: 'phase speed', value: f2(mix('speed')), cls: 'm6' },
        { sym: 'g', name: 'glow', value: f2(mix('glow')), cls: 'm2' },
        { sym: 'T', name: 'tempo', value: f2(G.tempo), cls: 'm6' }],
      lines: [L.line,
        t.s.name + ' (' + t.s.family + ' pack, fn ' + t.s.fn + '): ' + (t.prev === t.cur ? t.cur : t.prev + ' → ' + t.cur)],
      tex: ['k = \\operatorname{smoothstep}(\\tau / 0.6), \\qquad x = (1 - k)\\,x_{\\text{from}} + k\\,x_{\\text{to}}',
        '\\varphi \\leftarrow \\varphi + \\Delta t\\, v\\,(1 + 0.25\\,A)\\,T',
        'g = g_{\\text{state}}\\,(1 + 0.35\\,L)',
        '\\nu \\leftarrow \\nu + L^{0.65}\\,c\\,\\Delta\\varphi, \\qquad c = 1 \\text{ or } 0.55'],
      rules: [['\\tau', 'm1'], ['\\varphi', 'm1'], ['g', 'm2'], ['k', 'm4'], ['L', 'm5'], ['A', 'm5'], ['v', 'm6'], ['T', 'm6']],
      eq: ['k = smoothstep(τ / 0.6)   (state crossfade)',
        'x = x_from·(1 − k) + x_to·k',
        'φ ← φ + dt·speed·(1 + 0.25·A)·tempo',
        'glow = glow_state·(1 + 0.35·L)',
        'voice ← voice + L^0.65·(1 or 0.55)·dφ',
        'fade: out = ink·a + orb·(1 − a)'],
      anchor: saverAnchor });
  }
  // The orbs on screen, for the shell's label plate. Each orb draws in a
  // square of side s; the orb shaders put the disc near radius 0.33 s, and
  // the orb pack (mo_*) about 0.38 s. One orb: a circle. More orbs: the box
  // round all discs, with the focus orb as the key point for the leader.
  function saverAnchor() {
    const s = saver; if (!s || !s.layout.length) return null;
    const rad = (c, i) => (s.cells[i] && s.cells[i].s.family === 'orb' ? 0.38 : 0.33) * c.s;
    if (s.layout.length === 1) { const c = s.layout[0]; return { x: c.x, y: c.y, r: rad(c, 0) }; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    s.layout.forEach((c, i) => { const r = rad(c, i); x0 = Math.min(x0, c.x - r); y0 = Math.min(y0, c.y - r); x1 = Math.max(x1, c.x + r); y1 = Math.max(y1, c.y + r); });
    const f = s.layout[Math.min(s.samp ? s.samp.focus : 0, s.layout.length - 1)];
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, pts: [{ x: f.x, y: f.y }], lead: true };
  }
  // a state change as controls.js setState makes it: an arc species restarts
  // its arc on thinking and success
  function saverState(t, st, now) {
    if (t.cur === st) return;
    t.prev = t.cur; t.cur = st; t.changedAt = now;
    if ((st === 'thinking' || st === 'success') && t.s.arc) { t.phase = 0; t.sig.fill(0); }
  }
  // The clear band of the plate, read 3 times a second. Between two shots the
  // plate swaps its text and plateBand gives null for a moment: keep the last
  // band. The rect eases to a new band, so the orbs never jump.
  function saverRect(now, dt) {
    const s = saver;
    if (now - s.bandAt > 0.3) { s.bandAt = now; const b = plateBand(innerHeight); if (b) s.band = b; }
    const W = innerWidth, H = innerHeight, b = s.band;
    const top = b ? b.t : 0.06 * H, bot = b ? b.b : 0.06 * H, w = b ? Math.min(W, b.w) : W;
    const tgt = { x: (W - w) / 2 + 0.04 * w, y: top, w: 0.92 * w, h: Math.max(0.3 * H, H - top - bot) };
    if (!s.rect) s.rect = tgt;
    else { const a = 1 - Math.exp(-dt / 0.3); for (const q of ['x', 'y', 'w', 'h']) s.rect[q] += (tgt[q] - s.rect[q]) * a; }
    return s.rect;
  }
  function saverFrame(enc, now, dt) {
    const s = saver; let tau = now - s.t0;
    if (tau >= s.shot.dur) { saverNext(now); tau = 0; }
    const sm = sampleShot(s.shot, tau); s.samp = sm;
    const ap = (v, g) => v + (g - v) * (1 - Math.exp(-dt / (g > v ? ATTACK : RELEASE)));
    s.cells.forEach((t, i) => {
      const c = sm.cells[i];
      saverState(t, c.st, now);
      t.live.level = ap(t.live.level, c.level); t.live.activity = ap(t.live.activity, c.activity); t.tone = c.tone;
    });
    if (now - s.plateAt >= 1) saverPlate(now);
    const cv = s.canvas, r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, s.cells.length > 1 ? 1.5 : 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    s.layout = layoutShot(s.shot, saverRect(now, dt), tau);
    const a = 1 - sstep(Math.min(tau, s.shot.dur - tau) / FADE);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: s.surf.ctx.getCurrentTexture().createView(), clearValue: { r: G.ink[0], g: G.ink[1], b: G.ink[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    s.cells.forEach((t, i) => {
      const c = s.layout[i]; if (!t.pipeline || !c) return;
      const S = c.s, ox = (c.x - S / 2) * dpr, oy = (c.y - S / 2) * dpr;
      const sx = Math.max(0, Math.floor(ox)), sy = Math.max(0, Math.floor(oy)), ex = Math.min(w, Math.ceil(ox + S * dpr)), ey = Math.min(h, Math.ceil(oy + S * dpr));
      if (ex <= sx || ey <= sy) return;
      fill(t, t.surf, { width: S, height: S, left: 0, right: S, top: 0, bottom: S }, dpr, now, ox, oy);
      pass.setScissorRect(sx, sy, ex - sx, ey - sy);
      pass.setPipeline(t.pipeline); pass.setBindGroup(0, t.surf.bind); pass.draw(3);
    });
    if (a > 0.001) { pass.setScissorRect(0, 0, w, h); pass.setPipeline(s.fade); pass.setBlendConstant({ r: a, g: a, b: a, a }); pass.draw(3); }
    pass.end();
  }
  saverBoot(saverEnter);
  requestAnimationFrame(frame);
} else saverBoot(null);
