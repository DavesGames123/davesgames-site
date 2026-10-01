// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/index.js — the case builder for each type
// ────────────────────────────────────────────────────────────────────────────
//  One module per type id (types/<id>.js holds the matching spec side).
//  A new type adds its builder here.
// ============================================================================
import * as pocket from './pocket.js';
import * as wrist from './wrist.js';
import * as wall from './wall.js';
import * as alarm from './alarm.js';
import * as carriage from './carriage.js';

export const BUILDERS = {
  pocket: pocket.build, wrist: wrist.build, wall: wall.build, alarm: alarm.build,
  carriage: carriage.build,
};

// the case for a spec: zF is the dial face plane, zB the back of the
// movement (a clock with a hidden rotor sits a little shallower)
export function buildCase(B, spec, cal, dims) {
  const zF = cal.CAL.z.dialLo, zB = cal.zRange[1] + (spec.movement.calibre === 'automatic' && dims.clock ? -2.2 : 0.8);
  return BUILDERS[spec.type](B, spec, cal, dims, zF, zB);
}
