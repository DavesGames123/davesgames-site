// ============================================================================
//  CT LAB 3D  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. main.js imports this module. The saver plays
//  a seeded reel of real objects (lib/saverplan.js): never the same kind of
//  shot, the same object or the same colour map twice in a row; a cut every
//  6 to 12 s; about 40 % of the shots cross-fade to a second colour map.
//  3D shots (WebGPU, one view3d and one GPUDevice for the whole run):
//    scan     the gantry spins, the detector fills, FDK builds the volume
//    reveal   the transfer function morphs from light parts to dense ones
//    planes   three slice planes sweep through the volume
//    cutaway  volume render with the near corner cut away, close orbit
//    mip      maximum intensity projection, turning
//  2D shots (Canvas 2D, also without WebGPU):
//    sweep2d  one slice view that sweeps through the object
//    triptych axial, coronal, sagittal and a MIP, with a linked sweep
//  The subject sits in the plate's clear band (lib/saver-clear.js plateBand):
//  the 3D camera shifts by an NDC offset, the 2D frame fits the band. The
//  plate names the object, its credit line and one equation (TeX, no code).
//  The returned canvas #c3SaverCv is in the document; 3D frames render into
//  #c3Saver3d and are copied into it, so a canvas recording holds them too.
//  Memory: a shot replaces the view's volume (view3d frees the old
//  textures); exit() and pagehide destroy the view and the device.
//
//  GREP MAP
//    grep -n 'function startShot'   shot set-up per kind
//    grep -n 'function tick3D'      3D shot animation per frame
//    grep -n 'function draw2D'      2D shots
//    grep -n 'function plate'       the plate text per shot
//    grep -n 'snSaver.debug'        probe hooks
// ============================================================================
import * as CM from '../ct-lab/colormaps/maps.js';
import { loadManifest, loadCodes, toVolume, presetsFor } from './lib/objects.js';
import { createSession, makeGeometry } from './lib/session.js';
import { sliceOf } from './lib/slices.js';
import { makePlan } from './lib/saverplan.js';
import { plateBand } from '../../lib/saver-clear.js';

const DATA = new URL('data/', import.meta.url);
const phone = () => (innerWidth || 1024) < 760 || ((matchMedia('(pointer: coarse)').matches) && Math.min(innerWidth, innerHeight) < 520);
const FADE = 0.6;
let run = null;

const TEX = {
  scan: ['p_\\theta(u,v) = \\int_L \\mu(\\mathbf{x})\\,d\\ell = -\\ln\\frac{I}{I_0}'],
  reveal: ['\\mathrm{HU} = 1000\\,\\frac{\\mu - \\mu_\\mathrm{water}}{\\mu_\\mathrm{water}}'],
  planes: ['f(\\mathbf{x}) = \\frac{1}{2}\\int_0^{2\\pi} \\frac{D^2}{(D - \\mathbf{x}\\cdot\\hat{\\mathbf{s}})^2}\\,(w\\,p_\\theta * h)\\,d\\theta'],
  cutaway: ['C(\\mathbf{r}) = \\sum_i c_i\\,\\alpha_i \\prod_{j<i}(1-\\alpha_j)'],
  mip: ['\\mathrm{MIP}(\\mathbf{r}) = \\max_{t}\\,\\mu(\\mathbf{o} + t\\,\\mathbf{d})'],
  sweep2d: ['I = I_0\\,e^{-\\int \\mu\\,d\\ell}'],
  triptych: ['x^{(k+1)} = x^{(k)} + C\\,A^{\\mathsf T} R\\,(b - A x^{(k)})'],
};
const KIND_NAME = { scan: 'Cone-beam scan', reveal: 'Transfer function', planes: 'Slice planes', cutaway: 'Volume render', mip: 'Maximum intensity', sweep2d: 'Slice sweep', triptych: 'Three planes' };

async function ensure3D(r) {
  if (r.view || !r.gpu) return r.view;
  const { createView3D } = await import('../ct-lab/view3d/index.js');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no adapter');
  const device = await adapter.requestDevice();
  if (run !== r) { device.destroy(); throw new Error('saver stopped'); }
  r.device = device;
  return null;   // the view is made with the first volume (startShot)
}

async function volumeOf(r, id) {
  const entry = r.objects.find((o) => o.id === id);
  let codes = r.codes.get(id);
  if (!codes) { codes = await loadCodes(entry, DATA); r.codes.set(id, codes); }
  return { entry, vol: toVolume(entry, codes, r.n) };
}

async function startShot(force) {
  const r = run; if (!r) return;
  const spec = r.plan.next(force);
  const shot = { ...spec, t: 0, ready: false, phase: 'scan' };
  r.shot = shot; r.out = 0; r.fade = 0; r.history.push(spec.kind); r.plateKey = null;
  try {
    const { entry, vol } = await volumeOf(r, spec.object);
    if (run !== r || r.shot !== shot) return;
    shot.entry = entry; shot.vol = vol; shot.presets = presetsFor(entry);
    if (!shot.presets[shot.preset]) shot.preset = 'everything';
    if (spec.kind === 'sweep2d' || spec.kind === 'triptych') { shot.ready = true; return; }
    if (!r.device) await ensure3D(r);
    if (run !== r || r.shot !== shot) return;
    const nViews = r.phoneMode ? 72 : 120;
    const geom = makeGeometry(vol, nViews, 1);
    const preset = shot.presets[shot.preset];
    if (!r.view) {
      const { createView3D } = await import('../ct-lab/view3d/index.js');
      r.cv3.hidden = false;
      r.view = createView3D(r.cv3, r.device, { volume: vol, preset, geom, nAngles: nViews, n: r.n, interactive: false, dprCap: r.phoneMode ? 1.25 : 2, steps: r.phoneMode ? 128 : 224, colormap: spec.map });
    } else {
      r.view.setPreset(preset); r.view.setVolume(vol, { geom, window: preset.window });
    }
    const v = r.view;
    v.setColormap(spec.map, { tf: spec.kind !== 'scan' });
    v.setCutaway(spec.kind === 'cutaway' || spec.kind === 'reveal');
    v.setMode(spec.kind === 'mip' ? 'mip' : spec.kind === 'planes' ? 'slices' : 'dvr');
    if (spec.kind === 'scan') {
      shot.session = createSession(entry, vol, { nViews, geom, out: v.projections, seed: spec.seed });
      v.setShow({ gantry: true, rays: true, table: true, detector: true, volume: 'phantom' });
      v.setCamera({ yaw: 0.6 + (spec.seed % 100) / 60, pitch: 0.3, dist: 9.8, autoRotate: 0.12 });
    } else {
      v.setShow({ gantry: false, rays: false, table: false, detector: false, volume: 'phantom' });
      v.setCamera({ yaw: (spec.seed % 628) / 100, pitch: 0.2 + (spec.seed % 7) / 25, dist: spec.kind === 'cutaway' ? 2.3 : 2.8, autoRotate: spec.kind === 'cutaway' ? 0.1 : 0.2 });
    }
    shot.ready = true;
  } catch (e) {
    console.warn('ct3d saver: shot', spec.kind, e);
    if (run === r && r.shot === shot) {
      if (spec.kind !== 'sweep2d' && spec.kind !== 'triptych') { r.gpu = false; r.plan = makePlan(spec.seed, r.objects.map((o) => o.id), { gpu: false }, (id) => Object.keys(presetsFor(r.objects.find((o) => o.id === id)))); }
      r.failed++; if (r.failed < 8) startShot();
    }
  }
}

// 3D animation per frame; returns false while the shot waits for the GPU
let reconBusy = false;
function tick3D(r, s, dt) {
  const v = r.view; if (!v) return;
  const u = Math.min(1, s.t / s.dur);
  if (s.kind === 'scan') {
    const ss = s.session;
    if (s.phase === 'scan') {
      const want = Math.min(ss.total, Math.ceil(ss.total * Math.min(1, s.t / (s.dur * 0.5))));
      const t0 = performance.now();
      while (ss.scanned < want && performance.now() - t0 < 10) ss.scan(1);
      v.setScanned(ss.scanned);
      if (ss.scanned >= ss.total) { s.phase = 'recon'; v.setShow({ rays: false, volume: 'auto' }); }
    } else if (s.phase === 'recon' && !reconBusy) {
      reconBusy = true;
      Promise.resolve(v.reconstructStep({ views: 10 })).then((q) => { if (q.done >= q.total && run && run.shot === s) { s.phase = 'look'; v.setShow({ gantry: false, detector: false, table: false }); v.setCamera({ dist: 3.0 }); } })
        .catch(() => { s.phase = 'look'; }).finally(() => { reconBusy = false; });
    }
  } else if (s.kind === 'reveal') {
    const keys = Object.keys(s.presets), P = s.presets;
    const f = u * (keys.length - 1), i = Math.min(keys.length - 2, Math.floor(f)), t = f - i;
    if (keys.length > 1) v.setPreset(mixPreset(P[keys[i]], P[keys[i + 1]], smooth(t)));
  } else if (s.kind === 'planes') {
    const w = 0.5 + 0.42 * Math.sin(u * Math.PI * 2);
    v.setSlices({ x: w, y: 0.5 + 0.38 * Math.cos(u * Math.PI * 1.4), z: 0.15 + 0.7 * u });
  }
  if (s.map2) {
    const a = smooth(Math.max(0, Math.min(1, (u - 0.45) / 0.25)));
    if (a > 0 && a < 1) v.setColormap(s.map, { lut: CM.blend(s.map, s.map2, a), tf: s.kind !== 'scan' });
    else if (a >= 1 && !s.fadeDone) { s.fadeDone = true; v.setColormap(s.map2, { tf: s.kind !== 'scan' }); }
  }
}
const smooth = (t) => t * t * (3 - 2 * t);
function mixPreset(a, b, t) {
  const m = (x, y) => x + (y - x) * t;
  return { window: [m(a.window[0], b.window[0]), m(a.window[1], b.window[1])], air: null, soft: [m(a.soft[0], b.soft[0]), m(a.soft[1], b.soft[1])], bone: m(a.bone, b.bone), skin: m(a.skin, b.skin), iso: m(a.iso, b.iso) };
}

// 2D shots: draw into the composite canvas inside the band
function draw2D(r, s, g, box) {
  const vol = s.vol, u = Math.min(1, s.t / s.dur), lo = 0, hi = s.presets.everything.window[1];
  const lut = s.map2 ? CM.blend(s.map, s.map2, smooth(Math.max(0, Math.min(1, (u - 0.45) / 0.25)))) : null;
  const img = (data, w, h) => { const c = r.scratch(w, h), cg = c.getContext('2d'), id = cg.createImageData(w, h); CM.apply(s.map, data, lo, hi, id.data, { lut, nan: [4, 6, 11, 255] }); cg.putImageData(id, 0, 0); return c; };
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (s.kind === 'sweep2d') {
    const view = ['axial', 'coronal', 'sagittal'][s.seed % 3], n = view === 'axial' ? vol.nz : view === 'coronal' ? vol.ny : vol.nx;
    const k = Math.round((0.12 + 0.76 * u) * (n - 1));
    const sl = sliceOf(vol, view, { ix: k, iy: k, iz: k });
    const side = Math.min(box.w, box.h) * 0.96, x = box.x + (box.w - side) / 2, y = box.y + (box.h - side) / 2;
    g.drawImage(img(sl.data, sl.w, sl.h), x, y, side, side);
    g.strokeStyle = 'rgba(124,196,255,0.25)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1);
    s.subject = { x, y, w: side, h: side }; s.sub = `${view} slice ${k + 1} of ${n}`;
  } else {
    const c = { ix: Math.round((0.5 + 0.3 * Math.sin(u * 5)) * (vol.nx - 1)), iy: Math.round((0.5 + 0.3 * Math.cos(u * 4)) * (vol.ny - 1)), iz: Math.round((0.15 + 0.7 * u) * (vol.nz - 1)) };
    const views = ['axial', 'coronal', 'sagittal'].map((v) => sliceOf(vol, v, c));
    // MIP along y
    const mip = new Float32Array(vol.nx * vol.nz);
    for (let z = 0; z < vol.nz; z++) for (let y = 0; y < vol.ny; y++) for (let x = 0; x < vol.nx; x++) { const val = vol.data[(z * vol.ny + y) * vol.nx + x], o = (vol.nz - 1 - z) * vol.nx + x; if (val > mip[o]) mip[o] = val; }
    views.push({ w: vol.nx, h: vol.nz, data: mip });
    const wide = box.w / box.h > 1.6, cols = wide ? 4 : 2, rows = wide ? 1 : 2, gap = 10;
    const side = Math.min((box.w - gap * (cols - 1)) / cols, (box.h - gap * (rows - 1)) / rows);
    const W = cols * side + gap * (cols - 1), H = rows * side + gap * (rows - 1), x0 = box.x + (box.w - W) / 2, y0 = box.y + (box.h - H) / 2;
    views.forEach((sl, i) => {
      const x = x0 + (i % cols) * (side + gap), y = y0 + Math.floor(i / cols) * (side + gap);
      g.drawImage(img(sl.data, sl.w, sl.h), x, y, side, side);
      g.strokeStyle = 'rgba(124,196,255,0.22)'; g.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1);
    });
    s.subject = { x: x0, y: y0, w: W, h: H }; s.sub = `slices through x ${c.ix}, y ${c.iy}, z ${c.iz} and a MIP`;
  }
}

function plate(s) {
  const e = s.entry, name = CM.has(s.map) ? CM.get(s.map).name : s.map;
  const mapLine = s.map2 && s.t / s.dur > 0.55 ? `${name} → ${CM.get(s.map2).name}` : name;
  const phase = s.kind === 'scan' ? (s.phase === 'scan' ? `view ${s.session.scanned} of ${s.session.total}` : s.phase === 'recon' ? 'FDK back-projection' : 'reconstruction') : (s.sub || KIND_NAME[s.kind]);
  return {
    title: e.name,
    sub: `${KIND_NAME[s.kind]} · ${e.kind === 'volume' ? 'real CT scan' : 'open 3D model, voxelized'}`,
    tex: TEX[s.kind],
    lines: [phase, `Colour map: ${mapLine}`, `${e.credit.licence} · ${e.credit.author.split(',')[0].slice(0, 90)}`],
  };
}

function frame(ts) {
  if (!run) return;
  const r = run;
  r.raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, r.last ? (ts - r.last) / 1000 : 1 / 60); r.last = ts;
  const w = innerWidth, h = innerHeight, dpr = Math.min(r.phoneMode ? 1.75 : 2, devicePixelRatio || 1);
  const cv = r.cv, g = r.g;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const pb = typeof r.o.label === 'function' ? plateBand(h) : null;
  const band = pb ? { t: pb.t, b: pb.b } : { t: Math.round(h * 0.07) + 20, b: Math.round(h * 0.07) + 20 };
  const box = { x: Math.max(14, w * 0.04), y: band.t, w: w - 2 * Math.max(14, w * 0.04), h: Math.max(80, h - band.t - band.b) };
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = r.shot, live = !!(s && s.ready);
  if (live) {
    s.t += dt;
    if (s.t >= s.dur) r.out += dt; else r.fade = Math.min(1, r.fade + dt / FADE);
  }
  const is3D = live && s.kind !== 'sweep2d' && s.kind !== 'triptych';
  if (is3D && r.view) {
    // centre the subject in the band: shift the image by an NDC offset
    const cy = (band.t + h - band.b) / 2, k = Math.min(1, box.h / h * 1.15);
    r.view.setCamera({ offset: [0, -(cy - h / 2) / (h / 2)], fov: 0.62 / Math.max(0.55, k) });
    try { tick3D(r, s, dt); r.view.render({ dt }); } catch (e) { s.t = s.dur; }
    g.clearRect(0, 0, w, h);
    g.drawImage(r.cv3, 0, 0, w, h);
    s.subject = { x: w * 0.3, y: band.t + box.h * 0.2, w: w * 0.4, h: box.h * 0.6 };
  } else {
    g.fillStyle = '#04060b'; g.fillRect(0, 0, w, h);
    if (live) { try { draw2D(r, s, g, box); } catch (e) { console.warn('ct3d saver: 2D', e); s.t = s.dur; } }
  }
  const a = !live ? 1 : r.out > 0 ? Math.min(1, r.out / 0.5) : 1 - r.fade;
  if (a > 0) { g.fillStyle = `rgba(4,6,11,${a})`; g.fillRect(0, 0, w, h); }
  if (live && typeof r.o.label === 'function' && r.out === 0) {
    const p = plate(s), key = p.title + '|' + p.lines.join('|');
    if (key !== r.plateKey && (ts - (r.plateAt || 0) > 250 || !r.plateKey)) {
      r.plateKey = key; r.plateAt = ts;
      try { r.o.label({ ...p, anchor: () => (run && run.shot && run.shot.subject ? { ...run.shot.subject } : null) }); } catch (e) { /* optional */ }
    }
  }
  if (live && r.out >= 0.5) { r.shot = null; startShot(); }
}

window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const page = window.__ct3d;
    if (page) page.pause(true);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#c3SaverCv):not(#c3Saver3d){visibility:hidden!important}' +
      '#c3SaverCv,#c3Saver3d{position:fixed;inset:0;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}' +
      '#c3SaverCv{z-index:2147483647}#c3Saver3d{z-index:2147483646;background:#04060b}#c3Saver3d[hidden]{display:none!important}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'c3SaverCv';
    const cv3 = document.createElement('canvas'); cv3.id = 'c3Saver3d'; cv3.hidden = true;
    document.body.appendChild(cv3); document.body.appendChild(cv);
    const seed = (o.seed >>> 0) || ((Math.random() * 4294967296) >>> 0);
    const scratch = new Map();
    run = {
      o, css, cv, cv3, g: cv.getContext('2d'), gpu: !!navigator.gpu, phoneMode: phone(), n: phone() ? 64 : 96,
      objects: [], codes: new Map(), plan: null, shot: null, view: null, device: null, raf: 0, last: 0, out: 0, fade: 0, history: [], failed: 0,
      scratch: (w, h) => { const k = w + 'x' + h; let c = scratch.get(k); if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; scratch.set(k, c); } return c; },
    };
    const r = run;
    loadManifest(DATA).then((objs) => {
      if (run !== r) return;
      r.objects = objs;
      r.plan = makePlan(seed, objs.map((x) => x.id), { gpu: r.gpu }, (id) => Object.keys(presetsFor(objs.find((x) => x.id === id))));
      startShot();
    }).catch((e) => console.warn('ct3d saver: manifest', e));
    r.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 1200 };
  },
  exit() {
    if (!run) return;
    const r = run; run = null;
    cancelAnimationFrame(r.raf);
    try { r.view && r.view.destroy(); } catch (e) { /* gone */ }
    try { r.device && r.device.destroy(); } catch (e) { /* gone */ }
    r.cv.remove(); r.cv3.remove(); r.css.remove();
    const page = window.__ct3d; if (page) page.pause(false);
  },
};
addEventListener('pagehide', () => { if (run) window.snSaver.exit(); });
window.snSaver.debug = () => (run ? { kind: run.shot && run.shot.kind, object: run.shot && run.shot.object, t: run.shot && run.shot.t, ready: !!(run.shot && run.shot.ready), history: run.history.slice(), gpu: run.gpu } : null);
window.snSaver.cut = (kind) => { if (!run) return; run.shot = null; startShot(kind); };
