// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/regulator.js — wall regulator
// ────────────────────────────────────────────────────────────────────────────
//  The spec side of one case type (no DOM, no THREE; tests.mjs runs it):
//    id, name, weight, clock, calibres, caseSpec, describe, palette, dims
//    (see types/wall.js), and layout(spec, own, pend) for the builder.
//  cases/regulator.js builds it: a tall glazed wall case (Vienna style,
//  1820-1900) with a crest, a long door, half columns and a drop finial.
//  A pendulum calibre hangs its own pendulum in the trunk; on a balance
//  calibre the trunk holds a pendulum that only swings for show, and its
//  card says so.
// ============================================================================
import { OWN_FACE } from './mantel.js';

export const REG_WOODS = { walnut: '#5e3c24', mahogany: '#6e2f22', oak: '#9a6c40', ebonised: '#1e1a18' };
const PEND = { deadbeat: { L: 994, bobR: 52, pivot: [0, 128, 52] } };

export function layout(spec, own, pend) {
  const dialR = OWN_FACE[spec.movement.calibre] ? own + 0.5 : Math.max(own * 1.3 + 6, 80), Wc = dialR * 2.6;
  const show = !pend;                                        // a pendulum for show
  const p = pend || { L: dialR * 3.2, bobR: dialR * 0.36, pivot: [0, -dialR * 0.25, 0] };
  const yb = p.pivot[1] - p.L - p.bobR - dialR * 0.35;       // trunk bottom
  return { dialR, Wc, show, p, yb, top: dialR * 1.32 + dialR * 0.42, bottom: yb - dialR * 0.62 };
}

export default {
  id: 'regulator', name: 'Wall regulator', weight: 0.9, clock: true,
  calibres: [['deadbeat', 7], ['lever', 1.5]],
  layout,
  caseSpec: (R) => ({
    wood: R.pick(Object.keys(REG_WOODS)),
    crest: R.weighted([['pediment', 3], ['arched', 2], ['carved', 2]]),
    mounts: R.weighted([['brass', 3], ['gilt', 2]]),
  }),
  describe: (spec) => { const c = spec.case; return [['Case', `${c.wood} Vienna case, ${c.crest} crest, glazed on three sides, ${c.mounts} fittings`]]; },
  palette: (spec) => ({ wood: { color: REG_WOODS[spec.case.wood], roughness: 0.38 }, polished: { color: spec.case.mounts === 'gilt' ? '#e2bd72' : '#d6a85c', roughness: 0.2 } }),
  dims: (spec, own) => {
    const L = layout(spec, own, PEND[spec.movement.calibre] || null);
    return { dialR: L.dialR, R: Math.max(L.top - L.bottom, L.Wc) * 0.54 };
  },
};
