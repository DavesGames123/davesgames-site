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
//   11  saver plan: cycles of build, inspect or axes, take-apart on one
//       virus; a new virus each cycle, all 12 before a repeat; looks,
//       explode styles and regions from saver-look.js; 5..12 s beats;
//       the rod fit (saver-look.js fitLong)
//   12  GPU expansion: the shader's instance arithmetic (pack.js) gives each
//       copy of each bead once, at the position of its operator
//   13  colour schemes: every scheme, palette and light maps into [0, 1]
//   14  tube spline: passes through every bead of a run, breaks at chain
//       ends and gaps; burial and chain fraction in range
//   15  subunit blobs: every bead inside its ellipsoid; axes orthogonal
//   16  lattice cage: icosahedron nodes on the 5-, 3- and 2-fold axes;
//       subunit nets with one node per unit and no lonely nodes
//   17  views on the GPU: data bytes of every view of every entry, and
//       the draw counts on a phone and a desktop profile
//   18  phone layout: 44 px targets, the dock fits at 360 px and in the
//       landscape tab, selects cannot widen the sheet
//   19  regions on the real data: 5 copies round each 5-fold axis, 6 in
//       each hexamer (T = 3, T = 4, T = 7, the HIV cone), 3 in a hexon
//       trimer and in a spike, faces, rod turns, fibril layers
//   20  the exploded view: offsets along the chosen axes, monotone in
//       time, staggered, every unit back at rest when the shell closes;
//       the GPU table (pack.js packSel)
//   21  framing: an inspected region stays in the clear band of a
//       portrait and a landscape frame through the whole turn
//   22  build and take-apart: the explode curve run backwards lands every
//       unit at rest; size 0 at the start of a build and the end of a
//       take-apart; pentamers first; TMV lines leave the rod axis; the
//       saver-look.js traits and assembly units against the data
//   23  saver run in node: saver.js on a stub of main.js (real bead data,
//       three.js r160 maths, no WebGL): 4 minutes per seed; every take-
//       apart ends on an empty screen, every next virus was preloaded,
//       the camera turns under 20 deg/s and zooms under 0.65 per s, one
//       plate per beat, the inspected region sits in the clear band
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
const CG = await import(join(HERE, 'cage.js'));

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
section('11 saver plan (shots.js: build, look, take apart)');
const LK = await import(join(HERE, 'saver-look.js'));
const RGK = (await import(join(HERE, 'regions.js'))).REGION_KINDS;
{
  for (const seed of [1, 2, 99, 12345]) for (const calm of [0, 0.7, 1]) {
    const plan = P.plan(seed, calm, 60);
    ok(plan.length === 60 && plan.every(s => s.dur >= 5 && s.dur <= 12), 'seed ' + seed + ' calm ' + calm + ': 60 beats of 5..12 s');
  }
  const a = P.plan(1, 0.7, 30).map(s => JSON.stringify(s)).join(), b2 = P.plan(2, 0.7, 30).map(s => JSON.stringify(s)).join();
  ok(a !== b2 && a === P.plan(1, 0.7, 30).map(s => JSON.stringify(s)).join(), 'one seed gives one plan; two seeds give two');
  // a weighted bag on its own: no back-to-back repeat, counts follow the weights
  const r = S.makeRng(77), bag = P.makeBag(r, { a: 3, b: 1, c: 1, d: 0.2 }), cnt = { a: 0, b: 0, c: 0, d: 0 };
  let prev = null, rep = 0;
  for (let i = 0; i < 6000; i++) { const k = bag.next(); cnt[k]++; if (k === prev) rep++; prev = k; }
  ok(rep === 0 && cnt.d > 0 && cnt.a > 2 * cnt.b, 'bag: 6000 draws, ' + rep + ' back-to-back repeats, counts follow the weights');
  // the cycles: build, inspect or axes, apart, on one virus
  let n = 0, cycBad = 0, sameNext = 0, fullBad = 0, lookRep = 0, lookBad = 0, exBad = 0, regBad = 0, contrast = 0, pairs = 0;
  const seen = { entry: new Set(), look: new Set(), ex: new Set(), stag: new Set(), region: new Set(), mid: new Set() };
  for (const seed of [3, 41, 2024, 987654]) {
    const plan = P.plan(seed, 0.6, 360), cycles = [];
    for (let i = 0; i + 2 < plan.length; i += 3) cycles.push(plan.slice(i, i + 3));
    cycles.forEach((c, i) => {
      n++;
      const [bd, mid, ap] = c;
      if (bd.kind !== 'build' || !(mid.kind === 'inspect' || mid.kind === 'axes') || ap.kind !== 'apart' || c.some(x => x.entry !== bd.entry || x.look !== bd.look)) cycBad++;
      seen.entry.add(bd.entry); seen.look.add(bd.look); seen.ex.add(bd.ex); seen.stag.add(bd.stag); seen.mid.add(mid.kind);
      const V0 = LK.VIRUSES[bd.entry], look = C.entryByKey(bd.entry).look;
      if (!LK.okLook(bd.entry, LK.lookById(bd.look))) lookBad++;
      if (!V0.build.map(String).includes(bd.ex) || !V0.apart.map(String).includes(ap.ex) || (bd.stag === 'type' && bd.ex !== 'cap')) exBad++;
      if (ap.ex === bd.ex && V0.apart.map(String).some(x => x !== bd.ex)) exBad++;
      if (mid.kind === 'axes' && look !== 'capsid') exBad++;
      if (mid.kind === 'inspect') { seen.region.add(bd.entry + ':' + mid.region); if (!RGK[bd.entry].includes(mid.region) || !V0.mid.includes(mid.region)) regBad++; }
      const q = cycles[i - 1];
      if (q) {
        pairs++;
        if (q[0].entry === bd.entry) sameNext++;
        if (q[0].look === bd.look) lookRep++;
        const da = LK.VIRUSES[q[0].entry].d, db = LK.VIRUSES[bd.entry].d;
        if (C.entryByKey(q[0].entry).look !== look || Math.max(da, db) / Math.min(da, db) >= 1.3) contrast++;
      }
      // no repeat until all 12 have played
      if (i % 12 === 11 && new Set(cycles.slice(i - 11, i + 1).map(x => x[0].entry)).size !== 12) fullBad++;
    });
  }
  ok(cycBad === 0, n + ' cycles: build, then an inspection or the axes, then the take-apart, all on one virus with one look');
  ok(sameNext === 0 && fullBad === 0, 'a new virus each cycle; each run of 12 cycles holds all 12 viruses (' + sameNext + ', ' + fullBad + ')');
  ok(contrast / pairs > 0.85, 'neighbour viruses differ in kind or by 30 % in size in ' + (100 * contrast / pairs).toFixed(0) + ' % of ' + pairs + ' pairs');
  ok(lookRep === 0 && lookBad === 0 && seen.look.size === LK.LOOKS.length, 'no look twice in a row, every look suits its virus, all ' + seen.look.size + ' looks play');
  ok(exBad === 0 && regBad === 0, 'build and apart styles from the virus table, apart differs from build, axes only on capsids, regions from the virus table');
  ok(seen.entry.size === 12 && seen.mid.size === 2 && ['5', '3', '2', '-1', 'cap'].every(x => seen.ex.has(x)) && ['distance', 'ring', 'type'].every(x => seen.stag.has(x)), 'every virus, both middle beats, every build style and stagger play (' + seen.region.size + ' virus:region pairs)');
  console.log('  seed 9: ' + P.plan(9, 0.6, 12).map(s => s.kind + ':' + s.entry + (s.ex != null ? ':' + s.ex : '') + (s.region ? ':' + s.region : '')).join(' '));
  // long subjects: the fit sizes the rod along the long side of the band
  const land = LK.fitLong(151, 9, { w: 1280, h: 800, fov: 32, occ: { l: 0, r: 0, t: 250, b: 250 } }), port = LK.fitLong(151, 9, { w: 1080, h: 1920, fov: 32, occ: { l: 0, r: 0, t: 380, b: 380 } });
  const half = (f, s, h) => Math.atan(Math.tan(16 * Math.PI / 180) * s / h);
  ok(land.across && !port.across && 151 / (land.dist - 9) <= Math.tan(half(0, 1280, 800)) * 1.0001 && 151 / (port.dist - 9) <= Math.tan(half(0, 1160, 1920)) * 1.0001, 'fitLong: the rod lies across a landscape band and up a portrait band, and fits its long side');
}

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

// ── 16 lattice cage ──────────────────────────────────────────────────────
section('16 lattice cage');
{
  const u3 = v => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const onAxis = (p, axes, o) => axes.filter(a => a.order === o).some(a => Math.abs(Math.abs(u3(p)[0] * a.dir[0] + u3(p)[1] * a.dir[1] + u3(p)[2] * a.dir[2]) - 1) < 1e-6);
  for (const e of icosa) {
    const ops = opsOf(e.pdb), ax = S.axesOf(ops), R = 20, c = CG.icosaCage(ax, R);
    const V = c.nodes.filter(q => q.kind === 5), T = c.nodes.filter(q => q.kind === 3), W2 = c.nodes.filter(q => q.kind === 2);
    const deg = new Array(c.nodes.length).fill(0);
    c.edges.forEach(([i, j]) => { deg[i]++; deg[j]++; });
    ok(V.length === 12 && T.length === 20 && W2.length === 30, e.pdb + ' icosahedron: 12 vertices, 20 faces, 30 edge nodes');
    ok(V.every(q => onAxis(q.p, ax, 5)) && T.every(q => onAxis(q.p, ax, 3)) && W2.every(q => onAxis(q.p, ax, 2)), e.pdb + ' vertices on 5-fold, faces on 3-fold, edge nodes on 2-fold axes');
    ok(c.edges.length === 30 && deg.slice(0, 12).every(v => v === 5), e.pdb + ' 30 edges, 5 at each vertex');
    // each edge's midpoint points down a 2-fold axis
    ok(c.edges.every(([i, j]) => onAxis([c.nodes[i].p[0] + c.nodes[j].p[0], c.nodes[i].p[1] + c.nodes[j].p[1], c.nodes[i].p[2] + c.nodes[j].p[2]], ax, 2)), e.pdb + ' every edge midpoint on a 2-fold axis');
    ok(c.nodes.every(q => near(Math.hypot(...q.p), R, 1e-6)), e.pdb + ' cage nodes on the sphere of radius R');
    const d = D[e.pdb], nc = d.info.chains.length, keep = d.info.chains.map(ch => d.info.entities[ch[2]].role === 'main');
    const net = CG.unitNet(S.unitCentroids(d, ops), nc, keep), nk = keep.filter(Boolean).length;
    const dg = new Array(net.nodes.length).fill(0);
    net.edges.forEach(([i, j]) => { dg[i]++; dg[j]++; });
    ok(net.nodes.length === 60 * nk && dg.every(v => v >= 1), e.pdb + ' subunit net: ' + net.nodes.length + ' nodes (60 x ' + nk + '), ' + net.edges.length + ' edges, none alone');
  }
  for (const [id, n, look] of [['4UDV', 2130, 'rod'], ['3J3Q', 1356, 'cone'], ['7LNA', 60, 'fibril']]) {
    const d = D[id], ops = F.copyOps(d.info, id === '7LNA' ? 60 : undefined), nc = d.info.chains.length;
    const keep = d.info.chains.map(ch => d.info.entities[ch[2]].role === 'main');
    const net = CG.unitNet(S.unitCentroids(d, ops), nc, keep);
    const dg = new Array(net.nodes.length).fill(0);
    net.edges.forEach(([i, j]) => { dg[i]++; dg[j]++; });
    console.log('  ' + id + ' ' + look + ': ' + net.nodes.length + ' nodes, ' + net.edges.length + ' edges, mean degree ' + (2 * net.edges.length / net.nodes.length).toFixed(2));
    ok(net.nodes.length === n && dg.every(v => v >= 1), id + ' ' + look + ' net: ' + n + ' nodes, none alone');
  }
  // a fibril net joins each layer to the next: edges along the axis
  const d7 = D['7LNA'], o7 = F.copyOps(d7.info, 60), n7 = CG.unitNet(S.unitCentroids(d7, o7), 1, [true]);
  ok(n7.edges.every(([i, j]) => Math.abs(i - j) === 1), '7LNA net joins each layer to the next one only');
  const sp = CG.unitNet(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 5, 1, 0, 5]), 2, [true, true], { perCopy: true });
  ok(sp.nodes.length === 2 && near(sp.nodes[0].p[0], 0.5, 1e-9) && sp.nodes[1].unit === 2, 'per-copy nodes: the mean of a copy, moved by its first unit');
}

// ── 17 views on the GPU ──────────────────────────────────────────────────
section('17 views on the GPU (phone and desktop)');
{
  const blobN = {}, netN = {};
  const sizes = e => {
    // the same totals main.js buildEntry uses (a virion: all its spikes)
    if (e.look === 'virion') return e.parts.map(p => ({ id: p.pdb, n: D[p.pdb].n, m: p.count }));
    return [{ id: e.pdb, n: D[e.pdb].n, m: F.copyOps(D[e.pdb].info, e.layers).length / 12 }];
  };
  let worst = { b: 0 }, peak = {};
  for (const coarse of [true, false]) {
    const tri = { beads: 0, tube: 0, blob: 0 };
    for (const e of C.ENTRIES) {
      const ps = sizes(e), tot = ps.reduce((a, p) => a + p.n * p.m, 0);
      const bs = Math.max(1, Math.ceil(tot / B.maxInstances(coarse))), ts = Math.max(1, Math.ceil(tot / B.tubeCap(coarse)));
      let inst = 0, segs = 0, blobs = 0, bytes = 0;
      for (const p of ps) {
        const d = D[p.id], nc = d.info.chains.length;
        blobN[p.id] = blobN[p.id] || BL.chainBlobs(d).n;
        inst += Math.ceil(p.n / (e.look === 'virion' ? bs : B.strideFor(p.n, p.m, B.maxInstances(coarse)))) * p.m;
        segs += Math.ceil(p.n / (e.look === 'virion' ? ts : B.strideFor(p.n, p.m, B.tubeCap(coarse)))) * p.m;
        blobs += blobN[p.id] * p.m;
        for (const rep of B.REPS) {
          const z = { nBeads: p.n, nOps: p.m, nUnits: p.m * nc, nChains: nc, nBlobs: blobN[p.id], nNodes: p.m * nc, nEdges: 3 * p.m * nc, coarse };
          const by = B.repGpuBytes(rep, z);
          if (by > worst.b) worst = { b: by, rep, key: e.key };
          bytes = Math.max(bytes, by);
        }
      }
      const m = (ps.reduce((a, p) => a + p.m, 0));
      ok(inst <= B.maxInstances(coarse) + m, (coarse ? 'phone ' : 'desktop ') + e.key + ': ' + inst + ' bead quads <= ' + B.maxInstances(coarse));
      ok(segs <= B.tubeCap(coarse) + m, (coarse ? 'phone ' : 'desktop ') + e.key + ': ' + segs + ' tube segments <= ' + B.tubeCap(coarse));
      ok(blobs <= B.blobCap(coarse), (coarse ? 'phone ' : 'desktop ') + e.key + ': ' + blobs + ' blobs <= ' + B.blobCap(coarse));
      ok(bytes < B.DATA_BUDGET, (coarse ? 'phone ' : 'desktop ') + e.key + ': view data ' + (bytes / 1e6).toFixed(2) + ' MB < ' + B.DATA_BUDGET / 1e6 + ' MB');
      const mesh = B.tubeMesh(coarse);
      tri.beads = Math.max(tri.beads, 2 * inst); tri.tube = Math.max(tri.tube, segs * (mesh.rings - 1) * mesh.sides * 2); tri.blob = Math.max(tri.blob, blobs * 12);
    }
    peak[coarse ? 'phone' : 'desktop'] = tri;
    console.log('  ' + (coarse ? 'phone  ' : 'desktop') + ' peak triangles: beads ' + (tri.beads / 1e6).toFixed(2) + ' M, tube ' + (tri.tube / 1e6).toFixed(2) + ' M, blobs ' + (tri.blob / 1e6).toFixed(2) + ' M');
  }
  console.log('  largest view data: ' + worst.rep + ' of ' + worst.key + ', ' + (worst.b / 1e6).toFixed(2) + ' MB');
  ok(peak.phone.tube <= 1.5e6 && peak.phone.beads <= 0.6e6 && peak.phone.blob <= 1.0e6, 'phone: at most 1.5 M tube, 0.6 M bead and 1.0 M blob triangles a frame');
  const hiv = B.repGpuBytes('blob', { nBeads: 313236, nOps: 1, nUnits: 1356, nChains: 1356, nBlobs: blobN['3J3Q'], coarse: true });
  ok(hiv < 12e6, 'HIV cone in the blob view on a phone: ' + (hiv / 1e6).toFixed(2) + ' MB of data');
  // phone canvases: no MSAA at a high pixel ratio, pixel ratio at most 2
  for (const [w, h, dpr] of [[360, 640, 3], [390, 844, 3], [640, 360, 3], [844, 390, 3], [412, 915, 2.625], [768, 1024, 2], [1024, 768, 2]]) {
    const b = B.canvasBudget(w, h, dpr, { coarse: true });
    ok(b.px <= B.PHONE_PX * 1.002 && b.pr <= 2 && !(b.samples && b.pr >= 1.5) && b.bytes < 30e6, 'phone ' + w + 'x' + h + ' @' + dpr + ': pixel ratio ' + b.pr + ', ' + (b.samples ? 'MSAA' : 'no MSAA') + ', ' + (b.bytes / 1e6).toFixed(1) + ' MB');
  }
  ok(B.tubeMesh(true).rings * B.tubeMesh(true).sides < B.tubeMesh(false).rings * B.tubeMesh(false).sides, 'phone tube mesh is lighter than the desktop one');
  ok(B.REPS.length === 7 && new Set(B.REPS).size === 7, 'seven views');
}

// ── 18 phone layout ──────────────────────────────────────────────────────
section('18 phone layout (style.css and index.html)');
{
  const css = readFileSync(join(HERE, 'style.css'), 'utf8'), html = readFileSync(join(HERE, 'index.html'), 'utf8');
  const block = q => { const i = css.indexOf(q); if (i < 0) return ''; let d = 0, j = css.indexOf('{', i); const s0 = j; for (; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}' && --d === 0) break; } return css.slice(s0, j); };
  const touch = block('@media (pointer:coarse), (max-width:768px)');
  ok(/\.seg button,\.btns button\{min-height:44px/.test(touch) && /\.chips button\{min-height:44px/.test(touch) && /\.prm select\{min-height:44px/.test(touch), 'touch block: view buttons, chips and selects are 44 px or more');
  const narrow = block('@media (max-width:400px), (max-height:500px) and (orientation:landscape) and (pointer:coarse)');
  const px = re => +(re.exec(narrow) || [])[1];
  const btn = px(/#dock > button\{flex-basis:(\d+)px/), rep = px(/#dock > button\.rep\{flex-basis:(\d+)px/), gap = px(/#dock\{gap:(\d+)px/);
  const nBtn = (html.match(/<nav id="dock"[\s\S]*?<\/nav>/)[0].match(/<button /g) || []).length;
  ok(nBtn === 6, 'the dock has 6 buttons (' + nBtn + ')');
  for (const [w, label] of [[360, '360 px portrait'], [Math.min(440, 0.56 * 640), 'landscape tab at 640 x 360'], [Math.min(440, 0.56 * 740), 'landscape tab at 740 x 360']]) {
    const name = w - 20 - (nBtn - 2) * btn - rep - (nBtn - 1) * gap;
    console.log('  ' + label + ': dock name ' + name.toFixed(0) + ' px, buttons ' + btn + ' px');
    ok(name >= 80 && btn >= 44, label + ': dock name gets ' + name.toFixed(0) + ' px, buttons ' + btn + ' px');
  }
  ok(/\.prm select\{[^}]*max-width:min\(62vw/.test(css), 'selects are capped, so a long option cannot widen the sheet');
  ok(/#view\{[^}]*touch-action:none/.test(css), 'the canvas takes every touch (pinch, drag, tap)');
  ok(/html\{overflow-x:hidden\}/.test(css) && !/body\{[^}]*overflow-x/.test(css), 'overflow-x on html only (sticky bars keep working)');
  ok(/id="repSeg"/.test(html) && /id="dockRep"/.test(html) && /id="palSel"/.test(html), 'view row, dock view button and palette select are in the page');
}

// ── 19 regions ───────────────────────────────────────────────────────────
section('19 regions (regions.js on the real data)');
const RG = await import(join(HERE, 'regions.js'));
const regionData = {};
function regionsFor(e) {
  if (regionData[e.key]) return regionData[e.key];
  const id = C.pdbsOf(e)[0], d = D[id];
  let ops = F.copyOps(d.info, e.layers);
  if (e.look === 'virion') {
    const env = S.envelopeOps({ R: e.membrane.r, tilt: e.tilt || 0, parts: e.parts.map(p => ({ count: p.count, stalk: p.stalk, base: D[p.pdb].info.anchor.base / 10 })) }, S.makeRng(11).next);
    ops = env.ops[0];
  }
  const axes = d.info.sym.type === 'icosa' ? S.axesOf(ops) : [];
  const T = RG.unitTable(d, ops);
  const caps = e.look === 'capsid' || e.look === 'cone' ? RG.capsomers(T, e, axes) : [];
  const regs = RG.regionsOf(e, [{ d, ops, axes, T, caps }]);
  return (regionData[e.key] = { d, ops, axes, T, caps, regs, byKind: Object.fromEntries(regs.map(r => [r.kind, r])) });
}
{
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))));
  for (const e of C.ENTRIES) {
    const want = RG.REGION_KINDS[e.key];
    if (!want) continue;
    const R = regionsFor(e), have = R.regs.map(r => r.kind);
    console.log('  ' + e.key.padEnd(13) + R.regs.map(r => r.kind + ' ' + r.inst.length + ' x ' + r.n).join(', '));
    ok(want.every(k => have.includes(k)), e.key + ': region kinds ' + want.join(', ') + ' (found ' + have.join(', ') + ')');
    ok(R.regs.every(r => r.inst.every(x => x.units.length > 0 && x.units.every(u => u >= 0 && u < R.T.U))), e.key + ': every region unit is a real unit');
  }
  // pentamers: 12, each 5 copies of one chain at one angle round a 5-fold axis
  for (const key of P.CAPSIDS) {
    const R = regionsFor(C.entryByKey(key)), pr = R.byKind.pentamer, fives = R.axes.filter(a => a.order === 5).map(a => a.dir);
    let bad = 0;
    for (const x of pr.inst) {
      const ks = new Set(x.units.map(u => Math.floor(u / R.T.nc))), cs = new Set(x.units.map(u => u % R.T.nc));
      const a = x.units.map(u => ang(R.T.dir(u), x.axis));
      const onAxis = fives.some(f => Math.min(ang(f, x.axis), Math.PI - ang(f, x.axis)) < 0.01);
      if (x.units.length !== 5 || ks.size !== 5 || cs.size !== 1 || Math.max(...a) - Math.min(...a) > 2e-3 || !onAxis) bad++;
    }
    ok(pr.inst.length === 12 && bad === 0, key + ': 12 pentamers, each 5 copies of chain ' + R.d.info.chains[pr.inst[0].units[0] % R.T.nc][0] + ' at one angle round a 5-fold axis (' + bad + ' bad)');
    const all = new Set(pr.inst.flatMap(x => x.units));
    ok(all.size === 60, key + ': the 12 pentamers hold 60 different units');
  }
  // hexamers where the capsid has them
  const HEX = { polio: 20, rhino: 20, noro: 20, hbv: 30, hk97: 60 };
  for (const [key, nWant] of Object.entries(HEX)) {
    const R = regionsFor(C.entryByKey(key)), hx = R.byKind.hexamer;
    const bad = hx.inst.filter(x => x.units.length !== 6).length;
    const all = new Set(hx.inst.flatMap(x => x.units));
    ok(hx.inst.length === nWant && bad === 0 && all.size === 6 * nWant, key + ': ' + hx.inst.length + ' hexamers of 6 units (want ' + nWant + '), no unit in two');
  }
  ok(!regionsFor(C.entryByKey('hpv')).byKind.hexamer && !regionsFor(C.entryByKey('zika')).byKind.hexamer, 'HPV and Zika have no hexamers (HPV: 72 pentamers)');
  {
    const R = regionsFor(C.entryByKey('hpv')), p6 = R.byKind.pentamer6;
    ok(p6.inst.length === 60 && p6.inst.every(x => x.units.length === 5), 'HPV: 60 pentamers on 6-coordinated sites, 5 L1 each; with the 12 on 5-fold axes, 72');
  }
  {
    const R = regionsFor(C.entryByKey('adeno')), tr = R.byKind.trimer;
    const hexon = tr.inst.every(x => x.units.length === 3 && x.units.every(u => R.T.ent[u % R.T.nc] === 0));
    ok(tr.inst.length === 240 && hexon, 'adenovirus: ' + tr.inst.length + ' hexon trimers of 3 hexon chains (want 240)');
  }
  {
    const R = regionsFor(C.entryByKey('hiv-cone'));
    const hx = R.byKind.hexamer, pn = R.byKind.pentamer;
    ok(hx.inst.length >= 180 && hx.inst.length <= 216 && hx.inst.every(x => x.units.length === 6), 'HIV cone: ' + hx.inst.length + ' CA hexamers found by contact (of 216), 6 chains each');
    ok(pn.inst.length >= 10 && pn.inst.length <= 12 && pn.inst.every(x => x.units.length === 5), 'HIV cone: ' + pn.inst.length + ' CA pentamers found by contact (of 12), 5 chains each');
  }
  {
    const R = regionsFor(C.entryByKey('sars2-virion')), sp = R.byKind.spike;
    const mains = x => x.units.filter(u => R.T.role[u % R.T.nc] === 'main');
    ok(sp.inst.length === 26 && sp.inst.every(x => mains(x).length === 3 && new Set(mains(x).map(u => Math.floor(u / R.T.nc))).size === 1), 'SARS-CoV-2 virion: 26 spikes, each a trimer of 3 spike chains of one copy');
    const S1 = regionsFor(C.entryByKey('spike')).byKind.protomer;
    ok(S1.inst.length === 3 && S1.inst.every(x => x.units.length === 1), 'spike: 3 protomers, one chain each');
    const rb = regionsFor(C.entryByKey('rbd-ace2')).byKind.rbd, T6 = regionsFor(C.entryByKey('rbd-ace2')).T;
    ok(rb.inst.length === 1 && rb.inst[0].units.length === 1 && T6.d.info.chains[rb.inst[0].units[0]][0] === 'B', 'RBD on ACE2: the RBD is chain B; ACE2 (the receptor) is not in it');
  }
  for (const key of P.CAPSIDS) {
    const R = regionsFor(C.entryByKey(key)), f = R.byKind.face, keep = c => R.T.role[c] === 'main' || R.T.role[c] === 'nucleic';
    let nKeep = 0; for (let c = 0; c < R.T.nc; c++) if (keep(c)) nKeep++;
    const all = f.inst.flatMap(x => x.units);
    ok(f.inst.length === 20 && f.inst.every(x => x.units.length === 3 * nKeep) && new Set(all).size === 60 * nKeep, key + ': 20 faces of 3 copies (' + 3 * nKeep + ' units), every unit in one face');
  }
  {
    const R = regionsFor(C.entryByKey('tmv')), sec = R.byKind.section, h = R.d.info.helix, spt = 2 * Math.PI / Math.abs(h.twist);
    const ks = new Set(sec.inst[0].units.map(u => Math.floor(u / R.T.nc)));
    ok(near(ks.size / spt, 3, 0.05), 'TMV: a section is ' + ks.size + ' subunits, 3 turns of ' + spt.toFixed(2));
    const L = regionsFor(C.entryByKey('tau')).byKind.layers;
    ok(L.inst.every(x => new Set(x.units.map(u => Math.floor(u / 2))).size === 5 && x.units.length === 10), 'tau: 5 layers of 2 protofilament chains');
    const fl = regionsFor(C.entryByKey('tau')).byKind.filament;
    ok(fl.inst.length === 2 && fl.inst.every(x => x.units.length === 60 && new Set(x.units.map(u => u % 2)).size === 1), 'tau: 2 protofilaments of 60 layers');
  }
  // region extents are physical (nm)
  const ext = (key, kind) => { const R = regionsFor(C.entryByKey(key)), g = R.byKind[kind].inst[0]; return 2 * RG.regionExtent(R.T, g.units, g.centre); };
  const pe = ext('polio', 'pentamer'), sp = ext('sars2-virion', 'spike');
  ok(pe > 10 && pe < 20 && sp > 12 && sp < 25, 'sizes: poliovirus VP1 pentamer ' + pe.toFixed(1) + ' nm, a SARS-CoV-2 spike ' + sp.toFixed(1) + ' nm across');
  ok(RG.chainsText(regionsFor(C.entryByKey('polio')).T, regionsFor(C.entryByKey('polio')).byKind.pentamer.inst[0].units) === '5 × coat protein VP1 (chain A)', 'plate text: "5 × coat protein VP1 (chain A)"');
}

// ── 20 the exploded view ─────────────────────────────────────────────────
section('20 exploded view (regions.js explodePlan, explodeAmount, TIMELINE)');
{
  const cases = [['polio', 5, 'distance'], ['hbv', 3, 'ring'], ['adeno', 2, 'copy'], ['hpv', 'cap', 'type'], ['noro', 'cap', 'type'], ['hk97', -1, 'distance'], ['hiv-cone', 'cap', 'distance'], ['sars2-virion', -1, 'ring']];
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1))));
  for (const [key, mode, stagger] of cases) {
    const e = C.entryByKey(key), R = regionsFor(e), T = R.T;
    const plan = RG.explodePlan(T, { mode, stagger, pole: [0.3, 0.8, 0.5], axes: R.axes, caps: R.caps, look: e.look });
    const dirAt = u => [plan.dirs[3 * u], plan.dirs[3 * u + 1], plan.dirs[3 * u + 2]];
    let off = 0, unit = 0, keyBad = 0, groupBad = 0;
    for (let u = 0; u < T.U; u++) {
      const d = dirAt(u);
      if (Math.abs(Math.hypot(...d) - 1) > 1e-5) unit++;
      if (!(plan.keys[u] >= 0 && plan.keys[u] <= 1)) keyBad++;
      if (typeof mode === 'number' && mode > 0) {
        // along the nearest axis of that order (15 % tilt to the unit)
        const best = Math.min(...R.axes.filter(a => a.order === mode).map(a => Math.min(ang(a.dir, d), Math.PI - ang(a.dir, d))));
        if (best > 0.2) off++;
      } else if (mode === 'cap') {
        const g = plan.groups[plan.group[u]];
        if (ang(g.dir, d) > 1e-4) off++;
      } else if (ang(T.dir(u), d) > 1e-4) off++;
      if (Math.abs(plan.keys[u] - plan.groups[plan.group[u]].key) > 1e-6) groupBad++;
    }
    const what = mode === 'cap' ? 'capsomer centre lines' : mode === -1 ? 'radial lines' : mode + '-fold axes';
    ok(off === 0 && unit === 0, key + ': ' + T.U + ' units move along ' + what + ' (' + off + ' off the line)');
    ok(keyBad === 0 && groupBad === 0, key + ': stagger keys in [0, 1], one key per part (' + stagger + ', ' + plan.groups.filter(g => g.units.length).length + ' parts)');
    // monotone in time, stagger, and every unit back at rest at exT 0
    const amp = 0.5 * 30;
    let mono = 0, rest = 0, full = 0, lead = 0;
    for (let u = 0; u < T.U; u += Math.max(1, Math.floor(T.U / 300))) {
      let prev = -1;
      for (let i = 0; i <= 40; i++) {
        const o = RG.unitOffset(plan, u, i / 40, 0.6, amp), len = Math.hypot(...o);
        if (len < prev - 1e-9) mono++;
        if (len > 1e-9 && ang(o, dirAt(u)) > 1e-4) mono++;
        prev = len;
      }
      if (Math.hypot(...RG.unitOffset(plan, u, 0, 0.6, amp)) !== 0) rest++;
      if (!near(Math.hypot(...RG.unitOffset(plan, u, 1, 0.6, amp)), amp, 1e-6)) full++;
    }
    for (let u = 0; u < T.U; u++) for (const v of [0, Math.floor(T.U / 2)]) if (plan.keys[u] < plan.keys[v] - 1e-6 && RG.explodeAmount(0.4, plan.keys[u], 0.6) < RG.explodeAmount(0.4, plan.keys[v], 0.6) - 1e-9) lead++;
    ok(mono === 0 && full === 0, key + ': offsets grow along the direction as exT goes 0 -> 1 and reach the full ' + amp + ' nm');
    ok(rest === 0 && lead === 0, key + ': a lower key leaves first; at exT 0 every unit is at rest');
  }
  // the timelines
  let mono = 0;
  for (const hold of [false, true]) {
    let prev = -1;
    for (let i = 0; i <= 200; i++) { const v = RG.TIMELINE.exview(i / 200, hold); if (i / 200 < 0.5 && v < prev - 1e-12) mono++; prev = v; }
  }
  ok(mono === 0, 'exview: exT never falls while the shell opens');
  ok(RG.TIMELINE.exview(0, false) === 0 && RG.TIMELINE.exview(0.5, false) === 1 && RG.TIMELINE.exview(1, false) === 0, 'exview: closed at the start, open in the hold, closed again (every unit back at rest) at the end');
  ok(RG.TIMELINE.exview(1, true) === 1 && RG.TIMELINE.inspectEx(0, true) === 1 && RG.TIMELINE.inspectEx(1, true) === 0, 'chapter: an exview that holds hands an open shell to the inspect shot, which closes it by its end');
  ok(RG.TIMELINE.iso(0) === 0 && RG.TIMELINE.iso(0.5) === 1 && RG.TIMELINE.iso(1) === 0, 'inspect: the region lifts out, holds and rejoins the whole');
  // the GPU table
  const R = regionsFor(C.entryByKey('polio')), pl = RG.explodePlan(R.T, { mode: 5, axes: R.axes, look: 'capsid' });
  const g = R.byKind.pentamer.inst[0], t = RG.selTable(R.T, pl, g.units, g.centre), a = K.packSel(t);
  let badT = 0;
  for (let u = 0; u < R.T.U; u++) {
    if (a[8 * u] !== pl.dirs[3 * u] || a[8 * u + 3] !== pl.keys[u]) badT++;
    if (a[8 * u + 7] !== (g.units.includes(u) ? 1 : 0)) badT++;
  }
  ok(badT === 0 && a.length % (4 * K.ROW) === 0, 'packSel: 2 texels per unit (direction + key, away + selected); 5 units selected');
}

// ── 21 framing ───────────────────────────────────────────────────────────
section('21 framing of an inspected region (clear band, portrait and landscape)');
{
  // bands like the plate leaves (saver.js caps t + b at 80 % of h)
  const frames = [{ w: 390, h: 844, t: 0.3, b: 0.36, label: 'portrait 390 x 844' }, { w: 1280, h: 800, t: 0.33, b: 0.35, label: 'landscape 1280 x 800' }, { w: 844, h: 390, t: 0.3, b: 0.34, label: 'phone landscape 844 x 390' }];
  const norm3 = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const rot = (v, k, th) => { const c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]; return [0, 1, 2].map(i => v[i] * c + kv[i] * s + k[i] * kd * (1 - c)); };
  for (const fr of frames) {
    const view = { w: fr.w, h: fr.h, fov: 32, occ: { l: 0, r: 0, t: fr.t * fr.h, b: fr.b * fr.h } };
    let worst = 0, n = 0, out = 0, outNear = 0;
    for (const e of C.ENTRIES) {
      if (!RG.REGION_KINDS[e.key]) continue;
      const R = regionsFor(e);
      for (const reg of R.regs) for (const x of reg.inst.slice(0, 2)) {
        const ext = RG.regionExtent(R.T, x.units, x.centre, x.units.length > 60 ? 3 : 1);
        const dist = RG.fitDistance(ext * 1.12 + 1, view);
        const axis = x.axis || [1, 0, 0], side = norm3(cross(axis, Math.abs(axis[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]));
        // the turn of the near pose: tilt 0.35..0.6, a spin of up to 1.5 rad
        for (const tilt of [0.35, 0.6]) for (const spin of [-0.75, 0, 0.75]) {
          const d = rot(norm3(axis.map((v, i) => v + side[i] * tilt)), axis, spin);
          const eye = x.centre.map((v, i) => v + d[i] * dist);
          for (const u of x.units) {
            const k = Math.floor(u / R.T.nc), ch = u % R.T.nc, idx = R.d._byChain[ch], o = 12 * k;
            for (let j = 0; j < idx.length; j += 4) {
              const i = idx[j], px = R.d.pos[3 * i], py = R.d.pos[3 * i + 1], pz = R.d.pos[3 * i + 2];
              const p = [0, 1, 2].map(rw => R.ops[o + 4 * rw] * px + R.ops[o + 4 * rw + 1] * py + R.ops[o + 4 * rw + 2] * pz + R.ops[o + 4 * rw + 3]);
              const q = RG.screenOf(p, eye, x.centre, view);
              n++;
              // control: at 0.6 of the distance the test must see beads out
              const eye2 = x.centre.map((v, i2) => v + d[i2] * dist * 0.6), q2 = RG.screenOf(p, eye2, x.centre, view);
              if (q2.y < view.occ.t || q2.y > fr.h - view.occ.b || q2.x < 0 || q2.x > fr.w) outNear++;
              const m = Math.max(view.occ.t - q.y, q.y - (fr.h - view.occ.b), -q.x, q.x - fr.w);
              if (m > 0) { out++; worst = Math.max(worst, m); }
            }
          }
        }
      }
    }
    ok(out === 0, fr.label + ': ' + n + ' bead positions of every region kind stay in the clear band (' + out + ' out, worst ' + worst.toFixed(1) + ' px)');
    ok(outNear > 0, fr.label + ': control: at 0.6 of the fit distance ' + outNear + ' bead positions leave the band, so the check can fail');
    console.log('  ' + fr.label + ': band ' + (fr.h * (1 - fr.t - fr.b)).toFixed(0) + ' px, ' + n + ' bead positions inside; at 0.6 of the distance ' + outNear + ' outside');
  }
}

// ── 22 build and take-apart ──────────────────────────────────────────────
section('22 build and take-apart (the explode run backwards, fade, key flip, rod lines)');
{
  const fadeSize = ex => { const t = Math.min(1, Math.max(0, (ex - 0.55) / 0.45)); return 1 - t * t * (3 - 2 * t); };
  let monoBad = 0, startBad = 0, endBad = 0, n = 0;
  for (const key of LK.VIRUS_KEYS) {
    const e = C.entryByKey(key), R = regionsFor(e), V0 = LK.VIRUSES[key];
    for (const ex of [...V0.build, ...V0.apart]) {
      const mode = ex === 'cap' ? 'cap' : ex, pl = RG.explodePlan(R.T, { mode, stagger: 'distance', pole: [0.3, 0.8, 0.5], axes: R.axes, caps: R.caps, look: e.look });
      for (let u = 0; u < R.T.U; u += Math.max(1, Math.floor(R.T.U / 200))) {
        n++;
        // build: exT = 1 - lin(t, 0, 0.84), stagger 0.72
        let prev = Infinity;
        for (let i = 0; i <= 50; i++) {
          const t = i / 50, exT = 1 - Math.min(1, t / 0.84), a = RG.explodeAmount(exT, pl.keys[u], 0.72);
          if (a > prev + 1e-12) monoBad++;
          prev = a;
        }
        if (fadeSize(RG.explodeAmount(1, pl.keys[u], 0.72)) !== 0) startBad++;
        if (RG.explodeAmount(0, pl.keys[u], 0.72) !== 0) monoBad++;
        // apart: exT = lin(t, 0.06, 0.97), stagger 0.6: size 0 at the end
        if (fadeSize(RG.explodeAmount(1, pl.keys[u], 0.6)) !== 0) endBad++;
      }
    }
  }
  ok(monoBad === 0, n + ' unit samples: in a build every unit flies in monotonically and lands at rest');
  ok(startBad === 0 && endBad === 0, 'a build starts with every unit at size 0 and a take-apart ends with every unit at size 0 (glsl.js uSelFade)');
  // pentamers first: the build flips the 'type' keys, and a unit lands at exT = key * stag
  const R = regionsFor(C.entryByKey('hk97')), pl = RG.explodePlan(R.T, { mode: 'cap', stagger: 'type', pole: [0, 1, 0], axes: R.axes, caps: R.caps, look: 'capsid' });
  const pent = new Set(R.byKind.pentamer.inst.flatMap(x => x.units));
  let pk = 0, pn = 0, hk = 0, hn = 0;
  for (let u = 0; u < R.T.U; u++) { const k = 1 - pl.keys[u]; if (pent.has(u)) { pk += k; pn++; } else if (R.T.big[u % R.T.nc]) { hk += k; hn++; } }
  ok(pn > 0 && pk / pn > hk / hn + 0.3, 'HK97 build, pentamers first: pentamers land at exT ' + (0.72 * pk / pn).toFixed(2) + ' (mean), the rest at ' + (0.72 * hk / hn).toFixed(2));
  // the rod: the lines leave the rod axis
  const Rt = regionsFor(C.entryByKey('tmv')), pt = RG.explodePlan(Rt.T, { mode: -1, stagger: 'distance', pole: [0, 1, 0], look: 'rod' });
  let rodBad = 0;
  for (let u = 0; u < Rt.T.U; u++) if (Math.abs(pt.dirs[3 * u + 1]) > 1e-6) rodBad++;
  ok(rodBad === 0, 'TMV: ' + Rt.T.U + ' subunits fly out from the rod axis (no motion along the rod)');
  // the virus table against the data
  let trBad = 0;
  for (const key of LK.VIRUS_KEYS) {
    const e = C.entryByKey(key), d = D[C.pdbsOf(e)[0]], t = LK.TRAITS[key];
    if (d.info.entities.filter(x => x.role === 'main').length !== t.mains || (e.look !== 'cone' && d.info.chains.length !== t.nc)) { trBad++; console.log('  traits ' + key); }
  }
  ok(trBad === 0, 'saver-look.js TRAITS match the data (main proteins, chains per unit)');
  const capOf = (key, kind) => (regionsFor(C.entryByKey(key)).byKind[kind] || { inst: [] }).inst.length;
  ok(capOf('polio', 'pentamer') === 12 && capOf('rhino', 'pentamer') === 12 && capOf('hk97', 'pentamer') === 12 && capOf('hk97', 'hexamer') === 60 && capOf('hpv', 'pentamer') + capOf('hpv', 'pentamer6') === 72 && capOf('adeno', 'trimer') === 240,
    'plate assembly units match the capsomers found in the data: polio and rhino 12 pentamers, HK97 60 + 12, HPV 72 pentamers, adenovirus 240 hexon trimers');
}

// ── 23 saver run in node ─────────────────────────────────────────────────
section('23 saver run in node (saver.js on a stub of main.js)');
{
  const { register } = await import('node:module');
  const threeURL = new URL('../../vendor/three@0.160.0/build/three.module.js', import.meta.url).href;
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true }; return n(s, c); }`));
  const THREE = await import(threeURL);
  globalThis.window = globalThis;
  globalThis.document = { documentElement: { classList: { add() {}, remove() {} } } };
  const { installSaver } = await import(join(HERE, 'saver.js'));
  const W0 = 390, H0 = 844, occ = { l: 0, r: 0, t: 0.3 * H0, b: 0.36 * H0 };
  const camera = new THREE.PerspectiveCamera(32, W0 / H0, 0.1, 5000);
  const G = { key: 'polio', color: 'auto', axes: false, orbit: true, breathe: true, sway: true, mode: 'entry', rep: 'auto', pal: 'atlas' };
  const A = { asm: 1, explode: 0, explodeT: 0, peel: 0, peelT: 0, slice: 0, sliceT: 0, peelN: new THREE.Vector3(0, 0, 1), sliceN: new THREE.Vector3(0, 0, 1), hiK: -1, camLock: false, tour: null, peelMode: 0, peelReach: 0.5, exOrder: 0, slab: 0, spiral: 5 };
  let cur = null, hooks = [], sels = 0, selBad = 0, backdrops = 0, rigs = 0;
  const loaded = new Set(), shows = [];
  const fit = r => RG.fitDistance(r, { w: W0, h: H0, occ, fov: 32 });
  function build(key) {
    const e = C.entryByKey(key);
    const mk = (d, ops) => {
      const axes = d.info.sym.type === 'icosa' ? S.axesOf(ops) : [], U = d.info.chains.length * ops.length / 12;
      return { d, ops, axes, m: ops.length / 12, nc: d.info.chains.length, setSel(t) { sels++; if (t.keys.length !== U || t.dirs.length !== 3 * U || t.sel.length !== U) selBad++; } };
    };
    let parts, r, b = null;
    if (e.look === 'virion') {
      const env = S.envelopeOps({ R: e.membrane.r, tilt: e.tilt || 0, parts: e.parts.map(p => ({ count: p.count, stalk: p.stalk, base: D[p.pdb].info.anchor.base / 10 })) }, S.makeRng(11).next);
      parts = e.parts.map((p, i) => mk(D[p.pdb], env.ops[i]));
      r = e.membrane.r + 20;
    } else {
      const d = D[e.pdb], ops = F.copyOps(d.info, e.layers);
      parts = [mk(d, ops)];
      b = S.bounds(d, ops, Math.max(1, Math.floor(d.n * ops.length / 12 / 20000)));
      r = b.r;
    }
    return { entry: e, parts, r, bounds: b, axes: parts[0].axes, membrane: e.membrane ? {} : null };
  }
  const built = {};
  const app = {
    G, A, V: { camera, renderer: { domElement: {} } }, controls: { target: new THREE.Vector3() }, occ, size: () => ({ w: W0, h: H0 }),
    REP_LABEL: { beads: 'Beads', space: 'Space-filling', tube: 'Backbone tube', blob: 'Subunit blobs', cage: 'Lattice cage', glow: 'Glow points', toon: 'Outline (toon)' },
    get cur() { return cur; },
    async show(key) {
      shows.push({ key, pre: loaded.has(key) }); loaded.add(key);
      G.key = key; G.mode = 'entry';
      cur = built[key] || (built[key] = build(key));
      cur._tour = null;
      camera.position.set(0.35, 0.3, 1).normalize().multiplyScalar(fit(cur.r)); this.controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0);
      return cur;
    },
    async preload(key) { loaded.add(key); },
    async enterLadder() { G.mode = 'ladder'; cur = null; },
    fitDistance: fit, setRep() {}, applyLook() {}, setPalette(k) { G.pal = k; }, setLight(k) { if (typeof k === 'object') rigs++; }, setBackdrop(o) { if (o && o.inner) backdrops++; }, startAssembly() { A.asm = 0; },
    addHook(f) { hooks.push(f); }, removeHook(f) { hooks = hooks.filter(x => x !== f); }, setBand() {},
  };
  installSaver(app);
  const plates = [];
  let frames = 0, nanCam = 0, errors = 0, apartOpen = 0, apartEnds = 0, buildOpen = 0, buildEnds = 0, inBand = 0, outBand = 0, worst = 0, inspected = 0, beats = 0, turn = 0, zoom = 0;
  const kinds = new Set();
  for (const seed of [7, 2024, 99]) {
    shows.length = 0; loaded.clear();
    window.snSaver.enter({ seed, calm: 0.6, label: info => { if (info) plates.push(info); } });
    let last = null, prevDir = null, prevDist = 0;
    for (let f = 0; f < 30 * 240; f++) {
      await new Promise(r => setImmediate(r));
      try { for (const h of hooks) h(1 / 30); } catch (err) { errors++; if (errors < 4) console.log('  error: ' + err.stack.split('\n').slice(0, 3).join(' | ')); }
      frames++;
      const p = camera.position;
      if (!Number.isFinite(p.x + p.y + p.z)) nanCam++;
      const dbg = window.snSaver.debug();
      if (!dbg) continue;
      kinds.add(dbg.kind);
      if (last && last.beat !== dbg.beat) {
        beats++;
        // a take-apart ends on an empty screen; a build ends closed
        if (last.kind === 'apart') { apartEnds++; if (!(last.exT > 0.999 && last.fade === 1)) apartOpen++; }
        if (last.kind === 'build') { buildEnds++; if (last.exT > 1e-6) buildOpen++; }
        prevDir = null;
      }
      last = { beat: dbg.beat, kind: dbg.kind, exT: dbg.tour ? dbg.tour.exT : 0, fade: dbg.tour ? dbg.tour.fade : 0 };
      // camera speed inside a beat (after the cut)
      const tg = app.controls.target, dv = p.clone().sub(tg), dist = dv.length(); dv.normalize();
      if (prevDir && dbg.t > 0.2) { turn = Math.max(turn, Math.acos(Math.min(1, dv.dot(prevDir))) * 180 / Math.PI * 30); zoom = Math.max(zoom, Math.abs(Math.log(dist / prevDist)) * 30); }
      prevDir = dv; prevDist = dist;
      // the near pose of an inspection: the region in the clear band
      if (dbg.kind === 'inspect' && dbg.t / dbg.dur > 0.51 && dbg.t / dbg.dur < 0.56 && cur && cur._tour && f % 3 === 0) {
        const reg = window.snSaver.region && window.snSaver.region();
        if (reg) {
          inspected++;
          const T = cur._tour.parts[reg.reg.part].T;
          for (const u of reg.inst.units) {
            const k = Math.floor(u / T.nc), ch = u % T.nc, idx = T.d._byChain[ch], o = 12 * k;
            for (let j = 0; j < idx.length; j += 6) {
              const ii = idx[j], px = T.d.pos[3 * ii], py = T.d.pos[3 * ii + 1], pz = T.d.pos[3 * ii + 2];
              const w3 = [0, 1, 2].map(rw => T.ops[o + 4 * rw] * px + T.ops[o + 4 * rw + 1] * py + T.ops[o + 4 * rw + 2] * pz + T.ops[o + 4 * rw + 3]);
              const lift = A.tour ? A.tour.lift : 0, ld = A.tour ? A.tour.liftDir : { x: 0, y: 0, z: 0 };
              const q = RG.screenOf([w3[0] + ld.x * lift, w3[1] + ld.y * lift, w3[2] + ld.z * lift], [p.x, p.y, p.z], [tg.x, tg.y, tg.z], { w: W0, h: H0, occ, fov: 32 });
              const m = Math.max(occ.t - q.y, q.y - (H0 - occ.b), -q.x, q.x - W0);
              if (m > 0) { outBand++; worst = Math.max(worst, m); } else inBand++;
            }
          }
        }
      }
    }
    window.snSaver.exit();
    const rest = shows.slice(1, -1);
    ok(rest.length > 3 && rest.every(x => x.pre) && shows.slice(0, -1).every((x, i, a) => i === 0 || x.key !== a[i - 1].key), 'seed ' + seed + ': ' + rest.length + ' viruses after the first, each preloaded during the virus before, never the same twice in a row');
  }
  console.log('  ' + frames + ' frames (3 seeds x 4 min at 30 fps), beats: ' + [...kinds].join(' ') + '; ' + plates.length + ' plates; ' + sels + ' table uploads; camera turn max ' + turn.toFixed(1) + ' deg/s, zoom max ' + zoom.toFixed(2) + ' /s');
  ok(errors === 0, 'no exception in ' + frames + ' saver frames (' + errors + ')');
  ok(nanCam === 0, 'the camera position stays finite (' + nanCam + ' bad frames)');
  ok(kinds.has('build') && kinds.has('inspect') && kinds.has('apart'), 'the run builds, inspects and takes apart');
  ok(selBad === 0 && sels > 0 && backdrops > 0 && rigs > 0, sels + ' per-unit tables uploaded, every one the size of its part; the looks set the backdrop and the light rig');
  ok(apartEnds > 0 && apartOpen === 0 && buildEnds > 0 && buildOpen === 0, apartEnds + ' take-aparts end on an empty screen and ' + buildEnds + ' builds end closed (' + apartOpen + ', ' + buildOpen + ')');
  ok(turn < 20 && zoom < 0.65, 'the camera turns under 20 deg/s and zooms under 0.65 per s inside a beat (' + turn.toFixed(1) + ', ' + zoom.toFixed(2) + ')');
  ok(plates.length >= beats && plates.length <= beats + 6 && plates.every(p => ['family', 'size', 'subunits', 'built from', 'PDB'].every(n => p.params.some(x => x.name === n && x.value)) && !('code' in p)), plates.length + ' plates for ' + beats + ' beats (one per beat), each with family, size, subunits, assembly unit and PDB, and no code');
  ok(inspected > 0 && outBand / Math.max(1, inBand + outBand) < 0.01, 'inspect near pose (camera spring included): ' + inBand + ' bead positions in the clear band, ' + outBand + ' out (worst ' + worst.toFixed(1) + ' px) over ' + inspected + ' samples');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
