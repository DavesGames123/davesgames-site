// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · playback/session.js — the playback logic, with no DOM
// ────────────────────────────────────────────────────────────────────────────
//  A Session holds one song (from a bundled MIDI file or an upload), its
//  fretting on the current instrument, and the two play modes:
//
//    step   one onset group per step ("one note at a time"): a single
//           note, or the notes that start together
//    play   continuous play on a song clock
//
//  ChordSession plays a chord progression with a strum pattern from the
//  engine's chord library ("full chord patterns").
//
//  Each sounding event goes to onEvent(ev). The UI sends the event to the
//  page (pluck or strum on the 2D and 3D views) and to the sound engine.
//
//  SLOW MOTION. The page's time scale (simulated seconds per wall second)
//  also slows the song clock, so the music and the strings move together.
//  The sound of a note is a rendered buffer at its true pitch. Thus the
//  pitch stays correct, and only the tempo falls. Below EXTREME_SCALE the
//  'auto' sound policy mutes the notes: one string period then lasts
//  seconds, and a real-speed sound would not match what the views show.
//
//  SECTION MAP   (grep -n "<anchor>" session.js)
//    sound policy ......... "export function soundPolicy"
//    markers .............. "export function chordMarkers"
//    load a song .......... "export function loadSong"
//    session .............. "export class Session"
//    chord session ........ "export class ChordSession"
// ════════════════════════════════════════════════════════════════════════════

import { parseMidi, notesFromMidi, tempoMap, songInfo, Scheduler, mapFretting } from '../engine/midi.js';
import { INSTRUMENTS } from '../engine/instruments.js';
import { findShape, strumEvents, shapePitches, nameChord, pcOf, STANDARD } from '../engine/chords.js';

/** Below this time scale, 'auto' mutes the sound. 1/100 and slower. */
export const EXTREME_SCALE = 0.02;

export const SOUND_POLICIES = [
  { key: 'auto', label: 'Auto', help: 'Sound at true pitch down to 1/10 speed; muted at 1/100 and slower.' },
  { key: 'always', label: 'Always', help: 'Every note sounds at its true pitch when it starts, at any speed.' },
  { key: 'slowmute', label: 'Mute slow motion', help: 'Sound only at real time.' },
];

/** { sound, reason } for a time scale and a policy key. */
export function soundPolicy(timeScale, policy = 'auto') {
  if (timeScale >= 0.999) return { sound: true, reason: 'real time' };
  if (policy === 'always') return { sound: true, reason: 'true pitch, slower tempo' };
  if (policy === 'slowmute') return { sound: false, reason: 'muted in slow motion' };
  if (timeScale < EXTREME_SCALE) return { sound: false, reason: 'muted: extreme slow motion' };
  return { sound: true, reason: 'true pitch, slower tempo' };
}

/** Marker events "chord:Em" -> [{ t (s), name, rootPc }]. */
export function chordMarkers(parsed) {
  const toSec = tempoMap(parsed);
  const out = [];
  for (const tr of parsed.tracks) for (const e of tr) {
    if (e.type !== 'meta' || (e.metaType !== 0x06 && e.metaType !== 0x01) || !e.text) continue;
    const m = /^chord:([A-G][b#]?)(\S*)$/.exec(e.text.trim());
    if (!m) continue;
    out.push({ t: toSec(e.tick), name: m[1] + m[2], rootPc: pcOf(m[1]) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Bytes (ArrayBuffer or Uint8Array) -> song { name, bpm, notes, markers }. */
export function loadSong(bytes, { name = '' } = {}) {
  const parsed = parseMidi(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const info = songInfo(parsed);
  const notes = notesFromMidi(parsed).filter((n) => !n.drum);
  if (!notes.length) throw new Error('The file has no notes outside the drum channel.');
  return { name: name || info.names.find(Boolean) || 'Untitled', bpm: info.bpm, notes, markers: chordMarkers(parsed), info };
}

/** The chord marker in force at time t, or null. */
function markerAt(markers, t) {
  let m = null;
  for (const x of markers) { if (x.t <= t + 1e-6) m = x; else break; }
  return m;
}

/**
 * One song on one instrument.
 *   new Session({ instrument: 'classical', onEvent })
 *   load(song) setInstrument(key)
 *   next() prev() goTo(i)                 step mode
 *   play() pause() stop() tick(dtWall, timeScale)   continuous play
 *   setTempo(x)                            0.25 .. 2 (1 = as written)
 */
export class Session {
  constructor({ instrument = 'classical', onEvent = null } = {}) {
    this.instrumentKey = instrument;
    this.onEvent = onEvent;
    this.song = null;
    this.steps = [];
    this.sched = new Scheduler([]);
    this.clock = 0; // song clock (s), runs at tempo x time scale
    this.tempo = 1;
    this.index = -1; // last sounded step
    this.mode = 'step';
  }

  get instrument() {
    return INSTRUMENTS[this.instrumentKey];
  }

  load(song) {
    this.song = song;
    this.sched = new Scheduler(song.notes);
    this.sched.setTempoScale(this.tempo, this.clock);
    this._map();
    this.rewind();
    return this;
  }

  setInstrument(key) {
    if (!INSTRUMENTS[key] || key === this.instrumentKey) return;
    this.instrumentKey = key;
    if (this.song) this._map();
  }

  /** Fret every onset group on the current instrument. */
  _map() {
    const groups = this.sched.groups;
    const map = mapFretting(groups, this.instrument);
    this.steps = groups.map((g, i) => {
      const t = g[0].t;
      const mk = markerAt(this.song.markers, t);
      const midis = map[i].notes.map((n) => n.midi);
      return {
        i, t,
        dur: Math.max(...g.map((n) => n.dur)),
        vel: Math.max(...g.map((n) => n.vel)),
        src: g,
        notes: map[i].notes,
        dropped: map[i].dropped,
        hand: map[i].hand,
        chord: mk ? mk.name : (midis.length >= 3 ? (nameChord(midis) || {}).name || null : null),
        rootPc: mk ? mk.rootPc : null,
      };
    });
    // without markers, the root is the lowest note heard in the last bar
    // (four beats): a bass note stays the root until a lower note comes or
    // the bar has passed
    if (!this.song.markers.length) {
      const bar = 4 * 60 / (this.song.bpm || 120);
      let lastBass = null, lastT = -1e9;
      for (const st of this.steps) {
        const lo = Math.min(...st.src.map((n) => n.midi));
        if (lastBass == null || lo <= lastBass || st.t - lastT >= bar - 1e-6) { lastBass = lo; lastT = st.t; }
        if (st.chord && st.notes.length >= 3) {
          const nm = nameChord(st.notes.map((n) => n.midi));
          st.rootPc = nm ? pcOf(nm.root) : lastBass % 12;
        } else st.rootPc = lastBass % 12;
      }
    }
  }

  get duration() {
    return this.sched.duration;
  }

  rewind() {
    this.pause();
    this.clock = 0;
    this.sched.seek(0, 0);
    this.index = -1;
  }

  _emit(step, how) {
    const prevStep = step.i > 0 ? this.steps[step.i - 1] : null;
    const prevTop = prevStep && prevStep.notes.length ? prevStep.notes[prevStep.notes.length - 1].midi : null;
    const ev = { kind: step.notes.length > 1 ? 'group' : 'note', how, step, prevTop, instrument: this.instrumentKey, total: this.steps.length };
    this.index = step.i;
    if (this.onEvent) this.onEvent(ev);
    return ev;
  }

  // ── step mode ──
  next() {
    if (this.sched.playing) this.pause();
    const g = this.sched.stepNext();
    if (!g) return null;
    const i = this.sched.stepIndex - 1;
    this.clock = this.sched.position(this.clock);
    return this._emit(this.steps[i], 'step');
  }
  prev() {
    if (this.sched.playing) this.pause();
    if (this.index <= 0) { this.rewind(); return this.next(); }
    return this.goTo(this.index - 1);
  }
  goTo(i) {
    if (!this.steps.length) return null;
    const k = Math.max(0, Math.min(this.steps.length - 1, i));
    this.pause();
    this.sched.seek(this.steps[k].t, this.clock);
    return this.next();
  }
  get atEnd() {
    return this.sched.stepIndex >= this.steps.length;
  }

  // ── continuous play ──
  setTempo(x) {
    this.tempo = Math.max(0.25, Math.min(2, x));
    this.sched.setTempoScale(this.tempo, this.clock);
  }
  play() {
    if (!this.song) return;
    if (this.sched.ended || this.atEnd) this.rewind();
    this.sched.play(this.clock);
  }
  pause() {
    this.sched.pause(this.clock);
  }
  stop() {
    this.rewind();
  }
  get playing() {
    return this.sched.playing;
  }
  /** Song position in seconds (song time, before tempo). */
  get position() {
    return this.sched.position(this.clock);
  }

  /**
   * Advance the wall clock by dtWall seconds at the page's time scale.
   * The scheduler runs at tempo on this.clock, so the song moves at
   * tempo x timeScale. Returns the events emitted.
   */
  tick(dtWall, timeScale = 1) {
    if (!this.sched.playing) return [];
    this.clock += Math.max(0, Math.min(0.25, dtWall)) * timeScale;
    const before = this.sched.stepIndex;
    this.sched.due(this.clock);
    const after = this.sched.stepIndex;
    const out = [];
    for (let i = before; i < after; i++) out.push(this._emit(this.steps[i], 'play'));
    return out;
  }

  /** Fractional step index at the song position (for the TAB strip). */
  get cursor() {
    const p = this.position;
    const s = this.steps;
    if (!s.length) return 0;
    let i = this.index < 0 ? 0 : this.index;
    if (!this.playing) return Math.max(0, this.index);
    const a = s[i], b = s[i + 1];
    if (!b) return i;
    return i + Math.max(0, Math.min(1, (p - a.t) / Math.max(1e-6, b.t - a.t)));
  }
}

/**
 * A chord progression played with a strum pattern.
 *   new ChordSession({ onEvent }) setProgression(prog) setPattern(pat)
 *   next() prev() play() pause() tick(dtWall, timeScale) setBpm(bpm)
 * Events: { kind: 'chord', strum: { chord, shape, dir, accent, t }, i, total,
 *           midis, ratios }
 */
export class ChordSession {
  constructor({ onEvent = null, bpm = 84, instrument = 'steel' } = {}) {
    this.onEvent = onEvent;
    this.instrument = instrument; // a guitar: the shapes use standard tuning
    this.bpm = bpm;
    this.events = [];
    this.index = -1;
    this.clock = 0;
    this.playingFlag = false;
  }
  setProgression(prog, pattern) {
    this.prog = prog;
    this.pattern = pattern;
    this.events = strumEvents(prog, pattern).filter((e) => e.shape);
    const total = prog.chords.length * prog.beatsPerChord;
    this.lengthBeats = total;
    this.rewind();
  }
  setBpm(b) {
    this.bpm = Math.max(30, Math.min(200, b));
  }
  rewind() {
    this.index = -1;
    this.clock = 0;
    this.playingFlag = false;
  }
  _emit(i, how) {
    const e = this.events[i];
    this.index = i;
    const midis = shapePitches(e.shape, STANDARD);
    const ev = { kind: 'chord', how, i, total: this.events.length, strum: e, midis, instrument: this.instrument };
    if (this.onEvent) this.onEvent(ev);
    return ev;
  }
  next() {
    this.playingFlag = false;
    if (this.index + 1 >= this.events.length) return null;
    const ev = this._emit(this.index + 1, 'step');
    this.clock = this.events[this.index].t * 60 / this.bpm;
    return ev;
  }
  prev() {
    this.playingFlag = false;
    if (this.index <= 0) { this.rewind(); return this.next(); }
    this.index -= 2;
    return this.next();
  }
  play() {
    if (this.index + 1 >= this.events.length) this.rewind();
    this.playingFlag = true;
  }
  pause() {
    this.playingFlag = false;
  }
  get playing() {
    return this.playingFlag;
  }
  get atEnd() {
    return this.index + 1 >= this.events.length;
  }
  tick(dtWall, timeScale = 1) {
    if (!this.playingFlag) return [];
    this.clock += Math.max(0, Math.min(0.25, dtWall)) * timeScale;
    const beat = (this.clock * this.bpm) / 60;
    const out = [];
    while (this.index + 1 < this.events.length && this.events[this.index + 1].t <= beat + 1e-9) out.push(this._emit(this.index + 1, 'play'));
    if (beat >= this.lengthBeats) this.playingFlag = false;
    return out;
  }
  get cursor() {
    if (this.index < 0) return 0;
    const a = this.events[this.index], b = this.events[this.index + 1];
    if (!this.playingFlag || !b) return this.index;
    const beat = (this.clock * this.bpm) / 60;
    return this.index + Math.max(0, Math.min(1, (beat - a.t) / Math.max(1e-6, b.t - a.t)));
  }
}

/** Shape lookup that the UI can use for chord tracks. */
export { findShape };
