// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · playback/ratios.js — interval and chord ratios for the
//  explainer (no DOM)
// ────────────────────────────────────────────────────────────────────────────
//  The instruments play 12-tone equal temperament (ET): every semitone is
//  the ratio 2^(1/12). The ear hears an interval as the nearest small whole
//  number ratio (just ratio), because the harmonics of the two notes then
//  line up. These helpers give both numbers and the difference in cents.
//
//  SECTION MAP   (grep -n "<anchor>" ratios.js)
//    interval of two notes ... "export function intervalInfo"
//    chord as integers ....... "export function chordRatios"
//    shared partials ......... "export function sharedPartials"
//    text for the panel ...... "export function describeNote"
// ════════════════════════════════════════════════════════════════════════════

import { INTERVALS } from '../engine/harmonics.js';
import { midiToFreq, noteName } from '../engine/instruments.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const lcm = (a, b) => (a / gcd(a, b)) * b;

const COMPOUND = { 0: 'octave', 1: 'minor ninth', 2: 'major ninth', 3: 'minor tenth', 4: 'major tenth', 5: 'eleventh', 7: 'twelfth' };

/**
 * Interval from note a to note b (MIDI numbers, b may be lower).
 * Returns { semis, name, num, den, ratioText, etRatio, justRatio, diff }.
 * diff = ET minus just, in cents (positive: the ET interval is wider).
 */
export function intervalInfo(a, b) {
  const semis = Math.round(b - a);
  const up = Math.abs(semis);
  const oct = Math.floor(up / 12), rem = up % 12;
  const iv = INTERVALS[rem];
  let num = iv.just[0], den = iv.just[1];
  if (oct > 0 && rem === 0) { num = 2 ** oct; den = 1; }
  else num *= 2 ** oct;
  const g = gcd(num, den);
  num /= g; den /= g;
  let name;
  if (up === 0) name = 'unison';
  else if (rem === 0) name = oct === 1 ? 'octave' : `${oct} octaves`;
  else if (oct === 1 && COMPOUND[rem]) name = COMPOUND[rem];
  else name = iv.name + (oct ? ` + ${oct} octave${oct > 1 ? 's' : ''}` : '');
  const down = semis < 0;
  return {
    semis, name, down,
    num: down ? den : num, den: down ? num : den,
    ratioText: down ? `${den}/${num}` : `${num}/${den}`,
    etRatio: 2 ** (semis / 12),
    justRatio: down ? den / num : num / den,
    diff: (down ? -1 : 1) * iv.diff,
  };
}

/**
 * Chord notes over a root as whole numbers: E2 G#3 B3 over E -> 4:10:12 and
 * so on. Returns { root, parts: [{ midi, ratio, text }], ints, text }.
 * The root is moved down by octaves to the lowest note or below.
 */
export function chordRatios(midis, rootPc = null) {
  const ms = [...new Set(midis)].sort((x, y) => x - y);
  if (!ms.length) return { root: null, parts: [], ints: [], text: '' };
  let root = ms[0];
  if (rootPc != null) {
    root = ms[0] - ((((ms[0] - rootPc) % 12) + 12) % 12);
  }
  const parts = ms.map((m) => {
    const iv = intervalInfo(root, m);
    return { midi: m, num: iv.num, den: iv.den, text: iv.ratioText, name: iv.name, diff: iv.diff };
  });
  const L = parts.reduce((acc, p) => lcm(acc, p.den), 1);
  let ints = parts.map((p) => (p.num * L) / p.den);
  const g = ints.reduce((acc, x) => gcd(acc, x), 0) || 1;
  ints = ints.map((x) => x / g);
  return { root, parts, ints, text: ints.join(' : ') };
}

/**
 * Harmonics of two notes that land within tolCents of each other, up to
 * harmonic nMax of each. [{ i, j, f }]: harmonic i of a meets j of b.
 */
export function sharedPartials(fa, fb, nMax = 10, tolCents = 15) {
  const out = [];
  for (let i = 1; i <= nMax; i++) for (let j = 1; j <= nMax; j++) {
    const c = 1200 * Math.log2((i * fa) / (j * fb));
    if (Math.abs(c) <= tolCents) out.push({ i, j, f: i * fa, cents: c });
  }
  return out;
}

const fmtHz = (f) => (f >= 100 ? f.toFixed(1) : f.toFixed(2)) + ' Hz';
export { fmtHz };

/**
 * Facts about one sounding note for the explainer panel.
 * inst: an engine instrument. Returns plain data; the UI makes the text.
 */
export function describeNote(inst, n, { prev = null, rootPc = null } = {}) {
  const f = midiToFreq(n.midi);
  const L = inst.scaleM * 2 ** (-n.fret / 12);
  const s = inst.strings[n.string];
  const info = {
    midi: n.midi, name: noteName(n.midi), f, string: n.string, stringName: s ? s.name : String(n.string),
    fret: n.fret, lengthM: L, shifted: !!n.shifted,
    waveSpeed: s ? Math.sqrt(s.T / s.mu) : null,
    tension: s ? s.T : null,
  };
  if (prev != null) info.fromPrev = intervalInfo(prev, n.midi);
  if (rootPc != null) {
    const root = n.midi - ((((n.midi - rootPc) % 12) + 12) % 12);
    info.root = root;
    info.fromRoot = intervalInfo(root, n.midi);
  }
  return info;
}
