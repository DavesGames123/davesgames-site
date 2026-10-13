// ============================================================================
//  BREADBOARD LAB  ·  view/effects.js — smoke, sparks, scorch and markers
// ----------------------------------------------------------------------------
//  Everything here is an overlay on the bench. None of it is pickable.
//
//  SMOKE: soft grey sprites that rise, spread and fade over 2 s (CONTRACT
//  4.2). SPARKS: short orange sprites with gravity, 0.4 s. Both come from
//  fixed pools, so a burst never allocates. SCORCH: a dark round decal under
//  a burnt part, until the part is repaired.
//
//  MARKERS: one InstancedMesh of flat rings for the highlighted net (holes
//  and pins), one ring for the hole under the pointer, one InstancedMesh of
//  small balls for the green / red pins of a ghost, and Box3 outlines for
//  the selection and for flash().
//
//  update(dt) advances the particles and returns true while something
//  moves, so the scene keeps rendering until the smoke is gone.
//
//  GREP MAP
//    createEffects ...... pools, textures, groups
//    smoke / spark ...... bursts at a world point
//    setScorch .......... burnt-part decal per part id
//    setNetMarkers ...... rings on every hole and pin of one net
//    setHover ........... ring on the hole under the pointer
//    setPinMarkers ...... green / red ghost pins
//    setBoxes / flash ... selection outlines and blinking outlines
//    update / dispose ... per-frame step, cleanup
// ============================================================================
import { dataTexture } from './fallback.js';

const SMOKE_N = 56, SPARK_N = 40, MARK_N = 2048, PIN_N = 96;

export function createEffects(THREE, parent) {
  const group = new THREE.Group();
  group.name = 'effects';
  parent.add(group);
  const own = [];
  const keep = x => { own.push(x); return x; };

  const soft = keep(dataTexture(THREE, 64, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const a = Math.max(0, 1 - r);
    return [255, 255, 255, Math.round(255 * a * a * (3 - 2 * a))];
  }));

  // ── particles ────────────────────────────────────────────────────────────
  function pool(n, o) {
    const items = [];
    for (let i = 0; i < n; i++) {
      const mat = keep(new THREE.SpriteMaterial({ map: soft, color: o.color, transparent: true, depthWrite: false, opacity: 0, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.renderOrder = 5;
      group.add(s);
      items.push({ s, life: 1, max: 1, vel: new THREE.Vector3(), size0: 1, size1: 1, a0: 1 });
    }
    return { items, next: 0 };
  }
  const smokeP = pool(SMOKE_N, { color: 0x8c8c90 });
  const sparkP = pool(SPARK_N, { color: 0xffa040, additive: true });
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  function emit(P, at, o) {
    const it = P.items[P.next];
    P.next = (P.next + 1) % P.items.length;
    it.s.position.set(at.x + (rnd() - 0.5) * o.jitter, at.y, at.z + (rnd() - 0.5) * o.jitter);
    it.vel.set((rnd() - 0.5) * o.spread, o.up * (0.6 + 0.8 * rnd()), (rnd() - 0.5) * o.spread);
    it.life = 0; it.max = o.life * (0.7 + 0.6 * rnd());
    it.size0 = o.size0; it.size1 = o.size1; it.a0 = o.alpha; it.g = o.g || 0;
    it.delay = (o.delay || 0) * rnd();
    it.s.visible = false;
  }

  function smoke(at, amount = 1) {
    const n = Math.round(22 * amount);
    for (let i = 0; i < n; i++) emit(smokeP, at, { jitter: 3, spread: 10, up: 16, life: 2, size0: 3, size1: 18, alpha: 0.55, delay: 0.6 });
  }
  function spark(at) {
    for (let i = 0; i < 18; i++) emit(sparkP, at, { jitter: 0.6, spread: 90, up: 70, life: 0.4, size0: 1.6, size1: 0.4, alpha: 1, g: -260 });
  }

  function stepPool(P, dt) {
    let alive = false;
    for (const it of P.items) {
      if (it.life >= it.max) { if (it.s.visible) it.s.visible = false; continue; }
      if (it.delay > 0) { it.delay -= dt; alive = true; continue; }
      it.life += dt;
      const u = Math.min(1, it.life / it.max);
      it.vel.y += it.g * dt;
      it.vel.x *= 1 - 0.9 * dt; it.vel.z *= 1 - 0.9 * dt;
      it.s.position.addScaledVector(it.vel, dt);
      const size = it.size0 + (it.size1 - it.size0) * u;
      it.s.scale.set(size, size, size);
      it.s.material.opacity = it.a0 * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85);
      it.s.visible = u < 1;
      alive = true;
    }
    return alive;
  }

  // ── scorch decals ────────────────────────────────────────────────────────
  const scorchGeo = keep(new THREE.CircleGeometry(1, 28));
  const scorchMat = keep(new THREE.MeshBasicMaterial({ map: soft, color: 0x0d0a08, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const scorches = new Map();
  function setScorch(id, at, radius = 6) {
    let m = scorches.get(id);
    if (!at) { if (m) { group.remove(m); scorches.delete(id); } return; }
    if (!m) { m = new THREE.Mesh(scorchGeo, scorchMat); m.rotation.x = -Math.PI / 2; group.add(m); scorches.set(id, m); }
    m.position.set(at.x, at.y + 0.06, at.z);
    m.scale.setScalar(radius);
  }

  // ── markers ──────────────────────────────────────────────────────────────
  const ringGeo = keep(new THREE.RingGeometry(0.62, 1.15, 20));
  ringGeo.rotateX(-Math.PI / 2);
  const netMat = keep(new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95, depthWrite: false }));
  const net = new THREE.InstancedMesh(ringGeo, netMat, MARK_N);
  net.count = 0; net.renderOrder = 4; net.frustumCulled = false;
  group.add(net);
  const m4 = new THREE.Matrix4();
  function setNetMarkers(points) {
    const n = Math.min(MARK_N, points.length);
    for (let i = 0; i < n; i++) { const p = points[i]; m4.makeTranslation(p[0], p[1] + 0.09, p[2]); net.setMatrixAt(i, m4); }
    net.count = n;
    net.instanceMatrix.needsUpdate = true;
  }

  const hoverMat = keep(new THREE.MeshBasicMaterial({ color: 0x6b9fe2, transparent: true, opacity: 0.95, depthWrite: false }));
  const hover = new THREE.Mesh(ringGeo, hoverMat);
  hover.scale.setScalar(1.35); hover.visible = false; hover.renderOrder = 4;
  group.add(hover);
  function setHover(p, color) {
    hover.visible = !!p;
    if (p) { hover.position.set(p[0], p[1] + 0.1, p[2]); hoverMat.color.set(color || 0x6b9fe2); }
  }

  const ballGeo = keep(new THREE.SphereGeometry(0.75, 10, 8));
  const ballMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, PIN_N);
  balls.count = 0; balls.renderOrder = 6; balls.frustumCulled = false;
  balls.setColorAt(0, new THREE.Color(0xffffff));
  group.add(balls);
  const okC = new THREE.Color(0x63c24c), badC = new THREE.Color(0xe2474e);
  function setPinMarkers(list) {
    const n = Math.min(PIN_N, list.length);
    for (let i = 0; i < n; i++) { const p = list[i]; m4.makeTranslation(p.x, (p.y || 0) + 0.8, p.z); balls.setMatrixAt(i, m4); balls.setColorAt(i, p.ok ? okC : badC); }
    balls.count = n;
    balls.instanceMatrix.needsUpdate = true;
    if (balls.instanceColor) balls.instanceColor.needsUpdate = true;
  }

  // ── outlines ─────────────────────────────────────────────────────────────
  const selHelpers = [];
  function setBoxes(boxes) {
    while (selHelpers.length > boxes.length) { const h = selHelpers.pop(); group.remove(h); h.geometry.dispose(); h.material.dispose(); }
    boxes.forEach((b, i) => {
      if (!selHelpers[i]) { const h = new THREE.Box3Helper(new THREE.Box3(), 0x6b9fe2); h.renderOrder = 4; group.add(h); selHelpers.push(h); }
      selHelpers[i].box.copy(b).expandByScalar(0.8);
    });
  }
  let flashes = [];
  function flash(boxes, ms = 1400) {
    for (const b of boxes) {
      const h = new THREE.Box3Helper(b.clone().expandByScalar(1.4), 0xf2b33d);
      h.renderOrder = 4;
      group.add(h);
      flashes.push({ h, t: 0, max: ms / 1000 });
    }
  }
  function stepFlashes(dt) {
    if (!flashes.length) return false;
    for (const f of flashes) { f.t += dt; f.h.visible = Math.floor(f.t * 6) % 2 === 0; }
    const done = flashes.filter(f => f.t >= f.max);
    for (const f of done) { group.remove(f.h); f.h.geometry.dispose(); f.h.material.dispose(); }
    flashes = flashes.filter(f => f.t < f.max);
    return true;
  }

  return {
    group, smoke, spark, setScorch, setNetMarkers, setHover, setPinMarkers, setBoxes, flash,
    update(dt) {
      const a = stepPool(smokeP, dt), b = stepPool(sparkP, dt), c = stepFlashes(dt);
      return a || b || c;
    },
    get busy() { return smokeP.items.some(i => i.life < i.max) || sparkP.items.some(i => i.life < i.max) || flashes.length > 0; },
    dispose() {
      setBoxes([]);
      for (const f of flashes) { f.h.geometry.dispose(); f.h.material.dispose(); }
      flashes = [];
      net.dispose(); balls.dispose();
      for (const o of own) o.dispose();
      parent.remove(group);
    },
  };
}
