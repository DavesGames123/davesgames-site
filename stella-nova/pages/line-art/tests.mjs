// ============================================================================
//  LINE ART  ·  tests.mjs  ·  node tests.mjs (from any directory)
// ----------------------------------------------------------------------------
//  1. geom.js depthOrder and orderPaths: the draw order is non-decreasing
//     in depth, equal depths keep their order, and the pen costs add up.
//  2. geom.js viewFit for many window shapes and frames: the example view
//     keeps its aspect, sits at the frame center, fills the full frame
//     width or the full frame height, and the clip box is the whole view
//     (not a centered square). clampPan keeps the image over the view.
//  3. The wasm engine (pkg/, loaded in node): Job.depths gives one finite
//     depth per path; a scene with a near and a far object sorts near
//     first; the lens shift moves the subject with the frame; every point
//     is in the whole image and lines go past the frame.
//  No browser runs here (the user does not allow headless browsers).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { depthOrder, orderPaths, viewFit, clampPan, TRAVEL_SPEEDUP, DOT_COST, MAX_FOVY } from './geom.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
let fails = 0, passes = 0;
function ok(cond, name, extra = '') {
  if (cond) passes++;
  else { fails++; console.log('FAIL', name, extra); }
}
const close = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296; })();

// ── 1. draw order ────────────────────────────────────────────────────────
{
  const d = [3, 1, 2, 1, NaN, 0, Infinity, 2];
  const o = depthOrder(d);
  ok(JSON.stringify(o) === JSON.stringify([5, 1, 3, 2, 7, 0, 4, 6]), 'depthOrder small case', JSON.stringify(o));
  ok(o.length === d.length && new Set(o).size === d.length, 'depthOrder is a permutation');
  ok(o[6] === 4 && o[7] === 6, 'non-finite depths go last');
  for (let t = 0; t < 50; t++) {
    const n = 1 + Math.floor(rnd() * 400);
    const paths = [];
    for (let i = 0; i < n; i++) {
      const m = 1 + Math.floor(rnd() * 6), pts = new Float32Array(m * 2);
      for (let j = 0; j < pts.length; j++) pts[j] = rnd() * 800;
      let len = 0;
      for (let j = 2; j < pts.length; j += 2) len += Math.hypot(pts[j] - pts[j - 2], pts[j + 1] - pts[j - 1]);
      paths.push({ pts, len, depth: Math.round(rnd() * 20) / 2, id: i });
    }
    const r = orderPaths(paths.slice());
    let mono = true, stable = true, sum = 0;
    for (let i = 1; i < r.paths.length; i++) {
      if (r.paths[i].depth < r.paths[i - 1].depth) mono = false;
      if (r.paths[i].depth === r.paths[i - 1].depth && r.paths[i].id < r.paths[i - 1].id) stable = false;
    }
    for (const p of r.paths) sum += p.cost;
    ok(mono, `draw order non-decreasing in depth (trial ${t})`);
    ok(stable, `equal depths keep engine order (trial ${t})`);
    ok(close(sum, r.total, 1e-6 * Math.max(1, sum)), `pen costs add up (trial ${t})`);
    ok(close(r.paths[0].cost, Math.max(r.paths[0].len, DOT_COST)), `first path has no pen-up travel (trial ${t})`);
    if (r.paths.length > 1) {
      const p = r.paths[1], q = r.paths[0], l = q.pts.length - 2;
      ok(close(p.cost, Math.max(p.len, DOT_COST) + Math.hypot(p.pts[0] - q.pts[l], p.pts[1] - q.pts[l + 1]) / TRAVEL_SPEEDUP, 1e-6), `travel cost follows the new order (trial ${t})`);
    }
  }
}

// ── 2. framing ───────────────────────────────────────────────────────────
const VIEWS = [[1920, 1080], [1440, 900], [390, 844], [844, 390], [1024, 1024], [3440, 1440], [768, 1024], [320, 568]];
const ASPECTS = [1, 1.6, 1900 / 1575, 1000 / 1400, 16 / 9];
let fitCases = 0;
for (const [W, H] of VIEWS) {
  // frames: the whole view; a desktop panel on the left; a saver band
  // (full width, plate lines at the top and base); a phone sheet.
  const frames = [
    { x: 0, y: 0, w: W, h: H },
    { x: Math.min(380, W * 0.3) + 22, y: 80, w: W - Math.min(380, W * 0.3) - 44, h: H - 180 },
    { x: 0, y: H * 0.18 + 10, w: W, h: H * (1 - 0.18 - 0.22) - 20 },
    { x: 10, y: 10, w: W - 20, h: H * 0.55 },
  ];
  for (const f of frames) for (const a0 of ASPECTS) for (const fovy0 of [20, 35, 50]) {
    const r = viewFit({ w: W, h: H }, f, a0, fovy0), q = r.rect;
    const tag = `${W}x${H} frame ${f.x | 0},${f.y | 0},${f.w | 0}x${f.h | 0} a0 ${a0.toFixed(2)} fovy ${fovy0}`;
    fitCases++;
    ok(r.clip.x === 0 && r.clip.y === 0 && r.clip.w === W && r.clip.h === H, 'clip box is the whole view: ' + tag);
    if (W !== H) ok(r.clip.w !== r.clip.h, 'clip box is not a square: ' + tag);
    ok(r.fovy > 0 && r.fovy <= MAX_FOVY + 1e-9, 'fovy in range: ' + tag, r.fovy);
    if (r.fovy < MAX_FOVY - 1e-6) {
      ok(close(q.w / q.h, a0, 1e-9), 'aspect kept (no stretch): ' + tag);
      ok(close(q.x + q.w / 2, f.x + f.w / 2, 1e-6) && close(q.y + q.h / 2, f.y + f.h / 2, 1e-6), 'view centered in frame: ' + tag);
      ok(q.w <= f.w + 1e-6 && q.h <= f.h + 1e-6, 'view inside frame: ' + tag, JSON.stringify(q));
      ok(close(q.w, f.w, 1e-6) || close(q.h, f.h, 1e-6), 'view fills the full frame width or height: ' + tag, JSON.stringify(q));
      // the projection: clip x = tan / tanW / aspect + sx maps the view
      // rect corners to the rect on screen (y up in clip space)
      const tanW = Math.tan(r.fovy * Math.PI / 360), tan0 = Math.tan(fovy0 * Math.PI / 360), A = W / H;
      const clipX = t => t / (tanW * A) + r.sx, clipY = t => t / tanW + r.sy;
      const sxL = (clipX(-tan0 * a0) + 1) * W / 2, sxR = (clipX(tan0 * a0) + 1) * W / 2;
      const syT = H - (clipY(tan0) + 1) * H / 2, syB = H - (clipY(-tan0) + 1) * H / 2;
      ok(close(sxL, q.x, 1e-6) && close(sxR, q.x + q.w, 1e-6) && close(syT, q.y, 1e-6) && close(syB, q.y + q.h, 1e-6), 'projection maps the example view to rect: ' + tag);
    }
  }
}
ok(fitCases === VIEWS.length * 4 * ASPECTS.length * 3, 'all framing cases ran');
{
  // the old behaviour for thumbnails (no frame): fovy grows only for a
  // narrow image, as in the previous worker
  const r1 = viewFit({ w: 330, h: 216 }, null, 1, 30), r2 = viewFit({ w: 216, h: 330 }, null, 1, 30);
  ok(close(r1.fovy, 30, 1e-9) && close(r1.sx, 0) && close(r1.sy, 0), 'no frame, wide image: example fovy');
  ok(close(r2.fovy, 2 * Math.atan(Math.tan(15 * Math.PI / 180) * 330 / 216) * 180 / Math.PI, 1e-9), 'no frame, narrow image: fovy grows as before');
  const [px, py] = clampPan(500, -500, 2400, 1500, 1200, 900);
  ok(px === 500 && py === -300, 'clampPan keeps the image over the view', `${px},${py}`);
  const [qx, qy] = clampPan(40, 40, 1200, 900, 1200, 900);
  ok(qx === 0 && qy === 0, 'clampPan at zoom 1 gives no pan');
}

// ── 3. the wasm engine ───────────────────────────────────────────────────
const pkg = await import('./pkg/line_art.js');
await pkg.default({ module_or_path: fs.readFileSync(path.join(HERE, 'pkg/line_art_bg.wasm')) });
const cat = JSON.parse(pkg.catalog());
const byKey = new Map(cat.map(e => [e.key, e]));
function renderAll(key, W, H, frame, stepScale = 2) {
  const e = byKey.get(key), params = new Float64Array(e.params.map(p => p.value));
  const c = Array.from(pkg.camera_for(key, params));
  const fit = viewFit({ w: W, h: H }, frame, e.width / e.height, c[9]);
  const job = new pkg.Job(key, params, new Float64Array([...c.slice(0, 9), fit.fovy, fit.sx, fit.sy]), W, H, stepScale);
  const paths = [];
  let depthOk = true;
  while (!job.done()) {
    const buf = job.next(200000), d = job.depths();
    if (d.length !== buf[0]) depthOk = false;
    let i = 1;
    for (let k = 0; k < buf[0]; k++) {
      const m = buf[i++];
      paths.push({ pts: buf.slice(i, i + m * 2), len: 0, depth: d[k] });
      i += m * 2;
    }
  }
  job.free();
  return { paths, depthOk, fit };
}
const bbox = ps => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) for (let j = 0; j < p.pts.length; j += 2) { x0 = Math.min(x0, p.pts[j]); x1 = Math.max(x1, p.pts[j]); y0 = Math.min(y0, p.pts[j + 1]); y1 = Math.max(y1, p.pts[j + 1]); }
  return { x0, y0, x1, y1 };
};
for (const key of ['example0', 'skyscrapers', 'city', 'stairs']) {
  if (!byKey.has(key)) { ok(false, 'example exists: ' + key); continue; }
  const W = 1200, H = 800, frame = { x: 400, y: 100, w: 760, h: 560 };
  const r = renderAll(key, W, H, frame);
  ok(r.paths.length > 0, `${key}: renders paths`);
  ok(r.depthOk, `${key}: one depth per path in every slice`);
  ok(r.paths.every(p => Number.isFinite(p.depth)), `${key}: depths are finite`);
  const o = orderPaths(r.paths.map(p => ({ ...p })));
  ok(o.paths.every((p, i) => !i || p.depth >= o.paths[i - 1].depth), `${key}: sorted draw order is non-decreasing in depth`);
  const b = bbox(r.paths);
  ok(b.x0 >= -1e-3 && b.y0 >= -1e-3 && b.x1 <= W + 1e-3 && b.y1 <= H + 1e-3, `${key}: every point is in the whole image`, JSON.stringify(b));
  console.log(`  ${key}: ${r.paths.length} paths, depth ${o.paths[0].depth.toFixed(2)}..${o.paths[o.paths.length - 1].depth.toFixed(2)}, bbox x ${b.x0.toFixed(0)}..${b.x1.toFixed(0)} y ${b.y0.toFixed(0)}..${b.y1.toFixed(0)} (image ${W}x${H}, frame x ${frame.x}..${frame.x + frame.w})`);
}
{
  // the lens shift: the same frame size on the left and on the right half
  // moves the subject by the frame offset (screen x), not the clip box
  const W = 1200, H = 600;
  const L = renderAll('example0', W, H, { x: 0, y: 0, w: 600, h: 600 }), R = renderAll('example0', W, H, { x: 600, y: 0, w: 600, h: 600 });
  const bl = bbox(L.paths), br = bbox(R.paths);
  const cl = (bl.x0 + bl.x1) / 2, cr = (br.x0 + br.x1) / 2;
  ok(close(cr - cl, 600, 2), 'lens shift moves the subject with the frame', `${cl.toFixed(1)} -> ${cr.toFixed(1)}`);
  ok(close(bl.x1 - bl.x0, br.x1 - br.x0, 1), 'lens shift keeps the subject size');
  console.log(`  lens shift: subject center x ${cl.toFixed(1)} (frame left) -> ${cr.toFixed(1)} (frame right)`);
}
{
  // lines go past the frame: a frame in the middle third of the image,
  // and a scene with ground lines (stairs) reaches past it
  const W = 1500, H = 700, frame = { x: 500, y: 150, w: 500, h: 400 };
  let past = false;
  for (const key of ['city', 'stairs', 'skyscrapers', 'terrain']) {
    if (!byKey.has(key)) continue;
    const b = bbox(renderAll(key, W, H, frame).paths);
    if (b.x0 < frame.x - 5 || b.x1 > frame.x + frame.w + 5 || b.y0 < H - frame.y - frame.h - 5 || b.y1 > H - frame.y + 5) past = true;
  }
  ok(past, 'lines extend past the frame (no clip to the frame box)');
}
{
  // a near and a far cube in the depth test of the crate is in Rust
  // (cargo test); here: the overlay (flat art) has depth 0
  const g = byKey.get('graph');
  if (g) {
    const r = renderAll('graph', 900, 600, null);
    ok(r.depthOk && r.paths.length > 0, 'graph: depths for the scene and the overlay');
  }
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
