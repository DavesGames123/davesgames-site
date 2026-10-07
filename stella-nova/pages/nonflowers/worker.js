// ============================================================================
//  NONFLOWERS  ·  worker.js — one painting per message, off the main thread
// ----------------------------------------------------------------------------
//  A module worker. It fetches upstream/main.js (Nonflowers by Lingdong
//  Huang, MIT, see LICENSE-nonflowers.txt) as text once. Each job makes a
//  new engine with engine.js paint(), so the Prng, the Perlin table and the
//  implicit globals start fresh for each seed. The canvases are
//  OffscreenCanvas objects.
//
//  IN   { id, seed }
//  OUT  { id, stage, at }               before each step (progress)
//       { id, seed, token, type, par, focus, base, painting, bg, hash, ms }
//         painting  ImageBitmap 600 x 600 (transfer)
//         bg        ImageBitmap 512 x 512, the page paper (transfer)
//         par       engine.js plainPAR(PAR)
//         hash      FNV-1a of the painting RGBA (for the parity check)
//         focus     engine.js flowerFocus(): where the petals are, or null
//         base      the root of the plant in painting px
//       { id, error, noCanvas }         noCanvas: no OffscreenCanvas 2D
//
//  pool.js makes two of these workers and keeps the queue.
// ============================================================================
import { paint, plainPAR, rgbaHash, flowerFocus } from './engine.js';

const has2D = (() => {
  try { return typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d'); } catch (e) { return false; }
})();
const ready = fetch(new URL('./upstream/main.js', import.meta.url))
  .then(r => { if (!r.ok) throw new Error('upstream/main.js HTTP ' + r.status); return r.text(); });
ready.catch(() => {});
const env = { canvas: () => new OffscreenCanvas(300, 150) };

const bitmap = c => (typeof c.transferToImageBitmap === 'function' ? Promise.resolve(c.transferToImageBitmap()) : createImageBitmap(c));

self.onmessage = async e => {
  const { id, seed } = e.data;
  if (!has2D) { self.postMessage({ id, error: 'no OffscreenCanvas 2D in this worker', noCanvas: true }); return; }
  try {
    const src = await ready;
    const t0 = performance.now();
    const r = paint(src, seed, env, stage => self.postMessage({ id, stage, at: performance.now() - t0 }));
    const hash = rgbaHash(r.ctx.getImageData(0, 0, r.ctx.canvas.width, r.ctx.canvas.height).data);
    const par = plainPAR(r.PAR), focus = flowerFocus(r.blits);
    const [painting, bg] = await Promise.all([bitmap(r.ctx.canvas), bitmap(r.bg)]);
    self.postMessage({ id, seed, token: r.E.token, type: r.type, par, focus, base: r.base, painting, bg, hash, ms: r.ms }, [painting, bg]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
