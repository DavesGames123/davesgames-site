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
//
//  A tablet is a touch screen (env.coarse) that is not a phone. Safari
//  does not give deviceMemory, so without this profile an iPad got the
//  desktop default: 4k maps (310 MB) and 4k textures.
//
//  env = { mobile, coarse, deviceMemory (GB, may be undefined: Safari), cores }
//  EXPORTS  WIDTHS, BYTES_PER_TEXEL, MAX_PX, TABLET_PX, PHONE_PX, mapBytes,
//           cpuBudget, pickWidth, gpuWidth, gpuBytes, viewBudget, viewSteps,
//           defaultWidth
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
export function gpuBytes(W) { return 5 * W * (W / 2) * 4 * 4 / 3; }

export function viewBudget(cssW, cssH, dpr = 1, env = {}) {
  const maxPx = env.mobile ? PHONE_PX : env.coarse ? TABLET_PX : MAX_PX;
  const area = Math.max(1, cssW * cssH);
  let pr = Math.min(dpr || 1, env.mobile ? 1.5 : 2, Math.sqrt(maxPx / area));
  pr = Math.max(0.25, Math.floor(pr * 1000) / 1000);
  const w = Math.max(1, Math.round(cssW * pr)), h = Math.max(1, Math.round(cssH * pr));
  return { pr, w, h, px: w * h, bytes: w * h * 12 };
}

export function viewSteps(env = {}) { return env.mobile ? 14 : env.coarse ? 18 : 24; }
