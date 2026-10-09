// ============================================================================
//  MUJOCO LAB  ·  render/overlays.js — simulate-style visual overlays
// ----------------------------------------------------------------------------
//  Instanced pools (segment, cone, sphere, box) in the MuJoCo frame. Each
//  frame the overlays write instance matrices and colours straight into
//  the instance buffers: no objects are made, except the embind contact
//  objects when a contact overlay is on.
//
//  GREP MAP
//    export function createPools ... the four InstancedMesh pools
//    P.seg / P.arrow / P.sphere / P.box   one instance each
//    export function drawOverlays .. contacts, forces, joints, COM, inertia,
//                                    actuators, tendons, constraints, frames,
//                                    flex segments, perturb line
//    export const COLORS ........... overlay colours (0..1 rgb)
// ============================================================================

export const COLORS = {
  contact: [1.0, 0.55, 0.15], force: [1.0, 0.85, 0.2], joint: [0.25, 0.75, 1.0], com: [0.95, 0.95, 0.95],
  inertia: [0.95, 0.3, 0.3], actPos: [1.0, 0.45, 0.2], actNeg: [0.3, 0.55, 1.0], bad: [1.0, 0.12, 0.12],
  fx: [0.95, 0.2, 0.2], fy: [0.2, 0.9, 0.3], fz: [0.25, 0.45, 1.0], perturb: [0.55, 0.95, 1.0], perturbRot: [1.0, 0.6, 0.95],
};

// unit pools: segment = cylinder r 1 from y 0 to 1, cone = r 1 from y 0 to 1,
// sphere r 1, box half-size 1
export function createPools(THREE, max = {}) {
  const lit = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.05 });
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1); cyl.translate(0, 0.5, 0);
  const cone = new THREE.ConeGeometry(1, 1, 14, 1); cone.translate(0, 0.5, 0);
  const sph = new THREE.SphereGeometry(1, 16, 10);
  const box = new THREE.BoxGeometry(2, 2, 2);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.35, depthWrite: false });
  const white = new THREE.Color(1, 1, 1);
  function pool(geo, mat, n) {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.setColorAt(0, white);
    if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { mesh, M: mesh.instanceMatrix.array, C: mesh.instanceColor.array, n: 0, max: n };
  }
  const P = {
    seg: pool(cyl, lit(), max.seg || 6000), cone: pool(cone, lit(), max.cone || 2000),
    sphere: pool(sph, lit(), max.sphere || 3000), box: pool(box, boxMat, max.box || 600),
  };
  P.list = [P.seg, P.cone, P.sphere, P.box];
  P.begin = () => { for (const p of P.list) p.n = 0; };
  P.end = () => {
    for (const p of P.list) { p.mesh.count = p.n; p.mesh.instanceMatrix.needsUpdate = true; p.mesh.instanceColor.needsUpdate = true; p.mesh.visible = p.n > 0; }
  };
  P.count = () => P.list.reduce((s, p) => s + p.n, 0);
  // basis with y along (dx, dy, dz) / L, x and z of radius r
  function put(p, ax, ay, az, dx, dy, dz, L, r, c) {
    if (p.n >= p.max || !(L > 1e-9)) return;
    const nx = dx / L, ny = dy / L, nz = dz / L;
    // u: a helper axis not parallel to n
    let ux = 0, uy = 0, uz = 1; if (Math.abs(nz) > 0.9) { ux = 1; uz = 0; }
    let xx = ny * uz - nz * uy, xy = nz * ux - nx * uz, xz = nx * uy - ny * ux;
    const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
    const zx = xy * nz - xz * ny, zy = xz * nx - xx * nz, zz = xx * ny - xy * nx;
    const M = p.M, o = 16 * p.n;
    M[o] = xx * r; M[o + 1] = xy * r; M[o + 2] = xz * r; M[o + 3] = 0;
    M[o + 4] = dx; M[o + 5] = dy; M[o + 6] = dz; M[o + 7] = 0;
    M[o + 8] = zx * r; M[o + 9] = zy * r; M[o + 10] = zz * r; M[o + 11] = 0;
    M[o + 12] = ax; M[o + 13] = ay; M[o + 14] = az; M[o + 15] = 1;
    const C = p.C, q = 3 * p.n; C[q] = c[0]; C[q + 1] = c[1]; C[q + 2] = c[2];
    p.n++;
  }
  P.addSeg = (ax, ay, az, bx, by, bz, r, c) => { const dx = bx - ax, dy = by - ay, dz = bz - az; put(P.seg, ax, ay, az, dx, dy, dz, Math.hypot(dx, dy, dz), r, c); };
  // arrow from a along unit n, total length L, shaft radius r
  P.addArrow = (ax, ay, az, nx, ny, nz, L, r, c) => {
    if (!(L > 1e-9)) return;
    const h = Math.min(0.4 * L, 4 * r), s = L - h;
    put(P.seg, ax, ay, az, nx * s, ny * s, nz * s, s, r, c);
    put(P.cone, ax + nx * s, ay + ny * s, az + nz * s, nx * h, ny * h, nz * h, h, 2.2 * r, c);
  };
  P.addSphere = (x, y, z, r, c) => {
    const p = P.sphere; if (p.n >= p.max) return;
    const M = p.M, o = 16 * p.n;
    M.fill(0, o, o + 16); M[o] = r; M[o + 5] = r; M[o + 10] = r; M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
    const C = p.C, q = 3 * p.n; C[q] = c[0]; C[q + 1] = c[1]; C[q + 2] = c[2];
    p.n++;
  };
  // R: row-major 3x3 at offset ro
  P.addBox = (x, y, z, R, ro, hx, hy, hz, c) => {
    const p = P.box; if (p.n >= p.max) return;
    const M = p.M, o = 16 * p.n;
    M[o] = R[ro] * hx; M[o + 1] = R[ro + 3] * hx; M[o + 2] = R[ro + 6] * hx; M[o + 3] = 0;
    M[o + 4] = R[ro + 1] * hy; M[o + 5] = R[ro + 4] * hy; M[o + 6] = R[ro + 7] * hy; M[o + 7] = 0;
    M[o + 8] = R[ro + 2] * hz; M[o + 9] = R[ro + 5] * hz; M[o + 10] = R[ro + 8] * hz; M[o + 11] = 0;
    M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
    const C = p.C, q = 3 * p.n; C[q] = c[0]; C[q + 1] = c[1]; C[q + 2] = c[2];
    p.n++;
  };
  P.dispose = () => { for (const p of P.list) { p.mesh.geometry.dispose(); p.mesh.material.dispose(); p.mesh.dispose && p.mesh.dispose(); } };
  return P;
}

const JNT = { FREE: 0, BALL: 1, SLIDE: 2, HINGE: 3 };

// X: { m, d, V (cached views), mj, cf (DoubleBuffer 6), flags, sc (scales),
//      peak (Float64Array nu), flexes, pert (renderer perturb state), tmp }
export function drawOverlays(P, X) {
  const { m, d, V, flags: F, sc } = X;
  P.begin();
  const nb = m.nbody;

  // ---- contacts -----------------------------------------------------------------
  const ncon = d.ncon;
  if ((F.contactPoints || F.contactForces || F.constraints) && ncon > 0) {
    const vec = d.contact;
    try {
      for (let i = 0; i < ncon; i++) {
        const c = vec.get(i);
        try {
          const p = c.pos, fr = c.frame;
          const px = p[0], py = p[1], pz = p[2], nx = fr[0], ny = fr[1], nz = fr[2];
          if (F.contactPoints) {
            const h = sc.contactHeight;
            P.addSeg(px - nx * h / 2, py - ny * h / 2, pz - nz * h / 2, px + nx * h / 2, py + ny * h / 2, pz + nz * h / 2, sc.contactWidth, COLORS.contact);
          }
          if (F.contactForces) {
            X.mj.mj_contactForce(m, d, i, X.cf);
            const f = X.cf.GetView();
            // world force on geom2 from geom1: f0 n + f1 t1 + f2 t2
            const wx = f[0] * fr[0] + f[1] * fr[3] + f[2] * fr[6], wy = f[0] * fr[1] + f[1] * fr[4] + f[2] * fr[7], wz = f[0] * fr[2] + f[1] * fr[5] + f[2] * fr[8];
            const fm = Math.hypot(wx, wy, wz), L = Math.min(fm * sc.forceScale, sc.forceMax);   // capped for legibility
            if (L > 1e-6) P.addArrow(px, py, pz, wx / fm, wy / fm, wz / fm, L, sc.forceWidth, COLORS.force);
          }
          if (F.constraints && c.dist < -1e-4) {
            const L = Math.max(sc.meansize * 0.3, -c.dist * 20);
            P.addSeg(px, py, pz, px - nx * L, py - ny * L, pz - nz * L, sc.contactWidth * 0.5, COLORS.bad);
            P.addSphere(px, py, pz, sc.contactWidth * 0.8, COLORS.bad);
          }
        } finally { c.delete && c.delete(); }
      }
    } finally { vec.delete && vec.delete(); }
  }

  // ---- joints ---------------------------------------------------------------------
  if (F.jointAxes || F.constraints) {
    const A = V.xanchor, AX = V.xaxis, T = V.jnt_type, L = sc.jointLength, W = sc.jointWidth;
    for (let j = 0; j < m.njnt; j++) {
      const t = T[j], ax = A[3 * j], ay = A[3 * j + 1], az = A[3 * j + 2];
      if (F.jointAxes) {
        if (t === JNT.HINGE || t === JNT.SLIDE) P.addArrow(ax, ay, az, AX[3 * j], AX[3 * j + 1], AX[3 * j + 2], L, W, COLORS.joint);
        else if (t === JNT.BALL) P.addSphere(ax, ay, az, 2 * W, COLORS.joint);
      }
      if (F.constraints && V.jnt_limited[j] && (t === JNT.HINGE || t === JNT.SLIDE)) {
        const q = V.qpos[V.jnt_qposadr[j]], lo = V.jnt_range[2 * j], hi = V.jnt_range[2 * j + 1];
        if (q < lo - 1e-3 || q > hi + 1e-3) P.addSphere(ax, ay, az, 2.5 * W, COLORS.bad);
      }
    }
  }

  // ---- equality connect gaps ---------------------------------------------------------
  if (F.constraints && m.neq > 0 && V.eq_type) {
    const XP = V.xpos, XM = V.xmat, D = V.eq_data, stride = D.length / m.neq;
    for (let e = 0; e < m.neq; e++) {
      if (V.eq_type[e] !== 0 || (V.eq_active0 && !V.eq_active0[e])) continue;   // connect only
      const b1 = V.eq_obj1id[e], b2 = V.eq_obj2id[e], o = stride * e;
      if (V.eq_objtype && V.eq_objtype[e] !== 1) continue;                  // body anchors only (mjOBJ_BODY)
      const w = X.tmp;
      for (let k = 0; k < 2; k++) {
        const b = k ? b2 : b1, a = o + 3 * k, r = 9 * b;
        const lx = D[a], ly = D[a + 1], lz = D[a + 2];
        w[3 * k] = XP[3 * b] + XM[r] * lx + XM[r + 1] * ly + XM[r + 2] * lz;
        w[3 * k + 1] = XP[3 * b + 1] + XM[r + 3] * lx + XM[r + 4] * ly + XM[r + 5] * lz;
        w[3 * k + 2] = XP[3 * b + 2] + XM[r + 6] * lx + XM[r + 7] * ly + XM[r + 8] * lz;
      }
      P.addSeg(w[0], w[1], w[2], w[3], w[4], w[5], sc.jointWidth * 0.6, COLORS.bad);
      P.addSphere(w[0], w[1], w[2], sc.jointWidth, COLORS.bad); P.addSphere(w[3], w[4], w[5], sc.jointWidth, COLORS.bad);
    }
  }

  // ---- centres of mass and inertia boxes -----------------------------------------------------
  if (F.com || F.inertia) {
    const XI = V.xipos, XR = V.ximat, I = V.body_inertia, MS = V.body_mass, PAR = V.body_parentid, SC = V.subtree_com;
    for (let b = 1; b < nb; b++) {
      if (F.com) {
        P.addSphere(XI[3 * b], XI[3 * b + 1], XI[3 * b + 2], sc.com, COLORS.com);
        if (PAR[b] === 0) P.addSphere(SC[3 * b], SC[3 * b + 1], SC[3 * b + 2], sc.com * 1.8, COLORS.joint);
      }
      if (F.inertia && MS[b] > 1e-9) {
        const ix = I[3 * b], iy = I[3 * b + 1], iz = I[3 * b + 2], mm = MS[b];
        const hx = Math.sqrt(Math.max(1e-12, 1.5 * (iy + iz - ix) / mm)), hy = Math.sqrt(Math.max(1e-12, 1.5 * (ix + iz - iy) / mm)), hz = Math.sqrt(Math.max(1e-12, 1.5 * (ix + iy - iz) / mm));
        P.addBox(XI[3 * b], XI[3 * b + 1], XI[3 * b + 2], XR, 9 * b, hx, hy, hz, COLORS.inertia);
      }
    }
  }

  // ---- actuators -----------------------------------------------------------------------------------
  if (F.actuators && m.nu > 0) {
    const AF = V.actuator_force, TT = V.actuator_trntype, TI = V.actuator_trnid, A = V.xanchor, AX = V.xaxis, peak = X.peak;
    for (let a = 0; a < m.nu; a++) {
      const f = AF[a], af = Math.abs(f);
      peak[a] = Math.max(peak[a] * 0.999, af, 1e-9);
      const L = sc.actLength * af / peak[a];
      if (L < 1e-5) continue;
      const s = f >= 0 ? 1 : -1, col = s > 0 ? COLORS.actPos : COLORS.actNeg, t = TT[a], id = TI[2 * a];
      if (t === 0 || t === 1) {
        const j = id, ax = A[3 * j], ay = A[3 * j + 1], az = A[3 * j + 2];
        P.addArrow(ax, ay, az, s * AX[3 * j], s * AX[3 * j + 1], s * AX[3 * j + 2], L, sc.actWidth, col);
      } else if (t === 4) {                      // mjTRN_SITE (3 is tendon)
        const SP = V.site_xpos, SR = V.site_xmat, r = 9 * id;
        P.addArrow(SP[3 * id], SP[3 * id + 1], SP[3 * id + 2], s * SR[r + 2], s * SR[r + 5], s * SR[r + 8], L, sc.actWidth, col);
      }
    }
  }

  // ---- tendons ------------------------------------------------------------------------------------------
  if (F.tendons && m.ntendon > 0) {
    const WA = V.ten_wrapadr, WN = V.ten_wrapnum, WX = V.wrap_xpos, WO = V.wrap_obj, TW = V.tendon_width, TC = V.tendon_rgba, c = X.tmp;
    for (let t = 0; t < m.ntendon; t++) {
      const a = WA[t], n = WN[t], r = Math.max(TW[t], sc.meansize * 0.01);
      c[0] = TC[4 * t]; c[1] = TC[4 * t + 1]; c[2] = TC[4 * t + 2];
      for (let j = a; j < a + n - 1; j++) {
        if (WO[j] === -2 || WO[j + 1] === -2) continue;
        P.addSeg(WX[3 * j], WX[3 * j + 1], WX[3 * j + 2], WX[3 * j + 3], WX[3 * j + 4], WX[3 * j + 5], r, c);
      }
    }
  }

  // ---- flex segments (dim 1) --------------------------------------------------------------------------------
  for (const fx of X.flexes) {
    if (fx.dim !== 1) continue;
    const p = fx.pos, s = fx.seg, r = Math.max(fx.radius, sc.meansize * 0.02);
    for (let i = 0; i < s.length; i += 2) P.addSeg(p[3 * s[i]], p[3 * s[i] + 1], p[3 * s[i] + 2], p[3 * s[i + 1]], p[3 * s[i + 1] + 1], p[3 * s[i + 1] + 2], r, fx.color);
    for (let i = 0; i < fx.nv; i++) P.addSphere(p[3 * i], p[3 * i + 1], p[3 * i + 2], r, fx.color);
  }

  // ---- body frames ------------------------------------------------------------------------------------------------
  if (F.frames) {
    const XP = V.xpos, XM = V.xmat, L = sc.frameLength, W = sc.frameWidth;
    for (let b = 0; b < nb; b++) {
      const x = XP[3 * b], y = XP[3 * b + 1], z = XP[3 * b + 2], r = 9 * b;
      P.addArrow(x, y, z, XM[r], XM[r + 3], XM[r + 6], L, W, COLORS.fx);
      P.addArrow(x, y, z, XM[r + 1], XM[r + 4], XM[r + 7], L, W, COLORS.fy);
      P.addArrow(x, y, z, XM[r + 2], XM[r + 5], XM[r + 8], L, W, COLORS.fz);
    }
  }

  // ---- perturbation ------------------------------------------------------------------------------------------------------
  const pt = X.pert;
  if (F.perturb && pt.body > 0) {
    const a = pt.anchor, t = pt.target, col = pt.mode === 'rotate' ? COLORS.perturbRot : COLORS.perturb;
    if (pt.mode === 'translate') {
      P.addSeg(a[0], a[1], a[2], t[0], t[1], t[2], sc.mark * 0.03, col);
      P.addSphere(t[0], t[1], t[2], sc.mark * 0.12, col);
    }
    P.addSphere(a[0], a[1], a[2], sc.mark * 0.08, col);
  }
  P.end();
}
