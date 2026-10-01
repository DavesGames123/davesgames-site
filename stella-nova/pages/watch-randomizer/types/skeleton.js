// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/skeleton.js — skeleton clock
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock, calibres, caseSpec, describe, palette, dims
//    (see types/wall.js), and layout(spec, own, pend) for the builder.
//  cases/skeleton.js builds it: pierced brass frames in a gothic arch with
//  scroll piercings, a chapter ring instead of a dial, on a base under a
//  glass dome (English and French skeleton clocks, 1820-1880).
// ============================================================================
export const BASES = { walnut: ['wood', '#6b4428'], rosewood: ['wood', '#4a2420'], ebonised: ['wood', '#1e1a18'], 'white marble': ['paint', '#e6e3dc'], 'black marble': ['paint', '#1d1d22'] };
const PEND = { anchor: { L: 110, bobR: 13, pivot: [0, 57, 24] } };

export function layout(spec, own, pend) {
  const dialR = own + 12, Wf = dialR * 2.3;
  const rho = Wf * 0.9, cx = rho - Wf / 2, archTop = Math.sqrt(rho * rho - cx * cx);
  let yb = -dialR * 1.75;
  if (pend) yb = Math.min(yb, pend.pivot[1] - pend.L - pend.bobR - 10);
  const rx = Wf / 2 + dialR * 0.35;
  return { dialR, Wf, rho, cx, archTop, yb, rx, baseH: dialR * 0.42, top: archTop + dialR * 0.55, bottom: yb - 4 - dialR * 0.42 - 6 };
}

export default {
  id: 'skeleton', name: 'Skeleton clock', weight: 0.8, clock: true,
  calibres: [['anchor', 5], ['lever', 3], ['verge', 1]],
  layout,
  caseSpec: (R) => ({
    frame: R.weighted([['gothic', 4], ['scroll', 3], ['lancet', 2]]),
    base: R.pick(Object.keys(BASES)),
    metal: R.weighted([['gilt brass', 4], ['brass', 3], ['silvered', 1]]),
    pattern: Math.floor(R() * 100000),
  }),
  describe: (spec) => { const c = spec.case; return [['Case', `${c.frame} pierced ${c.metal} frames, ${c.base} base, glass dome`]]; },
  palette: (spec) => {
    const [mat, col] = BASES[spec.case.base];
    const metal = { 'gilt brass': '#e2bd72', brass: '#d6a85c', silvered: '#dfe2e8' }[spec.case.metal];
    return { polished: { color: metal, roughness: 0.22 }, [mat]: { color: col, roughness: mat === 'paint' ? 0.12 : 0.45 } };
  },
  dims: (spec, own) => {
    const L = layout(spec, own, PEND[spec.movement.calibre] || null);
    return { dialR: L.dialR, R: Math.max(L.top - L.bottom, L.rx * 2) * 0.56 };
  },
};
