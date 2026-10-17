// ============================================================================
//  DLAF PAGE  ·  camera.js — view maths for the 2D and 3D views
// ----------------------------------------------------------------------------
//  DOM-free. The view fits a world box into the clear rectangle of the canvas
//  (the part that the panel, the dock, the bars or the saver label plate do
//  not cover). 2D uses an orthographic matrix. 3D uses a perspective matrix
//  around an orbit target. All matrices are column-major Float32Array(16),
//  the WebGL order.
//
//  grep -n targets
//    clear rect ............ "export function clearRect"
//    saver band rect ....... "export function bandRect"
//    2D fit ................ "export function fit2D"
//    2D matrix ............. "export function ortho2D"
//    3D fit ................ "export function fit3D"
//    3D matrix ............. "export function orbitMatrix"
//    matrix product ........ "export function mul4"
//    world to screen ....... "export function project"
//    surface 2D matrix ..... "export function relief2D"
//    eye of the orbit ...... "export function orbitEye"
//    light and below maps .. "export function lightMatrix"
// ============================================================================

// The clear rectangle in CSS px: the canvas minus the occluded margins
// { l, r, t, b }. A rectangle smaller than min px keeps min px.
export function clearRect(w, h, occ = {}, min = 80) {
  const l = occ.l || 0, r = occ.r || 0, t = occ.t || 0, b = occ.b || 0;
  const cw = Math.max(min, w - l - r), ch = Math.max(min, h - t - b);
  return { x: Math.min(l, Math.max(0, w - cw)), y: Math.min(t, Math.max(0, h - ch)), w: cw, h: ch };
}

// The clear rectangle of the saver: the band from plateBand() ({ t, b, w }),
// centred on a column of width band.w (the 9:16 column, or the full width).
// A null band gives the full canvas.
export function bandRect(w, h, band) {
  if (!band) return { x: 0, y: 0, w, h };
  const bw = Math.min(w, band.w || w);
  const t = Math.min(band.t, h * 0.42), b = Math.min(band.b, h * 0.42);
  return { x: (w - bw) / 2, y: t, w: bw, h: Math.max(40, h - t - b) };
}

// Fit the world box { x0, x1, y0, y1 } into rect (CSS px) of a w x h canvas,
// with fill (0..1) of the rect. Returns { cx, cy, scale, ox, oy }: the world
// point at the rect centre, CSS px per world unit, and the rect centre as an
// offset from the canvas centre.
export function fit2D(box, rect, w, h, fill = 0.9) {
  const bw = Math.max(1e-6, box.x1 - box.x0), bh = Math.max(1e-6, box.y1 - box.y0);
  const scale = fill * Math.min(rect.w / bw, rect.h / bh);
  return {
    cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, scale,
    ox: rect.x + rect.w / 2 - w / 2, oy: rect.y + rect.h / 2 - h / 2,
  };
}

// The 2D view as a matrix: world (x, y) to clip space. y is up in the world
// and up on the screen. view = { cx, cy, scale, ox, oy }.
export function ortho2D(view, w, h, out = new Float32Array(16)) {
  const sx = 2 * view.scale / w, sy = 2 * view.scale / h;
  out.fill(0);
  out[0] = sx; out[5] = sy; out[10] = -0.001; out[15] = 1;
  out[12] = -view.cx * sx + 2 * view.ox / w;
  out[13] = -view.cy * sy - 2 * view.oy / h;
  return out;
}

// World point to CSS px with a matrix (2D or 3D). Returns [x, y, wClip].
export function project(mat, p, w, h, out = [0, 0, 0]) {
  const x = p[0], y = p[1], z = p[2] || 0;
  const cx = mat[0] * x + mat[4] * y + mat[8] * z + mat[12];
  const cy = mat[1] * x + mat[5] * y + mat[9] * z + mat[13];
  const cw = mat[3] * x + mat[7] * y + mat[11] * z + mat[15];
  const iw = cw !== 0 ? 1 / cw : 1;
  out[0] = (cx * iw * 0.5 + 0.5) * w; out[1] = (0.5 - cy * iw * 0.5) * h; out[2] = cw;
  return out;
}

// The camera distance that holds a ball of radius r in rect, with a vertical
// field of view fov (radians) over the full canvas height h. A ball at
// distance D spans r f / D of the half clip height (f = 1 / tan(fov / 2)),
// and the rect half height is rect.h / h in the same units; the width gives
// the same sum with rect.w. The + r keeps the near side in the rect.
export function fit3D(r, rect, w, h, fov = 0.8, fill = 0.85) {
  const f = 1 / Math.tan(fov / 2);
  return r * f * h / (fill * Math.max(1, Math.min(rect.w, rect.h))) + r;
}

// Column-major 4x4 product a * b.
export function mul4(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}

// The 3D view: an orbit camera at distance dist, yaw and pitch around the
// origin, a perspective of fov, and a screen shift to the rect centre
// (ox, oy in CSS px). Returns the projection times view matrix.
export function orbitMatrix(cam, w, h, out = new Float32Array(16)) {
  const fov = cam.fov || 0.8, f = 1 / Math.tan(fov / 2), asp = w / h;
  const near = Math.max(0.1, cam.dist * 0.02), far = cam.dist * 4 + 10;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const RY = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const RX = [1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1];
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -cam.dist, 1];
  const V = mul4(T, mul4(RX, RY));
  const P = new Float32Array(16);
  P[0] = f / asp; P[5] = f; P[10] = (far + near) / (near - far); P[11] = -1; P[14] = 2 * far * near / (near - far);
  // a clip-space shift by (ox, oy) CSS px: x' = x + (2 ox / w) w_clip, and w_clip = -z_view
  P[8] = -2 * (cam.ox || 0) / w; P[9] = 2 * (cam.oy || 0) / h;
  return mul4(P, V, out);
}

// Ease a toward b with a time constant tau (s) over dt (s).
export function ease(a, b, dt, tau = 0.5) { return a + (b - a) * (1 - Math.exp(-dt / Math.max(1e-3, tau))); }

// The 2D view for the relief surface: ortho2D, with a real depth range so
// the tubes (z up to +-zr) depth-test. Larger z is nearer the viewer.
export function relief2D(view, w, h, zr = 64, out = new Float32Array(16)) {
  ortho2D(view, w, h, out);
  out[10] = -1 / zr;
  return out;
}

// The eye position and the camera axes of an orbit camera (world space):
// the rows of the rotation RX * RY that orbitMatrix uses.
export function orbitEye(cam) {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  // RY then RX (rows of the view rotation)
  const right = [cy, 0, sy];
  const up = [sp * sy, cp, -sp * cy];
  const back = [-cp * sy, sp, cp * cy];
  return { eye: back.map(v => v * cam.dist), right, up, back };
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// An orthographic camera at eye that looks along dir: a box of half size
// hs across and depth near..far. Column-major projection times view.
export function orthoLook(eye, dir, upHint, hs, near, far, out = new Float32Array(16)) {
  const f = nrm3(dir);
  let up = Math.abs(dot3(f, upHint)) > 0.98 ? (Math.abs(f[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]) : upHint;
  const r = nrm3(cross(f, up)); up = cross(r, f);
  const V = new Float32Array([r[0], up[0], -f[0], 0, r[1], up[1], -f[1], 0, r[2], up[2], -f[2], 0,
    -dot3(r, eye), -dot3(up, eye), dot3(f, eye), 1]);
  const P = new Float32Array(16);
  P[0] = 1 / hs; P[5] = 1 / hs; P[10] = -2 / (far - near); P[14] = -(far + near) / (far - near); P[15] = 1;
  return mul4(P, V, out);
}

// The key-light shadow map: an ortho box round the ball (centre c, radius r)
// along the light L (unit, to the light). depth covers the ball and the
// ground (gExtra more along L).
export function lightMatrix(c, r, L, upHint, gExtra = 0, out) {
  const d = r * 2 + gExtra;
  const eye = [c[0] + L[0] * d, c[1] + L[1] * d, c[2] + L[2] * d];
  return orthoLook(eye, [-L[0], -L[1], -L[2]], upHint, r * 1.04, Math.max(0.01, d - r * 1.1), d + r * 1.1 + gExtra * 2, out);
}

// The "below" map: from the ground plane (the point under c, height g along
// up) looking up; depth 0..1 is the height 0..range over the ground.
export function belowMatrix(c, up, g, hs, range, out) {
  const t = dot3(c, up) - g;
  const eye = [c[0] - up[0] * t, c[1] - up[1] * t, c[2] - up[2] * t];
  const hint = Math.abs(up[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  return orthoLook(eye, up, hint, hs, 0, range, out);
}
