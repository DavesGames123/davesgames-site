// ============================================================================
//  ALTO SAX MECHANISM  ·  model.js — the data and the key solver (no DOM)
// ----------------------------------------------------------------------------
//  This module holds the whole instrument as data: the centre line of the
//  tube, the tone holes, the hinge rods, the keys, the linkages, the
//  mechanism groups and the fingering chart. solve() finds which keys move
//  for a set of pressed touch pieces. CONTRACT.md is the spec. The facts
//  and the sources are in CONTRACT.md section 1.
//
//  UNITS. Lengths are mm. s is the station along the centre line, from the
//  mouthpiece tip (s = 0) to the bell rim (s = S_END). phi is the angle
//  round the tube in degrees: 0 is the front (+z, the pearl side), +90 is
//  the side frame vector b = f x t. On the body, +90 is +x (the bell side).
//  dr is the height above the outer surface of the tube.
//
//  NOTES. Notes are written pitches as MIDI numbers (Bb3 = 58). The alto
//  sounds 9 semitones lower (CONTRACT F4).
//
//  GREP MAP
//    export function center ....... centre line point and frame at s
//    export function radius ....... outer radius of the tube at s
//    export function surf ......... a point at (s, phi, dr)
//    export const HOLES ........... 24 tone holes (vent note, s, phi)
//    export const RODS ............ hinge rods and point-screw pairs
//    export const KEYS ............ 33 keys: cups, touches, springs, stops
//    export const LINKS ........... drive, hold and swap linkages
//    export const GROUPS .......... mechanism groups, colours and text
//    export const FINGERINGS ...... the chart, Bb3 to F#6, with alternatives
//    export function solve ........ touches -> keys, holes, octave, note
//    export function movedBy ...... what one touch moves, with its link path
//    export function topoOrder .... the key order of the linkage graph
//    export function noteName ..... MIDI -> written name
// ============================================================================

export const S_TIP = 0, S_NECK = 80, S_BODY = 310, S_BOW = 950;
// The bow turns 168 degrees, not 180: the bell tube leans BELL_LEAN away
// from the body, so the flare stays clear of the pinky table.
export const BOW_R = 44, BELL_LEAN = 12 * Math.PI / 180, S_BELL = S_BOW + (Math.PI - BELL_LEAN) * BOW_R, S_FLARE = 1200, S_END = 1320;
const NECK_UP = 40, NECK_R = 70, NECK_TURN = 115 * Math.PI / 180;
const BODY_TOP_Y = 300;
const D2R = Math.PI / 180;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vec = { add, mul, cross,
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

// ---- centre line -----------------------------------------------------------------
// The path is in the xy plane. The front vector f is +z everywhere, so
// the frame has no twist. t is the tangent in the direction of growing s.
export function center(s) {
  let p, t;
  if (s < S_BODY) {
    // the neck and the mouthpiece, measured up from the body top (u)
    const u = S_BODY - s, p0 = [0, BODY_TOP_Y, 0];
    let d;
    if (u <= NECK_UP) { p = add(p0, [0, u, 0]); d = [0, 1, 0]; }
    else if (u <= NECK_UP + NECK_R * NECK_TURN) {
      const a = (u - NECK_UP) / NECK_R;
      p = [-NECK_R + NECK_R * Math.cos(a), BODY_TOP_Y + NECK_UP + NECK_R * Math.sin(a), 0];
      d = [-Math.sin(a), Math.cos(a), 0];
    } else {
      const a = NECK_TURN, e = [-NECK_R + NECK_R * Math.cos(a), BODY_TOP_Y + NECK_UP + NECK_R * Math.sin(a), 0];
      d = [-Math.sin(a), Math.cos(a), 0];
      p = add(e, mul(d, u - NECK_UP - NECK_R * NECK_TURN));
    }
    t = mul(d, -1);
  } else if (s <= S_BOW) {
    p = [0, BODY_TOP_Y - (s - S_BODY), 0]; t = [0, -1, 0];
  } else if (s <= S_BELL) {
    const a = (s - S_BOW) / BOW_R, y0 = BODY_TOP_Y - (S_BOW - S_BODY);
    p = [BOW_R - BOW_R * Math.cos(a), y0 - BOW_R * Math.sin(a), 0];
    t = [Math.sin(a), -Math.cos(a), 0];
  } else {
    const y0 = BODY_TOP_Y - (S_BOW - S_BODY), a = Math.PI - BELL_LEAN;
    const e = [BOW_R - BOW_R * Math.cos(a), y0 - BOW_R * Math.sin(a), 0];
    t = [Math.sin(BELL_LEAN), Math.cos(BELL_LEAN), 0];
    p = add(e, mul(t, s - S_BELL));
  }
  const f = [0, 0, 1], b = cross(f, t);
  return { p, t, f, b };
}

// Outer radius. The neck and the body are cones; the bell has a flare.
export function radius(s) {
  if (s < S_NECK) return 13.5;                                  // mouthpiece shank
  if (s < S_BODY) return 7.5 + (s - S_NECK) * (12.5 - 7.5) / (S_BODY - S_NECK);
  if (s <= S_BOW) return 12.5 + (s - S_BODY) * (31 - 12.5) / (S_BOW - S_BODY);
  if (s <= S_BELL) return 31 + (s - S_BOW) * 3 / (S_BELL - S_BOW);
  if (s <= S_FLARE) return 34 + (s - S_BELL) * 6 / (S_FLARE - S_BELL);
  const k = Math.min(1, (s - S_FLARE) / (S_END - S_FLARE));
  return 40 + 26 * Math.pow(k, 2.2);
}

// The outward unit normal at (s, phi) and a point dr above the surface.
export function normalAt(s, phi) {
  const c = center(s), a = phi * D2R;
  return add(mul(c.f, Math.cos(a)), mul(c.b, Math.sin(a)));
}
export function surf(s, phi, dr = 0) {
  return add(center(s).p, mul(normalAt(s, phi), radius(s) + dr));
}

// ---- notes -----------------------------------------------------------------------
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
export function noteName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
export const PRETTY = n => n.replace('#', '♯').replace(/b(?=\d)/, '♭');
export const BELL_NOTE = 58;           // Bb3: the bell end vents when all holes close
export const TRANSPOSE = -9;           // Eb alto: sounding = written - 9
export const LOW = 58, HIGH = 90;      // Bb3 to F#6

// ---- tone holes ------------------------------------------------------------------
// vent: the written note when this hole is the first open hole (register 1).
// kind: chain (one for each semitone), palm, side, trill, register.
// rh: the inner radius of the hole. Other values come from s.
function H(id, vent, s, phi, kind, name, rh) { return { id, vent, s, phi, kind, name, rh }; }
const rhChain = s => Math.min(19.5, 0.5 * radius(s));
export const HOLES = [
  H('h_cs5', 73, 525, -80, 'chain', 'C♯ tone hole (top of the chain)'),
  H('h_c5', 72, 556, 0, 'chain', 'C vent (under the B cup)'),
  H('h_b4', 71, 588, 38, 'chain', 'B vent (under the B♭ cup)'),
  H('h_bb4', 70, 622, 0, 'chain', 'B♭ vent (under the A cup)'),
  H('h_a4', 69, 658, 0, 'chain', 'A vent (under the G cup)'),
  H('h_gs4', 68, 695, 38, 'chain', 'G♯ tone hole'),
  H('h_g4', 67, 735, 15, 'chain', 'G vent (under the F♯ cup)'),
  H('h_fs4', 66, 776, 0, 'chain', 'F♯ vent (under the F cup)'),
  H('h_f4', 65, 818, 0, 'chain', 'F vent (under the E cup)'),
  H('h_e4', 64, 862, 0, 'chain', 'E vent (under the D cup)'),
  H('h_eb4', 63, 900, -45, 'chain', 'Low E♭ tone hole'),
  H('h_d4', 62, 935, 10, 'chain', 'D vent (under the low C cup)'),
  H('h_cs4', 61, 1105, 20, 'chain', 'Low C♯ tone hole (bell)'),
  H('h_c4', 60, 1150, 55, 'chain', 'C vent (under the low B cup, bell)'),
  H('h_b3', 59, 1200, 160, 'chain', 'B vent (under the low B♭ cup, bell)'),
  H('h_d5', 74, 495, -95, 'palm', 'Palm D tone hole', 7.5),
  H('h_eb5', 75, 468, -75, 'palm', 'Palm E♭ tone hole', 7),
  H('h_e5', 76, 442, 68, 'side', 'High E tone hole', 6.5),
  H('h_f5', 77, 418, -100, 'palm', 'Palm F tone hole', 6.5),
  H('h_fs5', 78, 392, 62, 'side', 'High F♯ tone hole', 6),
  H('h_sc', 72, 560, 68, 'side', 'Side C tone hole', 6.5),
  H('h_fstr', 66, 780, 62, 'trill', 'F♯ trill tone hole', 5),
  H('h_oct_body', null, 450, 180, 'register', 'Body octave pip', 1.6),
  H('h_oct_neck', null, 205, 90, 'register', 'Neck octave pip', 1.4),
];
for (const h of HOLES) if (h.rh == null) h.rh = rhChain(h.s);
export const HOLE = Object.fromEntries(HOLES.map(h => [h.id, h]));

// ---- hinge rods ------------------------------------------------------------------
// kind 'rod': a steel hinge rod through the key tubes, a post at each end,
// a rod screw head at end a. kind 'points': two pivot screws, one in each
// post. A rod lies along the tube at (phi, dr) from s0 to s1. The neck rod
// has an explicit axis across the neck.
function R(id, kind, phi, dr, s0, s1, extra) { return { id, kind, phi, dr, s0, s1, ...extra }; }
export const RODS = [
  R('r_lh', 'rod', -58, 7, 512, 696),        // left-hand stack: C#, B, A, G
  R('r_bis', 'points', 72, 6, 574, 606),     // bis B-flat cup
  R('r_gs', 'points', 86, 6, 682, 712),      // G# cup
  R('r_rh', 'rod', -58, 7, 718, 882),        // right-hand stack: F#, F, E, D
  R('r_fstr', 'points', 46, 6, 770, 846),    // F# trill
  R('r_sc', 'rod', 116, 16, 552, 716),         // side C
  R('r_se', 'rod', 116, 11, 434, 692),        // high E
  R('r_hfs', 'rod', 116, 6, 386, 668),       // high F#
  R('r_sbb', 'rod', 132, 6, 598, 748),       // side Bb lever
  R('r_pd', 'points', -122, 6, 466, 498),    // palm D
  R('r_peb', 'points', -122, 11, 462, 504),  // palm Eb
  R('r_pf', 'rod', -122, 16, 412, 542),      // palm F
  R('r_ff', 'points', -36, 10, 522, 546),    // front F lever
  R('r_gst', 'points', 104, 7, 700, 724),    // G# touch lever
  R('r_lcst', 'rod', 104, 10, 726, 930),     // low C# touch lever
  R('r_lbt', 'rod', 104, 15, 726, 930),      // low B touch lever
  R('r_lbbt', 'rod', 104, 20, 746, 930),     // low Bb touch lever
  R('r_lcs', 'points', -12, 6, 1094, 1120),  // low C# cup (bell)
  R('r_lb', 'points', 22, 6, 1138, 1166),    // low B cup (bell)
  R('r_lbb', 'points', 128, 6, 1188, 1216),   // low Bb cup (bell)
  R('r_leb', 'rod', -75, 7, 878, 914),       // low Eb
  R('r_lc', 'rod', -120, 9, 858, 946),        // low C
  R('r_th', 'points', 150, 8, 584, 618),     // octave thumb key
  R('r_sw', 'points', -160, 9, 462, 478),    // octave swivel
  R('r_ob', 'rod', 152, 6, 436, 482),        // body octave key
  R('r_lift', 'points', 150, 8, 318, 344),   // pin key (lifter)
  R('r_on', 'points', 90, 7, 0, 0, { neckAxis: { s: 246, half: 7 } }), // neck octave key
];
export const ROD = Object.fromEntries(RODS.map(r => [r.id, r]));

// The two end points of a rod, or of the part [s0, s1] of a rod.
export function rodEnds(rod, s0 = rod.s0, s1 = rod.s1) {
  if (rod.neckAxis) {
    const c = surf(rod.neckAxis.s, rod.phi, rod.dr), f = center(rod.neckAxis.s).f, h = rod.neckAxis.half;
    return [add(c, mul(f, -h)), add(c, mul(f, h))];
  }
  return [surf(s0, rod.phi, rod.dr), surf(s1, rod.phi, rod.dr)];
}

// ---- keys ------------------------------------------------------------------------
// One key is one rigid part on one hinge.
//   rod, span [s0, s1] ... the hinge and the length of the key tube on it
//   cups ............ tone hole ids that this key covers
//   restOpen ........ the rest state of its cups (true: open at rest)
//   touches ......... { id, name, kind, s, phi, dr } touch pieces
//   spring .......... 'needle' or 'flat' (null: no spring of its own)
//   stops ........... felt or cork: { kind, where } where = open stop,
//                     touch, foot
//   travel .......... the hinge turn in degrees (exaggerated for clarity)
//   what ............ one line on what the key does
function K(id, group, name, o) {
  return { id, group, name, cups: [], touches: [], restOpen: true, spring: 'needle', stops: [], travel: 13, what: '', ...o };
}
const T = (id, name, kind, s, phi, dr) => ({ id, name, kind, s, phi, dr });
export const KEYS = [
  // octave mechanism
  K('k_oct', 'oct', 'Octave thumb key', { rod: 'r_th', span: [586, 616], spring: 'flat', travel: 11,
    touches: [T('t_oct', 'Octave key (left thumb)', 'thumb', 600, 172, 13)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'The thumb switch. It moves the swivel through a fork and pin.' }),
  K('k_swivel', 'oct', 'Swivel arm', { rod: 'r_sw', span: [463, 477], spring: null, travel: 9,
    what: 'A rocker on a pin on the body octave key. It sends the thumb force to the body key or to the pin key.' }),
  K('k_obody', 'oct', 'Body octave key', { rod: 'r_ob', span: [438, 480], cups: ['h_oct_body'], restOpen: false, travel: 10,
    stops: [{ kind: 'felt', where: 'foot' }],
    what: 'Opens the body pip for written D5 to G♯5.' }),
  K('k_lift', 'oct', 'Pin key (lifter)', { rod: 'r_lift', span: [320, 342], spring: 'flat', travel: 12,
    stops: [{ kind: 'cork', where: 'foot' }],
    what: 'Rises about 1 mm to touch the neck key ring, then lifts it.' }),
  K('k_oneck', 'oct', 'Neck octave key', { rod: 'r_on', span: [0, 0], cups: ['h_oct_neck'], restOpen: false, travel: 12,
    stops: [{ kind: 'felt', where: 'foot' }],
    what: 'Opens the neck pip for A5 and up. Its ring sits over the pin key.' }),

  // left-hand stack
  K('k_cs', 'lh', 'C♯ pad key', { rod: 'r_lh', span: [514, 540], cups: ['h_cs5'],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'The top hole of the chain. Open for C♯; the B, A and G keys close it through the C♯ bar.' }),
  K('k_b', 'lh', 'B key', { rod: 'r_lh', span: [544, 572], cups: ['h_c5'],
    touches: [T('t_b', 'B pearl (left 1st finger)', 'pearl', 556, 0, 0)],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Closes the C vent and, through the C♯ bar, the C♯ pad.' }),
  K('k_bis', 'lh', 'B♭ (bis) key', { rod: 'r_bis', span: [576, 604], cups: ['h_b4'], spring: 'needle', travel: 14,
    touches: [T('t_bis', 'Bis pearl (left 1st finger)', 'pearl-small', 590, -6, 3)],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Closes the B vent. The bis pearl, the A key, the side B♭ lever and the B♭ bar from the right hand all close it.' }),
  K('k_a', 'lh', 'A key', { rod: 'r_lh', span: [608, 636], cups: ['h_bb4'],
    touches: [T('t_a', 'A pearl (left 2nd finger)', 'pearl', 622, 0, 0)],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Closes the B♭ vent, and through two feet the C♯ pad and the bis cup.' }),
  K('k_g', 'lh', 'G key', { rod: 'r_lh', span: [644, 694], cups: ['h_a4'], travel: 13,
    touches: [T('t_g', 'G pearl (left 3rd finger)', 'pearl', 658, 0, 0)],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Closes the A vent. At rest its long foot holds the body octave key shut. It has the strongest spring.' }),

  // palm keys and front F
  K('k_pd', 'palm', 'Palm D key', { rod: 'r_pd', span: [468, 496], cups: ['h_d5'], restOpen: false, spring: 'flat', travel: 14,
    touches: [T('t_pd', 'Palm D (left palm)', 'palm', 470, -150, 14)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Opens the high D hole. With the octave key it gives D6.' }),
  K('k_peb', 'palm', 'Palm E♭ key', { rod: 'r_peb', span: [464, 502], cups: ['h_eb5'], restOpen: false, spring: 'flat', travel: 14,
    touches: [T('t_peb', 'Palm E♭ (left palm)', 'palm', 502, -150, 18)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Opens the high E♭ hole, above palm D.' }),
  K('k_pf', 'palm', 'Palm F key', { rod: 'r_pf', span: [414, 540], cups: ['h_f5'], restOpen: false, spring: 'needle', travel: 13,
    touches: [T('t_pf', 'Palm F (left palm, by the 1st finger)', 'palm', 536, -146, 22)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Opens the high F hole. The front F lever can also lift it.' }),
  K('k_ff', 'palm', 'Front F lever', { rod: 'r_ff', span: [524, 544], spring: 'flat', travel: 12,
    touches: [T('t_ff', 'Front F (left 1st finger, above the B pearl)', 'lever', 534, -12, 10)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'A second way to open the high F hole, with the finger that is on the B pearl.' }),

  // left pinky table and the bell keys
  K('k_gst', 'table', 'G♯ touch lever', { rod: 'r_gst', span: [702, 722], spring: 'needle', travel: 12,
    touches: [T('t_gs', 'G♯ spatula (left little finger)', 'spatula', 712, 80, 13)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Its strong spring holds the G♯ cup down. Press it and the light cup spring opens the cup.' }),
  K('k_gs', 'table', 'G♯ cup', { rod: 'r_gs', span: [684, 710], cups: ['h_gs4'], restOpen: false, travel: 14,
    stops: [{ kind: 'felt', where: 'foot' }],
    what: 'Closed at rest. The low C♯, B and B♭ touches hold it shut (the articulation).' }),
  K('k_lcst', 'table', 'Low C♯ touch lever', { rod: 'r_lcst', span: [728, 928], spring: 'needle', travel: 8,
    touches: [T('t_lcs', 'Low C♯ spatula (left little finger)', 'spatula', 730, 66, 14)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'A long lever down the body. It opens the low C♯ cup on the bell and closes low C.' }),
  K('k_lbt', 'table', 'Low B touch lever', { rod: 'r_lbt', span: [728, 928], spring: 'needle', travel: 11,
    touches: [T('t_lb', 'Low B spatula (left little finger)', 'spatula', 734, 94, 17)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'A long lever down the body. It closes the low B cup and the low C cup.' }),
  K('k_lbbt', 'table', 'Low B♭ touch lever', { rod: 'r_lbbt', span: [748, 928], spring: 'needle', travel: 8,
    touches: [T('t_lbb', 'Low B♭ spatula (left little finger)', 'spatula', 752, 80, 22)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Closes the low B♭ cup, and pulls the low B lever down with it.' }),
  K('k_lcs', 'table', 'Low C♯ cup', { rod: 'r_lcs', span: [1096, 1118], cups: ['h_cs4'], restOpen: false, travel: 14,
    stops: [{ kind: 'felt', where: 'foot' }],
    what: 'Sprung closed. Its touch lever opens it; the low B cup holds it shut.' }),
  K('k_lb', 'table', 'Low B cup', { rod: 'r_lb', span: [1140, 1164], cups: ['h_c4'], travel: 12,
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Sprung open. It closes for low B and low B♭.' }),
  K('k_lbb', 'table', 'Low B♭ cup', { rod: 'r_lbb', span: [1190, 1214], cups: ['h_b3'], travel: 12,
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Sprung open. It closes for low B♭ only; then the bell end sounds.' }),

  // side keys
  K('k_sbb', 'side', 'Side B♭ lever', { rod: 'r_sbb', span: [600, 746], spring: 'flat', travel: 13,
    touches: [T('t_sbb', 'Side B♭ (right hand, side of the 1st finger)', 'lever', 742, 146, 13)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Closes the B♭ (bis) cup through an arm, so B plus side B♭ gives B♭.' }),
  K('k_sc', 'side', 'Side C key', { rod: 'r_sc', span: [554, 714], cups: ['h_sc'], restOpen: false, spring: 'flat', travel: 9,
    touches: [T('t_sc', 'Side C (right hand side)', 'lever', 714, 144, 20)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Opens a side hole at the C vent, so B plus side C gives C.' }),
  K('k_se', 'side', 'High E side key', { rod: 'r_se', span: [436, 690], cups: ['h_e5'], restOpen: false, spring: 'flat', travel: 8,
    touches: [T('t_se', 'High E (right hand side)', 'lever', 688, 142, 16)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Opens the high E hole near the top of the body.' }),
  K('k_hfs', 'side', 'High F♯ key', { rod: 'r_hfs', span: [388, 666], cups: ['h_fs5'], restOpen: false, spring: 'flat', travel: 8,
    touches: [T('t_hfs', 'High F♯ (right hand side, top)', 'lever', 662, 140, 12)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Opens the highest tone hole. With the palm keys it gives F♯6.' }),

  // right-hand stack
  K('k_fs', 'rh', 'F♯ cup', { rod: 'r_rh', span: [720, 748], cups: ['h_g4'],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Has no touch. The F, E and D keys close it through the F♯ bar. It drives the B♭ bar.' }),
  K('k_f', 'rh', 'F key', { rod: 'r_rh', span: [762, 790], cups: ['h_fs4'],
    touches: [T('t_f', 'F pearl (right 1st finger)', 'pearl', 776, 0, 0)],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Closes the F♯ vent, and the F♯ cup through the bar.' }),
  K('k_e', 'rh', 'E key', { rod: 'r_rh', span: [804, 832], cups: ['h_f4'],
    touches: [T('t_e', 'E pearl (right 2nd finger)', 'pearl', 818, 0, 0)],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Closes the F vent, and the F♯ cup through the bar (so E alone gives F♯).' }),
  K('k_d', 'rh', 'D key', { rod: 'r_rh', span: [846, 880], cups: ['h_e4'],
    touches: [T('t_d', 'D pearl (right 3rd finger)', 'pearl', 862, 0, 0)],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Closes the E vent, and the F♯ cup through the bar.' }),
  K('k_fstr', 'rh', 'F♯ trill key', { rod: 'r_fstr', span: [772, 844], cups: ['h_fstr'], restOpen: false, spring: 'flat', travel: 12,
    touches: [T('t_fstr', 'F♯ trill (right 2nd or 3rd finger)', 'pearl-small', 841, 26, 6)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Opens a small hole at the F♯ vent, for an F to F♯ trill.' }),

  // right pinky keys
  K('k_leb', 'rp', 'Low E♭ key', { rod: 'r_leb', span: [880, 912], cups: ['h_eb4'], restOpen: false, travel: 13,
    touches: [T('t_leb', 'Low E♭ spatula (right little finger)', 'spatula', 886, -105, 15)],
    stops: [{ kind: 'cork', where: 'touch' }],
    what: 'Sprung closed. Press it to open the E♭ hole.' }),
  K('k_lc', 'rp', 'Low C key', { rod: 'r_lc', span: [860, 944], cups: ['h_d4'], travel: 10,
    touches: [T('t_lc', 'Low C spatula (right little finger)', 'spatula', 864, -92, 15)],
    stops: [{ kind: 'felt', where: 'open' }],
    what: 'Sprung open. It closes the D vent; the low C♯, B and B♭ levers also close it.' }),
];
export const KEY = Object.fromEntries(KEYS.map(k => [k.id, k]));
export const TOUCHES = KEYS.flatMap(k => k.touches.map(t => ({ ...t, key: k.id, group: k.group })));
export const TOUCH = Object.fromEntries(TOUCHES.map(t => [t.id, t]));
// hole id -> the key whose cup covers it
export const HOLE_CUP = {};
for (const k of KEYS) for (const h of k.cups) HOLE_CUP[h] = k.id;

// ---- linkages --------------------------------------------------------------------
// drive {from, to}: from actuated -> to actuated.
// hold {by, when, to}: by in state `when` -> to cannot move.
// swap {from, a, b}: from actuated -> a if a is free, else b.
// part: the shape of the link. adjust: the felt, cork or screw at the
// contact. at: optional explicit anchors { a: [s, phi, dr], via: [...],
// b: [s, phi, dr] } when the straight line from rod to rod is poor.
function L(id, kind, o) { return { id, kind, part: 'foot', adjust: 'felt', why: '', ...o }; }
export const LINKS = [
  L('l_fork', 'drive', { from: 'k_oct', to: 'k_swivel', part: 'fork', adjust: 'cork',
    at: { a: [586, 160, 9], via: [[520, -175, 12]], b: [478, -162, 11] },
    why: 'The thumb key arm ends in a fork. The fork holds a pin on the swivel, so the thumb turns the swivel.' }),
  L('l_swap', 'swap', { from: 'k_swivel', a: 'k_obody', b: 'k_lift', part: 'swivel', adjust: 'cork',
    why: 'The swivel pushes on the body octave key and on the pin key. When the G foot holds the body key down, all the force goes to the pin key.' }),
  L('l_ring', 'drive', { from: 'k_lift', to: 'k_oneck', part: 'ring', adjust: 'cork',
    at: { a: [322, 150, 12], b: [300, 150, 11] },
    why: 'The pin key rises about 1 mm, touches the ring of the neck key and lifts it. The neck key turns on its hinge and opens the neck pip.' }),
  L('l_gfoot', 'hold', { by: 'k_g', when: 'rest', to: 'k_obody', part: 'foot', adjust: 'felt',
    at: { a: [646, -100, 10], via: [[600, -150, 12], [500, -172, 12]], b: [470, 172, 10] },
    why: 'At rest the G key foot sits on the body octave key and holds it shut. Close the G key and the foot lifts, so the body key is free.' }),
  L('l_csb', 'drive', { from: 'k_b', to: 'k_cs', part: 'bar', adjust: 'felt',
    why: 'A foot on the B key closes the C♯ pad (the C♯ bar).' }),
  L('l_csa', 'drive', { from: 'k_a', to: 'k_cs', part: 'bar', adjust: 'felt',
    why: 'A foot on the A key also closes the C♯ pad, so the A key alone gives C.' }),
  L('l_csg', 'drive', { from: 'k_g', to: 'k_cs', part: 'bar', adjust: 'felt',
    why: 'A foot on the G key closes the C♯ pad too.' }),
  L('l_abis', 'drive', { from: 'k_a', to: 'k_bis', part: 'foot', adjust: 'screw',
    why: 'The A key closes the bis cup, so the bis cup comes down for A and every note below.' }),
  L('l_sbb', 'drive', { from: 'k_sbb', to: 'k_bis', part: 'bar', adjust: 'cork',
    why: 'The side B♭ lever arm presses the bis cup shut.' }),
  L('l_bbbar', 'drive', { from: 'k_fs', to: 'k_bis', part: 'bar', adjust: 'screw',
    at: { a: [722, -40, 9], via: [[700, 10, 13]], b: [604, 64, 8] },
    why: 'The B♭ bar: when the F♯ cup closes, a long bar closes the bis cup. So B plus F (or E) gives the forked B♭.' }),
  L('l_fsf', 'drive', { from: 'k_f', to: 'k_fs', part: 'bar', adjust: 'screw',
    why: 'The F♯ bar: the F key closes the F♯ cup.' }),
  L('l_fse', 'drive', { from: 'k_e', to: 'k_fs', part: 'bar', adjust: 'screw',
    why: 'The E key closes the F♯ cup through the same bar.' }),
  L('l_fsd', 'drive', { from: 'k_d', to: 'k_fs', part: 'bar', adjust: 'screw',
    why: 'The D key closes the F♯ cup through the same bar.' }),
  L('l_ff', 'drive', { from: 'k_ff', to: 'k_pf', part: 'foot', adjust: 'cork',
    why: 'The front F lever foot lifts the palm F key arm, so the palm F cup opens.' }),
  L('l_gs', 'drive', { from: 'k_gst', to: 'k_gs', part: 'tab', adjust: 'cork',
    why: 'The G♯ touch lever lifts off the G♯ cup arm; the cup spring then opens the cup.' }),
  L('l_gscs', 'hold', { by: 'k_lcst', when: 'actuated', to: 'k_gs', part: 'tab', adjust: 'screw',
    why: 'Articulated G♯: a tab on the low C♯ lever holds the G♯ cup shut, so you can keep the G♯ touch down.' }),
  L('l_gsb', 'hold', { by: 'k_lbt', when: 'actuated', to: 'k_gs', part: 'tab', adjust: 'screw',
    why: 'Articulated G♯: the low B lever holds the G♯ cup shut.' }),
  L('l_gsbb', 'hold', { by: 'k_lbbt', when: 'actuated', to: 'k_gs', part: 'tab', adjust: 'screw',
    why: 'Articulated G♯: the low B♭ lever holds the G♯ cup shut.' }),
  L('l_lcs', 'drive', { from: 'k_lcst', to: 'k_lcs', part: 'bar', adjust: 'cork',
    at: { a: [905, 100, 13], via: [[1100, 75, 12]], b: [1104, -12, 9] },
    why: 'A connecting arm from the C♯ lever lifts the low C♯ cup on the bell.' }),
  L('l_lb', 'drive', { from: 'k_lbt', to: 'k_lb', part: 'bar', adjust: 'cork',
    why: 'A connecting arm from the B lever closes the low B cup on the bell.' }),
  L('l_lbb', 'drive', { from: 'k_lbbt', to: 'k_lbb', part: 'bar', adjust: 'cork',
    why: 'A connecting arm from the B♭ lever closes the low B♭ cup.' }),
  L('l_bbb', 'drive', { from: 'k_lbbt', to: 'k_lbt', part: 'tab', adjust: 'felt',
    why: 'B♭ to B link: the B♭ lever presses the B lever down too.' }),
  L('l_bc', 'drive', { from: 'k_lbt', to: 'k_lc', part: 'bar', adjust: 'felt',
    why: 'B to C link: the B lever closes the low C cup, so the right little finger stays free.' }),
  L('l_csc', 'drive', { from: 'k_lcst', to: 'k_lc', part: 'bar', adjust: 'felt',
    why: 'C♯ to C link: the low C♯ lever closes the low C cup (CONTRACT F27: an inference).' }),
  L('l_bcs', 'hold', { by: 'k_lb', when: 'actuated', to: 'k_lcs', part: 'tab', adjust: 'felt',
    why: 'B to C♯ hold-down: the low B cup keeps the low C♯ cup shut.' }),
];
export const LINK = Object.fromEntries(LINKS.map(l => [l.id, l]));
// the ends of a link: [driver, driven...]
export function linkEnds(l) {
  if (l.kind === 'drive') return [l.from, [l.to]];
  if (l.kind === 'hold') return [l.by, [l.to]];
  return [l.from, [l.a, l.b]];
}

// ---- groups ----------------------------------------------------------------------
export const GROUPS = [
  { id: 'oct', name: 'Automatic octave', color: '#5fd0ff', text:
    'The thumb key is a switch. It turns a swivel arm through a fork and a pin. The swivel pushes on two keys: the body octave key and the pin key under the neck key ring. The G key decides which one moves. When the G key is up (A5 and higher), its foot holds the body key shut, so the swivel lifts the pin key and the neck pip opens. When the G key is down (D5 to G♯5), the foot lifts away, the body key is free, and the body pip opens. The player keeps the thumb down; the G key does the change-over.' },
  { id: 'lh', name: 'Left-hand stack', color: '#ffb347', text:
    'Three pearl keys (B, A, G) and two cups with no pearl of their own: the C♯ pad at the top and the bis B♭ cup. Feet on the B, A and G keys close the C♯ pad (the C♯ bar). A foot on the A key closes the bis cup, so the A key alone gives C, and the bis cup is shut for every note from A down. The G key foot also runs up the back to the octave mechanism.' },
  { id: 'palm', name: 'Palm keys and front F', color: '#b48cff', text:
    'Palm D, E♭ and F open three small holes near the top of the body. They are sprung closed by flat springs, with a cork under each touch. With the octave key the first open hole is high, so they give D6, E♭6 and F6. The front F lever, under the left first finger, has a foot under the palm F arm: a second way to open the F hole.' },
  { id: 'table', name: 'Pinky table and bell keys', color: '#6fe08a', text:
    'Four spatulas under the left little finger: G♯, low C♯, low B and low B♭. The C♯, B and B♭ levers are long keys down the body. Connecting arms take them to three cups on the bell. Links close the low C cup with them, B♭ pulls B with it, and the B cup holds C♯ shut. The G♯ articulation: each of the three low levers has a tab that holds the G♯ cup shut, so the G♯ touch can stay down when you go to a low note.' },
  { id: 'side', name: 'Side keys', color: '#ff7eb6', text:
    'Four levers on the bell side of the body, under the right hand: side B♭, side C, high E and high F♯. Side C, high E and high F♯ open their own holes. They are seesaw keys: the touch goes in and the cup comes out. Side B♭ has no cup; its arm closes the bis cup, which is shared with the bis pearl.' },
  { id: 'rh', name: 'Right-hand stack', color: '#ff8a5c', text:
    'Three pearl keys (F, E, D), the F♯ cup with no pearl, and the F♯ trill key. The F♯ bar lets any of the three pearls close the F♯ cup, so E alone gives F♯. The F♯ cup drives the long B♭ bar up to the bis cup: B plus F gives the forked B♭. Adjusting screws on the bars set the timing, so that the cups close at the same time.' },
  { id: 'rp', name: 'Right pinky keys', color: '#e6e65a', text:
    'Low E♭ is sprung closed; press its spatula to open it. Low C is a large cup that is sprung open; its spatula closes it. The low C♯, B and B♭ levers on the left also close the low C cup through links, so the right little finger is free for those notes.' },
  { id: 'neck', name: 'Neck, mouthpiece and reed', color: '#c9d1da', text:
    'The neck is a short tapered tube that a screw clamps into the body socket. It carries the neck octave pip and the neck octave key. A cork on the neck end holds the mouthpiece; its position sets the tuning. The cane reed sits on the flat table of the mouthpiece, and the ligature clamps it with two screws. The reed and the mouthpiece make a pressure valve that drives the air column.' },
];
export const GROUP = Object.fromEntries(GROUPS.map(g => [g.id, g]));

// ---- fingering chart ---------------------------------------------------------------
const LH = ['t_b', 't_a', 't_g'], RH = ['t_f', 't_e', 't_d'];
const base = {
  58: [...LH, ...RH, 't_lbb'], 59: [...LH, ...RH, 't_lb'], 60: [...LH, ...RH, 't_lc'], 61: [...LH, ...RH, 't_lcs'],
  62: [...LH, ...RH], 63: [...LH, ...RH, 't_leb'], 64: [...LH, 't_f', 't_e'], 65: [...LH, 't_f'], 66: [...LH, 't_e'],
  67: [...LH], 68: [...LH, 't_gs'], 69: ['t_b', 't_a'], 70: ['t_b', 't_bis'], 71: ['t_b'], 72: ['t_a'], 73: [],
};
function F(note, touches, alt = '') { return { id: noteName(note) + (alt ? '-' + alt.replace(/\W+/g, '').toLowerCase() : ''), note, touches, alt }; }
export const FINGERINGS = [];
for (let n = 58; n <= 73; n++) FINGERINGS.push(F(n, base[n]));
for (let n = 74; n <= 85; n++) FINGERINGS.push(F(n, ['t_oct', ...base[n - 12]]));
FINGERINGS.push(
  F(86, ['t_oct', 't_pd']),
  F(87, ['t_oct', 't_pd', 't_peb']),
  F(88, ['t_oct', 't_pd', 't_peb', 't_se']),
  F(89, ['t_oct', 't_pd', 't_peb', 't_pf']),
  F(90, ['t_oct', 't_pd', 't_peb', 't_pf', 't_hfs']),
  // alternatives
  F(70, ['t_b', 't_sbb'], 'side'),
  F(70, ['t_b', 't_f'], '1 and 1'),
  F(72, ['t_b', 't_sc'], 'side C'),
  F(66, [...LH, 't_f', 't_fstr'], 'trill key'),
  F(82, ['t_oct', 't_b', 't_sbb'], 'side'),
  F(82, ['t_oct', 't_b', 't_f'], '1 and 1'),
  F(84, ['t_oct', 't_b', 't_sc'], 'side C'),
  F(89, ['t_oct', 't_ff'], 'front F'),
);
export const FINGERING = Object.fromEntries(FINGERINGS.map(f => [f.id, f]));
export const MAIN_FINGERINGS = FINGERINGS.filter(f => !f.alt);

// ---- solver ----------------------------------------------------------------------
// Directed edges of the linkage graph (driver -> driven).
export function edges() {
  const out = [];
  for (const l of LINKS) { const [d, t] = linkEnds(l); for (const x of t) out.push([d, x, l.id]); }
  // a swap decides b from the state of a, so a comes first
  for (const l of LINKS) if (l.kind === 'swap') out.push([l.a, l.b, l.id + ':order']);
  return out;
}
// Kahn order of the keys. Returns null when the graph has a cycle.
export function topoOrder() {
  const ids = KEYS.map(k => k.id), indeg = new Map(ids.map(i => [i, 0])), adj = new Map(ids.map(i => [i, []]));
  for (const [a, b] of edges()) { if (!adj.has(a) || !indeg.has(b)) return null; adj.get(a).push(b); indeg.set(b, indeg.get(b) + 1); }
  const q = ids.filter(i => indeg.get(i) === 0), out = [];
  while (q.length) { const i = q.shift(); out.push(i); for (const j of adj.get(i)) { indeg.set(j, indeg.get(j) - 1); if (indeg.get(j) === 0) q.push(j); } }
  return out.length === ids.length ? out : null;
}
const ORDER = topoOrder() || KEYS.map(k => k.id);
const IN = new Map(KEYS.map(k => [k.id, []]));
for (const l of LINKS) for (const x of linkEnds(l)[1]) if (IN.has(x)) IN.get(x).push(l);

// solve(touchIds) -> {
//   act: Set of actuated keys, held: Set of held keys,
//   links: Map linkId -> 'carry' | 'blocked' | 'hold' | 'a' | 'b'
//   holes: { holeId: true when open }, octave: null | 'body' | 'neck',
//   vent: the first open hole id (null: the bell end), note: written MIDI }
// One pass in topological order is enough: every driver and every holder
// comes before the keys it acts on.
export function solve(touchIds = []) {
  const pressed = new Set();
  for (const t of touchIds) if (TOUCH[t]) pressed.add(TOUCH[t].key);
  const act = new Set(), held = new Set(), links = new Map();
  for (const id of ORDER) {
    let hold = false, push = pressed.has(id);
    for (const l of IN.get(id)) {
      if (l.kind === 'hold') {
        const on = l.when === 'rest' ? !act.has(l.by) : act.has(l.by);
        if (on) { hold = true; links.set(l.id, 'hold'); }
      } else if (l.kind === 'drive' && act.has(l.from)) { push = true; links.set(l.id, 'carry'); }
    }
    // swap: a takes the force when it is free, else b
    for (const l of IN.get(id)) {
      if (l.kind !== 'swap' || !act.has(l.from)) continue;
      if (id === l.a && !hold) { push = true; links.set(l.id, 'a'); }
      if (id === l.b && held.has(l.a)) { push = true; links.set(l.id, 'b'); }
    }
    if (hold) { held.add(id); if (push) for (const l of IN.get(id)) if (links.get(l.id) === 'carry') links.set(l.id, 'blocked'); continue; }
    if (push) act.add(id);
  }
  const holes = {};
  for (const h of HOLES) { const k = KEY[HOLE_CUP[h.id]]; holes[h.id] = k ? (k.restOpen !== act.has(k.id)) : true; }
  const octave = holes.h_oct_neck ? 'neck' : holes.h_oct_body ? 'body' : null;
  let vent = null;
  for (const h of HOLES) if (h.vent != null && holes[h.id] && (!vent || h.s < HOLE[vent].s)) vent = h.id;
  const note = (vent ? HOLE[vent].vent : BELL_NOTE) + (octave ? 12 : 0);
  return { act, held, links, holes, octave, vent, note, pressed };
}

// What one touch moves, given the other touches that are down.
// -> { keys: [ids in path order], links: [ids], path: [[fromKey, linkId, toKey]] }
export function movedBy(touchId, others = []) {
  const t = TOUCH[touchId]; if (!t) return { keys: [], links: [], path: [] };
  const rest = others.filter(x => x !== touchId);
  const A = solve(rest), B = solve([...rest, touchId]);
  const changed = new Set(KEYS.map(k => k.id).filter(id => A.act.has(id) !== B.act.has(id)));
  changed.add(t.key);
  const keys = [t.key], seen = new Set(keys), linksOut = [], path = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    for (const l of LINKS) {
      const [d, targets] = linkEnds(l);
      if (d !== k) continue;
      for (const x of targets) {
        if (!changed.has(x)) continue;
        const st = B.links.get(l.id) || A.links.get(l.id);
        if (!st) continue;
        if (l.kind === 'swap' && st !== (x === l.a ? 'a' : 'b')) continue;
        linksOut.push(l.id); path.push([k, l.id, x]);
        if (!seen.has(x)) { seen.add(x); keys.push(x); }
      }
    }
  }
  return { keys, links: [...new Set(linksOut)], path, before: A, after: B };
}

// The sounding pitch in Hz of a written note (A4 = 440 Hz, Eb alto).
export const hz = written => 440 * Math.pow(2, (written + TRANSPOSE - 69) / 12);

// Counts for the page and the report.
export function counts() {
  const springs = KEYS.filter(k => k.spring).length;
  const stops = KEYS.reduce((n, k) => n + k.stops.length, 0) + LINKS.length;
  const posts = RODS.reduce((n, r) => n + (r.neckAxis ? 2 : 2), 0);
  const screws = RODS.reduce((n, r) => n + (r.kind === 'points' ? 2 : 1), 0);
  return { keys: KEYS.length, touches: TOUCHES.length, holes: HOLES.length, cups: KEYS.reduce((n, k) => n + k.cups.length, 0),
    rods: RODS.length, posts, screws, springs, stops, links: LINKS.length, groups: GROUPS.length, fingerings: FINGERINGS.length };
}
