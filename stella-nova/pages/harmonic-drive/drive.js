// ============================================================================
//  HARMONIC & CYCLOIDAL DRIVES  ·  drive.js — geometry and motion (no DOM)
// ----------------------------------------------------------------------------
//  No DOM and no THREE: tests.mjs runs this file in Node. Units are mm and
//  rad, in the plane normal to the drive axis, angles counter-clockwise.
//
//  STRAIN WAVE (harmonic drive). The circular spline (CS, internal teeth,
//  Nc) is fixed. The flexspline (FS, external teeth, Nf = Nc - 2) is a thin
//  cup; the elliptical wave generator (WG, input, angle th) pushes it out
//  by d at the two ends of the major axis, where its teeth engage the CS.
//  Each WG turn shifts the FS by Nc - Nf teeth against the CS, backward:
//      out = -th (Nc - Nf) / Nf           ratio Nf / (Nc - Nf) = 15
//  A point of the FS at its own angle phi sits at world angle phi + out
//  and radius r + d cos 2 (phi + out - th).
//  Phase: CS gap k at 2 pi k / Nc, FS tooth k at 2 pi k / Nf (FS frame).
//  Whenever th = 2 pi j / Nc a FS tooth and a CS gap are both on the major
//  axis (tests.mjs checks it).
//
//  CYCLOIDAL. Np ring pins (radius Rr) sit fixed on a circle R. The input
//  eccentric (angle th, throw E) carries a disc with Np - 1 lobes; the pins
//  make it turn backward:  disc = -th / (Np - 1)        ratio Np - 1 = 9
//  The disc outline is the path of a pin centre seen from the disc (an
//  epitrochoid), moved in by Rr along its normal. A second disc runs at
//  th + pi (balance). Output pins on a flange (at disc speed, on the axis)
//  pass through holes of radius rp + E in each disc.
//
//  GREP MAP
//    export const UNITS ......... the two units and their numbers
//    export function wave ....... FS deflection and angles at input th
//    export function pinPath .... a pin centre in the disc frame
//    export function discProfile  the cycloid disc outline
//    export function cycloPose .. disc centre and angle for disc k
// ============================================================================

export const TAU = Math.PI * 2;

// The numbers are for teaching, not for a real unit. A real strain wave
// gear has 100 to 200 teeth and a wave of about one module, and a real
// cycloid disc a throw of a few mm. At those sizes the page showed a
// smooth ring and no visible motion. Here the teeth are large (module 3,
// 30 teeth), the wave is 3 mm, and the cycloid has 9 lobes 10 mm deep.
// The proportions stay true: d = m (Nc - Nf) / 2, and E Np / R = 0.83 < 1.
export const UNITS = [
  { id: 'harmonic', name: 'Strain wave', kind: 'Harmonic drive · 15 : 1', m: 3, Nf: 30, Nc: 32, d: 3 },
  { id: 'cycloidal', name: 'Cycloidal', kind: 'Two discs · 9 : 1', Np: 10, R: 60, Rr: 6, E: 5, nOut: 6, rOut: 32, rp: 5 },
];
export const unit = id => UNITS.find(u => u.id === id);

// ── strain wave ─────────────────────────────────────────────────────────────
export function wave(u, th) {
  const out = -th * (u.Nc - u.Nf) / u.Nf;
  return { th, out, ratio: u.Nf / (u.Nc - u.Nf), defl: phi => u.d * Math.cos(2 * (phi + out - th)) };
}

// ── cycloidal ───────────────────────────────────────────────────────────────
export function cycloPose(u, th, k = 0) {
  const t = th + k * Math.PI;
  return { cx: u.E * Math.cos(t), cy: u.E * Math.sin(t), rot: -t / (u.Np - 1) };
}
// pin 0 centre in the frame of disc 0 at input angle t
export function pinPath(u, t) {
  const P = cycloPose(u, t), x = u.R - P.cx, y = -P.cy, c = Math.cos(-P.rot), s = Math.sin(-P.rot);
  return [x * c - y * s, x * s + y * c];
}
// The pin centre runs once round the disc frame while t runs (Np - 1) turns
// ... the outline is that closed curve moved in by Rr. N points, CCW.
export function discProfile(u, N = 1440) {
  const T = TAU * (u.Np - 1), pts = [];
  for (let i = 0; i < N; i++) pts.push(pinPath(u, T * i / N));
  // make it counter-clockwise
  let area = 0; for (let i = 0; i < N; i++) { const a = pts[i], b = pts[(i + 1) % N]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) pts.reverse();
  return pts.map((p, i) => {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty); tx /= l; ty /= l;
    return [p[0] - u.Rr * ty, p[1] + u.Rr * tx];
  });
}
// output hole centres of disc k, in its own frame: they line up with the
// output pins (at angle 2 pi j / nOut + flange) once the disc turns
export function holeAngles(u, k) {
  const off = k ? Math.PI / (u.Np - 1) : 0;     // disc 1 runs pi ahead
  return Array.from({ length: u.nOut }, (_, j) => TAU * j / u.nOut + off);
}
