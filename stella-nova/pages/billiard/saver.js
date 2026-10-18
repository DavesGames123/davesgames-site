// ============================================================================
//  POOL PHYSICS  ·  pages/billiard/saver.js — the screensaver
// ----------------------------------------------------------------------------
//  window.snSaver (the shell protocol, lib/screensaver.js): the computer
//  plays 8-ball and 9-ball on its own, calm, with the maths of each shot.
//  One canvas (#saverCanvas) holds the whole frame, so a recording keeps
//  both views: the 3D table image is copied in right after it renders.
//  Compositions, cut every 9-14 s in a seeded shuffle:
//    split    the 2D diagram and the 3D table side by side (16:9) or one
//             over the other (9:16)
//    table    the 3D table, the diagram small in a corner
//    diagram  the 2D diagram alone (turned up the screen in 9:16)
//  Every region sits in the clear band of the label plate (plateBand of
//  lib/saver-clear.js). The plate shows the current maths step as TeX and
//  the live numbers of the shot; no code.
//
//  grep -n targets: "export function regions", "const COMPS", "function
//  label", "export function installSaver"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

export const COMPS = ['split', 'table', 'diagram'];

// The rectangles of one composition in a W x H frame (CSS px) with the
// clear band { t, b, w } (or null: the whole frame).
export function regions(W, H, band, comp) {
  const cw = band ? Math.min(W, band.w) : W, x0 = (W - cw) / 2;
  const top = band ? band.t : 0, h = Math.max(40, H - top - (band ? band.b : 0));
  const box = { x: x0 + 8, y: top, w: cw - 16, h };
  const portrait = box.h > box.w * 1.1;
  if (comp === 'diagram') return { diagram: box, rot: portrait };
  if (comp === 'table') {
    const iw = Math.min(box.w * (box.w < 700 ? 0.55 : 0.3), 420), ih = iw * 0.55;
    return { three: box, diagram: { x: box.x + box.w - iw - 6, y: box.y + box.h - ih - 6, w: iw, h: ih }, rot: false, inset: true };
  }
  if (box.h > box.w * 0.75) {
    // a 9:16 column (or a near-square band in it): the diagram over the table
    const hh = box.h * 0.42;
    return { diagram: { x: box.x, y: box.y, w: box.w, h: hh }, three: { x: box.x, y: box.y + hh + 6, w: box.w, h: box.h - hh - 6 }, rot: false };
  }
  const half = (box.w - 8) / 2;
  return { diagram: { x: box.x, y: box.y, w: half, h: box.h }, three: { x: box.x + half + 8, y: box.y, w: half, h: box.h }, rot: false };
}

function shuffle(r, a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function rngOf(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function installSaver(P) {
  const APP = P.APP;
  let cv = null, ctx = null, opts = null, r = null, bag = [], cur = null, until = 0, hist = [], saved = null, clock = 0;
  const pick = () => {
    if (!bag.length) { bag = shuffle(r, COMPS); if (cur && bag[0] === cur.comp && bag.length > 1) bag.push(bag.shift()); }
    return bag.shift();
  };
  function cut(key) {
    const comp = key && COMPS.includes(key) ? key : pick();
    cur = { comp, t0: clock };
    until = clock + 9 + 5 * r();
    hist.push({ shot: comp, t: clock });
  }
  function label(step) {
    if (!opts || !opts.label) return;
    const G = APP.G, p = G.players[G.turn];
    const ct = APP.ct, plan = APP.plan || {};
    const params = [];
    if (ct) params.push({ sym: '\\theta', name: 'cut angle', value: `${(ct.theta * 180 / Math.PI).toFixed(1)}°`, cls: 'm5' });
    if (plan.v) params.push({ sym: 'v_0', name: 'cue ball speed', value: `${plan.v.toFixed(2)} m/s`, cls: 'm1' });
    if (ct) params.push({ sym: "v_O'", name: 'object ball', value: `${ct.vO.toFixed(2)} m/s`, cls: 'm2' });
    params.push({ sym: '\\mu_s', name: 'cloth', value: '0.20', cls: 'm6' });
    opts.label({
      title: 'Pool Physics',
      sub: `${G.type === '9' ? '9-ball' : '8-ball'} · ${p.name} · ${step ? step.title.toLowerCase() : 'thinking'}`,
      params,
      tex: step ? [step.tex] : [],
      eq: step ? [step.plain] : [],
      lines: [APP.msg || 'The computer plays itself: ghost ball, throw correction, position play'],
    });
  }
  const ctrl = {
    onStep(step) { label(step); },
    frame(dt) {
      clock += dt;
      if (clock >= until) cut();
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, cv.width, cv.height);
      const band = plateBand(H), rg = regions(W, H, band, cur.comp);
      const V = P.V;
      if (rg.three && V) {
        const st = P.scene3dState();
        V.setBalls(st.balls); V.setCue(st.cue); V.setOverlay(st.ov);
        V.resize(Math.round(rg.three.w), Math.round(rg.three.h), dpr);
        V.update(dt); V.render();
        try { ctx.drawImage(V.renderer.domElement, rg.three.x * dpr, rg.three.y * dpr, rg.three.w * dpr, rg.three.h * dpr); } catch (e) { /* no image in a test */ }
      }
      if (rg.diagram) {
        const d = rg.diagram, D = P.D;
        if (rg.inset) { ctx.fillStyle = 'rgba(5,8,10,0.82)'; ctx.fillRect(d.x * dpr, d.y * dpr, d.w * dpr, d.h * dpr); }
        D.layout(d.w * dpr, d.h * dpr, rg.rot, 6 * dpr, d.x * dpr, d.y * dpr);
        const F = P.frame2d(dpr);
        F.clear = !rg.inset; F.x0 = d.x * dpr; F.y0 = d.y * dpr;
        if (rg.inset) { F.items = F.items.filter(x => x.it.kind !== 'tip'); }
        ctx.save(); ctx.beginPath(); ctx.rect(d.x * dpr, d.y * dpr, d.w * dpr, d.h * dpr); ctx.clip();
        D.draw(ctx, F);
        ctx.restore();
      }
    },
    debug: () => ({ comp: cur && cur.comp, hist: hist.slice(), phase: APP.phase, shots: APP.G.shots }),
  };
  window.snSaver = {
    async enter(o = {}) {
      opts = o; r = rngOf((o.seed >>> 0) || 1); bag = []; hist = []; clock = 0;
      cv = document.getElementById('saverCanvas');
      ctx = cv.getContext('2d');
      cv.hidden = false;
      document.documentElement.classList.add('saver');
      saved = { mode: APP.mode, pace: APP.pace, skill: APP.skill, speed: APP.speed, paused: APP.paused, takeover: APP.takeover };
      APP.mode = 'ai-ai'; APP.takeover = false; APP.skill = 'perfect'; APP.speed = 1; APP.paused = false;
      APP.pace = 1 + 0.6 * (o.calm ?? 0.5);
      APP.saver = ctrl;
      if (P.V) P.V.camMode('auto');
      cut();
      P.startGame(((o.seed >>> 0) % 99991) + 1, r() < 0.3 ? '9' : '8');
      label(null);
      return { canvas: cv, warmupMs: 700 };
    },
    exit() {
      if (!APP.saver) return;
      APP.saver = null;
      document.documentElement.classList.remove('saver');
      if (cv) cv.hidden = true;
      if (saved) Object.assign(APP, saved);
      if (P.V) P.V.camMode(APP.cam);
      if (opts && opts.label) opts.label(null);
      P.layout();
    },
    cut(key) { if (APP.saver) cut(key); },
    debug: () => ctrl.debug(),
  };
  return window.snSaver;
}
