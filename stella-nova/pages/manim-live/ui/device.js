// ============================================================================
//  DEVICE  ·  render quality, frame cache size and download advice per device
// ----------------------------------------------------------------------------
//  A phone runs Pyodide, numpy, scipy and manim in one worker, and keeps
//  every rendered frame as an ImageBitmap in ui/player.js. Both use the
//  memory of one browser tab, and iOS Safari closes a tab that uses too
//  much. This file picks smaller defaults for small or low-memory devices.
//  All functions are pure, so node tests can call them.
//
//  PROFILE. deviceProfile() reads navigator.deviceMemory (GB, Chromium
//  only, 8 or less), navigator.hardwareConcurrency, and the phone media
//  query. "low" is 4 GB or less, or a touch device with 4 cores or less.
//  iOS Safari gives no deviceMemory, so an iPhone is "small" by width.
//
//  QUALITY. defaultQuality() gives 'phone' (640x360, 15 fps) for a small
//  or low device, else 'low' (854x480, 15 fps). It is only a default: a
//  quality that the user picks is kept in the prefs and wins.
//
//  FRAME CACHE. frameBudgetMB() gives the bytes of full-size frames that
//  ui/player.js keeps before it keeps half-size copies.
//
//  DOWNLOAD. The first load is about DOWNLOAD_MB (Pyodide, numpy, scipy
//  and the other packages from the CDN, the wheels, MathJax). The browser
//  cache keeps it for later visits. networkAdvice() reads the Network
//  Information API (Chromium only):
//    saveData on                     -> 'ask'   wait for a tap, then load
//    cellular, or 2g / 3g speed      -> 'warn'  load, and show the size
//    else, or no API (iOS Safari)    -> 'none'
//
//  EXPORTS
//    DOWNLOAD_MB
//    deviceProfile({deviceMemory, hardwareConcurrency, phone, coarse})
//    defaultQuality(profile)          -> 'phone' | 'low'
//    frameBudgetMB(profile)           -> MB
//    networkAdvice(connection)        -> {level, text}
// ============================================================================

export const DOWNLOAD_MB = 40;

export function deviceProfile({ deviceMemory, hardwareConcurrency, phone = false, coarse = false } = {}) {
  const memGB = Number.isFinite(deviceMemory) && deviceMemory > 0 ? deviceMemory : null;
  const cores = Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : null;
  const low = (memGB != null && memGB <= 4) || (coarse && cores != null && cores <= 4);
  return { memGB, cores, small: !!phone, low };
}

export function defaultQuality(p) {
  return p && (p.small || p.low) ? 'phone' : 'low';
}

export function frameBudgetMB(p) {
  if (!p) return 700;
  if (p.memGB != null && p.memGB <= 2) return 128;
  if (p.small || p.low) return 256;
  return 700;
}

export function networkAdvice(conn, mb = DOWNLOAD_MB) {
  if (!conn) return { level: 'none', text: '' };
  if (conn.saveData) {
    return { level: 'ask', text: `Data Saver is on. Python and manim need about ${mb} MB on the first visit. Tap Load Python or Run to start.` };
  }
  const slow = ['slow-2g', '2g', '3g'].includes(conn.effectiveType);
  if (conn.type === 'cellular' || slow) {
    return { level: 'warn', text: `Mobile data: the first visit downloads about ${mb} MB. The browser keeps it for later visits.` };
  }
  return { level: 'none', text: '' };
}
