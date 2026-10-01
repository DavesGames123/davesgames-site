// ============================================================================
//  CHORD CHART  ·  theory.test.js — node theory.test.js
// ----------------------------------------------------------------------------
//  Checks the music theory in theory.js:
//    voicings ..... every guitar and ukulele voicing, 12 roots x 8 qualities,
//                   sounds only chord tones and every chord tone (a 4-note
//                   chord may drop the 5th when the voicing says dropped5)
//    spelling ..... known chords spell as a musician writes them
//    parser ....... chord names in common forms parse to root and quality
// ============================================================================
'use strict';
const T = require('./theory.js');
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { if (ok) pass++; else { fail++; console.log(`FAIL  ${name}  ${info}`); } };

// voicings
let nVoicings = 0;
for (const inst of ['guitar', 'ukulele']) {
  for (let r = 0; r < 12; r++) for (const q of T.QUAL_ORDER) {
    const need = T.QUALS[q].iv.map(iv => (r + iv) % 12);
    const vs = T.voicingsFor(inst, r, q);
    check(`${inst} ${T.pcName(r)}${q} has a voicing`, vs.length > 0 && vs[0].frets.some(f => f >= 0));
    for (const v of vs) {
      nVoicings++;
      const pcs = new Set(T.voicingMidi(inst, v.frets).map(m => m % 12));
      const extra = [...pcs].filter(pc => !need.includes(pc));
      const missing = need.filter((pc, i) => !pcs.has(pc) && !(v.dropped5 && i === 2 && need.length === 4));
      check(`${inst} ${T.pcName(r)}${q} ${v.name} [${v.frets}]`, !extra.length && !missing.length,
        `extra ${extra.map(T.pcName)} missing ${missing.map(T.pcName)}`);
      const fr = v.frets.filter(f => f > 0);
      if (fr.length) check(`${inst} ${T.pcName(r)}${q} ${v.name} span`, Math.max(...fr) - Math.min(...fr) <= 4, `[${v.frets}]`);
    }
  }
}

// spelling
const SPELL = {
  'C|': 'C E G', 'C|m': 'C E♭ G', 'C|7': 'C E G B♭', 'F|maj7': 'F A C E', 'A|m7': 'A C E G',
  'D|sus2': 'D E A', 'G|sus4': 'G C D', 'B|dim': 'B D F', 'E|maj7': 'E G♯ B D♯',
  'B♭|7': 'B♭ D F A♭', 'D♭|': 'D♭ F A♭', 'C♯|m': 'C♯ E G♯', 'G♯|m': 'G♯ B D♯', 'E♭|m': 'E♭ G♭ B♭',
  'F♯|': 'F♯ A♯ C♯', 'F♯|dim': 'F♯ A C', 'A♭|maj7': 'A♭ C E♭ G', 'B|7': 'B D♯ F♯ A',
};
for (const [k, want] of Object.entries(SPELL)) {
  const [rootName, q] = k.split('|');
  const r = T.parseChord(rootName).root;
  const s = T.spellChord(r, q);
  const got = s.notes.map(n => n.name).join(' ');
  check(`spell ${rootName}${q}`, got === want && s.root === rootName, `got ${s.root}: ${got}, want ${want}`);
}
// no double accidentals anywhere
for (let r = 0; r < 12; r++) for (const q of T.QUAL_ORDER) {
  const s = T.spellChord(r, q);
  check(`no double accidental ${s.symbol}`, s.notes.every(n => Math.abs(n.acc) <= 1), s.notes.map(n => n.name).join(' '));
}

// parser
const PARSE = {
  'C': [0, ''], 'Cmaj': [0, ''], 'CM': [0, ''], 'Cm': [0, 'm'], 'cmin': [0, 'm'], 'C-': [0, 'm'],
  'F#m7': [6, 'm7'], 'F♯m7': [6, 'm7'], 'Bbmaj7': [10, 'maj7'], 'B♭M7': [10, 'maj7'], 'EbΔ7': [3, 'maj7'],
  'G7': [7, '7'], 'Gsus': [7, 'sus4'], 'Dsus2': [2, 'sus2'], 'Bdim': [11, 'dim'], 'B°': [11, 'dim'],
  'Am7': [9, 'm7'], 'A m7': [9, 'm7'], 'Cb': [11, ''], 'E#': [5, ''],
};
for (const [t, [r, q]] of Object.entries(PARSE)) {
  const p = T.parseChord(t);
  check(`parse ${t}`, p && p.root === r && p.q === q, JSON.stringify(p));
}
check('parse rejects H7', T.parseChord('H7') === null);
check('parse rejects Cxyz', T.parseChord('Cxyz') === null);

console.log(`${pass} passed, ${fail} failed (${nVoicings} voicings checked)`);
process.exit(fail ? 1 : 0);
