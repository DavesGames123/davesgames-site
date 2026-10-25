// Module worker for the em-explorer DATA package.
// Messages in:  { op, id, ... }  open, chunk, slice, prefetch, cancel,
//               cancelAll, focus, cap, stats, close.
// Messages out: { op: 'ready', jpeg } once, then { id, ok, result | error, abort }.
// Slice buffers are transferred. Chunk data is copied first, because the
// cache keeps the original.

import { createEngine, BROWSER_IN_FLIGHT, PREFIX_BYTES } from './engine.js';
import { decodeJpegBrowser } from './codecs.js';

const engine = createEngine({ decodeJpeg: decodeJpegBrowser, maxInFlight: BROWSER_IN_FLIGHT, prefixBytes: PREFIX_BYTES });
const ctrls = new Map();

function reply(id, p, transfer) {
  p.then((result) => {
    ctrls.delete(id);
    self.postMessage({ id, ok: true, result }, transfer ? transfer(result) : []);
  }, (err) => {
    ctrls.delete(id);
    self.postMessage({ id, ok: false, abort: !!(err && err.name === 'AbortError'), error: String((err && err.message) || err) });
  });
}

function signalFor(id) {
  const ac = new AbortController();
  ctrls.set(id, ac);
  return ac.signal;
}

const scope = typeof self !== 'undefined' ? self : null;

if (scope) scope.onmessage = (e) => {
  const m = e.data || {};
  switch (m.op) {
    case 'open':
      reply(m.id, engine.open(m.record));
      break;
    case 'chunk': {
      const signal = signalFor(m.id);
      reply(m.id, engine.getChunk(m.vid, m.si, m.c, { signal, priority: m.priority })
        .then((r) => ({ data: r.data.slice(), shape: r.shape })), (r) => [r.data.buffer]);
      break;
    }
    case 'slice': {
      const signal = signalFor(m.id);
      reply(m.id, engine.getSlice(m.vid, m.si, m.plane, m.index, m.rect, { signal, priority: m.priority }),
        (r) => [r.data.buffer]);
      break;
    }
    case 'prefetch':
      reply(m.id, engine.prefetchIndexes(m.vid, m.groups));
      break;
    case 'cancel': {
      const ac = ctrls.get(m.ref);
      if (ac) ac.abort();
      break;
    }
    case 'cancelAll': engine.cancelAll(m.vid); break;
    case 'close': engine.close(m.vid); break;
    case 'focus': engine.setFocus(m.vid, m.nm); break;
    case 'cap': engine.setCacheBytes(m.bytes); break;
    case 'stats': reply(m.id, Promise.resolve(engine.stats())); break;
    default: break;
  }
};

// JPEG chunks need createImageBitmap and OffscreenCanvas in the worker
// (Safari 16.4+). Without them, index.js falls back to the main thread.
const jpeg = typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
if (scope) scope.postMessage({ op: 'ready', jpeg });
