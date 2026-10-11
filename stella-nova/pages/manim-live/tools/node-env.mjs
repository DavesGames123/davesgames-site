// ============================================================================
//  MANIM LIVE  ·  tools/node-env.mjs  (the Node host for engine-core.js)
// ----------------------------------------------------------------------------
//  Runs the same boot and the same Python as the browser worker, with:
//    Pyodide        npm package pyodide@314.0.7
//    canvas         @napi-rs/canvas (Skia) in place of OffscreenCanvas
//    MathJax        the page's mathjax/ files in a node:vm sandbox
//
//  Both npm packages live OUTSIDE the repository, in a cache folder:
//    MANIM_LIVE_CACHE=/path/to/cache   (contains node_modules/ and
//                                       pyodide-packages/)
//  Set it up once:
//    mkdir -p "$MANIM_LIVE_CACHE" && cd "$MANIM_LIVE_CACHE" && \
//      npm init -y && npm install pyodide@314.0.7 @napi-rs/canvas
//
//  grep -n 'export async function createNodeRuntime'
// ============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { bootRuntime } from '../engine-core.js';

export const PAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function cacheDir() {
  const dir = process.env.MANIM_LIVE_CACHE;
  if (!dir || !fs.existsSync(path.join(dir, 'node_modules', 'pyodide'))) {
    throw new Error(
      'Set MANIM_LIVE_CACHE to a folder with node_modules/pyodide and node_modules/@napi-rs/canvas ' +
      '(see the header of tools/node-env.mjs).',
    );
  }
  return dir;
}

export async function createNodeRuntime({ onFrame = () => {}, onStatus = () => {} } = {}) {
  const cache = cacheDir();
  const nm = path.join(cache, 'node_modules');
  const { loadPyodide } = await import(pathToFileURL(path.join(nm, 'pyodide', 'pyodide.mjs')).href);
  const { createCanvas } = await import(pathToFileURL(path.join(nm, '@napi-rs', 'canvas', 'index.js')).href);
  const pkgDir = path.join(cache, 'pyodide-packages');
  fs.mkdirSync(pkgDir, { recursive: true });
  const contexts = new Map();
  let runtime = null;
  const env = {
    loadPyodide: () => loadPyodide({
      indexURL: path.join(nm, 'pyodide') + path.sep,
      packageCacheDir: pkgDir,
      stdout: (s) => onStatus({ stage: 'stdout', detail: s }),
      stderr: (s) => onStatus({ stage: 'stderr', detail: s }),
    }),
    fetchBytes: async (rel) => new Uint8Array(fs.readFileSync(path.join(PAGE_DIR, rel))),
    readBytesSync: (rel) => new Uint8Array(fs.readFileSync(path.join(PAGE_DIR, rel))),
    readTextSync: (rel) => fs.readFileSync(path.join(PAGE_DIR, rel), 'utf8'),
    getContext: (w, h) => {
      const key = w + 'x' + h;
      let ctx = contexts.get(key);
      if (!ctx) { ctx = createCanvas(w, h).getContext('2d'); contexts.set(key, ctx); }
      return ctx;
    },
    emitFrame: (u8, w, h, index, t, repeat) => (runtime && runtime.frameSink ? runtime.frameSink : onFrame)(new Uint8Array(u8), w, h, index, t, repeat),
    makeScriptScope: () => {
      // No process, no window, no document: the same globals a worker lacks.
      const sb = { console, setTimeout, clearTimeout, queueMicrotask };
      sb.self = sb; sb.globalThis = sb;
      vm.createContext(sb);
      return { global: sb, run: (code, name) => vm.runInContext(code, sb, { filename: name }) };
    },
    sha256: async (bytes) => crypto.createHash('sha256').update(bytes).digest('hex'),
    onStatus,
  };
  runtime = await bootRuntime(env);
  runtime.createCanvas = createCanvas;
  runtime.frameSink = null;
  return runtime;
}

// RGBA bytes -> PNG file (with @napi-rs/canvas).
export function writePng(runtime, rgba, w, h, file) {
  const canvas = runtime.createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
}
