// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · tests.mjs — page-level checks (node, no browser)
// ────────────────────────────────────────────────────────────────────────────
//  node stella-nova/pages/string-lab/tests.mjs
//  The engine, the 3D view, the playback panel and the saver have their own
//  test files. This file checks what sits between them:
//    floor   every colour map (and its reverse) keeps a resting string
//            above CIE L* L_FLOOR, and leaves bright entries unchanged
//  (the mathematics section adds its checks below)
// ════════════════════════════════════════════════════════════════════════════

import * as CM from '../ct-lab/colormaps/maps.js';
import { floorLut, L_FLOOR } from './stringlut.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// ── floor ──────────────────────────────────────────────────────────────────
{
  let worst = 101, worstId = '', changedBright = 0, maps = 0, restBefore = 101;
  for (const id of CM.ids()) for (const reverse of [false, true]) {
    maps++;
    const lut = CM.variant(id, { reverse }), f = floorLut(lut);
    for (let i = 0; i < 256; i++) {
      const o = i * 3, L = CM.cieL(f[o], f[o + 1], f[o + 2]);
      if (L < worst) { worst = L; worstId = `${id}${reverse ? ' (reversed)' : ''} entry ${i}`; }
      if (CM.cieL(lut[o], lut[o + 1], lut[o + 2]) >= L_FLOOR && (f[o] !== lut[o] || f[o + 1] !== lut[o + 1] || f[o + 2] !== lut[o + 2])) changedBright++;
    }
    if (!reverse) restBefore = Math.min(restBefore, CM.cieL(lut[0], lut[1], lut[2]));
  }
  ok(worst >= L_FLOOR, `floor: every entry of ${maps} maps (41 and their reverses) has L* >= ${L_FLOOR}`, `darkest ${worst.toFixed(1)} at ${worstId}`);
  ok(changedBright === 0, 'floor: entries already above the floor are unchanged', `${changedBright} changed`);
  const mag = CM.variant('magma'), m0 = CM.cieL(mag[0], mag[1], mag[2]), f0 = floorLut(mag);
  ok(m0 < 5 && CM.cieL(f0[0], f0[1], f0[2]) >= L_FLOOR, 'floor: magma at zero field was black and is now a visible core', `L* ${m0.toFixed(1)} -> ${CM.cieL(f0[0], f0[1], f0[2]).toFixed(1)}; darkest raw map start L* ${restBefore.toFixed(1)}`);
}

export { ok };
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
