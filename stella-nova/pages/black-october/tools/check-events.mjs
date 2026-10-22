// ============================================================================
//  BLACK OCTOBER  ·  tools/check-events.mjs — check the event ledger
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/black-october/tools/check-events.mjs
//  Applies validate() from grow.js to data/events.js, then the editorial
//  rules that the schema cannot see. Exit 1 on any problem. It does not
//  fetch the source URLs (no network in the check).
//    - a confirmed event has at least one primary source
//    - no event text has exploit content (request lines, payload code)
//    - the layout runs on the data
// ============================================================================
import { validate, layout } from '../grow.js';
import { EVENTS } from '../data/events.js';

const out = validate(EVENTS);
for (const e of EVENTS) {
  if (e.confidence === 'confirmed' && !e.sources.some(s => s.primary)) out.push(`${e.id}: confirmed with no primary source`);
  const text = [e.title, e.summary, e.note].join(' ');
  if (/(GET|POST) \/\S|<\?php|\$_(GET|POST|FILES)|Content-Disposition:|curl\s+-/i.test(text)) out.push(`${e.id}: text looks like exploit content`);
}
let L = null;
if (!out.length) { try { L = layout(EVENTS, { seed: 7 }); } catch (err) { out.push('layout: ' + err.message); } }

const count = k => EVENTS.reduce((m, e) => (m[e[k]] = (m[e[k]] || 0) + 1, m), {});
console.log(`${EVENTS.length} events, ${new Set(EVENTS.flatMap(e => e.sources.map(s => s.url))).size} distinct sources`);
console.log('confidence', JSON.stringify(count('confidence')));
console.log('threads', JSON.stringify(count('thread')));
if (L) console.log(`layout: ${L.nodes.length} nodes, ${L.edges.length} edges, ${L.rings.length} day rings`);
for (const p of out) console.log('  PROBLEM ' + p);
console.log(out.length ? `${out.length} problems` : 'ok');
process.exit(out.length ? 1 : 0);
