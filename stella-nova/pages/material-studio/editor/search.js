// ============================================================================
//  MATERIAL STUDIO  ·  editor/search.js — node def search and recent list
// ────────────────────────────────────────────────────────────────────────────
//  Ranks the registry defs for a query. Each term must hit the label start
//  (6), a label word start (4), the label (3) or the search text of type,
//  category, tags and doc (1). With a wire, only defs that have a compatible
//  port stay, and an exact type adds 2. An empty query puts the last 6
//  recent types first. The palette and the library both use this.
//
//  GREP TARGETS
//      recent / pushRecent ... last 10 added types (localStorage)
//      allDefs ............... registry defs + reroute, no second output node
//      catRank ............... order of NODE_CATEGORIES
//      searchDefs ............ ranked [{d, score, ri, recent?}]
// ============================================================================
import { OUTPUT_TYPE, NODE_CATEGORIES } from '../contract.js';
import * as G from '../graph.js';
import { state } from '../store.js';
import { RECENT_KEY } from './state.js';

export function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
export function pushRecent(type) {
  const r = [type, ...recent().filter(t => t !== type)].slice(0, 10);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {}
}
export function allDefs() {
  const hasOut = state.graph?.nodes.some(n => n.type === OUTPUT_TYPE);
  const defs = [...state.registry.values()].filter(d => !(d.type === OUTPUT_TYPE && hasOut));
  if (!state.registry.has(G.REROUTE_TYPE)) defs.push(G.REROUTE_DEF);
  return defs;
}
export function catRank(c) { const i = NODE_CATEGORIES.indexOf(c); return i < 0 ? 99 : i; }
const hayCache = new WeakMap();   // defs can be frozen: cache the search text outside them
const hay = d => {
  let h = hayCache.get(d);
  if (h === undefined) { h = `${d.label} ${d.type} ${d.category} ${(d.tags || []).join(' ')} ${d.doc || ''}`.toLowerCase(); hayCache.set(d, h); }
  return h;
};
/** Search defs. wire: {dir, type} keeps only defs with a compatible port. */
export function searchDefs(q, wire, limit = 300) {
  q = q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const rec = recent();
  const out = [];
  for (const d of allDefs()) {
    let wireScore = 0;
    if (wire) {
      const ports = wire.dir === 'out' ? d.inputs || [] : d.outputs || [];
      const ok = ports.filter(p => wire.dir === 'out' ? G.typesCompatible(wire.type, p.type) : G.typesCompatible(p.type, wire.type));
      if (!ok.length) continue;
      wireScore = ok.some(p => p.type === wire.type) ? 2 : 0;
    }
    let score = 0;
    if (terms.length) {
      const label = d.label.toLowerCase(), h = hay(d);
      let all = true;
      for (const t of terms) {
        if (label.startsWith(t)) score += 6;
        else if (label.split(/[\s\-_/]+/).some(wd => wd.startsWith(t))) score += 4;
        else if (label.includes(t)) score += 3;
        else if (h.includes(t)) score += 1;
        else { all = false; break; }
      }
      if (!all) continue;
    }
    const ri = rec.indexOf(d.type);
    if (ri >= 0) score += terms.length ? 1.5 : 0;
    score += wireScore;
    if (d.source === 'bench' && !terms.length) score -= 0.5;
    out.push({ d, score, ri });
  }
  out.sort((a, b) => b.score - a.score || catRank(a.d.category) - catRank(b.d.category) || a.d.label.localeCompare(b.d.label));
  if (!terms.length) {
    const recents = rec.map(t => out.find(o => o.d.type === t)).filter(Boolean).slice(0, 6).map(o => ({ ...o, recent: true }));
    return [...recents, ...out.filter(o => !recents.some(r => r.d.type === o.d.type))].slice(0, limit);
  }
  return out.slice(0, limit);
}
