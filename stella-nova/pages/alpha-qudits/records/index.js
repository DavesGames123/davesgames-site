// ============================================================================
//  ALPHA QUDITS  ·  records/index.js  ·  the RECORDS figures  (package RECORDS)
// ----------------------------------------------------------------------------
//  Analogy 4 of the page, mirrors and drum modes, and the counting figures of
//  chapters 7 and 8: the square of slots, the two exchanges as mirror flips,
//  even and odd modes on a plate and on two drums, all 172 records as our own
//  glyphs, and an abacus that adds the weights over N into 1/alpha. Every
//  count comes from MODEL (../model/index.js) through records/data.js; no
//  count is typed in. Each scene is a 2D canvas (no WebGL, no importmap).
//
//  API
//    createRecords(host, opts) -> {
//      show(scene, params)  switch to a scene; params = { step, ... }
//                           (STEPS[scene] lists the steps; no step = tour)
//      play(t)              a number: draw one frame at t seconds and stop
//                           the own loop (CORE calls it each frame while on
//                           screen; the saver and the tests too).
//                           no argument: run the own rAF loop.
//      pause(), resume()    stop and restart the own loop
//      resize()             read the host width again
//      setBand(band)        { t, b } px clear of the saver plate, or null
//      dispose()            remove the DOM and listeners
//      scenes, steps, saverShots, canvas, current()
//    }
//    opts: { scene, params, reduced, fill (canvas fills the host, no
//            controls and no text: the saver), controls (default true),
//            caption (default true: the live line under the canvas),
//            notes (default true: the analogy text, right and breaks),
//            autoplay (default true: own loop until the first play(t)),
//            height (px, optional) }
//
//  SCENES (STEPS[scene] is the step list; params.step picks one)
//    square .. the four slots Q1 q1 Q2 q2; each edge fills with its products
//              (letters times letters), the arc with the commutators
//    mirror .. X and Y as mirror flips of the square; a record and its image
//              split into an even and an odd combination; who survives
//    modes ... the drum analogy: a Chladni plate with a diagonal mirror
//              (n letters: n(n+1)/2 even and n(n-1)/2 odd modes), and two
//              drums that ring in phase or against each other
//    grid .... all 172 records as glyphs, sorted by pair of slots or by
//              sector; tap or hover shows a record
//    abacus .. one bead per record, 1, √2, √3, √6; the sum over N and the
//              exact digits of 1/alpha; what other weight laws would give
//
//  SAVER
//    saverShots: [{ id, scene, params, seconds, title, caption, tex }].
//    A shot is drawn with createRecords(host, { fill: true, scene, params })
//    and play(t). setBand() keeps the subject in the clear band.
//
//  FILES
//    index.js ....... this API, the DOM shell, the loop, the tour, saverShots
//    data.js ........ every count, read from MODEL (DOM-free)
//    draw.js ........ colours, text, the letter glyph and the record glyph
//    style.js ....... the CSS of the figure shell (injected once)
//    scenes/*.js .... one module per scene: { id, steps, analogy, draw, ... }
//    tests.mjs ...... node tests (counts against the paper, scene draws with
//                     a mock canvas at 320, 360 and 860 px, jsdom boot)
//
//  GREP MAP   (grep -n "<anchor>" index.js)
//    export const SCENES / export const STEPS / export const saverShots
//    export function createRecords
//    function tour ............ the step clock (auto tour or picked step)
//    function buildControls ... the 44 px step buttons
//    function frame ........... one draw of the current scene
// ============================================================================
import square from './scenes/square.js';
import mirror from './scenes/mirror.js';
import modes from './scenes/modes.js';
import grid from './scenes/grid.js';
import abacus from './scenes/abacus.js';
import { CSS } from './style.js';
import { C } from './draw.js';
import { EDGES, PRODUCT_TERMS, SECTOR_ROWS, RECORDS, READOUT } from './data.js';

const MODS = { square, mirror, modes, grid, abacus };
export const SCENES = Object.keys(MODS);
export const STEPS = Object.fromEntries(SCENES.map(k => [k, MODS[k].steps.map(s => s.id)]));
export const ANALOGY = Object.fromEntries(SCENES.map(k => [k, MODS[k].analogy]));
export { MODS as SCENE_MODULES };

// The saver plates. Every number in a caption or TeX string is read from
// data.js (MODEL), so the shots cannot drift from the records.
const SUM_TEX = EDGES.filter(e => !e.arc).map(e => e.products).join('+') + '=' + PRODUCT_TERMS;
const SEC_TEX = SECTOR_ROWS.map(s => s.count).join('+') + '=' + RECORDS.length;
const VAL_TEX = '\\frac{' + SECTOR_ROWS.map(s => s.count + (s.k === 1 ? '' : '\\sqrt{' + s.k + '}')).join('+') + '}{' + READOUT.N + '}';
export const saverShots = [
  { id: 'records-square-edges', scene: 'square', params: { step: 'edges' }, seconds: 10, title: 'The square of slots', caption: 'Each edge carries one product for each letter at one slot and each at the other.', tex: SUM_TEX },
  { id: 'records-square-mirror', scene: 'square', params: { step: 'mirror' }, seconds: 8, title: 'Swap the reads', caption: 'The swap maps the solid edges to themselves and the dashed edges to each other.', tex: 'X:\\ Q_1Q_2,\\ q_1q_2,\\ \\text{arc}\\qquad Y:\\ \\text{dashed},\\ \\text{arc}' },
  { id: 'records-mirror-pair', scene: 'mirror', params: { step: 'pair' }, seconds: 10, title: 'A record and its mirror image', caption: 'The sum is even and survives the exchange; the difference is odd and does not.', tex: 't\\pm Et' },
  { id: 'records-mirror-comm', scene: 'mirror', params: { step: 'commutator' }, seconds: 10, title: 'A commutator record', caption: 'Its own sign is the order sign, so it survives both exchanges.', tex: '[\\sigma_\\mu,\\sigma_\\nu]_{q_1}-[\\sigma_\\mu,\\sigma_\\nu]_{q_2}' },
  { id: 'records-modes-plate', scene: 'modes', params: { step: 'plate8' }, seconds: 12, title: 'Even and odd plate modes', caption: 'n patterns mirrored across a diagonal: n(n+1)/2 even and n(n-1)/2 odd.', tex: '\\tfrac{n(n+1)}{2}+\\tfrac{n(n-1)}{2}=n^{2}' },
  { id: 'records-modes-drums', scene: 'modes', params: { step: 'drums' }, seconds: 10, title: 'Two drums', caption: 'One pattern on two drums rings in phase (even) or against itself (odd).', tex: 'u_1\\pm u_2' },
  { id: 'records-grid-sectors', scene: 'grid', params: { step: 'sectors' }, seconds: 12, title: 'All ' + RECORDS.length + ' records', caption: 'Sorted into the four sectors of the two exchanges.', tex: SEC_TEX },
  { id: 'records-abacus-count', scene: 'abacus', params: { step: 'count' }, seconds: 12, title: 'Adding the weights', caption: 'One bead per record, weighted 1, √2, √3 or √6.', tex: '\\sum_{r=1}^{' + RECORDS.length + '}\\sqrt{k_r}' },
  { id: 'records-abacus-divide', scene: 'abacus', params: { step: 'divide' }, seconds: 10, title: 'Over the readout dimension', caption: 'The sum over N = ' + READOUT.unread + ' · ' + READOUT.read.join(' · ') + ' gives the candidate.', tex: VAL_TEX },
];

// The saver fill mode: draw the scene at a natural width Wn (height
// mod.height(Wn)) scaled to fit the box w x h. Wn is picked from 320 to
// 900 px to give the largest scale, so a scene keeps its phone or desktop
// layout and every part stays inside the clear band.
export function fitScene(mod, w, h) {
  let best = null;
  for (let Wn = 320; Wn <= 900; Wn += 20) {
    const Hn = mod.height(Wn), s = Math.min(w / Wn, h / Hn);
    if (!best || s > best.s + 1e-9) best = { Wn, Hn, s };
  }
  return { ...best, ox: (w - best.Wn * best.s) / 2, oy: (h - best.Hn * best.s) / 2 };
}

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style'); s.id = 'records-css'; s.textContent = CSS; document.head.appendChild(s);
}

// The step clock. In a tour the steps follow each other by their durations
// and loop; st.cycle counts the loops. A picked step holds, with its own
// clock from the moment it was picked.
function tour(mod, st, t) {
  if (t < st.since) st.since = t;
  if (t < st.stepSince) st.stepSince = t;
  const steps = mod.steps;
  if (st.auto && steps.length) {
    const total = steps.reduce((s, x) => s + x.dur, 0);
    const e = t - st.since, cyc = Math.floor(e / total);
    let r = e - cyc * total, i = 0;
    while (i < steps.length - 1 && r >= steps[i].dur) { r -= steps[i].dur; i++; }
    st.cycle = cyc; st.step = steps[i].id; st.stepT = r; st.stepDur = steps[i].dur;
  } else {
    const s = steps.find(x => x.id === st.step) || steps[0];
    st.step = s.id; st.stepT = t - st.stepSince; st.stepDur = s.dur;
    st.cycle = Math.floor(st.stepT / s.dur);
  }
}

export function createRecords(host, opts = {}) {
  injectCss();
  const fill = !!opts.fill, showCtl = !fill && opts.controls !== false;
  const showCap = !fill && opts.caption !== false, showNotes = !fill && opts.notes !== false;
  const root = document.createElement('div'); root.className = 'rec-fig' + (fill ? ' rec-fill' : '');
  const wrapEl = document.createElement('div'); wrapEl.className = 'rec-canvas';
  const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img');
  wrapEl.appendChild(canvas); root.appendChild(wrapEl);
  const ctl = document.createElement('div'); ctl.className = 'rec-ctl'; if (showCtl) root.appendChild(ctl);
  const cap = document.createElement('p'); cap.className = 'rec-cap'; cap.setAttribute('aria-live', 'polite'); if (showCap) root.appendChild(cap);
  const notes = document.createElement('div'); notes.className = 'rec-notes'; if (showNotes) root.appendChild(notes);
  host.appendChild(root);
  const g = canvas.getContext('2d');

  let mod = null, st = null, W = 0, H = 0, dpr = 1, band = null, raf = 0, running = false, t0 = 0, tNow = 0, lastCap = '', lastStep = null;
  const reduced = opts.reduced != null ? !!opts.reduced : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const env = () => ({ W, H, dpr, fill, reduced, view: band ? { x: 0, y: band.t, w: W, h: Math.max(80, H - band.t - band.b) } : { x: 0, y: 0, w: W, h: H } });

  function resize() {
    const r = host.getBoundingClientRect();
    // 240 as ENDS: a 320 px phone gives a card of about 270 px
    W = Math.max(240, Math.round((fill ? r.width : wrapEl.getBoundingClientRect().width) || r.width || 360));
    H = fill ? Math.max(220, Math.round(r.height || 400)) : Math.round(opts.height || (mod && mod.height ? mod.height(W) : Math.min(480, Math.max(300, W * 0.72))));
    dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if (mod && mod.layout) mod.layout(st, env());
    if (!running) frame(tNow);
  }
  function frame(t) {
    tNow = t;
    if (!mod) return;
    const tt = reduced ? t * 0.6 : t;
    tour(mod, st, tt);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (fill) {
      g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      const v = env().view, f = fitScene(mod, v.w, v.h);
      g.setTransform(dpr * f.s, 0, 0, dpr * f.s, dpr * (v.x + f.ox), dpr * (v.y + f.oy));
      mod.draw(g, { W: f.Wn, H: f.Hn, dpr: dpr * f.s, fill, reduced, view: { x: 0, y: 0, w: f.Wn, h: f.Hn } }, st, tt);
    } else mod.draw(g, env(), st, tt);
    if (st.step !== lastStep) { lastStep = st.step; buildControls(); }
    if (showCap || !fill) {
      const c = mod.caption ? mod.caption(st, tt) : '';
      if (c !== lastCap) {
        // a tour changes the line on its own: do not announce each change
        cap.setAttribute('aria-live', st.auto ? 'off' : 'polite');
        cap.textContent = c; lastCap = c; canvas.setAttribute('aria-label', mod.title + '. ' + c);
      }
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
    const groups = mod.controls ? mod.controls(st) : [{ key: 'step', label: 'Step', options: mod.steps.map(s => ({ v: s.id, label: s.label })) }];
    for (const group of groups) {
      const seg = document.createElement('div'); seg.className = 'rec-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', group.label);
      for (const o of group.options) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = o.label;
        if (o.title) b.title = o.title;
        if (!group.action) b.setAttribute('aria-pressed', String(st[group.key] === o.v));
        b.addEventListener('click', () => {
          if (group.action) { if (mod.onAction) mod.onAction(st, o.v, tNow); }
          else {
            st[group.key] = o.v;
            if (group.key === 'step') { st.auto = false; st.stepSince = tNow; }
            if (mod.onSet) mod.onSet(st, group.key, o.v, tNow);
          }
          buildControls(); if (!running) frame(tNow);
        });
        seg.appendChild(b);
      }
      ctl.appendChild(seg);
    }
    if (!st.auto && mod.steps.length > 1) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rec-tour'; b.textContent = 'Tour';
      b.title = 'Step through the scene again';
      b.addEventListener('click', () => { st.auto = true; st.since = tNow; buildControls(); });
      ctl.appendChild(b);
    }
  }
  function show(scene, params = {}) {
    if (!MODS[scene]) throw new Error('records: no scene ' + scene);
    mod = MODS[scene];
    st = mod.init(params || {});
    st.auto = params && params.step ? !!params.auto : true;
    st.step = (params && params.step) || mod.steps[0].id;
    st.since = tNow; st.stepSince = tNow;
    root.dataset.scene = scene;
    if (showNotes) {
      notes.innerHTML = '';
      const a = mod.analogy;
      for (const [k, txt] of [['right', 'What it gets right: '], ['breaks', 'Where it breaks: ']]) {
        const p = document.createElement('p'); p.className = 'rec-note ' + k;
        const b = document.createElement('b'); b.textContent = txt; p.appendChild(b); p.appendChild(document.createTextNode(a[k]));
        notes.appendChild(p);
      }
    }
    lastStep = null; lastCap = '';
    buildControls();
    resize();
  }
  // Pointer: taps, drags and (mouse) hover go to the scene.
  let drag = null;
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const redraw = () => { if (!running) frame(tNow); };
  canvas.addEventListener('pointerdown', e => {
    if (!mod || !mod.pointer) return;
    const p = pos(e);
    drag = { id: e.pointerId, x0: p.x, y0: p.y, moved: false };
    if (mod.pointer(st, 'down', p, env(), tNow)) redraw();
  });
  canvas.addEventListener('pointermove', e => {
    if (!mod || !mod.pointer) return;
    const p = pos(e);
    if (!drag) { if (e.pointerType === 'mouse' && mod.pointer(st, 'hover', p, env(), tNow)) redraw(); return; }
    if (e.pointerId !== drag.id) return;
    if (Math.hypot(p.x - drag.x0, p.y - drag.y0) > 8) drag.moved = true;
    if (drag.moved && mod.pointer(st, 'move', p, env(), tNow)) redraw();
  });
  const up = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = pos(e);
    if (mod.pointer && mod.pointer(st, drag.moved ? 'up' : 'tap', p, env(), tNow)) { buildControls(); redraw(); }
    drag = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && mod && mod.pointer && mod.pointer(st, 'leave', pos(e), env(), tNow)) redraw(); });
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
    setBand(b) { band = b && isFinite(b.t) && isFinite(b.b) ? { t: b.t, b: b.b } : null; if (mod && mod.layout) mod.layout(st, env()); redraw(); },
    dispose() { api.pause(); if (ro) ro.disconnect(); document.removeEventListener('visibilitychange', vis); root.remove(); },
    current() { return mod ? { scene: mod.id, step: st.step, auto: st.auto, sel: st.sel ?? null } : null; },
    scenes: SCENES, steps: STEPS, saverShots, canvas,
  };
  show(opts.scene || 'square', opts.params || {});
  if (opts.autoplay !== false && !fill) api.play();
  return api;
}
