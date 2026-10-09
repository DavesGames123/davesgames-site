// ============================================================================
//  CT EXPLAINED  ·  page wiring  (ES module)
// ----------------------------------------------------------------------------
//  Binds each <figure data-scene> to a scene from scenes-a.js or
//  scenes-b.js, sizes its canvas, routes pointer events and controls, and
//  runs one requestAnimationFrame loop for the figures in view.
//
//  LIFE OF A FIGURE
//    1. An IntersectionObserver (300 px margin) sees the figure. main.js
//       makes the scene the first time (the engine work happens here).
//    2. While any part is on screen, the loop calls step(dt) and render().
//    3. Off screen, the scene keeps its state and gets no time.
//  The loop stops while the saver runs (window.__ctxSaver) or the tab is
//  hidden.
//
//  CONTROLS (markup in index.html)
//    <div class="seg" data-set="key"><button data-v="value">  one of many
//    <input type="range" data-set="key">                      a number
//    <button data-act="key">                                  an action
//    <output data-out="key">                                  a readout
//    data-link="<preset id>" on an <a>: a CT Lab link (presets.js)
//    data-share="filter" on a figure: its filter controls also drive the
//    figure with the same data-share (the FBP figure)
//
//  GREP MAP
//    grep -n 'const MAKERS'        scene for each data-scene name
//    grep -n 'function mount'      sizes, pointer and controls of one figure
//    grep -n 'function loop'       the one animation loop
//    grep -n 'function initChips'  the sticky section bar
//    grep -n 'function initLinks'  CT Lab preset links
// ============================================================================
import { HeroScene, BeerScene, ProjScene, SinoScene, BPScene, FourierScene } from './scenes-a.js';
import { FilterScene, FBPScene, GantryScene, IterScene, ArtefactScene, HUScene } from './scenes-b.js';
import { artefactParam, ARTEFACTS } from './model.js';
import { labHref } from './presets.js';
import { typesetAll } from '../../lib/sci-math.js';
import './saver.js';

const MAKERS = {
  hero: () => new HeroScene(),
  beer: () => new BeerScene(),
  proj: () => new ProjScene(),
  sino: () => new SinoScene(),
  bp: () => new BPScene(),
  fourier: () => new FourierScene(),
  filter: () => new FilterScene(),
  fbp: () => new FBPScene(),
  gantry: () => new GantryScene(),
  iter: () => new IterScene(),
  artefact: () => new ArtefactScene(),
  hu: () => new HUScene(),
};

const inFrame = window !== window.top;
const figs = [];
const DPR = () => Math.min(2, window.devicePixelRatio || 1);

function mount(el) {
  const F = { el, name: el.dataset.scene, scene: null, cv: el.querySelector('canvas'), seen: false, on: false, w: 0, h: 0, err: false };
  F.g = F.cv.getContext('2d');
  figs.push(F);
  // pointer
  const pos = (e) => { const r = F.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const send = (type, e) => {
    if (!F.scene || !F.scene.pointer) return;
    const p = pos(e);
    const used = F.scene.pointer({ type, x: p.x, y: p.y, buttons: type === 'down' ? 1 : e.buttons });
    if (used && type === 'down' && F.cv.setPointerCapture) { try { F.cv.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } }
    if (used || type === 'up') draw(F);
  };
  F.cv.addEventListener('pointerdown', (e) => send('down', e));
  F.cv.addEventListener('pointermove', (e) => send('move', e));
  F.cv.addEventListener('pointerup', (e) => send('up', e));
  F.cv.addEventListener('pointerleave', (e) => send('up', e));
  // controls
  el.querySelectorAll('.seg[data-set]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      seg.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      control(F, seg.dataset.set, b.dataset.v);
    });
  });
  el.querySelectorAll('input[type=range][data-set]').forEach((inp) => {
    inp.addEventListener('input', () => control(F, inp.dataset.set, inp.value));
  });
  el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => control(F, b.dataset.act, true)));
  return F;
}

function ensure(F) {
  if (F.scene || F.err) return;
  try {
    F.scene = MAKERS[F.name]();
    // the FBP figure starts with the filter chosen in the filter figure
    if (F.name === 'fbp') {
      const src = figs.find((G) => G.name === 'filter' && G.scene);
      if (src) { F.scene.set('filter', src.scene.filter); F.scene.set('cutoff', src.scene.cutoff); }
    }
    // apply the controls already set in the markup
    F.el.querySelectorAll('.seg[data-set] button.on').forEach((b) => control(F, b.closest('.seg').dataset.set, b.dataset.v, true));
    F.el.querySelectorAll('input[type=range][data-set]').forEach((inp) => control(F, inp.dataset.set, inp.value, true));
  } catch (e) {
    F.err = true;
    console.error('ct-explained:', F.name, e);
    const note = document.createElement('p'); note.className = 'figerr'; note.textContent = 'This figure could not start in this browser.';
    F.el.appendChild(note);
  }
}

function control(F, key, v, quiet) {
  if (!F.scene) { if (!quiet) ensure(F); if (!F.scene) return; }
  if (F.name === 'artefact' && key === 'p') v = +v / 100;
  if (F.scene.set) F.scene.set(key, v);
  // readouts
  if (F.name === 'filter') {
    const o = F.el.querySelector('[data-out=cutoff]'); if (o && key === 'cutoff') o.textContent = (+v).toFixed(2);
    // the FBP figure follows the filter figure
    if (key === 'filter' || key === 'cutoff') for (const G of figs) if (G.name === 'fbp' && G.scene) G.scene.set(key, v);
  }
  if (F.name === 'artefact') {
    const id = F.scene.id, p = F.scene.p;
    if (key === 'case') {
      const inp = F.el.querySelector('input[data-set=p]'); if (inp) inp.value = String(Math.round(p * 100));
      const A = ARTEFACTS.find((a) => a.id === v), link = F.el.querySelector('a.lab');
      if (A && link) { link.dataset.link = A.preset; link.href = labHref(A.preset, inFrame); }
      F.el.querySelectorAll('[data-case]').forEach((d) => { d.hidden = d.dataset.case !== v; });
    }
    const o = F.el.querySelector('[data-out=p]');
    if (o) o.textContent = describe(id, artefactParam(id, F.scene.p));
  }
  if (F.name === 'hu') {
    if (key === 'window') {
      const L = F.el.querySelector('input[data-set=L]'), W = F.el.querySelector('input[data-set=W]');
      if (L) L.value = String(F.scene.L); if (W) W.value = String(F.scene.W);
    }
    const oL = F.el.querySelector('[data-out=L]'), oW = F.el.querySelector('[data-out=W]');
    if (oL) oL.textContent = `${F.scene.L} HU`; if (oW) oW.textContent = `${F.scene.W} HU`;
  }
  if (!quiet) draw(F);
}

function describe(id, P) {
  switch (id) {
    case 'noise': return `${P.dose.toLocaleString('en')} photons`;
    case 'views': return `${P.views} views`;
    case 'limited': return `${P.arcDeg}° arc`;
    case 'hardening': case 'metal': return `${P.kVp} kVp`;
    case 'rings': return `${P.dead} bad element${P.dead > 1 ? 's' : ''}`;
    case 'motion': return `±${P.amp} cm`;
    default: return '';
  }
}

function size(F) {
  const w = Math.round(F.cv.clientWidth || F.el.clientWidth);
  if (!w || !F.scene) return;
  const h = F.scene.height(w);
  const d = DPR();
  if (w !== F.w || h !== F.h || F.cv.width !== Math.round(w * d)) {
    F.w = w; F.h = h;
    F.cv.style.height = h + 'px';
    F.cv.width = Math.round(w * d); F.cv.height = Math.round(h * d);
  }
}

function draw(F) {
  if (!F.scene) return;
  size(F);
  if (!F.w) return;
  const g = F.g, d = F.cv.width / F.w;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, F.w, F.h);
  try { F.scene.render(g, F.w, F.h); } catch (e) { if (!F.loggedErr) { F.loggedErr = true; console.error('ct-explained render:', F.name, e); } }
}

let last = 0, raf = 0;
function loop(now) {
  raf = 0;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
  last = now;
  if (!window.__ctxSaver && !document.hidden) {
    for (const F of figs) {
      if (!F.on || !F.scene) continue;
      try { F.scene.step(dt); } catch (e) { if (!F.loggedErr) { F.loggedErr = true; console.error('ct-explained step:', F.name, e); } }
      draw(F);
    }
  }
  if (figs.some((F) => F.on)) raf = requestAnimationFrame(loop);
}
function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }

function initFigures() {
  document.querySelectorAll('figure[data-scene]').forEach(mount);
  const near = new IntersectionObserver((ents) => {
    for (const e of ents) { const F = figs.find((f) => f.el === e.target); if (F && e.isIntersecting) { ensure(F); draw(F); } }
  }, { rootMargin: '300px 0px' });
  const vis = new IntersectionObserver((ents) => {
    for (const e of ents) { const F = figs.find((f) => f.el === e.target); if (F) F.on = e.isIntersecting; }
    kick();
  }, { threshold: 0 });
  for (const F of figs) { near.observe(F.el); vis.observe(F.el); }
  const ro = new ResizeObserver(() => { for (const F of figs) if (F.scene) draw(F); });
  for (const F of figs) ro.observe(F.el);
  document.addEventListener('visibilitychange', kick);
}

function initChips() {
  const links = [...document.querySelectorAll('#chips a[data-target]')];
  const secs = links.map((a) => document.getElementById(a.dataset.target)).filter(Boolean);
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) {
      links.forEach((a) => a.classList.toggle('on', a.dataset.target === e.target.id));
      const on = links.find((a) => a.dataset.target === e.target.id);
      if (on && on.scrollIntoView) { const bar = on.parentElement.parentElement; const r = on.getBoundingClientRect(), b = bar.getBoundingClientRect(); if (r.left < b.left || r.right > b.right) bar.scrollLeft += r.left - b.left - 40; }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  secs.forEach((s) => io.observe(s));
}

function initLinks() {
  document.querySelectorAll('a[data-link]').forEach((a) => {
    a.href = labHref(a.dataset.link, inFrame);
    if (inFrame) a.target = '_top';
  });
}

initLinks();
initChips();
initFigures();
typesetAll(document, [['\\mu', 'm2'], ['p', 'm1'], ['\\theta', 'm5'], ['I_0', 'm4'], ['I', 'm4'], ['s', 'm3'], ['W', 'm6']]);
window.addEventListener('pagehide', () => { if (raf) cancelAnimationFrame(raf); raf = 0; });
