// ============================================================================
//  CNN EXPLAINER  ·  saver.js  the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. enter() hides the page, puts one canvas
//  over the whole window and plays the guided run of the page (tour.js)
//  on one example photo after the other: a seeded shuffle, each photo
//  once before any repeat. The run is the same as on the page: the
//  picture splits into red, green and blue, each layer fills in with the
//  data flowing from the layer before it, a few columns open in place to
//  play their detail scene (the zoom layers change from photo to photo),
//  the 1690 values flow into the class bars and the winner lights up.
//  The answer holds for a few seconds, then the next photo fades in.
//
//  16:9: the columns layout, and a zoom opens its column in place (the
//  other columns make room). 9:16: one row per layer (the ReLU rows are
//  left out), and a zoom grows out of its map into a box in the middle of
//  the band while the network dims. Everything sits in the clear band
//  between the plate texts (lib/saver-clear.js plateBand).
//
//  The plate changes twice per photo: at the start and at the answer.
//  The saver keeps its own maps and results, so the page state stays; the
//  page run waits while the saver plays (page.saverPause).
//
//  grep -n 'export function photoPlan'  the seeded photos and zoom layers
//  grep -n 'export function fitNet'     the network layout in a band
//  grep -n 'export function installSaver'
//  grep -n 'function drawRun'           one frame of the run
//  grep -n 'function drawPanel'         a zoom panel on the canvas
//  grep -n 'function plateFor'          the plate at the start and the end
// ============================================================================
import { forward, CLASSES } from './net.js';
import { EXAMPLES, exampleRGB } from './data.js';
import { layoutNet, zoomFrom, lerpRect } from './layout.js';
import { drawNetwork, THEME, roundRect } from './draw.js';
import { makeScene } from './scenes.js';
import { createMaps } from './maps.js';
import { tourPlan, segAt, flowState, zoomF, scanAt, busyMap, zoomStart } from './tour.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// the layers a zoom of each kind can open on
export const ZOOM_CHOICES = { conv: [1, 3, 6, 8], relu: [2, 4, 7, 9], pool: [5, 10] };
export const HOLD_SEC = 3.5;   // the answer stays this long before the next photo

// A list of photos: { ex (example index), zooms: { conv, relu, pool,
// dense: 11 } }. Seeded; the examples go in a shuffled order, each once
// before a repeat; no zoom layer the same as on the photo before.
export function photoPlan(seed, n = 40) {
  const R = rng(seed), out = [];
  let bag = [], last = null;
  const nextEx = () => {
    if (!bag.length) { bag = EXAMPLES.map((_, i) => i); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
    return bag.pop();
  };
  while (out.length < n) {
    const zooms = { dense: 11 };
    for (const [kind, ls] of Object.entries(ZOOM_CHOICES)) {
      let li; do { li = ls[Math.floor(R() * ls.length)]; } while (last && li === last[kind]);
      zooms[kind] = li;
    }
    out.push({ ex: nextEx(), zooms });
    last = zooms;
  }
  return out;
}

// The overview inside a band { x, y, w, h }: the columns layout when the
// band is wide (expand: a zoom column opens in place), the blocks layout
// scaled to fit when it is tall.
export const TALL_SKIP = new Set([2, 4, 7, 9]);
export function fitNet(band, expand = null) {
  const wide = band.w >= band.h * 1.05;
  if (wide) {
    const L = layoutNet(band.w, band.h, 'h', expand ? { expand } : {});
    return { L, k: 1, ox: band.x, oy: band.y, wide };
  }
  // tall (the 9:16 column): one row of ten maps per layer, the ReLU layers
  // left out (they look like the conv before them), bars in two columns,
  // scaled to fit the band
  const L = layoutNet(band.w, 0, 'v', { per: 10, skip: TALL_SKIP, barCols: 2, inline: true });
  const k = Math.min(1, band.w / L.w, band.h / L.h);
  return { L, k, ox: band.x + (band.w - L.w * k) / 2, oy: band.y + (band.h - L.h * k) / 2, wide };
}

export { busyMap };

// the segment id that debug() and cut() use
const segId = seg => (seg.kind === 'zoom' ? seg.zoom : seg.kind);

function plateFor(when, photo, res) {
  const ex = EXAMPLES[photo.ex], top = CLASSES[res.top], pc = (res.probs[res.top] * 100).toFixed(1) + '%';
  const credit = `Photo: ${ex.author}, ${ex.licence}, Wikimedia Commons`;
  const net = 'Tiny VGG from CNN Explainer, Wang et al., IEEE VIS 2020 (MIT)';
  if (when === 'answer') return { title: `It sees ${/^[aeiou]/.test(top) ? 'an' : 'a'} ${top}`, sub: `${pc} · 12 layers and 19,920 weights, from the pixels to the answer`, tex: ['p_k = \\frac{e^{z_k}}{\\sum_{j=1}^{10} e^{z_j}}'], lines: [credit, net] };
  return { title: 'Layer by layer', sub: 'A small convolutional network looks at a 64 × 64 photo, one layer at a time', tex: ['z_{y,x} = \\sum_{c}\\sum_{i,j} a_{c,\\,y+i,\\,x+j}\\, w_{c,i,j} + b'], lines: [credit, net] };
}

// A zoom panel on the canvas. now: where the panel is in this frame;
// final: its open box. The map tile shows while it is small, then the
// scene fades in, drawn at the final size and scaled to now.
function drawPanel(g, now, final, scene, t, f, im) {
  const T = THEME;
  g.save();
  g.globalAlpha = Math.min(1, f * 4);
  g.fillStyle = 'rgba(15,18,26,0.97)'; roundRect(g, now.x, now.y, now.w, now.h, 12 * Math.min(1, now.w / final.w + 0.1)); g.fill();
  g.strokeStyle = 'rgba(255,160,110,0.32)'; g.lineWidth = 1; g.stroke();
  const zt = 1 - smooth((f - 0.25) / 0.5), zc = smooth((f - 0.45) / 0.5);
  if (zt > 0 && im && im.width) { g.globalAlpha = zt; g.imageSmoothingEnabled = false; g.drawImage(im, now.x, now.y, now.w, now.h); }
  if (zc > 0 && scene) {
    g.save();
    g.translate(now.x, now.y); g.scale(now.w / final.w, now.h / final.h);
    g.beginPath(); g.rect(0, 0, final.w, final.h); g.clip();
    g.globalAlpha = zc;
    g.font = `500 15px ${T.serif}`; g.fillStyle = T.ink; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(scene.title, 14, 24);
    g.translate(6, 34);
    scene.draw(g, final.w - 12, final.h - 40, t);
    g.restore();
  }
  g.restore();
}

export function installSaver(page, { doc = document, win = window } = {}) {
  let run = null;
  const results = new Map();
  const resultOf = i => { if (!results.has(i)) results.set(i, forward(page.state.W, exampleRGB(page.state.bin, i))); return results.get(i); };

  function enter(o = {}) {
    if (run) exit();
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 31) >>> 0) || 1;
    const photos = photoPlan(seed, 60);
    const css = doc.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none;background:#0b0d13}';
    doc.head.appendChild(css);
    const cv = doc.createElement('canvas'); cv.id = 'snSaverCv';
    doc.body.appendChild(cv);
    const maps = createMaps(doc);
    const st = page.state;
    // a calm saver plays the run a little slower than the page
    const pace = 1 + calm * 0.25;
    page.saverPause && page.saverPause(true);
    run = { photos, css, cv, maps, pi: -1, tau: 0, last: 0, raf: 0, plan: null, photo: null, res: null, scene: null, segI: -1,
      zoom: null, f: 0, calm, pace, labels: o.labels !== false, o, errs: 0, frames: 0, answered: false, tall: false, seg: null };
    const g = cv.getContext('2d');
    const label = info => { if (typeof o.label === 'function') { try { o.label(Object.assign(info, { anchor: () => (run && run.subj ? run.subj : null) })); } catch (e) { /* the plate is optional */ } } };
    function startPhoto(i, tall) {
      run.pi = i; run.tau = 0; run.segI = -1; run.scene = null; run.zoom = null; run.answered = false;
      const photo = photos[i % photos.length], res = resultOf(photo.ex);
      maps.set(res, { grad: st.grad || 'magma', rev: !!st.rev, scale: st.scale || 'layer' });
      run.photo = photo; run.res = res; run.tall = !!tall;
      run.plan = tourPlan({ zooms: photo.zooms, skip: tall ? TALL_SKIP : null, pace: run.pace });
      label(plateFor('start', photo, res));
    }
    function frame(now) {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now; run.dt = dt;
      const dpr = Math.min(2, win.devicePixelRatio || 1), w = win.innerWidth || 1280, h = win.innerHeight || 720;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const pw = band && band.w ? Math.min(w, band.w) : w;
      const top = band ? band.t : h * 0.06, bot = band ? band.b : h * 0.06;
      const m = Math.max(12, pw * 0.04);
      const B = { x: (w - pw) / 2 + m, y: top, w: pw - 2 * m, h: Math.max(120, h - top - bot) };
      const tall = B.w < B.h * 1.05;
      if (run.pi < 0) startPhoto(0, tall);
      run.tau += dt;
      if (run.tau >= run.plan.total + HOLD_SEC) startPhoto(run.pi + 1, tall);
      if (!g) { run.raf = win.requestAnimationFrame(frame); return; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = THEME.bg; g.fillRect(0, 0, w, h);
      try { drawRun(g, B); run.frames++; } catch (e) {
        // skip a bad frame; count it for snSaver.debug()
        if (!run.errs++) console.warn('cnn-explainer saver: frame', e);
      }
      // a fade at the start and the end of each photo
      const life = run.plan.total + HOLD_SEC;
      const fa = smooth(Math.min(run.tau, life - run.tau) / (0.6 + 0.5 * run.calm));
      if (fa < 1) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = `rgba(11,13,19,${1 - fa})`; g.fillRect(0, 0, w, h); }
      run.raf = win.requestAnimationFrame(frame);
    }
    // one frame of the run at run.tau
    function drawRun(g2, B) {
      const plan = run.plan, t = Math.min(run.tau, plan.total), res = run.res;
      const at = segAt(plan, t), seg = at.seg, fs = flowState(plan, t);
      run.seg = seg;
      if (at.i !== run.segI) {
        run.segI = at.i;
        if (seg.kind === 'zoom') {
          const c = seg.li === 11 ? res.top : busyMap(res, seg.li, run.pi);
          run.scene = makeScene({ result: res, W: page.state.W, maps, li: seg.li, c });
          run.zoom = { li: seg.li, c, start: zoomStart(res, seg.li, c) };
        } else { run.scene = null; run.zoom = null; }
        if (seg.kind === 'answer' && !run.answered) { run.answered = true; label(plateFor('answer', run.photo, res)); }
      }
      const f = run.zoom ? zoomF(seg, at.local) : 0;
      run.f = f;
      const sceneT = run.scene ? scanAt(seg, at.local, run.zoom.start, run.scene.count) : 0;
      if (run.scene && run.scene.st) run.scene.st.hold = false;
      const flow = fs.ended ? null : { li: fs.li, k: fs.k, time: run.tau, reduced: false };
      const wide = !run.tall && B.w >= B.h * 1.05;
      if (wide) {
        const fit = fitNet(B, run.zoom && f > 0 ? { li: run.zoom.li, f } : null), L = fit.L;
        g2.save(); g2.translate(fit.ox, fit.oy);
        drawNetwork(g2, L, { maps, result: res, flow, zoom: run.zoom && f > 0 ? { li: run.zoom.li, f } : null, labels: run.labels, barT: fs.barT, win: fs.win });
        g2.restore();
        if (run.zoom && f > 0) {
          const base = fitNet(B).L, full = fitNet(B, { li: run.zoom.li, f: 1 }).L.zoom;
          const from = zoomFrom(base, run.zoom.li, run.zoom.c, res.top);
          const now = lerpRect(from, full, f);
          const sh = r => ({ x: r.x + fit.ox, y: r.y + fit.oy, w: r.w, h: r.h });
          drawPanel(g2, sh(now), sh(full), run.scene, sceneT, f, run.zoom.li === 11 ? null : maps.img(run.zoom.li, run.zoom.c));
          run.subj = { x: fit.ox + full.x + full.w / 2, y: fit.oy + full.y + full.h / 2, w: full.w, h: full.h };
        } else {
          const col = L.cols.find(c => c.li === fs.li) || L.cols[0];
          run.subj = { x: fit.ox + col.cx, y: B.y + B.h / 2, r: 60 };
        }
        return;
      }
      // tall: the rows, scaled into the band; a zoom grows into a box in the middle
      const fit = fitNet(B), L = fit.L;
      g2.save(); g2.translate(fit.ox, fit.oy); g2.scale(fit.k, fit.k);
      drawNetwork(g2, L, { maps, result: res, flow, labels: run.labels, barT: fs.barT, win: fs.win });
      g2.restore();
      if (run.zoom && f > 0) {
        g2.fillStyle = `rgba(11,13,19,${0.62 * f})`; g2.fillRect(B.x, B.y, B.w, B.h);
        const fw = B.w, fh = Math.min(B.h, B.w * 1.5), final = { x: B.x, y: B.y + (B.h - fh) / 2, w: fw, h: fh };
        const r = zoomFrom(L, run.zoom.li, run.zoom.c, res.top);
        const from = { x: fit.ox + r.x * fit.k, y: fit.oy + r.y * fit.k, w: r.w * fit.k, h: r.h * fit.k };
        drawPanel(g2, lerpRect(from, final, f), final, run.scene, sceneT, f, run.zoom.li === 11 ? null : maps.img(run.zoom.li, run.zoom.c));
        run.subj = { x: final.x + final.w / 2, y: final.y + final.h / 2, w: final.w, h: final.h };
      } else {
        const col = L.cols.find(c => c.li === fs.li) || L.cols[0];
        run.subj = { x: B.x + B.w / 2, y: fit.oy + col.y * fit.k, r: 50 };
      }
    }
    run.startPhoto = startPhoto;
    run.raf = win.requestAnimationFrame(frame);
    win.__cnnSaver = true;
    return { canvas: cv, warmupMs: 400 };
  }
  function exit() {
    if (!run) return;
    win.cancelAnimationFrame(run.raf);
    run.cv.remove(); run.css.remove();
    run = null; win.__cnnSaver = false;
    page.saverPause && page.saverPause(false);
    if (page.requestDraw) page.requestDraw();
  }
  // cut(id, k): jump to the next segment of that id ('flow', 'conv',
  // 'relu', 'pool', 'dense', 'answer'; 'pipeline' is 'flow') and k (0..1)
  // into it, for probes. It looks in this photo, then in the next one.
  function cut(id, k = 0.5) {
    if (!run) return false;
    if (id === 'pipeline') id = 'flow';
    if (!run.plan) run.startPhoto(0, run.tall);
    for (let pass = 0; pass < 2; pass++) {
      const from = pass === 0 ? run.segI + 1 : 0;
      const seg = run.plan.segs.slice(Math.max(0, from)).find(q => segId(q) === id);
      if (seg) { run.tau = seg.t0 + seg.sec * clamp(k, 0, 0.999); return true; }
      run.startPhoto(run.pi + 1, run.tall);
    }
    return false;
  }
  win.snSaver = { enter, exit, cut, debug: () => (run ? { i: run.pi, id: run.seg ? segId(run.seg) : null, li: run.seg ? run.seg.li : null, ex: run.photo && run.photo.ex, tau: run.tau, f: run.f, frames: run.frames, errs: run.errs } : null) };
  return win.snSaver;
}
