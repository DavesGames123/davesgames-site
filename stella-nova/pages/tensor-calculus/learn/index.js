// ============================================================================
//  TENSOR CALCULUS  ·  learn/index.js  ·  the guided chapters  (LEARN)
// ----------------------------------------------------------------------------
//  Ten chapters, each a sequence of beats. A beat is short text with typeset,
//  colour-coded TeX, a call into window.tensorPage that sets the 3D scene,
//  the diagram and the step player, and (often) a small widget of its own.
//  CORE gives a host element and calls createLearn(); the panel then has
//  progress, back and next, and deep links.
//
//  DEEP LINKS   #learn/<chapter id>/<beat number, from 1>
//      #learn/indices/3   chapter "indices", third beat
//      #learn/indices     its first beat
//      #learn             the first chapter
//
//  BEAT SCHEMA  (chapters/*.js)
//      { title,
//        text: string | [paragraphs]   prose; $...$ is inline TeX
//        tex?: string                  one display equation
//        show?: { view, style, entry, scene, params, expr, step, pick }
//                                      see drive.js for the calls it makes
//        widget?: { type, ... }        widgets/index.js
//        deeper?: { title, text }      an optional graduate-level aside }
//      In TeX, letters in ^{} and _{} are index letters and get their
//      palette.js colour. \I{x} marks an index in running text. Write
//      \mathrm{s} for a subscript that is a label, not an index.
//
//  API   (grep -n "^export" index.js)
//      CHAPTERS ............ [{ id, title, blurb, beats }] in reading order
//      chapterById(id)
//      beatCount() ......... the total over all chapters
//      parseLearnHash(h) ... { chapter, beat (0-based) } | null
//      learnHash(id, beat) . '#learn/id/<beat + 1>'
//      beatTex(beat) ....... every TeX string of a beat (prose, display,
//                            widget TeX), with index colours, for tests
//      createLearn(host, opts) -> { go(id, beat), next(), back(), state(),
//                            dispose() }
//          opts: { page = window.tensorPage, typeset (lib/sci-math.js),
//                  lib, math (modules, optional), hash = true,
//                  onChange({ chapter, beat }) }
//
//  FILES
//      chapters/01-tensor.js .. 10-notation.js   the text of each chapter
//      drive.js        beat.show -> tensorPage calls
//      tex.js          index colouring of TeX, prose splitting
//      refs.js         scene, entry, step and widget names from the contract
//      widgets/        inline widgets (index.js DOM, math.js DOM-free)
//      stub.js         a recording tensorPage for tests and for a page with
//                      no CORE
//      learn.css       the panel and widget styles (createLearn links it)
// ============================================================================
import ch1 from './chapters/01-tensor.js';
import ch2 from './chapters/02-indices.js';
import ch3 from './chapters/03-summation.js';
import ch4 from './chapters/04-metric.js';
import ch5 from './chapters/05-product.js';
import ch6 from './chapters/06-transform.js';
import ch7 from './chapters/07-symmetry.js';
import ch8 from './chapters/08-covariant.js';
import ch9 from './chapters/09-curvature.js';
import ch10 from './chapters/10-notation.js';
import { colorIndices, splitProse, proseTex } from './tex.js';
import { driveBeat } from './drive.js';
import { resolveScene, resolveEntry } from './refs.js';
import { indexClass, indexColor } from '../palette.js';

export const CHAPTERS = Object.freeze([ch1, ch2, ch3, ch4, ch5, ch6, ch7, ch8, ch9, ch10]);

export function chapterById(id) { return CHAPTERS.find(c => c.id === id) || null; }
export function beatCount() { return CHAPTERS.reduce((s, c) => s + c.beats.length, 0); }

export function parseLearnHash(hash) {
  const m = /^#?learn(?:\/([a-z0-9-]+))?(?:\/(\d+))?\/?$/.exec(String(hash || '').trim());
  if (!m) return null;
  const ch = m[1] ? chapterById(m[1]) : CHAPTERS[0];
  if (!ch) return null;
  const n = m[2] ? parseInt(m[2], 10) : 1;
  return { chapter: ch.id, beat: Math.max(0, Math.min(ch.beats.length - 1, n - 1)) };
}

export function learnHash(id, beat = 0) { return `#learn/${id}/${beat + 1}`; }

const paras = text => (Array.isArray(text) ? text : text ? [text] : []);

// Raw TeX strings of a beat, before colouring: [{ where, tex, display }].
export function beatTexList(beat) {
  const out = [];
  for (const p of paras(beat.text)) for (const t of proseTex(p)) out.push({ where: 'text', tex: t, display: false });
  if (beat.tex) out.push({ where: 'tex', tex: beat.tex, display: true });
  if (beat.show && beat.show.expr) out.push({ where: 'show.expr', tex: beat.show.expr, display: true });
  if (beat.deeper) for (const t of proseTex(beat.deeper.text)) out.push({ where: 'deeper', tex: t, display: false });
  if (beat.widget && beat.widget.type === 'quiz') for (const it of beat.widget.items) out.push({ where: 'quiz', tex: it.src, display: false });
  return out;
}

export function beatTex(beat, classOf = indexClass) {
  return beatTexList(beat).map(x => ({ ...x, colored: colorIndices(x.tex, classOf) }));
}

// ------------------------------------------------------------ DOM panel
function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function linkCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-learn-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./learn.css', import.meta.url).href; l.dataset.learnCss = '';
  document.head.appendChild(l);
}

export function createLearn(host, opts = {}) {
  linkCss();
  const page = opts.page || (typeof window !== 'undefined' ? window.tensorPage : null);
  const typesetFn = opts.typeset || null;
  let mounted = null, cur = { chapter: CHAPTERS[0].id, beat: 0 }, token = 0;
  let widgetMod = null;

  const root = el('section', 'learn', host);
  root.setAttribute('aria-label', 'Guided chapters');
  root.tabIndex = -1;
  const head = el('header', 'learn-head', root);
  const chNo = el('div', 'learn-chno', head);
  const chTitle = el('h2', 'learn-chtitle', head);
  const chBlurb = el('p', 'learn-blurb', head);
  const prog = el('div', 'learn-prog', root);
  prog.setAttribute('role', 'tablist');
  const chapProg = el('div', 'learn-chprog', root);
  const body = el('article', 'learn-body', root);
  body.setAttribute('aria-live', 'polite');
  const foot = el('footer', 'learn-foot', root);
  const backB = el('button', 'learn-back', foot, 'Back');
  const pos = el('span', 'learn-pos', foot);
  const nextB = el('button', 'learn-next', foot, 'Next');
  backB.type = nextB.type = 'button';

  const tex = async (target, src, display) => {
    const colored = colorIndices(src, indexClass);
    if (!typesetFn) { target.textContent = src; target.classList.add('raw'); return false; }
    return typesetFn(target, colored, { display });
  };
  const ctx = { page, tex, color: s => indexColor(s), cls: s => indexClass(s) };

  const prose = (parent, text) => {
    const p = el('p', 'learn-p', parent);
    for (const part of splitProse(text)) {
      if ('text' in part) p.appendChild(document.createTextNode(part.text));
      else { const m = el('span', 'learn-im sci-sym', p); tex(m, part.tex, false); }
    }
    return p;
  };

  const render = async () => {
    const my = ++token;
    const ch = chapterById(cur.chapter), beat = ch.beats[cur.beat];
    const ci = CHAPTERS.indexOf(ch);
    chNo.textContent = `Chapter ${ci + 1} of ${CHAPTERS.length}`;
    chTitle.textContent = ch.title;
    chBlurb.textContent = ch.blurb;
    prog.replaceChildren();
    ch.beats.forEach((b, i) => {
      const d = el('button', 'learn-dot' + (i < cur.beat ? ' done' : i === cur.beat ? ' now' : ''), prog);
      d.type = 'button'; d.title = b.title; d.setAttribute('aria-label', `Beat ${i + 1}: ${b.title}`);
      d.setAttribute('aria-selected', i === cur.beat ? 'true' : 'false');
      d.addEventListener('click', () => go(ch.id, i));
    });
    chapProg.replaceChildren();
    CHAPTERS.forEach((c, i) => {
      const d = el('button', 'learn-chdot' + (i < ci ? ' done' : i === ci ? ' now' : ''), chapProg, String(i + 1));
      d.type = 'button'; d.title = c.title;
      d.addEventListener('click', () => go(c.id, 0));
    });
    pos.textContent = `${cur.beat + 1} / ${ch.beats.length}`;
    backB.disabled = ci === 0 && cur.beat === 0;
    const last = cur.beat === ch.beats.length - 1;
    nextB.textContent = last ? (CHAPTERS[ci + 1] ? `Next: ${CHAPTERS[ci + 1].title}` : 'Done') : 'Next';
    nextB.disabled = last && !CHAPTERS[ci + 1];

    // Views first, so the TeX colours read the palette slots CORE set.
    await driveBeat(page, beat.show || {}, { lib: opts.lib, math: opts.math, fallbackExpr: beat.tex, resolveScene: id => resolveScene(id, opts.sceneIds), resolveEntry: id => resolveEntry(id, opts.entryIds) });
    if (my !== token) return;
    if (mounted) { mounted.dispose(); mounted = null; }
    body.replaceChildren();
    el('h3', 'learn-title', body, beat.title);
    for (const p of paras(beat.text)) prose(body, p);
    if (beat.tex) { const d = el('div', 'learn-eq sci-eq', body); tex(d, beat.tex, true); }
    if (beat.widget) {
      if (!widgetMod) widgetMod = await import('./widgets/index.js');
      if (my !== token) return;
      try { mounted = widgetMod.mountWidget(body, beat.widget, ctx); } catch (e) { el('p', 'learn-err', body, 'This figure could not start: ' + e.message); }
    }
    if (beat.deeper) {
      const det = el('details', 'learn-deeper', body);
      el('summary', '', det, 'Deeper: ' + beat.deeper.title);
      prose(det, beat.deeper.text);
    }
    if (opts.onChange) opts.onChange({ ...cur });
  };

  function go(id, beat = 0) {
    const ch = chapterById(id) || CHAPTERS[0];
    cur = { chapter: ch.id, beat: Math.max(0, Math.min(ch.beats.length - 1, beat)) };
    if (opts.hash !== false && typeof history !== 'undefined' && typeof location !== 'undefined') {
      const hsh = learnHash(cur.chapter, cur.beat);
      if (location.hash !== hsh) history.replaceState(null, '', hsh);
    }
    return render();
  }
  function next() {
    const ch = chapterById(cur.chapter), ci = CHAPTERS.indexOf(ch);
    if (cur.beat < ch.beats.length - 1) return go(ch.id, cur.beat + 1);
    if (CHAPTERS[ci + 1]) return go(CHAPTERS[ci + 1].id, 0);
    return Promise.resolve();
  }
  function back() {
    const ch = chapterById(cur.chapter), ci = CHAPTERS.indexOf(ch);
    if (cur.beat > 0) return go(ch.id, cur.beat - 1);
    if (ci > 0) return go(CHAPTERS[ci - 1].id, CHAPTERS[ci - 1].beats.length - 1);
    return Promise.resolve();
  }
  nextB.addEventListener('click', next);
  backB.addEventListener('click', back);
  const onKey = e => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { back(); e.preventDefault(); }
  };
  root.addEventListener('keydown', onKey);
  const onHash = () => { const p = parseLearnHash(location.hash); if (p && (p.chapter !== cur.chapter || p.beat !== cur.beat)) go(p.chapter, p.beat); };
  if (opts.hash !== false && typeof window !== 'undefined') window.addEventListener('hashchange', onHash);

  const start = opts.hash !== false && typeof location !== 'undefined' ? parseLearnHash(location.hash) : null;
  const ready = go(start ? start.chapter : (opts.chapter || CHAPTERS[0].id), start ? start.beat : (opts.beat || 0));

  return {
    el: root, ready, go, next, back,
    state: () => ({ ...cur }),
    dispose() {
      token++;
      if (mounted) mounted.dispose();
      if (typeof window !== 'undefined') window.removeEventListener('hashchange', onHash);
      root.remove();
    },
  };
}
