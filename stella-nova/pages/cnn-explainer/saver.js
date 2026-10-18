// ============================================================================
//  CNN EXPLAINER  ·  saver.js  the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. enter() hides the page, puts one canvas
//  over the whole window and plays a seeded plan: the example photos in a
//  shuffled order (each once before any repeat). Each photo gets a
//  "pipeline" shot (the network lights up from the picture to the answer,
//  then a probe walks over the maps and shows what feeds each cell) and
//  one or two detail shots (convolution, ReLU, max pooling or softmax),
//  drawn by the same scenes.js code as the page. Shots last 6 to 11 s with
//  a fade between them. Everything sits in the clear band between the
//  plate texts (lib/saver-clear.js plateBand), for 16:9 and the 9:16 column.
//
//  The saver keeps its own maps and results, so the page state stays.
//
//  grep -n 'export function shotPlan'   the seeded plan (no DOM)
//  grep -n 'export function fitNet'     the network layout in a band
//  grep -n 'export function installSaver'
//  grep -n 'function plateFor'          the plate of each shot
// ============================================================================
import { forward, ARCH, CLASSES } from './net.js';
import { EXAMPLES, exampleRGB } from './data.js';
import { layoutNet, GRID } from './layout.js';
import { drawNetwork, THEME } from './draw.js';
import { makeScene } from './scenes.js';
import { createMaps } from './maps.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DETAIL_KINDS = [
  { kind: 'conv', layers: [1, 3, 6, 8] },
  { kind: 'relu', layers: [2, 4, 7] },
  { kind: 'pool', layers: [5, 10] },
  { kind: 'dense', layers: [11] },
];

// A list of shots: { id: 'pipeline' | 'conv' | 'relu' | 'pool' | 'dense',
// ex (example index), li, c, sec, start (0..1 of the scan), gw (glide
// speed factor) }. Seeded; the examples go in a shuffled order, each once
// before a repeat; no detail kind twice in a row.
export function shotPlan(seed, n = 40, calm = 0.7) {
  const R = rng(seed), out = [];
  let bag = [], lastKind = '';
  const nextEx = () => {
    if (!bag.length) { bag = EXAMPLES.map((_, i) => i); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
    return bag.pop();
  };
  while (out.length < n) {
    const ex = nextEx();
    out.push({ id: 'pipeline', ex, li: 0, c: 0, sec: 8 + R() * 3 + calm * 1.5 });
    const k = 1 + (R() < 0.45 ? 1 : 0);
    for (let j = 0; j < k && out.length < n; j++) {
      let d; do { d = DETAIL_KINDS[Math.floor(R() * DETAIL_KINDS.length)]; } while (d.kind === lastKind);
      lastKind = d.kind;
      const li = d.layers[Math.floor(R() * d.layers.length)];
      out.push({ id: d.kind, ex, li, c: Math.floor(R() * 10), sec: 6 + R() * 4 + calm * 1.5, start: 0.15 + R() * 0.6 });
    }
  }
  return out;
}

// The overview inside a band { x, y, w, h }: the columns layout when the
// band is wide, the blocks layout scaled to fit when it is tall.
const TALL_SKIP = new Set([2, 4, 7, 9]);
export function fitNet(band) {
  const wide = band.w >= band.h * 1.05;
  if (wide) {
    const L = layoutNet(band.w, band.h, 'h');
    return { L, k: 1, ox: band.x, oy: band.y };
  }
  // tall (the 9:16 column): one row of ten maps per layer, the ReLU layers
  // left out (they look like the conv before them), bars in two columns,
  // scaled to fit the band
  const L = layoutNet(band.w, 0, 'v', { per: 10, skip: TALL_SKIP, barCols: 2, inline: true });
  const k = Math.min(1, band.w / L.w, band.h / L.h);
  return { L, k, ox: band.x + (band.w - L.w * k) / 2, oy: band.y + (band.h - L.h * k) / 2 };
}

// the k-th (mod 5) busiest map of layer li: the largest spread of values
export function busyMap(res, li, k) {
  const L = res.layers[li], sp = [];
  for (let c = 0; c < L.C; c++) {
    let lo = Infinity, hi = -Infinity, on = 0;
    for (let i = 0; i < L.H * L.W; i++) { const v = L.data[i * L.C + c]; if (v < lo) lo = v; if (v > hi) hi = v; if (v > 0) on++; }
    sp.push({ c, s: (hi - lo) * Math.sqrt(on / (L.H * L.W) + 0.05) });
  }
  sp.sort((a, b) => b.s - a.s);
  return sp[k % Math.min(5, sp.length)].c;
}

function plateFor(shot, res) {
  const ex = EXAMPLES[shot.ex], top = CLASSES[res.top], pc = (res.probs[res.top] * 100).toFixed(1) + '%';
  const credit = `Photo: ${ex.author}, ${ex.licence}, Wikimedia Commons`;
  const net = 'Tiny VGG from CNN Explainer, Wang et al., IEEE VIS 2020 (MIT)';
  const label = ARCH[shot.li] ? ARCH[shot.li].label : '';
  if (shot.id === 'pipeline') return { title: `It sees ${/^[aeiou]/.test(top) ? 'an' : 'a'} ${top}`, sub: `${pc} · a photo of ${ex.cls} through 12 layers and 19,920 weights`, tex: ['p_k = \\frac{e^{z_k}}{\\sum_{j} e^{z_j}}'], lines: [credit, net] };
  if (shot.id === 'conv') return { title: 'Convolution', sub: `${label}, map ${shot.c + 1}: a 3 × 3 kernel slides over the maps before it`, tex: ['z_{y,x} = \\sum_{c}\\sum_{i,j} a_{c,\\,y+i,\\,x+j}\\, w_{c,i,j} + b'], lines: [credit, net] };
  if (shot.id === 'relu') return { title: 'ReLU', sub: `${label}, map ${shot.c + 1}: negative values become zero`, tex: ['\\mathrm{ReLU}(x) = \\max(0,\\, x)'], lines: [credit, net] };
  if (shot.id === 'pool') return { title: 'Max pooling', sub: `${label}, map ${shot.c + 1}: each 2 × 2 tile keeps its largest value`, tex: ['y = \\max(x_1, x_2, x_3, x_4)'], lines: [credit, net] };
  return { title: 'Softmax', sub: `1690 numbers, ten scores, one answer: ${top} ${pc}`, tex: ['p_k = \\frac{e^{z_k}}{\\sum_{j=1}^{10} e^{z_j}}'], lines: [credit, net] };
}

export function installSaver(page, { doc = document, win = window } = {}) {
  let run = null;
  const results = new Map();
  const resultOf = i => { if (!results.has(i)) results.set(i, forward(page.state.W, exampleRGB(page.state.bin, i))); return results.get(i); };

  function enter(o = {}) {
    if (run) exit();
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 31) >>> 0) || 1;
    const plan = shotPlan(seed, 60, calm);
    const css = doc.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none;background:#0b0d13}';
    doc.head.appendChild(css);
    const cv = doc.createElement('canvas'); cv.id = 'snSaverCv';
    doc.body.appendChild(cv);
    const maps = createMaps(doc);
    const st = page.state;
    run = { plan, css, cv, maps, i: -1, tau: 0, last: 0, raf: 0, scene: null, shot: null, probe: null, subj: null, calm, labels: o.labels !== false, o, errs: 0, frames: 0, startShot: null };
    const g = cv.getContext('2d');
    function startShot(i) {
      run.i = i; run.tau = 0;
      const shot = plan[i % plan.length], res = resultOf(shot.ex);
      maps.set(res, { grad: st.grad || 'magma', rev: !!st.rev, scale: st.scale || 'layer' });
      run.shot = shot; run.res = res;
      // detail shots: each map uses the whole gradient, and the map is one
      // of the five busiest of its layer (a sparse map reads as black)
      if (shot.id !== 'pipeline') maps.set(null, { scale: 'map' });
      run.scene = shot.id === 'pipeline' ? null : makeScene({ result: res, W: st.W, maps, li: shot.li, c: shot.id === 'dense' ? res.top : busyMap(res, shot.li, shot.c) });
      if (run.scene && run.scene.count) run.t0 = Math.floor(shot.start * run.scene.count);
      run.probe = null; run.cam = null;
      if (typeof o.label === 'function') {
        if (run.scene && shot.id !== 'dense') shot.c = run.scene.c;
        try { o.label(Object.assign(plateFor(shot, res), { anchor: () => (run && run.subj ? run.subj : null) })); } catch (e) { /* the plate is optional */ }
      }
    }
    function frame(now) {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now; run.dt = dt;
      const dpr = Math.min(2, win.devicePixelRatio || 1), w = win.innerWidth || 1280, h = win.innerHeight || 720;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      if (run.i < 0) startShot(0);
      run.tau += dt;
      if (run.tau >= run.shot.sec) startShot(run.i + 1);
      const shot = run.shot, k = run.tau / shot.sec;
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const pw = band && band.w ? Math.min(w, band.w) : w;
      const top = band ? band.t : h * 0.06, bot = band ? band.b : h * 0.06;
      const m = Math.max(12, pw * 0.04);
      const B = { x: (w - pw) / 2 + m, y: top, w: pw - 2 * m, h: Math.max(120, h - top - bot) };
      if (!g) { run.raf = win.requestAnimationFrame(frame); return; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = THEME.bg; g.fillRect(0, 0, w, h);
      try { if (shot.id === 'pipeline') drawPipeline(g, B, k); else drawDetail(g, B, k); run.frames++; } catch (e) {
        // skip a bad frame; count it for snSaver.debug()
        if (!run.errs++) console.warn('cnn-explainer saver: frame', e);
      }
      const f = smooth(Math.min(run.tau, shot.sec - run.tau) / (0.5 + 0.6 * run.calm));
      if (f < 1) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = `rgba(11,13,19,${1 - f})`; g.fillRect(0, 0, w, h); }
      run.raf = win.requestAnimationFrame(frame);
    }
    function drawPipeline(g2, B, k) {
      const fit = fitNet(B), L = fit.L, res = run.res;
      // the network lights up left to right in the first 45 % of the shot
      const sweep = k / 0.45;
      const reveal = li => clamp((sweep * 12 - li) / 1.6, 0, 1);
      // then a probe walks over the maps: hover links and receptive fields
      let hover = null;
      if (k > 0.5) {
        const slot = Math.floor((k - 0.5) / 0.5 * 4);
        if (!run.probe || run.probe.slot !== slot) {
          const R = rng((run.i + 1) * 977 + slot * 31);
          const li = [3, 5, 6, 8, 10, 11][Math.floor(R() * 6)];
          run.probe = li === 11 ? { slot, h: { kind: 'bar', i: res.top } } : { slot, h: { kind: 'map', li, c: Math.floor(R() * 10), gy: Math.floor(GRID[li] * (0.25 + R() * 0.5)), gx: Math.floor(GRID[li] * (0.25 + R() * 0.5)) } };
        }
        hover = run.probe.h;
      }
      // a slow push-in on the probed map in the second half, clipped to the band
      const z = 1 + 0.5 * smooth((k - 0.52) / 0.3);
      let tx = L.w / 2, ty = L.h / 2;
      if (hover) {
        const r = hover.kind === 'bar' ? L.bars[hover.i] : L.maps.find(m => m.li === hover.li && m.c === hover.c);
        if (r) { tx = r.x + (r.s || r.w) / 2; ty = r.y + (r.s || r.h) / 2; }
      }
      if (!run.cam || k < 0.5) run.cam = { x: tx, y: ty };
      const a = 1 - Math.exp(-run.dt * 1.6);
      run.cam.x += (tx - run.cam.x) * a; run.cam.y += (ty - run.cam.y) * a;
      const Tx = fit.ox + run.cam.x * fit.k, Ty = fit.oy + run.cam.y * fit.k;
      const f = (z - 1) / 0.5, Cx = B.x + B.w / 2, Cy = B.y + B.h / 2;
      const Px = Tx + (Cx - Tx) * f * 0.6, Py = Ty + (Cy - Ty) * f * 0.6;
      g2.save();
      g2.beginPath(); g2.rect(B.x, B.y, B.w, B.h); g2.clip();
      g2.translate(Px, Py); g2.scale(z, z); g2.translate(-Tx, -Ty);
      g2.translate(fit.ox, fit.oy); g2.scale(fit.k, fit.k);
      drawNetwork(g2, L, { maps: run.maps, result: res, hover, reveal, labels: run.labels, barT: clamp((sweep - 0.85) / 0.25, 0, 1) });
      g2.restore();
      run.subj = { x: Px, y: Py, r: 40 * z };
    }
    function drawDetail(g2, B, k) {
      const sc = run.scene;
      // calm scan speed; the dense scene plays its phases once
      const t = sc.count ? Math.min(sc.count - 1, run.t0 + run.tau * (2.2 + (1 - run.calm) * 5)) : clamp(k * 1.15, 0, 0.999);
      if (sc.st) sc.st.hold = false;
      // scenes are made for a card: give them a box of a good shape inside the band
      const wide = B.w >= B.h;
      const bw = wide ? Math.min(B.w, B.h * 2.1) : B.w, bh = wide ? B.h : Math.min(B.h, B.w * 1.6);
      const x = B.x + (B.w - bw) / 2, y = B.y + (B.h - bh) / 2;
      g2.save(); g2.translate(x, y);
      sc.draw(g2, bw, bh, t);
      g2.restore();
      run.subj = { x: x + bw / 2, y: y + bh / 2, w: bw, h: bh };
    }
    run.startShot = startShot;
    run.raf = win.requestAnimationFrame(frame);
    win.__cnnSaver = true;
    return { canvas: cv, warmupMs: 400 };
  }
  function exit() {
    if (!run) return;
    win.cancelAnimationFrame(run.raf);
    run.cv.remove(); run.css.remove();
    run = null; win.__cnnSaver = false;
    if (page.requestDraw) page.requestDraw();
  }
  // cut(id): jump to the next shot of that kind and k (0..1) into it, for probes
  function cut(id, k = 0.5) {
    if (!run) return false;
    for (let j = Math.max(0, run.i + 1); j < run.i + 1 + run.plan.length; j++) {
      if (run.plan[j % run.plan.length].id === id) { run.startShot(j); run.tau = run.shot.sec * k; return true; }
    }
    return false;
  }
  win.snSaver = { enter, exit, cut, debug: () => (run ? { i: run.i, id: run.shot && run.shot.id, ex: run.shot && run.shot.ex, tau: run.tau, frames: run.frames, errs: run.errs } : null) };
  return win.snSaver;
}
