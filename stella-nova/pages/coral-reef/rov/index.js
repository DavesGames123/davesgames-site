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
//      rock,                     // ROCK createRock(); a stub when missing
//      reef,                     // CORAL createReef() or its mirror (optional)
//      count: 3, seed: 1,        // 2 or 3 vehicles; one seed, one dive
//      quality: 'high' | 'low',  // low: fewer segments, 512 shadow map
//      radius: 30,               // the plot radius (m)
//      depthBase: 26,            // HUD depth = depthBase - y (m)
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
//    rovs.lights      every SpotLight, rovs.wash the wash Points
//    rovs.dispose()
//
//  SCENE notes: lights[0] of vehicle 1 casts shadows; each light has
//  light.userData.base (its intensity before the flicker) and
//  light.userData.vehicle. The SpotLight targets are children of the
//  vehicle group. The tether, wash and vehicles are added to o.scene.
//
//  Colony bounds (from reef.colonies[k], CORAL reef.js header): centre
//  [base.x, (base.y + top) / 2, base.z], radius hypot(ext, (top - base.y)
//  / 2) + 0.05. reef.colonyBounds(k) -> { center, radius } wins if CORAL
//  adds it.
//
//  FILES (grep -n targets)
//    index.js ....... "export function createROVs", "function colonyBounds"
//    build.js ....... the vehicle model ("export function buildVehicle")
//    pilot.js ....... paths and motion, DOM-free ("export function createPilot")
//    tether.js ...... the verlet rope ("export function createTether")
//    wash.js ........ thruster wash and silt ("export function createWash")
//    link.js ........ the SSTV link over pages/sstv ("export class SstvLink")
//    hud.js ......... the feed panel ("export function drawHud")
//    feed.js ........ render target, link and panel ("export function createFeed")
//    feed-worker.js . encode and noise in a module worker
//    stub-rock.js ... a stand-in rock for tests ("export function createStubRock")
// ============================================================================
import { buildVehicle } from './build.js';
import { createPilot, hash, rng, zoomFov, trace } from './pilot.js';
import { createTether } from './tether.js';
import { createWash } from './wash.js';
import { createFeed } from './feed.js';
import { createStubRock } from './stub-rock.js';

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
export function colonyBounds(reef, c) {
  const k = typeof c === 'number' ? c : c && c.k;
  if (reef && typeof reef.colonyBounds === 'function') { const b = normBounds(reef.colonyBounds(k ?? c)); if (b) return b; }
  if (typeof c === 'number') c = colonyList(reef)[c];
  if (!c) return null;
  if (c.bounds) { const b = normBounds(typeof c.bounds === 'function' ? c.bounds() : c.bounds); if (b) return b; }
  const base = c.base || c.position || c.center || (c.user ? [c.user.bx, c.user.by, c.user.bz] : null);
  if (!base) return null;
  const top = c.top ?? base[1], ext = c.ext ?? c.radius ?? 0.1, h = Math.max(0, top - base[1]);
  return { center: [base[0], base[1] + h / 2, base[2]], radius: Math.hypot(ext, h / 2) + 0.05 };
}

export function createROVs(THREE, o = {}) {
  const seed = o.seed ?? 1, count = clamp(o.count ?? 3, 1, 3), radius = o.radius ?? 30, low = o.quality === 'low';
  const rock = o.rock || createStubRock({ seed, radius });
  const sdf = rock.sdf, scene = o.scene || null, reef = o.reef || null;
  const top = (rock.bounds ? rock.bounds.max[1] : 8);
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
    return rockTargets || [];
  }

  const wash = createWash(THREE, { count: low ? 500 : 1000, seed });
  if (scene) scene.add(wash.points);
  const tetherMat = new THREE.MeshStandardMaterial({ color: 0xd8a21c, roughness: 0.65, metalness: 0 });
  const tetherGeo = new THREE.CylinderGeometry(0.024, 0.024, 1, 6, 1, true);

  const vehicles = [];
  const V = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), M = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const id = i + 1, vs = hash(seed, i, 101);
    const parts = buildVehicle(THREE, {
      id, seed: vs, quality: o.quality, lights: i === 0 ? 2 : 1, shadows: i === 0 && o.shadows !== false,
      shadowSize: low ? 512 : 1024, lightIntensity: o.lightIntensity ?? 420, foam: [0xf2b705, 0xf0a800, 0xe8b818][i],
    });
    const pilot = createPilot({ sdf, bounds: rock.bounds, features: rock.features || [], radius, seed, index: i, targets, clear: 1.5 });
    const st = pilot.state;
    const g = parts.group;
    g.position.set(...st.p); g.rotation.order = 'YXZ'; g.rotation.y = -st.yaw;
    g.updateMatrixWorld(true);
    const a = parts.tetherPoint.getWorldPosition(new THREE.Vector3()).toArray();
    const r0 = rng(hash(seed, i, 202));
    const ship = [st.p[0] + (r0() - 0.5) * 12, top + 30, st.p[2] + (r0() - 0.5) * 12];
    const tether = createTether({ n: low ? 18 : 28, a, b: ship });
    const tmesh = new THREE.InstancedMesh(tetherGeo, tetherMat, tether.count - 1);
    tmesh.frustumCulled = false; tmesh.name = 'rov-tether-' + id;
    const L = parts.lights;
    L.forEach((l, j) => { l.userData.vehicle = id; l.userData.index = j; });
    if (scene) { scene.add(g); scene.add(tmesh); }
    const fl = rng(hash(seed, i, 303));
    vehicles.push({
      id, group: g, lights: L, camera: parts.camera, target: new THREE.Vector3(...st.look), parts, pilot, tether, tmesh, ship,
      shipOff: [(r0() - 0.5) * 10, (r0() - 0.5) * 10], flick: [fl() * 100, fl() * 100, fl() * 100], fov: 55,
      get mode() { return st.mode; }, get phase() { return st.phase; },
    });
  }
  const byId = (id) => vehicles.find(v => v.id === id) || vehicles[0];

  const feedO = o.feed || {};
  const feed = createFeed(THREE, Object.assign({
    renderer: o.renderer || null, scene, seed, getVehicle: byId,
    info: (v) => ({ depth: depthBase - v.group.position.y, heading: headingOf(v.pilot.state.yaw), time: clock }),
  }, feedO));
  if (feedO.vehicle == null) feed.setVehicle(1);

  function headingOf(yaw) {     // compass: north is -z, east is +x
    const f = [Math.cos(yaw), Math.sin(yaw)];
    return ((Math.atan2(f[0], -f[1]) * 180 / Math.PI) + 360) % 360;
  }

  // ── per-step pose of one vehicle ──────────────────────────────────────────
  const loc = new THREE.Vector3();
  function pose(v, dt, t) {
    const st = v.pilot.state, P = v.parts, g = v.group;
    g.position.set(st.p[0], st.p[1], st.p[2]);
    g.rotation.y = -st.yaw;
    // a little pitch and roll from the thrust, as the frame reacts
    g.rotation.z = -clamp(st.thrust.fwd, -1, 1) * 0.035 + 0.01 * Math.sin(t * 0.7 + v.id);
    g.rotation.x = clamp(st.thrust.lat, -1, 1) * 0.03 + 0.008 * Math.sin(t * 0.53 + v.id * 2);
    g.updateMatrixWorld(true);
    v.target.set(st.look[0], st.look[1], st.look[2]);
    // pan and tilt the camera pod at the look point
    loc.copy(v.target); P.body.worldToLocal(loc); loc.sub(P.cameraPod.position);
    const pan = clamp(Math.atan2(-loc.z, loc.x), -1.75, 1.75), tilt = clamp(Math.atan2(loc.y, Math.hypot(loc.x, loc.z)), -1.35, 0.6);
    P.cameraPod.rotation.y = pan; P.cameraTilt.rotation.z = tilt;
    // zoom: hold the target sphere when inspecting, wide on a survey
    const d = Math.max(0.3, v.target.distanceTo(g.position));
    const want = st.mode === 'survey' ? 60 : zoomFov(d, st.lookR, P.camera.aspect || 1.25, { margin: 1.3, min: 8, max: 70 });
    v.fov += (want - v.fov) * (1 - Math.exp(-dt * 1.5));
    if (st.mode !== 'survey') v.fov = Math.max(v.fov, want);   // never tighter than the colony
    P.camera.fov = v.fov; P.camera.updateProjectionMatrix();
    P.camera.updateMatrixWorld(true);
    // lights: aim at the look point, a warm flicker
    for (let j = 0; j < v.lights.length; j++) {
      const l = v.lights[j], T = P.lightTargets[j];
      loc.copy(v.target); g.worldToLocal(loc);
      T.position.lerp(loc, 1 - Math.exp(-dt * 3));
      const f = v.flick, k = 1 + 0.03 * Math.sin(t * 7.3 + f[j]) * Math.sin(t * 2.1 + f[2]) + 0.012 * Math.sin(t * 31 + f[j] * 3) + (Math.sin(t * 0.37 + f[0]) > 0.995 ? -0.25 : 0);
      l.intensity = l.userData.base * k;
    }
    for (const m of P.lamps) m.material.emissiveIntensity = 3 * (v.lights[0].intensity / v.lights[0].userData.base);
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
      if (h < 2.2) wash.emit([st.p[0], st.p[1] - h + 0.1, st.p[2]], [0, 0.05, 0], 1, 1);
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
    P.arm.elbow.rotation.z += ((insp ? 1.6 : 1.9) - P.arm.elbow.rotation.z) * (1 - Math.exp(-dt * 0.5));
    // tether: the top end follows the vehicle slowly (ship drift)
    const sh = v.ship, e = 1 - Math.exp(-dt / 40);
    sh[0] += (st.p[0] + v.shipOff[0] - sh[0]) * e; sh[2] += (st.p[2] + v.shipOff[1] - sh[2]) * e;
    P.tetherPoint.getWorldPosition(V);
    const pts = v.tether.step(dt, [V.x, V.y, V.z], sh, sdf);
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    for (let k = 0; k < v.tether.count - 1; k++) {
      A.fromArray(pts, k * 3); B.fromArray(pts, k * 3 + 3);
      const dl = B.clone().sub(A), l = dl.length() || 1e-4;
      Q.setFromUnitVectors(UP, dl.multiplyScalar(1 / l));
      S.set(1, l * 1.02, 1);
      M.compose(A.add(B).multiplyScalar(0.5), Q, S);
      v.tmesh.setMatrixAt(k, M);
    }
    v.tmesh.instanceMatrix.needsUpdate = true;
  }

  let clock = 0;
  function update(dt, t = clock + dt) {
    dt = clamp(dt || 0, 0, 0.1);
    clock = t;
    const n = Math.max(1, Math.ceil(dt / (1 / 30))), h = dt / n;
    for (let s = 0; s < n; s++) {
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
      if (scene) { scene.remove(v.group); scene.remove(v.tmesh); }
      v.parts.dispose(); v.tmesh.dispose();
    }
    if (scene) scene.remove(wash.points);
    wash.dispose(); tetherGeo.dispose(); tetherMat.dispose(); feed.dispose();
  }

  return {
    update, vehicles, focusOn, feed, wash: wash.points, rock, dispose,
    get lights() { return vehicles.flatMap(v => v.lights); },
    get time() { return clock; },
    headingOf,
  };
}
