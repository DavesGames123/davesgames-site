// ============================================================================
//  CORAL REEF  ·  fauna/gen/mesh.js  ·  the mesh builder of the generators
// ----------------------------------------------------------------------------
//  DOM-free. Every creature generator (fish.js, ceph.js, jelly.js,
//  echino.js, crust.js, sessile.js) writes into one builder:
//
//    const B = builder();
//    B.v(p, n, c, a, g) -> index   p, n: [x, y, z]; c: [r, g, b] (linear);
//                                   a: [s, w, ph, f] animation (below);
//                                   g: [r, g, b] emissive (photophores)
//    B.t(a, b, c)                   a triangle (counter-clockwise outside)
//    B.mesh() -> { positions, normals, colors, anim, glow, indices, tris,
//                  vertexCount, bounds }   (typed arrays, normals smoothed
//                  where the generator gave none)
//
//  ANIMATION CHANNELS (a, per vertex; fauna/glsl.js reads them)
//    s ... 0 at the head (or the base) .. 1 at the tail (or the tip): the
//          swim wave, the tentacle lag, the sway with height
//    w ... 0 body .. 1 appendage (fin, wing, arm, leg, tentacle, bell rim)
//    ph .. the phase of the appendage (arm or leg index / count)
//    f ... the flex of the appendage (0 stiff .. 1 limp); for an arm the
//          distance along the arm 0..1
//
//  SHAPES (each adds to B; frames are { o, x, y, z } with unit axes)
//    loft(B, spine(s) -> frame, section(s, u) -> [px, py] in the frame,
//         { ns, nu, col(s, u, p) , anim(s, u), glow(s, u), cap0, cap1 })
//    tube(B, points, radius(t), { nu, col, anim(t), glow(t) })  a swept tube
//    blob(B, centre, radii [rx, ry, rz], { nu, nv, col(p, n), anim(p), glow })
//    fin(B, outline [[x, y, z], ...] (a fan from point 0), thickness, { col, anim })
//    disc(B, centre, normal, r, { col, anim }) a flat cap
//
//  grep -n targets: "export function builder", "export function loft",
//  "export function tube", "export function blob", "export function fin"
// ============================================================================

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// sRGB hex (0xRRGGBB) to linear rgb
export function hex(h) { const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return [f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255)]; }

const NO_ANIM = [0, 0, 0, 0], NO_GLOW = [0, 0, 0];

export function builder() {
  let P = [], N = [], C = [], A = [], G = [], I = [];
  let hasN = [];
  return {
    v(p, n, c, a, g) {
      const i = P.length / 3;
      P.push(p[0], p[1], p[2]);
      if (n) { N.push(n[0], n[1], n[2]); hasN.push(1); } else { N.push(0, 0, 0); hasN.push(0); }
      C.push(c[0], c[1], c[2]);
      a = a || NO_ANIM; A.push(a[0], a[1], a[2], a[3]);
      g = g || NO_GLOW; G.push(g[0], g[1], g[2]);
      return i;
    },
    t(a, b, c) { I.push(a, b, c); },
    get count() { return P.length / 3; },
    mesh() {
      const n = P.length / 3;
      const positions = new Float32Array(P), normals = new Float32Array(N);
      // smooth normals for vertices that have none
      const acc = new Float32Array(n * 3);
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
        const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, c]) { acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; }
      }
      for (let i = 0; i < n; i++) {
        if (hasN[i]) continue;
        const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
        normals[i * 3] = acc[i * 3] / l; normals[i * 3 + 1] = acc[i * 3 + 1] / l; normals[i * 3 + 2] = acc[i * 3 + 2] / l;
      }
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
      const indices = n < 65536 ? new Uint16Array(I) : new Uint32Array(I);
      const out = { positions, normals, colors: new Float32Array(C), anim: new Float32Array(A), glow: new Float32Array(G), indices, tris: I.length / 3, vertexCount: n, bounds: { min: mn, max: mx } };
      P = N = C = A = G = I = hasN = null;
      return out;
    },
  };
}

// A frame along a spine curve: o (origin) and the unit axes x, y, z (z the tangent).
export function frameAt(o, z, upHint = [0, 1, 0]) {
  z = norm(z);
  let x = cross(upHint, z);
  if (len(x) < 1e-4) x = cross([1, 0, 0], z);
  x = norm(x);
  const y = cross(z, x);
  return { o, x, y, z };
}

// A lofted body: ns rings along s in [0, 1], nu points per ring (u in [0, 1),
// round the section). section(s, u) gives [px, py] in the ring frame.
export function loft(B, spine, section, o = {}) {
  const ns = o.ns || 16, nu = o.nu || 12, base = B.count;
  for (let i = 0; i <= ns; i++) {
    const s = i / ns, F = spine(s);
    for (let j = 0; j < nu; j++) {
      const u = j / nu, q = section(s, u);
      const p = add(F.o, add(scale(F.x, q[0]), scale(F.y, q[1])));
      B.v(p, null, o.col ? o.col(s, u, p) : [0.5, 0.5, 0.5], o.anim ? o.anim(s, u, p) : [s, 0, 0, 0], o.glow ? o.glow(s, u, p) : null);
    }
  }
  for (let i = 0; i < ns; i++) for (let j = 0; j < nu; j++) {
    const a = base + i * nu + j, b = base + i * nu + (j + 1) % nu, c = a + nu, d = b + nu;
    B.t(a, b, c); B.t(b, d, c);
  }
  // caps: a centre point at each end
  for (const [end, s] of [[o.cap0, 0], [o.cap1, 1]]) {
    if (!end) continue;
    const F = spine(s), ring = base + (s ? ns * nu : 0);
    const ci = B.v(F.o, null, o.col ? o.col(s, 0, F.o) : [0.5, 0.5, 0.5], o.anim ? o.anim(s, 0, F.o) : [s, 0, 0, 0]);
    for (let j = 0; j < nu; j++) { const a = ring + j, b = ring + (j + 1) % nu; if (s) B.t(ci, a, b); else B.t(ci, b, a); }
  }
}

// A tube along points (a polyline), radius(t) with t the arc fraction.
export function tube(B, pts, radius, o = {}) {
  const n = pts.length; if (n < 2) return;
  const L = [0]; for (let i = 1; i < n; i++) L.push(L[i - 1] + len(sub(pts[i], pts[i - 1])));
  const tot = L[n - 1] || 1, nu = o.nu || 6, base = B.count;
  let prevX = null;
  for (let i = 0; i < n; i++) {
    const t = L[i] / tot;
    const tan = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
    // parallel transport of the frame (no twist)
    let x = prevX ? norm(sub(prevX, scale(tan, dot(prevX, tan)))) : null;
    if (!x || len(x) < 1e-4) { x = cross(o.up || [0, 1, 0], tan); if (len(x) < 1e-4) x = cross([1, 0, 0], tan); x = norm(x); }
    prevX = x;
    const y = cross(tan, x), r = radius(t);
    for (let j = 0; j < nu; j++) {
      const a = (j / nu) * Math.PI * 2, d = add(scale(x, Math.cos(a)), scale(y, Math.sin(a)));
      B.v(add(pts[i], scale(d, r)), d, o.col ? o.col(t, j / nu) : [0.5, 0.5, 0.5], o.anim ? o.anim(t) : [t, 0, 0, 0], o.glow ? o.glow(t) : null);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < nu; j++) {
    const a = base + i * nu + j, b = base + i * nu + (j + 1) % nu, c = a + nu, d = b + nu;
    B.t(a, b, c); B.t(b, d, c);
  }
  if (o.capEnd) {
    const ci = B.v(pts[n - 1], norm(sub(pts[n - 1], pts[n - 2])), o.col ? o.col(1, 0) : [0.5, 0.5, 0.5], o.anim ? o.anim(1) : [1, 0, 0, 0], o.glow ? o.glow(1) : null);
    const ring = base + (n - 1) * nu;
    for (let j = 0; j < nu; j++) B.t(ring + j, ring + (j + 1) % nu, ci);
  }
}

// An ellipsoid (a UV sphere) at centre with radii r.
export function blob(B, c, r, o = {}) {
  const nu = o.nu || 10, nv = o.nv || 7, base = B.count;
  for (let i = 0; i <= nv; i++) {
    const th = (i / nv) * Math.PI;
    for (let j = 0; j < nu; j++) {
      const ph = (j / nu) * Math.PI * 2;
      const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const p = [c[0] + n[0] * r[0], c[1] + n[1] * r[1], c[2] + n[2] * r[2]];
      B.v(p, norm([n[0] / r[0], n[1] / r[1], n[2] / r[2]]), o.col ? o.col(p, n) : [0.5, 0.5, 0.5], o.anim ? o.anim(p, n) : [0, 0, 0, 0], o.glow ? o.glow(p, n) : null);
    }
  }
  for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) {
    const a = base + i * nu + j, b = base + i * nu + (j + 1) % nu, c2 = a + nu, d = b + nu;
    B.t(a, b, c2); B.t(b, d, c2);
  }
}

// A thin fin: a fan from outline[0] through the other points, two faces
// offset by the thickness along the fan normal (so both sides are lit).
export function fin(B, pts, thick, o = {}) {
  if (pts.length < 3) return;
  const nrm = norm(cross(sub(pts[1], pts[0]), sub(pts[pts.length - 1], pts[0])));
  for (const side of [1, -1]) {
    const base = B.count, off = scale(nrm, thick * 0.5 * side), n = scale(nrm, side);
    for (let i = 0; i < pts.length; i++) {
      const p = add(pts[i], off);
      B.v(p, n, o.col ? o.col(i, p) : [0.5, 0.5, 0.5], o.anim ? o.anim(i, p) : [0, 1, 0, 0.5], o.glow ? o.glow(i, p) : null);
    }
    for (let i = 1; i < pts.length - 1; i++) { if (side > 0) B.t(base, base + i, base + i + 1); else B.t(base, base + i + 1, base + i); }
  }
}

// A flat round cap (two-sided disc).
export function disc(B, c, n, r, o = {}) {
  const F = frameAt(c, n), nu = o.nu || 10, pts = [c];
  for (let j = 0; j <= nu; j++) { const a = (j / nu) * Math.PI * 2; pts.push(add(c, add(scale(F.x, Math.cos(a) * r), scale(F.y, Math.sin(a) * r)))); }
  fin(B, pts, o.thick || 0.002, o);
}
