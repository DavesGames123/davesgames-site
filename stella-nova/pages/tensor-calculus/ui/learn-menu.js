// ============================================================================
//  TENSOR CALCULUS  ·  ui/learn-menu.js  ·  the Learn tab  (CORE)
// ----------------------------------------------------------------------------
//  LEARN owns the chapters (learn/**). CORE owns the chapter menu and the
//  host box. LEARN createLearn(host, opts) drives the views at once (its
//  first beat calls tensorPage) and writes #learn/<id>/<beat> in the URL.
//  So CORE starts LEARN only when the reader opens a chapter, or when the
//  page opens with a #learn link. Before that, the Learn tab shows the menu
//  from CHAPTERS, and the views keep what the library put there.
//
//  After the start, a tap on a menu row calls go(id, 0) of LEARN. The menu
//  folds to one "All chapters" row above the chapter, so the chapter has
//  the room.
//
//  When the LEARN module has no createLearn, a tap shows the beats of the
//  chapter as plain text (title and paragraphs).
//
//  EXPORTS   (grep -n "export" ui/learn-menu.js)
//      chapterList(mod) -> [{ id, title, blurb, raw }]
//      createLearnMenu(els, deps) -> { open(id, beat), current(), list,
//        started(), startFromHash() }
// ============================================================================

export function chapterList(mod) {
  if (!mod) return [];
  let list = mod.CHAPTERS || mod.chapters || (Array.isArray(mod.default) ? mod.default : null) || [];
  if (!Array.isArray(list) && typeof list === 'object') list = Object.values(list);
  return list.filter(c => c && c.id).map(c => ({ id: c.id, title: c.title || c.id, blurb: c.blurb || '', raw: c }));
}

// els: { menu, host }
// deps: { learn (module or null), page, typeset, learnOpts(), onOpen(id) }
export function createLearnMenu(els, deps) {
  const mod = deps.learn;
  const doc = els.menu.ownerDocument;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const list = chapterList(mod);
  let cur = null, ctl = null, folded = false;

  function renderMenu() {
    els.menu.replaceChildren();
    if (!list.length) { els.menu.appendChild(h('p', 'hint', 'The guided chapters have not loaded yet.')); return; }
    if (folded) {
      const b = h('button', 'mini chapters-toggle', '☰ All chapters');
      b.addEventListener('click', () => { folded = false; renderMenu(); });
      els.menu.appendChild(b);
      return;
    }
    if (!cur) els.menu.appendChild(h('p', 'hint', 'Ten short chapters. Each one drives the equation, the 3D view and the Penrose diagram as you read.'));
    list.forEach((c, k) => {
      const b = h('button', 'chapter-row' + (c.id === cur ? ' on' : ''));
      b.setAttribute('role', 'listitem');
      b.appendChild(h('span', 'chapter-n', String(k + 1)));
      const txt = h('span', 'chapter-txt');
      txt.appendChild(h('span', 'chapter-title', c.title));
      if (c.blurb) txt.appendChild(h('span', 'chapter-blurb', c.blurb));
      b.appendChild(txt);
      b.addEventListener('click', () => open(c.id, 0));
      els.menu.appendChild(b);
    });
  }

  function fallback(c) {
    els.host.replaceChildren();
    els.host.appendChild(h('h2', 'entry-h', c.title));
    for (const beat of c.raw.beats || []) {
      els.host.appendChild(h('h3', 'beat-h', beat.title || ''));
      for (const p of [].concat(beat.text || [])) els.host.appendChild(h('p', 'story-p', p));
    }
  }

  function start(o) {
    try {
      ctl = mod.createLearn(els.host, {
        page: deps.page, typeset: deps.typeset, ...(deps.learnOpts ? deps.learnOpts() : {}), ...o,
        onChange: st => { cur = st.chapter; if (!folded) renderMenu(); if (deps.onOpen) deps.onOpen(st.chapter, st.beat); },
      });
    } catch (e) {
      ctl = null;
      els.host.appendChild(h('p', 'hint', 'The chapters did not start: ' + e.message));
    }
    return ctl;
  }

  function open(id, beat = 0) {
    const c = list.find(q => q.id === id);
    if (!c) return false;
    cur = id; folded = true; renderMenu();
    if (mod && typeof mod.createLearn === 'function') {
      if (!ctl) start({ chapter: id, beat });
      else if (ctl.go) ctl.go(id, beat);
    } else {
      fallback(c);
      if (deps.onOpen) deps.onOpen(id, beat);
    }
    return true;
  }

  // The page opened with #learn...: LEARN reads the hash itself.
  function startFromHash() {
    if (!(mod && typeof mod.createLearn === 'function')) return false;
    if (!ctl) { folded = true; renderMenu(); start({}); }
    return !!ctl;
  }

  renderMenu();
  return {
    open, list, startFromHash,
    started: () => !!ctl,
    current: () => (ctl && ctl.state ? ctl.state().chapter : cur),
    ctl: () => ctl,
  };
}
