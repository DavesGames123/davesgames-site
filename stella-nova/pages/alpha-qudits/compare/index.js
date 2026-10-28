// ============================================================================
//  ALPHA QUDITS  ·  compare/index.js  ·  the COMPARE figures  (package COMPARE)
// ----------------------------------------------------------------------------
//  Chapter 0 (the digits), chapter 9 (the ruler, analogy 5: a
//  correspondence of roles) and chapter 10 (analogy 6: dials over Table
//  S5, the look-elsewhere lab, the history). Every scene is a 2D canvas
//  drawn by a DOM-free module in scenes/, plus 44 px controls and a short
//  live text that this file builds. Numbers come from MODEL through
//  data.js; before MODEL loads, a stub with the CONTRACT values draws the
//  ruler and the digits.
//
//  API
//    createCompare(host, opts) -> {
//      show(scene, params)  switch scene; params per scene (see SCENES)
//      play(t)              a number: draw one frame at t seconds (CORE
//                           calls it each frame while on screen). It stops
//                           the own loop. No argument: run the own loop.
//      pause(), resume()    stop and restart the own loop
//      resize()             read the host width again
//      setBand(band)        { t, b } px clear of the saver plate, or null
//      dispose()            remove the DOM and the listeners
//      scenes, saverShots, canvas, current(), ready (Promise: MODEL loaded)
//    }
//    opts: { scene, params, reduced, fill (canvas fills the host; no
//            controls, no text: the saver), controls (default true),
//            text (default true: live caption and the info block),
//            autoplay (default true), height (px), notes (accepted and
//            ignored: CORE's story writes the analogy notes) }
//
//  SCENES and their params
//    ruler ......... { z: 0..1 | preset: whole|milli|micro|nano, auto }
//    digits ........ {}
//    dials ......... { key: a Table S5 key | 'computed', tour }
//    lookElsewhere . { coeff: 30|60|100|160, den: smooth|all|all100k,
//                      win: 1|3, autorun }
//    roles ......... { role: index | id of ROLES, auto }
//    history ....... { step: index | eddington|wyler|rejoinders|
//                      measurements|candidate, auto }
//
//  SAVER
//    saverShots: [{ id, scene, params, t0, seconds, title, caption, tex,
//    aspect }]. renderShot(g, shot, t, box, { calm }) draws a shot into any
//    2D context with no DOM (box = the clear band). prepare() loads MODEL.
//
//  FILES
//    index.js ... this API, the DOM shell, the loop, saverShots
//    data.js .... MODEL link, stub, formatting (DOM-free)
//    draw.js .... palette and canvas helpers (DOM-free)
//    style.js ... the CSS of the shell (injected once)
//    scenes/ .... ruler, digits, dials, look, roles, history (DOM-free)
//    tests.mjs .. node tests
//
//  GREP MAP   (grep -n "<anchor>" index.js)
//    export const SCENES / export const saverShots / export function renderShot
//    export function createCompare / function makeUI / function frame
// ============================================================================
import ruler from './scenes/ruler.js';
import digits from './scenes/digits.js';
import dials from './scenes/dials.js';
import look from './scenes/look.js';
import roles from './scenes/roles.js';
import history from './scenes/history.js';
import { CSS } from './style.js';
import { facts, loadModel } from './data.js';

const MODS = { ruler, digits, dials, lookElsewhere: look, roles, history };
export const SCENES = Object.keys(MODS);
export { MODS as SCENE_MODULES };

export const saverShots = [
  { id: 'cmp-ruler-zoom', scene: 'ruler', params: { auto: true }, t0: 0, seconds: 11, aspect: 1.6,
    title: 'Against the measurements', caption: 'Zoom from 137 to the ninth decimal: four measured values with one-sigma bars, and the candidate line.',
    tex: '\\alpha^{-1}_{\\mathrm{cand}} = 137.035\\,999\\,189\\,566\\ldots' },
  { id: 'cmp-ruler-deep', scene: 'ruler', params: { z: 1 }, t0: 0, seconds: 8, aspect: 1.6,
    title: 'Between rubidium and the electron moment', caption: 'The candidate lies 0.60 sigma from CODATA 2022, between the two most precise determinations.',
    tex: '\\frac{\\alpha^{-1}_{\\mathrm{cand}}-\\alpha^{-1}_{\\mathrm{CODATA}}}{\\sigma} = +0.60' },
  { id: 'cmp-digits', scene: 'digits', params: {}, t0: 0, seconds: 11, aspect: 1.3,
    title: 'Every digit fixed in advance', caption: 'Sixty decimals from the exact form; the measurements stop at the ninth.',
    tex: '\\alpha_{\\mathrm{cand}} = \\frac{79+48\\sqrt{2}+42\\sqrt{3}+3\\sqrt{6}}{31104}' },
  { id: 'cmp-dials-tour', scene: 'dials', params: { tour: true }, t0: 0, seconds: 12, aspect: 1.9,
    title: 'Flip a clause', caption: 'Each alternative of Table S5 moves the number far off 137.036.',
    tex: '\\alpha^{-1}_{\\text{Born}} = \\frac{31104}{319} = 97.505' },
  { id: 'cmp-dials-swap', scene: 'dials', params: { key: 'endsSwapped' }, t0: 0, seconds: 7, aspect: 1.9,
    title: 'The two ends swapped', caption: 'The end rule excludes it; it lands within one percent.',
    tex: '\\frac{79+42\\sqrt{2}+48\\sqrt{3}+3\\sqrt{6}}{31104} = \\frac{1}{135.894}' },
  { id: 'cmp-look', scene: 'lookElsewhere', params: { coeff: 50, den: 'all' }, t0: 0, seconds: 9, aspect: 1.6,
    title: 'Look elsewhere', caption: 'With free integers and any denominator, numbers of this shape fill the window at the density one expects.',
    tex: '\\#\\left\\{\\tfrac{a+b\\sqrt{2}+c\\sqrt{3}+d\\sqrt{6}}{D}\\ \\text{in the window}\\right\\}\\ \\text{vs.}\\ \\lambda' },
  { id: 'cmp-roles', scene: 'roles', params: { auto: true }, t0: 0, seconds: 12, aspect: 1.9,
    title: 'A correspondence of roles', caption: 'On-shell QED beside the model, role by role. No record is a Feynman diagram.',
    tex: '\\alpha(0) = Z_3\\,\\alpha_{\\mathrm{bare}} \\quad\\longleftrightarrow\\quad \\langle M\\rangle = \\frac{\\operatorname{tr}_R M}{N}' },
  { id: 'cmp-roles-dress', scene: 'roles', params: { role: 'dress' }, t0: 0, seconds: 7, aspect: 1.9,
    title: 'Dressing', caption: 'Vacuum polarization on one side; the records with weights on the other.',
    tex: '\\frac{G_{\\mathrm{dressed}}}{G_{\\mathrm{bare}}} = \\frac{1}{N}\\sum_{r=1}^{172}\\sqrt{k_r}' },
  { id: 'cmp-history-wyler', scene: 'history', params: { step: 'wyler' }, t0: 0, seconds: 8, aspect: 1.6,
    title: 'Wyler, 1969', caption: 'A closed form is a line that cannot move; the measurements moved past it.',
    tex: '\\alpha_W = \\frac{9}{8\\pi^4}\\left(\\frac{\\pi^5}{2^4\\,5!}\\right)^{1/4}' },
  { id: 'cmp-history-now', scene: 'history', params: { step: 'candidate' }, t0: 0, seconds: 8, aspect: 1.6,
    title: 'The 2026 candidate', caption: 'A conjecture with no width: each new digit of measurement tests it.',
    tex: '\\alpha^{-1}_{\\mathrm{cand}} = 137.035\\,999\\,189\\,566\\,155\\ldots' },
];

export const prepare = () => loadModel();

// ------------------------------------------------------------- saver render
const shotStates = new Map();
export function renderShot(g, shot, t, box, opts = {}) {
  const mod = MODS[shot.scene];
  if (!mod) return;
  let st = shotStates.get(shot.id);
  if (!st) { st = mod.init({ params: shot.params, reduced: false, fill: true }); shotStates.set(shot.id, st); }
  const k = opts.calm ? 0.6 : 1;
  mod.draw(g, { x: box.x, y: box.y, w: box.w, h: box.h, fill: true }, (shot.t0 || 0) + t * k, st, facts());
}

// ------------------------------------------------------------- DOM shell
function injectCSS(doc) {
  if (doc.getElementById('cmp-css')) return;
  const s = doc.createElement('style'); s.id = 'cmp-css'; s.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(s);
}

// The control builder handed to a scene's controls(st, ui, F).
function makeUI(doc, ctl, redraw) {
  const buttons = [];
  const ui = {
    group(label, o = {}) {
      const g = doc.createElement('div'); g.className = 'cmp-grp' + (o.stack ? ' stack' : '');
      g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
      const l = doc.createElement('span'); l.className = 'cmp-gl'; l.textContent = label; g.appendChild(l);
      const seg = doc.createElement('div'); seg.className = 'cmp-seg'; g.appendChild(seg);
      ctl.appendChild(g);
      return seg;
    },
    button(seg, label, onClick, o = {}) {
      const b = doc.createElement('button'); b.type = 'button';
      if (o.wide) b.className = 'wide';
      const main = doc.createElement('span'); main.textContent = label; b.appendChild(main);
      if (o.sub) { const s = doc.createElement('span'); s.className = 'cmp-bs'; s.textContent = o.sub; b.appendChild(s); }
      if (o.aria) b.setAttribute('aria-label', o.aria);
      if (o.pressed) b.setAttribute('aria-pressed', String(!!o.pressed()));
      b.addEventListener('click', onClick);
      seg.appendChild(b);
      buttons.push({ b, pressed: o.pressed });
      return b;
    },
    hint(s) { const p = doc.createElement('p'); p.className = 'cmp-hint'; p.textContent = s; ctl.appendChild(p); },
    sync() { for (const x of buttons) if (x.pressed) x.b.setAttribute('aria-pressed', String(!!x.pressed())); },
    redraw,
  };
  return ui;
}

export function createCompare(host, opts = {}) {
  const doc = host.ownerDocument || document;
  const win = doc.defaultView || globalThis;
  injectCSS(doc);
  const fill = !!opts.fill, reduced = !!opts.reduced;
  const showControls = !fill && opts.controls !== false, showText = !fill && opts.text !== false;
  const root = doc.createElement('div');
  root.className = 'cmp-fig' + (fill ? ' cmp-fill' : '');
  const wrap = doc.createElement('div'); wrap.className = 'cmp-canvas';
  const cv = doc.createElement('canvas'); wrap.appendChild(cv);
  root.appendChild(wrap);
  const cap = doc.createElement('p'); cap.className = 'cmp-cap'; cap.setAttribute('aria-live', 'polite');
  const ctl = doc.createElement('div'); ctl.className = 'cmp-ctl';
  const info = doc.createElement('div'); info.className = 'cmp-info';
  if (showText) root.appendChild(cap);
  if (showControls) root.appendChild(ctl);
  if (showText) root.appendChild(info);
  host.appendChild(root);
  const g = cv.getContext('2d');

  const states = new Map();
  let scene = MODS[opts.scene] ? opts.scene : 'ruler';
  let T = 0, driven = false, raf = 0, paused = false, last = 0, band = null, disposed = false;
  let W = 0, H = 0, dpr = 1, capText = '', infoText = '', ui = null;

  const stateOf = (id, params) => {
    if (!states.has(id)) states.set(id, MODS[id].init({ params, reduced, fill }));
    else if (params) MODS[id].show(states.get(id), params);
    return states.get(id);
  };

  function measure() {
    const r = host.getBoundingClientRect ? host.getBoundingClientRect() : { width: 0, height: 0 };
    // 240 as ENDS: a 320 px phone gives a card of about 270 px
    W = Math.max(240, Math.round(r.width || host.clientWidth || 360));
    H = fill ? Math.max(200, Math.round(r.height || host.clientHeight || 400)) : Math.round(opts.height || MODS[scene].height(W, states.get(scene)));
    dpr = Math.min(2, win.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.height = H + 'px';
  }

  function frame(t) {
    if (disposed || !g) return;
    const mod = MODS[scene], st = states.get(scene), F = facts();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const box = band && fill ? { x: 0, y: band.t, w: W, h: Math.max(160, H - band.t - band.b), fill } : { x: 0, y: 0, w: W, h: H, fill };
    try { mod.draw(g, box, t, st, F); } catch (e) { console.warn('alpha-qudits compare: draw', scene, e); }
    if (showText) {
      const c = mod.caption ? mod.caption(st, F) : '';
      if (c !== capText) { capText = c; cap.textContent = c; }
      const i = mod.info ? mod.info(st, F) : '';
      if (i !== infoText) { infoText = i; info.innerHTML = i; }
    }
    if (ui) ui.sync();
  }
  const redraw = () => frame(T);

  function buildControls() {
    if (!showControls) return;
    ctl.replaceChildren();
    ui = makeUI(doc, ctl, redraw);
    const mod = MODS[scene];
    if (mod.controls) mod.controls(states.get(scene), ui, facts());
  }

  function loop(now) {
    raf = 0;
    if (driven || paused || disposed) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (!reduced) T += dt;
    frame(T);
    raf = win.requestAnimationFrame ? win.requestAnimationFrame(loop) : 0;
  }
  function startLoop() { if (!raf && !driven && !paused && win.requestAnimationFrame && opts.autoplay !== false) { last = 0; raf = win.requestAnimationFrame(loop); } }
  function stopLoop() { if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf); raf = 0; }

  // pointer: forwarded to the scene (the ruler zooms on a sideways drag)
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onPtr = type => e => {
    const mod = MODS[scene]; if (!mod.pointer) return;
    const p = pt(e);
    if (type === 'down' && cv.setPointerCapture) try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (mod.pointer(states.get(scene), { type, x: p.x, y: p.y }, { x: 0, y: 0, w: W, h: H })) redraw();
  };
  const hDown = onPtr('down'), hMove = onPtr('move'), hUp = onPtr('up');
  if (!fill) { cv.addEventListener('pointerdown', hDown); cv.addEventListener('pointermove', hMove); cv.addEventListener('pointerup', hUp); cv.addEventListener('pointercancel', hUp); }

  stateOf(scene, opts.params);
  measure();
  buildControls();
  frame(0);
  startLoop();

  const ready = loadModel().then(m => {
    if (disposed) return m;
    buildControls();           // the dials need MODEL's Table S5 rows
    frame(T);
    return m;
  });

  const inst = {
    scenes: SCENES, saverShots, canvas: cv, ready,
    current: () => ({ scene, params: states.get(scene) }),
    show(id, params) {
      if (!MODS[id]) return inst;
      const changed = id !== scene;
      scene = id;
      stateOf(id, params);
      if (changed) { measure(); buildControls(); capText = ''; infoText = ''; }
      frame(T);
      return inst;
    },
    play(t) {
      if (typeof t === 'number') { driven = true; stopLoop(); T = t; frame(T); return; }
      driven = false; paused = false; startLoop();
    },
    pause() { paused = true; stopLoop(); },
    resume() { paused = false; startLoop(); if (driven) frame(T); },
    resize() { measure(); frame(T); },
    setBand(b) { band = b && isFinite(b.t) && isFinite(b.b) ? { t: b.t, b: b.b } : null; frame(T); },
    dispose() {
      disposed = true; stopLoop();
      const st = states.get('lookElsewhere'); if (st && st.job) try { st.job.cancel(); } catch (e) { /* ignore */ }
      cv.removeEventListener('pointerdown', hDown); cv.removeEventListener('pointermove', hMove); cv.removeEventListener('pointerup', hUp); cv.removeEventListener('pointercancel', hUp);
      root.remove();
    },
  };
  return inst;
}
