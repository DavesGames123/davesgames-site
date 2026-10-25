// ============================================================================
//  ALPHA QUDITS  ·  saver/index.js  ·  screensaver hook  (package SAVER)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). main.js imports
//  this module last. enter() hides the page, puts one full-window canvas
//  on top and plays a seeded shuffle of every package's saverShots
//  (saver/plan.js shotPlan): threads, gears, locks, records, the ruler and
//  the dials. Each shot lasts 5 to 12 s, with a fade between shots. The
//  subject sits in the clear band of the plate (plateBand from
//  lib/saver-clear.js) at 16:9 and in the 9:16 column.
//
//  HOW A SHOT DRAWS
//    strands, compare  renderShot(g, shot, t, box) into the saver canvas,
//                      scaled down when its text would leave the box
//                      (saver/probe.js)
//    ends, records     a fill figure (createEnds / createRecords with
//                      fill: true) in a hidden host the size of the box;
//                      play(t) draws it and the saver copies its canvas
//  A package that does not load is left out of the plan. A shot that the
//  frame can show only below MIN_SCALE of its size is skipped at the cut.
//
//  THE PLATE carries the shot TeX, live values from MODEL and a short
//  extract of model/*.js, cut from the real source at enter time.
//  window.__aqSaver is true while the saver runs, so main.js stops its
//  play(t) calls.
//
//  grep -n targets
//    load packages ........ "async function loadAll"
//    code extracts ........ "async function loadCode"
//    fill figures ......... "function figureDrawer"
//    fit scale, skip ...... "function scaleOf"   (plan.js pickLegible)
//    fitted renderShot .... "function renderDrawer"
//    frame loop ........... "function frame"
//    probes ............... "snSaver.debug"
// ============================================================================
import { PKGS, collectShots, shotPlan, frameBox, codeFor, extractCode, modelFacts, plateFor, pickLegible } from './plan.js';
import { fitScale } from './probe.js';
import { plateBand } from '../../../lib/saver-clear.js';

// Backgrounds per package: STRANDS board edge (paint.js THEMES.dark bg0),
// ENDS, RECORDS and COMPARE C.bg (their draw.js).
const BG = { strands: '#05070d', ends: '#070b0e', records: '#070b0e', compare: '#06080d' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

let loaded = null;
async function loadAll() {
  if (loaded) return loaded;
  const url = p => new URL(`../${p}/index.js`, import.meta.url).href;
  const got = await Promise.allSettled([...PKGS, 'model'].map(p => import(url(p))));
  const mods = {};
  [...PKGS, 'model'].forEach((p, i) => { if (got[i].status === 'fulfilled') mods[p] = got[i].value; });
  if (mods.compare && typeof mods.compare.prepare === 'function') { try { await mods.compare.prepare(); } catch (e) { /* the stub draws */ } }
  loaded = { mods, shots: collectShots(mods), facts: modelFacts(mods.model), code: {} };
  return loaded;
}

async function loadCode(L) {
  const want = new Map();
  for (const s of L.shots) { const c = codeFor(s); if (c) want.set(c.file + '#' + c.fn, c); }
  const files = new Map();
  await Promise.all([...new Set([...want.values()].map(c => c.file))].map(async f => {
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const tm = ctl ? setTimeout(() => ctl.abort(), 4000) : 0;
      const r = await fetch(new URL(`../model/${f}`, import.meta.url), ctl ? { signal: ctl.signal } : {});
      clearTimeout(tm);
      if (r.ok) files.set(f, await r.text());
    } catch (e) { /* the plate goes without code */ }
  }));
  for (const [k, c] of want) { const src = files.get(c.file); L.code[k] = src ? extractCode(src, c.fn) : null; }
}

// A fill figure of ENDS or RECORDS in a hidden host the size of the box.
function figureDrawer(create, shot, box) {
  const host = document.createElement('div');
  host.className = 'aqs-host';
  const place = b => { Object.assign(host.style, { left: b.x + 'px', top: b.y + 'px', width: Math.round(b.w) + 'px', height: Math.round(b.h) + 'px' }); };
  place(box);
  document.body.appendChild(host);
  const fig = create(host, { fill: true, scene: shot.scene, params: { ...shot.params }, autoplay: false, controls: false, notes: false, caption: false, reduced: false });
  let last = { ...box };
  return {
    draw(g, t, b) {
      if (Math.abs(b.w - last.w) > 1 || Math.abs(b.h - last.h) > 1 || b.x !== last.x || b.y !== last.y) { place(b); last = { ...b }; if (fig.resize) fig.resize(); }
      fig.play(t);
      const c = fig.canvas;
      const cw = parseFloat(c.style.width) || b.w, ch = parseFloat(c.style.height) || b.h;
      const k = Math.min(1, b.w / cw, b.h / ch);
      if (c.width && c.height) g.drawImage(c, b.x + (b.w - cw * k) / 2, b.y + (b.h - ch * k) / 2, cw * k, ch * k);
    },
    dispose() { try { fig.dispose(); } catch (e) { /* gone */ } host.remove(); },
  };
}

// The scale at which a shot's subject fits the box: ENDS fitLayout k,
// RECORDS fitScene s, and for STRANDS and COMPARE the probe scale
// (saver/probe.js fitScale). The probe draws a copy of the shot under
// another id, so COMPARE's state for the real shot does not see the probe
// times. Cached per shot and box size.
const scaleCache = new Map();
function scaleOf(L, shot, box, rate) {
  const key = `${shot.id}@${Math.round(box.w)}x${Math.round(box.h)}`;
  if (scaleCache.has(key)) return scaleCache.get(key);
  const m = L.mods[shot.pkg];
  let s = 1;
  try {
    if (shot.pkg === 'ends') s = m.fitLayout(m.SCENE_MODULES[shot.scene], box.w, box.h).k;
    else if (shot.pkg === 'records') s = m.fitScene(m.SCENE_MODULES[shot.scene], box.w, box.h).s;
    else {
      const probe = { ...shot, id: shot.id + '#probe' };
      s = fitScale((pg, tt, vb) => m.renderShot(pg, probe, tt, vb, { calm: false }), box, [0, 0.35, 0.7, 1].map(k => k * shot.sec * rate));
    }
  } catch (e) { s = 0; }
  if (scaleCache.size > 2000) scaleCache.clear();
  scaleCache.set(key, s);
  return s;
}

// A STRANDS or COMPARE shot: renderShot into a virtual box of (w/s, h/s),
// scaled by s (never above 1), so that all text stays in the box.
function renderDrawer(L, shot, rate) {
  const m = L.mods[shot.pkg];
  let s = 1;
  return {
    draw(g, t, b) {
      s = Math.min(1, scaleOf(L, shot, b, rate));
      g.translate(b.x, b.y); g.scale(s, s);
      m.renderShot(g, shot, t, { x: 0, y: 0, w: b.w / s, h: b.h / s }, { calm: false });
    },
    get scale() { return s; },
    dispose() {},
  };
}

function drawerFor(L, shot, box, rate) {
  const m = L.mods[shot.pkg];
  if (shot.pkg === 'ends') return figureDrawer(m.createEnds, shot, box);
  if (shot.pkg === 'records') return figureDrawer(m.createRecords, shot, box);
  return renderDrawer(L, shot, rate);
}

let run = null;
window.snSaver = {
  async enter(o = {}) {
    if (run) this.exit();
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || 1;
    const L = await loadAll();
    if (!L.shots.length) return null;
    await loadCode(L);
    const plan = shotPlan(L.shots, seed, 120, calm);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#aqSaverCv){visibility:hidden!important}' +
      '#aqSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none;background:#06080d}' +
      '.aqs-host{position:fixed;pointer-events:none;overflow:hidden}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'aqSaverCv';
    document.body.appendChild(cv);
    window.__aqSaver = true;
    const g = cv.getContext('2d');
    // The scene clock runs slower when calm (1 at calm 0, 0.6 at calm 1).
    const rate = 1 - 0.4 * calm;
    run = { plan, css, cv, raf: 0, i: 0, tau: 0, last: 0, plated: -1, box: null, drawer: null, errs: 0, lastErr: '', skipped: 0, L };
    const cut = () => {
      if (run.drawer) { run.drawer.dispose(); run.drawer = null; }
      run.tau = 0; run.plated = -1;
    };
    const frame = now => {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      let shot = plan[run.i % plan.length];
      run.tau += dt;
      if (run.tau >= shot.sec) { run.i++; cut(); shot = plan[run.i % plan.length]; }
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const box = frameBox(w, h, band);
      run.box = box;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = BG[shot.pkg] || '#06080d'; g.fillRect(0, 0, w, h);
      try {
        if (!run.drawer) {
          // skip shots that this frame cannot show at a legible size
          const j = pickLegible(plan, run.i, x => scaleOf(L, x, box, rate));
          if (j !== run.i) { run.skipped += j - run.i; run.i = j; run.plated = -1; shot = plan[run.i % plan.length]; }
          run.drawer = drawerFor(L, shot, box, rate);
        }
        g.save(); run.drawer.draw(g, run.tau * rate, box); g.restore();
      } catch (e) { run.errs++; run.lastErr = String(e && e.message || e); /* a bad frame is skipped; debug() reports it */ }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const f = smooth(Math.min(run.tau, shot.sec - run.tau) / (0.5 + 0.6 * calm));
      if (f < 1) { g.fillStyle = `rgba(4,5,8,${1 - f})`; g.fillRect(0, 0, w, h); }
      if (run.plated !== run.i && typeof o.label === 'function') {
        run.plated = run.i;
        const c = codeFor(shot);
        const info = plateFor(shot, { code: c ? L.code[c.file + '#' + c.fn] : null, facts: L.facts });
        info.anchor = () => run && run.box ? { x: run.box.x + run.box.w / 2, y: run.box.y + run.box.h / 2, w: run.box.w, h: run.box.h } : null;
        try { o.label(info); } catch (e) { /* the plate is optional */ }
      }
      run.raf = requestAnimationFrame(frame);
    };
    run.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 700 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    if (run.drawer) run.drawer.dispose();
    run.cv.remove(); run.css.remove();
    run = null; window.__aqSaver = false;
  },
};
// The shot on screen, for a probe: index, id, package, seconds into it, its
// length, and the count of frames that threw (with the last message).
window.snSaver.debug = () => {
  if (!run) return null;
  const s = run.plan[run.i % run.plan.length];
  return { i: run.i, id: s.id, pkg: s.pkg, tau: run.tau, sec: s.sec, errs: run.errs, lastErr: run.lastErr, box: run.box, scale: run.box ? scaleOf(run.L, s, run.box, 1) : null, skipped: run.skipped, shots: run.L.shots.length };
};
// Cut to the next shot with this id, for a probe.
window.snSaver.cut = id => {
  if (!run) return;
  const j = run.plan.findIndex((s, n) => n > run.i && s.id === id);
  if (j > 0) { if (run.drawer) { run.drawer.dispose(); run.drawer = null; } run.i = j; run.tau = 0; run.plated = -1; }
};
