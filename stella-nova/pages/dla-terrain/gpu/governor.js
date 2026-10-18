// ============================================================================
//  DLA TERRAIN  ·  gpu/governor.js — the quality ladder of the frame graph (CORE)
// ----------------------------------------------------------------------------
//  The governor keeps the frame under the profile budget (gpu/budget.js
//  budgetMs). It holds two values: the render scale and the ladder level.
//  DOM-free: gpu/frame.js uses it and the node tests import it.
//
//  WHY (2026-10-18, the user, Safari on a Mac: "the zoomed in version also
//  looks awful, no shadows occluders or naything esle really to work with").
//  The old governor stepped a level down only after 8 s under 0.6 x the
//  budget, so at 58 fps it never came back. Its level 3 took every shadow
//  caster away and level 2 took TAA away. Now the look goes last, and the
//  level comes back when the GPU time shows headroom.
//
//  THE LADDER (level n = the first n rungs are on). The slow-frame path
//  first lowers the render scale to the soft floor (cfg.floor: 0.75 on the
//  desktop, safari and safe profiles, 0.5 on phones), then takes the
//  rungs 1 to STEADY_MAX. Only a heavy frame (gpu/frame.js heavyStep), a
//  stuck frame or a memory relief goes further.
//    1 shafts     volumetric light shafts -> screen shafts, and fewer cloud
//                 steps (frame.gov.cloudK 0.6, for SKY to read)
//    2 pom        GROUND: no POM, no vertex relief (frame.govLevel 1)
//    3 ao         no SSAO (frame.ao false)
//    4 grass      no grass (frame.layers.grass false)
//    5 shadowRes  shadow maps at half size (not under 1024)
//    6 cascades2  2 shadow cascades at most
//    7 cascade1   1 shadow cascade; trees and rocks still cast in it
//    8 emergency  no shadow casters, no shafts, no TAA, few cloud steps
//                 (frame.gov.cloudK 0.35; frame.govLevel 5). Heavy frames
//                 only. The clouds stay: with the clouds off, their
//                 shadows stayed on the ground and the sky had no cloud
//                 (the user: "that is the only thing i see of the clouds").
//  profile.govForce: rung keys that are on at every level (safe: pom,
//  cascade1). The rung keys are the contract with frame.js and main.js.
//
//  STEP DOWN (quality down), per frame time sample: the frame is slow when
//  max(frame ms, GPU ms) is over SLOW_K x budget and the GPU is not idle
//  (GPU ms under GPU_IDLE_K x budget: a slow CPU, fewer GPU features do not
//  help). OVER_SCALE s of slow frames: scale - 0.1 (to the soft floor);
//  at the floor OVER_LEVEL s: level + 1 (to STEADY_MAX).
//
//  STEP UP (quality up): HEAD_K x budget of the GPU time (the frame time
//  when no GPU time is known) for UP_HOLD s, at least UP_GAP s after the
//  last change of any kind, and not in the HEAVY_PAUSE after a heavy frame.
//  A CALM_HOLD s run of frames that are not slow also starts a step up (a
//  probe): Safari can give GPU times that do not show the headroom, and at
//  58 fps on a 60 Hz screen the frame time alone never does.
//  The order is the reverse of the step down: a scale under the soft floor
//  first, then the levels one by one, then the scale to the preset.
//  HYSTERESIS: after a step up the governor watches PROBE s. Slow frames
//  for PROBE_OVER s in that time undo the step at once and double the hold
//  of that step (BACKOFF_MAX x at most, back to 1 x after BACKOFF_RESET s).
//  So a level on a cost cliff is tried less and less often.
//
//  grep -n targets: "export const RUNGS", "export function featuresOf",
//  "export function planOf", "export function createGovernor",
//  "export function governorStep", "export function governorHeavy",
//  "export function describe", "export const GOV"
// ============================================================================

export const RUNGS = Object.freeze([
  { key: 'shafts', label: 'screen shafts' },
  { key: 'pom', label: 'no POM' },
  { key: 'ao', label: 'no AO' },
  { key: 'grass', label: 'no grass' },
  { key: 'shadowRes', label: 'half shadow maps' },
  { key: 'cascades2', label: '2 cascades' },
  { key: 'cascade1', label: '1 cascade' },
  { key: 'emergency', label: 'EMERGENCY: no shadows, TAA, fewer cloud steps' },
]);
export const MAX_LEVEL = RUNGS.length;      // 8, the emergency level
export const STEADY_MAX = MAX_LEVEL - 1;    // 7, the end of the slow-frame path
export const RELIEF_LEVEL = 5;              // a memory relief: half shadow maps and up

export const GOV = Object.freeze({
  SLOW_K: 1.08, HEAD_K: 0.75, GPU_IDLE_K: 0.6,
  OVER_SCALE: 1, OVER_LEVEL: 2,
  UP_HOLD: 2.5, UP_GAP: 2, CALM_HOLD: 6, PROBE: 2, PROBE_OVER: 0.5,
  BACKOFF_MAX: 16, BACKOFF_RESET: 90, HEAVY_PAUSE: 8,
  SCALE_DOWN: 0.1, SCALE_UP: 0.05,
});

const r2 = v => Math.round(v * 100) / 100;

// the rung keys that are on at a level, plus the forced keys
export function featuresOf(level, force = []) {
  const f = new Set(force || []);
  for (let i = 0; i < Math.min(level | 0, MAX_LEVEL); i++) f.add(RUNGS[i].key);
  return f;
}

// what the frame graph does with a feature set. base = { size, count, taa }
// (the user or quality values: the plan never goes over them)
export function planOf(f, base = {}) {
  const em = f.has('emergency');
  const size0 = base.size || 2048, count0 = Math.max(1, base.count || 1);
  return {
    emergency: em,
    // the level that the modules read today (frame.govLevel): GROUND POM
    // off at 1 and up; AO, the vegetation TAA guess and the shafts react
    // only at 2, 3 and 5, so 1 keeps them on, and 5 is the emergency
    compatLevel: em ? 5 : f.has('pom') ? 1 : 0,
    ao: !em && !f.has('ao'),
    shafts: em ? 'off' : f.has('shafts') ? 'screen' : null,
    grass: !em && !f.has('grass'),
    clouds: true,
    cloudK: em ? 0.35 : f.has('shafts') ? 0.6 : 1,
    taa: !!base.taa && !em,
    casters: !em,
    shadowSize: f.has('shadowRes') ? Math.min(size0, Math.max(1024, size0 >> 1)) : size0,
    cascades: f.has('cascade1') ? 1 : f.has('cascades2') ? Math.min(2, count0) : count0,
  };
}

// st.t is the governor clock (s): the sum of the frame times
export function createGovernor(scale = 1, level = 0) {
  return {
    scale, level, over: 0, head: 0, calm: 0, t: 0, lastChange: -1e9,
    upAt: -1e9, upKey: null, upPrev: null, pauseUntil: -1e9,
    backoff: {}, ups: 0, downs: 0, reverts: 0,
  };
}

// the backoff factor of one step up (1 = no failed probe in BACKOFF_RESET s)
function kOf(st, key) {
  const b = st.backoff[key];
  if (!b) return 1;
  if (st.t - b.at > GOV.BACKOFF_RESET) { delete st.backoff[key]; return 1; }
  return b.k;
}
function bump(st, key) {
  const b = st.backoff[key];
  st.backoff[key] = { k: Math.min(GOV.BACKOFF_MAX, (b ? b.k : 1) * 2), at: st.t };
}

// one frame time sample: s = { ms, gpuMs }, cfg = { budget, maxScale,
// floor, minLevel, maxLevel }. Returns null or { what: 'scale' | 'level',
// dir: -1 (quality down) | +1 (quality up) | 0 (an undo), from, to }.
export function governorStep(st, s, cfg) {
  const ms = Math.max(0, +s.ms || 0), g = Math.max(0, +s.gpuMs || 0);
  const B = cfg.budget, maxScale = cfg.maxScale ?? 1;
  const floor = Math.min(cfg.floor ?? 0.75, maxScale), minLevel = cfg.minLevel | 0;
  const maxLevel = Math.min(cfg.maxLevel ?? STEADY_MAX, MAX_LEVEL);
  const dt = Math.min(ms, 100) / 1000;
  st.t += dt;
  const slowMs = Math.max(ms, g);
  const gpuIdle = g > 0 && g < B * GOV.GPU_IDLE_K;
  const load = g > 0 ? g : ms;
  if (slowMs > B * GOV.SLOW_K && !gpuIdle) { st.over += dt; st.head = 0; st.calm = 0; }
  else if (load < B * GOV.HEAD_K) { st.head += dt; st.calm += dt; st.over = Math.max(0, st.over - dt); }
  else { st.over = Math.max(0, st.over - dt); st.head = 0; st.calm += dt; }
  // the probe: slow frames just after a step up undo it at once
  if (st.upKey && st.t - st.upAt < GOV.PROBE && st.over > GOV.PROBE_OVER) {
    const p = st.upPrev, key = st.upKey;
    bump(st, key);
    st.upKey = null; st.over = 0; st.head = 0; st.calm = 0; st.lastChange = st.t; st.reverts++;
    if (p.level !== st.level) { const from = st.level; st.level = p.level; return { what: 'level', dir: 0, from, to: st.level }; }
    const from = st.scale; st.scale = p.scale; return { what: 'scale', dir: 0, from, to: st.scale };
  }
  if (st.t - st.upAt >= GOV.PROBE) st.upKey = null;
  // step down
  if (st.over > GOV.OVER_SCALE && st.scale > floor + 1e-6) {
    const from = st.scale;
    st.scale = Math.max(floor, r2(st.scale - GOV.SCALE_DOWN));
    st.over = 0; st.calm = 0; st.lastChange = st.t; st.downs++;
    return { what: 'scale', dir: -1, from, to: st.scale };
  }
  if (st.over > GOV.OVER_LEVEL && st.scale <= floor + 1e-6 && st.level < maxLevel) {
    const from = st.level;
    st.level++; st.over = 0; st.calm = 0; st.lastChange = st.t; st.downs++;
    return { what: 'level', dir: -1, from, to: st.level };
  }
  // step up: the reverse order
  if (st.t < st.pauseUntil || st.t - st.lastChange < GOV.UP_GAP) return null;
  let key = null;
  if (st.scale < floor - 1e-6) key = 'scale-floor';
  else if (st.level > minLevel) key = 'level-' + (st.level - 1);
  else if (st.scale < maxScale - 1e-6) key = 'scale';
  if (!key) return null;
  const k = kOf(st, key);
  if (st.head < GOV.UP_HOLD * k && st.calm < GOV.CALM_HOLD * k) return null;
  st.upPrev = { scale: st.scale, level: st.level };
  st.upKey = key; st.upAt = st.t; st.head = 0; st.calm = 0; st.lastChange = st.t; st.ups++;
  if (key === 'scale-floor') { const from = st.scale; st.scale = Math.min(floor, r2(st.scale + GOV.SCALE_UP)); return { what: 'scale', dir: 1, from, to: st.scale }; }
  if (key === 'scale') { const from = st.scale; st.scale = Math.min(maxScale, r2(st.scale + GOV.SCALE_UP)); return { what: 'scale', dir: 1, from, to: st.scale }; }
  const from = st.level; st.level--;
  return { what: 'level', dir: 1, from, to: st.level };
}

// a heavy frame (gpu/frame.js heavyStep): no step up for HEAVY_PAUSE s,
// and a step up just before it counts as a failed probe
export function governorHeavy(st) {
  st.pauseUntil = st.t + GOV.HEAVY_PAUSE;
  st.head = 0; st.calm = 0;
  if (st.upKey && st.t - st.upAt < GOV.PROBE * 2) bump(st, st.upKey);
  st.upKey = null;
}

// the status line text: what is lower than the preset ('' when nothing)
export function describe(o) {
  const parts = [];
  if (o.scale < (o.maxScale ?? 1) - 1e-6) parts.push(`render ${Math.round(o.scale * 100)}%`);
  if (o.nearCap) parts.push('near-ground pixel cap');
  const f = featuresOf(o.level, o.force);
  if (f.has('emergency')) parts.push(RUNGS[MAX_LEVEL - 1].label);
  else for (const r of RUNGS) if (f.has(r.key)) parts.push(r.label);
  if (!parts.length) return '';
  // why the level or the scale is held (gpu/frame.js fg.why: heavy GPU
  // frames, slow frames, a memory relief, a stuck frame)
  const why = o.why ? ` (why: ${o.why})` : '';
  return `${o.level ? 'level ' + o.level + ': ' : ''}${parts.join(', ')}${why}`;
}
