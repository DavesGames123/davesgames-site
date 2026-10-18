// ============================================================================
//  TENSOR CALCULUS  ·  main.js  ·  the page shell and integrator  (CORE)
// ----------------------------------------------------------------------------
//  main.js builds the page from the packages (CONTRACT.md): MATH
//  (tensor/), LIBRARY (library/), VIZ (viz/), DIAGRAM (diagram/) and LEARN
//  (learn/). ui/packages.js loads each one by itself, so a package that is
//  missing gives a note in its view and the rest of the page still works.
//
//  ONE CLOCK. The step player (ui/player.js) owns the time line of the
//  OpTrace on screen. Each frame, frame() moves the clock and calls
//  play(step, t) on the TeX view, the 3D view and the diagram with the same
//  step and t. A scrub, a step-list tap or a key press moves the same clock.
//
//  ONE COLOUR PER INDEX. When a trace loads, playTrace() calls palette
//  setActive() with every index letter of every step, in order of first
//  use. So a letter keeps its colour for the whole trace, in all views.
//
//  BOOT ORDER  (grep -n 'function boot')
//    1. installStub(window): window.tensorPage queues calls at once
//    2. loadPackages(): MATH, LIBRARY, VIZ, DIAGRAM, LEARN
//    3. the views: TeX (ui/tex-view.js), VIZ createViz, DIAGRAM createDiagram
//    4. the player, the layout, the panels, the lens, the phone dock
//    5. attach(): the real API replaces the stub and runs the queue
//    6. the first content: #entry=<id>, #learn/<chapter>/<beat> (LEARN
//       reads it) or #chapter=<id> in the URL, else
//       the first entry of the first learning path, played at once
//    7. SAVER SEAM: import saver/index.js; installSaver(api, internals)
//
//  window.tensorPage  (ui/page-api.js has the full list)
//    openEntry(id, params) · playTrace(trace, opts) · setView(spec) ·
//    setScene(id, params) · pickIndex(sym) · showExpr(texOrExpr) ·
//    seek(i, t) · pause() · resume() · follow() · state() · on(event, fn)
//
//  GREP MAP
//    grep -n 'function boot'        the boot order
//    grep -n 'function openEntry'   load a library entry in all views
//    grep -n 'function playTrace'   load a trace; colours; step list
//    grep -n 'function setView'     layout changes (ui/layout.js)
//    grep -n 'function pickIndex'   the Indices lens across views
//    grep -n 'function frame'       the frame loop and the one clock
//    grep -n 'function resolveScene' LIBRARY scene ids -> VIZ scene ids
//    grep -n 'SAVER SEAM'           where saver/index.js plugs in
//    grep -n 'function bindKeys'    keyboard: space, arrows, 1-4, Escape
//    grep -n 'function applyFit'    sizes: data-device, data-shape,
//                                   data-head, data-fit (ui/fit-layout.js)
//    grep -n 'function fitTex'      the equation scale (--tex-k)
// ============================================================================
import { installStub, attach } from './ui/page-api.js';
import { loadPackages } from './ui/packages.js';
import { initialLayout, reduce, applyLayout, VIEWS, STYLES } from './ui/layout.js';
import { createPlayer, SPEEDS } from './ui/player.js';
import { createTexView, exprSyms } from './ui/tex-view.js';
import { createLibraryBrowser } from './ui/library-browser.js';
import { createPlayground } from './ui/playground.js';
import { createLearnMenu } from './ui/learn-menu.js';
import { renderLens, symsFromSlot, symLabel } from './ui/lens.js';
import { createPhone } from './ui/phone.js';
import { planLayout, stageShape, headLevel, playerLevel, texScale } from './ui/fit-layout.js';
import { renderCredits } from './ui/credits.js';
import { createSceneControls } from './ui/scene-controls.js';
import { scriptIndices, plainLabel } from './ui/tex-color.js';
import * as palette from './palette.js';

// Scene ids that LIBRARY and LEARN use, and the VIZ id for each when the
// two lists differ. resolveScene() also tries a word match.
export const SCENE_ALIAS = Object.freeze({
  'vector-covector': 'upper-lower', 'upper-lower': 'vector-covector',
  'basis-dual': 'dual-basis', 'dual-basis': 'basis-dual',
  'rank2-transform': 'transform-rank2', 'transform-rank2': 'rank2-transform',
  'contraction-block': 'contraction', 'component-cube': 'rank3-cube',
  'metric-ellipses': 'metric-field', 'curvilinear-grid': 'curvilinear',
  'geodesics': 'geodesic-deviation', 'flamm-paraboloid': 'flamm',
  'levi-civita-cube': 'levi-civita', 'christoffel-basis': 'christoffel',
  'lorentz-boost': 'lorentz', 'stress-cube': 'stress', 'inertia-ellipsoid': 'inertia',
});

export function resolveScene(id, available) {
  if (!id) return null;
  const list = available || [];
  if (!list.length || list.includes(id)) return id;
  const a = SCENE_ALIAS[id];
  if (a && list.includes(a)) return a;
  const words = s => new Set(String(s).split(/[-_ ]+/).filter(w => w.length > 2));
  const w = words(id);
  let best = null, score = 0;
  for (const s of list) {
    let n = 0; for (const x of words(s)) if (w.has(x) || [...w].some(y => y.startsWith(x) || x.startsWith(y))) n++;
    if (n > score) { score = n; best = s; }
  }
  return best || id;
}

// Every index letter of a trace, in order of first use.
export function traceSyms(trace, math) {
  const out = [];
  const add = s => { if (s && !out.includes(s)) out.push(s); };
  for (const st of (trace && trace.steps) || []) {
    exprSyms(st.before, math).forEach(add);
    exprSyms(st.after, math).forEach(add);
    (st.focus || []).forEach(add);
  }
  return out;
}

function nullView(note) {
  return { note, setScene() {}, play() {}, pickIndex() {}, resize() {}, setTime() {}, show() {}, setStyle() {}, scenes: [], saverShots: [], dispose() {} };
}

// opts (tests): { doc, win, importer, typeset, raf, now, autostart }
export async function boot(opts = {}) {
  const doc = opts.doc || document;
  const win = opts.win || window;
  const $ = id => doc.getElementById(id);
  const stub = installStub(win);
  const typeset = opts.typeset || (await import('../../lib/sci-math.js')).typeset;
  const pk = await loadPackages(opts.importer);
  const M = pk.math, lib = pk.library;
  if (pk.missing.length && win.console) win.console.info('[tensor-calculus] packages not loaded:', pk.missing);

  // ---------------------------------------------------------------- state
  const S = {
    ready: false, entryId: null, layout: initialLayout(), scene: { id: null, params: {} },
    pickedIndex: null, trace: null, chapter: null, dim: 3, speed: 1,
    // vizFree: a scene that the reader or tensorPage.setScene() chose. VIZ
    // then gets no play(step, t) until the next trace (or "Follow").
    vizFree: false,
  };
  const listeners = new Map();
  const emit = (ev, data) => { for (const fn of listeners.get(ev) || []) try { fn(data); } catch (e) { win.console && win.console.error(e); } };
  const on = (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); };

  // ---------------------------------------------------------------- views
  const panes = { tex: $('paneTex'), viz: $('paneViz'), diagram: $('paneDiagram') };
  const stage = $('stage');
  const tex = createTexView({
    host: $('texBody'), label: $('texStepLabel'), before: $('texBefore'), op: $('texOp'), opName: $('texOpName'),
    after: $('texAfter'), sum: $('texSum'), numeric: $('texNumeric'), info: $('texIndexInfo'),
  }, { typeset, math: M, dim: () => S.dim, onTypeset: () => fitSoon() });

  const pickFromView = sym => pickIndex(sym && S.pickedIndex === palette.norm(sym) ? null : sym);
  // DIAGRAM calls onPickIndex(sym | null) itself after its own toggle.
  const viewOpts = { palette, onPick: pickFromView, onPickIndex: sym => pickIndex(sym), indexColor: palette.indexColor, indexRGB: palette.indexRGB, math: M };

  let viz = nullView('The 3D package has not loaded.');
  if (pk.viz && pk.viz.createViz) {
    // externalClock: the VIZ scene clock follows frame() below.
    try { viz = pk.viz.createViz($('vizCanvas'), { ...viewOpts, externalClock: true }) || viz; }
    catch (e) { viz = nullView('The 3D view did not start: ' + e.message); }
  }
  if (viz.note) { const fb = $('vizFallback'); fb.hidden = false; fb.textContent = viz.note; }

  let diagram = nullView('The Penrose diagram package has not loaded.');
  if (pk.diagram && pk.diagram.createDiagram) {
    try { diagram = pk.diagram.createDiagram($('diagHost'), { ...viewOpts, style: S.layout.style }) || diagram; }
    catch (e) { diagram = nullView('The Penrose diagram did not start: ' + e.message); }
  }
  if (diagram.note) { const fb = $('diagFallback'); fb.hidden = false; fb.textContent = diagram.note; }

  // A view call that throws must not stop the other views or the clock. A
  // frame error repeats each frame, so each message is logged once.
  const warned = new Set();
  const safe = (name, fn) => {
    try { return fn(); }
    catch (e) {
      const key = name + ':' + (e && e.message);
      if (!warned.has(key) && warned.size < 50) { warned.add(key); if (win.console) win.console.warn(`[tensor-calculus] ${name}:`, e); }
      return undefined;
    }
  };
  const vizScenes = () => (Array.isArray(viz.scenes) ? viz.scenes : []);

  // ---------------------------------------------------------------- player
  const el = {
    play: $('pPlay'), prev: $('pPrev'), next: $('pNext'), scrub: $('pScrub'), ticks: $('pTicks'),
    count: $('pCount'), label: $('pLabel'), speed: $('pSpeed'), stepsBtn: $('pStepsBtn'), stepList: $('stepList'),
    lensChips: $('lensChips'),
  };
  let lastStep = null;
  const player = createPlayer({
    onStep(i, step) {
      el.count.textContent = `${i + 1} / ${player.steps().length}`;
      el.label.textContent = plainLabel(step.label || step.kind || '');
      [...el.stepList.children].forEach((li, k) => li.classList.toggle('on', k === i));
      [...el.ticks.children].forEach((d, k) => { d.classList.toggle('on', k === i); d.classList.toggle('done', k < i); });
      // VIZ picks the scene of a step itself (play -> stepScene); playTrace
      // has already mapped step.viz.scene to a VIZ id.
      emit('step', { index: i, step });
    },
    onFrame(i, t, step, raw) {
      if (step !== lastStep) { lastStep = step; if (step.after && diagram.show && !diagram.play) diagram.show(step.after); }
      safe('tex.play', () => tex.play(step, t));
      if (!S.vizFree) safe('viz.play', () => viz.play(step, t));
      safe('diagram.play', () => diagram.play(step, t));
      el.scrub.value = String(Math.round(player.position().frac * 1000));
      emit('tick', { index: i, t, raw });
    },
    onEnd() { syncPlay(); },
    onStepEnd() { syncPlay(); },
  });
  // Step mode: stop on each step's result so the reader can study it. On
  // by default; the choice is kept per viewer.
  el.stepPause = $('pStepPause');
  const stepPauseOn = (() => { try { return localStorage.getItem('tc.stepPause') !== '0'; } catch (e) { return true; } })();
  player.setStepPause(stepPauseOn);
  if (el.stepPause) {
    el.stepPause.checked = stepPauseOn;
    el.stepPause.addEventListener('change', () => {
      player.setStepPause(el.stepPause.checked);
      try { localStorage.setItem('tc.stepPause', el.stepPause.checked ? '1' : '0'); } catch (e) { /* private mode */ }
    });
  }
  for (const s of SPEEDS) { const o = doc.createElement('option'); o.value = s; o.textContent = s + '×'; if (s === 1) o.selected = true; el.speed.appendChild(o); }
  el.speed.addEventListener('change', () => { S.speed = +el.speed.value; player.setSpeed(S.speed); });
  function syncPlay() {
    const p = player.position().playing;
    for (const b of [el.play]) { b.textContent = p ? '❚❚' : '▶'; b.setAttribute('aria-label', p ? 'Pause' : 'Play'); b.classList.toggle('on', p); }
  }
  const togglePlay = () => { player.toggle(); syncPlay(); };
  el.play.addEventListener('click', togglePlay);
  el.prev.addEventListener('click', () => { player.pause(); player.prev(); syncPlay(); });
  el.next.addEventListener('click', () => { player.pause(); player.next(); syncPlay(); });
  el.scrub.addEventListener('input', () => { player.pause(); player.seekFrac(+el.scrub.value / 1000); syncPlay(); });
  el.stepsBtn.addEventListener('click', () => {
    const open = el.stepList.hidden;
    el.stepList.hidden = !open; el.stepsBtn.setAttribute('aria-expanded', String(open));
  });

  function buildStepUI(trace) {
    el.stepList.replaceChildren(); el.ticks.replaceChildren();
    const tl = player.timeline(), total = player.totalMs() || 1;
    tl.forEach((sp, k) => {
      const li = doc.createElement('li');
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = plainLabel(sp.label);
      b.addEventListener('click', () => { player.seek(k, 0); player.play(); syncPlay(); el.stepList.hidden = true; el.stepsBtn.setAttribute('aria-expanded', 'false'); });
      li.appendChild(b); el.stepList.appendChild(li);
      const d = doc.createElement('span');
      d.className = 'tick';
      d.style.left = (100 * sp.start / total).toFixed(3) + '%';
      d.style.width = (100 * (sp.motion + sp.hold) / total).toFixed(3) + '%';
      d.title = `${k + 1}. ${plainLabel(sp.label)}`;
      el.ticks.appendChild(d);
    });
    const n = tl.length;
    el.count.textContent = n ? `1 / ${n}` : '0 / 0';
    if (!n) el.label.textContent = trace && trace.note ? trace.note : 'No steps. Open an equation or play an operation.';
    for (const b of [el.play, el.prev, el.next, el.scrub]) b.disabled = !n;
  }

  // ---------------------------------------------------------------- lens
  function refreshLens() {
    renderLens(el.lensChips, palette.activeSyms(), S.pickedIndex, sym => pickIndex(sym));
  }
  // A tap on a coloured index in the TeX: the class iN gives the slot.
  $('texBody').addEventListener('click', e => {
    const chip = e.target.closest && e.target.closest('[data-sym]');
    if (chip) { pickFromView(chip.dataset.sym); return; }
    let n = e.target;
    while (n && n !== e.currentTarget) {
      const c = n.getAttribute && n.getAttribute('class');
      const m = c && /(?:^|\s)i([0-7])(?:\s|$)/.exec(c);
      if (m) { const syms = symsFromSlot(+m[1]); if (syms.length) pickFromView(syms[0]); return; }
      n = n.parentNode;
    }
  });

  function pickIndex(sym) {
    S.pickedIndex = sym ? palette.norm(sym) : null;
    tex.pickIndex(S.pickedIndex);
    safe('viz.pickIndex', () => viz.pickIndex(S.pickedIndex));
    safe('diagram.pickIndex', () => diagram.pickIndex(S.pickedIndex));
    doc.body.dataset.pick = S.pickedIndex ? palette.indexClass(S.pickedIndex) : '';
    const dl = $('dockLens');
    if (dl) { dl.textContent = S.pickedIndex ? symLabel(S.pickedIndex) : 'μ'; dl.className = S.pickedIndex ? palette.indexClass(S.pickedIndex) + ' on' : ''; }
    refreshLens();
    emit('pick', { sym: S.pickedIndex });
    return S.pickedIndex;
  }

  // ---------------------------------------------------------------- fit
  // planLayout() (ui/fit-layout.js) gives the device, the grid shape, the
  // header level of each pane and the player level. A real browser has the
  // pane sizes, so the header and player levels come from them; with no
  // layout (a test DOM), they come from the plan.
  let lastPlan = null;
  function applyFit() {
    const coarse = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
    const vp = { w: win.innerWidth || 1280, h: win.innerHeight || 800, coarse };
    const plan = planLayout(vp, {
      panelOpen: $('panel').classList.contains('open'), inFrame: doc.documentElement.classList.contains('in-frame'),
      mode: S.layout.mode, views: S.layout.views,
    });
    // The CSS phone query decides the phone rules; the plan follows it.
    const isPhone = !!(phone && phone.isPhone());
    const device = isPhone ? (plan.device === 'desktop' ? 'portrait' : plan.device) : 'desktop';
    doc.body.dataset.device = device;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    stage.dataset.shape = device !== 'desktop' ? 'one' : sw > 0 && sh > 0 ? stageShape(S.layout.mode, sw, sh) : plan.shape;
    for (const v of VIEWS) {
      const w = panes[v].clientWidth || (plan.panes[v] && plan.panes[v].w) || 0;
      panes[v].dataset.head = w ? headLevel(v, w, { phone: device !== 'desktop' }) : 'l';
    }
    const pw = $('player').clientWidth || plan.playerW;
    $('player').dataset.fit = playerLevel(pw, device);
    lastPlan = { ...plan, device };
    fitSoon();
    return lastPlan;
  }

  // The equation fills its pane: measure the stack at the current scale,
  // then set --tex-k (ui/fit-layout.js texScale). Two passes, because the
  // operation line and the paddings do not scale.
  const texBody = $('texBody'), texStack = texBody.querySelector('.tex-stack');
  let fitRaf = 0;
  const rafFit = win.requestAnimationFrame ? fn => win.requestAnimationFrame(fn) : fn => setTimeout(fn, 16);
  function fitSoon() { if (!fitRaf) fitRaf = rafFit(() => { fitRaf = 0; fitTex(); fitTex(); }); }
  function fitTex() {
    if (!texStack || panes.tex.hidden) return null;
    const boxW = texStack.clientWidth, boxH = texStack.clientHeight;
    if (!boxW || !boxH) return null;
    const k = parseFloat(texBody.style.getPropertyValue('--tex-k')) || 1;
    let cw = 0, ch = 0, n = 0;
    for (const line of texStack.children) {
      if (line.hidden) continue;
      const svg = line.querySelector('svg');
      const w = svg ? svg.getBoundingClientRect().width : line.scrollWidth;
      cw = Math.max(cw, w); ch += line.offsetHeight; n++;
    }
    if (!n) return null;
    ch += Math.max(0, n - 1) * 6 * k;
    const phoneNow = doc.body.dataset.device && doc.body.dataset.device !== 'desktop';
    const r = texScale({ contentW: cw, contentH: ch, boxW, boxH: boxH * 0.92, k, min: phoneNow ? 0.7 : 0.75, max: phoneNow ? 1.6 : 2.2 });
    if (Math.abs(r.k - k) > 0.02) texBody.style.setProperty('--tex-k', String(r.k));
    texBody.classList.toggle('tex-scroll', r.scroll);
    return r;
  }

  // ---------------------------------------------------------------- layout
  const layoutBtns = [...doc.querySelectorAll('[data-layout]')];
  const styleBtns = [...doc.querySelectorAll('#diagStyle [data-style]')];
  let phone = null;
  function setView(spec) {
    let next;
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && spec.view) spec = { ...spec, ...(VIEWS.includes(spec.view) ? { focus: spec.view } : spec.view === 'all' ? { views: VIEWS.slice() } : {}) };
    next = reduce(S.layout, spec);
    // A phone shows one view at a time, with all three in a row: a focus
    // spec scrolls to that view and keeps the other two next to it.
    let phoneView = null;
    if (phone && phone.isPhone() && next.views.length < VIEWS.length) { phoneView = next.views[0]; next = reduce(next, 'all'); }
    const styleChanged = next.style !== S.layout.style;
    S.layout = next;
    for (const b of layoutBtns) {
      const v = b.dataset.layout;
      const on = v === 'all' ? next.mode === 'all' : next.mode === 'focus' && next.views[0] === v;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    }
    for (const b of styleBtns) b.classList.toggle('on', b.dataset.style === next.style);
    if (styleChanged) safe('diagram.setStyle', () => diagram.setStyle(next.style));
    applyFit();
    const done = applyLayout(stage, panes, next, { animate: !opts.noAnimate, onSettled: () => { applyFit(); safe('viz.resize', () => viz.resize()); safe('diagram.resize', () => diagram.resize && diagram.resize()); } });
    safe('viz.resize', () => viz.resize());
    if (phone) { phone.syncDots(); if (phoneView) phone.scrollToView(phoneView, false); else if (!next.views.includes(phone.currentView())) phone.scrollToView(next.views[0], false); }
    emit('view', { views: next.views.slice(), mode: next.mode, style: next.style });
    return done.then(() => ({ ...S.layout }));
  }
  for (const b of layoutBtns) b.addEventListener('click', () => {
    const v = b.dataset.layout;
    if (phone && phone.isPhone() && v !== 'all') {
      if (!S.layout.views.includes(v)) setView({ toggle: v });
      phone.scrollToView(v);
      return;
    }
    setView(v);
  });
  for (const b of styleBtns) b.addEventListener('click', () => setView({ style: b.dataset.style }));
  for (const b of doc.querySelectorAll('.pane-focus')) b.addEventListener('click', () => setView(S.layout.mode === 'focus' && S.layout.views[0] === b.dataset.focus ? 'all' : { focus: b.dataset.focus }));
  for (const b of doc.querySelectorAll('.pane-close')) b.addEventListener('click', () => setView({ toggle: b.dataset.close }));

  // ---------------------------------------------------------------- content
  function exprOf(x) {
    if (x == null) return null;
    if (typeof x !== 'string') return x;
    if (M && M.parseIndexTex) { try { return M.parseIndexTex(x); } catch (e) { /* keep the string */ } }
    return x;
  }

  function showExpr(x, o = {}) {
    const e = exprOf(x);
    const syms = typeof e === 'string' ? scriptIndices(e) : exprSyms(e, M);
    if (!o.keepTrace) { player.load({ steps: [] }); S.trace = null; buildStepUI(null); syncPlay(); }
    palette.setActive(syms);
    tex.show(e);
    if (e && typeof e === 'object') safe('diagram.show', () => diagram.show(e));
    if (S.pickedIndex && !syms.includes(S.pickedIndex)) pickIndex(null); else refreshLens();
    return e;
  }

  function playTrace(trace, o = {}) {
    if (!trace || !Array.isArray(trace.steps)) throw new Error('playTrace needs an OpTrace with a steps list');
    const { autoplay = true, step = 0, speed } = o;
    // LIBRARY and VIZ name some scenes differently. Map the hint of each
    // step to a VIZ id, on a copy, so the library objects stay as they are.
    const ids = vizScenes();
    trace = { ...trace, steps: trace.steps.map(st => (st.viz && st.viz.scene ? { ...st, viz: { ...st.viz, scene: resolveScene(st.viz.scene, ids) } } : st)) };
    S.trace = trace; S.dim = trace.dim || S.dim;
    setFree(false);
    palette.setActive(traceSyms(trace, M));
    lastStep = null;
    player.load(trace);
    buildStepUI(trace);
    if (speed) { player.setSpeed(speed); el.speed.value = String(speed); }
    if (trace.steps.length) {
      const first = trace.steps[0];
      if (first.before && typeof first.before === 'object') safe('diagram.show', () => diagram.show(first.before));
      player.seek(step, 0);
      if (autoplay) player.play();
    }
    if (S.pickedIndex && !palette.activeSyms().includes(S.pickedIndex)) pickIndex(null); else refreshLens();
    syncPlay();
    emit('trace', { trace });
    return { steps: trace.steps.length, totalMs: player.totalMs() };
  }

  function setScene(id, params = {}, o = {}) {
    const rid = resolveScene(id, vizScenes());
    S.scene = { id: rid, params: { ...params } };
    safe('viz.setScene', () => viz.setScene(rid, params));
    const cap = $('vizCaption');
    if (!$('sceneBox').hidden) sceneCtl.render();
    if (cap) {
      const info = sceneInfoOf(rid);
      cap.textContent = (info && info.label) || (rid ? rid.replace(/-/g, ' ') : '');
    }
    return { ...S.scene };
  }

  const followBtn = $('followBtn');
  function setFree(free) {
    S.vizFree = !!free;
    followBtn.hidden = !(S.vizFree && S.trace && S.trace.steps.length);
    if (!S.vizFree && S.trace && S.trace.steps.length) {
      const pos = player.position();
      if (pos.index >= 0) safe('viz.play', () => viz.play(player.steps()[pos.index], pos.t));
    }
  }
  followBtn.addEventListener('click', () => setFree(false));
  const sceneInfoOf = id => (viz.sceneInfo ? safe('viz.sceneInfo', () => viz.sceneInfo(id)) : pk.viz && pk.viz.sceneInfo ? safe('sceneInfo', () => pk.viz.sceneInfo(id)) : null);
  const sceneCtl = createSceneControls({ box: $('sceneBox'), btn: $('sceneBtn') }, {
    scenes: vizScenes,
    info: sceneInfoOf,
    current: () => (viz.state ? (safe('viz.state', () => viz.state()) || S.scene) : S.scene),
    onScene: id => { setScene(id, {}); setFree(true); },
    onParams: p => { S.scene.params = { ...S.scene.params, ...p }; if (viz.setParams) safe('viz.setParams', () => viz.setParams(p)); else safe('viz.setScene', () => viz.setScene(S.scene.id, S.scene.params)); setFree(true); },
  });

  let browser = null;
  function openEntry(id, params, o = {}) {
    const e = lib.byId.get(id);
    if (!e) throw new Error('No library entry ' + id);
    S.entryId = id;
    const p = params || (browser ? browser.paramsOf(id) : Object.fromEntries((e.params || []).map(q => [q.key, q.def])));
    if (browser && browser.current() !== id) browser.select(id);
    $('texCaption').textContent = e.title;
    if (e.viz && e.viz.scene) setScene(e.viz.scene, { ...(e.viz.params || {}), ...p });
    if (e.diagram && diagram.layout) safe('diagram.layout', () => diagram.layout(e.diagram));
    let expr = null;
    try { expr = e.expr ? e.expr() : exprOf(e.tex); } catch (err) { expr = e.tex || null; }
    let trace = null;
    try { trace = e.trace ? e.trace(p) : null; } catch (err) { win.console && win.console.warn('[tensor-calculus] trace of', id, err); }
    if (trace && trace.steps && trace.steps.length) {
      // The expression first, so the diagram has a picture before step 1.
      if (expr && typeof expr === 'object') safe('diagram.show', () => diagram.show(expr));
      playTrace(trace, { autoplay: o.autoplay !== false, step: o.step || 0 });
    } else showExpr(expr || e.tex);
    if (!o.noHash) setHash({ entry: id });
    emit('entry', { id });
    return { id, title: e.title, steps: trace ? trace.steps.length : 0 };
  }

  function setHash(obj) {
    try {
      const q = new URLSearchParams(obj).toString();
      if (win.history && win.history.replaceState) win.history.replaceState(null, '', '#' + q);
    } catch (e) { /* file: URLs or sandboxed frames */ }
  }

  // ---------------------------------------------------------------- panels
  const tabs = ['library', 'playground', 'learn'];
  const tabEls = { library: $('tabLibrary'), playground: $('tabPlayground'), learn: $('tabLearn') };
  function setTab(name, o = {}) {
    const panel = $('panel');
    // A tap on the open tab of the desktop panel closes the panel.
    if (o.toggle && !tabEls[name].hidden && panel.classList.contains('open') && !(phone && phone.isPhone())) { setPanel(false); return; }
    for (const t of tabs) tabEls[t].hidden = t !== name;
    for (const b of doc.querySelectorAll('[role=tab][data-tab]')) { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    if (!o.quiet) setPanel(true);
  }
  function setPanel(open) {
    if (phone) phone.setOpen(open);
    else { $('panel').classList.toggle('open', open); doc.body.classList.toggle('panel-closed', !open); }
    applyFit();
    safe('viz.resize', () => viz.resize());
  }
  for (const b of doc.querySelectorAll('[role=tab][data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab, { toggle: b.closest('.topbar') != null }));

  browser = createLibraryBrowser({ search: $('libSearch'), fields: $('libFields'), paths: $('libPaths'), list: $('libList'), detail: $('libDetail') }, {
    lib, typeset,
    onOpen: (id, p, o) => openEntry(id, p, { autoplay: true, noHash: false, ...o }),
    onParams: (id, p) => {
      if (S.entryId !== id) return;
      const pos = player.position();
      openEntry(id, p, { autoplay: pos.playing, step: Math.max(0, pos.index) });
    },
  });
  browser.render();

  const playground = createPlayground({
    input: $('pgInput'), status: $('pgStatus'), examples: $('pgExamples'), dim: $('pgDim'), metric: $('pgMetric'),
    ops: $('pgOps'), args: $('pgArgs'), apply: $('pgApply'), history: $('pgHistory'),
  }, {
    math: M, typeset,
    onExpr: e => { if (!player.position().playing) showExpr(e); },
    onTrace: trace => { S.entryId = null; $('texCaption').textContent = 'Playground'; playTrace(trace, { autoplay: true }); if (phone && phone.isPhone()) phone.setOpen(false); },
  });

  let learnMenu = null;
  const api = {
    openEntry: (id, params, o) => openEntry(id, params, o),
    playTrace: (trace, o) => playTrace(trace, o),
    setView: spec => setView(spec),
    setScene: (id, params) => { const r = setScene(id, params); setFree(true); return r; },
    pickIndex: sym => pickIndex(sym),
    showExpr: x => { showExpr(x); return true; },
    seek: (i, t) => { player.seek(i, t); syncPlay(); return player.position(); },
    pause: () => { player.pause(); syncPlay(); return true; },
    resume: () => { player.play(); syncPlay(); return true; },
    state: () => {
      const pos = player.position();
      return {
        ready: S.ready, entryId: S.entryId, views: S.layout.views.slice(), mode: S.layout.mode, diagramStyle: S.layout.style,
        scene: { id: S.scene.id, params: { ...S.scene.params } }, pickedIndex: S.pickedIndex, playing: pos.playing,
        speed: pos.speed, stepIndex: pos.index, t: pos.t, stepCount: player.steps().length,
        chapter: learnMenu && learnMenu.current ? learnMenu.current() : S.chapter, isPhone: !!(phone && phone.isPhone()),
        missing: pk.missing.slice(), vizFree: S.vizFree,
      };
    },
    on,
    follow: () => { setFree(false); return true; },
    internals: () => ({ store: S, player, setFree, fit: { apply: () => applyFit(), tex: () => fitTex(), last: () => lastPlan }, layout: { get: () => ({ ...S.layout }), set: setView }, views: { tex, viz, diagram }, packages: pk, palette, emit }),
  };

  learnMenu = createLearnMenu({ menu: $('learnMenu'), host: $('learnHost') }, {
    learn: pk.learn, page: stub, typeset,
    // LEARN resolves its scene and entry names against what is loaded.
    learnOpts: () => ({ lib: lib.raw, math: M, sceneIds: vizScenes(), entryIds: [...lib.byId.keys()], hash: true }),
    onOpen: id => { S.chapter = id; },
  });

  // ---------------------------------------------------------------- drawers
  const credits = $('credits');
  const setCredits = open => { credits.hidden = !open; $('creditsBtn').setAttribute('aria-expanded', String(open)); };
  $('creditsBtn').addEventListener('click', () => { renderCredits($('creditsBody'), lib.entries); setCredits(credits.hidden); });
  $('creditsClose').addEventListener('click', () => setCredits(false));
  const legendBox = $('diagLegend');
  $('legendBtn').addEventListener('click', () => {
    const open = legendBox.hidden;
    if (open) { legendBox.replaceChildren(); if (diagram.legend) safe('diagram.legend', () => diagram.legend(legendBox)); else legendBox.textContent = 'The Penrose diagram legend is not available.'; }
    legendBox.hidden = !open; $('legendBtn').setAttribute('aria-expanded', String(open));
  });
  on('view', () => { if (!legendBox.hidden && diagram.legend) { legendBox.replaceChildren(); safe('diagram.legend', () => diagram.legend(legendBox)); } });
  $('texSumsBtn').addEventListener('click', () => { const on = tex.setSums(!tex.sums()); $('texSumsBtn').setAttribute('aria-pressed', String(on)); $('texSumsBtn').classList.toggle('on', on); });
  const dockLens = $('dockLens');
  if (dockLens) dockLens.addEventListener('click', () => {
    const open = !doc.body.classList.contains('lens-open');
    doc.body.classList.toggle('lens-open', open); dockLens.setAttribute('aria-expanded', String(open));
  });

  // ---------------------------------------------------------------- phone
  phone = createPhone({ panel: $('panel'), dockPanel: $('dockPanel'), grip: $('sheetGrip'), stage, dots: $('swipeDots'), panes }, {
    views: () => S.layout.views,
    onView: v => { for (const b of doc.querySelectorAll('#dockViews [data-layout]')) b.classList.toggle('on', b.dataset.layout === v); safe('viz.resize', () => viz.resize()); },
    onOpen: () => { applyFit(); safe('viz.resize', () => viz.resize()); },
    onPhone: on => setView(on ? 'all' : S.layout.views),
  });

  // ---------------------------------------------------------------- keys
  function bindKeys() {
    doc.addEventListener('keydown', e => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      // The chapter panel has its own arrow keys (back and next beat).
      if (e.target && e.target.closest && e.target.closest('.learn')) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') { player.pause(); player.next(); syncPlay(); }
      else if (e.key === 'ArrowLeft') { player.pause(); player.prev(); syncPlay(); }
      else if (e.key >= '1' && e.key <= '4') setView(['all', 'tex', 'viz', 'diagram'][+e.key - 1]);
      else if (e.key === 'Escape') { setCredits(false); legendBox.hidden = true; sceneCtl.close(); el.stepList.hidden = true; if (S.pickedIndex) pickIndex(null); }
    });
  }
  bindKeys();
  if (win.addEventListener) win.addEventListener('resize', () => { applyFit(); safe('viz.resize', () => viz.resize()); });
  // A pane can change size with no window resize: the panel opens or
  // closes, a layout moves, the phone sheet moves. One observer per pane.
  if (typeof win.ResizeObserver === 'function') {
    const ro = new win.ResizeObserver(entries => {
      fitSoon();
      for (const en of entries) {
        if (en.target === panes.viz) safe('viz.resize', () => viz.resize());
        if (en.target === panes.diagram) safe('diagram.resize', () => diagram.resize && diagram.resize());
      }
    });
    ro.observe(panes.viz); ro.observe(panes.diagram); ro.observe(panes.tex);
  }

  // ---------------------------------------------------------------- frame
  const raf = opts.raf || (fn => win.requestAnimationFrame(fn));
  const now = opts.now || (() => (win.performance ? win.performance.now() : Date.now()));
  let last = now(), t0 = last, running = true;
  function frame() {
    if (!running) return;
    const tNow = now(), dt = tNow - last; last = tNow;
    if (!doc.hidden) {
      player.tick(dt);
      safe('viz.setTime', () => viz.setTime((tNow - t0) / 1000));
    }
    raf(frame);
  }

  // ---------------------------------------------------------------- start
  await setView(S.layout.views);
  safe('diagram.setStyle', () => diagram.setStyle(S.layout.style));
  S.ready = true;
  await attach(win, api);

  const hash = new URLSearchParams(String(win.location && win.location.hash || '').replace(/^#/, ''));
  const firstPath = lib.paths[0];
  const startId = hash.get('entry') && lib.byId.has(hash.get('entry')) ? hash.get('entry') : (firstPath ? firstPath.ids[0] : (lib.entries[0] || {}).id);
  if (opts.autostart !== false) {
    const rawHash = String(win.location && win.location.hash || '');
    if (/^#learn\b/.test(rawHash) && learnMenu.startFromHash()) setTab('learn');
    else if (hash.get('chapter') && learnMenu.open(hash.get('chapter'))) setTab('learn');
    else if (startId) safe('openEntry', () => openEntry(startId, null, { autoplay: true, noHash: true }));
    else if (M) { setTab('playground'); safe('playground', () => playground.apply()); }
  }
  raf(frame);

  // SAVER SEAM. SAVER (phase 2) owns saver/index.js. When the module
  // exists, CORE calls installSaver(api, internals) once. CORE never sets
  // window.snSaver itself. A missing module is not an error.
  if (opts.saver !== false) {
    const imp = opts.importer || (p => import(new URL(p, import.meta.url).href));
    Promise.resolve().then(() => imp('./saver/index.js')).then(m => m && m.installSaver && m.installSaver(win.tensorPage, api.internals())).catch(() => {});
  }

  return { api, stop() { running = false; }, internals: api.internals(), packages: pk, phone, playground, browser, learnMenu, setTab };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__TC_NO_AUTOBOOT) {
  boot().catch(e => {
    console.error('[tensor-calculus] boot failed', e);
    const t = document.getElementById('toast');
    if (t) { t.hidden = false; t.textContent = 'The page did not start: ' + e.message; }
  });
}
