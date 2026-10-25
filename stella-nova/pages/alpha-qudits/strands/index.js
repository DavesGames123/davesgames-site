// ============================================================================
//  STRANDS  ·  analogy 1 of the alpha-qudits page: entanglement as threads
// ----------------------------------------------------------------------------
//  The page explains A. D. Wissner-Gross, "A Parameter-Free Candidate for
//  the Fine-Structure Constant from Entangled Qudits" (23 October 2026).
//  This package draws the paper's pairs, swapping, reads, shared qudits and
//  its object (Theorem 1) as threads, the strand picture of the paper's
//  Sec. S7, in our own drawing. Every amplitude on a thread comes from a
//  state-vector contraction in quantum.js; tests.mjs checks them.
//
//  PUBLIC API (CONTRACT.md "STRANDS"):
//
//    createStrands(host, opts) -> {
//      show(scene, params)   switch scene; the clock restarts at 0
//      play(t)               CORE's per-frame call, t = on-screen seconds.
//                            The scene clock advances by the change in t;
//                            show() and the replay buttons restart it at 0.
//                            The first call stops the own rAF clock.
//      resize()              re-measure the host width and redraw
//      dispose()             stop the clock, drop listeners, remove the DOM
//      scenes                ['pair', 'swap', 'read', 'shared', 'object']
//      saverShots            shots.js SAVER_SHOTS (plain data, copies)
//      -- extras --
//      seek(x)               set the scene time to x seconds and draw
//      pause() / resume()    stop and restart the own rAF clock (CORE calls
//                            them on visibility change)
//      start() / stop()      the built-in clock (requestAnimationFrame)
//      renderShot            shots.js renderShot, for the saver canvas
//      analogy(scene)        text.js ANALOGY entry
//      get scene / params / time / step
//      element, canvas
//    }
//
//    host   a container element; the figure is appended to it
//    opts   { scene = 'pair', params, theme = 'dark' | 'light',
//             controls = true (44 px buttons under the canvas),
//             caption = true (step caption and the analogy note),
//             autoplay = true (own rAF clock until CORE calls play(t);
//             paused when off screen), reduced (default: the
//             prefers-reduced-motion query; true shows a still frame),
//             onStep(info) }
//
//  Scenes and params (scenes.js normParams clamps them):
//    pair    { d1, d2 } in 1..4, or { d, unequal }   Eq. (1), Fig. S1(a)
//    swap    { d } in 2..4                           Eq. (S1)
//    read    { link: 'qutrit-qubit' | 'qubit-qutrit' | 'qubit-qubit',
//              basis: 0..d }                         Corollary S3
//    shared  { k } in 1..4, copies 'auto' | 0 | 1    the copies of Sec. S1
//    object  { stage: 'auto' | 'knot' | 'strands' | 'paths' | 'terms' |
//              'weights' }                           Theorem 1, Eq. (S2)
//
//  MODEL: model-link.js imports ../model/index.js when it is there and
//  uses a stub until then (slots and N only).
//
//  Modules:
//    quantum.js ..... pair kets, MUBs, far states, Eq. (S1), Eq. (S2)
//    paint.js ....... threads, ends, beads, tags, clock hands (DOM-free)
//    scenes.js ...... the five scenes as frames of (params, t) (DOM-free)
//    text.js ........ analogy notes, step captions, TeX lines
//    shots.js ....... saver shots and renderShot (DOM-free)
//    model-link.js .. MODEL or the stub
//    tests.mjs ...... node checks (no browser)
//
//  EXPORTS   (jump with grep -n "<anchor>" index.js)
//    createStrands .. "export function createStrands"
//    controls ....... "function buildControls"
//    pointer ........ "function onPointer"
//    styles ......... "const CSS"
// ============================================================================
import { drawScene, normParams, pairLayout, termTiles, objectStageAt, SCENES } from './scenes.js';
import { THEMES } from './paint.js';
import { ANALOGY, STEPS } from './text.js';
import { SAVER_SHOTS, renderShot } from './shots.js';
import { loadModel, facts as modelFacts } from './model-link.js';

export { SAVER_SHOTS, renderShot, ANALOGY, STEPS };
export const SCENE_NAMES = ['pair', 'swap', 'read', 'shared', 'object'];

// The figure height as a fraction of its width, wide and narrow (< 480 px).
const ASPECT = {
  pair: [0.6, 0.98], swap: [0.6, 0.95], read: [0.64, 1.22], shared: [0.72, 1.02], object: [0.66, 1.3],
};

const CSS = `
.aq-strands{position:relative;width:100%;font-family:var(--sci-sans,Inter,system-ui,sans-serif);color:#ece8dc}
.aq-strands canvas{display:block;width:100%;border-radius:10px;touch-action:pan-y;cursor:default}
.aq-strands canvas.pluck{cursor:grab}
.aq-st-controls{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:10px 0 0}
.aq-st-group{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.aq-st-group>span{font-size:13px;color:#949aa8;margin-right:4px}
.aq-st-controls button{min-height:44px;min-width:44px;padding:0 12px;border-radius:8px;border:1px solid #3a4660;background:#121a2b;color:#ece8dc;font:inherit;font-size:14px;cursor:pointer}
.aq-st-controls button[aria-pressed="true"]{background:#2b2f5a;border-color:#a8a4ff;color:#fff}
.aq-st-controls button:focus-visible{outline:2px solid #a8a4ff;outline-offset:2px}
.aq-st-step{margin:8px 2px 0;font-size:14px;line-height:1.45;color:#c9c6bc;min-height:2.9em}
.aq-st-analogy{margin:6px 0 0;font-size:14px;line-height:1.5;color:#c9c6bc}
.aq-st-analogy summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:#a8a4ff}
.aq-st-analogy p{margin:6px 0}
.aq-st-analogy b{color:#ece8dc;font-weight:600}
.aq-st-analogy .src{font-size:12.5px;color:#949aa8}
.aq-strands.light{color:#1d2230}
.aq-strands.light .aq-st-controls button{background:#fff;border-color:#9aa4b6;color:#1d2230}
.aq-strands.light .aq-st-controls button[aria-pressed="true"]{background:#e6e4ff;border-color:#5a52d6}
.aq-strands.light .aq-st-step,.aq-strands.light .aq-st-analogy{color:#3a4050}
[hidden]{display:none!important}
`;

function injectCss(doc) {
  if (doc.getElementById('aq-strands-css')) return;
  const st = doc.createElement('style');
  st.id = 'aq-strands-css';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

export function createStrands(host, opts = {}) {
  const doc = host.ownerDocument || document;
  const win = doc.defaultView || window;
  injectCss(doc);
  const themeName = opts.theme === 'light' ? 'light' : 'dark';
  const th = THEMES[themeName];
  const root = doc.createElement('div');
  root.className = 'aq-strands' + (themeName === 'light' ? ' light' : '');
  const canvas = doc.createElement('canvas');
  canvas.setAttribute('role', 'img');
  root.appendChild(canvas);
  const controls = doc.createElement('div');
  controls.className = 'aq-st-controls';
  if (opts.controls !== false) root.appendChild(controls);
  const stepEl = doc.createElement('p');
  stepEl.className = 'aq-st-step';
  stepEl.setAttribute('aria-live', 'polite');
  const note = doc.createElement('details');
  note.className = 'aq-st-analogy';
  if (opts.caption !== false) { root.appendChild(stepEl); root.appendChild(note); }
  host.appendChild(root);

  const reduce = opts.reduced != null ? !!opts.reduced
    : !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const st = {
    scene: 'pair', params: {}, t: 0, step: -1, w: 0, h: 0, dpr: 1,
    running: false, visible: true, raf: 0, last: 0, plucks: [], focus: null, info: null,
    ext: 0, base: 0, external: false, paused: false,
    facts: modelFacts(null), disposed: false,
  };
  const g = canvas.getContext('2d');

  loadModel().then(link => { if (!st.disposed) { st.facts = modelFacts(link); draw(); } });

  function measureHost() {
    const w = Math.max(240, Math.round(root.clientWidth || host.clientWidth || 640));
    const asp = ASPECT[st.scene][w < 480 ? 1 : 0];
    const h = Math.round(Math.max(260, Math.min(620, w * asp)));
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    if (w !== st.w || h !== st.h || dpr !== st.dpr) {
      st.w = w; st.h = h; st.dpr = dpr;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.height = h + 'px';
    }
  }

  function rect() { return { x: 0, y: 0, w: st.w, h: st.h }; }

  function draw() {
    if (st.disposed || !g) return;
    if (!st.w) measureHost();
    g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    g.clearRect(0, 0, st.w, st.h);
    const info = drawScene(g, st.scene, st.params, st.t, rect(), { th, live: { plucks: st.plucks }, facts: st.facts, focus: st.focus });
    st.info = info;
    if (info.step !== st.step) {
      st.step = info.step;
      const list = STEPS[st.scene];
      const s = list[Math.min(list.length - 1, info.step)];
      stepEl.textContent = s ? s.caption : '';
      canvas.setAttribute('aria-label', `${ANALOGY[st.scene].title}. ${s ? s.caption : ''}`);
      syncPressed();
      if (typeof opts.onStep === 'function') opts.onStep({ scene: st.scene, ...info });
    }
  }

  function frame(now) {
    st.raf = 0;
    if (!st.running || st.disposed) return;
    const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 0;
    st.last = now;
    if (st.visible) { st.ext += dt; st.t = st.ext - st.base; draw(); }
    st.raf = win.requestAnimationFrame(frame);
  }

  // The scene clock is st.t = st.ext - st.base. st.ext is the raw clock:
  // CORE's on-screen seconds (play(t)) or the own rAF clock. seek(x) moves
  // st.base so that the scene time is x now.
  function seek(x) { st.base = st.ext - x; st.t = x; }

  function start() {
    if (st.running || st.disposed || st.external || st.paused) return;
    st.running = true; st.last = 0;
    st.raf = win.requestAnimationFrame(frame);
  }
  function stop() {
    st.running = false;
    if (st.raf) win.cancelAnimationFrame(st.raf);
    st.raf = 0;
  }

  // ---- note --------------------------------------------------------------
  function writeNote() {
    const a = ANALOGY[st.scene];
    note.textContent = '';
    const sm = doc.createElement('summary');
    sm.textContent = 'What the threads get right, and where they break';
    const p1 = doc.createElement('p'), b1 = doc.createElement('b');
    b1.textContent = 'Right: '; p1.append(b1, a.right);
    const p2 = doc.createElement('p'), b2 = doc.createElement('b');
    b2.textContent = 'Breaks: '; p2.append(b2, a.breaks);
    const p3 = doc.createElement('p');
    p3.className = 'src'; p3.textContent = 'In the paper: ' + a.source;
    note.append(sm, p1, p2, p3);
  }

  // ---- controls ----------------------------------------------------------
  const pressed = [];
  function btn(label, onClick, isOn, title) {
    const b = doc.createElement('button');
    b.type = 'button'; b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', () => { onClick(); syncPressed(); });
    if (isOn) { pressed.push([b, isOn]); b.setAttribute('aria-pressed', String(!!isOn())); }
    return b;
  }
  function group(label, ...els) {
    const gEl = doc.createElement('div');
    gEl.className = 'aq-st-group';
    gEl.setAttribute('role', 'group');
    if (label) { const s = doc.createElement('span'); s.textContent = label; gEl.appendChild(s); gEl.setAttribute('aria-label', label); }
    gEl.append(...els);
    return gEl;
  }
  function syncPressed() { for (const [b, f] of pressed) b.setAttribute('aria-pressed', String(!!f())); }
  function setP(patch, keepTime) {
    st.params = normParams(st.scene, { ...st.params, ...patch }).params;
    if (!keepTime) seek(0);
    st.step = -1; st.focus = null;
    measureHost(); draw();
  }

  function buildControls() {
    controls.textContent = '';
    pressed.length = 0;
    const P = () => st.params;
    if (st.scene === 'pair') {
      const step = (key, dv) => setP({ [key]: P()[key] + dv }, true);
      controls.append(
        group('left end d', btn('−', () => step('d1', -1), null, 'smaller left end'), btn('+', () => step('d1', 1), null, 'larger left end')),
        group('right end d', btn('−', () => step('d2', -1), null, 'smaller right end'), btn('+', () => step('d2', 1), null, 'larger right end')),
        group('', btn('qutrit and qubit', () => setP({ d1: 3, d2: 2 }, true), () => P().d1 === 3 && P().d2 === 2),
          btn('two qutrits', () => setP({ d1: 3, d2: 3 }, true), () => P().d1 === 3 && P().d2 === 3)),
      );
    } else if (st.scene === 'swap') {
      controls.append(
        group('d', ...[2, 3, 4].map(d => btn(String(d), () => setP({ d }), () => P().d === d))),
        group('', btn('replay', () => { seek(0); draw(); })),
      );
    } else if (st.scene === 'read') {
      const links = [['qutrit-qubit', 'read at the qutrit'], ['qubit-qutrit', 'read at the qubit'], ['qubit-qubit', 'two qubits']];
      const dr = { 'qutrit-qubit': 3, 'qubit-qutrit': 2, 'qubit-qubit': 2 }[P().link];
      const names = dr === 2 ? ['Z', 'X', 'Y'] : ['1', '2', '3', '4'];
      controls.append(
        group('link', ...links.map(([k, l]) => btn(l, () => { setP({ link: k, basis: 0 }); buildControls(); }, () => P().link === k))),
        group('basis', ...names.map((n, i) => btn(n, () => setP({ basis: i }), () => P().basis === i))),
      );
    } else if (st.scene === 'shared') {
      controls.append(
        group('links', ...[1, 2, 3, 4].map(k => btn(String(k), () => setP({ k }, true), () => P().k === k))),
        group('', btn('one qudit', () => setP({ copies: 0 }, true), () => P().copies === 0),
          btn('copies', () => setP({ copies: 1 }, true), () => P().copies === 1),
          btn('play all', () => setP({ copies: 'auto' }), () => P().copies === 'auto')),
        group('', btn('exchange', () => { st.params = { ...st.params, copies: 'auto' }; seek(4.8); st.step = -1; draw(); syncPressed(); })),
      );
    } else if (st.scene === 'object') {
      const stages = [['auto', 'play all'], ['knot', 'object'], ['strands', 'strands'], ['paths', 'routes'], ['terms', '12 terms'], ['weights', 'mirrors']];
      controls.append(group('', ...stages.map(([k, l]) => btn(l, () => setP({ stage: k }), () => P().stage === k))));
    }
  }

  // ---- pointer -----------------------------------------------------------
  let lastPluck = -1;
  function local(e) {
    const b = canvas.getBoundingClientRect();
    return { x: (e.clientX - b.left) * (st.w / (b.width || st.w)), y: (e.clientY - b.top) * (st.h / (b.height || st.h)) };
  }
  function onPointer(e) {
    const q = local(e);
    if (st.scene === 'pair') {
      const L = pairLayout(rect(), st.params);
      const inBand = q.y > L.band.y0 && q.y < L.band.y1 && q.x > L.A.x && q.x < L.B.x;
      if (!inBand) return;
      if (e.type === 'pointermove' && !(e.buttons & 1) && e.pointerType === 'mouse') return;
      if (st.t - lastPluck < 0.12 && e.type === 'pointermove') return;
      lastPluck = st.t;
      const amp = Math.max(-L.sp * 1.3, Math.min(L.sp * 1.3, (q.y - L.cy) * 0.9 || L.sp * 0.8));
      st.plucks.push({ t0: st.t, amp });
        if (st.plucks.length > 6) st.plucks.shift();
      if (!st.running && !st.external) { start(); }
      draw();
    } else if (st.scene === 'object' && e.type === 'pointerdown') {
      const { stage } = objectStageAt(st.params, st.t);
      if (stage !== 'terms') return;
      const hit = termTiles(rect(), 12).find(b => q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h);
      if (hit) {
        if (st.params.stage === 'auto') { st.params = { ...st.params, stage: 'terms' }; seek(2.2); syncPressed(); }
        st.focus = hit.k; draw();
      }
    }
  }
  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('pointermove', onPointer);

  // ---- visibility and size -----------------------------------------------
  let io = null, ro = null;
  if (win.IntersectionObserver) {
    io = new win.IntersectionObserver(es => { for (const en of es) st.visible = en.isIntersecting; if (st.visible) st.last = 0; });
    io.observe(root);
  }
  if (win.ResizeObserver) {
    ro = new win.ResizeObserver(() => { const w = st.w; measureHost(); if (st.w !== w) draw(); });
    ro.observe(root);
  }

  function show(scene, params = {}) {
    const n = normParams(scene, params);
    st.scene = n.name; st.params = n.params;
    seek(reduce ? (STILL[st.scene] || 0) : 0); st.step = -1; st.plucks = []; st.focus = null;
    canvas.classList.toggle('pluck', st.scene === 'pair');
    writeNote();
    buildControls();
    measureHost(); draw();
    return api;
  }

  // a still frame for reduced motion: the most telling moment of each scene
  const STILL = { pair: 2.2, swap: 9.5, read: 1.9, shared: 4.6, object: 3 };

  const api = {
    show,
    play(t) {
      // CORE calls play(t) each frame with its on-screen seconds; the first
      // call hands the clock over from the own rAF loop.
      const x = Number.isFinite(+t) ? +t : 0;
      if (!st.external) { st.external = true; stop(); st.base += x - st.ext; }
      else if (x < st.ext) st.base += x - st.ext; // CORE's clock went back: keep the scene time
      if (reduce) st.base += x - st.ext; // reduced motion: hold the still frame
      st.ext = x; st.t = st.ext - st.base; draw(); return api;
    },
    seek(x) { seek(Number.isFinite(+x) ? +x : 0); draw(); return api; },
    pause() { st.paused = true; stop(); return api; },
    resume() { st.paused = false; st.last = 0; if (!reduce && opts.autoplay !== false) start(); return api; },
    resize() { measureHost(); draw(); return api; },
    dispose() {
      st.disposed = true; stop();
      if (io) io.disconnect(); if (ro) ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointer);
      canvas.removeEventListener('pointermove', onPointer);
      root.remove();
    },
    start, stop, renderShot,
    analogy: s => ANALOGY[s || st.scene],
    scenes: SCENE_NAMES.slice(),
    saverShots: SAVER_SHOTS.map(s => ({ ...s, params: { ...s.params } })),
    get scene() { return st.scene; },
    get params() { return { ...st.params }; },
    get time() { return st.t; },
    get step() { return st.info; },
    element: root, canvas,
  };

  show(opts.scene || 'pair', opts.params || {});
  if (!reduce && opts.autoplay !== false) start();
  void SCENES;
  return api;
}
