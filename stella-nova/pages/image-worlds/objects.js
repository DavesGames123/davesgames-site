// ============================================================================
//  IMAGE WORLDS  ·  objects.js — the world's meshes, placed and dropped
// ────────────────────────────────────────────────────────────────────────────
//  PLACEMENT  as upstream SceneObject: each placement in scene.json
//    (position, rotation XYZ in radians, scale) holds the object's GLB at
//    0.5 x scale (OBJECT_SCALE), with the model moved so that its box is
//    centred in x and z and its base is at y = 0. worlds.js
//    matchPlacements() pairs the placements with the objects, or puts the
//    objects on the default grid when there is no scene.json.
//  PHYSICS  a light stand-in for upstream Rapier. 'rigidbody' objects fall
//    (g 9.81) to groundAt() under their centre, bounce at 0.3 and stop.
//    'static' and 'ghost' stay where they are. A landing faster than
//    1.2 m/s plays an impact sound, louder for a faster landing. There is
//    no object-to-object contact and no tipping: the box only spins in yaw.
//  CLICK  pick(ray) returns the nearest object box the ray hits. poke(obj)
//    plays an impact sound (upstream playRandomSfx on pointer down) and
//    gives a rigidbody a hop: 2.6 m/s up, 0.6 m/s to the side, a spin.
//
//  EXPORTS  createObjects({ THREE, GLTFLoader, scene, groundAt, onImpact })
//           -> { load(world, show), update(dt), pick(ray), poke(o),
//                positions(), list, group, clear() }
// ============================================================================
import { matchPlacements } from './worlds.js';

export const OBJECT_SCALE = 0.5;
const G = 9.81, BOUNCE = 0.3, LOUD = 1.2;

export function createObjects({ THREE, GLTFLoader, scene, groundAt, onImpact }) {
  const group = new THREE.Group(); group.name = 'objects';
  scene.add(group);
  const loader = new GLTFLoader();
  let list = [], gen = 0;
  const box = new THREE.Box3(), v = new THREE.Vector3(), c = new THREE.Vector3();

  function clear() {
    gen++;
    for (const o of list) {
      o.holder.traverse(n => {
        if (n.isMesh) {
          n.geometry.dispose();
          for (const m of [].concat(n.material)) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
        }
      });
      group.remove(o.holder);
    }
    list = [];
    centres.clear();
  }

  async function load(world, onProgress) {
    clear();
    const my = gen, pairs = matchPlacements(world.objects || [], world.scene);
    const cache = new Map();
    let done = 0;
    for (const { obj, inst } of pairs) {
      try {
        if (!cache.has(obj.id)) {
          const bytes = await obj.model.bytes();
          const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
          cache.set(obj.id, gltf.scene);
        }
        if (my !== gen) return;
        const model = cache.get(obj.id).clone(true);
        model.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
        box.setFromObject(model); box.getCenter(c); box.getSize(v);
        model.position.set(-c.x, -box.min.y, -c.z);
        const vis = new THREE.Group(), s = inst.scale;
        vis.scale.set(OBJECT_SCALE * s[0], OBJECT_SCALE * s[1], OBJECT_SCALE * s[2]);
        vis.add(model);
        const holder = new THREE.Group();
        holder.position.fromArray(inst.position);
        holder.rotation.set(inst.rotation[0], inst.rotation[1], inst.rotation[2]);
        holder.add(vis); holder.name = inst.instanceId;
        group.add(holder);
        const half = new THREE.Vector3(v.x * OBJECT_SCALE * s[0] / 2, v.y * OBJECT_SCALE * s[1] / 2, v.z * OBJECT_SCALE * s[2] / 2);
        list.push({ id: inst.instanceId, obj, name: obj.name, holder, half, physics: inst.physics || 'rigidbody', vel: new THREE.Vector3(), spin: 0, rest: false, home: holder.position.clone(), homeRot: holder.rotation.clone(), dropT: 0 });
      } catch (e) { console.warn('image-worlds: skipped mesh ' + obj.model.path + ': ' + (e.message || e)); }
      if (onProgress) onProgress(++done / pairs.length);
    }
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    for (const o of list) {
      if (o.physics !== 'rigidbody' || o.rest) continue;
      const p = o.holder.position;
      o.vel.y -= G * dt;
      p.addScaledVector(o.vel, dt);
      o.holder.rotation.y += o.spin * dt;
      const g = groundAt(p.x, p.y + o.half.y, p.z);
      if (p.y <= g) {
        p.y = g;
        const vy = -o.vel.y;
        if (vy > LOUD && onImpact) onImpact(o, Math.min(1, vy / 5));
        if (vy > 0.5) o.vel.y = vy * BOUNCE; else o.vel.y = 0;
        o.vel.x *= 0.6; o.vel.z *= 0.6; o.spin *= 0.6;
        if (o.vel.lengthSq() < 0.01 && Math.abs(o.spin) < 0.05) { o.rest = true; o.vel.set(0, 0, 0); o.spin = 0; }
      }
      if (p.y < -20) { p.copy(o.home); o.vel.set(0, 0, 0); }
    }
  }

  const hitBox = new THREE.Box3(), hp = new THREE.Vector3();
  function pick(ray) {
    let best = null, bd = Infinity;
    for (const o of list) {
      const p = o.holder.position, r = Math.max(o.half.x, o.half.z) * 1.1;
      hitBox.min.set(p.x - r, p.y, p.z - r); hitBox.max.set(p.x + r, p.y + o.half.y * 2.1, p.z + r);
      if (ray.intersectBox(hitBox, hp)) { const d = hp.distanceTo(ray.origin); if (d < bd) { bd = d; best = o; } }
    }
    return best;
  }
  function poke(o) {
    if (onImpact) onImpact(o, 0.8);
    if (o.physics !== 'rigidbody') return;
    const a = Math.random() * Math.PI * 2;
    o.vel.set(Math.cos(a) * 0.6, 2.6, Math.sin(a) * 0.6); o.spin = (Math.random() - 0.5) * 8; o.rest = false;
  }
  function reset() { for (const o of list) { o.holder.position.copy(o.home); o.holder.rotation.copy(o.homeRot); o.vel.set(0, 0, 0); o.spin = 0; o.rest = false; } }
  const centres = new Map();
  function positions() {
    for (const o of list) { const q = centres.get(o.id) || new THREE.Vector3(); q.copy(o.holder.position); q.y += o.half.y; centres.set(o.id, q); }
    return centres;
  }
  return { load, update, pick, poke, reset, positions, clear, group, get list() { return list; } };
}
