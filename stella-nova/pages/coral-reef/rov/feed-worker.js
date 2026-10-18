// ============================================================================
//  CORAL REEF  ·  ROV  ·  feed worker: SSTV encode and noise off the main
//  thread (module worker). One message per camera frame:
//    in:  { id, stream?, img: { w, h, data }, params }   (link.js frameParams)
//    out: { id, stream?, samples, env, envHz, params }   (buffers transferred)
//  stream: the feed of one ROV when one worker serves all the feeds
//  (rov/feeds.js); the worker sends it back so the page routes the result.
//  The encode of one Robot 36 frame is about 20 ms; here it costs no frame.
// ============================================================================
import { makeSamples } from './link.js';

self.onmessage = (e) => {
  const { id, stream, img, params } = e.data;
  try {
    const S = makeSamples(img, params);
    self.postMessage({ id, stream, samples: S.samples, env: S.env, envHz: S.envHz, params: S.params }, [S.samples.buffer, S.env.buffer]);
  } catch (err) {
    self.postMessage({ id, stream, error: String(err && err.message || err) });
  }
};
