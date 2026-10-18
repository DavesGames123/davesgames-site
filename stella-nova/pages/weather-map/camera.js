// ============================================================================
//  WEATHER MAP  ·  camera.js — the orbit camera and its maths (no DOM)
// ----------------------------------------------------------------------------
//  A camera is { lat, lon, alt, tilt, heading } (CONTRACT.md): it looks at
//  the ground point (lat, lon) from a distance alt (globe radii). tilt 0
//  looks straight down; tilt t moves the eye back by t (rad) from the
//  zenith, away from the view heading. heading 0 = screen up is north,
//  pi/2 = screen up is east.
//
//  camState(lat, lon, alt, tilt, heading)  a camera object
//  eyeFrame(cam) -> { eye, target, up }  globe-space vectors
//  viewProj(cam, w, h, fovY, phoneTilt) -> { view, proj, viewProj, invViewProj, eye,
//                     w, h, fovY, near, far }   Float32Array(16) matrices,
//                     column-major, WebGPU clip depth 0..1. w, h in CSS px
//                     (project and pick read them); only the aspect matters
//                     to the matrices.
//  project(m, lat, lon, r) -> { x, y, depth, visible }  CSS px
//  pick(m, x, y) -> { lat, lon } | null   ray against the unit sphere
//  flight(from, to, opts) -> (u 0..1) -> cam   news-style move: rise,
//                     travel the great circle, descend
//  flightSeconds(from, to)  a duration suggestion for flight (s)
//  lerpCam(a, b, s), slerpLatLon(a, b, s), centralAngle(a, b)
//
//  grep -n targets: "export function viewProj", "export function project",
//  "export function pick", "export function flight", "export function lerpCam",
//  "export const FOV_Y"
// ============================================================================
import { latLonToXYZ, xyzToLatLon } from './astro.js';
import { tiltEye } from '../../lib/tilt.js';

export const FOV_Y = 30 * Math.PI / 180;
export const ALT_MIN = 0.012, ALT_MAX = 6;

const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function camState(lat, lon, alt, tilt = 0, heading = 0) {
  return { lat, lon, alt: clamp(alt, ALT_MIN, ALT_MAX), tilt, heading };
}

// East and north unit vectors at a ground point (globe space).
export function enu(lat, lon) {
  const l = lon * D2R, p = lat * D2R;
  const east = [-Math.sin(l), 0, -Math.cos(l)];
  const north = [-Math.sin(p) * Math.cos(l), Math.cos(p), Math.sin(p) * Math.sin(l)];
  return { up: latLonToXYZ(lat, lon), east, north };
}

export function eyeFrame(cam) {
  const { up: n, east, north } = enu(cam.lat, cam.lon);
  const h = cam.heading || 0, t = cam.tilt || 0;
  const f = add(scale(north, Math.cos(h)), scale(east, Math.sin(h)));
  const back = add(scale(n, Math.cos(t)), scale(f, -Math.sin(t)));
  const eye = add(n, scale(back, cam.alt));
  const up = add(scale(n, Math.sin(t)), scale(f, Math.cos(t)));
  return { eye, target: n, up: norm(up) };
}

// ── 4x4 matrices, column-major ───────────────────────────────────────────
export function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function invert(m) {
  const a = Array.from(m), inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  const o = new Float32Array(16), k = det ? 1 / det : 0;
  for (let i = 0; i < 16; i++) o[i] = inv[i] * k;
  return o;
}

export function lookAt(eye, target, up) {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

// WebGPU perspective: clip z / w in 0..1 (near -> 0, far -> 1).
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, near * far * nf, 0]);
}

export function viewProj(cam, w = 1, h = 1, fovY = FOV_Y, phoneTilt = false) {
  const f = eyeFrame(cam), { target, up } = f;
  const eye = phoneTilt ? tiltEye(f.eye, target, up) : f.eye; // lib/tilt.js: render view only
  const D = Math.hypot(eye[0], eye[1], eye[2]);
  // near: half the gap to the highest overlay shell; far: the horizon plus
  // the atmosphere top seen past it (nothing behind the horizon is visible)
  const near = Math.max(2e-5, (D - 1.0035) * 0.5);
  const far = Math.sqrt(Math.max(D * D - 1, 0)) + 0.3;
  const view = lookAt(eye, target, up);
  const proj = perspective(fovY, Math.max(w, 1) / Math.max(h, 1), near, Math.max(far, near * 4));
  const vp = mul(proj, view);
  return { view, proj, viewProj: vp, invViewProj: invert(vp), eye, w, h, fovY, near, far };
}

function xform(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}

// Does the unit sphere hide point p from the eye?
export function occluded(eye, p) {
  const d = sub(p, eye), len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-9) return false;
  const dir = scale(d, 1 / len), b = dot(eye, dir), c = dot(eye, eye) - 1, disc = b * b - c;
  if (disc <= 0) return false;
  const t0 = -b - Math.sqrt(disc);
  return t0 > 0 && t0 < len - 1e-5 * Math.max(1, len);
}

export function project(m, lat, lon, r = 1) {
  const p = latLonToXYZ(lat, lon, r);
  const c = xform(m.viewProj, p);
  if (c[3] <= 1e-9) return { x: NaN, y: NaN, depth: 1, visible: false };
  const nx = c[0] / c[3], ny = c[1] / c[3], depth = c[2] / c[3];
  const x = (nx * 0.5 + 0.5) * m.w, y = (0.5 - ny * 0.5) * m.h;
  const on = nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1 && depth >= 0 && depth <= 1;
  return { x, y, depth, visible: on && !occluded(m.eye, p) };
}

// The ray through CSS pixel (x, y) and its first hit on the unit sphere.
export function pickRay(m, x, y) {
  const nx = x / m.w * 2 - 1, ny = 1 - y / m.h * 2;
  const f = xform(m.invViewProj, [nx, ny, 1]);
  const far = [f[0] / f[3], f[1] / f[3], f[2] / f[3]];
  return { ro: m.eye, rd: norm(sub(far, m.eye)) };
}

export function pick(m, x, y) {
  const { ro, rd } = pickRay(m, x, y);
  const b = dot(ro, rd), c = dot(ro, ro) - 1, disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  return xyzToLatLon(add(ro, scale(rd, t)));
}

// ── interpolation ────────────────────────────────────────────────────────
export function centralAngle(a, b) {
  const pa = latLonToXYZ(a.lat, a.lon), pb = latLonToXYZ(b.lat, b.lon);
  return Math.atan2(Math.hypot(...cross(pa, pb)), dot(pa, pb));
}

export function slerpLatLon(a, b, s) {
  const pa = latLonToXYZ(a.lat, a.lon), pb = latLonToXYZ(b.lat, b.lon);
  const w = Math.atan2(Math.hypot(...cross(pa, pb)), dot(pa, pb));
  if (w < 1e-7) return { lat: a.lat + (b.lat - a.lat) * s, lon: a.lon + (b.lon - a.lon) * s };
  const sw = Math.sin(w), ka = Math.sin((1 - s) * w) / sw, kb = Math.sin(s * w) / sw;
  return xyzToLatLon(add(scale(pa, ka), scale(pb, kb)));
}

const angLerp = (a, b, s) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * s;
};

export function lerpCam(a, b, s) {
  const ll = slerpLatLon(a, b, s);
  return {
    lat: ll.lat, lon: ll.lon,
    alt: Math.exp(Math.log(a.alt) + (Math.log(b.alt) - Math.log(a.alt)) * s),
    tilt: (a.tilt || 0) + ((b.tilt || 0) - (a.tilt || 0)) * s,
    heading: angLerp(a.heading || 0, b.heading || 0, s),
  };
}

const smoother = u => u * u * u * (u * (u * 6 - 15) + 10);

// News-style flight. opts.rise (default 1.3): the peak altitude per radian
// of travel. The altitude follows a log-lerp of the two ends plus a bump
// that lifts the midpoint to the peak, so a long move zooms out, travels
// and zooms in; a short hop (peak under the mid altitude) does not climb.
export function flight(from, to, opts = {}) {
  const ang = centralAngle(from, to);
  const peak = Math.min(ALT_MAX, ang * (opts.rise ?? 1.3));
  const H = Math.max(0, peak - Math.sqrt(from.alt * to.alt));
  return u => {
    const uu = clamp(u, 0, 1);
    // travel waits a little for the climb and lands before the descent ends
    const s = smoother(clamp((uu - 0.08) / 0.84, 0, 1));
    const c = lerpCam(from, to, s);
    const bump = Math.sin(Math.PI * uu);
    c.alt = clamp(Math.exp(Math.log(from.alt) + (Math.log(to.alt) - Math.log(from.alt)) * smoother(uu)) + H * bump, ALT_MIN, ALT_MAX);
    c.tilt = ((from.tilt || 0) + ((to.tilt || 0) - (from.tilt || 0)) * smoother(uu)) * (1 - (H > 0 ? 0.8 : 0) * bump);
    if (uu === 1) return { ...to };
    if (uu === 0) return { ...from };
    return c;
  };
}

export function flightSeconds(from, to) {
  const ang = centralAngle(from, to);
  return clamp(1.8 + 2.6 * ang + 0.6 * Math.abs(Math.log(to.alt / from.alt)), 1.5, 8);
}
