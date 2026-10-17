// ============================================================================
//  TENSOR CALCULUS  ·  ui/packages.js  ·  load the other packages  (CORE)
// ----------------------------------------------------------------------------
//  CORE is the integrator. MATH, LIBRARY, VIZ, DIAGRAM and LEARN are built
//  at the same time, so a package can be missing or can have an older API.
//  loadPackages() imports each one by itself. A package that does not load
//  gives null and a line in `missing`, and the page still boots: the view
//  shows a short note in place of the package.
//
//  normalizeLibrary() accepts the shapes a LIBRARY module can export:
//  ENTRIES, entries, LIBRARY or a default list, with optional PATHS (the
//  learning paths), FIELDS and getEntry(id). It gives one shape:
//      { entries: [entry], byId: Map, fields: [{ id, label, count }],
//        paths: [{ id, title, blurb, ids: [entryId] }] }
//  When LIBRARY has no PATHS, CORE_PATHS (below) are used, with only the
//  ids that exist.
//
//  EXPORTS   (grep -n "export" ui/packages.js)
//      PKG_PATHS ........ module path of each package, from the page folder
//      FIELD_LABELS ..... plain names of the LIBRARY fields
//      CORE_PATHS ....... learning paths used when LIBRARY has none
//      loadPackages(importer) -> { math, library, viz, diagram, learn, missing }
//      normalizeLibrary(mod)
//      searchEntries(lib, query, field) -> [entry]
// ============================================================================

export const PKG_PATHS = Object.freeze({
  math: './tensor/index.js',
  library: './library/index.js',
  viz: './viz/index.js',
  diagram: './diagram/index.js',
  learn: './learn/index.js',
});

export const FIELD_LABELS = Object.freeze({
  algebra: 'Algebra', geometry: 'Geometry', relativity: 'Relativity', electromagnetism: 'Electromagnetism',
  continuum: 'Continuum', mechanics: 'Mechanics', quantum: 'Quantum', ml: 'Machine learning',
});

// Ids are guesses at the LIBRARY ids; normalizeLibrary keeps only the ids
// that exist, and drops a path with fewer than two.
export const CORE_PATHS = Object.freeze([
  { id: 'first', title: 'First steps', blurb: 'Indices, sums and the metric, from the Kronecker delta to a change of basis.',
    ids: ['kronecker-delta', 'kronecker', 'levi-civita-cross', 'levi-civita', 'dot-metric', 'dot-product-metric', 'change-of-basis', 'trace-det-epsilon', 'determinant-epsilon'] },
  { id: 'curvature', title: 'Curvature', blurb: 'From the metric of a sphere to the Riemann tensor and the Bianchi identity.',
    ids: ['sphere-metric', 'polar-christoffel', 'geodesic-equation', 'covariant-derivative', 'parallel-transport', 'riemann', 'ricci', 'bianchi', 'geodesic-deviation', 'weyl'] },
  { id: 'relativity', title: 'Relativity', blurb: 'Spacetime: boosts, the field equations and two famous metrics.',
    ids: ['lorentz', 'lorentz-transformation', 'einstein-field-equations', 'einstein', 'schwarzschild', 'flrw', 'killing', 'perfect-fluid'] },
  { id: 'fields', title: 'Fields and matter', blurb: 'Electromagnetism, stress, strain and inertia written as tensors.',
    ids: ['maxwell-tensor', 'maxwell', 'maxwell-equations', 'em-stress-energy', 'cauchy-stress', 'strain', 'hooke', 'inertia', 'quadrupole', 'divergence-theorem'] },
  { id: 'ml', title: 'Tensors in code', blurb: 'einsum, contraction and attention as index notation.',
    ids: ['einsum', 'attention', 'einsum-attention', 'tensor-network', 'mps'] },
]);

async function tryImport(importer, path) {
  try { return { mod: await importer(path), err: null }; }
  catch (e) { return { mod: null, err: e }; }
}

export async function loadPackages(importer = p => import(new URL('../' + p.slice(2), import.meta.url).href)) {
  const out = { missing: [] };
  const names = Object.keys(PKG_PATHS);
  const res = await Promise.all(names.map(n => tryImport(importer, PKG_PATHS[n])));
  names.forEach((n, k) => {
    const { mod, err } = res[k];
    out[n] = mod;
    if (!mod) out.missing.push(`${n}: ${err && err.message ? err.message.split('\n')[0] : 'did not load'}`);
  });
  out.library = out.library ? normalizeLibrary(out.library) : normalizeLibrary({ ENTRIES: [] });
  return out;
}

export function normalizeLibrary(mod) {
  let list = mod.ENTRIES || mod.entries || mod.LIBRARY || (Array.isArray(mod.default) ? mod.default : null) || [];
  if (!Array.isArray(list) && typeof list === 'object') list = Object.values(list);
  const entries = list.filter(e => e && e.id);
  const byId = new Map(entries.map(e => [e.id, e]));
  const counts = new Map();
  for (const e of entries) counts.set(e.field, (counts.get(e.field) || 0) + 1);
  const fieldIds = (mod.FIELDS && Array.isArray(mod.FIELDS) ? mod.FIELDS.map(f => (typeof f === 'string' ? f : f.id)) : Object.keys(FIELD_LABELS))
    .filter(f => counts.has(f)).concat([...counts.keys()].filter(f => !(f in FIELD_LABELS) && !(mod.FIELDS || []).includes(f)));
  const given = new Map((Array.isArray(mod.FIELDS) ? mod.FIELDS : []).filter(f => f && typeof f === 'object').map(f => [f.id, f.label]));
  const fields = [...new Set(fieldIds)].map(id => ({ id, label: given.get(id) || FIELD_LABELS[id] || String(id), count: counts.get(id) || 0 }));
  const rawPaths = Array.isArray(mod.PATHS) && mod.PATHS.length ? mod.PATHS : CORE_PATHS;
  const paths = rawPaths.map(p => ({ id: p.id, title: p.title, blurb: p.blurb || p.text || '', why: p.why || {}, ids: (p.ids || p.entries || p.steps || []).filter(id => byId.has(id)) }))
    .filter(p => p.ids.length >= 2);
  return { entries, byId, fields, paths, raw: mod };
}

function plain(s) { return String(s || '').replace(/\\[A-Za-z]+/g, m => m.slice(1)).toLowerCase(); }

// LIBRARY search(q) ranks the entries when it exists; else a word match.
export function searchEntries(lib, query, field) {
  if (lib.raw && typeof lib.raw.search === 'function' && String(query || '').trim()) {
    try {
      const ranked = lib.raw.search(query).map(e => lib.byId.get(e.id) || e);
      return field ? ranked.filter(e => e.field === field) : ranked;
    } catch (e) { /* fall back to the word match */ }
  }
  const q = plain(query).trim().split(/\s+/).filter(Boolean);
  return lib.entries.filter(e => {
    if (field && e.field !== field) return false;
    if (!q.length) return true;
    const hay = plain([e.title, e.id, e.field, FIELD_LABELS[e.field], e.tex, ...(e.vocab || []).map(v => v.term + ' ' + v.meaning), ...(e.tags || [])].join(' '));
    return q.every(w => hay.includes(w));
  });
}
