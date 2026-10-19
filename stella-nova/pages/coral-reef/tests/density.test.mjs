// ============================================================================
//  CORAL REEF  ·  tests/density.test.mjs  ·  coral density and clumps (node)
//    node tests/density.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "coral and object desinty is not high enough
//  in the reef and the deep sea". Checks of world/corals.js planColonies on
//  a block of 4 x 4 chunks in the reef (12 to 30 m), the twilight zone and
//  the abyss of seed 1:
//    density ... colonies per km2 for each profile, over the old plan
//                (BEFORE: measured with the plan of b413a29c, desktop)
//    clumps .... the Clark-Evans ratio R (mean nearest-neighbour distance
//                over the one of a random scatter of the same density):
//                R < CLUMP_MAX is a clumped pattern (1 is random)
//    profiles .. the phones plan fewer colonies, but at least PHONE_MIN of
//                the desktop count; no chunk plans more than its budget
//    cost ...... one grown reef chunk per profile: particles in the budget,
//                coarse triangles under the memory model of world/stream.js
//                (BYTES.coarseTrisPerParticle for each budget particle)
//    meadows ... deep chunks put sea pens, sea lilies or Venus baskets on
//                the sand
// ============================================================================
import { createWorld } from '../world/field.js';
import { planColonies, CORAL_BUDGET, growChunkSync, gardenAt } from '../world/corals.js';
import { BYTES } from '../world/stream.js';
import { CH } from '../world/mesh.js';

let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }

// colonies per km2 of the old plan (desktop, seed 1, the same blocks)
const BEFORE = { reef: 3967, twilight: 916, abyss: 1099 };
const CLUMP_MAX = 0.8, PHONE_MIN = 0.3, N = 4;
const W = createWorld({ seed: 1 });
const at = {};
for (let x = -40000; x <= 40000 && Object.keys(at).length < 3; x += 2000) for (let z = -40000; z <= 40000; z += 2000) {
  const g = W.regionAt(x, z), want = { reef: [12, 30], twilight: [250, 900], abyss: [1200, 3200] }[g.id];
  if (want && !at[g.id] && g.depth >= want[0] && g.depth <= want[1]) at[g.id] = [x, z];
}
ok(at.reef && at.twilight && at.abyss, 'regions: a reef, a twilight and an abyss block', JSON.stringify(at));

function block(id, prof) {
  const [x, z] = at[id], ci0 = Math.floor(x / CH), cj0 = Math.floor(z / CH), pts = [], ids = new Set();
  let n = 0, over = 0, sand = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const pl = planColonies(W, ci0 + i, cj0 + j, CORAL_BUDGET[prof], 1);
    n += pl.sites.length; if (pl.sites.length > CORAL_BUDGET[prof].colonies) over++;
    for (const s of pl.sites) { pts.push([s.site.p[0] + pl.cx, s.site.p[2] + pl.cz]); ids.add(s.id); if (s.id === 'seapen' || s.id === 'crinoid' || s.id === 'venus') sand++; }
  }
  const area = N * N * CH * CH;
  let s = 0;
  for (const p of pts) { let m = Infinity; for (const q of pts) if (q !== p) m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1])); s += m; }
  const R = pts.length > 1 ? (s / pts.length) / (0.5 / Math.sqrt(pts.length / area)) : NaN;
  return { n, km2: Math.round(n / area * 1e6), R, over, species: ids.size, sand };
}

const out = {};
for (const prof of ['desktop', 'laptop-low', 'phone', 'phone-min']) for (const id of ['reef', 'twilight', 'abyss']) out[prof + ':' + id] = block(id, prof);
for (const id of ['reef', 'twilight', 'abyss']) {
  const d = out['desktop:' + id];
  ok(d.km2 >= BEFORE[id] * 3, `density: ${id} desktop has at least 3 x the old colonies per km2`, `before ${BEFORE[id]}, after ${d.km2} per km2 (${d.n} in ${N * N} chunks, ${d.species} species)`);
  ok(d.R < CLUMP_MAX, `clumps: ${id} colonies are clumped (Clark-Evans R < ${CLUMP_MAX})`, `R ${d.R.toFixed(2)}`);
  for (const prof of ['laptop-low', 'phone', 'phone-min']) {
    const p = out[prof + ':' + id];
    ok(p.over === 0 && p.km2 <= d.km2 && p.km2 >= d.km2 * PHONE_MIN * (prof === 'phone-min' ? 0.75 : 1), `profiles: ${id} ${prof} plans fewer colonies but stays rich`, `${p.km2} per km2 (R ${p.R.toFixed(2)})`);
  }
}
ok(out['desktop:reef'].species >= 8, 'mix: the reef block has many species', `${out['desktop:reef'].species}`);
ok(out['desktop:twilight'].sand + out['desktop:abyss'].sand > 0, 'meadows: deep sand gets sea pens, sea lilies or Venus baskets', `${out['desktop:twilight'].sand + out['desktop:abyss'].sand} colonies`);
let gmin = 1, gmax = 0;
for (let k = 0; k < 400; k++) { const g = gardenAt(k * 37.3, k * 91.7, 1); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
ok(gmax - gmin > 0.4, 'gardens: the garden noise has cores and gaps', `${gmin.toFixed(2)} .. ${gmax.toFixed(2)}`);

// one grown reef chunk per profile: the cost
{
  const [x, z] = at.reef, ci = Math.floor(x / CH), cj = Math.floor(z / CH);
  for (const prof of ['desktop', 'phone-min']) {
    const B = CORAL_BUDGET[prof], t0 = Date.now(), r = growChunkSync(W, ci, cj, B, { seed: 1 });
    const lim = B.particles * BYTES.coarseTrisPerParticle;
    ok(r.count <= B.particles && r.stats.tris <= lim && r.colonies.length > 0, `cost: a ${prof} reef chunk is in its budget`, `${r.colonies.length} colonies, ${r.count} particles <= ${B.particles}, ${r.stats.tris} tris <= ${lim}, ${((r.stats.tris * BYTES.coralTri + r.count * BYTES.slot) / 1048576).toFixed(1)} MB, ${Date.now() - t0} ms`);
  }
}

console.log(`density: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
