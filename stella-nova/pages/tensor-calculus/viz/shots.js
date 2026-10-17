// ============================================================================
//  TENSOR CALCULUS  ·  viz/shots.js  ·  saver shots  (VIZ)
// ----------------------------------------------------------------------------
//  DOM-free. SAVER_SHOTS is a list of calm, wide shots for the SAVER
//  package: { scene, params, camera: { pos, target, fov, orbit }, seconds,
//  label, channel }. orbit is a slow auto orbit in degrees per second.
//  channel is 'geometry', 'relativity' or 'notation' (the saver channels).
//  The camera of a shot sits a little farther out than the scene camera,
//  so the subject stays in the middle band when the saver plate covers the
//  top and the base of the view (16:9 and 9:16). tests/viz.test.mjs checks
//  that each shot names a known scene with known params and a finite
//  camera, and that the scene target projects near the centre.
//
//  fitFov(fov, aspect) widens the vertical field of view on a tall view
//  (aspect under 1.25), so the width of the subject still fits; index.js
//  applies it to every camera.
//
//  EXPORTS   SAVER_SHOTS, shotCamera(shot), fitFov(fov, aspect)
// ============================================================================
import { SCENES } from './registry.js';

// the scene camera, pulled back by k along its view line
function back(id, k = 1.15, d = {}) {
  const c = SCENES[id].camera;
  const pos = c.pos.map((v, i) => c.target[i] + (v - c.target[i]) * k);
  return { pos, target: c.target.slice(), fov: c.fov, orbit: 2, ...d };
}

const S = (scene, params, label, channel, seconds = 12, cam = {}) => ({ scene, params, label, channel, seconds, camera: back(scene, cam.k ?? 1.15, cam.d || {}) });

export const SAVER_SHOTS = Object.freeze([
  S('upper-lower', {}, 'Upper and lower indices: the basis stretches, the pairing stays', 'notation', 16, { d: { orbit: 1.2 } }),
  S('upper-lower', { metric: 1, covector: 0 }, 'Lowering an index: the metric turns an arrow into a stack of sheets', 'notation', 12, { d: { orbit: 1.5 } }),
  S('dual-basis', {}, 'A basis and its dual basis: e^i(e_j) = δ^i_j', 'notation', 14),
  S('curvilinear', { system: 'polar' }, 'Polar coordinates: the grid is the dual basis', 'geometry', 12),
  S('curvilinear', { system: 'spherical' }, 'Spherical coordinate surfaces and their basis', 'geometry', 12),
  S('metric-field', { chart: 'mercator' }, 'Tissot ellipses: the metric of the Mercator chart', 'geometry', 18, { d: { orbit: 1 } }),
  S('metric-field', { chart: 'stereographic' }, 'The stereographic chart: circles stay circles', 'geometry', 18, { d: { orbit: 1 } }),
  S('outer-product', {}, 'The tensor product u^i w_j', 'notation', 12, { k: 0.95 }),
  S('contraction', { mode: 'matvec' }, 'Contraction: A^i_j v^j collapses a block', 'notation', 14, { k: 0.95 }),
  S('contraction', { mode: 'trace' }, 'The trace T^i_i', 'notation', 12, { k: 1, d: { pos: [1.4, 2.3, 7.0], target: [0.2, -0.1, -0.3] } }),
  S('rank3-cube', { tensor: 'christoffel' }, 'Christoffel symbols of spherical coordinates, slice by slice', 'notation', 18),
  S('rank3-cube', { tensor: 'epsilon' }, 'The Levi-Civita symbol as a cube', 'notation', 14),
  S('transform-rank2', { mode: 'passive' }, 'Change the basis: the components change, the ellipsoid stays', 'geometry', 16),
  S('transform-rank2', { mode: 'active' }, 'Move the space: the ellipsoid moves', 'geometry', 16),
  S('stress-cube', {}, 'Cauchy stress: traction on every plane', 'geometry', 20, { d: { orbit: 3 } }),
  S('inertia', {}, 'A free body flips near its middle axis; L stays fixed', 'geometry', 24, { k: 1.25, d: { orbit: 1.5 } }),
  S('lorentz', {}, 'A Lorentz boost: the light cone stays', 'relativity', 16, { k: 1.3, d: { orbit: 1.5 } }),
  S('parallel-transport', { path: 'latitude', th0: 1.0 }, 'Parallel transport round a latitude: holonomy', 'geometry', 16, { d: { orbit: 2.5 } }),
  S('parallel-transport', { path: 'triangle' }, 'A geodesic triangle with three right angles turns a vector by π/2', 'geometry', 16, { d: { orbit: 2.5 } }),
  S('geodesic-deviation', { surface: 'sphere' }, 'Parallel geodesics meet on a sphere', 'relativity', 14),
  S('geodesic-deviation', { surface: 'saddle' }, 'Parallel geodesics spread on a saddle', 'relativity', 14, { k: 1, d: { pos: [0.2, 4.6, -4.2], target: [0, -0.3, 0.4] } }),
  S('curvature-loop', {}, 'Curvature from a small loop: R^ρ_σμν', 'geometry', 20),
  S('flamm', {}, "Flamm's paraboloid and a precessing orbit", 'relativity', 24, { d: { orbit: 2 } }),
  S('flamm', { bridge: 1 }, 'The Einstein-Rosen bridge', 'relativity', 18, { k: 1, d: { pos: [5.2, -0.4, 6.0], target: [0, -2.4, 0], orbit: 2.5 } }),
  S('levi-civita', {}, 'Orientation: ε_ijk a^i b^j c^k changes sign', 'notation', 14, { k: 1.3 }),
  S('christoffel', { surface: 'polar' }, 'Christoffel symbols: the basis turns along a circle', 'geometry', 15),
  S('christoffel', { surface: 'sphere' }, 'On a sphere, only the tangent part counts', 'geometry', 15),
]);

export const shotCamera = shot => ({ ...shot.camera, pos: shot.camera.pos.slice(), target: shot.camera.target.slice() });

export function fitFov(fov, aspect) {
  const k = Math.pow(Math.max(1, 1.25 / Math.max(0.2, aspect)), 0.85);
  const t = Math.tan((fov * Math.PI) / 360) * k;
  return Math.min(100, (Math.atan(t) * 360) / Math.PI);
}
