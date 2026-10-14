// ============================================================================
//  STEM SPLITTER  ·  ui/format.js — text for times, sizes and progress
// ----------------------------------------------------------------------------
//  Pure functions, no DOM. The UI tests check each string exactly
//  (CONTRACT 8.3: "0:42", "12:05").
//
//  fmtTime rounds to the nearest second. It gives m:ss under one hour and
//  h:mm:ss from one hour. fmtMB divides by 1e6 (the sizes in models.js are
//  bytes, and the UI says "MB" for 1e6 bytes).
//
//  Progress events are the worker events of CONTRACT 5.3:
//    { phase: 'download', loaded, total }   downloading the model
//    { phase: 'verify' }                     sha256 check
//    { phase: 'session' }                    session build
//    { phase: 'separate', done, total, elapsedMs, etaMs }
//
//  GREP MAP
//    fmtTime ........... seconds -> "m:ss" or "h:mm:ss"
//    fmtMB ............. bytes -> "90.7 MB"
//    phaseText ......... progress event -> the phase line
//    phaseFraction ..... progress event -> 0..1 for the bar (or null)
//    timesText ......... elapsed and time left -> "0:42 elapsed · 12:05 left"
//    epText ............ engine EP -> "GPU (WebGPU)" or "CPU (slower)"
// ============================================================================

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtMB(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

export function phaseText(ev) {
  if (!ev) return '';
  switch (ev.phase) {
    case 'download':
      return ev.total > 0
        ? `Downloading model ${(ev.loaded / 1e6).toFixed(1)} of ${fmtMB(ev.total)}`
        : `Downloading model ${fmtMB(ev.loaded)}`;
    case 'verify': return 'Checking the model download';
    case 'session': return 'Preparing the model';
    case 'separate': return `Separating segment ${ev.done} of ${ev.total}`;
    default: return '';
  }
}

export function phaseFraction(ev) {
  if (!ev) return null;
  if (ev.phase === 'download') return ev.total > 0 ? Math.min(1, ev.loaded / ev.total) : null;
  if (ev.phase === 'separate') return ev.total > 0 ? Math.min(1, ev.done / ev.total) : null;
  return null;
}

// elapsedMs: time since the user pressed Separate. leftMs: null when there
// is no estimate yet.
export function timesText(elapsedMs, leftMs) {
  const a = `${fmtTime(elapsedMs / 1000)} elapsed`;
  if (leftMs === null || leftMs === undefined || !Number.isFinite(leftMs)) return a;
  return `${a} · ${fmtTime(leftMs / 1000)} left`;
}

export function epText(ep) {
  if (ep === 'webgpu') return 'GPU (WebGPU)';
  if (ep === 'wasm') return 'CPU (slower)';
  return 'Checking…';
}
