// ============================================================================
//  CORAL REEF  ·  ROV  ·  the cables: support ship and one tether a vehicle
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "what happened to the cables attached to
//  ROV/s ?", then: "we should remove the giant mesh we're attaching all
//  the rov's to". So there is no cage (TMS). An endless world has no fixed
//  ship, so a support ship on the surface follows the squad centroid
//  slowly. Each ROV has its own slack tether. The tether goes up from the
//  ROV termination toward a sheave under the moon pool of the ship (one
//  sheave a slot, SHEAVE). The rope ends RISE m along that line (the top),
//  far above the lamps and out of view in the dark. Where the ship is
//  nearer than RISE (the shallows), the rope ends at the sheave. So the
//  tethers converge on the ship at every depth, with no switch and no jump.
//
//  The ropes are rov/tether.js verlet ropes in world metres (Float64),
//  so a floating-origin shift does not move them. The tubes are filled in
//  render space (world minus the origin) each frame. Each rope collides
//  with the solid (o.sdf: metres, rock, sand and coral) and with a sphere
//  round each ROV body (BODY_R m). The tethers push apart where two come
//  nearer than SEP m, so they can cross but not pass through each other.
//  A top in the rock goes up out of it. A squad jump of more than JUMP m
//  in one step (a region jump behind the fade) resets the ship and ropes.
//
//  The leash (LEASH m, horizontal from the squad centroid) is the limit of
//  rov/squad.js and manual.js. The SSTV feed goes up the tether to the
//  ship (index.html explainer).
//
//  BUDGET (per device profile, CABLE_Q): rope points, tube rings x sides.
//  desktop 56 / 240 x 16, laptop-low 40 / 160 x 12, phone 30 / 96 x 8,
//  phone-min 24 / 64 x 6. Up to 4 tethers (one a vehicle).
//
//  USE (DOM-free core, node tests)
//    const C = createCableSim({ sdf, profile, surfaceY, count });
//    C.step(dt, rovs)   rovs: [{ id, p: [x, y, z] body centre, term: [x, y, z]
//                       termination }] in world metres
//    C.ship (world [x, y, z]), C.tops (the top end of each tether), C.leash
//    (m, horizontal from the centroid), C.excursion (m, the most tether),
//    C.ropes [{ kind: 'tether', id, slot, rope }]
//  Three wrapper (the page)
//    const K = createCables(THREE, { scene, sdf, profile, surfaceY, origin })
//    K.update(dt, rovs) K.setEnabled(on) K.enabled K.sim K.cost() K.dispose()
//
//  grep -n targets
//    "export const CABLE_Q", "export function createCableSim",
//    "function topOf", "function bodySdf", "function separate",
//    "export function createCables", "export function cableCost"
// ============================================================================
import { createTether, createTetherTube, braidTexel } from './tether.js';

export const CABLE_Q = {
  desktop: { n: 56, rings: 240, radial: 16 },
  'laptop-low': { n: 40, rings: 160, radial: 12 },
  phone: { n: 30, rings: 96, radial: 8 },
  'phone-min': { n: 24, rings: 64, radial: 6 },
};
export const RISE = 110, BODY_R = 0.8, SEP = 0.35, JUMP = 60;
export const LEASH = 180, EXCURSION = 240;
// the sheaves under the moon pool of the ship (m from the ship at the
// surface), one a tether slot
const SHEAVE = [[0.9, -5.2, 0.9], [-0.9, -5.2, 0.9], [-0.9, -5.2, -0.9], [0.9, -5.2, -0.9]];

export function cableCost(profile) {
  const q = CABLE_Q[profile] || CABLE_Q.phone, tubes = 4;
  return { tubes, points: tubes * (q.n + 1), tris: tubes * (q.rings - 1) * q.radial * 2, verts: tubes * q.rings * (q.radial + 1) };
}

export function createCableSim({ sdf, profile = 'desktop', surfaceY = 55, count = 4 } = {}) {
  const q = CABLE_Q[profile] || CABLE_Q.phone;
  const ship = [0, surfaceY, 0], cen = [0, 0, 0], tops = [];
  let ropes = [], started = false, body = [];
  // the solid plus the ROV bodies (metres)
  function bodySdf(x, y, z) {
    let d = sdf ? sdf(x, y, z) : Infinity;
    for (let i = 0; i < body.length; i++) { const b = body[i]; const e = Math.hypot(x - b[0], y - b[1], z - b[2]) - BODY_R; if (e < d) d = e; }
    return d;
  }
  // the top end of tether i: RISE m from the termination toward its
  // sheave, or the sheave when it is nearer; out of the rock
  function topOf(i, term, out) {
    const s = SHEAVE[i & 3], sx = ship[0] + s[0], sy = surfaceY + s[1], sz = ship[2] + s[2];
    const dx = sx - term[0], dy = sy - term[1], dz = sz - term[2], d = Math.hypot(dx, dy, dz) || 1e-6, k = Math.min(1, RISE / d);
    out[0] = term[0] + dx * k; out[1] = term[1] + dy * k; out[2] = term[2] + dz * k;
    for (let j = 0; j < 12 && k < 1 && sdf && sdf(out[0], out[1], out[2]) < 3; j++) out[1] = Math.min(sy, out[1] + 3);
    return out;
  }
  function build(rovs) {
    ropes = rovs.map((r, i) => ({ kind: 'tether', id: r.id, slot: i, rope: createTether({ n: q.n, a: r.term, b: topOf(i, r.term, tops[i] = [0, 0, 0]), weight: 0.15, slack: 1.06, radius: 0.06, mid: true }) }));
    tops.length = rovs.length;
  }
  function centroid(rovs) {
    cen[0] = cen[1] = cen[2] = 0;
    for (const r of rovs) { cen[0] += r.p[0] / rovs.length; cen[1] += r.p[1] / rovs.length; cen[2] += r.p[2] / rovs.length; }
    return cen;
  }
  // the ship over the centroid, slowly (tau 30 s, at most 2.5 m/s)
  function place(c, dt, snap) {
    const es = snap ? 1 : 1 - Math.exp(-dt / 30), vs = 2.5 * dt;
    for (const k of [0, 2]) { const d = (c[k] - ship[k]) * es; ship[k] += snap ? d : Math.max(-vs, Math.min(vs, d)); }
  }
  // two tethers nearer than SEP: push the points apart (not the fixed ends)
  function separate() {
    for (let a = 0; a < ropes.length; a++) for (let b = a + 1; b < ropes.length; b++) {
      const P = ropes[a].rope.points, Q = ropes[b].rope.points, n = ropes[a].rope.count - 1;
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
    ship, tops, leash: LEASH, excursion: EXCURSION, quality: q, jumps: 0,
    get ropes() { return ropes; },
    step(dt, rovs) {
      if (!rovs || !rovs.length) return S;
      dt = Math.min(dt, 0.05);
      const prev = cen.slice(), c = centroid(rovs);
      const jump = started && Math.hypot(c[0] - prev[0], c[2] - prev[2]) > JUMP;
      body = rovs.map(r => r.p);
      if (!started || jump || ropes.length !== rovs.length) {
        place(c, dt, true); build(rovs); started = true; if (jump) S.jumps++;
      } else place(c, dt, false);
      rovs.forEach((r, i) => ropes[i].rope.step(dt, r.term, topOf(i, r.term, tops[i]), bodySdf));
      separate();
      return S;
    },
    topOf, bodySdf,
  };
  return S;
}

// The three part: one tube mesh per tether (no cage, no ship mesh).
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
  // no ship mesh: the user said "remove the central submarine object/boat
  // object that's not right". The ship stays as an invisible anchor point
  // in the sim (sim.ship), where the tethers go up into the dark.
  const tubes = [];
  const scratch = new Float64Array((q.n + 1) * 3);
  function tubeFor(i, kind) {
    if (tubes[i]) return tubes[i];
    const tube = createTetherTube({ rings: q.rings, radial: q.radial, radius: 0.022 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tube.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(tube.normals, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(tube.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(tube.indices, 1));
    const mesh = new THREE.Mesh(g, matEx);
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
      return K;
    },
    cost: () => cableCost(profile),
    dispose() {
      if (group.parent) group.parent.remove(group);
      group.traverse(m => { if (m.geometry) m.geometry.dispose(); });
      matEx.dispose();
      tex.dispose();
    },
  };
  return K;
}
