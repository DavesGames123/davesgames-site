// ============================================================================
//  EM EXPLORER  ·  ui/panels.js — what the panel tabs and the sheets show
// ----------------------------------------------------------------------------
//  Each function builds DOM from catalog records. Text from records always
//  goes in with textContent, never as markup, and links must be http(s).
//
//    renderDatasets(list, datasets, currentId, onPick)    the Datasets tab
//    renderPlaces(list, bookmarks, datasets, opts)        the Places tab:
//        opts { query, scope 'all'|'here', currentDataset, activeId, onPick }
//        -> number of places shown
//    matchPlace(b, dataset, query)                        the search rule
//    placeTitle(b)                                        a short title
//    renderAbout(body, about) / renderCredits(body, datasets)
//    creditLine(dataset)                                  'Janelia FlyEM · CC BY 4.0'
//
//  grep -n targets
//    element helper .. "function h("
//    dataset cards ... "export function renderDatasets"
//    places .......... "export function renderPlaces"
//    search rule ..... "export function matchPlace"
//    about, credits .. "export function renderAbout" "export function renderCredits"
// ============================================================================
import { fmtVoxel, fmtExtent, fmtLength } from './format.js';

export function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
}

// h('div.cls', { attrs }, ...children) with text children as text nodes
export function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

function extLink(href, label) {
  const u = safeUrl(href);
  return u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, label) : null;
}

export function dsShort(d) { return d.short || d.name || d.id; }

export function creditLine(d) {
  if (!d) return '';
  return [d.credit, d.licence].filter(Boolean).join(' · ');
}

export function renderDatasets(list, datasets, currentId, onPick) {
  list.textContent = '';
  for (const d of datasets) {
    const cur = d.id === currentId;
    const meta = [d.organism, d.tissue].filter(Boolean).join(' · ');
    const tech = [d.method, fmtVoxel(d.voxel)].filter(Boolean).join(' · ');
    const ext = fmtExtent(d.size, d.voxel);
    const btn = h('button.ds-card', { type: 'button', 'aria-pressed': String(cur), dataset: { id: d.id }, onclick: () => onPick(d.id) },
      h('span.ds-card-name', { text: d.name || d.id }),
      meta && h('span.ds-card-meta', { text: meta }),
      h('span.ds-card-tech', {}, tech, ext ? h('span.ds-dot', { 'aria-hidden': 'true' }, ' · ') : null, ext ? ext : null),
      cur && h('span.ds-card-badge', { text: 'Viewing' }));
    const links = (Array.isArray(d.links) ? d.links : []).map((l) => extLink(l && l.href, (l && l.label) || 'Source')).filter(Boolean);
    const li = h('li', {}, btn);
    if (d.blurb || d.description) li.append(h('p.ds-card-blurb', { text: d.blurb || d.description }));
    if (links.length || d.licence) li.append(h('p.ds-card-links', {}, ...links.flatMap((a, i) => (i ? [' · ', a] : [a])), d.licence ? h('span.ds-lic', { text: (links.length ? ' · ' : '') + d.licence }) : null));
    list.append(li);
  }
}

export function placeTitle(b) {
  if (b.title) return String(b.title);
  const c = String(b.caption || '').trim();
  const cut = c.split(/[.;:,(]/)[0].trim();
  return (cut.length > 3 && cut.length <= 48 ? cut : c.slice(0, 44).replace(/\s+\S*$/, '') + (c.length > 44 ? '…' : '')) || b.id;
}

export function matchPlace(b, d, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [b.title, b.caption, b.tags && b.tags.join(' '), d && d.name, d && d.short, d && d.organism, d && d.tissue].filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function renderPlaces(list, bookmarks, datasets, opts = {}) {
  const { query = '', scope = 'all', currentDataset = null, activeId = null, onPick = () => {} } = opts;
  const byId = new Map(datasets.map((d) => [d.id, d]));
  list.textContent = '';
  let shown = 0;
  // the current dataset first, then the catalog order
  const order = [...datasets].sort((a, b) => (b.id === currentDataset) - (a.id === currentDataset));
  for (const d of order) {
    if (scope === 'here' && d.id !== currentDataset) continue;
    const items = bookmarks.filter((b) => b.dataset === d.id && matchPlace(b, d, query));
    if (!items.length) continue;
    const group = h('li.pl-group', {}, h('h3.pl-head', {}, h('span', { text: dsShort(d) }), h('span.pl-count', { text: String(items.length) })));
    const ol = h('ol.pl-items');
    for (const b of items) {
      const depth = Array.isArray(d.voxel) ? fmtLength(b.z * d.voxel[2]) : '';
      const btn = h('button.pl-item', { type: 'button', 'aria-current': b.id === activeId ? 'true' : null, dataset: { id: b.id }, onclick: () => onPick(b.id) },
        h('span.pl-title', { text: placeTitle(b) }),
        b.caption && h('span.pl-cap', { text: b.caption }),
        h('span.pl-meta', { text: [String(b.plane || 'xy').toUpperCase(), depth && `depth ${depth}`].filter(Boolean).join(' · ') }));
      ol.append(h('li', {}, btn));
      shown++;
    }
    group.append(ol);
    list.append(group);
  }
  return shown;
}

export function renderAbout(body, about) {
  body.textContent = '';
  for (const p of about.paragraphs || []) body.append(h('p', { text: p }));
  for (const s of about.sections || []) {
    if (!s) continue;
    if (s.title) body.append(h('h3', { text: s.title }));
    for (const p of s.paragraphs || []) body.append(h('p', { text: p }));
  }
  if (!body.childNodes.length) body.append(h('p', { text: 'Every image on this page streams from a public research archive. Nothing is copied here.' }));
}

export function renderCredits(body, datasets) {
  body.textContent = '';
  const ul = h('ul.credits');
  for (const d of datasets) {
    const links = (Array.isArray(d.links) ? d.links : []).map((l) => extLink(l && l.href, (l && l.label) || 'Source')).filter(Boolean);
    const lic = d.licence ? (extLink(d.licenceUrl || d.licenseUrl, d.licence) || h('span', { text: d.licence })) : null;
    ul.append(h('li', {},
      h('strong', { text: d.name || d.id }),
      d.credit && h('span.cr-line', { text: d.credit }),
      d.citation && h('span.cr-cite', { text: d.citation }),
      h('span.cr-links', {}, ...[lic, ...links].filter(Boolean).flatMap((a, i) => (i ? [' · ', a] : [a])))));
  }
  body.append(ul);
}
