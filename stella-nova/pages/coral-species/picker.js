// ============================================================================
//  CORAL SPECIES  ·  picker.js  ·  the species picker and the info card
// ----------------------------------------------------------------------------
//  The picker of the Species section, made with the panel API of
//  lib/sn-panel.js (PANEL owns the look: this module adds no CSS rules of
//  its own, only the panel controls and the class names below).
//    search ... a search field (desktop; hidden on a phone): the common
//               name, the Latin name, the form or the group. Enter takes
//               the first match. Esc clears the field.
//    groups ... one chips control per growth form (species.js GROUPS:
//               branching, plates, massive, soft, fans, deep sea); a group
//               with no match hides
//    card ..... the info card (#spNote): name, Latin name, form, depth,
//               habitat, a fact and the growth rule. On a phone a swipe
//               to the left or right on the card gives the next or the
//               previous species (the dock button also steps).
//
//  USE
//    const P = mountSpeciesPicker(section, { value, onChange, phone });
//    P.set(id)          mark the species and fill the card (no callback)
//    P.step(+1 | -1)    the next or the previous species (callback)
//    P.filter(text)     the search (tests)
//
//  grep -n targets: "export function mountSpeciesPicker", "export function cardHTML"
// ============================================================================
import { SPECIES, GROUPS, SPECIES_LIST, matchSpecies, speciesCard } from './species.js';

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = c => `rgb(${c.map(v => Math.round(Math.min(1, v) * 255)).join(',')})`;

// The card markup of a species.
export function cardHTML(id) {
  const c = speciesCard(id); if (!c) return '';
  return `<p class="ic-name">${esc(c.name)}</p>`
    + `<p class="ic-latin"><i>${esc(c.latin)}</i></p>`
    + `<p class="ic-meta"><span>${esc(c.form)}</span> · <span>${esc(c.depth)}</span></p>`
    + (c.habitat ? `<p class="ic-hab">${esc(c.habitat)}.</p>` : '')
    + (c.fact ? `<p class="ic-fact">${esc(c.fact)}</p>` : '')
    + (c.rule ? `<p class="ic-rule">Growth rule: ${esc(c.rule)}</p>` : '');
}

export function mountSpeciesPicker(section, o = {}) {
  const P = { value: o.value || SPECIES_LIST[0].id, groups: [], query: '' };
  const doc = section.el ? section.el.ownerDocument : document;
  // one slot (#species) holds the search field and the group rows, so the
  // picker is one element of the section
  const box = section.slot({ id: 'species' });
  box.input.classList.add('sp-picker');
  // search (a native search field, styled by the panel tokens)
  const sl = { el: doc.createElement('div') };
  sl.el.className = 'sp-searchrow';
  sl.input = sl.el;
  box.input.appendChild(sl.el);
  const inp = doc.createElement('input');
  Object.assign(inp, { type: 'search', id: 'spSearch', placeholder: `Search ${SPECIES_LIST.length} species`, autocomplete: 'off', spellcheck: false });
  inp.setAttribute('aria-label', 'Search the species');
  inp.className = 'sp-search';
  inp.style.cssText = 'width:100%;box-sizing:border-box;min-height:var(--snp-h,32px);padding:4px 10px;border:1px solid var(--snp-line,#345);border-radius:var(--snp-r,8px);background:var(--snp-raise,#0003);color:var(--snp-ink,#dde);font:inherit';
  sl.input.appendChild(inp);
  if (o.phone) sl.el.hidden = true;
  // one chips control per group
  for (const g of GROUPS) {
    const C = section.chips({
      id: 'sp-' + g.id, label: g.label, columns: 2, value: g.ids.includes(P.value) ? P.value : null,
      items: g.ids.map(id => ({ id, label: SPECIES[id].label, swatch: css(SPECIES[id].tip) })),
      onChange: id => choose(id, true),
    });
    C.el.classList.add('sp-group');
    box.input.appendChild(C.el);
    P.groups.push({ g, C });
  }
  const none = section.note({ id: 'spNone' });
  box.input.appendChild(none.el);
  // the card
  const card = section.slot({ id: 'spNote' });
  card.input.classList.add('sp-card');
  card.input.setAttribute('aria-live', 'polite');

  function paint() {
    for (const { g, C } of P.groups) C.set(g.ids.includes(P.value) ? P.value : null);
    card.input.innerHTML = cardHTML(P.value);
  }
  function choose(id, fire) {
    if (!SPECIES[id]) return;
    P.value = id; paint();
    if (fire && o.onChange) o.onChange(id);
  }
  function filter(text) {
    P.query = text || '';
    let shown = 0;
    for (const { g, C } of P.groups) {
      let n = 0;
      for (const b of C.input.children) { const m = matchSpecies(b.dataset.id, P.query); b.hidden = !m; if (m) n++; }
      C.el.hidden = n === 0; shown += n;
    }
    none.input.textContent = shown ? '' : 'No species matches that search.';
    return shown;
  }
  function firstMatch() { for (const s of SPECIES_LIST) if (matchSpecies(s.id, P.query)) return s.id; return null; }
  function step(d) {
    const i = SPECIES_LIST.findIndex(s => s.id === P.value);
    choose(SPECIES_LIST[(i + d + SPECIES_LIST.length) % SPECIES_LIST.length].id, true);
  }
  inp.addEventListener('input', () => filter(inp.value));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const id = firstMatch(); if (id) choose(id, true); e.preventDefault(); }
    else if (e.key === 'Escape') { inp.value = ''; filter(''); }
  });
  // swipe on the card: the next or the previous species
  let sx = null, sy = 0;
  card.input.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
  card.input.addEventListener('pointerup', e => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
  card.input.addEventListener('pointercancel', () => { sx = null; });
  paint();
  Object.assign(P, { set: id => choose(id, false), step, filter, search: inp, card: card.input });
  return P;
}
