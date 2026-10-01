// ============================================================================
//  CHORD CHART  ·  theory.js — pitch classes, chord spelling, voicings
// ----------------------------------------------------------------------------
//  The music theory of the page, with no DOM and no audio, so theory.test.js
//  runs it in Node. Classic script: in the browser it sets window.ChordTheory,
//  in Node it sets module.exports. main.js and diagrams.js read it.
//
//  A pitch class (pc) is an integer 0..11 (C = 0). A chord quality is an
//  interval set added to the root, modulo 12. Voicings, colours and synth
//  notes all come from those integers.
//
//  SPELLING
//    Each chord tone has a scale degree (deg: 1, 2, 3, 4, 5, 7). The letter
//    of a tone is the root letter moved up (deg - 1) letters. Its accidental
//    is the difference between the real pitch class and the natural pitch
//    class of that letter. So C minor is C E♭ G, not C D♯ G.
//    A black-key root has two names (C♯ / D♭). spellChord takes the name
//    whose chord has fewer accidentals (no double accidentals), so D♭ major
//    and C♯ minor, as a musician writes them.
//
//  GREP MAP
//    pitch names .......... "const LETTERS"
//    chord qualities ...... "const QUALS"
//    spelling ............. "function spellChord"
//    chord parser ......... "function parseChord"
//    guitar shapes ........ "const OPEN_SHAPES"
//    guitar voicings ...... "function guitarVoicings"
//    tunings .............. "const TUNINGS"
//    ukulele search ....... "function ukeVoicings"
//    voicings per inst .... "function voicingsFor"
// ============================================================================
(function (root) {
'use strict';

// Natural letters and their pitch classes.
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
// The two root names of each pitch class, as [letter index, accidental].
// White keys have one name. Black keys list the usual name first.
const ROOT_NAMES = [
  [[0, 0]], [[1, -1], [0, 1]], [[1, 0]], [[2, -1], [1, 1]], [[2, 0]], [[3, 0]],
  [[3, 1], [4, -1]], [[4, 0]], [[5, -1], [4, 1]], [[5, 0]], [[6, -1], [5, 1]], [[6, 0]],
];
const nameOf = (li, acc) => LETTERS[li] + ACC[acc];
// The usual name of a pitch class, for root chips and labels.
const pcName = pc => nameOf(...ROOT_NAMES[((pc % 12) + 12) % 12][0]);

// The eight chord qualities. iv: semitones above the root. deg: the scale
// degree of each tone (for its letter). sym: the interval symbols.
const QUALS = {
  ''    : { iv: [0, 4, 7],     deg: [1, 3, 5],    sym: ['1', '3', '5'],        full: 'major' },
  'm'   : { iv: [0, 3, 7],     deg: [1, 3, 5],    sym: ['1', '♭3', '5'],       full: 'minor' },
  '7'   : { iv: [0, 4, 7, 10], deg: [1, 3, 5, 7], sym: ['1', '3', '5', '♭7'],  full: 'dominant 7' },
  'maj7': { iv: [0, 4, 7, 11], deg: [1, 3, 5, 7], sym: ['1', '3', '5', '7'],   full: 'major 7' },
  'm7'  : { iv: [0, 3, 7, 10], deg: [1, 3, 5, 7], sym: ['1', '♭3', '5', '♭7'], full: 'minor 7' },
  'sus2': { iv: [0, 2, 7],     deg: [1, 2, 5],    sym: ['1', '2', '5'],        full: 'suspended 2' },
  'sus4': { iv: [0, 5, 7],     deg: [1, 4, 5],    sym: ['1', '4', '5'],        full: 'suspended 4' },
  'dim' : { iv: [0, 3, 6],     deg: [1, 3, 5],    sym: ['1', '♭3', '♭5'],      full: 'diminished' },
};
// Display order. Object.keys would put the numeric-like '7' first.
const QUAL_ORDER = ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim'];
const QUAL_BASIC = ['', 'm', '7'];
const QUAL_MORE = ['maj7', 'm7', 'sus2', 'sus4', 'dim'];
// Quality filter groups for the toolbar.
const QUAL_GROUPS = {
  all: QUAL_ORDER,
  triads: ['', 'm', 'sus2', 'sus4', 'dim'],
  sevenths: ['7', 'maj7', 'm7'],
};

// Spell one chord from a root name [letter index, accidental].
function spellFrom(rootPc, rn, q) {
  const Q = QUALS[q];
  return Q.iv.map((iv, i) => {
    const pc = (rootPc + iv) % 12;
    const li = (rn[0] + Q.deg[i] - 1) % 7;
    let acc = (pc - LETTER_PC[li] + 12) % 12;
    if (acc > 6) acc -= 12;
    return { pc, name: nameOf(li, acc), acc, sym: Q.sym[i], iv };
  });
}
// Spell a chord. Returns { root: name, notes: [{ pc, name, sym, iv }] }.
// For a black-key root, the root name with fewer accidentals wins; a tie
// keeps the usual name.
function spellChord(rootPc, q) {
  rootPc = ((rootPc % 12) + 12) % 12;
  let best = null;
  for (const rn of ROOT_NAMES[rootPc]) {
    const notes = spellFrom(rootPc, rn, q);
    const cost = notes.reduce((a, n) => a + Math.abs(n.acc) + (Math.abs(n.acc) > 1 ? 10 : 0), 0);
    if (!best || cost < best.cost) best = { cost, root: nameOf(...rn), notes };
  }
  return { root: best.root, notes: best.notes, symbol: best.root + q, full: QUALS[q].full };
}

// Parse text such as "F#m7", "Bbmaj7", "c min", "Gsus", "EbM7". Returns
// { root, q } or null. Unicode ♯ and ♭ also work.
const QUAL_ALIASES = [
  ['maj7', 'maj7'], ['ma7', 'maj7'], ['M7', 'maj7'], ['Δ7', 'maj7'], ['Δ', 'maj7'],
  ['min7', 'm7'], ['mi7', 'm7'], ['m7', 'm7'], ['-7', 'm7'],
  ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'],
  ['dim', 'dim'], ['°', 'dim'], ['o', 'dim'],
  ['dom7', '7'], ['7', '7'],
  ['min', 'm'], ['mi', 'm'], ['m', 'm'], ['-', 'm'],
  ['maj', ''], ['M', ''], ['', ''],
];
const CASE_SENSITIVE = new Set(['M7', 'M', 'm7', 'm']);
function parseChord(text) {
  const t = String(text || '').trim().replace(/\s+/g, '').replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = /^([A-Ga-g])(#|b)?(.*)$/.exec(t);
  if (!m) return null;
  const li = LETTERS.indexOf(m[1].toUpperCase());
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const rest = m[3];
  for (const [alias, q] of QUAL_ALIASES) {
    // M / M7 (major) and m / m7 (minor) differ only in case, so they match
    // case-sensitively; the other aliases do not.
    const hit = CASE_SENSITIVE.has(alias) ? rest === alias : rest.toLowerCase() === alias.toLowerCase();
    if (hit) return { root: (LETTER_PC[li] + acc + 12) % 12, q };
  }
  return null;
}

// ── guitar shapes ───────────────────────────────────────────────────────────
// Open-position shapes, keyed "<root pc>|<quality>". Six frets, low E first.
// -1 is a muted string, 0 an open string. The same library as ChordLab.
const OPEN_SHAPES = {
  '0|': [-1, 3, 2, 0, 1, 0], '9|': [-1, 0, 2, 2, 2, 0], '7|': [3, 2, 0, 0, 0, 3], '4|': [0, 2, 2, 1, 0, 0], '2|': [-1, -1, 0, 2, 3, 2],
  '9|m': [-1, 0, 2, 2, 1, 0], '4|m': [0, 2, 2, 0, 0, 0], '2|m': [-1, -1, 0, 2, 3, 1],
  '9|7': [-1, 0, 2, 0, 2, 0], '11|7': [-1, 2, 1, 2, 0, 2], '0|7': [-1, 3, 2, 3, 1, 0], '2|7': [-1, -1, 0, 2, 1, 2], '4|7': [0, 2, 0, 1, 0, 0], '7|7': [3, 2, 0, 0, 0, 1],
  '0|maj7': [-1, 3, 2, 0, 0, 0], '9|maj7': [-1, 0, 2, 1, 2, 0], '2|maj7': [-1, -1, 0, 2, 2, 2], '4|maj7': [0, 2, 1, 1, 0, 0], '7|maj7': [3, 2, 0, 0, 0, 2], '5|maj7': [-1, -1, 3, 2, 1, 0],
  '9|m7': [-1, 0, 2, 0, 1, 0], '4|m7': [0, 2, 0, 0, 0, 0], '2|m7': [-1, -1, 0, 2, 1, 1],
  '9|sus2': [-1, 0, 2, 2, 0, 0], '2|sus2': [-1, -1, 0, 2, 3, 0], '7|sus2': [3, 0, 0, 0, 3, 3],
  '9|sus4': [-1, 0, 2, 2, 3, 0], '2|sus4': [-1, -1, 0, 2, 3, 3], '4|sus4': [0, 2, 2, 2, 0, 0],
  '2|dim': [-1, -1, 0, 1, 3, 1],
};
// Movable shapes on the E and A strings, plus a D-string diminished shape.
// Moving a shape up f frets moves the chord up f semitones.
const E_SHAPE = { '': [0, 2, 2, 1, 0, 0], 'm': [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], 'm7': [0, 2, 0, 0, 0, 0], 'maj7': [0, -1, 1, 1, 0, -1], 'sus4': [0, 2, 2, 2, 0, 0], 'sus2': null, 'dim': null };
const A_SHAPE = { '': [-1, 0, 2, 2, 2, 0], 'm': [-1, 0, 2, 2, 1, 0], '7': [-1, 0, 2, 0, 2, 0], 'm7': [-1, 0, 2, 0, 1, 0], 'maj7': [-1, 0, 2, 1, 2, 0], 'sus4': [-1, 0, 2, 2, 3, 0], 'sus2': [-1, 0, 2, 2, 0, 0], 'dim': [-1, 0, 1, 2, 1, -1] };
const D_DIM = [-1, -1, 0, 1, 3, 1];
const barreAt = (shape, f) => shape.map(v => (v < 0 ? -1 : v + f));
// The playable guitar voicings for one chord, lowest position first: the open
// shape if there is one, then the E, A (and D for dim) shapes moved to the root.
function guitarVoicings(rootPc, q) {
  const out = [];
  const open = OPEN_SHAPES[rootPc + '|' + q];
  if (open) out.push({ name: 'Open', frets: open, pos: 0 });
  const eF = ((rootPc - 4) % 12 + 12) % 12, aF = ((rootPc - 9) % 12 + 12) % 12;
  if (E_SHAPE[q] && eF >= 1 && eF <= 11) out.push({ name: 'E shape', frets: barreAt(E_SHAPE[q], eF), barre: eF, pos: eF });
  if (A_SHAPE[q] && aF >= 1 && aF <= 11) out.push({ name: 'A shape', frets: barreAt(A_SHAPE[q], aF), barre: aF, pos: aF });
  if (q === 'dim') { const dF = ((rootPc - 2) % 12 + 12) % 12; if (dF >= 1 && dF <= 11) out.push({ name: 'D shape', frets: barreAt(D_DIM, dF), pos: dF }); }
  out.sort((a, b) => a.pos - b.pos);
  if (!out.length) out.push({ name: '—', frets: [-1, -1, -1, -1, -1, -1], pos: 0 });
  // Mark a 4-note voicing that leaves out the 5th (the open C7, x32310).
  // That is normal practice: the 5th adds the least to a 7th chord.
  const fifth = (rootPc + QUALS[q].iv[2]) % 12, mid = TUNINGS.guitar.midi;
  for (const v of out) {
    const pcs = new Set(v.frets.map((f, s) => (f < 0 ? -1 : (mid[s] + f) % 12)));
    v.dropped5 = QUALS[q].iv.length === 4 && !pcs.has(fifth);
  }
  return out;
}

// Open-string MIDI notes per instrument, low string first for fretted ones.
const TUNINGS = {
  guitar:  { midi: [40, 45, 50, 55, 59, 64], names: ['E', 'A', 'D', 'G', 'B', 'E'], label: 'Standard · E A D G B E', fretted: true },
  ukulele: { midi: [67, 60, 64, 69],         names: ['G', 'C', 'E', 'A'],           label: 'Re-entrant · G C E A',   fretted: true },
  bass:    { midi: [28, 33, 38, 43],         names: ['E', 'A', 'D', 'G'],           label: 'Standard · E A D G',     fretted: false },
  violin:  { midi: [55, 62, 69, 76],         names: ['G', 'D', 'A', 'E'],           label: 'Fifths · G D A E',       fretted: false },
};

// Ukulele search: every hand position, every fret mix that covers the chord
// (a 4-note chord may drop the 5th), scored low and tight. Cached.
const ukeCache = Object.create(null);
function ukeVoicings(rootPc, q) {
  const ck = rootPc + '|' + q;
  if (ukeCache[ck]) return ukeCache[ck];
  const MIDI = TUNINGS.ukulele.midi;
  const need = QUALS[q].iv.map(iv => (rootPc + iv) % 12);
  const found = [];
  for (let base = 0; base <= 9; base++) {
    const opts = MIDI.map(m => {
      const o = [];
      for (let f = 0; f <= base + 3; f++) {
        if (f !== 0 && f < base) continue;
        if (need.includes((m + f) % 12)) o.push(f);
      }
      return o;
    });
    if (opts.some(o => !o.length)) continue;
    for (const f0 of opts[0]) for (const f1 of opts[1]) for (const f2 of opts[2]) for (const f3 of opts[3]) {
      const fr = [f0, f1, f2, f3];
      const pcs = new Set(fr.map((f, st) => (MIDI[st] + f) % 12));
      let ok = need.every(pc => pcs.has(pc)), dropped5 = false;
      if (!ok && need.length === 4) { ok = need.every((pc, i) => i === 2 || pcs.has(pc)); dropped5 = ok; }
      if (!ok) continue;
      const pos = fr.filter(f => f > 0);
      const lo = pos.length ? Math.min(...pos) : 0, hi = pos.length ? Math.max(...pos) : 0;
      if (hi - lo > 3) continue;
      found.push({ frets: fr, base: lo, score: fr.reduce((a, b) => a + b, 0) + hi * 0.6 + (dropped5 ? 2.5 : 0), dropped5 });
    }
  }
  found.sort((a, b) => a.score - b.score);
  const seen = new Set(), out = [];
  for (const v of found) {
    const k = v.frets.join(',');
    if (seen.has(k)) continue; seen.add(k);
    out.push({ name: v.base === 0 ? 'Open' : 'Fret ' + v.base, frets: v.frets, pos: v.base, dropped5: v.dropped5 });
    if (out.length >= 3) break;
  }
  if (!out.length) out.push({ name: '—', frets: [-1, -1, -1, -1], pos: 0 });
  return (ukeCache[ck] = out);
}

// Voicings for any instrument. Bass and violin show a tone map, so they
// have one "voicing" with no frets.
function voicingsFor(inst, rootPc, q) {
  if (inst === 'guitar') return guitarVoicings(rootPc, q);
  if (inst === 'ukulele') return ukeVoicings(rootPc, q);
  return [{ name: 'Tone map', frets: null, pos: 0 }];
}
// The MIDI notes that a fretted voicing sounds, low string first.
function voicingMidi(inst, frets) {
  const m = TUNINGS[inst].midi, out = [];
  frets.forEach((f, s) => { if (f >= 0) out.push(m[s] + f); });
  return out;
}

const API = {
  LETTERS, pcName, QUALS, QUAL_ORDER, QUAL_BASIC, QUAL_MORE, QUAL_GROUPS,
  spellChord, parseChord, OPEN_SHAPES, E_SHAPE, A_SHAPE, guitarVoicings, ukeVoicings,
  TUNINGS, voicingsFor, voicingMidi,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.ChordTheory = API;
})(typeof window !== 'undefined' ? window : globalThis);
