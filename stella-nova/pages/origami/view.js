// view.js -- coordinate transforms: the flat editor view, the orbit view, snapping.
//
// Port of origami src/view.rs. The crease pattern lives in a centred unit
// square. The editor shows it flat, fit to its pane. The simulator shows the same
// nodes in 3D through an orbiting camera. Both map to physical canvas pixels,
// the space the draw passes use.
//
// The web page adds pan and zoom to View2D: `fit` takes an optional zoom factor
// and a pixel offset, and the result is still one scale and one centre, so
// snap and the pixel maths stay as in the native app.
//
// grep map:
//   View2D  -- fit the unit square to a pixel region, world to and from pixels
//   Orbit   -- yaw, pitch, distance; a matrix and a projection to pixels
//   snap    -- the nearest grid point or existing vertex to a world point
//   mat4 helpers -- perspectiveRh, lookAtRh, mul (glam column-major order)

export class View2D {
  constructor(scale, cx, cy) {
    this.scale = scale;   // pixels per world unit
    this.cx = cx;         // the pixel the world origin maps to
    this.cy = cy;
  }

  // Fit the unit square into region [x0, y0, x1, y1] with a margin. `zoom` and
  // `pan` are the web additions: a scale factor and a pixel offset.
  static fit(region, margin, zoom = 1, pan = [0, 0]) {
    const w = Math.max(region[2] - region[0] - 2 * margin, 1);
    const h = Math.max(region[3] - region[1] - 2 * margin, 1);
    const scale = Math.min(w, h) * zoom;
    return new View2D(scale, (region[0] + region[2]) * 0.5 + pan[0], (region[1] + region[3]) * 0.5 + pan[1]);
  }

  // World point to pixels. World y is up, so pixel y flips.
  toPx(p) { return [this.cx + p[0] * this.scale, this.cy - p[1] * this.scale]; }

  // Pixels to world point.
  toWorld(px) { return [(px[0] - this.cx) / this.scale, (this.cy - px[1]) / this.scale]; }
}

// ── 4x4 matrices, column-major as glam stores them ─────────────────────────
export function perspectiveRh(fovY, aspect, near, far) {
  const h = Math.cos(0.5 * fovY) / Math.sin(0.5 * fovY);
  const w = h / aspect;
  const r = far / (near - far);
  return [w, 0, 0, 0, 0, h, 0, 0, 0, 0, r, -1, 0, 0, r * near, 0];
}

export function lookAtRh(eye, center, up) {
  const f = norm([center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]]);
  const s = norm(cross(f, up));
  const u = cross(s, f);
  return [
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(eye, s), -dot(eye, u), dot(eye, f), 1,
  ];
}

export function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// An orbiting camera about the origin.
export class Orbit {
  constructor(yaw = 0.7, pitch = 0.6, dist = 2.4) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.dist = dist;
  }

  // The eye position in world space.
  eye() {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * cp * this.dist, Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * cp * this.dist];
  }

  // The view-projection matrix for an aspect ratio.
  matrix(aspect) {
    const proj = perspectiveRh(45 * Math.PI / 180, Math.max(aspect, 0.01), 0.05, 100.0);
    const view = lookAtRh(this.eye(), [0, 0, 0], [0, 1, 0]);
    return mul(proj, view);
  }

  // Project a world point to pixels in a region, or null behind the camera.
  // `x, y, z` are passed flat, so the frame loop does not allocate a vector.
  project(x, y, z, m, region) {
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1e-4) return null;
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
    const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    const w = region[2] - region[0], h = region[3] - region[1];
    return [region[0] + (cx * 0.5 + 0.5) * w, region[1] + (1 - (cy * 0.5 + 0.5)) * h];
  }
}

// The nearest snap target: an existing vertex first, then a grid point, but only
// within pxThresh pixels. Otherwise the point is unchanged.
export function snap(world, cp, gridN, view, pxThresh) {
  const threshWorld = pxThresh / view.scale;
  let best = world;
  let bestD = threshWorld;
  for (const v of cp.vertices) {
    const d = Math.hypot(v[0] - world[0], v[1] - world[1]);
    if (d < bestD) { bestD = d; best = v; }
  }
  if (gridN > 0) {
    const step = 1 / gridN;
    const gx = Math.round((world[0] + 0.5) / step) * step - 0.5;
    const gy = Math.round((world[1] + 0.5) / step) * step - 0.5;
    const g = [Math.min(Math.max(gx, -0.5), 0.5), Math.min(Math.max(gy, -0.5), 0.5)];
    const d = Math.hypot(g[0] - world[0], g[1] - world[1]);
    if (d < bestD) best = g;
  }
  return [best[0], best[1]];
}
