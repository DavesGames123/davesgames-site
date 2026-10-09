// ============================================================================
//  JULIA FRACTALS  ·  pages/julia-fractals/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. The escape-time core, the upstream gradient and the Mono view are
//  Matthias Müller's Ten Minute Physics #19 (19-julia.html, MIT; the notice
//  is kept at the top of fractal.js). The credit bar (widgets/ten-minute-
//  physics/kit.js) names him on the page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): paths for c, the multibrot
//  power, smooth colouring with colour maps and cycling, dives, the inset
//  map, the WebGL2 renderer (gl.js), the progressive CPU renderer, this
//  controller, the sim kit GUI and the screensaver.
//
//  Every upstream control lives on in the kit panel: the Julia / Mandelbrot
//  button is "Set", Mono / Gradient are two of the Colouring options, the
//  Iterations slider is "Iterations", drag pans and shift-drag changes c.
//
//  Rendering: WebGL2 into an offscreen canvas, drawn into the 2D view; the
//  CPU path (double precision, progressive 8 -> 1 pixel blocks) takes over
//  where single precision runs out (pixel < 1e-6 of the coordinates) or
//  when there is no WebGL2.
//
//  grep -n targets: "function render", "function drawInset", "function bindPointer",
//  "function frame", "window.__julia"
// ============================================================================
import { renderCPU, cAt } from './fractal.js';
import { createGL } from './gl.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { installSaver } from './saver.js';
import * as SC from './scene.js';

TMP.page({ n: '19', title: 'Julia Fractals', file: '19-julia.html', video: 'asiFbvRKgRk', year: 2023, licence: 'MIT' });

const PHONE = isPhone();
const SCHEMA = SC.makeSchema(PHONE);
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
let glr = null; try { glr = createGL(glCanvas); } catch (e) { glr = null; }
let kit, cmMod = null, t = 0, saverView = null, veil = 0;
const GREY = (() => { const l = new Uint8Array(768); for (let i = 0; i < 256; i++) l[3 * i] = l[3 * i + 1] = l[3 * i + 2] = i; return l; })();
const lutOf = st => { if (!cmMod) return GREY; try { return cmMod.variant(st.cmap); } catch (e) { return GREY; } };

// ---- view ----------------------------------------------------------------------
let dpr = 1, cw = 1, ch = 1;
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  cw = Math.max(1, Math.round(innerWidth * dpr)); ch = Math.max(1, Math.round(innerHeight * dpr));
  canvas.width = cw; canvas.height = ch;
}
function viewRect() {
  if (saverView) return { x: saverView.x * dpr, y: saverView.y * dpr, w: saverView.w * dpr, h: saverView.h * dpr };
  return { x: 0, y: 0, w: cw, h: ch };   // the fractal fills the window; the panel floats over it
}

// ---- render ----------------------------------------------------------------------
const cpu = { cv: null, cx: null, img: null, key: '', k: 8, ms: 0 };
let lastPath = 'gl';
function render(rect) {
  const st = kit.state, s = st.res, rw = Math.max(16, Math.round(rect.w * s)), rh = Math.max(16, Math.round(rect.h * s));
  const V = SC.viewOf(st, t, rw, rh), lut = lutOf(st), P = SC.paintOf(st, lut, t);
  const prec = V.scale / Math.max(1, Math.abs(V.cx), Math.abs(V.cy));
  if (glr && prec > 1.2e-6) {
    if (glCanvas.width !== rw || glCanvas.height !== rh) { glCanvas.width = rw; glCanvas.height = rh; }
    glr.draw(V, P, lut); lastPath = 'gl';
    ctx.imageSmoothingEnabled = true; ctx.drawImage(glCanvas, rect.x, rect.y, rect.w, rect.h);
    return V;
  }
  // CPU: progressive refinement; a moving view stays coarse within a budget
  if (!cpu.cv || cpu.cv.width !== rw || cpu.cv.height !== rh) { cpu.cv = document.createElement('canvas'); cpu.cv.width = rw; cpu.cv.height = rh; cpu.cx = cpu.cv.getContext('2d'); cpu.img = cpu.cx.createImageData(rw, rh); cpu.key = ''; }
  const key = [V.cx, V.cy, V.scale, V.c[0], V.c[1], V.iters, V.power, st.color, st.cmap, st.density, P.offset.toFixed(3), st.mirror, st.inside].join('|');
  if (key !== cpu.key) { cpu.key = key; cpu.k = cpu.ms > 40 ? 8 : cpu.ms > 15 ? 4 : 2; if (lastPath !== 'cpu') cpu.k = 8; }
  else if (cpu.k > 1) cpu.k >>= 1;
  else { ctx.drawImage(cpu.cv, rect.x, rect.y, rect.w, rect.h); return V; }
  const t0 = performance.now();
  renderCPU(cpu.img.data, rw, rh, V, P, cpu.k);
  cpu.ms = (performance.now() - t0) * (cpu.k * cpu.k) / 4;
  cpu.cx.putImageData(cpu.img, 0, 0); lastPath = 'cpu';
  ctx.imageSmoothingEnabled = cpu.k <= 2; ctx.drawImage(cpu.cv, rect.x, rect.y, rect.w, rect.h);
  return V;
}
// The Mandelbrot map in a corner with c and its path: where the Julia set
// comes from (c inside M: a connected set; outside: dust).
const inset = { cv: null, key: '' };
function drawInset(V, rect) {
  const st = kit.state; if (!st.inset || V.mandel) return;
  const iw = Math.round(Math.min(220 * dpr, rect.w * 0.26)), ih = Math.round(iw * 0.75);
  const key = [iw, st.cmap, st.power, st.density, st.mirror].join('|');
  if (inset.key !== key) {
    inset.key = key; inset.cv = document.createElement('canvas'); inset.cv.width = iw; inset.cv.height = ih;
    const c2 = inset.cv.getContext('2d'), img = c2.createImageData(iw, ih), lut = lutOf(st);
    renderCPU(img.data, iw, ih, { cx: -0.6, cy: 0, scale: 2.6 / ih, mandel: true, c: [0, 0], iters: 80, power: st.power }, { color: 'smooth', lut, density: st.density, offset: 0, mirror: st.mirror, inside: [8, 10, 24] }, 1);
    c2.putImageData(img, 0, 0);
  }
  const x0 = rect.x + 16 * dpr, y0 = rect.y + rect.h - ih - (saverView ? 16 : 96) * dpr;
  ctx.save(); ctx.globalAlpha = 0.92; ctx.drawImage(inset.cv, x0, y0); ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, iw - 1, ih - 1);
  const toPx = (x, y) => [x0 + iw / 2 + (x + 0.6) / (2.6 / ih), y0 + ih / 2 - y / (2.6 / ih)];
  if (st.path !== 'still') {
    ctx.beginPath();
    for (let k = 0; k <= 120; k++) { const [x, y] = cAt(st.path, k / 120, { k: st.pathK }), [px, py] = toPx(x, y); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.stroke(); ctx.setLineDash([]);
  }
  const [px, py] = toPx(V.c[0], V.c[1]);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.arc(px, py, 4 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.font = `${Math.round(11 * dpr)}px Inter, system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`c = ${V.c[0].toFixed(4)} ${V.c[1] < 0 ? '−' : '+'} ${Math.abs(V.c[1]).toFixed(4)} i`, x0 + 6 * dpr, y0 + 14 * dpr);
  ctx.restore();
}

// ---- pointer: pan, zoom, and shift-drag for c (upstream) -----------------------------
function bindPointer() {
  const pts = new Map(); let last = null, pinch0 = 0, zoom0 = 0;
  const spanPx = () => Math.pow(10, kit.state.zoom) / (innerHeight);
  canvas.addEventListener('pointerdown', e => {
    if (kit.saver) return;
    canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    last = [e.clientX, e.clientY, e.shiftKey || kit.state.dragC];
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = kit.state.zoom; }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !last) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); kit.set('zoom', Math.max(-6, Math.min(0.7, zoom0 - Math.log10(Math.max(1, d) / Math.max(1, pinch0))))); return; }
    const dx = e.clientX - last[0], dy = e.clientY - last[1], s = spanPx();
    if (last[2]) {
      // upstream: juliaX += 0.1 dx scale, juliaY += 0.1 dy scale
      if (kit.state.path !== 'still') { const V = SC.viewOf(kit.state, t, 1, 1); kit.set('cRe', V.c[0]); kit.set('cIm', V.c[1]); kit.set('path', 'still'); }
      kit.set('cRe', kit.state.cRe + 0.1 * dx * s); kit.set('cIm', kit.state.cIm + 0.1 * dy * s);
    } else {
      if (kit.state.dive) kit.set('dive', false);
      kit.set('cx', kit.state.cx - dx * s); kit.set('cy', kit.state.cy + dy * s);
    }
    last[0] = e.clientX; last[1] = e.clientY;
  });
  const up = e => { pts.delete(e.pointerId); if (!pts.size) last = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); if (kit.saver) return;
    // zoom about the pointer
    const st = kit.state, s0 = spanPx(), dz = e.deltaY * 0.0012;
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left - innerWidth / 2, my = e.clientY - r.top - innerHeight / 2;
    const z = Math.max(-6, Math.min(0.7, st.zoom + dz)), s1 = Math.pow(10, z) / innerHeight;
    kit.set('cx', st.cx + mx * (s0 - s1)); kit.set('cy', st.cy - my * (s0 - s1)); kit.set('zoom', z);
  }, { passive: false });
}

// ---- loop -------------------------------------------------------------------------
let lastT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
  if (kit.playing) t += dt * kit.speed; else if (kit.takeStep()) t += 1 / 60;
  const st = kit.state, th = K.themeById(st.theme);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = th.bg; ctx.fillRect(0, 0, cw, ch);
  const rect = viewRect(), V = render(rect);
  drawInset(V, rect);
  veil = Math.max(0, veil - dt / 0.45);
  if (veil > 0) { ctx.globalAlpha = veil; ctx.fillStyle = th.bg; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1; }
}

kit = mount({
  schema: SCHEMA, title: 'Julia Fractals', sub: 'z ← z² + c: Julia and Mandelbrot sets with c on the move', panelTitle: 'Fractal',
  guard: SC.guard, randomStart: false, themeKey: 'theme',
  footer: 'Escape-time core, gradient and Mono view by Matthias Müller (Ten Minute Physics 19, MIT). Paths, colouring, dives and GUI: davesgames.io.',
  actions: {
    home() { const st = kit.state; kit.set('dive', false); kit.set('cx', st.mode === 'mandel' && st.power === 2 ? -0.6 : 0); kit.set('cy', 0); kit.set('zoom', 0.48); },
  },
});
kit.on('change', (out, st, why) => { if ('mode' in out || 'power' in out) cpu.key = ''; if (why === 'scene') { t = 0; veil = 1; } });
kit.on('scene', () => { t = 0; veil = 1; });
kit.on('reset', () => { t = 0; veil = 1; });
import('../ct-lab/colormaps/maps.js').then(m => { cmMod = m; inset.key = ''; }).catch(() => {});
addEventListener('resize', resize); resize();
if (!kit.fromHash) kit.newScene();
bindPointer();
requestAnimationFrame(frame);
addEventListener('pagehide', () => { kit.playing = false; if (glr) glr.destroy(); });

window.__julia = {
  get kit() { return kit; }, canvas, get t() { return t; }, set t(v) { t = v; }, get gl() { return !!glr; },
  setView(v) { saverView = v; inset.key = ''; },
};
installSaver(window.__julia);
