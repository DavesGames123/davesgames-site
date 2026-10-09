// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · main.js — world state, controls, sound, music, page API
// ────────────────────────────────────────────────────────────────────────────
//  main.js owns ONE world object. The 2D view (view2d.js) and the 3D view
//  (view3d/index.js) read the same StringSim objects from it, so both views
//  show the same strings at the same simulated time. The loop steps the
//  sims with the engine's viewStepper: slow motion changes how much
//  simulated time passes per wall second, never the physics.
//
//  Sound comes from engine/audio.js. The AudioContext starts on the first
//  user gesture only. Volume is low by default. All sound stops and the 3D
//  renderer is released on pagehide.
//
//  Music is the playback panel (playback/ui.js, mounted in #musicHost): MIDI
//  tracks stepped one note or chord at a time or played, and chord
//  patterns. Each event calls __strings.playFrets, which frets and plucks
//  the sims and plays the sound.
//
//  PAGE API  window.__strings  (for the saver agent and node tests)
//    loadInstrument(key)          'steel' | 'classical' | 'violin'
//    selectString(i)              string index, 0 = lowest
//    setFret(i, fret)             0 = open; -1 = muted
//    pluck(i, { pos, amp })       pos from the bridge (0..1), amp in metres
//    strike(i, { pos }) / bow(i, { pos }) / stopBow(i)
//    harmonic(i, n)               light touch at 1/n, then a pluck
//    playNote({ string, fret } | midi, { sound })   frets, plucks, sounds
//    playChord(name | frets[], { dir, sound })      'Am', 'G7' or [3,2,0,0,0,3]
//    setTimeScale(s)              simulated s per wall s, 1 .. 1e-4
//    setExaggeration(x)           display factor on u, 1 .. 500
//    setField(id)                 'a' | 'aTension' | 'aStiff' | 'aDamp' | 'v' | 'u'
//    setColormap(id, { reverse, gamma })   any ct-lab map id
//    setTool(t)                   'pluck' | 'strike' | 'bow' | 'touch'
//    showAll(bool)                all strings in the 2D view
//    camera(id)                   3D preset (view3d CAMERA_PRESETS)
//    pause(bool)
//    playFrets({ instrument, frets, direction, velocity, sound, duration, notes })
//                                 the playback panel's call (frets -1 = not played)
//    getTimeScale() / getInstrument() / setInstrument(key)  read by the panel
//    playback                     the panel controller: step(), back(),
//                                 toggle(), stop(), setSource('song'|'chords'),
//                                 loadTrack(id) (set by playback/ui.js)
//    state()                      a plain snapshot of the world
//    stopSound()                  stop every voice now
//    world, view2d, view3d(), audio
//
//  SAVER  saver.js sets window.snSaver. It sets world.silent (ensureAudio
//  then starts no sound) and world.hook(phase, dtWall), which frame()
//  calls with 'before' (shot director, 3D spring camera) and 'after' (the
//  composite canvas, drawn in the same task as the WebGL render).
//
//  SECTION MAP   (grep -n "<anchor>" main.js)
//    world ............... "const world ="
//    sims ................ "function buildSims"
//    excitations ......... "function excite"
//    sound ............... "function soundNote"
//    music ............... "function playFrets"
//    3D mount ............ "async function mount3D"
//    controls ............ "function bindControls"
//    phone sheet ......... "function setSheet"
//    loop ................ "function frame"
//    page API ............ "window.__strings"
// ════════════════════════════════════════════════════════════════════════════

import { StringSim, hMin, viewStepper, modalFrequencies, modalDecay, pluckCoefficients } from './engine/strings.js';
import { INSTRUMENTS, stringParams, stoppedLength, noteName, freqToMidi, midiToFreq, TIME_SCALES } from './engine/instruments.js';
import { AudioEngine, renderModal, renderSim, strumOffsets } from './engine/audio.js';
import { CHORD_SHAPES, findShape, STANDARD } from './engine/chords.js';
import { mapFretting } from './engine/midi.js';
import { HARMONIC_TOUCH } from './engine/harmonics.js';
import { mountPlayback } from './playback/ui.js';
import { createView2D, FIELDS } from './view2d.js';
import { createPicker } from '../ct-lab/colormaps/picker.js';
import * as CM from '../ct-lab/colormaps/maps.js';
import { initExplainer } from './explain.js';
import { installSaver } from './saver.js';

const $ = (id) => document.getElementById(id);
const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const FIELD3 = { a: 'accel', v: 'velocity', u: 'displacement', aTension: 'tension', aStiff: 'accel', aDamp: 'accel' };

// ── world ─────────────────────────────────────────────────────────────────
const world = {
  instKey: 'steel',
  inst: INSTRUMENTS.steel,
  sims: [],
  frets: [],
  sel: 0,
  timeScale: 0.01,
  exag: 40,
  field: 'a',
  cmap: { id: 'magma', reverse: false, gamma: 1 },
  showAll: false,
  arrows: true,
  tool: 'pluck',
  harmonic: 0,
  pluckPos: 0.2,
  paused: false,
  mods: { tension: 1, gauge: 1, damping: 1, stiffness: 1 },
  bow: { vel: 0.12, force: 0.5 },
  simTime: 0,
  params(i, fret = world.frets[i] || 0) { return modParams(i, Math.max(0, fret)); },
  f1(i) { const s = world.sims[i]; return s ? s.f1Stiff : 0; },
  excite: (i, kind, args) => excite(i, kind, args),
  select: (i) => selectString(i),
  bowMove: (i, pos) => { const s = world.sims[i]; if (s && s.bowing) s.bow({ ...s.bowing, pos }); },
};

const MIN_N = 16;

function nominal() {
  const m = world.mods;
  return m.tension === 1 && m.gauge === 1 && m.damping === 1 && m.stiffness === 1;
}

/** Engine params of string i at a fret, with the physics sliders applied. */
function modParams(i, fret) {
  const p = stringParams(world.inst, i, fret);
  const m = world.mods;
  p.T *= m.tension;
  p.mu *= m.gauge * m.gauge;              // mu grows with the cross-section
  p.kappa *= m.gauge * m.stiffness;       // kappa^2 = E I / mu ~ d^2
  p.sigma0 *= m.damping;
  p.sigma1 *= m.damping;
  // a very stiff, short string needs a coarse grid; below MIN_N points the
  // scheme has too few modes to be useful, so the stiffness is capped there
  const k = 1 / 44100, c = Math.sqrt(p.T / p.mu);
  while (p.kappa > 1e-9 && p.L / hMin(c, p.kappa, p.sigma1, k) < MIN_N) p.kappa *= 0.85;
  return p;
}

let stepper = viewStepper({ timeScale: world.timeScale });
const pending = [];   // excitations delayed in simulated time (strum spread)

// ── sims ──────────────────────────────────────────────────────────────────
function buildSims() {
  const inst = world.inst;
  if (world.frets.length !== inst.strings.length) world.frets = inst.strings.map(() => 0);
  world.sims = inst.strings.map((_, i) => new StringSim(world.params(i, world.frets[i])));
  world.simTime = 0;
  pending.length = 0;
  stepper = viewStepper({ timeScale: world.timeScale, k: world.sims[0].k });
  view2d?.resetScales();
  view2d?.relayout();
  if (view3) { view3.attachAll(world.sims); view3.setFrets(world.frets.map((f) => f)); }
  renderReadout();
}

function setFret(i, fret) {
  const sim = world.sims[i];
  if (!sim) return;
  if (fret < 0) { world.frets[i] = -1; sim.damp(0); }
  else {
    const f = Math.min(world.inst.frets, Math.round(fret));
    world.frets[i] = f;
    sim.setLength(stoppedLength(world.inst.scaleM, f));
  }
  view3?.setFret(i, world.frets[i]);
  if (i === world.sel) syncFretUI();
}

function selectString(i) {
  const was = world.sel;
  world.sel = Math.max(0, Math.min(world.sims.length - 1, i));
  // the single-string lane is laid out for one string: lay it out again
  if (world.sel !== was && !world.showAll) view2d?.relayout();
  view3?.highlight(world.sel);
  if (view3 && camPreset === 'string') view3.setCamera('string', { animate: true, string: world.sel });
  syncStringUI();
  renderReadout();
}

// ── excitations ──────────────────────────────────────────────────────────
const DEFAULT_AMP = 0.002;

function excite(i, kind, args = {}, { sound = true } = {}) {
  const sim = world.sims[i];
  if (!sim) return;
  if (world.frets[i] < 0) setFret(i, 0);
  if (sound) ensureAudio();   // a silent API call must not start the AudioContext
  const pos = args.pos ?? world.pluckPos;
  if (kind === 'pluck') {
    const amp = args.amp == null ? DEFAULT_AMP : Math.max(-0.01, Math.min(0.01, args.amp));
    sim.stopBow();
    sim.pluck({ pos, amp, width: 0.02 });
    if (sound) soundNote(i, { pos, vel: Math.min(1, 0.35 + Math.abs(amp) / 0.004) });
  } else if (kind === 'strike') {
    sim.stopBow();
    sim.strike({ pos, vel: args.vel ?? 0.6, width: 0.03 });
    if (sound) soundNote(i, { pos, vel: 0.8 });
  } else if (kind === 'bow') {
    sim.bow({ pos, vel: world.bow.vel, force: world.bow.force });
    view3?.setBow({ string: i, pos, speed: world.bow.vel, on: true });
    if (sound) soundBowed(i, pos);
  } else if (kind === 'bowStop') {
    sim.stopBow();
    view3?.setBow(null);
  } else if (kind === 'touch') {
    // natural harmonic: pluck at the pluck point, touch the node lightly
    const n = args.n || Math.round(1 / Math.max(1e-3, Math.min(pos, 1 - pos)));
    const pp = Math.abs(Math.sin(n * Math.PI * world.pluckPos)) < 0.2 ? 0.13 : world.pluckPos;
    sim.stopBow();
    sim.pluck({ pos: pp, amp: DEFAULT_AMP, width: 0.02 });
    sim.touch({ pos, ...HARMONIC_TOUCH });
    if (n > 1) { world.harmonic = n; $('harm').value = String(Math.min(8, n)); }
    if (sound) soundHarmonic(i, pp, pos);
  }
  if (i !== world.sel && !world.showAll) selectString(i);
}

// ── sound ────────────────────────────────────────────────────────────────
const audio = new AudioEngine({ volume: 0.12 });
const custom = new Map();     // string key -> own voice (modified physics)
let unbindHide = null;

function ensureAudio() {
  if (world.silent) return false;   // the screensaver keeps the sound off
  if (audio.started) return true;
  const ok = audio.start();
  if (ok && !unbindHide) unbindHide = audio.bindPagehide(window);
  return ok;
}

function playData(i, data, vel = 0.8) {
  if (!ensureAudio() || !audio.ctx) return;
  const ctx = audio.ctx;
  const key = `${world.instKey}|${i}`;
  const old = custom.get(key);
  if (old) { try { old.g.gain.setTargetAtTime(0, ctx.currentTime, 0.02); old.src.stop(ctx.currentTime + 0.2); } catch (_) { /* gone */ } }
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  if (b.copyToChannel) b.copyToChannel(data, 0); else b.getChannelData(0).set(data);
  const src = ctx.createBufferSource();
  src.buffer = b;
  const g = ctx.createGain();
  g.gain.value = Math.max(0, Math.min(1, vel));
  src.connect(g); g.connect(audio.chain(world.instKey).input);
  src.start();
  const v = { src, g };
  custom.set(key, v);
  src.onended = () => { if (custom.get(key) === v) custom.delete(key); try { g.disconnect(); } catch (_) { /* gone */ } };
}

function stopCustom() {
  if (!audio.ctx) return;
  for (const v of custom.values()) { try { v.g.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.01); v.src.stop(audio.ctx.currentTime + 0.1); } catch (_) { /* gone */ } }
  custom.clear();
}

/** One plucked note of string i at its current fret. */
function soundNote(i, { pos = world.pluckPos, vel = 0.8, when = 0, duration = null } = {}) {
  const fret = Math.max(0, world.frets[i]);
  if (!ensureAudio()) return;
  if (nominal()) {
    audio.playNote({ instrument: world.instKey, string: i, fret, velocity: vel, when, pos, duration });
  } else {
    const fs = audio.ctx.sampleRate;
    playData(i, renderModal(world.params(i, fret), { pos, fs, seconds: 2.6 }), vel);
  }
}

function soundBowed(i, pos) {
  if (!ensureAudio()) return;
  const fs = audio.ctx.sampleRate;
  const data = renderSim(world.params(i), { fs, seconds: 1.6, bow: { pos, vel: world.bow.vel, force: world.bow.force }, bowSeconds: 1.2 });
  playData(i, data, 0.7);
}

/** A natural harmonic: only the modes with a node at the touch point ring. */
function soundHarmonic(i, pluckPos, touchPos) {
  if (!ensureAudio()) return;
  const fs = audio.ctx.sampleRate, p = world.params(i), nMax = 40, seconds = 2.4;
  const f = modalFrequencies(p, nMax), s = modalDecay(p, nMax), b = pluckCoefficients(pluckPos, 1, nMax);
  const out = new Float32Array(Math.round(seconds * fs));
  for (let n = 1; n <= nMax; n++) {
    if (Math.abs(Math.sin(n * Math.PI * touchPos)) > 0.05 || f[n - 1] > fs * 0.45) continue;
    const a = b[n - 1] * n, w = (2 * Math.PI * f[n - 1]) / fs, dec = Math.exp(-s[n - 1] / fs);
    let re = a, im = 0;
    const c = Math.cos(w), sn = Math.sin(w);
    for (let t = 0; t < out.length; t++) {
      out[t] += re;
      const r2 = (re * c - im * sn) * dec; im = (re * sn + im * c) * dec; re = r2;
    }
  }
  let m = 0;
  for (const v of out) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let t = 0; t < out.length; t++) out[t] *= 0.9 / m;
  const fade = Math.min(out.length, 64);
  for (let t = 0; t < fade; t++) out[t] *= t / fade;
  playData(i, out, 0.8);
}

function stopAllSound() {
  audio.stopAll();
  stopCustom();
}

// ── music ────────────────────────────────────────────────────────────────
// The music panel is playback/ui.js (mountPlayback). It owns the song and
// chord sessions, the TAB strip and the ratio graphs. It calls
// __strings.playFrets for each note, group or strum, and reads the time
// scale and the instrument from __strings.
let playback = null;

/**
 * Fret and pluck strings, with an optional strum spread in SIMULATED time
 * (so a strum also slows down in slow motion), and play the sound.
 * frets: per string, null = leave the string alone, -1 = mute.
 */
function playFrets(frets, { dir = 'down', vel = 0.75, spreadMs = 30, sound = true, duration = null } = {}) {
  const n = world.sims.length;
  const offs = strumOffsets(n, { direction: dir === 'U' || dir === 'up' ? 'up' : 'down', spreadMs });
  if (sound) ensureAudio();
  const t0 = audio.ctx ? audio.ctx.currentTime + 0.02 : 0;
  let top = -1;
  for (let i = 0; i < n; i++) {
    const f = frets[i];
    if (f == null) continue;
    if (f < 0) { setFret(i, -1); continue; }
    setFret(i, f);
    top = i;
    const run = () => { const s = world.sims[i]; if (s && world.frets[i] >= 0) { s.stopBow(); s.pluck({ pos: world.pluckPos, amp: DEFAULT_AMP * (0.6 + 0.5 * vel), width: 0.02 }); } };
    if (offs[i] > 0) pending.push({ t: world.simTime + offs[i], run }); else run();
    if (sound) soundNote(i, { vel, when: t0 + offs[i], duration });
  }
  if (top >= 0 && !world.showAll) selectString(top);
}

/** The playback panel's call: { instrument, frets, direction, velocity, sound, duration, notes }. */
function playFromPanel({ instrument, frets, direction = 'down', velocity = 0.75, sound = true, duration = null, notes = [] } = {}) {
  if (instrument && instrument !== world.instKey) {
    // a chord pattern on the violin page: the panel strums a guitar shape
    if (sound && ensureAudio()) audio.playChord({ instrument, frets, direction, velocity, duration });
    return;
  }
  // a chord (four or more notes) mutes the strings it does not use; a
  // single note or a double stop leaves the other strings ringing
  const chord = notes.length >= 4;
  const fr = frets.map((f) => (f >= 0 ? f : chord ? -1 : null));
  playFrets(fr, { dir: direction, vel: velocity, spreadMs: chord ? 32 : 0, sound, duration });
}

function stepMusic() {
  ensureAudio();
  if (playback) playback.step();
}

// ── 3D mount ─────────────────────────────────────────────────────────────
let view3 = null, camPreset = 'instrument', view3Failed = false;

async function mount3D() {
  const msg = $('msg3');
  let mod;
  try {
    mod = await import('./view3d/index.js');
  } catch (e) {
    msg.textContent = 'The 3D instrument could not load. The 2D view works on its own.';
    console.info('string-lab 3D import:', e && e.message);
    view3Failed = true;
    return;
  }
  try {
    const host = $('view3');
    const r = host.getBoundingClientRect();
    view3 = mod.createStringView3D($('c3'), {
      instrument: world.instKey,
      field: FIELD3[world.field],
      colormap: world.cmap.id, reverse: world.cmap.reverse, gamma: world.cmap.gamma,
      exaggeration: world.exag,
      controls: true,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      quality: PHONE_Q.matches ? 'low' : 'high',
    });
    view3.resize(Math.max(1, r.width), Math.max(1, r.height));
    view3.attachAll(world.sims);
    view3.setFrets(world.frets.slice());
    view3.highlight(world.sel);
    view3.setCamera(camPreset, { animate: false, string: world.sel });
    msg.hidden = true;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => { const b = host.getBoundingClientRect(); view3?.resize(Math.max(1, b.width), Math.max(1, b.height)); }).observe(host);
    }
    // tap (no drag) on a string in 3D plucks it
    const c3 = $('c3');
    let down = null;
    c3.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    c3.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const hit = view3?.stringAt(e.clientX, e.clientY);
      if (hit) excite(hit.string, world.tool === 'bow' ? 'pluck' : world.tool === 'touch' ? 'touch' : world.tool, { pos: hit.pos });
    });
  } catch (e) {
    view3 = null; view3Failed = true;
    msg.hidden = false;
    msg.textContent = /webgl/i.test(String(e && e.message)) ? 'WebGL is not available here, so the 3D view cannot draw. The 2D view still works.' : 'The 3D view could not start. The 2D view still works.';
    console.warn('string-lab 3D:', e);
  }
}

/** Release the 3D renderer and its GL context (pagehide, errors). */
function dispose3D() {
  if (!view3) return;
  const r = view3.renderer;
  try { view3.dispose(); } catch (_) { /* gone */ }
  try { r?.forceContextLoss?.(); } catch (_) { /* gone */ }
  view3 = null;
  // a lost context cannot be used again: a later mount gets a new canvas
  const old = $('c3');
  if (old) { const c = old.cloneNode(false); old.replaceWith(c); }
}

// ── controls ─────────────────────────────────────────────────────────────
const fmtTs = (s) => (s >= 0.999 ? 'Real time' : `1/${Math.round(1 / s)}`);
let picker = null;

function setTimeScale(s) {
  world.timeScale = Math.max(1e-4, Math.min(1, s));
  stepper.timeScale = world.timeScale;
  $('ts').value = String(Math.log10(world.timeScale));
  $('tsV').textContent = fmtTs(world.timeScale);
  $('dockSlowV').textContent = fmtTs(world.timeScale).replace('Real time', 'real');
  for (const b of document.querySelectorAll('[data-ts]')) b.classList.toggle('on', Math.abs(+b.dataset.ts - world.timeScale) < 1e-9);
}

function setExaggeration(x) {
  world.exag = Math.max(1, Math.min(500, x));
  const v = String(Math.log10(world.exag));
  $('ex').value = v; $('ex2').value = v;
  $('exV').textContent = `×${world.exag < 10 ? world.exag.toFixed(1) : Math.round(world.exag)}`;
  view3?.setExaggeration(world.exag);
}

function setField(f) {
  if (!FIELDS[f]) return;
  world.field = f;
  for (const b of document.querySelectorAll('#fieldChips button')) b.classList.toggle('on', b.dataset.f === f);
  view3?.setField(FIELD3[f]);
  view2d?.resetScales();
}

function setColormap(id, opts = {}) {
  if (!CM.has(id)) return;
  world.cmap = { id, reverse: opts.reverse ?? world.cmap.reverse, gamma: opts.gamma ?? world.cmap.gamma };
  picker?.set(world.cmap, { silent: true });
  view3?.setColormap(id, { reverse: world.cmap.reverse, gamma: world.cmap.gamma });
}

function setTool(t) {
  world.tool = t;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
  if (t !== 'bow') { for (const s of world.sims) s.stopBow(); view3?.setBow(null); }
}

function setPaused(p) {
  world.paused = !!p;
  $('tPause').textContent = world.paused ? 'Run' : 'Pause';
  $('tPause').classList.toggle('on', world.paused);
  $('dockPauseV').textContent = world.paused ? 'Run' : 'Pause';
  $('dockPause').classList.toggle('on', world.paused);
}

function loadInstrument(key) {
  if (!INSTRUMENTS[key]) return;
  stopAllSound();
  world.instKey = key;
  world.inst = INSTRUMENTS[key];
  world.frets = world.inst.strings.map(() => 0);
  world.sel = Math.min(world.sel, world.inst.strings.length - 1);
  world.pluckPos = world.inst.pluckPos;
  if (view3) view3.setInstrument(key);
  buildSims();
  for (const b of document.querySelectorAll('#instSeg button')) b.classList.toggle('on', b.dataset.inst === key);
  $('fret').max = String(world.inst.frets);
  $('instNote').textContent = `${world.inst.label}: ${(world.inst.scaleM * 1000).toFixed(0)} mm scale, ${world.inst.strings.length} strings (${world.inst.strings.map((s) => s.name).join(' ')}).${world.inst.bowed ? ' No frets: each step is a semitone stop.' : ''}`;
  $('chordNote').textContent = world.inst.bowed ? 'Chord shapes are for the guitars. Choose a guitar to strum them.' : '';
  document.querySelector('[data-cam="bow"]').hidden = !world.inst.bowed;
  $('pos').value = String(world.pluckPos); $('posV').textContent = world.pluckPos.toFixed(2);
  syncStringUI();
  if (world.inst.bowed && world.tool === 'pluck') setTool('bow');
}

function syncStringUI() {
  const host = $('stringChips');
  host.replaceChildren(...world.inst.strings.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s.name; b.dataset.i = String(i);
    b.className = i === world.sel ? 'on' : '';
    b.addEventListener('click', () => selectString(i));
    return b;
  }));
  syncFretUI();
}

function syncFretUI() {
  const f = Math.max(0, world.frets[world.sel] || 0);
  $('fret').value = String(f);
  $('fretV').textContent = world.frets[world.sel] < 0 ? 'muted' : String(f);
  const s = world.inst.strings[world.sel];
  const sim = world.sims[world.sel];
  if (!sim) return;
  const f1 = sim.f1Stiff;
  $('noteRead').textContent = `${s.name} string at fret ${f}: ${noteName(Math.round(freqToMidi(f1)))}, ${f1.toFixed(2)} Hz, vibrating length ${(sim.L * 1000).toFixed(1)} mm.`;
}

function renderReadout() {
  const sim = world.sims[world.sel];
  if (!sim) return;
  const s = world.inst.strings[world.sel];
  const rows = [
    ['String', `${s.name} · ${s.gauge}`],
    ['Material', s.material],
    ['Length L', `${(sim.L * 1000).toFixed(1)} mm`],
    ['Tension T', `${sim.T.toFixed(1)} N`],
    ['Mass μ', `${(sim.mu * 1e3).toFixed(3)} g/m`],
    ['Wave speed c', `${sim.c.toFixed(1)} m/s`],
    ['f₁', `${sim.f1Stiff.toFixed(2)} Hz`],
    ['Inharmonicity B', sim.B.toExponential(2)],
    ['Grid points N', String(sim.N)],
  ];
  $('readout').replaceChildren(...rows.map(([k, v]) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = k;
    const b = document.createElement('td'); b.textContent = v;
    tr.append(a, b); return tr;
  }));
  syncFretUI();
  for (const b of document.querySelectorAll('#stringChips button')) b.classList.toggle('on', +b.dataset.i === world.sel);
}

function markChord(name) {
  for (const b of document.querySelectorAll('#chordGrid button')) b.classList.toggle('on', b.textContent === name);
}

function toast(t) {
  const el = $('toast');
  el.textContent = t; el.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('show'), 2600);
}

function bindControls() {
  for (const b of document.querySelectorAll('#instSeg button')) b.addEventListener('click', () => loadInstrument(b.dataset.inst));
  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('fret').addEventListener('input', () => { setFret(world.sel, +$('fret').value); renderReadout(); });
  $('fret').addEventListener('change', () => excite(world.sel, 'pluck', {}));
  $('pos').addEventListener('input', () => { world.pluckPos = +$('pos').value; $('posV').textContent = world.pluckPos.toFixed(2); });
  $('harm').addEventListener('change', () => { world.harmonic = +$('harm').value; });
  $('bPluck').addEventListener('click', () => excite(world.sel, 'pluck', {}));
  $('bAll').addEventListener('click', () => playFrets(world.frets.map((f) => Math.max(0, f)), { spreadMs: 40 }));
  $('bMute').addEventListener('click', () => { for (const s of world.sims) { s.stopBow(); s.damp(0); } view3?.setBow(null); stopAllSound(); });

  // time
  const tsHost = $('tsChips'), tsSeg = $('tsSeg');
  for (const t of TIME_SCALES) {
    for (const host of [tsHost, tsSeg]) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.ts = String(t.value); b.textContent = t.label;
      b.addEventListener('click', () => setTimeScale(t.value));
      host.appendChild(b);
    }
  }
  $('ts').addEventListener('input', () => setTimeScale(10 ** +$('ts').value));
  for (const id of ['ex', 'ex2']) $(id).addEventListener('input', () => setExaggeration(10 ** +$(id).value));
  $('tPause').addEventListener('click', () => setPaused(!world.paused));
  $('tPluck').addEventListener('click', () => excite(world.sel, 'pluck', {}));
  $('tStep').addEventListener('click', stepMusic);

  // physics
  const phys = [['ten', 'tension', (v) => `${Math.round(v * 100)}%`], ['gau', 'gauge', (v) => `${Math.round(v * 100)}%`], ['dmp', 'damping', (v) => `×${v.toFixed(2)}`]];
  for (const [id, key, fmt] of phys) {
    $(id).addEventListener('input', () => { world.mods[key] = +$(id).value; $(id + 'V').textContent = fmt(world.mods[key]); });
    $(id).addEventListener('change', () => { buildSims(); excite(world.sel, 'pluck', {}); });
  }
  // stiffness slider is log: 0..1.6 -> x1..x40
  $('stf').addEventListener('input', () => { world.mods.stiffness = 10 ** +$('stf').value; $('stfV').textContent = `×${world.mods.stiffness < 10 ? world.mods.stiffness.toFixed(1) : Math.round(world.mods.stiffness)}`; });
  $('stf').addEventListener('change', () => { buildSims(); excite(world.sel, 'pluck', {}); });
  $('bPhysReset').addEventListener('click', () => {
    world.mods = { tension: 1, gauge: 1, damping: 1, stiffness: 1 };
    $('ten').value = '1'; $('gau').value = '1'; $('dmp').value = '1'; $('stf').value = '0';
    $('tenV').textContent = '100%'; $('gauV').textContent = '100%'; $('dmpV').textContent = '×1'; $('stfV').textContent = '×1';
    buildSims();
  });

  // colour
  const fc = $('fieldChips');
  for (const [k, f] of Object.entries(FIELDS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.f = k; b.textContent = f.label;
    b.addEventListener('click', () => setField(k));
    fc.appendChild(b);
  }
  $('arrows').addEventListener('change', () => { world.arrows = $('arrows').checked; });
  try {
    picker = createPicker($('cmapHost'), { value: world.cmap.id, compact: true, label: 'Colour map' });
    picker.addEventListener('change', (e) => setColormap(e.detail.id, { reverse: e.detail.reverse, gamma: e.detail.gamma }));
  } catch (e) { console.warn('string-lab picker:', e); }
  $('bShowAll').addEventListener('click', () => { world.showAll = !world.showAll; $('bShowAll').classList.toggle('on', world.showAll); view2d.relayout(); });

  // 3D cameras
  for (const b of document.querySelectorAll('[data-cam]')) b.addEventListener('click', () => camera(b.dataset.cam));

  // chords
  const grid = $('chordGrid');
  const open = CHORD_SHAPES.filter((c) => !c.barre).slice(0, 18).concat(CHORD_SHAPES.filter((c) => c.barre).slice(0, 6));
  grid.replaceChildren(...open.map((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = c.name;
    b.addEventListener('click', () => playChordName(c.name));
    return b;
  }));
  // sound
  $('sMute').addEventListener('click', () => {
    ensureAudio();
    audio.setMuted(!audio.muted);
    $('sMute').textContent = audio.muted ? 'Sound off' : 'Sound on';
    $('sMute').classList.toggle('on', audio.muted);
  });
  $('vol').addEventListener('input', () => { audio.setVolume(+$('vol').value); $('volV').textContent = `${Math.round(+$('vol').value * 100)}%`; });
  $('method').addEventListener('change', () => { audio.method = $('method').value; });

  // dock
  $('dockPanel').addEventListener('click', () => setSheet(!$('panel').classList.contains('open')));
  $('panelClose').addEventListener('click', () => setSheet(false));
  $('dockPluck').addEventListener('click', () => excite(world.sel, 'pluck', {}));
  $('dockPause').addEventListener('click', () => setPaused(!world.paused));
  $('dockSlow').addEventListener('click', () => {
    const vals = TIME_SCALES.map((t) => t.value);
    const i = vals.findIndex((v) => Math.abs(v - world.timeScale) < 1e-9);
    setTimeScale(vals[(i + 1) % vals.length]);
  });
  $('dockStep').addEventListener('click', stepMusic);

  window.addEventListener('keydown', (e) => {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); excite(world.sel, 'pluck', {}); }
    else if (e.key === 'p') setPaused(!world.paused);
    else if (e.key === 'ArrowRight') stepMusic();
    else if (/^[1-6]$/.test(e.key)) { const i = +e.key - 1; if (i < world.sims.length) { selectString(i); excite(i, 'pluck', {}); } }
  });
}

function playChordName(name, { dir = 'down', sound = true } = {}) {
  if (world.inst.bowed) { toast('Chord shapes are for the guitars.'); return; }
  const shape = findShape(name);
  if (!shape) return;
  playFrets(shape.frets, { dir, vel: 0.75, spreadMs: 36, sound });
  $('chordNote').textContent = `${shape.name}: frets ${shape.frets.map((f) => (f < 0 ? 'x' : f)).join(' ')} (low E to high E)`;
  markChord(shape.name);
}

function camera(id) {
  camPreset = id;
  for (const b of document.querySelectorAll('[data-cam]')) b.classList.toggle('on', b.dataset.cam === id);
  view3?.setCamera(id, { animate: true, string: world.sel });
}

// ── phone sheet ──────────────────────────────────────────────────────────
function setSheet(open) {
  const p = $('panel');
  p.classList.toggle('open', open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
  occlusion();
}

/** Portrait phone: the lab ends at the top of the sheet. */
function occlusion() {
  const p = $('panel');
  const land = window.matchMedia('(max-height:500px) and (orientation:landscape) and (pointer:coarse)').matches;
  const root = document.documentElement.style;
  if (!PHONE_Q.matches || !p.classList.contains('open')) { root.setProperty('--sheet-h', '0px'); root.setProperty('--occ-r', '0px'); return; }
  if (land) { root.setProperty('--occ-r', `${p.getBoundingClientRect().width}px`); root.setProperty('--sheet-h', '0px'); return; }
  const h = p.classList.contains('full') ? 0 : p.offsetHeight;
  root.setProperty('--sheet-h', `${Math.round(h + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 64))}px`);
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindSheet() {
  const grip = $('sheetGrip');
  let gy = null;
  grip.addEventListener('pointerdown', (e) => { gy = e.clientY; grip.setPointerCapture?.(e.pointerId); });
  grip.addEventListener('pointerup', (e) => {
    if (gy == null) return;
    const dy = e.clientY - gy; gy = null;
    const p = $('panel');
    if (dy < -40) p.classList.add('full');
    else if (dy > 40) { if (p.classList.contains('full')) p.classList.remove('full'); else setSheet(false); }
    setTimeout(occlusion, 320);
  });
  window.addEventListener('resize', occlusion);
  // hide the dock while the explainer is in view
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((es) => { for (const e of es) document.body.classList.toggle('lab-out', !e.isIntersecting); }, { threshold: 0.15 }).observe($('lab'));
  }
}

// ── loop ─────────────────────────────────────────────────────────────────
let view2d = null, raf = 0, last = 0, running = true;

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (world.hook) world.hook('before', dt);
  let dtSim = 0;
  if (!world.paused && document.visibilityState !== 'hidden') {
    const n = stepper.advance(dt);
    if (n > 0) {
      // step in chunks so strum plucks land at their simulated time
      let left = n;
      const k = world.sims[0].k;
      while (left > 0) {
        let chunk = left;
        if (pending.length) {
          const nextT = Math.min(...pending.map((p) => p.t));
          chunk = Math.max(1, Math.min(left, Math.ceil((nextT - world.simTime) / k)));
        }
        for (const s of world.sims) s.step(chunk);
        world.simTime += chunk * k;
        left -= chunk;
        for (let j = pending.length - 1; j >= 0; j--) if (pending[j].t <= world.simTime + 1e-12) { const p = pending.splice(j, 1)[0]; p.run(); }
      }
      dtSim = n * k;
    }
  }
  view2d.draw();
  if (view3) {
    try { view3.frame(dt, dtSim); } catch (e) { console.warn('string-lab 3D frame:', e); dispose3D(); $('msg3').hidden = false; $('msg3').textContent = 'The 3D view stopped. The 2D view still works.'; }
  }
  if (world.hook) world.hook('after', dt);
}

function start() {
  if (!running) return;
  cancelAnimationFrame(raf);
  last = 0;
  raf = requestAnimationFrame(frame);
}

// ── boot ─────────────────────────────────────────────────────────────────
function boot() {
  buildSims();
  view2d = createView2D($('c2'), world);
  world.view2d = view2d;
  bindControls();
  bindSheet();
  loadInstrument('steel');
  setTimeScale(world.timeScale);
  setExaggeration(world.exag);
  setField(world.field);
  setTool('pluck');
  setPaused(false);
  setColormap('magma');
  // a first pluck so the page opens with a moving string
  world.sims[world.sel].pluck({ pos: world.pluckPos, amp: DEFAULT_AMP, width: 0.02 });
  view2d.resize();
  start();
  mount3D();
  window.addEventListener('strings:playback', (e) => {
    const d = e.detail || {};
    const ns = (d.notes || []).map((n) => noteName(n.midi)).join(' ');
    const name = d.kind === 'chord' ? d.strum.chord : d.step && d.step.chord ? d.step.chord : '';
    $('tRead').textContent = `${name ? name + ' · ' : ''}${ns}${d.sound === false ? ' (muted in slow motion)' : ''}`;
  });
  try { playback = mountPlayback($('musicHost'), window.__strings); } catch (e) { $('musicHost').textContent = 'The music panel could not start.'; console.warn('string-lab playback:', e); }
  try { initExplainer(document.getElementById('explain')); } catch (e) { console.warn('string-lab explainer:', e); }
  window.addEventListener('pagehide', () => {
    running = false;
    cancelAnimationFrame(raf);
    stopAllSound();
    dispose3D();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { running = true; mount3D(); start(); } });
}

// ── page API ─────────────────────────────────────────────────────────────
window.__strings = {
  loadInstrument,
  selectString,
  setFret: (i, f) => setFret(i, f),
  pluck: (i, o = {}) => excite(i, 'pluck', o, { sound: o.sound !== false }),
  strike: (i, o = {}) => excite(i, 'strike', o, { sound: o.sound !== false }),
  bow: (i, o = {}) => excite(i, 'bow', o, { sound: o.sound !== false }),
  stopBow: (i) => excite(i, 'bowStop', {}),
  harmonic: (i, n, o = {}) => excite(i, 'touch', { pos: 1 / n, n }, { sound: o.sound !== false }),
  playNote(note, { sound = true } = {}) {
    let s = note;
    if (typeof note === 'number') {
      const m = mapFretting([[note]], world.inst)[0].notes[0];
      if (!m) return null;
      s = { string: m.string, fret: m.fret };
    }
    playFrets(world.sims.map((_, i) => (i === s.string ? s.fret : null)), { sound, spreadMs: 0 });
    return s;
  },
  playChord(c, { dir = 'down', sound = true } = {}) {
    if (Array.isArray(c)) { playFrets(c, { dir, sound }); return c; }
    playChordName(c, { dir, sound });
    return findShape(c)?.frets || null;
  },
  setTimeScale,
  setExaggeration,
  setField,
  setColormap,
  setTool,
  showAll(v) { world.showAll = !!v; $('bShowAll').classList.toggle('on', world.showAll); view2d.relayout(); },
  setHarmonic(n) { world.harmonic = n; $('harm').value = String(n); },
  camera,
  pause: setPaused,
  stopSound: stopAllSound,
  playFrets: playFromPanel,
  getTimeScale: () => world.timeScale,
  getInstrument: () => world.instKey,
  setInstrument: (k) => loadInstrument(k),
  playback: null,
  state() {
    return {
      instrument: world.instKey, sel: world.sel, frets: world.frets.slice(), timeScale: world.timeScale,
      exaggeration: world.exag, field: world.field, colormap: { ...world.cmap }, tool: world.tool,
      paused: world.paused, simTime: world.simTime, mods: { ...world.mods },
      f1: world.sims.map((s) => s.f1Stiff), energy: world.sims.map((s) => s.energy()),
      view3d: !!view3, view3dFailed: view3Failed, audioStarted: audio.started,
    };
  },
  world,
  get view2d() { return view2d; },
  view3d: () => view3,
  audio,
  midiToFreq,
  STANDARD,
};

boot();
try { installSaver(window.__strings); } catch (e) { console.warn('string-lab saver:', e); }
