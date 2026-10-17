// ============================================================================
//  library/index.js  ·  LIBRARY package public API (DOM-free)
// ----------------------------------------------------------------------------
//  The equation library of the tensor-calculus page: famous tensor
//  equations with TeX, a parsed TensorExpr, a story, vocabulary, params to
//  play with, and a trace(params) that runs the MATH engine and returns an
//  OpTrace (CONTRACT.md). CORE's library browser, LEARN and SAVER read it.
//
//  EXPORTS   (grep -n "<anchor>" index.js)
//      LIBRARY ........ "export const LIBRARY"     every entry, in field order
//      FIELDS ......... "export const FIELDS"      [{ id, label }]
//      PATHS .......... "export const PATHS"       learning paths (in paths.js)
//      getEntry ....... "export function getEntry" id -> entry or null
//      byField ........ "export function byField"  field id -> entries
//      search ......... "export function search"   text -> entries, ranked
//      runEntry ....... "export function runEntry" (id, params) -> OpTrace
//      defaults ....... "export function defaults" entry -> { key: def }
//      SCENES, SCENE_IDS, VIZ_IDS, toViz  (scenes.js) LIBRARY scene ids and
//                     their VIZ ids; entry.viz and Step.viz carry VIZ ids,
//                     entry.vizLib keeps the LIBRARY hint
//
//  ENTRY SHAPE (CONTRACT.md, plus the extras marked +)
//      { id, title, field, tex, expr() -> TensorExpr, story: [paragraph],
//        vocab: [{ term, meaning }], params: [{ key, label, min, max, step, def }],
//        trace(params) -> OpTrace, viz: { scene, params }, diagram: { style, order, note },
//        refs: [{ text, url }],
//        + itex     index TeX of the main equation (what expr() parses)
//        + shape    { rank, variance, symmetries, independent }
//        + paths    ids of the learning paths that include the entry }
//  trace(params) may be called unbound: entry.trace is bound to its entry.
//  Missing params take their defaults. The OpTrace carries two extras:
//  checks [{ label, got, want, tol, ok }] against closed forms, and values.
//
//  CONVENTIONS (stated in the entries): metric signature (-, +, +, +),
//  G = c = 1 unless an entry says otherwise; Riemann
//  R^r_{smn} = d_m G^r_{ns} - d_n G^r_{ms} + G^r_{ml} G^l_{ns} - G^r_{nl} G^l_{ms}
//  (MTW, Carroll), Ricci R_{sn} = R^r_{srn}, so a sphere has R = 2/a^2.
//
//  FILES
//      math.js ............ the one import of the MATH engine
//      stub-math.js ....... LIBRARY's own small engine (cross-check in tests)
//      kit.js ............. step / trace / check helpers and references
//      scenes.js .......... VIZ scene ids
//      paths.js ........... learning paths
//      entries-*.js ....... the entries, one file per field
// ============================================================================
import { X } from './kit.js';
import { toViz } from './scenes.js';
import { ALGEBRA } from './entries-algebra.js';
import { GEOMETRY } from './entries-geometry.js';
import { RELATIVITY } from './entries-relativity.js';
import { ELECTROMAGNETISM } from './entries-em.js';
import { CONTINUUM } from './entries-continuum.js';
import { MECHANICS } from './entries-mechanics.js';
import { QUANTUM } from './entries-quantum.js';
import { ML } from './entries-ml.js';
import { PATHS } from './paths.js';
export { SCENES, SCENE_IDS, VIZ_IDS, toViz } from './scenes.js';
export { PATHS } from './paths.js';

export const FIELDS = [
  { id: 'algebra', label: 'Index algebra' },
  { id: 'geometry', label: 'Geometry' },
  { id: 'relativity', label: 'Relativity' },
  { id: 'electromagnetism', label: 'Electromagnetism' },
  { id: 'continuum', label: 'Continuum mechanics' },
  { id: 'mechanics', label: 'Mechanics' },
  { id: 'quantum', label: 'Quantum' },
  { id: 'ml', label: 'Machine learning' },
];

function finish(e) {
  const entry = { ...e };
  entry.expr = () => X(entry.itex);
  entry.trace = e.trace.bind(entry);
  entry.vizLib = e.viz;
  entry.viz = toViz(e.viz);
  entry.paths = PATHS.filter(p => p.steps.includes(e.id)).map(p => p.id);
  return Object.freeze(entry);
}

export const LIBRARY = [...ALGEBRA, ...GEOMETRY, ...RELATIVITY, ...ELECTROMAGNETISM, ...CONTINUUM, ...MECHANICS, ...QUANTUM, ...ML].map(finish);
const BY_ID = new Map(LIBRARY.map(e => [e.id, e]));

export function getEntry(id) { return BY_ID.get(id) ?? null; }
export function byField(field) { return LIBRARY.filter(e => e.field === field); }
export function defaults(entry) { return Object.fromEntries((entry.params || []).map(p => [p.key, p.def])); }
export function runEntry(id, params) {
  const e = getEntry(id);
  if (!e) throw new Error(`library: no entry '${id}'`);
  return e.trace(params ?? defaults(e));
}

// Plain-text search over title, field, vocab terms and story. Title hits
// rank first, then vocab, then story. Empty query gives every entry.
export function search(q) {
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return LIBRARY.slice();
  const words = s.split(/\s+/);
  const plain = t => t.replace(/\$[^$]*\$/g, ' ').toLowerCase();
  const scored = LIBRARY.map(e => {
    const title = e.title.toLowerCase(), vocab = e.vocab.map(v => v.term + ' ' + v.meaning).join(' ').toLowerCase(), story = plain(e.story.join(' '));
    let score = 0;
    for (const w of words) {
      if (title.includes(w) || e.id.includes(w)) score += 10;
      else if (vocab.includes(w) || e.field.includes(w)) score += 4;
      else if (story.includes(w)) score += 1;
      else return { e, score: 0 };
    }
    return { e, score };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.e);
}
