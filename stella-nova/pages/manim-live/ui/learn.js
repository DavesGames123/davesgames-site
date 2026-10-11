// ============================================================================
//  LEARN  ·  lessons panel
// ----------------------------------------------------------------------------
//  Reads lessons/index.js (LESSONS = [{id, title, level, blurb, steps}]).
//  A step is {title, md, code, scene, task?, hint?, check?}. The panel
//  shows the lesson list, then one step at a time: the Markdown text
//  (ui/markdown.js, TeX through lib/sci-math.js as MathJax SVG), a button
//  that loads the step code, the task, a hidden hint, and back / next.
//
//  check (optional) runs after each finished render:
//    function(code, result) -> true | false | 'message'
//    string                 -> a RegExp source tested on the code
//    {contains: [...]}      -> every text must be in the code
//    {animations: n}        -> the run made n or more animations
//  result = {scenes, animations: [names], frames, error}
//
//  Progress (done steps, last lesson and step) is in localStorage under
//  "manim-live:learn". Each access is in try/catch.
//
//  EXPORTS
//    mountLearn(root, {onLoadCode(code, scene), onConcept(name)}) -> api
//    checkStep(step, code, result) -> {ok, message}      (pure)
//  api: ready, onRunResult(code, result)
// ============================================================================
import { renderMarkdown, escapeHtml } from './markdown.js';
import { highlightPython } from './pyhighlight.js';

const KEY = 'manim-live:learn';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

export function checkStep(step, code, result = {}) {
  const c = step && step.check;
  if (!c) return { ok: null, message: '' };
  try {
    if (typeof c === 'function') {
      const r = c(code, result);
      return { ok: r === true, message: typeof r === 'string' ? r : '' };
    }
    if (result.error) return { ok: false, message: 'Fix the error first.' };
    if (typeof c === 'string') return { ok: new RegExp(c, 'm').test(code), message: '' };
    if (c instanceof RegExp) return { ok: c.test(code), message: '' };
    let ok = true;
    if (Array.isArray(c.contains)) ok = ok && c.contains.every(t => code.includes(t));
    if (Number.isFinite(c.animations)) ok = ok && (result.animations || []).length >= c.animations;
    if (c.regex) ok = ok && new RegExp(c.regex, 'm').test(code);
    return { ok, message: '' };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}

export function mountLearn(root, { onLoadCode, onConcept }) {
  let lessons = [];
  let st = load();
  st.done = st.done || {};
  let lesson = null, stepI = 0;

  const typeset = async (el) => {
    if (!el.querySelector('[data-tex]')) return;
    try { const m = await import('../../../lib/sci-math.js'); await m.typesetAll(el); } catch {}
  };
  const md = (t) => renderMarkdown(t, { code: (src, lang) => (!lang || /^py/.test(lang)) ? highlightPython(src) : escapeHtml(src) });

  function drawList() {
    lesson = null;
    const total = lessons.reduce((n, l) => n + l.steps.length, 0);
    const done = lessons.reduce((n, l) => n + l.steps.filter((_, i) => st.done[`${l.id}/${i}`]).length, 0);
    root.innerHTML = `
      <div class="ln-head"><h2>Lessons</h2><span class="muted">${done} of ${total} steps done</span></div>
      <ol class="ln-list">${lessons.map((l, i) => {
        const d = l.steps.filter((_, j) => st.done[`${l.id}/${j}`]).length;
        return `<li><button class="ln-item" data-i="${i}">
          <span class="ln-t">${escapeHtml(l.title)}</span>
          <span class="lv lv${l.level || 1}">${'●'.repeat(l.level || 1)}${'○'.repeat(3 - (l.level || 1))}</span>
          <span class="ln-b">${escapeHtml(l.blurb || '')}</span>
          <span class="ln-p"><i style="width:${l.steps.length ? 100 * d / l.steps.length : 0}%"></i></span>
        </button></li>`;
      }).join('')}</ol>`;
    root.querySelectorAll('.ln-item').forEach(b => b.onclick = () => openLesson(+b.dataset.i, null));
  }

  function openLesson(i, step) {
    lesson = lessons[i];
    if (!lesson) return drawList();
    stepI = step ?? (st.last && st.last.id === lesson.id ? st.last.step : 0);
    stepI = Math.max(0, Math.min(lesson.steps.length - 1, stepI | 0));
    drawStep();
  }

  function drawStep() {
    const s = lesson.steps[stepI];
    st.last = { id: lesson.id, step: stepI }; save(st);
    const key = `${lesson.id}/${stepI}`;
    root.innerHTML = `
      <div class="ln-nav">
        <button class="ln-back" title="All lessons">← Lessons</button>
        <span class="muted">${escapeHtml(lesson.title)} · step ${stepI + 1} of ${lesson.steps.length}</span>
      </div>
      <div class="ln-dots">${lesson.steps.map((_, j) => `<button class="${j === stepI ? 'on' : ''}${st.done[`${lesson.id}/${j}`] ? ' done' : ''}" data-j="${j}" aria-label="Step ${j + 1}"></button>`).join('')}</div>
      <h2 class="ln-title">${escapeHtml(s.title || '')}</h2>
      <div class="ln-md md">${md(s.md || '')}</div>
      ${s.code ? '<button class="btn primary ln-load">Load this step’s code</button>' : ''}
      ${s.task ? `<div class="ln-task"><h3>Your task</h3><div class="md">${md(s.task)}</div>
        <div class="ln-check" ${st.done[key] ? '' : 'hidden'}>✓ Done</div>
        ${s.hint ? `<details class="ln-hint"><summary>Hint</summary><div class="md">${md(s.hint)}</div></details>` : ''}</div>` : ''}
      <div class="ln-step-btns">
        <button class="btn ln-prev" ${stepI === 0 ? 'disabled' : ''}>Back</button>
        <button class="btn ln-next">${stepI === lesson.steps.length - 1 ? 'Finish' : 'Next'}</button>
      </div>`;
    root.querySelector('.ln-back').onclick = () => { st.last = null; save(st); drawList(); };
    root.querySelectorAll('.ln-dots button').forEach(b => b.onclick = () => { stepI = +b.dataset.j; drawStep(); });
    root.querySelector('.ln-load')?.addEventListener('click', () => onLoadCode(s.code, s.scene));
    root.querySelector('.ln-prev').onclick = () => { stepI--; drawStep(); };
    root.querySelector('.ln-next').onclick = () => {
      if (!s.task && !s.check) { st.done[key] = true; save(st); }
      if (stepI < lesson.steps.length - 1) { stepI++; drawStep(); } else { st.last = null; save(st); drawList(); }
    };
    root.querySelectorAll('.md code').forEach(c => {
      if (/^[A-Z]\w+$/.test(c.textContent)) { c.classList.add('ref-link'); c.title = 'Open in the reference'; c.onclick = () => onConcept(c.textContent); }
    });
    typeset(root);
    root.scrollTop = 0;
  }

  const ready = (async () => {
    try {
      const mod = await import(new URL('../lessons/index.js', import.meta.url).href);
      lessons = (mod.LESSONS || mod.default || []).filter(l => l && Array.isArray(l.steps) && l.steps.length);
    } catch { lessons = []; }
    if (!lessons.length) {
      root.innerHTML = '<div class="ln-head"><h2>Lessons</h2></div><p class="muted">The lessons are not loaded yet. Open an example, or read the reference.</p>';
      return lessons;
    }
    const i = st.last ? lessons.findIndex(l => l.id === st.last.id) : -1;
    if (i >= 0) openLesson(i, st.last.step); else drawList();
    return lessons;
  })();

  return {
    ready,
    onRunResult(code, result) {
      if (!lesson) return;
      const s = lesson.steps[stepI];
      const r = checkStep(s, code, result);
      if (r.ok === null) return;
      const key = `${lesson.id}/${stepI}`;
      const box = root.querySelector('.ln-check');
      if (r.ok) { st.done[key] = true; save(st); }
      if (box) {
        box.hidden = !(r.ok || r.message);
        box.textContent = r.ok ? '✓ Done. The check passed.' : r.message;
        box.classList.toggle('bad', !r.ok);
      }
      root.querySelector(`.ln-dots button[data-j="${stepI}"]`)?.classList.toggle('done', !!st.done[key]);
    },
  };
}
