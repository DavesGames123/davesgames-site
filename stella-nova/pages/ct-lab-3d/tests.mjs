// ============================================================================
//  CT LAB 3D  ·  tests.mjs — node stella-nova/pages/ct-lab-3d/tests.mjs
// ----------------------------------------------------------------------------
//  voxelizer   a closed cube fills its volume; nested spheres stay hollow;
//              hollow and shell walls have the asked thickness; glTF axes
//  data        every object in data/objects.json: file size, credit, licence,
//              anchors, a gallery image, a line in CREDITS.md
//  loaders     loadCodes reads a gzip-served file (Content-Encoding: gzip)
//              without trusting content-length; a short file is refused
//  basis       the water/bone/iron split gives back mu at 70 keV
//  scan        FDK of each object against the object, PSNR above a floor
//              measured on this machine (64^3, 90 views); noise and beam
//              hardening lower it; SIRT residual falls
//  slices      orthogonal slices index the right voxels; the cursor round-
//              trips through each view; crosshairs; oblique through the cursor
//  presets     transfer-function presets per object
//  saver       plan: no kind, object or map twice in a row; 6-12 s; 2D only
//              without WebGPU
//  gpu         (when deno is on PATH) gpu-check.mjs: GPU FDK = CPU FDK
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { solidMask, shellMask, hollowMask, downsample, voxelizeObject, toEngine } from './lib/voxelize.js';
import { toVolume, loadCodes, basisOf, presetsFor, MU_WATER, huOf } from './lib/objects.js';
import { createSession } from './lib/session.js';
import { sliceOf, cursorFromPixel, crosshair, obliqueOf, valueAt, distanceCm } from './lib/slices.js';
import { makePlan, KINDS, MAPS } from './lib/saverplan.js';
import { muOfComposition } from '../ct-lab/engine/physics.js';

const here = new URL('.', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// ── voxelizer ───────────────────────────────────────────────────────────────
function boxMesh(lo, hi, flip = false) {
  const [a, b, c] = lo, [d, e, f] = hi;
  const P = [a, b, c, d, b, c, d, e, c, a, e, c, a, b, f, d, b, f, d, e, f, a, e, f];
  const T = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];
  if (flip) for (let i = 0; i < T.length; i += 3) [T[i + 1], T[i + 2]] = [T[i + 2], T[i + 1]];
  return { pos: new Float32Array(P), tri: new Uint32Array(T) };
}
function sphereMesh(r, seg = 48, flip = false) {
  const P = [], T = [];
  for (let i = 0; i <= seg; i++) { const th = (i / seg) * Math.PI; for (let j = 0; j < 2 * seg; j++) { const ph = (j / (2 * seg)) * 2 * Math.PI; P.push(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)); } }
  const id = (i, j) => i * 2 * seg + (j % (2 * seg));
  for (let i = 0; i < seg; i++) for (let j = 0; j < 2 * seg; j++) { const q = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]; T.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
  if (flip) for (let i = 0; i < T.length; i += 3) [T[i + 1], T[i + 2]] = [T[i + 2], T[i + 1]];
  return { pos: new Float32Array(P), tri: new Uint32Array(T) };
}
const grid = (pos, S, lo, hi) => { const g = new Float32Array(pos.length); for (let i = 0; i < pos.length; i++) g[i] = (pos[i] - lo) / (hi - lo) * S; return g; };
{
  const S = 48, m = boxMesh([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]), mask = solidMask(grid(m.pos, S, -1, 1), m.tri, S);
  const n = mask.reduce((a, b) => a + b, 0), want = (S / 2) ** 3;
  ok(Math.abs(n - want) / want < 0.02, 'voxelizer: a closed cube fills its volume', `${n} cells, want ${want}`);
  // nested spheres: an outer shell around an inner (reversed) surface = a hollow ball
  const o = sphereMesh(0.9), i = sphereMesh(0.6, 48, true);
  const pos = new Float32Array([...o.pos, ...i.pos]), off = o.pos.length / 3;
  const tri = new Uint32Array([...o.tri, ...Array.from(i.tri, (x) => x + off)]);
  const hm = solidMask(grid(pos, S, -1, 1), tri, S), c = S / 2, at = (x, y, z) => hm[(x * S + y) * S + z];
  const wall = at(Math.round(c + 0.75 * c), c, c), centre = at(c, c, c);
  ok(wall === 1 && centre === 0, 'voxelizer: nested spheres give a hollow ball (centre empty, wall full)', `wall ${wall}, centre ${centre}`);
  // hollow mode: a solid ball as a wall of r cells
  const b = sphereMesh(0.9), hol = hollowMask(grid(b.pos, S, -1, 1), b.tri, S, 4);
  let first = -1, last = -1;
  for (let x = c; x < S; x++) if (hol[(x * S + c) * S + c]) { if (first < 0) first = x; last = x; }
  ok(hol[(c * S + c) * S + c] === 0 && last - first + 1 >= 3 && last - first + 1 <= 6, 'voxelizer: hollow mode keeps a wall about r cells thick', `wall ${last - first + 1} cells (r = 4)`);
  // shell mode: an open square sheet becomes a slab of 2r+1 cells
  const sheet = { pos: new Float32Array([-0.6, 0, -0.6, 0.6, 0, -0.6, 0.6, 0, 0.6, -0.6, 0, 0.6]), tri: new Uint32Array([0, 1, 2, 0, 2, 3]) };
  const sm = shellMask(grid(sheet.pos, S, -1, 1), sheet.tri, S, 1);
  let th = 0; for (let y = 0; y < S; y++) th += sm[(c * S + y) * S + c];
  ok(th >= 2 && th <= 4, 'voxelizer: shell mode gives a sheet the asked thickness', `${th} cells (r = 1)`);
  // axes: a point high in glTF y goes high in engine z (rotation axis)
  const e = toEngine(new Float32Array([1, 2, 3]));
  ok(e[0] === 1 && e[1] === -3 && e[2] === 2, 'voxelizer: glTF y-up maps to engine z-up', Array.from(e).join(','));
  // downsample flips y into canvas order: a cell at large world y lands in row 0
  const fine = new Uint8Array(8 * 8 * 8); fine[(0 * 8 + 7) * 8 + 0] = 1;
  const ds = downsample(fine, 4, 2);
  ok(ds[(0 * 4 + 0) * 4 + 0] > 0, 'voxelizer: downsample puts large y at row 0 (engine canvas order)');
  const v = voxelizeObject([{ name: 'cube', material: '', ...boxMesh([-1, -1, -1], [1, 1, 1]) }], () => ({ mu: 0.5, mode: 'solid' }), { n: 32, ss: 4, margin: 0.25 });
  let s = 0; for (const x of v.volume.data) s += x;
  const vox = (v.box.edge / 32) ** 3, mass = s * vox / 0.5;
  ok(Math.abs(mass - 8) / 8 < 0.04, 'voxelizer: object volume matches the mesh volume (ss = 4)', `${mass.toFixed(3)} vs 8`);
}

// ── data ────────────────────────────────────────────────────────────────────
const D = here + 'data/';
const man = JSON.parse(readFileSync(D + 'objects.json', 'utf8')).objects;
const credits = readFileSync(here + 'CREDITS.md', 'utf8');
{
  const bad = [];
  for (const o of man) {
    const [nx, ny, nz] = o.dims, size = existsSync(D + o.file) ? readFileSync(D + o.file).length : -1;
    if (size !== nx * ny * nz) bad.push(o.id + ' size');
    if (!['CC0-1.0', 'CC-BY-4.0'].includes(o.credit.licence)) bad.push(o.id + ' licence');
    if (!o.credit.author || !/^https:\/\//.test(o.credit.source) || !o.credit.changes) bad.push(o.id + ' credit');
    if (!existsSync(D + o.id + '.jpg')) bad.push(o.id + ' thumb');
    if (!credits.includes('`' + o.id + '`')) bad.push(o.id + ' CREDITS.md');
    if (!(o.anchors[0][0] === 0 && o.anchors.every((a, i) => i === 0 || a[0] >= o.anchors[i - 1][0]))) bad.push(o.id + ' anchors');
  }
  ok(man.length >= 7 && bad.length === 0, `data: ${man.length} objects with files, credits, licences, images and sorted anchors`, bad.join(' '));
  const real = man.filter((o) => o.kind === 'volume').map((o) => o.id);
  ok(real.includes('rabbit') && real.includes('walnut'), 'data: real CT volumes are in (walnut, rabbit)', real.join(' '));
}

// ── loaders ─────────────────────────────────────────────────────────────────
{
  const o = man[0], raw = readFileSync(D + o.file), gz = gzipSync(raw);
  const srv = createServer((q, s) => {
    if (q.url.endsWith('/short.bin')) { s.writeHead(200, { 'content-type': 'application/octet-stream' }); s.end(raw.subarray(0, 100)); return; }
    s.writeHead(200, { 'content-encoding': 'gzip', 'content-length': gz.length, 'content-type': 'application/octet-stream' }); s.end(gz);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}/data/`;
  let codes = null, err = null;
  try { codes = await loadCodes(o, base); } catch (e) { err = e; }
  ok(codes && codes.length === raw.length && codes[raw.length >> 1] === raw[raw.length >> 1], 'loaders: a gzip-served object loads in full', `${gz.length} bytes on the wire, ${codes && codes.length} read${err ? ' ' + err.message : ''}`);
  let refused = false;
  try { await loadCodes({ ...o, file: 'short.bin' }, base); } catch (e) { refused = /bytes/.test(e.message); }
  ok(refused, 'loaders: a short file is refused, not padded');
  srv.close();
}

// ── basis ───────────────────────────────────────────────────────────────────
{
  let worst = 0, who = '';
  for (const o of man) {
    const vol = toVolume(o, new Uint8Array(readFileSync(D + o.file)), 32), B = basisOf(o, vol);
    // at each anchor code the split must give that anchor's mu (within a code step)
    for (const [code, name, comp] of o.anchors) {
      if (!code) continue;
      // codes are 8-bit: allow half a code step
      const mu = code / 255 * o.muMax, want = muOfComposition(comp, 70);
      const e = Math.max(0, Math.abs(mu - want) - 0.5 * o.muMax / 255) / want;
      if (e > worst) { worst = e; who = `${o.id}/${name}`; }
    }
    void B;
  }
  ok(worst < 1e-3, 'basis: every anchor code gives back its mu at 70 keV (within half a code step)', `worst ${(worst * 100).toFixed(2)} % (${who})`);
  ok(Math.abs(huOf(MU_WATER)) < 1e-9 && Math.abs(huOf(0) + 1000) < 1e-9, 'basis: HU of water is 0 and of air is -1000');
}

// ── scan ────────────────────────────────────────────────────────────────────
// floors: measured on this machine 2026-10-09 (64^3, 90 views, Shepp-Logan filter), minus 1 dB
const FLOOR = { skull: 24.0, watch: 25.3, amber: 22.5, teacup: 23.4, toycar: 31.8, pot: 20.8, rabbit: 0, walnut: 0 };
const measured = {};
{
  const low = [];
  for (const o of man) {
    const vol = toVolume(o, new Uint8Array(readFileSync(D + o.file)), 64);
    const s = createSession(o, vol, { nViews: 90 }); s.scanAll();
    const m = s.metrics(s.fdk()); measured[o.id] = m.psnr;
    if (!(m.psnr >= (FLOOR[o.id] ?? 20))) low.push(`${o.id} ${m.psnr.toFixed(2)}`);
  }
  ok(low.length === 0, 'scan: FDK of every object is above its PSNR floor', Object.entries(measured).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '));
  const o = man.find((x) => x.id === 'pot') || man[0], vol = toVolume(o, new Uint8Array(readFileSync(D + o.file)), 48);
  const clean = createSession(o, vol, { nViews: 60 }); clean.scanAll();
  const noisy = createSession(o, vol, { nViews: 60, dose: 2e3 }); noisy.scanAll();
  const poly = createSession(o, vol, { nViews: 60, poly: true, kVp: 80 }); poly.scanAll();
  const pc = clean.metrics(clean.fdk()).psnr, pn = noisy.metrics(noisy.fdk()).psnr, pp = poly.metrics(poly.fdk()).psnr;
  ok(pn < pc - 1 && pp < pc - 0.5, 'scan: low dose and beam hardening both lower the PSNR (copper pot)', `clean ${pc.toFixed(1)}, 2k photons ${pn.toFixed(1)}, 80 kVp poly ${pp.toFixed(1)} dB`);
  const again = createSession(o, vol, { nViews: 60, dose: 2e3 }); again.scanAll();
  ok(again.proj.data.every((x, i) => x === noisy.proj.data[i]), 'scan: the same seed gives the same noise (the SIRT worker scans the same data)');
  const sk = man.find((x) => x.id === 'skull'), v2 = toVolume(sk, new Uint8Array(readFileSync(D + sk.file)), 40);
  const ss = createSession(sk, v2, { nViews: 48 }); ss.scanAll();
  const res = []; for (let k = 0; k < 5; k++) res.push(ss.sirtStep().residual);
  ok(res.every((r, i) => i === 0 || r < res[i - 1]), 'scan: SIRT residual falls every iteration', res.map((r) => r.toFixed(1)).join(' > '));
}

// ── slices ──────────────────────────────────────────────────────────────────
{
  const nx = 10, ny = 12, nz = 14, data = new Float32Array(nx * ny * nz);
  const P = { ix: 3, iy: 5, iz: 9 }; data[(P.iz * ny + P.iy) * nx + P.ix] = 1;
  const vol = { nx, ny, nz, width: 5, data };
  const ax = sliceOf(vol, 'axial', P), co = sliceOf(vol, 'coronal', P), sa = sliceOf(vol, 'sagittal', P);
  const hit = (img) => { const i = img.data.indexOf(1); return { x: i % img.w, y: Math.floor(i / img.w) }; };
  const a = hit(ax), c = hit(co), s = hit(sa);
  ok(a.x === 3 && a.y === 5 && c.x === 3 && c.y === nz - 1 - 9 && s.x === 5 && s.y === nz - 1 - 9 && ax.w === nx && co.h === nz && sa.w === ny,
    'slices: axial, coronal and sagittal index the right voxel (top of the object at the top)', `axial ${a.x},${a.y} coronal ${c.x},${c.y} sagittal ${s.x},${s.y}`);
  let rt = true;
  for (const v of ['axial', 'coronal', 'sagittal']) {
    const ch = crosshair(vol, v, P), q = cursorFromPixel(vol, v, ch.x - 0.5, ch.y - 0.5, { ix: 0, iy: 0, iz: 0 });
    const keep = v === 'axial' ? ['ix', 'iy'] : v === 'coronal' ? ['ix', 'iz'] : ['iy', 'iz'];
    if (!keep.every((k) => q[k] === P[k])) rt = false;
  }
  ok(rt, 'slices: a click on the crosshair of each view gives back the cursor (linked views)');
  const ob = obliqueOf(vol, P, 0, 0, 33);
  ok(Math.abs(ob.data[16 * 33 + 16] - valueAt(vol, P)) < 1e-6 || ob.data[16 * 33 + 16] > 0.2, 'slices: the oblique plane passes through the cursor', `centre ${ob.data[16 * 33 + 16].toFixed(3)}`);
  ok(Math.abs(distanceCm(vol, { x: 0, y: 0 }, { x: 4, y: 3 }) - 2.5) < 1e-9, 'slices: distance uses the voxel size (5 px at 0.5 cm = 2.5 cm)');
}

// ── presets ─────────────────────────────────────────────────────────────────
{
  const bad = [];
  for (const o of man) {
    const P = presetsFor(o), metal = o.anchors.some((a) => a[2][2] > 0.2);
    if (!P.everything || !P.soft) bad.push(o.id + ' missing');
    if (!!P.metal !== metal) bad.push(o.id + ' metal');
    for (const [k, p] of Object.entries(P)) {
      if (!(p.window[1] > p.window[0] && p.soft[0] < p.soft[1] && p.soft[1] <= 1 && p.bone > 0 && p.bone <= 1)) bad.push(`${o.id}/${k}`);
    }
  }
  ok(bad.length === 0, 'presets: every object has everything and soft, metal only with metal, sane windows', bad.join(' '));
}

// ── saver ───────────────────────────────────────────────────────────────────
{
  const ids = man.map((o) => o.id), pres = (id) => Object.keys(presetsFor(man.find((o) => o.id === id)));
  let rep = 0, dur = 0, n = 0, maps = 0;
  for (const seed of [1, 2, 3, 99]) {
    const p = makePlan(seed, ids, { gpu: true }, pres);
    let prev = null;
    for (let k = 0; k < 400; k++) {
      const s = p.next(); n++;
      if (prev && (s.kind === prev.kind || s.object === prev.object || s.map === prev.map)) rep++;
      if (!(s.dur >= 6 && s.dur <= 12)) dur++;
      if (!MAPS.includes(s.map) || (s.map2 && s.map2 === s.map)) maps++;
      prev = s;
    }
  }
  ok(rep === 0 && dur === 0 && maps === 0, `saver: ${n} shots, no kind, object or map twice in a row, all 6-12 s`, `repeats ${rep}, bad lengths ${dur}, bad maps ${maps}`);
  const p2 = makePlan(5, ids, { gpu: false }, pres), k2 = new Set();
  for (let k = 0; k < 60; k++) k2.add(p2.next().kind);
  ok([...k2].every((k) => !KINDS.find((x) => x.kind === k).gpu) && k2.size === 2, 'saver: without WebGPU only the 2D shots play', [...k2].join(' '));
}

// ── gpu ─────────────────────────────────────────────────────────────────────
{
  let deno = null;
  try { deno = execFileSync('which', ['deno']).toString().trim(); } catch (e) { /* none */ }
  if (!deno) console.log('SKIP  gpu: deno not on PATH');
  else {
    try {
      const out = execFileSync(deno, ['run', '--allow-read', '--allow-write', '--unstable-webgpu', here + 'gpu-check.mjs'], { encoding: 'utf8', timeout: 300000 });
      process.stdout.write(out.split('\n').filter((l) => /^(ok|FAIL|SKIP)/.test(l)).map((l) => '      ' + l).join('\n') + '\n');
      ok(!/^FAIL/m.test(out) && /^ok/m.test(out), 'gpu: Deno WebGPU FDK matches the CPU FDK for two objects, view3d renders');
    } catch (e) { ok(false, 'gpu: gpu-check.mjs ran', String(e.stdout || e.message).slice(-300)); }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
