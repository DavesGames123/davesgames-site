// ============================================================================
//  TIMELINE  ·  map frames, times and code lines to animations  (pure)
// ----------------------------------------------------------------------------
//  The engine sends one 'animation' event for each self.play or self.wait
//  call: {index, name, line, runTime, startFrame, endFrame}. These helpers
//  turn that list into timeline segments. The player and the editor use the
//  segments to go from a frame to a code line, and from a line to a frame.
//  No DOM here, so tests/ui.test.mjs can import this module in node.
//
//  EXPORTS   (grep -n "export function <name>" timeline.js)
//    buildSegments    animation events + total frames -> sorted segments
//    segmentAtFrame   frame index -> segment (binary search), or null
//    segmentsForLine  code line -> segments that line made
//    frameForLine     code line -> first frame of its first segment, or -1
//    linesWithSegments  Set of lines that have one or more segments
//    formatTime       seconds -> "m:ss.d"
// ============================================================================

// anims: animation events in any order. totalFrames: frames in the cache,
// or 0 while the render runs. fps: frames per second of the render.
// A segment gets endFrame from the event. When the event has no endFrame,
// the segment ends where the next one starts, or at totalFrames.
export function buildSegments(anims, totalFrames = 0, fps = 15) {
  const list = (anims || []).filter(a => a && Number.isFinite(+a.startFrame))
    .map(a => ({ ...a, startFrame: Math.max(0, Math.floor(+a.startFrame)) }))
    .sort((a, b) => a.startFrame - b.startFrame || (a.index ?? 0) - (b.index ?? 0));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const next = list[i + 1];
    let end = Number.isFinite(+a.endFrame) ? Math.floor(+a.endFrame) : NaN;
    if (!Number.isFinite(end)) end = next ? next.startFrame : Math.max(totalFrames, a.startFrame + 1);
    if (end <= a.startFrame) end = a.startFrame + 1;
    out.push({
      index: a.index ?? i,
      name: String(a.name || 'Animation'),
      line: Number.isFinite(+a.line) ? +a.line : null,
      runTime: Number.isFinite(+a.runTime) ? +a.runTime : (end - a.startFrame) / fps,
      startFrame: a.startFrame,
      endFrame: end,                       // exclusive
      t0: a.startFrame / fps,
      t1: end / fps,
    });
  }
  return out;
}

// Frame -> the segment whose [startFrame, endFrame) holds it. A frame in
// a gap (for example the frames before the first play) gives null.
export function segmentAtFrame(segs, frame) {
  let lo = 0, hi = segs.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].startFrame <= frame) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (hit < 0) return null;
  // Two segments can start on the same frame (a wait of 0 s). Use the
  // last one that still holds the frame.
  for (let i = hit; i >= 0; i--) if (frame < segs[i].endFrame) return segs[i];
  return null;
}

export function segmentsForLine(segs, line) {
  return segs.filter(s => s.line === line);
}

export function frameForLine(segs, line) {
  const s = segs.find(x => x.line === line);
  return s ? s.startFrame : -1;
}

export function linesWithSegments(segs) {
  const set = new Set();
  for (const s of segs) if (s.line != null) set.add(s.line);
  return set;
}

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
