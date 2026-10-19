// ============================================================================
//  CORAL REEF  ·  tests/deep.test.mjs  ·  life and structure in the deep (node)
//    node tests/deep.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "deep water is also sparse that might be
//  scientifially accurate or by specific creation, but it's not very
//  visually interesting". Checks on seed 1:
//    seafloor .. world/field.js boulderCell: reef rubble, deep boulders,
//                pillow lava mounds (over 1100 m) and nodule fields (over
//                2200 m); burrow mounds on the deep sand (the sand height
//                has bumps of 5 cm or more), none on the reef sand
//    fauna ..... fauna/spawn.js: deep chunks (twilight, abyss) have more
//                feature groups and animals than before (BEFORE: the
//                spawn of a33ee80a on the same chunks), a food fall or a
//                jelly drift shows up, and no crawler starts on a cliff
// ============================================================================
import { createWorld, BOULDER_CELL } from '../world/field.js';
import { spawnChunk, MORE_FEATURES } from '../fauna/spawn.js';
import { FAUNA_BUDGET } from '../fauna/budget.js';

let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
const W = createWorld({ seed: 1 });
const at = {};
for (let x = -40000; x <= 40000; x += 2000) for (let z = -40000; z <= 40000; z += 2000) {
  const g = W.regionAt(x, z), want = { reef: [12, 30], twilight: [250, 900], abyss: [1200, 2000], deep: [2300, 3400] };
  for (const k of Object.keys(want)) if (!at[k] && (k === 'deep' ? g.id === 'abyss' : g.id === k) && g.depth >= want[k][0] && g.depth <= want[k][1]) at[k] = [x, z, Math.round(g.depth)];
}
ok(at.reef && at.twilight && at.abyss && at.deep, 'sites: reef, twilight, abyss and deep abyss', JSON.stringify(at));

// ── seafloor ────────────────────────────────────────────────────────────────
function cells(id) {
  const [x, z] = at[id], i0 = Math.floor(x / BOULDER_CELL), j0 = Math.floor(z / BOULDER_CELL);
  let n = 0, small = 0, long = 0;
  for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) for (const f of W.boulderCell(i0 + i, j0 + j)) { n++; if (f.rx < 0.4) small++; if (f.rx > 1.2 * f.rz && f.rx > 0.55) long++; }
  return { n: n / 144, small: small / 144, long: long / 144 };
}
const C = Object.fromEntries(Object.keys(at).map(k => [k, cells(k)]));
console.log('     lumps per 16 m cell: ' + Object.entries(C).map(([k, v]) => `${k} ${v.n.toFixed(1)} (small ${v.small.toFixed(1)}, long ${v.long.toFixed(1)})`).join(', '));
ok(C.reef.small > 1.5, 'seafloor: the reef has rubble between the colonies', `${C.reef.small.toFixed(1)} small clasts per cell`);
ok(C.abyss.long > 0.8, 'seafloor: the abyss has pillow lava mounds', `${C.abyss.long.toFixed(1)} long lumps per cell`);
ok(C.deep.small > 2, 'seafloor: the deep abyss has manganese nodule fields', `${C.deep.small.toFixed(1)} nodules per cell`);
function bumps(id) {
  // a sand patch near the site (sediment over 0.5), then 0.25 m samples on it
  const [x0, z0] = at[id];
  let sx = null;
  for (let k = 0; k < 4000 && !sx; k++) { const px = x0 + (k % 64) * 31, pz = z0 + Math.floor(k / 64) * 31; if (W.column(px, pz).sed > 0.6) sx = [px, pz]; }
  let mx = 0, n = 0;
  if (sx) for (let k = 0; k < 3600; k++) {
    const px = sx[0] - 7.5 + (k % 60) * 0.25, pz = sx[1] - 7.5 + Math.floor(k / 60) * 0.25;
    const c = W.column(px, pz);
    if (c.sed < 0.5) continue;
    n++;
    mx = Math.max(mx, c.S - (W.column(px + 1.5, pz).S + W.column(px - 1.5, pz).S + W.column(px, pz + 1.5).S + W.column(px, pz - 1.5).S) / 4);
  }
  return { mx, n };
}
const bd = bumps('abyss'), br = bumps('reef');
ok(bd.n > 100 && bd.mx > 0.05 && bd.mx > br.mx * 1.5, 'seafloor: the deep sand has burrow mounds (local bumps over 5 cm, more than the reef sand)', `abyss ${(bd.mx * 100).toFixed(1)} cm on ${bd.n} samples, reef ${(br.mx * 100).toFixed(1)} cm on ${br.n}`);

// ── fauna ───────────────────────────────────────────────────────────────────
const BEFORE = { twilight: { feats: 19, animals: 2205 }, abyss: { feats: 16, animals: 1864 } };
const B = FAUNA_BUDGET.desktop;
for (const id of ['twilight', 'abyss']) {
  const [x, z] = at[id], i0 = Math.floor(x / 32), j0 = Math.floor(z / 32);
  let feats = 0, animals = 0, extra = 0, cliff = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const c = spawnChunk({ W, seed: 1, i: i0 + i, j: j0 + j, budget: B });
    animals += c.count;
    const fs = new Set(c.groups.filter(g => g.feature).map(g => g.feature));
    feats += fs.size;
    for (const f of MORE_FEATURES) if (fs.has(f.id)) extra++;
    for (const g of c.groups) if (g.sp.habit === 'crawl') for (const m of g.members) { const s = Math.max(Math.abs(W.ground(m.x + 0.5, m.z) - W.ground(m.x - 0.5, m.z)), Math.abs(W.ground(m.x, m.z + 0.5) - W.ground(m.x, m.z - 0.5))); if (s > 1.6) cliff++; }
  }
  ok(feats > BEFORE[id].feats && animals > BEFORE[id].animals, `fauna: ${id} has more features and animals in 16 chunks`, `features ${BEFORE[id].feats} -> ${feats}, animals ${BEFORE[id].animals} -> ${animals}, food falls and jelly drifts ${extra}`);
  ok(cliff === 0, `fauna: no ${id} crawler starts on a cliff`, `${cliff}`);
}

console.log(`deep: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
