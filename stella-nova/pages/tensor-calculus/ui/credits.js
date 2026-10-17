// ============================================================================
//  TENSOR CALCULUS  ·  ui/credits.js  ·  the credits drawer  (CORE)
// ----------------------------------------------------------------------------
//  The drawer names the origin of the diagram notation, the tools the page
//  runs on, and every source that the LIBRARY entries cite (one line per
//  URL, so a book that ten entries cite shows once).
//
//  EXPORTS   (grep -n "export" ui/credits.js)
//      BASE_CREDITS, collectRefs(entries), renderCredits(host, entries, extra)
// ============================================================================

export const BASE_CREDITS = Object.freeze([
  { group: 'Diagram notation', items: [
    { text: 'R. Penrose, Applications of negative dimensional tensors, in Combinatorial Mathematics and its Applications, Academic Press (1971). The origin of the diagram notation.', url: 'https://en.wikipedia.org/wiki/Penrose_graphical_notation' },
    { text: 'P. Cvitanović, Group Theory: Birdtracks, Lie\'s, and Exceptional Groups, Princeton University Press (2008). Birdtracks.', url: 'https://birdtracks.eu/' },
    { text: 'J. C. Bridgeman and C. T. Chubb, Hand-waving and interpretive dance: an introductory course on tensor networks, J. Phys. A 50 (2017).', url: 'https://arxiv.org/abs/1603.03039' },
    { text: 'R. Penrose, The Road to Reality (2004), chapters 12 and 14.', url: 'https://en.wikipedia.org/wiki/The_Road_to_Reality' },
  ] },
  { group: 'Not Feynman diagrams', items: [
    { text: 'Feynman diagrams draw particle interactions in quantum field theory. A line there is a particle; a leg in a Penrose diagram is an index.', url: 'https://en.wikipedia.org/wiki/Feynman_diagram' },
  ] },
  { group: 'Software and design', items: [
    { text: 'MathJax 3.2.2 (Apache 2.0) typesets the equations as SVG.', url: 'https://www.mathjax.org/' },
    { text: 'three.js r160 (MIT) draws the 3D view.', url: 'https://threejs.org/' },
    { text: 'The index colours start from the Okabe-Ito colour-blind safe set, made lighter for a dark background.', url: 'https://jfly.uni-koeln.de/color/' },
    { text: 'STIX Two Text and Inter (SIL Open Font License).', url: 'https://github.com/stipub/stixfonts' },
  ] },
]);

export function collectRefs(entries) {
  const seen = new Map();
  for (const e of entries || []) for (const r of e.refs || []) {
    const key = r.url || r.text;
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, { ...r, entries: [] });
    seen.get(key).entries.push(e.title || e.id);
  }
  return [...seen.values()].sort((a, b) => String(a.text).localeCompare(String(b.text)));
}

export function renderCredits(host, entries, extra = []) {
  const doc = host.ownerDocument;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  host.replaceChildren();
  const groups = BASE_CREDITS.concat(extra);
  const refs = collectRefs(entries);
  if (refs.length) groups.push({ group: 'Sources the library cites', items: refs });
  for (const g of groups) {
    host.appendChild(h('h3', 'credits-h', g.group));
    const ul = h('ul', 'refs');
    for (const it of g.items) {
      const li = h('li');
      if (it.url) { const a = h('a', null, it.text); a.href = it.url; a.target = '_blank'; a.rel = 'noopener'; li.appendChild(a); }
      else li.textContent = it.text;
      if (it.entries && it.entries.length) li.appendChild(h('span', 'ref-used', ' Used in: ' + it.entries.slice(0, 4).join(', ') + (it.entries.length > 4 ? `, and ${it.entries.length - 4} more` : '') + '.'));
      ul.appendChild(li);
    }
    host.appendChild(ul);
  }
  return refs.length;
}
