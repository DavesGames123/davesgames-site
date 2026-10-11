// ============================================================================
//  REFERENCE  ·  live manim API reference from the running Python
// ----------------------------------------------------------------------------
//  Every fact on this panel comes from the worker, from the manim package
//  that runs the user's code:
//    engine.introspect(name) -> {kind, name, signature, doc, members, file, line}
//    engine.source(name)     -> {file, line, text}   (inspect.getsource)
//  The docstring goes through ui/rst.js. Its :class: links and member rows
//  open other names, and its ".. manim::" examples load into the editor.
//  Back and forward keep a short history.
//
//  EXPORTS
//    mountReference(root, {getEngine, onLoadCode(code, scene)}) -> api
//  api: open(name), setNames(list), current()
// ============================================================================
import { escapeHtml } from './markdown.js';
import { highlightPython } from './pyhighlight.js';
import { rstToHtml } from './rst.js';

const START = [
  ['Shapes', ['Circle', 'Square', 'Rectangle', 'Polygon', 'Line', 'Arrow', 'Dot', 'Arc', 'VGroup']],
  ['Text and math', ['Text', 'MarkupText', 'MathTex', 'Tex', 'DecimalNumber', 'Code']],
  ['Graphs and plots', ['Axes', 'NumberPlane', 'NumberLine', 'ParametricFunction', 'Graph', 'BarChart']],
  ['Animations', ['Create', 'Write', 'FadeIn', 'Transform', 'ReplacementTransform', 'TransformMatchingTex', 'Indicate', 'Rotate', 'AnimationGroup', 'LaggedStart']],
  ['Motion and updaters', ['ValueTracker', 'always_redraw', 'Mobject.add_updater', 'MoveAlongPath', 'Mobject.animate']],
  ['Scenes and cameras', ['Scene', 'Scene.play', 'Scene.wait', 'MovingCameraScene', 'ThreeDScene', 'ZoomedScene']],
  ['3D', ['Surface', 'ThreeDAxes', 'Sphere', 'Cube', 'Prism']],
  ['Rate functions and constants', ['smooth', 'linear', 'there_and_back', 'rate_functions', 'UP', 'ORIGIN', 'PI', 'BLUE']],
];

const KIND_LABEL = { class: 'class', function: 'function', method: 'method', module: 'module', property: 'property', attribute: 'attribute', constant: 'value', builtin: 'function', instance: 'value' };

export function mountReference(root, { getEngine, onLoadCode }) {
  const hist = []; let at = -1;
  let names = [];
  let cur = null;
  let lastExamples = [];

  root.innerHTML = `
    <form class="rf-search" autocomplete="off">
      <button type="button" class="icon rf-back" title="Back" aria-label="Back" disabled>←</button>
      <button type="button" class="icon rf-fwd" title="Forward" aria-label="Forward" disabled>→</button>
      <input class="rf-q" list="rf-names" placeholder="Type a name: Circle, Axes.plot, Transform" aria-label="Manim name" spellcheck="false" autocapitalize="off">
      <datalist id="rf-names"></datalist>
      <button class="btn small">Look up</button>
    </form>
    <div class="rf-body"></div>`;
  const q = root.querySelector('.rf-q');
  const body = root.querySelector('.rf-body');
  const back = root.querySelector('.rf-back');
  const fwd = root.querySelector('.rf-fwd');
  const dl = root.querySelector('#rf-names');

  root.querySelector('.rf-search').addEventListener('submit', e => { e.preventDefault(); if (q.value.trim()) api.open(q.value.trim()); });
  back.onclick = () => { if (at > 0) { at--; show(hist[at], false); } };
  fwd.onclick = () => { if (at < hist.length - 1) { at++; show(hist[at], false); } };
  body.addEventListener('click', e => {
    const r = e.target.closest('[data-ref]');
    if (r) { e.preventDefault(); api.open(r.dataset.ref); return; }
    const ex = e.target.closest('.rst-load');
    if (ex) { const x = lastExamples[+ex.dataset.example]; if (x) onLoadCode(x.code, x.scene); }
  });

  function startPage() {
    cur = null;
    body.innerHTML = `
      <p class="rf-lead">Every entry here comes from the manim package that runs your code: its real signature, its real docstring, and its real source with <code>inspect.getsource</code>. Hover a name in the editor for a short version.</p>
      ${START.map(([h, list]) => `<h4 class="rst-h">${h}</h4><div class="rf-chips">${list.map(n => `<button class="chip" data-ref="${n}">${n}</button>`).join('')}</div>`).join('')}`;
    q.value = '';
  }

  async function show(name, push = true) {
    const eng = getEngine();
    if (push) { hist.splice(at + 1); hist.push(name); at = hist.length - 1; }
    back.disabled = at <= 0; fwd.disabled = at >= hist.length - 1;
    q.value = name;
    if (!eng) { body.innerHTML = `<p class="muted">Python is still loading. ${escapeHtml(name)} opens when manim is ready.</p>`; return; }
    body.innerHTML = `<p class="muted">Reading ${escapeHtml(name)} from manim…</p>`;
    let info;
    try { await eng.ready; info = await eng.introspect(name); } catch (e) { info = { error: String(e && e.message || e) }; }
    if (q.value !== name) return;
    if (!info || info.error) {
      const near = names.filter(n => n.name.toLowerCase().includes(name.split('.').pop().toLowerCase())).slice(0, 16);
      body.innerHTML = `<p>manim has no name <code>${escapeHtml(name)}</code>${info && info.error ? ` <span class="muted">(${escapeHtml(info.error)})</span>` : ''}.</p>
        ${near.length ? `<p class="muted">Names that are near:</p><div class="rf-chips">${near.map(n => `<button class="chip" data-ref="${escapeHtml(n.name)}">${escapeHtml(n.name)}</button>`).join('')}</div>` : ''}`;
      return;
    }
    cur = info;
    const { html, examples } = rstToHtml(info.doc || '', { code: highlightPython });
    lastExamples = examples;
    const members = (info.members || []).filter(m => !m.name.startsWith('_'));
    const groups = {};
    for (const m of members) (groups[m.kind || 'other'] ||= []).push(m);
    const order = ['method', 'function', 'property', 'attribute', 'class', 'constant', 'module', 'other'];
    const full = info.qualname || info.name || name;
    body.innerHTML = `
      <header class="rf-head">
        <span class="kind k-${escapeHtml(info.kind || '')}">${escapeHtml(KIND_LABEL[info.kind] || info.kind || '')}</span>
        <h3><code>${escapeHtml(full)}</code></h3>
        ${info.signature ? `<pre class="rf-sig"><code>${highlightPython(`${(info.name || name).split('.').pop()}${info.signature}`)}</code></pre>` : ''}
        ${info.file ? `<p class="rf-file muted" title="${escapeHtml(info.file)}">${escapeHtml(shortFile(info.file))}${info.line ? ':' + info.line : ''}</p>` : ''}
        ${info.bases && info.bases.filter(b => !/^builtins\./.test(b)).length ? `<p class="rf-bases">Inherits from ${info.bases.filter(b => !/^builtins\./.test(b)).map(b => `<code class="ref-link" data-ref="${escapeHtml(b)}">${escapeHtml(b.split('.').pop())}</code>`).join(', ')}</p>` : ''}
        <div class="rf-acts"><button class="btn small rf-src">View source</button></div>
      </header>
      <div class="rf-source" hidden></div>
      <div class="rf-doc md">${html || '<p class="muted">This name has no docstring.</p>'}</div>
      ${members.length ? `<h4 class="rst-h">Members <span class="muted">(${members.length})</span></h4>
        <input class="rf-mf" placeholder="Filter members" aria-label="Filter members">
        <div class="rf-members">${order.filter(k => groups[k]).map(k => `
          <div class="rf-mg"><h5>${escapeHtml(k === 'other' ? 'Other' : (KIND_LABEL[k] || k) + 's')}</h5>
          ${groups[k].map(m => `<button class="rf-m" data-ref="${escapeHtml(full + '.' + m.name)}" data-n="${escapeHtml(m.name.toLowerCase())}"><code>${escapeHtml(m.name)}</code><span>${escapeHtml(m.summary || '')}</span></button>`).join('')}</div>`).join('')}</div>` : ''}`;
    body.querySelector('.rf-src').onclick = () => showSource(full);
    const mf = body.querySelector('.rf-mf');
    if (mf) mf.oninput = () => {
      const v = mf.value.toLowerCase();
      body.querySelectorAll('.rf-m').forEach(b => { b.hidden = v && !b.dataset.n.includes(v); });
    };
    body.scrollTop = 0; root.scrollTop = 0;
    if (body.querySelector('[data-tex]')) import('../../../lib/sci-math.js').then(m => m.typesetAll(body)).catch(() => {});
  }

  async function showSource(name) {
    const box = body.querySelector('.rf-source');
    const btn = body.querySelector('.rf-src');
    if (!box) return;
    if (!box.hidden) { box.hidden = true; btn.textContent = 'View source'; return; }
    box.hidden = false; btn.textContent = 'Hide source';
    box.innerHTML = '<p class="muted">Reading the source…</p>';
    let r;
    try { r = await getEngine().source(name); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (!r || r.error || !r.text) { box.innerHTML = `<p class="muted">No Python source for this name${r && r.error ? ': ' + escapeHtml(r.error) : ''}. Built-in and C names have none.</p>`; return; }
    const lines = r.text.replace(/\n$/, '').split('\n');
    const start = r.line || 1;
    const hl = highlightPython(r.text.replace(/\n$/, '')).split('\n');
    box.innerHTML = `<div class="rf-src-head"><span title="${escapeHtml(r.file || '')}">${escapeHtml(shortFile(r.file || ''))}, lines ${start}–${start + lines.length - 1}</span><button class="btn small rf-copy">Copy</button></div>
      <pre class="rf-code"><code>${hl.map((h, i) => `<span class="ln" data-n="${start + i}"></span>${h}`).join('\n')}</code></pre>`;
    box.querySelector('.rf-copy').onclick = () => navigator.clipboard?.writeText(r.text).catch(() => {});
  }

  const api = {
    open(name) { show(String(name).replace(/^manim\./, '').trim()); },
    setNames(list) {
      names = (list || []).filter(n => n && n.name && !n.name.startsWith('_'));
      dl.innerHTML = names.slice(0, 3000).map(n => `<option value="${escapeHtml(n.name)}">`).join('');
    },
    current: () => cur,
    home: startPage,
  };
  startPage();
  return api;
}

// ".../site-packages/manim/mobject/geometry/arc.py" -> "manim/mobject/geometry/arc.py"
export function shortFile(f) {
  const i = f.lastIndexOf('site-packages/');
  return i >= 0 ? f.slice(i + 14) : f;
}
