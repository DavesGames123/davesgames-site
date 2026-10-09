// ============================================================================
//  PLANET FORGE  ·  budget.js — memory guards (no DOM)
// ----------------------------------------------------------------------------
//  Three budgets, so a phone never gets a 4k planet it cannot hold:
//
//  MAPS (CPU)  mapBytes(W): the buffers that sampleRows, finish and one PNG
//  export keep alive per texel: height f32 (4), albedo, mat, emissive,
//  cloud, normal RGBA8 (5 x 4), ao (1), an export image (4) and the stripe
//  copies in flight (8). pickWidth(requested, env) returns the largest
//  width <= requested whose bytes fit cpuBudget(env).
//
//  TEXTURES (GPU)  five RGBA8 textures with mips (x 4/3). gpuWidth(W, env)
//  caps the uploaded width at 2048, or 4096 on a desktop with >= 8 GB.
//
//  VIEW  viewBudget(cssW, cssH, dpr, env) caps the canvas: device px at
//  most MAX_PX (2560 x 1440) on a desktop, TABLET_PX on a tablet,
//  PHONE_PX on a phone, and the ratio at 2 (1.5 on a phone). The view
//  renders straight into the canvas (one full-screen pass, no MSAA, no HDR
//  target), so its bytes are the swap chain: 3 x 4 B per px.
//  viewSteps(env) gives the atmosphere ray steps: 14 phone, 18 tablet, 24.
//  The optional scale (createResScale, below) lowers the ratio further
//  when frames stay slow.
//
//  A tablet is a touch screen (env.coarse) that is not a phone. Safari
//  does not give deviceMemory, so without this profile an iPad got the
//  desktop default: 4k maps (310 MB) and 4k textures.
//
//  env = { mobile, coarse, deviceMemory (GB, may be undefined: Safari), cores }
//  EXPORTS  WIDTHS, BYTES_PER_TEXEL, MAX_PX, TABLET_PX, PHONE_PX, mapBytes,
//           cpuBudget, pickWidth, gpuWidth, cloudWidth, gpuBytes, viewBudget, viewSteps,
//           defaultWidth, createResScale, RES_FLOOR
// ============================================================================

export const WIDTHS = [512, 1024, 2048, 4096];
export const BYTES_PER_TEXEL = 4 + 5 * 4 + 1 + 4 + 8;   // 37
export const MAX_PX = 2560 * 1440, TABLET_PX = 2048 * 1536, PHONE_PX = 1280 * 900;

export function mapBytes(W) { return W * (W / 2) * BYTES_PER_TEXEL; }

export function cpuBudget(env = {}) {
  if (env.mobile) return 120e6;
  if (env.coarse) return env.deviceMemory ? Math.min(200e6, env.deviceMemory * 45e6) : 200e6;
  const gb = env.deviceMemory;
  if (!gb) return 340e6;               // unknown (Safari): a desktop default
  return Math.min(600e6, gb * 45e6);   // 4 GB -> 180 MB, 8 GB -> 360 MB
}

export function pickWidth(requested, env = {}) {
  const cap = cpuBudget(env);
  let best = WIDTHS[0];
  for (const w of WIDTHS) if (w <= requested && mapBytes(w) <= cap) best = w;
  return best;
}

export function defaultWidth(env = {}) { return env.mobile ? 1024 : pickWidth(2048, env); }

export function gpuWidth(W, env = {}) {
  const cap = !env.mobile && !env.coarse && env.deviceMemory >= 8 ? 4096 : 2048;
  return Math.min(W, cap);
}
// The evolving cloud map (render.js dyn): 2k x 1k (8 MB) on a desktop,
// 1k x 512 (2 MB) on a phone or tablet.
export function cloudWidth(env = {}) { return env.mobile || env.coarse ? 1024 : 2048; }
export function gpuBytes(W) { return 5 * W * (W / 2) * 4 * 4 / 3; }

// scale: the dynamic resolution (createResScale), 1 = the full budget.
export function viewBudget(cssW, cssH, dpr = 1, env = {}, scale = 1) {
  const maxPx = env.mobile ? PHONE_PX : env.coarse ? TABLET_PX : MAX_PX;
  const area = Math.max(1, cssW * cssH);
  let pr = Math.min(dpr || 1, env.mobile ? 1.5 : 2, Math.sqrt(maxPx / area)) * Math.min(1, scale || 1);
  pr = Math.max(0.25, Math.floor(pr * 1000) / 1000);
  const w = Math.max(1, Math.round(cssW * pr)), h = Math.max(1, Math.round(cssH * pr));
  return { pr, w, h, px: w * h, bytes: w * h * 12 };
}

export function viewSteps(env = {}) { return env.mobile ? 14 : env.coarse ? 18 : 24; }

// Dynamic resolution, a safety net (main.js frame): the view budget above
// is the ceiling, and this scale (RES_FLOOR..1) multiplies its pixel ratio
// when the measured frame time stays slow. update(dtMs) takes the time
// between two frames and returns the scale. A frame time EMA above
// slowMs for 0.5 s steps the scale down by 0.85; below fastMs for 3 s (or
// longer after a bounce) it steps up by 1 / 0.9. Gaps over 250 ms (a hidden tab, a long task) are
// not counted. The scale stays at 1 on a machine that keeps 60 fps.
export const RES_FLOOR = 0.6;
export function createResScale(o = {}) {
  const slow = o.slowMs ?? 22, fast = o.fastMs ?? 18, floor = o.floor ?? RES_FLOOR;
  // hold: the fast time before a step up. A drop soon after a rise
  // makes it 4 x longer (up to 2 min), so a GPU at the edge of a vsync interval
  // does not bounce between two scales every few seconds.
  let scale = 1, ema = 0, slowT = 0, fastT = 0, hold = 3000, sinceUp = Infinity;
  return {
    get scale() { return scale; },
    update(dt) {
      if (!(dt > 0) || dt > 250) { slowT = fastT = 0; return scale; }
      sinceUp += dt;
      ema = ema ? ema + (dt - ema) * 0.1 : dt;
      if (ema > slow) { slowT += dt; fastT = 0; } else if (ema < fast) { fastT += dt; slowT = 0; } else { slowT = fastT = 0; }
      if (slowT > 500 && scale > floor) {
        if (sinceUp < 5000) hold = Math.min(120000, hold * 4);
        scale = Math.max(floor, Math.round(scale * 0.85 * 100) / 100); slowT = 0; ema = 0;
      } else if (fastT > hold && scale < 1) { scale = Math.min(1, Math.round(scale / 0.9 * 100) / 100); fastT = 0; ema = 0; sinceUp = 0; }
      return scale;
    },
  };
}
