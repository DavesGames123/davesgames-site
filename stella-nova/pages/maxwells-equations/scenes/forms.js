// ============================================================================
//  MAXWELL'S EQUATIONS  ·  scenes/forms.js — fields as differential forms
// ----------------------------------------------------------------------------
//  One field, two pictures. The plane x = 0 cuts the scene: on the left
//  (x < 0) the field is drawn as arrows, on the right (x > 0) as its form.
//  Coordinates are geom.js coordinates (z up); main.js turns the world.
//
//  MODES
//    E      a point charge. E = -d(phi) is a 1-form: the sheets are the
//           spheres phi = k dphi. A path from a to b crosses
//           (phi(a) - phi(b)) / dphi sheets, net. A bead runs the path and
//           lights each sheet it crosses.
//    B      a straight wire. B = (I / 2 pi) dz ^ d(ln r) is a 2-form: the
//           tubes are the cells between log-spaced cylinders and planes.
//           A strip in a half-plane is pierced by its flux in tubes.
//    rho    a charge cloud. rho is a 3-form: dots per volume. A box holds
//           the charge = the dots inside it.
//    J      a thick wire. J is a 2-form: current tubes along the wire,
//           with charges (rho) riding them. A tilted disc counts the tubes
//           it cuts, the same at any tilt.
//    hodgeE, hodgeB (chapter 4): the Hodge star. The sheets of E become
//           the tubes of star E (radial cells), and the tubes of B become
//           the sheets of star B (half-planes that end on the wire).
//
//  GREP MAP   (grep -n "<anchor>" scenes/forms.js)
//    "function buildE"  "function buildB"  "function buildRho"  "function buildJ"
//    "function buildHodge"  "function updateE"  "function updateB"  "readout()"
// ============================================================================
import { THREE, COL, lines, setLines, shellMat, dots, arrows, setArrow, glowMat, charge, rgb, ease, clamp } from '../kit.js';
import * as G from '../geom.js';

const TAU = G.TAU;
const LEFT = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)];   // keep x <= 0
const RIGHT = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)];   // keep x >= 0

// Fibonacci directions on the unit sphere.
function fib(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const z = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - z * z), a = i * g; out.push([r * Math.cos(a), r * Math.sin(a), z]); }
  return out;
}

export function build(ctx) {
  const root = new THREE.Group();
  const P = { mode: 'E', q: 1, dphi: 0.03, endAng: 0.4, I: 1, cellsR: 4, cellsZ: 4, boxX: 0.0, boxS: 0.9, tilt: 0.5, discR: 0.6, mix: 0, auto: true };
  const parts = {};

  // The divider between the two pictures: a faint frame in x = 0.
  const divider = new THREE.Group();
  {
    const h = 2.1, w = 2.6;
    divider.add(lines([[[0, -w, -h], [0, w, -h], [0, w, h], [0, -w, h], [0, -w, -h]]], { color: '#5f6f86', width: 1, opacity: 0.45 }));
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(2 * w, 2 * h), new THREE.MeshBasicMaterial({ color: 0x8fa6c8, transparent: true, opacity: 0.025, side: THREE.DoubleSide, depthWrite: false }));
    pl.rotation.y = Math.PI / 2;
    divider.add(pl);
  }
  root.add(divider);
  const lab = (html, fn, cls = '') => ctx.label(html, cls, () => (root.visible ? fn() : null));
  lab('arrows', () => (P.mode !== 'rho' && !P.mode.startsWith('hodge') ? [-1.3, 0, 2.35] : null), 'side');
  lab('form', () => (P.mode !== 'rho' && !P.mode.startsWith('hodge') ? [1.3, 0, 2.35] : null), 'side');

  // ── E: the 1-form of a point charge ──────────────────────────────────────
  function buildE() {
    const g = new THREE.Group();
    g.add(charge(1));
    const shells = [];
    const geo = new THREE.SphereGeometry(1, 72, 48);
    for (let k = 0; k < 18; k++) {
      const m = new THREE.Mesh(geo, shellMat({ color: COL.E, base: 0.04, rim: 0.5, clip: RIGHT }));
      m.renderOrder = 2;
      g.add(m); shells.push(m);
    }
    // rims: the circle where each sphere meets the divider
    const rims = lines([], { color: COL.E, width: 1.6, opacity: 0.85 });
    g.add(rims);
    const arr = arrows(400, { color: COL.E, clip: LEFT });
    g.add(arr);
    const path = lines([], { color: COL.ink, width: 2.2, opacity: 0.9 });
    const pathDone = lines([], { color: COL.E, width: 3.2, opacity: 1 });
    g.add(path, pathDone);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), glowMat('#ffffff', { emissive: 1.2 }));
    g.add(bead);
    const marks = dots(64, { size: 9 });
    g.add(marks);
    parts.E = { g, shells, rims, arr, path, pathDone, bead, marks, s: 0, hold: 0, pts: [] };
    root.add(g);
  }
  function radiiE() {
    const out = [];
    for (let k = 1; k < 60 && out.length < 18; k++) { const r = P.q / (2 * TAU * k * P.dphi); if (r < 2.9 && r > 0.16) out.push(r); }
    return out;
  }
  function layoutE() {
    const E = parts.E, R = radiiE();
    E.R = R;
    E.shells.forEach((m, i) => { m.visible = i < R.length; if (m.visible) m.scale.setScalar(R[i]); });
    setLines(E.rims, R.map(r => Array.from({ length: 97 }, (_, i) => [0, r * Math.cos(i / 96 * TAU), r * Math.sin(i / 96 * TAU)])));
    // arrows on shells of directions, left half only
    const Q = [{ z: 0, q: P.q }], dirs = fib(70);
    let n = 0;
    const e0 = P.q / (2 * TAU * 0.5 * 0.5);
    for (const r of [0.5, 0.85, 1.35, 2.0, 2.7]) for (const d of dirs) {
      if (d[0] > -0.06) continue;
      const p = [d[0] * r, d[1] * r, d[2] * r], e = G.eAxis(Q, p), m = G.len(e);
      setArrow(E.arr, n++, p, e, 0.36 * Math.pow(Math.min(1, m / e0), 0.4), 1);
    }
    E.arr.count = n; E.arr.instanceMatrix.needsUpdate = true;
    // the path: from a near the charge to b far out, on the form side
    const ra = 0.32, rb = 2.6, a0 = [0.55, -0.6, 0.58], b0 = [Math.cos(P.endAng) * 0.9, -Math.sin(P.endAng) * 0.3 - 0.2, Math.sin(P.endAng) * 0.5 + 0.1];
    const ua = G.unit(a0), ub = G.unit(b0);
    E.pts = [];
    for (let i = 0; i <= 160; i++) {
      const s = i / 160, r = ra * Math.pow(rb / ra, s);
      const d = G.unit(G.add(G.mul(ua, 1 - s), G.mul(ub, s)));
      const w = 0.22 * Math.sin(Math.PI * s) * Math.sin(3 * Math.PI * s);
      E.pts.push(G.add(G.mul(d, r), [0, w, w * 0.6]));
    }
    // keep the path on the form side
    for (const p of E.pts) p[0] = Math.max(0.04, p[0]);
    setLines(E.path, [E.pts]);
  }
  function updateE(dt) {
    const E = parts.E;
    if (!P.auto) E.s = 1;
    else {
      if (E.hold > 0) E.hold -= dt; else { E.s += dt / 7; if (E.s >= 1) { E.s = 1; E.hold = 2.2; } }
      if (E.s >= 1 && E.hold <= 0) E.s = 0;
    }
    const n = E.pts.length - 1, f = E.s * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
    const p = G.add(G.mul(E.pts[i], 1 - t), G.mul(E.pts[i + 1], t));
    E.bead.position.set(...p);
    setLines(E.pathDone, [E.pts.slice(0, i + 1).concat([p])]);
    // sheets crossed so far: radii between |a| and |p|
    const ra = G.len(E.pts[0]), rp = G.len(p);
    let m = 0;
    const c = rgb(COL.E);
    E.R.forEach((r, k) => {
      const crossed = r < ra && r > rp || r > ra && r < rp;
      const sh = E.shells[k].material.uniforms;
      sh.uBase.value += ((crossed ? 0.16 : 0.035) - sh.uBase.value) * Math.min(1, dt * 6);
      sh.uRim.value += ((crossed ? 0.9 : 0.42) - sh.uRim.value) * Math.min(1, dt * 6);
    });
    // marks where the path meets each sheet
    for (let j = 0; j < n; j++) {
      const r1 = G.len(E.pts[j]), r2 = G.len(E.pts[j + 1]);
      for (const r of E.R) if ((r1 - r) * (r2 - r) < 0 && m < 64) {
        const u = (r - r1) / (r2 - r1), q = G.add(G.mul(E.pts[j], 1 - u), G.mul(E.pts[j + 1], u));
        const passed = j + u < f;
        E.marks.setDot(m++, q, passed ? c : [0.5, 0.45, 0.42], passed ? 1 : 0.5, passed ? 1.2 : 0.8);
      }
    }
    E.marks.commit(m);
    const Q = [{ z: 0, q: P.q }];
    // outward (r grows) the potential falls, so a sheet crossed outward counts +1
    const crossed = E.R.filter(r => r > ra && r < rp).length - E.R.filter(r => r < ra && r > rp).length;
    E.read = { crossed, integral: G.phiAxis(Q, E.pts[0]) - G.phiAxis(Q, p), dphi: P.dphi };
  }

  // ── B: the 2-form of a straight wire ─────────────────────────────────────
  const WB = { r0: 0.16, k: Math.log(1.5), nr: 7, dz: 0.5, nz: 8 };
  function buildB() {
    const g = new THREE.Group();
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 5.2, 24), glowMat(COL.J, { emissive: 1.1 }));
    wire.rotation.x = Math.PI / 2;
    g.add(wire);
    const dim = glowMat(COL.B, { emissive: 0.32, rough: 0.4, clip: RIGHT }), lit = glowMat(COL.B, { emissive: 1.1, rough: 0.3, clip: RIGHT });
    const tubes = [];
    for (let i = 0; i < WB.nr; i++) {
      const r1 = WB.r0 * Math.exp(WB.k * i), r2 = r1 * Math.exp(WB.k), rc = Math.sqrt(r1 * r2), tr = Math.min(0.3 * (r2 - r1), 0.3 * WB.dz);
      const geo = new THREE.TorusGeometry(rc, tr, 16, 140);
      for (let j = 0; j < WB.nz; j++) {
        const z = (j - (WB.nz - 1) / 2) * WB.dz;
        const m = new THREE.Mesh(geo, dim);
        m.position.z = z;
        m.userData = { rc, z, r1, r2 };
        g.add(m); tubes.push(m);
      }
    }
    const arr = arrows(400, { color: COL.B, clip: LEFT });
    g.add(arr);
    // the strip in the half-plane phi = phi0
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shellMat({ color: COL.S, base: 0.16, rim: 0.0 }));
    const stripEdge = lines([], { color: COL.S, width: 2.2 });
    g.add(strip, stripEdge);
    const hits = dots(128, { size: 10 });
    g.add(hits);
    parts.B = { g, tubes, dim, lit, arr, strip, stripEdge, hits };
    // the cell boundaries on the divider: log-spaced lines and plane lines
    const grid = [];
    for (let i = 0; i <= WB.nr; i++) { const r = WB.r0 * Math.exp(WB.k * i); grid.push([[0.001, r, -WB.nz / 2 * WB.dz], [0.001, r, WB.nz / 2 * WB.dz]]); }
    for (let j = 0; j <= WB.nz; j++) { const z = (j - WB.nz / 2) * WB.dz; grid.push([[0.001, WB.r0, z], [0.001, WB.r0 * Math.exp(WB.k * WB.nr), z]]); }
    g.add(lines(grid, { color: COL.B, width: 1, opacity: 0.35 }));
    root.add(g);
  }
  const PHI0 = 0.42;   // the strip's half-plane, on the form side
  function layoutB() {
    const B = parts.B;
    let n = 0;
    const b0 = 1 / (TAU * 0.3);
    for (const r of [0.3, 0.6, 1.0, 1.55, 2.2]) for (const z of [-1.5, -0.5, 0.5, 1.5]) for (let a = 0; a < 20; a++) {
      const ph = (a + 0.5) / 20 * TAU, x = r * Math.cos(ph), y = r * Math.sin(ph);
      if (x > -0.06) continue;
      const b = G.wireB([x, y, z], P.I);
      setArrow(B.arr, n++, [x, y, z], b, 0.34 * Math.pow(Math.min(1, G.len(b) / b0), 0.5), 1);
    }
    B.arr.count = n; B.arr.instanceMatrix.needsUpdate = true;
    // the strip: its edges sit on cell boundaries, so the count is exact
    const cr = clamp(Math.round(P.cellsR), 1, WB.nr - 1), cz = clamp(Math.round(P.cellsZ), 1, WB.nz);
    const r1 = WB.r0 * Math.exp(WB.k), r2 = WB.r0 * Math.exp(WB.k * (1 + cr));
    const z1 = -Math.floor(cz / 2) * WB.dz, z2 = z1 + cz * WB.dz;
    const c = Math.cos(PHI0), s = Math.sin(PHI0);
    B.strip.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    const v = [[r1, z1], [r2, z1], [r2, z2], [r1, z2]].map(([r, z]) => [r * c, -r * s, z]);
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...v[0], ...v[1], ...v[2], ...v[0], ...v[2], ...v[3]], 3));
    geo.computeVertexNormals();
    B.strip.geometry = geo;
    setLines(B.stripEdge, [v.concat([v[0]])]);
    B.box = { r1, r2, z1, z2 };
    // tubes pierced: the centre circle crosses the strip
    let hit = 0, hd = 0;
    const cB = rgb('#ffffff');
    for (const t of B.tubes) {
      const u = t.userData, on = u.rc > r1 && u.rc < r2 && u.z > z1 && u.z < z2;
      t.material = on ? B.lit : B.dim;
      if (on) { hit++; B.hits.setDot(hd++, [u.rc * c, -u.rc * s, u.z], cB, 0.95, 1); }
    }
    B.hits.commit(hd);
    const unit = P.I / TAU * WB.k * WB.dz;
    B.read = { hit, flux: P.I / TAU * Math.log(r2 / r1) * (z2 - z1), unit };
  }

  // ── rho: a 3-form, dots per volume ───────────────────────────────────────
  const QDOT = 1 / 400;
  function buildRho() {
    const g = new THREE.Group();
    const r = G.rng(17), pts = [];
    const blob = (c, s, n) => { for (let i = 0; i < n; i++) { const u = () => { let a = 0; for (let k = 0; k < 4; k++) a += r(); return (a - 2) * s * 1.7; }; pts.push([c[0] + u(), c[1] + u(), c[2] + u()]); } };
    blob([-0.75, 0.1, 0.25], 0.33, 700); blob([0.8, -0.2, -0.3], 0.42, 500);
    const d = dots(pts.length, { size: 4.5 });
    g.add(d);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shellMat({ color: COL.S, base: 0.07, rim: 0.25 }));
    const edges = lines([], { color: COL.S, width: 2 });
    g.add(box, edges);
    parts.rho = { g, pts, d, box, edges };
    root.add(g);
  }
  function updateRho(dt, t) {
    const R = parts.rho;
    const x = P.auto ? 1.25 * Math.sin(t * 0.32) : P.boxX * 1.4, s = P.boxS;
    const c = [x, 0, 0.05 * Math.sin(t * 0.5)];
    R.box.position.set(...c); R.box.scale.setScalar(s);
    const h = s / 2, k = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(v => G.add(c, G.mul(v, h)));
    setLines(R.edges, [[k[0], k[1], k[2], k[3], k[0]], [k[4], k[5], k[6], k[7], k[4]], [k[0], k[4]], [k[1], k[5]], [k[2], k[6]], [k[3], k[7]]]);
    const on = rgb(COL.Q), off = rgb('#7a5677');
    let n = 0;
    R.pts.forEach((p, i) => {
      const ins = Math.abs(p[0] - c[0]) < h && Math.abs(p[1] - c[1]) < h && Math.abs(p[2] - c[2]) < h;
      if (ins) n++;
      R.d.setDot(i, p, ins ? on : off, ins ? 1 : 0.45, ins ? 1.35 : 0.85);
    });
    R.d.commit(R.pts.length);
    R.read = { n, Q: n * QDOT };
  }

  // ── J: a 2-form, current tubes in a thick wire ───────────────────────────
  const WJ = { R: 0.5, sp: 0.15, L: 4.6 };
  function buildJ() {
    const g = new THREE.Group();
    const centres = [];
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const x = (i + (j % 2 ? 0.5 : 0)) * WJ.sp, y = j * WJ.sp * Math.sqrt(3) / 2;
      if (Math.hypot(x, y) < WJ.R - 0.04) centres.push([x, y]);
    }
    const dim = glowMat(COL.J, { emissive: 0.3, clip: RIGHT }), lit = glowMat(COL.J, { emissive: 1.0, clip: RIGHT });
    const geo = new THREE.CylinderGeometry(0.022, 0.022, WJ.L, 10);
    geo.rotateX(Math.PI / 2);
    const tubes = centres.map(([x, y]) => { const m = new THREE.Mesh(geo, dim); m.position.set(x, y, 0); g.add(m); return m; });
    const skin = new THREE.Mesh(new THREE.CylinderGeometry(WJ.R, WJ.R, WJ.L, 96, 1, true).rotateX(Math.PI / 2), shellMat({ color: COL.J, base: 0.02, rim: 0.3 }));
    g.add(skin);
    const arr = arrows(200, { color: COL.J, clip: LEFT });
    g.add(arr);
    const flow = dots(centres.length * 7, { size: 5.5, clip: RIGHT });
    g.add(flow);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 96), shellMat({ color: COL.S, base: 0.13, rim: 0.0 }));
    const discEdge = lines([], { color: COL.S, width: 2.2 });
    g.add(disc, discEdge);
    const hits = dots(centres.length, { size: 9 });
    g.add(hits);
    parts.J = { g, centres, tubes, dim, lit, arr, flow, disc, discEdge, hits };
    root.add(g);
  }
  function layoutJArrows() {
    const J = parts.J;
    let n = 0;
    for (const [x, y] of J.centres) for (const z of [-1.6, -0.5, 0.6, 1.7]) {
      if (x > -0.03) continue;
      setArrow(J.arr, n++, [x, y, z - 0.18], [0, 0, 1], 0.36, 0.7);
    }
    J.arr.count = n; J.arr.instanceMatrix.needsUpdate = true;
  }
  function updateJ(dt, t) {
    const J = parts.J;
    const tilt = P.auto ? 0.65 * Math.sin(t * 0.35) : P.tilt, rd = P.discR;
    const n = [Math.sin(tilt), 0, Math.cos(tilt)];
    J.disc.scale.setScalar(rd);
    J.disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...n));
    const e1 = [Math.cos(tilt), 0, -Math.sin(tilt)], e2 = [0, 1, 0];
    setLines(J.discEdge, [Array.from({ length: 97 }, (_, i) => G.add(G.mul(e1, rd * Math.cos(i / 96 * TAU)), G.mul(e2, rd * Math.sin(i / 96 * TAU))))]);
    let hit = 0;
    const w = rgb('#ffffff');
    J.centres.forEach(([x, y], i) => {
      const z = -(n[0] * x + n[1] * y) / n[2], on = Math.hypot(x, y, z) <= rd;
      J.tubes[i].material = on ? J.lit : J.dim;
      if (on) J.hits.setDot(hit++, [x, y, z], w, 0.9, 1);
    });
    J.hits.commit(hit);
    // the exact current: the part of the wire's cross-section inside the
    // disc's shadow (an ellipse rd cos(tilt) by rd), on a 120 x 120 grid
    if (J.lastKey !== tilt.toFixed(3) + rd) {
      J.lastKey = tilt.toFixed(3) + rd;
      let inn = 0, all = 0;
      const ax = rd * Math.cos(tilt), N = 120;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = -WJ.R + (i + 0.5) / N * 2 * WJ.R, y = -WJ.R + (j + 0.5) / N * 2 * WJ.R;
        if (x * x + y * y > WJ.R * WJ.R) continue;
        all++;
        if ((x / ax) ** 2 + (y / rd) ** 2 <= 1) inn++;
      }
      J.exact = inn / all;
    }
    // charges riding the tubes: J = rho v
    const pk = rgb(COL.Q);
    let k = 0;
    J.centres.forEach(([x, y], i) => {
      for (let j = 0; j < 7; j++) {
        const z = ((j / 7 + 0.37 * i % 1 + t * 0.12) % 1) * WJ.L - WJ.L / 2;
        J.flow.setDot(k++, [x, y, z], pk, 0.9, 1);
      }
    });
    J.flow.commit(k);
    J.read = { hit, total: J.centres.length, tilt, exact: J.exact };
  }

  // ── Hodge star: sheets <-> tubes (chapter 4) ─────────────────────────────
  function buildHodge() {
    const g = new THREE.Group();
    // charge on the left at x = -1.3: E sheets (spheres) <-> star E tubes (cones)
    const cq = [-1.35, 0, 0];
    const cg = new THREE.Group(); cg.position.set(...cq); g.add(cg);
    cg.add(charge(1));
    const sph = [];
    const sgeo = new THREE.SphereGeometry(1, 64, 40);
    for (const r of [0.3, 0.42, 0.6, 0.85, 1.2]) { const m = new THREE.Mesh(sgeo, shellMat({ color: COL.E, base: 0.04, rim: 0.5 })); m.scale.setScalar(r); m.userData.r = r; cg.add(m); sph.push(m); }
    // star E: radial tubes through equal-area cells (cos theta and phi equal steps)
    const rays = [];
    const nT = 6, nP = 10;
    for (let i = 0; i < nT; i++) for (let j = 0; j < nP; j++) {
      const ct = 1 - 2 * (i + 0.5) / nT, st = Math.sqrt(1 - ct * ct), ph = (j + 0.5 + (i % 2) * 0.5) / nP * TAU;
      rays.push([st * Math.cos(ph), st * Math.sin(ph), ct]);
    }
    const tubeE = lines(rays.map(d => [G.mul(d, 0.1), G.mul(d, 1.25)]), { color: COL.E, width: 2.4, opacity: 1 });
    cg.add(tubeE);
    // wire on the right at x = +1.35: B tubes (tori) <-> star B sheets (half-planes)
    const cw = [1.35, 0, 0];
    const wg = new THREE.Group(); wg.position.set(...cw); g.add(wg);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.6, 20), glowMat(COL.J, { emissive: 1.1 }));
    wire.rotation.x = Math.PI / 2; wg.add(wire);
    const tor = [];
    for (let i = 0; i < 4; i++) {
      const r1 = 0.14 * Math.pow(1.6, i), r2 = r1 * 1.6, rc = Math.sqrt(r1 * r2);
      for (let j = -2; j <= 2; j++) { const m = new THREE.Mesh(new THREE.TorusGeometry(rc, Math.min(0.28 * (r2 - r1), 0.1), 14, 120), glowMat(COL.B, { emissive: 0.7, opacity: 1 })); m.position.z = j * 0.42; wg.add(m); tor.push(m); }
    }
    const planes = [];
    const pgeo = new THREE.PlaneGeometry(1, 1);
    for (let k = 0; k < 12; k++) {
      const ph = k / 12 * TAU;
      const m = new THREE.Mesh(pgeo, shellMat({ color: COL.B, base: 0.12, rim: 0.25 }));
      m.userData.ph = ph;
      wg.add(m); planes.push(m);
    }
    const planeEdges = lines([], { color: COL.B, width: 1.6, opacity: 0.9 });
    wg.add(planeEdges);
    parts.H = { g, sph, tubeE, tor, planes, planeEdges, cg, wg, rays };
    root.add(g);
    lab('<i>q</i>', () => (P.mode === 'hodge' ? [cq[0], cq[1], 1.55] : null), 'q');
    lab('<i>I</i>', () => (P.mode === 'hodge' ? [cw[0], cw[1], 1.95] : null), 'j');
  }
  function updateHodge(dt, t) {
    const H = parts.H;
    const m = P.auto ? ease(0.5 - 0.5 * Math.cos(t * 0.45)) : P.mix;
    H.mix = m;
    // sheets of E fade and shrink to the charge; the radial tubes grow out
    H.sph.forEach(s => { s.visible = m < 0.995; s.material.uniforms.uOpacity.value = 1 - m; s.scale.setScalar(s.userData.r * (1 - 0.25 * m)); });
    H.tubeE.visible = m > 0.005;
    H.tubeE.material.opacity = m;
    const lenE = 0.1 + 1.15 * m;
    setLines(H.tubeE, H.rays.map(d => [G.mul(d, 0.1), G.mul(d, lenE)]));
    // tubes of B fade; half-planes fan out from the wire
    H.tor.forEach(o => { o.visible = m < 0.995; o.material.opacity = 1 - m; o.material.transparent = true; o.scale.setScalar(1 - 0.2 * m); });
    const R = 0.05 + 1.15 * m, Z = 1.0;
    const edges = [];
    H.planes.forEach(p => {
      p.visible = m > 0.005;
      const ph = p.userData.ph, c = Math.cos(ph), s = Math.sin(ph);
      p.scale.set(R, 2 * Z, 1);
      p.position.set(c * (0.03 + R / 2), s * (0.03 + R / 2), 0);
      p.quaternion.setFromEuler(new THREE.Euler(0, 0, ph)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
      p.material.uniforms.uOpacity.value = m;
      edges.push([[c * 0.03, s * 0.03, Z], [c * (0.03 + R), s * (0.03 + R), Z], [c * (0.03 + R), s * (0.03 + R), -Z], [c * 0.03, s * 0.03, -Z]]);
    });
    setLines(H.planeEdges, m > 0.005 ? edges : []);
    H.planeEdges.material.opacity = m;
  }

  buildE(); buildB(); buildRho(); buildJ(); buildHodge();

  function show() {
    const m = P.mode;
    parts.E.g.visible = m === 'E';
    parts.B.g.visible = m === 'B';
    parts.rho.g.visible = m === 'rho';
    parts.J.g.visible = m === 'J';
    parts.H.g.visible = m === 'hodge';
    divider.visible = m === 'E' || m === 'B' || m === 'J';
  }

  const api = {
    group: root, P,
    enter(mode, params = {}) {
      Object.assign(P, params, { mode });
      show();
      if (mode === 'E') { parts.E.s = 0; parts.E.hold = 0; layoutE(); }
      if (mode === 'B') layoutB();
      if (mode === 'J') layoutJArrows();
    },
    set(key, v) {
      P[key] = v;
      if (P.mode === 'E' && (key === 'q' || key === 'endAng')) layoutE();
      if (P.mode === 'B') layoutB();
    },
    update(dt, t) {
      if (P.mode === 'E') updateE(dt);
      else if (P.mode === 'B') {
        if (P.auto) {
          const cr = 1 + Math.floor((t / 2.2) % 5), cz = 2 + Math.floor((t / 3.1) % 6);
          if (cr !== P.cellsR || cz !== P.cellsZ) { P.cellsR = cr; P.cellsZ = cz; layoutB(); }
        }
      }
      else if (P.mode === 'rho') updateRho(dt, t);
      else if (P.mode === 'J') updateJ(dt, t);
      else if (P.mode === 'hodge') updateHodge(dt, t);
    },
    readout() {
      const f = v => v.toFixed(3);
      if (P.mode === 'E' && parts.E.read) {
        const r = parts.E.read;
        return [['sheets crossed', `${r.crossed}`, 'm2'], ['sheets × Δφ', f(r.crossed * r.dphi), 'm2'], ['∫ E·dl along the path', f(r.integral), 'm2']];
      }
      if (P.mode === 'B' && parts.B.read) {
        const r = parts.B.read;
        return [['tubes pierced', `${r.hit}`, 'm1'], ['tubes × flux per tube', f(r.hit * r.unit), 'm1'], ['∫ B·dA over the strip', f(Math.abs(r.flux)), 'm1']];
      }
      if (P.mode === 'rho' && parts.rho.read) {
        const r = parts.rho.read;
        return [['dots in the box', `${r.n}`, 'm4'], ['charge in the box', f(r.Q), 'm4'], ['charge in all', f(parts.rho.pts.length * QDOT), 'm4']];
      }
      if (P.mode === 'J' && parts.J.read) {
        const r = parts.J.read;
        return [['tubes cut by the disc', `${r.hit} of ${r.total}`, 'm5'], ['disc tilt', `${(r.tilt * 180 / Math.PI).toFixed(0)}°`, 'm3'], ['tubes ÷ all tubes', f(r.hit / r.total), 'm5'], ['∫ J·dA ÷ I (exact)', f(r.exact), 'm5']];
      }
      if (P.mode === 'hodge' && parts.H.mix != null) {
        const m = parts.H.mix;
        return [['picture', m < 0.5 ? 'F: E sheets, B tubes' : '⋆F: E tubes, B sheets', 'm6'], ['tubes of ⋆E that leave the charge', '60', 'm2'], ['sheets of ⋆B that a loop round the wire crosses', '12', 'm1']];
      }
      return [];
    },
    anchor() {
      if (P.mode === 'hodge') return { c: [0, 0, 0], r: 2.6 };
      return { c: [0, 0, 0], r: 2.4 };
    },
  };
  return api;
}
