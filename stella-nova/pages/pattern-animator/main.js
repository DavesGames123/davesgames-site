// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  main.js — the board, the transport, controls
// ----------------------------------------------------------------------------
//  The page imports the pattern-designer engine, book, palettes, density
//  and worker (no copy of a pattern). State lives in st. Three kinds of
//  change:
//    rebuild   pattern, params, seed, density, detail, style mode, board,
//              morph, a field channel on or off, a larger cover board:
//              the worker makes the geometry again (scene.js buildScene)
//    motion    a channel curve, amount, cycles or phase, the loop length:
//              the player compiles the animation again (no worker job)
//    paint     palette, line weight: the colour table only
//  The worker runs one job at a time; changes during a job wait as one
//  pending rebuild, so a slider drag never queues a backlog. The old scene
//  plays until the new one is ready.
//
//  LOOP. requestAnimationFrame moves st.t (seconds in the loop) by the
//  real time x the speed, draws the frame, and gives the frame time to
//  the governor (governor.js). A governor level sets a factor on the
//  canvas pixel ratio (free) and on the point budget (a rebuild at a lower
//  density). The loop stops while the page is hidden and while it is
//  paused (a paused page draws only on a change).
//
//  MOTION. prefers-reduced-motion: the page starts paused at a quarter
//  speed. Space plays or pauses; , and . step one frame; R randomises the
//  motion; U is Surprise me; the arrows change the pattern; P the palette.
//
//  grep -n targets
//    state ................ "const st ="
//    worker client ........ "function makeRunner"
//    rebuild .............. "function rebuild"
//    frame loop ........... "function loop"
//    drawing .............. "function draw"
//    governor ............. "function applyLevel"
//    layout ............... "function layout"
//    presets .............. "function applyPreset"
//    pattern controls ..... "function buildPattern"  "function buildParams"
//    channel rows ......... "function buildChannels"
//    timeline strip ....... "function drawTimeline"
//    morph ................ "function buildMorph"
//    palettes ............. "function buildPalettes"
//    randomise ............ "function randomiseMotion"  "function surpriseMe"
//    exports .............. exporter.js (main.js "function bindExport")
//    panel and sheet ...... "function setOpen"
//    saver ................ saver.js (installSaver)
// ============================================================================
import { defaults, clampParams, makeRng } from '../pattern-designer/engine.js';
import { PATTERNS, FAMILIES, byId } from '../pattern-designer/patterns/index.js';
import { PALETTES, PALETTE_GROUPS, paletteById, boardById } from '../pattern-designer/palettes.js';
import { DENSITY, DETAIL, densityCap, densityDefault, runCap, clampD, clampDetail } from '../pattern-designer/density.js';
import { tasteParams, surprise } from '../pattern-designer/taste.js';
import { CHANNELS, CHANNEL_IDS, CURVES, LOOPS, cleanAnim, curveValue, geoInfo, coverFor, needsDeform, wrapT } from './motion.js';
import { PRESETS, presetById, presetAnim, randomAnim, isComposed } from './presets.js';
import { buildScene, makePlayer, viewBoard, ANIM_BOARDS, BUDGET } from './scene.js';
import { drawFrame } from './render.js';
import { Governor, LEVELS } from './governor.js';
import { installExport } from './exporter.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const LAND_Q = matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STORE = 'pa-state-v1';
const DCAP = densityCap(COARSE), RCAP = runCap(COARSE), BASE_BUDGET = COARSE ? BUDGET.phone : BUDGET.desktop;
const SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2];

const st = {
  preset: 'tidal-arcs', pat: 'arc-lattice', P: null, seed: 12, D: densityDefault(COARSE), detail: DETAIL.def,
  mode: 'auto', lw: 2, pal: 'bone', board: '4x5', mods: [], anim: null,
  playing: !REDUCED, speed: REDUCED ? 0.25 : 1, t: 0,
};
let scene = null, player = null, saverOn = false, level = 0, govOn = true;
const gov = new Governor();

// ── worker client ──────────────────────────────────────────────────────────
// The pattern-designer worker (it caches the last results). With no module
// worker (an old browser, file://, jsdom), the job runs on the main thread.
function makeRunner() {
  let w = null, seq = 0;
  const wait = new Map();
  const local = job => import('../pattern-designer/worker.js').then(m => m.runJob(job));
  try {
    if (typeof Worker === 'function') {
      w = new Worker(new URL('../pattern-designer/worker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => { const q = wait.get(e.data.id); if (!q) return; wait.delete(e.data.id); e.data.error ? q.rej(new Error(e.data.error)) : q.res(e.data.res); };
      w.onerror = () => { w = null; for (const [id, q] of wait) { wait.delete(id); local(q.job).then(q.res, q.rej); } };
    }
  } catch (e) { w = null; }
  return {
    run(job) {
      if (!w) return local(job);
      return new Promise((res, rej) => { const id = ++seq; wait.set(id, { res, rej, job }); w.postMessage({ id, job }); });
    },
  };
}
const runner = makeRunner();

// ── helpers ────────────────────────────────────────────────────────────────
const pat = () => byId(st.pat) || PATTERNS[0];
const pal = () => paletteById(st.pal);
const L = () => st.anim.L;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400);
}
const fmt = (v, step) => step >= 1 ? String(Math.round(v)) : step >= 0.1 ? (+v).toFixed(1) : step >= 0.01 ? (+v).toFixed(2) : (+v).toFixed(3);
function save() {
  if (saverOn) return;
  try { localStorage.setItem(STORE, JSON.stringify({ st: Object.assign({}, st, { playing: undefined, t: undefined }) })); } catch (e) { /* storage off */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!d || !d.st || !byId(d.st.pat)) return false;
    const s = d.st;
    Object.assign(st, { preset: s.preset || '', pat: s.pat, P: s.P, seed: Math.max(1, Math.round(+s.seed) || 1), mode: ['auto', 'stroke', 'fill', 'knock'].includes(s.mode) ? s.mode : 'auto',
      lw: Math.max(0.25, Math.min(8, +s.lw || 2)), pal: paletteById(s.pal).id, board: ANIM_BOARDS.includes(s.board) ? s.board : '4x5', mods: Array.isArray(s.mods) ? s.mods.slice(0, 2) : [],
      anim: cleanAnim(s.anim), D: clampD(s.D ?? densityDefault(COARSE), DCAP), detail: clampDetail(s.detail ?? DETAIL.def) });
    if (!REDUCED && SPEEDS.includes(+s.speed)) st.speed = +s.speed;
    return true;
  } catch (e) { return false; }
}

// ── rebuild ────────────────────────────────────────────────────────────────
let busy = false, pending = false, sceneKey = '';
function budget() { return Math.round(BASE_BUDGET * LEVELS[level].pts); }
// The parts of the state that change the geometry.
function geomKey() {
  const view = viewBoard(st.board), cv = coverFor(view, st.anim, isComposed(pat()) || st.mods.some(m => m.type === 'mirror' && m.kind === 'kaleido'));
  return JSON.stringify([st.pat, st.P, st.seed, st.D, st.detail, st.mode, st.board, st.mods, cv.k, needsDeform(st.anim), st.anim.morph, budget()]);
}
function rebuild() { pending = true; pump(); save(); }
function pump() {
  if (busy || !pending) return;
  pending = false; busy = true;
  const key = geomKey(), job = { pat: st.pat, P: st.P, seed: st.seed, D: st.D, detail: st.detail, mode: st.mode, board: st.board, mods: st.mods, anim: st.anim };
  const tm = setTimeout(() => $('busy').classList.add('on'), 160);
  buildScene(j => runner.run(j), job, { coarse: COARSE, cap: RCAP, budget: budget() })
    .then(sc => {
      scene = sc; sceneKey = key;
      player = makePlayer(sc, st.anim, pal());
      layout(); caption(); drawTimeline(); exp.info();
      if (!st.playing) draw();
    })
    .catch(err => { console.warn('pattern failed', err); toast('This pattern failed: ' + err.message); })
    .finally(() => { clearTimeout(tm); $('busy').classList.remove('on'); busy = false; pump(); });
}
// A motion change: rebuild only when the geometry needs it.
function motionChanged() {
  // Clean in place: the channel rows hold the channel objects.
  const c = cleanAnim(st.anim);
  st.anim.L = c.L; st.anim.morph = c.morph;
  for (const id of CHANNEL_IDS) Object.assign(st.anim.ch[id], c.ch[id]);
  if (geomKey() !== sceneKey) rebuild();
  else if (player) { player.setAnim(st.anim); save(); }
  st.t = wrapT(st.t, L());
  drawTimeline(); caption();
  if (!st.playing) draw();
}

// ── frame loop ─────────────────────────────────────────────────────────────
let raf = 0, last = 0, frames = 0, fpsAt = 0, fps = 0, uiAt = 0;
function loop(now) {
  raf = 0;
  if (saverOn || document.hidden || !st.playing) return;
  raf = requestAnimationFrame(loop);
  const dt = last ? now - last : 16.7; last = now;
  if (!scrubbing) st.t = wrapT(st.t + Math.min(dt, 100) / 1000 * st.speed, L());
  const c0 = performance.now();
  draw();
  const cost = performance.now() - c0;
  frames++;
  if (now - fpsAt > 1000) { fps = Math.round(frames * 1000 / (now - fpsAt)); frames = 0; fpsAt = now; caption(); }
  if (govOn && scene && !busy) { const l = gov.sample(dt, cost, now); if (l != null) applyLevel(l); }
  if (now - uiAt > 120) { uiAt = now; transportUI(); }
}
function play(on) {
  st.playing = on;
  $('playBtn').setAttribute('aria-label', on ? 'Pause' : 'Play'); $('playBtn').classList.toggle('on', on);
  $('playBtn').innerHTML = on ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>';
  $('dockPlay').innerHTML = $('playBtn').innerHTML; $('dockPlay').setAttribute('aria-label', on ? 'Pause' : 'Play');
  last = 0; gov.reset();
  if (on && !raf && !document.hidden && !saverOn) raf = requestAnimationFrame(loop);
  if (!on) { transportUI(); draw(); }
}
function step(frames) { play(false); st.t = wrapT(st.t + frames / 30, L()); transportUI(); draw(); }

// ── governor ───────────────────────────────────────────────────────────────
function applyLevel(l) {
  const prevPts = LEVELS[level].pts;
  level = l;
  layout();
  if (LEVELS[l].pts !== prevPts) rebuild();
  caption();
}

// ── drawing ────────────────────────────────────────────────────────────────
let clipRings = null;
function draw() {
  const c = $('board'), g = c.getContext && c.getContext('2d');
  if (!g) return;
  const p = pal();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = p.bg; g.fillRect(0, 0, c.width, c.height);
  if (!scene || !player) return;
  const layers = player.play(st.t);
  drawFrame(g, layers, { W: scene.view.W, H: scene.view.H, base: [c.width / scene.view.W, 0, 0], lut: player.lut, paper: p.bg, lw: st.lw, lwScale: scene.lwScale, clip: clipRings });
}
function caption() {
  if (!scene) return;
  const p = scene.pat, n = scene.G.n + (scene.B ? scene.B.n : 0);
  const lv = level ? ` · lighter view ${level}` : '';
  $('caption').innerHTML = `<i></i> · seed <span class="n">${st.seed}</span> · <span class="n">${L()}</span> s loop · <span class="n">${n.toLocaleString('en')}</span> shapes · density <span class="n">${scene.D.toFixed(2)}</span>${st.playing && fps ? ` · <span class="n">${fps}</span> fps` : ''}${lv}`;
  $('caption').querySelector('i').textContent = p.name + (scene.patB ? ' to ' + scene.patB.name : '');
  $('board').setAttribute('aria-label', `Animated ${p.name} pattern, a ${L()} second loop`);
}

// ── layout ─────────────────────────────────────────────────────────────────
// The clear part of #desk, less the transport bar at its base. The board
// takes the largest box of its aspect there.
function layout() {
  if (saverOn) return;
  const desk = $('desk').getBoundingClientRect(), panel = $('panel'), tb = $('transport');
  let Lx = desk.left, R = desk.right, T = desk.top, B = desk.bottom;
  if (panel.classList.contains('open')) {
    if (LAND_Q.matches) R = Math.min(R, innerWidth - panel.offsetWidth);
    else if (PHONE_Q.matches) { const top = desk.bottom - panel.offsetHeight; if (top - T > 170) B = top; }
    else Lx = Math.max(Lx, panel.offsetWidth);
  }
  const phone = PHONE_Q.matches, th = tb.offsetHeight || 52, cap = phone ? 22 : 30, top = phone ? 10 : 60, m = phone ? 10 : 28;
  tb.style.left = (Lx - desk.left + m) + 'px'; tb.style.right = (desk.right - R + m) + 'px'; tb.style.top = (B - desk.top - th - (phone ? 6 : 12)) + 'px';
  const v = viewBoard(st.board), aw = R - Lx - 2 * m, ah = B - T - top - m - cap - th - (phone ? 6 : 12);
  const k = Math.max(0.05, Math.min(aw / v.W, ah / v.H)), w = Math.floor(v.W * k), h = Math.floor(v.H * k);
  const x = Math.round((Lx + R) / 2 - w / 2 - desk.left), y = Math.round(T + top + (ah - h) / 2 - desk.top);
  const c = $('board'), dpr = Math.min(COARSE ? 2 : 2.5, devicePixelRatio || 1) * LEVELS[level].px;
  c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.width = w + 'px'; c.style.height = h + 'px';
  const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  const cp = $('caption'); cp.style.left = (x + w / 2) + 'px'; cp.style.top = (y + h + (phone ? 4 : 8)) + 'px';
  const bz = $('busy'); bz.style.left = (x + w - 34) + 'px'; bz.style.top = (y + 8) + 'px';
  if (!st.playing) draw();
}

// ── transport ──────────────────────────────────────────────────────────────
let scrubbing = false;
function transportUI() {
  const s = $('scrub');
  if (!scrubbing) s.value = String(Math.round(st.t / L() * 1000));
  s.setAttribute('aria-valuetext', `${st.t.toFixed(1)} of ${L()} seconds`);
  $('clock').textContent = `${st.t.toFixed(1)} / ${L()} s`;
  drawPlayhead();
}
function bindTransport() {
  $('playBtn').addEventListener('click', () => play(!st.playing));
  $('dockPlay').addEventListener('click', () => play(!st.playing));
  const s = $('scrub');
  s.addEventListener('input', () => { scrubbing = true; st.t = +s.value / 1000 * L(); $('clock').textContent = `${st.t.toFixed(1)} / ${L()} s`; drawPlayhead(); if (!st.playing) draw(); });
  s.addEventListener('change', () => { scrubbing = false; });
  s.addEventListener('pointerup', () => { scrubbing = false; });
  const sp = $('speed');
  sp.innerHTML = SPEEDS.map(v => `<option value="${v}">${v}x</option>`).join('');
  sp.value = String(st.speed);
  sp.addEventListener('change', () => { st.speed = +sp.value; save(); });
  const lp = $('loopLen');
  lp.innerHTML = LOOPS.map(v => `<option value="${v}">${v} s loop</option>`).join('');
  lp.addEventListener('change', () => { const f = st.t / L(); st.anim.L = +lp.value; st.t = f * st.anim.L; motionChanged(); transportUI(); });
}

// ── presets ────────────────────────────────────────────────────────────────
function buildPresets() {
  const box = $('presets'); box.textContent = '';
  for (const pr of PRESETS) {
    const b = document.createElement('button'); b.textContent = pr.name; b.dataset.id = pr.id;
    b.title = `${byId(pr.pat).name}, ${pr.L} s loop`;
    b.addEventListener('click', () => applyPreset(pr.id));
    box.append(b);
  }
  presetLabels();
}
function presetLabels() {
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.id === st.preset));
  const pr = presetById(st.preset);
  $('dockTitle').textContent = pr ? pr.name : pat().name;
}
function applyPreset(id) {
  const pr = presetById(id); if (!pr) return;
  const p = byId(pr.pat);
  Object.assign(st, { preset: pr.id, pat: p.id, P: clampParams(p, Object.assign(defaults(p), pr.P || {})), seed: pr.seed, pal: pr.pal, mode: pr.mode || 'auto', lw: pr.lw || 2,
    D: densityDefault(COARSE), detail: pr.detail ?? DETAIL.def, mods: (pr.mods || []).map(m => Object.assign({}, m)), anim: presetAnim(pr), t: 0 });
  syncAll(); rebuild();
}
function stepPreset(d) {
  const i = PRESETS.findIndex(p => p.id === st.preset);
  applyPreset(PRESETS[(i + d + PRESETS.length) % PRESETS.length].id);
  toast(presetById(st.preset).name);
}

// ── pattern controls ───────────────────────────────────────────────────────
function buildPattern() {
  const sel = $('patSel');
  sel.innerHTML = FAMILIES.map(f => `<optgroup label="${f.name}">${PATTERNS.filter(p => p.family === f.id).map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</optgroup>`).join('');
  sel.addEventListener('change', () => setPattern(sel.value));
  $('prevPat').addEventListener('click', () => stepPattern(-1));
  $('nextPat').addEventListener('click', () => stepPattern(1));
}
function setPattern(id, P) {
  const p = byId(id); if (!p) return;
  st.pat = id; st.P = clampParams(p, P || defaults(p)); st.preset = '';
  if (st.anim.morph && st.anim.morph.pat === id) st.anim.morph = null;
  syncAll(); rebuild();
}
function stepPattern(d) {
  const i = PATTERNS.findIndex(p => p.id === st.pat);
  setPattern(PATTERNS[(i + d + PATTERNS.length) % PATTERNS.length].id);
}
function sliderRow(def, value, onChange) {
  const [a, b, step, , label] = def, row = document.createElement('div');
  if (step >= 1 && b - a === 1) {
    row.className = 'prm sw';
    row.innerHTML = '<div class="nm"></div><button></button>';
    row.querySelector('.nm').textContent = label;
    const btn = row.querySelector('button'), show = v => { btn.textContent = v ? 'On' : 'Off'; btn.classList.toggle('on', !!v); btn.setAttribute('aria-pressed', String(!!v)); };
    btn.setAttribute('aria-label', label);
    show(value); btn.addEventListener('click', () => { value = value ? 0 : 1; show(value); onChange(value); });
    return row;
  }
  row.className = 'prm';
  row.innerHTML = '<div class="nm"></div><span class="val"></span><input type="range">';
  row.querySelector('.nm').textContent = label; row.querySelector('.nm').title = label;
  const inp = row.querySelector('input'), val = row.querySelector('.val');
  Object.assign(inp, { min: a, max: b, step, value }); inp.setAttribute('aria-label', label);
  val.textContent = fmt(value, step);
  inp.addEventListener('input', () => { const v = +inp.value; val.textContent = fmt(v, step); onChange(v); });
  return row;
}
function buildParams() {
  const box = $('params'), p = pat(); box.textContent = '';
  for (const k in p.params) box.append(sliderRow(p.params[k], st.P[k], v => { st.P[k] = v; st.preset = ''; presetLabels(); rebuild(); }));
  const d = $('dens'); d.textContent = '';
  d.append(sliderRow([DENSITY.min, DCAP, DENSITY.step, densityDefault(COARSE), 'Density'], st.D, v => { st.D = v; rebuild(); }));
  d.append(sliderRow([DETAIL.min, DETAIL.max, DETAIL.step, DETAIL.def, 'Detail (inner lines)'], st.detail, v => { st.detail = v; rebuild(); }));
}
const newSeed = () => 1 + Math.floor(Math.random() * 999998);
function setSeed(s) { st.seed = Math.max(1, Math.min(999999, Math.round(s) || 1)); $('seed').value = st.seed; st.preset = ''; presetLabels(); rebuild(); }

// ── channels ───────────────────────────────────────────────────────────────
function buildChannels() {
  const box = $('channels'); box.textContent = '';
  for (const id of CHANNEL_IDS) {
    const d = CHANNELS[id], s = st.anim.ch[id], row = document.createElement('div');
    row.className = 'chan' + (s.on ? ' on' : ''); row.dataset.id = id;
    const h = document.createElement('div'); h.className = 'chan-h';
    h.innerHTML = '<button class="tog"></button><b></b><span class="per"></span>';
    const tog = h.querySelector('.tog');
    tog.textContent = s.on ? 'On' : 'Off'; tog.classList.toggle('on', !!s.on);
    tog.setAttribute('aria-pressed', String(!!s.on)); tog.setAttribute('aria-label', d.label);
    h.querySelector('b').textContent = d.label; h.querySelector('b').title = d.text;
    h.querySelector('.per').textContent = s.on ? `${(L() / s.cycles).toFixed(1)} s` : '';
    tog.addEventListener('click', () => { s.on = s.on ? 0 : 1; st.preset = ''; presetLabels(); buildChannels(); motionChanged(); });
    h.querySelector('b').addEventListener('click', () => tog.click());
    row.append(h);
    if (s.on) {
      const body = document.createElement('div'); body.className = 'chan-b';
      const seg = document.createElement('div'); seg.className = 'seg five'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', d.label + ' curve');
      for (const c in CURVES) {
        const b = document.createElement('button'); b.textContent = CURVES[c]; b.classList.toggle('on', s.curve === c); b.setAttribute('aria-pressed', String(s.curve === c));
        b.addEventListener('click', () => { s.curve = c; buildChannels(); motionChanged(); });
        seg.append(b);
      }
      body.append(seg);
      body.append(sliderRow(d.amount, s.amount, v => { s.amount = v; motionChanged(); }));
      if (d.freq) body.append(sliderRow(d.freq, s.freq, v => { s.freq = v; motionChanged(); }));
      const cy = document.createElement('div'); cy.className = 'cyc';
      cy.innerHTML = '<span>Cycles per loop</span><button data-d="-1" aria-label="Fewer cycles">−</button><b></b><button data-d="1" aria-label="More cycles">+</button>';
      cy.querySelector('b').textContent = s.cycles;
      cy.addEventListener('click', e => { const dd = +(e.target.dataset && e.target.dataset.d); if (!dd) return; s.cycles = Math.max(1, Math.min(8, s.cycles + dd)); buildChannels(); motionChanged(); });
      body.append(cy);
      body.append(sliderRow([0, 1, 0.01, 0, 'Phase'], s.phase, v => { s.phase = v; motionChanged(); }));
      const tx = document.createElement('p'); tx.className = 'hint'; tx.textContent = d.text; body.append(tx);
      row.append(body);
    }
    box.append(row);
  }
}

// ── timeline strip ─────────────────────────────────────────────────────────
// One lane per active channel (and the morph): the curve over the loop,
// the cycles as repeats, and the playhead. A press or drag sets the time.
function lanes() {
  const out = [];
  for (const id of CHANNEL_IDS) if (st.anim.ch[id].on) out.push({ id, label: CHANNELS[id].label, s: st.anim.ch[id] });
  if (st.anim.morph) out.push({ id: 'morph', label: 'Morph', s: st.anim.morph });
  return out;
}
let tlBase = null;
function drawTimeline() {
  const c = $('timeline'); if (!c) return;
  const g = c.getContext && c.getContext('2d'); if (!g) return;
  const ls = lanes(), lh = 20, w = Math.max(200, Math.round(c.getBoundingClientRect().width || 280)), h = Math.max(1, ls.length) * lh + 14;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.style.height = h + 'px';
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const x0 = 92, x1 = w - 6;
  g.font = '11px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
  if (!ls.length) { g.fillStyle = '#8a8f99'; g.fillText('No motion: turn a channel on.', 6, h / 2); tlBase = null; return; }
  ls.forEach((l, i) => {
    const y = 4 + i * lh, mid = y + lh / 2, amp = lh * 0.36;
    g.fillStyle = '#c9ccd3'; g.fillText(l.label, 6, mid, x0 - 12);
    g.strokeStyle = 'rgba(227,196,138,0.12)'; g.beginPath(); g.moveTo(x0, mid); g.lineTo(x1, mid); g.stroke();
    g.strokeStyle = '#e3c48a'; g.lineWidth = 1.3; g.beginPath();
    const s = l.s, cycles = s.cycles || 1, ph = s.phase || 0;
    for (let px = 0; px <= x1 - x0; px += 2) {
      const x = ((px / (x1 - x0)) * cycles + ph) % 1;
      const v = l.id !== 'morph' && CHANNELS[l.id].cyc && s.curve === 'ramp' ? 2 * x - 1 : curveValue(s.curve, x, 1.3, 4.1);
      const Y = mid - v * amp;
      if (px === 0) g.moveTo(x0 + px, Y); else g.lineTo(x0 + px, Y);
    }
    g.stroke(); g.lineWidth = 1;
  });
  for (let k = 0; k <= L(); k += L() > 12 ? 4 : 2) {
    const x = x0 + (x1 - x0) * k / L();
    g.fillStyle = '#5c616b'; g.fillText(k + '', Math.min(x1 - 10, x), h - 6);
  }
  tlBase = g.getImageData ? g.getImageData(0, 0, c.width, c.height) : null;
  tlGeom = { x0, x1, h, dpr };
  drawPlayhead();
}
let tlGeom = null;
function drawPlayhead() {
  const c = $('timeline'), g = c && c.getContext && c.getContext('2d');
  if (!g || !tlGeom) return;
  if (tlBase && g.putImageData) g.putImageData(tlBase, 0, 0);
  const { x0, x1, h, dpr } = tlGeom, x = x0 + (x1 - x0) * st.t / L();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.strokeStyle = '#f1eee6'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 2); g.lineTo(x, h - 12); g.stroke(); g.lineWidth = 1;
}
function bindTimeline() {
  const c = $('timeline'); let down = false;
  const set = e => {
    if (!tlGeom) return;
    const r = c.getBoundingClientRect(), u = (e.clientX - r.left - tlGeom.x0) / (tlGeom.x1 - tlGeom.x0);
    st.t = Math.max(0, Math.min(0.9999, u)) * L(); transportUI(); if (!st.playing) draw();
  };
  c.addEventListener('pointerdown', e => { down = true; scrubbing = true; try { c.setPointerCapture(e.pointerId); } catch (x) { /* no capture */ } set(e); });
  c.addEventListener('pointermove', e => { if (down) set(e); });
  const up = () => { down = false; scrubbing = false; };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
}

// ── morph ──────────────────────────────────────────────────────────────────
function buildMorph() {
  const m = st.anim.morph, kind = !m ? 'off' : m.pat ? 'pat' : 'seed';
  document.querySelectorAll('#morphKind button').forEach(b => { b.classList.toggle('on', b.dataset.k === kind); b.setAttribute('aria-pressed', String(b.dataset.k === kind)); });
  const sel = $('morphPat');
  if (!sel.options.length) sel.innerHTML = PATTERNS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  sel.hidden = kind !== 'pat'; $('morphCurve').hidden = kind === 'off';
  if (m && m.pat) sel.value = m.pat;
  if (m) $('morphCurve').value = m.curve;
}
function bindMorph() {
  $('morphCurve').innerHTML = Object.entries(CURVES).filter(([k]) => k !== 'ramp').map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  document.querySelectorAll('#morphKind button').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.k, prev = st.anim.morph;
    if (k === 'off') st.anim.morph = null;
    else if (k === 'seed') st.anim.morph = { seed: newSeed(), curve: prev ? prev.curve : 'ease', cycles: 1, phase: 0 };
    else { const others = PATTERNS.filter(p => p.family === pat().family && p.id !== st.pat); st.anim.morph = { pat: (others[0] || PATTERNS[0]).id, curve: prev ? prev.curve : 'ease', cycles: 1, phase: 0 }; }
    st.preset = ''; presetLabels(); buildMorph(); motionChanged();
  }));
  $('morphPat').addEventListener('change', () => { if (st.anim.morph) { st.anim.morph = { pat: $('morphPat').value, seed: 0, curve: st.anim.morph.curve, cycles: 1, phase: 0 }; motionChanged(); } });
  $('morphCurve').addEventListener('change', () => { if (st.anim.morph) { st.anim.morph.curve = $('morphCurve').value; motionChanged(); } });
}

// ── palettes ───────────────────────────────────────────────────────────────
function buildPalettes() {
  const box = $('palettes'); box.textContent = '';
  let grp = null;
  for (const p of PALETTES) {
    if (p.group !== grp) {
      grp = p.group;
      const h = document.createElement('div'); h.className = 'pal-group';
      h.textContent = (PALETTE_GROUPS.find(g => g.id === grp) || { name: grp }).name; box.append(h);
    }
    const b = document.createElement('button');
    b.className = 'pal'; b.dataset.id = p.id; b.title = p.name;
    b.innerHTML = `<div class="sw"><i style="background:${p.bg}"></i>${p.ink.map(c => `<i style="background:${c}"></i>`).join('')}</div><span></span>`;
    b.querySelector('span').textContent = p.name;
    b.addEventListener('click', () => setPalette(p.id));
    box.append(b);
  }
  palLabels();
}
function setPalette(id) {
  st.pal = paletteById(id).id; st.preset = ''; presetLabels(); palLabels();
  if (player) player.setPalette(pal());
  save(); if (!st.playing) draw();
}
function palLabels() { document.querySelectorAll('.pal').forEach(b => b.classList.toggle('on', b.dataset.id === st.pal)); }
function stepPalette(d) {
  const i = PALETTES.findIndex(p => p.id === st.pal);
  setPalette(PALETTES[(i + d + PALETTES.length) % PALETTES.length].id); toast(pal().name);
}

// ── board ──────────────────────────────────────────────────────────────────
function buildBoards() {
  const box = $('boards'); box.textContent = '';
  for (const id of ANIM_BOARDS) {
    const b = document.createElement('button'), bd = boardById(id); b.textContent = bd.name; b.dataset.id = id;
    b.addEventListener('click', () => { st.board = id; boardLabels(); layout(); rebuild(); });
    box.append(b);
  }
  boardLabels();
}
function boardLabels() { document.querySelectorAll('#boards button').forEach(b => b.classList.toggle('on', b.dataset.id === st.board)); }

// ── randomise ──────────────────────────────────────────────────────────────
function randomiseMotion() {
  st.anim = randomAnim(makeRng(newSeed(), 'motion'), pat(), { geo: scene && scene.pat.id === st.pat ? geoInfo(scene.G) : null });
  st.preset = ''; st.t = 0; presetLabels(); buildChannels(); buildMorph(); syncLoop(); motionChanged();
  toast('New motion: ' + Object.keys(st.anim.ch).filter(k => st.anim.ch[k].on).map(k => CHANNELS[k].label.toLowerCase()).join(', '));
}
// A pattern, palette and density (pattern-designer taste.js) and a motion
// that suits its family.
function surpriseMe() {
  const rng = makeRng(newSeed(), 'surprise'), pick = surprise(rng, PATTERNS, PALETTES, DCAP);
  Object.assign(st, { preset: '', pat: pick.pat.id, P: pick.P, pal: pick.pal.id, mode: 'auto', lw: pick.lw, D: Math.max(pick.D, densityDefault(COARSE) - 0.2), detail: pick.detail, seed: newSeed(), mods: [], t: 0 });
  st.anim = randomAnim(rng, pick.pat);
  syncAll(); rebuild(); toast(`${pick.pat.name} on ${pick.pal.name}`);
}
function shakeParams() { st.P = tasteParams(pat(), makeRng(newSeed(), 'shake')); st.preset = ''; presetLabels(); buildParams(); rebuild(); }

// ── panel and sheet ────────────────────────────────────────────────────────
const panel = $('panel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  layout(); drawTimeline();
}
function bindPanel() {
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  panel.addEventListener('transitionend', e => { if (e.target === panel) { layout(); drawTimeline(); } });
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* no capture */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
    layout();
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

// ── bind ───────────────────────────────────────────────────────────────────
function syncLoop() { $('loopLen').value = String(L()); }
function syncAll() {
  const p = pat();
  st.P = clampParams(p, st.P || defaults(p));
  st.anim = cleanAnim(st.anim);
  $('patSel').value = st.pat; $('seed').value = st.seed;
  $('patBlurb').textContent = p.blurb || '';
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode));
  $('lw').value = st.lw; $('lwV').textContent = (+st.lw).toFixed(2);
  syncLoop(); buildParams(); buildChannels(); buildMorph(); presetLabels(); palLabels(); boardLabels(); layout(); drawTimeline(); transportUI();
  if (player) player.setPalette(pal());
}
function bindUI() {
  $('seed').addEventListener('change', () => setSeed(+$('seed').value));
  $('seedNew').addEventListener('click', () => setSeed(newSeed()));
  $('paramReset').addEventListener('click', () => { st.P = defaults(pat()); buildParams(); rebuild(); });
  $('paramShake').addEventListener('click', shakeParams);
  $('randMotion').addEventListener('click', randomiseMotion);
  $('allOff').addEventListener('click', () => { for (const id of CHANNEL_IDS) st.anim.ch[id].on = 0; st.anim.morph = null; st.preset = ''; presetLabels(); buildChannels(); buildMorph(); motionChanged(); });
  $('randBtn').addEventListener('click', randomiseMotion);
  $('surpriseBtn').addEventListener('click', surpriseMe);
  $('dockName').addEventListener('click', () => stepPreset(1));
  $('dockRand').addEventListener('click', surpriseMe);
  $('dockPal').addEventListener('click', () => stepPalette(1));
  document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => { st.mode = b.dataset.m; st.preset = ''; syncAll(); rebuild(); }));
  $('lw').addEventListener('input', () => { st.lw = +$('lw').value; $('lwV').textContent = st.lw.toFixed(2); save(); if (!st.playing) draw(); });
  addEventListener('keydown', e => {
    if (saverOn || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); play(!st.playing); }
    else if (e.key === ',') step(-1);
    else if (e.key === '.') step(1);
    else if (e.key === 'r' || e.key === 'R') randomiseMotion();
    else if (e.key === 'u' || e.key === 'U') surpriseMe();
    else if (e.key === 'ArrowRight') stepPattern(1);
    else if (e.key === 'ArrowLeft') stepPattern(-1);
    else if (e.key === 'p' || e.key === 'P') stepPalette(1);
    else if (e.key === 'n' || e.key === 'N') stepPreset(1);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; }
    else if (st.playing && !saverOn && !raf) { last = 0; gov.reset(); raf = requestAnimationFrame(loop); }
  });
}

// ── boot ───────────────────────────────────────────────────────────────────
const restored = load();
if (!restored) { const pr = presetById('tidal-arcs'); st.anim = presetAnim(pr); st.P = defaults(byId(pr.pat)); }
bindUI(); bindPanel(); bindTransport(); bindTimeline(); bindMorph(); buildPresets(); buildPattern(); buildPalettes(); buildBoards();
if (PHONE_Q.matches) { panel.classList.remove('open'); document.body.classList.add('panel-closed'); }
syncAll();
addEventListener('resize', () => { layout(); drawTimeline(); });
rebuild();
play(st.playing);
if (REDUCED) toast('Reduced motion: paused at a quarter speed. Press play to start.');

const exp = installExport({
  get scene() { return scene; }, get player() { return player; }, get st() { return st; }, pal, toast,
  fileBase: () => `${st.pat}-${st.seed}-${L()}s`,
  clip: () => clipRings,
});
function bindExport() { exp.bind(); }
bindExport();

installSaver({
  runner,
  enter() { saverOn = true; if (raf) cancelAnimationFrame(raf); raf = 0; },
  exit() { saverOn = false; layout(); if (st.playing) { last = 0; raf = requestAnimationFrame(loop); } else draw(); },
});
window.__pa = {
  st, get scene() { return scene; }, get player() { return player; }, get level() { return level; }, gov, applyLevel,
  applyPreset, setPattern, setPalette, randomiseMotion, surpriseMe, play, step, draw, layout, setOpen, rebuild, exp,
  setGovernor(on) { govOn = !!on; },
  get ready() { return !!scene && !busy && !pending; },
};
