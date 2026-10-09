// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · saver.js — window.snSaver, the screensaver shots
// ────────────────────────────────────────────────────────────────────────────
//  The shell (lib/screensaver.js) calls snSaver.enter(opts), opts = { calm,
//  seconds, caption, seed, label }. enter hides the page GUI, turns the
//  sound OFF (world.silent, read by main.js ensureAudio) and plays shots
//  from a seeded bag: every shot once per bag, a new order each run, never
//  the same shot twice in a row. Each shot holds 6-12 s (calm makes it
//  longer). No shot uses the same colour map as the shot before it.
//
//  Shots (const SHOTS)
//    pluck    one string plucked in deep slow motion; the acceleration
//             field blooms in magma or inferno; 2D and 3D side by side
//    strum    a chord strummed across the guitar in 3D at 1/100; the
//             colour flows from string to string; the camera pushes in
//    bow      a violin bow stroke: Helmholtz motion, velocity in a
//             diverging map, the camera on the bow
//    nodes    one string at harmonic n (light touch at L/n): the 2D close-up
//             with its node marks and harmonic bars
//    melody   a bundled track stepped one note or chord at a time, with a
//             TAB strip under the 2D view
//    series   the harmonic series building: n = 1, 2, 3 ... on one string,
//             the ratio n : n-1 on the plate
//
//  Layout. The composite canvas (#slSaverCv) covers the frame. After each
//  page frame (world.hook 'after', the same task as the WebGL render) it
//  draws the 3D canvas full frame, the 2D canvas at its pane rect, and the
//  TAB strip. So the canvas returned to the shell holds every part, also
//  for a recording without tab capture. The 2D pane and the subject of the
//  3D view sit in the clear band of the plate (lib/saver-clear.js
//  plateBand). The 3D camera is a critically damped spring to preset poses
//  from view3d (setCamera, animate false); a view offset centres the
//  subject in its part of the band.
//
//  Plate: the instrument, the note or chord, the frequency, the harmonic
//  ratio and one TeX line (f_n = n f_1, the wave equation, or
//  f = (1/2L) sqrt(T/mu)). No code (memory saver-no-code-pages).
//
//  The pure parts (bag, durations, slow-motion choice, spring, plates,
//  TAB columns) have no DOM: saver-tests.mjs runs them in node.
//
//  grep -n targets
//    const TEX ............ plate equations
//    export function makePlan ... seeded bag and durations
//    export function plateFor ... plate payload of a shot
//    const SHOTS .......... the shot list (start, tick)
//    function layoutRects . pane rects in the clear band
//    function composite ... the canvas the shell records
//    export function installSaver
// ════════════════════════════════════════════════════════════════════════════

import { plateBand } from '../../lib/saver-clear.js';
import { INSTRUMENTS, noteName, freqToMidi, midiToFreq } from './engine/instruments.js';
import { CHORD_SHAPES, findShape, shapePitches, STANDARD } from './engine/chords.js';
import { ratioOf } from './engine/harmonics.js';
import { mapFretting } from './engine/midi.js';
import { intervalInfo, chordRatios } from './playback/ratios.js';
import { TRACKS, trackUrl } from './playback/tracks.js';
import { Session, loadSong } from './playback/session.js';

export const TEX = {
  series: 'f_n = n\\,f_1',
  wave: '\\frac{\\partial^2 u}{\\partial t^2} = c^2\\,\\frac{\\partial^2 u}{\\partial x^2}',
  mersenne: 'f_1 = \\frac{1}{2L}\\sqrt{\\frac{T}{\\mu}}',
};

export const SHOT_KEYS = ['pluck', 'strum', 'bow', 'nodes', 'melody', 'series'];

// colour maps per shot: sequential maps for a magnitude, diverging for a sign
export const SEQ_MAPS = ['magma', 'inferno', 'plasma', 'viridis', 'rocket', 'mako', 'turbo', 'ember', 'aurora', 'synthwave', 'gold-leaf'];
export const DIV_MAPS = ['coolwarm', 'berlin', 'vanimo', 'managua', 'red-blue', 'purple-orange'];
const SHOT_MAPS = {
  pluck: ['magma', 'inferno'],
  strum: SEQ_MAPS,
  bow: DIV_MAPS,
  nodes: SEQ_MAPS.concat(DIV_MAPS),
  melody: SEQ_MAPS,
  series: SEQ_MAPS,
};

const INST_NAME = {
  steel: 'a generic steel-string acoustic guitar',
  classical: 'a classical guitar (nylon)',
  violin: 'a violin',
};
const INST_SHORT = { steel: 'Steel-string guitar', classical: 'Classical guitar', violin: 'Violin' };

// ── seeded plan ──────────────────────────────────────────────────────────
/** mulberry32: a small seeded generator, 0 <= x < 1. */
export function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy of keys whose first item is not `last`. */
export function shuffleBag(rng, keys, last = null) {
  const a = keys.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length > 1 && a[0] === last) { const j = 1 + Math.floor(rng() * (a.length - 1)); [a[0], a[j]] = [a[j], a[0]]; }
  return a;
}

/** Shot length in seconds: 6..12, longer when calm is high. */
export function shotSeconds(rng, calm = 0.7) {
  const c = Math.max(0, Math.min(1, calm));
  return Math.max(6, Math.min(12, 6 + 6 * (0.45 * c + 0.55 * rng())));
}

/** A colour map from list, never `prev`. */
export function pickMap(rng, list, prev) {
  const ok = list.filter((m) => m !== prev);
  const from = ok.length ? ok : list;
  return from[Math.floor(rng() * from.length)];
}

/**
 * The plan: next() -> { key, seconds, cmap, seed }. A bag holds every
 * shot once; a new bag never starts with the shot that ended the last one.
 */
export function makePlan({ seed = 1, calm = 0.7, keys = SHOT_KEYS } = {}) {
  const rng = rngFrom(seed);
  let bag = [], last = null, lastMap = null;
  return {
    rng,
    next(force = null) {
      if (!bag.length) bag = shuffleBag(rng, keys, last);
      let key = force && keys.includes(force) ? force : bag.shift();
      if (force) { const i = bag.indexOf(force); if (i >= 0) bag.splice(i, 1); }
      const cmap = pickMap(rng, SHOT_MAPS[key] || SEQ_MAPS, lastMap);
      last = key; lastMap = cmap;
      return { key, seconds: shotSeconds(rng, calm), cmap, seed: Math.floor(rng() * 2 ** 31) };
    },
  };
}

/**
 * Time scale (simulated s per wall s) so that a vibration of f Hz shows
 * `perSec` cycles per wall second. Clamped to the page range 1e-4 .. 1.
 */
export function slowFor(f, perSec = 0.5) {
  if (!(f > 0)) return 0.01;
  return Math.max(1e-4, Math.min(1, perSec / f));
}

export const fmtScale = (s) => (s >= 0.999 ? 'real time' : `1/${Math.round(1 / s)}`);
export const fmtHz = (f) => (f >= 100 ? f.toFixed(1) : f.toFixed(2)) + ' Hz';

/** Critically damped spring, one component. Returns [x, v]. */
export function springStep(x, v, goal, omega, dt) {
  // exact solution of x'' = -w^2 (x - g) - 2 w x' over dt
  const e = Math.exp(-omega * dt), d = x - goal;
  const c = v + omega * d;
  return [goal + (d + c * dt) * e, (v - omega * c * dt) * e];
}

// ── plates ───────────────────────────────────────────────────────────────
/**
 * Plate payload for a shot. f = facts: { inst, note, f, ratio, ratioName,
 * ts, n, chord, chordRatio, string, track, pos }. Plain text and TeX only.
 */
export function plateFor(key, f = {}) {
  const inst = INST_NAME[f.inst] || 'a string';
  const slow = f.ts ? `time slowed to ${fmtScale(f.ts)}` : '';
  const P = (sym, name, value) => ({ sym, name, value });
  const instP = { name: 'instrument', value: INST_SHORT[f.inst] || '' };
  switch (key) {
    case 'pluck': return {
      title: 'A pluck in slow motion',
      sub: `The ${f.string || ''} string of ${inst}, coloured by its acceleration · ${slow}`,
      params: [instP, P('f_1', `note ${f.note || ''}`, f.f ? fmtHz(f.f) : ''), P('', 'missing harmonic', f.n ? `${f.n} : 1 (pluck at L/${f.n})` : 'none')],
      tex: [TEX.wave],
      lines: ['Two kinks run from the pluck point and reflect at the ends. The force on each point is largest at the kinks.'],
    };
    case 'strum': return {
      title: `${f.chord || 'A chord'} strummed`,
      sub: `${cap(inst)}, every string coloured by its acceleration · ${slow}`,
      params: [instP, P('', 'chord', f.chord || ''), P('f_{\\mathrm{root}}', `root ${f.note || ''}`, f.f ? fmtHz(f.f) : ''), P('', 'frequency ratio', f.chordRatio || '')],
      tex: [TEX.mersenne],
      lines: ['Each string has its own length, tension and mass, so each sounds its own pitch.'],
    };
    case 'bow': return {
      title: 'A bow stroke: Helmholtz motion',
      sub: `The ${f.string || ''} string of ${inst}, coloured by its velocity · ${slow}`,
      params: [instP, P('f_1', `note ${f.note || ''}`, f.f ? fmtHz(f.f) : ''), P('', 'partials', '1 : 2 : 3 : 4 …')],
      tex: [TEX.series],
      lines: ['The bow sticks, then slips: one corner circles the string once per period.'],
    };
    case 'nodes': return {
      title: `Harmonic ${f.n || 2}: the nodes`,
      sub: `A light touch at L/${f.n || 2} on the ${f.string || ''} string of ${inst} · ${slow}`,
      params: [instP, P('f_1', `note ${f.note || ''}`, f.f ? fmtHz(f.f) : ''), P(`f_${f.n || 2}`, 'harmonic', f.f ? fmtHz(f.f * (f.n || 2)) : ''), P('', 'ratio', `${f.n || 2} : 1`)],
      tex: [TEX.series],
      lines: ['Only the modes with a node at the touch point keep ringing.'],
    };
    case 'melody': return {
      title: f.track || 'A melody, one note at a time',
      sub: `${cap(inst)}, one step at a time with its TAB · ${slow}`,
      params: [instP, P('', f.chord ? 'chord' : 'note', f.chord ? `${f.chord} (${f.note || ''})` : f.note || ''), P('f', 'frequency', f.f ? fmtHz(f.f) : ''), P('', f.ratioName ? `ratio · ${f.ratioName}` : 'ratio', f.ratio || '')],
      tex: [TEX.mersenne],
      lines: ['A fret makes the string shorter: each fret raises the pitch by a ratio of 2^(1/12).'],
    };
    case 'series': return {
      title: 'The harmonic series',
      sub: `Harmonic ${f.n || 1} of the ${f.string || ''} string of ${inst} · ${slow}`,
      params: [instP, P(`f_${f.n || 1}`, `harmonic ${f.n || 1}`, f.f ? fmtHz(f.f * (f.n || 1)) : ''), P('', f.ratioName ? `ratio · ${f.ratioName}` : 'ratio', f.ratio || '1 : 1')],
      tex: [TEX.series],
      lines: ['Each harmonic is a whole number times the fundamental: the ratios of music.'],
    };
    default: return { title: 'String Lab', sub: '', params: [], tex: [TEX.series] };
  }
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The interval of harmonic n over n-1 as plate text. */
export function seriesRatio(n) {
  if (n < 2) return { ratio: '1 : 1', ratioName: 'fundamental' };
  const r = ratioOf(n, n - 1);
  return { ratio: `${n} : ${n - 1}`, ratioName: r.name || `${Math.round(r.cents)} cents` };
}

// ── TAB ──────────────────────────────────────────────────────────────────
/** TAB columns for steps [{ notes: [{ string, fret }], chord }] on nStrings. */
export function tabColumns(steps, nStrings) {
  return steps.map((st) => {
    const f = new Array(nStrings).fill(-1);
    for (const n of st.notes || []) if (n.string >= 0 && n.string < nStrings) f[n.string] = n.fret;
    return { frets: f, label: st.chord || '' };
  });
}

/** Steps of a built-in phrase (Ode to Joy), used until a track has loaded. */
export function fallbackSteps(inst) {
  const mel = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62];
  const shift = inst.tuning[0] > 50 ? 12 : 0;     // the violin plays it an octave up
  const map = mapFretting(mel.map((m) => [m + shift]), inst);
  return map.map((g, i) => ({ i, notes: g.notes, chord: null, rootPc: null }));
}

// ── pane rects ───────────────────────────────────────────────────────────
/**
 * Rects (CSS px) in a W x H frame with a clear band { t, b }:
 *   p2   the 2D pane rect (null when hidden)
 *   tab  the TAB strip rect (null when off)
 *   c3   the point where the 3D subject is centred, and fit = the factor
 *        that backs the camera off so the subject fits its part
 */
export function layoutRects(layout, W, H, band, withTab = false) {
  const t = band ? band.t : H * 0.06, b = band ? band.b : H * 0.06;
  const bh = Math.max(40, H - t - b);
  const land = W > H * 1.1;
  const pad = Math.max(10, Math.min(W, H) * 0.03);
  let p2 = null, c3 = { x: W / 2, y: t + bh / 2, w: W, h: bh };
  if (layout === 'split') {
    if (land) {
      p2 = { x: pad, y: t, w: W * 0.46 - pad, h: bh };
      c3 = { x: W * 0.73, y: t + bh / 2, w: W * 0.54, h: bh };
    } else {
      p2 = { x: pad, y: t, w: W - 2 * pad, h: bh * 0.48 };
      c3 = { x: W / 2, y: t + bh * 0.76, w: W, h: bh * 0.52 };
    }
  } else if (layout === 'full2d') {
    const w = land ? Math.min(W - 2 * pad, bh * 2.2) : W - 2 * pad;
    p2 = { x: (W - w) / 2, y: t, w, h: bh };
  }
  let tab = null;
  if (withTab && p2) {
    const th = Math.max(56, Math.min(120, p2.h * 0.3));
    tab = { x: p2.x, y: p2.y + p2.h - th, w: p2.w, h: th };
    p2 = { ...p2, h: p2.h - th - 8 };
  }
  const fit = Math.max(H / c3.h, W / c3.w);
  return { p2, tab, c3: { ...c3, fit }, band: { t, b, h: bh } };
}

// ── shots ────────────────────────────────────────────────────────────────
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const OPEN_CHORDS = ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'E7', 'A7', 'G7', 'D7', 'Cmaj7', 'Fmaj7'];
const MELODY = {
  violin: ['minuet', 'ode-to-joy', 'amazing-grace'],
  classical: ['greensleeves', 'romanza', 'bourree'],
};

function noteOf(f) { return noteName(Math.round(freqToMidi(f))); }

// A firm light touch at L/n, run to its end at once. The page touch (0.08 s
// simulated, strength 4000) leaves the fundamental ringing for n >= 4 on
// the guitars; this one leaves harmonic n more than 50 times stronger than
// any other mode on every string (saver-tests.mjs). In deep slow motion a touch would also
// take a minute of wall time, so the shot runs it before it shows.
/**
 * Display exaggeration that draws a standing wave of frequency f with a
 * peak of `target` metres: the light touch leaves a small amplitude, and
 * a fixed factor would draw it flat. Clamped to the page range 1 .. 500.
 */
export function exaggerationFor(sim, f, target = 0.06) {
  const w = 2 * Math.PI * f;
  let m = 0;
  for (let i = 0; i < sim.u.length; i++) m = Math.max(m, Math.hypot(sim.u[i], w > 0 ? sim.v[i] / w : 0));
  return m > 0 ? Math.max(1, Math.min(500, target / m)) : 40;
}

export function settleTouch(sim, n, { strength = 20000, seconds = 0.2 } = {}) {
  if (!sim || !(sim.k > 0) || !(n >= 2)) return;
  sim.touch({ pos: 1 / n, strength, seconds });
  sim.step(Math.ceil((seconds + 0.02) / sim.k));
}

/**
 * Each shot: start(c) sets the scene and returns its facts; tick(c, t, dt)
 * runs it (t = wall seconds since the cut). c = the shot context made in
 * installSaver: { S, world, rng, cam(id, opts), facts, label() }.
 */
export const SHOTS = {
  pluck: {
    layout: 'split', field: 'a',
    start(c) {
      const inst = c.rng() < 0.6 ? 'steel' : 'classical';
      c.load(inst);
      const n = c.world.sims.length;
      const i = Math.floor(c.rng() * n);
      const fret = pick(c.rng, [0, 0, 2, 3, 5, 7]);
      c.S.setFret(i, fret);
      c.S.selectString(i);
      const sim = c.world.sims[i], f = sim.f1Stiff;
      const div = pick(c.rng, [3, 4, 5, 6]);
      c.S.setTimeScale(slowFor(f, 0.14));
      c.S.setExaggeration(30);
      c.S.pluck(i, { pos: 1 / div, amp: 0.002, sound: false });
      c.cam('instrument', { push: 0.8 });
      c.state.later = { at: 0.4, id: 'soundhole', push: 1.1 };
      return { inst, string: c.world.inst.strings[i].name, note: noteOf(f), f, n: div, ts: c.world.timeScale };
    },
  },
  strum: {
    layout: 'full3d', field: 'a',
    start(c) {
      const inst = c.rng() < 0.65 ? 'steel' : 'classical';
      c.load(inst);
      const chord = pick(c.rng, OPEN_CHORDS);
      c.S.setTimeScale(0.01);
      c.S.setExaggeration(20);
      const frets = c.S.playChord(chord, { sound: false }) || findShape(chord).frets;
      c.state.chord = chord; c.state.next = 4.6; c.state.dir = 'down';
      const midis = shapePitches(findShape(chord), STANDARD);
      const root = Math.min(...midis);
      c.cam('instrument', { push: 1 });
      c.state.later = { at: 0.45, id: pick(c.rng, ['soundhole', 'soundhole', 'fretboard']), push: 1 };
      return { inst, chord, note: noteName(root), f: midiToFreq(root), chordRatio: chordRatios(midis).text, ts: 0.01, frets };
    },
    tick(c, t) {
      if (t >= c.state.next) {
        c.state.dir = c.state.dir === 'down' ? 'up' : 'down';
        c.S.playChord(c.state.chord, { dir: c.state.dir, sound: false });
        c.state.next = t + 4.6;
      }
    },
  },
  bow: {
    layout: 'split', field: 'v',
    start(c) {
      c.load('violin');
      const i = pick(c.rng, [1, 2, 2, 3]);
      c.S.setFret(i, pick(c.rng, [0, 0, 2, 4]));
      c.S.selectString(i);
      const f = c.world.sims[i].f1Stiff;
      c.S.setTimeScale(slowFor(f, 1.4));
      c.S.setExaggeration(60);
      c.S.setTool('bow');
      c.S.bow(i, { pos: 0.11, sound: false });
      c.state.bowString = i;
      c.cam('bow', { string: i, push: 0.9 });
      c.state.later = { at: 0.5, id: 'string', string: i, push: 0.9 };
      return { inst: 'violin', string: c.world.inst.strings[i].name, note: noteOf(f), f, ts: c.world.timeScale };
    },
    stop(c) { if (c.state.bowString != null) c.S.stopBow(c.state.bowString); c.S.setTool('pluck'); },
  },
  nodes: {
    layout: 'full2d', field: 'u',
    start(c) {
      const inst = pick(c.rng, ['steel', 'classical', 'violin']);
      c.load(inst);
      const n = 2 + Math.floor(c.rng() * 4);
      const i = Math.floor(c.rng() * c.world.sims.length);
      c.S.selectString(i);
      const f = c.world.sims[i].f1Stiff;
      c.S.setTimeScale(slowFor(f * n, 0.7));
      c.S.setExaggeration(inst === 'violin' ? 60 : 40);
      if (c.world.inst.bowed) c.S.setTool('pluck');
      c.S.harmonic(i, n, { sound: false });
      settleTouch(c.world.sims[i], n);
      c.S.setExaggeration(exaggerationFor(c.world.sims[i], f * n));
      c.S.setHarmonic(n);
      c.cam('string', { string: i, push: 1 });
      return { inst, string: c.world.inst.strings[i].name, note: noteOf(f), f, n, ts: c.world.timeScale };
    },
  },
  melody: {
    layout: 'split', field: 'a', tab: true,
    start(c) {
      const inst = c.rng() < 0.5 ? 'violin' : 'classical';
      c.load(inst);
      if (inst === 'violin') c.S.setTool('pluck');
      const id = pick(c.rng, MELODY[inst]);
      const tr = TRACKS.find((x) => x.id === id);
      const steps = c.stepsFor(id, inst) || fallbackSteps(INSTRUMENTS[inst]);
      c.state.steps = steps;
      c.state.cols = tabColumns(steps, INSTRUMENTS[inst].strings.length);
      c.state.idx = Math.floor(c.rng() * Math.max(1, steps.length / 2)) - 1;
      c.state.every = 1.05 + 0.25 * c.calm;
      c.state.next = 0.4;
      c.state.track = c.stepsFor(id, inst) ? tr.title : 'Ode to Joy';
      c.S.setTimeScale(0.02);
      c.S.setExaggeration(inst === 'violin' ? 50 : 35);
      c.cam(inst === 'violin' ? 'fretboard' : 'instrument', { push: 1 });
      c.state.later = { at: 0.5, id: 'soundhole', push: 1 };
      return { inst, track: c.state.track, ts: 0.02 };
    },
    tick(c, t) {
      const s = c.state;
      if (!s.steps || !s.steps.length || t < s.next) return;
      s.next = t + s.every;
      const prev = s.idx >= 0 ? s.steps[s.idx] : null;
      s.idx = (s.idx + 1) % s.steps.length;
      const st = s.steps[s.idx];
      const nS = c.world.sims.length;
      const frets = new Array(nS).fill(-1);
      for (const n of st.notes) if (n.string < nS) frets[n.string] = n.fret;
      c.S.playFrets({ instrument: c.world.instKey, frets, notes: st.notes, direction: 'down', velocity: 0.75, sound: false });
      const midis = st.notes.map((n) => n.midi);
      const top = Math.max(...midis);
      const f = c.facts;
      f.note = midis.map((m) => noteName(m)).join(' ');
      f.f = midiToFreq(top);
      f.chord = st.notes.length >= 3 ? st.chord || null : null;
      if (st.notes.length >= 2) { const r = chordRatios(midis, st.rootPc); f.ratio = r.text; f.ratioName = 'chord'; }
      else if (prev && prev.notes.length) {
        const a = Math.max(...prev.notes.map((n) => n.midi));
        const iv = intervalInfo(a, top);
        f.ratio = iv.semis === 0 ? '1 : 1' : iv.down ? `${iv.den} : ${iv.num}` : `${iv.num} : ${iv.den}`;
        f.ratioName = iv.name;
      } else { f.ratio = '1 : 1'; f.ratioName = 'first note'; }
      c.label();
    },
  },
  series: {
    layout: 'split', field: 'u',
    start(c) {
      const inst = pick(c.rng, ['steel', 'classical', 'violin']);
      c.load(inst);
      if (inst === 'violin') c.S.setTool('pluck');
      const i = Math.floor(c.rng() * c.world.sims.length);
      c.S.selectString(i);
      const f = c.world.sims[i].f1Stiff;
      c.state.i = i; c.state.n = 0; c.state.f = f;
      c.state.every = Math.max(1.4, (c.seconds - 0.6) / 6);
      c.state.next = 0;
      c.S.setExaggeration(inst === 'violin' ? 60 : 40);
      c.cam('string', { string: i, push: 1 });
      return { inst, string: c.world.inst.strings[i].name, note: noteOf(f), f, n: 1, ts: slowFor(f, 0.7), ratio: '1 : 1', ratioName: 'fundamental' };
    },
    tick(c, t) {
      const s = c.state;
      if (t < s.next || s.n >= 8) return;
      s.next = t + s.every;
      s.n += 1;
      const n = s.n;
      c.S.setTimeScale(slowFor(s.f * n, 0.7));
      if (n === 1) { c.S.setHarmonic(0); c.S.pluck(s.i, { pos: 0.5, amp: 0.002, sound: false }); }
      else { c.S.harmonic(s.i, n, { sound: false }); settleTouch(c.world.sims[s.i], n); c.S.setHarmonic(n); }
      c.S.setExaggeration(exaggerationFor(c.world.sims[s.i], s.f * n));
      Object.assign(c.facts, { n, ts: c.world.timeScale }, seriesRatio(n));
      c.label();
    },
  },
};

// ── composite ────────────────────────────────────────────────────────────
/** Draw the TAB strip: columns around idx, the current one marked. */
export function drawTab(g, r, cols, idx, names) {
  const nS = names.length;
  g.save();
  g.fillStyle = 'rgba(10,12,18,0.92)';
  g.fillRect(r.x, r.y, r.w, r.h);
  g.strokeStyle = 'rgba(143,182,255,0.28)';
  g.lineWidth = 1;
  g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  const top = r.y + r.h * 0.26, bot = r.y + r.h - 8, gap = (bot - top) / Math.max(1, nS - 1);
  const x0 = r.x + 28, colW = Math.max(26, Math.min(48, r.w / 16));
  const fs = Math.max(9, Math.min(14, gap * 0.9));
  g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // string lines, highest string at the top (TAB convention)
  for (let s = 0; s < nS; s++) {
    const y = top + (nS - 1 - s) * gap;
    g.strokeStyle = 'rgba(221,225,236,0.22)';
    g.beginPath(); g.moveTo(x0 - 6, y); g.lineTo(r.x + r.w - 8, y); g.stroke();
    g.fillStyle = '#8b92a8';
    g.fillText(names[s], r.x + 14, y);
  }
  // the current column sits at the second slot: one past note, then the coming ones
  const slots = Math.max(2, Math.floor((r.x + r.w - 8 - x0) / colW));
  const first = Math.max(0, idx - 1);
  for (let k = 0; k < slots && first + k < cols.length; k++) {
    const j = first + k, col = cols[j], x = x0 + (k + 0.5) * colW;
    const cur = j === idx;
    if (cur) { g.fillStyle = 'rgba(255,210,122,0.14)'; g.fillRect(x - colW / 2, r.y + 2, colW, r.h - 4); }
    if (col.label && (j === 0 || cols[j - 1].label !== col.label)) {
      g.fillStyle = cur ? '#ffd27a' : '#8fb6ff';
      g.fillText(col.label, x, r.y + r.h * 0.12);
    }
    for (let s = 0; s < nS; s++) {
      const f = col.frets[s];
      if (f < 0) continue;
      const y = top + (nS - 1 - s) * gap, txt = String(f);
      const w = fs * 0.62 * txt.length + 4;
      g.fillStyle = 'rgba(10,12,18,1)'; g.fillRect(x - w / 2, y - fs * 0.6, w, fs * 1.2);
      g.fillStyle = cur ? '#ffd27a' : j < idx ? '#5c6378' : '#dde1ec';
      g.fillText(txt, x, y);
    }
  }
  g.restore();
}

// ── install ──────────────────────────────────────────────────────────────
const CSS = `
html.sl-saver, html.sl-saver body { overflow: hidden !important; }
html.sl-saver #panel, html.sl-saver #transport, html.sl-saver #dock, html.sl-saver #explain,
html.sl-saver .pane .ph, html.sl-saver #toast, html.sl-saver #msg3 { display: none !important; }
html.sl-saver body > *:not(#lab):not(#slSaverCv):not(script):not(style):not(link) { display: none !important; }
html.sl-saver #lab, html.sl-saver #stage { display: block !important; }
html.sl-saver .pane { position: fixed !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; padding: 0 !important; box-shadow: none !important; display: block !important; }
html.sl-saver .pane.p3 { left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 1; }
html.sl-saver .pane.p2 { z-index: 2; left: var(--sl-x, 0) !important; top: var(--sl-y, 0) !important; width: var(--sl-w, 50vw) !important; height: var(--sl-h, 50vh) !important; }
html.sl-saver .pane.p2.sl-off { visibility: hidden !important; }
html.sl-saver .pane .view2, html.sl-saver .pane .view3 { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }
html.sl-saver #c2, html.sl-saver #c3 { width: 100% !important; height: 100% !important; }
#slSaverCv { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 60; pointer-events: none; background: #0b0d12; }
`;

export function installSaver(S) {
  if (typeof window === 'undefined' || !S) return null;
  const doc = window.document, world = S.world;
  const trackCache = new Map();     // id -> song (loaded once per page)
  const stepCache = new Map();      // id|inst -> steps
  let run = null;

  function preload() {
    for (const id of [...MELODY.violin, ...MELODY.classical]) {
      if (trackCache.has(id)) continue;
      trackCache.set(id, null);
      const t = TRACKS.find((x) => x.id === id);
      if (!t || typeof fetch !== 'function') continue;
      fetch(trackUrl(t)).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => {
        if (b) trackCache.set(id, loadSong(new Uint8Array(b), { name: t.title }));
      }).catch(() => {});
    }
  }
  function stepsFor(id, inst) {
    const key = id + '|' + inst;
    if (stepCache.has(key)) return stepCache.get(key);
    const song = trackCache.get(id);
    if (!song) return null;
    const ses = new Session({ instrument: inst });
    ses.load(song);
    const steps = ses.steps.filter((s) => s.notes.length).map((s) => ({ i: s.i, notes: s.notes, chord: s.chord, rootPc: s.rootPc }));
    stepCache.set(key, steps);
    return steps;
  }

  function snapshot() {
    const st = S.state();
    const cam = doc.querySelector('[data-cam].on');
    return {
      ...st, sel: world.sel, harmonic: world.harmonic, showAll: world.showAll, pluckPos: world.pluckPos,
      cam: cam ? cam.dataset.cam : 'instrument',
    };
  }
  function restore(s) {
    if (world.instKey !== s.instrument) S.loadInstrument(s.instrument);
    s.frets.forEach((f, i) => S.setFret(i, f));
    S.setTimeScale(s.timeScale);
    S.setExaggeration(s.exaggeration);
    S.setField(s.field);
    S.setColormap(s.colormap.id, s.colormap);
    S.setTool(s.tool);
    S.setHarmonic(s.harmonic);
    S.showAll(s.showAll);
    world.pluckPos = s.pluckPos;
    S.selectString(s.sel);
    S.pause(s.paused);
    S.camera(s.cam);
  }

  // the 3D camera spring
  function camSpring(v) {
    const cam = v.camera, ctl = v.controls;
    const tgt = ctl ? ctl.target : null;
    return {
      eye: [cam.position.x, cam.position.y, cam.position.z],
      tgt: tgt ? [tgt.x, tgt.y, tgt.z] : [0, 0, 0],
      ve: [0, 0, 0], vt: [0, 0, 0],
      gEye: null, gTgt: null,
    };
  }
  function poseGoal(v, id, o, fit) {
    // the view's own preset pose, read back, then the spring state restored
    const cam = v.camera, ctl = v.controls;
    const keepE = cam.position.clone(), keepT = ctl ? ctl.target.clone() : null;
    v.setCamera(id, { animate: false, string: o.string });
    const e = [cam.position.x, cam.position.y, cam.position.z];
    const t = ctl ? [ctl.target.x, ctl.target.y, ctl.target.z] : [0, 0, 0];
    cam.position.copy(keepE);
    if (ctl && keepT) ctl.target.copy(keepT);
    const k = (o.push ?? 1) * (id === 'instrument' ? fit : Math.sqrt(fit));
    return { eye: t.map((x, j) => x + (e[j] - x) * k), tgt: t };
  }

  function makeCanvas() {
    let style = doc.getElementById('slSaverCss');
    if (!style) { style = doc.createElement('style'); style.id = 'slSaverCss'; style.textContent = CSS; doc.head.appendChild(style); }
    const cv = doc.createElement('canvas');
    cv.id = 'slSaverCv';
    cv.setAttribute('aria-label', 'String Lab screensaver');
    doc.body.appendChild(cv);
    return cv;
  }

  function size() {
    return { W: window.innerWidth || 1280, H: window.innerHeight || 800, dpr: Math.min(2, window.devicePixelRatio || 1) };
  }

  function placePane(rect) {
    const p2 = doc.querySelector('.pane.p2');
    if (!p2) return;
    p2.classList.toggle('sl-off', !rect);
    if (!rect) return;
    const st = p2.style;
    st.setProperty('--sl-x', `${Math.round(rect.x)}px`);
    st.setProperty('--sl-y', `${Math.round(rect.y)}px`);
    st.setProperty('--sl-w', `${Math.round(rect.w)}px`);
    st.setProperty('--sl-h', `${Math.round(rect.h)}px`);
  }

  function relayout() {
    if (!run) return;
    const { W, H } = size();
    let band = null;
    try { band = plateBand(H); } catch (_) { band = null; }
    const sh = SHOTS[run.key];
    run.rects = layoutRects(sh.layout, W, H, band, !!sh.tab);
    placePane(run.rects.p2);
    run.bandAt = run.t;
  }

  function cut(force = null) {
    if (!run) return;
    const old = run.shot ? SHOTS[run.shot.key] : null;
    if (old && old.stop) { try { old.stop(run.ctx); } catch (e) { console.warn('string-lab saver stop:', e); } }
    const shot = run.plan.next(force);
    run.shot = shot; run.key = shot.key; run.t = 0; run.history.push(shot.key);
    if (run.history.length > 40) run.history.shift();
    const sh = SHOTS[shot.key];
    const rng = rngFrom(shot.seed);
    const ctx = run.ctx = {
      S, world, rng, calm: run.calm, seconds: shot.seconds, state: {}, facts: {},
      load(inst) {
        if (world.instKey !== inst) S.loadInstrument(inst);
        for (let i = 0; i < world.sims.length; i++) { S.setFret(i, 0); world.sims[i].stopBow(); world.sims[i].damp(0); }
        S.setHarmonic(0);
        S.setTool('pluck');
        S.showAll(false);
        world.pluckPos = world.inst.pluckPos;
      },
      cam(id, o = {}) { run.camGoal = { id, o }; run.camDirty = true; },
      stepsFor,
      label: () => sendLabel(),
    };
    relayout();
    S.setField(sh.field);
    S.setColormap(shot.cmap, { reverse: false, gamma: 1 });
    try { ctx.facts = sh.start(ctx) || {}; } catch (e) { console.warn('string-lab saver shot:', shot.key, e); ctx.facts = {}; }
    run.lastLabel = '';
    sendLabel();
  }

  function sendLabel() {
    if (!run || !run.label) return;
    const info = plateFor(run.key, run.ctx.facts);
    const key = JSON.stringify(info);
    if (key === run.lastLabel) return;
    run.lastLabel = key;
    try { run.label(info); } catch (_) { /* shell gone */ }
  }

  function before(dt) {
    if (!run) return;
    run.t += dt;
    if (run.t >= run.shot.seconds) cut();
    const sh = SHOTS[run.key], c = run.ctx;
    if (sh.tick) { try { sh.tick(c, run.t, dt); } catch (e) { console.warn('string-lab saver tick:', e); } }
    if (c.state.later && run.t >= c.state.later.at * run.shot.seconds) { const L = c.state.later; c.state.later = null; c.cam(L.id, { string: L.string ?? world.sel, push: L.push }); }
    if (run.t - run.bandAt > 0.5) relayout();
    const v = S.view3d();
    if (!v || !v.camera) return;
    if (!run.spring || run.spring.view !== v) {
      run.spring = camSpring(v); run.spring.view = v;
      if (v.controls) { run.ctlWas = v.controls.enabled; v.controls.enabled = false; }
      run.camDirty = true;
    }
    const sp = run.spring, r = run.rects;
    if (run.camDirty && run.camGoal) {
      const g = poseGoal(v, run.camGoal.id, run.camGoal.o, r.c3.fit);
      sp.gEye = g.eye; sp.gTgt = g.tgt; run.camDirty = false;
      sp.drift = 0;
    }
    if (!sp.gEye) return;
    // a slow sideways drift around the goal, so a held shot is not still
    sp.drift += dt;
    const d = [sp.gEye[0] - sp.gTgt[0], sp.gEye[1] - sp.gTgt[1], sp.gEye[2] - sp.gTgt[2]];
    const up = v.camera.up;
    let sx = d[1] * up.z - d[2] * up.y, sy = d[2] * up.x - d[0] * up.z, sz = d[0] * up.y - d[1] * up.x;
    const sl = Math.hypot(sx, sy, sz) || 1, dl = Math.hypot(...d);
    const sway = Math.sin(sp.drift * 0.22) * 0.1 * dl / sl;
    sx *= sway; sy *= sway; sz *= sway;
    const goalE = [sp.gEye[0] + sx, sp.gEye[1] + sy, sp.gEye[2] + sz];
    const w = 1.6 + 1.2 * (1 - run.calm), h = Math.min(0.05, dt);
    for (let j = 0; j < 3; j++) {
      [sp.eye[j], sp.ve[j]] = springStep(sp.eye[j], sp.ve[j], goalE[j], w, h);
      [sp.tgt[j], sp.vt[j]] = springStep(sp.tgt[j], sp.vt[j], sp.gTgt[j], w, h);
    }
    v.camera.position.set(sp.eye[0], sp.eye[1], sp.eye[2]);
    if (v.controls) v.controls.target.set(sp.tgt[0], sp.tgt[1], sp.tgt[2]);
    v.camera.lookAt(sp.tgt[0], sp.tgt[1], sp.tgt[2]);
    // centre the subject at its part of the clear band
    const { W, H } = size();
    if (v.camera.setViewOffset) v.camera.setViewOffset(W, H, W / 2 - r.c3.x, H / 2 - r.c3.y, W, H);
  }

  function composite() {
    if (!run) return;
    const cv = run.canvas, { W, H, dpr } = size();
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const g = run.g || (run.g = cv.getContext('2d', { alpha: false }));
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, W, H);
    const c3 = doc.getElementById('c3');
    if (c3 && c3.width > 1) { try { g.drawImage(c3, 0, 0, W, H); } catch (_) { /* lost context */ } }
    const r = run.rects;
    const c2 = doc.getElementById('c2');
    if (r.p2 && c2 && c2.width > 1) {
      try { g.drawImage(c2, r.p2.x, r.p2.y, r.p2.w, r.p2.h); } catch (_) { /* not ready */ }
      g.strokeStyle = 'rgba(143,182,255,0.22)'; g.lineWidth = 1;
      g.strokeRect(r.p2.x + 0.5, r.p2.y + 0.5, r.p2.w - 1, r.p2.h - 1);
    }
    if (r.tab && run.ctx.state.cols) drawTab(g, r.tab, run.ctx.state.cols, run.ctx.state.idx, world.inst.strings.map((s) => s.name));
  }

  window.snSaver = {
    enter(opts = {}) {
      if (run) this.exit();
      preload();
      const calm = Math.max(0, Math.min(1, opts.calm ?? 0.7));
      const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 31) >>> 0) || 1;
      const prev = snapshot();
      world.silent = true;
      try { S.stopSound && S.stopSound(); } catch (_) { /* no sound yet */ }
      try { S.playback?.session?.pause?.(); S.playback?.chords?.pause?.(); } catch (_) { /* no panel */ }
      doc.documentElement.classList.add('sn-saver', 'sl-saver');
      const canvas = makeCanvas();
      run = {
        plan: makePlan({ seed, calm }), calm, prev, canvas, g: null, label: typeof opts.label === 'function' ? opts.label : null,
        t: 0, shot: null, key: null, ctx: null, rects: null, bandAt: 0, history: [], spring: null, camGoal: null, camDirty: false, lastLabel: '',
      };
      S.pause(false);
      S.camera('instrument');
      cut();
      world.hook = (phase, dt) => {
        try { if (phase === 'before') before(dt); else composite(); } catch (e) { console.warn('string-lab saver frame:', e); }
      };
      return { canvas, warmupMs: 700 };
    },
    exit() {
      if (!run) return;
      const r = run;
      const old = r.shot ? SHOTS[r.shot.key] : null;
      if (old && old.stop) { try { old.stop(r.ctx); } catch (_) { /* gone */ } }
      run = null;
      world.hook = null;
      const v = S.view3d();
      if (v && v.camera) {
        if (v.camera.clearViewOffset) v.camera.clearViewOffset();
        if (v.controls && r.ctlWas != null) v.controls.enabled = r.ctlWas;
      }
      r.canvas.remove();
      const p2 = doc.querySelector('.pane.p2');
      if (p2) { p2.classList.remove('sl-off'); for (const k of ['--sl-x', '--sl-y', '--sl-w', '--sl-h']) p2.style.removeProperty(k); }
      doc.documentElement.classList.remove('sn-saver', 'sl-saver');
      try { restore(r.prev); } catch (e) { console.warn('string-lab saver restore:', e); }
      world.silent = false;
      if (r.label) { try { r.label(null); } catch (_) { /* shell gone */ } }
    },
    /** Force a shot now (probes and tests). */
    cut(key) { if (run) cut(key); },
    debug() {
      if (!run) return null;
      return { key: run.key, t: run.t, seconds: run.shot.seconds, cmap: run.shot.cmap, layout: SHOTS[run.key].layout, rects: run.rects, facts: run.ctx.facts, history: run.history.slice(), cam: run.camGoal && run.camGoal.id };
    },
  };
  return window.snSaver;
}
