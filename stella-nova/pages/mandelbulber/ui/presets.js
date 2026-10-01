// ui/presets.js — Mandelbulber page: the preset catalog and the preset loader.
//
// prepareExamples joins the three preset sources into one list (EXAMPLES in data.js)
// and gives each preset a source, a group, a family, a thumbnail key and a search text.
// exampleScene turns a preset into a full scene, and loadExample loads it.
//
// grep: const SOURCES  const FAMILIES  function presetFamily  function prepareExamples  function presetTitle
//       function exampleScene  function loadExample

import { SLOTS, fillDefaults, parseFract, parseValue } from '../fract.js';
import { P, EXAMPLES, COLLECTIONS, byEnum, groupName, mainSpec } from './data.js';
import { setCurrentExample } from './state.js';
import { loadScene } from './scene.js';
import { markExample } from './panel.js';

// Three sources, in this order: the upstream examples (gen/examples.json), the upstream
// collections whose licence allows commercial use (gen/collections.json, one group per author,
// with the author and the licence shown), and the site originals (gen/originals.json).
// Each preset gets a key ("e:<file>", "c:<folder>/<file>", "o:<id>") for its thumbnail in
// gen/preset-thumbs.jpg, and a formula family for the filter chips.
export const SOURCES = [['all', 'All'], ['e', 'Upstream examples'], ['c', 'Upstream collections'], ['o', 'Site originals']];
export const FAMILIES = ['Bulbs', 'Boxes', 'IFS & kaleidoscopic', '4D & quaternion', 'Kleinian', 'dIFS', 'Hybrids', 'Other'];

// Family from the formulas in use. Two or more formulas, or a formula with a transform, is a hybrid.
function presetFamily(e) {
  const m = e.main || {};
  const hybrid = !!m.hybrid_fractal_enable;
  const used = [];
  for (let k = 1; k <= SLOTS; k++) {
    const n = m[`formula_${k}`] ?? (k === 1 ? P.main.formula_1?.default : 0);
    if (!n || (k > 1 && !hybrid)) continue;
    const f = byEnum.get(n);
    if (f && !used.includes(f)) used.push(f);
  }
  const shapes = used.filter((f) => groupName(f) !== 'Transforms');
  if (shapes.length > 1 || (shapes.length && used.length > shapes.length)) return 'Hybrids';
  const f = shapes[0] || used[0];
  if (!f) return 'Other';
  const id = `${f.file} ${f.name}`.toLowerCase(), g = groupName(f).toLowerCase();
  if (g.includes('kleinian') || id.includes('kleinian')) return 'Kleinian';
  if (g.includes('difs') || /^difs/.test(f.file)) return 'dIFS';
  if (/4d|quaternion|quat\b|hypercomplex|aexion|bristorbrot|hopf/.test(id)) return '4D & quaternion';
  if (/box|surf|kali|mandalay|pseudo|tglad/.test(id)) return 'Boxes';
  if (/menger|sierpinski|ifs|octahedron|icosa|dodeca|tetra|vicsek|koch|spheretree|knot|polyhedr|fold_cut|kaleid|platonic|prism|cross/.test(id)) return 'IFS & kaleidoscopic';
  if (/bulb|bar|riemann|cup|torus|benesi|msltoe|xenodreamie|lkmitch|makin|quadrat|kosalos|lambda|power|mandel|julia/.test(id)) return 'Bulbs';
  return 'Other';
}

export function prepareExamples(raw, col, orig) {
  const list = (r) => (Array.isArray(r) ? r : r?.examples || r?.presets || []);
  const out = [];
  const add = (e, src, extra) => {
    const name = e.name || e.title || e.file || e.id || 'preset';
    const x = { ...e, ...extra, src, name, _formula: e.formula_1 ?? e.main?.formula_1 ?? P.main.formula_1?.default };
    x.family = presetFamily(x);
    x.key = src === 'o' ? `o:${e.id}` : `${src}:${e.file}`;
    const f = byEnum.get(x._formula);
    x.search = `${name} ${f?.name || ''} ${f?.file || ''} ${x.family} ${x.group} ${x.author || ''}`.toLowerCase();
    out.push(x);
  };
  for (const e of list(raw)) add(e, 'e', { group: 'Upstream examples' });
  for (const e of list(col)) {
    const c = COLLECTIONS[e.collection];
    if (!c) continue;
    add(e, 'c', { group: `${c.author}${c.subject ? ` (${c.subject})` : ''} · ${c.licence}`, author: c.author, licence: c.licence, licenceUrl: c.licenceUrl });
  }
  for (const e of list(orig)) add(e, 'o', { group: 'Site originals' });
  return out;
}

export function presetTitle(e) {
  const f = byEnum.get(e._formula);
  return `${e.name}${f ? ` · ${f.name}` : ''} · ${e.family}${e.author ? ` · by ${e.author}, ${e.licence}` : e.src === 'o' ? ' · site original' : ''}`;
}

export function exampleScene(e) {
  if (typeof e.text === 'string') return parseFract(e.text, P).scene;
  // gen/examples.json holds only the params each file sets, already migrated.
  const src = e.scene || e.params || { main: e.main, fractal: e.fractal };
  const val = (d, v) => (typeof v === 'string' && d.type !== 'string' ? parseValue(d, v) : structuredClone(v));
  const part = { main: {}, fractal: [] };
  for (const [k, v] of Object.entries(src.main || {})) { const d = mainSpec(k); if (d && v !== null && v !== undefined) part.main[k] = val(d, v); }
  const fr = src.fractal || [];
  const entries = Array.isArray(fr) ? fr.map((f, i) => [i, f]) : Object.entries(fr).map(([k, f]) => [Number(k) - 1, f]);
  for (const [i, f] of entries) {
    if (!(i >= 0 && i < SLOTS)) continue;
    while (part.fractal.length <= i) part.fractal.push({});
    for (const [k, v] of Object.entries(f || {})) if (P.fractal[k] && v !== null && v !== undefined) part.fractal[i][k] = val(P.fractal[k], v);
  }
  return fillDefaults(part, P);
}

export function loadExample(i) {
  const e = EXAMPLES[i];
  if (!e) return;
  setCurrentExample(i);
  markExample();
  loadScene(exampleScene(e), `${e.src === 'o' ? 'site original' : 'example'}: ${e.name}${e.author ? ` · by ${e.author} (${e.licence})` : ''}`);
}
