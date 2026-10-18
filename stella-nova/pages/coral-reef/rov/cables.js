// ============================================================================
//  CORAL REEF  ·  ROV  ·  the cables: support ship, cage (TMS), tethers
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "what happened to the cables attached to
//  ROV/s ?". An endless world has no fixed ship, so the ship follows the
//  squad. A support ship on the surface follows the cage slowly. A main
//  umbilical (a heavy, nearly taut cable) goes down from the ship to a
//  tether management system (TMS) cage. The cage hangs CAGE_UP m over the
//  highest ROV and follows the squad centroid. An excursion tether (a
//  near-neutral cable with slack) goes from a corner of the cage to each
//  ROV. In the shallows the cage stops CAGE_SURF m under the surface: the
//  same topology at every depth, so a dive from the reef to the abyss
//  has no switch and no jump.
//
//  The ropes are rov/tether.js verlet ropes in world metres (Float64),
//  so a floating-origin shift does not move them. The tubes are filled in
//  render space (world minus the origin) each frame. Each rope collides
//  with the solid (o.sdf: metres, rock, sand and coral) and with a sphere
//  round each ROV body (BODY_R m). The excursion tethers push apart where
//  two come nearer than SEP m, so they can cross but not pass through
//  each other. A squad jump of more than JUMP m in one step (a region
//  jump behind the fade) resets the ship, the cage and the ropes.
//
//  The SSTV feed goes up the excursion tether, the cage and the umbilical
//  to the ship (index.html explainer).
//
//  BUDGET (per device profile, CABLE_Q): rope points, tube rings x sides.
//  desktop 56 / 240 x 16, laptop-low 40 / 160 x 12, phone 30 / 96 x 8,
//  phone-min 24 / 64 x 6. One umbilical and up to 4 excursion tethers.
//
//  USE (DOM-free core, node tests)
//    const C = createCableSim({ sdf, profile, surfaceY, count });
//    C.step(dt, rovs)   rovs: [{ id, p: [x, y, z] body centre, term: [x, y, z]
//                       termination }] in world metres
//    C.ship, C.cage (world [x, y, z]), C.leash (m, horizontal from the
//    cage), C.excursion (m, the tether length), C.ropes [{ kind, id, rope }]
//  Three wrapper (the page)
//    const K = createCables(THREE, { scene, sdf, profile, surfaceY, origin })
//    K.update(dt, rovs) K.setEnabled(on) K.enabled K.sim K.cost() K.dispose()
//
//  grep -n targets
//    "export const CABLE_Q", "export function createCableSim",
//    "function bodySdf", "function separate", "export function createCables",
//    "export function cableCost"
// ============================================================================
import { createTether, createTetherTube, braidTexel } from './tether.js';

export const CABLE_Q = {
  desktop: { n: 56, rings: 240, radial: 16 },
  'laptop-low': { n: 40, rings: 160, radial: 12 },
  phone: { n: 30, rings: 96, radial: 8 },
  'phone-min': { n: 24, rings: 64, radial: 6 },
};
export const CAGE_UP = 30, CAGE_SURF = 6, BODY_R = 0.8, SEP = 0.35, JUMP = 60;
export const LEASH = 180, EXCURSION = 240;
// the four cage corners (m from the cage centre) where the tethers leave
const CORNER = [[0.9, -1.1, 0.9], [-0.9, -1.1, 0.9], [-0.9, -1.1, -0.9], [0.9, -1.1, -0.9]];

export function cableCost(profile) {
  const q = CABLE_Q[profile] || CABLE_Q.phone, tubes = 5;
  return { tubes, points: tubes * (q.n + 1), tris: tubes * (q.rings - 1) * q.radial * 2, verts: tubes * q.rings * (q.radial + 1) };
}

export function createCableSim({ sdf, profile = 'desktop', surfaceY = 55, count = 4 } = {}) {
  const q = CABLE_Q[profile] || CABLE_Q.phone;
  const ship = [0, surfaceY, 0], cage = [0, surfaceY - CAGE_SURF, 0], cen = [0, 0, 0];
  let ropes = [], started = false, body = [];
  // the solid plus the ROV bodies (metres)
  function bodySdf(x, y, z) {
    let d = sdf ? sdf(x, y, z) : Infinity;
    for (let i = 0; i < body.length; i++) { const b = body[i]; const e = Math.hypot(x - b[0], y - b[1], z - b[2]) - BODY_R; if (e < d) d = e; }
    return d;
  }
  const corner = (i) => [cage[0] + CORNER[i & 3][0], cage[1] + CORNER[i & 3][1], cage[2] + CORNER[i & 3][2]];
  function build(rovs) {
    ropes = [{ kind: 'umbilical', id: 0, rope: createTether({ n: q.n, a: [cage[0], cage[1] + 1.2, cage[2]], b: ship, weight: 0.8, slack: 1.01, radius: 0.08, mid: true }) }];
    rovs.forEach((r, i) => ropes.push({ kind: 'excursion', id: r.id, slot: i, rope: createTether({ n: q.n, a: r.term, b: corner(i), weight: 0.15, slack: 1.06, radius: 0.06, mid: true }) }));
  }
  function centroid(rovs) {
    cen[0] = cen[1] = cen[2] = 0; let top = -Infinity;
    for (const r of rovs) { cen[0] += r.p[0] / rovs.length; cen[2] += r.p[2] / rovs.length; top = Math.max(top, r.p[1]); }
    cen[1] = top;
    return cen;
  }
  function place(c, dt, snap) {
    // the cage: over the centroid, CAGE_UP over the highest ROV, under the surface
    const cy = Math.min(surfaceY - CAGE_SURF, c[1] + CAGE_UP);
    const e = snap ? 1 : 1 - Math.exp(-dt / 20), vmax = 3 * dt;
    const mv = (p, k, t) => { const d = (t - p[k]) * e; p[k] += snap ? d : Math.max(-vmax, Math.min(vmax, d)); };
    mv(cage, 0, c[0]); mv(cage, 2, c[2]); mv(cage, 1, cy);
    // out of the rock: step up (the cage is 2.4 m tall)
    for (let k = 0; k < 8 && sdf && sdf(cage[0], cage[1], cage[2]) < 4; k++) cage[1] = Math.min(surfaceY - 2, cage[1] + 2);
    // the ship over the cage, slower
    const es = snap ? 1 : 1 - Math.exp(-dt / 30), vs = 2.5 * dt;
    for (const k of [0, 2]) { const d = (cage[k] - ship[k]) * es; ship[k] += snap ? d : Math.max(-vs, Math.min(vs, d)); }
  }
  // two excursion tethers nearer than SEP: push the points apart (not the fixed ends)
  function separate() {
    const ex = ropes.filter(r => r.kind === 'excursion');
    for (let a = 0; a < ex.length; a++) for (let b = a + 1; b < ex.length; b++) {
      const P = ex[a].rope.points, Q = ex[b].rope.points, n = ex[a].rope.count - 1;
      for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
        const dx = P[i * 3] - Q[j * 3], dy = P[i * 3 + 1] - Q[j * 3 + 1], dz = P[i * 3 + 2] - Q[j * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= SEP * SEP) continue;
        const d = Math.sqrt(d2) || 1e-6, s = (SEP - d) / d * 0.5;
        P[i * 3] += dx * s; P[i * 3 + 1] += dy * s; P[i * 3 + 2] += dz * s;
        Q[j * 3] -= dx * s; Q[j * 3 + 1] -= dy * s; Q[j * 3 + 2] -= dz * s;
      }
    }
  }
  const S = {
    ship, cage, leash: LEASH, excursion: EXCURSION, quality: q, jumps: 0,
    get ropes() { return ropes; },
    step(dt, rovs) {
      if (!rovs || !rovs.length) return S;
      dt = Math.min(dt, 0.05);
      const prev = cen.slice(), c = centroid(rovs);
      const jump = started && Math.hypot(c[0] - prev[0], c[2] - prev[2]) > JUMP;
      body = rovs.map(r => r.p);
      if (!started || jump || ropes.length !== rovs.length + 1) {
        place(c, dt, true); build(rovs); started = true; if (jump) S.jumps++;
      } else place(c, dt, false);
      const top = [cage[0], cage[1] + 1.2, cage[2]];
      ropes[0].rope.step(dt, top, ship, sdf);
      rovs.forEach((r, i) => ropes[i + 1].rope.step(dt, r.term, corner(i), bodySdf));
      separate();
      return S;
    },
    bodySdf,
  };
  return S;
}

// The three part: one tube mesh per rope, the cage and the ship.
export function createCables(THREE, o = {}) {
  const profile = o.profile || 'desktop', q = CABLE_Q[profile] || CABLE_Q.phone, surfaceY = o.surfaceY ?? 55;
  const origin = o.origin || (() => [0, 0]);
  const sim = createCableSim({ sdf: o.sdf, profile, surfaceY });
  const group = new THREE.Group(); group.name = 'rov-cables';
  if (o.scene) o.scene.add(group);
  const braid = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const b = Math.round(255 * braidTexel(x / 64, y / 64)), k = (y * 64 + x) * 4; braid[k] = braid[k + 1] = braid[k + 2] = b; braid[k + 3] = 255; }
  const tex = new THREE.DataTexture(braid, 64, 64, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  const matEx = new THREE.MeshStandardMaterial({ color: 0xd8a21c, roughness: 0.65, metalness: 0, map: tex });
  const matUm = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.55, metalness: 0.1, map: tex });
  // the cage: a frame with a sheave on top; the ship: a dark hull with lights
  const cageG = new THREE.Group(), cageMat = new THREE.MeshStandardMaterial({ color: 0x9c8c55, roughness: 0.7, metalness: 0.3 });
  for (const [sx, sy, sz, x, y, z] of [[2.2, 0.12, 0.12, 0, 1.1, 0.95], [2.2, 0.12, 0.12, 0, 1.1, -0.95], [0.12, 0.12, 2, 1.05, 1.1, 0], [0.12, 0.12, 2, -1.05, 1.1, 0],
    [2.2, 0.12, 0.12, 0, -1.1, 0.95], [2.2, 0.12, 0.12, 0, -1.1, -0.95], [0.12, 0.12, 2, 1.05, -1.1, 0], [0.12, 0.12, 2, -1.05, -1.1, 0],
    [0.12, 2.2, 0.12, 1.05, 0, 0.95], [0.12, 2.2, 0.12, -1.05, 0, 0.95], [0.12, 2.2, 0.12, 1.05, 0, -0.95], [0.12, 2.2, 0.12, -1.05, 0, -0.95], [1.4, 0.9, 1.4, 0, 0.2, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), cageMat); m.position.set(x, y, z); cageG.add(m);
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
  const shipG = new THREE.Group(), hullMat = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 1, metalness: 0 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(52, 5, 13), hullMat); hull.position.y = -2.4; shipG.add(hull);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(40, 1.6, 6), hullMat); keel.position.y = -5.4; shipG.add(keel);
  const pool = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 5), new THREE.MeshBasicMaterial({ color: 0x182028 })); pool.position.y = -5.0; shipG.add(pool);   // the moon pool
  for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lampMat); l.position.set(-20 + i * 8, -4.9, (i & 1 ? 1 : -1) * 6.2); shipG.add(l); }
  group.add(cageG, shipG);
  const tubes = [];
  const scratch = new Float64Array((q.n + 1) * 3);
  function tubeFor(i, kind) {
    if (tubes[i]) return tubes[i];
    const tube = createTetherTube({ rings: q.rings, radial: q.radial, radius: kind === 'umbilical' ? 0.035 : 0.022 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tube.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(tube.normals, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(tube.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(tube.indices, 1));
    const mesh = new THREE.Mesh(g, kind === 'umbilical' ? matUm : matEx);
    mesh.frustumCulled = false; mesh.name = 'rov-cable-' + kind + '-' + i;
    group.add(mesh);
    return (tubes[i] = { tube, mesh });
  }
  let enabled = o.enabled !== false;
  group.visible = enabled;
  const K = {
    sim, group, tubes, profile,
    get enabled() { return enabled; },
    setEnabled(on) { enabled = !!on; group.visible = enabled; },
    update(dt, rovs) {
      if (!enabled || !rovs || !rovs.length) return K;
      sim.step(dt, rovs);
      const O = origin(), R = sim.ropes;
      // fewer ROVs: drop the spare tubes
      for (let i = R.length; i < tubes.length; i++) if (tubes[i]) { group.remove(tubes[i].mesh); tubes[i].mesh.geometry.dispose(); tubes[i] = null; }
      tubes.length = Math.min(tubes.length, R.length);
      R.forEach((r, i) => {
        const T = tubeFor(i, r.kind), P = r.rope.points, n = r.rope.count;
        for (let k = 0; k < n; k++) { scratch[k * 3] = P[k * 3] - O[0]; scratch[k * 3 + 1] = P[k * 3 + 1]; scratch[k * 3 + 2] = P[k * 3 + 2] - O[1]; }
        T.tube.update(scratch, n);
        const a = T.mesh.geometry.attributes; a.position.needsUpdate = true; a.normal.needsUpdate = true; a.uv.needsUpdate = true;
      });
      cageG.position.set(sim.cage[0] - O[0], sim.cage[1], sim.cage[2] - O[1]);
      shipG.position.set(sim.ship[0] - O[0], surfaceY, sim.ship[2] - O[1]);
      return K;
    },
    cost: () => cableCost(profile),
    dispose() {
      if (group.parent) group.parent.remove(group);
      group.traverse(m => { if (m.geometry) m.geometry.dispose(); });
      for (const m of [matEx, matUm, cageMat, lampMat, hullMat]) m.dispose();
      tex.dispose();
    },
  };
  return K;
}
