// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/tests.mjs — node tests (no browser)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/stereogram-maker/engine/tests.mjs [--quick]
//  Exit code 0 when every check passes. --quick draws the tiles at a
//  smaller size. MAKER's tests.mjs can import run() and call it.
//
//  Groups: api, raster2d, depth (closed forms), text, image, sirds
//  (constraints, hidden surfaces, tile repeat), tiles (count, families,
//  wrap), pairs, animate, png, worker (message shape), models (files,
//  licences, size budget, credits).
//
//  grep -n targets: "group(" for each group
// ============================================================================
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as E from './index.js';
import { handle, OP_NAMES } from './worker-core.js';
import { MODELS, KINDS, loadModel } from '../models/index.js';

let pass = 0, fail = 0, cur = '';
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL [' + cur + '] ' + msg); } };
const group = (name, fn) => { cur = name; const t0 = Date.now(); const before = fail; return Promise.resolve(fn()).then(() => console.log((fail > before ? 'FAIL ' : 'ok   ') + name.padEnd(10) + ' ' + (Date.now() - t0) + ' ms')); };

// An icosphere of radius 1 (subdivisions s).
function icosphere(s = 4) {
  const t = (1 + Math.sqrt(5)) / 2;
  let P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let k = 0; k < s; k++) {
    const mid = new Map(), m = (a, b) => { const key = a < b ? a + ',' + b : b + ',' + a; if (!mid.has(key)) { const v = P[a].map((c, i) => (c + P[b][i]) / 2), l = Math.hypot(...v); P.push(v.map(c => c / l)); mid.set(key, P.length - 1); } return mid.get(key); };
    F = F.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  return { positions: Float32Array.from(P.flat()), indices: Uint32Array.from(F.flat()) };
}
const cube = () => ({
  positions: Float32Array.from([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]),
  indices: Uint32Array.from([4, 5, 6, 4, 6, 7, 0, 2, 1, 0, 3, 2, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]),
});
const px = (img, x, y) => { const i = 4 * (y * img.w + x); return img.data[i] << 16 | img.data[i + 1] << 8 | img.data[i + 2]; };
const readBytes = async u => { const b = fs.readFileSync(fileURLToPath(u)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

export async function run({ quick = false } = {}) {
  pass = 0; fail = 0;

  await group('api', () => {
    for (const n of ['depthFromMesh', 'depthFromMeshGL', 'depthFromText', 'depthFromImage', 'depthFromSDF', 'turntable', 'sirds', 'autostereogram',
      'farSeparation', 'tilesFromPatterns', 'seamError', 'wheatstonePair', 'randomDotStereogram', 'anaglyph', 'animate', 'createEngineClient'])
      ok(typeof E[n] === 'function', 'export ' + n);
    ok(Array.isArray(E.TILES) && Array.isArray(E.SDF_SHAPES), 'TILES and SDF_SHAPES are arrays');
    ok(E.depthFromMeshGL(cube(), { w: 8, h: 8 }) === null, 'the WebGL2 path gives null in node');
  });

  await group('raster2d', () => {
    const g = new E.Raster2D(40, 40);
    g.fillStyle = '#000000'; g.fillRect(0, 0, 40, 40);
    g.fillStyle = '#ffffff'; g.fillRect(10.5, 10, 10, 10);
    let s = 0; for (let i = 0; i < 1600; i++) s += g.data[4 * i] / 255;
    ok(Math.abs(s - 100) < 0.5, 'a 10 x 10 square covers 100 px (got ' + s.toFixed(2) + ')');
    const h = new E.Raster2D(64, 64); h.fillStyle = '#000'; h.fillRect(0, 0, 64, 64);
    h.fillStyle = '#ffffff'; h.beginPath(); h.arc(32, 32, 20, 0, Math.PI * 2); h.fill();
    s = 0; for (let i = 0; i < 4096; i++) s += h.data[4 * i] / 255;
    ok(Math.abs(s - Math.PI * 400) / (Math.PI * 400) < 0.01, 'a disc of radius 20 covers pi r^2 (got ' + s.toFixed(1) + ')');
    const k = new E.Raster2D(40, 40); k.fillStyle = '#000'; k.fillRect(0, 0, 40, 40);
    k.strokeStyle = '#ffffff'; k.lineWidth = 2; k.beginPath(); k.moveTo(5, 20); k.lineTo(35, 20); k.stroke();
    s = 0; for (let i = 0; i < 1600; i++) s += k.data[4 * i] / 255;
    ok(Math.abs(s - (60 + Math.PI)) < 3, 'a 30 px line of width 2 covers about 63 px (got ' + s.toFixed(1) + ')');
    const r = new E.Raster2D(20, 20); r.fillStyle = '#000'; r.fillRect(0, 0, 20, 20); r.fillStyle = '#fff';
    r.beginPath(); r.rect(2, 2, 16, 16); r.rect(6, 6, 8, 8); r.fill('evenodd');
    ok(r.data[4 * (10 * 20 + 10)] === 0 && r.data[4 * (3 * 20 + 3)] === 255, 'the even-odd rule leaves the hole');
  });

  await group('depth', () => {
    const S = icosphere(4), w = 160, fit = 0.9, s = fit * w / 2;
    const d = E.depthFromMesh(S, { w, h: w, fov: 0, fit, norm: 'sphere', near: 1, far: 0 });
    let maxErr = 0, n = 0;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5 - w / 2) / s, v = (w / 2 - y - 0.5) / s, r2 = u * u + v * v;
      if (r2 < 0.9) { const z = Math.sqrt(1 - r2), want = (z + 1) / 2; maxErr = Math.max(maxErr, Math.abs(d.data[y * w + x] - want)); n++; ok(d.mask[y * w + x] === 1, 'mask inside the sphere'); }
      if (r2 > 1.05) ok(d.mask[y * w + x] === 0, 'no mask outside the sphere');
    }
    ok(maxErr < 0.006, 'orthographic icosphere depth matches sqrt(1 - r^2) (max error ' + maxErr.toFixed(4) + ')');
    // Perspective: the depth along the axis is the same closed form.
    const p = E.depthFromMesh(S, { w, h: w, fov: 30, norm: 'sphere', near: 1, far: 0 });
    ok(Math.abs(p.data[(w / 2) * w + w / 2] - 1) < 0.01, 'perspective centre depth is the front of the sphere');
    // A cube seen face on: one constant depth on the front face.
    const c = E.depthFromMesh(cube(), { w: 64, h: 64, fov: 0, norm: 'view' });
    const vals = new Set(); for (let i = 0; i < c.data.length; i++) if (c.mask[i]) vals.add(c.data[i].toFixed(4));
    ok(vals.size === 1, 'the front face of a cube is flat (' + vals.size + ' values)');
    // Turning by 180 degrees about y gives the mirror image.
    const a = E.depthFromMesh(cube(), { w: 32, h: 32, yaw: 30, fov: 0 }), b = E.depthFromMesh(cube(), { w: 32, h: 32, yaw: -30, fov: 0 });
    let mirror = 0; for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) mirror = Math.max(mirror, Math.abs(a.data[y * 32 + x] - b.data[y * 32 + 31 - x]));
    ok(mirror < 1e-3, 'yaw +30 and -30 are mirror images');
    const tt = E.turntable(S, 6, { w: 32, h: 32, fov: 0 });
    ok(tt.length === 6 && tt.every(f => Math.abs(f.data[16 * 32 + 16] - tt[0].data[16 * 32 + 16]) < 1e-3), 'a sphere turntable keeps one depth scale');
    // Closed-form shapes.
    const sp = E.depthFromSDF('sphere', { w: 101, h: 101, r: 0.8, near: 1, far: 0 });
    ok(Math.abs(sp.data[50 * 101 + 50] - 1) < 1e-3, 'SDF sphere centre is 1');
    const to = E.depthFromSDF('torus', { w: 101, h: 101 });
    ok(to.mask[50 * 101 + 50] === 0, 'SDF torus has a hole');
    for (const sh of E.SDF_SHAPES) ok(E.depthFromSDF(sh, { w: 40, h: 30 }).mask.some(v => v), 'SDF ' + sh + ' draws');
  });

  await group('text', () => {
    const t = E.depthFromText('HI 3D', { w: 200, h: 80, block: true, bevel: 3 });
    let on = 0, top = 0; for (let i = 0; i < t.mask.length; i++) { on += t.mask[i]; top = Math.max(top, t.data[i]); }
    ok(on > 1000, 'block-font text covers pixels (' + on + ')');
    ok(Math.abs(top - 1) < 1e-6, 'the letter face reaches level 1');
    const nb = E.depthFromText('I', { w: 60, h: 60, block: true, bevel: 0, level: 0.7 });
    ok([...nb.data].every(v => v === 0 || Math.abs(v - 0.7) < 1e-6), 'bevel 0 gives a flat face');
  });

  await group('image', () => {
    const img = { w: 4, h: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255]) };
    const d = E.depthFromImage(img, { w: 4, h: 1 });
    ok(Math.abs(d.data[0]) < 1e-6 && Math.abs(d.data[3] - 1) < 1e-6 && d.data[1] < d.data[2], 'grey ramp to depth ramp');
    const inv = E.depthFromImage(img, { w: 4, h: 1, invert: true });
    ok(Math.abs(inv.data[0] - 1) < 1e-6, 'invert');
    const ph = E.depthFromImage(img, { w: 8, h: 8, mode: 'photo' });
    ok(ph.w === 8 && ph.data.every(v => v >= 0 && v <= 1), 'photo mode resizes and stays in 0..1');
  });

  await group('sirds', () => {
    const w = 400, h = 60, depth = E.depthFromSDF('steps', { w, h, n: 3, r: 0.9 });
    const o = { guides: false, seed: 5 };
    const img = E.sirds(depth, o);
    ok(img.w === w && img.h === h && img.data.length === w * h * 4, 'image size');
    ok(img.sepFar === Math.round(2.5 * 72 / 2) && img.sepNear < img.sepFar, 'separations: far ' + img.sepFar + ', near ' + img.sepNear);
    let links = 0, bad = 0;
    for (let y = 0; y < h; y++) {
      const same = E.rowLinks(depth.data.subarray(y * w, (y + 1) * w), y, o);
      for (let x = 0; x < w; x++) if (same[x] !== x) { links++; if (px(img, x, y) !== px(img, same[x], y)) bad++; }
    }
    ok(links > w * h * 0.5 && bad === 0, 'linked pixels have equal colours (' + links + ' links, ' + bad + ' differ)');
    // A flat background repeats with the far separation.
    const flat = E.emptyDepth(300, 4), fimg = E.sirds(flat, o);
    let rep = 0; for (let x = 0; x + fimg.sepFar < 300; x++) if (px(fimg, x, 2) !== px(fimg, x + fimg.sepFar, 2)) rep++;
    ok(rep === 0, 'flat depth repeats every sepFar px');
    // Hidden-surface removal removes constraints near a tall step.
    const step = new Float32Array(300); for (let x = 140; x < 160; x++) step[x] = 1;
    const withH = E.rowLinks(step, 0, { hsr: true }), noH = E.rowLinks(step, 0, { hsr: false });
    let a = 0, b = 0; for (let x = 0; x < 300; x++) { if (withH[x] !== x) a++; if (noH[x] !== x) b++; }
    ok(a < b, 'hidden-surface removal drops links (' + a + ' < ' + b + ')');
    // The tile source: the background is the tile repeated.
    const tile = E.tilesFromPatterns(['dots-color'], img.sepFar, 3)[0];
    const timg = E.autostereogram(flat, tile, o);
    let tbad = 0; for (let x = 0; x + timg.sepFar < 300; x++) if (px(timg, x, 1) !== px(timg, x + timg.sepFar, 1)) tbad++;
    ok(tbad === 0, 'tile background repeats');
    ok(E.sirds(depth, { ...o, mode: 'cross' }).w === w, 'cross-eyed mode runs');
    const ov = E.sirds(depth, { ...o, oversample: 3, source: 'color' });
    ok(ov.w === w && ov.data[3] === 255, 'oversample 3 gives the output size');
    const gflat = E.emptyDepth(300, 200), gd = E.sirds(gflat, { guides: true, source: 'color' }), gr = Math.max(3, Math.round(200 / 120));
    const gy = Math.max(gr * 2 + 2, Math.round(200 * 0.04));
    ok(px(gd, Math.floor(150 - gd.sepFar / 2), gy) === 0 && px(gd, Math.floor(150 + gd.sepFar / 2), gy) === 0, 'two black guide dots, sepFar apart');
    ok(E.farSeparation({ dpi: 100 }) === Math.round(250 / 2) && E.farSeparation() === img.sepFar, 'farSeparation');
  });

  await group('tiles', () => {
    const fams = new Set(E.TILES.map(t => t.family));
    ok(E.TILES.length >= 40, 'at least 40 pattern tiles (' + E.TILES.length + ')');
    ok(fams.size >= 10, 'many families (' + fams.size + ')');
    ok(new Set(E.TILES.map(t => t.id)).size === E.TILES.length, 'tile ids are unique');
    ok(E.TILES.every(t => t.wrap === 'native' || t.wrap === 'mirror'), 'each tile has a wrap mode');
    const size = quick ? 64 : 96;
    const all = E.tilesFromPatterns([...E.TILES.map(t => t.id), ...E.DOT_TILES.map(t => t.id)], size, 2);
    for (const t of all) {
      ok(t.w === size && t.h === size && t.data.length === size * size * 4, t.id + ' size');
      const e = E.seamError(t);
      ok(e < 1.6, t.id + ' wraps (' + t.wrap + ', seamError ' + e.toFixed(2) + ')');
      let lo = 255, hi = 0; for (let i = 0; i < t.data.length; i += 4) { lo = Math.min(lo, t.data[i + 1]); hi = Math.max(hi, t.data[i + 1]); }
      ok(hi - lo > 20, t.id + ' is not flat');
    }
    const m = E.tilesFromPatterns([E.TILES.find(t => t.wrap === 'mirror').id], 64, 1)[0];
    let mb = 0; for (let y = 0; y < 64; y++) if (px(m, 0, y) !== px(m, 63, y)) mb++;
    ok(mb === 0, 'a mirror tile has equal first and last columns');
    const r = E.tilesFromPatterns(['arc-lattice'], { w: 50, h: 40 }, 1)[0];
    ok(r.w === 50 && r.h === 40 && r.id === 'pd-arc-lattice', 'a bare pattern id and a w x h size');
  });

  await group('pairs', () => {
    const flat = E.emptyDepth(80, 40), pr = E.wheatstonePair(flat, null);
    ok(pr.left.data.every((v, i) => v === pr.right.data[i]), 'flat depth gives equal views');
    const d = E.depthFromSDF('sphere', { w: 120, h: 80 });
    const rd = E.randomDotStereogram(d, { disparity: 6 });
    let same = 0, diff = 0, ink = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) {
      const i = y * 120 + x, eq = px(rd.left, x, y) === px(rd.right, x, y);
      if (!d.mask[i] && x > 0 && x < 10) { if (eq) same++; else diff++; }
      if (rd.left.data[4 * i] === 0) ink++;
    }
    ok(diff === 0 && same > 0, 'Julesz pair: the background is equal in both images');
    ok(Math.abs(ink / 9600 - 0.5) < 0.05, 'each image alone is random dots (ink ' + (ink / 9600).toFixed(3) + ')');
    let moved = 0; for (let x = 0; x < 120; x++) if (px(rd.left, x, 40) !== px(rd.right, x, 40)) moved++;
    ok(moved > 10, 'the object region differs between the images');
    const an = E.anaglyph(rd.left, rd.right);
    ok(an.data[0] === rd.left.data[0] && an.data[1] === rd.right.data[1], 'anaglyph: red from left, green and blue from right');
    ok(E.anaglyph(rd, { mode: 'gray' }).w === 120, 'anaglyph takes a pair object');
    const cr = E.wheatstonePair(d, null, { mode: 'cross' }), wl = E.wheatstonePair(d, null);
    ok(cr.left.data.every((v, i) => v === wl.right.data[i]), 'cross mode swaps the views');
  });

  await group('animate', () => {
    const S = icosphere(2), frames = E.turntable(S, 3, { w: 120, h: 40, fit: 0.5, fov: 0 });
    const an = E.animate(frames, { guides: false, seed: 9 });
    ok(an.frames.length === 3, 'three frames');
    let same = 0, tot = 0;
    for (let x = 0; x < 20; x++) { tot++; if (an.frames.every(f => px(f, 119 - x, 20) === px(an.frames[0], 119 - x, 20))) same++; }
    ok(same === tot, 'the background at the right edge stays still');
  });

  await group('png', () => {
    const img = E.sirds(E.depthFromSDF('cone', { w: 30, h: 20 }), { guides: false });
    const png = E.encodePNG(img);
    ok(png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71, 'PNG signature');
    const dv = new DataView(png.buffer, png.byteOffset), len = dv.getUint32(33);
    const raw = zlib.inflateSync(Buffer.from(png.subarray(41, 41 + len)));
    ok(raw.length === 20 * (30 * 4 + 1) && raw[1] === img.data[0], 'IDAT inflates to the pixel rows');
  });

  await group('worker', async () => {
    const r = await handle({ id: 7, op: 'depthFromSDF', args: ['sphere', { w: 16, h: 12 }] });
    ok(r.reply.id === 7 && r.reply.ok === true && r.reply.result.w === 16 && r.reply.result.data instanceof Float32Array, 'reply { id, ok, result }');
    ok(r.transfer.length === 2 && r.transfer.includes(r.reply.result.data.buffer), 'transfer lists the result buffers');
    const bad = await handle({ id: 8, op: 'nope', args: [] });
    ok(bad.reply.id === 8 && bad.reply.ok === false && /unknown op/.test(bad.reply.error), 'unknown op gives ok false');
    const proto = await handle({ id: 9, op: 'toString', args: [] });
    ok(proto.reply.ok === false, 'prototype names are not ops');
    const t = await handle({ id: 10, op: 'tilesFromPatterns', args: [['dots-bw'], 16, 1] });
    ok(t.reply.ok && t.reply.result[0].data.length === 1024, 'tilesFromPatterns through the worker');
    ok(['loadModel', 'modelDepth', 'modelTurntable', 'sirds', 'animate'].every(n => OP_NAMES.includes(n)), 'op list');
  });

  await group('models', async () => {
    const dir = new URL('../models/', import.meta.url), credits = fs.readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8');
    const kinds = new Set(MODELS.map(m => m.kind));
    ok(MODELS.length >= 24, 'at least 24 models (' + MODELS.length + ')');
    ok(kinds.size >= 8 && [...kinds].every(k => KINDS.some(K => K.id === k)), 'many kinds (' + kinds.size + ')');
    ok(new Set(MODELS.map(m => m.id)).size === MODELS.length, 'model ids are unique');
    let bytes = 0;
    for (const f of fs.readdirSync(dir, { recursive: true })) { const st = fs.statSync(new URL(f, dir)); if (st.isFile()) bytes += st.size; }
    ok(bytes < 25 * 1024 * 1024, 'models folder under 25 MB (' + (bytes / 1048576).toFixed(2) + ' MB)');
    for (const m of MODELS) {
      ok(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'].includes(m.licence), m.id + ' licence ' + m.licence);
      ok(m.credit && m.url && m.view && Number.isFinite(m.view.yaw) && Number.isFinite(m.view.pitch), m.id + ' record fields');
      ok(credits.includes('`' + m.id + '.glb`'), m.id + ' is in CREDITS.md');
      ok(!/bunny|stanford|ossicle|dragon/i.test(m.id + m.name), m.id + ' is not an excluded source');
      const g = await loadModel(m.id, { readBytes });
      ok(g.triangleCount > 1000 && g.triangleCount <= 60000 && g.triangleCount === m.triangles, m.id + ' triangles ' + g.triangleCount);
      const ext = Math.max(...g.bounds.max.map(Math.abs), ...g.bounds.min.map(Math.abs));
      ok(Math.abs(ext - 1) < 1e-3, m.id + ' is in the unit box');
      const d = E.depthFromMesh(g, { w: 48, h: 48, ...m.view });
      const cover = d.mask.reduce((s, v) => s + v, 0) / d.mask.length;
      ok(cover > 0.04, m.id + ' default view covers the frame (' + (cover * 100).toFixed(0) + '%)');
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  run({ quick: process.argv.includes('--quick') }).then(f => process.exit(f ? 1 : 0));
}
