// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · instruments.js — string sets for three generic instruments
// ────────────────────────────────────────────────────────────────────────────
//  Each string has a pitch, a tension T and a core diameter d. The linear
//  density mu comes from mu = T / (2 L f)^2, so the open string is in tune by
//  construction and T stays at the published value. Damping comes from two
//  T60 decay times through dampingFromT60().
//
//  The instruments are GENERIC: a steel-string acoustic guitar (dreadnought
//  style), a classical guitar and a violin. No brand name, model or logo.
//
//  SOURCES (values are rounded; they set the right order of size)
//   [1] D'Addario, "String Tension Guide" (EJ16 phosphor bronze light 12-53,
//       EJ45 nylon normal tension), tension tables in lb at 25.5 in / 650 mm.
//   [2] N. H. Fletcher, T. D. Rossing, The Physics of Musical Instruments,
//       2nd ed., Springer 1998, ch. 2 (strings), ch. 9 (guitar), ch. 10
//       (violin): string damping, body modes, violin string data.
//   [3] S. Bilbao, Numerical Sound Synthesis, Wiley 2009, ch. 7 (stiff string,
//       T60 damping fit, bowed string).
//   [4] H. Järveläinen, V. Välimäki, M. Karjalainen, "Audibility of the
//       timbral effects of inharmonicity in stringed instrument tones",
//       ARLO 2 (2001): guitar B between about 1e-5 and 1e-4.
//   [5] Violin: vibrating length 328 mm (nut to bridge, full size); tensions
//       of synthetic-core sets about 40 to 55 N, steel E about 75 to 80 N.
//
//  SECTION MAP   (grep -n "<anchor>" instruments.js)
//    pitch helpers ........ "export function midiToFreq"
//    frets ................ "export function fretPositionM"
//    steel guitar ......... "steel:"
//    classical guitar ..... "classical:"
//    violin ............... "violin:"
//    sim params ........... "export function stringParams"
//    view presets ......... "export const TIME_SCALES"
// ════════════════════════════════════════════════════════════════════════════

import { dampingFromT60, kappaOf, inharmonicity } from './strings.js';

const INCH = 0.0254;
const LBF = 4.448222;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(m, a4 = 440) {
  return a4 * 2 ** ((m - 69) / 12);
}
export function freqToMidi(f, a4 = 440) {
  return 69 + 12 * Math.log2(f / a4);
}
export function noteName(m) {
  const r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

/** Distance of fret n from the nut (12-TET): L (1 - 2^(-n/12)). */
export function fretPositionM(L, n) {
  return L * (1 - 2 ** (-n / 12));
}
/** Vibrating length when stopped at fret n. */
export function stoppedLength(L, n) {
  return L * 2 ** (-n / 12);
}

// E steel 200 GPa; nylon about 5 GPa; synthetic (nylon/perlon) core about
// 5 GPa; wound strings: bending stiffness from the core only [2].
const E_STEEL = 200e9;
const E_NYLON = 5e9;

function str(name, midi, tensionN, coreD, E, material, gauge, T60lo, T60hi) {
  return { name, midi, T: tensionN, d: coreD, E, material, gauge, T60: [T60lo, T60hi] };
}

const RAW = {
  steel: {
    key: 'steel',
    label: 'Steel-string acoustic guitar',
    short: 'Steel guitar',
    body: 'dreadnought-style flat top, generic',
    scaleM: 25.4 * INCH,
    frets: 20,
    bowed: false,
    pluckPos: 0.2, // fraction from the bridge, over the sound hole
    // EJ16 light 12-53 [1]; tensions in lbf, core diameters (in) of wound strings
    strings: [
      str('E2', 40, 29.3 * LBF, 0.018 * INCH, E_STEEL, 'phosphor bronze wound on steel', '.053w', 7.5, 0.6),
      str('A2', 45, 31.9 * LBF, 0.016 * INCH, E_STEEL, 'phosphor bronze wound on steel', '.042w', 6.5, 0.5),
      str('D3', 50, 32.2 * LBF, 0.014 * INCH, E_STEEL, 'phosphor bronze wound on steel', '.032w', 5.5, 0.45),
      str('G3', 55, 30.3 * LBF, 0.012 * INCH, E_STEEL, 'phosphor bronze wound on steel', '.024w', 5.0, 0.4),
      str('B3', 59, 23.3 * LBF, 0.016 * INCH, E_STEEL, 'plain steel', '.016', 4.5, 0.35),
      str('E4', 64, 23.3 * LBF, 0.012 * INCH, E_STEEL, 'plain steel', '.012', 4.0, 0.3),
    ],
  },
  classical: {
    key: 'classical',
    label: 'Classical guitar (nylon)',
    short: 'Classical guitar',
    body: 'classical-style, fan-braced top, generic',
    scaleM: 0.65,
    frets: 19,
    bowed: false,
    pluckPos: 0.18,
    // EJ45 normal tension [1] (kgf about 7.1, 7.0, 7.0, 5.6, 5.4, 7.4)
    strings: [
      str('E2', 40, 70 * 1, 0.0005, E_NYLON, 'silver-plated copper on nylon floss', '.043w', 5.0, 0.4),
      str('A2', 45, 69, 0.0005, E_NYLON, 'silver-plated copper on nylon floss', '.035w', 4.5, 0.35),
      str('D3', 50, 69, 0.0005, E_NYLON, 'silver-plated copper on nylon floss', '.030w', 4.0, 0.3),
      str('G3', 55, 55, 0.00103, E_NYLON, 'clear nylon', '.040', 3.0, 0.25),
      str('B3', 59, 53, 0.00083, E_NYLON, 'clear nylon', '.033', 3.0, 0.25),
      str('E4', 64, 73, 0.00071, E_NYLON, 'clear nylon', '.028', 3.0, 0.25),
    ],
  },
  violin: {
    key: 'violin',
    label: 'Violin',
    short: 'Violin',
    body: 'violin, generic',
    scaleM: 0.328,
    frets: 24, // no frets: semitone stops along the fingerboard
    bowed: true,
    pluckPos: 0.25,
    bowPos: 0.09, // about 30 mm from the bridge
    // [5]: synthetic core G D A, steel E
    strings: [
      str('G3', 55, 44, 0.0006, E_NYLON, 'silver wound on synthetic core', 'G', 3.0, 0.3),
      str('D4', 62, 43, 0.0006, E_NYLON, 'aluminium wound on synthetic core', 'D', 2.5, 0.25),
      str('A4', 69, 53, 0.0006, E_NYLON, 'aluminium wound on synthetic core', 'A', 2.0, 0.2),
      str('E5', 76, 78, 0.00026, E_STEEL, 'plain steel', 'E .010', 2.0, 0.2),
    ],
  },
};

function finish(inst) {
  const L = inst.scaleM;
  for (const s of inst.strings) {
    s.f = midiToFreq(s.midi);
    s.mu = s.T / (2 * L * s.f) ** 2;
    const c = Math.sqrt(s.T / s.mu);
    s.kappa = kappaOf(s.E, s.d, s.mu);
    s.B = inharmonicity({ E: s.E, d: s.d, T: s.T, L });
    const dm = dampingFromT60({ f1: s.f, T1: s.T60[0], f2: 4000, T2: s.T60[1], c, kappa: s.kappa });
    s.sigma0 = dm.sigma0;
    s.sigma1 = dm.sigma1;
  }
  inst.tuning = inst.strings.map((s) => s.midi);
  inst.range = [inst.tuning[0], inst.tuning[inst.tuning.length - 1] + inst.frets];
  return inst;
}

export const INSTRUMENTS = {
  steel: finish(RAW.steel),
  classical: finish(RAW.classical),
  violin: finish(RAW.violin),
};

/** StringSim params for string i of an instrument at a fret (0 = open). */
export function stringParams(inst, i, fret = 0, extra = {}) {
  const s = inst.strings[i];
  return {
    L: stoppedLength(inst.scaleM, fret),
    T: s.T,
    mu: s.mu,
    kappa: s.kappa,
    sigma0: s.sigma0,
    sigma1: s.sigma1,
    ...extra,
  };
}

/** MIDI note of string i at fret n. */
export function noteAt(inst, i, fret) {
  return inst.tuning[i] + fret;
}

/** View presets: simulated seconds per wall second. */
export const TIME_SCALES = [
  { label: 'Real time', value: 1 },
  { label: '1/10', value: 0.1 },
  { label: '1/100', value: 0.01 },
  { label: '1/1000', value: 0.001 },
  { label: '1/10000', value: 0.0001 },
];
/** Display exaggeration of displacement (view only). */
export const EXAGGERATIONS = [1, 5, 20, 50, 100, 200];
