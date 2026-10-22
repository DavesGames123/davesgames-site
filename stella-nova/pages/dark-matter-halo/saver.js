// ============================================================================
//  DARK MATTER HALO  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides
//  the page, puts one full-window canvas on top and plays a seeded shuffle
//  of four shots (shots.js shotPlan): the shear test, the density slice,
//  the halo profiles and the rotation curve. Each shot lasts 5 to 12 s,
//  with a fade between shots. shots.js shotLayout frames the subject in
//  the clear band between the shell plate texts (lib/saver-clear.js
//  plateBand), for 16:9 and for the 9:16 column. The plate carries no code
//  extract. The page loop in main.js stops while window.__dmSaver is true.
//
//  grep -n targets
//    the model, once ....... "function prepare"
//    shot painters ......... "const PAINT"
//    frame loop ............ "function frame"
// ============================================================================
import * as M from './model.js';
import * as H from './halo.js';
import { EILERS19, JIAO23, ESTIMATES } from './data.js';
import { PAL, drawCurve, drawProfiles } from './draw-charts.js';
import { drawMeridional } from './draw-maps.js';
import { SHOTS, shotPlan, shotLayout, makeShear, stepShear } from './shots.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const FONT = (px, w = 400) => `${w} ${px}px Inter, system-ui, -apple-system, sans-serif`;

// The McMillan model on the page grids, computed once per load.
let P = null;
function prepare() {
  if (P) return P;
  const base = H.baseOnce(), halo = H.makeHalo('nfw', H.CONTROLS.rs.def, H.CONTROLS.local.def);
  const curve = H.curveFor(base, halo);
  const r = Float64Array.from({ length: 160 }, (_, i) => 0.1 * Math.pow(3000, i / 159));
  const profiles = H.FAMILIES.map(f => { const h = H.makeHalo(f, H.CONTROLS.rs.def, H.CONTROLS.local.def); return { family: f, name: H.FAMILY_NAME[f], rho: Float64Array.from(r, x => M.perPc3(M.haloDensity(h, x))) }; });
  const map = { nx: 150, nz: 94, Rmax: 30, zmax: 18.8 };
  map.gridB = H.densityGrid(H.BASE, 'baryons', map.nx, map.nz, map.Rmax, map.zmax);
  map.gridH = H.densityGrid(H.withHalo(halo), 'halo', map.nx, map.nz, map.Rmax, map.zmax);
  const band = ESTIMATES.localGeV.map(x => x.v / M.GEV_PER_MSUN_PC3);
  P = { curve, r, profiles, map, band };
  return P;
}

const fsFor = p => clamp(Math.round(Math.min(p.w, p.h) / 30), 11, 18);

// Each painter: (g, panels, k 0..1 through the shot, run state, calm).
const PAINT = {
  curve(g, [p], k) {
    const first = k < 0.5, kk = first ? smooth(k / 0.42) : 1;
    g.save(); g.translate(p.x, p.y);
    drawCurve(g, p.w, p.h, { curve: P.curve, eilers: EILERS19, jiao: JIAO23, xmax: 30, visibleOnly: first, parts: false, R0: H.BASE.R0, fs: fsFor(p), k: kk });
    g.restore();
  },
  profiles(g, [p], k) {
    g.save(); g.translate(p.x, p.y);
    drawProfiles(g, p.w, p.h, { profiles: P.profiles, r: P.r, selected: 'nfw', R0: H.BASE.R0, localBand: P.band, fs: fsFor(p), k: smooth(k / 0.75) });
    g.restore();
  },
  map(g, [p], k) {
    g.save(); g.translate(p.x, p.y);
    drawMeridional(g, p.w, p.h, { ...P.map, mode: k < 0.6 ? 'split' : 'share', R0: H.BASE.R0, fs: fsFor(p), zoom: 1 + 0.45 * smooth(k), colorbar: true });
    g.restore();
  },
  shear(g, panels, k, run, calm) {
    if (!run.shear) run.shear = makeShear(P.curve, 700, run.seed + 977 * run.i);
    const sim = run.shear, view = 32;
    const keys = ['visible', 'halo'], names = ['Visible matter only', 'With the dark halo'], cols = [PAL.baryons, PAL.halo];
    panels.forEach((p, i) => {
      const fs = fsFor(p), s = p.w / (2 * view), cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      g.save();
      g.beginPath(); g.rect(p.x, p.y, p.w, p.h); g.clip();
      g.fillStyle = '#070912'; g.fillRect(p.x, p.y, p.w, p.h);
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.setLineDash([2, 5]);
      for (const rr of [10, 20, 30]) { g.beginPath(); g.arc(cx, cy, rr * s, 0, Math.PI * 2); g.stroke(); }
      g.setLineDash([]);
      if (keys[i] === 'halo') {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, p.w * 0.7);
        gr.addColorStop(0, 'rgba(168,164,255,0.22)'); gr.addColorStop(1, 'rgba(168,164,255,0)');
        g.fillStyle = gr; g.fillRect(p.x, p.y, p.w, p.h);
      }
      g.globalCompositeOperation = 'lighter';
      const dot = Math.max(1.2, p.w / 260);
      for (const st of sim.sets[keys[i]].stars) {
        g.fillStyle = `rgba(255,${210 + 40 * st.m | 0},${170 + 60 * st.m | 0},${0.35 + 0.55 * st.m})`;
        g.fillRect(cx + st.x * s - dot / 2, cy - st.y * s - dot / 2, dot, dot);
      }
      g.globalCompositeOperation = 'source-over';
      g.font = FONT(fs, 500); g.fillStyle = cols[i]; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(names[i], p.x + 8, p.y + 8);
      g.font = FONT(fs); g.fillStyle = PAL.dim; g.textBaseline = 'bottom';
      g.fillText(`${sim.t.toFixed(0)} million years`, p.x + 8, p.y + p.h - 8);
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1; g.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    });
    void k; void calm;
  },
};

let run = null;
window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || 1;
    const plan = shotPlan(seed, 64, calm);
    prepare();
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__dmSaver = true;
    run = { plan, css, cv, raf: 0, i: 0, tau: 0, last: 0, plated: -1, subj: null, seed, shear: null, errs: 0, lastErr: '' };
    const g = cv.getContext('2d');
    // Shear speed: Myr per second of screen time (calm is slower).
    const myrPerSec = 70 - 30 * calm;
    const frame = now => {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      let shot = plan[run.i % plan.length];
      run.tau += dt;
      if (run.tau >= shot.sec) { run.tau = 0; run.i++; shot = plan[run.i % plan.length]; run.shear = null; }
      const k = run.tau / shot.sec;
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const L = shotLayout(shot.id, w, h, band ? { t: band.t, b: band.b } : { t: 0, b: 0 });
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
      try {
        if (shot.id === 'shear' && run.shear) stepShear(run.shear, dt * myrPerSec);
        PAINT[shot.id](g, L.panels, k, run, calm);
      } catch (e) { run.errs++; run.lastErr = String(e); /* a bad frame is skipped; debug() reports it */ }
      const f = smooth(Math.min(run.tau, shot.sec - run.tau) / (0.6 + 0.6 * calm));
      if (f < 1) { g.fillStyle = `rgba(5,7,12,${1 - f})`; g.fillRect(0, 0, w, h); }
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
    run.cv.remove(); run.css.remove();
    run = null; window.__dmSaver = false;
  },
};
// The shot on screen, for a probe: index, id, seconds into it, its length,
// and the count of frames that threw (with the last message).
window.snSaver.debug = () => run ? { i: run.i, id: run.plan[run.i % run.plan.length].id, tau: run.tau, sec: run.plan[run.i % run.plan.length].sec, errs: run.errs, lastErr: run.lastErr } : null;
// Force a shot by id, for a probe.
window.snSaver.cut = id => { if (!run) return; const j = run.plan.findIndex((s, n) => n > run.i && s.id === id); if (j > 0) { run.i = j; run.tau = 0; run.shear = null; } };
