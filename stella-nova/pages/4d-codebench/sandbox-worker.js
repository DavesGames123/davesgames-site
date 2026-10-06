// ============================================================================
//  SANDBOX-WORKER  ·  runs submission code and builds a 4D world (module worker)
// ----------------------------------------------------------------------------
//  sandbox.js starts this file as a module Web Worker for each run, sends
//  { code, meta } and gets back { ok, world, errors, log, ms }. The main
//  thread terminates the worker when the time limit is gone, so an endless
//  loop in submission code cannot stop the page. The Float32Array and
//  Uint32Array buffers of the world go back as transfers (no copy).
//
//  The same file is a plain ES module with no DOM. Node tests import
//  makeApi and evaluate from it and run the presets with no worker. The
//  message handler attaches only in a worker scope.
//
//  Submission code. Two forms are accepted:
//    1. A function body that returns a World or an array of objects.
//    2. Code that declares   function build(api) { ... }   (an "export"
//       keyword in front of it is removed). The sandbox calls build(api).
//  The code sees two names: api (below) and console (log, warn and error
//  go to the run log). A thrown error is reported with the line number in
//  the submission code. A syntax error is located line by line.
//
//  The api (meta = { fps, frames, camera } of the reference scene):
//    fps, frames, seconds, dt, g ... numbers (dt = 1 / fps, g = 9.81)
//    camera .......................... copy of the reference camera
//    Shapes { verts: Float32Array (local), faces: Uint32Array }:
//      box(hx, hy, hz)    24 vertices, flat sides, centred on the origin
//      sphere(r, detail)  icosphere, detail 0..4 (default 2)
//      sheet(n, size)     n x n grid in the xz plane, vertex (i, j) = j*n+i
//      cylinder(r, h, seg)  axis y, from y = 0 to y = h
//    Objects (plain data in the world.js format):
//      solid(name, shape, color, at?, R?)    static, one stored frame
//      rigid(name, shape, color, pose)       pose(f, t) -> { p: [x,y,z], R?: 3x3 }
//      mesh(name, shape, color)              dynamic; every frame starts as
//                                            the rest shape, write with at()
//      points(name, count, radius, color)    dynamic particles, all zero
//      at(obj, f) ......................     writable count*3 view of frame f
//      world(objects) ..................     { fps, frames, camera, objects }
//    Maths: v.{add, sub, scale, dot, cross, len, norm, lerp},
//      rotX, rotY, rotZ, mul (3x3 matrices as 9-arrays, row-major),
//      apply(R, v), clamp, lerp, smooth (smoothstep 0..1),
//      keys(list, t)  linear keyframes [[t0, value], [t1, value], ...],
//                     value is a number or an array
//      rng(seed)      seeded random numbers 0..1
//    log(...args)     add a line to the run log
//
//  EXPORTS   (grep -n "<anchor>" sandbox-worker.js)
//    api factory ...... "export function makeApi"
//    run code ......... "export async function evaluate"
//    transfer list .... "export function transferList"
//  INTERNALS
//    compile .......... "function compile"
//    error line ....... "function userLine", "function syntaxLine"
//    clean copy ....... "function cleanWorld"
//    worker hook ...... "IN_WORKER"
// ============================================================================

import { validate, LIMITS } from './world.js';

const LOG_MAX = 200;

// ------------------------------------------------------------------ shapes ---

function boxShape(hx, hy, hz) {
  const v = [], f = [];
  // Each side: axis a, sign s. Four corners, two triangles, outward normal.
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
    const b = (a + 1) % 3, c = (a + 2) % 3, h = [hx, hy, hz], k = v.length / 3;
    for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 0, 0]; p[a] = s * h[a]; p[b] = u * h[b]; p[c] = w * h[c]; v.push(...p);
    }
    if (s > 0) f.push(k, k + 1, k + 2, k, k + 2, k + 3); else f.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }
  return { verts: new Float32Array(v), faces: new Uint32Array(f) };
}

function sphereShape(r, detail = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const unit = (p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
  v = v.map(unit);
  const n = Math.max(0, Math.min(4, detail | 0));
  for (let s = 0; s < n; s++) {
    const mid = new Map(), nf = [];
    const m = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let i = mid.get(key);
      if (i === undefined) { i = v.length; v.push(unit([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])); mid.set(key, i); }
      return i;
    };
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  const verts = new Float32Array(v.length * 3);
  v.forEach((p, i) => { verts[i * 3] = p[0] * r; verts[i * 3 + 1] = p[1] * r; verts[i * 3 + 2] = p[2] * r; });
  return { verts, faces: new Uint32Array(f.flat()) };
}

function sheetShape(n, size) {
  const verts = new Float32Array(n * n * 3), f = [], sp = size / (n - 1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (j * n + i) * 3; verts[k] = i * sp - size / 2; verts[k + 2] = j * sp - size / 2;
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    f.push(a, c, b, b, c, d);
  }
  return { verts, faces: new Uint32Array(f) };
}

function cylinderShape(r, h, seg = 24) {
  const v = [], f = [];
  for (let i = 0; i < seg; i++) {
    const a = 2 * Math.PI * i / seg, x = r * Math.cos(a), z = r * Math.sin(a);
    v.push(x, 0, z, x, h, z);
  }
  const bc = v.length / 3; v.push(0, 0, 0, 0, h, 0);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg, a = 2 * i, b = 2 * i + 1, c = 2 * j, d = 2 * j + 1;
    f.push(a, b, c, c, b, d, bc, a, c, bc + 1, d, b);
  }
  return { verts: new Float32Array(v), faces: new Uint32Array(f) };
}

// ------------------------------------------------------------------ maths ----

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s],
};
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
function mul(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}
const apply = (R, p) => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, s) => a + (b - a) * s;
const smooth = (x) => { const t = clamp(x); return t * t * (3 - 2 * t); };
function keys(list, t) {
  if (t <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) {
    const [t1, b] = list[i];
    if (t <= t1) {
      const [t0, a] = list[i - 1], s = (t - t0) / ((t1 - t0) || 1);
      return Array.isArray(a) ? a.map((x, k) => x + (b[k] - x) * s) : a + (b - a) * s;
    }
  }
  return list[list.length - 1][1];
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------- api --------

// Make the api object for one run. meta = { fps, frames, camera }. The
// returned object also carries _log, the lines that log() added.
export function makeApi(meta) {
  const fps = meta.fps || 30, frames = meta.frames | 0;
  const cam = meta.camera;
  const log = [];
  const say = (...a) => {
    if (log.length < LOG_MAX) log.push(a.map((x) => (typeof x === 'string' ? x : safeText(x))).join(' '));
    else if (log.length === LOG_MAX) log.push('(log is full)');
  };
  const colour = (c) => (Array.isArray(c) && c.length === 3 ? c.map(Number) : [0.7, 0.7, 0.7]);
  const need = (shape, who) => {
    if (!shape || !(shape.verts instanceof Float32Array) || !(shape.faces instanceof Uint32Array)) throw new Error(`${who}: shape must be { verts: Float32Array, faces: Uint32Array }`);
    if (shape.verts.length / 3 > LIMITS.count) throw new Error(`${who}: at most ${LIMITS.count} vertices`);
  };
  const place = (src, dst, o, p, R) => {
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      if (R) {
        dst[o + i] = R[0] * x + R[1] * y + R[2] * z + p[0];
        dst[o + i + 1] = R[3] * x + R[4] * y + R[5] * z + p[1];
        dst[o + i + 2] = R[6] * x + R[7] * y + R[8] * z + p[2];
      } else { dst[o + i] = x + p[0]; dst[o + i + 1] = y + p[1]; dst[o + i + 2] = z + p[2]; }
    }
  };
  const api = {
    fps, frames, seconds: frames / fps, dt: 1 / fps, g: 9.81,
    camera: { eye: cam.eye.slice(), target: cam.target.slice(), fovY: cam.fovY },
    box: boxShape, sphere: sphereShape, sheet: sheetShape, cylinder: cylinderShape,
    solid(name, shape, color, at = [0, 0, 0], R = null) {
      need(shape, `solid ${name}`);
      const pos = new Float32Array(shape.verts.length);
      place(shape.verts, pos, 0, at, R);
      return { name: String(name), kind: 'mesh', color: colour(color), dynamic: false, count: shape.verts.length / 3, faces: shape.faces, pos };
    },
    rigid(name, shape, color, pose) {
      need(shape, `rigid ${name}`);
      const n = shape.verts.length, pos = new Float32Array(frames * n);
      for (let f = 0; f < frames; f++) {
        const q = pose(f, f / fps) || {};
        place(shape.verts, pos, f * n, q.p || [0, 0, 0], q.R || null);
      }
      return { name: String(name), kind: 'mesh', color: colour(color), dynamic: true, count: n / 3, faces: shape.faces, pos };
    },
    mesh(name, shape, color) {
      need(shape, `mesh ${name}`);
      const n = shape.verts.length, pos = new Float32Array(frames * n);
      for (let f = 0; f < frames; f++) pos.set(shape.verts, f * n);
      return { name: String(name), kind: 'mesh', color: colour(color), dynamic: true, count: n / 3, faces: shape.faces, pos };
    },
    points(name, count, radius, color) {
      if (!(count >= 1 && count <= LIMITS.count)) throw new Error(`points ${name}: count must be 1..${LIMITS.count}`);
      return { name: String(name), kind: 'points', color: colour(color), dynamic: true, count: count | 0, radius: +radius, pos: new Float32Array(frames * (count | 0) * 3) };
    },
    at(obj, f) {
      const n = obj.count * 3, k = obj.pos.length === n ? 0 : Math.max(0, Math.min(frames - 1, f | 0));
      return obj.pos.subarray(k * n, (k + 1) * n);
    },
    world(objects) {
      return { fps, frames, camera: { eye: cam.eye.slice(), target: cam.target.slice(), fovY: cam.fovY }, objects: [...objects] };
    },
    v: V, rotX, rotY, rotZ, mul, apply, clamp, lerp, smooth, keys, rng,
    log: say,
  };
  Object.defineProperty(api, '_log', { value: log, enumerable: false });
  return api;
}

function safeText(x) {
  try { return x instanceof Error ? `${x.name}: ${x.message}` : JSON.stringify(x, (_k, v) => (ArrayBuffer.isView(v) ? `${v.constructor.name}(${v.length})` : v)); }
  catch { return String(x); }
}

// ------------------------------------------------------------ compile -------

// Turn "export function build" and "export default function" into a plain
// declaration, so that the code is a valid function body.
function prepare(code) {
  return String(code)
    .replace(/^(\s*)export\s+default\s+function\s*\w*\s*\(/m, '$1function build(')
    .replace(/^(\s*)export\s+(?=(async\s+)?function|const|let|var|class)/gm, '$1');
}

const TAIL = "\n;return (typeof build === 'function') ? build(api) : undefined;";

function compile(code) {
  return new Function('api', 'console', prepare(code) + TAIL);
}

// Line of the submission code that an error stack points at, or 0.
// V8 writes "<anonymous>:L:C", Firefox writes "> Function:L:C". The
// offset of the wrapper comes from a probe that throws on line 1.
const FRAME_RE = /(?:<anonymous>|> Function):(\d+):(\d+)/;
let lineOffset = null;
function userLine(err) {
  if (lineOffset === null) {
    try { new Function('api', 'console', 'throw new Error("probe")')(); }
    catch (e) { const m = FRAME_RE.exec(String(e && e.stack)); lineOffset = m ? +m[1] - 1 : -1; }
  }
  if (lineOffset < 0 || !err || !err.stack) return 0;
  const m = FRAME_RE.exec(String(err.stack));
  return m ? Math.max(1, +m[1] - lineOffset) : 0;
}

// V8 gives no line for a syntax error in new Function. Compile longer and
// longer prefixes. Each prefix gets a sentinel line after it: a private
// name that is illegal in every context. If the parser stops at the
// sentinel (its name is in the message), the prefix only ends too soon.
// A second try closes an open block comment first. The first prefix that
// fails before the sentinel holds the bad line. The new Function wrapper
// adds "})" after the body, so without the sentinel an open block gives
// the same "Unexpected token" error as a real fault.
const SENTINEL = '#__end_of_prefix__';
function syntaxLine(code) {
  const lines = prepare(code).split('\n');
  const early = /end of (input|script)|expected expression, got end|Unexpected EOF/i;
  const stopsAtEnd = (src) => {
    for (const tail of ['\n', '*/\n']) {
      try { new Function('api', 'console', src + tail + SENTINEL + '\n' + SENTINEL); return true; }
      catch (e) { if (e.message.includes(SENTINEL.slice(1)) || early.test(e.message)) return true; }
    }
    return false;
  };
  for (let n = 1; n <= lines.length; n++) if (!stopsAtEnd(lines.slice(0, n).join('\n'))) return n;
  return 0;
}

// Keep only the world.js fields, so that postMessage can copy the result
// (user objects may carry functions).
function cleanWorld(w) {
  const out = { fps: w.fps, frames: w.frames, camera: w.camera && { eye: w.camera.eye, target: w.camera.target, fovY: w.camera.fovY }, objects: [] };
  if (Array.isArray(w.objects)) for (const o of w.objects) {
    if (!o || typeof o !== 'object') { out.objects.push(o); continue; }
    const c = { name: o.name, kind: o.kind, color: o.color, dynamic: !!o.dynamic, count: o.count, pos: o.pos };
    if (o.kind === 'mesh') c.faces = o.faces; else c.radius = o.radius;
    out.objects.push(c);
  }
  return out;
}

// Run submission code against meta. Never throws: returns
// { ok, world?, errors: [string], log: [string], ms }.
export async function evaluate(code, meta) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now(), errors = [];
  const api = makeApi(meta), log = api._log;
  const fakeConsole = { log: api.log, info: api.log, warn: (...a) => api.log('warn:', ...a), error: (...a) => api.log('error:', ...a) };
  let fn;
  try { fn = compile(code); }
  catch (e) {
    const L = syntaxLine(code);
    return { ok: false, errors: [`${e.name}: ${e.message}${L ? ` (line ${L})` : ''}`], log, ms: now() - t0 };
  }
  let res;
  try { res = await fn(api, fakeConsole); }
  catch (e) {
    const L = userLine(e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : `thrown: ${safeText(e)}`;
    return { ok: false, errors: [msg + (L ? ` (line ${L})` : '')], log, ms: now() - t0 };
  }
  if (Array.isArray(res)) res = api.world(res);
  if (!res || typeof res !== 'object') {
    errors.push('the code returned nothing: return api.world([...]) or an array of objects, or declare function build(api)');
    return { ok: false, errors, log, ms: now() - t0 };
  }
  const world = cleanWorld(res);
  const v = validate(world);
  if (!v.ok) return { ok: false, errors: v.errors.slice(0, 12), log, ms: now() - t0 };
  return { ok: true, world, errors, log, ms: now() - t0 };
}

// The distinct ArrayBuffers of a world, for postMessage transfer.
export function transferList(world) {
  const s = new Set();
  if (world) for (const o of world.objects) {
    if (o.pos && o.pos.buffer) s.add(o.pos.buffer);
    if (o.faces && o.faces.buffer) s.add(o.faces.buffer);
  }
  return [...s];
}

// ------------------------------------------------------------ worker hook ---

const IN_WORKER = typeof self === 'object' && self !== null && typeof self.postMessage === 'function' && typeof document === 'undefined';
if (IN_WORKER) {
  self.onmessage = async (ev) => {
    const { code, meta } = ev.data || {};
    const r = await evaluate(code, meta);
    try { self.postMessage(r, transferList(r.world)); }
    catch (e) { self.postMessage({ ok: false, errors: [`could not send the world: ${e.message}`], log: r.log, ms: r.ms }); }
  };
}
