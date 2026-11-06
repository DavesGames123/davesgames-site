// ============================================================================
//  COLLAPSE CITY  ·  main.js — the page: world, camera, controls, panel, loop
// ----------------------------------------------------------------------------
//  The Rust solver (pkg/wfc_city.js, CONTRACT.md "wasm API") builds the city
//  round a focus point. gpu.js draws it. This file loads the world, runs the
//  camera modes and the controls, and moves the chunk meshes to the GPU.
//
//  WORLD. loadWorld() imports ./pkg/wfc_city.js. Only when that import
//  fails (pkg/ is missing) does it use ./mock-world.js, and #mockBadge then
//  shows. A pkg that imports but does not start is an error, not the mock.
//  Node tests set globalThis.__WFC_WASM__ to the wasm bytes for init(), and
//  globalThis.__WFC_PKG_BASE__ to a folder with no pkg/ for the mock run.
//
//  MODES
//    fly    Fly-over (the default): a drone glides and turns by itself.
//           Drag to look, W/S speed, A/D turn, Q/E or the wheel height.
//    walk   pointer lock, WASD, mouse look, Space jump, Shift run, F fly.
//           move_body() of the world does the collision. Touch: left stick,
//           drag look, jump and fly buttons.
//    watch  a fresh seed; the camera orbits above, and the display clock
//           runs slowly, so each slot falls in on its own.
//  Keys: 1 walk, 2 fly-over, 3 watch, N new city, [ ] time of day, H panel.
//
//  THE DISPLAY CLOCK. world.counter() counts collapses; each vertex has the
//  count of its slot (birth). app.clock follows the counter at a rate, and
//  the shader drops in each slot as the clock passes its birth. Drop span
//  (in counts) = rate x animation seconds.
//
//  PER FRAME: camera -> update() inside a time budget -> dirty_chunks() ->
//  chunk_mesh() for a few chunks (nearest first) -> forget_far() twice a
//  second -> render (frames in flight capped in gpu.js).
//
//  PHONE (the wave-membrane pattern): #dock at the base, #panel a bottom
//  sheet (#sheetGrip: tap half/full, drag down closes), a right drawer in
//  landscape. occlusion() measures the overlays, and the projection centre
//  moves into the clear part.
//
//  window.__wfc = { ready: Promise<api>, app: api }   (saver.js, tests)
//
//  GREP MAP
//    export async function loadWorld ... pkg first, mock when pkg is missing
//    export function clockStep ......... the display clock
//    export function focusAhead ........ the generation focus
//    async function boot ............... renderer, world, UI, loop
//    function resetWorld ............... new World(seed), clear the GPU chunks
//    function generate ................. update() in a time budget
//    function pumpMeshes ............... dirty chunks -> chunk_mesh -> GPU
//    function stepWalk / stepFly / stepWatch / stepSaver
//    function occlusion ................ overlay margins
//    function frame .................... the loop
//    function bindUI ................... panel, dock, sheet, sliders
//    function bindInput ................ keys, mouse, pointer lock, touch
// ============================================================================
import { createRenderer, M4, skyState } from './gpu.js';

const CELL = 2, CHUNK = 8;
export const DEFAULTS = { radius: 36, speed: 5, anim: 0.9, hour: 16.5, height: 12 };

// ---- pure helpers (node tests) ------------------------------------------------------
export async function loadWorld(base = './') {
  let mod = null, missing = null;
  try { mod = await import(base + 'pkg/wfc_city.js'); } catch (e) { missing = e; }
  if (mod) {
    const bytes = globalThis.__WFC_WASM__;
    await mod.default(bytes ? { module_or_path: bytes } : undefined);
    return { mod, mock: false };
  }
  const m = await import('./mock-world.js');
  await m.default();
  return { mod: m, mock: true, why: missing && String(missing.message || missing) };
}

// The display clock. target = world.counter(). fixedRate: slots per second
// (watch mode), or null to catch up. Returns { clock, rate }.
export function clockStep(clock, target, rate, dt, fixedRate) {
  if (target < clock) return { clock: target, rate };
  let want;
  if (fixedRate != null) want = fixedRate;
  else want = Math.max(120, (target - clock) * 2.2);
  rate = rate + (want - rate) * (1 - Math.exp(-dt * (fixedRate != null ? 8 : 3)));
  if (fixedRate == null) rate = Math.max(rate, (target - clock) * 0.9);
  clock = Math.min(target, clock + rate * dt);
  return { clock, rate };
}

// The point to generate round: ahead of the camera on the ground plane.
export function focusAhead(eye, yaw, radiusCells, k = 0.28) {
  const d = radiusCells * CELL * k;
  return [eye[0] - Math.sin(yaw) * d, Math.max(0, Math.min(eye[1], 20)), eye[2] - Math.cos(yaw) * d];
}

// generation speed 1..10 -> { budget per call, ms per frame }
export function speedBudget(v) {
  v = Math.max(1, Math.min(10, v));
  return { budget: Math.round(30 * Math.pow(v, 1.5)), ms: 1 + v * 0.9 };
}

// ---- the page ---------------------------------------------------------------------
const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';
let readyResolve;
if (hasDOM) window.__wfc = { ready: new Promise(r => { readyResolve = r; }), app: null };

const app = {
  world: null, mod: null, mock: false, R: null, canvas: null, seed: 1, H: DEFAULTS.height,
  radius: DEFAULTS.radius, speed: DEFAULTS.speed, anim: DEFAULTS.anim, hour: DEFAULTS.hour,
  mode: 'fly', clock: 0, rate: 0, time: 0, sky: null, skyHour: -1,
  cam: { eye: [0, 34, 40], yaw: 0, pitch: -0.36, fov: 60 * Math.PI / 180 },
  body: new Float32Array(8), flying: false, eyeY: 0, bob: 0, held: false,
  drone: { speed: 14, alt: 34, idle: 0, wander: 0 },
  watch: { az: 0.6, dist: 70, el: 0.78, centre: [0, 0], spin: true },
  saver: null, pose: null,
  queue: new Set(), lastForget: 0, frameMs: 16, fps: 60, statT: 0, genMs: 0,
  keys: new Set(), look: [0, 0], stick: [0, 0], stickRun: false, jumpQ: false, upHeld: false,
  occ: { l: 0, r: 0, t: 0, b: 0 }, failed: null,
};

function $(id) { return document.getElementById(id); }
function status(msg, err) {
  const b = $('boot'); if (!b) return;
  b.hidden = !msg; b.textContent = msg || ''; b.classList.toggle('err', !!err);
}

// ---- world ------------------------------------------------------------------------
function resetWorld(seed) {
  app.seed = (seed >>> 0) || 1;
  if (app.world) { try { app.world.free(); } catch (e) { /* freed */ } }
  app.world = new app.mod.World(app.seed, app.H);
  if (app.R) {
    app.R.clearChunks();
    const pal = app.world.palette();
    if (pal && pal.length >= 48) app.R.setPalette(pal);
  }
  app.queue.clear();
  app.clock = 0; app.rate = 0;
  const si = hasDOM && $('seedInput'); if (si) si.value = String(app.seed);
  if (hasDOM) {
    try { const u = new URL(location.href); u.searchParams.set('seed', String(app.seed)); history.replaceState(null, '', u); } catch (e) { /* file url */ }
  }
}

// The nearest open street cell to (x, z): layer 0 is pavement, road, plaza
// or lawn and layer 1 is air. It returns the cell centre in metres, or null.
const STREET = /^(pavement|road|plaza|lawn)/;
function streetNear(x, z, maxR = 14) {
  const w = app.world;
  if (!w || typeof w.slot_info !== 'function' || typeof w.prototype_name !== 'function') return null;
  const ci = Math.floor(x / 2), ck = Math.floor(z / 2);
  const names = new Map();
  const name = p => { if (!names.has(p)) names.set(p, p >= 0 ? w.prototype_name(p) : ''); return names.get(p); };
  for (let r = 0; r <= maxR; r++) {
    for (let di = -r; di <= r; di++) for (let dk = -r; dk <= r; dk++) {
      if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
      const a = w.slot_info(ci + di, 0, ck + dk), b = w.slot_info(ci + di, 1, ck + dk);
      if (a[0] !== 2 || b[0] !== 2) continue;
      if (STREET.test(name(a[3])) && name(b[3]) === 'air') return [2 * (ci + di) + 1, 2 * (ck + dk) + 1];
    }
  }
  return null;
}

function heightAt(x, z) {
  if (!app.world) return 0;
  const h = app.world.ground_height(x, z);
  return Number.isFinite(h) ? h : 0;
}

function generate(focus, radius, scale = 1) {
  const W = app.world, sb = speedBudget(app.speed), t0 = performance.now();
  const cap = sb.ms * scale, budget = Math.max(1, Math.round(sb.budget * Math.min(scale, 3)));
  let total = 0;
  for (let n = 0; n < 64; n++) {
    const got = W.update(focus[0], focus[1], focus[2], radius, budget);
    total += got;
    if (!got || performance.now() - t0 > cap) break;
  }
  app.genMs = app.genMs * 0.9 + (performance.now() - t0) * 0.1;
  const d = W.dirty_chunks();
  for (let n = 0; n + 1 < d.length; n += 2) app.queue.add(d[n] + ',' + d[n + 1]);
  return total;
}

function pumpMeshes(eye, maxN, maxMs) {
  if (!app.queue.size) return 0;
  const t0 = performance.now();
  let list = [...app.queue].map(k => { const [a, b] = k.split(',').map(Number); return [a, b, Math.hypot((a + 0.5) * 16 - eye[0], (b + 0.5) * 16 - eye[2])]; });
  if (list.length > maxN) list.sort((p, q) => p[2] - q[2]);
  let n = 0;
  for (const [cx, cz] of list) {
    if (n >= maxN || (n > 0 && performance.now() - t0 > maxMs)) break;
    app.queue.delete(cx + ',' + cz);
    app.R.uploadChunk(cx, cz, app.world.chunk_mesh(cx, cz));
    n++;
  }
  return n;
}

function forget(eye, now, radius) {
  if (now - app.lastForget < 500) return;
  app.lastForget = now;
  const keep = Math.max(app.radius, radius) + 20;
  const gone = app.world.forget_far(eye[0], eye[2], keep);
  for (let n = 0; n + 1 < gone.length; n += 2) { app.R.dropChunk(gone[n], gone[n + 1]); app.queue.delete(gone[n] + ',' + gone[n + 1]); }
}

// ---- camera modes -------------------------------------------------------------------
let PQ_ = null, CQ_ = null;
const PHONE = () => hasDOM && (PQ_ || (PQ_ = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)'))).matches;
const COARSE = () => hasDOM && (CQ_ || (CQ_ = matchMedia('(pointer:coarse)'))).matches;

function setMode(m, opts = {}) {
  if (!['walk', 'fly', 'watch'].includes(m)) return;
  const prev = app.mode;
  app.mode = m;
  if (hasDOM) {
    for (const seg of [$('modeSeg'), $('dockMode')]) for (const b of seg.querySelectorAll('button')) {
      const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    }
    document.body.classList.toggle('mode-walk', m === 'walk');
    document.body.classList.toggle('mode-watch', m === 'watch');
    document.body.classList.toggle('touch-walk', m === 'walk' && COARSE());
    if (m !== 'walk' && document.pointerLockElement) document.exitPointerLock();
    hint();
  }
  const c = app.cam;
  if (m === 'walk') {
    // land on the nearest open street; under the camera if none is near
    const st = streetNear(c.eye[0], c.eye[2]);
    const x = st ? st[0] : c.eye[0], z = st ? st[1] : c.eye[2];
    // ground_height gives the highest top in the column (a walkway over the
    // street, for example), so on a street cell drop from 0.5 m instead
    const g = st ? 0.5 : heightAt(x, z);
    app.body.set([x, g + 0.05, z, 0, 0, 0, 0, 0]);
    app.eyeY = g + 1.62; app.flying = false; c.pitch = Math.max(-0.5, Math.min(0.2, c.pitch * 0.3));
  } else if (m === 'fly') {
    app.drone.alt = Math.max(18, c.eye[1] - heightAt(c.eye[0], c.eye[2]));
    if (prev === 'watch') { app.drone.alt = 34; c.pitch = -0.36; }
  } else if (m === 'watch' && !opts.keepWorld) {
    // a fresh seed, the camera above the origin
    resetWorld(((Math.random() * 2 ** 32) >>> 0) || 1);
    app.watch.centre = [0, 0]; app.watch.az = 0.6; app.watch.dist = 70; app.watch.el = 0.78;
  }
}

function forward(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

function stepWalk(dt) {
  const c = app.cam, b = app.body, W = app.world;
  // look
  c.yaw -= app.look[0]; c.pitch = Math.max(-1.5, Math.min(1.5, c.pitch - app.look[1])); app.look[0] = app.look[1] = 0;
  const k = app.keys;
  let fx = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let sx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  if (app.stick[0] || app.stick[1]) { fx = -app.stick[1]; sx = app.stick[0]; }
  const run = k.has('ShiftLeft') || k.has('ShiftRight') || app.stickRun;
  const fwd = [-Math.sin(c.yaw), 0, -Math.cos(c.yaw)], right = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
  let mx = fwd[0] * fx + right[0] * sx, mz = fwd[2] * fx + right[2] * sx;
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  // hold the body while the ground under it is still open
  const i = Math.floor(b[0] / CELL), kk = Math.floor(b[2] / CELL);
  let open = false;
  try { const s = W.slot_info(i, 0, kk); open = s[0] !== 2; } catch (e) { open = false; }
  app.held = open && !app.flying;
  if (app.flying) {
    const sp = run ? 26 : 11, f3 = forward(c.yaw, c.pitch);
    let vy = (app.upHeld || k.has('Space') ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') ? 1 : 0);
    const tx = (f3[0] * fx + right[0] * sx) * sp, tz = (f3[2] * fx + right[2] * sx) * sp, ty = f3[1] * fx * sp + vy * sp * 0.7;
    const a = 1 - Math.exp(-dt * 6);
    b[3] += (tx - b[3]) * a; b[4] += (ty - b[4]) * a; b[5] += (tz - b[5]) * a;
  } else if (!app.held) {
    const sp = run ? 8.5 : 4.6;
    const a = 1 - Math.exp(-dt * (b[6] ? 14 : 2.5));
    b[3] += (mx * sp - b[3]) * a; b[5] += (mz * sp - b[5]) * a;
    if ((app.jumpQ || k.has('Space')) && b[6]) { b[4] = 7.4; b[6] = 0; }
  }
  app.jumpQ = false;
  if (!app.held) {
    let left = dt;
    while (left > 1e-5) { const h = Math.min(left, 1 / 60); W.move_body(b, h, 0.32, 1.75, app.flying); left -= h; }
  } else { b[3] = b[4] = b[5] = 0; }
  if (!(b[1] > -30) || !Number.isFinite(b[0])) { const g = heightAt(b[0] || 0, b[2] || 0); b.set([b[0] || 0, g + 2, b[2] || 0, 0, 0, 0, 0, 0]); }
  // the eye: smooth over a step, a small bob while walking on the ground
  const tgt = b[1] + 1.62, hs = Math.hypot(b[3], b[5]);
  if (Math.abs(tgt - app.eyeY) > 1.5 || app.flying) app.eyeY = tgt;
  else app.eyeY += (tgt - app.eyeY) * (1 - Math.exp(-dt * 16));
  if (b[6] && hs > 0.5 && !app.flying) app.bob += dt * hs * 1.9; else app.bob *= 0.9;
  const bob = Math.sin(app.bob) * 0.035 * Math.min(1, hs / 5);
  c.eye = [b[0], app.eyeY + bob, b[2]];
  const fovT = (66 + (run && hs > 6 ? 6 : 0) + (app.flying ? 4 : 0)) * Math.PI / 180;
  c.fov += (fovT - c.fov) * (1 - Math.exp(-dt * 6));
}

function stepFly(dt) {
  const c = app.cam, d = app.drone, k = app.keys;
  const userLook = app.look[0] || app.look[1];
  c.yaw -= app.look[0]; c.pitch = Math.max(-1.4, Math.min(0.5, c.pitch - app.look[1])); app.look[0] = app.look[1] = 0;
  if (userLook) d.idle = 0; else d.idle += dt;
  const turn = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
  const acc = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  const lift = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  if (turn || acc || lift) d.idle = 0;
  c.yaw += turn * 0.9 * dt;
  d.speed = Math.max(0, Math.min(60, d.speed + acc * 20 * dt));
  d.alt = Math.max(6, Math.min(160, d.alt + lift * 14 * dt));
  // autopilot: a slow wander, and the pitch back to a calm look-down
  if (d.idle > 3) {
    d.wander += dt * 0.11;
    c.yaw += Math.sin(d.wander) * 0.05 * dt;
    c.pitch += (-0.36 - c.pitch) * (1 - Math.exp(-dt * 0.4));
  }
  const f = [-Math.sin(c.yaw), -Math.cos(c.yaw)];
  c.eye[0] += f[0] * d.speed * dt; c.eye[2] += f[1] * d.speed * dt;
  // stay over the roofs ahead
  let g = heightAt(c.eye[0], c.eye[2]);
  for (const a of [8, 16, 24]) g = Math.max(g, heightAt(c.eye[0] + f[0] * a, c.eye[2] + f[1] * a));
  const want = Math.max(d.alt, g + 6);
  c.eye[1] += (want - c.eye[1]) * (1 - Math.exp(-dt * (want > c.eye[1] ? 3 : 0.7)));
  c.fov += (60 * Math.PI / 180 - c.fov) * (1 - Math.exp(-dt * 4));
}

function stepWatch(dt) {
  const c = app.cam, w = app.watch;
  if (app.look[0] || app.look[1]) { w.spin = false; w.idle = 0; }
  w.az += app.look[0]; w.el = Math.max(0.25, Math.min(1.45, w.el + app.look[1])); app.look[0] = app.look[1] = 0;
  w.idle = (w.idle || 0) + dt;
  if (w.idle > 4) w.spin = true;
  if (w.spin) w.az += 0.05 * dt;
  const ce = Math.cos(w.el);
  c.eye = [w.centre[0] + Math.sin(w.az) * ce * w.dist, Math.sin(w.el) * w.dist + 4, w.centre[1] + Math.cos(w.az) * ce * w.dist];
  c.yaw = w.az; c.pitch = -Math.atan2(c.eye[1] - 4, Math.hypot(c.eye[0] - w.centre[0], c.eye[2] - w.centre[1]));
  c.fov += (55 * Math.PI / 180 - c.fov) * (1 - Math.exp(-dt * 4));
}

function stepSaver(dt) {
  const p = app.saver.tick(dt);
  app.pose = p;
  app.cam.eye = p.eye; app.cam.yaw = p.yaw; app.cam.pitch = p.pitch; app.cam.fov = p.fov;
  if (p.snap) app.clock = app.world.counter();
  if (app.canvas) app.canvas.style.opacity = String(p.fade);
  return p;
}

// ---- overlays ----------------------------------------------------------------------
// Overlay margins in CSS px (the wave-membrane rule): an overlay counts when
// it spans half of an edge or more.
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  if (app.saver) return o;
  for (const el of [$('panel'), $('dock')]) {
    if (!el) continue;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  return o;
}

// ---- the frame ----------------------------------------------------------------------
let raf = 0, lastT = 0, stopped = false;
function frame(now) {
  raf = 0;
  if (stopped || !app.R || app.R.lost) return;
  const dt = Math.min(0.1, Math.max(0, (now - (lastT || now)) / 1000));
  lastT = now;
  app.frameMs = app.frameMs * 0.92 + dt * 1000 * 0.08;
  app.time += dt;
  try { tick(dt, now); } catch (e) { console.error(e); app.failed = e; status('The page stopped: ' + (e && e.message || e), true); return; }
  raf = requestAnimationFrame(frame);
}

function tick(dt, now) {
  const c = app.cam;
  let focus, radius = app.radius, fixedRate = null, boost = 1;
  if (app.saver) {
    const p = stepSaver(dt);
    focus = p.focus; radius = p.radius; fixedRate = p.rate; boost = p.boost;
  } else if (app.mode === 'walk') {
    stepWalk(dt); focus = focusAhead(c.eye, c.yaw, radius, 0.22);
  } else if (app.mode === 'watch') {
    stepWatch(dt); focus = [app.watch.centre[0], 0, app.watch.centre[1]];
    radius = Math.min(radius, 17);
    fixedRate = 9 * Math.pow(app.speed, 1.35);
  } else {
    stepFly(dt); focus = focusAhead(c.eye, c.yaw, radius, 0.3);
  }
  generate(focus, radius, boost);
  pumpMeshes(c.eye, PHONE() ? 4 : 8, PHONE() ? 4 : 6);
  forget(focus, now, radius);

  const target = app.world.counter();
  const cs = clockStep(app.clock, target, app.rate, dt, fixedRate);
  app.clock = cs.clock; app.rate = cs.rate;

  // view and projection
  const w = app.canvas.clientWidth || 1, h = app.canvas.clientHeight || 1;
  app.R.resize(w, h, window.devicePixelRatio || 1);
  app.R.govern(app.frameMs);
  const o = app.occ = occlusion(w, h);
  if (app.mode === 'walk' && !app.saver) {
    const x = Math.round(w / 2 + (o.l - o.r) / 2), y = Math.round(h / 2 + (o.t - o.b) / 2), ch = app.crossEl || (app.crossEl = document.querySelector('.crosshair'));
    if (ch && (ch._x !== x || ch._y !== y)) { ch._x = x; ch._y = y; ch.style.left = x + 'px'; ch.style.top = y + 'px'; }
  }
  const proj = M4.perspective(c.fov, w / h, 0.12);
  const ox = (o.l - o.r) / w, oy = app.saver ? (app.pose ? app.pose.oy : 0) : (o.b - o.t) / h;
  proj[8] -= ox; proj[9] -= oy;
  const view = M4.viewYawPitch(c.eye, c.yaw, c.pitch);
  const vp = M4.mul(proj, view);
  if (app.skyHour !== app.hour) { app.sky = skyState(app.hour); app.skyHour = app.hour; }
  const R = radius * CELL;
  // Watch shows the whole generation area, so its fog starts past the edge.
  const watching = app.saver ? (app.pose && app.pose.shot === 'watch') : app.mode === 'watch';
  const fwd = forward(c.yaw, 0);
  const sh = Math.min(140, Math.max(36, Math.min(R * 0.75, 30 + c.eye[1] * 1.6)));
  app.R.render({
    viewProj: vp, invViewProj: M4.invert(vp), eye: c.eye, sky: app.sky, time: app.time,
    clock: app.clock, span: Math.max(1, app.rate * app.anim), drop: 7,
    focus, fogStart: R * (watching ? 1.1 : 0.55), fogEnd: R * (watching ? 2.0 : 0.96), haze: 0.0018,
    shadowCentre: [c.eye[0] + fwd[0] * sh * 0.55, 0, c.eye[2] + fwd[2] * sh * 0.55], shadowHalf: sh,
    worldH: app.H * CELL,
  });
  if (hasDOM && (app.statT += dt) > 0.5) { app.statT = 0; showStats(); }
}

function showStats() {
  const s = app.world.stats(), el = $('statsLine');
  const f = v => Math.round(v).toLocaleString('en-US');
  if (el) el.textContent = `collapsed ${f(s[0])} · backtracks ${f(s[1])} · slots ${f(s[3])} · chunks ${f(s[4])} · ${app.genMs.toFixed(1)} ms · ${Math.round(1000 / Math.max(1, app.frameMs))} fps` + (app.R.scale < 1 ? ` · scale ${Math.round(app.R.scale * 100)}%` : '');
  const held = $('heldNote'); if (held) held.hidden = !(app.mode === 'walk' && app.held);
}

function hint() {
  const el = $('hint'); if (!el) return;
  const touch = COARSE();
  el.textContent = app.mode === 'walk'
    ? (touch ? 'Left stick moves · drag looks · ⤒ jumps · ✈ flies' : (document.pointerLockElement ? 'WASD move · Space jump · Shift run · F fly · Esc frees the mouse' : 'Click the view to look around · WASD move · Space jump · Shift run · F fly'))
    : app.mode === 'watch' ? 'Each slot falls in when the solver collapses it · drag to orbit · wheel zooms'
      : (touch ? 'Drag to look · the drone glides by itself' : 'Drag to look · W/S speed · A/D turn · Q/E or wheel height · 1 walk · 3 watch');
}

// ---- UI ----------------------------------------------------------------------------
function bindUI() {
  const segs = [$('modeSeg'), $('dockMode')];
  for (const seg of segs) seg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  const newCity = () => {
    resetWorld(((Math.random() * 2 ** 32) >>> 0) || 1);
    if (app.mode === 'watch') { app.watch.centre = [0, 0]; }
  };
  $('btnNew').addEventListener('click', newCity);
  $('dockNew').addEventListener('click', newCity);
  $('seedInput').addEventListener('change', () => {
    const v = parseInt($('seedInput').value, 10);
    if (Number.isFinite(v) && v > 0) resetWorld(v >>> 0);
  });
  const range = (id, key, fmt, after) => {
    const inp = $(id), out = $(id + 'V');
    const show = () => { app[key] = +inp.value; out.textContent = fmt(+inp.value); if (after) after(); };
    inp.value = String(app[key]);
    inp.addEventListener('input', show); show();
  };
  range('radius', 'radius', v => `${v} cells · ${v * CELL} m`);
  range('speed', 'speed', v => `${v} · ${speedBudget(v).budget} slots/call`);
  range('anim', 'anim', v => `${v.toFixed(1)} s`);
  range('hour', 'hour', v => { const hh = Math.floor(v), mm = Math.round((v - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; });

  const panel = $('panel'), dockPanel = $('dockPanel');
  const setOpen = open => {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open);
    dockPanel.setAttribute('aria-expanded', String(open));
    $('gear').setAttribute('aria-expanded', String(open));
  };
  app.setOpen = setOpen;
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  dockPanel.addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  const PQ = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
  setOpen(!PQ.matches);
  if (PQ.addEventListener) PQ.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip');
  let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}

function bindInput() {
  const cv = app.canvas;
  const typing = e => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range';
  window.addEventListener('keydown', e => {
    if (typing(e) || app.saver) return;
    if (e.metaKey || (e.ctrlKey && e.code !== 'ControlLeft')) return;
    app.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Digit1') setMode('walk');
    else if (e.code === 'Digit2') setMode('fly');
    else if (e.code === 'Digit3') setMode('watch');
    else if (e.code === 'KeyN') $('btnNew').click();
    else if (e.code === 'KeyH') app.setOpen(!$('panel').classList.contains('open'));
    else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      app.hour = ((app.hour + (e.code === 'BracketLeft' ? -0.5 : 0.5)) % 24 + 24) % 24;
      $('hour').value = String(app.hour); $('hour').dispatchEvent(new Event('input'));
    } else if (e.code === 'KeyF' && app.mode === 'walk') { app.flying = !app.flying; app.body[4] = 0; syncFly(); }
    else if (e.code === 'Space' && app.mode === 'walk') app.jumpQ = true;
    if (app.mode === 'walk' && /^(Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => app.keys.delete(e.code));
  window.addEventListener('blur', () => app.keys.clear());

  // mouse look with pointer lock (walk); drag look (fly, watch) and touch
  document.addEventListener('pointerlockchange', () => { document.body.classList.toggle('locked', document.pointerLockElement === cv); hint(); });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement !== cv) return;
    app.look[0] += e.movementX * 0.0022; app.look[1] += e.movementY * 0.0022;
  });
  const ptrs = new Map();
  let pinch = 0;
  cv.addEventListener('pointerdown', e => {
    if (app.saver) return;
    // Walk with a mouse asks for pointer lock. A drag still looks, for a
    // frame that refuses the lock (a sandboxed iframe): under the lock,
    // clientX does not change, so the drag adds nothing twice.
    if (app.mode === 'walk' && e.pointerType === 'mouse' && document.pointerLockElement !== cv) {
      try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (x) { /* no lock */ }
    }
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    try { cv.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    p[0] = e.clientX; p[1] = e.clientY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch > 0) zoom((pinch - d) * 0.25);
      pinch = d; return;
    }
    const k = e.pointerType === 'touch' ? 0.0042 : 0.0034;
    if (app.mode === 'watch') { app.look[0] -= dx * k; app.look[1] += dy * k; }
    else { app.look[0] += dx * k; app.look[1] += dy * k; }
  });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY * 0.02); }, { passive: false });

  // touch stick (walk)
  const stick = $('stick'), knob = $('stickKnob');
  let sid = null, s0 = [0, 0];
  stick.addEventListener('pointerdown', e => {
    sid = e.pointerId; const q = stick.getBoundingClientRect(); s0 = [q.left + q.width / 2, q.top + q.height / 2];
    try { stick.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
    moveStick(e);
  });
  const moveStick = e => {
    if (e.pointerId !== sid) return;
    const R = stick.clientWidth / 2 || 60;
    let x = (e.clientX - s0[0]) / R, y = (e.clientY - s0[1]) / R;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    app.stick = [x, y]; app.stickRun = l > 0.92;
    knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
  };
  stick.addEventListener('pointermove', moveStick);
  const endStick = e => { if (e.pointerId !== sid) return; sid = null; app.stick = [0, 0]; app.stickRun = false; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  const jump = $('btnJump');
  jump.addEventListener('pointerdown', e => { e.preventDefault(); app.jumpQ = true; app.upHeld = true; });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) jump.addEventListener(t, () => { app.upHeld = false; });
  $('btnFlyT').addEventListener('click', () => { app.flying = !app.flying; app.body[4] = 0; syncFly(); });
}

function syncFly() {
  const b = $('btnFlyT'); if (b) { b.classList.toggle('on', app.flying); b.setAttribute('aria-pressed', String(app.flying)); }
}

function zoom(d) {
  if (app.mode === 'watch') app.watch.dist = Math.max(25, Math.min(160, app.watch.dist + d * 2));
  else if (app.mode === 'fly') app.drone.alt = Math.max(6, Math.min(160, app.drone.alt + d * 1.5));
}

// ---- saver ------------------------------------------------------------------------------
function attachSaver(dir) {
  app.saver = dir; app.pose = null;
  if (document.pointerLockElement) document.exitPointerLock();
  // the saver seed sets the city too, so each run differs
  let s = 0; try { s = dir.debug().seed >>> 0; } catch (e) { s = 0; }
  resetWorld(s || app.seed);
}
function detachSaver() {
  app.saver = null; app.pose = null;
  if (app.canvas) app.canvas.style.opacity = '';
  setMode('fly');
}

// ---- boot ---------------------------------------------------------------------------------
async function boot() {
  app.canvas = $('view');
  bindUI();
  status('Loading the solver…');
  let W;
  try { W = await loadWorld(globalThis.__WFC_PKG_BASE__ || './'); } catch (e) { console.error(e); status('The solver could not start: ' + (e && e.message || e), true); app.failed = e; return; }
  app.mod = W.mod; app.mock = W.mock;
  $('mockBadge').hidden = !W.mock;
  if (W.mock) $('mockBadge').title = 'pkg/wfc_city.js is missing, so this is the JavaScript stand-in city, not the Rust solver.';
  status('Starting WebGPU…');
  try {
    app.R = await createRenderer(app.canvas, {
      phone: PHONE(),
      onLost: info => { if (!stopped) status('The GPU device was lost (' + (info && info.message || 'unknown') + '). Reload the page.', true); },
    });
  } catch (e) { console.error(e); status('WebGPU could not start: ' + (e && e.message || e) + '. This page needs a browser with WebGPU.', true); app.failed = e; return; }
  const q = new URLSearchParams(location.search);
  const seed = parseInt(q.get('seed') || '', 10);
  resetWorld(Number.isFinite(seed) && seed > 0 ? seed >>> 0 : (((Math.random() * 2 ** 32) >>> 0) || 1));
  try {
    const v = app.mod.version ? app.mod.version() : '';
    $('solverInfo').textContent = `${W.mock ? 'Mock world (JavaScript)' : 'Rust solver ' + v} · ${app.world.module_count()} modules`;
  } catch (e) { /* no version */ }
  // warm: the street under the start point first
  generate([0, 0, 0], 10, 4);
  app.cam.eye = [0, 34, 40]; app.cam.yaw = 0;
  bindInput();
  const m = q.get('mode');
  setMode(m === 'walk' || m === 'watch' ? m : 'fly');
  status('');
  const api = {
    get world() { return app.world; }, get mock() { return app.mock; }, get mode() { return app.mode; },
    get clock() { return app.clock; }, get renderer() { return app.R; }, get cam() { return app.cam; }, get body() { return app.body; },
    heightAt, stats: () => app.world.stats(), attachSaver, detachSaver, setMode, resetWorld,
    tick: dt => tick(dt, performance.now()), app,
  };
  window.__wfc.app = api;
  readyResolve(api);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !raf && !stopped) { lastT = 0; raf = requestAnimationFrame(frame); } });
  raf = requestAnimationFrame(frame);
}

function release() {
  if (stopped) return;
  stopped = true;
  if (raf) cancelAnimationFrame(raf);
  try { app.R && app.R.destroy(); } catch (e) { /* lost */ }
  try { app.world && app.world.free(); } catch (e) { /* freed */ }
  app.world = null;
}

if (hasDOM && !globalThis.__WFC_NO_BOOT__) {
  window.addEventListener('pagehide', release);
  boot().catch(e => { console.error(e); status('The page could not start: ' + (e && e.message || e), true); });
}
