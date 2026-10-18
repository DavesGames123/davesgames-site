// ============================================================================
//  CORAL REEF  ·  ROV  ·  thruster wash and silt (three r160 Points)
// ----------------------------------------------------------------------------
//  One Points object for all vehicles: a ring buffer of small particles.
//  emit() puts particles at a thruster outlet with the jet velocity; they
//  slow down (drag), spread, drift with the current and fade over 1.5 to
//  3 s. Silt (brown, larger, slower) comes up where a vertical thruster
//  blows at rock under 1.6 m. Additive colour by life, no depth write, so
//  the order does not matter. A seeded generator, not Math.random.
//
//  grep -n targets
//    "export function createWash"
// ============================================================================
import { rng } from './pilot.js';

function dotTexture(THREE) {
  const n = 32, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2), a = Math.max(0, 1 - r * r) ** 1.5;
    const i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

export function createWash(THREE, { count = 900, seed = 1, current = [0.04, 0, 0.02] } = {}) {
  const R = rng(seed * 31 + 5);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3), life = new Float32Array(count), max = new Float32Array(count), tint = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) pos[i * 3 + 1] = -1e4;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const tex = dotTexture(THREE);
  const mat = new THREE.PointsMaterial({ size: 0.07, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.name = 'rov-wash';
  let head = 0;
  function emit(p, v, n, kind = 0) {
    for (let k = 0; k < n; k++) {
      const i = head; head = (head + 1) % count;
      const s = kind ? 0.25 : 0.05;
      pos[i * 3] = p[0] + (R() - 0.5) * s; pos[i * 3 + 1] = p[1] + (R() - 0.5) * s; pos[i * 3 + 2] = p[2] + (R() - 0.5) * s;
      const j = kind ? 0.12 : 0.08;
      vel[i * 3] = v[0] + (R() - 0.5) * j; vel[i * 3 + 1] = v[1] + (R() - 0.5) * j; vel[i * 3 + 2] = v[2] + (R() - 0.5) * j;
      max[i] = life[i] = (kind ? 3 : 1.5) + R() * 1.5;
      const b = kind ? 0.5 : 0.32;
      if (kind) { tint[i * 3] = 0.55 * b; tint[i * 3 + 1] = 0.45 * b; tint[i * 3 + 2] = 0.32 * b; }
      else { tint[i * 3] = 0.75 * b; tint[i * 3 + 1] = 0.85 * b; tint[i * 3 + 2] = 0.9 * b; }
    }
  }
  function update(dt) {
    const drag = Math.exp(-dt * 1.6);
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const o = i * 3;
      if (life[i] <= 0) { pos[o + 1] = -1e4; col[o] = col[o + 1] = col[o + 2] = 0; continue; }
      vel[o] = vel[o] * drag + current[0] * (1 - drag); vel[o + 1] = vel[o + 1] * drag + (current[1] - 0.004) * (1 - drag); vel[o + 2] = vel[o + 2] * drag + current[2] * (1 - drag);
      pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
      const u = life[i] / max[i], a = Math.min(1, (1 - u) * 6) * u;     // a quick rise, a slow fade
      col[o] = tint[o] * a; col[o + 1] = tint[o + 1] * a; col[o + 2] = tint[o + 2] * a;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return { points, emit, update, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); } };
}
