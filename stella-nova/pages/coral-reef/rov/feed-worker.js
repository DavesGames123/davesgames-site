// ============================================================================
//  CORAL REEF  ·  ROV  ·  feed worker: SSTV encode and noise off the main
//  thread (module worker). One message per camera frame:
//    in:  { id, img: { w, h, data }, params }   (link.js frameParams)
//    out: { id, samples, env, envHz, params }   (buffers transferred)
//  The encode of one Robot 36 frame is about 20 ms; here it costs no frame.
// ============================================================================
import { makeSamples } from './link.js';

self.onmessage = (e) => {
  const { id, img, params } = e.data;
  try {
    const S = makeSamples(img, params);
    self.postMessage({ id, samples: S.samples, env: S.env, envHz: S.envHz, params: S.params }, [S.samples.buffer, S.env.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
