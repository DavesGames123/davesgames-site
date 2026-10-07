// ============================================================================
//  THIN-FILM CLOTH  ·  xpbd.js — the cloth solver (DOM-free)
// ----------------------------------------------------------------------------
//  A grid cloth solved with extended position-based dynamics (XPBD, Macklin,
//  Mueller and Chentanez 2016) in small substeps. The module has no DOM and
//  no three.js, so tests.mjs runs it in Node and sim-worker.js runs it in a
//  worker. The page thread gets plain typed arrays back.
//
//  CONSTRAINTS. All are distance constraints C = |xa - xb| - L with a
//  compliance alpha = 1 / k (m/N). Three families share one array:
//    stretch  grid edges (i,j)-(i+1,j) and (i,j)-(i,j+1)    k = Y
//    shear    quad diagonals                              k = S
//    bend     skip edges (i,j)-(i+2,j) and (i,j)-(i,j+2)   k = B / h^2
//  Y and S are membrane moduli in N/m, B is a bending rigidity in N m, h is
//  the grid spacing. A spring network of a square grid gives a membrane
//  modulus near k, so the per-edge k is the modulus itself. This is an
//  approximation, good to a factor near 2, and not a finite-element model.
//
//  SUBSTEP. predict (gravity, wind, drag) -> solve constraints -> project
//  pins, colliders, floor and self contact -> velocity from the position
//  change -> linear damping.
//
//  SELF CONTACT. A spatial hash finds particle pairs closer than the contact
//  distance plus a travel margin, once per frame. Each substep then pushes
//  those pairs apart to the contact distance.
//
//  TEARING. When tearing is on, a stretch edge with a strain above the fabric
//  limit breaks. The two quads on that edge die: their shear edges stop and
//  the mesh leaves out their triangles. A bend edge stops when one of its
//  two stretch edges breaks.
//
//  GREP MAP
//    grep -n 'export const FABRICS'      the fabric presets and their units
//    grep -n 'export class Cloth'         the solver state
//    grep -n 'step('                      one frame: substeps and iterations
//    grep -n 'solveEdges'                 the XPBD distance update
//    grep -n 'collide('                   colliders and the floor
//    grep -n 'buildContacts'              the spatial hash for self contact
//    grep -n 'windAccel'                  the triangle pressure model
//    grep -n 'surface('                   normals, tangents and area ratio
//    grep -n 'energy('                    kinetic + potential + elastic energy
//    grep -n 'export function sdf'        the collider distance functions
// ============================================================================

// Fabric presets. Units: density kg/m^2, stretch and shear N/m, bend N m,
// damping 1/s, friction is a Coulomb-like factor 0..1, tear is the edge
// strain at break. film: n is the film index, sub the substrate key in
// film.js MEDIA, d0 the mean thickness in nm, dv the relative variation.
// rough: [along the weave, across it] GGX roughness.
export const FABRICS = {
  silk: {
    label: 'Silk', density: 0.06, stretch: 2.5e3, shear: 4.0e2, bend: 3e-6, damping: 0.25, friction: 0.45, tear: 0.55, drag: 1.0,
    film: { n: 1.46, sub: 'dye', d0: 420, dv: 0.30 }, rough: [0.30, 0.42], tint: [0.10, 0.05, 0.12],
    note: 'Silk with a thin silica coat. Light, soft, the coat gives a pale shimmer over a dark dye.',
  },
  foil: {
    label: 'Brushed foil', density: 0.041, stretch: 4.0e4, shear: 2.0e4, bend: 6e-5, damping: 0.35, friction: 0.30, tear: 0.07, drag: 1.0,
    film: { n: 1.38, sub: 'aluminium', d0: 330, dv: 0.45 }, rough: [0.07, 0.30], tint: [0, 0, 0],
    note: '15 um aluminium foil under a fluoride lacquer. Stiff and crisp, brushed along one axis.',
  },
  mylar: {
    label: 'Mylar', density: 0.035, stretch: 9.0e4, shear: 4.5e4, bend: 1.2e-5, damping: 0.30, friction: 0.25, tear: 0.12, drag: 1.0,
    film: { n: 1.64, sub: 'aluminium', d0: 260, dv: 0.25 }, rough: [0.04, 0.05], tint: [0, 0, 0],
    note: 'Aluminised PET, 25 um. A near mirror with a PET top film.',
  },
  rubber: {
    label: 'Rubber sheet', density: 0.48, stretch: 80, shear: 80, bend: 4e-5, damping: 0.6, friction: 0.8, tear: 2.4, drag: 1.0,
    film: { n: 1.52, sub: 'dye', d0: 640, dv: 0.20 }, rough: [0.22, 0.22], tint: [0.03, 0.03, 0.035],
    note: 'Soft silicone rubber, 0.5 mm (E near 0.16 MPa), with a clear coat. Pull it: the coat thins and its colours move to blue.',
  },
  mail: {
    label: 'Heavy mail', density: 3.0, stretch: 4.0e5, shear: 1.5e2, bend: 2e-7, damping: 0.5, friction: 0.6, tear: 0.03, drag: 0.4,
    film: { n: 2.4, sub: 'steel', d0: 90, dv: 0.55 }, rough: [0.26, 0.26], tint: [0, 0, 0],
    note: 'Heavy and limp like chain mail. Its oxide layer gives the straw to blue temper colours of heated steel.',
  },
};

const STRETCH = 0, SHEAR = 1, BEND = 2;

// Signed distance to one collider shape and its outward normal. o is a
// 4-vector out: [nx, ny, nz, d].
export function sdf(c, x, y, z, o) {
  if (c.type === 'sphere') {
    const dx = x - c.c[0], dy = y - c.c[1], dz = z - c.c[2];
    const l = Math.hypot(dx, dy, dz) || 1e-9;
    o[0] = dx / l; o[1] = dy / l; o[2] = dz / l; o[3] = l - c.r;
    return o;
  }
  if (c.type === 'box') {           // rounded box: half extents h, corner radius r
    const px = x - c.c[0], py = y - c.c[1], pz = z - c.c[2];
    const qx = Math.abs(px) - c.h[0] + c.r, qy = Math.abs(py) - c.h[1] + c.r, qz = Math.abs(pz) - c.h[2] + c.r;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    const out = Math.hypot(mx, my, mz);
    if (out > 0) {
      o[0] = Math.sign(px) * mx / out; o[1] = Math.sign(py) * my / out; o[2] = Math.sign(pz) * mz / out;
      o[3] = out - c.r;
    } else {                        // inside: the nearest face
      const m = Math.max(qx, qy, qz);
      o[0] = m === qx ? Math.sign(px) : 0; o[1] = m === qy && m !== qx ? Math.sign(py) : 0;
      o[2] = m === qz && m !== qx && m !== qy ? Math.sign(pz) : 0;
      o[3] = m - c.r;
    }
    return o;
  }
  if (c.type === 'capsule') {       // segment a-b, radius r
    const ax = c.a[0], ay = c.a[1], az = c.a[2];
    const ex = c.b[0] - ax, ey = c.b[1] - ay, ez = c.b[2] - az;
    const px = x - ax, py = y - ay, pz = z - az;
    const t = Math.max(0, Math.min(1, (px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez)));
    const dx = px - ex * t, dy = py - ey * t, dz = pz - ez * t;
    const l = Math.hypot(dx, dy, dz) || 1e-9;
    o[0] = dx / l; o[1] = dy / l; o[2] = dz / l; o[3] = l - c.r;
    return o;
  }
  o[3] = 1e9; return o;
}

export class Cloth {
  // opts: nx, ny (particles), size [w, h] in m, center [x, y, z],
  // plane 'xz' (flat, facing up) or 'xy' (hanging), fabric (a FABRICS entry)
  constructor(opts = {}) {
    this.nx = opts.nx || 48; this.ny = opts.ny || 48;
    this.size = opts.size || [1.2, 1.2];
    this.center = opts.center || [0, 1.2, 0];
    this.plane = opts.plane || 'xz';
    this.gravity = opts.gravity == null ? -9.81 : opts.gravity;
    this.floor = opts.floor == null ? 0 : opts.floor;
    this.colliders = [];
    this.wind = { speed: 0, dir: [1, 0, 0], turb: 0, t: 0 };
    this.selfContact = opts.selfContact !== false;
    this.tearing = false;
    this.substeps = opts.substeps || 10;
    this.iterations = opts.iterations || 1;
    this.n = this.nx * this.ny;
    this.h = this.size[0] / (this.nx - 1);
    this.thick = opts.thick || 0.7 * this.h;     // self contact distance
    this.skin = opts.skin || 0.006;              // collider skin, m
    this.grab = null;
    this.torn = false;                           // set when the triangle list changed
    this._o = new Float64Array(4);
    this._build();
    this.setFabric(opts.fabric || FABRICS.silk);
    this.reset();
  }

  _build() {
    const { nx, ny, n } = this;
    this.x = new Float32Array(3 * n); this.p = new Float32Array(3 * n);
    this.v = new Float32Array(3 * n); this.a = new Float32Array(3 * n);
    this.rest = new Float32Array(3 * n);
    this.w = new Float32Array(n); this.pin = new Uint8Array(n);
    this.pinAt = new Float32Array(3 * n);
    const idx = (i, j) => j * nx + i;
    const A = [], B = [], K = [], Q0 = [], Q1 = [], D0 = [], D1 = [];
    const edge = new Map();
    const add = (a, b, kind, q0 = -1, q1 = -1, d0 = -1, d1 = -1) => { A.push(a); B.push(b); K.push(kind); Q0.push(q0); Q1.push(q1); D0.push(d0); D1.push(d1); return A.length - 1; };
    const quad = (i, j) => (i >= 0 && j >= 0 && i < nx - 1 && j < ny - 1) ? j * (nx - 1) + i : -1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (i < nx - 1) edge.set(`h${i},${j}`, add(idx(i, j), idx(i + 1, j), STRETCH, quad(i, j - 1), quad(i, j)));
      if (j < ny - 1) edge.set(`v${i},${j}`, add(idx(i, j), idx(i, j + 1), STRETCH, quad(i - 1, j), quad(i, j)));
    }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      add(idx(i, j), idx(i + 1, j + 1), SHEAR, quad(i, j));
      add(idx(i + 1, j), idx(i, j + 1), SHEAR, quad(i, j));
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (i < nx - 2) add(idx(i, j), idx(i + 2, j), BEND, -1, -1, edge.get(`h${i},${j}`), edge.get(`h${i + 1},${j}`));
      if (j < ny - 2) add(idx(i, j), idx(i, j + 2), BEND, -1, -1, edge.get(`v${i},${j}`), edge.get(`v${i},${j + 1}`));
    }
    const m = A.length;
    this.m = m;
    this.ea = Int32Array.from(A); this.eb = Int32Array.from(B); this.kind = Uint8Array.from(K);
    this.eq0 = Int32Array.from(Q0); this.eq1 = Int32Array.from(Q1);
    this.ed0 = Int32Array.from(D0); this.ed1 = Int32Array.from(D1);
    this.L = new Float32Array(m); this.alpha = new Float32Array(m); this.lambda = new Float32Array(m);
    this.alive = new Uint8Array(m);
    this.quadAlive = new Uint8Array((nx - 1) * (ny - 1));
    this.restArea = new Float32Array(n);
    // Two triangles per quad, alternating the diagonal so the drape is not
    // biased to one side.
    this.allTris = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let t = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
      if ((i + j) & 1) { this.allTris.set([a, c, b, b, c, d], t); }
      else { this.allTris.set([a, c, d, a, d, b], t); }
      t += 6;
    }
    // Self contact pairs: CSR lists, rebuilt each frame.
    this.cMax = 24;
    this.cCount = new Uint16Array(n); this.cList = new Int32Array(n * this.cMax);
    this.hashSize = 2 * n + 1; this.cellStart = new Int32Array(this.hashSize + 1); this.cellItems = new Int32Array(n);
    this.surf = { nrm: new Float32Array(3 * n), tan: new Float32Array(3 * n), ratio: new Float32Array(n) };
  }

  setFabric(f) {
    this.fabric = f;
    const h = this.h;
    // particle mass: the cloth area shared over the particles
    const area = this.size[0] * this.size[1];
    this.mass = f.density * area / this.n;
    for (let e = 0; e < this.m; e++) {
      const k = this.kind[e] === STRETCH ? f.stretch : this.kind[e] === SHEAR ? f.shear : f.bend / (h * h);
      this.alpha[e] = 1 / k;
    }
    for (let i = 0; i < this.n; i++) this.w[i] = this.pin[i] ? 0 : 1 / this.mass;
  }

  // Rest layout, all edges alive, no pins, zero velocity.
  reset(opts = {}) {
    const { nx, ny } = this;
    const [W, H] = this.size, [cx, cy, cz] = this.center;
    const tilt = opts.tilt || 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, u = i / (nx - 1) - 0.5, s = j / (ny - 1) - 0.5;
      let X, Y, Z;
      if (this.plane === 'xy') { X = cx + u * W; Y = cy - (s + 0.5) * H; Z = cz + tilt * Math.sin(u * 7.3 + s * 3.1) * 0.01; }
      else { X = cx + u * W; Y = cy + tilt * s * H; Z = cz + s * H; }
      this.x[3 * k] = this.rest[3 * k] = X; this.x[3 * k + 1] = this.rest[3 * k + 1] = Y; this.x[3 * k + 2] = this.rest[3 * k + 2] = Z;
    }
    this.p.set(this.x); this.v.fill(0);
    this.pin.fill(0);
    for (let e = 0; e < this.m; e++) {
      const a = this.ea[e], b = this.eb[e];
      this.L[e] = Math.hypot(this.x[3 * a] - this.x[3 * b], this.x[3 * a + 1] - this.x[3 * b + 1], this.x[3 * a + 2] - this.x[3 * b + 2]);
    }
    this.alive.fill(1); this.quadAlive.fill(1); this.torn = true;
    this.grab = null;
    this.setFabric(this.fabric);
    this._restAreas();
  }

  _restAreas() {
    this.restArea.fill(0);
    this._areas(this.restArea, this.rest);
  }

  // Area of the live triangles around each particle (1/3 of each).
  _areas(out, X) {
    const T = this.allTris, q = this.quadAlive;
    for (let t = 0; t < T.length; t += 3) {
      if (!q[(t / 6) | 0]) continue;
      const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
      const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3;
      out[T[t]] += ar; out[T[t + 1]] += ar; out[T[t + 2]] += ar;
    }
  }

  // ── pins ─────────────────────────────────────────────────────────────────
  setPin(k, on, at) {
    this.pin[k] = on ? 1 : 0;
    if (on) { const s = at || this.x; const o = at ? 0 : 3 * k; this.pinAt[3 * k] = s[o]; this.pinAt[3 * k + 1] = s[o + 1]; this.pinAt[3 * k + 2] = s[o + 2]; }
    this.w[k] = on ? 0 : 1 / this.mass;
  }
  clearPins() { for (let k = 0; k < this.n; k++) if (this.pin[k]) this.setPin(k, false); }
  nearest(x, y, z) {
    let best = -1, bd = Infinity;
    for (let k = 0; k < this.n; k++) {
      const d = (this.x[3 * k] - x) ** 2 + (this.x[3 * k + 1] - y) ** 2 + (this.x[3 * k + 2] - z) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  // ── grab: the particles near a point move rigidly with a target ─────────
  grabStart(x, y, z, radius = 0.05) {
    const ids = [], off = [];
    for (let k = 0; k < this.n; k++) {
      const dx = this.x[3 * k] - x, dy = this.x[3 * k + 1] - y, dz = this.x[3 * k + 2] - z;
      if (dx * dx + dy * dy + dz * dz < radius * radius && !this.pin[k]) { ids.push(k); off.push(dx, dy, dz); }
    }
    if (!ids.length) { const k = this.nearest(x, y, z); if (k >= 0 && !this.pin[k]) { ids.push(k); off.push(this.x[3 * k] - x, this.x[3 * k + 1] - y, this.x[3 * k + 2] - z); } }
    this.grab = { ids, off, from: [x, y, z], to: [x, y, z] };
    return ids.length;
  }
  grabMove(x, y, z) { if (this.grab) this.grab.to = [x, y, z]; }
  grabEnd() { this.grab = null; }

  // ── cut: break stretch edges near a point ───────────────────────────────
  cut(x, y, z, radius) {
    const r2 = (radius || this.h * 0.75) ** 2; let hit = 0;
    for (let e = 0; e < this.m; e++) {
      if (this.kind[e] !== STRETCH || !this.alive[e]) continue;
      const a = 3 * this.ea[e], b = 3 * this.eb[e];
      const mx = 0.5 * (this.x[a] + this.x[b]) - x, my = 0.5 * (this.x[a + 1] + this.x[b + 1]) - y, mz = 0.5 * (this.x[a + 2] + this.x[b + 2]) - z;
      if (mx * mx + my * my + mz * mz < r2) { this._break(e); hit++; }
    }
    return hit;
  }
  _break(e) {
    this.alive[e] = 0;
    for (const q of [this.eq0[e], this.eq1[e]]) if (q >= 0 && this.quadAlive[q]) this.quadAlive[q] = 0;
    this.torn = true;
  }
  // The live triangle list (rebuilt only after a tear).
  triangles() {
    const out = []; const T = this.allTris;
    for (let q = 0; q < this.quadAlive.length; q++) if (this.quadAlive[q]) for (let s = 0; s < 6; s++) out.push(T[6 * q + s]);
    this.torn = false;
    return Uint32Array.from(out);
  }

  // ── wind: pressure on each live triangle ───────────────────────────────
  // The air velocity is a mean flow plus a smooth swirl. Each triangle gets
  // F = 1/2 rho Cd A (u_rel . n)|u_rel . n| n, shared to its three corners.
  windAt(x, y, z, t, out) {
    const W = this.wind, s = W.speed, d = W.dir, q = W.turb;
    // Three travelling sine swirls, out of phase on each axis.
    const a = Math.sin(1.7 * x + 0.9 * t + 2.1 * Math.sin(0.8 * z - 0.4 * t));
    const b = Math.sin(2.3 * z - 1.3 * t + 1.7 * Math.sin(1.1 * y + 0.5 * t));
    const c = Math.sin(1.9 * y + 1.1 * t + 1.3 * Math.sin(0.9 * x - 0.7 * t));
    out[0] = s * (d[0] * (1 + 0.6 * q * a)) + 1.6 * q * b;
    out[1] = s * (d[1] * (1 + 0.6 * q * b)) + 1.2 * q * c;
    out[2] = s * (d[2] * (1 + 0.6 * q * c)) + 1.6 * q * a;
    return out;
  }
  windAccel() {
    const A = this.a, X = this.x, V = this.v, T = this.allTris, q = this.quadAlive;
    A.fill(0);
    const W = this.wind; if (W.speed <= 0 && W.turb <= 0) return;
    const rho = 1.2, cd = 1.2 * (this.fabric.drag ?? 1), u = [0, 0, 0];
    for (let t = 0; t < T.length; t += 3) {
      if (!q[(t / 6) | 0]) continue;
      const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
      const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const n2 = Math.hypot(nx, ny, nz); if (n2 < 1e-12) continue;
      const area = 0.5 * n2; nx /= n2; ny /= n2; nz /= n2;
      const cx = (X[a] + X[b] + X[c]) / 3, cy = (X[a + 1] + X[b + 1] + X[c + 1]) / 3, cz = (X[a + 2] + X[b + 2] + X[c + 2]) / 3;
      this.windAt(cx, cy, cz, W.t, u);
      const rx = u[0] - (V[a] + V[b] + V[c]) / 3, ry = u[1] - (V[a + 1] + V[b + 1] + V[c + 1]) / 3, rz = u[2] - (V[a + 2] + V[b + 2] + V[c + 2]) / 3;
      const un = rx * nx + ry * ny + rz * nz;
      const f = 0.5 * rho * cd * area * un * Math.abs(un) / 3;
      A[a] += f * nx; A[a + 1] += f * ny; A[a + 2] += f * nz;
      A[b] += f * nx; A[b + 1] += f * ny; A[b + 2] += f * nz;
      A[c] += f * nx; A[c + 1] += f * ny; A[c + 2] += f * nz;
    }
    const im = 1 / this.mass;
    for (let i = 0; i < A.length; i++) A[i] *= im;
  }

  // ── self contact: spatial hash, once per frame ─────────────────────────
  _cell(x, y, z, s) {
    const i = Math.floor(x / s), j = Math.floor(y / s), k = Math.floor(z / s);
    return Math.abs((i * 92837111) ^ (j * 689287499) ^ (k * 283923481)) % this.hashSize;
  }
  buildContacts(margin) {
    const n = this.n, X = this.x, s = this.thick + margin, H = this.hashSize;
    const start = this.cellStart, items = this.cellItems, cell = new Int32Array(n);
    start.fill(0);
    for (let k = 0; k < n; k++) { cell[k] = this._cell(X[3 * k], X[3 * k + 1], X[3 * k + 2], s); start[cell[k]]++; }
    let acc = 0; for (let c = 0; c <= H; c++) { acc += start[c] || 0; start[c] = acc; }
    for (let k = 0; k < n; k++) items[--start[cell[k]]] = k;
    const r2 = s * s, nx = this.nx, cM = this.cMax;
    this.cCount.fill(0);
    for (let k = 0; k < n; k++) {
      const x = X[3 * k], y = X[3 * k + 1], z = X[3 * k + 2];
      const ik = k % nx, jk = (k / nx) | 0;
      const ci = Math.floor(x / s), cj = Math.floor(y / s), ck = Math.floor(z / s);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const h = Math.abs(((ci + a) * 92837111) ^ ((cj + b) * 689287499) ^ ((ck + c) * 283923481)) % H;
        for (let q = start[h]; q < start[h + 1]; q++) {
          const o = items[q]; if (o <= k) continue;
          // grid neighbours closer than two cells are held by the edges
          const di = Math.abs(o % nx - ik), dj = Math.abs(((o / nx) | 0) - jk);
          if (di <= 1 && dj <= 1) continue;
          const dx = X[3 * o] - x, dy = X[3 * o + 1] - y, dz = X[3 * o + 2] - z;
          if (dx * dx + dy * dy + dz * dz < r2 && this.cCount[k] < cM) this.cList[k * cM + this.cCount[k]++] = o;
        }
      }
    }
  }
  _selfContact() {
    const X = this.x, W = this.w, t = this.thick, cM = this.cMax;
    for (let k = 0; k < this.n; k++) {
      const c = this.cCount[k];
      for (let q = 0; q < c; q++) {
        const o = this.cList[k * cM + q];
        const dx = X[3 * o] - X[3 * k], dy = X[3 * o + 1] - X[3 * k + 1], dz = X[3 * o + 2] - X[3 * k + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= t * t || d2 < 1e-14) continue;
        const ws = W[k] + W[o]; if (ws === 0) continue;
        const d = Math.sqrt(d2), s = (t - d) / (d * ws);
        X[3 * k] -= dx * s * W[k]; X[3 * k + 1] -= dy * s * W[k]; X[3 * k + 2] -= dz * s * W[k];
        X[3 * o] += dx * s * W[o]; X[3 * o + 1] += dy * s * W[o]; X[3 * o + 2] += dz * s * W[o];
      }
    }
  }

  // ── XPBD distance constraints: one Gauss-Seidel sweep ─────────────────
  solveEdges(dt) {
    const X = this.x, W = this.w, L = this.L, al = this.alpha, lam = this.lambda, ea = this.ea, eb = this.eb, alive = this.alive, kind = this.kind;
    const tearing = this.tearing, tear = this.fabric.tear, idt2 = 1 / (dt * dt);
    for (let e = 0; e < this.m; e++) {
      if (!alive[e]) continue;
      if (kind[e] === BEND && (!alive[this.ed0[e]] || !alive[this.ed1[e]])) continue;
      if (kind[e] === SHEAR && !this.quadAlive[this.eq0[e]]) continue;
      const a = ea[e], b = eb[e], wa = W[a], wb = W[b], ws = wa + wb;
      if (ws === 0) continue;
      const ia = 3 * a, ib = 3 * b;
      const dx = X[ia] - X[ib], dy = X[ia + 1] - X[ib + 1], dz = X[ia + 2] - X[ib + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-12) continue;
      const C = d - L[e];
      if (tearing && kind[e] === STRETCH && C > tear * L[e]) { this._break(e); continue; }
      const at = al[e] * idt2;
      const dl = (-C - at * lam[e]) / (ws + at);
      lam[e] += dl;
      const s = dl / d;
      X[ia] += dx * s * wa; X[ia + 1] += dy * s * wa; X[ia + 2] += dz * s * wa;
      X[ib] -= dx * s * wb; X[ib + 1] -= dy * s * wb; X[ib + 2] -= dz * s * wb;
    }
  }

  // ── colliders and floor: projection plus friction ──────────────────────
  collide() {
    const X = this.x, o = this._o, mu = this.fabric.friction, skin = this.skin, fl = this.floor;
    for (let k = 0; k < this.n; k++) {
      if (this.w[k] === 0) continue;
      const i = 3 * k;
      for (const c of this.colliders) {
        sdf(c, X[i], X[i + 1], X[i + 2], o);
        const pen = skin - o[3];
        if (pen > 0) {
          X[i] += o[0] * pen; X[i + 1] += o[1] * pen; X[i + 2] += o[2] * pen;
          this._friction(i, o[0], o[1], o[2], mu, pen);
        }
      }
      if (X[i + 1] < fl + skin) {
        const pen = fl + skin - X[i + 1];
        X[i + 1] = fl + skin;
        this._friction(i, 0, 1, 0, mu, pen);
      }
    }
  }
  // Coulomb-like: the tangential travel this substep is cut by up to mu
  // times the normal correction (static when it is all cut).
  _friction(i, nx, ny, nz, mu, pen) {
    const X = this.x, P = this.p;
    const dx = X[i] - P[i], dy = X[i + 1] - P[i + 1], dz = X[i + 2] - P[i + 2];
    const dn = dx * nx + dy * ny + dz * nz;
    const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz;
    const tl = Math.hypot(tx, ty, tz); if (tl < 1e-12) return;
    const f = Math.min(1, mu * (pen + 2e-4) / tl * 4);
    X[i] -= tx * f; X[i + 1] -= ty * f; X[i + 2] -= tz * f;
  }

  _pins() {
    for (let k = 0; k < this.n; k++) if (this.pin[k]) { const i = 3 * k; this.x[i] = this.pinAt[i]; this.x[i + 1] = this.pinAt[i + 1]; this.x[i + 2] = this.pinAt[i + 2]; }
  }

  // ── one frame ─────────────────────────────────────────────────────────
  step(dt, substeps = this.substeps, iterations = this.iterations) {
    const n = this.n, X = this.x, P = this.p, V = this.v, A = this.a, W = this.w, g = this.gravity;
    const h = dt / substeps, damp = Math.max(0, 1 - this.fabric.damping * h);
    this.windAccel();
    if (this.selfContact) this.buildContacts(Math.min(0.08, 2 * dt * this._maxSpeed() + 0.002));
    const G = this.grab;
    for (const k of (G ? G.ids : [])) this.w[k] = 0;
    for (let s = 0; s < substeps; s++) {
      for (let k = 0; k < n; k++) {
        const i = 3 * k;
        P[i] = X[i]; P[i + 1] = X[i + 1]; P[i + 2] = X[i + 2];
        if (W[k] === 0) continue;
        V[i] += h * A[i]; V[i + 1] += h * (g + A[i + 1]); V[i + 2] += h * A[i + 2];
        X[i] += h * V[i]; X[i + 1] += h * V[i + 1]; X[i + 2] += h * V[i + 2];
      }
      if (G) {
        const f = (s + 1) / substeps;
        for (let q = 0; q < G.ids.length; q++) {
          const i = 3 * G.ids[q];
          for (let c = 0; c < 3; c++) X[i + c] = G.from[c] + (G.to[c] - G.from[c]) * f + G.off[3 * q + c];
        }
      }
      this._pins();
      this.lambda.fill(0);
      for (let it = 0; it < iterations; it++) this.solveEdges(h);
      if (this.selfContact) this._selfContact();
      this.collide();
      this._pins();
      for (let i = 0; i < 3 * n; i++) V[i] = (X[i] - P[i]) / h * damp;
    }
    if (G) { G.from = G.to.slice(); for (const k of G.ids) this.w[k] = this.pin[k] ? 0 : 1 / this.mass; }
    this.wind.t += dt;
  }
  _maxSpeed() { let m = 0; const V = this.v; for (let i = 0; i < V.length; i += 3) m = Math.max(m, V[i] * V[i] + V[i + 1] * V[i + 1] + V[i + 2] * V[i + 2]); return Math.sqrt(m); }

  // ── shading data for the renderer ─────────────────────────────────────
  // nrm: area-weighted vertex normals. tan: the grid u direction (the weave
  // and the brushing axis). ratio: live area / rest area per particle, the
  // input to the film thinning in the shader.
  surface() {
    const { nrm, tan, ratio } = this.surf, X = this.x, T = this.allTris, q = this.quadAlive, nx = this.nx;
    nrm.fill(0);
    for (let t = 0; t < T.length; t += 3) {
      if (!q[(t / 6) | 0]) continue;
      const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
      const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      nrm[a] += cx; nrm[a + 1] += cy; nrm[a + 2] += cz;
      nrm[b] += cx; nrm[b + 1] += cy; nrm[b + 2] += cz;
      nrm[c] += cx; nrm[c + 1] += cy; nrm[c + 2] += cz;
    }
    for (let k = 0; k < this.n; k++) {
      const i = 3 * k, l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
      const ii = k % nx, a = 3 * (ii < nx - 1 ? k + 1 : k), b = 3 * (ii > 0 ? k - 1 : k);
      let tx = X[a] - X[b], ty = X[a + 1] - X[b + 1], tz = X[a + 2] - X[b + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tan[i] = tx / tl; tan[i + 1] = ty / tl; tan[i + 2] = tz / tl;
    }
    ratio.fill(0); this._areas(ratio, X);
    for (let k = 0; k < this.n; k++) ratio[k] = this.restArea[k] > 0 ? ratio[k] / this.restArea[k] : 1;
    return this.surf;
  }

  // ── diagnostics ───────────────────────────────────────────────────────
  // energy: kinetic + gravitational + elastic (1/2 k C^2 on each live edge)
  energy() {
    let ke = 0, pe = 0, ee = 0; const X = this.x, V = this.v, m = this.mass, g = -this.gravity;
    for (let k = 0; k < this.n; k++) {
      if (this.pin[k]) continue;
      const i = 3 * k;
      ke += 0.5 * m * (V[i] * V[i] + V[i + 1] * V[i + 1] + V[i + 2] * V[i + 2]);
      pe += m * g * X[i + 1];
    }
    for (let e = 0; e < this.m; e++) {
      if (!this.alive[e]) continue;
      const a = 3 * this.ea[e], b = 3 * this.eb[e];
      const C = Math.hypot(X[a] - X[b], X[a + 1] - X[b + 1], X[a + 2] - X[b + 2]) - this.L[e];
      ee += 0.5 * C * C / this.alpha[e];
    }
    return { ke, pe, ee, total: ke + pe + ee };
  }
  // RMS relative error of one constraint family (0 stretch, 1 shear, 2 bend)
  error(kind = STRETCH) {
    let s = 0, c = 0; const X = this.x;
    for (let e = 0; e < this.m; e++) {
      if (this.kind[e] !== kind || !this.alive[e]) continue;
      const a = 3 * this.ea[e], b = 3 * this.eb[e];
      const C = Math.hypot(X[a] - X[b], X[a + 1] - X[b + 1], X[a + 2] - X[b + 2]) - this.L[e];
      s += (C / this.L[e]) ** 2; c++;
    }
    return Math.sqrt(s / Math.max(1, c));
  }
}
