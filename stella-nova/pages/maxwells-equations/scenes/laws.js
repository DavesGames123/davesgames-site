// ============================================================================
//  MAXWELL'S EQUATIONS  ·  scenes/laws.js — the four laws as pictures
// ----------------------------------------------------------------------------
//  MODES
//    gauss     three charges on an axis (+2, -1, +1) and a closed surface
//              that breathes and moves. Each field line is one tube of
//              flux; the surface marks where lines go out and come in.
//              Net lines out / lines per unit charge = enclosed charge.
//    monopole  a ring current and its closed field lines, with the same
//              surface. Every line that goes out comes back in: net zero.
//    faraday   the ring's current swings, so its B swings. A loop C has
//              two spanning surfaces, a flat disc and a dome; both carry
//              the same flux. The induced E circles the axis, and its
//              circulation round C is -dPhi/dt.
//    ampere    a capacitor in a wire carries an AC current. A loop C round
//              the wire has a flat disc (cut by the wire: conduction
//              current) and a bag through the gap (cut by the changing E:
//              displacement current). Both give the circulation of B.
//  Field data and integrals come from geom.js. Units eps0 = mu0 = c = 1.
//
//  GREP MAP   (grep -n "<anchor>" scenes/laws.js)
//    "function closedSurface"  "function flowLines"  "function buildGauss"
//    "function buildRing"      "function buildFaraday"  "function buildAmpere"
//    "function updateGauss"    "function updateMono"   "function updateFaraday"
//    "function updateAmpere"   "readout()"
// ============================================================================
import { THREE, COL, lines, setLines, shellMat, dots, arrows, setArrow, glowMat, metalMat, charge, rgb, ease, clamp, lerp } from '../kit.js';
import * as G from '../geom.js';

const TAU = G.TAU;
const OUT_E = rgb(COL.E), IN_E = rgb('#8f6a5a');
const OUT_B = rgb('#bfe6ff'), IN_B = rgb('#3c6a8f');

// Pieces of a polyline inside radius R, every `step`-th point.
function clipPoly(pts, R, step = 1) {
  const out = [];
  let cur = [];
  for (let i = 0; i < pts.length; i += (i + step < pts.length ? step : 1)) {
    const p = pts[i];
    if (G.len(p) < R) cur.push(p);
    else { if (cur.length > 1) out.push(cur); cur = []; }
    if (i === pts.length - 1) break;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// A deformable closed surface (geom starSurface) as a mesh plus a few
// latitude rings for a crisp edge.
function closedSurface(group, S) {
  const geo = new THREE.SphereGeometry(1, 96, 64);
  const dirs = geo.attributes.position.array.slice();
  const mesh = new THREE.Mesh(geo, shellMat({ color: COL.S, base: 0.07, rim: 0.55 }));
  mesh.renderOrder = 3;
  const rings = lines([], { color: COL.S, width: 1.2, opacity: 0.55 });
  group.add(mesh, rings);
  const LAT = [-0.75, -0.4, 0, 0.4, 0.75];
  function update() {
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const q = S.point([dirs[i], dirs[i + 1], dirs[i + 2]]);
      p[i] = q[0]; p[i + 1] = q[1]; p[i + 2] = q[2];
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    setLines(rings, LAT.map(z => Array.from({ length: 73 }, (_, k) => { const a = k / 72 * TAU, s = Math.sqrt(1 - z * z); return S.point([s * Math.cos(a), s * Math.sin(a), z]); })));
  }
  // Flux of F through the mesh (centroid rule on its triangles).
  function flux(F) {
    const p = geo.attributes.position.array, I = geo.index.array;
    let s = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const A = [p[a], p[a + 1], p[a + 2]], B = [p[b], p[b + 1], p[b + 2]], C = [p[c], p[c + 1], p[c + 2]];
      const n = G.cross(G.sub(B, A), G.sub(C, A));
      const m = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
      s += G.dot(F(m), n) / 2;
    }
    return s;   // SphereGeometry winds its triangles outward
  }
  return { mesh, rings, update, flux };
}

// Field lines as dashed fat lines that flow; fade with distance.
function flowLines(polys, color, { width = 1.6, R = 4.2, step = 1, dash = 0.16, gap = 0.08, opacity = 0.9 } = {}) {
  const pieces = [];
  for (const P of polys) pieces.push(...clipPoly(P, R, step));
  const L = lines(pieces, { color, width, opacity, dashed: { dash, gap } });
  return L;
}

export function build(ctx) {
  const root = new THREE.Group();
  const P = { mode: 'gauss', R0: 1.0, cz: 0.1, amp: 0.25, auto: true, z0: 0.9, rho: 0.75, tilt: 0.25, bulge: 0.55, r0: 0.75, zc: 0.9 };
  const lab = (html, fn, cls) => ctx.label(html, cls, () => (root.visible ? fn() : null));
  const parts = {};
  let clock = 0, frame = 0;

  // ── Gauss ────────────────────────────────────────────────────────────────
  const QS = [{ z: 0.55, q: 2 }, { z: -0.5, q: -1 }, { z: -1.6, q: 1 }];
  function buildGauss() {
    const g = new THREE.Group();
    for (const c of QS) { const m = charge(c.q, 0.06 + 0.03 * Math.sqrt(Math.abs(c.q))); m.position.set(0, 0, c.z); g.add(m); }
    const all = G.axisLines(QS, { perUnit: 2, naz: 12, show: 4 });
    const L = flowLines(all.map(l => l.pts), COL.E, { width: 1.5, R: 3.6, opacity: 0.75 });
    g.add(L);
    const S = G.starSurface({ c: [0, 0, 0], R0: 1, amp: 0.25, lobes: G.makeLobes(7) });
    const surf = closedSurface(g, S);
    const marks = dots(400, { size: 10, depthTest: false });
    g.add(marks);
    parts.gauss = { g, all, L, S, surf, marks, perUnit: 24, read: null, phiQ: 0 };
    root.add(g);
    QS.forEach(c => lab(c.q > 0 ? `+${c.q}` : `−${-c.q}`, () => (P.mode === 'gauss' ? [0.2, 0, c.z + 0.12] : null), 'q'));
    lab('<i>S</i>', () => (P.mode === 'gauss' ? G.add(S.point([0.7, -0.7, 0.2]), [0.15, 0, 0]) : null), 's');
  }
  function placeSurface(S, t, path) {
    S.t = t * 0.9;
    if (P.auto) {
      const [cz, R0] = path(t);
      S.c = [0.08 * Math.sin(t * 0.5), 0.05 * Math.cos(t * 0.37), cz];
      S.R0 = R0; S.amp = 0.22 + 0.1 * Math.sin(t * 0.21);
    } else { S.c = [0, 0, P.cz]; S.R0 = P.R0; S.amp = P.amp; }
  }
  function updateGauss(dt, t) {
    const X = parts.gauss;
    // auto: visit {+2}, {+2,-1}, all three, {-1}, nothing, ...
    placeSurface(X.S, t, tt => {
      const k = (tt / 7) % 5, i = Math.floor(k), f = ease(clamp((k - i) / 0.45, 0, 1));
      const stops = [[0.55, 0.42], [0.05, 1.0], [-0.55, 1.75], [-0.5, 0.42], [-1.05, 0.35]];
      const a = stops[i], b = stops[(i + 1) % 5];
      return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
    });
    X.surf.update();
    X.L.material.dashOffset -= dt * 0.35;
    if (frame % 2 === 0) {
      const cr = G.crossings(X.all, X.S.inside);
      cr.pts.slice(0, 400).forEach((q, i) => X.marks.setDot(i, q, q[3] > 0 ? OUT_E : IN_E, q[3] > 0 ? 1 : 0.8, q[3] > 0 ? 1.0 : 0.75));
      X.marks.commit(Math.min(400, cr.pts.length));
      const qenc = QS.reduce((s, c) => s + (X.S.inside([0, 0, c.z]) < 0 ? c.q : 0), 0);
      X.read = { out: cr.out, inn: cr.inn, qenc };
    }
    if (frame % 4 === 0) X.phiQ = X.surf.flux(p => G.eAxis(QS, p));
  }

  // ── a ring current, shared by monopole and Faraday ───────────────────────
  const RING = 1;
  function buildRing(g) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RING, 0.03, 16, 160), glowMat(COL.J, { emissive: 1.0 }));
    g.add(ring);
    const flow = dots(48, { size: 6 });
    g.add(flow);
    const ls = G.ringLines(RING, { n: 6, dPsi: 0.55, naz: 10 });
    const L = flowLines(ls.map(l => l.pts), COL.B, { width: 1.5, R: 4.0, step: 2, opacity: 0.8 });
    g.add(L);
    return { ring, flow, ls, L, ph: 0 };
  }
  function ringFlow(R, dt, I) {
    R.ph += dt * 0.35 * I;
    const pk = rgb(COL.Q);
    for (let i = 0; i < 48; i++) { const a = i / 48 * TAU + R.ph; R.flow.setDot(i, [RING * Math.cos(a), RING * Math.sin(a), 0], pk, 0.35 + 0.65 * Math.min(1, Math.abs(I)), 0.9); }
    R.flow.commit(48);
    R.L.material.dashOffset -= dt * 0.35 * I;
  }

  // ── no monopoles ─────────────────────────────────────────────────────────
  function buildMono() {
    const g = new THREE.Group();
    const R = buildRing(g);
    const S = G.starSurface({ c: [0, 0, 0], R0: 1, amp: 0.25, lobes: G.makeLobes(3) });
    const surf = closedSurface(g, S);
    const marks = dots(600, { size: 10, depthTest: false });
    g.add(marks);
    parts.mono = { g, R, S, surf, marks, read: null, phiQ: 0 };
    root.add(g);
    lab('<i>I</i>', () => (P.mode === 'monopole' ? [-RING * 0.72, -RING * 0.72, 0.12] : null), 'j');
    lab('<i>S</i>', () => (P.mode === 'monopole' ? G.add(S.point([0.6, -0.75, 0.3]), [0.15, 0, 0]) : null), 's');
  }
  function updateMono(dt, t) {
    const X = parts.mono;
    placeSurface(X.S, t, tt => {
      const k = (tt / 7) % 4, i = Math.floor(k), f = ease(clamp((k - i) / 0.45, 0, 1));
      const stops = [[0.15, 0.55], [0.1, 1.6], [0.0, 2.3], [0.5, 1.15]];
      const a = stops[i], b = stops[(i + 1) % 4];
      return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
    });
    X.surf.update();
    ringFlow(X.R, dt, 1);
    if (frame % 2 === 0) {
      const cr = G.crossings(X.R.ls, X.S.inside);
      cr.pts.slice(0, 600).forEach((q, i) => X.marks.setDot(i, q, q[3] > 0 ? OUT_B : IN_B, q[3] > 0 ? 1 : 0.85, q[3] > 0 ? 1.0 : 0.75));
      X.marks.commit(Math.min(600, cr.pts.length));
      X.read = { out: cr.out, inn: cr.inn };
    }
    if (frame % 8 === 0) X.phiQ = X.surf.flux(p => G.ringB(RING, p));
  }

  // ── Faraday ──────────────────────────────────────────────────────────────
  const W = 0.9;   // the angular frequency of the ring current
  function buildFaraday() {
    const g = new THREE.Group();
    const R = buildRing(g);
    const loop = lines([], { color: COL.S, width: 3.2 });
    const disc = new THREE.Mesh(new THREE.BufferGeometry(), shellMat({ color: COL.S, base: 0.12, rim: 0.3 }));
    const dome = new THREE.Mesh(new THREE.BufferGeometry(), shellMat({ color: '#b7f0ae', base: 0.08, rim: 0.45 }));
    const marks = dots(300, { size: 9, depthTest: false });
    const eArr = arrows(40, { color: COL.E, emissive: 0.8 });
    // the induced E: circles round the axis that flow with E_phi
    const eRings = [];
    for (const [r, z] of [[0.45, 0.5], [0.8, 0.9], [1.25, 0.45], [1.6, 1.1], [0.6, -0.5], [1.4, -0.6]]) {
      const Lr = lines([Array.from({ length: 97 }, (_, i) => [r * Math.cos(i / 96 * TAU), r * Math.sin(i / 96 * TAU), z])], { color: COL.E, width: 1.6, opacity: 0.7, dashed: { dash: 0.1, gap: 0.12 } });
      Lr.userData = { r, z, A: G.ringAphi(RING, r, z) };
      g.add(Lr); eRings.push(Lr);
    }
    g.add(loop, disc, dome, marks, eArr);
    parts.far = { g, R, loop, disc, dome, marks, eArr, eRings, key: '', phi0: { disc: 0, dome: 0, A: 0 } };
    root.add(g);
    lab('<i>C</i>', () => (P.mode === 'faraday' && parts.far.C ? G.add(parts.far.C(0.0), [0.12, 0, 0.1]) : null), 's');
    lab('<i>S</i><sub>1</sub>', () => (P.mode === 'faraday' && parts.far.Pd ? parts.far.Pd(0.55, 0.62) : null), 's');
    lab('<i>S</i><sub>2</sub>', () => (P.mode === 'faraday' && parts.far.Pm ? G.add(parts.far.Pm(0.1, 0.3), [0, 0, 0.08]) : null), 's');
  }
  function faradayGeom(z0, rho, tilt, h) {
    const n = [0, Math.sin(tilt), Math.cos(tilt)], e1 = [1, 0, 0], e2 = G.cross(n, e1);
    const zmin = 0.32 + rho * Math.abs(Math.sin(tilt)) + Math.max(0, -h) * Math.cos(tilt);
    const c = [0, 0, Math.max(z0, zmin)];
    const C = s => G.add(c, G.add(G.mul(e1, rho * Math.cos(TAU * s)), G.mul(e2, rho * Math.sin(TAU * s))));
    const Pd = (u, v) => G.add(c, G.add(G.mul(e1, u * rho * Math.cos(TAU * v)), G.mul(e2, u * rho * Math.sin(TAU * v))));
    const Pm = (u, v) => G.add(Pd(u, v), G.mul(n, h * (1 - u * u)));
    return { C, Pd, Pm, n, c };
  }
  function meshFrom(mesh, Pf, nu = 24, nv = 72) {
    const pos = [], idx = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) pos.push(...Pf(i / nu, j / nv));
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    mesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    mesh.geometry = g;
  }
  function updateFaraday(dt, t) {
    const X = parts.far;
    if (P.auto) { P.tilt = 0.35 * Math.sin(t * 0.23); P.bulge = 0.6 * Math.sin(t * 0.17 + 0.8); }
    const key = [P.z0, P.rho, P.tilt, P.bulge].map(v => v.toFixed(3)).join();
    if (key !== X.key) {
      X.key = key;
      const F = faradayGeom(P.z0, P.rho, P.tilt, P.bulge);
      Object.assign(X, F);
      setLines(X.loop, [Array.from({ length: 129 }, (_, i) => F.C(i / 128))]);
      meshFrom(X.disc, F.Pd); meshFrom(X.dome, F.Pm);
      // flux per unit current; recomputed only when the geometry changes
      const B = p => G.ringB(RING, p);
      X.phi0 = { disc: G.surfaceFlux(B, F.Pd, 28, 56), dome: G.surfaceFlux(B, F.Pm, 28, 56), A: G.loopIntegral(p => G.ringA(RING, p), F.C, 256) };
      // where the field lines cross each surface (lines are fixed, so once)
      const hit = [];
      const plane = p => G.dot(G.sub(p, F.c), F.n);
      for (const Lr of X.R.ls) {
        const pts = Lr.pts;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], fa = plane(a), fb = plane(b);
          if ((fa < 0) === (fb < 0)) continue;
          const u = fa / (fa - fb), q = G.add(a, G.mul(G.sub(b, a), u));
          if (G.len(G.sub(q, F.c)) <= P.rho) hit.push(q);
        }
      }
      X.hits = hit;
    }
    const I = Math.cos(W * t), dI = -W * Math.sin(W * t);
    ringFlow(X.R, dt, I);
    X.R.L.material.opacity = 0.25 + 0.65 * Math.abs(I);
    X.R.ring.material.emissiveIntensity = 0.3 + 0.9 * Math.abs(I);
    // induced E: E_phi = -A_phi dI/dt
    for (const Lr of X.eRings) {
      const e = -Lr.userData.A * dI;
      Lr.material.dashOffset -= dt * 2.2 * e;
      Lr.material.opacity = 0.15 + 0.75 * Math.min(1, Math.abs(e) * 2.2);
    }
    // arrows on C along the induced E
    let k = 0;
    for (let i = 0; i < 16; i++) {
      const s = (i + 0.5) / 16, p = X.C(s), q = X.C(s + 0.01);
      const tan = G.unit(G.sub(q, p));
      const e = G.ringA(RING, p);   // E = -A dI/dt
      const along = -G.dot(e, tan) * dI;
      setArrow(X.eArr, k++, G.sub(p, G.mul(tan, 0.08 * Math.sign(along))), G.mul(tan, Math.sign(along)), 0.22 * Math.min(1, Math.abs(along) * 3.5), 1.1);
    }
    X.eArr.count = k; X.eArr.instanceMatrix.needsUpdate = true;
    const c = I > 0 ? OUT_B : IN_B;
    X.hits.forEach((q, i) => X.marks.setDot(i, q, c, 0.4 + 0.6 * Math.abs(I), 0.9));
    X.marks.commit(Math.min(300, X.hits.length));
    X.read = { I, phiD: X.phi0.disc * I, phiM: X.phi0.dome * I, phiA: X.phi0.A * I, emf: -X.phi0.A * dI };
  }

  // ── Ampere-Maxwell ───────────────────────────────────────────────────────
  const CAP = { a: 0.9, g: 0.25 };
  const WA = 0.8;
  function buildAmpere() {
    const g = new THREE.Group();
    const wmat = glowMat(COL.J, { emissive: 0.9 });
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.9 - CAP.g, 20).rotateX(Math.PI / 2), wmat);
      w.position.z = s * (CAP.g + (2.9 - CAP.g) / 2);
      g.add(w);
    }
    const plates = [-1, 1].map(s => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(CAP.a, CAP.a, 0.04, 96).rotateX(Math.PI / 2), metalMat('#aab3c2', { rough: 0.28 }));
      m.material = m.material.clone(); m.material.emissive = new THREE.Color(COL.Q); m.material.emissiveIntensity = 0;
      m.position.z = s * (CAP.g + 0.02);
      g.add(m); return m;
    });
    const flow = dots(80, { size: 6 });
    // E lines between the plates, and the displacement current as dashed lines
    const eL = [], N = 10;
    for (let k = 0; k < N; k++) {
      const r = CAP.a * Math.sqrt((k + 0.5) / N), a = k * 2.39996;
      eL.push([[r * Math.cos(a), r * Math.sin(a), -CAP.g + 0.03], [r * Math.cos(a), r * Math.sin(a), CAP.g - 0.03]]);
    }
    const eLines = lines(eL, { color: COL.E, width: 2, opacity: 0.9, dashed: { dash: 0.05, gap: 0.04 } });
    const eArr = arrows(N, { color: COL.E, emissive: 0.8 });
    // B rings round the axis at several radii and heights
    const bRings = [];
    for (const z of [-1.5, -0.8, 0, 0.8, 1.5]) for (const r of [0.35, 0.7, 1.2]) {
      const Lr = lines([Array.from({ length: 97 }, (_, i) => [r * Math.cos(i / 96 * TAU), r * Math.sin(i / 96 * TAU), z])], { color: COL.B, width: 1.5, opacity: 0.7, dashed: { dash: 0.09, gap: 0.08 } });
      Lr.userData = { r, z };
      g.add(Lr); bRings.push(Lr);
    }
    const loop = lines([], { color: COL.S, width: 3.2 });
    const disc = new THREE.Mesh(new THREE.BufferGeometry(), shellMat({ color: COL.S, base: 0.12, rim: 0.3 }));
    const bag = new THREE.Mesh(new THREE.BufferGeometry(), shellMat({ color: '#b7f0ae', base: 0.07, rim: 0.45 }));
    const marks = dots(40, { size: 12, depthTest: false });
    g.add(flow, eLines, eArr, loop, disc, bag, marks);
    parts.amp = { g, plates, flow, eL, eLines, eArr, bRings, loop, disc, bag, marks, key: '', ph: 0 };
    root.add(g);
    lab('+<i>Q</i>', () => (P.mode === 'ampere' ? [CAP.a + 0.18, 0, -CAP.g] : null), 'q');
    lab('−<i>Q</i>', () => (P.mode === 'ampere' ? [CAP.a + 0.18, 0, CAP.g] : null), 'q');
    lab('<i>C</i>', () => (P.mode === 'ampere' ? [-P.r0 - 0.15, 0, parts.amp.zc ?? P.zc] : null), 's');
    lab('<i>S</i><sub>1</sub>', () => (P.mode === 'ampere' ? [0.3, -0.2, (parts.amp.zc ?? P.zc) + 0.1] : null), 's');
    lab('<i>S</i><sub>2</sub>', () => (P.mode === 'ampere' ? [CAP.a + 0.42, 0, 0.0] : null), 's');
  }
  function updateAmpere(dt, t) {
    const X = parts.amp;
    if (P.auto) P.r0 = 0.75 + 0.35 * Math.sin(t * 0.21);
    const zc = clamp(P.zc, CAP.g + 0.2, 1.8);
    X.zc = zc;
    const key = [zc, P.r0].map(v => v.toFixed(3)).join();
    if (key !== X.key) {
      X.key = key;
      setLines(X.loop, [Array.from({ length: 129 }, (_, i) => [P.r0 * Math.cos(i / 128 * TAU), P.r0 * Math.sin(i / 128 * TAU), zc])]);
      meshFrom(X.disc, G.revolve(G.discProfile(P.r0, zc)), 12, 72);
      X.prof = G.bagProfile(CAP, P.r0, zc);
      meshFrom(X.bag, G.revolve(X.prof), 60, 72);
    }
    const I = Math.cos(WA * t), Q = Math.sin(WA * t) / WA;
    X.ph += dt * 0.6 * I;
    const pk = rgb(COL.Q);
    let k = 0;
    for (let i = 0; i < 40; i++) {
      const z = ((i / 40 + X.ph * 0.25) % 1 + 1) % 1, zz = -2.9 + z * (2.9 - CAP.g);
      X.flow.setDot(k++, [0, 0, zz], pk, 0.4 + 0.6 * Math.abs(I), 0.8);
      X.flow.setDot(k++, [0, 0, -zz], pk, 0.4 + 0.6 * Math.abs(I), 0.8);
    }
    X.flow.commit(k);
    // plates glow with their charge; the lower plate holds +Q
    X.plates[0].material.emissiveIntensity = 0.9 * Math.max(0, Q * WA);
    X.plates[1].material.emissiveIntensity = 0.9 * Math.max(0, -Q * WA);
    // E between the plates: Q / (pi a^2), along +z when Q > 0
    X.eLines.material.opacity = 0.1 + 0.85 * Math.abs(Q * WA);
    X.eLines.material.dashOffset -= dt * 0.8 * I;   // the dashes move with dE/dt
    X.eL.forEach((s, i) => setArrow(X.eArr, i, [s[0][0], s[0][1], -0.06 * Math.sign(Q)], [0, 0, Math.sign(Q) || 1], 0.14 * Math.min(1, Math.abs(Q * WA) * 1.4), 0.8));
    X.eArr.count = X.eL.length; X.eArr.instanceMatrix.needsUpdate = true;
    for (const Lr of X.bRings) {
      const { r, z } = Lr.userData, B = G.capItot(CAP, r, z, I) / (TAU * r);
      Lr.material.dashOffset -= dt * 1.6 * B;
      Lr.material.opacity = 0.12 + 0.7 * Math.min(1, Math.abs(B) * 3);
    }
    // pierce marks: the wire through the disc; the gap lines through the bag floor
    let m = 0;
    X.marks.setDot(m++, [0, 0, zc], rgb(COL.J), 0.5 + 0.5 * Math.abs(I), 1.2);
    for (const s of X.eL) X.marks.setDot(m++, [s[0][0], s[0][1], 0], rgb(COL.E), 0.3 + 0.7 * Math.abs(I), 0.9);
    X.marks.commit(m);
    const pd = G.profileCurrent(CAP, G.discProfile(P.r0, zc), I, 200), pb = G.profileCurrent(CAP, X.prof, I, 2000);
    X.read = { I, loopB: G.capItot(CAP, P.r0, zc, I), pd, pb };
  }

  buildGauss(); buildMono(); buildFaraday(); buildAmpere();

  const api = {
    group: root, P,
    enter(mode, params = {}) {
      Object.assign(P, params, { mode });
      for (const [k, v] of Object.entries({ gauss: parts.gauss, monopole: parts.mono, faraday: parts.far, ampere: parts.amp })) v.g.visible = k === mode;
      parts.far.key = ''; parts.amp.key = '';
      clock = params.t0 || 0;
    },
    set(key, v) { P[key] = v; },
    update(dt) {
      clock += dt; frame++;
      if (P.mode === 'gauss') updateGauss(dt, clock);
      else if (P.mode === 'monopole') updateMono(dt, clock);
      else if (P.mode === 'faraday') updateFaraday(dt, clock);
      else if (P.mode === 'ampere') updateAmpere(dt, clock);
    },
    readout() {
      const f = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(3);
      if (P.mode === 'gauss' && parts.gauss.read) {
        const r = parts.gauss.read, net = r.out - r.inn;
        return [['charge inside S', (r.qenc > 0 ? '+' : '') + r.qenc, 'm4'], ['lines out − lines in', `${r.out} − ${r.inn} = ${net}`, 'm2'], ['÷ 24 lines per unit', String(net / 24), 'm2'], ['∯ E·dA (quadrature)', f(parts.gauss.phiQ), 'm2']];
      }
      if (P.mode === 'monopole' && parts.mono.read) {
        const r = parts.mono.read;
        return [['lines out', String(r.out), 'm1'], ['lines in', String(r.inn), 'm1'], ['net', String(r.out - r.inn), 'm1'], ['∯ B·dA (quadrature)', f(parts.mono.phiQ), 'm1']];
      }
      if (P.mode === 'faraday' && parts.far.read) {
        const r = parts.far.read;
        return [['current in the ring', f(r.I), 'm5'], ['Φ through the flat disc S₁', f(r.phiD), 'm1'], ['Φ through the dome S₂', f(r.phiM), 'm1'], ['∮ E·dl = −dΦ/dt', f(r.emf), 'm2']];
      }
      if (P.mode === 'ampere' && parts.amp.read) {
        const r = parts.amp.read;
        // the loop stays above the gap: S1 meets only the wire, S2 only the gap
        return [['current in the wire', f(r.I), 'm5'], ['∮ B·dl round C', f(r.loopB), 'm1'], ['wire current through S₁', f(r.pd.cond + r.pd.disp), 'm5'], ['dΦ_E/dt through S₂', f(r.pb.cond + r.pb.disp), 'm2']];
      }
      return [];
    },
    anchor() {
      if (P.mode === 'gauss') return { c: parts.gauss.S.c, r: 2.0 };
      if (P.mode === 'monopole') return { c: [0, 0, 0], r: 2.2 };
      if (P.mode === 'faraday') return { c: [0, 0, 0.5], r: 2.0 };
      return { c: [0, 0, 0], r: 2.2 };
    },
  };
  return api;
}
