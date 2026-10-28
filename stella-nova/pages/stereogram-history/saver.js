// ============================================================================
//  STEREOGRAM HISTORY  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides
//  the page, puts one full-window canvas on top and plays a seeded plan
//  of shots (shots.js shotPlan) over the figures of the page: turning
//  stereograms of real objects, a depth-map wipe, the Julesz pair, the
//  top view of the eyes, the stereoscope, the row build and the
//  wallpaper. Each shot lasts 5 to 12 s, with a fade between shots.
//  shots.js shotRect puts the subject in the clear band between the shell
//  plate texts (lib/saver-clear.js plateBand), for 16:9 and for the 9:16
//  column. The plate carries no code. The page loop in main.js stops
//  while window.__sgSaver is true.
//
//  The images of a shot come from worker jobs (client.js). The saver asks
//  for the next shot while the current one plays; a shot whose images
//  are not ready yet shows the eyes figure, which needs none. S.data keeps
//  the images of the shots S.i - 1 to S.i + 1 only: each shot change
//  (and cut) deletes the keys below S.i - 1 (prune), and a job that ends
//  after its shot went keeps its images out of S.data.
//
//  grep -n targets
//    images for a shot ..... "async function prepare"
//    shot painters ......... "const PAINT"
//    frame loop ............ "function frame"
// ============================================================================
import { run as job } from './client.js';
import * as D from './draw.js';
import * as G from './geometry.js';
import { SHOTS, shotPlan, shotRect, fitRect } from './shots.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const BG = '#05070c';

// An engine Image as a canvas, for scaled drawImage.
function canvasOf(img) {
  const c = document.createElement('canvas');
  D.putImage(c, img);
  return c;
}

let cat = null;
async function catalog() {
  if (!cat) cat = await job('catalog').catch(() => ({ models: [], tiles: [] }));
  return cat;
}
function specFor(i, w, h) {
  const m = cat && cat.models.length ? cat.models[i % cat.models.length] : null;
  return m ? { model: m.id, w, h } : { sdf: ['torus', 'sphere', 'steps', 'cone'][i % 4], w, h };
}
const fastTiles = () => (cat && cat.tiles || []).filter(t => !t.slow);
const tileFor = i => fastTiles().length ? fastTiles()[i % fastTiles().length].id : 'color';

// The images that a shot needs, at a size that fits the subject box.
async function prepare(shot, box) {
  await catalog();
  const a = shot.id === 'rds' ? 2 : 16 / 10;
  const f = fitRect(box, a);
  const w = clamp(Math.round(f.w), 160, 900), h = Math.round(w / a);
  const mode = { mode: 'wall', dpi: 64 };
  if (shot.id === 'turn') {
    const r = await job('turn', { spec: specFor(shot.obj, w, h), n: 30, tile: shot.tile % 3 === 0 ? 'color' : tileFor(shot.tile), opts: mode });
    return { frames: r.frames.map(canvasOf) };
  }
  if (shot.id === 'reveal') {
    const r = await job('stereo', { spec: specFor(shot.obj, w, h), tile: tileFor(shot.tile), opts: mode, withDepth: true });
    return { img: canvasOf(r.img), depth: canvasOf(D.depthImage(r.depth)) };
  }
  if (shot.id === 'rds') {
    const half = Math.round(w / 2) - 4, hh = Math.round(half * 0.85);
    const r = await job('rds', { spec: specFor(shot.obj, half, hh), opts: { disparity: Math.max(3, Math.round(half / 28)) } });
    const pair = document.createElement('canvas'); D.putPair(pair, r.left, r.right, 8);
    return { img: pair };
  }
  if (shot.id === 'row') {
    const d = await job('depth', { spec: specFor(shot.obj, 360, 224) });
    const z = G.depthRow(d, Math.round(d.h * 0.5)), E = 112, mu = 1 / 3;
    const same = G.lookBackRow(z, E, mu), r = G.rng(7);
    return { st: { z, same, colours: G.rowColours(same, () => r() < 0.5 ? '#111' : '#f4f4f4', false), rule: 'look', sepFar: G.separation(0, mu, E), sepNear: G.separation(1, mu, E) } };
  }
  if (shot.id === 'wall') {
    const tc = D.flowerTile(document.createElement('canvas'), 96);
    const bot = (cat.tiles || []).find(t => /botan|flor|leaf/i.test(t.family + ' ' + t.name));
    if (bot) { const img = await job('tile', { id: bot.id, size: 96 }).catch(() => null); if (img) D.putImage(tc, img); }
    return { tile: tc };
  }
  return {};
}

const drawFit = (g, src, r) => { const f = fitRect(r, src.width / src.height); g.imageSmoothingEnabled = false; g.drawImage(src, f.x, f.y, f.w, f.h); return f; };

// Each painter: (g, box, k 0..1 through the shot, t seconds, data).
const PAINT = {
  turn(g, box, k, t, d) { const fr = d.frames; return drawFit(g, fr[Math.floor(t * 8) % fr.length], box); },
  reveal(g, box, k, t, d) {
    const f = drawFit(g, d.img, box), wipe = smooth((k - 0.25) / 0.3) * (1 - smooth((k - 0.7) / 0.25));
    if (wipe > 0) { g.save(); g.beginPath(); g.rect(f.x, f.y, f.w * wipe, f.h); g.clip(); g.drawImage(d.depth, f.x, f.y, f.w, f.h); g.restore(); }
    return f;
  },
  rds(g, box, k, t, d) { return drawFit(g, d.img, box); },
  eyes(g, box, k, t) {
    const f = fitRect(box, 4 / 3);
    const st = { I: 6.35, F: { x: 0, z: 40 }, P: { x: 9 * Math.sin(t * 0.35), z: 34 + 14 * Math.sin(t * 0.23) }, view: { x0: -24, x1: 24, z1: 60 } };
    g.save(); g.translate(f.x, f.y); D.drawGeo(g, f.w, f.h, st); g.restore();
    return f;
  },
  scope(g, box, k, t) { const f = fitRect(box, 1); g.save(); g.translate(f.x, f.y); D.drawScope(g, f.w, f.h, t); g.restore(); return f; },
  row(g, box, k, t, d) {
    const f = fitRect(box, 2);
    g.save(); g.translate(f.x, f.y); D.drawRow(g, f.w, f.h, Object.assign({}, d.st, { upTo: Math.floor(d.st.z.length * smooth(k / 0.8)) })); g.restore();
    return f;
  },
  wall(g, box, k, t, d) {
    const f = fitRect(box, 16 / 7);
    g.save(); g.translate(f.x, f.y); g.beginPath(); g.rect(0, 0, f.w, f.h); g.clip();
    D.drawWall(g, f.w, f.h, d.tile, Math.round(clamp(f.w / 12, 56, 96)), Math.round(8 * Math.sin(t * 0.5)));
    g.restore();
    return f;
  },
};
const NEEDS = { turn: 'frames', reveal: 'img', rds: 'img', row: 'st', wall: 'tile' };

let S = null;
// Delete the images of every shot below S.i - 1.
function prune() { for (const k of [...S.data.keys()]) if (k < S.i - 1) S.data.delete(k); }
window.snSaver = {
  enter(o = {}) {
    if (S) this.exit();
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || 1;
    const plan = shotPlan(seed, 48, calm);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none;background:#05070c}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__sgSaver = true;
    S = { plan, css, cv, raf: 0, i: 0, tau: 0, t: 0, last: 0, plated: -1, subj: null, data: new Map(), errs: 0, lastErr: '' };
    const g = cv.getContext('2d');
    const boxNow = () => { const h = innerHeight, band = typeof o.label === 'function' ? plateBand(h) : null; return shotRect(innerWidth, h, band); };
    const want = i => {
      const sh = plan[i % plan.length];
      if (!NEEDS[sh.id] || S.data.has(i)) return;
      S.data.set(i, null);
      const run0 = S;
      prepare(sh, boxNow()).then(d => { if (S === run0 && i >= S.i - 1) S.data.set(i, d); }, e => { if (S === run0) { S.errs++; S.lastErr = String(e); } });
    };
    want(0); want(1);
    const frame = now => {
      if (!S) return;
      const dt = Math.min(0.05, S.last ? (now - S.last) / 1000 : 0.016); S.last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      let shot = plan[S.i % plan.length];
      S.tau += dt; S.t += dt;
      if (S.tau >= shot.sec) { S.tau = 0; S.i++; prune(); shot = plan[S.i % plan.length]; }
      want(S.i); want(S.i + 1);
      const k = S.tau / shot.sec, box = boxNow();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = BG; g.fillRect(0, 0, w, h);
      const d = S.data.get(S.i);
      const id = NEEDS[shot.id] && !d ? 'eyes' : shot.id;
      try { S.subj = PAINT[id](g, box, k, S.t, d); } catch (e) { S.errs++; S.lastErr = String(e); }
      const fade = smooth(Math.min(S.tau, shot.sec - S.tau) / (0.6 + 0.6 * calm));
      if (fade < 1) { g.fillStyle = `rgba(5,7,12,${1 - fade})`; g.fillRect(0, 0, w, h); }
      const key = S.i * 2 + (id === shot.id ? 1 : 0);
      if (S.plated !== key && typeof o.label === 'function') {
        S.plated = key;
        try { o.label(Object.assign({}, SHOTS[id], { anchor: () => S && S.subj ? { x: S.subj.x, y: S.subj.y, w: S.subj.w, h: S.subj.h } : null })); } catch (e) { /* the plate is optional */ }
      }
      S.raf = requestAnimationFrame(frame);
    };
    S.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 2500 };
  },
  exit() {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    S.cv.remove(); S.css.remove();
    S = null; window.__sgSaver = false;
  },
};
window.snSaver.debug = () => S ? { i: S.i, id: S.plan[S.i % S.plan.length].id, tau: S.tau, ready: S.data.get(S.i) != null, errs: S.errs, lastErr: S.lastErr, keys: [...S.data.keys()] } : null;
window.snSaver.cut = id => { if (!S) return; const j = S.plan.findIndex((s, n) => n > S.i && s.id === id); if (j > 0) { S.i = j; S.tau = 0; prune(); } };
