// ============================================================================
//  HOOD  ·  "Under the hood" panel
// ----------------------------------------------------------------------------
//  Two parts:
//    1. Live facts, read from the worker after boot: manim.__version__,
//       manim.__file__, the wheel sha256, the Pyodide and Python versions,
//       and the five native modules that the page replaces. The facts
//       come from engine.facts() when the engine has it. Else the panel
//       asks engine.introspect('manim') and introspect of each stub.
//    2. UNDER-THE-HOOD.md (written by the engine side), as Markdown.
//  The summary table of the replaced modules is fixed text here, so the
//  panel says it even when the .md file does not load.
//
//  EXPORTS
//    REPLACED                 [{mod, real, why, how}]
//    mountHood(root, {getEngine, onConcept}) -> api
//  api: refresh()
// ============================================================================
import { renderMarkdown, escapeHtml } from './markdown.js';
import { highlightPython } from './pyhighlight.js';

export const REPLACED = [
  { mod: 'cairo', real: 'pycairo (C library Cairo)', why: 'Cairo is native C code. Pyodide has no build of pycairo.', how: 'A pycairo API subset records the draw calls of manim’s Camera and draws them in one call per frame on an OffscreenCanvas 2D context. The pixels go back into the real Camera.pixel_array.' },
  { mod: 'manimpango', real: 'ManimPango (Pango, HarfBuzz)', why: 'Pango is native C code.', how: 'text2svg reads glyph outlines with fontTools from bundled free fonts and writes the SVG that manim’s real Text class parses.' },
  { mod: 'pathops', real: 'skia-pathops (Skia)', why: 'Skia is native C++ code.', how: 'Boolean operations (Union, Intersection, Difference, Exclusion) go through shapely.' },
  { mod: 'mapbox_earcut', real: 'mapbox-earcut (C++)', why: 'Native C++ extension.', how: 'The earcut polygon triangulation, in Python.' },
  { mod: 'av', real: 'PyAV (FFmpeg)', why: 'FFmpeg is native C code.', how: 'A container that writes nothing. The real SceneFileWriter hands each frame to the page, which shows it and records the video in the browser.' },
];

export function mountHood(root, { getEngine }) {
  root.innerHTML = `
    <h2>Under the hood</h2>
    <p class="rf-lead">This page runs the real ManimCE package from PyPI, without changes, in Python compiled to WebAssembly (Pyodide). Only five native libraries cannot run in a browser. Small Python modules replace them, and the table below says how.</p>
    <dl class="hood-facts"><dt>Status</dt><dd class="muted">Python is loading…</dd></dl>
    <h3>The five replaced native modules</h3>
    <div class="hood-table">${REPLACED.map(r => `
      <div class="hood-row"><code>${r.mod}</code><div><b>${escapeHtml(r.real)}</b>. ${escapeHtml(r.why)}<br>${escapeHtml(r.how)}</div><button class="btn small hood-src" data-mod="${r.mod}">Source</button></div>`).join('')}
    </div>
    <p class="muted">TeX: a browser has no LaTeX. The one function that manim calls to compile TeX to SVG sends the TeX to MathJax 3 instead. The SVG that MathJax makes goes through manim’s real SVGMobject and MathTex code.</p>
    <div class="hood-src-box" hidden></div>
    <div class="hood-md md"><p class="muted">Loading the notes…</p></div>`;
  const facts = root.querySelector('.hood-facts');
  const srcBox = root.querySelector('.hood-src-box');

  root.querySelector('.hood-table').addEventListener('click', async e => {
    const b = e.target.closest('.hood-src'); if (!b) return;
    const eng = getEngine();
    if (!eng) return;
    srcBox.hidden = false;
    srcBox.innerHTML = `<p class="muted">Reading ${b.dataset.mod}…</p>`;
    let r;
    try { await eng.ready; r = await eng.source(b.dataset.mod); } catch (err) { r = { error: String(err.message || err) }; }
    srcBox.innerHTML = r && r.text
      ? `<div class="rf-src-head"><span>${escapeHtml(r.file || b.dataset.mod)}</span><button class="btn small hood-close">Close</button></div><pre class="rf-code"><code>${highlightPython(r.text)}</code></pre>`
      : `<p class="muted">No source for ${escapeHtml(b.dataset.mod)}${r && r.error ? ': ' + escapeHtml(r.error) : ''}.</p>`;
    srcBox.querySelector('.hood-close')?.addEventListener('click', () => { srcBox.hidden = true; });
    srcBox.scrollIntoView({ block: 'nearest' });
  });

  (async () => {
    try {
      const r = await fetch(new URL('../UNDER-THE-HOOD.md', import.meta.url));
      if (!r.ok) throw new Error(r.status);
      const md = root.querySelector('.hood-md');
      md.innerHTML = renderMarkdown(await r.text(), { code: (t, lang) => (!lang || /^py/.test(lang)) ? highlightPython(t) : escapeHtml(t) });
      if (md.querySelector('[data-tex]')) import('../../../lib/sci-math.js').then(m => m.typesetAll(md)).catch(() => {});
    } catch {
      root.querySelector('.hood-md').innerHTML = '';
    }
  })();

  const row = (k, v, cls = '') => `<dt>${escapeHtml(k)}</dt><dd class="${cls}">${v}</dd>`;

  return {
    async refresh() {
      const eng = getEngine();
      if (!eng) return;
      try { await eng.ready; } catch (e) { facts.innerHTML = row('Status', `Python did not start: ${escapeHtml(e.message || e)}`, 'bad'); return; }
      let f = null;
      try { if (typeof eng.facts === 'function') f = await eng.facts(); else if (eng.info) f = eng.info; } catch {}
      f = f || {};
      if (!f.manimFile || !f.manimVersion) {
        try {
          const m = await eng.introspect('manim');
          f.manimFile = f.manimFile || m.file;
          const ver = (m.members || []).find(x => x.name === '__version__');
          if (ver && ver.summary) f.manimVersion = f.manimVersion || ver.summary;
        } catch {}
      }
      const v = x => x ? `<code>${escapeHtml(x)}</code>` : '<span class="muted">not reported</span>';
      const wheel = Array.isArray(f.wheels) ? f.wheels.find(w => w.name === 'manim') : null;
      if (wheel) { f.wheelSha256 = f.wheelSha256 || wheel.sha256; f.wheelFile = wheel.file; }
      let html = row('manim', v(f.manimVersion || f.version))
        + row('manim.__file__', v(f.manimFile || f.file))
        + (f.wheelFile ? row('Wheel', v(f.wheelFile)) : '')
        + row('Wheel sha256', v(f.wheelSha256 || f.sha256 || f.wheel_sha256), 'hash')
        + row('Pyodide', v(f.pyodideVersion || f.pyodide))
        + row('Python', v(f.pythonVersion || f.python));
      if (f.tex) html += row('TeX', escapeHtml(f.tex));
      if (f.bootSeconds) html += row('Boot time', `${(+f.bootSeconds).toFixed(1)} s`);
      const stubs = f.replaced || f.stubs || f.shims;
      if (stubs) {
        const list = Array.isArray(stubs) ? stubs : Object.entries(stubs).map(([mod, file]) => ({ mod, file }));
        html += row('Replaced modules', list.map(s => `<code title="${escapeHtml(s.file || '')}">${escapeHtml(s.mod || s.name || s)}</code>`).join(' '));
      }
      facts.innerHTML = html;
    },
  };
}
