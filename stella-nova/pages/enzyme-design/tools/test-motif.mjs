// ============================================================================
//  TEST-MOTIF  ·  checks the three catalytic motifs (Node, no DOM)
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/enzyme-design/tools/test-motif.mjs
//
//  The test does its own geometry. It never asks motif.js what a distance
//  or an angle is: it reads the coordinates and measures them again. If the
//  two answers do not agree, one of them is wrong.
//
//  Per motif the test:
//    1. builds it two times and compares every number (determinism),
//    2. checks every coordinate is a finite number,
//    3. checks no two atoms are closer than 0.9 A (nothing sits on top of
//       anything else), and reports the closest pair that is not bonded,
//    4. checks every ligand bond is 1.1 to 1.8 A, and every metal
//       coordination bond is 1.8 to 2.6 A,
//    5. checks every geometry entry: the references exist, the kind matches
//       the number of references, the tolerance is honest, the entry
//       measures what its kind says, and the built motif passes its own
//       ideal,
//    6. checks every atom named in 'tip' exists,
//    7. checks the ligand fits the design.js limits and that motif_str
//       parses and plans a chain,
//    8. prints the atom count, the bounding box and every measurement.
//  It also checks the API shape and that no module uses Math.random.
//  The exit code is 1 if one check fails.
//
//  grep -n targets
//    own geometry ..... "function measureHere"
//    per motif ........ "function checkMotif"
//    api shape ........ "console.log('api')"
// ============================================================================

import { readFileSync } from 'node:fs';
import { MOTIFS, motifById, atomAt, measure } from '../motif.js';
import { LIMITS, parseMotifStr, planChain, rng, validate } from '../design.js';
import { CAMPAIGNS } from '../data.js';

let failed = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'pass' : 'FAIL'}  ${msg}`); if (!cond) failed++; };
const f2 = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);

// ---------------------------------------------------------- own geometry
//  Plain maths, written here so the test does not trust motif.js.
function measureHere(pts, kind) {
  if (kind === 'distance') {
    const [a, b] = pts;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  const [a, b, c] = pts;
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const lu = Math.hypot(...u), lv = Math.hypot(...v);
  const cosang = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv);
  return Math.acos(Math.max(-1, Math.min(1, cosang))) * 180 / Math.PI;
}

// Every atom of a motif, with a tag and the group it belongs to.
function flatten(m) {
  const out = [];
  m.residues.forEach((r, i) => r.atoms.forEach((a) => out.push({ tag: `res${i}:${a.name}`, g: i, p: [a.x, a.y, a.z], el: a.el })));
  m.ligand.atoms.forEach((a) => out.push({ tag: `lig:${a.name}`, g: -1, p: [a.x, a.y, a.z], el: a.el }));
  return out;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// --------------------------------------------------------------- api shape
console.log('api');
ok(Array.isArray(MOTIFS) && MOTIFS.length === 3, `MOTIFS has 3 entries (${MOTIFS.length})`);
ok(MOTIFS.map((e) => e.id).join() === 'kemp,triad,haem', `ids are kemp, triad, haem (${MOTIFS.map((e) => e.id).join()})`);
const campIds = new Set(CAMPAIGNS.map((c) => c.id));
for (const e of MOTIFS) {
  ok(typeof e.label === 'string' && e.label.length > 3, `${e.id}: label`);
  ok(typeof e.chemistry === 'string' && e.chemistry.length > 20, `${e.id}: chemistry`);
  ok(typeof e.blurb === 'string' && /idealis/i.test(e.blurb), `${e.id}: blurb says the geometry is idealised`);
  ok(e.campaignId === null || campIds.has(e.campaignId), `${e.id}: campaignId '${e.campaignId}' is in data.js CAMPAIGNS`);
  ok(typeof e.build === 'function', `${e.id}: build is a function`);
  ok(motifById(e.id).id === e.id, `motifById('${e.id}')`);
}
ok(motifById('nope') === null, 'motifById of an unknown id is null');

// No module on this page may use Math.random.
for (const f of ['motif.js', 'design.js', 'data.js']) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const hits = src.split('\n').filter((l) => /Math\.random/.test(l) && !/^\s*\/\//.test(l));
  ok(f === 'design.js' ? hits.every((l) => /rand = Math\.random/.test(l)) : hits.length === 0,
    `${f}: no live Math.random (${hits.length} line${hits.length === 1 ? '' : 's'})`);
}

// ----------------------------------------------------------- per motif
function checkMotif(entry) {
  console.log(`\n${entry.id}  ${entry.label}`);
  const t0 = performance.now();
  const m = entry.build();
  const ms = performance.now() - t0;
  const again = entry.build();

  // 1. determinism
  ok(JSON.stringify(m) === JSON.stringify(again), 'two build() calls give the same numbers');

  // 2. finite coordinates
  const all = flatten(m);
  const bad = all.filter((a) => !a.p.every(Number.isFinite));
  ok(bad.length === 0, `every coordinate is finite (${all.length} atoms${bad.length ? ', bad: ' + bad[0].tag : ''})`);

  // 3. nothing on top of anything else
  const ligBonded = new Set();
  for (const [i, j] of m.ligand.bonds) ligBonded.add(pairKey(`lig:${m.ligand.atoms[i].name}`, `lig:${m.ligand.atoms[j].name}`));
  for (const [i, j] of (m.ligand.coord || [])) ligBonded.add(pairKey(`lig:${m.ligand.atoms[i].name}`, `lig:${m.ligand.atoms[j].name}`));
  let near = [Infinity, '', ''], crossMin = [Infinity, '', ''];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const d = measureHere([all[i].p, all[j].p], 'distance');
      if (d < near[0]) near = [d, all[i].tag, all[j].tag];
      if (all[i].g !== all[j].g && !ligBonded.has(pairKey(all[i].tag, all[j].tag)) && d < crossMin[0]) {
        crossMin = [d, all[i].tag, all[j].tag];
      }
    }
  }
  ok(near[0] >= 0.9, `closest pair of atoms is ${near[0].toFixed(3)} A, 0.9 A or more (${near[1]} to ${near[2]})`);
  console.log(`        closest pair between two groups: ${crossMin[0].toFixed(3)} A  ${crossMin[1]} to ${crossMin[2]}`);

  // 4. bond lengths
  const lb = m.ligand.bonds.map(([i, j]) => measureHere([[m.ligand.atoms[i].x, m.ligand.atoms[i].y, m.ligand.atoms[i].z],
    [m.ligand.atoms[j].x, m.ligand.atoms[j].y, m.ligand.atoms[j].z]], 'distance'));
  ok(lb.length > 0 && lb.every((d) => d >= 1.1 && d <= 1.8),
    `${lb.length} ligand bonds, ${Math.min(...lb).toFixed(3)} to ${Math.max(...lb).toFixed(3)} A, all inside 1.1 to 1.8`);
  const lc = (m.ligand.coord || []).map(([i, j]) => measureHere([[m.ligand.atoms[i].x, m.ligand.atoms[i].y, m.ligand.atoms[i].z],
    [m.ligand.atoms[j].x, m.ligand.atoms[j].y, m.ligand.atoms[j].z]], 'distance'));
  if (lc.length) {
    ok(lc.every((d) => d >= 1.8 && d <= 2.6),
      `${lc.length} coordination bonds, ${Math.min(...lc).toFixed(3)} to ${Math.max(...lc).toFixed(3)} A, all inside 1.8 to 2.6`);
  }

  // 5. tip atoms
  let tipOk = true, tipN = 0;
  for (const r of m.residues) {
    ok(typeof r.code === 'string' && r.code.length === 1 && typeof r.name === 'string' && typeof r.chain === 'string' && Number.isInteger(r.resId),
      `${r.chain}${r.resId} ${r.name} (${r.code}): residue fields`);
    for (const t of r.tip) { tipN++; if (!r.atoms.some((a) => a.name === t)) { tipOk = false; console.log(`        missing tip atom ${r.name} ${t}`); } }
  }
  ok(tipOk && tipN > 0, `every tip atom exists (${tipN} across ${m.residues.length} residues)`);

  // 6. the design.js limits and the motif language
  ok(m.ligand.atoms.length <= LIMITS.maxLigandAtoms, `ligand has ${m.ligand.atoms.length} atoms, limit ${LIMITS.maxLigandAtoms}`);
  ok(m.ligand.atoms.every((a) => typeof a.el === 'string' && a.el.length > 0), 'every ligand atom has an element');
  if (entry.motifStr) {
    const rand = rng(7);
    const parsed = parseMotifStr(entry.motifStr, rand);
    const motifRes = parsed.chain.filter((s) => s.kind === 'motif').reduce((n, s) => n + (s.to - s.from + 1), 0);
    ok(motifRes === m.residues.length, `motif_str holds ${motifRes} fixed residues, the motif has ${m.residues.length}`);
    const plan = planChain(parsed, { seqLength: entry.seqLength, rand });
    ok(!plan.missed && plan.total >= LIMITS.minLen && plan.total <= LIMITS.maxLen,
      `motif_str plans a chain of ${plan.total} residues for seq_length '${entry.seqLength}'`);
  }

  // 7. the geometry list
  ok(Array.isArray(m.geometry) && m.geometry.length >= 4, `geometry has ${m.geometry.length} entries`);
  console.log('        geometry (measured / ideal / tol)');
  for (const g of m.geometry) {
    const want = g.kind === 'angle' ? 3 : 2;
    let shape = g.kind === 'distance' || g.kind === 'angle';
    shape = shape && Array.isArray(g.atoms) && g.atoms.length === want;
    shape = shape && typeof g.label === 'string' && typeof g.why === 'string' && g.why.length > 25;
    shape = shape && Number.isFinite(g.ideal) && Number.isFinite(g.tol) && g.tol > 0;
    // an honest tolerance: tight enough to mean something
    shape = shape && (g.kind === 'distance' ? g.tol <= 1.0 : g.tol <= 20.0);
    // an ideal that the kind allows
    shape = shape && (g.kind === 'distance' ? (g.ideal > 0.9 && g.ideal < 6.0) : (g.ideal >= 0 && g.ideal <= 180));
    shape = shape && new Set(g.atoms).size === want;
    if (!shape) { ok(false, `${g.label}: entry shape`); continue; }
    let pts;
    try { pts = g.atoms.map((ref) => { const a = atomAt(m, ref); return [a.x, a.y, a.z]; }); }
    catch (err) { ok(false, `${g.label}: ${err.message}`); continue; }
    const mine = measureHere(pts, g.kind);
    const theirs = measure(m, g);
    const agree = Math.abs(mine - theirs) < 1e-6;
    const inside = Math.abs(mine - g.ideal) <= g.tol;
    const unit = g.kind === 'distance' ? 'A' : 'deg';
    console.log(`          ${inside && agree ? 'pass' : 'FAIL'}  ${g.label}`);
    console.log(`                ${g.atoms.join(' - ')}  ${mine.toFixed(3)} ${unit}  ideal ${g.ideal} +/- ${g.tol}`);
    if (!agree) { console.log(`                motif.js measure() says ${theirs.toFixed(6)}, this test says ${mine.toFixed(6)}`); failed++; }
    else if (!inside) failed++;
  }

  // 8. a bad reference must throw, not return nonsense
  let threw = false;
  try { atomAt(m, 'res0:NOPE'); } catch { threw = true; }
  ok(threw, 'atomAt of an atom that is not there throws');
  threw = false;
  try { atomAt(m, 'rubbish'); } catch { threw = true; }
  ok(threw, 'atomAt of a reference that is not a reference throws');

  // 9. the report
  const bb = [0, 1, 2].map((k) => [Math.min(...all.map((a) => a.p[k])), Math.max(...all.map((a) => a.p[k]))]);
  const els = {};
  for (const a of all) els[a.el] = (els[a.el] || 0) + 1;
  console.log(`        atoms ${all.length} (${m.residues.map((r) => r.name).join(' ')} + ligand ${m.ligand.atoms.length})`);
  console.log(`        elements ${Object.entries(els).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`        ligand "${m.ligand.name}"`);
  console.log(`        bounding box x ${f2(bb[0][0])} to ${f2(bb[0][1])}   y ${f2(bb[1][0])} to ${f2(bb[1][1])}   z ${f2(bb[2][0])} to ${f2(bb[2][1])}  A`);
  console.log(`        size ${bb.map((b) => (b[1] - b[0]).toFixed(1)).join(' x ')} A, build ${ms.toFixed(2)} ms`);
}

for (const e of MOTIFS) checkMotif(e);

// ------------------------------------------------- a motif in a design
//  The motif must be usable as the fixed part of a design.js Design.
//  This is a shape check only, not a scaffolder.
console.log('\ndesign format');
{
  const m = motifById('kemp');
  const n = 60;
  const ca = new Float32Array(n * 3), cb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { ca[i * 3] = i * 3.8; cb[i * 3] = i * 3.8; cb[i * 3 + 1] = 1.5; }
  const d = {
    n, ca, cb, fixed: new Uint8Array(n), motifId: new Int32Array(n).fill(-1),
    seq: 'X'.repeat(n), ss: 'L'.repeat(n), ligand: m.ligand, meta: {},
  };
  m.residues.forEach((_r, i) => { d.fixed[10 + i] = 1; d.motifId[10 + i] = i; });
  const v = validate(d);
  ok(v.ok, `validate() accepts a design that carries the kemp ligand: ${v.ok ? 'ok' : v.errors.join('; ')}`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
