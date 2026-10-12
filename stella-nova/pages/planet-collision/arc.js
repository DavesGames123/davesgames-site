// ============================================================================
//  PLANET COLLISION  ·  arc.js — the preview arc of the approach (no DOM)
// ----------------------------------------------------------------------------
//  The two bodies of a setup (build.js) as point masses on their two-body
//  orbit, from the start to the first contact (r = R1 + R2), and on as a
//  dashed "ghost" to the point-mass periapsis (where they would pass if
//  they were points). main.js draws both over the scene with the
//  renderer's project() while the "Aim" panel is open and before contact.
//
//  Relative orbit r = X2 - X1, d^2 r / dt^2 = -(M1 + M2) r / |r|^3 (G = 1),
//  RK4 with a step of 2e-3 |r| / |v|. World paths in the centre-of-mass
//  frame: X1 = -M2 / Mt r, X2 = M1 / Mt r.
//
//  grep -n targets: "export function previewArc"
// ============================================================================

// setup: build.js buildScenario output. Returns { imp: [[x,y,z]..],
// tgt: [..], ghost: [..] (impactor after contact), hit: [x,y,z] (the
// contact point on the target surface), tHit (code time) } or null.
export function previewArc(setup, maxPts = 160) {
  const B = setup.bodies; if (!B || B.length < 2) return null;
  const M1 = B[0].M, M2 = B[1].M, Mt = M1 + M2, Rs = B[0].R + B[1].R;
  let s = [0, 1, 2].map(c => B[1].X[c] - B[0].X[c]).concat([0, 1, 2].map(c => B[1].V[c] - B[0].V[c]));
  const acc = q => { const r = Math.hypot(q[0], q[1], q[2]), k = -Mt / (r * r * r); return [q[3], q[4], q[5], k * q[0], k * q[1], k * q[2]]; };
  const rk = (q, h) => {
    const k1 = acc(q), k2 = acc(q.map((x, j) => x + h / 2 * k1[j])), k3 = acc(q.map((x, j) => x + h / 2 * k2[j])), k4 = acc(q.map((x, j) => x + h * k3[j]));
    return q.map((x, j) => x + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
  };
  const rel = [], ghost = [];
  let t = 0, tHit = null, rPrev = Infinity;
  for (let it = 0; it < 40000; it++) {
    const r = Math.hypot(s[0], s[1], s[2]), v = Math.hypot(s[3], s[4], s[5]);
    if (tHit === null) {
      rel.push(s.slice(0, 3));
      if (r <= Rs) { tHit = t; }
    } else {
      ghost.push(s.slice(0, 3));
      if (r > rPrev && ghost.length > 3) break;   // past the periapsis
    }
    rPrev = r;
    const h = Math.min(2e-3 * r / Math.max(v, 1e-9), 0.02);
    s = rk(s, h); t += h;
  }
  if (tHit === null) return null;
  const thin = a => { const k = Math.max(1, Math.ceil(a.length / maxPts)); const o = a.filter((_, i) => i % k === 0); if (o[o.length - 1] !== a[a.length - 1]) o.push(a[a.length - 1]); return o; };
  const R = thin(rel), G = thin(ghost);
  const w2 = M1 / Mt, w1 = -M2 / Mt;
  const last = rel[rel.length - 1], lr = Math.hypot(...last);
  const t1 = last.map(c => w1 * c);
  return {
    imp: R.map(p => p.map(c => w2 * c)), tgt: R.map(p => p.map(c => w1 * c)),
    ghost: G.map(p => p.map(c => w2 * c)),
    hit: t1.map((c, k) => c + last[k] / lr * B[0].R), tHit,
  };
}
