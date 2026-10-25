// ============================================================================
//  STEREOGRAM ENGINE  ·  engine/animate.js — animated stereograms
// ----------------------------------------------------------------------------
//  Each frame is a sirds() image of one depth frame with the same tile,
//  the same seed and the same eye geometry. The dots of a free pixel come
//  from a hash of its position (sirds.js hash3), so the background of
//  each frame is the same and only the object region changes. The eye
//  keeps its fusion from frame to frame.
//
//  grep -n targets: "export function animate"
// ============================================================================
import { sirds } from './sirds.js';

// frames: DepthMap[]. opts: the sirds options (tile with source 'tile').
// onFrame(k, image) is called after each frame, if it is given.
export function animate(frames, opts = {}, onFrame = null) {
  const o = Object.assign({ seed: 1 }, opts);
  if (o.tile && !o.source) o.source = 'tile';
  const out = [];
  for (let k = 0; k < frames.length; k++) {
    const img = sirds(frames[k], o);
    out.push(img);
    if (onFrame) onFrame(k, img);
  }
  return { frames: out };
}
