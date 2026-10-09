// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · harmonics.js — harmonic series, ratios, intervals, nodes
// ────────────────────────────────────────────────────────────────────────────
//  A string fixed at both ends rings at f_n = n f_1 (times sqrt(1 + B n^2)
//  when it is stiff). Mode n has n - 1 nodes inside the string at k / n.
//  A pluck at fraction p gives mode n the amplitude |sin(n pi p)| / n^2
//  (relative), so a pluck at 1/n removes mode n and its multiples.
//
//  SECTION MAP   (grep -n "<anchor>" harmonics.js)
//    series ............... "export function harmonicSeries"
//    ratios ............... "export function ratioOf"
//    interval table ....... "export const INTERVALS"
//    nodes ................ "export function nodes"
//    pluck spectrum ....... "export function pluckSpectrum"
//    suppressed modes ..... "export function suppressedHarmonics"
//    beats ................ "export function beatFrequency"
//    harmonic touch frets . "export function harmonicFrets"
//    light touch force .... "export const HARMONIC_TOUCH"
// ════════════════════════════════════════════════════════════════════════════

/**
 * The light touch that the page's Harmonic tool puts at a node (L/n),
 * for StringSim.touch. A finger rests 0.2 s of simulated time. With a
 * strength of 20000, harmonic n is more than 10 times every other mode
 * after the touch on all strings of the three instruments, for n = 2..6
 * (engine tests). The old touch (4000 for 0.08 s) left the fundamental
 * ringing for n >= 4 on the guitars.
 */
export const HARMONIC_TOUCH = Object.freeze({ strength: 20000, seconds: 0.2 });

export function centsBetween(f1, f2) {
  return 1200 * Math.log2(f2 / f1);
}

/** [{ n, f }] for n = 1..count. */
export function harmonicSeries(f1, count, B = 0) {
  const out = [];
  for (let n = 1; n <= count; n++) out.push({ n, f: n * f1 * Math.sqrt(1 + B * n * n) });
  return out;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

// interval names for just ratios that fit in an octave
const JUST_NAMES = {
  '1/1': 'unison', '2/1': 'octave', '3/2': 'perfect fifth', '4/3': 'perfect fourth',
  '5/4': 'major third', '6/5': 'minor third', '5/3': 'major sixth', '8/5': 'minor sixth',
  '9/8': 'major second (9/8)', '10/9': 'major second (10/9)', '16/15': 'minor second',
  '15/8': 'major seventh', '9/5': 'minor seventh (9/5)', '16/9': 'minor seventh (16/9)',
  '7/4': 'harmonic seventh', '7/5': 'septimal tritone', '45/32': 'tritone', '7/6': 'septimal minor third',
  '8/7': 'septimal whole tone', '11/8': 'undecimal fourth', '13/8': 'tridecimal sixth',
};

/** Ratio between harmonics m and n (m over n), reduced, with octave-folded name. */
export function ratioOf(m, n) {
  const g = gcd(m, n);
  const num = m / g, den = n / g;
  let fn = num, fd = den;
  while (fn / fd > 2) fd *= 2;
  while (fn / fd < 1) fn *= 2;
  const g2 = gcd(fn, fd);
  fn /= g2; fd /= g2;
  const octaves = Math.floor(Math.log2(num / den) + 1e-9);
  return {
    num, den,
    cents: 1200 * Math.log2(num / den),
    folded: `${fn}/${fd}`,
    name: JUST_NAMES[`${fn}/${fd}`] || null,
    octaves,
  };
}

/** Just intonation vs 12-tone equal temperament. diff = et - just (cents). */
export const INTERVALS = [
  ['unison', 0, 1, 1], ['minor second', 1, 16, 15], ['major second', 2, 9, 8],
  ['minor third', 3, 6, 5], ['major third', 4, 5, 4], ['perfect fourth', 5, 4, 3],
  ['tritone', 6, 45, 32], ['perfect fifth', 7, 3, 2], ['minor sixth', 8, 8, 5],
  ['major sixth', 9, 5, 3], ['minor seventh', 10, 9, 5], ['major seventh', 11, 15, 8],
  ['octave', 12, 2, 1],
].map(([name, semis, a, b]) => {
  const justCents = 1200 * Math.log2(a / b);
  return { name, semis, just: [a, b], justCents, etCents: semis * 100, diff: semis * 100 - justCents };
});

/** Interior node positions of mode n (fractions of the length). */
export function nodes(n) {
  const out = [];
  for (let k = 1; k < n; k++) out.push(k / n);
  return out;
}
/** Antinode positions of mode n. */
export function antinodes(n) {
  const out = [];
  for (let k = 0; k < n; k++) out.push((2 * k + 1) / (2 * n));
  return out;
}

/** Relative mode amplitudes of an ideal triangle pluck at pos (max = 1). */
export function pluckSpectrum(pos, nMax) {
  const a = [];
  let m = 0;
  for (let n = 1; n <= nMax; n++) {
    const v = Math.abs(Math.sin(n * Math.PI * pos)) / (n * n);
    a.push(v);
    m = Math.max(m, v);
  }
  return a.map((v) => (m ? v / m : 0));
}

/** Harmonics (1..nMax) that a pluck at pos removes: |sin(n pi p)| < tol. */
export function suppressedHarmonics(pos, nMax = 16, tol = 1e-6) {
  const out = [];
  for (let n = 1; n <= nMax; n++) if (Math.abs(Math.sin(n * Math.PI * pos)) < tol) out.push(n);
  return out;
}

/** Beat rate (Hz) of two close tones. */
export function beatFrequency(f1, f2) {
  return Math.abs(f1 - f2);
}

/**
 * Beats heard when tuning by harmonics: harmonic a of string 1 against
 * harmonic b of string 2 (for example 4th of low E vs 3rd of A at fret 5).
 */
export function harmonicBeat(f1, a, f2, b) {
  return { fA: a * f1, fB: b * f2, beat: Math.abs(a * f1 - b * f2), cents: centsBetween(a * f1, b * f2) };
}

/**
 * Natural harmonic touch points as fret numbers (from the nut side).
 * Touch at fraction k/n from the nut: fret = -12 log2(1 - k/n).
 * Lists the first touch point (k = 1) of each n, plus the octave mirror.
 */
export function harmonicFrets(nMax = 7) {
  const out = [];
  for (let n = 2; n <= nMax; n++) {
    for (let k = 1; k < n; k++) {
      if (gcd(k, n) !== 1) continue;
      const fret = -12 * Math.log2(1 - k / n);
      if (fret <= 24.01) out.push({ n, k, pos: k / n, fret });
    }
  }
  return out.sort((a, b) => a.fret - b.fret);
}
