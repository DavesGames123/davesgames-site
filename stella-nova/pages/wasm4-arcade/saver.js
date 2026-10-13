// ============================================================================
//  WASM-4 ARCADE  ·  saver.js — screensaver hook: the attract mode
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js and PAGES.md):
//    enter({ calm, seconds, caption, seed, label }) -> { canvas, warmupMs }
//    exit()
//  ROOM. When the page has its 3D room (window.__w4.room), enter() hides
//  the page UI and returns the room canvas. Each shot swaps the next cart
//  into the console physically (view3d.js swapTo), with the camera on the
//  desk or on the rack, then pushes in to the TV while the cart plays.
//  The camera director (roomCamera) varies per shot: the side it looks
//  from, a rack close-up while the cart flies, the push-in speed. The
//  scene is framed in the clear band of the plate (room.setInsets). On
//  exit the page cart goes back into the slot (window.__w4Resume).
//  FLAT. With no room, enter() puts one full-window canvas on top. A CRT
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
//                   "function cabinetBox"  "window.snSaver ="  "function roomCamera"
//                   "function enterRoom"  "function roomFrame"
// ============================================================================
import { Wasm4, memoryDisk } from './runtime/host.js';
import { createCRT } from './crt.js';
import { planReel, Autopilot, rng } from './attract.js';
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
  if (r.room) {
    // the cart flies into the console; the console boots when it seats
    const q = rng(shot.seed);
    r.cam = { side: q() < 0.5 ? -1 : 1, yaw: 0.18 + q() * 0.3, rack: q() < 0.4, push: 2 + q() * 2.5, drift: 0.04 + q() * 0.06, t: 0, seated: -1 };
    r.seated = false;
    r.room.swapTo(c.id, { onSeat: () => { if (run === r && my === r.token) { r.seated = true; r.cam.seated = r.cam.t; } } });
  }
  try {
    const bytes = await cartBytes(c);
    if (!run || my !== r.token) return;
    if (r.room) { while (run === r && my === r.token && !r.seated) await new Promise(res => setTimeout(res, 30)); }
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
        anchor: () => (!run ? null : run.anchor ? run.anchor() : { x: innerWidth / 2, y: run.box.y + run.box.h / 2, r: run.box.w * 0.45 }),
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
  if (r.room) { roomFrame(r, dt); return; }
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

// ------------------------------------------------------------------ room
// One frame of the room saver: the shot clock runs only while a cart plays.
function roomFrame(r, dt) {
  const s = dt / 1000;
  r.T += s; if (r.cam) r.cam.t += s;
  if (r.host) r.tau += s;
  r.stat = r.host ? Math.max(0, r.stat - dt / 500) : 1;
  if (r.host) {
    r.acc += dt;
    let n = 0;
    while (r.acc >= STEP && n++ < 3) { r.acc -= STEP; step(r.host, r.ap); }
    if (r.acc > STEP * 3) r.acc = 0;
    r.host.composite(r.rgba);
    r.room.setFrame(r.rgba, r.fx);
  }
  const left = r.shot.dur * r.slow - r.tau;
  const st = Math.max(r.stat, r.host && left < 0.35 ? 1 - left / 0.35 : 0);
  r.room.render({ time: r.T, fx: r.fx, stat: Math.min(1, st), power: Math.min(1, r.T / 0.6) });
  if (r.host && left <= 0) { r.i++; startShot(r.i); }
}

// The camera of one shot: while the cart flies, the desk from one side
// (or the rack up close); after it seats, a push-in to the TV with a slow
// sway. The shot clock is r.cam.t; V is THREE.Vector3.
function roomCamera(r, frameFor, V) {
  const Y = new V(0, 1, 0);
  return (dt, aspect) => {
    const c = r.cam || { side: 1, yaw: 0.2, rack: false, push: 3, drift: 0.05, t: 0, seated: -1 };
    const desk = frameFor('desk', aspect), tv = frameFor('tv', aspect);
    const turn = (f, yaw, zoom = 1) => {
      const off = f.pos.clone().sub(f.target).applyAxisAngle(Y, yaw).multiplyScalar(zoom);
      return { pos: off.add(f.target), target: f.target.clone() };
    };
    const sway = Math.sin(r.T * 0.23) * c.drift;
    const rack = () => { const tg = new V(36, 13, 14); return { pos: new V(-14 * c.side, 34, 92).applyAxisAngle(Y, sway).add(tg), target: tg }; };
    const a = c.rack ? rack() : turn(desk, c.side * c.yaw + sway, 1.02);
    if (c.seated < 0) return a;
    const u = Math.min(1, (c.t - c.seated) / c.push), e = u * u * (3 - 2 * u);
    const b = turn(tv, c.side * c.yaw * 0.35 + sway, 1.04);
    return { pos: a.pos.clone().lerp(b.pos, e), target: a.target.clone().lerp(b.target, e) };
  };
}

function enterRoom(o, room, seed, calm) {
  const css = document.createElement('style');
  css.textContent = 'html,body{overflow:hidden!important}body>*:not(#view){visibility:hidden!important}#view{cursor:none!important}';
  document.head.appendChild(css);
  window.__w4Saver = true;
  run = { o, css, cv: room.canvas, room, tube: room, carts: [], plan: [], i: 0, token: 0, T: 0, tau: 0, last: 0, raf: 0, stat: 1, acc: 0,
    rgba: new Uint8Array(160 * 160 * 4), fx: 0.9, slow: 1 + 0.25 * calm, box: { x: 0, y: 0, w: 1, h: 1 }, shot: { dur: 1e9 }, cam: null, seated: false };
  const r = run;
  room.setInsets(() => {
    const band = typeof o.label === 'function' ? plateBand(innerHeight) : null;
    return band ? { top: band.t, bottom: band.b, left: 0, right: 0 } : { top: 16, bottom: 16, left: 0, right: 0 };
  });
  const V = room.parts.tv.glass.position.constructor;
  r.anchor = () => {
    const g = room.parts.tv.glass.getWorldPosition(new V()).project(room.camera);
    const rc = room.canvas.getBoundingClientRect();
    return { x: rc.left + (g.x + 1) / 2 * rc.width, y: rc.top + (1 - g.y) / 2 * rc.height, r: rc.height * 0.2 };
  };
  (async () => {
    try {
      const { frameFor } = await import('./room.js');
      if (run !== r) return;
      room.setDirector(roomCamera(r, frameFor, V));
      const m = await (await fetch(new URL('./carts.json', import.meta.url))).json();
      if (run !== r) return;
      r.carts = m.carts.filter(c => room.carts.has(c.id)); r.plan = planReel(r.carts, seed, 40);
      startShot(0);
      r.raf = requestAnimationFrame(frame);
    } catch (e) { console.warn('wasm4-arcade saver', e); }
  })();
  return { canvas: room.canvas, warmupMs: 1600 };
}

window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const seed = (o.seed >>> 0) || ((Math.random() * 1e9) | 0);
    const page = window.__w4;
    if (page && page.room) return enterRoom(o, page.room, seed, o.calm == null ? 0.5 : Math.max(0, Math.min(1, o.calm)));
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
    if (run.room) {
      // the room stays: give the camera and the slot back to the page
      run.room.setDirector(null); run.room.setInsets(null);
    } else {
      if (run.tube) run.tube.destroy();
      run.cv.remove();
    }
    run.css.remove();
    if (typeof run.o.label === 'function') { try { run.o.label(null); } catch (e) { /* ok */ } }
    const room = run.room;
    run = null; window.__w4Saver = false;
    if (room && window.__w4Resume) window.__w4Resume();
  },
};
window.snSaver.debug = () => (run ? { cart: run.cart && run.cart.id, kind: run.shot.kind, tau: run.tau, dur: run.shot.dur, frame: run.host ? run.host.frame : null, tube: run.tube && run.tube.kind } : null);
window.snSaver.cut = () => { if (run && run.plan.length) { run.i++; startShot(run.i); } };
