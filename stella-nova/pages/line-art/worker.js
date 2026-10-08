// ============================================================================
//  LINE ART  ·  worker.js — the ln engine (Rust, wasm) off the main thread
// ----------------------------------------------------------------------------
//  A module worker. It loads pkg/line_art.js (wasm-bindgen glue) and runs
//  one render job at a time in slices, so the page never blocks:
//    1. 'render' builds a Job (the scene of one example) and compiles it.
//    2. Each slice calls job.next(budget) until about SLICE_MS ms pass,
//       then posts the new paths as one 'chunk' (the buffer is moved, not
//       copied) and yields with a MessageChannel tick.
//    3. A new 'render' or a 'cancel' changes the current id. The loop sees
//       the change at the next slice, frees the old job and stops.
//  The path buffer format is in crate/src/wasm.rs (Job::next).
//
//  The camera: camera_for(key, params) gives the example camera. The
//  orbit { az, el } (radians) turns the eye about the up axis and tilts it
//  toward up. The image is the whole view; `frame` is the clear part of it
//  (CSS px, y down). geom.js viewFit sets fovy and a lens shift so the
//  example view fits the frame and the ln clip box is the whole image
//  (function cameraArray). Without a frame, the frame is the whole image.
//
//  Each chunk also carries `depth`: one camera depth per path (wasm.rs
//  Job::depths). The page sorts the paths by it (geom.js orderPaths).
//
//  Messages in:  { type:'render', id, key, params, orbit, width, height, frame, stepScale }
//                { type:'cancel', id }
//                { type:'svg', id, key, params, orbit, width, height, frame, stepScale, stroke, background, lineWidth }
//  Messages out: { type:'ready', catalog, version } | { type:'fail', message }
//                { type:'chunk', id, buf, depth, progress, rays, paths, segments, ms }
//                { type:'done', id, rays, paths, segments, ms, shapes }
//                { type:'svg', id, text } | { type:'error', id, message }
//
//  grep -n targets: "function run", "function slice", "onmessage"
// ============================================================================
import init, { Job, catalog, code, camera_for, render_svg, version } from './pkg/line_art.js';
import { viewFit } from './geom.js';

const SLICE_MS = 14;
let current = 0;       // the id of the live render; 0 = none
let job = null;
const tick = new MessageChannel();
let resumeTick = null;
tick.port1.onmessage = () => { const r = resumeTick; resumeTick = null; if (r) r(); };
const yieldNow = () => new Promise(r => { resumeTick = r; tick.port2.postMessage(0); });

const byKey = new Map();
const ready = init().then(() => {
  const cat = JSON.parse(catalog());
  for (const e of cat) { e.code = code(e.key); byKey.set(e.key, e); }
  postMessage({ type: 'ready', catalog: cat, version: version() });
}).catch(e => postMessage({ type: 'fail', message: String(e && e.message || e) }));

// Rodrigues: v turned by angle a about the unit axis k.
function turn(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * d * (1 - c));
}
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// The camera array for the job: [eye, center, up, fovy, shift x, shift y].
export function cameraArray(key, params, orbit, width, height, frame) {
  const c = Array.from(camera_for(key, new Float64Array(params || [])));
  if (c.length < 10) return [];
  const center = c.slice(3, 6), up = unit(c.slice(6, 9));
  let d = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];
  const az = orbit && orbit.az || 0, el = orbit && orbit.el || 0;
  if (az) d = turn(d, up, az);
  if (el) {
    const n = unit(d), ang = Math.acos(Math.max(-1, Math.min(1, n[0] * up[0] + n[1] * up[1] + n[2] * up[2])));
    const target = Math.max(0.08, Math.min(Math.PI - 0.08, ang - el));
    const k = unit([n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0]]);
    if (Math.hypot(...k) > 0.5) d = turn(d, k, ang - target);
  }
  const e = byKey.get(key), a0 = e ? e.width / e.height : 1;
  const fit = viewFit({ w: width, h: height }, frame, a0, c[9]);
  return [center[0] + d[0], center[1] + d[1], center[2] + d[2], ...center, ...up, fit.fovy, fit.sx, fit.sy];
}

function free() { if (job) { try { job.free(); } catch (e) { /* freed */ } job = null; } }

async function run(m) {
  await ready;
  if (m.id !== current) return;
  free();
  const t0 = performance.now();
  try {
    const cam = cameraArray(m.key, m.params, m.orbit, m.width, m.height, m.frame);
    job = new Job(m.key, new Float64Array(m.params || []), new Float64Array(cam), m.width, m.height, m.stepScale || 1);
  } catch (e) {
    postMessage({ type: 'error', id: m.id, message: String(e && e.message || e) });
    return;
  }
  let budget = 4000;
  while (m.id === current && job && !job.done()) {
    const s0 = performance.now();
    const parts = [], depths = [];
    let total = 0;
    // One slice: several next() calls, the budget tuned to the slice time.
    while (performance.now() - s0 < SLICE_MS && !job.done()) {
      const c0 = performance.now();
      const buf = job.next(budget);
      if (buf[0] > 0) { parts.push(buf); depths.push(job.depths()); total += buf.length - 1; }
      const dt = performance.now() - c0;
      if (dt < SLICE_MS / 4) budget = Math.min(budget * 2, 400000);
      else if (dt > SLICE_MS) budget = Math.max(500, budget >> 1);
    }
    if (parts.length) {
      const out = new Float32Array(total + 1);
      let o = 1, n = 0;
      for (const b of parts) { n += b[0]; out.set(b.subarray(1), o); o += b.length - 1; }
      out[0] = n;
      const depth = new Float32Array(n);
      o = 0;
      for (const d of depths) { depth.set(d, o); o += d.length; }
      postMessage({ type: 'chunk', id: m.id, buf: out, depth, progress: job.progress(), rays: job.rays(), paths: job.paths_out(), segments: job.segments_out(), ms: performance.now() - t0 }, [out.buffer, depth.buffer]);
    }
    await yieldNow();
  }
  if (m.id === current && job) {
    postMessage({ type: 'done', id: m.id, camera: cameraArray(m.key, m.params, m.orbit, m.width, m.height, m.frame), rays: job.rays(), paths: job.paths_out(), segments: job.segments_out(), shapes: job.shape_count(), ms: performance.now() - t0 });
    free();
  }
}

onmessage = async e => {
  const m = e.data;
  if (m.type === 'render') { current = m.id; run(m); }
  else if (m.type === 'cancel') { if (current === m.id) { current = 0; } }
  else if (m.type === 'svg') {
    await ready;
    try {
      const cam = cameraArray(m.key, m.params, m.orbit, m.width, m.height, m.frame);
      const text = render_svg(m.key, new Float64Array(m.params || []), new Float64Array(cam), m.width, m.height, m.stepScale || 1, m.stroke, m.background, m.lineWidth);
      postMessage({ type: 'svg', id: m.id, text });
    } catch (err) { postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
  }
};
