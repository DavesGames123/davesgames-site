// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · chords.js — guitar chord shapes, names, progressions, strums
// ────────────────────────────────────────────────────────────────────────────
//  A shape lists frets from the low E string to the high E string (-1 =
//  muted, 0 = open). fingers uses 1 index .. 4 little, 0 for open or muted.
//  barreShape() moves the E-form and A-form shapes up the neck. Standard
//  tuning E2 A2 D3 G3 B3 E4 (MIDI 40 45 50 55 59 64).
//
//  SECTION MAP   (grep -n "<anchor>" chords.js)
//    qualities ............ "export const QUALITIES"
//    open shapes .......... "const OPEN"
//    barre forms .......... "export function barreShape"
//    pitches .............. "export function shapePitches"
//    naming ............... "export function nameChord"
//    lookup ............... "export function findShape"
//    progressions ......... "export const PROGRESSIONS"
//    strum patterns ....... "export const STRUM_PATTERNS"
//    strum events ......... "export function strumEvents"
// ════════════════════════════════════════════════════════════════════════════

export const STANDARD = [40, 45, 50, 55, 59, 64];
export const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
const SHOW = { 'A#': 'Bb', 'D#': 'Eb', 'G#': 'Ab' }; // usual guitar spellings

export function pcOf(name) {
  const n = FLAT[name] || name;
  const i = PC.indexOf(n);
  if (i < 0) throw new Error('unknown note ' + name);
  return i;
}
export function spell(pc) {
  const n = PC[((pc % 12) + 12) % 12];
  return SHOW[n] || n;
}

/** Interval sets (semitones from the root). omit5: the fifth may be left out. */
export const QUALITIES = {
  major: { suffix: '', iv: [0, 4, 7] },
  minor: { suffix: 'm', iv: [0, 3, 7] },
  7: { suffix: '7', iv: [0, 4, 7, 10] },
  m7: { suffix: 'm7', iv: [0, 3, 7, 10] },
  maj7: { suffix: 'maj7', iv: [0, 4, 7, 11] },
  6: { suffix: '6', iv: [0, 4, 7, 9] },
  m6: { suffix: 'm6', iv: [0, 3, 7, 9] },
  sus2: { suffix: 'sus2', iv: [0, 2, 7] },
  sus4: { suffix: 'sus4', iv: [0, 5, 7] },
  add9: { suffix: 'add9', iv: [0, 4, 7, 2] },
  9: { suffix: '9', iv: [0, 4, 7, 10, 2] },
  5: { suffix: '5', iv: [0, 7] },
  dim: { suffix: 'dim', iv: [0, 3, 6] },
  dim7: { suffix: 'dim7', iv: [0, 3, 6, 9] },
  m7b5: { suffix: 'm7b5', iv: [0, 3, 6, 10] },
  aug: { suffix: 'aug', iv: [0, 4, 8] },
};

// name, root, quality, frets (low E .. high E), fingers
const OPEN = [
  ['C', 'C', 'major', [-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]],
  ['A', 'A', 'major', [-1, 0, 2, 2, 2, 0], [0, 0, 1, 2, 3, 0]],
  ['G', 'G', 'major', [3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3]],
  ['E', 'E', 'major', [0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0]],
  ['D', 'D', 'major', [-1, -1, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2]],
  ['Am', 'A', 'minor', [-1, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0]],
  ['Em', 'E', 'minor', [0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0]],
  ['Dm', 'D', 'minor', [-1, -1, 0, 2, 3, 1], [0, 0, 0, 2, 3, 1]],
  ['A7', 'A', '7', [-1, 0, 2, 0, 2, 0], [0, 0, 2, 0, 3, 0]],
  ['B7', 'B', '7', [-1, 2, 1, 2, 0, 2], [0, 2, 1, 3, 0, 4]],
  ['C7', 'C', '7', [-1, 3, 2, 3, 1, 0], [0, 3, 2, 4, 1, 0]],
  ['D7', 'D', '7', [-1, -1, 0, 2, 1, 2], [0, 0, 0, 2, 1, 3]],
  ['E7', 'E', '7', [0, 2, 0, 1, 0, 0], [0, 2, 0, 1, 0, 0]],
  ['G7', 'G', '7', [3, 2, 0, 0, 0, 1], [3, 2, 0, 0, 0, 1]],
  ['Am7', 'A', 'm7', [-1, 0, 2, 0, 1, 0], [0, 0, 2, 0, 1, 0]],
  ['Em7', 'E', 'm7', [0, 2, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0]],
  ['Dm7', 'D', 'm7', [-1, -1, 0, 2, 1, 1], [0, 0, 0, 2, 1, 1]],
  ['Cmaj7', 'C', 'maj7', [-1, 3, 2, 0, 0, 0], [0, 3, 2, 0, 0, 0]],
  ['Fmaj7', 'F', 'maj7', [-1, -1, 3, 2, 1, 0], [0, 0, 3, 2, 1, 0]],
  ['Amaj7', 'A', 'maj7', [-1, 0, 2, 1, 2, 0], [0, 0, 2, 1, 3, 0]],
  ['Dmaj7', 'D', 'maj7', [-1, -1, 0, 2, 2, 2], [0, 0, 0, 1, 1, 1]],
  ['Gmaj7', 'G', 'maj7', [3, 2, 0, 0, 0, 2], [3, 2, 0, 0, 0, 1]],
  ['Dsus2', 'D', 'sus2', [-1, -1, 0, 2, 3, 0], [0, 0, 0, 1, 3, 0]],
  ['Dsus4', 'D', 'sus4', [-1, -1, 0, 2, 3, 3], [0, 0, 0, 1, 3, 4]],
  ['Asus2', 'A', 'sus2', [-1, 0, 2, 2, 0, 0], [0, 0, 1, 2, 0, 0]],
  ['Asus4', 'A', 'sus4', [-1, 0, 2, 2, 3, 0], [0, 0, 1, 2, 3, 0]],
  ['Esus4', 'E', 'sus4', [0, 2, 2, 2, 0, 0], [0, 2, 3, 4, 0, 0]],
  ['Cadd9', 'C', 'add9', [-1, 3, 2, 0, 3, 0], [0, 2, 1, 0, 3, 0]],
  ['C6', 'C', '6', [-1, 3, 2, 2, 1, 0], [0, 4, 2, 3, 1, 0]],
  ['E5', 'E', '5', [0, 2, 2, -1, -1, -1], [0, 1, 2, 0, 0, 0]],
  ['A5', 'A', '5', [-1, 0, 2, 2, -1, -1], [0, 0, 1, 2, 0, 0]],
  ['D5', 'D', '5', [-1, -1, 0, 2, 3, -1], [0, 0, 0, 1, 2, 0]],
  ['Bdim', 'B', 'dim', [-1, 2, 3, 4, 3, -1], [0, 1, 2, 4, 3, 0]],
  ['E9', 'E', '9', [0, 2, 0, 1, 0, 2], [0, 2, 0, 1, 0, 3]],
];

// E form: root on string 0; A form: root on string 1 (relative frets)
const FORMS = {
  E: {
    rootString: 0, open: 4,
    major: [0, 2, 2, 1, 0, 0], minor: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0],
    m7: [0, 2, 0, 0, 0, 0], sus4: [0, 2, 2, 2, 0, 0], 5: [0, 2, 2, -1, -1, -1],
  },
  A: {
    rootString: 1, open: 9,
    major: [-1, 0, 2, 2, 2, 0], minor: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0],
    m7: [-1, 0, 2, 0, 1, 0], maj7: [-1, 0, 2, 1, 2, 0], sus2: [-1, 0, 2, 2, 0, 0],
    sus4: [-1, 0, 2, 2, 3, 0], 5: [-1, 0, 2, 2, -1, -1],
  },
};

function guessFingers(frets, barreFret) {
  const fingers = frets.map(() => 0);
  const rest = [];
  frets.forEach((f, i) => {
    if (f <= 0) return;
    if (barreFret && f === barreFret) fingers[i] = 1;
    else rest.push(i);
  });
  rest.sort((a, b) => frets[a] - frets[b] || a - b);
  let next = barreFret ? 2 : 1;
  for (const i of rest) fingers[i] = Math.min(4, next++);
  return fingers;
}

/** A movable barre shape (form 'E' or 'A') for a root and quality. */
export function barreShape(root, quality = 'major', form = 'E') {
  const F = FORMS[form];
  const rel = F[quality];
  if (!rel) return null;
  let r = (pcOf(root) - F.open + 12) % 12;
  if (r === 0) r = 12; // the open form is in OPEN; the barre goes to fret 12
  const frets = rel.map((x) => (x < 0 ? -1 : x + r));
  const name = spell(pcOf(root)) + QUALITIES[quality].suffix;
  return {
    name, root: spell(pcOf(root)), quality, frets,
    fingers: guessFingers(frets, r), barre: { fret: r, from: F.rootString, to: 5 }, form,
  };
}

export const CHORD_SHAPES = [
  ...OPEN.map(([name, root, quality, frets, fingers]) => ({ name, root, quality, frets, fingers })),
  // common barre chords
  barreShape('F', 'major', 'E'), barreShape('F', 'minor', 'E'), barreShape('F#', 'minor', 'E'),
  barreShape('G#', 'minor', 'E'), barreShape('F#', 'major', 'E'), barreShape('G', 'minor', 'E'),
  barreShape('B', 'minor', 'A'), barreShape('B', 'major', 'A'), barreShape('Bb', 'major', 'A'),
  barreShape('C', 'minor', 'A'), barreShape('C#', 'minor', 'A'), barreShape('Bb', '7', 'A'),
  barreShape('B', 'm7', 'A'), barreShape('F#', 'm7', 'E'), barreShape('F', '7', 'E'),
  barreShape('Eb', 'major', 'A'), barreShape('Ab', 'major', 'E'), barreShape('C#', 'major', 'A'),
];

/** MIDI notes of a shape (muted strings left out), low to high. */
export function shapePitches(shape, tuning = STANDARD) {
  const out = [];
  shape.frets.forEach((f, i) => { if (f >= 0) out.push(tuning[i] + f); });
  return out;
}

/** Chord tones of a root + quality as pitch classes. */
export function chordTones(root, quality) {
  const r = typeof root === 'number' ? root : pcOf(root);
  return QUALITIES[quality].iv.map((x) => (r + x) % 12);
}

/**
 * Name a set of MIDI notes. Every note must be a chord tone; every tone
 * must sound, except the fifth (and the 9th chord's fifth). The bass note
 * as root gets a bonus; extra tones lose. Returns null when nothing fits.
 */
export function nameChord(midis) {
  if (!midis.length) return null;
  const pcs = new Set(midis.map((m) => ((m % 12) + 12) % 12));
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  let best = null;
  for (let r = 0; r < 12; r++) {
    if (!pcs.has(r)) continue;
    for (const [q, def] of Object.entries(QUALITIES)) {
      const tones = def.iv.map((x) => (r + x) % 12);
      if ([...pcs].some((p) => !tones.includes(p))) continue;
      const missing = tones.filter((t) => !pcs.has(t));
      const five = (r + 7) % 12;
      if (missing.some((t) => t !== five)) continue;
      let score = 10 - missing.length * 2 - def.iv.length * 0.1;
      if (r === bass) score += 5;
      if (!best || score > best.score) {
        best = { root: spell(r), quality: q, name: spell(r) + def.suffix + (r === bass ? '' : '/' + spell(bass)), score };
      }
    }
  }
  return best;
}

/** Find a shape by name ("Am", "F", "Bb7"); falls back to a barre form. */
export function findShape(name) {
  const s = CHORD_SHAPES.find((c) => c.name === name);
  if (s) return s;
  const m = /^([A-G][b#]?)(.*)$/.exec(name);
  if (!m) return null;
  const q = Object.entries(QUALITIES).find(([, d]) => d.suffix === m[2]);
  if (!q) return null;
  return barreShape(m[1], q[0], 'E') || barreShape(m[1], q[0], 'A');
}

export const PROGRESSIONS = [
  { name: 'I-V-vi-IV in G', key: 'G', chords: ['G', 'D', 'Em', 'C'], beatsPerChord: 4 },
  { name: '12-bar blues in A', key: 'A', chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'], beatsPerChord: 4 },
  { name: 'ii-V-I in C', key: 'C', chords: ['Dm7', 'G7', 'Cmaj7', 'Cmaj7'], beatsPerChord: 4 },
  { name: 'Andalusian cadence in A minor', key: 'Am', chords: ['Am', 'G', 'F', 'E'], beatsPerChord: 4 },
  { name: '1950s progression in C', key: 'C', chords: ['C', 'Am', 'F', 'G'], beatsPerChord: 4 },
  { name: 'Canon-style progression in D', key: 'D', chords: ['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A'], beatsPerChord: 2 },
  { name: 'Folk in E minor', key: 'Em', chords: ['Em', 'C', 'G', 'D'], beatsPerChord: 4 },
  { name: 'Waltz in G (3/4)', key: 'G', chords: ['G', 'C', 'D7', 'G'], beatsPerChord: 3, meter: 3 },
];

// steps in eighth notes: beat = position in beats; dir D down, U up, null rest
const pat = (name, s, meter = 4) => ({
  name, meter,
  steps: [...s].map((c, i) => ({ beat: i / 2, dir: c === 'D' || c === 'd' ? 'D' : c === 'U' || c === 'u' ? 'U' : null, accent: c === 'D' || c === 'U' })).filter((x) => x.dir),
});
export const STRUM_PATTERNS = [
  pat('Quarter downs', 'D-D-D-D-'),
  pat('Straight eighths', 'DuDuDuDu'),
  pat('Folk (D DU UDU)', 'D-Du-uDu'),
  pat('Ballad', 'D--u-uD-'),
  pat('Rock eighths', 'DdDdDdDd'),
  pat('Waltz', 'D-d-d-', 3),
  pat('Single chord hit', 'D-------'),
];

/**
 * Timed strum events for a progression and a pattern:
 * [{ t (beats), chord, shape, dir, accent }].
 */
export function strumEvents(prog, pattern, bars = null) {
  const out = [];
  const meter = pattern.meter;
  let t = 0;
  for (const name of prog.chords) {
    const shape = findShape(name);
    const beats = prog.beatsPerChord;
    for (let b0 = 0; b0 < beats; b0 += meter) {
      for (const st of pattern.steps) {
        if (b0 + st.beat >= beats) continue;
        out.push({ t: t + b0 + st.beat, chord: name, shape, dir: st.dir, accent: st.accent });
      }
    }
    t += beats;
    if (bars && t >= bars * meter) break;
  }
  return out;
}
