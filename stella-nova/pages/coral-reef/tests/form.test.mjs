// ============================================================================
//  CORAL REEF  ·  tests/form.test.mjs  ·  node checks of the colony form
// ----------------------------------------------------------------------------
//    node pages/coral-reef/tests/form.test.mjs
//  It exits with code 1 when a check fails. No browser.
//  The user said (2026-10-18): "real coral start with one root and branch
//  futher and further out, not multiple roots like a piece of grass".
//  Checks (reef.js):
//    root .......... one root per colony: every particle's parent chain
//                    ends at the seed of its colony (single colonies of
//                    each species and a populated reef on the real rock)
// ============================================================================
import { createRock } from '../rock/index.js';
import { createReef, SPECIES, SPECIES_IDS } from '../reef.js';

let fails = 0, passes = 0;
function ok(cond, name, info = '') {
  if (cond) { passes++; console.log(`ok   ${name}${info ? '  ' + info : ''}`); }
  else { fails++; console.log(`FAIL ${name}${info ? '  ' + info : ''}`); }
}
const f3 = v => (+v).toFixed(3);

// A flat rock (y < 0 is rock), as in tests/coral.test.mjs.
function flatRock(R0 = 30) {
  return {
    sdf: (x, y) => y, normal: () => [0, 1, 0], radius: R0,
    sand: { heightAt: () => -50 },
    bounds: { min: [-R0, -3, -R0], max: [R0, 8, R0] },
    sampleSurface: () => [], features: [],
  };
}
const site = (x, z) => ({ p: [x, 0, z], n: [0, 1, 0], exposure: 1, overhang: false });

// Roots of a colony (parent -1) and the particles whose parent chain does
// not end at the first particle (the seed) of the colony.
function rootsOf(R, c) {
  let roots = 0, orphan = 0;
  const seed = c.ids[0];
  for (const g of c.ids) {
    if (R.parent[g] < 0) roots++;
    let a = g;
    for (let s = 0; R.parent[a] >= 0 && s < 1e6; s++) a = R.parent[a];
    if (a !== seed || R.col[a] !== c.k) orphan++;
  }
  return { roots, orphan };
}

// ── root: single colonies ───────────────────────────────────────────────────
const single = {};
for (const id of SPECIES_IDS) {
  const R = createReef({ rock: flatRock(), seed: 21, quality: 'desktop', env: { strength: 0.3 } });
  const c = R.growColony(site(0, 0), id, { size: SPECIES[id].size[1] });
  R.growAll(Infinity, 2e6);
  single[id] = { R, c };
  const r = rootsOf(R, c);
  ok(r.roots === 1 && r.orphan === 0, `root: a ${id} colony grows from one root`, `${c.count} particles, ${r.roots} roots, ${r.orphan} not on the seed chain`);
}

// ── root: a reef on the real rock ───────────────────────────────────────────
{
  const rock = createRock({ seed: 3, radius: 30, quality: 'low' });
  const R = createReef({ rock, seed: 5, quality: 'phone' });
  R.populate({});
  R.growAll(20000, 4e6);
  let multi = 0, orphan = 0, maxRoots = 0;
  for (const c of R.colonies) {
    if (!c.count) continue;
    const r = rootsOf(R, c);
    if (r.roots > 1) multi++;
    orphan += r.orphan; maxRoots = Math.max(maxRoots, r.roots);
  }
  ok(multi === 0 && orphan === 0, 'root: every colony of a reef on the real rock has one root', `${R.colonies.length} colonies, ${R.count} particles, ${multi} with more roots (max ${maxRoots}), ${orphan} off the seed chain`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
