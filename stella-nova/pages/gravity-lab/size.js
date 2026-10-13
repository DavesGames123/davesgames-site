// ============================================================================
//  GRAVITY LAB  ·  size.js — the drawn radius of a body (no DOM)
// ----------------------------------------------------------------------------
//  The drawn radius is small next to the orbits, so the orbits, the trails
//  and the close passes stay in view. The spec's rDraw is only an upper
//  value now.
//    cap        ext x (SIZE_MIN + (SIZE_MAX - SIZE_MIN) x (m / mMax)^(1/4)):
//               0.4% of the view extent for a massless probe, 1.4% for
//               the heaviest body (ext: the half width of the view)
//    drawn      min(rDraw, cap), but never less than the collision
//               radius R (nbody.js System.R), so a body never hits or
//               eats something in empty space. A body at true scale (the
//               planet of a ring run, a thrown tray item, whose drawn and
//               collision radius are the same number) keeps its size.
//  The renderer keeps a minimum of cam.p0.x px (main.js minBodyPx), so a
//  small body stays visible. The physics never reads this file.
//
//  grep -n targets: "export const SIZE_MIN", "export function sizeCap",
//  "export function drawRadius", "export function heaviest"
// ============================================================================
export const SIZE_MIN = 0.004, SIZE_MAX = 0.014;

// the size cap of a body of mass m (mMax: the heaviest live body)
export function sizeCap(m, mMax, ext) {
  const q = mMax > 0 && m > 0 ? Math.min(1, m / mMax) : 0;
  return ext * (SIZE_MIN + (SIZE_MAX - SIZE_MIN) * Math.sqrt(Math.sqrt(q)));
}
// rAuth: the spec's rDraw (times the growth of a merger); rPhys: the
// collision radius now
export function drawRadius(rAuth, m, mMax, ext, rPhys = 0) {
  const cap = sizeCap(m, mMax, ext);
  const r = isFinite(rAuth) && rAuth > 0 ? Math.min(rAuth, cap) : cap;
  return Math.max(r, isFinite(rPhys) && rPhys > 0 ? rPhys : 0);
}
// the heaviest live mass of a System (or of a spec's bodies)
export function heaviest(sys) {
  let M = 0;
  if (sys && sys.m) { for (let i = 0; i < sys.n; i++) if (sys.alive[i] && sys.m[i] > M) M = sys.m[i]; }
  else if (Array.isArray(sys)) for (const b of sys) if (b.m > M) M = b.m;
  return M;
}
