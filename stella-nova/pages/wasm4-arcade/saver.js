// ============================================================================
//  WASM-4 ARCADE  ·  saver.js — screensaver hook: the attract mode
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js and PAGES.md):
//    enter({ calm, seconds, caption, seed, label }) -> { canvas, warmupMs }
//    exit()
//  enter() hides the page and puts one full-window canvas on top. A CRT
//  cabinet (crt.js, WebGPU or the 2D tube) sits in the clear band of the
//  label plate (plateBand of lib/saver-clear.js). The tube plays a seeded
//  reel from attract.js: every cart before one comes back, 6 to 12 s each,
//  a title screen or a scripted game (Autopilot), with channel-change
//  static between carts. Each shot gets a fresh silent console (no APU)
//  and a memory disk, so the saver plays no sound and writes no save. The
//  plate names the cart, its author and licence, and the console. It
//  carries no code. The page loop in main.js stops while window.__w4Saver
//  is true.
//
//  grep -n targets  "async function startShot"  "function frame"
//                   "function cabinetBox"  "window.snSaver ="
// ============================================================================
import { Wasm4, memoryDisk } from './runtime/host.js';
import { createCRT } from './crt.js';
import { planReel, Autopilot } from './attract.js';
import { plateBand } from '../../lib/saver-clear.js';

let run = null;
const STEP = 1000 / 60;
const bytesCache = new Map();

async function cartBytes(c) {
  if (bytesCache.has(c.id)) return bytesCache.get(c.id);
  const b = new Uint8Array(await (await fetch(new URL(c.file, import.meta.url))).arrayBuffer());
  bytesCache.set(c.id, b);
  return b;
}

// The cabinet: a square in the clear band of the plate, centred.
function cabinetBox(w, h) {
  const band = run && typeof run.o.label === 'function' ? plateBand(h) : null;
  const t = band ? band.t : 16, b = band ? band.b : 16;
  const s = Math.max(120, Math.min(w - 24, h - t - b));
  return { x: (w - s) / 2, y: t + (h - t - b - s) / 2, w: s, h: s };
}

async function startShot(i) {
  const r = run, shot = r.plan[i % r.plan.length], c = r.carts.find(x => x.id === shot.id);
  const my = ++r.token;
  r.shot = shot; r.cart = c; r.tau = 0; r.stat = 1; r.host = null; r.acc = 0;
  try {
    const bytes = await cartBytes(c);
    if (!run || my !== r.token) return;
    const h = new Wasm4({ disk: memoryDisk() });
    await h.load(bytes);
    const ap = new Autopilot(shot.seed, shot.kind, shot.input);
    // Run past the splash with no picture (bounded, so a slow cart cannot stall).
    const t0 = performance.now();
    while (h.frame < shot.skip && !h.crashed && performance.now() - t0 < 120) step(h, ap);
    if (!run || my !== r.token) return;
    r.host = h; r.ap = ap;
  } catch (e) { /* static stays up until the next cut */ }
  if (typeof r.o.label === 'function') {
    const kb = (c.bytes / 1024).toFixed(c.bytes < 10240 ? 1 : 0);
    try {
      r.o.label({
        title: c.title,
        sub: `by ${c.author} · ${c.licence} · a WASM-4 cart`,
        params: [
          { name: 'console', value: 'WASM-4, 160 × 160, 4 colours, 60 Hz' },
          { name: 'cart', value: `${kb} KB of WebAssembly` },
          { name: 'input', value: shot.kind === 'title' ? 'none: the title screen' : 'attract-mode autopilot' },
        ],
        lines: [`${c.repo.replace('https://', '')} · ${c.licence}`, 'WASM-4 fantasy console by Bruno Garcia (ISC) · CRT shader our own'],
        anchor: () => (run ? { x: innerWidth / 2, y: run.box.y + run.box.h / 2, r: run.box.w * 0.45 } : null),
      });
    } catch (e) { /* the plate is optional */ }
  }
}

function step(h, ap) {
  const o = ap.step(h.frame);
  h.setGamepad(0, o.pad); h.setMouse(o.mx, o.my, o.mb);
  h.update();
}

function frame(now) {
  const r = run; if (!r) return;
  r.raf = requestAnimationFrame(frame);
  const dt = Math.min(100, r.last ? now - r.last : 16); r.last = now;
  r.tau += dt / 1000; r.T += dt / 1000;
  r.stat = Math.max(r.host ? 0 : 0.85, r.stat - dt / 500);
  const w = innerWidth, hh = innerHeight;
  r.box = cabinetBox(w, hh);
  if (r.host) {
    r.acc += dt;
    let n = 0;
    while (r.acc >= STEP && n++ < 3) { r.acc -= STEP; step(r.host, r.ap); }
    if (r.acc > STEP * 3) r.acc = 0;
    r.host.composite(r.rgba);
    r.tube.setFrame(r.rgba, r.fx);
  }
  // static rises in the last 0.35 s of a shot: the channel change
  const left = r.shot.dur * r.slow - r.tau;
  const st = Math.max(r.stat, left < 0.35 ? 1 - left / 0.35 : 0);
  r.tube.render({ time: r.T, fx: r.fx, stat: Math.min(1, st), power: Math.min(1, r.T / 0.6), box: r.box });
  if (left <= 0) { r.i++; startShot(r.i); }
}

window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const seed = (o.seed >>> 0) || ((Math.random() * 1e9) | 0);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important;background:#05070a!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none;background:#05070a}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__w4Saver = true;
    const calm = o.calm == null ? 0.5 : Math.max(0, Math.min(1, o.calm));
    run = { o, css, cv, tube: null, carts: [], plan: [], i: 0, token: 0, T: 0, tau: 0, last: 0, raf: 0, stat: 1, acc: 0,
      rgba: new Uint8Array(160 * 160 * 4), fx: 0.9, slow: 1 + 0.25 * calm, box: { x: 0, y: 0, w: 1, h: 1 }, shot: { dur: 1e9 } };
    const r = run;
    (async () => {
      try {
        const m = await (await fetch(new URL('./carts.json', import.meta.url))).json();
        r.carts = m.carts; r.plan = planReel(r.carts, seed, 40);
        r.tube = await createCRT(cv);
        if (run !== r) { r.tube.destroy(); return; }
        if (r.tube.canvas !== cv) { r.cv = r.tube.canvas; r.cv.id = 'snSaverCv'; }
        startShot(0);
        r.raf = requestAnimationFrame(frame);
      } catch (e) { console.warn('wasm4-arcade saver', e); }
    })();
    return { canvas: cv, warmupMs: 1200 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    if (run.tube) run.tube.destroy();
    run.cv.remove(); run.css.remove();
    if (typeof run.o.label === 'function') { try { run.o.label(null); } catch (e) { /* ok */ } }
    run = null; window.__w4Saver = false;
  },
};
window.snSaver.debug = () => (run ? { cart: run.cart && run.cart.id, kind: run.shot.kind, tau: run.tau, dur: run.shot.dur, frame: run.host ? run.host.frame : null, tube: run.tube && run.tube.kind } : null);
window.snSaver.cut = () => { if (run && run.plan.length) { run.i++; startShot(run.i); } };
