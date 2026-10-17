// ============================================================================
//  TENSOR CALCULUS  ·  ui/library-browser.js  ·  the library panel  (CORE)
// ----------------------------------------------------------------------------
//  The Library tab lists the LIBRARY entries (ui/packages.js gives them in
//  one shape). The reader can search, filter by field, or follow a learning
//  path. A tap on an entry calls onOpen(id); main.js then loads the entry
//  in the three views. The detail card shows the story (prose with inline
//  TeX), the vocabulary, the parameters (sliders that rebuild the trace),
//  the references, and the next entry of the path.
//
//  splitProse() and the TeX boxes use the same index colours as the views.
//
//  EXPORTS   (grep -n "export" ui/library-browser.js)
//      splitProse(text) -> [{ text } | { tex }]
//      createLibraryBrowser(els, deps) -> { render(), showDetail(id),
//        setQuery(q), setField(f), current(), paramsOf(id) }
// ============================================================================
import { colorIndexTex } from './tex-color.js';
import { indexClass } from '../palette.js';
import { searchEntries } from './packages.js';

export function splitProse(text) {
  const out = [];
  const s = String(text || '');
  let i = 0;
  while (i < s.length) {
    const a = s.indexOf('$', i);
    if (a < 0) { out.push({ text: s.slice(i) }); break; }
    if (a > i) out.push({ text: s.slice(i, a) });
    const dbl = s[a + 1] === '$';
    const b = s.indexOf(dbl ? '$$' : '$', a + (dbl ? 2 : 1));
    if (b < 0) { out.push({ text: s.slice(a) }); break; }
    out.push({ tex: s.slice(a + (dbl ? 2 : 1), b), display: dbl });
    i = b + (dbl ? 2 : 1);
  }
  return out.filter(p => p.text !== '');
}

// els: { search, fields, paths, list, detail }
// deps: { lib, typeset, onOpen(id, params), onParams(id, params), fieldLabel }
export function createLibraryBrowser(els, deps) {
  const { lib, typeset } = deps;
  const doc = els.list.ownerDocument;
  let query = '', field = null, currentId = null, pathId = null;
  const params = new Map();   // id -> { key: value }

  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const tex = (src, display = false) => {
    const e = h('span', display ? 'sci-eq' : 'sci-sym');
    const t = src.includes('\\class{i') ? src : colorIndexTex(src, indexClass);
    e.textContent = src;
    Promise.resolve(typeset(e, t, { display })).catch(() => {});
    return e;
  };
  const prose = (text, cls = 'story-p') => {
    const p = h('p', cls);
    for (const part of splitProse(text)) p.appendChild(part.tex != null ? tex(part.tex, part.display) : doc.createTextNode(part.text));
    return p;
  };

  function paramsOf(id) {
    const e = lib.byId.get(id);
    if (!e) return {};
    if (!params.has(id)) params.set(id, Object.fromEntries((e.params || []).map(p => [p.key, p.def])));
    return { ...params.get(id) };
  }

  function renderFields() {
    els.fields.replaceChildren();
    const mk = (id, label, count) => {
      const b = h('button', 'chip' + (field === id ? ' on' : ''), label);
      if (count != null) b.appendChild(h('span', 'chip-n', String(count)));
      b.setAttribute('aria-pressed', String(field === id));
      b.addEventListener('click', () => { field = field === id ? null : id; render(); });
      els.fields.appendChild(b);
    };
    mk(null, 'All', lib.entries.length);
    for (const f of lib.fields) mk(f.id, f.label, f.count);
  }

  function renderPaths() {
    els.paths.replaceChildren();
    if (!lib.paths.length || query || field) { els.paths.hidden = true; return; }
    els.paths.hidden = false;
    els.paths.appendChild(h('div', 'sec-label', 'Learning paths'));
    for (const p of lib.paths) {
      const card = h('button', 'path-card' + (pathId === p.id ? ' on' : ''));
      card.appendChild(h('span', 'path-title', p.title));
      card.appendChild(h('span', 'path-blurb', p.blurb));
      const dots = h('span', 'path-dots');
      p.ids.forEach((id, k) => { const d = h('span', 'path-dot' + (id === currentId ? ' on' : ''), String(k + 1)); d.title = (lib.byId.get(id) || {}).title || id; dots.appendChild(d); });
      card.appendChild(dots);
      card.addEventListener('click', () => { pathId = p.id; open(p.ids[0]); });
      els.paths.appendChild(card);
    }
  }

  function renderList() {
    els.list.replaceChildren();
    const found = searchEntries(lib, query, field);
    if (!lib.entries.length) {
      els.list.appendChild(h('p', 'hint', 'The library has not loaded yet. The playground and the chapters still work.'));
      return;
    }
    if (!found.length) { els.list.appendChild(h('p', 'hint', 'No entry matches. Try a field name, a letter such as Gamma, or a word such as curvature.')); return; }
    if (!query && !field) els.list.appendChild(h('div', 'sec-label', 'All equations'));
    for (const e of found) {
      const row = h('button', 'entry-row' + (e.id === currentId ? ' on' : ''));
      row.setAttribute('role', 'listitem');
      row.dataset.id = e.id;
      const top = h('span', 'entry-top');
      top.appendChild(h('span', 'entry-title', e.title));
      top.appendChild(h('span', 'entry-field', (lib.fields.find(f => f.id === e.field) || {}).label || e.field || ''));
      row.appendChild(top);
      if (e.tex) { const t = tex(e.tex, false); t.classList.add('entry-tex'); row.appendChild(t); }
      row.addEventListener('click', () => open(e.id));
      els.list.appendChild(row);
    }
  }

  function render() {
    renderFields(); renderPaths(); renderList();
    els.detail.hidden = !currentId;
  }

  function nextInPath(id) {
    const p = lib.paths.find(q => q.id === pathId && q.ids.includes(id)) || lib.paths.find(q => q.ids.includes(id));
    if (!p) return null;
    const k = p.ids.indexOf(id);
    return k >= 0 && k < p.ids.length - 1 ? { path: p, id: p.ids[k + 1], at: k } : { path: p, id: null, at: k };
  }

  function showDetail(id) {
    const e = lib.byId.get(id);
    els.detail.replaceChildren();
    if (!e) { els.detail.hidden = true; return; }
    els.detail.hidden = false;
    const back = h('button', 'mini back', '← All equations');
    back.addEventListener('click', () => { currentId = null; els.detail.hidden = true; els.list.hidden = false; els.paths.hidden = false; render(); });
    els.detail.appendChild(back);
    els.detail.appendChild(h('div', 'entry-field', (lib.fields.find(f => f.id === e.field) || {}).label || e.field || ''));
    els.detail.appendChild(h('h2', 'entry-h', e.title));
    if (e.tex) { const t = tex(e.tex, true); t.classList.add('entry-eq'); els.detail.appendChild(t); }

    if (e.params && e.params.length) {
      const box = h('div', 'params');
      box.appendChild(h('div', 'sec-label', 'Parameters'));
      const vals = paramsOf(id);
      for (const p of e.params) {
        const row = h('label', 'row');
        const name = h('span', 'row-name');
        if (/[\\^_]/.test(p.label || '')) name.appendChild(tex(p.label)); else name.textContent = p.label || p.key;
        const inp = doc.createElement('input');
        inp.type = 'range'; inp.min = p.min; inp.max = p.max; inp.step = p.step || (p.max - p.min) / 100; inp.value = vals[p.key];
        inp.setAttribute('aria-label', p.label || p.key);
        const out = h('span', 'row-val', fmt(vals[p.key]));
        let timer = 0;
        inp.addEventListener('input', () => {
          const cur = paramsOf(id); cur[p.key] = +inp.value; params.set(id, cur);
          out.textContent = fmt(+inp.value);
          clearTimeout(timer);
          timer = setTimeout(() => deps.onParams && deps.onParams(id, paramsOf(id)), 120);
        });
        row.append(name, inp, out);
        box.appendChild(row);
      }
      els.detail.appendChild(box);
    }

    const replay = h('button', 'primary', 'Play the steps again');
    replay.addEventListener('click', () => deps.onOpen(id, paramsOf(id), { replay: true }));
    els.detail.appendChild(replay);

    const story = [].concat(e.story || []);
    if (story.length) {
      const s = h('div', 'story');
      for (const para of story) s.appendChild(prose(para));
      els.detail.appendChild(s);
    }
    if (e.vocab && e.vocab.length) {
      const dl = h('dl', 'vocab');
      els.detail.appendChild(h('div', 'sec-label', 'Words'));
      for (const v of e.vocab) {
        const dt = h('dt'); for (const part of splitProse(v.term)) dt.appendChild(part.tex != null ? tex(part.tex) : doc.createTextNode(part.text));
        const dd = h('dd'); for (const part of splitProse(v.meaning)) dd.appendChild(part.tex != null ? tex(part.tex) : doc.createTextNode(part.text));
        dl.append(dt, dd);
      }
      els.detail.appendChild(dl);
    }
    if (e.refs && e.refs.length) {
      els.detail.appendChild(h('div', 'sec-label', 'Sources'));
      const ul = h('ul', 'refs');
      for (const r of e.refs) {
        const li = h('li');
        if (r.url) { const a = h('a', null, r.text); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; li.appendChild(a); }
        else li.textContent = r.text;
        ul.appendChild(li);
      }
      els.detail.appendChild(ul);
    }
    const nx = nextInPath(id);
    if (nx) {
      const nav = h('div', 'path-nav');
      nav.appendChild(h('span', 'path-pos', `${nx.path.title}: ${nx.at + 1} of ${nx.path.ids.length}`));
      if (nx.path.why && nx.path.why[id]) nav.appendChild(prose(nx.path.why[id], 'path-why'));
      if (nx.id) {
        const b = h('button', 'primary', 'Next: ' + ((lib.byId.get(nx.id) || {}).title || nx.id) + ' →');
        b.addEventListener('click', () => { pathId = nx.path.id; open(nx.id); });
        nav.appendChild(b);
      }
      els.detail.appendChild(nav);
    }
    els.detail.scrollTop = 0;
    if (els.detail.scrollIntoView) try { els.detail.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (x) { /* old engines */ }
  }

  function fmt(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : (+v).toFixed(2); }

  function open(id) {
    currentId = id;
    els.list.hidden = true; els.paths.hidden = true;
    showDetail(id);
    deps.onOpen(id, paramsOf(id), {});
  }

  els.search.addEventListener('input', () => {
    query = els.search.value; currentId = null; els.list.hidden = false;
    render();
  });

  return {
    render, showDetail,
    select(id) { if (!lib.byId.has(id)) return false; currentId = id; els.list.hidden = true; els.paths.hidden = true; showDetail(id); return true; },
    setQuery(q) { query = q; els.search.value = q; render(); },
    setField(f) { field = f; render(); },
    current() { return currentId; },
    paramsOf,
  };
}
