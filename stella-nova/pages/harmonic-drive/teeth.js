// ============================================================================
//  HARMONIC & CYCLOIDAL DRIVES  ·  teeth.js — a copy of differential/teeth.js (involute outline)
// ────────────────────────────────────────────────────────────────────────────
//  gears.js lofts these outlines into 3D teeth; tests.mjs places them in the
//  plane to check that mating teeth do not overlap. Angles in rad, sizes in
//  the gear's module m. o = { ha, hf, t, alpha }: addendum and dedendum in
//  modules, the tooth share of the pitch at the pitch circle, the pressure
//  angle (transverse; 20° when not given).
//
//  GREP MAP
//    export function halfTooth ... gap centre to tooth centre, as [r, θ]
//    export function toothPoly ... one tooth, gap centre to gap centre
//    export function outline ..... the whole gear, tooth k on φ = k·2π/N
// ============================================================================
const inv = a => Math.tan(a) - a;

export function halfTooth(Nv, m, o) {
  const al = o.alpha ?? 20 * Math.PI / 180;
  const R = Nv * m / 2, rb = R * Math.cos(al), ra = R + o.ha * m, rf = R - o.hf * m;
  const tp = (o.t ?? 0.48) * Math.PI / Nv;
  // below the base circle the flank is not involute: the mating tip sweeps
  // a trochoid there, so the tooth thins toward the root (an undercut) by
  // o.under (default 0.9) radians per unit of (rb − r)/r
  const und = o.under ?? 0.9;
  const h = r => r <= rb ? tp + inv(al) - und * (rb - r) / r : tp + inv(al) - inv(Math.acos(rb / r));
  const gap = Math.PI / Nv, nF = o.nF ?? 7, pts = [];
  const hMin = r => 0.08 * m / r;                   // a pointed tip keeps a 0.16 m land
  const hRoot = Math.min(h(rf), gap * 0.96);
  pts.push([rf, -gap]);
  pts.push([rf, -(hRoot + (gap - hRoot) * 0.3)]);
  pts.push([rf, -hRoot]);
  const nU = rb > rf ? 3 : 0;                       // points on the undercut
  for (let i = 1; i <= nU; i++) { const r = rf + (Math.min(rb, ra) - rf) * i / (nU + 1); pts.push([r, -Math.max(hMin(r), h(r))]); }
  const r0 = Math.max(rf, Math.min(rb, ra - 0.2 * m));
  for (let i = r0 > rf + 1e-9 ? 0 : 1; i <= nF; i++) {
    const r = r0 + (ra - r0) * (i / nF) ** 0.9;
    pts.push([r, -Math.max(hMin(r), h(r))]);
  }
  const hTip = Math.max(hMin(ra), h(ra));
  pts.push([ra, -hTip * 0.45]);
  pts.push([ra, 0]);
  return pts;
}
// one tooth from the left gap centre to the right gap centre, [r, θ]
export function toothPoly(Nv, m, o) {
  const half = halfTooth(Nv, m, o), out = half.slice();
  for (let i = half.length - 2; i >= 0; i--) out.push([half[i][0], -half[i][1]]);
  return out;
}
// the whole outline as [r, phi], tooth k centred on phi = k·2π/N. scale
// maps the virtual angle to the real one (1/cos γ for a bevel gear).
export function outline(N, Nv, m, o, scale = 1) {
  const half = halfTooth(Nv, m, o), out = [];
  for (let k = 0; k < N; k++) {
    const c = k * Math.PI * 2 / N;
    for (let i = 0; i < half.length - 1; i++) out.push([half[i][0], c + half[i][1] * scale]);
    out.push([half[half.length - 1][0], c]);
    for (let i = half.length - 2; i >= 1; i--) out.push([half[i][0], c - half[i][1] * scale]);
  }
  return out;
}
