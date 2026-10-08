// ============================================================================
//  VIRUS ATLAS  ·  tests.mjs — node tests (no browser)
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/virus-atlas/tests.mjs
//  Exit code 1 on any failure.
//
//  SECTIONS
//    1  data files: each catalog entry loads; sizes on disk and gzipped
//    2  operators: proper rotations (det 1, orthonormal)
//    3  symmetry axes: 6 five-fold, 10 three-fold, 15 two-fold on every
//       icosahedral capsid; the n-fold axis on +y for cyclic proteins
//    4  subunit counts against the source assembly (60 T for capsids)
//    5  particle sizes in nm against the known sizes
//    6  helices and fibrils: rise, twist, layer count
//    7  animation timing: delays, unit progress, explode directions
//    8  envelope illustration: spikes stand on the membrane
//    9  ladder and ruler
//   10  GPU budget
//   11  saver plan: shots of 5 to 12 s, seeded shuffle
//   12  GPU expansion: the shader's instance arithmetic (pack.js) gives each
//       copy of each bead once, at the position of its operator
//   13  colour schemes: every scheme, palette and light maps into [0, 1]
//   14  tube spline: passes through every bead of a run, breaks at chain
//       ends and gaps; burial and chain fraction in range
//   15  subunit blobs: every bead inside its ellipsoid; axes orthogonal
// ============================================================================
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const F = await import(join(HERE, 'format.js'));
const S = await import(join(HERE, 'symmetry.js'));
const C = await import(join(HERE, 'catalog.js'));
const B = await import(join(HERE, 'budget.js'));
const P = await import(join(HERE, 'shots.js'));
const K = await import(join(HERE, 'pack.js'));
const CO = await import(join(HERE, 'colors.js'));
const TR = await import(join(HERE, 'trace.js'));
const BL = await import(join(HERE, 'blobs.js'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const section = s => console.log('\n' + s);

// ── 1 data files ─────────────────────────────────────────────────────────
section('1 data files');
const D = {};
const ids = [...new Set(C.ENTRIES.flatMap(C.pdbsOf))];
let totalGz = 0;
for (const id of ids) {
  const path = join(HERE, 'data', id.toLowerCase() + '.bin');
  const raw = readFileSync(path);
  const d = F.decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  D[id] = d;
  const gz = gzipSync(raw, { level: 9 }).length; totalGz += gz;
  ok(d.info.id === id, id + ' id in file');
  ok(d.n > 0 && d.pos.length === 3 * d.n && d.chain.length === d.n && d.flags.length === d.n, id + ' arrays');
  ok(d.chain.reduce((a, v) => Math.max(a, v), 0) < d.info.chains.length, id + ' chain index in range');
  ok(d.info.chains.reduce((a, c) => a + c[3], 0) === d.n, id + ' chain counts sum to n');
  ok(gz < 2e6, id + ' gzipped under 2 MB (' + gz + ' B)');
  ok(C.CREDIT[id] && C.CREDIT[id][3] && d.info.doi && d.info.doi.toLowerCase() === C.CREDIT[id][3].toLowerCase(), id + ' DOI matches the RCSB record');
  ok(d.info.year === C.CREDIT[id][2], id + ' year matches the RCSB record');
  console.log('  ' + id.padEnd(5) + String(d.n).padStart(7) + ' beads  ' + String(statSync(path).size).padStart(8) + ' B  gz ' + String(gz).padStart(8) + ' B');
}
console.log('  total gzipped ' + totalGz + ' B');
ok(C.ENTRIES.every(e => e.parts || D[e.pdb]), 'every entry has its data');
ok(new Set(C.ENTRIES.map(e => e.key)).size === C.ENTRIES.length, 'entry keys are unique');
ok(C.ENTRIES.every(e => C.GROUPS.some(g => g.id === e.group)), 'every entry is in a group');

// ── 2 operators ──────────────────────────────────────────────────────────
section('2 operators');
const opsOf = id => F.copyOps(D[id].info);
let worstDet = 0, worstOrth = 0, nOps = 0;
for (const id of ids) {
  const ops = opsOf(id), m = ops.length / 12;
  for (let k = 0; k < m; k++) {
    worstDet = Math.max(worstDet, Math.abs(S.det3(ops, k) - 1));
    worstOrth = Math.max(worstOrth, S.orthoError(ops, k));
    nOps++;
  }
}
console.log('  ' + nOps + ' operators: worst |det - 1| ' + worstDet.toExponential(2) + ', worst |R R^T - I| ' + worstOrth.toExponential(2));
ok(worstDet < 2e-4, 'every operator has det 1');
ok(worstOrth < 2e-4, 'every operator is orthonormal');

// ── 3 symmetry axes ──────────────────────────────────────────────────────
section('3 symmetry axes');
const icosa = C.ENTRIES.filter(e => e.look === 'capsid' && D[e.pdb].info.sym.type === 'icosa');
for (const e of icosa) {
  const ops = opsOf(e.pdb), ax = S.axesOf(ops), c = S.axisCounts(ax);
  ok(ops.length / 12 === 60, e.pdb + ' has 60 operators');
  ok(c[5] === 6 && c[3] === 10 && c[2] === 15, e.pdb + ' axes 5:' + c[5] + ' 3:' + c[3] + ' 2:' + c[2]);
  ok(ax[0].order === 5 && near(Math.abs(ax[0].dir[1]), 1, 1e-3), e.pdb + ' a 5-fold axis on +y');
  // 5-fold to 3-fold angle: 37.38 deg; 5-fold to 2-fold: 31.72 deg
  const f = ax.filter(a => a.order === 5)[0].dir;
  const ang = o => Math.min(...ax.filter(a => a.order === o).map(a => Math.acos(Math.min(1, Math.abs(f[0] * a.dir[0] + f[1] * a.dir[1] + f[2] * a.dir[2]))) * 180 / Math.PI));
  ok(near(ang(3), 37.377, 0.3) && near(ang(2), 31.717, 0.3), e.pdb + ' axis angles 5-3 ' + ang(3).toFixed(2) + ', 5-2 ' + ang(2).toFixed(2));
}
for (const [id, n] of [['3H47', 6], ['4TVP', 3], ['5JQ3', 3], ['2ZB6', 2]]) {
  const ax = S.axesOf(opsOf(id));
  ok(ax.length === 1 && ax[0].order === n && near(ax[0].dir[1], 1, 1e-3), id + ' one ' + n + '-fold axis on +y');
}
for (const [id, n] of [['6VSB', 3], ['1RUZ', 3], ['2HTY', 4], ['7U9G', 3]]) {
  ok(D[id].info.sym.type === 'cyclic' && D[id].info.sym.n === n, id + ' pseudo C' + n + ' from chain fit');
}

// ── 4 subunit counts ─────────────────────────────────────────────────────
section('4 subunit counts');
const COUNT = {
  '1HXS': [/COAT PROTEIN/i, 240], '4RHV': [/COAT PROTEIN/i, 240], '1IHM': [/capsid/i, 180], '1QGT': [/CAPSID/i, 240],
  '3J6R': [/L1/, 360], '6CGV': [/^Hexon protein$/, 720], '5IRE': [/^E protein$/, 180], '1OHG': [/CAPSID/i, 420],
  '4UDV': [/CAPSID/i, 2130], '3J3Q': [/capsid/i, 1356],
};
for (const e of C.ENTRIES.filter(e => e.group === 'virus')) {
  const d = D[e.pdb], [re, want] = COUNT[e.pdb];
  const per = d.info.chains.filter(c => re.test(d.info.entities[c[2]].desc)).length;
  const copies = F.copyOps(d.info).length / 12;
  ok(per * copies === want && want === e.copies.n, e.pdb + ' ' + e.copies.text + ': ' + per + ' x ' + copies + ' = ' + per * copies + ' (want ' + want + ')');
  // quasi-equivalence: 60 T chains, except the pseudo-T shells and the
  // all-pentamer HPV shell (T = 7d with 360, not 420, chains of L1)
  if (e.T && !e.T.pseudo && e.T.hand !== 'd') ok(per * copies === 60 * e.T.T, e.pdb + ' 60 T = ' + 60 * e.T.T + ' chains');
  if (e.T) ok(e.T.h * e.T.h + e.T.h * e.T.k + e.T.k * e.T.k === e.T.T, e.pdb + ' T = h^2 + hk + k^2');
}
ok(D['1HXS'].info.chains.filter(c => /VP[123]$/.test(D['1HXS'].info.entities[c[2]].desc)).length * 60 === 180, '1HXS pseudo T = 3: 180 chains of VP1-VP3');
ok(D['3J6R'].info.chains.length * 60 / 5 === 72, '3J6R 72 L1 pentamers');
ok(D['5IRE'].info.chains.filter(c => /^M protein$/.test(D['5IRE'].info.entities[c[2]].desc)).length * 60 === 180, '5IRE 180 M chains');
ok(D['6CGV'].info.chains.filter(c => /^Penton/.test(D['6CGV'].info.entities[c[2]].desc)).length * 60 === 60, '6CGV 12 penton bases of 5 = 60 chains');

// ── 5 sizes ──────────────────────────────────────────────────────────────
section('5 particle sizes (nm)');
const SIZE = { // [quantity, lo, hi]
  '1HXS': ['d', 29, 33], '4RHV': ['d', 29, 33], '1IHM': ['d', 36, 42], '1QGT': ['d', 32, 37], '3J6R': ['d', 52, 62],
  '6CGV': ['d', 85, 95], '5IRE': ['d', 44, 52], '1OHG': ['d', 55, 68], '4UDV': ['len', 295, 305], '3J3Q': ['len', 100, 125],
  '6VSB': ['len', 14, 18], '1QLX': ['max', 2.5, 5],
};
for (const [id, [q, lo, hi]] of Object.entries(SIZE)) {
  const b = S.bounds(D[id], opsOf(id), id === '4UDV' || id === '3J3Q' ? 7 : 1);
  const v = q === 'd' ? 2 * b.r : q === 'len' ? Math.max(...b.size) : Math.max(...b.size);
  ok(v >= lo && v <= hi, id + ' ' + q + ' ' + v.toFixed(1) + ' nm in [' + lo + ', ' + hi + ']');
  if (id === '4UDV') { const w = Math.max(b.size[0], b.size[2]); ok(w > 16 && w < 19, '4UDV width ' + w.toFixed(1) + ' nm'); }
}

// ── 6 helices and fibrils ────────────────────────────────────────────────
section('6 helices and fibrils');
const tmv = D['4UDV'].info.helix;
ok(near(Math.abs(tmv.twist) * 180 / Math.PI, 360 / (49 / 3), 0.02), 'TMV twist ' + (tmv.twist * 180 / Math.PI).toFixed(3) + ' deg ~ 360 / 16.33 (49 subunits in 3 turns)');
ok(near(Math.abs(tmv.rise), 1.408, 0.002), 'TMV rise ' + tmv.rise + ' A');
ok(near(Math.abs(tmv.rise) * 49 / 3, 23, 0.1), 'TMV pitch ' + (Math.abs(tmv.rise) * 49 / 3).toFixed(2) + ' A');
for (const e of C.ENTRIES.filter(e => e.look === 'fibril')) {
  const h = D[e.pdb].info.helix;
  ok(h && Math.abs(h.rise) > 4.6 && Math.abs(h.rise) < 5.0, e.pdb + ' rise ' + h.rise + ' A (cross-beta)');
  ok(Math.abs(h.twist) < 2 * Math.PI / 180, e.pdb + ' twist ' + (h.twist * 180 / Math.PI).toFixed(3) + ' deg per layer');
  ok(h.fit < 0.5, e.pdb + ' screw fit rmsd ' + h.fit + ' A');
  ok(F.copyOps(D[e.pdb].info, e.layers).length / 12 === e.layers, e.pdb + ' ' + e.layers + ' layers');
}

// ── 7 animation timing ───────────────────────────────────────────────────
section('7 animation timing');
for (const id of ['1QGT', '4UDV', '7LNA', '3J3Q', '3H47']) {
  const d = D[id], ops = opsOf(id), nc = d.info.chains.length, kind = d.info.sym.type;
  const cent = S.unitCentroids(d, ops), axes = kind === 'icosa' ? S.axesOf(ops) : [];
  const del = S.assemblyDelays(kind, cent, nc, { axes, fibril: !!(d.info.sym.fibril) });
  ok(del.length === cent.length / 3 && del.every(v => v >= 0 && v < 1), id + ' ' + del.length + ' unit delays in [0, 1)');
  const dirs = S.explodeDirs(kind, cent, { axes, fibril: !!d.info.sym.fibril });
  let bad = 0;
  for (let u = 0; u < dirs.length / 3; u++) if (!near(Math.hypot(dirs[3 * u], dirs[3 * u + 1], dirs[3 * u + 2]), 1, 1e-4)) bad++;
  ok(bad === 0, id + ' explode directions are unit vectors');
  if (kind === 'icosa') {
    const groups = new Set(Array.from(del, v => Math.floor(v * 12)));
    ok(groups.size === 12, id + ' assembles in 12 pentamer regions');
  }
  if (id === '7LNA') {
    const nc1 = d.info.chains.length, mid = Math.floor(del.length / nc1 / 2);
    ok(del[mid * nc1] < 0.05 && del[0] > 0.95, '7LNA grows from a middle seed to both ends');
  }
}
let mono = true;
for (const dl of [0, 0.3, 0.999]) {
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const p = S.unitProgress(i / 100, dl); if (p < prev - 1e-9) mono = false; prev = p; }
  ok(near(S.unitProgress(0, dl), 0, 1e-9) || dl === 0 && S.unitProgress(0, dl) === 0, 'progress 0 at t = 0, delay ' + dl);
  ok(near(S.unitProgress(1, dl), 1, 1e-6), 'progress 1 at t = 1, delay ' + dl);
}
ok(mono, 'unit progress never goes back');
ok(near(S.easeInOut(0.5), 0.5, 1e-9) && S.easeInOut(0) === 0 && S.easeInOut(1) === 1, 'easeInOut ends and middle');

// ── 8 envelope ───────────────────────────────────────────────────────────
section('8 envelope illustration');
for (const e of C.ENTRIES.filter(e => e.look === 'virion')) {
  const r = S.makeRng(7);
  const spec = { R: e.membrane.r, tilt: e.tilt, parts: e.parts.map(p => ({ count: p.count, stalk: p.stalk, base: D[p.pdb].info.anchor.base / 10 })) };
  const env = S.envelopeOps(spec, r.next);
  let worst = 0, okBase = true;
  env.ops.forEach((ops, i) => {
    for (let k = 0; k < ops.length / 12; k++) {
      worst = Math.max(worst, Math.abs(S.det3(ops, k) - 1), S.orthoError(ops, k));
      const p = F.applyOp(ops, k, 0, spec.parts[i].base, 0);
      const rr = Math.hypot(...p);
      if (rr < spec.R - 0.01 || rr > spec.R + spec.parts[i].stalk + 0.01) okBase = false;
    }
  });
  ok(worst < 1e-5, e.key + ' spike operators are rotations (worst ' + worst.toExponential(1) + ')');
  ok(okBase, e.key + ' every spike base sits on its stalk, between R and R + stalk');
  ok(env.ops.reduce((a, o) => a + o.length / 12, 0) === e.parts.reduce((a, p) => a + p.count, 0), e.key + ' spike count');
  // the protein must point away from the membrane: its top is outside
  const top = D[e.parts[0].pdb].info.anchor.top / 10;
  let out = true;
  for (let k = 0; k < env.ops[0].length / 12; k++) if (Math.hypot(...F.applyOp(env.ops[0], k, 0, top, 0)) < spec.R + 5) out = false;
  ok(out, e.key + ' spikes point outward');
}

// ── 9 ladder and ruler ───────────────────────────────────────────────────
section('9 ladder and ruler');
const items = C.LADDER_KEYS.map(k => ({ key: k, size: k === 'tmv' ? 300 : k === 'sars2-virion' ? 130 : k === 'hiv-cone' ? 116 : k === 'adeno' ? 91 : k === 'hpv' ? 60 : k === 'zika' ? 47 : k === 'hbv' ? 34 : k === 'polio' ? 31 : k === 'spike' ? 17 : k === 'prion-263k' ? 29 : 4.4 }));
const lay = S.lineupLayout(items);
ok(lay.every((it, i) => i === 0 || it.x - lay[i - 1].x > (it.size + lay[i - 1].size) / 2), 'lineup items do not overlap');
let prevW = 0, wMono = true;
for (let i = 0; i <= 50; i++) { const v = S.ladderView(i / 50, lay); if (v.width < prevW) wMono = false; prevW = v.width; }
ok(wMono, 'ladder zoom width only grows');
ok(near(S.ladderView(0, lay).width, items[0].size * S.LADDER_FIT, 1e-6) && near(S.ladderView(1, lay).width, 300 * S.LADDER_FIT, 1e-6), 'ladder starts on the smallest, ends on the largest');
ok(near(S.ladderView(1, lay).x, lay[lay.length - 1].x, 1e-6), 'ladder ends centred on the TMV rod');
ok(S.ladderX(0.1) === 0 && S.ladderX(10000) === 1 && near(S.ladderX(100), 0.6, 1e-9), 'ladder log scale: 0.1 nm .. 10 um, 100 nm at 0.6');
for (const npp of [0.003, 0.05, 0.4, 2.7, 31]) {
  const r = S.niceRuler(npp, 120), m = r.nm / Math.pow(10, Math.floor(Math.log10(r.nm) + 1e-9));
  ok(r.px <= 120 + 1e-9 && r.px > 120 / 5 - 1e-9 && [1, 2, 5].some(v => near(m, v, 1e-6)), 'ruler ' + npp + ' nm/px -> ' + r.label + ' (' + r.px.toFixed(0) + ' px)');
}

// ── 10 GPU budget ────────────────────────────────────────────────────────
section('10 GPU budget');
for (const [w, h, dpr] of [[390, 844, 3], [1280, 800, 2], [1920, 1080, 1], [2560, 1440, 2], [5120, 2880, 2]]) {
  const b = B.canvasBudget(w, h, dpr);
  ok(b.px <= B.MAX_PX * 1.002, w + 'x' + h + ' @' + dpr + ': ' + b.px + ' px <= MAX_PX');
  ok(!(b.samples && b.pr >= 1.5), w + 'x' + h + ' @' + dpr + ': no MSAA at pixel ratio ' + b.pr);
  ok(b.bytes < 60e6, w + 'x' + h + ' @' + dpr + ': canvas ' + (b.bytes / 1e6).toFixed(1) + ' MB');
}
const big = B.gpuBeadBytes(313236, 1, 1356) + B.gpuBeadBytes(12507, 60, 1260);
ok(big < 8e6, 'bead textures of the two largest parts: ' + (big / 1e6).toFixed(2) + ' MB');
ok(B.strideFor(12507, 60, B.maxInstances(true)) === 3 && B.strideFor(858, 60, B.maxInstances(false)) === 1, 'LOD stride: adenovirus 3 on a phone, polio 1');

// ── 11 saver plan ────────────────────────────────────────────────────────
section('11 saver plan');
for (const seed of [1, 2, 99, 12345]) for (const calm of [0, 0.7, 1]) {
  const plan = P.plan(seed, calm, 40);
  ok(plan.every(s => s.dur >= 5 && s.dur <= 12), 'seed ' + seed + ' calm ' + calm + ': 40 shots of 5..12 s');
  ok(plan.every((s, i) => i === 0 || s.kind !== plan[i - 1].kind || s.entry !== plan[i - 1].entry), 'seed ' + seed + ': no shot repeats back to back');
  ok(plan.every(s => P.SHOTS[s.kind] && C.entryByKey(s.entry)), 'seed ' + seed + ': known shots and entries');
}
const a = P.plan(1, 0.7, 12).map(s => s.kind + s.entry).join(), b2 = P.plan(2, 0.7, 12).map(s => s.kind + s.entry).join();
ok(a !== b2, 'two seeds give two orders');
ok(P.plan(5, 0.7, 12).map(s => s.kind + s.entry).join() === P.plan(5, 0.7, 12).map(s => s.kind + s.entry).join(), 'one seed gives one order');
ok(new Set(P.plan(3, 0.7, 60).map(s => s.kind)).size === Object.keys(P.SHOTS).length, 'every shot kind plays in 60 shots');

// ── 12 GPU expansion ─────────────────────────────────────────────────────
section('12 GPU expansion');
for (const [id, stride] of [['1QGT', 1], ['7LNA', 1], ['6CGV', 3], ['5IRE', 2]]) {
  const d = D[id], ops = opsOf(id), m = ops.length / 12, nb = Math.ceil(d.n / stride);
  const beads = K.packBeads(d), opsP = K.packOps(ops), seen = new Uint8Array(d.n * m);
  let worst = 0, badCode = 0, dup = 0;
  for (let i = 0; i < nb * m; i++) {
    const r = K.instanceWorld(i, beads, opsP, nb, stride);
    const want = F.applyOp(ops, r.k, d.pos[3 * r.b], d.pos[3 * r.b + 1], d.pos[3 * r.b + 2]);
    worst = Math.max(worst, Math.hypot(r.w[0] - want[0], r.w[1] - want[1], r.w[2] - want[2]));
    if (r.chain !== d.chain[r.b] || r.flags !== d.flags[r.b]) badCode++;
    if (seen[r.k * d.n + r.b]++) dup++;
  }
  const visited = seen.reduce((a, v) => a + (v ? 1 : 0), 0);
  ok(worst < 1e-4 && badCode === 0 && dup === 0, id + ' stride ' + stride + ': ' + nb * m + ' instances, worst ' + worst.toExponential(1) + ' nm, codes ok, no duplicates');
  ok(visited === nb * m && (stride > 1 || visited === d.n * m), id + ' stride ' + stride + ': covers ' + visited + ' of ' + d.n * m + ' copies of beads');
}
const units = K.packUnits(new Float32Array([1, 2, 3, 4, 5, 6]), new Float32Array([0.1, 0.2]), new Float32Array([0, 1, 0, 1, 0, 0]), 1, new Float32Array([0.5, 0.7]));
ok(units[3] === Float32Array.of(0.1)[0] && units[8 + 4] === 1 && units[8 + 7] === Float32Array.of(0.7)[0], 'unit texels: centroid + delay, direction + phase');

// ── 13 colour schemes ────────────────────────────────────────────────────
section('13 colour schemes');
{
  const in01 = c => c.length === 3 && c.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
  let worst = 0, calls = 0, bad = 0;
  const rr = S.makeRng(13);
  for (const pk of Object.keys(CO.PALETTES)) {
    const P = CO.PALETTES[pk];
    ok(P.main.length >= 10 && P.ramp.length === 5 && P.div.length === 3 && P.ss.length === 3 && P.cls.length === 8, pk + ' palette has every table');
    for (const id of ['1HXS', '6CGV', '6VSB', '7LNA']) {
      for (const sc of CO.SCHEMES) {
        const chains = CO.chainColors(D[id].info, sc.id, pk, { hide: { glycan: true } });
        if (!chains.every(c => in01(c.slice(0, 3)) && (c[3] === 0 || c[3] === 1))) bad++;
        for (let t = 0; t < 40; t++) {
          const ctx = { chainRgb: chains[Math.floor(rr.next() * chains.length)], k: Math.floor(rr.next() * 60), ss: Math.floor(rr.next() * 3), cls: Math.floor(rr.next() * 8),
            frac: rr.range(-0.2, 1.2), burial: rr.next(), radiusT: rr.range(-0.5, 1.5) };
          const c = CO.beadColor(sc.id, pk, ctx), v = CO.schemeValue(sc.id, ctx);
          calls++;
          if (!in01(c) || !(v >= 0 && v <= 1)) { bad++; worst = Math.max(worst, ...c.map(Math.abs)); }
        }
      }
    }
  }
  ok(bad === 0, calls + ' bead colours over ' + CO.SCHEMES.length + ' schemes x ' + Object.keys(CO.PALETTES).length + ' palettes are in [0, 1]');
  ok(CO.SCHEMES.every(x => CO.MODE[x.id] != null) && new Set(Object.values(CO.MODE)).size === 8, 'every scheme has a shader mode (8 modes)');
  ok(CO.HYDRO.length === 8 && CO.HYDRO.every(v => v >= 0 && v <= 1), 'hydropathy of every residue class in [0, 1]');
  ok(CO.HYDRO[0] > CO.HYDRO[1] && CO.HYDRO[1] > CO.HYDRO[2], 'hydrophobic > polar > charged');
  const h = [CO.hsv(0, 1, 1), CO.hsv(1 / 3, 1, 1), CO.hsv(2 / 3, 1, 1)];
  ok(near(h[0][0], 1, 1e-9) && near(h[1][1], 1, 1e-9) && near(h[2][2], 1, 1e-9), 'hsv: red, green, blue at 0, 1/3, 2/3');
  ok(near(CO.ramp([[0, 0, 0], [1, 1, 1]], 0.25)[0], 0.25, 1e-9) && CO.ramp([[0, 0, 0], [1, 1, 1]], 7)[0] === 1, 'ramp interpolates and clamps');
  for (const [k, L] of Object.entries(CO.LIGHTS)) {
    ok(Math.hypot(...L.key) > 0.1 && Math.hypot(...L.fill) > 0.1 && in01(L.keyCol) && in01(CO.hex01(L.bg)) && L.amb >= 0 && L.amb < 0.5, 'light ' + k + ': directions, colours in range');
  }
}

// ── 14 tube spline ───────────────────────────────────────────────────────
section('14 tube spline, chain runs, burial');
for (const id of ['1HXS', '6CGV', '6VSB', '7LNA', '4UDV', '3J3Q', '1QLX']) {
  const d = D[id], ops = opsOf(id), t0 = Date.now();
  const aux = TR.packAux(d, ops), ms = Date.now() - t0;
  const brk = TR.breaks(d), runs = brk.reduce((a, v) => a + v, 0);
  const P = i => [d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]];
  const { segs } = TR.tubeSegments(d, aux, 1);
  let worstEnd = 0, worstMid = 0, spans = 0;
  const endpoint = new Uint8Array(d.n);
  for (const g of segs) {
    const a = TR.catmull(g.p0, g.p1, g.p2, g.p3, 0), b = TR.catmull(g.p0, g.p1, g.p2, g.p3, 1), mid = TR.catmull(g.p0, g.p1, g.p2, g.p3, 0.5);
    const A0 = P(g.b1), B0 = P(g.b2);
    worstEnd = Math.max(worstEnd, Math.hypot(a[0] - A0[0], a[1] - A0[1], a[2] - A0[2]), Math.hypot(b[0] - B0[0], b[1] - B0[1], b[2] - B0[2]));
    worstMid = Math.max(worstMid, Math.hypot(mid[0] - (A0[0] + B0[0]) / 2, mid[1] - (A0[1] + B0[1]) / 2, mid[2] - (A0[2] + B0[2]) / 2));
    if (d.chain[g.b1] !== d.chain[g.b2] || brk[g.b2]) spans++;
    endpoint[g.b1] = endpoint[g.b2] = 1;
  }
  // every bead with a neighbour in its run is on the tube
  let missed = 0;
  for (let i = 0; i < d.n; i++) { const linked = (i + 1 < d.n && !brk[i + 1]) || (i > 0 && !brk[i]); if (linked && !endpoint[i]) missed++; }
  console.log('  ' + id.padEnd(5) + String(d.n).padStart(7) + ' beads ' + String(runs).padStart(5) + ' runs ' + String(segs.length).padStart(7) + ' segments  burial ' + ms + ' ms');
  ok(segs.length === d.n - runs, id + ' one segment per joined pair: ' + segs.length + ' = ' + d.n + ' - ' + runs + ' runs');
  ok(worstEnd < 1e-5, id + ' the spline passes through every bead (worst ' + worstEnd.toExponential(1) + ' nm)');
  ok(spans === 0, id + ' no segment spans a chain end or a gap');
  ok(missed === 0, id + ' every bead with a neighbour is on the tube');
  ok(worstMid < 0.25, id + ' the curve stays near its chord (worst ' + worstMid.toFixed(3) + ' nm at t = 0.5)');
  // the shader test (break counts mod 256) agrees with the breaks, at any stride
  let wrong = 0;
  for (const st of [1, 2, 3, 5, 8]) for (let i = 0; i + st < d.n; i += st) {
    let clean = d.chain[i] === d.chain[i + st];
    for (let q = i + 1; q <= i + st && clean; q++) if (brk[q]) clean = false;
    if (TR.sameRun(aux, d, i, i + st) !== clean) wrong++;
  }
  ok(wrong === 0, id + ' break counts give the runs at strides 1, 2, 3, 5, 8');
  // chain fraction: 0 at the first bead of a chain, 255 at its last
  let fr = true;
  for (let i = 0; i < d.n; i++) {
    if ((i === 0 || d.chain[i] !== d.chain[i - 1]) && aux[4 * i + 1] !== 0) fr = false;
    if ((i === d.n - 1 || d.chain[i] !== d.chain[i + 1]) && aux[4 * i + 1] !== 255 && (i === 0 || d.chain[i - 1] === d.chain[i])) fr = false;
  }
  ok(fr, id + ' chain fraction runs 0 -> 255 along each chain');
  // burial: outer beads are less buried than the rest
  const r = Array.from({ length: d.n }, (_, i) => [Math.hypot(...F.applyOp(ops, 0, ...P(i))), aux[4 * i] / 255]).sort((x, y) => y[0] - x[0]);
  const top = r.slice(0, Math.max(1, Math.floor(d.n * 0.1))), rest = r.slice(Math.floor(d.n * 0.1));
  const mean = a => a.reduce((x, v) => x + v[1], 0) / Math.max(1, a.length);
  if (['1HXS', '6CGV', '4UDV', '3J3Q'].includes(id)) ok(mean(top) < mean(rest), id + ' outer 10% of beads less buried (' + mean(top).toFixed(2) + ' < ' + mean(rest).toFixed(2) + ')');
  ok(aux.every(v => v >= 0 && v <= 255), id + ' aux bytes in range');
}

// ── 15 subunit blobs ─────────────────────────────────────────────────────
section('15 subunit blobs');
for (const id of ids) {
  const d = D[id], b = BL.chainBlobs(d);
  let out = 0, orth = 0, wrongChain = 0, maxAx = 0;
  for (let i = 0; i < d.n; i++) {
    if (!BL.insideBlob(b.data, b.owner[i], d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2])) out++;
    if (b.data[16 * b.owner[i] + 3] !== d.chain[i]) wrongChain++;
  }
  for (let q = 0; q < b.n; q++) {
    const v = k => [b.data[16 * q + 4 + 4 * k], b.data[16 * q + 5 + 4 * k], b.data[16 * q + 6 + 4 * k]];
    const L = k => Math.hypot(...v(k));
    for (const [x, y] of [[0, 1], [0, 2], [1, 2]]) orth = Math.max(orth, Math.abs(v(x)[0] * v(y)[0] + v(x)[1] * v(y)[1] + v(x)[2] * v(y)[2]) / (L(x) * L(y)));
    maxAx = Math.max(maxAx, L(0), L(1), L(2));
  }
  ok(out === 0 && wrongChain === 0, id + ' ' + b.n + ' blobs: every bead inside the blob of its own chain');
  ok(orth < 1e-4, id + ' blob axes orthogonal (worst cos ' + orth.toExponential(1) + ')');
  if (['1HXS', '6CGV', '3J3Q', '6VSB'].includes(id)) console.log('  ' + id.padEnd(5) + String(b.n).padStart(6) + ' blobs, ' + (d.n / b.n).toFixed(1) + ' residues each, longest semi-axis ' + maxAx.toFixed(2) + ' nm');
}
{
  const J = BL.jacobi3([4, 1, 0, 3, 0, 2]), tr = J.val.reduce((a, v) => a + v, 0);
  ok(near(tr, 9, 1e-9) && J.val.every(v => v > 1.3 && v < 4.7), 'jacobi3: eigenvalues keep the trace');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
