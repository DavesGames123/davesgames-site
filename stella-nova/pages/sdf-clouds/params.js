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
// grep: export const PASSES  export const GROUPS  export function pack  BOX_

export const BOX_MIN = [-6, 1, -6];
export const BOX_MAX = [6, 4, 6];
export const ERO_RES = 64;
export const PARAM_VEC4 = 23;

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
    R('jitter', 'Jitter', 0, 1, 0.01, 1, null, 'Random start offset per pixel, in min steps. Trades banding for noise.'),
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
    R('wind', 'Wind', 0, 0.5, 0.005, 0.04, null, 'Scroll speed of the erosion texture.'),
    B('lightErosion', 'Erode light', false, 'light', 'Apply erosion in the light bake too. With wind on, the light map rebakes every frame.'),
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
    R('fogSteps', 'Fog steps', 4, 96, 1, 32, null, 'Fixed steps over the first 60 units of the ray.'),
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
    R('timeScale', 'Time scale', 0, 4, 0.01, 1, null, 'Scales the wind clock.'),
  ]},
  { id: 'viz', title: 'Pass settings', controls: [
    R('sliceY', 'Slice height', 0, 1, 0.005, 0.4, null, 'SDF slice and JFA pass, fraction of box height.'),
    R('heatMax', 'Heat max', 16, 800, 1, 220, null, 'Top of the step cost scale.'),
  ]},
];

const ALL = GROUPS.flatMap((g) => g.controls);
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

// Fill the Params uniform. Slot order must match common.wgsl struct Params.
export function pack(out, s, cam, time, frame) {
  const d = dims(s);
  const b = cameraBasis(cam);
  const sun = sunDir(s);
  const sc = sunColour(s);
  const on = (x) => (x ? 1 : 0);
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
    [s.wind, s.wind * 0.15, s.wind * 0.6, s.eroExp],
    [s.hgG, s.hgBias, s.hgScale, on(s.powder)],
    [s.powderK, s.powderMix, on(s.baked), s.liveSteps],
    [s.sliceY, s.heatMax, on(s.groundShadows), s.shadowStrength],
    [s.preset, s.coverage, s.freq, s.seed],
    [s.octaves, s.gain, s.topExp, s.botExp],
    [s.worleyMix, s.aoIntensity, s.aoOffset, s.exposure],
    [on(s.lightErosion), s.fogFalloff, on(s.softShadows), on(s.ground)],
    [s.warp, s.eroCells, s.fogSteps, s.lightMax],
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
  return need;
}
