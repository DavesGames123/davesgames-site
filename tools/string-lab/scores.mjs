// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · tools/string-lab/scores.mjs — our own scores of public-domain
//  music, as note lists for make-tracks.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Each score is our own transcription or arrangement of a public-domain
//  work (composer died more than 100 years ago, or a traditional tune). No
//  edition, engraving or MIDI file of another person was copied. The
//  chord-pattern tracks are our own exercises. CREDITS.md in
//  stella-nova/pages/string-lab/playback/ lists each one.
//
//  Notation of a voice: a space-separated list of tokens.
//    E4:1        note E4 for 1 beat (a beat is a quarter note)
//    F#4:0.5     sharps use '#', flats use 'b' (Bb3)
//    [E2,B2]:1   notes that start together
//    r:1         rest
//  A score is { id, title, bpm, beatsPerBar, program, voices: [string],
//  chords: [[beat, 'Em'], ...] }. The chord list becomes marker events
//  (meta 0x06, text "chord:Em"), so the page can name the chord root.
//
//  SECTION MAP   (grep -n "<anchor>" scores.mjs)
//    parser ............... "export function parseVoice"
//    romanza .............. "id: 'romanza'"
//    greensleeves ......... "id: 'greensleeves'"
//    bourree .............. "id: 'bourree'"
//    minuet ............... "id: 'minuet'"
//    ode to joy ........... "id: 'ode-to-joy'"
//    amazing grace ........ "id: 'amazing-grace'"
//    pop progression ...... "id: 'pop-g'"
//    blues shuffle ........ "id: 'blues-e'"
//    fingerpicking ........ "id: 'travis-g'"
// ════════════════════════════════════════════════════════════════════════════

const PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'F#4' -> 66 (MIDI). */
export function pitch(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error('bad pitch ' + name);
  return 12 * (Number(m[3]) + 1) + PCS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** Voice text -> [{ t, dur, midi, vel }] in beats from `start`. */
export function parseVoice(text, { start = 0, vel = 0.75 } = {}) {
  const out = [];
  let t = start;
  for (const tok of text.trim().split(/\s+/)) {
    const i = tok.lastIndexOf(':');
    const head = tok.slice(0, i), dur = Number(tok.slice(i + 1));
    if (!(dur > 0)) throw new Error('bad duration in ' + tok);
    if (head !== 'r') {
      const names = head.startsWith('[') ? head.slice(1, -1).split(',') : [head];
      for (const n of names) out.push({ t, dur, midi: pitch(n), vel });
    }
    t += dur;
  }
  return out;
}

/** Repeat a token string n times. */
const rep = (s, n) => Array(n).fill(s).join(' ');

// ── Romanza (anonymous, 19th c.): melody on beats, two inner notes, bass ──
// Each beat is a triplet: melody, then the two inner notes. Bass on beat 1.
function romanza() {
  const T = 1 / 3;
  // [chord, bass, inner pair (high, low), melody x3]
  const bars = [
    ['Em', 'E2', 'B3', 'G3', 'B4 B4 B4'],
    ['Em', 'E2', 'B3', 'G3', 'B4 A4 G4'],
    ['Em', 'E2', 'B3', 'G3', 'G4 F#4 E4'],
    ['Em', 'E2', 'B3', 'G3', 'E4 G4 B4'],
    ['Em', 'E2', 'B3', 'G3', 'E5 E5 E5'],
    ['Em', 'E2', 'B3', 'G3', 'E5 D5 C5'],
    ['Am', 'A2', 'C4', 'A3', 'C5 B4 A4'],
    ['Am', 'A2', 'C4', 'A3', 'A4 B4 C5'],
    ['B7', 'B2', 'B3', 'A3', 'B4 C5 B4'],
    ['B7', 'B2', 'B3', 'A3', 'D#5 C5 B4'],
    ['Em', 'E2', 'B3', 'G3', 'B4 A4 G4'],
    ['Em', 'E2', 'B3', 'G3', 'G4 F#4 E4'],
    ['B7', 'B2', 'B3', 'A3', 'F#4 G4 F#4'],
    ['B7', 'B2', 'B3', 'A3', 'F#4 G4 F#4'],
    ['B7', 'B2', 'B3', 'A3', 'F#4 G4 A4'],
    ['Em', 'E2', 'B3', 'G3', 'G4 F#4 E4'],
  ];
  const top = [], bass = [], chords = [];
  bars.forEach(([ch, b, hi, lo, mel], i) => {
    chords.push([i * 3, ch]);
    bass.push(`${b}:3`);
    for (const m of mel.split(' ')) top.push(`${m}:${T} ${hi}:${T} ${lo}:${T}`);
  });
  top.push('E4:3');
  bass.push('E2:3');
  chords.push([bars.length * 3, 'Em']);
  return { voices: [top.join(' '), bass.join(' ')], chords };
}

// ── Bourree in E minor, BWV 996 (J. S. Bach): bars 1-4, twice ──
function bourree() {
  const mel = 'E4:0.5 F#4:0.5 ' + rep(
    'G4:1 F#4:0.5 E4:0.5 D#4:1 E4:0.5 F#4:0.5 ' +
    'B3:1 C#4:0.5 D#4:0.5 E4:1 D4:0.5 C4:0.5 ' +
    'B3:1 A3:0.5 G3:0.5 F#3:1 G3:0.5 A3:0.5 ' +
    'B3:0.5 A3:0.5 G3:0.5 F#3:0.5 E3:1 E4:0.5 F#4:0.5', 2).replace(/ E4:0\.5 F#4:0\.5$/, ' r:1');
  const bass = 'r:1 ' + rep('E2:2 B2:2 G2:2 A2:2 G2:2 B2:2 B2:2 E2:2', 2);
  const chords = [];
  const per = ['Em', 'B', 'Em', 'Am', 'Em', 'B', 'B7', 'Em'];
  for (let k = 0; k < 2; k++) per.forEach((c, i) => chords.push([1 + k * 16 + i * 2, c]));
  return { voices: [mel, bass], chords };
}

export const SCORES = [
  {
    id: 'romanza', title: 'Romanza (Spanish Romance), opening', bpm: 66, beatsPerBar: 3, program: 24,
    ...romanza(),
  },
  {
    id: 'greensleeves', title: 'Greensleeves', bpm: 100, beatsPerBar: 3, program: 24,
    voices: [
      'A4:1 C5:2 D5:1 E5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:2 A4:1 ' +
      'A4:1.5 G#4:0.5 A4:1 B4:2 G#4:1 E4:2 A4:1 C5:2 D5:1 E5:1.5 F5:0.5 E5:1 ' +
      'D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:1.5 B4:0.5 A4:1 G#4:1.5 F#4:0.5 G#4:1 A4:3',
      'r:1 A2:3 C3:3 G3:3 E2:3 A2:3 E2:3 E2:3 A2:3 A2:3 C3:3 G3:3 E2:3 A2:3 E2:3 A2:3',
    ],
    chords: [[1, 'Am'], [4, 'C'], [7, 'G'], [10, 'Em'], [13, 'Am'], [16, 'E'], [19, 'E'], [22, 'Am'],
      [25, 'Am'], [28, 'C'], [31, 'G'], [34, 'Em'], [37, 'Am'], [40, 'E'], [43, 'Am']],
  },
  {
    id: 'bourree', title: 'Bourree in E minor, BWV 996, bars 1-4', bpm: 120, beatsPerBar: 4, program: 24,
    ...bourree(),
  },
  {
    id: 'minuet', title: 'Minuet in G, BWV Anh. 114', bpm: 112, beatsPerBar: 3, program: 40,
    voices: [
      'D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 D5:1 G4:1 G4:1 E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5:1 G4:1 G4:1 ' +
      'C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 A4:3 ' +
      'D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 D5:1 G4:1 G4:1 E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5:1 G4:1 G4:1 ' +
      'C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 A4:1 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 G4:3',
    ],
    chords: [[0, 'G'], [6, 'C'], [9, 'G'], [12, 'C'], [15, 'G'], [18, 'D'], [21, 'D'],
      [24, 'G'], [30, 'C'], [33, 'G'], [36, 'C'], [39, 'G'], [42, 'D'], [45, 'G']],
  },
  {
    id: 'ode-to-joy', title: 'Ode to Joy (Symphony no. 9 theme)', bpm: 100, beatsPerBar: 4, program: 40,
    voices: [
      'F#4:1 F#4:1 G4:1 A4:1 A4:1 G4:1 F#4:1 E4:1 D4:1 D4:1 E4:1 F#4:1 F#4:1.5 E4:0.5 E4:2 ' +
      'F#4:1 F#4:1 G4:1 A4:1 A4:1 G4:1 F#4:1 E4:1 D4:1 D4:1 E4:1 F#4:1 E4:1.5 D4:0.5 D4:2',
    ],
    chords: [[0, 'D'], [4, 'A'], [8, 'D'], [12, 'A'], [16, 'D'], [20, 'A'], [24, 'D'], [28, 'A'], [30, 'D']],
  },
  {
    id: 'amazing-grace', title: 'Amazing Grace (New Britain)', bpm: 84, beatsPerBar: 3, program: 40,
    voices: [
      'D4:1 G4:2 B4:0.5 G4:0.5 B4:2 A4:1 G4:2 E4:1 D4:2 D4:1 G4:2 B4:0.5 G4:0.5 B4:2 A4:1 D5:3 ' +
      'D5:2 B4:1 D5:1.5 B4:0.5 D5:0.5 B4:0.5 G4:2 D4:1 E4:1.5 G4:0.5 G4:0.5 E4:0.5 D4:2 D4:1 ' +
      'G4:2 B4:0.5 G4:0.5 B4:2 A4:1 G4:3',
    ],
    chords: [[1, 'G'], [4, 'G'], [7, 'C'], [10, 'G'], [13, 'G'], [16, 'D'], [19, 'D'], [22, 'G'],
      [25, 'G'], [28, 'G'], [31, 'C'], [34, 'G'], [37, 'G'], [40, 'D'], [43, 'G']],
  },
];

// ── chord-pattern tracks: our own exercises built from chord shapes ──

const STD = [40, 45, 50, 55, 59, 64];
const SHAPE = {
  G: [3, 2, 0, 0, 0, 3], D: [-1, -1, 0, 2, 3, 2], Em: [0, 2, 2, 0, 0, 0], C: [-1, 3, 2, 0, 1, 0],
  E7: [0, 2, 0, 1, 0, 0], A7: [-1, 0, 2, 0, 2, 0], B7: [-1, 2, 1, 2, 0, 2], Am: [-1, 0, 2, 2, 1, 0],
};
const notesOf = (frets) => frets.map((f, i) => (f < 0 ? null : STD[i] + f)).filter((m) => m != null);

/** I-V-vi-IV in G, folk strum D-Du-uDu, twice. */
function popG() {
  const notes = [], chords = [];
  const steps = [[0, 'D', 0.9], [1.5, 'U', 0.6], [2, 'D', 0.8], [2.5, 'U', 0.6], [3.5, 'U', 0.6]];
  let bar = 0;
  for (let k = 0; k < 2; k++) for (const c of ['G', 'D', 'Em', 'C']) {
    const t0 = bar * 4;
    chords.push([t0, c]);
    steps.forEach(([b, dir, vel], j) => {
      const next = j + 1 < steps.length ? steps[j + 1][0] : 4;
      let ms = notesOf(SHAPE[c]);
      if (dir === 'U') ms = ms.slice(-4); // an up-strum hits the treble strings
      for (const m of ms) notes.push({ t: t0 + b, dur: next - b, midi: m, vel });
    });
    bar++;
  }
  for (const m of notesOf(SHAPE.G)) notes.push({ t: bar * 4, dur: 4, midi: m, vel: 0.8 });
  chords.push([bar * 4, 'G']);
  return { notes, chords };
}

/** 12-bar shuffle in E: root + fifth, root + sixth, swung eighths. */
function bluesE() {
  const notes = [], chords = [];
  const ROOT = { E7: 40, A7: 45, B7: 47 };
  const form = ['E7', 'E7', 'E7', 'E7', 'A7', 'A7', 'E7', 'E7', 'B7', 'A7', 'E7', 'B7'];
  form.forEach((c, bar) => {
    const t0 = bar * 4;
    chords.push([t0, c]);
    if (bar === 11) {
      for (const m of notesOf(SHAPE.B7)) notes.push({ t: t0, dur: 4, midi: m, vel: 0.8 });
      return;
    }
    const r = ROOT[c];
    for (let beat = 0; beat < 4; beat++) {
      const up = beat % 2 === 1 ? 9 : 7; // fifth on beats 1 and 3, sixth on 2 and 4
      notes.push({ t: t0 + beat, dur: 2 / 3, midi: r, vel: 0.85 }, { t: t0 + beat, dur: 2 / 3, midi: r + up, vel: 0.8 });
      notes.push({ t: t0 + beat + 2 / 3, dur: 1 / 3, midi: r, vel: 0.6 }, { t: t0 + beat + 2 / 3, dur: 1 / 3, midi: r + up, vel: 0.55 });
    }
  });
  for (const m of notesOf(SHAPE.E7)) notes.push({ t: 48, dur: 4, midi: m, vel: 0.8 });
  chords.push([48, 'E7']);
  return { notes, chords };
}

/** Travis-style fingerpicking in G: alternating thumb bass, treble on the off-beats. */
function travisG() {
  const notes = [], chords = [];
  // [chord, bass string A, bass string B, the open-A bass for D]
  const plan = [['G', 0, 2], ['Em', 0, 2], ['C', 1, 2], ['D', 2, 1], ['G', 0, 2], ['Em', 0, 2], ['C', 1, 2], ['D', 2, 1]];
  const at = (frets, s) => STD[s] + Math.max(0, frets[s]);
  plan.forEach(([c, sa, sb], bar) => {
    const f = SHAPE[c], t0 = bar * 4;
    chords.push([t0, c]);
    const pat = [[sa, 5], [3], [sb], [4], [sa], [5], [sb], [4]];
    pat.forEach((ss, i) => {
      for (const s of ss) notes.push({ t: t0 + i * 0.5, dur: s === sa || s === sb ? 1 : 0.5, midi: at(f, s), vel: s < 3 ? 0.8 : 0.6 });
    });
  });
  for (const m of notesOf(SHAPE.G)) notes.push({ t: 32, dur: 4, midi: m, vel: 0.75 });
  chords.push([32, 'G']);
  return { notes, chords };
}

export const CHORD_TRACKS = [
  { id: 'pop-g', title: 'I-V-vi-IV in G, folk strum', bpm: 92, beatsPerBar: 4, program: 25, ...popG() },
  { id: 'blues-e', title: '12-bar blues shuffle in E', bpm: 100, beatsPerBar: 4, program: 25, ...bluesE() },
  { id: 'travis-g', title: 'Fingerpicking pattern in G', bpm: 84, beatsPerBar: 4, program: 25, ...travisG() },
];

/** Every score as { id, title, bpm, program, notes (beats), chords }. */
export function allScores() {
  const out = SCORES.map((s) => ({ ...s, notes: s.voices.flatMap((v, i) => parseVoice(v, { vel: i === 0 ? 0.8 : 0.6 })) }));
  return out.concat(CHORD_TRACKS);
}
