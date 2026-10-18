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
//    apex .......... the tip share: new particles whose parent was a tip
//                    or the particle under a tip (subtree height <= 1 at
//                    the join), over 0.94 for the branching species (the
//                    old code: 0.83 to 0.93)
//    continuity .... each particle is at most 1.05 spacings from its
//                    parent (the cones touch: no loose groups)
//    fan net ....... the sea fan joins its own branches (bridges in its
//                    plane, at most net x spacing long), and its particles
//                    stay in its plane in every height decile
//    surface ....... the fine mesh of a plain branch part is a smooth tube:
//                    the mean |normal . branch axis| is under 0.08
//                    (staghorn), 0.06 (fan), 0.105 (finger); a bead of the
//                    smooth minimum at each particle made it 0.13, 0.068
//                    and 0.118 on the same colonies
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

// The share of joins whose parent had a subtree height <= 1 (a tip, or
// the particle under a tip) at the time of the join. Particle ids are in
// join order, so a replay gives the heights at each join.
function tipShare(R, c) {
  const H = new Map(); let n = 0, apical = 0;
  for (const g of c.ids) {
    const p = R.parent[g]; if (p < 0) continue;
    n++; if ((H.get(p) || 0) <= 1) apical++;
    for (let a = p, h = 1; a >= 0 && (H.get(a) || 0) < h; a = R.parent[a], h++) H.set(a, h);
  }
  return apical / Math.max(1, n);
}

// ── apex, continuity ────────────────────────────────────────────────────────
const BRANCHING = ['staghorn', 'fan', 'table', 'finger'];
for (const id of SPECIES_IDS) {
  const { R, c } = single[id];
  if (BRANCHING.includes(id)) {
    const t = tipShare(R, c);
    ok(t > 0.94, `apex: a ${id} colony grows at its tips`, `tip share ${f3(t)}, ${R.forks ?? '-'} forks in ${c.count} particles`);
  }
  const sp = R.params[id].particleSpacing;
  let worst = 0;
  for (const g of c.ids) {
    const p = R.parent[g]; if (p < 0) continue;
    worst = Math.max(worst, Math.hypot(R.px[g] - R.px[p], R.py[g] - R.py[p], R.pz[g] - R.pz[p]) / sp);
  }
  ok(worst <= 1.05, `continuity: every ${id} particle touches its parent`, `largest gap ${f3(worst)} spacings`);
}

// ── fan net and plane ───────────────────────────────────────────────────────
{
  const { R, c } = single.fan, f = c.plane, sp = R.params.fan.particleSpacing, net = (SPECIES.fan.apex || {}).net || 0;
  const off = g => (R.px[g] - c.base[0]) * f[0] + (R.pz[g] - c.base[2]) * f[1];
  let nb = 0, longest = 0, outPlane = 0;
  for (const [g, j] of R.bridges) {
    if (R.col[g] !== c.k || R.col[j] !== c.k) continue;
    nb++;
    longest = Math.max(longest, Math.hypot(R.px[g] - R.px[j], R.py[g] - R.py[j], R.pz[g] - R.pz[j]) / sp);
    outPlane = Math.max(outPlane, Math.abs(off(g)), Math.abs(off(j)));
  }
  ok(nb > 0.05 * c.count && longest <= net + 1e-6 && outPlane < 1e-4, 'fan net: the sea fan joins its near branches in its plane (a net)', `${nb} bridges in ${c.count} particles, longest ${f3(longest)} spacings (limit ${net}), ${f3(outPlane)} m off the plane`);
  let H = 0; for (const g of c.ids) H = Math.max(H, R.py[g] - c.base[1]);
  const dec = Array.from({ length: 10 }, () => [0, 0]);
  for (const g of c.ids) { const k = Math.max(0, Math.min(9, Math.floor(10 * (R.py[g] - c.base[1]) / H))); dec[k][0] = Math.max(dec[k][0], Math.abs(off(g))); dec[k][1]++; }
  ok(dec.every(d => d[0] < 0.005), 'fan net: the fan particles stay in its plane up to the top', `largest offset by height decile (mm): ${dec.map(d => (d[0] * 1000).toFixed(1)).join(' ')}; top decile ${dec[9][1]} particles`);
}

// ── surface: no bead at each particle ───────────────────────────────────────
// The fine mesh of a plain branch part (the particle and its parent each
// have one child) should be a smooth tapered tube: its normals are nearly
// square to the branch axis. A bead of the smooth minimum at each joint
// tilts them along the axis. Measure: the mean |n . axis| of those
// vertices (0 on a cylinder; the taper of the pipe rule gives a little).
{
  const { createCoralMesher } = await import('../coral-sdf.js');
  const { colonyInfo } = await import('../reef.js');
  for (const id of ['staghorn', 'fan', 'finger']) {
    const { R, c } = single[id];
    const M = createCoralMesher({ fine: R.fine, radius: R.radius, polyps: 0, lod: false });
    M.addColony(colonyInfo(c));
    for (let g = 0; g < R.count; g++) M.add(g, R.parent[g], R.px[g], R.py[g], R.pz[g], R.col[g]);
    const list = M.meshAll();
    const F = [...M.fields.values()][0], S = F.SM;
    const kids = new Int32Array(R.count); for (let g = 0; g < R.count; g++) if (R.parent[g] >= 0) kids[R.parent[g]]++;
    let s = 0, n = 0;
    for (const m of list) for (let v = 0; v < m.gids.length; v++) {
      const g = m.gids[v]; if (g < 0) continue;
      const p = R.parent[g]; if (p < 0 || kids[g] !== 1 || kids[p] !== 1) continue;
      const i = F.localOf.get(g), q = F.localOf.get(p); if (i === undefined || q === undefined) continue;
      const ax = S[i * 3] - S[q * 3], ay = S[i * 3 + 1] - S[q * 3 + 1], az = S[i * 3 + 2] - S[q * 3 + 2], l = Math.hypot(ax, ay, az) || 1;
      s += Math.abs((m.normals[v * 3] * ax + m.normals[v * 3 + 1] * ay + m.normals[v * 3 + 2] * az) / l); n++;
    }
    const lim = { staghorn: 0.08, fan: 0.06, finger: 0.105 }[id];
    ok(n > 1000 && s / n < lim, `surface: ${id} branches are smooth tubes, no bead at each particle`, `mean |n . axis| ${f3(s / n)} over ${n} vertices (limit ${lim})`);
  }
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
