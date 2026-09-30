/* ============================================================================
   HYDROGEN TABLE  ·  tile worker  (module worker)
   ----------------------------------------------------------------------------
   main.js starts a pool of these workers. Each worker fills its tiles with
   fillTile from physics.js, colors them, and sends back one ImageBitmap per
   tile. The page thread only draws the bitmaps.

   MESSAGES
     in   { type:'render', seq, jobs:[{id,n,l,m,kind,size}], look }
          look = { cmap, gamma, exposure, log, decades, outerLobe }
          outerLobe: the exposure is divided by (outer lobe peak / peak)^2,
                     on the linear scale only
     out  { type:'tiles', seq, items:[{id, size, bmp | buf}] }   in chunks
     out  { type:'done', seq, fillMs, colorMs, fills }

   CACHE. The signed field psi / max|psi| of each tile stays in a map, keyed
   by kind, n, l, m and size. A change of the color map, gamma, exposure or
   log scale then only colors the tiles again. It does not fill them again.

   COLOR. colorize in colormaps.js turns the field into RGBA pixels.

   GREP MAP
     grep -n 'function field'      cache lookup and fill
     grep -n 'onmessage'           the job loop
   ========================================================================== */
import { tileSpec, fillTile } from './physics.js';
import { colorize } from './colormaps.js';

const cache = new Map();
let cacheFloats = 0;
const CACHE_CAP = 8e6;        // floats per worker, 32 MB

function field(j) {
  const key = `${j.kind}:${j.n},${j.l},${j.m}@${j.size}`;
  let f = cache.get(key);
  if (f) { cache.delete(key); cache.set(key, f); return { f, filled: false }; }
  f = new Float32Array(j.size * j.size);
  const S = tileSpec(j.n, j.l, j.m, j.kind);
  fillTile(S, j.size, f);
  f.outer = S.outer;
  cache.set(key, f); cacheFloats += f.length;
  for (const [k, v] of cache) { if (cacheFloats <= CACHE_CAP || k === key) break; cache.delete(k); cacheFloats -= v.length; }
  return { f, filled: true };
}

const canBitmap = typeof createImageBitmap === 'function' && typeof ImageData === 'function';

self.onmessage = async (e) => {
  const d = e.data;
  if (d.type !== 'render') return;
  let fillMs = 0, colorMs = 0, fills = 0, chunk = [], transfer_ = [], tChunk = performance.now();
  const flush = () => {
    if (!chunk.length) return;
    self.postMessage({ type: 'tiles', seq: d.seq, items: chunk }, transfer_);
    chunk = []; transfer_ = []; tChunk = performance.now();
  };
  for (const j of d.jobs) {
    const t0 = performance.now();
    const { f, filled } = field(j);
    const t1 = performance.now();
    const px = colorize(f, j.size, d.look.outerLobe && !d.look.log ? { ...d.look, exposure: d.look.exposure / (f.outer * f.outer) } : d.look);
    const t2 = performance.now();
    fillMs += t1 - t0; colorMs += t2 - t1; if (filled) fills++;
    if (canBitmap) {
      const bmp = await createImageBitmap(new ImageData(px, j.size, j.size));
      chunk.push({ id: j.id, size: j.size, bmp }); transfer_.push(bmp);
    } else {
      chunk.push({ id: j.id, size: j.size, buf: px.buffer }); transfer_.push(px.buffer);
    }
    // Send in chunks, so the first tiles show while the rest still fill.
    if (performance.now() - tChunk > 24) flush();
  }
  flush();
  self.postMessage({ type: 'done', seq: d.seq, fillMs, colorMs, fills });
};

self.postMessage({ type: 'ready' });
