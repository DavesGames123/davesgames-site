// ============================================================================
//  BIOME PARTS  ·  scene.js — the 3D view: tape, springs, overlay
// ----------------------------------------------------------------------------
//  One WebGPU pane (the SDF lab renderer, gpu.js) and one 2D overlay canvas.
//  The scene keeps the current tape and animates each new op in: a pad grows
//  from its sketch, a cut sinks into the part (part.js "appear"). The camera
//  is a set of critically damped springs (yaw, pitch, dist, target), so a new
//  framing, a saver shot or an exploded view eases in and never jumps.
//
//  MEMORY. One parameter Float32Array, one uniform Float32Array, one pane,
//  one compiled module for the life of the page; a step writes buffers only.
//  The frame loop runs while something moves and stops when it settles.
//
//  GREP MAP
//    createScene ........ boot the renderer; returns the scene API
//    setTape ............ new tape; new op ids animate in
//    frame / aim / shot . camera goals (fit, push-in, low, top, side, orbit)
//    setExplode ......... additive ops lift apart along +Z
//    drawOverlay ........ the sketch being edited, projected from its frame
//    pointer ............ drag to orbit, wheel or pinch to dolly
//    destroy ............ pagehide: release the device
// ============================================================================
import { createPartRenderer, packUniform, P_FLOATS, UNIFORM_FLOATS } from './gpu.js';
import { packTape, MM } from './part.js';
import { worldBounds, sceneSphere } from './view.js';
import { projection } from '../../sdf-lab/js/camera.js';

const spring = (x, w = 3.2) => ({ x, v: 0, g: x, w });
function stepSpring(s, dt) {
  const a = s.w * s.w * (s.g - s.x) - 2 * s.w * s.v;
  s.v += a * dt; s.x += s.v * dt;
  return Math.abs(s.g - s.x) > 1e-4 || Math.abs(s.v) > 1e-4;
}
const fcToWorld = p => [p[0] / MM, p[2] / MM, -p[1] / MM];

export async function createScene({ canvas, overlay, maxDpr = 2, onLost }) {
  const R = await createPartRenderer(onLost);
  const pane = R.addPane(canvas);
  const P = new Float32Array(P_FLOATS), U = new Float32Array(UNIFORM_FLOATS);
  const cam = { yaw: spring(38), pitch: spring(28), dist: spring(13), tx: spring(0), ty: spring(0.5), tz: spring(0), explode: spring(0, 2.4) };
  const S = {
    ops: [], born: new Map(), A: null, mode: 1, sel: [-9, -9], ghost: -1, sketch: null, spin: 0, lastUser: -1e9,
    scene: [0, 0.5, 0, 3], dirty: true, raf: 0, last: 0, scale: 1, slow: 0, fov: 34, destroyed: false, colour: null, time: 0,
  };
  const appearOf = (i, op) => { const b = S.born.get(op.id); return b == null ? 1 : Math.min(1, (S.time - b) / 0.55); };
  const explodeOf = (i, op) => {
    if (!(cam.explode.x > 1e-3) || i === 0) return 0;
    const k = S.ops.slice(0, i + 1).filter(o => o.type === 'add').length - 1;
    return k > 0 ? k * cam.explode.x : 0;
  };
  function pack() {
    packTape(S.ops, P, { appearOf, explodeOf, depthClamp: S.depth, colourOf: (i, op) => (S.colour ? S.colour(op, i) : i % 8), time: S.time });
    R.writeParams(P);
  }
  function camObj() {
    return { target: [cam.tx.x, cam.ty.x, cam.tz.x], yaw: cam.yaw.x, pitch: cam.pitch.x, dist: cam.dist.x, fov: S.fov };
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * S.scale;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (overlay) {
      const d2 = Math.min(window.devicePixelRatio || 1, 2);
      const ow = Math.round(overlay.clientWidth * d2), oh = Math.round(overlay.clientHeight * d2);
      if (overlay.width !== ow || overlay.height !== oh) { overlay.width = ow; overlay.height = oh; }
    }
  }
  function frame(now) {
    S.raf = 0;
    if (S.destroyed || document.hidden) return;
    const dt = Math.min(0.05, S.last ? (now - S.last) / 1000 : 0.016);
    S.last = now; S.time += dt;
    let moving = S.dirty;
    if (S.spin && now - S.lastUser > 3000) { cam.yaw.g += S.spin * dt; moving = true; }
    for (const s of Object.values(cam)) moving = stepSpring(s, dt) || moving;
    for (const b of S.born.values()) if (S.time - b < 0.6) moving = true;
    resize();
    pack();
    const c = camObj();
    packUniform(U, c, canvas.width, canvas.height, { mode: S.mode, sel: S.sel, ghost: S.ghost, scene: S.scene, grid: true, time: S.time, maxSteps: 150 });
    const t0 = performance.now();
    R.drawPanes([{ pane, u: U, kind: 'view' }]);
    drawOverlay(c);
    // adaptive resolution: a slow frame lowers the pane scale, idle restores it
    const ft = performance.now() - t0;
    S.slow = S.slow * 0.9 + (ft > 24 ? 1 : 0) * 0.1;
    if (S.slow > 0.5 && S.scale > 0.6) { S.scale = Math.max(0.6, S.scale - 0.1); S.slow = 0; }
    S.dirty = false;
    if (moving) S.raf = requestAnimationFrame(frame);
    else if (S.scale < 1) { S.scale = 1; S.dirty = true; S.raf = requestAnimationFrame(frame); }
  }
  const kick = () => { S.dirty = true; if (!S.raf && !S.destroyed) S.raf = requestAnimationFrame(frame); };

  function drawOverlay(c) {
    if (!overlay) return;
    const g = overlay.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, overlay.width, overlay.height);
    const sk = S.sketch;
    if (!sk) return;
    const k = overlay.width / overlay.clientWidth;
    const Pj = projection(c, overlay.clientWidth, overlay.clientHeight, false);
    const F = sk.frame;
    const at = (u, v) => fcToWorld([0, 1, 2].map(i => F.o[i] + F.u[i] * u + F.v[i] * v));
    const pr = (u, v) => { const q = Pj.project(at(u, v)); return q ? [q[0] * k, q[1] * k] : null; };
    g.lineWidth = 1.6 * k; g.lineCap = 'round';
    for (const geo of sk.geos) {
      g.strokeStyle = geo.construction ? 'rgba(156,195,255,0.55)' : '#9cc3ff';
      g.setLineDash(geo.construction ? [4 * k, 4 * k] : []);
      g.beginPath();
      if (geo.kind === 'line') { const a = pr(...geo.p1), b = pr(...geo.p2); if (a && b) { g.moveTo(...a); g.lineTo(...b); } }
      else if (geo.kind === 'circle') { for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2, q = pr(geo.c[0] + geo.r * Math.cos(t), geo.c[1] + geo.r * Math.sin(t)); if (q) (i ? g.lineTo(...q) : g.moveTo(...q)); } }
      else if (geo.kind === 'point') { const q = pr(...geo.p); if (q) { g.moveTo(q[0] + 3 * k, q[1]); g.arc(q[0], q[1], 3 * k, 0, Math.PI * 2); } }
      g.stroke();
    }
    g.setLineDash([]);
  }

  // ── pointer: drag to orbit, wheel / pinch to dolly ──────────────────────
  const pts = new Map();
  let pinch0 = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); S.lastUser = performance.now(); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    S.lastUser = performance.now();
    if (pts.size === 1) {
      cam.yaw.g -= dx * 0.4; cam.yaw.x -= dx * 0.4;
      cam.pitch.g = Math.max(-10, Math.min(85, cam.pitch.g + dy * 0.3)); cam.pitch.x = cam.pitch.g;
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) { cam.dist.g = Math.max(1.5, Math.min(80, cam.dist.g * pinch0 / d)); }
      pinch0 = d;
    }
    kick();
  });
  const up = e => { pts.delete(e.pointerId); pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); S.lastUser = performance.now(); cam.dist.g = Math.max(1.5, Math.min(80, cam.dist.g * Math.exp(e.deltaY * 0.0012))); kick(); }, { passive: false });
  new ResizeObserver(kick).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  const api = {
    renderer: R,
    get time() { return S.time; },
    setTape(ops, bbox, opts = {}) {
      const seen = new Set(S.ops.map(o => o.id));
      for (const op of ops) if (!seen.has(op.id) && !S.born.has(op.id)) S.born.set(op.id, opts.instant ? -9 : S.time);
      const keep = new Set(ops.map(o => o.id));
      for (const id of [...S.born.keys()]) if (!keep.has(id)) S.born.delete(id);
      S.ops = ops;
      if (bbox) {
        const ext = Math.max(...[0, 1, 2].map(i => bbox[1][i] - bbox[0][i]));
        S.depth = ext + 4;
      }
      kick();
    },
    newestOp() { return S.ops.length ? S.ops[S.ops.length - 1] : null; },
    // frame the part box (FC bbox); o: { yaw, pitch, fill, aspect, offsetY }
    frame(bbox, o = {}) {
      const b = bbox ? worldBounds({ bbox, empty: false }) : { lo: [-2, 0, -2], hi: [2, 1, 2] };
      S.scene = sceneSphere(b, 0.6);
      const ctr = [0, 1, 2].map(i => (b.lo[i] + b.hi[i]) / 2);
      const r = Math.max(0.6, Math.hypot(...[0, 1, 2].map(i => b.hi[i] - b.lo[i])) / 2);
      const half = S.fov * Math.PI / 360, asp = o.aspect ?? (canvas.clientWidth / Math.max(1, canvas.clientHeight));
      const hh = Math.atan(Math.tan(half) * Math.min(1, asp));
      cam.tx.g = ctr[0]; cam.ty.g = ctr[1] + (o.offsetY || 0) * r; cam.tz.g = ctr[2];
      cam.dist.g = r * (o.fill ?? 1.35) / Math.sin(hh);
      if (o.yaw != null) cam.yaw.g = o.yaw;
      if (o.pitch != null) cam.pitch.g = o.pitch;
      kick();
    },
    // push the camera toward a world point
    aimAt(p, distScale = 0.55) { cam.tx.g = p[0]; cam.ty.g = p[1]; cam.tz.g = p[2]; cam.dist.g *= distScale; kick(); },
    // move the aim up by a fraction of the view height (plate clear band)
    shiftTarget(frac) { cam.ty.g += frac * 2 * cam.dist.g * Math.tan(S.fov * Math.PI / 360); kick(); },
    setYaw(y) { cam.yaw.g = y; kick(); }, get yaw() { return cam.yaw.g; },
    setSpin(degPerSec) { S.spin = degPerSec; kick(); },
    setExplode(mm) { cam.explode.g = mm; kick(); },
    setMode(m) { S.mode = m; kick(); },
    setHighlight(id) { S.sel = id == null ? [-9, -9] : [id, id]; kick(); },
    setGhost(i) { S.ghost = i; kick(); },
    setSketch(sk) { S.sketch = sk; kick(); },
    setColour(fn) { S.colour = fn; kick(); },
    setFov(f) { S.fov = f; kick(); },
    fcToWorld,
    canvas,
    kick,
    destroy() { if (S.destroyed) return; S.destroyed = true; cancelAnimationFrame(S.raf); try { R.destroy(); } catch (e) { /* gone */ } },
  };
  kick();
  return api;
}
