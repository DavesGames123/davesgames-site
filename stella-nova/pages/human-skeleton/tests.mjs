// ============================================================================
//  HUMAN SKELETON  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks the shipped data and the layout code, with no browser:
//    count ...... bones per region against the textbook 206; prints the
//                 table and the reason for each region that differs
//    mesh ....... every manifest entry has its bytes, in range, with
//                 indices below its vertex count
//    pairs ...... every left bone has a right bone: same vertex and
//                 triangle counts, mirrored centre, same length
//    decode ..... each file decodes; positions inside the quantization
//                 box, unit normals, finite numbers
//    meta ....... names, Latin, type, fact, parent, articulations, FMA
//    layout ..... radial, regional and catalogue give finite offsets; no
//                 bone under the floor; no two tray items overlap
//    size ....... shipped data under 15 MB
// ============================================================================
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeBone, decodeGroup } from './decode.js';
import { prep, radial, regional, catalogue, liftToFloor, bounds, delays } from './layout.js';

const here = new URL('.', import.meta.url).pathname;
const M = JSON.parse(readFileSync(here + 'data/manifest.json', 'utf8'));
let pass = 0, fail = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const bones = M.bones;
const byId = new Map(bones.map(b => [b.id, b]));

// ── count ───────────────────────────────────────────────────────────────────
{
  const WHY = {
    ear: 'the ossicles: BodyParts3D has none, and the Z-Anatomy ones trace to a CC BY-NC-SA model (see data/LICENSE.txt)',
  };
  console.log('\n  region              shipped  textbook');
  let shipped = 0, book = 0;
  for (const r of M.regions) {
    const n = bones.filter(b => b.region === r.id && b.counted).length;
    const extra = bones.filter(b => b.region === r.id && !b.counted).length;
    shipped += n; book += r.expected;
    const note = r.expected === 0 ? `(${extra}, outside the 206)` : n !== r.expected ? `<- ${WHY[r.id] || 'MISSING'}` : '';
    console.log(`  ${r.label.padEnd(20)}${String(r.expected ? n : extra).padStart(7)}${String(r.expected || '-').padStart(10)}  ${note}`);
  }
  console.log(`  ${'total'.padEnd(20)}${String(shipped).padStart(7)}${String(book).padStart(10)}\n`);
  ok(book === 206, 'textbook total is 206', `${book}`);
  for (const r of M.regions) {
    if (!r.expected) continue;
    const n = bones.filter(b => b.region === r.id && b.counted).length;
    ok(n === r.expected || (r.id === 'ear' && !M.source.ossicles && n === 0), `count ${r.id}`, `${n}/${r.expected}`);
  }
  ok(shipped === (M.source.ossicles ? 206 : 200), 'counted bones', `${shipped}`);
  ok(new Set(bones.map(b => b.id)).size === bones.length, 'bone ids unique');
}

// ── mesh + decode ───────────────────────────────────────────────────────────
const bufs = {};
{
  for (const f of M.files) {
    const gz = readFileSync(here + f.url);
    const raw = gunzipSync(gz);
    ok(raw.length === f.bytes, `file ${f.id} unzips to its size`, `${raw.length}`);
    bufs[f.id] = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
  }
  let bad = [];
  for (const b of bones) {
    const buf = bufs[b.file];
    if (!buf || !(b.v > 0 && b.t > 0)) { bad.push(b.id + ':empty'); continue; }
    const end = b.off.idx + b.t * 6;
    if (end > buf.byteLength || b.off.pos % 4 || b.off.nrm % 4 || b.off.cav % 4 || b.off.idx % 4) { bad.push(b.id + ':range'); continue; }
    const d = decodeBone(buf, b);
    let mx = 0;
    for (const x of d.idx) mx = Math.max(mx, x);
    if (mx >= b.v) bad.push(b.id + ':index');
    let nbad = 0, out = 0;
    for (let i = 0; i < b.v; i++) {
      const l = Math.hypot(d.nrm[3 * i], d.nrm[3 * i + 1], d.nrm[3 * i + 2]) / 127;
      if (!(l > 0.9 && l < 1.1)) nbad++;
      for (let k = 0; k < 3; k++) {
        const p = d.pos[3 * i + k];
        if (!Number.isFinite(p) || p < b.qmin[k] - 1e-6 || p > b.qmin[k] + b.qsize[k] + 1e-6) out++;
      }
    }
    if (nbad > b.v * 0.01) bad.push(`${b.id}:normals(${nbad})`);
    if (out) bad.push(b.id + ':box');
  }
  ok(bad.length === 0, `every bone has a mesh that decodes (${bones.length} entries)`, bad.slice(0, 8).join(' '));
  for (const f of M.files) {
    const g = decodeGroup(bufs[f.id], bones.filter(b => b.file === f.id));
    ok(g.nv > 0 && g.idx.length === g.nt * 3 && g.pos.every(Number.isFinite), `group ${f.id} merges`, `${g.nv} vertices, ${g.nt} triangles`);
  }
}

// ── pairs ───────────────────────────────────────────────────────────────────
{
  const lefts = bones.filter(b => b.side === 'L');
  const bad = [], own = [];
  let mirrored = 0;
  for (const L of lefts) {
    const R = byId.get(L.id.replace(/-l$/, '-r'));
    if (!R) { bad.push(L.id + ':no right'); continue; }
    if (R.side !== 'R' || R.region !== L.region.replace(/-l$/, '-r') || R.type !== L.type || R.name !== L.name) bad.push(L.id + ':meta');
    // a mirrored right bone is the left mesh reflected: exact. A right bone
    // with its own source mesh (the parietals) must still be its mirror
    // image within 3 mm and 6 % of length.
    const tol = R.mirror ? 1e-3 : 3e-3;
    if (R.mirror) { mirrored++; if (R.v !== L.v || R.t !== L.t) bad.push(`${L.id}:counts ${L.t}/${R.t}`); }
    else own.push(`${L.id.replace(/-l$/, '')} (${L.len}/${R.len} mm)`);
    if (Math.abs(R.c[0] + L.c[0]) > tol || Math.abs(R.c[1] - L.c[1]) > tol || Math.abs(R.c[2] - L.c[2]) > tol) bad.push(L.id + ':centre');
    if (Math.abs(R.len - L.len) > (R.mirror ? 0.5 : 0.06 * L.len)) bad.push(L.id + ':length');
    if (L.c[0] <= 0) bad.push(L.id + ':left on the wrong side');
  }
  const rights = bones.filter(b => b.side === 'R').length;
  ok(bad.length === 0 && rights === lefts.length, `left and right pairs match (${lefts.length} pairs, ${mirrored} mirrored)`,
    bad.length ? bad.slice(0, 8).join(' ') : own.length ? 'own source mesh: ' + own.join(', ') : '');
}

// ── meta ────────────────────────────────────────────────────────────────────
{
  const TYPES = new Set(['long', 'short', 'flat', 'irregular', 'sesamoid', 'tooth', 'cartilage']);
  const bad = [];
  for (const b of bones) {
    if (!b.name || !b.latin || !TYPES.has(b.type) || !b.fact || b.fact.length > 140) bad.push(b.id + ':text');
    if (b.parent && !byId.has(b.parent)) bad.push(b.id + ':parent');
    if (b.parent && !b.joint) bad.push(b.id + ':joint');
    if (b.art.some(a => !byId.has(a))) bad.push(b.id + ':art');
    if (!b.lay || b.lay.q.length !== 4 || Math.abs(Math.hypot(...b.lay.q) - 1) > 1e-3) bad.push(b.id + ':lay');
  }
  ok(bad.length === 0, 'metadata complete', bad.slice(0, 8).join(' '));
  const roots = bones.filter(b => !b.parent).map(b => b.id);
  ok(roots.length === 1 && roots[0] === 'sacrum', 'one root (the sacrum)', roots.join(','));
  const noArt = bones.filter(b => b.counted && !b.art.length).map(b => b.id);
  ok(noArt.length === 1 && noArt[0] === 'hyoid', 'only the hyoid has no articulation', noArt.join(','));
  // bone to bone joints go both ways; a tooth or a cartilage lists its
  // bone, but a bone card lists bones only
  const soft = b => b.type === 'tooth' || b.type === 'cartilage';
  const sym = bones.filter(b => !soft(b) && b.art.some(a => !byId.get(a).art.includes(b.id))).map(b => b.id);
  ok(sym.length === 0, 'bone articulations are symmetric', sym.slice(0, 6).join(','));
  const softArt = bones.filter(b => soft(b) && !b.art.length).map(b => b.id);
  ok(softArt.length === 0, 'every tooth and cartilage lists its bone', softArt.join(','));
  const noFma = bones.filter(b => b.counted && !b.fma).map(b => b.id);
  ok(noFma.length === 0, 'every counted bone has an FMA id', noFma.join(','));
  const spot = [['femur-l', 24475], ['scaphoid-r', 24435], ['frontal', 52734], ['hip-r', 16586]];
  ok(spot.every(([id, f]) => byId.get(id).fma === f), 'FMA spot checks');
  const ft = byId.get('femur-l');
  ok(ft.len > 400 && ft.len < 520, 'femur length is adult', `${ft.len} mm`);
  ok(byId.get('scaphoid-l').art.includes('radius-l') && byId.get('capitate-l').art.includes('mc3-l'), 'wrist joints found by proximity');
}

// ── layout ──────────────────────────────────────────────────────────────────
{
  const P = prep(M);
  const vis = new Uint8Array(P.n).fill(1);
  for (const b of bones) if (b.type === 'cartilage') vis[b.i] = 0;
  const one = new Float32Array(P.n).fill(1);
  const r = liftToFloor(P, radial(P, one), vis);
  ok(r.every(Number.isFinite), 'radial offsets finite');
  let lo = Infinity;
  for (const b of bones) if (vis[b.i]) lo = Math.min(lo, b.qmin[1] + r[b.i * 3 + 1]);
  ok(lo > -1e-6, 'radial: no bone below the floor', `${lo.toFixed(4)}`);
  const hand = new Float32Array(P.n);
  for (const b of bones) if (b.region === 'hand-l') hand[b.i] = 1;
  const h = radial(P, hand);
  const moved = bones.filter(b => Math.hypot(h[b.i * 3], h[b.i * 3 + 1], h[b.i * 3 + 2]) > 1e-6).map(b => b.region);
  ok(moved.length === 27 && moved.every(x => x === 'hand-l'), 'explode one region moves only that region', `${moved.length} moved`);
  const tip = byId.get('dp3-l'), cap = byId.get('capitate-l');
  ok(Math.hypot(...h.slice(tip.i * 3, tip.i * 3 + 3)) > Math.hypot(...h.slice(cap.i * 3, cap.i * 3 + 3)) * 2, 'finger tips travel farther than the carpus');
  const g = regional(P, one);
  ok(g.every(Number.isFinite), 'regional offsets finite');
  for (const sort of ['region', 'size']) {
    const c = catalogue(P, vis, M.regions, sort, 1.6);
    const rects = bones.filter(b => vis[b.i]).map(b => {
      const x = b.c[0] + c.off[b.i * 3] + b.lay.c[0], z = b.c[2] + c.off[b.i * 3 + 2] + b.lay.c[2];
      return [x - b.lay.ext[0] / 2, x + b.lay.ext[0] / 2, z - b.lay.ext[2] / 2, z + b.lay.ext[2] / 2, b.id];
    });
    let hits = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], q = rects[j];
      if (a[0] < q[1] - 1e-4 && q[0] < a[1] - 1e-4 && a[2] < q[3] - 1e-4 && q[2] < a[3] - 1e-4) hits++;
    }
    ok(hits === 0 && c.off.every(Number.isFinite), `catalogue (${sort}): ${rects.length} bones, no overlaps`, `${c.trays.length} trays, table ${c.size.map(v => v.toFixed(2)).join(' x ')} m`);
  }
  const d = delays(P, 'radial');
  ok(d.every(x => x >= 0 && x < 1.2), 'stagger delays in range');
  const bd = bounds(P, new Float32Array(P.n * 3), vis);
  ok(bd.hi[1] > 1.6 && bd.hi[1] < 1.95 && bd.lo[1] > -0.05, 'assembled skeleton stands on the floor', `height ${(bd.hi[1] - bd.lo[1]).toFixed(3)} m`);
}

// ── size ────────────────────────────────────────────────────────────────────
{
  const files = M.files.reduce((s, f) => s + statSync(here + f.url).size, 0);
  const man = statSync(here + 'data/manifest.json').size;
  const tot = files + man;
  ok(tot < 15 * 1048576, 'shipped data under 15 MB', `${(tot / 1048576).toFixed(2)} MB (${M.files.length} files + manifest ${(man / 1024).toFixed(0)} KB)`);
  const tris = bones.reduce((s, b) => s + b.t, 0);
  console.log(`  triangles: ${tris} total, bones ${bones.filter(b => b.counted).reduce((s, b) => s + b.t, 0)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
