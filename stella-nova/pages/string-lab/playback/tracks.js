// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · playback/tracks.js — the bundled track library
// ────────────────────────────────────────────────────────────────────────────
//  Every file in tracks/ is our own transcription or arrangement of a
//  public-domain work, or our own chord exercise. The files come from
//  tools/string-lab/make-tracks.mjs (scores in tools/string-lab/scores.mjs).
//  CREDITS.md lists the works. `inst` is the instrument that the track
//  suits best; the page can play every track on every instrument.
//
//  kind: 'piece' (melody and bass), 'melody' (one line), 'chords' (strummed
//  or picked chord pattern).
// ════════════════════════════════════════════════════════════════════════════

export const TRACKS = [
  { id: 'romanza', title: 'Romanza (Spanish Romance)', by: 'Anonymous, 19th century', kind: 'piece', inst: 'classical',
    about: 'Opening 16 bars. Triplet arpeggios: the melody on the top string, open B and G inside, the bass on beat one.' },
  { id: 'greensleeves', title: 'Greensleeves', by: 'Traditional English', kind: 'piece', inst: 'classical',
    about: 'The tune with a bass note on each bar. A minor, 3/4.' },
  { id: 'bourree', title: 'Bourrée in E minor, BWV 996', by: 'J. S. Bach (1685-1750)', kind: 'piece', inst: 'classical',
    about: 'Bars 1-4, played twice. Two voices: our simplified bass under the melody.' },
  { id: 'minuet', title: 'Minuet in G, BWV Anh. 114', by: 'Attributed to C. Petzold (1677-1733)', kind: 'melody', inst: 'violin',
    about: 'The first 16 bars of the melody. Good on the violin.' },
  { id: 'ode-to-joy', title: 'Ode to Joy', by: 'L. van Beethoven (1770-1827)', kind: 'melody', inst: 'violin',
    about: 'The theme from the finale of Symphony no. 9, in D.' },
  { id: 'amazing-grace', title: 'Amazing Grace', by: 'Traditional American tune "New Britain"', kind: 'melody', inst: 'violin',
    about: 'The hymn tune in G, 3/4.' },
  { id: 'pop-g', title: 'I-V-vi-IV in G', by: 'Chord exercise (ours)', kind: 'chords', inst: 'steel',
    about: 'G D Em C with a folk strum: down, down-up, up-down-up.' },
  { id: 'blues-e', title: '12-bar blues shuffle in E', by: 'Chord exercise (ours)', kind: 'chords', inst: 'steel',
    about: 'Root and fifth, root and sixth, swung. The fifth is the 3:2 ratio.' },
  { id: 'travis-g', title: 'Fingerpicking pattern in G', by: 'Chord exercise (ours)', kind: 'chords', inst: 'steel',
    about: 'Alternating thumb bass with treble notes between: G Em C D.' },
];

/** URL of a track's MIDI file, next to this module. */
export function trackUrl(track) {
  return new URL(`./tracks/${track.id}.mid`, import.meta.url).href;
}
