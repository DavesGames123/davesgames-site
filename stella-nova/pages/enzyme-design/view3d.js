// ============================================================================
//  VIEW3D  ·  the enzyme view on a 2D canvas (no WebGL, no GPU context)
// ----------------------------------------------------------------------------
//  This module draws a design (see design.js) with a perspective camera and
//  depth-sorted primitives. It makes no GPU context, so the page holds
//  nothing for the shell to release. Safari cannot lose a context it never
//  got.
//
//  WHAT IT DRAWS, in one pass, sorted by depth:
//    1. A smooth tube through the C-alpha trace. The tube is a Catmull-Rom
//       spline, not the raw segments, so a 140-residue chain reads as a
//       fold. The spline goes out as short polylines, not as one primitive
//       per sample: a polyline takes one outline stroke, so the tube has no
//       dark band at every sample. Colour comes from the secondary
//       structure, the residue index or a value per residue.
//    2. A ring on each motif residue, and a thicker ring on the selected
//       residue.
//    3. Side-chain sticks for the motif residues. Atoms closer than 1.95 A
//       get a stick. The sticks use element colours.
//    4. The ligand as ball and stick, with element colours. The module uses
//       ligand.bonds if the ligand has them, or distance if it does not.
//    5. An optional translucent pocket shell around the ligand.
//    6. A noise cloud. scene.noise runs 0 to 1. At 1 the view shows loose
//       balls and a faint thread, which is a design in the middle of
//       reverse diffusion. At 0 the view shows the solid tube.
//
//  THE SCENE. draw(scene, opts) takes:
//    scene.design    a Design, or any object with n, ca and the rest
//    scene.motif     a Motif (motif.js) for the side-chain sticks
//    scene.ligand    a ligand; the default is design.ligand
//    scene.colorBy   'ss' | 'index' | 'value' | 'uniform'   (default 'ss')
//    scene.values    Float32Array n, for colorBy 'value'
//    scene.highlight array of residue indices; the default is design.fixed
//    scene.selected  one residue index to mark, or null
//    scene.pocket    true, or { x, y, z, radius }, or null
//    scene.noise     0 to 1
//    scene.seed      seed of the cloud offsets (rng from design.js)
//    scene.trace     false hides the tube
//  opts.fit  true re-aims the camera at this scene.
//  opts.camera  { yaw, pitch, radius, center } sets the camera. A small
//  radius with the ligand centre gives a close view of the active site.
//  A scene field wins over the same field of the last scene.
//
//  INPUT. A drag turns the model. The canvas gets touch-action: pan-y, so a
//  vertical swipe still scrolls the page on a phone. A tap with no drag
//  calls opts.onPick(id, info). id is the residue index, or null. info is
//  { kind: 'residue' | 'ligand', index, atom }.
//
//  COST. The view holds one pool of primitive objects and reuses them, so a
//  frame allocates almost nothing. Spline steps per residue fall as the
//  chain grows, and the noise mode drops to one step. A 140-residue frame
//  costs about 2 ms on a laptop.
//
//  EXPORTS   (grep -n "<anchor>" view3d.js)
//    factory .......... "export function createView"
//    structure colour . "export const SS_COLOR"
//    element colour ... "export const ELEMENT_COLOR"
//    bounds helper .... "export function sceneBounds"
//  INTERNALS
//    camera ........... "project(x"
//    pool ............. "emit() {"
//    tube ............. "buildTube("
//    rings ............ "buildRings("
//    sticks ........... "buildSticks("
//    ligand ........... "buildLigand("
//    cloud ............ "buildCloud("
//    shell ............ "buildShell("
//    paint ............ "paint() {"
//    input ............ "pointerdown"
// ============================================================================
import { rng } from './design.js';

const BG = [10, 12, 19];

// Secondary structure colours: helix warm, strand cold, loop grey.
export const SS_COLOR = { H: [246, 150, 78], E: [92, 176, 255], L: [126, 136, 158] };

// Element colours, tuned for a dark page.
export const ELEMENT_COLOR = {
  C: [168, 178, 200], N: [96, 148, 255], O: [255, 94, 100], S: [238, 198, 78],
  H: [226, 232, 242], P: [255, 158, 64], FE: [236, 124, 56], MG: [104, 214, 160],
  ZN: [176, 180, 216], CL: [118, 218, 118], F: [150, 232, 186], BR: [196, 118, 80],
};
const EL_OTHER = [198, 158, 222];
const COOL = [96, 132, 210];            // the colour of noise
const RING = [255, 255, 255];
const SHELL = [104, 200, 220];

// The ramp for colorBy 'index' and 'value': blue to red through green.
const RAMP = [[60, 88, 198], [48, 172, 214], [96, 208, 140], [234, 206, 84], [242, 116, 82]];

const WIDTH = { H: 0.95, E: 0.80, L: 0.62 };
// Ball and stick, in angstroms. A carbon-carbon bond is 1.4 A, so a ball
// wider than about 0.8 A hides the stick and two bonded balls merge. The
// motif view of section 02 looks at one ring from close up, where that
// shows at once.
const STICK_W = 0.30, LIG_W = 0.34;
const LIG_R = 0.38, LIG_H_R = 0.22, SIDE_R = 0.26, TIP_R = 0.34;
// Spline samples per polyline run. One outline stroke covers a whole run.
const RUN = 8;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function elementColor(el) {
  if (!el) return EL_OTHER;
  return ELEMENT_COLOR[String(el).toUpperCase()] || EL_OTHER;
}

// Write the ramp colour of t (0 to 1) into out.
function rampInto(out, t) {
  const u = Math.max(0, Math.min(0.9999, t)) * (RAMP.length - 1);
  const i = u | 0, f = u - i, a = RAMP[i], b = RAMP[i + 1] || a;
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
}

function mixInto(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function ligandOf(scene, d) {
  return scene.ligand !== undefined ? scene.ligand : (d && d.ligand) || null;
}

// The centre and the radius that hold a scene. The radius comes from a high
// percentile of the distances, so one far point cannot shrink the model.
export function sceneBounds(scene) {
  const d = (scene && scene.design) || scene || {};
  const n = d.n | 0, ca = d.ca;
  const pts = [];
  if (ca && n > 0) for (let i = 0; i < n; i++) pts.push([ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2]]);
  const lig = ligandOf(scene || {}, d);
  if (lig && lig.atoms) for (const a of lig.atoms) pts.push([a.x, a.y, a.z]);
  if (!pts.length) return { center: [0, 0, 0], radius: 24 };
  const c = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length;
  const ds = pts.map(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((a, b) => a - b);
  const p90 = ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.90))];
  return { center: c, radius: Math.max(12, p90 * 1.32) };
}

class View {
  constructor(cv, opt = {}) {
    const g = cv && cv.getContext && cv.getContext('2d');
    if (!g) throw new Error('view3d needs a canvas with a 2D context');
    this.cv = cv; this.g = g;
    this.yaw = opt.yaw ?? 0.6;
    this.pitch = opt.pitch ?? -0.22;
    this.radius = opt.radius ?? 26;
    this.center = [0, 0, 0];
    this.spinRate = typeof opt.spin === 'number' ? opt.spin : 0.12;
    this.spinOn = opt.spin !== 0 && opt.spin !== false;
    this.idleDelay = opt.idleDelay ?? 1.0;
    this.fog = opt.fog ?? 0.6;
    this.quality = opt.quality ?? 1;
    this.onPick = opt.onPick || null;
    this.scene = null;
    this.fitKey = null;
    this.pool = []; this.np = 0; this.list = [];
    this.A = [0, 0, 0, 0]; this.B = [0, 0, 0, 0];
    this.pickXY = new Float32Array(0); this.pickN = 0;
    this.ligXY = new Float32Array(0); this.ligAtoms = null;
    this.haze = new Float32Array(0); this.hazeSeed = null;
    this.held = false; this.idle = 0; this.dirty = true; this.dead = false;
    this.frames = 0; this.lastMs = 0; this.frameMs = 0;
    this.tLast = nowMs(); this.tExternal = -1e9;
    this.listeners = [];
    cv.style.touchAction = 'pan-y';
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { this.resize(); this.dirty = true; });
      this.ro.observe(cv);
    }
    this.bindInput();
    this.loop = () => {
      if (this.dead) return;
      this.raf = requestAnimationFrame(this.loop);
      if (!this.scene) return;
      if (nowMs() - this.tExternal < 220) return;   // the page drives the frames
      if (!this.spinOn && !this.dirty) return;
      this.render();
    };
    this.raf = requestAnimationFrame(this.loop);
  }

  on(target, type, fn, opt) { target.addEventListener(type, fn, opt); this.listeners.push([target, type, fn]); }

  bindInput() {
    const cv = this.cv;
    let sx = 0, sy = 0, lastX = 0, lastY = 0, moved = false, pid = null;
    this.on(cv, 'pointerdown', e => {
      pid = e.pointerId; sx = lastX = e.clientX; sy = lastY = e.clientY;
      moved = false; this.held = true; this.idle = 0;
    });
    this.on(cv, 'pointermove', e => {
      if (e.pointerId !== pid) return;
      if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 6) {
        moved = true;
        try { cv.setPointerCapture(pid); } catch (_) {}
      }
      if (!moved) return;
      this.yaw += (e.clientX - lastX) * 0.012;
      // A touch keeps the vertical axis for the page scroll.
      if (e.pointerType !== 'touch') {
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + (e.clientY - lastY) * 0.009));
      }
      lastX = e.clientX; lastY = e.clientY;
      this.dirty = true; this.idle = 0;
    });
    const end = e => {
      if (e.pointerId !== pid) return;
      if (!moved && e.type === 'pointerup' && this.onPick) this.pickAt(e.clientX, e.clientY);
      pid = null; this.held = false; this.idle = 0;
    };
    this.on(cv, 'pointerup', end);
    this.on(cv, 'pointercancel', end);
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    this.w = Math.max(1, r.width || this.cv.width || 1);
    this.h = Math.max(1, r.height || this.cv.height || 1);
    this.dpr = dpr;
    this.cv.width = Math.round(this.w * dpr);
    this.cv.height = Math.round(this.h * dpr);
  }

  // ---- camera -------------------------------------------------------------
  beginFrame() {
    this.cy = Math.cos(this.yaw); this.sy = Math.sin(this.yaw);
    this.cp = Math.cos(this.pitch); this.sp = Math.sin(this.pitch);
    this.scale = Math.min(this.w, this.h) / (2.25 * this.radius);
    this.D = this.radius * 4.2;
    this.np = 0;
  }

  // World (A) to screen. Writes [x, y, depth, scale] into out.
  project(x, y, z, out) {
    x -= this.center[0]; y -= this.center[1]; z -= this.center[2];
    const x1 = this.cy * x + this.sy * z, z1 = -this.sy * x + this.cy * z;
    const y2 = this.cp * y - this.sp * z1, z2 = this.sp * y + this.cp * z1;
    const f = this.D / Math.max(1e-3, this.D - z2), s = this.scale * f;
    out[0] = this.w / 2 + x1 * s;
    out[1] = this.h / 2 - y2 * s;
    out[2] = z2; out[3] = s;
    return out;
  }

  // ---- primitive pool -----------------------------------------------------
  emit() {
    let q = this.pool[this.np];
    if (!q) {
      q = { k: 0, x: 0, y: 0, z: 0, s: 1, r: 1, w: 1, a: 1, c: null, cc: [0, 0, 0], pa: [0, 0, 0, 0], pb: [0, 0, 0, 0], pts: null, pn: 0 };
      this.pool[this.np] = q;
    }
    this.np++; q.a = 1; q.c = q.cc;
    return q;
  }

  seg(ax, ay, az, bx, by, bz, col, w, a) {
    const q = this.emit(), A = this.project(ax, ay, az, q.pa), B = this.project(bx, by, bz, q.pb);
    q.k = 0; q.z = (A[2] + B[2]) / 2; q.w = w; q.a = a;
    q.cc[0] = col[0]; q.cc[1] = col[1]; q.cc[2] = col[2];
    return q;
  }

  dot(x, y, z, col, r, a) {
    const q = this.emit(), A = this.project(x, y, z, q.pa);
    q.k = 1; q.x = A[0]; q.y = A[1]; q.z = A[2]; q.s = A[3]; q.r = r; q.a = a;
    q.cc[0] = col[0]; q.cc[1] = col[1]; q.cc[2] = col[2];
    return q;
  }

  ring(x, y, z, col, r, w, a) {
    const q = this.dot(x, y, z, col, r, a);
    q.k = 2; q.w = w;
    return q;
  }

  shell(x, y, z, col, r, a) {
    const q = this.dot(x, y, z, col, r, a);
    q.k = 3;
    return q;
  }

  // A polyline of up to RUN + 1 projected points. The caller writes the
  // points with pathPoint, then closes the run with pathEnd.
  pathStart(col, w, a) {
    const q = this.emit();
    q.k = 4; q.w = w; q.a = a; q.pn = 0; q.z = 0; q.s = 0;
    if (!q.pts) q.pts = new Float32Array((RUN + 4) * 2);
    q.cc[0] = col[0]; q.cc[1] = col[1]; q.cc[2] = col[2];
    return q;
  }

  pathPoint(q, x, y, z) {
    const A = this.project(x, y, z, this.A);
    if (q.pn * 2 + 1 >= q.pts.length) return;
    q.pts[q.pn * 2] = A[0]; q.pts[q.pn * 2 + 1] = A[1];
    q.z += A[2]; q.s += A[3]; q.pn++;
  }

  pathEnd(q) {
    if (q.pn < 2) { this.np--; return; }
    q.z /= q.pn; q.s /= q.pn;
  }

  // ---- scene --------------------------------------------------------------
  setScene(scene, opts = {}) {
    const next = Object.assign({}, this.scene || {}, scene || {});
    this.scene = next;
    const d = next.design || next;
    const key = `${d && d.n}|${(ligandOf(next, d) || { atoms: [] }).atoms.length}`;
    if (opts.fit === true || (opts.fit !== false && key !== this.fitKey)) {
      const b = sceneBounds(next);
      this.center = b.center;
      this.radius = next.radius || b.radius;
      this.fitKey = key;
    }
    if (opts.camera) {
      if (typeof opts.camera.yaw === 'number') this.yaw = opts.camera.yaw;
      if (typeof opts.camera.pitch === 'number') this.pitch = opts.camera.pitch;
      if (typeof opts.camera.radius === 'number') this.radius = opts.camera.radius;
      if (opts.camera.center) this.center = Array.from(opts.camera.center);
    }
  }

  // Spline steps per residue. Long chains and the noise mode get fewer.
  stepsFor(n, noise) {
    if (noise > 0.35) return 1;
    const q = this.quality;
    if (n > 220) return Math.max(1, Math.round(2 * q));
    if (n > 150) return Math.max(1, Math.round(3 * q));
    return Math.max(1, Math.round(4 * q));
  }

  // Colour of residue i, written into out.
  colorOf(out, d, i, mode, values) {
    if (mode === 'index') { rampInto(out, d.n > 1 ? i / (d.n - 1) : 0); return out; }
    if (mode === 'value') { rampInto(out, values ? values[i] : 0.5); return out; }
    if (mode === 'uniform') { const c = SS_COLOR.L; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out; }
    const c = SS_COLOR[(d.ss && d.ss[i]) || 'L'] || SS_COLOR.L;
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return out;
  }

  // A tube through the C-alpha trace, by Catmull-Rom between the points.
  buildTube(d, sc, noise) {
    const n = d.n | 0, ca = d.ca;
    if (!ca || n < 2) return;
    const mode = sc.colorBy || 'ss', values = sc.values;
    const steps = this.stepsFor(n, noise);
    const alpha = noise > 0.85 ? 0.18 : 1 - 0.8 * noise;
    const at = (i, k) => ca[Math.max(0, Math.min(n - 1, i)) * 3 + k];
    const col = [0, 0, 0];
    const total = (n - 1) * steps;
    let q = null, left = 0;
    this.qx = this.px = ca[0]; this.qy = this.py = ca[1]; this.qz = this.pz = ca[2];
    for (let g = 0; g <= total; g++) {
      const i = Math.min(n - 2, (g / steps) | 0), t = g / steps - i;
      const t2 = t * t, t3 = t2 * t;
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        const p0 = at(i - 1, k), p1 = at(i, k), p2 = at(i + 1, k), p3 = at(i + 2, k);
        const v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
        if (k === 0) x = v; else if (k === 1) y = v; else z = v;
      }
      if (left === 0) {
        // Start a run. Its colour and width come from its middle residue.
        const mid = Math.min(n - 1, Math.round((g + RUN / 2) / steps));
        this.colorOf(col, d, mid, mode, values);
        if (noise > 0.02) mixInto(col, col, COOL, noise * 0.75);
        const w = (WIDTH[(d.ss && d.ss[mid]) || 'L'] || WIDTH.L) * (1 - 0.45 * noise);
        const prev = q;
        q = this.pathStart(col, w, alpha);
        // Two points of overlap: the outline of this run covers the seam.
        if (prev) {
          this.pathPoint(q, this.qx, this.qy, this.qz);
          this.pathPoint(q, this.px, this.py, this.pz);
        }
        left = RUN;
      }
      this.pathPoint(q, x, y, z);
      this.qx = this.px; this.qy = this.py; this.qz = this.pz;
      this.px = x; this.py = y; this.pz = z;
      left--;
      if (left === 0 || g === total) { this.pathEnd(q); if (g === total) q = null; }
    }
    if (q && q.pn) this.pathEnd(q);
    // A flat cap leaves a square end, so a dot closes each chain terminus.
    for (const i of [0, n - 1]) {
      const w = (WIDTH[(d.ss && d.ss[i]) || 'L'] || WIDTH.L) * (1 - 0.45 * noise);
      this.colorOf(col, d, i, mode, values);
      this.dot(ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2], col, w / 2, alpha);
    }
  }

  // Rings on the motif residues and on the selected residue.
  buildRings(d, sc) {
    const n = d.n | 0, ca = d.ca;
    if (!ca) return;
    const marks = sc.highlight && sc.highlight.length ? sc.highlight
      : (d.fixed ? Array.from({ length: n }, (_, i) => i).filter(i => d.fixed[i]) : []);
    for (const i of marks) {
      if (!(i >= 0 && i < n)) continue;
      this.ring(ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2], RING, 1.35, 0.22, 0.75);
    }
    const sel = sc.selected;
    if (typeof sel === 'number' && sel >= 0 && sel < n) {
      this.ring(ca[sel * 3], ca[sel * 3 + 1], ca[sel * 3 + 2], RING, 1.9, 0.3, 1);
      this.dot(ca[sel * 3], ca[sel * 3 + 1], ca[sel * 3 + 2], RING, 0.55, 1);
    }
  }

  // Side-chain sticks for the motif residues. A pair of atoms under 1.95 A
  // gets a stick. The first atom also joins the C-beta of its residue.
  buildSticks(d, sc, noise) {
    const m = sc.motif;
    if (!m || !m.residues || !m.residues.length) return;
    const alpha = 1 - 0.9 * noise;
    if (alpha < 0.08) return;
    const n = d.n | 0;
    const home = new Map();
    if (d.motifId) for (let i = 0; i < n; i++) if (d.motifId[i] >= 0) home.set(d.motifId[i], i);
    for (const [ri, res] of m.residues.entries()) {
      const atoms = res.atoms || [];
      for (let a = 0; a < atoms.length; a++) {
        const A = atoms[a];
        for (let b = a + 1; b < atoms.length; b++) {
          const B = atoms[b];
          const r = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
          if (r > 0.6 && r < 1.95) {
            const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, mz = (A.z + B.z) / 2;
            this.seg(A.x, A.y, A.z, mx, my, mz, elementColor(A.el), STICK_W, alpha);
            this.seg(B.x, B.y, B.z, mx, my, mz, elementColor(B.el), STICK_W, alpha);
          }
        }
        const tip = res.tip && res.tip.indexOf(A.name) >= 0;
        this.dot(A.x, A.y, A.z, elementColor(A.el), tip ? TIP_R : SIDE_R, alpha);
      }
      // Join the side chain to the chain, if the design holds this residue.
      const i = home.has(ri) ? home.get(ri) : -1;
      if (i < 0 || !d.cb || !atoms.length) continue;
      const bx = d.cb[i * 3], by = d.cb[i * 3 + 1], bz = d.cb[i * 3 + 2];
      let best = null, bd = 3.2;
      for (const A of atoms) {
        const r = Math.hypot(A.x - bx, A.y - by, A.z - bz);
        if (r < bd) { bd = r; best = A; }
      }
      this.seg(d.ca[i * 3], d.ca[i * 3 + 1], d.ca[i * 3 + 2], bx, by, bz, ELEMENT_COLOR.C, STICK_W, alpha);
      if (best) this.seg(bx, by, bz, best.x, best.y, best.z, elementColor(best.el), STICK_W, alpha);
    }
  }

  // The ligand as ball and stick. bonds wins over distance.
  buildLigand(d, sc) {
    const lig = ligandOf(sc, d);
    if (!lig || !lig.atoms || !lig.atoms.length) return;
    const atoms = lig.atoms;
    if (Array.isArray(lig.bonds) && lig.bonds.length) {
      for (const [i, j] of lig.bonds) {
        const A = atoms[i], B = atoms[j];
        if (!A || !B) continue;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, mz = (A.z + B.z) / 2;
        this.seg(A.x, A.y, A.z, mx, my, mz, elementColor(A.el), LIG_W, 1);
        this.seg(B.x, B.y, B.z, mx, my, mz, elementColor(B.el), LIG_W, 1);
      }
    } else {
      for (let a = 0; a < atoms.length; a++) for (let b = a + 1; b < atoms.length; b++) {
        const A = atoms[a], B = atoms[b];
        const r = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
        if (r > 0.6 && r < 1.95) {
          const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, mz = (A.z + B.z) / 2;
          this.seg(A.x, A.y, A.z, mx, my, mz, elementColor(A.el), LIG_W, 1);
          this.seg(B.x, B.y, B.z, mx, my, mz, elementColor(B.el), LIG_W, 1);
        }
      }
    }
    const xy = this.ligXY.length === atoms.length * 2 ? this.ligXY : (this.ligXY = new Float32Array(atoms.length * 2));
    for (const [i, A] of atoms.entries()) {
      const q = this.dot(A.x, A.y, A.z, elementColor(A.el), A.el === 'H' ? LIG_H_R : LIG_R, 1);
      xy[i * 2] = q.x; xy[i * 2 + 1] = q.y;
    }
    this.ligAtoms = atoms;
  }

  // The cloud of a design in the middle of reverse diffusion.
  buildCloud(d, sc, noise) {
    const n = d.n | 0, ca = d.ca;
    if (!ca || noise <= 0.02) return;
    const mode = sc.colorBy || 'ss', values = sc.values;
    const seed = (sc.seed | 0) || 1;
    if (this.hazeSeed !== seed || this.haze.length !== n * 3) {
      const r = rng(seed), h = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        // One direction per residue, even on the sphere.
        const u = r() * 2 - 1, phi = r() * 6.283185, s = Math.sqrt(Math.max(0, 1 - u * u));
        h[i * 3] = s * Math.cos(phi); h[i * 3 + 1] = s * Math.sin(phi); h[i * 3 + 2] = u;
      }
      this.haze = h; this.hazeSeed = seed;
    }
    const c = [0, 0, 0], col = [0, 0, 0];
    const reach = 2.6 * noise;
    for (let i = 0; i < n; i++) {
      this.colorOf(c, d, i, mode, values);
      mixInto(col, c, COOL, noise * 0.8);
      this.dot(ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2], col, 0.45 + 0.95 * noise, 0.82 - 0.34 * noise);
      if (reach > 0.4) {
        this.dot(ca[i * 3] + this.haze[i * 3] * reach, ca[i * 3 + 1] + this.haze[i * 3 + 1] * reach,
          ca[i * 3 + 2] + this.haze[i * 3 + 2] * reach, COOL, 0.3 + 0.35 * noise, 0.16 * noise);
      }
    }
  }

  // A translucent shell around the pocket, so the reader sees the cavity.
  buildShell(d, sc) {
    const p = sc.pocket;
    if (!p) return;
    let x = 0, y = 0, z = 0, r = 0;
    if (p === true) {
      const lig = ligandOf(sc, d);
      if (!lig || !lig.atoms || !lig.atoms.length) return;
      for (const a of lig.atoms) { x += a.x; y += a.y; z += a.z; }
      x /= lig.atoms.length; y /= lig.atoms.length; z /= lig.atoms.length;
      for (const a of lig.atoms) r = Math.max(r, Math.hypot(a.x - x, a.y - y, a.z - z));
      r += 4.2;
    } else {
      x = p.x || 0; y = p.y || 0; z = p.z || 0; r = p.radius || 6;
    }
    this.shell(x, y, z, p.color || SHELL, r, 1);
  }

  build() {
    const sc = this.scene;
    if (!sc) return;
    const d = sc.design || sc;
    if (!d || !(d.n > 0)) return;
    const noise = Math.max(0, Math.min(1, sc.noise || 0));
    this.buildShell(d, sc);
    if (sc.trace !== false) this.buildTube(d, sc, noise);
    this.buildCloud(d, sc, noise);
    this.buildSticks(d, sc, noise);
    this.buildLigand(d, sc);
    this.buildRings(d, sc);
    // The pick table, kept apart from the draw list.
    const n = d.n | 0, ca = d.ca;
    if (!ca || ca.length < n * 3) { this.pickN = 0; return; }
    const xy = this.pickXY.length === n * 2 ? this.pickXY : (this.pickXY = new Float32Array(n * 2));
    const out = this.A;
    for (let i = 0; i < n; i++) {
      this.project(ca[i * 3], ca[i * 3 + 1], ca[i * 3 + 2], out);
      xy[i * 2] = out[0]; xy[i * 2 + 1] = out[1];
    }
    this.pickN = n;
  }

  // ---- paint --------------------------------------------------------------
  shade(c, z, k) {
    const f = Math.max(0, Math.min(1, 0.5 - z / (2.4 * this.radius))) * this.fog;
    const r = (c[0] * (1 - f) + BG[0] * f) * k, g = (c[1] * (1 - f) + BG[1] * f) * k, b = (c[2] * (1 - f) + BG[2] * f) * k;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  paint() {
    const g = this.g, list = this.list;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    let alpha = 1, cap = 'round';
    g.globalAlpha = 1;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q.a !== alpha) { alpha = q.a; g.globalAlpha = alpha; }
      const want = q.k === 4 ? 'butt' : 'round';
      if (want !== cap) { cap = want; g.lineCap = cap; }
      if (q.k === 0) {
        const s = (q.pa[3] + q.pb[3]) / 2, lw = Math.max(0.5, q.w * s);
        if (alpha > 0.96 && lw > 1.6) {
          g.strokeStyle = this.shade(q.c, q.z, 0.4); g.lineWidth = lw + 1.6;
          g.beginPath(); g.moveTo(q.pa[0], q.pa[1]); g.lineTo(q.pb[0], q.pb[1]); g.stroke();
          g.strokeStyle = this.shade(q.c, q.z, 1); g.lineWidth = lw; g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = lw * 0.26;
          const o = lw * 0.2;
          g.beginPath(); g.moveTo(q.pa[0] - o, q.pa[1] - o); g.lineTo(q.pb[0] - o, q.pb[1] - o); g.stroke();
        } else {
          g.strokeStyle = this.shade(q.c, q.z, 1); g.lineWidth = lw;
          g.beginPath(); g.moveTo(q.pa[0], q.pa[1]); g.lineTo(q.pb[0], q.pb[1]); g.stroke();
        }
      } else if (q.k === 1) {
        const r = Math.max(0.6, q.r * q.s);
        g.fillStyle = this.shade(q.c, q.z, 1);
        g.beginPath(); g.arc(q.x, q.y, r, 0, 6.2832); g.fill();
        if (r > 2.4) {
          g.fillStyle = 'rgba(255,255,255,0.2)';
          g.beginPath(); g.arc(q.x - r * 0.3, q.y - r * 0.3, r * 0.36, 0, 6.2832); g.fill();
        }
      } else if (q.k === 2) {
        const r = Math.max(1.4, q.r * q.s);
        g.strokeStyle = this.shade(q.c, q.z, 1); g.lineWidth = Math.max(0.8, q.w * q.s);
        g.beginPath(); g.arc(q.x, q.y, r, 0, 6.2832); g.stroke();
      } else if (q.k === 4) {
        const pts = q.pts, m = q.pn, lw = Math.max(0.5, q.w * q.s);
        g.beginPath(); g.moveTo(pts[0], pts[1]);
        for (let p = 1; p < m; p++) g.lineTo(pts[p * 2], pts[p * 2 + 1]);
        if (alpha > 0.96 && lw > 1.6) {
          g.strokeStyle = this.shade(q.c, q.z, 0.4); g.lineWidth = lw + 1.8; g.stroke();
          g.strokeStyle = this.shade(q.c, q.z, 1); g.lineWidth = lw; g.stroke();
          const o = lw * 0.22;
          g.save(); g.translate(-o, -o);
          g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = lw * 0.26; g.stroke();
          g.restore();
        } else {
          g.strokeStyle = this.shade(q.c, q.z, 1); g.lineWidth = lw; g.stroke();
        }
      } else {
        const r = Math.max(2, q.r * q.s), c = q.c;
        const grd = g.createRadialGradient(q.x, q.y, r * 0.15, q.x, q.y, r);
        grd.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0.05)`);
        grd.addColorStop(0.72, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0.1)`);
        grd.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0.26)`);
        g.fillStyle = grd;
        g.beginPath(); g.arc(q.x, q.y, r, 0, 6.2832); g.fill();
        g.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0.3)`; g.lineWidth = 1;
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  render() {
    if (this.dead) return 0;
    const t0 = nowMs();
    const dt = Math.min(0.05, (t0 - this.tLast) / 1000);
    this.tLast = t0;
    if (this.spinOn && !this.held) {
      this.idle += dt;
      if (this.idle > this.idleDelay) { this.yaw += this.spinRate * dt; this.dirty = true; }
    }
    this.beginFrame();
    this.build();
    const list = this.list;
    list.length = this.np;
    for (let i = 0; i < this.np; i++) list[i] = this.pool[i];
    list.sort(byDepth);
    this.paint();
    this.lastMs = nowMs() - t0;
    this.frames++;
    this.frameMs += (this.lastMs - this.frameMs) * (this.frames < 8 ? 0.5 : 0.08);
    this.dirty = false;
    return this.lastMs;
  }

  pickAt(clientX, clientY) {
    const r = this.cv.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    let best = null, bd = 28 * 28;
    for (let i = 0; i < this.pickN; i++) {
      const dx = this.pickXY[i * 2] - x, dy = this.pickXY[i * 2 + 1] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    let lig = null, ld = bd;
    if (this.ligAtoms) for (let i = 0; i < this.ligAtoms.length; i++) {
      const dx = this.ligXY[i * 2] - x, dy = this.ligXY[i * 2 + 1] - y, d = dx * dx + dy * dy;
      if (d < ld) { ld = d; lig = i; }
    }
    if (lig != null) {
      const a = this.ligAtoms[lig];
      this.onPick(null, { kind: 'ligand', index: lig, atom: a && a.name });
      return null;
    }
    this.onPick(best, best == null ? null : { kind: 'residue', index: best, atom: 'CA' });
    return best;
  }

  dispose() {
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners = [];
    this.pool = []; this.list = []; this.scene = null; this.ligAtoms = null;
  }
}

function byDepth(a, b) { return a.z - b.z; }

// The only entry point. The page keeps one view per canvas.
export function createView(canvas, opts = {}) {
  const v = new View(canvas, opts);
  return {
    draw(scene, o) {
      if (v.dead) return 0;
      if (scene) v.setScene(scene, o || {});
      else if (o && o.camera) v.setScene(null, o);
      v.tExternal = nowMs();
      return v.render();
    },
    setSpin(on) { v.spinOn = !!on; v.idle = 0; v.dirty = true; },
    resize() { v.resize(); v.dirty = true; },
    dispose() { v.dispose(); },
    // Extras the page uses. The four above are the contract.
    setCamera(c) { v.setScene(null, { camera: c, fit: false }); v.dirty = true; },
    getCamera() { return { yaw: v.yaw, pitch: v.pitch, radius: v.radius, center: v.center.slice() }; },
    fit(scene) { v.setScene(scene || null, { fit: true }); v.dirty = true; },
    pick(clientX, clientY) { return v.pickAt(clientX, clientY); },
    stats() { return { frames: v.frames, lastMs: v.lastMs, frameMs: v.frameMs, prims: v.np, w: v.w, h: v.h }; },
    canvas,
  };
}
