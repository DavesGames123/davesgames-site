// ============================================================================
//  CORAL REEF  ·  ROV package  ·  public API (CONTRACT-V3.md "ROV API")
// ----------------------------------------------------------------------------
//  Two or three work-class ROVs that survey the reef plot in the dark, light
//  it with their SpotLights and send the lead camera over a simulated SSTV
//  link to a HUD panel. Three r160 is passed in, so the package has no
//  import map of its own and runs in node for the tests.
//
//  USE
//    import { createROVs } from './rov/index.js';
//    const rovs = createROVs(THREE, {
//      scene, renderer,          // renderer null: no camera render (node)
//      feedTag(v) -> { name, sci } | null  the creature in the feed of v
//                                (fauna/hook.js; the HUD label)
//      rock,                     // ROCK createRock(); a stub when missing
//      reef,                     // CORAL createReef() or its mirror (optional)
//      count: 3, seed: 1,        // 2 or 3 vehicles; one seed, one dive
//      quality: 'high' | 'low',  // low: fewer segments, 512 shadow map
//      radius: 30,               // the plot radius (m)
//      depthBase: 26,            // HUD depth = depthBase - y (m)
//      scale: 0.6,               // vehicle size: 2.2 x 1.4 x 1.5 m at 1;
//                                // 0.6 fits ROCK's canyons and arch gaps
//      clear: 1.45 * scale + 0.05,  // the clearance shell (m)
//      feed: { mode: 'r36' | 'm1', speed: 2, hold: 2.5, noise, canvas,
//              document, dpr, worker: true, vehicle: 1 },
//      lightIntensity: 420,      // candela of each SpotLight (r160 units)
//    });
//    rovs.update(dt, t)          // each frame, dt and t in seconds
//    rovs.vehicles[i] = { id (1..n), group, lights: [THREE.SpotLight],
//                         camera (THREE.PerspectiveCamera of the feed),
//                         target (THREE.Vector3: where the camera and
//                         lights look), mode ('survey'|'inspect'|'focus'),
//                         parts (build.js), pilot (pilot.js) }
//    rovs.focusOn(target, mode, o)   // the saver: ONE ROV, ONE colony
//         target: [x, y, z] | THREE.Vector3 | colony index k | colony
//                 object | { get() -> { center, radius } } | null
//         mode: 'inspect' (orbit and push-ins, default) | 'orbit' (a
//               steady orbit) | 'survey' (release: back to autonomous)
//         o: { vehicle: id (default the feed vehicle), radius (m, for a
//              point target) }. The orbit reads the colony bounds every
//              step, so it widens as the colony grows. The camera zooms
//              to hold the colony in the frame.
//    rovs.feed = { canvas, setVehicle(id), update(dt), setMode('r36'|'m1'),
//                  setSpeed(s), hud(), picture: { w, h, data }, link }
//              (createROVs.update calls feed.update; SCENE places canvas)
//    o.makeFeed(base, ids) -> a feed: the page gives rov/feeds.js
//              createFeedSet (one feed per vehicle, the same single-feed API)
//    rovs.lights      every SpotLight, rovs.wash the wash Points
//    rovs.dispose()
//
//  WORLD (CONTRACT-V4.md): the infinite seafloor. Options for it:
//    pilots: [state, ...]   the vehicle states of rov/squad.js (the squad
//                           steps them; update() only poses the models)
//    sdf: f(x, y, z)        the solid (world/physics.js); no coral grid
//    tether: false          no tether of its own: the page draws the
//                           ship and the tethers with rov/cables.js
//    root: THREE.Group      the vehicles go under it (the page puts it at
//                           minus the floating origin); the wash stays in
//                           the scene, in render space
//    origin: () => [ox, oz] the floating origin (render = world - origin)
//    count: 1 to 4
//  The states (p, look) are in world metres; v.target too.
//
//  LIGHT: each vehicle has the soft fill of rov/fill.js (only on the ROV
//  materials); update() feeds it the exposure (o.exposure() or
//  scene.userData.exposure, which scene.js writes) and the lamp level.
//  vehicles[i].parts.setHighlight(on, colour) adds a glow (the HUD).
//
//  SCENE notes: lights[0] of vehicle 1 casts shadows; each light has
//  light.userData.base (its intensity before the flicker) and
//  light.userData.vehicle. The SpotLight targets are children of the
//  vehicle group. The tether, wash and vehicles are added to o.scene.
//
//  Colony bounds: reef.colonyBounds(k) -> { center, radius } if CORAL
//  adds it; else the box of the particles of colony k (reef or its
//  mirror: count, px, py, pz, col; updated with the new particles only)
//  and the base; else base, top and ext of reef.colonies[k].
//
//  FILES (grep -n targets)
//    index.js ....... "export function createROVs", "function colonyBounds"
//    build.js ....... the vehicle model ("export function buildVehicle")
//    pilot.js ....... grid, A*, paths and motion, DOM-free ("export function createPilot")
//    tether.js ...... the verlet rope and its smooth tube ("export function createTether",
//                     "export function createTetherTube"): high 56 points, 240 rings
//                     x 16 sides; low 30 points, 96 rings x 8 sides; one geometry each,
//                     updated in place every frame
//    cables.js ...... the world cables: the ship and one tether a vehicle
//                     (no cage) ("export function createCables")
//    wash.js ........ thruster wash and silt ("export function createWash")
//    link.js ........ the SSTV link over pages/sstv ("export class SstvLink")
//    hud.js ......... the feed panel ("export function drawHud")
//    feed.js ........ render target, link and panel ("export function createFeed")
//    feeds.js ....... one feed per ROV in one render budget ("export function createFeedSet")
//    feed-worker.js . encode and noise in a module worker
//    stub-rock.js ... a stand-in rock for tests ("export function createStubRock")
//    coral-field.js . the coral term of the ROV field ("export function createCoralField")
// ============================================================================
import { buildVehicle } from './build.js';
import { createPilot, createGrid, hash, rng, zoomFov, trace, surfaceY } from './pilot.js';
import { createTether, createTetherTube, braidTexel } from './tether.js';
import { createWash } from './wash.js';
import { createFeed } from './feed.js';
import { createStubRock } from './stub-rock.js';
import { createCoralField } from './coral-field.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── reef adapter ────────────────────────────────────────────────────────────
function colonyList(reef) {
  if (!reef) return [];
  const c = typeof reef.colonies === 'function' ? reef.colonies() : reef.colonies;
  if (!c) return [];
  return Array.isArray(c) ? c : c instanceof Map ? [...c.values()] : Object.values(c);
}
function normBounds(b) {
  if (!b) return null;
  if (b.center) return { center: Array.from(b.center.toArray ? b.center.toArray() : b.center), radius: b.radius ?? 1 };
  if (b.min && b.max) {
    const a = b.min.toArray ? b.min.toArray() : b.min, z = b.max.toArray ? b.max.toArray() : b.max;
    return { center: [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2, (a[2] + z[2]) / 2], radius: Math.hypot(z[0] - a[0], z[1] - a[1], z[2] - a[2]) / 2 };
  }
  return null;
}
// The particle box of each colony, from the particle arrays of the reef
// or its main-thread mirror (count, px, py, pz, col). New particles are
// added each call, so the cost per frame is the growth of that frame. A
// count that goes down (a reset) starts the boxes again.
const TRACK = new WeakMap();
function particleBox(reef, k) {
  if (!reef || reef.count == null || !reef.px || !reef.col) return null;
  let T = TRACK.get(reef);
  if (!T) { T = { seen: 0, box: new Map() }; TRACK.set(reef, T); }
  if (reef.count < T.seen) { T.seen = 0; T.box.clear(); }
  for (let i = T.seen; i < reef.count; i++) {
    const c = reef.col[i], x = reef.px[i], y = reef.py[i], z = reef.pz[i];
    let b = T.box.get(c);
    if (!b) { b = [x, y, z, x, y, z, 0]; T.box.set(c, b); }
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
    b[6]++;
  }
  T.seen = reef.count;
  return T.box.get(k) || null;
}

export function colonyBounds(reef, c) {
  const k = typeof c === 'number' ? c : c && c.k;
  if (reef && typeof reef.colonyBounds === 'function') { const b = normBounds(reef.colonyBounds(k ?? c)); if (b) return b; }
  if (typeof c === 'number') c = colonyList(reef)[c];
  if (!c) return null;
  if (c.bounds) { const b = normBounds(typeof c.bounds === 'function' ? c.bounds() : c.bounds); if (b) return b; }
  const base = c.base || c.position || c.center || (c.user ? [c.user.bx, c.user.by, c.user.bz] : null);
  const box = k != null ? particleBox(reef, k) : null;
  if (box) {
    // the particle box and the base; 0.04 m for the particle radius
    const lo = base ? [Math.min(box[0], base[0]), Math.min(box[1], base[1]), Math.min(box[2], base[2])] : box.slice(0, 3);
    const hi = base ? [Math.max(box[3], base[0]), Math.max(box[4], base[1]), Math.max(box[5], base[2])] : box.slice(3, 6);
    return { center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + 0.04 };
  }
  if (!base) return null;
  const top = c.top ?? base[1], ext = c.ext ?? c.radius ?? 0.1, h = Math.max(0, top - base[1]);
  return { center: [base[0], base[1] + h / 2, base[2]], radius: Math.hypot(ext, h / 2) + 0.05 };
}

export function createROVs(THREE, o = {}) {
  const seed = o.seed ?? 1, external = Array.isArray(o.pilots), count = external ? clamp(o.pilots.length, 1, 4) : clamp(o.count ?? 3, 1, 3), radius = o.radius ?? 30, low = o.quality === 'low';
  const withTether = o.tether !== false;
  const origin = o.origin || (() => ZERO2);
  const root = o.root || o.scene || null;
  const rock = o.rock || createStubRock({ seed, radius });
  // the water: free of the rock and of the sand floor (ROCK keeps the sand
  // out of rock.sdf; its height field is near enough to a distance)
  const sand = rock.sand && typeof rock.sand.heightAt === 'function' ? rock.sand : null;
  const sdfRock = sand ? (x, y, z) => Math.min(rock.sdf(x, y, z), (y - sand.heightAt(x, z)) * 0.9) : rock.sdf;
  const scene = o.scene || null, reef = o.reef || null;
  // the exposure of the composite: o.exposure() or scene.userData.exposure
  const exposureNow = () => (typeof o.exposure === 'function' ? o.exposure() : scene && scene.userData && scene.userData.exposure) || 4;
  const scale = o.scale ?? 0.6, clear = o.clear ?? 1.45 * scale + 0.05;
  const top = (rock.bounds ? rock.bounds.max[1] : 8);
  // the corals grow to 8 m: the vehicles and the tethers keep clear of
  // them too (coral-field.js, about 1.3 m from the coral skeleton). The
  // A* grid is of the rock only (it is built once); the path push-out
  // and the motion guard read the full field.
  // the world gives its own solid (o.sdf, with the coral in it): no grid
  const coralF = o.sdf ? { sync() { return 0; }, dist: () => Infinity } : createCoralField({ radius, ymin: (rock.bounds ? rock.bounds.min[1] : -4) - 1, ymax: top + 8, clear });
  const sdf = o.sdf || ((x, y, z) => Math.min(sdfRock(x, y, z), coralF.dist(x, y, z)));
  const depthBase = o.depthBase ?? 26;

  // inspection targets: the colonies, else exposed rock points
  let rockTargets = null;
  function targets() {
    const cols = colonyList(reef);
    if (cols.length) {
      const out = [];
      cols.forEach((c, k) => { const b = colonyBounds(reef, c.k ?? k); if (b && (c.count == null || c.count > 0)) out.push({ id: c.k ?? k, center: b.center, radius: b.radius }); });
      if (out.length) return out;
    }
    if (!rockTargets && rock.sampleSurface) {
      rockTargets = rock.sampleSurface(24, rng(hash(seed, 41)), (s) => s.exposure > 0.45).map((s, i) => ({ id: 'rock' + i, center: [s.p[0] + s.n[0] * 0.4, s.p[1] + s.n[1] * 0.4, s.p[2] + s.n[2] * 0.4], radius: 0.7 }));
    }
    if (!rockTargets || rockTargets.length < 4) {
      // our own: trace down onto the rock or sand at seeded points
      const r = rng(hash(seed, 43)), out = [];
      for (let i = 0; i < 24; i++) {
        const a = r() * TAU, d = radius * Math.sqrt(0.02 + 0.7 * r()), x = Math.cos(a) * d, z = Math.sin(a) * d;
        out.push({ id: 'rock' + i, center: [x, surfaceY(sdf, x, z, top + 4) + 0.5, z], radius: 0.7 });
      }
      rockTargets = out;
    }
    return rockTargets;
  }

  // the free-water grid for A* routes, shared by the vehicles (about 350k
  // SDF calls once; 0.8 m cells on low quality)
  const grid = o.grid !== false && !external ? createGrid(sdfRock, { radius, ymin: rock.bounds ? rock.bounds.min[1] : -4, ymax: top + 6, cell: low ? 0.8 : 0.6 }) : null;

  const wash = createWash(THREE, { count: low ? 500 : 1000, seed });
  if (scene) scene.add(wash.points);
  // the tether cable: a braid texture (tether.js braidTexel) under the
  // old cable colour; one tube geometry per vehicle (below)
  const TQ = low ? { n: 30, rings: 96, radial: 8 } : { n: 56, rings: 240, radial: 16 };
  const braid = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const b = Math.round(255 * braidTexel(x / 64, y / 64)), o = (y * 64 + x) * 4;
    braid[o] = braid[o + 1] = braid[o + 2] = b; braid[o + 3] = 255;
  }
  const braidTex = new THREE.DataTexture(braid, 64, 64, THREE.RGBAFormat);
  braidTex.wrapS = braidTex.wrapT = THREE.RepeatWrapping;
  braidTex.magFilter = THREE.LinearFilter; braidTex.minFilter = THREE.LinearMipmapLinearFilter; braidTex.generateMipmaps = true;
  braidTex.needsUpdate = true;
  const tetherMat = new THREE.MeshStandardMaterial({ color: 0xd8a21c, roughness: 0.65, metalness: 0, map: braidTex });

  const vehicles = [];
  const V = new THREE.Vector3(), Q = new THREE.Quaternion(), TA = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const id = i + 1, vs = hash(seed, i, 101);
    const parts = buildVehicle(THREE, {
      id, seed: vs, quality: o.quality, lights: i === 0 ? 2 : 1, shadows: i === 0 && o.shadows !== false,
      shadowSize: low ? 512 : 1024, scale, lightIntensity: o.lightIntensity ?? 420, foam: [0xf2b705, 0xf0a800, 0xe8b818, 0xeec01a][i],
    });
    // an external state (the squad) or a pilot of our own
    const pilot = external ? { state: o.pilots[i], step() {} } : createPilot({ sdf, bounds: rock.bounds, features: rock.features || [], radius, seed, index: i, targets, clear, grid });
    const st = pilot.state;
    const g = parts.group;
    g.position.set(...st.p); g.rotation.order = 'YXZ'; g.rotation.y = -st.yaw;
    if (root) root.add(g);
    g.updateMatrixWorld(true);
    const a = parts.tetherPoint.getWorldPosition(new THREE.Vector3()).toArray();
    const r0 = rng(hash(seed, i, 202));
    const ship = [st.p[0] + (r0() - 0.5) * 12, top + 30, st.p[2] + (r0() - 0.5) * 12];
    let tether = null, tube = null, tmesh = null;
    if (withTether) {
      tether = createTether({ n: TQ.n, a, b: ship });
      tube = createTetherTube({ rings: TQ.rings, radial: TQ.radial, radius: 0.024 }).update(tether.points, tether.count);
      const tgeo = new THREE.BufferGeometry();
      tgeo.setAttribute('position', new THREE.BufferAttribute(tube.positions, 3).setUsage(THREE.DynamicDrawUsage));
      tgeo.setAttribute('normal', new THREE.BufferAttribute(tube.normals, 3).setUsage(THREE.DynamicDrawUsage));
      tgeo.setAttribute('uv', new THREE.BufferAttribute(tube.uvs, 2).setUsage(THREE.DynamicDrawUsage));
      tgeo.setIndex(new THREE.BufferAttribute(tube.indices, 1));
      tmesh = new THREE.Mesh(tgeo, tetherMat);
      tmesh.frustumCulled = false; tmesh.name = 'rov-tether-' + id;
      if (scene) scene.add(tmesh);
    }
    const L = parts.lights;
    L.forEach((l, j) => { l.userData.vehicle = id; l.userData.index = j; });
    const fl = rng(hash(seed, i, 303));
    vehicles.push({
      id, group: g, lights: L, camera: parts.camera, target: new THREE.Vector3(...st.look), parts, pilot, tether, tube, tmesh, ship,
      shipOff: [(r0() - 0.5) * 10, (r0() - 0.5) * 10], flick: [fl() * 100, fl() * 100, fl() * 100], fov: 55,
      get mode() { return st.mode; }, get phase() { return st.phase; },
    });
  }
  const byId = (id) => vehicles.find(v => v.id === id) || vehicles[0];

  const feedO = o.feed || {};
  // o.makeFeed(base, ids): the page gives the feed set of rov/feeds.js (one
  // feed per vehicle, HUD); else one feed as before
  const feedBase = Object.assign({
    renderer: o.renderer || null, scene, seed, getVehicle: byId,
    info: (v) => ({ depth: depthBase - v.group.position.y, heading: headingOf(v.pilot.state.yaw), time: clock, task: o.makeFeed ? v.pilot.state.mode : undefined, tag: o.feedTag ? o.feedTag(v) : null }),
  }, feedO);
  const feed = o.makeFeed ? o.makeFeed(feedBase, vehicles.map(v => v.id)) : createFeed(THREE, feedBase);
  if (feedO.vehicle == null) feed.setVehicle(1);

  function headingOf(yaw) {     // compass: north is -z, east is +x
    const f = [Math.cos(yaw), Math.sin(yaw)];
    return ((Math.atan2(f[0], -f[1]) * 180 / Math.PI) + 360) % 360;
  }

  // ── per-step pose of one vehicle ──────────────────────────────────────────
  const loc = new THREE.Vector3(), TR = new THREE.Vector3();
  const ZERO2 = [0, 0];
  function pose(v, dt, t) {
    const st = v.pilot.state, P = v.parts, g = v.group, O = origin();
    g.position.set(st.p[0], st.p[1], st.p[2]);
    g.rotation.y = -st.yaw;
    // a little pitch and roll from the thrust, as the frame reacts
    g.rotation.z = -clamp(st.thrust.fwd, -1, 1) * 0.035 + 0.01 * Math.sin(t * 0.7 + v.id);
    g.rotation.x = clamp(st.thrust.lat, -1, 1) * 0.03 + 0.008 * Math.sin(t * 0.53 + v.id * 2);
    g.updateMatrixWorld(true);
    v.target.set(st.look[0], st.look[1], st.look[2]);
    // the look point in render space (the group matrices hold the origin)
    TR.set(st.look[0] - O[0], st.look[1], st.look[2] - O[1]);
    // pan and tilt the camera pod at the look point
    loc.copy(TR); P.body.worldToLocal(loc); loc.sub(P.cameraPod.position);
    const pan = clamp(Math.atan2(-loc.z, loc.x), -1.75, 1.75), tilt = clamp(Math.atan2(loc.y, Math.hypot(loc.x, loc.z)), -1.5, 0.6);
    P.cameraPod.rotation.y = pan; P.cameraTilt.rotation.z = tilt;
    // zoom: hold the target sphere when inspecting, wide on a survey
    P.cameraPod.updateMatrixWorld(true);
    const d = Math.max(0.1, TR.distanceTo(P.camera.getWorldPosition(V)));   // from the lens, not the hull
    const want = st.mode === 'survey' ? 60 : zoomFov(d, st.lookR, P.camera.aspect || 1.25, { margin: 1.3, min: 8, max: 70 });
    v.fov += (want - v.fov) * (1 - Math.exp(-dt * 1.5));
    if (st.mode !== 'survey') v.fov = Math.max(v.fov, want);   // never tighter than the colony
    P.camera.fov = v.fov; P.camera.updateProjectionMatrix();
    P.camera.updateMatrixWorld(true);
    // lights: aim at the look point, a warm flicker
    for (let j = 0; j < v.lights.length; j++) {
      const l = v.lights[j], T = P.lightTargets[j];
      loc.copy(TR); g.worldToLocal(loc);
      T.position.lerp(loc, 1 - Math.exp(-dt * 3));
      const f = v.flick, k = 1 + 0.03 * Math.sin(t * 7.3 + f[j]) * Math.sin(t * 2.1 + f[2]) + 0.012 * Math.sin(t * 31 + f[j] * 3) + (Math.sin(t * 0.37 + f[0]) > 0.995 ? -0.25 : 0);
      l.intensity = l.userData.base * k;
    }
    const lampK = v.lights[0].intensity / v.lights[0].userData.base;
    for (const m of P.lamps) m.material.emissiveIntensity = 3 * lampK;
    // the soft fill on the vehicle (rov/fill.js): the exposure of the page
    // (scene.js puts it in scene.userData.exposure), the lamp level
    if (P.fill) { P.materials.lampRing.emissiveIntensity = 0.6 * lampK; P.fill.update(exposureNow(), lampK, P.lamps); }
    // props
    const T = st.thrust;
    for (const pr of P.props) {
      let cmd;
      if (pr.kind === 'h') {
        const dir = V.set(0, 1, 0).applyQuaternion(pr.group.quaternion);
        cmd = dir.x * T.fwd + dir.z * T.lat + T.yaw * 0.6 * (pr.group.position.z * dir.x - pr.group.position.x * dir.z) * -1;
      } else cmd = T.up + 0.15 * T.fwd * pr.side[0];
      cmd = clamp(cmd, -1, 1);
      pr.rpm += (cmd - pr.rpm) * (1 - Math.exp(-dt * 4));
      pr.spin.rotation.y += (pr.rpm * 38 + 1.2 * Math.sign(pr.rpm || 1)) * dt;
      // wash at the outlet
      const n = Math.abs(pr.rpm) * dt * (low ? 14 : 26);
      pr.acc = (pr.acc || 0) + n;
      const cnt = Math.floor(pr.acc); pr.acc -= cnt;
      if (cnt > 0) {
        pr.group.getWorldPosition(V);
        const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(pr.group.getWorldQuaternion(Q));
        const sgn = Math.sign(pr.rpm);
        V.addScaledVector(dir, -0.14 * sgn);
        wash.emit([V.x, V.y, V.z], [-dir.x * pr.rpm * 0.7 + st.v[0], -dir.y * pr.rpm * 0.7 + st.v[1], -dir.z * pr.rpm * 0.7 + st.v[2]], cnt, 0);
      }
    }
    // silt: the vertical jets on rock close under the vehicle
    if (st.thrust.up > 0.25 && (t * 10 | 0) % 2 === 0) {
      const h = trace(sdf, st.p, [0, -1, 0], 2.2);
      if (h < 2.2) wash.emit([st.p[0] - O[0], st.p[1] - h + 0.1, st.p[2] - O[1]], [0, 0.05, 0], 1, 1);
    }
    // LEDs
    for (const L of P.leds) {
      const ph = t * L.rate + L.phase;
      const on = L.rate > 2 ? (ph % 1) < 0.18 : 0.5 + 0.5 * Math.sin(ph * TAU) > 0.35;
      L.mesh.material.emissiveIntensity = on ? 2.5 : 0.12;
    }
    // manipulator: a slow wrist turn while inspecting
    const insp = st.mode !== 'survey' && st.phase === 'orbit';
    P.arm.wrist.rotation.x += ((insp ? Math.sin(t * 0.4) * 0.6 : 0) - P.arm.wrist.rotation.x) * (1 - Math.exp(-dt));
    P.arm.elbow.rotation.z += ((insp ? 2.1 : 2.55) - P.arm.elbow.rotation.z) * (1 - Math.exp(-dt * 0.5));
    // tether: the top end follows the vehicle slowly (ship drift)
    if (!v.tether) return;
    const sh = v.ship, e = 1 - Math.exp(-dt / 40);
    sh[0] += (st.p[0] + v.shipOff[0] - sh[0]) * e; sh[2] += (st.p[2] + v.shipOff[1] - sh[2]) * e;
    P.tetherPoint.getWorldPosition(V);
    TA[0] = V.x; TA[1] = V.y; TA[2] = V.z;
    v.tube.update(v.tether.step(dt, TA, sh, sdf), v.tether.count);
    const ga = v.tmesh.geometry.attributes;
    ga.position.needsUpdate = true; ga.normal.needsUpdate = true; ga.uv.needsUpdate = true;
  }

  let clock = 0;
  function update(dt, t = clock + dt) {
    dt = clamp(dt || 0, 0, 0.1);
    clock = t;
    if (reef) coralF.sync(reef, 4000);      // new coral particles into the ROV field
    const n = Math.max(1, Math.ceil(dt / (1 / 30))), h = dt / n;
    // external states (the squad) are stepped by their owner
    if (!external) for (let s = 0; s < n; s++) {
      for (const v of vehicles) v.pilot.step(h, vehicles.filter(w => w !== v).map(w => w.pilot.state.p));
    }
    for (const v of vehicles) pose(v, dt, t);
    wash.update(dt);
    feed.update(dt);
  }

  // ── the saver hook ────────────────────────────────────────────────────────
  function focusOn(target, mode = 'inspect', fo = {}) {
    const v = byId(fo.vehicle ?? feed.vehicle);
    if (target == null || mode === 'survey') { v.pilot.focus(null); return null; }
    let T;
    if (typeof target === 'number' || (target && (target.base || target.k != null) && !target.get)) {
      const ref = target;
      T = { get: () => colonyBounds(reef, ref) || { center: v.target.toArray(), radius: 1 } };
    } else if (target.get) T = target;
    else if (target.isVector3 || Array.isArray(target)) {
      const c = target.isVector3 ? target.toArray() : target.slice(), r = fo.radius ?? 0.8;
      T = { get: () => ({ center: c, radius: r }) };
    } else if (target.center) T = { get: () => ({ center: Array.from(target.center), radius: target.radius ?? 1 }) };
    else return null;
    v.pilot.focus(T, mode === 'orbit' ? 'orbit' : 'inspect');
    feed.setVehicle(v.id);
    return v;
  }

  function dispose() {
    for (const v of vehicles) {
      if (v.group.parent) v.group.parent.remove(v.group);
      if (v.tmesh) { if (v.tmesh.parent) v.tmesh.parent.remove(v.tmesh); v.tmesh.geometry.dispose(); }
      v.parts.dispose();
    }
    if (scene) scene.remove(wash.points);
    wash.dispose(); braidTex.dispose(); tetherMat.dispose(); feed.dispose();
  }

  return {
    update, vehicles, focusOn, feed, wash: wash.points, rock, sdf, sdfRock, coral: coralF, clear, grid, dispose,
    get lights() { return vehicles.flatMap(v => v.lights); },
    get time() { return clock; },
    headingOf,
  };
}
