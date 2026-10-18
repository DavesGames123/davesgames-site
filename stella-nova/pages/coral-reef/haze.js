// ============================================================================
//  CORAL REEF  ·  haze.js  ·  the water dome and the depth haze (DOM-free)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "sky rendering lack circle bug". The water
//  dome was a sphere of 300 m at the render origin. The floating origin
//  moves in steps of 1024 m and the eye goes down to 800 m, so the eye was
//  often far from the sphere centre: the far part of the sphere was past
//  the camera far plane (or the eye was out of the sphere), and the clear
//  colour (black) showed as a large disc. Now the dome is centred on the
//  camera that draws it (scene.js onBeforeRender, the main view and each
//  feed camera), with a radius under the far plane of that camera.
//
//  HAZE FLOOR. The fog colour of the deep water (main.js LOOK) goes near
//  zero. The dome and the far haze never go under HAZE_FLOOR: a dark blue,
//  not black.
//
//    domeRadius(far)                 the dome radius for a camera far plane
//    domeHit(eye, centre, r, dir)    the ray distance to the dome (or -1)
//    domeColour(fogCol, dirY)        the CPU copy of the dome colour (no window)
//    HAZE_FLOOR, HAZE_GLSL           the floor colour (linear), as GLSL vec3
//
//  grep -n targets: "export function domeRadius", "export function domeColour"
// ============================================================================

export const DOME_R = 300;
export const HAZE_FLOOR = [0.00012, 0.00045, 0.0010];
const g = (v) => v.toFixed(5);
export const HAZE_GLSL = `vec3(${HAZE_FLOOR.map(g).join(', ')})`;

// The dome must stay inside the far plane: 80 % of it, at most DOME_R.
export function domeRadius(far) { return Math.min(DOME_R, 0.8 * (far > 0 ? far : 400)); }

// The distance along the unit dir from eye to the sphere (centre, r), from
// the inside; -1 when the eye is outside it.
export function domeHit(eye, centre, r, dir) {
  const o = [eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  if (c > 0) return -1;
  const b = o[0] * dir[0] + o[1] * dir[1] + o[2] * dir[2];
  return -b + Math.sqrt(b * b - c);
}

// scene.js dome fragment (the Snell window not added): the fog colour by
// the view direction, never under the floor.
export function domeColour(fogCol, dirY) {
  const k = 0.55 + 0.9 * Math.min(1, Math.max(0, dirY * 0.5 + 0.5));
  return fogCol.map((c, i) => Math.max(c * k, HAZE_FLOOR[i] * k));
}
