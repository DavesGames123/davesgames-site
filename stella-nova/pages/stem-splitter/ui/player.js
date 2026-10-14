// ============================================================================
//  STEM SPLITTER  ·  ui/player.js — sample-locked playback of all stems
// ----------------------------------------------------------------------------
//  CONTRACT 6.2. One AudioContext. Each track is an AudioBufferSourceNode ->
//  GainNode -> master GainNode -> destination. Play makes new sources for
//  all tracks and starts each one with the same `when` and the same
//  `offset`, so all stems stay on the same sample. Pause and seek stop all
//  sources and keep the position. Play starts new sources again.
//
//  Position while playing = offset + (ctx.currentTime - when), clamped to
//  0 .. duration. Gain of a track = volume x (anySolo ? (solo ? 1 : 0) :
//  (mute ? 0 : 1)), set with setTargetAtTime(v, now, 0.01).
//
//  GREP MAP
//    gainFor ........... the gain rule (pure)
//    START_DELAY ....... 0.05 s from currentTime to `when`
//    createPlayer ...... { play, pause, toggle, seek, position, set, ... }
//    startAll / stopAll  the source pair of play and pause
// ============================================================================

export const START_DELAY = 0.05;
export const GAIN_TC = 0.01;

export function gainFor(t, anySolo) {
  const v = Number.isFinite(t.volume) ? t.volume : 1;
  return v * (anySolo ? (t.solo ? 1 : 0) : (t.mute ? 0 : 1));
}

// tracks: [{ id, buffer: AudioBuffer, volume = 1, mute = false, solo = false }]
export function createPlayer({ ctx, tracks, onEnded } = {}) {
  if (!ctx) throw new Error('createPlayer needs an AudioContext');
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  const list = tracks.map(t => {
    const gain = ctx.createGain();
    gain.connect(master);
    return { id: t.id, buffer: t.buffer, gain, volume: t.volume ?? 1, mute: !!t.mute, solo: !!t.solo, src: null };
  });
  const duration = list.reduce((d, t) => Math.max(d, t.buffer.duration), 0);
  let playing = false, offset = 0, when = 0, endTimer = null, dead = false;

  const anySolo = () => list.some(t => t.solo);
  function applyGains(immediate) {
    const s = anySolo(), now = ctx.currentTime;
    for (const t of list) {
      const v = gainFor(t, s);
      if (immediate) t.gain.gain.value = v;
      else t.gain.gain.setTargetAtTime(v, now, GAIN_TC);
    }
  }
  applyGains(true);

  function position() {
    if (!playing) return offset;
    // Before `when` the sources have not started: the position is offset.
    return Math.min(duration, offset + Math.max(0, ctx.currentTime - when));
  }

  function stopAll() {
    for (const t of list) {
      if (!t.src) continue;
      t.src.onended = null;
      try { t.src.stop(); } catch (e) { /* not started */ }
      try { t.src.disconnect(); } catch (e) { /* gone */ }
      t.src = null;
    }
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  }

  function startAll() {
    when = ctx.currentTime + START_DELAY;
    for (const t of list) {
      const s = ctx.createBufferSource();
      s.buffer = t.buffer;
      s.connect(t.gain);
      s.start(when, offset);
      t.src = s;
    }
    // One timer at the end of the longest track; onended of a source can
    // come from stop() as well, so the timer is the end signal.
    const left = duration - offset + START_DELAY;
    endTimer = setTimeout(finish, Math.max(0, left * 1000) + 30);
  }

  function finish() {
    endTimer = null;
    if (!playing) return;
    if (position() < duration - 0.02) { endTimer = setTimeout(finish, 50); return; }
    stopAll();
    playing = false; offset = 0;
    if (onEnded) onEnded();
  }

  return {
    duration,
    get playing() { return playing; },
    tracks: list,
    position,
    play() {
      if (dead || playing || duration <= 0) return;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      if (offset >= duration) offset = 0;
      playing = true;
      startAll();
    },
    pause() {
      if (!playing) return;
      offset = position();
      stopAll();
      playing = false;
    },
    toggle() { if (playing) this.pause(); else this.play(); },
    seek(sec) {
      const t = Math.min(duration, Math.max(0, Number(sec) || 0));
      if (playing) { stopAll(); offset = t; startAll(); }
      else offset = t;
    },
    // patch: { volume?, mute?, solo? }
    set(id, patch) {
      const t = list.find(x => x.id === id);
      if (!t) return;
      if ('volume' in patch) t.volume = Math.max(0, Number(patch.volume) || 0);
      if ('mute' in patch) t.mute = !!patch.mute;
      if ('solo' in patch) t.solo = !!patch.solo;
      applyGains(false);
    },
    setAll(states) {
      for (const t of list) { const p = states[t.id]; if (p) { t.volume = p.volume ?? t.volume; t.mute = !!p.mute; t.solo = !!p.solo; } }
      applyGains(false);
    },
    gains() { const s = anySolo(); return Object.fromEntries(list.map(t => [t.id, gainFor(t, s)])); },
    destroy() {
      dead = true;
      stopAll(); playing = false;
      for (const t of list) { try { t.gain.disconnect(); } catch (e) { /* gone */ } }
      try { master.disconnect(); } catch (e) { /* gone */ }
    },
  };
}
