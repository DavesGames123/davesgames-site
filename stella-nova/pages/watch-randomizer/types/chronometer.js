// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/chronometer.js — marine chronometer box
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock, calibres, caseSpec, describe, palette, dims
//    (see types/wall.js), and layout(spec, own) for the builder.
//  cases/chronometer.js builds it: a brass bowl hung in gimbals inside a
//  brass-bound wooden box, a glazed inner lid and a solid outer lid. The
//  dial looks up out of the box (toward -z here, at the viewer).
// ============================================================================
export const BOX_WOODS = { mahogany: '#6e2f22', rosewood: '#4a2420', walnut: '#5e3c24', teak: '#8a5a32' };

export function layout(spec, own) {
  const dialR = own + 5, bowlR = dialR + 6, ringR = bowlR + 7, wall = 8;
  const W = 2 * (ringR + 13) + 2 * wall;
  return { dialR, bowlR, ringR, wall, W, D: W * 0.86 };
}

export default {
  id: 'chronometer', name: 'Marine chronometer', weight: 0.8, clock: true,
  calibres: [['detent', 8], ['lever', 2]],
  layout,
  caseSpec: (R) => ({
    wood: R.pick(Object.keys(BOX_WOODS)),
    days: R.weighted([['two-day', 4], ['eight-day', 1]]),
    plate: R.weighted([['brass', 4], ['silvered', 1]]),
  }),
  describe: (spec) => { const c = spec.case; return [['Case', `${c.wood} box, brass-bound, gimballed ${c.plate} bowl, ${c.days}`]]; },
  palette: (spec) => ({ wood: { color: BOX_WOODS[spec.case.wood], roughness: 0.42 }, polished: { color: spec.case.plate === 'silvered' ? '#dfe2e8' : '#d9ac5c', roughness: 0.18 } }),
  dims: (spec, own) => { const L = layout(spec, own); return { dialR: L.dialR, R: L.W * 1.05 }; },
};
