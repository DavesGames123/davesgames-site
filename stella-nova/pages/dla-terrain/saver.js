// ============================================================================
//  DLA TERRAIN  ·  saver.js — the screensaver shot plan and framing (no DOM)
// ----------------------------------------------------------------------------
//  main.js owns the hook (window.snSaver) and applies each shot; this file
//  only decides WHAT is on screen, so node tests can check it.
//
//  SHOTS (SHOT_KINDS)  each 5..12 s, seeded:
//    ridge     drone along a ridge at golden hour (morning or evening)
//    river     drone low along a river, morning light
//    sunrise   time-lapse: tod 0.20 -> 0.33 over the shot, slow orbit, valley fog
//    storm     fair -> thunderstorm, the sky clock x 5 so the front arrives
//              in the shot, lightning
//    snow      winter, snowfall, a slow low orbit
//    forming   a NEW terrain (new seed) grows from DLA in front of the camera
//    vista     a wide high orbit at midday, fair weather
//    night     moonlight and stars, clear, a slow orbit
//  buildShotPlan(seed, n, opts) -> [shot]: a seeded shuffle, 'forming'
//    first, no kind twice in a row, each kind at most once per 6 shots.
//    opts.channel === 'build' gives the BUILD CHANNEL instead: every shot
//    is kind 'build', a new seeded world played from DLA to biomes stage
//    by stage ("Watch it build", build.js), at opts.speed (1..4; from the
//    shell's opts.seconds when given: buildSpeed). main.js picks the
//    channel from snSaver.enter({ channel }) or from the page's "Watch it
//    build" toggle.
//  framing(W, H, band) -> { fovY, shift, distK, portrait }: the lens and the
//    NDC y shift that put the subject in the middle of the clear band of the
//    shell plate (plateBand of lib/saver-clear.js). A 9:16 frame gets a wider
//    vertical lens and a farther camera, so a ridge still fills the width.
//  subjectScreenY(fr, H) -> px: where the image centre (the subject) lands.
//  shotLabel(shot, st, code) -> the opts.label payload of the shell poster.
//    st.build = { name, caption, index, label } puts the stage name and its
//    caption on the plate (build shots).
//  extractFn(src, name) -> the text of one WGSL or JS function (a real
//    extract for the poster code field).
//
//  grep -n targets: "export const SHOT_KINDS", "export function buildShotPlan",
//  "export function framing", "export function shotLabel", "export function extractFn"
// ============================================================================

import { TOTAL_S } from './build.js';

export const SHOT_KINDS = Object.freeze({
  ridge: { sub: 'Drone flight along a DLA ridge at golden hour', min: 8, max: 12 },
  river: { sub: 'Following a river carved by branched flow', min: 8, max: 12 },
  sunrise: { sub: 'Sunrise time-lapse, valley fog burns off', min: 8, max: 12 },
  storm: { sub: 'A thunderstorm rolls in', min: 9, max: 12 },
  snow: { sub: 'Snowfall in winter', min: 7, max: 11 },
  forming: { sub: 'A new terrain grows from diffusion-limited aggregation', min: 9, max: 12 },
  vista: { sub: 'A wide vista over the range', min: 6, max: 10 },
  night: { sub: 'Moonlight over the ridges', min: 5, max: 9 },
});

// the code extract of each shot: [file, function name, language]
export const SHOT_CODE = Object.freeze({
  ridge: ['shaders/common.wgsl', 'sunShadowAt', 'wgsl'],
  river: ['gpu/terrain.wgsl', 'blend', 'wgsl'],
  sunrise: ['shaders/post.wgsl', 'fs_expo', 'wgsl'],
  storm: ['shaders/post.wgsl', 'fs_composite', 'wgsl'],
  snow: ['shaders/common.wgsl', 'sunShadow', 'wgsl'],
  forming: ['gpu/terrain.wgsl', 'blend', 'wgsl'],
  build: ['shaders/build.wgsl', 'walkerGlow', 'wgsl'],
  vista: ['shaders/post.wgsl', 'agx', 'wgsl'],
  night: ['shaders/common.wgsl', 'baseHeight', 'wgsl'],
});

export function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BUILD_SHOT = Object.freeze({ sub: 'Watch it build: a new world from DLA to biomes', total: TOTAL_S });
// the playback speed that fits a build into the shell's page time
export function buildSpeed(seconds, total = BUILD_SHOT.total) {
  if (!(seconds > 0)) return 1.25;
  return Math.max(1, Math.min(4, +(total / (seconds * 0.85)).toFixed(2)));
}

export function buildShotPlan(seed, n = 12, opts = {}) {
  if (opts.channel === 'build') return buildChannel(seed, n, opts);
  const r = mulberry(seed * 2654435761 + 7);
  const kinds = Object.keys(SHOT_KINDS);
  const plan = [];
  const recent = [];
  for (let i = 0; i < n; i++) {
    let kind;
    if (i === 0) kind = 'forming';
    else {
      const ok = kinds.filter(k => k !== plan[i - 1].kind && !recent.slice(-5).includes(k));
      kind = ok[Math.floor(r() * ok.length)] || kinds[Math.floor(r() * kinds.length)];
    }
    recent.push(kind);
    const K = SHOT_KINDS[kind];
    const dur = +(K.min + (K.max - K.min) * r()).toFixed(2);
    const shot = { i, kind, sub: K.sub, dur, seed: Math.floor(r() * 1e6) + 1 };
    // per kind: time, weather, season and the camera
    const evening = r() < 0.5;
    switch (kind) {
      case 'ridge': Object.assign(shot, { tod: evening ? 0.705 + r() * 0.02 : 0.27 + r() * 0.02, weather: r() < 0.6 ? 'golden-haze' : 'fair', season: 0.3 + r() * 0.2, cam: { type: 'drone', path: 'ridge', clearance: 70 + r() * 90, speed: 70 + r() * 50, reverse: r() < 0.5, pick: r() } }); break;
      case 'river': Object.assign(shot, { tod: 0.34 + r() * 0.05, weather: r() < 0.5 ? 'fair' : 'clear', season: 0.25 + r() * 0.25, cam: { type: 'drone', path: 'river', clearance: 25 + r() * 35, speed: 35 + r() * 25, reverse: false, pick: r() } }); break;
      case 'sunrise': Object.assign(shot, { tod: 0.2, todEnd: 0.33, weather: r() < 0.5 ? 'fair' : 'clear', season: 0.35, cam: { type: 'orbit', distK: 0.55 + r() * 0.2, pitch: -0.2 - r() * 0.12, yaw: Math.PI * 0.5 + (r() - 0.5) * 0.8, yawRate: 0.012 } }); break;
      case 'storm': Object.assign(shot, { tod: 0.45 + r() * 0.15, weather: 'fair', weatherEnd: 'thunderstorm', skySpeed: 5, season: 0.4, cam: { type: 'orbit', distK: 0.45 + r() * 0.2, pitch: -0.16 - r() * 0.1, yaw: r() * 6.28, yawRate: 0.01 } }); break;
      case 'snow': Object.assign(shot, { tod: 0.42 + r() * 0.12, weather: r() < 0.7 ? 'snow' : 'blizzard', season: 0.78, cam: { type: 'orbit', distK: 0.18 + r() * 0.15, pitch: -0.12 - r() * 0.1, yaw: r() * 6.28, yawRate: 0.02 } }); break;
      case 'forming': Object.assign(shot, { tod: 0.36 + r() * 0.1, weather: 'fair', season: 0.35, regen: true, cam: { type: 'orbit', distK: 0.6, pitch: -0.4, yaw: r() * 6.28, yawRate: 0.03 } }); break;
      case 'vista': Object.assign(shot, { tod: 0.4 + r() * 0.2, weather: r() < 0.5 ? 'fair' : 'cloudy', season: 0.3 + r() * 0.3, cam: { type: 'orbit', distK: 0.7 + r() * 0.3, pitch: -0.3 - r() * 0.15, yaw: r() * 6.28, yawRate: 0.015 } }); break;
      case 'night': Object.assign(shot, { tod: 0.95 + r() * 0.08, weather: 'clear', season: r(), cam: { type: 'orbit', distK: 0.5, pitch: -0.25, yaw: r() * 6.28, yawRate: 0.01 } }); break;
    }
    shot.tod %= 1;
    plan.push(shot);
  }
  return plan;
}

// the build channel: n new worlds, each played from DLA to biomes
function buildChannel(seed, n, opts) {
  const r = mulberry(seed * 2246822519 + 3);
  const speed = opts.speed || buildSpeed(opts.seconds, opts.total || BUILD_SHOT.total);
  const total = opts.total || BUILD_SHOT.total;
  const plan = [];
  for (let i = 0; i < n; i++) {
    const evening = r() < 0.5;
    plan.push({
      i, kind: 'build', sub: BUILD_SHOT.sub, speed, seed: Math.floor(r() * 1e6) + 1,
      dur: +(total / speed + 4).toFixed(2), regen: true, build: true,
      tod: evening ? 0.6 + r() * 0.08 : 0.32 + r() * 0.08, weather: r() < 0.7 ? 'fair' : 'clear',
      season: 0.3 + r() * 0.25, preset: r(), yaw0: r() * 6.2832,
      cam: { type: 'build' },
    });
  }
  return plan;
}

// the tod of a shot at time s (s from the shot start)
export function shotTod(shot, s) {
  if (shot.todEnd === undefined) return shot.tod;
  const u = Math.max(0, Math.min(1, s / shot.dur));
  return shot.tod + (shot.todEnd - shot.tod) * u;
}

export function framing(W, H, band) {
  const portrait = H > W * 1.05;
  const fovY = (portrait ? 64 : 46) * Math.PI / 180;
  const distK = portrait ? 1.3 : 1;
  let shift = 0;
  if (band && H > 0) {
    const yc = band.t + (H - band.t - band.b) / 2;
    shift = 1 - 2 * yc / H;
  }
  return { fovY, shift, distK, portrait };
}
// the image centre (the subject) in px from the top after the shift
export function subjectScreenY(fr, H) { return (1 - fr.shift) * H / 2; }

export function extractFn(src, name) {
  if (!src) return null;
  const re = new RegExp('(^|\\n)([^\\n]*\\bfn\\s+' + name + '\\s*\\(|[^\\n]*\\bfunction\\s+' + name + '\\s*\\()');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[1].length;
  // include the @compute / @fragment line above, if any
  const before = src.lastIndexOf('\n', i - 2);
  const prevLine = src.slice(before + 1, i - 1);
  if (/^\s*@(compute|fragment|vertex|workgroup_size)/.test(prevLine)) i = before + 1;
  const open = src.indexOf('{', m.index + m[0].length);
  if (open < 0) return null;
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1).replace(/\s+$/, ''); }
  }
  return null;
}

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');
export function todText(tod) {
  const m = Math.round(((tod % 1) + 1) % 1 * 1440);
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// st = { preset, seed, worldSize (m), tod, weather (label), n, stage }
export function shotLabel(shot, st, code) {
  const params = [
    { sym: '\\mathrm{seed}', name: 'Seed', value: String(st.seed ?? '-'), cls: 'm1' },
    { sym: 'L', name: 'World', value: fmt((st.worldSize || 0) / 1000, 0) + ' km', cls: 'm2' },
    { sym: 'n', name: 'Grid', value: st.n ? st.n + '²' : '-', cls: 'm3' },
    { sym: 't', name: 'Time', value: todText(st.tod ?? 0.5), cls: 'm4' },
    { sym: '\\mathrm{wx}', name: 'Weather', value: st.weather || '-', cls: 'm5' },
  ];
  if (st.preset) params.unshift({ sym: '\\mathrm{P}', name: 'Preset', value: st.preset, cls: 'm6' });
  const b = st.build;
  if (b) params.unshift({ sym: 'k', name: 'Stage', value: `${b.index + 1} of 8 · ${b.label}`, cls: 'm1' });
  return {
    title: 'DLA Terrain',
    sub: b ? 'Watch it build · ' + b.name : shot ? shot.sub : 'Ridges from DLA, rivers from branched flow',
    params,
    lines: b ? [b.caption] : [st.stage ? 'Stage: ' + st.stage : 'Diffusion-limited aggregation (dlaf, MIT, Michael Fogleman) + branched flow + erosion'],
    tex: ['h_{k+1} = \\mathrm{blur}(\\uparrow h_k) + \\left(1 - \\frac{1}{1 + L/k}\\right)'],
    rules: [['h', 'm1'], ['L', 'm2']],
    code: code || undefined,
  };
}
