// ============================================================================
//  NONFLOWERS  ·  worker.js — one painting per message, off the main thread
// ----------------------------------------------------------------------------
//  A module worker. It fetches upstream/main.js (Nonflowers by Lingdong
//  Huang, MIT, see LICENSE-nonflowers.txt) as text once. Each job makes a
//  new engine with engine.js paint(), so the Prng, the Perlin table and the
//  implicit globals start fresh for each seed. The canvases are
//  OffscreenCanvas objects.
//
//  IN   { id, seed, record }   record: also the strokes (record.js)
//  OUT  { id, stage, at }               before each step (progress)
//       { id, seed, token, type, par, focus, leaf, base, painting, bg, blank, hash, ms }
//         painting  ImageBitmap 600 x 600 (transfer)
//         bg        ImageBitmap 512 x 512, the page paper (transfer)
//         blank     ImageBitmap 600 x 600, the sheet before the plant (transfer)
//         par       engine.js plainPAR(PAR)
//         hash      FNV-1a of the painting RGBA (for the parity check)
//         focus     engine.js plantFoci().flower: the petal window, or null
//         leaf      plantFoci().leaf: the stem and leaf window, or null
//         base      the root of the plant in painting px
//       with record: rec (record.js recordPaint, typed arrays transferred),
//         sheet, plant  ImageBitmaps 600 x 600: the sheet before the
//                       plant and with the plant, both before the border
//       { id, error, noCanvas }         noCanvas: no OffscreenCanvas 2D
//
//  pool.js makes two of these workers and keeps the queue.
// ============================================================================
import { paint, plainPAR, rgbaHash, plantFoci } from './engine.js';
import { recordPaint } from './record.js';

const has2D = (() => {
  try { return typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d'); } catch (e) { return false; }
})();
const ready = fetch(new URL('./upstream/main.js', import.meta.url))
  .then(r => { if (!r.ok) throw new Error('upstream/main.js HTTP ' + r.status); return r.text(); });
ready.catch(() => {});
const env = { canvas: () => new OffscreenCanvas(300, 150) };

const bitmap = c => (typeof c.transferToImageBitmap === 'function' ? Promise.resolve(c.transferToImageBitmap()) : createImageBitmap(c));

self.onmessage = async e => {
  const { id, seed, record } = e.data;
  if (!has2D) { self.postMessage({ id, error: 'no OffscreenCanvas 2D in this worker', noCanvas: true }); return; }
  try {
    const src = await ready;
    const t0 = performance.now();
    const onStage = stage => self.postMessage({ id, stage, at: performance.now() - t0 });
    const R = record ? recordPaint(src, seed, env, onStage) : null;
    const r = R ? R.r : paint(src, seed, env, onStage);
    const hash = rgbaHash(r.ctx.getImageData(0, 0, r.ctx.canvas.width, r.ctx.canvas.height).data);
    const par = plainPAR(r.PAR), foci = plantFoci(r.blits);
    const [painting, bg, blank] = await Promise.all([bitmap(r.ctx.canvas), bitmap(r.bg), bitmap(r.blank)]);
    const msg = { id, seed, token: r.E.token, type: r.type, par, focus: foci.flower, leaf: foci.leaf, base: r.base, painting, bg, blank, hash, ms: r.ms };
    const tr = [painting, bg, blank];
    if (R) {
      [msg.sheet, msg.plant] = await Promise.all([bitmap(r.snaps.sheet), bitmap(r.snaps.plant)]);
      msg.rec = R.rec;
      tr.push(msg.sheet, msg.plant);
      for (const k of ['layer', 'kind', 'grp', 'flags', 'col', 'off', 'pts', 'order']) tr.push(R.rec[k].buffer);
    }
    self.postMessage(msg, tr);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
