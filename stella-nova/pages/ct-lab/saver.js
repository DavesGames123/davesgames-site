// ============================================================================
//  CT LAB  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. main.js imports this module. The hook
//  plays a seeded reel of CT shots, cut every 6 to 12 s, with no kind twice
//  in a row (saver/plan.js). Shots (saver/shots.js):
//    engine 2D   sine trace, back-projection smear and ramp snap, Fourier
//                slice k-space, iterative convergence, 18 -> 720 views, dose
//    lab         gantry and sinogram in sync, artefact gallery with a window
//                sweep, walnut or suitcase reveal; these drive the lab page
//                through window.__ctlab (LAB-API.md) and draw its panels
//    3D          cone-beam scan and FDK, volume tour (view3d/README.md);
//                only with WebGPU. Each 3D shot makes its own GPUDevice and
//                destroys it when the shot ends.
//  The subject sits in the plate clear band (lib/saver-clear.js plateBand).
//  2D cameras are critically damped springs. Phones get smaller images,
//  fewer views and a 64^3 volume.
//
//  The returned canvas (#ctSaverCv) is in the document. 3D frames render to
//  #ctSaver3d under it and are copied into #ctSaverCv each frame, so a
//  canvas recording also holds them.
//
//  GREP MAP
//    grep -n 'function startShot'   shot life cycle (init, fade, dispose)
//    grep -n 'function frame'       per-frame loop, band, camera, plate
//    grep -n 'function make3D'      WebGPU device per 3D shot
//    grep -n 'snSaver.debug'        probe hooks (debug, cut)
// ============================================================================
import { makePlan, aimCam, stepCam, clamp } from './saver/plan.js';
import { makeShot } from './saver/shots.js';
import { plateBand } from '../../lib/saver-clear.js';

const FADE_IN = 0.6, FADE_OUT = 0.5;
const phone = () => (window.innerWidth || 1024) < 760 || ((window.matchMedia && matchMedia('(pointer: coarse)').matches) && Math.min(innerWidth, innerHeight) < 520);
const now = () => (globalThis.performance ? performance.now() : Date.now());

let run = null;

async function make3D(opts) {
  const { createView3D } = await import('./view3d/index.js');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no adapter');
  const device = await adapter.requestDevice();
  const cv = run && run.cv3;
  if (!cv) { device.destroy(); throw new Error('saver stopped'); }
  cv.hidden = false;
  let view;
  try { view = createView3D(cv, device, { ...opts, interactive: false, dpr: Math.min(2, devicePixelRatio || 1) }); } catch (e) { device.destroy(); throw e; }
  const r = run; r.live3d = (r.live3d || 0) + 1;
  let done = false;
  return {
    view,
    release() {
      if (done) return;
      done = true;
      try { view.destroy(); } catch (e) { /* gone */ }
      try { device.destroy(); } catch (e) { /* gone */ }
      r.live3d--;
      // a late release of a cut shot must not hide the canvas of the next 3D shot
      if (r.cv3 && r.live3d <= 0) r.cv3.hidden = true;
    },
  };
}

function startShot(force) {
  if (!run) return;
  const r = run, spec = r.plan.next(force);
  let shot;
  try { shot = makeShot(spec, r.env); } catch (e) { console.warn('ct saver: shot', e); return; }
  r.shot = shot; r.fade = 0; r.out = 0; r.camSet = false; r.shownTitle = null; r.plateAt = -1;
  r.history.push(spec.kind);
  Promise.resolve().then(() => shot.init()).catch((e) => {
    console.warn('ct saver: init', spec.kind, e);
    if (spec.fam === '3d') { r.env.make3D = null; r.plan.drop('3d'); }   // no WebGPU after all: drop 3D shots
    if (run === r && r.shot === shot) { try { shot.dispose(); } catch (e2) { /* ignore */ } r.shot = null; r.failed++; if (r.failed < 8) startShot(); }
  });
}

function endShot() {
  const r = run; if (!r || !r.shot) return;
  try { r.shot.dispose(); } catch (e) { /* ignore */ }
  r.shot = null;
}

function frame(ts) {
  if (!run) return;
  const r = run;
  r.raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, r.last ? (ts - r.last) / 1000 : 1 / 60); r.last = ts;
  const dpr = Math.min(phone() ? 1.75 : 2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  const cv = r.cv, g = r.g;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const pb = typeof r.o.label === 'function' ? plateBand(h) : null;
  const band = pb ? { t: pb.t, b: pb.b } : { t: Math.round(h * 0.06) + 24, b: Math.round(h * 0.06) + 24 };
  const side = Math.max(14, w * 0.04), stage = { x: side, y: band.t, w: w - 2 * side, h: Math.max(80, h - band.t - band.b) };
  const shot = r.shot;
  let live = !!(shot && shot.ready);
  if (live) {
    try { live = shot.tick(dt); } catch (e) { console.warn('ct saver: step', e); shot.t = shot.dur; }
  }
  if (live) {
    if (shot.t >= shot.dur) r.out += dt; else r.fade = Math.min(1, r.fade + dt / FADE_IN);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const is3D = live && shot.cam === null;
  if (is3D) {
    g.clearRect(0, 0, w, h);
    try { shot.render(dt, band, w, h); g.drawImage(r.cv3, 0, 0, w, h); } catch (e) { /* the 3D canvas shows under this one */ }
  } else {
    g.fillStyle = '#04060b'; g.fillRect(0, 0, w, h);
    const gl = g.createRadialGradient(w / 2, stage.y + stage.h / 2, 0, w / 2, stage.y + stage.h / 2, Math.max(w, h) * 0.6);
    gl.addColorStop(0, 'rgba(30,48,80,0.38)'); gl.addColorStop(1, 'rgba(4,6,11,0)');
    g.fillStyle = gl; g.fillRect(0, 0, w, h);
    if (live) {
      let f;
      try { f = shot.focus(stage); } catch (e) { f = { r: stage, z: 1 }; }
      const zmax = Math.max(1, (stage.h * 0.98) / Math.max(1, f.r.h)), z = clamp(f.z, 1, zmax);
      const fx = f.r.x + f.r.w / 2, fy = f.r.y + f.r.h / 2;
      const c = shot.cam;
      if (!r.camSet) { c.fx.x = c.fx.t = fx; c.fy.x = c.fy.t = fy; c.z.x = c.z.t = z; r.camSet = true; }
      aimCam(c, fx, fy, z); stepCam(c, dt);
      const cx = stage.x + stage.w / 2, cy = stage.y + stage.h / 2;
      g.save();
      g.translate(cx, cy); g.scale(c.z.x, c.z.x); g.translate(-c.fx.x, -c.fy.x);
      try { shot.draw(g, stage); } catch (e) { console.warn('ct saver: draw', e); shot.t = shot.dur; }
      g.restore();
      const s = shot.subject;
      r.anchor = s ? { x: cx + (s.x + s.w / 2 - c.fx.x) * c.z.x, y: cy + (s.y + s.h / 2 - c.fy.x) * c.z.x, w: s.w * c.z.x, h: s.h * c.z.x } : null;
    }
  }
  if (is3D && shot.subject) { const s = shot.subject; r.anchor = { x: s.x + s.w / 2, y: s.y + s.h / 2, w: s.w, h: s.h }; }
  // fades
  const a = !live ? 1 : r.out > 0 ? Math.min(1, r.out / FADE_OUT) : 1 - r.fade;
  if (a > 0) { g.fillStyle = `rgba(4,6,11,${a})`; g.fillRect(0, 0, w, h); }
  // plate: a new title fades in a new plate; the same title updates the values (4 Hz)
  if (live && typeof r.o.label === 'function' && r.out === 0 && (shot.t - r.plateAt > 0.25 || r.shownTitle === null)) {
    r.plateAt = shot.t;
    try {
      const p = shot.plate();
      r.shownTitle = p.title;
      r.o.label({ ...p, anchor: () => (run && run.anchor ? { ...run.anchor } : null) });
    } catch (e) { /* the plate is optional */ }
  }
  if (live && r.out >= FADE_OUT) { endShot(); startShot(); }
}

window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const lab = window.__ctlab || null;
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#ctSaverCv):not(#ctSaver3d){visibility:hidden!important}' +
      '#ctSaverCv,#ctSaver3d{position:fixed;inset:0;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}' +
      '#ctSaverCv{z-index:2147483647}#ctSaver3d{z-index:2147483646;background:#04060b}#ctSaver3d[hidden]{display:none!important}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'ctSaverCv';
    const cv3 = document.createElement('canvas'); cv3.id = 'ctSaver3d'; cv3.hidden = true;
    document.body.appendChild(cv3); document.body.appendChild(cv);
    const gpu = !!(globalThis.navigator && navigator.gpu);
    const calm = clamp(o.calm == null ? 0.6 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || ((Math.random() * 4294967296) >>> 0);
    const env = { phone: phone(), makeCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, lab, make3D: gpu ? make3D : null, now };
    const plan = makePlan(seed, { lab: !!lab, gpu, calm });
    run = { o, css, cv, cv3, g: cv.getContext('2d'), env, plan, shot: null, raf: 0, last: 0, fade: 0, out: 0, history: [], failed: 0, anchor: null, prevPreset: null };
    // the lab stops its own loop while the saver plays; lab shots drive it step by step
    if (lab) {
      try { run.prevPreset = lab.state().preset; lab.stop(); } catch (e) { /* not booted yet */ }
    }
    startShot();
    run.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 900 };
  },
  exit() {
    if (!run) return;
    const r = run;
    cancelAnimationFrame(r.raf);
    endShot();
    run = null;
    r.cv.remove(); r.cv3.remove(); r.css.remove();
    const lab = r.env.lab;
    if (lab) {
      try { lab.setChrome(true); lab.focusPanel(null); lab.load(r.prevPreset || 'shepp-logan'); } catch (e) { /* ignore */ }
    }
  },
};
// pagehide: the shell may drop this frame during a 3D shot. Release that
// shot's GPUDevice here. Do not reload a lab preset in a page that goes away.
window.addEventListener('pagehide', () => {
  if (!run) return;
  const r = run;
  cancelAnimationFrame(r.raf);
  endShot();
  run = null;
});
window.snSaver.debug = () => (run ? { kind: run.shot && run.shot.kind, t: run.shot && run.shot.t, dur: run.shot && run.shot.dur, ready: !!(run.shot && run.shot.ready), history: run.history.slice() } : null);
window.snSaver.cut = (kind) => { if (!run) return; endShot(); startShot(kind); };
