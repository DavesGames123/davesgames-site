// ============================================================================
//  MUSHROOM DRAW  ·  engine/place.js — the place and size of each fruit body
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). No DOM. placeBodies(P, rnd, seed)
//  gives one record per body: position x, z, age, cap radius R, stem
//  radii and height H, lean, curve and a body seed. The first body is
//  at the origin with the params as given; the others scatter round it.
//
//  GREP MAP
//    grep -n 'export function placeBodies'   the bodies of a specimen
// ============================================================================
import { clamp, smoothstep, TAU } from '../geom.js';
import { MOREL } from './params.js';

// ── placeBodies ─────────────────────────────────────────────────────────────
export function placeBodies(P, rnd, seed) {
  const n = P.count, R0 = P.capR, out = [];
  const Rc = R0 * (0.25 + 0.5 * Math.sqrt(Math.max(0, n - 1))) * (0.5 + P.scatter);
  const special = P.profile >= MOREL;
  for (let i = 0; i < n; i++) {
    const s = i ? 1 - P.sizeVar * 0.6 * rnd() : 1;
    const age = i ? clamp(P.age + (rnd() * 2 - 1) * P.ageSpread * 0.75, 0, 1) : P.age;
    const ga = smoothstep(0, 0.6, age);
    const R = R0 * s * (special ? 0.6 + 0.4 * ga : 0.42 + 0.58 * ga);
    const k = 0.72 + 0.28 * ga;
    const rTop = P.stemTop * R0 * s * k, rBot = Math.max(P.stemBot * R0 * s * k, 1);
    const H = Math.max(P.stemH * R0 * s * (special ? 0.8 + 0.2 * ga : 0.42 + 0.58 * smoothstep(0, 0.7, age)) * (i ? 0.8 + 0.4 * rnd() : 1), rBot * 0.6, 2);
    let x = 0, z = 0;
    if (i) {
      let best = [Rc, 0];
      for (let t = 0; t < 60; t++) {
        const a = rnd() * TAU, rr2 = Rc * (0.3 + 0.7 * Math.sqrt(rnd()));
        const cx = rr2 * Math.cos(a), cz = rr2 * Math.sin(a) * 0.8;
        best = [cx, cz];
        let ok = true;
        for (const o of out) if (Math.hypot(o.x - cx, o.z - cz) < 1.9 * (o.rBot + rBot) + 0.08 * R0) { ok = false; break; }
        if (ok) break;
      }
      [x, z] = best;
    }
    const outward = n > 1 && Rc > 0 ? x / Rc : 0;
    out.push({ i, x, z, s, age, R: Math.max(R, rTop * 1.3), rTop, rBot, H,
      lean: clamp(P.lean + outward * 0.28 + (i ? (rnd() - 0.5) * 0.22 : 0), -0.7, 0.7),
      curve: P.curve + (i ? (rnd() - 0.5) * 0.3 : 0),
      seed: (Math.imul((seed ^ 0x2545F491) >>> 0, i + 1) + Math.imul(i + 1, 0x9E3779B1)) >>> 0 });
  }
  return out;
}
