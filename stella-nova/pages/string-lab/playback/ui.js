// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · playback/ui.js — the music panel: tracks, step, chords, TAB,
//  ratio graph and note explainer
// ────────────────────────────────────────────────────────────────────────────
//  MOUNT
//    import { mountPlayback } from './playback/ui.js';
//    const pb = mountPlayback(hostElement, window.__strings);
//  The panel replaces the children of hostElement. It reads the page API
//  on every call, so the page can fill window.__strings after the mount.
//
//  PAGE API that the panel uses (every member is optional; the first one
//  found is used)
//    api.playFrets({ instrument, frets, direction, velocity, sound,
//                    duration, notes, source: 'playback' })
//        Excite the 2D and 3D strings at these frets (per string, low to
//        high, -1 = silent). When sound is true, the page also plays the
//        notes on its AudioEngine. If the page has no playFrets, the panel
//        plays the sound itself on api.audio or on its own AudioEngine.
//    api.playChord(frets, { dir, sound })  the String Lab main.js call: frets
//        per string, null = leave the string alone, -1 = mute
//    api.getTimeScale() | api.timeScale | api.world.timeScale
//    api.getInstrument() | api.instrument | api.world.instKey
//    api.setInstrument(key) | api.loadInstrument(key)  when the person
//        picks a track that suits another instrument
//    api.audio                              an engine AudioEngine (shared)
//  The panel sets api.playback = the controller below, and sends a
//  'strings:playback' CustomEvent on window for each note, group or strum
//  (detail = the session event plus { sound, frets }).
//
//  CONTROLLER
//    pb.step() pb.back() pb.toggle() pb.stop()   transport
//    pb.setSource('song' | 'chords')             song tracks or chord patterns
//    pb.loadTrack(id) pb.loadBytes(bytes, name)  a bundled track or a file
//    pb.session pb.chords                        the logic (session.js)
//    pb.destroy()
//
//  SECTION MAP   (grep -n "<anchor>" ui.js)
//    markup ............... "const MARKUP"
//    page api access ...... "function apiTimeScale"
//    sounding events ...... "function onSessionEvent"
//    explainer text ....... "function explainNote"
//    TAB strip ............ "function drawTab"
//    fretboard ............ "function drawFretboard"
//    ratio graph .......... "function drawRatio"
//    frame loop ........... "function frame"
// ════════════════════════════════════════════════════════════════════════════

import { TRACKS, trackUrl } from './tracks.js';
import { loadSong, Session, ChordSession, soundPolicy, SOUND_POLICIES } from './session.js';
import { intervalInfo, chordRatios, sharedPartials, describeNote, fmtHz } from './ratios.js';
import { INSTRUMENTS, midiToFreq, noteName } from '../engine/instruments.js';
import { PROGRESSIONS, STRUM_PATTERNS, pcOf } from '../engine/chords.js';
import { AudioEngine } from '../engine/audio.js';

const EXTRA_PROGRESSIONS = [
  { name: '12-bar blues in E', key: 'E', chords: ['E7', 'E7', 'E7', 'E7', 'A7', 'A7', 'E7', 'E7', 'B7', 'A7', 'E7', 'B7'], beatsPerChord: 4 },
];

const MARKUP = `
<div class="pb">
  <div class="pb-seg" role="group" aria-label="Music source">
    <button type="button" data-src="song" class="on">Songs</button>
    <button type="button" data-src="chords">Chord patterns</button>
  </div>
  <div class="pb-song">
    <label class="pb-row"><span>Track</span><select class="pb-track"></select></label>
    <p class="pb-about"></p>
    <label class="pb-file">Open your MIDI file<input type="file" class="pb-upload" accept=".mid,.midi,audio/midi"></label>
    <label class="pb-row"><span>Tempo <b class="pb-tempoV">100%</b></span><input class="pb-tempo" type="range" min="0.25" max="2" step="0.05" value="1"></label>
  </div>
  <div class="pb-chords" hidden>
    <label class="pb-row"><span>Progression</span><select class="pb-prog"></select></label>
    <label class="pb-row"><span>Strum</span><select class="pb-pattern"></select></label>
    <label class="pb-row"><span>Tempo <b class="pb-bpmV">84</b> bpm</span><input class="pb-bpm" type="range" min="40" max="160" step="1" value="84"></label>
  </div>
  <div class="pb-transport">
    <button type="button" class="pb-back" aria-label="Previous step">◀</button>
    <button type="button" class="pb-step pb-primary" aria-label="Next note or chord">Step ▶</button>
    <button type="button" class="pb-play">Play</button>
    <button type="button" class="pb-stop">Stop</button>
  </div>
  <p class="pb-status" aria-live="polite"></p>
  <canvas class="pb-tab" aria-label="TAB strip of the coming notes"></canvas>
  <canvas class="pb-fret" aria-label="Fretboard with the notes now sounding"></canvas>
  <div class="pb-explain" aria-live="polite"><p class="pb-dim">Press Step to play one note or chord at a time.</p></div>
  <div class="pb-seg pb-graphseg" role="group" aria-label="Ratio graph">
    <button type="button" data-graph="lissajous" class="on">Lissajous</button>
    <button type="button" data-graph="partials">Shared harmonics</button>
  </div>
  <canvas class="pb-ratio" aria-label="Ratio graph of two notes"></canvas>
  <p class="pb-cap"></p>
  <details class="pb-slow">
    <summary>Sound in slow motion: <b class="pb-policyV">Auto</b></summary>
    <select class="pb-policy" aria-label="Sound in slow motion"></select>
    <p>Slow motion slows the song with the strings. Each note still sounds at its true pitch, because its sound is made for the real string; only the tempo falls. At 1/100 speed and slower, one vibration of a low string lasts about a second, so a real-speed sound no longer matches the views. Auto mutes the sound there. Step always sounds, unless you choose "Mute slow motion".</p>
  </details>
</div>`;

const css = (name, fb) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fb;
  } catch (_) { return fb; }
};

/** Mount the playback panel in host. api = window.__strings (may fill later). */
export function mountPlayback(host, api = (typeof window !== 'undefined' && window.__strings) || {}) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const getApi = () => api || win.__strings || {};

  if (!doc.querySelector('link[data-pb-css]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./playback.css', import.meta.url).href;
    link.dataset.pbCss = '1';
    doc.head.appendChild(link);
  }
  host.innerHTML = MARKUP;
  const $ = (s) => host.querySelector(s);
  const el = {
    track: $('.pb-track'), about: $('.pb-about'), upload: $('.pb-upload'), tempo: $('.pb-tempo'), tempoV: $('.pb-tempoV'),
    prog: $('.pb-prog'), pattern: $('.pb-pattern'), bpm: $('.pb-bpm'), bpmV: $('.pb-bpmV'),
    back: $('.pb-back'), step: $('.pb-step'), play: $('.pb-play'), stop: $('.pb-stop'), status: $('.pb-status'),
    tab: $('.pb-tab'), fret: $('.pb-fret'), ratio: $('.pb-ratio'), cap: $('.pb-cap'), explain: $('.pb-explain'),
    policy: $('.pb-policy'), policyV: $('.pb-policyV'), song: $('.pb-song'), chords: $('.pb-chords'),
  };

  const state = {
    source: 'song', graph: 'lissajous', policy: 'auto',
    lastEvent: null, pair: null, dirty: true, phase: 0, uploads: [], loadId: 0,
    ownAudio: null, raf: 0, lastT: 0, destroyed: false,
  };

  // ── page api access ──
  function apiTimeScale() {
    const a = getApi();
    const v = typeof a.getTimeScale === 'function' ? a.getTimeScale() : a.timeScale ?? (a.world && a.world.timeScale);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }
  function apiInstrument() {
    const a = getApi();
    const k = typeof a.getInstrument === 'function' ? a.getInstrument() : a.instrument ?? (a.world && a.world.instKey);
    return INSTRUMENTS[k] ? k : session.instrumentKey;
  }
  function audio() {
    const a = getApi();
    if (a.audio && typeof a.audio.playNote === 'function') return a.audio;
    if (!state.ownAudio) {
      state.ownAudio = new AudioEngine();
      try { state.ownAudio.bindPagehide(win); } catch (_) { /* no window */ }
    }
    return state.ownAudio;
  }

  // ── sessions ──
  const session = new Session({ instrument: 'classical', onEvent: (ev) => onSessionEvent(ev) });
  const chords = new ChordSession({ onEvent: (ev) => onSessionEvent(ev) });
  const progs = PROGRESSIONS.concat(EXTRA_PROGRESSIONS);

  for (const t of TRACKS) el.track.add(new Option(`${t.title}`, t.id));
  progs.forEach((p, i) => el.prog.add(new Option(p.name, String(i))));
  STRUM_PATTERNS.forEach((p, i) => el.pattern.add(new Option(p.name + (p.meter === 3 ? ' (3/4)' : ''), String(i))));
  for (const p of SOUND_POLICIES) el.policy.add(new Option(p.label, p.key));
  el.pattern.value = '2';

  function setStatus(s) { el.status.textContent = s; }

  async function loadTrack(id, { adopt = false } = {}) {
    const t = TRACKS.find((x) => x.id === id);
    if (!t) {
      const up = state.uploads.find((u) => u.id === id);
      if (up) { useSong(up.song, null); }
      return;
    }
    const my = ++state.loadId;
    setStatus('Loading ' + t.title + '…');
    try {
      const res = await fetch(trackUrl(t));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (my !== state.loadId) return;
      const a = getApi();
      const setInst = a.setInstrument || a.loadInstrument;
      if (adopt && t.inst && typeof setInst === 'function' && apiInstrument() !== t.inst) await setInst.call(a, t.inst);
      useSong(loadSong(bytes, { name: t.title }), t);
    } catch (e) {
      if (my === state.loadId) setStatus('Could not load the track (' + e.message + ').');
    }
  }

  function useSong(song, track) {
    session.setInstrument(apiInstrument());
    session.load(song);
    el.about.textContent = track ? `${track.by}. ${track.about}` : `Your file: ${song.notes.length} notes, ${Math.round(song.bpm)} bpm. It stays in this browser.`;
    state.lastEvent = null;
    state.pair = null;
    el.explain.innerHTML = '<p class="pb-dim">Press Step to play one note or chord at a time, or Play.</p>';
    setStatus(`${session.steps.length} steps, ${fmtTime(session.duration)}. Step plays one onset (a note or a chord).`);
    state.dirty = true;
    syncButtons();
  }

  function loadBytes(bytes, name = 'Your file') {
    try {
      const song = loadSong(bytes, { name });
      const id = 'upload-' + (state.uploads.length + 1);
      state.uploads.push({ id, song });
      el.track.add(new Option('Your file: ' + song.name, id));
      el.track.value = id;
      useSong(song, null);
      return true;
    } catch (e) {
      setStatus('That file is not a MIDI file the lab can read (' + e.message + ').');
      return false;
    }
  }

  function setProgression() {
    const prog = progs[Number(el.prog.value)] || progs[0];
    let pat = STRUM_PATTERNS[Number(el.pattern.value)] || STRUM_PATTERNS[0];
    if ((prog.meter || 4) !== pat.meter) {
      const fit = STRUM_PATTERNS.find((p) => p.meter === (prog.meter || 4));
      if (fit) { pat = fit; el.pattern.value = String(STRUM_PATTERNS.indexOf(fit)); }
    }
    chords.setProgression(prog, pat);
    setStatus(`${prog.name}: ${chords.events.length} strums. ${pat.name}.`);
    state.dirty = true;
    syncButtons();
  }

  const active = () => (state.source === 'song' ? session : chords);

  function setSource(src) {
    if (src !== 'song' && src !== 'chords') return;
    active().pause();
    state.source = src;
    for (const b of host.querySelectorAll('[data-src]')) b.classList.toggle('on', b.dataset.src === src);
    el.song.hidden = src !== 'song';
    el.chords.hidden = src !== 'chords';
    if (src === 'chords') {
      if (!chords.events.length) setProgression();
      const inst = apiInstrument();
      chords.instrument = inst === 'violin' ? 'steel' : inst;
      if (inst === 'violin') setStatus('Chord shapes are for a guitar: the strums play on the steel-string guitar.');
      else setStatus(`${chords.prog.name}: ${chords.events.length} strums.`);
    }
    state.dirty = true;
    syncButtons();
  }

  // ── sounding events ──
  function onSessionEvent(ev) {
    const ts = apiTimeScale();
    const pol = soundPolicy(ts, state.policy);
    const sound = ev.how === 'step' ? state.policy !== 'slowmute' || ts >= 0.999 : pol.sound;
    const inst = INSTRUMENTS[ev.instrument];
    const frets = new Array(inst.tuning.length).fill(-1);
    let notes, direction = 'down', velocity = 0.8, duration = null;
    if (ev.kind === 'chord') {
      ev.strum.shape.frets.forEach((f, i) => { if (i < frets.length) frets[i] = f; });
      notes = ev.strum.shape.frets.map((f, i) => (f >= 0 ? { string: i, fret: f, midi: inst.tuning[i] + f } : null)).filter(Boolean);
      direction = ev.strum.dir === 'U' ? 'up' : 'down';
      velocity = ev.strum.accent ? 0.8 : 0.55;
    } else {
      notes = ev.step.notes;
      for (const n of notes) frets[n.string] = n.fret;
      velocity = Math.max(0.3, Math.min(1, ev.step.vel || 0.8));
      if (ev.how === 'play' && ts >= 0.999) duration = Math.max(0.12, ev.step.dur / session.tempo);
    }
    const a = getApi();
    const detail = { ...ev, sound, frets, direction, notes };
    // the page's playChord takes frets per string: null leaves a string
    // alone, -1 mutes it. A note step leaves the other strings ringing.
    const pageFrets = ev.kind === 'chord' ? frets : frets.map((f) => (f < 0 ? null : f));
    if (typeof a.playFrets === 'function') {
      try { a.playFrets({ instrument: ev.instrument, frets, direction, velocity, sound, duration, notes, source: 'playback' }); } catch (e) { console.warn('playFrets', e); }
    } else if (typeof a.playChord === 'function' && ev.instrument === apiInstrument()) {
      try { a.playChord(pageFrets, { dir: direction === 'up' ? 'U' : 'D', sound }); } catch (e) { console.warn('playChord', e); }
    } else if (sound) {
      const au = audio();
      if (au.start()) {
        if (ev.kind === 'chord') au.playChord({ instrument: ev.instrument, frets, direction, velocity, duration });
        else for (const n of notes) au.playNote({ instrument: ev.instrument, string: n.string, fret: n.fret, velocity, duration });
      }
    }
    state.lastEvent = ev;
    explain(ev);
    state.dirty = true;
    syncButtons();
    try { win.dispatchEvent(new win.CustomEvent('strings:playback', { detail })); } catch (_) { /* old browser */ }
  }

  // ── explainer text ──
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const cents = (c) => `${Math.abs(c).toFixed(1)} cents ${c >= 0 ? 'wide' : 'narrow'}`;
  function ratioLine(iv, label) {
    if (iv.semis === 0) return `${label}: the same note, ratio 1/1.`;
    const dir = iv.down ? 'down' : 'up';
    const et = iv.etRatio.toFixed(4);
    const tail = Math.abs(iv.diff) < 0.05 ? 'exact in equal temperament' : `equal temperament gives ${et}, ${cents(iv.diff)}`;
    return `${label}: ${dir} a ${esc(iv.name)}, just ratio <b>${iv.ratioText}</b>; ${tail}.`;
  }

  function explainNote(ev) {
    const inst = INSTRUMENTS[ev.instrument];
    const st = ev.step;
    const top = st.notes[st.notes.length - 1];
    const d = describeNote(inst, top, { prev: ev.prevTop, rootPc: st.rootPc });
    const frac = 2 ** (-top.fret / 12);
    const lines = [];
    const where = inst.bowed ? (top.fret ? `stopped ${top.fret} semitones up` : 'open') : (top.fret ? `fret ${top.fret}` : 'open');
    lines.push(`<p class="pb-big"><b>${d.name}</b> <span>${fmtHz(d.f)}</span></p>`);
    lines.push(`<p>${esc(d.stringName)} string, ${where}${top.shifted ? ' (moved by an octave to fit)' : ''}. Vibrating length ${(d.lengthM * 1000).toFixed(0)} mm` +
      (top.fret ? ` = ${frac.toFixed(3)} of the open string, so the frequency is ${(1 / frac).toFixed(3)} times the open note.` : '.') +
      ` f = c / 2L with c = ${d.waveSpeed.toFixed(0)} m/s.</p>`);
    if (d.fromPrev) lines.push(`<p>${ratioLine(d.fromPrev, 'From ' + noteName(ev.prevTop))}</p>`);
    if (d.fromRoot) lines.push(`<p>${ratioLine(d.fromRoot, 'Over the root ' + noteName(d.root) + (st.chord ? ` (chord ${esc(st.chord)})` : ''))}</p>`);
    if (st.notes.length > 1) {
      const midis = st.notes.map((n) => n.midi);
      const r = chordRatios(midis, st.rootPc);
      lines.push(`<p>Together: ${midis.map(noteName).join(' ')} = <b>${r.text}</b> over ${noteName(r.root)}.</p>`);
    }
    if (st.dropped && st.dropped.length) lines.push(`<p class="pb-dim">Left out on this instrument: ${st.dropped.map(noteName).join(', ')}.</p>`);
    // the pair for the ratio graph
    state.pair = ev.prevTop != null && ev.prevTop !== top.midi ? [ev.prevTop, top.midi] : d.root != null && d.root !== top.midi ? [d.root, top.midi] : null;
    return lines.join('');
  }

  function explainChord(ev) {
    const inst = INSTRUMENTS[ev.instrument];
    const shape = ev.strum.shape;
    const rootPc = pcOf(shape.root);
    const r = chordRatios(ev.midis, rootPc);
    const rows = shape.frets.map((f, i) => {
      const s = inst.strings[i];
      if (f < 0) return `<li class="pb-mute">${esc(s.name)}: not played</li>`;
      const m = inst.tuning[i] + f;
      return `<li>${esc(s.name)} ${f ? 'fret ' + f : 'open'}: <b>${noteName(m)}</b> ${fmtHz(midiToFreq(m))}</li>`;
    }).join('');
    const third = r.parts.find((p) => p.name && /third|tenth/.test(p.name));
    const fifth = r.parts.find((p) => p.text === '3/2' || p.text === '3/1' || p.text === '6/1');
    let note = '';
    if (third) note += ` The ${esc(third.name)} ${third.text} is ${cents(third.diff)} in equal temperament, which you hear as a slow beat.`;
    if (fifth) note += ` The fifth is within 2 cents of ${fifth.text}.`;
    state.pair = [r.root, fifth ? fifth.midi : third ? third.midi : ev.midis[ev.midis.length - 1]];
    return `<p class="pb-big"><b>${esc(ev.strum.chord)}</b> <span>strum ${ev.strum.dir === 'U' ? 'up' : 'down'}</span></p>` +
      `<ul class="pb-strings">${rows}</ul>` +
      `<p>Over the root ${noteName(r.root)}: ${r.parts.map((p) => p.text).join(' : ')} = <b>${r.text}</b>.${note}</p>`;
  }

  function explain(ev) {
    el.explain.innerHTML = ev.kind === 'chord' ? explainChord(ev) : explainNote(ev);
  }

  // ── buttons ──
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function syncButtons() {
    const s = active();
    el.play.textContent = s.playing ? 'Pause' : 'Play';
    el.play.classList.toggle('on', s.playing);
  }
  function step() {
    const s = active();
    if (state.source === 'song' && !session.song) return null;
    const ev = s.next();
    if (!ev) { setStatus('End. Step again to start over.'); if (s === session) session.rewind(); else chords.rewind(); state.dirty = true; return null; }
    const n = ev.kind === 'chord' ? ev.i + 1 : ev.step.i + 1;
    setStatus(`Step ${n} of ${ev.total}.`);
    return ev;
  }
  function back() {
    if (state.source === 'song' && !session.song) return null;
    return active().prev();
  }
  function toggle() {
    const s = active();
    if (s.playing) s.pause();
    else {
      // the sound context starts here, inside the click
      const a = getApi();
      if (!a.playFrets && !a.playChord) audio().start();
      s.play();
      const ts = apiTimeScale();
      const pol = soundPolicy(ts, state.policy);
      setStatus(ts >= 0.999 ? 'Playing.' : `Playing at ${fmtScale(ts)} speed: ${pol.reason}.`);
    }
    syncButtons();
  }
  function stop() {
    active().stop ? active().stop() : active().rewind();
    const a = getApi();
    if (a.audio && a.audio.stopAll) a.audio.stopAll();
    if (state.ownAudio) state.ownAudio.stopAll();
    setStatus('Stopped.');
    state.dirty = true;
    syncButtons();
  }
  const fmtScale = (ts) => (ts >= 1 ? '1×' : `1/${Math.round(1 / ts)}`);

  const on = (node, type, fn) => node.addEventListener(type, fn);
  on(el.step, 'click', step);
  on(el.back, 'click', back);
  on(el.play, 'click', toggle);
  on(el.stop, 'click', stop);
  on(el.track, 'change', () => loadTrack(el.track.value, { adopt: true }));
  on(el.upload, 'change', async () => {
    const f = el.upload.files && el.upload.files[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    loadBytes(new Uint8Array(buf), f.name.replace(/\.midi?$/i, ''));
    el.upload.value = '';
  });
  on(el.tempo, 'input', () => {
    session.setTempo(Number(el.tempo.value));
    el.tempoV.textContent = Math.round(session.tempo * 100) + '%';
  });
  on(el.prog, 'change', setProgression);
  on(el.pattern, 'change', setProgression);
  on(el.bpm, 'input', () => { chords.setBpm(Number(el.bpm.value)); el.bpmV.textContent = el.bpm.value; });
  on(el.policy, 'change', () => {
    state.policy = el.policy.value;
    el.policyV.textContent = SOUND_POLICIES.find((p) => p.key === state.policy).label;
  });
  for (const b of host.querySelectorAll('[data-src]')) on(b, 'click', () => setSource(b.dataset.src));
  for (const b of host.querySelectorAll('[data-graph]')) on(b, 'click', () => {
    state.graph = b.dataset.graph;
    for (const x of host.querySelectorAll('[data-graph]')) x.classList.toggle('on', x === b);
    state.dirty = true;
  });

  // ── canvases ──
  function fit(cv, cssH) {
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.max(160, cv.clientWidth || host.clientWidth || 300);
    cv.style.height = cssH + 'px';
    const W = Math.round(w * dpr), H = Math.round(cssH * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h: cssH };
  }
  function colors() {
    return {
      bg: css('--ink2', '#0e111b'), text: css('--text', '#dde1ec'), dim: css('--dim', '#8b92a8'), faint: css('--faint', '#363b52'),
      tone: css('--tone', '#8fb6ff'), hi: css('--hi', '#ffd27a'), ok: css('--ok', '#7ee0a8'), line: css('--line-b', 'rgba(143,182,255,0.24)'),
      mono: css('--mono', 'ui-monospace, Menlo, monospace'),
    };
  }

  /** Columns for the TAB strip: [{ frets: [s -> fret or -1], label, dir }]. */
  function tabColumns() {
    if (state.source === 'song') {
      return session.steps.map((st) => {
        const f = new Array(session.instrument.tuning.length).fill(-1);
        for (const n of st.notes) f[n.string] = n.fret;
        return { frets: f, label: st.chord, t: st.t };
      });
    }
    return chords.events.map((e) => ({ frets: e.shape.frets.slice(), label: e.chord, dir: e.dir }));
  }

  function drawTab(C) {
    const r = fit(el.tab, 104);
    if (!r) return;
    const { g, w, h } = r;
    g.clearRect(0, 0, w, h);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, w, h);
    const inst = state.source === 'song' ? session.instrument : INSTRUMENTS[chords.instrument];
    const S = inst.tuning.length;
    const top = 22, bot = h - 10, gap = (bot - top) / (S - 1);
    const yOf = (s) => bot - s * gap; // high string at the top
    g.strokeStyle = C.faint;
    g.lineWidth = 1;
    g.font = `10px ${C.mono}`;
    g.textBaseline = 'middle';
    for (let s = 0; s < S; s++) {
      g.beginPath(); g.moveTo(18, yOf(s)); g.lineTo(w, yOf(s)); g.stroke();
      g.fillStyle = C.dim;
      g.fillText(inst.strings[s].name.replace(/\d/, ''), 3, yOf(s));
    }
    const cols = tabColumns();
    if (!cols.length) {
      g.fillStyle = C.dim;
      g.fillText('No track loaded', 26, 10);
      return;
    }
    const act = active();
    const cur = act.cursor;
    const dx = 30, x0 = 18 + Math.min(110, w * 0.28);
    g.strokeStyle = C.hi;
    g.globalAlpha = 0.5;
    g.beginPath(); g.moveTo(x0, 12); g.lineTo(x0, h - 2); g.stroke();
    g.globalAlpha = 1;
    const first = Math.max(0, Math.floor(cur - x0 / dx) - 1);
    const last = Math.min(cols.length - 1, Math.ceil(cur + (w - x0) / dx) + 1);
    let lastLabel = first > 0 ? cols[first - 1].label : null;
    g.textAlign = 'center';
    for (let i = first; i <= last; i++) {
      const x = x0 + (i - cur) * dx;
      if (x < 22 || x > w - 6) { lastLabel = cols[i].label; continue; }
      const c = cols[i];
      const isNow = act.index === i;
      const lastLabelDrawn = c.label !== lastLabel ? null : c.label;
      if (c.label && c.label !== lastLabel) {
        g.fillStyle = C.tone;
        g.font = `600 10px ${C.mono}`;
        g.fillText(c.label, x, 9);
      }
      lastLabel = c.label;
      if (c.dir) {
        g.fillStyle = C.dim;
        g.font = `10px ${C.mono}`;
        g.fillText(c.dir === 'U' ? '↑' : '↓', c.label && c.label !== lastLabelDrawn ? x + 11 : x, 9);
      }
      g.font = `${isNow ? '700 ' : ''}11px ${C.mono}`;
      for (let s = 0; s < S; s++) {
        const f = c.frets[s];
        if (f == null || f < 0) continue;
        const y = yOf(s), txt = String(f), tw = txt.length * 7 + 4;
        g.fillStyle = C.bg;
        g.fillRect(x - tw / 2, y - 6, tw, 12);
        g.fillStyle = isNow ? C.hi : i < (act.index ?? -1) ? C.faint : C.text;
        g.fillText(txt, x, y + 0.5);
      }
    }
    g.textAlign = 'left';
  }

  function drawFretboard(C) {
    const r = fit(el.fret, 74);
    if (!r) return;
    const { g, w, h } = r;
    g.clearRect(0, 0, w, h);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, w, h);
    const ev = state.lastEvent;
    const instKey = state.source === 'song' ? session.instrumentKey : chords.instrument;
    const inst = INSTRUMENTS[instKey];
    const S = inst.tuning.length;
    let hiFret = 12;
    const cur = [];
    if (ev) {
      if (ev.kind === 'chord') ev.strum.shape.frets.forEach((f, s) => cur.push({ string: s, fret: f }));
      else for (const n of ev.step.notes) cur.push(n);
      for (const n of cur) hiFret = Math.max(hiFret, n.fret + 2);
    }
    hiFret = Math.min(inst.frets, hiFret);
    const left = 22, right = w - 8, top = 10, bot = h - 14;
    const L = right - left;
    // fret n sits at L (1 - 2^(-n/12)) scaled so fret hiFret fills the box
    const span = 1 - 2 ** (-hiFret / 12);
    const xOf = (n) => left + (L * (1 - 2 ** (-n / 12))) / span;
    const yOf = (s) => bot - (s * (bot - top)) / (S - 1);
    g.fillStyle = 'rgba(143,182,255,0.05)';
    g.fillRect(left, top - 4, L, bot - top + 8);
    g.strokeStyle = C.line;
    g.font = `9px ${C.mono}`;
    g.textAlign = 'center';
    for (let n = 0; n <= hiFret; n++) {
      const x = xOf(n);
      g.lineWidth = n === 0 ? 3 : 1;
      g.globalAlpha = inst.bowed && n > 0 ? 0.35 : 1;
      g.beginPath(); g.moveTo(x, top - 4); g.lineTo(x, bot + 4); g.stroke();
      g.globalAlpha = 1;
      if ([3, 5, 7, 9, 12, 15, 17, 19].includes(n)) { g.fillStyle = C.dim; g.fillText(String(n), (xOf(n - 1) + x) / 2, h - 4); }
    }
    for (let s = 0; s < S; s++) {
      g.strokeStyle = C.dim;
      g.lineWidth = 0.6 + (S - 1 - s) * 0.25;
      g.beginPath(); g.moveTo(left, yOf(s)); g.lineTo(right, yOf(s)); g.stroke();
    }
    for (const n of cur) {
      const y = yOf(n.string);
      if (n.fret < 0) { g.fillStyle = C.dim; g.fillText('×', left - 10, y + 3); continue; }
      if (n.fret === 0) {
        g.strokeStyle = C.hi; g.lineWidth = 1.5;
        g.beginPath(); g.arc(left - 10, y, 4, 0, Math.PI * 2); g.stroke();
        continue;
      }
      const x = (xOf(n.fret - 1) + xOf(n.fret)) / 2;
      g.fillStyle = C.hi;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    }
    g.textAlign = 'left';
    if (inst.bowed) { g.fillStyle = C.dim; g.fillText('no frets: semitone stops', left + 2, 8); }
  }

  function drawRatio(C, dt) {
    const r = fit(el.ratio, 150);
    if (!r) return;
    const { g, w, h } = r;
    g.clearRect(0, 0, w, h);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, w, h);
    const pair = state.pair;
    if (!pair) {
      el.cap.textContent = 'The graph compares two notes: the last two, or a note and its chord root.';
      return;
    }
    const [m1, m2] = pair[0] <= pair[1] ? pair : [pair[1], pair[0]];
    const f1 = midiToFreq(m1), f2 = midiToFreq(m2);
    const iv = intervalInfo(m1, m2);
    if (state.graph === 'lissajous') {
      // x follows the lower note, y the upper; fold big ratios by octaves
      let rr = f2 / f1, folds = 0;
      while (rr > 4.01) { rr /= 2; folds++; }
      state.phase += dt * 0.5;
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
      g.strokeStyle = C.faint;
      g.strokeRect(cx - R, cy - R, 2 * R, 2 * R);
      g.strokeStyle = C.tone;
      g.lineWidth = 1.4;
      g.beginPath();
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      let fn = iv.num, fd = iv.den * 2 ** folds;
      const gg = gcd(fn, fd); fn /= gg; fd /= gg;
      const N = 1400, turns = Math.min(16, fd);
      for (let k = 0; k <= N; k++) {
        const t = (k / N) * turns;
        const x = cx + R * Math.sin(2 * Math.PI * t);
        const y = cy - R * Math.sin(2 * Math.PI * rr * t + state.phase);
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      g.fillStyle = C.text;
      g.font = `11px ${C.mono}`;
      g.fillText(`${noteName(m1)} → x`, 6, 14);
      g.fillText(`${noteName(m2)} → y`, 6, 28);
      g.textAlign = 'right';
      g.fillStyle = C.hi;
      g.fillText(`${iv.ratioText}`, w - 6, 14);
      g.fillStyle = C.dim;
      g.fillText(`ET ${(f2 / f1).toFixed(4)}`, w - 6, 28);
      g.textAlign = 'left';
      el.cap.textContent = `Lissajous figure: the lower note moves the dot sideways, the upper note moves it up and down. A simple ratio such as ${iv.ratioText} closes after ${iv.den} sideways swings and ${iv.num} up-and-down swings. ` +
        (Math.abs(iv.diff) > 0.05 ? `Equal temperament is ${Math.abs(iv.diff).toFixed(1)} cents off, so the figure turns slowly.` : 'This ratio is exact, so the figure stands still.') +
        (folds ? ` Folded by ${folds} octave${folds > 1 ? 's' : ''} to fit.` : '');
    } else {
      const nMax = 10;
      const sp = sharedPartials(f1, f2, nMax, 20);
      const lo = Math.log2(f1 * 0.9), hiF = Math.log2(Math.max(f1, f2) * nMax * 1.1);
      const xOf = (f) => 10 + ((Math.log2(f) - lo) / (hiF - lo)) * (w - 20);
      const y1 = h * 0.7, y2 = h * 0.3;
      g.font = `10px ${C.mono}`;
      for (const [f0, y, col, name] of [[f1, y1, C.tone, noteName(m1)], [f2, y2, C.ok, noteName(m2)]]) {
        g.fillStyle = C.dim;
        g.fillText(name, 4, y - 12);
        for (let n = 1; n <= nMax; n++) {
          const x = xOf(n * f0);
          g.strokeStyle = col;
          g.globalAlpha = 0.25 + 0.75 / n;
          g.lineWidth = 2;
          g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x, y + 8); g.stroke();
        }
        g.globalAlpha = 1;
      }
      for (const p of sp) {
        const x = xOf(p.f);
        g.strokeStyle = C.hi;
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, y1 - 8); g.lineTo(xOf(p.j * f2), y2 + 8); g.stroke();
        g.fillStyle = C.hi;
        g.fillText(`${p.i}=${p.j}`, x + 3, (y1 + y2) / 2);
      }
      el.cap.textContent = `Harmonics 1 to ${nMax} of each note on a log frequency axis. Gold links join harmonics within 20 cents: ${sp.length} shared. ` +
        `For ${iv.ratioText}, harmonic ${iv.num} of the lower note meets harmonic ${iv.den} of the upper. More shared harmonics give a smoother, more consonant sound.`;
    }
  }

  // ── frame loop ──
  let lastInst = null;
  function frame(t) {
    if (state.destroyed) return;
    state.raf = win.requestAnimationFrame(frame);
    const dt = state.lastT ? Math.min(0.25, (t - state.lastT) / 1000) : 0;
    state.lastT = t;
    const inst = apiInstrument();
    if (inst !== lastInst) {
      lastInst = inst;
      const wasPlaying = session.playing;
      session.pause();
      session.setInstrument(inst);
      if (wasPlaying) session.play();
      chords.instrument = inst === 'violin' ? 'steel' : inst;
      state.dirty = true;
    }
    const ts = apiTimeScale();
    const s = active();
    if (s.playing) {
      s.tick(dt, ts);
      state.dirty = true;
      if (!s.playing) { setStatus('End of the track.'); syncButtons(); }
    }
    if (doc.hidden) return;
    const C = colors();
    if (state.dirty) {
      drawTab(C);
      drawFretboard(C);
      state.dirty = false;
    }
    drawRatio(C, dt);
  }

  const ctl = {
    step, back, toggle, stop, setSource, loadTrack, loadBytes,
    session, chords,
    get source() { return state.source; },
    get policy() { return state.policy; },
    setPolicy(k) { el.policy.value = k; el.policy.dispatchEvent(new win.Event('change')); },
    destroy() {
      state.destroyed = true;
      win.cancelAnimationFrame(state.raf);
      session.pause(); chords.pause();
      if (state.ownAudio) state.ownAudio.stopAll();
      host.innerHTML = '';
    },
    _frame: frame,
  };
  const a = getApi();
  if (a && typeof a === 'object') a.playback = ctl;

  setProgression();
  setSource('song');
  el.track.value = TRACKS[0].id;
  loadTrack(TRACKS[0].id);
  state.raf = win.requestAnimationFrame(frame);
  return ctl;
}
