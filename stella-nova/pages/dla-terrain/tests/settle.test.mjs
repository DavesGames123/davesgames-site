// tests/settle.test.mjs — CITIES: settlement siting, roads, layout (node, no GPU).
// Run alone: node stella-nova/pages/dla-terrain/tests/settle.test.mjs
import * as L from '../../../lib/dla-terrain.js';
import { siteSettlements, classify, MAX_SLOPE, MOUNTAIN_GRADE, riverIndex, countsFor } from '../world/settle-place.js';
import { buildSettlements, INST_FLOATS } from '../world/settle-layout.js';
let pass = 0, fail = 0;
const ok = (c, name, x = '') => { if (c) pass++; else fail++; console.log(`${c ? 'ok' : 'not ok'} ${pass + fail} settle: ${name} ${x}`); };
const t = await L.generateTerrain({ ...L.PRESETS['river-delta'].opts, n: 256, seed: 1 });
const A = siteSettlements(t, { mode: 'many', seed: 3 });
ok(A.sites.length > 5, 'many gives sites', `${A.sites.length}`);
ok(A.sites.filter((s) => s.kind === 'city').length <= 2, 'at most two cities');
ok(A.sites.every((s) => { const c = classify(t, s.x, s.z); return !c.water && c.slope < MAX_SLOPE * 1.2; }), 'no site in water or on a steep slope');
const nearW = A.sites.filter((s) => s.why.river || s.why.coast || s.why.lake || s.why.confluence || s.why.harbour).length;
ok(nearW >= 0.7 * A.sites.length, 'most sites near rivers, coasts or lakes', `${nearW}/${A.sites.length}`);
ok(JSON.stringify(siteSettlements(t, { mode: 'many', seed: 3 }).sites) === JSON.stringify(A.sites), 'same seed, same sites');
ok(JSON.stringify(siteSettlements(t, { mode: 'many', seed: 4 }).sites) !== JSON.stringify(A.sites), 'another seed, other sites');
ok(siteSettlements(t, { mode: 'off' }).sites.length === 0, 'off gives nothing');
ok(countsFor('many', 'phone').city === 0 && countsFor('many', 'phone-min').town === 0, 'phones: no cities, fewer towns');
// roads: grades over 40 m windows off the bridges; river crossings only on decks
const rix = riverIndex(t);
let len = 0, over = 0, wetOff = 0;
for (const rd of A.roads) {
  const p = rd.pts, n = p.length / 3, on = new Uint8Array(n);
  for (const [a, b] of rd.bridges) for (let k = Math.max(0, a - 2); k <= Math.min(n - 1, b + 2); k++) on[k] = 1;
  for (let k = 0; k < n; k++) {
    const r = rix.near(p[3 * k], p[3 * k + 2]);
    if (r && r.d < 0 && !on[k]) wetOff++;
    if (k < 4 || on[k] || on[k - 4]) continue;
    const d = Math.hypot(p[3 * k] - p[3 * k - 12], p[3 * k + 2] - p[3 * k - 10]);
    len += d; if (Math.abs(p[3 * k + 1] - p[3 * k - 11]) / d > MOUNTAIN_GRADE + 0.05) over += d;
  }
}
ok(A.roads.length > 0 && over / len < 0.02, 'roads avoid steep slopes', `${(over / len * 100).toFixed(2)} % over ${MOUNTAIN_GRADE + 0.05}`);
ok(wetOff === 0, 'roads cross rivers only on bridges', `${wetOff} wet points off a deck`);
// layout and profile counts
const D = buildSettlements(t, { mode: 'many', seed: 3, profile: 'desktop' });
const Ph = buildSettlements(t, { mode: 'many', seed: 3, profile: 'phone' });
ok(D.nInst > 500 && D.inst.length === D.nInst * INST_FLOATS && D.inst.every(Number.isFinite), 'desktop layout: finite instances', `${D.nInst}`);
ok(Ph.nInst < D.nInst && Ph.nInst <= 2500 + 200, 'phone layout: fewer instances', `${Ph.nInst}`);
let wetB = 0;
for (let i = 0; i < D.nInst; i++) { const o = i * INST_FLOATS; if (D.inst[o + 9] !== 0 && classify(t, D.inst[o], D.inst[o + 2]).water) wetB++; }
ok(wetB === 0, 'no building in water (piers aside)', `${wetB}`);
ok(JSON.stringify(Array.from(buildSettlements(t, { mode: 'many', seed: 3 }).inst.slice(0, 600))) === JSON.stringify(Array.from(D.inst.slice(0, 600))), 'layout deterministic per seed');
console.log(`# settle: ${pass} ok, ${fail} not ok`);
process.exit(fail ? 1 : 0);
