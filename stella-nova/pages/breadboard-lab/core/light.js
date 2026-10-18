// ============================================================================
//  BREADBOARD LAB  ·  core/light.js — the light budget of the bench
// ----------------------------------------------------------------------------
//  One table for the tone mapping, the environment, the light rig, the
//  bloom and the emitters (LED dies, lamps, halos, sparks). view/scene.js
//  builds its lights and its bloom pass from it, the part models read the
//  emitter levels from it, and view/test/light-tests.mjs computes the
//  luminance of the materials from the same numbers. No THREE and no DOM:
//  plain data and pure functions, so node imports it.
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
//    The brightest lit diffuse surface (any face, any view, with the sun
//    glint of a dielectric) stays below BLOOM.threshold. An LED die at its
//    rated current is far above it. The bloom pass only sees the meshes on
//    LAYER.EMIT, so a chrome glint never blooms.
//
//  GREP MAP
//    LAYER ............... base, emitter and overlay layers
//    TONE / ENV / RIG .... exposure, environment scale, the three lights
//    BLOOM ............... the emitter bloom pass (view/bloom.js)
//    EMIT / HALO / SPARK . emitter peaks; the halo sprites; spark sprites
//    bloomLuma ........... the luminance weights of the bloom high pass
//    emitLevel ........... sim brightness (1 = rated) -> 0..1.12 level
//    emissiveFor ......... emissive intensity for a colour and a level
//    haloOpacity / haloGain  one halo; the gain when many halos are lit
//    scaleEnvironment .... dims the RoomEnvironment scene before PMREM
//    acesFilmic / srgb ... the r160 tone curve, for estimates and tests
// ============================================================================

// Layers. Every mesh is on BASE. Emitters are on BASE and EMIT. Sprites
// and the control rims are on FX only (the bloom pass draws BASE with one
// black material, and a sprite drawn that way would be a black square).
export const LAYER = { BASE: 0, EMIT: 1, FX: 2 };

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

// UnrealBloomPass settings for the emitter-only image. threshold is a
// luminance (bloomLuma) in linear units, above the brightest lit white
// (1.35, silk-white with a sun glint). radius 0 weights the small mips
// most: a halo round the die, not a haze over the screen.
export const BLOOM = { threshold: 1.5, strength: 0.3, radius: 0 };

// Emitter peaks: the bloom luminance of the lit part at level 1.
//   led  .. a 5 mm LED die at its rated current: blooms
//   smd  .. the small board LEDs (power, L, TX, RX): blooms a little
//   lamp .. indicator lamps on the instruments and the bench supply
//   lcd  .. an LCD backlight: lit, but below the threshold (no bloom)
export const EMIT = { led: 3.2, smd: 2.0, lamp: 1.8, lcd: 0.7, gamma: 0.6, maxLevel: 1.2 };

// Halo sprites: size as a multiple of the size the model asks for, peak
// opacity, and the number of lit halos at full strength. With more lit
// halos each one fades by sqrt(full / n), so the summed light grows only
// as sqrt(n).
export const HALO = { size: 0.6, opacity: 0.42, full: 8 };

// Sparks (view/effects.js): additive, so their alpha has a cap.
export const SPARK = { alpha: 0.7, size: 1.2 };

export const bloomLuma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// b: the sim brightness of a lamp or an LED (1 = rated current). A soft
// curve: a dim LED is visibly lit, and an overdriven LED is not much
// brighter than a rated one.
export function emitLevel(b) {
  const v = Number.isFinite(b) ? b : 0;
  if (v <= 0.002) return 0;
  return Math.pow(Math.min(v, EMIT.maxLevel), EMIT.gamma);
}

// The emissive intensity that gives a linear colour (r, g, b) the bloom
// luminance peak x level. A saturated colour with a low luminance (deep
// red, blue) needs a larger intensity; one channel then goes above 1 and
// the tone mapping turns the die centre towards white, as a real die.
export function emissiveFor(rgb, b, peak = EMIT.led) {
  const l = bloomLuma(rgb.r, rgb.g, rgb.b);
  if (!(l > 1e-4)) return 0;
  return (peak * emitLevel(b)) / l;
}

export function haloOpacity(b) { return HALO.opacity * Math.min(1, emitLevel(b)); }
export function haloGain(lit) { return lit > HALO.full ? Math.sqrt(HALO.full / lit) : 1; }

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
