// ============================================================================
//  CHLADNI PLATE  ·  solver.js — bending modes of a thin plate (worker)
// ----------------------------------------------------------------------------
//  The page runs this file as a Web Worker. It also works as a classic
//  script (self.CSolver.solve), which the page uses only if no worker
//  starts, and which tests.mjs loads in Node.
//
//  The model is a Kirchhoff plate. The modes solve
//      K w = lambda M w        (the discrete form of D grad^4 w = rho h w^2 w)
//  on the grid nodes inside the outline. K comes from the bending energy
//      U = 1/2 sum [cxx wxx^2 + 2 c12 wxx wyy + cyy wyy^2 + 4 c66 wxy^2]
//  with second differences at nodes (wxx, wyy) and at cells (wxy). A free
//  edge is the natural boundary condition of this energy: a difference
//  stencil that leaves the plate is not used. A clamped edge keeps every
//  stencil on a plate node, with w = 0 on the nodes outside. A hole is
//  always a free edge. M is the lumped mass, 1 per node, with h = 1.
//  An arched wood plate (req.arch) scales the terms of each node by the
//  arch factors of archProfile.
//
//  Shift-invert Lanczos gives the lowest modes. K + sI is factored once
//  (band Cholesky). Full reorthogonalization keeps the Lanczos vectors
//  clean, and the three rigid-body modes of a free plate (lambda = 0) are
//  projected out of every vector.
//
//  Frequency: lambda is in grid units. The page converts it with
//      omega^2 = lambda * Dref / (rho t h^4)      (h, t in m)
//
//  grep -n targets
//    grid and mask ..... "function buildGrid"
//    stiffness terms ... "function forEachTerm"
//    arch factors ...... "function archProfile"
//    band Cholesky ..... "function cholBand"
//    Lanczos ........... "function lanczos"
//    Jacobi ............ "function jacobi"
//    mode analysis ..... "function analyse"
//    worker entry ...... "onmessage"
// ============================================================================
(function (root) {
'use strict';
if (typeof root.CPlates === 'undefined' && typeof importScripts === 'function') importScripts('plates.js');
const P = root.CPlates;

// Grid of nodes over the bbox. status: 0 rim outside, 1 plate, 2 hole.
function buildGrid(req) {
  const geo = P.geometry(req.shape), [bx0, by0, bx1, by1] = geo.bbox;
  const h = Math.sqrt(geo.area / req.nodes);
  const nx = Math.ceil((bx1 - bx0) / h) + 5, ny = Math.ceil((by1 - by0) / h) + 5;
  const x0 = (bx0 + bx1) / 2 - (nx - 1) / 2 * h, y0 = (by0 + by1) / 2 - (ny - 1) / 2 * h;
  const N = nx * ny, st = new Uint8Array(N), brace = new Uint8Array(N);
  const B = P.braces(req.shape, req.bracing);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * h, y = y0 + j * h, g = j * nx + i;
    st[g] = P.inside(geo, x, y);
    if (st[g] === 1 && B.length && P.onBrace(B, x, y)) brace[g] = 1;
  }
  const on = g => st[g] === 1;
  // A free plate node must sit in one x stencil, one y stencil and one
  // cell. A node that does not adds a mode with no stiffness.
  if (req.bc === 'free') {
    for (let pass = 0, changed = true; changed && pass < 50; pass++) {
      changed = false;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const g = j * nx + i; if (!on(g)) continue;
        const I = (a, b) => a >= 0 && a < nx && b >= 0 && b < ny && on(b * nx + a);
        const okx = (I(i - 1, j) && I(i + 1, j)) || (I(i - 1, j) && I(i - 2, j)) || (I(i + 1, j) && I(i + 2, j));
        const oky = (I(i, j - 1) && I(i, j + 1)) || (I(i, j - 1) && I(i, j - 2)) || (I(i, j + 1) && I(i, j + 2));
        let okc = false;
        for (let dy = -1; dy <= 0 && !okc; dy++) for (let dx = -1; dx <= 0 && !okc; dx++)
          okc = I(i + dx, j + dy) && I(i + dx + 1, j + dy) && I(i + dx, j + dy + 1) && I(i + dx + 1, j + dy + 1);
        if (!(okx && oky && okc)) { st[g] = 2; changed = true; }
      }
    }
  }
  // Keep the largest 4-connected part.
  const comp = new Int32Array(N).fill(-1); let best = -1, bestN = 0, nc = 0;
  const stack = [];
  for (let g = 0; g < N; g++) {
    if (!on(g) || comp[g] >= 0) continue;
    let cnt = 0; stack.push(g); comp[g] = nc;
    while (stack.length) {
      const q = stack.pop(); cnt++;
      const i = q % nx, j = (q / nx) | 0;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || a >= nx || b < 0 || b >= ny) continue;
        const r = b * nx + a; if (on(r) && comp[r] < 0) { comp[r] = nc; stack.push(r); }
      }
    }
    if (cnt > bestN) { bestN = cnt; best = nc; }
    nc++;
  }
  for (let g = 0; g < N; g++) if (on(g) && comp[g] !== best) st[g] = 2;
  // Unknown order: rows along the short side, so the band is narrow.
  const idx = new Int32Array(N).fill(-1); let n = 0;
  const rowsAlongX = nx <= ny;
  if (rowsAlongX) { for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const g = j * nx + i; if (on(g)) idx[g] = n++; } }
  else { for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const g = j * nx + i; if (on(g)) idx[g] = n++; } }
  const gOf = new Int32Array(n);
  for (let g = 0; g < N; g++) if (idx[g] >= 0) gOf[idx[g]] = g;
  return { geo, h, nx, ny, x0, y0, st, brace, idx, gOf, n };
}

// Call cb(list of [unknown, coef] pairs, weight) for each energy term.
// The term adds weight * (sum coef w)^2 / 2 to U, so K += weight * g g^T.
// For the node term with both stencils, cb2 gets the two stencils.
function forEachTerm(G, c, req, cb1, cb2) {
  const { nx, ny, st, idx, brace } = G, free = req.bc === 'free', BR = req.braceGain || 14, AR = G.arch;
  const S = (i, j) => (i < 0 || i >= nx || j < 0 || j >= ny) ? 0 : st[j * nx + i];
  // A stencil node: an unknown index, -1 for a zero node (clamped rim),
  // or null when the stencil may not be used.
  const node = (i, j) => {
    const s = S(i, j);
    if (s === 1) return idx[j * nx + i];
    if (free || s === 2) return null;
    return -1;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const g = j * nx + i; if (st[g] !== 1) continue;
    const m = brace[g] ? BR : 1;
    const Fx = AR ? AR.fx[g] : 1, Fy = AR ? AR.fy[g] : 1;
    const ax = [node(i - 1, j), idx[g], node(i + 1, j)];
    const ay = [node(i, j - 1), idx[g], node(i, j + 1)];
    const hasX = ax[0] !== null && ax[2] !== null, hasY = ay[0] !== null && ay[2] !== null;
    const sx = hasX ? [[ax[0], 1], [ax[1], -2], [ax[2], 1]].filter(p => p[0] >= 0) : null;
    const sy = hasY ? [[ay[0], 1], [ay[1], -2], [ay[2], 1]].filter(p => p[0] >= 0) : null;
    if (sx) cb1(sx, m * Fx * c.cxx);
    if (sy) cb1(sy, m * Fy * c.cyy);
    if (sx && sy) cb2(sx, sy, m * Math.sqrt(Fx * Fy) * c.c12);
  }
  for (let j = -1; j < ny; j++) for (let i = -1; i < nx; i++) {
    const q = [node(i, j), node(i + 1, j), node(i, j + 1), node(i + 1, j + 1)];
    if (q.some(v => v === null) || q.every(v => v < 0)) continue;
    let m = 1, ft = 0, nf = 0;
    for (const [a, b] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
      if (a < 0 || a >= nx || b < 0 || b >= ny) continue;
      if (brace[b * nx + a]) m = BR;
      if (AR && st[b * nx + a] === 1) { ft += AR.ft[b * nx + a]; nf++; }
    }
    if (nf) m *= ft / nf;
    const s = [[q[0], 1], [q[1], -1], [q[2], -1], [q[3], 1]].filter(p => p[0] >= 0);
    cb1(s, m * 4 * c.c66);
  }
}

// Assemble K + sI in upper band storage: A[p*(b+1) + (q-p)], q >= p.
function assemble(G, c, req, s) {
  let b = 0;
  const span = list => { for (const [p] of list) for (const [q] of list) b = Math.max(b, Math.abs(p - q)); };
  forEachTerm(G, c, req, l => span(l), (l1, l2) => span(l1.concat(l2)));
  const W = b + 1, A = new Float64Array(G.n * W);
  const add = (p, q, v) => { if (p > q) { const t = p; p = q; q = t; } A[p * W + (q - p)] += v; };
  forEachTerm(G, c, req,
    (l, w) => { for (let u = 0; u < l.length; u++) for (let v = u; v < l.length; v++) add(l[u][0], l[v][0], (u === v ? 1 : 1) * w * l[u][1] * l[v][1]); },
    (l1, l2, w) => { for (const [p, a] of l1) for (const [q, bb] of l2) { const v = w * a * bb; if (p === q) add(p, q, 2 * v); else add(p, q, v); } });
  for (let p = 0; p < G.n; p++) A[p * W] += s;
  return { A, b, W };
}
// Note on assemble: the u < v loop adds each off-diagonal pair once into the
// upper band, which is K[p][q] for the symmetric matrix. The cross term
// c12 (a b^T + b a^T) adds a_p b_q + b_p a_q; for p != q each ordered pair
// lands on the same upper entry, so both orders are added, and a shared
// node (p == q) gets 2 a_p b_p.

// In-place band Cholesky A = U^T U, U in the same storage.
function cholBand(K) {
  const { A, b, W } = K, n = A.length / W;
  for (let i = 0; i < n; i++) {
    for (let j = i; j <= Math.min(n - 1, i + b); j++) {
      let s = A[i * W + (j - i)];
      for (let k = Math.max(0, j - b); k < i; k++) s -= A[k * W + (i - k)] * A[k * W + (j - k)];
      if (j === i) {
        if (!(s > 0)) throw new Error('matrix not positive definite at ' + i);
        A[i * W] = Math.sqrt(s);
      } else A[i * W + (j - i)] = s / A[i * W];
    }
  }
}
function cholSolve(K, r, x) {
  const A = K.A, b = K.b, W = K.W, n = r.length;
  // U^T y = r, by rows of U (contiguous reads)
  for (let i = 0; i < n; i++) x[i] = r[i];
  for (let i = 0; i < n; i++) {
    const o = i * W, yi = (x[i] /= A[o]), e = Math.min(n - 1 - i, b);
    for (let d = 1; d <= e; d++) x[i + d] -= A[o + d] * yi;
  }
  // U x = y
  for (let i = n - 1; i >= 0; i--) {
    const o = i * W, e = Math.min(n - 1 - i, b);
    let s = x[i];
    for (let d = 1; d <= e; d++) s -= A[o + d] * x[i + d];
    x[i] = s / A[o];
  }
}

// Cyclic Jacobi for a small dense symmetric matrix (row major, m x m).
function jacobi(A, m) {
  const V = new Float64Array(m * m);
  for (let i = 0; i < m; i++) V[i * m + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) off += A[p * m + q] * A[p * m + q];
    if (off < 1e-30) break;
    for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) {
      const apq = A[p * m + q];
      if (Math.abs(apq) < 1e-300) continue;
      const th = (A[q * m + q] - A[p * m + p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < m; k++) {
        const akp = A[k * m + p], akq = A[k * m + q];
        A[k * m + p] = cs * akp - sn * akq; A[k * m + q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < m; k++) {
        const apk = A[p * m + k], aqk = A[q * m + k];
        A[p * m + k] = cs * apk - sn * aqk; A[q * m + k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < m; k++) {
        const vkp = V[k * m + p], vkq = V[k * m + q];
        V[k * m + p] = cs * vkp - sn * vkq; V[k * m + q] = sn * vkp + cs * vkq;
      }
    }
  }
  const vals = new Float64Array(m);
  for (let i = 0; i < m; i++) vals[i] = A[i * m + i];
  return { vals, V };
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// Shift-invert Lanczos on (K + sI)^-1, deflated by the rigid modes R.
function lanczos(K, n, R, k, m, s, seed) {
  m = Math.min(m, n - R.length - 1);
  const Q = new Float64Array((m + 1) * n), alpha = new Float64Array(m), beta = new Float64Array(m);
  let rs = seed >>> 0 || 1;
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296 - 0.5; };
  const z = new Float64Array(n), q = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = rnd();
  const deflate = v => { for (const r of R) { const a = dot(v, r); for (let i = 0; i < n; i++) v[i] -= a * r[i]; } };
  const orth = (v, upto) => {
    for (let pass = 0; pass < 2; pass++) {
      deflate(v);
      for (let j = 0; j < upto; j++) {
        const qj = Q.subarray(j * n, j * n + n), a = dot(v, qj);
        for (let i = 0; i < n; i++) v[i] -= a * qj[i];
      }
    }
  };
  orth(z, 0);
  let nz = Math.sqrt(dot(z, z));
  for (let i = 0; i < n; i++) Q[i] = z[i] / nz;
  let steps = m;
  for (let j = 0; j < m; j++) {
    const qj = Q.subarray(j * n, j * n + n);
    q.set(qj);
    cholSolve(K, q, z);
    alpha[j] = dot(z, qj);
    orth(z, j + 1);
    nz = Math.sqrt(dot(z, z));
    beta[j] = nz;
    if (nz < 1e-12 * Math.abs(alpha[j])) { steps = j + 1; break; }
    const qn = Q.subarray((j + 1) * n, (j + 2) * n);
    for (let i = 0; i < n; i++) qn[i] = z[i] / nz;
  }
  const T = new Float64Array(steps * steps);
  for (let j = 0; j < steps; j++) {
    T[j * steps + j] = alpha[j];
    if (j + 1 < steps) T[j * steps + j + 1] = T[(j + 1) * steps + j] = beta[j];
  }
  const E = jacobi(T, steps);
  const order = Array.from({ length: steps }, (_, i) => i).sort((a, b) => E.vals[b] - E.vals[a]);
  const out = [];
  for (const c of order.slice(0, k)) {
    const th = E.vals[c], v = new Float64Array(n);
    for (let j = 0; j < steps; j++) {
      const y = E.V[j * steps + c]; if (!y) continue;
      const qj = Q.subarray(j * n, j * n + n);
      for (let i = 0; i < n; i++) v[i] += y * qj[i];
    }
    const resid = Math.abs(beta[steps - 1] * E.V[(steps - 1) * steps + c]) / Math.abs(th);
    out.push({ lambda: 1 / th - s, vec: v, resid });
  }
  return out;
}

// For each grid point, the nearest plate node (BFS), so a field can be
// read slightly outside the plate with no false zero at the edge.
function nearestFill(G) {
  const { nx, ny, idx } = G, N = nx * ny, fill = new Int32Array(N).fill(-1), qu = new Int32Array(N);
  let h = 0, t = 0;
  for (let g = 0; g < N; g++) if (idx[g] >= 0) { fill[g] = idx[g]; qu[t++] = g; }
  while (h < t) {
    const g = qu[h++], i = g % nx, j = (g / nx) | 0;
    for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      if (a < 0 || a >= nx || b < 0 || b >= ny) continue;
      const r = b * nx + a; if (fill[r] < 0) { fill[r] = fill[g]; qu[t++] = r; }
    }
  }
  return fill;
}

// Bilinear read of a mode at body point (x, y), through the fill map.
function sampler(G, fill) {
  return (phi, x, y) => {
    const fx = (x - G.x0) / G.h, fy = (y - G.y0) / G.h;
    const i = Math.max(0, Math.min(G.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(G.ny - 2, Math.floor(fy)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
    const a = phi[fill[j * G.nx + i]], b = phi[fill[j * G.nx + i + 1]];
    const c = phi[fill[(j + 1) * G.nx + i]], d = phi[fill[(j + 1) * G.nx + i + 1]];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

// A closed loop of sample points just inside the plate: the outline moved
// in by d, and a ring just outside each hole. The thin f-holes are left out
// (keepF false): a line that crosses an f-hole is still one line.
function boundaryLoops(geo, d, keepF) {
  const loops = [], O = geo.outline;
  let sa = 0;
  for (let i = 0, j = O.length - 1; i < O.length; j = i++) sa += (O[j][0] - O[i][0]) * (O[j][1] + O[i][1]);
  const sgn = sa > 0 ? 1 : -1, L = [];
  for (let i = 0; i < O.length; i++) {
    const a = O[(i - 1 + O.length) % O.length], b = O[(i + 1) % O.length];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    L.push([O[i][0] - sgn * ty * d, O[i][1] + sgn * tx * d]);
  }
  loops.push(L.filter(p => P.inside(geo, p[0], p[1]) === 1));
  for (const h of geo.holes) {
    if (h.kind === 'circle') {
      const r = h.r + d, R = [];
      for (let k = 0; k < 160; k++) { const a = 2 * Math.PI * k / 160; R.push([h.c[0] + r * Math.cos(a), h.c[1] + r * Math.sin(a)]); }
      loops.push(R);
    } else if (h.kind === 'f' && keepF) {
      const S = h.f.stem, A = [], B = [];
      for (let k = 0; k < S.length; k++) {
        const a = S[Math.max(0, k - 1)], b = S[Math.min(S.length - 1, k + 1)];
        let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        const r = Math.max(h.f.w, k === 0 ? h.f.eyes[0][2] : k === S.length - 1 ? h.f.eyes[1][2] : h.f.w) + d;
        A.push([S[k][0] - ty * r, S[k][1] + tx * r]); B.push([S[k][0] + ty * r, S[k][1] - tx * r]);
      }
      loops.push(A.concat(B.reverse()));
    }
  }
  // Resample each loop to steps of about d / 3, so no crossing is missed.
  return loops.map(L => {
    const R = [];
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (d / 3)));
      for (let t = 0; t < k; t++) R.push([a[0] + (b[0] - a[0]) * t / k, a[1] + (b[1] - a[1]) * t / k]);
    }
    return R;
  });
}

// Nodal analysis of one mode (values on unknowns, max |phi| = 1):
//   domains .... 4-connected regions of one sign (tiny ones dropped)
//   saddles .... cells where two nodal lines cross
//   ends ....... sign changes along the edges and the hole rims
//   lines ...... ends / 2 + loops that cross no other line (an estimate)
function analyse(G, fill, phi, loops) {
  const { nx, ny, idx } = G, N = nx * ny, tag = new Int32Array(N).fill(-1), stack = [];
  const sg = g => { const k = idx[g]; if (k < 0) return 0; const v = phi[k]; return v > 0.015 ? 1 : v < -0.015 ? -1 : 0; };
  let domains = 0, nd = 0;
  for (let g = 0; g < N; g++) {
    const s = sg(g); if (!s || tag[g] >= 0) continue;
    let cnt = 0; tag[g] = nd; stack.push(g);
    while (stack.length) {
      const q = stack.pop(); cnt++;
      const i = q % nx, j = (q / nx) | 0;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || a >= nx || b < 0 || b >= ny) continue;
        const r = b * nx + a; if (tag[r] < 0 && sg(r) === s) { tag[r] = nd; stack.push(r); }
      }
    }
    nd++; if (cnt >= 4) domains++;
  }
  // A crossing: the ring of 8 neighbours of a node changes sign 4 times or
  // more. The field is flat near a crossing, so several nodes near it can
  // flag it. Flags closer than 4 nodes count as one crossing.
  const raw = g => { const k = idx[g]; return k < 0 ? 0 : phi[k]; };
  const flag = new Uint8Array(N), chg = new Uint8Array(N), RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  for (let j = 1; j + 1 < ny; j++) for (let i = 1; i + 1 < nx; i++) {
    const g = j * nx + i; if (idx[g] < 0) continue;
    let ch = 0, first = 0, last = 0, ok = true;
    for (const [a, b] of RING) {
      const r = (j + b) * nx + i + a; if (idx[r] < 0) { ok = false; break; }
      const v = raw(r), sv = v > 0 ? 1 : v < 0 ? -1 : 0; if (!sv) continue;
      if (!first) first = sv; if (last && sv !== last) ch++; last = sv;
    }
    if (ok && first && last !== first) ch++;
    if (ok && ch >= 4) { flag[g] = 1; chg[g] = ch; }
  }
  // A crossing of k lines has 2k sign changes on its ring and adds k - 1
  // regions, so it counts k - 1.
  let saddles = 0;
  for (let g = 0; g < N; g++) {
    if (flag[g] !== 1) continue;
    let kmax = chg[g]; flag[g] = 2; stack.push(g);
    while (stack.length) {
      const q = stack.pop(), i = q % nx, j = (q / nx) | 0;
      kmax = Math.max(kmax, chg[q]);
      for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) {
        const ii = i + a, jj = j + b; if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
        const r = jj * nx + ii; if (flag[r] === 1) { flag[r] = 2; stack.push(r); }
      }
    }
    saddles += (kmax >> 1) - 1;
  }
  const at = sampler(G, fill);
  let ends = 0;
  for (const L of loops) {
    let last = 0, first = 0, flips = 0;
    for (const p of L) {
      const v = at(phi, p[0], p[1]), s = v > 0.03 ? 1 : v < -0.03 ? -1 : 0;
      if (!s) continue;
      if (!first) first = s;
      if (last && s !== last) flips++;
      last = s;
    }
    if (first && last && first !== last) flips++;
    ends += flips;
  }
  const chords = Math.round(ends / 2);
  const loopsFree = Math.max(0, domains - 1 - saddles - chords);
  const out = { domains, saddles, ends, lines: chords + loopsFree, rings: loopsFree };
  // A disc has the classic label (d diameters, c circles). c is the count
  // of sign changes along a ray in the middle of a sector between two
  // diameters, from the center to the rim.
  if (G.geo.id === 'circle') {
    const cx = 0, cy = 12, R = 12 - 1.3 * G.h;
    let ang = 0, best = -1;
    for (let k = 0; k < 360; k++) {
      const a = k * Math.PI / 180, v = Math.abs(at(phi, cx + R * Math.cos(a), cy + R * Math.sin(a)));
      if (v > best) { best = v; ang = a; }
    }
    let c = 0, last = 0;
    for (let k = 1; k <= 200; k++) {
      const r = R * k / 200, v = at(phi, cx + r * Math.cos(ang), cy + r * Math.sin(ang));
      const sv = v > 0.03 ? 1 : v < -0.03 ? -1 : 0; if (!sv) continue;
      if (last && sv !== last) c++; last = sv;
    }
    out.d = chords; out.c = c; out.lines = chords + c; out.rings = c;
  }
  return out;
}

// The arch factors per node (see ARCH in plates.js): a chamfer distance
// from each plate node to the outer rim, in cm, scaled to violin size.
function archProfile(G, req) {
  const { nx, ny, st } = G, N = nx * ny, d = new Float32Array(N).fill(1e9), A = P.ARCH;
  const k = (P.SHAPES[req.shape].violin || 1), e0 = A.e0 * k, e1 = A.e1 * k;
  for (let g = 0; g < N; g++) if (st[g] === 0) d[g] = 0;
  const pass = (j0, j1, dj, i0, i1, di) => {
    for (let j = j0; j !== j1; j += dj) for (let i = i0; i !== i1; i += di) {
      const g = j * nx + i; if (!d[g]) continue;
      let v = d[g];
      const a = i - di, b = j - dj;
      if (a >= 0 && a < nx) v = Math.min(v, d[j * nx + a] + 1);
      if (b >= 0 && b < ny) v = Math.min(v, d[b * nx + i] + 1);
      if (a >= 0 && a < nx && b >= 0 && b < ny) v = Math.min(v, d[b * nx + a] + 1.414);
      if (b >= 0 && b < ny && i + di >= 0 && i + di < nx) v = Math.min(v, d[b * nx + i + di] + 1.414);
      d[g] = v;
    }
  };
  pass(0, ny, 1, 0, nx, 1); pass(ny - 1, -1, -1, nx - 1, -1, -1);
  pass(0, ny, 1, nx - 1, -1, -1); pass(ny - 1, -1, -1, 0, nx, 1);
  const fx = new Float32Array(N).fill(1), fy = new Float32Array(N).fill(1), ft = new Float32Array(N).fill(1);
  for (let g = 0; g < N; g++) {
    if (st[g] !== 1) continue;
    const x = Math.min(1, Math.max(0, (d[g] * G.h - e0) / (e1 - e0))), w = x * x * (3 - 2 * x);
    fx[g] = 1 + A.x * w; fy[g] = 1 + A.y * w; ft[g] = 1 + A.t * w;
  }
  G.arch = { fx, fy, ft };
}

function solve(req) {
  const t0 = Date.now();
  const G = buildGrid(req), c = P.stiffness(req.material, 0.001);
  if (req.arch && !c.iso) archProfile(G, req);
  const n = G.n, nl = Math.max(G.nx, G.ny);
  const s = 25 / Math.pow(nl, 4);
  const K = assemble(G, c, req, s);
  cholBand(K);
  const R = [];
  if (req.bc === 'free') {
    const base = [new Float64Array(n).fill(1), new Float64Array(n), new Float64Array(n)];
    for (let k = 0; k < n; k++) { const g = G.gOf[k]; base[1][k] = g % G.nx; base[2][k] = (g / G.nx) | 0; }
    for (const v of base) {
      for (const r of R) { const a = dot(v, r); for (let i = 0; i < n; i++) v[i] -= a * r[i]; }
      const l = Math.sqrt(dot(v, v)); for (let i = 0; i < n; i++) v[i] /= l;
      R.push(v);
    }
  }
  const k = req.k || 24;
  const res = lanczos(K, n, R, k, Math.max(3 * k, req.steps || 110), s, 12345);
  res.sort((a, b) => a.lambda - b.lambda);
  const fill = nearestFill(G), loops = boundaryLoops(G.geo, 1.3 * G.h);
  const modes = new Float32Array(k * n), lambda = new Float64Array(k), norm2 = new Float64Array(k), info = [];
  res.forEach((r, m) => {
    let mx = 0, big = 0;
    for (let i = 0; i < n; i++) if (Math.abs(r.vec[i]) > mx) { mx = Math.abs(r.vec[i]); big = r.vec[i]; }
    const sc = (big < 0 ? -1 : 1) / mx;
    let s2 = 0;
    for (let i = 0; i < n; i++) { const v = r.vec[i] * sc; modes[m * n + i] = v; s2 += v * v; }
    lambda[m] = r.lambda; norm2[m] = s2;
    const a = analyse(G, fill, modes.subarray(m * n, m * n + n), loops);
    a.resid = r.resid;
    info.push(a);
  });
  return {
    key: req.key, shape: req.shape, bracing: req.bracing, nx: G.nx, ny: G.ny, x0: G.x0, y0: G.y0, h: G.h, n,
    idx: G.idx, st: G.st, brace: G.brace, fill, modes, lambda, norm2, info, k,
    band: K.b, ms: Date.now() - t0,
  };
}

root.CSolver = { solve, buildGrid, analyse };

if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
  root.onmessage = e => {
    try {
      const r = solve(e.data);
      root.postMessage({ ok: true, r }, [r.modes.buffer, r.idx.buffer, r.fill.buffer, r.st.buffer, r.brace.buffer]);
    } catch (err) {
      root.postMessage({ ok: false, key: e.data.key, error: String(err && err.stack || err) });
    }
  };
}
})(typeof self !== 'undefined' ? self : globalThis);
