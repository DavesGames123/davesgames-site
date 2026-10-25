// ============================================================================
//  ALPHA QUDITS  ·  ends/index.js  ·  the ENDS figures  (package ENDS)
// ----------------------------------------------------------------------------
//  Analogy 2 (mirror gears, the Bloch sphere, qutrit letters), analogy 3
//  (locks and keys, the read cap) and the charge figure of chapters 3, 4
//  and 5. Each scene is a 2D canvas with its own short analogy text: what
//  the analogy gets right, and where it breaks. Every number on screen is
//  computed in ends/linalg.js (node-tested), not typed in.
//
//  No three.js: the Bloch sphere is a small orthographic projection on a
//  2D canvas, so the page needs no importmap and no WebGL context for ENDS.
//
//  API
//    createEnds(host, opts) -> {
//      show(scene, params)  switch to a scene; params = { step, ... }
//                           (each scene lists its steps in STEPS[scene])
//      play(t)              a number: draw one frame at t seconds (CORE
//                           calls this each frame while on screen; the
//                           saver and the tests too). It stops the own loop.
//                           no argument: run the own rAF loop.
//      pause(), resume()    stop and restart the own loop
//      resize()             read the host width again
//      setBand(band)        { t, b } px clear of the saver plate, or null
//      dispose()            remove the DOM and listeners
//      scenes, saverShots, canvas, current()
//    }
//    opts: { scene, params, reduced, fill (canvas fills the host, no
//            controls and no text: the saver), controls (default true),
//            notes (default true: the analogy text, right and breaks),
//            autoplay (default true: own loop until the first play(t)),
//            height (px, optional) }
//
//  SCENES (STEPS[scene] is the step list; params.step picks one)
//    gears ... transpose identity as two meshing involute gears; a
//              matching U (x) conj(U) leaves the pair unchanged
//    bloch ... the qubit end: 3 mutually unbiased read bases, 3 Pauli
//              letters, anticommuting reads and the commutator letter
//    qutrit .. the qutrit end: 4 bases with cube-root phases, 8 Gell-Mann
//              letters, why no order sign exists at odd d
//    locks ... the (d1, d2) grid to 5 x 5 as locks; positive maps as keys;
//              the live Choi-map test on a PPT entangled state
//    charge .. the 5 x 5 block algebra su(3) + su(2) + u(1); Q, Y, U; the
//              rank-8 action on the pair ket; hypercharge 1/6
//
//  SAVER
//    saverShots: [{ id, scene, params, seconds, title, caption, tex }].
//    A shot is drawn with createEnds(host, { fill: true, scene, params })
//    and play(t). setBand() keeps the subject in the clear band.
//
//  FILES
//    index.js ....... this API, the DOM shell, the loop, saverShots
//    linalg.js ...... the numbers (DOM-free)
//    draw.js ........ canvas helpers, gear and lock drawings
//    style.js ....... the CSS of the figure shell (injected once)
//    model-link.js .. optional cross-check against ../model/index.js
//    scenes/*.js .... one module per scene: { id, steps, analogy, draw }
//    tests.mjs ...... node tests (numbers, scene draws with a mock canvas)
//
//  GREP MAP   (grep -n "<anchor>" index.js)
//    export const SCENES / export const STEPS / export const saverShots
//    export function createEnds
//    function buildControls ... the 44 px step buttons
//    function frame ........... one draw of the current scene
// ============================================================================
import gears from './scenes/gears.js';
import bloch from './scenes/bloch.js';
import qutrit from './scenes/qutrit.js';
import locks from './scenes/locks.js';
import charge from './scenes/charge.js';
import { CSS } from './style.js';
import { C } from './draw.js';

const MODS = { gears, bloch, qutrit, locks, charge };
export const SCENES = Object.keys(MODS);
export const STEPS = Object.fromEntries(SCENES.map(k => [k, MODS[k].steps.map(s => s.id)]));
export const ANALOGY = Object.fromEntries(SCENES.map(k => [k, MODS[k].analogy]));
export { MODS as SCENE_MODULES };

export const saverShots = [
  { id: 'ends-gears-mesh', scene: 'gears', params: { step: 'mesh', d: 2 }, seconds: 9, title: 'Mirror gears', caption: 'A turn at one end is its mirror turn at the far end.', tex: '(A\\otimes 1)\\,|\\omega_m\\rangle=(1\\otimes A^{T})\\,|\\omega_m\\rangle' },
  { id: 'ends-gears-match', scene: 'gears', params: { step: 'match', d: 3 }, seconds: 8, title: 'A matching', caption: 'U at one end and its conjugate at the other leave the pair as it was.', tex: '(U\\otimes\\bar U)\\,|\\omega_m\\rangle=|\\omega_m\\rangle' },
  { id: 'ends-bloch-bases', scene: 'bloch', params: { step: 'bases' }, seconds: 10, title: 'Three ways to read a qubit', caption: 'Three mutually unbiased bases: every overlap across bases is 1/2.', tex: '|\\langle e|f\\rangle|^{2}=\\tfrac12' },
  { id: 'ends-bloch-comm', scene: 'bloch', params: { step: 'commutator' }, seconds: 10, title: 'Reads that anticommute', caption: 'Two qubit reads in different bases fix their product, with the order as its sign.', tex: '\\sigma_x\\sigma_y=-\\sigma_y\\sigma_x=i\\,\\sigma_z' },
  { id: 'ends-qutrit-letters', scene: 'qutrit', params: { step: 'letters' }, seconds: 9, title: 'Eight qutrit letters', caption: 'Four bases, two traceless letters each: the eight Gell-Mann matrices.', tex: '(d+1)(d-1)=d^{2}-1=8' },
  { id: 'ends-qutrit-phase', scene: 'qutrit', params: { step: 'phase' }, seconds: 9, title: 'No sign at the qutrit', caption: 'The qutrit phase is a cube root of unity, which is not its own inverse.', tex: 'ZX=\\omega XZ,\\quad \\omega=e^{2\\pi i/3}\\neq\\omega^{-1}' },
  { id: 'ends-locks-grid', scene: 'locks', params: { step: 'grid' }, seconds: 11, title: 'The read cap', caption: 'Only the types with d1 d2 at most 6 open for every key.', tex: 'd_1 d_2\\le 6' },
  { id: 'ends-locks-witness', scene: 'locks', params: { step: 'witness' }, seconds: 10, title: "Choi's key", caption: 'A positive map that no read composes catches a PPT entangled state.', tex: '\\Phi=\\Phi_1+\\Phi_2\\circ T\\ \\text{fails at}\\ (3,3)' },
  { id: 'ends-charge-algebra', scene: 'charge', params: { step: 'algebra' }, seconds: 10, title: 'Basis changes at two ends', caption: 'su(3) at the qutrit, su(2) at the qubit, and one phase that neither end owns.', tex: '\\mathfrak{su}(3)\\oplus\\mathfrak{su}(2)\\oplus\\mathfrak{u}(1)' },
  { id: 'ends-charge-q', scene: 'charge', params: { step: 'charge' }, seconds: 10, title: 'The acting charge', caption: 'Q acts on the pair ket as i; the quark doublet has hypercharge 1/6.', tex: 'Q=6iY,\\quad Y=\\tfrac12-\\tfrac13=\\tfrac16' },
];

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style'); s.id = 'ends-css'; s.textContent = CSS; document.head.appendChild(s);
}

export function createEnds(host, opts = {}) {
  injectCss();
  const fill = !!opts.fill, showCtl = !fill && opts.controls !== false, showNotes = !fill && opts.notes !== false;
  const root = document.createElement('div'); root.className = 'ends-fig' + (fill ? ' ends-fill' : '');
  const wrapEl = document.createElement('div'); wrapEl.className = 'ends-canvas';
  const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img');
  wrapEl.appendChild(canvas); root.appendChild(wrapEl);
  const ctl = document.createElement('div'); ctl.className = 'ends-ctl'; if (showCtl) root.appendChild(ctl);
  const cap = document.createElement('p'); cap.className = 'ends-cap'; cap.setAttribute('aria-live', 'polite'); if (!fill) root.appendChild(cap);
  const notes = document.createElement('div'); notes.className = 'ends-notes'; if (showNotes) root.appendChild(notes);
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
    if (fill) { g.fillStyle = C.bg; g.fillRect(0, 0, W, H); }
    mod.draw(g, env(), st, reduced ? t * 0.6 : t);
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
      const seg = document.createElement('div'); seg.className = 'ends-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', group.label);
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
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ends-auto'; b.textContent = 'Tour';
      b.title = 'Step through the scene again';
      b.addEventListener('click', () => { st.auto = true; st.since = tNow; buildControls(); });
      ctl.appendChild(b);
    }
  }
  function show(scene, params = {}) {
    if (!MODS[scene]) throw new Error('ends: no scene ' + scene);
    mod = MODS[scene];
    st = mod.init(params);
    st.auto = params.step ? !!params.auto : (opts.autoplay !== false);
    st.since = tNow;
    root.dataset.scene = scene;
    if (showNotes) {
      notes.innerHTML = '';
      const a = mod.analogy;
      for (const [k, txt] of [['right', 'What it gets right: '], ['breaks', 'Where it breaks: ']]) {
        const p = document.createElement('p'); p.className = 'ends-note ' + k;
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
  show(opts.scene || 'gears', opts.params || {});
  if (opts.autoplay !== false && !fill) api.play();
  return api;
}
