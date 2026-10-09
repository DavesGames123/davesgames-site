// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · midi.js — Standard MIDI Files, scheduler, fretting mapper
// ────────────────────────────────────────────────────────────────────────────
//  parseMidi reads format 0 and 1 files: variable-length deltas, running
//  status, meta events (tempo, names, end of track) and sysex. Ticks become
//  seconds through the tempo map (all tracks share it). writeMidi writes the
//  same event objects back (with running status), so a song survives a round
//  trip. The Scheduler plays a note list on any clock (seconds) and can step
//  one onset group (a note or a chord) at a time.
//
//  mapFretting assigns each note to a string and fret. It is a dynamic
//  program (Viterbi) over onset groups: each group has candidate hand shapes,
//  and the cost adds the hand move from the last group, the span of the
//  shape and the height on the neck. Open strings are cheap.
//
//  SECTION MAP   (grep -n "<anchor>" midi.js)
//    reader ............... "export function parseMidi"
//    writer ............... "export function writeMidi"
//    note list ............ "export function notesFromMidi"
//    notes -> song ........ "export function songFromNotes"
//    onset groups ......... "export function groupOnsets"
//    scheduler ............ "export class Scheduler"
//    candidates ........... "function candidates"
//    fretting DP .......... "export function mapFretting"
//    playable check ....... "export function isPlayable"
// ════════════════════════════════════════════════════════════════════════════

const CH_LEN = { 0x8: 2, 0x9: 2, 0xa: 2, 0xb: 2, 0xc: 1, 0xd: 1, 0xe: 2 };
const CH_TYPE = { 0x8: 'noteOff', 0x9: 'noteOn', 0xa: 'aftertouch', 0xb: 'cc', 0xc: 'program', 0xd: 'channelPressure', 0xe: 'pitchBend' };
const TYPE_NIB = Object.fromEntries(Object.entries(CH_TYPE).map(([k, v]) => [v, +k]));

function readVLQ(b, o) {
  let v = 0, i = 0, c;
  do {
    c = b[o + i++];
    if (c === undefined) throw new Error('MIDI: truncated variable-length value');
    v = (v << 7) | (c & 0x7f);
  } while (c & 0x80 && i < 4);
  return [v, i];
}
function writeVLQ(v, out) {
  const tmp = [v & 0x7f];
  while ((v >>= 7) > 0) tmp.unshift((v & 0x7f) | 0x80);
  out.push(...tmp);
}
const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b, o) => (b[o] << 8) | b[o + 1];

/**
 * Parse a Standard MIDI File. Returns { format, division, tracks } where each
 * track is a list of events with an absolute `tick`.
 */
export function parseMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input.buffer ? input.buffer : input);
  if (str4(b, 0) !== 'MThd') throw new Error('MIDI: no MThd header');
  const hlen = u32(b, 4);
  const format = u16(b, 8), ntrks = u16(b, 10), divRaw = u16(b, 12);
  let division = divRaw;
  let smpte = null;
  if (divRaw & 0x8000) {
    const fps = 256 - (divRaw >> 8);
    const tpf = divRaw & 0xff;
    smpte = { fps, tpf };
    division = fps * tpf; // ticks per second
  }
  let o = 8 + hlen;
  const tracks = [];
  for (let t = 0; t < ntrks && o + 8 <= b.length; t++) {
    const id = str4(b, o), len = u32(b, o + 4);
    o += 8;
    if (id !== 'MTrk') { o += len; t--; continue; }
    const end = Math.min(b.length, o + len);
    const ev = [];
    let tick = 0, status = 0;
    while (o < end) {
      const [d, n] = readVLQ(b, o);
      o += n;
      tick += d;
      let s = b[o];
      if (s & 0x80) o++;
      else if (status) s = status; // running status
      else throw new Error('MIDI: data byte without status');
      if (s === 0xff) {
        const type = b[o++];
        const [l, m] = readVLQ(b, o);
        o += m;
        const data = b.slice(o, o + l);
        o += l;
        const e = { tick, type: 'meta', metaType: type, data };
        if (type === 0x51) e.tempo = (data[0] << 16) | (data[1] << 8) | data[2];
        if (type >= 0x01 && type <= 0x07) e.text = new TextDecoder().decode(data);
        if (type === 0x58) e.timeSig = [data[0], 2 ** data[1]];
        ev.push(e);
        if (type === 0x2f) break;
        status = 0; // meta and sysex cancel running status
      } else if (s === 0xf0 || s === 0xf7) {
        const [l, m] = readVLQ(b, o);
        o += m;
        ev.push({ tick, type: 'sysex', status: s, data: b.slice(o, o + l) });
        o += l;
        status = 0;
      } else {
        const hi = s >> 4, ch = s & 15;
        const len = CH_LEN[hi];
        if (!len) throw new Error('MIDI: bad status 0x' + s.toString(16));
        const d1 = b[o], d2 = len === 2 ? b[o + 1] : 0;
        o += len;
        status = s;
        const e = { tick, type: CH_TYPE[hi], ch };
        if (hi === 0x8 || hi === 0x9) { e.note = d1; e.vel = d2; }
        else if (hi === 0xa) { e.note = d1; e.value = d2; }
        else if (hi === 0xb) { e.controller = d1; e.value = d2; }
        else if (hi === 0xc) e.program = d1;
        else if (hi === 0xd) e.value = d1;
        else e.value = (d2 << 7) | d1;
        ev.push(e);
      }
    }
    o = end;
    tracks.push(ev);
  }
  return { format, division, smpte, tracks };
}

/** Encode { format, division, tracks } (absolute ticks) to a .mid file. */
export function writeMidi(song) {
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6];
  const tracks = song.tracks;
  out.push(0, song.format ?? (tracks.length > 1 ? 1 : 0), (tracks.length >> 8) & 255, tracks.length & 255);
  out.push((song.division >> 8) & 0x7f, song.division & 255);
  for (const tr of tracks) {
    const evs = tr.map((e, i) => [e, i]).sort((a, b) => a[0].tick - b[0].tick || a[1] - b[1]).map((x) => x[0]);
    const body = [];
    let last = 0, status = 0, hasEnd = false;
    for (const e of evs) {
      writeVLQ(Math.max(0, e.tick - last), body);
      last = Math.max(last, e.tick);
      if (e.type === 'meta') {
        let data = e.data;
        if (!data && e.metaType === 0x51) data = [(e.tempo >> 16) & 255, (e.tempo >> 8) & 255, e.tempo & 255];
        if (!data && e.text != null) data = [...new TextEncoder().encode(e.text)];
        data = data || [];
        body.push(0xff, e.metaType);
        writeVLQ(data.length, body);
        body.push(...data);
        status = 0;
        if (e.metaType === 0x2f) { hasEnd = true; break; }
      } else if (e.type === 'sysex') {
        body.push(e.status || 0xf0);
        writeVLQ(e.data.length, body);
        body.push(...e.data);
        status = 0;
      } else {
        const s = (TYPE_NIB[e.type] << 4) | (e.ch & 15);
        if (s !== status) body.push(s); // running status
        status = s;
        if (e.type === 'noteOn' || e.type === 'noteOff') body.push(e.note & 127, e.vel & 127);
        else if (e.type === 'aftertouch') body.push(e.note & 127, e.value & 127);
        else if (e.type === 'cc') body.push(e.controller & 127, e.value & 127);
        else if (e.type === 'program') body.push(e.program & 127);
        else if (e.type === 'channelPressure') body.push(e.value & 127);
        else body.push(e.value & 127, (e.value >> 7) & 127);
      }
    }
    if (!hasEnd) body.push(0, 0xff, 0x2f, 0);
    out.push(0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255);
    for (let i = 0; i < body.length; i++) out.push(body[i]);
  }
  return Uint8Array.from(out);
}

/** Tick -> seconds converter from the tempo events of all tracks. */
export function tempoMap(parsed) {
  if (parsed.smpte) return (tick) => tick / parsed.division;
  const tempos = [];
  for (const tr of parsed.tracks) for (const e of tr) if (e.type === 'meta' && e.metaType === 0x51) tempos.push([e.tick, e.tempo]);
  tempos.sort((a, b) => a[0] - b[0]);
  const segs = [{ tick: 0, sec: 0, us: 500000 }];
  for (const [tick, us] of tempos) {
    const p = segs[segs.length - 1];
    const sec = p.sec + ((tick - p.tick) * p.us) / 1e6 / parsed.division;
    if (tick === p.tick) p.us = us;
    else segs.push({ tick, sec, us });
  }
  return (tick) => {
    let s = segs[0];
    for (let i = 1; i < segs.length && segs[i].tick <= tick; i++) s = segs[i];
    return s.sec + ((tick - s.tick) * s.us) / 1e6 / parsed.division;
  };
}

/** Note list in seconds: [{ t, dur, midi, vel, ch, track, drum }], sorted by t. */
export function notesFromMidi(parsed) {
  const toSec = tempoMap(parsed);
  const notes = [];
  parsed.tracks.forEach((tr, ti) => {
    const open = new Map();
    for (const e of tr) {
      if (e.type !== 'noteOn' && e.type !== 'noteOff') continue;
      const key = e.ch * 128 + e.note;
      if (e.type === 'noteOn' && e.vel > 0) {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push(e);
      } else {
        const q = open.get(key);
        if (q && q.length) {
          const on = q.shift();
          const t = toSec(on.tick);
          notes.push({ t, dur: Math.max(0.01, toSec(e.tick) - t), midi: on.note, vel: on.vel / 127, ch: on.ch, track: ti, drum: on.ch === 9 });
        }
      }
    }
    for (const q of open.values()) for (const on of q) {
      notes.push({ t: toSec(on.tick), dur: 0.5, midi: on.note, vel: on.vel / 127, ch: on.ch, track: ti, drum: on.ch === 9 });
    }
  });
  notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return notes;
}

/** Track names (meta 0x03) and the first tempo, for the UI. */
export function songInfo(parsed) {
  const names = parsed.tracks.map((tr) => (tr.find((e) => e.type === 'meta' && e.metaType === 0x03) || {}).text || '');
  let tempo = 500000;
  for (const tr of parsed.tracks) for (const e of tr) if (e.type === 'meta' && e.metaType === 0x51) { tempo = e.tempo; break; }
  return { names, bpm: 60e6 / tempo, format: parsed.format, tracks: parsed.tracks.length };
}

/**
 * Build a format 0 song from notes { t (beats), dur (beats), midi, vel 0..1 }.
 * Used for the files we write ourselves (public-domain pieces).
 */
export function songFromNotes(notes, { bpm = 90, division = 480, name = '', program = 24, ch = 0 } = {}) {
  const ev = [];
  if (name) ev.push({ tick: 0, type: 'meta', metaType: 0x03, text: name });
  ev.push({ tick: 0, type: 'meta', metaType: 0x51, tempo: Math.round(60e6 / bpm) });
  ev.push({ tick: 0, type: 'meta', metaType: 0x58, data: [4, 2, 24, 8] });
  ev.push({ tick: 0, type: 'program', ch, program });
  const offs = [], ons = [];
  for (const n of notes) {
    const on = Math.round(n.t * division), off = Math.round((n.t + n.dur) * division);
    ons.push({ tick: on, type: 'noteOn', ch, note: n.midi, vel: Math.max(1, Math.round((n.vel ?? 0.8) * 127)) });
    // note-off as note-on with velocity 0: one status byte for the whole
    // track under running status
    offs.push({ tick: off, type: 'noteOn', ch, note: n.midi, vel: 0 });
  }
  // at the same tick, note-offs go first so a repeated note restarts
  const all = [...offs.map((e) => [e, 0]), ...ons.map((e) => [e, 1])].sort((a, b) => a[0].tick - b[0].tick || a[1] - b[1]);
  for (const [e] of all) ev.push(e);
  const end = all.length ? all[all.length - 1][0].tick : 0;
  ev.push({ tick: end, type: 'meta', metaType: 0x2f, data: new Uint8Array(0) });
  return { format: 0, division, tracks: [ev] };
}

/** Group notes whose onsets are within tol seconds of the group start. */
export function groupOnsets(notes, tol = 0.03) {
  const groups = [];
  let cur = null;
  for (const n of notes) {
    if (cur && n.t - cur[0].t <= tol) cur.push(n);
    else { cur = [n]; groups.push(cur); }
  }
  return groups;
}

/**
 * Plays a note list on any clock (seconds). The page calls due(now) each
 * frame and plays what it returns; stepNext() moves one onset group.
 */
export class Scheduler {
  constructor(notes = [], { tol = 0.03 } = {}) {
    this.setNotes(notes, tol);
  }
  setNotes(notes, tol = 0.03) {
    this.notes = notes.slice().sort((a, b) => a.t - b.t);
    this.groups = groupOnsets(this.notes, tol);
    this.duration = this.notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    this.tempoScale = this.tempoScale || 1;
    this.playing = false;
    this._pos = 0;
    this._cursor = 0;
    this._step = 0;
  }
  position(now = 0) {
    return this.playing ? this._pos + (now - this._wall) * this.tempoScale : this._pos;
  }
  play(now = 0) {
    if (this.playing) return;
    if (this._pos >= this.duration) this.seek(0);
    this._wall = now;
    this.playing = true;
  }
  pause(now = 0) {
    if (!this.playing) return;
    this._pos = this.position(now);
    this.playing = false;
  }
  setTempoScale(s, now = 0) {
    const p = this.position(now);
    this._pos = p;
    this._wall = now;
    this.tempoScale = Math.max(0.05, Math.min(4, s));
  }
  seek(t, now = 0) {
    this._pos = Math.max(0, Math.min(this.duration, t));
    this._wall = now;
    let i = 0;
    while (i < this.notes.length && this.notes[i].t < this._pos - 1e-9) i++;
    this._cursor = i;
    let g = 0;
    while (g < this.groups.length && this.groups[g][0].t < this._pos - 1e-9) g++;
    this._step = g;
  }
  /** Notes whose start passed since the last call. Stops at the end. */
  due(now = 0) {
    if (!this.playing) return [];
    const p = this.position(now);
    const out = [];
    while (this._cursor < this.notes.length && this.notes[this._cursor].t <= p) out.push(this.notes[this._cursor++]);
    while (this._step < this.groups.length && this.groups[this._step][0].t <= p) this._step++;
    if (p >= this.duration) { this._pos = this.duration; this.playing = false; }
    return out;
  }
  get ended() {
    return !this.playing && this._pos >= this.duration;
  }
  /** Next onset group (one note or a chord); moves the position to it. */
  stepNext() {
    if (this._step >= this.groups.length) return null;
    const g = this.groups[this._step++];
    this._pos = g[0].t;
    this._cursor = this.notes.indexOf(g[g.length - 1]) + 1;
    this.playing = false;
    return g;
  }
  stepPrev() {
    if (this._step <= 1) { this._step = 0; this._pos = 0; this._cursor = 0; return this.groups[0] ? this.stepNext() : null; }
    this._step -= 2;
    return this.stepNext();
  }
  get stepIndex() {
    return this._step;
  }
}

// ── fretting ────────────────────────────────────────────────────────────────

function defaults(inst, opts = {}) {
  return {
    maxFret: opts.maxFret ?? Math.min(inst.frets, inst.bowed ? 14 : 17),
    span: opts.span ?? (inst.bowed ? 5 : 4),
    adjacentOnly: opts.adjacentOnly ?? !!inst.bowed,
    maxCands: opts.maxCands ?? 48,
  };
}

/** Move a note by octaves into [lo, hi]. */
function fold(m, lo, hi) {
  let x = m;
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  return x < lo ? null : x;
}

/** The fretted span (max - min of non-zero frets) of an assignment. */
function spanOf(as) {
  let lo = Infinity, hi = -Infinity;
  for (const a of as) if (a.fret > 0) { lo = Math.min(lo, a.fret); hi = Math.max(hi, a.fret); }
  return hi < lo ? 0 : hi - lo;
}
function handOf(as) {
  let lo = Infinity;
  for (const a of as) if (a.fret > 0) lo = Math.min(lo, a.fret);
  return lo === Infinity ? null : lo;
}

/** All valid string/fret assignments of a set of notes (best first). */
function candidates(midis, inst, o) {
  const S = inst.tuning.length;
  const opts = midis.map((m) => {
    const list = [];
    for (let s = 0; s < S; s++) {
      const f = m - inst.tuning[s];
      if (f >= 0 && f <= o.maxFret) list.push({ string: s, fret: f });
    }
    return list;
  });
  const res = [];
  const used = new Array(S).fill(false);
  const cur = [];
  const rec = (k) => {
    if (res.length > 4000) return;
    if (k === midis.length) {
      const sp = spanOf(cur);
      if (sp > o.span) return;
      if (o.adjacentOnly && cur.length > 1) {
        const ss = cur.map((a) => a.string).sort((a, b) => a - b);
        for (let i = 1; i < ss.length; i++) if (ss[i] - ss[i - 1] !== 1) return;
      }
      res.push(cur.map((a) => ({ ...a })));
      return;
    }
    for (const p of opts[k]) {
      if (used[p.string]) continue;
      used[p.string] = true;
      cur.push({ midi: midis[k], ...p });
      rec(k + 1);
      cur.pop();
      used[p.string] = false;
    }
  };
  rec(0);
  const shapeCost = (as) => {
    let c = spanOf(as) * 0.6;
    for (const a of as) c += a.fret === 0 ? 0 : 0.08 * a.fret + 0.3;
    // keep melody on higher strings: a small cost for low strings carrying high notes
    return c;
  };
  res.sort((a, b) => shapeCost(a) - shapeCost(b));
  return res.slice(0, o.maxCands).map((as) => ({ as, cost: shapeCost(as), hand: handOf(as) }));
}

/** Notes of a group to keep, dropping inner voices until a shape exists. */
function reduceGroup(midis, inst, o) {
  let list = [...new Set(midis)].sort((a, b) => a - b);
  const max = o.adjacentOnly ? Math.min(inst.tuning.length, 4) : inst.tuning.length;
  while (list.length > max) list.splice(list.length > 2 ? 1 : 0, 1);
  for (;;) {
    const c = candidates(list, inst, o);
    if (c.length || list.length <= 1) return { list, cands: c };
    // drop an inner voice; keep the top (melody) and the bass
    list.splice(list.length > 2 ? Math.floor(list.length / 2) : 0, 1);
  }
}

/**
 * Assign each onset group to strings and frets.
 * groups: [[{ midi, ... }]] or [[midi]]. Returns one entry per group:
 *   { notes: [{ midi, string, fret, shifted, src }], dropped: [midi], hand }
 */
export function mapFretting(groups, inst, opts = {}) {
  const o = defaults(inst, opts);
  const lo = inst.tuning[0], hi = inst.tuning[inst.tuning.length - 1] + o.maxFret;
  const steps = groups.map((g) => {
    const src = g.map((n) => (typeof n === 'number' ? { midi: n } : n));
    const folded = [];
    const shifted = new Set();
    for (const n of src) {
      const m = fold(n.midi, lo, hi);
      if (m == null) continue;
      if (m !== n.midi) shifted.add(m);
      folded.push(m);
    }
    const { list, cands } = reduceGroup(folded, inst, o);
    const dropped = folded.filter((m) => !list.includes(m));
    return { src, list, cands: cands.length ? cands : [{ as: [], cost: 0, hand: null }], shifted, dropped };
  });
  // Viterbi over groups
  const INF = 1e18;
  let prevCost = [0], prevHand = [null];
  const back = [];
  for (const st of steps) {
    const cost = new Array(st.cands.length).fill(INF);
    const arg = new Array(st.cands.length).fill(0);
    st.cands.forEach((c, j) => {
      for (let i = 0; i < prevCost.length; i++) {
        const ph = prevHand[i], h = c.hand;
        let move = 0;
        if (ph != null && h != null) move = Math.abs(h - ph) * 0.5 + (h !== ph ? 0.4 : 0);
        const v = prevCost[i] + c.cost + move;
        if (v < cost[j]) { cost[j] = v; arg[j] = i; }
      }
    });
    back.push(arg);
    // an all-open shape keeps the previous hand position
    prevHand = st.cands.map((c, j) => (c.hand != null ? c.hand : prevHand[arg[j]]));
    prevCost = cost;
  }
  let j = prevCost.indexOf(Math.min(...prevCost));
  const pick = new Array(steps.length);
  for (let s = steps.length - 1; s >= 0; s--) {
    pick[s] = j;
    j = back[s][j];
  }
  let hand = 1;
  return steps.map((st, s) => {
    const c = st.cands[pick[s]];
    if (c.hand != null) hand = c.hand;
    return {
      notes: c.as.map((a) => ({ ...a, shifted: st.shifted.has(a.midi) })).sort((a, b) => a.string - b.string),
      dropped: st.dropped,
      hand,
      src: st.src,
    };
  });
}

/** True when an assignment can be played on the instrument. */
export function isPlayable(entry, inst, opts = {}) {
  const o = defaults(inst, opts);
  const notes = entry.notes || entry;
  const seen = new Set();
  for (const n of notes) {
    if (n.string < 0 || n.string >= inst.tuning.length) return false;
    if (seen.has(n.string)) return false;
    seen.add(n.string);
    if (n.fret < 0 || n.fret > o.maxFret) return false;
    if (inst.tuning[n.string] + n.fret !== n.midi) return false;
  }
  if (spanOf(notes) > o.span) return false;
  if (o.adjacentOnly && notes.length > 1) {
    const ss = notes.map((a) => a.string).sort((a, b) => a - b);
    for (let i = 1; i < ss.length; i++) if (ss[i] - ss[i - 1] !== 1) return false;
  }
  return true;
}
