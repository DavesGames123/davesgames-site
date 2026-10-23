// ============================================================================
//  OCTANE NUMBER  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides
//  the page, puts one full-window canvas on top and plays a seeded shuffle
//  of four shots (shots.js shotPlan): knock in the cylinder, the two
//  reference molecules in 3D, the octane ladder and the reaction chain.
//  Shots last 7 to 14 s with a fade between them. shots.js shotLayout
//  frames the subject in the clear band of the shell plate
//  (lib/saver-clear.js plateBand), for 16:9 and for the 9:16 column.
//
//  The pair shot renders two Molecule Explorer views (molecules/view3d.js)
//  on canvases that stay in the document (hidden under the saver canvas)
//  and copies each frame into the saver canvas right after it renders.
//  The page loop in main.js stops while window.__onSaver is true.
//
//  grep -n targets
//    shot painters ......... "const PAINT"
//    3D views .............. "function pairViews"
//    frame loop ............ "function frame"
// ============================================================================
import * as K from './knock.js';
import { FUELS, ISOMERS_C8 } from './data.js';
import { PAL, FONT, drawCylinder, drawPressure, drawLadder, drawMech, MECH_STEPS } from './draw.js';
import { SHOTS, KNOCK_CASES, shotPlan, shotLayout } from './shots.js';
import { plateBand } from '../../lib/saver-clear.js';
import { decode } from '../molecules/chem.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const fsFor = p => clamp(Math.round(Math.min(p.w, p.h) / 30), 11, 18);

const cycles = new Map();
const cycleFor = i => { if (!cycles.has(i)) cycles.set(i, K.cycle(KNOCK_CASES[i])); return cycles.get(i); };

// Two View3D canvases for the pair shot, made once per saver run.
async function pairViews(run) {
  if (run.pair) return run.pair;
  run.pair = 'loading';
  try {
    const [{ View3D }, dl, res] = await Promise.all([import('../molecules/view3d.js'), import('../molecules/drawlift.js'), fetch(new URL('data/fuels.json', import.meta.url))]);
    const recs = (await res.json()).m;
    if (!run.live) return null;
    const vs = ['heptane', 'isooctane'].map(id => {
      const cv = document.createElement('canvas'); cv.className = 'snSaver3d';
      cv.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:400px;z-index:2147483646';
      document.body.appendChild(cv);
      const v = new View3D(cv, { interactive: false });
      v.setModel(decode(recs.find(r => r.id === id))); v.setStyle('ball');
      return v;
    });
    run.pair = { vs, dl };
  } catch (e) { run.pair = null; run.errs++; run.lastErr = String(e); }
  return run.pair;
}

const PAINT = {
  knock(g, [pa, pb], k, run, shot) {
    const c = cycleFor(shot.kcase), th = -60 + 150 * smooth(clamp(k / 0.85, 0, 1));
    g.save(); g.translate(pa.x, pa.y);
    drawCylinder(g, pa.w, pa.h, { c, th, E: K.ENGINE, drop: t => K.pistonDrop(t), fs: fsFor(pa) });
    g.restore();
    g.save(); g.translate(pb.x, pb.y);
    g.fillStyle = PAL.bg; g.fillRect(0, 0, pb.w, pb.h);
    drawPressure(g, pb.w, pb.h, { c, th, pressureAt: K.pressureAt, fs: fsFor(pb), k: (th + 60) / 150 });
    const o = KNOCK_CASES[shot.kcase];
    g.font = FONT(fsFor(pb)); g.fillStyle = PAL.ink2; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(`octane ${o.on} · ${o.cr}:1 · spark ${o.spark}° · ${o.boost.toFixed(1)} bar · ${o.rpm} rpm`, 52, 14);
    g.restore();
  },
  pair(g, panels, k, run) {
    const P = run.pair;
    if (!P || P === 'loading') { pairViews(run); return; }
    if (run.pairShot !== run.i) {
      run.pairShot = run.i; run.pairT0 = run.tau;
      P.vs.forEach(v => { v.setSpin(false); v.setReveal(0); v.setInk(1); v.setMorph(0); });
    }
    const D = P.dl.timingFor(Math.max(4, (run.shotSec || 9) - 1));
    panels.forEach((p, i) => {
      const v = P.vs[i], cv = v.canvas;
      if (cv.style.width !== `${Math.round(p.w)}px` || cv.style.height !== `${Math.round(p.h)}px`) { cv.style.width = `${Math.round(p.w)}px`; cv.style.height = `${Math.round(p.h)}px`; }
      const st = P.dl.drawLiftAt(run.tau - run.pairT0 - i * 0.4, v.M.nShown, D);
      v.setReveal(st.done ? null : st.reveal); v.setInk(st.ink); v.setMorph(st.morph);
      if (st.done && !v.controls.autoRotate) v.setSpin(true);
      v.dirty = true; v.frame(1 / 60);
      g.drawImage(cv, p.x, p.y, p.w, p.h);
      const fs = fsFor(p);
      g.font = FONT(fs * 2.6); g.fillStyle = i ? PAL.iso : PAL.hep; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(i ? '100' : '0', p.x + 10, p.y + 8);
      g.font = FONT(fs, 500); g.fillStyle = PAL.ink; g.fillText(i ? 'iso-octane' : 'n-heptane', p.x + 12, p.y + 14 + fs * 2.6);
    });
    void k;
  },
  ladder(g, [p], k) {
    g.save(); g.translate(p.x, p.y);
    drawLadder(g, p.w, p.h, { fuels: FUELS, sel: null, hover: null, c8: k > 0.55 ? ISOMERS_C8 : [], fs: fsFor(p) - 1, k: smooth(k / 0.5) });
    g.restore();
  },
  chain(g, [p], k) {
    const n = MECH_STEPS.length, x = k * n, step = Math.min(n - 1, Math.floor(x));
    g.save(); g.translate(p.x, p.y);
    drawMech(g, p.w, p.h, { step, k: smooth((x - step) / 0.7), fs: fsFor(p) });
    g.font = FONT(fsFor(p), 500); g.fillStyle = PAL.ink2; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText(`${step + 1}. ${MECH_STEPS[step].name}`, p.w / 2, p.h - 4);
    g.restore();
  },
};

let run = null;
window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || 1;
    const plan = shotPlan(seed, 64, calm);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__onSaver = true;
    run = { plan, css, cv, raf: 0, i: 0, tau: 0, last: 0, plated: -1, subj: null, seed, errs: 0, lastErr: '', live: true, pair: null };
    if (plan.some(s => s.id === 'pair')) pairViews(run);
    const g = cv.getContext('2d');
    const frame = now => {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      let shot = plan[run.i % plan.length];
      run.tau += dt;
      if (run.tau >= shot.sec) { run.tau = 0; run.i++; shot = plan[run.i % plan.length]; }
      run.shotSec = shot.sec;
      const k = run.tau / shot.sec;
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const L = shotLayout(shot.id, w, h, band ? { t: band.t, b: band.b } : { t: 0, b: 0 });
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
      try { PAINT[shot.id](g, L.panels, k, run, shot); } catch (e) { run.errs++; run.lastErr = String(e); }
      const f = smooth(Math.min(run.tau, shot.sec - run.tau) / (0.6 + 0.6 * calm));
      if (f < 1) { g.fillStyle = `rgba(5,7,13,${1 - f})`; g.fillRect(0, 0, w, h); }
      run.subj = L.subject;
      if (run.plated !== run.i && typeof o.label === 'function') {
        run.plated = run.i;
        try { o.label(Object.assign({}, SHOTS[shot.id], { anchor: () => run && run.subj ? { ...run.subj } : null })); } catch (e) { /* the plate is optional */ }
      }
      run.raf = requestAnimationFrame(frame);
    };
    run.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 700 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    run.live = false;
    if (run.pair && run.pair.vs) run.pair.vs.forEach(v => { try { v.dispose(); } catch (e) { /* already gone */ } v.canvas.remove(); });
    run.cv.remove(); run.css.remove();
    run = null; window.__onSaver = false;
  },
};
// The shot on screen, for a probe.
window.snSaver.debug = () => run ? { i: run.i, id: run.plan[run.i % run.plan.length].id, tau: run.tau, errs: run.errs, lastErr: run.lastErr } : null;
window.snSaver.cut = id => { if (!run) return; const j = run.plan.findIndex((s, n) => n > run.i && s.id === id); if (j > 0) { run.i = j; run.tau = 0; } };
