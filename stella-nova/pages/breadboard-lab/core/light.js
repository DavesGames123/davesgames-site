// ============================================================================
//  BREADBOARD LAB  ·  core/light.js — the light budget of the bench
// ----------------------------------------------------------------------------
//  One table for the tone mapping, the environment and the light rig.
//  view/scene.js builds its lights from it, and view/test/light-tests.mjs
//  computes the luminance of the materials from the same numbers. No THREE
//  and no DOM: plain data and pure functions, so node imports it.
//
//  UNITS. All radiances are linear, before the tone mapping (the units of
//  the HalfFloat target of the composer). The renderer uses the physical
//  light units of three r160 (no legacy lights): a directional light of
//  intensity I gives I x cos(theta) irradiance, and a Lambert surface of
//  albedo a sends back a x E / pi.
//
//  THE RULE OF THE BUDGET
//    The board white and white ABS in full sun show at about 0.87 after
//    the tone mapping (not clipped), and black parts at about 0.13 (they
//    still read). The environment gives the soft light, the sun the shape.
//
//  GREP MAP
//    TONE / ENV / RIG .... exposure, environment scale, the three lights
//    scaleEnvironment .... dims the RoomEnvironment scene before PMREM
//    acesFilmic / srgb ... the r160 tone curve, for estimates and tests
// ============================================================================

// ACES filmic (three r160 divides the exposure by 0.6 first).
export const TONE = { exposure: 0.8 };

// The RoomEnvironment of three r160 has light panels of radiance 17..100
// and a 900 cd point light. ENV.scale multiplies both before the PMREM is
// made. At 1.0 the environment alone lit the board white to 1.36, and
// with the sun the board showed at 0.95 (almost clipped white).
export const ENV = { scale: 0.45 };

export const RIG = {
  hemi: { sky: 0xdde6ff, ground: 0x1b2422, intensity: 0.3 },
  sun: { color: 0xfff4e6, intensity: 1.9, position: [-160, 420, 260] },
  fill: { color: 0xbfd4ff, intensity: 0.4, position: [260, 180, -220] },
};

// Multiplies every emitter of an environment scene (MeshBasic colours and
// point lights) by k. Call it before PMREMGenerator.fromScene.
export function scaleEnvironment(envScene, k = ENV.scale) {
  envScene.traverse(o => {
    if (o.isLight) o.intensity *= k;
    else if (o.isMesh && o.material && o.material.isMeshBasicMaterial) o.material.color.multiplyScalar(k);
  });
  return envScene;
}

// three r160 ACESFilmicToneMapping on one linear colour, and the sRGB
// transfer. For estimates and tests; the GPU does the real work.
export function acesFilmic(rgb, exposure = TONE.exposure) {
  const s = exposure / 0.6;
  const r = rgb[0] * s, g = rgb[1] * s, b = rgb[2] * s;
  const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.07600 * r + 0.90834 * g + 0.01566 * b, 0.02840 * r + 0.13383 * g + 0.83777 * b];
  const f = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  const o = i.map(f);
  const out = [1.60475 * o[0] - 0.53108 * o[1] - 0.07367 * o[2], -0.10208 * o[0] + 1.10813 * o[1] - 0.00605 * o[2], -0.00327 * o[0] - 0.07276 * o[1] + 1.07602 * o[2]];
  return out.map(v => Math.min(1, Math.max(0, v)));
}
export const srgb = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
