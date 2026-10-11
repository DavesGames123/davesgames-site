// ============================================================================
//  MANIM LIVE  ·  engine-core.js  (boot and Python bridge, any JS host)
// ----------------------------------------------------------------------------
//  Shared by worker.js (browser) and tools/render.mjs (Node). The host gives
//  an `env` object; this file does the rest:
//
//    bootRuntime(env)
//      1. env.loadPyodide()                       Pyodide 314.0.7
//      2. pyodide.loadPackage(PYODIDE_PACKAGES)   numpy, scipy, shapely, ...
//      3. py/wheels/LOCK.json -> fetch each wheel, check sha256, unpack into
//         site-packages (manim 0.22.0 from PyPI, unmodified, and the pure
//         Python deps that Pyodide does not ship)
//      4. py/manifest.json -> copy the shims + manimlive into /home/pyodide/py
//      5. registerJsModule('manimlive_host', host)   (see makeHost)
//      6. manimlive.runtime.boot()  -> import manim, attach observers
//    -> runtime {info, run(code, opts, emit), introspect, source, complete}
//
//  ENV (what a host must give)
//    loadPyodide()              -> Promise<pyodide>
//    fetchBytes(rel)            -> Promise<Uint8Array>   page-relative path
//    readBytesSync(rel)         -> Uint8Array            fonts on first use
//    readTextSync(rel)          -> string                MathJax on first use
//    getContext(w, h)           -> CanvasRenderingContext2D-like
//    emitFrame(u8, w, h, index, t, repeat)  copy u8 before returning
//    makeScriptScope()          -> {run(code, name), global}  MathJax sandbox
//    sha256(bytes)              -> Promise<hex string>
//    onStatus({stage, detail})  boot progress
//
//  GREP MAP
//    grep -n 'PYODIDE_PACKAGES'      packages from the Pyodide distribution
//    grep -n 'function makeHost'     the manimlive_host module (Python -> JS)
//    grep -n 'function makeMathJax'  MathJax 3 set up without a DOM, synchronous
//    grep -n 'export async function bootRuntime'
// ============================================================================

import { cairoFlush } from './engine-canvas.js';

export const PYODIDE_VERSION = '314.0.7';
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// From the Pyodide distribution (their wasm builds). Dependencies such as
// soupsieve and parso load with them. click and networkx come from
// py/wheels instead: cloup 4 needs click >= 8.5 (Pyodide has 8.3.1), and the
// Pyodide networkx build pulls in matplotlib, which manim does not need.
export const PYODIDE_PACKAGES = [
  'numpy', 'scipy', 'pillow', 'shapely', 'fonttools', 'pygments', 'rich',
  'tqdm', 'decorator', 'typing-extensions', 'beautifulsoup4', 'audioop-lts', 'jedi',
];

const PY_ROOT = '/home/pyodide/py';

const MATHJAX_FILES = ['startup.js', 'core.js', 'adaptors/liteDOM.js', 'input/tex-full.js', 'output/svg.js', 'output/svg/fonts/tex.js'];

// MathJax 3 without a DOM, set up synchronously so that Python can call it
// in the middle of a run (tex_to_svg is a plain synchronous call).
function makeMathJax(env) {
  const scope = env.makeScriptScope();
  const g = scope.global;
  const loaded = new Set();
  const once = (f) => {
    if (loaded.has(f)) return;
    loaded.add(f);
    scope.run(env.readTextSync('mathjax/' + f), 'mathjax/' + f);
  };
  g.__mlRequire = (url) => once(String(url).replace(/^\[mathjax\]\//, '').replace(/^MJ\//, '').replace(/\.js$/, '') + '.js');
  scope.run(`self.MathJax = {
    loader: { load: [], paths: { mathjax: 'MJ' }, require: (url) => self.__mlRequire(url) },
    tex: { packages: { '[+]': ['html', 'color', 'textmacros', 'ams', 'newcommand', 'boldsymbol', 'cancel', 'mathtools', 'braket', 'mhchem', 'unicode', 'bbox', 'enclose'] },
           formatError: (jax, err) => { throw err; } },
    svg: { fontCache: 'none' },
    startup: { typeset: false, document: '<html></html>', ready: () => {}, pageReady: () => Promise.resolve(),
               input: ['tex'], output: 'svg', adaptor: 'liteAdaptor', handler: 'HTMLHandler' },
  };`, 'mathjax-config');
  for (const f of MATHJAX_FILES) once(f);
  return scope.run(`(() => {
    MathJax.startup.getComponents();
    MathJax.startup.makeMethods();
    const adaptor = MathJax.startup.adaptor;
    return (tex, display) => {
      try {
        MathJax.texReset();
        const node = MathJax.tex2svg(tex, { display: !!display });
        return adaptor.outerHTML(adaptor.firstChild(node));
      } catch (e) {
        return 'ERROR:' + (e && e.message ? e.message : String(e));
      }
    };
  })()`, 'mathjax-start');
}

// The JS module that Python imports as `manimlive_host`.
function makeHost(env, state) {
  let mathjax = null;
  return {
    // py/cairo: run one command list on the canvas, write pixels back.
    cairo_flush(w, h, stride, format, pxProxy, opsProxy) {
      const pb = pxProxy.getBuffer('u8');
      const ob = opsProxy.getBuffer('f64');
      try {
        cairoFlush(env.getContext(w, h), w, h, stride, format, pb.data, ob.data);
      } finally {
        pb.release(); ob.release();
        pxProxy.destroy(); opsProxy.destroy();
      }
    },
    // manimlive.runtime: one rendered frame (RGBA, h x w x 4, uint8).
    emit_frame(pxProxy, w, h, index, t, repeat) {
      const pb = pxProxy.getBuffer('u8');
      try {
        env.emitFrame(pb.data, w, h, index, t, repeat);
      } finally {
        pb.release(); pxProxy.destroy();
      }
    },
    emit(name, json) {
      if (state.emit) state.emit(name, JSON.parse(json));
    },
    // manimpango: font files from the page, on first use.
    read_bytes(rel) {
      return env.readBytesSync(rel);
    },
    // manimlive.tex: TeX -> SVG string, or 'ERROR:message'.
    tex_to_svg(tex, display) {
      if (!mathjax) {
        const t0 = Date.now();
        mathjax = makeMathJax(env);
        state.mathjaxSeconds = (Date.now() - t0) / 1000;
      }
      return mathjax(tex, display);
    },
  };
}

async function installWheels(env, pyodide, sitePackages) {
  const lock = JSON.parse(new TextDecoder().decode(await env.fetchBytes('py/wheels/LOCK.json')));
  const out = [];
  await Promise.all(lock.wheels.map(async (w) => {
    const bytes = await env.fetchBytes('py/wheels/' + w.file);
    const hex = await env.sha256(bytes);
    if (hex !== w.sha256) throw new Error(`sha256 mismatch for ${w.file}: ${hex} != ${w.sha256}`);
    pyodide.unpackArchive(bytes, 'wheel', { extractDir: sitePackages });
    out.push({ name: w.name, version: w.version, file: w.file, sha256: hex, pypiSha256: w.pypiSha256 || null });
  }));
  return out;
}

async function installPy(env, pyodide) {
  const manifest = JSON.parse(new TextDecoder().decode(await env.fetchBytes('py/manifest.json')));
  const files = await Promise.all(manifest.files.map(async (f) => [f, await env.fetchBytes('py/' + f)]));
  for (const [f, bytes] of files) {
    const dest = `${PY_ROOT}/${f}`;
    pyodide.FS.mkdirTree(dest.slice(0, dest.lastIndexOf('/')));
    pyodide.FS.writeFile(dest, bytes);
  }
  return manifest.files.length;
}

export async function bootRuntime(env) {
  const status = (stage, detail) => { try { env.onStatus && env.onStatus({ stage, detail }); } catch {} };
  const t0 = Date.now();
  status('pyodide', 'Loading Pyodide ' + PYODIDE_VERSION);
  const pyodide = await env.loadPyodide();
  status('packages', 'Loading ' + PYODIDE_PACKAGES.join(', '));
  await pyodide.loadPackage(PYODIDE_PACKAGES, { messageCallback: () => {}, errorCallback: (m) => status('packages', m) });
  const sitePackages = pyodide.runPython('import site; site.getsitepackages()[0]');
  status('wheels', 'Installing manim 0.22.0 from the PyPI wheel');
  const wheels = await installWheels(env, pyodide, sitePackages);
  status('shims', 'Copying the shims');
  const nPy = await installPy(env, pyodide);
  pyodide.runPython(`import sys\nif ${JSON.stringify(PY_ROOT)} not in sys.path: sys.path.insert(0, ${JSON.stringify(PY_ROOT)})`);
  const state = { emit: null, mathjaxSeconds: null };
  pyodide.registerJsModule('manimlive_host', makeHost(env, state));
  status('manim', 'import manim');
  const rt = pyodide.pyimport('manimlive.runtime');
  const intro = pyodide.pyimport('manimlive.introspect');
  const bootInfo = JSON.parse(rt.boot());
  const info = {
    ...bootInfo,
    pyodide: PYODIDE_VERSION,
    sitePackages,
    wheels,
    pyFiles: nPy,
    bootSeconds: (Date.now() - t0) / 1000,
  };
  status('ready', 'manim ' + info.manimVersion);

  return {
    info,
    pyodide,
    state,
    // emit(name, data) receives the events of this run only.
    run(code, opts, emit) {
      state.emit = emit;
      try {
        return JSON.parse(rt.run(code, JSON.stringify(opts || {})));
      } finally {
        state.emit = null;
      }
    },
    introspect(name) { return JSON.parse(intro.introspect(String(name))); },
    source(name) { return JSON.parse(intro.source(String(name))); },
    complete(code, line, col) { return JSON.parse(intro.complete(String(code), line | 0, col | 0)); },
  };
}
