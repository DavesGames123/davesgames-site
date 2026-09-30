// params.js — control catalogue, pass list and uniform packing for SDF Clouds.
//
// This module has no DOM and no GPU code. main.js builds the panel from
// GROUPS, and engine.js calls pack() once per frame. The Deno render harness
// imports it too.
//
// Each control has a `bake` level. engine.js compares the new state with the
// last baked state and reruns only the stages that a changed control feeds:
//
//   res    reallocate the volumes, then shape + SDF + light
//   shape  shape field + JFA SDF + light
//   noise  erosion texture + light
//   lres   reallocate the light map + light
//   light  light map only
//   (none) uniform only, no bake
//
// Animation reuses the same diff. main.js passes animate(state, time) to the
// engine, not the panel state. animate() moves the animated controls, so a
// moving sun or iso reruns the light bake through the normal diff. The shape
// motions (drift, rise, morph, grow) share one quantised clock, shapeClock,
// so the shape + JFA + light bake runs at bakeRate and not every frame.
// Erosion wind, boil, lightning, fog pulse and the camera are uniform only.
//
// grep: export const PASSES  export const GROUPS  export const RECIPES
//       export function animate  export function animateCam  function bolt
//       export function pack  BOX_

export const BOX_MIN = [-6, 1, -6];
export const BOX_MAX = [6, 4, 6];
export const ERO_RES = 64;
export const PARAM_VEC4 = 27;

export const PASSES = [
  { id: 'final',   name: 'Final composite',      desc: 'Clouds, fog shafts, sky and ground. L = L_media + T * L_background.' },
  { id: 'flat',    name: 'Transmittance only',   desc: 'Flat white clouds over the background, weighted by T. No lighting, so only the shape and density show.' },
  { id: 'cloud',   name: 'Cloud radiance',       desc: 'L_media of the clouds alone on black. Fog and background are off.' },
  { id: 'steps',   name: 'Step cost',            desc: 'Samples per pixel, primary plus secondary, on a turbo scale to the heat max. Turn off baked light or SDF skip to see the cost jump.' },
  { id: 'steplen', name: 'Mean step length',     desc: 'Mean primary step inside the box, log scale from the min step (blue) to the SDF clamp (red). Red means the SDF skipped empty space.' },
  { id: 'slice',   name: 'SDF slice',            desc: 'A horizontal cut through the SDF at the slice height. Blue is outside, orange inside, white the iso surface, dark lines every 0.25 units.' },
  { id: 'seeds',   name: 'JFA seed vectors',     desc: 'Direction from each voxel to its nearest surface seed after the jump flood, as RGB. Rings every 4 voxels of distance.' },
  { id: 'optical', name: 'Optical depth',        desc: 'Integrated sigma_t along the view ray through the clouds.' },
  { id: 'light',   name: 'Sun transmittance',    desc: 'Mean T_light of the visible cloud, weighted by density. The ground shows its cloud shadow.' },
  { id: 'erosion', name: 'Erosion band',         desc: 'Where the erosion texture cuts the density. Only a thin band under the surface pays for it.' },
  { id: 'normal',  name: 'SDF normals',          desc: 'Gradient of the SDF at the first density sample.' },
  { id: 'depth',   name: 'Hit depth',            desc: 'Distance to the first density sample; near is warm.' },
  { id: 'shadow',  name: 'Ground shadow',        desc: 'Ground points projected toward the sun onto the transmittance volume.' },
  { id: 'fog',     name: 'Fog only',             desc: 'In-scattered light of the fog medium, with the cloud shadows that make the shafts.' },
];

const R = (id, label, min, max, step, value, bake, tip, fmt) =>
  ({ id, type: 'range', label, min, max, step, value, bake, tip, fmt });
const B = (id, label, value, bake, tip) => ({ id, type: 'toggle', label, value, bake, tip });
const S = (id, label, options, value, bake, tip) => ({ id, type: 'select', label, options, value, bake, tip });

export const GROUPS = [
  { id: 'shape', title: 'Shape volume', controls: [
    S('preset', 'Preset', ['Cloudscape', 'Cumulus field', 'Cumulus tower', 'Stratus sheet', 'Voxel sculpt', 'Torus'], 0, 'shape',
      'Source volume. Cloudscape follows the upstream Worley generator; Voxel sculpt stands in for a MagicaVoxel model.'),
    S('volRes', 'Volume res', ['64', '96', '128', '160', '192'], 2, 'res', 'SDF voxels along x and z. y is a quarter of that.'),
    R('coverage', 'Coverage', 0.05, 0.95, 0.01, 0.5, 'shape', 'How much of the box the shape fills.'),
    R('freq', 'Frequency', 0.1, 1.2, 0.01, 0.35, 'shape', 'Billow cells per world unit.'),
    R('octaves', 'Octaves', 1, 5, 1, 3, 'shape', 'Billow octaves.'),
    R('gain', 'Gain', 0.2, 0.8, 0.01, 0.5, 'shape', 'Amplitude kept per octave.'),
    R('worleyMix', 'Worley mix', 0, 1, 0.01, 0.75, 'shape', '0 = value noise, 1 = inverted Worley.'),
    R('warp', 'Warp', 0, 2, 0.01, 0.6, 'shape', 'Domain warp before the billow noise.'),
    R('topExp', 'Top exp', 1, 8, 0.1, 2, 'shape', 'Vertical profile, top falloff. Low = rounded tops.'),
    R('botExp', 'Bottom exp', 1, 16, 0.1, 6, 'shape', 'Vertical profile, bottom falloff. High = flat bases.'),
    R('seed', 'Seed', 0, 99, 1, 7, 'shape', 'Noise seed.'),
    R('sdfClamp', 'SDF clamp', 0.25, 4, 0.05, 2, 'shape', 'Largest distance the SDF stores. Caps the biggest skip step.'),
  ]},
  { id: 'march', title: 'Ray march', controls: [
    R('maxSteps', 'Max steps', 16, 600, 1, 220, null, 'Primary step budget per pixel, fog steps included.'),
    R('minStep', 'Min step', 0.01, 0.3, 0.005, 0.05, null, 'Fixed step inside a cloud, and the smallest skip step.'),
    R('stepGrowth', 'Step growth', 0, 0.2, 0.005, 0.02, null, 'Min step grows by this much per unit of distance.'),
    R('iso', 'Iso offset', -0.3, 0.3, 0.005, 0, 'light', 'Shifts the surface along the SDF. Positive inflates.'),
    B('sdfSkip', 'SDF skip', true, 'light', 'Sphere-trace empty space by the SDF. Off = fixed steps everywhere.'),
    B('sdfInside', 'SDF inside', false, null, 'Also step by |SDF| inside the cloud. Faster; upstream notes it breaks the lighting.'),
    R('jitter', 'Jitter', 0, 1, 0.01, 1, null, 'Random offset per pixel: min steps at the cloud entry, fog steps for the fog samples. Trades banding for noise.'),
    R('renderScale', 'Render scale', 0.25, 1, 0.05, 0.75, null, 'Canvas resolution relative to the display.'),
  ]},
  { id: 'density', title: 'Density + erosion', controls: [
    R('density', 'Density', 0.5, 30, 0.1, 6, 'light', 'sigma_t per world unit at full depth.'),
    R('edgeRamp', 'Edge ramp', 0.01, 1, 0.01, 0.25, 'light', 'Depth under the surface where density reaches full.'),
    B('erosion', 'Erosion', true, 'light', 'Cut detail into the edges with the tiling Worley texture.'),
    R('eroIntensity', 'Intensity', 0, 1, 0.01, 0.6, 'light', 'How much of the noise range cuts.'),
    R('eroBand', 'Band', 0.02, 0.8, 0.01, 0.3, 'light', 'Depth under the surface where erosion applies.'),
    R('eroExp', 'Edge exp', 1, 16, 0.1, 3, 'light', 'Falloff of erosion with depth. Upstream uses 16.'),
    R('eroScale', 'Tile size', 0.2, 4, 0.05, 1.2, 'light', 'World units per erosion tile.'),
    R('eroCells', 'Cells', 2, 12, 1, 5, 'noise', 'Worley cells per tile, base octave.'),
    B('lightErosion', 'Erode light', false, 'light', 'Apply erosion in the light bake too. With wind on, the light map rebakes every frame.'),
  ]},
  { id: 'motion', title: 'Cloud motion', controls: [
    R('driftSpeed', 'Drift', 0, 1.5, 0.01, 0, null, 'Clouds move through the box, world units per second. New clouds enter upwind. Shape bake.'),
    R('driftDir', 'Drift dir', 0, 360, 1, 60, null, 'Drift heading.', 'deg'),
    R('rise', 'Rise', 0, 0.5, 0.005, 0, null, 'The noise moves up through the height profile: puffs grow at the base and thin out at the top. Shape bake.'),
    R('morph', 'Morph', 0, 1, 0.01, 0, null, 'Speed of the domain-warp phase. Shapes change in place. Shape bake.'),
    R('covAmp', 'Grow / decay', 0, 0.4, 0.01, 0, null, 'Coverage swings by this much. Shape bake.'),
    R('covPeriod', 'Grow period', 2, 60, 0.5, 20, null, 'Seconds per grow + decay cycle.'),
    R('bakeRate', 'Shape bakes/s', 2, 60, 1, 30, null, 'Shape motions step at this rate. Each step reruns shape + JFA + light. Lower = cheaper, choppier.'),
    R('wind', 'Wind', 0, 0.5, 0.005, 0.04, null, 'Scroll speed of the erosion texture. Uniform only.'),
    R('windDir', 'Wind dir', 0, 360, 1, 59, null, 'Heading of the erosion scroll.', 'deg'),
    R('updraft', 'Updraft', -1, 2, 0.01, 0.15, null, 'Vertical erosion scroll, as a fraction of the wind.'),
    R('boil', 'Boil', 0, 1, 0.01, 0, null, 'Blend in a second erosion layer that moves across the first. The edges churn in place. One more sample, edge band only.'),
    R('boilSpeed', 'Boil speed', 0, 0.5, 0.005, 0.1, null, 'Scroll speed of the second erosion layer.'),
    R('breathAmp', 'Breathe', 0, 0.3, 0.005, 0, null, 'Iso offset swings by this much: the clouds inflate and shrink. Light bake per frame.'),
    R('densPulse', 'Density pulse', 0, 0.9, 0.01, 0, null, 'Density swings by this fraction. Light bake per frame.'),
    R('breathPeriod', 'Breath period', 1, 30, 0.5, 8, null, 'Seconds per breathe and density cycle.'),
  ]},
  { id: 'skyanim', title: 'Sky + camera motion', controls: [
    R('sunSpin', 'Sun orbit', -30, 30, 0.5, 0, null, 'Sun azimuth speed, degrees per second. Light bake per frame.'),
    R('sunSwing', 'Sun swing', 0, 45, 0.5, 0, null, 'Sun elevation swings by this much around its set value. Light bake per frame.', 'deg'),
    R('sunPeriod', 'Swing period', 4, 120, 1, 40, null, 'Seconds per sun swing.'),
    R('lightning', 'Lightning', 0, 3, 0.05, 0, null, 'Mean flashes per second. Each flash lights the cloud from a random point in the box. Uniform only.'),
    R('boltI', 'Bolt power', 0, 60, 0.5, 20, null, 'Peak radiance of a flash.'),
    R('boltR', 'Bolt radius', 0.2, 3, 0.05, 1.2, null, 'Glow radius of a flash in the cloud, world units.'),
    R('fogPulse', 'Fog pulse', 0, 1, 0.01, 0, null, 'Fog density swings by this fraction. Uniform only.'),
    R('fogPeriod', 'Fog period', 2, 60, 0.5, 15, null, 'Seconds per fog cycle.'),
    R('camSway', 'Cam sway', 0, 40, 0.5, 0, null, 'Camera azimuth swings by this much.', 'deg'),
    R('camBob', 'Cam bob', 0, 1, 0.01, 0, null, 'Camera target moves up and down by this much.'),
    R('dolly', 'Dolly', 0, 0.6, 0.01, 0, null, 'Camera distance swings by this fraction.'),
    R('camPeriod', 'Cam period', 2, 60, 0.5, 14, null, 'Seconds per camera cycle.'),
  ]},
  { id: 'light', title: 'Lighting', controls: [
    R('sunAz', 'Sun azimuth', 0, 360, 1, 40, 'light', 'Degrees.', 'deg'),
    R('sunEl', 'Sun elevation', -4, 90, 0.5, 16, 'light', 'Degrees.', 'deg'),
    R('sunI', 'Sun', 0, 12, 0.1, 4, null, 'L_light, sun radiance.'),
    R('ambient', 'Ambient', 0, 2, 0.01, 0.4, null, 'Sky light on clouds and ground.'),
    R('absorption', 'Absorption', 0.1, 3, 0.01, 1, 'light', 'Scale on sigma_t for the light rays only.'),
    R('lightStep', 'Light step', 0.02, 0.4, 0.005, 0.08, 'light', 'Fixed step of the secondary rays.'),
    R('lightMax', 'Light steps', 8, 256, 1, 128, 'light', 'Step budget of a baked secondary ray.'),
    B('baked', 'Baked light', true, null, 'Read T_light from the transmittance volume. Off = nested march per sample.'),
    R('liveSteps', 'Live steps', 4, 64, 1, 16, null, 'Secondary step budget when baked light is off.'),
    S('lightDiv', 'Light map', ['full res', '1/2 res', '1/4 res'], 1, 'lres', 'Transmittance volume size relative to the SDF.'),
    B('ao', 'AO', true, 'light', 'Bake neighbour-density occlusion into the light map.'),
    R('aoIntensity', 'AO amount', 0, 4, 0.01, 1, 'light', ''),
    R('aoOffset', 'AO radius', 0.05, 1, 0.01, 0.25, 'light', ''),
    R('hgG', 'HG g', -0.5, 0.95, 0.01, 0.6, null, 'Henyey-Greenstein asymmetry. Higher = brighter silver lining.'),
    R('hgBias', 'Phase bias', 0, 1, 0.01, 0.3, null, 'p = bias + scale * HG. Scale 0 = uniform phase.'),
    R('hgScale', 'Phase scale', 0, 2, 0.01, 0.7, null, ''),
    B('powder', 'Powder', true, null, 'Darken thin edges facing the eye.'),
    R('powderK', 'Powder k', 0.5, 40, 0.5, 8, null, ''),
    R('powderMix', 'Powder mix', 0, 1, 0.01, 0.5, null, ''),
  ]},
  { id: 'atmos', title: 'Fog, ground, output', controls: [
    R('fog', 'Fog density', 0, 0.1, 0.0005, 0.008, null, 'Second medium, marched with the clouds. 0 = off.'),
    R('fogFalloff', 'Fog falloff', 0, 2, 0.01, 0.45, null, 'Exponential falloff with height.'),
    R('fogSteps', 'Fog steps', 4, 96, 1, 12, null, 'Fixed steps over the first 60 units of the ray, jittered per pixel. Every pixel pays for every step, sky included.'),
    B('ground', 'Ground', true, null, ''),
    B('groundShadows', 'Cloud shadows', true, null, 'Project ground points onto the transmittance volume.'),
    B('softShadows', 'Soft shadows', true, null, '5-tap kernel on the projection.'),
    R('shadowStrength', 'Shadow amt', 0, 1, 0.01, 0.9, null, ''),
    R('exposure', 'Exposure', 0.1, 3, 0.01, 0.7, null, ''),
  ]},
  { id: 'camera', title: 'Camera + time', controls: [
    R('fov', 'FOV', 20, 110, 1, 62, null, 'Vertical field of view.', 'deg'),
    B('autoOrbit', 'Auto orbit', false, null, ''),
    R('orbitSpeed', 'Orbit speed', -20, 20, 0.5, 4, null, 'Degrees per second.'),
    R('timeScale', 'Time scale', 0, 4, 0.01, 1, null, 'Scales the animation clock. 0 stops every motion.'),
  ]},
  { id: 'viz', title: 'Pass settings', controls: [
    R('sliceY', 'Slice height', 0, 1, 0.005, 0.4, null, 'SDF slice and JFA pass, fraction of box height.'),
    R('heatMax', 'Heat max', 16, 800, 1, 220, null, 'Top of the step cost scale.'),
  ]},
];

// Motion recipes. A recipe first sets every motion control to its default,
// then applies its own values. Still is the reset.
export const RECIPES = {
  Still: {},
  Drift: { driftSpeed: 0.35, wind: 0.06 },
  Boil: { rise: 0.12, morph: 0.25, boil: 0.7, boilSpeed: 0.12, updraft: 0.8 },
  Breathe: { breathAmp: 0.08, densPulse: 0.3, breathPeriod: 6, fogPulse: 0.5, fogPeriod: 9 },
  Storm: { driftSpeed: 0.3, morph: 0.3, boil: 0.5, wind: 0.1, lightning: 1.4, boltI: 28, boltR: 1.4 },
  Timelapse: { driftSpeed: 0.8, rise: 0.05, morph: 0.4, covAmp: 0.15, covPeriod: 16, wind: 0.15,
    sunSpin: 6, sunSwing: 14, sunPeriod: 30 },
  Flyby: { driftSpeed: 0.2, camSway: 25, camBob: 0.4, dolly: 0.25, camPeriod: 18 },
};

const ALL = GROUPS.flatMap((g) => g.controls);
export const MOTION_IDS = GROUPS.filter((g) => g.id === 'motion' || g.id === 'skyanim')
  .flatMap((g) => g.controls.map((c) => c.id));
export const CONTROLS = Object.fromEntries(ALL.map((c) => [c.id, c]));

export function defaults() {
  return Object.fromEntries(ALL.map((c) => [c.id, c.value]));
}

export const VOL_RES = [64, 96, 128, 160, 192];
export const LIGHT_DIV = [1, 2, 4];

// Volume sizes from the state. The box is 12 x 3 x 12, so y = x / 4 keeps the
// voxels cubic.
export function dims(s) {
  const nx = VOL_RES[s.volRes] ?? 128;
  const vol = [nx, nx / 4, nx];
  const div = LIGHT_DIV[s.lightDiv] ?? 2;
  const lit = vol.map((n) => Math.max(4, Math.ceil(n / div)));
  const voxel = (BOX_MAX[0] - BOX_MIN[0]) / nx;
  return { vol, lit, voxel };
}

export function sunDir(s) {
  const az = (s.sunAz * Math.PI) / 180;
  const el = (s.sunEl * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

// Sun colour shifts warm toward the horizon.
function sunColour(s) {
  const y = Math.sin((s.sunEl * Math.PI) / 180);
  const k = Math.min(Math.max((y + 0.02) / 0.35, 0), 1);
  const lerp = (a, b) => a + (b - a) * k;
  const fade = Math.min(Math.max((y + 0.07) / 0.1, 0), 1);
  return [fade, lerp(0.42, 0.95) * fade, lerp(0.18, 0.88) * fade];
}

// Camera basis from an orbit state { az, el, dist, target[3] } in degrees.
export function cameraBasis(cam) {
  const az = (cam.az * Math.PI) / 180;
  const el = (cam.el * Math.PI) / 180;
  const t = cam.target;
  const pos = [
    t[0] + cam.dist * Math.cos(el) * Math.sin(az),
    Math.max(t[1] + cam.dist * Math.sin(el), 0.05),
    t[2] + cam.dist * Math.cos(el) * Math.cos(az),
  ];
  const f = norm([t[0] - pos[0], t[1] - pos[1], t[2] - pos[2]]);
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return { pos, fwd: f, right: r, up: u };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

const TAU = Math.PI * 2;
const clampN = (v, a, b) => Math.min(Math.max(v, a), b);
const hash = (k, n) => { const x = Math.sin(k * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };

// Lightning from the clock alone, so pause and scrub stay exact. Time falls in
// 0.25 s slots. A slot holds a flash with probability rate * 0.25, at a hashed
// start, place and double-stroke envelope. The current and the previous slot
// both count, so a flash that runs past its slot does not cut off.
const BOLT_SLOT = 0.25;
function bolt(s, time) {
  if (s.lightning <= 0 || s.boltI <= 0) return [0, 0, 0, 0];
  let best = [0, 0, 0, 0];
  const k0 = Math.floor(time / BOLT_SLOT);
  for (const k of [k0 - 1, k0]) {
    if (hash(k, 1) > s.lightning * BOLT_SLOT) continue;
    const u = time - (k + hash(k, 2) * 0.5) * BOLT_SLOT;
    if (u < 0) continue;
    const env = Math.exp(-u / 0.05) + (u > 0.11 ? 0.7 * Math.exp(-(u - 0.11) / 0.08) : 0);
    const e = s.boltI * env * (0.6 + 0.4 * hash(k, 6));
    if (e > best[3]) {
      best = [BOX_MIN[0] * 0.7 + (BOX_MAX[0] - BOX_MIN[0]) * 0.7 * hash(k, 3), 1.5 + 1.2 * hash(k, 4),
        BOX_MIN[2] * 0.7 + (BOX_MAX[2] - BOX_MIN[2]) * 0.7 * hash(k, 5), e];
    }
  }
  return best;
}

// Effective state at a time. The result is a copy of s with the animated
// controls moved, plus four derived fields that pack() reads:
//   shapeClock  quantised time of the shape motions; a change reruns the shape bake
//   shapeOff    world offset of the shape noise domain (drift + rise)
//   warpPhase   phase of the domain warp (morph)
//   bolt        lightning point xyz and energy w
export function animate(s, time) {
  const e = { ...s };
  const wave = (period) => Math.sin((TAU * time) / Math.max(period, 1e-3));
  const shapeAnim = s.driftSpeed > 0 || s.rise > 0 || s.morph > 0 || s.covAmp > 0;
  const tc = shapeAnim ? Math.floor(time * s.bakeRate) / s.bakeRate : 0;
  const a = (s.driftDir * Math.PI) / 180;
  e.shapeClock = tc;
  e.shapeOff = [Math.sin(a) * s.driftSpeed * tc, s.rise * tc, Math.cos(a) * s.driftSpeed * tc];
  e.warpPhase = s.morph * tc;
  if (s.covAmp > 0) e.coverage = clampN(s.coverage + s.covAmp * Math.sin((TAU * tc) / s.covPeriod), 0.02, 0.98);
  if (s.breathAmp > 0) e.iso = s.iso + s.breathAmp * wave(s.breathPeriod);
  if (s.densPulse > 0) e.density = s.density * (1 + s.densPulse * wave(s.breathPeriod));
  if (s.sunSpin) e.sunAz = (((s.sunAz + s.sunSpin * time) % 360) + 360) % 360;
  if (s.sunSwing > 0) e.sunEl = clampN(s.sunEl + s.sunSwing * wave(s.sunPeriod), -4, 90);
  if (s.fogPulse > 0) e.fog = s.fog * (1 + s.fogPulse * wave(s.fogPeriod));
  e.bolt = bolt(s, time);
  return e;
}

// Effective camera at a time. Returns cam itself when no camera motion is on.
export function animateCam(cam, s, time) {
  if (!(s.camSway > 0 || s.camBob > 0 || s.dolly > 0)) return cam;
  const w = (TAU * time) / Math.max(s.camPeriod, 1e-3);
  return {
    az: cam.az + s.camSway * Math.sin(w),
    el: cam.el,
    dist: cam.dist * (1 + s.dolly * Math.sin(w * 0.5 + 1.1)),
    target: [cam.target[0], cam.target[1] + s.camBob * Math.sin(w * 2 + 0.7), cam.target[2]],
  };
}

// Fill the Params uniform. Slot order must match common.wgsl struct Params.
export function pack(out, s, cam, time, frame) {
  const d = dims(s);
  const b = cameraBasis(cam);
  const sun = sunDir(s);
  const sc = sunColour(s);
  const on = (x) => (x ? 1 : 0);
  const wa = ((s.windDir ?? 59) * Math.PI) / 180;
  const up = s.updraft ?? 0.15;
  const bs = s.boilSpeed ?? 0.1;
  const v = [
    [...b.pos, time],
    [...b.fwd, Math.tan((s.fov * Math.PI) / 360)],
    [...b.right, frame],
    [...b.up, 0],
    [...BOX_MIN, d.voxel],
    [...BOX_MAX, s.sdfClamp],
    [...d.vol, Math.max(...d.vol)],
    [...d.lit, on(s.ao)],
    [...sun, s.sunI],
    [...sc, s.ambient],
    [s.maxSteps, s.minStep, s.stepGrowth, s.iso],
    [on(s.sdfSkip), on(s.sdfInside), s.jitter, s.fog],
    [s.density, s.edgeRamp, s.absorption, s.lightStep],
    [on(s.erosion), s.eroIntensity, s.eroBand, s.eroScale],
    [Math.sin(wa) * s.wind, up * s.wind, Math.cos(wa) * s.wind, s.eroExp],
    [s.hgG, s.hgBias, s.hgScale, on(s.powder)],
    [s.powderK, s.powderMix, on(s.baked), s.liveSteps],
    [s.sliceY, s.heatMax, on(s.groundShadows), s.shadowStrength],
    [s.preset, s.coverage, s.freq, s.seed],
    [s.octaves, s.gain, s.topExp, s.botExp],
    [s.worleyMix, s.aoIntensity, s.aoOffset, s.exposure],
    [on(s.lightErosion), s.fogFalloff, on(s.softShadows), on(s.ground)],
    [s.warp, s.eroCells, s.fogSteps, s.lightMax],
    [...(s.shapeOff ?? [0, 0, 0]), s.warpPhase ?? 0],
    s.bolt ?? [0, 0, 0, 0],
    [-Math.cos(wa) * bs, bs * 0.5, Math.sin(wa) * bs, s.boil ?? 0],
    [s.boltR ?? 1.2, 0, 0, 0],
  ];
  for (let i = 0; i < PARAM_VEC4; i++) out.set(v[i], i * 4);
  return out;
}

// Set of bake levels whose controls differ between two states.
export function bakeNeeded(prev, next) {
  if (!prev) return new Set(['res']);
  const need = new Set();
  for (const c of ALL) {
    if (c.bake && prev[c.id] !== next[c.id]) need.add(c.bake);
  }
  if (prev.shapeClock !== next.shapeClock) need.add('shape');
  return need;
}
