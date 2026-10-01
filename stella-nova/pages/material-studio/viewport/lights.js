// ============================================================================
//  MATERIAL STUDIO  ·  viewport/lights.js — analytic lights and the shadow matrix
// ────────────────────────────────────────────────────────────────────────────
//  Reads state.env.lights into at most 4 GPU lights and picks the key light.
//  The first directional light is the key light. With no directional light,
//  the sun of the environment or a studio key is the key light. The key light
//  casts the shadow-map shadow, and shadowMatrix() makes its light matrix.
//
//  GREP TARGETS
//      lightsState ............ {lights, key, keyIdx} for the frame uniform
//      shadowMatrix ........... ortho light view-projection around the mesh
// ============================================================================
import { lookAt, ortho, m4mul } from '../camera.js';
import { state, hexToLinear, norm3 } from './state.js';

export function lightsState(e) {
  const out = [];
  let key = null, keyIdx = -1;
  const rot = ((Number(state.env.rotation) || 0) * Math.PI) / 180;
  for (const L of (state.env.lights || [])) {
    if (out.length >= 4) break;
    if (!L || L.on === false || L.enabled === false) continue;
    const type = L.type === 'point' ? 2 : 1;
    const c = hexToLinear(L.color || '#ffffff');
    const I = Number.isFinite(+L.intensity) ? +L.intensity : 1;
    let v;
    if (type === 1) {
      if (Array.isArray(L.dir)) v = norm3(L.dir);
      else {
        const az = ((+L.azimuth || 0) * Math.PI) / 180, el = ((L.elevation ?? 45) * Math.PI) / 180;
        v = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
      }
      if (keyIdx < 0) { key = v; keyIdx = out.length; }
    } else {
      const d = Array.isArray(L.dir) && L.dir.length >= 3 ? norm3(L.dir.map(Number)) : norm3([0.4, 0.7, 0.6]);
      v = Array.isArray(L.pos) ? L.pos.slice(0, 3).map(Number) : d.map(x => x * (+L.dist || 3));
    }
    // w: 1 dir, 2 + range point (range 0 = pure inverse square)
    out.push({ type: type === 2 ? 2 + Math.max(0, +L.range || 0) : 1, v, color: c.map(x => x * Math.max(0, I)) });
  }
  if (!key) {
    if (e.sun) key = e.sun;
    else if (e.kind === 'proc') key = norm3([0.55, 0.62, 0.56]);
    else key = norm3([0.25, 1, 0.2]);
    if (e.sun || e.kind === 'proc') { // the studio key and a sun turn with the environment
      const c = Math.cos(rot), s = Math.sin(rot);
      key = [c * key[0] - s * key[2], key[1], s * key[0] + c * key[2]];
    }
  }
  return { lights: out, key, keyIdx };
}

export function shadowMatrix(key, radius, groundY) {
  const up = Math.abs(key[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const r = radius * 1.25 + 0.2;
  const eye = [key[0] * 8, key[1] * 8, key[2] * 8];
  const view = lookAt(eye, [0, 0, 0], up);
  // tighten the box so the ground near the mesh is inside it too
  const proj = ortho(-r * 1.6, r * 1.6, -r * 1.6, r * 1.6, 8 - r * 2.5, 8 + r * 2.5 + Math.max(0, -groundY));
  return m4mul(proj, view);
}
