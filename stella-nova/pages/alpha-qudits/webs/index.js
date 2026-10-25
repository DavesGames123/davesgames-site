// ============================================================================
//  ALPHA QUDITS  ·  webs/index.js  ·  the WEBS figures  (closing section)
// ----------------------------------------------------------------------------
//  "Beyond the Letter: Chain Theory's wider program", the closing section
//  of the page. It stands apart from chapters 0-11: nothing there depends
//  on it. Source: the author's talk deck "Chain Theory: an introduction"
//  (23 October 2026) only; we have not read the compendium or its Lean
//  files (webs/data.js). Every claim carries the deck's grade: theorem,
//  conditional theorem, open result, or conjectured.
//
//  The DOM shell is the ENDS shell (ends/index.js) with the class prefix
//  webs-, so CORE mounts it the same way. The CSS is ends/style.js with the
//  same prefix change, made once at load.
//
//  API
//    createWebs(host, opts) -> {
//      show(scene, params), play(t), pause(), resume(), resize(),
//      setBand(band), dispose(), scenes, steps, saverShots, canvas, current()
//    }
//    opts: { scene, params, reduced, fill, controls, notes, autoplay, height }
//    (the same meaning as in createEnds)
//
//  SCENES (STEPS[scene] is the step list; params.step picks one)
//    chain ..... rigid links, free joints: the deck's analogy for the joins
//    genres .... the six genres; readable or dark; the conjectured sector
//    electron .. the electron's web, built link by link; muon and tau hubs
//    wz ........ the W and the Z: one web, read along one or two lines
//    grades .... the compendium's boxed statements by Part; the 17 particles
//
//  FILES
//    index.js ....... this API, the DOM shell, the loop, saverShots
//    data.js ........ every fact, from the talk deck (DOM-free)
//    draw.js ........ helpers (re-exports ../ends/draw.js; qudit dots, chips)
//    story.js ....... the section text, CORE's chapter shape
//    scenes/*.js .... one module per scene
//    tests.mjs ...... node tests
//
//  GREP MAP   (grep -n "<anchor>" index.js)
//    export const SCENES / export const STEPS / export const saverShots
//    export function createWebs
//    function buildControls ... the 44 px step buttons
//    function frame ........... one draw of the current scene
// ============================================================================
import chain from './scenes/chain.js';
import genres from './scenes/genres.js';
import electron from './scenes/electron.js';
import wz from './scenes/wz.js';
import grades from './scenes/grades.js';
import { CSS as ENDS_CSS } from '../ends/style.js';
import { C } from './draw.js';

const CSS = ENDS_CSS.replace(/\.ends-/g, '.webs-').replace(/ends-/g, 'webs-');
const MODS = { chain, genres, electron, wz, grades };
export const SCENES = Object.keys(MODS);
export const STEPS = Object.fromEntries(SCENES.map(k => [k, MODS[k].steps.map(s => s.id)]));
export const ANALOGY = Object.fromEntries(SCENES.map(k => [k, MODS[k].analogy]));
export { MODS as SCENE_MODULES };

export const saverShots = [
  { id: 'webs-chain', scene: 'chain', params: { step: 'pairs' }, seconds: 10, title: 'Rigid links, free joints', caption: 'Inside a pair one end fixes the other; across a shared qudit nothing matches the bases.', tex: '(U\\otimes\\bar U)\\,|\\omega_m\\rangle=|\\omega_m\\rangle' },
  { id: 'webs-genres', scene: 'genres', params: { step: 'sectors' }, seconds: 10, title: 'Six genres of link', caption: 'Two readable, four dark. The sector of each is a conjecture of the author.', tex: 'd_1 d_2\\le 6' },
  { id: 'webs-electron', scene: 'electron', params: { step: 'docks' }, seconds: 10, title: "The electron's web (conjectured)", caption: 'A core triangle of qutrits, an in-leg, a hub assembly and two docks.', tex: '(3,3)\\ (4,3)\\ (4,2)\\ (2,2)\\ (3,2)' },
  { id: 'webs-wz', scene: 'wz', params: { step: 'z' }, seconds: 9, title: 'The W and the Z (open)', caption: 'One web: the W read along one line, the Z along two.', tex: '\\text{W: one line}\\quad\\text{Z: two lines}' },
  { id: 'webs-grades', scene: 'grades', params: { step: 'parts' }, seconds: 10, title: 'The compendium, graded', caption: 'Release 0.1: 100 theorems, 109 conditional, 198 open, by Part.', tex: '100\\cdot 109\\cdot 198' },
];

// The layout width (360 to 1280 px) whose figure, scaled to fit a box of
// bw x bh, comes out largest. Phone layouts are tall; desktop ones wide.
export function fitLayout(mod, bw, bh) {
  let best = null;
  for (let w = 360; w <= 1280; w += 40) {
    const h = mod.height(w), k = Math.min(bw / w, bh / h);
    if (!best || k > best.k + 1e-9) best = { w, h, k };
  }
  return best;
}

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style'); s.id = 'webs-css'; s.textContent = CSS; document.head.appendChild(s);
}

export function createWebs(host, opts = {}) {
  injectCss();
  const fill = !!opts.fill, showCtl = !fill && opts.controls !== false, showNotes = !fill && opts.notes !== false;
  const root = document.createElement('div'); root.className = 'webs-fig' + (fill ? ' webs-fill' : '');
  const wrapEl = document.createElement('div'); wrapEl.className = 'webs-canvas';
  const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img');
  wrapEl.appendChild(canvas); root.appendChild(wrapEl);
  const ctl = document.createElement('div'); ctl.className = 'webs-ctl'; if (showCtl) root.appendChild(ctl);
  const cap = document.createElement('p'); cap.className = 'webs-cap'; cap.setAttribute('aria-live', 'polite'); if (!fill) root.appendChild(cap);
  const notes = document.createElement('div'); notes.className = 'webs-notes'; if (showNotes) root.appendChild(notes);
  host.appendChild(root);
  const g = canvas.getContext('2d');

  let mod = null, st = null, W = 0, H = 0, dpr = 1, band = null, raf = 0, running = false, t0 = 0, tNow = 0, lastCap = '';
  const reduced = opts.reduced != null ? !!opts.reduced : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastStep = null;
  const env = () => ({ W, H, dpr, fill, reduced, view: band ? { x: 0, y: band.t, w: W, h: Math.max(60, H - band.t - band.b) } : { x: 0, y: 0, w: W, h: H } });

  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(240, Math.round((fill ? r.width : wrapEl.getBoundingClientRect().width) || r.width || 360));
    H = fill ? Math.max(200, Math.round(r.height || 400)) : Math.round(opts.height || (mod && mod.height ? mod.height(W) : Math.min(480, Math.max(300, W * 0.72))));
    dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if (!running) frame(tNow);
  }
  function frame(t) {
    tNow = t;
    if (!mod) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (fill) {
      // the saver: lay the figure out at its best width, then scale it
      // into the clear band (or the whole canvas) and centre it there
      g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      const v = env().view, L = fitLayout(mod, v.w, v.h);
      g.translate(v.x + (v.w - L.w * L.k) / 2, v.y + (v.h - L.h * L.k) / 2); g.scale(L.k, L.k);
      mod.draw(g, { W: L.w, H: L.h, dpr, fill, reduced, view: { x: 0, y: 0, w: L.w, h: L.h } }, st, reduced ? t * 0.6 : t);
    } else mod.draw(g, env(), st, reduced ? t * 0.6 : t);
    if (mod.autoKey && st[mod.autoKey] !== lastStep) { lastStep = st[mod.autoKey]; buildControls(); }
    if (!fill) {
      const c = mod.caption ? mod.caption(st, t) : '';
      if (c !== lastCap) { cap.textContent = c; lastCap = c; canvas.setAttribute('aria-label', mod.title + '. ' + c); }
    }
  }
  function loop(ts) {
    if (!running) return;
    if (!t0) t0 = ts - tNow * 1000;
    frame((ts - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }
  function buildControls() {
    ctl.textContent = '';
    if (!showCtl || !mod) return;
    for (const group of mod.controls(st)) {
      const seg = document.createElement('div'); seg.className = 'webs-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', group.label);
      for (const o of group.options) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = o.label;
        b.setAttribute('aria-pressed', String(st[group.key] === o.v));
        b.addEventListener('click', () => {
          st[group.key] = o.v; st.auto = false; st.since = tNow;
          if (mod.onSet) mod.onSet(st, group.key, o.v, tNow);
          buildControls(); if (!running) frame(tNow);
        });
        seg.appendChild(b);
      }
      ctl.appendChild(seg);
    }
    if (st.auto === false && mod.autoKey) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'webs-auto'; b.textContent = 'Tour';
      b.title = 'Step through the scene again';
      b.addEventListener('click', () => { st.auto = true; st.since = tNow; buildControls(); });
      ctl.appendChild(b);
    }
  }
  function show(scene, params = {}) {
    if (!MODS[scene]) throw new Error('webs: no scene ' + scene);
    mod = MODS[scene];
    st = mod.init(params);
    st.auto = params.step ? !!params.auto : (opts.autoplay !== false);
    st.since = tNow;
    root.dataset.scene = scene;
    if (showNotes) {
      notes.innerHTML = '';
      const a = mod.analogy;
      for (const [k, txt] of [['right', 'What it gets right: '], ['breaks', 'Where it breaks: ']]) {
        const p = document.createElement('p'); p.className = 'webs-note ' + k;
        const b = document.createElement('b'); b.textContent = txt; p.appendChild(b); p.appendChild(document.createTextNode(a[k]));
        notes.appendChild(p);
      }
    }
    buildControls();
    resize();
  }
  // pointer: scenes may take drags and taps
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!mod || !mod.pointer) return;
    const r = canvas.getBoundingClientRect(), p = { x: e.clientX - r.left, y: e.clientY - r.top };
    drag = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false };
    mod.pointer(st, 'down', p, env(), tNow);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || !mod.pointer) return;
    const r = canvas.getBoundingClientRect(), p = { x: e.clientX - r.left, y: e.clientY - r.top, dx: e.clientX - r.left - drag.x, dy: e.clientY - r.top - drag.y };
    if (Math.abs(p.x - drag.x0) > 6) { drag.moved = true; if (!drag.cap) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* none */ } drag.cap = true; } }
    drag.x = p.x; drag.y = p.y;
    if (drag.moved && mod.pointer(st, 'move', p, env(), tNow)) { st.auto = false; if (!running) frame(tNow); }
  });
  const up = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = canvas.getBoundingClientRect(), p = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (mod.pointer && mod.pointer(st, drag.moved ? 'up' : 'tap', p, env(), tNow)) { st.auto = false; buildControls(); if (!running) frame(tNow); }
    drag = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => resize()); ro.observe(fill ? host : wrapEl); }
  const vis = () => { if (document.hidden && running) { cancelAnimationFrame(raf); raf = 0; } else if (!document.hidden && running && !raf) { t0 = 0; raf = requestAnimationFrame(loop); } };
  document.addEventListener('visibilitychange', vis);

  const api = {
    show,
    play(t) {
      if (typeof t === 'number') { api.pause(); frame(t); return; }
      if (running) return;
      running = true; t0 = 0; raf = requestAnimationFrame(loop);
    },
    pause() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    resume() { api.play(); },
    resize,
    setBand(b) { band = b && isFinite(b.t) && isFinite(b.b) ? { t: b.t, b: b.b } : null; if (!running) frame(tNow); },
    dispose() { api.pause(); if (ro) ro.disconnect(); document.removeEventListener('visibilitychange', vis); root.remove(); },
    current() { return mod ? { scene: mod.id, step: st.step, auto: st.auto } : null; },
    scenes: SCENES, steps: STEPS, saverShots, canvas,
  };
  show(opts.scene || 'chain', opts.params || {});
  if (opts.autoplay !== false && !fill) api.play();
  return api;
}
