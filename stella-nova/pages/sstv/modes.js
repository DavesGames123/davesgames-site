// ============================================================================
//  SSTV  ·  mode table  (ES module, pure: node and browser)
// ----------------------------------------------------------------------------
//  Each SSTV mode is a picture size, a VIS code and one scan line written as
//  a list of segments. A segment is a tone of fixed length:
//    { t: 'sync',  ms }            1200 Hz, the horizontal sync pulse
//    { t: 'porch', ms, f }         a fixed tone (f in Hz, or 'parity' for the
//                                  Robot 36 separator: 1500 Hz on even lines,
//                                  2300 Hz on odd lines)
//    { t: 'scan',  ms, ch }        W pixels of channel ch, each ms / W long
//  Channels: R G B (RGB modes), Y (luminance of the line), RY BY (the R-Y
//  and B-Y colour differences, Cr and Cb), C (Robot 36: RY on even lines,
//  BY on odd lines), Y0 Y1 (PD modes: the two luma rows of a line pair).
//
//  SOURCES. Line timings are from JL Barber N7CXI, "Proposal for SSTV mode
//  specifications", Dayton SSTV forum, 2000, and they agree with pysstv
//  (github.com/dnet/pysstv, MIT, Andras Veres-Szentkiralyi), to 0.001 ms
//  per line. tests.mjs holds the pysstv line lengths. Two notes:
//    Scottie   the spec puts one extra 9 ms sync before the first line.
//              We send it. pysstv does not, so its file is 9 ms shorter.
//              pysstv also splits the 1.5 ms porches into 2 x 1.5 ms with a
//              136.74 ms scan. The line length is the same.
//    Robot 8 and 24 BW, Wraase SC2-120 and Pasokon follow pysstv.
//    Robot 72 is not in pysstv. It follows Barber (Y 138, R-Y 69, B-Y 69).
//
//  EXPORTS   (grep -n targets)
//    FREQ ............ "export const FREQ"     tone table in Hz
//    VIS_MS .......... "export const VIS_MS"   header timing
//    MODES ........... "export const MODES"    every mode, in menu order
//    byId / byVis .... "export function byId"
//    lineMs .......... "export function lineMs"   length of one line
//    totalMs ......... "export function totalMs"  whole transmission
//    lineSegs ........ "export function lineSegs" segments of line k
//    syncOffset ...... "export function syncOffset"  ms from line start
// ============================================================================

export const FREQ = { sync: 1200, black: 1500, white: 2300, leader: 1900, bit1: 1100, bit0: 1300 };
// leader 300, break 10, leader 300, start bit 30, 7 data bits, parity, stop.
export const VIS_MS = { leader: 300, brk: 10, bit: 30, total: 300 + 10 + 300 + 30 * 10 };

const S = (ms) => ({ t: 'sync', ms });
const P = (ms, f = 1500) => ({ t: 'porch', ms, f });
const C = (ms, ch) => ({ t: 'scan', ms, ch });

function martin(id, name, vis, W, scan) {
  const g = 0.572;
  return { id, name, family: 'Martin', vis, W, H: 256, rows: 1, colour: 'GBR', author: 'Martin Emmerson, G3OQD',
    seq: [S(4.862), P(g), C(scan, 'G'), P(g), C(scan, 'B'), P(g), C(scan, 'R'), P(g)] };
}
function scottie(id, name, vis, W, scan) {
  return { id, name, family: 'Scottie', vis, W, H: 256, rows: 1, colour: 'GBR', author: 'Eddie Murphy, GM3SBC',
    start: [S(9)],
    seq: [P(1.5), C(scan, 'G'), P(1.5), C(scan, 'B'), S(9), P(1.5), C(scan, 'R')] };
}
function pd(id, name, vis, W, H, px) {
  const s = W * px;
  return { id, name, family: 'PD', vis, W, H, rows: 2, colour: 'YUV', author: 'Paul Turner, G4IJE, and Don Rotier, K0HEO',
    seq: [S(20), P(2.08), C(s, 'Y0'), C(s, 'RY'), C(s, 'BY'), C(s, 'Y1')] };
}
function pasokon(id, name, vis, unit) {
  const u = 1000 / unit;
  return { id, name, family: 'Pasokon', vis, W: 640, H: 496, rows: 1, colour: 'RGB', author: 'John Langner, WB2OSZ',
    seq: [S(25 * u), P(5 * u), C(640 * u, 'R'), P(5 * u), C(640 * u, 'G'), P(5 * u), C(640 * u, 'B'), P(5 * u)] };
}

export const MODES = [
  martin('m1', 'Martin M1', 44, 320, 146.432),
  martin('m2', 'Martin M2', 40, 160, 73.216),
  scottie('s1', 'Scottie S1', 60, 320, 138.24),
  scottie('s2', 'Scottie S2', 56, 160, 88.064),
  scottie('dx', 'Scottie DX', 76, 320, 345.6),
  { id: 'r8', name: 'Robot 8 BW', family: 'Robot', vis: 2, W: 160, H: 120, rows: 1, colour: 'BW', author: 'Robot Research',
    seq: [S(7), C(60, 'Y')] },
  { id: 'r24', name: 'Robot 24 BW', family: 'Robot', vis: 10, W: 320, H: 240, rows: 1, colour: 'BW', author: 'Robot Research',
    seq: [S(7), C(93, 'Y')] },
  { id: 'r36', name: 'Robot 36', family: 'Robot', vis: 8, W: 320, H: 240, rows: 1, colour: 'YUV', author: 'Robot Research',
    seq: [S(9), P(3), C(88, 'Y'), P(4.5, 'parity'), P(1.5, 1900), C(44, 'C')] },
  { id: 'r72', name: 'Robot 72', family: 'Robot', vis: 12, W: 320, H: 240, rows: 1, colour: 'YUV', author: 'Robot Research',
    seq: [S(9), P(3), C(138, 'Y'), P(4.5, 1500), P(1.5, 1900), C(69, 'RY'), P(4.5, 2300), P(1.5, 1900), C(69, 'BY')] },
  pd('pd90', 'PD-90', 99, 320, 256, 0.532),
  pd('pd120', 'PD-120', 95, 640, 496, 0.19),
  pd('pd160', 'PD-160', 98, 512, 400, 0.382),
  pd('pd180', 'PD-180', 96, 640, 496, 0.286),
  pd('pd240', 'PD-240', 97, 640, 496, 0.382),
  pd('pd290', 'PD-290', 94, 800, 616, 0.286),
  { id: 'sc2120', name: 'Wraase SC2-120', family: 'Wraase', vis: 63, W: 320, H: 256, rows: 1, colour: 'RGB', author: 'Volker Wraase, DL2RZ',
    seq: [S(5.5225), P(0.5), P(0.5), C(156, 'R'), P(0.5), C(156, 'G'), P(0.5), C(156, 'B')] },
  { id: 'sc2180', name: 'Wraase SC2-180', family: 'Wraase', vis: 55, W: 320, H: 256, rows: 1, colour: 'RGB', author: 'Volker Wraase, DL2RZ',
    seq: [S(5.5225), P(0.5), C(235, 'R'), C(235, 'G'), C(235, 'B')] },
  pasokon('p3', 'Pasokon P3', 113, 4800),
  pasokon('p5', 'Pasokon P5', 114, 3200),
  pasokon('p7', 'Pasokon P7', 115, 2400),
];
for (const m of MODES) {
  m.lines = m.H / m.rows;
  m.lineMs = m.seq.reduce((s, g) => s + g.ms, 0);
  m.startMs = (m.start || []).reduce((s, g) => s + g.ms, 0);
  m.syncMs = m.seq.find(g => g.t === 'sync').ms;
  // Display aspect: the 160-pixel Martin and Scottie modes show 160 wide
  // pixels at the 320 x 256 shape.
  m.aspect = m.W === 160 && m.H === 256 ? 1.25 : m.W / m.H;
}

export function byId(id) { return MODES.find(m => m.id === id) || null; }
export function byVis(code) { return MODES.find(m => m.vis === code) || null; }
export function lineMs(m) { return m.lineMs; }
export function totalMs(m) { return VIS_MS.total + m.startMs + m.lines * m.lineMs; }
export function lineSegs(m, k) {
  return m.seq.map(g => (g.f === 'parity' ? { t: 'porch', ms: g.ms, f: k % 2 ? 2300 : 1500 } : g));
}
// Milliseconds from the start of a line to the start of its sync pulse.
export function syncOffset(m) {
  let t = 0;
  for (const g of m.seq) { if (g.t === 'sync') return t; t += g.ms; }
  return 0;
}
// Colour order as a short string for tables: "G B R", "Y R-Y B-Y" and so on.
export function orderText(m) {
  const N = { R: 'R', G: 'G', B: 'B', Y: 'Y', RY: 'R-Y', BY: 'B-Y', C: 'R-Y | B-Y', Y0: 'Y', Y1: 'Y' };
  return m.seq.filter(g => g.t === 'scan').map(g => N[g.ch]).join(' ');
}
export function fmtTime(ms) {
  const s = ms / 1000;
  return s < 100 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}
